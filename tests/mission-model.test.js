import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSION_DT, MISSION_SPEED, SERVICE_STEPS, POLICIES, createMissionRun, stepMission, finishMission, resetMission, allocatorObservation, executorObservation, compareMissions, missionDistance } from '../src/mission-model.js';

function advance(run, count) { for (let i = 0; i < count; i += 1) run = stepMission(run); return run; }

test('the initial dispatch assigns targets, while arrival and service are separate', () => {
  let run = createMissionRun();
  assert.equal(run.tasks[0].state, 'assigned');
  assert.equal(run.history[0].completed, 0);
  run = advance(run, 8);
  assert.equal(run.agents[0].state, 'servicing');
  assert.deepEqual(run.agents[0].position, [0.8, 0]);
  assert.equal(run.tasks[0].serviceRemaining, SERVICE_STEPS);
  assert.equal(run.history.at(-1).completed, 0);
  run = advance(run, 19);
  assert.equal(run.tasks[0].state, 'servicing');
  assert.equal(run.tasks[0].serviceRemaining, 1);
  run = stepMission(run);
  assert.equal(run.tasks[0].state, 'completed');
  assert.equal(run.tasks[0].completedAt, 28);
  assert.equal(run.tasks[0].completedBy, 0);
  assert.equal(run.tasks[0].owner, null);
});

test('matching policies change the initial pairs without changing starts or future knowledge', () => {
  const greedy = createMissionRun(), hungarian = createMissionRun({ policy: 'hungarian' });
  assert.deepEqual(greedy.history[0].positions, hungarian.history[0].positions);
  assert.ok(Math.abs(greedy.dispatches[0].totalCost - 6.8) < 1e-12);
  assert.ok(Math.abs(hungarian.dispatches[0].totalCost - 5.2) < 1e-12);
  assert.deepEqual(hungarian.agents.map((agent) => agent.taskId), [1, 0, 2]);
  assert.deepEqual(createMissionRun({ failure: true }).dispatches, greedy.dispatches);
  assert.deepEqual(Object.keys(allocatorObservation(greedy)).sort(), ['agents', 'tasks']);
  assert.deepEqual(Object.keys(executorObservation(greedy, 0)).sort(), ['id', 'position', 'state', 'task']);
  const changedEvaluator = { ...greedy, reassignments: 999, lostService: 999, history: [], status: 'completed' };
  assert.deepEqual(allocatorObservation(changedEvaluator), allocatorObservation(greedy));
});

test('all reference traces preserve exclusive ownership, bounded motion and single completion', () => {
  for (const policy of Object.keys(POLICIES)) for (const failure of [false, true]) {
    let run = createMissionRun({ policy, failure });
    while (run.status === 'running') {
      const previous = run, unchanged = structuredClone(previous);
      run = stepMission(run);
      assert.deepEqual(previous, unchanged);
      const targets = run.agents.filter((agent) => agent.taskId !== null).map((agent) => agent.taskId);
      assert.equal(new Set(targets).size, targets.length);
      for (const agent of run.agents) {
        assert.ok(missionDistance(agent.position, previous.agents[agent.id].position) <= MISSION_SPEED * MISSION_DT + 1e-12);
        if (agent.taskId !== null) assert.equal(run.tasks[agent.taskId].owner, agent.id);
        if (previous.agents[agent.id].state === 'unavailable') assert.deepEqual(agent, previous.agents[agent.id]);
      }
      for (const task of run.tasks) {
        if (task.owner !== null) assert.equal(run.agents[task.owner].taskId, task.id);
        if (previous.tasks[task.id].state === 'completed') assert.deepEqual(task, previous.tasks[task.id]);
        assert.ok(task.serviceRemaining >= 0 && task.serviceRemaining <= SERVICE_STEPS);
      }
    }
    const completedIds = run.events.filter((event) => event.type === 'completed').map((event) => event.taskId);
    assert.equal(new Set(completedIds).size, completedIds.length);
  }
});

test('failure arrives at the declared boundary, discards partial service and respects busy owners', () => {
  let run = advance(createMissionRun({ failure: true }), 49);
  assert.equal(run.failureApplied, false);
  assert.equal(run.tasks[1].serviceRemaining, 11);
  const busyOwners = [run.agents[0].taskId, run.agents[2].taskId];
  run = stepMission(run);
  assert.equal(run.step, 50);
  assert.equal(run.agents[1].state, 'unavailable');
  assert.equal(run.tasks[1].state, 'pending');
  assert.equal(run.tasks[1].owner, null);
  assert.equal(run.tasks[1].serviceRemaining, 20);
  assert.equal(run.lostService, 1);
  assert.deepEqual([run.agents[0].taskId, run.agents[2].taskId], busyOwners);
  assert.equal(run.reassignments, 0);
  run = advance(run, 33);
  assert.equal(run.reassignments, 1);
  assert.equal(run.tasks[1].owner, 2);
  assert.equal(run.tasks[1].serviceRemaining, 20);
});

test('a completion on the failure boundary is retained before the executor becomes unavailable', () => {
  const run = advance(createMissionRun({ failure: true }), 49);
  // Boundary fixture: this job has precisely one service interval remaining.
  run.tasks[run.agents[1].taskId].serviceRemaining = 1;
  const next = stepMission(run);
  assert.equal(next.tasks[1].state, 'completed');
  assert.equal(next.tasks[1].completedAt, 50);
  assert.equal(next.agents[1].state, 'unavailable');
  assert.equal(next.lostService, 0);
  assert.deepEqual(next.events.filter((event) => event.step === 50 && event.agentId === 1).map((event) => event.type), ['completed', 'unavailable']);
});

test('fixed ownership leaves work stranded despite two healthy idle executors', () => {
  const run = finishMission(createMissionRun({ policy: 'fixed', failure: true }));
  assert.equal(run.status, 'blocked');
  assert.equal(run.history.at(-1).completed, 4);
  assert.equal(run.history.at(-1).available, 2);
  assert.deepEqual(run.tasks.filter((task) => task.state !== 'completed').map((task) => task.id), [1, 4]);
  assert.equal(run.agents[0].state, 'idle');
  assert.equal(run.agents[2].state, 'idle');
  assert.equal(run.reassignments, 0);
});

test('adaptive allocation finishes released work and reset reproduces its exact history', () => {
  for (const policy of ['greedy', 'hungarian']) {
    const run = finishMission(createMissionRun({ policy, failure: true }));
    assert.equal(run.status, 'completed');
    assert.equal(run.history.at(-1).completed, 6);
    assert.equal(run.reassignments, 1);
    assert.deepEqual(finishMission(resetMission(run)), run);
    assert.equal(stepMission(run), run);
  }
});

test('comparison output measures the same configurations and rejects invalid setup', () => {
  const results = compareMissions();
  assert.deepEqual(results.map((result) => result.step), [157, 117, 104, 110, 221, 153]);
  assert.deepEqual(results.map((result) => result.completed), [6, 6, 6, 4, 6, 6]);
  for (const result of results) assert.equal(result.time, result.step * MISSION_DT);
  assert.throws(() => createMissionRun({ policy: 'unknown' }));
  assert.throws(() => createMissionRun({ failure: 'yes' }));
  assert.throws(() => executorObservation(createMissionRun(), 3));
});
