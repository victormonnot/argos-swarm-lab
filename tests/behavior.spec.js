import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();
const node = (page, id) => page.locator(`[data-behavior-node="${id}"]`);
const snapshot = async (page) => ({
  time: await page.locator('#behavior-time').textContent(),
  step: await page.locator('#behavior-step-count').textContent(),
  pose: await page.locator('#behavior-position').getAttribute('data-position'),
  progress: await page.locator('#behavior-progress').textContent(),
  ignored: await page.locator('#behavior-ignored').textContent(),
  discarded: await page.locator('#behavior-discarded').textContent(),
  outcome: await page.locator('#behavior-outcome').textContent(),
});

test.beforeEach(async ({ page }) => {
  const errors = []; errorsByPage.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/behavior/');
  await expect(page.locator('#behavior-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('reactive ticks halt an inspection at the sampled event and restart discarded work', async ({ page }) => {
  await expect(page.locator('h1')).toContainText('Behavior Trees.');
  await expect(page.locator('#behavior-status')).toHaveText('Paused');
  await expect(page.locator('#behavior-viewport canvas')).toBeVisible();
  await page.locator('#behavior-boundary').click();
  await expect(page.locator('#behavior-time')).toHaveText('7.00 s');
  await expect(page.locator('#behavior-position')).toHaveAttribute('data-position', '[6,0,3]');
  await expect(page.locator('#behavior-progress')).toContainText('1.00');
  await expect(node(page, 'inspect')).toHaveAttribute('data-status', 'Running');
  await expect(node(page, 'hold-requested')).toHaveAttribute('data-status', 'Failure');
  await page.locator('#behavior-step').click();
  await expect(page.locator('#behavior-time')).toHaveText('7.25 s');
  await expect(node(page, 'hold-requested')).toHaveAttribute('data-status', 'Success');
  await expect(node(page, 'hold')).toHaveAttribute('data-status', 'Running');
  await expect(node(page, 'inspect')).toHaveAttribute('data-status', 'Idle');
  await expect(page.locator('#behavior-discarded')).toContainText('1.00');
  await expect(page.locator('#behavior-halt-note')).toContainText('Inspect');
  await expect(page.locator('#behavior-position')).toHaveAttribute('data-position', '[6,0,3]');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('19.00 s');
  await expect(page.locator('#behavior-step-count')).toHaveText('77');
  await expect(page.locator('#behavior-ignored')).toHaveText('0.00 s');
  await expect(page.locator('#behavior-position')).toHaveAttribute('data-position', '[0,0,0]');
  await expect(page.locator('#behavior-outcome')).toContainText('Inspection completed');
  await expect(page.locator('#behavior-step')).toBeDisabled();
  await expect(page.locator('#behavior-play')).toBeDisabled();
});

test('guarded FSM matches the reactive mission while root memory exposes a skipped guard', async ({ page }) => {
  await page.locator('#behavior-controller').selectOption('fsm');
  await page.locator('#behavior-boundary').click();
  await page.locator('#behavior-step').click();
  await expect(page.locator('#behavior-action')).toContainText('Hold');
  await expect(page.locator('#behavior-flow-title')).toContainText('Finite-state');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('19.00 s');
  await expect(page.locator('#behavior-ignored')).toHaveText('0.00 s');
  await page.locator('#behavior-controller').selectOption('bt-memory');
  await expect(page.locator('#behavior-step-count')).toHaveText('0');
  await page.locator('#behavior-boundary').click();
  await page.locator('#behavior-step').click();
  await expect(node(page, 'hold-requested')).toHaveAttribute('data-status', 'Idle');
  await expect(node(page, 'inspect')).toHaveAttribute('data-status', 'Running');
  await expect(page.locator('#behavior-ignored')).toHaveText('0.25 s');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('15.00 s');
  await expect(page.locator('#behavior-ignored')).toHaveText('3.00 s');
  await expect(page.locator('#behavior-outcome')).toContainText('hold');
});

test('persistent hold prevents completion and action Failure triggers an aborted recovery', async ({ page }) => {
  await page.locator('#behavior-scenario').selectOption('persistent-hold');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('30.00 s');
  await expect(page.locator('#behavior-step-count')).toHaveText('120');
  await expect(page.locator('#behavior-position')).toHaveAttribute('data-position', '[6,0,3]');
  await expect(page.locator('#behavior-status')).toHaveText('Time budget reached');
  await page.locator('#behavior-scenario').selectOption('sensor-failure');
  await page.locator('#behavior-boundary').click();
  await page.locator('#behavior-step').click();
  await expect(node(page, 'inspect')).toHaveAttribute('data-status', 'Failure');
  await expect(node(page, 'abort-return')).toHaveAttribute('data-status', 'Running');
  await expect(page.locator('#behavior-discarded')).toContainText('1.00');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('13.00 s');
  await expect(node(page, 'root')).toHaveAttribute('data-status', 'Success');
  await expect(page.locator('#behavior-outcome')).toContainText('Mission aborted');
  await expect(page.locator('#behavior-progress')).toContainText('0.00');
  await expect(page.locator('#behavior-position')).toHaveAttribute('data-position', '[0,0,0]');
});

test('reset repeats the run and reference copies never replace the active experiment', async ({ page }) => {
  await page.locator('[data-behavior-case="memory"]').click();
  await page.locator('#behavior-boundary').click();
  await page.locator('#behavior-step').click();
  const first = await snapshot(page);
  await page.locator('#behavior-comparisons summary').click();
  await expect(page.locator('#behavior-reference-table tr')).toHaveCount(12);
  expect(await snapshot(page)).toEqual(first);
  await page.locator('#behavior-reset').click();
  await expect(page.locator('#behavior-controller')).toHaveValue('bt-memory');
  await expect(page.locator('#behavior-status')).toHaveText('Paused');
  await page.locator('#behavior-boundary').click();
  await page.locator('#behavior-step').click();
  expect(await snapshot(page)).toEqual(first);
  await page.locator('#behavior-scenario').selectOption('nominal');
  await expect(page.locator('#behavior-step-count')).toHaveText('0');
  await expect(page.locator('#behavior-boundary')).toBeDisabled();
});

test('playback pacing, pause and terminal observation preserve model interval semantics', async ({ page }) => {
  await page.locator('#behavior-2d').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#behavior-play').click();
  await page.clock.runFor(1000);
  await page.locator('#behavior-play').click();
  await expect(page.locator('#behavior-step-count')).toHaveText('4');
  await expect(page.locator('#behavior-time')).toHaveText('1.00 s');
  const paused = await snapshot(page);
  await page.clock.runFor(2000); expect(await snapshot(page)).toEqual(paused);
  await page.locator('#behavior-reset').click();
  await page.locator('#behavior-speed').selectOption('4');
  await page.locator('#behavior-play').click(); await page.clock.runFor(1010);
  await page.locator('#behavior-play').click();
  await expect(page.locator('#behavior-time')).toHaveText('4.00 s');
});

test('3D camera, side elevation and node inspection observe the same genuine altitude state', async ({ page }) => {
  await page.locator('#behavior-boundary').click();
  const before = await snapshot(page);
  const canvas = page.locator('#behavior-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#behavior-focus-drone').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#behavior-whole-yard').click();
  expect(await snapshot(page)).toEqual(before);
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 35, { steps: 5 }); await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#behavior-2d').click();
  await expect(page.locator('.behavior-svg')).toBeVisible();
  await expect(canvas).toBeHidden();
  await node(page, 'inspect').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#behavior-node-help')).toContainText('Inspect');
  await expect(node(page, 'inspect')).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#behavior-3d').click();
  await expect(page.locator('.behavior-svg')).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.behavior-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#behavior-step').click();
  await expect(page.locator('#behavior-time')).toHaveText('7.25 s');
});

test('mobile layout and navigation remain usable when WebGL is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('.behavior-svg')).toBeVisible();
  await expect(page.locator('#behavior-2d')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#behavior-finish').click();
  await expect(page.locator('#behavior-time')).toHaveText('19.00 s');
  await page.locator('#behavior-comparisons summary').click();
  await expect(page.locator('#behavior-reference-table tr')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(21);
  await navigation.getByRole('link', { name: '09 / CBBA task bundles', exact: true }).click();
  await expect(page.locator('#cbba-round')).toHaveText('0');
  await page.goBack();
  await expect(page.locator('#behavior-step-count')).toHaveText('0');
  await page.locator('#behavior-step').click();
  await expect(page.locator('#behavior-time')).toHaveText('0.25 s');
});
