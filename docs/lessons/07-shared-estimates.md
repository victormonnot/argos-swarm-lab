# Lesson 07 — Shared estimates and Covariance Intersection

**Status:** implemented locally at `/fusion/`. Numerical results and actual
verification are recorded in the [results report](07-shared-estimates-results.md).

**Question:** if three robots exchange their estimates of the same point, does
every received message contain new information?

The preceding [Kalman lesson](06-localization.md) corrects one robot's estimated
position with fresh observations. Here three stationary agents each observe one
static target once, then exchange information without taking another measurement.
This isolates shared evidence and unknown cross-correlation from motion control.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Local baseline | No sharing | Keep the original observation; send no packets. |
| Failure comparison | Naive independent-information fusion | Add information matrices/vectors, incorrectly treating overlapping summaries as independent. |
| Provenance reference | Unique-measurement fusion | Send a complete ledger, union immutable IDs and fuse each original observation once. A declared reference algorithm, not channel filtering. |
| Correlation-aware method | Covariance Intersection (CI), fixed weight 1/2 | Weight both information matrices/vectors by half; assume no known cross-covariance. No weight optimization or Inverse Covariance Intersection. |
| Decision architecture | Decentralized, leaderless | Every agent updates from its own prior estimate and its one delivered predecessor packet. |
| Timing | Synchronous discrete communication rounds | All senders use the previous boundary; no within-round forwarding. Rounds do not represent seconds. |
| Topology | Directed ring A1 → A2 → A3 → A1 | Link removal changes delivery, independently of the fusion method. |
| Sensing | One synthetic absolute target-position observation per agent | Independent unbiased Gaussian errors in a shared known frame. No later observations, common prior or sensor bias. |
| Evaluator | Target, all observations, source coefficients and actual expected covariance | Visible to the learner; unavailable to Gaussian-summary fusion. Ledger fusion receives only delivered raw records. |
| Fidelity | Static information simulation in one browser | No vehicle motion, localization hardware, range/bearing geometry, mapping, physical radios or middleware. |

## Initial observations and packets

The fixed evaluator target is `t=(6,4) m`. At round zero, each agent obtains
`z_i=t+ε_i`, where the three original errors are mutually independent and
`ε_i ~ N(0,R)` with `R=0.64 I m²`. The two coordinates are also independent.
Each estimate initially equals its own observation and reports `P_i=R`.
The fusion rule has no access to `t` or an observation it has not received.

Seeds are integers 1–1,000,000. An LCG starts from the uint32 value
`imul(seed,2654435761)` and updates with `imul(1664525,state)+1013904223` modulo
2³². Uniform draws are `(state+0.5)/2³²`. Three Box–Muller pairs consume six draws
at initialization, one pair per agent. The same seed supplies the same three
observations to every method and schedule. No random samples occur during rounds.
This is a reproducible synthetic sample, not a validated physical noise model.

A summary packet contains a two-coordinate mean and two equal diagonal covariance
entries. It does not carry measurement IDs or evaluator coefficients. Ledger
packets additionally carry all original records currently known to the sender:
immutable ID `z1`, `z2` or `z3`, observation and covariance. Repeated IDs must retain
identical content; conflicting records are rejected by the fusion helper. This
experiment does not model malicious senders, ID collisions or a security protocol.

The topology has exactly three directed edges. With sharing enabled, each edge
attempts one packet per round. Ring delivers all. Cut drops `A3→A1` from round 1
onward; recovery drops that edge at rounds 1–4 and restores it at round 5.
Other edges always deliver. Packets have zero phase delay, no queue, and are
discarded when dropped. No-sharing sends zero packets for every schedule.

## Fusion rules

For an estimate `(m,P)`, its information matrix is `Y=P⁻¹` and information vector
is `y=Ym`. This implementation handles isotropic two-coordinate covariances, so
the equations reduce to one scalar variance shared by x and y.

**Independent-information fusion:**

```text
Y_next = Y_own + Y_peer
y_next = y_own + y_peer
P_next = 1 / Y_next
m_next = P_next × y_next
```

This is valid for the first pair of independent observations. Later summaries
overlap in their underlying measurements, so the independence assumption fails.
The intentionally naive mode nevertheless applies the same equation every round.

**Unique-measurement fusion:** merge the two record sets by ID, then compute
`Y=Σ_j R_j⁻¹` and `y=Σ_j R_j⁻¹ z_j` over unique records only. With equal R, the
mean is their arithmetic average and `P=R/n`. Original observations are independent
by construction; IDs alone would not make correlated real observations independent.
Already-known records do not reduce uncertainty again. Larger ledgers cost more
logical records per packet than summaries; this is not a scalability solution.

**Covariance Intersection, fixed `ω=1/2`:**

```text
Y_next = 0.5 × Y_own + 0.5 × Y_peer
y_next = 0.5 × y_own + 0.5 × y_peer
P_next = 1 / Y_next
m_next = P_next × y_next
```

CI preserves a consistent covariance bound for consistent input estimates despite
unknown cross-correlations. It does not detect duplicate IDs and cannot repair
arbitrary unmodeled bias or already inconsistent input covariances. All initial
covariances here are exact. They remain equal to R under this fixed-half CI rule,
including when a packet is absent. With equal input covariance, all CI weights
give the same covariance objective; half-weight is a chosen mean-mixing rule.

On a delivered packet, the mean coefficient multiplying the own estimate is
`(1/P_own)/(1/P_own+1/P_peer)` for both naive fusion and fixed-half CI. That
coefficient is distinct from CI's information weight `ω`. With no packet, keep
the complete prior estimate; there is no fictitious update or new observation.

## Evaluating reported uncertainty

Separately from agent inputs, the evaluator tracks coefficients `a_ij` such that
`m_i=Σ_j a_ij z_j`. Initially these are the identity matrix. Summary fusion applies
the same mean-mixing weights to the prior coefficient rows. Ledger fusion uses
one inverse-variance-normalized coefficient per known record. Coefficients are
nonnegative and sum to one; they never enter the agents' fusion calculation.

Given the declared independent sensor model, the exact expected error covariance
for agent i is `C_i=R Σ_j a_ij²`. This is an ensemble expectation across possible
sensor errors, not the squared error of one seed. Reported uncertainty is `P_i`.
The interface compares their traces (sum of x/y variances, in m²) and the ratio
`trace(C_i)/trace(P_i)`. A ratio above one means this isotropic model reports too
little variance. A ratio below one means it is conservative here. This scalar
trace comparison is not a general positive-semidefinite matrix consistency test.

Realized position error is `||m_i−t||` in metres. The final run MSE averages its
square over the three agents. Normalized estimation error squared (NEES) is
`(m_i−t)ᵀ P_i⁻¹ (m_i−t)`; its expectation is 2 for exact unbiased two-dimensional
error covariance. A finite seed sample can exceed that value by chance, and the
three agents' errors are correlated after sharing. No hypothesis test or coverage
certification is claimed. The displayed `2√P` contour is not a 95% joint confidence
region, a guaranteed error bound or a safe region for motion.

For an intact ring, let k denote rounds since initialization. Both summary modes
use the same averaging matrix `(I+S)/2`, with S selecting each predecessor.
They produce identical means, but report different covariances:

```text
Exact expected covariance, naive and CI: C(k) = R × (1 + 2 × 4^(−k)) / 3
Naive reported covariance:               P(k) = R / 2^k
CI reported covariance:                  P(k) = R
Unique-measurement covariance:           P(k) = R / min(k+1,3)
```

At round 2, summary fusion has actual variance `0.24 m²` per axis; naive fusion
reports `0.16 m²`. Double counting therefore begins before a measurement travels
all three edges: the two round-1 summaries already share one original source.
The ledger has all three records by round 2 and reports `0.64/3 m²` per axis.
Further identical information cannot improve that estimate. On a permanently
cut ring, agents retain source counts `[1,2,3]`; under recovery, all three know
all records by round 6. CI can remain conservative while a broken ring makes
its mean drift toward the only upstream agent; a conservative covariance is not
an accuracy guarantee or an optimal estimate.

## Boundary order, controls and records

1. Build all attempted packets from agents at the previous boundary.
2. Apply the declared delivery schedule to each directed edge.
3. Each agent fuses its prior with its delivered predecessor packet, or retains
   its prior if none arrives. Newly fused information waits until the next round.
4. Independently update evaluator coefficients and metrics; record packet and
   update inspection, counters and the shared view snapshot.
5. Stop after round 12. Window completion is not mission success, convergence
   detection or a distributed termination protocol.

Play/pause, step, reset, advance and finish use one fixed numerical sequence.
Method/schedule changes and explicitly applied seed drafts start a paused run.
Reset restores the applied configuration; unapplied drafts have no model effect.
Observer, 2D/3D mode and camera changes are inspections, not simulation inputs.
The network diagram is a communication layout, while map markers denote estimates
of a target, not three moving robots. Both views show the same planar information.

Counters distinguish attempted, delivered and dropped directed packets. Delivered
logical records count one per summary packet and the number of original entries
per ledger packet. They are not bytes, bandwidth, latency or measured runtime.

Compare ten cases: no-sharing/ring and each sharing method on ring/cut/recovery.
The same 12-round window is used throughout. The repeated set applies seeds 1–100
to every case, yielding 1,000 trials. Every trial is retained. Groups average
each trial's three-agent MSE and NEES; agent errors and configurations within a
seed are not independent replicates. Exact expected covariance comes from source
coefficients, not empirical fitting of these one hundred seeds.

Reproduce the numerical artifact with:

```sh
npm run --silent compare:fusion > docs/results/fusion.json
```

The [JSON artifact](../results/fusion.json) includes model contracts, source hash,
revision/runtime, seed-1 observations and full reference summaries, aggregate
metrics and compact per-trial MSE/NEES records. The model API can reproduce full
agent-level summaries for any seed.

## Primary sources

- Simon J. Julier and Jeffrey K. Uhlmann (1997),
  [A Non-divergent Estimation Algorithm in the Presence of Unknown Correlations](https://doi.org/10.1109/ACC.1997.609105),
  American Control Conference, vol. 4, pp. 2369–2373: original CI attribution.
- Benjamin Noack, Joris Sijs, Marc Reinhardt and Uwe D. Hanebeck (2017),
  [Decentralized Data Fusion with Inverse Covariance Intersection](https://publikationen.bibliothek.kit.edu/1000067530/179593312):
  accessible author paper, Eq. 9 for independent fusion, Section 3.2 for shared
  information, Eq. 10 for CI. This lesson uses those review equations; it does
  not implement the paper's Inverse Covariance Intersection method.

The finite ring, fixed half-weight, synthetic observations and measurement-ID
ledger are explicitly declared teaching choices, not claims about a commercial
system or an implementation of every method in these papers.
