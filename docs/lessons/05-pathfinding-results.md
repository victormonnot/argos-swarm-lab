# A* path planning reference results

Measured on **2026-09-14** with Node.js **22.22.1**, using
`src/pathfinding-model.js`. Reproduce with `npm run --silent compare:pathfinding`.
The [JSON artifact](../results/pathfinding.json) records exact map cells, constants,
search/execution assumptions, full precision, runtime, base revision,
modified-worktree flag and SHA-256 model hash. The
[specification](05-pathfinding.md) defines the graph and motion.

## Nine comparable runs

All cases use one point robot at `(3.5,4.5)` m, goal `(10.5,4.5)` m, a known
12 × 9 grid of 1 m cells, exact pose, 1 m/s motion and 0.1 s updates. A* and
Dijkstra search the same free four-neighbor graph. Direct motion supplies only
the goal, with no obstacle planning.

| Map | Method | Outcome | Planned length | Travelled | Motion time | Search pops |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Open | A* | Goal reached | 7.0 m | 7.0 m | 7.0 s | 8 |
| Open | Dijkstra | Goal reached | 7.0 m | 7.0 m | 7.0 s | 74 |
| Open | Direct | Goal reached | 7.0 m unchecked | 7.0 m | 7.0 s | 0 |
| U-shaped | A* | Goal reached | 17.0 m | 17.0 m | 17.0 s | 30 |
| U-shaped | Dijkstra | Goal reached | 17.0 m | 17.0 m | 17.0 s | 95 |
| U-shaped | Direct | Collision | 7.0 m unchecked | 1.5 m | 1.5 s | 0 |
| Sealed | A* | No path | None | 0.0 m | 0.0 s | 6 |
| Sealed | Dijkstra | No path | None | 0.0 m | 0.0 s | 6 |
| Sealed | Direct | Collision | 7.0 m unchecked | 1.5 m | 1.5 s | 0 |

Pops count removals from the frontier, including the goal; its neighbors are not
relaxed after success. Planning consumes zero modeled motion time. The complete
search record can be inspected independently of physical motion; these counts
are not measured processing time or universal minimum-expansion claims.

Both graph methods return the same route in these presets, with different search
effort on open/U maps. A* uses a Manhattan lower bound while Dijkstra sets h=0.
They have the same nonnegative edge costs, start, goal, strict-improvement
relaxation and explicit tie ordering. Equal shortest lengths do not require
identical paths on every possible map.

Inside the U, a shortest graph route leaves through its opening and goes around
the wall before approaching the goal. The robot's Euclidean distance to its
destination initially increases on this valid detour. The direct baseline
contacts cell `(5,4)` at position `(5.0,4.5)` m, still 5.5 m from the goal.
Its nominal 7 m goal segment is not a collision-free route claim.

With the U sealed, search exhausts six reachable free cells. No waypoint is
issued and no physical time passes. This is an explicit unreachable outcome,
not successful execution. The direct baseline ignores that graph obstruction
and contacts the same wall.

## Checks actually run

- **54/54 Node tests passed**, including ten new pathfinding checks. An
  independent FIFO breadth-first oracle checks A* and Dijkstra on **103
  deterministic small grids**, including unreachable and start-equals-goal
  cases. Additional checks cover free adjacent path cells, Manhattan consistency
  and admissibility, independent snapshots, the 400-cell API limit, invalid
  endpoints, swept tunneling/corner/grazing contact, bounded motion, waypoint
  clamping, executor information isolation, no-path immobility, reset, immutable
  transitions, terminal behavior and all nine outcomes.
- **34/34 Chromium checks passed**, including six new pathfinding checks and all
  28 prior workshop checks. They cover g/h/f and undiscovered values, search-trace
  independence from physical motion, A*/Dijkstra outcomes, direct collision,
  no-path refusal, configured reset, nine comparisons, exact playback at two
  speeds, shared 2D/3D state, camera movement, keyboard cell navigation, 390 px
  layout, five-workshop navigation and unavailable WebGL. The deliberate
  unavailable-WebGL cases emit Three.js's expected context-creation diagnostic;
  there were no page exceptions.
- The JSON export completed successfully. Primary A* and Dijkstra papers were
  checked for their relevant shortest-path definitions and assumptions.
- A focused 3D/playback check passed again after raising the selection outline
  above occupied cells. Production build passed for five HTML entries. A
  compiled-preview check passed previous workshop steps, navigation, independent
  search inspection, A*/Dijkstra arrival, direct collision, sealed no-path,
  lazy 3D, separate robot/goal labels, 390 px layout and fresh browser back/forward
  pages, with no console/page errors or failed requests. A final compiled check
  verified separated start/waypoint labels and usable trace/motion controls.
- Local 2D/3D captures were inspected. A read-only audit verified the result
  table, all nine full-precision JSON rows and the source hash.

The optional Three.js chunk retains the existing build size warning (about
737 kB minified / 187 kB gzip). The pathfinding script is about 24.8 kB minified;
3D still loads only when requested.

The planner has the complete map and exact start. The follower uses exact own
pose and the next waypoint; it does not read collision truth to choose a velocity.
Contact evaluation checks the whole attempted segment and terminates the run,
clipping position at first contact. Its reported time is the end of the contact
interval rather than a sub-step impact timestamp.

These are shortest paths on the declared graph, not continuous-space optimal
routes or dynamically feasible trajectories. Instant turns, a point robot,
perfect localization and static obstacles are simplifying assumptions. No body
clearance, finite turning radius, uncertainty, replanning, local avoidance,
communication or multi-robot advantage is evaluated. Other browser engines and
physical deployments were not tested.
