# Lesson 04 — Decision architectures under a network partition

**Status:** implemented locally at `/architecture/`. See the
[measured results](04-decision-architectures-results.md) for outcomes and actual checks.

**Question:** who can assign the next task, and who can confirm completion when
the network separates working agents?

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Allocation rule | Nearest-pair greedy matching | Same distance rule as lesson 3: repeatedly select the shortest remaining idle-agent / eligible-task pair. |
| Central architecture | Single coordinator C | C alone issues assignments from its delivered reports and reservation ledger. |
| Hierarchical architecture | Predelegated subgroup coordinators | A1 controls one task domain; A2 controls a second domain for A2/A3. C delegates these rights before the run, then monitors reports. |
| Peer architecture | Replicated greedy decisions with a unanimous round barrier | Each agent independently computes a plan from its own report cache, exchanges it with the other two and applies only its own assignment after matching all three plans. |
| Execution | Finite-state machine, retained across disconnection | Agents continue travelling and servicing their accepted task; no agent fails in this lesson. |
| Timing | Synchronous rounds at 0.1 s boundaries | Execute one interval, update links, deliver reports, compute plans, exchange peer plans if needed, then apply commands. |
| Communication | Direct, symmetric links; exact delivery on active links | Dropped packets do not arrive later. Links stay unchanged throughout both communication phases of a boundary. No forwarding, random loss or asymmetric failures. |
| Agent and controller inputs | Own state, declared catalog/permissions, delivered reports | A planner receives only its own cache, static scope and current round. It does not receive transport truth, physical task truth or the future disruption schedule. |
| Evaluator | Physical progress, confirmation coverage and message counters | A global display may compare reality with every observer's cache without giving that knowledge to a controller. |

The peer rule is a declared pedagogical protocol, not an implementation of Raft,
Paxos, an auction or the Lamport logical-clock algorithm. The recognizable
architecture terms and greedy rule are named separately from this protocol.

## Same physical mission; explicit authority differences

Reuse the three starts, six task coordinates, `1 m/s` straight-line speed and
`2 s` uninterrupted service from [lesson 3](03-mission-allocation.md). There are
no obstacles, collisions, physical agent failures or vertical motion. All tasks
exist at time zero and remain known as a static catalog.

The hierarchy predelegates these disjoint domains:

| Coordinator | Executors allowed | Tasks allowed |
| --- | --- | --- |
| A1 | A1 | T1, T4 |
| A2 | A2, A3 | T2, T3, T5, T6 |

There is no domain transfer or leader election during a run. This **changes task
eligibility**, in addition to moving authority. Its nominal cost difference is
not evidence of an intrinsic cost of all hierarchical architectures. Central
and peer architectures retain the whole task domain and the same greedy rule.

## Transport and observer caches

The four endpoints are `C`, `A1`, `A2`, `A3`. C is a monitoring/coordination
process, not a fourth moving executor. Communication membership is independent
of physical position. The presets are:

- Always connected: every endpoint pair has a link.
- Permanent partition: at boundary `k=20` (`2.0 s`), split into `{C,A1}` and
  `{A2,A3}` through the rest of the 600-update / 60 s budget.
- Restoration: the same cut, then all links return at `k=80` (`8.0 s`).

The cut affects messages at steps 20–79 in the restoration case. The interval
ending at the cut still executes; the new link state applies before its reports.
A link outage does not diagnose a failed executor or cancel its existing job.

At every boundary, including step zero, each agent samples its own report:
`{agentId, step, position, state, taskId, completed}`. Its own cache update
is local. It attempts to send this report directly to the other two agents and
C: **nine remote report attempts per boundary**, for every architecture. This
common dissemination pattern is deliberate; it does not represent the minimum
traffic needed by each architecture.

Receivers retain only delivered reports, including their sampled round. Completed
task IDs accumulate monotonically from these reports. Reservations record known
owners; a missing report does not release a reservation. Only a received
completion clears the corresponding reservation. Reports are sampled before
new assignments at that boundary, so a zero-age report can still precede a newly
accepted target. This phase distinction is shown in the inspector.

There is no retry queue. Current reports include the owner's full completion
list, so restored delivery communicates earlier finished work. Packet phases
take zero model time. Counters distinguish report, proposal and command messages,
attempted/delivered/dropped; they are not measured bandwidth or network latency.
Local cache updates and self-commands do not count as network messages.

## Decision rules and ownership

**Central:** C matches currently idle agents only if their report is from the
current round. A task must be neither known completed nor reserved. Reports may
be missing for other agents; their tasks stay reserved. C sends chosen targets
over the corresponding active link. Since links are stable throughout the round,
a target whose fresh report reached C is reachable for that command.

**Hierarchy:** apply the same central rule independently at A1 and A2, restricted
to their predelegated executors and tasks. A coordinator's command to itself is
local. Root C receives the same common status broadcasts but does not assign or
rebalance tasks. Local decisions can continue inside the declared groups during
this particular partition.

**Peers:** each agent knows the fixed roster `{A1,A2,A3}`. Each independently:

1. Requires a current-round report from every roster member. An old report does
   not satisfy this barrier. There is no simulator-supplied component membership.
2. Runs the same greedy function on its own current reports and reservation
   ledger. It sends its nonempty plan to the other two agents. Empty plans need
   no agreement messages because no assignment would change.
3. Requires same-round, exactly matching plans from all three members, including
   itself. It records the agreed reservations and applies only its own target.

There is no central choice of the peer matching and no global readiness flag
used by the peers. The simulator orders the stated phases and transports packets.
Under the declared complete-graph or clique-partition transport, the barrier
preserves a common decision state; during a partition no peer gets the full
roster and no new assignment is attempted. Previously assigned tasks continue.

These rules retain ownership instead of treating silence as a reason to issue
the same job twice. This lesson does not claim safety or liveness for arbitrary
asymmetric loss, different local clocks, mid-phase topology changes, crashes or
Byzantine participants. Those cases require a different protocol and proof.

## What counts as completion?

**Physical completion:** an executor finishes all 20 service intervals. The
evaluator derives task truth from executor work, without using that truth in
allocation decisions. The first time all six jobs physically finish is recorded.

**Confirmed coverage:** C's known-completed count for central/hierarchical runs;
the minimum known-completed count among A1, A2 and A3 for peer runs. This latter
metric is a conservative evaluator summary, not common knowledge or a global
termination protocol available to any individual peer.

The run stops as completed when all six tasks are physically finished and this
confirmation coverage is six. Otherwise it reaches the **60 s budget**, even
if all work physically finished earlier. A controller's inability to confirm
remote work does not mean that work failed. Idle agents do not trigger an early
stop because restored communication may permit further decisions.

Display both counts, model time, first physical completion time, actual task and
agent state, a selected observer's reports/reservations, report age, decision
authority and barrier state. Show packet counters and an event log. A stale
report is labeled stale, never treated as proof of agent loss.

## Controls and acceptance

Switch architecture or network preset to start a fresh paused run. Provide
play/pause, fixed steps, reset, advance to 2/8 s and run to the final outcome.
Playback speed only changes scheduling. Selecting an observer, switching 2D/3D
or moving the camera never changes model state. The physical map and network
schematic have distinct meanings. Navigation/reload loses the in-memory run.

Compare all nine architecture/network combinations with the same physical task
set, budget and network schedule. Verify trace equality between central and peers
when connected, no new peer assignments during the cut, retained reservations,
stale reports versus actual completion, recovery, exact packet accounting,
ownership exclusivity and deterministic reset. Validate the user-visible
controls and 2D/3D invariance, and record only checks actually run.

Export the same nine reference runs with:

```sh
npm run --silent compare:architectures > docs/results/architectures.json
```

The [JSON artifact](../results/architectures.json) records model settings, source
hashes, runtime, base revision and whether the working tree was modified.

## Primary reference and limits

Leslie Lamport (1978), [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.org/pubs/time-clocks.pdf),
Communications of the ACM, 21(7), 558–565. The discussion of independent processes
following common rules and depending on participation provides context for the
replication/barrier tradeoff. This workshop uses its own synchronous protocol,
not the paper's logical clocks or distributed mutual-exclusion algorithm.

Do not generalize a reference outcome to every centralized, hierarchical or
decentralized system. Scope delegation, reservation policy, fixed-roster waiting
and the common report transport are explicit parts of these compared designs.
