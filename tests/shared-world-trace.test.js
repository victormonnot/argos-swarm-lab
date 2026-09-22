import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  closestWorldApproach, sharedWorldEvents, sharedWorldFrame, sharedWorldSummary,
  validateSharedWorldTrace, worldPairs,
} from '../src/shared-world-trace.js';
import { missionPosition, recoveryFrame, recoverySummary, targetNed } from '../src/recovery-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-shared-world.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const withdrawal = trace.cases.find(run => run.id === 'withdrawal');
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const closeVector = (a, b) => a.forEach((value, axis) => close(value, b[axis]));
const reject = change => {
  const copy = structuredClone(trace); change(copy);
  assert.throws(() => validateSharedWorldTrace(copy), /Invalid (?:shared-world|recovery) trace:/);
};
const pairId = pair => pair.vehicleIds.join('/');

// These deliberately simple evaluator samples isolate geometry and replay. They
// are never exported as a physical run or used as the actual recording evidence.
function triangleFixture() {
  const run = structuredClone(nominal);
  const sample = (timeMs, simTimeMs, positions) => ({ timeMs, simTimeMs,
    observerStartSimTimeMs: 0, observerSteps: simTimeMs + 1, collisionCount: 31,
    vehicles: positions.map((positionEnu, index) => ({ id: `A${index + 1}`, positionEnu,
      orientationXyzw: [0, 0, 0, 1], velocityEnu: [0, 0, 0] })),
    contacts: [], contactHistory: [], contactTotals: { groundSteps: 0, obstacleSteps: 0, vehicleSteps: 0, otherSteps: 0 },
  });
  run.truth = [sample(100, 1000, [[0,0,4],[3,0,4],[0,4,4]]),
    sample(200, 1050, [[0,0,4],[6,0,4],[0,8,4]]),
    sample(300, 1100, [[0,0,4],[1,0,4],[0,2,4]])];
  for (const vehicle of run.vehicles) {
    vehicle.originTruthTimeMs = 100;
    vehicle.originTruthEnu = run.truth[0].vehicles.find(v => v.id === vehicle.id).positionEnu;
  }
  return run;
}

test('actual recordings validate without mutation and show three autopilots sharing one Gazebo process', () => {
  const before = structuredClone(trace);
  assert.equal(validateSharedWorldTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.runtime.physics, 'shared-Gazebo-world');
  assert.equal(trace.runtime.modelArgument, 'JSON');
  for (const run of trace.cases) {
    assert.equal(new Set([run.gazeboPid, ...run.vehicles.map(v => v.pid)]).size, 4);
    assert.deepEqual(run.vehicles.map(v => v.jsonPort), [9002, 9012, 9022]);
    assert.deepEqual(run.vehicles.map(v => v.port), [5760, 5770, 5780]);
    assert.equal(run.world.collisionNames.length, 31);
    assert.ok(run.resources.some(row => row.timeMs >= run.missionStartMs && row.timeMs <= run.missionClosedMs
      && row.gazebo.running && row.vehicles.every(v => v.rssKiB > 0)));
    for (const v of run.vehicles) {
      assert.equal(v.parameters.FRAME_TYPE, 1);
      assert.equal(v.parameters.AHRS_EKF_TYPE, 3);
      assert.equal(v.parameters.EK3_ENABLE, 1);
      assert.equal(v.parameters.ARMING_SKIPCHK, 0);
      closeVector(missionPosition(v, v.originNed), v.padEnu);
      for (const task of run.tasks) closeVector(missionPosition(v, targetNed(v, task.positionEnu)), task.positionEnu);
    }
  }
});

test('six task completions, withdrawal handover and fleet landing remain separately evidenced', () => {
  for (const run of trace.cases) {
    const summary = sharedWorldSummary(run);
    assert.equal(summary.tasksCompleted, 6);
    assert.equal(summary.landedVehicles, 3);
    assert.ok(summary.landedMs > summary.missionCompletedMs);
    const atCompletion = sharedWorldFrame(run, summary.missionCompletedMs);
    assert.equal(atCompletion.tasksCompleted, 6);
    assert.ok(atCompletion.landedVehicles < 3);
    assert.equal(sharedWorldFrame(run, summary.landedMs).landedVehicles, 3);
  }
  assert.equal(sharedWorldSummary(nominal).cancellations, 0);
  const old = withdrawal.attempts.find(a => a.status === 'cancelled');
  const next = withdrawal.attempts.find(a => a.taskId === old.taskId && a.id !== old.id);
  assert.equal(old.vehicleId, 'A1');
  assert.notEqual(next.vehicleId, old.vehicleId);
  const locked = sharedWorldFrame(withdrawal, old.releasedTimeMs - .001).tasks.find(t => t.id === old.taskId);
  assert.equal(locked.state, 'locked'); assert.equal(locked.ownerId, 'A1');
  assert.equal(sharedWorldFrame(withdrawal, old.releasedTimeMs).tasks.find(t => t.id === old.taskId).state, 'pending');
  assert.ok(next.assignedTimeMs >= old.releasedTimeMs);
});

test('a simultaneous 3–4–5 triangle measures world separation independently of telemetry', () => {
  const run = triangleFixture();
  assert.deepEqual(worldPairs(run.truth[0]).map(pair => [pairId(pair), pair.distanceM]),
    [['A1/A2', 3], ['A1/A3', 4], ['A2/A3', 5]]);
  const frame = sharedWorldFrame(run, 150);
  assert.equal(frame.world.minimumSeparationM, 3);
  assert.equal(frame.world.receiptTimeMs, 100);
  assert.equal(frame.world.simTimeMs, 1000);
  assert.equal(frame.world.ageMs, 50);
  assert.deepEqual(frame.vehicles.map(v => v.worldPositionEnu), run.truth[0].vehicles.map(v => v.positionEnu));
  const changed = structuredClone(run);
  for (const vehicle of changed.vehicles) for (const sample of vehicle.telemetry) {
    if (sample.type === 'LOCAL_POSITION_NED') { sample.data.x += 100; sample.data.y -= 200; }
  }
  assert.deepEqual(sharedWorldFrame(changed, 150).world, frame.world);
});

test('world replay holds only the latest received triple and never interpolates or leaks future minima', () => {
  const run = triangleFixture();
  const before = sharedWorldFrame(run, 99.999);
  assert.equal(before.world.available, false);
  assert.equal(before.world.contactTotals, null);
  assert.equal(before.world.closestApproach, null);
  assert.ok(before.vehicles.every(v => v.worldPositionEnu === null && v.worldTrajectoryEnu.length === 0));
  for (const cursor of [100, 150, 199.999]) {
    const frame = sharedWorldFrame(run, cursor);
    assert.deepEqual(frame.vehicles[1].worldPositionEnu, [3,0,4]);
    assert.equal(frame.world.receivedSamples, 1);
    assert.equal(frame.world.minimumObservedSeparationM, 3);
  }
  assert.equal(sharedWorldFrame(run, 200).world.minimumSeparationM, 6);
  assert.equal(sharedWorldFrame(run, 200).world.minimumObservedSeparationM, 3);
  assert.equal(closestWorldApproach(run, 299.999).distanceM, 3);
  assert.equal(closestWorldApproach(run, 300).distanceM, 1);
  assert.equal(sharedWorldFrame(run, 100).world.minimumObservedSeparationM, 3);
});

test('fixed display alignment waits for both baselines and includes NED axis/sign conversion', () => {
  const run = triangleFixture(), vehicle = run.vehicles[0];
  vehicle.originNed = [3, 4, -2]; vehicle.originTimeMs = 150;
  vehicle.originTruthEnu = [10, 20, .195]; vehicle.originTruthTimeMs = 100;
  vehicle.telemetry = [
    { timeMs: 150, type: 'LOCAL_POSITION_NED', sourceSystem: 1, sourceComponent: 1,
      data: { x: 3, y: 4, z: -2, vx: 0, vy: 0, vz: 0, time_boot_ms: 50000 } },
    { timeMs: 180, type: 'LOCAL_POSITION_NED', sourceSystem: 1, sourceComponent: 1,
      data: { x: 4, y: 6, z: -5, vx: 0, vy: 0, vz: 0, time_boot_ms: 50030 } },
  ];
  assert.equal(sharedWorldFrame(run, 149).vehicles[0].estimatePositionWorldEnu, null);
  closeVector(sharedWorldFrame(run, 150).vehicles[0].estimatePositionWorldEnu, [10, 20, .195]);
  closeVector(sharedWorldFrame(run, 180).vehicles[0].estimatePositionWorldEnu, [12, 21, 3.195]);
  const later = sharedWorldFrame(run, 250).vehicles[0];
  closeVector(later.estimatePositionWorldEnu, [12, 21, 3.195]);
  close(later.estimateWorldErrorM, Math.hypot(12, 21, 3.195 - 4));
});

test('evaluator truth changes cannot alter task state, tree decisions or completion evidence', () => {
  const changed = structuredClone(withdrawal);
  for (const row of changed.truth) for (const v of row.vehicles) v.positionEnu = v.positionEnu.map(x => x + 20);
  assert.deepEqual(recoverySummary(changed), recoverySummary(withdrawal));
  for (const cursor of [0, withdrawal.withdrawal.requestedTimeMs, withdrawal.missionCompletedMs, withdrawal.endMs]) {
    const before = sharedWorldFrame(withdrawal, cursor), after = sharedWorldFrame(changed, cursor);
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(after.attempts, before.attempts);
    assert.deepEqual(after.mission, before.mission);
    assert.deepEqual(after.vehicles.map(v => v.bt), before.vehicles.map(v => v.bt));
    assert.deepEqual(after.vehicles.map(v => v.positionNed), before.vehicles.map(v => v.positionNed));
  }
});

test('actual minimum is recomputed from synchronized world samples with its exact evidence time', () => {
  for (const run of trace.cases) {
    let minimum = Infinity;
    for (const row of run.truth) for (let i = 0; i < 3; ++i) for (let j = i + 1; j < 3; ++j) {
      const a = row.vehicles[i], b = row.vehicles[j];
      const d = Math.sqrt(a.positionEnu.reduce((sum, value, axis) => sum + (value - b.positionEnu[axis]) ** 2, 0));
      minimum = Math.min(minimum, d);
    }
    const actual = sharedWorldSummary(run).closestApproach;
    close(actual.distanceM, minimum, 1e-12);
    // A stationary plateau can differ by sub-picometer rounding between sqrt
    // and hypot. Require genuine, matching evidence at the reported timestamp;
    // do not assert a different minimum's timestamp from that rounding tie.
    const evidence = run.truth.find(row => row.timeMs === actual.timeMs);
    assert.ok(evidence); assert.equal(actual.simTimeMs, evidence.simTimeMs);
    const [a, b] = actual.vehicleIds.map(id => evidence.vehicles.find(vehicle => vehicle.id === id));
    assert.ok(a && b && a.id !== b.id);
    const measured = Math.sqrt(a.positionEnu.reduce((sum, value, axis) => sum + (value - b.positionEnu[axis]) ** 2, 0));
    close(measured, actual.distanceM, 1e-12);
  }
});

test('cumulative contacts expose per-step coverage and actual ground contact for all three vehicles', () => {
  for (const run of trace.cases) {
    const last = run.truth.at(-1), summary = sharedWorldSummary(run);
    assert.deepEqual(summary.contactTotals, last.contactTotals);
    assert.equal(summary.unexpectedContactCount, last.contactHistory.filter(p => p.kind !== 'ground').length);
    for (const vehicle of run.vehicles) assert.ok(last.contactHistory.some(pair => pair.kind === 'ground'
      && [pair.collision1, pair.collision2].some(name => name.startsWith(`${vehicle.id}::`))));
    for (const row of run.truth) {
      close(row.observerSteps, row.simTimeMs - row.observerStartSimTimeMs + 1);
      assert.equal(row.collisionCount, 31);
      for (const pair of row.contacts) {
        const history = row.contactHistory.find(p => p.collision1 === pair.collision1 && p.collision2 === pair.collision2);
        close(history.lastSimTimeMs, row.simTimeMs);
      }
    }
    const cursor = run.truth[Math.floor(run.truth.length / 2)].timeMs;
    const frame = sharedWorldFrame(run, cursor), held = run.truth.filter(row => row.timeMs <= cursor).at(-1);
    assert.deepEqual(frame.world.contactTotals, held.contactTotals);
    assert.deepEqual(frame.world.contactHistory, held.contactHistory);
  }
});

test('a coherent non-ground contact remains a separate adverse outcome even after six tasks finish', () => {
  // Synthetic injected evidence exercises importer semantics, not an observed
  // collision claim about the bundled flights.
  const changed = structuredClone(trace), run = changed.cases[0], last = run.truth.at(-1);
  const pair = { collision1: 'A1::iris_with_standoffs::base_link::base_collision',
    collision2: 'A2::iris_with_standoffs::base_link::base_collision', kind: 'vehicle' };
  assert.equal(last.contactTotals.vehicleSteps, 0);
  last.contacts.push(pair);
  last.contactHistory.push({ ...pair, steps: 1, firstSimTimeMs: last.simTimeMs, lastSimTimeMs: last.simTimeMs });
  last.contactTotals.vehicleSteps = 1;
  assert.equal(validateSharedWorldTrace(changed), changed);
  const summary = sharedWorldSummary(run);
  assert.equal(summary.tasksCompleted, 6);
  assert.equal(summary.landedVehicles, 3);
  assert.equal(summary.unexpectedContactCount, 1);
  assert.equal(summary.contactTotals.vehicleSteps, 1);
  assert.equal(sharedWorldFrame(run, last.timeMs - .001).world.unexpectedContactCount, 0);
  assert.equal(sharedWorldFrame(run, last.timeMs).world.unexpectedContactCount, 1);
});

test('world and execution events share receipt ordering while physics duration keeps its own clock', () => {
  const run = triangleFixture(), events = sharedWorldEvents(run);
  assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
  assert.deepEqual(events.filter(event => event.kind === 'world').map(event => event.timeMs), [100,200,300]);
  const summary = sharedWorldSummary(run);
  assert.equal(summary.simDurationMs, 100);
  assert.equal(summary.observedRealtimeFactor, .5);
  assert.equal(summary.maximumReceiptGapMs, 100);
  assert.equal(summary.maximumSimGapMs, 50);
  assert.equal(sharedWorldFrame(run, 250).mission.elapsedMs, recoveryFrame(run, 250).mission.elapsedMs);
});

test('imports cannot replace the fixed site, monitored geometry, model identities or JSON routes', () => {
  for (const change of [
    copy => { copy.cases[0].world.buildings[0].size[2] += 1; },
    copy => { copy.cases[0].world.collisionNames[0] = 'fake::collision'; },
    copy => { copy.cases[0].vehicles[1].modelName = 'A1'; },
    copy => { copy.cases[0].vehicles[1].jsonPort = 9002; },
    copy => { copy.cases[0].resources[0].gazebo.pid += 1; },
    copy => { copy.cases[0].vehicles[0].originTruthEnu[0] += 1; },
  ]) reject(change);
});

test('imports reject missing vehicles, invalid rotations and broken clock or coverage claims', () => {
  for (const change of [
    copy => { copy.cases[0].truth[1].vehicles.pop(); },
    copy => { copy.cases[0].truth[1].vehicles[0].id = 'A2'; },
    copy => { copy.cases[0].truth[1].vehicles[0].orientationXyzw = [0,0,0,0]; },
    copy => { copy.cases[0].truth[1].vehicles[0].positionEnu[0] = NaN; },
    copy => { copy.cases[0].truth[1].vehicles[0].positionEnu[0] = 1e308;
      copy.cases[0].truth[1].vehicles[1].positionEnu[0] = -1e308; },
    copy => { copy.cases[0].truth[1].simTimeMs = copy.cases[0].truth[0].simTimeMs; },
    copy => { copy.cases[0].truth[1].observerSteps += 1; },
    copy => { copy.cases[0].truth[1].observerStartSimTimeMs += 1; },
    copy => { copy.cases[0].truth[1].collisionCount = 30; },
  ]) reject(change);
});

test('imports reject invented, reclassified, deleted or prematurely reported collision evidence', () => {
  for (const change of [
    copy => { copy.cases[0].truth.at(-1).contactHistory[0].collision1 = 'unknown::shape'; },
    copy => { copy.cases[0].truth.at(-1).contactHistory[0].kind = 'vehicle'; },
    copy => { copy.cases[0].truth.at(-1).contactHistory[0].steps += 100000; },
    copy => { copy.cases[0].truth.at(-1).contactHistory[0].firstSimTimeMs += 1; },
    copy => { copy.cases[0].truth.at(-1).contactHistory.pop(); },
    copy => { copy.cases[0].truth.at(-1).contactTotals.groundSteps = 0; },
    copy => { const row = copy.cases[0].truth.find(r => r.contacts.length); row.contacts[0].kind = 'vehicle'; },
    copy => { const row = copy.cases[0].truth.find(r => r.contacts.length); row.contacts.push(structuredClone(row.contacts[0])); },
    copy => { const row = copy.cases[0].truth.find(r => r.contacts.length); row.contacts = []; },
  ]) reject(change);
});

test('shared-world imports still require normal EKF execution and real task ownership evidence', () => {
  for (const change of [
    copy => { copy.runtime.physics = 'independent-SITL-worlds'; },
    copy => { copy.runtime.noTimeSync = true; },
    copy => { copy.runtime.lockStep = false; },
    copy => { copy.runtime.maxStepSizeMs = 2; },
    copy => { copy.cases[0].vehicles[0].parameters.FRAME_TYPE = 0; },
    copy => { copy.cases[0].vehicles[0].parameters.AHRS_EKF_TYPE = 10; },
    copy => { copy.cases[0].vehicles[0].parameters.ARMING_SKIPCHK = 1; },
    copy => { copy.cases[0].assignments[0].pairs[0].costM += 10; },
    copy => { const run = copy.cases.find(r => r.id === 'withdrawal'); const old = run.attempts.find(a => a.status === 'cancelled'); old.releasedTimeMs = old.cancelledTimeMs; },
  ]) reject(change);
});
