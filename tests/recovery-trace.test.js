import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  attemptCompletionEvidence, flightCompletionEvidence, missionPosition, targetNed,
  recoveryEvents, recoveryFrame, recoverySummary, validateRecoveryTrace,
} from '../src/recovery-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-recovery.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const withdrawal = trace.cases.find(run => run.id === 'withdrawal');
const cancelled = run => run.attempts.find(attempt => attempt.cancelledTimeMs !== null);
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const reject = mutate => {
  const copy = structuredClone(trace); mutate(copy);
  assert.throws(() => validateRecoveryTrace(copy), /Invalid recovery trace:/);
};
const local = (timeMs, position = [6, 0, -4], velocity = [0, 0, 0], sourceSystem = 1) => ({
  timeMs, type: 'LOCAL_POSITION_NED', sourceSystem, sourceComponent: 1,
  data: { x: position[0], y: position[1], z: position[2], vx: velocity[0], vy: velocity[1], vz: velocity[2], time_boot_ms: timeMs + 50000 },
});

// These small observer fixtures test boundaries; only the bundled artifact is
// evidence of actual autopilot execution.
function fixture(times = [100, 300, 500, 700, 900, 1100]) {
  const attempt = { id: 'P1', vehicleId: 'A1', taskId: 'T1', commandId: 'task-P1',
    assignedTimeMs: 90, sentTimeMs: 100, cancelledTimeMs: null, completedTimeMs: null, releasedTimeMs: null };
  const vehicle = { id: 'A1', systemId: 1, componentId: 1, originNed: [0, 0, 0], padEnu: [-6, 0, 0],
    commands: [{ id: attempt.commandId, kind: 'setpoint', timeMs: 100, positionNed: [6, 0, -4],
      targetSystem: 1, targetComponent: 1, routeSystem: 1 }], acks: [], telemetry: times.map(time => local(time)), events: [], statuses: [] };
  return { config: structuredClone(nominal.config), controller: { systemId: 255, componentId: 190 },
    endMs: 2000, missionDeadlineMs: 1800, attempts: [attempt], vehicles: [vehicle] };
}

test('actual three-process cases validate without mutation and preserve independent identities and frames', () => {
  const before = structuredClone(trace);
  assert.equal(validateRecoveryTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.equal(trace.runtime.vehicleCount, 3);
  assert.equal(trace.runtime.physics, 'independent-SITL-worlds');
  for (const run of trace.cases) {
    assert.equal(new Set(run.vehicles.map(vehicle => vehicle.pid)).size, 3);
    assert.deepEqual(run.vehicles.map(vehicle => vehicle.systemId), [1, 2, 3]);
    assert.deepEqual(run.vehicles.map(vehicle => vehicle.port), [5760, 5770, 5780]);
    assert.ok(run.resources.some(sample => sample.timeMs > run.missionStartMs && sample.timeMs < run.missionClosedMs));
    assert.ok(run.resources.every(sample => sample.allRunning && sample.vehicles.length === 3 && sample.vehicles.every(row => row.rssKiB > 0)));
    for (const vehicle of run.vehicles) {
      assert.deepEqual(missionPosition(vehicle, vehicle.originNed), vehicle.padEnu);
      for (const task of run.tasks) missionPosition(vehicle, targetNed(vehicle, task.positionEnu)).forEach((value, axis) => close(value, task.positionEnu[axis]));
    }
  }
});

test('six unique tasks finish in each case while cancellation and final landing remain separate outcomes', () => {
  for (const run of trace.cases) {
    const summary = recoverySummary(run), completions = run.taskEvents.filter(event => event.type === 'completed');
    assert.equal(summary.tasksCompleted, 6);
    assert.equal(summary.landedVehicles, 3);
    assert.equal(new Set(completions.map(event => event.taskId)).size, 6);
    assert.equal(completions.length, 6);
    close(summary.missionElapsedMs, Math.max(...completions.map(event => event.timeMs)) - run.missionStartMs);
    assert.ok(summary.landedMs > summary.missionCompletedMs);
    const atCompletion = recoveryFrame(run, summary.missionCompletedMs);
    assert.equal(atCompletion.tasksCompleted, 6);
    assert.ok(atCompletion.landedVehicles < 3);
    assert.equal(atCompletion.mission.closed, summary.missionCompletedMs >= run.missionClosedMs);
    assert.equal(recoveryFrame(run, run.missionClosedMs).mission.closed, true);
  }
  assert.equal(recoverySummary(nominal).cancellations, 0);
  assert.equal(recoverySummary(nominal).reassignments, 0);
  assert.equal(recoverySummary(withdrawal).cancellations, 1);
  assert.equal(recoverySummary(withdrawal).reassignments, 1);
  assert.equal(nominal.attempts.length, 6);
  assert.equal(withdrawal.attempts.length, 7);
});

test('withdrawal locks the interrupted reservation until observed landing then creates a different attempt and owner', () => {
  const old = cancelled(withdrawal), next = withdrawal.attempts.find(attempt => attempt.taskId === old.taskId && attempt.id !== old.id);
  const a1 = withdrawal.vehicles[0], land = a1.commands.find(command => command.id === 'land');
  assert.equal(old.vehicleId, 'A1');
  assert.ok(['A2', 'A3'].includes(next.vehicleId));
  assert.equal(old.completedTimeMs, null);
  assert.equal(attemptCompletionEvidence(withdrawal, old), null);
  assert.ok(old.cancelledTimeMs >= withdrawal.withdrawal.requestedTimeMs);
  assert.ok(land.timeMs >= old.cancelledTimeMs);
  assert.ok(withdrawal.withdrawal.landedTimeMs > land.timeMs);
  assert.ok(old.releasedTimeMs >= withdrawal.withdrawal.landedTimeMs);
  assert.ok(next.assignedTimeMs >= old.releasedTimeMs);
  assert.ok(next.sentTimeMs >= next.assignedTimeMs);
  for (const cursor of [old.cancelledTimeMs, (old.cancelledTimeMs + old.releasedTimeMs) / 2, old.releasedTimeMs - .001]) {
    const task = recoveryFrame(withdrawal, cursor).tasks.find(row => row.id === old.taskId);
    assert.equal(task.state, 'locked'); assert.equal(task.ownerId, 'A1'); assert.equal(task.attemptId, old.id);
  }
  const released = recoveryFrame(withdrawal, old.releasedTimeMs).tasks.find(row => row.id === old.taskId);
  assert.equal(released.state, 'pending'); assert.equal(released.ownerId, null);
  const reassigned = recoveryFrame(withdrawal, next.assignedTimeMs).tasks.find(row => row.id === old.taskId);
  assert.equal(reassigned.ownerId, next.vehicleId); assert.equal(reassigned.attemptId, next.id);
  assert.ok(!withdrawal.attempts.some(attempt => attempt.vehicleId === 'A1' && attempt.assignedTimeMs > old.assignedTimeMs));
});

test('every online greedy decision uses its latest fresh poses and the ready task set', () => {
  for (const run of trace.cases) for (const decision of run.assignments) {
    const before = recoveryFrame(run, decision.timeMs - .000001);
    assert.deepEqual(decision.availableTaskIds, before.tasks.filter(task => task.state === 'pending').map(task => task.id));
    const candidates = [];
    for (const eligible of decision.eligible) {
      const vehicle = run.vehicles.find(row => row.id === eligible.vehicleId);
      const sample = vehicle.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= decision.timeMs).at(-1);
      close(sample.timeMs, eligible.poseSampleTimeMs);
      assert.ok(decision.timeMs - sample.timeMs <= run.config.freshnessMs);
      const p = missionPosition(vehicle, [sample.data.x, sample.data.y, sample.data.z]);
      p.forEach((value, axis) => close(value, eligible.positionEnu[axis]));
      for (const id of decision.availableTaskIds) {
        const task = run.tasks.find(row => row.id === id);
        candidates.push({ vehicleId: vehicle.id, taskId: id, costM: Math.hypot(p[0] - task.positionEnu[0], p[1] - task.positionEnu[1]) });
      }
    }
    candidates.sort((a, b) => a.costM - b.costM || a.vehicleId.localeCompare(b.vehicleId) || a.taskId.localeCompare(b.taskId));
    const selected = [];
    for (const pair of candidates) if (!selected.some(row => row.vehicleId === pair.vehicleId || row.taskId === pair.taskId)) selected.push(pair);
    assert.equal(decision.pairs.length, selected.length);
    for (const expected of selected) {
      const actual = decision.pairs.find(row => row.vehicleId === expected.vehicleId);
      assert.equal(actual.taskId, expected.taskId); close(actual.costM, expected.costM);
    }
  }
});

test('the actual reactive traversal rechecks withdrawal, halts its task before LAND and sends each request once', () => {
  const old = cancelled(withdrawal), a1 = withdrawal.vehicles[0];
  const tick = withdrawal.btTicks.find(tick => tick.vehicles.some(row => row.vehicleId === 'A1' && row.halts.some(halt => halt.attemptId === old.id)));
  const tree = tick.vehicles.find(row => row.vehicleId === 'A1');
  assert.equal(tree.inputs.withdrawRequested, true);
  assert.deepEqual(tree.visited.map(row => row.id), ['root', 'withdraw', 'withdrawRequested', 'withdrawLand']);
  assert.equal(tree.visited.find(row => row.id === 'withdrawRequested').status, 'SUCCESS');
  assert.equal(tree.status, 'RUNNING');
  assert.ok(tree.halts.find(row => row.attemptId === old.id).timeMs <= tree.actions.find(row => row.commandId === 'land').timeMs);
  const second = a1.commands.filter(command => command.kind === 'setpoint')[1];
  close(withdrawal.withdrawal.triggerTimeMs, second.timeMs + 500);
  assert.ok(tick.startedTimeMs >= withdrawal.withdrawal.triggerTimeMs);
  assert.ok(withdrawal.btTicks.filter(row => row.startedTimeMs < tick.startedTimeMs).at(-1).startedTimeMs < withdrawal.withdrawal.triggerTimeMs);
  for (const run of trace.cases) for (const vehicle of run.vehicles) {
    assert.equal(new Set(vehicle.commands.map(command => command.id)).size, vehicle.commands.length);
    for (const command of vehicle.commands) {
      const actions = run.btTicks.flatMap(t => t.vehicles.filter(row => row.vehicleId === vehicle.id).flatMap(row => row.actions));
      assert.equal(actions.filter(action => action.commandId === command.id).length, 1);
      if (command.kind === 'setpoint') assert.equal(vehicle.acks.some(ack => ack.commandId === command.id), false);
    }
    for (const t of run.btTicks) {
      const row = t.vehicles.find(row => row.vehicleId === vehicle.id);
      assert.ok(row.visited.some(node => node.id === 'withdrawRequested'));
      assert.ok(Object.values(row.inputs.telemetry).every(stamp => stamp === null || stamp <= t.startedTimeMs));
    }
  }
});

test('attempt completion needs a second of new good samples and includes exact tolerances', () => {
  const run = fixture(), attempt = run.attempts[0];
  assert.equal(attemptCompletionEvidence(run, attempt, 1099), null);
  assert.equal(attemptCompletionEvidence(run, attempt, 1100).timeMs, 1100);
  for (const sample of run.vehicles[0].telemetry) { sample.data.x += .5; sample.data.vx = .4; }
  assert.equal(attemptCompletionEvidence(run, attempt).timeMs, 1100);
  const held = fixture([100]); assert.equal(attemptCompletionEvidence(held, held.attempts[0]), null);
  const gap = fixture([100, 300, 700, 900, 1100]); assert.equal(attemptCompletionEvidence(gap, gap.attempts[0]), null);
  for (const key of ['x', 'vx']) {
    const bad = fixture(); bad.vehicles[0].telemetry[2].data[key] += key === 'x' ? .501 : .401;
    assert.equal(attemptCompletionEvidence(bad, bad.attempts[0]), null);
  }
});

test('cancellation excludes same-time and later task evidence while the exact mission deadline is inclusive', () => {
  const run = fixture(), attempt = run.attempts[0];
  attempt.cancelledTimeMs = 1100;
  assert.equal(attemptCompletionEvidence(run, attempt), null);
  attempt.cancelledTimeMs = null; run.missionDeadlineMs = 1100;
  assert.equal(attemptCompletionEvidence(run, attempt).timeMs, 1100);
  run.missionDeadlineMs = 1099;
  assert.equal(attemptCompletionEvidence(run, attempt), null);
});

test('replacement attempts cannot borrow a prior attempt’s dwell or another vehicle’s positions', () => {
  const run = fixture(), old = run.attempts[0], vehicle = run.vehicles[0];
  old.cancelledTimeMs = 699;
  const next = { ...old, id: 'P2', commandId: 'task-P2', assignedTimeMs: 699, sentTimeMs: 700, cancelledTimeMs: null };
  vehicle.commands.push({ ...vehicle.commands[0], id: next.commandId, timeMs: 700 }); run.attempts.push(next);
  assert.equal(attemptCompletionEvidence(run, old), null);
  assert.equal(attemptCompletionEvidence(run, next), null);
  vehicle.telemetry.push(...[1300, 1500, 1700].map(time => local(time)));
  assert.equal(attemptCompletionEvidence(run, next).timeMs, 1700);
  vehicle.telemetry.forEach(sample => { sample.sourceSystem = 2; });
  assert.equal(attemptCompletionEvidence(run, next), null);
});

test('landing requires this vehicle’s accepted request plus fresh post-request grounded and disarmed reports', () => {
  const run = structuredClone(withdrawal), a1 = run.vehicles[0];
  assert.equal(flightCompletionEvidence(run, a1, 'land').timeMs, run.withdrawal.landedTimeMs);
  a1.acks.filter(ack => ack.commandId === 'land').forEach(ack => { ack.sourceSystem = 2; });
  assert.equal(flightCompletionEvidence(run, a1, 'land'), null);
  const ackOnly = structuredClone(withdrawal), vehicle = ackOnly.vehicles[0];
  vehicle.telemetry = vehicle.telemetry.filter(sample => sample.type !== 'EXTENDED_SYS_STATE' || sample.data.landed_state !== 1);
  assert.equal(flightCompletionEvidence(ackOnly, vehicle, 'land'), null);
  assert.equal(recoveryFrame(ackOnly, ackOnly.endMs).landedVehicles, 2);
  const boundary = fixture([]), v = boundary.vehicles[0]; boundary.endMs = 4000;
  v.commands = [{ id: 'land', kind: 'command', timeMs: 1000, command: 21 }];
  v.acks = [{ commandId: 'land', command: 21, timeMs: 1050, result: 0,
    sourceSystem: 1, sourceComponent: 1, targetSystem: 255, targetComponent: 190 }];
  v.telemetry = [
    { timeMs: 500, type: 'EXTENDED_SYS_STATE', sourceSystem: 1, sourceComponent: 1, data: { landed_state: 2 } },
    { timeMs: 1100, type: 'HEARTBEAT', sourceSystem: 1, sourceComponent: 1, data: { base_mode: 0, custom_mode: 9 } },
    { timeMs: 2600, type: 'EXTENDED_SYS_STATE', sourceSystem: 1, sourceComponent: 1, data: { landed_state: 1 } },
  ];
  assert.equal(flightCompletionEvidence(boundary, v, 'land').timeMs, 2600);
  v.telemetry.at(-1).timeMs = 2601;
  assert.equal(flightCompletionEvidence(boundary, v, 'land'), null);
});

test('replay holds three independent channels and hides future attempts, withdrawals and tree decisions', () => {
  for (const run of trace.cases) {
    const before = structuredClone(run), events = recoveryEvents(run);
    assert.ok(events.every((event, i) => i === 0 || event.timeMs >= events[i - 1].timeMs));
    for (const cursor of [0, run.missionStartMs, run.attempts[0].sentTimeMs, run.missionCompletedMs, run.endMs]) {
      const frame = recoveryFrame(run, cursor);
      for (const vehicle of run.vehicles) {
        const current = frame.vehicles.find(row => row.id === vehicle.id);
        const sample = vehicle.telemetry.filter(row => row.type === 'LOCAL_POSITION_NED' && row.timeMs <= cursor).at(-1);
        assert.deepEqual(current.positionNed, sample ? [sample.data.x, sample.data.y, sample.data.z] : null);
        assert.equal(current.positionAgeMs, sample ? cursor - sample.timeMs : null);
        const task = frame.tasks.find(task => task.ownerId === vehicle.id && ['assigned', 'executing', 'locked'].includes(task.state));
        const attempt = run.attempts.find(attempt => attempt.id === task?.attemptId);
        assert.deepEqual(current.targetNed, attempt?.positionNed ?? null);
        assert.ok(current.bt === null || current.bt.timeMs <= cursor);
        assert.ok(current.commands.every(row => row.timeMs <= cursor));
      }
      assert.ok(frame.assignments.every(row => row.timeMs <= cursor));
      for (const attempt of frame.attempts) for (const key of ['assignedTimeMs', 'sentTimeMs', 'completedTimeMs', 'cancelledTimeMs', 'releasedTimeMs']) {
        assert.ok(attempt[key] === null || attempt[key] <= cursor);
      }
      if (cursor < run.endMs) assert.equal(frame.outcome, null);
    }
    const beginning = recoveryFrame(run, 0);
    assert.deepEqual(beginning.attempts, []); assert.deepEqual(beginning.assignments, []);
    assert.ok(beginning.tasks.every(task => task.ownerId === null && task.state === 'pending'));
    assert.equal(beginning.withdrawal.requestedTimeMs, null);
    assert.deepEqual(run, before);
  }
});

test('imports reject cross-vehicle evidence, duplicate routes and incorrect request destinations', () => {
  reject(data => { data.cases[0].vehicles[0].telemetry[0].sourceSystem = 2; });
  reject(data => { data.cases[0].vehicles[0].acks[0].sourceSystem = 2; });
  reject(data => { data.cases[0].vehicles[1].port = 5760; });
  reject(data => { data.cases[0].vehicles[2].pid = data.cases[0].vehicles[0].pid; });
  reject(data => { data.cases[0].vehicles[0].commands.find(command => command.kind === 'setpoint').targetSystem = 2; });
  reject(data => { data.cases[0].vehicles[0].commands[0].routeSystem = 3; });
});

test('imports reject fabricated dwell, duplicate completion claims and cancellation that releases before landing', () => {
  reject(data => { data.cases[0].attempts[0].completedTimeMs = data.cases[0].attempts[0].sentTimeMs; });
  reject(data => { const run = data.cases[0]; run.taskEvents.push({ ...run.taskEvents.find(event => event.type === 'completed'), timeMs: run.endMs }); });
  reject(data => { const run = data.cases.find(row => row.id === 'withdrawal'); cancelled(run).releasedTimeMs = cancelled(run).cancelledTimeMs; });
  reject(data => { const run = data.cases.find(row => row.id === 'withdrawal'); run.withdrawal.landedTimeMs = run.vehicles[0].acks.find(ack => ack.commandId === 'land').timeMs; });
  reject(data => { const run = data.cases.find(row => row.id === 'withdrawal'); cancelled(run).completedTimeMs = cancelled(run).cancelledTimeMs + 2000; });
});

test('imports reject invented allocation costs, missing candidate tasks and future position inputs', () => {
  reject(data => { data.cases[0].assignments[0].pairs[0].costM += 1; });
  reject(data => { data.cases[0].assignments[0].availableTaskIds.pop(); });
  reject(data => { data.cases[0].assignments[0].eligible[0].poseSampleTimeMs = data.cases[0].assignments[0].timeMs + 1; });
  reject(data => { data.cases[0].assignments[0].eligible.pop(); });
  reject(data => { data.cases[0].assignments[0].pairs[1].taskId = data.cases[0].assignments[0].pairs[0].taskId; });
});

test('imports reject decorative or impossible BT records and repeated command side effects', () => {
  reject(data => { data.cases[0].btTicks[0].vehicles[0].visited[0].status = 'SUCCESS'; });
  reject(data => { data.cases[0].btTicks[0].vehicles[0].visited = []; });
  reject(data => { const run = data.cases.find(row => row.id === 'withdrawal'); const row = run.btTicks.flatMap(tick => tick.vehicles).find(row => row.halts.some(halt => halt.id === 'task')); row.halts = []; });
  reject(data => { const row = data.cases[0].btTicks.flatMap(tick => tick.vehicles).find(row => row.actions.length); row.actions.push({ ...row.actions[0] }); });
  reject(data => { const tick = data.cases[0].btTicks[0]; tick.vehicles[0].inputs.telemetry.LOCAL_POSITION_NED = tick.timeMs + 100; });
});

test('imports reject unsupported formats, modified criteria, false totals and unobserved process overlap', () => {
  reject(data => { data.kind = 'argos-ardupilot-fleet'; });
  reject(data => { data.schemaVersion = 2; });
  reject(data => { data.cases[0].config.withdrawalDelayMs = 0; });
  reject(data => { data.cases[0].missionDeadlineMs += 1; });
  reject(data => { data.cases[0].outcome.tasksCompleted = 5; });
  reject(data => { data.cases[0].resources[0].allRunning = false; });
  reject(data => { data.runtime.physics = 'shared-world'; });
  reject(data => { data.runtime.sourceSha256 = 'unverified'; });
  for (const cursor of [-1, NaN, Infinity, nominal.endMs + 1]) assert.throws(() => recoveryFrame(nominal, cursor));
});
