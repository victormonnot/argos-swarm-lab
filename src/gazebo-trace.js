import { completionEvidence, nedToEnu, sitlFrame, resultNames } from './sitl-trace.js';
export { resultNames, landedNames } from './sitl-trace.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = (value, size = 3) => Array.isArray(value) && value.length === size && value.every(finite);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = (condition, message) => { if (!condition) throw new Error(`Invalid Gazebo trace: ${message}`); };
const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const norm = values => Math.hypot(...values);
const localPosition = sample => [sample.data.x, sample.data.y, sample.data.z];
const localVelocity = sample => [sample.data.vx, sample.data.vy, sample.data.vz];
const eventAt = (run, stage, status) => run.events.find(event => event.stage === stage && event.status === status) ?? null;
const TYPES = ['LOCAL_POSITION_NED', 'GLOBAL_POSITION_INT', 'ATTITUDE', 'HEARTBEAT', 'EXTENDED_SYS_STATE'];

/** A fixed translation aligns the grounded baselines; it does not correct drift. */
export function estimateWorldPosition(run, ned) {
  return nedToEnu(ned, run.originNed).map((value, axis) => value + run.originTruthEnu[axis]);
}
const multiply = (a, b) => [
  a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
  a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
  a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
  a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
];
/** MAVLink FRD→NED Euler attitude to FLU→ENU quaternion, in XYZW order. */
export function attitudeNedToEnu({ roll, pitch, yaw }) {
  if (![roll, pitch, yaw].every(finite)) throw new TypeError('Attitude must contain finite radians.');
  const [sr, sp, sy] = [roll, pitch, yaw].map(angle => Math.sin(angle / 2));
  const [cr, cp, cy] = [roll, pitch, yaw].map(angle => Math.cos(angle / 2));
  const body = [sr*cp*cy-cr*sp*sy, cr*sp*cy+sr*cp*sy, cr*cp*sy-sr*sp*cy, cr*cp*cy+sr*sp*sy];
  return multiply([Math.SQRT1_2, Math.SQRT1_2, 0, 0], multiply(body, [1, 0, 0, 0]));
}

function pulseEdges(run, untilMs = run.endMs) {
  const start = run.truth.find(sample => sample.timeMs <= untilMs && sample.pulseActive) ?? null;
  const end = start ? run.truth.find(sample => sample.timeMs <= untilMs && sample.timeMs > start.timeMs && !sample.pulseActive && sample.pulseAppliedSteps > 0) ?? null : null;
  return { start, end };
}

/** Evaluator-only horizontal return; simulation-time dwell never grows from held samples. */
export function recoveryEvidence(run, untilMs = run.endMs) {
  const { end } = pulseEdges(run, untilMs);
  if (!end) return null;
  const hoverStart = eventAt(run, 'hover', 'start');
  const hoverEnd = eventAt(run, 'hover', 'complete');
  const lastSimTime = Math.min(hoverEnd?.simTimeMs ?? Infinity,
    hoverStart ? hoverStart.simTimeMs + run.config.hoverDurationMs : Infinity);
  let since = null, previous = null;
  for (const sample of run.truth) {
    if (sample.timeMs > Math.min(untilMs, hoverEnd?.timeMs ?? run.endMs)
      || sample.simTimeMs > lastSimTime) break;
    if (sample.simTimeMs <= end.simTimeMs) continue;
    const distance = Math.hypot(sample.positionEnu[0] - run.originTruthEnu[0], sample.positionEnu[1] - run.originTruthEnu[1]);
    const good = !sample.pulseActive && distance <= run.config.recoveryToleranceM && norm(sample.velocityEnu) <= run.config.recoverySpeedMps;
    if (previous !== null && sample.simTimeMs <= previous) continue;
    if (!good) since = null;
    else if (since === null || previous === null || sample.simTimeMs - previous > run.config.truthMaxGapMs) since = sample.simTimeMs;
    previous = sample.simTimeMs;
    if (since !== null && sample.simTimeMs - since >= run.config.recoveryDwellMs) {
      return { timeMs: sample.timeMs, simTimeMs: sample.simTimeMs, durationMs: sample.simTimeMs - end.simTimeMs };
    }
  }
  return null;
}

export function gazeboEvents(run) {
  return [['command', run.commands], ['ack', run.acks], ['telemetry', run.telemetry], ['truth', run.truth], ['stage', run.events], ['status', run.statuses], ['pulse-request', run.pulse ? [{ ...run.pulse, timeMs: run.pulse.requestTimeMs }] : []]]
    .flatMap(([kind, items]) => items.map(data => ({ kind, timeMs: data.timeMs, data }))).sort((a, b) => a.timeMs - b.timeMs);
}

export function gazeboFrame(run, timeMs) {
  const base = sitlFrame(run, timeMs);
  const truthTrajectory = run.truth.filter(sample => sample.timeMs <= timeMs), truth = truthTrajectory.at(-1) ?? null;
  const local = base.latest.LOCAL_POSITION_NED;
  const estimate = local ? { timeMs: local.timeMs, positionEnu: estimateWorldPosition(run, localPosition(local)),
    orientationXyzw: base.attitude ? attitudeNedToEnu(base.attitude) : null,
    velocityEnu: nedToEnu(localVelocity(local)), bootTimeMs: local.data.time_boot_ms } : null;
  const requested = run.pulse && timeMs >= run.pulse.requestTimeMs;
  return { ...base, truth, estimate, truthAgeMs: truth ? timeMs - truth.timeMs : null,
    estimateAgeMs: estimate ? timeMs - estimate.timeMs : null, simTimeMs: truth?.simTimeMs ?? null,
    receiptSkewMs: truth && estimate ? estimate.timeMs - truth.timeMs : null,
    heldSeparationM: truth && estimate ? norm(estimate.positionEnu.map((value, axis) => value - truth.positionEnu[axis])) : null,
    targetEnu: [run.originTruthEnu[0], run.originTruthEnu[1], run.originTruthEnu[2] + run.config.takeoffAltitudeM],
    truthTrajectory, estimateTrajectory: base.trajectory.map(sample => ({ timeMs: sample.timeMs, positionEnu: estimateWorldPosition(run, localPosition(sample)) })),
    forceEnu: truth?.forceEnu ?? null,
    pulsePhase: !requested ? 'not-requested' : truth?.pulseActive ? 'active' : truth?.pulseAppliedSteps > 0 ? 'released' : 'requested',
    recovery: recoveryEvidence(run, timeMs),
  };
}

export function gazeboSummary(run) {
  const hoverStart = eventAt(run, 'hover', 'start'), hoverEnd = eventAt(run, 'hover', 'complete');
  const window = hoverStart ? run.truth.filter(sample => sample.simTimeMs >= hoverStart.simTimeMs
    && sample.simTimeMs <= Math.min(hoverEnd?.simTimeMs ?? Infinity, hoverStart.simTimeMs + run.config.hoverDurationMs)
    && sample.timeMs <= (hoverEnd?.timeMs ?? run.endMs)) : [];
  let peak = null;
  for (const sample of window) {
    const distance = Math.hypot(sample.positionEnu[0] - run.originTruthEnu[0], sample.positionEnu[1] - run.originTruthEnu[1]);
    if (!peak || distance > peak.distance) peak = { distance, sample };
  }
  const { start, end } = pulseEdges(run), recovery = recoveryEvidence(run);
  return { hoverStartMs: hoverStart?.timeMs ?? null, hoverEndMs: hoverEnd?.timeMs ?? null,
    pulseRequestMs: run.pulse?.requestTimeMs ?? null, pulseStartMs: start?.timeMs ?? null, pulseEndMs: end?.timeMs ?? null,
    recoveryMs: recovery?.timeMs ?? null, recoverySimMs: recovery?.simTimeMs ?? null, recoveryDurationMs: recovery?.durationMs ?? null,
    maxHorizontalDeviationM: peak?.distance ?? null, maxHorizontalDeviationMs: peak?.sample.timeMs ?? null,
    impulseNs: run.truth.at(-1)?.impulseNs ?? null,
    flightCompleted: Boolean(eventAt(run, 'land', 'complete')), landedMs: eventAt(run, 'land', 'complete')?.timeMs ?? null,
    truthCount: run.truth.length, telemetryCount: run.telemetry.length, outcome: run.outcome };
}

export function validateGazeboTrace(trace) {
  check(trace?.kind === 'argos-ardupilot-gazebo' && trace.schemaVersion === 1, 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['recordedAt', 'ardupilotVersion', 'gazeboVersion', 'pluginGitHash', 'image', 'baseImage'].every(key => text(runtime[key])), 'runtime metadata');
  check(Number.isFinite(Date.parse(runtime.recordedAt)) && /^[a-f0-9]{40}$/.test(runtime.pluginGitHash), 'runtime date and plugin revision');
  check(['sourceSha256', 'observerSha256', 'worldSha256', 'sitlSourceSha256', 'overridesSha256'].every(key => hash(runtime[key]))
    && runtime.paramsSha256 && ['copter.parm', 'gazebo-iris.parm'].every(key => hash(runtime.paramsSha256[key])), 'runtime fingerprints');
  check(runtime.modelArgument === 'JSON' && runtime.model === 'Iris' && runtime.physics === 'DART'
    && runtime.lockStep === true && runtime.noTimeSync === false && runtime.maxStepSizeMs === 1
    && runtime.clock === 'recorder-monotonic-receipt' && runtime.truthClock === 'gazebo-simulation'
    && runtime.transport === 'tcp-loopback' && runtime.mavlinkVersion === 2, 'external physics and clock contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 2, 'one or two recordings');
  const identities = new Set(), runIds = new Set();
  for (const run of trace.cases) {
    check(run && ['nominal', 'pulse'].includes(run.id) && !identities.has(run.id) && text(run.label) && text(run.runId) && !runIds.has(run.runId), 'unique case and run identities');
    identities.add(run.id); runIds.add(run.runId);
    check(run.vehicle?.systemId === 1 && run.vehicle.componentId === 1 && run.controller?.systemId === 255 && run.controller.componentId === 190, 'vehicle and controller identities');
    check(finite(run.endMs) && run.endMs > 0 && run.endMs <= 300000, 'bounded duration');
    const inRun = value => finite(value) && value >= 0 && value <= run.endMs;
    const cfg = run.config;
    check(cfg && Object.values(cfg).every(value => finite(value) || vector(value)), 'finite configuration');
    const expected = { takeoffAltitudeM: 4, takeoffToleranceM: .35, speedToleranceMps: .4,
      dwellMs: 1000, freshnessMs: 500, maxSampleGapMs: 300, heartbeatFreshnessMs: 1500, landedFreshnessMs: 1500,
      hoverDurationMs: 12000, pulseDelayMs: 2000, recoveryToleranceM: .35, recoverySpeedMps: .25, recoveryDwellMs: 1000, truthMaxGapMs: 150 };
    check(Object.entries(expected).every(([key, value]) => cfg[key] === value), 'declared completion and observation criteria');
    check(vector(run.originNed) && vector(run.originTruthEnu) && run.originSampleTimes
      && inRun(run.originSampleTimes.estimateTimeMs) && inRun(run.originSampleTimes.truthTimeMs), 'fixed grounded alignment');
    check(run.parameters && run.parameters.ARMING_SKIPCHK === 0 && run.parameters.AHRS_EKF_TYPE === 3
      && run.parameters.EK3_ENABLE === 1, 'normal arming and EKF3 estimation');
    check(Array.isArray(run.commands) && run.commands.length === 4, 'four serialized command requests');
    let previous = -1;
    for (const [index, command] of run.commands.entries()) {
      const [id, number] = [['guided', 176], ['arm', 400], ['takeoff', 22], ['land', 21]][index];
      check(command.id === id && command.command === number && command.kind === 'command' && command.message === 'COMMAND_LONG'
        && command.targetSystem === 1 && command.targetComponent === 1 && inRun(command.timeMs) && command.timeMs > previous
        && Array.isArray(command.params) && command.params.length === 7 && command.params.every(finite), 'command envelope and order');
      previous = command.timeMs;
      if (id === 'guided') check(command.params[0] === 1 && command.params[1] === 4, 'Guided request');
      if (id === 'arm') check(command.params[0] === 1 && command.params[1] === 0, 'non-forced arm request');
      if (id === 'takeoff') check(command.params[6] === cfg.takeoffAltitudeM, 'requested takeoff height');
    }
    check(Array.isArray(run.acks) && run.acks.length <= 20, 'bounded ACKs'); previous = -1;
    const terminal = new Set();
    for (const ack of run.acks) {
      const command = run.commands.find(command => command.id === ack.commandId);
      check(command && ack.command === command.command && inRun(ack.timeMs) && ack.timeMs >= command.timeMs && ack.timeMs >= previous
        && ack.sourceSystem === 1 && ack.sourceComponent === 1 && ack.targetSystem === 255 && ack.targetComponent === 190
        && Number.isInteger(ack.result) && Object.hasOwn(resultNames, ack.result), 'ACK association and identity');
      check(!terminal.has(ack.commandId), 'one terminal ACK per request');
      if (ack.result !== 5) terminal.add(ack.commandId);
      previous = ack.timeMs;
    }
    check(Array.isArray(run.telemetry) && run.telemetry.length > 0 && run.telemetry.length <= 20000, 'bounded telemetry'); previous = -1;
    for (const sample of run.telemetry) {
      check(sample && TYPES.includes(sample.type) && inRun(sample.timeMs) && sample.timeMs >= previous && sample.sourceSystem === 1 && sample.sourceComponent === 1, 'telemetry type, source and receipt time');
      const fields = { LOCAL_POSITION_NED: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'time_boot_ms'], ATTITUDE: ['roll', 'pitch', 'yaw', 'time_boot_ms'],
        GLOBAL_POSITION_INT: ['relative_alt', 'time_boot_ms'], HEARTBEAT: ['base_mode', 'custom_mode'], EXTENDED_SYS_STATE: ['landed_state'] }[sample.type];
      check(sample.data && fields.every(key => finite(sample.data[key])), 'finite telemetry fields');
      if ('time_boot_ms' in sample.data) check(Number.isSafeInteger(sample.data.time_boot_ms) && sample.data.time_boot_ms >= 0, 'vehicle boot clock');
      if (sample.type === 'HEARTBEAT') check(Number.isInteger(sample.data.base_mode) && sample.data.base_mode >= 0 && sample.data.base_mode <= 255 && Number.isInteger(sample.data.custom_mode), 'heartbeat mode');
      if (sample.type === 'EXTENDED_SYS_STATE') check(Number.isInteger(sample.data.landed_state) && sample.data.landed_state >= 0 && sample.data.landed_state <= 4, 'landed state');
      previous = sample.timeMs;
    }
    check(Array.isArray(run.truth) && run.truth.length > 0 && run.truth.length <= 20000, 'bounded simulator observations'); previous = -1;
    let priorSim = -1, priorSteps = 0;
    for (const sample of run.truth) {
      check(sample && inRun(sample.timeMs) && sample.timeMs >= previous && finite(sample.simTimeMs) && sample.simTimeMs >= 0 && sample.simTimeMs > priorSim, 'truth receipt and simulation clocks');
      check(['positionEnu', 'velocityEnu', 'forceEnu', 'impulseNs'].every(key => vector(sample[key])) && vector(sample.orientationXyzw, 4)
        && close(norm(sample.orientationXyzw), 1, 1e-4), 'finite world pose, velocity, force and normalized quaternion');
      check(typeof sample.pulseActive === 'boolean' && Number.isSafeInteger(sample.pulseAppliedSteps) && sample.pulseAppliedSteps >= priorSteps, 'pulse application counter');
      if (!sample.pulseActive) check(sample.forceEnu.every(value => value === 0), 'released pulse has zero applied force');
      previous = sample.timeMs; priorSim = sample.simTimeMs; priorSteps = sample.pulseAppliedSteps;
    }
    const originEstimate = run.telemetry.find(sample => sample.type === 'LOCAL_POSITION_NED');
    check(originEstimate && close(originEstimate.timeMs, run.originSampleTimes.estimateTimeMs)
      && localPosition(originEstimate).every((value, axis) => close(value, run.originNed[axis]))
      && close(run.truth[0].timeMs, run.originSampleTimes.truthTimeMs)
      && run.truth[0].positionEnu.every((value, axis) => close(value, run.originTruthEnu[axis])), 'alignment matches the recorded initial observations');
    check(Array.isArray(run.events) && run.events.length <= 30, 'bounded execution observations'); previous = -1;
    const starts = new Set(), completions = new Set();
    for (const event of run.events) {
      check(event && ['guided', 'arm', 'takeoff', 'hover', 'land'].includes(event.stage) && ['start', 'complete'].includes(event.status)
        && inRun(event.timeMs) && event.timeMs >= previous, 'execution event vocabulary and receipt order'); previous = event.timeMs;
      if (event.status === 'start') {
        check(!starts.has(event.stage), 'single stage start'); starts.add(event.stage);
        if (event.stage !== 'hover') check(close(event.timeMs, run.commands.find(command => command.id === event.stage)?.timeMs), 'stage begins with its command');
      } else {
        check(starts.has(event.stage) && !completions.has(event.stage), 'single completion follows its start'); completions.add(event.stage);
        if (event.stage !== 'hover') {
          const evidence = completionEvidence(run, event.stage, event.timeMs);
          check(evidence && close(evidence.timeMs, event.timeMs, 1e-3), 'flight completion requires fresh telemetry evidence');
        }
      }
    }
    const hoverStart = eventAt(run, 'hover', 'start'), hoverEnd = eventAt(run, 'hover', 'complete');
    check(hoverStart && hoverEnd && finite(hoverStart.simTimeMs) && finite(hoverEnd.simTimeMs)
      && hoverEnd.simTimeMs - hoverStart.simTimeMs >= cfg.hoverDurationMs, 'complete simulation-time hover window');
    for (const event of [hoverStart, hoverEnd]) {
      const sample = run.truth.find(sample => sample.timeMs <= event.timeMs && close(sample.simTimeMs, event.simTimeMs));
      check(sample && event.timeMs - sample.timeMs <= 500, 'hover clock comes from a fresh observed simulator sample');
    }
    for (let index = 1; index < run.commands.length; index++) {
      const before = run.commands[index - 1], after = run.commands[index];
      check(eventAt(run, before.id, 'complete')?.timeMs <= after.timeMs, 'later command follows measured prerequisite completion');
    }
    check(eventAt(run, 'takeoff', 'complete')?.timeMs <= hoverStart.timeMs && hoverEnd.timeMs <= run.commands.at(-1).timeMs, 'hover is between takeoff completion and LAND');
    if (run.id === 'nominal') {
      check(run.pulse === null && run.truth.every(sample => !sample.pulseActive && sample.pulseAppliedSteps === 0 && [...sample.forceEnu, ...sample.impulseNs].every(value => value === 0)), 'nominal has no external pulse');
    } else {
      const pulse = run.pulse, edges = pulseEdges(run);
      check(pulse && inRun(pulse.requestTimeMs) && vector(pulse.forceEnu) && pulse.forceEnu.every((value, axis) => value === [8, 0, 0][axis]) && pulse.durationMs === 1000, 'declared eight-newton eastward pulse');
      const requestedAt = run.truth.filter(sample => sample.timeMs <= pulse.requestTimeMs).at(-1);
      check(requestedAt && requestedAt.simTimeMs - hoverStart.simTimeMs >= cfg.pulseDelayMs, 'pulse requested after the simulation-time baseline interval');
      check(edges.start && edges.end && edges.start.timeMs >= pulse.requestTimeMs && edges.end.timeMs <= hoverEnd.timeMs
        && close(edges.end.simTimeMs - edges.start.simTimeMs, pulse.durationMs, runtime.maxStepSizeMs + 1e-6), 'observed bounded force application interval');
      let released = false;
      for (const sample of run.truth) {
        if (sample.timeMs >= edges.end.timeMs) released = true;
        check(!sample.pulseActive || (!released && sample.timeMs >= edges.start.timeMs && sample.forceEnu.every((value, axis) => value === pulse.forceEnu[axis])), 'one contiguous recorded force pulse');
        if (sample.timeMs < edges.start.timeMs) check(sample.pulseAppliedSteps === 0 && sample.impulseNs.every(value => value === 0), 'no impulse before application');
        const expectedSteps = sample.simTimeMs < edges.start.simTimeMs ? 0
          : Math.min(pulse.durationMs / runtime.maxStepSizeMs, (sample.simTimeMs - edges.start.simTimeMs) / runtime.maxStepSizeMs + 1);
        check(close(sample.pulseAppliedSteps, expectedSteps, 1e-4)
          && sample.impulseNs.every((value, axis) => close(value, sample.pulseAppliedSteps * runtime.maxStepSizeMs * pulse.forceEnu[axis] / 1000)),
        'applied step counter and impulse follow the fixed physics steps');
      }
      check(run.truth.at(-1).impulseNs.every((value, axis) => close(value, pulse.forceEnu[axis] * pulse.durationMs / 1000, .02)), 'accumulated applied impulse matches the bounded force');
    }
    check(run.outcome?.status === 'completed' && text(run.outcome.reason) && completions.has('land'), 'recording requires measured landing; partial failures are not exported');
    check(Array.isArray(run.statuses) && run.statuses.length <= 1000, 'bounded status text'); previous = -1;
    for (const status of run.statuses) {
      check(inRun(status.timeMs) && status.timeMs >= previous && Number.isInteger(status.severity) && status.severity >= 0 && status.severity <= 7 && text(status.text), 'status text envelope'); previous = status.timeMs;
    }
  }
  return trace;
}
