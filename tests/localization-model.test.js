import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_DT, LOCAL_SPEED, LOCAL_BUDGET, FIX_RETURN_STEP, WAYPOINT_TOLERANCE, GOAL_TOLERANCE,
  ODOMETRY_BIAS, PROCESS_VARIANCE, FIX_VARIANCE, ESTIMATORS, FIX_SCHEDULES, LOCAL_MAPS,
  fixAvailable, predictPosition, correctPosition, localizationObservation, createLocalizationRun,
  stepLocalization, resetLocalization, finishLocalization, summarizeLocalization,
  compareLocalization, compareLocalizationSeeds,
} from '../src/localization-model.js';
import { cellCenter, followWaypoint, pathDistance } from '../src/pathfinding-model.js';

const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const closeVector = (actual, expected) => actual.forEach((value, axis) => close(value, expected[axis]));
function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}
function advance(run, step) {
  while (run.status === 'following' && run.step < step) run = stepLocalization(run);
  assert.equal(run.step, step); return run;
}

test('identity-state prediction and Joseph correction match an independent two-axis Gaussian calculation', () => {
  const estimate = freezeTree([2, -3]), covariance = freezeTree([0.0099, 0.0024]), odometry = freezeTree([0.5, -0.25]);
  const predicted = freezeTree(predictPosition(estimate, covariance, odometry));
  closeVector(predicted.estimate, [2.5, -3.25]);
  closeVector(predicted.covariance, [0.01, 0.0025]);
  const measurement = freezeTree([3.5, -4.25]);
  const corrected = correctPosition(predicted, measurement);
  closeVector(corrected.innovation, [1, -1]);
  closeVector(corrected.gain, [0.8, 0.5]);
  closeVector(corrected.estimate, [3.3, -3.75]);
  closeVector(corrected.covariance, [0.002, 0.00125]);
  // Independent information-form posterior: precisions add. The two axes
  // deliberately have unequal priors so an axis-copy error is observable.
  for (let axis = 0; axis < 2; axis += 1) {
    const precision = 1 / predicted.covariance[axis] + 1 / FIX_VARIANCE;
    close(corrected.covariance[axis], 1 / precision);
    close(corrected.estimate[axis], (predicted.estimate[axis] / predicted.covariance[axis] + measurement[axis] / FIX_VARIANCE) / precision);
  }
  const known = correctPosition(freezeTree({ estimate: [7, -2], covariance: [0, 0] }), [100, 100]);
  assert.deepEqual(known.estimate, [7, -2]);
  assert.deepEqual(known.covariance, [0, 0]);
  assert.deepEqual(known.gain, [0, 0]);
  assert.deepEqual(estimate, [2, -3]);
  assert.deepEqual(covariance, [0.0099, 0.0024]);
});

test('missing fixes produce prediction only, retain an explicitly old fix, and correct on the restoration boundary', () => {
  assert.deepEqual(['steady', 'outage', 'recovery'].map((schedule) =>
    [0, 10, 20, 29, 30, 70, 79, 80, 81, 90].filter((step) => fixAvailable(schedule, step))), [
    [10, 20, 30, 70, 80, 90], [10, 20], [10, 20, 80, 90],
  ]);
  let run = createLocalizationRun({ estimator: 'kalman', schedule: 'recovery', map: 'u' });
  assert.equal(run.lastFix, null);
  assert.deepEqual(run.covariance, [0, 0]);
  let covarianceAt20;
  while (run.step < 90) {
    const previous = run;
    run = stepLocalization(run);
    const update = run.lastUpdate;
    assert.ok(run.covariance.every((value) => Number.isFinite(value) && value > 0));
    if ([10, 20, 80, 90].includes(run.step)) {
      assert.equal(update.type, 'correct');
      assert.equal(run.lastFix.step, run.step);
      assert.deepEqual(update.measurement, run.lastFix.position);
      assert.ok(run.covariance.every((value, axis) => value < update.predicted.covariance[axis]));
      assert.ok(update.gain.every((value) => value > 0 && value < 1));
    } else {
      assert.equal(update.type, 'predict');
      assert.equal(update.measurement, null);
      assert.equal(update.gain, null);
      assert.equal(update.innovation, null);
      closeVector(run.estimate, previous.estimate.map((value, axis) => value + update.odometry[axis]));
      closeVector(run.covariance, previous.covariance.map((value) => value + PROCESS_VARIANCE));
    }
    if (run.step === 20) covarianceAt20 = [...run.covariance];
    if (run.step >= 30 && run.step < 80) {
      assert.equal(run.lastFix.step, 20);
      assert.equal(run.fixCount, 2);
      assert.equal(run.usedFixCount, 2);
      closeVector(run.covariance, covarianceAt20.map((value) => value + (run.step - 20) * PROCESS_VARIANCE));
    }
  }
  assert.deepEqual(run.events.filter(({ type }) => ['lost', 'restored'].includes(type)), [
    { step: 30, type: 'lost' }, { step: 80, type: 'restored' },
  ]);
  assert.equal(run.usedFixCount, 4);
  const permanent = advance(createLocalizationRun({ estimator: 'kalman', schedule: 'outage', map: 'u' }), 90);
  assert.equal(permanent.lastUpdate.type, 'predict');
  assert.equal(permanent.lastFix.step, 20);
  assert.equal(permanent.usedFixCount, 2);
});

test('paired seeds keep sensor noise aligned across estimators, fix schedules, and the bias switch', () => {
  for (const seed of [1, 17]) {
    let runs = Object.keys(ESTIMATORS).flatMap((estimator) => Object.keys(FIX_SCHEDULES).map((schedule) =>
      createLocalizationRun({ estimator, schedule, map: 'u', seed })));
    runs.push(createLocalizationRun({ estimator: 'kalman', schedule: 'recovery', map: 'u', seed, bias: false }));
    for (let step = 1; step <= 90; step += 1) {
      const previous = runs;
      runs = runs.map(stepLocalization);
      const baseline = runs[0];
      assert.ok(runs.every((run) => run.step === step && run.rng === baseline.rng));
      const odometryNoise = (run, before) => run.lastUpdate.odometry.map((reading, axis) =>
        reading - (run.position[axis] - before.position[axis]) - (run.initial.bias ? ODOMETRY_BIAS[axis] * LOCAL_DT : 0));
      const expectedNoise = odometryNoise(baseline, previous[0]);
      runs.forEach((run, index) => {
        closeVector(odometryNoise(run, previous[index]), expectedNoise);
        if (run.lastUpdate.measurement) {
          assert.ok(baseline.lastUpdate.measurement);
          closeVector(run.lastUpdate.measurement.map((value, axis) => value - run.position[axis]),
            baseline.lastUpdate.measurement.map((value, axis) => value - baseline.position[axis]));
        }
      });
    }
    for (const estimator of ['exact', 'dead']) {
      const [steady, outage, recovery] = runs.filter((run) => run.initial.estimator === estimator);
      assert.deepEqual(steady.position, outage.position);
      assert.deepEqual(steady.position, recovery.position);
      assert.deepEqual(steady.estimate, outage.estimate);
      assert.equal(steady.usedFixCount, 0);
      assert.ok(steady.fixCount > outage.fixCount);
    }
  }
  const first = stepLocalization(createLocalizationRun({ seed: 1 }));
  const second = stepLocalization(createLocalizationRun({ seed: 2 }));
  assert.notDeepEqual(first.lastUpdate.odometry, second.lastUpdate.odometry);
});

test('the follower receives only the estimate and current waypoint; only the named oracle copies true pose', () => {
  const run = advance(createLocalizationRun({ estimator: 'kalman', schedule: 'outage' }), 45);
  assert.notDeepEqual(run.position, run.estimate);
  const observation = localizationObservation(run);
  assert.deepEqual(Object.keys(observation).sort(), ['dt', 'position', 'speed', 'waypoint']);
  assert.deepEqual(observation.position, run.estimate);
  const minimal = { estimate: run.estimate, waypointIndex: run.waypointIndex, plan: { waypoints: run.plan.waypoints } };
  assert.deepEqual(localizationObservation(minimal), observation);
  const contaminated = { ...run, position: [999, -999], grid: null, history: null, events: null,
    initial: { bias: false, seed: -1, schedule: 'steady', estimator: 'exact' }, rng: -1, covariance: [999, 999],
    lastFix: { step: 900, position: [-999, 999] }, status: 'arrived', distance: -999, controllerFinished: true };
  assert.deepEqual(localizationObservation(contaminated), observation);
  assert.deepEqual(followWaypoint(localizationObservation(contaminated)), followWaypoint(observation));
  observation.position[0] = 999;
  observation.waypoint[0] = 999;
  assert.notEqual(run.estimate[0], 999);
  assert.notEqual(run.plan.waypoints[run.waypointIndex][0], 999);
  for (const schedule of Object.keys(FIX_SCHEDULES)) {
    const oracle = advance(createLocalizationRun({ estimator: 'exact', map: 'u', schedule, seed: 7 }), 90);
    assert.equal(oracle.lastUpdate.type, 'oracle');
    assert.equal(oracle.covariance, null);
    assert.equal(oracle.usedFixCount, 0);
    assert.ok(oracle.history.every((point) => point.error === 0));
    assert.deepEqual(oracle.position, oracle.estimate);
    assert.notEqual(oracle.position, oracle.estimate);
  }
});

test('arrival is a controller claim evaluated against true goal distance and never resumes for a future fix', () => {
  const makeClaim = (trueDistance) => {
    const run = createLocalizationRun({ estimator: 'dead', map: 'open', bias: false });
    const goal = cellCenter(run.grid.goal, run.grid.width);
    return stepLocalization({ ...run, position: [goal[0] + trueDistance, goal[1]], estimate: [...goal],
      plan: { ...run.plan, waypoints: [goal] } });
  };
  const inside = makeClaim(GOAL_TOLERANCE), outside = makeClaim(GOAL_TOLERANCE + 1e-6);
  for (const run of [inside, outside]) {
    assert.equal(run.controllerFinished, true);
    assert.ok(run.history.at(-1).estimatedGoalDistance <= WAYPOINT_TOLERANCE);
    assert.equal(run.distance, 0);
  }
  assert.equal(inside.status, 'arrived');
  assert.equal(outside.status, 'false-arrival');
  const recovery = finishLocalization(createLocalizationRun({ estimator: 'kalman', schedule: 'recovery', map: 'open' }));
  const outage = finishLocalization(createLocalizationRun({ estimator: 'kalman', schedule: 'outage', map: 'open' }));
  assert.equal(recovery.status, 'false-arrival');
  assert.ok(recovery.step < FIX_RETURN_STEP);
  assert.equal(recovery.lastFix.step, 20);
  assert.deepEqual(recovery.history, outage.history);
  assert.ok(!recovery.events.some(({ type }) => type === 'restored'));
  for (let index = 0; index < 100; index += 1) assert.equal(stepLocalization(recovery), recovery);
  assert.equal(finishLocalization(recovery), recovery);
});

test('physical motion obeys its speed bound and swept contact clips the displacement delivered to odometry', () => {
  for (const map of Object.keys(LOCAL_MAPS)) for (const estimator of Object.keys(ESTIMATORS)) for (const schedule of Object.keys(FIX_SCHEDULES)) {
    let run = createLocalizationRun({ map, estimator, schedule });
    while (run.status === 'following') {
      const previous = run;
      run = stepLocalization(run);
      const moved = pathDistance(previous.position, run.position);
      assert.ok(moved <= LOCAL_SPEED * LOCAL_DT + 1e-12);
      assert.ok(Math.hypot(...run.lastUpdate.command) <= LOCAL_SPEED * LOCAL_DT + 1e-12);
      close(run.distance - previous.distance, moved);
      assert.equal(run.step, previous.step + 1);
      assert.equal(run.history.length, run.step + 1);
      if (run.waypointIndex > previous.waypointIndex) {
        assert.equal(run.waypointIndex, previous.waypointIndex + 1);
        assert.ok(pathDistance(run.estimate, previous.plan.waypoints[previous.waypointIndex]) <= WAYPOINT_TOLERANCE + 1e-12);
      }
    }
  }
  // These poses exercise contact independently of which stochastic reference
  // trajectories happen to encounter a wall. Its closed face is x = 5 or 6.
  for (const [position, target, stoppedX, fraction] of [
    [[4.95, 4.5], [5.5, 4.5], 5, 0.5],
    [[6.05, 4.5], [5.5, 4.5], 6, 0.5],
    [[5, 4.5], [5.5, 4.5], 5, 0],
  ]) {
    const initial = createLocalizationRun({ estimator: 'dead', map: 'u', bias: false });
    const fixture = { ...initial, position, estimate: [...position], plan: { ...initial.plan, waypoints: [target] } };
    const unobstructed = stepLocalization({ ...fixture, grid: { ...fixture.grid, blocked: [] } });
    const stopped = stepLocalization(freezeTree(fixture));
    assert.equal(stopped.status, 'collision');
    assert.equal(stopped.contact.cell, 53);
    close(stopped.contact.fraction, fraction);
    closeVector(stopped.position, [stoppedX, 4.5]);
    close(stopped.distance, 0.1 * fraction);
    closeVector(stopped.lastUpdate.odometry, unobstructed.lastUpdate.odometry.map((reading, axis) =>
      reading + stopped.position[axis] - unobstructed.position[axis]));
    assert.equal(stopped.controllerFinished, false);
    assert.equal(stepLocalization(stopped), stopped);
  }
});

test('transitions preserve frozen inputs, reset repeats seeded execution, and the finite budget stops motion', () => {
  for (const estimator of Object.keys(ESTIMATORS)) for (const schedule of Object.keys(FIX_SCHEDULES)) {
    const initial = freezeTree(createLocalizationRun({ estimator, schedule, seed: 12 }));
    const before = structuredClone(initial);
    const next = stepLocalization(initial);
    assert.notEqual(next, initial);
    assert.deepEqual(initial, before);
    const atCorrection = freezeTree(advance(next, 79)), original = structuredClone(atCorrection);
    const correction = stepLocalization(atCorrection);
    assert.deepEqual(atCorrection, original);
    assert.notEqual(correction.history, atCorrection.history);
    assert.notEqual(correction.events, atCorrection.events);
    const final = freezeTree(finishLocalization(correction));
    assert.deepEqual(resetLocalization(final), initial);
    assert.deepEqual(finishLocalization(resetLocalization(final)), final);
    assert.equal(stepLocalization(final), final);
    assert.equal(finishLocalization(final), final);
  }
  const nearBudget = freezeTree({ ...createLocalizationRun({ map: 'open' }), step: LOCAL_BUDGET - 1 });
  const budget = stepLocalization(nearBudget);
  assert.equal(budget.step, LOCAL_BUDGET);
  assert.equal(budget.status, 'budget');
  assert.equal(budget.controllerFinished, false);
  assert.equal(stepLocalization(budget), budget);
  assert.equal(finishLocalization(budget), budget);
});

test('configuration rejects unknown methods, schedules, maps and invalid seeds or bias values', () => {
  for (const key of ['estimator', 'schedule', 'map']) for (const value of ['', null, 'missing', 'toString', '__proto__', 1]) {
    assert.throws(() => createLocalizationRun({ [key]: value }), RangeError);
  }
  for (const seed of [0, -1, 1.5, '1', null, NaN, Infinity, 1000001]) assert.throws(() => createLocalizationRun({ seed }), RangeError);
  for (const bias of [0, 1, 'true', null, [], {}]) assert.throws(() => createLocalizationRun({ bias }), RangeError);
  assert.equal(createLocalizationRun({ seed: 1000000, bias: false }).initial.seed, 1000000);
  assert.equal(createLocalizationRun().initial.seed, 1);
});

test('the ten seed-1 references separate truthful arrival, false arrival, and a restoration too late to act', () => {
  const rows = compareLocalization();
  assert.deepEqual(rows.map(({ map, estimator, schedule }) => `${map}:${estimator}:${schedule}`), [
    'open:exact:steady', 'open:dead:steady', 'open:kalman:steady', 'open:kalman:outage', 'open:kalman:recovery',
    'u:exact:steady', 'u:dead:steady', 'u:kalman:steady', 'u:kalman:outage', 'u:kalman:recovery',
  ]);
  assert.deepEqual(rows.map(({ step }) => step), [69, 65, 69, 66, 66, 168, 164, 169, 164, 173]);
  assert.deepEqual(rows.map(({ status }) => status), [
    'arrived', 'false-arrival', 'arrived', 'false-arrival', 'false-arrival',
    'arrived', 'false-arrival', 'arrived', 'false-arrival', 'arrived',
  ]);
  assert.deepEqual(rows.map(({ usedFixCount }) => usedFixCount), [0, 0, 6, 2, 2, 0, 0, 16, 2, 12]);
  for (const row of rows) {
    assert.equal(row.controllerFinished, true);
    assert.equal(row.contact, null);
    close(row.time, row.step * LOCAL_DT);
    assert.ok(row.estimatedGoalDistance <= WAYPOINT_TOLERANCE + 1e-12);
    assert.equal(row.actualGoalDistance <= GOAL_TOLERANCE, row.status === 'arrived');
    assert.ok(row.finalError <= row.maxError && row.rmsError <= row.maxError);
    if (row.estimator === 'exact') assert.equal(row.rmsError, 0);
  }
  const run = finishLocalization(createLocalizationRun({ estimator: 'kalman', map: 'u', schedule: 'recovery' }));
  const summary = summarizeLocalization(run);
  const errors = run.history.map(({ position, estimate }) => Math.hypot(position[0] - estimate[0], position[1] - estimate[1]));
  close(summary.rmsError, Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / (run.step + 1)));
  close(summary.maxError, Math.max(...errors));
  close(summary.finalError, errors.at(-1));
  assert.equal(run.history[0].error, 0);
});

test('200 paired trials reproduce the declared mixed outcomes without treating low filter error as guaranteed arrival', () => {
  const comparison = compareLocalizationSeeds();
  assert.deepEqual(comparison.seeds, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(comparison.trials.length, 200);
  assert.equal(comparison.groups.length, 10);
  assert.deepEqual(comparison.groups.map(({ outcomes }) => outcomes.arrived), [20, 0, 15, 0, 0, 20, 0, 19, 0, 20]);
  assert.deepEqual(comparison.groups.map(({ outcomes }) => outcomes['false-arrival']), [0, 20, 5, 20, 20, 0, 20, 1, 20, 0]);
  for (const group of comparison.groups) {
    const matching = comparison.trials.filter((trial) => trial.map === group.map && trial.estimator === group.estimator && trial.schedule === group.schedule);
    assert.equal(group.trials, 20);
    assert.equal(new Set(matching.map(({ seed }) => seed)).size, 20);
    assert.equal(Object.values(group.outcomes).reduce((sum, count) => sum + count, 0), 20);
    assert.equal(group.outcomes.collision, 0);
    assert.equal(group.outcomes.budget, 0);
    close(group.meanRmsError, matching.reduce((sum, { rmsError }) => sum + rmsError, 0) / 20);
    close(group.worstError, Math.max(...matching.map(({ maxError }) => maxError)));
  }
  for (const map of Object.keys(LOCAL_MAPS)) {
    const group = (estimator, schedule) => comparison.groups.find((row) => row.map === map && row.estimator === estimator && row.schedule === schedule);
    assert.ok(group('kalman', 'steady').meanRmsError < group('dead', 'steady').meanRmsError);
    assert.ok(group('kalman', 'steady').outcomes['false-arrival'] > 0);
  }
});
