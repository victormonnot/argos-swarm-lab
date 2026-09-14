// Behavior Trees and an equivalent finite-state executor. The only memory
// variant changes the ROOT fallback: it resumes its Running child next tick.
// All sequences and the inner fallback restart their traversal each tick.
export const DT = 0.25;
export const SPEED = 1.5;
export const INSPECTION_SECONDS = 3;
export const TIME_LIMIT = 30;
export const HOME = Object.freeze([0, 0, 0]);
export const HOME_HOVER = Object.freeze([0, 0, 3]);
export const STATION = Object.freeze([6, 0, 3]);
export const METHODS = Object.freeze({ 'bt-reactive': 'Behavior Tree · reactive priority', fsm: 'Finite-state machine · global hold guard', 'bt-memory': 'Behavior Tree · root fallback memory' });
export const SCENARIOS = Object.freeze({ nominal: 'Uninterrupted inspection', pause: 'Hold from 7 to 10 s', 'persistent-hold': 'Hold from 7 s onward', 'sensor-failure': 'Inspection sensor fails at 7 s' });
export const PHASES = Object.freeze({ takeoff: 'Take off', fly: 'Fly to station', inspect: 'Inspect', return: 'Return home', land: 'Land', 'abort-return': 'Abort: return home', 'abort-land': 'Abort: land', hold: 'Hold position', idle: 'Idle' });
export const PRESETS = Object.freeze([
  { id: 'pause', label: 'Interrupt an inspection', description: 'A reactive priority tree halts inspection, holds position, then restarts the three-second service.', config: { method: 'bt-reactive', scenario: 'pause' } },
  { id: 'fsm', label: 'Equivalent FSM', description: 'Use the same hold guard, action primitives and restart policy in a finite-state machine.', config: { method: 'fsm', scenario: 'pause' } },
  { id: 'memory', label: 'A skipped guard', description: 'Let the root fallback remember its running mission child. Its higher-priority hold condition is not revisited.', config: { method: 'bt-memory', scenario: 'pause' } },
  { id: 'failure', label: 'Handle action failure', description: 'A failed inspection triggers the return-and-land recovery branch. Landing does not make the inspection successful.', config: { method: 'bt-reactive', scenario: 'sensor-failure' } },
  { id: 'persistent', label: 'An unresolved hold', description: 'A persistent hold preserves position but prevents mission completion within the budget.', config: { method: 'bt-reactive', scenario: 'persistent-hold' } },
  { id: 'nominal', label: 'Uninterrupted mission', description: 'Inspect the nominal takeoff, flight, inspection, return and landing sequence.', config: { method: 'bt-reactive', scenario: 'nominal' } },
].map((preset) => Object.freeze({ ...preset, config: Object.freeze(preset.config) })));

export const TREE_NODES = Object.freeze([
  { id: 'root', label: 'Priority fallback', type: 'fallback', parent: null, children: ['safety', 'execution'] },
  { id: 'safety', label: 'Hold sequence', type: 'sequence', parent: 'root', children: ['hold-requested', 'hold'] },
  { id: 'hold-requested', label: 'Hold requested?', type: 'condition', parent: 'safety', children: [] },
  { id: 'hold', label: 'Hold position', type: 'action', parent: 'safety', children: [] },
  { id: 'execution', label: 'Mission / recovery', type: 'fallback', parent: 'root', children: ['mission', 'abort'] },
  { id: 'mission', label: 'Inspection sequence', type: 'sequence', parent: 'execution', children: ['takeoff', 'fly', 'inspect', 'return', 'land'] },
  ...['takeoff', 'fly', 'inspect', 'return', 'land'].map((id) => ({ id, label: PHASES[id], type: 'action', parent: 'mission', children: [] })),
  { id: 'abort', label: 'Recovery sequence', type: 'sequence', parent: 'execution', children: ['abort-return', 'abort-land'] },
  ...['abort-return', 'abort-land'].map((id) => ({ id, label: PHASES[id], type: 'action', parent: 'abort', children: [] })),
].map((node) => Object.freeze({ ...node, children: Object.freeze(node.children) })));

const NODES = Object.fromEntries(TREE_NODES.map((node) => [node.id, node]));
const MISSION = ['takeoff', 'fly', 'inspect', 'return', 'land'];
const RECOVERY = ['abort-return', 'abort-land'];
const TARGETS = { takeoff: HOME_HOVER, fly: STATION, return: HOME_HOVER, land: HOME, 'abort-return': HOME_HOVER, 'abort-land': HOME };
const copy = (value) => structuredClone(value);
const terminal = (status) => ['completed', 'aborted', 'timed-out'].includes(status);
const blankTrace = () => ({ visited: [], statuses: Object.fromEntries(TREE_NODES.map((node) => [node.id, 'Idle'])), halted: [], transitions: [] });

function event(run, type, message, details = {}) {
  run.events.push({ step: run.step, time: run.time, type, message, ...details });
}

// Only this environment routine reads the evaluator schedule. Executors receive
// the resulting current sample, their own pose and their own action state.
function observe(evaluator, time) {
  return { sampleTime: time, holdRequested: evaluator.holdWindows.some(([start, end]) => time >= start && time < end), sensorFailed: evaluator.sensorFailureAt !== null && time >= evaluator.sensorFailureAt };
}

function tickAction(id, context) {
  const { agent, observations } = context;
  if (agent.completedActions.includes(id)) return 'Success';
  if (id === 'inspect' && (agent.inspectionFailed || observations.sensorFailed)) {
    if (!agent.inspectionFailed) {
      agent.inspectionFailed = true;
      const discardedInspectionSeconds = agent.inspectionProgress;
      agent.inspectionProgress = 0;
      context.events.push({ type: 'action-failed', message: 'Inspect returned Failure: its current sensor input is unavailable.', action: id, discardedInspectionSeconds });
    }
    return 'Failure';
  }
  context.selectedAction = id;
  if (id !== 'hold') agent.phase = id;
  return 'Running';
}

// Actual depth-first control-flow execution. A sequence stops at its first
// non-Success child; a fallback stops at its first non-Failure child.
function tickNode(id, context) {
  const node = NODES[id];
  context.trace.visited.push(id);
  let result;
  if (node.type === 'condition') result = context.observations.holdRequested ? 'Success' : 'Failure';
  else if (node.type === 'action') result = tickAction(id, context);
  else {
    const isSequence = node.type === 'sequence';
    result = isSequence ? 'Success' : 'Failure';
    const remembers = id === 'root' && context.method === 'bt-memory';
    const first = remembers ? context.memory.rootChild : 0;
    if (id === 'abort') context.agent.aborting = true;
    for (let index = first; index < node.children.length; index += 1) {
      result = tickNode(node.children[index], context);
      if ((isSequence && result !== 'Success') || (!isSequence && result !== 'Failure')) {
        if (remembers) context.memory.rootChild = result === 'Running' ? index : 0;
        break;
      }
    }
    if (remembers && result !== 'Running') context.memory.rootChild = 0;
  }
  context.trace.statuses[id] = result;
  return result;
}

// An independent, explicit finite-state control graph, using the same leaf
// actions. The global hold guard applies to every mission/recovery phase.
function tickFsm(context) {
  const { agent, observations, trace } = context;
  trace.visited.push('fsm:hold-guard');
  trace.statuses['fsm:hold-guard'] = observations.holdRequested ? 'Success' : 'Failure';
  if (observations.holdRequested) {
    if (agent.action !== 'hold') trace.transitions.push({ from: agent.phase, to: 'hold', reason: 'Hold requested' });
    trace.visited.push('hold');
    trace.statuses.hold = tickAction('hold', context);
    return 'Running';
  }
  if (agent.action === 'hold') trace.transitions.push({ from: 'hold', to: agent.phase, reason: 'Hold released' });
  while (true) {
    const sequence = agent.aborting ? RECOVERY : MISSION;
    const id = agent.phase;
    trace.visited.push(id);
    const result = tickAction(id, context);
    trace.statuses[id] = result;
    if (result === 'Running') return result;
    if (result === 'Failure') {
      agent.aborting = true;
      agent.phase = RECOVERY[0];
      trace.transitions.push({ from: id, to: agent.phase, reason: 'Action Failure' });
    } else {
      const next = sequence[sequence.indexOf(id) + 1];
      if (!next) return 'Success';
      agent.phase = next;
      trace.transitions.push({ from: id, to: next, reason: 'Action Success' });
    }
  }
}

function haltPrevious(run, selectedAction) {
  const previous = run.agent.action;
  if (previous === 'idle' || previous === selectedAction || run.agent.completedActions.includes(previous) || run.trace.statuses[previous] === 'Failure') return;
  run.trace.halted.push(previous);
  // Leaving Hold is cancellation too, but interruption metrics count only
  // productive mission/recovery actions preempted by a newly selected Hold.
  if (selectedAction === 'hold' && previous !== 'hold') {
    run.counters.interruptions += 1;
    if (previous === 'inspect') {
      run.counters.discardedInspectionSeconds += run.agent.inspectionProgress;
      run.agent.inspectionProgress = 0;
    }
  }
  event(run, 'halt', `${PHASES[previous]} was halted before ${PHASES[selectedAction] ?? 'termination'}.`, { action: previous, nextAction: selectedAction });
}

function integrateAction(run) {
  const { agent } = run;
  const before = [...agent.position];
  if (Object.hasOwn(TARGETS, agent.action)) {
    const target = TARGETS[agent.action];
    const delta = target.map((value, index) => value - agent.position[index]);
    const remaining = Math.hypot(...delta);
    const distance = Math.min(SPEED * DT, remaining);
    agent.position = remaining <= SPEED * DT ? [...target] : agent.position.map((value, index) => value + delta[index] / remaining * distance);
    if (remaining <= SPEED * DT) agent.completedActions.push(agent.action);
  } else if (agent.action === 'inspect') {
    agent.inspectionProgress = Math.min(INSPECTION_SECONDS, agent.inspectionProgress + DT);
    if (agent.inspectionProgress === INSPECTION_SECONDS) agent.completedActions.push('inspect');
  }
  agent.velocity = agent.position.map((value, index) => (value - before[index]) / DT);
  run.counters.distance += Math.hypot(...agent.position.map((value, index) => value - before[index]));
  if (run.observations.holdRequested && agent.action !== 'hold') run.counters.holdIgnoredSeconds += DT;
  run.time += DT;
  if (run.agent.completedActions.includes(agent.action)) event(run, 'action-complete', `${PHASES[agent.action]} reached its completion condition.`, { action: agent.action });
}

export function evaluateRun(run) {
  return {
    completed: run.status === 'completed', aborted: run.status === 'aborted', timedOut: run.status === 'timed-out',
    completionTime: run.status === 'completed' ? run.time : null,
    terminationTime: terminal(run.status) ? run.time : null,
    distance: run.counters.distance,
    holdIgnoredSeconds: run.counters.holdIgnoredSeconds,
    discardedInspectionSeconds: run.counters.discardedInspectionSeconds,
    interruptions: run.counters.interruptions,
    inspectionCompleted: run.agent.completedActions.includes('inspect'),
    controlTicks: run.step,
  };
}

function snapshot(run) {
  return { step: run.step, time: run.time, status: run.status, position: [...run.agent.position], velocity: [...run.agent.velocity], phase: run.agent.phase, action: run.agent.action, inspectionProgress: run.agent.inspectionProgress, observations: copy(run.observations), halted: [...run.trace.halted] };
}

export function createRun(config = {}) {
  const normalized = { method: config.method ?? 'bt-reactive', scenario: config.scenario ?? 'pause' };
  if (!Object.hasOwn(METHODS, normalized.method) || !Object.hasOwn(SCENARIOS, normalized.scenario)) throw new RangeError('Unknown behavior method or scenario.');
  const evaluator = {
    holdWindows: normalized.scenario === 'pause' ? [[7, 10]] : normalized.scenario === 'persistent-hold' ? [[7, TIME_LIMIT]] : [],
    sensorFailureAt: normalized.scenario === 'sensor-failure' ? 7 : null,
    timeLimit: TIME_LIMIT,
  };
  const run = {
    config: normalized, step: 0, time: 0, status: 'ready',
    agent: { id: 'D1', position: [...HOME], velocity: [0, 0, 0], phase: 'takeoff', action: 'idle', inspectionProgress: 0, inspectionFailed: false, completedActions: [], aborting: false },
    observations: observe(evaluator, 0), evaluator, memory: { rootChild: 0 }, trace: blankTrace(),
    counters: { distance: 0, holdIgnoredSeconds: 0, discardedInspectionSeconds: 0, interruptions: 0 },
    events: [], history: [], metrics: null,
  };
  run.metrics = evaluateRun(run);
  run.history.push(snapshot(run));
  return run;
}

export function stepRun(run) {
  if (terminal(run.status)) return run;
  run.step += 1;
  run.status = 'running';
  run.trace = blankTrace();
  const previousObservation = run.observations;
  run.observations = observe(run.evaluator, run.time);
  if (run.observations.holdRequested !== previousObservation.holdRequested) event(run, run.observations.holdRequested ? 'hold-requested' : 'hold-released', run.observations.holdRequested ? 'The current input requests Hold.' : 'The current input releases Hold.');
  if (run.observations.sensorFailed && !previousObservation.sensorFailed) event(run, 'sensor-failed', 'The inspection sensor input is now unavailable.');
  const context = { method: run.config.method, agent: run.agent, observations: run.observations, memory: run.memory, trace: run.trace, selectedAction: null, events: [] };
  const result = run.config.method === 'fsm' ? tickFsm(context) : tickNode('root', context);
  for (const entry of context.events) {
    run.counters.discardedInspectionSeconds += entry.discardedInspectionSeconds ?? 0;
    event(run, entry.type, entry.message, { action: entry.action, discardedInspectionSeconds: entry.discardedInspectionSeconds ?? 0 });
  }
  haltPrevious(run, context.selectedAction);
  if (context.selectedAction !== null) {
    if (context.selectedAction !== run.agent.action) event(run, 'action-start', `${PHASES[context.selectedAction]} is the selected action.`, { action: context.selectedAction });
    run.agent.action = context.selectedAction;
    integrateAction(run);
    if (run.time >= TIME_LIMIT) {
      run.status = 'timed-out';
      event(run, 'timeout', 'The 30-second experiment budget expired before controller completion.');
    }
  } else {
    run.agent.action = 'idle';
    run.agent.velocity = [0, 0, 0];
    run.status = result === 'Success' && !run.agent.aborting ? 'completed' : 'aborted';
    event(run, run.status, run.status === 'completed' ? 'Inspection mission completed and the drone landed.' : 'Recovery completed and the drone landed; the inspection mission was aborted.');
  }
  run.metrics = evaluateRun(run);
  run.history.push(snapshot(run));
  return run;
}

export function runToEnd(run) {
  while (!terminal(run.status)) stepRun(run);
  return run;
}

export function resetRun(run) {
  return createRun(run.config);
}

export function referenceComparisons() {
  return Object.keys(SCENARIOS).flatMap((scenario) => Object.keys(METHODS).map((method) => {
    const run = runToEnd(createRun({ method, scenario }));
    return { id: `${scenario}-${method}`, label: `${SCENARIOS[scenario]} · ${METHODS[method]}`, method, scenario, metrics: copy(run.metrics), final: { step: run.step, time: run.time, status: run.status, position: [...run.agent.position], inspectionProgress: run.agent.inspectionProgress }, events: copy(run.events) };
  }));
}
