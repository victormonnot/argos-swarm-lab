import './style.css';
import './mission.css';
import './qos.css';
import bundled from '../docs/results/ros2-qos.json';
import { validateQosTrace, qosFrame, qosEvents, qosSummary } from './qos-trace.js';
import { createQosView } from './qos-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attributes = {}) => {
  const element = document.createElement(tag); element.textContent = text;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};
const svg = (tag, attributes, text = '') => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text; return element;
};
const seconds = value => `${(value / 1000).toFixed(3)} s`;
const age = value => value === null || value === undefined ? 'No sample' : `${value.toFixed(1)} ms`;
const position = value => value ? `[${value.map(axis => axis.toFixed(3)).join(', ')}] m` : 'No accepted position';
const names = { history20: 'History / depth 20', latest1: 'Latest / depth 1', gated20: 'Age gate / depth 20' };
const chartColors = { history20: '#a26837', latest1: '#36795d', gated20: '#80679e' };
let trace, recording, events = [], timeMs = 0, selected = 'history20', source = 'Bundled recording';
let playing = false, animation, previousTick = null, importEpoch = 0, inspectorKey = '';
const readerCards = new Map();
const view = createQosView($('#qos-viewport'), {
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#qos-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#qos-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. The solid drone follows synthetic XYZ reference positions. The ghost holds the selected reader’s last accepted sample, including its recorded altitude. No flight dynamics.'
      : 'Top-down x/y view of the same cursor. Labels show z altitude. The solid drone is evaluator reference; the ghost holds the reader’s last accepted sample. The arrow is spatial difference, not a message in flight.');
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
  events = qosEvents(recording); timeMs = 0; selected = 'history20'; inspectorKey = '';
  $('#qos-case').value = recording.id; $('#qos-time-slider').max = recording.endMs;
  const { config } = recording;
  $('#qos-case-description').textContent = config.pauseStartMs === null
    ? 'Nominal recording: reader executors remain available. Publishing stops at 4 s; observation continues so retained-state age remains visible.'
    : `Scheduled reader pause: ${seconds(config.pauseStartMs)}–${seconds(config.pauseEndMs)}. The actual pause/resume timestamps are recorded independently per reader. The publisher keeps running.`;
  $('#qos-readers').replaceChildren(); readerCards.clear();
  for (const reader of recording.readers) {
    const button = el('button', '', { id: `qos-reader-${reader.id}`, 'data-qos-reader': reader.id, 'aria-pressed': String(selected === reader.id), class: 'qos-reader' });
    const head = el('span', '', { class: 'qos-reader-head' }), label = el('span', names[reader.id], { class: 'qos-reader-name' }), state = el('span', 'No sample', { class: 'qos-freshness' });
    head.append(label, state);
    const policy = el('span', `RELIABLE · KEEP_LAST ${reader.depth} · ${reader.ageLimitMs === null ? 'accept every callback' : 'accept age ≤ 150 ms'}`, { class: 'qos-reader-policy' });
    const value = el('span', '', { class: 'qos-reader-age' }), note = el('span', '', { class: 'qos-reader-last' });
    button.append(head, policy, value, note); button.addEventListener('click', () => { selected = reader.id; inspectorKey = ''; render(); });
    $('#qos-readers').append(button); readerCards.set(reader.id, { button, state, value, note });
  }
  for (const button of document.querySelectorAll('[data-qos-case]')) button.disabled = !trace.cases.some(item => button.dataset.qosCase === 'pause' ? item.config.pauseStartMs !== null : item.config.pauseStartMs === null);
  $('#qos-inspect-gated').disabled = !trace.cases.some(item => item.config.pauseStartMs !== null);
  const runtime = trace.runtime;
  detail($('#qos-provenance'), [
    ['Source', source], ['Recording date', runtime.recordedAt], ['Run ID', recording.runId],
    ['ROS distribution / RMW', `${runtime.rosDistro} / ${runtime.rmw}`], ['Python', runtime.python],
    ['Image', runtime.image], ['Runtime source SHA-256', runtime.sourceSha256],
    ['Clock', runtime.clock], ['Wire message type', runtime.wireType ?? 'Recorded in runtime metadata'],
    ['ROS domain', runtime.domainId ?? 'Recorded in runtime metadata'],
    ['Publisher QoS', 'RELIABLE / VOLATILE / KEEP_LAST / depth 20'],
    ['Publisher node / PID', `${recording.publisher.node} / ${recording.publisher.pid}`],
    ...recording.readers.map(reader => [`${names[reader.id]} / PID`, `${reader.node} / ${reader.pid}`]),
    ['Collector node / PID', `${recording.collector.node} / ${recording.collector.pid}`],
    ['Package versions', runtime.packages ? JSON.stringify(runtime.packages) : 'Not supplied'],
  ]);
  render();
}
function setTrace(nextTrace, description) {
  trace = nextTrace; source = description;
  $('#qos-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id })));
  setCase(trace.cases.find(item => item.config.pauseStartMs !== null)?.id ?? trace.cases[0].id);
}
function firstCallbacksAfterResume() {
  const callbacks = qosSummary(recording).map(reader => reader.firstAfterPause);
  return callbacks.every(Boolean) ? Math.max(...callbacks.map(callback => callback.callbackMs)) : null;
}
function renderChart(frame) {
  const width = 500, height = 225, startX = 49, endX = 476, startY = 14, endY = 162;
  const ymax = Math.max(300, ...frame.readers.flatMap(reader => [reader.ageMs ?? 0, ...reader.callbacks.filter(callback => callback.callbackMs <= timeMs).map(callback => callback.ageMs)]));
  const maxAge = Math.ceil(ymax / 250) * 250;
  const sx = value => startX + value / recording.endMs * (endX - startX), sy = value => endY - Math.min(maxAge, value) / maxAge * (endY - startY);
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Retained-information age up to ${seconds(timeMs)}. History, latest and gated reader in milliseconds. Dashed line: 150 ms freshness threshold.` });
  if (recording.config.pauseStartMs !== null) {
    const x = sx(recording.config.pauseStartMs), right = sx(recording.config.pauseEndMs);
    chart.append(svg('rect', { x, y: startY, width: right - x, height: endY - startY, fill: '#f5eee4' }), svg('text', { x: (x + right) / 2, y: 10, 'text-anchor': 'middle', 'font-size': 9, fill: '#8a7059' }, 'scheduled pause'));
  }
  chart.append(svg('path', { d: `M${startX} ${startY}V${endY}H${endX}`, fill: 'none', stroke: '#c4cfbf' }));
  for (const tick of [0, 150, maxAge]) {
    chart.append(svg('line', { x1: startX, x2: endX, y1: sy(tick), y2: sy(tick), stroke: tick === 150 ? '#a88158' : '#d9e0d3', 'stroke-dasharray': tick === 150 ? '4 4' : 'none' }), svg('text', { x: startX - 7, y: sy(tick) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#5d7364' }, String(tick)));
  }
  for (const reader of frame.readers) {
    const points = [], accepted = reader.callbacks.filter(callback => callback.accepted && callback.callbackMs <= timeMs);
    let last = null;
    for (const callback of accepted) {
      if (last) points.push([callback.callbackMs, callback.callbackMs - last.generatedMs]);
      points.push([callback.callbackMs, callback.ageMs]); last = callback;
    }
    if (last) points.push([timeMs, timeMs - last.generatedMs]);
    if (points.length) chart.append(svg('polyline', { points: points.map(([t, a]) => `${sx(t)},${sy(a)}`).join(' '), fill: 'none', stroke: chartColors[reader.id], 'stroke-width': reader.id === selected ? 2.7 : 1.4, opacity: reader.id === selected ? 1 : .65 }));
  }
  chart.append(svg('line', { x1: sx(timeMs), x2: sx(timeMs), y1: startY, y2: endY, stroke: '#5a6d62', 'stroke-dasharray': '3 4' }));
  for (const value of [0, 1000, 2000, 3000, 4000, recording.endMs]) chart.append(svg('text', { x: sx(value), y: 180, 'text-anchor': 'middle', 'font-size': 10, fill: '#5d7364' }, (value / 1000).toFixed(1)));
  chart.append(svg('text', { x: endX, y: 195, 'text-anchor': 'end', 'font-size': 10, fill: '#5d7364' }, 'recorded elapsed time / s'));
  ['history20', 'latest1', 'gated20'].forEach((id, index) => { const x = startX + index * 145; chart.append(svg('line', { x1: x, x2: x + 17, y1: 214, y2: 214, stroke: chartColors[id], 'stroke-width': 3 }), svg('text', { x: x + 22, y: 217, 'font-size': 10, fill: chartColors[id] }, names[id])); });
  $('#qos-age-chart').replaceChildren(chart);
}
function renderInspector(reader) {
  const callback = reader.lastCallback, key = `${recording.runId}/${reader.id}/${callback?.seq ?? 'none'}`;
  if (key !== inspectorKey) {
    inspectorKey = key; $('#qos-callback-title').textContent = `${names[reader.id]} / last callback`;
    detail($('#qos-callback-details'), [
      ['Reader node / PID', `${reader.node} / ${reader.pid}`], ['Run ID', recording.runId],
      ['Sequence', callback ? String(callback.seq) : 'No callback yet'],
      ['Generation stamp', callback ? seconds(callback.generatedMs) : '—'],
      ['Callback time', callback ? seconds(callback.callbackMs) : '—'],
      ['Age at callback', callback ? age(callback.ageMs) : '—'],
      ['Received XYZ position', callback ? position(callback.position) : '—'],
      ['Acceptance reason', callback ? callback.reason : 'Waiting for a callback'],
    ]);
    $('#qos-envelope').textContent = callback ? JSON.stringify(callback, null, 2) : 'No callback has executed at this cursor.';
    $('#qos-callback-decision').dataset.rejected = String(callback?.accepted === false);
    $('#qos-callback-decision').textContent = !callback ? 'No position has entered this reader through a callback yet.'
      : !callback.accepted ? `Rejected: ${age(callback.ageMs)} exceeds the 150 ms application limit. The previously accepted position is retained and continues to age.`
      : reader.ageLimitMs === null ? `Accepted without an age gate. A ${age(callback.ageMs)} callback can update this reader even when the sample is already stale.`
      : `Accepted: ${age(callback.ageMs)} is within the 150 ms application limit. This checks the sample now; it cannot guarantee that the retained state will remain fresh later.`;
    $('#qos-callbacks').replaceChildren(...reader.callbacks.filter(item => item.callbackMs <= timeMs).slice(-8).reverse().map(item => {
      const row = el('tr'), cell = el('td'), button = el('button', String(item.seq), { 'data-qos-callback': item.seq, 'aria-label': `Inspect sequence ${item.seq} at ${(item.callbackMs / 1000).toFixed(3)} seconds` });
      button.addEventListener('click', () => seek(item.callbackMs)); cell.append(button);
      row.append(cell, el('td', (item.callbackMs / 1000).toFixed(3)), el('td', item.ageMs.toFixed(1)), el('td', item.accepted ? 'Accepted' : 'Rejected', { 'data-rejected': !item.accepted })); return row;
    }));
  }
  detail($('#qos-retained-details'), [
    ['Retained sequence', reader.lastAccepted ? String(reader.lastAccepted.seq) : 'None'],
    ['Retained XYZ position', position(reader.position)],
    ['Generated at', reader.lastAccepted ? seconds(reader.lastAccepted.generatedMs) : '—'],
    ['Age of information now', age(reader.ageMs)],
    ['Current freshness / ≤ 150 ms', reader.position ? (reader.fresh ? 'Fresh' : 'Stale') : 'No accepted sample'],
    ['Executor', reader.paused ? 'Paused / no callbacks' : 'Available'],
    ['Recorded pause interval', reader.pauses.length ? reader.pauses.map(pause => `${seconds(pause.startMs)}–${seconds(pause.endMs)}`).join(', ') : 'None'],
    ['XYZ difference / evaluator', reader.positionError === null ? '—' : `${reader.positionError.toFixed(3)} m`],
  ]);
}
function render() {
  const frame = qosFrame(recording, timeMs), reader = frame.readers.find(item => item.id === selected);
  view.update(recording, frame, selected);
  $('#qos-play').disabled = timeMs >= recording.endMs; $('#qos-step').disabled = timeMs >= recording.endMs; $('#qos-reset').disabled = false;
  setText('#qos-play', playing ? 'Ⅱ Pause trace' : '▶ Play trace'); $('#qos-play').setAttribute('aria-pressed', String(playing));
  $('#qos-time-slider').value = timeMs; setText('#qos-time-label', seconds(timeMs));
  const paused = frame.readers.some(item => item.paused), ended = timeMs >= recording.endMs;
  setText('#qos-status', ended ? 'Recorded end reached' : playing ? 'Replaying recorded time' : paused ? 'Paused readers / replay stopped' : 'Recorded replay paused');
  setText('#qos-recording-summary', `${source} · ${trace.runtime.rosDistro} · ${recording.publications.length} publications · three reader processes`);
  setText('#qos-source-state', timeMs >= recording.config.publishDurationMs ? 'Publisher: stopped / reference continues' : frame.publication ? `Publisher: latest sequence ${frame.publication.seq}` : 'Publisher: no sample yet');
  setText('#qos-reader-state', `${names[selected]}: ${reader.paused ? 'executor paused' : reader.position ? reader.fresh ? 'retained state fresh' : 'retained state stale' : 'waiting for a callback'}`);
  $('#qos-reader-state').dataset.paused = String(reader.paused);
  const after = firstCallbacksAfterResume();
  $('#qos-before-pause').disabled = !reader.pauses.length; $('#qos-after-resume').disabled = after === null;
  const event = frame.events.at(-1);
  const eventText = event ? `Last recorded event: ${event.kind}${event.readerId ? ` / ${names[event.readerId]}` : ''}${event.data.seq !== undefined ? ` / sequence ${event.data.seq}` : ''} at ${seconds(event.timeMs)}.` : 'Before the first recorded publication.';
  setText('#qos-phase-note', `${eventText} ${timeMs >= recording.config.publishDurationMs ? 'The reference moves beyond the final published sample. Readers receive none of those unsent positions.' : 'Generation and callback timestamps use the same host clock.'}`);
  for (const item of frame.readers) {
    const card = readerCards.get(item.id); card.button.setAttribute('aria-pressed', String(item.id === selected));
    Object.assign(card.button.dataset, { ageMs: item.ageMs === null ? 'null' : String(item.ageMs), received: String(item.received), accepted: String(item.accepted), rejected: String(item.rejected), lastSeq: item.lastAccepted === null ? 'null' : String(item.lastAccepted.seq) });
    card.state.textContent = item.position ? item.fresh ? 'FRESH' : 'STALE' : 'NO SAMPLE'; card.state.dataset.fresh = String(item.fresh);
    card.value.replaceChildren(document.createTextNode(item.ageMs === null ? '—' : item.ageMs.toFixed(1)), el('small', ' ms / retained age'));
    card.note.textContent = `${item.paused ? 'Executor paused · ' : ''}last accepted ${item.lastAccepted ? `#${item.lastAccepted.seq}` : 'none'} · ${item.received} callbacks · ${item.rejected} rejected`;
  }
  const outcome = reader.paused ? 'The selected reader is not taking callbacks. Its remembered position stays fixed while the reference keeps moving and the information ages.'
    : timeMs >= recording.config.publishDurationMs ? 'Publication has stopped. A reader may drain recorded history, but no reader receives the source’s later reference positions. Watch every retained state become stale.'
    : reader.lastCallback?.accepted === false ? 'The gate rejects an old callback, but the reader still holds an older accepted position. Rejecting stale input alone does not recover fresh state.'
    : reader.position && !reader.fresh ? 'This reader is using stale information. Reliable delivery and a successfully executed callback do not imply a current position.'
    : 'Compare each callback’s age with the age of the position retained now. Use the resume shortcut, then select another reader at the same recorded time.';
  setText('#qos-outcome', outcome); $('#qos-outcome').dataset.status = reader.position && !reader.fresh ? 'budget' : 'ready';
  renderInspector(reader); renderChart(frame);
  $('#qos-counts').replaceChildren(...frame.readers.map(item => { const row = el('tr'); row.append(...[names[item.id], `KEEP_LAST ${item.depth}`, item.received, item.accepted, item.rejected, item.unobserved].map(value => el('td', String(value)))); return row; }));
}
function tick(now) {
  if (!playing) return;
  if (previousTick !== null) timeMs = Math.min(recording.endMs, timeMs + (now - previousTick) * Number($('#qos-speed').value));
  previousTick = now;
  if (timeMs >= recording.endMs) stop();
  render(); if (playing) animation = requestAnimationFrame(tick);
}
$('#qos-play').addEventListener('click', () => { if (playing) stop(); else if (timeMs < recording.endMs) { playing = true; previousTick = null; animation = requestAnimationFrame(tick); } render(); });
$('#qos-step').addEventListener('click', () => seek(events.find(event => event.timeMs > timeMs)?.timeMs ?? recording.endMs));
$('#qos-reset').addEventListener('click', () => seek(0));
$('#qos-time-slider').addEventListener('input', event => seek(Number(event.target.value)));
$('#qos-case').addEventListener('change', event => setCase(event.target.value));
$('#qos-before-pause').addEventListener('click', () => { const pause = recording.readers.find(reader => reader.id === selected).pauses[0]; if (pause) seek(Math.max(0, pause.startMs - 1)); });
$('#qos-after-resume').addEventListener('click', () => { const time = firstCallbacksAfterResume(); if (time !== null) seek(time); });
$('#qos-finish').addEventListener('click', () => seek(recording.endMs));
for (const mode of ['2d', '3d']) $(`#qos-${mode}`).addEventListener('click', () => view.setMode(mode));
for (const button of document.querySelectorAll('[data-qos-case]')) button.addEventListener('click', () => { const pause = button.dataset.qosCase === 'pause'; const target = trace.cases.find(item => (item.config.pauseStartMs !== null) === pause); if (target) setCase(target.id); });
$('#qos-inspect-gated').addEventListener('click', () => {
  const target = trace.cases.find(item => item.config.pauseStartMs !== null); if (!target) return;
  setCase(target.id); selected = 'gated20'; seek(firstCallbacksAfterResume() ?? 0);
  $('#qos-experiment').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
});
$('#qos-import').addEventListener('change', async event => {
  const file = event.target.files[0], epoch = ++importEpoch; if (!file) return;
  const status = $('#qos-import-status');
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB import limit.');
    const text = await file.text(); if (epoch !== importEpoch) return;
    const next = validateQosTrace(JSON.parse(text));
    setTrace(next, 'Imported recording'); status.dataset.error = 'false'; status.textContent = `Imported ${file.name}. Structure checked; provenance is not authenticated.`;
  } catch (error) {
    if (epoch !== importEpoch) return;
    status.dataset.error = 'true'; status.textContent = `Import rejected. ${error.message} The active recording was kept.`;
  } finally { if (epoch === importEpoch) event.target.value = ''; }
});
$('#qos-bundled').addEventListener('click', () => { importEpoch++; $('#qos-import').value = ''; setTrace(validateQosTrace(bundled), 'Bundled recording'); $('#qos-import-status').dataset.error = 'false'; $('#qos-import-status').textContent = 'Bundled, validated recording restored. Maximum import size: 10 MB.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); render(); } });
window.addEventListener('pagehide', () => { stop(); view.dispose(); }, { once: true });
setTrace(validateQosTrace(bundled), 'Bundled recording');
view.setMode('3d');
