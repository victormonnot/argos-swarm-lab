import { greedyAssignment } from './assignment.js';
import { completionEvidence, nedToEnu, sitlFrame, sitlEvents, resultNames } from './sitl-trace.js';
export { resultNames, landedNames } from './sitl-trace.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const text = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = (condition, message) => { if (!condition) throw new Error(`Invalid fleet trace: ${message}`); };
const close = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance;
const sameVector = (a, b, tolerance = 1e-6) => vector(a) && vector(b) && a.every((value, i) => close(value, b[i], tolerance));
const eventAt = (events, stage, status) => events.find(event => event.stage === stage && event.status === status) ?? null;
const position = sample => [sample.data.x, sample.data.y, sample.data.z];
const TYPES = ['LOCAL_POSITION_NED', 'GLOBAL_POSITION_INT', 'ATTITUDE', 'HEARTBEAT', 'EXTENDED_SYS_STATE'];

/** Supplied frame registration, not a shared localization estimate or world truth. */
export function missionPosition(vehicle, ned) {
  return nedToEnu(ned, vehicle.originNed).map((value, axis) => value + vehicle.padEnu[axis]);
}
export function targetNed(vehicle, targetEnu) {
  const delta = targetEnu.map((value, axis) => value - vehicle.padEnu[axis]);
  return vehicle.originNed.map((value, axis) => value + [delta[1], delta[0], -delta[2]][axis]);
}
const vehicleRun = (run, vehicle) => ({ ...vehicle, config: run.config, endMs: run.endMs, outcome: run.outcome,
  telemetry: vehicle.telemetry.filter(sample => sample.sourceSystem === vehicle.systemId && sample.sourceComponent === vehicle.componentId),
  acks: vehicle.acks.filter(ack => ack.sourceSystem === vehicle.systemId && ack.sourceComponent === vehicle.componentId
    && ack.targetSystem === run.controller.systemId && ack.targetComponent === run.controller.componentId),
});

export function taskCompletionEvidence(run, vehicle, untilMs = run.endMs) {
  const start = eventAt(run.events, 'mission', 'start');
  if (!start) return null;
  const deadline = Math.min(start.timeMs + run.config.missionDurationMs,
    eventAt(run.events, 'mission', 'complete')?.timeMs ?? Infinity, untilMs);
  return completionEvidence(vehicleRun(run, vehicle), 'waypoint', deadline);
}

export function fleetEvents(run) {
  return [
    ...run.vehicles.flatMap(vehicle => sitlEvents(vehicle).map(event => ({ ...event, vehicleId: vehicle.id }))),
    ...run.events.map(data => ({ kind: 'mission', timeMs: data.timeMs, data, vehicleId: null })),
    { kind: 'assignment', timeMs: run.assignmentTimeMs, data: run.assignments, vehicleId: null },
    ...run.resources.map(data => ({ kind: 'resource', timeMs: data.timeMs, data, vehicleId: null })),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

export function fleetFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const start = eventAt(run.events, 'mission', 'start'), end = eventAt(run.events, 'mission', 'complete');
  const deadlineReached = timeMs >= run.missionDeadlineMs;
  const assignments = timeMs >= run.assignmentTimeMs ? run.assignments : [];
  const vehicles = run.vehicles.map(vehicle => {
    const base = sitlFrame(vehicleRun(run, vehicle), timeMs);
    const assignment = assignments.find(row => row.vehicleId === vehicle.id);
    const task = assignment ? run.tasks.find(task => task.id === assignment.taskId) : null;
    const waypoint = base.commands.find(command => command.id === 'waypoint');
    const current = base.positionNed ? missionPosition(vehicle, base.positionNed) : null;
    const evidence = taskCompletionEvidence(run, vehicle, timeMs);
    return { ...base, id: vehicle.id, systemId: vehicle.systemId, componentId: vehicle.componentId,
      port: vehicle.port, pid: vehicle.pid, padEnu: vehicle.padEnu, positionEnu: current,
      trajectoryEnu: base.trajectory.map(sample => ({ timeMs: sample.timeMs, positionEnu: missionPosition(vehicle, position(sample)) })),
      taskId: task?.id ?? null, taskTargetEnu: task?.positionEnu ?? null,
      taskErrorM: task && current ? Math.hypot(...current.map((value, axis) => value - task.positionEnu[axis])) : null,
      taskState: !task ? 'unassigned' : evidence ? 'completed' : deadlineReached ? 'not-reached' : waypoint ? 'sent' : 'assigned',
      taskEvidence: evidence, routeMismatch: Boolean(waypoint && waypoint.targetSystem !== vehicle.systemId),
    };
  });
  return { timeMs, vehicles, assignments,
    mission: { startTimeMs: start && timeMs >= start.timeMs ? start.timeMs : null,
      endTimeMs: deadlineReached ? run.missionDeadlineMs : null,
      windowClosedMs: end && timeMs >= end.timeMs ? end.timeMs : null,
      started: Boolean(start && timeMs >= start.timeMs), ended: deadlineReached },
    tasksCompleted: vehicles.filter(vehicle => vehicle.taskEvidence).length,
    landedVehicles: run.vehicles.filter(vehicle => completionEvidence(vehicleRun(run, vehicle), 'land', timeMs)).length,
    outcome: timeMs >= run.endMs ? run.outcome : null,
  };
}

export function fleetSummary(run) {
  const start = eventAt(run.events, 'mission', 'start'), end = eventAt(run.events, 'mission', 'complete');
  const vehicles = run.vehicles.map(vehicle => {
    const assignment = run.assignments.find(row => row.vehicleId === vehicle.id);
    const waypoint = vehicle.commands.find(command => command.id === 'waypoint');
    const evidence = taskCompletionEvidence(run, vehicle), landed = completionEvidence(vehicleRun(run, vehicle), 'land');
    const samples = vehicle.telemetry.filter(sample => sample.type === 'LOCAL_POSITION_NED' && waypoint
      && sample.timeMs >= waypoint.timeMs && sample.timeMs <= Math.min(end?.timeMs ?? run.endMs, start.timeMs + run.config.missionDurationMs));
    const errors = samples.map(sample => Math.hypot(...position(sample).map((value, axis) => value - waypoint.positionNed[axis])));
    const final = sitlFrame(vehicleRun(run, vehicle), run.endMs);
    return { id: vehicle.id, systemId: vehicle.systemId, taskId: assignment?.taskId ?? null,
      taskCompletedMs: evidence?.timeMs ?? null, waypointSentMs: waypoint?.timeMs ?? null, landedMs: landed?.timeMs ?? null,
      minTaskErrorM: errors.length ? Math.min(...errors) : null, finalMode: final.mode, finalArmed: final.armed,
      routeMismatch: Boolean(waypoint && waypoint.targetSystem !== vehicle.systemId) };
  });
  const completed = vehicles.filter(vehicle => vehicle.taskCompletedMs !== null).length;
  return { dispatchMs: start?.timeMs ?? null, deadlineMs: run.missionDeadlineMs, windowClosedMs: end?.timeMs ?? null,
    tasksCompleted: completed, totalTasks: run.tasks.length,
    landedVehicles: vehicles.filter(vehicle => vehicle.landedMs !== null).length,
    landedMs: vehicles.every(vehicle => vehicle.landedMs !== null) ? Math.max(...vehicles.map(vehicle => vehicle.landedMs)) : null,
    missionStatus: completed === run.tasks.length ? 'completed' : 'partial', vehicles, outcome: run.outcome };
}

export function validateFleetTrace(trace) {
  check(trace?.kind === 'argos-ardupilot-fleet' && trace.schemaVersion === 1, 'unsupported format');
  const rt = trace.runtime;
  check(rt && ['recordedAt', 'ardupilotVersion', 'firmwareGitHash', 'image', 'baseImage', 'python', 'pymavlink'].every(key => text(rt[key]))
    && Number.isFinite(Date.parse(rt.recordedAt)), 'runtime metadata');
  check(['sourceSha256', 'sitlSourceSha256', 'dockerfileSha256', 'binarySha256', 'paramsSha256'].every(key => hash(rt[key])), 'runtime fingerprints');
  check(rt.model === 'quad' && rt.modelArgument === '+' && rt.speedup === 1 && rt.mavlinkVersion === 2
    && rt.transport === 'tcp-loopback' && rt.clock === 'recorder-monotonic-receipt' && rt.platform === 'linux-amd64', 'runtime contract');
  check(rt.vehicleCount === 2 && rt.physics === 'independent-SITL-worlds' && rt.assignment === 'central-nearest-pair-greedy'
    && rt.positionFrame === 'supplied-ENU-layout-from-independent-local-NED'
    && rt.memoryMetric === 'process-VmRSS-KiB-snapshots', 'fleet simulation and observation contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 2, 'one or two recorded cases');
  const caseIds = new Set(), runIds = new Set();
  for (const run of trace.cases) {
    check(run && ['nominal', 'misaddressed'].includes(run.id) && !caseIds.has(run.id) && text(run.label) && text(run.runId, 100) && !runIds.has(run.runId), 'unique case and run identities');
    caseIds.add(run.id); runIds.add(run.runId);
    check(finite(run.endMs) && run.endMs > 0 && run.endMs <= 180000, 'bounded duration');
    const inRun = value => finite(value) && value >= 0 && value <= run.endMs;
    const cfg = run.config;
    const expected = { takeoffAltitudeM: 4, takeoffToleranceM: .35, positionToleranceM: .5, speedToleranceMps: .4,
      dwellMs: 1000, freshnessMs: 500, maxSampleGapMs: 300, heartbeatFreshnessMs: 1500, landedFreshnessMs: 1500,
      ackTimeoutMs: 3000, takeoffTimeoutMs: 30000, landTimeoutMs: 45000, missionDurationMs: 20000 };
    check(cfg && Object.entries(expected).every(([key, value]) => cfg[key] === value), 'fixed task and flight criteria');
    check(run.controller?.systemId === 255 && run.controller.componentId === 190, 'central controller identity');
    check(Array.isArray(run.tasks) && run.tasks.length === 2 && run.tasks.every((task, i) => task.id === `T${i + 1}`
      && sameVector(task.positionEnu, [[-4, 6, 4], [4, 8, 4]][i])), 'two declared visit-and-hold tasks');
    check(Array.isArray(run.vehicles) && run.vehicles.length === 2, 'two vehicle processes');
    check(Array.isArray(run.events) && run.events.length === 2, 'bounded mission window events');
    const missionStart = eventAt(run.events, 'mission', 'start'), missionEnd = eventAt(run.events, 'mission', 'complete');
    check(missionStart && missionEnd && inRun(missionStart.timeMs) && inRun(missionEnd.timeMs)
      && missionEnd.timeMs - missionStart.timeMs >= cfg.missionDurationMs, 'declared observation deadline');
    check(inRun(run.missionDeadlineMs) && close(run.missionDeadlineMs, missionStart.timeMs + cfg.missionDurationMs)
      && missionEnd.timeMs >= run.missionDeadlineMs, 'exact task cutoff precedes observed window closure');
    check(inRun(run.assignmentTimeMs) && run.assignmentTimeMs <= missionStart.timeMs
      && Array.isArray(run.assignments) && run.assignments.length === 2, 'assignment precedes dispatch');
    const pids = new Set();
    for (const [i, vehicle] of run.vehicles.entries()) {
      check(vehicle.id === `A${i + 1}` && vehicle.systemId === i + 1 && vehicle.componentId === 1
        && vehicle.instance === i && vehicle.port === 5760 + i * 10
        && Number.isSafeInteger(vehicle.pid) && vehicle.pid > 0 && !pids.has(vehicle.pid), 'distinct vehicle, process, instance and route identities');
      pids.add(vehicle.pid);
      check(sameVector(vehicle.padEnu, [[-4, 0, 0], [4, 0, 0]][i]) && vector(vehicle.originNed)
        && vehicle.originNed.every(value => Math.abs(value) < 1000) && inRun(vehicle.originTimeMs), 'supplied frame registration');
      const home = [-35.363261, 149.165230 + vehicle.padEnu[0] / (6378137 * Math.cos(-35.363261 * Math.PI / 180)) * 180 / Math.PI, 584, 0];
      check(Array.isArray(vehicle.homeGps) && vehicle.homeGps.length === 4 && vehicle.homeGps.every((value, axis) => finite(value) && close(value, home[axis], 1e-9)), 'declared independent geographic homes');
      check(vehicle.setup && finite(vehicle.setup.durationMs) && vehicle.setup.durationMs > 0
        && Number.isSafeInteger(vehicle.setup.startupTextBytes) && vehicle.setup.startupTextBytes >= 0
        && Number.isSafeInteger(vehicle.setup.autopilotVersion?.flight_sw_version)
        && [24, 16, 8].map(shift => (vehicle.setup.autopilotVersion.flight_sw_version >>> shift) & 255).join('.') === rt.ardupilotVersion, 'setup and actual firmware report');
      const expectedParams = { ARMING_SKIPCHK: 0, FRAME_CLASS: 1, FRAME_TYPE: 0, FS_GCS_ENABLE: 0, FS_THR_ENABLE: 1, SIM_WIND_SPD: 0, MAV_SYSID: vehicle.systemId };
      check(vehicle.parameters && Object.entries(expectedParams).every(([key, value]) => vehicle.parameters[key] === value), 'flight parameter readback');
      check(Array.isArray(vehicle.commands) && vehicle.commands.length === 5, 'five per-vehicle flight requests');
      let previous = -1;
      for (const [j, command] of vehicle.commands.entries()) {
        const [id, number, params] = [['guided', 176, [1, 4, 0, 0, 0, 0, 0]], ['arm', 400, [1, 0, 0, 0, 0, 0, 0]],
          ['takeoff', 22, [0, 0, 0, 0, 0, 0, 4]], ['waypoint', null, null], ['land', 21, [0, 0, 0, 0, 0, 0, 0]]][j];
        check(command && command.id === id && command.command === number && inRun(command.timeMs) && command.timeMs > previous
          && command.routeSystem === vehicle.systemId && command.targetComponent === 1, 'request order and isolated route');
        const wrong = run.id === 'misaddressed' && vehicle.id === 'A1' && id === 'waypoint';
        check(command.targetSystem === (wrong ? 2 : vehicle.systemId), 'only the declared A1 target-system intervention');
        if (id === 'waypoint') {
          const assignment = run.assignments.find(row => row.vehicleId === vehicle.id);
          const task = run.tasks.find(task => task.id === assignment?.taskId);
          check(task && command.taskId === task.id && command.kind === 'setpoint' && command.message === 'SET_POSITION_TARGET_LOCAL_NED'
            && command.frame === 1 && command.mask === 3576 && sameVector(command.positionNed, targetNed(vehicle, task.positionEnu))
            && command.timeMs >= missionStart.timeMs && command.timeMs < missionStart.timeMs + cfg.missionDurationMs, 'position-only task setpoint in its own NED frame');
        } else check(command.kind === 'command' && command.message === 'COMMAND_LONG'
          && Array.isArray(command.params) && command.params.length === 7 && command.params.every((value, axis) => value === params[axis]), 'normal command envelope');
        previous = command.timeMs;
      }
      check(vehicle.commands.at(-1).timeMs >= missionEnd.timeMs, 'landing follows the task observation window');
      check(Array.isArray(vehicle.acks) && vehicle.acks.length <= 20, 'bounded ACKs'); previous = -1;
      const terminal = new Set();
      for (const ack of vehicle.acks) {
        const command = vehicle.commands.find(command => command.id === ack?.commandId);
        check(command && command.kind === 'command' && ack.command === command.command && inRun(ack.timeMs)
          && ack.timeMs >= command.timeMs && ack.timeMs >= previous && ack.sourceSystem === vehicle.systemId && ack.sourceComponent === 1
          && ack.routeSystem === vehicle.systemId && ack.targetSystem === 255 && ack.targetComponent === 190
          && Number.isInteger(ack.result) && Object.hasOwn(resultNames, ack.result), 'per-vehicle ACK association; setpoints have no ACK');
        check(!terminal.has(ack.commandId), 'one terminal ACK per request'); if (ack.result !== 5) terminal.add(ack.commandId);
        previous = ack.timeMs;
      }
      check(Array.isArray(vehicle.telemetry) && vehicle.telemetry.length > 0 && vehicle.telemetry.length <= 15000, 'bounded telemetry'); previous = -1;
      for (const sample of vehicle.telemetry) {
        check(sample && TYPES.includes(sample.type) && inRun(sample.timeMs) && sample.timeMs >= previous
          && sample.sourceSystem === vehicle.systemId && sample.sourceComponent === 1, 'telemetry source and common receipt clock');
        const fields = { LOCAL_POSITION_NED: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'time_boot_ms'],
          GLOBAL_POSITION_INT: ['relative_alt', 'time_boot_ms'], ATTITUDE: ['roll', 'pitch', 'yaw', 'time_boot_ms'],
          HEARTBEAT: ['base_mode', 'custom_mode'], EXTENDED_SYS_STATE: ['landed_state'] }[sample.type];
        check(sample.data && fields.every(key => finite(sample.data[key])), 'finite telemetry fields');
        if ('time_boot_ms' in sample.data) check(Number.isSafeInteger(sample.data.time_boot_ms) && sample.data.time_boot_ms >= 0 && sample.data.time_boot_ms <= 0xffffffff, 'separate vehicle boot clock');
        if (sample.type === 'HEARTBEAT') check(Number.isInteger(sample.data.base_mode) && sample.data.base_mode >= 0 && sample.data.base_mode <= 255
          && Number.isInteger(sample.data.custom_mode) && sample.data.custom_mode >= 0, 'heartbeat fields');
        if (sample.type === 'EXTENDED_SYS_STATE') check(Number.isInteger(sample.data.landed_state) && sample.data.landed_state >= 0 && sample.data.landed_state <= 4, 'landed-state fields');
        previous = sample.timeMs;
      }
      const baseline = vehicle.telemetry.find(sample => sample.type === 'LOCAL_POSITION_NED');
      check(baseline && close(baseline.timeMs, vehicle.originTimeMs) && sameVector(position(baseline), vehicle.originNed), 'first raw local position baseline');
      check(Array.isArray(vehicle.statuses) && vehicle.statuses.length <= 300, 'bounded status text'); previous = -1;
      for (const status of vehicle.statuses) {
        check(status && inRun(status.timeMs) && status.timeMs >= previous && text(status.text, 500)
          && Number.isInteger(status.severity) && status.severity >= 0 && status.severity <= 7, 'status text record'); previous = status.timeMs;
      }
      check(Array.isArray(vehicle.events) && vehicle.events.length === 10, 'one start and result per vehicle stage'); previous = -1;
      const starts = new Map(), terminals = new Map();
      for (const event of vehicle.events) {
        check(event && ['guided', 'arm', 'takeoff', 'waypoint', 'land'].includes(event.stage) && ['start', 'complete', 'timeout'].includes(event.status)
          && inRun(event.timeMs) && event.timeMs >= previous, 'vehicle stage vocabulary and order');
        const map = event.status === 'start' ? starts : terminals;
        check(!map.has(event.stage), 'single per-vehicle stage result'); map.set(event.stage, event);
        if (event.status !== 'start') check(starts.has(event.stage), 'stage result follows its start'); previous = event.timeMs;
      }
      for (const command of vehicle.commands) {
        check(starts.has(command.id) && close(starts.get(command.id).timeMs, command.timeMs) && terminals.has(command.id), 'stage envelope association');
        const result = terminals.get(command.id);
        const evidence = command.id === 'waypoint' ? taskCompletionEvidence(run, vehicle) : completionEvidence(vehicleRun(run, vehicle), command.id);
        if (evidence) check(result.status === 'complete' && close(result.timeMs, evidence.timeMs), 'stage completion needs this vehicle’s fresh telemetry');
        else check(command.id === 'waypoint' && result.status === 'timeout' && close(result.timeMs, missionEnd.timeMs), 'only a bounded unreached task may time out');
      }
      check(terminals.get('guided').timeMs <= vehicle.commands[1].timeMs && terminals.get('arm').timeMs <= vehicle.commands[2].timeMs
        && terminals.get('takeoff').timeMs <= run.assignmentTimeMs, 'dispatch follows measured takeoff for both vehicles');
      const taskEvidence = taskCompletionEvidence(run, vehicle);
      check(vehicle.taskResult?.taskId === vehicle.commands[3].taskId
        && vehicle.taskResult.status === (taskEvidence ? 'reached' : 'not-reached')
        && (taskEvidence ? close(vehicle.taskResult.completedTimeMs, taskEvidence.timeMs) : vehicle.taskResult.completedTimeMs === null), 'reported task result needs its own deadline-limited evidence');
    }
    // Recompute the known allocator from each vehicle's own latest received pose.
    const poses = run.vehicles.map(vehicle => vehicle.telemetry.filter(sample => sample.type === 'LOCAL_POSITION_NED' && sample.timeMs <= run.assignmentTimeMs).at(-1));
    check(poses.every(sample => sample && run.assignmentTimeMs - sample.timeMs <= cfg.freshnessMs), 'assignment needs fresh estimates from both vehicles');
    const positions = poses.map((sample, i) => missionPosition(run.vehicles[i], position(sample)));
    const costs = positions.map(point => run.tasks.map(task => Math.hypot(point[0] - task.positionEnu[0], point[1] - task.positionEnu[1])));
    const pairs = greedyAssignment(costs);
    for (const [i, assignment] of run.assignments.entries()) {
      const [row, column] = pairs[i];
      check(assignment.vehicleId === run.vehicles[row].id && assignment.taskId === run.tasks[column].id
        && close(assignment.costM, costs[row][column], 1e-6) && close(assignment.poseSampleTimeMs, poses[row].timeMs)
        && sameVector(assignment.positionEnu, positions[row]), 'nearest-pair greedy assignment and original pose snapshot');
    }
    check(Array.isArray(run.resources) && run.resources.length >= 1 && run.resources.length <= 100, 'bounded overlap/resource observations');
    let previous = -1;
    for (const sample of run.resources) {
      check(sample && inRun(sample.timeMs) && sample.timeMs >= previous && sample.bothRunning === true
        && Array.isArray(sample.vehicles) && sample.vehicles.length === 2, 'observed concurrent processes');
      check(sample.vehicles.every((entry, i) => entry.id === run.vehicles[i].id && entry.pid === run.vehicles[i].pid
        && Number.isSafeInteger(entry.rssKiB) && entry.rssKiB > 0), 'per-process observed resident memory'); previous = sample.timeMs;
    }
    check(run.resources.some(sample => sample.timeMs >= missionStart.timeMs && sample.timeMs <= missionEnd.timeMs), 'process overlap during mission');
    const summary = fleetSummary(run), count = run.id === 'nominal' ? 2 : 1;
    check(summary.tasksCompleted === count && summary.landedVehicles === 2
      && run.outcome?.status === (count === 2 ? 'completed' : 'partial') && run.outcome.tasksCompleted === count
      && run.outcome.landedVehicles === 2 && text(run.outcome.reason), 'task completion and fleet landing are separate outcomes');
    if (run.id === 'misaddressed') check(summary.vehicles[0].taskCompletedMs === null && summary.vehicles[1].taskCompletedMs !== null, 'bounded A1 failure with A2 completion');
  }
  return trace;
}
