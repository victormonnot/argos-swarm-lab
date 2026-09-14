# Pose-graph SLAM — reference results

Measured on **2026-09-14** using the declared
[pose-graph model](13-pose-graph-slam.md). The
[JSON record](../results/pose-graph.json) includes runtime, checkout revision,
model hash, three seed-7 references and 100 paired seeds across three graphs.
Reproduce it with
`npm run --silent compare:pose-graph > docs/results/pose-graph.json`.

## Fixed-seed comparisons

All cases begin with the same 25 integrated odometry poses and the same 24
consecutive measurements. Pose 0 is fixed exactly. A separate return measurement
is omitted, attached correctly to `0 → 24`, or deliberately misassociated with
`0 → 18`. Every observation is already recorded before optimizer iteration 0.
Finishing optimization adds no physical flight time or new measurement.

For seed 7, initial trajectory RMSE is **0.5741 m**, endpoint position error is
**0.5454 m**, and endpoint heading error is **2.3549°** in all three cases.
The trajectory metric excludes fixed pose 0, averages positions 1–24 and uses
the supplied world frame without alignment to truth.

| Graph | Cost before → after | Trajectory RMSE (m) | Endpoint error (m) | Endpoint heading error (°) | Attempts / accepted changes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Odometry only | 4.12×10⁻²⁸ → 4.12×10⁻²⁸ | 0.5741 | 0.5454 | 2.3549 | 1 / 0 |
| Correct loop 0 → 24 | 128.6523 → 1.1690 | 0.2733 | 0.0653 | 2.4124 | 5 / 4 |
| Wrong loop 0 → 18 | 19858.4396 → 188.1616 | 4.1203 | 5.5813 | 83.3835 | 7 / 7 |

All three reach the declared stationary criteria in this reference seed. The
odometry chain is already internally consistent, so its first check applies no
correction. Its near-zero cost does not mean its trajectory is physically exact.

The correct loop changes historical positions by up to **0.5620 m** from their
initial estimates and reduces trajectory position error. It does not improve
every individual quantity: the endpoint heading error increases slightly in
this realization. The loop is an independent noisy measurement, not an exact
fix to the true return pose.

The wrong loop causes up to **6.2111 m** of historical position correction while
making the reconstructed path much worse. Its own objective falls because the
solver fits the supplied false constraint. These costs belong to different
graphs and must not be ranked as accuracy scores across scenarios. A stationary
result does not validate the supplied association or certify a global minimum.

## Paired seeded comparisons

Seeds **1–100** produce **300 graph runs**. Each seed shares the same truth,
odometry, initial guesses and independent loop measurement across scenarios.
Reported RMS takes the square root after averaging squared errors across seeds;
trajectory RMS also averages the 24 unfixed positions within each seed. The
initial trajectory RMS is **0.6527 m**, and initial endpoint RMS is **0.9367 m**.

| Graph | Final trajectory RMS (m) | Endpoint RMS (m) | Endpoint heading RMS (°) | Lower trajectory error than initial |
| --- | ---: | ---: | ---: | ---: |
| Odometry only | 0.6527 | 0.9367 | 8.1914 | 0 / 100, all unchanged |
| Correct loop | 0.2844 | 0.0693 | 0.9801 | 95 / 100 |
| Wrong loop | 4.1367 | 5.6472 | 88.4177 | 0 / 100 |

The correct loop has lower trajectory error than the wrong loop in all 100
pairs. It does **not** improve on its own initial odometry estimate for seeds
**15, 17, 56, 59 and 78**. Those counterexamples remain in the export and the
interactive comparison. A statistically useful constraint is not a guarantee
of improved realized error in every sample.

Numerical termination is counted separately from evaluator accuracy:

| Graph | Stationary | Line search stopped | Failure seeds |
| --- | ---: | ---: | --- |
| Odometry only | 100 | 0 | None |
| Correct loop | 99 | 1 | 1 |
| Wrong loop | 98 | 2 | 19, 41 |

No run reaches the 30-attempt budget or fails its linear solve in this sample.
For the three line-search stops, the further proposed direction is very small,
but remains above the declared `10⁻⁸` coordinate threshold. None of the 21 trial
fractions satisfies the finite-precision Armijo comparison, so the solver
retains its last accepted poses and reports the failure. The smallest rejected
cost-minus-bound margins are about **5.33×10⁻¹⁵**, **5.68×10⁻¹⁴** and
**2.84×10⁻¹⁴** respectively. These outcomes remain included in error aggregates;
they are not dropped or relabeled successful convergence.

The table above records the **Node v22.22.1 export**. Chromium 153.0.8010.12's independently
computed browser ensemble retains the same rounded error summaries and five
accuracy counterexamples, but reports line-search stops for correct-loop seeds
**1 and 27**, and wrong-loop seeds **3 and 41**. Elementary floating-point
calculations can differ across JavaScript runtimes; near the strict stopping
thresholds, this changes which tiny step is accepted or where an attempt stops.
The interface reports its own measured stop counts and replay seeds. Do not
interpret those roundoff-level differences as a different association model or
a material change in the reconstructed trajectory.

## Verification

- `npm test`: **173/173 passed**, including 18 pose-graph model checks. They
  cover finite-difference Jacobians, an independently assembled dense normal
  system, wrapped angles, the objective's factor-of-two Armijo convention,
  a rejected full step followed by an accepted half step, fixed-anchor and
  history preservation, truth isolation, paired inputs, stationary and budget
  outcomes, disconnected linear-solve failure and numerical line-search failure.
- Independent NumPy/SciPy audit: 100 generic residual/Jacobian cases and 15
  seeded graphs agree with separately computed linearizations and local solves.
  Jacobian differences are below **1.73×10⁻⁹**, normal-system differences below
  **2.7×10⁻¹²**, and Gauss–Newton directions differ by less than **4.9×10⁻¹⁴**.
  Final poses differ from SciPy least-squares solutions by less than
  **4.95×10⁻⁸**. Independent checks also preserve the anchor, recorded inputs,
  saved history, rigid-coordinate equivalence and wrapped headings near ±π.
  The three retained numerical-failure cases agree with SciPy within
  **3.11×10⁻⁸** in their final pose coordinates; rejected trials leave poses
  unchanged. This is local numerical agreement, not proof of a global optimum.
- The exporter completed three references and all 300 graph runs. Its source
  SHA-256 identifies the actual model used, including the negligible-direction
  stop and explicit failure-seed records.
- `npm run test:e2e`: **90/90 Chromium checks passed**, including nine pose-graph
  checks covering retrospective changes, the fixed anchor, stationary odometry,
  paired loop measurements, incorrect association, numerical-failure diagnostics,
  unchanged rejected poses, historical/edge selection, seeded replay, reference
  isolation, playback rates, linked views, cameras, keyboard/mobile use and
  unavailable/lost WebGL. Fallback tests deliberately simulate context failure.

- `npm run build`: **13 HTML entries built successfully**. The existing shared
  optional Three.js chunk remains 736.58 kB minified / 186.86 kB gzip and emits
  Vite's size advisory. No dependency was added or installed.
- Production-preview Chromium checks passed all 13 routes, navigation, three
  references, the 100-pair comparison, correct/wrong/no-loop outcomes, numerical
  failure inspection, 2D/3D switching, camera controls, 390 px layout and back
  navigation with no page, console or HTTP errors. Whole-graph, close-up,
  corrected/wrong-loop, edge/pose inspector, solver-step and mobile screenshots
  were inspected. This software-WebGL check does not establish hardware
  rendering performance.

## Limits

This is a small anchored planar optimization backend with synthetic relative
measurements and supplied pose IDs. The 3D scene gives the recorded robot a
volumetric airframe and environment at a fixed display altitude; optimization
changes historical estimates, not a flown path. It does not model sensor
processing, loop recognition, unknown association inference, robust rejection,
posterior covariance calibration, landmark optimization or flight control.

The dense 72-variable solve is appropriate to this bounded illustration. These
results do not establish large-graph scalability, hardware performance, global
convergence or robustness to arbitrary incorrect loop associations. The
[primary tutorial](https://doi.org/10.1109/MITS.2010.939925) supplies the method
context; the experiment's residual coordinates, noise, anchor, line search and
stopping rules are specified explicitly in the linked lesson brief.
