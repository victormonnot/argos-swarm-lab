# Lesson 01 — Distributed average consensus

**Status:** implemented local workshop. See the [setup instructions](../../README.md#run-locally)
and [measured results](01-consensus-results.md).

**Question:** how do several agents reach agreement through neighbor exchanges?

## Method profile

| Aspect | Implemented choice | Meaning in this lesson |
| --- | --- | --- |
| Algorithm | Distributed average consensus | For a fixed connected graph, local exchanges converge to the initial population mean. |
| Update rule | Linear consensus with constant edge gain | Each neighbor difference contributes with the fixed gain `alpha = 1/12`. |
| Decision architecture | Decentralized, leaderless | Every agent updates from its own value and its neighbors' values. No coordinator supplies the answer. |
| Timing | Synchronous, discrete time | All agents read state `k` before any value from state `k+1` takes effect. |
| Communication | Undirected, unweighted graph | Each link carries values both ways with the same edge gain, without delay or random loss. |
| Topology | Complete graph, chain, or two groups | These presets change the neighbors, while retaining the same algorithm and decision architecture. |
| Available information | Own and current neighbor values | Global mean, disagreement and component membership are evaluator data, not agent inputs. |
| Execution and fidelity | One browser simulation of scalar dynamics | One program simulates six agents making local decisions; spatial views display the same abstract state. |

Show the algorithm name in the page title and opening heading. Keep a concise
method profile visible before the experiment, define topology by its selector,
and label the aspect changed by each guided experiment. The primary reference
and implementation boundaries are listed at the end of this brief.

## Learning objective

Understand how agents with different numbers can approach a common value by
exchanging information with neighbors. Explain why connectivity matters, why
two disconnected groups can disagree and why agreement does not establish that
a number is correct about the outside world.

Start with a visible example before introducing the equation. These are abstract
agents, not simulated aircraft executing a flight mission.

## Workshop contents

The browser lesson contains an explanation, linked 2D/3D views, controls,
state values and disagreement history. It runs without a backend service,
robotics middleware or vehicle physics.

Use six agents with initial values `[0, 2, 4, 8, 10, 12]`. Display identifiers,
values and links. Graph layout is purely visual and has no physical units.

Provide three graph presets:

- Complete graph: every pair exchanges values.
- Chain: edges `(1,2), (2,3), (3,4), (4,5), (5,6)`.
- Two groups: chains `(1,2), (2,3)` and `(4,5), (5,6)`, without a bridge.

## Implemented reference model

Keep this model explicit in the implementation and teaching page. If changed,
update this brief and the expected results together.

For a fixed population of `N = 6`, at each synchronous step:

```text
x_i[k+1] = x_i[k] + alpha * sum(x_j[k] - x_i[k], j in neighbors(i))
alpha = 1 / (2 * N) = 1/12
```

Here `x_i[k]` is agent `i`'s value at step `k`, and `neighbors(i)` is its current
set of linked neighbors. The sum adds their differences from its own value.
Each neighbor coefficient is `alpha`; the self-weight is
`1 - alpha * degree(i)`, where `degree(i)` counts its neighbors. Link edits
therefore change the self-weight while leaving the edge gain fixed. The rule
is linear in the previous state for a given graph.

Every agent uses its own and its current neighbors' values from the previous
step. Compute all next values before replacing any current value. Links are
unweighted and undirected, with no self-edges, duplicates, message delay or
packet randomness. An isolated agent retains its value.

With this gain, each update is a convex combination with positive self-weight
for any allowed graph. Symmetric exchanges preserve the overall mean. On a
fixed connected graph, the values converge to the initial mean. For the default
initial values, that mean is `6`; on the two-group preset, the groups converge
to `2` and `10` respectively. These claims
follow from this declared averaging model, not from arbitrary communication
networks or arbitrary update gains.

Link edits remove or restore both directions at a step boundary. They preserve
the current values. After reconnecting and leaving the graph connected, global
agreement can resume. Do not claim convergence for unrestricted switching,
one-way loss, asynchronous updates or changing membership in this first lesson.

## Controls and views

- Play/pause, advance exactly one model step, and control playback speed (1, 5, 20 or 60 model steps per second).
- Edit initial values and choose a graph preset for a new run.
- Remove or restore links while paused, then continue from the current values.
- Reset to the configured initial values and initial graph.
- Replay the recorded sequence of link edits at their original step indices.
- Switch between 2D and 3D without changing experiment state or history.

Changing initial values or selecting a preset starts a new paused run and clears
the prior event history. A paused link edit affects the next update and is
recorded. Replay starts from the saved initial configuration and applies the
same events. Disable configuration and link editing during replay; the learner
can leave replay and reset before making a new experiment. Keep these semantics
visible in the controls. Replay starts playing automatically and stops at the
recorded final step; it includes any edits made at that final boundary. Runs are
held in tab memory and do not survive a reload.

Show the current step, each agent's value, connected components, initial/current
mean and disagreement curve. The mean, disagreement and connected-component labels are evaluator displays:
agents do not receive them as inputs. Include a textual state table usable without the canvas.

## Metrics and guided experiments

Define disagreement as `D[k] = max(x[k]) - min(x[k])`, in scalar-value units.
Show the first step where `D[k] <= 0.01`; if it is not reached within a
1,000-step comparison budget, report that explicitly. Interactive runs also stop
at this budget. Initial values must be finite numbers within `[-1,000,000,
1,000,000]`; these bounds keep the numerical model and visual scales manageable. For the declared averaging
updates, the range cannot increase. Do not present display rounding as agreement.

| Experiment | Change | What the learner should inspect |
| --- | --- | --- |
| Connectivity comparison | Complete graph versus chain, same values and gain. | Both approach `6`; compare steps to agreement and neighbor exchanges per step. |
| Partition | Start with the two-group preset. | Agreement inside each component can coexist with persistent global disagreement. |
| Recovery | Start with the chain, remove `(3,4)` before the first update, then restore it before update `100`. | Local values evolve while partitioned; a stable connected graph permits global agreement again. |
| Agreement is not correctness | Add `100` to every initial value in the complete-graph run. | Disagreement evolves identically while the mean shifts by `100`; no external truth was measured. |

The update index is zero-based: event `k` applies before the transition from
state `k` to `k+1`. Count one directed scalar exchange per endpoint of each active
edge per update, `2 * edge_count`. This is a model counter, not network-byte usage.

## Acceptance criteria

- The default lesson runs locally using documented, verified setup instructions.
- A learner can reproduce the four experiments using labeled controls.
- Focused model checks cover mean preservation, bounded values, connected-graph
  convergence and the separated component means for these declared cases.
- An isolated-node case retains that node's value; an equal-value input stays
  equal. No global mean is supplied to the agent update as a shortcut.
- Reset/replay reproduce the same numerical trace and event ordering. Changing
  view or playback speed leaves the model's step sequence unchanged.
- Browser verification covers the core controls and both views; numerical
  results are supported by model checks, not visual inspection alone.
- The lesson explains assumptions and limits and includes an actual result
  record. No performance result is claimed until the implementation is run.

## Reference and boundaries

Foundational context: R. Olfati-Saber and R. M. Murray,
[Consensus Problems in Networks of Agents With Switching Topology and Time-Delays](https://www.cds.caltech.edu/~murray/papers/2003f_om04-tac.html),
IEEE Transactions on Automatic Control, 2004. This lesson uses the simple
discrete-time rule above; it does not reproduce every case analyzed in the paper.

Other update rules, directed communication, delay and membership changes are
outside this lesson. GPS/localization loss and mission completion have no
meaning in this scalar-only model.
