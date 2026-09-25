# Lesson 15 — ROS 2 message freshness and Quality of Service

**Question:** is a delivered message still useful?

One real ROS 2 process publishes synthetic position samples. Three separate
reader processes consume that same stream with different history depths and
application acceptance policies. A recorded executor pause exposes old messages
and the age of the position each reader retains. The web page replays actual
process observations, with linked 2D and 3D views.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Software stack | ROS 2 Jazzy / rclpy / rmw_fastrtps_cpp | The same pinned middleware runtime as workshop 14. |
| Communication architecture | One publisher, three independent readers | Readers share the source stream, not one another's state. |
| QoS reliability | Reliable on all endpoints | Reliability is held constant; this is not a Reliable versus Best Effort experiment. |
| QoS history | KEEP_LAST, depth 20 versus 1 | The subscription's middleware history retains a bounded number of samples. |
| QoS durability | Volatile | Late-join replay of historical publications is not requested. |
| Application rule | Accept each callback, or reject callback age > 150 ms | The age gate is application code, not the DDS lifespan or deadline policy. |
| Timing | Periodic generation and rate-limited callback servicing | No synchronous consensus barrier; source and readers progress separately. |
| Freshness metric | Callback age and retained-state Age of Information | The age of a newly taken message differs from the current age of the stored position. |
| Display fidelity | Recorded middleware execution and synthetic 3D kinematics | A detailed drone represents the generated source; a ghost represents remembered data. No autopilot or flight dynamics is modeled. |

The previous workshop used a full-roster round barrier. Such a barrier stops new
rounds while a reader is waiting, so it does not expose an accumulating telemetry
history. This lesson reuses the runtime and process boundaries with a continuous
stream: one publisher and three readers, plus a setup/trace collector. The
experiment studies message freshness independently of consensus convergence.

## Source, roles and available information

The publisher's synthetic source law is:

```text
t = elapsed shared-clock time in seconds
p(t) = [3 cos(t), 2 sin(t), 1.5 + 0.4 sin(2t)] meters
```

Every generated message contains a run ID, monotonically increasing sequence,
generation timestamp and sampled XYZ position. Receivers receive those fields
through a `std_msgs/msg/String` JSON envelope. They have their own current clock
and declared acceptance policy; no current evaluator position is sent as a
shortcut. A reader retains the most recently accepted sample without motion
prediction or interpolation between measurements.

The evaluator uses the declared source law at the selected replay time to
display the current synthetic position and positional separation from each
retained sample. That law continues through the observation window, including
after publication ends. The source model is known to the evaluator, not supplied
as a predictor to a reader. Measurements are exact samples of this law; there
is no sensing noise or localization filter. Age and geometric separation are
different metrics, and greater age does not always mean greater spatial error
on a curved path.

| Reader | Middleware subscription | Application acceptance |
| --- | --- | --- |
| History 20 | Reliable, volatile, KEEP_LAST depth 20 | Accept each valid callback. |
| Latest 1 | Reliable, volatile, KEEP_LAST depth 1 | Accept each valid callback. |
| Age gate 20 | Reliable, volatile, KEEP_LAST depth 20 | Accept only when callback age ≤ 150 ms. |

The publisher uses reliable, volatile, KEEP_LAST depth 20. Its depth and every
reader's depth are distinct endpoint settings. This implementation keeps the
publisher fixed and changes reader history and application filtering. A shallow
history can leave sequence gaps in callbacks even with reliable communication.
The trace records which samples callbacks actually observed; it does not
measure internal DDS queue contents or identify network packet loss.

## Scheduling and the controlled impairment

- Source publication target: every 50 ms for 4,000 ms (20 Hz), 80 samples.
  The recorder aborts if publication falls an entire period behind, rather than
  generating a catch-up burst.
- Each reader services at most one telemetry callback per 50 ms schedule slot,
  with a 25 ms phase offset from the publisher schedule. Missed slots are not
  replayed as a catch-up burst. Actual callback times include scheduling jitter.
- Observation continues for a 1,200 ms drain interval after source publication
  stops. The drain interval is part of the finite experiment, not a source crash.
- **Normal:** all readers service their subscriptions throughout the run.
- **Paused:** every reader skips executor servicing from planned time 800 to
  1,800 ms. Actual pause entry/exit times are recorded per process.

ROS middleware threads remain active while the application refrains from
calling its reader executor. This is controlled application servicing delay,
not a disconnected network, stopped process or injected DDS packet loss.
Readers share the same planned impairment, but their actual wall-clock boundary
times can differ slightly. Compare their recorded boundaries rather than
claiming exact simultaneous scheduling.

Processes establish expected endpoints and acknowledge a future common start.
The collector handles setup and instrumentation; it does not relay telemetry or
compute replacement reader positions. Telemetry is exchanged through ROS 2.
The runnable recorder has bounded readiness and overall timeouts and cleans up
its workers/container after completion or interruption.

## Clock and freshness contract

All processes execute on one host/kernel and use the same monotonic clock.
Exports subtract a common origin and contain relative milliseconds only.
No multi-machine clock synchronization claim is made.

```text
callback_age = callback_time - generation_time
accept_gated = callback_age <= 150 ms
held_information_age(t) = t - generation_time(last_accepted_sample)
position_lag(t) = ||p(t) - position(last_accepted_sample)||₂
```

Callback age includes time between generation and the application callback,
including middleware history and executor scheduling. It is **not network-only
latency**, a ROS deadline event or a measurement of the wire-arrival time.

The held-information age is an Age of Information metric at the acceptance
policy's output. It grows between accepted updates. Rejecting an old callback
does not refresh the position already retained, even when the rejection itself
is correct. Before a first accepted sample, position/age are unavailable rather
than zero. The common 150 ms threshold also lets the evaluator identify when
any reader's held state is old; it is not a flight-safety guarantee or an
automatic stopping controller.

Because post-pause servicing is rate-limited to the source rate, a deeper
history can retain a backlog. The age gate cannot increase service capacity.
Depth 1 favors recent state at the cost of omitted intermediate callbacks;
this can be appropriate for state displays but does not preserve a complete
event log. These observations do not establish a universal QoS recommendation.

## Replay and inspection

The interface clearly labels recorded mode. Playback advances one shared time
cursor; event stepping selects actual publication, callback or pause boundaries.
Both views consume the same source/reference position, selected reader sample
and event history. The replay speed is a presentation setting, not a new ROS run.
Reset rewinds the recording; changing case also starts paused at its beginning.

Inspect a callback's run/sequence, generation time, callback time, measured age,
XYZ sample and acceptance/rejection. Compare this with the last accepted
sequence, age of retained information, spatial lag and current pause state.
Jump to the first callbacks after resume to inspect a deep-history old message
beside the shallow reader's newer state. Read the gate reader's retained-state
age as well as its rejection counter.

Counts mean publication calls, telemetry callbacks, accepted/rejected callbacks,
and published sequence IDs without an observed callback by the selected time.
The last count includes samples still pending as well as samples not seen by
the finite recording. It is **not a DDS queue-size or packet-loss counter**.
Full-recording summaries are descriptive observations, not throughput benchmarks
or statistically established middleware rankings.

JSON import is bounded to 10 MB and validates identities, sample provenance,
timestamp/age consistency, publication/servicing slots, source positions, pause
intervals and application
decisions. A rejected import preserves the active recording. Metadata and
successful validation do not authenticate the external file's producer.

## Run and reproduce

Viewing the supplied recording uses the normal web setup. Docker is optional
for producing new runs and reuses the pinned image from workshop 14:

```sh
npm run record:qos
npm run compare:qos -- local/ros2-qos.json
```

Import `local/ros2-qos.json` on the page. The container requires no host-wide
ROS installation, host networking or privileged access. To explicitly replace
the public reference locally, run:

```sh
npm run record:qos -- --output docs/results/ros2-qos.json
```

See the [measured results](15-ros2-freshness-results.md) for actual versions,
source fingerprint, observed cases and checks performed.

## Acceptance and limits

Require actual ROS 2 publications/callbacks with distinct process identities;
inspect timestamps against the source records and recompute application decisions.
Verify pause boundaries, history-depth effects in the measured cases, sample
holding, unavailable initial data, growing age between updates, stale rejection
without invented freshness, and linked replay/import/2D/3D interactions.

No reliability-policy comparison, network loss injection, hidden-queue telemetry,
process restart, multi-host clock model, asynchronous consensus theorem, real
GPS/IMU, vehicle controller or physical flight simulation is implemented.
Process interruption/restart is covered separately by
[workshop 16](16-process-restart.md).

## Primary sources

- ROS 2 Jazzy [QoS policies](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Quality-of-Service-Settings.html)
  define history/depth, reliability, durability, deadline and lifespan separately.
- ROS 2 Jazzy [executors](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Executors.html)
  explain callback servicing and middleware-held incoming samples. The source
  experiment uses `rclpy`'s single-threaded executor with explicit servicing.
- Yates et al., [Age of Information: An Introduction and Survey](https://arxiv.org/abs/2007.08564)
  provides context for timestamp-based freshness metrics. This lesson measures
  one application acceptance policy; it does not reproduce queueing-theory
  optimality results from the survey.
