# Cooperative localization — reference results

Measured on **2026-09-14** with the linear Gaussian model in the
[lesson specification](11-cooperative-localization.md). The
[JSON record](../results/cooperative.json) records the source hash, checkout
revision, runtime, assumptions, 12 reference cases and four paired ensembles.
Reproduce it with
`npm run --silent compare:cooperative > docs/results/cooperative.json`.

## Single-seed references

All runs use seed 7, two robots, the same physical paths and aligned sensor
noise samples, 0.25 s predictions and a fixed **20 s / 80-step** endpoint.
Errors below are in metres. Position RMSE averages squared Euclidean error over
the two robots before taking a square root; relative and center errors are
Euclidean distances. Values are rounded to four decimal places.

| Schedule | Method | Prior | Position RMSE | Relative error | Center error |
| --- | --- | --- | ---: | ---: | ---: |
| Regular A1 absolute fixes | Joint | Nominal | 0.1366 | 0.0408 | 0.1351 |
| Regular A1 absolute fixes | Independent | Nominal | 2.0803 | 2.8858 | 1.4985 |
| No absolute fixes | Joint | Nominal | 1.5895 | 0.1007 | 1.5887 |
| No absolute fixes | Independent | Nominal | 2.2046 | 3.0571 | 1.5887 |
| A1 absolute fixes start at 10 s | Joint | Nominal | 0.1368 | 0.0410 | 0.1353 |
| A1 absolute fixes start at 10 s | Independent | Nominal | 2.0803 | 2.8858 | 1.4985 |
| Relative samples absent from 5 to 10 s | Joint | Nominal | 0.1370 | 0.0408 | 0.1354 |
| Relative samples absent from 5 to 10 s | Independent | Nominal | 2.0803 | 2.8858 | 1.4985 |
| No absolute fixes | Joint | Shared offset | 3.9038 | 0.1007 | 3.9035 |
| No absolute fixes | Independent | Shared offset | 4.1921 | 3.0571 | 3.9035 |
| A1 absolute fixes start at 10 s | Joint | Shared offset | 0.1377 | 0.0407 | 0.1362 |
| A1 absolute fixes start at 10 s | Independent | Shared offset | 3.4238 | 4.7954 | 2.4441 |

With regular A1 fixes, relative observations couple the position errors and
let A1's fix correct A2 through the joint gain. The independent baseline omits
those observations, leaving A2 to integrate its own noisy displacement.

Without absolute fixes, the joint filter reduces relative error while the
center is identical between methods in this symmetric setup. At 20 s its
reported center RMS radius is **1.0733 m** for both. The covariance increases
as `(0.32 + 0.0032 k) I2` after `k` predictions: the relative observation supplies
no new information about a common translation.

Adding the shared `[2, −1.5] m` prior error changes neither the relative
residuals nor covariance in the unanchored case. It translates both estimates
exactly, increasing the center error in this realization. Its unchanged
ellipses describe a deliberately incorrect prior; they do not establish
accuracy. After A1 fixes return at 10 s, the joint filter can correct both
positions. The independent A2 estimate retains the unobserved offset.

The two restored schedules end near the regular-fix result after ten seconds
of recovery. This does **not** mean the outage had no effect: the time histories
show increased uncertainty during the missing observations. The anchor-restored
case uses 11 absolute fixes, at 10 through 20 s inclusive. Relative outage omits
five samples, at 5 through 9 s, leaving 15 applied relative observations in the
joint filter. Missing packets are never replayed.

## Paired ensembles

For each schedule, seeds **1–200** use nominal priors and matched inputs for both
methods: **1,600 method runs** in total. Each value below is the square root of
the mean squared endpoint error across seeds, rather than the mean of per-seed
RMSE values. Shared-offset cases are excluded from calibration statistics.

| Schedule | Method | Position RMS (m) | Relative RMS (m) | Center RMS (m) | Mean NEES |
| --- | --- | ---: | ---: | ---: | ---: |
| anchored | Joint | 0.2069 | 0.1865 | 0.1847 | 4.0379 |
| anchored | Independent | 1.0770 | 1.5040 | 0.7709 | 3.9799 |
| unanchored | Joint | 1.0813 | 0.1927 | 1.0770 | 4.2100 |
| unanchored | Independent | 1.5111 | 2.1198 | 1.0770 | 3.9640 |
| anchor-restored | Joint | 0.2069 | 0.1865 | 0.1847 | 4.0384 |
| anchor-restored | Independent | 1.0770 | 1.5040 | 0.7709 | 3.9799 |
| relative-outage | Joint | 0.2069 | 0.1865 | 0.1847 | 4.0391 |
| relative-outage | Independent | 1.0770 | 1.5040 | 0.7709 | 3.9799 |

In the anchored ensemble, the joint endpoint position error is lower in
**195/200** paired seeds. It is higher for seeds **20, 25, 37, 50 and 170**.
These counterexamples can be reproduced with the page's seed control and both
methods at 20 s. Expected improvement from added information does not imply
every realized correction or seed has a smaller error.

For that ensemble, the paired mean reduction in squared position error is
**1.1170 m²**, with a standard error of **0.0692 m²** over the 200 pairs. The
joint filter reports a position RMS radius of **0.2124 m**, compared with the
measured ensemble RMS of **0.2069 m**. The four-dimensional endpoint NEES has
nominal expectation 4. Its measured mean is **4.0379**, versus **3.9799** for
the independent baseline. Pooled applied-update NIS means are **2.0105** for
joint relative updates and **1.9602** for joint A1 fixes, with nominal expectation
2; independent A1 fixes give **1.9756**. Unused observations have no applied NIS.
These are finite-sample consistency checks of the declared noise model, not
validation of a real sensor or proof of confidence coverage.

The unanchored ensemble has the **same center RMS error, 1.0770 m**, for both
methods, despite a large reduction in relative error. This distinguishes
knowing the team shape from knowing the team's world position.

## Verification

Executed using Node.js **22.22.1**, npm **10.9.4** and the installed
Playwright/Chromium browser on 2026-09-14:

- `npm test`: **137/137** passed, including 16 new model tests for joint
  corrections, covariance, matched inputs, information boundaries, availability,
  unobservable translation, calibration ensembles and terminal behavior.
- `npm run test:e2e`: **73/73** passed across all eleven workshops. The eight
  focused cooperative tests also passed again after the event-log copy fix: cross-covariance and indirect A2
  correction, independent baseline, shared shift, restored anchor, relative
  outage, deterministic reset/playback, isolated comparisons, camera/view
  invariance, mobile navigation and WebGL fallback.
- `npm run build`: all **eleven** HTML entries built. The existing optional
  Three.js chunk advisory remains (736.58 kB minified, 186.86 kB gzip). No new
  dependency was installed or selected.
- The JSON exporter completed with 12 reference cases and four 200-pair
  ensembles, with a recorded hash of the actual model source.

An independent numerical audit compared 16 complete trajectories against a
linear Gaussian information-form oracle and a **324-variable batch posterior**
over 81 time boundaries. Worst batch endpoint differences were below
**5.3 × 10⁻¹³** for the mean and **5.8 × 10⁻¹⁴** for covariance. It also checked
100 general coupled updates with non-diagonal covariance/noise matrices,
translation invariance, input isolation and covariance ordering between methods.
A separate 1,000-pair audit for each schedule (8,000 method runs) found mean
endpoint NEES between 3.882 and 4.002 and applied-update NIS between 1.968 and
1.994. These additional audits check the mathematical implementation; the
public exporter uses the explicitly recorded 200-pair ensembles above.

Production-preview checks passed all eleven routes and their navigation,
reference/ensemble copies, indirect corrections, anchor restoration, view/camera
controls, 390 px layout and back navigation, with no page/console errors or
failed HTTP responses. Desktop whole-yard, drone close-up, 2D map, covariance
inspection and mobile captures were visually reviewed. Software WebGL checks
do not establish hardware GPU performance. The **108** local public Markdown
links resolve; source-hash, whitespace and private-content checks passed.

The model is a centralized, linear position reference with a supplied shared
orientation and robot identities. It is not distributed estimation, nonlinear
range/bearing localization, SLAM or a flight controller. The volumetric drones
remain at a fixed display altitude; neither rendering mode changes the run.
Completing the observation budget is not a mission-success result.
