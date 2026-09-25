# Decision architecture reference results

Measured on **2026-09-14** with Node.js **22.22.1**, using the deterministic model
in `src/architecture-model.js`. Reproduce the nine runs with
`npm run --silent compare:architectures`. The [JSON artifact](../results/architectures.json)
records full precision, parameters, transport phases, authority scopes, runtime,
base revision, modified-worktree flag and SHA-256 hashes for the architecture
model and its mission/assignment dependencies. The
[specification](04-decision-architectures.md) defines the protocol.

## Execution and confirmation

All cases reuse three executors, six tasks, nearest-pair greedy matching, a
0.1 s interval, 1 m/s point motion, 2 s service and a 60 s budget. Hierarchical
domains restrict task eligibility. No executor failure or collision is modeled.
The network cut separates {C,A1} from {A2,A3} at 2 s; restoration occurs at 8 s.

| Architecture | Network | Physically completed | Confirmation coverage | All work executed at | Final outcome | Travel (m) |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Central | Connected | 6/6 | 6/6 | 11.7 s | Confirmed at 11.7 s | 17.803014 |
| Subgroups | Connected | 6/6 | 6/6 | 15.7 s | Confirmed at 15.7 s | 22.786986 |
| Peers | Connected | 6/6 | 6/6 | 11.7 s | Confirmed at 11.7 s | 17.803014 |
| Central | Permanent cut | 6/6 | 4/6 | 27.7 s | Budget at 60 s | 25.563720 |
| Subgroups | Permanent cut | 6/6 | 2/6 | 15.7 s | Budget at 60 s | 22.786986 |
| Peers | Permanent cut | 3/6 | 1/6 | Not reached | Budget at 60 s | 6.800000 |
| Central | Restore at 8 s | 6/6 | 6/6 | 13.7 s | Confirmed at 13.7 s | 17.803014 |
| Subgroups | Restore at 8 s | 6/6 | 6/6 | 15.7 s | Confirmed at 15.7 s | 22.786986 |
| Peers | Restore at 8 s | 6/6 | 6/6 | 15.2 s | Confirmed at 15.2 s | 17.803014 |

Confirmation coverage is C's known count for central/subgroups and the minimum
known count over the three peers for peer runs. This peer metric is an evaluator
summary, not common knowledge or an implemented termination exchange. Budget
exhaustion is not the time at which physical work finished.

With permanent partition, final completion counts in the four caches are:

| Architecture | C knows | A1 knows | A2 knows | A3 knows |
| --- | ---: | ---: | ---: | ---: |
| Central | 4 | 4 | 2 | 2 |
| Subgroups | 2 | 2 | 4 | 4 |
| Peers | 1 | 1 | 2 | 2 |

C's A2/A3 reports remain sampled at 1.9 s during the cut, even after those
executors finish their jobs. C retains their reservations rather than reissuing
the same tasks. In the central permanent-cut run, A1 finishes other unreserved
work. The subgroup scopes let both domains continue independently. Peers finish
their first three jobs but make no new assignments during the cut: the full
roster barrier prevents them from acting on different sets of reports. At the
8 s restoration boundary, their three independently computed plans match and
they each accept their next target.

All nine reference runs have **zero extra concurrent owners** and **zero duplicate
completions**. The first metric is the maximum extra owner count for any one task;
the second sums extra completion owners across tasks. These measurements apply
to the declared transport and schedules, not arbitrary distributed failures.

## Packet accounting

Every boundary, including zero, attempts nine report sends. Report traffic is
therefore `9 × (finalStep + 1)`. A cut drops six reports per boundary, giving
360 dropped reports during 60 restoration-case boundaries or 3,486 during the
581 permanent-cut boundaries through the budget.

| Architecture | Network | Reports attempted | Reports delivered | Reports dropped | Peer proposals | Remote commands |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Central | Connected | 1,062 | 1,062 | 0 | 0 | 6 |
| Subgroups | Connected | 1,422 | 1,422 | 0 | 0 | 2 |
| Peers | Connected | 1,062 | 1,062 | 0 | 24 | 0 |
| Central | Permanent cut | 5,409 | 1,923 | 3,486 | 0 | 6 |
| Subgroups | Permanent cut | 5,409 | 1,923 | 3,486 | 0 | 2 |
| Peers | Permanent cut | 5,409 | 1,923 | 3,486 | 6 | 0 |
| Central | Restore at 8 s | 1,242 | 882 | 360 | 0 | 6 |
| Subgroups | Restore at 8 s | 1,422 | 1,062 | 360 | 0 | 2 |
| Peers | Restore at 8 s | 1,377 | 1,017 | 360 | 12 | 0 |

All attempted proposals and remote commands arrive in these cases. Peers send
proposals only for nonempty plans after receiving every current report. Local
reports, own proposals and self-commands are not network sends. The common
all-to-all report pattern is intentionally held constant and is not a minimum
traffic design for each architecture. Messages take zero phase time, and these
packet counts are not measured latency, bandwidth or byte counts.

## Checks actually run

- **44/44 Node tests passed**, including ten new architecture checks. They cover
  the connected central/peer/lesson-3 physical trace equivalence, cache isolation
  from evaluator truth and future schedules, report/command phase order, stale
  reservations, delegation scopes, barriers and recovery, physical completion
  without confirmation, ownership/service/motion invariants across all nine runs,
  packet accounting, immutability, reset and invalid configuration.
- **28/28 Chromium interaction checks passed**, including six new architecture
  checks and all 22 previous checks. They cover truthful cache inspection,
  permanent-cut outcomes, peer recovery, nonmutating reference comparisons, exact
  timed playback at two speeds, 2D/3D and camera invariance, selection of C and
  agents, keyboard focus, 390 px layout, all four navigation links and unavailable
  WebGL. No page exceptions occurred. The deliberate unavailable-WebGL checks
  emitted Three.js's expected context-creation diagnostic.
- The JSON export completed and records all nine outcomes above.
- Production build passed with four HTML entries. A compiled-preview smoke check
  passed previous workshop steps, navigation, central/subgroup partition outcomes,
  peer restoration, 3D with C/agent selection and unchanged raw state, 390 px
  layout and fresh usable pages after browser back/forward. It emitted no page
  or console errors and no failed requests.
- Read-only review verified all nine exported outcomes, all three result tables,
  and source hashes.

The optional shared Three.js chunk retains the existing build size warning
(about 737 kB minified / 187 kB gzip). The architecture page script is about
18.7 kB minified, plus shared view/model code.

These checks use a single browser process simulating distinct caches with a
deterministic scheduler. They do not verify real distributed deployment,
asymmetric packet loss, clocks drifting, leader election, consensus under crashes,
physical robot behavior or network performance. Hierarchy changes eligibility
as well as authority; the peer barrier deliberately trades availability for
agreement under this model. The results do not rank architecture families.
