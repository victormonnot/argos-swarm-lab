# Module catalog

Consensus, Artificial Potential Fields, task allocation/execution, decision
architectures, A* path planning, individual Kalman position estimation and shared
target estimates are implemented local workshops (1–7). The proposed main
sequence continues with algorithm workshops 8–13, distributed software in
workshops 14–17 and flight simulation in workshops 18–21. ORCA, CBBA, Behavior
Trees, cooperative localization and two introductions to SLAM are included in
the main proposal. Only workshops 1–7 are implemented.

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

## Proposed main sequence: algorithms and estimation

These are proposed workshop boundaries and ordering, not implemented features
or an exhaustive curriculum. The next proposal is workshop 8, ORCA. Each lesson
will define its exact variant, assumptions and acceptance criteria before its
experiment is built.

The ordering groups motion, task allocation and execution, followed by joint
estimation and mapping. These subjects extend the existing browser models and
can be studied before installing robotics middleware. This is a learning order,
not a claim that every algorithm is a technical prerequisite for ROS 2 or flight.

| No. | Proposed workshop | Question | Bounded experiment |
| --- | --- | --- | --- |
| 8 | ORCA — Optimal Reciprocal Collision Avoidance | How can moving agents share responsibility for avoiding a collision? | Compare reciprocal velocity selection with the existing reactive motion baseline on a small disk-agent crossing. Inspect velocity constraints, preferred/chosen velocities, clearance and arrival. State the sensing, reciprocity and finite-horizon assumptions. |
| 9 | CBBA — Consensus-Based Bundle Algorithm | How can peers resolve competing task bundles? | Use a small shared task set with declared bundle length and scoring. Inspect local bids, believed winners, conflict resolution and released bundle entries under connected and interrupted exchanges. Keep allocation quality separate from execution success. |
| 10 | Behavior Trees versus a finite-state machine | How should execution react when an action is interrupted or fails? | Hold assignment and action behavior fixed; compare the existing FSM with a small tree of conditions, sequences, fallbacks and actions. Inspect ticks and Success/Failure/Running states, with explicit reactive or memory semantics. |
| 11 | Cooperative localization — joint-state Kalman reference | Can robots improve their own position estimates by observing each other? | Start with two planar robots, noisy odometry and relative Cartesian displacement readings in a declared shared frame. Compare independent filtering with a joint position filter retaining cross-covariances. Declare the absolute reference and expose the unobservable common offset when it is absent. |
| 12 | EKF-SLAM — pose and landmark estimation | How can a robot estimate a map while locating itself inside it? | Use one planar robot and a few unknown landmark positions with supplied landmark IDs. Introduce heading, a small nonlinear motion/sensor model and Extended Kalman Filter linearization. Inspect joint pose/map updates, cross-covariances and a fixed reference frame. |
| 13 | Graph-based SLAM — pose graphs and loop closure | How does revisiting a place constrain an accumulated trajectory? | Optimize a small anchored pose graph with noisy relative-motion constraints. Compare no loop, one correctly supplied loop association and a controlled incorrect association. Inspect residuals and trajectory changes; do not claim automatic place recognition. |

ORCA selects a locally suitable velocity under its model; global route planning,
physical feasibility and eventual mission completion remain separate questions.
Its authors describe the method and original references on the
[ORCA project page](https://gamma-web.iacs.umd.edu/ORCA/).
CBBA's score and communication assumptions must be explicit; no universal
optimality claim is intended. The
[MIT CBBA project](https://acl.mit.edu/projects/consensus-based-bundle-algorithm)
provides the original allocation work and distinguishes later variants.
Behavior Trees organize execution; they do not replace task allocation. The
[authors' introduction](https://arxiv.org/abs/1709.00084) provides the formal
control-flow vocabulary for workshop 10.

Workshop 11 estimates different robots' positions, unlike workshop 7's estimates
of one shared target. Its joint filter is a reference architecture; a distributed
implementation is not implied by the word cooperative. Roumeliotis and Bekey's
[Distributed multirobot localization](https://experts.umn.edu/en/publications/distributed-multirobot-localization/)
provides context for relative observations and joint versus distributed filtering.
The exact teaching model and reference-frame assumptions will be declared in the
lesson brief.

SLAM means simultaneous localization and mapping; it is a problem family, not one
algorithm. Workshops 12 and 13 introduce filtering and graph optimization through
two small examples. They do not implement a complete camera/LiDAR SLAM system,
unknown data association, collaborative SLAM or every SLAM method. The
[Durrant-Whyte/Bailey tutorial](https://www-personal.acfr.usyd.edu.au/tbailey/publications/slamtutorial1.htm)
and [Grisetti et al. graph-based tutorial](https://iris.uniroma1.it/handle/11573/137105)
provide the method context. The estimator, solver and supplied observation
associations must be named explicitly when each experiment is specified.

## Proposed main sequence: distributed software

After those algorithm experiments, reuse a known scenario across actual processes.
The four planned workshop questions below retain a small, inspectable scope.

| No. | Proposed workshop | Question | Bounded experiment |
| --- | --- | --- | --- |
| 14 | ROS 2 nodes, topics and explicit rounds | What changes when a known algorithm runs in separate programs? | Reproduce a lesson-1 consensus case with one agent per process and inspect published/received messages. Specify run IDs, round IDs and a synchronization protocol before comparing numerical traces. |
| 15 | Message freshness and Quality of Service (QoS) | Is a delivered message still useful? | Keep the same processes; introduce a controlled delivery impairment and compare selected reliability/history settings. Inspect sequence gaps and message age under a declared clock model. |
| 16 | Process failure and restart | What can peers infer when an agent stops, then returns? | Stop one agent process and restart it. Inspect timeout evidence, session identity and stale state. Define restart/reset behavior explicitly; silence alone does not prove a crash. |
| 17 | One DDS-based RMW versus rmw_zenoh | What changes when the transport implementation changes? | Reuse the same message scenario with one named DDS implementation and Zenoh through ROS 2's RMW interface. Compare a declared delivery/recovery metric with versions, topology and supported QoS recorded. Keep this comparison conditional on a useful, comparable experiment. |

One node per process in workshop 14 is an experiment choice; ROS 2 also supports
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
| 18 | ArduPilot SITL and MAVLink command feedback | Did the vehicle execute the requested action? | Use one simulated vehicle and a short takeoff/waypoint/landing sequence. Inspect commands, acknowledgements and telemetry against explicit completion criteria. Start with SITL's built-in dynamics model. |
| 19 | ArduPilot with a Gazebo environment | How does the flight controller interact with an external simulated world? | Connect one vehicle to a supported Gazebo model. Observe a short motion command and one declared perturbation or execution limit, with simulation timing and state feedback visible. |
| 20 | Lost GCS heartbeat and configured failsafe | What does the autopilot do when contact with the ground station is lost? | On one simulated vehicle, interrupt the established GCS heartbeat, inspect timeout and configured response, then restore it. Distinguish heartbeat loss from merely pausing commands or losing a telemetry display. |
| 21 | Two vehicles and one bounded mission | Can commands, reports and task completion stay associated with the right vehicle? | Start with two separately identified SITL vehicles, isolated message routes and one simple allocation scenario using a known policy. Measure execution and confirmation; document separation assumptions and resource use before increasing the fleet. |

SITL already includes a vehicle dynamics model; workshop 19 introduces an
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
None of workshops 8–21 is implemented by the current browser lab.

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

## Further extensions

The numbered proposal includes ORCA, CBBA, Behavior Trees, cooperative
localization and introductory SLAM. Further work may deepen any of those topics,
for example automatic data association, visual/LiDAR sensing or collaborative
SLAM, but these are not silently included in the small initial experiments.
Learned policies and language-model interfaces remain optional. Select additional
methods through a specific question and an understandable baseline; the roadmap
is not a requirement to cover every technique.
