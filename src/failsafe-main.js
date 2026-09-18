import './style.css';
import './mission.css';
import './failsafe.css';
import bundled from '../docs/results/ardupilot-failsafe.json';
import { validateFailsafeTrace, failsafeFrame, failsafeEvents, failsafeSummary, resultNames, landedNames } from './failsafe-trace.js';
import { createFailsafeView } from './failsafe-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attrs = {}) => { const node = document.createElement(tag); node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
const svg = (tag, attrs, text = '') => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); node.textContent = text; return node; };
const seconds = value => value === null || value === undefined ? '—' : `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`;
const metres = value => value === null || value === undefined ? '—' : `${value.toFixed(3)} m`;
const stages = { ready: 'Ready', guided: 'Guided mode', arm: 'Arming', takeoff: 'Takeoff', observation: 'Flight observation', 'heartbeat-loss': 'Heartbeat suppression', failsafe: 'GCS failsafe', landing: 'Automatic landing', land: 'Requested landing' };
let trace, run, events = [], timeMs = 0, playing = false, animation, previousTick = null, source = 'Bundled recording', importEpoch = 0, selectedCommand = null;
const view = createFailsafeView($('#failsafe-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#failsafe-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#failsafe-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. GCS heartbeat and vehicle telemetry are separate logical paths on local TCP. The terminal, antenna, yard and rotors are illustrative.'
      : 'The directional diagram separates outgoing GCS heartbeats from received vehicle telemetry. Vertical position uses the same received estimate as 3D; ground-station placement is illustrative.');
  },
});
function detail(list, pairs) { list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; })); }
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { if (!run || value === null || value === undefined) return; stop(); timeMs = Math.max(0, Math.min(run.endMs, value)); render(); }
function shortcuts() { const summary = failsafeSummary(run); return { takeoff: summary.takeoffMs, stop: summary.lossStartMs, onset: summary.failsafeMs, restore: summary.restoreMs, clear: summary.clearMs, landed: summary.landedMs, finish: run.endMs }; }
function setCase(id) {
  stop(); run = trace.cases.find(item => item.id === id) ?? trace.cases[0]; timeMs = 0; events = failsafeEvents(run); selectedCommand = null;
  $('#failsafe-case').value = run.id; $('#failsafe-time-slider').max = String(run.endMs);
  $('#failsafe-case-description').textContent = run.id === 'loss'
    ? 'After takeoff, the GCS suppresses its 1 Hz heartbeat for 8 seconds, beginning 2 seconds into the 14-second observation. Vehicle telemetry remains active. No companion LAND or return-to-Guided command is sent.'
    : 'The GCS keeps sending its 1 Hz heartbeat throughout the same observation window. Afterward it explicitly requests LAND and measures landing and disarming.';
  for (const [name, value] of Object.entries(shortcuts())) { $(`#failsafe-${name}`).disabled = value === null; $(`#failsafe-${name}`).title = value === null ? 'No such observation in this recording.' : `Seek to ${seconds(value)}`; }
  for (const name of ['loss', 'onset', 'clear']) $(`#failsafe-inspect-${name}`).disabled = !trace.cases.some(item => item.id === 'loss');
  const rt = trace.runtime;
  detail($('#failsafe-provenance'), [['Source', source], ['Recorded at', rt.recordedAt], ['Run ID', run.runId], ['ArduPilot / model', `${rt.ardupilotVersion} / ${rt.model} (${rt.modelArgument})`], ['Firmware revision', rt.firmwareGitHash], ['Transport / protocol', `${rt.transport} / MAVLink ${rt.mavlinkVersion}`], ['GCS system : component', `${run.controller.systemId} : ${run.controller.componentId}`], ['Vehicle system : component', `${run.vehicle.systemId} : ${run.vehicle.componentId}`], ['Sends / receipts', `${rt.heartbeatClock} / ${rt.clock}`], ['Actual parameters read back', JSON.stringify(run.parameters)], ['Established setup heartbeat count', run.setup.heartbeatCount], ['Last setup send relative to origin', seconds(run.setup.lastHeartbeatBeforeOriginMs)], ['Setup duration', seconds(run.setup.durationMs)], ['pymavlink / Python', `${rt.pymavlink} / ${rt.python}`], ['Runtime image', rt.image], ['Base image', rt.baseImage], ['Recorder SHA-256', rt.sourceSha256], ['SITL helper SHA-256', rt.sitlSourceSha256], ['Dockerfile SHA-256', rt.dockerfileSha256], ['Parameters SHA-256', rt.paramsSha256], ['Official binary URL', rt.binaryUrl], ['Binary SHA-256', rt.binarySha256]]);
  const cfg = run.config;
  detail($('#failsafe-criteria'), [['Heartbeat interval / timeout', `${cfg.heartbeatIntervalMs / 1000} s / ${cfg.gcsTimeoutMs / 1000} s`], ['Observation / suppression', `${cfg.observationDurationMs / 1000} s / ${cfg.lossDurationMs / 1000} s`], ['Suppression begins after', `${cfg.lossDelayMs / 1000} s of observation`], ['Takeoff height / speed', `${cfg.takeoffAltitudeM} m ± ${cfg.takeoffToleranceM} m; 3D speed ≤ ${cfg.speedToleranceMps} m/s`], ['Takeoff dwell / maximum sample gap', `${cfg.dwellMs} ms / ${cfg.maxSampleGapMs} ms`], ['GCS-specific detection evidence', 'STATUSTEXT: GCS Failsafe / GCS Failsafe Cleared'], ['LAND mode evidence', 'Received vehicle HEARTBEAT custom_mode = 9'], ['Landing completion', `Previously airborne; on-ground + disarmed reports fresh within ${cfg.landedFreshnessMs} ms`]]);
  for (const row of document.querySelectorAll('#failsafe-comparison tr')) row.dataset.selected = String(row.dataset.case === run.id);
  render();
}
function renderComparison() {
  $('#failsafe-comparison').replaceChildren(...trace.cases.map(item => {
    const sum = failsafeSummary(item), row = el('tr', '', { 'data-case': item.id }), first = el('td'), button = el('button', item.label, { 'data-failsafe-compare': item.id }); button.addEventListener('click', () => setCase(item.id)); first.append(button);
    const status = el('td', sum.failsafeMs === null ? 'Not reported' : `Reported ${seconds(sum.failsafeMs)}`);
    if (sum.onsetSinceLastTxMs !== null) status.append(el('small', `${seconds(sum.onsetSinceLastTxMs)} after the last recorded GCS send; not receiver latency`, { class: 'failsafe-table-note' }));
    const landing = el('td', item.id === 'loss' ? 'Autopilot failsafe response' : 'Companion LAND command'); landing.append(el('small', sum.landedMs === null ? 'No measured completion' : `Landed + disarmed at ${seconds(sum.landedMs)}`, { class: 'failsafe-table-note' }));
    row.append(first, status, el('td', item.blackout ? `${sum.telemetryDuringLoss} received messages` : 'Not applicable'), el('td', sum.modeAfterRestore ?? 'Not applicable'), landing); return row;
  }));
}
function setTrace(next, description) { trace = next; source = description; $('#failsafe-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id }))); renderComparison(); setCase(trace.cases.find(item => item.id === 'loss')?.id ?? trace.cases[0].id); }
function renderChart(frame, kind) {
  const isAge = kind === 'heartbeat', ceiling = isAge ? (run.config.lossDurationMs + 2 * run.config.heartbeatIntervalMs) / 1000 : 5;
  const left = 46, right = 540, top = 20, bottom = 182, x = value => left + value / run.endMs * (right - left), y = value => bottom - value / ceiling * (bottom - top);
  const chart = svg('svg', { viewBox: '0 0 560 230', role: 'img', 'aria-label': isAge ? 'Recorder time since the last outgoing GCS heartbeat, using only sends already observed. The timeout reference does not infer autopilot state.' : 'Received estimated height above home, with recorded failsafe and clear observations only through the cursor.' });
  if (run.blackout && timeMs >= run.blackout.startTimeMs) chart.append(svg('rect', { x: x(run.blackout.startTimeMs), y: top, width: Math.max(0, x(Math.min(timeMs, run.blackout.endTimeMs)) - x(run.blackout.startTimeMs)), height: bottom - top, fill: '#f5e2d4' }));
  for (let i = 0; i <= 5; i++) { const value = ceiling * i / 5; chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#dce4d5' }), svg('text', { x: left - 8, y: y(value) + 3, 'text-anchor': 'end', fill: '#71816d', 'font-size': 10 }, value.toFixed(1))); }
  const points = [];
  if (isAge) {
    let previous;
    for (const row of run.heartbeatTx.filter(sample => sample.timeMs <= timeMs)) { if (previous) points.push([x(row.timeMs), y((row.timeMs - previous.timeMs) / 1000)]); points.push([x(row.timeMs), y(0)]); previous = row; }
    if (previous) points.push([x(timeMs), y((timeMs - previous.timeMs) / 1000)]);
    chart.append(svg('line', { x1: left, x2: x(timeMs), y1: y(run.config.gcsTimeoutMs / 1000), y2: y(run.config.gcsTimeoutMs / 1000), stroke: '#b98d54', 'stroke-dasharray': '5 4' }));
  } else {
    let previous;
    for (const row of run.telemetry.filter(sample => sample.type === 'GLOBAL_POSITION_INT' && sample.timeMs <= timeMs)) { if (previous) points.push([x(row.timeMs), y(previous.data.relative_alt / 1000)]); points.push([x(row.timeMs), y(row.data.relative_alt / 1000)]); previous = row; }
    if (previous) points.push([x(timeMs), y(previous.data.relative_alt / 1000)]);
  }
  chart.append(svg('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: isAge ? '#b48248' : '#39745a', 'stroke-width': 2, [`data-failsafe-${kind}-trail`]: '' }));
  for (const [event, color] of [[frame.failsafe.onset, '#b56f4c'], [frame.failsafe.clear, '#54806c']]) if (event) chart.append(svg('line', { x1: x(event.timeMs), x2: x(event.timeMs), y1: top, y2: bottom, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
  chart.append(svg('line', { x1: x(timeMs), x2: x(timeMs), y1: top, y2: bottom, stroke: '#344f3d' }));
  for (let i = 0; i <= 4; i++) chart.append(svg('text', { x: x(run.endMs * i / 4), y: 201, 'text-anchor': 'middle', fill: '#71816d', 'font-size': 10 }, `${(run.endMs * i / 4000).toFixed(1)} s`));
  chart.append(svg('text', { x: left, y: 12, fill: '#71816d', 'font-size': 10 }, isAge ? 'HOST AGE SINCE LAST GCS SEND / S' : 'ESTIMATED HEIGHT ABOVE HOME / M'), svg('text', { x: left, y: 221, fill: '#71816d', 'font-size': 9 }, 'Host elapsed time · shaded: suppression · dotted: recorded failsafe / clear'));
  $(`#failsafe-${isAge ? 'heartbeat' : 'altitude'}-chart`).replaceChildren(chart);
}
function renderRequests(frame) {
  if (selectedCommand && !frame.commandStates.some(item => item.id === selectedCommand)) selectedCommand = null;
  $('#failsafe-commands').replaceChildren(...frame.commandStates.map(item => {
    const row = el('tr'), first = el('td'), button = el('button', stages[item.id], { 'data-failsafe-command': item.id }); button.addEventListener('click', () => { stop(); selectedCommand = item.id; render(); }); first.append(button, el('small', `COMMAND_LONG ${item.command.command}`));
    row.append(first, el('td', seconds(item.command.timeMs)), el('td', item.ack ? `${resultNames[item.ack.result]} (${item.ack.result}) at ${seconds(item.ack.timeMs)}` : 'No ACK yet'), el('td', item.completionEvent ? `Observed ${seconds(item.completionEvent.timeMs)}` : 'Not completed yet')); return row;
  }));
  const selected = frame.commandStates.find(item => item.id === selectedCommand) ?? frame.commandStates.at(-1) ?? null;
  for (const button of document.querySelectorAll('[data-failsafe-command]')) button.setAttribute('aria-pressed', String(button.dataset.failsafeCommand === selected?.id));
  $('#failsafe-request-title').textContent = selected ? `${stages[selected.id]} / exact request and evidence` : 'Request envelope at the cursor';
  $('#failsafe-request-envelope').textContent = JSON.stringify({ command: selected?.command ?? null, ack: selected?.ack ?? null, completion: selected?.completionEvent ?? null }, null, 2);
  $('#failsafe-command-note').textContent = run.id === 'loss'
    ? frame.failsafe.landMode ? `LAND mode is reported at ${seconds(frame.failsafe.landMode.timeMs)}. No companion LAND command was sent; the configured autopilot failsafe selects the response. Landing completion remains a separate observation.` : 'The loss case contains no companion LAND or return-to-Guided command. Continue to inspect the autopilot’s mode and reported failsafe response.'
    : 'The nominal case keeps its GCS heartbeat and explicitly requests LAND after the observation window. Its command result and measured landing are separate records.';
}
function render() {
  if (!run) return;
  const frame = failsafeFrame(run, timeMs), sum = failsafeSummary(run), latestTelemetry = Object.values(frame.latest).filter(Boolean).sort((a, b) => b.timeMs - a.timeMs)[0] ?? null;
  view.update(run, frame); $('#failsafe-time-slider').value = String(timeMs); setText('#failsafe-time', seconds(timeMs)); $('#failsafe-time').dataset.timeMs = String(timeMs);
  setText('#failsafe-play', playing ? 'Ⅱ Pause trace' : timeMs >= run.endMs ? '↻ Replay trace' : '▶ Play trace'); $('#failsafe-play').disabled = false; $('#failsafe-reset').disabled = false; $('#failsafe-step').disabled = timeMs >= run.endMs;
  setText('#failsafe-status', playing ? 'Replaying recording' : timeMs >= run.endMs ? 'Recording complete' : 'Paused recording');
  setText('#failsafe-recording-summary', `${source} · ${run.label} · ${run.heartbeatTx.length} GCS sends · ${run.telemetry.length} vehicle telemetry messages`);
  setText('#failsafe-mode-state', `Vehicle: ${frame.mode ?? 'no heartbeat'} · ${frame.armed === null ? 'arming unknown' : frame.armed ? 'armed' : 'disarmed'}`); setText('#failsafe-flight-state', `Landing state: ${landedNames[frame.landedState] ?? 'no report'}`);
  setText('#failsafe-uplink-state', frame.gcs.enabled ? 'Heartbeat sending enabled' : 'GCS heartbeat suppressed');
  setText('#failsafe-uplink-note', `${frame.gcs.txCount} sends observed by this cursor. Last send ${seconds(frame.gcs.lastTx?.timeMs)}; sender-clock age ${age(frame.gcs.ageMs)}.`);
  setText('#failsafe-downlink-state', latestTelemetry ? 'Vehicle telemetry received' : 'No vehicle telemetry yet');
  setText('#failsafe-downlink-note', latestTelemetry ? `Latest ${latestTelemetry.type} receipt ${seconds(latestTelemetry.timeMs)}; age ${age(timeMs - latestTelemetry.timeMs)}. This is a separate message direction.` : 'An outgoing GCS heartbeat is not a received vehicle message.');
  setText('#failsafe-send-age', seconds(frame.gcs.ageMs)); $('#failsafe-send-age').dataset.value = String(frame.gcs.ageMs);
  setText('#failsafe-reported-state', frame.failsafe.active === null ? 'Not observed' : frame.failsafe.active ? 'Active / reported' : 'Cleared / reported'); $('#failsafe-reported-state').dataset.active = String(frame.failsafe.active);
  setText('#failsafe-reported-note', frame.failsafe.clear ? `“GCS Failsafe Cleared” received ${seconds(frame.failsafe.clear.timeMs)}.` : frame.failsafe.onset ? `“GCS Failsafe” received ${seconds(frame.failsafe.onset.timeMs)}.` : 'No GCS-specific status message has been received by this cursor.');
  setText('#failsafe-mode', `${frame.mode ?? 'Unknown'} / ${frame.armed === null ? 'unknown' : frame.armed ? 'armed' : 'disarmed'}`); setText('#failsafe-mode-age', `Vehicle HEARTBEAT receipt age ${age(frame.heartbeatAgeMs)}.`);
  setText('#failsafe-altitude', metres(frame.relativeAltitudeM)); $('#failsafe-altitude').dataset.value = String(frame.relativeAltitudeM);
  setText('#failsafe-position-age', `Height receipt age ${age(frame.latest.GLOBAL_POSITION_INT ? timeMs - frame.latest.GLOBAL_POSITION_INT.timeMs : null)}.`);
  setText('#failsafe-phase-note', frame.failsafe.clear ? `GCS failsafe cleared. Current reported mode: ${frame.mode ?? 'unknown'}. Clearing the condition does not issue a Guided-mode request.` : frame.failsafe.active ? 'GCS failsafe reported. The LAND response includes a 4-second pause before descent; inspect mode, height and landing reports separately.' : `${stages[frame.stage] ?? frame.stage}. Suppression, timeout detection and flight execution are different events.`);
  const resumed = sum.firstResumedHeartbeatMs !== null && sum.firstResumedHeartbeatMs <= timeMs;
  detail($('#failsafe-heartbeat-details'), [['Heartbeat source / message', 'GCS 255:190 / HEARTBEAT'], ['Configured send interval', `${run.config.heartbeatIntervalMs} ms`], ['Last outgoing send', seconds(frame.gcs.lastTx?.timeMs)], ['Sender-clock age at cursor', age(frame.gcs.ageMs)], ['Configured autopilot timeout', `${run.config.gcsTimeoutMs} ms (receiver-side check)`], ['Suppression started', run.blackout && timeMs >= run.blackout.startTimeMs ? seconds(run.blackout.startTimeMs) : 'Not observed'], ['Sending re-enabled', run.blackout && timeMs >= run.blackout.endTimeMs ? seconds(run.blackout.endTimeMs) : 'Not observed'], ['First actual resumed send', resumed ? seconds(sum.firstResumedHeartbeatMs) : 'Not observed']]);
  $('#failsafe-heartbeat-envelope').textContent = JSON.stringify(frame.gcs.lastTx, null, 2);
  detail($('#failsafe-response-details'), [['GCS failsafe reported', seconds(frame.failsafe.onset?.timeMs)], ['LAND mode first received', seconds(frame.failsafe.landMode?.timeMs)], ['GCS failsafe cleared', seconds(frame.failsafe.clear?.timeMs)], ['Measured landed + disarmed', seconds(frame.failsafe.landing?.timeMs)], ['Vehicle boot timestamp / position', frame.latest.LOCAL_POSITION_NED ? `${frame.latest.LOCAL_POSITION_NED.data.time_boot_ms} ms` : 'No sample'], ['Reported landing state', landedNames[frame.landedState] ?? 'Not received'], ['Vehicle system_status', frame.latest.HEARTBEAT ? `${frame.latest.HEARTBEAT.data.system_status} (generic vehicle status, not a GCS-specific detector)` : 'Not received']]);
  setText('#failsafe-restoration-note', frame.failsafe.clear ? `The heartbeat condition cleared; the latest vehicle mode is ${frame.mode ?? 'unknown'}. No automatic return-to-Guided request is sent. This is restored contact, not resumption of the original flight mode.` : frame.failsafe.landMode && run.id === 'loss' ? 'LAND has been reported. A 4-second failsafe landing pause can leave the height almost unchanged before descent; that does not mean the mode change failed.' : 'Mode, estimated height, reported contact state and measured landing are independent evidence streams.');
  $('#failsafe-statuses').replaceChildren(...frame.statuses.slice(-14).map(item => { const row = el('tr'); row.append(el('td', seconds(item.timeMs)), el('td', String(item.severity)), el('td', item.text)); return row; }));
  $('#failsafe-event-envelope').textContent = JSON.stringify(frame.failsafe, null, 2);
  setText('#failsafe-outcome', timeMs >= run.endMs ? `${run.outcome.reason} Final reported mode: ${sum.finalMode}; ${sum.finalArmed ? 'armed' : 'disarmed'}.` : 'The replay has not reached its final observation. Complete-run results are shown separately below.');
  renderChart(frame, 'heartbeat'); renderChart(frame, 'altitude'); renderRequests(frame);
}
function animate(now) { if (!playing || !run) return; if (previousTick !== null) timeMs = Math.min(run.endMs, timeMs + Math.min(now - previousTick, 100) * Number($('#failsafe-speed').value)); previousTick = now; if (timeMs >= run.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(animate); }
$('#failsafe-play').addEventListener('click', () => { if (!run) return; if (playing) stop(); else { if (timeMs >= run.endMs) timeMs = 0; playing = true; previousTick = null; animation = requestAnimationFrame(animate); } render(); });
$('#failsafe-step').addEventListener('click', () => { if (run) seek(events.find(item => item.timeMs > timeMs + 1e-7)?.timeMs ?? run.endMs); });
$('#failsafe-reset').addEventListener('click', () => seek(0)); $('#failsafe-case').addEventListener('change', event => { if (trace) setCase(event.target.value); }); $('#failsafe-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
for (const name of ['takeoff', 'stop', 'onset', 'restore', 'clear', 'landed', 'finish']) $(`#failsafe-${name}`).addEventListener('click', () => { if (run) seek(shortcuts()[name]); });
for (const mode of ['2d', '3d']) $(`#failsafe-${mode}`).addEventListener('click', () => view.setMode(mode));
for (const name of ['loss', 'onset', 'clear']) $(`#failsafe-inspect-${name}`).addEventListener('click', () => { const chosen = trace?.cases.find(item => item.id === 'loss'); if (!chosen) return; setCase(chosen.id); const summary = failsafeSummary(chosen); seek(name === 'loss' ? summary.lossStartMs : name === 'onset' ? summary.failsafeMs : summary.clearMs); });
$('#failsafe-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; stop(); const epoch = ++importEpoch;
  try { if (file.size > 10 * 1024 * 1024) throw new Error('The trace exceeds the 10 MB import limit.'); const next = validateFailsafeTrace(JSON.parse(await file.text())); if (epoch !== importEpoch) return; setTrace(next, 'Imported recording'); $('#failsafe-import-status').textContent = 'Imported and validated. Metadata is untrusted provenance.'; $('#failsafe-import-status').dataset.error = 'false'; }
  catch (error) { if (epoch !== importEpoch) return; $('#failsafe-import-status').textContent = `Import rejected: ${error.message} The previous recording is retained.`; $('#failsafe-import-status').dataset.error = 'true'; render(); }
  finally { event.target.value = ''; }
});
$('#failsafe-bundled').addEventListener('click', () => { ++importEpoch; setTrace(validateFailsafeTrace(bundled), 'Bundled recording'); $('#failsafe-import-status').textContent = 'Bundled, validated recording. Maximum import size: 10 MB.'; $('#failsafe-import-status').dataset.error = 'false'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } }); window.addEventListener('pagehide', () => { stop(); view.dispose(); });
try { setTrace(validateFailsafeTrace(bundled), source); view.setMode('3d'); } catch (error) { $('#failsafe-status').textContent = 'Trace unavailable'; $('#failsafe-import-status').textContent = error.message; $('#failsafe-import-status').dataset.error = 'true'; }
