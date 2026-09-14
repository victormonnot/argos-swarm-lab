// Consensus-Based Bundle Algorithm, with static positive additive task scores.
// Consensus follows Table 1 of Choi, Brunet and How (2009), DOI
// 10.1109/TRO.2009.2022423. Layout coordinates never enter the bids.
export const CBBA_ROUNDS = 12;
export const RESTORE_ROUND = 5;
export const CAPACITY = 2;
export const METHODS = Object.freeze({ cbba: 'CBBA · static additive scores', local: 'Local greedy · no sharing' });
export const SCHEDULES = Object.freeze({ chain: 'Connected chain', cut: 'Cut A2 ↔ A3', recovery: 'Restore A2 ↔ A3 at round 5' });
export const UTILITIES = Object.freeze([
  Object.freeze([100, 99, 90, 20, 20, 20]),
  Object.freeze([98, 3, 2, 80, 10, 9]),
  Object.freeze([97, 3, 2, 79, 78, 77]),
]);
export const PRESETS = Object.freeze([
  { id: 'connected', label: 'Connected CBBA', description: 'Watch competing bundles become a common, exclusive allocation.', config: { method: 'cbba', schedule: 'chain', capacity: CAPACITY } },
  { id: 'local', label: 'No sharing', description: 'The same local scores fill bundles, but competing claims persist.', config: { method: 'local', schedule: 'chain', capacity: CAPACITY } },
  { id: 'partition', label: 'Permanent partition', description: 'A3 cannot reconcile its claims with A1 and A2.', config: { method: 'cbba', schedule: 'cut', capacity: CAPACITY } },
  { id: 'recovery', label: 'Restore at round 5', description: 'Reconnect A2 and A3 and inspect released bundle suffixes.', config: { method: 'cbba', schedule: 'recovery', capacity: CAPACITY } },
].map((preset) => Object.freeze({ ...preset, config: Object.freeze(preset.config) })));

const copy = (value) => structuredClone(value);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const better = (bid, winner, priorBid, priorWinner) => bid > priorBid || (bid === priorBid && (priorWinner === -1 || winner < priorWinner));

// A single task's Table 1 decision. Freshness refers to knowledge of an agent,
// not to a task-specific version. Integer scores need no floating tie tolerance.
// This function reads only the receiver state and one delivered packet.
export function consensusDecision(i, k, ownWinner, ownBid, incomingWinner, incomingBid, ownT, incomingT) {
  const newer = (id) => incomingT[id] > ownT[id];
  const wins = better(incomingBid, incomingWinner, ownBid, ownWinner);
  let row, action = 'leave';
  if (incomingWinner === k) {
    if (ownWinner === i) { row = 1; if (wins) action = 'update'; }
    else if (ownWinner === k) { row = 2; action = 'update'; }
    else if (ownWinner !== -1) { row = 3; if (newer(ownWinner) || wins) action = 'update'; }
    else { row = 4; action = 'update'; }
  } else if (incomingWinner === i) {
    if (ownWinner === i) row = 5;
    else if (ownWinner === k) { row = 6; action = 'reset'; }
    else if (ownWinner !== -1) { row = 7; if (newer(ownWinner)) action = 'reset'; }
    else row = 8;
  } else if (incomingWinner !== -1) {
    if (ownWinner === i) { row = 9; if (newer(incomingWinner) && wins) action = 'update'; }
    else if (ownWinner === k) { row = 10; action = newer(incomingWinner) ? 'update' : 'reset'; }
    else if (ownWinner === incomingWinner) { row = 11; if (newer(incomingWinner)) action = 'update'; }
    else if (ownWinner !== -1) {
      row = 12;
      if (newer(ownWinner)) action = incomingT[incomingWinner] >= ownT[incomingWinner] ? 'update' : 'reset';
      else if (newer(incomingWinner) && wins) action = 'update';
    } else { row = 13; if (newer(incomingWinner)) action = 'update'; }
  } else {
    if (ownWinner === i) row = 14;
    else if (ownWinner === k) { row = 15; action = 'update'; }
    else if (ownWinner !== -1) { row = 16; if (newer(ownWinner)) action = 'update'; }
    else row = 17;
  }
  return { action, row };
}

// Packets are previous-boundary snapshots. This local routine receives no
// network schedule, other utility rows, actual bundle catalog or evaluator.
export function processPackets(agent, packets, round) {
  const decisions = [];
  agent.lastReceived = [];
  for (const packet of [...packets].sort((a, b) => a.from - b.from)) {
    agent.lastReceived.push(packet.from);
    for (let task = 0; task < agent.winners.length; task += 1) {
      const decision = consensusDecision(agent.id, packet.from, agent.winners[task], agent.bids[task], packet.winners[task], packet.bids[task], agent.timestamps, packet.timestamps);
      if (decision.action === 'update') {
        agent.winners[task] = packet.winners[task]; agent.bids[task] = packet.bids[task];
      } else if (decision.action === 'reset') {
        agent.winners[task] = -1; agent.bids[task] = 0;
      }
      decisions.push({ from: packet.from, task, ...decision });
    }
    // Merge freshness only after every task in this packet. Never propagate the
    // receiver's self slot. Direct contact takes the current receiving round.
    agent.timestamps = agent.timestamps.map((value, id) => id === agent.id ? value : Math.max(value, packet.timestamps[id]));
    agent.timestamps[packet.from] = round;
  }
  return decisions;
}

export function releaseBundle(agent) {
  const firstLost = agent.bundle.findIndex((task) => agent.winners[task] !== agent.id);
  agent.lastReleased = [];
  if (firstLost === -1) return agent.lastReleased;
  const released = agent.bundle.slice(firstLost);
  for (const [index, task] of released.entries()) {
    agent.lastReleased.push({ task, reason: index === 0 ? 'outbid' : 'suffix', winner: agent.winners[task] });
    // Keep a winner learned from a peer; clear only this agent's own stale bid.
    if (agent.winners[task] === agent.id) { agent.winners[task] = -1; agent.bids[task] = 0; }
  }
  agent.bundle = agent.bundle.slice(0, firstLost);
  agent.path = agent.path.filter((task) => !released.includes(task));
  return agent.lastReleased;
}

export function buildBundle(agent, capacity = CAPACITY) {
  agent.lastAdded = [];
  while (agent.bundle.length < capacity) {
    // S_i(path) = sum utilities_i[task]. Every insertion has the same marginal
    // gain; choose the highest eligible score, task ID ascending on ties.
    let selected = -1;
    for (let task = 0; task < agent.utilities.length; task += 1) {
      if (agent.bundle.includes(task) || agent.utilities[task] <= 0 || !better(agent.utilities[task], agent.id, agent.bids[task], agent.winners[task])) continue;
      if (selected === -1 || agent.utilities[task] > agent.utilities[selected]) selected = task;
    }
    if (selected === -1) break;
    agent.bundle.push(selected);
    // Append resolves tied insertion positions. This is an abstract task order,
    // not a route cost model, planner or vehicle execution trajectory.
    agent.path.push(selected);
    agent.winners[selected] = agent.id; agent.bids[selected] = agent.utilities[selected];
    agent.lastAdded.push(selected);
  }
  return agent.lastAdded;
}

export function linkAvailable(schedule, round, from, to) {
  if (!Object.hasOwn(SCHEDULES, schedule) || !Number.isInteger(round) || round < 1 || ![0, 1, 2].includes(from) || ![0, 1, 2].includes(to)) throw new RangeError('Invalid transport boundary.');
  if (Math.abs(from - to) !== 1) return false;
  return Math.min(from, to) === 0 || schedule === 'chain' || (schedule === 'recovery' && round >= RESTORE_ROUND);
}

// Exhaustively enumerate feasible complete assignments. This independent
// evaluator benchmark uses all utility rows; no agent routine receives it.
export function exactAllocation(utilities, capacity) {
  const taskCount = utilities[0]?.length;
  if (!Number.isInteger(capacity) || capacity < 1 || !taskCount || utilities.some((row) => row.length !== taskCount || row.some((value) => !Number.isFinite(value) || value < 0))) throw new RangeError('Expected a nonnegative finite rectangular score matrix and positive integer capacity.');
  let score = -Infinity, owners = null;
  const counts = utilities.map(() => 0), current = [];
  function assign(task, value) {
    if (task === taskCount) {
      if (value > score) { score = value; owners = [...current]; }
      return;
    }
    for (let agent = 0; agent < utilities.length; agent += 1) {
      if (counts[agent] >= capacity) continue;
      counts[agent] += 1; current.push(agent);
      assign(task + 1, value + utilities[agent][task]);
      current.pop(); counts[agent] -= 1;
    }
  }
  assign(0, 0);
  return { score: owners ? score : null, owners };
}

export function evaluateRun(run) {
  const claims = run.tasks.map((task) => run.agents.filter((agent) => agent.bundle.includes(task.id)).map((agent) => agent.id));
  const conflicts = claims.filter((owners) => owners.length > 1).length;
  const unassigned = claims.filter((owners) => owners.length === 0).length;
  const agreementTasks = run.tasks.filter((task) => run.agents.every((agent) => agent.winners[task.id] === run.agents[0].winners[task.id] && agent.bids[task.id] === run.agents[0].bids[task.id])).length;
  const fullAllocation = conflicts === 0 && unassigned === 0;
  const score = fullAllocation ? sum(claims.map((owners, task) => run.evaluator.utilities[owners[0]][task])) : null;
  const agreement = agreementTasks === run.tasks.length;
  return {
    claims, conflicts, unassigned, uniqueAssigned: claims.filter((owners) => owners.length === 1).length,
    agreement, agreementTasks, fullAllocation, score, optimalScore: run.evaluator.optimum.score,
    scoreRatio: score === null ? null : score / run.evaluator.optimum.score,
    firstAgreementRound: run.metrics?.firstAgreementRound ?? (agreement ? run.round : null),
    releaseCount: sum(run.events.filter((event) => event.type === 'release').map((event) => event.tasks.length)),
  };
}

function snapshot(run) {
  return { round: run.round, metrics: copy(run.metrics), bundles: run.agents.map((agent) => [...agent.bundle]), winners: run.agents.map((agent) => [...agent.winners]) };
}

export function createRun({ method = 'cbba', schedule = 'chain', capacity = CAPACITY } = {}) {
  if (!Object.hasOwn(METHODS, method) || !Object.hasOwn(SCHEDULES, schedule) || capacity !== CAPACITY) throw new RangeError('Choose a known method/schedule and the fixed capacity of two tasks.');
  const tasks = [[5, 1], [8, 1], [5, 3], [8, 3], [5, 5], [8, 5]].map((position, id) => ({ id, label: `T${id + 1}`, position }));
  const agents = UTILITIES.map((utilities, id) => ({ id, label: `A${id + 1}`, position: [1, 1 + 2 * id], utilities: [...utilities], bundle: [], path: [], winners: tasks.map(() => -1), bids: tasks.map(() => 0), timestamps: UTILITIES.map(() => 0), lastReceived: [], lastReleased: [], lastAdded: [] }));
  agents.forEach((agent) => buildBundle(agent, capacity));
  const run = {
    config: { method, schedule, capacity }, round: 0, status: 'running', agents, tasks,
    evaluator: { utilities: copy(UTILITIES), optimum: exactAllocation(UTILITIES, capacity) },
    metrics: null, counters: { attempted: 0, delivered: 0, dropped: 0 }, history: [], lastRound: null,
    events: [{ round: 0, type: 'initial', text: 'Each agent fills its own bundle before any exchange. These are competing claims, not completed tasks.' }],
  };
  run.metrics = evaluateRun(run); run.history.push(snapshot(run));
  return run;
}

export function stepRun(run) {
  if (run.status !== 'running') return run;
  const round = run.round + 1, { method, schedule, capacity } = run.config;
  // Freeze all outgoing payloads before updating any receiver. Dropped packets
  // are logged by the transport/evaluator and are never given to an agent.
  const packets = method === 'local' ? [] : run.agents.flatMap((agent) => run.agents.filter((peer) => Math.abs(agent.id - peer.id) === 1).map((peer) => ({
    from: agent.id, to: peer.id, delivered: linkAvailable(schedule, round, agent.id, peer.id),
    payload: copy({ from: agent.id, winners: agent.winners, bids: agent.bids, timestamps: agent.timestamps }),
  })));
  const updates = [];
  for (const agent of run.agents) {
    const beforeBundle = [...agent.bundle];
    const received = packets.filter((packet) => packet.delivered && packet.to === agent.id).map((packet) => packet.payload);
    const decisions = processPackets(agent, received, round);
    const afterConsensus = { winners: [...agent.winners], bids: [...agent.bids] };
    releaseBundle(agent);
    const afterRelease = { bundle: [...agent.bundle], winners: [...agent.winners], bids: [...agent.bids] };
    buildBundle(agent, capacity);
    const released = copy(agent.lastReleased), added = [...agent.lastAdded];
    if (released.length) run.events.push({ round, type: 'release', agent: agent.id, tasks: released.map((entry) => entry.task), text: `${agent.label} lost T${released[0].task + 1}; release it and every later acquired task before rebuilding.` });
    if (added.length) run.events.push({ round, type: 'add', agent: agent.id, tasks: added, text: `${agent.label} adds ${added.map((task) => `T${task + 1}`).join(', ')} using its own marginal scores and believed winning bids.` });
    updates.push({ agent: agent.id, beforeBundle, afterConsensus, afterRelease, afterBundle: [...agent.bundle], received: [...agent.lastReceived], released, added, decisions });
  }
  if (schedule === 'recovery' && method !== 'local' && round === RESTORE_ROUND) run.events.push({ round, type: 'restore', text: 'Transport restores both directions of A2 ↔ A3. Agents learn only from delivered packets.' });
  run.round = round; run.lastRound = { round, packets, updates };
  run.counters.attempted += packets.length;
  run.counters.delivered += packets.filter((packet) => packet.delivered).length;
  run.counters.dropped += packets.filter((packet) => !packet.delivered).length;
  run.metrics = evaluateRun(run);
  if (run.metrics.agreement && run.metrics.firstAgreementRound === round) run.events.push({ round, type: 'agreement', text: 'The evaluator observes identical winner and bid tables. Agents do not receive this global observation.' });
  // Fixed experiment budget. Agreement is an evaluator observation, never an
  // agent stopping rule or a claim that a physical mission has been executed.
  run.status = round >= CBBA_ROUNDS ? 'budget' : 'running';
  run.history.push(snapshot(run)); return run;
}

export function runToEnd(run) { while (run.status === 'running') stepRun(run); return run; }
export function resetRun(run) { return createRun(run.config); }
export function referenceComparisons() {
  return PRESETS.map((preset) => {
    const run = runToEnd(createRun(preset.config));
    return { id: preset.id, label: preset.label, ...run.config, round: run.round, ...copy(run.metrics), counters: copy(run.counters), bundles: run.agents.map((agent) => [...agent.bundle]) };
  });
}
