import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  step: await page.locator('#loc-step-count').textContent(),
  positions: await page.locator('#loc-positions [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  update: await page.locator('#loc-update').innerHTML(),
  fixes: await page.locator('#loc-fix-counts').textContent(),
  waypoint: await page.locator('#loc-waypoint').textContent(),
});
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/localization/');
  await expect(page.locator('#loc-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('prediction and a fresh fix expose distinct observable Kalman updates', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Linear Kalman filtering. Estimate, then correct.');
  await expect(page.locator('#loc-update-kind')).toContainText('Exact initial position');
  await expect(page.locator('#loc-error')).toHaveText('0.000 m');
  await page.locator('#loc-step').click();
  await expect(page.locator('#loc-update-kind')).toContainText('Prediction only');
  await expect(page.locator('#loc-update dd').last()).toHaveText('0.000100 m²');
  await expect(page.locator('#loc-update dd').nth(6)).toHaveText('—');
  await expect(page.locator('[data-loc-fix]')).toHaveCount(0);
  await freezeClock(page); await page.locator('#loc-play').click(); await page.clock.runFor(900); await page.locator('#loc-play').click();
  await expect(page.locator('#loc-step-count')).toHaveText('10');
  await expect(page.locator('#loc-update-kind')).toContainText('Predict + correct');
  await expect(page.locator('#loc-update dd').nth(6)).toHaveText('0.2857');
  await expect(page.locator('#loc-fix-counts')).toHaveText('1 fixes received · 1 used for Kalman correction.');
  await expect(page.locator('[data-loc-fix]')).toHaveAttribute('data-stale', 'false');
  await page.locator('#loc-step').click();
  await expect(page.locator('#loc-update-kind')).toContainText('Prediction only');
  await expect(page.locator('#loc-update dd').nth(4)).toHaveText('—');
  await expect(page.locator('[data-loc-fix]')).toHaveAttribute('data-stale', 'true');
  await expect(page.locator('#loc-last-fix')).toContainText('Age: 0.1 s · historical');
});

test('outage skips stale fixes and the first restored measurement contracts covariance', async ({ page }) => {
  await page.locator('#loc-schedule').selectOption('recovery');
  await page.locator('#loc-loss').click();
  await expect(page.locator('#loc-step-count')).toHaveText('30');
  await expect(page.locator('#loc-fix-counts')).toHaveText('2 fixes received · 2 used for Kalman correction.');
  await expect(page.locator('#loc-last-fix')).toContainText('sampled at 2.0 s. Age: 1.0 s');
  await expect(page.locator('#loc-update-kind')).toContainText('Prediction only');
  await freezeClock(page); await page.locator('#loc-play').click(); await page.clock.runFor(4900); await page.locator('#loc-play').click();
  await expect(page.locator('#loc-step-count')).toHaveText('79');
  const prior = parseFloat(await page.locator('#loc-update dd').last().textContent());
  await page.locator('#loc-return').click();
  await expect(page.locator('#loc-step-count')).toHaveText('80');
  await expect(page.locator('#loc-update-kind')).toContainText('Predict + correct');
  await expect(page.locator('#loc-last-fix')).toContainText('sampled at 8.0 s. Age: 0.0 s');
  expect(parseFloat(await page.locator('#loc-update dd').last().textContent())).toBeLessThan(prior);
  await page.locator('#loc-finish').click();
  await expect(page.locator('#loc-status')).toHaveText('Arrival verified');
  await expect(page.locator('#loc-time')).toHaveText('17.3 s');
});

test('false arrival differs from verified arrival and a terminal run cannot await future restoration', async ({ page }) => {
  await page.locator('[data-loc-case="dead:steady"]').click(); await page.locator('#loc-finish').click();
  await expect(page.locator('#loc-status')).toHaveText('False arrival');
  await expect(page.locator('#loc-controller')).toHaveText('Controller announced arrival');
  await expect(page.locator('#loc-actual-goal')).toHaveText('1.437 m');
  await expect(page.locator('#loc-estimated-goal')).toHaveText('0.027 m');
  await expect(page.locator('[data-loc-uncertainty]')).toHaveCount(0);
  await expect(page.locator('#loc-step')).toBeDisabled();
  await page.locator('[data-loc-case="kalman:steady"]').click(); await page.locator('#loc-finish').click();
  await expect(page.locator('#loc-status')).toHaveText('Arrival verified');
  await expect(page.locator('#loc-actual-goal')).toHaveText('0.205 m');
  await page.locator('#loc-map').selectOption('open'); await page.locator('#loc-schedule').selectOption('recovery');
  await page.locator('#loc-return').click();
  await expect(page.locator('#loc-time')).toHaveText('6.6 s');
  await expect(page.locator('#loc-outcome')).toContainText('ended before the scheduled 8 s restoration');
  await expect(page.locator('#loc-return')).toBeDisabled();
  await page.locator('#loc-reset').click();
  await expect(page.locator('#loc-map')).toHaveValue('open'); await expect(page.locator('#loc-schedule')).toHaveValue('recovery');
  await expect(page.locator('#loc-step-count')).toHaveText('0');
});

test('applied seeds, bias and fixed repeated comparisons have explicit reset and replay semantics', async ({ page }) => {
  await page.locator('#loc-step').click(); const first = await snapshot(page);
  await page.locator('#loc-seed').fill('7');
  expect(await snapshot(page)).toEqual(first);
  await page.locator('#loc-reset').click(); await expect(page.locator('#loc-seed')).toHaveValue('1');
  await page.locator('#loc-step').click(); expect(await snapshot(page)).toEqual(first);
  await page.locator('#loc-seed').fill('7'); await page.locator('#loc-seed-form button').click();
  await expect(page.locator('#loc-step-count')).toHaveText('0'); await page.locator('#loc-step').click();
  const seven = await snapshot(page); expect(seven.positions).not.toEqual(first.positions);
  await page.locator('#loc-reset').click(); await page.locator('#loc-step').click(); expect(await snapshot(page)).toEqual(seven);
  await page.locator('#loc-seed').fill('0'); await page.locator('#loc-seed-form button').click();
  expect(await snapshot(page)).toEqual(seven);
  await page.locator('#loc-bias').uncheck(); await expect(page.locator('#loc-step-count')).toHaveText('0');
  await expect(page.locator('#loc-seed')).toHaveValue('7');
  await page.locator('#loc-step').click(); const before = await snapshot(page);
  await page.locator('#loc-comparisons summary').click();
  await expect(page.locator('#loc-reference-table tr')).toHaveCount(10);
  await expect(page.locator('#loc-seed-table tr')).toHaveCount(10);
  await expect(page.locator('#loc-seed-table tr').nth(2)).toContainText('15 / 20');
  await expect(page.locator('#loc-seed-table tr').nth(7)).toContainText('19 / 20');
  expect(await snapshot(page)).toEqual(before);
});

test('playback, both views, camera and coordinate inspection preserve the same physical and estimated run', async ({ page }) => {
  await freezeClock(page); await page.locator('#loc-speed').selectOption('2');
  await page.locator('#loc-play').click(); await page.clock.runFor(1000); await page.locator('#loc-play').click();
  const slow = await snapshot(page); expect(slow.step).toBe('2');
  await page.locator('#loc-reset').click(); await page.locator('#loc-speed').selectOption('40');
  await page.locator('#loc-play').click(); await page.clock.runFor(50); await page.locator('#loc-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#loc-3d').click(); const canvas = page.locator('#loc-viewport canvas'); await expect(canvas).toBeVisible();
  const labels = () => page.locator('.loc-truth-label,.loc-estimate-label').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const prior = await labels(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(labels).not.toEqual(prior);
  await page.locator('#loc-axis').selectOption('1'); await page.locator('#loc-axis').selectOption('0');
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#loc-2d').click(); await expect(canvas).toBeHidden(); expect(await snapshot(page)).toEqual(slow);
});

test('keyboard, mobile navigation and unavailable WebGL keep the experiment usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  await page.locator('#loc-estimator').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.locator('#loc-estimator')).toHaveValue('exact');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(14);
  await navigation.getByRole('link', { name: '05 / A* path planning', exact: true }).click(); await expect(page.locator('#path-step-count')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '06 / Kalman position filtering', exact: true }).click();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#loc-3d').click(); await expect(page.locator('#loc-viewport')).toContainText(/unavailable/i);
  await page.locator('#loc-2d').click(); await page.locator('#loc-finish').click();
  await expect(page.locator('#loc-status')).toHaveText('Arrival verified');
  await expect(page.locator('#loc-time')).toHaveText('16.9 s');
});
