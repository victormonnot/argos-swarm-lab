// Static-target estimation. Agent fusion uses received estimates only; source
// coefficients and true error covariance belong to the separate evaluator.
export const FUSION_ROUNDS = 12;
export const SENSOR_VARIANCE = 0.64;
export const TARGET = Object.freeze([6, 4]);
export const RESTORE_ROUND = 5;
export const METHODS = Object.freeze({ local: 'No sharing', naive: 'Naive independent fusion', ledger: 'Unique-measurement fusion', ci: 'Covariance Intersection · ω = ½' });
export const SCHEDULES = Object.freeze({ ring: 'Directed ring', cut: 'A3 → A1 cut', recovery: 'Restore A3 → A1 at round 5' });
export const FUSION_SEEDS = Object.freeze(Array.from({ length: 100 }, (_, index) => index + 1));
const copy = (value) => structuredClone(value);
const total = (values) => values.reduce((sum, value) => sum + value, 0);

function validateEstimate(estimate) {
  if (!estimate || !Array.isArray(estimate.mean) || estimate.mean.length !== 2 ||
      ![0, 1].every((axis) => Number.isFinite(estimate.mean[axis])) ||
      !Array.isArray(estimate.covariance) || estimate.covariance.length !== 2 ||
      ![0, 1].every((axis) => Number.isFinite(estimate.covariance[axis]) && estimate.covariance[axis] > 0) ||
      estimate.covariance[0] !== estimate.covariance[1]) {
    throw new RangeError('Expected a finite 2D mean and positive isotropic covariance.');
  }
}

function validateRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 3) throw new RangeError('Expected one to three original measurement records.');
  const seen = new Set();
  for (const record of records) {
    validateEstimate(record);
    if (!['z1', 'z2', 'z3'].includes(record.id) || seen.has(record.id)) throw new RangeError('Measurement IDs must be unique z1, z2 or z3.');
    seen.add(record.id);
  }
}

function estimateFromRecords(records) {
  const precision = total(records.map((record) => 1 / record.covariance[0]));
  const variance = 1 / precision;
  return {
    mean: [0, 1].map((axis) => total(records.map((record) => record.mean[axis] / record.covariance[0])) / precision),
    covariance: [variance, variance], ledger: copy(records),
  };
}

// This bounded API handles isotropic 2D estimates. It has no truth, lineage,
// global measurement catalog or future transport schedule argument.
export function fuseEstimate(local, incoming, method) {
  if (!Object.hasOwn(METHODS, method)) throw new RangeError('Unknown fusion method.');
  validateEstimate(local);
  if (incoming) validateEstimate(incoming);
  if (!incoming || method === 'local') return { estimate: copy(local), weight: null, newIds: [], repeatedIds: [] };
  if (method === 'ledger') {
    validateRecords(local.ledger); validateRecords(incoming.ledger);
    const records = new Map(local.ledger.map((record) => [record.id, copy(record)]));
    const newIds = [], repeatedIds = [];
    for (const record of incoming.ledger) {
      if (records.has(record.id)) {
        const prior = records.get(record.id);
        if ([0, 1].some((axis) => prior.mean[axis] !== record.mean[axis] || prior.covariance[axis] !== record.covariance[axis])) {
          throw new RangeError('The same measurement ID must retain the same content.');
        }
        repeatedIds.push(record.id);
      } else {
        records.set(record.id, copy(record)); newIds.push(record.id);
      }
    }
    return { estimate: estimateFromRecords([...records.values()].sort((a, b) => a.id.localeCompare(b.id))), weight: null, newIds, repeatedIds };
  }
  const ownPrecision = 1 / local.covariance[0], peerPrecision = 1 / incoming.covariance[0];
  const weight = ownPrecision / (ownPrecision + peerPrecision);
  // CI weights each information matrix by one half. Its mean is the same as
  // independent fusion for this pair; the reported variance is twice as large.
  const variance = (method === 'ci' ? 2 : 1) / (ownPrecision + peerPrecision);
  return {
    estimate: { mean: local.mean.map((value, axis) => weight * value + (1 - weight) * incoming.mean[axis]), covariance: [variance, variance], ledger: null },
    weight, newIds: [], repeatedIds: [],
  };
}

export function linkAvailable(schedule, round, from) {
  if (!Object.hasOwn(SCHEDULES, schedule) || !Number.isInteger(round) || round < 1 || ![0, 1, 2].includes(from)) throw new RangeError('Invalid transport boundary.');
  return from !== 2 || schedule === 'ring' || (schedule === 'recovery' && round >= RESTORE_ROUND);
}

function sampleReadings(seed) {
  // Spread sequential seed values before the LCG. Exactly six uniforms are
  // consumed at initialization: one Box–Muller pair for each original sensor.
  let state = Math.imul(seed, 2654435761) >>> 0;
  const uniform = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  return Array.from({ length: 3 }, (_, id) => {
    const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform();
    return { id: `z${id + 1}`, mean: [TARGET[0] + 0.8 * radius * Math.cos(angle), TARGET[1] + 0.8 * radius * Math.sin(angle)], covariance: [SENSOR_VARIANCE, SENSOR_VARIANCE] };
  });
}

function payload(agent) { return copy({ mean: agent.mean, covariance: agent.covariance, ledger: agent.ledger }); }

export function summarizeFusion(run) {
  const agents = run.agents.map((agent, index) => {
    const coefficients = [...run.lineage[index]];
    const expectedVariance = SENSOR_VARIANCE * total(coefficients.map((value) => value * value));
    const error = Math.hypot(agent.mean[0] - run.truth[0], agent.mean[1] - run.truth[1]);
    const reportedTrace = total(agent.covariance), expectedTrace = 2 * expectedVariance;
    return { id: agent.id, mean: [...agent.mean], covariance: [...agent.covariance], coefficients,
      uniqueCount: coefficients.filter((value) => value > 0).length, error, expectedVariance, reportedTrace, expectedTrace,
      ratio: expectedTrace / reportedTrace, nees: error * error / agent.covariance[0] };
  });
  const spread = Math.max(...agents.flatMap((a) => agents.map((b) => Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1]))));
  return { ...run.initial, round: run.round, meanSquaredError: total(agents.map((agent) => agent.error ** 2)) / 3,
    meanReportedTrace: total(agents.map((agent) => agent.reportedTrace)) / 3,
    meanExpectedTrace: total(agents.map((agent) => agent.expectedTrace)) / 3,
    meanNEES: total(agents.map((agent) => agent.nees)) / 3,
    maxRatio: Math.max(...agents.map((agent) => agent.ratio)), uniqueCounts: agents.map((agent) => agent.uniqueCount),
    spread, counters: copy(run.counters), agents };
}

function snapshot(run) {
  const { agents } = summarizeFusion(run);
  return { round: run.round, means: agents.map((agent) => agent.mean), reportedTrace: agents.map((agent) => agent.reportedTrace),
    expectedTrace: agents.map((agent) => agent.expectedTrace), errors: agents.map((agent) => agent.error),
    ratios: agents.map((agent) => agent.ratio), uniqueCounts: agents.map((agent) => agent.uniqueCount) };
}

export function createFusionRun({ method = 'naive', schedule = 'ring', seed = 1 } = {}) {
  if (!Object.hasOwn(METHODS, method) || !Object.hasOwn(SCHEDULES, schedule)) throw new RangeError('Unknown method or network schedule.');
  if (!Number.isInteger(seed) || seed < 1 || seed > 1000000) throw new RangeError('Seed must be an integer from 1 to 1000000.');
  const readings = sampleReadings(seed);
  const run = {
    initial: { method, schedule, seed }, round: 0, truth: [...TARGET], readings,
    agents: readings.map((record, id) => ({ id, mean: [...record.mean], covariance: [...record.covariance], ledger: method === 'ledger' ? [copy(record)] : null })),
    lineage: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], lastRound: null,
    counters: { attempted: 0, delivered: 0, dropped: 0, records: 0 }, history: [], status: 'running',
  };
  run.history.push(snapshot(run)); return run;
}

export function stepFusion(run) {
  if (run.status !== 'running') return run;
  const next = copy(run), round = run.round + 1, { method, schedule } = run.initial;
  // All packets are built from the previous boundary before any agent updates.
  const packets = method === 'local' ? [] : run.agents.map((agent) => ({ from: agent.id, to: (agent.id + 1) % 3, delivered: linkAvailable(schedule, round, agent.id), payload: payload(agent) }));
  const updates = [];
  for (let id = 0; id < 3; id++) {
    const received = packets.find((packet) => packet.to === id && packet.delivered);
    const prior = payload(run.agents[id]), incoming = received ? copy(received.payload) : null;
    const fused = fuseEstimate(prior, incoming, method);
    next.agents[id] = { id, ...fused.estimate };
    if (incoming && method === 'ledger') {
      const precision = total(fused.estimate.ledger.map((record) => 1 / record.covariance[0]));
      next.lineage[id] = run.readings.map((record) => fused.estimate.ledger.some((entry) => entry.id === record.id) ? (1 / record.covariance[0]) / precision : 0);
    } else if (incoming && fused.weight !== null) {
      next.lineage[id] = run.lineage[id].map((value, origin) => fused.weight * value + (1 - fused.weight) * run.lineage[received.from][origin]);
    }
    updates.push({ agent: id, prior, incoming, posterior: payload(next.agents[id]), weight: fused.weight, newIds: fused.newIds, repeatedIds: fused.repeatedIds });
  }
  next.round = round; next.lastRound = { round, packets, updates };
  next.counters.attempted += packets.length;
  next.counters.delivered += packets.filter((packet) => packet.delivered).length;
  next.counters.dropped += packets.filter((packet) => !packet.delivered).length;
  // Logical records delivered, not bytes, serialization overhead or radio cost.
  next.counters.records += total(packets.filter((packet) => packet.delivered).map((packet) => method === 'ledger' ? packet.payload.ledger.length : 1));
  next.status = round >= FUSION_ROUNDS ? 'budget' : 'running';
  next.history.push(snapshot(next)); return next;
}

export function resetFusion(run) { return createFusionRun(run.initial); }
export function finishFusion(run) { while (run.status === 'running') run = stepFusion(run); return run; }
export function compareFusion(seed = 1) {
  return Object.keys(METHODS).flatMap((method) => (method === 'local' ? ['ring'] : Object.keys(SCHEDULES)).map((schedule) => summarizeFusion(finishFusion(createFusionRun({ method, schedule, seed })))));
}
export function compareFusionSeeds() {
  const trials = FUSION_SEEDS.flatMap((seed) => compareFusion(seed));
  const groups = compareFusion().map(({ method, schedule }) => {
    const rows = trials.filter((row) => row.method === method && row.schedule === schedule);
    const mean = (key) => total(rows.map((row) => row[key])) / rows.length;
    return { method, schedule, count: rows.length, meanSquaredError: mean('meanSquaredError'), meanReportedTrace: mean('meanReportedTrace'), meanExpectedTrace: mean('meanExpectedTrace'), meanNEES: mean('meanNEES'), maxRatio: Math.max(...rows.map((row) => row.maxRatio)) };
  });
  return { seeds: [...FUSION_SEEDS], groups, trials };
}
