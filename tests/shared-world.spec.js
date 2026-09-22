import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { sharedWorldEvents, sharedWorldFrame, sharedWorldSummary } from '../src/shared-world-trace.js';

const trace = JSON.parse(readFileSync(new URL('../docs/results/ardupilot-shared-world.json', import.meta.url), 'utf8'));
const nominal = trace.cases.find(run => run.id === 'nominal');
const withdrawal = trace.cases.find(run => run.id === 'withdrawal');
const errorsByPage = new WeakMap();
const serializable = value => JSON.parse(JSON.stringify(value));
const snapshot = page => page.locator('#shared-world-viewport').evaluate(node => ({
  caseId: node.dataset.case, timeMs: Number(node.dataset.timeMs),
  vehicles: JSON.parse(node.dataset.vehicles), tasks: JSON.parse(node.dataset.tasks),
  world: JSON.parse(node.dataset.world),
  tasksCompleted: Number(node.dataset.tasksCompleted), landedVehicles: Number(node.dataset.landedVehicles),
}));
const upload = (page, data) => page.locator('#shared-world-import').setInputFiles({
  name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
});
const readJson = async (page, selector) => JSON.parse(await page.locator(selector).textContent());
const seek = (page, timeMs) => page.locator('#shared-world-time-slider').evaluate((node, value) => {
  node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
}, timeMs);
async function expectFrame(page, run, timeMs) {
  const actual = await snapshot(page), frame = sharedWorldFrame(run, actual.timeMs);
  expect(actual.caseId).toBe(run.id); expect(actual.timeMs).toBeCloseTo(timeMs, 6);
  expect(actual.vehicles).toEqual(serializable(frame.vehicles.map(vehicle => ({
    id: vehicle.id, positionEnu: vehicle.positionEnu, estimatePositionWorldEnu: vehicle.estimatePositionWorldEnu,
    worldPositionEnu: vehicle.worldPositionEnu, positionNed: vehicle.positionNed,
    attitude: vehicle.attitude, worldOrientationXyzw: vehicle.worldOrientationXyzw, mode: vehicle.mode, armed: vehicle.armed,
    taskId: vehicle.taskId, retiring: vehicle.taskState === 'locked',
  }))));
  expect(actual.tasks).toEqual(serializable(frame.tasks));
  expect(actual.world).toEqual(serializable(frame.world));
  expect(actual.tasksCompleted).toBe(frame.tasksCompleted);
  expect(actual.landedVehicles).toBe(frame.landedVehicles);
  return frame;
}

test.beforeEach(async ({ page }) => {
  const errors = []; errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/shared-world/');
  await expect(page.locator('#shared-world-case option')).toHaveCount(trace.cases.length);
  await page.locator('#shared-world-case').selectOption(withdrawal.id);
  await expect(page.locator('#shared-world-viewport')).toHaveAttribute('data-case', withdrawal.id);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('recorded milestones and event steps retain a common three-vehicle cursor', async ({ page }) => {
  const summary = sharedWorldSummary(withdrawal), old = withdrawal.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  const lockedTime = withdrawal.btTicks.find(tick => tick.timeMs >= old.cancelledTimeMs).timeMs;
  await expect(page.locator('.method-profile')).toContainText(/nearest-pair greedy/i);
  await expect(page.locator('.method-profile')).toContainText('Reactive fallback');
  await expectFrame(page, withdrawal, 0);
  await page.locator('#shared-world-step').click();
  await expectFrame(page, withdrawal, sharedWorldEvents(withdrawal).find(event => event.timeMs > 0).timeMs);
  for (const [id, time] of [['dispatch', summary.firstDispatchMs], ['withdraw', summary.withdrawalMs],
    ['locked', lockedTime], ['release', summary.releaseMs], ['reassign', summary.reassignmentMs],
    ['complete', summary.missionCompletedMs], ['landed', summary.landedMs], ['finish', withdrawal.endMs]]) {
    await page.locator(`#shared-world-${id}`).click(); await expectFrame(page, withdrawal, time);
  }
  await expect(page.locator('#shared-world-step')).toBeDisabled();
  await page.locator('#shared-world-reset').click(); await expectFrame(page, withdrawal, 0);
});

test('the interrupted task stays locked to A1 until landing, then a different attempt gets a new owner', async ({ page }) => {
  const old = withdrawal.attempts.find(attempt => attempt.cancelledTimeMs !== null);
  const next = withdrawal.attempts.find(attempt => attempt.taskId === old.taskId && attempt.id !== old.id);
  const task = page.locator(`#shared-world-task-rows tr[data-task="${old.taskId}"]`);
  await page.locator('#shared-world-locked').click();
  await expect(task.locator('[data-state]')).toHaveAttribute('data-state', 'locked');
  await expect(task).toContainText('A1');
  await expect(page.locator('#shared-world-handover')).toHaveAttribute('data-state', 'locked');
  await expect(page.locator('#shared-world-tree [data-node="withdrawRequested"]')).toHaveAttribute('data-status', 'SUCCESS');
  await expect(page.locator('#shared-world-tree [data-node="task"]')).toHaveAttribute('data-status', 'IDLE');
  await expect(page.locator('#shared-world-tree [data-node="task"]')).toHaveAttribute('data-halted', 'true');
  const tree = await readJson(page, '#shared-world-tree-envelope');
  expect(tree.halts.some(row => row.attemptId === old.id)).toBe(true);
  expect(tree.actions.some(row => row.commandId === 'land')).toBe(true);
  await page.locator('#shared-world-release').click();
  await expect(task.locator('[data-state]')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#shared-world-handover')).toHaveAttribute('data-state', 'released');
  await page.locator('#shared-world-reassign').click();
  await expect(page.locator('#shared-world-handover')).toHaveAttribute('data-state', 'reassigned');
  await expect(task).toContainText(next.vehicleId);
  await expect(task).toContainText(next.id);
  const ledger = await readJson(page, '#shared-world-ledger-envelope');
  expect(ledger.attempts.find(row => row.id === old.id).status).toBe('cancelled');
  expect(ledger.attempts.find(row => row.id === next.id).status).toBe('assigned');
});

test('six tasks done differs from all landed, and baseline disables withdrawal-only milestones', async ({ page }) => {
  await page.locator('#shared-world-complete').click();
  const completed = await expectFrame(page, withdrawal, withdrawal.missionCompletedMs);
  expect(completed.tasksCompleted).toBe(6); expect(completed.landedVehicles).toBeLessThan(3);
  await expect(page.locator('#shared-world-tasks-count')).toHaveText('6 / 6');
  await expect(page.locator('#shared-world-phase-note')).toContainText('Landing cleanup is separate');
  await page.locator('#shared-world-landed').click();
  await expect(page.locator('#shared-world-landing-count')).toHaveText('3 / 3');
  await expect(page.locator('#shared-world-tasks-count')).toHaveText('6 / 6');
  await page.locator('#shared-world-case').selectOption('nominal');
  await expectFrame(page, nominal, 0);
  for (const id of ['withdraw', 'locked', 'release', 'reassign']) await expect(page.locator(`#shared-world-${id}`)).toBeDisabled();
  await page.locator('#shared-world-finish').click();
  await expectFrame(page, nominal, nominal.endMs);
});

test('per-vehicle command, pose and tree inspectors use only that cursor and never invent setpoint ACKs', async ({ page }) => {
  expect(await readJson(page, '#shared-world-tree-envelope')).toBeNull();
  expect(await readJson(page, '#shared-world-request-envelope')).toBeNull();
  expect((await readJson(page, '#shared-world-ledger-envelope')).attempts).toEqual([]);
  await page.locator('#shared-world-complete').click();
  const before = await snapshot(page);
  await page.locator('#shared-world-vehicle').selectOption('A3');
  expect(await snapshot(page)).toEqual(before);
  const raw = withdrawal.vehicles[2], command = raw.commands.find(row => row.kind === 'setpoint');
  await page.locator(`[data-shared-world-command="${command.id}"]`).click();
  const request = await readJson(page, '#shared-world-request-envelope');
  expect(request.command).toEqual(command); expect(request.ack).toBeNull();
  expect(request.attempt.vehicleId).toBe('A3');
  const position = await readJson(page, '#shared-world-position-envelope');
  expect(position.localPosition.sourceSystem).toBe(3);
  expect(position.localPosition.timeMs).toBeLessThanOrEqual(before.timeMs);
  const tree = await readJson(page, '#shared-world-tree-envelope');
  expect(tree.vehicleId).toBe('A3'); expect(tree.timeMs).toBeLessThanOrEqual(before.timeMs);
  await page.locator('#shared-world-reset').click();
  expect(await readJson(page, '#shared-world-tree-envelope')).toBeNull();
  expect((await readJson(page, '#shared-world-ledger-envelope')).taskEvents).toEqual([]);
  await expect(page.locator('#shared-world-handover')).toHaveAttribute('data-state', 'waiting');
});

test('2D, volumetric 3D, all follow cameras and WebGL loss retain the same three poses', async ({ page }) => {
  await page.locator('#shared-world-locked').click(); const before = await snapshot(page);
  expect(before.vehicles.every(vehicle => vehicle.positionEnu !== null)).toBe(true);
  await page.locator('#shared-world-2d').click(); await expect(page.locator('#shared-world-viewport svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#shared-world-3d').click(); const canvas = page.locator('#shared-world-viewport canvas'); await expect(canvas).toBeVisible();
  for (const id of ['A1', 'A2', 'A3']) {
    await page.locator('#shared-world-vehicle').selectOption(id);
    await page.locator('#shared-world-camera-close').click();
    await expect(page.locator('#shared-world-camera-close')).toContainText(id);
    expect(await snapshot(page)).toEqual(before);
  }
  await page.locator('#shared-world-camera-yard').click(); expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('#shared-world-viewport svg')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
});

test('world and estimate layers show distinct recorded poses while preserving the mission cursor', async ({ page }) => {
  await page.locator('#shared-world-locked').click();
  await page.locator('#shared-world-2d').click();
  const before = await snapshot(page);
  expect(before.vehicles.every(vehicle => vehicle.worldPositionEnu && vehicle.estimatePositionWorldEnu)).toBe(true);
  for (const source of ['world', 'estimate', 'both']) {
    await page.locator('#shared-world-pose-source').selectOption(source);
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('#shared-world-viewport')).toHaveAttribute('data-pose-source', source);
    for (const vehicle of before.vehicles) for (const kind of ['world', 'estimate']) {
      const marker = page.locator(`[data-shared-world-svg-vehicle="${vehicle.id}"][data-pose="${kind}"]`);
      if (source !== 'both' && source !== kind) await expect(marker).toHaveCount(0);
      else {
        await expect(marker).toHaveCount(1);
        expect(JSON.parse(await marker.getAttribute('data-position')))
          .toEqual(kind === 'world' ? vehicle.worldPositionEnu : vehicle.estimatePositionWorldEnu);
      }
    }
  }
  await page.locator('#shared-world-3d').click();
  await expect(page.locator('#shared-world-viewport canvas')).toBeVisible();
  for (const source of ['world', 'estimate', 'both']) {
    await page.locator('#shared-world-pose-source').selectOption(source);
    expect(await snapshot(page)).toEqual(before);
  }
});

test('world timestamps, simultaneous pair distances and cumulative contacts rewind without future evidence', async ({ page }) => {
  await expect(page.locator('#shared-world-contact-count')).toHaveText('No contact evidence');
  await expect(page.locator('#shared-world-sim-time')).toHaveText('No world sample');
  expect((await readJson(page, '#shared-world-world-envelope')).contactTotals).toBeNull();
  const middle = withdrawal.truth[Math.floor(withdrawal.truth.length / 2)];
  const cursor = Math.ceil(middle.timeMs);
  await seek(page, cursor);
  const frame = await expectFrame(page, withdrawal, cursor);
  expect(await readJson(page, '#shared-world-world-envelope')).toEqual(serializable(frame.world));
  await expect(page.locator('#shared-world-pair-rows tr')).toHaveCount(3);
  for (const pair of frame.world.pairs) {
    const row = page.locator(`#shared-world-pair-rows [data-pair="${pair.vehicleIds.join('-')}"]`);
    await expect(row).toContainText(pair.distanceM.toFixed(3));
  }
  await expect(page.locator('#shared-world-contacts-explanation')).toContainText('physics steps');
  await page.locator('#shared-world-finish').click();
  expect((await readJson(page, '#shared-world-world-envelope')).contactTotals)
    .toEqual(withdrawal.truth.at(-1).contactTotals);
  await seek(page, cursor);
  expect(await readJson(page, '#shared-world-world-envelope')).toEqual(serializable(frame.world));
  await page.locator('#shared-world-reset').click();
  expect((await readJson(page, '#shared-world-world-envelope')).contactHistory).toEqual([]);
  await expect(page.locator('#shared-world-contact-count')).toHaveText('No contact evidence');
});

test('playback, pause and scrub advance only the recorded cursor', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#shared-world-speed').selectOption('4'); await page.locator('#shared-world-play').click();
  await page.clock.runFor(350); await page.locator('#shared-world-play').click();
  const paused = await snapshot(page); expect(paused.timeMs).toBeGreaterThan(0);
  await expectFrame(page, withdrawal, paused.timeMs);
  await page.clock.runFor(500); expect(await snapshot(page)).toEqual(paused);
  const cursor = Math.floor(withdrawal.endMs / 2); await seek(page, cursor); await expectFrame(page, withdrawal, cursor);
});

test('invalid JSON and forged ownership preserve the recording, selection and cursor', async ({ page }) => {
  await page.locator('#shared-world-locked').click(); await page.locator('#shared-world-vehicle').selectOption('A3');
  const before = await snapshot(page);
  await upload(page, '{"schemaVersion":'); await expect(page.locator('#shared-world-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
  const forged = structuredClone(trace), run = forged.cases.find(row => row.id === 'withdrawal');
  const old = run.attempts.find(attempt => attempt.cancelledTimeMs !== null); old.releasedTimeMs = old.cancelledTimeMs;
  await upload(page, forged); await expect(page.locator('#shared-world-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before); await expect(page.locator('#shared-world-vehicle')).toHaveValue('A3');
  const worldForgery = structuredClone(trace); worldForgery.cases[0].truth[1].collisionCount = 0;
  await upload(page, worldForgery); await expect(page.locator('#shared-world-import-status')).toHaveAttribute('data-error', 'true');
  expect(await snapshot(page)).toEqual(before);
});

test('single-case imports treat labels as text and remove a comparison that needs both cases', async ({ page }) => {
  const imported = structuredClone(trace); imported.cases = [imported.cases.find(run => run.id === 'nominal')];
  const label = '<img id="shared-world-injected" src=x onerror="window.__sharedWorldInjected=true">'; imported.cases[0].label = label;
  await upload(page, imported); await expect(page.locator('#shared-world-import-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#shared-world-case option')).toHaveCount(1);
  await expect(page.locator('#shared-world-case option')).toContainText(label); await expect(page.locator('#shared-world-injected')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sharedWorldInjected)).toBeUndefined();
  await expect(page.locator('#shared-world-comparison-note')).not.toContainText('duration difference');
  await expectFrame(page, imported.cases[0], 0);
  await page.locator('#shared-world-bundled').click(); await expect(page.locator('#shared-world-case option')).toHaveCount(trace.cases.length);
  await expectFrame(page, withdrawal, 0);
});

test('390px without WebGL preserves all three streams, shared-world controls and twenty-three workshops', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith('webgl') ? null : original.call(this, kind, ...args); };
  });
  await page.reload(); await page.locator('#shared-world-case').selectOption('withdrawal');
  await expect(page.locator('#shared-world-viewport svg')).toBeVisible();
  await page.locator('#shared-world-locked').click(); await page.locator('#shared-world-vehicle').selectOption('A3');
  await expect(page.locator('#shared-world-inspector-title')).toContainText('A3');
  await page.locator('#shared-world-landed').click();
  await expectFrame(page, withdrawal, sharedWorldSummary(withdrawal).landedMs);
  await expect(page.locator('#shared-world-tasks-count')).toHaveText('6 / 6');
  await expect(page.locator('#shared-world-landing-count')).toHaveText('3 / 3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(23);
  await expect(navigation.getByRole('link', { name: /23.*Shared Gazebo world/i })).toHaveAttribute('aria-current', 'page');
});
