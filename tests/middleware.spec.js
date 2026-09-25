import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { middlewareEvents, middlewareFrame, middlewareSummary } from '../src/middleware-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ros2-middleware.json', import.meta.url), 'utf8'));
const runFor = (durability, rmw = 'rmw_fastrtps_cpp') => trace.cases.find(run => run.durability === durability && run.rmw === rmw);
const retained = runFor('transient_local'), volatile = runFor('volatile');
const errorsByPage = new WeakMap();
const snapshot = page => page.locator('#middleware-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  sourcePosition: JSON.parse(node.dataset.sourcePosition),
  retainedPosition: JSON.parse(node.dataset.retainedPosition),
  readerStatus: node.dataset.readerStatus,
  phase: node.dataset.phase,
  rmw: node.dataset.rmw,
  durability: node.dataset.durability,
}));
const upload = (page, data) => page.locator('#middleware-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = middlewareFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.rmw).toBe(run.rmw);
  expect(actual.durability).toBe(run.durability);
  actual.sourcePosition.forEach((value, axis) => expect(value).toBeCloseTo(frame.sourcePosition[axis], 12));
  expect(actual.retainedPosition).toEqual(frame.position);
  expect(actual.readerStatus).toBe(frame.readerStatus);
  expect(actual.phase).toBe(frame.phase);
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/middleware/');
  await expect(page.locator('#middleware-viewport')).toHaveAttribute('data-case', retained.id);
  await expect(page.locator('#middleware-case option')).toHaveCount(trace.cases.length);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('event stepping, scrubbing, case selection and reset use measured events on one cursor', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText(/Fast DDS vs Eclipse Zenoh/);
  await expectFrame(page, retained, 0);
  const first = middlewareEvents(retained).find(event => event.timeMs > 0);
  await page.locator('#middleware-step').click();
  await expectFrame(page, retained, first.timeMs);
  await page.locator('#middleware-time-slider').fill('1500');
  const beforeJoin = await expectFrame(page, retained, 1500);
  expect(beforeJoin.position).toBeNull();
  await expect(page.locator('#middleware-held-seq')).toContainText(/None/i);
  await page.locator('#middleware-join').click();
  await expectFrame(page, retained, retained.processEvents[0].timeMs);
  await page.locator('#middleware-case').selectOption(volatile.id);
  await expectFrame(page, volatile, 0);
  await page.locator('#middleware-finish').click();
  await expectFrame(page, volatile, volatile.endMs);
  await expect(page.locator('#middleware-step')).toBeDisabled();
  await page.locator('#middleware-reset').click();
  await expectFrame(page, volatile, 0);
});

test('history callbacks retain old samples while volatile remains empty until new publications', async ({ page }) => {
  const historical = retained.callbacks.find(item => item.generatedMs < retained.processEvents[0].timeMs);
  await page.locator('#middleware-first').click();
  const frame = await expectFrame(page, retained, historical.callbackMs);
  expect(frame.lastCallback.seq).toBe(historical.seq);
  expect(frame.generationAgeMs).toBeGreaterThan(1000);
  await expect(page.locator('#middleware-received-note')).toContainText(/history/i);
  await page.locator('#middleware-case').selectOption(volatile.id);
  await page.locator('#middleware-time-slider').fill('3000');
  const empty = await expectFrame(page, volatile, 3000);
  expect(empty.readerStatus).toBe('listening');
  expect(empty.position).toBeNull();
  await expect(page.locator('#middleware-received')).toHaveText('0');
  await page.locator('#middleware-first').click();
  const firstLive = middlewareSummary(volatile).firstLiveCallbackMs;
  expect((await expectFrame(page, volatile, firstLive)).lastCallback.seq).toBe(10);
  await page.locator('#middleware-live').click();
  await expectFrame(page, volatile, volatile.publications.find(item => item.seq === 10).generatedMs);
});

test('callback inspection shows actual envelopes without revealing future callback rows', async ({ page }) => {
  const first = retained.callbacks[0];
  await page.locator('#middleware-first').click();
  await expectFrame(page, retained, first.callbackMs);
  await page.locator('#middleware-envelope').evaluate(node => { node.closest('details').open = true; });
  expect(JSON.parse(await page.locator('#middleware-envelope').textContent())).toEqual(first);
  const indexes = await page.locator('[data-middleware-callback]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.middlewareCallback)));
  expect(indexes.length).toBeGreaterThan(0);
  expect(indexes.every(index => retained.callbacks[index].callbackMs <= first.callbackMs)).toBe(true);
  await page.locator('#middleware-finish').click();
  const visibleIndex = await page.locator('[data-middleware-callback]').last().getAttribute('data-middleware-callback');
  await page.locator(`[data-middleware-callback="${visibleIndex}"]`).click();
  await expectFrame(page, retained, retained.callbacks[Number(visibleIndex)].callbackMs);
  await expect(page.locator('#middleware-provenance')).toContainText(retained.publisher.node);
  await expect(page.locator('#middleware-provenance')).toContainText(String(retained.reader.pid));
});

test('2D, 3D and camera changes preserve the exact retained sample and context loss restores 2D', async ({ page }) => {
  await page.locator('#middleware-time-slider').fill('3000');
  const before = await snapshot(page);
  await page.locator('#middleware-2d').click();
  await expect(page.locator('#middleware-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#middleware-3d').click();
  const canvas = page.locator('#middleware-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#middleware-camera-close').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#middleware-camera-yard').click();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#middleware-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('changing RMW preserves the selected durability and replay can play then remain paused', async ({ page }) => {
  await page.locator('#middleware-swap-rmw').click();
  const zenoh = runFor('transient_local', 'rmw_zenoh_cpp');
  // The exercise may select a teaching landmark; its cursor must still describe this run.
  const selected = await snapshot(page);
  await expectFrame(page, zenoh, selected.timeMs);
  await expect(page.locator('#middleware-topology-note')).toContainText(/discovery|gossip/i);
  await page.locator('#middleware-reset').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#middleware-play').click();
  await page.clock.runFor(350);
  await page.locator('#middleware-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, zenoh, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#middleware-reset').click();
  await expectFrame(page, zenoh, 0);
});

test('malformed JSON and forged sample provenance preserve the active recording and cursor', async ({ page }) => {
  await page.locator('#middleware-time-slider').fill('3000');
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#middleware-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases[0].callbacks[0].position[2] += 1;
  await upload(page, forged);
  await expect(page.locator('#middleware-import-status')).toContainText(/publication/i);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#middleware-time-slider').fill('3100');
  await expectFrame(page, retained, 3100);
});

test('imported metadata remains plain text and partial recordings retain their own evidence', async ({ page }) => {
  const imported = structuredClone(trace);
  imported.cases = [imported.cases.find(run => run.id === retained.id)];
  const run = imported.cases[0];
  const label = '<img id="middleware-injected" src=x onerror="window.__middlewareInjected=true">';
  run.label = label;
  run.publisher.node = label;
  await upload(page, imported);
  await expect(page.locator('#middleware-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#middleware-case option')).toHaveCount(1);
  await expect(page.locator('#middleware-case option')).toHaveText('Fast DDS / TRANSIENT_LOCAL');
  await expect(page.locator('#middleware-provenance')).toContainText(label);
  await expect(page.locator('#middleware-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__middlewareInjected)).toBeUndefined();
  await page.locator('#middleware-first').click();
  await expectFrame(page, run, run.callbacks[0].callbackMs);
  await page.locator('#middleware-bundled').click();
  await expectFrame(page, retained, 0);
  await expect(page.locator('#middleware-case option')).toHaveCount(4);
});

test('a 390px screen without WebGL keeps replay and late-join evidence available without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#middleware-viewport')).toHaveAttribute('data-case', retained.id);
  await expect(page.locator('#middleware-viewport svg')).toBeVisible();
  await page.locator('#middleware-first').click();
  const frame = await expectFrame(page, retained, retained.callbacks[0].callbackMs);
  expect(frame.position).not.toBeNull();
  await expect(page.locator('#middleware-received')).toHaveText(String(frame.receivedCount));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toBeVisible();
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toHaveValue('/middleware/');
  await page.locator('#middleware-case').selectOption(volatile.id);
  await page.locator('#middleware-time-slider').fill('3000');
  expect((await expectFrame(page, volatile, 3000)).position).toBeNull();
});
