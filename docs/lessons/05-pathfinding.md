# Lesson 05 — A* path planning and waypoint execution

**Status:** implemented locally at `/pathfinding/`; see the
[measured results](05-pathfinding-results.md). This is the first
bounded part of the motion/estimation topics. Localization errors are explored
in [lesson 6](06-localization.md), and shared target estimates in
[lesson 7](07-shared-estimates.md).

**Question:** how does a robot find a route around an obstacle, and what is the
difference between that route and the motion that follows it?

## Method profile

| Aspect | Choice | Meaning |
| --- | --- | --- |
| Main algorithm | A* graph search with Manhattan heuristic | Expand the lowest estimated total cost `f=g+h`; search a four-neighbor unit-cost grid. |
| Search comparison | Dijkstra's shortest-path algorithm | Set `h=0`; use the same graph, cost and stopping rule. |
| Execution baseline | Direct-to-goal waypoint following | Supply the goal as the only waypoint, with no obstacle planning. This is not APF. |
| Decision architecture | One onboard planner and one executor | A single-agent baseline isolates path planning before adding coordination or uncertain estimates. |
| Planner information | Complete static occupancy map, start and goal | All blocked cells are known before search; there are no discoveries or map updates. |
| Executor information | Exact own position and current waypoint | The executor follows a route; it has no obstacle-avoidance or replanning behavior. |
| Timing | Planning at initialization, then fixed 0.1 s execution | Search snapshots are an inspection history, not measured computation time or motion steps. |
| Communication | None | No peer messages, network topology or distributed search. |
| Fidelity | Planar point kinematics | Marker sizes and 3D wall heights are illustrations, not vehicle geometry. No acceleration, heading or turning constraint. |

The robot knows its exact pose. This does **not** model GPS loss, localization
uncertainty, SLAM or shared estimates. It has no body radius, dynamic obstacle,
local avoidance or flight dynamics. Each view displays the same physical run and
the same selected search snapshot.

## Graph and maps

Use a 12 × 9 grid of 1 m square cells, indexed by `id = 12y + x`, with y increasing
upward in the map. The center of cell `(x,y)` is `(x+0.5,y+0.5)` metres. Start cell
is `(3,4)` and goal cell `(10,4)`. The environment boundary limits the graph.

- Open grid: all cells are free.
- U-shaped obstacle: block `x=5, y=2…6` and `y=2 or 6, x=2…5`. The robot starts
  inside the U, which opens toward decreasing x. The goal is beyond its closed side.
- Sealed enclosure: add `x=2, y=3…5`, closing the opening. Six free cells remain
  reachable from the start; the goal is in another component.

Edges connect only horizontal/vertical adjacent free centers. Every edge costs
1 m. There are no diagonal edges or route smoothing. A* is optimal for this
declared graph, not for every continuous-space route or a vehicle's travel time.
The direct baseline uses one straight segment and has no graph-optimality claim.

## Search equation and trace

`f(n) = g(n) + h(n)`

- `g(n)`: shortest discovered route cost from start to cell n, in metres.
- `h(n) = |x_n - x_goal| + |y_n - y_goal|`: Manhattan lower bound, in metres,
  for A*. Walls may lengthen a route but cannot shorten this bound.
- `h(n)=0` for Dijkstra. Both use nonnegative unit edge costs.
- `f(n)`: estimated total route cost through n.

The open frontier contains discovered, unsettled cells. Select the minimum
`(f,h,cell ID)` lexicographically, remove it from open and settle it. Update each
free unsettled neighbor if the candidate `g(current)+1` is strictly smaller.
Store the predecessor for path reconstruction. Equal-cost candidates keep the
existing predecessor. Tie rules are explicit implementation choices.

Stop successfully when the goal is **removed from open**, not when it is first
discovered. If open becomes empty, report **no path in this graph**. Manhattan
distance is consistent for these edges: `h(n) ≤ 1 + h(neighbor)`, so settled nodes
do not need reopening. Changing edge costs or heuristics requires revisiting this
property; the implementation does not accept an arbitrary heuristic.

Count every removed node, including the goal, as an expansion/pop. On the goal
pop, no neighbors are relaxed. Store snapshot zero (only start in open), then
one snapshot per pop. The inspector shows open/settled sets, current cell, g/h/f
and predecessor at the selected snapshot. Undiscovered g/f are unknown, not zero.
The final route is separately shown after search. Looking backward through this
trace does not rewind the execution or suggest the final route was already known.

The educational implementation scans an array to select the next cell. Expansion
counts describe search effort on these graphs, not runtime, heap performance or
a universal claim that A* always explores the fewest possible cells. The search
API caps grids at 400 cells because complete inspection snapshots use quadratic
memory; the interface uses fixed 108-cell maps.

## Execute the route

Planning consumes zero modeled motion time. A found graph path becomes its cell
centers in order, excluding the starting center. The direct baseline instead
supplies only the goal, without checking obstacles in its planner.

For current position p, waypoint w, speed `v=1 m/s` and `dt=0.1 s`:

`p_next = p + min(1, v·dt / ||w-p||) · (w-p)`

If p=w, remain there and advance the waypoint. Exact arrival clamps to the
waypoint; a tolerance of `1e-12` handles floating-point boundaries. Each update
targets one waypoint, with no carry-over movement past a turn. These center-to-
center unit edges take ten intervals. Heading changes are instantaneous.

An evaluator checks the whole attempted segment against closed occupied-cell
squares using slab intersection, including boundary/corner contact. This detects
crossing a wall even if the proposed endpoint is free. At the first contact it
clips the displayed position to contact and terminates as **collision**. It does
not provide an avoidance velocity to the executor. Report model time at the end
of that 0.1 s interval; it is not an estimate of impact time finer than the step.

Success requires actually reaching the final waypoint without collision.
Finding a route alone is not arrival. An unreachable search never moves the
robot and stops at t=0 with **no path**. Other runs stop on arrival, first contact
or a 400-update / 40 s budget. Every attempted travel distance up to contact counts.
Euclidean goal distance may increase on a valid detour.

## Controls and comparisons

Changing map or method starts a paused run. Provide play/pause, fixed motion
steps, reset, run to outcome, and independent search-trace controls. Inspect a
cell by map selection or the cell selector; use the same selection in both views.
Show the algorithm name, graph cost, search pops, current waypoint, actual pose,
remaining goal distance, travelled length and evaluated outcome. Graph route and
actual trail must be distinct. Playback changes wall-clock scheduling only.

Compare all nine map/method combinations with identical start, goal and motion.
The direct baseline removes obstacle planning; it is not a competing optimal
graph solver. Dijkstra and A* compare search effort with the same graph objective.
Do not claim a multi-robot advantage from this one-agent baseline. Reloading or
switching workshops starts a fresh run.

Verify shortest costs and unreachability against an independent breadth-first
oracle on unit grids, adjacency/free cells, heuristic consistency, collision
geometry, motion bounds, information isolation, deterministic reset and view/
trace independence. Record only checks actually run.

Export the same nine reference runs with:

```sh
npm run --silent compare:pathfinding > docs/results/pathfinding.json
```

The [JSON artifact](../results/pathfinding.json) includes exact maps, search and
execution contracts, runtime, base revision, modified-worktree flag and model hash.

## Primary sources

- Peter E. Hart, Nils J. Nilsson and Bertram Raphael (1968),
  [A Formal Basis for the Heuristic Determination of Minimum Cost Paths](https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/astar.pdf),
  IEEE Transactions on Systems Science and Cybernetics 4(2), 100–107,
  [DOI](https://doi.org/10.1109/TSSC.1968.300136). The lesson specializes A* to a
  consistent Manhattan heuristic on a static four-neighbor grid.
- E. W. Dijkstra (1959),
  [A Note on Two Problems in Connexion with Graphs](https://ir.cwi.nl/pub/9256/9256D.pdf),
  Numerische Mathematik 1, 269–271, [DOI](https://doi.org/10.1007/BF01386390).
  The shortest-path problem is Problem 2. Explicit empty-frontier failure extends
  the connected-graph setting to the disconnected grids in this lesson.

Neither paper specifies this page's kinematic follower, collision evaluator or
UI. Their assumptions and their roles are declared separately above.
