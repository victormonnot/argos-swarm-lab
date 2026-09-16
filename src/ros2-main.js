import './style.css';
import './mission.css';
import './ros2.css';
import bundled from '../docs/results/ros2-consensus.json';
import { validateTrace, traceFrame, compareTrace, traceMetrics } from './ros2-trace.js';
import { createRosView } from './ros2-view.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text = '', attributes = {}) => {
  const element = document.createElement(tag);
  element.textContent = text;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};
const fmt = (value, precision = 4) => Math.abs(value) > 0 && Math.abs(value) < 10 ** -precision ? value.toExponential(2) : value.toFixed(precision);
const svg = (tag, attributes, text = '') => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text;
  return element;
};
let trace = validateTrace(bundled), recording, events = [], cursor = 0, selected = 0;
let playing = false, timer, comparison, source = 'Bundled recording';
const view = createRosView($('#ros-viewport'), {
  onSelect(id) { selected = id; render(); },
  onModeChange(mode, message) {
    for (const name of ['2d', '3d']) $(`#ros-${name}`).setAttribute('aria-pressed', String(mode === name));
    $('#ros-view-hint').textContent = message ?? (mode === '3d'
      ? 'Drag to orbit · scroll to zoom. Blocks represent processes, not robots. Small column heights encode local scalar values; spatial arrangement is only a software diagram.'
      : 'Choose an agent to inspect its received envelopes. Lines are configured neighbor links. Message markers show the selected exchange, not measured propagation speed.');
  },
});
function stop() { playing = false; clearTimeout(timer); }
function makeEvents(data) {
  const result = [{ round: 0, phase: 'state', exchangeIndex: null }];
  for (const exchange of data.rounds) {
    result.push({ round: exchange.round, phase: 'publish', exchangeIndex: exchange.round });
    result.push({ round: exchange.round, phase: 'receive', exchangeIndex: exchange.round });
    result.push({ round: exchange.round + Number(exchange.status === 'complete'), phase: exchange.status === 'complete' ? 'commit' : 'timeout', exchangeIndex: exchange.round });
  }
  return result;
}
function setCase(id) {
  stop(); recording = trace.cases.find(item => item.id === id) ?? trace.cases[0];
  events = makeEvents(recording); cursor = 0; selected = 0; comparison = compareTrace(recording);
  $('#ros-case').value = recording.id;
  for (const button of document.querySelectorAll('[data-ros-case-kind]')) {
    const kind = button.dataset.rosCaseKind;
    button.disabled = !trace.cases.some(item => kind === 'missing' ? Boolean(item.omittedPublication) : item.topology === kind && !item.omittedPublication);
  }
  $('#ros-agent').replaceChildren(...recording.agents.map(agent => el('option', `A${agent.id + 1} / ${agent.node}`, { value: agent.id })));
  $('#ros-round-slider').max = recording.states.length - 1;
  render();
}
function setTrace(nextTrace, description) {
  trace = nextTrace; source = description;
  $('#ros-case').replaceChildren(...trace.cases.map(item => el('option', item.label, { value: item.id })));
  setCase(trace.cases[0].id);
}
function advance() {
  if (cursor < events.length - 1) cursor++;
  if (cursor === events.length - 1) stop();
  render();
}
function schedule() {
  if (!playing) return;
  timer = setTimeout(() => { advance(); schedule(); }, 1000 / Number($('#ros-speed').value));
}
function detail(list, pairs) {
  list.replaceChildren(...pairs.map(([key, value]) => {
    const row = el('div'); row.append(el('dt', key), el('dd', String(value))); return row;
  }));
}
function renderHistory(round) {
  const width = 480, height = 140, max = Math.max(.01, traceMetrics(recording.initialValues).disagreement);
  const states = recording.states, end = Math.max(1, states.length - 1);
  const sx = index => 30 + index / end * 420;
  const sy = value => 110 - Math.max(0, Math.min(1, value / max)) * 90;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Recorded disagreement over ${states.length - 1} committed rounds. Current round ${round}.` });
  chart.append(svg('path', { d: 'M30 15V110H452', fill: 'none', stroke: '#cbd7c9' }));
  chart.append(svg('polyline', { points: states.map(state => `${sx(state.round)},${sy(traceMetrics(state.values).disagreement)}`).join(' '), fill: 'none', stroke: '#53856c', 'stroke-width': 2 }));
  chart.append(svg('line', { x1: sx(round), x2: sx(round), y1: 15, y2: 110, stroke: '#b88043', 'stroke-dasharray': '3 4' }));
  chart.append(svg('circle', { cx: sx(round), cy: sy(traceMetrics(states[round].values).disagreement), r: 4, fill: '#b88043' }));
  for (const [x, y, text] of [[5, 23, fmt(max, 0)], [13, 113, '0'], [29, 131, '0'], [421, 131, String(states.length - 1)]]) chart.append(svg('text', { x, y, fill: '#63796b', 'font-size': 11 }, text));
  $('#ros-history').replaceChildren(chart);
}
function renderInspector(event, frame, exchange) {
  const agent = recording.agents[selected];
  const previous = exchange ? recording.states[exchange.round].values[selected] : frame.values[selected];
  const deliveriesVisible = ['receive', 'commit', 'timeout'].includes(event.phase);
  const received = deliveriesVisible ? exchange.received.filter(item => item.agent === selected) : [];
  const update = deliveriesVisible ? exchange.updates.find(item => item.agent === selected) : undefined;
  $('#ros-agent').value = selected;
  detail($('#ros-agent-details'), [
    ['Node / wire sender ID', `${agent.node} / ${agent.id}`], ['Recorded process PID', agent.pid],
    ['Value topic', `/argos_${recording.runId}/agent_${agent.id}/value`],
    ['Committed local value', fmt(frame.values[selected], 6)],
    ['Configured neighbors', agent.neighbors.map(id => `A${id + 1}`).join(', ')],
    ['Run identity', recording.runId],
    ['Inspected exchange', exchange ? `${exchange.round} → ${exchange.round + 1}` : 'None / initial state'],
  ]);
  $('#ros-inbox-caption').textContent = exchange ? `Inputs for A${selected + 1} in exchange ${exchange.round} → ${exchange.round + 1}. Values are actual recorded receipts, not inferred from another node’s displayed state.` : 'Choose Next phase to inspect the recorded message exchange.';
  $('#ros-inbox-note').textContent = event.phase === 'state' ? 'Initial state: no exchange has been selected.' : event.phase === 'publish' ? 'Publication phase: sends are shown now. Advance to Receive to reveal the recorded inbox.' : `Replay groups all logged receipts for round ${exchange.round}. It does not claim a wall-clock callback order.`;
  $('#ros-inbox').replaceChildren(...agent.neighbors.map(from => {
    const packet = received.find(item => item.from === from);
    const missing = deliveriesVisible && !packet;
    const row = el('tr', '', { 'data-from': from, 'data-received': Boolean(packet) });
    row.append(el('td', `A${from + 1}`), el('td', packet ? String(packet.round) : '—'), el('td', packet ? fmt(packet.value, 6) : '—'), el('td', packet ? 'Received' : missing ? 'Missing' : 'Not revealed', { 'data-missing': missing }));
    return row;
  }));
  const sum = received.reduce((total, item) => total + item.value - previous, 0);
  const expected = previous + recording.alpha * sum;
  $('#ros-calculation').textContent = update
    ? `${fmt(previous)} + (1/12) × (${fmt(sum)}) = ${fmt(expected, 6)}. Recorded candidate: ${fmt(update.value, 6)}${event.phase === 'commit' ? ' / globally committed' : event.phase === 'timeout' ? ' / not globally committed: barrier timed out' : ' / local candidate reported; global commit pending'}`
    : deliveriesVisible && received.length < agent.neighbors.length
      ? `Own x = ${fmt(previous)}. ${received.length}/${agent.neighbors.length} required inputs received. No complete local update was reported.`
      : `Own x = ${fmt(previous)}. The rule requires every configured neighbor’s value from this same round.`;
  $('#ros-calculation').dataset.update = update ? String(update.value) : '';
  $('#ros-envelopes').textContent = JSON.stringify(received, null, 2);
  $('#ros-states').replaceChildren(...recording.agents.map(item => {
    const row = el('tr', '', { 'data-agent': item.id, 'data-value': frame.values[item.id], class: item.id === selected ? 'selected' : '' });
    const cell = el('td'), button = el('button', `A${item.id + 1}`, { 'aria-label': `Inspect A${item.id + 1}`, 'aria-pressed': item.id === selected });
    button.addEventListener('click', () => { selected = item.id; render(); }); cell.append(button);
    row.append(cell, el('td', String(item.pid)), el('td', fmt(frame.values[item.id], 6)), el('td', item.neighbors.map(id => `A${id + 1}`).join(', '))); return row;
  }));
}
function render() {
  const event = events[cursor], frame = traceFrame(recording, event.round);
  const exchange = event.exchangeIndex === null ? null : recording.rounds[event.exchangeIndex];
  const terminal = cursor === events.length - 1, metrics = traceMetrics(frame.values);
  $('#ros-status').textContent = playing ? 'Replaying recording' : terminal ? event.phase === 'timeout' ? 'Recorded timeout' : 'End of recording' : 'Replay paused';
  $('#ros-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play trace';
  $('#ros-play').disabled = terminal;
  $('#ros-step').disabled = terminal; $('#ros-next-round').disabled = terminal; $('#ros-reset').disabled = false;
  $('#ros-round').textContent = frame.round;
  $('#ros-round-label').textContent = `${frame.round} / ${recording.states.length - 1}`;
  $('#ros-round-slider').value = frame.round;
  $('#ros-budget').textContent = `${recording.outcome.completedRounds} recorded / ${recording.plannedRounds} planned rounds`;
  $('#ros-disagreement').textContent = fmt(metrics.disagreement);
  $('#ros-mean').textContent = fmt(metrics.mean);
  $('#ros-reference').textContent = comparison.matches ? 'Matches' : 'Mismatch';
  $('#ros-reference').dataset.matches = comparison.matches;
  $('#ros-reference-details').textContent = `${comparison.comparedStates} states · maximum absolute difference ${fmt(comparison.maxError, 10)} · tolerance 1e−10`;
  const missingCase = recording.omittedPublication;
  $('#ros-initial-values').textContent = `[${recording.initialValues.map(value => fmt(value, 3)).join(', ')}] · α = 1/12 · initial mean = ${fmt(traceMetrics(recording.initialValues).mean, 4)}`;
  $('#ros-case-description').textContent = missingCase
    ? `Application-level omission: A${missingCase.agent + 1} (wire ID ${missingCase.agent}) skips round ${missingCase.round}. The trace contains an incomplete inbox and a supervisor timeout. No dropped-network-packet behavior is inferred.`
    : recording.topology === 'chain'
      ? 'Neighbor subscriptions form a chain. Each endpoint has one peer; internal nodes have two. The algorithm and gain stay identical to the complete graph.'
      : 'Every agent subscribes to the other five agents. All nodes independently compute their update from the same logical round.';
  $('#ros-recording-summary').textContent = `${source} · ${trace.runtime.rosDistro} · ${trace.runtime.rmw} · six distinct agent PIDs`;
  $('#ros-phase-note').textContent = event.phase === 'state' ? `Initial committed state. Next phase reveals ${recording.rounds[0]?.published.length ?? 0} recorded publications.`
    : event.phase === 'publish' ? `Exchange ${exchange.round} → ${exchange.round + 1}: ${exchange.published.length} recorded publications. Values remain at committed round ${frame.round}.`
      : event.phase === 'receive' ? `Exchange ${exchange.round} → ${exchange.round + 1}: ${exchange.received.length} recorded neighbor receipts. Select a process to inspect its complete or incomplete inbox.`
        : event.phase === 'timeout' ? `Round ${exchange.round + 1} never committed: ${exchange.missing.length} expected neighbor inputs are missing. Recorded state stays at round ${frame.round}.`
          : `Round ${frame.round} committed after all six candidates were reported. These are the new recorded node values.`;
  const activePhase = event.phase === 'timeout' ? 'receive' : event.phase;
  $('.ros-phase-bar').dataset.timeout = event.phase === 'timeout';
  for (const item of document.querySelectorAll('[data-ros-phase]')) item.setAttribute('aria-current', item.dataset.rosPhase === activePhase ? 'step' : 'false');
  $('#ros-outcome').dataset.status = event.phase === 'timeout' ? 'blocked' : 'ready';
  const agreement = metrics.disagreement <= .01 ? 'Current global spread meets the 0.01 agreement threshold.' : 'Current global spread is above the 0.01 agreement threshold.';
  $('#ros-outcome').textContent = terminal
    ? `${recording.outcome.status === 'timeout' ? 'Recorded outcome: timeout. ' : 'Recorded round budget completed. '}${recording.outcome.reason} ${agreement}${comparison.matches ? '' : ' Warning: this trace does not match the reference averaging rule.'}`
    : `${agreement} ${comparison.firstAgreementRound === null ? 'No committed state in this recording reaches agreement.' : `First recorded agreement: round ${comparison.firstAgreementRound}.`} This is a replay, not a live process monitor.${comparison.matches ? '' : ' Warning: this trace does not match the reference averaging rule.'}`;
  $('#ros-barrier-title').textContent = event.phase === 'timeout' ? 'Barrier incomplete / no global commit' : event.phase === 'commit' ? 'Barrier complete / state committed' : 'Round supervisor / synchronization only';
  $('.ros-barrier').dataset.timeout = event.phase === 'timeout';
  $('#ros-barrier').textContent = exchange && ['receive', 'commit', 'timeout'].includes(event.phase)
    ? `${exchange.updates.length}/6 local candidate reports. ${exchange.missing.length} missing directed neighbor inputs. ${exchange.status === 'timeout' ? 'A node with a complete inbox may report a candidate, but the global round cannot complete.' : 'Each candidate was computed by its own agent process.'}`
    : 'The supervisor releases a round, gathers the local reports, and records a global boundary only when every agent has completed its expected inputs.';
  const qos = trace.runtime.qos;
  const qosText = qos && ['reliability', 'durability', 'history'].every(field => typeof qos[field] === 'string') && Number.isSafeInteger(qos.depth)
    ? `${qos.reliability} / ${qos.durability} / ${qos.history} / depth ${qos.depth}` : 'Not supplied by this trace';
  const collector = recording.collector;
  const collectorDetails = collector && typeof collector.node === 'string' && Number.isSafeInteger(collector.pid)
    ? [['Collector node / PID', `${collector.node} / ${collector.pid}`]] : [];
  detail($('#ros-provenance'), [['Source', source], ['Run ID', recording.runId], ['Recorded at', trace.runtime.recordedAt], ['ROS distribution', trace.runtime.rosDistro], ['RMW implementation', trace.runtime.rmw], ['QoS / declared metadata', qosText], ['Wire type', typeof trace.runtime.wireType === 'string' ? trace.runtime.wireType : 'Not supplied by this trace'], ['Control topic', `/argos_${recording.runId}/control`], ['Instrumentation topic', `/argos_${recording.runId}/reports`], ...collectorDetails, ['Python', trace.runtime.python], ['Runtime image', trace.runtime.image], ['Runner SHA-256', trace.runtime.sourceSha256], ['Agent node / PID', recording.agents.map(item => `${item.node} / ${item.pid}`).join(' · ')]]);
  renderInspector(event, frame, exchange); renderHistory(frame.round);
  view.update({ ...frame, phase: event.phase, exchange, selected, caseId: recording.id, runId: recording.runId, duration: 900 / Number($('#ros-speed').value) });
  $('#ros-experiment').dataset.ready = 'true';
}
$('#ros-play').addEventListener('click', () => {
  if (playing) stop(); else if (cursor < events.length - 1) { playing = true; schedule(); }
  render();
});
$('#ros-step').addEventListener('click', () => { stop(); advance(); });
$('#ros-next-round').addEventListener('click', () => {
  stop();
  do { cursor++; } while (cursor < events.length - 1 && !['commit', 'timeout'].includes(events[cursor].phase));
  render();
});
$('#ros-reset').addEventListener('click', () => { stop(); cursor = 0; render(); });
$('#ros-finish').addEventListener('click', () => { stop(); cursor = events.length - 1; render(); });
$('#ros-speed').addEventListener('change', () => { clearTimeout(timer); schedule(); });
$('#ros-case').addEventListener('change', event => setCase(event.target.value));
$('#ros-agent').addEventListener('change', event => { selected = Number(event.target.value); render(); });
$('#ros-round-slider').addEventListener('input', event => {
  stop(); const round = Number(event.target.value);
  cursor = round === 0 ? 0 : events.findIndex(item => item.phase === 'commit' && item.round === round);
  render();
});
for (const mode of ['2d', '3d']) $(`#ros-${mode}`).addEventListener('click', () => view.setMode(mode));
for (const button of document.querySelectorAll('[data-ros-case-kind]')) button.addEventListener('click', () => {
  const kind = button.dataset.rosCaseKind;
  const target = trace.cases.find(item => kind === 'missing' ? Boolean(item.omittedPublication) : item.topology === kind && !item.omittedPublication);
  if (target) { setCase(target.id); $('#ros-experiment').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
});
let importRequest = 0;
$('#ros-import').addEventListener('change', async event => {
  const request = ++importRequest, file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('The selected file exceeds 10 MB.');
    const candidate = validateTrace(JSON.parse(await file.text()));
    if (request !== importRequest) return;
    setTrace(candidate, `Imported file: ${file.name}`);
    $('#ros-import-status').textContent = 'Trace validated and loaded. Provenance is declared by the file, not independently authenticated.';
    $('#ros-import-status').dataset.error = 'false';
  } catch (error) {
    if (request !== importRequest) return;
    $('#ros-import-status').textContent = `Import rejected. Current recording preserved. ${error.message}`;
    $('#ros-import-status').dataset.error = 'true';
  } finally { if (request === importRequest) event.target.value = ''; }
});
$('#ros-bundled').addEventListener('click', () => {
  importRequest++; setTrace(validateTrace(bundled), 'Bundled recording');
  $('#ros-import-status').textContent = 'Bundled, validated recording restored.'; $('#ros-import-status').dataset.error = 'false';
});
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
setTrace(trace, source);
view.setMode('3d');
