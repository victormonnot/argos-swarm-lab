import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { sitlEvents, sitlFrame, sitlSummary } from '../src/sitl-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-sitl.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => sitlSummary(run).takeoffAdmission === 'accepted');
const rejected = trace.cases.find(run => sitlSummary(run).takeoffAdmission === 'rejected');
const errorsByPage = new WeakMap();
const snapshot = page => page.locator('#sitl-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  positionNed: JSON.parse(node.dataset.positionNed),
  positionEnu: JSON.parse(node.dataset.positionEnu),
  attitude: JSON.parse(node.dataset.attitude),
  mode: node.dataset.mode,
  armed: node.dataset.armed,
  landedState: node.dataset.landedState,
}));
const upload = (page, data) => page.locator('#sitl-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = sitlFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.positionNed).toEqual(frame.positionNed);
  // DOM data attributes round-trip through JSON, which serializes −0 as 0.
  expect(actual.positionEnu).toEqual(JSON.parse(JSON.stringify(frame.positionEnu)));
  expect(actual.attitude).toEqual(frame.attitude);
  expect(actual.mode).toBe(String(frame.mode));
  expect(actual.armed).toBe(String(frame.armed));
  expect(actual.landedState).toBe(String(frame.landedState));
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sitl/');
  await expect(page.locator('#sitl-viewport')).toHaveAttribute('data-case', nominal.id);
  await expect(page.locator('#sitl-case option')).toHaveCount(trace.cases.length);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('event stepping, recorded landmarks, case selection and reset preserve one telemetry cursor', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText(/ArduPilot SITL.*MAVLink/);
  await expect(page.locator('#sitl-provenance')).toContainText(trace.runtime.firmwareGitHash);
  await expect(page.locator('#sitl-provenance')).toContainText(trace.runtime.binarySha256);
  await expectFrame(page, nominal, 0);
  const first = sitlEvents(nominal).find(event => event.timeMs > 0);
  await page.locator('#sitl-step').click();
  await expectFrame(page, nominal, first.timeMs);
  await page.locator('#sitl-takeoff').click();
  await expectFrame(page, nominal, sitlSummary(nominal).takeoffAckMs);
  await page.locator('#sitl-height').click();
  await expectFrame(page, nominal, sitlSummary(nominal).takeoffReachedMs);
  await page.locator('#sitl-waypoint').click();
  await expectFrame(page, nominal, sitlSummary(nominal).waypointReachedMs);
  await page.locator('#sitl-landed').click();
  await expectFrame(page, nominal, sitlSummary(nominal).landedMs);
  await page.locator('#sitl-case').selectOption(rejected.id);
  await expectFrame(page, rejected, 0);
  await page.locator('#sitl-finish').click();
  await expectFrame(page, rejected, rejected.endMs);
  await expect(page.locator('#sitl-step')).toBeDisabled();
  await page.locator('#sitl-reset').click();
  await expectFrame(page, rejected, 0);
});

test('an accepted takeoff is visibly distinct from measured height and final landing', async ({ page }) => {
  await page.locator('#sitl-takeoff').click();
  const accepted = await expectFrame(page, nominal, sitlSummary(nominal).takeoffAckMs);
  expect(accepted.completedStages).not.toContain('takeoff');
  expect(accepted.outcome).toBeNull();
  await expect(page.locator('#sitl-commands')).toContainText(/ACCEPTED/i);
  await expect(page.locator('#sitl-commands tr')).toHaveCount(accepted.commands.length);
  await expect(page.locator('[data-command-event="waypoint"]')).toHaveCount(0);
  const lastEvent = JSON.parse(await page.locator('#sitl-envelope').textContent());
  expect(lastEvent.timeMs).toBeLessThanOrEqual(accepted.timeMs);
  await page.locator('#sitl-height').click();
  const airborne = await expectFrame(page, nominal, sitlSummary(nominal).takeoffReachedMs);
  expect(airborne.completedStages).toContain('takeoff');
  expect(airborne.armed).toBe(true);
  await page.locator('#sitl-landed').click();
  const landed = await expectFrame(page, nominal, sitlSummary(nominal).landedMs);
  expect(landed.armed).toBe(false);
  expect(landed.landedState).toBe(1);
  expect(landed.completedStages).toContain('land');
});

test('the position setpoint has no fabricated ACK and disarmed takeoff retains the observed rejection', async ({ page }) => {
  await page.locator('#sitl-waypoint').click();
  const frame = await expectFrame(page, nominal, sitlSummary(nominal).waypointReachedMs);
  const setpoint = frame.commandStates.find(item => item.admission === 'not-applicable');
  expect(setpoint).toBeTruthy();
  expect(setpoint.ack).toBeNull();
  await expect(page.locator('#sitl-commands')).toContainText(/SET_POSITION_TARGET_LOCAL_NED/);
  await expect(page.locator('#sitl-commands')).toContainText(/no.*ACK|not applicable/i);
  await page.locator('#sitl-inspect-rejection').click();
  const selected = await snapshot(page);
  const denied = await expectFrame(page, rejected, selected.timeMs);
  expect(denied.completedStages).not.toContain('takeoff');
  expect(denied.armed).toBe(false);
  await expect(page.locator('#sitl-commands')).toContainText(/FAILED/i);
  await expect(page.locator('#sitl-height')).toBeDisabled();
  await expect(page.locator('#sitl-waypoint')).toBeDisabled();
  await expect(page.locator('#sitl-landed')).toBeDisabled();
});

test('request inspection preserves exact envelopes and uses only evidence available at the selected time', async ({ page }) => {
  const takeoff = nominal.commands.find(item => item.id === 'takeoff');
  const takeoffAck = nominal.acks.find(item => item.commandId === 'takeoff');
  const readRequest = async () => JSON.parse(await page.locator('#sitl-request-envelope').textContent());
  await page.locator('#sitl-takeoff').click();
  await page.locator('[data-command-event="takeoff"]').click();
  await expectFrame(page, nominal, takeoffAck.timeMs);
  expect(await readRequest()).toEqual({ command: takeoff, ack: takeoffAck, completionEvent: null });
  await page.locator('#sitl-request-seek').click();
  await expectFrame(page, nominal, takeoff.timeMs);
  expect(await readRequest()).toEqual({ command: takeoff, ack: null, completionEvent: null });
  await page.locator('#sitl-height').click();
  const climbed = await expectFrame(page, nominal, sitlSummary(nominal).takeoffReachedMs);
  expect((await readRequest()).completionEvent).toEqual(nominal.events.find(item => item.stage === 'takeoff' && item.status === 'complete'));
  expect(Number(await page.locator('#sitl-height-error').getAttribute('data-value')))
    .toBeCloseTo(Math.abs(climbed.relativeAltitudeM - nominal.config.takeoffAltitudeM), 12);

  const waypoint = nominal.commands.find(item => item.id === 'waypoint');
  await page.locator('#sitl-waypoint').click();
  await page.locator('[data-command-event="waypoint"]').click();
  await page.locator('#sitl-request-seek').click();
  const moving = await expectFrame(page, nominal, waypoint.timeMs);
  expect(await readRequest()).toEqual({ command: waypoint, ack: null, completionEvent: null });
  const distance = Math.hypot(...moving.positionNed.map((value, axis) => value - waypoint.positionNed[axis]));
  expect(Number(await page.locator('#sitl-waypoint-error').getAttribute('data-value'))).toBeCloseTo(distance, 12);
  await expect(page.locator('#sitl-waypoint-error')).toHaveAttribute('data-historical', 'false');

  await page.locator('#sitl-landed').click();
  const landed = await expectFrame(page, nominal, sitlSummary(nominal).landedMs);
  const historicalDistance = Math.hypot(...landed.positionNed.map((value, axis) => value - waypoint.positionNed[axis]));
  expect(Number(await page.locator('#sitl-waypoint-error').getAttribute('data-value'))).toBeCloseTo(historicalDistance, 12);
  await expect(page.locator('#sitl-waypoint-error')).toHaveAttribute('data-historical', 'true');
  await expect(page.locator('#sitl-waypoint-error-label')).toContainText(/historical/i);
  await expect(page.locator('#sitl-waypoint-error-note')).toContainText(/not an active landing target/i);
});

test('2D, 3D, camera changes and WebGL loss preserve exact recorded position and attitude', async ({ page }) => {
  await page.locator('#sitl-inspect-flight').click();
  const before = await snapshot(page);
  expect(before.positionNed).not.toBeNull();
  await page.locator('#sitl-2d').click();
  await expect(page.locator('#sitl-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#sitl-3d').click();
  const canvas = page.locator('#sitl-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#sitl-camera-close').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#sitl-camera-yard').click();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#sitl-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('playback speed changes replay time only and pause keeps the received samples fixed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#sitl-speed').selectOption('4');
  await page.locator('#sitl-play').click();
  await page.clock.runFor(350);
  await page.locator('#sitl-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, nominal, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#sitl-reset').click();
  await expectFrame(page, nominal, 0);
});

test('invalid JSON and forged telemetry preserve the selected trace and cursor', async ({ page }) => {
  await page.locator('#sitl-takeoff').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#sitl-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases[0].telemetry[0].sourceSystem = 42;
  await upload(page, forged);
  await expect(page.locator('#sitl-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#sitl-height').click();
  await expectFrame(page, nominal, sitlSummary(nominal).takeoffReachedMs);
});

test('imported case labels stay plain text and a single recording can be restored to the bundled pair', async ({ page }) => {
  const imported = structuredClone(trace);
  imported.cases = [imported.cases.find(run => run.id === nominal.id)];
  const run = imported.cases[0];
  const label = '<img id="sitl-injected" src=x onerror="window.__sitlInjected=true">';
  run.label = label;
  await upload(page, imported);
  await expect(page.locator('#sitl-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#sitl-case option')).toHaveCount(1);
  await expect(page.locator('#sitl-case option')).toContainText(label);
  await expect(page.locator('#sitl-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sitlInjected)).toBeUndefined();
  await page.locator('#sitl-takeoff').click();
  await expectFrame(page, run, sitlSummary(run).takeoffAckMs);
  await page.locator('#sitl-bundled').click();
  await expectFrame(page, nominal, 0);
  await expect(page.locator('#sitl-case option')).toHaveCount(2);
});

test('a 390px screen without WebGL retains flight evidence, controls and navigation without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#sitl-viewport')).toHaveAttribute('data-case', nominal.id);
  await expect(page.locator('#sitl-viewport svg')).toBeVisible();
  await page.locator('#sitl-height').click();
  const frame = await expectFrame(page, nominal, sitlSummary(nominal).takeoffReachedMs);
  expect(frame.completedStages).toContain('takeoff');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link', { name: /18.*ArduPilot.*MAVLink/i })).toBeVisible();
  await page.locator('#sitl-case').selectOption(rejected.id);
  await page.locator('#sitl-finish').click();
  expect((await expectFrame(page, rejected, rejected.endMs)).completedStages).not.toContain('takeoff');
});
