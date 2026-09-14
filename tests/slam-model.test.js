import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, STEPS, TRUE_DISTANCE, TRUE_TURN, INITIAL_POSE, LANDMARKS, MEASUREMENT_R, RANGE_BIAS, METHODS, SCENARIOS, createRun, stepRun, runToEnd, wrapAngle, motionModel, motionJacobians, predictState, observationModel, observationJacobian, augmentLandmark, correctObservation, referenceComparisons, compareSeeds, truthAt } from '../src/slam-model.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
function closeArray(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => Array.isArray(value) ? closeArray(value, expected[index], tolerance) : close(value, expected[index], tolerance));
}
const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
const transpose = (a) => a[0].map((_, j) => a.map((row) => row[j]));
const multiply = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const add = (a, b) => a.map((row, i) => row.map((value, j) => value + b[i][j]));

// Independent numerical derivatives use wrapped differences only on angular
// output rows. Inputs remain perturbations in the declared state coordinates.
function finiteDifference(fn, input, angularRows = [], epsilon = 1e-6) {
  const outputSize = fn(input).length;
  const columns = input.map((_, j) => {
    const high = [...input], low = [...input]; high[j] += epsilon; low[j] -= epsilon;
    const a = fn(high), b = fn(low);
    return a.map((value, i) => (angularRows.includes(i) ? wrapAngle(value - b[i]) : value - b[i]) / (2 * epsilon));
  });
  return Array.from({ length: outputSize }, (_, i) => columns.map((column) => column[i]));
}

// Jacobi eigenvalue rotations provide an independent PSD check, including the
// deliberately singular initial pose and first motion covariance.
function minimumEigenvalue(matrix) {
  const a = matrix.map((row) => [...row]), n = a.length;
  for (let iteration = 0; iteration < 80 * n * n; iteration += 1) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (Math.abs(a[i][j]) > largest) { p = i; q = j; largest = Math.abs(a[i][j]); }
    if (largest < 1e-13) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(angle), s = Math.sin(angle);
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    for (let k = 0; k < n; k += 1) if (k !== p && k !== q) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = a[p][k] = c * akp - s * akq;
      a[k][q] = a[q][k] = s * akp + c * akq;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
  }
  return Math.min(...a.map((row, i) => row[i]));
}

function fixture() {
  const lower = [[0.4, 0, 0, 0, 0], [0.1, 0.3, 0, 0, 0], [0.01, -0.02, 0.08, 0, 0], [0.2, 0.05, -0.03, 0.4, 0], [-0.1, 0.15, 0.04, 0.02, 0.3]];
  return { mean: [1.2, -2.4, 3.05, 5, -1], P: multiply(lower, transpose(lower)), mapIds: ['known'] };
}

test('SLAM midpoint motion and its state/input Jacobians match finite differences', () => {
  for (const heading of [-3.13, -0.7, 0, 1.2, 3.13]) {
    const pose = [1.4, -2, heading], odometry = { distance: 0.3, turn: 0.12 };
    const analytic = motionJacobians(pose, odometry);
    closeArray(analytic.F, finiteDifference((p) => motionModel(p, odometry), pose, [2]), 2e-8);
    closeArray(analytic.V, finiteDifference(([distance, turn]) => motionModel(pose, { distance, turn }), [odometry.distance, odometry.turn], [2]), 2e-8);
  }
});

test('SLAM polar observation Jacobian matches finite differences including bearing wrap', () => {
  for (const heading of [-3.13, 0.4, 3.13]) {
    const state = fixture(); state.mean[2] = heading;
    closeArray(observationJacobian(state, 'known'), finiteDifference((mean) => observationModel({ ...state, mean }, 'known'), state.mean, [1]), 2e-8);
  }
});

test('SLAM landmark augmentation preserves existing state and creates all cross-covariances from inverse-observation Jacobians', () => {
  const state = fixture(), observation = { id: 'new', value: [2.3, -0.8] }, before = structuredClone(state);
  const inverseObservation = (mean, value) => [mean[0] + value[0] * Math.cos(mean[2] + value[1]), mean[1] + value[0] * Math.sin(mean[2] + value[1])];
  const Gx = finiteDifference((mean) => inverseObservation(mean, observation.value), state.mean);
  const Gz = finiteDifference((value) => inverseObservation(state.mean, value), observation.value);
  const update = augmentLandmark(state, observation), offset = state.mean.length;
  closeArray(update.Gx, Gx, 2e-8); closeArray(update.Gz, Gz, 2e-8);
  closeArray(update.after.mean.slice(0, offset), state.mean);
  closeArray(update.after.mean.slice(offset), inverseObservation(state.mean, observation.value));
  closeArray(update.after.P.slice(0, offset).map((row) => row.slice(0, offset)), state.P);
  closeArray(update.after.P.slice(0, offset).map((row) => row.slice(offset)), multiply(state.P, transpose(Gx)), 2e-8);
  closeArray(update.after.P.slice(offset).map((row) => row.slice(offset)), add(multiply(multiply(Gx, state.P), transpose(Gx)), multiply(multiply(Gz, MEASUREMENT_R), transpose(Gz))), 2e-8);
  assert.ok(Math.hypot(...update.after.P[3].slice(offset), ...update.after.P[4].slice(offset)) > 0.01, 'The previously mapped landmark must correlate with the new landmark.');
  assert.deepEqual(state, before);
  assert.equal(update.nis, null); assert.equal(update.K, null);
});

test('SLAM process prediction propagates pose/map cross-covariance while stationary map marginals remain fixed', () => {
  const state = fixture(), control = { distance: 0.4, turn: 0.1 }, predicted = predictState(state, control);
  closeArray(predicted.mean.slice(3), state.mean.slice(3));
  closeArray(predicted.P.slice(3).map((row) => row.slice(3)), state.P.slice(3).map((row) => row.slice(3)));
  const expected = multiply(motionJacobians(state.mean.slice(0, 3), control).F, state.P.slice(0, 3).map((row) => row.slice(3)));
  closeArray(predicted.P.slice(0, 3).map((row) => row.slice(3)), expected);
  assert.notDeepEqual(predicted.P.slice(0, 3).map((row) => row.slice(3)), state.P.slice(0, 3).map((row) => row.slice(3)));
});

test('SLAM defines its frame by exact initial pose without inventing covariance or NEES for singular stages', () => {
  const run = createRun();
  closeArray(run.mean, INITIAL_POSE); closeArray(run.P, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.equal(run.metrics.poseNees, null); assert.equal(run.metrics.mapRmse, null);
  stepRun(run);
  assert.equal(run.metrics.poseNees, null);
  assert.ok(Math.abs(minimumEigenvalue(run.P)) < 1e-12);
  stepRun(run);
  assert.ok(Number.isFinite(run.metrics.poseNees));
  assert.ok(minimumEigenvalue(run.P) > 0);
});

test('SLAM initializes each supplied ID once and does not correct again with its initializing sample', () => {
  const run = createRun();
  for (let step = 0; step < 4; step += 1) stepRun(run);
  assert.deepEqual(run.mapIds, ['L1']);
  assert.deepEqual(run.updates.map((update) => update.kind), ['initialize']);
  assert.equal(run.mean.length, 5);
  assert.equal(run.counts.initialized, 1); assert.equal(run.counts.corrected, 0);
  closeArray(run.mean.slice(0, 3), run.snapshots.predicted.mean);
  closeArray(run.P.slice(0, 3).map((row) => row.slice(0, 3)), run.snapshots.predicted.P);
  const update = run.updates[0]; assert.equal(update.innovation, null); assert.equal(update.nis, null);
  runToEnd(run);
  assert.equal(new Set(run.mapIds).size, 4); assert.equal(run.counts.initialized, 4); assert.equal(run.mean.length, 11);
  assert.equal(run.counts.initialized + run.counts.corrected, run.counts.measurements);
});

test('SLAM reobserving one landmark corrects robot and a different mapped landmark through cross-covariance', () => {
  const run = createRun();
  for (let step = 0; step < 112; step += 1) stepRun(run);
  const update = run.updates.find((entry) => entry.id === 'L1' && entry.kind === 'correct');
  assert.ok(update);
  const otherOffset = 3 + 2 * update.before.mapIds.indexOf('L2');
  assert.ok(Math.hypot(...update.correction.slice(0, 2)) > 1e-4);
  assert.ok(Math.hypot(...update.correction.slice(otherOffset, otherOffset + 2)) > 1e-4);
  assert.ok(Math.hypot(...update.K[otherOffset], ...update.K[otherOffset + 1]) > 1e-4);
  assert.ok(update.nis >= 0);
});

test('SLAM wraps bearing innovation across pi rather than applying an almost full-turn residual', () => {
  const state = { mean: [0, 0, 0, -2, -1e-5], P: identity(5).map((row) => row.map((value) => value * 0.1)), mapIds: ['L'] };
  const prediction = observationModel(state, 'L'), observation = { id: 'L', value: [prediction[0], Math.PI - 1e-5] };
  const update = correctObservation(state, observation);
  assert.ok(Math.abs(update.innovation[1]) < 3e-5);
  assert.ok(update.after.mean[2] >= -Math.PI && update.after.mean[2] < Math.PI);
  close(wrapAngle(3 * Math.PI), -Math.PI);
});

test('SLAM covariances remain symmetric positive semidefinite at every dynamic state dimension', () => {
  for (const method of Object.keys(METHODS)) for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ method, scenario });
    for (let step = 0; step < STEPS; step += 1) {
      stepRun(run);
      for (const state of [run.snapshots.predicted, ...run.updates.map((entry) => entry.after), run.snapshots.afterObservations]) {
        assert.equal(state.mean.length, 3 + 2 * state.mapIds.length);
        state.P.forEach((row, i) => row.forEach((value, j) => { assert.ok(Number.isFinite(value)); close(value, state.P[j][i], 1e-12); }));
        assert.ok(minimumEigenvalue(state.P) > -1e-10);
      }
    }
  }
});

test('SLAM matched seeds preserve controls, true paths and available sensor noise across methods and schedules', () => {
  const nominal = createRun({ seed: 19 });
  for (const method of Object.keys(METHODS)) for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ method, scenario, seed: 19 });
    run.evaluator.tape.forEach((sample, index) => {
      const expected = nominal.evaluator.tape[index];
      assert.deepEqual(sample.odometry, expected.odometry); assert.deepEqual(sample.truth, expected.truth);
      sample.observations.forEach((observation) => {
        const original = expected.observations.find((entry) => entry.id === observation.id);
        assert.ok(original);
        close(observation.value[0] - original.value[0], scenario === 'biased-range' ? RANGE_BIAS : 0);
        close(observation.value[1], original.value[1]);
      });
    });
  }
});

test('SLAM estimator state is isolated from evaluator robot and landmark truth', () => {
  const actual = createRun(), altered = createRun();
  altered.evaluator.tape.forEach((sample) => { sample.truth = [100, -100, -1]; });
  altered.landmarks.forEach((entry) => { entry.truth = [1000, 2000]; });
  runToEnd(actual); runToEnd(altered);
  assert.deepEqual(actual.mean, altered.mean); assert.deepEqual(actual.P, altered.P);
  assert.notEqual(actual.metrics.positionError, altered.metrics.positionError); assert.notEqual(actual.metrics.mapRmse, altered.metrics.mapRmse);
});

test('SLAM dropout omits eight batches and restoration first initializes two unknown IDs before later corrections', () => {
  const run = createRun({ scenario: 'dropout' }), absent = [];
  for (let step = 0; step < 80; step += 1) {
    stepRun(run);
    if (run.observations.dropped) { absent.push(run.time); assert.equal(run.observations.landmarks.length, 0); }
  }
  assert.deepEqual(absent, [12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(run.time, 20);
  assert.deepEqual(run.updates.map((entry) => [entry.id, entry.kind]), [['L3', 'initialize'], ['L4', 'initialize']]);
  closeArray(run.mean.slice(0, 3), run.snapshots.predicted.mean.slice(0, 3));
  for (let step = 0; step < 4; step += 1) stepRun(run);
  assert.equal(run.time, 21); assert.ok(run.updates.some((entry) => entry.kind === 'correct'));
  runToEnd(run);
  assert.equal(run.counts.droppedBatches, 8); assert.equal(run.counts.measurements, 27); assert.equal(run.counts.initialized, 4);
});

test('SLAM odometry baseline ignores repeats while keeping first map means and their correlation', () => {
  const run = createRun({ method: 'odometry' }), firstMeans = new Map();
  for (let step = 0; step < STEPS; step += 1) {
    stepRun(run);
    for (const entry of run.landmarks.filter((landmark) => landmark.initialized)) {
      if (!firstMeans.has(entry.id)) firstMeans.set(entry.id, [...entry.estimate]);
      else assert.deepEqual(entry.estimate, firstMeans.get(entry.id));
    }
    for (const update of run.updates.filter((entry) => entry.kind === 'ignored')) { assert.deepEqual(update.before, update.after); assert.equal(update.nis, null); }
  }
  assert.equal(run.counts.corrected, 0); assert.equal(run.counts.ignored, 32);
  assert.ok(run.metrics.poseMapCrossNorm > 0);
  const biased = runToEnd(createRun({ method: 'odometry', scenario: 'biased-range' }));
  closeArray(run.mean.slice(0, 3), biased.mean.slice(0, 3));
  closeArray(run.robot.covariance, biased.robot.covariance);
});

test('SLAM true midpoint path completes the specified circle independently of noisy estimation', () => {
  let pose = [...INITIAL_POSE];
  for (let step = 1; step <= STEPS; step += 1) {
    pose = motionModel(pose, { distance: TRUE_DISTANCE, turn: TRUE_TURN });
    closeArray(pose.slice(0, 2), truthAt(step).slice(0, 2));
    close(wrapAngle(pose[2] - truthAt(step)[2]), 0);
  }
  closeArray(pose.slice(0, 2), INITIAL_POSE.slice(0, 2));
  const run = runToEnd(createRun());
  assert.equal(run.step, STEPS); assert.equal(run.time, 32); assert.equal(run.history.length, STEPS + 1);
  const before = structuredClone(run); stepRun(run); assert.deepEqual(run, before);
  assert.deepEqual(runToEnd(createRun()), before);
});

test('SLAM map metrics use only initialized IDs and apply no truth alignment', () => {
  const run = createRun();
  assert.equal(run.metrics.mapRmse, null); assert.equal(run.metrics.mapRmsRadius, null);
  for (let step = 0; step < 4; step += 1) stepRun(run);
  assert.equal(run.metrics.mapCount, 1);
  const first = run.landmarks.find((entry) => entry.initialized);
  close(run.metrics.mapRmse, Math.hypot(first.estimate[0] - first.truth[0], first.estimate[1] - first.truth[1]));
  runToEnd(run);
  close(run.metrics.mapRmse ** 2, run.landmarks.reduce((sum, entry) => sum + (entry.estimate[0] - entry.truth[0]) ** 2 + (entry.estimate[1] - entry.truth[1]) ** 2, 0) / 4);
});

test('SLAM seeded comparisons expose biased-model failure without a universal per-run improvement claim', () => {
  const rows = referenceComparisons();
  assert.equal(rows.length, 6); assert.ok(rows.every((row) => row.steps === STEPS && row.metrics.mapCount === LANDMARKS.length));
  const biasedEkf = rows.find((row) => row.method === 'ekf' && row.scenario === 'biased-range');
  const nominalEkf = rows.find((row) => row.method === 'ekf' && row.scenario === 'nominal');
  const biasedBaseline = rows.find((row) => row.method === 'odometry' && row.scenario === 'biased-range');
  assert.ok(biasedEkf.metrics.mapRmse > biasedBaseline.metrics.mapRmse);
  assert.ok(biasedEkf.metrics.poseNees > 3 * nominalEkf.metrics.poseNees);
});

test('SLAM paired ensembles improve average errors and expose approximate rather than exact EKF consistency', () => {
  const trials = compareSeeds({ count: 200 });
  assert.ok(trials.methods.ekf.positionErrorRms < trials.methods.odometry.positionErrorRms / 3);
  assert.ok(trials.methods.ekf.mapErrorRms < trials.methods.odometry.mapErrorRms);
  assert.ok(trials.paired.ekfLowerPositionError < trials.count);
  assert.ok(trials.paired.ekfLowerMapError < trials.count);
  assert.equal(trials.paired.ekfLowerPositionError + trials.paired.ekfNotLowerPositionSeeds.length, trials.count);
  assert.ok(trials.methods.ekf.meanNis > 1.6 && trials.methods.ekf.meanNis < 2.4);
  assert.ok(trials.methods.ekf.meanPoseNees > 2 && trials.methods.ekf.meanPoseNees < 6);
  assert.equal(trials.methods.odometry.meanNis, null);
  for (const method of Object.keys(METHODS)) { assert.equal(trials.methods[method].mapCountMinimum, 4); assert.equal(trials.methods[method].mapCountMaximum, 4); }
  const seed = trials.paired.ekfNotLowerPositionSeeds[0];
  assert.ok(runToEnd(createRun({ method: 'ekf', seed })).metrics.positionError >= runToEnd(createRun({ method: 'odometry', seed })).metrics.positionError);
});

test('SLAM rejects unsupported configurations and excludes biased cases from ensemble diagnostics', () => {
  assert.throws(() => createRun({ method: 'unknown' }), /method/); assert.throws(() => createRun({ scenario: 'unknown' }), /scenario/);
  for (const seed of [-1, 1.1, NaN, 4294967296]) assert.throws(() => createRun({ seed }), /Seed/);
  assert.throws(() => compareSeeds({ scenario: 'biased-range' }), /biased/); assert.throws(() => compareSeeds({ count: 0 }), /Trial count/);
  assert.throws(() => augmentLandmark(fixture(), { id: 'known', value: [2, 0] }), /once/);
  assert.throws(() => observationModel(fixture(), 'missing'), /initialized/);
  assert.throws(() => augmentLandmark(fixture(), { id: 'new', value: [-1, 0] }), /positive/);
  close(DT * STEPS, 32);
});
