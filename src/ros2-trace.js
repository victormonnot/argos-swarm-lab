import { ALPHA, N, PRESETS, THRESHOLD, VALUE_LIMIT, createRun, stepRun, mean, disagreement } from './model.js';

// This module inspects recorded observations. It never simulates ROS transport.
const check = (condition, message) => { if (!condition) throw new Error(`Invalid ROS 2 trace: ${message}`); };
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const scalar = value => Number.isFinite(value) && Math.abs(value) <= VALUE_LIMIT;
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => integer(value, N - 1);
const values = data => Array.isArray(data) && data.length === N && data.every(scalar);

function uniqueEntries(entries, max, key, description) {
  check(Array.isArray(entries) && entries.length <= max, description);
  const result = new Map();
  for (const entry of entries) {
    check(entry && typeof entry === 'object', description);
    const entryKey = key(entry);
    check(!result.has(entryKey), `duplicate ${description}`);
    result.set(entryKey, entry);
  }
  return result;
}

/** Bounded import contract; consistency is not proof of a file's provenance. */
export function validateTrace(trace) {
  check(trace && trace.schemaVersion === 1 && trace.kind === 'argos-ros2-consensus', 'unsupported format');
  const runtime = trace.runtime;
  check(runtime && ['rosDistro', 'rmw', 'python', 'image', 'recordedAt'].every(key => text(runtime[key], 500)), 'runtime metadata');
  check(/^[a-f0-9]{64}$/.test(runtime.sourceSha256), 'runtime source hash');
  check(Number.isFinite(Date.parse(runtime.recordedAt)), 'recording date');
  check(Array.isArray(trace.cases) && trace.cases.length > 0 && trace.cases.length <= 10, '1–10 cases required');
  const caseIds = new Set(), runIds = new Set();
  for (const recording of trace.cases) {
    check(recording && text(recording.id, 80) && text(recording.label), 'case identity');
    check(!caseIds.has(recording.id), 'duplicate case ID'); caseIds.add(recording.id);
    check(text(recording.runId, 100) && !runIds.has(recording.runId), 'unique run ID required'); runIds.add(recording.runId);
    check(['complete', 'chain'].includes(recording.topology), 'unsupported topology');
    check(recording.alpha === ALPHA && values(recording.initialValues), 'gain or initial values');
    check(integer(recording.plannedRounds, 1000) && recording.plannedRounds > 0, 'round budget');
    const expectedNeighbors = Array.from({ length: N }, () => []);
    for (const [a, b] of PRESETS[recording.topology]) { expectedNeighbors[a].push(b); expectedNeighbors[b].push(a); }
    check(Array.isArray(recording.agents) && recording.agents.length === N, 'six agent processes required');
    const pids = new Set(), names = new Set();
    recording.agents.forEach((agent, index) => {
      check(agent && agent.id === index && text(agent.node, 200), 'ordered agent IDs and node names');
      check(Number.isSafeInteger(agent.pid) && agent.pid > 0 && !pids.has(agent.pid), 'distinct agent process IDs');
      check(!names.has(agent.node), 'distinct node names');
      pids.add(agent.pid); names.add(agent.node);
      check(Array.isArray(agent.neighbors) && equal([...agent.neighbors].sort((a, b) => a - b), expectedNeighbors[index]), 'neighbors must match topology');
    });
    check(Array.isArray(recording.states) && recording.states.length >= 1 && recording.states.length <= recording.plannedRounds + 1, 'bounded states');
    recording.states.forEach((state, index) => check(state && state.round === index && values(state.values), 'contiguous finite states'));
    check(equal(recording.states[0].values, recording.initialValues), 'initial state');
    check(Array.isArray(recording.rounds) && recording.rounds.length <= recording.plannedRounds, 'bounded exchanges');
    let completed = 0, timedOut = false;
    for (const [index, round] of recording.rounds.entries()) {
      check(round && round.round === index && !timedOut && recording.states[index], 'contiguous exchange rounds');
      check(['complete', 'timeout'].includes(round.status), 'round outcome');
      const state = recording.states[index].values;
      const envelope = entry => entry.runId === recording.runId && entry.round === index;
      const publications = uniqueEntries(round.published, N, entry => entry.agent, 'publications');
      for (const entry of publications.values()) check(envelope(entry) && id(entry.agent) && scalar(entry.value) && entry.value === state[entry.agent], 'publication must use its current run, round and state');
      const receipts = uniqueEntries(round.received, N * (N - 1), entry => `${entry.agent}:${entry.from}`, 'receipts');
      for (const entry of receipts.values()) {
        check(envelope(entry) && id(entry.agent) && id(entry.from) && expectedNeighbors[entry.agent].includes(entry.from), 'receipt must come from a subscribed neighbor in this run and round');
        check(scalar(entry.value) && publications.has(entry.from) && entry.value === publications.get(entry.from).value, 'receipt must match a publication in this round');
      }
      const updates = uniqueEntries(round.updates, N, entry => entry.agent, 'updates');
      for (const entry of updates.values()) {
        check(envelope(entry) && id(entry.agent) && scalar(entry.value), 'finite agent update in this run and round');
        const inputs = uniqueEntries(entry.inputs, N - 1, input => input.from, 'update inputs');
        check(inputs.size === expectedNeighbors[entry.agent].length, 'update needs every neighbor');
        for (const neighbor of expectedNeighbors[entry.agent]) {
          const receipt = receipts.get(`${entry.agent}:${neighbor}`), input = inputs.get(neighbor);
          check(receipt && input && scalar(input.value) && input.value === receipt.value, 'update must use received current-round inputs');
        }
      }
      const missing = uniqueEntries(round.missing, N * (N - 1), entry => `${entry.agent}:${entry.from}`, 'missing inputs');
      for (let agent = 0; agent < N; agent++) {
        for (const from of expectedNeighbors[agent]) {
          const key = `${agent}:${from}`;
          check(missing.has(key) === !receipts.has(key), 'missing-input list must match observed receipts');
        }
      }
      for (const entry of missing.values()) check(id(entry.agent) && expectedNeighbors[entry.agent].includes(entry.from), 'missing neighbor identity');
      if (round.status === 'complete') {
        check(updates.size === N && missing.size === 0 && publications.size === N, 'a complete barrier requires six updates');
        const next = recording.states[index + 1];
        check(next && next.values.every((value, agent) => value === updates.get(agent).value), 'completed state must match all updates');
        completed++;
      } else {
        check(updates.size < N && index === recording.rounds.length - 1, 'timeout must leave an incomplete final barrier');
        timedOut = true;
      }
    }
    check(recording.states.length === completed + 1, 'only completed rounds produce global states');
    const outcome = recording.outcome;
    check(outcome && outcome.completedRounds === completed && text(outcome.reason, 1000), 'outcome summary');
    check(outcome.status === (timedOut ? 'timeout' : 'completed'), 'outcome must match observations');
    check(timedOut || completed === recording.plannedRounds, 'completed run must reach its budget');
    if (recording.omittedPublication !== undefined) {
      const omission = recording.omittedPublication;
      check(omission && id(omission.agent) && integer(omission.round, recording.plannedRounds - 1), 'omission schedule');
      const omittedRound = recording.rounds[omission.round];
      check(omittedRound && !omittedRound.published.some(entry => entry.agent === omission.agent), 'scheduled publication must be absent');
    }
  }
  return trace;
}

export function traceMetrics(data) {
  return { mean: mean(data), disagreement: disagreement(data) };
}

/** Views share one selected recorded boundary; an incomplete barrier stays separate. */
export function traceFrame(recording, index) {
  if (!integer(index, recording.states.length - 1)) throw new RangeError('Recorded round is out of range.');
  return {
    round: index, values: [...recording.states[index].values], exchange: recording.rounds[index] ?? null,
    agents: recording.agents, edges: PRESETS[recording.topology].map(edge => [...edge]),
    initialValues: [...recording.initialValues], completedRounds: recording.outcome.completedRounds,
  };
}

/** Numerical evaluator only: replay workshop 1 independently of recorded transport. */
export function compareTrace(recording) {
  let reference = createRun({ values: recording.initialValues, preset: recording.topology });
  let maxError = 0;
  let firstAgreementRound = null;
  for (const state of recording.states) {
    if (state.round > 0) reference = stepRun(reference);
    state.values.forEach((value, agent) => { maxError = Math.max(maxError, Math.abs(value - reference.values[agent])); });
    if (firstAgreementRound === null && disagreement(state.values) <= THRESHOLD) firstAgreementRound = state.round;
  }
  return { matches: maxError <= 1e-10, maxError, comparedStates: recording.states.length, firstAgreementRound };
}
