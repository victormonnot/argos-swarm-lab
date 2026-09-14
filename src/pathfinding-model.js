export const PATH_DT = 0.1;
export const PATH_SPEED = 1;
export const PATH_BUDGET = 400;
export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 9;
export const PATH_METHODS = Object.freeze({ astar: 'A* · Manhattan heuristic', dijkstra: 'Dijkstra · zero heuristic', direct: 'Direct-to-goal baseline' });
export const PATH_MAPS = Object.freeze({ open: 'Open grid', u: 'U-shaped obstacle', sealed: 'Sealed enclosure' });
export const cellXY = (id, width = GRID_WIDTH) => [id % width, Math.floor(id / width)];
export const cellCenter = (id, width = GRID_WIDTH) => cellXY(id, width).map((value) => value + 0.5);
export const pathDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function pathGrid(map = 'u') {
  if (!Object.hasOwn(PATH_MAPS, map)) throw new RangeError('Unknown grid map.');
  const walls = [];
  if (map !== 'open') {
    for (let y = 2; y <= 6; y += 1) walls.push(y * GRID_WIDTH + 5);
    for (const y of [2, 6]) for (let x = 2; x < 5; x += 1) walls.push(y * GRID_WIDTH + x);
    if (map === 'sealed') for (let y = 3; y < 6; y += 1) walls.push(y * GRID_WIDTH + 2);
  }
  return { width: GRID_WIDTH, height: GRID_HEIGHT, blocked: walls.sort((a, b) => a - b), start: 4 * GRID_WIDTH + 3, goal: 4 * GRID_WIDTH + 10 };
}
function validateGrid(grid) {
  if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1 || grid.width * grid.height > 400) throw new RangeError('Grid dimensions must contain 1–400 cells.');
  const valid = (id) => Number.isInteger(id) && id >= 0 && id < grid.width * grid.height;
  if (!valid(grid.start) || !valid(grid.goal) || !Array.isArray(grid.blocked) || !Array.from(grid.blocked).every(valid)) throw new RangeError('Invalid grid cell.');
  if (grid.blocked.includes(grid.start) || grid.blocked.includes(grid.goal)) throw new RangeError('Start and goal must be free.');
}
export function manhattan(id, goal, width) {
  const a = cellXY(id, width), b = cellXY(goal, width);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
export function gridNeighbors(grid, id) {
  const [x, y] = cellXY(id, grid.width), result = [];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height && !grid.blocked.includes(ny * grid.width + nx)) result.push(ny * grid.width + nx);
  }
  return result;
}

/** Search only the supplied static map. A* uses a consistent Manhattan bound
 * for four-neighbor unit edges. Closed nodes need not reopen under this contract.
 * Array scanning keeps ordering inspectable; this is not a heap benchmark.
 */
export function searchGrid(grid, method = 'astar') {
  validateGrid(grid);
  if (!['astar', 'dijkstra'].includes(method)) throw new RangeError('Unknown graph search.');
  const g = Array(grid.width * grid.height).fill(null), parents = g.slice();
  const open = new Set([grid.start]), closed = new Set(), trace = [];
  const h = (id) => method === 'astar' ? manhattan(id, grid.goal, grid.width) : 0;
  const order = (a, b) => g[a] + h(a) - g[b] - h(b) || h(a) - h(b) || a - b;
  const snapshot = (current) => trace.push({ current, open: [...open].sort(order), closed: [...closed], g: [...g], parents: [...parents] });
  g[grid.start] = 0; snapshot(null);
  while (open.size) {
    const current = [...open].sort(order)[0]; open.delete(current); closed.add(current);
    if (current === grid.goal) {
      snapshot(current);
      const path = [current]; while (path[0] !== grid.start) path.unshift(parents[path[0]]);
      return { method, status: 'found', path, waypoints: path.slice(1).map((id) => cellCenter(id, grid.width)), cost: g[current], length: g[current], expanded: closed.size, trace };
    }
    for (const next of gridNeighbors(grid, current)) {
      if (closed.has(next)) continue;
      const candidate = g[current] + 1;
      if (g[next] === null || candidate < g[next]) { g[next] = candidate; parents[next] = current; open.add(next); }
    }
    snapshot(current);
  }
  return { method, status: 'unreachable', path: [], waypoints: [], cost: null, length: null, expanded: closed.size, trace };
}

/** Slab intersection with closed solid cells. This is evaluator geometry;
 * direct waypoint following has no obstacle-avoidance input. */
export function segmentGridContact(from, to, grid) {
  let first = null;
  for (const id of grid.blocked) {
    const minimum = cellXY(id, grid.width), maximum = minimum.map((value) => value + 1);
    let enter = 0, leave = 1, intersects = true;
    for (let axis = 0; axis < 2; axis += 1) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-14) {
        if (from[axis] < minimum[axis] - 1e-12 || from[axis] > maximum[axis] + 1e-12) intersects = false;
      } else {
        const a = (minimum[axis] - from[axis]) / delta, b = (maximum[axis] - from[axis]) / delta;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (intersects && enter <= leave + 1e-12 && enter <= 1 + 1e-12 && leave >= 0 && (first === null || enter < first.fraction)) first = { cell: id, fraction: Math.min(1, Math.max(0, enter)) };
  }
  return first;
}
function snapshot(run) {
  return { step: run.step, time: run.step * PATH_DT, position: [...run.position], distance: run.distance, goalDistance: pathDistance(run.position, cellCenter(run.grid.goal, run.grid.width)) };
}
export function createPathRun({ method = 'astar', map = 'u' } = {}) {
  if (!Object.hasOwn(PATH_METHODS, method)) throw new RangeError('Unknown path method.');
  const grid = pathGrid(map), position = cellCenter(grid.start, grid.width), goal = cellCenter(grid.goal, grid.width);
  const plan = method === 'direct' ? { method, status: 'unchecked', path: [], waypoints: [goal], cost: null, length: pathDistance(position, goal), expanded: 0, trace: [] } : searchGrid(grid, method);
  const run = { initial: { method, map }, grid, plan, step: 0, position, waypointIndex: 0, distance: 0, status: plan.status === 'unreachable' ? 'no-path' : 'following', contact: null, history: [] };
  run.history.push(snapshot(run)); return run;
}
export function pathExecutorObservation(run) {
  return { position: [...run.position], waypoint: run.plan.waypoints[run.waypointIndex] ? [...run.plan.waypoints[run.waypointIndex]] : null, speed: PATH_SPEED, dt: PATH_DT };
}
export function followWaypoint({ position, waypoint, speed, dt }) {
  if (!waypoint) return [...position];
  const distance = pathDistance(position, waypoint), reach = speed * dt;
  if (distance <= reach + 1e-12) return [...waypoint];
  return position.map((value, axis) => value + (waypoint[axis] - value) * reach / distance);
}
export function stepPath(run) {
  if (run.status !== 'following') return run;
  const proposed = followWaypoint(pathExecutorObservation(run));
  const contact = segmentGridContact(run.position, proposed, run.grid);
  const position = contact ? run.position.map((value, axis) => value + contact.fraction * (proposed[axis] - value)) : proposed;
  const next = { ...run, step: run.step + 1, position, contact, distance: run.distance + pathDistance(run.position, position), history: [...run.history] };
  if (contact) next.status = 'collision';
  else if (pathDistance(position, run.plan.waypoints[run.waypointIndex]) < 1e-12) {
    next.waypointIndex += 1;
    if (next.waypointIndex === run.plan.waypoints.length) next.status = 'reached';
  }
  if (next.status === 'following' && next.step >= PATH_BUDGET) next.status = 'budget';
  next.history.push(snapshot(next)); return next;
}
export function resetPath(run) { return createPathRun(run.initial); }
export function finishPath(run) { while (run.status === 'following') run = stepPath(run); return run; }
export function comparePaths() {
  return Object.keys(PATH_MAPS).flatMap((map) => Object.keys(PATH_METHODS).map((method) => {
    const run = finishPath(createPathRun({ method, map }));
    return { map, method, status: run.status, step: run.step, time: run.step * PATH_DT, plannedLength: run.plan.length, travelled: run.distance, expanded: run.plan.expanded, goalDistance: run.history.at(-1).goalDistance, path: run.plan.path, contact: run.contact };
  }));
}
