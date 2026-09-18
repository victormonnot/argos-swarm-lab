import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { gazeboEvents, gazeboFrame, gazeboSummary } from '../src/gazebo-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-gazebo.json', import.meta.url), 'utf8'));
const pulse = trace.cases.find(run => run.id === 'pulse');
const nominal = trace.cases.find(run => run.id === 'nominal');
const errorsByPage = new WeakMap();
const serializable = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.locator('#gazebo-viewport').evaluate(node => ({
  caseId: node.dataset.case,
  timeMs: Number(node.dataset.timeMs),
  truthPosition: JSON.parse(node.dataset.truthPosition),
  estimatePosition: JSON.parse(node.dataset.estimatePosition),
  forceEnu: JSON.parse(node.dataset.forceEnu),
  pulsePhase: node.dataset.pulsePhase,
}));
const upload = (page, data) => page.locator('#gazebo-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});

async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = gazeboFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.truthPosition).toEqual(serializable(frame.truth?.positionEnu ?? null));
  expect(actual.estimatePosition).toEqual(serializable(frame.estimate?.positionEnu ?? null));
  expect(actual.forceEnu).toEqual(serializable(frame.forceEnu));
  expect(actual.pulsePhase).toBe(frame.pulsePhase);
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/gazebo/');
  await expect(page.locator('#gazebo-case option')).toHaveCount(trace.cases.length);
  await page.locator('#gazebo-case').selectOption(pulse.id);
  await expect(page.locator('#gazebo-viewport')).toHaveAttribute('data-case', pulse.id);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('recorded event stepping and physical landmarks keep one exact shared cursor', async ({ page }) => {
  const summary = gazeboSummary(pulse);
  await expect(page.locator('.method-profile')).toContainText(/Gazebo.*ArduPilot/);
  await expectFrame(page, pulse, 0);
  const first = gazeboEvents(pulse).find(event => event.timeMs > 0);
  await page.locator('#gazebo-step').click();
  await expectFrame(page, pulse, first.timeMs);
  await page.locator('#gazebo-hover').click();
  await expectFrame(page, pulse, summary.hoverStartMs);
  await page.locator('#gazebo-pulse').click();
  await expectFrame(page, pulse, summary.pulseStartMs);
  await page.locator('#gazebo-release').click();
  await expectFrame(page, pulse, summary.pulseEndMs);
  if (summary.recoveryMs !== null) {
    await page.locator('#gazebo-recovery').click();
    await expectFrame(page, pulse, summary.recoveryMs);
  } else await expect(page.locator('#gazebo-recovery')).toBeDisabled();
  await page.locator('#gazebo-finish').click();
  await expectFrame(page, pulse, pulse.endMs);
  await expect(page.locator('#gazebo-step')).toBeDisabled();
  await page.locator('#gazebo-reset').click();
  await expectFrame(page, pulse, 0);
});

test('the applied force, its release and recovery evidence are visibly distinct from a flight ACK', async ({ page }) => {
  const summary = gazeboSummary(pulse);
  await page.locator('#gazebo-pulse').click();
  const active = await expectFrame(page, pulse, summary.pulseStartMs);
  expect(active.truth.pulseActive).toBe(true);
  expect(active.forceEnu).toEqual([8, 0, 0]);
  expect(active.recovery).toBeNull();
  expect(active.completedStages).toContain('takeoff');
  expect(active.completedStages).not.toContain('land');
  await expect(page.locator('#gazebo-force-vector')).toContainText('8');
  await expect(page.locator('#gazebo-force-vector')).toContainText('N');
  await expect(page.locator('#gazebo-commands')).toContainText(/accepted/i);
  await page.locator('#gazebo-release').click();
  const released = await expectFrame(page, pulse, summary.pulseEndMs);
  expect(released.truth.pulseActive).toBe(false);
  expect(released.forceEnu).toEqual([0, 0, 0]);
  expect(released.recovery).toBeNull();
  await page.locator('#gazebo-finish').click();
  const done = await expectFrame(page, pulse, pulse.endMs);
  expect(done.completedStages).toContain('land');
  expect(done.armed).toBe(false);
  await expect(page.locator('#gazebo-outcome')).toContainText(/completed|landed/i);
});

test('baseline selection removes the disturbance and rewinds the independent recording', async ({ page }) => {
  await page.locator('#gazebo-pulse').click();
  await page.locator('#gazebo-case').selectOption(nominal.id);
  await expectFrame(page, nominal, 0);
  await expect(page.locator('#gazebo-pulse')).toBeDisabled();
  await expect(page.locator('#gazebo-release')).toBeDisabled();
  await expect(page.locator('#gazebo-recovery')).toBeDisabled();
  await page.locator('#gazebo-finish').click();
  const frame = await expectFrame(page, nominal, nominal.endMs);
  expect(frame.forceEnu).toEqual([0, 0, 0]);
  expect(frame.recovery).toBeNull();
  await expect(page.locator('#gazebo-comparison tr')).toHaveCount(trace.cases.length);
});

test('2D, 3D, overlays, camera changes and WebGL loss preserve the same physical state', async ({ page }) => {
  await page.locator('#gazebo-pulse').click();
  const before = await snapshot(page);
  expect(before.truthPosition).not.toBeNull();
  expect(before.estimatePosition).not.toBeNull();
  await page.locator('#gazebo-2d').click();
  await expect(page.locator('#gazebo-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  const marker = page.locator('[data-gazebo-pose="truth"]');
  expect(JSON.parse(await marker.getAttribute('data-position'))).toEqual(before.truthPosition);
  await page.locator('#gazebo-show-estimate').uncheck();
  await expect(page.locator('#gazebo-viewport')).toHaveAttribute('data-show-estimate', 'false');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#gazebo-show-estimate').check();
  await page.locator('#gazebo-show-trails').uncheck();
  await expect(page.locator('#gazebo-viewport')).toHaveAttribute('data-show-trails', 'false');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#gazebo-show-trails').check();
  await page.locator('#gazebo-3d').click();
  const canvas = page.locator('#gazebo-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#gazebo-camera-close').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#gazebo-camera-yard').click();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#gazebo-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('clock and alignment inspectors expose independently received estimates and simulator truth', async ({ page }) => {
  await page.locator('#gazebo-release').click();
  const selected = await snapshot(page), frame = await expectFrame(page, pulse, selected.timeMs);
  await expect(page.locator('#gazebo-receipt-clock')).toContainText((frame.timeMs / 1000).toFixed(3));
  await expect(page.locator('#gazebo-sim-clock')).toContainText((frame.simTimeMs / 1000).toFixed(3));
  expect(frame.truthAgeMs).toBeGreaterThanOrEqual(0);
  expect(frame.estimateAgeMs).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#gazebo-transform-note')).toContainText(/NED|ENU/);
  await page.locator('.gazebo-provenance > summary').click();
  await expect(page.locator('#gazebo-provenance')).toContainText(trace.runtime.firmwareGitHash);
  await expect(page.locator('#gazebo-provenance')).toContainText(trace.runtime.pluginGitHash);
  await expect(page.locator('#gazebo-provenance')).toContainText(trace.runtime.sourceSha256);
});

test('playback and scrubbing change the recorded cursor without altering measured physics', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#gazebo-speed').selectOption('4');
  await page.locator('#gazebo-play').click();
  await page.clock.runFor(350);
  await page.locator('#gazebo-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, pulse, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  const sought = Math.floor(pulse.endMs / 2);
  await page.locator('#gazebo-time-slider').evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, sought);
  await expectFrame(page, pulse, sought);
});

test('invalid JSON and forged physical evidence leave the existing recording and cursor intact', async ({ page }) => {
  await page.locator('#gazebo-pulse').click();
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#gazebo-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases.find(run => run.id === 'pulse').truth.at(-1).impulseNs[0] = 800;
  await upload(page, forged);
  await expect(page.locator('#gazebo-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
});

test('a valid single-case import keeps labels as text and can restore the bundled comparison', async ({ page }) => {
  const imported = structuredClone(trace);
  imported.cases = [imported.cases.find(run => run.id === 'pulse')];
  const label = '<img id="gazebo-injected" src=x onerror="window.__gazeboInjected=true">';
  imported.cases[0].label = label;
  await upload(page, imported);
  await expect(page.locator('#gazebo-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#gazebo-case option')).toHaveCount(1);
  await expect(page.locator('#gazebo-case option')).toContainText(label);
  await expect(page.locator('#gazebo-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__gazeboInjected)).toBeUndefined();
  await expectFrame(page, imported.cases[0], 0);
  await page.locator('#gazebo-bundled').click();
  await expect(page.locator('#gazebo-case option')).toHaveCount(trace.cases.length);
  const current = await snapshot(page);
  await expectFrame(page, trace.cases.find(run => run.id === current.caseId), 0);
});

test('a 390px viewport without WebGL preserves flight evidence, controls and all workshop links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await page.locator('#gazebo-case').selectOption(pulse.id);
  await expect(page.locator('#gazebo-viewport svg')).toBeVisible();
  await page.locator('#gazebo-pulse').click();
  const frame = await expectFrame(page, pulse, gazeboSummary(pulse).pulseStartMs);
  expect(frame.truth.pulseActive).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(19);
  await expect(navigation.getByRole('link', { name: /19.*Gazebo/i })).toHaveAttribute('aria-current', 'page');
});
