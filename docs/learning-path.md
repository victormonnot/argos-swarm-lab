# Module catalog

Consensus, Artificial Potential Fields, task allocation/execution, decision
architectures, A* path planning, individual Kalman position estimation and shared
target estimates are implemented local workshops. The software/flight extensions
remain proposed. The motion and estimation topics are separate bounded lessons.
Each module combines an interactive
experiment with explanations following the [experiment guide](experiment-guide.md).

| Module | Question explored | Bounded experiment and comparison | Concepts covered |
| --- | --- | --- | --- |
| 1. Distributed average consensus | How can local exchanges produce agreement? | Linear consensus with constant edge gain on a complete graph, a chain and disconnected groups; remove and restore links. | Decentralized, leaderless decisions; synchronous discrete updates; communication topology and convergence assumptions. |
| 2. [Artificial Potential Fields](lessons/02-potential-fields.md) | How do local motion rules produce useful or undesirable behavior? | Capped velocity commands from attraction/repulsion in a known map; compare arrival, a U-shaped trap and contact failures. | Decentralized reactive control; finite-range peer sensing; synchronous kinematics; tuning and local traps. |
| 3. [Task allocation and finite-state execution](lessons/03-mission-allocation.md) | Who should do which task, and when is it complete? | Three agents service six points; compare fixed round-robin, nearest-pair greedy and Hungarian assignment under one central coordinator. Make A2 unavailable at 5 s. | Linear assignment versus mission execution; finite-state machines; exclusive ownership, reallocation and completion metrics. |
| 4. [Decision architectures](lessons/04-decision-architectures.md) | What changes when decision authority moves? | Reuse nearest-pair greedy with a central allocator, fixed subgroup domains or replicated peer plans. Cut and restore links between {C,A1} and {A2,A3}. | Authority and eligibility, delivered report caches, retained reservations, full-roster barriers, physical completion versus confirmation. |
| 5. [A* path planning and waypoint execution](lessons/05-pathfinding.md) | How does a route become motion around a wall? | A*, Dijkstra and direct motion on known grids. | Shortest graph paths, Manhattan heuristic, search effort and motion limits. |
| 6. [Individual position estimation](lessons/06-localization.md) | What if the controller's position is wrong? | Exact reference, dead reckoning and linear Kalman filtering with synthetic odometry bias and missing absolute fixes. | Prediction/correction, assumed covariance versus true error, controller belief versus actual arrival. |
| 7. [Shared estimates and Covariance Intersection](lessons/07-shared-estimates.md) | Does every received estimate contain new information? | Three agents observe one static target once. Compare no sharing, naive independent fusion, unique-measurement fusion and fixed-half Covariance Intersection under ring/cut/recovery delivery. | Source provenance, unknown cross-correlation, duplicate evidence, covariance consistency and communication cost. |
| Proposed next: distributed software | What changes when the same experiment runs across processes? | First reproduce one known scenario with ROS 2 processes and explicit messages. Then compare DDS and Zenoh for a defined transport question if that comparison is useful. | Message contracts, process lifecycle, timestamps, observability and middleware integration. Python/C++ and middleware versions are selected at implementation time. |
| Proposed later: flight simulation | Which simplifying assumptions break with an autopilot and vehicle dynamics? | Begin with one bounded Gazebo/ArduPilot SITL/MAVLink scenario; establish timing, resources and execution feedback before extending the fleet. | Autopilot integration, physical dynamics, supported fleet sizes and diagnostic limits. |

## Progression beyond the browser models

The first seven workshops isolate algorithmic questions in one deterministic
simulator. The next proposed phase keeps a known scenario while moving execution
into separate processes, so transport and lifecycle effects can be identified.
It should begin with one reproducible message contract and failure case, not a
general platform or several middleware migrations at once.

Flight simulation follows as a separate fidelity step. Software versions,
installation and hardware requirements, supported vehicle counts and exact
acceptance criteria must be checked for that bounded scenario before claiming
it works. No ROS 2, DDS/Zenoh comparison, Gazebo, autopilot or MAVLink integration
is implemented by the current browser workshops.

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

## Optional depth

Distributed auctions such as CBBA, reciprocal collision avoidance such as ORCA,
behavior trees, cooperative estimation and SLAM can become focused later lessons.
Research methods should enter through a precise question and an understandable
baseline. There is no requirement to cover every named technique.
