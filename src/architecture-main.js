import './style.css';
import './mission.css';
import './architecture.css';
import { ARCHITECTURES, NETWORKS, NODE_NAMES, MISSION_DT, SERVICE_STEPS, CUT_STEP, RESTORE_STEP, createArchitectureRun, stepArchitecture, resetArchitecture, finishArchitecture, compareArchitectures, networkPartitioned, linkAvailable } from './architecture-model.js';
import { createMissionView } from './mission-view.js';

const $ = (selector) => document.querySelector(selector);
const names = { idle: 'Idle', travelling: 'Travelling', servicing: 'Servicing', assigned: 'Assigned', pending: 'Pending', completed: 'Completed' };
const seconds = (step) => `${(step * MISSION_DT).toFixed(1)} s`;
const taskName = (id) => id === null ? '—' : `T${id + 1}`;
const pairs = (plan) => plan.assignments.map(({ agentId, taskId }) => `A${agentId + 1} → T${taskId + 1}`).join(', ');
const descriptions = {
  central: 'C assigns all six tasks using fresh idle reports. Unreachable agents retain their reservations until C learns that their work is complete.',
  hierarchy: 'A1 assigns T1/T4 to itself. A2 assigns T2/T3/T5/T6 to A2/A3. C monitors reports. These fixed, disjoint domains constrain eligibility even when links work.',
  peers: 'Each agent independently computes nearest-pair greedy from its own delivered reports. All three current reports and matching nonempty plans are required; each peer then takes only its own target.',
};
let run = createArchitectureRun(), observer = 0, playing = false, timer = null;
const view = createMissionView($('#arch-viewport'), { selectAgent: (id) => selectObserver(id + 1) });
$('#arch-agents').innerHTML = run.agents.map(({ id }) => `<tr><th scope="row"><button data-agent="${id}" aria-pressed="false">A${id + 1}</button></th><td></td><td></td><td></td><td></td></tr>`).join('');
const agentRows = [...$('#arch-agents').children];
agentRows.forEach((row, id) => row.querySelector('button').addEventListener('click', () => selectObserver(id + 1)));
function selectObserver(node) { observer = node; render(); }
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing) return;
  timer = setTimeout(() => {
    run = stepArchitecture(run);
    if (run.status !== 'running') stop();
    render(); schedule();
  }, 1000 / Number($('#arch-speed').value));
}
function configure(architecture = $('#arch-architecture').value, network = $('#arch-network').value) {
  stop(); run = createArchitectureRun({ architecture, network });
  observer = architecture === 'peers' ? 1 : 0;
  $('#arch-architecture').value = architecture; $('#arch-network').value = network;
  render();
}
function advanceTo(step) {
  stop();
  while (run.step < step && run.status === 'running') run = stepArchitecture(run);
  render();
}
$('#arch-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#arch-step').addEventListener('click', () => { stop(); run = stepArchitecture(run); render(); });
$('#arch-reset').addEventListener('click', () => { stop(); run = resetArchitecture(run); render(); });
$('#arch-finish').addEventListener('click', () => { stop(); run = finishArchitecture(run); render(); });
$('#arch-cut').addEventListener('click', () => advanceTo(CUT_STEP));
$('#arch-restore').addEventListener('click', () => advanceTo(RESTORE_STEP));
$('#arch-speed').addEventListener('change', schedule);
$('#arch-architecture').addEventListener('change', () => configure());
$('#arch-network').addEventListener('change', () => configure());
$('#arch-observer').addEventListener('change', (event) => selectObserver(Number(event.target.value)));
for (const mode of ['2d', '3d']) $(`#arch-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const option of ['2d', '3d']) $(`#arch-${option}`).setAttribute('aria-pressed', String(option === mode));
  $('#arch-view-hint').textContent = mode === '3d'
    ? 'Drag to orbit; scroll to zoom. Whole site / Follow selected changes only the camera. Fixed display height; physical execution and the selected observer’s received knowledge remain separate.'
    : 'Select an agent to inspect its cache. Map positions do not determine the logical network links.';
});
document.querySelectorAll('[data-arch-case]').forEach((button) => button.addEventListener('click', () => {
  configure(...button.dataset.archCase.split(':'));
  $('#arch-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#arch-comparisons').addEventListener('toggle', () => {
  if (!$('#arch-comparisons').open || $('#arch-comparison-table').children.length) return;
  $('#arch-comparison-table').innerHTML = compareArchitectures().map((result) => `<tr><th scope="row">${ARCHITECTURES[result.architecture]}</th><td>${NETWORKS[result.network]}</td><td>${result.physical} / 6</td><td>${result.confirmed} / 6</td><td>${result.physicalTime === null ? 'Not reached' : `${result.physicalTime.toFixed(1)} s`}</td><td>${result.status === 'completed' ? `Confirmed at ${result.time.toFixed(1)} s` : `Budget at ${result.time.toFixed(1)} s`}</td><td>${result.traffic.report.dropped}</td></tr>`).join('');
});

function renderNetwork() {
  const container = $('#arch-network-diagram'), focusedNode = container.contains(document.activeElement) ? document.activeElement.dataset.observerNode : null;
  const points = [[50, 40], [50, 145], [245, 40], [245, 145]];
  const cut = networkPartitioned(run.initial.network, run.step);
  const links = points.flatMap(([x, y], from) => points.slice(from + 1).map(([x2, y2], offset) => {
    const active = linkAvailable(run.initial.network, run.step, from, from + offset + 1);
    return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${active ? '#698879' : '#b8b8ad'}" stroke-width="2" ${active ? '' : 'stroke-dasharray="5 5"'} data-active="${active}"/>`;
  })).join('');
  container.innerHTML = `<svg viewBox="0 0 295 185" role="group" aria-label="Logical communication network: ${cut ? 'two disconnected groups' : 'all links active'}">${links}${cut ? '<path d="M148 9V174" stroke="#b67932" stroke-dasharray="3 5"/>' : ''}${points.map(([x, y], node) => `<g role="button" tabindex="0" aria-label="Inspect ${NODE_NAMES[node]}" aria-pressed="${observer === node}" data-observer-node="${node}"><circle cx="${x}" cy="${y}" r="23" fill="${observer === node ? '#204d42' : '#f2f4ec'}" stroke="#49675b"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-family="sans-serif" fill="${observer === node ? 'white' : '#204d42'}">${NODE_NAMES[node]}</text></g>`).join('')}</svg>`;
  container.querySelectorAll('[data-observer-node]').forEach((element) => {
    const select = () => selectObserver(Number(element.dataset.observerNode));
    element.addEventListener('click', select);
    element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
  if (focusedNode !== null) container.querySelector(`[data-observer-node="${focusedNode}"]`)?.focus({ preventScroll: true });
  $('#arch-link-state').textContent = cut ? '2 disconnected groups' : 'All links active';
}
function renderCache() {
  const knowledge = run.knowledge[observer], plan = knowledge.readiness;
  $('#arch-observer').value = observer;
  $('#arch-observer-title').textContent = `${NODE_NAMES[observer]}’s report cache`;
  $('#arch-observer-role').textContent = !plan.allowed && !plan.missing.length ? 'Monitoring only: this node has no assignment authority in the selected architecture.'
    : run.initial.architecture === 'hierarchy' ? `${NODE_NAMES[observer]} coordinates its predelegated task domain and also executes work.`
      : run.initial.architecture === 'peers' ? 'Peer replica: uses its own cache and applies only its own agreed target.' : 'Central allocator: may assign any task, using fresh idle reports.';
  $('#arch-readiness').dataset.waiting = String(plan.missing.length > 0);
  $('#arch-readiness').textContent = !plan.allowed ? `${plan.reason}${plan.missing.length ? ` Missing current reports: ${plan.missing.map((id) => `A${id + 1}`).join(', ')}.` : ''}`
    : plan.assignments.length ? `${run.initial.architecture === 'peers' ? `${knowledge.agreementFrom.length} / 3 matching plans. ` : ''}Decision at ${seconds(run.step)}: ${pairs(plan)}.`
      : `${plan.reason}${plan.missing.length ? ` Stale reports excluded: ${plan.missing.map((id) => `A${id + 1}`).join(', ')}. Existing reservations remain.` : ''}`;
  $('#arch-reports').innerHTML = knowledge.reports.map((report, id) => report
    ? `<tr data-stale="${report.step !== run.step}"><th scope="row">A${id + 1}</th><td>${seconds(report.step)}</td><td>${seconds(run.step - report.step)}${report.step !== run.step ? ' · stale' : ' · fresh'}</td><td>${names[report.state]}</td><td>${taskName(report.taskId)}</td><td>(${report.position.map((value) => value.toFixed(3)).join(', ')}) m</td></tr>`
    : `<tr data-stale="true"><th scope="row">A${id + 1}</th><td colspan="5">No report received</td></tr>`).join('');
  $('#arch-last-plan').textContent = knowledge.lastDecision ? `Last nonempty plan at ${seconds(knowledge.lastDecision.step)}: ${pairs(knowledge.lastDecision)}. Selected distance sum: ${knowledge.lastDecision.assignments.reduce((sum, item) => sum + item.cost, 0).toFixed(3)} m.` : 'No nonempty plan recorded by this observer.';
  $('#arch-known-count').textContent = `${NODE_NAMES[observer]} knows ${knowledge.completed.length} / 6 completions`;
  $('#arch-task-observer').textContent = `${NODE_NAMES[observer]} knows`;
  $('#arch-tasks').innerHTML = run.tasks.map((task) => {
    const known = knowledge.completed.includes(task.id), reservation = knowledge.reservations[task.id];
    return `<tr data-unknown="${task.state === 'completed' && !known}"><th scope="row">T${task.id + 1}</th><td>${names[task.state]}</td><td>${task.owners.length ? task.owners.map((id) => `A${id + 1}`).join(', ') : '—'}</td><td>${((SERVICE_STEPS - task.serviceRemaining) * MISSION_DT).toFixed(1)} / 2.0 s</td><td>${known ? 'Completed' : reservation !== null ? `Reserved A${reservation + 1}` : 'No recorded owner'}</td></tr>`;
  }).join('');
}
function renderChart() {
  const end = Math.max(10, Math.ceil(run.step * MISSION_DT / 10) * 10);
  const x = (time) => 34 + time / end * 320, y = (count) => 162 - count * 23;
  const path = (key) => run.history.map((state, index) => `${index ? 'L' : 'M'}${x(state.time).toFixed(2)},${y(state[key])}`).join(' ');
  $('#arch-chart').innerHTML = `<svg viewBox="0 0 380 198" role="img" aria-label="Completed task counts over model time: physical execution and confirmation coverage">${[0, 2, 4, 6].map((n) => `<path d="M34 ${y(n)}H354" stroke="#e2e5db"/><text x="23" y="${y(n) + 4}" text-anchor="end" font-size="12" fill="#58675c">${n}</text>`).join('')}<path d="${path('physical')}" stroke="#217761" stroke-width="3" fill="none"/><path d="${path('confirmed')}" stroke="#a87940" stroke-width="2.5" stroke-dasharray="6 4" fill="none"/><text x="34" y="185" font-size="12" fill="#58675c">0 s</text><text x="354" y="185" text-anchor="end" font-size="12" fill="#58675c">${end} s</text></svg>`;
}
function eventText(event) {
  if (event.type === 'partition') return 'Links cut: {C, A1} and {A2, A3}. No executor failed.';
  if (event.type === 'restored') return 'Links restored. Current reports carry earlier completion history.';
  const agent = `A${event.agentId + 1}`, task = taskName(event.taskId);
  if (event.type === 'assigned') return `${event.source} assigned ${task} to ${agent}.`;
  if (event.type === 'arrived') return `${agent} reached ${task}; service begins next interval.`;
  return `${agent} completed ${task}.`;
}
function render() {
  const state = run.history.at(-1), terminal = run.status !== 'running';
  $('#arch-status').textContent = terminal ? run.status === 'completed' ? 'Completed & confirmed' : 'Budget exhausted' : playing ? 'Playing' : 'Paused';
  $('#arch-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#arch-${id}`).disabled = terminal;
  $('#arch-cut').disabled = terminal || run.step >= CUT_STEP;
  $('#arch-restore').disabled = terminal || run.step >= RESTORE_STEP;
  $('#arch-physical').textContent = `${state.physical} / 6`;
  $('#arch-physical-time').textContent = run.firstPhysicalStep === null ? 'Evaluator truth · full service required' : `All work executed at ${seconds(run.firstPhysicalStep)}`;
  $('#arch-confirmed').textContent = `${state.confirmed} / 6`;
  $('#arch-confirmation-rule').textContent = run.initial.architecture === 'peers' ? 'Minimum known count across A1, A2, A3' : 'Completed tasks known to C';
  $('#arch-time').textContent = seconds(run.step); $('#arch-step-count').textContent = run.step;
  const traffic = Object.values(run.traffic);
  $('#arch-messages').textContent = `${traffic.reduce((sum, item) => sum + item.delivered, 0)} / ${traffic.reduce((sum, item) => sum + item.dropped, 0)}`;
  $('#arch-traffic').innerHTML = '<p class="mission-small">Packets: delivered / dropped (attempted)</p>' + Object.entries(run.traffic).map(([kind, count]) => `<div><span>${{ report: 'Status reports', proposal: 'Peer proposals', command: 'Remote commands' }[kind]}</span><span>${count.delivered} / ${count.dropped} (${count.attempted})</span></div>`).join('');
  $('#arch-authority-title').textContent = ARCHITECTURES[run.initial.architecture];
  $('#arch-authority-description').textContent = descriptions[run.initial.architecture];
  $('#arch-outcome').dataset.status = run.status;
  $('#arch-outcome').textContent = run.status === 'completed' ? 'All six tasks were fully executed and the required observers have learned all six completions.'
    : run.status === 'budget' ? `60 s budget exhausted. ${state.physical === 6 ? 'All work is physically complete, but' : `Only ${state.physical} of 6 tasks finished;`} confirmation coverage is ${state.confirmed} / 6. Stale reports do not establish an agent failure.`
      : state.physical === 6 ? 'All work is physically complete. Waiting for the required observers to learn the remaining completions.'
        : networkPartitioned(run.initial.network, run.step) ? 'Links are cut. Accepted work continues; new assignments depend on delivered reports and decision rights.'
          : `${playing ? 'Running' : 'Paused'}. Reports are sampled before new commands: a fresh idle report may already have led to a travelling executor.`;
  agentRows.forEach((row, id) => {
    const agent = run.agents[id], cells = row.querySelectorAll('td');
    row.querySelector('button').setAttribute('aria-pressed', String(observer === id + 1));
    cells[0].textContent = names[agent.state]; cells[1].textContent = taskName(agent.taskId);
    for (let axis = 0; axis < 2; axis += 1) { cells[axis + 2].textContent = agent.position[axis].toFixed(4); cells[axis + 2].dataset.rawValue = agent.position[axis]; }
  });
  $('#arch-events').innerHTML = run.events.slice(-30).map((event) => `<li data-event="${event.type}" data-step="${event.step}"><time>${seconds(event.step)}</time>${eventText(event)}</li>`).join('');
  renderNetwork(); renderCache(); renderChart(); view.update(run, observer === 0 ? null : observer - 1);
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
render();
