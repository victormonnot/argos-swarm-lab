/** Planar disk kinematics and a small, explicit ORCA velocity-space solver.
 * Method: van den Berg et al., Reciprocal n-body Collision Avoidance, eqs. 5–7.
 * https://gamma-web.iacs.umd.edu/ORCA/publications/ORCA.pdf
 * This is an educational implementation, not a binding to the RVO2 library.
 */
export const DT = 0.05;
export const MAX_STEPS = 800;
export const RADIUS = 0.3;
export const SAFETY_PADDING = 0.01;
export const MAX_SPEED = 1;
export const GOAL_RADIUS = 0.15;
export const ATTRACTION_GAIN = 0.6;
export const PEER_RANGE = 0.7;
export const SEPARATION_GAIN = 0.02;
export const METHODS = Object.freeze({ orca: 'ORCA — reciprocal velocity constraints', apf: 'Artificial Potential Fields', direct: 'Direct preferred velocity' });
export const SCENARIOS = Object.freeze({ crossing: 'Offset crossing', headOn: 'Symmetric head-on', blind: 'Crossing with peer sensing unavailable' });
export const PRESETS = Object.freeze([
  { id: 'orca-crossing', label: 'ORCA crossing', config: { method: 'orca', scenario: 'crossing', horizon: 2 }, description: 'Three agents select reciprocal collision-avoiding velocities.' },
  { id: 'apf-crossing', label: 'APF crossing', config: { method: 'apf', scenario: 'crossing', horizon: 2 }, description: 'The same starts and goals with the earlier surface-clearance repulsion rule.' },
  { id: 'direct-crossing', label: 'Direct crossing', config: { method: 'direct', scenario: 'crossing', horizon: 2 }, description: 'The same preferred velocity, with no avoidance.' },
  { id: 'orca-head-on', label: 'Symmetry limit', config: { method: 'orca', scenario: 'headOn', horizon: 2 }, description: 'Perfectly symmetric head-on goals can prevent progress without a collision.' },
  { id: 'orca-blind', label: 'Missing peer sensing', config: { method: 'orca', scenario: 'blind', horizon: 2 }, description: 'The crossing geometry is unchanged, but every agent receives an empty peer observation.' },
].map((preset) => Object.freeze({ ...preset, config: Object.freeze(preset.config) })));

const EPS = 1e-10;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(...a);
const perpendicular = (a) => [-a[1], a[0]];
const cap = (a, maximum) => mul(a, Math.min(1, maximum / (norm(a) || 1)));
const distance = (a, b) => norm(sub(a, b));

/** Euclidean nearest velocity in a disk intersected with closed half-planes.
 * A minimizer is the preferred point, a disk projection, a line projection,
 * a line/line intersection or a line/circle intersection. Enumerate these
 * candidates for the tiny teaching cases instead of implementing an LP library.
 * Infeasible => zero command, explicitly flagged; stopping is NOT a safety proof.
 */
export function projectVelocity(preferred, constraints, maxSpeed = MAX_SPEED) {
  if (!Number.isFinite(maxSpeed) || maxSpeed <= 0) throw new RangeError('Maximum speed must be positive.');
  const lines = constraints.map(({ point, normal }) => {
    const magnitude = norm(normal);
    if (!(magnitude > 0)) throw new RangeError('Constraint normal must be nonzero.');
    const unit = mul(normal, 1 / magnitude);
    return { normal: unit, offset: dot(point, unit) };
  });
  const candidates = [cap(preferred, maxSpeed), [0, 0]];
  for (let i = 0; i < lines.length; i += 1) {
    const { normal, offset } = lines[i];
    candidates.push(add(preferred, mul(normal, offset - dot(preferred, normal))));
    if (Math.abs(offset) <= maxSpeed + EPS) {
      const center = mul(normal, offset), tangent = perpendicular(normal);
      const reach = Math.sqrt(Math.max(0, maxSpeed ** 2 - offset ** 2));
      candidates.push(add(center, mul(tangent, reach)), sub(center, mul(tangent, reach)));
    }
    for (let j = 0; j < i; j += 1) {
      const other = lines[j], determinant = normal[0] * other.normal[1] - normal[1] * other.normal[0];
      if (Math.abs(determinant) > EPS) candidates.push([
        (offset * other.normal[1] - normal[1] * other.offset) / determinant,
        (normal[0] * other.offset - offset * other.normal[0]) / determinant,
      ]);
    }
  }
  let velocity = null, best = Infinity;
  for (const candidate of candidates) {
    if (norm(candidate) > maxSpeed + EPS || lines.some(({ normal, offset }) => dot(candidate, normal) < offset - EPS)) continue;
    const cost = distance(candidate, preferred) ** 2;
    if (cost < best) { velocity = candidate; best = cost; }
  }
  return { velocity: velocity ?? [0, 0], feasible: velocity !== null };
}

/** Closest boundary of the finite-horizon velocity obstacle: a near circular
 * cap and two tangent rays. Normals point out of the forbidden velocity set.
 * Only observed own/peer position, velocity and radius enter this geometry.
 */
export function orcaConstraint(own, neighbor, horizon) {
  if (!Number.isFinite(horizon) || horizon <= 0) throw new RangeError('Horizon must be positive.');
  const relativePosition = sub(neighbor.position, own.position);
  const relativeVelocity = sub(own.velocity, neighbor.velocity);
  const combinedRadius = (own.radius ?? RADIUS) + (neighbor.radius ?? RADIUS);
  const separation = norm(relativePosition);
  let boundary, normal;
  if (separation <= combinedRadius) {
    // Recovery constraint for already overlapping observations. Normal runs
    // start separated and stop on swept contact, so they never use this branch.
    const center = mul(relativePosition, 1 / DT), delta = sub(relativeVelocity, center);
    normal = norm(delta) > EPS ? mul(delta, 1 / norm(delta))
      : separation > EPS ? mul(relativePosition, -1 / separation) : [own.id < neighbor.id ? -1 : 1, 0];
    boundary = add(center, mul(normal, combinedRadius / DT));
  } else {
    const axis = mul(relativePosition, 1 / separation), side = perpendicular(axis);
    const center = mul(relativePosition, 1 / horizon), circleRadius = combinedRadius / horizon;
    const sine = combinedRadius / separation, cosine = Math.sqrt(1 - sine ** 2);
    const rayStart = Math.sqrt(separation ** 2 - combinedRadius ** 2) / horizon;
    const candidates = [];
    const fromCenter = sub(relativeVelocity, center);
    const circleNormal = norm(fromCenter) > EPS ? mul(fromCenter, 1 / norm(fromCenter)) : mul(axis, -1);
    if (dot(circleNormal, axis) <= -sine + EPS) {
      candidates.push({ boundary: add(center, mul(circleNormal, circleRadius)), normal: circleNormal });
    }
    for (const sign of [1, -1]) {
      const tangent = add(mul(axis, cosine), mul(side, sign * sine));
      candidates.push({ boundary: mul(tangent, Math.max(rayStart, dot(relativeVelocity, tangent))), normal: mul(perpendicular(tangent), sign) });
    }
    const closest = candidates.reduce((best, candidate) => distance(candidate.boundary, relativeVelocity) < distance(best.boundary, relativeVelocity) ? candidate : best);
    ({ boundary, normal } = closest);
  }
  const correction = sub(boundary, relativeVelocity);
  return { neighbor: neighbor.id, point: add(own.velocity, mul(correction, 0.5)), normal, correction, boundary };
}

/** Decision input: own state/goal and currently observed peer states. Peer goals,
 * evaluator clearance, completion metrics and future commands are unavailable.
 */
export function observeAgent(run, index) {
  const agent = run.agents[index];
  if (!agent) throw new RangeError('Unknown agent.');
  return { id: agent.id, position: [...agent.position], velocity: [...agent.velocity], goal: [...agent.goal], radius: RADIUS,
    neighbors: run.config.scenario === 'blind' ? [] : run.agents.filter((other) => other.id !== agent.id)
      .map((other) => ({ id: other.id, position: [...other.position], velocity: [...other.velocity], radius: RADIUS })) };
}

export function decideVelocity(observation, config) {
  const delta = sub(observation.goal, observation.position);
  const attraction = norm(delta) <= GOAL_RADIUS ? [0, 0] : mul(delta, ATTRACTION_GAIN);
  const preferred = cap(attraction, MAX_SPEED);
  if (config.method === 'orca') {
    // A declared 1 cm padding per disk keeps mathematical tangency separate
    // from physical contact under floating-point arithmetic. Evaluation below
    // still uses the physical 30 cm radius for every comparison method.
    const paddedOwn = { ...observation, radius: observation.radius + SAFETY_PADDING };
    const constraints = observation.neighbors.map((neighbor) => orcaConstraint(paddedOwn, { ...neighbor, radius: neighbor.radius + SAFETY_PADDING }, config.horizon));
    return { preferred, constraints, ...projectVelocity(preferred, constraints) };
  }
  let raw = attraction;
  if (config.method === 'apf') {
    for (const neighbor of observation.neighbors) {
      const away = sub(observation.position, neighbor.position), separation = norm(away);
      const clearance = separation - observation.radius - neighbor.radius;
      if (clearance <= 0) throw new RangeError('APF repulsion is undefined at contact.');
      if (clearance < PEER_RANGE) {
        const magnitude = SEPARATION_GAIN * (1 / clearance - 1 / PEER_RANGE) / clearance ** 2;
        raw = add(raw, mul(away, magnitude / separation));
      }
    }
  }
  return { preferred, constraints: [], velocity: cap(raw, MAX_SPEED), feasible: true };
}

/** Evaluator only: minimum surface distance at the SAME within-step time.
 * Relative linear trajectories avoid treating spatial crossings at different
 * times as contacts and detect tunneling missed by endpoint-only checks.
 */
export function sweptClearance(before, after, radius = RADIUS) {
  let minimum = Infinity;
  for (let i = 0; i < before.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const start = sub(before[i], before[j]);
      const delta = sub(sub(after[i], after[j]), start);
      const fraction = dot(delta, delta) === 0 ? 0 : Math.max(0, Math.min(1, -dot(start, delta) / dot(delta, delta)));
      minimum = Math.min(minimum, norm(add(start, mul(delta, fraction))) - 2 * radius);
    }
  }
  return minimum;
}

function decisions(run) {
  return run.agents.map((_, index) => decideVelocity(observeAgent(run, index), run.config));
}

function recordDecision(run, commands) {
  run.decisionTime = run.time;
  run.agents.forEach((agent, index) => {
    const command = commands[index];
    Object.assign(agent, { decisionPosition: [...agent.position], decisionVelocity: [...agent.velocity], preferred: command.preferred,
      constraints: command.constraints, feasible: command.feasible, command: command.velocity });
  });
}

export function createRun({ method = 'orca', scenario = 'crossing', horizon = 2 } = {}) {
  if (!Object.hasOwn(METHODS, method)) throw new RangeError('Unknown avoidance method.');
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new RangeError('Unknown crossing scenario.');
  if (!Number.isFinite(horizon) || horizon < 0.25 || horizon > 5) throw new RangeError('Horizon must be between 0.25 and 5 seconds.');
  const pairs = scenario === 'headOn' ? [ [[-4, 0], [4, 0]], [[4, 0], [-4, 0]] ]
    : [ [[-4, -0.15], [4, -0.15]], [[0.2, -4], [0.2, 4]], [[4, 0.25], [-4, 0.25]] ];
  const agents = pairs.map(([position, goal], index) => ({ id: `A${index + 1}`, position, goal, velocity: [0, 0], trail: [[...position]] }));
  const positions = agents.map((agent) => agent.position);
  const run = { config: { method, scenario, horizon }, step: 0, time: 0, status: 'running', agents,
    metrics: { arrived: 0, minClearance: sweptClearance(positions, positions), infeasibleSteps: 0 } };
  // Prepared at step 0; after a step these fields describe its last applied
  // pre-step decision. Rendering or inspection must never advance the model.
  recordDecision(run, decisions(run));
  return run;
}

/** Mutates and returns this run. Every agent decides from the old snapshot. */
export function stepRun(run) {
  if (run.status !== 'running') return run;
  const commands = decisions(run);
  recordDecision(run, commands);
  const before = run.agents.map((agent) => [...agent.position]);
  run.agents.forEach((agent, index) => {
    agent.velocity = commands[index].velocity;
    agent.position = add(agent.position, mul(agent.velocity, DT));
    agent.trail.push([...agent.position]);
  });
  run.step += 1;
  run.time = run.step * DT;
  run.metrics.arrived = run.agents.filter((agent) => distance(agent.position, agent.goal) <= GOAL_RADIUS).length;
  run.metrics.minClearance = Math.min(run.metrics.minClearance, sweptClearance(before, run.agents.map((agent) => agent.position)));
  run.metrics.infeasibleSteps += commands.some((command) => !command.feasible) ? 1 : 0;
  run.status = run.metrics.minClearance <= 0 ? 'collision' : run.metrics.arrived === run.agents.length ? 'arrived' : run.step >= MAX_STEPS ? 'timeout' : 'running';
  return run;
}

export function runToEnd(run) {
  while (run.status === 'running') stepRun(run);
  return run;
}

export function referenceComparisons() {
  return PRESETS.map(({ id, label, config }) => {
    const run = runToEnd(createRun(config));
    return { id, label, config: { ...config }, status: run.status, time: run.time, ...run.metrics };
  });
}
