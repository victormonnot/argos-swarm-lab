import './style.css';
import './mission.css';
import './slam.css';
import { DT, METHODS, SCENARIOS, PRESETS, ODO_DISTANCE_STD, ODO_TURN_STD, RANGE_STD, BEARING_STD, createRun, stepRun, runToEnd, referenceComparisons, compareSeeds } from './slam-model.js';
import { createSlamView } from './slam-view.js';

const $ = (selector) => document.querySelector(selector);
const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const deg = (value) => value * 180 / Math.PI;
const vector = (values, digits = 3) => `[${values.map((value) => fmt(value, digits)).join(', ')}]`;
const meters = (value) => `${fmt(value)} m`;
const pose = (values) => `${vector(values.slice(0, 2))} m · ${fmt(deg(values[2]), 2)}°`;
const active = (state) => state.status !== 'completed';
const methodDescriptions = {
  ekf: 'Predict the pose, initialize landmarks with full cross-covariances, then use their repeat observations to correct the joint robot-and-map belief.',
  odometry: 'Use the same odometry and first sightings to build the map. Ignore all repeat observations; the robot pose receives no landmark corrections.',
};
const scenarioDescriptions = {
  nominal: 'Identified range–bearing observations arrive every second for landmarks within 5 m. The true circular path lasts 32 seconds.',
  dropout: 'Sensor frames are absent at 12, 13, …, 19 s. At 20 s the returning sensor sees two new landmarks; pose correction can resume on a repeat sighting at 21 s.',
  'biased-range': 'Add an unmodeled +0.40 m bias to every measured range. The filter retains its nominal zero-mean noise assumption; reported ellipses can be misleading.',
};
let run = createRun(), playing = false, timer, selectedUpdate = null;
const view = createSlamView($('#slam-viewport'), {
  onSelect(id) { const update = run.updates.find((entry) => entry.id === id); if (update) { selectedUpdate = id; renderInspector(); view.update(run, id); } },
  onModeChange(mode, message) {
    for (const id of ['2d', '3d']) $(`#slam-${id}`).setAttribute('aria-pressed', String(mode === id));
    $('#slam-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom · Focus drone for a closer view. Solid objects are evaluator truth; dashed markers and ellipses show the belief. Camera movement never advances the estimator.'
      : 'Top-down world axes (x, y), in meters. The drone arrow shows the modeled heading; dashed map and pose markers show estimates. Both views observe the same final belief.');
  },
});
function stop() { playing = false; clearTimeout(timer); }
function schedule() {
  clearTimeout(timer); if (!playing || !active(run)) return;
  timer = setTimeout(() => { stepRun(run); if (!active(run)) stop(); render(); schedule(); }, DT * 1000 / Number($('#slam-speed').value));
}
function start(config) {
  stop(); run = createRun(config); selectedUpdate = null;
  $('#slam-method').value = run.config.method; $('#slam-scenario').value = run.config.scenario; $('#slam-seed').value = String(run.config.seed);
  render();
}
function eventBoundary() { return run.config.scenario === 'dropout' ? [12, 20].find((time) => time - DT > run.time + 1e-9) : undefined; }
function stateLabels(ids) { return ['x', 'y', 'θ', ...ids.flatMap((id) => [`${id} x`, `${id} y`])]; }
function miniMatrix(title, matrix, rowLabels) {
  if (!matrix) return '';
  return `<div class="slam-matrix-small"><strong>${title}</strong><div class="table-scroll"><table aria-label="${title}"><tbody>${matrix.map((row, index) => `<tr>${rowLabels ? `<th>${rowLabels[index]}</th>` : ''}${row.map((value) => `<td>${fmt(value, 4)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function renderInputs() {
  const { observations, robot } = run;
  $('#slam-state-size').textContent = `${run.mean.length} state coordinates`;
  $('#slam-sample-note').textContent = run.step === 0 ? 'Known initial pose, empty map. No odometry interval or sensor frame has been processed.' : `After the interval ending at ${fmt(run.time, 2)} s. ${observations.batch ? observations.dropped ? 'The entire sensor frame is unavailable; odometry prediction continues.' : 'Available packets are processed in supplied landmark-ID order after the odometry prediction.' : 'This is an odometry-only step; the next sensor boundary is at an integer second.'}`;
  $('#slam-inputs').innerHTML = `<div><dt>Measured forward displacement</dt><dd data-slam-input="distance">${meters(observations.odometry.distance)}</dd></div><div><dt>Measured heading change</dt><dd data-slam-input="turn">${fmt(deg(observations.odometry.turn), 3)}°</dd></div><div><dt>Sensor frame</dt><dd data-slam-input="batch">${run.step === 0 ? 'None yet' : !observations.batch ? 'No frame on this step' : observations.dropped ? 'Dropped / unavailable' : `${observations.landmarks.length} supplied ID${observations.landmarks.length === 1 ? '' : 's'}`}</dd></div>`;
  $('#slam-observations').innerHTML = observations.landmarks.map((entry) => `<button data-slam-observation="${entry.id}" aria-pressed="${selectedUpdate === entry.id}"><strong>${entry.id}</strong><span>${fmt(entry.value[0])} m / ${fmt(deg(entry.value[1]), 2)}°</span><small>${entry.action === 'initialized' ? 'First sighting / initialize' : entry.action === 'corrected' ? 'Repeat sighting / correct' : 'Repeat sighting / ignored'}</small></button>`).join('') || `<p class="mission-small">${run.step === 0 ? 'The first sensor frame arrives at 1 s. Landmark coordinates remain unknown until a first sighting.' : observations.dropped ? 'No landmark packet reaches the estimator during this sensor outage.' : 'No landmark packets on this interval. The last map remains in the joint belief.'}</p>`;
  $('#slam-pose-details').innerHTML = `<div><dt>True position / evaluator</dt><dd id="slam-pose-truth" data-pose='${JSON.stringify(robot.truth)}'>${vector(robot.truth.slice(0, 2))} m</dd></div><div><dt>Estimated position</dt><dd id="slam-pose-estimate" data-pose='${JSON.stringify(robot.estimate)}'>${vector(robot.estimate.slice(0, 2))} m</dd></div><div><dt>True / estimated heading</dt><dd>${fmt(deg(robot.truth[2]), 2)}° / ${fmt(deg(robot.estimate[2]), 2)}°</dd></div><div><dt>Reported position RMS radius</dt><dd>${meters(run.metrics.positionRmsRadius)}</dd></div><div><dt>Reported heading standard deviation</dt><dd>${fmt(deg(run.metrics.headingStd), 3)}°</dd></div>`;
  $('#slam-observation-counts').textContent = `Packets so far: ${run.counts.measurements} received; ${run.counts.initialized} initialize a landmark, ${run.counts.corrected} correct the joint belief, ${run.counts.ignored} repeat observations are ignored. ${run.counts.droppedBatches} sensor frames dropped.`;
}
function renderInspector() {
  if (!run.updates.some((entry) => entry.id === selectedUpdate)) selectedUpdate = run.updates.at(-1)?.id ?? null;
  const update = run.updates.find((entry) => entry.id === selectedUpdate);
  $('#slam-update-summary').dataset.beforePose = JSON.stringify((update?.before ?? run.snapshots.predicted).mean.slice(0, 3));
  $('#slam-update-summary').dataset.afterPose = JSON.stringify((update?.after ?? run.snapshots.afterObservations).mean.slice(0, 3));
  $('#slam-update-summary').dataset.correction = JSON.stringify(update?.correction ?? null);
  $('#slam-update').innerHTML = run.updates.map((entry) => `<option value="${entry.id}">${entry.id} / ${entry.kind === 'initialize' ? 'first sighting' : entry.kind === 'correct' ? 'reobservation correction' : 'ignored reobservation'}</option>`).join('') || '<option value="">No packet on this interval</option>';
  $('#slam-update').value = selectedUpdate ?? ''; $('#slam-update').disabled = !update;
  for (const button of document.querySelectorAll('[data-slam-observation]')) button.setAttribute('aria-pressed', String(button.dataset.slamObservation === selectedUpdate));
  if (!update) {
    $('#slam-update-title').textContent = run.step === 0 ? 'An empty map starts with an observation.' : 'Prediction continues between observations.';
    $('#slam-update-kind').textContent = 'No landmark update';
    $('#slam-update-summary').textContent = 'Choose Next sensor frame to inspect a supplied landmark ID. This inspector shows one packet’s before/after state; the scene and covariance matrix always show the final belief at the displayed time.';
    $('#slam-update-details').innerHTML = `<div><dt>Predicted pose</dt><dd>${pose(run.snapshots.predicted.mean)}</dd></div><div><dt>Mapped IDs</dt><dd>${run.mapIds.join(', ') || 'None / empty map'}</dd></div>`;
    $('#slam-update-matrices').innerHTML = '<p>No landmark observation is processed on this interval. Prediction propagates the robot pose and joint covariance using measured motion; there is no measurement innovation or gain.</p>';
    return;
  }
  $('#slam-update-title').textContent = update.kind === 'initialize' ? `${update.id} joins the map.` : update.kind === 'correct' ? `${update.id} corrects a connected belief.` : `${update.id} is recognized, then ignored.`;
  $('#slam-update-kind').textContent = update.kind === 'initialize' ? 'Initialization' : update.kind === 'correct' ? 'EKF correction' : 'Baseline / ignored';
  $('#slam-update-summary').textContent = update.kind === 'initialize'
    ? 'The ID is new. Transform its noisy range and body-frame bearing through the current estimated pose to add two map coordinates and their correlations. This same packet is used once; it does not also correct the robot pose.'
    : update.kind === 'correct' ? 'The ID already exists in the map. Compare the supplied range and bearing with their prediction, linearize the observation, then correct the whole joint state. The bearing residual wraps around ±π.'
      : 'This baseline creates the map from first sightings only. The repeat packet is available but deliberately unused; pose, map and covariance remain unchanged by this packet.';
  const fields = `<div><dt>Observation / range, bearing</dt><dd>${fmt(update.value[0])} m / ${fmt(deg(update.value[1]), 2)}°</dd></div><div><dt>Robot pose before this packet</dt><dd>${pose(update.before.mean)}</dd></div><div><dt>Robot pose after this packet</dt><dd>${pose(update.after.mean)}</dd></div>`;
  if (update.kind === 'initialize') {
    const offset = 3 + 2 * update.after.mapIds.indexOf(update.id);
    $('#slam-update-details').innerHTML = `${fields}<div><dt>New landmark coordinates</dt><dd>${vector(update.after.mean.slice(offset, offset + 2))} m</dd></div><div><dt>State size before → after</dt><dd>${update.before.mean.length} → ${update.after.mean.length}</dd></div>`;
    $('#slam-update-matrices').innerHTML = `<p>Gₓ maps uncertainty in the existing state into the new landmark. G_z maps range–bearing noise into its coordinates. Augmentation retains the old covariance, adds PₓL = P Gₓᵀ, and sets P_LL = Gₓ P Gₓᵀ + G_z R G_zᵀ. There is no innovation or Kalman gain for this first sighting.</p>${miniMatrix('Inverse-observation Jacobian Gₓ', update.Gx, [`${update.id} x`, `${update.id} y`])}${miniMatrix('Inverse-observation Jacobian G_z', update.Gz, [`${update.id} x`, `${update.id} y`])}`;
  } else if (update.kind === 'correct') {
    const corrections = update.correction;
    $('#slam-update-details').innerHTML = `${fields}<div><dt>Innovation / range, wrapped bearing</dt><dd>${fmt(update.innovation[0])} m / ${fmt(deg(update.innovation[1]), 3)}°</dd></div><div><dt>Robot position correction</dt><dd data-slam-correction="robot">${vector(corrections.slice(0, 2), 4)} m</dd></div><div><dt>Robot heading correction</dt><dd>${fmt(deg(corrections[2]), 4)}°</dd></div>${update.after.mapIds.map((id, index) => `<div><dt>${id} position correction${id !== update.id ? ' / not directly observed by this packet' : ''}</dt><dd data-slam-correction="${id}">${vector(corrections.slice(3 + index * 2, 5 + index * 2), 4)} m</dd></div>`).join('')}`;
    $('#slam-update-matrices').innerHTML = `<p>Rows of H correspond to range and bearing. Rows of K follow the state coordinate order below. Mixed meter/radian units are retained; the bearing row is not a Cartesian displacement.</p>${miniMatrix('Observation Jacobian H', update.H, ['range', 'bearing'])}${miniMatrix('Kalman gain K', update.K, stateLabels(update.before.mapIds))}<p>Normalized innovation squared (NIS): νᵀS⁻¹ν = ${fmt(update.nis, 4)}, with two observation coordinates. Nonlinearity and linearization mean calibration must be checked; one value is not an accuracy guarantee.</p>${miniMatrix('Innovation covariance S', update.S, ['range', 'bearing'])}`;
  } else {
    $('#slam-update-details').innerHTML = `${fields}<div><dt>Estimator action</dt><dd>No correction / same covariance</dd></div>`;
    $('#slam-update-matrices').innerHTML = '<p>The packet is omitted by the selected baseline, so no observation Jacobian, innovation or Kalman gain is computed or applied.</p>';
  }
  $('#slam-update-matrices').insertAdjacentHTML('beforeend', `<details class="slam-packet-covariance"><summary>Compare this packet’s covariance before and after</summary><p>State order is listed on each row. The dimensions grow only when a new landmark is initialized; units follow each coordinate pair: m², rad² or m·rad.</p>${miniMatrix('Covariance before this packet', update.before.P, stateLabels(update.before.mapIds))}${miniMatrix('Covariance after this packet', update.after.P, stateLabels(update.after.mapIds))}</details>`);
}
function renderMap() {
  $('#slam-landmarks').innerHTML = run.landmarks.map((landmark) => `<tr data-slam-landmark="${landmark.id}" data-initialized="${landmark.initialized}"><th>${landmark.id}</th><td>${landmark.initialized ? vector(landmark.estimate) : 'Not initialized'}</td><td>${landmark.initialized ? meters(Math.hypot(...landmark.estimate.map((value, axis) => value - landmark.truth[axis]))) : '—'}</td><td>${landmark.lastSeenTime === null ? 'Never' : `${fmt(landmark.lastSeenTime, 0)} s`}</td></tr>`).join('');
  const labels = stateLabels(run.mapIds), block = (index) => index < 3 ? 0 : 1 + Math.floor((index - 3) / 2);
  $('#slam-covariance-size').textContent = `${run.mean.length} × ${run.mean.length}`;
  $('#slam-covariance thead').innerHTML = `<tr><th>P</th>${labels.map((label) => `<th>${label}</th>`).join('')}</tr>`;
  $('#slam-covariance tbody').innerHTML = run.P.map((row, rowIndex) => `<tr><th>${labels[rowIndex]}</th>${row.map((value, columnIndex) => `<td class="${block(rowIndex) !== block(columnIndex) ? 'slam-cross-cell' : ''}" data-row="${rowIndex}" data-column="${columnIndex}">${fmt(value, 4)}</td>`).join('')}</tr>`).join('');
  $('#slam-covariance-note').textContent = `${run.mapIds.length ? `Map order: ${run.mapIds.join(', ')}. ` : run.step === 0 ? 'The map is empty; the initial robot pose is known exactly. ' : 'The map is still empty; only the current predicted robot pose is present. '}Highlighted entries connect different state blocks. A landmark’s marginal ellipse does not reveal every correlation in this matrix.`;
}
function renderHistory() {
  const plots = [{ title: 'Drone position', error: 'positionError', radius: 'positionRmsRadius', color: '#3c8066' }, { title: 'Initialized map / RMS over landmarks', error: 'mapRmse', radius: 'mapRmsRadius', color: '#917348' }];
  $('#slam-history').innerHTML = plots.map((plot) => {
    const highest = Math.max(.3, ...run.history.flatMap((entry) => [entry[plot.error] ?? 0, entry[plot.radius] ?? 0])) * 1.12;
    const px = (time) => 42 + time / 32 * 390, py = (value) => 146 - value / highest * 108;
    const path = (key) => run.history.filter((entry) => Number.isFinite(entry[key])).map((entry, index) => `${index ? 'L' : 'M'}${px(entry.time).toFixed(2)},${py(entry[key]).toFixed(2)}`).join(' ');
    return `<figure><figcaption>${plot.title}</figcaption><svg viewBox="0 0 460 184" role="img" aria-label="${plot.title}: solid evaluator error and dashed reported RMS uncertainty over zero to thirty-two seconds"><path d="M42 38V146H432" fill="none" stroke="#a9b9a4"/><path d="M42 92H432M42 38H432" fill="none" stroke="#dce3d6" stroke-dasharray="3 4"/><text x="34" y="42" text-anchor="end">${fmt(highest, 1)}</text><text x="34" y="150" text-anchor="end">0</text><text x="42" y="165" text-anchor="middle">0 s</text><text x="237" y="165" text-anchor="middle">16 s</text><text x="432" y="165" text-anchor="middle">32 s</text><path d="${path(plot.error)}" fill="none" stroke="${plot.color}" stroke-width="2.5"/><path d="${path(plot.radius)}" fill="none" stroke="${plot.color}" stroke-width="2" stroke-dasharray="5 4"/>${Number.isFinite(run.metrics[plot.error]) ? `<circle cx="${px(run.time)}" cy="${py(run.metrics[plot.error])}" r="3.5" fill="${plot.color}"/>` : ''}</svg><p><span>━ Error ${Number.isFinite(run.metrics[plot.error]) ? meters(run.metrics[plot.error]) : 'not defined yet'}</span><span>┄ Reported RMS ${Number.isFinite(run.metrics[plot.radius]) ? meters(run.metrics[plot.radius]) : 'not defined yet'}</span></p></figure>`;
  }).join('');
}
function render() {
  if (!run.updates.some((entry) => entry.id === selectedUpdate)) selectedUpdate = run.updates.at(-1)?.id ?? null;
  $('#slam-status').textContent = active(run) ? playing ? 'Playing' : 'Paused' : '32-second run complete';
  $('#slam-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'observe', 'finish']) $(`#slam-${id}`).disabled = !active(run);
  $('#slam-boundary').disabled = eventBoundary() === undefined || !active(run);
  $('#slam-boundary').textContent = run.time >= 12 ? 'Run to before sensor return →' : 'Run to before outage →';
  $('#slam-description').textContent = methodDescriptions[run.config.method]; $('#slam-scenario-description').textContent = scenarioDescriptions[run.config.scenario];
  $('#slam-time').textContent = `${fmt(run.time, 2)} s`; $('#slam-step-count').textContent = String(run.step);
  $('#slam-position-error').textContent = meters(run.metrics.positionError); $('#slam-heading-error').textContent = `${fmt(run.metrics.headingErrorDegrees, 2)}°`;
  $('#slam-map-error').textContent = run.metrics.mapCount ? meters(run.metrics.mapRmse) : 'No map yet'; $('#slam-map-count').textContent = `${run.metrics.mapCount} / 4 landmarks initialized`;
  let outcome = run.step === 0 ? 'The starting pose is known exactly, and no landmark coordinates are supplied. Choose Next sensor frame to add the first landmark from a noisy observation. ' : `At ${fmt(run.time, 2)} s, the map contains ${run.metrics.mapCount} landmark${run.metrics.mapCount === 1 ? '' : 's'} and the drone’s position error is ${meters(run.metrics.positionError)}. `;
  if (run.config.scenario === 'dropout' && run.time === 20) outcome += 'The sensor has returned, but L3 and L4 are both new IDs. These packets initialize map points; they do not yet correct the drone pose. Advance to 21 s to inspect their first repeats. ';
  else if (run.updates.some((entry) => entry.kind === 'correct')) outcome += 'A known landmark was reobserved. Inspect the robot and landmark rows of the gain to see how its innovation changes the joint belief. ';
  else if (run.updates.some((entry) => entry.kind === 'initialize')) outcome += 'A first sighting adds a map point with cross-covariances. Its observation is used once for initialization, and does not also correct the pose. ';
  else if (run.step && run.config.method === 'odometry') outcome += 'The baseline ignores repeat sightings. Its pose continues from odometry alone. ';
  if (run.config.scenario === 'biased-range') outcome += 'The +0.40 m range bias is outside the declared noise model; a small ellipse cannot certify this estimate.';
  $('#slam-outcome').textContent = outcome.trim(); $('#slam-outcome').dataset.status = run.config.scenario === 'biased-range' ? 'warning' : 'clear';
  renderInputs(); renderInspector(); renderMap(); renderHistory(); view.update(run, selectedUpdate);
  $('#slam-events').innerHTML = run.events.slice(-24).reverse().map((entry) => `<li data-slam-event="${entry.type}"><strong>${fmt(entry.time, 2)} s / step ${entry.step}</strong> · ${entry.message}</li>`).join('') || '<li>No landmark initialization or schedule event has occurred yet. Current sensor packets and cumulative usage appear in the input inspector.</li>';
}
for (const [id, label] of Object.entries(METHODS)) $('#slam-method').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
for (const [id, label] of Object.entries(SCENARIOS)) $('#slam-scenario').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#slam-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.scenario === 'biased-range' ? 'CHALLENGE THE SENSOR MODEL' : 'FOLLOW THE JOINT BELIEF'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-slam-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#slam-noise-contract').textContent = `Declared independent Gaussian noise per sample: forward displacement σ = ${fmt(ODO_DISTANCE_STD, 2)} m per 0.25 s interval, heading increment σ = ${fmt(deg(ODO_TURN_STD), 1)}°, range σ = ${fmt(RANGE_STD, 2)} m, body-frame bearing σ = ${fmt(deg(BEARING_STD), 1)}°. The biased-range scenario additionally adds +0.40 m without increasing R. Samples arrive once at their current timestamp; no unavailable sample is replayed.`;
$('#slam-method').addEventListener('change', () => start({ ...run.config, method: $('#slam-method').value }));
$('#slam-scenario').addEventListener('change', () => start({ ...run.config, scenario: $('#slam-scenario').value }));
$('#slam-seed').addEventListener('change', () => { const seed = Math.min(999999, Math.max(1, Math.trunc(Number($('#slam-seed').value)) || 7)); start({ ...run.config, seed }); });
$('#slam-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#slam-step').addEventListener('click', () => { stop(); stepRun(run); render(); });
$('#slam-reset').addEventListener('click', () => start(run.config));
$('#slam-finish').addEventListener('click', () => { stop(); runToEnd(run); render(); });
$('#slam-observe').addEventListener('click', () => { stop(); const target = Math.floor(run.time + 1e-9) + 1; while (run.time < target && active(run)) stepRun(run); render(); });
$('#slam-boundary').addEventListener('click', () => { stop(); const target = eventBoundary(); if (target !== undefined) while (run.time < target - DT && active(run)) stepRun(run); render(); });
$('#slam-speed').addEventListener('change', () => { if (playing) schedule(); });
$('#slam-update').addEventListener('change', () => { selectedUpdate = $('#slam-update').value; renderInspector(); view.update(run, selectedUpdate); });
$('#slam-observations').addEventListener('click', (event) => { const button = event.target.closest('[data-slam-observation]'); if (!button) return; selectedUpdate = button.dataset.slamObservation; renderInspector(); view.update(run, selectedUpdate); });
for (const mode of ['2d', '3d']) $(`#slam-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#slam-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-slam-case]'); if (button) start(PRESETS.find((preset) => preset.id === button.dataset.slamCase).config); });
let comparisonsReady = false;
$('#slam-comparisons').addEventListener('toggle', () => {
  if (!$('#slam-comparisons').open || comparisonsReady) return;
  $('#slam-reference-table').innerHTML = referenceComparisons().map((entry) => `<tr data-reference-case="${entry.scenario}-${entry.method}"><td>${SCENARIOS[entry.scenario]}</td><td>${METHODS[entry.method]}</td><td>${fmt(entry.metrics.positionError)}</td><td>${fmt(entry.metrics.headingErrorDegrees, 2)}</td><td>${fmt(entry.metrics.mapRmse)}</td><td>${entry.metrics.mapCount} / 4</td></tr>`).join('');
  $('#slam-ensemble').textContent = 'Computing the fixed nominal comparison across 200 paired seeds…';
  comparisonsReady = true;
  requestAnimationFrame(() => setTimeout(() => renderEnsemble(compareSeeds({ count: 200 })), 0));
});
function renderEnsemble(ensemble) {
  // Filled from the model's endpoint statistics; independent runs never replace
  // the active experiment. Field names are shared with the JSON exporter.
  $('#slam-ensemble').innerHTML = `<h3>Compare 200 paired nominal runs.</h3><p>Nominal scenario, seeds 1–200, endpoint 32 s; the same samples are supplied to both methods for each seed. Biased and interrupted sensor runs are excluded.</p><div class="table-scroll"><table><caption>Square root of mean squared endpoint error across seeds; map RMS also averages initialized landmarks.</caption><thead><tr><th>Method</th><th>Position RMS / m</th><th>Heading RMS / °</th><th>Map RMS / m</th></tr></thead><tbody>${Object.entries(ensemble.methods).map(([id, stats]) => `<tr><td>${METHODS[id]}</td><td>${fmt(stats.positionErrorRms)}</td><td>${fmt(stats.headingErrorRmsDegrees, 2)}</td><td>${fmt(stats.mapErrorRms)}</td></tr>`).join('')}</tbody></table></div><p id="slam-paired-summary"></p><p>These results concern this local linearization, noise level and supplied-ID model. They do not establish robustness to unknown associations, stronger noise, arbitrary trajectories or wrong sensor assumptions.</p>`;
  const paired = ensemble.paired;
  $('#slam-paired-summary').textContent = `The EKF has lower endpoint position error in ${paired.ekfLowerPositionError} / ${ensemble.count} paired runs.${paired.ekfNotLowerPositionSeeds.length ? ` Counterexample seeds: ${paired.ekfNotLowerPositionSeeds.join(', ')}. Try one with nominal sensing to compare both methods under the same samples.` : ' This finite set does not prove that every possible run improves.'}`;
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config); view.setMode('3d');
