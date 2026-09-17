# Lesson 17 — Fast DDS, Zenoh and late-joining readers

**Question:** can a late reader recover earlier publications, and does that
bounded contract survive changing the ROS middleware implementation?

The same Python application publishes synthetic XYZ samples through two actual
ROS 2 implementations: **Fast DDS** through `rmw_fastrtps_cpp`, and **Zenoh**
through `rmw_zenoh_cpp`. For each, compare matching **VOLATILE** and
**TRANSIENT_LOCAL** endpoints. Reliability remains RELIABLE and history remains
KEEP_LAST with depth five. A deliberate quiet interval separates historical
delivery from the next live batch.

This workshop compares a software interface and a delivery contract. DDS means
Data Distribution Service; Fast DDS is a particular implementation. ROS Middleware
(RMW) is the interface selected below the ROS client library. Zenoh is another
communication system with its own ROS RMW implementation. These are not task
allocation algorithms or decision architectures.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Communication pattern | ROS 2 publish–subscribe | One source publishes a named, typed topic; one late subscription executes callbacks. |
| RMW comparison | `rmw_fastrtps_cpp` / `rmw_zenoh_cpp` | The application source and timed workload stay the same across separate recordings. |
| Reliability | RELIABLE at both endpoints | This does not request complete replay for a subscription that did not exist. |
| Durability | VOLATILE / TRANSIENT_LOCAL | Compare future traffic with bounded publisher-retained history for a late joiner. |
| History | KEEP_LAST, depth 5 at both endpoints | Publisher retention has a finite bound; it is not a complete event log. |
| Decision architecture | One publisher and one reader | No mission planner, distributed consensus or allocation is added. |
| Execution | Distinct actual processes, same container | A parent uses local pipes for setup and evidence, separate from the ROS data topic. |
| Discovery | Named default configurations | Fast DDS discovery and Zenoh peer discovery differ; their overhead is not a performance ranking. |
| Information boundary | Reader holds its last callback sample | Unsent evaluator positions and harness schedule are not reader observations. |
| Fidelity | Recorded middleware execution, synthetic motion | A detailed drone illustrates XYZ data; no flight controller or physical dynamics are run. |

## Fixed workload

All four cases use the same program, message type, period, payload law and
scheduled subscription creation. They are independent recordings, not four
readers observing one common transport run.

| Scheduled time | Application behavior |
| --- | --- |
| Before the origin | Publisher and reader processes initialize. The reader has no data subscription yet. A common future origin gives setup a 1 s guard. |
| 0–0.9 s | Ten publication calls, sequences 0–9, one per 100 ms slot. |
| 1–4 s | No publication calls. The publisher remains alive and its endpoint remains present. |
| At or after 2 s | The existing reader process creates its subscription. Actual call start and completion times are recorded. |
| 4–4.9 s | Ten further publication calls, sequences 10–19, one per 100 ms slot. |
| Through 6 s | Continue observing callbacks, including any late delivery. |

The second batch never waits for a historical callback or an endpoint-count
condition. Such gating would change the workload based on the outcome being
compared. Subscription creation must finish during the quiet interval; a setup
failure is reported rather than presented as a completed comparison. A publisher
that misses a full schedule slot aborts instead of emitting a catch-up burst.
Actual callback times and outcomes remain observations, not fixed expectations.

The source samples a prescribed reference at its actual generation timestamp:

```text
t = seconds since the common recording origin
p(t) = [3 cos(t), 2 sin(t), 1.5 + 0.4 sin(2t)] meters
```

The evaluator continues this curve during silence and after publication stops.
The reader receives no continuous position feed: it holds the XYZ from its last
executed callback exactly, even if that sample is old. It has no sample before
its first callback. There is no extrapolation, age rejection or sequence-based
admission rule in this lesson; duplicate or reordered observations remain visible.

## What to predict

With **VOLATILE**, the reader does not request the first batch. RELIABLE does
not turn the source into a durable log. The later batch provides the nominal
delivery case even though the earlier publications remain unobserved.

With **TRANSIENT_LOCAL** on both ends and a living publisher retaining five
samples, the expected historical set is sequences **5–9**. Sequences 0–4 exceed
the configured retention bound. The later live set is **10–19**. The page and
comparison script derive the actual received sets independently, report missing
observations and show whether the expected sets were observed. They do not
fabricate historical callbacks from the configured cache.

Transient-local retention is local to a living publisher endpoint. This
experiment does not persist data to disk or restart that publisher. Do not infer
crash-surviving storage, mission checkpoints or an unlimited event history.

## Middleware configurations and evidence

Both implementations run in one derived, pinned-base ROS 2 Jazzy container image.
The application selects one resolved RMW per case; each worker reports the
identifier actually loaded. Source/reader node names and process IDs are retained
in the trace. **Requested QoS** is recorded separately from **graph-reported QoS**.
The installed Python binding does not expose an actual-QoS getter, and graph
information need not expose every field. In particular, an unknown history and
zero depth in graph metadata must not be interpreted as a zero-sized actual
cache. Unknown fields stay explicit. Observed historical sequence sets provide
behavioral evidence for this workload, not proof of every QoS mechanism.

For Zenoh, the packaged default session and router configurations are unchanged
and their SHA-256 fingerprints are recorded. The default local sessions operate
as **peers**. A separately owned router supplies discovery information, enabling
direct local peer connections. A diagram must not imply that every data sample
passes through that router. The diagram explains configuration; this recording
does not capture packets or measure the physical route taken by each sample.

Fast DDS uses its default implementation configuration with loopback-scoped
discovery. All cases run in a disposable container with `--network none`, domain
45 and unique topic names. Local pipe reports do not create extra ROS publishers
or subscriptions on the measured topic. No router disruption, network partition,
radio channel, cross-machine clock or load benchmark is part of this experiment.

The available QoS concepts are not a claim that both RMWs implement every policy
identically. This lesson exercises only the stated reliability, durability and
history combination. The official Zenoh documentation describes its mapping and
limitations; deadline, lifespan and application liveliness guarantees are not
tested here.

## Measurements and replay

Play, next event, scrub, reset and both views use a single recorded time cursor.
Changing the case starts that independent recording from the beginning. Inspect
subscription creation, the first callback, the quiet interval and the later batch.
The envelope inspector shows actual sequence, generation timestamp, receipt
timestamp and XYZ. Historical rows never expose future callback observations.

Classify historical callbacks by a generation time before subscription creation
started; the quiet interval makes that distinction unambiguous. A callback is
counted when the application executes it, not when a transport packet arrives.
The summary exposes:

- Actual publication and callback counts, unique sequences and duplicates.
- Historical and live sequence sets, alongside unobserved publications.
- First callback times, and time from subscription creation to the first callback.
- Generation-to-callback age, plus the age of the currently retained sample.
- Expected bounded-history coverage and observed later-live coverage separately.

```text
callback_age = callback_time - generation_time
retained_age(t) = t - generation_time(last_callback_sample)
join_to_first_callback = first_callback_time - subscription_created_time
```

These host-monotonic timestamps are comparable inside the controlled container.
Callback age includes application scheduling, middleware buffering and executor
work. A historical sample is intentionally old. None of these quantities is an
isolated wire-latency measurement. Join-to-first-callback also reflects the
deliberate quiet interval and requested durability, so it cannot rank middleware
speed. Missing callbacks are unobserved publications, not measured packet loss.

Expected history in the comparison table follows the configured five-sample
publisher contract. It is not an instrumented view of a middleware queue. Only recorded callbacks
can populate the reader's held state. Completed recording means the observation
window was collected; it does not guarantee complete delivery or mission success.

## Reproduce and inspect

The supplied page runs with the normal web setup. With Docker available:

```sh
npm run record:middleware
npm run compare:middleware -- local/ros2-middleware.json
```

The recorder builds a local image from `ros2/middleware.Dockerfile`, with the
additional Jazzy Zenoh packages pinned to recorded versions. Installation stays
inside that image. Both RMWs use the same resulting image; its content ID, base
digest, package versions, source hash and configuration hashes accompany the
recording. Initial image construction needs package-repository access. An image
content ID is an observed fingerprint, not a promise that an apt repository will
retain those binaries forever.

Import the produced JSON to replay another actual run. Imports are limited to
10 MB and checked for the fixed publication schedule, source law, run/process
identities, requested and available graph-reported settings, subscription chronology and
callback provenance. Missing or unexpected delivery remains inspectable. A
rejected import preserves the active recording. Validation checks consistency,
not the authenticity of a supplied producer.

See the [recorded results](17-middleware-durability-results.md) for the concrete
runtime, sequence sets and checks actually run.

## Primary sources

- ROS 2 [Quality of Service settings](https://github.com/ros2/ros2_documentation/blob/jazzy/source/Concepts/Intermediate/About-Quality-of-Service-Settings.rst):
  reliability, durability, history and matching endpoint settings are separate
  policies; transient-local addresses late-joining subscriptions.
- ROS 2 [working with multiple RMW implementations](https://github.com/ros2/ros2_documentation/blob/jazzy/source/How-To-Guides/Working-with-multiple-RMW-implementations.rst):
  selecting an RMW changes the middleware below the client application.
- The Jazzy [rmw_zenoh README](https://github.com/ros2/rmw_zenoh/tree/jazzy) and
  [design](https://github.com/ros2/rmw_zenoh/blob/jazzy/docs/design.md):
  supported installation, default peer/router discovery, retained publication
  history and mapping of ROS QoS to Zenoh.

These references explain the interfaces. The supplied measurements establish
only the outcomes of the declared local runs, not a universal middleware winner.
