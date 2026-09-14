import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MISSION_DT, MISSION_SPEED, SERVICE_STEPS, MISSION_BUDGET, FAILURE_STEP, MISSION_STARTS, TASK_POINTS, compareMissions } from '../src/mission-model.js';

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
  sourceHashes: Object.fromEntries(['src/assignment.js', 'src/mission-model.js'].map((path) => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])),
  model: {
    lengthUnit: 'm', timeUnit: 's', starts: MISSION_STARTS, tasks: TASK_POINTS,
    dt: MISSION_DT, speed: MISSION_SPEED, serviceSteps: SERVICE_STEPS, budget: MISSION_BUDGET,
    fixedOwners: TASK_POINTS.map((_, id) => id % 3),
    failure: { agentId: 1, step: FAILURE_STEP, time: FAILURE_STEP * MISSION_DT, detectionDelay: 0 },
    architecture: 'One central allocator with exact reports for every policy; no advance knowledge of failure.',
    objective: 'Hungarian minimizes the sum of current Euclidean distances over maximum-cardinality idle-agent / pending-task matchings. Fixed ownership imposes separate eligibility restrictions.',
    eventOrder: ['Execute one travel or service interval', 'Process completion reports', 'Apply scheduled unavailability and release unfinished work', 'Dispatch idle agents', 'Evaluate outcome'],
    servicePolicy: 'Arrival starts servicing for the next interval; interrupted service is discarded and restarted in full.',
    stopping: 'All tasks completed, no eligible execution remains, or 600 intervals elapsed.',
  },
  results: compareMissions(),
}, null, 2));
