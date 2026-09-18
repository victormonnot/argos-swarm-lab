# Lesson 18 — ArduPilot SITL and MAVLink command feedback

**Question:** did the vehicle execute the requested action, or merely accept it?

One actual ArduCopter executable runs with its built-in quadrotor flight dynamics
in **Software-In-The-Loop (SITL)**. A small Python controller sends **MAVLink 2**
commands and records acknowledgements and telemetry. The page replays those
observations with a shared 2D/3D cursor; it does not generate a substitute flight.

Compare a Guided takeoff, one local position target and landing with an attempted
takeoff while disarmed. Both cases use fresh simulator processes and unchanged
arming checks. The second case records the actual rejection and a bounded period
of subsequent telemetry rather than manufacturing a refusal in the browser.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Autopilot | ArduCopter 4.7.1 | A versioned executable controls simulated motors using simulated sensors. |
| Simulation | Built-in quadrotor SITL dynamics, speedup 1 | A flight dynamics model supplies the autopilot; this is more than a prescribed browser trajectory. |
| Command interface | MAVLink 2 through pymavlink | Typed requests, acknowledgements and telemetry use a local TCP connection. |
| Flight control mode | Guided, then Land | The autopilot handles stabilization; the Python controller requests higher-level actions. |
| Controller logic | Sequential, telemetry-gated stages | Mode, arming, height, waypoint and landing must meet declared evidence criteria. |
| Movement request | Position-only local NED setpoint | One north/east/down target, with all velocity/acceleration/yaw fields ignored. |
| Acknowledgement | COMMAND_ACK for command-protocol requests | Admission is distinct from measured execution; the position setpoint has no command ACK. |
| Available information | Autopilot-reported position, attitude and state | These are estimates and flight-state reports, not an independent simulator truth stream. |
| Fidelity boundary | One vehicle, built-in dynamics, recorded playback | No Gazebo environment, radio fault, physical hardware or multi-vehicle mission is exercised. |

## Two recordings

The controller first waits for usable position, attitude, heartbeat and landed
telemetry, reads runtime/parameter information and requests stream rates. Setup
time is reported separately from the flight replay. The measured run uses the
recorder's monotonic receipt clock, starting after setup; original autopilot
`time_boot_ms` values remain separate fields.

### Normal Guided flight

1. Request Guided mode and confirm a subsequent heartbeat reports it.
2. Request normal arming, without force-arm, and confirm the armed heartbeat bit.
3. Send `MAV_CMD_NAV_TAKEOFF` with a four-meter altitude above home. Inspect its
   `COMMAND_ACK` separately from the later height completion evidence.
4. Send one `SET_POSITION_TARGET_LOCAL_NED` target eight meters north, five east
   and four up from the measured initial local position. Inspect movement and
   stabilization against this explicitly supplied target.
5. Send `MAV_CMD_NAV_LAND`, then observe landing and automatic disarming.

The waypoint is a Guided position target, not an uploaded mission item. There is
no automatic path planner, obstacle-avoidance test or `MISSION_ITEM_REACHED`
claim. Decorative objects in the browser yard are not collision geometry in the
SITL model.

### Takeoff requested while disarmed

Confirm Guided mode but omit arming. Send the same four-meter takeoff request.
Record the actual result code, status messages and five seconds of telemetry
after rejection. The experiment reports what happened in that finite window;
it does not infer a failure from a button label or assume the exact result code
before the autopilot responds.

An unexpected acceptance or timeout must not be relabeled as the expected
rejection. The supplied reference records the measured case. Setup errors,
execution timeouts and unexpected outcomes fail the recorder explicitly and
leave the destination file unchanged; this recorder does not export partial
failed runs. A prior successful file must not be mistaken for the failed attempt.

## Admission and measured completion

For command-protocol requests, a positive ACK means the autopilot accepted the
request for execution. It is not a position or landing measurement. The controller
serializes its requests and matches ACK command IDs and source/destination IDs.
MAVLink ACKs do not carry this recorder's local string request IDs. Setup stream
requests are kept out of the flight-command comparison.

`SET_POSITION_TARGET_LOCAL_NED` is a movement message, not a `COMMAND_LONG`
transaction. It has no `COMMAND_ACK`; its inspector must say **not applicable**
instead of treating the missing ACK as a failure or reusing the takeoff ACK.
The requested position is checked using later position telemetry.

The following thresholds are application choices for this small experiment,
not MAVLink protocol guarantees:

| Stage | Required evidence |
| --- | --- |
| Guided | Accepted mode request and a post-request heartbeat with Guided mode. |
| Arm | Accepted normal arm request and a post-request armed heartbeat. |
| Takeoff | Accepted takeoff request; reported altitude above home within 0.35 m of 4 m and reported speed at most 0.4 m/s, sustained for 1 s. |
| Waypoint | Reported local 3D distance to the sent target at most 0.5 m and speed at most 0.4 m/s, sustained for 1 s. |
| Land | Accepted LAND request; after previous in-air evidence, fresh post-LAND reports indicate ON_GROUND and disarmed. |

Height/waypoint dwell is evaluated only on newly received `LOCAL_POSITION_NED`
messages. The velocity vector provides speed. Takeoff also requires a
post-request `GLOBAL_POSITION_INT` relative altitude no more than 500 ms old.
A bad sample or a gap greater than 300 ms resets the dwell. Landing uses both
heartbeat and extended state reports no more than 1,500 ms old, received after
the LAND request. Old initial ground reports cannot prove the final landing.

```text
speed = sqrt(vN² + vE² + vD²)
waypoint_error = ||reported_NED_position - requested_NED_position||
height_error = abs(relative_alt_mm / 1000 - 4 m)
```

The application uses bounded ACK and execution waits: 3 s for an ACK, 30 s for
takeoff execution, 40 s for the waypoint, and 45 s for landing. These budgets
describe the controller, not guaranteed autopilot response times. In this
position-only example there is no implied velocity-stream three-second timeout.

## Coordinates, clocks and information boundaries

`LOCAL_POSITION_NED` reports north, east and down relative to the autopilot's EKF
origin. Down is positive: a higher vehicle normally has a more negative `z`.
For a yard centered on the initial reported position, the display converts:

```text
east  = NED.y - initial_NED.y
north = NED.x - initial_NED.x
up    = -(NED.z - initial_NED.z)
```

The takeoff command's altitude uses **home**, while local NED uses the **EKF
origin** and the displayed yard uses the **initial reported position**. They are
not silently assumed identical. Takeoff completion uses the reported altitude
above home. The local waypoint explicitly adds `[8, 5, -4]` to initial NED.
A takeoff-height marker in the yard is a visual guide, not evidence that these
vertical datums coincide exactly.

`ATTITUDE` supplies roll, pitch and yaw in radians with the aircraft's
forward/right/down body convention. The 3D view transforms the recorded
orientation consistently into east/up/south scene axes. It holds the latest
position and attitude independently, with each receipt age available. Neither
view interpolates a future sample into an earlier cursor or predicts missing
telemetry. Before a channel's first receipt, that channel is unavailable.

`LOCAL_POSITION_NED`, `GLOBAL_POSITION_INT` and `ATTITUDE` are autopilot outputs
from the actual simulation. They are not independent physical truth. No separate
ground-truth accuracy evaluation is supplied. Mode, armed and landed states also
have their own timestamps; an old message is not fresh evidence forever.

Receiver monotonic elapsed time and vehicle boot time have different origins.
Keep both visible but never subtract one from the other as a transport latency.
Playback speed only changes the browser presentation; simulator speedup is fixed
at one for these recordings.

## Replay and inspection

Use play, next event, reset and the time slider to inspect one run. Jump from a
takeoff ACK to measured height completion to see the difference between admission
and execution. Compare the position-only waypoint with the command transactions,
then inspect the landing evidence. Switching case rewinds another independent
recording; switching view preserves the current time and observations.

The page exposes command envelopes, matching ACK result codes, telemetry-derived
stage events, sampled trajectory and attitude, target error, channel ages, mode,
arming, landing state, comparisons and runtime provenance. A completed mission
requires the measured final landing; an active process or positive ACK alone
cannot establish success. Rejected and incomplete outcomes remain explicit.

Imports are bounded to 10 MB and checked for runtime metadata, vehicle identities,
command order and targets, ACK associations, telemetry fields/timing and measured
completion evidence. Consistency checks do not authenticate an external producer.
An invalid import preserves the currently selected recording.

## Record another run

The supplied replay uses the regular web setup. With Docker available:

```sh
npm run record:sitl
npm run compare:sitl -- local/ardupilot-sitl.json
```

The recorder builds an isolated image with the checksum-verified official
ArduCopter executable, upstream quad defaults and pinned Python dependencies.
The actual image, firmware version/hash, parameter file and recorder fingerprints
are recorded. Runtime vehicle parameters are read back, including
`ARMING_SKIPCHK = 0` in this ArduCopter version, meaning checks have not been
skipped. Normal arm requests do not use the force-arm parameter.

The owned simulator and controller communicate inside a container with no
external network or published flight-control port. Each case gets fresh state.
No physical vehicle address is accepted by the recorder. Completion, errors and
interruption clean up its owned processes; the browser itself does not send
commands to any autopilot.

Initial image construction needs network access for the official binary and
dependencies. See the [recorded results](18-sitl-mavlink-results.md) for the
verified platform, actual flight outcomes, resource/setup details and checks.

## Primary sources

- ArduPilot [SITL overview](https://ardupilot.org/dev/docs/sitl-simulator-software-in-the-loop.html)
  describes running autopilot software against simulated sensors and dynamics.
- ArduPilot [Guided commands](https://ardupilot.org/dev/docs/copter-commands-in-guided-mode.html)
  documents the movement messages, local frames and position-only mask 3576.
- The [MAVLink command protocol](https://mavlink.io/en/services/command.html)
  distinguishes acceptance, progress and completion, including ACK matching.
- [MAVLink message definitions](https://mavlink.io/en/messages/common.html#LOCAL_POSITION_NED)
  define filtered local position, attitude, heartbeat and extended system state.
- The [pinned ArduCopter takeoff handler](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/ArduCopter/GCS_MAVLink_Copter.cpp)
  establishes the takeoff request's altitude-above-home handling for this build.
- ArduPilot [LAND mode](https://ardupilot.org/copter/docs/land-mode.html) and
  [normal arming/disarming commands](https://ardupilot.org/dev/docs/mavlink-arming-and-disarming.html)
  provide context for the observed landing and non-forced arm sequence.

These measurements establish this single-vehicle simulated scenario, not a
validation of a real aircraft, arbitrary environment or general flight mission.
