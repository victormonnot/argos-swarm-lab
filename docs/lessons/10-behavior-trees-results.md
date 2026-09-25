# Behavior Trees and FSM — reference results

Measured on **2026-09-14** with the deterministic model described in the
[lesson specification](10-behavior-trees.md). The
[JSON record](../results/behavior.json) contains exact configuration, source
hash, checkout revision, runtime, case summaries and events. Generate it with
`npm run --silent compare:behavior > docs/results/behavior.json`.

## Reference cases

All methods use one drone, the same 3 m takeoff, 6 m outward flight, 3 s
inspection, return and landing, 1.5 m/s movement, 0.25 s command intervals and
a 30 s limit. Times below are simulated termination times, not runtime.

| Event | Executor | Outcome | Time (s) | Control ticks | Distance (m) | Hold ignored (s) | Inspection discarded (s) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| None | Reactive BT | Completed | 15 | 61 | 18 | 0 | 0 |
| None | Guarded FSM | Completed | 15 | 61 | 18 | 0 | 0 |
| None | Memory-root BT | Completed | 15 | 61 | 18 | 0 | 0 |
| Hold 7–10 s | Reactive BT | Completed | 19 | 77 | 18 | 0 | 1 |
| Hold 7–10 s | Guarded FSM | Completed | 19 | 77 | 18 | 0 | 1 |
| Hold 7–10 s | Memory-root BT | Completed | 15 | 61 | 18 | 3 | 0 |
| Hold from 7 s | Reactive BT | Timed out | 30 | 120 | 9 | 0 | 1 |
| Hold from 7 s | Guarded FSM | Timed out | 30 | 120 | 9 | 0 | 1 |
| Hold from 7 s | Memory-root BT | Completed | 15 | 61 | 18 | 8 | 0 |
| Sensor failure at 7 s | Reactive BT | Aborted | 13 | 53 | 18 | 0 | 1 |
| Sensor failure at 7 s | Guarded FSM | Aborted | 13 | 53 | 18 | 0 | 1 |
| Sensor failure at 7 s | Memory-root BT | Aborted | 13 | 53 | 18 | 0 | 1 |

The reactive BT and FSM have identical physical trajectories and inspection
progress in each matched scenario. Both honor the temporary hold immediately
when it is sampled at 7 s. One second of inspection is discarded; after three
seconds holding, the inspection restarts and mission completion moves from
15 to 19 s. They each record one hold interruption. With persistent hold, they
stay at `(6, 0, 3)` until the time limit.

The memory-root BT retains its running mission child and skips the preceding
hold branch. Completing sooner reflects **ignoring the request**, not performing
the same policy more efficiently. Hold-ignored time includes any motion or
inspection while the request is true, and counts only until termination: 3 s
for temporary hold and 8 s for persistent hold. The controller does not continue
being evaluated after it finishes at 15 s.

In the sensor-failure case, Inspect returns Failure at 7 s. All methods discard
one second of unusable partial inspection and take six seconds to return and
land. No hold interruption is counted. The recovery subtree can return Success
while the run remains **aborted**: its return/landing objective succeeded, but
the inspection did not.

## Timing and interpretation

A command tick selects one Running action, then integrates one interval. Action
completion is observed by the next tick, which can traverse already successful
actions and select the next action without spending another interval on them.
The final control tick only observes terminal success and advances no time.
Consequently a nominal run has 60 motion/service intervals and 61 control ticks.
The timeout ends after its 120th interval without an additional terminal tick.

At the displayed boundary `t = 7 s`, the latest interval used the sample from
`6.75 s`; stepping once samples the event at 7 s before applying the next action.
The page labels sampled observations separately from the post-interval position.

These results concern the explicit fallback placement and cancellation contract.
They do not rank all Behavior Trees against all FSMs. No stochastic confidence
interval or wall-clock performance claim is inferred from these deterministic
cases. Exact inputs, instant hold response, kinematic stopping and reliable
action-completion records are assumptions.

## Verification

Executed with Node.js **22.22.1**, npm **10.9.4** and the repository’s installed
Playwright/Chromium browser on 2026-09-14:

- `npm test`: **121/121** tests passed, including 17 execution-model checks.
  These cover real altitude, one integration per tick, matched BT/FSM histories,
  cancellation, reset, Failure/recovery, terminal observation and memory guards.
- `npm run test:e2e`: **65/65** tests passed, including seven new browser checks
  for sampled event boundaries, tree/FSM inspection, hold violations, recovery,
  isolated comparisons, reset, playback, view/camera invariance, keyboard input,
  mobile navigation, context loss and unavailable WebGL.
- `npm run build`: all **ten** HTML entries built. Vite retains the existing
  advisory for the shared optional Three.js chunk (736.58 kB minified,
  186.86 kB gzip).
- The JSON exporter ran successfully. Its 12 saved summaries, source hash,
  revision and configuration were checked against the current model.

An independent audit matched all 12 numerical cases to phase-distance/time
arithmetic. It also compared entire reactive-BT/FSM histories over **1,220 paired
hold/failure schedules**, checking speed and altitude bounds, stationary holding,
inspection progress, unique action completions, recovery to home and terminal
immutability. These additional schedules probe lifecycle behavior; they are not
extra public scenario controls or physical-safety validation.

Production-preview checks passed all ten routes and their navigation, the new
execution controls and reference comparisons, camera framing, 390 px layout and
back navigation without page errors or failed HTTP responses. Desktop, tree
inspection, whole-yard 3D, drone close-up and mobile captures were visually
reviewed. Browser WebGL checks use software rendering and do not measure GPU
performance.
