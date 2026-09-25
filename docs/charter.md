# Project scope and design principles

## Purpose

Provide interactive, reproducible experiments that help users understand and
compare multi-robot algorithms and architectures. The tool combines explanations,
state visualization, configurable scenarios and quantitative results.

Serve both curious visitors and technical readers through accessible explanations
and technical detail. Twenty-three workshops combine interactive lessons with
inspectable state, reproducible comparisons and explicit limitations.

The supported experiments use browser models or recorded software execution
with declared simulated inputs and dynamics. Physical deployment is outside
the current scope.

## Design principles

- A standalone tool with English documentation and interface text.
- Web lessons that combine explanations with manipulable 2D and 3D experiments.
- Present algorithms, decision architectures and software stacks as distinct topics.
- Study agent unavailability, communication disruption and localization loss
  when the experiment actually models the affected information.
- Preserve the learning loop established by the first agreement lesson.
- Grow the lab from working lessons rather than building a general platform first.
- Connect workshops to concepts and sources without presenting demonstrations,
  product announcements and research results as equivalent evidence.

The [module catalog](learning-path.md) describes the available workshops and
their implemented algorithms, software integrations and limits.

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
representations of an abstract or kinematic model. Later physics simulations
introduce a separate level of fidelity and declare their own assumptions.
Mode and fidelity are independent: interactive browser models differ from
recorded replays of external processes, and neither is a live mission interface.

## Implementation boundaries

Keep experiment state, rendering, page interaction and evidence validation
separate without inventing interfaces for every possible future simulator.
The current web implementation uses HTML/CSS/JavaScript, Vite, SVG and Three.js.
The [README](../README.md#implementation) documents the components and the role
of each dependency.

Bounded SLAM workshops are implemented. Python, C++, ROS 2, middleware and
autopilot/Gazebo simulation support optional local recording workflows for the
later workshops. Their browser pages replay saved evidence; visitors do not need
those runtimes installed. No cloud account, physical drone, external service or
user authentication is required to use the workshops.

The browser does not supervise live missions. The recorded nominal and failure
cases are bounded experiments, not a general mission robustness benchmark.
Physical deployments, learned policies and language-model interfaces are outside
the implemented scope.

Specifications distinguish abstract models, software integration and physical
simulation. Document the assumptions and validation supporting each experiment;
results apply within those stated limits.

## Module acceptance

A completed lesson has a runnable example, a clear explanation, an honest
comparison, a failure or limitation the learner can reproduce, and checks that
support its stated behavior. A polished image by itself is insufficient.

Each workshop has its own implementation brief and results report, starting with
the [consensus brief](lessons/01-consensus.md). These documents state the model,
supported interactions, verification and limits of the reported results.
