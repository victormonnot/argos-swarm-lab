# Three-vehicle mission recovery: recorded results

The [specification](22-mission-recovery.md) defines online allocation, actual
reactive Behavior Trees, the controlled withdrawal and the task release rule.
The page at `/recovery/` replays three simultaneous ArduCopter streams and their
coordinator's recorded decisions on a shared receipt-time cursor.

## Reproduce and inspect

```sh
npm run dev
npm run compare:recovery
npm run record:recovery
npm run compare:recovery -- local/ardupilot-recovery.json
```

The [bundled recording](../results/ardupilot-recovery.json) contains a nominal
case and a fresh withdrawal case. Import a new recording to inspect another
actual execution. Follow **First dispatch → A1 withdraws → Task locked →
Landed → release → Reassigned → Six tasks done → All landed**, switching vehicle inspection
between A1, A2 and A3. The locked milestone shows the completed reactive tick,
including the actual task halt and higher-priority LAND request.

Runtime and result metadata are visible in the page. Comparison rows describe
the whole recording, while task ownership, tree traversals and request inspectors
show only evidence available at the current cursor. Each new attempt must earn
its own complete dwell; a cancelled attempt's samples cannot complete another
vehicle's work.

## Runtime boundary

The recorder reuses the existing pinned ArduCopter **4.7.1** plus-frame SITL image
and its Python/pymavlink dependencies. It starts three processes with distinct
working directories, instances **0/1/2**, system IDs **1/2/3** and loopback TCP
routes **5760/5770/5780**. The coordinator identity is **255:190**. All three
Behavior Trees execute in this coordinator, not inside the autopilot firmware.

The image build can download checksum-verified dependencies; actual recordings
use `--network none` with no published ports or real vehicle endpoint. The
browser requires neither Docker nor an active simulator to replay the bundle.
Source fingerprints include the dedicated recorder, shared fleet helper, shared
SITL helper and Dockerfile. `compare:recovery` checks all four against current
files. Imported metadata is provenance, not authenticated producer identity.

Both cases use the same six supplied visit-and-hold points and declared ENU
registration. Each task requires 3D error ≤ **0.5 m**, speed ≤ **0.4 m/s** and
**1,000 ms** of qualifying new local-position samples, with gaps ≤ **300 ms**.
The coordinator schedules ticks with a minimum **100 ms** wait after the previous
tick finishes; actual start/end times are recorded instead of assuming a precise
simulation-time rate. It uses local-position samples at most **500 ms** old for
allocation. A bounded **90 s** mission budget starts once all three takeoffs are
confirmed; measured mission duration ends at the sixth qualifying task sample.
The coordinator recognizes completion on its next tick and then requests cleanup.

The withdrawal condition becomes eligible **500 ms after A1's second setpoint**
and is sampled on the next coordinator tick. This is an explicit experimental
request, not a simulated battery fault or inference from missing telemetry.
Cancelled work stays reserved until fresh post-LAND on-ground/disarmed reports
permit release. Idle vehicles retain Guided position hold while waiting; waiting
in the tree sends no new goal or motion command.

## Measured observations

The bundled capture was recorded on **2026-09-19 at 18:37:28 UTC**. All timeline
times below use each case's shared recorder clock after setup, rounded to
milliseconds. Mission duration excludes setup and final landing cleanup.

| Observation | Nominal | A1 withdrawal |
| --- | --- | --- |
| Initial assignment | A1 → T1; A2 → T2; A3 → T3 | Same owners |
| Mission starts / s | 9.171 | 8.660 |
| First setpoint / s | 9.272 | 8.762 |
| Sixth task confirmed / s | 18.181 | 29.515 |
| Measured mission duration / s | **9.010** | **20.855** |
| Coordinator recognizes closure / s | 18.276 | 29.616 |
| Task result | 6/6; six completed attempts | 6/6; six completed attempts, one cancelled |
| Final completed tasks per vehicle | A1: T1, T4; A2: T2, T5; A3: T3, T6 | A1: T1; A2: T2, T5, T4; A3: T3, T6 |
| Duplicate task completions | 0 | 0 |
| All landing/disarming confirmations / s | 29.364 | 40.474 |
| Final flight result | 3/3 landed and disarmed | 3/3 landed and disarmed |

The withdrawal recording takes **11.845 s longer** to complete the six tasks.
This is an observed difference for these two fresh runs. It is not a statistical
estimate or a claim that this greedy policy minimizes recovery time. The inputs,
telemetry receipt schedules and later allocation decisions are not byte-identical.

### The interrupted T4 attempt

In the withdrawal case, A1 sends T4 as attempt **P4** after completing T1. A2 and
A3 complete their own second tasks while T4 stays reserved to the retiring A1.
Their **Wait** actions do not release that reservation or invent another task.

| Event | Host elapsed / s | Meaning |
| --- | --- | --- |
| A1 sends P4 / T4 | 13.304 | Correctly addressed position setpoint |
| Scheduled withdrawal trigger | 13.804 | Harness schedule, not yet the sampled executor input |
| Withdrawal sampled; P4 halted and locked | 13.808 | Reactive priority changes; T4 still belongs to A1 |
| A1 LAND request | 13.808 | Separate action, after the recorded halt |
| A1 LAND accepted | 13.811 | Admission; task ownership remains locked |
| A1 landing and disarming confirmed | 25.093 | Fresh post-request reports satisfy the landing gate |
| T4 released, then assigned to A2 as P7 | 25.163 | New ownership follows the observed retirement |
| A2 sends P7 / T4 | 25.264 | A new attempt with its own NED target and dwell |
| P7 / T4 confirmed | 29.515 | Sixth unique completed task |

Events that display the same rounded timestamp retain their exact ordering in
the recording. P4 is locked for **11.355 s** after cancellation. The withdrawal
request-to-T4-completion interval is **15.707 s**. At the replacement decision,
A2's measured horizontal cost to T4 is **5.983 m**; both A2 and A3 are eligible,
and the nearest-pair rule selects A2. P4 never acquires a completion record.
P7 earns a fresh full dwell rather than reusing P4's observations.

### Runtime provenance and resources

The runtime uses ArduCopter **4.7.1**, firmware revision
`dbe792162d06cab66c3475fd5556bf7a120f119e`, with model `+` and speedup one.
Pymavlink is **2.4.49**, Python **3.12.13**, on Linux amd64. The reused image is
`sha256:fd8d5c298e28f93e0fe0f65328799d1a942122417f8d8177dec26a024efc8a1c`,
built from the pinned base
`python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2`.
Its local image size is **240,338,809 bytes**.

Both cases retain normal arming checks, `ARMING_SKIPCHK=0`, `FS_GCS_ENABLE=0`,
`FS_THR_ENABLE=1`, zero configured wind and their individual `MAV_SYSID` readback.
Setup precedes the recorded timeline and takes **44.113 s** nominally and
**43.947 s** for withdrawal. Actual geographic homes, initial local baselines,
parameters and firmware reports remain in each vehicle's metadata.

The nominal case records **3,280 telemetry messages**, **282 coordinator ticks**
and **8 resource snapshots**. Withdrawal records **4,485 messages**, **397 ticks**
and **10 snapshots**. Three autopilot processes are alive at every captured
snapshot, including during mission execution. Their process IDs are **8/9/10**,
then **14/15/16**, within the recording container's namespace.

Per-process Linux **`VmRSS` ranges from 5,736 to 5,948 KiB** across the bundled
snapshots. These are sampled resident-memory observations for the autopilot
processes only: they exclude the coordinator, container overhead and operating
system, and do not measure peaks, CPU load or larger-fleet capacity.

Recorded fingerprints:

- Recovery recorder SHA-256:
  `2768599f6a4ce22bdfaf81cda9635ef875a210784e0c4ce35690db4249985a09`.
- Bundled JSON SHA-256:
  `a68580a28c9975ca1b5fd618179b61013868e6122e96f6d83d9a3f4e3375993e`.
- Bundled JSON size: **3,644,949 bytes**.

### Functional repeat

A fresh repeat completed on **2026-09-19 at 18:39:18 UTC**, using the same frozen
recorder and runtime image. It again produced **6/6 unique completed tasks and
3/3 landed vehicles in both cases**, with one cancelled A1/T4 attempt and its
replacement assigned to A2. Nominal duration was **8.953 s**; withdrawal duration
was **20.875 s**, a difference of **11.921 s**. In its withdrawal case, A1's
landing was confirmed at **25.165 s**, T4 was released at **25.225 s**, and A2
completed T4 at **29.665 s**.

The captures partly overlapped in separate network-isolated containers. This
repeat checks the ownership, interruption and completion behavior under another
actual execution; it does not provide an uncontended performance benchmark.
Both recordings pass `compare:recovery`, including matching fingerprints for
the recorder, shared fleet helper, shared SITL helper and Dockerfile.

## Completed verification

Checks completed on **2026-09-19**:

- **360 Node tests passed**, including **15 new recovery tests**. These cover
  current ownership and complete allocation candidate sets, per-attempt dwell,
  exact cancellation/deadline/freshness boundaries, source-specific landing,
  actual reactive traversal and command side effects, withheld future state,
  and rejected inconsistent imports.
- **33 Python tests passed**: 13 recovery, 11 fleet and 9 shared SITL checks.
  Recovery checks exercise priority reevaluation, sequence traversal,
  halt-before-LAND ordering, idempotent requests, cancelled-attempt exclusion,
  stale position/landing evidence, retained ownership and task release.
- The public capture and functional repeat both pass the import validator and
  source-fingerprint comparison. The public artifact's 15 dedicated Node checks
  also passed separately.
- A real **SIGINT during recording** returned exit **130**, preserved the
  pre-existing output and removed the owned runtime container.
- The production build passed with **22 HTML entries**. Vite reports its
  large-chunk advisory: the recovery entry embeds the trace in a **3,290.12 kB**
  minified JavaScript chunk, **540.33 kB** gzip. This is a local replay artifact,
  not a connection to an external flight service.
- **171 Playwright tests passed**, including nine recovery interactions and the
  full existing workshop regression. They cover milestones, exclusive ownership,
  actual halts, per-vehicle inspectors, linked views, playback, import rejection,
  single-case imports, mobile navigation and unavailable/lost WebGL.
- Production Chromium verification passed for all **22 routes**, both recorded
  cases, event milestones, tree halts, task ownership and separate flight cleanup.
  Desktop and **390 × 844** mobile checks retained the common cursor across 2D,
  3D and all three vehicle-follow cameras. No page, console or HTTP errors were
  observed. Visual inspection covered the yard, low-altitude close camera,
  mobile labels, 2D elevation and halted tree action.

## Interpretation and limits

The mission can finish with one vehicle withdrawn because the coordinator waits
for a justified release and assigns the remaining work to an eligible vehicle.
This experiment distinguishes allocation, action cancellation, confirmed physical
landing and task ownership. A tree returning Success is control-flow status;
mission completion still requires six independent task confirmations.

Halting a stateful task action does not retract a MAVLink position setpoint.
The higher-priority branch separately sends LAND; its acknowledgement is admission,
not proof of landing. The recording has no fictitious setpoint cancellation ACK.
A1's incomplete task remains locked during this interval.

The three built-in SITL worlds have independent dynamics. The shared yard is a
supplied registration of local estimates, not collision or aerodynamic coupling.
The workload does not implement peer-to-peer allocation, CBBA, ORCA, path planning,
shared localization, camera inspection, battery dynamics or radio-loss recovery.
A1 lands where the LAND controller brings it down; return-to-launch is not part
of this intervention. Scene structures are illustrative and supply no obstacle
or separation guarantees. Resource samples are bounded process observations,
not a fleet-capacity or hardware-readiness benchmark.
