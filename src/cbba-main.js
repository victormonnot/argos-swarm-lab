import './style.css';
import './mission.css';
import './cbba.css';
import { CBBA_ROUNDS, RESTORE_ROUND, CAPACITY, METHODS, SCHEDULES, PRESETS, createRun, stepRun, runToEnd, referenceComparisons } from './cbba-model.js';
import { createCbbaView, displayedLinks } from './cbba-view.js';

const $ = (selector) => document.querySelector(selector);
const taskName = (id) => `T${id + 1}`;
const agentName = (id) => id < 0 ? 'Unclaimed' : `A${id + 1}`;
const order = (tasks) => tasks.length ? tasks.map(taskName).join(' → ') : 'Empty';
const descriptions = {
  cbba: 'Construct a greedy bundle, exchange winner/bid/freshness tables, resolve claims and release the first lost entry plus its suffix before rebuilding.',
  local: 'Use the identical local greedy bundle rule with no messages. Every agent retains its initial claims, including tasks claimed by others.',
};
const schedules = {
  chain: 'Both directions of A1 ↔ A2 and A2 ↔ A3 deliver one snapshot per round. A1 and A3 learn about each other through A2.',
  cut: 'A1 ↔ A2 still exchanges. Both directions of A2 ↔ A3 are dropped throughout the run; A3 remains isolated.',
  recovery: `A2 ↔ A3 is cut during rounds 1–${RESTORE_ROUND - 1}. Its two directions deliver again before round ${RESTORE_ROUND}. No agent receives a global restoration flag.`,
};
let run = createRun(), selected = 0, playing = false, timer;
const view = createCbbaView($('#cbba-viewport'), { selectAgent: select });
function stop() { playing = false; clearTimeout(timer); }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'running') return;
  timer = setTimeout(() => { stepRun(run); if (run.status !== 'running') stop(); render(); schedule(); }, Math.round(1000 / Number($('#cbba-speed').value)));
}
function select(index) { selected = index; $('#cbba-observer').value = String(index); render(); }
function start(config) {
  stop(); run = createRun(config);
  $('#cbba-algorithm').value = run.config.method; $('#cbba-schedule').value = run.config.schedule;
  $('#cbba-observer').replaceChildren(...run.agents.map((agent) => Object.assign(document.createElement('option'), { value: String(agent.id), textContent: `Agent ${agent.label}` })));
  $('#cbba-observer').value = String(selected); render();
}
function details(entries) { return entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join(''); }
function renderInspection() {
  const agent = run.agents[selected], update = run.lastRound?.updates.find((entry) => entry.agent === selected);
  $('#cbba-decision-note').textContent = run.round === 0
    ? `${agent.label}: initial bundle built from its own utilities. No packets have been exchanged yet.`
    : `${agent.label}: boundary after round ${run.round}: receive snapshots → resolve winner beliefs → release a suffix → rebuild. ${agent.lastReceived.length} packet${agent.lastReceived.length === 1 ? '' : 's'} received this round.`;
  $('#cbba-agent-details').innerHTML = details([
    ['Acquisition bundle bᵢ', order(agent.bundle)],
    ['Planning path pᵢ', order(agent.path)],
    ['Bundle before this round', update ? order(update.beforeBundle) : 'Initial construction'],
    ['After release, before rebuilding', update ? order(update.afterRelease.bundle) : 'No exchange yet'],
    ['Added at this boundary', order(agent.lastAdded)],
  ]);
  $('#cbba-beliefs').innerHTML = run.tasks.map((task) => `<tr data-belief-task="${task.id}"><td>${task.label}</td><td>${agent.utilities[task.id]}</td><td data-winner="${agent.winners[task.id]}">${agentName(agent.winners[task.id])}</td><td data-bid="${agent.bids[task.id]}">${agent.bids[task.id]}</td></tr>`).join('');
  $('#cbba-timestamps').textContent = `Freshness sᵢ: ${agent.timestamps.map((round, index) => `${agentName(index)} = ${index === selected ? 'self slot (unused)' : round === 0 ? '0 / no contact known' : `round ${round}`}`).join(' · ')}`;
  const packets = run.lastRound?.packets.filter((packet) => packet.to === selected && packet.delivered) ?? [];
  $('#cbba-packets').innerHTML = packets.length ? packets.map((packet) => {
    const { payload } = packet;
    const actions = update.decisions.filter((decision) => decision.from === packet.from && decision.action !== 'leave');
    return `<article data-cbba-packet="${packet.from}"><strong>${agentName(packet.from)} → ${agent.label} · received round ${run.round}</strong><p>Captured at boundary ${run.round - 1}. ${payload.winners.map((winner, task) => `${taskName(task)}: ${agentName(winner)} / bid ${payload.bids[task]}`).join(' · ')}</p><p>Sent freshness: ${payload.timestamps.map((round, peer) => `${agentName(peer)} = ${round}`).join(' · ')}</p><p>Consensus actions: ${actions.length ? actions.map((decision) => `${taskName(decision.task)} ${decision.action} (Table 1, row ${decision.row})`).join(' · ') : 'all records retained'}.</p></article>`;
  }).join('') : `<p>${run.round === 0 ? 'No received packets yet. Step once to exchange the initial claims.' : run.config.method === 'local' ? 'No sharing: this baseline sends and receives no packets.' : 'No packets arrived at this agent during the latest round. Missing packets do not provide another agent’s current beliefs.'}</p>`;
  $('#cbba-releases').textContent = agent.lastReleased.length
    ? `Round ${run.round}: ${agent.lastReleased.map((entry) => `${taskName(entry.task)} (${entry.reason === 'outbid' ? `lost to ${agentName(entry.winner)}` : 'later suffix entry'})`).join(' → ')}. Bundle after release: ${order(update.afterRelease.bundle)}. After rebuilding: ${order(agent.bundle)}.`
    : run.round === 0 ? 'No suffix has been released yet. Inspect A2 after the first connected round to see T1 lost and its later T4 entry released, then reacquired.' : `No suffix released by ${agent.label} in round ${run.round}. Earlier releases remain in the event history below.`;
  $('#cbba-states').innerHTML = run.agents.map((a, index) => `<tr class="${selected === index ? 'selected' : ''}"><td><button data-inspect-agent="${index}" aria-label="Inspect agent ${a.label} in state table">${a.label}</button></td><td data-raw-bundle="${a.bundle.join(',')}">${order(a.bundle)}</td><td data-raw-path="${a.path.join(',')}">${order(a.path)}</td><td>${a.bundle.reduce((total, task) => total + a.utilities[task], 0)} points</td></tr>`).join('');
  const { metrics } = run;
  $('#cbba-score').textContent = metrics.score === null
    ? `No valid complete-allocation score yet: all ${run.tasks.length} tasks must be claimed exactly once. ${metrics.unassigned} unclaimed; ${metrics.conflicts} conflicting. Exact centralized reference: ${metrics.optimalScore} points for the same utilities and capacity. Adding conflicting agents' totals would double-count task claims.`
    : `Valid complete-allocation score: ${metrics.score} points. Exact centralized reference: ${metrics.optimalScore} points; this allocation achieves ${(metrics.scoreRatio * 100).toFixed(2)}% of that reference. ${metrics.agreement ? 'Every local winner and bid table agrees.' : 'The own-bundle claims are exclusive, but the local winner/bid tables still disagree.'} No task has been executed.`;
  $('#cbba-events').innerHTML = run.events.slice(-15).reverse().map((event) => `<li data-cbba-event="${event.type}"><strong>Round ${event.round}</strong> · ${event.text}</li>`).join('');
}
function render() {
  const { metrics } = run;
  $('#cbba-status').textContent = run.status === 'running' ? playing ? 'Playing' : 'Paused' : 'Round budget reached';
  $('#cbba-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#cbba-${id}`).disabled = run.status !== 'running';
  $('#cbba-boundary').disabled = run.config.method !== 'cbba' || run.config.schedule !== 'recovery' || run.round >= RESTORE_ROUND - 1;
  $('#cbba-schedule').disabled = run.config.method === 'local';
  $('#cbba-description').textContent = descriptions[run.config.method];
  $('#cbba-schedule-description').textContent = run.config.method === 'local' ? 'No exchange is attempted. Link scheduling has no effect on this baseline.' : schedules[run.config.schedule];
  $('#cbba-contract').textContent = `${run.agents.length} agents · ${run.tasks.length} tasks · ${CAPACITY} tasks / bundle · ${CBBA_ROUNDS} rounds`;
  $('#cbba-round').textContent = String(run.round); $('#cbba-budget').textContent = `Fixed budget of ${CBBA_ROUNDS} logical rounds`;
  $('#cbba-conflicts').textContent = String(metrics.conflicts); $('#cbba-unique').textContent = `${metrics.uniqueAssigned} / ${run.tasks.length}`;
  $('#cbba-agreement').textContent = metrics.agreement ? 'Yes' : 'No';
  $('#cbba-outcome').dataset.status = metrics.conflicts ? 'conflict' : 'clear';
  $('#cbba-outcome').textContent = `${run.status === 'budget' ? `Round budget reached at ${run.round}.` : `Round ${run.round}: ${playing ? 'playing' : 'paused'}.`} ${metrics.fullAllocation ? 'All six tasks have exactly one own-bundle claimant.' : `${metrics.conflicts} conflicting tasks and ${metrics.unassigned} unclaimed tasks remain.`} ${metrics.agreement ? `Full winner/bid agreement was first observed at round ${metrics.firstAgreementRound}.` : `${metrics.agreementTasks} of ${run.tasks.length} task records agree across all agents; global agreement has not been reached.`} Allocation claims do not mean completed tasks.`;
  const active = displayedLinks(run).filter((link) => link.active).map((link) => `${agentName(link.from)} ↔ ${agentName(link.to)}`);
  $('#cbba-network').textContent = `${run.round === 0 ? 'Links for round 1' : `Links used in round ${run.round}`} · ${active.length ? active.join(' · ') : 'no sharing'}. Cumulative logical packets: ${run.counters.attempted} attempted / ${run.counters.delivered} delivered / ${run.counters.dropped} dropped. ${run.config.method === 'cbba' && run.config.schedule === 'recovery' && run.round === RESTORE_ROUND - 1 ? `The next step restores A2 ↔ A3 before round ${RESTORE_ROUND}.` : 'Delivery and drop totals are evaluator observations.'}`;
  renderInspection(); view.update(run, selected);
}

for (const [id, label] of Object.entries(METHODS)) $('#cbba-algorithm').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
for (const [id, label] of Object.entries(SCHEDULES)) $('#cbba-schedule').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#cbba-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.method === 'local' ? 'CHANGE THE METHOD' : 'INSPECT THE EXCHANGE'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-cbba-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#cbba-utility-head').innerHTML = `<tr><th>Agent</th>${run.tasks.map((task) => `<th>${task.label}</th>`).join('')}</tr>`;
$('#cbba-utilities').innerHTML = run.agents.map((agent) => `<tr><td>${agent.label}</td>${agent.utilities.map((utility) => `<td>${utility}</td>`).join('')}</tr>`).join('');
$('#cbba-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-cbba-case]'); if (button) start(PRESETS.find((preset) => preset.id === button.dataset.cbbaCase).config); });
$('#cbba-algorithm').addEventListener('change', () => start({ ...run.config, method: $('#cbba-algorithm').value }));
$('#cbba-schedule').addEventListener('change', () => start({ ...run.config, schedule: $('#cbba-schedule').value }));
$('#cbba-observer').addEventListener('change', () => select(Number($('#cbba-observer').value)));
$('#cbba-states').addEventListener('click', (event) => { const button = event.target.closest('[data-inspect-agent]'); if (button) { select(Number(button.dataset.inspectAgent)); $(`[data-inspect-agent="${selected}"]`).focus({ preventScroll: true }); } });
$('#cbba-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#cbba-step').addEventListener('click', () => { stop(); stepRun(run); render(); });
$('#cbba-reset').addEventListener('click', () => start(run.config));
$('#cbba-boundary').addEventListener('click', () => { stop(); while (run.round < RESTORE_ROUND - 1 && run.status === 'running') stepRun(run); render(); });
$('#cbba-finish').addEventListener('click', () => { stop(); runToEnd(run); render(); });
$('#cbba-speed').addEventListener('change', () => { if (playing) schedule(); });
for (const mode of ['2d', '3d']) $(`#cbba-${mode}`).addEventListener('click', () => {
  view.setMode(mode); for (const other of ['2d', '3d']) $(`#cbba-${other}`).setAttribute('aria-pressed', String(other === mode));
});
let comparisonsReady = false;
$('#cbba-comparisons').addEventListener('toggle', () => {
  if (!$('#cbba-comparisons').open || comparisonsReady) return;
  $('#cbba-reference-table').innerHTML = referenceComparisons().map((result) => `<tr data-reference-case="${result.id}"><td>${result.label}</td><td>${result.method === 'cbba' ? 'CBBA' : 'Local greedy'}</td><td>${result.conflicts}</td><td>${result.uniqueAssigned} / 6</td><td>${result.agreement ? `Yes / first round ${result.firstAgreementRound}` : 'No'}</td><td>${result.score === null ? 'Not valid / incomplete' : `${result.score} / ${result.optimalScore} points`}</td></tr>`).join(''); comparisonsReady = true;
});
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config);
