import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURES, NETWORKS, GROUPS, ARCHITECTURE_BUDGET, createArchitectureRun, stepArchitecture, resetArchitecture, finishArchitecture, architectureObservation, planArchitecture, compareArchitectures } from '../src/architecture-model.js';
import { createMissionRun, finishMission, missionDistance, MISSION_DT, MISSION_SPEED } from '../src/mission-model.js';

function advance(run, step) { while (run.step < step && run.status === 'running') run = stepArchitecture(run); return run; }
const initial = (architecture, network = 'recovery') => createArchitectureRun({ architecture, network });

test('connected central and independent peers reproduce the same greedy physical mission', () => {
  const central = finishArchitecture(initial('central', 'connected'));
  const peers = finishArchitecture(initial('peers', 'connected'));
  const mission = finishMission(createMissionRun({ policy: 'greedy' }));
  assert.deepEqual(central.history, peers.history);
  assert.deepEqual(central.history.map((state) => state.positions), mission.history.map((state) => state.positions));
  assert.equal(central.step, 117);
  assert.equal(peers.traffic.command.attempted, 0);
});

test('current reports precede commands, and planner inputs exclude evaluator truth and future schedules', () => {
  const run = initial('central');
  assert.equal(run.knowledge[0].reports[0].state, 'idle');
  assert.equal(run.agents[0].state, 'travelling');
  assert.equal(run.knowledge[0].reports[0].taskId, null);
  for (const architecture of Object.keys(ARCHITECTURES)) {
    const actual = advance(initial(architecture), 60);
    const replaced = { ...actual, agents: null, tasks: null, traffic: null, events: null, history: null, status: 'completed', firstPhysicalStep: -1, initial: { architecture, network: 'unknown' } };
    for (let node = 0; node < 4; node += 1) {
      assert.deepEqual(architectureObservation(actual, node), architectureObservation(replaced, node));
      assert.deepEqual(planArchitecture(architectureObservation(actual, node)), planArchitecture(architectureObservation(replaced, node)));
      const observation = architectureObservation(actual, node);
      observation.knowledge.reports[0].position[0] = 999;
      assert.notEqual(actual.knowledge[node].reports[0].position[0], 999);
    }
  }
});

test('cut reports become stale while executors finish; reservations survive until delivered completion', () => {
  let run = advance(initial('central'), 20);
  assert.deepEqual(run.knowledge[0].reports.map((report) => report.step), [20, 19, 19]);
  assert.deepEqual(run.events.filter((event) => event.step === 20 && event.type === 'partition').length, 1);
  run = advance(run, 60);
  assert.equal(run.tasks[1].state, 'completed');
  assert.equal(run.agents[1].state, 'idle');
  assert.equal(run.knowledge[0].completed.includes(1), false);
  assert.equal(run.knowledge[0].reservations[1], 1);
  assert.equal(run.knowledge[2].completed.includes(1), true);
  run = advance(run, 80);
  assert.deepEqual(run.knowledge[0].reports.map((report) => report.step), [80, 80, 80]);
  assert.equal(run.knowledge[0].completed.includes(1), true);
  assert.equal(run.knowledge[0].reservations[1], null);
});

test('delegated authority stays inside fixed domains across every network schedule', () => {
  for (const network of Object.keys(NETWORKS)) {
    const run = finishArchitecture(initial('hierarchy', network));
    for (const event of run.events.filter((item) => item.type === 'assigned')) {
      const group = GROUPS.find((item) => `A${item.node}` === event.source);
      assert.ok(group);
      assert.ok(group.agents.includes(event.agentId));
      assert.ok(group.tasks.includes(event.taskId));
    }
    assert.equal(run.firstPhysicalStep, 157);
  }
});

test('peer barriers block new commitments across the cut and exchange matching plans on recovery', () => {
  let run = advance(initial('peers'), 79);
  assert.equal(run.history.at(-1).physical, 3);
  assert.equal(run.events.some((event) => event.type === 'assigned' && event.step >= 20), false);
  assert.deepEqual(run.knowledge[1].readiness.missing, [1, 2]);
  assert.deepEqual(run.knowledge[2].readiness.missing, [0]);
  run = stepArchitecture(run);
  assert.equal(run.events.filter((event) => event.type === 'assigned' && event.step === 80).length, 3);
  assert.deepEqual(run.knowledge.slice(1).map((item) => [...item.agreementFrom].sort()), [[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
  const plans = run.knowledge.slice(1).map((item) => item.lastDecision.assignments);
  assert.deepEqual(plans[0], plans[1]); assert.deepEqual(plans[1], plans[2]);
  assert.equal(finishArchitecture(run).step, 152);
});

test('physical completion without required confirmation keeps running to the evaluation budget', () => {
  for (const [architecture, first, confirmed] of [['central', 277, 4], ['hierarchy', 157, 2]]) {
    const physical = advance(initial(architecture, 'partition'), first);
    assert.equal(physical.history.at(-1).physical, 6);
    assert.equal(physical.status, 'running');
    const final = finishArchitecture(physical);
    assert.equal(final.status, 'budget'); assert.equal(final.step, ARCHITECTURE_BUDGET);
    assert.equal(final.history.at(-1).confirmed, confirmed);
    assert.ok(final.agents.every((agent) => agent.state === 'idle'));
  }
  const peer = finishArchitecture(initial('peers', 'partition'));
  assert.equal(peer.history.at(-1).physical, 3);
  assert.equal(peer.history.at(-1).confirmed, 1);
});

test('every reference transition preserves unique ownership, bounded motion and evidence-backed knowledge', () => {
  for (const architecture of Object.keys(ARCHITECTURES)) for (const network of Object.keys(NETWORKS)) {
    let run = initial(architecture, network);
    while (run.status === 'running') {
      const previous = run;
      run = stepArchitecture(run);
      const targets = run.agents.filter((agent) => agent.taskId !== null).map((agent) => agent.taskId);
      assert.equal(new Set(targets).size, targets.length);
      for (const agent of run.agents) {
        assert.ok(missionDistance(agent.position, previous.agents[agent.id].position) <= MISSION_SPEED * MISSION_DT + 1e-12);
        for (const id of agent.completed) {
          const arrival = run.events.find((event) => event.type === 'arrived' && event.taskId === id);
          const completion = run.events.find((event) => event.type === 'completed' && event.taskId === id);
          assert.equal(completion.step - arrival.step, 20);
        }
      }
      for (const knowledge of run.knowledge) {
        assert.ok(previous.knowledge[knowledge.node].completed.every((id) => knowledge.completed.includes(id)));
        for (const id of knowledge.completed) {
          assert.equal(run.tasks[id].state, 'completed');
          assert.ok(knowledge.reports.some((report) => report.completed.includes(id)));
        }
      }
      assert.ok(run.history.at(-1).confirmed <= run.history.at(-1).physical);
      assert.equal(run.duplicateAssignments, 0);
      assert.equal(run.history.at(-1).duplicateCompletions, 0);
    }
  }
});

test('packet accounting includes boundary zero, cut losses and only nonempty peer proposals', () => {
  const results = compareArchitectures();
  for (const result of results) {
    const reports = result.traffic.report;
    assert.equal(reports.attempted, 9 * (result.step + 1));
    assert.equal(reports.dropped, result.network === 'partition' ? 3486 : result.network === 'recovery' ? 360 : 0);
    for (const count of Object.values(result.traffic)) assert.equal(count.attempted, count.delivered + count.dropped);
    assert.equal(result.traffic.command.attempted, result.architecture === 'central' ? 6 : result.architecture === 'hierarchy' ? 2 : 0);
    assert.equal(result.traffic.proposal.attempted, result.architecture !== 'peers' ? 0 : result.network === 'connected' ? 24 : result.network === 'partition' ? 6 : 12);
  }
  assert.deepEqual(results.map((result) => result.step), [117, 157, 117, 600, 600, 600, 137, 157, 152]);
});

test('transitions are immutable, reset replays the exact run and terminal steps are no-ops', () => {
  for (const architecture of Object.keys(ARCHITECTURES)) {
    const run = advance(initial(architecture), 79), before = structuredClone(run);
    const next = stepArchitecture(run);
    assert.deepEqual(run, before);
    assert.notDeepEqual(next, before);
    const final = finishArchitecture(next);
    assert.deepEqual(finishArchitecture(resetArchitecture(final)), final);
    assert.equal(stepArchitecture(final), final);
  }
});

test('invalid configurations and unknown observers fail explicitly', () => {
  assert.throws(() => createArchitectureRun({ architecture: 'unknown' }), RangeError);
  assert.throws(() => createArchitectureRun({ network: 'unknown' }), RangeError);
  for (const node of [-1, 4, 0.5, '1']) assert.throws(() => architectureObservation(initial('central'), node), RangeError);
});
