# Module catalog

Consensus, Artificial Potential Fields, task allocation/execution, decision
architectures, A* path planning, individual Kalman position estimation and shared
target estimates are implemented local workshops (1–7). The proposed main
sequence below breaks distributed software into workshops 8–11 and flight
simulation into workshops 12–15. Optional algorithm topics are listed separately;
they are not prerequisites or additional numbered commitments.

A **phase** groups related subjects. A **workshop** answers one bounded question
with an experiment. Its **lesson page** explains the method, exposes controls
and displays the observed results. Each follows the
[experiment guide](experiment-guide.md).

## Available workshops

| Module | Question explored | Bounded experiment and comparison | Concepts covered |
| --- | --- | --- | --- |
| 1. Distributed average consensus | How can local exchanges produce agreement? | Linear consensus with constant edge gain on a complete graph, a chain and disconnected groups; remove and restore links. | Decentralized, leaderless decisions; synchronous discrete updates; communication topology and convergence assumptions. |
| 2. [Artificial Potential Fields](lessons/02-potential-fields.md) | How do local motion rules produce useful or undesirable behavior? | Capped velocity commands from attraction/repulsion in a known map; compare arrival, a U-shaped trap and contact failures. | Decentralized reactive control; finite-range peer sensing; synchronous kinematics; tuning and local traps. |
| 3. [Task allocation and finite-state execution](lessons/03-mission-allocation.md) | Who should do which task, and when is it complete? | Three agents service six points; compare fixed round-robin, nearest-pair greedy and Hungarian assignment under one central coordinator. Make A2 unavailable at 5 s. | Linear assignment versus mission execution; finite-state machines; exclusive ownership, reallocation and completion metrics. |
| 4. [Decision architectures](lessons/04-decision-architectures.md) | What changes when decision authority moves? | Reuse nearest-pair greedy with a central allocator, fixed subgroup domains or replicated peer plans. Cut and restore links between {C,A1} and {A2,A3}. | Authority and eligibility, delivered report caches, retained reservations, full-roster barriers, physical completion versus confirmation. |
| 5. [A* path planning and waypoint execution](lessons/05-pathfinding.md) | How does a route become motion around a wall? | A*, Dijkstra and direct motion on known grids. | Shortest graph paths, Manhattan heuristic, search effort and motion limits. |
| 6. [Individual position estimation](lessons/06-localization.md) | What if the controller's position is wrong? | Exact reference, dead reckoning and linear Kalman filtering with synthetic odometry bias and missing absolute fixes. | Prediction/correction, assumed covariance versus true error, controller belief versus actual arrival. |
| 7. [Shared estimates and Covariance Intersection](lessons/07-shared-estimates.md) | Does every received estimate contain new information? | Three agents observe one static target once. Compare no sharing, naive independent fusion, unique-measurement fusion and fixed-half Covariance Intersection under ring/cut/recovery delivery. | Source provenance, unknown cross-correlation, duplicate evidence, covariance consistency and communication cost. |

## Proposed main sequence: distributed software

These are proposed workshop boundaries and ordering, not implemented features
or a fixed complete curriculum. The immediate next proposal is workshop 8.
The later briefs, versions and acceptance criteria will be defined one workshop
at a time. The later entries remain planning candidates.

| No. | Proposed workshop | Question | Bounded experiment |
| --- | --- | --- | --- |
| 8 | ROS 2 nodes, topics and explicit rounds | What changes when a known algorithm runs in separate programs? | Reproduce a lesson-1 consensus case with one agent per process and inspect published/received messages. Specify run IDs, round IDs and a synchronization protocol before comparing numerical traces. |
| 9 | Message freshness and Quality of Service (QoS) | Is a delivered message still useful? | Keep the same processes; introduce a controlled delivery impairment and compare selected reliability/history settings. Inspect sequence gaps and message age under a declared clock model. |
| 10 | Process failure and restart | What can peers infer when an agent stops, then returns? | Stop one agent process and restart it. Inspect timeout evidence, session identity and stale state. Define restart/reset behavior explicitly; silence alone does not prove a crash. |
| 11 | One DDS-based RMW versus rmw_zenoh | What changes when the transport implementation changes? | Reuse the same message scenario with one named DDS implementation and Zenoh through ROS 2's RMW interface. Compare a declared delivery/recovery metric with versions, topology and supported QoS recorded. Keep this comparison conditional on a useful, comparable experiment. |

One node per process in workshop 8 is an experiment choice; ROS 2 also supports
[multiple nodes in one process](https://docs.ros.org/en/rolling/Tutorials/Intermediate/Composition.html).
Round synchronization is part of the application protocol, not an automatic
property of publish/subscribe. The
[official QoS documentation](https://github.com/ros2/ros2_documentation/blob/rolling/source/ROS-Framework/interfaces/topics/About-Quality-of-Service-Settings.rst)
and [rmw_zenoh design](https://github.com/ros2/rmw_zenoh/blob/rolling/docs/design.md)
describe the transport concepts; they do not establish equivalence or a winning
implementation for this lab. Select a supported distribution, client language
and middleware versions when implementing the bounded workshop.

## Proposed main sequence: flight simulation

Start with one vehicle and observable execution before introducing a fleet.
This is a pedagogical order: ArduPilot's Gazebo integration does not require
completing a ROS 2 middleware comparison first.

| No. | Proposed workshop | Question | Bounded experiment |
| --- | --- | --- | --- |
| 12 | ArduPilot SITL and MAVLink command feedback | Did the vehicle execute the requested action? | Use one simulated vehicle and a short takeoff/waypoint/landing sequence. Inspect commands, acknowledgements and telemetry against explicit completion criteria. Start with SITL's built-in dynamics model. |
| 13 | ArduPilot with a Gazebo environment | How does the flight controller interact with an external simulated world? | Connect one vehicle to a supported Gazebo model. Observe a short motion command and one declared perturbation or execution limit, with simulation timing and state feedback visible. |
| 14 | Lost GCS heartbeat and configured failsafe | What does the autopilot do when contact with the ground station is lost? | On one simulated vehicle, interrupt the established GCS heartbeat, inspect timeout and configured response, then restore it. Distinguish heartbeat loss from merely pausing commands or losing a telemetry display. |
| 15 | Two vehicles and one bounded mission | Can commands, reports and task completion stay associated with the right vehicle? | Start with two separately identified SITL vehicles, isolated message routes and one simple allocation scenario using a known policy. Measure execution and confirmation; document separation assumptions and resource use before increasing the fleet. |

SITL already includes a vehicle dynamics model; workshop 13 introduces an
external environment, rather than the first physical dynamics in the sequence.
The [ArduPilot simulation overview](https://ardupilot.org/dev/docs/simulation-2.html)
and [Gazebo integration guide](https://ardupilot.org/dev/docs/sitl-with-gazebo.html)
describe that boundary. MAVLink distinguishes command acceptance from execution
completion in its [command protocol](https://mavlink.io/en/services/command.html).
The proposed failure case follows the documented
[GCS heartbeat failsafe](https://ardupilot.org/copter/docs/gcs-failsafe.html).
Vehicle identity and spawning are described in
[Using SITL](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html).

Each future workshop retains an explanatory lesson page. For process and flight
experiments, that page should inspect/control the actual run or its recorded
trace; its 2D/3D views must not run a separate browser approximation presented as
ROS 2 or autopilot execution. A small adapter can be introduced when needed by
that specific experiment. Software versions, installation/resource requirements,
supported vehicle counts and acceptance criteria must be verified before delivery.
None of workshops 8–15 is implemented by the current browser lab.

## Comparisons must answer a specific question

An assignment algorithm solves a defined cost problem; it does not automatically
solve online mission execution. A behavior tree or state machine executes logic;
it is not itself an allocation algorithm. An auction can distribute allocation
decisions without making every other part of the system decentralized.

For architecture comparisons, keep tasks, information assumptions and resource
budgets comparable. State whether the allocator is held constant or necessarily
changes with the architecture. Otherwise, a result may reflect several changes
at once.

A one-agent baseline is useful when testing the benefit of parallel work. An
adaptive greedy baseline is useful when testing whether a sophisticated method
adds value beyond simple reassignment. Neither has to lose for a lesson to be
successful.

## Degradation runs through the course

Begin with missing links in consensus. Add agent unavailability when tasks have
owners, delay when messages have timestamps, and localization failures when the
model has a localization input. Do not add a decorative failure toggle before
the corresponding mechanism exists.

For mission lessons, report what was completed, what remains possible and what
requires intervention. An agent process staying alive is not a mission metric.
The [experiment guide](experiment-guide.md) defines the reporting rules.

## Optional algorithm workshops

These are independent candidates for further browser experiments. They are not
an alternative numbered next sequence and are not hidden prerequisites for ROS 2
or flight simulation. They can be selected before, during or after the proposed
main sequence when a particular algorithmic question becomes the priority.

| Candidate | Possible bounded question | Builds on |
| --- | --- | --- |
| ORCA, Optimal Reciprocal Collision Avoidance | How does reciprocal velocity selection handle two agents crossing, compared with the existing reactive baseline? | Motion and collision checks in workshop 2. |
| CBBA, Consensus-Based Bundle Algorithm | How do distributed bids resolve competing task bundles under declared connectivity? | Allocation and decision authority in workshops 3–4. |
| Behavior Trees | How does task execution react to failure or interruption, compared with the existing finite-state machine? | Execution in workshop 3; allocation remains a separate rule. |
| Cooperative localization | What changes when observations constrain agents' own poses rather than a shared static target? | Individual filtering and shared evidence in workshops 6–7. |
| SLAM, simultaneous localization and mapping | How can pose and map be estimated together in one small, declared sensor scenario? | A separate scope and method selection are needed; this is a broader subject, not a single already-defined lesson. |

Research methods enter through a precise question, stated assumptions and an
understandable baseline. This list is not a requirement to cover every technique.
