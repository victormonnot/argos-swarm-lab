// Recorded autopilot estimates, command admission and measured execution are separate.
const TYPES = ['LOCAL_POSITION_NED', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'HEARTBEAT', 'EXTENDED_SYS_STATE'];
const STAGES = ['guided', 'arm', 'takeoff', 'waypoint', 'land', 'observation'];
export const resultNames = { 0: 'Accepted', 1: 'Temporarily rejected', 2: 'Denied', 3: 'Unsupported', 4: 'Failed', 5: 'In progress', 6: 'Cancelled', 7: 'Command long only', 8: 'Command int only', 9: 'Unsupported frame' };
export const landedNames = { 0: 'Undefined', 1: 'On ground', 2: 'In air', 3: 'Taking off', 4: 'Landing' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const text = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => finite(value) && value >= 0 && value <= 180_000;
const check = (condition, message) => { if (!condition) throw new Error(`Invalid SITL trace: ${message}`); };
const position = sample => sample ? [sample.data.x, sample.data.y, sample.data.z] : null;
const velocity = sample => sample ? [sample.data.vx, sample.data.vy, sample.data.vz] : null;
const armed = sample => sample ? (sample.data.base_mode & 128) !== 0 : null;
const acceptedAt = (run, id, timeMs) => run.acks.filter(ack => ack.commandId === id && ack.timeMs <= timeMs).at(-1)?.result === 0;
const fresh = (sample, timeMs, maxAge, after = 0) => sample && sample.timeMs >= after && timeMs - sample.timeMs <= maxAge;

export function nedToEnu(ned, origin = [0, 0, 0]) {
  if (!vector(ned) || !vector(origin)) throw new TypeError('NED coordinates must be three finite numbers.');
  return [ned[1] - origin[1], ned[0] - origin[0], -(ned[2] - origin[2])];
}

/** Independent receipt-driven execution checks. ACK acceptance alone is insufficient. */
export function completionEvidence(run, stage, untilMs = run.endMs) {
  const command = run.commands.find(item => item.id === stage);
  if (!command || stage === 'observation') return null;
  const cfg = run.config, latest = {}, start = command.timeMs;
  let goodSince = null, previousPositionMs = null, wasAirborne = false;
  for (const sample of run.telemetry) {
    if (sample.timeMs > untilMs) break;
    latest[sample.type] = sample;
    if (sample.type === 'EXTENDED_SYS_STATE' && sample.data.landed_state === 2) wasAirborne = true;
    if (sample.timeMs < start) continue;
    const now = sample.timeMs;
    if (stage === 'guided' || stage === 'arm') {
      if (sample.type !== 'HEARTBEAT' || !acceptedAt(run, stage, now)) continue;
      if (stage === 'guided' ? sample.data.custom_mode === 4 : armed(sample)) return { timeMs: now, sample };
    } else if (stage === 'land') {
      if (!['HEARTBEAT', 'EXTENDED_SYS_STATE'].includes(sample.type) || !acceptedAt(run, stage, now)) continue;
      const heartbeat = latest.HEARTBEAT, landed = latest.EXTENDED_SYS_STATE;
      if (wasAirborne && fresh(heartbeat, now, cfg.heartbeatFreshnessMs, start)
        && fresh(landed, now, cfg.landedFreshnessMs, start)
        && !armed(heartbeat) && landed.data.landed_state === 1) return { timeMs: now, sample };
    } else if (sample.type === 'LOCAL_POSITION_NED') {
      const speed = Math.hypot(...velocity(sample));
      let good = speed <= cfg.speedToleranceMps;
      if (stage === 'takeoff') {
        const global = latest.GLOBAL_POSITION_INT;
        good = good && acceptedAt(run, stage, now) && fresh(global, now, cfg.freshnessMs, start)
          && Math.abs(global.data.relative_alt / 1000 - cfg.takeoffAltitudeM) <= cfg.takeoffToleranceM;
      } else if (stage === 'waypoint') {
        good = good && Math.hypot(...position(sample).map((value, axis) => value - command.positionNed[axis])) <= cfg.positionToleranceM;
      }
      if (!good) goodSince = null;
      else if (goodSince === null || previousPositionMs === null || now - previousPositionMs > cfg.maxSampleGapMs) goodSince = now;
      previousPositionMs = now;
      if (goodSince !== null && now - goodSince >= cfg.dwellMs) return { timeMs: now, sample };
    }
  }
  return null;
}

export function validateSitlTrace(trace) {
  check(trace && trace.schemaVersion === 1 && trace.kind === 'argos-ardupilot-sitl', 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['recordedAt', 'ardupilotVersion', 'binaryUrl', 'firmwareGitHash', 'pymavlink', 'python', 'image', 'platform'].every(key => text(runtime[key])), 'runtime metadata');
  check(Number.isFinite(Date.parse(runtime.recordedAt)) && ['binarySha256', 'sourceSha256', 'paramsSha256'].every(key => hash(runtime[key])), 'runtime fingerprints');
  check(runtime.model === 'quad' && runtime.speedup === 1 && runtime.clock === 'recorder-monotonic-receipt'
    && runtime.transport === 'tcp-loopback' && runtime.mavlinkVersion === 2, 'simulation and transport contract');
  check(Array.isArray(trace.cases) && trace.cases.length >= 1 && trace.cases.length <= 2, 'one or two recordings');
  const ids = new Set(), runs = new Set();
  for (const run of trace.cases) {
    check(run && ['nominal', 'disarmed'].includes(run.id) && !ids.has(run.id) && text(run.label), 'case identity'); ids.add(run.id);
    check(text(run.runId, 100) && !runs.has(run.runId), 'unique run identity'); runs.add(run.runId);
    check(run.vehicle?.systemId === 1 && run.vehicle.componentId === 1 && run.controller?.systemId === 255 && run.controller.componentId === 190, 'vehicle and controller identities');
    check(vector(run.originNed) && run.originNed.every(value => Math.abs(value) < 1000), 'local origin');
    const cfg = run.config;
    const expected = { takeoffAltitudeM: 4, takeoffToleranceM: .35, positionToleranceM: .5, speedToleranceMps: .4,
      dwellMs: 1000, freshnessMs: 500, maxSampleGapMs: 300, heartbeatFreshnessMs: 1500,
      landedFreshnessMs: 1500, ackTimeoutMs: 3000, takeoffTimeoutMs: 30000,
      waypointTimeoutMs: 40000, landTimeoutMs: 45000, rejectionObserveMs: 5000 };
    check(cfg && Object.entries(expected).every(([key, value]) => cfg[key] === value)
      && vector(cfg.waypointOffsetNed) && cfg.waypointOffsetNed.every((v, i) => v === [8, 5, -4][i]), 'declared completion criteria');
    check(stamp(run.endMs) && run.endMs > 0 && run.outcome
      && ['completed', 'rejected', 'timeout'].includes(run.outcome.status) && text(run.outcome.reason), 'recording outcome');
    check(run.parameters && typeof run.parameters === 'object' && !Array.isArray(run.parameters)
      && Object.keys(run.parameters).length <= 100 && Object.values(run.parameters).every(finite), 'recorded parameters');
    check(run.parameters.ARMING_SKIPCHK === 0, 'all arming checks remain enabled');
    check(Array.isArray(run.commands) && run.commands.length >= 1 && run.commands.length <= 5, 'bounded command sequence');
    const order = run.id === 'nominal' ? ['guided', 'arm', 'takeoff', 'waypoint', 'land'] : ['guided', 'takeoff'];
    let previous = -1;
    for (const [index, command] of run.commands.entries()) {
      check(command && command.id === order[index] && stamp(command.timeMs) && command.timeMs > previous && command.timeMs <= run.endMs, 'serialized command order'); previous = command.timeMs;
      check(command.targetSystem === run.vehicle.systemId && command.targetComponent === run.vehicle.componentId, 'command destination');
      if (command.id === 'waypoint') {
        check(command.kind === 'setpoint' && command.message === 'SET_POSITION_TARGET_LOCAL_NED' && command.command === null
          && command.frame === 1 && command.mask === 3576 && vector(command.positionNed)
          && command.positionNed.every((v, i) => Math.abs(v - run.originNed[i] - cfg.waypointOffsetNed[i]) < 1e-6), 'local position setpoint');
      } else {
        const commandIds = { guided: 176, arm: 400, takeoff: 22, land: 21 };
        check(command.kind === 'command' && command.message === 'COMMAND_LONG' && command.command === commandIds[command.id]
          && Array.isArray(command.params) && command.params.length === 7 && command.params.every(finite), 'command envelope');
        if (command.id === 'guided') check(command.params[0] === 1 && command.params[1] === 4, 'Guided mode request');
        if (command.id === 'arm') check(command.params[0] === 1 && command.params[1] === 0, 'normal arm without force');
        if (command.id === 'takeoff') check(command.params[6] === cfg.takeoffAltitudeM, 'takeoff height request');
      }
    }
    check(Array.isArray(run.acks) && run.acks.length <= 30, 'bounded acknowledgements'); previous = -1;
    const terminalAcks = new Set();
    for (const ack of run.acks) {
      const command = run.commands.find(item => item.id === ack?.commandId);
      check(command && command.kind === 'command' && ack.command === command.command, 'ACK belongs to a command, not a position target');
      check(stamp(ack.timeMs) && ack.timeMs >= previous && ack.timeMs >= command.timeMs && ack.timeMs <= run.endMs, 'ACK receipt time'); previous = ack.timeMs;
      check(ack.sourceSystem === run.vehicle.systemId && ack.sourceComponent === run.vehicle.componentId
        && ack.targetSystem === run.controller.systemId && ack.targetComponent === run.controller.componentId, 'ACK source and destination');
      check(Number.isInteger(ack.result) && Object.hasOwn(resultNames, ack.result), 'ACK result');
      check(!terminalAcks.has(ack.commandId), 'one terminal ACK per serialized request');
      if (ack.result !== 5) terminalAcks.add(ack.commandId);
    }
    check(Array.isArray(run.telemetry) && run.telemetry.length > 0 && run.telemetry.length <= 15000, 'bounded telemetry'); previous = -1;
    for (const sample of run.telemetry) {
      check(sample && TYPES.includes(sample.type) && stamp(sample.timeMs) && sample.timeMs >= previous && sample.timeMs <= run.endMs, 'telemetry type and receipt time'); previous = sample.timeMs;
      check(sample.sourceSystem === run.vehicle.systemId && sample.sourceComponent === run.vehicle.componentId && sample.data && typeof sample.data === 'object', 'telemetry source and data');
      const data = sample.data;
      const fields = { LOCAL_POSITION_NED: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'time_boot_ms'],
        ATTITUDE: ['roll', 'pitch', 'yaw', 'time_boot_ms'], GLOBAL_POSITION_INT: ['relative_alt', 'time_boot_ms'],
        HEARTBEAT: ['base_mode', 'custom_mode'], EXTENDED_SYS_STATE: ['landed_state'] }[sample.type];
      check(fields.every(key => finite(data[key])), 'finite telemetry fields');
      if ('time_boot_ms' in data) check(Number.isSafeInteger(data.time_boot_ms) && data.time_boot_ms >= 0 && data.time_boot_ms <= 0xffffffff, 'separate vehicle boot timestamp');
      if (sample.type === 'HEARTBEAT') check(Number.isInteger(data.base_mode) && data.base_mode >= 0 && data.base_mode <= 255
        && Number.isInteger(data.custom_mode) && data.custom_mode >= 0, 'heartbeat mode fields');
      if (sample.type === 'EXTENDED_SYS_STATE') check(Number.isInteger(data.landed_state) && Object.hasOwn(landedNames, data.landed_state), 'land detector state');
    }
    check(Array.isArray(run.events) && run.events.length <= 30, 'bounded execution events'); previous = -1;
    const starts = new Set(), terminals = new Set();
    for (const event of run.events) {
      check(event && STAGES.includes(event.stage) && ['start', 'complete', 'rejected', 'timeout'].includes(event.status)
        && stamp(event.timeMs) && event.timeMs >= previous && event.timeMs <= run.endMs, 'execution event vocabulary and time'); previous = event.timeMs;
      const command = run.commands.find(item => item.id === event.stage);
      if (event.status === 'start') {
        check(!starts.has(event.stage), 'single stage start'); starts.add(event.stage);
        if (event.stage !== 'observation') check(command && Math.abs(command.timeMs - event.timeMs) < 1e-3, 'stage starts with its request');
      } else {
        check(starts.has(event.stage) && !terminals.has(event.stage), 'one terminal observation after stage start'); terminals.add(event.stage);
        if (event.status === 'complete' && event.stage !== 'observation') {
          const evidence = completionEvidence(run, event.stage, event.timeMs);
          check(evidence && Math.abs(event.timeMs - evidence.timeMs) < 1e-3, 'completion requires measured fresh telemetry and dwell');
        } else if (event.status === 'rejected') {
          check(run.acks.some(ack => ack.commandId === event.stage && ![0, 5].includes(ack.result) && Math.abs(ack.timeMs - event.timeMs) < 1e-3), 'rejection requires a recorded negative ACK');
        } else if (event.status === 'complete' && event.stage === 'observation') {
          const rejected = run.events.find(item => item.stage === 'takeoff' && item.status === 'rejected');
          const observation = run.events.find(item => item.stage === 'observation' && item.status === 'start');
          check(run.id === 'disarmed' && rejected && observation && observation.timeMs >= rejected.timeMs
            && event.timeMs - observation.timeMs >= cfg.rejectionObserveMs, 'bounded observation after rejection');
          const latest = {};
          for (const sample of run.telemetry) if (sample.timeMs <= event.timeMs) latest[sample.type] = sample;
          check(fresh(latest.HEARTBEAT, event.timeMs, cfg.heartbeatFreshnessMs, observation.timeMs)
            && !armed(latest.HEARTBEAT)
            && fresh(latest.EXTENDED_SYS_STATE, event.timeMs, cfg.landedFreshnessMs, observation.timeMs)
            && latest.EXTENDED_SYS_STATE.data.landed_state === 1, 'post-rejection observation requires fresh ground and disarmed reports');
        } else if (event.status === 'timeout') {
          check(command, 'a timeout must belong to a requested stage');
          const lastAck = run.acks.filter(ack => ack.commandId === command.id && ack.timeMs <= event.timeMs).at(-1);
          let deadline = command.timeMs + cfg.ackTimeoutMs;
          if (command.kind === 'setpoint') deadline = command.timeMs + cfg.waypointTimeoutMs;
          else if (lastAck?.result === 0) {
            const budget = { guided: cfg.ackTimeoutMs, arm: cfg.ackTimeoutMs,
              takeoff: cfg.takeoffTimeoutMs, land: cfg.landTimeoutMs }[command.id];
            deadline = lastAck.timeMs + budget;
          } else check(!lastAck || lastAck.result === 5, 'negative ACK is a rejection, not a timeout');
          check(event.timeMs + 1e-3 >= deadline && !completionEvidence(run, event.stage, event.timeMs), 'timeout requires an elapsed deadline without completion evidence');
        }
      }
    }
    for (const command of run.commands) check(starts.has(command.id), 'every request has a stage start');
    // A later request must follow measured completion of its prerequisite.
    for (let i = 1; i < run.commands.length; i++) {
      const prior = run.commands[i - 1], next = run.commands[i];
      check(run.events.some(event => event.stage === prior.id && event.status === 'complete' && event.timeMs <= next.timeMs), 'execution order follows measured completion');
    }
    if (run.outcome.status === 'completed') {
      check(run.id === 'nominal' && run.events.some(event => event.stage === 'land' && event.status === 'complete'), 'flight completion requires landed and disarmed evidence');
    } else if (run.outcome.status === 'rejected') {
      check(run.events.some(event => event.status === 'rejected'), 'rejected outcome requires a negative ACK');
      if (run.id === 'disarmed') check(run.events.some(event => event.stage === 'observation' && event.status === 'complete'), 'rejection observation completed');
    } else check(run.events.some(event => event.status === 'timeout'), 'timeout outcome requires an observed deadline');
    if (run.id === 'disarmed') {
      check(run.telemetry.every(sample => sample.type !== 'HEARTBEAT' || !armed(sample)), 'disarmed case must remain disarmed');
      check(run.telemetry.every(sample => sample.type !== 'EXTENDED_SYS_STATE' || sample.data.landed_state <= 1), 'disarmed case cannot report flight');
    }
    check(Array.isArray(run.statuses) && run.statuses.length <= 1000, 'bounded status text'); previous = -1;
    for (const item of run.statuses) {
      check(item && stamp(item.timeMs) && item.timeMs >= previous && item.timeMs <= run.endMs
        && Number.isInteger(item.severity) && item.severity >= 0 && item.severity <= 7 && text(item.text, 500), 'recorded status text'); previous = item.timeMs;
    }
  }
  return trace;
}

export function sitlEvents(run) {
  return [['command', run.commands], ['ack', run.acks], ['telemetry', run.telemetry], ['stage', run.events], ['status', run.statuses]]
    .flatMap(([kind, items]) => items.map(data => ({ timeMs: data.timeMs, kind, data }))).sort((a, b) => a.timeMs - b.timeMs);
}

export function sitlFrame(run, timeMs) {
  if (!finite(timeMs) || timeMs < 0 || timeMs > run.endMs) throw new RangeError('Replay time is outside the recording.');
  const latest = Object.fromEntries(TYPES.map(type => [type, null]));
  const telemetry = run.telemetry.filter(item => item.timeMs <= timeMs);
  for (const sample of telemetry) latest[sample.type] = sample;
  const commands = run.commands.filter(item => item.timeMs <= timeMs), acks = run.acks.filter(item => item.timeMs <= timeMs);
  const events = run.events.filter(item => item.timeMs <= timeMs), statuses = run.statuses.filter(item => item.timeMs <= timeMs);
  const local = latest.LOCAL_POSITION_NED, rotation = latest.ATTITUDE, heartbeat = latest.HEARTBEAT;
  const positionNed = position(local), velocityNed = velocity(local), modeId = heartbeat?.data.custom_mode;
  const target = commands.filter(item => ['takeoff', 'waypoint'].includes(item.id)).at(-1);
  return {
    timeMs, latest, positionNed, relativeNed: positionNed?.map((v, i) => v - run.originNed[i]) ?? null,
    positionEnu: positionNed ? nedToEnu(positionNed, run.originNed) : null, velocityNed,
    speedMps: velocityNed ? Math.hypot(...velocityNed) : null,
    attitude: rotation ? { roll: rotation.data.roll, pitch: rotation.data.pitch, yaw: rotation.data.yaw } : null,
    relativeAltitudeM: latest.GLOBAL_POSITION_INT ? latest.GLOBAL_POSITION_INT.data.relative_alt / 1000 : null,
    mode: heartbeat ? ({ 0: 'Stabilize', 4: 'Guided', 9: 'Land' }[modeId] ?? `Mode ${modeId}`) : null,
    armed: armed(heartbeat), landedState: latest.EXTENDED_SYS_STATE?.data.landed_state ?? null,
    positionAgeMs: local ? timeMs - local.timeMs : null, attitudeAgeMs: rotation ? timeMs - rotation.timeMs : null,
    heartbeatAgeMs: heartbeat ? timeMs - heartbeat.timeMs : null,
    landedAgeMs: latest.EXTENDED_SYS_STATE ? timeMs - latest.EXTENDED_SYS_STATE.timeMs : null,
    commands, acks, events, statuses, stage: events.at(-1)?.stage ?? 'ready',
    completedStages: events.filter(item => item.status === 'complete').map(item => item.stage),
    targetNed: target ? target.id === 'waypoint' ? [...target.positionNed] : [run.originNed[0], run.originNed[1], run.originNed[2] - run.config.takeoffAltitudeM] : null,
    trajectory: telemetry.filter(item => item.type === 'LOCAL_POSITION_NED'),
    commandStates: commands.map(command => {
      const ack = acks.filter(item => item.commandId === command.id).at(-1) ?? null;
      return { id: command.id, command, ack,
        admission: command.kind === 'setpoint' ? 'not-applicable' : !ack || ack.result === 5 ? 'pending' : ack.result === 0 ? 'accepted' : 'rejected',
        completionEvent: events.find(item => item.stage === command.id && item.status === 'complete') ?? null };
    }),
    outcome: timeMs >= run.endMs ? run.outcome : null,
  };
}

export function sitlSummary(run) {
  const completion = stage => run.events.find(item => item.stage === stage && item.status === 'complete')?.timeMs ?? null;
  const ack = id => run.acks.filter(item => item.commandId === id).at(-1) ?? null;
  const takeoff = ack('takeoff'), land = ack('land'), takeoffReachedMs = completion('takeoff');
  const final = sitlFrame(run, run.endMs);
  const heights = run.telemetry.filter(item => item.type === 'GLOBAL_POSITION_INT').map(item => item.data.relative_alt / 1000);
  const speeds = run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED').map(item => Math.hypot(...velocity(item)));
  return {
    takeoffAckMs: takeoff?.timeMs ?? null, takeoffReachedMs,
    waypointSentMs: run.commands.find(item => item.id === 'waypoint')?.timeMs ?? null,
    waypointReachedMs: completion('waypoint'), landAckMs: land?.timeMs ?? null, landedMs: completion('land'),
    takeoffAdmission: !takeoff || takeoff.result === 5 ? 'pending' : takeoff.result === 0 ? 'accepted' : 'rejected',
    ackToTakeoffMs: takeoff?.result === 0 && takeoffReachedMs !== null ? takeoffReachedMs - takeoff.timeMs : null,
    maxRelativeAltitudeM: heights.length ? Math.max(...heights) : null, maxSpeedMps: speeds.length ? Math.max(...speeds) : null,
    telemetryCount: run.telemetry.length, finalPositionNed: final.positionNed,
    finalArmed: final.armed, finalLandedState: final.landedState, outcome: run.outcome,
  };
}
