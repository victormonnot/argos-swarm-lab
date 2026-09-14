import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MISSION_DT, MISSION_SPEED, SERVICE_STEPS, ARCHITECTURE_BUDGET, CUT_STEP, RESTORE_STEP, MISSION_STARTS, TASK_POINTS, NODE_NAMES, GROUPS, compareArchitectures } from '../src/architecture-model.js';

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
  sourceHashes: Object.fromEntries(['src/architecture-model.js', 'src/assignment.js', 'src/mission-model.js'].map((path) => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])),
  model: {
    lengthUnit: 'm', timeUnit: 's', starts: MISSION_STARTS, tasks: TASK_POINTS,
    dt: MISSION_DT, speed: MISSION_SPEED, serviceSteps: SERVICE_STEPS, budget: ARCHITECTURE_BUDGET,
    nodeNames: NODE_NAMES, groups: GROUPS,
    indexConvention: 'Task and agent IDs are zero-based; node 0 is C, nodes 1–3 are A1–A3.',
    allocation: 'Nearest-pair greedy, repeated over fresh idle reports and eligible unreserved tasks; stable agent/task ID ties.',
    authority: 'C assigns globally; or A1/A2 coordinate fixed disjoint domains; or each peer replicates the plan and applies its own target after full-roster agreement.',
    network: { cutStep: CUT_STEP, restoreStep: RESTORE_STEP, partition: [[0, 1], [2, 3]], presets: ['connected: all links active', 'partition: permanent cut at step 20', 'recovery: cut at step 20, restore at step 80'] },
    transport: 'Symmetric reliable active links, zero phase delay, fixed within a boundary; cut packets discarded, no forwarding or buffering.',
    report: 'Own ID, sample step, exact own position/state/target and full own completion history. Own report is local; three remote sends per agent, nine attempts per boundary including zero.',
    knowledge: 'Only delivered reports and own decisions enter each cache. Learned completions are monotone; reservations survive silence until completion is learned.',
    peerAgreement: 'All three current reports plus three matching same-round plans (including own proposal). Nonempty plans only; two remote proposals per peer; no central ready flag, quorum or leader election.',
    eventOrder: ['Execute one travel or service interval (except initial boundary zero)', 'Apply network schedule', 'Sample all own reports before new commands; deliver over active links', 'Compute plans from each separate cache and static scope', 'Exchange and compare nonempty peer plans', 'Apply permitted commands', 'Evaluate and snapshot'],
    servicePolicy: 'Arrival enters servicing; twenty following intervals complete a task. No executor failure is modeled.',
    confirmation: 'C learned-completion count for central/hierarchy; minimum count over A1/A2/A3 for peers. Peer coverage is an evaluator metric, not common knowledge or a termination protocol.',
    stopping: 'Six physical completions and six confirmed completions, otherwise the 600-interval budget; first physical completion time recorded separately.',
    duplicates: 'duplicateAssignments is the peak extra concurrent owners of any task; duplicateCompletions sums extra completion owners over tasks.',
    accounting: 'Packets, not bytes. Reports/proposals/remote commands count separately; local actions do not. The common all-to-all reports are not a traffic-optimal design for each architecture.',
  },
  results: compareArchitectures(),
}, null, 2));
