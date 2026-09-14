import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { POSE_COUNT, KEYFRAME_INTERVAL, SURVEY_SECONDS, MAX_ITERATIONS, MAX_BACKTRACKS, ARMIJO_C, GRADIENT_TOLERANCE, STEP_TOLERANCE, RELATIVE_COST_TOLERANCE, ODOM_TRANSLATION_STD, ODOM_HEADING_STD, LOOP_TRANSLATION_STD, LOOP_HEADING_STD, INITIAL_POSE, referenceComparisons, compareSeeds } from '../src/pose-graph-model.js';

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
  sourceHashes: { 'src/pose-graph-model.js': createHash('sha256').update(readFileSync(new URL('../src/pose-graph-model.js', import.meta.url))).digest('hex') },
  model: {
    poses: POSE_COUNT, variables: 3 * (POSE_COUNT - 1), state: 'Twenty-five historical planar poses [x,y,heading], with pose 0 fixed and all other poses optimized together.',
    keyframeIntervalSeconds: KEYFRAME_INTERVAL, recordedSurveySeconds: SURVEY_SECONDS, initialAnchor: INITIAL_POSE,
    time: 'The 25 keyframes at recorded times 0..24 seconds are all available before iteration 0. One step advances one optimization attempt, not physical flight or recorded survey time. Selecting a historical pose is presentation only.',
    trajectory: 'Evaluator-only keyframes p_k=[4*cos(2pi*k/24),4*sin(2pi*k/24),wrap(pi/2+2pi*k/24)] for k=0..24. Pose 0 is known exactly at [4,0,pi/2], fixing translation and rotation. No subsequent pose is fixed to truth and no alignment to truth is performed.',
    odometry: { edges: 24, translationStandardDeviationMetresPerLocalAxis: ODOM_TRANSLATION_STD, headingStandardDeviationRadians: ODOM_HEADING_STD,
      observation: 'Each edge i→i+1 measures [R(theta_i)^T*(p_j-p_i), wrap(theta_j-theta_i)] plus independent zero-mean Gaussian errors in two source-frame translation axes and heading. Initialize the entire trajectory by composing these same recorded edges from the fixed anchor.' },
    loop: { translationStandardDeviationMetresPerLocalAxis: LOOP_TRANSLATION_STD, headingStandardDeviationRadians: LOOP_HEADING_STD,
      observation: 'A separate independent near-zero relative-pose observation is generated for the actual return 0→24. Correct-loop attaches it to 0→24. Wrong-loop deliberately labels exactly the same sample as 0→18, without telling the solver it is wrong. No-loop omits it, while consuming the same random draws.' },
    scenarios: 'No loop: 24 odometry edges. Correct loop: those same edges plus one correct supplied closure. Wrong loop: those same edges plus the misassociated 0→18 closure. All edges and their fixed information weights remain unchanged throughout optimization.',
    noisePairing: 'Mulberry32 uniform draws and Box-Muller Gaussian draws. For each seed, generate three noises for each of 24 odometry edges followed by three loop noises. Every graph configuration uses the same recorded odometry, initial trajectory, loop measurement and evaluator truth.',
    residual: 'For each edge, h_t=R(theta_i)^T*(p_j-p_i), h_heading=wrap(theta_j-theta_i). e=[h_tx-z_tx,h_ty-z_ty,wrap(h_heading-z_heading)]. Heading angles are radians and translations are metres. This additive coordinate residual is not an SE(2) logarithm. Constant rotation of the translation residual into the measured frame yields the same objective and normal equations here because x/y translation information is isotropic.',
    objective: 'C=sum_edges(e^T*Omega*e), with no factor 1/2; Omega is diagonal inverse measurement variance. The weighted graph objective and whitened residual norm are dimensionless. Raw heading/translation residual components retain their own units. Objectives from different edge sets are not trajectory-accuracy rankings.',
    linearization: 'Use analytic 3x3 endpoint Jacobians with respect to additive world x/y and heading increments, away from the wrapped residual branch cut. Remove anchor coordinates from optimization variables. Assemble H=J^T*Omega*J and g=J^T*Omega*e, then solve H*delta=-g by Cholesky without damping or diagonal jitter. The displayed fixed graph gives a dense 72x72 reduced system; the implementation is not a large sparse SLAM solver.',
    optimizer: { name: 'Gauss–Newton with Armijo backtracking', maxAttempts: MAX_ITERATIONS, armijoConstant: ARMIJO_C, maxHalvings: MAX_BACKTRACKS, candidates: '21 possible candidates: alpha=1,1/2,...,2^-20. Accept C(x+alpha*delta)<=C(x)+2*c*alpha*g^T*delta. The factor 2 is required because C has no factor 1/2. Apply x/y increments and wrap heading; pose 0 is copied unchanged.',
      gradientInfinityTolerance: GRADIENT_TOLERANCE, componentStepTolerance: STEP_TOLERANCE, relativeImprovementTolerance: RELATIVE_COST_TOLERANCE,
      stopping: 'A stationary status may arise before solving when ||g||_infinity<=1e-8; before line search when the full proposed ||delta||_infinity<=1e-8 and predicted reduction (-g^T*delta)/max(1,|C|)<=1e-10; or after an accepted step when its component infinity norm<=1e-8 and actual reduction/max(1,|C_before|)<=1e-10. These are explicit numerical criteria on the declared metre/radian coordinates, not unit-invariant or global-optimality certificates. Negligible proposed-step stopping applies no pose change.',
      termination: 'One attempt includes a stationarity check, so an already-satisfied odometry-only graph stops after attempt 1 with zero accepted steps. Report stationary, budget, line-search-failure and linear-solve-failure separately. An exhausted line search keeps prior poses. Under these strict thresholds a few seeded graphs stop because further decrease is below numerical resolution, even near a good local solution; they are retained as failure outcomes rather than relabeled as stationary.',
      trace: 'Retain each accepted alpha and rejected trial cost/Armijo bound, gradient infinity norm, full proposed step infinity norm, applied step infinity norm, predicted and actual decrease, per-pose correction and terminal reason. Predicted reduction at accepted alpha is -(2alpha-alpha²)*g^T*delta; a negligible unexecuted step reports its full-step prediction and zero actual change.' },
    metrics: 'trajectoryRmse=sqrt(sum_{k=1..24}(||estimated_position_k-true_position_k||²)/24); the fixed anchor is excluded. Endpoint error is the position distance at recorded pose 24; heading error is its absolute wrapped difference. maxPositionCorrection is the maximum historical position displacement from the integrated initial trajectory. Graph cost is split into odometry and optional loop terms; loopResidualNorm=sqrt(loopCost). No posterior covariance, confidence contour or calibration score is inferred from the normal matrix.',
    ensemble: 'Run seeds 1..100 paired across all three graph configurations (300 graph runs). Report roots of mean squared initial/final trajectory and endpoint errors, iteration/accepted-step counts, per-graph initial/final objective summaries, solver statuses, failure seeds and trajectory-error counterexamples. Initial and final objectives are compared within the same graph; no cross-graph objective ranking or global convergence claim is made.',
    informationBoundary: 'Optimization functions accept only estimated historical poses, supplied edges, measurements and fixed information weights. The evaluator-only trajectory and independently stored loop truth context cannot influence a step. All recorded constraints are generated once before optimization; solving neither obtains new sensor observations nor replays vehicle motion.',
    fidelity: 'A bounded backend optimization example with one recorded planar trajectory and supplied IDs. The 3D drone and scene visualize a selected historical pose with fixed presentation altitude. No loop detector, perceptual front end, landmark map, scan matching, unknown association inference, outlier rejection, robust loss, heading calibration, roll/pitch, flight physics, radio, middleware or autopilot is implemented. A stationary solution of wrong constraints can be geometrically wrong.',
  },
  methodSources: [
    { title: 'Grisetti, Kümmerle, Stachniss and Burgard (2010), A Tutorial on Graph-Based SLAM', url: 'https://doi.org/10.1109/MITS.2010.939925', authorManuscript: 'https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/grisetti10titsmag.pdf', use: 'Pose-graph constraints, weighted nonlinear least squares, Jacobian block structure and fixed-frame treatment. This implementation declares its own small SE(2) coordinate residual, dense Gauss–Newton solve and Armijo line search rather than reproducing a complete SLAM stack.' },
  ],
  references: referenceComparisons(),
  ensemble: compareSeeds({ count: 100 }),
}, null, 2));
