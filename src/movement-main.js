import './style.css';
import './movement.css';
import {
  DT, GOAL_RADIUS, DEFAULT_GAINS, MOVEMENT_SCENARIOS, STARTS,
  createMovementRun, stepMovement, resetMovement, finishMovement,
  observeMovement, movementCommand, compareMovement,
} from './movement-model.js';
import { createMovementView } from './movement-view.js';

const $ = (selector) => document.querySelector(selector);
let run = createMovementRun();
let playing = false;
let timer = null;
let selectedAgent = 0;
const outcomes = { arrived: 'Arrived', stalled: 'Stalled', collision: 'Collision', budget: 'Budget exhausted' };
const format = (value, digits = 3) => value !== 0 && Math.abs(value) < 10 ** -digits
  ? value.toExponential(2) : value.toFixed(digits);
const vector = (value) => `(${format(value[0])}, ${format(value[1])})`;
const gains = ['attraction', 'obstacle', 'separation'];
const rows = STARTS.map((_, index) => {
  const row = document.createElement('tr');
  row.innerHTML = `<th scope="row"><button aria-label="Inspect movement agent A${index + 1}">A${index + 1}</button></th><td data-position-x="${index}"></td><td data-position-y="${index}"></td><td></td><td></td><td></td>`;
  row.querySelector('button').addEventListener('click', () => selectAgent(index));
  $('#movement-table').append(row);
  return row;
});
const view = createMovementView($('#movement-viewport'), { selectAgent });
function selectAgent(index) { selectedAgent = index; render(); }
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'running') return;
  // Playback only schedules complete model steps. Rendering speed and elapsed
  // wall time never change DT or the sequence of numerical transitions.
  timer = setTimeout(() => {
    if (!playing) return;
    run = stepMovement(run);
    if (run.status !== 'running') stop();
    render();
    if (playing) schedule();
  }, 1000 / Number($('#movement-speed').value));
}
function showDraftGains() {
  for (const key of gains) $(`#${key}-output`).value = Number($(`#gain-${key}`).value).toFixed(key === 'separation' ? 3 : 2);
}
function syncInputs() {
  $('#movement-preset').value = run.initial.preset;
  for (const key of gains) $(`#gain-${key}`).value = run.gains[key];
  showDraftGains();
}
function configure(options) {
  const next = createMovementRun(options);
  stop(); run = next; syncInputs(); render();
}
$('#movement-play').addEventListener('click', () => {
  if (playing) stop();
  else if (run.status === 'running') { playing = true; schedule(); }
  render();
});
$('#movement-step').addEventListener('click', () => { stop(); run = stepMovement(run); render(); });
$('#movement-reset').addEventListener('click', () => { stop(); run = resetMovement(run); syncInputs(); render(); });
$('#movement-speed').addEventListener('change', () => { if (playing) schedule(); });
$('#movement-preset').addEventListener('change', () => configure({ preset: $('#movement-preset').value, gains: run.gains }));
$('#movement-gains').addEventListener('input', showDraftGains);
$('#movement-gains').addEventListener('submit', (event) => {
  event.preventDefault();
  configure({ preset: run.initial.preset, gains: Object.fromEntries(gains.map((key) => [key, Number($(`#gain-${key}`).value)])) });
});
$('#movement-finish').addEventListener('click', () => { stop(); run = finishMovement(run); render(); });
$('#movement-agent').addEventListener('change', () => selectAgent(Number($('#movement-agent').value)));
for (const mode of ['2d', '3d']) $(`#movement-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const option of ['2d', '3d']) $(`#movement-${option}`).setAttribute('aria-pressed', String(mode === option));
  $('#movement-view-hint').textContent = mode === '3d'
    ? 'Drag to orbit · scroll to zoom. Same planar state. Inspect velocity components in the table below.'
    : 'Select an agent to inspect its decision. Arrows are capped for legibility; the table gives exact velocity components. Map distances are in metres.';
});
const guidedCases = {
  open: { preset: 'open' }, corridor: { preset: 'corridor' }, trap: { preset: 'trap' },
  'no-separation': { preset: 'open', gains: { ...DEFAULT_GAINS, separation: 0 } },
  'no-obstacles': { preset: 'trap', gains: { ...DEFAULT_GAINS, obstacle: 0 } },
};
document.querySelectorAll('[data-movement-case]').forEach((button) => button.addEventListener('click', () => {
  configure(guidedCases[button.dataset.movementCase]);
  $('#movement-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#movement-comparisons').addEventListener('toggle', () => {
  if (!$('#movement-comparisons').open || $('#movement-comparison-table').children.length) return;
  $('#movement-comparison-table').innerHTML = compareMovement().map((result) => `<tr><th scope="row">${result.label}</th><td>${outcomes[result.status]}</td><td>${result.step}</td><td>${result.time.toFixed(2)} s</td><td>${result.arrived} / 3</td><td title="${result.minimumClearance} m">${format(result.minimumClearance)} m</td></tr>`).join('');
});

function renderChart() {
  const width = 620, height = 210, left = 42, top = 14, right = 16, bottom = 36;
  const maxTime = Math.max(2, Math.ceil(run.step * DT / 2) * 2);
  const maxDistance = Math.max(9, Math.ceil(Math.max(...run.history.map((point) => point.maxGoalDistance))));
  const x = (time) => left + time / maxTime * (width - left - right);
  const y = (distance) => height - bottom - distance / maxDistance * (height - top - bottom);
  const points = run.history.map((point) => `${x(point.time)},${y(point.maxGoalDistance)}`).join(' ');
  $('#movement-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Farthest agent distance from the goal over ${format(run.step * DT, 2)} simulated seconds">
    ${[0, 0.5, 1].map((fraction) => `<line x1="${left}" x2="${width - right}" y1="${y(maxDistance * fraction)}" y2="${y(maxDistance * fraction)}" stroke="#e0e5e2"/><text x="${left - 9}" y="${y(maxDistance * fraction) + 4}" text-anchor="end">${(maxDistance * fraction).toFixed(1)}</text>`).join('')}
    <line x1="${left}" x2="${width - right}" y1="${y(GOAL_RADIUS)}" y2="${y(GOAL_RADIUS)}" stroke="#b7804c" stroke-dasharray="5 4"/>
    <polyline points="${points}" fill="none" stroke="#167963" stroke-width="2.5"/>
    <circle cx="${x(run.step * DT)}" cy="${y(run.history.at(-1).maxGoalDistance)}" r="3" fill="#167963"/>
    ${[0, 0.5, 1].map((fraction) => `<text x="${x(maxTime * fraction)}" y="${height - 14}" text-anchor="middle">${(maxTime * fraction).toFixed(0)} s</text>`).join('')}
    </svg>`;
}
function renderInspection() {
  const observation = observeMovement(run, selectedAgent);
  $('#movement-agent').value = selectedAgent;
  $('#movement-selected-name').textContent = `A${selectedAgent + 1}`;
  if (run.status === 'collision') {
    $('#movement-vectors').innerHTML = '<div><dt>Command stopped</dt><dd>Repulsion is undefined at contact.</dd></div>';
  } else {
    const command = movementCommand(observation, run.gains);
    $('#movement-vectors').innerHTML = [
      ['Goal attraction', command.attraction], ['Wall repulsion', command.obstacle],
      ['Agent separation', command.separation], ['Sum before cap', command.raw], ['Capped velocity', command.velocity],
    ].map(([label, values]) => `<div><dt>${label}</dt><dd title="${values.join(', ')} m/s">${vector(values)} m/s</dd></div>`).join('');
  }
  const peers = observation.neighbors.map((peer) => `A${peer.index + 1}`).join(', ') || 'none';
  $('#movement-inputs').textContent = `Inputs: own position, goal, known map (${observation.walls.length} walls), sensed peers: ${peers}. Components use the current state${run.status !== 'running' ? '; the run has stopped and no next command is applied' : ' to predict the next step'}.`;
}
function render() {
  const state = run.history.at(-1);
  const terminal = run.status !== 'running';
  $('#movement-status').textContent = outcomes[run.status] || (playing ? 'Playing' : 'Paused');
  $('#movement-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#movement-${id}`).disabled = terminal;
  $('#movement-map-name').textContent = MOVEMENT_SCENARIOS[run.initial.preset].label;
  $('#movement-time').textContent = `${state.time.toFixed(2)} s`;
  $('#movement-step-count').textContent = run.step;
  $('#movement-arrived').textContent = `${state.arrived} / 3`;
  $('#movement-distance').textContent = `${format(state.maxGoalDistance)} m`;
  $('#movement-clearance').textContent = `${format(run.minimumClearance)} m`;
  $('#movement-clearance').title = `${run.minimumClearance} m; contact is clearance ≤ 0`;
  $('#movement-outcome').dataset.outcome = run.status;
  const messages = {
    arrived: 'Arrived: all three centres are inside the goal region, with no swept contact during this run.',
    stalled: 'Stalled before arrival: speeds remained below 0.005 m/s for 100 updates, with less than 0.01 m change in the farthest goal distance. Inspect the cancelling vectors.',
    collision: 'Collision: swept surface clearance reached zero or became negative. Motion stops at the end of the first update containing contact; this run did not succeed.',
    budget: 'Budget exhausted: the run reached 2,000 updates without arrival, swept contact, or the measured stall criterion.',
  };
  $('#movement-outcome').textContent = messages[run.status] || (playing
    ? 'Running. Playback controls how often fixed 0.02 s model updates are requested; actual display speed depends on this device.'
    : 'Paused. Predict the next move, then advance one model step. Arrival requires all three centres inside the goal region.');
  rows.forEach((row, index) => {
    const cells = row.querySelectorAll('td');
    for (let axis = 0; axis < 2; axis += 1) {
      cells[axis].textContent = format(run.positions[index][axis], 4);
      cells[axis].dataset.rawValue = run.positions[index][axis];
    }
    cells[2].textContent = `${format(state.goalDistances[index])} m`;
    cells[3].textContent = `${format(run.pathLengths[index])} m`;
    cells[4].textContent = state.goalDistances[index] <= GOAL_RADIUS ? 'Yes' : 'No';
    row.querySelector('button').setAttribute('aria-pressed', String(index === selectedAgent));
  });
  renderChart(); renderInspection(); view.update(run, selectedAgent);
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
// A back/forward-cache restore must recreate the disposed view and listeners.
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
syncInputs(); render();
