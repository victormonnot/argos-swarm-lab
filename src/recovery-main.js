import './style.css';
import './mission.css';
import './recovery.css';
import bundled from '../docs/results/ardupilot-recovery.json';
import { validateRecoveryTrace, recoveryFrame, recoveryEvents, recoverySummary, RECOVERY_TREE, resultNames, landedNames } from './recovery-trace.js';
import { createRecoveryView } from './recovery-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attrs = {}) => {
  const node = document.createElement(tag); node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const seconds = value => value === null || value === undefined ? '—' : `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`;
const metres = value => value === null || value === undefined ? '—' : `${value.toFixed(3)} m`;
const vector = value => value ? `[${value.map(number => number.toFixed(3)).join(', ')}] m` : 'No sample';
const taskNames = { pending: 'Pending', assigned: 'Assigned / not sent', executing: 'Executing', locked: 'Locked / A1 retiring', completed: 'Completed' };
const stageNames = { guided: 'Guided mode', arm: 'Arm', takeoff: 'Takeoff', land: 'LAND' };
const statusNames = { SUCCESS: 'Success', FAILURE: 'Failure', RUNNING: 'Running', IDLE: 'Not visited' };
let trace, run, events = [], timeMs = 0, selectedVehicle = 'A1', selectedCommand = null;
let playing = false, animation, previousTick = null, source = 'Bundled recording', importEpoch = 0;
const view = createRecoveryView($('#recovery-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#recovery-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#recovery-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. Select A1, A2 or A3 and use Follow. All aircraft use received estimates in a supplied layout.'
      : 'Overhead ENU map and three elevation views use the same received samples as 3D. Dashed lines show current ownership; locked work stays with its retiring owner.');
  },
});
function detail(list, pairs) {
  list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; }));
}
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) {
  if (!run || value === null || value === undefined) return;
  stop(); timeMs = Math.max(0, Math.min(run.endMs, value)); render();
}
function shortcuts() {
  const sum = recoverySummary(run), canceled = run.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  // The completed tick includes the halt and the higher-priority LAND action.
  const lockedTick = canceled ? run.btTicks.find(tick => tick.timeMs >= canceled.cancelledTimeMs)?.timeMs : null;
  return { dispatch: sum.firstDispatchMs, withdraw: sum.withdrawalMs,
    locked: lockedTick ?? canceled?.cancelledTimeMs ?? null, release: sum.releaseMs,
    reassign: sum.reassignmentMs, complete: sum.missionCompletedMs, landed: sum.landedMs, finish: run.endMs };
}
function setCase(id) {
  stop(); run = trace.cases.find(item => item.id === id) ?? trace.cases[0]; timeMs = 0;
  selectedVehicle = 'A1'; selectedCommand = null; events = recoveryEvents(run);
  $('#recovery-case').value = run.id; $('#recovery-vehicle').value = selectedVehicle;
  $('#recovery-time-slider').max = String(run.endMs);
  setText('#recovery-case-description', run.id === 'withdrawal'
    ? 'A1 receives a controlled withdrawal request 500 ms after dispatch of its second task, on the next host tick. Its visit action is halted and it lands. Its unfinished task is released only after landing confirmation, then allocated to an available vehicle.'
    : 'A1, A2 and A3 remain eligible. Each executes one task at a time; completed visits make the vehicle available for pending work. All six task confirmations trigger landing cleanup.');
  for (const [name, value] of Object.entries(shortcuts())) {
    $(`#recovery-${name}`).disabled = value === null || !Number.isFinite(value);
    $(`#recovery-${name}`).title = value === null ? 'No such event in this case.' : `Seek to ${seconds(value)}`;
  }
  const rt = trace.runtime, cfg = run.config;
  detail($('#recovery-provenance'), [['Source', source], ['Recorded at', rt.recordedAt], ['Run ID', run.runId],
    ['ArduPilot / frame / speedup', `${rt.ardupilotVersion} / ${rt.model} (${rt.modelArgument}) / ${rt.speedup}`],
    ['Firmware revision', rt.firmwareGitHash], ['Transport / protocol', `${rt.transport} / MAVLink ${rt.mavlinkVersion}`],
    ['Host coordinator identity', `${run.controller.systemId}:${run.controller.componentId}`],
    ['Behavior Tree location', 'Three executors in the central Python coordinator; not onboard ArduPilot'],
    ['Receipt / send / tick clock', rt.clock], ['Supplied frame registration', 'pad ENU + [East − initial East, North − initial North, initial Down − Down]'],
    ['Independent processes', run.vehicles.map(v => `${v.id}: PID ${v.pid}, instance ${v.instance}, TCP ${v.port}, SYS ${v.systemId}:${v.componentId}`).join(' · ')],
    ['pymavlink / Python', `${rt.pymavlink} / ${rt.python}`], ['Runtime image', rt.image], ['Base image', rt.baseImage],
    ['Recorder SHA-256', rt.sourceSha256], ['SITL helper SHA-256', rt.sitlSourceSha256], ['Binary SHA-256', rt.binarySha256]]);
  detail($('#recovery-criteria'), [['Allocation', 'Horizontal nearest-pair greedy / one active task per eligible vehicle'],
    ['Configured tick interval', `${cfg.tickIntervalMs} ms; actual timestamps retained`], ['Task arrival / speed', `3D error ≤ ${cfg.positionToleranceM} m; 3D speed ≤ ${cfg.speedToleranceMps} m/s`],
    ['Task dwell / maximum sample gap', `${cfg.dwellMs} ms / ${cfg.maxSampleGapMs} ms`], ['Allocation pose freshness', `≤ ${cfg.freshnessMs} ms`],
    ['Maximum mission duration', `${cfg.missionDurationMs / 1000} host seconds from mission start after takeoff`],
    ['Release rule', 'A1 landed and disarmed, with prior airborne evidence and accepted LAND ACK'],
    ['Landing report freshness', `≤ ${cfg.landedFreshnessMs} ms`], ['Task height reference', '4 m above registered local baseline; distinct from height above home'],
    ['Setpoint acknowledgement', 'No COMMAND_ACK exists for position-target messages']]);
  for (const row of document.querySelectorAll('#recovery-comparison-rows tr')) row.dataset.selected = String(row.dataset.case === run.id);
  render();
}
function renderComparison() {
  $('#recovery-comparison-rows').replaceChildren(...trace.cases.map(item => {
    const sum = recoverySummary(item), row = el('tr', '', { 'data-case': item.id }), first = el('td');
    const button = el('button', item.label, { 'data-recovery-compare': item.id }); button.addEventListener('click', () => setCase(item.id)); first.append(button);
    const tasks = el('td', `${sum.tasksCompleted} / ${sum.totalTasks} tasks`);
    tasks.append(el('small', `${item.attempts.length} attempts · ${sum.cancellations} canceled`, { class: 'recovery-table-note' }));
    const mission = el('td', seconds(sum.missionElapsedMs)); mission.append(el('small', `Sixth confirmation: ${seconds(sum.missionCompletedMs)} host time`, { class: 'recovery-table-note' }));
    const land = el('td', `${sum.landedVehicles} / ${item.vehicles.length} landed + disarmed`); land.append(el('small', `All confirmed: ${seconds(sum.landedMs)} host time`, { class: 'recovery-table-note' }));
    const handover = el('td', sum.reassignments ? `${sum.reassignments} task reassigned` : 'No withdrawal');
    if (sum.releaseMs !== null) handover.append(el('small', `Request → release: ${seconds(sum.releaseMs - sum.withdrawalMs)}`, { class: 'recovery-table-note' }));
    row.append(first, tasks, mission, land, handover); return row;
  }));
  const normal = trace.cases.find(item => item.id === 'nominal'), withdrawal = trace.cases.find(item => item.id === 'withdrawal');
  if (normal && withdrawal) {
    const baseline = recoverySummary(normal), altered = recoverySummary(withdrawal), delta = altered.missionElapsedMs - baseline.missionElapsedMs;
    setText('#recovery-comparison-note', `Recorded mission duration difference (withdrawal − nominal): ${delta >= 0 ? '+' : ''}${seconds(delta)}. Both cases use the same six supplied targets and completion criteria. These are separate physical simulations, not identical telemetry streams.`);
  } else {
    setText('#recovery-comparison-note', 'Import both nominal and withdrawal cases to compare recorded mission durations. This file contains one case.');
  }
}
function setTrace(next, description) {
  trace = next; source = description;
  $('#recovery-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id })));
  renderComparison(); setCase(trace.cases.find(item => item.id === 'withdrawal')?.id ?? trace.cases[0].id);
}
function renderTasks(frame) {
  $('#recovery-task-rows').replaceChildren(...frame.tasks.map(task => {
    const attempts = frame.attempts.filter(item => item.taskId === task.id), row = el('tr', '', { 'data-task': task.id });
    const name = el('td', task.id); name.append(el('small', vector(task.positionEnu)));
    const state = el('td', taskNames[task.state], { 'data-state': task.state });
    if (task.completedTimeMs !== null) state.append(el('small', seconds(task.completedTimeMs)));
    if (task.state === 'locked') state.append(el('small', 'Canceled execution; reservation retained'));
    const history = el('td', String(attempts.length));
    for (const attempt of attempts) history.append(el('small', `${attempt.id} / ${attempt.vehicleId}: ${attempt.status}`));
    row.append(name, el('td', task.ownerId ?? '—'), state, history); return row;
  }));
  const locked = frame.tasks.filter(task => task.state === 'locked'), pending = frame.tasks.filter(task => task.state === 'pending');
  setText('#recovery-ownership-note', `${pending.length} pending · ${locked.length} locked · ${frame.tasksCompleted} completed. ${locked.length ? `${locked.map(task => task.id).join(', ')} await coordinator release after fresh landing confirmation; they are not eligible for reassignment yet.` : 'Only pending work and available vehicles participate in the next greedy allocation.'}`);
  $('#recovery-ledger-envelope').textContent = JSON.stringify({ assignments: frame.assignments, attempts: frame.attempts, taskEvents: run.taskEvents.filter(event => event.timeMs <= timeMs) }, null, 2);
}
function renderTree(vehicle) {
  const tick = vehicle.bt, statuses = new Map((tick?.visited ?? []).map(item => [item.id, item.status]));
  const halted = new Set((tick?.halts ?? []).map(item => item.id));
  const depth = node => node.parent ? 1 + depth(RECOVERY_TREE.find(parent => parent.id === node.parent)) : 0;
  $('#recovery-tree').replaceChildren(...RECOVERY_TREE.map(node => {
    const status = statuses.get(node.id) ?? 'IDLE';
    const row = el('div', '', { class: 'recovery-tree-node', 'data-node': node.id, 'data-depth': String(depth(node)), 'data-status': status, 'data-halted': String(halted.has(node.id)) });
    const name = el('span'), symbol = node.type.toLowerCase().includes('fallback') ? '?' : node.type.toLowerCase().includes('sequence') ? '→' : node.type.toLowerCase().includes('condition') ? '◇' : '■';
    name.append(el('b', symbol, { class: 'recovery-node-type', 'aria-hidden': 'true' }), document.createTextNode(node.label));
    if (node.id === 'task') name.append(el('small', tick?.inputs.attemptId ? `Tick input: ${tick.inputs.attemptId} / ${tick.inputs.attemptStatus}` : 'No attempt in this tick input'));
    row.append(name, el('b', `${halted.has(node.id) ? 'Halted · ' : ''}${statusNames[status] ?? status}`)); return row;
  }));
  setText('#recovery-tree-title', `${selectedVehicle} / reactive Behavior Tree`);
  setText('#recovery-tree-result', tick ? `Root: ${statusNames[tick.status] ?? tick.status}` : 'Not ticked');
  setText('#recovery-tree-time', tick ? `Tick ${tick.index} · ${seconds(tick.timeMs)} · age ${age(timeMs - tick.timeMs)}` : 'No tick at this cursor');
  setText('#recovery-tree-note', tick?.halts.length
    ? `Recorded halt: ${tick.halts.map(item => item.id).join(', ')}. This tick revisited higher-priority work. A halt cancels execution; release requires separate landing evidence.`
    : 'Only visited nodes have a status for this tick. The coordinator executes this tree; the autopilot controls flight. Unticked branches provide no fresh decision.');
  $('#recovery-tree-envelope').textContent = JSON.stringify(tick, null, 2);
}
function renderHandover(frame) {
  const withdrawal = frame.withdrawal, canceled = frame.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  const reassigned = canceled ? frame.attempts.find(attempt => attempt.taskId === canceled.taskId && attempt.id !== canceled.id) : null;
  const state = reassigned ? 'reassigned' : withdrawal.releasedTimeMs !== null ? 'released' : canceled ? 'locked' : withdrawal.requestedTimeMs !== null ? 'requested' : 'waiting';
  $('#recovery-handover').dataset.state = state;
  const observed = { withdraw: withdrawal.requestedTimeMs !== null, cancel: Boolean(canceled), land: withdrawal.landedTimeMs !== null, release: withdrawal.releasedTimeMs !== null, reassign: Boolean(reassigned) };
  for (const item of document.querySelectorAll('#recovery-handover-steps li')) item.dataset.observed = String(observed[item.dataset.step]);
  const title = reassigned ? `${reassigned.taskId}: A1 → ${reassigned.vehicleId}` : canceled ? `${canceled.taskId}: ${state === 'released' ? 'released for a new owner' : 'still reserved by A1'}` : withdrawal.requestedTimeMs !== null ? 'A1 withdrawal requested' : 'A task belongs to at most one vehicle.';
  setText('#recovery-handover-title', title);
  setText('#recovery-handover-note', reassigned
    ? `New attempt ${reassigned.id} assigned at ${seconds(reassigned.assignedTimeMs)}, after A1’s landing at ${seconds(withdrawal.landedTimeMs)} and release at ${seconds(withdrawal.releasedTimeMs)}. ${reassigned.completedTimeMs !== null ? `The new owner confirmed visit-and-hold completion at ${seconds(reassigned.completedTimeMs)}.` : 'A new visit-and-hold confirmation is still required.'}`
    : canceled ? `Attempt ${canceled.id} was canceled at ${seconds(canceled.cancelledTimeMs)}. ${withdrawal.releasedTimeMs !== null ? `Fresh landing evidence allowed release at ${seconds(withdrawal.releasedTimeMs)}.` : withdrawal.landedTimeMs !== null ? `A1 is confirmed landed at ${seconds(withdrawal.landedTimeMs)}; its reservation still awaits coordinator release.` : 'Its task remains unavailable to A2 and A3 while the coordinator awaits fresh landing confirmation and releases the reservation.'}`
      : run.id === 'nominal' ? 'No withdrawal is scheduled in this recording. Every reservation ends with observed task completion.' : 'No withdrawal has been observed at this cursor. The configured interruption occurs during A1’s second visit attempt.');
  setText('#recovery-retirement', state === 'waiting' ? 'Not requested' : state === 'locked' ? withdrawal.landedTimeMs !== null ? 'A1 landed / locked' : 'A1 landing / locked' : state === 'requested' ? 'A1 requested' : state === 'released' ? 'A1 retired / released' : `Transferred to ${reassigned.vehicleId}`);
  setText('#recovery-retirement-note', canceled ? `${canceled.taskId} / ${canceled.id}: canceled ${seconds(canceled.cancelledTimeMs)}.` : 'A canceled attempt does not release its task.');
}
function renderCommands(vehicle, frame) {
  if (selectedCommand && !vehicle.commands.some(command => command.id === selectedCommand)) selectedCommand = null;
  const requests = vehicle.commands.map(command => {
    const ack = vehicle.acks.filter(item => item.commandId === command.id).at(-1) ?? null;
    const attempt = frame.attempts.find(item => item.commandId === command.id);
    const observation = vehicle.events.filter(item => item.stage === command.id && item.status !== 'start').at(-1) ?? null;
    return { command, ack, attempt, observation };
  });
  $('#recovery-command-rows').replaceChildren(...requests.map(item => {
    const { command, ack, attempt, observation } = item, row = el('tr'), first = el('td');
    const button = el('button', attempt ? `${attempt.taskId} / ${attempt.id}` : stageNames[command.id] ?? command.id, { 'data-recovery-command': command.id });
    button.addEventListener('click', () => { stop(); selectedCommand = command.id; render(); });
    first.append(button, el('small', seconds(command.timeMs)));
    const outcome = el('td', command.kind === 'setpoint' ? 'No ACK by protocol' : ack ? `${resultNames[ack.result]} (${ack.result})` : 'No ACK yet');
    outcome.append(el('small', observation ? `${observation.status} · ${seconds(observation.timeMs)}` : 'Execution not confirmed'));
    row.append(first, el('td', `Route SYS ${command.routeSystem} → ${command.targetSystem}:${command.targetComponent}`), outcome); return row;
  }));
  const selected = requests.find(item => item.command.id === selectedCommand) ?? requests.at(-1) ?? null;
  for (const button of document.querySelectorAll('[data-recovery-command]')) button.setAttribute('aria-pressed', String(button.dataset.recoveryCommand === selected?.command.id));
  $('#recovery-request-envelope').textContent = JSON.stringify(selected, null, 2);
  setText('#recovery-request-note', selected ? `${selectedVehicle} / ${selected.command.message}. Sent envelope and evidence received by this cursor.` : 'No request has been sent by this cursor.');
}
function eventDescription(event) {
  if (event.kind === 'task') return `${event.data.taskId} / ${event.data.attemptId}: ${event.data.type}`;
  if (event.kind === 'assignment') return `${event.data.id}: greedy assignment · ${event.data.pairs.map(pair => `${pair.vehicleId} → ${pair.taskId}`).join(' · ')}`;
  if (event.kind === 'status') return event.data.text;
  return `${stageNames[event.data.stage] ?? event.data.stage}: ${event.data.status}`;
}
function render() {
  if (!run) return;
  const frame = recoveryFrame(run, timeMs), vehicle = frame.vehicles.find(item => item.id === selectedVehicle), raw = run.vehicles.find(item => item.id === selectedVehicle);
  view.update(run, frame, selectedVehicle); $('#recovery-time-slider').value = String(timeMs);
  setText('#recovery-time', seconds(timeMs)); $('#recovery-time').dataset.timeMs = String(timeMs);
  setText('#recovery-play', playing ? 'Ⅱ Pause trace' : timeMs >= run.endMs ? '↻ Replay trace' : '▶ Play trace');
  $('#recovery-play').disabled = false; $('#recovery-reset').disabled = false; $('#recovery-step').disabled = timeMs >= run.endMs;
  setText('#recovery-status', playing ? 'Replaying recording' : timeMs >= run.endMs ? 'Recording complete' : 'Paused recording');
  setText('#recovery-recording-summary', `${source} · ${run.label} · ${run.vehicles.length} independent autopilots · ${run.btTicks.length} recorded coordinator ticks`);
  setText('#recovery-phase-state', frame.mission.completedTimeMs !== null ? frame.mission.closed ? 'Six tasks confirmed / cleanup' : 'Six tasks confirmed' : frame.mission.closed ? 'Mission window closed' : frame.mission.started ? 'Mission execution' : 'Preparing / taking off');
  setText('#recovery-cleanup-state', `${frame.landedVehicles} / ${run.vehicles.length} landings confirmed`);
  setText('#recovery-tasks-count', `${frame.tasksCompleted} / ${run.tasks.length}`);
  setText('#recovery-landing-count', `${frame.landedVehicles} / ${run.vehicles.length}`);
  setText('#recovery-mission-time', frame.mission.started ? seconds(frame.mission.elapsedMs) : 'Not started');
  setText('#recovery-mission-time-note', frame.mission.completedTimeMs !== null ? `Sixth task confirmed at ${seconds(frame.mission.completedTimeMs)} host time. Cleanup follows.` : 'From mission start after takeoff to the sixth confirmed task.');
  setText('#recovery-phase-note', frame.mission.completedTimeMs !== null
    ? `All six task confirmations are observed. Mission duration: ${seconds(frame.mission.elapsedMs)}. Landing cleanup is separate: ${frame.landedVehicles} / 3 confirmed.`
    : frame.mission.started ? `${frame.tasksCompleted} / 6 tasks confirmed. Follow ownership changes in the ledger and inspect each vehicle’s recorded tree.` : 'All three aircraft must complete normal arming and takeoff before the first mission allocation. Their estimator origins and boot clocks remain independent.');
  setText('#recovery-inspector-title', `${selectedVehicle} / independent autopilot`); setText('#recovery-requests-title', `${selectedVehicle} / command history`);
  const local = vehicle.latest.LOCAL_POSITION_NED, heartbeat = vehicle.latest.HEARTBEAT;
  detail($('#recovery-vehicle-details'), [['Vehicle / TCP route', `${vehicle.systemId}:${vehicle.componentId} / 127.0.0.1:${vehicle.port}`],
    ['Current task / execution', `${vehicle.taskId ?? 'None'} / ${vehicle.taskState}`], ['Completed tasks', vehicle.completedTasks.join(', ') || 'None yet'],
    ['Mission ENU estimate', vector(vehicle.positionEnu)], ['Raw local NED estimate', vector(vehicle.positionNed)], ['Supplied pad ENU', vector(vehicle.padEnu)],
    ['3D speed / task error', `${vehicle.speedMps === null ? '—' : `${vehicle.speedMps.toFixed(3)} m/s`} / ${metres(vehicle.taskErrorM)}`],
    ['Mode / arming', `${vehicle.mode ?? 'No report'} / ${vehicle.armed === null ? 'unknown' : vehicle.armed ? 'armed' : 'disarmed'}`],
    ['Reported landing state', landedNames[vehicle.landedState] ?? 'No report'], ['Position / attitude receipt age', `${age(vehicle.positionAgeMs)} / ${age(vehicle.attitudeAgeMs)}`],
    ['Landing / heartbeat receipt age', `${age(vehicle.landedAgeMs)} / ${age(vehicle.heartbeatAgeMs)}`], ['Local source / boot clock', local ? `${local.sourceSystem}:${local.sourceComponent} / ${local.data.time_boot_ms} ms` : 'No sample'],
    ['Height above this vehicle’s home', metres(vehicle.relativeAltitudeM)], ['Local baseline / receipt', `${vector(raw.originNed)} / ${seconds(raw.originTimeMs)}`]]);
  $('#recovery-position-envelope').textContent = JSON.stringify({ vehicleId: selectedVehicle, localPosition: local, heartbeat }, null, 2);
  $('#recovery-parameters').textContent = JSON.stringify({ parameters: raw.parameters, padEnu: raw.padEnu, originNed: raw.originNed, originTimeMs: raw.originTimeMs }, null, 2);
  const meaningful = events.filter(event => event.timeMs <= timeMs && ['stage', 'mission', 'assignment', 'task'].includes(event.kind));
  $('#recovery-event-list').replaceChildren(...meaningful.slice(-20).reverse().map(event => { const row = el('li'); row.append(el('time', `${seconds(event.timeMs)} · ${event.vehicleId ?? 'Coordinator'}`), el('span', eventDescription(event))); return row; }));
  if (!meaningful.length) $('#recovery-event-list').append(el('li', 'No recorded decision or execution event yet.'));
  renderTasks(frame); renderTree(vehicle); renderHandover(frame); renderCommands(vehicle, frame);
}
function animate(now) {
  if (!playing || !run) return;
  if (previousTick !== null) timeMs = Math.min(run.endMs, timeMs + Math.min(now - previousTick, 100) * Number($('#recovery-speed').value));
  previousTick = now; if (timeMs >= run.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(animate);
}
$('#recovery-play').addEventListener('click', () => {
  if (!run) return; if (playing) stop(); else { if (timeMs >= run.endMs) timeMs = 0; playing = true; previousTick = null; animation = requestAnimationFrame(animate); } render();
});
$('#recovery-step').addEventListener('click', () => { if (run) seek(events.find(event => event.timeMs > timeMs + 1e-7)?.timeMs ?? run.endMs); });
$('#recovery-reset').addEventListener('click', () => seek(0));
$('#recovery-case').addEventListener('change', event => { if (trace) setCase(event.target.value); });
$('#recovery-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#recovery-vehicle').addEventListener('change', event => { if (run) { selectedVehicle = event.target.value; selectedCommand = null; render(); } });
for (const name of ['dispatch', 'withdraw', 'locked', 'release', 'reassign', 'complete', 'landed', 'finish']) $(`#recovery-${name}`).addEventListener('click', () => { if (run) seek(shortcuts()[name]); });
for (const mode of ['2d', '3d']) $(`#recovery-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#recovery-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; stop(); const epoch = ++importEpoch;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('The trace exceeds the 30 MB import limit.');
    const next = validateRecoveryTrace(JSON.parse(await file.text())); if (epoch !== importEpoch) return;
    setTrace(next, 'Imported recording'); $('#recovery-import-status').textContent = 'Imported and validated. Metadata is untrusted provenance.'; $('#recovery-import-status').dataset.error = 'false';
  } catch (error) {
    if (epoch !== importEpoch) return; $('#recovery-import-status').textContent = `Import rejected: ${error.message} The previous recording is retained.`; $('#recovery-import-status').dataset.error = 'true'; render();
  } finally { event.target.value = ''; }
});
$('#recovery-bundled').addEventListener('click', () => {
  ++importEpoch; setTrace(validateRecoveryTrace(bundled), 'Bundled recording');
  $('#recovery-import-status').textContent = 'Bundled, validated recording. Maximum import size: 30 MB.'; $('#recovery-import-status').dataset.error = 'false';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
try { setTrace(validateRecoveryTrace(bundled), source); view.setMode('3d'); }
catch (error) { $('#recovery-status').textContent = 'Trace unavailable'; $('#recovery-import-status').textContent = error.message; $('#recovery-import-status').dataset.error = 'true'; }
