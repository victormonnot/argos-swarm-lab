# GCS heartbeat failsafe: recorded results

Recorded on **2026-09-18** using the
[workshop specification](20-gcs-failsafe.md). The bundled
[JSON recording](../results/ardupilot-failsafe.json) contains two fresh, actual
ArduCopter SITL flights. Both complete takeoff, the observation interval, landing
and disarming. One selectively interrupts outgoing GCS heartbeats; incoming
telemetry and the receiving process continue.

## Verified runtime and configuration

The recorder reuses the unchanged workshop-18 image and MAVLink flight helpers:
**ArduCopter 4.7.1**, **pymavlink 2.4.49**, **Python 3.12.13**, **lxml 6.1.3** and
**fastcrc 0.5.0**, on Linux amd64. Its built-in quadrotor model uses `--model +`
and speedup one. No Gazebo process or independent world-truth channel is used.
The browser displays recorded autopilot estimates.

| Provenance item | Executed value |
| --- | --- |
| Recorded at | `2026-09-18T09:51:10.174062+00:00` |
| Image | `sha256:fd8d5c298e28f93e0fe0f65328799d1a942122417f8d8177dec26a024efc8a1c` |
| Base image | `python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2` |
| Firmware revision | `dbe792162d06cab66c3475fd5556bf7a120f119e` |
| Firmware binary SHA-256 | `011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482` |
| Failsafe recorder SHA-256 | `b3b064506c711b743ab77209e07e59d27996b34b2c8ec9f0deb996e7b8751a9e` |
| Shared SITL helper SHA-256 | `18bdbf3034d408b44e7cced609703bce75d5d8036e214e1e409166919fa2d513` |
| Shared Dockerfile SHA-256 | `b8517a301d2066d6757edb2e18785ddab5e86ff7540e8061005ef44156bfe6d5` |
| Upstream defaults SHA-256 | `5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e` |

Readback in both cases confirms `FS_GCS_ENABLE=5`, `FS_GCS_TIMEOUT=3`,
`FS_OPTIONS=0`, `MAV_GCS_SYSID=255`, `MAV_GCS_SYSID_HI=0`,
`ARMING_SKIPCHK=0`, `FRAME_CLASS=1`, `FRAME_TYPE=0`, `FS_THR_ENABLE=1`
and `SIM_WIND_SPD=0`. The GCS uses system/component **255/190**, while the vehicle
reports **1/1**. Normal arm requests do not force arming. No manual-control or
RC-override stream refreshes the GCS timer during the interruption.

The recorded setup took about **42.2 seconds** per case and emitted **41 GCS
heartbeats** before each replay origin. Setup is separate from recorded flight
time. The local image occupies **240,338,809 bytes** (about 229 MiB), reused from
workshop 18; the bundled JSON is **589,597 bytes**. These observations do not
measure peak memory, CPU utilization or download volume. Playback needs only
the web application, not the optional simulator image.

## What happened

Both vehicles receive Guided, normal arm and a four-meter takeoff request.
After telemetry satisfies the settling criterion, both stop receiving flight
commands for a target fourteen host-clock seconds. Only the interrupted case
also suppresses GCS heartbeat sends.

| Observation | Continuous heartbeat | Interrupted heartbeat |
| --- | --- | --- |
| Takeoff settled / replay time | 8.793 s | 8.695 s |
| Actual observation duration | 14.050 s | 14.002 s |
| Heartbeat suppression duration | None | 8.003 s |
| GCS failsafe status observed | None | `GCS Failsafe` |
| LAND requested by harness | Yes, after observation | No |
| Mode after heartbeat restoration | Not applicable | LAND |
| Final landing/disarming evidence | 33.374 s | 28.373 s |
| Flight recording duration | 34.377 s | 29.377 s |
| Recorded GCS sends / vehicle telemetry | 34 / 1,238 | 21 / 1,058 |
| Vehicle telemetry received during suppression | Not applicable | 289 messages |

The nominal run stays armed in Guided during the command-free observation
interval and reports no GCS failsafe. Its explicit LAND request occurs at
**22.843 s**. The interrupted run sends only Guided, arm and takeoff: its LAND
mode and subsequent landing have **no transmitted LAND command or LAND ACK**.

For the interrupted run, these timestamps share the recorder-relative monotonic
clock. They are send times or receipt times according to the event:

| Event | Replay time |
| --- | --- |
| Observation starts | 8.695 s |
| Last GCS heartbeat sent before suppression | 9.857 s |
| Harness suppresses GCS sends | 10.743 s |
| Vehicle LAND heartbeat received | 13.105679 s |
| GCS failsafe status received | 13.105816 s |
| First post-LAND position sample with down velocity above 0.2 m/s | 17.493 s |
| Harness re-enables GCS sends | 18.745977 s |
| First resumed heartbeat sent | 18.746098 s |
| GCS failsafe-cleared status received | 18.759484 s |
| Observation window ends | 22.698 s |
| Fresh on-ground and disarmed reports establish landing | 28.373 s |

The two observation durations slightly exceed fourteen seconds because the
harness ends on its next update. Their time basis is host time; speedup one does
not establish that every host interval is exactly the same simulation interval.

## Interpret the separate pieces of evidence

The GCS-specific onset is received **3.249 host seconds after the last recorded
send**, not three seconds after the harness starts suppressing future sends.
That interval combines sender timing, onboard processing and status delivery;
it is **not a direct measurement of the autopilot's internal last-reception
timer**. The pinned checker uses a strict greater-than comparison and runs
nominally at 3 Hz. The browser shows the actual status receipt instead of
creating a failsafe event from the displayed send-age threshold.

The LAND heartbeat arrives about **0.137 ms before** the GCS-specific status
text. These are independent received messages. Their raw order is retained;
the replay does not move the LAND observation after the text to create an
artificial causal timeline.

The first post-LAND local-position sample reporting downward speed above
**0.2 m/s** arrives **4.387 s after the first LAND heartbeat**. The pinned
failsafe path includes a four-second landing pause. This threshold crossing
illustrates the observed response, including sampling and vehicle dynamics;
it is not a direct instrumented measurement of the pause's internal start/end.
For the explicitly commanded nominal landing, the same threshold crossing is
about **0.449 s** after LAND mode is reported.

The GCS-cleared status follows resumed transmission, while subsequent vehicle
heartbeats remain in LAND. Clearing the communication condition therefore does
not resume the interrupted flight. Landing completion is established separately
using prior airborne evidence and fresh on-ground/disarmed reports; neither a
cleared status nor LAND mode alone counts as completion.

A second collection from the same final sources and image completed both cases.
Its GCS onset was received **3.217 host seconds after the last send**, and its
interrupted vehicle was reported landed/disarmed at **28.386 s**. Again **289
telemetry messages** arrived during suppression; heartbeat restoration left the
mode in LAND. The two recording containers overlapped in wall time but had
isolated processes and networks. This is a functional repeat, not a timing
benchmark, deterministic-timing claim or statistical reliability study.

## Reproduction and completed checks

```sh
npm run record:failsafe
npm run compare:failsafe -- local/ardupilot-failsafe.json
```

The wrapper builds/reuses the pinned SITL image, runs with `--network none` and
read-only source mounts, then checks the recording and source fingerprints
before replacing the output atomically. It accepts no external vehicle address
and publishes no control port. Unexpected execution fails without exporting a
partial successful-looking trace or replacing a previous recording.

Checks actually completed:

- Both final-source collections pass independent JavaScript validation and
  comparison, with all three recorder/helper/Dockerfile fingerprints matching.
- `npm test`: **331/331 passed**, including fifteen new checks of sender versus
  receiver evidence, raw mode/status ordering, independent sample holding,
  landing freshness, restoration and inconsistent imports.
- Existing Python checks: **31 ROS + 9 SITL passed**. The new recorder's
  **10/10 Python checks passed**, including heartbeat suppression/restoration,
  exact payloads, process-exit handling and raw LAND-before-status ordering.
- An actual SIGINT during active SITL exited **130**, preserved a pre-existing
  destination byte-for-byte and removed the owned container. Completed capture
  containers were also removed.
- The nine focused Chromium interface tests passed: recorded event stepping,
  sender-age versus received status, restoration, continuous baseline, raw
  inspectors, both views/cameras, WebGL fallback, playback, imports and mobile
  layout at 390 px.
- The complete Chromium suite passed **153/153 tests** in 2.5 minutes, including
  the nine failsafe scenarios and regression coverage of the previous workshops.
- `npm run build` passed with twenty HTML entries. The embedded recording yields
  a roughly 573 kB minified / 139 kB gzip page chunk. Vite emits a bundle-size
  advisory; this workshop adds no browser dependency.
- A separate production-preview smoke passed twenty routes, both views/cameras,
  phase shortcuts and desktop/mobile layouts in Chromium 153.0.8010.12. No page,
  console or HTTP errors were observed. Final scene screenshots were inspected.

The result demonstrates one configured onboard response in this simulated
vehicle. It does not establish real radio reliability, behavior under a severed
bidirectional connection, operation with multiple GCS sources, safe hardware
deployment or automatic mission resumption. The scene's station, antennas,
arrows and yard are illustrative context for the recorded message directions.
