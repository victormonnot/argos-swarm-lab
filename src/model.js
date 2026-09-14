/** Six scalar agents, synchronous neighbor updates, undirected links. */
export const N = 6;
export const ALPHA = 1 / (2 * N);
export const BUDGET = 1000;
export const THRESHOLD = 0.01;
export const VALUE_LIMIT = 1_000_000;
export const DEFAULT_VALUES = Object.freeze([0, 2, 4, 8, 10, 12]);

const freezeEdges = (edges) => Object.freeze(edges.map((edge) => Object.freeze(edge)));
export const PRESETS = Object.freeze({
  complete: freezeEdges(Array.from({ length: N }, (_, a) =>
    Array.from({ length: N - a - 1 }, (_, offset) => [a, a + offset + 1])).flat()),
  chain: freezeEdges([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]),
  groups: freezeEdges([[0, 1], [1, 2], [3, 4], [4, 5]]),
});

function validateAgent(agent) {
  if (!Number.isInteger(agent) || agent < 0 || agent >= N) {
    throw new RangeError(`Agent index must be an integer from 0 to ${N - 1}.`);
  }
}

function canonicalPair(a, b) {
  validateAgent(a);
  validateAgent(b);
  if (a === b) throw new RangeError('An agent cannot link to itself.');
  return a < b ? [a, b] : [b, a];
}

function validateEdges(edges) {
  if (!Array.isArray(edges)) throw new TypeError('Edges must be an array of pairs.');
  const seen = new Set();
  const result = Array.from(edges, (edge) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new TypeError('Each edge must contain exactly two agent indices.');
    }
    const pair = canonicalPair(...edge);
    const key = pair.join(',');
    if (seen.has(key)) throw new RangeError('Duplicate undirected edges are not allowed.');
    seen.add(key);
    return pair;
  });
  return result.sort(([a, b], [c, d]) => a - c || b - d);
}

function validateValues(values) {
  if (!Array.isArray(values) || values.length !== N) {
    throw new TypeError(`Provide exactly ${N} initial values.`);
  }
  if (!Array.from(values).every((value) => Number.isFinite(value) && Math.abs(value) <= VALUE_LIMIT)) {
    throw new RangeError(`Initial values must be finite numbers between ${-VALUE_LIMIT} and ${VALUE_LIMIT}.`);
  }
  return [...values];
}

/** Evaluator metrics: neither is supplied to an agent's update rule. */
export function mean(values) {
  return values.reduce((total, value) => total + value / values.length, 0);
}

export function disagreement(values) {
  return Math.max(...values) - Math.min(...values);
}

function snapshot(step, values, exchanges) {
  return { step, values: [...values], mean: mean(values), disagreement: disagreement(values), exchanges };
}

export function connectedComponents(edges) {
  const neighbors = Array.from({ length: N }, () => []);
  for (const [a, b] of validateEdges(edges)) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const visited = new Set();
  const groups = [];
  for (let start = 0; start < N; start += 1) {
    if (visited.has(start)) continue;
    const group = [];
    const pending = [start];
    visited.add(start);
    while (pending.length) {
      const agent = pending.pop();
      group.push(agent);
      for (const neighbor of neighbors[agent]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    groups.push(group.sort((a, b) => a - b));
  }
  return groups;
}

export function createRun({ values = DEFAULT_VALUES, preset = 'complete', edges } = {}) {
  if (!Object.hasOwn(PRESETS, preset)) throw new RangeError(`Unknown graph preset: ${preset}`);
  const initialValues = validateValues(values);
  const initialEdges = validateEdges(edges === undefined ? PRESETS[preset] : edges);
  const currentValues = [...initialValues];
  return {
    initial: { values: initialValues, preset, edges: initialEdges },
    values: currentValues,
    edges: initialEdges.map((edge) => [...edge]),
    step: 0,
    history: [snapshot(0, currentValues, 0)],
    events: [],
    exchanges: 0,
    firstAgreementStep: disagreement(currentValues) <= THRESHOLD ? 0 : null,
    mode: 'experiment',
    replay: null,
  };
}

function editedEdges(edges, a, b, enabled) {
  const index = edges.findIndex(([x, y]) => x === a && y === b);
  if ((index !== -1) === enabled) return edges;
  return enabled
    ? [...edges, [a, b]].sort(([x, y], [z, w]) => x - z || y - w)
    : edges.filter((_, edgeIndex) => edgeIndex !== index);
}

/** Editing a link preserves state values and affects the next transition. */
export function setLink(run, first, second, enabled) {
  if (run.mode === 'replay') throw new Error('Reset to leave replay before editing links.');
  if (typeof enabled !== 'boolean') throw new TypeError('Link enabled state must be a boolean.');
  const [a, b] = canonicalPair(first, second);
  const edges = editedEdges(run.edges, a, b, enabled);
  if (edges === run.edges) return run;
  return { ...run, edges, events: [...run.events, { step: run.step, a, b, enabled }] };
}

function applyReplayBoundary(run) {
  let { edges, events } = run;
  let index = run.replay.nextEventIndex;
  while (index < run.replay.events.length && run.replay.events[index].step === run.step) {
    const event = run.replay.events[index];
    edges = editedEdges(edges, event.a, event.b, event.enabled);
    events = [...events, { ...event }];
    index += 1;
  }
  return {
    ...run,
    edges,
    events,
    replay: { ...run.replay, nextEventIndex: index, finished: run.step >= run.replay.targetStep },
  };
}

/** Pure state transition. All differences come from the same previous state. */
export function stepRun(run) {
  if (run.step >= BUDGET || run.replay?.finished) return run;
  const values = [...run.values];
  for (const [a, b] of run.edges) {
    // Each edge carries one scalar each way. Equal/opposite corrections preserve
    // the total; no global mean or other non-neighbor information is used.
    const correction = ALPHA * (run.values[b] - run.values[a]);
    values[a] += correction;
    values[b] -= correction;
  }
  const step = run.step + 1;
  const exchanges = run.exchanges + 2 * run.edges.length;
  const next = {
    ...run,
    values,
    step,
    exchanges,
    history: [...run.history, snapshot(step, values, exchanges)],
    firstAgreementStep: run.firstAgreementStep ?? (disagreement(values) <= THRESHOLD ? step : null),
  };
  return next.mode === 'replay' ? applyReplayBoundary(next) : next;
}

/** Rebuild from initial configuration, including events at the last boundary. */
export function startReplay(run) {
  const savedEvents = run.replay?.events ?? run.events;
  const targetStep = run.replay?.targetStep ?? run.step;
  return applyReplayBoundary({
    ...createRun(run.initial),
    mode: 'replay',
    replay: { targetStep, finished: false, events: savedEvents.map((event) => ({ ...event })), nextEventIndex: 0 },
  });
}

export function resetRun(run) {
  return createRun(run.initial);
}
