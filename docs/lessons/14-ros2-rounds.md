# Lesson 14 — ROS 2 nodes, topics and explicit rounds

**Question:** what changes when a known algorithm runs in separate programs?

Reproduce [workshop 1's consensus](01-consensus.md) with six actual Python
processes. Each hosts one ROS 2 node, publishes its scalar and subscribes only
to its neighbors' value topics. A seventh process coordinates rounds and
records observations. The web lesson replays those recordings; it does not
run ROS 2 inside the browser or connect to a live robot.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Algorithm | Distributed average consensus, constant edge gain | The same scalar update as workshop 1, with α = 1/12. |
| Decision architecture | Decentralized numerical decisions | Agents compute from their own scalar and received neighbor values. |
| Execution coordination | Central full-roster round barrier | A supervisor starts each round and waits for all six update reports. It never sends an average or new agent value. |
| Timing | Synchronous logical rounds over asynchronous callbacks | Arrival order may differ. Every input to update k must belong to run R and round k. |
| Communication | ROS 2 publish/subscribe | One value topic per agent; control and instrumentation use separate topics. |
| Topology | Complete graph or undirected chain | The subscriber set changes while the numerical rule stays fixed. |
| Runtime | ROS 2 Jazzy, rclpy, Fast DDS through rmw_fastrtps_cpp | Six agent processes plus a supervisor in one disposable container. |
| Display fidelity | Replay of recorded software execution | Process blocks and packets are a software diagram. Their positions, heights and animation durations are not vehicle motion or measured network latency. |

A ROS node is a graph participant, not necessarily an operating-system process.
This experiment deliberately gives every agent its own process, and records
its node name and process ID (PID). Multiple nodes could instead share one
process in a different deployment. A topic is a named, typed stream, not a
point-to-point socket or a physical radio link.

## Numerical contract

```text
initial values = [0, 2, 4, 8, 10, 12]
x_i[k+1] = x_i[k] + (1/12) * sum(x_j[k] - x_i[k], j in neighbors(i))
```

Neighbor identifiers are sorted before summation. The mathematical rule is
unchanged from workshop 1; floating-point operation ordering can differ from
its edge-wise implementation. Comparison tolerance is an absolute **1e-10**
over every recorded completed state and every agent. This is a numerical
equivalence check, not a measurement of speed or transport reliability.

Agents receive only their own initial scalar, declared neighbors and round
commands, then current-round neighbor values. The global mean, disagreement,
reference calculation, complete graph display and trace comparison belong to
the evaluator. Neither rendering nor reference comparison supplies agent inputs.

## Explicit application protocol

Each execution gets a fresh run identifier. A round number identifies the
transition from state k to state k+1. A value message identifies its run, round,
sender and scalar. ROS carries a `std_msgs/msg/String` containing JSON;
the application validates the JSON fields. They are not a custom ROS message
definition, and IDs are not sender authentication.

Topics are `/argos_<runId>/agent_<id>/value`, `/argos_<runId>/control` and
`/argos_<runId>/reports`. Agent IDs in the payload are zero-based (0–5); the
interface labels them A1–A6. All endpoints use reliable, volatile, keep-last
QoS with depth 256. Discovery is restricted to localhost inside the isolated
container, with ROS domain 42. The readiness deadline is 20 seconds; each round
has a 3-second application timeout. These are recorder deadlines, not deadlines
configured in the ROS QoS profile.

1. Start six independent agents and the supervisor. Wait for required ROS
   publisher/subscriber endpoints and readiness reports; a fixed sleep is not
   the synchronization mechanism.
2. The supervisor publishes a round-start command. Each agent publishes its
   own current scalar once, except for the explicitly scheduled omission.
3. Each agent collects exactly one matching-round input per declared neighbor.
   A message can arrive before that agent processes the start command; it can
   be buffered for that same next round. It cannot trigger an early update.
4. Compute once only after the command and all required values are present.
   Report the computed value and the inputs actually consumed. Duplicate,
   wrong-run, invalid and out-of-round messages cannot satisfy the barrier.
5. The supervisor appends a complete state only after all six update reports,
   then starts the next round. If the round exceeds the declared timeout,
   record the incomplete exchange and stop. Do not substitute stale values.

The numerical decision is decentralized; progress depends on a central timing
supervisor and all six agents. This is an intentional teaching protocol, not
leaderless execution, fault-tolerant consensus, Raft, or a general asynchronous
consensus algorithm. ROS 2 does not supply this application-level round barrier.

## Cases and measured quantities

| Recording | Change | Budget | What to inspect |
| --- | --- | --- | --- |
| Complete graph | Five neighbors per agent | 20 transitions | Six publications fan out to 30 neighbor receipt callbacks per complete round; first updated vector is `[3, 4, 5, 7, 8, 9]`. |
| Chain | One or two neighbors per agent | 350 transitions | Six publications produce ten neighbor receipts per complete round. Fewer subscriptions do not imply fewer rounds to agreement. |
| Missing publication | A3 withholds its value at round 2 in the complete graph | Stops at the incomplete barrier | A3 can still compute from five peers; those five peers wait for A3. There is no complete state 3. |

The omission is deliberate **application behavior**, not injected DDS packet
loss, a dead process, a radio partition or a QoS reliability comparison. A
reliable publisher cannot deliver a value the application never publishes.
Freshness/QoS and process restart are separate proposed workshops 15 and 16.

Metrics are the number of completed rounds, recorded publication calls and
neighbor receipt callbacks, the range `max(x) − min(x)`, and the mean. Agreement
means an unrounded range ≤ 0.01; reaching the recording budget is different from
meeting that threshold. Counters exclude discovery, control, instrumentation,
acknowledgments, retransmissions and packet overhead. They are **not network
packets, bytes or bandwidth**. An incomplete barrier exposes local updates
separately from the last complete vector; it must not fabricate a global update.

## Recorded interface and reproduction

The supplied JSON records runtime versions, image identity, source SHA-256,
run IDs, node names, PIDs, current-round publication/receipt/update observations,
completed states and terminal conditions. The [results](14-ros2-rounds-results.md)
list actual execution and verification.

The browser has a clearly labeled recorded mode. Play and stepping reveal
publish, receive and barrier phases at a teaching pace. These grouped phases
do not claim that every publish precedes every receipt in wall-clock time.
Pause, reset, speed, agent selection, camera and 2D/3D switches never launch
processes or modify the source recording. Reset rewinds playback. Scrubbing
selects a recorded completed boundary. A final timeout remains inspectable.

The message inspector shows node/PID, topic, run/round identity, received
neighbors and computed output. Both views consume one cursor and one recording.
Import accepts bounded, structurally checked JSON. Inconsistent/malformed files
leave the active recording intact. Imported metadata is untrusted provenance;
passing the numerical comparison does not authenticate that ROS produced a file.

With Docker installed and its daemon available:

```sh
npm run record:ros2
```

The runner uses a pinned official ROS image, mounts only the runtime source
read-only, launches a disposable container, records all three cases, and writes
`local/ros2-consensus.json`. Select that file using the workshop's import control.
The first run downloads the image. Later runs can reuse it. No host-wide ROS
installation, privileged container or host network is required. Docker is
needed to produce new traces; viewing supplied traces only needs the usual
web setup. To regenerate the public reference explicitly:

```sh
npm run record:ros2 -- --output docs/results/ros2-consensus.json
```

This command replaces the reference file locally; it does not publish it.
Review the source hash, numerical comparisons and results before committing.

## Acceptance and boundaries

- Actual ROS 2 execution records six distinct agent processes and neighbor-only
  subscriptions. A browser-generated vector is insufficient evidence.
- Every completed trace vector matches the independent workshop-1 reference
  within the declared tolerance. Local updates use the recorded inputs.
- Wrong-run/round, duplicate and malformed envelopes cannot create updates;
  readiness and a bounded timeout prevent indefinite waiting.
- The omission case records the five missing inputs and incomplete barrier,
  without a synthetic next state or reuse of a prior-round message.
- UI checks cover recorded phase playback, inspection, reset, comparison,
  scenario selection, import errors, linked views and narrow layouts.
- The display separates numerical equivalence, agreement, execution completion
  and provenance. It reports no networking performance from playback timing.

One computer/container is not a multi-machine deployment, radio model or
flight simulator. PIDs are local to that execution, not global agent identities.
The recorder is custom JSON, not rosbag. No hardware control, physical dynamics,
membership change, automatic recovery, persistent node state or middleware
benchmark is implemented.

## Primary sources

- ROS 2 Jazzy: [nodes](https://docs.ros.org/en/jazzy/Concepts/Basic/About-Nodes.html)
  and [topics](https://docs.ros.org/en/jazzy/Concepts/Basic/About-Topics.html).
- ROS 2 Jazzy: [Quality of Service settings](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Quality-of-Service-Settings.html).
  This experiment declares a profile; it does not compare reliability policies.
- ROS 2 Jazzy: [Docker execution guide](https://docs.ros.org/en/jazzy/How-To-Guides/Run-2-nodes-in-single-or-separate-docker-containers.html).
- Olfati-Saber and Murray: [Consensus Problems in Networks of Agents With
  Switching Topology and Time-Delays](https://www.cds.caltech.edu/~murray/papers/2003f_om04-tac.html).
  The implemented discrete update and synchronization assumptions are the
  specific contract above, not every result in the paper.
