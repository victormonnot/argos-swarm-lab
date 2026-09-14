import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALPHA, BUDGET, DEFAULT_VALUES, N, PRESETS, THRESHOLD, VALUE_LIMIT,
  connectedComponents, createRun, disagreement, mean, resetRun, setLink, startReplay, stepRun,
} from '../src/model.js';
import { compareScenarios } from '../src/comparisons.js';

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function advance(run, count) {
  for (let index = 0; index < count; index += 1) run = stepRun(run);
  return run;
}

test('first chain step uses only previous local neighbor values, simultaneously', () => {
  const original = createRun({ preset: 'chain' });
  const untouched = structuredClone(original);
  const next = stepRun(original);
  [1 / 6, 2, 4 + 1 / 6, 8 - 1 / 6, 10, 12 - 1 / 6].forEach((value, index) => close(next.values[index], value));
  assert.deepEqual(original, untouched);
  assert.equal(next.step, 1);
  assert.equal(next.exchanges, 10);
  assert.equal(ALPHA, 1 / (2 * N));
});

test('all 32 chain subgraphs preserve mean, convex bounds and nonincreasing range', () => {
  const values = [-39, 12, 8, 73, -6, 4];
  for (let mask = 0; mask < 32; mask += 1) {
    const edges = PRESETS.chain.filter((_, index) => mask & (1 << index));
    let run = createRun({ values, edges });
    for (let step = 0; step < 60; step += 1) {
      const before = run;
      run = stepRun(run);
      close(mean(run.values), mean(values));
      assert.ok(disagreement(run.values) <= disagreement(before.values) + 1e-12);
      for (let agent = 0; agent < N; agent += 1) {
        const neighborhood = [agent, ...edges.filter((edge) => edge.includes(agent)).map(([a, b]) => a === agent ? b : a)];
        const local = neighborhood.map((index) => before.values[index]);
        assert.ok(run.values[agent] >= Math.min(...local) - 1e-12);
        assert.ok(run.values[agent] <= Math.max(...local) + 1e-12);
      }
    }
  }
});

test('connected presets converge to initial mean; complete graph halves disagreement per step', () => {
  for (const preset of ['complete', 'chain']) {
    const run = advance(createRun({ preset }), BUDGET);
    assert.ok(run.firstAgreementStep !== null);
    assert.ok(run.history[run.firstAgreementStep].disagreement <= THRESHOLD);
    assert.ok(run.history[run.firstAgreementStep - 1].disagreement > THRESHOLD);
    for (const value of run.values) close(value, 6, 1e-8);
  }
  const complete = advance(createRun(), 12);
  for (const point of complete.history) close(point.disagreement, 12 * 0.5 ** point.step);
  assert.equal(complete.firstAgreementStep, 11);
});

test('two groups retain their component means and fail global agreement', () => {
  const run = advance(createRun({ preset: 'groups' }), BUDGET);
  assert.deepEqual(connectedComponents(run.edges), [[0, 1, 2], [3, 4, 5]]);
  run.values.slice(0, 3).forEach((value) => close(value, 2));
  run.values.slice(3).forEach((value) => close(value, 10));
  close(disagreement(run.values), 8);
  assert.equal(run.firstAgreementStep, null);
  assert.equal(run.exchanges, 8000);
});

test('isolated agents retain their values; equal input is already in agreement', () => {
  const isolated = advance(createRun({ edges: [[0, 1], [1, 2]] }), 80);
  assert.deepEqual(isolated.values.slice(3), DEFAULT_VALUES.slice(3));
  const empty = advance(createRun({ edges: [] }), 20);
  assert.deepEqual(empty.values, DEFAULT_VALUES);
  assert.equal(empty.exchanges, 0);
  assert.deepEqual(connectedComponents([]), [[0], [1], [2], [3], [4], [5]]);
  const equal = advance(createRun({ values: Array(N).fill(7.25) }), 20);
  assert.deepEqual(equal.values, Array(N).fill(7.25));
  assert.equal(equal.firstAgreementStep, 0);
});

test('translation shifts each value without measuring external correctness', () => {
  for (const preset of Object.keys(PRESETS)) {
    const baseline = advance(createRun({ preset }), 350);
    const shifted = advance(createRun({ preset, values: DEFAULT_VALUES.map((value) => value + 100) }), 350);
    assert.equal(shifted.firstAgreementStep, baseline.firstAgreementStep);
    baseline.history.forEach((point, index) => {
      close(shifted.history[index].disagreement, point.disagreement);
      shifted.history[index].values.forEach((value, agent) => close(value, point.values[agent] + 100));
    });
  }
});

test('edits preserve values, exchange counts reflect each transition, reconnecting recovers', () => {
  let run = createRun({ preset: 'chain' });
  const original = structuredClone(run);
  run = setLink(run, 3, 2, false);
  assert.deepEqual(run.values, original.values);
  assert.deepEqual(run.history, original.history);
  assert.deepEqual(run.events, [{ step: 0, a: 2, b: 3, enabled: false }]);
  assert.deepEqual(original.edges, PRESETS.chain);
  run = advance(run, 100);
  assert.equal(run.exchanges, 800);
  assert.ok(disagreement(run.values) >= 8);
  run = setLink(run, 2, 3, true);
  run = advance(run, 900);
  assert.equal(run.exchanges, 9800);
  assert.ok(run.firstAgreementStep > 100);
  assert.ok(disagreement(run.values) <= THRESHOLD);
  close(mean(run.values), 6);
});

test('replay reproduces numerical trace, exchange counts, ordered events and terminal graph', () => {
  let run = createRun({ preset: 'chain' });
  run = setLink(run, 2, 3, false);
  run = setLink(run, 0, 5, true);
  run = setLink(run, 0, 5, false);
  run = advance(run, 8);
  run = setLink(run, 2, 3, true);
  run = setLink(run, 0, 1, false);
  run = advance(run, 12);
  run = setLink(run, 0, 1, true);
  run = setLink(run, 4, 5, false);
  const untouched = structuredClone(run);
  let replay = startReplay(run);
  assert.equal(replay.step, 0);
  assert.equal(replay.replay.targetStep, 20);
  assert.equal(replay.events.length, 3);
  assert.throws(() => setLink(replay, 0, 1, false), /replay/);
  while (!replay.replay.finished) replay = stepRun(replay);
  assert.deepEqual(replay.history, run.history);
  assert.deepEqual(replay.events, run.events);
  assert.deepEqual(replay.edges, run.edges);
  assert.deepEqual(replay.values, run.values);
  assert.equal(replay.exchanges, run.exchanges);
  assert.equal(replay.firstAgreementStep, run.firstAgreementStep);
  assert.equal(stepRun(replay), replay);
  assert.deepEqual(run, untouched);
  const restarted = startReplay(replay);
  assert.equal(restarted.replay.events.length, run.events.length);
  assert.deepEqual(resetRun(replay), createRun({ preset: 'chain' }));
  assert.deepEqual(resetRun(run), createRun({ preset: 'chain' }));
});

test('zero-step replay applies terminal edits and finishes without an extra update', () => {
  const run = setLink(createRun(), 0, 5, false);
  const replay = startReplay(run);
  assert.equal(replay.replay.finished, true);
  assert.deepEqual(replay.edges, run.edges);
  assert.deepEqual(replay.events, run.events);
  assert.deepEqual(replay.history, run.history);
  assert.equal(stepRun(replay).step, 0);
});

test('reset restores custom configured graph and values, and clears event history', () => {
  const initial = createRun({ values: [10, 11, 12, 13, 14, 15], edges: [[3, 2]] });
  const run = setLink(advance(initial, 5), 0, 1, true);
  assert.deepEqual(resetRun(run), initial);
  assert.equal(setLink(initial, 2, 3, true), initial);
  assert.equal(setLink(initial, 0, 1, false), initial);
});

test('invalid inputs fail explicitly and allowed extreme values stay finite', () => {
  for (const values of [[], [1, 2], Array(N), [1, 2, 3, 4, 5, NaN], [1, 2, 3, 4, 5, Infinity], [1, 2, 3, 4, 5, '6'], [1, 2, 3, 4, 5, VALUE_LIMIT + 1]]) {
    assert.throws(() => createRun({ values }));
  }
  for (const edges of [null, Array(1), [[0, 0]], [[0, 6]], [[0, 1], [1, 0]], [[0, 1, 2]], [[0, 1.5]], 'chain']) {
    assert.throws(() => createRun({ edges }));
  }
  assert.throws(() => createRun({ preset: 'missing' }));
  assert.throws(() => createRun({ preset: '__proto__' }));
  assert.throws(() => setLink(createRun(), 0, 6, true));
  assert.throws(() => setLink(createRun(), 1, 1, false));
  assert.throws(() => setLink(createRun(), 1, 2, 'yes'));
  const extremes = advance(createRun({ values: [-VALUE_LIMIT, VALUE_LIMIT, 0, VALUE_LIMIT, -VALUE_LIMIT, 0] }), 50);
  assert.ok(extremes.values.every(Number.isFinite));
  close(mean(extremes.values), 0);
});

test('budget is exact and comparisons report both successful and unsuccessful outcomes', () => {
  const run = advance(createRun(), BUDGET + 2);
  assert.equal(run.step, BUDGET);
  assert.equal(run.history.length, BUDGET + 1);
  assert.equal(stepRun(run), run);
  const results = compareScenarios();
  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.finalStep === BUDGET));
  const result = Object.fromEntries(results.map((row) => [row.id, row]));
  assert.equal(result.complete.firstAgreementStep, 11);
  assert.equal(result.complete.exchangesToAgreement, 330);
  assert.ok(result.chain.firstAgreementStep > result.complete.firstAgreementStep);
  assert.equal(result.groups.firstAgreementStep, null);
  assert.equal(result.groups.exchangesToAgreement, null);
  close(result.groups.finalDisagreement, 8);
  assert.ok(result.recovery.firstAgreementStep > result.chain.firstAgreementStep);
  assert.equal(result.recovery.totalExchanges, 9800);
  assert.equal(result.shifted.firstAgreementStep, result.complete.firstAgreementStep);
  close(result.shifted.initialMean - result.complete.initialMean, 100);
});
