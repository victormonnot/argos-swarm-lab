# Consensus workshop — observed results

Recorded on **2026-09-14** using the implemented synchronous averaging model.
These results concern scalar agreement under the declared assumptions, not
robot motion, radio performance or mission completion.

## Reproduce

Follow the [local setup](../../README.md#run-locally), then run:

```sh
npm test
npm run compare
npm run test:e2e
npm run build
```

The [machine-readable record](../results/consensus.json) includes the runtime,
Git base revision, modified-working-tree flag, SHA-256 hashes of the executed
model and comparison sources, initial conditions, events and outcomes. The first
implementation was measured before committing; its base revision alone does not
identify its new source files. The source hashes identify the measured model.

To create another JSON record without npm's command banner:

```sh
node scripts/compare.js > local/consensus-results.json
```

Create the output directory first if needed. The page's **Compare measured
reference runs** panel computes the same cases locally without changing the
interactive experiment.

## Fixed conditions

- Six agents with initial values `[0, 2, 4, 8, 10, 12]`, except the shifted case.
- Gain `alpha = 1/12`, synchronous updates, undirected unweighted links.
- Agreement: first state index `k` with the **unrounded** range
  `max(x[k]) - min(x[k]) <= 0.01`.
- Budget: 1,000 transitions. Every case runs through the full budget even when
  it reaches agreement earlier.
- One directed scalar exchange per active edge endpoint per transition: `2E`.
  Counts to agreement include only the transitions up to that first state.
- Recovery removes A3–A4 at boundary `k=0` and restores it at `k=100`, before
  the transition from state 100 to state 101. Agent labels are one-based in the
  page; event indices in JSON are zero-based.

## Measurements

| Case | First agreement step | Exchanges to agreement | Range at step 1,000 | Total exchanges |
| --- | ---: | ---: | ---: | ---: |
| Complete graph | 11 | 330 | 3.55 × 10⁻¹⁵ | 30,000 |
| Chain | 314 | 3,140 | 1.83 × 10⁻⁹ | 10,000 |
| Two disconnected chains | Not reached in 1,000 steps | — | 8.000000000000012 | 8,000 |
| Chain, cut at 0 and restored at 100 | 406 | 3,860 | 1.48 × 10⁻⁸ | 9,800 |
| Complete graph, all initial values +100 | 11 | 330 | 5.68 × 10⁻¹⁴ | 30,000 |

The complete graph spends 30 exchanges per transition versus the chain's 10,
but reaches the threshold in fewer steps and fewer exchanges. This comparison
uses the same gain; it does not establish an optimal network or update rule.

The separated components approach means `2` and `10`. Their internal agreement
does not yield global agreement. Recovery reaches the threshold 306 transitions
after reconnection. This result assumes that the restored graph then stays
connected.

Adding 100 shifts the mean from `6` to `106` and preserves the disagreement
trajectory in exact arithmetic. The recorded floating-point traces differ at
roundoff scale; no external reference value is part of the model. Tiny nonzero
final ranges are floating-point residuals, not measured correctness.

## Verification and limits

Installed versions: Node.js **22.22.1**, npm **10.9.4**, Vite **8.3.0**,
Three.js **0.186.0**, Playwright **1.63.0**. The included lockfile records the
dependency set; `npm ci` was run successfully during verification.

**Executed checks:** 12 model tests passed, 10 Chromium browser tests passed,
`npm ci` succeeded, and the production build and preview smoke check succeeded.

The model checks exercise synchronous neighbor-only updates, mean preservation,
convex bounds and nonincreasing range over all 32 chain subgraphs, convergence,
separated component means, isolated/equal inputs, translation, reconnecting,
exchange counts, input rejection and finite extreme inputs. Replay checks compare
numerical histories, ordered events and terminal graph state, including zero-step
and final-boundary edits. Reset and the exact budget are also checked.

Browser checks cover the page controls, edited replay (including unapplied input
drafts and final-boundary events), graph switching, orbit controls, keyboard
navigation, measured comparisons and the responsive layout. A controlled browser
clock verifies identical numerical traces at 1 and 20 playback steps per second.
A deliberately blocked WebGL 2 context produces the expected unavailable message;
the 2D model controls continue correctly. Normal flows emit no console or page
errors; the blocked-context check allows only the expected Three.js diagnostic. The production build was also served locally: one complete-graph
step produced `[3, 4, 5, 7, 8, 9]`, then switching to 3D preserved the state and
loaded the WebGL canvas without page errors or failed requests. Chromium runs with software WebGL, so the 3D check establishes
rendering and interaction in that environment only. Screenshots were inspected
at desktop and narrow mobile widths. Numerical claims are supported by model
checks, separately from the screenshots.

The build succeeds with a size warning for the optional Three.js chunk
(approximately 737 kB minified, 187 kB gzip). This chunk loads only when 3D is
selected; the initial application script is approximately 24 kB minified.

The UI uses a linear disagreement plot. Tiny differences can be visually
indistinguishable; the numerical range and threshold result use unrounded state.
Displayed agent values are rounded for reading. Initial values are restricted to
finite numbers between -1,000,000 and 1,000,000. Runs stop at 1,000 updates and
exist only in tab memory. No import/export of interactive runs is implemented.

No asynchronous timing, directed failures, delays, packet randomness, membership
changes, localization, physics, hardware deployment or browser-engine comparison
was evaluated. This experiment supports no conclusions about those cases.
