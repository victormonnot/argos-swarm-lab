# CBBA task-bundle results

Measured on 2026-09-14 with Node.js 22.22.1. The
[specification](09-cbba.md) defines the fixed utilities, two-task capacity,
consensus protocol and metrics. The [JSON artifact](../results/cbba.json)
records full precision and source/runtime metadata. Reproduce it with
`npm run --silent compare:cbba > docs/results/cbba.json`.

## Twelve-round reference cases

Three stationary agents and six tasks use the same fixed utility rows in every
case. Tasks with exactly one own-bundle claim are uniquely assigned; tasks with
multiple claims are conflicts. Agreement counts matching winner/bid entries
across the three local tables, including agreement on no known winner. It is
separate from exclusive task ownership and from execution, which is not modeled.

| Case | Unique / 6 | Conflicting tasks | Unassigned | Agreed entries / 6 | First global agreement | Valid score | Released entries | Packets delivered / dropped |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| Connected CBBA | 6 | 0 | 0 | 6 | Round 3 | 436 | 5 | 48 / 0 |
| Local greedy, no sharing | 1 | 2 | 3 | 3 | Not observed | — | 0 | 0 / 0 |
| CBBA, permanent partition | 2 | 2 | 2 | 2 | Not observed | — | 2 | 24 / 24 |
| CBBA, restored before round 5 | 6 | 0 | 0 | 6 | Round 7 | 436 | 5 | 40 / 8 |

Each CBBA case attempts 48 directed packets across the twelve-round window.
The local baseline attempts zero. Packet counts include exchanges after the
first observed agreement: there is no distributed termination detector.
Released entries include tasks reacquired later in the same round. The score
is absent when the six tasks are not all assigned exactly once; adding
incompatible local claims would not give a valid allocation score.

## What happens during a release

All agents initially build without hearing from a neighbor:
`A1=[T1,T2]`, `A2=[T1,T4]`, `A3=[T1,T4]`.

During round 1 of the connected case, A2 hears A1's winning bid of 100 for T1,
which beats its own bid of 98. It also retains its own T4 bid of 80 against
A3's competing 79. Nevertheless, losing its first bundle entry releases both
T1 and the later T4. A2 preserves the learned A1 winner for T1, clears its own
released T4 claim and refills with `[T4,T5]`.

The inspector shows received consensus actions, the bundle after release and
the rebuilt bundle, so the unchanged final ownership of T4 does not hide its
temporary release. The model additionally retains post-consensus and
post-release winner/bid snapshots. Static additive scores make T4's new bid
identical; this does not remove the CBBA suffix-release rule.

At round 2, the actual own bundles already form a complete exclusive allocation.
The local winner/bid tables first all agree at round 3, after information travels
another hop. Agreement remains through round 12 in this run. The observation is
made by the evaluator and never delivered as an agent control input.

## Agreement is not an optimum

Both connected and restored runs finish with these acquisition bundles:

| Agent | CBBA bundle | Utility |
| --- | --- | ---: |
| A1 | T1, T2 | 199 |
| A2 | T4, T3 | 82 |
| A3 | T5, T6 | 155 |

The total is **436 points**. The independent exact reference assigns
`A1={T2,T3}`, `A2={T1,T4}`, `A3={T5,T6}`, scoring **522 points** with the same
capacity and exclusivity constraints. CBBA therefore obtains about **83.52%**
of that optimum in this deliberately revealing instance.

A1's strongest individual T1 bid does not identify the best team allocation:
assigning T1 to A2 lets A1 also take the valuable T3. CBBA's greedy bundle
protocol does not perform that global reassignment search. This is a measured
example of suboptimality, not a claim about every CBBA application or a general
benchmark of competing allocation methods.

## Partition and recovery

Under a permanent partition, A1 and A2 reconcile inside their connected
component, while isolated A3 retains `[T1,T4]`. T1 and T4 are still claimed
twice, and T3 and T6 have no own-bundle claimant. Stable local tables do not
establish a common team allocation across the cut.

Recovery restores both A2/A3 directions before round 5. Agents exchange current
snapshots without replaying dropped packets. Complete exclusive allocation
appears at round 6; global table agreement appears at round 7, after restored
exchanges in rounds 5–7. This is three exchanges including the restoration round,
not a measured latency in seconds. The final allocation matches the connected
case in this fixed experiment.

## Actual verification

- **104/104 Node tests passed**, including fifteen new CBBA checks covering
  all consensus rows, stale higher bids, timestamp merging, packet immutability,
  one-hop propagation, suffix release and reacquisition, exclusive allocation
  before agreement, partition/recovery, information isolation, repeatability,
  fixed-budget behavior and the exact reference objective.
- An independent read-only oracle checked **18,225 consensus inputs**, covering
  all seventeen winner-table cases against the official MIT reference rules.
- On **400 positive integer utility matrices**, independent protocol probes ran
  **1,200 connected-chain, complete-graph and restored-link cases**, using three
  or four agents and capacity one or two. Results matched independently
  implemented centralized sequential greedy allocation, preserved local
  capacity/bundle/path invariants and remained stable over the checked window.
  Those helper-level probes are broader than the fixed three-agent interface.
- A separate subset dynamic-programming optimum oracle matched the exhaustive
  allocation helper on all 400 matrices. The fixed four scenarios reproduced
  the scores, conflicts, missing tasks and agreement rounds reported above.
- **58/58 Chromium tests passed**, including six new CBBA tests and all
  fifty-two earlier workshop tests. They cover initial claims, local packet
  inspection, A2's first-round release/rebuild, exclusive allocation before
  agreement, no-sharing and partition counts, round-5 restoration, reset,
  independent comparisons, playback rates, observer/camera invariance,
  mutually exclusive 2D/3D displays, task/agent labels, context loss, unavailable
  WebGL, keyboard controls, 390 px layout and all nine workshop links.
  No page exceptions occurred; deliberate WebGL unavailability produces
  Three.js's expected context-creation diagnostic.
- The production build passed for nine HTML entries. The existing optional
  Three.js chunk retains Vite's large-chunk advisory and loads only when a 3D
  view is requested.
- Production-preview checks passed all nine routes and navigation, local
  suffix-release inspection, round-2 exclusivity versus round-3 agreement,
  isolated 3D inspection, permanent partition, restoration, all four independent
  comparison rows, mobile layout and usable back navigation without browser
  errors or failed requests. The final production build also passed a timed
  three-round playback check. Desktop, local-inspection, 3D and mobile captures
  were visually reviewed.
- An independent final audit matched the artifact's source hash, parameters,
  utilities, initial bundles, exact optimum and four full-precision summaries.
  The published result tables and phase descriptions match those values.

This experiment does not evaluate task service, motion, sensor quality, real
network transport or physical robots. Rich path-dependent scores, time windows,
changing task sets and asynchronous CBBA variants are outside its scope.
