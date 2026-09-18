import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  fleetEvents, fleetFrame, fleetSummary, missionPosition, targetNed,
  taskCompletionEvidence, validateFleetTrace,
} from '../src/fleet-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-fleet.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const misaddressed = trace.cases.find(run => run.id === 'misaddressed');
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const reject = mutate => {
  const copy = structuredClone(trace); mutate(copy);
  assert.throws(() => validateFleetTrace(copy), /Invalid fleet trace:/i);
};
const waypoint = vehicle => vehicle.commands.find(command => command.id === 'waypoint');
const local = (timeMs, xyz = [6, 0, -4], velocity = [0, 0, 0], system = 1) => ({
  timeMs, type: 'LOCAL_POSITION_NED', sourceSystem: system, sourceComponent: 1,
  data: { x: xyz[0], y: xyz[1], z: xyz[2], vx: velocity[0], vy: velocity[1], vz: velocity[2], time_boot_ms: Math.round(timeMs + 50000) },
});

// Internal observer fixtures isolate sample/deadline rules. Actual runtime
// evidence comes only from the separately recorded bundled SITL artifact.
function taskFixture(times = [19100, 19300, 19500, 19700, 19900, 20100]) {
  const vehicle = {
    id: 'A1', systemId: 1, componentId: 1, originNed: [0, 0, 0], padEnu: [-4, 0, 0],
    commands: [{ id: 'waypoint', timeMs: 110, kind: 'setpoint', positionNed: [6, 0, -4], targetSystem: 1 }],
    acks: [], telemetry: times.map(time => local(time)), events: [], statuses: [],
  };
  return {
    config: structuredClone(nominal.config), controller: { systemId: 255, componentId: 190 },
    endMs: 22000, missionDeadlineMs: 20100,
    events: [{ stage: 'mission', status: 'start', timeMs: 100 }, { stage: 'mission', status: 'complete', timeMs: 20125 }],
    vehicles: [vehicle],
  };
}

test('actual two-process recordings validate immutably with distinct identities, routes and resource samples', () => {
  const before = structuredClone(trace);
  assert.equal(validateFleetTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.runtime.physics, 'independent-SITL-worlds');
  assert.equal(trace.runtime.vehicleCount, 2);
  for (const run of trace.cases) {
    assert.notEqual(run.vehicles[0].pid, run.vehicles[1].pid);
    assert.deepEqual(run.vehicles.map(vehicle => vehicle.systemId), [1, 2]);
    assert.deepEqual(run.vehicles.map(vehicle => vehicle.port), [5760, 5770]);
    assert.deepEqual(run.vehicles.map(vehicle => vehicle.parameters.MAV_SYSID), [1, 2]);
    assert.ok(run.resources.some(sample => sample.timeMs >= fleetSummary(run).dispatchMs && sample.timeMs <= run.missionDeadlineMs));
    assert.ok(run.resources.every(sample => sample.bothRunning && sample.vehicles.every(vehicle => vehicle.rssKiB > 0)));
  }
});

test('task failure stays separate from correctly addressed landing cleanup for both vehicles', () => {
  const good = fleetSummary(nominal), bad = fleetSummary(misaddressed);
  assert.equal(good.tasksCompleted, 2);
  assert.equal(good.missionStatus, 'completed');
  assert.equal(bad.tasksCompleted, 1);
  assert.equal(bad.missionStatus, 'partial');
  assert.equal(bad.vehicles[0].taskCompletedMs, null);
  assert.ok(bad.vehicles[1].taskCompletedMs !== null);
  for (const run of trace.cases) {
    const summary = fleetSummary(run), frame = fleetFrame(run, run.endMs);
    assert.equal(summary.landedVehicles, 2);
    assert.equal(frame.landedVehicles, 2);
    assert.ok(summary.landedMs > run.missionDeadlineMs);
    for (const vehicle of run.vehicles) {
      const land = vehicle.commands.find(command => command.id === 'land');
      assert.equal(land.targetSystem, vehicle.systemId);
      assert.equal(land.routeSystem, vehicle.systemId);
      assert.ok(land.timeMs >= run.events.find(event => event.status === 'complete').timeMs);
    }
  }
});

test('only A1 waypoint destination changes and neither setpoint has a fabricated ACK', () => {
  for (const run of trace.cases) {
    for (const vehicle of run.vehicles) {
      const command = waypoint(vehicle), wrong = run.id === 'misaddressed' && vehicle.id === 'A1';
      assert.equal(command.targetSystem, wrong ? 2 : vehicle.systemId);
      assert.equal(command.routeSystem, vehicle.systemId);
      assert.equal(command.targetComponent, 1);
      assert.equal(command.message, 'SET_POSITION_TARGET_LOCAL_NED');
      assert.equal(command.mask, 3576);
      assert.equal(command.frame, 1);
      assert.equal(vehicle.acks.some(ack => ack.commandId === 'waypoint'), false);
      const state = fleetFrame(run, run.endMs).vehicles.find(row => row.id === vehicle.id).commandStates.find(row => row.id === 'waypoint');
      assert.equal(state.admission, 'not-applicable');
      assert.equal(state.ack, null);
      assert.equal(fleetSummary(run).vehicles.find(row => row.id === vehicle.id).routeMismatch, wrong);
    }
  }
});

test('supplied ENU registration and inverse target conversion preserve independent NED origins', () => {
  const a = { originNed: [100, 200, -3], padEnu: [-4, 0, 0] };
  const b = { originNed: [-17, 30, 8], padEnu: [4, 0, 0] };
  assert.deepEqual(missionPosition(a, a.originNed), a.padEnu);
  assert.deepEqual(missionPosition(b, b.originNed), b.padEnu);
  assert.deepEqual(targetNed(a, [-4, 6, 4]), [106, 200, -7]);
  assert.deepEqual(targetNed(b, [4, 8, 4]), [-9, 30, 4]);
  for (const vehicle of [a, b]) {
    for (const target of [[0, 0, 0], [-4, 6, 4], [4, 8, 4], [1.25, -2.5, 6.75]]) {
      missionPosition(vehicle, targetNed(vehicle, target)).forEach((value, axis) => close(value, target[axis]));
    }
  }
});

test('greedy ownership and costs derive from each latest fresh horizontal pose at assignment', () => {
  for (const run of trace.cases) {
    const available = [];
    for (const vehicle of run.vehicles) {
      const pose = vehicle.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= run.assignmentTimeMs).at(-1);
      assert.ok(run.assignmentTimeMs - pose.timeMs <= run.config.freshnessMs);
      const point = missionPosition(vehicle, [pose.data.x, pose.data.y, pose.data.z]);
      for (const task of run.tasks) available.push({ vehicleId: vehicle.id, taskId: task.id,
        costM: Math.hypot(point[0] - task.positionEnu[0], point[1] - task.positionEnu[1]),
        positionEnu: point, poseSampleTimeMs: pose.timeMs });
    }
    available.sort((a, b) => a.costM - b.costM || a.vehicleId.localeCompare(b.vehicleId) || a.taskId.localeCompare(b.taskId));
    const selected = [];
    for (const pair of available) if (!selected.some(row => row.vehicleId === pair.vehicleId || row.taskId === pair.taskId)) selected.push(pair);
    for (const expected of selected) {
      const actual = run.assignments.find(row => row.vehicleId === expected.vehicleId);
      assert.equal(actual.taskId, expected.taskId);
      close(actual.costM, expected.costM);
      assert.deepEqual(actual.positionEnu, expected.positionEnu);
      close(actual.poseSampleTimeMs, expected.poseSampleTimeMs);
    }
  }
});

test('task completion includes the exact deadline but excludes observation closure overshoot', () => {
  const exact = taskFixture();
  assert.equal(taskCompletionEvidence(exact, exact.vehicles[0], 20099), null);
  assert.equal(taskCompletionEvidence(exact, exact.vehicles[0], 20100).timeMs, 20100);
  const late = taskFixture([19101, 19301, 19501, 19701, 19901, 20101]);
  assert.equal(taskCompletionEvidence(late, late.vehicles[0]), null);
  for (const run of trace.cases) {
    close(fleetSummary(run).deadlineMs, run.missionDeadlineMs);
    close(run.missionDeadlineMs, run.events.find(event => event.status === 'start').timeMs + 20000);
  }
});

test('only new qualifying samples sustain task dwell; a gap, speed excursion or outside radius resets it', () => {
  const held = taskFixture([19100]);
  assert.equal(taskCompletionEvidence(held, held.vehicles[0]), null);
  const gap = taskFixture([19100, 19300, 19700, 19900, 20100]);
  assert.equal(taskCompletionEvidence(gap, gap.vehicles[0]), null);
  for (const patch of [row => { row.data.x += .501; }, row => { row.data.vx = .401; }]) {
    const run = taskFixture(); patch(run.vehicles[0].telemetry[2]);
    assert.equal(taskCompletionEvidence(run, run.vehicles[0]), null);
  }
  const boundary = taskFixture();
  boundary.vehicles[0].telemetry.forEach(row => { row.data.x += .5; row.data.vx = .4; });
  assert.equal(taskCompletionEvidence(boundary, boundary.vehicles[0]).timeMs, 20100);
});

test('wrong-source positions and ACKs cannot establish another vehicle’s task or landing', () => {
  const run = taskFixture();
  run.vehicles[0].telemetry.forEach(row => { row.sourceSystem = 2; });
  assert.equal(taskCompletionEvidence(run, run.vehicles[0]), null);
  const corrupted = structuredClone(nominal), first = corrupted.vehicles[0];
  first.acks.filter(ack => ack.commandId === 'land').forEach(ack => { ack.sourceSystem = 2; });
  assert.equal(fleetFrame(corrupted, corrupted.endMs).landedVehicles, 1);
});

test('shared replay holds each vehicle and telemetry channel independently without future outcomes', () => {
  for (const run of trace.cases) {
    const before = structuredClone(run), events = fleetEvents(run);
    assert.ok(events.every((event, index) => index === 0 || event.timeMs >= events[index - 1].timeMs));
    for (const timeMs of [0, run.assignmentTimeMs - .001, run.assignmentTimeMs, run.missionDeadlineMs, run.endMs]) {
      const frame = fleetFrame(run, timeMs);
      assert.equal(frame.assignments.length, timeMs >= run.assignmentTimeMs ? 2 : 0);
      for (const vehicle of run.vehicles) {
        const result = frame.vehicles.find(row => row.id === vehicle.id);
        const pose = vehicle.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= timeMs).at(-1);
        const attitude = vehicle.telemetry.filter(row => row.type === 'ATTITUDE' && row.timeMs <= timeMs).at(-1);
        assert.deepEqual(result.positionNed, pose ? [pose.data.x, pose.data.y, pose.data.z] : null);
        assert.deepEqual(result.attitude, attitude ? { roll: attitude.data.roll, pitch: attitude.data.pitch, yaw: attitude.data.yaw } : null);
        assert.equal(result.positionAgeMs, pose ? timeMs - pose.timeMs : null);
        assert.equal(result.attitudeAgeMs, attitude ? timeMs - attitude.timeMs : null);
        assert.ok(!result.taskEvidence || result.taskEvidence.timeMs <= timeMs);
        assert.ok(result.commands.every(row => row.timeMs <= timeMs));
        assert.ok(result.acks.every(row => row.timeMs <= timeMs));
        assert.ok(result.events.every(row => row.timeMs <= timeMs));
      }
      if (timeMs < run.endMs) assert.equal(frame.outcome, null);
    }
    const initial = fleetFrame(run, 0);
    assert.equal(initial.mission.startTimeMs, null);
    assert.equal(initial.mission.endTimeMs, null);
    assert.deepEqual(run, before);
  }
});

test('imports reject source confusion, duplicate routes and undeclared setpoint addressing', () => {
  reject(data => { data.cases[0].vehicles[0].telemetry[0].sourceSystem = 2; });
  reject(data => { data.cases[0].vehicles[0].acks[0].sourceSystem = 2; });
  reject(data => { data.cases[0].vehicles[0].acks[0].targetSystem = 1; });
  reject(data => { data.cases[0].vehicles[0].acks[0].routeSystem = 2; });
  reject(data => { data.cases[0].vehicles[1].port = 5760; });
  reject(data => { data.cases[0].vehicles[1].pid = data.cases[0].vehicles[0].pid; });
  reject(data => { waypoint(data.cases[0].vehicles[0]).targetSystem = 0; });
  reject(data => { waypoint(data.cases[0].vehicles[0]).routeSystem = 2; });
  reject(data => { waypoint(data.cases.find(run => run.id === 'misaddressed').vehicles[0]).targetSystem = 1; });
});

test('imports reject invented setpoint ACKs, assignment costs, duplicate ownership and future inputs', () => {
  reject(data => { const vehicle = data.cases[0].vehicles[0]; vehicle.acks.push({ ...vehicle.acks.at(-1), commandId: 'waypoint', command: null }); });
  reject(data => { data.cases[0].assignments[0].costM += 1; });
  reject(data => { data.cases[0].assignments[0].taskId = data.cases[0].assignments[1].taskId; });
  reject(data => { data.cases[0].assignments[0].positionEnu[0] += 1; });
  reject(data => { data.cases[0].assignments[0].poseSampleTimeMs = data.cases[0].assignmentTimeMs + 1; });
});

test('imports reject false success, completion without measured dwell and missing landing evidence', () => {
  reject(data => { const run = data.cases.find(row => row.id === 'misaddressed'); run.outcome.status = 'completed'; run.outcome.tasksCompleted = 2; });
  reject(data => { const v = data.cases[0].vehicles[0]; v.events.find(row => row.stage === 'waypoint' && row.status === 'complete').timeMs = waypoint(v).timeMs; v.events.sort((a, b) => a.timeMs - b.timeMs); });
  reject(data => { data.cases[0].vehicles[0].telemetry = data.cases[0].vehicles[0].telemetry.filter(row => row.type !== 'EXTENDED_SYS_STATE'); });
  reject(data => { data.cases.find(run => run.id === 'misaddressed').vehicles[0].taskResult.status = 'reached'; });
});

test('imports reject changed deadline, flight parameters, frame registration and resource claims', () => {
  reject(data => { data.cases[0].missionDeadlineMs += 1; });
  reject(data => { data.cases[0].config.missionDurationMs += 1000; });
  reject(data => { data.cases[0].vehicles[0].parameters.MAV_SYSID = 2; });
  reject(data => { data.cases[0].vehicles[0].parameters.ARMING_SKIPCHK = 1; });
  reject(data => { data.cases[0].vehicles[0].padEnu[0] += 1; });
  reject(data => { data.cases[0].vehicles[0].originTimeMs += 1; });
  reject(data => { data.cases[0].vehicles[0].homeGps[0] += .01; });
  reject(data => { data.cases[0].resources[0].bothRunning = false; });
  reject(data => { data.cases[0].resources[0].vehicles[0].rssKiB = -1; });
  reject(data => { data.runtime.physics = 'shared-Gazebo-world'; });
});

test('unsupported formats, nonfinite timestamps and out-of-range replay cursors are rejected', () => {
  reject(data => { data.kind = 'argos-ardupilot-sitl'; });
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.cases = []; });
  reject(data => { data.cases[1] = structuredClone(data.cases[0]); });
  reject(data => { data.cases[0].vehicles[0].telemetry[0].timeMs = NaN; });
  reject(data => { data.runtime.sourceSha256 = 'unverified'; });
  for (const timeMs of [-1, NaN, Infinity, nominal.endMs + 1]) assert.throws(() => fleetFrame(nominal, timeMs));
});
