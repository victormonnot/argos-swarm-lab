# Lesson 02 — Artificial Potential Fields

**Status:** implemented local workshop at `/movement/`. See the
[setup instructions](../../README.md#run-locally) and
[measured results](02-potential-fields-results.md).

**Question:** how can local motion rules produce arrival, collision or a stall
even when a route to the goal exists?

## Method profile

| Aspect | Implemented choice | Meaning in this lesson |
| --- | --- | --- |
| Algorithm | Artificial Potential Fields (APF) | Goal attraction and surface repulsion contribute to a local motion command. |
| Variant | Quadratic attraction; finite-range inverse-clearance repulsion | A first-order velocity-controller adaptation with a speed cap. The equations below define the precise rule. |
| Decision architecture | Decentralized, reactive | Each agent decides from its own position, assigned goal/map and sensed peers. There is no leader or route planner. |
| Timing | Synchronous, discrete time | Every command uses the old state; all positions advance together by a fixed `0.02 s`. |
| Sensing | Exact own position and nearby peer positions | Peer sensing includes surface clearances strictly below `0.7 m`, without occlusion, noise or delay. |
| Communication / topology | No message network | Peer sensing is geometric and local. There are no radio links, packet counters or communication failures. |
| Prior knowledge | Exact static obstacle map and assigned goal | Obstacle geometry is known to every agent; finite-range repulsion determines which walls contribute. |
| Evaluator truth | All positions, swept clearance, arrival, path lengths, stall | These measurements are shown to the learner and can stop the experiment; they are not controller inputs. |
| Execution and fidelity | One browser simulation of planar disk kinematics | 2D and 3D show the same x/y state. There is no vertical movement, vehicle dynamics or autopilot. |

The recognized method name, its variant and essential assumptions remain visible
on the page. Each guided case labels the aspect changed. This is an avoidance
controller experiment, not a formation-maintenance or flock-alignment algorithm.

## Learning objective and initial conditions

Predict which velocity contributions act, inspect their sum, then distinguish
motion from successful arrival. Explain how contributions can cancel outside
the goal, and why disabling avoidance does not solve a planning problem.

Three disks start at `A1=(-4,-0.6)`, `A2=(-4,0)`, `A3=(-4,0.6)` metres. Each disk
has radius `0.12 m`. The shared goal centre is `(4,0)` with radius `0.8 m`.
Arrival requires all three **centres** inside that region. An agent already in
the region continues following the rule until the entire run stops; agents are
not individually frozen.

Walls are capsules: a line segment thickened by a disk of radius `0.10 m`.

| Map | Wall centreline segments, in metres |
| --- | --- |
| Open field | None. |
| Open corridor | `(-1.8,-1.3) → (1,-1.3)` and `(-1.8,1.3) → (1,1.3)`. |
| U-shaped trap | The corridor plus `(1,-1.3) → (1,1.3)`. |

The U opens to the left. A path can go back out and around the walls to the
goal on the right. The APF controller does not search for that path.

## Declared update rule

For an agent at `p`, assigned goal `g`, and each contributing surface:

```text
u_goal = k_goal * (g - p)
u_rep  = eta * (1/d - 1/d0) / d^2 * n    when 0 < d < d0
u_rep  = 0                               when d >= d0
u      = u_goal + sum(u_wall) + sum(u_peer)
v      = u * min(1, v_max / ||u||)        with v = 0 when u = 0
p[k+1] = p[k] + dt * v[k]
```

`d` is surface clearance: distance from `p` to the nearest point on a wall
segment minus the two radii, or centre distance to a peer minus two agent radii.
`n` points from that nearest wall point or peer centre toward `p`, normalized to
unit length. Each wall segment contributes separately, including at capsule
overlaps near corners. Repulsion is undefined at contact; contact terminates a
valid run before another command is requested.

| Parameter | Reference value | Editable range | Units |
| --- | --- | --- | --- |
| Goal gain `k_goal` | 0.6 | 0.2–1.2 | s⁻¹ |
| Obstacle gain `eta_wall` | 0.15 | 0–0.4 | m⁴/s |
| Peer gain `eta_peer` | 0.02 | 0–0.08 | m⁴/s |
| Wall influence `d0_wall` | 1 | Fixed | m of surface clearance |
| Peer influence `d0_peer` | 0.7 | Fixed | m of surface clearance |
| Speed cap `v_max` | 1 | Fixed | m/s |
| Model step `dt` | 0.02 | Fixed | s |
| Budget | 2,000 | Fixed | updates, equivalent to 40 model seconds |

The vectors have velocity units. They are not measured physical forces. All
commands read one old snapshot before any agent changes position. There are
no acceleration constraints, state estimator, random inputs or online messages.

## Evaluation and stopping

Each update represents linear movement between its endpoints. The evaluator
measures the minimum surface clearance over the **whole interval**:

- Agent/wall: minimum distance between the motion segment and wall centreline,
  minus agent and wall radii.
- Agent/agent: nearest approach of the relative-motion segment to the origin,
  minus twice the agent radius. This accounts for simultaneous movement, rather
  than merely intersecting two geometric paths.

The displayed minimum is the smallest signed clearance since step zero.
Clearance `<= 0` is contact, including tangency. Collision is checked before
arrival. The stored terminal positions and time are at the end of the first
update containing contact; the evaluator does **not** interpolate the exact
first-contact time or correct the overlapping positions.

Otherwise, arrival stops the run when every centre is at most `0.8 m` from the
goal. If arrival is incomplete, a **stall** stops the run when all commanded
speeds in the preceding 100 updates are below `0.005 m/s` and the absolute change
in maximum goal distance over those 100 updates is below `0.01 m`. This is a
measured near-stationary criterion, not a proof that every perturbation remains
trapped. If no other outcome is reached, update 2,000 ends with budget exhaustion.

The global stopping policy belongs to the simulator. It is not a decentralized
mission-completion protocol. The history also records each goal distance and
total travelled path length; these are evaluation measurements only.

## Controls, inspection and comparisons

- Play/pause, one fixed step, reset, and run directly to the first outcome.
- Playback requests 10, 50 or 200 updates per real second; it never changes the
  numerical step. Actual display speed depends on the device.
- Select a map to start a paused run with the applied gains. Sliders are drafts
  until **Apply gains & reset** starts a new run. **Reset** restores the applied
  configuration and discards draft edits.
- Select an agent in either view, the state table or the agent selector. Inspect
  the current state's attraction, two repulsion sums, raw sum and capped velocity.
  These predict a next command; after a terminal outcome no command is applied.
  After contact, the inspector reports the stopped controller.
- Switch 2D/3D or orbit the camera without advancing or resetting the state.
  Only 2D shows contribution arrows; arrow lengths are capped for legibility and
  numerical components are available below. Wall/disk footprints use model sizes.
- Both workshops are reachable through ordinary page links. Navigation/reload
  starts a new run; no persistence or cross-page replay is implemented. Repeating
  the same configuration reproduces the same movement trace.

| Guided comparison | Change | Inspect |
| --- | --- | --- |
| Open field / corridor | Known environment geometry | Arrival, trajectories, wall contribution and minimum clearance. |
| U-shaped trap | Add the closing wall | Local contributions cancel before arrival despite a route around the U. |
| Open field, separation off | Set only peer gain to zero | The disks contact before reaching the region. |
| U-shaped trap, obstacle repulsion off | Set only wall gain to zero | Forward motion causes wall contact instead of recovery. |

Guided cases always begin with reference gains before applying the stated change.
The expandable comparison table computes these cases without changing the active
run. `npm run compare:movement` repeats the same cases and emits JSON with runtime,
Git revision, working-tree status, model parameters and a SHA-256 model hash.

## Acceptance and boundaries

Model verification covers attraction/repulsion direction, finite sensing, speed
limits, synchronous symmetry, swept contacts, deterministic reset, nominal
arrival, the measured local trap, and contact failures. Browser verification
covers core controls, navigation, outcomes, state-preserving 2D/3D switching,
keyboard operation, narrow layout and the WebGL-unavailable fallback. Results
and actual checks are recorded separately in the result record.

Primary method source: Oussama Khatib (1986),
[Real-Time Obstacle Avoidance for Manipulators and Mobile Robots](https://khatib.stanford.edu/publications/pdfs/Khatib_1986_IJRR.pdf),
The International Journal of Robotics Research, 5(1), 90–98. The potential-field
idea is adapted here to disk surface clearances and a capped first-order velocity
model; this is not a reproduction of the paper's full robot control system.

No completeness, collision-avoidance or arrival guarantee is claimed. Successful
reference runs are evidence for those configurations. Discrete integration,
speed saturation and gain choices can produce other outcomes. Dynamic obstacles,
sensor failures, localization uncertainty, global planning and flight physics
remain outside this lesson.
