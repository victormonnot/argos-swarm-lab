// A small SE(2) pose-graph backend. Optimization receives only recorded poses
// and supplied relative constraints; evaluator truth never enters the solver.
export const POSE_COUNT = 25;
export const KEYFRAME_INTERVAL = 1;
export const SURVEY_SECONDS = (POSE_COUNT - 1) * KEYFRAME_INTERVAL;
export const MAX_ITERATIONS = 30;
export const MAX_BACKTRACKS = 20;
export const ARMIJO_C = 1e-4;
export const GRADIENT_TOLERANCE = 1e-8;
export const STEP_TOLERANCE = 1e-8;
export const RELATIVE_COST_TOLERANCE = 1e-10;
export const ODOM_TRANSLATION_STD = 0.08;
export const ODOM_HEADING_STD = 1.5 * Math.PI / 180;
export const LOOP_TRANSLATION_STD = 0.05;
export const LOOP_HEADING_STD = Math.PI / 180;
export const INITIAL_POSE = Object.freeze([4, 0, Math.PI / 2]);
export const SCENARIOS = Object.freeze({ 'no-loop': 'Odometry chain only', 'correct-loop': 'Correct supplied loop: 0 → 24', 'wrong-loop': 'Incorrect supplied loop: 0 → 18' });
export const PRESETS = Object.freeze([
  { id: 'correct', label: 'Close the recorded loop', description: 'A supplied 0 → 24 constraint revises the complete recorded trajectory, including earlier poses.', config: { scenario: 'correct-loop', seed: 7 } },
  { id: 'chain', label: 'Fit every edge and still drift', description: 'The integrated odometry chain has almost zero graph residual before optimization, despite nonzero evaluator trajectory error.', config: { scenario: 'no-loop', seed: 7 } },
  { id: 'wrong', label: 'Optimize a wrong association', description: 'Attach the same near-zero loop measurement to pose 18 instead of pose 24. The solver trusts the incorrect supplied IDs.', config: { scenario: 'wrong-loop', seed: 7 } },
].map((entry) => Object.freeze({ ...entry, config: Object.freeze(entry.config) })));

const clone = (value) => structuredClone(value);
const zeroMatrix = (size) => Array.from({ length: size }, () => Array(size).fill(0));
const terminal = (status) => !['ready', 'running'].includes(status);
const infinityNorm = (vector) => Math.max(0, ...vector.map(Math.abs));
export function wrapAngle(angle) { return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }

export function relativePose(fromPose, toPose) {
  const dx = toPose[0] - fromPose[0], dy = toPose[1] - fromPose[1], c = Math.cos(fromPose[2]), s = Math.sin(fromPose[2]);
  return [c * dx + s * dy, -s * dx + c * dy, wrapAngle(toPose[2] - fromPose[2])];
}

export function composePose(pose, relative) {
  const c = Math.cos(pose[2]), s = Math.sin(pose[2]);
  return [pose[0] + c * relative[0] - s * relative[1], pose[1] + s * relative[0] + c * relative[1], wrapAngle(pose[2] + relative[2])];
}

export function edgeResidual(poses, edge) {
  const predicted = relativePose(poses[edge.from], poses[edge.to]);
  return [predicted[0] - edge.measurement[0], predicted[1] - edge.measurement[1], wrapAngle(predicted[2] - edge.measurement[2])];
}

// Derivatives are with respect to additive world x/y and heading coordinates,
// away from the wrapped heading residual's branch cut.
export function edgeJacobians(poses, edge) {
  const pose = poses[edge.from], c = Math.cos(pose[2]), s = Math.sin(pose[2]), h = relativePose(pose, poses[edge.to]);
  return {
    from: [[-c, -s, h[1]], [s, -c, -h[0]], [0, 0, -1]],
    to: [[c, s, 0], [-s, c, 0], [0, 0, 1]],
  };
}

export function evaluateEdges(poses, edges) {
  return edges.map((edge) => {
    const predicted = relativePose(poses[edge.from], poses[edge.to]), residual = edgeResidual(poses, edge), whitenedResidual = residual.map((value, i) => value * Math.sqrt(edge.information[i]));
    return { id: edge.id, kind: edge.kind, from: edge.from, to: edge.to, predicted, residual, whitenedResidual, cost: whitenedResidual.reduce((sum, value) => sum + value * value, 0) };
  });
}

export function graphCost(poses, edges) {
  let cost = 0;
  for (const edge of edges) {
    const residual = edgeResidual(poses, edge);
    for (let row = 0; row < 3; row += 1) cost += residual[row] ** 2 * edge.information[row];
  }
  return cost;
}

// Eliminate pose 0 from the variables. Each factor contributes only its two
// endpoint blocks; the displayed example then solves a dense 72x72 system.
export function linearizeGraph(poses, edges) {
  const size = 3 * (poses.length - 1), normal = zeroMatrix(size), gradient = Array(size).fill(0);
  let cost = 0;
  for (const edge of edges) {
    const residual = edgeResidual(poses, edge), jacobians = edgeJacobians(poses, edge);
    for (let row = 0; row < 3; row += 1) {
      const entries = [];
      if (edge.from !== 0) for (let axis = 0; axis < 3; axis += 1) entries.push([3 * (edge.from - 1) + axis, jacobians.from[row][axis]]);
      if (edge.to !== 0) for (let axis = 0; axis < 3; axis += 1) entries.push([3 * (edge.to - 1) + axis, jacobians.to[row][axis]]);
      const weight = edge.information[row];
      cost += weight * residual[row] ** 2;
      for (const [i, ji] of entries) {
        gradient[i] += weight * ji * residual[row];
        for (const [j, jj] of entries) normal[i][j] += weight * ji * jj;
      }
    }
  }
  return { normal, gradient, cost };
}

export function solvePositiveDefinite(matrix, vector) {
  const size = matrix.length, lower = zeroMatrix(size), scale = Math.max(...matrix.map((row, i) => Math.abs(row[i]))), tolerance = scale * 1e-14;
  for (let i = 0; i < size; i += 1) for (let j = 0; j <= i; j += 1) {
    let value = matrix[i][j];
    for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
    if (i === j) {
      if (!(value > tolerance)) throw new Error('The reduced normal matrix is not numerically positive definite.');
      lower[i][j] = Math.sqrt(value);
    } else lower[i][j] = value / lower[j][j];
  }
  const y = Array(size).fill(0), result = Array(size).fill(0);
  for (let i = 0; i < size; i += 1) {
    y[i] = vector[i];
    for (let j = 0; j < i; j += 1) y[i] -= lower[i][j] * y[j];
    y[i] /= lower[i][i];
  }
  for (let i = size - 1; i >= 0; i -= 1) {
    result[i] = y[i];
    for (let j = i + 1; j < size; j += 1) result[i] -= lower[j][i] * result[j];
    result[i] /= lower[i][i];
  }
  return result;
}

export function applyIncrement(poses, direction, alpha = 1) {
  return poses.map((pose, index) => index === 0 ? [...pose] : [pose[0] + alpha * direction[3 * (index - 1)], pose[1] + alpha * direction[3 * (index - 1) + 1], wrapAngle(pose[2] + alpha * direction[3 * (index - 1) + 2])]);
}

export function optimizeStep(poses, edges, options = {}) {
  const gradientTolerance = options.gradientTolerance ?? GRADIENT_TOLERANCE, stepTolerance = options.stepTolerance ?? STEP_TOLERANCE, relativeCostTolerance = options.relativeCostTolerance ?? RELATIVE_COST_TOLERANCE;
  const maxBacktracks = options.maxBacktracks ?? MAX_BACKTRACKS, armijoC = options.armijoC ?? ARMIJO_C;
  const system = linearizeGraph(poses, edges), gradientInfinity = infinityNorm(system.gradient), size = system.gradient.length;
  const trace = { accepted: false, alpha: null, backtracks: 0, gradientInfinity, proposedStepInfinity: 0, stepInfinity: 0, relativeCostChange: 0, costBefore: system.cost, costAfter: system.cost, predictedReduction: 0, predictedRelativeReduction: 0, actualReduction: 0, direction: Array(size).fill(0), corrections: poses.map(() => [0, 0, 0]), trials: [], reason: '' };
  if (gradientInfinity <= gradientTolerance) {
    trace.reason = 'The infinity norm of JᵀΩe is below the gradient tolerance.';
    return { poses: clone(poses), status: 'stationary', trace };
  }
  let direction;
  try { direction = solvePositiveDefinite(system.normal, system.gradient.map((value) => -value)); } catch (error) {
    trace.reason = error.message;
    return { poses: clone(poses), status: 'linear-solve-failure', trace };
  }
  trace.direction = direction;
  const gradientDotDirection = system.gradient.reduce((sum, value, i) => sum + value * direction[i], 0);
  if (!(gradientDotDirection < 0) || !direction.every(Number.isFinite)) {
    trace.reason = 'The computed direction is not a finite descent direction.';
    return { poses: clone(poses), status: 'linear-solve-failure', trace };
  }
  trace.proposedStepInfinity = infinityNorm(direction);
  trace.predictedReduction = -gradientDotDirection;
  trace.predictedRelativeReduction = trace.predictedReduction / Math.max(1, Math.abs(system.cost));
  if (trace.proposedStepInfinity <= stepTolerance && trace.predictedRelativeReduction <= relativeCostTolerance) {
    trace.reason = 'The proposed Gauss–Newton component step and predicted relative improvement are both negligible; no pose update is applied.';
    return { poses: clone(poses), status: 'stationary', trace };
  }
  for (let backtracks = 0; backtracks <= maxBacktracks; backtracks += 1) {
    const alpha = 2 ** -backtracks, candidate = applyIncrement(poses, direction, alpha), cost = graphCost(candidate, edges);
    // The objective has no factor 1/2. Its directional derivative is therefore
    // 2*(JᵀΩe)ᵀ*direction, which must also appear in the Armijo inequality.
    const armijoBound = system.cost + 2 * armijoC * alpha * gradientDotDirection;
    const accepted = Number.isFinite(cost) && cost <= armijoBound;
    trace.trials.push({ alpha, cost, armijoBound, accepted });
    trace.backtracks = backtracks;
    if (accepted) {
      trace.accepted = true; trace.alpha = alpha; trace.costAfter = cost; trace.actualReduction = system.cost - cost;
      trace.predictedReduction = -(2 * alpha - alpha * alpha) * gradientDotDirection;
      trace.predictedRelativeReduction = trace.predictedReduction / Math.max(1, Math.abs(system.cost));
      trace.stepInfinity = alpha * infinityNorm(direction);
      trace.relativeCostChange = trace.actualReduction / Math.max(1, Math.abs(system.cost));
      trace.corrections = candidate.map((pose, i) => [pose[0] - poses[i][0], pose[1] - poses[i][1], wrapAngle(pose[2] - poses[i][2])]);
      const stationary = trace.stepInfinity <= stepTolerance && trace.relativeCostChange <= relativeCostTolerance;
      trace.reason = stationary ? 'Both the component step and relative cost change are below their tolerances.' : 'The Gauss–Newton direction passed Armijo backtracking.';
      return { poses: candidate, status: stationary ? 'stationary' : 'running', trace };
    }
  }
  trace.reason = 'No tested step length met the Armijo decrease condition; the recorded poses are unchanged.';
  return { poses: clone(poses), status: 'line-search-failure', trace };
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

export function truthAt(index) {
  const angle = 2 * Math.PI * index / (POSE_COUNT - 1);
  return [4 * Math.cos(angle), 4 * Math.sin(angle), wrapAngle(Math.PI / 2 + angle)];
}

function makeGraph(config) {
  const truth = Array.from({ length: POSE_COUNT }, (_, index) => truthAt(index)), gaussian = gaussianGenerator(config.seed), edges = [], initialPoses = [[...INITIAL_POSE]];
  function edge(id, kind, from, to, exact, translationStd, headingStd) {
    const std = [translationStd, translationStd, headingStd];
    const measurement = exact.map((value, i) => value + std[i] * gaussian()); measurement[2] = wrapAngle(measurement[2]);
    return { id, kind, from, to, measurement, std, information: std.map((value) => 1 / value ** 2) };
  }
  for (let index = 1; index < POSE_COUNT; index += 1) {
    const observation = edge(`O${String(index).padStart(2, '0')}`, 'odometry', index - 1, index, relativePose(truth[index - 1], truth[index]), ODOM_TRANSLATION_STD, ODOM_HEADING_STD);
    edges.push(observation); initialPoses.push(composePose(initialPoses.at(-1), observation.measurement));
  }
  // Consume the independent loop draw in every configuration, even no-loop.
  const loop = edge('loop', 'loop', 0, config.scenario === 'wrong-loop' ? 18 : 24, [0, 0, 0], LOOP_TRANSLATION_STD, LOOP_HEADING_STD);
  if (config.scenario !== 'no-loop') edges.push(loop);
  return { truth, initialPoses, edges, loopMeasurement: [...loop.measurement] };
}

function positionRmse(poses, truth) {
  return Math.sqrt(poses.slice(1).reduce((sum, pose, i) => sum + (pose[0] - truth[i + 1][0]) ** 2 + (pose[1] - truth[i + 1][1]) ** 2, 0) / (poses.length - 1));
}

function evaluate(run) {
  run.edgeStates = evaluateEdges(run.poses, run.edges);
  const loop = run.edgeStates.find((entry) => entry.kind === 'loop'), endpoint = run.poses.at(-1), truthEndpoint = run.truth.at(-1);
  const endpointHeadingError = Math.abs(wrapAngle(endpoint[2] - truthEndpoint[2]));
  run.metrics = {
    cost: run.edgeStates.reduce((sum, edge) => sum + edge.cost, 0), odometryCost: run.edgeStates.filter((entry) => entry.kind === 'odometry').reduce((sum, edge) => sum + edge.cost, 0),
    loopCost: loop ? loop.cost : null, loopResidualNorm: loop ? Math.sqrt(loop.cost) : null,
    trajectoryRmse: positionRmse(run.poses, run.truth), endpointError: Math.hypot(endpoint[0] - truthEndpoint[0], endpoint[1] - truthEndpoint[1]), endpointHeadingError, endpointHeadingErrorDegrees: endpointHeadingError * 180 / Math.PI,
    maxPositionCorrection: Math.max(...run.poses.map((pose, i) => Math.hypot(pose[0] - run.initialPoses[i][0], pose[1] - run.initialPoses[i][1]))),
    initialTrajectoryRmse: positionRmse(run.initialPoses, run.truth),
  };
}

function record(run) { run.history.push({ iteration: run.iteration, acceptedSteps: run.acceptedSteps, status: run.status, ...run.metrics, poses: clone(run.poses) }); }

export function createRun(options = {}) {
  const config = { scenario: 'correct-loop', seed: 7, ...options };
  if (!Object.hasOwn(SCENARIOS, config.scenario)) throw new Error('Unknown pose-graph scenario.');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) throw new Error('Seed must be an integer from 0 to 4294967295.');
  const graph = makeGraph(config);
  const run = { config, iteration: 0, acceptedSteps: 0, status: 'ready', poses: clone(graph.initialPoses), initialPoses: graph.initialPoses, truth: graph.truth, edges: graph.edges,
    evaluator: { loopMeasurement: graph.loopMeasurement }, edgeStates: [], metrics: {}, initialMetrics: {}, lastStep: null, history: [], events: [],
  };
  evaluate(run); run.initialMetrics = { ...run.metrics }; record(run);
  return run;
}

export function stepRun(run) {
  if (terminal(run.status)) return run;
  const result = optimizeStep(run.poses, run.edges);
  run.iteration += 1; run.lastStep = { iteration: run.iteration, ...result.trace }; run.poses = result.poses; run.status = result.status;
  if (result.trace.accepted) run.acceptedSteps += 1;
  if (run.status === 'running' && run.iteration >= MAX_ITERATIONS) { run.status = 'budget'; run.lastStep.reason = 'The 30-attempt optimization budget is exhausted.'; }
  evaluate(run); record(run);
  if (terminal(run.status)) run.events.push({ iteration: run.iteration, type: run.status, message: run.lastStep.reason });
  return run;
}

export function runToEnd(run) { while (!terminal(run.status)) stepRun(run); return run; }

export function referenceComparisons() {
  return Object.keys(SCENARIOS).map((scenario) => {
    const run = runToEnd(createRun({ scenario, seed: 7 }));
    return { scenario, label: SCENARIOS[scenario], seed: 7, iterations: run.iteration, acceptedSteps: run.acceptedSteps, status: run.status, initialMetrics: { ...run.initialMetrics }, metrics: { ...run.metrics } };
  });
}

export function compareSeeds({ count = 100, firstSeed = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Trial count must be an integer from 1 to 10000.');
  const totals = Object.fromEntries(Object.keys(SCENARIOS).map((scenario) => [scenario, { initialTrajectorySquared: 0, trajectorySquared: 0, initialEndpointSquared: 0, endpointSquared: 0, endpointHeadingSquared: 0, initialCost: 0, finalCost: 0, iterations: 0, acceptedSteps: 0, statuses: {}, failureSeeds: [], improvedTrajectory: 0, notImprovedTrajectorySeeds: [] }]));
  let correctLowerThanWrong = 0;
  const correctNotLowerThanWrongSeeds = [];
  for (let seed = firstSeed; seed < firstSeed + count; seed += 1) {
    const pair = {};
    for (const scenario of Object.keys(SCENARIOS)) {
      const run = runToEnd(createRun({ scenario, seed })), total = totals[scenario], initial = run.initialMetrics, final = run.metrics;
      pair[scenario] = final;
      total.initialTrajectorySquared += initial.trajectoryRmse ** 2; total.trajectorySquared += final.trajectoryRmse ** 2;
      total.initialEndpointSquared += initial.endpointError ** 2; total.endpointSquared += final.endpointError ** 2; total.endpointHeadingSquared += final.endpointHeadingError ** 2;
      total.initialCost += initial.cost; total.finalCost += final.cost; total.iterations += run.iteration; total.acceptedSteps += run.acceptedSteps;
      total.statuses[run.status] = (total.statuses[run.status] ?? 0) + 1;
      if (run.status !== 'stationary') total.failureSeeds.push({ seed, status: run.status });
      if (final.trajectoryRmse < initial.trajectoryRmse) total.improvedTrajectory += 1; else total.notImprovedTrajectorySeeds.push(seed);
    }
    if (pair['correct-loop'].trajectoryRmse < pair['wrong-loop'].trajectoryRmse) correctLowerThanWrong += 1; else correctNotLowerThanWrongSeeds.push(seed);
  }
  return { count, firstSeed, keyframes: POSE_COUNT, evaluatedPosesPerRun: POSE_COUNT - 1,
    scenarios: Object.fromEntries(Object.keys(SCENARIOS).map((scenario) => {
      const total = totals[scenario];
      return [scenario, { initialTrajectoryErrorRms: Math.sqrt(total.initialTrajectorySquared / count), trajectoryErrorRms: Math.sqrt(total.trajectorySquared / count), initialEndpointErrorRms: Math.sqrt(total.initialEndpointSquared / count), endpointErrorRms: Math.sqrt(total.endpointSquared / count), endpointHeadingErrorRms: Math.sqrt(total.endpointHeadingSquared / count), endpointHeadingErrorRmsDegrees: Math.sqrt(total.endpointHeadingSquared / count) * 180 / Math.PI, meanInitialCost: total.initialCost / count, meanFinalCost: total.finalCost / count, meanIterations: total.iterations / count, meanAcceptedSteps: total.acceptedSteps / count, statuses: total.statuses, failureSeeds: total.failureSeeds, improvedTrajectory: total.improvedTrajectory, notImprovedTrajectorySeeds: total.notImprovedTrajectorySeeds }];
    })), paired: { correctLowerThanWrong, correctNotLowerThanWrongSeeds },
    interpretation: 'One hundred paired seeded graphs by default; all scenarios share the same recorded odometry and loop noise. RMS values take the square root after averaging squared errors. Trajectory error excludes fixed pose 0 and averages 24 recorded positions, with no alignment to truth. Objective reduction is meaningful within one fixed graph; objectives from different edge sets are not accuracy rankings. These nonlinear optimization trials make no covariance-calibration or global-optimum claim. Terminal status is reported separately from truth error.',
  };
}
