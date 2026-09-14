# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination through reproducible
experiments. Change a parameter, observe collective behavior, introduce a failure
and compare the results.

**Available:** ten local workshops with explanations, linked 2D/3D views, step
controls and measured comparisons: **distributed average consensus**,
**Artificial Potential Fields**, **task allocation with finite-state
execution**, **decision architectures under network partition**, **A* path
planning with waypoint execution**, **linear Kalman position filtering**,
**shared estimates with Covariance Intersection**, **Optimal Reciprocal
Collision Avoidance (ORCA)**, **Consensus-Based Bundle Algorithm (CBBA)**,
and **Behavior Trees versus finite-state machines (FSM)**.
Other modules in the
[catalog](docs/learning-path.md) remain proposals.

## Run locally

Use Node.js **22.12 or newer** and npm. The implementation was verified with
Node.js 22.22.1 and npm 10.9.4.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally [http://127.0.0.1:5173](http://127.0.0.1:5173).
The server binds to loopback. No account, backend or external service is needed.
Dependencies and the optional test browser need a network connection to install;
the workshops load their assets locally. Use the workshop links to switch pages;
the additional workshops are at `/movement/`, `/mission/`, `/architecture/`,
`/pathfinding/`, `/localization/`, `/fusion/`, `/orca/`, `/cbba/`, and `/behavior/`. Navigation
starts a new run.

If the local server has stopped after sleep or shutdown, run `npm run dev` again
from this project directory and keep that terminal open. To reuse a chosen port,
run `npm run dev -- --port 4175 --strictPort`, then open the URL printed by Vite.
If the server is running but an embedded preview is stale, reopen that URL.

```sh
npm test                         # mathematical properties, failures and replay
npm run compare                  # consensus reference cases as JSON, with metadata
npm run compare:movement         # potential-field reference cases as JSON
npm run compare:missions         # allocation and failure reference cases as JSON
npm run compare:architectures    # authority and network partition cases as JSON
npm run compare:pathfinding      # A*, Dijkstra and direct-motion cases as JSON
npm run compare:localization     # position filters and 200 seeded trials as JSON
npm run compare:fusion           # shared estimates and 1,000 seeded trials as JSON
npm run compare:orca             # disk crossing, symmetry and sensing cases as JSON
npm run compare:cbba             # task bundles, partition and recovery as JSON
npm run compare:behavior         # execution, interruption and recovery as JSON
npx playwright install chromium  # first browser-test setup
npm run test:e2e                  # Chromium interactions and both views
npm run build                    # static output in dist/
npm run preview                  # serve that build locally
```

On a Linux installation missing browser system libraries, use
`npx playwright install --with-deps chromium` for Playwright's documented setup.
The browser checks use software WebGL for reproducibility; they do not measure
hardware rendering performance. The [consensus results](docs/lessons/01-consensus-results.md),
[potential-field results](docs/lessons/02-potential-fields-results.md),
[mission results](docs/lessons/03-mission-allocation-results.md),
[architecture results](docs/lessons/04-decision-architectures-results.md),
[pathfinding results](docs/lessons/05-pathfinding-results.md),
[localization results](docs/lessons/06-localization-results.md),
[shared-estimation results](docs/lessons/07-shared-estimates-results.md),
[ORCA results](docs/lessons/08-orca-results.md),
[CBBA results](docs/lessons/09-cbba-results.md) and
[execution results](docs/lessons/10-behavior-trees-results.md) list the checks
actually run and their limitations.

## First workshop: distributed average consensus

The algorithm is **distributed average consensus**, implemented as linear
consensus with a constant edge gain. Its decision architecture is
**decentralized and leaderless**; updates are **synchronous and discrete-time**
over an **undirected, unweighted graph**. The complete graph, chain and two groups
are communication topologies of the same algorithm. The page's **Know the method**
profile explains these terms beside the experiment.

**How do several agents reach agreement?** Six agents begin with
`[0, 2, 4, 8, 10, 12]`. Each updates its number using only its neighbors' values.
The initial mean is `6`, shown as an evaluator measurement rather than an agent
input.

1. Predict the outcome, then press **Step once**. On the complete graph, the
   values become `[3, 4, 5, 7, 8, 9]`.
2. Compare the complete graph and chain with the same values. Inspect agreement
   steps and directed scalar exchanges.
3. Load two groups and run to 1,000. The components approach `2` and `10` while
   global disagreement remains about `8`.
4. Start recovery, advance to step 100, restore link **3–4**, and continue.
5. Add 100 to the starting values on the complete graph. Agreement still says
   nothing about whether the shared number is correct about the outside world.

The 2D and 3D views observe the same state. Node positions are abstract layout
coordinates; 3D height encodes a scalar value, not aircraft motion. 3D requires
WebGL 2; if unavailable, the page retains the 2D view and textual state table.

Each run stops at 1,000 model steps. **Reset** restores the configured initial
values and graph; selecting a preset or applying values starts a new paused run.
Link edits are allowed while paused and affect the next transition. **Replay run**
reproduces the recorded steps and edits, including edits at the final boundary.
Configuration stays locked until **Exit replay & reset**. Runs are held in memory
and are lost on page reload.

See the [module specification](docs/lessons/01-consensus.md) for the exact model,
assumptions, controls and acceptance criteria.

## Second workshop: Artificial Potential Fields

**How can simple local motion rules arrive, collide or get stuck?** Three disk
agents head toward one goal region using **Artificial Potential Fields (APF)**:
quadratic goal attraction plus finite-range surface repulsion. This velocity
controller is **decentralized and reactive**, with **synchronous, discrete-time**
updates. Each agent knows the static map and senses only nearby peers. No message
network or shared route planner is modeled.

1. Compare open ground with a corridor. Both reference runs reach the region.
2. Load the U-shaped trap. The agents stall before arrival; inspect attraction
   and repulsion cancelling near the closing wall.
3. Disable agent separation on open ground. The disks contact before arrival.
4. Disable obstacle repulsion in the U. Moving forward leads to wall contact.

Inspect individual velocity contributions, positions, paths, goal distance and
minimum swept clearance. Change gains, advance one `0.02 s` step or run directly
to an evaluated outcome. A speed cap is not a collision-avoidance guarantee.
The 3D view observes the same planar state and adds no vertical escape or flight
physics. It requires WebGL 2; the 2D map and numerical controls work without it.

See the [module specification](docs/lessons/02-potential-fields.md) for geometry,
equations, sensing assumptions and stopping criteria.

## Third workshop: task allocation and finite-state execution

**Who should do the work, and when is it actually finished?** Three agents visit
six observation points, each requiring arrival and 2 seconds of uninterrupted
service. Compare **fixed round-robin**, **nearest-pair greedy matching**, and
the **Hungarian algorithm**, all using the same **centralized** coordinator.
Agent execution follows a **finite-state machine (FSM)**: idle, travelling,
servicing, or unavailable.

1. Inspect the first assignment matrix. Greedy chooses a total of 6.8 m;
   Hungarian finds a matching costing 5.2 m. This optimizes the current dispatch,
   not the entire multi-stop mission.
2. Step through arrival. A task remains incomplete until its service finishes.
3. Make A2 unavailable at 5 seconds. Its unfinished task is released and partial
   service is discarded. The coordinator learns the event immediately.
4. Compare outcomes: fixed owners strand two tasks while the adaptive policies
   reassign interrupted work and finish all six in these reference runs.

Inspect task ownership, service progress, executor states, the recorded assignment
matrix and event history. Change policy or failure preset to start a paused run;
reset repeats the applied configuration. Both views display the same planar point
motion, with no obstacles or collision avoidance. The
[module specification](docs/lessons/03-mission-allocation.md) defines timing,
information access, failure ordering and the limits of the matching objective.

## Fourth workshop: decision architectures under network partition

**Who may assign work, and who can confirm it finished?** Reuse the same three
agents, six tasks and **nearest-pair greedy** rule. Compare a **central
coordinator**, **subgroup coordinators** with predelegated task domains, and
**peer-to-peer replicas** using a **full-roster round barrier**. Every decision
uses one local cache, with exact reports sampled before new commands.

1. Select **Central + permanent cut**, then advance to 2 s, separating {C, A1}
   from {A2, A3}. Agents keep executing
   accepted work; report age increases without implying an executor failure.
2. Finish the central run. All six jobs execute, but C can confirm only four.
   Retaining reservations prevents silence from triggering duplicate work.
3. Compare groups: they execute all six tasks inside their domains, while C
   learns only two completions across this permanent cut.
4. Compare peers: this protocol waits for all three current reports and matching
   nonempty plans before taking new targets. It completes only the first three
   jobs under a permanent cut; restoring links at 8 s allows it to finish.

Inspect C or an agent to compare its received information with physical truth.
The run completes only when execution and required confirmation are both complete;
otherwise it reaches the 60 s budget. Peer confirmation coverage is the evaluator's
minimum count across three caches, not a distributed termination protocol.
The hierarchical scopes restrict eligibility too, and the common report traffic
is not an optimized network design. These examples compare declared protocols,
not every possible implementation of the architecture names.

The [module specification](docs/lessons/04-decision-architectures.md) declares
authority, report contents, synchronization and transport assumptions. The custom
peer protocol does not implement Raft, Paxos or Lamport logical clocks.

## Fifth workshop: A* path planning and waypoint execution

**How do you get around a wall, then actually reach the goal?** One point robot
uses a complete static occupancy grid and exact position. **A* (A-star)** with
the **Manhattan heuristic** finds a shortest four-neighbor route. **Dijkstra**
solves the same graph problem using a zero heuristic. Both feed the same
constant-speed **waypoint follower**; a direct-to-goal baseline skips planning.

1. Load **A* around the U**. Inspect the 17 m route before any motion occurs.
2. Replay the recorded search: `g` is discovered distance from start, `h` is a
   remaining lower bound and `f=g+h` determines the next cell to pop. The final
   route stays visible separately; inspecting search history does not move the robot.
3. Compare Dijkstra: the same 17 m shortest route takes 95 pops instead of 30
   for A* on this map. Counts include the goal pop and do not measure runtime.
4. Execute the route; arrival occurs after 17 s. Direct motion into the U wall
   instead makes contact after 1.5 m. Planning and following have different roles.
5. Seal the enclosure. Both graph searches exhaust six reachable cells and report
   no path. The robot stays at the start; no route is different from arrival.

Select cells to inspect frontier/settled state, g/h/f and predecessors. Compare
the dashed planned route with the actual trail, waypoint, pose and goal distance.
All execution controls and both views observe one run. This single-agent baseline
is followed by individual position estimation and shared target estimates below.
The graph's shortest route is not necessarily a shortest continuous-space path or
a feasible vehicle trajectory. There is no body radius, turning constraint,
obstacle discovery or synthetic pose error. See the
[specification](docs/lessons/05-pathfinding.md) for search, motion and contact semantics.

## Sixth workshop: dead reckoning and linear Kalman position filtering

**Can a robot believe it arrived while still missing the goal?** Keep the known
A* route, but control from an estimated position. Compare an **exact-position
oracle**, **dead reckoning** from measured displacement and a **linear Kalman
filter** for independent x/y coordinates. Odometry has seeded random noise and
an optional fixed bias; synthetic absolute position fixes arrive once per second.

1. Compare the oracle with dead reckoning on the U route. With seed 1 and bias
   enabled, dead reckoning announces arrival while the robot is 1.437 m from goal.
2. Run Kalman with regular fixes. Inspect prediction, innovation, gain and
   covariance. True estimation error is an evaluator quantity; it is not P.
3. Stop fixes at 3 s. Odometry and prediction continue, with no stale-fix reuse.
4. Restore fixes at 8 s on the U route; inspect the first new correction. On the
   shorter open route, this policy can stop before restoration ever happens.
5. Disable the systematic bias or change the seed. The comparison table reports
   all outcomes across twenty seeds, including false arrivals with regular fixes.

Display physical and estimated trajectories together, the last fix and its age,
assumed uncertainty, current waypoint and both goal distances. Arrival requires
a controller completion claim and true goal distance within 0.25 m. The 0.10 m
estimated waypoint radius is explicit; it differs from the prior lesson's exact
center arrival. This single-agent experiment has no real GPS, IMU, SLAM or shared
localization. The filter has no bias state, so its assumed covariance does not
guarantee accurate position or safe execution. See the
[specification](docs/lessons/06-localization.md) for sensing, timing and limits.

## Seventh workshop: shared estimates and Covariance Intersection

**Does another message mean another measurement?** Three agents each observe the
same static target once, then exchange estimates along a directed ring. Compare
**no sharing**, **naive independent-information fusion**, **unique-measurement
fusion** with immutable IDs, and **Covariance Intersection (CI)** with fixed
half weights. Every method uses the same observations and twelve-round window.

1. Advance naive fusion to round 2. Its reported variance is 0.16 m² per axis,
   but the true expected variance is 0.24 m²: summaries already overlap.
2. Compare unique-measurement fusion. All three originals arrive by round 2,
   giving variance 0.64/3 m². Further copies do not count as new evidence.
3. Compare CI on the intact ring. It produces the same means as naive fusion,
   while retaining conservative variance 0.64 m². Agreement, accuracy and
   reported uncertainty are separate properties.
4. Cut A3→A1 or restore it at round 5. Inspect received packets, original-source
   weights and coverage. With a lasting cut, repeated averaging can increasingly
   favor A1, even though CI still reports a valid covariance bound here.
5. Compare all 100 paired seeds, not only the visible seed. The exact expected
   error covariance is computed independently from source coefficients.

Both views show estimates of one target, not moving robots. The packet inspector
distinguishes received evidence from evaluator truth; ledgers transmit more
logical records than summaries. IDs work because the original measurements are
independent in this experiment; CI requires consistent input covariances. Neither
method guarantees low error for each realization. The
[specification](docs/lessons/07-shared-estimates.md) defines equations, transport,
metrics and primary sources.

## Eighth workshop: Optimal Reciprocal Collision Avoidance

**How can moving agents share responsibility for avoiding a collision?** Planar
disk agents choose their own velocities using **Optimal Reciprocal Collision
Avoidance (ORCA)**. Each observed neighbor contributes a permitted half-plane
in velocity space. The selected velocity is the closest to the agent's preferred
goal-directed velocity inside those constraints and the maximum-speed circle.

Compare ORCA, **Artificial Potential Fields (APF)** and direct goal following on
the same crossing. Inspect preferred and chosen velocities, the selected agent's
constraints, swept clearance and actual arrival. Try an exactly symmetric
head-on case to explore lack of progress, then remove peer sensing to expose
the information the avoidance rule needs. Change the prediction horizon and
repeat the experiment.

Both views observe the same synchronous planar kinematics. The agents have exact
self-position and, when sensing is available, exact peer positions and velocities;
they exchange no messages. Reciprocal half-responsibility, feasible constraints
and instantaneous velocity execution are explicit model assumptions. Local
avoidance does not supply a global route or guarantee eventual arrival. The
[specification](docs/lessons/08-orca.md) defines the solver, information boundary,
stopping criteria and primary method sources.

## Ninth workshop: Consensus-Based Bundle Algorithm

**How can agents agree on task ownership without one coordinator?** Three
stationary planners build task bundles using **CBBA — Consensus-Based Bundle
Algorithm**, with static additive utilities and a two-task capacity. They
exchange their local winner IDs, bids and source timestamps with neighbors.
Losing an earlier task releases that task and the later entries in its bundle
before the agent builds again.

Inspect competing initial claims, then follow a connected chain, a lasting
partition or restoration at round 5. Compare the same local greedy choices
without any exchange. Select an agent to read its own utility row, winner
beliefs, received packets and released bundle suffix. A separate evaluator
reports conflicting claims, agreement and allocation quality against an exact
centralized reference for this small scoring problem.

Both views display task locations and current plans; no vehicle executes a task.
Bundle order records acquisition, and these static utilities do not score travel
or path insertion. Conflict-free allocation, agreement, optimal score and
completed work are distinct concepts. See the
[specification](docs/lessons/09-cbba.md) for the score, consensus protocol,
information boundary and limitations.

## Tenth workshop: Behavior Trees and finite-state machines

**What happens when an action is interrupted?** One drone follows a fixed
inspection mission: take off, travel, inspect, return and land. Compare a
**Behavior Tree (BT) with reactive priority fallback**, an equivalently guarded
**finite-state machine (FSM)**, and a **BT with memory at the root fallback**.
All three use identical movement and inspection primitives.

Step through a temporary hold at 7 s. Inspect whether the hold condition is
visited, which action is halted and how partial inspection work is discarded.
Compare persistent hold with a sensor failure that causes a return and landing.
A successful recovery action does not mean the inspection succeeded. The
memory-root variant demonstrates how resuming a running child can skip a newly
changed higher-priority condition; it is one explicit tree design, not a claim
that memory nodes are always unsuitable.

The tree and FSM inspectors expose actual evaluated nodes, returned statuses,
transitions and local observations. Independent reference runs separate task
completion from hold compliance. The reactive BT and FSM implement the same
policy, so equal physical behavior is an intended result.

This workshop models altitude with three-dimensional point kinematics. The
volumetric view includes a quadrotor, inspection structure, landing pad and a
clear flight corridor; the 2D side elevation observes the same trajectory.
There is no flight physics or collision-avoidance controller. See the
[specification](docs/lessons/10-behavior-trees.md) for tick timing, action lifecycle
and the information boundary.

## Implementation

- **Plain JavaScript modules and HTML/CSS:** each workshop has an independent
  model and page controller. `src/model.js`, `src/movement-model.js`,
  `src/mission-model.js`, `src/architecture-model.js`, `src/pathfinding-model.js`,
  `src/localization-model.js`, `src/fusion-model.js`, `src/orca-model.js`,
  `src/cbba-model.js` and `src/behavior-model.js`
  contain deterministic transitions without DOM, rendering
  or wall-clock dependencies. `src/assignment.js` implements the matching rules.
- **[Vite](https://vite.dev/guide/):** local development and static production
  builds, with ten explicit HTML entries in `vite.config.js`. The lockfile records
  exact installed versions.
- **SVG and [Three.js](https://threejs.org/docs/pages/WebGLRenderer.html):** readable
  2D diagrams and spatial views with orbit controls. Each pair receives the same
  experiment snapshot; Three.js loads when a 3D view is requested.
- **[Node's test runner](https://nodejs.org/docs/latest-v22.x/api/test.html) and
  [Playwright](https://playwright.dev/docs/intro):** mathematical checks separately
  from browser interactions. `src/comparisons.js` runs the five reference cases
  for both the consensus page and its command-line result exporter. Movement
  references similarly use `compareMovement()` in `src/movement-model.js`;
  mission references use `compareMissions()` in `src/mission-model.js`; architecture
  references use `compareArchitectures()` in `src/architecture-model.js`; pathfinding
  references use `comparePaths()` in `src/pathfinding-model.js`; localization uses
  `compareLocalization()` and the paired-seed `compareLocalizationSeeds()`;
  shared estimation uses `compareFusion()` and `compareFusionSeeds()`; ORCA uses
  `referenceComparisons()` in `src/orca-model.js`; task-bundle references use
  `referenceComparisons()` in `src/cbba-model.js`; execution references use
  `referenceComparisons()` in `src/behavior-model.js`.

Official dependency documentation was checked on 2026-09-14. Dependencies are
shared by the workshops; robotics middleware and flight dynamics are outside
their scope.

## Read next

| Document | Purpose |
| --- | --- |
| [Project scope](docs/charter.md) | Purpose, design principles and implementation boundaries. |
| [Module catalog](docs/learning-path.md) | Available modules and proposed extensions. |
| [Experiment guide](docs/experiment-guide.md) | Lesson format, comparisons and failure-model rules. |
| [Consensus results](docs/lessons/01-consensus-results.md) | Observed outcomes, verification and limits. |
| [Potential-field results](docs/lessons/02-potential-fields-results.md) | Measured arrival, stalls and contact failures. |
| [Mission results](docs/lessons/03-mission-allocation-results.md) | Assignment costs, completion and reallocation after agent loss. |
| [Architecture results](docs/lessons/04-decision-architectures-results.md) | Physical completion, delivered knowledge and partition recovery. |
| [Pathfinding results](docs/lessons/05-pathfinding-results.md) | Grid shortest routes, search effort, waypoint execution and contact. |
| [Localization results](docs/lessons/06-localization-results.md) | Position error, assumed uncertainty, missing fixes and false arrival. |
| [Shared-estimation results](docs/lessons/07-shared-estimates-results.md) | Repeated evidence, covariance consistency and communication cost. |
| [ORCA results](docs/lessons/08-orca-results.md) | Reciprocal avoidance, clearance, arrival and failures under missing sensing. |
| [CBBA results](docs/lessons/09-cbba-results.md) | Bundle conflicts, neighbor agreement, partition recovery and allocation quality. |
| [Execution results](docs/lessons/10-behavior-trees-results.md) | Matched BT/FSM behavior, interruption, memory semantics and recovery outcomes. |

Additional modules and integrations need their own specifications and validation.
