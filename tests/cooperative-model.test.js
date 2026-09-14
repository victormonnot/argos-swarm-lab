import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, STEPS, ODOMETRY_STD, INITIAL_STD, RELATIVE_STD, ANCHOR_STD, SHARED_SHIFT, RELATIVE_H, METHODS, SCENARIOS, createRun, stepRun, runToEnd, kalmanUpdate, derivedCovariances, referenceComparisons, compareSeeds } from '../src/cooperative-model.js';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
function closeArray(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => Array.isArray(value) ? closeArray(value, expected[index], tolerance) : close(value, expected[index], tolerance));
}
const center = (mean) => [(mean[0] + mean[2]) / 2, (mean[1] + mean[3]) / 2];
const identity = (size) => Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => Number(i === j)));
const zeros = (size) => identity(size).map((row) => row.map(() => 0));

// Independent test oracle: Gaussian elimination with partial pivoting, not
// the implementation's Cholesky/Joseph recursion.
function solve(matrix, vector) {
  const augmented = matrix.map((row, i) => [...row, vector[i]]), size = vector.length;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    assert.ok(Math.abs(augmented[column][column]) > 1e-12);
    const divisor = augmented[column][column];
    for (let j = column; j <= size; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < size; row += 1) if (row !== column) {
      const factor = augmented[row][column];
      for (let j = column; j <= size; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[size]);
}
const inverse = (matrix) => {
  const columns = identity(matrix.length).map((column) => solve(matrix, column));
  return columns[0].map((_, i) => columns.map((column) => column[i]));
};
function assertPositiveDefinite(P) {
  // Sylvester's criterion using elimination determinants for every
  // leading principal submatrix, independent of the estimator's solver.
  for (let size = 1; size <= P.length; size += 1) {
    const a = P.slice(0, size).map((row) => row.slice(0, size));
    let determinant = 1;
    for (let i = 0; i < size; i += 1) {
      const pivot = a[i][i];
      determinant *= pivot;
      for (let row = i + 1; row < size; row += 1) {
        const factor = a[row][i] / pivot;
        for (let j = i + 1; j < size; j += 1) a[row][j] -= factor * a[i][j];
      }
    }
    assert.ok(determinant > 0 && Number.isFinite(determinant));
  }
}

function batchPosterior(run, steps) {
  const size = 4 * (steps + 1), information = zeros(size), informationMean = Array(size).fill(0);
  function factor(coefficients, observation, variance) {
    for (const [i, hi] of coefficients) {
      informationMean[i] += hi * observation / variance;
      for (const [j, hj] of coefficients) information[i][j] += hi * hj / variance;
    }
  }
  run.evaluator.initialMean.forEach((value, index) => factor([[index, 1]], value, INITIAL_STD ** 2));
  for (let step = 1; step <= steps; step += 1) {
    const sample = run.evaluator.tape[step - 1], offset = 4 * step;
    sample.odometry.flat().forEach((value, axis) => factor([[offset + axis, 1], [offset - 4 + axis, -1]], value, ODOMETRY_STD ** 2));
    if (sample.relative?.available && run.config.method === 'joint') sample.relative.value.forEach((value, axis) => factor([[offset + axis, -1], [offset + axis + 2, 1]], value, RELATIVE_STD ** 2));
    if (sample.anchor?.available) sample.anchor.value.forEach((value, axis) => factor([[offset + axis, 1]], value, ANCHOR_STD ** 2));
  }
  const fullMean = solve(information, informationMean), offset = steps * 4;
  const columns = Array.from({ length: 4 }, (_, axis) => solve(information, Array.from({ length: size }, (_, index) => Number(index === offset + axis))));
  return { mean: fullMean.slice(offset), P: Array.from({ length: 4 }, (_, i) => columns.map((column) => column[offset + i])) };
}

test('cooperative filter replays the same initialized run and stops at the observation budget', () => {
  const a = runToEnd(createRun()), b = runToEnd(createRun());
  assert.deepEqual(a, b);
  assert.equal(a.step, STEPS);
  assert.equal(a.time, 20);
  assert.equal(a.history.length, STEPS + 1);
  assert.equal(a.agents[0].truthTrail.length, STEPS + 1);
  const finished = structuredClone(a);
  assert.equal(stepRun(a), a);
  assert.deepEqual(a, finished);
});

test('cooperative recursive posterior matches a full trajectory weighted least-squares oracle', () => {
  for (const method of Object.keys(METHODS)) for (const scenario of ['anchored', 'unanchored', 'anchor-restored']) {
    const run = createRun({ method, scenario, seed: 29 });
    const expected = batchPosterior(run, 8);
    for (let step = 0; step < 8; step += 1) stepRun(run);
    closeArray(run.mean, expected.mean, 2e-11);
    closeArray(run.P, expected.P, 2e-11);
  }
});

test('cooperative correction matches information form with nonzero cross-axis correlations', () => {
  const state = { mean: [-1, 2, 3, -4], P: [[1.1, 0.2, 0.3, -0.1], [0.2, 1.3, -0.1, 0.25], [0.3, -0.1, 0.9, 0.15], [-0.1, 0.25, 0.15, 1.2]] };
  const R = [[0.1, 0], [0, 0.2]], observation = [1.2, -2.1], H = RELATIVE_H;
  const priorInformation = inverse(state.P), information = structuredClone(priorInformation);
  const eta = priorInformation.map((row) => row.reduce((sum, value, i) => sum + value * state.mean[i], 0));
  for (let m = 0; m < 2; m += 1) for (let i = 0; i < 4; i += 1) {
    eta[i] += H[m][i] * observation[m] / R[m][m];
    for (let j = 0; j < 4; j += 1) information[i][j] += H[m][i] * H[m][j] / R[m][m];
  }
  const original = structuredClone(state), update = kalmanUpdate(state, observation, H, R);
  closeArray(update.after.mean, solve(information, eta));
  closeArray(update.after.P, inverse(information));
  assert.deepEqual(state, original);
});

test('cooperative covariance stays symmetric positive definite through every scenario and posterior stage', () => {
  for (const method of Object.keys(METHODS)) for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ method, scenario });
    for (let step = 0; step < STEPS; step += 1) {
      stepRun(run);
      for (const { P } of Object.values(run.snapshots)) {
        P.forEach((row, i) => row.forEach((value, j) => { assert.ok(Number.isFinite(value)); close(value, P[j][i], 1e-13); }));
        assertPositiveDefinite(P);
      }
    }
  }
});

test('relative observations preserve the unanchored symmetric common mode and cannot sense a shared translation', () => {
  closeArray(RELATIVE_H.map((row) => row.reduce((sum, value, i) => sum + value * [2, -1.5, 2, -1.5][i], 0)), [0, 0]);
  const run = createRun({ scenario: 'unanchored' });
  for (let step = 1; step <= STEPS; step += 1) {
    stepRun(run);
    const covariance = derivedCovariances(run.P).center, expected = (INITIAL_STD ** 2 + step * ODOMETRY_STD ** 2) / 2;
    closeArray(covariance, [[expected, 0], [0, expected]]);
    closeArray(center(run.snapshots.predicted.mean), center(run.snapshots.afterRelative.mean));
  }
  assert.ok(run.metrics.relativeRmsRadius < 0.2);
  assert.ok(run.metrics.centerRmsRadius > 1);
});

test('the deliberately shifted unanchored prior translates every posterior without changing covariance or relative residuals', () => {
  for (const method of Object.keys(METHODS)) {
    const normal = createRun({ method, scenario: 'unanchored' }), shifted = createRun({ method, scenario: 'unanchored', priorShift: 'shared' });
    for (let step = 0; step < STEPS; step += 1) {
      stepRun(normal); stepRun(shifted);
      closeArray(shifted.mean.map((value, i) => value - normal.mean[i]), [...SHARED_SHIFT, ...SHARED_SHIFT]);
      closeArray(shifted.P, normal.P);
      close(shifted.metrics.relativeError, normal.metrics.relativeError);
      if (normal.updates[0]) closeArray(shifted.updates[0].innovation, normal.updates[0].innovation);
    }
  }
});

test('retained cross-covariance lets A1 absolute fixes correct A2, unlike the independent baseline', () => {
  const joint = createRun(), independent = createRun({ method: 'independent' });
  for (let step = 0; step < 4; step += 1) { stepRun(joint); stepRun(independent); }
  assert.deepEqual(joint.updates.map((update) => update.kind), ['relative', 'anchor']);
  const anchor = joint.updates[1];
  assert.ok(Math.hypot(...anchor.correction.slice(2)) > 0.01);
  assert.ok(anchor.K[2][0] > 0);
  closeArray(independent.updates[0].correction.slice(2), [0, 0]);
  assert.equal(independent.metrics.crossCovarianceNorm, 0);
  assert.ok(joint.metrics.crossCovarianceNorm > 0);
  assert.deepEqual(anchor.before, joint.updates[0].after);
  assert.deepEqual(joint.snapshots.afterRelative, joint.updates[0].after);
  assert.deepEqual(joint.snapshots.afterAnchor, anchor.after);
});

test('relative updates may change the center after an absolute fix has broken prior symmetry', () => {
  const run = createRun();
  for (let step = 0; step < 8; step += 1) stepRun(run);
  const before = center(run.snapshots.predicted.mean), after = center(run.snapshots.afterRelative.mean);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-5);
});

test('all methods and scenarios receive identical odometry and matching available raw measurements for a seed', () => {
  const baseline = createRun({ method: 'joint', scenario: 'anchored', seed: 17 });
  for (const method of Object.keys(METHODS)) for (const scenario of Object.keys(SCENARIOS)) {
    const run = createRun({ method, scenario, seed: 17 });
    assert.deepEqual(run.mean, baseline.mean);
    run.evaluator.tape.forEach((sample, index) => {
      const expected = baseline.evaluator.tape[index];
      assert.deepEqual(sample.odometry, expected.odometry);
      assert.deepEqual(sample.truth, expected.truth);
      for (const kind of ['relative', 'anchor']) if (sample[kind]?.available) assert.deepEqual(sample[kind].value, expected[kind].value);
    });
  }
});

test('estimation depends on observation packets rather than evaluator position truth', () => {
  const normal = createRun(), modifiedTruth = createRun();
  modifiedTruth.evaluator.tape.forEach((sample) => { sample.truth = [[100, 200], [300, 400]]; });
  runToEnd(normal); runToEnd(modifiedTruth);
  assert.deepEqual(normal.mean, modifiedTruth.mean);
  assert.deepEqual(normal.P, modifiedTruth.P);
  assert.notEqual(normal.metrics.positionRmse, modifiedTruth.metrics.positionRmse);
});

test('relative outage omits exactly the five scheduled samples and independent filtering is unaffected', () => {
  const outage = createRun({ scenario: 'relative-outage' }), missingTimes = [];
  for (let step = 0; step < STEPS; step += 1) {
    stepRun(outage);
    if (outage.observations.relative && !outage.observations.relative.available) missingTimes.push(outage.time);
  }
  assert.deepEqual(missingTimes, [5, 6, 7, 8, 9]);
  assert.deepEqual(outage.counts, { relativeAvailable: 15, relativeUsed: 15, anchorAvailable: 20, anchorUsed: 20 });
  const ordinary = runToEnd(createRun({ method: 'independent' })), independentOutage = runToEnd(createRun({ method: 'independent', scenario: 'relative-outage' }));
  assert.deepEqual(ordinary.mean, independentOutage.mean);
  assert.deepEqual(ordinary.P, independentOutage.P);
  assert.deepEqual(ordinary.history, independentOutage.history);
});

test('absolute restoration first applies at 10 seconds after relative correction and reduces shifted center error', () => {
  const run = createRun({ scenario: 'anchor-restored', priorShift: 'shared' });
  for (let step = 0; step < 39; step += 1) stepRun(run);
  assert.equal(run.counts.anchorUsed, 0);
  const before = run.metrics.centerError;
  stepRun(run);
  assert.equal(run.time, 10);
  assert.deepEqual(run.updates.map((update) => update.kind), ['relative', 'anchor']);
  assert.equal(run.counts.anchorUsed, 1);
  assert.ok(run.metrics.centerError < before / 4);
  assert.ok(Math.hypot(...run.updates[1].correction.slice(2)) > 1);
  runToEnd(run);
  assert.equal(run.counts.anchorUsed, 11);
});

test('predicted and posterior metrics use covariance of relative and center variables with correct dimensions', () => {
  const run = createRun();
  close(run.metrics.positionRmsRadius, Math.sqrt(2) * INITIAL_STD);
  close(run.metrics.relativeRmsRadius, 2 * INITIAL_STD);
  close(run.metrics.centerRmsRadius, INITIAL_STD);
  for (let step = 0; step < 4; step += 1) stepRun(run);
  const error = run.mean.map((value, i) => value - run.agents[Math.floor(i / 2)].truth[i % 2]);
  close(run.metrics.positionRmse ** 2, error.reduce((sum, value) => sum + value * value, 0) / 2);
  close(run.metrics.positionRmse ** 2, run.metrics.centerError ** 2 + run.metrics.relativeError ** 2 / 4);
  close(run.metrics.positionRmsRadius ** 2, run.metrics.centerRmsRadius ** 2 + run.metrics.relativeRmsRadius ** 2 / 4);
});

test('reference cases include normal and deliberately biased restoration comparisons without mutating live runs', () => {
  const live = createRun(); stepRun(live);
  const before = structuredClone(live), rows = referenceComparisons();
  assert.equal(rows.length, 12);
  assert.ok(rows.some((row) => row.scenario === 'anchor-restored' && row.priorShift === 'shared'));
  assert.ok(rows.every((row) => row.steps === STEPS && row.time === DT * STEPS));
  assert.deepEqual(live, before);
});

test('paired calibrated trials match predicted error and NEES/NIS in anchored and unanchored settings', () => {
  for (const scenario of ['anchored', 'unanchored']) {
    const trials = compareSeeds({ scenario, count: 200 });
    for (const method of Object.keys(METHODS)) {
      const results = trials.methods[method];
      assert.ok(results.meanNees > 3.4 && results.meanNees < 4.6);
      assert.ok(Math.abs(results.positionErrorRms / results.reported.positionRmsRadius - 1) < 0.12);
      if (results.meanRelativeNis !== null) assert.ok(Math.abs(results.meanRelativeNis - 2) < 0.2);
      if (results.meanAnchorNis !== null) assert.ok(Math.abs(results.meanAnchorNis - 2) < 0.2);
    }
    assert.ok(trials.methods.joint.relativeErrorRms < trials.methods.independent.relativeErrorRms / 5);
    if (scenario === 'anchored') {
      assert.ok(trials.methods.joint.positionErrorRms < trials.methods.independent.positionErrorRms / 4);
      assert.ok(trials.paired.jointLowerPositionError < trials.count, 'Some realized trials should demonstrate that lower expected error is not a per-run guarantee.');
      assert.equal(trials.paired.jointLowerPositionError + trials.paired.jointNotLowerPositionSeeds.length, trials.count);
      for (const seed of trials.paired.jointNotLowerPositionSeeds) {
        const joint = runToEnd(createRun({ method: 'joint', scenario, seed }));
        const independent = runToEnd(createRun({ method: 'independent', scenario, seed }));
        assert.ok(joint.metrics.positionRmse >= independent.metrics.positionRmse);
      }
    } else close(trials.methods.joint.centerErrorRms, trials.methods.independent.centerErrorRms);
  }
});

test('cooperative model validates configuration and excludes misspecified priors from calibration', () => {
  assert.throws(() => createRun({ method: 'unknown' }), /method/);
  assert.throws(() => createRun({ scenario: 'unknown' }), /scenario/);
  assert.throws(() => createRun({ priorShift: 'unknown' }), /prior shift/);
  for (const seed of [-1, 0.5, NaN, 4294967296]) assert.throws(() => createRun({ seed }), /Seed/);
  assert.doesNotThrow(() => createRun({ seed: 0 }));
  assert.throws(() => compareSeeds({ priorShift: 'shared' }), /correctly specified/);
  assert.throws(() => compareSeeds({ count: 0 }), /Trial count/);
});
