import './style.css';
import './mission.css';
import './restart.css';
import bundled from '../docs/results/ros2-restart.json';
import { validateRestartTrace, restartFrame, restartEvents, restartSummary } from './restart-trace.js';
import { createRestartView } from './restart-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attributes = {}) => {
  const node = document.createElement(tag); node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};
const svg = (tag, attributes, text = '') => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text; return node;
};
const seconds = value => `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? 'No accepted heartbeat' : `${value.toFixed(1)} ms`;
const position = value => value ? `[${value.map(axis => axis.toFixed(3)).join(', ')}] m` : 'No accepted position';
const identity = callback => callback ? `epoch ${callback.epoch} / #${callback.seq}` : 'None';
const caseKind = run => run.agents.length === 2 ? 'restart' : run.config.interruptMs !== null ? 'silence' : 'normal';
const names = { sequence: 'Sequence-only', incarnation: 'Epoch + sequence' };
const stateNames = { awaiting: 'Awaiting first heartbeat', live: 'Recent accepted heartbeat', suspect: 'Suspect' };
const stateColors = { awaiting: '#9baba0', live: '#618a6e', suspect: '#c18362' };
const reasonNames = { 'first-message': 'First message', 'new-sequence': 'Increasing sequence', 'new-epoch': 'Newer epoch', 'duplicate-or-old-sequence': 'Duplicate or old sequence', 'old-epoch': 'Older epoch' };
let trace, recording, events = [], summaries = [], timeMs = 0, selected = 'sequence', source = 'Bundled recording';
let playing = false, animation, previousTick = null, importEpoch = 0, inspectorKey = '';
const policyCards = new Map();
const view = createRestartView($('#restart-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#restart-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#restart-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. The solid drone is a synthetic evaluator reference, continuing through software interruptions. The ghost holds the selected policy’s last accepted XYZ. No flight physics or physical crash.'
      : 'Top-down x/y view of the same cursor; labels show altitude. The reference continues even when no process publishes. The ghost is the last accepted sample; the arrow is position difference, not a message in flight.');
  },
});
function detail(list, pairs) {
  list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; }));
}
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { stop(); timeMs = Math.max(0, Math.min(recording.endMs, value)); render(); }
function interruptionTime() {
  if (recording.config.interruptMs === null) return null;
  return recording.processEvents.find(event => event.timeMs >= recording.config.interruptMs)?.timeMs ?? null;
}
function targetTime(kind) {
  const summary = summaries.find(item => item.id === selected);
  if (kind === 'interruption') return interruptionTime();
  if (kind === 'suspicion') return summary.firstSuspicionMs;
  if (kind === 'return') return summary.returnCallback?.callbackMs ?? null;
  if (kind === 'recovery') return summary.firstAcceptedAfterReturn?.callbackMs ?? null;
  return null;
}
function setCase(id) {
  stop(); recording = trace.cases.find(item => item.id === id) ?? trace.cases[0];
  events = restartEvents(recording); summaries = restartSummary(recording); timeMs = 0; selected = 'sequence'; inspectorKey = '';
  $('#restart-case').value = recording.id; $('#restart-time-slider').max = recording.endMs;
  const descriptions = {
    normal: 'Nominal recording: A1 publishes throughout the 8 s observation. The same process, epoch and increasing sequence serve both admission policies.',
    silence: 'Publication silence: the process remains running but stops sending from about 1.5 to 3 s. It resumes with the same PID and epoch, continuing its sequence counter.',
    restart: 'Process restart: the runner sends SIGKILL at about 1.5 s and launches a replacement at about 3 s. The new process keeps logical identity A1 and its node name, but has a new PID, epoch 2 and sequence 0.',
  };
  $('#restart-case-description').textContent = descriptions[caseKind(recording)];
  $('#restart-policies').replaceChildren(); policyCards.clear();
  for (const id of ['sequence', 'incarnation']) {
    const button = el('button', '', { id: `restart-policy-${id}`, 'data-restart-policy': id, 'aria-pressed': String(selected === id), class: 'restart-policy' });
    const head = el('span', '', { class: 'restart-policy-head' }), label = el('span', names[id], { class: 'restart-policy-name' }), state = el('span', 'Awaiting', { class: 'restart-monitor-badge' });
    head.append(label, state);
    const rule = el('span', id === 'sequence' ? 'Accept a higher sequence number; ignore epoch changes.' : 'Accept a newer epoch, or a higher sequence within the same epoch.', { class: 'restart-policy-policy' });
    const value = el('span', '', { class: 'restart-policy-age' }), note = el('span', '', { class: 'restart-policy-last' });
    button.append(head, rule, value, note); button.addEventListener('click', () => { selected = id; inspectorKey = ''; render(); });
    $('#restart-policies').append(button); policyCards.set(id, { button, state, value, note });
  }
  for (const button of document.querySelectorAll('[data-restart-case]')) button.disabled = !trace.cases.some(item => caseKind(item) === button.dataset.restartCase);
  $('#restart-inspect-return').disabled = !trace.cases.some(item => caseKind(item) === 'restart');
  const runtime = trace.runtime;
  detail($('#restart-provenance'), [
    ['Source', source], ['Recording date', runtime.recordedAt], ['Run ID', recording.runId],
    ['ROS distribution / RMW', `${runtime.rosDistro} / ${runtime.rmw}`], ['Python', runtime.python],
    ['Image', runtime.image], ['Runtime source SHA-256', runtime.sourceSha256],
    ['Clock', runtime.clock], ['Wire message type', runtime.wireType ?? 'Recorded in runtime metadata'],
    ['ROS domain', runtime.domainId ?? 'Recorded in runtime metadata'],
    ['Heartbeat period / watchdog timeout', `${recording.config.heartbeatPeriodMs} ms / ${recording.config.timeoutMs} ms`],
    ['Watchdog check period', `${recording.config.watchdogPeriodMs} ms`],
    ['Restart arming guard', `${recording.config.restartGuardMs} ms after readiness, then the next heartbeat slot`],
    ['Heartbeat QoS', 'RELIABLE / VOLATILE / KEEP_LAST / depth 20'],
    ...recording.agents.map(agent => [`A1 epoch ${agent.epoch} / node / PID`, `${agent.node} / ${agent.pid}`]),
    ['Observer node / PID', `${recording.observer.node} / ${recording.observer.pid}`],
    ['Collector node / PID', `${recording.collector.node} / ${recording.collector.pid}`],
    ['Package versions', runtime.packages ? JSON.stringify(runtime.packages) : 'Not supplied'],
  ]);
  render();
}
function setTrace(nextTrace, description) {
  trace = nextTrace; source = description;
  $('#restart-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id })));
  setCase(trace.cases.find(item => caseKind(item) === 'restart')?.id ?? trace.cases[0].id);
}
function renderChart(frame) {
  const width = 510, left = 115, right = 491, sx = value => left + value / recording.endMs * (right - left);
  const chart = svg('svg', { viewBox: `0 0 ${width} 151`, role: 'img', 'aria-label': `Recorded observer states up to ${seconds(timeMs)}. Sequence-only and epoch-aware policies. Recent accepted heartbeat is green; suspect is amber. No future state is shown.` });
  ['sequence', 'incarnation'].forEach((id, index) => {
    const y = 22 + index * 40, transitions = frame.transitions.filter(item => item.policy === id);
    chart.append(svg('text', { x: left - 10, y: y + 17, 'text-anchor': 'end', fill: '#465c4e', 'font-size': 11 }, names[id]));
    chart.append(svg('rect', { x: left, y, width: right - left, height: 24, rx: 3, fill: '#edf0e9' }));
    let state = 'awaiting', from = 0;
    for (const transition of [...transitions, { timeMs, status: null }]) {
      if (transition.timeMs > from) chart.append(svg('rect', { x: sx(from), y, width: Math.max(0, sx(transition.timeMs) - sx(from)), height: 24, fill: stateColors[state] }));
      from = transition.timeMs; state = transition.status;
    }
  });
  chart.append(svg('line', { x1: sx(timeMs), x2: sx(timeMs), y1: 13, y2: 93, stroke: '#334f43', 'stroke-width': 1.5 }));
  for (const value of [0, 2000, 4000, 6000, recording.endMs]) chart.append(svg('text', { x: sx(value), y: 108, 'text-anchor': 'middle', 'font-size': 10, fill: '#607469' }, `${(value / 1000).toFixed(1)} s`));
  [['awaiting', 'Awaiting'], ['live', 'Recent'], ['suspect', 'Suspect']].forEach(([state, label], index) => { const x = left + index * 122; chart.append(svg('rect', { x, y: 131, width: 12, height: 10, fill: stateColors[state] }), svg('text', { x: x + 18, y: 140, 'font-size': 10, fill: '#607469' }, label)); });
  $('#restart-state-chart').replaceChildren(chart);
}
function renderInspector(frame, policy) {
  const callback = frame.lastCallback, decision = policy.lastDecision, key = `${recording.runId}/${selected}/${frame.callbacks.length}`;
  if (key !== inspectorKey) {
    inspectorKey = key;
    $('#restart-callback-title').textContent = `${names[selected]} / last heartbeat callback`;
    detail($('#restart-callback-details'), [
      ['Logical identity', callback?.agentId ?? 'No callback yet'], ['Epoch / sequence received', identity(callback)],
      ['Generation time', callback ? seconds(callback.generatedMs) : '—'], ['Local callback receipt', callback ? seconds(callback.callbackMs) : '—'],
      ['Generation-to-callback age', callback ? age(callback.callbackMs - callback.generatedMs) : '—'],
      ['Received XYZ', position(callback?.position)],
      ['Sequence-only decision', callback ? `${callback.decisions.sequence.accepted ? 'Accepted' : 'Ignored'} / ${reasonNames[callback.decisions.sequence.reason] ?? callback.decisions.sequence.reason}` : '—'],
      ['Epoch-aware decision', callback ? `${callback.decisions.incarnation.accepted ? 'Accepted' : 'Ignored'} / ${reasonNames[callback.decisions.incarnation.reason] ?? callback.decisions.incarnation.reason}` : '—'],
    ]);
    const text = !callback ? 'No callback has arrived. Neither policy has started its heartbeat watchdog.'
      : decision.accepted ? `Accepted: ${reasonNames[decision.reason] ?? decision.reason}. This callback refreshes the ${names[selected].toLowerCase()} watchdog and retained position.`
      : `Ignored: ${reasonNames[decision.reason] ?? decision.reason}. The observer received this envelope, but ${names[selected].toLowerCase()} keeps its previous sample and last-accepted receipt time.`;
    $('#restart-callback-decision').textContent = text; $('#restart-callback-decision').dataset.rejected = String(decision?.accepted === false);
    $('#restart-envelope').textContent = callback ? JSON.stringify(callback, null, 2) : 'No callback received at this cursor.';
    $('#restart-callbacks').replaceChildren(...frame.callbacks.slice(-8).reverse().map(item => {
      const row = el('tr'), button = el('button', `e${item.epoch} / #${item.seq}`, { 'data-restart-callback': String(recording.callbacks.indexOf(item)), class: 'restart-callback-code', 'aria-label': `Inspect epoch ${item.epoch} sequence ${item.seq}` }), sequence = el('td');
      button.addEventListener('click', () => seek(item.callbackMs)); sequence.append(button);
      const accepted = item.decisions[selected].accepted, result = el('td', accepted ? 'Accepted' : 'Ignored', { 'data-rejected': String(!accepted) });
      row.append(sequence, el('td', (item.callbackMs / 1000).toFixed(3)), result); return row;
    }));
  }
  const summary = summaries.find(item => item.id === selected);
  const returned = summary.returnCallback && summary.returnCallback.callbackMs <= timeMs;
  const recovered = summary.firstAcceptedAfterReturn && summary.firstAcceptedAfterReturn.callbackMs <= timeMs;
  detail($('#restart-retained-details'), [
    ['Observer belief', stateNames[policy.status]], ['Last accepted epoch / seq', identity(policy.lastAccepted)],
    ['Last raw callback receipt', callback ? seconds(callback.callbackMs) : 'None'],
    ['Last accepted receipt', policy.lastAccepted ? seconds(policy.lastAccepted.callbackMs) : 'None'],
    ['Watchdog age / accepted receipt', age(policy.receiptAgeMs)],
    ['Time until timeout threshold', policy.deadlineRemainingMs === null ? 'Not started' : `${policy.deadlineRemainingMs.toFixed(1)} ms${policy.deadlineRemainingMs === 0 && policy.status !== 'suspect' ? ' / awaiting recorded check' : ''}`],
    ['Retained sample age / generation', age(policy.generationAgeMs)], ['Retained XYZ', position(policy.position)],
    ['Spatial difference / evaluator', policy.positionError === null ? 'No retained position' : `${policy.positionError.toFixed(3)} m`],
    ['Callbacks / accepted / ignored', `${policy.received} / ${policy.accepted} / ${policy.rejected}`],
    ...(returned ? [
      ['First returning callback', seconds(summary.returnCallback.callbackMs)],
      ['Return to first acceptance', recovered ? age(summary.returnToAcceptanceMs) : 'Not accepted yet'],
      ...(summary.spawnToAcceptanceMs === null ? [] : [['Launch to first acceptance', recovered ? `${age(summary.spawnToAcceptanceMs)} / includes arming guard` : 'Not accepted yet']]),
    ] : []),
  ]);
}
function render() {
  const frame = restartFrame(recording, timeMs), policy = frame.policies.find(item => item.id === selected), process = frame.process;
  view.update(recording, frame, selected);
  $('#restart-play').disabled = timeMs >= recording.endMs; $('#restart-step').disabled = timeMs >= recording.endMs; $('#restart-reset').disabled = false;
  setText('#restart-play', playing ? 'Ⅱ Pause trace' : '▶ Play trace'); $('#restart-play').setAttribute('aria-pressed', String(playing));
  $('#restart-time-slider').value = timeMs; setText('#restart-time', seconds(timeMs));
  setText('#restart-status', timeMs >= recording.endMs ? 'Recorded end reached' : playing ? 'Replaying recorded time' : 'Recorded replay paused');
  setText('#restart-recording-summary', `${source} · ${trace.runtime.rosDistro} · ${recording.callbacks.length} actual heartbeat callbacks · two admission policies`);
  setText('#restart-process-state', `Runner truth: ${process.status} · epoch ${process.epoch ?? '—'} · PID ${process.pid ?? '—'}`);
  setText('#restart-monitor-state', `${names[selected]} belief: ${stateNames[policy.status].toLowerCase()}`);
  $('#restart-monitor-state').dataset.state = policy.status;
  for (const kind of ['interruption', 'suspicion', 'return', 'recovery']) $(`#restart-${kind}`).disabled = targetTime(kind) === null;
  const event = frame.events.at(-1);
  const eventText = event ? `Last recorded event: ${event.kind.replaceAll('-', ' ')}${event.policy ? ` / ${names[event.policy]}` : ''} at ${seconds(event.timeMs)}.` : 'Before the first recorded heartbeat.';
  setText('#restart-phase-note', `${eventText} A harness event does not update the observer; a callback must pass its selected admission rule.`);
  for (const item of frame.policies) {
    const card = policyCards.get(item.id); card.button.setAttribute('aria-pressed', String(item.id === selected));
    Object.assign(card.button.dataset, { status: item.status, receiptAgeMs: String(item.receiptAgeMs), accepted: String(item.accepted), rejected: String(item.rejected), lastSeq: String(item.seq), epoch: String(item.epoch) });
    card.state.textContent = item.status === 'awaiting' ? 'AWAITING' : item.status === 'live' ? 'RECENT' : 'SUSPECT'; card.state.dataset.state = item.status;
    card.value.replaceChildren(document.createTextNode(item.receiptAgeMs === null ? '—' : item.receiptAgeMs.toFixed(1)), el('small', ' ms / accepted-receipt age'));
    card.note.textContent = `Last accepted ${identity(item.lastAccepted).toLowerCase()} · ${item.accepted} accepted · ${item.rejected} ignored`;
  }
  const outcome = policy.status === 'awaiting' ? 'The observer has not accepted its first heartbeat. No watchdog timeout is inferred before that first receipt.'
    : process.status === 'silent' && policy.status === 'suspect' ? 'The process is still running, yet this observer suspects it. Publication silence alone is enough to exceed the watchdog timeout.'
    : policy.lastDecision?.accepted === false && frame.lastCallback?.epoch > (policy.lastAccepted?.epoch ?? 0) ? 'A heartbeat from the restarted process has arrived, but the sequence-only high-water mark rejects it. Switch to Epoch + sequence at this exact cursor to inspect the other decision.'
    : policy.status === 'suspect' ? 'The selected policy has no recent accepted heartbeat. That establishes suspicion; the observer cannot infer a process crash from silence alone.'
    : policy.lastAccepted?.epoch > 1 ? 'This policy has accepted a heartbeat from the new incarnation. Recent accepted communication is restored here; task, controller and mission state are outside this experiment.'
    : 'Both policies inspect the same callbacks. Compare publication silence with a restart, then inspect raw receipt time separately from the last accepted receipt.';
  setText('#restart-outcome', outcome); $('#restart-outcome').dataset.status = policy.status === 'suspect' ? 'budget' : 'ready';
  renderInspector(frame, policy); renderChart(frame);
  detail($('#restart-process-details'), [
    ['Logical agent / recorded node', `A1 / ${process.node ?? '—'}`], ['Process status / harness', process.status],
    ['Current incarnation / PID', `epoch ${process.epoch ?? '—'} / ${process.pid ?? '—'}`],
    ['Last harness event', process.lastEvent ? `${process.lastEvent.kind.replaceAll('-', ' ')} at ${seconds(process.lastEvent.timeMs)}` : 'Initial process ready'],
    ['Last actual publication', frame.publication ? `${identity(frame.publication)} at ${seconds(frame.publication.generatedMs)}` : 'None'],
    ['Evaluator reference now', position(frame.sourcePosition)],
  ]);
  const visible = frame.events.filter(item => !['publication', 'callback'].includes(item.kind)).slice(-10);
  $('#restart-events').replaceChildren(...visible.map(item => { const row = el('li'); row.append(el('span', seconds(item.timeMs)), document.createTextNode(item.policy ? `${names[item.policy]} → ${stateNames[item.data.status] ?? item.data.status} (${item.data.reason})` : `Runner / ${item.kind.replaceAll('-', ' ')}${item.data.epoch ? ` / epoch ${item.data.epoch}` : ''}`)); return row; }));
  if (!visible.length) $('#restart-events').append(el('li', 'No interruption or observer transition at this cursor.'));
}
function tick(now) {
  if (!playing) return;
  if (previousTick !== null) timeMs = Math.min(recording.endMs, timeMs + (now - previousTick) * Number($('#restart-speed').value));
  previousTick = now;
  if (timeMs >= recording.endMs) stop();
  render(); if (playing) animation = requestAnimationFrame(tick);
}
$('#restart-play').addEventListener('click', () => { if (playing) stop(); else if (timeMs < recording.endMs) { playing = true; previousTick = null; animation = requestAnimationFrame(tick); } render(); });
$('#restart-step').addEventListener('click', () => seek(events.find(event => event.timeMs > timeMs)?.timeMs ?? recording.endMs));
$('#restart-reset').addEventListener('click', () => seek(0));
$('#restart-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#restart-case').addEventListener('change', event => setCase(event.target.value));
for (const kind of ['interruption', 'suspicion', 'return', 'recovery']) $(`#restart-${kind}`).addEventListener('click', () => { const target = targetTime(kind); if (target !== null) seek(target); });
$('#restart-finish').addEventListener('click', () => seek(recording.endMs));
for (const mode of ['2d', '3d']) $(`#restart-${mode}`).addEventListener('click', () => view.setMode(mode));
for (const button of document.querySelectorAll('[data-restart-case]')) button.addEventListener('click', () => { const target = trace.cases.find(item => caseKind(item) === button.dataset.restartCase); if (target) setCase(target.id); });
$('#restart-inspect-return').addEventListener('click', () => {
  const target = trace.cases.find(item => caseKind(item) === 'restart'); if (!target) return;
  setCase(target.id); seek(targetTime('return') ?? 0);
  $('#restart-experiment').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
});
$('#restart-import').addEventListener('change', async event => {
  const file = event.target.files[0], epoch = ++importEpoch; if (!file) return;
  const status = $('#restart-import-status');
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB import limit.');
    const text = await file.text(); if (epoch !== importEpoch) return;
    const next = validateRestartTrace(JSON.parse(text));
    setTrace(next, 'Imported recording'); status.dataset.error = 'false'; status.textContent = `Imported ${file.name}. Structure checked; provenance is not authenticated.`;
  } catch (error) {
    if (epoch !== importEpoch) return;
    status.dataset.error = 'true'; status.textContent = `Import rejected. ${error.message} The active recording was kept.`;
  } finally { if (epoch === importEpoch) event.target.value = ''; }
});
$('#restart-bundled').addEventListener('click', () => { importEpoch++; $('#restart-import').value = ''; setTrace(validateRestartTrace(bundled), 'Bundled recording'); $('#restart-import-status').dataset.error = 'false'; $('#restart-import-status').textContent = 'Bundled, validated recording restored. Maximum import size: 10 MB.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); }, { once: true });
setTrace(validateRestartTrace(bundled), 'Bundled recording');
view.setMode('3d');
