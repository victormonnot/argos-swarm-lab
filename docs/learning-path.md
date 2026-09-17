# Module catalog

Consensus, Artificial Potential Fields, task allocation/execution, decision
architectures, A* planning, individual Kalman estimation, shared target
estimates, ORCA, CBBA, Behavior Trees/FSM, cooperative localization, EKF-SLAM,
pose-graph SLAM, ROS 2 nodes/topics, message freshness, process restart and a
Fast DDS/Zenoh comparison are implemented local workshops **1–17**. Workshops
14–17 replay actual process runs. Flight simulation in workshops 18–21 remains
the proposed continuation.

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
| 8. [Optimal Reciprocal Collision Avoidance](lessons/08-orca.md) | How can moving agents share responsibility for avoiding a collision? | ORCA, APF and direct goal following on planar disk crossings; inspect velocity constraints and compare symmetry and unavailable peer sensing. | Half-responsibility, nearest feasible velocity, prediction horizon, swept clearance and arrival versus avoidance. |
| 9. [Consensus-Based Bundle Algorithm](lessons/09-cbba.md) | How can peers resolve competing task bundles? | Three planners with additive utilities exchange timestamped winner beliefs over a chain, partition or recovery; compare independent greedy bundles and an evaluator's exact score reference. | Bundle acquisition, suffix release, local beliefs, conflicting claims, agreement and allocation quality versus execution. |
| 10. [Behavior Trees and finite-state machines](lessons/10-behavior-trees.md) | What happens when a running action is interrupted? | One fixed drone inspection mission with identical actions: reactive BT, guarded FSM and a memory-root BT; temporary/persistent hold and inspection failure. | Tick traversal, Success/Failure/Running, action cancellation, reactive versus memory semantics, recovery versus mission success, and 3D kinematics. |
| 11. [Cooperative localization](lessons/11-cooperative-localization.md) | Can robots improve their own positions by observing each other? | Independent position Kalman filters versus a joint four-state KF; relative Cartesian observations, A1-only absolute fixes, absent/restored reference and a shared prior offset. | Cross-covariance, indirect corrections, known coordinate frame, common-translation observability, error versus uncertainty and paired seeded trials. |
| 12. [Extended Kalman Filter SLAM](lessons/12-ekf-slam.md) | How can a robot map landmarks and locate itself together? | One planar pose and unknown landmark positions with supplied IDs; range/bearing, correlated map initialization and reobservation corrections versus odometry mapping. | Nonlinear Jacobians, pose/map cross-covariance, fixed start frame, map coverage, sensor loss and biased measurements. |
| 13. [Pose-graph SLAM](lessons/13-pose-graph-slam.md) | How does revisiting a place constrain an accumulated trajectory? | An anchored 25-pose SE(2) graph with noisy relative constraints; Gauss–Newton with backtracking and supplied correct/incorrect loop IDs. | Retrospective corrections, nonlinear weighted least squares, local residuals, gauge anchoring, optimization versus association and cost versus accuracy. |
| 14. [ROS 2 nodes, topics and explicit rounds](lessons/14-ros2-rounds.md) | What changes when a known algorithm runs in separate programs? | Six actual rclpy agent processes with neighbor topics and a central round supervisor; recorded complete/chain/omitted-publication traces. | Node versus process, publish/subscribe, run and round IDs, application barriers, numerical equivalence and progress versus local updates. |
| 15. [ROS 2 message freshness and Quality of Service](lessons/15-ros2-freshness.md) | Is a delivered message still useful? | One actual publisher and three independent reader processes; KEEP_LAST depth 20 versus 1 and an application age gate under a controlled executor pause. | Middleware history versus application acceptance, callback age, retained Age of Information and sequence gaps without packet-loss inference. |
| 16. [Process failure and restart](lessons/16-process-restart.md) | What can an observer infer when a process stops, then returns? | Continuous heartbeat, same-process publication silence and actual SIGKILL/respawn; one observer compares sequence-only and epoch/sequence admission on identical callbacks. | Fixed-timeout suspicion versus process truth, logical identity, new PID/incarnation, lost counters and accepted-state recovery. |
| 17. [Fast DDS, Zenoh and late-joining readers](lessons/17-middleware-durability.md) | Does changing the middleware preserve a bounded historical-delivery contract? | The same actual ROS application through two RMWs, each with VOLATILE versus TRANSIENT_LOCAL durability; a reader joins between two fixed publication batches. | RMW versus application, reliability versus history, bounded publisher retention, discovery versus data paths, requested/graph-reported QoS and observed callback sets. |

## Algorithm sequence and method context

The implemented examples cover motion, task allocation/execution and estimation,
including two bounded SLAM approaches. They are not an exhaustive curriculum.
Workshop **14: ROS 2 nodes, topics and explicit rounds** now moves the known
consensus rule into actual processes, with an interactive recorded-trace page.
Workshop **15: message freshness and Quality of Service** compares history
depths and an application age gate on a continuous telemetry stream. Its
executor pause replaces the synchronous barrier to expose old samples while
reliability remains fixed. Workshop **16: process failure and restart** compares
local heartbeat suspicion with actual process exit and new-incarnation admission.
Workshop **17: Fast DDS, Zenoh and late-joining readers** now compares the same
bounded durability workload through both RMWs. The next proposed workshop is
**18: one ArduPilot SITL vehicle with MAVLink command feedback**.

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
The [implemented lesson](lessons/11-cooperative-localization.md) declares its
linear Cartesian measurement model, supplied frame and information boundaries.

SLAM means simultaneous localization and mapping; it is a problem family, not one
algorithm. [Workshop 12](lessons/12-ekf-slam.md) implements a bounded filtering
example; [workshop 13](lessons/13-pose-graph-slam.md) implements a pose-graph
optimizer with supplied associations. They do not implement a complete
camera/LiDAR SLAM system,
unknown data association, collaborative SLAM or every SLAM method. The
[Durrant-Whyte/Bailey tutorial](https://www-personal.acfr.usyd.edu.au/tbailey/publications/slamtutorial1.htm)
and [Grisetti et al. graph-based tutorial](https://iris.uniroma1.it/handle/11573/137105)
provide the method context. Their lesson specifications name the estimators,
solvers and supplied observation associations explicitly.

## Implemented sequence: distributed software

Workshops 14–17 execute actual ROS 2 processes. The middleware comparison uses
one fixed late-subscription workload and two named implementations. It observes
historical/live sequence sets rather than ranking general transport performance.

One node per process in workshop 14 is an experiment choice; ROS 2 also supports
[multiple nodes in one process](https://docs.ros.org/en/rolling/Tutorials/Intermediate/Composition.html).
Round synchronization is part of the application protocol, not an automatic
property of publish/subscribe. The
[official QoS documentation](https://github.com/ros2/ros2_documentation/blob/rolling/source/ROS-Framework/interfaces/topics/About-Quality-of-Service-Settings.rst)
and [rmw_zenoh design](https://github.com/ros2/rmw_zenoh/blob/rolling/docs/design.md)
describe the transport concepts; they do not establish equivalence or a winning
implementation for this lab. Workshop 14 selects Jazzy, Python/rclpy and rmw_fastrtps_cpp in a pinned
container. Workshop 17 derives one shared image with pinned Jazzy Zenoh packages
and records both implementations, endpoint settings and configuration fingerprints.

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
Workshops 18–21 remain proposals; workshops 14–17 include runnable ROS 2
recorders and interactive pages for their actual traces.

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

The numbered sequence includes ORCA, CBBA, Behavior Trees, cooperative
localization and introductory SLAM. Further work may deepen any of those topics,
for example automatic data association, visual/LiDAR sensing or collaborative
SLAM, but these are not silently included in the small initial experiments.
Learned policies and language-model interfaces remain optional. Select additional
methods through a specific question and an understandable baseline; the roadmap
is not a requirement to cover every technique.
