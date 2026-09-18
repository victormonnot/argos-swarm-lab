import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  completionEvidence, nedToEnu, sitlEvents, sitlFrame, sitlSummary, validateSitlTrace,
} from '../src/sitl-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-sitl.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const rejected = trace.cases.find(run => run.id === 'disarmed');
const copy = () => structuredClone(trace);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const reject = change => {
  const data = copy();
  change(data);
  assert.throws(() => validateSitlTrace(data), /Invalid SITL trace:/i);
};
const sample = (type, timeMs, data) => ({ type, timeMs, sourceSystem: 1, sourceComponent: 1, data });
const cmd = (id, command, timeMs = 100) => ({ id, kind: 'command', message: 'COMMAND_LONG', command, timeMs, params: [0, 0, 0, 0, 0, 0, 4], targetSystem: 1, targetComponent: 1 });
const ack = (commandId, command, timeMs = 110) => ({ commandId, command, timeMs, result: 0, sourceSystem: 1, sourceComponent: 1, targetSystem: 255, targetComponent: 190 });
const heartbeat = (timeMs, armed = true, mode = 4) => sample('HEARTBEAT', timeMs, { base_mode: armed ? 128 : 0, custom_mode: mode });
const landed = (timeMs, state) => sample('EXTENDED_SYS_STATE', timeMs, { landed_state: state });
const position = (timeMs, xyz = [0, 0, -4], velocity = [0, 0, 0]) => sample('LOCAL_POSITION_NED', timeMs, {
  time_boot_ms: timeMs + 10000, x: xyz[0], y: xyz[1], z: xyz[2], vx: velocity[0], vy: velocity[1], vz: velocity[2],
});
const globalPosition = (timeMs, altitudeM = 4) => sample('GLOBAL_POSITION_INT', timeMs, { time_boot_ms: timeMs + 10000, relative_alt: altitudeM * 1000 });

// Small synthetic records isolate the observer's completion contract; the bundled
// recordings below supply the separate evidence that an actual autopilot ran.
function criterionRun(stage = 'takeoff', times = Array.from({ length: 11 }, (_, index) => 200 + index * 100)) {
  const run = {
    id: 'nominal', config: structuredClone(nominal.config), originNed: [0, 0, 0], endMs: 5000,
    commands: [cmd(stage, stage === 'takeoff' ? 22 : 21)], acks: [ack(stage, stage === 'takeoff' ? 22 : 21)],
    telemetry: [heartbeat(120), landed(130, 2)], events: [], statuses: [],
  };
  for (const time of times) run.telemetry.push(globalPosition(time), position(time));
  run.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  return run;
}

test('recorded SITL runs validate without mutation and preserve pinned runtime provenance', () => {
  const before = copy();
  assert.equal(validateSitlTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.cases.length, 2);
  assert.equal(trace.runtime.model, 'quad');
  assert.equal(trace.runtime.speedup, 1);
  assert.equal(trace.runtime.transport, 'tcp-loopback');
  assert.equal(trace.runtime.mavlinkVersion, 2);
  assert.match(trace.runtime.firmwareGitHash, /^[a-f0-9]{40}$/i);
  assert.match(trace.runtime.binarySha256, /^[a-f0-9]{64}$/i);
  assert.notEqual(nominal.runId, rejected.runId);
  for (const run of trace.cases) {
    assert.deepEqual(run.vehicle, { systemId: 1, componentId: 1 });
    assert.deepEqual(run.controller, { systemId: 255, componentId: 190 });
  }
});

test('NED converts to ENU with the correct basis, sign and supplied origin', () => {
  nedToEnu([1, 0, 0]).forEach((value, axis) => close(value, [0, 1, 0][axis]));
  nedToEnu([0, 1, 0]).forEach((value, axis) => close(value, [1, 0, 0][axis]));
  assert.deepEqual(nedToEnu([0, 0, -1]), [0, 0, 1]);
  assert.deepEqual(nedToEnu([8, 5, -4], [1, 2, -1]), [3, 7, 3]);
});

test('accepted takeoff ACK precedes measured height completion and does not mark it complete', () => {
  const summary = sitlSummary(nominal);
  assert.equal(summary.takeoffAdmission, 'accepted');
  assert.ok(summary.takeoffReachedMs > summary.takeoffAckMs + nominal.config.dwellMs);
  const atAck = sitlFrame(nominal, summary.takeoffAckMs);
  assert.equal(atAck.completedStages.includes('takeoff'), false);
  assert.equal(atAck.outcome, null);
  assert.equal(completionEvidence(nominal, 'takeoff', summary.takeoffAckMs), null);
  const evidence = completionEvidence(nominal, 'takeoff');
  close(evidence.timeMs, summary.takeoffReachedMs);
  close(summary.ackToTakeoffMs, summary.takeoffReachedMs - summary.takeoffAckMs);
});

test('the waypoint is a NED position setpoint with no command acknowledgement', () => {
  const command = nominal.commands.find(item => item.id === 'waypoint');
  assert.equal(command.kind, 'setpoint');
  assert.equal(command.message, 'SET_POSITION_TARGET_LOCAL_NED');
  assert.equal(command.command, null);
  assert.equal(command.frame, 1);
  assert.equal(command.mask, 3576);
  assert.deepEqual(command.positionNed.map((value, axis) => value - nominal.originNed[axis]), nominal.config.waypointOffsetNed);
  assert.equal(nominal.acks.some(item => item.commandId === command.id), false);
  const state = sitlFrame(nominal, nominal.endMs).commandStates.find(item => item.id === 'waypoint');
  assert.equal(state.admission, 'not-applicable');
  assert.equal(state.ack, null);
  assert.ok(state.completionEvent);
});

test('disarmed takeoff records the actual failed ACK without later flight completion', () => {
  assert.equal(rejected.commands.some(item => item.id === 'arm'), false);
  assert.equal(rejected.acks.find(item => item.commandId === 'takeoff').result, 4);
  assert.equal(completionEvidence(rejected, 'takeoff'), null);
  const summary = sitlSummary(rejected), frame = sitlFrame(rejected, rejected.endMs);
  assert.equal(summary.takeoffAdmission, 'rejected');
  assert.equal(summary.takeoffReachedMs, null);
  assert.equal(summary.waypointReachedMs, null);
  assert.equal(summary.landedMs, null);
  assert.equal(frame.completedStages.includes('takeoff'), false);
  assert.equal(frame.armed, false);
  assert.equal(frame.outcome.status, 'rejected');
});

test('dwell completion uses new position receipts and respects the requested boundary', () => {
  const run = criterionRun();
  assert.equal(completionEvidence(run, 'takeoff', 1199), null);
  assert.equal(completionEvidence(run, 'takeoff', 1200).timeMs, 1200);
  const onePosition = structuredClone(run);
  onePosition.telemetry = onePosition.telemetry.filter(item => item.type !== 'LOCAL_POSITION_NED' || item.timeMs === 200);
  assert.equal(completionEvidence(onePosition, 'takeoff', 5000), null);
});

test('old altitude data, a fast fly-through, or a missing sample gap cannot satisfy the dwell', () => {
  const stale = criterionRun();
  stale.telemetry = stale.telemetry.filter(item => item.type !== 'GLOBAL_POSITION_INT' || item.timeMs === 200);
  assert.equal(completionEvidence(stale, 'takeoff'), null);
  const fast = criterionRun();
  for (const item of fast.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED')) item.data.vx = 0.5;
  assert.equal(completionEvidence(fast, 'takeoff'), null);
  const gap = criterionRun('takeoff', [200, 300, 400, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500]);
  assert.equal(completionEvidence(gap, 'takeoff'), null);
});

test('leaving the target tolerance restarts the dwell and cannot borrow earlier residence time', () => {
  const run = criterionRun('takeoff', Array.from({ length: 18 }, (_, index) => 200 + index * 100));
  run.telemetry.find(item => item.type === 'GLOBAL_POSITION_INT' && item.timeMs === 800).data.relative_alt = 3000;
  assert.equal(completionEvidence(run, 'takeoff', 1899), null);
  assert.equal(completionEvidence(run, 'takeoff', 1900).timeMs, 1900);
});

test('pre-request position samples and missing acceptance cannot create takeoff completion', () => {
  const early = criterionRun();
  early.commands[0].timeMs = 1300;
  early.acks[0].timeMs = 1310;
  assert.equal(completionEvidence(early, 'takeoff'), null);
  const noAck = criterionRun();
  noAck.acks = [];
  assert.equal(completionEvidence(noAck, 'takeoff'), null);
  const failed = criterionRun();
  failed.acks[0].result = 4;
  assert.equal(completionEvidence(failed, 'takeoff'), null);
});

test('local waypoint completion uses all three axes and slow dwell without requiring an ACK', () => {
  const run = criterionRun();
  run.commands = [{ id: 'waypoint', kind: 'setpoint', timeMs: 100, message: 'SET_POSITION_TARGET_LOCAL_NED', command: null, positionNed: [8, 5, -4], frame: 1, mask: 3576, targetSystem: 1, targetComponent: 1 }];
  run.acks = [];
  for (const item of run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED')) Object.assign(item.data, { x: 8, y: 5, z: -4 });
  assert.equal(completionEvidence(run, 'waypoint').timeMs, 1200);
  for (const item of run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED')) item.data.z = -2;
  assert.equal(completionEvidence(run, 'waypoint'), null);
});

test('landing requires post-command ground and disarmed reports after prior airborne telemetry', () => {
  const run = criterionRun('land');
  run.commands[0].timeMs = 2000;
  run.acks[0].timeMs = 2010;
  run.telemetry.push(heartbeat(2100, false, 9), landed(2120, 1));
  run.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  assert.equal(completionEvidence(run, 'land', 2119), null);
  assert.equal(completionEvidence(run, 'land', 2120).timeMs, 2120);
  const stillArmed = structuredClone(run);
  stillArmed.telemetry.find(item => item.type === 'HEARTBEAT' && item.timeMs === 2100).data.base_mode = 128;
  assert.equal(completionEvidence(stillArmed, 'land'), null);
  const neverAirborne = structuredClone(run);
  neverAirborne.telemetry = neverAirborne.telemetry.filter(item => !(item.type === 'EXTENDED_SYS_STATE' && item.data.landed_state === 2));
  assert.equal(completionEvidence(neverAirborne, 'land'), null);
  const oldGround = structuredClone(run);
  oldGround.telemetry.find(item => item.type === 'EXTENDED_SYS_STATE' && item.timeMs === 2120).timeMs = 1990;
  oldGround.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  assert.equal(completionEvidence(oldGround, 'land'), null);
  const staleGround = structuredClone(run);
  staleGround.telemetry.find(item => item.type === 'HEARTBEAT' && item.timeMs === 2100).timeMs = 4000;
  staleGround.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  assert.equal(completionEvidence(staleGround, 'land'), null);
});

test('replay exposes only past events and independently holds each telemetry stream', () => {
  for (const run of trace.cases) {
    const events = sitlEvents(run);
    assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, run.endMs / 3, run.endMs / 2, run.endMs]) {
      const frame = sitlFrame(run, timeMs);
      assert.ok(frame.events.every(item => item.timeMs <= timeMs));
      assert.ok(frame.commands.every(item => item.timeMs <= timeMs));
      assert.ok(frame.acks.every(item => item.timeMs <= timeMs));
      assert.ok(frame.trajectory.every(item => item.timeMs <= timeMs));
      const lastPosition = run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED' && item.timeMs <= timeMs).at(-1);
      const lastAttitude = run.telemetry.filter(item => item.type === 'ATTITUDE' && item.timeMs <= timeMs).at(-1);
      assert.deepEqual(frame.positionNed, lastPosition ? [lastPosition.data.x, lastPosition.data.y, lastPosition.data.z] : null);
      assert.deepEqual(frame.attitude, lastAttitude ? { roll: lastAttitude.data.roll, pitch: lastAttitude.data.pitch, yaw: lastAttitude.data.yaw } : null);
      assert.equal(frame.positionAgeMs, lastPosition ? timeMs - lastPosition.timeMs : null);
      assert.equal(frame.attitudeAgeMs, lastAttitude ? timeMs - lastAttitude.timeMs : null);
      if (timeMs < run.endMs) assert.equal(frame.outcome, null);
    }
  }
});

test('a time before any receipt has no invented pose, attitude, arming or landing state', () => {
  const run = structuredClone(nominal);
  run.telemetry = run.telemetry.filter(item => item.timeMs > 100);
  const frame = sitlFrame(run, 0);
  assert.equal(frame.positionNed, null);
  assert.equal(frame.positionEnu, null);
  assert.equal(frame.attitude, null);
  assert.equal(frame.armed, null);
  assert.equal(frame.landedState, null);
});

test('rendering does not interpolate a later sample or mutate recorded position and attitude', () => {
  const run = structuredClone(nominal), before = structuredClone(run);
  const entries = run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED');
  const left = entries[Math.floor(entries.length / 2)], right = entries[Math.floor(entries.length / 2) + 1];
  const frame = sitlFrame(run, (left.timeMs + right.timeMs) / 2);
  assert.deepEqual(frame.positionNed, [left.data.x, left.data.y, left.data.z]);
  frame.positionNed[0] += 100;
  frame.positionEnu[0] += 100;
  if (frame.attitude) frame.attitude.roll += 1;
  assert.deepEqual(run, before);
});

test('summaries derive maximum height and speed from actual received estimates', () => {
  for (const run of trace.cases) {
    const summary = sitlSummary(run);
    close(summary.maxRelativeAltitudeM, Math.max(...run.telemetry.filter(item => item.type === 'GLOBAL_POSITION_INT').map(item => item.data.relative_alt / 1000)));
    close(summary.maxSpeedMps, Math.max(...run.telemetry.filter(item => item.type === 'LOCAL_POSITION_NED').map(item => Math.hypot(item.data.vx, item.data.vy, item.data.vz))));
    assert.equal(summary.telemetryCount, run.telemetry.length);
    assert.deepEqual(summary.outcome, run.outcome);
  }
});

test('imports cannot turn a command acknowledgement into a completed flight stage', () => {
  reject(data => {
    const run = data.cases.find(item => item.id === 'nominal');
    const event = run.events.find(item => item.stage === 'takeoff' && item.status === 'complete');
    event.timeMs = run.acks.find(item => item.commandId === 'takeoff').timeMs;
    run.events.sort((a, b) => a.timeMs - b.timeMs);
  });
  reject(data => { data.cases.find(item => item.id === 'disarmed').outcome.status = 'completed'; });
  reject(data => {
    const run = data.cases.find(item => item.id === 'nominal');
    run.telemetry = run.telemetry.filter(item => item.type !== 'EXTENDED_SYS_STATE');
  });
});

test('imports reject mismatched ACK identities, invented setpoint ACKs, nonfinite data and bad chronology', () => {
  reject(data => { data.cases[0].acks[0].sourceSystem = 2; });
  reject(data => { data.cases[0].acks[0].targetSystem = 1; });
  reject(data => { data.cases[0].acks[0].command += 1; });
  reject(data => { data.cases[0].acks[0].timeMs = -1; });
  reject(data => { data.cases[0].telemetry[0].sourceComponent = 42; });
  reject(data => { data.cases[0].telemetry.find(item => item.type === 'LOCAL_POSITION_NED').data.x = Infinity; });
  reject(data => { data.cases[0].telemetry[0].timeMs = data.cases[0].endMs + 1; });
  reject(data => {
    const run = data.cases.find(item => item.id === 'nominal');
    run.acks.push({ ...run.acks.at(-1), commandId: 'waypoint', command: null });
  });
});

test('imports reject unsupported provenance and replay refuses invalid cursor values', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.kind = 'browser-flight'; });
  reject(data => { data.runtime.speedup = 10; });
  reject(data => { data.runtime.sourceSha256 = 'unverified'; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[1] = structuredClone(data.cases[0]); });
  reject(data => { data.cases[0].config.dwellMs = 0; });
  for (const timeMs of [-1, NaN, Infinity, '0', nominal.endMs + 1]) assert.throws(() => sitlFrame(nominal, timeMs), RangeError);
});

test('the recorded arming configuration preserves every check and the negative case cannot claim flight', () => {
  assert.equal(nominal.parameters.ARMING_SKIPCHK, 0);
  assert.equal(rejected.parameters.ARMING_SKIPCHK, 0);
  reject(data => { data.cases[0].parameters.ARMING_SKIPCHK = 1; });
  reject(data => {
    const run = data.cases.find(item => item.id === 'disarmed');
    run.telemetry.find(item => item.type === 'HEARTBEAT').data.base_mode |= 128;
  });
  reject(data => {
    const run = data.cases.find(item => item.id === 'disarmed');
    run.telemetry.find(item => item.type === 'EXTENDED_SYS_STATE').data.landed_state = 2;
  });
});

test('contradictory terminal acknowledgements cannot admit and reject the same request', () => {
  reject(data => {
    const run = data.cases.find(item => item.id === 'nominal');
    const original = run.acks.find(item => item.commandId === 'takeoff');
    run.acks.push({ ...original, timeMs: original.timeMs + 1, result: 4 });
    run.acks.sort((a, b) => a.timeMs - b.timeMs);
  });
});

test('an incomplete recording may reach its actual ACK deadline but cannot declare an immediate timeout', () => {
  const data = copy();
  const run = data.cases.find(item => item.id === 'nominal');
  data.cases = [run];
  const first = run.commands[0], deadline = first.timeMs + run.config.ackTimeoutMs;
  run.commands = [first];
  run.acks = [];
  run.endMs = deadline + 20;
  run.events = [{ stage: first.id, status: 'start', timeMs: first.timeMs }, { stage: first.id, status: 'timeout', timeMs: deadline }];
  run.telemetry = run.telemetry.filter(item => item.timeMs <= run.endMs);
  run.statuses = run.statuses.filter(item => item.timeMs <= run.endMs);
  run.outcome = { status: 'timeout', reason: 'No acknowledgement received within the configured deadline.' };
  assert.equal(validateSitlTrace(data), data);
  run.events[1].timeMs = first.timeMs + 1;
  assert.throws(() => validateSitlTrace(data), /Invalid SITL trace:/i);
});
