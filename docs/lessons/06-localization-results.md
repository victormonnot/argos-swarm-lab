# Linear Kalman position filtering results

Measured on **2026-09-14** with Node.js **22.22.1**. Reproduce with
`npm run --silent compare:localization`. The [JSON artifact](../results/localization.json)
contains the ten references and all 200 paired trials, exact parameters and maps,
random generator, runtime, base revision, modified-worktree flag and SHA-256 hashes
of the localization and imported pathfinding models. See the
[specification](06-localization.md) for sensor and stopping semantics.

## Seed 1, systematic bias enabled

Every case uses an A* route on the known open/U grid, the same exact start,
1 m/s maximum speed, 0.1 s intervals and paired noise draws. Odometry has Gaussian
standard deviation 0.01 m per axis/interval plus fixed bias `(0.08,0.04)` m/s.
Absolute fixes have 0.05 m standard deviation per axis, every second. Outage
begins at 3 s; recovery restores the next fix at 8 s if the run is still active.

| Map | Position source | Fix schedule | Outcome | Time (s) | Actual goal distance (m) | Estimated goal distance (m) | RMS error (m) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Open | Exact oracle | Regular | Arrived | 6.9 | 0.100 | 0.100 | 0.000 |
| Open | Dead reckoning | Regular, ignored | False arrival | 6.5 | 0.542 | 0.038 | 0.334 |
| Open | Kalman | Regular | Arrived | 6.9 | 0.124 | 0.023 | 0.122 |
| Open | Kalman | Lasting outage | False arrival | 6.6 | 0.435 | 0.028 | 0.254 |
| Open | Kalman | Restore at 8 s | False arrival | 6.6 | 0.435 | 0.028 | 0.254 |
| U | Exact oracle | Regular | Arrived | 16.8 | 0.100 | 0.100 | 0.000 |
| U | Dead reckoning | Regular, ignored | False arrival | 16.4 | 1.437 | 0.027 | 0.824 |
| U | Kalman | Regular | Arrived | 16.9 | 0.205 | 0.043 | 0.142 |
| U | Kalman | Lasting outage | False arrival | 16.4 | 1.334 | 0.027 | 0.736 |
| U | Kalman | Restore at 8 s | Arrived | 17.3 | 0.217 | 0.082 | 0.241 |

The controller accepts each waypoint within 0.10 m of the estimate. At its final
completion claim, the evaluator requires true goal distance ≤0.25 m. This is a
different waypoint-acceptance rule from lesson 5's exact center arrival, explaining
the oracle's 6.9/16.8 s times here. A false arrival terminates the run; there is no
automatic restart on a later observation. The open-map recovery run therefore
ends before its 8 s restoration, rather than eventually recovering.

Dead reckoning integrates biased displacement and ignores absolute fixes, so it
can confidently finish its waypoint list while physical execution misses the
goal. Kalman corrections reduce drift in these examples, but the filter has no
bias state and does not model the fixed nonzero mean. Covariance describes its
assumed model, not certified actual error or a collision-safe envelope.

## All twenty paired seeds

Seeds 1–20 each run every configuration above, giving 200 trials. Fixed bias
remains enabled. All outcomes are reported; none is discarded.

| Map | Position source | Fix schedule | Arrived / 20 | False arrival / 20 | Mean per-run RMS (m) | Worst observed error (m) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Open | Exact oracle | Regular | 20 | 0 | 0.000 | 0.000 |
| Open | Dead reckoning | Regular, ignored | 0 | 20 | 0.330 | 0.694 |
| Open | Kalman | Regular | 15 | 5 | 0.138 | 0.284 |
| Open | Kalman | Lasting outage | 0 | 20 | 0.264 | 0.619 |
| Open | Kalman | Restore at 8 s | 0 | 20 | 0.264 | 0.619 |
| U | Exact oracle | Regular | 20 | 0 | 0.000 | 0.000 |
| U | Dead reckoning | Regular, ignored | 0 | 20 | 0.822 | 1.624 |
| U | Kalman | Regular | 19 | 1 | 0.148 | 0.306 |
| U | Kalman | Lasting outage | 0 | 20 | 0.746 | 1.580 |
| U | Kalman | Restore at 8 s | 20 | 0 | 0.255 | 0.762 |

No collision or budget exhaustion occurred in these 200 trials. Contact detection
is implemented and tested with separate contact fixtures; these sampled outcomes
do not guarantee safe execution for all seeds or future models.

RMS is `sqrt(mean(||estimate−truth||²))` over initialization and every snapshot
until that run stops. Mean per-run RMS averages twenty such values; observation
durations differ. It is not a fixed-duration comparison or a statistical claim
about all possible runs. The seed-aligned perturbations are identical at a given
interval, while readings and trajectories can differ due to the controller.

With regular fixes, five open runs and one U run still announce arrival outside
the physical radius. Recovery on the U happens to yield twenty arrivals here,
but has higher mean RMS than regular fixes and is not universally preferable.
A favorable final outcome does not erase the error accumulated during the outage.

## Actual verification

- **64/64 Node tests passed**, including ten new localization checks. They use
  an independent information-form calculation for the Kalman correction; check
  covariance growth and contraction, missing fixes at step30 and correction at80,
  no stale reuse, aligned random draws, controller input isolation, exact-reference
  privilege, false-arrival thresholds, terminal restoration, swept contact and
  clipped odometry, motion bounds, frozen-input reset, validation and all 200 trials.
- **40/40 Chromium tests passed**, including six new localization checks and all
  34 previous workshop checks. They cover prediction/correction inspection,
  historical versus fresh fixes, outage/recovery, false versus verified arrival,
  applied seed drafts, replay, bias toggling, invalid input, reference/repeated
  tables, exact playback at two speeds, 2D/3D/camera invariance, coordinate
  inspection, keyboard controls, 390 px layout, six-workshop navigation and
  unavailable WebGL. No page exceptions occurred; deliberately unavailable WebGL
  emitted Three.js's expected context-creation diagnostic.
- The JSON export completed. Read-only mathematical review also checked 4,242
  transitions in scratch memory across both maps, all estimator/schedule choices
  and bias on/off for seed1. The foundational and supporting filter sources were
  checked, including the Joseph covariance form and its identity linear case.
- Production build passed for six HTML entries. No dependency was installed or
  changed. The optional Three.js chunk retains its existing size warning, about
  737 kB minified / 187 kB gzip; the localization page script is about 25.8 kB
  minified plus the shared pathfinding module.
- A production-preview browser smoke check passed all six routes and the previous
  five workshops' first steps, regular-fix arrival, dead-reckoning false arrival,
  missing/fresh fix inspection, recovery, termination before restoration, lazy
  3D with unchanged numerical state, distinct arrival labels, 390 px layout and
  usable browser back/forward navigation. No console/page errors or failed
  requests occurred. Local 2D false-arrival and 3D recovery captures were inspected.
- An independent read-only audit matched both source hashes, all ten reference
  cases, 200 trials, ten aggregates, twenty numerical table rows and fourteen
  exported parameters. Local Markdown links resolve.

This is a single-browser point simulation with known initial position and map,
not a real GPS/IMU/SLAM system. No shared estimates, bias-state identification,
covariance-coverage guarantee, vehicle dynamics, body clearance or deployed robot
performance was tested. Other browser engines were not tested.
