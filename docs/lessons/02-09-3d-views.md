# 3D display conventions for workshops 2–9

The early workshops use detailed quadrotors, shaded volumetric sites and
whole-site/follow cameras to make spatial relationships easier to inspect.
These views consume the original experiment snapshots. Switching views,
framing a camera or inspecting another agent never advances the experiment.

## Geometry and meaning

| Workshop | 3D representation | Model boundary |
| --- | --- | --- |
| 2 — Artificial Potential Fields | Three quadrotors, ground collision disks, capsule walls and local vector arrows. | Drone diameter follows the modeled disk diameter; wall footprints are unchanged. Fixed display altitude does not allow flying over a wall. |
| 3 — Task allocation | Moving quadrotors, target stations, assignment paths and service progress. | Motion remains planar point kinematics with no obstacle or collision model. Station volumes illustrate task positions. |
| 4 — Decision architectures | The same mission site, with received knowledge distinguished from physical progress. | Scene positions do not determine logical communication links. The selected observer retains its own report cache. |
| 5 — A* planning | One quadrotor, extruded blocked cells, planned path, executed trail and search overlays. | Each blocked footprint is the original grid cell. Airframe size, yaw and altitude add no body, turning or vertical constraint to the point model. |
| 6 — Kalman localization | A solid truth drone and wireframe estimated drone, with uncertainty and position discrepancy. | The estimate is a second representation of the same robot, not another vehicle. Its controller still receives only the declared estimator output. |
| 7 — Shared estimates | Stationary observer drones beside the target-estimate markers and covariance contours. | The observer layout is illustrative. Estimate revisions are information updates, not aircraft trajectories or range-based sensing. |
| 8 — ORCA | Quadrotors over their collision disks, goals, trails and selected velocity evidence. | The model remains holonomic planar disk motion. All drones share one fixed display height; no vertical avoidance is introduced. |
| 9 — CBBA | Stationary planners, task stations, communication links and task claims. | Claims remain plans. No drone executes a bundle or completes a task in this workshop. |

Each scene states its display-height or layout convention. Orientation follows
available movement direction for legibility; it is not an attitude or flight
dynamics calculation. Propeller poses use experiment time where motion is
modeled; camera movement does not create another animation clock.

Ground projections preserve the relationship with 2D coordinates. Scenery at
the edge of a display site adds scale and depth without adding obstacles to an
algorithm that does not model them. Model obstacles retain their original
footprints. Height extrusions do not change modeled sensing or reachability. In A* and
localization, walls obscuring the inspected drone become translucent for the
camera; their occupied footprints remain unchanged. This display cutaway does
not give the robot new sensor information or a route through an obstacle.

## Interaction and rendering

**Whole site** restores an overview. The second camera button focuses or follows
the inspected drone; orbit and zoom remain available. Camera controls only
affect the renderer. The existing 2D diagrams, state tables, failure cases,
search snapshots, observer controls and numerical comparisons remain available.
If WebGL is unavailable, the original 2D experiment still works.

`src/workshop-scene.js` provides display-only drone geometry, stage lighting and
camera controls for these views. Each lesson owns its coordinates, state
interpretation, overlays and camera framing. No dependency, simulator backend
or algorithm has been added by this visual update.

## Verification

Verified on 2026-09-22:

- All 374 Node tests pass; the production build includes all 23 workshop entries.
- All 182 browser regression checks were verified across the full run and a
  targeted rerun of the 12 Movement/A* checks, including the new camera controls.
- Production Chromium checks cover all eight refreshed scenes at 1440 × 1000
  and 390 × 844. Whole-site, follow and mobile captures were visually inspected.
- Camera framing, resizing and switching between 2D and 3D preserve the paused
  numerical state and original SVG content. No page or console errors or
  horizontal mobile overflow occurred during these checks.
- A* and localization were checked again after adding the wall cutaway to keep
  their drones visible. Occupied cells and numerical state remain unchanged.
- Actual WebGL context loss on those two production pages removes the canvas;
  returning to 2D preserves the state and the next model step still works.

These checks verify rendering and shared-state behavior. They do not establish
flight realism or new mission capabilities. The existing large-bundle build
warning for embedded recordings remains.
