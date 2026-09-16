import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  admitHeartbeat, restartEvents, restartFrame, restartSummary, sourcePose, validateRestartTrace,
} from '../src/restart-trace.js';

// These are observations from real ROS processes, not synthesized transport outcomes.
const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-restart.json', import.meta.url), 'utf8'));
const runFor = (id, data = trace) => data.cases.find(run => run.id === id);
const policyFor = (frame, id) => frame.policies.find(policy => policy.id === id);
const copy = () => structuredClone(trace);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const reject = change => {
  const data = copy();
  change(data);
  assert.throws(() => validateRestartTrace(data), /Invalid restart trace:/i);
};

test('admission accepts initial evidence and increasing sequences within one incarnation', () => {
  for (const id of ['sequence', 'incarnation']) {
    assert.equal(admitHeartbeat(null, { epoch: 1, seq: 0 }, id).accepted, true);
    assert.equal(admitHeartbeat({ epoch: 1, seq: 5 }, { epoch: 1, seq: 6 }, id).accepted, true);
  }
});

test('duplicate and reordered sequences do not count as fresh progress in either policy', () => {
  for (const id of ['sequence', 'incarnation']) {
    for (const seq of [0, 4, 5]) {
      assert.equal(admitHeartbeat({ epoch: 1, seq: 5 }, { epoch: 1, seq }, id).accepted, false);
    }
  }
});

test('a new incarnation can reset its sequence while the sequence-only policy waits for its old maximum', () => {
  const previous = { epoch: 1, seq: 19 };
  assert.equal(admitHeartbeat(previous, { epoch: 2, seq: 0 }, 'incarnation').accepted, true);
  assert.equal(admitHeartbeat(previous, { epoch: 2, seq: 0 }, 'sequence').accepted, false);
  assert.equal(admitHeartbeat(previous, { epoch: 2, seq: 19 }, 'sequence').accepted, false);
  assert.equal(admitHeartbeat(previous, { epoch: 2, seq: 20 }, 'sequence').accepted, true);
});

test('an old incarnation cannot overwrite current state even with a much larger sequence', () => {
  const previous = { epoch: 2, seq: 3 }, delayed = { epoch: 1, seq: 999 };
  assert.equal(admitHeartbeat(previous, delayed, 'incarnation').accepted, false);
  assert.equal(admitHeartbeat(previous, delayed, 'sequence').accepted, true);
  assert.deepEqual(previous, { epoch: 2, seq: 3 });
  assert.deepEqual(delayed, { epoch: 1, seq: 999 });
});

test('saved observations validate without mutation and identify independent observer and agent processes', () => {
  const before = copy();
  assert.equal(validateRestartTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.deepEqual(trace.cases.map(run => run.id).sort(), ['normal', 'restart', 'silence']);
  for (const run of trace.cases) {
    const identities = [run.observer, run.collector, ...run.agents];
    assert.equal(new Set(identities.map(item => item.pid)).size, identities.length);
    assert.equal(new Set(identities.map(item => item.node)).size, 3);
    assert.ok(run.agents.every(agent => agent.node === run.agents[0].node));
    assert.equal(run.agents.length, run.id === 'restart' ? 2 : 1);
  }
});

test('both policies consume the same actual callback with an identifiable source publication', () => {
  for (const run of trace.cases) {
    const last = { sequence: null, incarnation: null };
    for (const callback of run.callbacks) {
      const publication = run.publications.find(item => item.epoch === callback.epoch && item.seq === callback.seq);
      assert.ok(publication);
      assert.equal(callback.runId, run.runId);
      assert.equal(callback.generatedMs, publication.generatedMs);
      assert.deepEqual(callback.position, publication.position);
      assert.ok(callback.callbackMs >= callback.generatedMs);
      for (const id of ['sequence', 'incarnation']) {
        assert.deepEqual(callback.decisions[id], admitHeartbeat(last[id], callback, id));
        if (callback.decisions[id].accepted) last[id] = callback;
      }
    }
  }
});

test('historical replay exposes only publications, callbacks and transitions already observed', () => {
  for (const run of trace.cases) {
    const events = restartEvents(run);
    assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, 700, 2200, 4000, run.endMs]) {
      const frame = restartFrame(run, timeMs);
      assert.ok(frame.events.every(event => event.timeMs <= timeMs));
      assert.deepEqual(frame.callbacks, run.callbacks.filter(item => item.callbackMs <= timeMs));
      assert.deepEqual(frame.transitions, run.transitions.filter(item => item.timeMs <= timeMs));
      assert.equal(frame.lastCallback, frame.callbacks.at(-1) ?? null);
      assert.equal(frame.publication, run.publications.filter(item => item.generatedMs <= timeMs).at(-1) ?? null);
      for (const policy of frame.policies) {
        assert.equal(policy.received, frame.callbacks.length);
        assert.equal(policy.accepted + policy.rejected, policy.received);
      }
    }
  }
});

test('before evidence every policy awaits a heartbeat and has no invented position or age', () => {
  const run = runFor('normal'), frame = restartFrame(run, 0);
  for (const policy of frame.policies) {
    assert.equal(policy.status, 'awaiting');
    assert.equal(policy.position, null);
    assert.equal(policy.lastAccepted, null);
    assert.equal(policy.receiptAgeMs, null);
    assert.equal(policy.generationAgeMs, null);
    assert.equal(policy.positionError, null);
  }
  // A replay of a listener which has not heard anything must not infer a crash.
  const unheard = { ...run, callbacks: [], transitions: [] };
  for (const policy of restartFrame(unheard, 1000).policies) assert.equal(policy.status, 'awaiting');
});

test('continuous heartbeat observations produce no suspicion and both policies accept progress', () => {
  const run = runFor('normal');
  assert.ok(run.callbacks.length > 40);
  assert.equal(run.processEvents.length, 0);
  assert.equal(run.transitions.some(item => item.status === 'suspect'), false);
  for (const policy of restartFrame(run, run.endMs).policies) {
    assert.equal(policy.status, 'live');
    assert.equal(policy.rejected, 0);
    assert.equal(policy.accepted, run.callbacks.length);
  }
});

test('a silent publisher is suspected despite retaining its original process and incarnation', () => {
  const run = runFor('silence');
  const start = run.processEvents.find(item => item.kind === 'silence-start');
  const end = run.processEvents.find(item => item.kind === 'silence-end');
  assert.equal(start.pid, end.pid);
  assert.equal(start.epoch, end.epoch);
  assert.equal(run.publications.some(item => item.generatedMs >= start.timeMs && item.generatedMs < end.timeMs), false);
  const frame = restartFrame(run, (start.timeMs + end.timeMs) / 2);
  assert.equal(frame.process.status, 'silent');
  assert.equal(frame.process.pid, start.pid);
  for (const policy of frame.policies) assert.equal(policy.status, 'suspect');
  const returning = run.callbacks.find(item => item.callbackMs >= end.timeMs);
  const recovered = restartFrame(run, returning.callbackMs);
  for (const policy of recovered.policies) {
    assert.equal(policy.status, 'live');
    assert.equal(policy.lastAccepted, returning);
  }
});

test('real process replacement resets sequence and only incarnation admission accepts its first heartbeat', () => {
  const run = runFor('restart'), returning = run.callbacks.find(item => item.epoch === 2);
  const exited = run.processEvents.find(item => item.kind === 'exited');
  const spawned = run.processEvents.find(item => item.kind === 'spawned');
  assert.equal(exited.exitCode, -9);
  assert.notEqual(exited.pid, spawned.pid);
  assert.equal(restartFrame(run, (exited.timeMs + spawned.timeMs) / 2).process.status, 'stopped');
  assert.equal(returning.seq, 0);
  const frame = restartFrame(run, returning.callbackMs);
  const sequence = policyFor(frame, 'sequence'), incarnation = policyFor(frame, 'incarnation');
  assert.equal(sequence.lastCallback, returning);
  assert.equal(sequence.lastDecision.accepted, false);
  assert.equal(sequence.status, 'suspect');
  assert.equal(sequence.lastAccepted.epoch, 1);
  assert.equal(incarnation.lastAccepted, returning);
  assert.equal(incarnation.status, 'live');
  assert.equal(incarnation.epoch, 2);
  assert.ok(sequence.receiptAgeMs > run.config.timeoutMs);
  assert.equal(incarnation.receiptAgeMs, 0);
});

test('watchdog suspicions are recorded no earlier than the deadline of the last accepted receipt', () => {
  for (const run of trace.cases) {
    for (const transition of run.transitions.filter(item => item.status === 'suspect')) {
      const last = run.callbacks.filter(item => item.callbackMs <= transition.timeMs && item.decisions[transition.policy].accepted).at(-1);
      assert.ok(last);
      assert.ok(transition.timeMs - last.callbackMs >= run.config.timeoutMs);
      const before = policyFor(restartFrame(run, transition.timeMs - 0.0001), transition.policy);
      const after = policyFor(restartFrame(run, transition.timeMs), transition.policy);
      assert.equal(before.status, 'live');
      assert.equal(after.status, 'suspect');
      assert.equal(after.lastAccepted, last);
      close(after.receiptAgeMs, transition.timeMs - last.callbackMs);
    }
  }
});

test('summary recovery delays measure acceptance rather than raw receipt or process spawning', () => {
  for (const run of trace.cases) {
    for (const result of restartSummary(run)) {
      const accepted = run.callbacks.filter(item => item.decisions[result.id].accepted);
      assert.equal(result.received, run.callbacks.length);
      assert.equal(result.accepted, accepted.length);
      assert.equal(result.rejected, run.callbacks.length - accepted.length);
      assert.equal(result.finalStatus, policyFor(restartFrame(run, run.endMs), result.id).status);
      if (result.returnCallback && result.firstAcceptedAfterReturn) {
        close(result.returnToAcceptanceMs, result.firstAcceptedAfterReturn.callbackMs - result.returnCallback.callbackMs);
        assert.ok(result.firstAcceptedAfterReturn.decisions[result.id].accepted);
      }
      if (run.id === 'normal') {
        assert.equal(result.firstSuspicionMs, null);
        assert.equal(result.returnCallback, null);
      }
    }
  }
  const recovered = restartSummary(runFor('restart'));
  assert.equal(recovered.find(item => item.id === 'incarnation').returnToAcceptanceMs, 0);
  assert.ok(recovered.find(item => item.id === 'sequence').returnToAcceptanceMs > 0);
});

test('retained geometry holds exact accepted samples as age grows, and frame positions do not mutate evidence', () => {
  const run = runFor('silence'), before = structuredClone(run);
  const first = restartFrame(run, 2100), later = restartFrame(run, 2200);
  assert.notDeepEqual(first.sourcePosition, later.sourcePosition);
  for (const policy of later.policies) {
    const previous = policyFor(first, policy.id);
    assert.deepEqual(policy.position, previous.position);
    assert.deepEqual(policy.position, policy.lastAccepted.position);
    close(policy.receiptAgeMs - previous.receiptAgeMs, 100);
    close(policy.generationAgeMs - previous.generationAgeMs, 100);
    close(policy.positionError, Math.hypot(...policy.position.map((value, axis) => value - later.sourcePosition[axis])));
    policy.position[0] += 100;
  }
  later.sourcePosition[0] += 100;
  assert.deepEqual(run, before);
  assert.notEqual(sourcePose(0)[2], sourcePose(500)[2]);
  for (const timeMs of [-1, NaN, Infinity, '0', run.endMs + 1]) assert.throws(() => restartFrame(run, timeMs), RangeError);
});

test('imports reject unsupported headers, duplicate identities and unsafe process IDs', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.runtime.sourceSha256 = 'not-a-hash'; });
  reject(data => { data.runtime.recordedAt = 'not-a-date'; });
  reject(data => { data.cases[1].runId = data.cases[0].runId; });
  reject(data => { data.cases[1].id = data.cases[0].id; });
  reject(data => { data.cases[0].agents[0].pid = data.cases[0].observer.pid; });
  reject(data => { data.cases[0].observer.pid = Number.MAX_SAFE_INTEGER + 1; });
  reject(data => { data.cases[0].observer.node = data.cases[0].collector.node; });
});

test('imports reject wrong-run messages, unknown incarnations and forged sample provenance', () => {
  reject(data => { data.cases[0].callbacks[0].runId = 'unrelated-run'; });
  reject(data => { data.cases[0].publications[0].agentId = 'A2'; });
  reject(data => { data.cases[0].callbacks[0].epoch = 2; });
  reject(data => { data.cases[0].callbacks[0].epoch = '1'; });
  reject(data => { data.cases[0].callbacks[0].seq = '0'; });
  reject(data => { data.cases[0].callbacks[0].generatedMs += 0.001; });
  reject(data => { data.cases[0].callbacks[0].position[2] += 0.001; });
  reject(data => { data.cases[0].publications[0].position[0] += 1; });
});

test('imports reject impossible timestamps and forged admission decisions', () => {
  reject(data => { const callback = data.cases[0].callbacks[0]; callback.callbackMs = callback.generatedMs - 1; });
  reject(data => { data.cases[0].callbacks[1].callbackMs = data.cases[0].callbacks[0].callbackMs; });
  reject(data => { data.cases[0].callbacks[0].callbackMs = Infinity; });
  reject(data => { data.cases[0].publications[0].position[1] = NaN; });
  reject(data => {
    const callback = runFor('restart', data).callbacks.find(item => item.epoch === 2);
    callback.decisions.sequence = { accepted: true, reason: 'new-sequence' };
  });
});

test('imports reject early suspicions and recovery transitions unsupported by accepted callbacks', () => {
  reject(data => {
    const run = runFor('silence', data), transition = run.transitions.find(item => item.status === 'suspect');
    const last = run.callbacks.filter(item => item.callbackMs < transition.timeMs).at(-1);
    transition.timeMs = last.callbackMs + run.config.timeoutMs - 1;
  });
  reject(data => { runFor('silence', data).transitions.find(item => item.reason === 'accepted-after-suspicion').timeMs += 1; });
  reject(data => { data.cases[0].transitions[0].policy = 'unknown'; });
  reject(data => { data.cases[0].transitions.splice(0, 1); });
});

test('imports reject fabricated process replacement and malformed lifecycle evidence', () => {
  reject(data => { const run = runFor('restart', data); run.agents[1].pid = run.agents[0].pid; });
  reject(data => { runFor('restart', data).processEvents.find(item => item.kind === 'exited').exitCode = 0; });
  reject(data => { runFor('restart', data).processEvents.find(item => item.kind === 'spawned').epoch = 1; });
  reject(data => { runFor('silence', data).processEvents.find(item => item.kind === 'silence-end').pid += 100; });
});

test('imports enforce the declared timing and completeness bounds while treating labels as plain data', () => {
  reject(data => { data.cases = []; });
  reject(data => { data.cases[0].callbacks = []; });
  reject(data => { data.cases[0].config.timeoutMs = 0; });
  reject(data => { data.cases[0].config.heartbeatPeriodMs = 1; });
  reject(data => { data.runtime.clock = 'unrelated-host-clocks'; });
  reject(data => { data.runtime.heartbeatQos.reliability = 'best_effort'; });
  reject(data => { data.cases[0].outcome.status = 'timeout'; });
  reject(data => { data.cases[0].endMs = Infinity; });
  reject(data => {
    const run = runFor('normal', data);
    run.publications = run.publications.slice(0, 1);
    run.callbacks = run.callbacks.filter(item => item.seq === 0);
    run.transitions = run.transitions.filter(item => item.reason === 'first-message');
  });
  reject(data => {
    const run = runFor('normal', data), publication = run.publications[1];
    // Matching payload references alone must not permit a second publication in slot zero.
    publication.generatedMs = 49;
    publication.position = sourcePose(publication.generatedMs);
    for (const callback of run.callbacks.filter(item => item.epoch === publication.epoch && item.seq === publication.seq)) {
      callback.generatedMs = publication.generatedMs;
      callback.position = [...publication.position];
    }
  });
  const labeled = copy();
  labeled.cases[0].label = '<img src=x onerror="alert(1)">';
  assert.equal(validateRestartTrace(labeled), labeled);
});
