import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  failsafeEvidence, failsafeEvents, failsafeFrame, failsafeLandingEvidence,
  failsafeSummary, validateFailsafeTrace,
} from '../src/failsafe-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-failsafe.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const loss = trace.cases.find(run => run.id === 'loss');
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const reject = change => {
  const copy = structuredClone(trace); change(copy);
  assert.throws(() => validateFailsafeTrace(copy), /Invalid failsafe trace:/i);
};
const telemetry = (type, timeMs, data) => ({ type, timeMs, data, sourceSystem: 1, sourceComponent: 1 });
const heartbeat = (timeMs, armed = true, mode = 9, state = 5) => telemetry('HEARTBEAT', timeMs, { base_mode: armed ? 128 : 0, custom_mode: mode, system_status: state });
const ground = (timeMs, state = 1) => telemetry('EXTENDED_SYS_STATE', timeMs, { landed_state: state });

// These short observer fixtures isolate evidence rules. Actual-process evidence
// comes separately from the bundled SITL recording, never from synthetic data.
function landingFixture() {
  return {
    id: 'loss', config: structuredClone(loss.config), blackout: { startTimeMs: 100, endTimeMs: 10000 }, endMs: 12000,
    statuses: [{ timeMs: 250, severity: 4, text: 'GCS Failsafe' }],
    telemetry: [heartbeat(0, true, 4, 4), ground(50, 2), heartbeat(200), heartbeat(900, false), ground(920)],
    commands: [], acks: [], events: [], heartbeatTx: [],
  };
}

test('actual recordings validate without mutation and preserve pinned failsafe settings', () => {
  const before = structuredClone(trace);
  assert.equal(validateFailsafeTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.runtime.modelArgument, '+');
  assert.equal(trace.runtime.speedup, 1);
  assert.equal(trace.runtime.heartbeatClock, 'recorder-monotonic-send');
  assert.notEqual(nominal.runId, loss.runId);
  for (const run of trace.cases) {
    assert.equal(run.parameters.FS_GCS_ENABLE, 5);
    assert.equal(run.parameters.FS_GCS_TIMEOUT, 3);
    assert.equal(run.parameters.FS_OPTIONS, 0);
    assert.equal(run.parameters.MAV_GCS_SYSID, 255);
    assert.equal(run.parameters.MAV_GCS_SYSID_HI, 0);
    assert.equal(run.parameters.ARMING_SKIPCHK, 0);
    assert.ok(run.setup.heartbeatCount >= 2);
    assert.ok(run.setup.lastHeartbeatBeforeOriginMs < 0);
  }
});

test('both cases have a command-free observation window but only one suppresses heartbeats', () => {
  for (const run of trace.cases) {
    const summary = failsafeSummary(run);
    assert.ok(summary.observationEndMs - summary.observationStartMs >= run.config.observationDurationMs);
    assert.equal(run.commands.some(command => command.timeMs > summary.observationStartMs && command.timeMs < summary.observationEndMs), false);
    assert.ok(summary.takeoffMs <= summary.observationStartMs);
  }
  assert.equal(nominal.blackout, null);
  assert.ok(loss.blackout.endTimeMs - loss.blackout.startTimeMs >= 8000);
  assert.equal(loss.heartbeatTx.some(sample => sample.timeMs >= loss.blackout.startTimeMs && sample.timeMs < loss.blackout.endTimeMs), false);
  const start = failsafeFrame(loss, loss.blackout.startTimeMs), end = failsafeFrame(loss, loss.blackout.endTimeMs);
  assert.equal(start.gcs.enabled, false);
  assert.equal(start.gcs.phase, 'suppressed');
  assert.equal(end.gcs.enabled, true);
});

test('autonomous LAND has no transmitted command or invented acknowledgement', () => {
  assert.deepEqual(loss.commands.map(command => command.id), ['guided', 'arm', 'takeoff']);
  assert.equal(loss.acks.some(ack => ack.commandId === 'land' || ack.command === 21), false);
  assert.equal(nominal.commands.at(-1).id, 'land');
  assert.ok(nominal.acks.some(ack => ack.commandId === 'land' && ack.command === 21 && ack.result === 0));
  for (const run of trace.cases) assert.ok(failsafeLandingEvidence(run));
});

test('a host send-age threshold or generic CRITICAL heartbeat cannot create GCS-specific evidence', () => {
  const run = structuredClone(loss), summary = failsafeSummary(loss);
  const cursor = summary.lastHeartbeatBeforeLossMs + run.config.gcsTimeoutMs + 1;
  run.statuses = [];
  const frame = failsafeFrame(run, cursor);
  assert.ok(frame.gcs.ageMs > run.config.gcsTimeoutMs);
  assert.equal(frame.failsafe.onset, null);
  assert.equal(frame.failsafe.active, null);
  run.telemetry.push(heartbeat(cursor + 1, true, 9, 5));
  run.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  assert.equal(failsafeEvidence(run, cursor + 1).onset, null);
  assert.equal(failsafeLandingEvidence(run), null);
});

test('LAND mode can arrive before its GCS status text without moving either receipt timestamp', () => {
  const run = landingFixture();
  const beforeStatus = failsafeEvidence(run, 225);
  assert.equal(beforeStatus.onset, null);
  assert.equal(beforeStatus.active, null);
  assert.equal(beforeStatus.landMode.timeMs, 200);
  const evidence = failsafeEvidence(run, 250);
  assert.equal(evidence.onset.timeMs, 250);
  assert.equal(evidence.landMode.timeMs, 200);
  assert.equal(failsafeLandingEvidence(run).timeMs, 920);
});

test('restoration resumes sends while the observed mode remains LAND after the GCS condition clears', () => {
  const summary = failsafeSummary(loss);
  assert.ok(summary.firstResumedHeartbeatMs >= summary.restoreMs);
  assert.ok(summary.clearMs >= summary.firstResumedHeartbeatMs);
  assert.equal(summary.modeAfterRestore, 'Land');
  const cleared = failsafeFrame(loss, summary.clearMs);
  assert.equal(cleared.gcs.enabled, true);
  assert.equal(cleared.failsafe.active, false);
  const after = loss.telemetry.filter(row => row.type === 'HEARTBEAT' && row.timeMs >= summary.clearMs);
  assert.ok(after.length >= 2);
  assert.ok(after.every(row => row.data.custom_mode === 9));
  assert.equal(loss.commands.some(row => row.timeMs >= summary.restoreMs), false);
});

test('suppressed GCS sends coexist with actually received vehicle telemetry', () => {
  const summary = failsafeSummary(loss);
  const messages = loss.telemetry.filter(row => row.timeMs >= loss.blackout.startTimeMs && row.timeMs < loss.blackout.endTimeMs);
  assert.equal(summary.telemetryDuringLoss, messages.length);
  for (const type of ['HEARTBEAT', 'LOCAL_POSITION_NED', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'EXTENDED_SYS_STATE']) {
    assert.ok(messages.some(row => row.type === type));
  }
  const reported = loss.statuses.find(row => row.text === 'GCS Failsafe');
  close(summary.onsetSinceLastTxMs, reported.timeMs - summary.lastHeartbeatBeforeLossMs);
});

test('automatic landing completion requires fresh ground and disarmed reports after prior flight', () => {
  const run = landingFixture();
  assert.equal(failsafeLandingEvidence(run, 919), null);
  assert.equal(failsafeLandingEvidence(run, 920).timeMs, 920);
  const armed = landingFixture(); armed.telemetry.find(row => row.timeMs === 900).data.base_mode = 128;
  assert.equal(failsafeLandingEvidence(armed), null);
  const noFlight = landingFixture(); noFlight.telemetry = noFlight.telemetry.filter(row => row.timeMs !== 50);
  assert.equal(failsafeLandingEvidence(noFlight), null);
  const wrongMode = landingFixture(); wrongMode.telemetry.filter(row => row.type === 'HEARTBEAT').forEach(row => { row.data.custom_mode = 4; });
  assert.equal(failsafeLandingEvidence(wrongMode), null);
  const oldGround = landingFixture(); oldGround.telemetry.at(-1).timeMs = 150;
  oldGround.telemetry.sort((a, b) => a.timeMs - b.timeMs);
  assert.equal(failsafeLandingEvidence(oldGround), null);
  const stale = landingFixture(); stale.telemetry.at(-1).timeMs = 3000;
  assert.equal(failsafeLandingEvidence(stale), null);
});

test('replay exposes only past sends, status messages, position and attitude samples', () => {
  for (const run of trace.cases) {
    const before = structuredClone(run), events = failsafeEvents(run);
    assert.ok(events.every((row, index) => index === 0 || row.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, run.endMs / 3, run.endMs / 2, run.endMs]) {
      const frame = failsafeFrame(run, timeMs);
      const sends = run.heartbeatTx.filter(row => row.timeMs <= timeMs), lastTx = sends.at(-1) ?? null;
      assert.deepEqual(frame.gcs.lastTx, lastTx);
      assert.equal(frame.gcs.txCount, sends.length);
      assert.equal(frame.gcs.ageMs, lastTx ? timeMs - lastTx.timeMs : null);
      const pos = run.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= timeMs).at(-1);
      const att = run.telemetry.filter(row => row.type === 'ATTITUDE' && row.timeMs <= timeMs).at(-1);
      assert.deepEqual(frame.positionNed, pos ? [pos.data.x, pos.data.y, pos.data.z] : null);
      assert.deepEqual(frame.attitude, att ? { roll: att.data.roll, pitch: att.data.pitch, yaw: att.data.yaw } : null);
      assert.equal(frame.positionAgeMs, pos ? timeMs - pos.timeMs : null);
      assert.equal(frame.attitudeAgeMs, att ? timeMs - att.timeMs : null);
      for (const field of ['onset', 'clear', 'landMode', 'landing']) assert.ok(!frame.failsafe[field] || frame.failsafe[field].timeMs <= timeMs);
      assert.ok(frame.commands.every(row => row.timeMs <= timeMs));
      assert.ok(frame.statuses.every(row => row.timeMs <= timeMs));
      if (timeMs < run.endMs) assert.equal(frame.outcome, null);
    }
    assert.deepEqual(run, before);
  }
});

test('between receipts position is held and missing future status cannot be inferred from the final outcome', () => {
  const samples = loss.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED');
  const left = samples[Math.floor(samples.length / 2)], right = samples[Math.floor(samples.length / 2) + 1];
  const frame = failsafeFrame(loss, (left.timeMs + right.timeMs) / 2);
  assert.deepEqual(frame.positionNed, [left.data.x, left.data.y, left.data.z]);
  const onset = failsafeSummary(loss).failsafeMs;
  assert.equal(failsafeFrame(loss, onset - .001).failsafe.onset, null);
  assert.equal(failsafeFrame(loss, onset - .001).outcome, null);
  assert.equal(failsafeFrame(loss, onset).failsafe.active, true);
});

test('imports reject wrong failsafe parameters, source identities and setup claims', () => {
  for (const [key, value] of [['FS_GCS_ENABLE', 0], ['FS_GCS_TIMEOUT', 5], ['FS_OPTIONS', 16], ['MAV_GCS_SYSID', 42], ['MAV_GCS_SYSID_HI', 255], ['ARMING_SKIPCHK', 1], ['FRAME_CLASS', 2], ['FRAME_TYPE', 1], ['FS_THR_ENABLE', 0]]) {
    reject(data => { data.cases[0].parameters[key] = value; });
  }
  for (const key of ['ackTimeoutMs', 'takeoffTimeoutMs', 'landTimeoutMs']) {
    reject(data => { data.cases[0].config[key] += 1000; });
  }
  reject(data => { data.cases[0].controller.systemId = 42; });
  reject(data => { data.cases[0].setup.heartbeatCount = 0; });
  reject(data => { data.cases[0].setup.lastHeartbeatBeforeOriginMs = 1; });
  reject(data => { data.cases[0].telemetry[0].sourceComponent = 42; });
  reject(data => { data.cases[0].acks[0].targetSystem = 42; });
});

test('imports reject missing, too-fast or suppressed-period heartbeat sends and fabricated envelopes', () => {
  reject(data => { data.cases[0].heartbeatTx.splice(5, 2); });
  reject(data => { data.cases[0].heartbeatTx[1].timeMs = data.cases[0].heartbeatTx[0].timeMs + 10; });
  reject(data => { data.cases[0].heartbeatTx[0].sourceSystem = 1; });
  reject(data => { data.cases[0].heartbeatTx[0].data.type = 2; });
  reject(data => {
    const run = data.cases.find(row => row.id === 'loss');
    run.heartbeatTx.push({ ...structuredClone(run.heartbeatTx[0]), timeMs: run.blackout.startTimeMs + 1 });
    run.heartbeatTx.sort((a, b) => a.timeMs - b.timeMs);
  });
});

test('imports reject fabricated automatic commands, absent raw failsafe reports and changed restoration modes', () => {
  reject(data => { data.cases.find(row => row.id === 'loss').commands.push(structuredClone(nominal.commands.at(-1))); });
  reject(data => { data.cases.find(row => row.id === 'loss').acks.push(structuredClone(nominal.acks.at(-1))); });
  reject(data => { const run = data.cases.find(row => row.id === 'loss'); run.statuses = run.statuses.filter(row => row.text !== 'GCS Failsafe'); });
  reject(data => {
    const run = data.cases.find(row => row.id === 'loss'), after = run.telemetry.find(row => row.type === 'HEARTBEAT' && row.timeMs >= failsafeSummary(run).clearMs);
    after.data.custom_mode = 4;
  });
  reject(data => {
    const run = data.cases.find(row => row.id === 'nominal');
    run.statuses.push({ timeMs: run.endMs, severity: 4, text: 'GCS Failsafe Cleared' });
  });
  for (const [id, stage] of [['nominal', 'failsafe'], ['nominal', 'heartbeat-loss'], ['nominal', 'landing'], ['loss', 'land']]) {
    reject(data => {
      const run = data.cases.find(row => row.id === id);
      run.events.push({ timeMs: run.endMs, stage, status: 'start' });
    });
  }
});

test('imports reject premature completion, missing landing evidence and unsupported clocks or baselines', () => {
  reject(data => { const run = data.cases.find(row => row.id === 'loss'); run.telemetry = run.telemetry.filter(row => row.type !== 'EXTENDED_SYS_STATE'); });
  reject(data => {
    const run = data.cases.find(row => row.id === 'loss');
    run.events.find(row => row.stage === 'landing' && row.status === 'complete').timeMs = failsafeSummary(run).landModeMs;
    run.events.sort((a, b) => a.timeMs - b.timeMs);
  });
  reject(data => { data.runtime.heartbeatClock = 'vehicle-boot'; });
  reject(data => { data.cases[0].originTimeMs += 1; });
  reject(data => { data.cases[0].originNed[0] += 1; });
  reject(data => { data.cases[0].telemetry.find(row => row.type === 'LOCAL_POSITION_NED').data.x = Infinity; });
});

test('unsupported formats, duplicate cases, nonfinite timestamps and invalid cursors are rejected', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.kind = 'fake-failsafe'; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[1] = structuredClone(data.cases[0]); });
  reject(data => { data.runtime.sourceSha256 = 'unverified'; });
  reject(data => { data.cases[0].heartbeatTx[0].timeMs = NaN; });
  for (const cursor of [NaN, Infinity, -1, loss.endMs + 1]) assert.throws(() => failsafeFrame(loss, cursor));
});
