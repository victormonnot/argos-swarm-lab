import './style.css';
import './mission.css';
import './localization.css';
import { ESTIMATORS, FIX_SCHEDULES, LOCAL_MAPS, LOCAL_DT, FIX_LOSS_STEP, FIX_RETURN_STEP, createLocalizationRun, stepLocalization, resetLocalization, finishLocalization, compareLocalization, compareLocalizationSeeds } from './localization-model.js';
import { createLocalizationView } from './localization-view.js';

const $ = (selector) => document.querySelector(selector);
const names = { following: 'Following route', arrived: 'Arrival verified', 'false-arrival': 'False arrival', collision: 'Collision', budget: 'Budget exhausted' };
const descriptions = {
  exact: 'Privileged oracle: the controller receives exact simulator position. Sensors are shown but not used to estimate position.',
  dead: 'Integrate noisy displacement readings. Absolute fixes are deliberately ignored; no covariance is computed for this baseline.',
  kalman: 'Predict position from measured displacement; correct only with a new absolute fix. The two-state filter does not estimate the fixed bias.',
};
const metres = (value) => `${value.toFixed(3)} m`;
const point = (values) => `(${values.map((value) => value.toFixed(3)).join(', ')}) m`;
const seconds = (step) => `${(step * LOCAL_DT).toFixed(1)} s`;
let run = createLocalizationRun(), playing = false, timer = null;
const view = createLocalizationView($('#loc-viewport'));
$('#loc-positions').innerHTML = ['x', 'y'].map((axis) => `<tr><th scope="row">${axis}</th><td></td><td></td><td></td><td></td></tr>`).join('');
const positionRows = [...$('#loc-positions').children];
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'following') return;
  timer = setTimeout(() => { run = stepLocalization(run); if (run.status !== 'following') stop(); render(); schedule(); }, 1000 / Number($('#loc-speed').value));
}
function syncInputs() {
  $('#loc-estimator').value = run.initial.estimator; $('#loc-schedule').value = run.initial.schedule;
  $('#loc-map').value = run.initial.map; $('#loc-bias').checked = run.initial.bias; $('#loc-seed').value = run.initial.seed; $('#loc-seed-error').textContent = '';
}
function configure(changes = {}) {
  stop(); run = createLocalizationRun({ ...run.initial, ...changes }); syncInputs(); render();
}
function advanceTo(step) { stop(); while (run.step < step && run.status === 'following') run = stepLocalization(run); render(); }
$('#loc-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#loc-step').addEventListener('click', () => { stop(); run = stepLocalization(run); render(); });
$('#loc-reset').addEventListener('click', () => { stop(); run = resetLocalization(run); syncInputs(); render(); });
$('#loc-finish').addEventListener('click', () => { stop(); run = finishLocalization(run); render(); });
$('#loc-loss').addEventListener('click', () => advanceTo(FIX_LOSS_STEP));
$('#loc-return').addEventListener('click', () => advanceTo(FIX_RETURN_STEP));
$('#loc-speed').addEventListener('change', schedule);
$('#loc-estimator').addEventListener('change', (event) => configure({ estimator: event.target.value }));
$('#loc-schedule').addEventListener('change', (event) => configure({ schedule: event.target.value }));
$('#loc-map').addEventListener('change', (event) => configure({ map: event.target.value }));
$('#loc-bias').addEventListener('change', (event) => configure({ bias: event.target.checked }));
$('#loc-axis').addEventListener('change', render);
$('#loc-seed-form').addEventListener('submit', (event) => {
  event.preventDefault(); const seed = Number($('#loc-seed').value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 1000000) { $('#loc-seed-error').textContent = 'Enter an integer seed from 1 to 1000000.'; return; }
  configure({ seed });
});
for (const mode of ['2d', '3d']) $(`#loc-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const option of ['2d', '3d']) $(`#loc-${option}`).setAttribute('aria-pressed', String(option === mode));
  $('#loc-view-hint').textContent = mode === '3d'
    ? 'Drag to orbit; scroll to zoom. Same planar truth, estimate and history. Wall/marker heights are decorative; the 2σ contour is assumed uncertainty, not a safety guarantee.'
    : 'The controller uses E. The learner can also see T. The contour has 2σ semiaxes from assumed covariance; it is not a safety or 95% coverage guarantee.';
});
document.querySelectorAll('[data-loc-case]').forEach((button) => button.addEventListener('click', () => {
  const [estimator, schedule] = button.dataset.locCase.split(':'); configure({ estimator, schedule, map: 'u', seed: 1, bias: true });
  $('#loc-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#loc-unbiased').addEventListener('click', () => { configure({ estimator: 'kalman', schedule: 'steady', map: 'u', seed: 1, bias: false }); $('#loc-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#loc-comparisons').addEventListener('toggle', () => {
  if (!$('#loc-comparisons').open || $('#loc-reference-table').children.length) return;
  const label = (row) => `${LOCAL_MAPS[row.map]}<br>${ESTIMATORS[row.estimator]}<br>${FIX_SCHEDULES[row.schedule]}`;
  $('#loc-reference-table').innerHTML = compareLocalization().map((row) => `<tr><th scope="row">${label(row)}</th><td>${names[row.status]}</td><td>${row.time.toFixed(1)} s</td><td>${metres(row.actualGoalDistance)}</td><td>${metres(row.estimatedGoalDistance)}</td><td>${metres(row.rmsError)}</td></tr>`).join('');
  $('#loc-seed-table').innerHTML = compareLocalizationSeeds().groups.map((row) => `<tr><th scope="row">${label(row)}</th><td>${row.outcomes.arrived} / 20</td><td>${row.outcomes['false-arrival']} / 20</td><td>${row.outcomes.collision} / ${row.outcomes.budget}</td><td>${metres(row.meanRmsError)}</td></tr>`).join('');
});
function renderUpdate() {
  const update = run.lastUpdate, axis = Number($('#loc-axis').value), kalman = run.initial.estimator === 'kalman';
  $('#loc-update-kind').textContent = !update ? 'Exact initial position supplied; no sensor update yet.'
    : update.type === 'correct' ? `Predict + correct at ${seconds(run.step)}. A new absolute fix was used.`
      : update.type === 'predict' ? `Prediction only at ${seconds(run.step)}. No absolute fix at this boundary.`
        : update.type === 'integrate' ? 'Dead reckoning: integrate odometry. Any absolute fix is ignored.' : 'Oracle reference: exact physical position supplied. No sensor fusion.';
  const scalar = (value, unit = 'm') => value === null || value === undefined ? '—' : `${value.toFixed(unit === 'm²' ? 6 : 4)}${unit ? ` ${unit}` : ''}`;
  const predicted = update?.predicted, previous = update ? run.history.at(-2).estimate[axis] : run.estimate[axis];
  const rows = [
    ['Measured displacement', scalar(update?.odometry[axis])],
    ['Prior estimate', scalar(previous)],
    ['Predicted estimate', scalar(predicted?.estimate[axis])],
    ['Predicted P', scalar(predicted?.covariance[axis], 'm²')],
    ['Absolute fix this boundary', scalar(update?.measurement?.[axis])],
    ['Innovation · z − prediction', scalar(update?.innovation?.[axis])],
    ['Kalman gain K', scalar(update?.gain?.[axis], '')],
    ['Current estimate', scalar(run.estimate[axis])],
    ['Current P', scalar(kalman ? run.covariance[axis] : null, 'm²')],
  ];
  $('#loc-update').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
}
function renderChart() {
  const kalman = run.initial.estimator === 'kalman', end = Math.max(10, Math.ceil(run.step * LOCAL_DT / 10) * 10);
  const scale = (sample) => sample.covariance ? 2 * Math.sqrt(sample.covariance[0] + sample.covariance[1]) : 0;
  const max = Math.max(.5, Math.ceil(Math.max(...run.history.flatMap((sample) => [sample.error, scale(sample)])) * 2) / 2);
  const X = (time) => 42 + time / end * 350, Y = (value) => 166 - value / max * 135;
  const path = (get) => run.history.map((sample, index) => `${index ? 'L' : 'M'}${X(sample.time).toFixed(2)},${Y(get(sample)).toFixed(2)}`).join(' ');
  $('#loc-chart').innerHTML = `<svg viewBox="0 0 420 205" role="img" aria-label="Actual estimation error and assumed uncertainty scale over time"><text x="42" y="17" font-size="12" fill="#58675c">Position error / assumed scale (m)</text>${[0, max / 2, max].map((value) => `<path d="M42 ${Y(value)}H392" stroke="#e2e5db"/><text x="32" y="${Y(value) + 4}" text-anchor="end" font-size="12" fill="#58675c">${value.toFixed(2)}</text>`).join('')}<path d="${path((sample) => sample.error)}" stroke="#217761" stroke-width="2.5" fill="none"/>${kalman ? `<path d="${path(scale)}" stroke="#9578ad" stroke-width="2" stroke-dasharray="6 4" fill="none"/>` : ''}<text x="42" y="192" font-size="12" fill="#58675c">0 s</text><text x="392" y="192" text-anchor="end" font-size="12" fill="#58675c">${end} s</text></svg>`;
  $('.loc-chart-legend span:last-child').hidden = !kalman;
}
function render() {
  const terminal = run.status !== 'following', last = run.history.at(-1);
  $('#loc-status').textContent = terminal ? names[run.status] : playing ? 'Playing' : 'Paused';
  $('#loc-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#loc-${id}`).disabled = terminal;
  $('#loc-loss').disabled = terminal || run.step >= FIX_LOSS_STEP; $('#loc-return').disabled = terminal || run.step >= FIX_RETURN_STEP;
  $('#loc-description').textContent = descriptions[run.initial.estimator];
  $('#loc-error').textContent = metres(last.error); $('#loc-actual-goal').textContent = metres(last.actualGoalDistance); $('#loc-estimated-goal').textContent = metres(last.estimatedGoalDistance);
  $('#loc-time').textContent = seconds(run.step); $('#loc-step-count').textContent = run.step;
  $('#loc-outcome').dataset.status = run.status;
  $('#loc-outcome').textContent = run.status === 'arrived' ? 'Arrival verified: the controller accepted the final waypoint, and physical goal distance is within 0.25 m.'
    : run.status === 'false-arrival' ? `False arrival: the controller stopped on its estimate, but the real robot is ${metres(last.actualGoalDistance)} from the goal.${run.initial.schedule === 'recovery' && run.step < FIX_RETURN_STEP ? ' This run ended before the scheduled 8 s restoration; later fixes cannot restart it.' : ''}`
      : run.status === 'collision' ? 'Physical contact detected along the attempted segment. The evaluator ended the run; the estimator has no hidden avoidance controller.'
        : run.status === 'budget' ? 'The 40 s budget ended before a controller completion claim.'
          : 'The follower acts on its estimated position. Physical truth is shown for evaluation, not supplied to dead reckoning or the Kalman controller.';
  const streamOff = run.initial.schedule !== 'steady' && run.step >= FIX_LOSS_STEP && (run.initial.schedule !== 'recovery' || run.step < FIX_RETURN_STEP);
  $('#loc-fix-stream').textContent = terminal ? 'Run ended · no further measurements processed' : streamOff ? 'Absolute fix stream paused · odometry continues' : 'Absolute fix stream active · one reading per second';
  $('#loc-last-fix').textContent = run.lastFix ? `Last received fix Z: ${point(run.lastFix.position)}, sampled at ${seconds(run.lastFix.step)}. Age: ${seconds(run.step - run.lastFix.step)}${run.lastFix.step === run.step ? ' · fresh.' : ' · historical; not reused as a new fix.'}` : 'No absolute fix received yet. The initial position was supplied exactly.';
  $('#loc-fix-counts').textContent = `${run.fixCount} fixes received · ${run.usedFixCount} used for Kalman correction.${run.initial.estimator !== 'kalman' ? ' This position source ignores fixes.' : ''}`;
  positionRows.forEach((row, axis) => {
    const cells = row.querySelectorAll('td'), values = [run.position[axis], run.estimate[axis], run.estimate[axis] - run.position[axis]];
    values.forEach((value, index) => { cells[index].textContent = metres(value); cells[index].dataset.rawValue = value; });
    cells[3].textContent = run.covariance ? metres(Math.sqrt(run.covariance[axis])) : 'Not computed';
  });
  $('#loc-controller').textContent = run.controllerFinished ? 'Controller announced arrival' : run.status === 'following' ? 'Controller still following' : 'Evaluator stopped execution';
  $('#loc-waypoint').textContent = run.plan.waypoints[run.waypointIndex] ? `Current waypoint ${run.waypointIndex + 1} / ${run.plan.waypoints.length}: ${point(run.plan.waypoints[run.waypointIndex])}. Progress is checked against the estimate.` : 'All waypoints accepted by the controller.';
  $('#loc-distance').textContent = `Physical travel: ${metres(run.distance)}. Applied noise seed: ${run.initial.seed}. Fixed bias: ${run.initial.bias ? 'enabled' : 'disabled'}.`;
  renderUpdate(); renderChart(); view.update(run);
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
syncInputs(); render();
