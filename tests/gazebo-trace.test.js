import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  attitudeNedToEnu, estimateWorldPosition, gazeboEvents, gazeboFrame,
  gazeboSummary, recoveryEvidence, validateGazeboTrace,
} from '../src/gazebo-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-gazebo.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const pulse = trace.cases.find(run => run.id === 'pulse');
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const vectorClose = (actual, expected) => actual.forEach((value, axis) => close(value, expected[axis]));
const reject = change => {
  const copy = structuredClone(trace);
  change(copy);
  assert.throws(() => validateGazeboTrace(copy), /Invalid Gazebo trace:/i);
};

function rotate(q, point) {
  const [x, y, z, w] = q, [a, b, c] = point;
  return [
    (1 - 2 * (y*y + z*z))*a + 2*(x*y - z*w)*b + 2*(x*z + y*w)*c,
    2*(x*y + z*w)*a + (1 - 2*(x*x + z*z))*b + 2*(y*z - x*w)*c,
    2*(x*z - y*w)*a + 2*(y*z + x*w)*b + (1 - 2*(x*x + y*y))*c,
  ];
}

// Synthetic observer records isolate the simulation-time recovery rule. They are
// not exported or presented as a Gazebo execution; the bundled pair is separate.
function recoveryFixture() {
  const run = structuredClone(pulse);
  run.originTruthEnu = [0, 0, .195];
  run.endMs = 24100;
  run.events = [
    { stage: 'hover', status: 'start', timeMs: 100, simTimeMs: 10000 },
    { stage: 'hover', status: 'complete', timeMs: 24100, simTimeMs: 22000 },
  ];
  run.pulse = { requestTimeMs: 2000, forceEnu: [8, 0, 0], durationMs: 1000 };
  const row = (elapsed, active, good = true) => ({
    timeMs: 100 + 2 * elapsed, simTimeMs: 10000 + elapsed,
    positionEnu: [good ? 0 : 1, 0, 4.195], velocityEnu: [0, 0, 0], orientationXyzw: [0, 0, 0, 1],
    forceEnu: active ? [8, 0, 0] : [0, 0, 0], pulseActive: active,
    pulseAppliedSteps: elapsed < 1000 ? 0 : Math.min(1000, elapsed - 999),
    impulseNs: [elapsed < 1000 ? 0 : Math.min(8, (elapsed - 999) * .008), 0, 0],
  });
  run.truth = [row(0, false), row(1000, true, false), row(2000, false, false)];
  for (let elapsed = 2050; elapsed <= 4500; elapsed += 50) run.truth.push(row(elapsed, false));
  return run;
}

test('actual Gazebo recordings preserve the external physics, EKF3 and isolation contract', () => {
  const before = structuredClone(trace);
  assert.equal(validateGazeboTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.runtime.modelArgument, 'JSON');
  assert.equal(trace.runtime.lockStep, true);
  assert.equal(trace.runtime.noTimeSync, false);
  assert.equal(trace.runtime.truthClock, 'gazebo-simulation');
  assert.equal(trace.runtime.clock, 'recorder-monotonic-receipt');
  assert.equal(trace.runtime.maxStepSizeMs, 1);
  assert.notEqual(nominal.runId, pulse.runId);
  for (const run of trace.cases) {
    assert.equal(run.parameters.AHRS_EKF_TYPE, 3);
    assert.equal(run.parameters.EK3_ENABLE, 1);
    assert.equal(run.parameters.ARMING_SKIPCHK, 0);
    assert.deepEqual(run.commands.map(command => command.id), ['guided', 'arm', 'takeoff', 'land']);
    assert.ok(run.truth.length > 100);
  }
});

test('estimate alignment converts NED axes and preserves the declared initial world offset', () => {
  const run = { originNed: [3, 4, -2], originTruthEnu: [10, 20, .195] };
  vectorClose(estimateWorldPosition(run, [3, 4, -2]), [10, 20, .195]);
  vectorClose(estimateWorldPosition(run, [4, 4, -2]), [10, 21, .195]);
  vectorClose(estimateWorldPosition(run, [3, 5, -2]), [11, 20, .195]);
  vectorClose(estimateWorldPosition(run, [3, 4, -3]), [10, 20, 1.195]);
});

test('attitude conversion maps FRD telemetry into an ENU world with a FLU body', () => {
  const north = attitudeNedToEnu({ roll: 0, pitch: 0, yaw: 0 });
  vectorClose(rotate(north, [1, 0, 0]), [0, 1, 0]);
  vectorClose(rotate(north, [0, 1, 0]), [-1, 0, 0]);
  vectorClose(rotate(north, [0, 0, 1]), [0, 0, 1]);
  const east = attitudeNedToEnu({ roll: 0, pitch: 0, yaw: Math.PI / 2 });
  vectorClose(rotate(east, [1, 0, 0]), [1, 0, 0]);
  const noseUp = attitudeNedToEnu({ roll: 0, pitch: Math.PI / 6, yaw: 0 });
  vectorClose(rotate(noseUp, [1, 0, 0]), [0, Math.sqrt(3) / 2, .5]);
  for (const q of [north, east, noseUp]) close(Math.hypot(...q), 1);
});

test('the recorded force is absent in the baseline and integrates to one bounded impulse', () => {
  assert.equal(nominal.pulse, null);
  assert.ok(nominal.truth.every(row => !row.pulseActive && row.pulseAppliedSteps === 0));
  assert.ok(nominal.truth.every(row => row.forceEnu.every(value => value === 0) && row.impulseNs.every(value => value === 0)));
  assert.deepEqual(pulse.pulse.forceEnu, [8, 0, 0]);
  assert.equal(pulse.pulse.durationMs, 1000);
  const active = pulse.truth.filter(row => row.pulseActive);
  assert.ok(active.length > 5);
  assert.ok(active.every(row => row.timeMs >= pulse.pulse.requestTimeMs));
  const first = active[0], released = pulse.truth.find(row => row.simTimeMs > first.simTimeMs && !row.pulseActive);
  close(released.simTimeMs - first.simTimeMs, pulse.pulse.durationMs, 1.01);
  close(pulse.truth.at(-1).impulseNs[0], 8, .009);
  assert.ok(pulse.truth.at(-1).pulseAppliedSteps >= 999 && pulse.truth.at(-1).pulseAppliedSteps <= 1001);
  assert.ok(pulse.truth.filter(row => row.simTimeMs >= released.simTimeMs).every(row => !row.pulseActive));
});

test('flight completion, physical recovery and force application remain different observations', () => {
  const summary = gazeboSummary(pulse);
  assert.ok(summary.pulseStartMs >= summary.pulseRequestMs);
  assert.ok(summary.pulseEndMs > summary.pulseStartMs);
  assert.ok(summary.hoverStartMs < summary.pulseRequestMs);
  assert.ok(summary.hoverEndMs > summary.pulseEndMs);
  assert.equal(summary.flightCompleted, true);
  assert.equal(gazeboFrame(pulse, summary.pulseStartMs).recovery, null);
  assert.equal(gazeboFrame(pulse, summary.pulseEndMs).recovery, null);
  assert.equal(gazeboFrame(pulse, summary.pulseEndMs).completedStages.includes('land'), false);
  if (summary.recoveryMs !== null) {
    assert.ok(summary.recoveryMs > summary.pulseEndMs);
    assert.ok(summary.recoveryMs <= summary.hoverEndMs);
    assert.ok(summary.recoveryDurationMs >= pulse.config.recoveryDwellMs);
  }
  assert.equal(gazeboSummary(nominal).pulseStartMs, null);
  assert.equal(gazeboSummary(nominal).recoveryMs, null);
});

test('replay holds each received stream independently without future truth or synthetic interpolation', () => {
  for (const run of trace.cases) {
    const before = structuredClone(run), events = gazeboEvents(run);
    assert.ok(events.every((row, index) => index === 0 || row.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, run.endMs / 3, run.endMs / 2, run.endMs]) {
      const frame = gazeboFrame(run, timeMs);
      const truth = run.truth.filter(row => row.timeMs <= timeMs).at(-1) ?? null;
      assert.deepEqual(frame.truth, truth);
      assert.equal(frame.truthAgeMs, truth ? timeMs - truth.timeMs : null);
      assert.equal(frame.simTimeMs, truth?.simTimeMs ?? null);
      const estimate = run.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= timeMs).at(-1);
      assert.equal(frame.estimateAgeMs, estimate ? timeMs - estimate.timeMs : null);
      if (truth && estimate) {
        const aligned = estimateWorldPosition(run, [estimate.data.x, estimate.data.y, estimate.data.z]);
        assert.deepEqual(frame.estimate.positionEnu, aligned);
        close(frame.heldSeparationM, Math.hypot(...aligned.map((value, axis) => value - truth.positionEnu[axis])));
        close(frame.receiptSkewMs, estimate.timeMs - truth.timeMs);
      } else {
        assert.equal(frame.heldSeparationM, null);
        assert.equal(frame.receiptSkewMs, null);
      }
      assert.ok(frame.truthTrajectory.every(row => row.timeMs <= timeMs));
      assert.ok(frame.estimateTrajectory.every(row => row.timeMs <= timeMs));
      assert.ok(frame.commands.every(row => row.timeMs <= timeMs));
      assert.ok(frame.acks.every(row => row.timeMs <= timeMs));
      if (timeMs < run.endMs) assert.equal(frame.outcome, null);
    }
    assert.deepEqual(run, before);
  }
});

test('elapsed receipt time cannot advance the held simulator clock or turn a held pose into recovery', () => {
  const run = structuredClone(pulse);
  const active = run.truth.find(row => row.pulseActive);
  run.truth = run.truth.filter(row => row.timeMs <= active.timeMs);
  const later = gazeboFrame(run, active.timeMs + 2000);
  assert.equal(later.simTimeMs, active.simTimeMs);
  assert.deepEqual(later.truth.positionEnu, active.positionEnu);
  assert.equal(later.recovery, null);
  close(later.truthAgeMs, 2000);
});

test('recovery dwell uses simulator seconds and requires a new sample after the force ends', () => {
  const run = recoveryFixture();
  assert.equal(recoveryEvidence(run, 6199), null);
  assert.deepEqual(recoveryEvidence(run, 6200), { timeMs: 6200, simTimeMs: 13050, durationMs: 1050 });
  // Making the force-end sample good cannot start the strictly post-force dwell.
  run.truth.find(row => row.simTimeMs === 12000).positionEnu[0] = 0;
  assert.equal(recoveryEvidence(run, 6199), null);
  assert.equal(recoveryEvidence(run, 6200).timeMs, 6200);
});

test('a gap, fast fly-through, or renewed target excursion resets physical recovery dwell', () => {
  const gap = recoveryFixture();
  gap.truth = gap.truth.filter(row => row.simTimeMs <= 12400 || row.simTimeMs >= 12600);
  assert.equal(recoveryEvidence(gap, 7299), null);
  assert.equal(recoveryEvidence(gap, 7300).timeMs, 7300);
  const fast = recoveryFixture();
  fast.truth.find(row => row.simTimeMs === 12500).velocityEnu = [0, 0, .3];
  assert.equal(recoveryEvidence(fast, 7199), null);
  assert.equal(recoveryEvidence(fast, 7200).timeMs, 7200);
  const excursion = recoveryFixture();
  excursion.truth.find(row => row.simTimeMs === 12500).positionEnu[0] = .36;
  assert.equal(recoveryEvidence(excursion, 7199), null);
  assert.equal(recoveryEvidence(excursion, 7200).timeMs, 7200);
});

test('recovery cannot borrow time before release, duplicate samples, or later landing observations', () => {
  const run = recoveryFixture();
  run.truth = run.truth.filter(row => row.simTimeMs <= 12800);
  const held = structuredClone(run.truth.at(-1));
  held.timeMs += 3000;
  run.truth.push(held);
  assert.equal(recoveryEvidence(run), null);
  const late = recoveryFixture();
  late.events[1] = { stage: 'hover', status: 'complete', timeMs: 10000, simTimeMs: 13000 };
  assert.equal(recoveryEvidence(late), null);
  late.events[1] = { stage: 'hover', status: 'complete', timeMs: 6000, simTimeMs: 22000 };
  assert.equal(recoveryEvidence(late), null);
});

test('summary displacement uses only the declared hover window, not the later landing', () => {
  for (const run of trace.cases) {
    const summary = gazeboSummary(run);
    const start = run.events.find(event => event.stage === 'hover' && event.status === 'start');
    const end = run.events.find(event => event.stage === 'hover' && event.status === 'complete');
    const rows = run.truth.filter(row => row.simTimeMs >= start.simTimeMs
      && row.simTimeMs <= Math.min(end.simTimeMs, start.simTimeMs + run.config.hoverDurationMs)
      && row.timeMs <= end.timeMs);
    const distance = row => Math.hypot(row.positionEnu[0] - run.originTruthEnu[0], row.positionEnu[1] - run.originTruthEnu[1]);
    close(summary.maxHorizontalDeviationM, Math.max(...rows.map(distance)));
    assert.equal(summary.truthCount, run.truth.length);
    assert.equal(summary.telemetryCount, run.telemetry.length);
  }
});

test('assessment excludes simulator-time overshoot and extra fields cannot move a pulse request', () => {
  const run = recoveryFixture();
  run.events[1] = { stage: 'hover', status: 'complete', timeMs: 30000, simTimeMs: 25000 };
  run.endMs = 30000;
  run.truth = run.truth.filter(row => row.simTimeMs <= 12000);
  const last = run.truth.at(-1);
  for (let simTimeMs = 21100; simTimeMs <= 22200; simTimeMs += 50) {
    run.truth.push({ ...structuredClone(last), timeMs: 100 + 2 * (simTimeMs - 10000), simTimeMs, positionEnu: [0, 0, 4] });
  }
  assert.equal(recoveryEvidence(run), null);
  run.truth.at(-1).positionEnu[0] = 999;
  assert.ok(gazeboSummary(run).maxHorizontalDeviationM < 999);
  run.pulse.timeMs = 123456;
  const request = gazeboEvents(run).find(event => event.kind === 'pulse-request');
  assert.equal(request.timeMs, run.pulse.requestTimeMs);
  assert.equal(request.data.timeMs, run.pulse.requestTimeMs);
});

test('imports reject unsupported estimator mode, unsafe arming and contradictory runtime provenance', () => {
  reject(data => { data.runtime.noTimeSync = true; });
  reject(data => { data.runtime.lockStep = false; });
  reject(data => { data.cases[0].parameters.AHRS_EKF_TYPE = 10; });
  reject(data => { data.cases[0].parameters.EK3_ENABLE = 0; });
  reject(data => { data.cases[0].parameters.ARMING_SKIPCHK = 1; });
  reject(data => { data.runtime.sourceSha256 = 'unverified'; });
  reject(data => { data.cases[1].runId = data.cases[0].runId; });
});

test('imports reject invalid world poses, nonmonotonic simulation time and invented force evidence', () => {
  reject(data => { data.cases[0].truth[1].simTimeMs = data.cases[0].truth[0].simTimeMs; });
  reject(data => { data.cases[0].truth[0].positionEnu[0] = Infinity; });
  reject(data => { data.cases[0].truth[0].orientationXyzw = [0, 0, 0, 2]; });
  reject(data => { data.cases[0].truth[0].forceEnu = [8, 0, 0]; });
  reject(data => { data.cases[0].truth[0].pulseActive = true; });
  reject(data => { data.cases[1].truth.at(-1).impulseNs[0] = 800; });
  reject(data => { data.cases[1].truth.find(row => row.pulseActive).impulseNs[0] = 6; });
  reject(data => { data.cases[1].truth.find(row => row.pulseActive).pulseAppliedSteps = 2; });
  reject(data => { data.cases[1].pulse.requestTimeMs = data.cases[1].endMs; });
});

test('imports cannot promote an ACK to flight completion or misrepresent origin alignment', () => {
  reject(data => {
    const run = data.cases[0], complete = run.events.find(row => row.stage === 'takeoff' && row.status === 'complete');
    complete.timeMs = run.acks.find(row => row.commandId === 'takeoff').timeMs;
    run.events.sort((a, b) => a.timeMs - b.timeMs);
  });
  reject(data => { data.cases[0].originTruthEnu[0] += 1; });
  reject(data => { data.cases[0].originNed[0] += 1; });
  reject(data => {
    const run = data.cases[1];
    run.events.push({ timeMs: run.pulse.requestTimeMs, stage: 'pulse', status: 'start' });
    run.events.sort((a, b) => a.timeMs - b.timeMs);
  });
  reject(data => { data.cases[0].telemetry = data.cases[0].telemetry.filter(row => row.type !== 'EXTENDED_SYS_STATE'); });
});

test('malformed schema, empty or duplicate cases and invalid replay cursors are rejected', () => {
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.kind = 'browser-physics'; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[1] = structuredClone(data.cases[0]); });
  for (const cursor of [NaN, Infinity, -1, pulse.endMs + 1]) assert.throws(() => gazeboFrame(pulse, cursor));
});
