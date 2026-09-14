import { greedyAssignment } from './assignment.js';
import { MISSION_DT, MISSION_SPEED, SERVICE_STEPS, MISSION_STARTS, TASK_POINTS, missionDistance } from './mission-model.js';

export { MISSION_DT, MISSION_SPEED, SERVICE_STEPS, MISSION_STARTS, TASK_POINTS };
export const ARCHITECTURE_BUDGET = 600;
export const CUT_STEP = 20;
export const RESTORE_STEP = 80;
export const NODE_NAMES = Object.freeze(['C', 'A1', 'A2', 'A3']);
export const ARCHITECTURES = Object.freeze({ central: 'Central coordinator', hierarchy: 'Subgroup coordinators', peers: 'Peer-to-peer replicas' });
export const NETWORKS = Object.freeze({ connected: 'Always connected', partition: 'Cut at 2 s · no restoration', recovery: 'Cut at 2 s · restore at 8 s' });
export const GROUPS = Object.freeze([
  Object.freeze({ node: 1, agents: Object.freeze([0]), tasks: Object.freeze([0, 3]) }),
  Object.freeze({ node: 2, agents: Object.freeze([1, 2]), tasks: Object.freeze([1, 2, 4, 5]) }),
]);
const ALL_AGENTS = [0, 1, 2], ALL_TASKS = [0, 1, 2, 3, 4, 5];
const copy = (value) => structuredClone(value);

/** Transport truth only. Decision functions receive deliveries, never this graph. */
export function networkPartitioned(preset, step) {
  return preset !== 'connected' && step >= CUT_STEP && (preset === 'partition' || step < RESTORE_STEP);
}
export function linkAvailable(preset, step, from, to) {
  return !networkPartitioned(preset, step) || (from < 2) === (to < 2);
}
function scopeFor(architecture, node) {
  if (architecture === 'central') return node === 0 ? { agents: ALL_AGENTS, tasks: ALL_TASKS } : null;
  if (architecture === 'hierarchy') return GROUPS.find((group) => group.node === node) || null;
  return node > 0 ? { agents: ALL_AGENTS, tasks: ALL_TASKS } : null;
}
function ownReport(agent, step) {
  return { agentId: agent.id, step, position: [...agent.position], state: agent.state, taskId: agent.taskId, completed: [...agent.completed] };
}
function receiveReport(knowledge, report) {
  knowledge.reports[report.agentId] = copy(report);
  knowledge.completed = [...new Set([...knowledge.completed, ...report.completed])].sort((a, b) => a - b);
  for (const taskId of knowledge.completed) knowledge.reservations[taskId] = null;
  if (report.taskId !== null && !knowledge.completed.includes(report.taskId)) knowledge.reservations[report.taskId] = report.agentId;
}
function packet(run, kind, from, to, payload) {
  const delivered = linkAvailable(run.initial.network, run.step, from, to);
  run.traffic[kind].attempted += 1;
  run.traffic[kind][delivered ? 'delivered' : 'dropped'] += 1;
  run.lastPackets.push({ kind, from, to, delivered });
  return delivered ? copy(payload) : null;
}
function event(run, type, details = {}) { run.events.push({ step: run.step, time: run.step * MISSION_DT, type, ...details }); }

/** The entire decision input: one local cache, static permissions and round time.
 * No true task state, remote executor state or future network schedule is read.
 */
export function architectureObservation(run, node) {
  if (!Number.isInteger(node) || node < 0 || node > 3) throw new RangeError('Unknown observer.');
  return { node, step: run.step, architecture: run.initial.architecture,
    scope: copy(scopeFor(run.initial.architecture, node)), knowledge: copy(run.knowledge[node]) };
}
export function planArchitecture(observation) {
  const { node, step, architecture, scope, knowledge } = observation;
  if (!scope) return { node, step, allowed: false, missing: [], assignments: [], reason: 'Observer only; no assignment authority.' };
  const missing = scope.agents.filter((id) => knowledge.reports[id]?.step !== step);
  if (architecture === 'peers' && missing.length) return { node, step, allowed: false, missing, assignments: [], reason: 'Waiting for fresh reports from the full roster.' };
  const agents = scope.agents.map((id) => knowledge.reports[id]).filter((report) => report?.step === step && report.state === 'idle');
  const tasks = scope.tasks.filter((id) => !knowledge.completed.includes(id) && knowledge.reservations[id] === null);
  const costs = agents.map((agent) => tasks.map((id) => missionDistance(agent.position, TASK_POINTS[id])));
  const assignments = greedyAssignment(costs).map(([row, column]) => ({ agentId: agents[row].agentId, taskId: tasks[column], cost: costs[row][column] }));
  return { node, step, allowed: true, missing, agentIds: agents.map((agent) => agent.agentId), taskIds: tasks, costs, assignments,
    reason: assignments.length ? 'Fresh idle reports and unreserved tasks are eligible.' : 'No eligible new work at this boundary.' };
}

function acceptTarget(run, agentId, taskId, source) {
  const agent = run.agents[agentId];
  // The executor checks its own state only, never global task ownership.
  if (agent.state !== 'idle') throw new Error('A busy executor received an unexpected new target.');
  agent.taskId = taskId; agent.state = 'travelling'; agent.serviceRemaining = SERVICE_STEPS;
  event(run, 'assigned', { agentId, taskId, source });
}
function rememberPlan(knowledge, plan) {
  for (const assignment of plan.assignments) knowledge.reservations[assignment.taskId] = assignment.agentId;
  if (plan.assignments.length) knowledge.lastDecision = copy(plan);
}
function communicationAndDispatch(run) {
  run.lastPackets = [];
  // All reports are produced before any new command. Own reports are local;
  // the same nine remote status-report attempts occur in every architecture.
  const reports = run.agents.map((agent) => ownReport(agent, run.step));
  for (const report of reports) {
    const from = report.agentId + 1;
    receiveReport(run.knowledge[from], report);
    for (let to = 0; to < 4; to += 1) {
      if (to === from) continue;
      const delivered = packet(run, 'report', from, to, report);
      if (delivered) receiveReport(run.knowledge[to], delivered);
    }
  }
  const plans = run.knowledge.map((_, node) => planArchitecture(architectureObservation(run, node)));
  run.knowledge.forEach((knowledge, node) => { knowledge.readiness = plans[node]; knowledge.agreementFrom = []; });
  if (run.initial.architecture === 'peers') {
    // Each peer independently proposes its plan from its own received cache.
    // No simulator-wide ready flag or component membership enters a decision.
    const inboxes = [null, [], [], []];
    for (let from = 1; from < 4; from += 1) {
      if (!plans[from].allowed || !plans[from].assignments.length) continue;
      const proposal = { step: run.step, assignments: plans[from].assignments };
      inboxes[from].push({ from, proposal });
      for (let to = 1; to < 4; to += 1) {
        if (to === from) continue;
        const delivered = packet(run, 'proposal', from, to, proposal);
        if (delivered) inboxes[to].push({ from, proposal: delivered });
      }
    }
    for (let node = 1; node < 4; node += 1) {
      const plan = plans[node];
      const agree = inboxes[node].filter(({ proposal }) => proposal.step === run.step && JSON.stringify(proposal.assignments) === JSON.stringify(plan.assignments)).map(({ from }) => from);
      run.knowledge[node].agreementFrom = agree;
      if (agree.length !== 3) continue;
      rememberPlan(run.knowledge[node], plan);
      const own = plan.assignments.find((assignment) => assignment.agentId === node - 1);
      if (own) acceptTarget(run, own.agentId, own.taskId, NODE_NAMES[node]);
    }
  } else {
    for (const plan of plans) {
      if (!plan.allowed) continue;
      for (const assignment of plan.assignments) {
        const target = assignment.agentId + 1;
        const command = { agentId: assignment.agentId, taskId: assignment.taskId };
        const delivered = target === plan.node ? command : packet(run, 'command', plan.node, target, command);
        if (delivered) {
          run.knowledge[plan.node].reservations[assignment.taskId] = assignment.agentId;
          acceptTarget(run, delivered.agentId, delivered.taskId, NODE_NAMES[plan.node]);
        }
      }
      if (plan.assignments.length) run.knowledge[plan.node].lastDecision = copy(plan);
    }
  }
}

/** Evaluation only: task truth is derived from executor work, not fed to plans. */
function evaluateAndSnapshot(run) {
  run.tasks = TASK_POINTS.map((position, id) => {
    const owners = run.agents.filter((agent) => agent.taskId === id);
    const completions = run.agents.filter((agent) => agent.completed.includes(id));
    return { id, position: [...position], owner: owners[0]?.id ?? null, owners: owners.map((agent) => agent.id),
      state: completions.length ? 'completed' : owners.some((agent) => agent.state === 'servicing') ? 'servicing' : owners.length ? 'assigned' : 'pending',
      serviceRemaining: completions.length ? 0 : owners[0]?.serviceRemaining ?? SERVICE_STEPS,
      completionCount: completions.length };
  });
  run.duplicateAssignments = Math.max(run.duplicateAssignments, ...run.tasks.map((task) => Math.max(0, task.owners.length - 1)));
  const physical = run.tasks.filter((task) => task.state === 'completed').length;
  const known = run.knowledge.map((knowledge) => knowledge.completed.length);
  const confirmed = run.initial.architecture === 'peers' ? Math.min(...known.slice(1)) : known[0];
  if (physical === 6 && run.firstPhysicalStep === null) run.firstPhysicalStep = run.step;
  if (physical === 6 && confirmed === 6) run.status = 'completed';
  else if (run.step >= ARCHITECTURE_BUDGET) run.status = 'budget';
  run.history.push({ step: run.step, time: run.step * MISSION_DT, positions: run.agents.map((agent) => [...agent.position]), physical, confirmed,
    known, distance: run.agents.reduce((total, agent) => total + agent.distance, 0),
    waiting: run.agents.filter((agent) => agent.state === 'idle').length,
    duplicateCompletions: run.tasks.reduce((total, task) => total + Math.max(0, task.completionCount - 1), 0) });
}
export function createArchitectureRun({ architecture = 'central', network = 'recovery' } = {}) {
  if (!Object.hasOwn(ARCHITECTURES, architecture) || !Object.hasOwn(NETWORKS, network)) throw new RangeError('Unknown architecture or network preset.');
  const run = { initial: { architecture, network }, step: 0, status: 'running',
    agents: MISSION_STARTS.map((position, id) => ({ id, position: [...position], state: 'idle', taskId: null, serviceRemaining: 0, completed: [], distance: 0 })),
    knowledge: NODE_NAMES.map((_, node) => ({ node, reports: [null, null, null], completed: [], reservations: Array(6).fill(null), lastDecision: null, readiness: null, agreementFrom: [] })),
    traffic: Object.fromEntries(['report', 'proposal', 'command'].map((kind) => [kind, { attempted: 0, delivered: 0, dropped: 0 }])),
    tasks: [], events: [], history: [], lastPackets: [], firstPhysicalStep: null, duplicateAssignments: 0 };
  communicationAndDispatch(run); evaluateAndSnapshot(run); return run;
}
export function stepArchitecture(run) {
  if (run.status !== 'running') return run;
  const next = { ...run, step: run.step + 1, agents: copy(run.agents), knowledge: copy(run.knowledge),
    traffic: copy(run.traffic), events: [...run.events], history: [...run.history] };
  for (const agent of next.agents) {
    if (agent.state === 'travelling') {
      const target = TASK_POINTS[agent.taskId], distance = missionDistance(agent.position, target);
      const arrived = distance <= MISSION_SPEED * MISSION_DT + 1e-12;
      const fraction = arrived ? 1 : MISSION_SPEED * MISSION_DT / distance;
      const position = agent.position.map((value, axis) => value + fraction * (target[axis] - value));
      agent.distance += missionDistance(agent.position, position); agent.position = position;
      if (arrived) { agent.state = 'servicing'; event(next, 'arrived', { agentId: agent.id, taskId: agent.taskId }); }
    } else if (agent.state === 'servicing') {
      agent.serviceRemaining -= 1;
      if (agent.serviceRemaining === 0) {
        agent.completed.push(agent.taskId); event(next, 'completed', { agentId: agent.id, taskId: agent.taskId });
        agent.state = 'idle'; agent.taskId = null;
      }
    }
  }
  const before = networkPartitioned(run.initial.network, run.step), after = networkPartitioned(next.initial.network, next.step);
  if (before !== after) event(next, after ? 'partition' : 'restored');
  communicationAndDispatch(next); evaluateAndSnapshot(next); return next;
}
export function resetArchitecture(run) { return createArchitectureRun(run.initial); }
export function finishArchitecture(run) { while (run.status === 'running') run = stepArchitecture(run); return run; }
export function compareArchitectures() {
  return Object.keys(NETWORKS).flatMap((network) => Object.keys(ARCHITECTURES).map((architecture) => {
    const run = finishArchitecture(createArchitectureRun({ architecture, network })), last = run.history.at(-1);
    return { architecture, network, status: run.status, step: run.step, time: last.time, physical: last.physical, confirmed: last.confirmed,
      firstPhysicalStep: run.firstPhysicalStep, physicalTime: run.firstPhysicalStep === null ? null : run.firstPhysicalStep * MISSION_DT,
      totalDistance: last.distance, duplicateAssignments: run.duplicateAssignments, duplicateCompletions: last.duplicateCompletions,
      traffic: run.traffic, known: last.known };
  }));
}
