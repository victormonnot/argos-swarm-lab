# Lesson 03 — Task allocation and finite-state execution

**Status:** implemented local workshop at `/mission/`. See the
[setup instructions](../../README.md#run-locally) and
[measured results](03-mission-allocation-results.md).

**Question:** who should visit each observation point, and what makes that work
complete when an agent becomes unavailable?

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Allocation policies | Fixed round-robin, nearest-pair greedy, Hungarian algorithm | Compare persistent task owners with two adaptive matching rules. |
| Hungarian variant | Rectangular minimum-cost assignment via primal-dual augmenting paths | Assign as many distinct idle-agent / pending-task pairs as possible, minimizing the sum of current straight-line distances. |
| Execution | Finite-state machine (FSM) | Idle → travelling → servicing → idle; unavailability is absorbing for this run. Allocation and execution are separate mechanisms. |
| Decision architecture | Centralized for all three policies | One allocator receives exact agent status/position and task-completion reports, then sends each executor its target. No claim of decentralized assignment. |
| Timing | Fixed 0.1 s intervals; dispatch at state boundaries | Movement or service occurs during an interval, then completion reports, scheduled failure and dispatch are applied in that order. |
| Communication | Ideal, instantaneous reports and commands | The coordinator knows agent unavailability immediately. There is no heartbeat, packet loss, network partition or detection-delay model. |
| Agent inputs | Own position, execution state and assigned target/service counter | Executors do not read other agents or choose their own targets. |
| Evaluator data | Completed fraction, mission time, total travel, reassignments and lost service | These describe results. The allocator receives no future failure schedule or global performance shortcut. |
| Fidelity | Planar point motion, no obstacles or collision avoidance | 2D and 3D observe the same state. This lesson does not combine APF, flight dynamics or sensor processing with allocation. |

## Scenario and task contract

Three agents start at `A1=(0,0)`, `A2=(2,0)`, `A3=(0,4)` metres. Six tasks are
available at time zero:

| Task | Position (m) | Fixed owner |
| --- | --- | --- |
| T1 | (0.8, 0) | A1 |
| T2 | (−2, 0) | A2 |
| T3 | (0, 6) | A3 |
| T4 | (−5, 2) | A1 |
| T5 | (5, 3) | A2 |
| T6 | (2, 7) | A3 |

Each task needs one executor, exact arrival at its point, then **20 complete
service intervals = 2 s**. Service represents an abstract observation job, not
actual image collection. There are no time windows, priorities or agent skills.
A task has at most one owner and can be completed at most once.

An agent follows a straight segment at up to `1 m/s`, clamping the final movement
to the target. On the arrival boundary it enters `servicing`; it begins service
in the next interval. Unused time from the final travel interval is discarded.
Travel and service therefore use the same explicit 0.1 s discretization.

Task states are pending, assigned, servicing and completed. Completed work is
retained. Busy assignments are never preempted. Idle agents can receive another
target after all reports from a boundary have been processed.

## Allocation rules

The initial dispatch occurs at time zero, before any movement. Later dispatches
consider only idle, available agents and pending tasks. Each agent receives at
most one next target; the algorithm does not compute a complete tour.

- **Fixed round-robin:** task `j` belongs to agent `j mod 3` using zero-based IDs.
  An idle agent takes its first pending task in ID order. Ownership restrictions
  survive unavailability, so another agent cannot rescue that queue.
- **Nearest-pair greedy:** repeatedly select the lowest-distance remaining pair,
  remove its agent and task from consideration, and continue until one side is
  exhausted. Equal distances use stable ascending agent/task order. Recompute
  for the next dispatch; do not change a travelling/servicing assignment.
- **Hungarian algorithm:** solve the rectangular linear assignment problem for
  the current eligible agents/tasks. If one side is larger, unmatched agents or
  tasks wait. Iteration order resolves ties deterministically; an optimal pairing
  need not be unique.

For idle agent `i` and pending task `j`, `c_ij = ||p_i − q_j||` in metres. The
**Hungarian policy** solves the following objective, with `x_ij` indicating a
chosen pair:

```text
minimize sum(c_ij * x_ij)
subject to x_ij ∈ {0,1}
           sum_j x_ij <= 1 for each agent
           sum_i x_ij <= 1 for each task
           sum_ij x_ij = min(number of idle agents, number of pending tasks)
```

Every task's identical service duration would add the same constant to this
single-dispatch objective. The objective does not include later jobs or failures.
An optimal current matching is **not** a globally optimal multi-stop schedule or
a guarantee of minimum mission completion time.

The fixed policy follows its ownership restrictions instead. It may assign fewer
than `min(idle agents, pending tasks)` pairs when pending work belongs to an
unavailable owner, even though other agents are idle.

## Failure and event ordering

The failure preset makes **A2 unavailable at t=5.0 s**, after interval 49→50.
The coordinator receives that status immediately, before dispatch at boundary
50. Any task finishing exactly at that boundary is completed first and remains
completed. The future failure schedule is held by the simulator, not the allocator.

A2 stops moving/servicing and cannot return. Its active task is released to
pending and partial service is reset to 20 intervals. Lost service seconds are
recorded. Already completed tasks are never released. Under fixed ownership,
released and queued tasks still belong to A2 and cannot be reassigned. Under
adaptive rules, released tasks compete with other pending work at future
dispatches; a free agent is still required. Immediate detection does not imply
immediate recovery.

The evaluator stops with:

- **Completed:** all 6 tasks have completed service.
- **Blocked:** work remains but no executor is travelling/servicing after
  dispatch; the selected policy cannot progress without intervention.
- **Budget exhausted:** 600 updates / 60 s pass without either other outcome.

The displayed active-agent count is not a mission-success criterion. Under fixed
ownership, two healthy agents can remain idle while two tasks are stranded.

Reassignments count an already assigned task receiving a different owner; initial
assignments and first assignments of previously pending work do not count. Lost
service is completed service intervals on interrupted tasks, in seconds. Total
travel includes every agent's movement, including interrupted journeys. These
metrics do not enter the allocation cost matrix.

## Controls and evidence

Provide play/pause, one model interval, reset, advance to the 5 s boundary and run
to an outcome. Changing a policy or failure preset starts a new paused run.
Playback changes scheduling only, not model time per step. Runs live in tab
memory; navigation/reload starts over.

Show task states/owners/service progress, executor states and targets, completed
fraction, time, distance, reassignments, lost service and an event history.
The dispatch inspector must show the matrix and selected cells for a recorded
decision, clearly labeled as coordinator information. Both views observe the
same run; 3D adds neither altitude nor independent simulation.

Reference comparisons hold starts, points, speed, service duration and budget
constant. Compare all three policies both nominally and with A2's scheduled
unavailability. Record actual outcomes before claiming an advantage. Test the
assignment objective against an independent small exhaustive oracle, exclusive
ownership, completion/service ordering, failure release and deterministic reset.
Verify the controls, state visibility and view invariance in the browser.

`npm run compare:missions` executes all six references. The JSON exporter records
the current revision, modified-worktree flag, runtime, exact configuration and
SHA-256 hashes for both the matching and execution modules.

## Primary reference and boundaries

H. W. Kuhn (1955), [The Hungarian method for the assignment problem](https://doi.org/10.1002/nav.3800020109),
Naval Research Logistics Quarterly, 2(1–2), 83–97. The paper presents the assignment
method; this lesson uses a rectangular minimum-cost primal-dual variant with
deterministic augmenting paths. The finite-state executor, event schedule and
round-robin/greedy baselines are the explicit educational rules defined above.

The matching implementation accepts dense rectangular matrices with finite costs
within ±1,000,000,000 to avoid arithmetic overflow from pathological inputs; the
fixed scenario uses small nonnegative distances. Numerical tests compare its
objective against an independent exhaustive oracle, including unequal side sizes
and equal-cost choices.

This is not a full vehicle-routing solver, distributed auction or behavior tree.
There are no skills, energy constraints, moving tasks, radio links or collision
checks. Exact reports and instantaneous failure knowledge are assumptions, not
validated field capabilities. All claims of improvement concern these specified
reference runs, not arbitrary mission geometries or disruption patterns.
