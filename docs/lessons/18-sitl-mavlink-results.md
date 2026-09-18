# ArduPilot SITL and MAVLink: recorded results

Recorded on **2026-09-18** with the implementation in
[the workshop specification](18-sitl-mavlink.md). The bundled
[JSON recording](../results/ardupilot-sitl.json) contains two independent
ArduCopter SITL runs. The browser reads these actual estimates and messages;
it does not execute an autopilot or reconstruct flight dynamics.

## Runtime and reproduction

The recorder uses the official **ArduCopter 4.7.1 Linux amd64** executable and
its built-in plus-layout quadrotor model (`--model +`, speedup 1). Each case gets
a fresh simulator working directory. A separate Python controller uses
**pymavlink 2.4.49** and MAVLink 2 over loopback TCP, with controller identity
255/190 and autopilot identity 1/1. Both programs run inside an isolated Docker
container with `--network none` and no published ports.

| Runtime item | Recorded value |
| --- | --- |
| Python | 3.12.13 |
| Supporting packages | lxml 6.1.3; fastcrc 0.5.0 |
| Firmware Git revision | `dbe792162d06cab66c3475fd5556bf7a120f119e` |
| Official binary SHA-256 | `011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482` |
| Upstream parameter file SHA-256 | `5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e` |
| Recorder source SHA-256 | `18bdbf3034d408b44e7cced609703bce75d5d8036e214e1e409166919fa2d513` |
| Executed Docker image ID | `sha256:fd8d5c298e28f93e0fe0f65328799d1a942122417f8d8177dec26a024efc8a1c` |
| Base image | `python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2` |

The firmware's `AUTOPILOT_VERSION` reports version integer 67568127 (4.7.1
official) and custom version bytes identifying `dbe79216`. The recorder also
reads back `ARMING_SKIPCHK=0`, `FRAME_CLASS=1`, `FRAME_TYPE=0`,
`FS_GCS_ENABLE=0`, `FS_THR_ENABLE=1` and `SIM_WIND_SPD=0`. This version names
its arming-check skip mask `ARMING_SKIPCHK`; zero skips no checks. No forced
arming or local parameter overrides are used. A lost-GCS failsafe is outside
this experiment and is not enabled by these defaults.

The initial build downloads checksum-verified
[official firmware](https://firmware.ardupilot.org/Copter/stable-4.7.1/SITL_x86_64_linux_gnu/arducopter)
and [upstream copter defaults](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/Tools/autotest/default_params/copter.parm),
plus pinned Python dependencies. Docker reports a local image size of
240,338,809 bytes (about 229 MiB); that is an image-size observation, not peak
RAM, download traffic or a performance requirement. Setup before each recording
took about 42.26 s, followed by 25.81 s of nominal telemetry or 5.81 s for the
rejected case. The two-case JSON file is 288,717 bytes. No CPU/RAM benchmark or
support for other host architectures is claimed.

```sh
npm run record:sitl
npm run compare:sitl -- local/ardupilot-sitl.json
```

Import that local file from `/sitl/`. Compare the bundled recording with
`npm run compare:sitl`. The recorder validates before atomically replacing its
output. Errors, unexpected outcomes and execution timeouts fail without replacing
the previous file; partial failed runs are not exported. The command has bounded
build/run waits and cleans up its own container on interruption.

## Measured outcomes

Times below are receiver monotonic seconds since each run's own post-setup
origin. They are not vehicle boot times or measured network latency.

| Evidence | Normal flight | Takeoff while disarmed |
| --- | --- | --- |
| Takeoff requested | 1.781 s | 0.788 s |
| Takeoff ACK | ACCEPTED (0), 1.786 s | FAILED (4), 0.794 s |
| Height and settling criterion observed | 8.703 s | Never observed |
| Position-only target sent | 8.703 s | Not sent |
| Waypoint criterion observed | 13.904 s | Never observed |
| LAND ACK | ACCEPTED (0), 13.909 s | Not requested |
| Fresh on-ground and disarmed completion | 24.786 s | No flight; ground observation completes at 5.807 s |
| Maximum reported altitude above home | 4.067 m | −0.006 m |
| Recorded telemetry messages | 932 | 211 |

For the nominal flight, **6.917 s** elapse between takeoff acceptance and the
height/settling criterion. The height gate requires the reported above-home
altitude to be within 0.35 m of four meters, speed at most 0.4 m/s, and one second
of good fresh observations. The local target adds `[8, 5, -4]` meters to the
initial NED position; its gate uses a 0.5 m 3D distance tolerance and the same
speed/dwell limits. `SET_POSITION_TARGET_LOCAL_NED` has no command ACK.

LAND acceptance precedes measured landing by about 10.877 s. Completion requires
fresh reports of both ON_GROUND and disarmed after the LAND request, following
an earlier in-air report. The final local NED estimate is approximately
`[8.061, 5.017, 0.015]` m. These values are autopilot estimates, not independent
accuracy measurements against simulator truth.

The rejected run stays disarmed, has no airborne report and ends with fresh
ON_GROUND evidence after more than five seconds of observation. Its small
negative reported altitude is retained instead of clamped into a fabricated
zero. The pinned [takeoff precondition](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/takeoff.cpp#L18)
and [MAVLink handler](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/GCS_MAVLink_Copter.cpp#L611)
explain this build's FAILED response when motors are unarmed. It is not a
universal assertion that every rejected command uses result code four.

A second collection with the same final source and image also completed both
cases. It observed takeoff acceptance at 1.788 s, height settling at 8.806 s,
waypoint settling at 14.007 s and landing/disarming at 24.786 s; the disarmed
request again returned FAILED. The two collection containers overlapped in wall
time while retaining isolated processes and networks. This is a functional
repeat, not a controlled timing benchmark or a statistical reliability estimate.

## Verification and limits

- The official binary ran and produced both bundled cases. Independent JavaScript
  completion checks agree with the recorder's telemetry-derived event times.
  The second final-source collection also validates; source and image hashes match.
- `npm test`: **300/300 passed**, including 21 SITL trace tests for held samples,
  NED conversion, command/ACK association, completion dwell and freshness,
  landing evidence, disarmed rejection and inconsistent imported claims.
- `python3 -m unittest discover -s ros2 -p 'test_*.py'`: **31/31 passed**.
- `python3 -m unittest discover -s sitl -p 'test_*.py'`: **9/9 passed**, covering
  ACK identity, fresh post-request altitude, 3D position/speed, sampled dwell
  and post-command landing evidence.
- `npm run test:e2e`: **135/135 Chromium checks passed**, including nine SITL
  checks for replay, request inspection without future evidence, target errors,
  ACK versus completion, linked views, context loss, imports and narrow layouts.
- An actual wrapper SIGINT check exited 130, produced no output recording and
  removed its owned container. Both completed capture containers were cleaned up.
- `npm run build`: passed with eighteen HTML entries. Vite retains its bundle-size
  advisory for existing large assets; the SITL page adds no browser dependency.
- The final production preview passed a separate Chromium 153 smoke check:
  eighteen routes, exact request inspection, flight/rejection outcomes, both
  views, camera controls and a 390 px layout without horizontal overflow. No
  page, console or HTTP errors were observed. Scene screenshots were inspected.

The supplied successful flight demonstrates these configured thresholds in one
wind-free built-in SITL model. It does not establish real-aircraft readiness,
obstacle avoidance, estimator accuracy, radio behavior, hardware timing or
general mission success. The illustrated browser yard is not external simulator
geometry. A future Gazebo workshop must define and verify that additional boundary.
