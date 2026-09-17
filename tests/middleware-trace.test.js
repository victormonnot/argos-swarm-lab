import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  middlewareEvents, middlewareFrame, middlewareSummary, sourcePose, validateMiddlewareTrace,
} from '../src/middleware-trace.js';

// Real process observations supply the evidence; altered copies test import boundaries.
const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-middleware.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(trace);
const runFor = (durability, rmw = 'rmw_fastrtps_cpp', data = trace) => data.cases.find(run => run.durability === durability && run.rmw === rmw);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const joinStart = run => run.processEvents.find(event => event.kind === 'subscription-create-start').timeMs;
const unique = values => [...new Set(values)].sort((a, b) => a - b);
const reject = change => {
  const data = copy();
  change(data);
  assert.throws(() => validateMiddlewareTrace(data), /Invalid middleware trace:/i);
};

test('saved observations validate without mutation and compare four explicit RMW/durability combinations', () => {
  const before = copy();
  assert.equal(validateMiddlewareTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.cases.length, 4);
  for (const rmw of ['rmw_fastrtps_cpp', 'rmw_zenoh_cpp']) {
    for (const durability of ['volatile', 'transient_local']) {
      const run = runFor(durability, rmw);
      assert.ok(run);
      assert.notEqual(run.publisher.pid, run.reader.pid);
      assert.equal(run.publisher.rmw, rmw);
      assert.equal(run.reader.rmw, rmw);
      assert.equal(run.publisher.qosSource, 'requested');
      assert.equal(run.reader.qosSource, 'requested');
      assert.equal(run.publisher.graphQosSource, 'ros-graph');
      assert.equal(run.reader.graphQosSource, 'ros-graph');
      assert.equal(run.publisher.qos.durability, durability);
      assert.deepEqual(run.publisher.qos, run.reader.qos);
      if (rmw === 'rmw_zenoh_cpp') {
        assert.equal(run.router.sessionMode, 'peer');
        assert.equal(run.router.role, 'discovery');
        assert.ok(![run.publisher.pid, run.reader.pid].includes(run.router.pid));
      } else assert.equal(run.router, null);
    }
  }
});

test('graph QoS can report unavailable history without pretending requested depth was measured', () => {
  const data = copy();
  for (const run of data.cases) {
    for (const endpoint of [run.publisher, run.reader]) {
      endpoint.graphQos.history = 'unknown';
      endpoint.graphQos.depth = 0;
    }
  }
  assert.equal(validateMiddlewareTrace(data), data);
  reject(value => { value.cases[0].publisher.graphQos.reliability = 'best_effort'; });
  reject(value => { value.cases[0].reader.qosSource = 'ros-graph'; });
});

test('every callback refers to a published sample rather than an evaluator-only position', () => {
  for (const run of trace.cases) {
    assert.equal(run.publications.length, 20);
    for (const callback of run.callbacks) {
      const publication = run.publications.find(item => item.seq === callback.seq);
      assert.ok(publication);
      assert.equal(callback.runId, run.runId);
      assert.equal(callback.agentId, 'A1');
      assert.equal(callback.generatedMs, publication.generatedMs);
      assert.deepEqual(callback.position, publication.position);
      assert.ok(callback.callbackMs >= callback.generatedMs);
      assert.ok(callback.callbackMs >= run.processEvents.find(item => item.kind === 'subscription-created').timeMs);
    }
  }
});

test('replay events are chronological and never expose future callbacks or subscription completion', () => {
  for (const run of trace.cases) {
    const events = middlewareEvents(run);
    assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, 950, 1500, 3000, 4500, run.endMs]) {
      const frame = middlewareFrame(run, timeMs);
      assert.ok(frame.events.every(event => event.timeMs <= timeMs));
      assert.deepEqual(frame.publications, run.publications.filter(item => item.generatedMs <= timeMs));
      assert.deepEqual(frame.callbacks, run.callbacks.filter(item => item.callbackMs <= timeMs));
      assert.equal(frame.lastCallback, frame.callbacks.at(-1) ?? null);
      assert.equal(frame.receivedCount, frame.callbacks.length);
      if (frame.subscriptionCreatedMs !== null) assert.ok(frame.subscriptionCreatedMs <= timeMs);
    }
  }
});

test('an absent subscription has no invented retained sample even when transient history is available', () => {
  for (const run of trace.cases) {
    const frame = middlewareFrame(run, 1500);
    assert.equal(frame.readerStatus, 'waiting');
    assert.equal(frame.position, null);
    assert.equal(frame.lastCallback, null);
    assert.equal(frame.generationAgeMs, null);
    assert.equal(frame.subscriptionCreatedMs, null);
    assert.equal(frame.receivedCount, 0);
    assert.equal(frame.cacheCandidates.length, run.durability === 'transient_local' ? 5 : 0);
  }
});

test('subscription creation is separate from receiving evidence', () => {
  const run = runFor('transient_local');
  const start = joinStart(run), created = run.processEvents.find(event => event.kind === 'subscription-created').timeMs;
  assert.equal(middlewareFrame(run, start).readerStatus, 'creating');
  assert.equal(middlewareFrame(run, created).readerStatus, 'listening');
  const unheard = { ...run, callbacks: [] };
  const frame = middlewareFrame(unheard, run.endMs);
  assert.equal(frame.readerStatus, 'listening');
  assert.equal(frame.position, null);
  assert.equal(frame.generationAgeMs, null);
});

test('retention candidates represent only the last configured number of past publications', () => {
  for (const run of trace.cases) {
    for (const timeMs of [0, 550, 1500, 3000, 4500, run.endMs]) {
      const frame = middlewareFrame(run, timeMs);
      const expected = run.durability === 'transient_local'
        ? run.publications.filter(item => item.generatedMs <= timeMs).slice(-run.config.depth)
        : [];
      assert.deepEqual(frame.cacheCandidates, expected);
    }
  }
});

test('the held pose is the exact last callback sample and ages between updates without drifting toward truth', () => {
  for (const run of trace.cases) {
    const before = structuredClone(run);
    const last = run.callbacks.at(-1);
    assert.ok(last);
    const timeMs = Math.min(last.callbackMs + 10, run.endMs - 10);
    const first = middlewareFrame(run, timeMs), later = middlewareFrame(run, timeMs + 10);
    assert.deepEqual(first.position, last.position);
    assert.deepEqual(later.position, last.position);
    close(first.generationAgeMs, timeMs - last.generatedMs);
    close(later.generationAgeMs - first.generationAgeMs, 10);
    assert.notDeepEqual(first.sourcePosition, later.sourcePosition);
    later.position[0] += 100;
    later.sourcePosition[0] += 100;
    assert.deepEqual(run, before);
  }
  assert.notEqual(sourcePose(0)[2], sourcePose(500)[2]);
});

test('summaries classify history by generation before subscription creation and count unique sequences separately', () => {
  for (const run of trace.cases) {
    const summary = middlewareSummary(run), boundary = joinStart(run);
    const historical = run.callbacks.filter(item => item.generatedMs < boundary);
    const live = run.callbacks.filter(item => item.generatedMs >= boundary);
    const observed = unique(run.callbacks.map(item => item.seq));
    assert.equal(summary.published, run.publications.length);
    assert.equal(summary.received, run.callbacks.length);
    assert.equal(summary.uniqueReceived, observed.length);
    assert.equal(summary.duplicates, run.callbacks.length - observed.length);
    assert.deepEqual(summary.historicalSequences, unique(historical.map(item => item.seq)));
    assert.deepEqual(summary.liveSequences, unique(live.map(item => item.seq)));
    assert.deepEqual(summary.unobservedSequences, run.publications.filter(item => !observed.includes(item.seq)).map(item => item.seq));
    assert.equal(summary.firstHistoricalCallbackMs, historical[0]?.callbackMs ?? null);
    assert.equal(summary.firstLiveCallbackMs, live[0]?.callbackMs ?? null);
    assert.equal(summary.firstCallbackMs, run.callbacks[0]?.callbackMs ?? null);
    if (run.callbacks.length) {
      close(summary.joinToFirstCallbackMs, run.callbacks[0].callbackMs - run.processEvents.find(item => item.kind === 'subscription-created').timeMs);
      const ages = run.callbacks.map(item => item.callbackMs - item.generatedMs);
      close(summary.minAgeMs, Math.min(...ages));
      close(summary.maxAgeMs, Math.max(...ages));
      assert.deepEqual(summary.finalPosition, run.callbacks.at(-1).position);
      close(summary.finalGenerationAgeMs, run.endMs - run.callbacks.at(-1).generatedMs);
    }
  }
});

test('observed late-join recordings expose finite historical retention and live delivery in both RMWs', () => {
  for (const run of trace.cases) {
    const summary = middlewareSummary(run);
    assert.deepEqual(summary.expectedHistory, run.durability === 'transient_local' ? [5, 6, 7, 8, 9] : []);
    assert.equal(summary.historyMatchesContract, true);
    assert.equal(summary.liveComplete, true);
    assert.equal(summary.historicalSequences.includes(0), false);
    assert.deepEqual(summary.liveSequences, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  }
});

test('missing observations remain valid evidence and do not acquire fabricated history or recovery', () => {
  const data = copy();
  for (const run of data.cases) run.callbacks = [];
  assert.equal(validateMiddlewareTrace(data), data);
  for (const run of data.cases) {
    const summary = middlewareSummary(run), frame = middlewareFrame(run, run.endMs);
    assert.equal(summary.received, 0);
    assert.equal(summary.liveComplete, false);
    assert.equal(summary.firstCallbackMs, null);
    assert.equal(summary.joinToFirstCallbackMs, null);
    assert.equal(summary.minAgeMs, null);
    assert.equal(summary.maxAgeMs, null);
    assert.equal(summary.finalGenerationAgeMs, null);
    assert.deepEqual(summary.unobservedSequences, run.publications.map(item => item.seq));
    assert.equal(frame.position, null);
  }
});

test('duplicate callbacks are counted as callbacks without increasing unique delivery', () => {
  const data = copy(), run = data.cases[0];
  const last = run.callbacks.at(-1);
  run.callbacks.push({ ...structuredClone(last), callbackMs: last.callbackMs + 0.001 });
  assert.equal(validateMiddlewareTrace(data), data);
  const summary = middlewareSummary(run), original = middlewareSummary(trace.cases[0]);
  assert.equal(summary.received, original.received + 1);
  assert.equal(summary.uniqueReceived, original.uniqueReceived);
  assert.equal(summary.duplicates, original.duplicates + 1);
  assert.deepEqual(summary.unobservedSequences, original.unobservedSequences);
});

test('a reordered callback holds the actually received old sample rather than sorting the reader forward', () => {
  const data = copy(), run = data.cases[0];
  const old = run.callbacks[0], last = run.callbacks.at(-1);
  run.callbacks.push({ ...structuredClone(old), callbackMs: last.callbackMs + 0.001 });
  assert.equal(validateMiddlewareTrace(data), data);
  const frame = middlewareFrame(run, run.endMs);
  assert.equal(frame.lastCallback.seq, old.seq);
  assert.deepEqual(frame.position, old.position);
  close(frame.generationAgeMs, run.endMs - old.generatedMs);
});

test('replay rejects invalid cursors rather than silently clipping or accepting numeric strings', () => {
  const run = trace.cases[0];
  for (const timeMs of [-1, NaN, Infinity, '0', run.endMs + 1]) assert.throws(() => middlewareFrame(run, timeMs), RangeError);
});

test('imports reject unsupported headers, duplicate scenarios and invalid runtime provenance', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.kind = 'argos-ros2-restart'; });
  reject(data => { data.runtime.sourceSha256 = 'not-a-hash'; });
  reject(data => { data.runtime.recordedAt = 'not-a-date'; });
  reject(data => { data.runtime.clock = 'unsynchronized-host-clocks'; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[1] = structuredClone(data.cases[0]); });
  reject(data => { data.cases[1].runId = data.cases[0].runId; });
});

test('imports reject mislabeled QoS, timing, process identities and router roles', () => {
  reject(data => { data.cases[0].config.depth = 20; });
  reject(data => { data.cases[0].config.periodMs = 50; });
  reject(data => { data.cases[0].config.joinMs = 0; });
  reject(data => { data.cases[0].publisher.qos.reliability = 'best_effort'; });
  reject(data => { data.cases[0].reader.qos.durability = 'unknown'; });
  reject(data => { data.cases[0].publisher.pid = data.cases[0].reader.pid; });
  reject(data => { data.cases[0].reader.pid = Number.MAX_SAFE_INTEGER + 1; });
  reject(data => { data.cases[0].reader.rmw = 'rmw_unknown'; });
  reject(data => { runFor('volatile', 'rmw_zenoh_cpp', data).router.role = 'payload-broker'; });
});

test('imports reject incomplete publication schedules and samples that contradict the source law', () => {
  reject(data => { data.cases[0].publications.pop(); });
  reject(data => { data.cases[0].publications[0].position[2] += 1; });
  reject(data => { data.cases[0].publications[0].position[0] = NaN; });
  reject(data => { data.cases[0].publications[0].seq = '0'; });
  reject(data => { data.cases[0].publications[0].runId = 'other-run'; });
  reject(data => {
    const run = data.cases[0], publication = run.publications[1];
    publication.generatedMs = 49;
    publication.position = sourcePose(49);
    for (const callback of run.callbacks.filter(item => item.seq === publication.seq)) {
      callback.generatedMs = publication.generatedMs;
      callback.position = [...publication.position];
    }
  });
});

test('imports reject fabricated callback provenance and impossible observation times', () => {
  reject(data => { data.cases[0].callbacks[0].seq = '10'; });
  reject(data => { data.cases[0].callbacks[0].generatedMs += 0.001; });
  reject(data => { data.cases[0].callbacks[0].position[2] += 0.001; });
  reject(data => { data.cases[0].callbacks[0].agentId = 'A2'; });
  reject(data => { data.cases[0].callbacks[0].runId = 'other-run'; });
  reject(data => { data.cases[0].callbacks[0].callbackMs = 100; });
  reject(data => { data.cases[0].callbacks[0].callbackMs = Infinity; });
  reject(data => { const run = data.cases[0]; run.callbacks.at(-1).callbackMs = run.endMs + 1; });
  // The done report may overshoot 6 s, but the reader stops admitting callbacks
  // at the observation deadline, before that finalization time.
  reject(data => { const run = data.cases[0]; run.callbacks.at(-1).callbackMs = run.config.durationMs; });
  reject(data => { const run = data.cases[0]; run.callbacks.at(-1).callbackMs = (run.config.durationMs + run.endMs) / 2; });
  reject(data => { data.cases[0].processEvents[0].timeMs = 1500; });
  reject(data => { data.cases[0].processEvents[1].timeMs = 4500; });
  reject(data => { data.cases[0].processEvents[0].pid += 1000; });
});

test('partial case imports are allowed and display labels are plain external data', () => {
  const data = copy();
  data.cases = [runFor('transient_local', 'rmw_fastrtps_cpp', data)];
  data.cases[0].label = '<img src=x onerror="alert(1)">';
  assert.equal(validateMiddlewareTrace(data), data);
});
