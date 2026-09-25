import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { restartEvents, restartFrame, restartSummary } from '../src/restart-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-restart.json', import.meta.url), 'utf8'));
const runFor = id => trace.cases.find(run => run.id === id);
const restarted = runFor('restart'), silent = runFor('silence'), normal = runFor('normal');
const errorsByPage = new WeakMap();
const snapshot = page => page.locator('#restart-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  policyId: node.dataset.policyId,
  sourcePosition: JSON.parse(node.dataset.sourcePosition),
  retainedPosition: JSON.parse(node.dataset.retainedPosition),
  monitorState: node.dataset.monitorState,
}));
const upload = (page, data) => page.locator('#restart-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectFrame(page, run, timeMs, policyId = 'sequence') {
  const actual = await snapshot(page), frame = restartFrame(run, actual.timeMs);
  const policy = frame.policies.find(item => item.id === policyId);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.policyId).toBe(policyId);
  // Chromium and Node's native trigonometry may differ by one ULP.
  actual.sourcePosition.forEach((value, axis) => expect(value).toBeCloseTo(frame.sourcePosition[axis], 12));
  expect(actual.retainedPosition).toEqual(policy.position);
  expect(actual.monitorState).toBe(policy.status);
  return policy;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/restart/');
  // Wait for initialized data, rather than a clickable-looking static skeleton.
  await expect(page.locator('#restart-viewport')).toHaveAttribute('data-case', restarted.id);
  await expect(page.locator('#restart-case option')).toHaveCount(trace.cases.length);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('event stepping, scrubbing, reset and case changes replay observed events without running processes', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText(/Fixed-timeout heartbeat detector/i);
  await expectFrame(page, restarted, 0);
  const first = restartEvents(restarted).find(event => event.timeMs > 0);
  await page.locator('#restart-step').click();
  await expectFrame(page, restarted, first.timeMs);
  const next = restartEvents(restarted).find(event => event.timeMs > first.timeMs);
  await page.locator('#restart-step').click();
  await expectFrame(page, restarted, next.timeMs);
  await page.locator('#restart-time-slider').fill('2200');
  await expectFrame(page, restarted, 2200);
  await page.locator('#restart-reset').click();
  await expectFrame(page, restarted, 0);
  await page.locator('#restart-case').selectOption(normal.id);
  await expectFrame(page, normal, 0);
  await expect(page.locator('#restart-interruption')).toBeDisabled();
  await page.locator('#restart-finish').click();
  await expectFrame(page, normal, normal.endMs);
  await expect(page.locator('#restart-step')).toBeDisabled();
});

test('callback inspection shows real envelopes and historical rows do not expose future callbacks', async ({ page }) => {
  const returning = restartSummary(restarted)[0].returnCallback;
  await page.locator('#restart-return').click();
  await expectFrame(page, restarted, returning.callbackMs);
  await page.locator('#restart-envelope').evaluate(node => { node.closest('details').open = true; });
  expect(JSON.parse(await page.locator('#restart-envelope').textContent())).toEqual(returning);
  const indexes = await page.locator('[data-restart-callback]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.restartCallback)));
  expect(indexes.length).toBeGreaterThan(0);
  expect(indexes.every(index => restarted.callbacks[index].callbackMs <= returning.callbackMs)).toBe(true);
  const selected = indexes.at(-1);
  await page.locator(`[data-restart-callback="${selected}"]`).click();
  await expectFrame(page, restarted, restarted.callbacks[selected].callbackMs);
  await expect(page.locator('#restart-provenance')).toContainText(String(restarted.agents[1].pid));
  await expect(page.locator('#restart-provenance')).toContainText(restarted.observer.node);
});

test('policy and 2D/3D switches preserve one cursor and retained sample, including context-loss fallback', async ({ page }) => {
  await page.locator('#restart-return').click();
  const timeMs = restartSummary(restarted)[0].returnCallback.callbackMs;
  await page.locator('#restart-policy-incarnation').click();
  await expectFrame(page, restarted, timeMs, 'incarnation');
  const before = await snapshot(page);
  await page.locator('#restart-2d').click();
  await expect(page.locator('#restart-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#restart-3d').click();
  const canvas = page.locator('#restart-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#restart-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#restart-policy-sequence').click();
  await expectFrame(page, restarted, timeMs);
});

test('restart inspection separates a live replacement from rejected callbacks and delayed baseline recovery', async ({ page }) => {
  const summaries = restartSummary(restarted), baseline = summaries.find(item => item.id === 'sequence');
  await page.locator('#restart-return').click();
  const sequence = await expectFrame(page, restarted, baseline.returnCallback.callbackMs);
  expect(sequence.status).toBe('suspect');
  expect(sequence.lastCallback.epoch).toBe(2);
  expect(sequence.lastAccepted.epoch).toBe(1);
  await expect(page.locator('#restart-callback-decision')).toContainText(/Ignored/);
  await expect(page.locator('#restart-process-details')).toContainText(String(restarted.agents[1].pid));
  await page.locator('#restart-policy-incarnation').click();
  const incarnation = await expectFrame(page, restarted, baseline.returnCallback.callbackMs, 'incarnation');
  expect(incarnation.status).toBe('live');
  expect(incarnation.lastAccepted.epoch).toBe(2);
  await expect(page.locator('#restart-callback-decision')).toContainText(/Accepted/);
  await page.locator('#restart-policy-sequence').click();
  await page.locator('#restart-recovery').click();
  const recovered = await expectFrame(page, restarted, baseline.firstAcceptedAfterReturn.callbackMs);
  expect(recovered.status).toBe('live');
  expect(recovered.lastAccepted.epoch).toBe(2);
  expect(baseline.returnToAcceptanceMs).toBeGreaterThan(0);
});

test('publication silence causes suspicion without a new process and play/pause preserves the selected case', async ({ page }) => {
  await page.locator('#restart-case').selectOption(silent.id);
  await page.locator('#restart-suspicion').click();
  const suspicion = restartSummary(silent)[0].firstSuspicionMs;
  expect((await expectFrame(page, silent, suspicion)).status).toBe('suspect');
  await expect(page.locator('#restart-process-state')).toContainText(/silent|silence|running/i);
  await expect(page.locator('#restart-process-details')).toContainText(String(silent.agents[0].pid));
  await page.locator('#restart-return').click();
  const resumed = restartSummary(silent)[0].returnCallback.callbackMs;
  expect((await expectFrame(page, silent, resumed)).status).toBe('live');
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#restart-play').click();
  await page.clock.runFor(350);
  await page.locator('#restart-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(resumed);
  await expectFrame(page, silent, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#restart-reset').click();
  await expectFrame(page, silent, 0);
});

test('malformed JSON and forged callback admission leave the active recording and cursor intact', async ({ page }) => {
  await page.locator('#restart-time-slider').fill('2200');
  await page.locator('#restart-policy-incarnation').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#restart-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases.find(run => run.id === 'restart').callbacks.find(item => item.epoch === 2).decisions.sequence.accepted = true;
  await upload(page, forged);
  await expect(page.locator('#restart-import-status')).toContainText(/admission decision/i);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#restart-time-slider').fill('2300');
  await expectFrame(page, restarted, 2300, 'incarnation');
});

test('imported HTML-looking labels remain plain text and restoring the bundle resets its own evidence', async ({ page }) => {
  const imported = structuredClone(trace), run = imported.cases.find(item => item.id === 'restart');
  const label = '<img id="restart-injected" src=x onerror="window.__restartInjected=true">';
  run.label = label;
  run.observer.node = label;
  await upload(page, imported);
  await expect(page.locator('#restart-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator(`#restart-case option[value="${run.id}"]`)).toHaveText(label);
  await expect(page.locator('#restart-provenance')).toContainText(label);
  await expect(page.locator('#restart-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__restartInjected)).toBeUndefined();
  await page.locator('#restart-time-slider').fill('2200');
  await expectFrame(page, run, 2200);
  await page.locator('#restart-bundled').click();
  await expectFrame(page, restarted, 0);
  await expect(page.locator(`#restart-case option[value="${restarted.id}"]`)).toHaveText(restarted.label);
});

test('a 390px screen without WebGL retains truthful replay and policy inspection without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#restart-viewport')).toHaveAttribute('data-case', restarted.id);
  await expect(page.locator('#restart-viewport svg')).toBeVisible();
  await page.locator('#restart-return').click();
  const returning = restartSummary(restarted)[0].returnCallback;
  await expectFrame(page, restarted, returning.callbackMs);
  await page.locator('#restart-policy-incarnation').click();
  await expectFrame(page, restarted, returning.callbackMs, 'incarnation');
  await expect(page.locator('#restart-callback-decision')).toContainText(/Accepted/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toBeVisible();
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toHaveValue('/restart/');
  await page.locator('#restart-reset').click();
  await expectFrame(page, restarted, 0, 'incarnation');
});
