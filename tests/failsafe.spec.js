import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { failsafeEvents, failsafeFrame, failsafeSummary } from '../src/failsafe-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-failsafe.json', import.meta.url), 'utf8'));
const loss = trace.cases.find(run => run.id === 'loss');
const nominal = trace.cases.find(run => run.id === 'nominal');
const errorsByPage = new WeakMap();
const serializable = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.locator('#failsafe-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  positionNed: JSON.parse(node.dataset.positionNed),
  positionEnu: JSON.parse(node.dataset.positionEnu),
  attitude: JSON.parse(node.dataset.attitude),
  mode: node.dataset.mode,
  armed: node.dataset.armed,
  landedState: node.dataset.landedState,
  gcsEnabled: node.dataset.gcsEnabled,
  gcsAgeMs: node.dataset.gcsAgeMs,
  failsafeActive: node.dataset.failsafeActive,
}));
const upload = (page, data) => page.locator('#failsafe-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});
const seek = (page, timeMs) => page.locator('#failsafe-time-slider').evaluate((node, value) => {
  node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
}, timeMs);

async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = failsafeFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.positionNed).toEqual(serializable(frame.positionNed));
  expect(actual.positionEnu).toEqual(serializable(frame.positionEnu));
  expect(actual.attitude).toEqual(serializable(frame.attitude));
  expect(actual.mode).toBe(String(frame.mode));
  expect(actual.armed).toBe(String(frame.armed));
  expect(actual.landedState).toBe(String(frame.landedState));
  expect(actual.gcsEnabled).toBe(String(frame.gcs.enabled));
  expect(actual.gcsAgeMs).toBe(String(frame.gcs.ageMs));
  expect(actual.failsafeActive).toBe(String(frame.failsafe.active));
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/failsafe/');
  await expect(page.locator('#failsafe-case option')).toHaveCount(trace.cases.length);
  await page.locator('#failsafe-case').selectOption(loss.id);
  await expect(page.locator('#failsafe-viewport')).toHaveAttribute('data-case', loss.id);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('recorded sends, observed landmarks and replay reset share one exact cursor', async ({ page }) => {
  const summary = failsafeSummary(loss);
  await expect(page.locator('.method-profile')).toContainText('GCS heartbeat failsafe');
  await expectFrame(page, loss, 0);
  const first = failsafeEvents(loss).find(event => event.timeMs > 0);
  await page.locator('#failsafe-step').click();
  await expectFrame(page, loss, first.timeMs);
  for (const [button, timeMs] of [
    ['takeoff', summary.takeoffMs], ['stop', summary.lossStartMs], ['onset', summary.failsafeMs],
    ['restore', summary.restoreMs], ['clear', summary.clearMs], ['landed', summary.landedMs], ['finish', loss.endMs],
  ]) {
    await page.locator(`#failsafe-${button}`).click();
    await expectFrame(page, loss, timeMs);
  }
  await expect(page.locator('#failsafe-step')).toBeDisabled();
  await page.locator('#failsafe-reset').click();
  await expectFrame(page, loss, 0);
});

test('sender age cannot invent a failsafe and restoration does not resume Guided flight', async ({ page }) => {
  const summary = failsafeSummary(loss);
  await page.locator('#failsafe-2d').click();
  const timeMs = Math.floor(summary.lastHeartbeatBeforeLossMs + loss.config.gcsTimeoutMs + 1);
  expect(timeMs).toBeLessThan(summary.failsafeMs);
  await seek(page, timeMs);
  const silent = await expectFrame(page, loss, timeMs);
  expect(silent.gcs.ageMs).toBeGreaterThan(loss.config.gcsTimeoutMs);
  expect(silent.gcs.enabled).toBe(false);
  expect(silent.failsafe.active).toBeNull();
  await expect(page.locator('#failsafe-reported-state')).toHaveAttribute('data-active', 'null');
  expect(Number(await page.locator('#failsafe-send-age').getAttribute('data-value'))).toBe(silent.gcs.ageMs);
  await expect(page.locator('#failsafe-statuses')).not.toContainText('GCS Failsafe');
  await expect(page.locator('[data-failsafe-direction="gcs-to-vehicle"]')).toHaveAttribute('data-enabled', 'false');
  await expect(page.locator('[data-failsafe-direction="vehicle-to-gcs"]')).toBeVisible();
  expect(Object.values(silent.latest).some(row => row && row.timeMs >= summary.lossStartMs)).toBe(true);
  await page.locator('#failsafe-onset').click();
  const active = await expectFrame(page, loss, summary.failsafeMs);
  expect(active.failsafe.active).toBe(true);
  await expect(page.locator('#failsafe-reported-state')).toHaveAttribute('data-active', 'true');
  expect(active.mode).toBe('Land');
  expect(active.failsafe.landing).toBeNull();
  await expect(page.locator('#failsafe-statuses')).toContainText('GCS Failsafe');
  await expect(page.locator('#failsafe-statuses')).not.toContainText('GCS Failsafe Cleared');
  await page.locator('#failsafe-restore').click();
  const resumed = await expectFrame(page, loss, summary.restoreMs);
  expect(resumed.gcs.enabled).toBe(true);
  expect(resumed.failsafe.active).toBe(true);
  await page.locator('#failsafe-clear').click();
  const cleared = await expectFrame(page, loss, summary.clearMs);
  expect(cleared.failsafe.active).toBe(false);
  await expect(page.locator('#failsafe-reported-state')).toHaveAttribute('data-active', 'false');
  expect(cleared.mode).toBe('Land');
  expect(cleared.failsafe.landing).toBeNull();
  await expect(page.locator('#failsafe-statuses')).toContainText('GCS Failsafe Cleared');
  await page.locator('#failsafe-landed').click();
  const landed = await expectFrame(page, loss, summary.landedMs);
  expect(landed.armed).toBe(false);
  expect(landed.landedState).toBe(1);
  expect(landed.commands.map(command => command.id)).toEqual(['guided', 'arm', 'takeoff']);
  await expect(page.locator('#failsafe-command-note')).toContainText(/no.*LAND/i);
});

test('continuous heartbeats keep Guided during the matched window and an explicit LAND follows it', async ({ page }) => {
  await page.locator('#failsafe-case').selectOption(nominal.id);
  await expectFrame(page, nominal, 0);
  for (const id of ['stop', 'onset', 'restore', 'clear']) await expect(page.locator(`#failsafe-${id}`)).toBeDisabled();
  const summary = failsafeSummary(nominal), timeMs = Math.floor(summary.observationEndMs);
  await seek(page, timeMs);
  const observed = await expectFrame(page, nominal, timeMs);
  expect(observed.mode).toBe('Guided');
  expect(observed.gcs.enabled).toBe(true);
  expect(observed.failsafe.onset).toBeNull();
  expect(observed.commands.some(command => command.id === 'land')).toBe(false);
  await page.locator('#failsafe-finish').click();
  const done = await expectFrame(page, nominal, nominal.endMs);
  expect(done.commands.at(-1).id).toBe('land');
  expect(done.acks.some(ack => ack.commandId === 'land' && ack.result === 0)).toBe(true);
  expect(done.armed).toBe(false);
  await expect(page.locator('#failsafe-commands tr')).toHaveCount(4);
  await expect(page.locator('#failsafe-statuses')).not.toContainText('GCS Failsafe');
});

test('provenance and inspectors expose original records with no future status or sender envelope', async ({ page }) => {
  await page.locator('.failsafe-provenance > summary').click();
  await expect(page.locator('#failsafe-provenance')).toContainText(trace.runtime.firmwareGitHash);
  await expect(page.locator('#failsafe-provenance')).toContainText(trace.runtime.binarySha256);
  await page.locator('#failsafe-stop').click();
  const frame = await expectFrame(page, loss, failsafeSummary(loss).lossStartMs);
  const sent = JSON.parse(await page.locator('#failsafe-heartbeat-envelope').textContent());
  expect(sent).toEqual(frame.gcs.lastTx);
  expect(sent.timeMs).toBeLessThanOrEqual(frame.timeMs);
  expect(JSON.parse(await page.locator('#failsafe-event-envelope').textContent())).toEqual(frame.failsafe);
  await expect(page.locator('#failsafe-statuses')).not.toContainText('GCS Failsafe');
  await expect(page.locator('#failsafe-commands tr')).toHaveCount(frame.commands.length);
  await page.locator('[data-failsafe-command="takeoff"]').click();
  expect(JSON.parse(await page.locator('#failsafe-request-envelope').textContent())).toEqual({
    command: loss.commands.find(row => row.id === 'takeoff'),
    ack: loss.acks.find(row => row.commandId === 'takeoff'),
    completion: loss.events.find(row => row.stage === 'takeoff' && row.status === 'complete'),
  });
  await page.locator('#failsafe-inspect-onset').click();
  await expectFrame(page, loss, failsafeSummary(loss).failsafeMs);
  await page.locator('#failsafe-inspect-clear').click();
  await expectFrame(page, loss, failsafeSummary(loss).clearMs);
  await expect(page.locator('#failsafe-restoration-note')).toContainText(/LAND/i);
});

test('2D, 3D, cameras and WebGL loss preserve the received flight state and message directions', async ({ page }) => {
  await page.locator('#failsafe-onset').click();
  const before = await snapshot(page);
  expect(before.positionNed).not.toBeNull();
  await page.locator('#failsafe-2d').click();
  await expect(page.locator('#failsafe-viewport svg')).toBeVisible();
  expect(JSON.parse(await page.locator('[data-failsafe-svg-position]').getAttribute('data-position'))).toEqual(before.positionEnu);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#failsafe-3d').click();
  const canvas = page.locator('#failsafe-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#failsafe-camera-close').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#failsafe-camera-yard').click();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#failsafe-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('playback speed, pause and scrubbing change only the replay cursor', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#failsafe-speed').selectOption('4');
  await page.locator('#failsafe-play').click();
  await page.clock.runFor(350);
  await page.locator('#failsafe-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, loss, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  const timeMs = Math.floor(loss.endMs / 2);
  await seek(page, timeMs);
  await expectFrame(page, loss, timeMs);
});

test('invalid JSON and forged heartbeat identities preserve the selected recording and cursor', async ({ page }) => {
  await page.locator('#failsafe-onset').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#failsafe-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases.find(run => run.id === 'loss').heartbeatTx[0].sourceSystem = 42;
  await upload(page, forged);
  await expect(page.locator('#failsafe-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
});

test('single-case imports keep labels as plain text and restore the bundled comparison', async ({ page }) => {
  const imported = structuredClone(trace);
  imported.cases = [imported.cases.find(run => run.id === 'loss')];
  const label = '<img id="failsafe-injected" src=x onerror="window.__failsafeInjected=true">';
  imported.cases[0].label = label;
  await upload(page, imported);
  await expect(page.locator('#failsafe-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#failsafe-case option')).toHaveCount(1);
  await expect(page.locator('#failsafe-case option')).toContainText(label);
  await expect(page.locator('#failsafe-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__failsafeInjected)).toBeUndefined();
  await expectFrame(page, imported.cases[0], 0);
  await page.locator('#failsafe-bundled').click();
  await expect(page.locator('#failsafe-case option')).toHaveCount(trace.cases.length);
  const current = await snapshot(page);
  await expectFrame(page, trace.cases.find(run => run.id === current.caseId), 0);
});

test('390px without WebGL retains observed failsafe evidence, controls and twenty workshop links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await page.locator('#failsafe-case').selectOption(loss.id);
  await expect(page.locator('#failsafe-viewport svg')).toBeVisible();
  await page.locator('#failsafe-inspect-loss').click();
  const cursor = await snapshot(page);
  const frame = await expectFrame(page, loss, cursor.timeMs);
  expect(frame.gcs.enabled).toBe(false);
  await page.locator('#failsafe-clear').click();
  expect((await expectFrame(page, loss, failsafeSummary(loss).clearMs)).mode).toBe('Land');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(22);
  await expect(navigation.getByRole('link', { name: /20.*GCS.*failsafe/i })).toHaveAttribute('aria-current', 'page');
});
