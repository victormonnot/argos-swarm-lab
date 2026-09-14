import './style.css';
import './mission.css';
import './pose-graph.css';
import { SCENARIOS, PRESETS, MAX_ITERATIONS, ODOM_TRANSLATION_STD, ODOM_HEADING_STD, LOOP_TRANSLATION_STD, LOOP_HEADING_STD, createRun, stepRun, runToEnd, referenceComparisons, compareSeeds, wrapAngle } from './pose-graph-model.js';
import { createPoseGraphView } from './pose-graph-view.js';

const $ = (selector) => document.querySelector(selector);
const fmt = (value, digits = 3) => !Number.isFinite(value) ? '—' : Math.abs(value) > 0 && (Math.abs(value) < 10 ** -digits || Math.abs(value) >= 1e6) ? value.toExponential(2) : value.toFixed(digits);
const deg = (value) => value * 180 / Math.PI;
const vec = (values, digits = 3) => `[${values.map((value) => fmt(value, digits)).join(', ')}]`;
const poseText = (value) => `${vec(value.slice(0, 2))} m · ${fmt(deg(value[2]), 2)}°`;
const active = (value) => ['ready', 'running'].includes(value.status);
const statusLabels = { ready: 'Paused', running: 'Paused', stationary: 'Stationary / tolerances reached', budget: 'Iteration budget reached', 'line-search-failure': 'Line search stopped', 'linear-solve-failure': 'Linear solve stopped' };
const descriptions = {
  'no-loop': 'Only the 24 consecutive odometry edges are present. Their integrated starting path already fits this chain, even when it has drifted away from evaluator truth.',
  'correct-loop': 'The supplied loop connects pose 0 to pose 24, the recorded return to the start. Its independent relative measurement can revise every unfixed historical pose.',
  'wrong-loop': 'The same measurement of the return at pose 24 is wrongly attached to pose 18. The optimizer receives that false association as an ordinary trusted edge.',
};
let run = createRun(), playing = false, timer, selectedPose = 24, selectedEdge = 'loop';
let comparison = 'after', durationMs = 900;
const overlays = () => ({ pose: selectedPose, edge: selectedEdge, comparison, durationMs, truth: $('#graph-show-truth').checked, initial: $('#graph-show-initial').checked, corrections: $('#graph-show-corrections').checked });
const view = createPoseGraphView($('#graph-viewport'), {
  onPresentationChange: renderPresentation,
  onSelectPose(index) { selectedPose = index; renderPose(); view.update(run, overlays()); },
  onModeChange(mode, message) {
    for (const id of ['2d', '3d']) $(`#graph-${id}`).setAttribute('aria-pressed', String(mode === id));
    $('#graph-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom · Focus selected pose for a closer view. The single solid drone marks one recorded true pose; graph markers are historical estimates, not other drones.'
      : 'Top-down x/y positions and heading arrows. Every graph marker is a historical pose of the same drone. Selecting a pose changes inspection; one optimizer iteration can revise many past estimates.');
  },
});
function renderPresentation({ comparison: shown, animating }) {
  const write = (selector, text) => { const element = $(selector); if (element.textContent !== text) element.textContent = text; };
  for (const id of ['before', 'after']) {
    const button = $(`#graph-${id}`), pressed = String(shown === id);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  }
  const destination = shown === 'before' ? 'Before / initial estimate' : `After / iteration ${run.iteration}`;
  write('#graph-presentation-status', `${animating ? 'Transition → ' : ''}${destination}`);
  write('#graph-presentation-note', animating
    ? `The scene moves between estimates. Metrics and inspectors show the computed result at iteration ${run.iteration}.`
    : shown === 'before'
      ? `The scene shows the initial estimate. Metrics and inspectors retain the computed result at iteration ${run.iteration}.`
      : 'Green: current estimate. Amber: initial odometry. Arrows show the correction from the initial estimate.');
}
function stop() { playing = false; clearTimeout(timer); }
function schedule() { clearTimeout(timer); if (!playing || !active(run)) return; timer = setTimeout(() => { durationMs = 900 / Number($('#graph-speed').value); stepRun(run); if (!active(run)) stop(); render(); schedule(); }, 1000 / Number($('#graph-speed').value)); }
function start(config) {
  stop(); comparison = 'after'; durationMs = 900; run = createRun(config); selectedEdge = run.edges.some((edge) => edge.id === 'loop') ? 'loop' : run.edges.at(-1).id;
  $('#graph-scenario').value = run.config.scenario; $('#graph-seed').value = String(run.config.seed);
  $('#graph-edge').innerHTML = run.edges.map((edge) => `<option value="${edge.id}">${edge.id === 'loop' ? 'Loop' : edge.id} / P${edge.from} → P${edge.to}</option>`).join('');
  render();
}
function renderPose() {
  const truth = run.truth[selectedPose], initial = run.initialPoses[selectedPose], current = run.poses[selectedPose];
  $('#graph-pose-index').value = String(selectedPose); $('#graph-pose-label').textContent = `${selectedPose} / 24`;
  $('#graph-selected-time').textContent = `Recorded at ${selectedPose} s / survey time`;
  $('#graph-pose-previous').disabled = selectedPose === 0; $('#graph-pose-next').disabled = selectedPose === 24;
  const error = Math.hypot(current[0] - truth[0], current[1] - truth[1]), correction = Math.hypot(current[0] - initial[0], current[1] - initial[1]);
  $('#graph-pose-details').innerHTML = `<div><dt>True recorded pose / evaluator</dt><dd id="graph-pose-truth" data-pose='${JSON.stringify(truth)}'>${poseText(truth)}</dd></div><div><dt>Initial integrated odometry</dt><dd id="graph-pose-initial" data-pose='${JSON.stringify(initial)}'>${poseText(initial)}</dd></div><div><dt>Current graph estimate</dt><dd id="graph-pose-current" data-pose='${JSON.stringify(current)}'>${poseText(current)}</dd></div><div><dt>Current position error / evaluator</dt><dd>${fmt(error)} m</dd></div><div><dt>Position change from initial estimate</dt><dd>${fmt(correction)} m</dd></div><div><dt>Heading change from initial estimate</dt><dd>${fmt(deg(wrapAngle(current[2] - initial[2])), 3)}°</dd></div><div><dt>Optimization role</dt><dd>${selectedPose === 0 ? 'Fixed anchor / excluded from the solve' : 'Historical pose / three optimized coordinates'}</dd></div>`;
  const focused = $('#graph-pose-table').contains(document.activeElement) ? document.activeElement.dataset.graphPose : null;
  $('#graph-pose-table tbody').innerHTML = run.poses.map((value, index) => `<tr data-index="${index}" data-pose='${JSON.stringify(value)}'><th><button data-graph-pose="${index}" aria-pressed="${index === selectedPose}">P${index}${index === 0 ? ' / fixed' : ''}</button></th><td>${fmt(value[0])}</td><td>${fmt(value[1])}</td><td>${fmt(deg(value[2]), 2)}</td></tr>`).join('');
  if (focused !== null && focused !== undefined) $(`[data-graph-pose="${focused}"]`)?.focus({ preventScroll: true });
}
function renderEdge() {
  const edge = run.edges.find((entry) => entry.id === selectedEdge), state = run.edgeStates.find((entry) => entry.id === selectedEdge);
  $('#graph-edge').value = selectedEdge; $('#graph-edge-title').textContent = `${edge.id === 'loop' ? 'Loop' : edge.id}: P${edge.from} → P${edge.to}`;
  $('#graph-edge-kind').textContent = edge.kind === 'loop' ? 'Supplied loop constraint' : 'Odometry constraint';
  $('#graph-edge-description').textContent = edge.kind === 'loop'
    ? run.config.scenario === 'wrong-loop' ? 'Evaluator annotation: this measurement really describes 0 → 24, but its supplied endpoint is 18. The optimizer is not given that annotation; it sees the same trusted measurement and weight.' : 'The supplied association connects the initial pose with the recorded return. The independent loop measurement stays fixed while the graph estimates change.'
    : 'One fixed relative-motion measurement connects consecutive recorded poses. The graph predicts its local displacement from the current two pose estimates.';
  const details = $('#graph-edge-details'); details.dataset.from = String(edge.from); details.dataset.to = String(edge.to); details.dataset.measurement = JSON.stringify(edge.measurement); details.dataset.residual = JSON.stringify(state.residual); details.dataset.predicted = JSON.stringify(state.predicted); details.dataset.whitenedResidual = JSON.stringify(state.whitenedResidual);
  details.innerHTML = `<div><dt>Measured local translation</dt><dd>${vec(edge.measurement.slice(0, 2))} m</dd></div><div><dt>Predicted local translation</dt><dd>${vec(state.predicted.slice(0, 2))} m</dd></div><div><dt>Measured / predicted heading change</dt><dd>${fmt(deg(edge.measurement[2]), 3)}° / ${fmt(deg(state.predicted[2]), 3)}°</dd></div><div><dt>Translation residual / predicted − measured</dt><dd>${vec(state.residual.slice(0, 2))} m</dd></div><div><dt>Wrapped heading residual</dt><dd>${fmt(deg(state.residual[2]), 3)}°</dd></div><div><dt>Declared σ / x, y, heading</dt><dd>${fmt(edge.std[0], 2)}, ${fmt(edge.std[1], 2)} m / ${fmt(deg(edge.std[2]), 1)}°</dd></div><div><dt>Whitened residual / dimensionless</dt><dd>${vec(state.whitenedResidual)}</dd></div><div><dt>Weighted edge cost / squared norm</dt><dd id="graph-edge-cost">${fmt(state.cost)}</dd></div>`;
  const focused = $('#graph-edges').contains(document.activeElement) ? document.activeElement.dataset.graphEdge : null;
  $('#graph-edges').innerHTML = run.edgeStates.map((entry) => `<tr data-graph-edge-row="${entry.id}"><th><button data-graph-edge="${entry.id}" aria-pressed="${selectedEdge === entry.id}">${entry.id === 'loop' ? 'Loop' : entry.id}</button></th><td>${entry.from} → ${entry.to}</td><td>${entry.kind}</td><td>${fmt(entry.cost)}</td></tr>`).join('');
  if (focused) $(`[data-graph-edge="${focused}"]`)?.focus({ preventScroll: true });
}
function renderStep() {
  const step = run.lastStep; $('#graph-max-correction').textContent = `${fmt(run.metrics.maxPositionCorrection)} m`;
  const distance = (metres) => metres >= 1 || metres === 0 ? `${fmt(metres)} m` : metres >= .01 ? `${fmt(metres * 100, 1)} cm` : metres >= .0001 ? `${fmt(metres * 1000, 2)} mm` : `${fmt(metres, 5)} m`;
  const latest = step ? Math.max(...step.corrections.map(([x, y]) => Math.hypot(x, y))) : 0;
  $('#graph-displacement-summary').textContent = `Largest position change: ${distance(run.metrics.maxPositionCorrection)} from the start · ${distance(latest)} in the latest step`;
  $('#graph-step-result').textContent = !step ? 'Not iterated' : step.accepted ? 'Step accepted' : 'No pose update applied';
  $('#graph-step-note').textContent = step ? `Attempt ${run.iteration}: ${step.reason} Applied corrections below are zero when no update was accepted. Component norms mix meter and radian coordinates; they are solver diagnostics, not physical distances.` : 'No optimization attempt yet. Step once to inspect the local direction, backtracking trials and whether a new set of historical poses is accepted.';
  $('#graph-step-details').innerHTML = step ? `<div><dt>Cost before → after attempt</dt><dd>${fmt(step.costBefore)} → ${fmt(step.costAfter)}</dd></div><div><dt>Accepted fraction α</dt><dd>${step.alpha === null ? 'None' : fmt(step.alpha, 5)}</dd></div><div><dt>Backtracking trials</dt><dd>${step.trials.length}</dd></div><div><dt>‖JᵀΩr‖∞ / coordinate dependent</dt><dd>${fmt(step.gradientInfinity, 5)}</dd></div><div><dt>Proposed component step ‖δ‖∞</dt><dd>${fmt(step.proposedStepInfinity, 5)}</dd></div><div><dt>Applied component step ‖αδ‖∞</dt><dd>${fmt(step.stepInfinity, 5)}</dd></div><div><dt>Actual objective reduction</dt><dd>${fmt(step.actualReduction, 5)}</dd></div><div><dt>Relative objective reduction</dt><dd>${fmt(step.relativeCostChange, 5)}</dd></div>` : '<div><dt>Unknown vector</dt><dd>72 coordinates / poses 1–24</dd></div><div><dt>Fixed anchor</dt><dd>Pose 0 / excluded from the solve</dd></div>';
  $('#graph-corrections').innerHTML = step ? step.corrections.map((values, index) => `<tr data-graph-correction="${index}"><th>P${index}${index === 0 ? ' / fixed' : ''}</th><td>${fmt(values[0], 5)}</td><td>${fmt(values[1], 5)}</td><td>${fmt(deg(values[2]), 5)}</td></tr>`).join('') : '<tr><td colspan="4">No optimizer attempt yet.</td></tr>';
  $('#graph-trials').innerHTML = step?.trials.length ? step.trials.map((trial) => `<tr data-cost-gap="${trial.cost - trial.armijoBound}" data-accepted="${trial.accepted}"><td>${fmt(trial.alpha, 6)}</td><td>${fmt(trial.cost, 6)}</td><td>${fmt(trial.armijoBound, 6)}</td><td data-graph-trial-gap>${(trial.cost - trial.armijoBound).toExponential(3)}</td><td>${trial.accepted ? 'Yes' : 'No'}</td></tr>`).join('') : '<tr><td colspan="5">No trial step was needed or attempted.</td></tr>';
}
function renderHistory() {
  const plots = [{ title: 'Weighted objective / this graph only', key: 'cost', color: '#816243', unit: '' }, { title: 'Trajectory position RMSE / evaluator', key: 'trajectoryRmse', color: '#3b8066', unit: ' m' }];
  $('#graph-history').innerHTML = plots.map((plot) => {
    const highest = Math.max(plot.key === 'cost' ? 1 : .15, ...run.history.map((entry) => entry[plot.key])) * 1.12, lastIteration = Math.max(5, run.iteration), px = (iteration) => 44 + iteration / lastIteration * 385, py = (value) => 145 - value / highest * 106;
    const path = run.history.map((entry, index) => `${index ? 'L' : 'M'}${px(entry.iteration).toFixed(2)},${py(entry[plot.key]).toFixed(2)}`).join(' ');
    return `<figure><figcaption>${plot.title}</figcaption><svg viewBox="0 0 460 184" role="img" aria-label="${plot.title} over optimizer iterations"><path d="M44 39V145H429" fill="none" stroke="#a9b9a4"/><path d="M44 92H429M44 39H429" fill="none" stroke="#dce3d6" stroke-dasharray="3 4"/><text x="36" y="43" text-anchor="end">${highest >= 1000 ? `${fmt(highest / 1000, 1)}k` : fmt(highest, 1)}</text><text x="36" y="149" text-anchor="end">0</text><text x="44" y="165" text-anchor="middle">0</text><text x="429" y="165" text-anchor="end">iteration ${lastIteration}</text><path d="${path}" fill="none" stroke="${plot.color}" stroke-width="2.5"/><circle cx="${px(run.iteration)}" cy="${py(run.metrics[plot.key])}" r="3.5" fill="${plot.color}"/></svg><p><span>Initial ${fmt(run.history[0][plot.key])}${plot.unit}</span><span>Current ${fmt(run.metrics[plot.key])}${plot.unit}</span></p></figure>`;
  }).join('');
}
function render() {
  $('#graph-status').textContent = playing && active(run) ? 'Playing optimizer iterations' : statusLabels[run.status]; $('#graph-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play iterations';
  for (const id of ['play', 'step', 'finish']) $(`#graph-${id}`).disabled = !active(run);
  $('#graph-scenario-description').textContent = descriptions[run.config.scenario]; $('#graph-iteration').textContent = String(run.iteration); $('#graph-accepted-steps').textContent = String(run.acceptedSteps);
  $('#graph-cost').textContent = fmt(run.metrics.cost); $('#graph-trajectory-error').textContent = `${fmt(run.metrics.trajectoryRmse)} m`; $('#graph-endpoint-error').textContent = `${fmt(run.metrics.endpointError)} m`; $('#graph-endpoint-heading').textContent = `Pose 24 heading error ${fmt(run.metrics.endpointHeadingErrorDegrees, 2)}°`;
  let outcome = run.iteration === 0 ? 'The 24-second survey is already recorded. The current graph starts from integrated odometry; Step runs one solver attempt and may revise earlier poses. ' : `After ${run.iteration} optimizer attempt${run.iteration === 1 ? '' : 's'}, ${run.acceptedSteps} update${run.acceptedSteps === 1 ? '' : 's'} have been accepted. `;
  if (run.config.scenario === 'no-loop') outcome += 'This open chain can fit all its odometry edges with near-zero cost while still having nonzero trajectory error. ';
  if (run.config.scenario === 'wrong-loop') outcome += `The supplied association is deliberately wrong. Its graph cost is ${fmt(run.metrics.cost)}, while trajectory RMSE is ${fmt(run.metrics.trajectoryRmse)} m (initially ${fmt(run.initialMetrics.trajectoryRmse)} m). A cost decrease does not validate the loop identity. `;
  else if (run.iteration) outcome += `Trajectory RMSE is ${fmt(run.metrics.trajectoryRmse)} m, compared with ${fmt(run.initialMetrics.trajectoryRmse)} m before optimization. `;
  if (!active(run)) outcome += `${statusLabels[run.status]}. ${run.status === 'stationary' ? 'The numerical stopping condition does not prove a global minimum or physical accuracy.' : run.lastStep?.reason ?? ''}`;
  $('#graph-outcome').textContent = outcome.trim(); $('#graph-outcome').dataset.status = run.config.scenario === 'wrong-loop' || run.status.includes('failure') ? 'warning' : 'clear';
  renderPose(); renderEdge(); renderStep(); renderHistory(); view.update(run, overlays());
  $('#graph-events').innerHTML = run.events.map((entry) => `<li data-graph-event="${entry.type}"><strong>Iteration ${entry.iteration}</strong> · ${entry.message}</li>`).join('') || '<li>No terminal solver event yet. Inspect the latest attempted step and its backtracking trials above.</li>';
}
for (const [id, label] of Object.entries(SCENARIOS)) $('#graph-scenario').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#graph-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.scenario === 'wrong-loop' ? 'CHALLENGE THE ASSOCIATION' : 'INSPECT THE GRAPH'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-graph-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#graph-noise-contract').textContent = `Declared independent Gaussian edge noise: odometry translation σ = ${fmt(ODOM_TRANSLATION_STD, 2)} m per local axis and heading σ = ${fmt(deg(ODOM_HEADING_STD), 1)}°; supplied loop translation σ = ${fmt(LOOP_TRANSLATION_STD, 2)} m per local axis and heading σ = ${fmt(deg(LOOP_HEADING_STD), 1)}°. The wrong association changes only the target ID, not the underlying loop measurement or information weights. The solver has a ${MAX_ITERATIONS}-attempt budget and explicit numerical stopping conditions.`;
$('#graph-scenario').addEventListener('change', () => start({ ...run.config, scenario: $('#graph-scenario').value }));
$('#graph-seed').addEventListener('change', () => { const seed = Math.min(999999, Math.max(1, Math.trunc(Number($('#graph-seed').value)) || 7)); start({ ...run.config, seed }); });
$('#graph-play').addEventListener('click', () => { if (playing) stop(); else { comparison = 'after'; durationMs = 900 / Number($('#graph-speed').value); playing = true; } render(); schedule(); });
$('#graph-step').addEventListener('click', () => { stop(); comparison = 'after'; durationMs = 900; stepRun(run); render(); });
$('#graph-reset').addEventListener('click', () => start(run.config));
$('#graph-finish').addEventListener('click', () => { stop(); comparison = 'after'; durationMs = 900; runToEnd(run); render(); });
$('#graph-speed').addEventListener('change', () => { if (playing) schedule(); });
for (const state of ['before', 'after']) $(`#graph-${state}`).addEventListener('click', () => { stop(); comparison = state; durationMs = 900; render(); });
$('#graph-pose-index').addEventListener('input', () => { selectedPose = Number($('#graph-pose-index').value); renderPose(); view.update(run, overlays()); });
$('#graph-pose-previous').addEventListener('click', () => { selectedPose = Math.max(0, selectedPose - 1); renderPose(); view.update(run, overlays()); }); $('#graph-pose-next').addEventListener('click', () => { selectedPose = Math.min(24, selectedPose + 1); renderPose(); view.update(run, overlays()); });
$('#graph-pose-table').addEventListener('click', (event) => { const button = event.target.closest('[data-graph-pose]'); if (!button) return; selectedPose = Number(button.dataset.graphPose); renderPose(); view.update(run, overlays()); });
$('#graph-edge').addEventListener('change', () => { selectedEdge = $('#graph-edge').value; renderEdge(); view.update(run, overlays()); }); $('#graph-edges').addEventListener('click', (event) => { const button = event.target.closest('[data-graph-edge]'); if (!button) return; selectedEdge = button.dataset.graphEdge; renderEdge(); view.update(run, overlays()); });
for (const id of ['truth', 'initial', 'corrections']) $(`#graph-show-${id}`).addEventListener('change', () => view.update(run, overlays()));
for (const mode of ['2d', '3d']) $(`#graph-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#graph-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-graph-case]'); if (button) start(PRESETS.find((preset) => preset.id === button.dataset.graphCase).config); });
let comparisonsReady = false;
$('#graph-comparisons').addEventListener('toggle', () => {
  if (!$('#graph-comparisons').open || comparisonsReady) return; comparisonsReady = true;
  $('#graph-reference-table').innerHTML = referenceComparisons().map((entry) => `<tr data-reference-case="${entry.scenario}"><td>${SCENARIOS[entry.scenario]}</td><td>${statusLabels[entry.status]}</td><td>${entry.iterations}</td><td>${fmt(entry.metrics.cost)}</td><td>${fmt(entry.metrics.trajectoryRmse)}</td><td>${fmt(entry.metrics.endpointError)}</td></tr>`).join('');
  $('#graph-ensemble').textContent = 'Computing 100 paired recorded surveys across the three supplied association scenarios…';
  requestAnimationFrame(() => setTimeout(() => renderEnsemble(compareSeeds({ count: 100 })), 0));
});
function renderEnsemble(ensemble) {
  const correct = ensemble.scenarios['correct-loop'];
  $('#graph-ensemble').innerHTML = `<h3>Check 100 paired surveys.</h3><p>Seeds 1–100. Each seed provides the same truth, odometry and underlying loop measurement to all three graphs. RMS is computed after averaging squared errors across recorded poses and seeds. Numerical stop status is reported separately from evaluator accuracy.</p><div class="table-scroll"><table><caption>Trajectory errors exclude fixed pose 0 and average the 24 unfixed historical positions, without alignment to truth.</caption><thead><tr><th>Association</th><th>Initial trajectory RMS / m</th><th>Final trajectory RMS / m</th><th>Endpoint RMS / m</th><th>Lower trajectory error</th></tr></thead><tbody>${Object.entries(ensemble.scenarios).map(([scenario, stats]) => `<tr><td>${SCENARIOS[scenario]}</td><td>${fmt(stats.initialTrajectoryErrorRms)}</td><td>${fmt(stats.trajectoryErrorRms)}</td><td>${fmt(stats.endpointErrorRms)}</td><td>${stats.improvedTrajectory} / ${ensemble.count}</td></tr>`).join('')}</tbody></table></div><p>The correct supplied loop lowers trajectory error in <strong>${correct.improvedTrajectory} / ${ensemble.count}</strong> runs. Its counterexample seeds are <strong>${correct.notImprovedTrajectorySeeds.join(', ') || 'none in this finite sample'}</strong>. More consistent constraints do not guarantee smaller realized error on every noisy survey.</p><ul>${Object.entries(ensemble.scenarios).map(([scenario, stats]) => `<li><strong>${SCENARIOS[scenario]}:</strong> ${Object.entries(stats.statuses).map(([status, count]) => `${count} ${statusLabels[status].toLowerCase()}`).join('; ')}.${stats.failureSeeds.length ? ` Numerical-stop replay seeds: ${stats.failureSeeds.map((entry) => `${entry.seed} (${statusLabels[entry.status].toLowerCase()})`).join(', ')}.` : ''}</li>`).join('')}</ul><p>Near floating-point resolution, stopping iterations and failure seeds can vary across JavaScript runtimes; these results are computed in this browser. A line-search stop retains the last accepted graph; it is not relabeled convergence. These local nonlinear solves do not claim global optimality, posterior covariance calibration or robustness to arbitrary bad loop associations.</p>`;
}
window.addEventListener('pagehide', () => { stop(); view.dispose(); }); window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config); view.setMode('3d');
