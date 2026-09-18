# Lesson 21 — Two vehicles, one allocation and addressed execution

**Question:** can the coordinator keep task ownership, outgoing requests and
received completion evidence associated with the correct vehicle?

**Implementation status:** `/fleet/` replays recorded nominal and misaddressed
missions with two concurrent ArduCopter processes per case. The bundled recording
and an independent repeat both show the intended comparison: 2/2 versus 1/2
tasks completed, with 2/2 vehicles subsequently landed in both cases. See the
[recorded results](21-two-vehicle-mission-results.md) for measurements, runtime
fingerprints and completed checks.

The experiment uses **nearest-pair greedy assignment** under one **central
coordinator**, followed by **MAVLink Guided position control** on two actual
ArduCopter SITL processes. One comparison changes the destination system ID in
one position setpoint. Both vehicles can finish landing even when one inspection
task remains incomplete.

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Allocation algorithm | Deterministic nearest-pair greedy, horizontal distance | Choose the closest remaining vehicle/task pair, remove both, then choose the next pair. |
| Decision architecture | One central allocator and observer | Both vehicles report to the same coordinator. Two autopilot processes do not make allocation decentralized. |
| Execution | Guided mode, normal arm, takeoff, one position setpoint, LAND | The autopilots execute flight control; the coordinator assigns work and evaluates received evidence. |
| Update timing | Asynchronous telemetry; one recorded allocation snapshot | Each vehicle supplies its latest available estimate. A shared recorder clock orders observations without synchronizing the autopilot clocks. |
| Communication | Two separate container-local TCP connections carrying MAVLink 2 | Connection selection and the message's destination identity are different parts of dispatch. |
| Topology | Coordinator ↔ A1 and coordinator ↔ A2 | There is no intervehicle forwarder, multicast network or peer allocation exchange. |
| Agent and coordinator inputs | Own autopilot estimates; known task locations and declared coordinate registration | The allocator uses received positions, not independent world truth. |
| Fidelity | Two simultaneous built-in SITL quadrotor simulations | Each has flight dynamics and an estimator. They do not share collision or aerodynamic physics. |

This reuses the explicit greedy baseline from
[workshop 3](03-mission-allocation.md). It does not compare allocation algorithms
or claim that greedy assignment is optimal. The changed condition is one
addressed message after allocation.

## Two identities and two routes

The same pinned ArduCopter **4.7.1** binary used by
[workshop 18](18-sitl-mavlink.md) runs twice, with model `+`, speedup one, fresh
working directories and normal arming checks.

| Vehicle label | MAVLink system / component | SITL instance | Coordinator TCP destination | Declared pad / ENU m |
| --- | --- | --- | --- | --- |
| A1 | 1 / 1 | 0 | `127.0.0.1:5760` | `[-4, 0, 0]` |
| A2 | 2 / 1 | 1 | `127.0.0.1:5770` | `[4, 0, 0]` |

The coordinator uses source **255 / 190** on each connection. Every stored
vehicle report retains its source system/component and route association;
requests retain the selected route and destination fields. A matching numeric
command ID is insufficient to associate an acknowledgement from another vehicle.

The instance number, system ID and home location have different jobs:

- `--instance 0` or `--instance 1` separates the default port groups. The pinned
  runtime adds ten times the instance number to its default base and simulation
  ports. With `--serial0 tcp:0`, serial zero uses that instance's base port.
- `--sysid 1` or `--sysid 2` sets **`MAV_SYSID`**, the MAVLink vehicle identity.
  A separate port alone does not assign a different system ID.
- `--home` supplies latitude, longitude, altitude and initial heading. The homes
  are placed four meters west/east of the declared yard center using a small-area
  geographic conversion; the recorder retains their actual configured values.
  Instance numbers do not create this spatial offset automatically.

Both processes remain alive together during setup, flight and the mission
observation. Process identities, overlapping lifetimes and sampled resident
memory provide bounded runtime evidence. A memory snapshot is not peak memory,
and two operating processes do not establish support for a larger fleet.

## One shared display, two local estimator frames

`MAV_FRAME_LOCAL_NED` positions are relative to each vehicle's **EKF origin**:
north, east and down. Two reports with identical NED coordinates are not evidence
that two vehicles occupy the same geographic point. Each vehicle also has its
own home reference for relative altitude.

The experiment declares a fixed registration for its small teaching yard. Let
`o_i = [n0, e0, d0]` be vehicle `i`'s recorded initial local-position sample,
`b_i` its declared pad in common east/north/up coordinates, and
`p_i = [n, e, d]` a later received local-position estimate. Then:

```text
display_ENU_i = b_i + [e − e0, n − n0, −(d − d0)]

target_NED_i = [n0 + task_N − pad_N,
                e0 + task_E − pad_E,
                d0 − (task_U − pad_U)]
```

The initial sample establishes an experiment baseline; it is not a measurement
of the EKF origin's global coordinates. The declared pad registration is supplied
to the coordinator and the display. It is not learned through cooperative
localization, derived from simulator truth or continuously corrected from GPS.
Common ENU is therefore a useful registered view of received estimates, not an
independent guarantee of physical separation.

The two homes share the declared altitude and north/east directions over a small
yard. Takeoff still requests **four meters above each vehicle's home**. Task
height is **four meters above its registered initial local sample**; these are
different reference definitions, even when their numerical values are close.

## Tasks and one recorded assignment

| Task | Common ENU target / m | Completion meaning |
| --- | --- | --- |
| T1 | `[-4, 6, 4]` | Reach and hold the first inspection position. |
| T2 | `[4, 8, 4]` | Reach and hold the second inspection position. |

An inspection is a **visit-and-hold task**, not camera acquisition or object
recognition. Each task has one owner and each vehicle receives one task. The
targets and pad positions form two separated northward lanes. This geometry
keeps the demonstration simple; it supplies no obstacle avoidance, intervehicle
collision detection or collision-avoidance controller.

After both takeoffs satisfy the settling criterion, the coordinator records one
allocation time and the latest received local-position sample for each vehicle.
Each input must be at most **500 ms** old at that decision time.
Transform those two samples with the declared registration. For vehicle `i` and
task `j`, the cost in meters is:

```text
c_ij = sqrt((vehicle_E_i − task_E_j)^2
          + (vehicle_N_i − task_N_j)^2)
```

Height does not enter this horizontal assignment cost. All tasks use the same
declared altitude; later execution is evaluated in three dimensions.

1. List every still-available vehicle/task pair with its cost.
2. Choose the smallest cost, using ascending vehicle ID then task ID for ties.
3. Assign that task, remove its vehicle and task, and repeat.

The recorded input positions, sample timestamps, selected pairs and selected
costs make the decision inspectable. The interface recomputes the full cost
matrix from that fixed snapshot. Allocation uses no future samples or knowledge of the
injected addressing error. Ownership remains fixed for this bounded mission;
there is no retry, reassignment or multi-stop route planning.

## One intentionally wrong destination

Both cases begin with fresh processes, the same tasks, the same policy and the
same flight criteria. The coordinator establishes telemetry, requests Guided,
arms normally and requests four-meter takeoff for each vehicle. It then sends
one position-only `SET_POSITION_TARGET_LOCAL_NED` per assignment, using frame
**1** and type mask **3576**.

| Dispatch condition | Nominal case | Misaddressed case |
| --- | --- | --- |
| A1 setpoint connection | A1 / TCP 5760 | A1 / TCP 5760 |
| A1 setpoint `target_system` | 1 | **2** |
| A1 setpoint `target_component` | 1 | 1 |
| A1 assigned target and conversion | Common T1 target converted through A1's recorded local baseline | Same target and conversion rule |
| A2 dispatch | A2 / TCP 5770, target 2 / 1 | Unchanged |
| Mission observation budget | 20 recorder host seconds | Same |
| Cleanup | Correctly addressed LAND to each vehicle | Same |

Only the destination system field changes in the affected setpoint. It is still
written to A1's connection. The coordinator does **not** transmit that setpoint
to A2's connection, and no forwarder connects the vehicles. A2 instead receives
its own correctly addressed task setpoint.

This describes the controlled intervention, not byte-identical recordings.
Each case starts fresh: local baselines, estimates, receipt times and vehicle
boot clocks can differ. The same supplied target can consequently produce
slightly different numeric NED payloads through the same conversion rule.

In the pinned ArduPilot receive path, MAVLink routing decides whether a message
should be processed locally before the Guided setpoint handler runs. A nonzero
destination system ID different from the receiving vehicle's ID does not match
for local handling. The expected effect here is that A1 does not execute the
misaddressed target while A2 continues its own assignment.

`SET_POSITION_TARGET_LOCAL_NED` is a setpoint message, not a `COMMAND_LONG`
request with a `COMMAND_ACK` response. Neither successful setpoint execution nor
this addressing failure has a command acknowledgement to invent. The outgoing
envelope establishes what the coordinator sent; flight telemetry establishes
what was observed afterward. The recording does not include an instrumented
onboard packet-rejection event or a separate wire capture.

Consequently, the explanation of why the target is not executed combines the
declared isolated routes, exact envelope and verified source behavior. Lack of
motion alone would not prove that a particular packet was rejected internally.

## Completion and the bounded failure

The mission interval starts just before the two sequential setpoint sends. Its
exact cutoff is that recorded start plus **20,000 ms**. The recorder can close
the observation on a slightly later update, but samples after the exact cutoff
cannot complete a task. Correctly addressed LAND requests follow actual closure.

The controller and observer keep receiving both vehicles during the twenty-second
mission interval. Each vehicle's independent sample stream contributes only to
its own assigned task. A response from A2 cannot complete A1's task.

For a task, use the assigned vehicle's received `LOCAL_POSITION_NED` position
and velocity after its setpoint was sent. A qualifying sample must satisfy:

```text
3D distance to assigned target ≤ 0.5 m
3D speed ≤ 0.4 m/s
```

Qualifying **new samples** must sustain the condition for **1,000 ms of recorder
receipt time**. A gap above **300 ms** or a failing sample resets the dwell.
Replaying or repeatedly inspecting one held sample cannot advance completion.
Only evidence inside the declared mission window counts toward the task result.

The nominal recording completes **2/2 tasks**. The misaddressed comparison
completes **1/2 tasks**, with the assigned A1 target uncompleted at the deadline.
An independent repeat preserves that contrast. These are acceptance criteria
for the bounded comparison; a fresh execution must report its measured result
instead of substituting expected outcomes.

After the fixed mission interval, the coordinator correctly addresses LAND to
**both** vehicles and continues collecting their individual evidence. Landing
requires prior airborne evidence, followed by fresh on-ground and disarmed
reports after the relevant LAND request. Vehicle heartbeat and landed-state
reports must each be at most **1,500 ms** old. An accepted LAND command or a low
position estimate alone does not establish completion.

Report these outcomes separately:

- **Mission:** completed task count and whether both assigned inspections met
  their criteria within the budget.
- **Flight cleanup:** each vehicle's LAND request, acknowledgement and measured
  landing/disarming evidence.

Landing both vehicles must not turn an incomplete mission into a successful one.
An unexpected process exit, missing telemetry or cleanup timeout is also distinct
from the intended demonstration of an incomplete inspection task.

## Clocks, rendering and recorded evidence

All sends and receipts use one recorder-relative monotonic timeline. Each
vehicle's boot timestamps retain their own meaning; do not compare A1's boot
time directly with A2's or subtract either from host receipt time to infer delay.
The twenty-second budget uses host time. Speedup one does not prove exact
alignment of either simulated clock with every host interval.

The browser replays both streams on one cursor. It holds each vehicle's latest
received position, attitude, mode and landing-state sample independently. There
is no interpolation across future samples or second simulation inside a view.
The 2D diagram and detailed 3D drones observe the same registered estimates,
assignments and completed-task evidence.

The common yard, pads and inspection markers explain the declared geometry.
They add no shared collision world, camera sensing, communication range or
simulator truth. Do not interpret visual clearance as a measured safety margin.

The replay should expose the cost matrix, owners, per-vehicle routes and system
IDs, exact setpoint envelopes, current sample ages, target distance, task dwell,
task outcome and later cleanup. End-of-record comparison results must be labeled
separately from observations available at the current cursor.

## Recorder and verification boundary

The recorder is `fleet/record.py`, launched through:

```sh
npm run record:fleet
npm run compare:fleet -- local/ardupilot-fleet.json
```

It reuses the pinned SITL image and owns the two simulated processes in each
case. Recording runs inside an isolated container without an external vehicle
endpoint or published control port. The first image build may download verified
dependencies. The bundled artifact is
[`docs/results/ardupilot-fleet.json`](../results/ardupilot-fleet.json).

Verification must cover exclusive deterministic assignment, frame conversion,
vehicle-specific source/ACK matching, no invented setpoint ACK, independent
sample holding, dwell/deadline boundaries, both process lifetimes and cleanup.
Import validation must reject cross-vehicle evidence, wrong route/identity
claims, inconsistent assignment costs, completion without fresh task samples
and a successful mission label that contradicts the recorded work.

The [results document](21-two-vehicle-mission-results.md) distinguishes actual
captures, repeated execution, resource observations and completed checks. Source
fingerprints and import validation establish consistency; they do not
authenticate an arbitrary imported producer.

## Primary references

- ArduPilot's [Using SITL](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html)
  explains multiple vehicles, unique system IDs, explicit spawn offsets and
  separate connections. This experiment directly launches two binaries rather
  than using its MAVProxy/swarm launcher examples.
- The pinned [SITL command-line parser](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/AP_HAL_SITL/SITL_cmdline.cpp)
  and [UART implementation](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/AP_HAL_SITL/UARTDriver.cpp)
  define instance port offsets, `--sysid`, home arguments and TCP port selection.
- ArduPilot's [Guided movement commands](https://ardupilot.org/dev/docs/copter-commands-in-guided-mode.html)
  describes local NED position targets, their EKF-origin reference and position
  mask. The pinned [Copter receive handlers](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/GCS_MAVLink_Copter.cpp)
  show Guided-mode checks and position-target handling.
- The pinned [common receive path](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/GCS_MAVLink/GCS_Common.cpp)
  and [MAVLink routing implementation](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/GCS_MAVLink/MAVLink_routing.cpp)
  establish destination filtering before local message execution.
- The [MAVLink routing guide](https://mavlink.io/en/guide/routing.html),
  [setpoint definition](https://mavlink.io/en/messages/common.html#SET_POSITION_TARGET_LOCAL_NED)
  and [command protocol](https://mavlink.io/en/services/command.html) distinguish
  system/component addressing, message routing and command acknowledgements.

This experiment establishes a small addressed mission contract with two actual
autopilot processes. It does not establish distributed allocation, common-map
localization, intervehicle collision safety, arbitrary fleet size or hardware
deployment readiness.
