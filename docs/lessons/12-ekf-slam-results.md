# EKF-SLAM — reference results

Measured on **2026-09-14** using the declared
[pose and landmark model](12-ekf-slam.md). The
[JSON record](../results/slam.json) includes configuration, runtime, checkout
revision, model hash, six seed-7 references and two paired ensembles.
Reproduce it with `npm run --silent compare:slam > docs/results/slam.json`.

## Fixed-seed comparisons

Every case runs to **32 s / 128 prediction intervals** on the same physical
circle. The initial pose is supplied exactly and the map starts empty. Each
sensor packet carries a known landmark ID, noisy range and body-relative
bearing; no true landmark coordinate enters either estimator. All six endpoint
maps contain four initialized points. Values below are rounded to four places.

| Scenario | Method | Position error (m) | Heading error (°) | Map RMSE (m) | Initialized / reobservations used |
| --- | --- | ---: | ---: | ---: | ---: |
| nominal | EKF-SLAM | 0.1861 | 3.8583 | 0.2282 | 4 / 32 |
| nominal | Odometry mapping | 0.6177 | 5.3822 | 0.2793 | 4 / 0 |
| dropout | EKF-SLAM | 0.2018 | 4.3399 | 0.3090 | 4 / 23 |
| dropout | Odometry mapping | 0.6177 | 5.3822 | 0.3358 | 4 / 0 |
| biased-range | EKF-SLAM | 0.4956 | 4.7678 | 0.7035 | 4 / 32 |
| biased-range | Odometry mapping | 0.6177 | 5.3822 | 0.3631 | 4 / 0 |

Position error is the robot's endpoint Euclidean distance from truth. Heading
error is the absolute wrapped difference. Map RMSE averages squared 2D point
errors over the initialized IDs before taking a square root. The displayed
coverage count matters at intermediate times; unseen landmarks are not silently
treated as accurate. No map or trajectory alignment to truth is applied.

The nominal EKF uses four measurements to initialize points and 32 later
measurements to correct its joint state. The baseline uses the same first
sightings but ignores all 32 repeats. It still retains the correlations implied
by odometry and initialization. Improved EKF error therefore reflects additional
use of the observed map, rather than better hardware or a different true path.

## Initialization is not relocalization

At 1 s the first L1 packet adds two state coordinates. It preserves the existing
pose mean and covariance and has no correction NIS. New-landmark covariance
includes the uncertain robot pose and correlations with the old map. Applying
that initializing packet again would count the same information twice.

Reobservations can change the robot, the observed point and other mapped points.
For seed 7, the L1 reobservation at **28 s** changes the robot and L2/L3/L4 through
retained covariance. Cross-covariance alone does not imply every point changes
on every update: the L1 correction from the first L2 repeat at 5 s cancels to
numerical precision in this model. The inspector reports actual gains and
corrections rather than implying universal movement of the entire map.

The dropout removes **eight complete sensor batches**, at 12 through 19 s.
Because visibility depends on geometry, this omits nine landmark packets,
leaving 27 delivered measurements: four initializations and 23 EKF corrections.
The robot continues integrating noisy motion throughout the absence.

At the restored frame at **20 s**, L3 and L4 are both unknown. They are
initialized without correcting the robot against an established map. The first
subsequent reobservation corrections occur at **21 s**. The loss thus affects
both when the map grows and when measurements can constrain the pose.

The true trajectory returns to the start at 32 s. No new absolute starting-pose
fix is applied at that point. The EKF maintains the current pose and map;
stored historical pose estimates are not retrospectively corrected. This is
filtering, not pose-graph smoothing or automatic place recognition.

## A wrong sensor model can make the map worse

With a fixed **+0.4 m range bias**, EKF map RMSE is **0.7035 m**, compared with
**0.3631 m** for the baseline on seed 7. Its reported map RMS radius is only
**0.2757 m**. Repeated biased measurements are systematically inconsistent with
the assumed zero-mean sensor model. Additional corrections and smaller reported
contours therefore do not establish a more accurate map.

The biased EKF position error is **0.4956 m** and its pose NEES is **17.5154**.
This explicit misspecification is kept separate from nominal ensemble
statistics. It does not establish that EKF-SLAM generally makes maps worse, or
that omitting measurements is generally preferable.

## Paired stochastic comparisons

For each of nominal sensing and dropout, **seeds 1–200** use both methods with
aligned motion/measurement noise: **800 method runs** in total. Each ensemble
RMS below is the square root of the mean squared endpoint error across seeds.
Map error also averages the four initialized points; every endpoint in these
ensembles has all four. Covariances depend on the realized EKF linearizations.

| Scenario | Method | Position RMS (m) | Heading RMS (°) | Map RMS (m) | Mean pose NEES |
| --- | --- | ---: | ---: | ---: | ---: |
| nominal | EKF-SLAM | 0.1597 | 3.2436 | 0.3406 | 3.7005 |
| nominal | Odometry mapping | 0.8084 | 6.9152 | 0.5832 | 3.3949 |
| dropout | EKF-SLAM | 0.1633 | 3.2871 | 0.3719 | 3.7323 |
| dropout | Odometry mapping | 0.8084 | 6.9152 | 0.5954 | 3.3949 |

The nominal EKF has lower endpoint position error in **192/200** paired runs
and lower map error in **170/200**. Position counterexample seeds are
**14, 28, 69, 82, 83, 85, 191 and 193**. The JSON also records all 30 map-error
counterexamples. For dropout, those counts are **191/200** for position and
**162/200** for the map. A finite ensemble improvement does not imply improvement
at every correction or under every seed.

In the nominal ensemble, the paired mean reduction in squared position error
is **0.6279 m²**, with standard error **0.0493 m²** across the 200 pairs.
EKF reported position RMS radius is **0.1424 m**, versus measured position RMS
**0.1597 m**. Reported map RMS radius is **0.3091 m**, versus measured **0.3406 m**.
Uncertainty values average variances before taking a square root.

Pose NEES uses the 3×3 pose marginal with wrapped heading error; the Gaussian
reference expectation is 3. Nominal EKF mean **3.7005** and dropout mean
**3.7323** exceed that reference. Together with reported radii below realized
ensemble RMS, this shows the approximation is not perfectly calibrated in this
finite sample. It is not an exact linear-Gaussian filter. NIS averages over
applied repeat observations only: **2.0193** nominal, **2.0318** dropout, compared
with reference expectation 2. Near-reference innovation statistics do not prove
that the pose/map posterior or all confidence contours are calibrated.

NEES is unavailable at the exact initial state and the first prediction, whose
three-dimensional pose covariance has rank at most two. No artificial diagonal
jitter is added to invent an inverse. Initialized or ignored packets have no
correction NIS.

## Verification

Executed with Node.js **22.22.1**, npm **10.9.4** and the repository's installed
dependencies on 2026-09-14:

- `npm test`: **155/155** passed, including 18 new SLAM tests for motion,
  Jacobians, map augmentation, correlated corrections, angle wrapping, PSD,
  input isolation, paired samples, dropout, bias, seed replay and diagnostics.
- `npm run test:e2e`: **81/81** passed across all twelve workshops, including
  eight new browser checks for growing covariance, initialization versus
  correction, matched baseline inputs, restored sensing, bias, seeded reset,
  independent reference copies, playback, view/camera invariance, keyboard
  selection, mobile navigation and WebGL fallback.
- `npm run build`: all **twelve** HTML entries built. The existing optional
  Three.js chunk advisory remains (736.58 kB minified, 186.86 kB gzip).
- The exporter completed six reference cases and two 200-pair ensembles.
  Its source hash records the actual pure model used for the saved results.

An independent NumPy audit compared **18 complete runs / 2,304 boundaries**
against separately recomputed predictions, augmentation and information-form
corrections. Maximum mean differences were below **1.2 × 10⁻¹³**, and covariance
below **3.9 × 10⁻¹⁴**. It tested 100 motion/input and inverse-observation
Jacobian/augmentation cases, including 80 mapped cases for polar Jacobians and
corrections; maximum numerical Jacobian discrepancy was below **7.5 × 10⁻¹⁰**.
It also checked covariance PSD, single-use samples, boundary seeds, ±π
innovations, sensor pairing, truth isolation and terminal immutability.

Production-preview checks passed all twelve routes, navigation, six references,
the 200-pair summary, map growth, loss/restoration, baseline/bias outcomes,
2D/3D and camera controls, 390 px layout and back navigation. No page/console
errors or failed HTTP responses occurred in that smoke run. Whole-yard 3D,
drone close-up, first-observation and late-reobservation inspectors, joint
covariance, top-down map and mobile captures were visually reviewed. Source-hash
checks passed. WebGL fallback tests deliberately prevent or lose a graphics
context; software rendering does not measure hardware GPU performance.

These checks validate the declared small approximation and user-visible
experiment, not a real drone sensor, unknown data association, hardware GPU
performance, flight safety or general SLAM convergence.
