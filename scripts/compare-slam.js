import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DT, STEPS, TIME_LIMIT, TRUE_DISTANCE, TRUE_TURN, ODO_DISTANCE_STD, ODO_TURN_STD, RANGE_STD, BEARING_STD, RANGE_BIAS, SENSOR_RANGE, INITIAL_POSE, LANDMARKS, referenceComparisons, compareSeeds } from '../src/slam-model.js';

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
  sourceHashes: { 'src/slam-model.js': createHash('sha256').update(readFileSync(new URL('../src/slam-model.js', import.meta.url))).digest('hex') },
  model: {
    agents: 1, landmarkCount: LANDMARKS.length, state: '[x, y, heading, landmark1_x, landmark1_y, ...] with dynamically appended supplied landmark IDs', steps: STEPS, stepSeconds: DT, timeBudgetSeconds: TIME_LIMIT,
    initialPose: INITIAL_POSE, initialCovariance: 'Exactly zero 3x3 covariance defines the translation and rotation reference. The map is initially empty. No alignment to evaluator truth is performed later.',
    units: 'Positions and ranges are metres; heading, turn and bearing are radians. P has mixed position-position m², position-angle m·rad and angle-angle rad² entries. Position/landmark ellipse marginals are in m². Raw pose/map cross-covariance Frobenius norm combines mixed units and is only a structural diagnostic, not a physical uncertainty radius.',
    trajectory: 'Evaluator-only circle: [4cos(k*2pi/128),4sin(k*2pi/128),wrap(pi/2+k*2pi/128)] at step k=0..128. The pose starts at [4,0,pi/2]. True midpoint controls use chord distance 8sin(pi/128) and turn 2pi/128 per step. Estimates do not steer the vehicle. Fixed-altitude drone geometry is presentation, not an estimated altitude state.',
    trueDistanceMetresPerStep: TRUE_DISTANCE, trueTurnRadiansPerStep: TRUE_TURN, evaluatorLandmarks: LANDMARKS,
    odometry: { distanceStdMetresPerStep: ODO_DISTANCE_STD, turnStdRadiansPerStep: ODO_TURN_STD, model: 'Measured midpoint-motion inputs equal the true chord distance and turn plus independent Gaussian errors. Prediction uses the measured controls and their input Jacobian, including the half-turn terms in translation. Map landmarks are static; pose/map cross-covariances propagate through the pose Jacobian.' },
    observations: { rangeStdMetres: RANGE_STD, bearingStdRadians: BEARING_STD, sensorRangeMetres: SENSOR_RANGE, biasMetres: RANGE_BIAS,
      model: 'At integer seconds 1..32, a 360-degree sensor supplies known landmark IDs and noisy range/bearing in the robot body frame. Availability uses evaluator true range <=5 m, with no occlusion. Delivered IDs are processed in fixed L1,L2,L3,L4 order. The estimator receives only delivered measurements, not the truth gate or missing-landmark negative information. This gate is a deterministic sampling convention, not a modeled hardware detection likelihood.',
      noise: 'Independent Gaussian range and wrapped bearing errors, independent across IDs, time, coordinates and odometry. Biased-range scenario adds +0.4 m to all delivered ranges but leaves R unchanged; it intentionally violates the assumed zero-mean model.' },
    prediction: 'x+=d*cos(theta+turn/2), y+=d*sin(theta+turn/2), theta=wrap(theta+turn). P-=F P F^T+V Q V^T. F embeds the pose-state Jacobian in the full state. V embeds the two noisy odometry inputs.',
    initialization: 'For the first supplied-ID observation z=[r,b], initialize landmark g=[x+r*cos(theta+b),y+r*sin(theta+b)]. Append its mean and covariance Gx P Gx^T+Gz R Gz^T, with full old/new cross block P Gx^T. Gx includes the robot pose columns and zero direct map columns; existing pose/map correlations still create cross-covariance to older landmarks. This sample is used once: no immediate Kalman correction, residual or NIS follows initialization.',
    correction: 'For an already initialized ID, predict range sqrt(dx²+dy²) and bearing wrap(atan2(dy,dx)-theta). Use the full analytic H evaluated at the current estimate; wrap the bearing innovation. Solve S=H P H^T+R by Cholesky for K=P H^T S^-1. Update all state coordinates, wrap heading, and use Joseph covariance (I-KH)P(I-KH)^T+K R K^T. Reobservations can move the robot, the observed landmark and other correlated map landmarks; nonzero changes in every coordinate are not guaranteed.',
    methods: 'EKF-SLAM admits repeated observations. Odometry with one-shot mapping uses the same prediction and covariance-preserving augmentation but ignores all repeated landmark observations. It retains the full covariance generated by initialization and motion. Existing map means remain fixed in this baseline. It is neither a full SLAM algorithm nor an independent-covariance shortcut.',
    scenarios: 'Nominal: all eligible sensor batches. Dropout: omit complete batches at t=12,13,...,19; return at 20. At 20 the currently visible L3 and L4 are new in this scenario, so both initialize without a pose correction; the next repeated observation at 21 can correct. Biased range: all nominal eligible samples with an unmodeled +0.4 m range offset.',
    noisePairing: 'Seeded Mulberry32 uniform draws and Box-Muller Gaussian draws. Consume two odometry noises plus two potential sensor noises for each of four IDs at every step, regardless of range, method, sample boundary or dropout. Thus every scenario and method shares the same underlying input realization for a seed.',
    informationBoundary: 'Estimator functions accept mean, covariance, initialized ID list, measured controls and supplied-ID range/bearing packets. The unknown landmark truth, robot truth, future route and sample schedule are evaluator data and are not estimator inputs. Global displays distinguish true geometry from estimated pose and map.',
    metrics: 'positionError is the 2D Euclidean error at the current endpoint. headingError is the absolute wrapped heading difference in radians (also exposed as degrees). mapRmse=sqrt(sum(||estimated_landmark-true_landmark||²)/M) over the M initialized IDs, and is null for M=0. positionRmsRadius=sqrt(Pxx+Pyy), headingStd=sqrt(P_heading,heading), and mapRmsRadius=sqrt(sum(trace(P_landmark_i))/M). These are reported uncertainty scales, not bounds or guarantees.',
    diagnostics: 'Pose NEES uses the 3x3 pose marginal and wrapped heading error. It is null at the exact initial state and first rank-two prediction; no diagonal jitter is added. Nominal linear-Gaussian reference values are 3 for pose NEES and 2 for each repeated two-dimensional observation NIS. EKF nonlinear linearization makes these approximate diagnostics, and initialization is not counted as a correction or NIS sample. A scale-aware Cholesky singularity check prevents reporting NEES for numerically singular covariance.',
    ensembles: 'For nominal and dropout, compare seeds 1..200 with both methods: 800 method runs. Endpoint RMS errors average squared errors before taking the square root. Reported RMS uncertainty averages covariance variances before taking the square root, since EKF covariance depends on the input realization. Endpoint map counts are reported. Paired counters and counterexample seeds expose trials in which EKF errors are not lower. The biased-range scenario is excluded from ensemble diagnostics and appears only in explicit single-seed references.',
    fidelity: 'A small known-ID EKF-SLAM example, not a complete camera/LiDAR stack. No unknown association, image features, range-scan matching, heading calibration, physical sensing, collision avoidance, flight dynamics, middleware, graph optimization or automatic place recognition. Returning along a supplied-ID trajectory does not establish robust real-world loop closure or globally consistent SLAM.',
  },
  methodSources: [
    { title: 'Durrant-Whyte and Bailey (2006), Simultaneous Localization and Mapping: Part I', url: 'https://www-personal.acfr.usyd.edu.au/tbailey/publications/slamtutorial1.htm', authorManuscript: 'https://www-personal.acfr.usyd.edu.au/tbailey/papers/slamtute1.pdf', use: 'EKF-SLAM joint pose/map covariance, prediction, observation and landmark initialization. This implementation uses its own bounded midpoint-motion model and supplied identities.' },
    { title: 'Tim Bailey, SLAM simulations', url: 'https://www-personal.acfr.usyd.edu.au/tbailey/software/slam_simulations.htm', use: 'Author-provided EKF-SLAM code as a reference for Jacobians and covariance-preserving augmentation; this project does not import the MATLAB runtime or reproduce all simulator options.' },
  ],
  references: referenceComparisons(),
  ensembles: ['nominal', 'dropout'].map((scenario) => compareSeeds({ scenario, count: 200 })),
}, null, 2));
