import { greedyAssignment, hungarianAssignment, assignmentCost } from './assignment.js';

export const MISSION_DT = 0.1;
export const MISSION_SPEED = 1;
export const SERVICE_STEPS = 20;
export const MISSION_BUDGET = 600;
export const FAILURE_STEP = 50;
export const MISSION_STARTS = Object.freeze([[0, 0], [2, 0], [0, 4]].map(Object.freeze));
export const TASK_POINTS = Object.freeze([[0.8, 0], [-2, 0], [0, 6], [-5, 2], [5, 3], [2, 7]].map(Object.freeze));
export const POLICIES = Object.freeze({ fixed: 'Fixed round-robin', greedy: 'Nearest-pair greedy', hungarian: 'Hungarian algorithm' });
export const missionDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Central allocator observations are exact declared reports, not local sensing.
 * No global outcome, path counter or future failure schedule is supplied.
 */
export function allocatorObservation(run) {
  return {
    agents: run.agents.filter((agent) => agent.state === 'idle').map(({ id, position }) => ({ id, position: [...position] })),
    tasks: run.tasks.filter((task) => task.state === 'pending').map(({ id, position, fixedOwner }) => ({ id, position: [...position], fixedOwner })),
  };
}

/** An executor only receives its pose, state and assigned task/service progress. */
export function executorObservation(run, id) {
  const agent = run.agents[id];
  if (!agent) throw new RangeError('Unknown mission agent.');
  const task = agent.taskId === null ? null : run.tasks[agent.taskId];
  return { id, position: [...agent.position], state: agent.state,
    task: task ? { id: task.id, position: [...task.position], serviceRemaining: task.serviceRemaining } : null };
}

export function planDispatch(observation, policy) {
  if (!Object.hasOwn(POLICIES, policy)) throw new RangeError('Unknown allocation policy.');
  const costs = observation.agents.map((agent) => observation.tasks.map((task) => missionDistance(agent.position, task.position)));
  const pairs = policy === 'fixed'
    ? observation.agents.flatMap((agent, row) => {
      const column = observation.tasks.findIndex((task) => task.fixedOwner === agent.id);
      return column < 0 ? [] : [[row, column]];
    })
    : policy === 'greedy' ? greedyAssignment(costs) : hungarianAssignment(costs);
  return { policy, agentIds: observation.agents.map((agent) => agent.id), taskIds: observation.tasks.map((task) => task.id),
    costs, pairs, totalCost: assignmentCost(costs, pairs),
    assignments: pairs.map(([row, column]) => ({ agentId: observation.agents[row].id, taskId: observation.tasks[column].id, cost: costs[row][column] })) };
}

function record(run, type, details = {}) { run.events.push({ step: run.step, time: run.step * MISSION_DT, type, ...details }); }
function dispatch(run) {
  const observation = allocatorObservation(run);
  if (!observation.agents.length || !observation.tasks.length) return;
  const plan = planDispatch(observation, run.initial.policy);
  if (!plan.assignments.length) return;
  run.dispatches.push({ step: run.step, time: run.step * MISSION_DT, ...plan });
  for (const { agentId, taskId } of plan.assignments) {
    const agent = run.agents[agentId], task = run.tasks[taskId];
    const previousOwner = task.assignedOwners.at(-1);
    if (previousOwner !== undefined && previousOwner !== agentId) run.reassignments += 1;
    task.assignedOwners.push(agentId);
    task.owner = agentId; task.state = 'assigned';
    agent.taskId = taskId; agent.state = 'travelling';
    record(run, 'assigned', { agentId, taskId, reassigned: previousOwner !== undefined && previousOwner !== agentId });
  }
}
function loseAgent(run, id) {
  const agent = run.agents[id];
  if (agent.state === 'unavailable') return;
  const task = agent.taskId === null ? null : run.tasks[agent.taskId];
  const lostService = task ? (SERVICE_STEPS - task.serviceRemaining) * MISSION_DT : 0;
  run.lostService += lostService;
  record(run, 'unavailable', { agentId: id, taskId: agent.taskId, lostService });
  if (task) {
    task.state = 'pending'; task.owner = null; task.serviceRemaining = SERVICE_STEPS;
    record(run, 'released', { agentId: id, taskId: task.id, eligibleForReassignment: run.initial.policy !== 'fixed' });
  }
  agent.taskId = null; agent.state = 'unavailable';
}
function evaluate(run) {
  const completed = run.tasks.filter((task) => task.state === 'completed').length;
  if (completed === run.tasks.length) run.status = 'completed';
  else if (!run.agents.some((agent) => ['travelling', 'servicing'].includes(agent.state))) run.status = 'blocked';
  else if (run.step >= MISSION_BUDGET) run.status = 'budget';
}
function snapshot(run) {
  return { step: run.step, time: run.step * MISSION_DT, positions: run.agents.map((agent) => [...agent.position]),
    states: run.agents.map((agent) => agent.state), completed: run.tasks.filter((task) => task.state === 'completed').length,
    available: run.agents.filter((agent) => agent.state !== 'unavailable').length,
    distance: run.agents.reduce((total, agent) => total + agent.distance, 0) };
}

export function createMissionRun({ policy = 'greedy', failure = false } = {}) {
  if (!Object.hasOwn(POLICIES, policy)) throw new RangeError('Unknown allocation policy.');
  if (typeof failure !== 'boolean') throw new TypeError('Failure must be a boolean.');
  const run = { initial: { policy, failure }, step: 0, status: 'running',
    agents: MISSION_STARTS.map((position, id) => ({ id, position: [...position], state: 'idle', taskId: null, distance: 0 })),
    tasks: TASK_POINTS.map((position, id) => ({ id, position: [...position], fixedOwner: id % 3, owner: null,
      state: 'pending', serviceRemaining: SERVICE_STEPS, assignedOwners: [], completedBy: null, completedAt: null })),
    events: [], dispatches: [], history: [], reassignments: 0, lostService: 0, failureApplied: false };
  dispatch(run);
  run.history.push(snapshot(run));
  return run;
}

/** One fixed movement/service interval, then reports, optional failure, dispatch.
 * Ownership changes only at dispatch boundaries; in-flight jobs are not preempted.
 */
export function stepMission(run) {
  if (run.status !== 'running') return run;
  const next = { ...run, step: run.step + 1,
    agents: run.agents.map((agent) => ({ ...agent, position: [...agent.position] })),
    tasks: run.tasks.map((task) => ({ ...task, assignedOwners: [...task.assignedOwners] })),
    events: [...run.events], dispatches: [...run.dispatches], history: [...run.history] };
  // Each executor observes the previous state, independent of other agents.
  for (const agent of next.agents) {
    const observation = executorObservation(run, agent.id);
    if (!observation.task) continue;
    const task = next.tasks[observation.task.id];
    if (observation.state === 'travelling') {
      const distance = missionDistance(observation.position, observation.task.position);
      const arrived = distance <= MISSION_SPEED * MISSION_DT + 1e-12;
      const fraction = arrived ? 1 : MISSION_SPEED * MISSION_DT / distance;
      agent.position = observation.position.map((value, axis) => value + fraction * (observation.task.position[axis] - value));
      agent.distance += missionDistance(observation.position, agent.position);
      if (arrived) {
        agent.state = 'servicing'; task.state = 'servicing';
        record(next, 'arrived', { agentId: agent.id, taskId: task.id });
      }
    } else if (observation.state === 'servicing') {
      task.serviceRemaining -= 1;
      if (task.serviceRemaining === 0) {
        task.state = 'completed'; task.completedBy = agent.id; task.completedAt = next.step;
        task.owner = null; agent.taskId = null; agent.state = 'idle';
        record(next, 'completed', { agentId: agent.id, taskId: task.id });
      }
    }
  }
  if (next.initial.failure && next.step === FAILURE_STEP && !next.failureApplied) {
    loseAgent(next, 1); next.failureApplied = true;
  }
  // Idle executors receive a new target after all reports from this boundary.
  // Existing assignments keep ownership; no planner sees future failures.
  dispatch(next);
  evaluate(next);
  next.history.push(snapshot(next));
  return next;
}
export function resetMission(run) { return createMissionRun(run.initial); }
export function finishMission(run) {
  while (run.status === 'running') run = stepMission(run);
  return run;
}
export function compareMissions() {
  return [false, true].flatMap((failure) => Object.keys(POLICIES).map((policy) => {
    const run = finishMission(createMissionRun({ policy, failure }));
    return { policy, failure, status: run.status, step: run.step, time: run.step * MISSION_DT,
      completed: run.history.at(-1).completed, remaining: run.tasks.filter((task) => task.state !== 'completed').map((task) => task.id),
      available: run.history.at(-1).available, totalDistance: run.history.at(-1).distance,
      firstDispatchCost: run.dispatches[0].totalCost, reassignments: run.reassignments, lostService: run.lostService,
      completionSteps: run.tasks.map((task) => task.completedAt), failureApplied: run.failureApplied };
  }));
}
