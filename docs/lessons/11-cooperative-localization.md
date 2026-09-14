# Lesson 11 — Cooperative localization with a joint-state Kalman filter

**Question:** can observing another robot improve your own position estimate,
and what remains uncertain without an absolute reference?

**Status:** implemented at `/cooperative/`. See the
[measured results](11-cooperative-localization-results.md) for reference cases,
paired ensembles and verification.

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Algorithm | Linear Kalman filter (KF), joint four-coordinate state | Estimate both robots' planar positions in one vector and retain their cross-covariance. No heading linearization or Extended Kalman Filter is needed for the supplied Cartesian measurements. |
| Comparison | Independent position Kalman filters | Both robots integrate their own noisy displacement; only A1 receives absolute fixes. Relative observations are visible but unused by this baseline. |
| Architecture | Centralized joint-state reference versus independent local filters | Cooperative describes using inter-robot observations. This page does not implement a distributed filter protocol. |
| Timing | 0.25 s prediction intervals; 1 s observation boundaries | Predict first, apply the relative observation when available, then A1's absolute fix when available. |
| Sensing and delivery | Synthetic Cartesian displacement, relative position and A1 position | Known robot identities, axes, units and common orientation; current measurements arrive ideally with no queue or delay. No radio propagation, range/bearing conversion or sensor-processing pipeline. |
| Estimator inputs | Initial uncertain position estimates, odometry and current measurement packets | Truth, future availability and error metrics remain evaluator data. |
| Motion and fidelity | Two prescribed planar paths; fixed display altitude | The estimator does not steer the vehicles. Both views observe the same true paths and position beliefs. Detailed drone geometry illustrates the model; altitude, attitude, flight dynamics and collision control are not estimated. |

Unlike [lesson 7](07-shared-estimates.md), which combined several estimates of
one target, this experiment estimates **different robots' own positions**.
Unlike [lesson 6](06-localization.md), motion here is open loop: changing the
estimator changes beliefs while holding the physical trajectories fixed.

## Physical paths and synthetic observations

For simulated time `t` in seconds from 0 through **20 s**, the evaluator uses
these positions in metres:

```text
p1(t) = [−3 + 0.3 t, −1.5 + 0.4 sin(0.4 t)]
p2(t) = [−2.5 + 0.25 t, 1.1 + 0.4 cos(0.4 t)]
```

The paths provide an identical moving scenario for both estimators. Neither
estimator can read the path formula or true displacement directly. Motion is
not a test of closed-loop navigation, arrival or mission success.

Initial estimates equal each true initial position plus independent Gaussian
coordinate error with standard deviation **0.8 m**. The assumed initial joint
covariance is `P0 = 0.64 I4 m²`. Independent initial errors mean its cross blocks
start at zero. There is no position fix at time zero.

Each 0.25 s interval supplies both robots with their true displacement plus
independent zero-mean Gaussian noise of standard deviation **0.08 m per axis per
interval**. Thus `Q = 0.0064 I4 m²` is added at every prediction. This describes
uncertainty in measured displacement, not an acceleration or velocity state.

At integer seconds 1 through 20, available measurements are

```text
Relative: z_rel = p2 − p1 + v_rel,     R_rel = 0.0225 I2 m²
Absolute: z_abs = p1 + v_abs,         R_abs = 0.04 I2 m²
```

Relative noise has standard deviation **0.15 m per axis**; A1's absolute fix has
standard deviation **0.2 m per axis**. A2 never receives a direct absolute fix.
All initial, odometry and observation errors are independent under the nominal
noise model. Fixed seed draws remain aligned across methods and availability
scenarios, including discarded observations, so comparisons use the same input
realization. The generator uses Mulberry32 uniforms and Box–Muller Gaussian
pairs: four initial normals and eight normals at every physical interval, even
when no measurement is delivered. The page accepts seeds 1–999999; the pure
module accepts unsigned 32-bit integer seeds including zero.

These are ideal coordinate observations. The known shared orientation removes
an issue that real range/bearing or camera systems must address. The synthetic
absolute fix is not a hardware GNSS integration; disappearance of a fix is an
availability schedule, not a radio or failure-detection model.

## Joint prediction and correction

Let `m = [x1, y1, x2, y2]ᵀ` be the estimated state and `P` its 4×4 covariance.
The two measurement matrices are

```text
H_rel = [ −1  0  1  0 ]      H_abs = [ 1  0  0  0 ]
        [  0 −1  0  1 ]              [ 0  1  0  0 ]
```

For measured displacements `d`, prediction is `m− = m + d`, `P− = P + Q`.
For one available observation `(z, H, R)`, the linear correction is

```text
r = z − H m−                    innovation / residual
S = H P− Hᵀ + R                 innovation covariance
K = P− Hᵀ S⁻¹                   Kalman gain
m+ = m− + K r                   corrected joint position
P+ = (I − K H) P− (I − K H)ᵀ + K R Kᵀ
```

The last equation is the Joseph covariance form. Units are metres for `m`, `z`
and `r`, square metres for `P`, `Q`, `R` and `S`, and dimensionless for `K`.
Every update preserves the full covariance rather than deleting cross terms.
The relative and absolute measurement noises are independent, permitting their
sequential use on a shared observation boundary. A missing observation performs
no correction; an old sample is not applied again.

Partition the covariance into 2×2 blocks:

```text
P = [ P11  P12 ]
    [ P21  P22 ]
```

`P12 = P21ᵀ` describes correlated position errors. A relative observation couples
the estimates. Later an A1 absolute observation can change A2's estimate through
the A2 rows of the joint gain. The page exposes the mean/covariance before and
after each stage, the observation, innovation, gain and correction for both
robots so this information transfer is visible.

The independent baseline applies its own odometry predictions and A1's absolute
correction without using relative observations or exchanging estimates. It
retains zero cross-covariance under the stated independent inputs. It does not
pretend to be a distributed implementation of the joint filter. The comparison
changes which measurements are used and the estimation architecture.

## What the absolute reference contributes

Define team center `c = (p1 + p2)/2` and relative displacement `d = p2 − p1`.
Their reported covariances follow directly from the joint matrix:

```text
P_center   = (P11 + P12 + P21 + P22) / 4
P_relative = P11 + P22 − P12 − P21
```

For any shared translation `g = [a, b, a, b]ᵀ`, `H_rel g = 0`. Relative
observations therefore cannot distinguish two globally translated teams. A
finite position prior still supplies finite information about the team center;
unobservable from these measurements does not mean infinitely uncertain from
the first tick.

With the symmetric prior and equal odometry noise in the unanchored scenario,
center and relative error initially have no covariance. Relative corrections
leave the estimated center and its covariance unchanged at that stage. After
`k` predictions, `P_center = (0.32 + 0.0032 k) I2 m²`, even while relative
uncertainty contracts. After an asymmetric absolute update, prior correlations
can let a later relative update change the center estimate; the measurement's
common-translation nullspace nevertheless remains.

The optional **shared prior shift** adds `[2, −1.5] m` to both initial estimates
without changing the covariance or sensor samples. It intentionally violates
the zero-mean prior assumption. In an unanchored run it leaves relative residuals
unchanged and remains an exact translation between paired shifted/unshifted
estimates. It illustrates an unobservable error, rather than a calibrated
Gaussian trial. In the joint filter, restoring A1's reference allows correction
of this offset; it does not imply exact recovery from noisy data in a single update.

## Availability scenarios

| Scenario | Relative observations | A1 absolute fixes |
| --- | --- | --- |
| Anchored | Every integer second | Every integer second |
| Unanchored | Every integer second | None |
| Anchor restored | Every integer second | First at 10 s, then each integer second |
| Relative outage | Omit observations at 5, 6, 7, 8 and 9 s; resume at 10 s | Every integer second |

Prediction continues through every absence. Samples are generated at the end of
the physical interval; the step from 9.75 to 10 s includes the restored sample.
Relative correction precedes absolute correction at a shared boundary. Current
packets, used/unused flags and current update stages are labeled separately.
Only the current interval’s matrices are retained; the plotted history records
errors and uncertainty, and events record observation availability.

## Metrics and interaction

The run always ends at **80 steps / 20 s**. This is an estimation budget,
not a declaration that either robot has completed a mission.

Evaluator position RMSE at one boundary is
`sqrt((||m1 − p1||² + ||m2 − p2||²)/2)` in metres. The denominator is two robots,
not four coordinates. Relative error and team-center error are the corresponding
2D Euclidean distances from truth. Reported uncertainty comes from `P`, not from
those realized errors. Reported RMS radii are `sqrt(trace(P)/2)` for the two
robots together and `sqrt(trace(P_center))` or `sqrt(trace(P_relative))` for
center/relative displacement. They are expected RMS distances under the assumed
model, not per-axis standard deviations or probability bounds. A nominal 95%
2D Gaussian contour uses
`eᵀ Pii⁻¹ e = 5.991`; it is an assumed marginal contour, not a safety region or
guarantee, especially under the deliberately shifted prior.

Where shown, normalized estimation error squared (NEES) is `eᵀ P⁻¹ e` for the
four-coordinate joint error; its nominal expected value is 4. Normalized
innovation squared (NIS) is `rᵀ S⁻¹ r` for an applied two-coordinate observation;
its nominal expected value is 2. Individual values are random. Ensemble checks
use nominal priors, paired seeds and consistent endpoints, without combining
the intentionally biased prior runs into calibration statistics.

The page provides paused method/scenario/seed/prior-shift configuration,
play/pause, one prediction step, next observation, an event-boundary jump and
run to budget. Robot selection, update-stage inspection, view switching and
camera framing preserve the active state. Independent reference copies do not
replace the active run. Physical drones are evaluator truth; belief markers,
uncertainty contours and cross-covariance describe what the estimators report.
Both views make that distinction visible.

## Verification and references

Acceptance requires a batch linear-Gaussian correction oracle, positive and
symmetric covariance, shared-input replay, availability boundaries, cross-agent
absolute corrections, unanchored common-mode behavior, translation invariance,
matched-seed statistical checks, view invariance and meaningful browser controls.
The exporter records source hash, revision, runtime, parameters, 12 seed-7
reference summaries and four sets of 200 paired seeds (1,600 method runs). The
references include both methods on four nominal-prior schedules plus shifted
unanchored/restored cases. Ensembles use only nominal priors and report
counterexample seed IDs where the joint endpoint position error is not lower.
Results apply to this declared model.

- Roumeliotis and Bekey (2002), [Distributed multirobot localization](https://doi.org/10.1109/TRA.2002.803461),
  IEEE Transactions on Robotics and Automation 18(5), 781–795;
  [author manuscript](https://www-users.cse.umn.edu/~stergios/papers/TRA-MULTI.pdf).
  The paper develops joint estimation and a distributed decomposition. This
  workshop uses a simplified centralized linear position reference, not its
  complete nonlinear robot model or distributed implementation.
- Kalman (1960), [A New Approach to Linear Filtering and Prediction Problems](https://doi.org/10.1115/1.3662552),
  provides the linear estimation foundation.

There is no SLAM, map estimation, unknown data association, heading estimation,
body-frame sensor conversion, physical radio, collision avoidance or flight
controller. A relative Cartesian vector in a supplied shared frame is a strong
assumption. Extending it to real sensing requires a separately specified model.
