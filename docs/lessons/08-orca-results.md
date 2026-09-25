# ORCA crossing results

Measured on 2026-09-14 with Node.js 22.22.1. The
[specification](08-orca.md) defines sensing, geometry, methods and stopping rules.
The [JSON artifact](../results/orca.json) records full precision and source/runtime
metadata. Reproduce with `npm run --silent compare:orca > docs/results/orca.json`.

## Reference cases

Every case uses the same 0.05 s step, 1 m/s speed limit, 0.30 m physical disk
radius and 40 s budget. ORCA has a 2 s horizon and 0.01 m padding per disk.
Crossing cases share three starts/goals; the symmetry case uses two agents.
Arrival requires every agent within 0.15 m of its own goal at the same boundary.

| Method | Scenario | Outcome | Time (s) | Arrived | Minimum swept gap (m) | Steps with infeasibility |
| --- | --- | --- | ---: | --- | ---: | ---: |
| ORCA | Offset crossing | Arrived | 10.55 | 3 / 3 | 0.020000 | 0 |
| APF | Offset crossing | Arrived | 10.65 | 3 / 3 | 0.189190 | 0 |
| Direct preference | Offset crossing | Contact | 3.65 | 0 / 3 | -0.014765 | 0 |
| ORCA | Symmetric head-on | Timeout | 40.00 | 0 / 2 | 0.020000 | 0 |
| ORCA | Crossing without peer sensing | Contact | 3.65 | 0 / 3 | -0.014765 | 0 |

ORCA and APF both succeed on the offset crossing. ORCA takes a slightly shorter
time in this particular configuration and passes closer to its neighbors. These
five deterministic cases are not a general speed, clearance or scalability
ranking. APF uses a finite-range position-based repulsion field; ORCA also reads
peer velocities and uses explicit padded geometry.

Direct following makes contact in the first interval ending at 3.65 s. The
negative clearance means overlap during that interval, not just intersecting
paths at different times. The shown stop time is a step boundary rather than
the exact continuous impact time.

Without peer observations, ORCA constructs no neighbor half-planes, so its
preference is feasible in the speed disk. It reproduces direct following's
collision despite reporting no infeasible decision. Local constraint feasibility
is not evidence that missing information was harmless.

The exactly symmetric ORCA pair does not arrive within 40 s. Its physical
clearance approaches the padding-induced 0.02 m gap while progress tends toward
zero. The model applies no perturbation or right-of-way convention to escape
this configuration. Timeout is a measured finite-window result, not a universal
deadlock theorem.

None of these presets invokes the zero-command fallback for an empty feasible
set. That branch is exercised separately by mathematical checks; these results
do not establish that stopping an infeasible agent would prevent collisions.

## Actual verification

- **89/89 Node tests passed**, including fifteen ORCA checks for analytic
  projections, reciprocal constraints, pairwise horizon separation, swept
  collision detection, permitted inputs, synchronous decisions, terminal
  behavior, repeatability and the flagged infeasibility fallback.
- An independent read-only mathematical audit checked 10,000 seeded pair
  geometries against a separate finite-horizon velocity-obstacle construction,
  including inside/outside cases, cutoff arcs, tangent rays, supporting normals
  and swapped-agent reciprocity. Maximum boundary-distance discrepancy was
  approximately `5.8e-15`.
- The same audit compared 500 feasible convex projections with an independent
  Dykstra projection solver; maximum velocity discrepancy was approximately
  `4.9e-12`. Boundary/center cases, overlap infeasibility, within-step collision
  detection and a 200-step reversed-agent-order comparison also passed.
- An additional sixty ORCA runs covered horizons 0.25–5 s in increments of
  0.25 s across the three scenarios. All twenty sensed crossings arrived, all
  twenty symmetric cases timed out, and all twenty blind crossings collided.
  No infeasible decisions occurred in that bounded sweep.
- **52/52 Chromium tests passed**, including all six new ORCA interaction
  tests and the forty-six earlier workshop tests. Checks cover prepared/applied
  decision inspection, all five outcomes, horizon/reset, comparison isolation,
  playback at two rates, agent/camera inspection, mutually exclusive 2D/3D
  display, agent and goal labels, context loss, unavailable WebGL, keyboard,
  390 px layout and navigation across eight pages. No page exceptions occurred;
  deliberately unavailable WebGL produces Three.js's expected diagnostic.
- The production build passed for eight HTML entries. The existing optional
  Three.js chunk still triggers Vite's large-chunk advisory; it loads only when
  a 3D view is requested.
- Production-preview smoke checks passed on all eight routes. ORCA stepping,
  arrival, symmetry timeout, missing-sensing collision, independent comparisons,
  lazy 3D with unchanged numerical state, goal labels, 390 px layout and usable
  back navigation passed without console/page errors or failed requests.
  Desktop 2D, velocity inspection, 3D and mobile captures were inspected.
- The exported source hash, runtime, base revision, nine numerical constants,
  three initial-condition sets and five reference summaries were checked against
  the model.

These checks concern this browser teaching model. They do not test physical
robots, noisy sensors, acceleration constraints, networking or middleware.
