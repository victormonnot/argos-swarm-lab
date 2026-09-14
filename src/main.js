import './style.css';
import { ALPHA, BUDGET, DEFAULT_VALUES, PRESETS, THRESHOLD, VALUE_LIMIT, createRun, stepRun, setLink, startReplay, resetRun, mean, disagreement, connectedComponents } from './model.js';
import { compareScenarios } from './comparisons.js';
import { createGraphView } from './graph-view.js';

const $ = (selector) => document.querySelector(selector);
const names = { complete: 'Complete graph', chain: 'Chain', groups: 'Two groups' };
let run = createRun();
let playing = false;
let timer = null;
let selectedAgent = 0;

const format = (value, digits = 4) => {
  if (value !== 0 && (Math.abs(value) < 10 ** -digits || Math.abs(value) >= 10000)) return value.toExponential(3);
  return value.toFixed(digits);
};

// Build controls once: rendering a step must not steal keyboard focus.
DEFAULT_VALUES.forEach((value, index) => {
  const label = document.createElement('label');
  label.textContent = `A${index + 1}`;
  const input = document.createElement('input');
  Object.assign(input, { id: `initial-${index}`, type: 'number', value: String(value), min: String(-VALUE_LIMIT), max: String(VALUE_LIMIT), step: 'any', required: true });
  input.setAttribute('aria-label', `Starting value for agent A${index + 1}`);
  label.append(input);
  $('#value-inputs').append(label);
});
const linkButtons = PRESETS.complete.map(([a, b]) => {
  const button = document.createElement('button');
  button.id = `link-${a}-${b}`;
  button.textContent = `${a + 1}–${b + 1}`;
  button.addEventListener('click', () => {
    if (playing || run.mode === 'replay') return;
    run = setLink(run, a, b, !hasLink(a, b));
    render();
  });
  $('#link-controls').append(button);
  return { a, b, button };
});
const tableRows = DEFAULT_VALUES.map((_, index) => {
  const row = document.createElement('tr');
  row.innerHTML = `<td><button aria-label="Inspect agent A${index + 1}">A${index + 1}</button></td><td data-agent-value="${index}"></td><td></td><td></td>`;
  row.querySelector('button').addEventListener('click', () => selectAgent(index));
  $('#state-table tbody').append(row);
  return row;
});
const graph = createGraphView($('#graph-viewport'), { onSelectAgent: selectAgent });
function selectAgent(index) { selectedAgent = index; render(); }
function hasLink(a, b) { return run.edges.some(([x, y]) => x === a && y === b); }
function canAdvance() { return run.step < BUDGET && !run.replay?.finished; }
function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || !canAdvance()) { stop(); render(); return; }
  // Playback schedules whole synchronous transitions. It never changes the gain
  // or uses elapsed wall time as a numerical integration step.
  timer = setTimeout(() => {
    if (!playing) return;
    run = stepRun(run);
    if (!canAdvance()) stop();
    render();
    if (playing) schedule();
  }, 1000 / Number($('#speed').value));
}
function syncInputs() {
  run.initial.values.forEach((value, index) => { $(`#initial-${index}`).value = value; });
  $('#preset').value = run.initial.preset;
  $('#input-error').textContent = '';
}
function configure(options) {
  if (run.mode === 'replay') return;
  const next = createRun(options);
  stop();
  run = next;
  syncInputs();
  render();
}
function advanceTo(target) {
  stop();
  while (run.step < target && canAdvance()) run = stepRun(run);
  render();
}

$('#play').addEventListener('click', () => {
  if (playing) stop();
  else if (canAdvance()) { playing = true; schedule(); }
  render();
});
$('#step-button').addEventListener('click', () => { stop(); run = stepRun(run); render(); });
$('#reset').addEventListener('click', () => { stop(); run = resetRun(run); syncInputs(); render(); });
$('#speed').addEventListener('change', () => { if (playing) schedule(); });
$('#preset').addEventListener('change', () => configure({ values: run.initial.values, preset: $('#preset').value }));
$('#initial-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const values = DEFAULT_VALUES.map((_, index) => $(`#initial-${index}`).valueAsNumber);
    configure({ values, preset: $('#preset').value });
  } catch (error) { $('#input-error').textContent = error.message; }
});
$('#replay').addEventListener('click', () => {
  stop();
  run = startReplay(run);
  syncInputs();
  playing = canAdvance();
  render();
  if (playing) schedule();
});
$('#advance-100').addEventListener('click', () => advanceTo(100));
$('#run-budget').addEventListener('click', () => advanceTo(BUDGET));
['2d', '3d'].forEach((mode) => $(`#view-${mode}`).addEventListener('click', () => {
  graph.setMode(mode);
  ['2d', '3d'].forEach((view) => $(`#view-${view}`).setAttribute('aria-pressed', String(view === mode)));
  $('#view-hint').textContent = mode === '3d' ? 'Drag to orbit · scroll to zoom' : 'Select an agent to inspect its neighbors';
}));

document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => {
  if (run.mode === 'replay') return;
  const scenario = button.dataset.scenario;
  configure({ values: DEFAULT_VALUES, preset: scenario === 'recovery' ? 'chain' : scenario });
  if (scenario === 'recovery') { run = setLink(run, 2, 3, false); render(); }
  $('#exercise-notice').textContent = scenario === 'recovery'
    ? 'Recovery loaded: A3–A4 removed at step 0. Advance to step 100, restore link 3–4, then continue. Reset restores the original connected chain.'
    : `${names[scenario]} loaded with the six default values. Predict, then press Play.`;
  $('#experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#shift-values').addEventListener('click', () => {
  try {
    configure({ values: run.initial.values.map((value) => value + 100), preset: 'complete' });
    $('#exercise-notice').textContent = 'Added 100 to all configured starting values and loaded a complete graph. Compare the disagreement curve with the unshifted complete graph.';
    $('#experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('#input-error').textContent = error.message; }
});
const predictions = {
  mean: 'A good hypothesis for a connected network. Run it, then try separating the agents into two groups.',
  leader: 'What would make the largest value special? Step once and watch both the highest and lowest values move.',
  local: 'Connectivity is the key condition to investigate. Compare the complete graph with two disconnected groups.',
};
document.querySelectorAll('[data-prediction]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-prediction]').forEach((choice) => choice.setAttribute('aria-pressed', String(choice === button)));
  $('#prediction-feedback').textContent = predictions[button.dataset.prediction];
}));

function renderChart() {
  const width = 640, height = 192, left = 44, right = 14, top = 18, bottom = 28;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const initialRange = run.history[0].disagreement;
  const ceiling = Math.max(THRESHOLD * 2, initialRange);
  const x = (step) => left + (step / Math.max(10, run.step)) * plotWidth;
  const y = (range) => top + (1 - Math.min(1, range / ceiling)) * plotHeight;
  const points = run.history.map((point) => `${x(point.step).toFixed(2)},${y(point.disagreement).toFixed(2)}`).join(' ');
  const guides = [0, 0.5, 1].map((fraction) => {
    const value = fraction * ceiling;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e5eae1"/><text x="${left - 9}" y="${y(value) + 3}" text-anchor="end">${value >= 10000 ? value.toExponential(0) : Number(value.toPrecision(3))}</text>`;
  }).join('');
  const endStep = Math.max(10, run.step);
  // The full numerical history remains in run.history. This is a linear-range
  // view; agreement is decided on unrounded values, never on graph pixels.
  $('#history-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Disagreement over ${run.step} steps, from ${format(initialRange)} to ${format(disagreement(run.values))}. Linear scale."><g font-family="ui-monospace, monospace" font-size="9" fill="#7b8b7e">${guides}<text x="${left}" y="${height - 8}">0</text><text x="${width - right}" y="${height - 8}" text-anchor="end">${endStep} steps</text><text x="${left}" y="10">scalar-value units</text></g><polygon points="${left},${y(0)} ${points} ${x(run.step)},${y(0)}" fill="#eaf3e6"/><line x1="${left}" y1="${y(THRESHOLD)}" x2="${width - right}" y2="${y(THRESHOLD)}" stroke="#c5a568" stroke-dasharray="4 4"/><polyline points="${points}" fill="none" stroke="#37856c" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${x(run.step)}" cy="${y(disagreement(run.values))}" r="3.5" fill="#37856c"/></svg>`;
}

function render() {
  const components = connectedComponents(run.edges);
  const replaying = run.mode === 'replay';
  const locked = replaying || playing;
  $('#step-count').textContent = run.step;
  $('#disagreement').textContent = format(disagreement(run.values));
  $('#disagreement').title = String(disagreement(run.values));
  $('#current-mean').textContent = format(mean(run.values));
  $('#initial-mean').textContent = format(mean(run.initial.values));
  $('#component-count').textContent = components.length;
  $('#component-label').textContent = components.length === 1 ? 'all agents connected' : components.map((group) => group.map((i) => `A${i + 1}`).join(', ')).join(' / ');
  $('#edge-count').textContent = `${run.edges.length} links`;
  $('#topology-label').textContent = run.events.length ? `${names[run.initial.preset]} · edited` : names[run.initial.preset];
  $('#run-status').textContent = replaying
    ? run.replay.finished ? 'Replay complete · Reset to edit' : `Replay · ${playing ? 'playing' : 'paused'} · target ${run.replay.targetStep}`
    : run.step >= BUDGET ? 'Budget complete · 1,000 steps' : playing ? 'Running · neighbor exchanges' : 'Paused · ready to explore';
  $('#play').innerHTML = playing ? '<span aria-hidden="true">Ⅱ</span> Pause' : '<span aria-hidden="true">▶</span> Play';
  $('#play').disabled = !canAdvance();
  $('#step-button').disabled = playing || !canAdvance();
  $('#reset').textContent = replaying ? 'Exit replay & reset' : 'Reset';
  $('#preset').disabled = replaying;
  $('#apply-values').disabled = replaying;
  $('#shift-values').disabled = replaying;
  DEFAULT_VALUES.forEach((_, index) => { $(`#initial-${index}`).disabled = replaying; });
  document.querySelectorAll('[data-scenario]').forEach((button) => { button.disabled = replaying; });
  $('#replay').disabled = playing || replaying || (run.step === 0 && run.events.length === 0);
  $('#advance-100').disabled = playing || run.step >= 100 || !canAdvance();
  $('#run-budget').disabled = playing || !canAdvance();
  linkButtons.forEach(({ a, b, button }) => {
    const active = hasLink(a, b);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${active ? 'Remove' : 'Restore'} link A${a + 1}–A${b + 1}`);
    button.disabled = locked;
  });
  tableRows.forEach((row, index) => {
    const neighbors = run.edges.filter((edge) => edge.includes(index)).map(([a, b]) => a === index ? b : a).sort((a, b) => a - b);
    row.classList.toggle('selected', index === selectedAgent);
    row.querySelector('button').setAttribute('aria-pressed', String(index === selectedAgent));
    row.children[1].textContent = format(run.values[index], 6);
    row.children[1].dataset.rawValue = String(run.values[index]);
    row.children[1].title = String(run.values[index]);
    row.children[2].textContent = neighbors.length ? neighbors.map((i) => `A${i + 1}`).join(', ') : 'None';
    row.children[3].textContent = components.findIndex((group) => group.includes(index)) + 1;
  });
  const neighbors = run.edges.filter((edge) => edge.includes(selectedAgent)).map(([a, b]) => a === selectedAgent ? b : a);
  const correction = ALPHA * neighbors.reduce((sum, index) => sum + run.values[index] - run.values[selectedAgent], 0);
  $('#agent-detail').textContent = neighbors.length
    ? `A${selectedAgent + 1} reads ${neighbors.map((i) => `A${i + 1} = ${format(run.values[i], 2)}`).join(', ')}. With these links, its next value is ${format(run.values[selectedAgent] + correction, 6)}.`
    : `A${selectedAgent + 1} is isolated. It receives no neighbor values and keeps ${format(run.values[selectedAgent], 6)}.`;
  $('#event-count').textContent = `${run.events.length} events`;
  $('#event-log').replaceChildren(...(run.events.length ? run.events.map((event) => {
    const item = document.createElement('li');
    item.textContent = `k=${event.step}: ${event.enabled ? 'restore' : 'remove'} A${event.a + 1}–A${event.b + 1}`;
    return item;
  }) : [Object.assign(document.createElement('li'), { textContent: 'No link edits in this run.' })]));
  $('#agreement-status').textContent = run.firstAgreementStep !== null
    ? `Agreement first reached at step ${run.firstAgreementStep}. Unrounded range ≤ ${THRESHOLD}.`
    : run.step >= BUDGET ? 'Agreement not reached within 1,000 steps. The global range remains above 0.01.'
    : 'Agreement threshold: 0.01. Not reached yet.';
  $('#exchanges-per-step').textContent = 2 * run.edges.length;
  $('#total-exchanges').textContent = run.exchanges.toLocaleString('en-US');
  graph.update({ values: run.values, edges: run.edges, initialValues: run.initial.values, selectedAgent });
  renderChart();
}

let comparisonsRendered = false;
$('.comparison-details').addEventListener('toggle', (event) => {
  if (!event.target.open || comparisonsRendered) return;
  compareScenarios().forEach((result) => {
    const row = document.createElement('tr');
    const cells = [result.label, result.firstAgreementStep === null ? 'Not reached in 1,000 steps' : `Step ${result.firstAgreementStep}`, result.exchangesToAgreement === null ? '—' : result.exchangesToAgreement.toLocaleString('en-US'), format(result.finalDisagreement, 6)];
    cells.forEach((text) => row.append(Object.assign(document.createElement('td'), { textContent: text })));
    $('#comparison-table tbody').append(row);
  });
  comparisonsRendered = true;
});

render();
if (import.meta.hot) import.meta.hot.dispose(() => { stop(); graph.dispose(); });
