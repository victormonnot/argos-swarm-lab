import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { qosEvents, qosFrame } from '../src/qos-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-qos.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.config.pauseStartMs === null);
const stalled = trace.cases.find(run => run.config.pauseStartMs !== null);
const profile = (run, id) => run.readers.find(reader => reader.id === id);
const errorsByPage = new WeakMap();
const snapshot = page => page.locator('#qos-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  readerId: node.dataset.readerId,
  sourcePosition: JSON.parse(node.dataset.sourcePosition),
  retainedPosition: JSON.parse(node.dataset.retainedPosition),
  fresh: node.dataset.fresh === 'true',
}));
const upload = (page, data) => page.locator('#qos-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectFrame(page, run, timeMs, readerId = 'history20') {
  const actual = await snapshot(page);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.readerId).toBe(readerId);
  const frame = qosFrame(run, actual.timeMs), selected = profile(frame, readerId);
  // Native trigonometry may differ by one ULP between Node and Chromium.
  expect(actual.sourcePosition).toHaveLength(3);
  actual.sourcePosition.forEach((value, axis) => expect(value).toBeCloseTo(frame.sourcePosition[axis], 12));
  expect(actual.retainedPosition).toEqual(selected.position);
  expect(actual.fresh).toBe(selected.fresh);
  return selected;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/qos/');
  // The recording identity is attached by initialized JavaScript, unlike static labels.
  await expect(page.locator('#qos-viewport')).toHaveAttribute('data-case', stalled.id);
  await expect(page.locator('#qos-case option')).toHaveCount(trace.cases.length);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('event stepping, scrubbing, case changes and reset observe the recording without synthesizing deliveries', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText(/Quality of Service/);
  await expectFrame(page, stalled, 0);
  const events = qosEvents(stalled);
  const first = events.find(event => event.timeMs > 0);
  await page.locator('#qos-step').click();
  await expectFrame(page, stalled, first.timeMs);
  const second = events.find(event => event.timeMs > first.timeMs);
  await page.locator('#qos-step').click();
  await expectFrame(page, stalled, second.timeMs);
  await page.locator('#qos-time-slider').fill('1000');
  await expectFrame(page, stalled, 1000);
  await page.locator('#qos-reset').click();
  await expectFrame(page, stalled, 0);
  await page.locator('#qos-case').selectOption(nominal.id);
  await expectFrame(page, nominal, 0);
  await page.locator('#qos-time-slider').fill('500');
  await expectFrame(page, nominal, 500);
  await page.locator('#qos-finish').click();
  await expectFrame(page, nominal, nominal.endMs);
  await expect(page.locator('#qos-step')).toBeDisabled();
});

test('the callback inspector shows actual envelopes and history never reveals future callbacks', async ({ page }) => {
  const reader = profile(stalled, 'history20');
  const resumedAt = Math.max(...stalled.readers.map(item => item.callbacks.find(callback => callback.callbackMs >= item.pauses[0].endMs).callbackMs));
  const callback = reader.callbacks.filter(item => item.callbackMs <= resumedAt).at(-1);
  await page.locator('#qos-after-resume').click();
  await expectFrame(page, stalled, resumedAt);
  await expect(page.locator('#qos-callback-details')).toContainText(String(callback.seq));
  await page.locator('#qos-envelope').evaluate(node => { node.closest('details').open = true; });
  const envelope = JSON.parse(await page.locator('#qos-envelope').textContent());
  expect(envelope).toMatchObject(callback);
  const observed = reader.callbacks.filter(item => item.callbackMs <= resumedAt);
  const rows = await page.locator('[data-qos-callback]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.qosCallback)));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(seq => observed.some(item => item.seq === seq))).toBe(true);
  const chosen = observed.find(item => item.seq === rows.at(-1));
  await page.locator(`[data-qos-callback="${chosen.seq}"]`).click();
  await expectFrame(page, stalled, chosen.callbackMs);
  await expect(page.locator('#qos-provenance')).toContainText(String(reader.pid));
  await expect(page.locator('#qos-provenance')).toContainText(reader.node);
});

test('reader and 2D/3D switches preserve one recorded cursor, including fallback after context loss', async ({ page }) => {
  await page.locator('#qos-time-slider').fill('2500');
  await expectFrame(page, stalled, 2500);
  await page.locator('#qos-reader-latest1').click();
  await expectFrame(page, stalled, 2500, 'latest1');
  const before = await snapshot(page);
  await page.locator('#qos-2d').click();
  await expect(page.locator('#qos-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#qos-3d').click();
  const canvas = page.locator('#qos-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#qos-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#qos-reader-gated20').click();
  await expectFrame(page, stalled, 2500, 'gated20');
});

test('old callbacks, the age gate and nominal recovery expose different retained states', async ({ page }) => {
  await page.locator('#qos-time-slider').fill('2500');
  const history = await expectFrame(page, stalled, 2500);
  expect(history.lastCallback.ageMs).toBeGreaterThan(stalled.config.ageLimitMs);
  expect(history.fresh).toBe(false);
  await page.locator('#qos-reader-latest1').click();
  const latest = await expectFrame(page, stalled, 2500, 'latest1');
  expect(latest.fresh).toBe(true);
  expect(latest.lastAccepted.seq).toBeGreaterThan(history.lastAccepted.seq);
  await page.locator('#qos-reader-gated20').click();
  const gate = await expectFrame(page, stalled, 2500, 'gated20');
  expect(gate.lastCallback.accepted).toBe(false);
  expect(gate.ageMs).toBeGreaterThan(history.ageMs);
  await expect(page.locator('#qos-callback-decision')).toContainText(/reject|stale/i);
  await expect(page.locator('#qos-retained-details')).toContainText(String(gate.lastAccepted.seq));
  await page.locator('#qos-time-slider').fill('2600');
  const later = await expectFrame(page, stalled, 2600, 'gated20');
  expect(later.position).toEqual(gate.position);
  expect(later.ageMs - gate.ageMs).toBeCloseTo(100, 6);
  await page.locator('#qos-case').selectOption(nominal.id);
  await page.locator('#qos-reader-gated20').click();
  await page.locator('#qos-time-slider').fill('2500');
  const baseline = await expectFrame(page, nominal, 2500, 'gated20');
  expect(baseline.fresh).toBe(true);
  expect(baseline.rejected).toBe(0);
});

test('playback advances recorded time and pause prevents further changes in either view', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#qos-play').click();
  await page.clock.runFor(350);
  await page.locator('#qos-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  expect(paused.timeMs).toBeLessThan(stalled.endMs);
  await expectFrame(page, stalled, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#qos-2d').click();
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#qos-reset').click();
  await expectFrame(page, stalled, 0);
});

test('invalid JSON and stale imported envelopes leave the current recording and cursor intact', async ({ page }) => {
  await page.locator('#qos-time-slider').fill('2300');
  await page.locator('#qos-reader-gated20').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#qos-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const stale = structuredClone(trace);
  stale.cases[0].readers[0].callbacks[0].runId = 'unrelated-run';
  await upload(page, stale);
  await expect(page.locator('#qos-import-status')).toContainText(/callback run/i);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#qos-time-slider').fill('2400');
  await expectFrame(page, stalled, 2400, 'gated20');
});

test('HTML-looking imported labels stay text and restoring the bundle returns to its own evidence', async ({ page }) => {
  const imported = structuredClone(trace);
  const run = imported.cases.find(item => item.id === stalled.id);
  const label = '<img id="qos-injected" src=x onerror="window.__qosInjected=true">';
  run.label = label;
  profile(run, 'history20').node = label;
  await upload(page, imported);
  await expect(page.locator('#qos-import-status')).not.toHaveAttribute('data-error', 'true');
  await expect(page.locator(`#qos-case option[value="${run.id}"]`)).toHaveText(label);
  await page.locator('#qos-case').selectOption(run.id);
  await page.locator('#qos-reader-history20').click();
  await expect(page.locator('#qos-callback-details')).toContainText(label);
  await expect(page.locator('#qos-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__qosInjected)).toBeUndefined();
  await page.locator('#qos-time-slider').fill('2000');
  await expectFrame(page, run, 2000);
  await page.locator('#qos-bundled').click();
  await expectFrame(page, stalled, 0);
  await expect(page.locator(`#qos-case option[value="${stalled.id}"]`)).toHaveText(stalled.label);
});

test('a 390px screen without WebGL retains replay, selection and recorded state without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#qos-viewport')).toHaveAttribute('data-case', stalled.id);
  await expect(page.locator('#qos-viewport svg')).toBeVisible();
  await page.locator('#qos-time-slider').fill('2500');
  await page.locator('#qos-reader-gated20').click();
  await expectFrame(page, stalled, 2500, 'gated20');
  await expect(page.locator('#qos-callback-decision')).toContainText(/reject|stale/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link', { name: /15.*QoS/i })).toBeVisible();
  await page.locator('#qos-reset').click();
  await expectFrame(page, stalled, 0, 'gated20');
});
