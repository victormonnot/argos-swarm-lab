import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CBBA_ROUNDS, CAPACITY, RESTORE_ROUND, UTILITIES, METHODS, SCHEDULES,
  consensusDecision, processPackets, releaseBundle, buildBundle, linkAvailable,
  exactAllocation, evaluateRun, createRun, stepRun, runToEnd, resetRun, referenceComparisons,
} from '../src/cbba-model.js';

const copy = (value) => structuredClone(value);
const advance = (run, round) => { while (run.round < round) stepRun(run); return run; };
const blankAgent = (id, utilities, agentCount = 3) => ({ id, utilities, bundle: [], path: [], winners: utilities.map(() => -1), bids: utilities.map(() => 0), timestamps: Array(agentCount).fill(0), lastReceived: [], lastReleased: [], lastAdded: [] });

test('initial bundles use only local marginal scores and expose competing assignments before communication', () => {
  const run = createRun();
  assert.equal(run.round, 0);
  assert.deepEqual(run.agents.map((agent) => agent.bundle), [[0, 1], [0, 3], [0, 3]]);
  assert.deepEqual(run.agents.map((agent) => agent.utilities), UTILITIES);
  assert.equal(run.metrics.conflicts, 2); assert.equal(run.metrics.unassigned, 3);
  assert.equal(run.metrics.uniqueAssigned, 1); assert.equal(run.metrics.score, null);
  assert.equal(run.metrics.agreement, false); assert.equal(run.metrics.firstAgreementRound, null);
  assert.deepEqual(run.counters, { attempted: 0, delivered: 0, dropped: 0 });
  assert.deepEqual(run.agents.map((agent) => agent.timestamps), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
});

test('equal scores use ascending task IDs locally and the lower agent ID for competing claims', () => {
  const agent = blankAgent(1, [10, 10, 9]);
  buildBundle(agent);
  assert.deepEqual(agent.bundle, [0, 1]); assert.deepEqual(agent.path, [0, 1]);
  const incoming = { from: 0, winners: [0, -1, -1], bids: [10, 0, 0], timestamps: [0, 0, 0] };
  processPackets(agent, [Object.freeze(incoming)], 1);
  releaseBundle(agent); buildBundle(agent);
  assert.deepEqual(agent.bundle, [1, 2]);
  assert.equal(agent.winners[0], 0); assert.equal(agent.bids[0], 10);
  const incumbent = blankAgent(0, [10]); buildBundle(incumbent);
  processPackets(incumbent, [{ from: 1, winners: [1], bids: [10], timestamps: [0, 0, 0] }], 1);
  assert.equal(incumbent.winners[0], 0);
});

test('the 17 consensus cases distinguish owner assertions, stale relays and explicit relinquishment', () => {
  // Independently specified examples of every Table 1 row. Four identities
  // exercise the two-distinct-third-party case absent from this three-agent run.
  const ownT = [0, 3, 3, 3];
  const cases = [
    [1, 0, 1, 11, [0, 0, 0, 0], 'update'],
    [2, 1, 1, 1, [0, 0, 0, 0], 'update'],
    [3, 2, 1, 1, [0, 0, 4, 0], 'update'],
    [4, -1, 1, 1, [0, 0, 0, 0], 'update'],
    [5, 0, 0, 11, [0, 0, 0, 0], 'leave'],
    [6, 1, 0, 11, [0, 0, 0, 0], 'reset'],
    [7, 2, 0, 11, [0, 0, 4, 0], 'reset'],
    [8, -1, 0, 11, [0, 0, 0, 0], 'leave'],
    [9, 0, 2, 11, [0, 0, 4, 0], 'update'],
    [10, 1, 2, 11, [0, 0, 3, 0], 'reset'],
    [11, 2, 2, 1, [0, 0, 4, 0], 'update'],
    [12, 3, 2, 11, [0, 0, 2, 4], 'reset'],
    [13, -1, 2, 11, [0, 0, 3, 0], 'leave'],
    [14, 0, -1, 0, [0, 0, 0, 0], 'leave'],
    [15, 1, -1, 0, [0, 0, 0, 0], 'update'],
    [16, 2, -1, 0, [0, 0, 4, 0], 'update'],
    [17, -1, -1, 0, [0, 0, 0, 0], 'leave'],
  ];
  for (const [row, ownWinner, incomingWinner, bid, incomingT, action] of cases) {
    assert.deepEqual(consensusDecision(0, 1, ownWinner, 10, incomingWinner, bid, ownT, incomingT), { row, action });
  }
  // A high stale relay cannot override an owner, and a fresh weaker relay
  // cannot outbid one. This is not simple maximum-bid gossip.
  assert.equal(consensusDecision(0, 1, 0, 10, 2, 99, ownT, [0, 0, 3, 0]).action, 'leave');
  assert.equal(consensusDecision(0, 1, 0, 10, 2, 9, ownT, [0, 0, 4, 0]).action, 'leave');
  assert.equal(consensusDecision(0, 1, 1, 10, 2, 9, ownT, [0, 0, 4, 0]).action, 'update');
  assert.equal(consensusDecision(0, 1, -1, 0, 2, 9, ownT, [0, 0, 4, 0]).action, 'update');
});

test('timestamps merge after a whole packet and direct contact records the receiving round', () => {
  const agent = blankAgent(0, [1, 1], 3);
  const packet = { from: 1, winners: [2, 2], bids: [8, 7], timestamps: [6, 0, 4] };
  const before = copy(packet);
  processPackets(agent, [packet], 7);
  // Both task relays must see strictly newer origin-2 knowledge. Updating the
  // timestamp after task zero would incorrectly reject the second task.
  assert.deepEqual(agent.winners, [2, 2]); assert.deepEqual(agent.bids, [8, 7]);
  assert.deepEqual(agent.timestamps, [0, 7, 4]);
  assert.deepEqual(packet, before);
});

test('losing an early acquisition releases its entire suffix and preserves peer winners', () => {
  const agent = blankAgent(1, [10, 9, 8, 7]);
  buildBundle(agent, 3);
  agent.winners[1] = 0; agent.bids[1] = 11;
  const released = releaseBundle(agent);
  assert.deepEqual(released, [{ task: 1, reason: 'outbid', winner: 0 }, { task: 2, reason: 'suffix', winner: 1 }]);
  assert.deepEqual(agent.bundle, [0]); assert.deepEqual(agent.path, [0]);
  assert.deepEqual(agent.winners, [1, 0, -1, -1]);
  assert.deepEqual(agent.bids, [10, 11, 0, 0]);
  buildBundle(agent, 3);
  assert.deepEqual(agent.bundle, [0, 2, 3]);
  assert.deepEqual(agent.lastAdded, [2, 3]);
  assert.deepEqual(agent.lastReleased, released);
});

test('first-round snapshots prevent within-round relay and retain release-before-rebid evidence', () => {
  const run = createRun(), prior = copy(run.agents);
  stepRun(run);
  for (const packet of run.lastRound.packets) {
    assert.deepEqual(packet.payload.winners, prior[packet.from].winners);
    assert.deepEqual(packet.payload.bids, prior[packet.from].bids);
    assert.deepEqual(packet.payload.timestamps, prior[packet.from].timestamps);
  }
  // A3 hears A2's old claim on T1, not A1's new winning claim learned by A2.
  assert.equal(run.agents[2].winners[0], 1);
  assert.equal(run.agents[1].winners[0], 0);
  const update = run.lastRound.updates[1];
  assert.deepEqual(update.beforeBundle, [0, 3]);
  assert.deepEqual(update.afterRelease.bundle, []);
  assert.equal(update.afterRelease.winners[3], -1);
  assert.deepEqual(update.afterBundle, [3, 4]);
  assert.deepEqual(update.released.map((entry) => entry.task), [0, 3]);
  assert.deepEqual(update.added, [3, 4]);
  assert.deepEqual(run.agents.map((agent) => agent.timestamps), [[0, 1, 0], [1, 0, 1], [0, 1, 0]]);
});

test('connected allocation becomes exclusive before every planner agrees, and remains below the exact optimum', () => {
  const run = advance(createRun(), 2);
  assert.equal(run.metrics.fullAllocation, true);
  assert.equal(run.metrics.agreement, false);
  stepRun(run);
  assert.equal(run.metrics.agreement, true); assert.equal(run.metrics.firstAgreementRound, 3);
  assert.equal(run.status, 'running');
  assert.deepEqual(run.agents.map((agent) => agent.bundle), [[0, 1], [3, 2], [4, 5]]);
  assert.equal(run.metrics.score, 436);
  assert.equal(run.metrics.optimalScore, 522);
  assert.equal(run.metrics.scoreRatio, 436 / 522);
  const stable = run.agents.map((agent) => ({ bundle: agent.bundle, winners: agent.winners, bids: agent.bids }));
  runToEnd(run);
  assert.deepEqual(run.agents.map((agent) => ({ bundle: agent.bundle, winners: agent.winners, bids: agent.bids })), stable);
  assert.equal(run.round, CBBA_ROUNDS); assert.equal(run.status, 'budget');
  assert.equal(run.metrics.firstAgreementRound, 3);
});

test('permanent partition leaves conflicting assignments and has no valid global allocation score', () => {
  const run = runToEnd(createRun({ schedule: 'cut' }));
  assert.deepEqual(run.agents.map((agent) => agent.bundle), [[0, 1], [3, 4], [0, 3]]);
  assert.equal(run.metrics.agreement, false); assert.equal(run.metrics.firstAgreementRound, null);
  assert.equal(run.metrics.conflicts, 2); assert.equal(run.metrics.unassigned, 2);
  assert.equal(run.metrics.fullAllocation, false); assert.equal(run.metrics.score, null); assert.equal(run.metrics.scoreRatio, null);
  assert.deepEqual(run.agents[2].timestamps, [0, 0, 0]); assert.deepEqual(run.agents[2].lastReceived, []);
  assert.deepEqual(run.counters, { attempted: 48, delivered: 24, dropped: 24 });
});

test('recovery restores both directions exactly at round five and takes multiple rounds to reconcile', () => {
  assert.equal(RESTORE_ROUND, 5);
  const run = advance(createRun({ schedule: 'recovery' }), 4);
  assert.equal(run.metrics.conflicts, 2); assert.equal(run.metrics.agreement, false);
  const prior = copy(run.agents);
  stepRun(run);
  assert.equal(run.lastRound.packets.filter((packet) => packet.delivered).length, 4);
  assert.deepEqual(run.lastRound.packets.find((packet) => packet.from === 2).payload.winners, prior[2].winners);
  assert.equal(run.metrics.agreement, false);
  assert.equal(run.agents[2].lastReleased.length, 2);
  stepRun(run); assert.equal(run.metrics.fullAllocation, true); assert.equal(run.metrics.agreement, false);
  stepRun(run); assert.equal(run.metrics.agreement, true); assert.equal(run.metrics.firstAgreementRound, 7);
  runToEnd(run);
  assert.deepEqual(run.counters, { attempted: 48, delivered: 40, dropped: 8 });
  assert.deepEqual(run.agents.map((agent) => agent.bundle), runToEnd(createRun()).agents.map((agent) => agent.bundle));
});

test('no-sharing baseline keeps identical initial claims and sends no packets for any schedule', () => {
  for (const schedule of Object.keys(SCHEDULES)) {
    const run = createRun({ method: 'local', schedule }), initial = copy(run.agents);
    runToEnd(run);
    // lastAdded records a per-step change and empties after initialization.
    assert.deepEqual(run.agents.map(({ lastAdded, ...agent }) => agent), initial.map(({ lastAdded, ...agent }) => agent));
    assert.deepEqual(run.counters, { attempted: 0, delivered: 0, dropped: 0 });
    assert.equal(run.metrics.conflicts, 2); assert.equal(run.metrics.unassigned, 3); assert.equal(run.metrics.score, null);
    assert.equal(run.metrics.releaseCount, 0); assert.deepEqual(run.lastRound.packets, []);
  }
});

test('every boundary respects local capacity, winning claims and deterministic fixed-budget replay', () => {
  for (const method of Object.keys(METHODS)) for (const schedule of Object.keys(SCHEDULES)) {
    const run = createRun({ method, schedule });
    while (run.status === 'running') {
      for (const agent of run.agents) {
        assert.ok(agent.bundle.length <= CAPACITY);
        assert.equal(new Set(agent.bundle).size, agent.bundle.length);
        assert.deepEqual(agent.path, agent.bundle);
        for (const task of agent.bundle) { assert.equal(agent.winners[task], agent.id); assert.equal(agent.bids[task], agent.utilities[task]); }
      }
      assert.equal(stepRun(run), run);
    }
    assert.equal(run.history.length, CBBA_ROUNDS + 1);
    assert.deepEqual(run.history.map((item) => item.round), Array.from({ length: CBBA_ROUNDS + 1 }, (_, round) => round));
    assert.deepEqual(runToEnd(resetRun(run)), run);
    const final = copy(run); assert.equal(stepRun(run), run); assert.deepEqual(run, final);
  }
});

test('evaluator observations and decorative layout cannot influence local task decisions', () => {
  const actual = createRun(), changed = createRun();
  changed.evaluator.utilities = UTILITIES.map((row) => row.map((value) => value * 7));
  changed.evaluator.optimum.score *= 7;
  changed.agents.forEach((agent) => { agent.position = [1000 - agent.id, -500]; });
  changed.tasks.forEach((task) => { task.position = [-300, 4000]; });
  runToEnd(actual); runToEnd(changed);
  assert.deepEqual(changed.agents.map(({ position, ...agent }) => agent), actual.agents.map(({ position, ...agent }) => agent));
  assert.deepEqual(changed.lastRound.packets, actual.lastRound.packets);
  assert.equal(changed.metrics.score, actual.metrics.score * 7);
  assert.equal(changed.metrics.firstAgreementRound, actual.metrics.firstAgreementRound);
});

test('the exact allocation benchmark obeys per-agent capacity and detects a greedy quality gap', () => {
  assert.deepEqual(exactAllocation([[10, 9], [8, 0]], 1), { score: 17, owners: [1, 0] });
  const optimum = exactAllocation(UTILITIES, CAPACITY);
  assert.equal(optimum.score, 522);
  assert.deepEqual(optimum.owners, [1, 0, 0, 1, 2, 2]);
  for (let id = 0; id < 3; id += 1) assert.equal(optimum.owners.filter((owner) => owner === id).length, CAPACITY);
  assert.equal(optimum.owners.reduce((total, owner, task) => total + UTILITIES[owner][task], 0), optimum.score);
  assert.deepEqual(exactAllocation([[1, 2, 3]], 2), { score: null, owners: null });
  assert.deepEqual(exactAllocation([[0], [0]], 1), { score: 0, owners: [0] });
});

test('schedule accounting describes directed packets, while all presets retain identical task inputs', () => {
  for (const schedule of Object.keys(SCHEDULES)) for (let round = 1; round <= CBBA_ROUNDS; round += 1) {
    for (const [from, to] of [[0, 1], [1, 0]]) assert.equal(linkAvailable(schedule, round, from, to), true);
    for (const [from, to] of [[1, 2], [2, 1]]) assert.equal(linkAvailable(schedule, round, from, to), schedule === 'chain' || (schedule === 'recovery' && round >= RESTORE_ROUND));
    assert.equal(linkAvailable(schedule, round, 0, 2), false);
  }
  const rows = referenceComparisons();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.counters.delivered), [48, 0, 24, 40]);
  assert.deepEqual(rows.map((row) => row.releaseCount), [5, 0, 2, 5]);
  rows.forEach((row) => assert.equal(row.round, CBBA_ROUNDS));
  assert.deepEqual(evaluateRun(createRun()), createRun().metrics);
});

test('invalid public run settings and malformed exact-score matrices fail explicitly', () => {
  for (const config of [{ method: 'auction' }, { schedule: 'mesh' }, { capacity: 1 }, { capacity: 3 }, { capacity: NaN }]) assert.throws(() => createRun(config), RangeError);
  for (const [matrix, capacity] of [[[], 2], [[[1], [2, 3]], 2], [[[Infinity]], 2], [[[-1]], 2], [[[1]], 0]]) assert.throws(() => exactAllocation(matrix, capacity), RangeError);
  assert.throws(() => linkAvailable('ring', 1, 0, 1), RangeError);
  assert.throws(() => linkAvailable('chain', 0, 0, 1), RangeError);
  assert.throws(() => linkAvailable('chain', 1, -1, 1), RangeError);
});
