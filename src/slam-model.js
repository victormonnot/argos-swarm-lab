// Known-ID, planar EKF-SLAM. Estimator functions receive noisy controls and
// observations, never the evaluator's path or true landmark coordinates.
export const DT = 0.25;
export const STEPS = 128;
export const TIME_LIMIT = DT * STEPS;
export const TRUE_DISTANCE = 8 * Math.sin(Math.PI / STEPS);
export const TRUE_TURN = 2 * Math.PI / STEPS;
export const ODO_DISTANCE_STD = 0.03;
export const ODO_TURN_STD = 0.6 * Math.PI / 180;
export const RANGE_STD = 0.1;
export const BEARING_STD = 1.5 * Math.PI / 180;
export const RANGE_BIAS = 0.4;
export const SENSOR_RANGE = 5;
export const INITIAL_POSE = Object.freeze([4, 0, Math.PI / 2]);
export const LANDMARKS = Object.freeze([
  { id: 'L1', position: [6, 0] }, { id: 'L2', position: [0, 6] },
  { id: 'L3', position: [-6, 0] }, { id: 'L4', position: [0, -6] },
].map((entry) => Object.freeze({ ...entry, position: Object.freeze(entry.position) })));
export const METHODS = Object.freeze({ ekf: 'Extended Kalman Filter SLAM', odometry: 'Odometry with one-shot mapping' });
export const SCENARIOS = Object.freeze({ nominal: 'Nominal range and bearing', dropout: 'Sensor dropout: 12–19 s; return at 20 s', 'biased-range': 'Unmodeled +0.4 m range bias' });
export const PRESETS = Object.freeze([
  { id: 'nominal', label: 'Locate and map together', description: 'Initialize a landmark on its first supplied-ID observation, then inspect how revisits correct the robot and map.', config: { method: 'ekf', scenario: 'nominal', seed: 7 } },
  { id: 'odometry', label: 'Map without revisits', description: 'Use identical noisy inputs. Add each landmark once, but ignore repeat observations.', config: { method: 'odometry', scenario: 'nominal', seed: 7 } },
  { id: 'dropout', label: 'Lose the sensor batches', description: 'Continue prediction without observations at 12 through 19 seconds; observations return at 20 seconds.', config: { method: 'ekf', scenario: 'dropout', seed: 7 } },
  { id: 'bias', label: 'Trust a biased range sensor', description: 'Add 0.4 metres to every delivered range while retaining the nominal covariance. This is a deliberately incorrect noise model.', config: { method: 'ekf', scenario: 'biased-range', seed: 7 } },
].map((entry) => Object.freeze({ ...entry, config: Object.freeze(entry.config) })));

const clone = (value) => structuredClone(value);
const zeros = (rows, columns = rows) => Array.from({ length: rows }, () => Array(columns).fill(0));
const identity = (size) => Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => Number(i === j)));
const transpose = (a) => a[0].map((_, j) => a.map((row) => row[j]));
const multiply = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const add = (a, b, scale = 1) => a.map((row, i) => row.map((value, j) => value + scale * b[i][j]));
const matvec = (a, v) => a.map((row) => row.reduce((sum, value, i) => sum + value * v[i], 0));
const symmetric = (a) => a.map((row, i) => row.map((value, j) => (value + a[j][i]) / 2));
const snapshot = (state) => ({ mean: [...state.mean], P: state.P.map((row) => [...row]), mapIds: [...state.mapIds] });
export const MEASUREMENT_R = Object.freeze([Object.freeze([RANGE_STD ** 2, 0]), Object.freeze([0, BEARING_STD ** 2])]);

export function wrapAngle(angle) { return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }

export function solvePositiveDefinite(matrix, vector) {
  const n = matrix.length, lower = zeros(n);
  const tolerance = Math.max(...matrix.map((row, i) => Math.abs(row[i]))) * 1e-12;
  for (let i = 0; i < n; i += 1) for (let j = 0; j <= i; j += 1) {
    let value = matrix[i][j];
    for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
    if (i === j) {
      if (!(value > tolerance)) throw new Error('Covariance is not numerically positive definite.');
      lower[i][j] = Math.sqrt(value);
    } else lower[i][j] = value / lower[j][j];
  }
  const y = Array(n).fill(0), x = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    y[i] = vector[i];
    for (let k = 0; k < i; k += 1) y[i] -= lower[i][k] * y[k];
    y[i] /= lower[i][i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    x[i] = y[i];
    for (let k = i + 1; k < n; k += 1) x[i] -= lower[k][i] * x[k];
    x[i] /= lower[i][i];
  }
  return x;
}

export function motionModel(pose, odometry) {
  const mid = pose[2] + odometry.turn / 2;
  return [pose[0] + odometry.distance * Math.cos(mid), pose[1] + odometry.distance * Math.sin(mid), wrapAngle(pose[2] + odometry.turn)];
}

export function motionJacobians(pose, odometry) {
  const mid = pose[2] + odometry.turn / 2, c = Math.cos(mid), s = Math.sin(mid), d = odometry.distance;
  return { F: [[1, 0, -d * s], [0, 1, d * c], [0, 0, 1]], V: [[c, -0.5 * d * s], [s, 0.5 * d * c], [0, 1]] };
}

export function predictState(state, odometry) {
  const n = state.mean.length, jacobians = motionJacobians(state.mean.slice(0, 3), odometry), F = identity(n), V = zeros(n, 2);
  for (let i = 0; i < 3; i += 1) { for (let j = 0; j < 3; j += 1) F[i][j] = jacobians.F[i][j]; V[i] = [...jacobians.V[i]]; }
  const Q = [[ODO_DISTANCE_STD ** 2, 0], [0, ODO_TURN_STD ** 2]];
  return { mean: [...motionModel(state.mean.slice(0, 3), odometry), ...state.mean.slice(3)], P: symmetric(add(multiply(multiply(F, state.P), transpose(F)), multiply(multiply(V, Q), transpose(V)))), mapIds: [...state.mapIds] };
}

function landmarkOffset(state, id) {
  const index = state.mapIds.indexOf(id);
  if (index < 0) throw new Error(`Landmark ${id} has not been initialized.`);
  return 3 + 2 * index;
}

export function observationModel(state, id) {
  const index = landmarkOffset(state, id), dx = state.mean[index] - state.mean[0], dy = state.mean[index + 1] - state.mean[1];
  const range = Math.hypot(dx, dy);
  if (!(range > 1e-8)) throw new Error('Range/bearing linearization is undefined at zero separation.');
  return [range, wrapAngle(Math.atan2(dy, dx) - state.mean[2])];
}

export function observationJacobian(state, id) {
  const index = landmarkOffset(state, id), dx = state.mean[index] - state.mean[0], dy = state.mean[index + 1] - state.mean[1], q = dx * dx + dy * dy, range = Math.sqrt(q);
  if (!(range > 1e-8)) throw new Error('Range/bearing linearization is undefined at zero separation.');
  const H = zeros(2, state.mean.length);
  H[0][0] = -dx / range; H[0][1] = -dy / range; H[0][index] = dx / range; H[0][index + 1] = dy / range;
  H[1][0] = dy / q; H[1][1] = -dx / q; H[1][2] = -1; H[1][index] = -dy / q; H[1][index + 1] = dx / q;
  return H;
}

export function augmentLandmark(state, observation, R = MEASUREMENT_R) {
  if (state.mapIds.includes(observation.id)) throw new Error('A landmark may only be initialized once.');
  const [range, bearing] = observation.value;
  if (!(range > 0)) throw new Error('A new landmark requires positive measured range.');
  const n = state.mean.length, angle = state.mean[2] + bearing, c = Math.cos(angle), s = Math.sin(angle), Gx = zeros(2, n);
  Gx[0][0] = 1; Gx[1][1] = 1; Gx[0][2] = -range * s; Gx[1][2] = range * c;
  const Gz = [[c, -range * s], [s, range * c]], cross = multiply(state.P, transpose(Gx));
  const marginal = add(multiply(multiply(Gx, state.P), transpose(Gx)), multiply(multiply(Gz, R), transpose(Gz)));
  const P = zeros(n + 2);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) P[i][j] = state.P[i][j];
    for (let j = 0; j < 2; j += 1) { P[i][n + j] = cross[i][j]; P[n + j][i] = cross[i][j]; }
  }
  for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) P[n + i][n + j] = marginal[i][j];
  return { kind: 'initialize', id: observation.id, used: true, value: [...observation.value], before: snapshot(state), after: { mean: [...state.mean, state.mean[0] + range * c, state.mean[1] + range * s], P: symmetric(P), mapIds: [...state.mapIds, observation.id] }, R: clone(R), Gx, Gz, H: null, K: null, innovation: null, S: null, nis: null, correction: null };
}

export function correctObservation(state, observation, R = MEASUREMENT_R) {
  const predictedMeasurement = observationModel(state, observation.id), H = observationJacobian(state, observation.id);
  const innovation = [observation.value[0] - predictedMeasurement[0], wrapAngle(observation.value[1] - predictedMeasurement[1])];
  const PHt = multiply(state.P, transpose(H)), S = add(multiply(H, PHt), R), K = PHt.map((row) => solvePositiveDefinite(S, row));
  const correction = matvec(K, innovation), mean = state.mean.map((value, i) => value + correction[i]);
  mean[2] = wrapAngle(mean[2]);
  const IKH = add(identity(state.mean.length), multiply(K, H), -1);
  const P = symmetric(add(multiply(multiply(IKH, state.P), transpose(IKH)), multiply(multiply(K, R), transpose(K))));
  const weighted = solvePositiveDefinite(S, innovation), nis = innovation.reduce((sum, value, i) => sum + value * weighted[i], 0);
  return { kind: 'correct', id: observation.id, used: true, value: [...observation.value], predictedMeasurement, before: snapshot(state), after: { mean, P, mapIds: [...state.mapIds] }, R: clone(R), H, K, innovation, S, nis, correction, Gx: null, Gz: null };
}

function gaussianGenerator(seed) {
  let state = seed >>> 0, spare = null;
  const uniform = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const radius = Math.sqrt(-2 * Math.log(1 - uniform())), angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function truthAt(step) {
  const angle = step * TRUE_TURN;
  return [4 * Math.cos(angle), 4 * Math.sin(angle), wrapAngle(Math.PI / 2 + angle)];
}

function makeEvaluator(config) {
  const gaussian = gaussianGenerator(config.seed), tape = [];
  for (let step = 1; step <= STEPS; step += 1) {
    const time = step * DT, truth = truthAt(step);
    const odometry = { distance: TRUE_DISTANCE + ODO_DISTANCE_STD * gaussian(), turn: TRUE_TURN + ODO_TURN_STD * gaussian() };
    const batch = step % 4 === 0, dropped = batch && config.scenario === 'dropout' && time >= 12 && time < 20;
    const observations = [];
    // Always consume both noises for every supplied ID at every step, even
    // outside sensor range or during absent batches, to preserve pairing.
    for (const landmark of LANDMARKS) {
      const dx = landmark.position[0] - truth[0], dy = landmark.position[1] - truth[1], trueRange = Math.hypot(dx, dy);
      const rangeNoise = RANGE_STD * gaussian(), bearingNoise = BEARING_STD * gaussian();
      if (batch && !dropped && trueRange <= SENSOR_RANGE) observations.push({ id: landmark.id, value: [trueRange + rangeNoise + (config.scenario === 'biased-range' ? RANGE_BIAS : 0), wrapAngle(Math.atan2(dy, dx) - truth[2] + bearingNoise)] });
    }
    tape.push({ step, time, truth, odometry, batch, dropped, observations });
  }
  return { tape };
}

function updatePresentation(run, truth) {
  run.robot.truth = [...truth]; run.robot.estimate = run.mean.slice(0, 3); run.robot.covariance = run.P.slice(0, 3).map((row) => row.slice(0, 3));
  run.robot.truthTrail.push(truth.slice(0, 2)); run.robot.estimateTrail.push(run.mean.slice(0, 2));
  for (const landmark of run.landmarks) {
    const index = run.mapIds.indexOf(landmark.id);
    landmark.initialized = index >= 0;
    if (index >= 0) {
      const offset = 3 + 2 * index;
      landmark.estimate = run.mean.slice(offset, offset + 2);
      landmark.covariance = run.P.slice(offset, offset + 2).map((row) => row.slice(offset, offset + 2));
      landmark.estimateTrail.push([...landmark.estimate]);
    }
  }
}

function evaluate(run) {
  const positionError = Math.hypot(run.mean[0] - run.robot.truth[0], run.mean[1] - run.robot.truth[1]), signedHeadingError = wrapAngle(run.mean[2] - run.robot.truth[2]);
  const mapped = run.landmarks.filter((entry) => entry.initialized), mapSquared = mapped.reduce((sum, entry) => sum + (entry.estimate[0] - entry.truth[0]) ** 2 + (entry.estimate[1] - entry.truth[1]) ** 2, 0);
  const mapVariance = mapped.reduce((sum, entry) => sum + entry.covariance[0][0] + entry.covariance[1][1], 0);
  const poseError = [run.mean[0] - run.robot.truth[0], run.mean[1] - run.robot.truth[1], signedHeadingError];
  let poseNees = null;
  try { const weighted = solvePositiveDefinite(run.robot.covariance, poseError); poseNees = poseError.reduce((sum, value, i) => sum + value * weighted[i], 0); } catch { /* The exact initial pose and first prediction have singular covariance. */ }
  run.metrics = { positionError, headingError: Math.abs(signedHeadingError), headingErrorDegrees: Math.abs(signedHeadingError) * 180 / Math.PI,
    mapRmse: mapped.length ? Math.sqrt(mapSquared / mapped.length) : null, mapCount: mapped.length,
    positionRmsRadius: Math.sqrt(Math.max(0, run.P[0][0] + run.P[1][1])), headingStd: Math.sqrt(Math.max(0, run.P[2][2])),
    mapRmsRadius: mapped.length ? Math.sqrt(Math.max(0, mapVariance / mapped.length)) : null, poseNees,
    poseMapCrossNorm: Math.hypot(...run.P.slice(0, 3).flatMap((row) => row.slice(3))),
  };
  run.history.push({ step: run.step, time: run.time, ...run.metrics });
}

function event(run, type, message) { run.events.push({ step: run.step, time: run.time, type, message }); }

export function createRun(options = {}) {
  const config = { method: 'ekf', scenario: 'nominal', seed: 7, ...options };
  if (!Object.hasOwn(METHODS, config.method)) throw new Error('Unknown SLAM method.');
  if (!Object.hasOwn(SCENARIOS, config.scenario)) throw new Error('Unknown SLAM scenario.');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) throw new Error('Seed must be an integer from 0 to 4294967295.');
  const run = { config, step: 0, time: 0, status: 'running', mean: [...INITIAL_POSE], P: zeros(3), mapIds: [], evaluator: makeEvaluator(config),
    robot: { id: 'R1', truthTrail: [], estimateTrail: [] },
    landmarks: LANDMARKS.map((entry) => ({ id: entry.id, truth: [...entry.position], initialized: false, estimate: null, covariance: null, estimateTrail: [], lastSeenTime: null })),
    observations: { odometry: { distance: 0, turn: 0 }, batch: false, dropped: false, landmarks: [] }, updates: [], snapshots: {},
    metrics: {}, history: [], events: [], counts: { batches: 0, measurements: 0, initialized: 0, corrected: 0, ignored: 0, droppedBatches: 0 }, innovationTotals: { sum: 0, count: 0 },
  };
  run.snapshots = { predicted: snapshot(run), afterObservations: snapshot(run) };
  updatePresentation(run, INITIAL_POSE); evaluate(run);
  if (config.scenario === 'biased-range') event(run, 'misspecified-noise', 'Delivered ranges include an unmodeled +0.4 m bias; covariance still assumes independent zero-mean range noise.');
  return run;
}

export function stepRun(run) {
  if (run.status === 'completed') return run;
  const sample = run.evaluator.tape[run.step];
  run.step = sample.step; run.time = sample.time;
  run.observations = { odometry: { ...sample.odometry }, batch: sample.batch, dropped: sample.dropped, landmarks: sample.observations.map((observation) => ({ ...clone(observation), used: false, action: null })) };
  Object.assign(run, predictState({ mean: run.mean, P: run.P, mapIds: run.mapIds }, run.observations.odometry));
  run.snapshots.predicted = snapshot(run); run.updates = [];
  if (sample.batch) run.counts.batches += 1;
  if (sample.dropped) run.counts.droppedBatches += 1;
  for (const observation of run.observations.landmarks) {
    run.counts.measurements += 1;
    const state = { mean: run.mean, P: run.P, mapIds: run.mapIds };
    let update;
    if (!run.mapIds.includes(observation.id)) {
      update = augmentLandmark(state, observation); run.counts.initialized += 1; observation.action = 'initialized';
      event(run, 'initialized', `${observation.id} initialized from its first supplied-ID range/bearing sample. This sample is used once, with no subsequent correction.`);
    } else if (run.config.method === 'ekf') {
      update = correctObservation(state, observation); run.counts.corrected += 1; observation.action = 'corrected';
      run.innovationTotals.sum += update.nis; run.innovationTotals.count += 1;
    } else {
      update = { kind: 'ignored', id: observation.id, used: false, value: [...observation.value], before: snapshot(state), after: snapshot(state), R: clone(MEASUREMENT_R), H: null, K: null, innovation: null, S: null, nis: null, correction: null, Gx: null, Gz: null };
      run.counts.ignored += 1; observation.action = 'ignored';
    }
    observation.used = update.used;
    Object.assign(run, snapshot(update.after)); run.updates.push(update);
    run.landmarks.find((entry) => entry.id === observation.id).lastSeenTime = run.time;
  }
  run.snapshots.afterObservations = snapshot(run);
  updatePresentation(run, sample.truth); evaluate(run);
  if (run.config.scenario === 'dropout' && run.time === 12) event(run, 'sensor-dropout', 'Observation batches at 12 through 19 seconds are absent. Odometry prediction continues.');
  if (run.config.scenario === 'dropout' && run.time === 20) event(run, 'sensor-restored', 'Range/bearing observations return at 20 seconds. Supplied IDs distinguish reobservations from new landmarks.');
  if (run.step === STEPS) { run.status = 'completed'; event(run, 'completed', 'The 32-second observation budget is complete. This is not a mission-success or SLAM-consistency guarantee.'); }
  return run;
}

export function runToEnd(run) { while (run.status !== 'completed') stepRun(run); return run; }

export function referenceComparisons() {
  return Object.keys(SCENARIOS).flatMap((scenario) => Object.keys(METHODS).map((method) => {
    const run = runToEnd(createRun({ method, scenario, seed: 7 }));
    return { method, methodLabel: METHODS[method], scenario, scenarioLabel: SCENARIOS[scenario], seed: 7, steps: run.step, time: run.time, metrics: { ...run.metrics }, counts: { ...run.counts } };
  }));
}

export function compareSeeds({ scenario = 'nominal', count = 200, firstSeed = 1 } = {}) {
  if (!['nominal', 'dropout'].includes(scenario)) throw new Error('Ensemble checks exclude the intentionally biased range model.');
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Trial count must be an integer from 1 to 10000.');
  const totals = Object.fromEntries(Object.keys(METHODS).map((method) => [method, { positionSquared: 0, headingSquared: 0, mapSquared: 0, positionVariance: 0, headingVariance: 0, mapVariance: 0, poseNees: 0, poseNeesCount: 0, nis: 0, nisCount: 0, mapCountMinimum: 4, mapCountMaximum: 0 }]));
  let ekfLowerPositionError = 0, ekfLowerMapError = 0;
  const ekfNotLowerPositionSeeds = [], ekfNotLowerMapSeeds = [], differences = [];
  for (let seed = firstSeed; seed < firstSeed + count; seed += 1) {
    const pair = {};
    for (const method of Object.keys(METHODS)) {
      const run = runToEnd(createRun({ method, scenario, seed })), m = run.metrics, total = totals[method];
      pair[method] = m;
      total.positionSquared += m.positionError ** 2; total.headingSquared += m.headingError ** 2; total.mapSquared += m.mapRmse ** 2;
      total.positionVariance += m.positionRmsRadius ** 2; total.headingVariance += m.headingStd ** 2; total.mapVariance += m.mapRmsRadius ** 2;
      if (m.poseNees !== null) { total.poseNees += m.poseNees; total.poseNeesCount += 1; }
      total.nis += run.innovationTotals.sum; total.nisCount += run.innovationTotals.count;
      total.mapCountMinimum = Math.min(total.mapCountMinimum, m.mapCount); total.mapCountMaximum = Math.max(total.mapCountMaximum, m.mapCount);
    }
    if (pair.ekf.positionError < pair.odometry.positionError) ekfLowerPositionError += 1; else ekfNotLowerPositionSeeds.push(seed);
    if (pair.ekf.mapRmse < pair.odometry.mapRmse) ekfLowerMapError += 1; else ekfNotLowerMapSeeds.push(seed);
    differences.push(pair.odometry.positionError ** 2 - pair.ekf.positionError ** 2);
  }
  const differenceMean = differences.reduce((sum, value) => sum + value, 0) / count;
  const differenceVariance = count > 1 ? differences.reduce((sum, value) => sum + (value - differenceMean) ** 2, 0) / (count - 1) : 0;
  return { scenario, count, firstSeed, endpointSeconds: TIME_LIMIT, nominalExpectedPoseNees: 3, nominalExpectedNis: 2,
    methods: Object.fromEntries(Object.keys(METHODS).map((method) => {
      const total = totals[method];
      return [method, { positionErrorRms: Math.sqrt(total.positionSquared / count), headingErrorRms: Math.sqrt(total.headingSquared / count), headingErrorRmsDegrees: Math.sqrt(total.headingSquared / count) * 180 / Math.PI, mapErrorRms: Math.sqrt(total.mapSquared / count), reportedPositionRmsRadius: Math.sqrt(total.positionVariance / count), reportedHeadingRmsStd: Math.sqrt(total.headingVariance / count), reportedMapRmsRadius: Math.sqrt(total.mapVariance / count), meanPoseNees: total.poseNeesCount ? total.poseNees / total.poseNeesCount : null, poseNeesCount: total.poseNeesCount, meanNis: total.nisCount ? total.nis / total.nisCount : null, correctionCount: total.nisCount, mapCountMinimum: total.mapCountMinimum, mapCountMaximum: total.mapCountMaximum }];
    })), paired: { ekfLowerPositionError, ekfLowerMapError, ekfNotLowerPositionSeeds, ekfNotLowerMapSeeds, odometryMinusEkfMeanSquaredPositionError: differenceMean, meanSquaredDifferenceStandardError: Math.sqrt(differenceVariance / count) },
    interpretation: 'Endpoint RMS errors are roots of averages of squared errors across paired seeds. Reported RMS uncertainty averages covariance variances before taking a square root; EKF covariances depend on each realization. Map error averages over initialized landmarks, with endpoint counts reported. Pose NEES and observation NIS are approximate EKF diagnostics, not exact linear-Gaussian calibration guarantees. NIS includes repeat-observation corrections only; initializing samples are not reused. No alignment to truth is performed.',
  };
}
