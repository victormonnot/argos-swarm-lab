# Three-drone mission in one Gazebo world: recorded results

The [specification](23-shared-world-mission.md) defines the mission controller,
shared physics, evidence boundaries and contact coverage. The page at
`/shared-world/` observes three actual ArduCopter instances connected to one
Gazebo Harmonic world. It retains central nearest-pair greedy allocation and
reactive Behavior Trees from [mission recovery](22-mission-recovery.md).

## Reproduce and inspect

```sh
npm run dev
npm run compare:shared-world
npm run record:shared-world
npm run compare:shared-world -- local/ardupilot-shared-world.json
```

The [bundled trace](../results/ardupilot-shared-world.json) compares nominal
execution with a controlled A1 withdrawal. The browser replays the received
recording; it does not start another physics simulation. Docker is needed only
to record a new run, which can then be imported.

Switch between **World**, **Estimates** and **Both**. The solid world poses and
baseline-aligned estimates retain one host receipt-time cursor. The simulator
clock has its own origin and rate. Follow task locking, confirmed landing,
release and a new attempt while inspecting the corresponding Behavior Tree.

## Runtime and evaluator boundary

Three Iris X-frame vehicles share one Gazebo/DART scene. Each vehicle has its
own ArduCopter process, system ID, MAVLink route and JSON bridge port. Actual
world geometry includes a ground plane and three collidable storage buildings;
the six supplied visit-and-hold targets lie in the open yard. There is no camera
inspection, online planner, traffic reservation or collision avoidance policy.

The controller receives MAVLink estimates, supplied tasks and an explicit
withdrawal input. Gazebo poses and contacts are evaluator-only observations.
The observer captures all three IMU-link poses in one physics update. Displayed
pair distances are therefore simultaneous world center distances; their sampled
minimum is not a swept hull-clearance guarantee.

Contact evidence monitors all 31 collision shapes. Per-category counters count
observed physics updates containing at least one contact of that category.
Cumulative collision-pair histories retain brief contacts between published
pose snapshots. Ground contact is reported separately from inter-vehicle,
building and other contacts. Coverage begins at the recorded observer-readiness
time, which precedes the browser trace; initial ground contacts remain included.

The overlay registers each vehicle's first received local NED baseline with its
first received world pose. Subsequent estimate/world differences include the
age difference between independently received streams. They are not synchronized
EKF error measurements. World observations do not complete a mission task or
release its owner.

## Measured observations

Recorded on **2026-09-22** with ArduCopter **4.7.1** (firmware revision
`dbe792162d06cab66c3475fd5556bf7a120f119e`), Gazebo **8.15.0**, pymavlink
**2.4.49** and Python **3.10.12** on Linux amd64. The bundled JSON is
16,580,464 bytes; SHA-256:
`2cbdfdf66c419bca14f648767ef8654f894232a9a4ccce99c1737987ac6f8083`.
Runtime metadata retains binary, source, image, generated-model and parameter
fingerprints. `compare:shared-world` checks the recorder and shared helper hashes
against the local source. These are consistency checks, not producer authentication.

| Measurement | Nominal | A1 withdrawal |
| --- | ---: | ---: |
| Completed visits | 6 / 6 | 6 / 6 |
| Final landed/disarmed vehicles | 3 / 3 | 3 / 3 |
| Mission duration, host receipt clock | 10.235 s | 29.048 s |
| Sixth-task completion, host cursor | 23.863 s | 42.955 s |
| Final fleet landing, host cursor | 43.194 s | 64.028 s |
| Minimum sampled center separation, whole recording | 5.943 m | 4.431 m |
| Pair at the minimum | A2–A3 | A1–A2 |
| World snapshots, all three bodies per sample | 745 | 1,112 |
| Maximum world receipt gap | 112.088 ms | 130.723 ms |
| Maximum world simulation-time gap | 50 ms | 50 ms |
| Observed simulation/host duration ratio, recorded window | 0.844 | 0.855 |
| Physics updates with ground contact | 50,062 | 72,859 |
| Updates with vehicle / obstacle / other contact | 0 / 0 / 0 | 0 / 0 / 0 |

The nominal minimum occurs at host cursor **37.792 s** / simulation time
**76.349 s**; the withdrawal minimum at **62.543 s** / **97.649 s**.
Both occur during landing cleanup, after the sixth visit. The minimum covers
the complete world recording, including takeoff and landing, and measures
IMU-link origins rather than body-surface clearance.

In the withdrawal run, A1's T4 attempt P4 is cancelled at **19.687 s**.
Its reservation stays locked until confirmed landing permits release at
**37.579 s**. A2 receives a distinct attempt P7, sends its new target at
**37.681 s**, and completes T4 at **42.955 s** after its own arrival and dwell.
The nominal and withdrawal mission durations differ by **18.813 s** in this pair.
This comparison measures the declared controlled-retirement policy.

Each run records 12 distinct ground collision pairs, corresponding to the four
legs of each vehicle. Contact coverage starts at **0.001 s simulation time**;
there are **80,449 / 98,799 observed physics updates** by the last published
sample. The earliest browser snapshots already include ground-contact history
from setup. Zero non-ground contacts is therefore an observation within this
coverage, not a value inferred from task success or large displayed separation.

A fresh sequential repeat completed both cases with **6/6 visits and 3/3
landed vehicles** again. Host mission durations were **10.251 / 28.880 s**;
sampled whole-recording minima were **5.907 / 4.392 m**, with zero non-ground
contact updates. The repeat uses the same frozen sources and runtime image.
Four successful runs demonstrate these executions; they are not a statistical
robustness campaign. The repeat is not included in the bundled trace.

## Setup and resource observations

A preparation attempt with an 80 s estimator-readiness deadline timed out for
three JSON autopilots in the shared world before mission execution. The recorder
allows **200 s** for readiness; the bundled runs took **93.423 / 92.785 s**. It
retains normal arming checks and the original task/freshness gates. Requested telemetry intervals are
three times faster in simulation time than the built-in-physics helper, because
the shared simulator progresses more slowly than the host clock. Maximum
recorded LOCAL_POSITION_NED receipt gaps were **79.799 / 96.538 ms**, within
the 300 ms task-evidence gap gate.

The simulation/host ratios above measure the recorded window after setup.
They do not describe startup speed or guarantee real-time operation on another
machine. Mission budgets and dwell use host receipt time; Gazebo integration and
contact coverage use simulation time.

Observed process VmRSS snapshots span **220,508–221,256 KiB** for the actual
Gazebo server and **5,740–5,972 KiB per autopilot**. These are process snapshots,
not container totals, peak measurements or browser memory requirements. The
derived Docker image occupied **2,106,316,287 bytes** and shares its Gazebo parent
layers.

## Completed checks

The recorder completed both bundled scenarios and independently validated the
received evidence before atomically replacing the output. An interruption check
observed a live owned container and autopilot, sent SIGINT, received exit status
130, retained the previous output, and verified container and temporary-file
cleanup. Runtime helper unit checks passed **44 tests** (9 SITL, 11 fleet,
13 recovery and 11 shared-world).

- `npm test`: **374/374 passed**, including 14 shared-world checks and all prior
  mathematical, protocol and replay tests. New checks cover simultaneous
  geometry, evidence-time minima, contact coverage, adverse contact acceptance,
  baseline alignment, rewind and inconsistent import rejection.
- `npm run compare:shared-world`: both cases validated and recorded source
  fingerprints match. The sequential repeat also passed the full importer.
- `npm run build`: **23 entries built**. The shared-world entry is about
  **15.083 MB minified / 2.184 MB gzip**, including its actual trace. Vite reports
  a large-chunk warning; the bundle-size limit remains visible rather than hidden.
- Production preview in Chromium **153.0.8010.12**: **1440 × 1000** desktop and
  **390 × 844** mobile, both views, three pose layers, four cameras and all
  23 routes passed. Ten screenshots were captured; scene, follow-camera,
  linked-map and tree-halt screenshots were visually inspected. The smoke check
  recorded no page, console, request or HTTP errors, and no horizontal mobile
  overflow. A1's descent screenshot corresponds to **0.996 m actual world
  height**, with its task still locked.

- `npm run test:e2e`: **182/182 passed** in 3.5 minutes, including all 11 new
  shared-world interactions and prior workshops. The suite also verifies malformed
  imports, plain-text labels, pause/scrub, keyboard/mobile operation and WebGL
  fallback without changing recorded state.
- The original recovery recording still passes its unchanged contract.

## Limits

The static site and targets are supplied. Both scenarios use an intentionally
open layout; a successful trace does not establish obstacle avoidance, safe
passage scheduling or robustness to arbitrary route crossings. Shared rigid-body
physics does not imply a modeled shared rotor-wake or radio environment.

Withdrawal is a commanded retirement with continuing telemetry. This workshop
does not model process death, vehicle damage, communication cuts or GPS
observation loss. It provides recorded replay; live mission editing and a general
robustness test bench are not implemented. The nominal/withdrawal pair and
functional repeat do not establish a statistical success rate under faults.
See the [current integration limits](../learning-path.md#current-integration-limits).
