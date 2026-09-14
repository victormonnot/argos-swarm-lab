# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination through reproducible
experiments. Change a parameter, observe collective behavior, introduce a failure
and compare the results.

**Available:** five local workshops with explanations, linked 2D/3D views, step
controls and measured comparisons: **distributed average consensus**,
**Artificial Potential Fields**, **task allocation with finite-state
execution**, **decision architectures under network partition**, and **A* path
planning with waypoint execution**. Other modules in the
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
the additional workshops are at `/movement/`, `/mission/`, `/architecture/`, and
`/pathfinding/`. Navigation
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
[architecture results](docs/lessons/04-decision-architectures-results.md) and
[pathfinding results](docs/lessons/05-pathfinding-results.md) list the checks
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
is the first part of the motion/estimation module; shared estimates remain proposed.
The graph's shortest route is not necessarily a shortest continuous-space path or
a feasible vehicle trajectory. There is no body radius, turning constraint,
obstacle discovery or synthetic pose error. See the
[specification](docs/lessons/05-pathfinding.md) for search, motion and contact semantics.

## Implementation

- **Plain JavaScript modules and HTML/CSS:** each workshop has an independent
  model and page controller. `src/model.js`, `src/movement-model.js`,
  `src/mission-model.js`, `src/architecture-model.js` and `src/pathfinding-model.js`
  contain deterministic transitions without DOM, rendering
  or wall-clock dependencies. `src/assignment.js` implements the matching rules.
- **[Vite](https://vite.dev/guide/):** local development and static production
  builds, with five explicit HTML entries in `vite.config.js`. The lockfile records
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
  references use `comparePaths()` in `src/pathfinding-model.js`.

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

Additional modules and integrations need their own specifications and validation.
