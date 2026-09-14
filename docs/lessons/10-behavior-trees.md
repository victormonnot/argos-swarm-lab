# Lesson 10 — Behavior Trees and finite-state machines

**Question:** when a running action is interrupted, which conditions get checked
again, and which work survives?

**Status:** implemented local workshop at `/behavior/`. See the
[setup instructions](../../README.md#run-locally) and
[measured results](10-behavior-trees-results.md).

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Execution methods | Behavior Tree (BT) with reactive priority fallback; finite-state machine (FSM); BT with memory at the root fallback | Two equivalent reactive executors, plus a deliberately different condition-rechecking policy. |
| Tree variant | Ordered sequences, fallbacks, one hold condition and stateful actions | Each tick returns Success, Failure or Running; unvisited nodes are displayed as Idle for that tick. |
| Decision architecture | One onboard executor with a fixed inspection assignment | Allocation does not change. The experiment isolates action execution from the multi-agent assignment problem. |
| Timing | Sampled control ticks and 0.25 s command intervals | Read current inputs, evaluate control flow, then apply at most one action for one interval. Terminal observation can consume a tick without advancing time. |
| Communication and topology | None | A supplied local hold request and inspection sensor-health flag have no modeled transport delay. There are no peers, packets or distributed consensus. |
| Agent inputs | Exact own position, action completion records, current hold request and inspection sensor status | The executor receives current observations, without access to the future event schedule or evaluator metrics. |
| Evaluator | Completion, hold compliance, discarded inspection, interruptions, distance and time | Reaching home and completing the inspection are different outcomes. |
| Fidelity | Three-dimensional point kinematics with a volumetric drone view | Altitude belongs to the model. Appearance, rotors and structures add no inertia, aerodynamics, collision avoidance or sensor physics. |

## Fixed mission and common actions

One drone starts at `(0, 0, 0)` m. Coordinates are `(x, y, z)`, with `z` altitude.
It must take off to `(0, 0, 3)`, travel to an inspection point `(6, 0, 3)`,
inspect for **3 uninterrupted seconds**, return to `(0, 0, 3)` and land at home.
Assignment, coordinates, maximum speed **1.5 m/s**, inspection duration and
**30 s** time limit are identical across all methods.

For a movement action toward `q`, current position `p` advances by

```text
p_next = p + min(1, v_max Δt / ||q − p||) (q − p)
```

At the target, position remains unchanged. Here `Δt = 0.25 s`, `v_max = 1.5 m/s`
and distances use all three coordinates. Unused time on an arrival interval is
discarded. The next control tick observes completion and may select the next
action; traversing several successful nodes never integrates several intervals.
The final observation tick can terminate a run without adding simulated time.

A hold request means stay at the current position and do no inspection work.
Preempting an incomplete inspection discards its partial progress; completed
actions remain completed. Motion resumes from the current position. Releasing
hold permits the unfinished action to start again. Hold itself keeps returning
Running; the condition above it determines whether the branch remains eligible.

Inspection sensor failure makes the inspection action return Failure. The
executor latches the mission abort, returns home and lands using the same movement
primitives. This is an **aborted inspection**, even when its recovery branch
returns Success. Tree status is local control-flow status, not a universal
mission-success flag.

## Control flow and comparison boundary

The root tries a hold branch before mission execution. Its hold branch checks
the current request before invoking Hold. The mission branch tries the ordered
inspection sequence, then recovery if inspection fails. All sequences and the
inner fallback restart their traversal at the first child on each tick; only the
root fallback changes memory semantics between the two BT variants. Completed-action records
make finished actions idempotent; restarting tree traversal does not repeat a
takeoff or completed inspection. The implementation exposes which nodes were
visited, their returned statuses, cancellation and explicit FSM transitions.

The **reactive root fallback** starts checking priority from its first child on
every tick. A newly true hold condition interrupts the running mission action.
The **memory root fallback** resumes its running child. While mission execution
is Running, the earlier hold branch is skipped. This specific tree placement
therefore can miss a changed request. Memory is useful in other designs; this
comparison does not imply that all memory nodes or all Behavior Trees ignore
interruptions. Both tree variants use the same action logic.

The **FSM** gives the current hold request the same priority and cancellation
semantics as the reactive BT. Its explicit phase and resume transitions implement
the same mission policy. It extends the finite-state execution concept introduced
in [lesson 3](03-mission-allocation.md), with one fixed assignment, altitude and a
recoverable hold. It is a separate small executor rather than reuse of that
lesson's allocation loop or absorbing unavailable state. Equal behavior is an
intended comparison result; architecture alone does not determine responsiveness.

## Event scenarios

Events are sampled at the start of an interval. At time `t = 7 s`, the supplied
flag affects the action selected for `[7, 7.25)`; it does not undo work before 7 s.

| Scenario | Current local input supplied by the simulator | Question |
| --- | --- | --- |
| Nominal | No hold; sensor available | Do the methods perform the same fixed mission? |
| Temporary hold | Hold true for `7 ≤ t < 10 s` | Is a running inspection interrupted and restarted after release? |
| Persistent hold | Hold true from `t = 7 s` to the budget | Does the executor respect the request even though the mission cannot finish? |
| Sensor failure | Sensor failed from `t = 7 s` | Does Failure cause recovery, and is recovery distinguished from successful inspection? |

These schedules are independent reference cases, not simultaneous disturbances.
They are evaluator configuration; an executor only reads the currently sampled
flags. Hold is an ideal externally supplied request, not autonomous hazard
detection. Sensor failure is an action-level feedback injection, not a simulated
camera, GPS outage or estimator failure.

## Outcomes and inspectable evidence

- **Completed:** inspection finished and the drone landed at home.
- **Aborted:** the inspection failed and the recovery return/landing finished.
- **Timed out:** 30 s elapsed without either terminal result.

Report hold-ignored seconds separately from completion. It sums command intervals
with a currently true request and a chosen action other than Hold; it includes
inspection as well as motion. Counting stops when the run terminates. A completed
mission can violate the hold policy. Discarded inspection counts elapsed service
lost through cancellation or failure, and distance is integrated displacement in
metres. Interruption and failure events remain distinguishable in the trace.

The page provides method/scenario selection, play/pause, one control tick, reset,
a jump to the event boundary, finish, node inspection and independent reference
copies. Changing a method or scenario starts a paused run. Playback speed changes
wall-clock scheduling only. Views observe identical positions, altitude and
history without advancing the model. The 2D side elevation includes altitude;
the 3D view shows a drone, pad and inspection structure in a known clear corridor.
Camera presets show the whole yard or focus on the drone’s current position;
these controls change only the viewpoint. The numerical state remains available
without WebGL. Runs are local to the tab.

Verification must cover equal reactive BT/FSM trajectories, action ordering,
one integration per tick, actual altitude, hold boundaries and cancellation,
inspection Failure/recovery, missed memory-root guards, deterministic replay,
terminal stability and meaningful browser controls. The numerical exporter must
record configuration, revision, source hash and reproducible case summaries.

## Primary references and limits

- Colledanchise and Ögren, [Behavior Trees in Robotics and AI: An Introduction](https://arxiv.org/abs/1709.00084),
  introduces tree control flow and its relationship to other execution structures.
- BehaviorTree.CPP's [fallback node reference](https://behaviortree.dev/docs/nodes-library/FallbackNode/)
  distinguishes reactive priority reevaluation from reticking a running child.
- Its [sequence reference](https://behaviortree.dev/docs/nodes-library/SequenceNode/)
  separates reactive traversal from sequence memory choices.
- Its [stateful action tutorial](https://behaviortree.dev/docs/tutorial-basics/tutorial_04_sequence/)
  explains long-running actions and cancellation.

This is a small JavaScript teaching implementation, not a binding to
BehaviorTree.CPP or a claim to implement every node in that library. It models
one fixed mission and supplied feedback. There is no task allocation, multi-agent
coordination, radio, battery, obstacle sensing, path planner, flight controller
or guarantee for physical vehicles. A volumetric environment is visualization;
the explicit kinematic model defines the supported numerical claims.
