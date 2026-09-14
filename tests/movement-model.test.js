import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DT, MAX_SPEED, AGENT_RADIUS, WALL_RADIUS, GOAL_RADIUS, DEFAULT_GAINS,
  STALL_SPEED, STALL_WINDOW, STARTS, createMovementRun, stepMovement,
  finishMovement, resetMovement, observeMovement, movementCommand,
  segmentDistance, sweptClearance, length, distance, compareMovement,
} from '../src/movement-model.js';

const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test('potential components attract toward the goal, repel away from surfaces, and cap speed', () => {
  const command = movementCommand({ position: [0, 0], goal: [4, 0], walls: [[[-1, -1], [-1, 1]]], neighbors: [{ index: 1, position: [0, 0.6] }] }, DEFAULT_GAINS);
  assert.deepEqual(command.attraction, [2.4, 0]);
  assert.ok(command.obstacle[0] > 0);
  close(command.obstacle[1], 0);
  close(command.separation[0], 0);
  assert.ok(command.separation[1] < 0);
  close(length(command.velocity), MAX_SPEED);
  close(command.velocity[0] * command.raw[1] - command.velocity[1] * command.raw[0], 0);
  const quiet = movementCommand({ position: [0, 0], goal: [0.5, 0], walls: [[[-2, -1], [-2, 1]]], neighbors: [] }, DEFAULT_GAINS);
  assert.deepEqual(quiet.obstacle, [0, 0]);
  assert.deepEqual(quiet.velocity, [0.3, 0]);
});

test('observations include only local peers and decisions do not depend on evaluator truth', () => {
  const run = createMovementRun();
  const observation = observeMovement(run, 0);
  assert.deepEqual(observation.neighbors.map((peer) => peer.index), [1]);
  assert.deepEqual(Object.keys(observation).sort(), ['goal', 'index', 'neighbors', 'position', 'walls']);
  const altered = { ...run, history: [], minimumClearance: -999, pathLengths: [100, 100, 100], status: 'arrived' };
  assert.deepEqual(observeMovement(altered, 0), observation);
  const movedRemotePeer = { ...run, positions: [run.positions[0], run.positions[1], [40, 20]] };
  assert.deepEqual(movementCommand(observeMovement(movedRemotePeer, 0), run.gains), movementCommand(observation, run.gains));
  observation.position[0] = 999;
  observation.walls[0][0][0] = 999;
  assert.deepEqual(run.positions, STARTS);
  assert.equal(run.walls[0][0][0], -1.8);
});

test('updates read one old state, preserve reflection symmetry and respect the speed bound', () => {
  let run = createMovementRun();
  const original = structuredClone(run);
  run = stepMovement(run);
  assert.deepEqual(original.positions, STARTS);
  close(run.positions[1][0], -4 + DT * MAX_SPEED);
  close(run.positions[1][1], 0);
  for (let step = 1; step < 100; step += 1) {
    const previous = run;
    run = stepMovement(run);
    close(run.positions[0][0], run.positions[2][0]);
    close(run.positions[0][1], -run.positions[2][1]);
    close(run.positions[1][1], 0);
    run.positions.forEach((position, index) => assert.ok(distance(position, previous.positions[index]) <= DT * MAX_SPEED + 1e-12));
  }
  close(run.history.at(-1).time, 2);
});

test('swept geometry detects tunnelling and simultaneous peer contact with safe endpoints', () => {
  close(segmentDistance([-1, 0], [1, 0], [0, -1], [0, 1]), 0);
  close(segmentDistance([0, 0], [2, 0], [1, 0], [3, 0]), 0);
  close(segmentDistance([0, 0], [0, 0], [2, -1], [2, 1]), 2);
  close(segmentDistance([0, 0], [1, 0], [0, 2], [1, 2]), 2);
  const walls = [[[0, -1], [0, 1]]];
  assert.ok(sweptClearance([[-1, 0]], [[-1, 0]], walls) > 0);
  assert.ok(sweptClearance([[1, 0]], [[1, 0]], walls) > 0);
  close(sweptClearance([[-1, 0]], [[1, 0]], walls), -AGENT_RADIUS - WALL_RADIUS);
  close(sweptClearance([[-1, 0], [1, 0]], [[1, 0], [-1, 0]], []), -2 * AGENT_RADIUS);
  // Crossing paths at different times are not necessarily a collision.
  assert.ok(sweptClearance([[-1, 0], [0, -3]], [[1, 0], [0, 1]], []) > 0);
});

test('open field and corridor reach the region without swept contact', () => {
  for (const preset of ['open', 'corridor']) {
    const run = finishMovement(createMovementRun({ preset }));
    assert.equal(run.status, 'arrived');
    assert.equal(run.history.at(-1).arrived, 3);
    assert.ok(run.minimumClearance > 0.25);
    assert.ok(run.history.at(-1).maxGoalDistance <= GOAL_RADIUS);
    assert.ok(run.history.at(-2).maxGoalDistance > GOAL_RADIUS);
    assert.ok(run.step < 500);
  }
});

test('the U traps the local controller before arrival with cancelling velocity contributions', () => {
  const run = finishMovement(createMovementRun({ preset: 'trap' }));
  assert.equal(run.status, 'stalled');
  assert.equal(run.history.at(-1).arrived, 0);
  assert.ok(run.history.at(-1).maxGoalDistance > 3.5);
  assert.ok(run.minimumClearance > 0);
  assert.ok(run.history.slice(-STALL_WINDOW).every((point) => point.maxSpeed < STALL_SPEED));
  const command = movementCommand(observeMovement(run, 1), run.gains);
  assert.ok(command.attraction[0] > 2);
  assert.ok(command.obstacle[0] < -2);
  assert.ok(length(command.velocity) < STALL_SPEED);
});

test('removing each repulsion term exposes the corresponding contact failure', () => {
  for (const options of [{ preset: 'open', gains: { separation: 0 } }, { preset: 'trap', gains: { obstacle: 0 } }]) {
    const run = finishMovement(createMovementRun(options));
    assert.equal(run.status, 'collision');
    assert.ok(run.minimumClearance <= 0);
    assert.ok(run.history.at(-2).clearance > 0);
    assert.equal(run.history.at(-1).arrived, 0);
    assert.equal(stepMovement(run), run);
  }
});

test('reset reproduces a complete trace and terminal runs do not keep advancing', () => {
  const first = finishMovement(createMovementRun({ preset: 'trap', gains: { obstacle: 0.2 } }));
  const reset = resetMovement(first);
  assert.deepEqual(reset.positions, STARTS);
  assert.equal(reset.step, 0);
  assert.equal(reset.gains.obstacle, 0.2);
  assert.deepEqual(finishMovement(reset), first);
  assert.equal(stepMovement(first), first);
});

test('invalid configuration is rejected and weak positive repulsion can still collide', () => {
  for (const gains of [{ attraction: NaN }, { obstacle: -0.01 }, { separation: Infinity }, { attraction: 1.21 }]) {
    assert.throws(() => createMovementRun({ gains }), RangeError);
  }
  assert.throws(() => createMovementRun({ preset: 'unknown' }), RangeError);
  assert.throws(() => observeMovement(createMovementRun(), 3), RangeError);
  const contact = finishMovement(createMovementRun({ preset: 'open', gains: { separation: 1e-12 } }));
  assert.equal(contact.status, 'collision');
  assert.equal(stepMovement(contact), contact);
  assert.throws(() => movementCommand(observeMovement(contact, 0), contact.gains), /undefined at contact/);
});

test('reference comparisons share the model and reproduce their declared outcomes', () => {
  const references = compareMovement();
  assert.deepEqual(references.map((result) => result.status), ['arrived', 'arrived', 'stalled', 'collision', 'collision']);
  for (const result of references) {
    const run = finishMovement(createMovementRun(result.initial));
    assert.equal(result.step, run.step);
    assert.deepEqual(result.finalPositions, run.positions);
    close(result.time, result.step * DT);
  }
});
