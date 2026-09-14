# Lesson 08 — Optimal Reciprocal Collision Avoidance

**Question:** how can moving agents share responsibility for avoiding collisions,
and why can avoiding contact still leave a journey unfinished?

**Status:** implemented locally at `/orca/`. The
[results report](08-orca-results.md) records measured outcomes and verification.

The [potential-field lesson](02-potential-fields.md) used attraction and repulsion
to command motion. This experiment compares that kind of reactive rule with
**Optimal Reciprocal Collision Avoidance (ORCA)** on a crossing with separate
goals. The [pathfinding lesson](05-pathfinding.md) answers a different question:
how to search for a route through a known map. This lesson has no walls or route
search; it studies the next local velocity.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Algorithm | ORCA, planar disks with equal half-responsibility | Each neighbor supplies a velocity half-plane; choose the feasible velocity nearest the preferred goal velocity. |
| Baselines | Artificial Potential Fields (APF); direct goal following | APF adds finite-range surface repulsion to attraction; direct ignores peers. The same geometry, speed cap and budget apply. |
| Architecture | Decentralized and leaderless | Each decision uses only the agent's own state, goal and observed peer external states. |
| Timing | Synchronous, fixed-step kinematics | All commands read one pre-movement snapshot and execute together. |
| Sensing | Exact positions, velocities and known disk radii | The blind scenario removes peer observations. No noisy localization, occlusion or delayed measurements. |
| Communication / topology | No messages or communication network | Observing a neighbor is sensing, not exchanging its goal or future command. |
| Evaluator | All positions, swept clearance, arrival and infeasible-decision count | Global measurements describe the outcome and terminate the experiment; they are not controller inputs. |
| Fidelity | One browser simulation of holonomic planar disks | Instantaneous velocity changes, no acceleration or turning limit, vertical escape, autopilot or real robot dynamics. |

## Initial conditions and parameters

Positions and goals are in metres. Every initial velocity is zero.

| Scenario | Starts → goals | Peer observations |
| --- | --- | --- |
| Offset crossing | A1 `(-4,-0.15) → (4,-0.15)`; A2 `(0.2,-4) → (0.2,4)`; A3 `(4,0.25) → (-4,0.25)` | All other agents, exact external state. |
| Symmetric head-on | A1 `(-4,0) → (4,0)`; A2 `(4,0) → (-4,0)` | The other agent, exact external state. |
| Crossing without peer sensing | Identical to offset crossing | Empty peer list for every agent; own state and goal remain available. |

| Parameter | Value | Meaning |
| --- | --- | --- |
| Physical disk radius | 0.30 m | Used by every method and the clearance evaluator. |
| ORCA padding | 0.01 m per disk | ORCA constrains radius 0.31 m; a 0.02 m physical gap separates mathematical tangency from contact. |
| Speed limit | 1 m/s | Common to all methods; no acceleration bound. |
| Time step | 0.05 s | Velocity is constant within each interval. |
| Budget | 800 steps / 40 s | Shared finite observation window. |
| Goal tolerance | 0.15 m | Center distance to the agent's assigned goal. |
| Goal attraction gain | 0.6 s⁻¹ | Common preferred motion rule. |
| APF peer gain | 0.02 m⁴/s | Same inverse-clearance repulsion equation as lesson 2. |
| APF influence range | 0.7 m surface clearance | Peers outside this range contribute no repulsion. |
| ORCA horizon | Default 2 s | UI choices 0.5, 1, 2 and 4 s; model accepts 0.25–5 s. |

The observation model supplies all peer external states in sensed scenarios.
APF uses their positions only, with finite-range repulsion; ORCA also uses
velocities. This isolates the declared control rules, not equal information
usage or tuned performance. The ORCA padding is an additional method parameter,
not a change to physical geometry or the measured collision threshold.

## Velocity-space construction

For an observed pair, let `p = p_neighbor − p_self`, `w = v_self − v_neighbor`
and `R = r_self + r_neighbor`, using padded ORCA radii (`R=0.62 m` here).
A finite-horizon velocity obstacle contains the
relative velocities that bring the disks into overlap within `τ` seconds.
Its boundary consists of a cutoff circular arc and tangent rays. Project `w`
onto that boundary; `u` is the vector to the projection and `n` is its outward
unit normal. The pairwise constraint is:

```text
q = v_self + 0.5 u
(v − q) · n ≥ 0
```

The neighbor infers the complementary half from the same observed pair. The
feasible set intersects all these half-planes with `||v|| ≤ v_max`. The selected
velocity minimizes `||v − v_preferred||²` over that set. This is a local
velocity objective, not shortest total path, minimum mission time or a promise
that every agent eventually arrives. These are the roles of the original
paper's equations 5–9; the numerical solver used here is specified below.

The implementation enumerates the cutoff-arc projection and projections onto
the two tangent rays, then chooses the closest boundary point. The outward
normal is retained independently of `u`: when the current relative velocity is
already outside the velocity obstacle, the direction of `u` alone does not
identify the permitted side. Deterministic candidate ordering resolves exact
ties. The geometry helper also has a timestep-based overlap-recovery branch;
ordinary runs start apart and stop on physical contact.

The small convex solver enumerates the speed-disk projection of the preference,
zero, projections onto each boundary line, line/line intersections and
line/circle intersections. It retains feasible candidates and selects the one
nearest the preference. This directly solves this tiny two-dimensional
intersection without a grid search or an external linear-programming package.
Feasibility comparisons use a `1e-10` numerical tolerance.

If no candidate is feasible, the model returns a zero command and marks that
agent's decision infeasible. Other agents still execute their own decisions.
Zero is a declared fallback, not a feasible solution or safety guarantee; the
normal collision and budget evaluation continues. The counter records steps
with at least one infeasible agent, not the total number of failed agent
decisions. None of the five reference cases requires this fallback.

## Preferred motion and APF baseline

The raw attraction is `a = 0.6 (goal − position)` outside the goal tolerance,
and zero inside it. The preferred velocity is this attraction capped at 1 m/s.
Direct following executes it. ORCA projects that preference through its
constraints; even an agent inside its goal region continues to participate and
may move if required by a constraint. Agents are not individually frozen.

APF adds `0.02 (1/d − 1/0.7) / d²` times the unit vector away from each sensed
peer when the physical surface clearance satisfies `0 < d < 0.7 m`. It then
caps the complete attraction-plus-repulsion sum at 1 m/s. Repulsion is undefined
at contact; valid runs terminate before asking for another such update. The
formula matches lesson 2, while the disk sizes, starts, goals and timestep belong
to this crossing experiment. It is not a replay of lesson 2's common-goal map.

## Update, evaluation and stopping

1. Observe every agent's permitted inputs at the old boundary.
2. Compute all commands before updating any position.
3. Execute `position_next = position + 0.05 × command` for every agent and
   append its trail point. There is no post-solver velocity clamp or goal snap.
4. Measure pair clearance along simultaneous linear trajectories over the
   complete interval, then count agents currently inside their goal tolerances.
5. Stop for physical contact first, then all-agent arrival, then the 800-step
   budget. Otherwise continue.

For each pair, minimize the norm of its relative-motion segment over a common
fraction `s ∈ [0,1]` of the step and subtract `0.60 m`. The run minimum includes
initial geometry and every completed interval. This catches within-step overlap
that an endpoint-only check could miss; two paths crossing at different times
are not automatically a collision. Contact means clearance `≤ 0`.

The collision time displayed is the end of the first step containing contact,
not an exact continuous time of impact. All agents are shown at that step's
endpoints, which can overlap. Arrival requires all agents within 0.15 m at the
same boundary, with no prior contact. Timeout describes the measured finite
window; no separate infinite-time deadlock detector is implemented.

At step zero, decision fields show the command prepared from the initial state;
the actual current velocity is still zero. After a step, preferred velocities,
constraints and commands describe the just-applied pre-step decision at
`decisionTime`; current poses are its resulting endpoints. The inspector names
that time explicitly and retains the input pose and velocity. World-map arrows
translate the last decision vectors to the current agent markers for readability.

## Inspection and learning loop

1. Predict how the agents will behave at an offset crossing before advancing.
2. Compare ORCA, APF and direct following from the same starts and goals.
3. Select an agent and inspect its preferred velocity, chosen command and
   individual neighbor constraints in velocity space. A velocity-space point
   has units of m/s; it is not a location on the world map.
4. Change the prediction horizon. This changes future collision constraints,
   not the simulation timestep, speed cap or sensing schedule.
5. Try the symmetric face-to-face case. Inspect both clearance and progress;
   no overlap and completed travel are separate measurements.
6. Remove peer observations on the crossing. The controller retains its own
   pose and goal, but cannot construct constraints for unseen peers.

Method, scenario and applied horizon changes create a new paused run. Reset
repeats the applied configuration. Playback and finish execute model steps;
changing observer, camera or 2D/3D display only changes inspection. Both views
show the same planar state. The 3D view requires WebGL 2, with the 2D view and
numerical inspection available if it cannot initialize or loses its context.
The comparison table runs separate copies and never replaces the active run.

The five presets are ORCA/APF/direct on the crossing, ORCA on symmetric head-on
and ORCA without peer sensing, all with `τ=2 s`. The horizon has no effect on
the APF or direct rules. Reproduce the artifact with:

```sh
npm run --silent compare:orca > docs/results/orca.json
```

The [JSON artifact](../results/orca.json) records full-precision outcomes and
the source/runtime metadata needed to identify the numerical model.

## Limits

Reciprocal avoidance assumes peers take their share of a compatible decision.
Exact observations, feasible constraints and instantaneous velocity execution
are meaningful assumptions here, not properties of an arbitrary physical robot.
Unavailable sensing breaks the information requirement. This experiment does
not model a peer refusing its share, tracking errors or radio failure.

Symmetry can preserve a no-progress configuration. No random perturbation,
right-of-way protocol, global route planner or deadlock recovery is silently
added. Failure to arrive within a finite budget is reported as timeout, not
proof that every continuation would fail. An empty feasible set is also distinct
from a successful collision-avoidance command.

## Primary sources

- Jur van den Berg, Stephen J. Guy, Ming Lin and Dinesh Manocha (2011),
  [Reciprocal n-body Collision Avoidance](https://gamma.cs.unc.edu/ORCA/publications/ORCA.pdf),
  equations 5–9 for pairwise constraints, velocity selection and motion.
- The authors' [ORCA project](https://gamma-web.iacs.umd.edu/ORCA/) and
  [RVO2 implementation](https://github.com/snape/RVO2) provide method context.
  This lab implements a small JavaScript teaching model; it does not run RVO2.
- Oussama Khatib (1986),
  [Real-Time Obstacle Avoidance for Manipulators and Mobile Robots](https://doi.org/10.1177/027836498600500106),
  provides the artificial-potential-field context. The precise velocity-controller
  adaptation is defined in this lab's [APF lesson](02-potential-fields.md).
