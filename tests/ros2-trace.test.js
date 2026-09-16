import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ALPHA, N, PRESETS, THRESHOLD, VALUE_LIMIT, createRun, stepRun } from '../src/model.js';
import { compareTrace, traceFrame, traceMetrics, validateTrace } from '../src/ros2-trace.js';

// These checks inspect the saved six-process experiment, not a fabricated ROS fixture.
const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-consensus.json', import.meta.url), 'utf8'));
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const nominal = data => data.cases.find(recording => recording.topology === 'complete' && recording.outcome.status === 'completed');
const chain = data => data.cases.find(recording => recording.topology === 'chain' && recording.outcome.status === 'completed');
const failure = data => data.cases.find(recording => recording.outcome.status === 'timeout');
const copy = () => structuredClone(trace);
const sorted = entries => [...entries].sort((a, b) => a - b);

test('saved ROS recording validates without alteration and identifies six distinct processes per case', () => {
  const before = copy();
  assert.equal(validateTrace(trace), trace);
  assert.deepEqual(trace, before);
  assert.ok(nominal(trace) && chain(trace) && failure(trace), 'nominal complete/chain and intentional timeout cases are recorded');
  assert.match(trace.runtime.sourceSha256, /^[a-f0-9]{64}$/);
  for (const recording of trace.cases) {
    assert.equal(new Set(recording.agents.map(agent => agent.pid)).size, N);
    assert.equal(new Set(recording.agents.map(agent => agent.node)).size, N);
    assert.deepEqual(recording.agents.map(agent => agent.id), [0, 1, 2, 3, 4, 5]);
    for (const agent of recording.agents) {
      const expected = PRESETS[recording.topology].filter(edge => edge.includes(agent.id)).map(([a, b]) => a === agent.id ? b : a);
      assert.deepEqual(sorted(agent.neighbors), sorted(expected));
    }
  }
});

test('every completed recorded vector agrees with the workshop-1 model, including the first threshold crossing', () => {
  for (const recording of trace.cases) {
    let reference = createRun({ values: recording.initialValues, preset: recording.topology });
    let firstAgreementRound = null;
    let maxError = 0;
    for (const state of recording.states) {
      if (state.round > 0) reference = stepRun(reference);
      assert.equal(state.round, reference.step);
      for (let agent = 0; agent < N; agent++) {
        close(state.values[agent], reference.values[agent]);
        maxError = Math.max(maxError, Math.abs(state.values[agent] - reference.values[agent]));
      }
      const range = Math.max(...state.values) - Math.min(...state.values);
      if (firstAgreementRound === null && range <= THRESHOLD) firstAgreementRound = state.round;
    }
    const result = compareTrace(recording);
    assert.equal(result.matches, true);
    assert.equal(result.comparedStates, recording.states.length);
    assert.equal(result.maxError, maxError);
    assert.equal(result.firstAgreementRound, firstAgreementRound);
  }
  assert.equal(compareTrace(nominal(trace)).firstAgreementRound, 11);
});

test('publications, subscription masks and local updates retain the actual current-round neighbor inputs', () => {
  for (const recording of trace.cases) {
    for (const round of recording.rounds) {
      const state = recording.states[round.round].values;
      for (const entry of [...round.published, ...round.received, ...round.updates]) {
        assert.equal(entry.runId, recording.runId);
        assert.equal(entry.round, round.round);
      }
      for (const publication of round.published) assert.equal(publication.value, state[publication.agent]);
      for (const receipt of round.received) {
        assert.ok(recording.agents[receipt.agent].neighbors.includes(receipt.from));
        const source = round.published.find(entry => entry.agent === receipt.from);
        assert.ok(source);
        assert.equal(receipt.value, source.value);
      }
      for (const agent of recording.agents) {
        const receipts = round.received.filter(entry => entry.agent === agent.id);
        const missing = round.missing.filter(entry => entry.agent === agent.id).map(entry => entry.from);
        assert.equal(new Set(receipts.map(entry => entry.from)).size, receipts.length);
        assert.deepEqual(sorted([...receipts.map(entry => entry.from), ...missing]), sorted(agent.neighbors));
        if (round.status === 'complete') assert.deepEqual(sorted(receipts.map(entry => entry.from)), sorted(agent.neighbors));
      }
      for (const update of round.updates) {
        assert.deepEqual(sorted(update.inputs.map(input => input.from)), sorted(recording.agents[update.agent].neighbors));
        for (const input of update.inputs) {
          const receipt = round.received.find(entry => entry.agent === update.agent && entry.from === input.from);
          assert.ok(receipt);
          assert.equal(input.value, receipt.value);
        }
        const expected = state[update.agent] + ALPHA * update.inputs.reduce((sum, input) => sum + input.value - state[update.agent], 0);
        close(update.value, expected);
        if (round.status === 'complete') assert.equal(recording.states[round.round + 1].values[update.agent], update.value);
      }
    }
  }
});

test('a missing publication leaves neighbor waits and partial updates without inventing a completed global round', () => {
  const recording = failure(trace), omission = recording.omittedPublication;
  assert.ok(omission);
  const round = recording.rounds.at(-1);
  assert.equal(round.round, omission.round);
  assert.equal(round.status, 'timeout');
  assert.ok(!round.published.some(entry => entry.agent === omission.agent));
  assert.ok(!round.received.some(entry => entry.from === omission.agent));
  const waiting = recording.agents.filter(agent => agent.neighbors.includes(omission.agent)).map(agent => agent.id);
  assert.ok(waiting.length > 0);
  for (const agent of waiting) {
    assert.ok(round.missing.some(entry => entry.agent === agent && entry.from === omission.agent));
    assert.ok(!round.updates.some(entry => entry.agent === agent));
  }
  assert.ok(round.updates.length > 0 && round.updates.length < N, 'unblocked processes can update, but do not form a global boundary');
  assert.equal(recording.outcome.completedRounds, omission.round);
  assert.equal(recording.states.length, omission.round + 1);
  assert.equal(recording.states.at(-1).round, omission.round);
  assert.ok(!recording.states.some(state => state.round > omission.round));
  const frame = traceFrame(recording, omission.round);
  assert.equal(frame.exchange.status, 'timeout');
  assert.deepEqual(frame.values, recording.states.at(-1).values);
  assert.throws(() => traceFrame(recording, omission.round + 1), RangeError);
});

test('recorded frames copy display state and bounds; metrics are evaluator summaries only', () => {
  const recording = nominal(trace), before = structuredClone(recording);
  for (const index of [0, 1, recording.states.length - 1]) {
    const frame = traceFrame(recording, index);
    assert.equal(frame.round, index);
    assert.deepEqual(frame.values, recording.states[index].values);
    assert.equal(frame.exchange, recording.rounds[index] ?? null);
    assert.deepEqual(frame.edges, PRESETS[recording.topology]);
    assert.deepEqual(frame.initialValues, recording.initialValues);
    assert.equal(frame.completedRounds, recording.outcome.completedRounds);
    frame.values[0] = 100;
    frame.initialValues[0] = 100;
    frame.edges[0][0] = 5;
  }
  assert.deepEqual(recording, before);
  for (const index of [-1, 0.5, NaN, Infinity, '0', recording.states.length]) assert.throws(() => traceFrame(recording, index), RangeError);
  assert.deepEqual(traceMetrics([0, 2, 4, 8, 10, 12]), { mean: 6, disagreement: 12 });
  const extremes = traceMetrics([-VALUE_LIMIT, VALUE_LIMIT, 0, VALUE_LIMIT, -VALUE_LIMIT, 0]);
  assert.equal(extremes.mean, 0);
  assert.equal(extremes.disagreement, 2 * VALUE_LIMIT);
});

test('structurally coherent numerical disagreement is accepted as evidence and flagged by independent comparison', () => {
  const data = copy(), recording = nominal(data), final = recording.states.at(-1);
  const update = recording.rounds.at(-1).updates.find(entry => entry.agent === 0);
  final.values[0] += 0.125;
  update.value = final.values[0];
  assert.equal(validateTrace(data), data);
  const result = compareTrace(recording);
  assert.equal(result.matches, false);
  close(result.maxError, 0.125);
  assert.equal(result.comparedStates, recording.states.length);
});

const invalidChanges = [
  ['unsupported schema', data => { data.schemaVersion = 2; }],
  ['missing runtime', data => { delete data.runtime; }],
  ['missing case', data => { data.cases = []; }],
  ['duplicate case IDs', data => { data.cases[1].id = data.cases[0].id; }],
  ['duplicate run IDs', data => { data.cases[1].runId = data.cases[0].runId; }],
  ['unsupported topology', data => { nominal(data).topology = '__proto__'; }],
  ['wrong gain', data => { nominal(data).alpha = 0.5; }],
  ['nonfinite state', data => { nominal(data).states[1].values[0] = NaN; }],
  ['state value overflow', data => { nominal(data).states[1].values[0] = VALUE_LIMIT + 1; }],
  ['initial value overflow', data => { nominal(data).initialValues[0] = Number.MAX_VALUE; }],
  ['unsafe PID', data => { nominal(data).agents[0].pid = Number.MAX_SAFE_INTEGER + 1; }],
  ['duplicate PID', data => { nominal(data).agents[0].pid = nominal(data).agents[1].pid; }],
  ['missing agent', data => { nominal(data).agents.pop(); }],
  ['unordered agent IDs', data => { nominal(data).agents.reverse(); }],
  ['wrong subscription mask', data => { chain(data).agents[0].neighbors.push(5); }],
  ['round budget overflow', data => { nominal(data).plannedRounds = 1001; }],
  ['noncontiguous state', data => { nominal(data).states[1].round = 2; }],
  ['missing completed state', data => { nominal(data).states.pop(); }],
  ['state disagrees with update', data => { nominal(data).states.at(-1).values[0] += 1; }],
  ['wrong publication state', data => { nominal(data).rounds[0].published[0].value += 1; }],
  ['missing publication', data => { nominal(data).rounds[0].published.pop(); }],
  ['duplicate publication', data => { const round = nominal(data).rounds[0]; round.published.push({ ...round.published[0] }); }],
  ['stale publication envelope', data => { nominal(data).rounds[1].published[0].round = 0; }],
  ['wrong-run receipt', data => { nominal(data).rounds[0].received[0].runId = 'another-run'; }],
  ['stale receipt envelope', data => { nominal(data).rounds[1].received[0].round = 0; }],
  ['stale receipt value', data => { const c = nominal(data), receipt = c.rounds[1].received.find(entry => c.states[0].values[entry.from] !== entry.value); receipt.value = c.states[0].values[receipt.from]; }],
  ['duplicate receipt', data => { const round = nominal(data).rounds[0]; round.received.push({ ...round.received[0] }); }],
  ['nonneighbor receipt', data => { const round = chain(data).rounds[0]; round.received.push({ agent: 0, from: 5, value: 12, runId: chain(data).runId, round: 0 }); }],
  ['wrong sender', data => { nominal(data).rounds[0].received[0].from = 6; }],
  ['missing receipt', data => { nominal(data).rounds[0].received.pop(); }],
  ['NaN receipt', data => { nominal(data).rounds[0].received[0].value = NaN; }],
  ['missing update', data => { nominal(data).rounds[0].updates.pop(); }],
  ['stale update envelope', data => { nominal(data).rounds[1].updates[0].round = 0; }],
  ['duplicate update input', data => { const update = nominal(data).rounds[0].updates[0]; update.inputs[1] = { ...update.inputs[0] }; }],
  ['missing update input', data => { nominal(data).rounds[0].updates[0].inputs.pop(); }],
  ['update uses an unreceived value', data => { nominal(data).rounds[0].updates[0].inputs[0].value += 1; }],
  ['incorrect missing-input list', data => { failure(data).rounds.at(-1).missing.pop(); }],
  ['fabricated timeout state', data => { const c = failure(data); c.states.push({ round: c.states.length, values: [...c.states.at(-1).values] }); }],
  ['timeout reported as success', data => { failure(data).outcome.status = 'completed'; }],
  ['incorrect completed-round count', data => { nominal(data).outcome.completedRounds -= 1; }],
  ['omission schedule disagrees with observations', data => { failure(data).omittedPublication.round = 0; }],
];

for (const [name, change] of invalidChanges) {
  test(`import rejects ${name}`, () => {
    const data = copy();
    change(data);
    assert.throws(() => validateTrace(data), /Invalid ROS 2 trace:/);
  });
}
