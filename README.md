# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination.

ARGOS Swarm Lab is designed to combine web lessons with reproducible simulations.
Each module connects an algorithm or architectural choice to an experiment:
change a parameter, observe collective behavior, introduce a failure and compare
the results. Linked 2D and 3D views expose agent state and interactions.

**Status:** documentation only. There is no application, implemented lesson or
installation procedure yet. The documents below specify the planned tool.

## Planned capabilities

- **Algorithms:** agreement, task allocation, planning and collective movement.
- **Decision architectures:** centralized, hierarchical and decentralized control.
- **Software stacks:** how an algorithm becomes a running robotic system.
- **Degradation:** what remains achievable when agents, communication or
  localization information become unavailable.

Each experiment declares its model assumptions and exposes relevant metrics.
Abstract 3D views represent algorithm state; flight dynamics require a separate
physics simulation.

## Initial module: consensus

**How do several agents reach agreement?**

Six agents start with different numbers. Each adjusts its number using values
received from its neighbors. Explore the same experiment in 2D and 3D, remove a
link, split the group, reconnect it and watch the disagreement curve change.

The [module specification](docs/lessons/01-consensus.md) defines the model,
controls, comparisons and acceptance criteria.

## Read next

| Document | Purpose |
| --- | --- |
| [Project scope](docs/charter.md) | Purpose, design principles and implementation boundaries. |
| [Module catalog](docs/learning-path.md) | Proposed topics, experiments and concepts. |
| [Experiment guide](docs/experiment-guide.md) | Lesson format, comparisons and failure-model rules. |

The catalog distinguishes the initial module from possible extensions. Additional
modules and integrations will have their own specifications and validation.
