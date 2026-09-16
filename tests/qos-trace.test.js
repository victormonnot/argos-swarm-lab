import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { qosEvents, qosFrame, qosSummary, sourcePose, validateQosTrace } from '../src/qos-trace.js';

// Assertions use the saved observations from real processes, not a simulated DDS queue.
const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-qos.json', import.meta.url), 'utf8'));
const nominal = data => data.cases.find(run => run.config.pauseStartMs === null);
const paused = data => data.cases.find(run => run.config.pauseStartMs !== null);
const profile = (run, id) => run.readers.find(reader => reader.id === id);
const copy = () => structuredClone(trace);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const reject = change => {
  const data = copy();
  change(data);
  assert.throws(() => validateQosTrace(data), /Invalid QoS trace:/);
};

test('saved recordings validate without mutation and identify five distinct real processes in each run', () => {
  const before = copy();
  assert.equal(validateQosTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.ok(nominal(trace) && paused(trace));
  assert.equal(trace.runtime.clock, 'shared-host-monotonic');
  for (const run of trace.cases) {
    const processes = [run.publisher, run.collector, ...run.readers];
    assert.equal(new Set(processes.map(item => item.pid)).size, 5);
    assert.equal(new Set(processes.map(item => item.node)).size, 5);
    assert.deepEqual(run.readers.map(reader => reader.id).sort(), ['gated20', 'history20', 'latest1']);
  }
});

test('the synthetic source law uses actual generation timestamps, with genuinely varying altitude', () => {
  assert.deepEqual(sourcePose(0), [3, 0, 1.5]);
  const quarterTurn = sourcePose(Math.PI * 500);
  close(quarterTurn[0], 0);
  close(quarterTurn[1], 2);
  close(quarterTurn[2], 1.5);
  close(sourcePose(Math.PI * 250)[2], 1.9);
  for (const run of trace.cases) {
    for (const publication of run.publications) {
      const seconds = publication.generatedMs / 1000;
      publication.position.forEach((value, axis) => close(value, [3 * Math.cos(seconds), 2 * Math.sin(seconds), 1.5 + 0.4 * Math.sin(2 * seconds)][axis]));
    }
  }
});

test('callbacks retain their actual publication, run, sequence, generation time and measured age', () => {
  for (const run of trace.cases) {
    for (const reader of run.readers) {
      let previousSeq = -1;
      for (const callback of reader.callbacks) {
        const publication = run.publications[callback.seq];
        assert.equal(callback.runId, run.runId);
        assert.ok(callback.seq > previousSeq);
        assert.equal(callback.generatedMs, publication.generatedMs);
        assert.deepEqual(callback.position, publication.position);
        close(callback.ageMs, callback.callbackMs - publication.generatedMs, 1e-6);
        assert.equal(callback.accepted, reader.ageLimitMs === null || callback.ageMs <= reader.ageLimitMs);
        assert.equal(callback.reason, callback.accepted ? 'accepted' : 'stale');
        previousSeq = callback.seq;
      }
    }
  }
});

test('publisher observations continue while each reader executor is paused, with no callbacks in its pause', () => {
  const run = paused(trace);
  assert.equal(run.config.publishPeriodMs, 50);
  assert.equal(run.config.readerPeriodMs, 50);
  assert.equal(run.config.readerPhaseMs, 25);
  for (const reader of run.readers) {
    const [pause] = reader.pauses;
    assert.ok(pause.startMs >= run.config.pauseStartMs);
    assert.ok(pause.endMs >= run.config.pauseEndMs);
    assert.ok(run.publications.filter(item => item.generatedMs >= pause.startMs && item.generatedMs < pause.endMs).length > 5);
    assert.equal(reader.callbacks.some(item => item.callbackMs >= pause.startMs && item.callbackMs < pause.endMs), false);
    assert.ok(reader.callbacks.some(item => item.callbackMs < pause.startMs));
    assert.ok(reader.callbacks.some(item => item.callbackMs >= pause.endMs));
  }
});

test('event order follows the shared host timestamps without inventing receive times for absent sequences', () => {
  for (const run of trace.cases) {
    const events = qosEvents(run);
    assert.equal(events.length, run.publications.length + run.readers.reduce((sum, reader) => sum + reader.callbacks.length + 2 * reader.pauses.length, 0));
    assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
    for (const reader of run.readers) {
      assert.deepEqual(events.filter(event => event.kind === 'callback' && event.readerId === reader.id).map(event => event.data), reader.callbacks);
    }
  }
});

test('a historical cursor exposes only observed callbacks, publications and events', () => {
  const run = paused(trace);
  for (const timeMs of [0, 275, run.config.pauseStartMs + 200, run.endMs]) {
    const frame = qosFrame(run, timeMs);
    assert.ok(frame.events.every(event => event.timeMs <= timeMs));
    assert.equal(frame.publication, run.publications.filter(item => item.generatedMs <= timeMs).at(-1) ?? null);
    for (const reader of frame.readers) {
      const expected = profile(run, reader.id).callbacks.filter(item => item.callbackMs <= timeMs);
      assert.deepEqual(reader.callbacks, expected);
      assert.equal(reader.received, expected.length);
      assert.equal(reader.lastCallback, expected.at(-1) ?? null);
      assert.equal(reader.unobserved, run.publications.filter(item => item.generatedMs <= timeMs).length - expected.length);
    }
  }
});

test('each reader holds its last accepted measured pose exactly while evaluator truth keeps moving', () => {
  const run = paused(trace), timeMs = run.config.pauseStartMs + 200;
  const frame = qosFrame(run, timeMs);
  for (const reader of frame.readers) {
    const last = profile(run, reader.id).callbacks.filter(item => item.callbackMs <= timeMs && item.accepted).at(-1);
    assert.ok(last);
    assert.deepEqual(reader.position, last.position);
    assert.notDeepEqual(reader.position, frame.sourcePosition);
    close(reader.ageMs, timeMs - last.generatedMs);
    close(reader.positionError, Math.hypot(...last.position.map((value, axis) => value - frame.sourcePosition[axis])));
    assert.equal(reader.fresh, reader.ageMs <= run.config.ageLimitMs);
    assert.equal(reader.paused, true);
  }
});

test('information age grows without callbacks, including after the publisher has stopped', () => {
  const run = paused(trace), firstTime = run.config.pauseStartMs + 200, secondTime = firstTime + 100;
  const first = qosFrame(run, firstTime), second = qosFrame(run, secondTime);
  for (const reader of second.readers) {
    const before = profile(first, reader.id);
    assert.equal(reader.received, before.received);
    assert.deepEqual(reader.position, before.position);
    close(reader.ageMs - before.ageMs, 100);
  }
  for (const reader of qosFrame(run, run.endMs).readers) {
    assert.ok(reader.ageMs > run.config.ageLimitMs);
    assert.equal(reader.fresh, false);
    assert.equal(reader.ageMs, run.endMs - reader.lastAccepted.generatedMs);
  }
});

test('a rejected stale callback increments observations but does not refresh the gated reader state', () => {
  const run = paused(trace), reader = profile(run, 'gated20');
  const rejection = reader.callbacks.find(item => !item.accepted);
  assert.ok(rejection, 'the saved intentional pause actually produces an age rejection');
  const before = profile(qosFrame(run, rejection.callbackMs - 0.0001), reader.id);
  const after = profile(qosFrame(run, rejection.callbackMs), reader.id);
  assert.equal(after.lastCallback, rejection);
  assert.equal(after.received, before.received + 1);
  assert.equal(after.rejected, before.rejected + 1);
  assert.equal(after.accepted, before.accepted);
  assert.deepEqual(after.position, before.position);
  assert.equal(after.lastAccepted, before.lastAccepted);
  close(after.ageMs - before.ageMs, 0.0001, 1e-6);
});

test('the saved nominal and stalled observations support a bounded queue-versus-freshness comparison', () => {
  const normalRun = nominal(trace), stalledRun = paused(trace);
  for (const reader of normalRun.readers) {
    assert.equal(reader.callbacks.some(item => !item.accepted), false);
    assert.ok(reader.callbacks.length > 0);
  }
  const history = profile(stalledRun, 'history20'), latest = profile(stalledRun, 'latest1');
  const firstHistory = history.callbacks.find(item => item.callbackMs >= history.pauses[0].endMs);
  const firstLatest = latest.callbacks.find(item => item.callbackMs >= latest.pauses[0].endMs);
  assert.ok(firstHistory.ageMs > stalledRun.config.ageLimitMs);
  assert.ok(firstLatest.ageMs <= stalledRun.config.ageLimitMs);
  assert.ok(firstLatest.seq > firstHistory.seq);
  assert.ok(latest.callbacks.length < history.callbacks.length);
  assert.ok(history.callbacks.every(item => item.accepted), 'accepting old observations is distinct from receiving them');
});

test('summary denominators count observed callbacks and explicitly unobserved publications', () => {
  for (const run of trace.cases) {
    for (const result of qosSummary(run)) {
      const reader = profile(run, result.id), callbacks = reader.callbacks;
      assert.equal(result.received, callbacks.length);
      assert.equal(result.accepted + result.rejected, result.received);
      assert.equal(result.unobserved + result.received, run.publications.length);
      assert.equal(result.freshCallbacks, callbacks.filter(item => item.ageMs <= run.config.ageLimitMs).length);
      close(result.maxCallbackAgeMs, Math.max(...callbacks.map(item => item.ageMs)));
      close(result.meanCallbackAgeMs, callbacks.reduce((sum, item) => sum + item.ageMs, 0) / callbacks.length);
      assert.equal(result.firstAfterPause, reader.pauses.length ? callbacks.find(item => item.callbackMs >= reader.pauses[0].endMs) : null);
    }
  }
});

test('replay poses cannot mutate recorded evidence and invalid cursor values are rejected', () => {
  const run = nominal(trace), before = structuredClone(run), frame = qosFrame(run, run.endMs);
  for (const reader of frame.readers) reader.position[0] += 100;
  frame.sourcePosition[0] += 100;
  assert.deepEqual(run, before);
  for (const timeMs of [-1, NaN, Infinity, '0', run.endMs + 1]) assert.throws(() => qosFrame(run, timeMs), RangeError);
});

test('imports reject wrong-run envelopes and duplicated or out-of-order message sequences', () => {
  reject(data => { data.cases[0].publications[0].runId = 'another-run'; });
  reject(data => { data.cases[0].readers[0].callbacks[0].runId = 'another-run'; });
  reject(data => { const callbacks = data.cases[0].readers[0].callbacks; callbacks.splice(1, 0, structuredClone(callbacks[0])); });
  reject(data => { data.cases[0].publications[1].seq = 0; });
});

test('imports reject stale or tampered message references even if the position remains plausible', () => {
  reject(data => { data.cases[0].readers[0].callbacks[1].generatedMs = data.cases[0].publications[0].generatedMs; });
  reject(data => { data.cases[0].readers[0].callbacks[0].position[0] += 0.001; });
  reject(data => { data.cases[0].publications[0].position[2] += 0.001; });
});

test('imports reject impossible timestamp relationships, forged ages and age decisions', () => {
  reject(data => { const callback = data.cases[0].readers[0].callbacks[0]; callback.callbackMs = callback.generatedMs - 1; });
  reject(data => { const callbacks = data.cases[0].readers[0].callbacks; callbacks[1].callbackMs = callbacks[0].callbackMs; });
  reject(data => { data.cases[0].readers[0].callbacks[0].ageMs += 1; });
  reject(data => { const callback = profile(paused(data), 'gated20').callbacks.find(item => !item.accepted); callback.accepted = true; callback.reason = 'accepted'; });
  reject(data => { data.cases[0].readers[0].callbacks[0].reason = 'stale'; });
  // Valid increasing timestamps alone do not enforce the declared service slots.
  reject(data => {
    const callbacks = profile(nominal(data), 'history20').callbacks;
    for (const [index, timeMs] of [80, 81].entries()) {
      callbacks[index].callbackMs = timeMs;
      callbacks[index].ageMs = timeMs - callbacks[index].generatedMs;
    }
  });
  reject(data => {
    const callback = profile(nominal(data), 'history20').callbacks[0];
    callback.callbackMs = 20;
    callback.ageMs = callback.callbackMs - callback.generatedMs;
  });
  for (const generationTime of [49, 100]) {
    reject(data => {
      const run = nominal(data), publication = run.publications[1];
      publication.generatedMs = generationTime;
      publication.position = sourcePose(generationTime);
      for (const reader of run.readers) {
        const callback = reader.callbacks.find(item => item.seq === publication.seq);
        callback.generatedMs = generationTime;
        callback.position = [...publication.position];
        if (generationTime === 100) callback.callbackMs = 110;
        callback.ageMs = callback.callbackMs - generationTime;
      }
    });
  }
});

test('imports reject callbacks inside an actual recorded executor pause', () => {
  reject(data => {
    const run = paused(data), reader = run.readers[0];
    const callback = reader.callbacks.find(item => item.callbackMs >= reader.pauses[0].endMs);
    callback.callbackMs = reader.pauses[0].startMs + 1;
    callback.ageMs = callback.callbackMs - callback.generatedMs;
  });
});

test('imports reject nonfinite positions, ages and unbounded timestamps', () => {
  reject(data => { data.cases[0].publications[0].position[0] = NaN; });
  reject(data => { data.cases[0].readers[0].callbacks[0].ageMs = Infinity; });
  reject(data => { data.cases[0].readers[0].callbacks[0].callbackMs = 60_001; });
  reject(data => { data.cases[0].endMs = Infinity; });
});

test('imports reject unknown or duplicated profiles and altered reader policies', () => {
  reject(data => { data.cases[0].readers[0].id = '__proto__'; });
  reject(data => { data.cases[0].readers[1].id = data.cases[0].readers[0].id; });
  reject(data => { profile(data.cases[0], 'latest1').depth = 20; });
  reject(data => { profile(data.cases[0], 'gated20').ageLimitMs = null; });
});

test('imports reject duplicate identities, unsafe PIDs and unsupported clock or timing contracts', () => {
  reject(data => { data.cases[1].runId = data.cases[0].runId; });
  reject(data => { data.cases[1].id = data.cases[0].id; });
  reject(data => { data.cases[0].publisher.pid = data.cases[0].collector.pid; });
  reject(data => { data.cases[0].readers[0].pid = Number.MAX_SAFE_INTEGER + 1; });
  reject(data => { data.cases[0].readers[0].node = data.cases[0].publisher.node; });
  reject(data => { data.runtime.clock = 'unsynchronized-hosts'; });
  reject(data => { data.cases[0].config.readerPeriodMs = 1; });
  reject(data => { data.runtime.publisherQos.reliability = 'best_effort'; });
});

test('imports require bounded valid headers and complete observations, not authenticated metadata', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.runtime.sourceSha256 = 'not-a-source-hash'; });
  reject(data => { data.runtime.recordedAt = 'not-a-date'; });
  reject(data => { data.cases[0].label = 'x'.repeat(241); });
  reject(data => { data.cases[0].runId = 'x'.repeat(101); });
  reject(data => { data.cases[0].outcome.status = 'timeout'; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[0].publications = Array.from({ length: 1001 }, () => structuredClone(data.cases[0].publications[0])); });
  reject(data => {
    const run = nominal(data);
    run.publications = run.publications.slice(0, 1);
    for (const reader of run.readers) reader.callbacks = reader.callbacks.filter(callback => callback.seq === 0);
  });
  const labeled = copy();
  labeled.cases[0].label = '<img src=x onerror="alert(1)">';
  assert.equal(validateQosTrace(labeled), labeled, 'labels are data; rendering must use text nodes');
});
