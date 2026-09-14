import { pathGrid, searchGrid, cellCenter, pathDistance, followWaypoint, segmentGridContact, PATH_DT, PATH_SPEED } from './pathfinding-model.js';

export const LOCAL_DT = PATH_DT;
export const LOCAL_SPEED = PATH_SPEED;
export const LOCAL_BUDGET = 400;
export const FIX_PERIOD = 10;
export const FIX_LOSS_STEP = 30;
export const FIX_RETURN_STEP = 80;
export const WAYPOINT_TOLERANCE = 0.10;
export const GOAL_TOLERANCE = 0.25;
export const ODOMETRY_SIGMA = 0.01;
export const FIX_SIGMA = 0.05;
export const PROCESS_VARIANCE = ODOMETRY_SIGMA ** 2;
export const FIX_VARIANCE = FIX_SIGMA ** 2;
export const ODOMETRY_BIAS = Object.freeze([0.08, 0.04]);
export const ESTIMATORS = Object.freeze({ exact: 'Exact-position reference', dead: 'Dead reckoning', kalman: 'Linear Kalman filter' });
export const FIX_SCHEDULES = Object.freeze({ steady: 'Fix every 1 s', outage: 'Fixes stop at 3 s', recovery: 'Stop at 3 s · resume at 8 s' });
export const LOCAL_MAPS = Object.freeze({ open: 'Open grid', u: 'U-shaped obstacle' });
export const LOCAL_SEEDS = Object.freeze(Array.from({ length: 20 }, (_, index) => index + 1));

export function fixAvailable(schedule, step) {
  return step > 0 && step % FIX_PERIOD === 0 && (schedule === 'steady' || step < FIX_LOSS_STEP || (schedule === 'recovery' && step >= FIX_RETURN_STEP));
}
// Two Box–Muller pairs from four LCG uniforms per interval. All estimators and
// schedules consume the same draws at a given seed/step, including missing fixes.
function noiseSample(state) {
  const uniform = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  const normalPair = () => { const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform(); return [radius * Math.cos(angle), radius * Math.sin(angle)]; };
  return { odometry: normalPair(), absolute: normalPair(), state };
}
export function predictPosition(estimate, covariance, odometry) {
  return { estimate: estimate.map((value, axis) => value + odometry[axis]), covariance: covariance.map((value) => value + PROCESS_VARIANCE) };
}
export function correctPosition(predicted, measurement) {
  const innovation = measurement.map((value, axis) => value - predicted.estimate[axis]);
  const gain = predicted.covariance.map((value) => value / (value + FIX_VARIANCE));
  return { estimate: predicted.estimate.map((value, axis) => value + gain[axis] * innovation[axis]),
    covariance: predicted.covariance.map((value, axis) => (1 - gain[axis]) ** 2 * value + gain[axis] ** 2 * FIX_VARIANCE), innovation, gain };
}
/** Complete controller input. True pose, bias, noise seed, future fixes and
 * evaluator status never enter the waypoint follower. */
export function localizationObservation(run) {
  return { position: [...run.estimate], waypoint: run.plan.waypoints[run.waypointIndex] ? [...run.plan.waypoints[run.waypointIndex]] : null, speed: LOCAL_SPEED, dt: LOCAL_DT };
}
function snapshot(run) {
  const goal = cellCenter(run.grid.goal, run.grid.width), error = pathDistance(run.position, run.estimate);
  return { step: run.step, time: run.step * LOCAL_DT, position: [...run.position], estimate: [...run.estimate], covariance: run.covariance ? [...run.covariance] : null,
    error, actualGoalDistance: pathDistance(run.position, goal), estimatedGoalDistance: pathDistance(run.estimate, goal), distance: run.distance, fixStep: run.lastFix?.step ?? null };
}
export function createLocalizationRun({ estimator = 'kalman', schedule = 'steady', map = 'u', seed = 1, bias = true } = {}) {
  if (!Object.hasOwn(ESTIMATORS, estimator) || !Object.hasOwn(FIX_SCHEDULES, schedule) || !Object.hasOwn(LOCAL_MAPS, map)) throw new RangeError('Unknown localization configuration.');
  if (!Number.isInteger(seed) || seed < 1 || seed > 1000000 || typeof bias !== 'boolean') throw new RangeError('Seed must be an integer from 1 to 1000000; bias must be boolean.');
  const grid = pathGrid(map), plan = searchGrid(grid), position = cellCenter(grid.start, grid.width);
  const run = { initial: { estimator, schedule, map, seed, bias }, grid, plan, position, estimate: [...position], covariance: estimator === 'kalman' ? [0, 0] : null,
    step: 0, waypointIndex: 0, status: 'following', controllerFinished: false, contact: null, distance: 0,
    rng: seed, lastFix: null, lastUpdate: null, fixCount: 0, usedFixCount: 0, history: [], events: [] };
  run.history.push(snapshot(run)); return run;
}
export function stepLocalization(run) {
  if (run.status !== 'following') return run;
  const observation = localizationObservation(run), nextEstimateTarget = followWaypoint(observation);
  const command = nextEstimateTarget.map((value, axis) => value - run.estimate[axis]);
  const proposed = run.position.map((value, axis) => value + command[axis]);
  const contact = segmentGridContact(run.position, proposed, run.grid);
  const position = contact ? run.position.map((value, axis) => value + contact.fraction * command[axis]) : proposed;
  const next = { ...run, step: run.step + 1, position, contact, distance: run.distance + pathDistance(run.position, position), history: [...run.history], events: [...run.events] };
  const noise = noiseSample(run.rng); next.rng = noise.state;
  // Sensor synthesis may use physical truth; only the resulting readings are
  // delivered to the estimator. A contact clips actual measured displacement.
  const odometry = position.map((value, axis) => value - run.position[axis] + (run.initial.bias ? ODOMETRY_BIAS[axis] * LOCAL_DT : 0) + noise.odometry[axis] * ODOMETRY_SIGMA);
  const measurement = fixAvailable(run.initial.schedule, next.step) ? position.map((value, axis) => value + noise.absolute[axis] * FIX_SIGMA) : null;
  if (measurement) { next.lastFix = { step: next.step, position: [...measurement] }; next.fixCount += 1; }
  if (next.step === FIX_LOSS_STEP && run.initial.schedule !== 'steady') next.events.push({ step: next.step, type: 'lost' });
  if (next.step === FIX_RETURN_STEP && run.initial.schedule === 'recovery') next.events.push({ step: next.step, type: 'restored' });
  if (run.initial.estimator === 'exact') {
    next.estimate = [...position];
    next.lastUpdate = { type: 'oracle', odometry, measurement, command };
  } else if (run.initial.estimator === 'dead') {
    next.estimate = run.estimate.map((value, axis) => value + odometry[axis]);
    next.lastUpdate = { type: 'integrate', odometry, measurement, command };
  } else {
    const predicted = predictPosition(run.estimate, run.covariance, odometry);
    const corrected = measurement ? correctPosition(predicted, measurement) : null;
    next.estimate = corrected ? corrected.estimate : predicted.estimate;
    next.covariance = corrected ? corrected.covariance : predicted.covariance;
    if (corrected) next.usedFixCount += 1;
    next.lastUpdate = { type: corrected ? 'correct' : 'predict', odometry, measurement, command, prior: { estimate: [...run.estimate], covariance: [...run.covariance] }, predicted,
      innovation: corrected?.innovation ?? null, gain: corrected?.gain ?? null };
  }
  // Progress uses the estimate only. Evaluation later decides whether the
  // resulting completion claim corresponds to the actual goal region.
  if (!contact && pathDistance(next.estimate, observation.waypoint) <= WAYPOINT_TOLERANCE + 1e-12) {
    next.events.push({ step: next.step, type: 'waypoint', index: run.waypointIndex }); next.waypointIndex += 1;
    if (next.waypointIndex === run.plan.waypoints.length) next.controllerFinished = true;
  }
  if (contact) next.status = 'collision';
  else if (next.controllerFinished) next.status = pathDistance(position, cellCenter(run.grid.goal, run.grid.width)) <= GOAL_TOLERANCE ? 'arrived' : 'false-arrival';
  else if (next.step >= LOCAL_BUDGET) next.status = 'budget';
  next.history.push(snapshot(next)); return next;
}
export function resetLocalization(run) { return createLocalizationRun(run.initial); }
export function finishLocalization(run) { while (run.status === 'following') run = stepLocalization(run); return run; }
export function summarizeLocalization(run) {
  const last = run.history.at(-1);
  return { ...run.initial, status: run.status, step: run.step, time: run.step * LOCAL_DT, controllerFinished: run.controllerFinished, actualGoalDistance: last.actualGoalDistance, estimatedGoalDistance: last.estimatedGoalDistance,
    finalError: last.error, rmsError: Math.sqrt(run.history.reduce((sum, point) => sum + point.error ** 2, 0) / run.history.length), maxError: Math.max(...run.history.map((point) => point.error)), distance: run.distance,
    fixCount: run.fixCount, usedFixCount: run.usedFixCount, covariance: run.covariance, contact: run.contact };
}
export function compareLocalization(seed = 1) {
  return Object.keys(LOCAL_MAPS).flatMap((map) => [
    { estimator: 'exact', schedule: 'steady' }, { estimator: 'dead', schedule: 'steady' },
    { estimator: 'kalman', schedule: 'steady' }, { estimator: 'kalman', schedule: 'outage' }, { estimator: 'kalman', schedule: 'recovery' },
  ].map((config) => summarizeLocalization(finishLocalization(createLocalizationRun({ ...config, map, seed })))));
}
export function compareLocalizationSeeds() {
  const trials = LOCAL_SEEDS.flatMap((seed) => compareLocalization(seed));
  const groups = compareLocalization().map(({ estimator, schedule, map }) => {
    const rows = trials.filter((row) => row.estimator === estimator && row.schedule === schedule && row.map === map);
    return { estimator, schedule, map, trials: rows.length, outcomes: Object.fromEntries(['arrived', 'false-arrival', 'collision', 'budget'].map((status) => [status, rows.filter((row) => row.status === status).length])),
      meanRmsError: rows.reduce((sum, row) => sum + row.rmsError, 0) / rows.length, worstError: Math.max(...rows.map((row) => row.maxError)) };
  });
  return { seeds: LOCAL_SEEDS, groups, trials };
}
