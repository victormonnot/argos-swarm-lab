import './style.css';
import './mission.css';
import './fleet.css';
import bundled from '../docs/results/ardupilot-fleet.json';
import { validateFleetTrace, fleetFrame, fleetEvents, fleetSummary, resultNames, landedNames } from './fleet-trace.js';
import { createFleetView } from './fleet-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attrs = {}) => { const node = document.createElement(tag); node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
const seconds = value => value === null || value === undefined ? '—' : `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`;
const metres = value => value === null || value === undefined ? '—' : `${value.toFixed(3)} m`;
const vector = value => value ? `[${value.map(number => number.toFixed(3)).join(', ')}] m` : 'No sample';
const stages = { guided: 'Guided mode', arm: 'Arming', takeoff: 'Takeoff', waypoint: 'Task setpoint', land: 'Landing cleanup' };
const taskNames = { unassigned: 'Not assigned yet', assigned: 'Assigned / not sent', sent: 'Sent / awaiting completion', completed: 'Completed', 'not-reached': 'Not reached in window' };
let trace, run, events = [], timeMs = 0, selectedVehicle = 'A1', selectedCommand = null, playing = false, animation, previousTick = null, source = 'Bundled recording', importEpoch = 0;
const view = createFleetView($('#fleet-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#fleet-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#fleet-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. Select A1 or A2 and use Follow. Both pose estimates share a supplied yard layout; scenery adds no shared physics.'
      : 'Overhead mission ENU map and elevation views hold the same received samples as 3D. Inspection markers are supplied targets; dashed routes show ownership.');
  },
});
function detail(list, pairs) { list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; })); }
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { if (!run || value === null || value === undefined) return; stop(); timeMs = Math.max(0, Math.min(run.endMs, value)); render(); }
function shortcuts() {
  const sum = fleetSummary(run), takeoffs = run.vehicles.map(v => v.events.find(e => e.stage === 'takeoff' && e.status === 'complete')?.timeMs ?? null);
  const arrivals = sum.vehicles.map(v => v.taskCompletedMs).filter(value => value !== null), sends = sum.vehicles.map(v => v.waypointSentMs);
  return { takeoff: takeoffs.every(value => value !== null) ? Math.max(...takeoffs) : null,
    dispatch: sends.every(value => value !== null) ? Math.max(...sends) : null,
    arrival: arrivals.length ? Math.min(...arrivals) : null, deadline: sum.deadlineMs, landed: sum.landedMs, finish: run.endMs };
}
function setCase(id) {
  stop(); run = trace.cases.find(item => item.id === id) ?? trace.cases[0]; timeMs = 0; selectedVehicle = 'A1'; selectedCommand = null; events = fleetEvents(run);
  $('#fleet-case').value = run.id; $('#fleet-vehicle').value = selectedVehicle; $('#fleet-time-slider').max = String(run.endMs);
  setText('#fleet-case-description', run.id === 'misaddressed'
    ? 'A1’s task setpoint is sent on route A1, but names target system 2. There is no forwarding to A2. A2 receives its own correctly addressed setpoint. Ownership and the 20-second mission window stay unchanged.'
    : 'Each task setpoint uses the route and target system of its assigned vehicle. The dispatcher observes the same 20-second mission window, then correctly addresses LAND to both vehicles.');
  for (const [name, value] of Object.entries(shortcuts())) { $(`#fleet-${name}`).disabled = value === null; $(`#fleet-${name}`).title = value === null ? 'No such observation in this recording.' : `Seek to ${seconds(value)}`; }
  const rt = trace.runtime, cfg = run.config;
  detail($('#fleet-provenance'), [['Source', source], ['Recorded at', rt.recordedAt], ['Run ID', run.runId], ['ArduPilot / frame / speedup', `${rt.ardupilotVersion} / ${rt.model} (${rt.modelArgument}) / ${rt.speedup}`], ['Firmware revision', rt.firmwareGitHash], ['Transport / protocol', `${rt.transport} / MAVLink ${rt.mavlinkVersion}`], ['Coordinator system : component', `${run.controller.systemId} : ${run.controller.componentId}`], ['Shared receipt / send clock', rt.clock], ['Independent vehicle boot clocks', 'Retained in raw telemetry; not a shared mission timebase'], ['Configured frame registration', 'pad ENU + [local East − initial East, local North − initial North, initial Down − local Down]'], ['Independent process registry', run.vehicles.map(v => `${v.id}: PID ${v.pid}, instance ${v.instance}, TCP ${v.port}, system ${v.systemId}:${v.componentId}`).join(' · ')], ['pymavlink / Python', `${rt.pymavlink} / ${rt.python}`], ['Runtime image', rt.image], ['Base image', rt.baseImage], ['Recorder SHA-256', rt.sourceSha256], ['SITL helper SHA-256', rt.sitlSourceSha256], ['Dockerfile SHA-256', rt.dockerfileSha256], ['Parameters SHA-256', rt.paramsSha256], ['Official binary URL', rt.binaryUrl], ['Binary SHA-256', rt.binarySha256]]);
  detail($('#fleet-criteria'), [['Allocation cost', 'Horizontal Euclidean distance / metres; deterministic nearest-pair greedy'], ['Mission observation', `${cfg.missionDurationMs / 1000} host seconds after dispatch begins`], ['Task arrival / speed', `3D error ≤ ${cfg.positionToleranceM} m; 3D speed ≤ ${cfg.speedToleranceMps} m/s`], ['Task dwell / maximum sample gap', `${cfg.dwellMs} ms / ${cfg.maxSampleGapMs} ms`], ['Takeoff height / tolerance', `${cfg.takeoffAltitudeM} m above home ± ${cfg.takeoffToleranceM} m`], ['Task height reference', '4 m above registered initial local sample; distinct from home altitude'], ['Landing completion', `Prior airborne evidence; fresh on-ground and disarmed reports, ≤ ${cfg.landedFreshnessMs} ms old`], ['Setpoint admission acknowledgement', 'Not applicable: this MAVLink message has no COMMAND_ACK']]);
  for (const row of document.querySelectorAll('#fleet-comparison-rows tr')) row.dataset.selected = String(row.dataset.case === run.id);
  render();
}
function renderComparison() {
  $('#fleet-comparison-rows').replaceChildren(...trace.cases.map(item => {
    const sum = fleetSummary(item), row = el('tr', '', { 'data-case': item.id }), first = el('td'), button = el('button', item.label, { 'data-fleet-compare': item.id }); button.addEventListener('click', () => setCase(item.id)); first.append(button);
    const tasks = el('td', `${sum.tasksCompleted} / ${sum.totalTasks}`); for (const vehicle of sum.vehicles) tasks.append(el('small', `${vehicle.id} → ${vehicle.taskId}: ${vehicle.taskCompletedMs === null ? 'not reached in window' : seconds(vehicle.taskCompletedMs)}`, { class: 'fleet-table-note' }));
    const land = el('td', `${sum.landedVehicles} / ${item.vehicles.length} landed + disarmed`); land.append(el('small', `Both confirmed: ${seconds(sum.landedMs)}`, { class: 'fleet-table-note' }));
    row.append(first, el('td', item.assignments.map(a => `${a.vehicleId} → ${a.taskId}`).join(' · ')), tasks, land, el('td', sum.vehicles.some(v => v.routeMismatch) ? 'Wrong destination on A1’s isolated route; no reassignment or retry.' : 'Correct destinations; this is not a collision-avoidance demonstration.')); return row;
  }));
}
function setTrace(next, description) { trace = next; source = description; $('#fleet-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id }))); renderComparison(); setCase(trace.cases.find(item => item.id === 'misaddressed')?.id ?? trace.cases[0].id); }
function renderTasks(frame) {
  $('#fleet-task-rows').replaceChildren(...run.tasks.map(task => {
    const owner = frame.vehicles.find(v => v.taskId === task.id), row = el('tr', '', { 'data-task': task.id }), title = el('td', task.id); title.append(el('small', vector(task.positionEnu)));
    const state = el('td', taskNames[owner?.taskState ?? 'unassigned'], { 'data-state': owner?.taskState === 'completed' ? 'complete' : owner?.taskState === 'not-reached' ? 'missed' : 'pending' });
    if (owner?.taskEvidence) state.append(el('small', `Confirmed ${seconds(owner.taskEvidence.timeMs)}`));
    const distance = el('td', owner ? metres(owner.taskErrorM) : '—'); distance.append(el('small', owner?.taskEvidence ? `${run.config.dwellMs} ms dwell confirmed` : 'Dwell not confirmed'));
    row.append(title, el('td', owner?.id ?? '—'), state, distance); return row;
  }));
  $('#fleet-cost-rows').replaceChildren(...run.vehicles.map(vehicle => { const assignment = frame.assignments.find(a => a.vehicleId === vehicle.id), row = el('tr'); row.append(el('th', vehicle.id, { scope: 'row' })); for (const task of run.tasks) { const cost = assignment ? Math.hypot(assignment.positionEnu[0] - task.positionEnu[0], assignment.positionEnu[1] - task.positionEnu[1]) : null; const cell = el('td', cost === null ? 'Not observed' : cost.toFixed(3)); if (assignment?.taskId === task.id) cell.append(el('small', 'Assigned')); row.append(cell); } return row; }));
  setText('#fleet-allocation-note', frame.assignments.length ? `Decision recorded at ${seconds(run.assignmentTimeMs)} from the latest received poses. Horizontal costs remain this fixed decision snapshot; flight completion uses new 3D samples.` : 'No allocation decision is visible before its recorded timestamp. Task locations are supplied in advance.');
  $('#fleet-allocation-envelope').textContent = JSON.stringify(frame.assignments.length ? { timeMs: run.assignmentTimeMs, assignments: frame.assignments } : null, null, 2);
}
function renderRequests(vehicle) {
  if (selectedCommand && !vehicle.commandStates.some(item => item.id === selectedCommand)) selectedCommand = null;
  $('#fleet-command-rows').replaceChildren(...vehicle.commandStates.map(item => {
    const row = el('tr'), first = el('td'), button = el('button', stages[item.id], { 'data-fleet-command': item.id }); button.addEventListener('click', () => { stop(); selectedCommand = item.id; render(); }); first.append(button, el('small', `${item.command.message}${item.command.command === null ? '' : ` ${item.command.command}`} · ${seconds(item.command.timeMs)}`));
    const route = el('td', `${vehicle.id} / SYS ${item.command.routeSystem} → ${item.command.targetSystem}:${item.command.targetComponent}`); route.dataset.mismatch = String(item.command.routeSystem !== item.command.targetSystem);
    const result = el('td', item.command.kind === 'setpoint' ? 'No ACK by protocol' : item.ack ? `${resultNames[item.ack.result]} (${item.ack.result})` : 'No ACK yet');
    result.append(el('small', item.id === 'waypoint' ? vehicle.taskEvidence ? `Task confirmed ${seconds(vehicle.taskEvidence.timeMs)}` : vehicle.taskState === 'not-reached' ? 'Not reached before deadline' : 'Task completion not observed' : item.completionEvent ? `Observed ${seconds(item.completionEvent.timeMs)}` : 'Execution not completed yet'));
    row.append(first, route, result); return row;
  }));
  const selected = vehicle.commandStates.find(item => item.id === selectedCommand) ?? vehicle.commandStates.find(item => item.id === 'waypoint') ?? vehicle.commandStates.at(-1) ?? null;
  for (const button of document.querySelectorAll('[data-fleet-command]')) button.setAttribute('aria-pressed', String(button.dataset.fleetCommand === selected?.id));
  $('#fleet-request-envelope').textContent = JSON.stringify({ command: selected?.command ?? null, ack: selected?.ack ?? null, completion: selected?.completionEvent ?? null }, null, 2);
  setText('#fleet-request-note', selected ? `${vehicle.id} / ${stages[selected.id]}. Original outgoing envelope, matched received ACK where the protocol provides one, and observed completion.` : 'No request has been sent by this cursor.');
}
function renderRoute(vehicle) {
  const waypoint = vehicle.commands.find(command => command.id === 'waypoint'); $('#fleet-routing').dataset.mismatch = String(vehicle.routeMismatch);
  setText('#fleet-route-title', waypoint ? `${vehicle.id} / TCP ${vehicle.port} → target ${waypoint.targetSystem}:${waypoint.targetComponent} · route vehicle ${vehicle.systemId}:${vehicle.componentId}` : `${vehicle.id} / no task setpoint sent yet`);
  setText('#fleet-route-note', !waypoint ? 'A supplied task and an allocation decision do not send a MAVLink message. Continue to dispatch.' : vehicle.routeMismatch
    ? `Destination mismatch: route ${vehicle.id} reaches only system ${vehicle.systemId}. Target system ${waypoint.targetSystem} is on another isolated connection, which receives no copy of this packet. No setpoint ACK exists; observed task state is “${taskNames[vehicle.taskState]}”.`
    : `Route and target identity agree. Received reports come from ${vehicle.systemId}:${vehicle.componentId} on ${vehicle.id}’s connection. This setpoint has no ACK; observed task state is “${taskNames[vehicle.taskState]}”.`);
}
function render() {
  if (!run) return; const frame = fleetFrame(run, timeMs), vehicle = frame.vehicles.find(v => v.id === selectedVehicle), raw = run.vehicles.find(v => v.id === selectedVehicle), local = vehicle.latest.LOCAL_POSITION_NED, heartbeat = vehicle.latest.HEARTBEAT;
  view.update(run, frame, selectedVehicle); $('#fleet-time-slider').value = String(timeMs); setText('#fleet-time', seconds(timeMs)); $('#fleet-time').dataset.timeMs = String(timeMs);
  setText('#fleet-play', playing ? 'Ⅱ Pause trace' : timeMs >= run.endMs ? '↻ Replay trace' : '▶ Play trace'); $('#fleet-play').disabled = false; $('#fleet-reset').disabled = false; $('#fleet-step').disabled = timeMs >= run.endMs;
  setText('#fleet-status', playing ? 'Replaying recording' : timeMs >= run.endMs ? 'Recording complete' : 'Paused recording');
  setText('#fleet-recording-summary', `${source} · ${run.label} · ${run.vehicles.length} independent vehicle streams · ${run.vehicles.reduce((n,v) => n + v.telemetry.length, 0)} telemetry messages`);
  setText('#fleet-phase-state', frame.mission.ended ? 'Mission window closed' : frame.mission.started ? 'Mission execution window' : 'Preparing / taking off');
  setText('#fleet-cleanup-state', `${frame.landedVehicles} / ${run.vehicles.length} landing cleanups confirmed`);
  setText('#fleet-tasks-count', `${frame.tasksCompleted} / ${run.tasks.length}`); setText('#fleet-landing-count', `${frame.landedVehicles} / ${run.vehicles.length}`);
  setText('#fleet-selected-mode', `${selectedVehicle} / ${vehicle.mode ?? 'no report'}`); setText('#fleet-selected-source', `Vehicle source ${vehicle.systemId}:${vehicle.componentId} · HEARTBEAT receipt age ${age(vehicle.heartbeatAgeMs)}.`);
  setText('#fleet-outcome', frame.outcome ? frame.outcome.status === 'completed' ? 'Completed' : 'Partial mission' : frame.mission.ended ? frame.tasksCompleted === run.tasks.length ? 'Tasks complete' : 'Partial mission' : 'Not concluded');
  setText('#fleet-outcome-note', frame.mission.ended ? 'The task count is fixed at the mission deadline. Later landing remains a separate outcome.' : 'Assignment and dispatch do not establish successful task execution.');
  setText('#fleet-phase-note', frame.mission.ended ? `Mission window ended at ${seconds(frame.mission.endTimeMs)}. ${frame.tasksCompleted} / ${run.tasks.length} tasks completed; landing cleanup is measured separately as subsequent LAND requests and reports arrive.` : frame.mission.started ? `Task observation in progress: ${seconds(Math.max(0, run.config.missionDurationMs - (timeMs - frame.mission.startTimeMs)))} remain in the host-time budget. Inspect A1 and A2 separately.` : 'Both aircraft must complete takeoff before allocation and task dispatch. Their boot clocks and local estimator frames remain independent.');
  setText('#fleet-inspector-title', `${selectedVehicle} / independent autopilot`); setText('#fleet-requests-title', `${selectedVehicle} requests`);
  detail($('#fleet-vehicle-details'), [['Route / vehicle identity', `${selectedVehicle}: 127.0.0.1:${vehicle.port} / ${vehicle.systemId}:${vehicle.componentId}`], ['Received local-position source', local ? `${local.sourceSystem}:${local.sourceComponent}` : 'No sample'], ['Selected task / state', `${vehicle.taskId ?? 'None'} / ${taskNames[vehicle.taskState]}`], ['Mission ENU estimate', vector(vehicle.positionEnu)], ['Raw local NED estimate', vector(vehicle.positionNed)], ['Supplied pad ENU', vector(vehicle.padEnu)], ['3D speed', vehicle.speedMps === null ? '—' : `${vehicle.speedMps.toFixed(3)} m/s`], ['Position / attitude receipt age', `${age(vehicle.positionAgeMs)} / ${age(vehicle.attitudeAgeMs)}`], ['Mode / arming', `${vehicle.mode ?? 'No report'} / ${vehicle.armed === null ? 'unknown' : vehicle.armed ? 'armed' : 'disarmed'}`], ['Reported landing state / age', `${landedNames[vehicle.landedState] ?? 'No report'} / ${age(vehicle.landedAgeMs)}`], ['Height above this vehicle’s home', metres(vehicle.relativeAltitudeM)], ['This vehicle’s position boot clock', local ? `${local.data.time_boot_ms} ms` : 'No sample'], ['Shared recorder receipt time', seconds(local?.timeMs)], ['Task error at cursor', metres(vehicle.taskErrorM)], ['Configured local baseline / receipt', `${vector(raw.originNed)} / ${seconds(raw.originTimeMs)}`]]);
  const route = { vehicleId: raw.id, systemId: raw.systemId, componentId: raw.componentId, host: '127.0.0.1', port: raw.port };
  $('#fleet-position-envelope').textContent = JSON.stringify({ route, sample: local }, null, 2); $('#fleet-heartbeat-envelope').textContent = JSON.stringify({ route, sample: heartbeat }, null, 2); $('#fleet-status-envelope').textContent = JSON.stringify(vehicle.statuses, null, 2); $('#fleet-parameters').textContent = JSON.stringify(raw.parameters, null, 2);
  setText('#fleet-identity-note', vehicle.routeMismatch ? 'A1’s sent target disagrees with the vehicle on this route. This is an observed envelope mismatch, not an instrumented onboard rejection event.' : 'The vehicle registry identifies the connection. Raw received source IDs identify the sender. Task completion uses only the assigned vehicle’s stream.');
  const meaningful = events.filter(e => e.timeMs <= timeMs && ['stage', 'mission', 'assignment', 'status'].includes(e.kind));
  $('#fleet-event-list').replaceChildren(...meaningful.slice(-12).reverse().map(e => { const item = el('li'); item.append(el('time', `${seconds(e.timeMs)} · ${e.vehicleId ?? 'Dispatcher'}`), el('span', e.kind === 'status' ? e.data.text : e.kind === 'assignment' ? 'Nearest-pair greedy assignment recorded' : `${stages[e.data.stage] ?? e.data.stage}: ${e.data.status}`)); return item; }));
  if (!meaningful.length) $('#fleet-event-list').append(el('li', 'No recorded stage or status event yet.'));
  renderTasks(frame); renderRequests(vehicle); renderRoute(vehicle);
}
function animate(now) { if (!playing || !run) return; if (previousTick !== null) timeMs = Math.min(run.endMs, timeMs + Math.min(now - previousTick, 100) * Number($('#fleet-speed').value)); previousTick = now; if (timeMs >= run.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(animate); }
$('#fleet-play').addEventListener('click', () => { if (!run) return; if (playing) stop(); else { if (timeMs >= run.endMs) timeMs = 0; playing = true; previousTick = null; animation = requestAnimationFrame(animate); } render(); });
$('#fleet-step').addEventListener('click', () => { if (run) seek(events.find(item => item.timeMs > timeMs + 1e-7)?.timeMs ?? run.endMs); });
$('#fleet-reset').addEventListener('click', () => seek(0)); $('#fleet-case').addEventListener('change', event => { if (trace) setCase(event.target.value); }); $('#fleet-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#fleet-vehicle').addEventListener('change', event => { if (!run) return; selectedVehicle = event.target.value; selectedCommand = null; render(); });
for (const name of ['takeoff', 'dispatch', 'arrival', 'deadline', 'landed', 'finish']) $(`#fleet-${name}`).addEventListener('click', () => { if (run) seek(shortcuts()[name]); });
for (const mode of ['2d', '3d']) $(`#fleet-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#fleet-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; stop(); const epoch = ++importEpoch;
  try { if (file.size > 15 * 1024 * 1024) throw new Error('The trace exceeds the 15 MB import limit.'); const next = validateFleetTrace(JSON.parse(await file.text())); if (epoch !== importEpoch) return; setTrace(next, 'Imported recording'); $('#fleet-import-status').textContent = 'Imported and validated. Metadata is untrusted provenance.'; $('#fleet-import-status').dataset.error = 'false'; }
  catch (error) { if (epoch !== importEpoch) return; $('#fleet-import-status').textContent = `Import rejected: ${error.message} The previous recording is retained.`; $('#fleet-import-status').dataset.error = 'true'; render(); }
  finally { event.target.value = ''; }
});
$('#fleet-bundled').addEventListener('click', () => { ++importEpoch; setTrace(validateFleetTrace(bundled), 'Bundled recording'); $('#fleet-import-status').textContent = 'Bundled, validated recording. Maximum import size: 15 MB.'; $('#fleet-import-status').dataset.error = 'false'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } }); window.addEventListener('pagehide', () => { stop(); view.dispose(); });
try { setTrace(validateFleetTrace(bundled), source); view.setMode('3d'); } catch (error) { $('#fleet-status').textContent = 'Trace unavailable'; $('#fleet-import-status').textContent = error.message; $('#fleet-import-status').dataset.error = 'true'; }
