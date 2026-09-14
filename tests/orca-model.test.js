import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DT, MAX_STEPS, MAX_SPEED, RADIUS, SAFETY_PADDING, GOAL_RADIUS, PRESETS,
  createRun, stepRun, runToEnd, referenceComparisons, observeAgent, decideVelocity,
  projectVelocity, orcaConstraint, sweptClearance,
} from '../src/orca-model.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const vectorClose = (actual, expected, tolerance) => actual.forEach((value, index) => close(value, expected[index], tolerance));
const halfPlane = (x, y, offset) => ({ normal: [x, y], point: [x * offset, y * offset] });
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

test('velocity projection preserves an admissible preference and respects the speed disk', () => {
  assert.deepEqual(projectVelocity([0.2, -0.4], []), { velocity: [0.2, -0.4], feasible: true });
  vectorClose(projectVelocity([3, 4], []).velocity, [0.6, 0.8]);
});

test('nearest feasible velocity can lie on one line or the intersection of two lines', () => {
  vectorClose(projectVelocity([-1, 0.4], [halfPlane(1, 0, 0.2)]).velocity, [0.2, 0.4]);
  vectorClose(projectVelocity([-0.8, -0.8], [halfPlane(1, 0, 0.4), halfPlane(0, 1, 0.5)]).velocity, [0.4, 0.5]);
});

test('the nearest feasible velocity includes the line/speed-circle boundary case', () => {
  const choice = projectVelocity([-1, 2], [halfPlane(1, 0, 0.6)]);
  assert.equal(choice.feasible, true);
  vectorClose(choice.velocity, [0.6, 0.8]);
});

test('contradictory half-planes or an empty speed-capped set expose infeasibility', () => {
  for (const lines of [
    [halfPlane(1, 0, 0.4), halfPlane(-1, 0, -0.2)],
    [halfPlane(1, 0, 0.8), halfPlane(0, 1, 0.8)],
    [halfPlane(1, 0, 1.1)],
  ]) assert.deepEqual(projectVelocity([1, 0], lines), { velocity: [0, 0], feasible: false });
});

test('stationary head-on neighbors split the velocity-obstacle cap correction equally', () => {
  const own = { id: 'A', position: [0, 0], velocity: [0, 0], radius: 0.3 };
  const other = { id: 'B', position: [2, 0], velocity: [0, 0], radius: 0.3 };
  const constraint = orcaConstraint(own, other, 2);
  vectorClose(constraint.correction, [0.7, 0]);
  vectorClose(constraint.point, [0.35, 0]);
  vectorClose(constraint.normal, [-1, 0]);
  vectorClose(projectVelocity([1, 0], [constraint]).velocity, [0.35, 0]);
});

test('ORCA ray constraints are reciprocal and use the outward normal even outside the VO', () => {
  const own = { id: 'A', position: [0, 0], velocity: [1, 0] };
  const other = { id: 'B', position: [2, 0], velocity: [-1, 0] };
  const a = orcaConstraint(own, other, 2), b = orcaConstraint(other, own, 2);
  vectorClose(a.point, [0.91, Math.sqrt(0.91) * 0.3]);
  vectorClose(a.normal, [-0.3, Math.sqrt(0.91)]);
  vectorClose(a.correction, b.correction.map((value) => -value));
  vectorClose(a.normal, b.normal.map((value) => -value));
  const separating = orcaConstraint({ ...own, velocity: [-0.5, 0] }, { ...other, velocity: [0.5, 0] }, 2);
  assert.ok(dot(separating.correction, separating.normal) < 0, 'safe-side correction is not the outward normal');
  assert.equal(projectVelocity([-0.5, 0], [separating]).feasible, true);
  vectorClose(projectVelocity([-0.5, 0], [separating]).velocity, [-0.5, 0]);
});

test('two agents satisfying reciprocal constraints avoid overlap throughout the chosen horizon', () => {
  let checked = 0;
  for (const angle of [0, 0.35, 1.1, 2.8]) {
    for (const horizon of [0.25, 1, 2, 5]) {
      for (const speed of [-0.9, 0, 0.9]) {
        const own = { id: 'A', position: [0, 0], velocity: [speed, 0.1] };
        const other = { id: 'B', position: [2 * Math.cos(angle), 2 * Math.sin(angle)], velocity: [-0.3, 0.4] };
        const a = projectVelocity([1, 0], [orcaConstraint(own, other, horizon)]);
        const b = projectVelocity([-0.6, -0.8], [orcaConstraint(other, own, horizon)]);
        if (!a.feasible || !b.feasible) continue;
        const before = [own.position, other.position];
        const after = before.map((point, index) => point.map((value, axis) => value + horizon * [a.velocity, b.velocity][index][axis]));
        assert.ok(sweptClearance(before, after) >= -1e-9);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 40);
});

test('swept clearance detects tunneling and uses simultaneous relative trajectories', () => {
  close(sweptClearance([[-1, 0], [1, 0]], [[1, 0], [-1, 0]]), -2 * RADIUS);
  // The path segments cross at the origin, but A gets there at t=.5 while
  // B gets there at t=1; their closest simultaneous center separation is .8944.
  close(sweptClearance([[-2, 0], [0, -2]], [[2, 0], [0, 0]]), Math.sqrt(0.8) - 2 * RADIUS);
});

test('agent observations omit peer goals, evaluator metrics and missing measurements', () => {
  const run = createRun(), observation = observeAgent(run, 0);
  assert.equal(observation.neighbors.length, 2);
  assert.deepEqual(Object.keys(observation.neighbors[0]).sort(), ['id', 'position', 'radius', 'velocity']);
  assert.equal(observation.metrics, undefined);
  observation.neighbors[0].position[0] = 999;
  assert.notEqual(run.agents[1].position[0], 999);
  assert.deepEqual(observeAgent(createRun({ scenario: 'blind' }), 0).neighbors, []);
});

test('a tick applies simultaneous old-snapshot decisions and retains their inspection state', () => {
  const run = createRun();
  const observations = run.agents.map((_, index) => observeAgent(run, index));
  const commands = observations.map((observation) => decideVelocity(observation, run.config));
  assert.strictEqual(stepRun(run), run);
  assert.equal(run.time, DT);
  assert.equal(run.decisionTime, 0);
  run.agents.forEach((agent, index) => {
    vectorClose(agent.position, observations[index].position.map((value, axis) => value + DT * commands[index].velocity[axis]));
    assert.deepEqual(agent.constraints, commands[index].constraints);
    assert.deepEqual(agent.decisionPosition, observations[index].position);
    assert.deepEqual(agent.decisionVelocity, observations[index].velocity);
    assert.deepEqual(agent.command, agent.velocity);
    assert.equal(agent.trail.length, 2);
  });
});

test('nominal ORCA obeys all velocity constraints, arrives and preserves its physical safety margin', () => {
  const run = createRun();
  while (run.status === 'running') {
    stepRun(run);
    for (const agent of run.agents) {
      assert.equal(agent.feasible, true);
      assert.ok(Math.hypot(...agent.velocity) <= MAX_SPEED + 1e-9);
      for (const { point, normal } of agent.constraints) assert.ok(dot(agent.velocity.map((value, axis) => value - point[axis]), normal) >= -1e-9);
    }
  }
  assert.equal(run.status, 'arrived');
  assert.equal(run.metrics.arrived, 3);
  assert.ok(run.metrics.minClearance >= 2 * SAFETY_PADDING - 1e-9);
  for (const agent of run.agents) assert.ok(Math.hypot(...agent.position.map((value, axis) => value - agent.goal[axis])) <= GOAL_RADIUS);
});

test('an infeasible agent receives the declared stop command and increments the tick counter', () => {
  const run = createRun();
  // Physical disks are disjoint, but both safety-padded neighbors intrude on
  // the center agent from opposite sides, demanding contradictory velocities.
  [[0, 0], [-0.61, 0], [0.61, 0]].forEach((position, index) => { run.agents[index].position = position; });
  stepRun(run);
  assert.equal(run.agents[0].feasible, false);
  assert.deepEqual(run.agents[0].velocity, [0, 0]);
  assert.equal(run.metrics.infeasibleSteps, 1);
});

test('reference cases expose arrival, symmetric timeout and sensing-loss contact without claiming universal ranking', () => {
  const rows = referenceComparisons();
  assert.deepEqual(rows.map(({ status }) => status), ['arrived', 'arrived', 'collision', 'timeout', 'collision']);
  assert.equal(rows[3].time, DT * MAX_STEPS);
  assert.equal(rows[3].arrived, 0);
  assert.ok(rows[3].minClearance > 0);
  assert.equal(rows[2].time, rows[4].time);
  assert.equal(rows[2].minClearance, rows[4].minClearance);
  assert.ok(rows[2].minClearance < 0);
  assert.deepEqual(rows.map(({ infeasibleSteps }) => infeasibleSteps), [0, 0, 0, 0, 0]);
});

test('APF uses the earlier surface-clearance repulsion equation before its speed cap', () => {
  const observation = { id: 'A', position: [0, 0], velocity: [0, 0], goal: [1, 0], radius: RADIUS,
    neighbors: [{ id: 'B', position: [1, 0], velocity: [0, 0], radius: RADIUS }] };
  const magnitude = 0.02 * (1 / 0.4 - 1 / 0.7) / 0.4 ** 2;
  vectorClose(decideVelocity(observation, { method: 'apf' }).velocity, [0.6 - magnitude, 0]);
});

test('reset is deterministic, terminal runs do not advance and invalid configurations are rejected', () => {
  const config = PRESETS[2].config;
  const first = runToEnd(createRun(config)), second = runToEnd(createRun(config));
  assert.deepEqual(first, second);
  const saved = structuredClone(first);
  assert.strictEqual(stepRun(first), first);
  assert.deepEqual(first, saved);
  assert.equal(createRun(config).step, 0);
  assert.throws(() => createRun({ method: 'unknown' }), RangeError);
  assert.throws(() => createRun({ scenario: 'unknown' }), RangeError);
  for (const horizon of [0, 0.1, 6, NaN]) assert.throws(() => createRun({ horizon }), RangeError);
});
