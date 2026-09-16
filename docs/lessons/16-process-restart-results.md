# Process failure and restart results

Recorded on **2026-09-16** using the [heartbeat/restart protocol](16-process-restart.md).
The [reference JSON](../results/ros2-restart.json) records real ROS 2 publications,
observer callbacks and status transitions, plus the harness's process events.
The browser replays those observations instead of synthesizing a replacement
middleware run.

## Runtime and reproduction

- ROS 2 Jazzy, Python 3.12.3, Linux x86_64; official ROS Base image.
- Pinned registry image index:
  `ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8`.
- `ros-jazzy-rclpy`: `7.1.12-1noble.20260902.053513`.
- `ros-jazzy-rmw-fastrtps-cpp`: `8.4.4-1noble.20260902.041916`.
- Fast DDS `ros-jazzy-fastrtps`: `2.14.6-1noble.20260901.222814`.
- `ros-jazzy-std-msgs`: `5.3.8-1noble.20260902.022418`.
- Domain 44, localhost discovery, container `--network none`.
- `std_msgs/msg/String` JSON on a unique `/argos_restart_<runId>` prefix:
  `heartbeat`, `control`, `reports`.
- Reliable/volatile/KEEP_LAST on all endpoints; heartbeat depth 20 and
  setup/report depth 256. This is not a comparison of middleware policies.
- Source SHA-256:
  `ae8993a402d6b1dc3d840a1b9c6a72773596f4a53ed44aaa6696f4584bb36fff`.
- Recording timestamp: `2026-09-16T15:25:38.036084+00:00`.

The cached image from workshops 14–15 was reused; no new dependency or host-wide
ROS installation was needed. Each independent case gets a fresh ROS context.
One observer and one source run as distinct processes, alongside the collector;
a replacement source has its own new PID. Only the harness-owned source is
killed. All owned workers and the container are removed after recording.

```sh
npm run record:restart
npm run compare:restart -- local/ros2-restart.json
```

Import the local JSON on the page. Without a path, `npm run compare:restart`
checks the supplied reference, compares the runtime source fingerprint and
recomputes acceptance/recovery summaries. The recorder validates before
atomically replacing its output.

## Observed comparison

The nominal source generates every 100 ms through an 8 s observation window.
A 20 ms target watchdog checks for at least 400 ms since the last **accepted**
heartbeat receipt. The two admission rules share every callback and its actual
receipt timestamp. There is no startup timeout before first evidence.

| Case | Publications / callbacks | Policy | Accepted | Ignored | First suspicion / s | First accepted after return / s |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Continuous | 80 / 80 | Sequence only | 80 | 0 | None | Not applicable |
| Continuous | 80 / 80 | Epoch + sequence | 80 | 0 | None | Not applicable |
| Publication silence | 65 / 65 | Sequence only | 65 | 0 | 1.820400 | 3.000943 |
| Publication silence | 65 / 65 | Epoch + sequence | 65 | 0 | 1.820400 | 3.000943 |
| SIGKILL and restart | 48 / 48 | Sequence only | 32 | 16 | 1.920427 | 6.400724 |
| SIGKILL and restart | 48 / 48 | Epoch + sequence | 48 | 0 | 1.920427 | 4.800651 |

For publication silence, PID 68 remains alive and epoch 1 persists. Actual
silence lasts 1.500103–3.000438 s; the sequence resumes at 15. Both policies
suspect A1, then accept the first returning callback. The watchdog evidence
alone would not distinguish this living-but-silent process from a crash.

For the actual restart, the source retains logical identity A1 and ROS node name
`heartbeat_agent`, but changes from PID 105/epoch 1 to PID 132/epoch 2:

| Observed event | Time / s |
| --- | ---: |
| SIGKILL requested for owned PID 105 | 1.500734 |
| Process exit confirmed, return code −9 | 1.506402 |
| Both observer policies become suspicious | 1.920427 |
| Replacement PID 132 spawned | 3.000994 |
| New source reports endpoint readiness | 3.740422 |
| First new publication, epoch 2 / sequence 0 | 4.800135 |
| First new callback, accepted by epoch-aware rule | 4.800651 |
| Sequence-only first accepts epoch 2 / sequence 16 | 6.400724 |

The old source published through sequence 15 just before termination. Consequently,
new sequences 0–15 fail its observer's old high-water mark. The sequence-only
policy keeps epoch 1's position and remains suspicious despite receiving those
16 new callbacks. It eventually accepts sequence 16. The epoch-aware rule accepts
sequence 0 immediately because the received epoch advances to 2.

The additional delay from **first return callback to first acceptance** is
**1,600.073 ms** for sequence-only and **0 ms** for epoch + sequence. Zero here
means the same callback is accepted; it does not mean zero transport latency.
From actual spawn, first acceptance takes 3,399.730 ms and 1,799.657 ms,
respectively. Those values include process startup, discovery, an intentional
1,000 ms readiness-to-start guard, scheduling and callback overhead. They are
not isolated DDS latency measurements.

At the end, both policies have accepted epoch 2 / sequence 31 and report recent
accepted evidence. This establishes heartbeat admission recovery in this case,
not restored mission progress, controller state or vehicle safety. Actual
positions are prescribed synthetic samples, with no physical crash model.

Recorded observer/source PIDs are 30/31 for continuous publication, 67/68 for
silence, and 104/105 then 132 for restart. Collector PID 7 is separate. Process
IDs are historical identities inside the container; the page does not leave
those processes running.

## Setup behavior and verification

Initial experiments exposed variable discovery and control-start acknowledgement
delays. The final recorder uses periodic readiness announcements, repeated
idempotent start messages until acknowledgement, a future start guard and a
fresh ROS context for each case. Setup deadlines fail explicitly rather than
exporting an incomplete run as successful. The 8 s window leaves room to observe
admission after the measured startup. These choices affect the measured times.

- Full Python protocol suite: **25/25 passed**, including **9/9** heartbeat
  tests covering
  no initial timeout, receipt-time boundary checks, rejection without timer
  refresh, lost sequence counters, new epochs and rejection of older epochs.
- Full Node suite: **260/260 passed**, including **20/20** restart replay/import
  checks against actual recordings,
  covering shared callback inputs, process identities, false suspicion,
  new-incarnation admission, exact sample holding and historical filtering.
  Import regressions cover timing/sequence slots, truncated recordings,
  forged acceptance, early suspicion and callback provenance.

- Full Chromium interaction suite: **118/118 passed**, including **8/8** restart
  checks for shared cursor/views, callback inspection, delayed baseline recovery,
  silence, playback, imports, mobile layout and unavailable WebGL.
- The production build generated all **16 HTML entries**. Existing large Three.js
  and ROS rounds chunks retain size advisories; the new restart chunk is about
  133 kB minified / 28 kB gzip.
- Production Chromium 153 smoke checks covered 2D/3D, yard/follow cameras, policy
  admission differences, baseline recovery, same-process silence and a 390 px
  screen. No page, console or HTTP errors were observed; screenshots were inspected.
- A second actual capture, with the same source fingerprint, reproduced the
  counter-reset rejection: 51 restart callbacks, 16 baseline rejections. Its
  first return callback was at 4.500891 s and baseline acceptance at 6.100654 s.
  Startup timing differs; two runs do not establish a statistical benchmark.
- Recorder interruption: SIGINT returned 130, produced no incomplete output and
  removed the owned container.

Test/build commands:

```sh
python3 -m unittest discover -s ros2 -p 'test_*.py'
npm test
npm run test:e2e
npm run build
```

## Limits

One controlled host/kernel, one logical source, one persistent observer, one
surviving epoch authority and one middleware stack were exercised. No distributed
failure-detector guarantee, durable epoch allocation, sender authentication,
mission checkpoint/rejoin, radio fault, physical vehicle or autopilot behavior
is established. Old-epoch rejection is unit-tested, not exercised through an
injected delayed old packet in the recordings. Imported metadata and structural
validation do not authenticate an external file's origin.
