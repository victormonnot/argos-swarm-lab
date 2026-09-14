import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  DT, MOVEMENT_BUDGET, AGENT_RADIUS, WALL_RADIUS, MAX_SPEED, GOAL_RADIUS,
  OBSTACLE_RANGE, PEER_RANGE, STALL_WINDOW, STALL_SPEED, STALL_PROGRESS,
  STARTS, GOAL, DEFAULT_GAINS, MOVEMENT_SCENARIOS, compareMovement,
} from '../src/movement-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null;
let workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported copies can run without Git; leave unavailable metadata explicit.
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  revision,
  workingTreeModified,
  sourceHashes: {
    'src/movement-model.js': createHash('sha256').update(readFileSync(new URL('../src/movement-model.js', import.meta.url))).digest('hex'),
  },
  model: {
    algorithm: 'Artificial Potential Fields; capped first-order velocity adaptation',
    lengthUnit: 'm', timeUnit: 's', starts: STARTS, goal: GOAL, gains: DEFAULT_GAINS,
    agentRadius: AGENT_RADIUS, wallRadius: WALL_RADIUS, goalRadius: GOAL_RADIUS,
    maximumSpeed: MAX_SPEED, dt: DT, budget: MOVEMENT_BUDGET,
    obstacleInfluence: OBSTACLE_RANGE, peerInfluence: PEER_RANGE,
    stall: { updates: STALL_WINDOW, maximumSpeedBelow: STALL_SPEED, maximumGoalDistanceChangeBelow: STALL_PROGRESS },
    maps: MOVEMENT_SCENARIOS,
    contact: 'Nonpositive swept surface clearance; terminal time and positions are at the end of the first update containing contact.',
  },
  results: compareMovement(),
}, null, 2));
