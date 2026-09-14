import './style.css';
import './mission.css';
import './fusion.css';
import { FUSION_ROUNDS, RESTORE_ROUND, METHODS, SCHEDULES, createFusionRun, stepFusion, resetFusion, finishFusion, summarizeFusion, compareFusion, compareFusionSeeds } from './fusion-model.js';
import { createFusionView } from './fusion-view.js';

const $ = (selector) => document.querySelector(selector);
const descriptions = {
  local: 'Keep only the initial local reading. No packets are sent, whatever the selected link schedule.',
  naive: 'Add inverse variances as if the two errors were independent. Reused original readings violate that assumption.',
  ledger: 'Send raw records with stable original IDs. Merge each ID once, then fuse the independent original readings.',
  ci: 'Combine summary information with fixed CI weight ½. Cross-correlation may be unknown; input covariances must still be consistent.',
};
const point = (values) => `(${values.map((value) => value.toFixed(4)).join(', ')}) m`;
const area = (value) => `${value.toFixed(6)} m²`;
const decimal = (value) => value.toFixed(4);
const agentName = (id) => `A${id + 1}`;
const records = (ledger) => ledger ? ledger.map((record) => record.id).join(', ') : 'No original IDs in summary';
let run = createFusionRun(), playing = false, timer = null;
const view = createFusionView($('#fusion-viewport'));

function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'running') return;
  timer = setTimeout(() => { run = stepFusion(run); if (run.status !== 'running') stop(); render(); schedule(); }, 1000 / Number($('#fusion-speed').value));
}
function syncInputs() {
  $('#fusion-algorithm').value = run.initial.method; $('#fusion-schedule').value = run.initial.schedule;
  $('#fusion-seed').value = run.initial.seed; $('#fusion-seed-error').textContent = '';
}
function configure(changes = {}) { stop(); run = createFusionRun({ ...run.initial, ...changes }); syncInputs(); render(); }
function advanceTo(round) { stop(); while (run.round < round && run.status === 'running') run = stepFusion(run); render(); }
$('#fusion-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#fusion-step').addEventListener('click', () => { stop(); run = stepFusion(run); render(); });
$('#fusion-reset').addEventListener('click', () => { stop(); run = resetFusion(run); syncInputs(); render(); });
$('#fusion-finish').addEventListener('click', () => { stop(); run = finishFusion(run); render(); });
$('#fusion-round-two').addEventListener('click', () => advanceTo(2));
$('#fusion-restore').addEventListener('click', () => advanceTo(RESTORE_ROUND));
$('#fusion-speed').addEventListener('change', schedule);
$('#fusion-algorithm').addEventListener('change', (event) => configure({ method: event.target.value }));
$('#fusion-schedule').addEventListener('change', (event) => configure({ schedule: event.target.value }));
$('#fusion-observer').addEventListener('change', render);
$('#fusion-seed-form').addEventListener('submit', (event) => {
  event.preventDefault(); const seed = Number($('#fusion-seed').value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 1000000) { $('#fusion-seed-error').textContent = 'Enter an integer seed from 1 to 1000000.'; return; }
  configure({ seed });
});
for (const mode of ['2d', '3d']) $(`#fusion-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const option of ['2d', '3d']) $(`#fusion-${option}`).setAttribute('aria-pressed', String(mode === option));
  $('#fusion-view-hint').textContent = mode === '3d'
    ? 'Drag to orbit; scroll to zoom. Same planar estimates and history. Marker heights are decorative; there is no robot motion. Contours show 2σ axes from reported covariance.'
    : 'Markers are estimates of T, not moving robots. Trails show estimate revisions. Contours have 2σ axes from reported covariance, not a 95% joint coverage guarantee.';
});
document.querySelectorAll('[data-fusion-case]').forEach((button) => button.addEventListener('click', () => {
  const [method, schedule] = button.dataset.fusionCase.split(':'); configure({ method, schedule, seed: 1 });
  $('#fusion-experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#fusion-comparisons').addEventListener('toggle', () => {
  if (!$('#fusion-comparisons').open || $('#fusion-reference-table').children.length) return;
  const label = (row) => `${METHODS[row.method]}<br>${SCHEDULES[row.schedule]}`;
  $('#fusion-reference-table').innerHTML = compareFusion().map((row) => `<tr><th scope="row">${label(row)}</th><td>${area(row.meanSquaredError)}</td><td>${area(row.meanReportedTrace)}</td><td>${area(row.meanExpectedTrace)}</td><td>${decimal(row.maxRatio)}</td><td>${row.counters.records}</td></tr>`).join('');
  $('#fusion-seed-table').innerHTML = compareFusionSeeds().groups.map((row) => `<tr><th scope="row">${label(row)}</th><td>${area(row.meanSquaredError)}</td><td>${area(row.meanReportedTrace)}</td><td>${area(row.meanExpectedTrace)}</td><td>${decimal(row.meanNEES)}</td><td>${decimal(row.maxRatio)}</td></tr>`).join('');
});

function renderNetwork() {
  const local = run.initial.method === 'local';
  const cut = run.initial.schedule === 'cut' || (run.initial.schedule === 'recovery' && run.round < RESTORE_ROUND);
  const color = (broken) => local ? '#a4aaa5' : broken ? '#b4774f' : '#448571';
  const nodes = [[45, 96], [145, 27], [245, 96]];
  const arrows = [
    '<path d="M62 82L125 39"/>', '<path d="M165 40L226 82"/>', '<path d="M225 108H65"/>',
  ];
  $('#fusion-network').innerHTML = `<svg viewBox="0 0 290 145" role="img" aria-label="Directed communication: A1 to A2, A2 to A3, A3 to A1. ${local ? 'No messages sent.' : cut ? 'A3 to A1 is cut.' : 'All links available.'}"><defs>${[false, true].map((broken) => `<marker id="fusion-arrow-${broken}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${color(broken)}"/></marker>`).join('')}</defs>${arrows.map((path, index) => `<g data-fusion-link="${index}" data-available="${!local && !(index === 2 && cut)}" fill="none" stroke="${color(index === 2 && cut)}" stroke-width="2" stroke-dasharray="${local || (index === 2 && cut) ? '5 4' : 'none'}" marker-end="url(#fusion-arrow-${index === 2 && cut})">${path}</g>`).join('')}${nodes.map(([x, y], id) => `<circle cx="${x}" cy="${y}" r="19" fill="#f1f6ef" stroke="#849b8e"/><text x="${x}" y="${y + 5}" text-anchor="middle" fill="#264d41" font-size="14">${agentName(id)}</text>`).join('')}<text x="145" y="135" text-anchor="middle" fill="${color(cut)}" font-size="12">${local ? 'No sharing' : cut ? 'A3 → A1: dropped' : 'A3 → A1: available'}</text></svg>`;
  $('#fusion-link-state').textContent = local ? 'The no-sharing baseline sends no packets.' : run.initial.schedule === 'recovery'
    ? run.round < RESTORE_ROUND ? 'A3 → A1 drops rounds 1–4; the round-5 packet will be delivered.' : 'A3 → A1 is restored. Earlier dropped packets are not replayed.'
    : cut ? 'A3 → A1 is cut throughout. The other two directions deliver normally.' : 'Every link delivers one prior-state packet per round.';
}

function renderUpdate(summary, observer) {
  const agent = run.agents[observer], evaluated = summary.agents[observer];
  const update = run.lastRound?.updates.find((entry) => entry.agent === observer);
  const incoming = update?.incoming, prior = update?.prior ?? agent, ledger = run.initial.method === 'ledger';
  const sender = (observer + 2) % 3;
  $('#fusion-update-kind').textContent = !update ? `${agentName(observer)} starts with its own original reading z${observer + 1}. No message round has run.`
    : run.initial.method === 'local' ? `${agentName(observer)} retains its local reading. No packet was sent or fused.`
      : incoming ? `Round ${run.round}: ${agentName(observer)} receives ${agentName(sender)}'s round-${run.round - 1} state, then updates.`
        : `Round ${run.round}: no packet delivered from ${agentName(sender)}. ${agentName(observer)} keeps its prior unchanged.`;
  const rows = [
    ['Prior mean', point(prior.mean)], ['Prior variance / axis', area(prior.covariance[0])],
    ['Incoming mean', incoming ? point(incoming.mean) : '—'], ['Incoming variance / axis', incoming ? area(incoming.covariance[0]) : '—'],
    ['Posterior mean', point(agent.mean)], ['Posterior variance / axis', area(agent.covariance[0])],
    ['Prior mean weight', incoming && !ledger ? decimal(update.weight) : '—'],
  ];
  $('#fusion-update').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  $('#fusion-payload-note').textContent = ledger
    ? `Ledger packet: ${incoming ? `${incoming.ledger.length} raw record(s): ${records(incoming.ledger)}.` : 'none delivered at this boundary.'} Original IDs permit deduplication; original measurement errors are assumed independent.`
    : run.initial.method === 'local' ? 'Only the original local reading is used. There is no shared payload.'
      : 'Summary packet: one mean/covariance record, with no original IDs or evaluator coefficients. The receiver cannot count unique originals from this payload.';
  $('#fusion-ledger-caption').textContent = ledger ? `${agentName(observer)}'s available raw measurement ledger after this round.`
    : `${agentName(observer)} has no raw shared-measurement ledger in this method.`;
  $('#fusion-ledger').innerHTML = ledger ? agent.ledger.map((record) => `<tr><th scope="row">${record.id}</th><td>${point(record.mean)}</td><td>${area(record.covariance[0])}</td></tr>`).join('')
    : '<tr><td colspan="3">No shared original-ID records.</td></tr>';
  $('#fusion-ledger-change').textContent = ledger && update ? `New IDs this round: ${update.newIds.join(', ') || 'none'}. Repeated IDs ignored: ${update.repeatedIds.join(', ') || 'none'}.` : '';
  $('#fusion-lineage-note').textContent = `${agentName(observer)}'s estimate contains ${evaluated.uniqueCount} of 3 original readings. These analytical coefficients trace the original evidence; they are not extra information supplied to the agent.`;
  $('#fusion-lineage').innerHTML = evaluated.coefficients.map((coefficient, id) => `<div>z${id + 1}<strong data-fusion-coefficient="${id}" data-raw-value="${coefficient}">${coefficient.toFixed(4)}</strong><span>original weight</span></div>`).join('');
  const evidence = [
    ['Actual error for this seed', `${evaluated.error.toFixed(4)} m`],
    ['Expected variance / axis', area(evaluated.expectedVariance)],
    ['Expected / reported trace', `${decimal(evaluated.ratio)}×`],
    ['NEES for this seed', decimal(evaluated.nees)],
  ];
  $('#fusion-evaluation').innerHTML = evidence.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
}

function renderChart(observer) {
  const max = 1.28, X = (round) => 48 + round / FUSION_ROUNDS * 346, Y = (value) => 164 - value / max * 134;
  const path = (field) => run.history.map((sample, index) => `${index ? 'L' : 'M'}${X(sample.round).toFixed(2)},${Y(sample[field][observer]).toFixed(2)}`).join(' ');
  $('#fusion-chart').innerHTML = `<svg viewBox="0 0 425 205" role="img" aria-label="${agentName(observer)} expected and reported covariance traces by round"><text x="48" y="17" font-size="12" fill="#58675c">${agentName(observer)} · covariance trace (m²)</text>${[0, .64, 1.28].map((value) => `<path d="M48 ${Y(value)}H394" stroke="#e2e5db"/><text x="38" y="${Y(value) + 4}" text-anchor="end" font-size="12" fill="#58675c">${value.toFixed(2)}</text>`).join('')}<path d="${path('expectedTrace')}" stroke="#217761" stroke-width="3" fill="none"/><path d="${path('reportedTrace')}" stroke="#9578ad" stroke-width="2" stroke-dasharray="6 4" fill="none"/>${[0, 3, 6, 9, 12].map((round) => `<text x="${X(round)}" y="183" text-anchor="middle" font-size="12" fill="#58675c">${round}</text>`).join('')}<text x="394" y="201" text-anchor="end" font-size="12" fill="#58675c">Communication round</text></svg>`;
}

function render() {
  const summary = summarizeFusion(run), observer = Number($('#fusion-observer').value), done = run.status !== 'running';
  $('#fusion-description').textContent = descriptions[run.initial.method];
  $('#fusion-round').textContent = run.round;
  $('#fusion-status').textContent = done ? '12-round window complete' : playing ? 'Running' : 'Paused';
  $('#fusion-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['fusion-play', 'fusion-step', 'fusion-finish']) $(`#${id}`).disabled = done;
  $('#fusion-round-two').disabled = done || run.round >= 2; $('#fusion-restore').disabled = done || run.round >= RESTORE_ROUND;
  $('#fusion-reported').textContent = area(summary.meanReportedTrace);
  $('#fusion-expected').textContent = area(summary.meanExpectedTrace);
  $('#fusion-ratio').textContent = `${summary.maxRatio.toFixed(2)}×`;
  const overconfident = summary.maxRatio > 1 + 1e-10;
  $('#fusion-outcome').dataset.concern = String(overconfident);
  $('#fusion-outcome').textContent = run.initial.method === 'naive' && overconfident
    ? `Reported covariance understates expected error variance by up to ${summary.maxRatio.toFixed(2)}×. Repeated messages contain reused evidence. No sensor has taken a new reading.`
    : run.initial.method === 'ledger' ? `Unique-measurement fusion uses ${summary.uniqueCounts.join(' / ')} originals at A1 / A2 / A3. Each raw ID contributes once; under the independent-sensor model, reported covariance matches expected error variance.`
      : run.initial.method === 'ci' ? `Fixed-weight Covariance Intersection keeps a conservative covariance here, with reported variance 0.64 m² per axis. ${run.initial.schedule === 'ring' ? 'Its mean can improve through sharing without collecting another sensor reading.' : 'The cut can emphasize A1’s initial error and worsen mean accuracy. A consistent covariance does not guarantee a better estimate.'}`
        : run.initial.method === 'local' ? 'No sharing: every agent retains its own initial noisy reading. The twelve-round window introduces no new information.'
          : 'The current inputs have no repeated evidence at the receiver yet. Advance to round 2 to inspect the first overlap.';
  $('#fusion-states').innerHTML = summary.agents.map((agent) => {
    const values = [agent.mean[0], agent.mean[1], agent.reportedTrace, agent.error, agent.expectedTrace, agent.uniqueCount, agent.ratio];
    return `<tr data-agent="${agent.id}" class="${agent.id === observer ? 'selected' : ''}"><th scope="row">${agentName(agent.id)}</th>${values.map((value, index) => `<td data-raw-value="${value}">${index === 5 ? value : value.toFixed(index === 2 || index === 4 ? 6 : 4)}</td>`).join('')}</tr>`;
  }).join('');
  const { attempted, delivered, dropped, records } = run.counters;
  $('#fusion-traffic').textContent = `${attempted} packets attempted · ${delivered} delivered · ${dropped} dropped · ${records} delivered records`;
  $('#fusion-spread').textContent = `Largest distance between agents' estimates: ${summary.spread.toFixed(4)} m. Mean squared error against target truth: ${area(summary.meanSquaredError)}. Agreement does not establish accuracy or correct uncertainty.`;
  renderNetwork(); renderUpdate(summary, observer); renderChart(observer); view.update(run, observer);
}

window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
syncInputs(); render();
