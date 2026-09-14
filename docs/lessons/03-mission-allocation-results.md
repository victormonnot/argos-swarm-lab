# Task allocation and execution — measured results

Recorded on **2026-09-14** with Node.js **22.22.1**, using the
[declared mission model](03-mission-allocation.md). These measurements concern
the specified task set and ideal communication assumptions.

## Reproduce

After installing the repository's locked dependencies:

```sh
npm test
npm run test:e2e
npm run build
npm run compare:missions
```

The [JSON record](../results/missions.json) contains initial positions, task
coordinates, fixed owners, timing, failure ordering and six measured results.
It records base revision `0cffe21407a241ba03439f22752639f039169e93` with
`workingTreeModified: true`: the new workshop was measured before its commit.
SHA-256 hashes identify the actual matching and execution sources. To replace
the record with a fresh export without npm's command header:

```sh
npm run --silent compare:missions > docs/results/missions.json
```

The browser comparison and exporter execute the same `compareMissions()` model
function. There are no random inputs. All runs have identical starts, points,
speed, service duration and budget; the policy and scheduled failure are the
declared differences.

## Outcomes

| Policy | A2 at 5 s | Outcome | Completed | Final model time | Total travel | Reassignments | Lost service |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Fixed round-robin | Available | Completed | 6 / 6 | 15.7 s | 22.787 m | 0 | 0.0 s |
| Nearest-pair greedy | Available | Completed | 6 / 6 | 11.7 s | 17.803 m | 0 | 0.0 s |
| Hungarian algorithm | Available | Completed | 6 / 6 | 10.4 s | 16.203 m | 0 | 0.0 s |
| Fixed round-robin | Unavailable | Blocked | 4 / 6 | 11.0 s | 15.171 m | 0 | 1.0 s |
| Nearest-pair greedy | Unavailable | Completed | 6 / 6 | 22.1 s | 32.310 m | 1 | 1.0 s |
| Hungarian algorithm | Unavailable | Completed | 6 / 6 | 15.3 s | 17.842 m | 1 | 0.0 s |

The blocked run's final time is **not a successful mission completion time**.
Travel includes interrupted work. Reassignments count previously assigned tasks
receiving a different owner; first assignments of waiting tasks do not count.

## What these cases show

At the first dispatch, fixed and greedy both choose A1→T1, A2→T2, A3→T3, with
total distance `0.8 + 4 + 2 = 6.8 m`. Hungarian instead chooses A1→T2, A2→T1,
A3→T3, with `2 + 1.2 + 2 = 5.2 m`. Taking the cheapest pair first prevents A2
from receiving T1 and makes the overall greedy matching more expensive.

Hungarian's first matching minimizes that dispatch's sum of distances. The
algorithm is recomputed for later idle agents and pending tasks, while busy
owners continue their assignments. Its lower mission duration in these runs
is an observation, not a guarantee of optimal routing or scheduling.

With fixed or greedy ownership at 5 seconds, A2 has reached T2 and performed
1 second of service. Its failure discards that partial service. Fixed ownership
then strands T2 and T5; the other two agents finish their own jobs and remain
idle, leaving only 4/6 completed. Greedy can redistribute work, but its eventual
route to the remaining tasks is long in this geometry.

Under Hungarian assignment, A2 finishes T1 at 3.2 seconds and is travelling to
T5 at the failure boundary. Completed T1 remains completed. The interrupted T5
has no partial service to lose, although its attempted travel still counts.

For both adaptive policies, the released task waits until **8.3 seconds** for
A3 to finish T6. The measured reassignment delay is therefore **3.3 seconds**
after the 5-second event, despite zero detection delay. Greedy reassigns T2;
Hungarian reassigns T5. Fixed ownership never reassigns its released task in this
run. The event log makes the distinction between immediate knowledge and
available execution capacity visible.

## Checks actually run

- **34 Node tests passed:** the 22 existing consensus/movement checks plus four
  assignment checks and eight mission checks. The assignment tests compare 200
  small rectangular matrices with an independent exhaustive oracle and cover
  ties, empty sides, invalid/sparse inputs and a greedy counterexample.
- Mission checks cover target assignment versus arrival versus full service,
  exclusive ownership and bounded motion across every reference transition,
  preservation of completed work, exact failure ordering, lost partial service,
  fixed-policy blocking, adaptive recovery, terminal stopping and deterministic
  reset. An explicit boundary fixture checks completion immediately before a
  same-boundary failure.
- **22 Chromium interaction checks passed:** 16 existing checks plus six for
  the mission workshop. They exercise the visible states, cost matrix, six-case
  comparison, failure/recovery, fixed-policy blocking, reset, timed playback at
  two speeds, 2D/3D state invariance, camera orbit, keyboard operation, mobile
  navigation and unavailable WebGL. The initial full run passed 21/22; its
  playback test allowed the test clock to advance between actions. Explicitly
  pausing the clock and rerunning both clock-dependent mission tests passed 2/2.
  The correction affected test scheduling, not the model or page behavior.
- **Production build passed** with all three HTML entry points. The mission
  page script is approximately 23.2 kB minified. The optional shared Three.js
  chunk remains approximately 737 kB minified / 187 kB gzip, with Vite's existing
  size warning. No dependency installation or dependency changes were needed.
- **Built-page smoke check passed:** both older lessons advance, navigation
  reaches the mission page, Hungarian recovers after the scheduled failure and
  completes 6/6 at 15.3 s, lazy 3D preserves raw positions, agent/task labels do
  not overlap in that completed reference view, a 390 px page has no horizontal
  overflow, and browser history returns to a fresh usable mission. No page
  errors or failed requests were observed in this check.
- **Reference export ran** and produced the six recorded outcomes with metadata.

Browser verification uses Chromium and software WebGL. The intentionally blocked
WebGL test allows Three.js's expected context-creation diagnostic and confirms
that the 2D experiment remains usable. These checks do not evaluate real rendering
hardware, other browser engines, actual sensor service or field failure detection.

## Interpretation limits

The central allocator knows exact current reports and receives unavailability
immediately. Agent motion ignores obstacles, collisions and acceleration. Service
has fixed duration and restarts in full after interruption. There is no travel
back to a depot, energy budget or task-priority model.

Assignment, execution and mission evaluation answer different questions. A
minimum-cost current matching does not make every later decision optimal; an
executor remaining available does not mean the mission is complete. The observed
advantages depend on these points, timing and policies. Further architectural or
network comparisons require separate assumptions and experiments.
