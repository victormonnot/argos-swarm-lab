import './style.css';
import './mission.css';
import './middleware.css';
import bundled from '../docs/results/ros2-middleware.json';
import { validateMiddlewareTrace, middlewareFrame, middlewareEvents, middlewareSummary, rmwNames } from './middleware-trace.js';
import { createMiddlewareView } from './middleware-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attributes = {}) => {
  const node = document.createElement(tag); node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
const svg = (tag, attributes, text = '') => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
const seconds = value => `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`;
const position = value => value ? `[${value.map(axis => axis.toFixed(3)).join(', ')}] m` : 'No received position';
const durability = value => value.toUpperCase();
const title = run => `${rmwNames[run.rmw]} / ${durability(run.durability)}`;
const joinedAt = run => run.processEvents.find(event => event.kind === 'subscription-create-start').timeMs;
const historical = (run, callback) => callback.generatedMs < joinedAt(run);
const phaseNames = { 'early-batch': 'Early publication batch', quiet: 'Publication silence', 'live-batch': 'Live publication batch', drain: 'Observation after the final batch' };
let trace, recording, events = [], timeMs = 0, source = 'Bundled recording';
let playing = false, animation, previousTick = null, importEpoch = 0, inspectorKey = '';
const view = createMiddlewareView($('#middleware-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#middleware-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#middleware-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. The solid drone follows synthetic evaluator XYZ. The ghost holds the last callback’s exact position, including old historical samples. No flight physics.'
      : 'Top-down x/y view of the same cursor; labels show altitude. The ghost holds the exact last received sample. The difference arrow is evaluator data, not a message in flight.');
  },
});
function detail(list, pairs) {
  list.replaceChildren(...pairs.map(([key, value]) => { const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row; }));
}
function setText(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
function stop() { playing = false; cancelAnimationFrame(animation); previousTick = null; }
function seek(value) { stop(); timeMs = Math.max(0, Math.min(recording.endMs, value)); render(); }
function setCase(id) {
  stop(); recording = trace.cases.find(item => item.id === id) ?? trace.cases[0];
  events = middlewareEvents(recording); timeMs = 0; inspectorKey = '';
  $('#middleware-case').value = recording.id; $('#middleware-time-slider').max = recording.endMs;
  $('#middleware-case-description').textContent = `${title(recording)}. ${recording.durability === 'transient_local' ? 'A compatible late reader can receive the living publisher’s retained samples; inspect the actual callback history.' : 'The late reader has no claim to pre-subscription history; inspect when its first new sample arrives.'}`;
  const runtime = trace.runtime;
  detail($('#middleware-provenance'), [
    ['Source', source], ['Recording date', runtime.recordedAt], ['Run ID', recording.runId],
    ['ROS distribution', runtime.rosDistro], ['Resolved publisher / reader RMW', `${recording.publisher.rmw} / ${recording.reader.rmw}`],
    ['Python', runtime.python], ['Image', runtime.image], ['Base image', runtime.baseImage],
    ['Runtime source SHA-256', runtime.sourceSha256], ['Clock', runtime.clock], ['Wire type', runtime.wireType],
    ['ROS domain', runtime.domainId], ['Harness transport', runtime.harness], ['Initial arming guard', `${runtime.initialGuardMs} ms`],
    ['Publisher node / PID', `${recording.publisher.node} / ${recording.publisher.pid}`],
    ['Reader node / PID', `${recording.reader.node} / ${recording.reader.pid}`],
    ['Publisher requested QoS', JSON.stringify(recording.publisher.qos)],
    ['Reader requested QoS', JSON.stringify(recording.reader.qos)],
    ['Publisher graph-reported QoS', JSON.stringify(recording.publisher.graphQos)],
    ['Reader graph-reported QoS', JSON.stringify(recording.reader.graphQos)],
    ['Graph QoS limits', 'UNKNOWN history / depth 0 mean unreported fields, not an empty actual cache. Recorded callbacks supply behavioral evidence.'],
    ['Zenoh router / session', recording.router ? `PID ${recording.router.pid} / ${recording.router.role} / ${recording.router.sessionMode}` : 'Not used'],
    ['Zenoh configuration SHA-256', JSON.stringify(runtime.configFiles)], ['Package versions', JSON.stringify(runtime.packages)],
  ]);
  for (const button of document.querySelectorAll('#middleware-comparison tr')) button.dataset.selected = String(button.dataset.case === recording.id);
  $('#middleware-inspect-volatile').disabled = !trace.cases.some(item => item.rmw === recording.rmw && item.durability === 'volatile');
  $('#middleware-inspect-history').disabled = !trace.cases.some(item => item.rmw === recording.rmw && item.durability === 'transient_local');
  $('#middleware-swap-rmw').disabled = !trace.cases.some(item => item.rmw !== recording.rmw && item.durability === recording.durability);
  renderTopology(); render();
}
function renderComparison() {
  $('#middleware-comparison').replaceChildren(...trace.cases.map(run => {
    const summary = middlewareSummary(run), row = el('tr', '', { 'data-case': run.id });
    const first = el('td'), button = el('button', title(run), { 'data-middleware-compare': run.id });
    button.addEventListener('click', () => setCase(run.id)); first.append(button);
    const historicalCount = run.callbacks.filter(callback => historical(run, callback)).length;
    const counts = el('td', `${historicalCount} / ${summary.received - historicalCount}`);
    counts.append(el('small', `${summary.uniqueReceived} unique sequences; ${summary.duplicates} duplicate callbacks`, { class: 'middleware-table-note' }));
    const observed = el('td', summary.historicalSequences.length ? summary.historicalSequences.map(seq => `#${seq}`).join(', ') : 'None');
    observed.append(el('small', `${summary.historyMatchesContract ? 'History matches the bounded contract.' : 'Observed history differs from the bounded contract.'} ${summary.liveComplete ? 'Live batch complete.' : 'Live batch incomplete.'}`, { class: 'middleware-table-note' }));
    row.append(first, el('td', String(summary.published)), counts, observed, el('td', summary.joinToFirstCallbackMs === null ? 'No callback in recording' : age(summary.joinToFirstCallbackMs)));
    return row;
  }));
}
function setTrace(nextTrace, description) {
  trace = nextTrace; source = description;
  $('#middleware-case').replaceChildren(...trace.cases.map(item => el('option', title(item), { value: item.id })));
  renderComparison();
  setCase(trace.cases.find(item => item.rmw === 'rmw_fastrtps_cpp' && item.durability === 'transient_local')?.id ?? trace.cases[0].id);
}
function renderTopology() {
  const zenoh = recording.rmw === 'rmw_zenoh_cpp';
  const diagram = svg('svg', { viewBox: '0 0 520 195', role: 'img', 'aria-label': zenoh ? 'Declared Zenoh peer configuration: publisher and reader connect to a discovery router; default peer data connectivity is separate. No packet path is measured.' : 'Declared Fast DDS configuration: publisher and reader discover locally and exchange topic data. No packet route is measured.' });
  const box = (x, y, w, h, text, color = '#edf3e8') => { diagram.append(svg('rect', { x, y, width: w, height: h, rx: 6, fill: color, stroke: '#9baa98' }), svg('text', { x: x + w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle', class: 'middleware-topology-label' }, text)); };
  const line = (x1, y1, x2, y2, dashed = false) => diagram.append(svg('line', { x1, y1, x2, y2, stroke: dashed ? '#a59171' : '#5e846e', 'stroke-width': 2, 'stroke-dasharray': dashed ? '5 5' : 'none' }));
  box(8, 111, 150, 53, 'Publisher process'); box(362, 111, 150, 53, 'Reader process');
  line(158, 137, 362, 137); diagram.append(svg('text', { x: 260, y: 128, 'text-anchor': 'middle', class: 'middleware-topology-label' }, zenoh ? 'peer data connectivity' : 'DDS topic data'));
  if (zenoh) { box(177, 12, 166, 44, 'Discovery router', '#f4ecdf'); line(90, 108, 207, 57, true); line(430, 108, 313, 57, true); }
  else { line(158, 82, 362, 82, true); diagram.append(svg('text', { x: 260, y: 70, 'text-anchor': 'middle', class: 'middleware-topology-label' }, 'local endpoint discovery')); }
  diagram.append(svg('text', { x: 260, y: 188, 'text-anchor': 'middle', class: 'middleware-topology-label' }, 'CONFIGURATION SCHEMATIC · NO PACKET CAPTURE'));
  $('#middleware-topology-diagram').replaceChildren(diagram);
  $('#middleware-topology-title').textContent = zenoh ? 'Zenoh: discovery router, peer sessions.' : 'Fast DDS: local endpoint discovery.';
  $('#middleware-topology-note').textContent = zenoh
    ? 'The Zenoh router participates in discovery. Default peer connectivity can carry application data directly; this experiment does not force data through the router or instrument the actual route.'
    : 'The Fast DDS endpoints use the recorded local configuration. The connecting line indicates the publisher/reader relationship, not a captured network route or radio model.';
}
function renderChart(frame) {
  const width = 540, x0 = 112, gap = 19.8, chart = svg('svg', { viewBox: `0 0 ${width} 187`, role: 'img', 'aria-label': `Publications and callbacks for sequences zero through nineteen up to ${seconds(timeMs)}. Historical callbacks are amber; live callbacks are green. Future events are not shown.` });
  chart.append(svg('text', { x: x0 + 4.5 * gap, y: 17, 'text-anchor': 'middle', 'font-size': 10, fill: '#687e70' }, 'EARLY BATCH / 0–0.9 S'), svg('text', { x: x0 + 14.5 * gap, y: 17, 'text-anchor': 'middle', 'font-size': 10, fill: '#687e70' }, 'LIVE BATCH / 4–4.9 S'));
  for (const [label, y] of [['Published', 64], ['Callback', 109]]) chart.append(svg('text', { x: x0 - 17, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#465c4e' }, label));
  for (let seq = 0; seq < 20; seq++) {
    const x = x0 + seq * gap, publication = frame.publications.find(item => item.seq === seq), callbacks = frame.callbacks.filter(item => item.seq === seq);
    chart.append(svg('text', { x, y: 37, 'text-anchor': 'middle', 'font-size': 10, fill: '#6b7a6a' }, String(seq)));
    chart.append(svg('circle', { cx: x, cy: 64, r: 6, fill: publication ? '#497b61' : '#f0f2eb', stroke: '#b6c2b1' }));
    if (callbacks.length) {
      const color = historical(recording, callbacks[0]) ? '#c58b50' : '#497b61';
      chart.append(svg('rect', { x: x - 6, y: 103, width: 12, height: 12, rx: 2, fill: color }));
      if (callbacks.length > 1) chart.append(svg('text', { x, y: 132, 'text-anchor': 'middle', 'font-size': 9, fill: '#6b7a6a' }, `×${callbacks.length}`));
    } else chart.append(svg('text', { x, y: 113, 'text-anchor': 'middle', 'font-size': 12, fill: '#9dad9b' }, '–'));
  }
  chart.append(svg('line', { x1: x0 + 9.5 * gap, x2: x0 + 9.5 * gap, y1: 29, y2: 138, stroke: '#b6c2b1', 'stroke-dasharray': '3 4' }));
  [['#497b61', 'Live callback'], ['#c58b50', 'Historical callback'], ['#f0f2eb', 'No event yet']].forEach(([color, text], index) => { const x = 90 + index * 146; chart.append(svg('rect', { x, y: 162, width: 10, height: 10, rx: 2, fill: color, stroke: '#b6c2b1' }), svg('text', { x: x + 16, y: 171, 'font-size': 10, fill: '#687e70' }, text)); });
  $('#middleware-sample-chart').replaceChildren(chart);
}
function renderInspector(frame) {
  const callback = frame.lastCallback, key = `${recording.runId}/${frame.callbacks.length}`;
  if (key !== inspectorKey) {
    inspectorKey = key;
    detail($('#middleware-callback-details'), [
      ['Logical agent / sequence', callback ? `${callback.agentId} / #${callback.seq}` : 'No callback yet'],
      ['Generation time', callback ? seconds(callback.generatedMs) : '—'], ['Callback receipt time', callback ? seconds(callback.callbackMs) : '—'],
      ['Generation-to-callback age', callback ? age(callback.callbackMs - callback.generatedMs) : '—'],
      ['Sample classification', callback ? historical(recording, callback) ? 'Historical / generated before subscription request' : 'Live / generated after subscription request' : '—'],
      ['Received XYZ', position(callback?.position)],
    ]);
    $('#middleware-callback-note').dataset.history = String(Boolean(callback && historical(recording, callback)));
    $('#middleware-callback-note').textContent = !callback ? 'No callback has reached this reader. Its application has no position to hold.'
      : historical(recording, callback) ? 'This callback carries history: its position was generated before this reader requested a subscription. Receipt is recent; the sample is older.'
      : 'This callback carries a sample generated after subscription was requested. The application holds it unchanged until another callback arrives.';
    $('#middleware-envelope').textContent = callback ? JSON.stringify(callback, null, 2) : 'No callback received at this cursor.';
    $('#middleware-callbacks').replaceChildren(...frame.callbacks.slice(-12).reverse().map(item => {
      const row = el('tr'), sequence = el('td'), button = el('button', `#${item.seq}`, { 'data-middleware-callback': String(recording.callbacks.indexOf(item)), 'aria-label': `Inspect received sequence ${item.seq}` });
      button.addEventListener('click', () => seek(item.callbackMs)); sequence.append(button);
      const isHistorical = historical(recording, item);
      row.append(sequence, el('td', (item.callbackMs / 1000).toFixed(3)), el('td', isHistorical ? 'History' : 'Live', { 'data-history': String(isHistorical) }), el('td', (item.callbackMs - item.generatedMs).toFixed(1))); return row;
    }));
  }
  // Publications may change even when no callback has arrived.
  renderChart(frame);
  const error = frame.position ? Math.hypot(...frame.sourcePosition.map((axis, i) => axis - frame.position[i])) : null;
  detail($('#middleware-retained-details'), [
    ['Last callback / sequence', callback ? `#${callback.seq} at ${seconds(callback.callbackMs)}` : 'None'],
    ['Retained XYZ', position(frame.position)], ['Held sample age', age(frame.generationAgeMs)],
    ['Cursor − last callback receipt', callback ? age(timeMs - callback.callbackMs) : '—'],
    ['Position difference / evaluator', error === null ? 'No retained position' : `${error.toFixed(3)} m`],
    ['Historical / live callbacks', `${frame.historicalCallbacks.length} / ${frame.liveCallbacks.length}`],
  ]);
}
function render() {
  const frame = middlewareFrame(recording, timeMs), callback = frame.lastCallback;
  view.update(recording, frame);
  $('#middleware-play').disabled = timeMs >= recording.endMs; $('#middleware-step').disabled = timeMs >= recording.endMs; $('#middleware-reset').disabled = false;
  setText('#middleware-play', playing ? 'Ⅱ Pause trace' : '▶ Play trace'); $('#middleware-play').setAttribute('aria-pressed', String(playing));
  $('#middleware-time-slider').value = timeMs; setText('#middleware-time', seconds(timeMs));
  setText('#middleware-status', timeMs >= recording.endMs ? 'Recorded end reached' : playing ? 'Replaying recorded time' : 'Recorded replay paused');
  setText('#middleware-recording-summary', `${source} · ${trace.runtime.rosDistro} · ${title(recording)} · ${recording.callbacks.length} actual callbacks`);
  setText('#middleware-source-state', `Publisher alive · ${phaseNames[frame.phase].toLowerCase()}`); $('#middleware-source-state').dataset.quiet = String(frame.phase === 'quiet' || frame.phase === 'drain');
  setText('#middleware-reader-state', frame.readerStatus === 'waiting' ? 'Reader process alive · no subscription yet' : frame.readerStatus === 'creating' ? 'Reader: creating its subscription' : `Reader subscribed · ${frame.receivedCount} callbacks observed`);
  setText('#middleware-subscription', { waiting: 'Not created', creating: 'Creating', listening: 'Created' }[frame.readerStatus]);
  setText('#middleware-subscription-note', frame.subscriptionCreatedMs === null ? 'Reader process is already alive.' : `Creation completed at ${seconds(frame.subscriptionCreatedMs)}.`);
  setText('#middleware-received', String(frame.receivedCount)); setText('#middleware-received-note', `History / live: ${frame.historicalCallbacks.length} / ${frame.liveCallbacks.length}`);
  setText('#middleware-held-age', callback ? age(frame.generationAgeMs) : '—'); setText('#middleware-held-seq', callback ? `#${callback.seq}` : 'None');
  setText('#middleware-held-note', callback ? `${historical(recording, callback) ? 'Historical' : 'Live'} sample · generated at ${seconds(callback.generatedMs)}.` : 'No position available to the reader.');
  $('#middleware-first').disabled = !recording.callbacks.length;
  const event = frame.events.at(-1);
  setText('#middleware-phase-note', `${phaseNames[frame.phase]}. ${event ? `Last recorded event: ${event.kind.replaceAll('-', ' ')} at ${seconds(event.timeMs)}.` : 'Before the first recorded event.'} The application holds only actual callback data.`);
  const outcome = frame.readerStatus === 'waiting' ? 'The reader process is alive, but its subscription does not exist yet. The publisher can send without this reader receiving anything.'
    : frame.readerStatus === 'creating' ? 'The reader has started subscription creation. This is not yet evidence that matching or a callback has completed.'
    : !callback ? `The subscription exists, but no callback has arrived. ${recording.durability === 'volatile' ? 'VOLATILE supplies no pre-subscription history; the next publication batch starts at 4 s.' : 'TRANSIENT_LOCAL makes retained history available, but the display waits for actual recorded receipts.'}`
    : historical(recording, callback) ? 'The reader now holds a historical position. Its callback has arrived, but the sample is old: compare the moving evaluator reference with the held ghost.'
    : frame.phase === 'drain' ? 'Publications have ended. The reader holds its last callback while its sample age keeps increasing. RELIABLE delivery does not make a held position stay current.'
    : 'The reader holds the exact position carried by its last callback. Switching 2D / 3D preserves this same recorded state; changing case rewinds an independent run.';
  setText('#middleware-outcome', outcome); $('#middleware-outcome').dataset.status = callback ? 'ready' : 'budget';
  renderInspector(frame);
  detail($('#middleware-process-details'), [
    ['Publisher node / PID', `${recording.publisher.node} / ${recording.publisher.pid}`], ['Reader node / PID', `${recording.reader.node} / ${recording.reader.pid}`],
    ['Publisher phase', phaseNames[frame.phase]], ['Publications observed', `${frame.publications.length} / 20`],
    ['Subscription creation start', timeMs >= joinedAt(recording) ? seconds(joinedAt(recording)) : 'Not reached at this cursor'],
    ['Subscription creation completed', frame.subscriptionCreatedMs === null ? 'Not reached at this cursor' : seconds(frame.subscriptionCreatedMs)],
    ['Evaluator reference now', position(frame.sourcePosition)],
  ]);
}
function tick(now) {
  if (!playing) return;
  if (previousTick !== null) timeMs = Math.min(recording.endMs, timeMs + (now - previousTick) * Number($('#middleware-speed').value));
  previousTick = now;
  if (timeMs >= recording.endMs) stop();
  render(); if (playing) animation = requestAnimationFrame(tick);
}
$('#middleware-play').addEventListener('click', () => { if (playing) stop(); else if (timeMs < recording.endMs) { playing = true; previousTick = null; animation = requestAnimationFrame(tick); } render(); });
$('#middleware-step').addEventListener('click', () => seek(events.find(event => event.timeMs > timeMs)?.timeMs ?? recording.endMs));
$('#middleware-reset').addEventListener('click', () => seek(0));
$('#middleware-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#middleware-case').addEventListener('change', event => setCase(event.target.value));
$('#middleware-join').addEventListener('click', () => seek(joinedAt(recording)));
$('#middleware-first').addEventListener('click', () => { if (recording.callbacks.length) seek(recording.callbacks[0].callbackMs); });
$('#middleware-live').addEventListener('click', () => seek(recording.publications.find(item => item.seq === 10).generatedMs));
$('#middleware-finish').addEventListener('click', () => seek(recording.endMs));
for (const mode of ['2d', '3d']) $(`#middleware-${mode}`).addEventListener('click', () => view.setMode(mode));
$('#middleware-inspect-volatile').addEventListener('click', () => { const run = trace.cases.find(item => item.rmw === recording.rmw && item.durability === 'volatile'); if (run) { setCase(run.id); seek(run.processEvents[1].timeMs); } });
$('#middleware-inspect-history').addEventListener('click', () => { const run = trace.cases.find(item => item.rmw === recording.rmw && item.durability === 'transient_local'); if (run) { setCase(run.id); seek(middlewareSummary(run).firstHistoricalCallbackMs ?? run.processEvents[1].timeMs); } });
$('#middleware-swap-rmw').addEventListener('click', () => { const run = trace.cases.find(item => item.rmw !== recording.rmw && item.durability === recording.durability); if (run) setCase(run.id); });
$('#middleware-import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const epoch = ++importEpoch, status = $('#middleware-import-status'); stop(); render();
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB import limit.');
    const text = await file.text(); if (epoch !== importEpoch) return;
    const next = validateMiddlewareTrace(JSON.parse(text));
    setTrace(next, 'Imported recording'); status.dataset.error = 'false'; status.textContent = `Imported ${file.name}. Structure checked; provenance is not authenticated.`;
  } catch (error) {
    if (epoch !== importEpoch) return;
    status.dataset.error = 'true'; status.textContent = `Import rejected. ${error.message} The active recording was kept.`;
  } finally { if (epoch === importEpoch) event.target.value = ''; }
});
$('#middleware-bundled').addEventListener('click', () => { importEpoch++; $('#middleware-import').value = ''; setTrace(validateMiddlewareTrace(bundled), 'Bundled recording'); $('#middleware-import-status').dataset.error = 'false'; $('#middleware-import-status').textContent = 'Bundled, validated recording restored. Maximum import size: 10 MB.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); }, { once: true });
setTrace(validateMiddlewareTrace(bundled), 'Bundled recording');
view.setMode('3d');
