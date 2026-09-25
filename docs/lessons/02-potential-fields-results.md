# Artificial Potential Fields — measured results

Recorded on **2026-09-14** with Node.js **22.22.1**. These results describe the
declared [lesson model](02-potential-fields.md), not physical robots or a general
guarantee for potential-field controllers.

## Reproduce

From the repository root after installing the locked dependencies:

```sh
npm test
npm run test:e2e
npm run build
npm run compare:movement
```

The [JSON record](../results/potential-fields.json) contains exact initial
conditions, maps, gains, thresholds, outcomes, final positions and source hash.
It records the base revision `2975625c469f7dd2d9609f22d36fade500fbfea3` and
`workingTreeModified: true`, so that revision alone does not identify the
executed source. The model SHA-256 identifies the actual numerical source used.
To save a fresh JSON record without npm's command header:

```sh
npm run --silent compare:movement > docs/results/potential-fields.json
```

The browser's reference comparison table and exporter call the same model
function. Runs are deterministic and stop at their first evaluated outcome or
the 2,000-update budget. Time is model time, not elapsed computation time.

## Reference outcomes

All cases use the three reference starts, a `0.8 m` goal radius, `0.12 m` agent
radius, `0.10 m` wall radius, a `1 m/s` cap and a `0.02 s` update. Only the map or
one explicitly listed gain changes.

| Case | Outcome | Update | Model time | Centres inside goal | Minimum swept clearance | Total path, all agents |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Open field | Arrived | 406 | 8.12 s | 3 / 3 | 0.318987 m | 22.299920 m |
| Open corridor | Arrived | 407 | 8.14 s | 3 / 3 | 0.267445 m | 22.324085 m |
| U-shaped trap | Stalled | 330 | 6.60 s | 0 / 3 | 0.267442 m | 13.276617 m |
| Open field, separation gain = 0 | Collision | 241 | 4.82 s | 0 / 3 | −0.000107 m | 14.460000 m |
| U-shaped trap, obstacle gain = 0 | Collision | 239 | 4.78 s | 0 / 3 | approximately 0 m (contact) | 14.340000 m |

The last clearance is about `−3.69e−15 m` in the recorded floating-point run.
It is contact at numerical precision, not a meaningful penetration depth. The
collision times and positions mark the **end of the first update containing
contact**; the evaluator does not compute the exact contact instant.

Open ground and the corridor succeed for these gains and starting positions.
Separation distributes the agents within the goal region; they are not required
to occupy exactly the same point. The corridor changes trajectories and clearance
slightly while retaining arrival.

In the U, the final farthest goal distance is approximately `3.611620 m`. Forward
attraction balances wall repulsion. The agents satisfy the measured 100-update
stall criterion without reaching the goal. A route around the U exists, but this
reactive controller contains no route search or escape procedure. The measured
stall is not a proof about all possible perturbations.

Removing separation causes agent/agent contact on open ground. Removing wall
repulsion causes wall contact in the U. Neither change constitutes recovery.
The shared evaluator stops the entire experiment on the first contact interval;
there is no simulated impact response or post-collision mission continuation.

## Checks actually run

- **22 Node model tests passed:** 12 existing consensus checks and 10 movement
  checks. Movement coverage includes vector direction and speed cap, local peer
  sensing and evaluator independence, synchronous reflection symmetry, swept
  wall/peer collisions including safe endpoints, nominal arrival, the U stall,
  both repulsion ablations, deterministic reset and invalid configurations.
- **16 Chromium interaction checks passed:** 10 existing consensus checks and
  six movement checks. These cover navigation, fixed-step playback, draft/applied
  gains, reset, terminal outcomes, comparisons, unchanged raw state across
  2D/3D and camera orbit, keyboard selection, a 390 px layout and unavailable
  WebGL. The first full run passed 15/16; the remaining check used a nonexistent
  label selector. Correcting that test selector and rerunning the affected test
  passed. No application change was needed for that failure.
- **Production build passed** with both `dist/index.html` and
  `dist/movement/index.html`. The new page script is approximately 19.4 kB
  minified. The shared optional Three.js chunk remains approximately 737 kB
  minified / 187 kB gzip and triggers Vite's size warning; it loads on demand.
- **Built-page smoke check passed:** first consensus update, navigation to
  movement, corridor arrival, U stall, lazy 3D loading with unchanged raw
  positions, narrow layout without page overflow, and usable fresh runs after
  browser history navigation. No page errors or failed requests were observed
  in that check.
- **Comparison export ran** and produced the five records above with metadata.

Browser checks used Chromium with software WebGL. The deliberately blocked
WebGL test produced Three.js's expected context-creation diagnostic while the
2D controls continued working. Tests do not measure hardware frame rate, real
network behavior, other browser engines or physical collision avoidance.

## Interpretation limits

Exact sensing, an exact static map, instantaneous velocity tracking and planar
disk geometry are deliberate simplifications. The speed cap and discrete update
do not ensure safety for arbitrary gains or initial conditions; even weak
positive repulsion can produce contact. The evaluator checks swept motion but
does not prevent collisions.

The measured outcomes support the named configurations. They do not establish
that APF always arrives, that stopping implies success, or that this model
reproduces a full robot controller. See the lesson's primary method reference
and explicit velocity-model adaptation before extending its claims.
