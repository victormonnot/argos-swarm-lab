import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DT, STEPS, TIME_LIMIT, ODOMETRY_STD, RELATIVE_STD, ANCHOR_STD, INITIAL_STD, SHARED_SHIFT, RELATIVE_H, ANCHOR_H, SCENARIOS, referenceComparisons, compareSeeds } from '../src/cooperative-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null, workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported checkouts may not include Git metadata.
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), runtime: process.version, revision, workingTreeModified,
  sourceHashes: { 'src/cooperative-model.js': createHash('sha256').update(readFileSync(new URL('../src/cooperative-model.js', import.meta.url))).digest('hex') },
  model: {
    agents: 2, state: '[x1, y1, x2, y2] in a declared shared Cartesian frame', steps: STEPS, stepSeconds: DT, timeBudgetSeconds: TIME_LIMIT,
    trajectories: 'Evaluator-only open-loop planar paths: p1(t)=[-3+0.3t, -1.5+0.4sin(0.4t)], p2(t)=[-2.5+0.25t, 1.1+0.4cos(0.4t)], t in seconds, positions in metres. Estimates do not control motion.',
    initialPrior: { positionStandardDeviationMetresPerAxis: INITIAL_STD, covariance: '0.64 I4; independent zero-mean Gaussian initial errors for the calibrated prior. No initial cross-covariances.', sharedShiftMetres: SHARED_SHIFT, sharedShiftInterpretation: 'The same fixed offset is added to both initial means while P remains unchanged. This intentionally misspecified prior demonstrates an unobservable translation and is excluded from all calibration ensembles.' },
    odometry: { displacementStandardDeviationMetresPerAxisPerStep: ODOMETRY_STD, processCovariance: '0.0064 I4 per 0.25-second step', interpretation: 'Each robot measures its own displacement with independent Gaussian noise. The filter adds the supplied displacement and Q; it receives neither the true increment nor the trajectory function.' },
    relativeObservation: { H: RELATIVE_H, standardDeviationMetresPerAxis: RELATIVE_STD, covariance: '0.0225 I2', interpretation: 'A direct relative Cartesian displacement p2-p1, including orientation in the already shared world axes. No range-to-Cartesian conversion, heading estimation, bearing, data association or synthetic radio geometry is modeled.' },
    absoluteObservation: { H: ANCHOR_H, standardDeviationMetresPerAxis: ANCHOR_STD, covariance: '0.04 I2', interpretation: 'A1 alone receives an absolute Cartesian position fix. A2 never receives its own absolute fix.' },
    timing: 'Prediction at every 0.25-second endpoint. Potential relative and A1 absolute samples arrive at t=1,2,...,20 seconds. When both arrive, apply relative then absolute at the same boundary. Sequential corrections retain their intermediate means, covariances, innovations, gains and normalized innovation squared values.',
    methods: 'Joint-state Kalman filter retains the complete 4x4 covariance and admits relative plus A1 absolute observations. Independent Kalman filters admit only A1 absolute observations; relative packets are recorded but ignored. Its block-diagonal covariance remains block diagonal, and A2 is dead reckoning. Both use the same initial prior, odometry and available raw measurement samples for a seed.',
    correction: 'Linear H, S=H P H^T+R, K=P H^T S^-1 using Cholesky solves. Covariance uses Joseph form (I-KH)P(I-KH)^T+K R K^T, symmetrized to remove floating-point asymmetry.',
    scenarios: 'Anchored: all samples. Unanchored: no absolute samples. Anchor restored: no absolute samples before t=10, then t=10,...,20 (11 fixes). Relative outage: omit the five relative samples at t=5,6,7,8,9; resume at t=10 while A1 absolute fixes remain regular.',
    randomness: 'Seeded Mulberry32 uniforms with Box-Muller Gaussian draws. Draw four initial Gaussian errors and eight Gaussian values at every step (four odometry, two potential relative, two potential anchor), regardless of method or availability schedule. Observation noises, odometry errors, robots, axes and initial errors are independent under the specified model.',
    architecture: 'An ideal centralized joint-state reference fuses supplied observation packets. The baseline comprises two independent filters evaluated together in one browser. Cooperative refers to observing different robots; it does not imply decentralized software. No real network, packets in transit, message delays, decentralized covariance bookkeeping or commercial implementation is reproduced.',
    informationBoundary: 'Estimator functions receive only the current mean and covariance, noisy odometry and available measurement values with known H/R. Evaluator truth, path definitions, future schedules and truth-based metrics remain separate. The UI can inspect both estimator inputs and evaluator truth.',
    observability: 'H_relative*[dx,dy,dx,dy]^T=0. Relative-only measurements cannot identify a common translation. A finite prior still supplies a probabilistic reference. In this symmetric unanchored setup, center covariance is (0.32 + 0.0032*step) I2 and relative corrections preserve the center mean. After absolute fixes break prior symmetry, relative corrections can change the center through prior correlations; unobservable measurement directions do not imply every update leaves every center estimate unchanged.',
    covarianceMetrics: 'With P partitioned by robot, center covariance C=(P11+P12+P21+P22)/4 and relative covariance D=P11+P22-P12-P21. positionRmsRadius=sqrt(trace(P)/2) is a per-robot mean RMS position radius. centerRmsRadius=sqrt(trace(C)) and relativeRmsRadius=sqrt(trace(D)) are two-dimensional RMS radii, not confidence bounds. crossCovarianceNorm is the Frobenius norm of P12 in square metres.',
    evaluatorMetrics: 'positionRmse=sqrt((||e1||^2+||e2||^2)/2), relativeError=||e2-e1||, centerError=||(e1+e2)/2||, all in metres at the current instant. NEES=e^T P^-1 e has expected value 4 for the specified calibrated Gaussian model. Each applied 2D update has NIS=innovation^T S^-1 innovation with expected value 2. Ignored or unavailable measurements have no applied-update NIS.',
    ensemble: 'For each of four scenarios, run seeds 1 through 200 with the calibrated, unshifted prior and both methods (1,600 method runs). Endpoint RMS error is the square root of mean squared error over seeds; it is not the mean of individual RMSE values. NEES is averaged across 200 endpoints per method/scenario; NIS is pooled over actually applied measurements. Count paired seeds where joint filtering gives smaller realized error. Bias cases appear only in single-seed references.',
    fidelity: 'Planar noisy position estimation, with fixed-altitude drone geometry and a volumetric scene as presentation. No estimated altitude or heading, flight dynamics, collision avoidance, SLAM, mapping, middleware, autopilot or sensor hardware integration. Finishing the observation budget is not a mission-success criterion.',
  },
  methodSources: [
    { title: 'Roumeliotis and Bekey (2002), Distributed multirobot localization', url: 'https://doi.org/10.1109/TRA.2002.803461', authorManuscript: 'https://www-users.cse.umn.edu/~stergios/papers/TRA-MULTI.pdf', use: 'Context for relative observations, joint covariance and cooperative localization. This small linear centralized reference does not reproduce the paper\'s full nonlinear or distributed algorithm.' },
    { title: 'Kalman (1960), A New Approach to Linear Filtering and Prediction Problems', url: 'https://doi.org/10.1115/1.3662552', use: 'Linear state prediction and measurement correction.' },
  ],
  references: referenceComparisons(),
  ensembles: Object.keys(SCENARIOS).map((scenario) => compareSeeds({ count: 200, scenario, priorShift: 'none' })),
}, null, 2));
