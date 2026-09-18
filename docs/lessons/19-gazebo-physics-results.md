# Gazebo external physics: recorded results

Recorded on **2026-09-18** with the implementation in
[the workshop specification](19-gazebo-physics.md). The bundled
[JSON recording](../results/ardupilot-gazebo.json) contains two actual, independent
Gazebo/ArduPilot flights. Each completes takeoff, a fixed observation interval,
landing and disarming. The comparison changes only the bounded external-force
intervention.

## Runtime and physics boundary

The verified Linux amd64 stack uses **Gazebo Harmonic 8.15.0**, **gz-physics
7.8.0 / DART**, **Transport 13.6.0**, Python message bindings **10.4.0**,
**ArduCopter 4.7.1**, **Python 3.10.12** and **pymavlink 2.4.49**.
The official ArduPilot Gazebo plugin revision is
`082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5`.

The world uses the upstream Iris X-frame rotor/lift-drag model, a physical ground
plane and no obstacles. Its initial model pose is `[0, 0, 0.195]` m in world ENU,
with yaw 90° facing north. The world selects the DART physics engine explicitly,
with 1 ms integration steps and a requested real-time factor of one. Only the
unmodified official `ArduPilotPlugin` target and the lab's small experiment
observer are built; camera, gimbal, parachute and GUI plugins are not used.

The Iris integration is configured with `lock_step=1` and `no_time_sync=0`.
Actual parameter readback confirms `AHRS_EKF_TYPE=3`, `EK3_ENABLE=1`,
`ARMING_SKIPCHK=0`, `FRAME_CLASS=1`, `FRAME_TYPE=1`, `SIM_SPEEDUP=1`,
`SIM_WIND_SPD=0`, `FS_GCS_ENABLE=0` and `FS_THR_ENABLE=1` in both runs.
Normal arm requests do not force arming. This experiment does not test a GCS
heartbeat failsafe.

World position, quaternion and velocity come from the IMU link's **world** pose.
Force is applied to the base link at its center of mass. These distinct links
and the frame conversion are recorded explicitly. Controller takeoff/landing
criteria use MAVLink telemetry; the evaluator's world position is not a hidden
flight-completion input.

| Provenance item | Recorded value |
| --- | --- |
| Executed image ID | `sha256:bbc7a99a3b20122a31b957c7b7c5db4df7fd9e2f62a1088bc928e15e12590244` |
| Base image | `ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02` |
| ArduPilot Git revision | `dbe792162d06cab66c3475fd5556bf7a120f119e` |
| ArduPilot binary SHA-256 | `011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482` |
| Recorder source SHA-256 | `8913a04be18a95ebb8a0789c72f368ffe4f222da0d337dcddefa0351647e0ae6` |
| Experiment observer SHA-256 | `f1313427555e59ac82dc073f63023c70be9efb58cecc97bf8ad521c1e34271c2` |
| World SHA-256 | `6c410e91c0e69507d2a641b2f9951f0362f2fffec4540d2cd71620e41a788eed` |

The JSON also records the shared MAVLink helper, upstream parameter files,
overrides, prepared model and build-file fingerprints. The Ubuntu base, direct
core package versions, firmware and plugin source are pinned. Transitive Ubuntu
packages do not come from a frozen repository snapshot; the Dockerfile alone
does not guarantee a bit-identical future image. The recorded image ID identifies
the image actually executed here.

Docker reports a local image size of **2,105,408,538 bytes**, about **1.96 GiB**.
The first build needs network access to install and compile the external stack.
Fresh simulator/estimator setup took about **43.8–43.9 s** per case, followed by
about **39.3 s** of recorded flight. The bundled JSON is **1,255,959 bytes**.
These are observations of this run, not CPU, memory or download-volume benchmarks.
The web viewer needs none of the external simulation packages installed on its
host.

## Measured comparison

The evaluator's interval starts at the simulator-clock observation saved with
the hover-start event and ends twelve simulation seconds later. A receipt-time
end marker can occur slightly after that boundary. The peak and recovery
calculations exclude samples beyond the declared simulation interval.

| Observation | Nominal hover | Eastward force pulse |
| --- | --- | --- |
| External pulse | None | 8 N for 1 simulation second |
| Applied physics steps | 0 | 1,000 |
| Accumulated impulse / ENU | `[0, 0, 0]` N·s | `[8, 0, 0]` N·s |
| Sampled maximum horizontal deviation | 0.0655 m | 1.4087 m |
| Sampled maximum world tilt from vertical | 0.474° | 29.968° |
| Horizontal return criterion after release | Not applicable | 4.750 simulation seconds |
| Final flight evidence | On ground and disarmed | On ground and disarmed |
| MAVLink telemetry / world observations | 1,417 / 786 | 1,417 / 787 |

The force-case deviation peaks **250 simulation milliseconds after release**.
At the first inactive-force sample, eastward velocity is still about **1.364 m/s**.
Removing a force does not instantaneously remove the vehicle's velocity. The
subsequent controller response brings the vehicle back within the configured
horizontal distance and speed thresholds.

The return criterion requires horizontal distance at most 0.35 m from the
initial world reference and full world speed at most 0.25 m/s for one simulation
second, using new observations strictly after release. Gaps above 150 simulation
milliseconds reset the dwell. This is a bounded measured return, not a statement
that every flight state or arbitrary disturbance has been recovered from.

For the pulse recording, receipt-relative landmarks are:

| Event | Recorder time | Gazebo simulation time, when applicable |
| --- | --- | --- |
| Takeoff settling observed | 8.520 s | Separate MAVLink receipt criterion |
| Hover observation starts | 8.570 s | 50.251 s |
| Force request published | 10.520 s | Separate application request |
| Applied force first observed | 10.520 s | 52.260 s |
| Force release first observed | 11.520 s | 53.260 s |
| Peak displacement sample | 11.770 s | 53.510 s |
| Horizontal return established | 16.271 s | 58.010 s |
| Hover observation ends | 20.582 s | 62.260 s |
| Landing and disarming observed | 38.303 s | Separate MAVLink receipt criterion |

The nominal run reports landing/disarming at 38.305 receipt-relative seconds.
Clock origins differ; the table does not measure transport latency by subtracting
its two time columns. The displayed estimate/world separation likewise compares
independently held samples after fixed baseline alignment. It is not a synchronized
localization-accuracy metric.

A second collection from the same final sources and image also completed both
cases. Its nominal/pulse peaks were **0.0614 m / 1.3793 m**, with measured horizontal
return **4.700 simulation seconds** after release and the same **8 N·s / 1,000
steps**. The two collection containers overlapped in wall time but used isolated
processes and networks. This verifies another functional run; it is not a timing
benchmark, deterministic replay guarantee or statistical robustness estimate.

## Reproduction and verification

```sh
npm run record:gazebo
npm run compare:gazebo -- local/ardupilot-gazebo.json
```

The wrapper builds the image, then runs Gazebo and SITL with `--network none`
and no published ports. A recording is validated against its runtime sources
before atomically replacing the destination. Errors and incomplete flights leave
the previous file unchanged; the recorder does not export partial failures.

Checks actually run:

- Both final-source collections passed independent JavaScript validation and
  comparison. All six Gazebo source/build fingerprints and the shared SITL
  helper fingerprint match their recorded values.
- `npm test`: **316/316 passed**, including sixteen Gazebo properties covering
  coordinate/body transforms, clock boundaries, raw application counters and
  impulse, independent sample holding, recovery dwell/gaps and inconsistent imports.
- Existing Python checks: **31 ROS + 9 SITL passed**. The final Gazebo image ran
  **10/10 recorder checks**, covering truth fields, orientation, pulse timing,
  model configuration and process cleanup behavior.
- The nine focused Gazebo Chromium tests passed: phase navigation, applied
  force/recovery, baseline switching, 2D/3D and context loss, clock inspection,
  playback, invalid/valid imports and a 390 px layout.
- The complete Chromium suite passed **144/144 tests** in 2.4 minutes, including
  the nine Gazebo checks and regression coverage of the previous workshops.
- An actual SIGINT check while both Gazebo and SITL were active exited 130,
  wrote no output recording and removed the owned container. Completed capture
  containers were also cleaned up.
- `npm run build` passed with nineteen HTML entries. The embedded Gazebo trace
  yields a page chunk of about 1.18 MB minified / 289 kB gzip. Vite emits a bundle
  size advisory; no browser dependency was added.
- The production preview passed a separate Chromium 153 smoke check of nineteen
  routes, both views/cameras, force/peak/return shortcuts and desktop/mobile layout.
  No page, console or HTTP errors were observed. Scene screenshots were inspected.

These observations establish the stated response in this particular simulated
model. Real wind, obstacle avoidance, hardware control, radio faults, estimator
accuracy and stronger force limits require separate experiments. The browser's
service structures and markings are visual context, not hidden collision geometry.
