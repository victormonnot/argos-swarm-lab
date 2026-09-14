import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PATH_DT, PATH_SPEED, PATH_BUDGET, PATH_MAPS, pathGrid, comparePaths } from '../src/pathfinding-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null, workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // An exported checkout may not include Git metadata.
}
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), runtime: process.version, revision, workingTreeModified,
  sourceHashes: { 'src/pathfinding-model.js': createHash('sha256').update(readFileSync(new URL('../src/pathfinding-model.js', import.meta.url))).digest('hex') },
  model: {
    lengthUnit: 'm', timeUnit: 's', cellSize: 1, maps: Object.fromEntries(Object.keys(PATH_MAPS).map((map) => [map, pathGrid(map)])),
    cellConvention: 'id = y * width + x; y increases upward. Centers at (x+0.5,y+0.5) m.',
    dt: PATH_DT, speed: PATH_SPEED, budget: PATH_BUDGET,
    graph: 'Four-neighbor free cell centers; cardinal edges cost 1 m; no diagonals or smoothing.',
    heuristics: { astar: 'Manhattan distance to goal, consistent for the declared unit edges', dijkstra: 'Zero' },
    search: 'Select lexicographic minimum (f,h,cell ID); f=g+h. Relax strictly smaller g only; keep the predecessor on ties. Closed nodes do not reopen under the consistent heuristic. Stop on goal pop or empty frontier.',
    expansionCount: 'Number of popped/settled cells, including the goal; goal neighbors are not relaxed. No graph pops for direct baseline.',
    implementation: 'Array-based frontier selection with recorded full snapshots; at most 400 cells. Counts are not runtime or universal optimal expansion counts.',
    architecture: 'Single onboard planner with complete static map/start/goal; no messages or network.',
    executorInputs: 'Exact own position, current waypoint, constant speed and dt; no map, search frontier or obstacle avoidance.',
    execution: 'Plan at initialization in zero modeled motion time. Follow each waypoint for at most v*dt per step, clamping arrival. One target per update; instant turns and no carry-over beyond a waypoint.',
    direct: 'Only the goal is supplied as a waypoint; planned length is an unchecked Euclidean segment, not a valid graph route claim.',
    collision: 'Evaluator intersects the attempted segment with closed occupied-cell squares; stop and clip at earliest contact. Model time is the end of the contact-containing interval.',
    stopping: 'Goal reached without contact; or first collision; or unreachable graph with no motion at t=0; or 400 motion updates.',
    fidelity: 'Point robot in a known static planar map with perfect localization. No body radius, turning limits, dynamics, uncertainty, replanning or shared estimates.',
  },
  results: comparePaths(),
}, null, 2));
