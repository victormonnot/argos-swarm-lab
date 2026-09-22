import './style.css';
import './mission.css';
import './shared-world.css';
import bundled from '../docs/results/ardupilot-shared-world.json';
import { validateSharedWorldTrace, sharedWorldFrame, sharedWorldEvents, sharedWorldSummary } from './shared-world-trace.js';
import { RECOVERY_TREE, resultNames, landedNames } from './recovery-trace.js';
import { createSharedWorldView } from './shared-world-view.js';

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
const view = createSharedWorldView($('#shared-world-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#shared-world-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#shared-world-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. Select A1, A2 or A3 and use Follow. Solid aircraft show world poses; wireframes show received estimates. The buildings match the Gazebo collision boxes.'
      : 'Overhead world map and three elevations use the same evidence as 3D. Solid paths show world truth; dashed paths show baseline-aligned estimates.');
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
  const sum = sharedWorldSummary(run), canceled = run.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  // The completed tick includes the halt and the higher-priority LAND action.
  const lockedTick = canceled ? run.btTicks.find(tick => tick.timeMs >= canceled.cancelledTimeMs)?.timeMs : null;
  return { dispatch: sum.firstDispatchMs, withdraw: sum.withdrawalMs,
    locked: lockedTick ?? canceled?.cancelledTimeMs ?? null, release: sum.releaseMs,
    reassign: sum.reassignmentMs, complete: sum.missionCompletedMs, landed: sum.landedMs, finish: run.endMs };
}
function setCase(id) {
  stop(); run = trace.cases.find(item => item.id === id) ?? trace.cases[0]; timeMs = 0;
  selectedVehicle = 'A1'; selectedCommand = null; events = sharedWorldEvents(run);
  $('#shared-world-case').value = run.id; $('#shared-world-vehicle').value = selectedVehicle;
  $('#shared-world-time-slider').max = String(run.endMs);
  setText('#shared-world-case-description', run.id === 'withdrawal'
    ? 'A1 receives a controlled withdrawal request 500 ms after dispatch of its second task, on the next host tick. Its visit action is halted and it lands. Its unfinished task is released only after landing confirmation, then allocated to an available vehicle.'
    : 'A1, A2 and A3 remain eligible. Each executes one task at a time; completed visits make the vehicle available for pending work. All six task confirmations trigger landing cleanup.');
  for (const [name, value] of Object.entries(shortcuts())) {
    $(`#shared-world-${name}`).disabled = value === null || !Number.isFinite(value);
    $(`#shared-world-${name}`).title = value === null ? 'No such event in this case.' : `Seek to ${seconds(value)}`;
  }
  const rt = trace.runtime, cfg = run.config;
  detail($('#shared-world-provenance'), [['Source', source], ['Recorded at', rt.recordedAt], ['Run ID', run.runId],
    ['ArduPilot / frame / speedup', `${rt.ardupilotVersion} / ${rt.model} (${rt.modelArgument}) / ${rt.speedup}`],
    ['Firmware revision', rt.firmwareGitHash], ['Transport / protocol', `${rt.transport} / MAVLink ${rt.mavlinkVersion}`],
    ['Host coordinator identity', `${run.controller.systemId}:${run.controller.componentId}`],
    ['Behavior Tree location', 'Three executors in the central Python coordinator; not onboard ArduPilot'],
    ['Receipt / send / tick clock', rt.clock], ['Supplied frame registration', 'pad ENU + [East − initial East, North − initial North, initial Down − Down]'],
    ['Gazebo version / shared world', `${rt.gazeboVersion} / ${run.world.name}`], ['ArduPilot–Gazebo integration', rt.pluginGitHash],
    ['External physics / observations', 'One shared collision world; simultaneous world poses and cumulative physical contact evidence'],
    ['World-to-estimate alignment', 'Initial received world position + registered local displacement; initial samples may differ in time'],
    ['Independent autopilot processes', run.vehicles.map(v => `${v.id}: PID ${v.pid}, instance ${v.instance}, TCP ${v.port}, SYS ${v.systemId}:${v.componentId}`).join(' · ')],
    ['pymavlink / Python', `${rt.pymavlink} / ${rt.python}`], ['Runtime image', rt.image], ['Base image', rt.baseImage],
    ['Recorder SHA-256', rt.sourceSha256], ['SITL helper SHA-256', rt.sitlSourceSha256], ['Binary SHA-256', rt.binarySha256]]);
  detail($('#shared-world-criteria'), [['Allocation', 'Horizontal nearest-pair greedy / one active task per eligible vehicle'],
    ['Configured tick interval', `${cfg.tickIntervalMs} ms; actual timestamps retained`], ['Task arrival / speed', `3D error ≤ ${cfg.positionToleranceM} m; 3D speed ≤ ${cfg.speedToleranceMps} m/s`],
    ['Task dwell / maximum sample gap', `${cfg.dwellMs} ms / ${cfg.maxSampleGapMs} ms`], ['Allocation pose freshness', `≤ ${cfg.freshnessMs} ms`],
    ['Maximum mission duration', `${cfg.missionDurationMs / 1000} host seconds from mission start after takeoff`],
    ['Release rule', 'A1 landed and disarmed, with prior airborne evidence and accepted LAND ACK'],
    ['Landing report freshness', `≤ ${cfg.landedFreshnessMs} ms`], ['Task height reference', '4 m above the received local baseline; world markers use nominal spawn height'],
    ['Setpoint acknowledgement', 'No COMMAND_ACK exists for position-target messages']]);
  for (const row of document.querySelectorAll('#shared-world-comparison-rows tr')) row.dataset.selected = String(row.dataset.case === run.id);
  render();
}
function renderComparison() {
  $('#shared-world-comparison-rows').replaceChildren(...trace.cases.map(item => {
    const sum = sharedWorldSummary(item), row = el('tr', '', { 'data-case': item.id }), first = el('td');
    const button = el('button', item.label, { 'data-shared-world-compare': item.id }); button.addEventListener('click', () => setCase(item.id)); first.append(button);
    const tasks = el('td', `${sum.tasksCompleted} / ${sum.totalTasks} tasks`);
    tasks.append(el('small', `${item.attempts.length} attempts · ${sum.cancellations} canceled`, { class: 'shared-world-table-note' }));
    const mission = el('td', seconds(sum.missionElapsedMs)); mission.append(el('small', `Sixth confirmation: ${seconds(sum.missionCompletedMs)} host time`, { class: 'shared-world-table-note' }));
    const land = el('td', `${sum.landedVehicles} / ${item.vehicles.length} landed + disarmed`); land.append(el('small', `All confirmed: ${seconds(sum.landedMs)} host time`, { class: 'shared-world-table-note' }));
    const handover = el('td', sum.reassignments ? `${sum.reassignments} task reassigned` : 'No withdrawal');
    if (sum.releaseMs !== null) handover.append(el('small', `Request → release: ${seconds(sum.releaseMs - sum.withdrawalMs)}`, { class: 'shared-world-table-note' }));
    const physical = el('td', `${metres(sum.minimumSeparationM)} minimum sampled distance`);
    physical.append(el('small', `${sum.unexpectedContactCount} distinct non-ground contact pairs · ${sum.truthSamples} world snapshots`, { class: 'shared-world-table-note' }));
    row.append(first, tasks, mission, land, handover, physical); return row;
  }));
  const normal = trace.cases.find(item => item.id === 'nominal'), withdrawal = trace.cases.find(item => item.id === 'withdrawal');
  if (normal && withdrawal) {
    const baseline = sharedWorldSummary(normal), altered = sharedWorldSummary(withdrawal), delta = altered.missionElapsedMs - baseline.missionElapsedMs;
    setText('#shared-world-comparison-note', `Recorded mission duration difference (withdrawal − nominal): ${delta >= 0 ? '+' : ''}${seconds(delta)}. Both cases use the same six supplied targets and completion criteria. Each case runs one shared world with three aircraft. Duration is host time; this pair is not a statistical performance estimate.`);
  } else {
    setText('#shared-world-comparison-note', 'Import both nominal and withdrawal cases to compare recorded mission durations. This file contains one case.');
  }
}
function setTrace(next, description) {
  trace = next; source = description;
  $('#shared-world-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id })));
  renderComparison(); setCase(trace.cases.find(item => item.id === 'withdrawal')?.id ?? trace.cases[0].id);
}
function renderTasks(frame) {
  $('#shared-world-task-rows').replaceChildren(...frame.tasks.map(task => {
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
  setText('#shared-world-ownership-note', `${pending.length} pending · ${locked.length} locked · ${frame.tasksCompleted} completed. ${locked.length ? `${locked.map(task => task.id).join(', ')} await coordinator release after fresh landing confirmation; they are not eligible for reassignment yet.` : 'Only pending work and available vehicles participate in the next greedy allocation.'}`);
  $('#shared-world-ledger-envelope').textContent = JSON.stringify({ assignments: frame.assignments, attempts: frame.attempts, taskEvents: run.taskEvents.filter(event => event.timeMs <= timeMs) }, null, 2);
}
function renderTree(vehicle) {
  const tick = vehicle.bt, statuses = new Map((tick?.visited ?? []).map(item => [item.id, item.status]));
  const halted = new Set((tick?.halts ?? []).map(item => item.id));
  const depth = node => node.parent ? 1 + depth(RECOVERY_TREE.find(parent => parent.id === node.parent)) : 0;
  $('#shared-world-tree').replaceChildren(...RECOVERY_TREE.map(node => {
    const status = statuses.get(node.id) ?? 'IDLE';
    const row = el('div', '', { class: 'shared-world-tree-node', 'data-node': node.id, 'data-depth': String(depth(node)), 'data-status': status, 'data-halted': String(halted.has(node.id)) });
    const name = el('span'), symbol = node.type.toLowerCase().includes('fallback') ? '?' : node.type.toLowerCase().includes('sequence') ? '→' : node.type.toLowerCase().includes('condition') ? '◇' : '■';
    name.append(el('b', symbol, { class: 'shared-world-node-type', 'aria-hidden': 'true' }), document.createTextNode(node.label));
    if (node.id === 'task') name.append(el('small', tick?.inputs.attemptId ? `Tick input: ${tick.inputs.attemptId} / ${tick.inputs.attemptStatus}` : 'No attempt in this tick input'));
    row.append(name, el('b', `${halted.has(node.id) ? 'Halted · ' : ''}${statusNames[status] ?? status}`)); return row;
  }));
  setText('#shared-world-tree-title', `${selectedVehicle} / reactive Behavior Tree`);
  setText('#shared-world-tree-result', tick ? `Root: ${statusNames[tick.status] ?? tick.status}` : 'Not ticked');
  setText('#shared-world-tree-time', tick ? `Tick ${tick.index} · ${seconds(tick.timeMs)} · age ${age(timeMs - tick.timeMs)}` : 'No tick at this cursor');
  setText('#shared-world-tree-note', tick?.halts.length
    ? `Recorded halt: ${tick.halts.map(item => item.id).join(', ')}. This tick revisited higher-priority work. A halt cancels execution; release requires separate landing evidence.`
    : 'Only visited nodes have a status for this tick. The coordinator executes this tree; the autopilot controls flight. Unticked branches provide no fresh decision.');
  $('#shared-world-tree-envelope').textContent = JSON.stringify(tick, null, 2);
}
function renderHandover(frame) {
  const withdrawal = frame.withdrawal, canceled = frame.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  const reassigned = canceled ? frame.attempts.find(attempt => attempt.taskId === canceled.taskId && attempt.id !== canceled.id) : null;
  const state = reassigned ? 'reassigned' : withdrawal.releasedTimeMs !== null ? 'released' : canceled ? 'locked' : withdrawal.requestedTimeMs !== null ? 'requested' : 'waiting';
  $('#shared-world-handover').dataset.state = state;
  const observed = { withdraw: withdrawal.requestedTimeMs !== null, cancel: Boolean(canceled), land: withdrawal.landedTimeMs !== null, release: withdrawal.releasedTimeMs !== null, reassign: Boolean(reassigned) };
  for (const item of document.querySelectorAll('#shared-world-handover-steps li')) item.dataset.observed = String(observed[item.dataset.step]);
  const title = reassigned ? `${reassigned.taskId}: A1 → ${reassigned.vehicleId}` : canceled ? `${canceled.taskId}: ${state === 'released' ? 'released for a new owner' : 'still reserved by A1'}` : withdrawal.requestedTimeMs !== null ? 'A1 withdrawal requested' : 'A task belongs to at most one vehicle.';
  setText('#shared-world-handover-title', title);
  setText('#shared-world-handover-note', reassigned
    ? `New attempt ${reassigned.id} assigned at ${seconds(reassigned.assignedTimeMs)}, after A1’s landing at ${seconds(withdrawal.landedTimeMs)} and release at ${seconds(withdrawal.releasedTimeMs)}. ${reassigned.completedTimeMs !== null ? `The new owner confirmed visit-and-hold completion at ${seconds(reassigned.completedTimeMs)}.` : 'A new visit-and-hold confirmation is still required.'}`
    : canceled ? `Attempt ${canceled.id} was canceled at ${seconds(canceled.cancelledTimeMs)}. ${withdrawal.releasedTimeMs !== null ? `Fresh landing evidence allowed release at ${seconds(withdrawal.releasedTimeMs)}.` : withdrawal.landedTimeMs !== null ? `A1 is confirmed landed at ${seconds(withdrawal.landedTimeMs)}; its reservation still awaits coordinator release.` : 'Its task remains unavailable to A2 and A3 while the coordinator awaits fresh landing confirmation and releases the reservation.'}`
      : run.id === 'nominal' ? 'No withdrawal is scheduled in this recording. Every reservation ends with observed task completion.' : 'No withdrawal has been observed at this cursor. The configured interruption occurs during A1’s second visit attempt.');
  setText('#shared-world-retirement', state === 'waiting' ? 'Not requested' : state === 'locked' ? withdrawal.landedTimeMs !== null ? 'A1 landed / locked' : 'A1 landing / locked' : state === 'requested' ? 'A1 requested' : state === 'released' ? 'A1 retired / released' : `Transferred to ${reassigned.vehicleId}`);
  setText('#shared-world-retirement-note', canceled ? `${canceled.taskId} / ${canceled.id}: canceled ${seconds(canceled.cancelledTimeMs)}.` : 'A canceled attempt does not release its task.');
}
function renderCommands(vehicle, frame) {
  if (selectedCommand && !vehicle.commands.some(command => command.id === selectedCommand)) selectedCommand = null;
  const requests = vehicle.commands.map(command => {
    const ack = vehicle.acks.filter(item => item.commandId === command.id).at(-1) ?? null;
    const attempt = frame.attempts.find(item => item.commandId === command.id);
    const observation = vehicle.events.filter(item => item.stage === command.id && item.status !== 'start').at(-1) ?? null;
    return { command, ack, attempt, observation };
  });
  $('#shared-world-command-rows').replaceChildren(...requests.map(item => {
    const { command, ack, attempt, observation } = item, row = el('tr'), first = el('td');
    const button = el('button', attempt ? `${attempt.taskId} / ${attempt.id}` : stageNames[command.id] ?? command.id, { 'data-shared-world-command': command.id });
    button.addEventListener('click', () => { stop(); selectedCommand = command.id; render(); });
    first.append(button, el('small', seconds(command.timeMs)));
    const outcome = el('td', command.kind === 'setpoint' ? 'No ACK by protocol' : ack ? `${resultNames[ack.result]} (${ack.result})` : 'No ACK yet');
    outcome.append(el('small', observation ? `${observation.status} · ${seconds(observation.timeMs)}` : 'Execution not confirmed'));
    row.append(first, el('td', `Route SYS ${command.routeSystem} → ${command.targetSystem}:${command.targetComponent}`), outcome); return row;
  }));
  const selected = requests.find(item => item.command.id === selectedCommand) ?? requests.at(-1) ?? null;
  for (const button of document.querySelectorAll('[data-shared-world-command]')) button.setAttribute('aria-pressed', String(button.dataset.sharedWorldCommand === selected?.command.id));
  $('#shared-world-request-envelope').textContent = JSON.stringify(selected, null, 2);
  setText('#shared-world-request-note', selected ? `${selectedVehicle} / ${selected.command.message}. Sent envelope and evidence received by this cursor.` : 'No request has been sent by this cursor.');
}
function eventDescription(event) {
  if (event.kind === 'task') return `${event.data.taskId} / ${event.data.attemptId}: ${event.data.type}`;
  if (event.kind === 'assignment') return `${event.data.id}: greedy assignment · ${event.data.pairs.map(pair => `${pair.vehicleId} → ${pair.taskId}`).join(' · ')}`;
  if (event.kind === 'status') return event.data.text;
  return `${stageNames[event.data.stage] ?? event.data.stage}: ${event.data.status}`;
}
function render() {
  if (!run) return;
  const frame = sharedWorldFrame(run, timeMs), vehicle = frame.vehicles.find(item => item.id === selectedVehicle), raw = run.vehicles.find(item => item.id === selectedVehicle);
  view.update(run, frame, selectedVehicle); $('#shared-world-time-slider').value = String(timeMs);
  setText('#shared-world-time', seconds(timeMs)); $('#shared-world-time').dataset.timeMs = String(timeMs);
  setText('#shared-world-play', playing ? 'Ⅱ Pause trace' : timeMs >= run.endMs ? '↻ Replay trace' : '▶ Play trace');
  $('#shared-world-play').disabled = false; $('#shared-world-reset').disabled = false; $('#shared-world-step').disabled = timeMs >= run.endMs;
  setText('#shared-world-status', playing ? 'Replaying recording' : timeMs >= run.endMs ? 'Recording complete' : 'Paused recording');
  setText('#shared-world-recording-summary', `${source} · ${run.label} · ${run.vehicles.length} autopilots · one Gazebo world · ${run.btTicks.length} recorded coordinator ticks`);
  setText('#shared-world-phase-state', frame.mission.completedTimeMs !== null ? frame.mission.closed ? 'Six tasks confirmed / cleanup' : 'Six tasks confirmed' : frame.mission.closed ? 'Mission window closed' : frame.mission.started ? 'Mission execution' : 'Preparing / taking off');
  setText('#shared-world-cleanup-state', `${frame.landedVehicles} / ${run.vehicles.length} landings confirmed`);
  setText('#shared-world-tasks-count', `${frame.tasksCompleted} / ${run.tasks.length}`);
  setText('#shared-world-landing-count', `${frame.landedVehicles} / ${run.vehicles.length}`);
  setText('#shared-world-mission-time', frame.mission.started ? seconds(frame.mission.elapsedMs) : 'Not started');
  setText('#shared-world-mission-time-note', frame.mission.completedTimeMs !== null ? `Sixth task confirmed at ${seconds(frame.mission.completedTimeMs)} host time. Cleanup follows.` : 'From mission start after takeoff to the sixth confirmed task.');
  setText('#shared-world-phase-note', frame.mission.completedTimeMs !== null
    ? `All six task confirmations are observed. Mission duration: ${seconds(frame.mission.elapsedMs)}. Landing cleanup is separate: ${frame.landedVehicles} / 3 confirmed.`
    : frame.mission.started ? `${frame.tasksCompleted} / 6 tasks confirmed. Follow ownership changes in the ledger and inspect each vehicle’s recorded tree.` : 'All three aircraft must complete normal arming and takeoff before the first mission allocation. Their estimator origins remain independent; all three bodies evolve in one Gazebo world.');
  setText('#shared-world-inspector-title', `${selectedVehicle} / estimate and world evidence`); setText('#shared-world-requests-title', `${selectedVehicle} / command history`);
  const local = vehicle.latest.LOCAL_POSITION_NED, heartbeat = vehicle.latest.HEARTBEAT;
  detail($('#shared-world-vehicle-details'), [['Vehicle / TCP route', `${vehicle.systemId}:${vehicle.componentId} / 127.0.0.1:${vehicle.port}`],
    ['Gazebo model / JSON bridge', `${raw.modelName} / UDP ${raw.jsonPort}`], ['Current task / execution', `${vehicle.taskId ?? 'None'} / ${vehicle.taskState}`], ['Completed tasks', vehicle.completedTasks.join(', ') || 'None yet'],
    ['Mission ENU estimate', vector(vehicle.positionEnu)], ['Baseline-aligned world estimate', vector(vehicle.estimatePositionWorldEnu)], ['Gazebo world pose / evaluator', vector(vehicle.worldPositionEnu)], ['World pose receipt age', age(vehicle.worldAgeMs)], ['Raw local NED estimate', vector(vehicle.positionNed)], ['Supplied pad ENU', vector(vehicle.padEnu)],
    ['3D speed / task error', `${vehicle.speedMps === null ? '—' : `${vehicle.speedMps.toFixed(3)} m/s`} / ${metres(vehicle.taskErrorM)}`],
    ['Mode / arming', `${vehicle.mode ?? 'No report'} / ${vehicle.armed === null ? 'unknown' : vehicle.armed ? 'armed' : 'disarmed'}`],
    ['Reported landing state', landedNames[vehicle.landedState] ?? 'No report'], ['Position / attitude receipt age', `${age(vehicle.positionAgeMs)} / ${age(vehicle.attitudeAgeMs)}`],
    ['Landing / heartbeat receipt age', `${age(vehicle.landedAgeMs)} / ${age(vehicle.heartbeatAgeMs)}`], ['Local source / boot clock', local ? `${local.sourceSystem}:${local.sourceComponent} / ${local.data.time_boot_ms} ms` : 'No sample'],
    ['Height above this vehicle’s home', metres(vehicle.relativeAltitudeM)], ['Local baseline / receipt', timeMs >= raw.originTimeMs ? `${vector(raw.originNed)} / ${seconds(raw.originTimeMs)}` : 'Not received at this cursor']]);
  $('#shared-world-position-envelope').textContent = JSON.stringify({ vehicleId: selectedVehicle, localPosition: local, heartbeat, worldPositionEnu: vehicle.worldPositionEnu, worldAgeMs: vehicle.worldAgeMs, estimatePositionWorldEnu: vehicle.estimatePositionWorldEnu }, null, 2);
  $('#shared-world-parameters').textContent = JSON.stringify({ parameters: raw.parameters, padEnu: raw.padEnu, originNed: timeMs >= raw.originTimeMs ? raw.originNed : null, originTimeMs: timeMs >= raw.originTimeMs ? raw.originTimeMs : null, originTruthEnu: timeMs >= raw.originTruthTimeMs ? raw.originTruthEnu : null, originTruthTimeMs: timeMs >= raw.originTruthTimeMs ? raw.originTruthTimeMs : null }, null, 2);
  const meaningful = events.filter(event => event.timeMs <= timeMs && ['stage', 'mission', 'assignment', 'task'].includes(event.kind));
  $('#shared-world-event-list').replaceChildren(...meaningful.slice(-20).reverse().map(event => { const row = el('li'); row.append(el('time', `${seconds(event.timeMs)} · ${event.vehicleId ?? 'Coordinator'}`), el('span', eventDescription(event))); return row; }));
  if (!meaningful.length) $('#shared-world-event-list').append(el('li', 'No recorded decision or execution event yet.'));
  renderTasks(frame); renderTree(vehicle); renderHandover(frame); renderCommands(vehicle, frame); renderWorld(frame, vehicle);
}
function renderWorld(frame, vehicle) {
  const world = frame.world, closest = world.closestApproach, counts = world.contactTotals;
  setText('#shared-world-sim-time', world.available ? `${seconds(world.simTimeMs)} · received ${age(world.ageMs)} ago` : 'No world sample');
  setText('#shared-world-separation', metres(world.minimumObservedSeparationM));
  setText('#shared-world-separation-note', closest ? `${closest.vehicleIds.join(' ↔ ')} at ${seconds(closest.simTimeMs)} simulation time. Minimum over received snapshots; center distance, not hull clearance.` : 'No world poses received. This metric uses simultaneous Gazebo poses.');
  setText('#shared-world-contact-count', world.available ? `${world.unexpectedContactCount} non-ground pairs` : 'No contact evidence');
  setText('#shared-world-contact-note', counts ? `${counts.groundSteps} ground-contact steps · ${counts.vehicleSteps} vehicle-contact steps · ${counts.obstacleSteps} obstacle-contact steps · ${counts.otherSteps} other steps.` : 'Awaiting the simulator observer. Zero has not been observed yet.');
  setText('#shared-world-estimate-error', metres(vehicle.estimateWorldErrorM));
  setText('#shared-world-estimate-error-note', `${vehicle.id}: latest held estimate versus world pose. Position age ${age(vehicle.positionAgeMs)}; world age ${age(vehicle.worldAgeMs)}. Not a synchronized EKF error measurement.`);
  detail($('#shared-world-world-details'), [['World / clock', `${world.name} / Gazebo simulation time`],
    ['World snapshot received at', seconds(world.receiptTimeMs)], ['Snapshot simulation time', seconds(world.simTimeMs)],
    ['World receipt age / snapshots', `${age(world.ageMs)} / ${world.receivedSamples}`],
    ['Observer started / simulation time', seconds(world.observerStartSimTimeMs)],
    ['Collision shapes monitored', world.collisionCount ?? 'No evidence'],
    ['Observed physics steps', world.observerSteps ?? 'No evidence'],
    ['Current minimum pair distance', metres(world.minimumSeparationM)],
    ['World truth available to coordinator', 'No — evaluator only']]);
  $('#shared-world-pair-rows').replaceChildren(...world.pairs.map(pair => {
    const row = el('tr', '', { 'data-pair': pair.vehicleIds.join('-') });
    row.append(el('td', pair.vehicleIds.join(' ↔ ')), el('td', metres(pair.distanceM)), el('td', `Same physics update · ${seconds(world.simTimeMs)}`)); return row;
  }));
  if (!world.pairs.length) { const row = el('tr'); row.append(el('td', 'No simultaneous world poses received.', { colspan: '3' })); $('#shared-world-pair-rows').append(row); }
  $('#shared-world-contact-list').replaceChildren(...world.contactHistory.map(pair => {
    const row = el('li', '', { 'data-contact-kind': pair.kind }); row.append(el('time', `${pair.kind} · ${pair.steps} physics steps`),
      el('span', `${pair.collision1} ↔ ${pair.collision2}`), el('small', `First ${seconds(pair.firstSimTimeMs)} · last ${seconds(pair.lastSimTimeMs)} simulation time`)); return row;
  }));
  if (!world.contactHistory.length) $('#shared-world-contact-list').append(el('li', world.available ? 'No contact pair has been recorded through this snapshot.' : 'No simulator contact evidence received yet.'));
  setText('#shared-world-contacts-explanation', 'Counters count physics steps containing each category, not impacts or contact points. Ground contact includes takeoff and landing. Cumulative pair history retains contacts between pose snapshots; a clean run does not prove collision avoidance.');
  $('#shared-world-world-envelope').textContent = JSON.stringify(world, null, 2);
}
function animate(now) {
  if (!playing || !run) return;
  if (previousTick !== null) timeMs = Math.min(run.endMs, timeMs + Math.min(now - previousTick, 100) * Number($('#shared-world-speed').value));
  previousTick = now; if (timeMs >= run.endMs) stop(); render(); if (playing) animation = requestAnimationFrame(animate);
}
$('#shared-world-play').addEventListener('click', () => {
  if (!run) return; if (playing) stop(); else { if (timeMs >= run.endMs) timeMs = 0; playing = true; previousTick = null; animation = requestAnimationFrame(animate); } render();
});
$('#shared-world-step').addEventListener('click', () => { if (run) seek(events.find(event => event.timeMs > timeMs + 1e-7)?.timeMs ?? run.endMs); });
$('#shared-world-reset').addEventListener('click', () => seek(0));
$('#shared-world-case').addEventListener('change', event => { if (trace) setCase(event.target.value); });
$('#shared-world-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#shared-world-vehicle').addEventListener('change', event => { if (run) { selectedVehicle = event.target.value; selectedCommand = null; render(); } });
for (const name of ['dispatch', 'withdraw', 'locked', 'release', 'reassign', 'complete', 'landed', 'finish']) $(`#shared-world-${name}`).addEventListener('click', () => { if (run) seek(shortcuts()[name]); });
for (const mode of ['2d', '3d']) $(`#shared-world-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#shared-world-pose-source').addEventListener('change', event => {
  view.setPoseSource(event.target.value);
  setText('#shared-world-pose-title', event.target.value === 'both' ? '/ world truth + estimates' : event.target.value === 'world' ? '/ world truth · evaluator only' : '/ received estimates');
});
$('#shared-world-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; stop(); const epoch = ++importEpoch;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('The trace exceeds the 30 MB import limit.');
    const next = validateSharedWorldTrace(JSON.parse(await file.text())); if (epoch !== importEpoch) return;
    setTrace(next, 'Imported recording'); $('#shared-world-import-status').textContent = 'Imported and validated. Metadata is untrusted provenance.'; $('#shared-world-import-status').dataset.error = 'false';
  } catch (error) {
    if (epoch !== importEpoch) return; $('#shared-world-import-status').textContent = `Import rejected: ${error.message} The previous recording is retained.`; $('#shared-world-import-status').dataset.error = 'true'; render();
  } finally { event.target.value = ''; }
});
$('#shared-world-bundled').addEventListener('click', () => {
  ++importEpoch; setTrace(validateSharedWorldTrace(bundled), 'Bundled recording');
  $('#shared-world-import-status').textContent = 'Bundled, validated recording. Maximum import size: 30 MB.'; $('#shared-world-import-status').dataset.error = 'false';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
try { setTrace(validateSharedWorldTrace(bundled), source); view.setMode('3d'); }
catch (error) { $('#shared-world-status').textContent = 'Trace unavailable'; $('#shared-world-import-status').textContent = error.message; $('#shared-world-import-status').dataset.error = 'true'; }
