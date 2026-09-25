# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination through reproducible
experiments. Change a parameter, observe collective behavior, introduce a failure
and compare the results.

**Available:** twenty-three local workshops with explanations, linked 2D/3D views, step
controls and measured comparisons: **distributed average consensus**,
**Artificial Potential Fields**, **task allocation with finite-state
execution**, **decision architectures under network partition**, **A* path
planning with waypoint execution**, **linear Kalman position filtering**,
**shared estimates with Covariance Intersection**, **Optimal Reciprocal
Collision Avoidance (ORCA)**, **Consensus-Based Bundle Algorithm (CBBA)**,
**Behavior Trees versus finite-state machines (FSM)**, **cooperative
localization with a joint-state Kalman filter**, **Extended Kalman Filter
SLAM with supplied landmark identities**, **pose-graph SLAM with
Gauss–Newton optimization**, **ROS 2 nodes/topics with explicit
consensus rounds recorded from separate processes**, **ROS 2 message
freshness with KEEP_LAST history and an application age gate**, and **process
failure/restart with heartbeat suspicion and epoch/sequence admission**, plus
**Fast DDS versus Zenoh with late-joining readers and bounded retained history**,
**ArduPilot SITL with MAVLink command admission and measured flight execution**,
**Gazebo external physics with a bounded force disturbance and observed recovery**,
**GCS heartbeat loss with an onboard LAND failsafe**, **two-vehicle
mission execution with central greedy assignment and per-vehicle MAVLink addressing**,
**three-vehicle mission recovery with reactive Behavior Trees and exclusive task reassignment**,
and **three drones sharing one Gazebo world with measured separation and physical contacts**.
The [module catalog](docs/learning-path.md) describes the questions, comparisons
and boundaries of each workshop.

Workshops **2–9** pair their original 2D diagrams with detailed drone scenes,
volumetric sites and whole-site/follow cameras. They remain planar kinematics
or static information models: display altitude and scenery do not add flight
physics, vertical avoidance or task execution. Model footprints, truth versus
estimates, and claims versus completed work remain explicit. See the
[3D display conventions](docs/lessons/02-09-3d-views.md).

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
`/pathfinding/`, `/localization/`, `/fusion/`, `/orca/`, `/cbba/`, `/behavior/`,
`/cooperative/`, `/slam/`, `/pose-graph/`, `/ros2/`, `/qos/`, `/restart/`, `/middleware/`,
`/sitl/`, `/gazebo/`, `/failsafe/`, `/fleet/`, `/recovery/`, and `/shared-world/`. Navigation starts a new run or rewinds a recording.

Keep the development server running while using the workshops. To choose another
port, append `-- --port <port> --strictPort` to `npm run dev` and open the URL
printed by Vite.

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
npm run compare:cooperative      # joint localization, missing anchors and paired seeds
npm run compare:slam             # EKF map growth, reobservations and sensor failures
npm run compare:pose-graph       # pose optimization, supplied loops and paired seeds
npm run compare:ros2             # recorded ROS rounds versus the lesson-1 reference
npm run record:ros2              # optional Docker execution; writes a local trace
npm run compare:qos              # recorded callback ages, acceptance and retained state
npm run record:qos               # optional Docker freshness recording
npm run compare:restart          # observed suspicion and post-restart admission
npm run record:restart           # optional Docker process interruption/restart
npm run compare:middleware       # observed historical and live sequence sets
npm run record:middleware        # Docker: same application through Fast DDS and Zenoh
npm run compare:sitl             # recorded command ACKs versus measured flight completion
npm run record:sitl              # Docker: one ArduCopter SITL vehicle per independent case
npm run compare:gazebo           # world displacement, applied impulse and horizontal return
npm run record:gazebo            # Docker: Gazebo Iris + ArduPilot JSON, nominal versus force pulse
npm run compare:failsafe         # GCS sends, observed timeout response and autonomous landing
npm run record:failsafe          # Docker: continuous versus interrupted GCS heartbeats
npm run compare:fleet            # two task outcomes, per-vehicle evidence and landing
npm run record:fleet             # Docker: two SITL processes, correct versus wrong target ID
npm run compare:recovery         # mission duration, cancelled attempt and confirmed handover
npm run record:recovery          # Docker: three vehicles, reactive BTs and withdrawal/reassignment
npm run compare:shared-world     # simultaneous world poses, separation, contacts and mission results
npm run record:shared-world      # Docker: three JSON autopilots inside one Gazebo world
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
[CBBA results](docs/lessons/09-cbba-results.md),
[execution results](docs/lessons/10-behavior-trees-results.md),
[cooperative-localization results](docs/lessons/11-cooperative-localization-results.md),
[EKF-SLAM results](docs/lessons/12-ekf-slam-results.md),
[pose-graph results](docs/lessons/13-pose-graph-slam-results.md),
[ROS 2 results](docs/lessons/14-ros2-rounds-results.md),
[freshness results](docs/lessons/15-ros2-freshness-results.md),
[restart results](docs/lessons/16-process-restart-results.md),
[middleware results](docs/lessons/17-middleware-durability-results.md),
[SITL results](docs/lessons/18-sitl-mavlink-results.md),
[Gazebo results](docs/lessons/19-gazebo-physics-results.md),
[GCS failsafe results](docs/lessons/20-gcs-failsafe-results.md),
[two-vehicle results](docs/lessons/21-two-vehicle-mission-results.md),
[mission recovery results](docs/lessons/22-mission-recovery-results.md) and
[shared-world results](docs/lessons/23-shared-world-mission-results.md) list the checks actually run and their limitations.

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

## Eleventh workshop: cooperative localization

**Can two robots improve their positions by observing each other?** Compare
independent position Kalman filters with a **joint-state linear Kalman filter**
that retains the covariance between both robots. They receive identical noisy
odometry; relative Cartesian observations couple the estimates, while only A1
receives absolute position fixes. The joint estimator is a centralized reference.

Inspect a relative update, then the A1 absolute correction: cross-covariance lets
that fix also affect A2. Remove the absolute reference to distinguish accurate
relative placement from uncertain team position. Add the same initial offset
to both estimates; relative observations cannot identify that translation.
Restore the reference at 10 s or remove relative observations from 5 through 9 s
to inspect prediction, missing corrections and resumed information.

The two physical paths stay fixed across methods. True drones, estimated
positions, covariance contours, update stages and a full joint covariance table
separate evaluator truth from estimator information. The volumetric yard and
2D map observe the same planar positions; altitude is fixed for display and is
not estimated. There is no flight controller, range/bearing conversion or SLAM.
Seeded reference copies and paired trials show errors alongside reported
uncertainty, including the intentionally misspecified common-prior offset.
See the [specification](docs/lessons/11-cooperative-localization.md) for the
coordinate-frame, sensing, covariance and observability assumptions.

## Twelfth workshop: Extended Kalman Filter SLAM

**Can a robot build a map and use it to locate itself?** One robot starts at a
known pose with an empty map. **Extended Kalman Filter SLAM (EKF-SLAM)** jointly
estimates x, y, heading and static landmark coordinates from noisy travel/turn
increments and body-relative range/bearing observations. Landmark IDs are
supplied; their positions are unknown to the estimator.

A first observation initializes a landmark and its correlations with the pose
and existing map. A later observation can correct the robot and other correlated
landmarks. Inspect the inverse observation, Jacobians, innovation and full joint
covariance. Compare odometry mapping that initializes the same points but omits
all reobservation corrections. The two methods share the same physical path and
sensor samples.

Cut landmark observations from 12 through 19 s or inject a fixed range bias.
At restoration, discovering new points is distinct from correcting against
already known points. Map coverage, pose/heading/map errors and reported
uncertainty expose that distinction. Six reference cases and paired seeds
qualify single-run results.

The detailed 3D drone and landmark yard follow the same planar state as the 2D
map. Heading is modeled; altitude is fixed for display. The exact initial pose
defines the reference frame. Camera/LiDAR processing, unknown data association,
pose-graph optimization and flight control remain outside this model. See the
[specification](docs/lessons/12-ekf-slam.md) for the nonlinear model and limits.

## Thirteenth workshop: pose-graph SLAM

**How can a loop observation correct a whole recorded trajectory?** Optimize
25 past planar poses with **Gauss–Newton nonlinear weighted least squares** and
**Armijo backtracking**. A fixed first pose anchors 24 noisy odometry constraints.
Compare no loop, a correctly supplied return association and a deliberately
incorrect association using the same odometry and initial trajectory.

One optimizer step can change poses recorded much earlier in the survey.
Inspect the relative-pose measurement, prediction, wrapped residual and weighted
cost of each edge; compare accepted cost reduction with evaluator trajectory
error. An odometry chain can have nearly zero residual while drifting from
truth. A wrong loop can reduce its objective while deforming the path.

Optimization iterations are computation, not flight time. A pose selector
inspects one recorded timestamp, represented by a detailed 3D drone; other graph
nodes are its past poses. The linked 2D/3D views show truth, integrated odometry
and optimized history from the same run. A short transition, correction arrows
and Before / After comparison make changes to historical poses visible while
the inspectors retain the actual computed estimates. Three reference cases and paired
seeds report errors, corrections and numerical termination separately.

This is a small **pose-graph backend** with supplied associations and an exact
anchor. It does not recognize places, extract camera/LiDAR features, reject
outliers, estimate landmarks or control flight. See the
[specification](docs/lessons/13-pose-graph-slam.md) for residual coordinates,
solver conventions, backtracking and limits.

## Fourteenth workshop: ROS 2 nodes, topics and explicit rounds

**How do six separate programs reproduce the same consensus?** Six actual
**ROS 2 Jazzy / rclpy** processes publish their own scalars and subscribe to
neighbor topics. A seventh process starts each round and waits for six update
reports. Numerical decisions remain local; timing coordination is centralized.

The page replays actual recorded runs. Step through publication, received inputs
and the completed barrier, inspect node names, process IDs and run/round fields,
and compare every completed vector with workshop 1. A complete graph and a
chain retain the same averaging rule. When A3 deliberately omits its publication,
five peers wait and the barrier times out; A3's local update is not a complete
new global state. This is application withholding, not simulated radio loss.

The linked 2D/3D software diagrams share one replay cursor. Animation timing is
for teaching, not measured network latency. The default recordings work with the
usual web setup. To produce a new trace with Docker installed and running:

```sh
npm run record:ros2
```

Import `local/ros2-consensus.json` on the page. The runner downloads a pinned
official ROS image on first use and runs a disposable container with six agent
processes and one supervisor. It needs no host ROS installation or host network.
The page clearly distinguishes saved playback from real process execution.
See the [specification](docs/lessons/14-ros2-rounds.md) for the protocol, exact
information boundaries, reproducibility and limits.

## Fifteenth workshop: ROS 2 message freshness and QoS

**Is a delivered position still useful?** One real ROS 2 publisher sends synthetic
XYZ positions to three separate readers. Compare **KEEP_LAST depth 20**,
**KEEP_LAST depth 1**, and **depth 20 with a 150 ms application age gate**.
All endpoints use the same **reliable, volatile** delivery policies.

1. Replay the nominal recording to inspect generation and callback timestamps.
2. Load the paused case, then jump to **First callbacks after resume**. The source
   kept publishing while all reader executors paused for one second. Compare the
   old depth-20 sample with the shallow reader's recent sample.
3. Select the gated reader: rejecting an old callback leaves its previously
   accepted position unchanged, and that retained information keeps aging.
4. Observe the drain interval after publication stops. A small callback age at
   acceptance does not make a stored position fresh forever.

The linked 2D/3D views show one replay cursor: a solid drone follows the synthetic
evaluator reference and a ghost holds the selected reader's exact accepted
sample. Position lag is evaluator data. There is no flight controller, radio-loss
injection, hidden DDS queue measurement or multi-host clock assumption.

The page replays actual process records. With Docker available, produce another
recording with `npm run record:qos`, then import `local/ros2-qos.json`. The
[specification](docs/lessons/15-ros2-freshness.md) separates callback age, retained
Age of Information, middleware QoS and application acceptance.

## Sixteenth workshop: process failure, heartbeat suspicion and restart

**What can an observer infer when a process stops, then returns?** One actual
ROS 2 heartbeat source represents A1. One observer applies a **fixed-timeout
heartbeat failure detector** after two different admission rules: **sequence
only** and **ordered epoch + sequence**. Both see identical callbacks.

1. Compare continuous publication with temporary silence in a living process.
   The watchdog can suspect A1 in either a publication pause or a real crash.
2. Load the restart case. Inspect the actual SIGKILL exit, new PID, endpoint
   readiness and first returned heartbeat. A launch is not an accepted update.
3. At the first return callback, compare the two policies: the new process starts
   its sequence at zero, so a sequence-only observer can reject valid new data.
4. Jump to each policy's recovery and compare retained positions and receipt
   ages. The baseline can catch up once its old sequence maximum is exceeded;
   the ordered epoch makes the new incarnation distinguishable immediately.

The 2D/3D views share one replay cursor. A detailed drone represents the synthetic
XYZ reference; a ghost shows the selected policy's retained sample. Harness
process truth remains separate from observer belief. No physical crash, mission
restoration, ROS managed-node lifecycle or autopilot failsafe is implied.

Use `npm run record:restart` with Docker, then import `local/ros2-restart.json`
to inspect another actual run. The [specification](docs/lessons/16-process-restart.md)
defines receipt-time suspicion, run-scoped epoch authority, startup guard and
information boundaries.

## Seventeenth workshop: Fast DDS, Zenoh and late-joining readers

**Does changing the middleware preserve the delivery contract?** The same actual
ROS 2 application runs through **Fast DDS / rmw_fastrtps_cpp** and
**Zenoh / rmw_zenoh_cpp**. For each, compare **VOLATILE** with
**TRANSIENT_LOCAL** durability, holding RELIABLE and KEEP_LAST depth five fixed.

1. Publish ten XYZ samples before the reader creates its subscription.
2. Inspect the quiet interval: does the late reader receive historical samples?
   The expected retained set is only the last five, not the full first batch.
3. Resume publication and inspect the ten new live samples. Reliability and
   historical retention answer different questions.
4. Change RMW, replay its independent recording and compare observed sequence
   sets. A different callback timestamp is not an isolated transport benchmark.

Detailed 3D reference/held-state drones and a linked 2D view read the same cursor.
The page exposes actual envelopes, subscription timing, received versus unobserved
sequences and requested versus available graph-reported QoS. Zenoh's default local
peers use a router for discovery; the configuration diagram is not a packet trace.

`npm run record:middleware` builds a local image containing both RMWs, then writes
`local/ros2-middleware.json` for import. Its initial build needs network access
for two pinned Zenoh packages; the host ROS installation is unchanged. Read the
[specification](docs/lessons/17-middleware-durability.md) for the fixed workload,
configuration fingerprints and measurement limits.

## Eighteenth workshop: ArduPilot SITL and MAVLink command feedback

**Does an accepted command mean the vehicle has finished the action?** One actual
**ArduCopter SITL** process runs the built-in quadrotor dynamics. A **pymavlink**
controller sends serialized **MAVLink 2** requests and checks later telemetry.

1. Inspect Guided mode and normal arming, then jump to the takeoff ACK. Acceptance
   arrives before the vehicle stabilizes at the requested four-meter height.
2. Follow one local NED position target. This movement message has no command
   ACK; reaching the target requires fresh position and speed evidence.
3. Inspect LAND acceptance, followed by fresh on-ground and disarmed reports.
4. Compare a fresh simulation that requests takeoff without arming. The saved
   negative ACK and five-second observation show the measured rejection.

Both views replay the same autopilot estimates. A detailed plus-frame quadrotor
uses recorded altitude and attitude in a volumetric yard; the 2D view also exposes
height. The yard is illustrative, and no independent simulator-truth accuracy
measurement is supplied. Channel receipt ages and differing altitude references
remain explicit. Playback does not send flight commands.

`npm run record:sitl` builds an isolated Linux amd64 image containing the pinned
official ArduCopter binary and Python dependencies, then records
`local/ardupilot-sitl.json` for import. The flight run has no external network.
Read the [specification](docs/lessons/18-sitl-mavlink.md) for command fields,
completion thresholds, coordinate frames and the bounded failure case.

## Nineteenth workshop: Gazebo external physics and a force disturbance

**How does the controller respond when the world pushes the vehicle?** An actual
**Gazebo Harmonic** world simulates an Iris quadrotor, connected to **ArduCopter
SITL** through the official **ArduPilot Gazebo plugin** and JSON simulator backend.
EKF3 estimates and Gazebo world observations remain separate streams.

1. Observe takeoff and twelve simulation seconds of stationary Guided flight.
2. Compare a fresh nominal run with an eight-newton eastward force applied for
   one simulation second at the base link's center of mass.
3. Inspect applied force, actual tilt, peak horizontal displacement and the
   measured return criterion after release. The same autopilot controls both runs.
4. Compare the displayed world pose with the latest estimate. Channel ages and
   clock differences explain why their separation is not a synchronized accuracy
   measurement. Finish with telemetry-confirmed landing and disarming.

The linked 2D/3D views share one recorded cursor, with a detailed X-frame drone,
an optional estimate ghost and a force arrow. The yard is illustrative; actual
physics contains the vehicle and a ground plane. This bounded pulse is
an external force, not a wind simulation or an obstacle-avoidance scenario.

`npm run record:gazebo` builds an isolated Linux amd64 image and records
`local/ardupilot-gazebo.json`. The browser can use the bundled file without
Gazebo installed on the host. The [specification](docs/lessons/19-gazebo-physics.md)
defines the physics boundary, simulation clock, force application and evaluator
criteria separately from command acceptance and flight completion.

## Twentieth workshop: GCS heartbeat loss and an onboard failsafe

**Does restoring contact resume the flight?** Two actual **ArduCopter SITL**
recordings compare continuous **Ground Control Station (GCS) heartbeats** with
an eight-second interruption. Both use the same configured **GCS heartbeat
failsafe**: a three-second timeout, **LAND** response and no continuation options.

1. Establish the GCS heartbeat, arm normally and settle at four meters above home.
2. Stop sending flight commands in both cases. In one case, also suppress only
   the outgoing GCS heartbeat while continuing to receive vehicle telemetry.
3. Inspect the actual GCS-specific status text, LAND-mode report, pause and descent.
   The interrupted case has no LAND command or corresponding command ACK.
4. Restore heartbeats, then distinguish clearing the failsafe from resuming Guided
   flight. Confirm final landing with fresh on-ground and disarmed reports.

A detailed 3D drone and a linked 2D message/height diagram observe the same recording.
A ground-station display separates the two message directions. The scene is
illustrative; this experiment uses workshop 18's built-in SITL dynamics and
container-local TCP. It does not simulate radio propagation or a severed socket.

The sender's heartbeat age and the autopilot's received status remain distinct:
the browser never invents a failsafe transition when a displayed timer reaches
three seconds. Read the [specification](docs/lessons/20-gcs-failsafe.md) for source
identity, eligible traffic, clocks, the LAND pause and execution evidence.
`npm run record:failsafe` reuses the pinned SITL image and saves an importable
recording at `local/ardupilot-failsafe.json`.

## Twenty-first workshop: two vehicles and one addressed mission

**Did the assigned vehicle complete its own task?** Two actual **ArduCopter SITL**
processes execute visit-and-hold tasks selected by **nearest-pair greedy matching**
under one **central coordinator**. Separate MAVLink system IDs, TCP routes and
local estimator frames remain visible throughout the mission.

1. Observe normal takeoff, then inspect the horizontal cost matrix and owners.
2. Dispatch one local NED target to each vehicle and follow their received
   position/attitude estimates in the common, explicitly supplied ENU layout.
3. Compare correct addressing with an A1 setpoint whose destination system is 2,
   while still sent on A1's isolated connection. A2 receives its own task normally.
4. At the twenty-second deadline, separate confirmed task completion from the
   subsequent LAND requests and measured landing/disarming of both vehicles.

The two detailed 3D quadrotors and linked 2D plan/elevation share one recording
cursor. The yard is a supplied registration of independent SITL simulations;
there is no common collision physics, peer allocation or onboard rejection
capture. Setpoint messages have no command ACK. Completion requires fresh,
vehicle-specific position/velocity samples sustaining the declared dwell.

The [specification](docs/lessons/21-two-vehicle-mission.md) defines addressing,
frames, greedy costs and deadline evidence. `npm run record:fleet` reuses the
pinned SITL image and saves `local/ardupilot-fleet.json` for browser import.

## Twenty-second workshop: three-vehicle mission recovery

**When may unfinished work acquire a new owner?** Three actual **ArduCopter SITL**
vehicles visit six supplied points. A central **online nearest-pair greedy**
allocator selects idle vehicles and pending tasks; one **reactive Behavior Tree**
per vehicle runs in the Python coordinator and executes its flight requests.

1. Inspect normal Guided entry, arming and takeoff, then the first allocation.
2. Compare nominal execution with a controlled withdrawal during A1's second
   task. The higher-priority withdrawal branch halts the visit and requests LAND.
3. Observe the cancelled task remain reserved while A1 lands. An accepted command
   does not release ownership: fresh on-ground and disarmed reports are required.
4. Follow release, a new greedy decision and a new attempt by an available vehicle.
   Its visit must independently satisfy the full position/speed dwell.
5. Compare confirmed task counts, mission duration and later fleet landing.

The page exposes actual tree traversals, sampled inputs, action halts, exclusive
ownership, allocation snapshots and raw MAVLink evidence. Three detailed drones,
six target stations and linked 2D/3D views observe one recording cursor. The
supplied common yard registers independent local estimates; it adds no shared
collision physics, peer allocation, camera sensing or battery-failure model.

`npm run record:recovery` reuses the pinned SITL image and saves
`local/ardupilot-recovery.json` for import. See the
[specification](docs/lessons/22-mission-recovery.md) for control-flow semantics,
cancellation versus release, receipt clocks and completion criteria.

## Twenty-third workshop: three drones in one shared world

**What changes when three autopilots control bodies in the same physical scene?**
The shared-world mission combines the six known visits and reactive Behavior
Trees of workshop 22 with one **Gazebo Harmonic / DART** environment. Three
ArduCopter instances control three Iris X-frame quadrotors through separate
JSON bridges. **Central online nearest-pair greedy allocation** remains unchanged.

Compare nominal execution with controlled A1 withdrawal and confirmed task
handover. Inspect the allocator's received estimates alongside independent world
observations. All three world poses come from the same physics update, allowing
measured center-to-center separation. Cumulative contact histories monitor the
vehicles, ground and site buildings between displayed pose samples.

The page offers linked 2D/3D, world/estimate/both layers, per-vehicle cameras,
actual tree traversals and separate host/simulation clocks. The physical scene
matches the declared simulator geometry. World truth is evaluator-only: it does
not select an assignment or confirm a task. A clear known route does not establish
obstacle avoidance, and a sampled center distance does not establish continuous
hull clearance.

`npm run record:shared-world` records two fresh isolated worlds and saves
`local/ardupilot-shared-world.json` for import. See the
[specification](docs/lessons/23-shared-world-mission.md) and
[recorded results](docs/lessons/23-shared-world-mission-results.md) for the exact
clock, contact coverage, coordinate registration and completed verification.
The browser replays saved runs; live mission editing and systematic fault
campaigns are not implemented. See the
[integration limits](docs/learning-path.md#current-integration-limits).

## Implementation

- **Plain JavaScript modules and HTML/CSS:** each workshop has an independent
  model and page controller. `src/model.js`, `src/movement-model.js`,
  `src/mission-model.js`, `src/architecture-model.js`, `src/pathfinding-model.js`,
  `src/localization-model.js`, `src/fusion-model.js`, `src/orca-model.js`,
  `src/cbba-model.js`, `src/behavior-model.js`, `src/cooperative-model.js`,
  `src/slam-model.js` and `src/pose-graph-model.js`
  contain deterministic transitions without DOM, rendering
  or wall-clock dependencies. `src/assignment.js` implements the matching rules.
- **[Vite](https://vite.dev/guide/):** local development and static production
  builds, with twenty-three explicit HTML entries in `vite.config.js`. The lockfile records
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
  `referenceComparisons()` in `src/behavior-model.js`; cooperative localization
  uses `referenceComparisons()` and `compareSeeds()` in `src/cooperative-model.js`;
  EKF-SLAM uses the same helper names in `src/slam-model.js`, and pose-graph
  optimization in `src/pose-graph-model.js`.

Web dependency documentation was checked on 2026-09-14. Workshop 14 adds a
separate optional ROS 2 runtime, checked against official documentation on
2026-09-16. Its pinned Docker image contains Python, rclpy and Fast DDS;
`ros2/consensus.py` runs the processes and `src/ros2-trace.js` validates and
compares their recordings. Workshop 15 reuses that image: `ros2/freshness.py`
records periodic telemetry, and `src/qos-trace.js` validates and reads callbacks
without simulating transport. Workshop 16 uses `ros2/restart.py` for heartbeat
policies and actual process interruption, with `src/restart-trace.js` for checked
replay. Workshop 17 adds `ros2/middleware.py` and a derived Docker image with both
RMWs; `src/middleware-trace.js` validates its late-subscription recordings.
Workshop 18 adds `sitl/record.py` and a separate pinned ArduCopter/pymavlink image,
verified against official sources on 2026-09-18. `src/sitl-trace.js` independently
checks command and completion evidence. This workshop introduces actual SITL
flight dynamics; its browser remains a trace viewer. Workshop 19 adds an external
Gazebo world, the official ArduPilot Gazebo integration and a small C++ experiment
system in `gazebo/`. Its recorder reuses workshop 18's command/telemetry gates;
`src/gazebo-trace.js` validates world observations and evaluates horizontal return.
Workshop 20 reuses the built-in SITL runtime, adding a bounded GCS heartbeat
sender/interruption in `failsafe/record.py`. `src/failsafe-trace.js` validates
send history and independently derives received failsafe, mode and landing
evidence. The autopilot evaluates the timeout; the recorder configures it and
observes the response. Workshop 21 launches two owned processes in
`fleet/record.py`; `src/fleet-trace.js` independently recomputes assignment and
vehicle-specific completion within the shared mission deadline. Workshop 22
reuses those flight helpers in `recovery/record.py` while executing three actual
reactive Behavior Trees and online task ownership. `src/recovery-trace.js` checks
per-attempt dwell, complete allocation inputs, fresh release evidence and
recorded traversal/command causality independently. Workshop 23 reuses that
coordinator in `shared-world/record.py` with three bodies in one Gazebo world.
`SharedWorldObserver.cc` reports synchronous world poses and cumulative contacts;
`src/shared-world-trace.js` checks this evidence separately from mission completion.
The shared-world integration documentation was checked against official sources
on 2026-09-22.
Browser dependencies remain shared.

## Read next

| Document | Purpose |
| --- | --- |
| [Project scope](docs/charter.md) | Purpose, design principles and implementation boundaries. |
| [Module catalog](docs/learning-path.md) | Available modules, method context and integration limits. |
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
| [Cooperative-localization results](docs/lessons/11-cooperative-localization-results.md) | Joint covariance, missing references, shared prior offsets and paired-seed estimation errors. |
| [EKF-SLAM results](docs/lessons/12-ekf-slam-results.md) | Map initialization, pose/map corrections, sensor loss, bias and paired-seed errors. |
| [Pose-graph results](docs/lessons/13-pose-graph-slam-results.md) | Retrospective trajectory optimization, residuals, supplied correct/incorrect loops and paired-seed limits. |
| [ROS 2 results](docs/lessons/14-ros2-rounds-results.md) | Actual process traces, numerical equivalence and an incomplete round barrier. |
| [Freshness results](docs/lessons/15-ros2-freshness-results.md) | Measured callback ages, history-depth effects and stale retained information. |
| [Restart results](docs/lessons/16-process-restart-results.md) | Process exit versus suspicion, new incarnations and accepted-state recovery. |
| [Middleware results](docs/lessons/17-middleware-durability-results.md) | Actual late-join observations through Fast DDS and Zenoh, bounded history and live delivery. |
| [SITL results](docs/lessons/18-sitl-mavlink-results.md) | Actual takeoff, waypoint and landing telemetry versus command acceptance and a disarmed rejection. |
| [Gazebo results](docs/lessons/19-gazebo-physics-results.md) | External world dynamics, applied force, measured displacement and horizontal return under a bounded disturbance. |
| [GCS failsafe results](docs/lessons/20-gcs-failsafe-results.md) | Selective heartbeat suppression, continued telemetry, onboard LAND response and clearing without automatic mode restoration. |
| [Two-vehicle results](docs/lessons/21-two-vehicle-mission-results.md) | Central greedy assignment, isolated addressing, bounded task failure and separately confirmed fleet landing. |
| [Mission recovery results](docs/lessons/22-mission-recovery-results.md) | Three-vehicle task execution, reactive cancellation, retained ownership, reassignment and elapsed mission time. |
| [Shared-world results](docs/lessons/23-shared-world-mission-results.md) | Three Gazebo bodies, evaluator-only synchronized poses, sampled separation and cumulative physical contacts. |

Additional modules and integrations need their own specifications and validation.
