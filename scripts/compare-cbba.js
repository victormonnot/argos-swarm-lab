import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CBBA_ROUNDS, RESTORE_ROUND, CAPACITY, UTILITIES, createRun, referenceComparisons } from '../src/cbba-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null, workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported checkouts may not include Git metadata.
}
const initial = createRun();
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), runtime: process.version, revision, workingTreeModified,
  sourceHashes: { 'src/cbba-model.js': createHash('sha256').update(readFileSync(new URL('../src/cbba-model.js', import.meta.url))).digest('hex') },
  model: {
    agents: 3, tasks: 6, capacity: CAPACITY, rounds: CBBA_ROUNDS, restoreRound: RESTORE_ROUND,
    scoreUnit: 'utility points', timeUnit: 'communication round', layoutUnit: 'abstract display coordinates',
    utilities: UTILITIES,
    scoring: 'S_i(path) is the sum of fixed nonnegative utilities in agent i own row. All initial scores are positive integers. A task marginal gain is independent of the existing bundle, satisfying diminishing marginal gains with equality. A bid must beat the believed winner, with lower agent ID winning equal bids. Highest eligible marginal gain is acquired next, lower task ID on ties. All insertion positions tie; append is the declared choice.',
    protocol: 'Original CBBA bundle construction, all 17 timestamped Table 1 consensus rules, then suffix removal after the earliest lost acquisition and bundle rebuilding. A released task may be immediately reacquired; intermediate snapshots retain both events. Zero-based numeric IDs; -1 means no winner and its bid is zero.',
    transport: 'Undirected chain A1 ↔ A2 ↔ A3. Each directed edge attempts one frozen previous-boundary winner/bid/timestamp packet per round. Process delivered packets in ascending sender ID, merging timestamp knowledge after each whole packet and stamping direct contact with the current receiving round. Cut drops both A2 ↔ A3 directions from round 1; recovery drops rounds 1–4 and restores round 5. No queue, delay, within-round relay or out-of-order delivery.',
    initial: 'At round 0 each agent fills a two-task bundle before any communication, exposing competing claims. Task catalog and each own utility row remain fixed for the entire run.',
    local: 'The baseline uses identical local bundle scoring with zero communication. Each agent retains its independently selected bundle.',
    agentInputs: 'Own utility row, capacity, task IDs, current local bundle/path/winner/bid/timestamp state, and delivered neighbor packets. Agents receive no other utility rows, global conflicts, actual peer bundles, future link schedule or optimum.',
    evaluator: 'Separately collect actual bundle claims. Enumerate all feasible complete task-owner assignments under capacity two to obtain the exact score benchmark. This all-row evaluator is not part of the decentralized controller.',
    metrics: 'Conflicts count tasks claimed by more than one agent; unassigned counts tasks claimed by no agent; uniqueAssigned counts exactly-one-owner tasks. Agreement requires identical winner and winning-bid tables across every agent. firstAgreementRound is the first observed such boundary, not proof of distributed termination. Score and scoreRatio are null unless all six tasks have exactly one claimant. releaseCount sums all released bundle entries, including later reacquisitions.',
    traffic: 'Attempted, delivered and dropped directed logical packets. Not measured bytes, network traffic, bandwidth or wall-clock runtime.',
    stopping: 'Exactly 12 rounds for every case, even after agreement. The global evaluator does not control local decisions or stop the run.',
    fidelity: 'One synchronous browser allocation model. Planners and task markers are stationary; layout does not affect scores or topology. No vehicle movement, path cost, timing windows, task service, mission completion, radio simulation, middleware, asynchronous CBBA or coupled constraints.',
  },
  methodSources: [
    { title: 'Choi, Brunet and How (2009), Consensus-Based Decentralized Auctions for Robust Task Allocation', url: 'https://doi.org/10.1109/TRO.2009.2022423' },
    { title: 'MIT open-access publication record', url: 'https://dspace.mit.edu/handle/1721.1/52330' },
    { title: 'MIT Aerospace Controls Laboratory CBBA project', url: 'https://acl.mit.edu/projects/consensus-based-bundle-algorithm' },
    { title: 'MIT July 2010 MATLAB reference: timestamped consensus and bundle removal', url: 'https://acl.mit.edu/files/CBBA_MATLAB_ACLMIT_July13_2010.zip' },
  ],
  initial: { tasks: initial.tasks, bundles: initial.agents.map((agent) => agent.bundle), metrics: initial.metrics },
  exactOptimum: initial.evaluator.optimum,
  references: referenceComparisons(),
}, null, 2));
