import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DT, SPEED, INSPECTION_SECONDS, TIME_LIMIT, HOME, HOME_HOVER, STATION,
  METHODS, SCENARIOS, TREE_NODES, createRun, stepRun, runToEnd, resetRun,
  evaluateRun, referenceComparisons,
} from '../src/behavior-model.js';

const advance = (run, time) => { while (run.time < time) stepRun(run); return run; };
const finished = (method, scenario) => runToEnd(createRun({ method, scenario }));

test('behavior configuration starts with private action state and a current sample, with evaluator schedule separate', () => {
  const run = createRun();
  assert.deepEqual(run.config, { method: 'bt-reactive', scenario: 'pause' });
  assert.deepEqual(run.agent.position, HOME);
  assert.deepEqual(run.observations, { sampleTime: 0, holdRequested: false, sensorFailed: false });
  assert.deepEqual(run.evaluator.holdWindows, [[7, 10]]);
  assert.equal(run.status, 'ready');
  assert.equal(run.metrics.completionTime, null);
  assert.equal(run.history.length, 1);
  assert.ok(Object.values(run.trace.statuses).every((status) => status === 'Idle'));
  assert.throws(() => createRun({ method: 'BT' }), RangeError);
  assert.throws(() => createRun({ scenario: 'unknown' }), RangeError);
});

test('takeoff and landing change actual altitude while flight preserves the three-metre cruise altitude', () => {
  const run = createRun({ scenario: 'nominal' });
  stepRun(run);
  assert.deepEqual(run.agent.position, [0, 0, SPEED * DT]);
  assert.deepEqual(run.agent.velocity, [0, 0, SPEED]);
  advance(run, 2);
  assert.deepEqual(run.agent.position, HOME_HOVER);
  stepRun(run);
  assert.deepEqual(run.agent.position, [SPEED * DT, 0, 3]);
  advance(run, 6);
  assert.deepEqual(run.agent.position, STATION);
  advance(run, 13);
  assert.deepEqual(run.agent.position, HOME_HOVER);
  stepRun(run);
  assert.deepEqual(run.agent.position, [0, 0, 3 - SPEED * DT]);
  assert.deepEqual(run.agent.velocity, [0, 0, -SPEED]);
  runToEnd(run);
  assert.deepEqual(run.agent.position, HOME);
});

test('every action tick integrates at most one speed-limited interval, including sequence transitions', () => {
  for (const method of Object.keys(METHODS)) for (const scenario of Object.keys(SCENARIOS)) {
    const run = finished(method, scenario);
    let distance = 0;
    for (let index = 1; index < run.history.length; index += 1) {
      const previous = run.history[index - 1], current = run.history[index];
      const elapsed = current.time - previous.time;
      const moved = Math.hypot(...current.position.map((value, axis) => value - previous.position[axis]));
      assert.ok(elapsed === 0 || elapsed === DT);
      assert.ok(moved <= SPEED * elapsed + 1e-12, `${method}/${scenario} exceeds command budget`);
      assert.ok(current.position[2] >= 0 && current.position[2] <= 3);
      assert.ok(current.position[0] >= 0 && current.position[0] <= 6);
      distance += moved;
      if (elapsed === 0) assert.equal(index, run.history.length - 1, 'only terminal observation has no interval');
    }
    assert.equal(distance, run.metrics.distance);
  }
});

test('reactive BT and the global-guard FSM have identical physical histories for every public scenario', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const bt = finished('bt-reactive', scenario), fsm = finished('fsm', scenario);
    assert.deepEqual(bt.history, fsm.history, scenario);
    assert.deepEqual(bt.agent, fsm.agent, scenario);
    assert.deepEqual(bt.metrics, fsm.metrics, scenario);
  }
});

test('the shared global hold policy also matches when preempting takeoff, flight, return or landing', () => {
  for (const start of [1, 4, 7, 10, 14]) {
    const runs = ['bt-reactive', 'fsm'].map((method) => {
      const run = createRun({ method, scenario: 'nominal' });
      run.evaluator.holdWindows = [[start, start + 1]];
      return runToEnd(run);
    });
    assert.deepEqual(runs[0].history, runs[1].history, `hold at ${start}`);
    assert.equal(runs[0].metrics.interruptions, 1);
    assert.equal(runs[0].metrics.holdIgnoredSeconds, 0);
    assert.equal(runs[0].metrics.completed, true);
  }
});

test('nominal execution latches completed actions and observes terminal Success without another physical interval', () => {
  for (const method of Object.keys(METHODS)) {
    const run = finished(method, 'nominal');
    assert.equal(run.time, 15);
    assert.equal(run.step, 61);
    assert.equal(run.metrics.completionTime, 15);
    assert.equal(run.metrics.distance, 18);
    assert.equal(run.agent.inspectionProgress, INSPECTION_SECONDS);
    assert.deepEqual(run.agent.completedActions, ['takeoff', 'fly', 'inspect', 'return', 'land']);
    assert.equal(run.history.at(-2).time, 15);
    assert.deepEqual(run.history.at(-2).position, HOME);
    assert.equal(run.history.at(-2).status, 'running');
    assert.equal(run.status, 'completed');
    if (method !== 'fsm') assert.equal(run.trace.statuses.root, 'Success');
    assert.equal(run.events.filter((entry) => entry.type === 'action-start' && entry.action === 'takeoff').length, 1);
  }
});

test('inputs are sampled before a command interval, with the 7-second hold beginning on tick 29', () => {
  const run = advance(createRun(), 7);
  assert.equal(run.step, 28);
  assert.equal(run.observations.sampleTime, 6.75);
  assert.equal(run.observations.holdRequested, false);
  assert.equal(run.agent.inspectionProgress, 1);
  stepRun(run);
  assert.equal(run.step, 29);
  assert.equal(run.time, 7.25);
  assert.equal(run.observations.sampleTime, 7);
  assert.equal(run.observations.holdRequested, true);
  assert.equal(run.agent.action, 'hold');
  assert.deepEqual(run.agent.position, STATION);
});

test('reactive priority traversal preempts inspection and marks unticked nodes Idle rather than a stale Running', () => {
  const run = advance(createRun(), 7);
  stepRun(run);
  assert.deepEqual(run.trace.visited, ['root', 'safety', 'hold-requested', 'hold']);
  assert.deepEqual(run.trace.halted, ['inspect']);
  assert.equal(run.trace.statuses['hold-requested'], 'Success');
  assert.equal(run.trace.statuses.hold, 'Running');
  assert.equal(run.trace.statuses.inspect, 'Idle');
  assert.equal(run.trace.statuses.mission, 'Idle');
  assert.equal(run.agent.phase, 'inspect');
  assert.equal(run.agent.inspectionProgress, 0);
  assert.equal(run.metrics.discardedInspectionSeconds, 1);
  assert.equal(run.metrics.interruptions, 1);
});

test('the safety sequence reevaluates its condition, releasing Hold at exactly 10 seconds and restarting service', () => {
  const run = advance(createRun(), 10);
  assert.equal(run.agent.action, 'hold');
  assert.equal(run.agent.inspectionProgress, 0);
  assert.equal(run.observations.sampleTime, 9.75);
  stepRun(run);
  assert.equal(run.observations.holdRequested, false);
  assert.equal(run.agent.action, 'inspect');
  assert.equal(run.agent.inspectionProgress, DT);
  assert.equal(run.trace.statuses['hold-requested'], 'Failure');
  assert.deepEqual(run.trace.halted, ['hold']);
  runToEnd(run);
  assert.equal(run.time, 19);
  assert.equal(run.step, 77);
  assert.equal(run.metrics.discardedInspectionSeconds, 1);
  assert.equal(run.metrics.interruptions, 1);
  assert.equal(run.metrics.holdIgnoredSeconds, 0);
});

test('FSM traces expose the same guard and explicit hold entry and resume transitions', () => {
  const run = advance(createRun({ method: 'fsm' }), 7);
  stepRun(run);
  assert.equal(run.trace.statuses['fsm:hold-guard'], 'Success');
  assert.deepEqual(run.trace.transitions, [{ from: 'inspect', to: 'hold', reason: 'Hold requested' }]);
  advance(run, 10);
  stepRun(run);
  assert.equal(run.trace.statuses['fsm:hold-guard'], 'Failure');
  assert.deepEqual(run.trace.transitions, [{ from: 'hold', to: 'inspect', reason: 'Hold released' }]);
});

test('root fallback memory skips the higher-priority guard while the same raw hold observation is available', () => {
  const run = advance(createRun({ method: 'bt-memory' }), 7);
  assert.equal(run.memory.rootChild, 1);
  stepRun(run);
  assert.equal(run.observations.holdRequested, true);
  assert.equal(run.agent.action, 'inspect');
  assert.equal(run.agent.inspectionProgress, 1.25);
  assert.equal(run.trace.statuses['hold-requested'], 'Idle');
  assert.ok(!run.trace.visited.includes('safety'));
  assert.deepEqual(run.trace.halted, []);
  assert.equal(run.metrics.holdIgnoredSeconds, DT);
  runToEnd(run);
  assert.equal(run.time, 15);
  assert.equal(run.metrics.holdIgnoredSeconds, 3);
  assert.equal(run.metrics.discardedInspectionSeconds, 0);
  assert.equal(run.memory.rootChild, 0);
});

test('a persistent hold times out safely in position while the unguarded memory variant finishes with ignored input', () => {
  for (const method of ['bt-reactive', 'fsm']) {
    const run = finished(method, 'persistent-hold');
    assert.equal(run.status, 'timed-out');
    assert.equal(run.time, TIME_LIMIT);
    assert.equal(run.step, 120);
    assert.deepEqual(run.agent.position, STATION);
    assert.equal(run.metrics.distance, 9);
    assert.equal(run.metrics.inspectionCompleted, false);
    assert.equal(run.metrics.completionTime, null);
    assert.equal(run.metrics.holdIgnoredSeconds, 0);
    const held = run.history.filter((frame) => frame.action === 'hold');
    assert.equal(held.length * DT, 23);
    assert.ok(held.every((frame) => JSON.stringify(frame.position) === JSON.stringify(STATION)));
  }
  const memory = finished('bt-memory', 'persistent-hold');
  assert.equal(memory.metrics.completed, true);
  assert.equal(memory.metrics.holdIgnoredSeconds, 8);
  assert.equal(memory.time, 15);
});

test('inspection Failure selects the recovery sequence in the same tick and discards unfinished inspection', () => {
  const run = advance(createRun({ scenario: 'sensor-failure' }), 7);
  assert.equal(run.agent.inspectionProgress, 1);
  stepRun(run);
  assert.equal(run.observations.sensorFailed, true);
  assert.equal(run.trace.statuses.inspect, 'Failure');
  assert.equal(run.trace.statuses.mission, 'Failure');
  assert.equal(run.trace.statuses.abort, 'Running');
  assert.equal(run.trace.statuses['abort-return'], 'Running');
  assert.equal(run.trace.statuses.root, 'Running');
  assert.ok(run.trace.visited.indexOf('inspect') < run.trace.visited.indexOf('abort-return'));
  assert.equal(run.agent.action, 'abort-return');
  assert.equal(run.agent.inspectionProgress, 0);
  assert.equal(run.metrics.discardedInspectionSeconds, 1);
  assert.equal(run.metrics.interruptions, 0);
  assert.deepEqual(run.trace.halted, []);
  assert.deepEqual(run.agent.position, [6 - SPEED * DT, 0, 3]);
  runToEnd(run);
  assert.equal(run.time, 13);
  assert.equal(run.step, 53);
  assert.equal(run.trace.statuses.root, 'Success', 'recovery success is not inspection success');
  assert.equal(run.status, 'aborted');
  assert.equal(run.metrics.completed, false);
  assert.equal(run.metrics.inspectionCompleted, false);
  assert.equal(run.metrics.completionTime, null);
  assert.equal(run.events.filter((entry) => entry.type === 'action-failed').length, 1);
});

test('a failure observed after the full inspection interval cannot undo the completed action latch', () => {
  for (const method of Object.keys(METHODS)) {
    const run = createRun({ method, scenario: 'nominal' });
    run.evaluator.sensorFailureAt = 9;
    runToEnd(run);
    assert.equal(run.metrics.completed, true);
    assert.equal(run.time, 15);
    assert.equal(run.agent.inspectionFailed, false);
    assert.equal(run.metrics.discardedInspectionSeconds, 0);
  }
});

test('every BT visited node has a returned status and every unticked node is Idle', () => {
  for (const method of ['bt-reactive', 'bt-memory']) for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ method, scenario });
    while (!['completed', 'aborted', 'timed-out'].includes(run.status)) {
      stepRun(run);
      assert.equal(new Set(run.trace.visited).size, run.trace.visited.length);
      for (const { id } of TREE_NODES) {
        if (run.trace.visited.includes(id)) assert.ok(['Success', 'Failure', 'Running'].includes(run.trace.statuses[id]));
        else assert.equal(run.trace.statuses[id], 'Idle');
      }
      assert.ok(run.trace.visited.length > 0);
      assert.equal(run.trace.visited[0], 'root');
    }
  }
});

test('terminal steps are stable and reset replays the exact configured experiment without aliasing state', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const run = finished('bt-reactive', scenario);
    const before = structuredClone(run);
    assert.equal(stepRun(run), run);
    assert.deepEqual(run, before);
    const reset = resetRun(run);
    assert.equal(reset.time, 0);
    assert.deepEqual(runToEnd(reset), run);
    assert.notEqual(reset.agent.position, run.agent.position);
    assert.deepEqual(evaluateRun(run), run.metrics);
  }
});

test('reference comparisons contain all twelve equal-configuration method cases and no shared mutable runs', () => {
  const first = referenceComparisons();
  assert.equal(first.length, 12);
  assert.equal(new Set(first.map((row) => row.id)).size, 12);
  for (const row of first) {
    assert.deepEqual(row.metrics, finished(row.method, row.scenario).metrics);
    assert.deepEqual(row.final.position, row.metrics.timedOut ? STATION : HOME);
  }
  first[0].metrics.distance = -1;
  first[0].final.position[0] = 999;
  const second = referenceComparisons();
  assert.equal(second[0].metrics.distance, 18);
  assert.deepEqual(second[0].final.position, HOME);
});
