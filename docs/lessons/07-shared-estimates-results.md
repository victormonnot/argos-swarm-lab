# Shared-estimation results

Measured on 2026-09-14 with Node.js 22.22.1. See the
[specification](07-shared-estimates.md) for equations, assumptions and sources,
and the [JSON artifact](../results/fusion.json) for full precision, source hash,
runtime, base revision and all 1,000 per-trial MSE/NEES records.

Reproduce with `npm run --silent compare:fusion > docs/results/fusion.json`.
No later observation is generated: every run starts with the same three
seed-aligned target measurements and ends at round 12.

## Seed 1, final round

MSE is squared position error averaged over the three agents in this particular
run. Reported trace and expected trace are averaged across agents, in m².
The expected trace comes from analytical source coefficients under the declared
sensor model; it is not estimated from this seed's error. Maximum ratio is the
largest agent expected/reported trace ratio. Records count delivered logical
records, not bytes.

| Method | Schedule | Sample MSE (m²) | Reported trace (m²) | Expected trace (m²) | Maximum ratio | Packets delivered / dropped | Records |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| No sharing | Ring | 0.982801 | 1.280000 | 1.280000 | 1.000 | 0 / 0 | 0 |
| Naive fusion | Ring | 0.821168 | 0.000313 | 0.426667 | 1365.333 | 36 / 0 | 36 |
| Naive fusion | Cut | 1.565837 | 0.464888 | 1.100453 | 56.975 | 24 / 12 | 24 |
| Naive fusion | Restore at 5 | 1.089134 | 0.000882 | 0.651075 | 739.641 | 32 / 4 | 32 |
| Unique measurements | Ring | 0.821168 | 0.426667 | 0.426667 | 1.000 | 36 / 0 | 99 |
| Unique measurements | Cut | 1.125069 | 0.782222 | 0.782222 | 1.000 | 24 / 12 | 35 |
| Unique measurements | Restore at 5 | 0.821168 | 0.426667 | 0.426667 | 1.000 | 32 / 4 | 79 |
| CI, half weight | Ring | 0.821168 | 1.280000 | 0.426667 | 0.333 | 36 / 0 | 36 |
| CI, half weight | Cut | 1.732147 | 1.280000 | 1.277091 | 1.000 | 24 / 12 | 24 |
| CI, half weight | Restore at 5 | 1.484045 | 1.280000 | 0.994445 | 0.778 | 32 / 4 | 32 |

Naive fusion and CI have identical means on the intact ring. Their difference
is the covariance claim: naive fusion reports per-axis variance 0.00015625 m²,
while the actual expected variance is 0.2133333588 m², a factor of about 1,365.
CI retains 0.64 m² and is conservative. The ledger has exactly the pooled mean
and covariance 0.64/3 m² per axis from round 2 onward. Further sharing contains
no fresh independent measurement.

The permanently cut ring reaches source counts [1,2,3] for A1/A2/A3. Repeated
summaries give disproportionate influence to upstream sources; even conservative
CI may become less accurate. Restoring the link does not automatically undo
past weighting. The ledger reaches full source coverage at A1 in round 5 and
A2 in round 6; A3 already had all sources in round 2. It then reproduces the
intact-ring pooled estimate.

All sharing cases attempt 36 packets. Ledgers deliver 99/35/79 logical records
on ring/cut/recovery, compared with 36/24/32 summary records. This exposes a
payload tradeoff without claiming measured bandwidth or runtime.

## All one hundred paired seeds

Every configuration uses seeds 1–100: ten configurations and 1,000 trials.
Each row averages the final three-agent MSE of one hundred runs. Mean NEES
averages the corresponding normalized squared errors. No trial is excluded.
Agents within a run and methods sharing a seed are correlated observations.

| Method | Schedule | Trials | Mean sample MSE (m²) | Exact expected MSE (m²) | Mean NEES |
| --- | --- | ---: | ---: | ---: | ---: |
| No sharing | Ring | 100 | 1.311851 | 1.280000 | 2.050 |
| Naive fusion | Ring | 100 | 0.444575 | 0.426667 | 2845.280 |
| Naive fusion | Cut | 100 | 1.197702 | 1.100453 | 50.286 |
| Naive fusion | Restore at 5 | 100 | 0.707868 | 0.651075 | 1604.496 |
| Unique measurements | Ring | 100 | 0.444575 | 0.426667 | 2.084 |
| Unique measurements | Cut | 100 | 0.838034 | 0.782222 | 2.127 |
| Unique measurements | Restore at 5 | 100 | 0.444575 | 0.426667 | 2.084 |
| CI, half weight | Ring | 100 | 0.444575 | 0.426667 | 0.695 |
| CI, half weight | Cut | 100 | 1.386036 | 1.277091 | 2.166 |
| CI, half weight | Restore at 5 | 100 | 1.083705 | 0.994445 | 1.693 |

For exact unbiased two-dimensional covariance, NEES has expectation 2. A finite
sample can differ from that expectation: CI under the cut has sample mean 2.166,
although its exact covariance bound still holds at every checked boundary.
The analytic coefficient calculation establishes overconfidence in the naive
mode; sample NEES alone is not treated as a hypothesis test.

The near-equality of ring MSE between naive, ledger and CI is deliberate. This
experiment distinguishes estimation accuracy from covariance reporting, not an
algorithm that wins every metric. The cut/recovery cases also show that fixed
CI averaging is not minimum-error estimation across this network.

## Actual verification

- **74/74 Node tests passed**, including ten new fusion checks. Independent
  information-form calculations cover unequal input precision, fixed-half CI
  and the complete ring matrix solution through round 12. Checks cover exact
  expected covariance, synchronous one-hop propagation, deduplication,
  cut/restoration, record counts, observation isolation, identical paired inputs,
  frozen-state replay, terminal behavior, malformed inputs and all 1,000 trials.
- A separate read-only mathematical review checked 936 boundaries across six
  seeds, four methods and three schedules, plus 34 validation, replay and
  information-isolation probes. It matched source-weight reconstruction, exact
  covariance, CI consistency, snapshot-built packets and transport accounting.
- The numerical exporter ran successfully. Primary sources were checked for
  independent information fusion, shared-evidence failure and CI; the visible
  fixed-weight protocol and ledger are declared teaching choices.
- **46/46 Chromium tests passed** in the full suite, including six new fusion
  tests and all forty earlier checks. They cover round-2 overlap, naive/CI means,
  ledger idempotence, packet contents and recovery without backlog, applied seed
  drafts, paired tables, exact playback at two speeds, observer/camera invariance,
  2D/3D, context loss, unavailable WebGL, keyboard, 390 px layout and navigation
  across seven pages. No page exceptions occurred. Deliberately unavailable WebGL
  emits Three.js's expected context-creation diagnostic.
- Production build passed for seven HTML entries. No dependency installation
  or version change occurred. The fusion script is about 25.9 kB minified /
  10.1 kB gzip; the optional Three.js chunk retains its existing size warning,
  about 737 kB minified / 187 kB gzip.
- A production-preview smoke check passed all seven routes and the six prior
  workshops' first steps, overlap and uncertainty metrics, identical naive/CI
  means, lazy 3D with unchanged raw state, distinct labels, ledger restoration,
  comparisons, 390 px layout and fresh usable back/forward navigation. No
  console/page errors or failed requests occurred. Local 2D, 3D and mobile
  captures were inspected.
- An independent read-only audit matched the source hash, metadata, original
  seed-1 observations, ten references, 1,000 compact trials, ten aggregates,
  six numerical parameters and twenty result-table rows. All 68 local public
  Markdown links resolve.

This experiment does not test real sensors, networking, vehicle motion, robotics
middleware or physical mission performance. Other browser engines were not tested.
