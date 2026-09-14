import './style.css';
import './mission.css';
import { MISSION_DT, SERVICE_STEPS, FAILURE_STEP, POLICIES, createMissionRun, stepMission, resetMission, finishMission, executorObservation, compareMissions } from './mission-model.js';
import { createMissionView } from './mission-view.js';

const $ = (selector) => document.querySelector(selector);
const stateNames = { idle: 'Idle', travelling: 'Travelling', servicing: 'Servicing', unavailable: 'Unavailable', pending: 'Pending', assigned: 'Assigned', completed: 'Completed', blocked: 'Blocked', budget: 'Budget exhausted' };
const descriptions = {
  fixed: 'A1 owns T1/T4, A2 owns T2/T5, A3 owns T3/T6. Owners and queue order stay fixed, even after a failure.',
  greedy: 'Choose the nearest remaining agent–task pair, then repeat. Released work can receive a new owner at a later dispatch.',
  hungarian: 'Minimize the sum of current distances for idle-agent / pending-task pairs. This does not optimize the entire mission schedule.',
};
let run = createMissionRun(), playing = false, timer = null, selectedAgent = 0;
const taskCards = run.tasks.map((task) => {
  const card = document.createElement('article'); card.className = 'mission-task'; card.dataset.task = task.id;
  card.innerHTML = `<h4>T${task.id + 1}<span></span></h4><p class="task-owner"></p><progress max="${SERVICE_STEPS}" value="0" aria-label="Service completed for T${task.id + 1}"></progress><p class="task-service"></p>`;
  $('#mission-tasks').append(card); return card;
});
const agentRows = run.agents.map((agent) => {
  const row = document.createElement('tr');
  row.innerHTML = `<th scope="row"><button aria-label="Inspect mission agent A${agent.id + 1}">A${agent.id + 1}</button></th><td></td><td></td><td data-mission-x="${agent.id}"></td><td data-mission-y="${agent.id}"></td><td></td>`;
  row.querySelector('button').addEventListener('click', () => selectAgent(agent.id));
  $('#mission-agent-table').append(row); return row;
});
const view = createMissionView($('#mission-viewport'), { selectAgent });
function selectAgent(id) { selectedAgent = id; render(); }
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'running') return;
  timer = setTimeout(() => {
    if (!playing) return;
    run = stepMission(run);
    if (run.status !== 'running') stop();
    render(); if (playing) schedule();
  }, 1000 / Number($('#mission-speed').value));
}
function syncInputs() { $('#mission-policy').value = run.initial.policy; $('#mission-failure').value = run.initial.failure ? 'a2' : 'none'; }
function configure(options) { stop(); run = createMissionRun(options); syncInputs(); render(); }
$('#mission-policy').addEventListener('change', () => configure({ policy: $('#mission-policy').value, failure: run.initial.failure }));
$('#mission-failure').addEventListener('change', () => configure({ policy: run.initial.policy, failure: $('#mission-failure').value === 'a2' }));
$('#mission-play').addEventListener('click', () => { if (playing) stop(); else if (run.status === 'running') { playing = true; schedule(); } render(); });
$('#mission-step').addEventListener('click', () => { stop(); run = stepMission(run); render(); });
$('#mission-reset').addEventListener('click', () => { stop(); run = resetMission(run); syncInputs(); render(); });
$('#mission-speed').addEventListener('change', () => { if (playing) schedule(); });
$('#mission-boundary').addEventListener('click', () => {
  stop(); while (run.step < FAILURE_STEP && run.status === 'running') run = stepMission(run); render();
});
$('#mission-finish').addEventListener('click', () => { stop(); run = finishMission(run); render(); });
$('#mission-agent').addEventListener('change', () => selectAgent(Number($('#mission-agent').value)));
$('#mission-decision').addEventListener('change', renderDispatch);
for (const mode of ['2d', '3d']) $(`#mission-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const choice of ['2d', '3d']) $(`#mission-${choice}`).setAttribute('aria-pressed', String(choice === mode));
  $('#mission-view-hint').textContent = mode === '3d'
    ? 'Drag to orbit · scroll to zoom. Same planar mission; marker sizes and heights are illustrative. × unavailable · ✓ task completed.'
    : 'Circles: agents · squares: tasks · dashed line: assigned target. Select an agent to inspect its executor.';
});
document.querySelectorAll('[data-mission-case]').forEach((button) => button.addEventListener('click', () => {
  const [policy, failure] = button.dataset.missionCase.split('-');
  configure({ policy, failure: failure === 'failure' });
  $('#mission-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#mission-comparisons').addEventListener('toggle', () => {
  if (!$('#mission-comparisons').open || $('#mission-comparison-table').children.length) return;
  $('#mission-comparison-table').innerHTML = compareMissions().map((result) => `<tr><th scope="row">${POLICIES[result.policy]}</th><td>${result.failure ? 'Unavailable' : 'Available'}</td><td>${stateNames[result.status]}</td><td>${result.completed} / 6</td><td>${result.time.toFixed(1)} s</td><td>${result.totalDistance.toFixed(3)} m</td><td>${result.reassignments}</td><td>${result.lostService.toFixed(1)} s</td></tr>`).join('');
});

function renderDispatch() {
  const decision = $('#mission-decision').value === 'first' ? run.dispatches[0] : run.dispatches.at(-1);
  $('#mission-dispatch-title').textContent = `Dispatch at ${decision.time.toFixed(1)} s`;
  $('#mission-dispatch-summary').textContent = `${POLICIES[decision.policy]}: ${decision.assignments.map(({ agentId, taskId }) => `A${agentId + 1} → T${taskId + 1}`).join(', ')}. Sum of selected distances: ${decision.totalCost.toFixed(3)} m.`;
  $('#mission-costs').innerHTML = `<table><caption>${decision.policy === 'fixed' ? 'Fixed owners only; — marks an ineligible task. Queue order selects the lowest task ID for each owner.' : 'All cells are eligible. The selected pairs assign each available executor at most one next task.'}</caption><thead><tr><th>Agent</th>${decision.taskIds.map((id) => `<th>T${id + 1}</th>`).join('')}</tr></thead><tbody>${decision.agentIds.map((agentId, row) => `<tr><th scope="row">A${agentId + 1}</th>${decision.taskIds.map((taskId, column) => {
    const selected = decision.pairs.some(([a, t]) => a === row && t === column);
    const eligible = decision.policy !== 'fixed' || run.tasks[taskId].fixedOwner === agentId;
    return `<td data-selected="${selected}" data-eligible="${eligible}" title="${decision.costs[row][column]} m">${eligible ? `${selected ? '✓ ' : ''}${decision.costs[row][column].toFixed(3)}` : '—'}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}
function eventText(event) {
  const agent = `A${event.agentId + 1}`, task = `T${event.taskId + 1}`;
  if (event.type === 'assigned') return `${task} ${event.reassigned ? 'reassigned' : 'assigned'} to ${agent}.`;
  if (event.type === 'arrived') return `${agent} reached ${task}; service begins next interval.`;
  if (event.type === 'completed') return `${agent} completed ${task}.`;
  if (event.type === 'unavailable') return `${agent} unavailable${event.taskId === null ? '' : ` during ${task}`}. ${event.lostService.toFixed(1)} s service lost.`;
  if (event.type === 'released') return `${task} released to pending; ${event.eligibleForReassignment ? 'awaiting an available executor' : 'fixed ownership prevents reassignment'}.`;
  return '';
}
function render() {
  const state = run.history.at(-1), terminal = run.status !== 'running';
  $('#mission-status').textContent = terminal ? stateNames[run.status] : playing ? 'Playing' : 'Paused';
  $('#mission-map-policy').textContent = POLICIES[run.initial.policy];
  $('#mission-policy-description').textContent = descriptions[run.initial.policy];
  $('#mission-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#mission-${id}`).disabled = terminal;
  $('#mission-boundary').disabled = terminal || run.step >= FAILURE_STEP;
  $('#mission-time').textContent = `${state.time.toFixed(1)} s`; $('#mission-step-count').textContent = run.step;
  $('#mission-completed').textContent = `${state.completed} / 6`; $('#mission-available').textContent = `${state.available} / 3`;
  $('#mission-distance').textContent = `${state.distance.toFixed(3)} m`;
  $('#mission-reassignments').textContent = run.reassignments; $('#mission-lost-service').textContent = `${run.lostService.toFixed(1)} s`;
  const unfinished = run.tasks.filter((task) => task.state !== 'completed').map((task) => `T${task.id + 1}`).join(', ');
  $('#mission-outcome').dataset.status = run.status;
  $('#mission-outcome').textContent = run.status === 'completed'
    ? 'Mission completed: all six tasks finished their full service, including any recovered work.'
    : run.status === 'blocked' ? `Blocked: ${unfinished} remain unfinished. No eligible assignment or execution can proceed. Available agents alone do not establish mission success.`
      : run.status === 'budget' ? `Budget exhausted: ${unfinished} remain unfinished after 60 model seconds.`
        : run.failureApplied ? 'A2 is unavailable. Completed work is retained; interrupted service restarts. Watch the remaining owners and available executors.'
          : `${playing ? 'Running' : 'Paused'}. Targets are assigned, but a task only counts after arrival and 2.0 s of service.${run.initial.failure ? ' A2 will become unavailable at 5.0 s; the allocator has no advance warning.' : ''}`;
  run.tasks.forEach((task, id) => {
    const card = taskCards[id], stranded = task.state === 'pending' && run.initial.policy === 'fixed' && run.agents[task.fixedOwner].state === 'unavailable';
    card.dataset.state = task.state; card.dataset.stranded = stranded;
    card.querySelector('h4 span').textContent = stranded ? 'Stranded' : stateNames[task.state];
    card.querySelector('.task-owner').textContent = task.state === 'completed' ? `Completed by A${task.completedBy + 1}`
      : task.owner !== null ? `Owner: A${task.owner + 1}` : run.initial.policy === 'fixed' ? `Reserved for A${task.fixedOwner + 1}${stranded ? ' · unavailable' : ''}` : 'No owner · awaiting dispatch';
    card.querySelector('progress').value = SERVICE_STEPS - task.serviceRemaining;
    card.querySelector('.task-service').textContent = `Service: ${((SERVICE_STEPS - task.serviceRemaining) * MISSION_DT).toFixed(1)} / 2.0 s`;
  });
  agentRows.forEach((row, id) => {
    const agent = run.agents[id], cells = row.querySelectorAll('td');
    cells[0].textContent = stateNames[agent.state]; cells[1].textContent = agent.taskId === null ? '—' : `T${agent.taskId + 1}`;
    for (let axis = 0; axis < 2; axis += 1) { cells[axis + 2].textContent = agent.position[axis].toFixed(4); cells[axis + 2].dataset.rawValue = agent.position[axis]; }
    cells[4].textContent = `${agent.distance.toFixed(3)} m`; row.querySelector('button').setAttribute('aria-pressed', String(id === selectedAgent));
  });
  const observation = executorObservation(run, selectedAgent);
  $('#mission-agent').value = selectedAgent; $('#mission-agent-name').textContent = `A${selectedAgent + 1}`;
  $('#mission-fsm').querySelectorAll('li').forEach((item) => item.setAttribute('aria-current', item.dataset.state === observation.state ? 'step' : 'false'));
  $('#mission-agent-details').innerHTML = [
    ['Current state', stateNames[observation.state]],
    ['Own position', `(${observation.position.map((value) => value.toFixed(3)).join(', ')}) m`],
    ['Assigned task', observation.task ? `T${observation.task.id + 1} at (${observation.task.position.join(', ')}) m` : 'None'],
    ['Service remaining', observation.task ? `${(observation.task.serviceRemaining * MISSION_DT).toFixed(1)} s` : '—'],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  $('#mission-events').innerHTML = run.events.slice(-30).map((event) => `<li data-event="${event.type}" data-step="${event.step}"><time>${event.time.toFixed(1)} s</time>${eventText(event)}</li>`).join('');
  renderDispatch(); view.update(run, selectedAgent);
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
syncInputs(); render();
