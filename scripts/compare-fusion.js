import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FUSION_ROUNDS, SENSOR_VARIANCE, TARGET, RESTORE_ROUND, createFusionRun, compareFusion, compareFusionSeeds } from '../src/fusion-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null, workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported checkouts may not include Git metadata.
}
const repeated = compareFusionSeeds();
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), runtime: process.version, revision, workingTreeModified,
  sourceHashes: { 'src/fusion-model.js': createHash('sha256').update(readFileSync(new URL('../src/fusion-model.js', import.meta.url))).digest('hex') },
  model: {
    agents: 3, target: TARGET, lengthUnit: 'm', covarianceUnit: 'm²', timeUnit: 'communication round',
    rounds: FUSION_ROUNDS, sensorVariance: SENSOR_VARIANCE, restoreRound: RESTORE_ROUND, ciWeight: 0.5,
    sensors: 'One independent, unbiased, isotropic Gaussian target-position measurement per agent at round0. Shared known coordinate frame; no common prior, bias or later measurements.',
    random: 'Initial uint32 state = imul(seed,2654435761). LCG: state=imul(1664525,state)+1013904223 modulo2^32; uniform=(state+0.5)/2^32. Six uniforms, three Box–Muller pairs at initialization. Same seed has identical readings for every method/schedule.',
    transport: 'Directed ring A1→A2→A3→A1; one previous-boundary packet per outgoing edge per round. Cut drops A3→A1 from round1 forever, recovery drops rounds1–4 and restores round5. No queue, delays, new sensor samples or within-round cascading.',
    local: 'Retain own observation and send zero packets, independent of selected schedule.',
    naive: 'Add information matrices/vectors as if each received Gaussian had independent error. This assumption fails when summaries share measurements.',
    ledger: 'Send complete original measurement records; union immutable unique IDs and fuse each once. Exact for the declared independent original errors. IDs do not establish independence generally.',
    ci: 'Covariance Intersection with fixed half weights on both information matrices/vectors. No weight optimization; uses summaries without provenance. Consistency requires consistent input covariances.',
    evaluator: 'Hidden linear coefficients on the three original readings give exact expected marginal variance R*sum(coefficients²), assuming the declared independent sensor model. Coefficients, all-source coverage and true target are never fusion inputs.',
    metrics: 'Final sample squared Euclidean error averaged across three agents. Expected trace averages analytical marginal covariance traces. Ratio is expected/reported trace; maxRatio is maximum across agents. NEES=eᵀP⁻¹e, with expectation2 for exact unbiased2D covariance; agents and methods within a seed are correlated.',
    traffic: 'Attempted/delivered/dropped directed packets; records counts delivered logical records (one Gaussian summary or ledger length). Not bytes, bandwidth or runtime.',
    stopping: 'Every run uses exactly12 rounds; window completion is not mission success or a distributed stopping criterion.',
    fidelity: 'Static target-position information experiment; no vehicle motion, own-pose localization, range/bearing geometry, mapping, real radios, dynamics or middleware.',
  },
  initialReadingsSeed1: createFusionRun().readings,
  references: compareFusion(),
  repeated: { seeds: repeated.seeds, groups: repeated.groups,
    trials: repeated.trials.map(({ method, schedule, seed, meanSquaredError, meanNEES }) => ({ method, schedule, seed, meanSquaredError, meanNEES })) },
}, null, 2));
