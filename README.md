# ARGOS Swarm Lab

An interactive tool for exploring multi-robot coordination through reproducible
experiments. Change a parameter, observe collective behavior, introduce a failure
and compare the results.

**Available:** a local consensus workshop with explanations, linked 2D/3D views,
step controls, link editing, replay and measured reference comparisons. Other
modules in the [catalog](docs/learning-path.md) remain proposals.

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
the lesson loads its assets locally.

```sh
npm test                         # mathematical properties and replay
npm run compare                  # measured reference cases as JSON, with metadata
npx playwright install chromium  # first browser-test setup
npm run test:e2e                  # Chromium interactions and both views
npm run build                    # static output in dist/
npm run preview                  # serve that build locally
```

On a Linux installation missing browser system libraries, use
`npx playwright install --with-deps chromium` for Playwright's documented setup.
The browser checks use software WebGL for reproducibility; they do not measure
hardware rendering performance. The [result record](docs/lessons/01-consensus-results.md)
lists the checks actually run and their limitations.

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

## Implementation

- **Plain JavaScript modules and HTML/CSS:** a single lesson does not need a UI
  framework. `src/model.js` contains deterministic state transitions without DOM,
  rendering or wall-clock dependencies; `src/main.js` connects controls to it.
- **[Vite](https://vite.dev/guide/):** local development and static production
  builds. The lockfile records exact installed versions.
- **SVG and [Three.js](https://threejs.org/docs/pages/WebGLRenderer.html):** readable
  2D nodes and a spatial view with orbit controls. Both receive the same snapshot.
- **[Node's test runner](https://nodejs.org/docs/latest-v22.x/api/test.html) and
  [Playwright](https://playwright.dev/docs/intro):** mathematical checks separately
  from browser interactions. `src/comparisons.js` runs the five reference cases
  for both the page and the command-line result exporter.

Official dependency documentation was checked on 2026-09-14. Dependencies are
limited to the first workshop; robotics middleware and flight dynamics are outside
its scope.

## Read next

| Document | Purpose |
| --- | --- |
| [Project scope](docs/charter.md) | Purpose, design principles and implementation boundaries. |
| [Module catalog](docs/learning-path.md) | Available initial module and proposed extensions. |
| [Experiment guide](docs/experiment-guide.md) | Lesson format, comparisons and failure-model rules. |
| [Consensus results](docs/lessons/01-consensus-results.md) | Observed outcomes, verification and limits. |

Additional modules and integrations need their own specifications and validation.
