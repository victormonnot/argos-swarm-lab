# Lesson 22 — Three-drone mission recovery

**Question:** when one drone withdraws during a task, when can its remaining work
be assigned to another drone without counting the interrupted attempt as done?

**Implementation status:** implemented at `/recovery/` with recorded nominal and
withdrawal cases. The bundled runs both complete **6/6 tasks** and finish with
**3/3 vehicles landed**. The withdrawal case cancels A1's second attempt, retains
its task until landing confirmation and then assigns a new attempt to A2. See
the [recorded results](22-mission-recovery-results.md) for measured times, runtime
fingerprints and completed checks.

This experiment combines **online nearest-pair greedy allocation**, a **central
coordinator**, and **reactive Behavior Trees (BTs)** with three actual ArduCopter
SITL processes. It extends the addressed execution of
[workshop 21](21-two-vehicle-mission.md) and the interruptible execution policy of
[workshop 10](10-behavior-trees.md). Six known locations must each be visited and
held once. A nominal mission is compared with a controlled withdrawal of A1
while its second task is running.

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Allocation algorithm | Online nearest-pair greedy, horizontal Euclidean cost | Match currently idle, eligible vehicles with currently unowned unfinished tasks. Reevaluate when availability or ownership changes. |
| Decision architecture | One central coordinator | The coordinator owns the task ledger, uses received vehicle estimates and supplies each executor's assignment. Three flight processes do not make allocation decentralized. |
| Execution architecture | Reactive priority fallback with ordered reactive sequences and stateful actions | Recheck the withdrawal guard every control tick; interrupt running task execution when the higher-priority withdrawal branch becomes eligible. |
| Flight stack | ArduCopter 4.7.1, normal arming, Guided position targets and LAND | The BT issues requests; the autopilot's controller, estimator and built-in physics determine motion. |
| Communication | Three isolated local TCP connections carrying MAVLink 2 | Each vehicle has its own route, system identity, telemetry and command acknowledgements. There is no peer exchange or packet-loss intervention. |
| Agent and coordinator inputs | Received own-vehicle estimates, supplied task coordinates, fixed frame registration and a current withdrawal input | Neither allocation nor completion uses independent simulator truth or future telemetry. |
| Fidelity | Three concurrent independent SITL quadrotor worlds | The common 3D yard displays registered estimates; vehicles have no shared collision or aerodynamic interaction. |

The greedy algorithm makes a new matching over the eligible set, rather than
planning a multi-stop tour. A drone carries at most one active task. An idle drone
can wait while other tasks remain reserved; it must not mistake an empty ready
queue for completion of the whole mission. No claim of minimum travel distance,
minimum mission duration or optimal load balancing is made.

The three per-vehicle trees run in the coordinator process. They are not uploaded
as onboard ArduPilot programs. Each tree controls only its associated vehicle's
requests and reads its assignment and received telemetry; the autopilot runs the
flight controller and estimator.

## Mission and assignment contract

All six tasks are **visit-and-hold positions**, not camera inspections or mapping
measurements. The two cases use the same tasks, supplied pads, normal flight
checks, completion rule, allocation rule and mission budget. Each case starts
fresh processes. Actual estimates and receipt times need not be identical.

Each vehicle has a distinct system ID, component 1, SITL instance, process ID and
TCP destination. The coordinator uses source 255/190. Own local NED coordinates
are registered to supplied common ENU pads by the same explicit baseline rule as
workshop 21; this is not cooperative localization or a shared EKF origin.

| Vehicle | System / component | Instance | TCP port | Supplied pad ENU / m |
| --- | --- | --- | --- | --- |
| A1 | 1 / 1 | 0 | 5760 | `[-6, 0, 0]` |
| A2 | 2 / 1 | 1 | 5770 | `[0, 0, 0]` |
| A3 | 3 / 1 | 2 | 5780 | `[6, 0, 0]` |

| Task | ENU target / m | Task | ENU target / m |
| --- | --- | --- | --- |
| T1 | `[-6, 6, 4]` | T4 | `[-6, 12, 4]` |
| T2 | `[0, 6, 4]` | T5 | `[0, 12, 4]` |
| T3 | `[6, 6, 4]` | T6 | `[6, 12, 4]` |

All three vehicles first settle after a normal four-meter takeoff. The mission
starts at the next coordinator tick before the first allocation. Its exact
budget is **90,000 ms** of recorder host time. Position-only targets use local
NED frame **1**, mask **3576** and the correct destination for each isolated
route. A decision can only use a position sample at most **500 ms** old.

At an allocation decision, a vehicle must be eligible, have no current task and
have a sufficiently fresh received local-position estimate. For each available
vehicle `i` and unowned unfinished task `j`, compute:

```text
cost(i, j) = sqrt((vehicle_E(i) - task_E(j))²
               + (vehicle_N(i) - task_N(j))²)
```

Choose the lowest-cost pair, breaking exact ties by ascending vehicle ID then
task ID. Remove that vehicle and task from the current candidate set and repeat.
Record the candidate positions and sample times, available task set, selected
pairs and costs. A later decision uses its own currently received snapshot.

Every dispatch creates a distinct **attempt ID**, even when a released task is
assigned again. Its owner, request, local target, observations and terminal
outcome remain associated with that attempt. Completed tasks stay completed and
are never put back into the ready queue. At most one live owner may reserve a
task at any time. Partial dwell from a cancelled attempt cannot carry into its
replacement.

## Reactive execution and the withdrawal boundary

A Behavior Tree is the controller here, not a label added to an existing flight
phase log. The implementation evaluates tree nodes, records visited nodes and
their returned **Success**, **Failure** or **Running** statuses, and uses the
selected stateful action to issue each request. A reactive fallback restarts
priority checking from its first child on each tick. A sequence advances past a
successful child, stops on a running child and fails on a failed child. Nodes not
visited on that tick are **Idle** in the replay.

The implemented tree is the same for all three vehicles:

```text
ReactiveFallback root
├── ReactiveSequence withdraw
│   ├── WithdrawRequested?
│   └── WithdrawLand
├── ReactiveSequence cleanup
│   ├── MissionClosed?
│   └── CleanupLand
└── ReactiveSequence execute
    ├── Guided
    ├── Arm
    ├── Takeoff
    └── ReactiveFallback work
        ├── ReactiveSequence assigned
        │   ├── HasTask?
        │   └── VisitAndHold
        └── Wait
```

The controller aims for a **100 ms** interval between ticks. Actual starts,
finishes and side-effect times are recorded; a slow host does not generate
invented catch-up ticks. It first receives available messages, samples the
withdrawal input and mission closure, ticks each tree, releases a retired
reservation when permitted, then allocates ready work. A newly assigned attempt
is sent by its tree on a subsequent tick. Received completion evidence can be
latched between ticks and is consumed on a later traversal.

Action start sends its request once. Subsequent ticks observe progress rather
than repeatedly sending the same request. Completion is established from the
action's matching acknowledgement and/or fresh telemetry criteria, as applicable.
Completed setup actions are idempotent so reactive traversal does not repeat
takeoff. A running action that loses selection receives an explicit halt.

In the withdrawal case, the harness supplies the current withdrawal request on
the first control tick at least **500 ms after A1's second task setpoint**. This
is a deliberately supplied input, not battery sensing, link failure detection or
an unexplained disappearance. The nominal case never supplies it. The executor
reads the current input; it does not know the future intervention schedule.
The scheduled trigger and the later sampled request have distinct timestamps;
the request timestamp is the action's interruption boundary. A sample received
between the scheduled trigger and that sampled input is still a normal active
attempt observation.

The intended causal order is:

1. The withdrawal guard becomes true and the reactive priority branch takes over.
2. A1's running visit action is halted and its attempt is marked cancelled.
3. A separate, correctly addressed LAND request is sent to A1.
4. The cancelled task remains reserved to A1 while it descends. A2 and A3 may
   continue their existing tasks and take other already available work.
5. Only fresh observed landing and disarming allow the coordinator to release
   A1's incomplete task. A1 remains permanently ineligible for this mission.
6. A subsequent greedy decision can assign the released task to A2 or A3.

The stateful action's halt is a **coordinator cancellation event**. A position
`SET_POSITION_TARGET_LOCAL_NED` message has neither a `COMMAND_ACK` nor a
corresponding setpoint cancellation acknowledgement to display. This experiment
does not send `COMMAND_CANCEL` for a position setpoint. `MAV_CMD_NAV_LAND` changes
the flight mode; it is a separate request whose admission and observed landing
must be inspected separately. An accepted LAND request alone cannot release work.

Waiting for confirmed landing is this experiment's conservative ownership
policy. It is not a general distributed fencing protocol or proof that an
arbitrary disconnected robot has stopped. The deliberate withdrawal keeps its
connection and telemetry available. If landing cannot be confirmed, the task
remains reserved and recovery does not succeed within the declared budget.

## Completion evidence and outcomes

Visit completion uses new `LOCAL_POSITION_NED` samples from the assigned vehicle
after the attempt's setpoint. For one uninterrupted second of receipt time:

```text
3D position error <= 0.5 m
3D speed <= 0.4 m/s
gap between qualifying samples <= 300 ms
```

A failing sample or longer gap resets the dwell. Repeated inspection of the same
held sample does not advance it. Samples from another vehicle, before this
attempt's dispatch, after cancellation or after the mission deadline cannot
complete the attempt. The completion decision records its underlying sample
time; it must not backdate a later receipt to an earlier control tick.

Landing requires prior airborne evidence, a matching accepted LAND request, and
fresh on-ground and disarmed reports received after that request. Both landed
state and heartbeat must be at most **1,500 ms** old at the evidence time. A low
altitude estimate, an ACK, a BT root returning Success or process liveness does
not establish this flight outcome by itself.

Report separately:

- Unique tasks completed out of six, incomplete tasks and duplicate completion
  claims.
- Mission duration from the first dispatch interval to the last valid task
  completion, or an explicit timeout if all six do not finish.
- Withdrawal request, action cancellation, LAND send, confirmed landing, task
  release and replacement dispatch times.
- The interval during which the interrupted task remains reserved, and recovery
  delay from withdrawal to that task's eventual completion.
- Final landing and disarming of all three vehicles, separate from mission
  completion.

More precisely, mission duration begins at the recorded mission-start tick
before initial allocation and ends at the sixth qualifying raw position sample.
The next tick recognizes mission closure and selects cleanup. Both timestamps
are retained; this small observation-to-decision delay is not silently added to
the reported task duration.

Compare measured nominal and withdrawal durations. One pair of runs, even with a
repeat, does not establish a general performance penalty. A withdrawal can change
later greedy assignments; the result depends on this geometry, policy, estimates
and measured timing. A process crash, unexpected rejection or incomplete cleanup
is distinct from the intended controlled withdrawal case and must not be hidden
by expected summary values.

## Replay, visibility and verification

The linked 2D map/elevation and volumetric 3D drones consume one recorded cursor.
Each telemetry channel holds its last received sample independently. Rewinding
must remove future ownership, completions, BT decisions and terminal outcomes.
Case totals are end-of-record comparisons and must be labeled separately from
the state available at the current cursor.

The task ledger, active attempts, assignment snapshots, per-drone BT traversal,
withdrawal input, command envelopes and fresh evidence should be inspectable.
The cancellation-to-release interval is a useful replay milestone: it makes the
ownership rule visible while A1 is still descending. Changing the viewpoint,
selected vehicle or 2D/3D view does not alter recorded execution.

Verification must cover deterministic greedy snapshots; exclusive ownership;
distinct attempt generations; cancellation precedence and halted actions; no
post-cancellation dwell credit; retained ownership before fresh landing; release
before reassignment; no future-sample leakage; per-vehicle sources and routes;
real three-process overlap; and unique task completion versus flight cleanup.
Import validation checks the same relationships rather than trusting totals.
Recorder identity and source hashes establish trace consistency, not producer
authentication.

The recorder is `recovery/record.py`, using the pinned simulator image and
vehicle transport helpers from workshops 18 and 21. It runs three processes in
each fresh case inside a container with no external network or published control
port. Normal browser playback requires only the bundled recording, not Docker.

```sh
npm run record:recovery
npm run compare:recovery -- local/ardupilot-recovery.json
```

The runner's default output is an ignored local JSON file. Import it into
`/recovery/` to inspect that run. It validates both cases and the current runtime
fingerprints before replacing the output; an interruption or unexpected failure
preserves an existing recording. The public reference artifact is
[`docs/results/ardupilot-recovery.json`](../results/ardupilot-recovery.json).

## Primary references and limits

- Colledanchise and Ögren, [Behavior Trees in Robotics and AI: An Introduction](https://arxiv.org/abs/1709.00084),
  supplies the formal tree control-flow background.
- BehaviorTree.CPP's [fallback reference](https://behaviortree.dev/docs/nodes-library/FallbackNode/),
  [sequence reference](https://behaviortree.dev/docs/nodes-library/SequenceNode/)
  and [reactive/stateful action tutorial](https://behaviortree.dev/docs/tutorial-basics/tutorial_04_sequence/)
  explain priority reevaluation, child statuses and halting asynchronous actions.
  The recorder implements these declared semantics in a small Python executor;
  it does not run the BehaviorTree.CPP library.
- ArduPilot's [Guided movement documentation](https://ardupilot.org/dev/docs/copter-commands-in-guided-mode.html)
  defines local NED setpoints, the position-only mask and the LAND mode request.
  Its pinned [Copter receive handlers](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/GCS_MAVLink_Copter.cpp)
  identify the implementation used by the pinned firmware.
- The [MAVLink command protocol](https://mavlink.io/en/services/command.html)
  distinguishes request admission from completed action, and long-running
  command cancellation from an ordinary position-setpoint message.
- ArduPilot's [SITL guide](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html)
  explains separate simulated vehicles and identities. The runtime and frame
  registration follow the bounded contract of workshop 21.

This is central coordinated mission recovery over reliable local connections.
It does not implement CBBA, decentralized consensus, failure suspicion, task
leases, shared collision physics, ORCA, onboard obstacle avoidance, camera
inspection, battery depletion, real-radio behavior or hardware readiness. The
yard's geometry and visual separation are not measured collision-safety evidence.
