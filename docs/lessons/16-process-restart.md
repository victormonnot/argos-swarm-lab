# Lesson 16 — Process failure, heartbeat suspicion and restart

**Question:** does hearing from an agent again mean its old state is valid?

A real ROS 2 source process publishes stamped heartbeats for logical agent A1.
One persistent observer applies two admission rules to the **same callbacks**.
Compare continuous publication, temporary publication silence in a living
process, and an actual process killed and replaced by a new incarnation. The
browser replays those measured observations with linked 2D/3D views.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Failure detector | Fixed-timeout heartbeat watchdog | A local timer suspects an agent after 400 ms without an accepted heartbeat. Suspicion is not proof of a crash. |
| Baseline admission | Sequence-only high-water mark | Accept a sequence strictly greater than the last accepted sequence, ignoring incarnation. |
| Restart-aware admission | Ordered epoch and sequence | A larger epoch starts a new sequence history; older epochs are rejected. |
| Architecture | One source, one observer, one harness | Two policies share one observer process and exactly the same callback inputs. |
| Incarnation authority | Surviving harness assigns epoch 1 then 2 | A run-scoped, trusted ordering; not a distributed or durable epoch service. |
| Timing | 100 ms heartbeat, 20 ms watchdog target | Actual generation, callback and timer transition times are recorded. |
| Middleware | Jazzy / rclpy / Fast DDS | Reliable, volatile, KEEP_LAST depth 20 for heartbeats; depth 256 for setup/reports. |
| Information boundary | Observer uses envelopes and local receipt time | Process exits, PID inspection and reference motion are evaluator/harness data. |
| Fidelity | Actual process interruption, synthetic XYZ context | No physical crash, vehicle dynamics, autopilot or mission recovery is simulated. |

This is a small application protocol, not SWIM, a consensus algorithm, a DDS
liveliness implementation, or a ROS 2 `LifecycleNode`. Ordinary ROS nodes execute
in separately owned processes; the harness explicitly terminates and respawns
its source process.

## Identities and state

A heartbeat carries:

```text
runId, agentId = A1, epoch, seq, generation timestamp, XYZ position
```

- **Logical identity A1** persists across the experiment.
- **ROS node name** remains the same across source incarnations.
- **PID** identifies a recorded operating-system process inside the container.
  The evaluator can inspect it; the policies do not use it as a heartbeat input.
- **Epoch** is an integer assigned by the harness, initially 1 and then 2 for
  the replacement process. It is not inferred by sorting random UUIDs.
- **Sequence** starts at zero within a new source process and increases for
  each publication. Its volatile counter is lost when that process is killed.

The harness and observer survive the source interruption. An epoch greater than
the current accepted epoch is trusted in this controlled run. The protocol does
not solve harness failure, durable storage, malicious senders, concurrent
owners of A1, distributed epoch agreement or external side-effect fencing.

The source samples the same prescribed reference as workshop 15:

```text
t = time since the shared recording origin, in seconds
p(t) = [3 cos(t), 2 sin(t), 1.5 + 0.4 sin(2t)] meters
```

The evaluator can draw this curve even while the source process is absent.
These unsent positions never refresh the observer's retained sample. A new
source evaluates the curve using the supplied common clock origin; it does not
recover a persisted mission, estimate its own pose or restore controller state.
The moving drone represents synthetic reference data, not proof that a real
vehicle survives a computer failure.

## Admission and suspicion

Each policy starts with no accepted heartbeat and status **Awaiting**. There is
no initial startup timeout in this lesson. At a valid callback:

```text
sequence_only:
    accept if no previous sample OR seq > last_accepted.seq

epoch_and_sequence:
    accept if no previous sample
           OR epoch > last_accepted.epoch
           OR (epoch = last_accepted.epoch AND seq > last_accepted.seq)
    otherwise reject (old epoch or duplicate/old sequence)
```

Only an **accepted** heartbeat replaces the retained sample and resets that
policy's local receipt timer. A callback rejected by either rule remains visible
in the shared callback inspector. Receiving a message and accepting its state
are separate observations.

```text
accepted_receipt_age(t) = t - receipt_time(last_accepted_heartbeat)
suspect when a watchdog evaluation finds accepted_receipt_age >= 400 ms
```

The actual watchdog evaluation changes the recorded status to **Suspect**.
A zero countdown alone does not synthesize a transition in the browser. The next
accepted heartbeat changes that policy back to **Recent accepted heartbeat**.
This label describes observed evidence, not a guarantee that the process is
currently running or healthy.

Generation age and local receipt silence have different purposes. Generation
age describes the held sample; receipt silence drives this watchdog. The shared
host monotonic clock makes this recording's timestamps comparable, but the
watchdog's elapsed receipt-time rule does not require remote clock synchronization.
There is no independent generation-age rejection rule in this workshop.

A late higher-sequence heartbeat can therefore count as recent receipt even if
its contents are old. Epoch ordering protects incarnation admission, not every
form of data freshness or replay. Old-epoch and duplicate rejection are tested
as protocol properties; the recorder does not inject a delayed old-epoch packet.

## Three recorded cases

All cases target an 8,000 ms observation window and 100 ms publications.
Initial source and observer endpoints are ready before a future common origin.
The source aborts a recording if it misses a full publication period rather
than emitting an artificial catch-up burst. Actual scheduling is not hard real time.

1. **Continuous heartbeat:** one incarnation throughout the observation.
   Both policies normally accept the same stream.
2. **Same process, silent publisher:** from planned 1,500 to 3,000 ms, the
   source refrains from publishing while its process remains alive. Actual
   silence entry/exit is recorded. PID, epoch and sequence history continue.
   A suspicion during this interval is a false crash inference if interpreted
   as “the process died.” Both policies accept the resumed sequence.
3. **Killed process, new incarnation:** the harness sends SIGKILL to its owned
   source at or after 1,500 ms, records the exit code, and launches a replacement
   at or after 3,000 ms. New-process startup and endpoint discovery take real
   time. After endpoint readiness, an explicit 1,000 ms setup guard gives the
   new process time to acknowledge its future start; the first publication is
   aligned to the next eligible 100 ms schedule slot. A recorded ready event
   precedes its first publication; the planned
   launch time is not the first received heartbeat time.

The baseline observer retains its old sequence high-water mark. When epoch 2
starts from sequence zero, it rejects lower/equal sequences until the new
counter exceeds its old maximum. The epoch-aware policy can accept the first
new-incarnation callback immediately. The baseline can eventually recover;
report the actual recovery or its absence within the finite recording.

The harness's kill request and confirmed process exit are separate timestamps.
A publication scheduled near the kill boundary may complete first; use the
recorded old high-water mark, not an assumed count. The monitor never receives
a privileged “process crashed” input from the harness.

## Replay and measurements

Play, event stepping, scrubbing, case changes and policy selection use one
recorded cursor. The linked SVG and 3D scene hold each selected policy's exact
last accepted position; they do not interpolate that estimate toward truth.
The process-truth panel is visually separate from the observer's suspicion and
accepted epoch/sequence. A source process can be stopped while the observer
still has recent evidence, or running while the observer remains suspicious.

Inspect the last raw callback and its two decisions, last accepted heartbeat,
receipt age/countdown, generation age, retained XYZ and evaluator position lag.
Use shortcuts for interruption, first suspicion, first return callback and the
selected policy's first acceptance after return. Reset rewinds the recording;
changing playback speed does not launch a new ROS run.

Counts mean publication calls, executed callbacks and accepted/rejected
callbacks. They do not count wire packets or hidden middleware queues.
Comparison summaries report first suspicion, first post-return acceptance and
its delay measured from the first return callback. For the restart case, a
separate delay from actual process spawn includes startup/discovery and the deliberate setup guard. These
measurements describe one run; they are not general middleware performance or
failure-detection guarantees. A heartbeat does not establish mission completion.

Imports are limited to 10 MB and checked for process/run identities, publication
provenance, epoch/sequence admission, source samples, receipt-time transitions
and process events. A rejected import preserves the current recording. Validation
checks internal consistency, not the authenticity of an external producer.

## Run and reproduce

The supplied page needs only the usual web setup. With Docker available:

```sh
npm run record:restart
npm run compare:restart -- local/ros2-restart.json
```

Import `local/ros2-restart.json` on the page. The recorder reuses the pinned
Jazzy image from workshops 14–15, launches owned processes in an isolated
container, and removes them after completion or interruption. No host-wide ROS
installation is needed. See the [measured results](16-process-restart-results.md)
for the actual runtime fingerprint, observations and verification.

## Primary sources and boundaries

- Chandra and Toueg, [Unreliable failure detectors for reliable distributed systems](https://research.ibm.com/publications/unreliable-failure-detectors-for-reliable-distributed-systems)
  (1996), introduces completeness and accuracy as separate detector properties.
  This small heartbeat example does not implement their consensus algorithms or
  prove a detector class under arbitrary scheduling.
- Aguilera, Chen and Toueg, [Failure Detection and Consensus in the Crash-Recovery Model](https://www.microsoft.com/en-us/research/wp-content/uploads/1998/09/disc98_recovery.pdf)
  (1998), discusses crash recovery, lost local state and epoch information. This
  lesson uses a simpler exact epoch supplied by one surviving harness; it does
  not reproduce that paper's detector or storage guarantees.
- The ROS 2 [managed-node design](https://design.ros2.org/articles/node_lifecycle.html)
  specifies lifecycle states and transitions. Those states differ from this
  experiment's operating-system exit and new process, and from local suspicion.
