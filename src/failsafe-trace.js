import { completionEvidence, sitlEvents, sitlFrame, resultNames } from './sitl-trace.js';
export { resultNames, landedNames } from './sitl-trace.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const text = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = (condition, message) => { if (!condition) throw new Error(`Invalid failsafe trace: ${message}`); };
const close = (a, b) => Math.abs(a - b) < 1e-3;
const eventAt = (run, stage, status) => run.events.find(event => event.stage === stage && event.status === status) ?? null;
const statusAt = (run, text, untilMs) => run.statuses.find(sample => sample.timeMs <= untilMs && sample.text === text) ?? null;
const TYPES = ['LOCAL_POSITION_NED', 'GLOBAL_POSITION_INT', 'ATTITUDE', 'HEARTBEAT', 'EXTENDED_SYS_STATE'];

function landModeEvidence(run, untilMs) {
  const after = run.id === 'loss' ? run.blackout?.startTimeMs : run.commands.find(command => command.id === 'land')?.timeMs;
  if (after === undefined) return null;
  return run.telemetry.find(sample => sample.timeMs >= after && sample.timeMs <= untilMs
    && sample.type === 'HEARTBEAT' && sample.data.custom_mode === 9) ?? null;
}

/** An automatic LAND has no command ACK. Its completion still needs fresh reports. */
export function failsafeLandingEvidence(run, untilMs = run.endMs) {
  if (run.id === 'nominal') return completionEvidence(run, 'land', untilMs);
  const onset = statusAt(run, 'GCS Failsafe', untilMs);
  if (!onset) return null;
  const landMode = landModeEvidence(run, untilMs);
  let heartbeat = null, landed = null, wasAirborne = false;
  for (const sample of run.telemetry) {
    if (sample.timeMs > untilMs) break;
    if (sample.type === 'EXTENDED_SYS_STATE') {
      landed = sample;
      if (sample.data.landed_state === 2) wasAirborne = true;
    }
    if (sample.type === 'HEARTBEAT') {
      heartbeat = sample;
    }
    if (!['HEARTBEAT', 'EXTENDED_SYS_STATE'].includes(sample.type) || !landMode || !wasAirborne || !heartbeat || !landed) continue;
    if (heartbeat.timeMs >= landMode.timeMs && landed.timeMs >= landMode.timeMs
      && sample.timeMs - heartbeat.timeMs <= run.config.heartbeatFreshnessMs
      && sample.timeMs - landed.timeMs <= run.config.landedFreshnessMs
      && heartbeat.data.custom_mode === 9 && !(heartbeat.data.base_mode & 128) && landed.data.landed_state === 1) {
      return { timeMs: sample.timeMs, sample };
    }
  }
  return null;
}

/** Received GCS-specific status text is evidence; a send-age threshold is not. */
export function failsafeEvidence(run, untilMs = run.endMs) {
  const onset = statusAt(run, 'GCS Failsafe', untilMs);
  const clear = onset ? run.statuses.find(sample => sample.timeMs > onset.timeMs
    && sample.timeMs <= untilMs && sample.text === 'GCS Failsafe Cleared') ?? null : null;
  // Independent channels can deliver the mode heartbeat before the status text.
  const landMode = landModeEvidence(run, untilMs);
  return { active: onset ? !clear : null, onset, clear, landMode, landing: failsafeLandingEvidence(run, untilMs) };
}

export function failsafeEvents(run) {
  return [...sitlEvents(run), ...run.heartbeatTx.map(data => ({ kind: 'heartbeat-tx', timeMs: data.timeMs, data }))]
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function failsafeFrame(run, timeMs) {
  const base = sitlFrame(run, timeMs);
  const sent = run.heartbeatTx.filter(sample => sample.timeMs <= timeMs), lastTx = sent.at(-1) ?? null;
  const suppressed = run.blackout !== null && timeMs >= run.blackout.startTimeMs && timeMs < run.blackout.endTimeMs;
  const observation = eventAt(run, 'observation', 'start'), end = eventAt(run, 'observation', 'complete');
  return { ...base,
    gcs: { lastTx, ageMs: lastTx ? timeMs - lastTx.timeMs : null, enabled: !suppressed,
      phase: suppressed ? 'suppressed' : 'sending', txCount: sent.length },
    failsafe: failsafeEvidence(run, timeMs),
    observation: Boolean(observation && timeMs >= observation.timeMs && (!end || timeMs < end.timeMs)),
  };
}

export function failsafeSummary(run) {
  const evidence = failsafeEvidence(run), blackout = run.blackout;
  const lastTx = blackout ? run.heartbeatTx.filter(sample => sample.timeMs < blackout.startTimeMs).at(-1) : null;
  const resumed = blackout ? run.heartbeatTx.find(sample => sample.timeMs >= blackout.endTimeMs) : null;
  const afterRestore = resumed ? run.telemetry.find(sample => sample.timeMs >= resumed.timeMs && sample.type === 'HEARTBEAT') : null;
  const finalHeartbeat = run.telemetry.filter(sample => sample.type === 'HEARTBEAT').at(-1);
  const modeName = sample => sample ? ({ 0: 'Stabilize', 4: 'Guided', 9: 'Land' }[sample.data.custom_mode] ?? `Mode ${sample.data.custom_mode}`) : null;
  return {
    takeoffMs: eventAt(run, 'takeoff', 'complete')?.timeMs ?? null,
    observationStartMs: eventAt(run, 'observation', 'start')?.timeMs ?? null,
    observationEndMs: eventAt(run, 'observation', 'complete')?.timeMs ?? null,
    lossStartMs: blackout?.startTimeMs ?? null, restoreMs: blackout?.endTimeMs ?? null,
    firstResumedHeartbeatMs: resumed?.timeMs ?? null, lastHeartbeatBeforeLossMs: lastTx?.timeMs ?? null,
    failsafeMs: evidence.onset?.timeMs ?? null, clearMs: evidence.clear?.timeMs ?? null,
    landModeMs: evidence.landMode?.timeMs ?? null, landedMs: evidence.landing?.timeMs ?? null,
    onsetSinceLastTxMs: evidence.onset && lastTx ? evidence.onset.timeMs - lastTx.timeMs : null,
    heartbeatCount: run.heartbeatTx.length,
    telemetryDuringLoss: blackout ? run.telemetry.filter(sample => sample.timeMs >= blackout.startTimeMs && sample.timeMs < blackout.endTimeMs).length : 0,
    modeAfterRestore: modeName(afterRestore), finalMode: modeName(finalHeartbeat),
    finalArmed: finalHeartbeat ? Boolean(finalHeartbeat.data.base_mode & 128) : null,
    outcome: run.outcome,
  };
}

export function validateFailsafeTrace(trace) {
  check(trace?.kind === 'argos-ardupilot-failsafe' && trace.schemaVersion === 1, 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['recordedAt', 'ardupilotVersion', 'binaryUrl', 'firmwareGitHash', 'pymavlink', 'python', 'image', 'baseImage'].every(key => text(runtime[key])), 'runtime metadata');
  check(Number.isFinite(Date.parse(runtime.recordedAt)) && ['sourceSha256', 'sitlSourceSha256', 'dockerfileSha256', 'binarySha256', 'paramsSha256'].every(key => hash(runtime[key])), 'runtime fingerprints');
  check(runtime.model === 'quad' && runtime.modelArgument === '+' && runtime.speedup === 1
    && runtime.clock === 'recorder-monotonic-receipt' && runtime.heartbeatClock === 'recorder-monotonic-send' && runtime.transport === 'tcp-loopback'
    && runtime.mavlinkVersion === 2 && runtime.platform === 'linux-amd64', 'simulation and transport contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 2, 'one or two recordings');
  const ids = new Set(), runIds = new Set();
  for (const run of trace.cases) {
    check(run && ['nominal', 'loss'].includes(run.id) && !ids.has(run.id) && text(run.label) && text(run.runId, 100) && !runIds.has(run.runId), 'unique case and run identities');
    ids.add(run.id); runIds.add(run.runId);
    check(finite(run.endMs) && run.endMs > 0 && run.endMs <= 180000, 'bounded recording');
    const inRun = value => finite(value) && value >= 0 && value <= run.endMs;
    check(run.vehicle?.systemId === 1 && run.vehicle.componentId === 1 && run.controller?.systemId === 255 && run.controller.componentId === 190, 'vehicle and GCS identities');
    check(vector(run.originNed) && run.originNed.every(value => Math.abs(value) < 1000), 'local origin');
    const cfg = run.config;
    const expected = { takeoffAltitudeM: 4, takeoffToleranceM: .35, speedToleranceMps: .4,
      dwellMs: 1000, freshnessMs: 500, maxSampleGapMs: 300, heartbeatFreshnessMs: 1500,
      landedFreshnessMs: 1500, heartbeatIntervalMs: 1000, observationDurationMs: 14000,
      lossDelayMs: 2000, lossDurationMs: 8000, gcsTimeoutMs: 3000,
      ackTimeoutMs: 3000, takeoffTimeoutMs: 30000, landTimeoutMs: 45000 };
    check(cfg && Object.entries(expected).every(([key, value]) => cfg[key] === value), 'declared timing and completion criteria');
    const params = { ARMING_SKIPCHK: 0, FS_GCS_ENABLE: 5, FS_GCS_TIMEOUT: 3, FS_OPTIONS: 0,
      MAV_GCS_SYSID: 255, MAV_GCS_SYSID_HI: 0, SIM_WIND_SPD: 0,
      FRAME_CLASS: 1, FRAME_TYPE: 0, FS_THR_ENABLE: 1 };
    check(run.parameters && Object.entries(params).every(([key, value]) => run.parameters[key] === value), 'read-back arming, identity and failsafe parameters');
    check(run.setup && finite(run.setup.durationMs) && run.setup.durationMs > 0
      && Number.isInteger(run.setup.heartbeatCount) && run.setup.heartbeatCount >= 2
      && finite(run.setup.lastHeartbeatBeforeOriginMs) && run.setup.lastHeartbeatBeforeOriginMs <= 0, 'prior GCS heartbeat establishment');
    check(Array.isArray(run.commands) && run.commands.length === (run.id === 'nominal' ? 4 : 3), 'bounded flight commands; automatic LAND is not a sent command');
    let previous = -1;
    for (const [index, command] of run.commands.entries()) {
      const [id, number, params] = [
        ['guided', 176, [1, 4, 0, 0, 0, 0, 0]], ['arm', 400, [1, 0, 0, 0, 0, 0, 0]],
        ['takeoff', 22, [0, 0, 0, 0, 0, 0, 4]], ['land', 21, [0, 0, 0, 0, 0, 0, 0]],
      ][index];
      check(command && command.id === id && command.command === number && command.kind === 'command'
        && command.message === 'COMMAND_LONG' && command.targetSystem === 1 && command.targetComponent === 1
        && inRun(command.timeMs) && command.timeMs > previous && Array.isArray(command.params)
        && command.params.length === 7 && command.params.every((value, axis) => value === params[axis]), 'serialized normal command envelopes');
      previous = command.timeMs;
    }
    check(Array.isArray(run.acks) && run.acks.length <= 20, 'bounded ACKs'); previous = -1;
    const terminal = new Set();
    for (const ack of run.acks) {
      const command = run.commands.find(command => command.id === ack?.commandId);
      check(command && ack.command === command.command && inRun(ack.timeMs) && ack.timeMs >= command.timeMs && ack.timeMs >= previous
        && ack.sourceSystem === 1 && ack.sourceComponent === 1 && ack.targetSystem === 255 && ack.targetComponent === 190
        && Number.isInteger(ack.result) && Object.hasOwn(resultNames, ack.result), 'ACK association and identities');
      check(!terminal.has(ack.commandId), 'one terminal ACK per serialized request');
      if (ack.result !== 5) terminal.add(ack.commandId);
      previous = ack.timeMs;
    }
    check(Array.isArray(run.telemetry) && run.telemetry.length > 0 && run.telemetry.length <= 15000, 'bounded vehicle telemetry'); previous = -1;
    for (const sample of run.telemetry) {
      check(sample && TYPES.includes(sample.type) && inRun(sample.timeMs) && sample.timeMs >= previous
        && sample.sourceSystem === 1 && sample.sourceComponent === 1, 'telemetry identity and receipt order');
      const fields = { LOCAL_POSITION_NED: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'time_boot_ms'],
        GLOBAL_POSITION_INT: ['relative_alt', 'time_boot_ms'], ATTITUDE: ['roll', 'pitch', 'yaw', 'time_boot_ms'],
        HEARTBEAT: ['base_mode', 'custom_mode', 'system_status'], EXTENDED_SYS_STATE: ['landed_state'] }[sample.type];
      check(sample.data && fields.every(key => finite(sample.data[key])), 'finite telemetry fields');
      if ('time_boot_ms' in sample.data) check(Number.isSafeInteger(sample.data.time_boot_ms) && sample.data.time_boot_ms >= 0 && sample.data.time_boot_ms <= 0xffffffff, 'vehicle boot clock');
      if (sample.type === 'HEARTBEAT') check(Number.isInteger(sample.data.base_mode) && sample.data.base_mode >= 0 && sample.data.base_mode <= 255
        && Number.isInteger(sample.data.custom_mode) && sample.data.custom_mode >= 0
        && Number.isInteger(sample.data.system_status) && sample.data.system_status >= 0 && sample.data.system_status <= 8, 'vehicle heartbeat fields');
      if (sample.type === 'EXTENDED_SYS_STATE') check(Number.isInteger(sample.data.landed_state) && sample.data.landed_state >= 0 && sample.data.landed_state <= 4, 'land detector state');
      previous = sample.timeMs;
    }
    const firstPosition = run.telemetry.find(sample => sample.type === 'LOCAL_POSITION_NED');
    check(firstPosition && inRun(run.originTimeMs) && close(firstPosition.timeMs, run.originTimeMs)
      && ['x', 'y', 'z'].every((key, axis) => close(firstPosition.data[key], run.originNed[axis])), 'recorded position baseline');
    check(Array.isArray(run.statuses) && run.statuses.length <= 300, 'bounded status messages'); previous = -1;
    for (const sample of run.statuses) {
      check(sample && inRun(sample.timeMs) && sample.timeMs >= previous && text(sample.text, 500)
        && Number.isInteger(sample.severity) && sample.severity >= 0 && sample.severity <= 7, 'status text and receipt order');
      previous = sample.timeMs;
    }
    check(Array.isArray(run.events) && run.events.length <= 30, 'bounded stage events'); previous = -1;
    const starts = new Map(), ends = new Map();
    const stages = ['guided', 'arm', 'takeoff', 'observation', ...(run.id === 'nominal' ? ['land'] : ['landing', 'heartbeat-loss', 'failsafe'])];
    for (const event of run.events) {
      check(event && stages.includes(event.stage)
        && ['start', 'complete'].includes(event.status) && inRun(event.timeMs) && event.timeMs >= previous, 'stage vocabulary and receipt order');
      const collection = event.status === 'start' ? starts : ends;
      check(!collection.has(event.stage), 'one stage start and completion'); collection.set(event.stage, event);
      if (event.status === 'complete') check(starts.has(event.stage), 'stage completion follows its start');
      previous = event.timeMs;
    }
    for (const [index, command] of run.commands.entries()) {
      check(starts.has(command.id) && close(starts.get(command.id).timeMs, command.timeMs), 'flight stage starts at its request');
      const evidence = completionEvidence(run, command.id);
      check(evidence && ends.has(command.id) && close(ends.get(command.id).timeMs, evidence.timeMs), 'flight completion requires raw fresh telemetry');
      if (index) check(ends.get(run.commands[index - 1].id).timeMs <= command.timeMs, 'flight requests follow measured prerequisites');
    }
    const observation = starts.get('observation'), observed = ends.get('observation');
    check(observation && observed && observation.timeMs >= ends.get('takeoff').timeMs
      && observed.timeMs - observation.timeMs >= cfg.observationDurationMs, 'bounded post-takeoff observation');
    check(run.commands.every(command => command.timeMs <= observation.timeMs || command.timeMs >= observed.timeMs), 'no flight command during observation');
    check(Array.isArray(run.heartbeatTx) && run.heartbeatTx.length >= 3 && run.heartbeatTx.length <= 300, 'bounded outgoing heartbeats'); previous = -1;
    for (const sample of run.heartbeatTx) {
      check(sample && inRun(sample.timeMs) && sample.timeMs > previous && sample.message === 'HEARTBEAT'
        && sample.sourceSystem === 255 && sample.sourceComponent === 190, 'GCS heartbeat envelope and send order');
      check(sample.data && Object.entries({ type: 6, autopilot: 8, base_mode: 0, custom_mode: 0, system_status: 0, mavlink_version: 3 })
        .every(([key, value]) => sample.data[key] === value), 'GCS heartbeat payload (not vehicle telemetry)');
      previous = sample.timeMs;
    }
    const evidence = failsafeEvidence(run), summary = failsafeSummary(run);
    if (run.id === 'nominal') {
      check(run.blackout === null && !starts.has('heartbeat-loss') && !starts.has('landing')
        && !starts.has('failsafe') && !evidence.onset && !evidence.clear
        && !run.statuses.some(sample => sample.text === 'GCS Failsafe Cleared'), 'nominal case has no injected loss or observed GCS failsafe');
      check(run.commands.at(-1).timeMs >= observed.timeMs, 'nominal LAND is requested after observation');
      const heartbeats = run.telemetry.filter(sample => sample.type === 'HEARTBEAT' && sample.timeMs >= observation.timeMs && sample.timeMs < observed.timeMs);
      check(heartbeats.length >= 2 && heartbeats.every(sample => sample.data.custom_mode === 4 && (sample.data.base_mode & 128)), 'nominal observation remains armed in Guided');
    } else {
      const blackout = run.blackout, start = starts.get('heartbeat-loss'), end = ends.get('heartbeat-loss');
      check(blackout && inRun(blackout.startTimeMs) && inRun(blackout.endTimeMs)
        && blackout.startTimeMs >= observation.timeMs + cfg.lossDelayMs
        && blackout.endTimeMs >= blackout.startTimeMs + cfg.lossDurationMs && blackout.endTimeMs <= observed.timeMs
        && start && end && close(start.timeMs, blackout.startTimeMs) && close(end.timeMs, blackout.endTimeMs), 'bounded heartbeat suppression and restoration');
      check(run.heartbeatTx.every(sample => sample.timeMs < blackout.startTimeMs || sample.timeMs >= blackout.endTimeMs)
        && summary.lastHeartbeatBeforeLossMs !== null && summary.firstResumedHeartbeatMs !== null, 'actual send history brackets a silent interval');
      check(evidence.onset && evidence.onset.timeMs >= blackout.startTimeMs && evidence.onset.timeMs < blackout.endTimeMs
        && evidence.onset.severity === 4 && evidence.clear && evidence.clear.timeMs >= summary.firstResumedHeartbeatMs && evidence.clear.severity === 4,
      'GCS-specific onset and clearing require received status text');
      check(run.statuses.filter(sample => sample.text === 'GCS Failsafe').length === 1
        && run.statuses.filter(sample => sample.text === 'GCS Failsafe Cleared').length === 1, 'one bounded observed GCS failsafe');
      check(evidence.landMode && evidence.landing && starts.has('landing') && ends.has('landing')
        && close(starts.get('landing').timeMs, evidence.landMode.timeMs) && close(ends.get('landing').timeMs, evidence.landing.timeMs), 'automatic LAND and landing have separate raw telemetry evidence');
      if (starts.has('failsafe')) check(ends.has('failsafe') && close(starts.get('failsafe').timeMs, evidence.onset.timeMs)
        && close(ends.get('failsafe').timeMs, evidence.clear.timeMs), 'failsafe events correspond to exact status receipts');
      const downlink = run.telemetry.filter(sample => sample.timeMs >= blackout.startTimeMs && sample.timeMs < blackout.endTimeMs);
      check(TYPES.every(type => downlink.some(sample => sample.type === type)), 'downlink observations remain present during suppression');
      const restored = run.telemetry.filter(sample => sample.type === 'HEARTBEAT' && sample.timeMs >= evidence.clear.timeMs);
      check(restored.length >= 2 && restored.every(sample => sample.data.custom_mode === 9), 'restoration does not resume Guided in this recording');
    }
    // The file records sends, not autopilot receipts. Check the declared sender
    // cadence outside the intervention, never use it to invent an AP timeout.
    const boundaries = [run.setup.lastHeartbeatBeforeOriginMs, ...run.heartbeatTx.map(sample => sample.timeMs), run.endMs];
    for (let i = 1; i < boundaries.length; i++) {
      const a = boundaries[i - 1], b = boundaries[i];
      if (i < boundaries.length - 1) check(b - a >= cfg.heartbeatIntervalMs - .001, 'heartbeat sender respects its minimum interval');
      const silent = run.blackout ? Math.max(0, Math.min(b, run.blackout.endTimeMs) - Math.max(a, run.blackout.startTimeMs)) : 0;
      check(b - a - silent <= 2000, 'heartbeat sender maintains its bounded cadence outside suppression');
    }
    check(run.outcome?.status === 'completed' && text(run.outcome.reason) && evidence.landing
      && summary.finalArmed === false && summary.finalMode === 'Land', 'final outcome requires measured landing and disarming');
  }
  return trace;
}
