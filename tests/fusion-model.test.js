import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUSION_ROUNDS, SENSOR_VARIANCE, RESTORE_ROUND, METHODS, SCHEDULES,
  fuseEstimate, linkAvailable, createFusionRun, stepFusion, finishFusion,
  resetFusion, summarizeFusion, compareFusion, compareFusionSeeds,
} from '../src/fusion-model.js';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`,
);
const closeVector = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index]));
};
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}
function advance(run, round) {
  while (run.status === 'running' && run.round < round) run = stepFusion(run);
  assert.equal(run.round, round); return run;
}
function meanFromWeights(weights, readings) {
  return [0, 1].map((axis) => weights.reduce((sum, weight, index) => sum + weight * readings[index].mean[axis], 0));
}

test('independent fusion and fixed-half Covariance Intersection match unequal-precision Gaussian calculations', () => {
  const local = freezeTree({ mean: [1, 2], covariance: [0.25, 0.25], ledger: null });
  const incoming = freezeTree({ mean: [6, -3], covariance: [1, 1], ledger: null });
  const naive = fuseEstimate(local, incoming, 'naive'), ci = fuseEstimate(local, incoming, 'ci');
  closeVector(naive.estimate.mean, [2, 1]);
  closeVector(ci.estimate.mean, [2, 1]);
  closeVector(naive.estimate.covariance, [0.2, 0.2]);
  closeVector(ci.estimate.covariance, [0.4, 0.4]);
  // CI's information weight is one half, but unequal precisions give an own
  // mean coefficient of four fifths. Confusing these weights changes the mean.
  close(naive.weight, 0.8); close(ci.weight, 0.8);
  for (const method of ['naive', 'ci']) {
    closeVector(fuseEstimate(incoming, local, method).estimate.mean, [2, 1]);
    assert.deepEqual(fuseEstimate(local, null, method).estimate, local);
  }
  const unshared = fuseEstimate(local, incoming, 'local');
  assert.deepEqual(unshared.estimate, local);
  assert.notEqual(unshared.estimate.mean, local.mean);
  assert.deepEqual(local.mean, [1, 2]);
});

test('synchronous ring fusion follows the independent matrix solution and exposes double counting from round two', () => {
  let naive = createFusionRun({ method: 'naive' }), ci = createFusionRun({ method: 'ci' });
  let weights = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let round = 0; round <= FUSION_ROUNDS; round += 1) {
    const actualVariance = SENSOR_VARIANCE * (1 + 2 * 4 ** -round) / 3;
    const summaries = [summarizeFusion(naive), summarizeFusion(ci)];
    for (let id = 0; id < 3; id += 1) {
      closeVector(naive.agents[id].mean, meanFromWeights(weights[id], naive.readings));
      closeVector(ci.agents[id].mean, naive.agents[id].mean);
      closeVector(naive.lineage[id], weights[id]);
      closeVector(ci.lineage[id], weights[id]);
      closeVector(naive.agents[id].covariance, [SENSOR_VARIANCE / 2 ** round, SENSOR_VARIANCE / 2 ** round]);
      closeVector(ci.agents[id].covariance, [SENSOR_VARIANCE, SENSOR_VARIANCE]);
      summaries.forEach((summary) => close(summary.agents[id].expectedVariance, actualVariance));
      if (round < 2) close(summaries[0].agents[id].ratio, 1);
      else assert.ok(summaries[0].agents[id].ratio > 1);
      assert.ok(summaries[1].agents[id].ratio <= 1 + 1e-12);
    }
    if (round < FUSION_ROUNDS) {
      // W_next = (I + S) W / 2, using the previous full matrix. S receives
      // from the preceding agent in A1 -> A2 -> A3 -> A1 order.
      weights = weights.map((row, id) => row.map((value, origin) => (value + weights[(id + 2) % 3][origin]) / 2));
      naive = stepFusion(naive); ci = stepFusion(ci);
    }
  }
  close(summarizeFusion(naive).maxRatio, (2 ** FUSION_ROUNDS + 2 * 2 ** -FUSION_ROUNDS) / 3);
});

test('measurement ledgers propagate one hop per boundary, recover the pooled mean, and ignore repeated evidence', () => {
  const initial = createFusionRun({ method: 'ledger' });
  const first = stepFusion(freezeTree(initial)), second = stepFusion(freezeTree(first));
  assert.deepEqual(first.agents.map(({ ledger }) => ledger.map(({ id }) => id)), [
    ['z1', 'z3'], ['z1', 'z2'], ['z2', 'z3'],
  ]);
  first.agents.forEach((agent) => closeVector(agent.covariance, [0.32, 0.32]));
  first.lastRound.packets.forEach((packet) => {
    assert.deepEqual(packet.payload.ledger, initial.agents[packet.from].ledger);
    assert.equal(packet.payload.ledger.length, 1);
  });
  const pooledMean = [0, 1].map((axis) => average(initial.readings.map((reading) => reading.mean[axis])));
  second.agents.forEach((agent, id) => {
    assert.deepEqual(agent.ledger.map(({ id: source }) => source), ['z1', 'z2', 'z3']);
    closeVector(agent.mean, pooledMean);
    closeVector(agent.covariance, [SENSOR_VARIANCE / 3, SENSOR_VARIANCE / 3]);
    closeVector(second.lineage[id], [1 / 3, 1 / 3, 1 / 3]);
  });
  const third = stepFusion(second);
  assert.deepEqual(third.agents, second.agents);
  third.lastRound.updates.forEach(({ newIds, repeatedIds }) => {
    assert.deepEqual(newIds, []); assert.deepEqual(repeatedIds, ['z1', 'z2', 'z3']);
  });
  assert.deepEqual(finishFusion(third).agents, second.agents);
  const replayed = fuseEstimate(second.agents[0], second.agents[2], 'ledger');
  closeVector(replayed.estimate.mean, pooledMean);
  closeVector(replayed.estimate.covariance, second.agents[0].covariance);
});

test('the directed cut prevents return flow and restoration takes effect at round five without a same-round cascade', () => {
  assert.equal(RESTORE_ROUND, 5);
  for (const schedule of Object.keys(SCHEDULES)) for (let round = 1; round <= FUSION_ROUNDS; round += 1) {
    assert.equal(linkAvailable(schedule, round, 0), true);
    assert.equal(linkAvailable(schedule, round, 1), true);
    assert.equal(linkAvailable(schedule, round, 2), schedule === 'ring' || (schedule === 'recovery' && round >= 5));
  }
  const cut = finishFusion(createFusionRun({ method: 'ledger', schedule: 'cut' }));
  assert.deepEqual(summarizeFusion(cut).uniqueCounts, [1, 2, 3]);
  closeVector(cut.agents[0].mean, cut.readings[0].mean);
  closeVector(cut.agents[1].mean, meanFromWeights([0.5, 0.5, 0], cut.readings));
  closeVector(cut.agents[2].mean, meanFromWeights([1 / 3, 1 / 3, 1 / 3], cut.readings));
  const before = advance(createFusionRun({ method: 'ledger', schedule: 'recovery' }), 4);
  const restored = stepFusion(before), propagated = stepFusion(restored);
  assert.deepEqual(summarizeFusion(before).uniqueCounts, [1, 2, 3]);
  assert.deepEqual(summarizeFusion(restored).uniqueCounts, [3, 2, 3]);
  assert.deepEqual(summarizeFusion(propagated).uniqueCounts, [3, 3, 3]);
  assert.deepEqual(restored.lastRound.packets[0].payload.ledger, before.agents[0].ledger);
  assert.equal(restored.lastRound.packets[2].delivered, true);
  for (const method of ['ci', 'ledger']) for (const schedule of Object.keys(SCHEDULES)) {
    let run = createFusionRun({ method, schedule });
    while (run.status === 'running') {
      run = stepFusion(run);
      summarizeFusion(run).agents.forEach(({ ratio }) => {
        if (method === 'ledger') close(ratio, 1);
        else assert.ok(ratio <= 1 + 1e-12);
      });
    }
  }
});

test('transport counters distinguish packets, dropped directions and delivered logical measurement records', () => {
  const delivered = { ring: 36, cut: 24, recovery: 32 };
  const ledgerRecords = { ring: 99, cut: 35, recovery: 79 };
  for (const method of Object.keys(METHODS)) for (const schedule of Object.keys(SCHEDULES)) {
    let run = createFusionRun({ method, schedule });
    const counted = { attempted: 0, delivered: 0, dropped: 0, records: 0 };
    while (run.status === 'running') {
      const prior = run; run = stepFusion(run);
      run.lastRound.packets.forEach((packet) => {
        counted.attempted += 1;
        assert.equal(packet.to, (packet.from + 1) % 3);
        assert.deepEqual(packet.payload.mean, prior.agents[packet.from].mean);
        if (packet.delivered) {
          counted.delivered += 1;
          counted.records += method === 'ledger' ? packet.payload.ledger.length : 1;
        } else counted.dropped += 1;
      });
      assert.deepEqual(run.counters, counted);
    }
    assert.deepEqual(run.counters, method === 'local'
      ? { attempted: 0, delivered: 0, dropped: 0, records: 0 }
      : { attempted: 36, delivered: delivered[schedule], dropped: 36 - delivered[schedule], records: method === 'ledger' ? ledgerRecords[schedule] : delivered[schedule] });
  }
});

test('paired seeds share only three initial measurements; subsequent exchanges create no fresh sensor data', () => {
  for (const seed of [1, 27, 1000000]) {
    const baseline = createFusionRun({ seed });
    for (const method of Object.keys(METHODS)) for (const schedule of Object.keys(SCHEDULES)) {
      let run = createFusionRun({ method, schedule, seed });
      assert.deepEqual(run.readings, baseline.readings);
      assert.deepEqual(run.agents.map(({ mean }) => mean), baseline.agents.map(({ mean }) => mean));
      while (run.status === 'running') {
        run = stepFusion(run); assert.deepEqual(run.readings, baseline.readings);
      }
      if (method === 'local') assert.deepEqual(run.agents.map(({ mean }) => mean), baseline.agents.map(({ mean }) => mean));
    }
  }
  assert.notDeepEqual(createFusionRun({ seed: 1 }).readings, createFusionRun({ seed: 2 }).readings);
});

test('evaluator truth, source coefficients and the global sensor catalog never enter agent fusion decisions', () => {
  for (const method of Object.keys(METHODS)) {
    const run = advance(createFusionRun({ method }), 1);
    const expected = stepFusion(run);
    const changedTruth = stepFusion({ ...run, truth: [999, -999] });
    const changedLineage = stepFusion({ ...run, lineage: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] });
    const changedCatalog = stepFusion({ ...run, readings: run.readings.map((record) => ({ ...record, mean: [-999, 999] })) });
    for (const altered of [changedTruth, changedLineage, changedCatalog]) {
      assert.deepEqual(altered.agents, expected.agents);
      assert.deepEqual(altered.lastRound, expected.lastRound);
      assert.deepEqual(altered.counters, expected.counters);
    }
    assert.notEqual(summarizeFusion(changedTruth).meanSquaredError, summarizeFusion(expected).meanSquaredError);
    const update = expected.lastRound.updates[0];
    const standalone = fuseEstimate(update.prior, update.incoming, method);
    assert.deepEqual(standalone.estimate, update.posterior);
    Object.values(update).filter((value) => value && typeof value === 'object' && 'mean' in value)
      .forEach((estimate) => assert.deepEqual(Object.keys(estimate).sort(), ['covariance', 'ledger', 'mean']));
  }
});

test('frozen transitions preserve previous boundaries, reset replays exactly and the twelve-round budget is terminal', () => {
  for (const method of Object.keys(METHODS)) for (const schedule of Object.keys(SCHEDULES)) {
    const initial = freezeTree(createFusionRun({ method, schedule, seed: 9 }));
    let run = initial;
    for (let round = 1; round <= FUSION_ROUNDS; round += 1) {
      const before = structuredClone(run), next = stepFusion(freezeTree(run));
      assert.deepEqual(run, before);
      assert.notEqual(next, run);
      assert.equal(next.round, round);
      assert.equal(next.history.length, round + 1);
      assert.deepEqual(next.history.slice(0, -1), run.history);
      assert.equal(next.status, round < FUSION_ROUNDS ? 'running' : 'budget');
      run = next;
    }
    freezeTree(run);
    assert.equal(stepFusion(run), run); assert.equal(finishFusion(run), run);
    assert.deepEqual(resetFusion(run), initial);
    assert.deepEqual(finishFusion(resetFusion(run)), run);
  }
});

test('configuration and fusion reject invalid covariance, provenance and conflicting repeated measurements', () => {
  for (const field of ['method', 'schedule']) for (const value of ['', null, 'missing', 'toString', '__proto__', 1]) {
    assert.throws(() => createFusionRun({ [field]: value }), RangeError);
  }
  for (const seed of [0, -1, 1.5, '1', null, NaN, Infinity, 1000001]) assert.throws(() => createFusionRun({ seed }), RangeError);
  const estimate = { mean: [1, 2], covariance: [1, 1], ledger: null };
  for (const covariance of [[0, 0], [-1, -1], [Infinity, Infinity], [NaN, NaN], [1, 2], [1], null]) {
    assert.throws(() => fuseEstimate(estimate, { ...estimate, covariance }, 'ci'), RangeError);
  }
  for (const mean of [[NaN, 1], [1, Infinity], [1], ['1', 2], null]) {
    assert.throws(() => fuseEstimate({ ...estimate, mean }, estimate, 'naive'), RangeError);
  }
  const run = createFusionRun({ method: 'ledger' });
  const local = run.agents[0], peer = run.agents[1];
  for (const ledger of [null, [], [{ ...peer.ledger[0], id: 'z4' }], [peer.ledger[0], peer.ledger[0]]]) {
    assert.throws(() => fuseEstimate(local, { ...peer, ledger }, 'ledger'), RangeError);
  }
  for (const change of [{ mean: [999, 999] }, { covariance: [1, 1] }]) {
    const conflicting = { ...local, ledger: [{ ...local.ledger[0], ...change }] };
    assert.throws(() => fuseEstimate(local, conflicting, 'ledger'), /same measurement ID/);
  }
  assert.throws(() => fuseEstimate(estimate, estimate, 'unknown'), RangeError);
  for (const args of [['ring', 0, 0], ['ring', 1.5, 0], ['ring', 1, 3], ['missing', 1, 0]]) {
    assert.throws(() => linkAvailable(...args), RangeError);
  }
});

test('ten references and one thousand seeded trials report actual error separately from claimed and expected uncertainty', () => {
  const rows = compareFusion();
  assert.deepEqual(rows.map(({ method, schedule }) => `${method}:${schedule}`), [
    'local:ring', 'naive:ring', 'naive:cut', 'naive:recovery', 'ledger:ring',
    'ledger:cut', 'ledger:recovery', 'ci:ring', 'ci:cut', 'ci:recovery',
  ]);
  for (const row of rows) {
    assert.equal(row.round, 12);
    const initial = createFusionRun(row);
    const errors = row.agents.map(({ mean }) => Math.hypot(mean[0] - initial.truth[0], mean[1] - initial.truth[1]));
    close(row.meanSquaredError, average(errors.map((error) => error ** 2)));
    close(row.meanReportedTrace, average(row.agents.map(({ covariance }) => covariance[0] + covariance[1])));
    close(row.meanExpectedTrace, average(row.agents.map(({ coefficients }) => 2 * SENSOR_VARIANCE * coefficients.reduce((sum, value) => sum + value ** 2, 0))));
    close(row.meanNEES, average(row.agents.map(({ covariance }, id) => errors[id] ** 2 / covariance[0])));
    row.agents.forEach(({ mean, coefficients }) => closeVector(mean, meanFromWeights(coefficients, initial.readings)));
  }
  const comparison = compareFusionSeeds();
  assert.deepEqual(comparison.seeds, Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(comparison.trials.length, 1000); assert.equal(comparison.groups.length, 10);
  for (const group of comparison.groups) {
    const matching = comparison.trials.filter(({ method, schedule }) => method === group.method && schedule === group.schedule);
    assert.equal(group.count, 100);
    assert.equal(new Set(matching.map(({ seed }) => seed)).size, 100);
    for (const metric of ['meanSquaredError', 'meanReportedTrace', 'meanExpectedTrace', 'meanNEES']) {
      close(group[metric], average(matching.map((row) => row[metric])));
    }
    close(group.maxRatio, Math.max(...matching.map(({ maxRatio }) => maxRatio)));
  }
  const ringGroup = (method) => comparison.groups.find((group) => group.method === method && group.schedule === 'ring');
  close(ringGroup('naive').meanSquaredError, ringGroup('ci').meanSquaredError);
  assert.ok(ringGroup('naive').meanReportedTrace < ringGroup('naive').meanExpectedTrace / 1000);
  close(ringGroup('ledger').meanReportedTrace, ringGroup('ledger').meanExpectedTrace);
});
