import test from 'node:test';
import assert from 'node:assert/strict';
import { POSE_COUNT, MAX_ITERATIONS, MAX_BACKTRACKS, ARMIJO_C, STEP_TOLERANCE, RELATIVE_COST_TOLERANCE, INITIAL_POSE, SCENARIOS, createRun, stepRun, runToEnd, wrapAngle, relativePose, composePose, edgeResidual, edgeJacobians, graphCost, linearizeGraph, solvePositiveDefinite, applyIncrement, optimizeStep, referenceComparisons, compareSeeds } from '../src/pose-graph-model.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
function closeArray(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => Array.isArray(value) ? closeArray(value, expected[index], tolerance) : close(value, expected[index], tolerance));
}
const transpose = (a) => a[0].map((_, j) => a.map((row) => row[j]));
const multiply = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const matvec = (a, v) => a.map((row) => row.reduce((sum, value, i) => sum + value * v[i], 0));
const active = (run) => ['ready', 'running'].includes(run.status);

function fixture() {
  return {
    poses: [[0, 0, 0], [1.356085438746959, 0.47561001032590866, -1.7321295230649412], [4.203380276449025, 3.9153360412456095, -1.7491595540195704], [-0.6504109804518521, -2.976556890644133, -0.5986318183131516]],
    edges: [
      { id: 'a', kind: 'odometry', from: 0, to: 1, measurement: [1, 0, 0.4], information: [10, 10, 30] },
      { id: 'b', kind: 'odometry', from: 1, to: 2, measurement: [1, 0, 0.4], information: [10, 10, 30] },
      { id: 'c', kind: 'odometry', from: 2, to: 3, measurement: [1, 0, 0.4], information: [10, 10, 30] },
      { id: 'd', kind: 'loop', from: 0, to: 3, measurement: [2.6, 1.3, 1.2], information: [30, 30, 100] },
    ],
  };
}

function numericalJacobian(fn, values, angularRows = [], epsilon = 1e-6) {
  const columns = values.map((_, index) => {
    const high = [...values], low = [...values]; high[index] += epsilon; low[index] -= epsilon;
    const a = fn(high), b = fn(low);
    return a.map((value, row) => (angularRows.includes(row) ? wrapAngle(value - b[row]) : value - b[row]) / (2 * epsilon));
  });
  return transpose(columns);
}

test('pose-graph relative composition respects local translation and wrapped heading', () => {
  const a = [2.1, -0.3, 3.12], b = [-1.5, 3.7, -3.1], composed = composePose(a, relativePose(a, b));
  closeArray(composed.slice(0, 2), b.slice(0, 2)); close(wrapAngle(composed[2] - b[2]), 0);
  close(relativePose([0, 0, Math.PI / 2], [1, 0, Math.PI / 2])[0], 0);
  close(relativePose([0, 0, Math.PI / 2], [1, 0, Math.PI / 2])[1], -1);
});

test('pose-graph analytic endpoint Jacobians agree with finite differences', () => {
  const { poses, edges } = fixture();
  for (const edge of edges) {
    const jacobian = edgeJacobians(poses, edge);
    for (const endpoint of ['from', 'to']) {
      const numeric = numericalJacobian((pose) => { const changed = structuredClone(poses); changed[edge[endpoint]] = pose; return edgeResidual(changed, edge); }, poses[edge[endpoint]], [2]);
      closeArray(jacobian[endpoint], numeric, 2e-8);
    }
  }
});

test('pose-graph reduced normal equations match an independent dense numerical whitened Jacobian', () => {
  const { poses, edges } = fixture(), variables = poses.slice(1).flat();
  const residual = (values) => {
    const candidate = [poses[0], ...Array.from({ length: poses.length - 1 }, (_, i) => values.slice(3 * i, 3 * i + 3))];
    return edges.flatMap((edge) => edgeResidual(candidate, edge).map((value, row) => value * Math.sqrt(edge.information[row])));
  };
  const J = numericalJacobian(residual, variables), r = residual(variables), expectedNormal = multiply(transpose(J), J), expectedGradient = matvec(transpose(J), r), system = linearizeGraph(poses, edges);
  closeArray(system.normal, expectedNormal, 3e-6); closeArray(system.gradient, expectedGradient, 2e-6);
  close(system.cost, r.reduce((sum, value) => sum + value * value, 0));
  const numericalCostGradient = numericalJacobian((values) => [residual(values).reduce((sum, value) => sum + value * value, 0)], variables)[0];
  closeArray(system.gradient.map((value) => 2 * value), numericalCostGradient, 3e-6);
  const direction = solvePositiveDefinite(system.normal, system.gradient.map((value) => -value));
  closeArray(matvec(system.normal, direction), system.gradient.map((value) => -value), 1e-9);
});

test('pose-graph isotropic translation weighting preserves cost under a constant measurement-frame residual rotation', () => {
  const { poses, edges } = fixture();
  for (const edge of edges) {
    const e = edgeResidual(poses, edge), angle = edge.measurement[2], c = Math.cos(angle), s = Math.sin(angle);
    const rotated = [c * e[0] + s * e[1], -s * e[0] + c * e[1], e[2]];
    close(e.reduce((sum, value, i) => sum + value ** 2 * edge.information[i], 0), rotated.reduce((sum, value, i) => sum + value ** 2 * edge.information[i], 0));
  }
});

test('pose-graph Armijo search rejects an increasing full step and accepts a shorter descent with the correct objective factor', () => {
  const { poses, edges } = fixture(), before = structuredClone(poses), result = optimizeStep(poses, edges), system = linearizeGraph(poses, edges), trace = result.trace;
  assert.equal(trace.accepted, true); assert.equal(trace.alpha, 0.5); assert.equal(trace.backtracks, 1);
  assert.ok(trace.trials[0].cost > trace.costBefore); assert.equal(trace.trials[0].accepted, false);
  const slopeHalf = system.gradient.reduce((sum, value, i) => sum + value * trace.direction[i], 0);
  for (const trial of trace.trials) close(trial.armijoBound, system.cost + 2 * ARMIJO_C * trial.alpha * slopeHalf);
  assert.ok(trace.costAfter <= trace.trials.at(-1).armijoBound);
  close(trace.predictedReduction, -(2 * trace.alpha - trace.alpha ** 2) * slopeHalf);
  assert.deepEqual(poses, before);
});

test('pose-graph failed line search and disconnected normal solve preserve poses and report their distinct reasons', () => {
  const { poses, edges } = fixture(), result = optimizeStep(poses, edges, { maxBacktracks: 0 });
  assert.equal(result.status, 'line-search-failure'); assert.equal(result.trace.accepted, false); assert.equal(result.trace.trials.length, 1);
  assert.deepEqual(result.poses, poses);
  const disconnected = optimizeStep([[0, 0, 0], [0, 0, 0], [2, 1, 0.3]], [{ id: 'loose', from: 1, to: 2, measurement: [1, 0, 0], information: [1, 1, 1] }]);
  assert.equal(disconnected.status, 'linear-solve-failure'); assert.equal(disconnected.trace.accepted, false);
  assert.deepEqual(disconnected.poses, [[0, 0, 0], [0, 0, 0], [2, 1, 0.3]]);
});

test('pose-graph accepted optimization steps decrease a fixed graph cost and preserve the anchored pose exactly', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ scenario }), anchor = structuredClone(run.poses[0]);
    while (active(run)) {
      const previousCost = run.metrics.cost; stepRun(run);
      assert.deepEqual(run.poses[0], anchor); assert.deepEqual(anchor, INITIAL_POSE);
      assert.ok(run.metrics.cost <= previousCost + 1e-10);
      if (run.lastStep.accepted) assert.ok(run.lastStep.costAfter <= run.lastStep.trials.at(-1).armijoBound);
      assert.ok(run.poses.every((pose) => pose.every(Number.isFinite)));
    }
    assert.ok(run.iteration <= MAX_ITERATIONS);
  }
});

test('pose-graph odometry integration can fit every supplied edge while retaining nonzero truth error', () => {
  const run = createRun({ scenario: 'no-loop' }), before = structuredClone(run.poses);
  assert.ok(run.metrics.cost < 1e-20); assert.ok(run.metrics.trajectoryRmse > 0.1);
  stepRun(run);
  assert.equal(run.status, 'stationary'); assert.equal(run.iteration, 1); assert.equal(run.acceptedSteps, 0);
  assert.deepEqual(run.poses, before); assert.equal(run.metrics.loopCost, null);
});

test('pose-graph loop correction revises historical poses rather than moving only the endpoint', () => {
  const run = createRun(), before = structuredClone(run.poses); stepRun(run);
  assert.ok(run.lastStep.accepted);
  assert.ok(Math.hypot(run.poses[8][0] - before[8][0], run.poses[8][1] - before[8][1]) > 0.01);
  assert.ok(Math.hypot(run.poses[16][0] - before[16][0], run.poses[16][1] - before[16][1]) > 0.01);
  assert.deepEqual(run.history[0].poses, before); assert.deepEqual(run.history[1].poses, run.poses);
  assert.notEqual(run.history[1].poses, run.poses);
});

test('pose-graph wrong supplied IDs can reduce their own objective while worsening trajectory accuracy', () => {
  const run = createRun({ scenario: 'wrong-loop' }), initial = { ...run.metrics }; runToEnd(run);
  assert.ok(run.metrics.cost < initial.cost / 50);
  assert.ok(run.metrics.trajectoryRmse > initial.trajectoryRmse * 5);
  assert.ok(run.metrics.endpointError > 5);
  const loop = run.edges.find((edge) => edge.kind === 'loop'); assert.equal(loop.from, 0); assert.equal(loop.to, 18);
  assert.equal(run.status, 'stationary');
});

test('pose-graph seeded graphs share their full recorded inputs; the wrong association changes only the loop target ID', () => {
  const chain = createRun({ scenario: 'no-loop', seed: 17 }), correct = createRun({ scenario: 'correct-loop', seed: 17 }), wrong = createRun({ scenario: 'wrong-loop', seed: 17 });
  assert.deepEqual(chain.initialPoses, correct.initialPoses); assert.deepEqual(correct.initialPoses, wrong.initialPoses);
  assert.deepEqual(chain.edges, correct.edges.slice(0, -1)); assert.deepEqual(chain.edges, wrong.edges.slice(0, -1));
  assert.deepEqual(correct.edges.at(-1).measurement, wrong.edges.at(-1).measurement);
  assert.deepEqual(chain.evaluator.loopMeasurement, correct.evaluator.loopMeasurement);
  const expectedWrong = structuredClone(correct.edges.at(-1)); expectedWrong.to = 18; assert.deepEqual(wrong.edges.at(-1), expectedWrong);
});

test('pose-graph optimization never regenerates constraints or reads evaluator truth', () => {
  const normal = createRun(), altered = createRun(), constraints = structuredClone(normal.edges), initialPoses = structuredClone(normal.initialPoses);
  altered.truth = altered.truth.map(() => [100, 200, -1]); altered.evaluator.loopMeasurement = [90, 80, 2];
  runToEnd(normal); runToEnd(altered);
  assert.deepEqual(normal.edges, constraints); assert.deepEqual(normal.initialPoses, initialPoses);
  assert.deepEqual(normal.poses, altered.poses); close(normal.metrics.cost, altered.metrics.cost);
  assert.notEqual(normal.metrics.trajectoryRmse, altered.metrics.trajectoryRmse);
});

test('pose-graph angle residuals and increments handle a pi crossing locally', () => {
  const poses = [[0, 0, 3.13], [1, 0, -3.13]], measurement = relativePose(poses[0], poses[1]);
  const edge = { from: 0, to: 1, measurement: [measurement[0], measurement[1], measurement[2] + 2 * Math.PI], information: [1, 1, 1] };
  closeArray(edgeResidual(poses, edge), [0, 0, 0]);
  const moved = applyIncrement(poses, [0, 0, -0.04]);
  assert.ok(moved[1][2] >= -Math.PI && moved[1][2] < Math.PI);
  close(wrapAngle(moved[1][2] - poses[1][2]), -0.04); assert.deepEqual(moved[0], poses[0]);
});

test('pose-graph trajectory RMSE excludes the fixed anchor and averages the other 24 recorded positions without alignment', () => {
  const run = runToEnd(createRun()), squared = run.poses.slice(1).reduce((sum, pose, i) => sum + (pose[0] - run.truth[i + 1][0]) ** 2 + (pose[1] - run.truth[i + 1][1]) ** 2, 0);
  close(run.metrics.trajectoryRmse ** 2, squared / (POSE_COUNT - 1));
  const alteredAnchorTruth = createRun(); alteredAnchorTruth.truth[0] = [1e6, 1e6, 2]; runToEnd(alteredAnchorTruth);
  close(alteredAnchorTruth.metrics.trajectoryRmse, run.metrics.trajectoryRmse);
});

test('pose-graph negligible proposed-step stopping applies no pose update and records its explicit tolerances', () => {
  const run = runToEnd(createRun());
  assert.equal(run.status, 'stationary'); assert.equal(run.lastStep.accepted, false);
  assert.ok(run.lastStep.proposedStepInfinity <= STEP_TOLERANCE);
  assert.ok(run.lastStep.predictedRelativeReduction <= RELATIVE_COST_TOLERANCE);
  assert.equal(run.lastStep.alpha, null); assert.equal(run.lastStep.trials.length, 0);
  assert.deepEqual(run.history.at(-1).poses, run.history.at(-2).poses);
});

test('pose-graph near-roundoff line-search failure remains distinct from stationary and budget termination', () => {
  const run = runToEnd(createRun({ seed: 1 }));
  assert.equal(run.status, 'line-search-failure'); assert.equal(run.lastStep.accepted, false);
  assert.equal(run.lastStep.trials.length, MAX_BACKTRACKS + 1);
  assert.equal(run.lastStep.trials.at(-1).alpha, 2 ** -MAX_BACKTRACKS);
  assert.ok(run.lastStep.proposedStepInfinity > STEP_TOLERANCE);
  assert.deepEqual(run.history.at(-1).poses, run.history.at(-2).poses);
  const budget = createRun(); budget.iteration = MAX_ITERATIONS - 1; stepRun(budget);
  assert.equal(budget.status, 'budget'); assert.equal(budget.iteration, MAX_ITERATIONS);
});

test('pose-graph references and ensembles expose paired improvement, counterexamples and solver failures separately', () => {
  const references = referenceComparisons(); assert.equal(references.length, 3);
  const trials = compareSeeds({ count: 100 }), correct = trials.scenarios['correct-loop'], wrong = trials.scenarios['wrong-loop'];
  assert.ok(correct.trajectoryErrorRms < correct.initialTrajectoryErrorRms / 2);
  assert.ok(wrong.trajectoryErrorRms > wrong.initialTrajectoryErrorRms * 5);
  assert.ok(correct.improvedTrajectory < trials.count);
  assert.equal(correct.improvedTrajectory + correct.notImprovedTrajectorySeeds.length, trials.count);
  assert.equal(Object.values(correct.statuses).reduce((sum, value) => sum + value, 0), trials.count);
  assert.ok(correct.failureSeeds.length > 0);
  const seed = correct.notImprovedTrajectorySeeds[0], counterexample = runToEnd(createRun({ seed }));
  assert.ok(counterexample.metrics.trajectoryRmse >= counterexample.initialMetrics.trajectoryRmse);
  for (const failure of correct.failureSeeds) assert.equal(runToEnd(createRun({ seed: failure.seed })).status, failure.status);
});

test('pose-graph replay is deterministic and terminal runs are idempotent', () => {
  const a = runToEnd(createRun()), b = runToEnd(createRun()); assert.deepEqual(a, b);
  assert.equal(a.history.length, a.iteration + 1);
  const before = structuredClone(a); assert.equal(stepRun(a), a); assert.deepEqual(a, before);
  assert.throws(() => createRun({ scenario: 'unknown' }), /scenario/);
  for (const seed of [-1, 1.2, NaN, 4294967296]) assert.throws(() => createRun({ seed }), /Seed/);
  assert.throws(() => compareSeeds({ count: 0 }), /Trial count/);
});
