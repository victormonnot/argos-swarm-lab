# Two-vehicle mission: recorded results

The [lesson specification](21-two-vehicle-mission.md) defines the two-vehicle
experiment, task criteria, addressing intervention and independent frame
registration. The page at `/fleet/` replays actual ArduCopter telemetry; it does
not run an additional browser flight model.

## Reproduce and inspect

```sh
npm run dev
npm run compare:fleet
npm run record:fleet
npm run compare:fleet -- local/ardupilot-fleet.json
```

The browser uses [the bundled recording](../results/ardupilot-fleet.json) and can
import a fresh recording. Start with **Dispatch**, compare A1 with A2, then seek
**Deadline** and **Both landed**. Route identity, outgoing destination and raw
received source fields remain separately inspectable. Comparison rows describe
the entire recording; the current-cursor inspectors reveal only observed events.

The recorder runs two independently addressed simulator processes per case,
inside an isolated Docker container with no published ports or real vehicle
endpoint. It reuses the pinned [SITL image](../../sitl/Dockerfile), shared
[telemetry gates](../../sitl/record.py) and dedicated
[fleet recorder](../../fleet/record.py). The optional first image build needs
network access; the flight recording uses `--network none`.

## Runtime and interpretation

- ArduCopter **4.7.1**, firmware revision
  `dbe792162d06cab66c3475fd5556bf7a120f119e`, plus-frame quadrotors, speedup one.
- Pymavlink **2.4.49**, Python **3.12.13**, Linux amd64; unchanged SITL image
  `sha256:fd8d5c298e28f93e0fe0f65328799d1a942122417f8d8177dec26a024efc8a1c`.
- Coordinator **255:190**, vehicles **1:1** and **2:1**, TCP routes **5760** and
  **5770**, separate instance numbers, working directories and local estimators.
- Central **nearest-pair greedy matching** uses each vehicle's latest fresh
  position in the supplied ENU registration. Both owners remain fixed.
- Every task requires error ≤ **0.5 m**, speed ≤ **0.4 m/s**, and **1 s** of
  uninterrupted qualifying received local-position samples, with gaps ≤ **300 ms**.
- The task cutoff is exactly dispatch-window start + **20,000 ms**. The recorded
  closure event may occur slightly later when the recorder finishes its pump;
  samples after the logical cutoff cannot complete a task.
- Both runs use normal arming checks, `FS_GCS_ENABLE=0`, `FS_THR_ENABLE=1` and
  zero configured wind. Correctly addressed LAND requests follow the task window.

The captured homes are four meters west/east of the declared center. Each
vehicle's first recorded local position supplies its baseline. Mapping it to the
known pad is a configured registration, not measured common-map localization.
The supplied task positions are `[-4, 6, 4]` and `[4, 8, 4]` meters ENU.

Capture metadata and source hashes are embedded in the JSON. `compare:fleet`
checks recorder, shared helper and Dockerfile fingerprints against current files.
Hashes establish consistency, not authentication of an imported producer.

## Observations and verification

The bundled capture was recorded on **2026-09-18 at 10:33:03 UTC**. All times
below use the shared recorder clock after setup, rounded to milliseconds.

| Observation | Correct destinations | A1 destination system 2 on route A1 |
| --- | --- | --- |
| Owners | A1 → T1; A2 → T2 | A1 → T1; A2 → T2 |
| Assigned horizontal costs / m | 5.984; 7.984 | 5.985; 7.985 |
| Dispatch window starts / s | 8.892 | 8.967 |
| Exact task deadline / s | 28.892 | 28.967 |
| Actual window closure / s | 28.893 | 28.969 |
| A1 task confirmed / s | 13.291 | Not reached |
| A2 task confirmed / s | 13.783 | 13.870 |
| Minimum A1 target error in window / m | 0.01791 | 5.96990 |
| Task outcome | 2/2 completed | 1/2; partial mission |
| Both landing/disarming confirmations / s | 40.066 | 40.146 |
| Final mode and arming | Both Land, disarmed | Both Land, disarmed |

A1 remains near its takeoff location in the misaddressed case, while A2 reaches
its own task. Both receive correctly addressed LAND afterward. Fresh flight
runs have small estimator and receipt-time variations: supplied targets and
conversion rules are fixed, but the numerical NED targets need not be identical
across cases because their initial local estimates differ.

The nominal recording contains **1,478 telemetry records per vehicle**; the
misaddressed recording contains **1,482 per vehicle**. The process IDs are
**8/9**, then **12/13**, within the isolated container's namespace. Each case
includes three resource snapshots, including one during task execution. Both
processes are running at each snapshot. Individual observed resident memory
ranges from **5,736 to 5,948 KiB**. This is Linux `VmRSS` for the autopilot process
only, excluding the coordinator, container overhead and operating system. These
samples are neither peak memory nor a fleet-capacity benchmark. The cached image
occupies **240,338,809 bytes**; setup takes about **43.1–43.2 host seconds** per
case before the recorded flight timeline begins.

A fresh independent repeat retained **2/2 versus 1/2 tasks** and **2/2 landed**
in both cases. Its misaddressed A1 minimum error was **5.96892 m**; A2 completed
at **13.782 s** and both landings were confirmed by **40.065 s**. The public and
repeat captures ran concurrently in separate network-isolated containers. This
is a functional repeat, not a timing or performance benchmark.

Recorded fingerprints:

- Fleet recorder SHA-256:
  `32976f6ac425334b0ae9666eec8578ae7a2c8bf5370e49ac967b4e536ca43663`.
- Bundled JSON SHA-256:
  `bca88084d57a990d7e0fbcb7a8f223cff8ba340532674d51e4b413d1d4f4438e`.

Completed checks on 2026-09-18:

- Public capture and independent repeat pass the import validator and
  `compare:fleet`; recorder, shared helper and Dockerfile source hashes match.
- **11 Python fleet checks** cover source isolation, greedy ownership/ties,
  coordinate conversion, exact deadline, dwell and receipt-time flight evidence.
- A real **SIGINT during two-process execution** returns exit 130, preserves
  the previous output and removes the owned container. No owned fleet containers
  remain after completed capture/repeat runs.
- **345 Node tests passed**, including 14 new fleet tests for assignment,
  independent source evidence, no future leakage, cutoff/dwell boundaries,
  contradictory imports and task versus landing outcomes.
- Production build passed with **21 entries**. Vite retains the large-chunk
  advisory: the fleet page embeds its recording in a **1,367.78 kB** minified
  chunk, **321.80 kB** gzip. No network request to an external flight service is
  required for replay.
- A production-preview Chromium check passed both cases, vehicle selection,
  milestone controls, linked views, whole-yard/follow cameras, desktop and
  390 × 844 mobile layout, and HTTP access to all **21 routes**, with no console,
  page or HTTP errors. Seven screenshots were captured; the yard, mobile scene
  and close drone view were visually inspected.

The **9 shared SITL Python tests passed**. The full Chromium regression
passed **162/162 tests**, including nine fleet interactions. WebGL-unavailable
and context-loss cases intentionally exercise the 2D fallback; their expected
graphics initialization messages do not represent failed checks. The repository
audit validated **193 local public Markdown links**, all 21 navigation sets and
public-file hygiene. Work remained on `main` with an untouched empty index.

## What the comparison establishes

Changing only A1's target system ID changes its request envelope while preserving
its isolated route and assignment. The pinned ArduPilot routing implementation
explains why this destination does not select A1 for local handling. The recording
contains the outgoing setpoint and subsequent telemetry, not an instrumented
onboard packet rejection or a packet capture. No command ACK exists for this
setpoint message.

A vehicle reporting Land, a process remaining alive or both vehicles ultimately
landing cannot establish task success. Task evidence is vehicle-specific and
bounded by the mission deadline; cleanup is evaluated afterward from separate,
fresh airborne/on-ground/disarmed evidence and the relevant LAND ACK.

The two built-in SITL worlds have independent dynamics. The shared browser yard
adds no collision interaction, obstacle avoidance, shared wind field, relative
sensing or cooperative localization. No peer communication, distributed allocator,
retry or reassignment is implemented. Tasks are visits with a settling criterion,
not actual camera inspections. The observed resource samples do not establish
larger-fleet capacity or hardware readiness.
