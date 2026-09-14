// Joint linear position filtering in a known shared Cartesian frame.
// The estimator functions below accept noisy inputs, never evaluator truth.
export const DT = 0.25;
export const STEPS = 80;
export const TIME_LIMIT = DT * STEPS;
export const ODOMETRY_STD = 0.08;
export const RELATIVE_STD = 0.15;
export const ANCHOR_STD = 0.2;
export const INITIAL_STD = 0.8;
export const SHARED_SHIFT = Object.freeze([2, -1.5]);
export const METHODS = Object.freeze({ joint: 'Joint-state Kalman filter', independent: 'Independent Kalman filters' });
export const SCENARIOS = Object.freeze({ anchored: 'Regular A1 absolute fixes', unanchored: 'No absolute fixes', 'anchor-restored': 'A1 absolute fixes start at 10 s', 'relative-outage': 'Relative samples absent from 5 to 10 s' });
export const PRESETS = Object.freeze([
  { id: 'joint', label: 'Help the unanchored robot', description: 'Relative observations correlate the estimates. An A1 absolute fix can then correct A2.', config: { method: 'joint', scenario: 'anchored', priorShift: 'none', seed: 7 } },
  { id: 'independent', label: 'Independent baseline', description: 'Use the same input tape but ignore relative packets. Only A1 receives absolute corrections.', config: { method: 'independent', scenario: 'anchored', priorShift: 'none', seed: 7 } },
  { id: 'unanchored', label: 'Observe relative position only', description: 'Constrain separation while the common position remains unobserved by measurements.', config: { method: 'joint', scenario: 'unanchored', priorShift: 'none', seed: 7 } },
  { id: 'shift', label: 'A hidden shared offset', description: 'Add the same fixed offset to both initial means without enlarging covariance. Relative measurements cannot identify this deliberately incorrect prior.', config: { method: 'joint', scenario: 'unanchored', priorShift: 'shared', seed: 7 } },
  { id: 'restore', label: 'Restore the absolute reference', description: 'Start A1 absolute fixes at 10 seconds after relative-only filtering with an incorrect shared offset.', config: { method: 'joint', scenario: 'anchor-restored', priorShift: 'shared', seed: 7 } },
  { id: 'outage', label: 'Lose relative observations', description: 'Omit relative samples at 5, 6, 7, 8 and 9 seconds; resume them at 10 seconds.', config: { method: 'joint', scenario: 'relative-outage', priorShift: 'none', seed: 7 } },
].map((preset) => Object.freeze({ ...preset, config: Object.freeze(preset.config) })));

export const RELATIVE_H = Object.freeze([Object.freeze([-1, 0, 1, 0]), Object.freeze([0, -1, 0, 1])]);
export const ANCHOR_H = Object.freeze([Object.freeze([1, 0, 0, 0]), Object.freeze([0, 1, 0, 0])]);
const clone = (value) => structuredClone(value);
const zeros = (rows, columns) => Array.from({ length: rows }, () => Array(columns).fill(0));
const identity = (size, scale = 1) => Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => i === j ? scale : 0));
const transpose = (matrix) => matrix[0].map((_, j) => matrix.map((row) => row[j]));
const multiply = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const plus = (a, b, factor = 1) => a.map((row, i) => row.map((value, j) => value + factor * b[i][j]));
const multiplyVector = (matrix, vector) => matrix.map((row) => row.reduce((sum, value, j) => sum + value * vector[j], 0));
const sumSquares = (vector) => vector.reduce((sum, value) => sum + value * value, 0);
const norm = (vector) => Math.sqrt(sumSquares(vector));
const trace = (matrix) => matrix.reduce((sum, row, i) => sum + row[i], 0);
const snapshot = (state) => ({ mean: [...state.mean], P: state.P.map((row) => [...row]) });

// Positive definite matrices are solved with Cholesky, avoiding an explicit
// matrix inverse. Measurement covariance is strictly positive in every case.
export function solvePositiveDefinite(matrix, vector) {
  const n = matrix.length, lower = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!(value > 0)) throw new Error('Expected a positive definite covariance.');
        lower[i][j] = Math.sqrt(value);
      } else lower[i][j] = value / lower[j][j];
    }
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

export function predictState(state, odometry) {
  const displacement = odometry.flat();
  return { mean: state.mean.map((value, i) => value + displacement[i]), P: plus(state.P, identity(4, ODOMETRY_STD ** 2)) };
}

// Generic linear correction shared by both configurations. The independent
// baseline's initially block-diagonal covariance stays block diagonal because
// it only admits A1's absolute measurement rows.
export function kalmanUpdate(state, value, H, R, kind = 'measurement') {
  const before = snapshot(state), predictedMeasurement = multiplyVector(H, state.mean);
  const innovation = value.map((entry, i) => entry - predictedMeasurement[i]);
  const PHt = multiply(state.P, transpose(H));
  const S = plus(multiply(H, PHt), R);
  const K = PHt.map((row) => solvePositiveDefinite(S, row));
  const correction = multiplyVector(K, innovation);
  const mean = state.mean.map((entry, i) => entry + correction[i]);
  const IKH = plus(identity(4), multiply(K, H), -1);
  const joseph = plus(multiply(multiply(IKH, state.P), transpose(IKH)), multiply(multiply(K, R), transpose(K)));
  const P = joseph.map((row, i) => row.map((entry, j) => (entry + joseph[j][i]) / 2));
  const whitened = solvePositiveDefinite(S, innovation);
  const nis = innovation.reduce((sum, entry, i) => sum + entry * whitened[i], 0);
  return { kind, used: true, value: [...value], H: clone(H), R: clone(R), S, K, innovation, correction, nis, before, after: { mean, P } };
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

// World trajectories are open-loop evaluator data. Neither estimator receives
// the trajectory function, true increments, or future availability schedule.
export function truthAt(time) {
  return [[-3 + 0.3 * time, -1.5 + 0.4 * Math.sin(0.4 * time)], [-2.5 + 0.25 * time, 1.1 + 0.4 * Math.cos(0.4 * time)]];
}

function makeEvaluator(config) {
  const gaussian = gaussianGenerator(config.seed);
  const initialTruth = truthAt(0), initialMean = initialTruth.flat().map((value, i) => value + INITIAL_STD * gaussian() + (config.priorShift === 'shared' ? SHARED_SHIFT[i % 2] : 0));
  const tape = [];
  for (let step = 1; step <= STEPS; step += 1) {
    const time = step * DT, truth = truthAt(time), previousTruth = truthAt(time - DT);
    const odometry = truth.map((point, agent) => point.map((value, axis) => value - previousTruth[agent][axis] + ODOMETRY_STD * gaussian()));
    // Generate all potential samples regardless of schedule, so all methods
    // and scenarios share exactly the same noise realization for a seed.
    const relativeValue = truth[1].map((value, axis) => value - truth[0][axis] + RELATIVE_STD * gaussian());
    const anchorValue = truth[0].map((value) => value + ANCHOR_STD * gaussian());
    const sampleBoundary = step % 4 === 0;
    const relativeAvailable = sampleBoundary && !(config.scenario === 'relative-outage' && time >= 5 && time < 10);
    const anchorAvailable = sampleBoundary && config.scenario !== 'unanchored' && (config.scenario !== 'anchor-restored' || time >= 10);
    tape.push({ step, time, truth, odometry,
      relative: sampleBoundary ? { kind: 'relative', time, available: relativeAvailable, value: relativeAvailable ? relativeValue : null } : null,
      anchor: sampleBoundary ? { kind: 'anchor', time, available: anchorAvailable, value: anchorAvailable ? anchorValue : null } : null,
    });
  }
  return { initialTruth, initialMean, tape };
}

export function derivedCovariances(P) {
  const center = zeros(2, 2), relative = zeros(2, 2);
  for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) {
    center[i][j] = (P[i][j] + P[i][j + 2] + P[i + 2][j] + P[i + 2][j + 2]) / 4;
    relative[i][j] = P[i][j] + P[i + 2][j + 2] - P[i][j + 2] - P[i + 2][j];
  }
  return { center, relative };
}

function evaluate(run) {
  const truth = run.agents.flatMap((agent) => agent.truth), error = run.mean.map((value, i) => value - truth[i]);
  const { center, relative } = derivedCovariances(run.P);
  const weightedError = solvePositiveDefinite(run.P, error);
  run.metrics = {
    positionRmse: Math.sqrt(sumSquares(error) / 2),
    relativeError: norm([error[2] - error[0], error[3] - error[1]]),
    centerError: norm([(error[0] + error[2]) / 2, (error[1] + error[3]) / 2]),
    positionRmsRadius: Math.sqrt(trace(run.P) / 2),
    relativeRmsRadius: Math.sqrt(trace(relative)),
    centerRmsRadius: Math.sqrt(trace(center)),
    nees: error.reduce((sum, entry, i) => sum + entry * weightedError[i], 0),
    crossCovarianceNorm: Math.hypot(run.P[0][2], run.P[0][3], run.P[1][2], run.P[1][3]),
  };
  run.history.push({ step: run.step, time: run.time, ...run.metrics });
}

function updateAgents(run, truth) {
  for (let index = 0; index < 2; index += 1) {
    const agent = run.agents[index], offset = index * 2;
    agent.truth = [...truth[index]];
    agent.estimate = run.mean.slice(offset, offset + 2);
    agent.covariance = run.P.slice(offset, offset + 2).map((row) => row.slice(offset, offset + 2));
    agent.truthTrail.push([...agent.truth]);
    agent.estimateTrail.push([...agent.estimate]);
  }
}

function recordEvent(run, type, message) { run.events.push({ step: run.step, time: run.time, type, message }); }

export function createRun(options = {}) {
  const config = { method: 'joint', scenario: 'anchored', seed: 7, priorShift: 'none', ...options };
  if (!Object.hasOwn(METHODS, config.method)) throw new Error('Unknown cooperative localization method.');
  if (!Object.hasOwn(SCENARIOS, config.scenario)) throw new Error('Unknown cooperative localization scenario.');
  if (!['none', 'shared'].includes(config.priorShift)) throw new Error('Unknown initial prior shift.');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) throw new Error('Seed must be an integer from 0 to 4294967295.');
  const evaluator = makeEvaluator(config);
  const run = { config, step: 0, time: 0, status: 'running', mean: [...evaluator.initialMean], P: identity(4, INITIAL_STD ** 2), evaluator,
    agents: ['A1', 'A2'].map((id) => ({ id, truthTrail: [], estimateTrail: [] })),
    observations: { odometry: [[0, 0], [0, 0]], relative: null, anchor: null }, updates: [], snapshots: {},
    metrics: {}, history: [], events: [], counts: { relativeAvailable: 0, relativeUsed: 0, anchorAvailable: 0, anchorUsed: 0 },
    innovationTotals: { relative: { sum: 0, count: 0 }, anchor: { sum: 0, count: 0 } },
  };
  run.snapshots = { predicted: snapshot(run), afterRelative: snapshot(run), afterAnchor: snapshot(run) };
  updateAgents(run, evaluator.initialTruth);
  evaluate(run);
  if (config.priorShift === 'shared') recordEvent(run, 'misspecified-prior', 'Both initial means receive the same [2, −1.5] m offset; covariance is unchanged. This is an intentionally misspecified prior.');
  return run;
}

export function stepRun(run) {
  if (run.status === 'completed') return run;
  const sample = run.evaluator.tape[run.step];
  run.step = sample.step;
  run.time = sample.time;
  run.observations = { odometry: clone(sample.odometry), relative: sample.relative && { ...clone(sample.relative), used: false }, anchor: sample.anchor && { ...clone(sample.anchor), used: false } };
  run.updates = [];
  Object.assign(run, predictState({ mean: run.mean, P: run.P }, run.observations.odometry));
  run.snapshots.predicted = snapshot(run);
  for (const kind of ['relative', 'anchor']) {
    const packet = run.observations[kind];
    if (packet?.available) {
      run.counts[`${kind}Available`] += 1;
      if (kind === 'anchor' || run.config.method === 'joint') {
        const update = kalmanUpdate({ mean: run.mean, P: run.P }, packet.value, kind === 'relative' ? RELATIVE_H : ANCHOR_H, identity(2, (kind === 'relative' ? RELATIVE_STD : ANCHOR_STD) ** 2), kind);
        Object.assign(run, snapshot(update.after));
        packet.used = true;
        run.counts[`${kind}Used`] += 1;
        run.innovationTotals[kind].sum += update.nis;
        run.innovationTotals[kind].count += 1;
        run.updates.push(update);
      }
    }
    run.snapshots[kind === 'relative' ? 'afterRelative' : 'afterAnchor'] = snapshot(run);
  }
  updateAgents(run, sample.truth);
  evaluate(run);
  if (run.config.scenario === 'relative-outage' && run.time === 5) recordEvent(run, 'relative-outage', 'Relative samples stop at 5 s; A1 absolute fixes remain available.');
  if (run.config.scenario === 'relative-outage' && run.time === 10) recordEvent(run, 'relative-restored', 'Relative samples resume at 10 s.');
  if (run.config.scenario === 'anchor-restored' && run.time === 10) recordEvent(run, 'anchor-restored', 'The first A1 absolute fix arrives at 10 s, after the relative correction at this boundary.');
  if (run.step === STEPS) {
    run.status = 'completed';
    recordEvent(run, 'completed', 'The 20-second observation budget is complete. Final error is evaluator data, not a mission-success criterion.');
  }
  return run;
}

export function runToEnd(run) { while (run.status !== 'completed') stepRun(run); return run; }

export function referenceComparisons() {
  const configurations = Object.keys(SCENARIOS).flatMap((scenario) => Object.keys(METHODS).map((method) => ({ method, scenario, priorShift: 'none', seed: 7 })));
  for (const scenario of ['unanchored', 'anchor-restored']) configurations.push(...Object.keys(METHODS).map((method) => ({ method, scenario, priorShift: 'shared', seed: 7 })));
  return configurations.map((config) => {
    const run = runToEnd(createRun(config));
    return { ...config, methodLabel: METHODS[config.method], scenarioLabel: SCENARIOS[config.scenario], steps: run.step, time: run.time, metrics: { ...run.metrics }, counts: { ...run.counts } };
  });
}

// Paired endpoint statistics: seed s supplies the exact same samples to both
// filters. Error RMS is sqrt(mean(squared error)), not mean of per-run RMSE.
export function compareSeeds({ count = 200, scenario = 'anchored', priorShift = 'none', firstSeed = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Trial count must be an integer from 1 to 10000.');
  if (priorShift !== 'none') throw new Error('Calibration trials require the correctly specified, unshifted Gaussian prior.');
  const totals = Object.fromEntries(Object.keys(METHODS).map((method) => [method, { positionSquared: 0, relativeSquared: 0, centerSquared: 0, nees: 0, relativeNis: 0, relativeNisCount: 0, anchorNis: 0, anchorNisCount: 0, agentSquared: [0, 0] }]));
  let jointLowerPositionError = 0, jointLowerRelativeError = 0;
  const pairedSquaredErrorDifferences = [], jointNotLowerPositionSeeds = [];
  let reported = {};
  for (let seed = firstSeed; seed < firstSeed + count; seed += 1) {
    const pair = {};
    for (const method of Object.keys(METHODS)) {
      const run = runToEnd(createRun({ method, scenario, seed, priorShift })), metrics = run.metrics, total = totals[method];
      pair[method] = metrics;
      total.positionSquared += metrics.positionRmse ** 2;
      total.relativeSquared += metrics.relativeError ** 2;
      total.centerSquared += metrics.centerError ** 2;
      total.nees += metrics.nees;
      for (const kind of ['relative', 'anchor']) {
        total[`${kind}Nis`] += run.innovationTotals[kind].sum;
        total[`${kind}NisCount`] += run.innovationTotals[kind].count;
      }
      run.agents.forEach((agent, index) => { total.agentSquared[index] += sumSquares(agent.estimate.map((value, axis) => value - agent.truth[axis])); });
      reported[method] = { positionRmsRadius: metrics.positionRmsRadius, relativeRmsRadius: metrics.relativeRmsRadius, centerRmsRadius: metrics.centerRmsRadius };
    }
    if (pair.joint.positionRmse < pair.independent.positionRmse) jointLowerPositionError += 1;
    else jointNotLowerPositionSeeds.push(seed);
    if (pair.joint.relativeError < pair.independent.relativeError) jointLowerRelativeError += 1;
    pairedSquaredErrorDifferences.push(pair.independent.positionRmse ** 2 - pair.joint.positionRmse ** 2);
  }
  const differenceMean = pairedSquaredErrorDifferences.reduce((sum, value) => sum + value, 0) / count;
  const differenceVariance = count > 1 ? pairedSquaredErrorDifferences.reduce((sum, value) => sum + (value - differenceMean) ** 2, 0) / (count - 1) : 0;
  return {
    scenario, priorShift, firstSeed, count, endpointSeconds: TIME_LIMIT, expectedNees: 4, expectedNis: 2,
    methods: Object.fromEntries(Object.keys(METHODS).map((method) => {
      const total = totals[method];
      return [method, { positionErrorRms: Math.sqrt(total.positionSquared / count), relativeErrorRms: Math.sqrt(total.relativeSquared / count), centerErrorRms: Math.sqrt(total.centerSquared / count), agentPositionErrorRms: total.agentSquared.map((value) => Math.sqrt(value / count)), meanNees: total.nees / count, meanRelativeNis: total.relativeNisCount ? total.relativeNis / total.relativeNisCount : null, meanAnchorNis: total.anchorNisCount ? total.anchorNis / total.anchorNisCount : null, relativeUpdateCount: total.relativeNisCount, anchorUpdateCount: total.anchorNisCount, reported: reported[method] }];
    })),
    paired: { jointLowerPositionError, jointNotLowerPositionSeeds, jointLowerRelativeError, independentMinusJointMeanSquaredPositionError: differenceMean, meanSquaredDifferenceStandardError: Math.sqrt(differenceVariance / count) },
    interpretation: 'Endpoint errors and NEES are averaged across independent seeded trials; NIS is pooled across actually applied two-dimensional updates. Reported radii are covariance RMS radii, not confidence bounds. A correct covariance or smaller expected error does not guarantee smaller realized error on every seed.',
  };
}
