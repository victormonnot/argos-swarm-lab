import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-consensus.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(recording => recording.topology === 'complete' && recording.outcome.status === 'completed');
const chain = trace.cases.find(recording => recording.topology === 'chain' && recording.outcome.status === 'completed');
const failure = trace.cases.find(recording => recording.outcome.status === 'timeout');
const errorsByPage = new WeakMap();
const snapshot = page => page.locator('#ros-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  round: Number(node.dataset.round),
  phase: node.dataset.phase,
  values: JSON.parse(node.dataset.values),
}));
const upload = (page, data) => page.locator('#ros-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectState(page, recording, round) {
  await expect(page.locator('#ros-round')).toHaveText(String(round));
  const actual = await snapshot(page);
  expect(actual.caseId).toBe(recording.id);
  expect(actual.round).toBe(round);
  expect(actual.values).toEqual(recording.states[round].values);
  const tableValues = await page.locator('#ros-states [data-agent]').evaluateAll(rows => rows.map(row => Number(row.dataset.value)));
  expect(tableValues).toEqual(recording.states[round].values);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ros2/');
  // A static "0" label is not sufficient evidence that handlers are attached.
  await expect(page.locator('#ros-viewport')).toHaveAttribute('data-case', nominal.id);
  await expect(page.locator('#ros-case option')).toHaveCount(trace.cases.length);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('publish and receive phases preserve the old vector until all six recorded updates commit', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText(/consensus/i);
  await expectState(page, nominal, 0);
  expect((await snapshot(page)).phase).toBe('state');
  await page.locator('#ros-step').click();
  expect((await snapshot(page)).phase).toBe('publish');
  await expectState(page, nominal, 0);
  await page.locator('#ros-step').click();
  expect((await snapshot(page)).phase).toBe('receive');
  await expectState(page, nominal, 0);
  await page.locator('#ros-step').click();
  expect((await snapshot(page)).phase).toBe('commit');
  await expectState(page, nominal, 1);
  await expect(page.locator('#ros-reference')).toContainText(/match/i);
});

test('case changes, round stepping, scrubbing and reset select recorded vectors without recomputing the transport', async ({ page }) => {
  await page.locator('#ros-next-round').click();
  await expectState(page, nominal, 1);
  await page.locator('#ros-next-round').click();
  await expectState(page, nominal, 2);
  await page.locator('#ros-case').selectOption(chain.id);
  await expectState(page, chain, 0);
  await page.locator('#ros-round-slider').fill('5');
  await expectState(page, chain, 5);
  await page.locator('#ros-round-slider').focus();
  await page.keyboard.press('ArrowRight');
  await expectState(page, chain, 6);
  await page.locator('#ros-reset').click();
  await expectState(page, chain, 0);
  await page.locator('#ros-finish').click();
  await expectState(page, chain, chain.outcome.completedRounds);
  await expect(page.locator('#ros-step')).toBeDisabled();
});

test('agent inspection exposes its process, received neighbors and the recorded envelope', async ({ page }) => {
  await page.locator('#ros-case').selectOption(chain.id);
  await page.locator('#ros-agent').selectOption('2');
  await page.locator('#ros-step').click();
  await page.locator('#ros-step').click();
  const before = await snapshot(page), selected = chain.agents[2];
  await expect(page.locator('#ros-agent-details')).toContainText(String(selected.pid));
  await expect(page.locator('#ros-agent-details')).toContainText(selected.node);
  const rows = page.locator('#ros-inbox [data-from]');
  expect(await rows.evaluateAll(nodes => nodes.map(node => Number(node.dataset.from)))).toEqual(selected.neighbors);
  await expect(page.locator('#ros-inbox [data-received="true"]')).toHaveCount(selected.neighbors.length);
  await expect(page.locator('#ros-envelopes')).toContainText(chain.runId);
  await expect(page.locator('#ros-envelopes')).toContainText('round');
  await expect(page.locator('#ros-calculation')).toContainText(/1\s*\/\s*12|0\.083333/);
  await page.locator('#ros-agent').selectOption('5');
  await expect(page.locator('#ros-agent-details')).toContainText(String(chain.agents[5].pid));
  await expect(page.locator('#ros-inbox [data-from]')).toHaveCount(1);
  expect(await snapshot(page)).toEqual(before);
});

test('the omitted publication ends at a timeout and does not present partial updates as a new global round', async ({ page }) => {
  await page.locator('#ros-case').selectOption(failure.id);
  await page.locator('#ros-finish').click();
  const last = failure.states.at(-1), omission = failure.omittedPublication;
  await expectState(page, failure, last.round);
  expect((await snapshot(page)).phase).toBe('timeout');
  await expect(page.locator('#ros-outcome')).toContainText(/timeout|timed out|incomplete/i);
  await expect(page.locator('#ros-step')).toBeDisabled();
  const waiting = failure.agents.find(agent => agent.neighbors.includes(omission.agent));
  await page.locator('#ros-agent').selectOption(String(waiting.id));
  await expect(page.locator(`#ros-inbox [data-from="${omission.agent}"]`)).toHaveAttribute('data-received', 'false');
  await expect(page.locator('#ros-calculation')).toContainText(/wait|missing|blocked|no complete local update/i);
  await page.locator('#ros-reset').click();
  await expectState(page, failure, 0);
});

test('playback pauses without changing evidence and both linked views retain the selected phase', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#ros-play').click();
  await page.clock.runFor(2200);
  await page.locator('#ros-play').click();
  const paused = await snapshot(page);
  expect(paused.phase !== 'state' || paused.round > 0).toBe(true);
  await page.clock.runFor(4000);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#ros-2d').click();
  await expect(page.locator('.ros-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#ros-3d').click();
  const canvas = page.locator('#ros-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(paused);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.ros-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#ros-next-round').click();
  await expectState(page, nominal, paused.round + 1);
});

test('invalid JSON and stale message imports preserve the selected recording and phase', async ({ page }) => {
  await page.locator('#ros-case').selectOption(chain.id);
  await page.locator('#ros-next-round').click();
  await page.locator('#ros-step').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#ros-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const stale = structuredClone(trace);
  stale.cases[0].rounds[0].received[0].runId = 'unrelated-run';
  await upload(page, stale);
  await expect(page.locator('#ros-import-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#ros-import-status')).toContainText('run and round');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#ros-next-round').click();
  await expectState(page, chain, 2);
});

test('valid imported recordings keep HTML-looking labels as text and expose numerical mismatches honestly', async ({ page }) => {
  const imported = structuredClone(trace);
  const recording = imported.cases.find(candidate => candidate.id === nominal.id);
  const label = '<img id="ros-injected" src=x onerror="window.__rosInjected=true">';
  recording.label = label;
  const final = recording.states.at(-1);
  final.values[0] += 0.125;
  recording.rounds.at(-1).updates.find(entry => entry.agent === 0).value = final.values[0];
  await upload(page, imported);
  await expect(page.locator('#ros-import-status')).not.toHaveAttribute('data-error', 'true');
  await expect(page.locator(`#ros-case option[value="${recording.id}"]`)).toHaveText(label);
  await expect(page.locator('#ros-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__rosInjected)).toBeUndefined();
  await expect(page.locator('#ros-reference')).toContainText(/mismatch|differ|does not match|not match/i);
  await page.locator('#ros-finish').click();
  await expectState(page, recording, recording.outcome.completedRounds);
});

test('a 390px screen and unavailable WebGL retain controls, process inspection and recorded state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#ros-viewport')).toHaveAttribute('data-case', nominal.id);
  await expect(page.locator('.ros-svg')).toBeVisible();
  await page.locator('#ros-next-round').click();
  await expectState(page, nominal, 1);
  await page.locator('#ros-agent').selectOption('4');
  await expect(page.locator('#ros-agent-details')).toContainText(String(nominal.agents[4].pid));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toBeVisible();
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toHaveValue('/ros2/');
  await page.locator('#ros-reset').click();
  await expectState(page, nominal, 0);
});
