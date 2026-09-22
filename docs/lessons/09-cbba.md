# Lesson 09 — Consensus-Based Bundle Algorithm

**Question:** how can agents resolve competing task bundles using only local
communication, and what remains unresolved when the network separates?

**Status:** implemented locally at `/cbba/`. The
[results report](09-cbba-results.md) records measured outcomes and verification.
This is a bounded allocation experiment with three stationary planners and
six known tasks.

The [mission-allocation lesson](03-mission-allocation.md) uses one coordinator
and executes assigned tasks. Here **CBBA — Consensus-Based Bundle Algorithm**
lets each agent build its own ordered bundle and reconcile competing claims
with neighbors. This experiment isolates allocation: a claim is not a completed
task, and lines on the map are plans rather than executed vehicle trajectories.

## Method profile

| Aspect | Declared choice | Meaning |
| --- | --- | --- |
| Algorithm | CBBA with static additive task utilities | Greedy bundle construction alternates with timestamped winner reconciliation and suffix release. |
| Baseline | Independent local greedy bundles | The same agents build bundles without exchanging or resolving conflicting claims. |
| Architecture | Decentralized and leaderless | Each agent knows its own utility row and local winner beliefs; no coordinator supplies decisions. |
| Timing | Synchronous discrete communication rounds | Packets are formed from one old snapshot, without forwarding newly received information in the same round. |
| Communication | Neighbor packets with winner IDs, winning bids and source timestamps | Links deliver or drop the current packet. No physical radio, delay queue or middleware is modeled. |
| Topology | Connected chain, partition and restoration | A fixed schedule changes delivery; agents only observe delivered packets. |
| Agent inputs | Known task catalog, own utilities and received local information | An agent does not read another agent's private utility row, future schedule or evaluator optimum. |
| Evaluator | All bundles, duplicate claims, agreement and global allocation score | These diagnose the experiment; they are not consensus inputs or task-completion evidence. |
| Execution / fidelity | One browser planning model, shared 2D/3D display | No robot moves, performs service or automatically executes a potentially conflicting assignment. |

## Scores, bundles and information

Three agent planners share a catalog of six tasks. Each can retain at most two
tasks. Utilities are fixed, positive teaching values in arbitrary score points:

| Agent | T1 | T2 | T3 | T4 | T5 | T6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 100 | 99 | 90 | 20 | 20 | 20 |
| A2 | 98 | 3 | 2 | 80 | 10 | 9 |
| A3 | 97 | 3 | 2 | 79 | 78 | 77 |

An agent receives its own row, not the complete matrix. The complete matrix is
evaluator information when displayed for comparison. Map coordinates identify
agents and tasks visually; distance does not enter these utilities. No sensor,
route, battery or task-service model is inferred from these numbers.

For an agent `i` and bundle `b`, the score is `S_i(b)=Σ_{j∈b} u_ij`. The marginal
bid for an absent task is `u_ij`, independently of previously acquired tasks.
This is an additive special case of diminishing marginal gain: adding other
tasks never increases a candidate's marginal value (here it stays equal).
It omits the path-dependent timing and travel scores used in more complex CBBA
applications.

The **bundle** is acquisition order. The **path** in general CBBA is a proposed
execution order and need not match the bundle. With these path-independent
utilities, all insertion positions tie; this lesson appends the new task, so
its displayed path and bundle coincide. That ordering is not a computed shortest
route, and no path is physically executed.

Each agent stores a winning-bid vector `y`, a believed-winner vector `z` and a
timestamp vector `s`. `s[k]` tracks fresh communication information about agent
`k`; it is not a separate timestamp for each task, nor a physical clock in seconds.
Packets contain these local beliefs rather than another agent's private utility
row or complete bundle. The evaluator can inspect all bundles independently.

Initial bundle construction deliberately precedes any exchange. A1 claims
`[T1,T2]`, while A2 and A3 each claim `[T1,T4]`. These competing local plans
are allowed during allocation; the experiment does not execute them.

## Bundle construction and conflict resolution

During greedy construction, an agent considers tasks not already in its bundle
whose own marginal bid can beat its current local winning bid. Larger bids win;
equal bids prefer the lower agent ID. Equal candidate task scores prefer the
lower task ID. The selected task is appended, and the local winner/bid vectors
record the agent's own claim. Construction stops at capacity or when no local
candidate can be won.

Consensus is the original CBBA winner-reconciliation table, not a rule that
unconditionally takes the maximum received number. For every task, decisions
depend on who the sender and receiver believe won, their bid comparison and
the freshness of their information about third-party agents. A received entry
can update a local belief, leave it unchanged or reset it to no known winner.
Freshness prevents blindly retaining an obsolete claim simply because its bid
was large. The implementation names the source-table case used for inspection.

After consensus, find the first bundle entry the agent no longer believes it
owns. Release that entry and the entire suffix after it. Preserve a learned
other-agent winner; reset later bids still attributed to self. Remove those
tasks from the path too, then greedily build again. A suffix entry may therefore
be released and reacquired in the same round. The inspector records both actions
instead of hiding the intermediate release.

Static utilities make some reacquired bids numerically unchanged. The suffix
rule is retained because it is part of CBBA's bundle protocol; this teaching
variant is not a generic auction presented under the CBBA name.

## Topology, packet timing and controls

The underlying bidirectional chain is `A1 ↔ A2 ↔ A3`, with four possible
directed packets per communication round. The connected schedule delivers all
four. The cut schedule drops both `A2 ↔ A3` directions from round 1 onward.
Recovery drops those packets in rounds 1–4 and restores both directions before
round 5 sends. Dropped packets are discarded; restoration has no backlog.
The independent local-greedy baseline sends zero packets under every schedule.

The run begins at round 0 after each agent's first greedy bundle construction,
with zero timestamps and no received packets. One step then performs:

1. Copy every outgoing winner, bid and timestamp vector from the old boundary.
2. Apply the delivery schedule without exposing undelivered packets to agents.
3. Each receiver processes its delivered packets in ascending sender-ID order.
   Apply the seventeen-case consensus rule to every task entry. After all tasks
   in that packet, merge the timestamp vectors and set the sender's timestamp
   to the receiving round. The receiver's own timestamp slot remains unchanged.
4. Record post-consensus beliefs, release the invalidated bundle suffix, record
   post-release state, then greedily refill from local information.
5. Update the separate evaluator, message counters, events and history.

No receiver forwards a newly updated table in the same round. Sequentially
processing the receiver's incoming packets is an explicit deterministic choice;
it does not let a sender read another receiver's new bundle. Every payload has
six winner IDs, six bids and three per-agent timestamps. Logical packet counts
are not bandwidth, network latency or runtime measurements.

All cases execute a fixed twelve-round window, even after the evaluator sees
agreement. The final status means that window ended, not that a distributed
termination detector fired. No agent receives the global agreement observation,
and no task execution begins automatically.

Play/pause, one-round step, advance-to-before-restoration (round 4) and finish
operate on the same model. The next step from round 4 sends the restored round-5
packets. Method or schedule changes start a paused run; capacity remains fixed at
two. Reset reproduces the applied configuration. Observer, camera and 2D/3D
switching change inspection only. The comparison table uses independent copies.
Unavailable WebGL leaves the 2D display and numerical controls usable.

Layout coordinates are `A1=(1,1)`, `A2=(1,3)`, `A3=(1,5)`, with
`T1=(5,1)`, `T2=(8,1)`, `T3=(5,3)`, `T4=(8,3)`, `T5=(5,5)` and `T6=(8,5)`.
They are abstract display units. Claim edges denote current own-bundle entries,
not the winner believed by every other agent. Communication links are the
separate chain above. A task may have multiple claim edges while allocation is
unresolved. Both views show the same stationary nodes and current claims;
height, camera movement and line crossings have no physical meaning. The 3D
view uses detailed stationary quadrotors at a fixed display height of 1.2 units,
volumetric task stations and a bounded illustrative yard. Colored station bands
identify each current claimant; an orange beacon indicates competing claims.
Elevated solid curves represent own-bundle claims, while dashed links represent
the communication chain. The rotors and poses do not animate with protocol
rounds. Whole-site and selected-agent cameras change inspection only.

## Comparing quality without inventing execution

The separate exact reference maximizes the same total utility over assignments
with each task owned once and each agent within capacity. Enumerating this tiny
problem uses all utility rows in the evaluator. It supplies neither a bid nor
an owner to a CBBA agent, and it is not a scalable replacement implementation.

Duplicate local claims cannot be added into a valid team score. Global agreement
on winners, exclusive ownership, complete allocation and optimal score are
different measurements. Even a valid full allocation is still a plan: completed
tasks are not modeled here.

| Metric | Exact meaning |
| --- | --- |
| Unique assigned tasks | Tasks appearing in exactly one agent's own bundle, out of six. |
| Conflicting tasks | Tasks appearing in two or more own bundles; count tasks, not extra copies. |
| Unassigned tasks | Tasks appearing in no own bundle. These three counts sum to six. |
| Agreed task entries | Tasks for which all three local winner IDs and winning bids match, out of six. Agreement on no known winner also counts as matching. |
| Global agreement | All six winner/bid entries match across agents; timestamp vectors need not match. |
| First agreement round | First boundary with that global agreement, including round zero if applicable; not a proof of permanent stability under other inputs. |
| Complete exclusive allocation | No conflicts and no unassigned tasks, with the model's per-agent capacity invariant. |
| Valid allocation score | Sum of utility for the six exclusive owners, shown only for a complete exclusive allocation; otherwise absent. Agreement can arrive later. |
| Exact score ratio | Valid allocation score divided by the exact reference score for the same full assignment problem. |
| Released entries | Cumulative count of tasks removed from bundle suffixes, including entries later reacquired. |
| Attempted / delivered / dropped | Directed logical packets over the modeled chain. No-sharing has zero of all three. |

Reproduce four reference cases with:

```sh
npm run --silent compare:cbba > docs/results/cbba.json
```

The [artifact](../results/cbba.json) records parameters, source hashes, runtime,
base revision and full-precision outcomes. These deterministic cases do not
establish universal convergence time, optimality or physical mission performance.

## Learning loop and acceptance criteria

1. Inspect the initial local bundles and predict which tasks agents will claim
   simultaneously before they hear from their neighbors.
2. Step through delivered winner/bid information. Identify which local belief
   changes and why an earlier loss releases the remainder of a bundle.
3. Distinguish bundle acquisition order from a physical execution route. Static
   utilities make path insertion ties uninformative in this bounded variant.
4. Compare connected, partitioned and restored exchanges from identical inputs.
5. Compare local claims, global agreement and the quality of a valid allocation.
   None measures executed work in this lesson.

Acceptance requires a reproducible connected result and a revealing disconnected
case, inspection of local packets and released bundle suffixes, explicit score
and capacity rules, meaningful tests of consensus branches and information
boundaries, and linked displays that do not change the numerical run.

## Primary method source

Han-Lim Choi, Luc Brunet and Jonathan P. How (2009),
[Consensus-Based Decentralized Auctions for Robust Task Allocation](https://doi.org/10.1109/TRO.2009.2022423),
IEEE Transactions on Robotics 25(4), 912–926. The
[MIT Aerospace Controls Laboratory project](https://acl.mit.edu/projects/consensus-based-bundle-algorithm)
distinguishes original CBBA from asynchronous, coupled-constraint and
communication-aware extensions. Those extensions are outside this workshop.

The [MIT publication record](https://dspace.mit.edu/handle/1721.1/52330)
provides the published paper. The laboratory's
[July 2010 MATLAB reference](https://acl.mit.edu/files/CBBA_MATLAB_ACLMIT_July13_2010.zip)
was checked for the seventeen consensus cases, timestamp handling and suffix
removal. This lab runs its own JavaScript implementation; no MATLAB runtime,
time-window solver or robotics middleware is installed or executed.
