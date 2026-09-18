# Lesson 20 — GCS heartbeat loss and an autopilot failsafe

**Question:** can the vehicle detect missing ground-station heartbeats and act
while its telemetry still reaches the observer? What changes when the heartbeats
return?

**Implementation status:** `/failsafe/` replays two recorded ArduCopter SITL
executions: continuous and temporarily suppressed ground-station heartbeats.
The bundled recording and an independent repeat both completed. Actual versions,
measured outcomes and verification are documented in the
[results](20-gcs-failsafe-results.md).

The experiment uses one **ArduCopter SITL** vehicle and a **pymavlink** ground
station. Two fresh simulations compare continuous heartbeats with a temporary
interruption after a settled takeoff. Both stop sending flight commands during
the same observation interval. Telemetry reception continues throughout.

The selected action is **LAND**. Restoring heartbeats clears the GCS failsafe
condition; it does not request a return to Guided mode. The browser replays
recorded observations, with the autopilot's position and attitude driving linked
2D and 3D views.

## Method profile

| Aspect | Experiment choice | Meaning |
| --- | --- | --- |
| Autopilot and dynamics | ArduCopter 4.7.1 with its built-in SITL quadrotor model | Reuses the bounded flight runtime from workshop 18; Gazebo is not required. |
| Protocol | MAVLink 2 over container-local TCP | Ground-station heartbeats and flight commands are different message streams. |
| Failure detector | ArduPilot's GCS last-seen timeout | The autopilot monitors eligible inbound traffic using its own clock. |
| Configured response | `FS_GCS_ENABLE=5`, LAND | Missing heartbeats can change the flight mode without a received LAND command. |
| Timeout and options | `FS_GCS_TIMEOUT=3`, `FS_OPTIONS=0` | A three-second timeout with no continuation-option bits selected. |
| Ground-station identity | Source system 255, component 190 | The configured GCS system ID selects the monitored source; the component ID is recorded but does not select this failsafe timer. |
| Vehicle identity | System 1, component 1 | Incoming autopilot observations and command acknowledgements must match this identity. |
| Failure intervention | Suppress only ground-station heartbeat sends for eight host-clock seconds | The socket stays open, the observer keeps receiving, and no radio-link failure is simulated. |
| Evidence | Sent-message records, specific status text, mode/state reports and fresh landing telemetry | Intentional suppression, observed failsafe state and physical execution remain separate facts. |

This is an onboard timeout and configured response, not a new coordination
algorithm. The simulator still runs the autopilot's estimator and controller.
The experiment does not implement a replacement failsafe in JavaScript.

## Two fresh flights and one changed condition

Both cases start with fresh vehicle state, the same parameters and established
ground-station heartbeats nominally sent at 1 Hz. Normal arming checks remain
enabled. The controller requests Guided mode, normal arm and takeoff to four
meters above home, using the same telemetry-derived settling criterion as
[workshop 18](18-sitl-mavlink.md).

After takeoff settles, observe **14 seconds of recorder host time**:

| Observation interval | Continuous case | Interrupted case |
| --- | --- | --- |
| Start through +2 s | Heartbeats continue | Heartbeats continue |
| +2 s through +10 s | Heartbeats continue | Heartbeat transmission is suppressed |
| +10 s through +14 s | Heartbeats continue | Heartbeat transmission resumes |
| Flight commands throughout the interval | None | None |
| Telemetry reception throughout the interval | Continues | Continues |

After the interval, the continuous case requests LAND explicitly and waits for
landing and disarming. The interrupted case sends **no LAND request**: the
recording waits for the configured failsafe's landing to complete. Restoring
heartbeats sends no mode-change, takeoff or restart command.

These are target offsets. Suppression begins on the first recorder update at or
after +2 s, and restoration on the first update at least eight seconds after
that actual suppression start. The schedule uses recorder-relative monotonic
time and is not a promise of exactly 14 simulated seconds. Actual transmission
timestamps, suppression and restoration events are recorded. A nominal 1 Hz
schedule does not guarantee that every heartbeat arrives exactly one second
after the preceding one.

The comparison isolates **missing heartbeats** from **missing new flight
commands**. Both cases deliberately stop flight commands during observation. The
controller and receiving socket remain active; this is neither a process crash
nor a complete bidirectional connection failure.

## Which traffic does ArduPilot monitor?

In the pinned firmware, the relevant parameter names are **`MAV_GCS_SYSID`** and
**`MAV_GCS_SYSID_HI`**. Set and read back `255` and `0`, respectively: only source
system 255 qualifies as this vehicle's GCS. A higher valid range endpoint can
admit several GCS system IDs, but that configuration is outside this experiment.

The heartbeat handler checks the message's source **system ID**. It does not
add a component-ID or heartbeat-type condition for refreshing this timer. The
experiment nevertheless uses the conventional GCS heartbeat payload and records
both source identity fields.

There is a further source-level distinction: eligible `RC_CHANNELS_OVERRIDE`
and `MANUAL_CONTROL` messages can also update the same GCS last-seen timestamp.
This experiment sends neither. It has no second ground station, RC override
stream or manual-control stream that could keep the timer fresh during the
declared interruption. Ordinary absence of a new position or flight command is
not the configured heartbeat failure condition.

Before any qualifying GCS traffic has been seen, the last-seen timestamp is zero
and this failsafe check is bypassed. The recording therefore establishes the
heartbeat stream before flight and verifies the configured identity and
parameters. A send record proves what the harness emitted, not the autopilot's
exact receipt timestamp. The experiment does not export the autopilot's internal
last-seen clock as if it were directly observable telemetry.

## Timeout, LAND mode and heartbeat restoration

The pinned GCS checker uses the autopilot's millisecond clock:

```text
elapsed = autopilot_now − last_eligible_GCS_traffic_seen
if elapsed > FS_GCS_TIMEOUT × 1000:
    enter the configured GCS failsafe response
```

The check runs in the nominal **3 Hz** scheduler loop. The comparison is strictly
greater than the configured timeout, and reporting adds its own sampling and
transport delay. Do not label a host-side three-second countdown as the exact
instant of onboard detection. The age since the harness's last heartbeat send
is useful context, with a different meaning from the onboard receive age.

For this configuration and an airborne Guided vehicle, the selected response
switches to **LAND**. The pinned failsafe LAND path also enables a **four-second
landing pause** before normal descent. Consequently, a LAND mode report need not
be accompanied by immediate downward motion. Inspect altitude and velocity to
establish what the vehicle subsequently does; the configured pause alone does
not measure the first descent sample.

When qualifying GCS traffic returns, a later checker invocation clears the GCS
failsafe condition. Its recovery handler reports the clear event and logs it;
it does **not** restore the earlier flight mode. LAND can therefore persist after
the GCS condition clears. This distinction separates:

1. Heartbeat transmission resumes at the ground station.
2. The autopilot reports that the GCS failsafe condition cleared.
3. The vehicle's reported mode remains LAND.
4. Fresh telemetry eventually reports on-ground and disarmed.

Neither heartbeat restoration nor a cleared status message means that a mission
resumed. The experiment sends no command to resume it.

`FS_OPTIONS=0` is an explicit experiment setting, not a claim about every
firmware's default. Other option bits, flight modes, battery conditions, arming
state and position availability can change failsafe behavior. In particular,
the source can disarm immediately when already landed; the interruption here
starts after a measured airborne takeoff.

## What the recording can establish

The observer combines several channels rather than treating a countdown or one
message as sufficient evidence:

- **Harness intervention:** exact heartbeat-send records and the bounded
  suppression/restoration schedule. There are no sends from this source during
  the declared suppression interval.
- **Continued downlink:** actual autopilot heartbeat, position and attitude
  messages received during suppression, with receipt times and held-sample ages.
  An open socket alone does not establish continued useful telemetry.
- **Specific GCS report:** recorded `STATUSTEXT` reports `GCS Failsafe` and later
  `GCS Failsafe Cleared` in this firmware. These identify the reported condition;
  their receipt timestamps are not internal trigger timestamps.
- **Mode and overall state:** autopilot `HEARTBEAT.custom_mode` identifies Guided
  or LAND. `HEARTBEAT.system_status` can report `MAV_STATE_CRITICAL` while a
  failsafe is active. That field covers multiple failsafe causes, so CRITICAL
  alone does not identify GCS loss. It is also distinct from the `SYS_STATUS`
  message, which has no dedicated GCS-heartbeat-loss flag.
- **Execution:** position/altitude samples expose the measured response. Landing
  completion requires an earlier airborne report, then fresh on-ground and
  disarmed reports after the observed LAND transition or explicit LAND request.
  An accepted command, LAND mode, failsafe clear or low altitude alone cannot
  satisfy landing completion.

These channels can arrive in a different order from a simplified causal diagram.
In the bundled interrupted run, the first LAND heartbeat arrived just before
the `GCS Failsafe` status text. The replay preserves both receipt timestamps:
LAND mode can be visible while the specific GCS report is still unobserved.
It does not move a message to make the displayed sequence look cleaner.

The interrupted run must preserve the absence of a transmitted LAND command and
of an invented LAND acknowledgement. Its landing event is an observer conclusion
from telemetry, not command admission. The continuous case retains its explicit
LAND request and matching acknowledgement separately.

The unchanged heartbeat case remained Guided through the command-free
observation interval, without a recorded GCS failsafe report. The interrupted
case exposed onset, configured response, restoration, clear and continued LAND
execution. These remain acceptance criteria for new recordings; an execution
that differs must not be replaced with a synthesized expected sequence.

## Coordinates, rendering and replay

The recorder receives autopilot **estimates**, not independent simulator ground
truth. Position uses local north/east/down (NED); attitude uses the MAVLink
forward/right/down body convention. Height above home has a distinct origin
from local estimator down. The view uses the documented display transforms from
workshop 18 and preserves raw telemetry values in inspectors.

One receipt-time cursor controls 2D, 3D, heartbeat history, flight state and
message inspection. Each telemetry channel holds its latest received sample;
the renderer does not invent future positions or resimulate a second vehicle.
Vehicle boot timestamps remain separate from recorder-relative receipt times.
They must not be subtracted to infer transport latency.

The 3D drone and yard are teaching visuals. Flight dynamics come from the actual
SITL run, while decorative objects add no simulated collisions, radio obstruction
or environmental effects. Playback controls change only the presentation.

## Recording and verification boundary

The optional recorder reuses workshop 18's pinned Linux amd64
ArduCopter/pymavlink image. It owns both fresh simulated runs, uses local
interfaces inside a container without external network access, and accepts no
physical-vehicle endpoint. The initial image build can download the pinned
dependencies; runtime recording uses no external network. Browser playback
requires only the existing web setup.

Open `/failsafe/` to inspect the bundled runs, or record and compare another pair:

```sh
npm run record:failsafe
npm run compare:failsafe -- local/ardupilot-failsafe.json
```

The bundled recording is
[`docs/results/ardupilot-failsafe.json`](../results/ardupilot-failsafe.json).
The [results document](20-gcs-failsafe-results.md) identifies the actual captures
and completed verification checks.

Record actual readback of `FS_GCS_ENABLE`, `FS_GCS_TIMEOUT`, `FS_OPTIONS`,
`MAV_GCS_SYSID`, `MAV_GCS_SYSID_HI` and the normal flight/arming parameters. Preserve
firmware, image, source and parameter fingerprints with each collection.

Validation must reject contradictory heartbeat schedules, mismatched identities,
unsupported response settings, completion without fresh evidence, and an
interrupted case that secretly sends LAND or a mode-restoration command.
Imported metadata does not authenticate an external recording's producer.
Incomplete or unexpected executions must fail explicitly rather than replace
the previous artifact with a fabricated successful sequence.

## Primary references

- ArduPilot's [GCS failsafe documentation](https://ardupilot.org/copter/docs/gcs-failsafe.html)
  describes the configurable timeout/action, prior connection requirement,
  option bits and persistence of the failsafe-selected mode after reconnection.
- Pinned [GCS identity parameters and selector](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/GCS_MAVLink/GCS.cpp)
  and [MAVLink receive handlers](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/GCS_MAVLink/GCS_Common.cpp)
  establish which source systems and message types refresh the last-seen state.
- Pinned [Copter failsafe handling](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/events.cpp),
  [parameter definitions](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/Parameters.cpp)
  and [scheduler](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/Copter.cpp)
  define the strict timeout check, selected response and nominal check frequency.
- Pinned [LAND implementation](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/mode_land.cpp)
  and [configuration constants](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/config.h)
  define the failsafe landing pause.
- Pinned [Copter heartbeat status](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/GCS_MAVLink_Copter.cpp)
  and the [MAVLink message definitions](https://mavlink.io/en/messages/common.html)
  distinguish heartbeat mode/overall state, status text and sensor subsystem status.

This experiment tests one configured response to one controlled heartbeat
interruption. It does not establish radio reliability, general failsafe safety,
mission resumption, hardware behavior or tolerance to arbitrary communication
failures.
