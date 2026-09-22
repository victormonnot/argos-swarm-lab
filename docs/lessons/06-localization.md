# Lesson 06 — Dead reckoning and linear Kalman position filtering

**Status:** implemented locally at `/localization/`; see the
[measured results](06-localization-results.md). This is the next
bounded motion/estimation experiment after [path planning](05-pathfinding.md).
Shared target estimates are a separate [seventh lesson](07-shared-estimates.md).
Bias-state estimation and real localization hardware remain proposed work.

**Question:** what happens when a robot follows a valid route using a position
estimate that differs from its physical position?

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Reference | Exact-position oracle | Uses simulator truth as the controller's position. A privileged comparison, not a deployable sensor. |
| Integration baseline | Dead reckoning | Add measured displacement to the previous estimate; deliberately ignore absolute fixes. |
| Filter | Linear Kalman filter, two position coordinates | Independent x/y prediction/correction with identity state/input/measurement matrices; no velocity, heading or bias state. |
| Route and execution | A* Manhattan grid path; waypoint follower | Plan once on the known map from the exact initial position. Control uses the current position estimate and next waypoint. |
| Architecture | One onboard estimator and controller | No peers, fusion across robots, network or shared map update. |
| Timing | 0.1 s motion and odometry; 1 s absolute fixes | Prediction every interval, correction only on a delivered fix. |
| Sensing | Synthetic displacement and absolute position | Seeded Gaussian perturbations and an optional fixed displacement-rate bias. No GNSS, IMU, camera, SLAM or GPS-loss model. |
| Evaluator | True position, error, contact and arrival | May show the learner information unavailable to the controller. |
| Fidelity | Planar point kinematics | No body radius, turning constraints, dynamics, obstacle discovery or replanning. |

Both views observe the same true and estimated histories. Marker size and 3D wall
height are illustrations. A valid grid route does not make biased execution safe.

In 3D, a solid detailed quadrotor represents evaluator truth and a larger
wireframe quadrotor represents the estimate. Both use the same fixed 0.8 m
display height; their vertical guides land on the actual planar coordinates.
The connecting line shows their horizontal position error. Covariance contours,
true and estimated trails, the last delivered fix and the route retain their
original planar values. The ghost's displayed orientation matches the solid
drone; the filter does not estimate heading. Walls are 1.65 m tall with exact
1 × 1 m occupied-cell footprints. Aircraft size and wall height do not change
the point-contact rule. Whole-site and follow-truth cameras, orbit, zoom and
keyboard panning never advance the run.
The default camera looks through the western U opening. Wall cells obscuring
either displayed pose become translucent while their edges and shadows remain.
This cutaway is recalculated during motion and camera orbiting; it changes no
occupied cell, sensor input, position or contact decision.

## Shared mission and sensor model

Reuse the open and U maps, start `(3.5,4.5)` m, goal `(10.5,4.5)` m and A* route
from lesson 5. All estimators begin at the exact known start. The commanded
displacement has norm at most `1 m/s × 0.1 s`. The true point applies this command;
an evaluator checks swept contact with occupied cells and clips first contact.

The displacement sensor then produces, for each axis:

`d_odom = (p_true,next − p_true,previous) + b·dt + ε_odom`

`z = p_true,next + ε_fix` when an absolute fix is available.

- `b=(0.08,0.04) m/s` if bias is enabled; `(0,0)` otherwise. This is a fixed
  world-axis additive rate bias, not a scale error or body-frame wheel model.
- Odometry noise: independent synthetic coordinates with standard deviation
  `0.01 m` per interval; absolute-fix noise: `0.05 m` per coordinate per fix.
- A 32-bit LCG generates four open-interval uniforms per motion interval; two
  Box–Muller pairs produce two odometry and two absolute-fix perturbations.
  Draws are consumed even when the fix is unavailable or ignored. The same
  seed/interval therefore uses the same perturbations across methods/schedules.
  Trajectories differ, so actual measured positions need not be identical.
- No absolute fix at step zero; the exact initial state is given independently.
  Normal fix boundaries are 10,20,30,… (1,2,3,… seconds).
- Steady: keep every scheduled fix. Outage: omit fixes at and after step30.
  Recovery: omit steps30–79, resume at step80 (8 s). Missing fixes are discarded,
  with no queue or reuse of a stale measurement.

The simulator uses truth to synthesize noisy sensors, as a simulator must. The
dead-reckoning and Kalman functions receive the resulting readings, never the
unperturbed pose, hidden bias, random draws or future outage schedule. The exact
reference is the explicit exception.

## Estimate, then correct

Dead reckoning: `p_hat,next = p_hat + d_odom`. It has no covariance estimate here.
All available absolute fixes remain visible in the sensor inspector but are
ignored by this baseline and by the oracle.

For the Kalman filter, each coordinate independently uses:

```text
Prediction: p_minus = p_hat + d_odom
            P_minus = P + Q

Correction: innovation = z − p_minus
            K = P_minus / (P_minus + R)
            p_plus = p_minus + K × innovation
            P_plus = (1 − K)² P_minus + K² R
```

`P` is assumed position-error variance in m², initialized to zero for the exact
start. `Q=0.0001 m²` per interval matches the injected random odometry variance;
`R=0.0025 m²` matches random fix variance. `K` is dimensionless. The last equation
is the scalar **Joseph covariance form**. With no fix, keep the predicted mean
and covariance; there is no correction gain or innovation for that interval.

This filter assumes zero-mean independent errors. The deliberately enabled fixed
bias violates that model and is **not estimated**. Small P does not prove small
true error, and a correction need not improve the realized error at every fix.
Display the innovation as an available sensor residual and true estimation error
as an evaluator measurement; they are different quantities.

The displayed contour has semiaxes `2√P_x` and `2√P_y` around the estimate. It is
an assumed-model contour, not a demonstrated 95% joint confidence region or a
collision-free envelope. Covariance is not computed for the oracle or the dead-
reckoning baseline. Disabling bias removes the deliberate systematic mismatch;
finite seeded runs still do not validate uncertainty coverage or general optimality.

## Boundary order, waypoint progress and arrival

1. Compute a command from the prior estimate and current waypoint, clamped to
   at most 0.1 m. The controller does not read true position or occupancy.
2. Apply that displacement to the physical point; evaluate and clip swept contact.
3. Generate the current displacement reading and optional absolute fix.
4. Integrate odometry, predict/correct, or supply exact pose for the oracle.
5. If there was no contact, advance one waypoint when its distance from the
   updated **estimate** is at most `0.10 m` (plus `1e-12` numerical tolerance).
6. Evaluate completion: once the controller has accepted the last waypoint,
   report **arrived** if true goal distance is at most `0.25 m`; otherwise report
   **false arrival**. Contact has priority. Stop at 400 intervals if still moving.

Unlike lesson 5's exact center arrival, this lesson explicitly uses a 0.10 m
waypoint-acceptance radius and a separate 0.25 m physical goal radius. The oracle
therefore need not reproduce lesson 5's exact travel length or time. These rules
are identical for all three estimator comparisons.

A completion claim ends the run. A later scheduled measurement cannot rescue a
run already stopped by that policy. In particular, the open-map reference can
stop before its planned 8 s restoration. Restoration is not a guarantee of
mission success. Contact stopping and arrival classification are evaluator actions,
not hidden obstacle avoidance or access to true pose by the controller.

## Controls and measurements

Map, estimator, fix schedule and bias controls start a paused run. A seed draft
is applied explicitly; reset repeats the applied configuration. Show true/estimated
positions and trails, the last absolute fix with age, the current waypoint and
the Kalman contour. Play/pause, fixed steps, advance to 3/8 s and run-to-outcome
control the numerical sequence; changing view or camera does not change it.

Inspect the current update: prior/predicted/posterior estimate, P, odometry, fix,
innovation and K. Between fixes, show the last fix as historical, not current
correction data. Separately display controller completion, actual goal distance,
estimated goal distance, true estimation error and actual travel.

Compare ten seed-1 reference runs: two maps × oracle/steady, dead/steady,
Kalman/steady, Kalman/outage and Kalman/recovery, all with bias enabled. Repeat
these cases for seeds1–20 (200 trials) and report all arrival/false-arrival/contact/
budget counts, including failures. RMS error includes step zero through that
run's terminal snapshot; different stopping times give different observation
windows. The average of per-run RMS values is not a fixed-horizon error benchmark.

## Verification and sources

Check analytical scalar updates, positive covariance, prediction growth without
fixes, first restored correction, no stale-measurement reuse, aligned random draws,
input isolation, false-arrival semantics, swept contact, bounded commands, reset
and all reference trials. Verify the visible controls and 2D/3D invariance, and
record only checks actually run.

Reproduce the reference and twenty-seed runs with:

```sh
npm run --silent compare:localization > docs/results/localization.json
```

The [JSON artifact](../results/localization.json) records all 200 trials, seed-1
references, aggregate counts, parameters, random generator, runtime, source hashes,
base revision and whether the worktree was modified.

- R. E. Kalman (1960), [A New Approach to Linear Filtering and Prediction Problems](https://doi.org/10.1115/1.3662552),
  Journal of Basic Engineering 82(1),35–45. Foundational filtering method.
- Greg Welch and Gary Bishop, [An Introduction to the Kalman Filter](https://www.cs.yale.edu/homes/hudak-paul/CS474S01/kalman.pdf),
  UNC TR95-041, revision November13,2000, pp.2–5: discrete prediction, gain,
  innovation and covariance assumptions.
- Renato Zanetti and Kyle J. DeMars,
  [Joseph Formulation of Unscented and Quadrature Filters with Application to Consider States](https://sites.utexas.edu/near/wp-content/uploads/sites/6030/2017/04/CUKF_ver06.pdf):
  Joseph covariance form and its linear special case. This lesson uses that linear
  identity-measurement case, not the paper's nonlinear filter extensions.

The route still uses the A* implementation and sources in lesson5. None of the
filter references specifies this page's route, outage schedule or completion policy.
