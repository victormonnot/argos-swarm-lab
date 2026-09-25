# ROS 2 process-round results

Recorded on **2026-09-16** using the
[specified protocol](14-ros2-rounds.md). The
[reference JSON](../results/ros2-consensus.json) contains actual reports from
six independent ROS 2 agent processes and one supervisor. The web page replays
this data; it does not generate replacement ROS observations in JavaScript.

## Runtime and reproduction

- ROS 2 Jazzy on Ubuntu Noble in the official `ros:jazzy-ros-base` image.
- Pinned image index digest:
  `sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8`.
- Verified architecture: Linux x86_64; Python 3.12.3.
- `ros-jazzy-rclpy`: `7.1.12-1noble.20260902.053513`.
- `ros-jazzy-rmw-fastrtps-cpp`: `8.4.4-1noble.20260902.041916`.
- Fast DDS package `ros-jazzy-fastrtps`: `2.14.6-1noble.20260901.222814`.
- `ros-jazzy-std-msgs`: `5.3.8-1noble.20260902.022418`.
- All application topics: `std_msgs/msg/String`, reliable/volatile/keep-last,
  depth 256. Domain 42, localhost discovery, container `--network none`.
- Runtime source SHA-256:
  `36b41e87eb61c5b7f143560d2f12b486e052829149e55649df5ca58e41344116`.

ROS runs inside the pinned container; no host-wide ROS installation is required.
The inspected image reports about 881 MB uncompressed; first-use download and
disk needs differ. The pinned index also contains other architectures, but only
x86_64 was verified here.

```sh
npm run record:ros2
npm run compare:ros2 -- local/ros2-consensus.json
```

The recorder validates the complete trace, source hash and numerical comparison
before atomically replacing the requested output. Its default output is local;
the supplied public reference is a separate explicit output choice. Compare
the supplied reference with `npm run compare:ros2`.

## Observed numerical and communication results

All cases start from `[0, 2, 4, 8, 10, 12]` with gain 1/12. Reference comparison
uses the independent workshop-1 implementation at every completed boundary.
An absolute error ≤ 1e-10 per scalar is considered equivalent.

| Case | Complete rounds | First range ≤ 0.01 | Final complete-state range | Largest reference difference | Publication calls | Neighbor receipts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete graph | 20 | 11 | 0.0000114441 | 8.882e-16 | 120 | 600 |
| Chain | 350 | 314 | 0.00434857 | 5.329e-15 | 2,100 | 3,500 |
| A3 omits round-2 publication | 2 | Not reached | 3 | 8.882e-16 | 17 | 85 |

The final complete-state mean is 6 in all three recordings. Every one of the
**375 complete state vectors** (including each case's initial state) agrees
with the reference within tolerance. Floating-point differences reflect the
different summation order, not a different declared averaging rule.

Each case records six distinct agent PIDs, separate from the supervisor PID.
The reference records agent PIDs 30–35, 122–127 and 214–219, respectively,
inside the container; the supervisor PID is 7. These are recorded identities,
not a claim that those processes remain running.

Six publication calls fan out to 30 neighbor receipt callbacks per complete
graph round, or ten in the chain. Instrumentation/control/discovery traffic and
middleware packet overhead are excluded. These counters cannot be interpreted
as bandwidth or packets on a network interface.

## Failure observation

The incomplete exchange attempts transition **2 → 3**. A3 (wire ID 2) omits
its application publication. Five publications and 25 neighbor receipts are
observed. A3 receives all five required inputs and reports the local value
**5.75**; each other agent lacks A3's input and reports no new value. After the
3-second application timeout the supervisor stops with **one of six updates**.
Only states 0, 1 and 2 exist in the trace. The UI exposes the local candidate
without presenting it as a complete state 3.

This is a controlled omission, not a reliability/QoS benchmark or crash detector.
The trace shows why a full-roster barrier can preserve round consistency while
losing progress. It does not establish how a production system should recover.

## Verification

- Standard-Python protocol tests: **8/8 passed**, including current-round
  buffering before start, missing/stale inputs, duplicate suppression, envelope
  rejection, delivery-order invariance and 350 chain rounds.
- Node suite: **220/220 passed**, including **47 trace checks**. These compare
  every complete vector independently, recompute local updates from recorded
  inputs, check process identities and reject inconsistent or malformed imports.
  A structurally coherent numerical mismatch remains importable and is flagged
  by the separate reference evaluator.
- An independent actual re-recording passed the same structural, source-hash and
  numerical checks. The interruption check returned exit 130, wrote no output
  and left no owned container. Normal runs also removed their containers.
- Read-only review found the declared round barrier, trace contract and
  information boundaries consistent with the implementation.
- Final Chromium suite: **102/102 passed**, including eight new ROS 2 interface
  checks. These cover phase versus committed state, inspection, timeout, replay,
  linked views, malformed/foreign-run imports, escaped imported labels, numerical
  mismatch display, 390 px layout and unavailable/lost WebGL.
- Production build: all **14 HTML entries** passed. The build reports size
  advisories for the optional Three.js chunk and the bundled recording chunk
  (about 1,025 kB minified / 107 kB gzip). This is not a runtime failure.
- Production preview: Chromium 153.0.8010.12 verified both views, the incomplete
  barrier and A3's separate 5.75 local update, and 390 px layout with no page,
  console or HTTP errors. 2D, 3D, timeout and mobile screenshots were inspected.
  Software WebGL establishes functional rendering, not hardware performance.

Reproduce the test layers separately:

```sh
python3 -m unittest discover -s ros2 -p 'test_*.py'
npm test
npm run test:e2e
npm run build
```

## Limits

The runs use one container/computer, a small fixed population, known neighbors,
one middleware configuration and fixed starting values. No multi-machine timing,
wireless loss, security/authentication, process restart, asynchronous consensus,
vehicle motion or flight control is measured. Wall-clock round durations include
computation, instrumentation and scheduler effects; animated message positions
are solely an explanatory layout. JSON import checks internal consistency and
numerical agreement, not recording authenticity.
