# Project scope and design principles

## Purpose

Provide interactive, reproducible experiments that help users understand and
compare multi-robot algorithms and architectures. The tool combines explanations,
state visualization, configurable scenarios and quantitative results.

Simulation is the supported environment for the planned modules. Physical
deployment is outside the initial scope.

## Design principles

- A standalone tool with English documentation and interface text.
- Web lessons that combine explanations with manipulable 2D and 3D experiments.
- Present algorithms, decision architectures and software stacks as distinct topics.
- Study agent unavailability, communication disruption and localization loss
  when the experiment actually models the affected information.
- Start with one complete lesson about agreement through neighbor exchanges.
- Grow the lab from working lessons rather than building a general platform first.

The [module catalog](learning-path.md) describes possible extensions. Their
algorithms and dependencies remain subject to each module's requirements.

## Three independent questions

| Layer | Question | Example |
| --- | --- | --- |
| Algorithm | What rule produces a decision or action? | Averaging, greedy assignment, an auction. |
| Decision architecture | Who decides, using what information? | A central allocator, subgroup coordinators, autonomous peers. |
| Software stack | How does the system execute and exchange data? | A browser model, separate processes, robotics middleware. |

Several processes can still implement centralized decision-making. Conversely,
one simulator can represent decentralized decisions if each simulated agent
only uses the information its model permits.

## Learning experience

The learner should be able to predict an outcome, run the experiment, inspect
what each agent knows, change one condition and explain the difference.
Mathematics supports that explanation, introduced alongside concrete examples.

Each lesson uses 2D and 3D views of the same state. Early 3D views are spatial
representations of an abstract model. Later physics simulations introduce a
separate level of fidelity and must declare their own assumptions.

## Implementation boundaries

The first lesson needs an experiment model, a user interface and a few meaningful
checks. Keep those responsibilities separate without inventing interfaces for
every possible future simulator. Choose a small web stack when implementing the
lesson. Document the chosen dependencies and rationale with the implementation.

Python, C++, ROS 2, middleware and autopilot simulation are candidate technologies
for later modules. They are not required dependencies of the first web page.
SLAM, learned policies and language-model interfaces remain optional topics.
No cloud account, physical drone, external service or user authentication is
required for the first lesson.

Specifications distinguish abstract models, software integration and physical
simulation. Document the assumptions and validation supporting each experiment;
results apply within those stated limits.

## Module acceptance

A completed lesson has a runnable example, a clear explanation, an honest
comparison, a failure or limitation the learner can reproduce, and checks that
support its stated behavior. A polished image by itself is insufficient.

The first lesson's completion criteria are in its
[implementation brief](lessons/01-consensus.md). Hardware purchases, a complete
curriculum and public deployment are not part of that delivery.
