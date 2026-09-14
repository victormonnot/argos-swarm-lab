# Module catalog

Consensus and Artificial Potential Fields are implemented local modules. Entries
3–7 are candidate extensions, not implemented features. Each module combines an interactive
experiment with explanations following the [experiment guide](experiment-guide.md).

| Module | Question explored | Bounded experiment and comparison | Concepts covered |
| --- | --- | --- | --- |
| 1. Distributed average consensus | How can local exchanges produce agreement? | Linear consensus with constant edge gain on a complete graph, a chain and disconnected groups; remove and restore links. | Decentralized, leaderless decisions; synchronous discrete updates; communication topology and convergence assumptions. |
| 2. [Artificial Potential Fields](lessons/02-potential-fields.md) | How do local motion rules produce useful or undesirable behavior? | Capped velocity commands from attraction/repulsion in a known map; compare arrival, a U-shaped trap and contact failures. | Decentralized reactive control; finite-range peer sensing; synchronous kinematics; tuning and local traps. |
| 3. Mission execution and allocation | Who should do which task, and when is it complete? | Three agents service predefined observation points; compare fixed allocation, a simple adaptive greedy rule and an appropriate assignment method. Remove an agent mid-run. | Task models, execution states, constraints, reallocation and objective metrics. |
| 4. Decision architectures | What changes when decision authority moves? | Reuse one task scenario with central allocation, subgroup coordinators and peer allocation. Introduce a network partition. | Information access, ownership, stale decisions and architecture tradeoffs. |
| 5. Motion and shared estimates | How do movement constraints and uncertain knowledge affect decisions? | Separate small lessons on path/trajectory execution, local avoidance, and individual versus shared estimates. Add declared synthetic pose error. | Model assumptions, uncertainty, planning interfaces and avoiding double-counted evidence. |
| 6. Distributed software | What changes when the same experiment runs across processes? | Reproduce a known scenario with ROS 2 and Python/C++ components. Compare DDS and Zenoh for a defined communication scenario. | Message contracts, process lifecycle, observability and middleware integration. |
| 7. Flight simulation | Which simplifying assumptions break with an autopilot and vehicle dynamics? | Run a bounded scenario with Gazebo, ArduPilot SITL and MAVLink; document hardware requirements and supported fleet sizes. | Autopilot integration, simulation timing, execution feedback and realistic diagnostic limits. |

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
