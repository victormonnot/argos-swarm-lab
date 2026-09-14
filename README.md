# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination through reproducible
experiments. Change a parameter, observe collective behavior, introduce a failure
and compare the results.

**Available:** two local workshops with explanations, linked 2D/3D views, step
controls and measured comparisons: **distributed average consensus** and
**Artificial Potential Fields**. Other modules in the
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
the second workshop is at `/movement/`. Navigation starts a new run.

```sh
npm test                         # mathematical properties, failures and replay
npm run compare                  # consensus reference cases as JSON, with metadata
npm run compare:movement         # potential-field reference cases as JSON
npx playwright install chromium  # first browser-test setup
npm run test:e2e                  # Chromium interactions and both views
npm run build                    # static output in dist/
npm run preview                  # serve that build locally
```

On a Linux installation missing browser system libraries, use
`npx playwright install --with-deps chromium` for Playwright's documented setup.
The browser checks use software WebGL for reproducibility; they do not measure
hardware rendering performance. The [consensus results](docs/lessons/01-consensus-results.md)
and [potential-field results](docs/lessons/02-potential-fields-results.md) list the
checks actually run and their limitations.

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

## Implementation

- **Plain JavaScript modules and HTML/CSS:** each workshop has an independent
  model and page controller. `src/model.js` and `src/movement-model.js` contain
  deterministic transitions without DOM, rendering or wall-clock dependencies.
- **[Vite](https://vite.dev/guide/):** local development and static production
  builds, with two explicit HTML entries in `vite.config.js`. The lockfile records
  exact installed versions.
- **SVG and [Three.js](https://threejs.org/docs/pages/WebGLRenderer.html):** readable
  2D diagrams and spatial views with orbit controls. Each pair receives the same
  experiment snapshot; Three.js loads when a 3D view is requested.
- **[Node's test runner](https://nodejs.org/docs/latest-v22.x/api/test.html) and
  [Playwright](https://playwright.dev/docs/intro):** mathematical checks separately
  from browser interactions. `src/comparisons.js` runs the five reference cases
  for both the consensus page and its command-line result exporter. Movement
  references similarly use `compareMovement()` in `src/movement-model.js`.

Official dependency documentation was checked on 2026-09-14. Dependencies are
shared by both workshops; robotics middleware and flight dynamics are outside
their scope.

## Read next

| Document | Purpose |
| --- | --- |
| [Project scope](docs/charter.md) | Purpose, design principles and implementation boundaries. |
| [Module catalog](docs/learning-path.md) | Available modules and proposed extensions. |
| [Experiment guide](docs/experiment-guide.md) | Lesson format, comparisons and failure-model rules. |
| [Consensus results](docs/lessons/01-consensus-results.md) | Observed outcomes, verification and limits. |
| [Potential-field results](docs/lessons/02-potential-fields-results.md) | Measured arrival, stalls and contact failures. |

Additional modules and integrations need their own specifications and validation.
