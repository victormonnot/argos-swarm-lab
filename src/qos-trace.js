// Recorded observations only. The source law is evaluator data, never a reader input.
export function sourcePose(timeMs) {
  const t = timeMs / 1000;
  return [3 * Math.cos(t), 2 * Math.sin(t), 1.5 + 0.4 * Math.sin(2 * t)];
}

const check = (condition, message) => { if (!condition) throw new Error(`Invalid QoS trace: ${message}`); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => finite(value) && value >= 0 && value <= 60_000;
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max;
const samePosition = (a, b) => Array.isArray(a) && a.length === 3 && a.every((value, axis) => finite(value) && Math.abs(value - b[axis]) <= 1e-9);
const near = (a, b) => finite(a) && Math.abs(a - b) <= 1e-6;
const profiles = { history20: [20, null], latest1: [1, null], gated20: [20, 150] };

/** Internal consistency and supported lesson protocol; metadata is not authenticated. */
export function validateQosTrace(trace) {
  check(trace && trace.schemaVersion === 1 && trace.kind === 'argos-ros2-qos', 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['rosDistro', 'rmw', 'python', 'image', 'recordedAt'].every(key => text(runtime[key], 500)), 'runtime metadata');
  check(runtime.clock === 'shared-host-monotonic', 'shared monotonic clock required');
  check(typeof runtime.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(runtime.sourceSha256), 'source hash');
  check(Number.isFinite(Date.parse(runtime.recordedAt)), 'recording date');
  const qos = runtime.publisherQos;
  check(qos && qos.reliability === 'reliable' && qos.durability === 'volatile' && qos.history === 'keep_last' && qos.depth === 20, 'publisher QoS contract');
  check(Array.isArray(trace.cases) && trace.cases.length > 0 && trace.cases.length <= 10, '1–10 recordings required');
  const caseIds = new Set(), runIds = new Set();
  for (const run of trace.cases) {
    check(run && text(run.id, 80) && !caseIds.has(run.id) && text(run.label), 'unique case identity'); caseIds.add(run.id);
    check(text(run.runId, 100) && !runIds.has(run.runId), 'unique run identity'); runIds.add(run.runId);
    const config = run.config;
    check(config && config.publishPeriodMs === 50 && config.publishDurationMs === 4000 && config.readerPeriodMs === 50 && config.readerPhaseMs === 25 && config.drainDurationMs === 1200 && config.ageLimitMs === 150, 'supported timing and age contract');
    const hasPause = config.pauseStartMs !== null;
    check(hasPause ? timestamp(config.pauseStartMs) && timestamp(config.pauseEndMs) && config.pauseStartMs < config.pauseEndMs && config.pauseEndMs < config.publishDurationMs : config.pauseEndMs === null, 'pause schedule');
    check(timestamp(run.endMs) && run.endMs >= config.publishDurationMs + config.drainDurationMs, 'observation end');
    check(run.outcome?.status === 'completed', 'completed recording required');
    const pids = new Set(), names = new Set();
    const process = entry => {
      check(entry && text(entry.node, 200) && !names.has(entry.node) && Number.isSafeInteger(entry.pid) && entry.pid > 0 && !pids.has(entry.pid), 'distinct node/process identities');
      pids.add(entry.pid); names.add(entry.node);
    };
    process(run.publisher); process(run.collector);
    check(Array.isArray(run.publications) && run.publications.length === config.publishDurationMs / config.publishPeriodMs, 'completed publication schedule');
    let previousTime = -1;
    for (const [index, publication] of run.publications.entries()) {
      check(publication && publication.runId === run.runId && publication.seq === index, 'publication run and contiguous sequence');
      check(timestamp(publication.generatedMs) && publication.generatedMs > previousTime && publication.generatedMs < config.publishDurationMs, 'publication timestamps');
      check(publication.generatedMs >= index * config.publishPeriodMs && publication.generatedMs < (index + 1) * config.publishPeriodMs, 'publication schedule slot');
      check(samePosition(publication.position, sourcePose(publication.generatedMs)), 'synthetic source position');
      previousTime = publication.generatedMs;
    }
    check(Array.isArray(run.readers) && run.readers.length === 3, 'three reader profiles required');
    const ids = new Set();
    for (const reader of run.readers) {
      check(reader && Object.hasOwn(profiles, reader.id) && !ids.has(reader.id) && text(reader.label), 'unique reader profile'); ids.add(reader.id);
      process(reader);
      check(reader.depth === profiles[reader.id][0] && reader.ageLimitMs === profiles[reader.id][1], 'reader depth and application age policy');
      check(Array.isArray(reader.pauses) && reader.pauses.length === Number(hasPause), 'actual pause intervals');
      for (const pause of reader.pauses) {
        check(pause && timestamp(pause.startMs) && timestamp(pause.endMs) && pause.startMs < pause.endMs && pause.endMs <= run.endMs, 'pause bounds');
        check(pause.startMs + 1e-6 >= config.pauseStartMs && pause.endMs + 1e-6 >= config.pauseEndMs, 'actual pause cannot precede planned boundaries');
      }
      check(Array.isArray(reader.callbacks) && reader.callbacks.length <= run.publications.length, 'bounded callbacks');
      let previousSeq = -1, previousCallback = -1, previousSlot = -1;
      for (const callback of reader.callbacks) {
        check(callback && callback.runId === run.runId && Number.isInteger(callback.seq) && callback.seq > previousSeq, 'callback run and increasing sequence');
        const publication = run.publications[callback.seq];
        check(publication && callback.generatedMs === publication.generatedMs && samePosition(callback.position, publication.position), 'callback must reference its actual publication');
        check(timestamp(callback.callbackMs) && callback.callbackMs >= callback.generatedMs && callback.callbackMs > previousCallback && callback.callbackMs <= run.endMs, 'callback timestamps');
        const slot = Math.floor((callback.callbackMs - config.readerPhaseMs) / config.readerPeriodMs);
        check(slot > previousSlot, 'at most one callback per reader schedule slot');
        check(near(callback.ageMs, callback.callbackMs - callback.generatedMs), 'callback age is generation-to-callback time');
        check(!reader.pauses.some(pause => callback.callbackMs >= pause.startMs && callback.callbackMs < pause.endMs), 'no callbacks during the recorded executor pause');
        const accepted = reader.ageLimitMs === null || callback.ageMs <= reader.ageLimitMs;
        check(callback.accepted === accepted && callback.reason === (accepted ? 'accepted' : 'stale'), 'recorded application age decision');
        previousSeq = callback.seq; previousCallback = callback.callbackMs; previousSlot = slot;
      }
    }
  }
  return trace;
}

/** Grouping uses a shared host clock; simultaneous observations stay independent. */
export function qosEvents(run) {
  const events = run.publications.map(data => ({ timeMs: data.generatedMs, kind: 'publish', data }));
  for (const reader of run.readers) {
    for (const data of reader.callbacks) events.push({ timeMs: data.callbackMs, kind: 'callback', readerId: reader.id, data });
    for (const data of reader.pauses) {
      events.push({ timeMs: data.startMs, kind: 'pause', readerId: reader.id, data });
      events.push({ timeMs: data.endMs, kind: 'resume', readerId: reader.id, data });
    }
  }
  return events.sort((a, b) => a.timeMs - b.timeMs);
}

/** Hold last accepted measurement exactly; never interpolate or replace it with truth. */
export function qosFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const publications = run.publications.filter(item => item.generatedMs <= timeMs);
  const sourcePosition = sourcePose(timeMs);
  return {
    timeMs, sourcePosition, publication: publications.at(-1) ?? null,
    readers: run.readers.map(reader => {
      const callbacks = reader.callbacks.filter(item => item.callbackMs <= timeMs);
      const accepted = callbacks.filter(item => item.accepted), lastAccepted = accepted.at(-1) ?? null;
      const ageMs = lastAccepted ? timeMs - lastAccepted.generatedMs : null;
      const position = lastAccepted ? [...lastAccepted.position] : null;
      return {
        ...reader, callbacks, lastCallback: callbacks.at(-1) ?? null, lastAccepted, position, ageMs,
        fresh: ageMs !== null && ageMs <= run.config.ageLimitMs,
        paused: reader.pauses.some(pause => timeMs >= pause.startMs && timeMs < pause.endMs),
        received: callbacks.length, accepted: accepted.length, rejected: callbacks.length - accepted.length,
        unobserved: publications.length - callbacks.length,
        positionError: position ? Math.hypot(...position.map((value, axis) => value - sourcePosition[axis])) : null,
      };
    }),
    events: qosEvents(run).filter(event => event.timeMs <= timeMs),
  };
}

/** Descriptive measurements for this recording, not transport performance rankings. */
export function qosSummary(run) {
  return run.readers.map(reader => {
    const ages = reader.callbacks.map(item => item.ageMs);
    const accepted = reader.callbacks.filter(item => item.accepted).length;
    const resume = reader.pauses.at(-1)?.endMs;
    return {
      id: reader.id, received: reader.callbacks.length, accepted, rejected: reader.callbacks.length - accepted,
      unobserved: run.publications.length - reader.callbacks.length,
      maxCallbackAgeMs: ages.length ? Math.max(...ages) : null,
      meanCallbackAgeMs: ages.length ? ages.reduce((total, value) => total + value, 0) / ages.length : null,
      freshCallbacks: ages.filter(age => age <= run.config.ageLimitMs).length,
      firstAfterPause: resume === undefined ? null : reader.callbacks.find(item => item.callbackMs >= resume) ?? null,
    };
  });
}
