/** Artificial potential fields for three planar, velocity-controlled disk agents. */
export const DT = 0.02;
export const MOVEMENT_BUDGET = 2000;
export const AGENT_RADIUS = 0.12;
export const WALL_RADIUS = 0.10;
export const MAX_SPEED = 1;
export const GOAL_RADIUS = 0.8;
export const OBSTACLE_RANGE = 1;
export const PEER_RANGE = 0.7;
export const STALL_WINDOW = 100;
export const STALL_SPEED = 0.005;
export const STALL_PROGRESS = 0.01;
export const STARTS = Object.freeze([[-4, -0.6], [-4, 0], [-4, 0.6]].map(Object.freeze));
export const GOAL = Object.freeze([4, 0]);
export const DEFAULT_GAINS = Object.freeze({ attraction: 0.6, obstacle: 0.15, separation: 0.02 });
const sideWalls = [[[-1.8, -1.3], [1, -1.3]], [[-1.8, 1.3], [1, 1.3]]];
export const MOVEMENT_SCENARIOS = Object.freeze({
  open: { label: 'Open field', walls: [] },
  corridor: { label: 'Open corridor', walls: sideWalls },
  trap: { label: 'U-shaped trap', walls: [...sideWalls, [[1, -1.3], [1, 1.3]]] },
});
const copy = (value) => structuredClone(value);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (vector, gain) => vector.map((value) => value * gain);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const length = (vector) => Math.hypot(...vector);
export const distance = (a, b) => length(subtract(a, b));

export function closestPoint(point, start, end) {
  const edge = subtract(end, start);
  const denominator = dot(edge, edge);
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, dot(subtract(point, start), edge) / denominator));
  return add(start, scale(edge, t));
}

function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
/** Minimum centerline distance over two continuous segments, including crossings. */
export function segmentDistance(a, b, c, d) {
  const ab = subtract(b, a), cd = subtract(d, c), ac = subtract(c, a);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) > 1e-14) {
    const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(distance(a, closestPoint(a, c, d)), distance(b, closestPoint(b, c, d)),
    distance(c, closestPoint(c, a, b)), distance(d, closestPoint(d, a, b)));
}

/** Simulator evaluation only: swept disk clearances under linear within-step motion. */
export function sweptClearance(previous, next, walls) {
  let minimum = Infinity;
  for (let i = 0; i < previous.length; i += 1) {
    for (const [a, b] of walls) minimum = Math.min(minimum, segmentDistance(previous[i], next[i], a, b) - AGENT_RADIUS - WALL_RADIUS);
    for (let j = i + 1; j < previous.length; j += 1) {
      const from = subtract(previous[i], previous[j]), to = subtract(next[i], next[j]);
      minimum = Math.min(minimum, length(closestPoint([0, 0], from, to)) - 2 * AGENT_RADIUS);
    }
  }
  return minimum;
}

function validateGains(gains) {
  const limits = { attraction: [0.2, 1.2], obstacle: [0, 0.4], separation: [0, 0.08] };
  for (const [key, [low, high]] of Object.entries(limits)) {
    if (!Number.isFinite(gains[key]) || gains[key] < low || gains[key] > high) {
      throw new RangeError(`${key} gain must be between ${low} and ${high}.`);
    }
  }
  return Object.fromEntries(Object.keys(limits).map((key) => [key, gains[key]]));
}

/** Permitted agent information: own pose, assigned goal/map, finite-range peers. */
export function observeMovement(run, index) {
  if (!Number.isInteger(index) || index < 0 || index >= run.positions.length) throw new RangeError('Unknown agent.');
  const own = run.positions[index];
  return {
    index, position: [...own], goal: [...GOAL], walls: copy(run.walls),
    neighbors: run.positions.flatMap((position, other) => other !== index && distance(own, position) - 2 * AGENT_RADIUS < PEER_RANGE
      ? [{ index: other, position: [...position] }] : []),
  };
}

function repulsion(position, center, clearance, influence, gain) {
  if (gain === 0 || clearance >= influence) return [0, 0];
  const delta = subtract(position, center), norm = length(delta);
  // Valid runs start collision-free and stop on swept contact. The potential is
  // defined only outside surfaces; never turn a collision into an avoidance step.
  if (clearance <= 0) throw new RangeError('Repulsion is undefined at contact.');
  const magnitude = gain * (1 / clearance - 1 / influence) / clearance ** 2;
  return norm === 0 ? [0, 0] : scale(delta, magnitude / norm);
}

export function movementCommand(observation, gains) {
  const attraction = scale(subtract(observation.goal, observation.position), gains.attraction);
  let obstacle = [0, 0], separation = [0, 0];
  for (const [a, b] of observation.walls) {
    const surface = closestPoint(observation.position, a, b);
    const clearance = distance(observation.position, surface) - AGENT_RADIUS - WALL_RADIUS;
    obstacle = add(obstacle, repulsion(observation.position, surface, clearance, OBSTACLE_RANGE, gains.obstacle));
  }
  for (const neighbor of observation.neighbors) {
    const clearance = distance(observation.position, neighbor.position) - 2 * AGENT_RADIUS;
    separation = add(separation, repulsion(observation.position, neighbor.position, clearance, PEER_RANGE, gains.separation));
  }
  const raw = add(add(attraction, obstacle), separation);
  const velocity = scale(raw, Math.min(1, MAX_SPEED / (length(raw) || 1)));
  return { attraction, obstacle, separation, raw, velocity, neighbors: observation.neighbors.map((peer) => peer.index) };
}

function snapshot(step, positions, maxSpeed, clearance, pathLengths) {
  const goalDistances = positions.map((position) => distance(position, GOAL));
  return { step, time: step * DT, positions: copy(positions), maxSpeed, clearance,
    maxGoalDistance: Math.max(...goalDistances), arrived: goalDistances.filter((value) => value <= GOAL_RADIUS).length,
    goalDistances, totalPathLength: pathLengths.reduce((sum, value) => sum + value, 0) };
}

export function createMovementRun({ preset = 'corridor', gains = DEFAULT_GAINS } = {}) {
  if (!Object.hasOwn(MOVEMENT_SCENARIOS, preset)) throw new RangeError('Unknown movement scenario.');
  const initial = { preset, gains: validateGains({ ...DEFAULT_GAINS, ...gains }) };
  const positions = copy(STARTS), walls = copy(MOVEMENT_SCENARIOS[preset].walls);
  const clearance = sweptClearance(positions, positions, walls);
  const pathLengths = positions.map(() => 0);
  return { initial, positions, walls, gains: { ...initial.gains }, step: 0, status: 'running',
    pathLengths, minimumClearance: clearance, history: [snapshot(0, positions, 0, clearance, pathLengths)] };
}

export function stepMovement(run) {
  if (run.status !== 'running') return run;
  // Every command uses observations of the same old snapshot, before replacing
  // any positions. Evaluator metrics never enter movementCommand.
  const commands = run.positions.map((_, index) => movementCommand(observeMovement(run, index), run.gains));
  const positions = run.positions.map((position, index) => add(position, scale(commands[index].velocity, DT)));
  const clearance = sweptClearance(run.positions, positions, run.walls);
  const pathLengths = run.pathLengths.map((path, index) => path + distance(run.positions[index], positions[index]));
  const step = run.step + 1;
  const state = snapshot(step, positions, Math.max(...commands.map((command) => length(command.velocity))), clearance, pathLengths);
  const history = [...run.history, state];
  let status = clearance <= 0 ? 'collision' : state.arrived === positions.length ? 'arrived' : 'running';
  if (status === 'running' && step >= STALL_WINDOW) {
    const window = history.slice(-STALL_WINDOW);
    if (window.every((point) => point.maxSpeed < STALL_SPEED)
      && Math.abs(state.maxGoalDistance - history[history.length - 1 - STALL_WINDOW].maxGoalDistance) < STALL_PROGRESS) status = 'stalled';
  }
  if (status === 'running' && step >= MOVEMENT_BUDGET) status = 'budget';
  return { ...run, positions, step, status, pathLengths, history, minimumClearance: Math.min(run.minimumClearance, clearance) };
}

export function resetMovement(run) { return createMovementRun(run.initial); }
export function finishMovement(run) {
  while (run.status === 'running') run = stepMovement(run);
  return run;
}

export function compareMovement() {
  return [
    { label: 'Open field', preset: 'open' },
    { label: 'Open corridor', preset: 'corridor' },
    { label: 'U-shaped trap', preset: 'trap' },
    { label: 'Open field, separation off', preset: 'open', gains: { separation: 0 } },
    { label: 'U-shaped trap, obstacle repulsion off', preset: 'trap', gains: { obstacle: 0 } },
  ].map(({ label, ...options }) => {
    const run = finishMovement(createMovementRun(options)), last = run.history.at(-1);
    return { label, initial: run.initial, status: run.status, step: run.step, time: last.time,
      arrived: last.arrived, maxGoalDistance: last.maxGoalDistance, minimumClearance: run.minimumClearance,
      totalPathLength: last.totalPathLength, finalPositions: run.positions };
  });
}
