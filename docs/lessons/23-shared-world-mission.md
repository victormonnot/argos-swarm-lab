# Lesson 23 — Three-drone mission in a shared Gazebo world

**Question:** does the three-drone recovery policy still complete its mission
when all vehicles move in one physical world, and what evidence describes their
separation and contacts?

**Implementation status:** implemented with an actual nominal/withdrawal
[recording](../results/ardupilot-shared-world.json), an optional Docker recorder
and linked 2D/3D replay. See the [results](23-shared-world-mission-results.md)
for measured outcomes and completed checks.

This experiment combines **central online nearest-pair greedy allocation**,
**reactive Behavior Trees (BTs)** and three **ArduCopter SITL** autopilots with
one **Gazebo Harmonic / DART** world. It brings the external-physics integration
from [workshop 19](19-gazebo-physics.md) together with the six-task mission and
controlled withdrawal from [workshop 22](22-mission-recovery.md).

The bounded addition is a common physical environment and independent world
observations. The allocation algorithm and executor policy remain recognizable:
finish six known visit-and-hold tasks, or retain an interrupted reservation until
the withdrawing vehicle has demonstrably landed and disarmed.

## Method profile

| Aspect | Specified choice | Meaning |
| --- | --- | --- |
| Allocation algorithm | Central online nearest-pair greedy | Repeatedly select the closest eligible vehicle/task pair using received horizontal position estimates. |
| Execution policy | One reactive priority BT per vehicle in the coordinator | Recheck withdrawal before normal task execution; halt the interrupted attempt before requesting LAND. |
| Flight stack | Three separately identified ArduCopter 4.7.1 SITL processes | Each autopilot estimates its state and controls its own simulated vehicle. |
| Physics | One Gazebo Harmonic world using DART | The vehicles and declared collision geometry occupy the same simulation rather than three independently registered worlds. |
| Connection | Official ArduPilot Gazebo JSON plugin plus per-vehicle MAVLink routes | The simulator exchanges motor/sensor data with each autopilot; the coordinator sends addressed requests and receives telemetry. |
| Controller information | Own-vehicle telemetry, supplied mission geometry and current withdrawal input | World truth does not enter greedy allocation, dwell completion or the BT. |
| Evaluator information | Synchronized world poses, separation and declared contact observations | The replay can inspect physical outcomes that the coordinator does not directly observe. |
| Timing | Separate recorder receipt time, simulation time and autopilot boot time | These clocks must not be subtracted as though they measured network latency. |

Three flight processes do not make this a decentralized mission. The coordinator
still owns the task ledger and runs all three trees. Shared physics does not
automatically introduce collision avoidance, wake interactions or realistic
communication. Each such capability needs a declared mechanism and its own
verification.

## Mission contract

Compare two fresh runs with identical supplied task geometry, flight parameters,
allocation policy and success criteria:

1. **Nominal:** all three vehicles remain available until the six tasks finish.
2. **Controlled withdrawal:** after A1 begins its second task, the current
   withdrawal input halts that attempt and requests LAND. Its incomplete task
   remains reserved until fresh landing and disarming evidence permits release.
   An eligible remaining vehicle can then receive a new attempt.

Tasks are **visit-and-hold positions**. They are not camera inspections or mapped
discoveries. Known targets define clear direct legs through the open yard;
there is no perception-based obstacle discovery or onboard route planner.

The supplied mission pads are `[-6, 0, 0]`, `[0, 0, 0]` and `[6, 0, 0]` meters
in mission ENU. Tasks T1–T3 lie at east `[-6, 0, 6]`, north `6`, up `4`; tasks
T4–T6 use the same east coordinates at north `12`, up `4`. These mission up
coordinates are relative to the grounded registration, not absolute Gazebo
world heights. Each vehicle first settles after a four-meter takeoff above home.

The nearest-pair cost is horizontal Euclidean distance. Exact ties use ascending
vehicle ID, then task ID. Each dispatch creates a new attempt; a vehicle has at
most one active attempt. The coordinator nominally waits 100 ms between control
ticks. Assignment samples may be no more than 500 ms old. The 90,000 ms mission
budget uses recorder host time and begins after all three takeoffs settle.

The task ledger preserves unique attempt identities, exclusive ownership and
separate cancelled versus completed outcomes. Partial dwell from the cancelled
attempt cannot count toward its replacement. Waiting for A1's landing remains
the conservative release rule from workshop 22; it is not a general way to prove
that a disconnected robot has stopped.

Completion remains based on received own-vehicle telemetry. A command ACK proves
admission, not arrival. Position setpoints have no `COMMAND_ACK`; task completion
requires new position samples within 0.5 m of the target and three-dimensional
speed at most 0.4 m/s, continuously for one second of receipt time. A bad sample
or gap greater than 300 ms resets dwell. Repeated use of one held sample cannot
complete a task. Likewise, LAND admission, observed landing and mission task
completion are separate facts. Landing needs post-request on-ground and disarmed
reports, each at most 1,500 ms old, after earlier airborne evidence.

The withdrawal input is supplied on the first due control tick at least 500 ms
after A1's second task setpoint. It is a controlled retirement request, not a
detected crash, lost radio, depleted battery or GPS outage. The actual request,
halt, cancellation, LAND and release are recorded separately. The shared
[recovery specification](22-mission-recovery.md) defines the executable tree and
complete ownership/evidence contract retained here.

## Shared world and coordinate frames

The recorded world must contain all three actual vehicle models and the physical
site geometry displayed as collision-bearing obstacles. Decorative markings and
nonphysical graphics must remain distinguishable. Rendering three drones in one
scene, by itself, does not establish shared physics.

The world `argos_shared_yard` has a ground plane and three static box buildings:

| Building | Center ENU / m | Size east × north × up / m |
| --- | --- | --- |
| West store | `[-11, 8, 2.5]` | `4 × 10 × 5` |
| East store | `[11, 8, 3]` | `4 × 10 × 6` |
| North store | `[0, 18, 2]` | `10 × 4 × 4` |

The three Iris models start at the pad east/north coordinates with world up
`0.195 m`, facing north. The configured physics step is 1 ms; requesting a real
time factor of one does not prove that the host maintained that speed. The
separate JSON bridge endpoints must agree with their associated SITL instances.

Gazebo world coordinates use **east, north, up (ENU)**. MAVLink
`LOCAL_POSITION_NED` uses each autopilot's **north, east, down (NED)** estimator
origin. The supplied registration between mission coordinates and each local
origin is fixed for that run. World truth must not silently correct the local
estimate on every sample. Initial registration, vehicle model identity, instance,
MAVLink system/component identity and simulator endpoint must be inspectable.

World orientations use **x, y, z, w** quaternions with the declared body-frame
convention. Telemetry attitude must be converted from its NED/body convention
before drawing a comparable estimated vehicle. An apparent displacement between
held world and telemetry samples includes their receipt-time skew; it is not a
time-aligned localization-error estimate.

All simultaneous pair distances must come from a single world update:

```text
distance(i, j, t) = norm(world_position(i, t) - world_position(j, t))
sampled_minimum = min(distance(i, j, t)) over the declared samples and pairs
```

The measured positions belong to the specified reference link, not an arbitrary
visual mesh origin. A sampled center-to-center distance is not rotor-tip
clearance, continuous swept separation or proof that no contact occurred between
samples. Report its units, pair, simulation timestamp, receipt timestamp and
observation window.

The evaluator system requests Gazebo contact data for **31 collision shapes**:
nine per Iris (body, four landing legs and four rotors), the ground, and three
building boxes. The exact scoped shape names are stored once in the world
metadata. Each counted physics update deduplicates unordered pairs, including
reports of the same pair from both colliders. Contacts are classified as ground,
different vehicles, a vehicle and building, or other.

Category counters count **physics steps containing at least one contact of that
category**. They do not count impacts, contact points or episodes. Per-pair history
also keeps the number of steps, first simulation timestamp and latest timestamp.
Four landing feet touching the ground during one update contribute one ground
category step and four pair steps. The two totals need not be equal.

World pose packets arrive at a configured 20 Hz in simulation time. Cumulative
contact history is updated at every 1 ms physics step once the observer is ready,
so a contact can appear in history even if it begins and ends between pose
packets. `observerStartSimTimeMs` and `observerSteps` state that coverage; it may
begin before the recorder's receipt-time origin. The final history must contain
actual ground contact for every vehicle as positive evidence that collection
worked. Startup and landing ground contacts are retained and distinguished from
unexpected non-ground contact.

A quiet transport channel or a sparse sample with no active contacts does not
prove zero contacts throughout the run. The reported cumulative history ends at
the last received world packet; the UI must not extend it to a later cursor
without another observation. Contact geometry is the simulator's collision
model, not a guarantee about a physical aircraft.

## Observation and replay

The recorder maintains independent channels for coordinator decisions, MAVLink
messages and evaluator world observations. The common receipt-time cursor shows
only values already received; it must not use a later pose, future task outcome
or final contact count when rewound.

Three synchronized simulator connections can run more slowly than wall time.
The Gazebo-specific startup readiness budget is 200 seconds of host time. Before
the trace origin, telemetry interval requests are three times faster than the
original simulator-time rates: local/global position and attitude request
33,333 µs; heartbeat 333,333 µs; extended system state 66,666 µs; and startup
EKF/GPS/system-health messages 166,666 µs. These are requested intervals, not a
claim of the achieved receipt rate. The recording retains the settings and
actual packet times; mission freshness and completion thresholds are unchanged.

The linked 2D plan/elevation and volumetric 3D view observe the same recording.
Solid physical vehicle poses and optional registered estimate markers should be
visually distinct. Changing the selected vehicle, camera or view must preserve
the cursor and task state. The site must retain meaningful vehicle altitude and
physical building volume.

Useful inspection milestones include first dispatch, withdrawal, task lock,
landing-confirmed release, reassignment, sixth task completion and final fleet
landing. World observation timestamps, separation and contact scope must remain
visible alongside the task/BT evidence. Whole-run comparison metrics must be
labeled as such rather than presented as current-cursor knowledge.

## Success, limits and verification

Report separately:

- Unique tasks completed out of six and the task duration from mission start to
  the last qualifying completion sample.
- Cancelled attempt, retained reservation, confirmed landing, release and new
  owner, including timestamps for each boundary.
- Final landed/disarmed vehicles out of three.
- World observation coverage, sampled minimum separation and scoped contact
  observations over the declared window.
- Concurrent simulator/autopilot identities and measured resource snapshots.

A mission can complete its tasks while violating a physical constraint; a
vehicle can land safely with unfinished work. Neither outcome should be hidden
behind a single green status. A nominal/withdrawal pair and a functional repeat
are observations of those runs, not a statistical success probability.

Verification must exercise actual three-autopilot overlap in one world; unique
JSON and MAVLink routes; fixed coordinate registration; normal estimator and
arming settings; BT cancellation and task ownership; fresh per-attempt dwell;
world-pose isolation from controller decisions; synchronized pair distances;
contact-scope accounting; no future evidence on rewind; importer rejection of
forged relationships; and linked-view, import and keyboard/browser interactions.
The importer limits position components to ±1,000,000 m and velocity components
to ±10,000 m/s to keep derived metrics and graphics numerically representable.
These deliberately generous admission bounds do not establish physical validity
or flight safety.

The optional recorder is local and isolated. Browser playback uses the bundled
actual recording without requiring a simulator installation. Live supervision
and general fault-injection campaigns are not implemented.

## Primary references

- ArduPilot's [Gazebo integration guide](https://ardupilot.org/dev/docs/sitl-with-gazebo.html)
  describes the external simulator integration and multi-vehicle applications.
- The [official pinned ArduPilot Gazebo plugin](https://github.com/ArduPilot/ardupilot_gazebo/tree/082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5)
  supplies the Iris model and JSON connection used by the existing foundation.
- Gazebo's [Link API](https://gazebosim.org/api/sim/8/classgz_1_1sim_1_1Link.html)
  defines world pose and velocity observations, and the
  [Contact system API](https://gazebosim.org/api/sim/8/classgz_1_1sim_1_1systems_1_1Contact.html)
  describes the contact-sensor system.
- ArduPilot's [SITL guide](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html)
  documents separate vehicle instances and identities; its
  [Guided commands guide](https://ardupilot.org/dev/docs/copter-commands-in-guided-mode.html)
  defines the local position-target interface.
- Colledanchise and Ögren's [Behavior Trees in Robotics and AI](https://arxiv.org/abs/1709.00084)
  provides the control-flow background for the reactive trees.
- The [MAVLink command protocol](https://mavlink.io/en/services/command.html)
  separates acknowledgement from the requested action's physical completion.
