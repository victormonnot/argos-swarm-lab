# Lesson 19 — ArduPilot with Gazebo external physics

**Question:** how does a flight controller react when the simulated world pushes
the vehicle away from its requested position?

One **ArduCopter SITL** process controls an **Iris quadrotor in Gazebo Harmonic**.
Gazebo integrates the rigid-body dynamics, rotor forces and ground contact.
The official **ArduPilot Gazebo plugin** exchanges motor commands and simulated
sensor/state data through the **JSON simulator interface**. A separate pymavlink
controller requests Guided mode, normal arming, a four-meter takeoff and LAND.

Compare the same stationary flight with and without a one-second lateral force
pulse. The browser replays actual recordings. It shows both world observations
and autopilot telemetry without running a second flight model.

## Method profile

| Aspect | Implemented choice | Meaning |
| --- | --- | --- |
| Physics simulator | Gazebo Harmonic / DART | An external world integrates motion and contact at a configured 1 ms step. |
| Autopilot | ArduCopter 4.7.1 SITL | The actual autopilot handles estimation, stabilization and Guided flight. |
| Vehicle | Upstream Iris X-frame model | Rotor/lift-drag dynamics and a collidable ground plane replace workshop 18's built-in vehicle model. |
| Integration | Official ArduPilot Gazebo plugin, JSON backend | Motor outputs and simulator data cross the autopilot/simulator boundary; no ROS bridge is required. |
| Estimator | EKF3, `AHRS_EKF_TYPE=3` | The autopilot's telemetry is produced with its sensor estimator enabled. |
| Mission logic | Sequential stages, MAVLink 2 feedback | Commands advance using the same explicit takeoff/landing evidence as workshop 18. |
| Disturbance | 8 N eastward at the base link's center of mass for 1 simulation second | A small experiment system applies a physical force; it is not a velocity command, wind model or position teleport. |
| Observer | Gazebo IMU-link world pose and velocity | Separate evaluator observations expose motion in the simulated world. The mission controller does not use world position for flight completion. |
| Timing | Lockstep simulator exchange, separate clocks | Physics time, vehicle boot time and recorder receipt time retain their distinct meanings. |

This is a software integration and feedback experiment, not a new swarm
coordination algorithm. The autopilot closes its existing control loops; the
experiment does not replace them with a browser controller.

## Two fresh simulations

Both cases start with fresh Gazebo and ArduPilot processes, identical model and
parameter files, the same initial pose, and normal arming checks enabled.

1. Observe Guided mode and an armed heartbeat after accepted requests.
2. Request takeoff to four meters above home. Wait for the same fresh height,
   speed and receipt-time dwell criteria used in workshop 18.
3. Observe twelve **simulation seconds** of stationary Guided flight. Takeoff
   retains the horizontal position; no waypoint, planner or new position target
   is sent during this interval.
4. In the pulse case only, request the disturbance after two simulation seconds
   of this interval. The Gazebo system applies it once for one simulation second.
5. After the observation interval, request LAND and require fresh on-ground and
   disarmed telemetry following an earlier airborne report.

The nominal case applies no disturbance. The pulse case uses the same autopilot
and observation duration. This comparison measures one bounded response; it
does not rank controllers or establish rejection of arbitrary disturbances.

Takeoff completion uses new `LOCAL_POSITION_NED` samples, reported speed at most
0.4 m/s, fresh post-request `GLOBAL_POSITION_INT` altitude within 0.35 m of four
meters, and a one-second dwell. Altitude age must be at most 500 ms; a bad sample
or position-receipt gap above 300 ms resets the dwell. The dwell here uses recorder
receipt time. Landing requires fresh post-LAND heartbeat and extended landed
state, each at most 1,500 ms old. See the
[preceding command-feedback lesson](18-sitl-mavlink.md) for these shared rules.

The experiment harness uses Gazebo's observed clock to schedule the twelve-second
window and perturbation request. It does not use world pose to decide whether
takeoff or landing succeeded. A force-request publication is also distinct from
the simulator's later application of that force.

## Applied force and measured response

`gazebo/TruthObserver.cc` is a small Gazebo system with two responsibilities:

- In `PreUpdate`, it accepts at most one disturbance request per fresh world.
  During the bounded interval it calls `Link::AddWorldForce` each physics step
  with `[8, 0, 0]` N in world east/north/up coordinates, at the base link's center
  of mass. It counts applied steps and accumulates force times step duration.
- In `PostUpdate`, it publishes the IMU link's **world** position, orientation and
  velocity, simulation timestamp, force used in that update, active flag, applied
  step count and accumulated impulse. Observations arrive at 20 Hz, with extra
  samples at pulse transitions. The first inactive sample marks release.

```text
impulse = sum(applied_world_force × physics_step_duration)
horizontal_deviation = sqrt((east − initial_east)² + (north − initial_north)²)
```

Force metadata reports what this system applied during the recorded physics
update, rather than merely what the controller published. It is not a force
sensor reading or an assertion that every other force on the vehicle is zero.
The intended pulse integrates to `[8, 0, 0]` N·s over 1,000 one-millisecond steps.

The evaluator compares sampled peak horizontal deviation during the twelve-second
hover window. For the pulse case, **horizontal return** requires world horizontal
distance to the initial reference at most **0.35 m** and full world speed at most
**0.25 m/s**, continuously observed for **one simulation second after release**.
A bad sample or simulation-time gap above **150 ms** resets this dwell. The search
ends exactly twelve simulation seconds after the hover-start clock observation,
even if the receipt-time hover-end event slightly overshoots that boundary.
No observation means no proven return within that
window; advancing the replay cursor cannot manufacture missing evidence.

Horizontal return is a separate evaluator criterion, not a LAND completion or a
guarantee that altitude, attitude and every controller state have returned to
their initial values. Height and attitude remain inspectable separately. A
sampled peak also need not equal the exact maximum between observations.

## State, coordinates and clocks

Gazebo world coordinates are **east, north, up (ENU)**. The recorded world pose
belongs to `iris::iris_with_standoffs::imu_link`, the link used by the integration,
rather than a nested pose relative to its parent. Its quaternion is stored in
**x, y, z, w** order, with a forward/left/up (FLU) body convention.

MAVLink `LOCAL_POSITION_NED` uses **north, east, down** relative to the autopilot's
local estimator origin. The display applies a fixed translation using the two
grounded baseline samples:

```text
estimated_world_ENU = initial_world_ENU + [ΔNED.y, ΔNED.x, −ΔNED.z]
```

The baseline receipt timestamps are saved individually. This is a display-frame
alignment, not a continuing localization correction. `ATTITUDE` roll/pitch/yaw
uses a forward/right/down body and NED reference; the view converts it into the
same ENU/FLU convention as world pose. It never compares quaternions from different
body conventions as if they were interchangeable.

Both views hold each channel's latest received sample independently. The solid
vehicle shows world pose; the optional ghost shows the transformed estimate.
Their visible separation includes sampling and receipt skew. It is labeled
**held-sample separation**, with channel ages and receipt-time difference. It is
not a time-aligned localization-error measurement. No future samples or invented
interpolation fill gaps in either stream.

The four-meter takeoff request uses altitude **above home**. Gazebo's height is
**world up**, and the local estimator has its own vertical origin. The scene's
initial-world-height plus four-meter marker is an approximate guide; it is not
used to validate takeoff. The actual ground collision is at world up zero.
The visual yard, markings and service structures are illustrative; the recorded
world contains a ground plane and the vehicle, with no obstacle course.

The replay cursor uses recorder-relative monotonic receipt time. World messages
also carry absolute Gazebo simulation time; MAVLink messages can carry vehicle
boot time. Do not subtract these clocks to infer network latency. Lockstep keeps
the simulator/autopilot exchange coordinated, but does not guarantee an exact
real-time factor. Playback speed changes presentation only.

The model explicitly enables `lock_step=1`, sets `no_time_sync=0`, and verifies
actual `AHRS_EKF_TYPE=3` and `EK3_ENABLE=1`. This matters because the pinned
ArduPilot JSON backend can select a direct simulator-truth estimator when time
synchronization is disabled. EKF3 is not independent of the simulated world:
its inputs still originate from the simulation.

## Replay and reproduce

Use play/pause, event stepping, the receipt-time slider and phase shortcuts.
Inspect force onset, release, displacement and the measured return criterion.
Switch cases to compare independent recordings, or switch views without
changing the cursor. Inspect requests, matching ACKs, world samples, telemetry
ages and runtime fingerprints.

With Docker available on a supported Linux amd64 host:

```sh
npm run record:gazebo
npm run compare:gazebo -- local/ardupilot-gazebo.json
```

The first image build downloads the pinned official firmware, Gazebo dependencies
and ArduPilot Gazebo plugin, then builds the integration and experiment observer.
The recording runs headlessly inside a container with no external network and no
published vehicle-control port. Fresh cases own and clean up their processes.
No physical vehicle endpoint is accepted.

Import the generated JSON in `/gazebo/`, or use the bundled recording without
Docker. Imports are limited to 10 MB and checked for identities, clocks, frame
baselines, command associations, flight completion and applied disturbance
consistency. These checks do not authenticate the producer of an external file.
Invalid imports preserve the current recording. Runtime errors and incomplete
flights fail without replacing the previous output; partial failed runs are not
exported. See the [recorded results](19-gazebo-physics-results.md) for actual
versions, measurements, resource observations and completed verification.

## Primary references

- ArduPilot's [Gazebo integration guide](https://ardupilot.org/dev/docs/sitl-with-gazebo.html)
  and [pinned official plugin](https://github.com/ArduPilot/ardupilot_gazebo/tree/082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5)
  describe the external simulator and JSON connection.
- The [Harmonic installation documentation](https://gazebosim.org/docs/harmonic/install_ubuntu/)
  identifies supported Ubuntu distributions and official packages.
- Gazebo's [Link API](https://gazebosim.org/api/sim/8/classgz_1_1sim_1_1Link.html)
  defines world pose, velocity and force application at the center of mass.
- The [pinned Iris model](https://github.com/ArduPilot/ardupilot_gazebo/blob/082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5/models/iris_with_ardupilot/model.sdf)
  defines the vehicle, sensor links, coordinate transforms and plugin parameters.
- ArduPilot's [pinned JSON backend](https://github.com/ArduPilot/ardupilot/blob/dbe792162d06cab66c3475fd5556bf7a120f119e/libraries/SITL/SIM_JSON.cpp)
  provides the synchronization and estimator-selection behavior behind the
  explicitly verified configuration.

This experiment evaluates one simulated force response. It does not validate
real-aircraft operation, realistic wind, collision avoidance, sensor accuracy or
general disturbance robustness.
