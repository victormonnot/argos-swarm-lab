import './style.css';
import './mission.css';
import './pathfinding.css';
import { PATH_MAPS, PATH_METHODS, PATH_DT, createPathRun, stepPath, resetPath, finishPath, comparePaths, cellXY, manhattan, pathExecutorObservation } from './pathfinding-model.js';
import { createPathfindingView } from './pathfinding-view.js';

const $ = (selector) => document.querySelector(selector);
const names = { following: 'Following route', reached: 'Goal reached', collision: 'Collision', 'no-path': 'No path', budget: 'Budget exhausted' };
const descriptions = {
  astar: 'A* ranks frontier cells by f = g + h. Manhattan h is a consistent lower bound on this four-neighbor grid.',
  dijkstra: 'Dijkstra sets h = 0 and expands the smallest discovered distance g. It solves the same graph objective as A*.',
  direct: 'No obstacle planning: pass the goal as the only waypoint. The follower has no avoidance controller; the evaluator will report contact.',
};
const metres = (value) => value === null ? 'No route' : `${value.toFixed(1)} m`;
const coordinates = (point) => `(${point.map((value) => value.toFixed(1)).join(', ')}) m`;
let run = createPathRun(), playing = false, timer = null, selectedCell = run.grid.start, traceIndex = run.plan.expanded;
const view = createPathfindingView($('#path-viewport'), { selectCell: (id) => { selectedCell = id; render(); } });
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'following') return;
  timer = setTimeout(() => {
    run = stepPath(run); if (run.status !== 'following') stop(); render(); schedule();
  }, 1000 / Number($('#path-speed').value));
}
function syncInputs() {
  $('#path-planner').value = run.initial.method; $('#path-map').value = run.initial.map;
  $('#path-cell').innerHTML = Array.from({ length: run.grid.width * run.grid.height }, (_, id) => `<option value="${id}">(${cellXY(id, run.grid.width).join(', ')}) · ${run.grid.blocked.includes(id) ? 'wall' : 'free'}</option>`).join('');
}
function configure(method = $('#path-planner').value, map = $('#path-map').value) {
  stop(); run = createPathRun({ method, map }); selectedCell = run.grid.start; traceIndex = run.plan.expanded; syncInputs(); render();
}
$('#path-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#path-step').addEventListener('click', () => { stop(); run = stepPath(run); render(); });
$('#path-reset').addEventListener('click', () => { stop(); run = resetPath(run); traceIndex = run.plan.expanded; syncInputs(); render(); });
$('#path-finish').addEventListener('click', () => { stop(); run = finishPath(run); render(); });
$('#path-speed').addEventListener('change', schedule);
$('#path-planner').addEventListener('change', () => configure());
$('#path-map').addEventListener('change', () => configure());
$('#path-cell').addEventListener('change', (event) => { selectedCell = Number(event.target.value); render(); });
$('#path-trace').addEventListener('input', (event) => { traceIndex = Number(event.target.value); render(); });
$('#path-show-search').addEventListener('change', render);
for (const [id, value] of [['first', () => 0], ['prev', () => traceIndex - 1], ['next', () => traceIndex + 1], ['last', () => run.plan.expanded]]) {
  $(`#path-trace-${id}`).addEventListener('click', () => { traceIndex = Math.max(0, Math.min(run.plan.expanded, value())); render(); });
}
for (const mode of ['2d', '3d']) $(`#path-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const option of ['2d', '3d']) $(`#path-${option}`).setAttribute('aria-pressed', String(option === mode));
  $('#path-view-hint').textContent = mode === '3d' ? 'Drag to orbit; scroll to zoom. W: next waypoint. Wall heights and robot size are illustrative. Same planar route, motion and search snapshot.'
    : 'S: start · G: goal · A: robot. Select a cell to inspect search costs. Robot marker size is illustrative; this is point motion.';
});
document.querySelectorAll('[data-path-case]').forEach((button) => button.addEventListener('click', () => {
  configure(...button.dataset.pathCase.split(':')); $('#path-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#path-comparisons').addEventListener('toggle', () => {
  if (!$('#path-comparisons').open || $('#path-comparison-table').children.length) return;
  $('#path-comparison-table').innerHTML = comparePaths().map((result) => `<tr><th scope="row">${PATH_MAPS[result.map]}</th><td>${PATH_METHODS[result.method]}</td><td>${names[result.status]}</td><td>${metres(result.plannedLength)}${result.method === 'direct' ? ' (unchecked)' : ''}</td><td>${metres(result.travelled)}</td><td>${result.time.toFixed(1)} s</td><td>${result.expanded}</td></tr>`).join('');
});
function renderSearch() {
  const plan = run.plan, snapshot = plan.trace[traceIndex], direct = run.initial.method === 'direct';
  $('#path-search-summary').textContent = direct ? 'No graph search. The goal segment is unchecked for obstacles.'
    : `${PATH_METHODS[run.initial.method]}: ${plan.expanded} total pops. ${plan.status === 'found' ? `Shortest graph route: ${plan.cost} m.` : 'Frontier exhausted; goal unreachable in this graph.'}`;
  $('#path-trace').max = plan.expanded; $('#path-trace').value = traceIndex;
  $('#path-trace-count').textContent = `${traceIndex} / ${plan.expanded}`;
  $('#path-trace').disabled = direct; $('#path-show-search').disabled = direct;
  for (const id of ['first', 'prev']) $(`#path-trace-${id}`).disabled = direct || traceIndex === 0;
  for (const id of ['next', 'last']) $(`#path-trace-${id}`).disabled = direct || traceIndex === plan.expanded;
  $('#path-frontier').textContent = snapshot ? `${snapshot.open.length} frontier · ${snapshot.closed.length} settled · ${snapshot.current === null ? 'No cell popped yet' : `Current cell (${cellXY(snapshot.current, run.grid.width).join(', ')})`}. Final route is shown separately.` : 'Search controls do not apply to the direct baseline.';
  const blocked = run.grid.blocked.includes(selectedCell), known = snapshot?.g[selectedCell] !== null && snapshot?.g[selectedCell] !== undefined;
  const h = run.initial.method === 'astar' ? manhattan(selectedCell, run.grid.goal, run.grid.width) : 0;
  const state = blocked ? 'Wall · outside graph' : direct ? 'No search' : snapshot.current === selectedCell ? 'Current pop' : snapshot.closed.includes(selectedCell) ? 'Settled' : snapshot.open.includes(selectedCell) ? 'Frontier' : 'Undiscovered';
  const gValue = blocked || direct ? '—' : known ? `${snapshot.g[selectedCell]} m` : 'Unknown';
  $('#path-cell').value = selectedCell;
  $('#path-cell-details').innerHTML = [
    ['Cell / ID', `(${cellXY(selectedCell, run.grid.width).join(', ')}) / ${selectedCell}`],
    ['Search state', state], ['g · discovered cost', gValue],
    ['h · lower bound', blocked || direct ? '—' : `${h} m`],
    ['f · g + h', blocked || direct ? '—' : known ? `${snapshot.g[selectedCell] + h} m` : 'Unknown'],
    ['Predecessor', snapshot?.parents[selectedCell] === null || snapshot?.parents[selectedCell] === undefined ? '—' : `(${cellXY(snapshot.parents[selectedCell], run.grid.width).join(', ')})`],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
}
function renderChart() {
  const end = Math.max(10, Math.ceil(run.step * PATH_DT / 10) * 10), top = Math.max(8, Math.ceil(Math.max(...run.history.map((point) => point.goalDistance)) / 2) * 2);
  const x = (time) => 37 + time / end * 345, y = (distance) => 152 - distance / top * 125;
  const path = run.history.map((point, id) => `${id ? 'L' : 'M'}${x(point.time).toFixed(2)},${y(point.goalDistance).toFixed(2)}`).join(' ');
  $('#path-chart').innerHTML = `<svg viewBox="0 0 410 190" role="img" aria-label="Euclidean distance to goal over motion time"><text x="37" y="15" font-size="12" fill="#58675c">Distance to goal (m)</text>${[0, top / 2, top].map((value) => `<path d="M37 ${y(value)}H382" stroke="#e2e5db"/><text x="27" y="${y(value) + 4}" text-anchor="end" font-size="12" fill="#58675c">${value}</text>`).join('')}<path d="${path}" stroke="#217761" stroke-width="2.5" fill="none"/><text x="37" y="177" font-size="12" fill="#58675c">0 s</text><text x="382" y="177" text-anchor="end" font-size="12" fill="#58675c">${end} s</text></svg>`;
}
function render() {
  const terminal = run.status !== 'following', state = run.history.at(-1), observation = pathExecutorObservation(run);
  $('#path-status').textContent = terminal ? names[run.status] : playing ? 'Playing' : 'Paused';
  $('#path-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#path-${id}`).disabled = terminal;
  $('#path-map-title').textContent = PATH_MAPS[run.initial.map];
  $('#path-planner-description').textContent = descriptions[run.initial.method];
  $('#path-length').textContent = metres(run.plan.length);
  $('#path-length-note').textContent = run.initial.method === 'direct' ? 'Straight goal segment · unchecked' : 'Shortest four-neighbor grid route';
  $('#path-travelled').textContent = metres(run.distance); $('#path-goal-distance').textContent = metres(state.goalDistance);
  $('#path-time').textContent = `${state.time.toFixed(1)} s`; $('#path-step-count').textContent = run.step;
  $('#path-outcome').dataset.status = run.status;
  $('#path-outcome').textContent = run.status === 'reached' ? 'Goal reached: the robot executed its route and arrived without contacting a wall.'
    : run.status === 'collision' ? `Collision with cell (${cellXY(run.contact.cell, run.grid.width).join(', ')}). The evaluator stopped at first contact; the follower has no obstacle avoidance. Time is the end of this motion interval.`
      : run.status === 'no-path' ? 'No path in the known grid: search exhausted the reachable component. The robot remains at its start; this is not arrival.'
        : run.status === 'budget' ? '40 s motion budget exhausted before arrival.'
          : run.initial.method === 'direct' ? 'The follower has only the goal waypoint. This segment has not been planned around obstacles.'
            : 'A shortest graph route was found before motion. The robot must still follow its waypoints to reach the goal.';
  $('#path-executor-state').textContent = names[run.status];
  $('#path-waypoint').textContent = observation.waypoint ? `${run.waypointIndex + 1} / ${run.plan.waypoints.length} · ${coordinates(observation.waypoint)}` : 'None';
  for (const [axis, id] of [[0, 'x'], [1, 'y']]) { $(`#path-${id}`).textContent = `${run.position[axis].toFixed(4)} m`; $(`#path-${id}`).dataset.rawValue = run.position[axis]; }
  $('#path-waypoints').innerHTML = run.plan.waypoints.length ? run.plan.waypoints.map((point, index) => `<li aria-current="${index === run.waypointIndex ? 'step' : 'false'}">${coordinates(point)}${index < run.waypointIndex ? ' · reached' : index === run.waypointIndex ? ' · target' : ''}</li>`).join('') : '<li>No route; no waypoint supplied.</li>';
  renderSearch(); renderChart(); view.update(run, { traceIndex, selectedCell, showSearch: $('#path-show-search').checked });
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
syncInputs(); render();
