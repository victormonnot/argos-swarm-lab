import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LOCAL_DT, LOCAL_SPEED, LOCAL_BUDGET, FIX_PERIOD, FIX_LOSS_STEP, FIX_RETURN_STEP, WAYPOINT_TOLERANCE, GOAL_TOLERANCE, ODOMETRY_SIGMA, FIX_SIGMA, PROCESS_VARIANCE, FIX_VARIANCE, ODOMETRY_BIAS, LOCAL_MAPS, compareLocalization, compareLocalizationSeeds } from '../src/localization-model.js';
import { pathGrid } from '../src/pathfinding-model.js';

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
  sourceHashes: Object.fromEntries(['src/localization-model.js', 'src/pathfinding-model.js'].map((path) => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])),
  model: {
    lengthUnit: 'm', timeUnit: 's', covarianceUnit: 'm²', maps: Object.fromEntries(Object.keys(LOCAL_MAPS).map((map) => [map, pathGrid(map)])),
    dt: LOCAL_DT, speed: LOCAL_SPEED, budget: LOCAL_BUDGET, waypointTolerance: WAYPOINT_TOLERANCE, actualGoalTolerance: GOAL_TOLERANCE,
    fixPeriod: FIX_PERIOD, lossStep: FIX_LOSS_STEP, returnStep: FIX_RETURN_STEP,
    odometrySigma: ODOMETRY_SIGMA, absoluteFixSigma: FIX_SIGMA, odometryBiasRate: ODOMETRY_BIAS,
    assumedQ: PROCESS_VARIANCE, assumedR: FIX_VARIANCE, initialCovariance: [0, 0], referenceBiasEnabled: true,
    route: 'A* Manhattan route planned once from known exact start on the static four-neighbor grid.',
    controller: 'Exact position for privileged oracle; otherwise estimated position and current waypoint only. Clamped displacement at v*dt; accept one waypoint within 0.10 m after estimator update.',
    sensors: 'Odometry = actual clipped displacement + b*dt + Gaussian perturbation. Absolute fix = current truth + Gaussian perturbation. Fixes begin at step10, never step0.',
    random: '32-bit LCG (1664525,1013904223), uniform=(state+0.5)/2^32. Four uniforms per interval, two Box–Muller pairs for odometry and absolute errors. All methods/schedules consume every draw, including missing fixes.',
    estimators: 'Dead reckoning integrates odometry and ignores fixes. Linear Kalman predicts two independent position coordinates, then corrects only on a fresh fix. Exact reference gets truth and ignores sensors.',
    covariance: 'Identity F/B/H; Pminus=P+Q, K=Pminus/(Pminus+R), Pplus=(1-K)^2*Pminus+K^2*R (Joseph). No bias state: fixed nonzero bias violates zero-mean assumptions; covariance is not calibrated true error.',
    eventOrder: ['Command from previous estimate/waypoint', 'Move true point and evaluate swept contact', 'Generate displacement and optional absolute reading', 'Update estimator', 'Accept waypoint from estimate unless contact', 'Classify actual arrival/false arrival/contact/budget'],
    stopping: 'Contact takes priority. At controller completion, actual goal distance <=0.25m is arrived, otherwise false-arrival. Stop at400 intervals if still following; terminal runs never process future restoration.',
    errorMetric: 'Euclidean estimated-minus-true position. RMS includes initialization and all snapshots through that run’s own terminal step. Seed-group mean is an unweighted average of per-run RMS values, not a fixed-duration benchmark.',
    fidelity: 'Single point robot, exact known initial pose/map, no heading/dynamics, body radius, avoidance, replanning, real GNSS/IMU/SLAM or shared estimates.',
  },
  references: compareLocalization(), repeated: compareLocalizationSeeds(),
}, null, 2));
