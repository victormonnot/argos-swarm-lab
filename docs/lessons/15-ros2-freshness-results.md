# ROS 2 message freshness results

Recorded on **2026-09-16** using the [freshness protocol](15-ros2-freshness.md).
The [reference JSON](../results/ros2-qos.json) contains actual ROS 2 publications
and callbacks from one publisher, three readers and a collector. Browser
playback reads these observations; it does not simulate replacement deliveries.

## Runtime and reproduction

- ROS 2 Jazzy, Python 3.12.3, Linux x86_64, official ROS Base container.
- Pinned registry image index:
  `ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8`.
- `ros-jazzy-rclpy`: `7.1.12-1noble.20260902.053513`.
- `ros-jazzy-rmw-fastrtps-cpp`: `8.4.4-1noble.20260902.041916`.
- Fast DDS `ros-jazzy-fastrtps`: `2.14.6-1noble.20260901.222814`.
- `ros-jazzy-std-msgs`: `5.3.8-1noble.20260902.022418`.
- Domain 43, localhost discovery, container `--network none`.
- Topics under a unique `/argos_qos_<runId>` prefix: `telemetry`, `control`,
  `reports`; JSON envelopes in `std_msgs/msg/String`.
- All endpoints reliable/volatile/KEEP_LAST; telemetry publisher depth 20,
  reader depths 20/1/20, setup and report endpoints depth 256.
- Source SHA-256:
  `ba7024d2261bf7fd056abdacfe28307532a3824300ddb29b559121f74ac5a250`.
- Recording timestamp: `2026-09-16T14:01:00.001420+00:00`.

The recorder uses the same pinned image as workshop 14. Docker is needed only to
produce a new actual trace; the supplied web replay runs with the usual setup.

```sh
npm run record:qos
npm run compare:qos -- local/ros2-qos.json
```

Import the generated JSON on the page. `npm run compare:qos` without a path
checks the supplied reference and recomputes ages and counts. The recorder
validates the result and source fingerprint before atomically replacing its
output. The normal and paused recordings each contain 80 publications.

## Observations

The source publishes every 50 ms for 4 s. Readers service at most one telemetry
callback per 50 ms slot with a planned 25 ms phase offset, then continue through
a 1.2 s drain interval. Recorded times include actual scheduling jitter.
A reader slot permits bounded nonblocking executor housekeeping calls until
one telemetry callback executes; a single `spin_once()` call need not execute
a callback. Missed servicing slots are not replayed as a burst.

| Case | Reader | Callbacks | Accepted | Rejected | Sequences not observed | Maximum callback age / ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Normal | History 20 | 80 | 80 | 0 | 0 | 25.506 |
| Normal | Latest 1 | 80 | 80 | 0 | 0 | 25.562 |
| Normal | Age gate 20 | 80 | 80 | 0 | 0 | 25.737 |
| Paused | History 20 | 79 | 79 | 0 | 1 | 975.864 |
| Paused | Latest 1 | 60 | 60 | 0 | 20 | 25.859 |
| Paused | Age gate 20 | 79 | 16 | 63 | 1 | 975.757 |

“Sequences not observed” counts publications without a corresponding callback
in this finite recording. It is neither a packet-loss count nor a measurement
of DDS queue occupancy. Callback age includes executor/history waiting and
software overhead; it is not isolated wire latency.

The paused case schedules executor suspension at 800–1,800 ms while middleware
threads and source publications continue. The first resumed callbacks show:

| Reader | Sequence | Generated / ms | Callback / ms | Age / ms | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| History 20 | 17 | 850.092 | 1,825.411 | 975.319 | Accepted |
| Latest 1 | 36 | 1,800.088 | 1,825.947 | 25.859 | Accepted |
| Age gate 20 | 17 | 850.092 | 1,825.411 | 975.319 | Rejected |

At this point, depth 1 exposes a recent sample at the cost of intermediate
callbacks. The deeper readers service samples at the same nominal rate as the
source, so their retained history does not quickly catch up. The gate rejects
all 63 post-pause callbacks; rejecting one message does not flush the history
or update the previously accepted state.

At the end (about 5.2 s), history/latest readers retain sequence 79, whose age
has grown to about **1,250 ms** since the last publication. The paused gated
reader still retains pre-pause sequence 15, age **4,450 ms**. All three retained
states are then beyond the common 150 ms display threshold. The synthetic
reference continues moving after publication ends; this is a declared finite
observation window, not an injected publisher crash.

The normal recording identifies publisher/reader PIDs 30/31/32/33, and the
paused recording 94/95/96/97. Collector PID 7 is separate from all workers.
These are container identities in a saved trace, not currently running programs.
An independent second recording reproduced the same callback/acceptance counts
and qualitative depth effect. Two recordings are not a statistical benchmark.

## Verification

- Standard-Python tests: **16/16 passed**, including eight new freshness tests
  and eight existing consensus tests. Freshness tests cover stamped sample
  validation, age-gate boundaries, retained state, stale/duplicate envelopes
  and the source law.
- Full Node suite: **240/240 passed**, including **20 freshness trace tests**
  checking actual record references,
  process identities, source positions, pause boundaries, ages and decisions,
  no future callbacks in a frame, exact sample holding, stale state and imports.
  Import regressions include truncated completed recordings and invalid schedule
  slots. Recorded samples stay exact; independently calculated evaluator positions
  use a numerical tolerance across JavaScript engines.
- Both actual captures passed structural and source-hash checks. SIGINT cleanup
  returned exit 130, published no output and removed the owned container. Normal
  recording containers were also removed.
- Runtime and specification review found the declared information boundaries,
  executor pause and application acceptance contract consistent.

- Chromium browser suite: **110/110 passed**, including eight new freshness
  checks for replay, callback inspection, retained state, imports, linked views,
  context loss and 390 px layout. The full campaign used frozen page sources.
- Final production preview: Chromium 153.0.8010.12 checked both views, camera
  framing, the fresh latest-reader versus stale gated-reader comparison, and
  mobile layout with no page, console or HTTP errors. Screenshots were inspected.
  Software WebGL verifies functional rendering, not hardware performance.
- Production build: all **15 HTML entries** passed. The freshness entry is
  approximately 156 kB minified / 28 kB gzip including its recording. Existing
  Three.js and workshop-14 recording chunks retain their size advisories.

Test and build commands:

```sh
python3 -m unittest discover -s ros2 -p 'test_*.py'
npm test
npm run test:e2e
npm run build
```

## Limits

One host, one source, three readers, fixed timing, exact synthetic positions and
one DDS implementation were observed. Reliability remains fixed. There is no
wireless loss injection, multi-machine synchronization, restart/rejoin protocol,
physical sensor, autopilot or flight dynamics. A richer 3D display does not add
such capabilities. Timestamp checks validate internal consistency, not the
external recording producer's authenticity. These results do not establish
universal middleware settings or a flight-safe freshness threshold.
