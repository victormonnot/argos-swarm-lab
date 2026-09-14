# Lesson 13 — Pose-graph SLAM and loop closure

**Question:** how can revisiting a place correct a recorded trajectory, and what
happens if the supplied loop association is wrong?

**Status:** implemented at `/pose-graph/`. The
[reference results](13-pose-graph-slam-results.md) record measured behavior,
verification and limits.

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Problem and algorithm | Pose-graph SLAM backend; Gauss–Newton nonlinear weighted least squares | Estimate past planar poses together from relative-pose constraints. |
| Numerical variant | Additive x/y/heading updates, Cholesky solve, Armijo backtracking | Relinearize at each iterate, solve the anchored normal equations, and accept a step only when it sufficiently decreases the objective. |
| Graph construction | Supplied odometry and loop associations | No scan matching, image features, automatic place recognition or unknown data association. |
| Reference frame | First pose fixed exactly and removed from the solve | Eliminate the global translation/rotation ambiguity without injecting evaluator truth elsewhere. |
| Comparison | No loop, correct loop and wrong loop | Keep the same odometry and starting estimate while changing one supplied graph constraint. |
| Timing | Recorded trajectory, then optimization iterations | A solver step does not advance physical time or move a real drone. Historical-pose selection only changes inspection. |
| Architecture and inputs | One batch optimizer | It receives pose guesses, relative measurements, information matrices and the fixed first pose; no true trajectory or association-quality label enters the solver. |
| Fidelity | Planar poses, synthetic constraints, fixed display altitude | A volumetric yard and one drone illustrate selected recorded poses. The graph nodes are past poses of that robot, not a swarm or a landmark map. |

Workshop 12 used an EKF to update the current pose and landmark map while
recording past estimates online. This workshop explicitly optimizes **past
poses**. It illustrates the optimization backend of graph-based SLAM; it does
not construct that graph from raw sensor data.

## Recorded survey and paired inputs

There are **25 recorded poses**, indexed 0 through 24, one per second of a
24-second survey. The evaluator uses

```text
φk = 2π k / 24
xk = 4 cos φk
yk = 4 sin φk
θk = wrap(π/2 + φk)
```

Positions use metres and headings radians. Heading zero points along +x, and
positive rotation turns toward +y. The true path is a circle of radius 4 m.
Pose 24 returns to pose 0. The optimizer is supplied the first pose exactly:
`[4, 0, π/2]`. It is never allowed to move that pose, and no later absolute fix
is added.

For each consecutive pair `i → j=i+1`, the synthetic sensor supplies the relative
translation in pose i's local axes and the relative heading, with independent
Gaussian coordinate noise:

```text
z_ij = [R(θi)ᵀ (pj − pi), wrap(θj − θi)] + noise
σ_translation = 0.08 m per local axis
σ_heading = 1.5°
```

The heading measurement is wrapped to the principal angle interval. These
24 independent odometry constraints are synthetic relative-pose readings, not
measurements from a real camera, IMU or scan-registration pipeline. The initial
trajectory integrates them from the fixed first pose; it therefore satisfies
the odometry chain to floating-point precision despite drifting from truth.

An additional independent measurement describes the true return `0 → 24`, whose
ideal relative transform is zero translation and zero heading. It has standard
deviations **0.05 m per translation axis** and **1°** in heading. Its noise is
generated for every scenario, including when no loop edge is included.

| Scenario | Supplied loop edge | Interpretation |
| --- | --- | --- |
| No loop | None | The chain can be internally consistent and still wrong in the world. |
| Correct loop | 0 → 24 | Use the independently observed return transform with the correct pose IDs. |
| Wrong loop | 0 → 18 | Attach that same return measurement to a different pose ID. |

The incorrect association is deliberately supplied; it is not discovered or
accepted by a modeled recognition algorithm. It is inconsistent with the true
relationship between poses 0 and 18. The solver only sees the edge endpoints,
measurement and weight. There is no oracle that tells it which edge is wrong,
and no robust loss, outlier gate or switchable constraint to reject it.

Matched seeds retain identical odometry, initial poses and underlying loop
measurement across scenarios. Truth and measurements remain fixed throughout
all optimization iterations. Inspecting a different historical pose does not
regenerate the graph.

## Residual and objective

Let `pi=[xi,yi]`. For an edge `i → j`, define

```text
q = R(θi)ᵀ (pj − pi)
h_ij = [qx, qy, wrap(θj − θi)]
e_ij = [qx − z_x, qy − z_y, wrap(θj − θi − z_θ)]
Ω_ij = diag(1/σ_x², 1/σ_y², 1/σ_θ²)
E(X) = Σ_edges e_ijᵀ Ω_ij e_ij
```

`E` has no factor of one half. Each edge's standardized residual divides its
two translation components by their metre noise scales and its angle by its
radian noise scale. Squaring and summing yields that edge's dimensionless cost.
The combined objective measures agreement with the supplied constraints.

The translation residual here is expressed in the source pose's axes. A common
SE(2) formulation rotates it into the measured transform's axes. Because this
experiment uses equal x/y weights and no translation/heading covariance, that
additional rotation preserves the stated weighted objective. This equivalence
does not hold for arbitrary anisotropic information matrices unless they are
transformed consistently.

For `c=cos θi` and `s=sin θi`, the nonzero Jacobian blocks are

```text
A = ∂e/∂Xi = [ −c  −s   qy ]    B = ∂e/∂Xj = [  c   s   0 ]
              [  s  −c  −qx ]                  [ −s   c   0 ]
              [  0   0   −1 ]                  [  0   0   1 ]
```

The wrapped angle residual is locally differentiable away from its ±π branch
boundary. Heading differences must wrap before weighting; nearby orientations
on opposite sides of that boundary do not differ by a full revolution.
Rotations, trigonometry and covariance/information calculations use radians;
the interface also displays degrees for reading.

## One optimizer step

The first pose's three coordinates are excluded, leaving **72 free variables**.
At the current trajectory, assemble Jacobian rows `J` over those variables and
accumulate

```text
H = Σ Jᵀ Ω J
g = Σ Jᵀ Ω e
H δ = −g
```

`H` approximates the Hessian of half the stated objective, and `g` is half its
gradient. The first-pose elimination anchors the connected graph. A Cholesky
solve computes the direction without forming an explicit matrix inverse.
This small teaching implementation uses dense matrices; it does not reproduce
a large sparse SLAM solver or make a scalability claim.

Apply additive pose increments and wrap each new heading. Armijo backtracking
starts with `α=1`, tries up to 21 candidates through `α=2⁻²⁰` (20 halvings),
and requires

```text
E(X + αδ) ≤ E(X) + 2 × 10⁻⁴ × α × gᵀδ
```

The factor 2 matches the objective convention above. Every trial evaluates the
actual nonlinear cost; a rejected trial does not alter the active trajectory.
The interface exposes accepted step size, backtracking, cost reduction and
changes to historical poses. Step size and gradient components mix metre and
radian coordinates; their tolerances belong to this parameterization and are
not physical error bounds.

The budget is **30 optimizer attempts**, separately counting accepted changes.
Stationarity is detected when the raw free-gradient infinity norm is at most
`10⁻⁸`, or when the maximum accepted coordinate change is at most `10⁻⁸` and the
relative objective change is at most `10⁻¹⁰`. Before line search, a proposed
direction can also stop without changing poses if its infinity norm is at most
`10⁻⁸` and `−gᵀδ / max(1, |E|)` is at most `10⁻¹⁰`. This catches negligible
predicted improvement before comparing nearly equal floating-point costs.
Failed linear solves and exhausted line searches have distinct outcomes;
roundoff can still exhaust a line search near a stationary point. The interface
reports that outcome separately rather than treating it as successful convergence.
A stationary no-loop chain can finish on
its first check without any accepted pose change. Reaching a numerical stopping
rule does not prove a global optimum, correct associations or an accurate map.
At floating-point resolution, the last accepted steps and numerical-failure
seeds can vary between JavaScript runtimes. Browser comparisons are calculated
in that browser; the saved JSON identifies the runtime used for its export.

## Inspection and interpretation

The display separates the true recorded path, the integrated odometry path and
the current optimized path. One detailed drone illustrates the selected
historical pose at a fixed display altitude. Other numbered nodes represent
that same drone at different recorded times. The pose slider is an inspector,
not physical playback; optimization can change a selected past estimate while
its true recorded pose remains fixed.

An edge inspector shows its endpoints, supplied relative measurement, current
prediction, raw and standardized residuals, information/noise scales and
weighted cost. Node inspection shows truth, initial estimate, current estimate
and correction. The recorded optimizer history tracks objective and evaluator
error independently. Camera movement, selection and 2D/3D switching preserve
the active optimization state. Reference copies do not replace it.

To make small corrections visible, both views share a presentation transition
between the previously displayed poses and the newly computed poses. It lasts
**900 ms** for a manual step or at one iteration per second, and **225 ms** at
four iterations per second. Positions interpolate linearly and headings take
the shortest wrapped angular difference. Intermediate frames are illustrations
between estimates, not additional optimizer iterations or flown poses. Metrics,
residuals, pose tables and histories always retain the actual computed result,
as identified by the note next to the scene.

**Before / After** compares the initial integrated odometry with the latest
computed estimate, including after the optimizer stops. Either button pauses
automatic iteration playback. Step, Play and Optimize to stop condition return
to After. The initial amber trajectory and correction arrows are visible by
default; the displayed correction magnitude uses metres, centimetres or
millimetres so later small updates remain interpretable. Finishing optimization
shows one transition to its final result rather than replaying skipped steps.

Changing views, inspecting a pose or edge, moving the camera and toggling
overlays preserve the current presentation progress. Rapid actions redirect
the scene from its currently displayed poses toward the latest target. Reset
or a new seed/scenario cancels the old transition and immediately displays the
new initial graph. Reduced-motion preferences also select immediate updates.
Pausing iterations lets a transition already in progress finish; it does not
advance the solver. An unchanged estimate creates no extra movement.

Evaluator trajectory RMSE is
`sqrt(sum(k=1..24, ||pk_est−pk_true||²)/24)`: the fixed anchor is excluded and
the other 24 equally weighted positions are included. Endpoint position and
absolute wrapped heading error concern pose 24. Maximum historical position
correction is measured from the initial estimate to the current one; it is
neither displacement flown nor error from truth. No post-hoc alignment to truth
is used, because the coordinate frame was fixed explicitly.

Graph cost, odometry cost and loop cost refer to the included factors. Costs
from different graph configurations are not directly comparable as accuracy
scores. A correct loop can spread a correction across old poses. An incorrect
loop can also reduce its graph's objective while bending the trajectory away
from the true path. Even a statistically useful constraint need not improve
every realized seeded trial.

This workshop does not estimate landmark positions, output posterior covariance,
detect loop candidates or control a drone. It does not assume that an optimizer
can repair arbitrary input associations. Recognizing a place and reconciling
the resulting graph remain separate responsibilities.

## Verification and primary source

Acceptance requires numerical edge-Jacobian checks, an independent normal-system
or optimizer oracle, fixed-anchor preservation, wrapped-angle behavior,
nonincreasing accepted objective, consistent seeded inputs, truth isolation,
recorded-history integrity and explicit terminal outcomes. Measured references
cover all three scenarios at seed 7 and paired seeded comparisons with
counterexamples and optimizer status counts. Browser checks must exercise the
actual optimization, node/edge selection, reference isolation, history, camera
and view invariance, keyboard/mobile controls and unavailable WebGL.

Grisetti, Kümmerle, Stachniss and Burgard (2010),
[A Tutorial on Graph-Based SLAM](https://doi.org/10.1109/MITS.2010.939925),
[author manuscript](https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/grisetti10titsmag.pdf),
provides the graph construction/optimization distinction and nonlinear least
squares framework. This workshop specifies its own small synthetic graph,
coordinate residual, exact anchor and backtracking variant. It does not
reproduce a complete SLAM system or a commercial implementation.
