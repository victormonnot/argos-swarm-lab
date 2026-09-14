import './style.css';
import './mission.css';
import './behavior.css';
import { DT, INSPECTION_SECONDS, TIME_LIMIT, METHODS, SCENARIOS, PHASES, PRESETS, TREE_NODES, createRun, stepRun, runToEnd, referenceComparisons } from './behavior-model.js';
import { createBehaviorView } from './behavior-view.js';

const $ = (selector) => document.querySelector(selector);
const active = (run) => ['ready', 'running'].includes(run.status);
const seconds = (value) => `${value.toFixed(2)} s`;
const position = (value) => value.map((coordinate) => coordinate.toFixed(2)).join(', ');
const symbols = { fallback: '?', sequence: '→', condition: '◇', action: '▪' };
const nodeLabels = { ...Object.fromEntries(TREE_NODES.map((node) => [node.id, node.label])), 'fsm:hold-guard': 'Global hold guard' };
const methodDescriptions = {
  'bt-reactive': 'Reevaluate the root’s priority fallback each tick. A new hold request preempts the mission and halts its current action.',
  fsm: 'Check a global hold guard before every phase. The explicit state transitions use the same actions and restart policy as the reactive tree.',
  'bt-memory': 'Remember the root’s Running child. Once mission execution is Running, the root skips its earlier hold branch; the action can still report Failure.',
};
const scenarioDescriptions = {
  nominal: 'No interruption. Take off to 3 m, fly 6 m to the station, inspect for 3 seconds, return, then land.',
  pause: 'The hold input is true from t = 7 s up to, but excluding, t = 10 s. At 7 s the inspection has accumulated 1 of its 3 required seconds.',
  'persistent-hold': 'The hold input becomes true at t = 7 s and remains true. The reactive tree and guarded FSM wait at the station until the 30 s budget expires.',
  'sensor-failure': 'At t = 7 s the inspection sensor fails permanently. The inspection action reports Failure and discards its partial service; recovery returns and lands.',
};
const nodeHelp = {
  root: 'Fallback: try the hold branch before execution. Reactive priority starts with the first child each tick; root memory resumes its previous Running child and can skip the hold branch.',
  safety: 'Sequence: first test Hold requested?; only if that condition returns Success does Hold position receive a tick.',
  'hold-requested': 'Condition: return Success when this tick’s ideal local hold input is true; otherwise return Failure. An unticked condition provides no new decision to the tree.',
  hold: 'Action: stay at the current 3D position and return Running. Entering Hold halts the previous unfinished action; an interrupted inspection loses its partial progress.',
  execution: 'Fallback: try the inspection mission first. If it returns Failure, tick the return-and-land recovery. This fallback remains reactive in both tree variants.',
  mission: 'Sequence: take off, fly to the station, inspect, return and land. Completed actions are latched and return Success when ticked again, so the next unfinished action receives the command interval.',
  takeoff: 'Action: move vertically from the home pad toward [0, 0, 3] m at 1.5 m/s. Return Running until the completed action is observed on a later tick.',
  fly: 'Action: move from the takeoff waypoint toward the station waypoint [6, 0, 3] m at 1.5 m/s. Exact own position and a known target are supplied.',
  inspect: 'Action: accumulate 3 uninterrupted seconds at the station. A halt or sensor failure discards incomplete progress; sensor failure returns Failure. Completed inspection stays latched.',
  return: 'Action: move toward the home hover waypoint [0, 0, 3] m at 1.5 m/s after successful inspection.',
  land: 'Action: descend to the home pad [0, 0, 0] m. The final decision tick observes completion without applying another motion interval.',
  abort: 'Recovery sequence: return home and land after inspection Failure. Its Success says recovery finished; the inspection mission is still aborted.',
  'abort-return': 'Recovery action: move to the home hover waypoint [0, 0, 3] m after inspection failure. It uses the same motion primitive as a nominal return.',
  'abort-land': 'Recovery action: descend to [0, 0, 0] m. A completed recovery ends an aborted mission, not a successful inspection.',
  'fsm:hold-guard': 'Global FSM guard: test the hold input before every mission or recovery phase. A true guard selects Hold; release resumes the retained phase with the same inspection restart policy as the reactive BT.',
};
let run = createRun(), playing = false, timer, selectedNode = 'root', viewMode = '3d';
const view = createBehaviorView($('#behavior-viewport'), { onModeChange(mode, message) {
  viewMode = mode;
  for (const name of ['2d', '3d']) $(`#behavior-${name}`).setAttribute('aria-pressed', String(name === mode));
  $('#behavior-view-hint').textContent = message ?? (mode === '3d'
    ? 'Drag to orbit · scroll to zoom · Focus drone for a closer view. Dashed lines show the fixed route; the vertical guide shows altitude. Camera movement never advances the mission.'
    : 'Side elevation (x, z): the same drone, altitude and executed path. All mission waypoints have y = 0. Switching views never advances the mission.');
} });
function stop() { playing = false; clearTimeout(timer); }
function schedule() {
  clearTimeout(timer);
  if (!playing || !active(run)) return;
  timer = setTimeout(() => { stepRun(run); if (!active(run)) stop(); render(); schedule(); }, DT * 1000 / Number($('#behavior-speed').value));
}
function start(config) {
  stop(); run = createRun(config);
  $('#behavior-controller').value = run.config.method;
  $('#behavior-scenario').value = run.config.scenario;
  selectedNode = run.config.method === 'fsm' ? 'fsm:hold-guard' : 'root';
  render();
}
function nodeButton(id) {
  const node = TREE_NODES.find((item) => item.id === id);
  const status = run.trace.statuses[id] ?? 'Idle', halted = run.trace.halted.includes(id);
  const label = id === 'root' && run.config.method === 'bt-memory' ? 'Priority fallback · memory' : nodeLabels[id];
  const symbol = id === 'fsm:hold-guard' ? '◇' : id === 'root' && run.config.method === 'bt-memory' ? 'M?' : symbols[node?.type] ?? '▪';
  return `<button class="behavior-node" data-behavior-node="${id}" data-status="${status}" data-halted="${halted}" aria-pressed="${selectedNode === id}" aria-label="${label}: ${status}${halted ? ', halted this tick' : ''}"><span><b class="behavior-node-type" aria-hidden="true">${symbol}</b>${label}</span><span>${halted ? '⊘ Halted' : status === 'Idle' ? '— Idle' : status}</span></button>`;
}
function branch(id) {
  const node = TREE_NODES.find((item) => item.id === id);
  if (!node.children.length) return nodeButton(id);
  const actionGroup = node.children.every((child) => !TREE_NODES.find((item) => item.id === child).children.length);
  return `<div class="behavior-tree-node">${nodeButton(id)}<div class="behavior-tree-children${actionGroup ? ' behavior-mission-actions' : ''}">${node.children.map((child) => `<div class="behavior-tree-node">${branch(child)}</div>`).join('')}</div></div>`;
}
function renderFlow() {
  const focusedId = $('#behavior-flow').contains(document.activeElement) ? document.activeElement.dataset.behaviorNode : null;
  const isFsm = run.config.method === 'fsm';
  $('#behavior-flow-title').textContent = isFsm ? 'Finite-state machine · guarded phases' : run.config.method === 'bt-memory' ? 'Behavior Tree · memory at the root' : 'Behavior Tree · reactive priority';
  $('#behavior-flow-description').textContent = isFsm
    ? 'The global hold guard runs first. Action Success advances to the next state; inspection Failure selects the recovery path. Select a state or guard to inspect it.'
    : 'Follow the latest depth-first tick. Only visited nodes have a return status. Completed actions can return Success without consuming a new command interval. Select a node to inspect it.';
  $('#behavior-flow').innerHTML = isFsm
    ? `<div class="behavior-fsm-guard">${nodeButton('fsm:hold-guard')}<p>True → ${nodeButton('hold')}<br>False / hold released → resume the retained mission or recovery phase.</p></div><div class="behavior-fsm-track">${['takeoff', 'fly', 'inspect', 'return', 'land'].map((id, index) => `${index ? '<span class="behavior-fsm-arrow" aria-hidden="true">→</span>' : ''}${nodeButton(id)}`).join('')}</div><div class="behavior-fsm-abort">Inspect Failure → recovery path<div class="behavior-fsm-track">${nodeButton('abort-return')}<span class="behavior-fsm-arrow" aria-hidden="true">→</span>${nodeButton('abort-land')}</div></div>`
    : `<div class="behavior-tree-root">${branch('root')}</div>`;
  if (focusedId) $(`[data-behavior-node="${focusedId}"]`)?.focus({ preventScroll: true });
  $('#behavior-node-help').textContent = `${nodeLabels[selectedNode]} — ${nodeHelp[selectedNode]}`;
  $('#behavior-tick-result').textContent = run.step === 0 ? 'Not ticked' : isFsm ? `Phase: ${PHASES[run.agent.phase]}` : `Root: ${run.trace.statuses.root}`;
  const transitions = run.trace.transitions.map((entry) => `${nodeLabels[entry.from] ?? entry.from} → ${nodeLabels[entry.to] ?? entry.to} (${entry.reason})`).join('; ');
  $('#behavior-tick-order').textContent = run.step === 0 ? 'No control tick yet. Step once to inspect the first decision.' : `Tick ${run.step} · visited: ${run.trace.visited.map((id) => nodeLabels[id] ?? id).join(' → ')}.${transitions ? ` Transitions: ${transitions}.` : ''}`;
}
function renderObservations() {
  const { agent, observations, metrics } = run;
  $('#behavior-sample-note').textContent = run.step === 0 ? 'Initial inputs, before any control tick.' : `Latest input sampled at ${seconds(observations.sampleTime)}. The pose and service values below are after that tick’s applied interval, at ${seconds(run.time)}.${observations.sampleTime === run.time ? ' This terminal decision tick applied no new interval.' : ''}`;
  $('#behavior-observations').innerHTML = `<div><dt>Local hold request</dt><dd data-observation="holdRequested" data-request="${observations.holdRequested}">${observations.holdRequested ? 'True / hold requested' : 'False / no hold'}</dd></div><div><dt>Inspection sensor</dt><dd data-observation="sensorFailed" data-request="${observations.sensorFailed}">${observations.sensorFailed ? 'Failed' : 'Available'}</dd></div><div><dt>Own position (x, y, z) m</dt><dd id="behavior-position" data-position='${JSON.stringify(agent.position)}'>[${position(agent.position)}]</dd></div><div><dt>Retained execution phase</dt><dd>${PHASES[agent.phase]}</dd></div><div><dt>Completed actions</dt><dd>${agent.completedActions.length ? agent.completedActions.map((id) => PHASES[id]).join(' · ') : 'None yet'}</dd></div><div><dt>Distance / evaluator</dt><dd>${metrics.distance.toFixed(2)} m</dd></div>`;
  $('#behavior-service-label').textContent = `${Math.round(agent.inspectionProgress / INSPECTION_SECONDS * 100)}%`;
  $('#behavior-service-meter').value = agent.inspectionProgress;
  $('#behavior-halt-note').textContent = run.trace.halted.length
    ? `Halted this tick: ${run.trace.halted.map((id) => PHASES[id]).join(', ')}. Total mission interruptions: ${metrics.interruptions}. Total discarded inspection: ${seconds(metrics.discardedInspectionSeconds)}.`
    : `No action halted in the latest tick. Total mission interruptions: ${metrics.interruptions}. Total discarded inspection: ${seconds(metrics.discardedInspectionSeconds)} (interruption or sensor failure).`;
  $('#behavior-history').innerHTML = run.history.slice(1).slice(-12).reverse().map((entry) => `<tr><td>${entry.observations.sampleTime.toFixed(2)} → ${entry.time.toFixed(2)} s</td><td>${PHASES[entry.action]}</td><td>[${position(entry.position)}]</td></tr>`).join('') || '<tr><td colspan="3">No action ticks yet.</td></tr>';
  $('#behavior-events').innerHTML = run.events.slice(-14).reverse().map((entry) => `<li data-behavior-event="${entry.type}"><strong>${seconds(entry.time)} / tick ${entry.step}</strong> · ${entry.message}</li>`).join('') || '<li>No events yet. Start with one control tick.</li>';
}
function render() {
  const { agent, metrics } = run;
  $('#behavior-status').textContent = active(run) ? playing ? 'Playing' : 'Paused' : run.status === 'completed' ? 'Mission completed' : run.status === 'aborted' ? 'Mission aborted' : 'Time budget reached';
  $('#behavior-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#behavior-${id}`).disabled = !active(run);
  $('#behavior-boundary').disabled = run.config.scenario === 'nominal' || run.time >= 7 || !active(run);
  $('#behavior-description').textContent = methodDescriptions[run.config.method];
  $('#behavior-scenario-description').textContent = scenarioDescriptions[run.config.scenario];
  $('#behavior-time').textContent = seconds(run.time);
  $('#behavior-step-count').textContent = String(run.step);
  $('#behavior-action').textContent = PHASES[agent.action];
  $('#behavior-altitude').textContent = `Altitude ${agent.position[2].toFixed(2)} m · y = ${agent.position[1].toFixed(2)} m`;
  $('#behavior-progress').textContent = `${agent.inspectionProgress.toFixed(2)} / ${INSPECTION_SECONDS} s`;
  $('#behavior-discarded').textContent = `${seconds(metrics.discardedInspectionSeconds)} of partial service discarded`;
  $('#behavior-ignored').textContent = seconds(metrics.holdIgnoredSeconds);
  let outcome = active(run) ? `At ${seconds(run.time)}, ${agent.action === 'idle' ? 'the assigned mission is ready' : `${PHASES[agent.action].toLowerCase()} is the applied action`}. ` : '';
  if (run.status === 'completed') outcome += `Inspection completed; the drone has returned and landed at home in ${seconds(run.time)}. `;
  else if (run.status === 'aborted') outcome += `Mission aborted: the inspection failed. Return and landing finished at ${seconds(run.time)}; recovery success does not complete the inspection. `;
  else if (run.status === 'timed-out') outcome += `The ${TIME_LIMIT} s budget expired. The drone remains at [${position(agent.position)}] m; the inspection mission is incomplete. `;
  if (metrics.holdIgnoredSeconds > 0) outcome += `The hold request was ignored for ${seconds(metrics.holdIgnoredSeconds)} of motion or service. The remembered root skipped its higher-priority condition. `;
  else if (agent.action === 'hold') outcome += 'The hold guard preempted execution. Incomplete inspection progress was discarded; release will restart that service. ';
  else if (active(run) && run.config.scenario !== 'nominal' && run.time === 7) outcome += 'The next tick samples the event at 7 s. The displayed previous input still belongs to the 6.75 s sample. ';
  else if (active(run) && run.step === 0) outcome += 'Load a case, predict the event response, then play or step.';
  $('#behavior-outcome').textContent = outcome.trim();
  $('#behavior-outcome').dataset.status = run.status === 'aborted' ? 'aborted' : metrics.holdIgnoredSeconds > 0 || run.status === 'timed-out' ? 'warning' : 'clear';
  renderFlow(); renderObservations(); view.update(run);
}
for (const [id, label] of Object.entries(METHODS)) $('#behavior-controller').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
for (const [id, label] of Object.entries(SCENARIOS)) $('#behavior-scenario').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#behavior-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.method === 'fsm' ? 'COMPARE REPRESENTATIONS' : preset.config.method === 'bt-memory' ? 'CHANGE MEMORY' : 'INSPECT EXECUTION'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-behavior-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#behavior-controller').addEventListener('change', () => start({ ...run.config, method: $('#behavior-controller').value }));
$('#behavior-scenario').addEventListener('change', () => start({ ...run.config, scenario: $('#behavior-scenario').value }));
$('#behavior-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#behavior-step').addEventListener('click', () => { stop(); stepRun(run); render(); });
$('#behavior-reset').addEventListener('click', () => start(run.config));
$('#behavior-boundary').addEventListener('click', () => { stop(); while (run.time < 7 && active(run)) stepRun(run); render(); });
$('#behavior-finish').addEventListener('click', () => { stop(); runToEnd(run); render(); });
$('#behavior-speed').addEventListener('change', () => { if (playing) schedule(); });
$('#behavior-flow').addEventListener('click', (event) => { const button = event.target.closest('[data-behavior-node]'); if (!button) return; selectedNode = button.dataset.behaviorNode; renderFlow(); });
$('#behavior-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-behavior-case]'); if (button) start(PRESETS.find((preset) => preset.id === button.dataset.behaviorCase).config); });
for (const mode of ['2d', '3d']) $(`#behavior-${mode}`).addEventListener('click', () => { view.setMode(mode); });
let comparisonsReady = false;
$('#behavior-comparisons').addEventListener('toggle', () => {
  if (!$('#behavior-comparisons').open || comparisonsReady) return;
  $('#behavior-reference-table').innerHTML = referenceComparisons().map((entry) => `<tr data-reference-case="${entry.id}"><td>${SCENARIOS[entry.scenario]}</td><td>${METHODS[entry.method]}</td><td>${entry.final.status}</td><td>${seconds(entry.final.time)}</td><td>${seconds(entry.metrics.holdIgnoredSeconds)}</td><td>${seconds(entry.metrics.discardedInspectionSeconds)}</td></tr>`).join('');
  comparisonsReady = true;
});
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config);
view.setMode(viewMode);
