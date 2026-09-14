# Lesson 12 — Extended Kalman Filter SLAM

**Question:** how can a robot build a map while using that same map to locate
itself?

**Status:** implemented at `/slam/`. See the
[measured results](12-ekf-slam-results.md) for the reference cases, paired
ensembles, observed limits and verification.

## Method profile

SLAM expands to **Simultaneous Localization and Mapping**, a problem family.
This workshop implements **Extended Kalman Filter SLAM (EKF-SLAM)** with static
point landmarks and supplied landmark identities. It does not perform image
processing, landmark recognition or unknown data association.

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Algorithm | EKF-SLAM, joint pose and landmark state | Estimate robot x, y and heading together with unknown landmark coordinates; keep all cross-covariances. |
| Comparison | Odometry mapping, without reobservation corrections | Integrate identical noisy motion and initialize landmarks from their first measurement. Later observations are received but omitted. |
| Architecture | One robot, one local estimator | No inter-robot communication or distributed mapping. |
| Timing | 0.25 s predictions, 1 s observation batches | Predict first, then process available observations in supplied ID order. Initialize a new landmark or correct with a known one, never both from one sample. |
| Inputs | Noisy travel/turn increments and range/bearing with ID | Landmark coordinates, true pose, sensor scheduling and error metrics remain evaluator data. |
| Reference frame | Exact initial pose; no later absolute fixes | The origin and orientation are supplied at initialization. This is not discovery of a global frame from relative measurements alone. |
| Fidelity | Planar pose kinematics, static points, synthetic sensing | Detailed drone and landmark geometry illustrate the same 2D position/heading state at a fixed display altitude. No flight controller, camera/LiDAR pipeline or collision model. |

The previous workshop jointly estimated two robots in supplied Cartesian axes.
Here the state grows as a single robot discovers landmarks, and its unknown
heading affects both motion and body-relative bearing measurements. Nonlinear
functions require local Jacobian approximations rather than the previous
linear observation matrices.

## Fixed physical experiment

The evaluator starts the robot at `[4, 0, π/2]`, with positions in metres and
heading in radians. The estimator starts at that same **exact known pose** with
zero 3×3 covariance and an empty map. There is no landmark coordinate prior.
Heading zero points along +x; positive headings and bearings rotate toward +y.

Each of **128 intervals / 32 s** advances the physical pose using midpoint
kinematics. For travel `d`, heading increment `a` and `ψ = θ + a/2`:

```text
x′ = x + d cos ψ
y′ = y + d sin ψ
θ′ = wrap(θ + a)

true d = 8 sin(π/128) metres per interval
true a = 2π/128 radians per interval
```

These chord increments follow a circle of radius 4 m and return to the start
after 128 intervals. The prescribed motion is open loop. Estimated pose does
not steer the robot, and returning physically is not evidence that the estimate
or map is accurate. Stored past estimates form an online trajectory; this
filter does not retrospectively optimize old poses.

Four static points exist only in the evaluator's map:

| Supplied ID | True coordinate (m), evaluator only |
| --- | --- |
| L1 | [6, 0] |
| L2 | [0, 6] |
| L3 | [−6, 0] |
| L4 | [0, −6] |

Motion readings add independent Gaussian errors of standard deviation
**0.03 m** to travel and **0.6°** to turn per 0.25 s interval. All estimator
computations use radians for angles. The filter uses the resulting measured
increments and the declared noise covariance, not the true circular path.

At integer seconds 1 through 32, the sensor can observe points within **5 m**
of the true robot position, in all directions. It reports ID, range and bearing
relative to the robot's heading. Range noise has standard deviation **0.10 m**;
bearing noise has standard deviation **1.5°**. The gate uses true geometry in
the synthetic sensor, independently of estimated pose. Absence is not used as
negative information. There is no occlusion, field-of-view edge, recognition
error or measurement delay. Structural scenery has no sensing/collision role.

Mulberry32 uniforms feed Box–Muller Gaussian pairs. Each interval consumes
ten Gaussian draws: two for odometry, then range/bearing for each of the four
IDs in fixed order. Random draws remain aligned between methods and scenarios,
including potential observations that are out of range or unavailable. Baseline comparisons therefore
share the physical path, noisy motion and raw sensor realization. The page
accepts seeds 1–999999; the pure model accepts unsigned 32-bit seeds including 0.

## Prediction and growing the map

For `M` initialized landmarks the state is
`m = [x, y, θ, l1x, l1y, …, lMx, lMy]ᵀ`, dimension `3 + 2M`.
`P` is its full covariance. Static landmark means do not move during prediction,
but pose/map cross-covariances propagate with the pose Jacobian.

Let `F` equal the identity except for the pose block below, and inject control
noise through `V` into the first three state coordinates:

```text
F_pose = [ 1  0  −d sin ψ ]    V_pose = [ cos ψ  −d sin ψ / 2 ]
         [ 0  1   d cos ψ ]             [ sin ψ   d cos ψ / 2 ]
         [ 0  0       1   ]             [   0          1      ]

Q_control = diag(0.03², (0.6π/180)²)
P⁻ = F P Fᵀ + V Q_control Vᵀ
```

For a first observation `z = [r, b]` of a new ID, use inverse observation
`g = [x + r cos(θ+b), y + r sin(θ+b)]` to initialize its coordinates. Define
`β = θ+b`; `Jx` has zeros outside its displayed pose columns:

```text
Jx_pose = [ 1  0  −r sin β ]    Jz = [ cos β  −r sin β ]
          [ 0  1   r cos β ]         [ sin β   r cos β ]

P_aug = [ P             P Jxᵀ                ]
        [ Jx P   Jx P Jxᵀ + Jz R Jzᵀ         ]
R = diag(0.10², (1.5π/180)²)
```

The added point inherits uncertainty and correlation from the current pose and
all existing landmarks. Its coordinate is an estimate made from the measured
range/bearing, not a lookup in the true map. The initializing sample has already
been consumed: using it again as a correction would double-count information.
Initialization increases map coverage; it does not independently reduce the
robot's pose uncertainty.

## Reobserving a known landmark

For landmark displacement `[dx, dy] = [lx−x, ly−y]`, define
`q = dx² + dy²` and `ρ = sqrt(q)`. The predicted observation is
`h = [ρ, wrap(atan2(dy,dx)−θ)]`.

The 2×(3+2M) observation Jacobian has these nonzero blocks:

```text
H_pose = [ −dx/ρ  −dy/ρ   0 ]    H_landmark = [  dx/ρ   dy/ρ ]
         [  dy/q  −dx/q  −1 ]                 [ −dy/q   dx/q ]
```

Compute innovation `ν = [r−ρ, wrap(b−h_b)]`. Wrapping the bearing residual is
essential near ±π: two nearby directions on opposite sides of that boundary
must produce a small correction rather than an apparent full revolution.
For each reobservation the EKF computes

```text
S = H P⁻ Hᵀ + R
K = P⁻ Hᵀ S⁻¹
m⁺ = m⁻ + K ν                (wrap the updated heading)
P⁺ = (I−KH) P⁻ (I−KH)ᵀ + K R Kᵀ
```

The implementation uses linear solves and Joseph covariance form. It recomputes
the nonlinear prediction and Jacobian at the current mean before each sequential
observation. This is one specified EKF ordering; EKF linearization makes it an
approximation, not an exact nonlinear posterior or order-independent batch
solution.

The observed point, robot pose and other correlated points can all move during
a correction. That does not mean the physical landmarks moved. The page shows
the innovation, Jacobian, gain and changes to pose/map estimates, with covariance
before and after the selected operation.

Position entries of `P` have units m², heading variance rad² and mixed
position/heading entries m·rad. A dimensionless color scale alone cannot make
these unlike quantities directly comparable; row/column coordinates and units
are labeled. The 2D position contours use their marginal 2×2 blocks and
`χ²₂(0.95) ≈ 5.991`. They are approximate Gaussian belief contours, not assured
coverage or safety regions.

## Baseline and failure cases

**Odometry mapping** uses the same prediction and first-observation augmentation
but ignores every later observation of an initialized ID. It retains the full
covariance implied by those operations; it does not artificially zero map/pose
correlations. Its physical trajectory and observation visibility match EKF-SLAM.
The comparison isolates the information supplied by reobserving the map, rather
than comparing sensor hardware or navigation policies.

| Scenario | Change | What to inspect |
| --- | --- | --- |
| Nominal | Independent zero-mean noise, all scheduled visible observations | First initialization versus later corrections; pose/map cross-covariance; heading and position errors. |
| Sensor dropout | No landmark batch at 12, 13, …, 19 s; readings resume at 20 s | Odometry continues; no stale observation reuse; map growth/corrections resume only from new packets. |
| Biased range | Add 0.4 m to each delivered range, keep the assumed R unchanged | A systematically wrong measurement model can distort the map despite small reported uncertainty. |

At 20 s after the declared dropout, both visible points (L3 and L4) are still
unknown. That batch initializes them without reducing pose uncertainty through
reobservation. Repeated observations at 21 s provide the next pose correction.
Restoring a sensor does not itself supply a known map.

The biased case violates the filter's assumed zero-mean noise. It is reported
separately from nominal paired trials and is not evidence of calibrated
uncertainty. IDs remain correct in all cases; incorrect associations and pose
graph optimization belong to a separate experiment.

## Metrics, interaction and acceptance

Position error is the 2D distance from estimated robot position to evaluator
truth. Heading error is the absolute wrapped angle difference, displayed in
degrees. Map RMSE is `sqrt(sum(||li_est−li_true||²)/M)` over **initialized IDs**;
it is unavailable for `M=0`. Always show `M/4` coverage alongside map error so
an incomplete map cannot appear successful by excluding unseen points silently.
RMS uncertainty radius for a position is `sqrt(trace(P_position))`; map RMS
radius averages the initialized point variances before taking the square root.
Errors and reported uncertainty are distinct quantities.

Pose NEES uses the three-coordinate pose covariance and wrapped heading error;
it is unavailable when that covariance is singular, including the exact start
and the first rank-two prediction.
NIS uses the two-coordinate innovation of an applied reobservation. Initialized,
ignored or missing observations have no correction NIS. Nominal expectations
3 and 2 are diagnostics for the approximate model, not promised calibration.

Changing method/scenario/seed creates a paused run. Playback, one step, next
observation, pre-event jump and finish advance that run; view, camera, point
selection and update inspection only observe it. Independent reference copies
leave it unchanged. The endpoint is an observation budget, not SLAM convergence
or mission success.

Acceptance requires numerical Jacobian checks, correct correlated landmark
augmentation, single use of initializing samples, wrapped-angle behavior,
covariance symmetry/positive semidefiniteness, shared sensor replay, truth/input
isolation, loss/restoration boundaries, baseline behavior and terminal
immutability. Browser verification covers actual controls, growing map,
indirect corrections, rendering invariance, keyboard/mobile use and WebGL
fallback. Measured comparisons include six seed-7 cases and nominal/dropout
paired ensembles, with counterexamples and limits recorded alongside gains.

## Primary method source and scope

Durrant-Whyte and Bailey (2006),
[Simultaneous Localisation and Mapping: Part I — The Essential Algorithms](https://www-personal.acfr.usyd.edu.au/tbailey/publications/slamtutorial1.htm),
provides the joint probabilistic SLAM and EKF context. This workshop instantiates
a small motion/sensor model and supplied associations for inspection. It does
not reproduce a complete deployment from the paper.

Known start pose and landmark IDs, independent synthetic noise, static points,
perfect immediate delivery when available and local linearization are explicit
limits. The estimator does not infer altitude, learn identities, detect places,
optimize a pose graph, reconstruct surfaces, fuse camera/LiDAR data or control
flight. Detailed presentation must not be mistaken for those capabilities.
