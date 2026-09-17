// Replay actual callbacks. Configured retention is an illustration, not a queue probe.
export const rmwNames = {
  rmw_fastrtps_cpp: 'Fast DDS',
  rmw_zenoh_cpp: 'Zenoh',
};

export function sourcePose(timeMs) {
  const t = timeMs / 1000;
  return [3 * Math.cos(t), 2 * Math.sin(t), 1.5 + 0.4 * Math.sin(2 * t)];
}

const check = (condition, message) => { if (!condition) throw new Error(`Invalid middleware trace: ${message}`); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stamp = value => finite(value) && value >= 0 && value <= 60_000;
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const xyz = (actual, expected) => Array.isArray(actual) && actual.length === 3
  && actual.every((value, axis) => finite(value) && Math.abs(value - expected[axis]) <= 1e-9);
const uniqueSequences = callbacks => [...new Set(callbacks.map(item => item.seq))].sort((a, b) => a - b);
const sameSequenceSet = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
const subscriptionStart = run => run.processEvents[0].timeMs;
const subscriptionCreated = run => run.processEvents[1].timeMs;

/** Check a declared experiment and its evidence, without authenticating its producer. */
export function validateMiddlewareTrace(trace) {
  check(trace && trace.schemaVersion === 1 && trace.kind === 'argos-ros2-middleware', 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['rosDistro', 'python', 'image', 'baseImage', 'recordedAt'].every(key => text(runtime[key], 500)), 'runtime metadata');
  check(runtime.clock === 'shared-host-monotonic' && Number.isFinite(Date.parse(runtime.recordedAt)), 'recording clock and date');
  check(hash(runtime.sourceSha256), 'runtime source fingerprint');
  check(runtime.wireType === 'std_msgs/msg/String' && runtime.domainId === 45, 'wire type and ROS domain');
  check(runtime.harness === 'stdio-pipes' && runtime.initialGuardMs === 1000, 'out-of-band setup contract');
  check(runtime.configFiles && hash(runtime.configFiles.zenohSessionSha256) && hash(runtime.configFiles.zenohRouterSha256), 'Zenoh default configuration fingerprints');
  check(runtime.packages && typeof runtime.packages === 'object' && !Array.isArray(runtime.packages)
    && Object.keys(runtime.packages).length > 0 && Object.keys(runtime.packages).length <= 100
    && Object.entries(runtime.packages).every(([key, value]) => text(key, 200) && text(value, 300)), 'recorded package versions');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 4, '1–4 recorded cases required');
  const ids = new Set(), runs = new Set(), combinations = new Set();
  for (const run of trace.cases) {
    check(run && text(run.id, 80) && !ids.has(run.id) && text(run.label), 'unique case identity'); ids.add(run.id);
    check(text(run.runId, 100) && !runs.has(run.runId), 'unique run identity'); runs.add(run.runId);
    check(Object.hasOwn(rmwNames, run.rmw) && ['volatile', 'transient_local'].includes(run.durability), 'supported RMW and durability');
    const combination = `${run.rmw}/${run.durability}`;
    check(!combinations.has(combination), 'unique RMW/durability combination'); combinations.add(combination);
    const config = run.config;
    check(config && config.periodMs === 100 && config.depth === 5 && config.joinMs === 2000
      && config.resumeMs === 4000 && config.publishEndMs === 5000 && config.durationMs === 6000
      && config.reliability === 'reliable' && config.history === 'keep_last', 'fixed publication and QoS contract');
    check(stamp(run.endMs) && run.endMs >= config.durationMs && run.outcome?.status === 'completed', 'completed observation window');
    const pids = new Set();
    for (const endpoint of [run.publisher, run.reader]) {
      check(endpoint && text(endpoint.node, 200) && Number.isSafeInteger(endpoint.pid) && endpoint.pid > 0
        && !pids.has(endpoint.pid), 'distinct endpoint process identities'); pids.add(endpoint.pid);
      check(endpoint.rmw === run.rmw, 'actual endpoint RMW identity');
      check(endpoint.qosSource === 'requested', 'requested endpoint QoS provenance');
      const qos = endpoint.qos;
      check(qos && qos.reliability === config.reliability && qos.durability === run.durability
        && qos.history === config.history && qos.depth === config.depth, 'requested endpoint QoS');
      const graph = endpoint.graphQos;
      check(endpoint.graphQosSource === 'ros-graph' && graph
        && ['unknown', config.reliability].includes(graph.reliability)
        && ['unknown', run.durability].includes(graph.durability)
        && ['unknown', config.history].includes(graph.history)
        && Number.isInteger(graph.depth) && [0, config.depth].includes(graph.depth), 'available graph-reported QoS fields');
    }
    check(run.publisher.node !== run.reader.node, 'distinct node names');
    if (run.rmw === 'rmw_zenoh_cpp') {
      check(run.router && Number.isSafeInteger(run.router.pid) && run.router.pid > 0 && !pids.has(run.router.pid)
        && run.router.sessionMode === 'peer' && run.router.role === 'discovery', 'Zenoh discovery router and peer sessions');
    } else check(run.router === null, 'Fast DDS case has no Zenoh router');
    check(Array.isArray(run.processEvents) && run.processEvents.length === 2, 'subscription creation evidence');
    let previous = -1;
    for (const [index, event] of run.processEvents.entries()) {
      check(event && event.kind === ['subscription-create-start', 'subscription-created'][index]
        && event.pid === run.reader.pid && stamp(event.timeMs) && event.timeMs >= config.joinMs
        && event.timeMs >= previous && event.timeMs < config.resumeMs, 'subscription creation in the quiet interval');
      previous = event.timeMs;
    }
    check(Array.isArray(run.publications) && run.publications.length === 20, 'complete twenty-publication schedule');
    previous = -1;
    for (const [seq, publication] of run.publications.entries()) {
      const slot = seq < 10 ? seq * config.periodMs : config.resumeMs + (seq - 10) * config.periodMs;
      check(publication && publication.runId === run.runId && publication.agentId === 'A1' && publication.seq === seq, 'publication identity and sequence');
      check(stamp(publication.generatedMs) && publication.generatedMs > previous
        && publication.generatedMs >= slot && publication.generatedMs < slot + config.periodMs, 'publication schedule slot');
      check(xyz(publication.position, sourcePose(publication.generatedMs)), 'synthetic source position');
      previous = publication.generatedMs;
    }
    // Missing, duplicate or reordered observations remain inspectable. Do not
    // turn a hoped-for delivery outcome into an import precondition.
    check(Array.isArray(run.callbacks) && run.callbacks.length <= 200, 'bounded observed callbacks');
    previous = -1;
    for (const callback of run.callbacks) {
      check(callback && callback.runId === run.runId && callback.agentId === 'A1'
        && Number.isInteger(callback.seq) && callback.seq >= 0 && callback.seq < 20, 'callback identity');
      const publication = run.publications[callback.seq];
      check(callback.generatedMs === publication.generatedMs && xyz(callback.position, publication.position), 'callback references an actual publication');
      check(stamp(callback.callbackMs) && callback.callbackMs > previous && callback.callbackMs >= callback.generatedMs
        && callback.callbackMs >= subscriptionCreated(run) && callback.callbackMs < config.durationMs, 'callback receipt timestamps');
      previous = callback.callbackMs;
    }
  }
  return trace;
}

export function middlewareEvents(run) {
  return [
    ...run.publications.map(data => ({ timeMs: data.generatedMs, kind: 'publication', data })),
    ...run.processEvents.map(data => ({ timeMs: data.timeMs, kind: data.kind, data })),
    ...run.callbacks.map(data => ({ timeMs: data.callbackMs, kind: 'callback', data })),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

/** Both renderers observe this same historical cursor and the last actual receipt. */
export function middlewareFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const publications = run.publications.filter(item => item.generatedMs <= timeMs);
  const callbacks = run.callbacks.filter(item => item.callbackMs <= timeMs);
  const lastCallback = callbacks.at(-1) ?? null;
  const createdMs = subscriptionCreated(run), startMs = subscriptionStart(run);
  return {
    timeMs, sourcePosition: sourcePose(timeMs),
    phase: timeMs < 1000 ? 'early-batch' : timeMs < run.config.resumeMs ? 'quiet'
      : timeMs < run.config.publishEndMs ? 'live-batch' : 'drain',
    readerStatus: timeMs < startMs ? 'waiting' : timeMs < createdMs ? 'creating' : 'listening',
    subscriptionCreatedMs: timeMs >= createdMs ? createdMs : null,
    publications, callbacks, lastCallback,
    position: lastCallback ? [...lastCallback.position] : null,
    generationAgeMs: lastCallback ? timeMs - lastCallback.generatedMs : null,
    receivedCount: callbacks.length,
    historicalCallbacks: callbacks.filter(item => item.generatedMs < startMs),
    liveCallbacks: callbacks.filter(item => item.generatedMs >= startMs),
    cacheCandidates: run.durability === 'transient_local' ? publications.slice(-run.config.depth) : [],
    events: middlewareEvents(run).filter(item => item.timeMs <= timeMs),
  };
}

export function middlewareSummary(run) {
  const startMs = subscriptionStart(run), createdMs = subscriptionCreated(run);
  const historical = run.callbacks.filter(item => item.generatedMs < startMs);
  const live = run.callbacks.filter(item => item.generatedMs >= startMs);
  const received = uniqueSequences(run.callbacks), historicalSequences = uniqueSequences(historical), liveSequences = uniqueSequences(live);
  const expectedHistory = run.durability === 'transient_local'
    ? run.publications.filter(item => item.generatedMs < startMs).slice(-run.config.depth).map(item => item.seq) : [];
  const expectedLive = run.publications.filter(item => item.generatedMs >= startMs).map(item => item.seq);
  const ages = run.callbacks.map(item => item.callbackMs - item.generatedMs);
  const first = run.callbacks[0] ?? null, last = run.callbacks.at(-1) ?? null;
  return {
    rmw: run.rmw, durability: run.durability,
    published: run.publications.length, received: run.callbacks.length, uniqueReceived: received.length,
    duplicates: run.callbacks.length - received.length,
    historicalSequences, liveSequences,
    unobservedSequences: run.publications.filter(item => !received.includes(item.seq)).map(item => item.seq),
    firstCallbackMs: first?.callbackMs ?? null,
    firstHistoricalCallbackMs: historical[0]?.callbackMs ?? null,
    firstLiveCallbackMs: live[0]?.callbackMs ?? null,
    joinToFirstCallbackMs: first ? first.callbackMs - createdMs : null,
    minAgeMs: ages.length ? Math.min(...ages) : null, maxAgeMs: ages.length ? Math.max(...ages) : null,
    expectedHistory, historyMatchesContract: sameSequenceSet(historicalSequences, expectedHistory),
    liveComplete: sameSequenceSet(liveSequences, expectedLive),
    finalPosition: last ? [...last.position] : null,
    finalGenerationAgeMs: last ? run.endMs - last.generatedMs : null,
  };
}
