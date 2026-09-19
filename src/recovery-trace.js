import { greedyAssignment } from './assignment.js';
import { completionEvidence, sitlFrame, sitlEvents, resultNames } from './sitl-trace.js';
import { missionPosition, targetNed } from './fleet-trace.js';
export { missionPosition, targetNed } from './fleet-trace.js';
export { resultNames, landedNames } from './sitl-trace.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const text = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const close = (a, b, tolerance = 1e-3) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const sameVector = (a, b) => vector(a) && vector(b) && a.every((value, i) => close(value, b[i], 1e-6));
const check = (condition, message) => { if (!condition) throw new Error(`Invalid recovery trace: ${message}`); };
const position = sample => [sample.data.x, sample.data.y, sample.data.z];
const TYPES = ['LOCAL_POSITION_NED', 'GLOBAL_POSITION_INT', 'ATTITUDE', 'HEARTBEAT', 'EXTENDED_SYS_STATE'];
const vehicleRun = (run, vehicle) => ({ ...vehicle, config: run.config, endMs: run.endMs, outcome: run.outcome,
  telemetry: vehicle.telemetry.filter(sample => sample.sourceSystem === vehicle.systemId && sample.sourceComponent === vehicle.componentId),
  acks: vehicle.acks.filter(ack => ack.sourceSystem === vehicle.systemId && ack.sourceComponent === vehicle.componentId
    && ack.targetSystem === run.controller.systemId && ack.targetComponent === run.controller.componentId),
});
export function flightCompletionEvidence(run, vehicle, stage, untilMs = run.endMs) {
  return completionEvidence(vehicleRun(run, vehicle), stage, untilMs);
}
/** A cancelled attempt cannot accumulate later dwell or lend its dwell to another owner. */
export function attemptCompletionEvidence(run, attempt, untilMs = run.endMs) {
  const vehicle = run.vehicles.find(vehicle => vehicle.id === attempt.vehicleId);
  const command = vehicle?.commands.find(command => command.id === attempt.commandId);
  if (!command || command.timeMs > untilMs) return null;
  const adapted = vehicleRun(run, vehicle);
  adapted.commands = [{ ...command, id: 'waypoint' }];
  if (attempt.cancelledTimeMs !== null) adapted.telemetry = adapted.telemetry.filter(sample => sample.timeMs < attempt.cancelledTimeMs);
  return completionEvidence(adapted, 'waypoint', Math.min(untilMs, run.missionDeadlineMs));
}

export function recoveryEvents(run) {
  return [
    ...run.vehicles.flatMap(vehicle => sitlEvents(vehicle).map(event => ({ ...event, vehicleId: vehicle.id }))),
    ...run.events.map(data => ({ kind: 'mission', timeMs: data.timeMs, data, vehicleId: null })),
    ...run.taskEvents.map(data => ({ kind: 'task', timeMs: data.timeMs, data, vehicleId: data.vehicleId })),
    ...run.assignments.map(data => ({ kind: 'assignment', timeMs: data.timeMs, data, vehicleId: null })),
    ...run.btTicks.map(data => ({ kind: 'tick', timeMs: data.timeMs, data, vehicleId: null })),
    ...run.resources.map(data => ({ kind: 'resource', timeMs: data.timeMs, data, vehicleId: null })),
  ].sort((a, b) => a.timeMs - b.timeMs);
}
function tasksAt(run, timeMs) {
  const tasks = run.tasks.map(task => ({ ...task, state: 'pending', ownerId: null, attemptId: null, completedTimeMs: null, reassignments: 0 }));
  const assigned = new Set();
  for (const event of run.taskEvents) {
    if (event.timeMs > timeMs) break;
    const task = tasks.find(task => task.id === event.taskId);
    if (event.type === 'assigned') {
      if (assigned.has(task.id)) task.reassignments += 1;
      assigned.add(task.id); Object.assign(task, { state: 'assigned', ownerId: event.vehicleId, attemptId: event.attemptId });
    } else if (event.type === 'completed') Object.assign(task, { state: 'completed', completedTimeMs: event.timeMs });
    else if (event.type === 'locked') task.state = 'locked';
    else if (event.type === 'released') Object.assign(task, { state: 'pending', ownerId: null, attemptId: null });
  }
  for (const task of tasks) {
    if (task.state === 'assigned') {
      const attempt = run.attempts.find(attempt => attempt.id === task.attemptId);
      if (attempt.sentTimeMs !== null && attempt.sentTimeMs <= timeMs) task.state = 'executing';
    }
  }
  return tasks;
}
export function recoveryFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const tasks = tasksAt(run, timeMs), tick = run.btTicks.filter(tick => tick.timeMs <= timeMs).at(-1);
  const past = value => value !== null && value <= timeMs ? value : null;
  const withdrawal = { ...run.withdrawal };
  for (const key of ['triggerTimeMs', 'requestedTimeMs', 'landedTimeMs', 'releasedTimeMs']) withdrawal[key] = past(withdrawal[key]);
  const cancelled = run.attempts.find(attempt => attempt.cancelledTimeMs !== null && attempt.cancelledTimeMs <= timeMs);
  withdrawal.taskId = cancelled?.taskId ?? null; withdrawal.attemptId = cancelled?.id ?? null;
  const vehicles = run.vehicles.map(vehicle => {
    const base = sitlFrame(vehicleRun(run, vehicle), timeMs);
    const task = tasks.find(task => task.ownerId === vehicle.id && ['assigned', 'executing', 'locked'].includes(task.state));
    const attempt = task ? run.attempts.find(attempt => attempt.id === task.attemptId) : null;
    const bt = tick?.vehicles.find(row => row.vehicleId === vehicle.id);
    const point = base.positionNed ? missionPosition(vehicle, base.positionNed) : null;
    const retired = vehicle.id === withdrawal.vehicleId && withdrawal.landedTimeMs !== null;
    return { ...base, id: vehicle.id, systemId: vehicle.systemId, componentId: vehicle.componentId,
      port: vehicle.port, pid: vehicle.pid, padEnu: vehicle.padEnu, positionEnu: point,
      trajectoryEnu: base.trajectory.map(sample => ({ timeMs: sample.timeMs, positionEnu: missionPosition(vehicle, position(sample)) })),
      taskId: task?.id ?? null, taskTargetEnu: task?.positionEnu ?? null,
      targetNed: attempt ? [...attempt.positionNed] : null,
      taskErrorM: point && task ? Math.hypot(...point.map((value, axis) => value - task.positionEnu[axis])) : null,
      taskState: retired ? 'retired' : task?.state ?? 'idle',
      completedTasks: tasks.filter(task => task.state === 'completed' && task.ownerId === vehicle.id).map(task => task.id),
      bt: bt ? { ...bt, timeMs: tick.timeMs, index: tick.index } : null,
    };
  });
  const started = run.missionStartMs <= timeMs, completed = past(run.missionCompletedMs);
  const closed = timeMs >= run.missionClosedMs;
  return { timeMs, vehicles, tasks, assignments: run.assignments.filter(row => row.timeMs <= timeMs),
    attempts: run.attempts.filter(a => a.assignedTimeMs <= timeMs).map(a => ({ id: a.id, vehicleId: a.vehicleId, taskId: a.taskId,
      assignedTimeMs: a.assignedTimeMs, commandId: a.commandId, sentTimeMs: past(a.sentTimeMs),
      completedTimeMs: past(a.completedTimeMs), cancelledTimeMs: past(a.cancelledTimeMs), releasedTimeMs: past(a.releasedTimeMs),
      status: past(a.completedTimeMs) !== null ? 'completed' : past(a.cancelledTimeMs) !== null ? 'cancelled' : closed ? 'timeout' : past(a.sentTimeMs) !== null ? 'executing' : 'assigned',
    })), withdrawal,
    mission: { started, closed, startTimeMs: started ? run.missionStartMs : null, closedTimeMs: closed ? run.missionClosedMs : null,
      completedTimeMs: completed, elapsedMs: started ? Math.max(0, Math.min(timeMs, completed ?? run.missionDeadlineMs) - run.missionStartMs) : 0 },
    tasksCompleted: tasks.filter(task => task.state === 'completed').length,
    landedVehicles: run.vehicles.filter(vehicle => flightCompletionEvidence(run, vehicle, 'land', timeMs)).length,
    outcome: timeMs >= run.endMs ? run.outcome : null,
  };
}
export function recoverySummary(run) {
  const completed = run.attempts.map(attempt => ({ attempt, evidence: attemptCompletionEvidence(run, attempt) })).filter(row => row.evidence);
  const cancelled = run.attempts.filter(attempt => attempt.cancelledTimeMs !== null);
  const reassigned = run.attempts.filter(attempt => run.attempts.some(previous => previous.taskId === attempt.taskId && previous.assignedTimeMs < attempt.assignedTimeMs));
  const vehicles = run.vehicles.map(vehicle => ({ id: vehicle.id,
    completedTasks: completed.filter(row => row.attempt.vehicleId === vehicle.id).map(row => row.attempt.taskId),
    landedMs: flightCompletionEvidence(run, vehicle, 'land')?.timeMs ?? null }));
  return { missionStartMs: run.missionStartMs, missionCompletedMs: run.missionCompletedMs,
    missionElapsedMs: run.missionCompletedMs === null ? null : run.missionCompletedMs - run.missionStartMs,
    firstDispatchMs: Math.min(...run.attempts.map(attempt => attempt.sentTimeMs).filter(finite)),
    withdrawalMs: run.withdrawal.requestedTimeMs, withdrawalLandedMs: run.withdrawal.landedTimeMs,
    releaseMs: run.withdrawal.releasedTimeMs, reassignmentMs: reassigned[0]?.assignedTimeMs ?? null,
    landedMs: vehicles.every(vehicle => vehicle.landedMs !== null) ? Math.max(...vehicles.map(vehicle => vehicle.landedMs)) : null,
    tasksCompleted: new Set(completed.map(row => row.attempt.taskId)).size, totalTasks: run.tasks.length,
    landedVehicles: vehicles.filter(vehicle => vehicle.landedMs !== null).length,
    cancellations: cancelled.length, reassignments: reassigned.length, vehicles, outcome: run.outcome };
}

export const RECOVERY_TREE = [
  { id: 'root', label: 'Reactive priority', type: 'fallback', parent: null },
  { id: 'withdraw', label: 'Withdraw safely', type: 'sequence', parent: 'root' },
  { id: 'withdrawRequested', label: 'Withdrawal requested?', type: 'condition', parent: 'withdraw' },
  { id: 'withdrawLand', label: 'Land and confirm', type: 'action', parent: 'withdraw' },
  { id: 'cleanup', label: 'Finish flight', type: 'sequence', parent: 'root' },
  { id: 'missionClosed', label: 'Mission closed?', type: 'condition', parent: 'cleanup' },
  { id: 'cleanupLand', label: 'Land and confirm', type: 'action', parent: 'cleanup' },
  { id: 'execute', label: 'Execute mission', type: 'sequence', parent: 'root' },
  { id: 'guided', label: 'Ensure Guided', type: 'action', parent: 'execute' },
  { id: 'arm', label: 'Arm normally', type: 'action', parent: 'execute' },
  { id: 'takeoff', label: 'Take off and settle', type: 'action', parent: 'execute' },
  { id: 'work', label: 'Work or wait', type: 'fallback', parent: 'execute' },
  { id: 'assigned', label: 'Assigned work', type: 'sequence', parent: 'work' },
  { id: 'hasTask', label: 'Has active attempt?', type: 'condition', parent: 'assigned' },
  { id: 'task', label: 'Visit and hold', type: 'action', parent: 'assigned' },
  { id: 'wait', label: 'Wait for assignment', type: 'action', parent: 'work' },
];
/** Independently evaluate the recorded control-flow input, without issuing commands. */
export function expectedRecoveryTick(inputs) {
  const visited = [];
  const leaf = id => ({ withdrawRequested: inputs.withdrawRequested ? 'SUCCESS' : 'FAILURE',
    missionClosed: inputs.missionClosed ? 'SUCCESS' : 'FAILURE', hasTask: inputs.attemptId !== null ? 'SUCCESS' : 'FAILURE',
    guided: inputs.guidedDone ? 'SUCCESS' : 'RUNNING', arm: inputs.armedDone ? 'SUCCESS' : 'RUNNING',
    takeoff: inputs.takeoffDone ? 'SUCCESS' : 'RUNNING', task: inputs.taskDone ? 'SUCCESS' : 'RUNNING',
    withdrawLand: inputs.landed ? 'SUCCESS' : 'RUNNING', cleanupLand: inputs.landed ? 'SUCCESS' : 'RUNNING', wait: 'RUNNING' })[id];
  function visit(node) {
    const row = { id: node.id, status: null }; visited.push(row);
    const children = RECOVERY_TREE.filter(child => child.parent === node.id);
    if (node.type === 'sequence' || node.type === 'fallback') {
      row.status = node.type === 'sequence' ? 'SUCCESS' : 'FAILURE';
      for (const child of children) {
        row.status = visit(child);
        if (row.status !== (node.type === 'sequence' ? 'SUCCESS' : 'FAILURE')) break;
      }
    } else row.status = leaf(node.id);
    return row.status;
  }
  const status = visit(RECOVERY_TREE[0]);
  return { visited, status };
}

export function validateRecoveryTrace(trace) {
  check(trace?.kind === 'argos-ardupilot-recovery' && trace.schemaVersion === 1, 'unsupported format');
  const rt = trace.runtime;
  check(rt && ['recordedAt', 'ardupilotVersion', 'firmwareGitHash', 'image', 'baseImage', 'python', 'pymavlink', 'binaryUrl'].every(key => text(rt[key]))
    && Number.isFinite(Date.parse(rt.recordedAt)), 'runtime metadata');
  check(['sourceSha256', 'sitlSourceSha256', 'fleetSourceSha256', 'dockerfileSha256', 'binarySha256', 'paramsSha256'].every(key => hash(rt[key])), 'runtime fingerprints');
  check(rt.model === 'quad' && rt.modelArgument === '+' && rt.speedup === 1 && rt.mavlinkVersion === 2
    && rt.transport === 'tcp-loopback' && rt.clock === 'recorder-monotonic-receipt' && rt.platform === 'linux-amd64', 'runtime contract');
  check(rt.vehicleCount === 3 && rt.physics === 'independent-SITL-worlds' && rt.assignment === 'central-online-nearest-pair-greedy'
    && rt.behaviorTree === 'reactive-fallback-sequence' && rt.positionFrame === 'supplied-ENU-layout-from-independent-local-NED'
    && rt.memoryMetric === 'process-VmRSS-KiB-snapshots', 'simulation and coordinator contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 2, 'one or two recorded cases');
  const ids = new Set(), runs = new Set();
  for (const run of trace.cases) {
    check(run && ['nominal', 'withdrawal'].includes(run.id) && !ids.has(run.id) && text(run.label)
      && text(run.runId, 100) && !runs.has(run.runId), 'unique run and case identities');
    ids.add(run.id); runs.add(run.runId);
    check(finite(run.endMs) && run.endMs > 0 && run.endMs <= 240000, 'bounded duration');
    const inRun = value => finite(value) && value >= 0 && value <= run.endMs;
    const nullableTime = value => value === null || inRun(value);
    const cfg = run.config;
    check(cfg && Object.entries({ takeoffAltitudeM: 4, takeoffToleranceM: .35, positionToleranceM: .5, speedToleranceMps: .4,
      dwellMs: 1000, freshnessMs: 500, maxSampleGapMs: 300, heartbeatFreshnessMs: 1500, landedFreshnessMs: 1500,
      ackTimeoutMs: 3000, takeoffTimeoutMs: 30000, landTimeoutMs: 45000, heartbeatIntervalMs: 1000,
      tickIntervalMs: 100, missionDurationMs: 90000, withdrawalDelayMs: 500 }).every(([key, value]) => cfg[key] === value), 'fixed experiment and evidence criteria');
    check(run.controller?.systemId === 255 && run.controller.componentId === 190, 'central coordinator identity');
    check(Array.isArray(run.tasks) && run.tasks.length === 6 && run.tasks.every((task, i) => task.id === `T${i + 1}`
      && sameVector(task.positionEnu, [[-6,6,4],[0,6,4],[6,6,4],[-6,12,4],[0,12,4],[6,12,4]][i])), 'six declared targets');
    check(inRun(run.missionStartMs) && finite(run.missionDeadlineMs) && close(run.missionDeadlineMs, run.missionStartMs + cfg.missionDurationMs)
      && nullableTime(run.missionCompletedMs) && inRun(run.missionClosedMs) && run.missionClosedMs >= run.missionStartMs, 'mission clock and budget');
    check(Array.isArray(run.vehicles) && run.vehicles.length === 3 && Array.isArray(run.attempts) && run.attempts.length >= 6 && run.attempts.length <= 12,
      'bounded vehicles and attempts');
    check(Array.isArray(run.assignments) && run.assignments.length >= 2 && run.assignments.length <= 12
      && Array.isArray(run.taskEvents) && run.taskEvents.length <= 40 && Array.isArray(run.btTicks) && run.btTicks.length >= 2 && run.btTicks.length <= 2400, 'bounded decisions and tree ticks');
    check(Array.isArray(run.events) && run.events.length <= 5 && run.events.every(event => event && inRun(event.timeMs)
      && text(event.stage,30) && text(event.status,30)), 'bounded coordinator events');
    check(run.btTicks.every(tick => tick && Array.isArray(tick.vehicles) && tick.vehicles.length === 3
      && tick.vehicles.every(row => row && row.inputs && Array.isArray(row.actions) && row.actions.every(action => action && text(action.type,30) && inRun(action.timeMs))
        && Array.isArray(row.halts) && Array.isArray(row.visited))), 'bounded tree action records');
    const withdrawal = run.withdrawal;
    check(withdrawal?.vehicleId === 'A1' && withdrawal.afterAttempt === 2 && withdrawal.delayMs === cfg.withdrawalDelayMs
      && ['triggerTimeMs','requestedTimeMs','landedTimeMs','releasedTimeMs'].every(key => nullableTime(withdrawal[key])), 'withdrawal configuration and timestamps');
    const pids = new Set();
    for (const [i, vehicle] of run.vehicles.entries()) {
      check(vehicle?.id === `A${i+1}` && vehicle.systemId === i+1 && vehicle.componentId === 1 && vehicle.instance === i && vehicle.port === 5760+i*10
        && Number.isSafeInteger(vehicle.pid) && vehicle.pid > 0 && !pids.has(vehicle.pid), 'three distinct process, vehicle and route identities'); pids.add(vehicle.pid);
      check(sameVector(vehicle.padEnu, [[-6,0,0],[0,0,0],[6,0,0]][i]) && vector(vehicle.originNed)
        && vehicle.originNed.every(value => Math.abs(value) < 1000) && inRun(vehicle.originTimeMs), 'supplied independent frame registration');
      const home = [-35.363261, 149.165230 + vehicle.padEnu[0] / (6378137 * Math.cos(-35.363261 * Math.PI / 180)) * 180 / Math.PI, 584, 0];
      check(Array.isArray(vehicle.homeGps) && vehicle.homeGps.length === 4 && vehicle.homeGps.every((value, axis) => close(value, home[axis], 1e-9)), 'declared geographic homes');
      check(vehicle.setup && finite(vehicle.setup.durationMs) && vehicle.setup.durationMs > 0
        && Number.isSafeInteger(vehicle.setup.startupTextBytes) && vehicle.setup.startupTextBytes >= 0
        && Number.isSafeInteger(vehicle.setup.autopilotVersion?.flight_sw_version)
        && [24,16,8].map(shift => (vehicle.setup.autopilotVersion.flight_sw_version >>> shift) & 255).join('.') === rt.ardupilotVersion, 'setup and actual firmware report');
      check(vehicle.parameters && Object.entries({ ARMING_SKIPCHK: 0, FRAME_CLASS: 1, FRAME_TYPE: 0, FS_GCS_ENABLE: 0,
        FS_THR_ENABLE: 1, SIM_WIND_SPD: 0, MAV_SYSID: vehicle.systemId }).every(([key, value]) => vehicle.parameters[key] === value), 'parameter readback');
      check(Array.isArray(vehicle.commands) && vehicle.commands.length >= 5 && vehicle.commands.length <= 12, 'bounded flight requests');
      let previous = -1; const commands = new Set();
      for (const command of vehicle.commands) {
        check(command && text(command.id, 50) && !commands.has(command.id) && inRun(command.timeMs) && command.timeMs > previous
          && command.routeSystem === vehicle.systemId && command.targetSystem === vehicle.systemId && command.targetComponent === 1, 'unique addressed requests');
        commands.add(command.id); previous = command.timeMs;
        if (command.kind === 'setpoint') {
          check(command.message === 'SET_POSITION_TARGET_LOCAL_NED' && command.command === null && command.frame === 1 && command.mask === 3576
            && vector(command.positionNed) && text(command.taskId, 20) && text(command.attemptId, 20), 'position-only setpoint has no ACK');
        } else {
          const expected = { guided: [176,[1,4,0,0,0,0,0]], arm: [400,[1,0,0,0,0,0,0]], takeoff: [22,[0,0,0,0,0,0,4]], land: [21,[0,0,0,0,0,0,0]] }[command.id];
          check(expected && command.kind === 'command' && command.message === 'COMMAND_LONG' && command.command === expected[0]
            && Array.isArray(command.params) && command.params.length === 7 && command.params.every((value, index) => value === expected[1][index]), 'normal flight command envelope');
        }
      }
      check(vehicle.commands.slice(0,3).map(c => c.id).join(',') === 'guided,arm,takeoff' && vehicle.commands.at(-1).id === 'land'
        && vehicle.commands.slice(3,-1).every(c => c.kind === 'setpoint'), 'launch, task execution and final LAND order');
      check(Array.isArray(vehicle.acks) && vehicle.acks.length <= 20, 'bounded ACKs'); previous = -1;
      const terminals = new Set();
      for (const ack of vehicle.acks) {
        const command = vehicle.commands.find(command => command.id === ack?.commandId);
        check(command?.kind === 'command' && ack.command === command.command && inRun(ack.timeMs) && ack.timeMs >= command.timeMs && ack.timeMs >= previous
          && ack.routeSystem === vehicle.systemId && ack.sourceSystem === vehicle.systemId && ack.sourceComponent === 1
          && ack.targetSystem === 255 && ack.targetComponent === 190 && Number.isInteger(ack.result) && Object.hasOwn(resultNames, ack.result), 'ACK identity and command association');
        check(!terminals.has(ack.commandId), 'single terminal ACK per request'); if (ack.result !== 5) terminals.add(ack.commandId); previous = ack.timeMs;
      }
      check(Array.isArray(vehicle.telemetry) && vehicle.telemetry.length > 0 && vehicle.telemetry.length <= 20000, 'bounded telemetry'); previous = -1;
      for (const sample of vehicle.telemetry) {
        check(sample && TYPES.includes(sample.type) && inRun(sample.timeMs) && sample.timeMs >= previous
          && sample.sourceSystem === vehicle.systemId && sample.sourceComponent === 1, 'source-specific received telemetry');
        const fields = { LOCAL_POSITION_NED: ['x','y','z','vx','vy','vz','time_boot_ms'], GLOBAL_POSITION_INT: ['relative_alt','time_boot_ms'],
          ATTITUDE: ['roll','pitch','yaw','time_boot_ms'], HEARTBEAT: ['base_mode','custom_mode'], EXTENDED_SYS_STATE: ['landed_state'] }[sample.type];
        check(sample.data && fields.every(key => finite(sample.data[key])), 'finite telemetry fields');
        if ('time_boot_ms' in sample.data) check(Number.isSafeInteger(sample.data.time_boot_ms) && sample.data.time_boot_ms >= 0 && sample.data.time_boot_ms <= 0xffffffff, 'independent boot clock');
        if (sample.type === 'HEARTBEAT') check(Number.isInteger(sample.data.base_mode) && sample.data.base_mode >= 0 && sample.data.base_mode <= 255
          && Number.isInteger(sample.data.custom_mode) && sample.data.custom_mode >= 0, 'heartbeat fields');
        if (sample.type === 'EXTENDED_SYS_STATE') check(Number.isInteger(sample.data.landed_state) && sample.data.landed_state >= 0 && sample.data.landed_state <= 4, 'landed-state fields');
        previous = sample.timeMs;
      }
      const baseline = vehicle.telemetry.find(sample => sample.type === 'LOCAL_POSITION_NED');
      check(baseline && close(baseline.timeMs, vehicle.originTimeMs) && sameVector(position(baseline), vehicle.originNed), 'first recorded LOCAL baseline');
      check(Array.isArray(vehicle.statuses) && vehicle.statuses.length <= 400 && vehicle.statuses.every(row => row && inRun(row.timeMs)
        && text(row.text,500) && Number.isInteger(row.severity) && row.severity >= 0 && row.severity <= 7), 'status text');
      check(Array.isArray(vehicle.events) && vehicle.events.length === 2 * vehicle.commands.length, 'one start and result per command'); previous = -1;
      for (const event of vehicle.events) {
        check(event && commands.has(event.stage) && ['start','complete','cancelled','timeout'].includes(event.status)
          && inRun(event.timeMs) && event.timeMs >= previous, 'ordered flight stage events'); previous = event.timeMs;
      }
      for (const command of vehicle.commands) {
        const entries = vehicle.events.filter(event => event.stage === command.id);
        check(entries.length === 2 && entries[0].status === 'start' && close(entries[0].timeMs, command.timeMs) && entries[1].status !== 'start', 'stage starts with its outgoing request');
        if (command.kind === 'command') {
          const evidence = flightCompletionEvidence(run, vehicle, command.id);
          check(evidence && entries[1].status === 'complete' && close(entries[1].timeMs, evidence.timeMs), 'flight completion requires fresh vehicle-specific evidence');
        }
      }
      check(flightCompletionEvidence(run, vehicle, 'guided').timeMs <= vehicle.commands[1].timeMs
        && flightCompletionEvidence(run, vehicle, 'arm').timeMs <= vehicle.commands[2].timeMs
        && flightCompletionEvidence(run, vehicle, 'takeoff').timeMs <= run.missionStartMs, 'normal launch completion before mission');
    }
    validateAttempts(run, inRun);
    validateDecisions(run, inRun);
    validateTrees(run, inRun);
    check(Array.isArray(run.resources) && run.resources.length > 0 && run.resources.length <= 100, 'bounded resource observations');
    check(run.resources.every(row => row && inRun(row.timeMs) && row.allRunning === true && Array.isArray(row.vehicles) && row.vehicles.length === 3
      && row.vehicles.every((v,i) => v.id === run.vehicles[i].id && v.pid === run.vehicles[i].pid && Number.isSafeInteger(v.rssKiB) && v.rssKiB > 0)), 'concurrent process RSS observations');
    check(run.resources.some(row => row.timeMs >= run.missionStartMs && row.timeMs <= run.missionClosedMs), 'three processes overlap during mission');
    const summary = recoverySummary(run);
    check(summary.tasksCompleted === 6 && summary.landedVehicles === 3 && run.outcome?.status === 'completed'
      && run.outcome.tasksCompleted === 6 && run.outcome.landedVehicles === 3 && close(run.outcome.missionElapsedMs, summary.missionElapsedMs), 'measured tasks and landing outcomes');
    const completed = run.attempts.filter(a => a.completedTimeMs !== null);
    check(close(run.missionCompletedMs, Math.max(...completed.map(a => a.completedTimeMs)))
      && run.missionCompletedMs <= run.missionDeadlineMs && run.missionClosedMs >= run.missionCompletedMs, 'task finish versus coordinator closure');
    check(Array.isArray(run.events) && run.events.length === (run.id === 'withdrawal' ? 3 : 2)
      && run.events.some(e => e.stage === 'mission' && e.status === 'start' && close(e.timeMs,run.missionStartMs))
      && run.events.some(e => e.stage === 'mission' && e.status === 'complete' && close(e.timeMs,run.missionClosedMs)), 'recorded mission start and closure');
    for (const vehicle of run.vehicles) check(vehicle.commands.at(-1).timeMs >= (run.id === 'withdrawal' && vehicle.id === 'A1' ? withdrawal.requestedTimeMs : run.missionClosedMs), 'LAND follows retirement or mission closure');
  }
  return trace;
}

function validateAttempts(run, inRun) {
  const attempts = new Map();
  for (const [index, attempt] of run.attempts.entries()) {
    const vehicle = run.vehicles.find(v => v.id === attempt?.vehicleId), task = run.tasks.find(t => t.id === attempt?.taskId);
    check(vehicle && task && attempt.id === `P${index+1}` && !attempts.has(attempt.id) && attempt.commandId === `task-${attempt.id}`
      && inRun(attempt.assignedTimeMs) && inRun(attempt.sentTimeMs) && attempt.sentTimeMs > attempt.assignedTimeMs
      && attempt.assignedTimeMs >= run.missionStartMs && attempt.sentTimeMs <= run.missionDeadlineMs, 'bounded unique task attempts');
    attempts.set(attempt.id, attempt);
    check(['completed','cancelled'].includes(attempt.status) && ['completedTimeMs','cancelledTimeMs','releasedTimeMs'].every(key => attempt[key] === null || inRun(attempt[key])), 'attempt outcome timestamps');
    const command = vehicle.commands.find(c => c.id === attempt.commandId);
    check(command && command.kind === 'setpoint' && command.attemptId === attempt.id && command.taskId === task.id
      && close(command.timeMs, attempt.sentTimeMs) && sameVector(command.positionNed, attempt.positionNed)
      && sameVector(attempt.positionNed, targetNed(vehicle, task.positionEnu)), 'attempt owns its correctly converted command');
    const evidence = attemptCompletionEvidence(run, attempt), result = vehicle.events.find(e => e.stage === command.id && e.status !== 'start');
    if (attempt.status === 'completed') {
      check(evidence && close(evidence.timeMs, attempt.completedTimeMs) && attempt.cancelledTimeMs === null && attempt.releasedTimeMs === null
        && result.status === 'complete' && close(result.timeMs, evidence.timeMs), 'new fresh samples complete exactly this attempt');
    } else {
      check(!evidence && attempt.completedTimeMs === null && inRun(attempt.cancelledTimeMs) && attempt.cancelledTimeMs > attempt.sentTimeMs
        && inRun(attempt.releasedTimeMs) && attempt.releasedTimeMs > attempt.cancelledTimeMs
        && result.status === 'cancelled' && close(result.timeMs, attempt.cancelledTimeMs), 'cancelled attempt never acquires later completion');
    }
  }
  check(run.vehicles.reduce((n,v) => n + v.commands.filter(c => c.kind === 'setpoint').length,0) === attempts.size, 'every position request has one attempt');
  const states = new Map(run.tasks.map(t => [t.id, { state: 'pending', owner: null, attempt: null }]));
  let previous = -1; const counts = new Map();
  for (const event of run.taskEvents) {
    const attempt = attempts.get(event?.attemptId);
    check(attempt && event.taskId === attempt.taskId && event.vehicleId === attempt.vehicleId && inRun(event.timeMs) && event.timeMs >= previous
      && ['assigned','completed','locked','released'].includes(event.type), 'task event identity and order'); previous = event.timeMs;
    const key = `${event.attemptId}:${event.type}`; check(!counts.has(key), 'one task transition per attempt'); counts.set(key,event);
    const state = states.get(event.taskId);
    if (event.type === 'assigned') {
      check(state.state === 'pending' && close(event.timeMs,attempt.assignedTimeMs)
        && ![...states.values()].some(s => s.owner === event.vehicleId && ['assigned','locked'].includes(s.state)), 'exclusive task and vehicle ownership');
      Object.assign(state,{state:'assigned',owner:event.vehicleId,attempt:event.attemptId});
    } else {
      check(state.owner === event.vehicleId && state.attempt === event.attemptId, 'only current owner changes task state');
      if (event.type === 'completed') {
        check(state.state === 'assigned' && attempt.status === 'completed' && close(event.timeMs,attempt.completedTimeMs), 'completion is terminal'); state.state='completed';
      } else if (event.type === 'locked') {
        check(state.state === 'assigned' && attempt.status === 'cancelled' && close(event.timeMs,attempt.cancelledTimeMs), 'cancellation retains ownership'); state.state='locked';
      } else {
        check(state.state === 'locked' && close(event.timeMs,attempt.releasedTimeMs), 'release follows retained ownership');
        Object.assign(state,{state:'pending',owner:null,attempt:null});
      }
    }
  }
  for (const attempt of attempts.values()) check(['assigned',...(attempt.status === 'completed' ? ['completed'] : ['locked','released'])].every(type => counts.has(`${attempt.id}:${type}`)), 'all attempt lifecycle events retained');
  check([...states.values()].every(s => s.state === 'completed'), 'all six tasks complete exactly once');
  const cancelled = run.attempts.filter(a => a.status === 'cancelled'), w = run.withdrawal;
  if (run.id === 'nominal') check(cancelled.length === 0 && run.attempts.length === 6
    && ['triggerTimeMs','requestedTimeMs','landedTimeMs','releasedTimeMs'].every(key => w[key] === null), 'nominal has no withdrawal intervention');
  else {
    const a1 = run.vehicles[0], second = run.attempts.filter(a => a.vehicleId === 'A1')[1];
    check(cancelled.length === 1 && run.attempts.length === 7 && cancelled[0] === second
      && close(w.triggerTimeMs,second.sentTimeMs+run.config.withdrawalDelayMs) && inRun(w.requestedTimeMs)
      && w.requestedTimeMs >= w.triggerTimeMs && second.cancelledTimeMs >= w.requestedTimeMs, 'withdrawal interrupts A1’s second attempt at sampled trigger');
    const land = flightCompletionEvidence(run,a1,'land');
    check(land && close(w.landedTimeMs,land.timeMs) && close(w.releasedTimeMs,second.releasedTimeMs)
      && w.releasedTimeMs >= land.timeMs && a1.commands.at(-1).timeMs >= second.cancelledTimeMs, 'release waits for actual landed and disarmed evidence');
    const released = sitlFrame(vehicleRun(run,a1),w.releasedTimeMs), landCommand = a1.commands.find(c => c.id === 'land');
    check(released.armed === false && released.landedState === 1 && released.heartbeatAgeMs <= run.config.heartbeatFreshnessMs
      && released.landedAgeMs <= run.config.landedFreshnessMs && released.latest.HEARTBEAT.timeMs >= landCommand.timeMs
      && released.latest.EXTENDED_SYS_STATE.timeMs >= landCommand.timeMs, 'release uses currently fresh grounded/disarmed reports');
    check(run.attempts.some(a => a.taskId === second.taskId && a.vehicleId !== 'A1' && a.assignedTimeMs >= second.releasedTimeMs)
      && run.attempts.filter(a => a.vehicleId === 'A1').length === 2, 'unfinished work transfers after release and A1 stays retired');
    check(run.events.some(e => e.stage === 'withdrawal' && e.status === 'requested' && e.vehicleId === 'A1' && close(e.timeMs,w.requestedTimeMs)), 'recorded withdrawal request');
  }
}

function consumedTime(run, attempt) {
  return run.btTicks.flatMap(t => t.vehicles.flatMap(v => v.actions ?? [])).find(action => action.type === 'task-success' && action.attemptId === attempt.id)?.timeMs ?? Infinity;
}
function activeAttemptAt(run, vehicleId, timeMs) {
  return run.attempts.find(a => a.vehicleId === vehicleId && a.assignedTimeMs < timeMs
    && !(a.releasedTimeMs !== null && a.releasedTimeMs <= timeMs)
    && !(a.completedTimeMs !== null && consumedTime(run,a) <= timeMs)) ?? null;
}
function validateDecisions(run, inRun) {
  let previous = -1; const assigned = new Set();
  for (const [index, decision] of run.assignments.entries()) {
    check(decision?.id === `D${index+1}` && inRun(decision.timeMs) && decision.timeMs > previous && decision.timeMs >= run.missionStartMs
      && decision.timeMs < run.missionClosedMs && Array.isArray(decision.availableTaskIds) && Array.isArray(decision.eligible)
      && Array.isArray(decision.pairs) && decision.pairs.length > 0, 'ordered bounded allocation decisions'); previous = decision.timeMs;
    const pending = tasksAt({ ...run, taskEvents: run.taskEvents.filter(e => e.timeMs < decision.timeMs) }, decision.timeMs).filter(t => t.state === 'pending');
    check(JSON.stringify(decision.availableTaskIds) === JSON.stringify(pending.map(t => t.id)), 'allocator includes all currently unowned unfinished tasks');
    const eligible = run.vehicles.filter(vehicle => {
      if (run.withdrawal.requestedTimeMs !== null && vehicle.id === 'A1' && run.withdrawal.requestedTimeMs <= decision.timeMs) return false;
      if (activeAttemptAt(run,vehicle.id,decision.timeMs) || flightCompletionEvidence(run,vehicle,'land',decision.timeMs)
        || !flightCompletionEvidence(run,vehicle,'takeoff',decision.timeMs)) return false;
      const sample = vehicle.telemetry.filter(s => s.type === 'LOCAL_POSITION_NED' && s.timeMs <= decision.timeMs).at(-1);
      return sample && decision.timeMs-sample.timeMs <= run.config.freshnessMs;
    });
    check(decision.eligible.length === eligible.length && decision.eligible.every((row,i) => row.vehicleId === eligible[i].id), 'allocator includes all eligible idle fresh vehicles');
    for (const [i,row] of decision.eligible.entries()) {
      const sample = eligible[i].telemetry.filter(s => s.type === 'LOCAL_POSITION_NED' && s.timeMs <= decision.timeMs).at(-1);
      check(close(row.poseSampleTimeMs,sample.timeMs) && sameVector(row.positionEnu,missionPosition(eligible[i],position(sample))), 'allocation snapshot uses latest actual local sample');
    }
    const costs = decision.eligible.map(row => pending.map(task => Math.hypot(row.positionEnu[0]-task.positionEnu[0],row.positionEnu[1]-task.positionEnu[1])));
    const pairs = greedyAssignment(costs);
    check(decision.pairs.length === pairs.length && decision.pairs.every((pair,i) => {
      const [r,c] = pairs[i], attempt = run.attempts.find(a => a.id === pair.attemptId);
      return attempt && !assigned.has(attempt.id) && pair.vehicleId === eligible[r].id && pair.taskId === pending[c].id
        && close(pair.costM,costs[r][c],1e-6) && attempt.vehicleId === pair.vehicleId && attempt.taskId === pair.taskId && close(attempt.assignedTimeMs,decision.timeMs);
    }), 'nearest-pair greedy costs, owners and distinct attempts');
    decision.pairs.forEach(pair => assigned.add(pair.attemptId));
  }
  check(assigned.size === run.attempts.length, 'each attempt belongs to one allocation decision');
}

function validateTrees(run, inRun) {
  let previousEnd = -1; const commandActions = new Set(), taskSuccesses = new Set(), activeActions = new Map();
  const evidence = new Map(run.vehicles.map(v => [v.id, Object.fromEntries(['guided','arm','takeoff','land'].map(stage => [stage,flightCompletionEvidence(run,v,stage)]))]));
  const positions = new Map(run.vehicles.map(v => [v.id, { index: 0, latest: Object.fromEntries(TYPES.map(type => [type,null])) }]));
  for (const [index,tick] of run.btTicks.entries()) {
    check(tick?.index === index && inRun(tick.startedTimeMs) && inRun(tick.timeMs) && tick.timeMs >= tick.startedTimeMs && tick.startedTimeMs > previousEnd
      && Array.isArray(tick.vehicles) && tick.vehicles.length === 3, 'ordered actual tick start/end bounds'); previousEnd = tick.timeMs;
    for (const [i,row] of tick.vehicles.entries()) {
      const vehicle = run.vehicles[i], input = row?.inputs, stamps = positions.get(vehicle.id);
      check(row?.vehicleId === vehicle.id && input && Array.isArray(row.visited) && row.visited.length <= RECOVERY_TREE.length
        && Array.isArray(row.actions) && row.actions.length <= 5 && Array.isArray(row.halts) && row.halts.length <= 5, 'bounded vehicle tree traversal');
      while (stamps.index < vehicle.telemetry.length && vehicle.telemetry[stamps.index].timeMs <= tick.startedTimeMs) {
        const sample = vehicle.telemetry[stamps.index++]; stamps.latest[sample.type]=sample.timeMs;
      }
      check(input.telemetry && TYPES.every(type => input.telemetry[type] === stamps.latest[type]), 'tree input channels contain the latest available receipt times');
      const done = stage => evidence.get(vehicle.id)[stage]?.timeMs <= tick.startedTimeMs;
      const active = activeAttemptAt(run,vehicle.id,tick.startedTimeMs);
      const status = active ? active.completedTimeMs !== null && active.completedTimeMs <= tick.startedTimeMs ? 'completed'
        : active.cancelledTimeMs !== null && active.cancelledTimeMs <= tick.startedTimeMs ? 'cancelled' : 'active' : null;
      check(input.withdrawRequested === Boolean(run.withdrawal.requestedTimeMs !== null && vehicle.id === 'A1' && tick.startedTimeMs >= run.withdrawal.requestedTimeMs)
        && input.missionClosed === (tick.startedTimeMs >= run.missionClosedMs)
        && input.guidedDone === done('guided') && input.armedDone === done('arm') && input.takeoffDone === done('takeoff')
        && input.ready === done('takeoff') && input.landed === done('land') && input.attemptId === (active?.id ?? null)
        && input.attemptStatus === status && input.taskDone === (status === 'completed'), 'tree conditions derive from received evidence and current ownership');
      const expected = expectedRecoveryTick(input);
      check(JSON.stringify(row.visited) === JSON.stringify(expected.visited) && row.status === expected.status, 'actual reactive fallback and sequence traversal');
      let running = activeActions.get(vehicle.id) ?? null; const halts = [];
      for (const visited of row.visited) {
        const node = RECOVERY_TREE.find(node => node.id === visited.id);
        if (node.type !== 'action') continue;
        if (node.id !== 'task' && visited.status === 'SUCCESS') { if (running === node.id) running=null; continue; }
        if (running !== null && running !== node.id) { halts.push({id:running,attemptId:running === 'task' ? active?.id : undefined}); running=null; }
        running = visited.status === 'RUNNING' ? node.id : null;
      }
      check(row.halts.length === halts.length && row.halts.every((halt,j) => halt.id === halts[j].id && halt.attemptId === halts[j].attemptId
        && finite(halt.timeMs) && halt.timeMs >= tick.startedTimeMs && halt.timeMs <= tick.timeMs), 'priority changes halt the actual previously running action');
      activeActions.set(vehicle.id,running);
      for (const action of row.actions) {
        check(action && finite(action.timeMs) && action.timeMs >= tick.startedTimeMs && action.timeMs <= tick.timeMs, 'action belongs to actual tick time');
        if (action.type === 'task-success') {
          check(active && action.attemptId === active.id && input.taskDone && row.visited.some(v => v.id === 'task' && v.status === 'SUCCESS')
            && !taskSuccesses.has(active.id), 'task action consumes its completion once'); taskSuccesses.add(active.id);
        } else {
          const command = vehicle.commands.find(c => c.id === action.commandId), key = `${vehicle.id}:${action.commandId}`;
          check(command && close(command.timeMs,action.timeMs) && !commandActions.has(key), 'one actual tree dispatch for each outgoing request');
          if (action.type === 'setpoint') check(command.kind === 'setpoint' && active && action.attemptId === active.id && command.attemptId === active.id
            && row.visited.some(v => v.id === 'task' && v.status === 'RUNNING'), 'assigned task leaf sends its own target');
          else check(action.type === 'command' && command.kind === 'command'
            && row.visited.some(v => (command.id === 'land' ? ['withdrawLand','cleanupLand'].includes(v.id) : v.id === command.id) && v.status === 'RUNNING'), 'visited flight action sends command');
          commandActions.add(key);
        }
      }
    }
  }
  check(commandActions.size === run.vehicles.reduce((n,v) => n+v.commands.length,0), 'no flight commands outside the recorded Behavior Trees');
  if (run.id === 'withdrawal') {
    const first = run.btTicks.find(t => t.startedTimeMs >= run.withdrawal.triggerTimeMs);
    check(first && close(first.startedTimeMs,run.withdrawal.requestedTimeMs), 'withdrawal sampled at first due control tick');
    const cancelled = run.attempts.find(a => a.status === 'cancelled');
    check(first.vehicles[0].halts.some(h => h.id === 'task' && h.attemptId === cancelled.id)
      && cancelled.cancelledTimeMs >= first.startedTimeMs && cancelled.cancelledTimeMs <= first.timeMs, 'withdrawal branch preempts and locks its running task');
  }
}
