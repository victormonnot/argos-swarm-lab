# Fast DDS / Zenoh late-join results

Recorded on **2026-09-17** with the [fixed late-subscription workload](17-middleware-durability.md).
The [reference JSON](../results/ros2-middleware.json) contains actual publications,
subscription-creation events and application callbacks. The web page replays those
observations; it does not emulate a replacement DDS or Zenoh implementation.

## Runtime and reproduction

Both implementations ran the same application in one shared Docker image on
Linux x86_64, Ubuntu Noble, ROS 2 Jazzy and Python 3.12.3. The recorded image adds
two pinned Zenoh packages to the earlier ROS Base image; the installation made
no host-wide ROS changes and upgraded no existing image packages.

| Component | Recorded version |
| --- | --- |
| `ros-jazzy-rclpy` | `7.1.12-1noble.20260902.053513` |
| `ros-jazzy-rmw-fastrtps-cpp` | `8.4.4-1noble.20260902.041916` |
| `ros-jazzy-fastrtps` | `2.14.6-1noble.20260901.222814` |
| `ros-jazzy-rmw-zenoh-cpp` | `0.2.10-1noble.20260902.013525` |
| `ros-jazzy-zenoh-cpp-vendor` | `0.2.10-1noble.20260722.215006` |
| `ros-jazzy-std-msgs` | `5.3.8-1noble.20260902.022418` |

- Base registry index: `ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8`.
- Actual derived image ID: `sha256:fe411347e7340832ee5c38c8117948a00ab1214864b2a486349aac705ba3d8f5`.
- Runtime source SHA-256: `c275be1b94fe1649258e08f7368a54e9fbc056329f0507476a3a32e383e31fc9`.
- Default Zenoh session configuration SHA-256: `33cece505c521dfaf4c882f406e76ec0f7b14efe65b948ac9cdd984c8e6f1483`.
- Default Zenoh router configuration SHA-256: `68d6b941f1cd19e48e830b6516d993cebf43cd4147cf5c800f81ee3ff0c94b76`.
- Recording timestamp: `2026-09-17T13:35:09.667261+00:00`.
- Domain 45, unique topic prefixes, loopback discovery, container `--network none`.
- ROS data type `std_msgs/msg/String` containing the JSON envelope. Setup and
  evidence use local pipes, not additional ROS traffic on the measured topic.

The Dockerfile pins the tested package builds. Initial construction requires
network access to the package repositories. Their continued availability and
other host architectures were not verified. Rebuilds record their own image
content ID rather than assuming byte-identical image output.

```sh
npm run record:middleware
npm run compare:middleware -- local/ros2-middleware.json
```

Import the resulting local JSON on the page. Without a path, the comparison
command checks the bundled recording and current runtime source fingerprint.
The recorder validates its collection before atomically replacing the output;
owned worker/router processes and the container are cleaned up afterwards.

## Observed historical and live delivery

Every source called publish twenty times: sequences 0–9 in the first second,
then sequences 10–19 from 4 to 4.9 s. The reader process existed from setup but
created its subscription around 2 s. No samples were published during that
creation interval. Both endpoints requested RELIABLE, KEEP_LAST depth five,
and the same selected durability.

| Implementation | Durability | Callback count | Historical sequences | Later live sequences | Unobserved sequences |
| --- | --- | ---: | --- | --- | --- |
| Fast DDS | VOLATILE | 10 | None | 10–19 | 0–9 |
| Fast DDS | TRANSIENT_LOCAL | 15 | 5–9 | 10–19 | 0–4 |
| Zenoh | VOLATILE | 10 | None | 10–19 | 0–9 |
| Zenoh | TRANSIENT_LOCAL | 15 | 5–9 | 10–19 | 0–4 |

There were no duplicate callbacks in these four recordings. Every callback
references a recorded publication and its exact XYZ. Both implementations
exhibited the expected bounded history and delivered the entire later batch.
The result does not mean the RMWs implement every QoS policy identically.

The volatile cases show that reliable delivery does not recover a publication
history for an absent subscription. The transient-local cases recover five
samples while the publisher stays alive; the oldest five exceed the retention
bound. These are **unobserved publications**, not packet-loss measurements.

| Case | Subscription creation complete / s | First callback / s | First historical callback / s | First live callback / s |
| --- | ---: | ---: | ---: | ---: |
| Fast DDS / VOLATILE | 2.002078 | 4.001079 | None | 4.001079 |
| Fast DDS / TRANSIENT_LOCAL | 2.002501 | 2.013323 | 2.013323 | 4.000918 |
| Zenoh / VOLATILE | 2.002020 | 4.001144 | None | 4.001144 |
| Zenoh / TRANSIENT_LOCAL | 2.001990 | 2.002395 | 2.002395 | 4.001057 |

Creation-complete to first callback is approximately 1,999.001 ms and 1,999.124 ms
for volatile Fast DDS and Zenoh. Those waits predominantly reflect the deliberate
absence of any new publication until 4 s. The transient-local values are
10.822 ms and 0.405 ms in this recording, respectively; they include discovery,
history delivery and scheduling. They are not isolated wire latencies or a
general performance ranking.

The oldest historical callback ages are 1,513.121 ms for Fast DDS and
1,502.279 ms for Zenoh: old generation times are the intended historical data.
After the final publication, both readers keep sequence 19 while its retained
age increases to about 1.1 s by the observation end. A successful callback does
not guarantee current data forever.

## Process and configuration evidence

| Case | Publisher PID | Reader PID | Zenoh router PID |
| --- | ---: | ---: | ---: |
| Fast DDS / VOLATILE | 16 | 17 | Not used |
| Fast DDS / TRANSIENT_LOCAL | 46 | 47 | Not used |
| Zenoh / VOLATILE | 78 | 79 | 74 |
| Zenoh / TRANSIENT_LOCAL | 116 | 117 | 112 |

These are historical process IDs inside the recording container. The reader
process is not restarted when its subscription joins. The publisher endpoint
stays alive through the observation and until the harness finishes collection.

Each worker reports its actually loaded RMW identifier. Requested QoS is stored
separately from endpoint graph metadata. Both graph reports expose the requested
reliability/durability. Fast DDS reports `history: unknown, depth: 0`, whereas
Zenoh reports `history: keep_last, depth: 5`. The former is missing introspection
information; it is not evidence of an empty cache. The recorded sequence sets
establish the retention behavior observed in this experiment.

Zenoh uses its unchanged packaged peer-session configuration and an owned router
for discovery. Its configured local peer data connections are distinct from the
router's discovery role. No packet trace was taken, so the page's topology
illustration does not claim to reconstruct each sample's actual route.

## Verification

- Full Python protocol suite: **31/31 passed**, including six new tests for
  schedule boundaries, timestamps and envelope identity/type rejection.
- Full Node suite: **279/279 passed**, including nineteen new checks against
  actual recordings for shared replay, held samples, subscription boundaries,
  historical/live classification, missing/duplicate/reordered observations,
  metadata and import validation.
- Two actual collections pass independent replay validation and match the
  runtime source fingerprint. The repeat has the same historical/live sets
  and 10/15/10/15 callbacks; timings remain observations rather than a benchmark.
- Recorder SIGINT interruption returned 130, produced no incomplete output and
  removed its owned container.
- Full Chromium interaction suite: **126/126 passed**, including all eight new
  late-join checks for shared cursors/views, controls, historical evidence,
  callback inspection, import preservation, plain-text metadata, mobile and
  unavailable WebGL.
- Production Chromium 153 checks passed for 2D/3D, yard/follow cameras, both RMWs'
  historical receipts, volatile absence of retained state, the later live batch
  and 390 px layout. No page, console or HTTP errors were observed; screenshots
  were inspected.
- The final production build generated all **17 HTML entries**. The middleware
  chunk is about 66 kB minified / 20 kB gzip. Existing large Three.js and ROS rounds
  chunks retain their earlier size advisories.

```sh
python3 -m unittest discover -s ros2 -p 'test_*.py'
npm test
npm run test:e2e
npm run build
```

## Limits

The workload is small and local, with one publisher and one late subscriber,
fixed history depth, no competing traffic and one platform. It does not establish
throughput, radio resilience, cross-host latency, router failover, publisher-crash
persistence or a preferred middleware for a deployment. Import validation checks
internal consistency rather than producer authenticity. Flight dynamics and
mission outcomes are outside the recording.
