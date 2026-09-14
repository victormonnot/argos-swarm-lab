import './style.css';
import './mission.css';
import './orca.css';
import { DT, MAX_STEPS, RADIUS, SAFETY_PADDING, MAX_SPEED, GOAL_RADIUS, METHODS, SCENARIOS, PRESETS, createRun, stepRun, runToEnd, referenceComparisons } from './orca-model.js';
import { createOrcaView, drawVelocitySpace } from './orca-view.js';

const $ = (selector) => document.querySelector(selector);
const vector = (p) => `(${p.map((v) => v.toFixed(3)).join(', ')})`;
const number = (v, digits = 3) => Number.isFinite(v) ? v.toFixed(digits) : '—';
const descriptions = {
  orca: 'Reciprocal half-planes constrain each velocity. Choose the feasible point nearest the shared goal-preference rule; add 1 cm padding per disk.',
  apf: 'Add goal attraction and short-range peer repulsion, then cap speed. Same starts, goals and physical radii; no ORCA constraints or padding.',
  direct: 'Follow the goal preference without peer avoidance. This supplies the same preferred velocities used by ORCA.',
};
const scenarios = {
  crossing: 'Three offset paths cross. Every agent observes every peer exactly at each step.',
  headOn: 'Two agents meet with perfectly symmetric goals. Predict whether separation alone ensures progress.',
  blind: 'Same three paths as the offset crossing, but every peer observation is removed. Own position and goal remain available.',
};
const outcomeNames = { running: 'Running', arrived: 'All agents arrived', collision: 'Collision detected', timeout: 'Time budget exhausted' };
let run = createRun(), selected = 0, playing = false, timer = null;
const view = createOrcaView($('#orca-viewport'), { selectAgent: select });

function stop() { playing = false; clearTimeout(timer); timer = null; }
function schedule() {
  clearTimeout(timer);
  if (!playing || run.status !== 'running') return;
  timer = setTimeout(() => { stepRun(run); if (run.status !== 'running') stop(); render(); schedule(); }, DT * 1000 / Number($('#orca-speed').value));
}
function select(index) { selected = index; $('#orca-observer').value = String(index); render(); }
function start(config) {
  stop(); run = createRun(config); selected = Math.min(selected, run.agents.length - 1);
  $('#orca-algorithm').value = run.config.method; $('#orca-scenario').value = run.config.scenario; $('#orca-horizon').value = String(run.config.horizon);
  $('#orca-observer').replaceChildren(...run.agents.map((agent, index) => Object.assign(document.createElement('option'), { value: String(index), textContent: `Agent ${agent.id}` })));
  $('#orca-observer').value = String(selected); render();
}
function details(entries) { return entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join(''); }
function renderInspection() {
  const agent = run.agents[selected], chosen = agent.command, constrained = run.config.method === 'orca';
  $('#orca-decision-note').textContent = run.step === 0
    ? `${agent.id}: prepared decision at t = 0.00 s; no movement has been applied yet.`
    : `${agent.id}: last applied decision used t = ${run.decisionTime.toFixed(2)} s. Current positions are at t = ${run.time.toFixed(2)} s.`;
  drawVelocitySpace($('#orca-velocity-space'), agent, run.config.method);
  $('#orca-agent-details').innerHTML = details([
    ['Position used to decide', `${vector(agent.decisionPosition)} m`],
    ['Velocity before decision', `${vector(agent.decisionVelocity)} m/s`],
    ['Preferred velocity', `${vector(agent.preferred)} m/s`],
    ['Chosen command', `${vector(chosen)} m/s`],
    ['Change from preference', `${number(Math.hypot(chosen[0] - agent.preferred[0], chosen[1] - agent.preferred[1]))} m/s`],
    ['Available peer observations', run.config.scenario === 'blind' ? '0 / sensing unavailable' : String(run.agents.length - 1)],
  ]);
  $('#orca-feasibility').textContent = constrained
    ? agent.feasible ? agent.constraints.length ? 'Feasible: the chosen command satisfies every observed-peer half-plane and the speed bound.' : 'Feasible with no pair constraints: only the speed limit is enforced. Unseen peers can still collide.' : 'Infeasible: no velocity satisfies all constraints and the speed bound. The fallback commands zero velocity; this is not a safety guarantee.'
    : 'ORCA feasibility is not evaluated for this baseline. The plot shows the speed bound and its preferred/chosen velocities.';
  $('#orca-constraints').innerHTML = agent.constraints.length ? agent.constraints.map((c) => {
    const margin = (chosen[0] - c.point[0]) * c.normal[0] + (chosen[1] - c.point[1]) * c.normal[1];
    return `<tr><td>${c.neighbor}</td><td>${vector(c.point)}</td><td>${vector(c.normal)}</td><td data-violation="${margin < -1e-8}" data-margin="${margin}">${number(Math.abs(margin) < 1e-10 ? 0 : margin, 5)}</td></tr>`;
  }).join('') : `<tr><td colspan="4">${constrained ? 'No observed peers: no pair constraints.' : 'This baseline does not construct ORCA half-planes.'}</td></tr>`;
  $('#orca-constraint-note').textContent = constrained
    ? `${agent.constraints.length} pair constraints, τ = ${run.config.horizon} s. ORCA uses radius ${(RADIUS + SAFETY_PADDING).toFixed(2)} m per disk; clearance is evaluated using the physical ${RADIUS.toFixed(2)} m radius.`
    : 'APF sums attraction and peer repulsion; direct motion follows the preference. Neither solves the displayed ORCA constrained problem.';
  $('#orca-states').innerHTML = run.agents.map((a, index) => {
    const distance = Math.hypot(a.position[0] - a.goal[0], a.position[1] - a.goal[1]);
    return `<tr class="${selected === index ? 'selected' : ''}"><td><button data-inspect-agent="${index}" aria-label="Inspect agent ${a.id} in state table">${a.id}</button></td><td data-raw-value="${a.position.join(',')}">${vector(a.position)}</td><td data-raw-value="${a.velocity.join(',')}">${vector(a.velocity)}</td><td>${number(distance)}</td><td>${distance <= GOAL_RADIUS ? 'Arrived' : 'Pending'}</td><td>${constrained ? a.feasible ? 'Yes' : 'No / stop' : 'Not evaluated'}</td></tr>`;
  }).join('');
}
function render() {
  $('#orca-status').textContent = run.status === 'running' ? playing ? 'Playing' : 'Paused' : outcomeNames[run.status];
  $('#orca-play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  for (const id of ['play', 'step', 'finish']) $(`#orca-${id}`).disabled = run.status !== 'running';
  $('#orca-description').textContent = descriptions[run.config.method]; $('#orca-scenario-description').textContent = scenarios[run.config.scenario];
  $('#orca-horizon').disabled = run.config.method !== 'orca';
  $('#orca-contract').textContent = `${DT} s / step · ${MAX_SPEED} m/s maximum · ${MAX_STEPS * DT} s budget`;
  $('#orca-arrived').textContent = `${run.metrics.arrived} / ${run.agents.length}`;
  $('#orca-clearance').textContent = `${number(run.metrics.minClearance)} m`;
  $('#orca-time').textContent = `${run.time.toFixed(2)} s`; $('#orca-step-count').textContent = String(run.step);
  $('#orca-infeasible').textContent = String(run.metrics.infeasibleSteps);
  $('#orca-outcome').dataset.status = run.status;
  $('#orca-outcome').textContent = run.status === 'arrived'
    ? `All ${run.agents.length} agents are within ${GOAL_RADIUS} m of their goals at ${run.time.toFixed(2)} s. Minimum swept physical clearance: ${number(run.metrics.minClearance)} m.`
    : run.status === 'collision' ? `Collision detected: minimum swept physical clearance is ${number(run.metrics.minClearance)} m. The run stops on contact or overlap; the displayed time is the end of the detecting step.`
      : run.status === 'timeout' ? `Time budget exhausted at ${MAX_STEPS * DT} s: ${run.metrics.arrived} of ${run.agents.length} agents arrived. Remaining separated does not establish mission completion.`
        : `The run is ${playing ? 'playing' : 'paused'}. Success requires all ${run.agents.length} agents within ${GOAL_RADIUS} m of their goals, with no physical contact throughout the run. The evaluator checks motion between frames.`;
  renderInspection(); view.update(run, selected);
}

for (const [id, label] of Object.entries(METHODS)) $('#orca-algorithm').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
for (const [id, label] of Object.entries(SCENARIOS)) $('#orca-scenario').append(Object.assign(document.createElement('option'), { value: id, textContent: label }));
$('#orca-presets').innerHTML = PRESETS.map((preset, index) => `<article><span class="exercise-number">${String(index + 1).padStart(2, '0')} / ${preset.config.scenario === 'crossing' ? 'COMPARE THE RULE' : 'TEST AN ASSUMPTION'}</span><h3>${preset.label}</h3><p>${preset.description}</p><button data-orca-case="${preset.id}">Load ${preset.label.toLowerCase()} ↗</button></article>`).join('');
$('#orca-presets').addEventListener('click', (event) => { const button = event.target.closest('[data-orca-case]'); if (button) start(PRESETS.find((p) => p.id === button.dataset.orcaCase).config); });
$('#orca-algorithm').addEventListener('change', () => start({ ...run.config, method: $('#orca-algorithm').value }));
$('#orca-scenario').addEventListener('change', () => start({ ...run.config, scenario: $('#orca-scenario').value }));
$('#orca-horizon').addEventListener('change', () => start({ ...run.config, horizon: Number($('#orca-horizon').value) }));
$('#orca-observer').addEventListener('change', () => select(Number($('#orca-observer').value)));
$('#orca-states').addEventListener('click', (event) => { const button = event.target.closest('[data-inspect-agent]'); if (button) { const index = Number(button.dataset.inspectAgent); select(index); $(`[data-inspect-agent="${index}"]`).focus({ preventScroll: true }); } });
$('#orca-play').addEventListener('click', () => { if (playing) stop(); else playing = true; render(); schedule(); });
$('#orca-step').addEventListener('click', () => { stop(); stepRun(run); render(); });
$('#orca-reset').addEventListener('click', () => start(run.config));
$('#orca-finish').addEventListener('click', () => { stop(); runToEnd(run); render(); });
$('#orca-speed').addEventListener('change', () => { if (playing) schedule(); });
for (const mode of ['2d', '3d']) $(`#orca-${mode}`).addEventListener('click', () => {
  view.setMode(mode);
  for (const other of ['2d', '3d']) $(`#orca-${other}`).setAttribute('aria-pressed', String(other === mode));
});
let comparisonsReady = false;
$('#orca-comparisons').addEventListener('toggle', () => {
  if (!$('#orca-comparisons').open || comparisonsReady) return;
  $('#orca-reference-table').innerHTML = referenceComparisons().map((result) => `<tr data-reference-case="${result.id}"><td>${result.label}</td><td>${result.config.method.toUpperCase()}${result.config.method === 'orca' ? ` / ${result.config.horizon} s` : ' / n/a'}</td><td>${outcomeNames[result.status]}</td><td>${result.time.toFixed(2)} s</td><td>${result.arrived} / ${result.config.scenario === 'headOn' ? 2 : 3}</td><td>${number(result.minClearance, 6)} m</td><td>${result.infeasibleSteps} steps</td></tr>`).join('');
  comparisonsReady = true;
});
window.addEventListener('pagehide', () => { stop(); view.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
start(run.config);
