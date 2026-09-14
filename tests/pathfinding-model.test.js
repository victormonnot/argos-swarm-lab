import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATH_DT, PATH_SPEED, PATH_BUDGET, PATH_MAPS, PATH_METHODS,
  cellCenter, pathGrid, manhattan, gridNeighbors, searchGrid,
  segmentGridContact, createPathRun, pathExecutorObservation, followWaypoint,
  stepPath, resetPath, finishPath, comparePaths,
} from '../src/pathfinding-model.js';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Independent unweighted reference: FIFO breadth-first traversal, with no model
// neighbors, heuristic, priority ordering or parent reconstruction reused.
function shortestDistance(grid) {
  const queue = [[grid.start % grid.width, Math.floor(grid.start / grid.width), 0]];
  const visited = new Set([grid.start]);
  const walls = new Set(grid.blocked);
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y, cost] = queue[head];
    if (y * grid.width + x === grid.goal) return cost;
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      const next = ny * grid.width + nx;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height || walls.has(next) || visited.has(next)) continue;
      visited.add(next);
      queue.push([nx, ny, cost + 1]);
    }
  }
  return null;
}

function seededGrids() {
  let state = 0x5eed1234;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 2 ** 32; };
  const grids = [
    { width: 1, height: 1, blocked: [], start: 0, goal: 0 },
    { width: 3, height: 3, blocked: [3, 4, 5], start: 0, goal: 8 },
    { width: 4, height: 3, blocked: [1, 5, 9], start: 2, goal: 2 },
  ];
  for (let sample = 0; sample < 100; sample += 1) {
    const width = 2 + Math.floor(random() * 7), height = 2 + Math.floor(random() * 7);
    const start = Math.floor(random() * width * height), goal = Math.floor(random() * width * height);
    const blocked = Array.from({ length: width * height }, (_, id) => id)
      .filter((id) => id !== start && id !== goal && random() < 0.3);
    grids.push({ width, height, blocked, start, goal });
  }
  return grids;
}

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

test('A* and Dijkstra match independent FIFO shortest distances on seeded grids and edge cases', () => {
  let reachable = 0, unreachable = 0;
  for (const grid of seededGrids()) {
    const expected = shortestDistance(grid);
    if (expected === null) unreachable += 1; else reachable += 1;
    for (const method of ['astar', 'dijkstra']) {
      const result = searchGrid(grid, method);
      assert.equal(result.cost, expected, `${method}: ${JSON.stringify(grid)}`);
      assert.equal(result.length, expected);
      assert.equal(result.status, expected === null ? 'unreachable' : 'found');
      if (expected === null) {
        assert.deepEqual(result.path, []);
        assert.deepEqual(result.waypoints, []);
        continue;
      }
      assert.equal(result.path[0], grid.start);
      assert.equal(result.path.at(-1), grid.goal);
      assert.equal(result.path.length - 1, expected);
      assert.equal(new Set(result.path).size, result.path.length);
      for (let i = 0; i < result.path.length; i += 1) {
        const id = result.path[i];
        assert.ok(Number.isInteger(id) && id >= 0 && id < grid.width * grid.height);
        assert.equal(grid.blocked.includes(id), false);
        if (i === 0) continue;
        const prior = result.path[i - 1];
        assert.equal(Math.abs(id % grid.width - prior % grid.width) + Math.abs(Math.floor(id / grid.width) - Math.floor(prior / grid.width)), 1);
        assert.deepEqual(result.waypoints[i - 1], [id % grid.width + 0.5, Math.floor(id / grid.width) + 0.5]);
      }
    }
  }
  assert.ok(reachable > 10 && unreachable > 10, 'The seeded cases exercise both outcomes.');
});

test('Manhattan is zero at the goal, admissible and consistent on the declared unit-edge grids', () => {
  for (const grid of seededGrids()) {
    assert.equal(manhattan(grid.goal, grid.goal, grid.width), 0);
    const oracle = shortestDistance(grid);
    if (oracle !== null) assert.ok(manhattan(grid.start, grid.goal, grid.width) <= oracle);
    for (let id = 0; id < grid.width * grid.height; id += 1) {
      if (grid.blocked.includes(id)) continue;
      const neighbors = gridNeighbors(grid, id);
      for (const next of neighbors) {
        assert.ok(next >= 0 && next < grid.width * grid.height && !grid.blocked.includes(next));
        assert.equal(Math.abs(id % grid.width - next % grid.width) + Math.abs(Math.floor(id / grid.width) - Math.floor(next / grid.width)), 1);
        assert.ok(manhattan(id, grid.goal, grid.width) <= 1 + manhattan(next, grid.goal, grid.width));
      }
    }
  }
});

test('search leaves the map unchanged and records independent inspectable expansion snapshots', () => {
  for (const method of ['astar', 'dijkstra']) for (const map of Object.keys(PATH_MAPS)) {
    const grid = freezeTree(pathGrid(map)), before = structuredClone(grid);
    const result = searchGrid(grid, method);
    assert.deepEqual(grid, before);
    assert.equal(result.trace.length, result.expanded + 1);
    assert.equal(result.trace[0].current, null);
    assert.deepEqual(result.trace[0].open, [grid.start]);
    assert.deepEqual(result.trace[0].closed, []);
    for (let i = 1; i < result.trace.length; i += 1) {
      const frame = result.trace[i], previous = result.trace[i - 1];
      assert.equal(frame.closed.length, i);
      assert.equal(new Set(frame.closed).size, i);
      assert.deepEqual(frame.closed.slice(0, -1), previous.closed);
      assert.equal(frame.closed.at(-1), frame.current);
      assert.ok(frame.open.every((id) => !frame.closed.includes(id)));
      assert.notEqual(frame.g, previous.g);
      assert.notEqual(frame.parents, previous.parents);
      assert.notEqual(frame.open, previous.open);
      assert.notEqual(frame.closed, previous.closed);
    }
    if (result.status === 'found') assert.equal(result.trace.at(-1).current, grid.goal);
    else assert.deepEqual(result.trace.at(-1).open, []);
    result.trace[0].g[grid.start] = -999;
    assert.equal(result.trace[1].g[grid.start], 0);
  }
});

test('invalid map, method, dimensions, endpoints and blocked cells fail explicitly', () => {
  for (const map of ['missing', '', null]) assert.throws(() => createPathRun({ map }), RangeError);
  for (const method of ['missing', '', null]) assert.throws(() => createPathRun({ method }), RangeError);
  assert.throws(() => searchGrid(pathGrid(), 'direct'), RangeError);
  const valid = { width: 3, height: 3, start: 0, goal: 8, blocked: [] };
  for (const grid of [null, undefined,
    ...[0, -1, 1.5, '3', Infinity].map((width) => ({ ...valid, width })),
    ...[0, -1, 1.5, '3', Infinity].map((height) => ({ ...valid, height })),
    { ...valid, width: 401, height: 1 },
    ...[-1, 9, 0.5, '0', null].map((start) => ({ ...valid, start })),
    ...[-1, 9, 0.5, '8', null].map((goal) => ({ ...valid, goal })),
    ...[null, {}, [0], [8], [-1], [9], [1.5], ['1'], Array(1)].map((blocked) => ({ ...valid, blocked })),
  ]) assert.throws(() => searchGrid(grid), RangeError);
  assert.equal(searchGrid({ width: 20, height: 20, start: 0, goal: 0, blocked: [] }).cost, 0);
});

test('waypoint following clamps arrival, preserves direction and receives only local execution inputs', () => {
  const inputs = freezeTree({ position: [0, 0], waypoint: [3, 4], speed: 2, dt: 0.1 });
  const advanced = followWaypoint(inputs);
  close(advanced[0], 0.12);
  close(advanced[1], 0.16);
  assert.deepEqual(followWaypoint({ ...inputs, waypoint: [0.03, 0.04] }), [0.03, 0.04]);
  assert.deepEqual(followWaypoint({ ...inputs, waypoint: [0, 0] }), [0, 0]);
  const stopped = followWaypoint({ ...inputs, waypoint: null });
  assert.deepEqual(stopped, inputs.position);
  assert.notEqual(stopped, inputs.position);
  const run = stepPath(createPathRun({ method: 'direct', map: 'u' }));
  const observation = pathExecutorObservation(run);
  const replaced = { ...run, grid: null, history: null, distance: -999, contact: { cell: -1 }, status: 'reached', initial: null,
    plan: { ...run.plan, path: null, trace: null, status: 'unreachable', length: -999, cost: -999, expanded: -999 } };
  assert.deepEqual(pathExecutorObservation(replaced), observation);
  assert.deepEqual(Object.keys(observation).sort(), ['dt', 'position', 'speed', 'waypoint']);
  assert.deepEqual(followWaypoint({ ...observation, grid: pathGrid('sealed'), contact: true, goalDistance: 0 }), followWaypoint(observation));
  observation.position[0] = 999;
  observation.waypoint[0] = 999;
  assert.notEqual(run.position[0], 999);
  assert.notEqual(run.plan.waypoints[run.waypointIndex][0], 999);
});

test('swept contact detects tunneling, reverse motion, corner touches and closed-cell grazing', () => {
  const grid = { width: 5, height: 5, blocked: [6] };
  for (const [from, to, fraction] of [
    [[-1, 1.5], [4, 1.5], 0.4],
    [[4, 1.5], [-1, 1.5], 0.4],
    [[0, 0], [3, 3], 1 / 3],
    [[0, 2], [2, 0], 0.5],
    [[0, 1], [3, 1], 1 / 3],
    [[1.5, 1.5], [1.5, 1.5], 0],
    [[1, 1], [1, 1], 0],
    [[0, 1.5], [1, 1.5], 1],
  ]) {
    const contact = segmentGridContact(from, to, grid);
    assert.equal(contact?.cell, 6);
    close(contact.fraction, fraction);
  }
  for (const [from, to] of [
    [[0, 0.5], [3, 0.5]], [[3, 1.5], [4, 1.5]],
    [[0.5, 1], [0.5, 1]], [[0, 0], [0.5, 0.5]],
  ]) assert.equal(segmentGridContact(from, to, grid), null);
  const twoWalls = { ...grid, blocked: [8, 6] };
  assert.deepEqual(segmentGridContact([0, 1.5], [5, 1.5], twoWalls), { cell: 6, fraction: 0.2 });
  assert.deepEqual(segmentGridContact([5, 1.5], [0, 1.5], twoWalls), { cell: 8, fraction: 0.2 });
});

test('all reference motion respects the speed bound, path waypoints and swept stopping position', () => {
  for (const map of Object.keys(PATH_MAPS)) for (const method of Object.keys(PATH_METHODS)) {
    let run = createPathRun({ map, method });
    while (run.status === 'following') {
      const previous = run, waypoint = pathExecutorObservation(previous).waypoint;
      run = stepPath(run);
      const travelled = distance(previous.position, run.position);
      assert.ok(travelled <= PATH_SPEED * PATH_DT + 1e-12);
      close(run.distance - previous.distance, travelled);
      assert.equal(run.step, previous.step + 1);
      assert.equal(run.history.length, run.step + 1);
      assert.ok(distance(run.position, waypoint) <= distance(previous.position, waypoint) + 1e-12);
      if (run.waypointIndex > previous.waypointIndex) assert.deepEqual(run.position, waypoint);
      if (method !== 'direct') assert.equal(run.contact, null);
    }
    if (run.status === 'reached') assert.deepEqual(run.position, cellCenter(run.grid.goal, run.grid.width));
    if (run.status === 'collision') {
      close(run.position[0], 5);
      close(run.position[1], 4.5);
      assert.equal(run.contact.cell, 53);
      assert.ok(distance(run.position, cellCenter(run.grid.goal, run.grid.width)) > 5);
    }
  }
});

test('an exhausted search declares no path without advancing or moving the physical executor', () => {
  for (const method of ['astar', 'dijkstra']) {
    const initial = createPathRun({ method, map: 'sealed' });
    assert.equal(initial.plan.status, 'unreachable');
    assert.equal(initial.plan.expanded, 6);
    assert.equal(initial.status, 'no-path');
    assert.equal(finishPath(initial), initial);
    assert.equal(stepPath(initial), initial);
    assert.equal(initial.step, 0);
    assert.equal(initial.distance, 0);
    assert.equal(initial.history.length, 1);
    assert.deepEqual(initial.position, cellCenter(initial.grid.start, initial.grid.width));
    assert.equal(pathExecutorObservation(initial).waypoint, null);
  }
});

test('transitions preserve their input, reset reproduces the run and every terminal status is stable', () => {
  for (const map of Object.keys(PATH_MAPS)) for (const method of Object.keys(PATH_METHODS)) {
    const initial = freezeTree(createPathRun({ map, method })), before = structuredClone(initial);
    const next = stepPath(initial);
    assert.deepEqual(initial, before);
    if (initial.status === 'following') assert.notEqual(next, initial);
    const final = freezeTree(finishPath(next));
    assert.deepEqual(finishPath(resetPath(final)), final);
    assert.equal(stepPath(final), final);
    assert.equal(finishPath(final), final);
  }
  const atBudgetBoundary = { ...createPathRun({ map: 'open' }), step: PATH_BUDGET - 1 };
  const stopped = stepPath(atBudgetBoundary);
  assert.equal(stopped.step, PATH_BUDGET);
  assert.equal(stopped.status, 'budget');
  assert.equal(stepPath(stopped), stopped);
});

test('the nine reference outcomes distinguish shortest routes, expansion effort and unchecked collisions', () => {
  const results = comparePaths();
  assert.equal(results.length, 9);
  assert.deepEqual(results.map(({ map, method }) => `${map}:${method}`), [
    'open:astar', 'open:dijkstra', 'open:direct',
    'u:astar', 'u:dijkstra', 'u:direct',
    'sealed:astar', 'sealed:dijkstra', 'sealed:direct',
  ]);
  assert.deepEqual(results.map(({ status }) => status), ['reached', 'reached', 'reached', 'reached', 'reached', 'collision', 'no-path', 'no-path', 'collision']);
  assert.deepEqual(results.map(({ step }) => step), [70, 70, 70, 170, 170, 15, 0, 0, 15]);
  assert.deepEqual(results.map(({ expanded }) => expanded), [8, 74, 0, 30, 95, 0, 6, 6, 0]);
  assert.deepEqual(results.map(({ plannedLength }) => plannedLength), [7, 7, 7, 17, 17, 7, null, null, 7]);
  const travelled = [7, 7, 7, 17, 17, 1.5, 0, 0, 1.5];
  const remaining = [0, 0, 0, 0, 0, 5.5, 7, 7, 5.5];
  for (let i = 0; i < results.length; i += 1) {
    close(results[i].travelled, travelled[i]);
    close(results[i].goalDistance, remaining[i]);
    close(results[i].time, results[i].step * PATH_DT);
  }
});
