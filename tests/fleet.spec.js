import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { fleetEvents, fleetFrame, fleetSummary } from '../src/fleet-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-fleet.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const misaddressed = trace.cases.find(run => run.id === 'misaddressed');
const errorsByPage = new WeakMap();
const serializable = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.locator('#fleet-viewport').evaluate(node => ({
  caseId: node.dataset.case, timeMs: Number(node.dataset.timeMs),
  vehicles: JSON.parse(node.dataset.vehicles),
  tasksCompleted: Number(node.dataset.tasksCompleted), landedVehicles: Number(node.dataset.landedVehicles),
}));
const upload = (page, data) => page.locator('#fleet-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});
const seek = (page, timeMs) => page.locator('#fleet-time-slider').evaluate((node, value) => {
  node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
}, timeMs);
const dispatchMs = run => Math.max(...fleetSummary(run).vehicles.map(vehicle => vehicle.waypointSentMs));
const readJson = async (page, selector) => JSON.parse(await page.locator(selector).textContent());

async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = fleetFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id);
  expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.vehicles).toEqual(serializable(frame.vehicles.map(vehicle => ({
    id: vehicle.id, positionEnu: vehicle.positionEnu, positionNed: vehicle.positionNed,
    attitude: vehicle.attitude, mode: vehicle.mode, armed: vehicle.armed, taskState: vehicle.taskState,
  }))));
  expect(actual.tasksCompleted).toBe(frame.tasksCompleted);
  expect(actual.landedVehicles).toBe(frame.landedVehicles);
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/fleet/');
  await expect(page.locator('#fleet-case option')).toHaveCount(trace.cases.length);
  await page.locator('#fleet-case').selectOption(misaddressed.id);
  await expect(page.locator('#fleet-viewport')).toHaveAttribute('data-case', misaddressed.id);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('event stepping and recorded milestones keep both vehicles on one exact cursor', async ({ page }) => {
  const summary = fleetSummary(misaddressed);
  await expect(page.locator('.method-profile')).toContainText('Nearest-pair greedy');
  await expectFrame(page, misaddressed, 0);
  await page.locator('#fleet-step').click();
  await expectFrame(page, misaddressed, fleetEvents(misaddressed).find(event => event.timeMs > 0).timeMs);
  const takeoffMs = Math.max(...misaddressed.vehicles.map(vehicle => vehicle.events.find(event => event.stage === 'takeoff' && event.status === 'complete').timeMs));
  const arrivalMs = Math.min(...summary.vehicles.map(vehicle => vehicle.taskCompletedMs).filter(value => value !== null));
  for (const [button, timeMs] of [['takeoff', takeoffMs], ['dispatch', dispatchMs(misaddressed)], ['arrival', arrivalMs],
    ['deadline', summary.deadlineMs], ['landed', summary.landedMs], ['finish', misaddressed.endMs]]) {
    await page.locator(`#fleet-${button}`).click();
    await expectFrame(page, misaddressed, timeMs);
  }
  await expect(page.locator('#fleet-step')).toBeDisabled();
  await page.locator('#fleet-reset').click();
  await expectFrame(page, misaddressed, 0);
});

test('A1 route mismatch has no setpoint ACK and A2 inspection retains its separate request', async ({ page }) => {
  await page.locator('#fleet-dispatch').click();
  const before = await snapshot(page);
  const frame = await expectFrame(page, misaddressed, dispatchMs(misaddressed));
  expect(frame.tasksCompleted).toBe(0);
  await expect(page.locator('#fleet-routing')).toHaveAttribute('data-mismatch', 'true');
  await expect(page.locator('#fleet-route-title')).toContainText('TCP 5760');
  await expect(page.locator('#fleet-route-title')).toContainText('target 2:1');
  await page.locator('[data-fleet-command="waypoint"]').click();
  const a1 = misaddressed.vehicles[0], a2 = misaddressed.vehicles[1];
  expect(await readJson(page, '#fleet-request-envelope')).toEqual({
    command: a1.commands.find(command => command.id === 'waypoint'), ack: null, completion: null,
  });
  await expect(page.locator('#fleet-command-rows')).toContainText('No ACK by protocol');
  await page.locator('#fleet-vehicle').selectOption('A2');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#fleet-viewport')).toHaveAttribute('data-selected', 'A2');
  await expect(page.locator('#fleet-routing')).toHaveAttribute('data-mismatch', 'false');
  await expect(page.locator('#fleet-route-title')).toContainText('TCP 5770');
  expect(await readJson(page, '#fleet-request-envelope')).toEqual({
    command: a2.commands.find(command => command.id === 'waypoint'), ack: null, completion: null,
  });
  const position = await readJson(page, '#fleet-position-envelope');
  expect(position.route).toEqual({ vehicleId: 'A2', systemId: 2, componentId: 1, host: '127.0.0.1', port: 5770 });
  expect(position.sample.sourceSystem).toBe(2);
});

test('the exact task deadline exposes partial work and later landing cannot change that result', async ({ page }) => {
  await page.locator('#fleet-deadline').click();
  const deadline = await expectFrame(page, misaddressed, misaddressed.missionDeadlineMs);
  expect(deadline.tasksCompleted).toBe(1);
  expect(deadline.landedVehicles).toBe(0);
  expect(deadline.vehicles[0].taskState).toBe('not-reached');
  expect(deadline.vehicles.every(vehicle => !vehicle.commands.some(command => command.id === 'land'))).toBe(true);
  await expect(page.locator('#fleet-outcome')).toContainText('Partial mission');
  await expect(page.locator('#fleet-task-rows [data-task="T1"] [data-state]')).toHaveAttribute('data-state', 'missed');
  await page.locator('#fleet-landed').click();
  const cleaned = await expectFrame(page, misaddressed, fleetSummary(misaddressed).landedMs);
  expect(cleaned.tasksCompleted).toBe(1);
  expect(cleaned.landedVehicles).toBe(2);
  await expect(page.locator('#fleet-tasks-count')).toHaveText('1 / 2');
  await expect(page.locator('#fleet-landing-count')).toHaveText('2 / 2');
  await expect(page.locator('#fleet-outcome')).toContainText('Partial mission');
  await page.locator('#fleet-case').selectOption(nominal.id);
  await expectFrame(page, nominal, 0);
  await page.locator('#fleet-finish').click();
  const correct = await expectFrame(page, nominal, nominal.endMs);
  expect(correct.tasksCompleted).toBe(2);
  expect(correct.landedVehicles).toBe(2);
  await expect(page.locator('#fleet-outcome')).toHaveText('Completed');
});

test('allocation and per-vehicle inspectors preserve raw evidence and withhold future observations', async ({ page }) => {
  expect(await readJson(page, '#fleet-allocation-envelope')).toBeNull();
  await expect(page.locator('#fleet-cost-rows')).toContainText('Not observed');
  expect((await readJson(page, '#fleet-position-envelope')).sample).toBeNull();
  await page.locator('.fleet-provenance > summary').click();
  await expect(page.locator('#fleet-provenance')).toContainText(trace.runtime.firmwareGitHash);
  await expect(page.locator('#fleet-provenance')).toContainText(trace.runtime.binarySha256);
  await page.locator('#fleet-dispatch').click();
  expect(await readJson(page, '#fleet-allocation-envelope')).toEqual({ timeMs: misaddressed.assignmentTimeMs, assignments: misaddressed.assignments });
  const frame = await expectFrame(page, misaddressed, dispatchMs(misaddressed));
  expect((await readJson(page, '#fleet-position-envelope')).sample).toEqual(frame.vehicles[0].latest.LOCAL_POSITION_NED);
  expect((await readJson(page, '#fleet-heartbeat-envelope')).sample).toEqual(frame.vehicles[0].latest.HEARTBEAT);
  await expect(page.locator('[data-fleet-command="land"]')).toHaveCount(0);
  await page.locator('#fleet-vehicle').selectOption('A2');
  await page.locator('#fleet-arrival').click();
  const timeMs = Math.min(...fleetSummary(misaddressed).vehicles.map(vehicle => vehicle.taskCompletedMs).filter(value => value !== null));
  await expectFrame(page, misaddressed, timeMs);
  await page.locator('[data-fleet-command="waypoint"]').click();
  const request = await readJson(page, '#fleet-request-envelope');
  expect(request.command).toEqual(misaddressed.vehicles[1].commands.find(command => command.id === 'waypoint'));
  expect(request.ack).toBeNull();
  expect(request.completion).toEqual(misaddressed.vehicles[1].events.find(event => event.stage === 'waypoint' && event.status === 'complete'));
});

test('2D, 3D, follow selection and WebGL loss preserve both received poses and the shared time', async ({ page }) => {
  await page.locator('#fleet-arrival').click();
  const before = await snapshot(page);
  expect(before.vehicles.every(vehicle => vehicle.positionEnu !== null)).toBe(true);
  await page.locator('#fleet-2d').click();
  await expect(page.locator('#fleet-viewport svg')).toBeVisible();
  for (const vehicle of before.vehicles) expect(JSON.parse(await page.locator(`[data-fleet-svg-vehicle="${vehicle.id}"]`).getAttribute('data-position'))).toEqual(vehicle.positionEnu);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#fleet-3d').click();
  const canvas = page.locator('#fleet-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#fleet-camera-close').click();
  await page.locator('#fleet-vehicle').selectOption('A2');
  await expect(page.locator('#fleet-camera-close')).toContainText('A2');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#fleet-camera-yard').click();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#fleet-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('playback speed, pause and scrubbing move only the recorded shared cursor', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#fleet-speed').selectOption('4');
  await page.locator('#fleet-play').click();
  await page.clock.runFor(350);
  await page.locator('#fleet-play').click();
  const paused = await snapshot(page);
  expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, misaddressed, paused.timeMs);
  await page.clock.runFor(500);
  expect(await snapshot(page)).toEqual(paused);
  const timeMs = Math.floor(misaddressed.endMs / 2);
  await seek(page, timeMs);
  await expectFrame(page, misaddressed, timeMs);
});

test('invalid JSON and crossed source identities preserve the recording, selected vehicle and cursor', async ({ page }) => {
  await page.locator('#fleet-arrival').click();
  await page.locator('#fleet-vehicle').selectOption('A2');
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":');
  await expect(page.locator('#fleet-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace);
  forged.cases[0].vehicles[0].telemetry[0].sourceSystem = 2;
  await upload(page, forged);
  await expect(page.locator('#fleet-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#fleet-vehicle')).toHaveValue('A2');
});

test('single-case imports render labels as plain text and restore the bundled pair', async ({ page }) => {
  const imported = structuredClone(trace);
  imported.cases = [imported.cases.find(run => run.id === 'nominal')];
  const label = '<img id="fleet-injected" src=x onerror="window.__fleetInjected=true">';
  imported.cases[0].label = label;
  await upload(page, imported);
  await expect(page.locator('#fleet-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#fleet-case option')).toHaveCount(1);
  await expect(page.locator('#fleet-case option')).toContainText(label);
  await expect(page.locator('#fleet-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__fleetInjected)).toBeUndefined();
  await expectFrame(page, imported.cases[0], 0);
  await page.locator('#fleet-bundled').click();
  await expect(page.locator('#fleet-case option')).toHaveCount(trace.cases.length);
  await expectFrame(page, misaddressed, 0);
});

test('390px without WebGL retains both vehicle streams, outcomes and all twenty-three workshop links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...args);
    };
  });
  await page.reload();
  await page.locator('#fleet-case').selectOption(misaddressed.id);
  await expect(page.locator('#fleet-viewport svg')).toBeVisible();
  await page.locator('#fleet-dispatch').click();
  await expectFrame(page, misaddressed, dispatchMs(misaddressed));
  await page.locator('#fleet-vehicle').selectOption('A2');
  await expect(page.locator('#fleet-route-title')).toContainText('TCP 5770');
  await page.locator('#fleet-landed').click();
  const frame = await expectFrame(page, misaddressed, fleetSummary(misaddressed).landedMs);
  expect(frame.tasksCompleted).toBe(1);
  expect(frame.landedVehicles).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).locator('option')).toHaveCount(23);
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toBeVisible();
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true })).toHaveValue('/fleet/');
});
