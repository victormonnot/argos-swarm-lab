import './style.css';
import './mission.css';
import './cooperative.css';
import { DT, METHODS, SCENARIOS, PRESETS, createRun, stepRun, runToEnd, referenceComparisons, compareSeeds } from './cooperative-model.js';
import { createCooperativeView } from './cooperative-view.js';

const $ = (selector) => document.querySelector(selector);
const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const vector = (values, digits = 3) => `[${values.map((value) => fmt(value, digits)).join(', ')}]`;
const meters = (value) => `${fmt(value)} m`;
const active = (state) => state.status !== 'completed';
const methodDescriptions = {
  joint: 'Retain the full covariance. Relative observations correct both robots; cross-covariances let an A1 absolute fix also correct A2.',
  independent: 'Use the same odometry, prior and A1 fixes. Omit relative observations; each robot keeps its own position filter and the cross-block remains zero.',
};
const scenarioDescriptions = {
  anchored: 'Relative observations and absolute A1 fixes arrive at 1, 2, …, 20 s. A2 never receives its own absolute fix.',
  unanchored: 'Relative observations arrive every second. No new absolute fix is available to either robot; the initial finite prior remains.',
  'anchor-restored': 'Relative observations continue throughout. The first absolute A1 fix arrives at 10 s, followed by one every second.',
  'relative-outage': 'A1 fixes continue. Relative observations are missing at 5, 6, …, 9 s, and return at 10 s. No late packets are replayed.',
};
let run = createRun(), playing = false, timer, selectedAgent = 'A1';
const view = createCooperativeView($('#coop-viewport'), {
  onSelect(id) { selectedAgent = id; renderSelection(); view.update(run, selectedAgent); },
  onModeChange(mode, message) {
    for (const id of ['2d', '3d']) $(`#coop-${id}`).setAttribute('aria-pressed', String(mode === id));
    $('#coop-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom · Focus selected drone for a closer view. Solid drone = evaluator truth; dashed marker = estimate. Camera movement never advances the estimator.'
      : 'Top-down world axes (x, y), in meters. Solid marker = evaluator truth; dashed marker = estimate. Both views show the same final belief and the same sensor sample.');
  },
});

function stop() { playing = false; clearTimeout(timer); }
function schedule() {
  clearTimeout(timer);
  if (!playing || !active(run)) return;
  timer = setTimeout(() => {
    stepRun(run); if (!active(run)) stop(); render(); schedule();
  }, DT * 1000 / Number($('#coop-speed').value));
}
function start(config) {
  stop(); run = createRun(config);
  $('#coop-method').value = run.config.method;
  $('#coop-scenario').value = run.config.scenario;
  $('#coop-seed').value = String(run.config.seed);
  $('#coop-prior-shift').value = run.config.priorShift;
  render();
}
function eventBoundary() {
  const times = run.config.scenario === 'relative-outage' ? [5, 10] : run.config.scenario === 'anchor-restored' ? [10] : [];
  return times.find((time) => time - DT > run.time + 1e-9);
}
function renderSelection() {
  for (const button of document.querySelectorAll('[data-coop-agent]')) button.setAttribute('aria-pressed', String(button.dataset.coopAgent === selectedAgent));
  const index = selectedAgent === 'A1' ? 0 : 1, agent = run.agents[index];
  const { observations } = run;
  const relative = observations.relative, anchor = observations.anchor;
  const packet = (sample, kind) => !sample || !sample.available
    ? (run.step % 4 ? 'No sample on this prediction step' : 'Unavailable at this observation time')
    : `${vector(sample.value)} m · ${sample.used ? 'used once' : kind === 'relative' ? 'omitted by independent baseline' : 'not used'}`;
  $('#coop-sample-note').textContent = run.step === 0
    ? `Initial prior, before any prediction or observation. ${run.config.method === 'joint' ? 'The central reference estimator receives both robots’ odometry streams.' : 'Each independent filter uses only its own odometry and any available own absolute fix.'}`
    : `After the interval ending at ${fmt(run.time, 2)} s. ${run.config.method === 'joint' ? 'The joint prediction uses both odometry streams. Available measurement updates run relative first, then absolute.' : 'Each independent prediction uses only its own odometry. Only A1 receives absolute corrections; all relative samples are omitted.'}`;
  $('#coop-inputs').innerHTML = `<div><dt>${selectedAgent} measured odometry / Δx, Δy</dt><dd>${vector(observations.odometry[index])} m</dd></div><div><dt>Relative observation / A2 − A1</dt><dd data-coop-input="relative">${run.step === 0 ? 'No observation yet' : packet(relative, 'relative')}</dd></div><div><dt>Absolute observation / A1 only</dt><dd data-coop-input="anchor">${run.step === 0 ? 'No observation yet' : packet(anchor, 'anchor')}</dd></div><div><dt>${selectedAgent} estimated position / x, y</dt><dd id="coop-selected-estimate" data-position='${JSON.stringify(agent.estimate)}'>${vector(agent.estimate)} m</dd></div>`;
  $('#coop-selected-title').textContent = `${selectedAgent} / evaluator comparison`;
  const truthRelative = run.agents[1].truth.map((value, i) => value - run.agents[0].truth[i]);
  $('#coop-selected-details').innerHTML = `<div><dt>True position / x, y</dt><dd id="coop-selected-truth" data-position='${JSON.stringify(agent.truth)}'>${vector(agent.truth)} m</dd></div><div><dt>This robot’s position error</dt><dd>${meters(Math.hypot(...agent.estimate.map((value, i) => value - agent.truth[i])))}</dd></div><div><dt>True displacement / A2 − A1</dt><dd>${vector(truthRelative)} m</dd></div><div><dt>Reported RMS uncertainty radius</dt><dd>${meters(Math.sqrt(agent.covariance[0][0] + agent.covariance[1][1]))}</dd></div>`;
  $('#coop-observation-counts').textContent = `Packets so far: relative ${run.counts.relativeUsed} used / ${run.counts.relativeAvailable} available; A1 absolute ${run.counts.anchorUsed} used / ${run.counts.anchorAvailable} available. Odometry is available every prediction step.`;
}
function miniMatrix(title, matrix, rowLabels) {
  return `<div class="coop-matrix-small"><strong>${title}</strong><div class="table-scroll"><table aria-label="${title}"><tbody>${matrix.map((row, index) => `<tr>${rowLabels ? `<th>${rowLabels[index]}</th>` : ''}${row.map((value) => `<td>${fmt(value, 4)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function renderCovariance() {
  const stage = $('#coop-stage').value;
  const snapshot = run.snapshots[stage];
  const labels = ['x₁', 'y₁', 'x₂', 'y₂'];
  $('#coop-covariance tbody').innerHTML = snapshot.P.map((row, rowIndex) => `<tr><th>${labels[rowIndex]}</th>${row.map((value, columnIndex) => `<td${Math.floor(rowIndex / 2) !== Math.floor(columnIndex / 2) ? ' class="coop-cross-cell"' : ''} data-row="${rowIndex}" data-column="${columnIndex}">${fmt(value, 4)}</td>`).join('')}</tr>`).join('');
  const crossNorm = Math.hypot(snapshot.P[0][2], snapshot.P[0][3], snapshot.P[1][2], snapshot.P[1][3]);
  $('#coop-cross-covariance').textContent = `‖P₁₂‖ = ${fmt(crossNorm, 4)} m²`;
  $('#coop-covariance-note').textContent = `Stage mean: ${vector(snapshot.mean)} m. ${crossNorm < 1e-10 ? 'The robot-to-robot cross-covariance is zero at this stage.' : 'The highlighted blocks retain dependence between the two robot position errors.'} The ellipses in the scene show only each robot’s marginal covariance after all updates.`;
  if (stage === 'predicted') {
    $('#coop-update-details').innerHTML = `<p>Prediction adds the observed displacement u to the four-coordinate mean and Q = 0.0064 I₄ m² to its covariance.${run.step === 0 ? ' No prediction has run yet; this is the initial prior.' : ''}</p><p><strong>u / m:</strong> ${vector(run.observations.odometry.flat())}</p><p>No measurement matrix or Kalman gain is used in this stage.</p>`;
    return;
  }
  const kind = stage === 'afterRelative' ? 'relative' : 'anchor';
  const update = run.updates.find((entry) => entry.kind === kind && entry.used);
  if (!update) {
    const available = run.observations[kind]?.available;
    $('#coop-update-details').innerHTML = `<p>${kind === 'relative' && available && run.config.method === 'independent' ? 'The relative packet was available but deliberately omitted by the independent baseline. No Kalman update is applied.' : `No ${kind === 'relative' ? 'relative' : 'A1 absolute'} update is applied on this step.`} This stage retains the preceding stage’s mean and covariance.</p>`;
    return;
  }
  $('#coop-update-details').innerHTML = `<p><strong>${kind === 'relative' ? 'Relative displacement A2 − A1' : 'Absolute position of A1'}</strong> · innovation ν = ${vector(update.innovation)} m.</p><div class="coop-update-matrices">${miniMatrix('Observation matrix H', update.H)}${miniMatrix('Kalman gain K', update.K, labels)}</div><dl class="coop-details"><div><dt>A1 correction / Δx₁, Δy₁</dt><dd>${vector(update.correction.slice(0, 2), 4)} m</dd></div><div><dt>A2 correction / Δx₂, Δy₂</dt><dd data-coop-correction="A2">${vector(update.correction.slice(2), 4)} m</dd></div><div><dt>Normalized innovation squared / νᵀS⁻¹ν</dt><dd>${fmt(update.nis, 4)} · 2 observation coordinates</dd></div></dl><p>${kind === 'anchor' ? run.config.method === 'joint' ? 'The observation directly measures only A1. Nonzero gain in the bottom two rows corrects A2 through the joint cross-covariance.' : 'The bottom two gain rows are zero: the independent baseline has no cross-covariance, so this A1 fix does not correct A2.' : 'The gain distributes the relative innovation between both robot positions according to the retained covariance.'}</p>${miniMatrix('Innovation covariance S / m²', update.S)}`;
}
function renderHistory() {
  const plots = [
    { title: 'Relative displacement', error: 'relativeError', radius: 'relativeRmsRadius', color: '#3c8066' },
    { title: 'Pair center / common translation', error: 'centerError', radius: 'centerRmsRadius', color: '#917348' },
  ];
  $('#coop-history').innerHTML = plots.map((plot) => {
    const highest = Math.max(.5, ...run.history.flatMap((entry) => [entry[plot.error], entry[plot.radius]])) * 1.12;
    const px = (time) => 42 + time / 20 * 390, py = (value) => 146 - value / highest * 108;
    const path = (key) => run.history.map((entry, index) => `${index ? 'L' : 'M'}${px(entry.time).toFixed(2)},${py(entry[key]).toFixed(2)}`).join(' ');
    return `<figure><figcaption>${plot.title}</figcaption><svg viewBox="0 0 460 184" role="img" aria-label="${plot.title}: solid measured error and dashed reported RMS uncertainty, over zero to twenty seconds"><path d="M42 38V146H432" fill="none" stroke="#a9b9a4"/><path d="M42 92H432M42 38H432" fill="none" stroke="#dce3d6" stroke-dasharray="3 4"/><text x="34" y="42" text-anchor="end">${fmt(highest, 1)}</text><text x="34" y="150" text-anchor="end">0</text><text x="42" y="165" text-anchor="middle">0 s</text><text x="237" y="165" text-anchor="middle">10 s</text><text x="432" y="165" text-anchor="middle">20 s</text><path d="${path(plot.error)}" fill="none" stroke="${plot.color}" stroke-width="2.5"/><path d="${path(plot.radius)}" fill="none" stroke="${plot.color}" stroke-width="2" stroke-dasharray="5 4"/><circle cx="${px(run.time)}" cy="${py(run.metrics[plot.error])}" r="3.5" fill="${plot.color}"/></svg><p><span>━ Error ${meters(run.metrics[plot.error])}</span><span>┄ Reported RMS ${meters(run.metrics[plot.radius])}</span></p></figure>`;
  }).join('');
}
function render() {
  $('#coop-status').textContent = active(run) ? playing ? 'Playing' : 'Paused' : '20-second run complete';
  $('#coop-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'observe', 'finish']) $(`#coop-${id}`).disabled = !active(run);
  $('#coop-boundary').disabled = eventBoundary() === undefined || !active(run);
  $('#coop-description').textContent = methodDescriptions[run.config.method];
  $('#coop-scenario-description').textContent = scenarioDescriptions[run.config.scenario];
  $('#coop-prior-description').textContent = run.config.priorShift === 'shared'
    ? 'Deliberate prior mismatch: add [2, −1.5] m to both initial estimates while retaining P₀ = 0.64 I₄ m². This common bias is not included in reported uncertainty.'
    : 'The initial estimation error is sampled from the declared prior P₀ = 0.64 I₄ m². Relative readings do not replace that initial world information.';
  $('#coop-time').textContent = `${fmt(run.time, 2)} s`;
  $('#coop-step-count').textContent = String(run.step);
  $('#coop-position-error').textContent = meters(run.metrics.positionRmse);
  $('#coop-relative-error').textContent = meters(run.metrics.relativeError);
  $('#coop-center-error').textContent = meters(run.metrics.centerError);
  const anchorUpdate = run.updates.find((entry) => entry.kind === 'anchor' && entry.used);
  let outcome = run.step === 0 ? 'Predict the effect of observing a difference, then choose Next observation to inspect the first update at 1 s. ' : active(run) ? `At ${fmt(run.time, 2)} s, ` : 'At the end of this 20-second realization, ';
  if (run.step) outcome += `the relative error is ${meters(run.metrics.relativeError)} and the pair-center error is ${meters(run.metrics.centerError)}. `;
  if (anchorUpdate && run.config.method === 'joint') outcome += `The latest A1 fix also corrects A2 by ${vector(anchorUpdate.correction.slice(2), 4)} m. Inspect the bottom rows of its Kalman gain. `;
  else if (run.config.scenario === 'unanchored' || run.config.scenario === 'anchor-restored' && run.time < 10) outcome += 'New relative observations cannot detect a translation shared by both robots. The common world offset still depends on the prior and accumulated odometry. ';
  else if (run.config.method === 'independent') outcome += 'A2 has only its prior and odometry: this baseline omits every peer observation. ';
  if (run.config.priorShift === 'shared') outcome += 'The shared-offset prior is deliberately miscalibrated; its reported ellipse does not account for the added bias.';
  $('#coop-outcome').textContent = outcome.trim();
  $('#coop-outcome').dataset.status = run.config.priorShift === 'shared' ? 'warning' : 'clear';
  renderSelection(); renderCovariance(); renderHistory(); view.update(run, selectedAgent);
  $('#coop-events').innerHTML = run.events.slice(-24).reverse().map((entry) => `<li data-coop-event="${entry.type}"><strong>${fmt(entry.time, 2)} s / step ${entry.step}</strong> · ${entry.message}</li>`).join('') || (run.step === 0 ? '<li>No observation yet. Step to the first sample at 1 s.</li>' : '<li>No schedule changes recorded. Current samples and update counts are shown above.</li>');
}

for (const [id, label] of Object.entries(METHODS)) $('#coop-method').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
for (const [id, label] of Object.entries(SCENARIOS)) $('#coop-scenario').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#coop-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.priorShift === 'shared' ? 'CHALLENGE THE PRIOR' : 'INSPECT THE INFORMATION'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-coop-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#coop-method').addEventListener('change', () => start({ ...run.config, method: $('#coop-method').value }));
$('#coop-scenario').addEventListener('change', () => start({ ...run.config, scenario: $('#coop-scenario').value }));
$('#coop-prior-shift').addEventListener('change', () => start({ ...run.config, priorShift: $('#coop-prior-shift').value }));
$('#coop-seed').addEventListener('change', () => { const seed = Math.min(999999, Math.max(1, Math.trunc(Number($('#coop-seed').value)) || 7)); start({ ...run.config, seed }); });
$('#coop-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#coop-step').addEventListener('click', () => { stop(); stepRun(run); render(); });
$('#coop-reset').addEventListener('click', () => start(run.config));
$('#coop-finish').addEventListener('click', () => { stop(); runToEnd(run); render(); });
$('#coop-observe').addEventListener('click', () => { stop(); const target = Math.floor(run.time + 1e-9) + 1; while (run.time < target && active(run)) stepRun(run); render(); });
$('#coop-boundary').addEventListener('click', () => { stop(); const target = eventBoundary(); if (target !== undefined) while (run.time < target - DT && active(run)) stepRun(run); render(); });
$('#coop-speed').addEventListener('change', () => { if (playing) schedule(); });
$('#coop-stage').addEventListener('change', renderCovariance);
for (const button of document.querySelectorAll('[data-coop-agent]')) button.addEventListener('click', () => { selectedAgent = button.dataset.coopAgent; renderSelection(); view.update(run, selectedAgent); });
for (const mode of ['2d', '3d']) $(`#coop-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#coop-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-coop-case]'); if (button) start(PRESETS.find((preset) => preset.id === button.dataset.coopCase).config); });
let comparisonsReady = false;
$('#coop-comparisons').addEventListener('toggle', () => {
  if (!$('#coop-comparisons').open || comparisonsReady) return;
  $('#coop-reference-table').innerHTML = referenceComparisons().map((entry) => `<tr data-reference-case="${entry.scenario}-${entry.method}-${entry.priorShift}"><td>${SCENARIOS[entry.scenario]}</td><td>${METHODS[entry.method]}</td><td>${entry.priorShift === 'shared' ? 'Shared offset' : 'Nominal prior'}</td><td>${fmt(entry.metrics.positionRmse)}</td><td>${fmt(entry.metrics.relativeError)}</td><td>${fmt(entry.metrics.centerError)}</td></tr>`).join('');
  const ensemble = compareSeeds({ count: 200 });
  $('#coop-ensemble').innerHTML = `<h3>Check 200 paired seeds, not only seed 7.</h3><p>Fixed anchored scenario, nominal prior, seeds 1–200, endpoint 20 s. Each seed supplies identical paths and sensor samples to the two methods. This calculation is independent of the controls above; shifted-prior cases are excluded. Normalized estimation error squared (NEES) is eᵀP⁻¹e for the four-coordinate error; its nominal ensemble expectation is 4.</p><div class="table-scroll"><table><caption>Endpoint RMS is the square root of mean squared error across seeds. Position RMS also averages the two robot errors.</caption><thead><tr><th>Method</th><th>Position RMS / m</th><th>Relative RMS / m</th><th>Center RMS / m</th><th>Mean NEES / expected 4</th></tr></thead><tbody>${Object.entries(ensemble.methods).map(([id, stats]) => `<tr><td>${METHODS[id]}</td><td>${fmt(stats.positionErrorRms)}</td><td>${fmt(stats.relativeErrorRms)}</td><td>${fmt(stats.centerErrorRms)}</td><td>${fmt(stats.meanNees)}</td></tr>`).join('')}</tbody></table></div><p>The joint filter has lower endpoint position error in <strong>${ensemble.paired.jointLowerPositionError} / ${ensemble.count}</strong> paired runs. More information improves expected accuracy under the model, but does not guarantee a smaller realized error for every seed.</p><p>Counterexample seeds: <strong>${ensemble.paired.jointNotLowerPositionSeeds.join(', ')}</strong>. Set one of these seeds with regular A1 fixes and a nominal prior, then compare the two methods at 20 s.</p>`;
  comparisonsReady = true;
});
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config); view.setMode('3d');
