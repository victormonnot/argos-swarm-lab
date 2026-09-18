import './style.css';
import './mission.css';
import './gazebo.css';
import bundled from '../docs/results/ardupilot-gazebo.json';
import { validateGazeboTrace, gazeboFrame, gazeboEvents, gazeboSummary, resultNames, landedNames } from './gazebo-trace.js';
import { createGazeboView } from './gazebo-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attributes = {}) => { const node = document.createElement(tag); node.textContent = text; for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
const svg = (tag, attributes, text = '') => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); node.textContent = text; return node; };
const seconds = value => value === null || value === undefined ? '—' : `${(value / 1000).toFixed(3)} s`;
const metres = value => value === null || value === undefined ? '—' : `${value.toFixed(3)} m`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`;
const vector = value => value ? `[${value.map(axis => axis.toFixed(3)).join(', ')}]` : 'No sample';
const stageNames = { ready: 'Ready', guided: 'Guided mode', arm: 'Arming', takeoff: 'Takeoff', hover: 'Hover observation', pulse: 'External force', land: 'Landing' };
const commandNames = { guided: 'MAV_CMD_DO_SET_MODE', arm: 'MAV_CMD_COMPONENT_ARM_DISARM', takeoff: 'MAV_CMD_NAV_TAKEOFF', land: 'MAV_CMD_NAV_LAND' };
let trace, run, events = [], timeMs = 0, source = 'Bundled recording', playing = false, animation, previousTick = null, importEpoch = 0, selectedCommand = null;
const view = createGazeboView($('#gazebo-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#gazebo-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#gazebo-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. Mint: Gazebo world pose. Amber wireframe: held autopilot estimate. Neither pose is magnified; the yard and rotor shapes are illustrative.'
      : 'Top view: east / north. Side view: east / world height. The same recorded poses and cursor are used in 3D; the force arrow shows direction with an illustrative length.');
  },
});
function detail(list, pairs) { list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; })); }
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { if (!run || value === null || value === undefined) return; stop(); timeMs = Math.max(0, Math.min(run.endMs, value)); render(); }
function shortcuts() {
  const summary = gazeboSummary(run);
  return { hover: summary.hoverStartMs, pulse: summary.pulseStartMs, release: summary.pulseEndMs, peak: summary.maxHorizontalDeviationMs, recovery: summary.recoveryMs, finish: run.endMs };
}
function setCase(id) {
  stop(); run = trace.cases.find(item => item.id === id) ?? trace.cases[0]; timeMs = 0; selectedCommand = null; events = gazeboEvents(run);
  $('#gazebo-case').value = run.id; $('#gazebo-time-slider').max = String(run.endMs);
  $('#gazebo-case-description').textContent = run.pulse
    ? 'The same hover receives an 8 N eastward force for 1 simulation second, requested after 2 simulation seconds of settled hover. Inspect actual application records and the subsequent response.'
    : 'The vehicle takes off, holds the same horizontal position during a 12 simulation-second observation window, then lands. No external force is applied.';
  for (const [name, value] of Object.entries(shortcuts())) { $(`#gazebo-${name}`).disabled = value === null; $(`#gazebo-${name}`).title = value === null ? 'No such observation in this recording.' : `Seek to receipt time ${seconds(value)}`; }
  const runtime = trace.runtime;
  detail($('#gazebo-provenance'), [
    ['Source', source], ['Recorded at', runtime.recordedAt], ['Run ID', run.runId],
    ['ArduPilot version', runtime.ardupilotVersion], ['Gazebo version', runtime.gazeboVersion], ['Gazebo plugin revision', runtime.pluginGitHash], ['Physics / integration step', `${runtime.physics ?? 'Declared in metadata'} / ${runtime.maxStepSizeMs ?? '—'} ms`], ['Lock step / no time sync', `${runtime.lockStep} / ${runtime.noTimeSync}`], ['Gazebo pose link', runtime.truthLink ?? 'Not declared'], ['External-force link', runtime.forceLink ?? 'Not declared'],
    ['Vehicle / controller identity', `${run.vehicle.systemId}:${run.vehicle.componentId} / ${run.controller.systemId}:${run.controller.componentId}`],
    ['Runtime image', runtime.image], ['Base image', runtime.baseImage], ['Recorder SHA-256', runtime.sourceSha256], ['Observer plugin SHA-256', runtime.observerSha256], ['World SHA-256', runtime.worldSha256], ['Parameter file SHA-256 values', JSON.stringify(runtime.paramsSha256)],
    ['Actual critical parameters', JSON.stringify(run.parameters)], ['Grounded world baseline / ENU', `${vector(run.originTruthEnu)} m`], ['Grounded estimator baseline / NED', `${vector(run.originNed)} m`],
    ['Baseline sample receipt times', JSON.stringify(run.originSampleTimes)], ['Additional runtime metadata', JSON.stringify(Object.fromEntries(Object.entries(runtime).filter(([key]) => !['recordedAt', 'ardupilotVersion', 'gazeboVersion', 'pluginGitHash', 'image', 'baseImage', 'sourceSha256', 'observerSha256', 'worldSha256', 'paramsSha256'].includes(key))))],
  ]);
  const cfg = run.config;
  detail($('#gazebo-criteria'), [
    ['Takeoff / above-home height', `${cfg.takeoffAltitudeM} m ± ${cfg.takeoffToleranceM} m`], ['Takeoff settling', `3D speed ≤ ${cfg.speedToleranceMps} m/s for ${cfg.dwellMs / 1000} receipt-clock s`],
    ['Hover observation', `${cfg.hoverDurationMs / 1000} simulation s after takeoff completion`], ['Pulse schedule', `${cfg.pulseDelayMs / 1000} simulation s after hover begins; 8 N east for 1 simulation s`],
    ['Horizontal recovery error', `≤ ${cfg.recoveryToleranceM} m from initial world E/N`], ['Recovery speed / dwell', `3D speed ≤ ${cfg.recoverySpeedMps} m/s for ${cfg.recoveryDwellMs / 1000} simulation s`], ['Recovery truth-sample gap', `≤ ${cfg.truthMaxGapMs} simulation ms`],
    ['Landing completion', 'Previously airborne; fresh on-ground and disarmed telemetry'],
  ]);
  for (const [id, available] of [['pulse', trace.cases.some(item => item.pulse)], ['estimate', trace.cases.some(item => item.pulse)], ['recovery', trace.cases.some(item => item.pulse)]]) $(`#gazebo-inspect-${id}`).disabled = !available;
  for (const row of document.querySelectorAll('#gazebo-comparison tr')) row.dataset.selected = String(row.dataset.case === run.id);
  render();
}
function renderComparison() {
  $('#gazebo-comparison').replaceChildren(...trace.cases.map(item => {
    const summary = gazeboSummary(item), row = el('tr', '', { 'data-case': item.id }), first = el('td'), button = el('button', item.label, { 'data-gazebo-compare': item.id }); button.addEventListener('click', () => setCase(item.id)); first.append(button);
    const force = el('td', item.pulse ? `${vector(item.pulse.forceEnu)} N` : 'No pulse');
    force.append(el('small', item.pulse ? `Applied impulse ${vector(summary.impulseNs)} N·s` : 'Same hover and controller', { class: 'gazebo-table-note' }));
    const recovery = el('td', !item.pulse ? 'Not applicable' : summary.recoveryDurationMs === null ? 'Not observed within hover window' : `${seconds(summary.recoveryDurationMs)} simulation time`);
    if (item.pulse && summary.recoveryDurationMs !== null) recovery.append(el('small', 'From observed force release to sustained horizontal recovery', { class: 'gazebo-table-note' }));
    row.append(first, force, el('td', metres(summary.maxHorizontalDeviationM)), recovery, el('td', summary.flightCompleted ? 'Landed + disarmed' : 'No measured landing')); return row;
  }));
}
function setTrace(next, description) {
  trace = next; source = description; $('#gazebo-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id }))); renderComparison(); setCase(trace.cases.find(item => item.id === 'pulse')?.id ?? trace.cases[0].id);
}
function renderChart(frame) {
  const left = 48, right = 540, top = 22, bottom = 182, ceiling = Math.max(.5, Math.ceil((gazeboSummary(run).maxHorizontalDeviationM ?? 0) * 2) / 2);
  const chart = svg('svg', { viewBox: '0 0 560 230', role: 'img', 'aria-label': 'Horizontal distance of the recorded Gazebo world pose from the hover target, shown only through the replay cursor. The force application interval is shaded.' });
  const x = stamp => left + stamp / run.endMs * (right - left), y = distance => bottom - distance / ceiling * (bottom - top);
  const edges = gazeboSummary(run);
  if (edges.pulseStartMs !== null && edges.pulseStartMs <= timeMs) chart.append(svg('rect', { x: x(edges.pulseStartMs), y: top, width: Math.max(1, x(Math.min(timeMs, edges.pulseEndMs ?? timeMs)) - x(edges.pulseStartMs)), height: bottom - top, fill: '#f5dfce' }));
  for (let i = 0; i <= 4; i++) { const value = ceiling * i / 4; chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#dce4d5' }), svg('text', { x: left - 8, y: y(value) + 3, 'text-anchor': 'end', fill: '#71816d', 'font-size': 10 }, value.toFixed(2))); }
  const points = []; let previousDistance;
  for (const row of frame.truthTrajectory) { const distance = Math.hypot(row.positionEnu[0] - run.originTruthEnu[0], row.positionEnu[1] - run.originTruthEnu[1]); if (previousDistance !== undefined) points.push([x(row.timeMs), y(previousDistance)]); points.push([x(row.timeMs), y(distance)]); previousDistance = distance; }
  if (previousDistance !== undefined) points.push([x(timeMs), y(previousDistance)]);
  chart.append(svg('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: '#39745a', 'stroke-width': 2, 'data-gazebo-displacement-trail': '' }));
  chart.append(svg('line', { x1: left, x2: x(timeMs), y1: y(run.config.recoveryToleranceM), y2: y(run.config.recoveryToleranceM), stroke: '#bd9355', 'stroke-dasharray': '5 4' }), svg('line', { x1: x(timeMs), x2: x(timeMs), y1: top, y2: bottom, stroke: '#637b64', 'stroke-dasharray': '3 4' }));
  for (let i = 0; i <= 4; i++) chart.append(svg('text', { x: x(run.endMs * i / 4), y: 201, 'text-anchor': 'middle', fill: '#71816d', 'font-size': 10 }, `${(run.endMs * i / 4000).toFixed(1)} s`));
  chart.append(svg('text', { x: left, y: 12, fill: '#71816d', 'font-size': 10 }, 'HORIZONTAL ERROR / M'), svg('text', { x: left, y: 221, fill: '#71816d', 'font-size': 9 }, 'Receipt elapsed time · amber: recovery distance threshold · shaded: observed force'));
  $('#gazebo-response-chart').replaceChildren(chart);
}
function renderCommands(frame) {
  if (selectedCommand && !frame.commandStates.some(item => item.id === selectedCommand)) selectedCommand = null;
  $('#gazebo-commands').replaceChildren(...frame.commandStates.map(item => {
    const row = el('tr'), request = el('td'), button = el('button', stageNames[item.id], { 'data-gazebo-command': item.id }); button.addEventListener('click', () => { stop(); selectedCommand = item.id; render(); }); request.append(button, el('small', commandNames[item.id]));
    const response = el('td', item.ack ? `${resultNames[item.ack.result]} (${item.ack.result})` : 'Awaiting ACK'); if (item.ack) response.append(el('small', seconds(item.ack.timeMs)));
    row.append(request, el('td', seconds(item.command.timeMs)), response, el('td', item.completionEvent ? `Observed ${seconds(item.completionEvent.timeMs)}` : 'Not completed yet')); return row;
  }));
  const selected = frame.commandStates.find(item => item.id === selectedCommand) ?? frame.commandStates.at(-1) ?? null;
  for (const button of document.querySelectorAll('[data-gazebo-command]')) button.setAttribute('aria-pressed', String(button.dataset.gazeboCommand === selected?.id));
  $('#gazebo-request-title').textContent = selected ? `${stageNames[selected.id]} / exact MAVLink request and evidence` : 'Request envelope at the cursor';
  $('#gazebo-request-envelope').textContent = JSON.stringify({ command: selected?.command ?? null, ack: selected?.ack ?? null, completion: selected?.completionEvent ?? null }, null, 2);
  $('#gazebo-command-note').textContent = 'The companion advances flight stages using received telemetry. Gazebo world pose and the evaluator’s horizontal recovery test are separate observations. A force intervention is not a MAVLink flight command.';
}
function render() {
  if (!run) return;
  const frame = gazeboFrame(run, timeMs), summary = gazeboSummary(run), phase = stageNames[frame.stage] ?? frame.stage;
  view.update(run, frame); $('#gazebo-time-slider').value = String(timeMs); setText('#gazebo-time', seconds(timeMs)); $('#gazebo-time').dataset.timeMs = String(timeMs);
  setText('#gazebo-play', playing ? 'Ⅱ Pause trace' : timeMs >= run.endMs ? '↻ Replay trace' : '▶ Play trace');
  $('#gazebo-play').disabled = false; $('#gazebo-reset').disabled = false; $('#gazebo-step').disabled = timeMs >= run.endMs;
  setText('#gazebo-status', playing ? 'Replaying recording' : timeMs >= run.endMs ? 'Recording complete' : 'Paused recording');
  setText('#gazebo-recording-summary', `${source} · ${run.label} · ${run.truth.length} world samples · ${run.telemetry.length} telemetry messages`);
  setText('#gazebo-phase-state', `${frame.mode ?? 'No heartbeat'} · ${frame.armed === null ? 'arming unknown' : frame.armed ? 'armed' : 'disarmed'} · ${landedNames[frame.landedState] ?? 'no landing state'}`);
  const forceLabels = { 'not-requested': run.pulse ? 'Force not requested yet' : 'No external force', requested: 'Force requested / application not observed yet', active: 'External force being applied', released: 'External force released' };
  setText('#gazebo-force-state', forceLabels[frame.pulsePhase]);
  setText('#gazebo-phase-note', `${phase}. ${frame.recovery ? `Horizontal recovery observed after ${seconds(frame.recovery.durationMs)} of simulator time from force release.` : run.pulse && frame.pulsePhase === 'released' ? 'The force has stopped; sustained horizontal recovery has not yet been observed.' : 'Inspect request, physics-world response and telemetry as separate evidence.'}`);
  setText('#gazebo-height', metres(frame.truth?.positionEnu[2] ?? null)); setText('#gazebo-truth-age', `IMU-link world-pose receipt age ${age(frame.truthAgeMs)}.`);
  const displacement = frame.truth ? Math.hypot(frame.truth.positionEnu[0] - run.originTruthEnu[0], frame.truth.positionEnu[1] - run.originTruthEnu[1]) : null;
  setText('#gazebo-displacement', metres(displacement)); $('#gazebo-displacement').dataset.value = String(displacement);
  setText('#gazebo-displacement-note', 'World E/N distance from the fixed grounded baseline.');
  setText('#gazebo-estimator-error', metres(frame.heldSeparationM)); $('#gazebo-estimator-error').dataset.value = String(frame.heldSeparationM);
  setText('#gazebo-pair-age', `Held samples · receipt skew ${age(frame.receiptSkewMs)}; not a synchronized accuracy measurement.`);
  setText('#gazebo-stage', frame.recovery && frame.stage !== 'land' ? 'Horizontal recovery' : phase);
  setText('#gazebo-stage-note', frame.recovery ? 'Recovery satisfies world-position, speed and simulation-time dwell checks.' : 'Completion requires recorded state evidence.');
  setText('#gazebo-outcome', timeMs >= run.endMs ? `${run.outcome.reason} ${run.pulse ? summary.recoveryMs === null ? 'Horizontal recovery was not observed during the hover window.' : `Horizontal recovery took ${seconds(summary.recoveryDurationMs)} of simulation time after force release.` : 'The nominal case had no external-force intervention.'}` : 'Recording in progress at this cursor; later outcomes remain in the complete-run comparison below.');
  setText('#gazebo-force-label', forceLabels[frame.pulsePhase]);
  setText('#gazebo-force-vector', frame.forceEnu ? `${vector(frame.forceEnu)} N` : 'No applied-force sample');
  setText('#gazebo-force-note', 'ENU vector = east, north, up. The custom Gazebo observer reports force application per physics step; the visible arrow has illustrative length.');
  const requested = run.pulse && timeMs >= run.pulse.requestTimeMs;
  detail($('#gazebo-force-details'), [['Pulse request received by cursor', requested ? seconds(run.pulse.requestTimeMs) : 'None'], ['Requested force / duration', requested ? `${vector(run.pulse.forceEnu)} N / ${run.pulse.durationMs} simulation ms` : 'Not yet requested'], ['Observed applied steps', frame.truth?.pulseAppliedSteps ?? 'No sample'], ['Accumulated impulse / ENU', frame.truth ? `${vector(frame.truth.impulseNs)} N·s` : 'No sample']]);
  $('#gazebo-force-envelope').textContent = JSON.stringify({ request: requested ? run.pulse : null, latestApplication: frame.truth ? { timeMs: frame.truth.timeMs, simTimeMs: frame.truth.simTimeMs, forceEnu: frame.truth.forceEnu, pulseActive: frame.truth.pulseActive, pulseAppliedSteps: frame.truth.pulseAppliedSteps, impulseNs: frame.truth.impulseNs } : null }, null, 2);
  detail($('#gazebo-recovery-details'), [['Horizontal tolerance', `${run.config.recoveryToleranceM} m`], ['World 3D speed at cursor', frame.truth ? `${Math.hypot(...frame.truth.velocityEnu).toFixed(3)} m/s` : 'No sample'], ['Speed threshold / dwell', `${run.config.recoverySpeedMps} m/s / ${run.config.recoveryDwellMs / 1000} simulation s`], ['Recovery observed by cursor', frame.recovery ? `${seconds(frame.recovery.simTimeMs)} simulator clock; receipt ${seconds(frame.recovery.timeMs)}` : run.pulse ? 'Not yet observed' : 'Not applicable without a pulse'], ['Delay after observed force release', frame.recovery ? `${seconds(frame.recovery.durationMs)} simulation time` : '—']]);
  setText('#gazebo-receipt-clock', seconds(timeMs)); setText('#gazebo-sim-clock', seconds(frame.simTimeMs));
  detail($('#gazebo-pose-details'), [['Gazebo IMU-link position / ENU', frame.truth ? `${vector(frame.truth.positionEnu)} m` : 'No world sample'], ['Estimated position / aligned ENU', frame.estimate ? `${vector(frame.estimate.positionEnu)} m` : 'No estimate'], ['World velocity / ENU', frame.truth ? `${vector(frame.truth.velocityEnu)} m/s` : 'No world sample'], ['Autopilot LOCAL_POSITION_NED boot time', frame.estimate ? `${frame.estimate.bootTimeMs} ms` : 'No estimate'], ['World / estimate receipt ages', `${age(frame.truthAgeMs)} / ${age(frame.estimateAgeMs)}`], ['Received roll / pitch / yaw', frame.attitude ? [frame.attitude.roll, frame.attitude.pitch, frame.attitude.yaw].map(value => `${(value * 180 / Math.PI).toFixed(2)}°`).join(' / ') : 'No attitude sample'], ['Attitude receipt age', age(frame.attitudeAgeMs)], ['Estimate − truth receipt timestamp', age(frame.receiptSkewMs)]]);
  setText('#gazebo-transform-note', 'NED → ENU swaps north/east and negates down. One fixed translation aligns the grounded baseline samples; it does not remove later drift. FLU-body world quaternions share the same scene transform. Displayed separation compares the latest held samples, not synchronized measurement accuracy.');
  $('#gazebo-pose-envelope').textContent = JSON.stringify({ world: frame.truth, localPosition: frame.latest.LOCAL_POSITION_NED, attitude: frame.latest.ATTITUDE, alignedEstimate: frame.estimate }, null, 2);
  renderChart(frame); renderCommands(frame);
}
function animate(now) {
  if (!playing || !run) return;
  if (previousTick !== null) timeMs = Math.min(run.endMs, timeMs + Math.min(now - previousTick, 100) * Number($('#gazebo-speed').value));
  previousTick = now; if (timeMs >= run.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(animate);
}
$('#gazebo-play').addEventListener('click', () => { if (!run) return; if (playing) stop(); else { if (timeMs >= run.endMs) timeMs = 0; playing = true; previousTick = null; animation = requestAnimationFrame(animate); } render(); });
$('#gazebo-step').addEventListener('click', () => { if (!run) return; const next = events.find(event => event.timeMs > timeMs + 1e-7); seek(next?.timeMs ?? run.endMs); });
$('#gazebo-reset').addEventListener('click', () => seek(0));
$('#gazebo-case').addEventListener('change', event => { if (trace) setCase(event.target.value); });
$('#gazebo-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
for (const mode of ['2d', '3d']) $(`#gazebo-${mode}`).addEventListener('click', () => view.setMode(mode));
for (const name of ['hover', 'pulse', 'release', 'peak', 'recovery', 'finish']) $(`#gazebo-${name}`).addEventListener('click', () => { if (run) seek(shortcuts()[name]); });
for (const name of ['estimate', 'trails']) $(`#gazebo-show-${name}`).addEventListener('change', () => view.setOptions({ showEstimate: $('#gazebo-show-estimate').checked, showTrails: $('#gazebo-show-trails').checked }));
for (const name of ['pulse', 'estimate', 'recovery']) $(`#gazebo-inspect-${name}`).addEventListener('click', () => {
  const chosen = trace?.cases.find(item => item.pulse); if (!chosen) return; setCase(chosen.id); const summary = gazeboSummary(chosen);
  seek(name === 'pulse' ? summary.pulseStartMs : name === 'estimate' ? summary.maxHorizontalDeviationMs : summary.recoveryMs ?? summary.hoverEndMs);
});
$('#gazebo-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; stop(); const epoch = ++importEpoch;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('The trace exceeds the 10 MB import limit.');
    const data = validateGazeboTrace(JSON.parse(await file.text())); if (epoch !== importEpoch) return;
    setTrace(data, 'Imported recording'); $('#gazebo-import-status').textContent = 'Imported and validated. Metadata is untrusted provenance.'; $('#gazebo-import-status').dataset.error = 'false';
  } catch (error) { if (epoch !== importEpoch) return; $('#gazebo-import-status').textContent = `Import rejected: ${error.message} The previous recording is retained.`; $('#gazebo-import-status').dataset.error = 'true'; render(); }
  finally { event.target.value = ''; }
});
$('#gazebo-bundled').addEventListener('click', () => { ++importEpoch; setTrace(validateGazeboTrace(bundled), 'Bundled recording'); $('#gazebo-import-status').textContent = 'Bundled, validated recording. Maximum import size: 10 MB.'; $('#gazebo-import-status').dataset.error = 'false'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
try { setTrace(validateGazeboTrace(bundled), source); view.setOptions({ showEstimate: true, showTrails: true }); view.setMode('3d'); }
catch (error) { $('#gazebo-status').textContent = 'Trace unavailable'; $('#gazebo-import-status').textContent = error.message; $('#gazebo-import-status').dataset.error = 'true'; }
