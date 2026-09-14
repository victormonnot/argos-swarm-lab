# Interactive lesson and experiment guide

## A lesson's learning loop

1. **Understand:** state the question in plain language and give a concrete example.
2. **Predict:** ask the learner what should happen when one condition changes.
3. **Manipulate:** offer play/pause, one-step execution, reset and relevant controls.
4. **Inspect:** show agent state, available information, events and outcome metrics.
5. **Explain:** connect observations to the rule, assumptions and method source.
6. **Compare:** rerun an explicit baseline or failure case under comparable conditions.

The web page should bring these elements together. Prefer explanatory labels,
visible numerical values and a small number of useful controls. Support keyboard
operation and do not encode important state using color alone.

## Name the method and explain its aspects

Each lesson page and its written brief must show the recognized algorithm name
near the start, alongside the question it explores. Expand an acronym on first
use when one is established. Name the implemented variant explicitly; do not
present a broad family or a paper title as a uniquely specified algorithm.

Use a short, visible method profile with consistent fields and a plain-language
explanation next to each technical term:

| Aspect | What the learner should be able to identify |
| --- | --- |
| Algorithm and variant | The named rule and the specific version being executed. |
| Decision architecture | Who decides, whether a leader/coordinator exists, and which information each decision uses. |
| Update timing | Whether updates are synchronous/asynchronous and time is discrete/continuous. |
| Communication model | Direction, weights, and assumptions about delays or loss. |
| Network topology | Who exchanges with whom, distinguished from the update rule. |
| Agent inputs and evaluator data | Which values agents can use and which are global observations for the learner. |
| Execution and fidelity | One browser simulation, separate processes, or a physical model; state what is actually implemented. |

Keep the principal name and essential aspects visible without opening a tooltip.
Define symbols beside equations. Link the declared method to a primary reference
and explain which part is implemented. Mark an undecided or inapplicable aspect
explicitly rather than inventing a method name for a future module.

Label what each comparison changes: algorithm, architecture, topology, link
schedule or initial conditions. For example, the first lesson implements
**distributed average consensus** with a **constant edge gain**, **decentralized,
leaderless** decisions and **synchronous, discrete-time** updates. Complete,
chain and two-group graphs are topologies of the same algorithm. The coefficient
on an agent's own value depends on its number of neighbors, so "constant edge
gain" is more precise than an unqualified "constant weights".

## 2D and 3D views

Both views consume the same experiment state and event history. Switching views
must not advance, reset or rerun the model. Rendering speed is distinct from
simulation time; replaying an event sequence must reproduce the same outcome.

In an abstract graph lesson, node positions are layout coordinates. Moving a
node does not change communication unless a distance-based communication model
has explicitly been introduced. Clearly label the fidelity of each experiment:
abstract dynamics, kinematic simulation or flight-physics simulation.

## State what the experiment assumes

Each lesson specifies the objective, agent information, update timing, dynamics,
communication model and success criteria. Keep evaluator-only truth separate
from agent inputs. A global display may show everything for teaching without
silently giving that knowledge to each agent.

| Disruption | Declare in the model | Report |
| --- | --- | --- |
| Agent unavailability | Whether the agent stops, disconnects or becomes unable to execute tasks; how peers can detect this. | Unfinished work, detection delay, reassignment, duplicates and remaining capacity. |
| Communication | Which directions fail; whether messages are dropped, delayed or disconnected; what recipients know. | Stale information, disagreement, completion and recovery. |
| Localization | Which measurement is removed or degraded and what estimator/input remains. | Estimate error against evaluator truth and the effect on execution or completion. |

Removing a modeled GPS measurement may be called GPS loss. Adding noise to an
otherwise perfect position input is a synthetic localization-error experiment.
Continuing to supply perfect world coordinates after a loss is not a test of
operation without that measurement. Stopping or requesting help can be a valid
outcome under the declared mission policy.

The consensus lesson models undirected link removal only. It does not implement
radio propagation, failure detection, agent loss or localization.

## Compare and measure honestly

Use the same initial conditions, task set, budget and disruption schedule when
comparing methods, unless a declared difference is the subject of the lesson.
For stochastic experiments, record seeds and use repeated runs before claiming
an advantage. Keep a simple reference method even when an advanced method exists.

Metrics must have explicit units, thresholds, denominators and timeout behavior.
Examples include agreement error, completed task fraction, completion time,
duplicate work and recovery time. Define recovery relative to the event and
desired behavior, including cases that never recover within the run budget.

Count simulated messages as messages. Payload-size estimates are not measured
network traffic. A simulator knows when it injects a failure; an agent only knows
what its observations or detection policy reveal.

Introduce saved experiment records when the first lesson needs replay. A small
record of configuration, initial state, step-indexed events and results is enough;
a general benchmarking framework is not required. Once implementations exist,
include code revision and relevant software versions with reported results.

## Evidence for a completed lesson

- A runnable nominal case and an intentionally revealing failure or limitation.
- An explanation of the observed behavior and its primary references.
- Focused checks of properties the lesson actually claims.
- A documented way to replay the comparison, with observed outcomes.
- An explicit statement of what remains outside the model.

Do not report planned tests as passed or screenshots as proof of numerical
correctness. A newly discovered failure is useful evidence when explained.
