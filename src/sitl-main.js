import './style.css';
import './mission.css';
import './sitl.css';
import bundled from '../docs/results/ardupilot-sitl.json';
import { validateSitlTrace, sitlFrame, sitlEvents, sitlSummary, resultNames, landedNames } from './sitl-trace.js';
import { createSitlView } from './sitl-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attrs = {}) => { const node = document.createElement(tag); node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
const svg = (tag, attrs, text = '') => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); node.textContent = text; return node; };
const seconds = value => value === null || value === undefined ? '—' : `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(0)} ms`;
const metres = value => value === null || value === undefined ? '—' : `${value.toFixed(2)} m`;
const vector = value => value ? `[${value.map(axis => axis.toFixed(3)).join(', ')}]` : 'No received sample';
const degrees = value => `${(value * 180 / Math.PI).toFixed(1)}°`;
const stageNames = { ready: 'Ready', guided: 'Guided mode', arm: 'Arming', takeoff: 'Takeoff', waypoint: 'Waypoint', land: 'Landing', observation: 'Ground observation' };
const commandNames = { guided: 'DO_SET_MODE', arm: 'COMPONENT_ARM_DISARM', takeoff: 'NAV_TAKEOFF', waypoint: 'SET_POSITION_TARGET_LOCAL_NED', land: 'NAV_LAND' };
let trace, recording, events = [], timeMs = 0, source = 'Bundled recording', playing = false, animation, previousTick = null, importEpoch = 0, inspectorKey = '', selectedCommandId = null;
const view = createSitlView($('#sitl-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#sitl-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#sitl-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. The quadrotor holds the latest received position and attitude. Yard geometry is illustrative; local height is relative to the recorded origin.'
      : 'Top view: east / north. Side view: north / height relative to the recorded local origin. Both show the same held position sample and cursor as 3D.');
  },
});
function detail(list, pairs) { list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; })); }
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { stop(); timeMs = Math.max(0, Math.min(recording.endMs, value)); render(); }
const completedAt = (run, id) => run.events.find(event => event.stage === id && event.status === 'complete')?.timeMs ?? null;
const takeoffAckAt = run => run.acks.find(ack => ack.commandId === 'takeoff')?.timeMs ?? null;
function configureShortcuts() {
  for (const [id, value] of [['takeoff', takeoffAckAt(recording)], ['height', completedAt(recording, 'takeoff')], ['waypoint', completedAt(recording, 'waypoint')], ['landed', completedAt(recording, 'land')]]) {
    const button = $(`#sitl-${id}`); button.disabled = value === null; button.title = value === null ? 'No such observation in this recording.' : `Seek to ${seconds(value)}`;
  }
}
function setCase(id) {
  stop(); recording = trace.cases.find(run => run.id === id) ?? trace.cases[0]; timeMs = 0; events = sitlEvents(recording); inspectorKey = ''; selectedCommandId = null;
  $('#sitl-case').value = recording.id; $('#sitl-time-slider').max = recording.endMs;
  $('#sitl-case-description').textContent = recording.id === 'nominal'
    ? 'A normal arming request precedes takeoff. The companion advances only after the recorded telemetry satisfies each completion criterion.'
    : 'The companion requests Guided mode, then takeoff while the vehicle remains disarmed. Inspect the negative acknowledgement and the following bounded ground observation.';
  const runtime = trace.runtime;
  detail($('#sitl-provenance'), [
    ['Source', source], ['Recorded at', runtime.recordedAt], ['Run ID', recording.runId],
    ['Autopilot', runtime.ardupilotVersion], ['Firmware Git hash', runtime.firmwareGitHash], ['Vehicle model / speedup', `${runtime.model} / ${runtime.speedup}×`],
    ['MAVLink version / transport', `${runtime.mavlinkVersion} / ${runtime.transport}`], ['Vehicle system / component', `${recording.vehicle.systemId} / ${recording.vehicle.componentId}`], ['Companion system / component', `${recording.controller.systemId} / ${recording.controller.componentId}`],
    ['Recorded clock', runtime.clock], ['pymavlink / Python', `${runtime.pymavlink} / ${runtime.python}`], ['Platform', runtime.platform],
    ['Image', runtime.image], ['Base image', runtime.baseImage ?? 'Not declared'], ['Binary URL', runtime.binaryUrl], ['Binary SHA-256', runtime.binarySha256],
    ['Recorder source SHA-256', runtime.sourceSha256], ['Parameters SHA-256', runtime.paramsSha256], ['Recorded local origin / NED', `${vector(recording.originNed)} m`],
    ['Actual critical parameters', JSON.stringify(recording.parameters)], ['Setup duration before time zero', seconds(recording.setup?.durationMs)], ['Runtime dependencies', JSON.stringify(runtime.dependencies ?? {})],
  ]);
  const cfg = recording.config;
  detail($('#sitl-criteria'), [
    ['Takeoff height / above home', `${cfg.takeoffAltitudeM} m ± ${cfg.takeoffToleranceM} m`], ['Takeoff and waypoint speed', `≤ ${cfg.speedToleranceMps} m/s (3D speed)`],
    ['Waypoint / local-origin NED offset', `${vector(cfg.waypointOffsetNed)} m`], ['Waypoint position error', `≤ ${cfg.positionToleranceM} m (3D distance)`], ['Continuous good observations', `${cfg.dwellMs / 1000} s; position gaps ≤ ${cfg.maxSampleGapMs} ms`],
    ['Height telemetry freshness', `≤ ${cfg.freshnessMs} ms at the position check`], ['Landing completion', `Previously airborne; fresh on-ground + disarmed reports (≤ ${cfg.landedFreshnessMs} ms)`],
    ['Takeoff / waypoint / land budgets', `${cfg.takeoffTimeoutMs / 1000} / ${cfg.waypointTimeoutMs / 1000} / ${cfg.landTimeoutMs / 1000} s`], ['ACK / rejection observation budgets', `${cfg.ackTimeoutMs / 1000} / ${cfg.rejectionObserveMs / 1000} s`],
  ]);
  configureShortcuts();
  for (const row of document.querySelectorAll('#sitl-comparison tr')) row.dataset.selected = String(row.dataset.case === recording.id);
  $('#sitl-inspect-ack').disabled = !trace.cases.some(run => run.id === 'nominal' && takeoffAckAt(run) !== null);
  $('#sitl-inspect-flight').disabled = !trace.cases.some(run => run.id === 'nominal' && run.commands.some(command => command.id === 'waypoint'));
  $('#sitl-inspect-rejection').disabled = !trace.cases.some(run => run.id === 'disarmed');
  render();
}
function renderComparison() {
  $('#sitl-comparison').replaceChildren(...trace.cases.map(run => {
    const summary = sitlSummary(run), row = el('tr', '', { 'data-case': run.id }), first = el('td'), button = el('button', run.label, { 'data-sitl-compare': run.id });
    button.addEventListener('click', () => setCase(run.id)); first.append(button);
    const ack = run.acks.filter(item => item.commandId === 'takeoff').at(-1), ackCell = el('td', ack ? `${resultNames[ack.result]} (${ack.result})` : 'No response observed');
    if (ack) ackCell.append(el('small', `at ${seconds(ack.timeMs)}`, { class: 'sitl-table-note' }));
    const outcome = el('td', summary.outcome.status === 'completed' ? 'Landed + disarmed' : summary.outcome.status === 'rejected' ? 'Command rejected' : 'Timed out');
    outcome.append(el('small', summary.outcome.reason, { class: 'sitl-table-note' }));
    if (summary.ackToTakeoffMs !== null) outcome.append(el('small', `Takeoff ACK → height criterion: ${seconds(summary.ackToTakeoffMs)}`, { class: 'sitl-table-note' }));
    row.append(first, ackCell, el('td', metres(summary.maxRelativeAltitudeM)), outcome, el('td', seconds(run.endMs))); return row;
  }));
}
function setTrace(next, description) {
  trace = next; source = description;
  $('#sitl-case').replaceChildren(...trace.cases.map(run => el('option', run.label, { value: run.id })));
  renderComparison(); setCase(trace.cases.find(run => run.id === 'nominal')?.id ?? trace.cases[0].id);
}
function renderCommandTimeline(frame) {
  const width = 560, x0 = 105, right = 535, rows = ['guided', 'arm', 'takeoff', 'waypoint', 'land'], chart = svg('svg', { viewBox: `0 0 ${width} 225`, role: 'img', 'aria-label': 'Command timeline up to the cursor: circles are requests, squares are acknowledgements and diamonds are observed completion. No future events are shown.' });
  const x = time => x0 + time / recording.endMs * (right - x0);
  for (let i = 0; i < 5; i++) { const y = 28 + i * 29; chart.append(svg('text', { x: 94, y: y + 4, 'text-anchor': 'end', fill: '#586e5c', 'font-size': 10 }, stageNames[rows[i]]), svg('line', { x1: x0, x2: right, y1: y, y2: y, stroke: '#d9e2d3' })); }
  for (const state of frame.commandStates) {
    const y = 28 + rows.indexOf(state.id) * 29;
    chart.append(svg('circle', { cx: x(state.command.timeMs), cy: y, r: 4.5, fill: '#47765d' }));
    if (state.ack) chart.append(svg('rect', { x: x(state.ack.timeMs) - 4.5, y: y - 4.5, width: 9, height: 9, fill: state.admission === 'rejected' ? '#ab5c40' : '#c99b5d' }));
    if (state.completionEvent) { const px = x(state.completionEvent.timeMs); chart.append(svg('path', { d: `M${px} ${y-6}l6 6-6 6-6-6Z`, fill: '#316d57' })); }
  }
  chart.append(svg('line', { x1: x(timeMs), x2: x(timeMs), y1: 13, y2: 160, stroke: '#273e30', 'stroke-dasharray': '3 3', opacity: .75 }));
  for (let i = 0; i <= 4; i++) chart.append(svg('text', { x: x(recording.endMs * i / 4), y: 179, 'text-anchor': 'middle', fill: '#6e7e6c', 'font-size': 9 }, `${(recording.endMs * i / 4000).toFixed(1)} s`));
  chart.append(svg('text', { x: 24, y: 209, fill: '#62735e', 'font-size': 10 }, '● Request     ■ ACK result     ◆ Completion observed     ┊ Replay cursor'));
  $('#sitl-command-timeline').replaceChildren(chart);
}
function renderAltitudeChart(frame) {
  const width = 560, height = 235, left = 48, right = 542, top = 20, bottom = 190;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Estimated height above home up to ${seconds(timeMs)}. Step plot holds the latest received GLOBAL_POSITION_INT sample. Dashed amber line is requested takeoff height.` });
  const global = recording.telemetry.filter(sample => sample.type === 'GLOBAL_POSITION_INT' && sample.timeMs <= timeMs);
  const ceiling = Math.max(5, ...recording.telemetry.filter(sample => sample.type === 'GLOBAL_POSITION_INT').map(sample => Math.ceil(sample.data.relative_alt / 1000) + 1));
  const x = value => left + value / recording.endMs * (right - left), y = value => bottom - value / ceiling * (bottom - top);
  for (let i = 0; i <= 5; i++) { const value = ceiling * i / 5; chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#dce4d5' }), svg('text', { x: left - 8, y: y(value) + 3, 'text-anchor': 'end', fill: '#71816d', 'font-size': 10 }, value.toFixed(1))); }
  const takeoff = frame.commands.find(command => command.id === 'takeoff');
  if (takeoff) chart.append(svg('line', { x1: x(takeoff.timeMs), x2: x(timeMs), y1: y(recording.config.takeoffAltitudeM), y2: y(recording.config.takeoffAltitudeM), stroke: '#bd9355', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
  if (global.length) {
    const points = []; let previous;
    for (const sample of global) { const value = sample.data.relative_alt / 1000; if (previous) points.push([x(sample.timeMs), y(previous.data.relative_alt / 1000)]); points.push([x(sample.timeMs), y(value)]); previous = sample; }
    points.push([x(timeMs), y(global.at(-1).data.relative_alt / 1000)]);
    chart.append(svg('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: '#39745a', 'stroke-width': 2, 'data-sitl-altitude-trail': '' }));
    chart.append(svg('circle', { cx: x(timeMs), cy: y(global.at(-1).data.relative_alt / 1000), r: 4, fill: '#39745a' }));
  }
  chart.append(svg('line', { x1: x(timeMs), x2: x(timeMs), y1: top, y2: bottom, stroke: '#637b64', 'stroke-dasharray': '3 4' }));
  for (let i = 0; i <= 4; i++) chart.append(svg('text', { x: x(recording.endMs * i / 4), y: 209, 'text-anchor': 'middle', fill: '#71816d', 'font-size': 10 }, `${(recording.endMs * i / 4000).toFixed(1)} s`));
  chart.append(svg('text', { x: left, y: 12, fill: '#71816d', 'font-size': 10 }, 'METRES ABOVE HOME'));
  $('#sitl-altitude-chart').replaceChildren(chart);
}
function renderInspector(frame) {
  // A request is inspectable only after it was actually sent. Rewinding before
  // an explicit selection clears it, so ACKs and completion never leak ahead.
  if (selectedCommandId && !frame.commandStates.some(state => state.id === selectedCommandId)) selectedCommandId = null;
  const selected = frame.commandStates.find(state => state.id === selectedCommandId) ?? frame.commandStates.at(-1) ?? null;
  const key = `${recording.runId}/${frame.commands.length}/${frame.acks.length}/${frame.events.length}`;
  if (key !== inspectorKey) {
    inspectorKey = key;
    $('#sitl-commands').replaceChildren(...frame.commandStates.map(state => {
      const row = el('tr'), request = el('td'), button = el('button', stageNames[state.id], { 'data-command-event': state.id, 'aria-label': `Inspect ${stageNames[state.id]} request` }); button.addEventListener('click', () => { stop(); selectedCommandId = state.id; render(); $('#sitl-request-inspector').open = true; }); request.append(button, el('small', commandNames[state.id]));
      const ack = el('td', state.command.kind === 'setpoint' ? 'Not applicable' : state.ack ? `${resultNames[state.ack.result]} (${state.ack.result})` : 'Awaiting ACK', { 'data-rejected': String(state.admission === 'rejected') });
      if (state.ack) ack.append(el('small', seconds(state.ack.timeMs))); else if (state.command.kind === 'setpoint') ack.append(el('small', 'Setpoint message has no COMMAND_ACK.'));
      const terminal = frame.events.find(event => event.stage === state.id && ['timeout', 'rejected'].includes(event.status));
      const evidence = el('td', state.completionEvent ? `Observed at ${seconds(state.completionEvent.timeMs)}` : terminal ? `${terminal.status === 'timeout' ? 'Timed out' : 'Rejected'} at ${seconds(terminal.timeMs)}` : 'Not completed yet');
      row.append(request, el('td', (state.command.timeMs / 1000).toFixed(3)), ack, evidence); return row;
    }));
  }
  for (const button of document.querySelectorAll('[data-command-event]')) button.setAttribute('aria-pressed', String(button.dataset.commandEvent === selected?.id));
  $('#sitl-request-title').textContent = selected ? `${stageNames[selected.id]} / exact request and received evidence` : 'Request envelope at the cursor';
  $('#sitl-request-envelope').textContent = JSON.stringify({ command: selected?.command ?? null, ack: selected?.ack ?? null, completionEvent: selected?.completionEvent ?? null }, null, 2);
  $('#sitl-request-envelope').dataset.command = selected?.id ?? '';
  $('#sitl-request-seek').disabled = !selected;
  $('#sitl-request-note').textContent = !selected ? 'No request has been sent at this cursor. Advance the recording to inspect an envelope.'
    : `${commandNames[selected.id]} sent at ${seconds(selected.command.timeMs)}. ${selected.command.kind === 'setpoint' ? 'A setpoint has no COMMAND_ACK.' : selected.ack ? `ACK ${resultNames[selected.ack.result]} received at ${seconds(selected.ack.timeMs)}.` : 'No ACK received yet.'} ${selected.completionEvent ? `Completion observed at ${seconds(selected.completionEvent.timeMs)}.` : 'No completion observed yet.'} Select another row without changing the cursor.`;
  const takeoff = frame.commandStates.find(state => state.id === 'takeoff');
  $('#sitl-command-note').textContent = takeoff?.admission === 'rejected'
    ? `The autopilot returned ${resultNames[takeoff.ack.result].toUpperCase()} (${takeoff.ack.result}) for takeoff. Inspect the subsequent height and arming observations; a rejected request is not a flight.`
    : takeoff?.admission === 'accepted' && !takeoff.completionEvent ? 'Takeoff was accepted, but its measured height and dwell criterion has not yet completed. Continue the recording to observe the response.'
    : frame.commands.some(command => command.kind === 'setpoint') ? 'The waypoint is a position setpoint, so no COMMAND_ACK is expected for it. Its completion is checked using received position and speed. LAND subsequently changes mode; the last position marker is historical.'
    : 'Request, acknowledgement and measured state are different observations. The companion does not infer successful flight from command acceptance.';
  $('#sitl-command-note').dataset.history = String(takeoff?.admission === 'rejected');
  const latestEvent = events.filter(event => event.timeMs <= timeMs && event.kind !== 'telemetry').at(-1);
  $('#sitl-envelope').textContent = latestEvent ? JSON.stringify(latestEvent, null, 2) : 'No command, acknowledgement or stage observation at this cursor.';
  const global = frame.latest.GLOBAL_POSITION_INT, local = frame.latest.LOCAL_POSITION_NED, attitude = frame.latest.ATTITUDE;
  const waypoint = frame.commands.find(command => command.id === 'waypoint'), landing = frame.commands.some(command => command.id === 'land');
  const heightError = takeoff && frame.relativeAltitudeM !== null ? Math.abs(frame.relativeAltitudeM - recording.config.takeoffAltitudeM) : null;
  const waypointError = waypoint && frame.positionNed ? Math.hypot(...frame.positionNed.map((value, index) => value - waypoint.positionNed[index])) : null;
  setText('#sitl-height-error', heightError === null ? '—' : `${heightError.toFixed(3)} m`); $('#sitl-height-error').dataset.value = String(heightError);
  setText('#sitl-height-error-note', !takeoff ? 'No takeoff request sent.' : heightError === null ? 'Awaiting height telemetry.' : `${waypoint || landing ? 'Historical takeoff target. ' : ''}|received height above home − ${recording.config.takeoffAltitudeM} m|. Height age ${age(timeMs - global.timeMs)}; error alone does not establish completion.`);
  setText('#sitl-waypoint-error', waypointError === null ? '—' : `${waypointError.toFixed(3)} m`); $('#sitl-waypoint-error').dataset.value = String(waypointError); $('#sitl-waypoint-error').dataset.historical = String(Boolean(waypoint && landing));
  setText('#sitl-waypoint-error-label', landing && waypoint ? 'Historical waypoint error / local NED' : 'Waypoint position error / local NED');
  setText('#sitl-waypoint-error-note', !waypoint ? 'No waypoint sent.' : waypointError === null ? 'Awaiting position telemetry.' : `${landing ? 'LAND has begun; this is distance to the last waypoint, not an active landing target. ' : '3D distance to the sent local NED position. '}Position age ${age(frame.positionAgeMs)}; speed and dwell are separate criteria.`);
  detail($('#sitl-telemetry-details'), [
    ['Raw local position / NED', `${vector(frame.positionNed)}${frame.positionNed ? ' m' : ''}`], ['Scene position / east, north, up', `${vector(frame.positionEnu)}${frame.positionEnu ? ' m' : ''}`],
    ['Height above home / GLOBAL_POSITION_INT', metres(frame.relativeAltitudeM)], ['Height receipt / age', global ? `${seconds(global.timeMs)} / ${age(timeMs - global.timeMs)}` : 'No sample'],
    ['Position receipt / age', local ? `${seconds(local.timeMs)} / ${age(frame.positionAgeMs)}` : 'No sample'], ['Vehicle position timestamp', local ? `${local.data.time_boot_ms} ms since vehicle boot` : 'No sample'],
    ['Velocity / NED', frame.velocityNed ? `${vector(frame.velocityNed)} m/s` : 'No sample'], ['3D speed', frame.speedMps === null ? '—' : `${frame.speedMps.toFixed(3)} m/s`],
    ['Roll / pitch / yaw', frame.attitude ? `${degrees(frame.attitude.roll)} / ${degrees(frame.attitude.pitch)} / ${degrees(frame.attitude.yaw)}` : 'No sample'], ['Attitude receipt / age', attitude ? `${seconds(attitude.timeMs)} / ${age(frame.attitudeAgeMs)}` : 'No sample'],
    ['Heartbeat receipt / age', frame.latest.HEARTBEAT ? `${seconds(frame.latest.HEARTBEAT.timeMs)} / ${age(frame.heartbeatAgeMs)}` : 'No sample'], ['Landed state receipt / age', frame.latest.EXTENDED_SYS_STATE ? `${seconds(frame.latest.EXTENDED_SYS_STATE.timeMs)} / ${age(frame.landedAgeMs)}` : 'No sample'],
    ['Last position target / NED', frame.targetNed ? `${vector(frame.targetNed)} m${frame.commands.some(command => command.id === 'waypoint') ? '' : ' (takeoff approximation)'}` : 'No target sent'],
    ['Latest autopilot status text', frame.statuses.at(-1) ? `${frame.statuses.at(-1).text} / ${seconds(frame.statuses.at(-1).timeMs)}` : 'None received'],
  ]);
  renderCommandTimeline(frame); renderAltitudeChart(frame);
}
function render() {
  const frame = sitlFrame(recording, timeMs); view.update(recording, frame);
  $('#sitl-play').disabled = timeMs >= recording.endMs; $('#sitl-step').disabled = timeMs >= recording.endMs; $('#sitl-reset').disabled = false;
  setText('#sitl-play', playing ? 'Ⅱ Pause trace' : '▶ Play trace'); $('#sitl-play').setAttribute('aria-pressed', String(playing));
  $('#sitl-time-slider').value = timeMs; setText('#sitl-time', seconds(timeMs));
  setText('#sitl-status', timeMs >= recording.endMs ? 'Recorded end reached' : playing ? 'Replaying recorded time' : 'Recorded replay paused');
  setText('#sitl-recording-summary', `${source} · ${trace.runtime.ardupilotVersion} · ${recording.telemetry.length} telemetry messages`);
  setText('#sitl-mode-state', `${frame.mode ?? 'No heartbeat'} · ${frame.armed === null ? 'arming unknown' : frame.armed ? 'ARMED' : 'DISARMED'}`);
  setText('#sitl-flight-state', `Landed state: ${landedNames[frame.landedState] ?? 'no report'}`);
  setText('#sitl-altitude', metres(frame.relativeAltitudeM));
  setText('#sitl-position-age', frame.latest.GLOBAL_POSITION_INT ? `Height age ${age(timeMs - frame.latest.GLOBAL_POSITION_INT.timeMs)} · position age ${age(frame.positionAgeMs)}` : 'No height estimate received.');
  setText('#sitl-mode', frame.mode ?? 'Unknown'); setText('#sitl-heartbeat-age', frame.armed === null ? 'No heartbeat received.' : `${frame.armed ? 'ARMED' : 'DISARMED'} · heartbeat age ${age(frame.heartbeatAgeMs)}`);
  setText('#sitl-attitude', frame.attitude ? `${degrees(frame.attitude.roll)} · ${degrees(frame.attitude.pitch)} · ${degrees(frame.attitude.yaw)}` : '—');
  setText('#sitl-attitude-age', frame.attitude ? `Attitude age ${age(frame.attitudeAgeMs)}` : 'No attitude received.');
  const stageEvent = frame.events.at(-1);
  setText('#sitl-stage', stageNames[frame.stage]); setText('#sitl-stage-note', stageEvent ? `${stageEvent.status === 'start' ? 'Requested' : stageEvent.status === 'complete' ? 'Criterion observed' : stageEvent.status} at ${seconds(stageEvent.timeMs)}` : 'No command issued at this cursor.');
  setText('#sitl-phase-note', stageEvent ? `${stageNames[stageEvent.stage]} / ${stageEvent.status} at ${seconds(stageEvent.timeMs)}. Position and attitude hold their latest received samples.` : 'The recorder is ready. Awaiting the first request and telemetry receipts.');
  const takeoff = frame.commandStates.find(state => state.id === 'takeoff');
  const outcome = frame.outcome ? `${frame.outcome.status === 'completed' ? 'Flight completed' : frame.outcome.status === 'rejected' ? 'Command rejected' : 'Timed out'}: ${frame.outcome.reason}`
    : takeoff?.admission === 'rejected' ? `Takeoff returned ${resultNames[takeoff.ack.result].toUpperCase()} (${takeoff.ack.result}). The bounded observation is still in progress; inspect whether the vehicle stays disarmed and on the ground.`
    : takeoff?.admission === 'accepted' && !takeoff.completionEvent ? 'Takeoff accepted. Height and settling conditions have not yet been observed: ACK is not completion.'
    : frame.completedStages.includes('takeoff') && !frame.completedStages.includes('waypoint') ? 'The takeoff height criterion has been observed. The next position target requires its own measured position and speed evidence.'
    : frame.completedStages.includes('waypoint') ? 'The waypoint criterion has been observed. Landing is complete only after fresh on-ground and disarmed reports, following an airborne observation.'
    : 'Follow the request, acknowledgement and telemetry independently. At this cursor, no completed flight has been established.';
  setText('#sitl-outcome', outcome); $('#sitl-outcome').dataset.status = frame.outcome?.status === 'completed' ? 'ready' : frame.outcome?.status === 'rejected' ? 'budget' : 'running';
  renderInspector(frame);
}
function tick(now) { if (!playing) return; if (previousTick !== null) timeMs = Math.min(recording.endMs, timeMs + (now - previousTick) * Number($('#sitl-speed').value)); previousTick = now; if (timeMs >= recording.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(tick); }
$('#sitl-play').addEventListener('click', () => { if (playing) stop(); else if (timeMs < recording.endMs) { playing = true; previousTick = null; animation = requestAnimationFrame(tick); } render(); });
$('#sitl-step').addEventListener('click', () => seek(events.find(event => event.timeMs > timeMs)?.timeMs ?? recording.endMs));
$('#sitl-reset').addEventListener('click', () => seek(0)); $('#sitl-time-slider').addEventListener('input', event => seek(Number(event.target.value))); $('#sitl-case').addEventListener('change', event => setCase(event.target.value));
$('#sitl-takeoff').addEventListener('click', () => { const value = takeoffAckAt(recording); if (value !== null) seek(value); });
for (const [id, stage] of [['height', 'takeoff'], ['waypoint', 'waypoint'], ['landed', 'land']]) $(`#sitl-${id}`).addEventListener('click', () => { const value = completedAt(recording, stage); if (value !== null) seek(value); });
$('#sitl-finish').addEventListener('click', () => seek(recording.endMs));
$('#sitl-request-seek').addEventListener('click', () => {
  const frame = sitlFrame(recording, timeMs), selected = frame.commandStates.find(state => state.id === selectedCommandId) ?? frame.commandStates.at(-1);
  if (selected) { selectedCommandId = selected.id; seek(selected.command.timeMs); }
});
for (const mode of ['2d', '3d']) $(`#sitl-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#sitl-inspect-ack').addEventListener('click', () => { const run = trace.cases.find(item => item.id === 'nominal'); if (run) { setCase(run.id); seek(takeoffAckAt(run) ?? 0); } });
$('#sitl-inspect-flight').addEventListener('click', () => { const run = trace.cases.find(item => item.id === 'nominal'); if (run) { const summary = sitlSummary(run); setCase(run.id); if (summary.waypointSentMs !== null) seek((summary.waypointSentMs + (summary.waypointReachedMs ?? summary.waypointSentMs)) / 2); } });
$('#sitl-inspect-rejection').addEventListener('click', () => { const run = trace.cases.find(item => item.id === 'disarmed'); if (run) { setCase(run.id); seek(takeoffAckAt(run) ?? run.endMs); } });
$('#sitl-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const epoch = ++importEpoch, status = $('#sitl-import-status'); stop(); render();
  try { if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB import limit.'); const text = await file.text(); if (epoch !== importEpoch) return; const next = validateSitlTrace(JSON.parse(text)); setTrace(next, 'Imported recording'); status.dataset.error = 'false'; status.textContent = `Imported ${file.name}. Structure checked; provenance is not authenticated.`; }
  catch (error) { if (epoch !== importEpoch) return; status.dataset.error = 'true'; status.textContent = `Import rejected. ${error.message} The active recording was kept.`; }
  finally { if (epoch === importEpoch) event.target.value = ''; }
});
$('#sitl-bundled').addEventListener('click', () => { importEpoch++; $('#sitl-import').value = ''; setTrace(validateSitlTrace(bundled), 'Bundled recording'); $('#sitl-import-status').dataset.error = 'false'; $('#sitl-import-status').textContent = 'Bundled, validated recording restored. Maximum import size: 10 MB.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); }, { once: true });
setTrace(validateSitlTrace(bundled), 'Bundled recording'); view.setMode('3d');
