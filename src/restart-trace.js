// Actual ROS observations drive replay. The trajectory is evaluator context only.
export function sourcePose(timeMs) {
  const t = timeMs / 1000;
  return [3 * Math.cos(t), 2 * Math.sin(t), 1.5 + 0.4 * Math.sin(2 * t)];
}
export const policyNames = { sequence: 'Sequence only', incarnation: 'Epoch + sequence' };
const policyIds = Object.keys(policyNames);
const check = (condition, message) => { if (!condition) throw new Error(`Invalid restart trace: ${message}`); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stamp = value => finite(value) && value >= 0 && value <= 60_000;
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max;
const near = (a, b) => finite(a) && Math.abs(a - b) <= 1e-6;
const xyz = (a, b) => Array.isArray(a) && a.length === 3 && a.every((v, i) => finite(v) && Math.abs(v - b[i]) <= 1e-9);

/** Independent reference for the two application admission rules; no process truth. */
export function admitHeartbeat(lastAccepted, message, policyId) {
  if (!Object.hasOwn(policyNames, policyId)) throw new RangeError('Unknown heartbeat policy.');
  if (!lastAccepted) return { accepted: true, reason: 'first-message' };
  if (policyId === 'incarnation') {
    if (message.epoch < lastAccepted.epoch) return { accepted: false, reason: 'old-epoch' };
    if (message.epoch > lastAccepted.epoch) return { accepted: true, reason: 'new-epoch' };
  }
  return message.seq > lastAccepted.seq
    ? { accepted: true, reason: 'new-sequence' }
    : { accepted: false, reason: 'duplicate-or-old-sequence' };
}

/** Validate the supported experiment and observed decisions, not producer authenticity. */
export function validateRestartTrace(trace) {
  check(trace && trace.schemaVersion === 1 && trace.kind === 'argos-ros2-restart', 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['rosDistro', 'rmw', 'python', 'image', 'recordedAt'].every(key => text(runtime[key], 500)), 'runtime metadata');
  check(runtime.clock === 'shared-host-monotonic' && Number.isFinite(Date.parse(runtime.recordedAt)), 'clock and recording date');
  check(typeof runtime.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(runtime.sourceSha256), 'runtime source hash');
  const qos = runtime.heartbeatQos;
  check(qos && qos.reliability === 'reliable' && qos.durability === 'volatile' && qos.history === 'keep_last' && qos.depth === 20, 'heartbeat QoS contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 10, '1–10 cases required');
  const cases = new Set(), runs = new Set();
  for (const run of trace.cases) {
    check(run && text(run.id, 80) && !cases.has(run.id) && text(run.label), 'unique case identity'); cases.add(run.id);
    check(text(run.runId, 100) && !runs.has(run.runId), 'unique run identity'); runs.add(run.runId);
    const config = run.config;
    check(config && config.heartbeatPeriodMs === 100 && config.timeoutMs === 400 && config.watchdogPeriodMs === 20 && config.durationMs === 8000 && config.restartGuardMs === 1000, 'heartbeat/watchdog timing');
    check((config.interruptMs === null && config.resumeMs === null) || (config.interruptMs === 1500 && config.resumeMs === 3000), 'interruption schedule');
    check(stamp(run.endMs) && run.endMs >= config.durationMs && run.outcome?.status === 'completed', 'completed observation window');
    const pids = new Set();
    const identity = process => {
      check(process && text(process.node, 200) && Number.isSafeInteger(process.pid) && process.pid > 0 && !pids.has(process.pid), 'distinct process identities');
      pids.add(process.pid);
    };
    identity(run.observer); identity(run.collector);
    check(run.observer.node !== run.collector.node, 'observer and collector node identities');
    check(Array.isArray(run.agents) && [1, 2].includes(run.agents.length), 'one or two agent incarnations');
    for (const [index, agent] of run.agents.entries()) {
      identity(agent); check(agent.epoch === index + 1 && agent.node === run.agents[0].node && agent.node !== run.observer.node && agent.node !== run.collector.node, 'same logical node with ordered incarnations');
    }
    check(Array.isArray(run.processEvents) && run.processEvents.length <= 12, 'bounded process events');
    const kinds = run.processEvents.map(event => event?.kind);
    const expectedKinds = run.agents.length === 2 ? ['kill-requested', 'exited', 'spawned', 'ready']
      : config.interruptMs === null ? [] : ['silence-start', 'silence-end'];
    check(JSON.stringify(kinds) === JSON.stringify(expectedKinds), 'process event sequence');
    let previous = -1;
    for (const event of run.processEvents) {
      check(event && stamp(event.timeMs) && event.timeMs >= previous && event.timeMs <= run.endMs, 'process event timestamps'); previous = event.timeMs;
      const epoch = ['spawned', 'ready'].includes(event.kind) ? 2 : 1;
      check(event.epoch === epoch && event.pid === run.agents[epoch - 1].pid, 'process event incarnation');
      const boundary = ['kill-requested', 'exited', 'silence-start'].includes(event.kind) ? config.interruptMs : config.resumeMs;
      check(boundary !== null && event.timeMs >= boundary, 'process event before planned boundary');
      if (event.kind === 'exited') check(event.exitCode === -9, 'SIGKILL exit evidence');
    }
    const stopped = run.processEvents.find(event => event.kind === 'exited');
    const ready = run.processEvents.find(event => event.kind === 'ready');
    const silenceStart = run.processEvents.find(event => event.kind === 'silence-start');
    const silenceEnd = run.processEvents.find(event => event.kind === 'silence-end');
    check(Array.isArray(run.publications) && run.publications.length > 0 && run.publications.length <= 100, 'bounded heartbeat publications');
    const bySample = new Map(), sequences = new Map(); previous = -1;
    for (const publication of run.publications) {
      check(publication && publication.runId === run.runId && publication.agentId === 'A1', 'publication run and logical agent');
      check(Number.isInteger(publication.epoch) && run.agents.some(agent => agent.epoch === publication.epoch), 'publication incarnation');
      check(publication.seq === (sequences.get(publication.epoch) ?? -1) + 1, 'sequence starts at zero within each incarnation'); sequences.set(publication.epoch, publication.seq);
      check(stamp(publication.generatedMs) && publication.generatedMs > previous && publication.generatedMs < config.durationMs, 'publication timestamps'); previous = publication.generatedMs;
      check(xyz(publication.position, sourcePose(publication.generatedMs)), 'synthetic source position');
      check(!stopped || publication.epoch !== 1 || publication.generatedMs <= stopped.timeMs, 'no publication after process exit');
      check(publication.epoch !== 2 || (ready && publication.generatedMs >= ready.timeMs), 'new incarnation must be ready before publication');
      check(!silenceStart || publication.generatedMs < silenceStart.timeMs || publication.generatedMs >= silenceEnd.timeMs, 'no publication during recorded silence');
      bySample.set(`${publication.epoch}/${publication.seq}`, publication);
    }
    check(sequences.size === run.agents.length, 'each incarnation publishes evidence');
    const period = config.heartbeatPeriodMs;
    for (const agent of run.agents) {
      const publications = run.publications.filter(item => item.epoch === agent.epoch);
      const firstSlot = agent.epoch === 1 ? 0 : Math.floor(publications[0].generatedMs / period);
      for (const publication of publications) {
        const slot = firstSlot + publication.seq + (silenceStart && publication.seq >= config.interruptMs / period ? (config.resumeMs - config.interruptMs) / period : 0);
        check(publication.generatedMs >= slot * period && publication.generatedMs < (slot + 1) * period, 'heartbeat publication schedule slot');
      }
      if (agent.epoch === 1 && stopped) {
        const requested = run.processEvents.find(item => item.kind === 'kill-requested');
        check((publications.length + 1) * period > requested.timeMs, 'complete publication slots before kill request');
      } else {
        const skipped = silenceStart ? (config.resumeMs - config.interruptMs) / period : 0;
        check(publications.length === config.durationMs / period - firstSlot - skipped, 'complete publication schedule');
      }
      if (agent.epoch === 2) check(publications[0].generatedMs + 1e-6 >= ready.timeMs + config.restartGuardMs, 'restart setup guard');
    }
    check(Array.isArray(run.callbacks) && run.callbacks.length > 0 && run.callbacks.length <= 200, 'bounded observer callbacks');
    previous = -1;
    for (const callback of run.callbacks) {
      check(callback && callback.runId === run.runId && callback.agentId === 'A1', 'callback run and logical agent');
      const publication = bySample.get(`${callback.epoch}/${callback.seq}`);
      check(publication && callback.epoch === publication.epoch && callback.seq === publication.seq && callback.generatedMs === publication.generatedMs && xyz(callback.position, publication.position), 'callback references an actual publication');
      check(stamp(callback.callbackMs) && callback.callbackMs > previous && callback.callbackMs >= callback.generatedMs && callback.callbackMs <= run.endMs, 'callback timestamps'); previous = callback.callbackMs;
      check(callback.decisions && policyIds.every(id => callback.decisions[id]), 'two decisions for the same callback');
    }
    check(Array.isArray(run.transitions) && run.transitions.length <= 100, 'bounded observed status transitions'); previous = -1;
    for (const event of run.transitions) {
      check(event && Object.hasOwn(policyNames, event.policy) && stamp(event.timeMs) && event.timeMs >= previous && event.timeMs <= run.endMs, 'status transition identity and time'); previous = event.timeMs;
      check((event.status === 'suspect' && event.reason === 'timeout') || (event.status === 'live' && ['first-message', 'accepted-after-suspicion'].includes(event.reason)), 'status transition vocabulary');
    }
    for (const policy of policyIds) {
      let lastAccepted = null, status = 'awaiting';
      const expected = [];
      // Callback-triggered transitions are independently reconstructed. Timer
      // transitions must be actual observations with sufficient local silence.
      const observations = [
        ...run.callbacks.map(data => ({ timeMs: data.callbackMs, kind: 'callback', data })),
        ...run.transitions.filter(event => event.policy === policy && event.status === 'suspect').map(data => ({ timeMs: data.timeMs, kind: 'timeout', data })),
      ].sort((a, b) => a.timeMs - b.timeMs);
      for (const event of observations) {
        if (event.kind === 'callback') {
          const decision = admitHeartbeat(lastAccepted, event.data, policy), actual = event.data.decisions[policy];
          check(actual.accepted === decision.accepted && actual.reason === decision.reason, 'recorded admission decision');
          if (decision.accepted) {
            lastAccepted = event.data;
            if (status !== 'live') expected.push({ policy, timeMs: event.timeMs, status: 'live', reason: status === 'awaiting' ? 'first-message' : 'accepted-after-suspicion' });
            status = 'live';
          }
        } else {
          check(status === 'live' && lastAccepted && event.timeMs - lastAccepted.callbackMs + 1e-6 >= config.timeoutMs, 'timeout requires elapsed accepted-receipt silence');
          status = 'suspect'; expected.push(event.data);
        }
      }
      const actual = run.transitions.filter(event => event.policy === policy);
      check(actual.length === expected.length && actual.every((event, index) => near(event.timeMs, expected[index].timeMs) && event.status === expected[index].status && event.reason === expected[index].reason), 'status transitions follow accepted callbacks and observed timeouts');
    }
  }
  return trace;
}

export function restartEvents(run) {
  return [
    ...run.publications.map(data => ({ timeMs: data.generatedMs, kind: 'publication', data })),
    ...run.callbacks.map(data => ({ timeMs: data.callbackMs, kind: 'callback', data })),
    ...run.transitions.map(data => ({ timeMs: data.timeMs, kind: 'status', policy: data.policy, data })),
    ...run.processEvents.map(data => ({ timeMs: data.timeMs, kind: data.kind, data })),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

function processAt(run, timeMs) {
  let current = { ...run.agents[0], status: 'running', lastEvent: null };
  for (const event of run.processEvents.filter(item => item.timeMs <= timeMs)) {
    const status = { 'silence-start': 'silent', 'silence-end': 'running', 'kill-requested': 'termination-requested', exited: 'stopped', spawned: 'starting', ready: 'running' }[event.kind];
    current = { ...run.agents.find(agent => agent.epoch === event.epoch), status, lastEvent: event };
  }
  return current;
}

/** Held samples and statuses come from the trace, never from evaluator process truth. */
export function restartFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const callbacks = run.callbacks.filter(item => item.callbackMs <= timeMs), lastCallback = callbacks.at(-1) ?? null;
  const transitions = run.transitions.filter(item => item.timeMs <= timeMs), sourcePosition = sourcePose(timeMs);
  return {
    timeMs, sourcePosition, process: processAt(run, timeMs),
    publication: run.publications.filter(item => item.generatedMs <= timeMs).at(-1) ?? null,
    lastCallback, callbacks, transitions,
    policies: policyIds.map(id => {
      const accepted = callbacks.filter(item => item.decisions[id].accepted), lastAccepted = accepted.at(-1) ?? null;
      const receiptAgeMs = lastAccepted ? timeMs - lastAccepted.callbackMs : null;
      const position = lastAccepted ? [...lastAccepted.position] : null;
      return {
        id, label: policyNames[id], lastAccepted, lastCallback, lastDecision: lastCallback?.decisions[id] ?? null,
        position, status: transitions.filter(item => item.policy === id).at(-1)?.status ?? 'awaiting',
        epoch: lastAccepted?.epoch ?? null, seq: lastAccepted?.seq ?? null,
        receiptAgeMs, generationAgeMs: lastAccepted ? timeMs - lastAccepted.generatedMs : null,
        deadlineRemainingMs: receiptAgeMs === null ? null : Math.max(0, run.config.timeoutMs - receiptAgeMs),
        positionError: position ? Math.hypot(...position.map((v, i) => v - sourcePosition[i])) : null,
        received: callbacks.length, accepted: accepted.length, rejected: callbacks.length - accepted.length,
      };
    }),
    events: restartEvents(run).filter(item => item.timeMs <= timeMs),
  };
}

export function restartSummary(run) {
  const resume = run.processEvents.find(item => item.kind === 'silence-end');
  const spawn = run.processEvents.find(item => item.kind === 'spawned');
  const returnCallback = spawn ? run.callbacks.find(item => item.epoch === 2) ?? null
    : resume ? run.callbacks.find(item => item.callbackMs >= resume.timeMs) ?? null : null;
  return policyIds.map(id => {
    const accepted = run.callbacks.filter(item => item.decisions[id].accepted);
    const firstAcceptedAfterReturn = returnCallback ? accepted.find(item => item.callbackMs >= returnCallback.callbackMs) ?? null : null;
    return {
      id, received: run.callbacks.length, accepted: accepted.length, rejected: run.callbacks.length - accepted.length,
      firstSuspicionMs: run.transitions.find(item => item.policy === id && item.status === 'suspect')?.timeMs ?? null,
      returnCallback, firstAcceptedAfterReturn,
      returnToAcceptanceMs: firstAcceptedAfterReturn ? firstAcceptedAfterReturn.callbackMs - returnCallback.callbackMs : null,
      spawnToAcceptanceMs: spawn && firstAcceptedAfterReturn ? firstAcceptedAfterReturn.callbackMs - spawn.timeMs : null,
      finalStatus: run.transitions.filter(item => item.policy === id).at(-1)?.status ?? 'awaiting',
    };
  });
}
