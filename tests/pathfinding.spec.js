import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const physical = async (page) => ({
  step: await page.locator('#path-step-count').textContent(),
  position: await page.locator('#path-x, #path-y').evaluateAll((items) => items.map((item) => item.dataset.rawValue)),
  distance: await page.locator('#path-travelled').textContent(),
  route: await page.locator('[data-path-route]').getAttribute('points'),
  waypoints: await page.locator('#path-waypoints').innerHTML(),
});
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/pathfinding/');
  await expect(page.locator('#path-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('search snapshots expose g/h/f without moving the robot or rewriting the planned route', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('A* path planning. Then follow the route.');
  await expect(page.locator('#path-search-summary')).toContainText('30 total pops');
  await expect(page.locator('#path-length')).toHaveText('17.0 m');
  await expect(page.locator('#path-travelled')).toHaveText('0.0 m');
  await page.locator('#path-step').click();
  const before = await physical(page);
  await page.locator('#path-trace-first').click();
  await expect(page.locator('#path-trace-count')).toHaveText('0 / 30');
  await expect(page.locator('[data-search="open"]')).toHaveCount(1);
  await expect(page.locator('#path-cell-details')).toContainText('Frontier');
  await page.locator('#path-cell').selectOption('58');
  await expect(page.locator('#path-cell-details')).toContainText('Undiscovered');
  await expect(page.locator('#path-cell-details dd').nth(2)).toHaveText('Unknown');
  await expect(page.locator('#path-cell-details dd').nth(3)).toHaveText('0 m');
  await page.locator('#path-trace-next').click();
  await expect(page.locator('#path-trace-count')).toHaveText('1 / 30');
  await page.locator('#path-trace-last').click();
  await expect(page.locator('#path-cell-details dd').nth(2)).toHaveText('17 m');
  await expect(page.locator('#path-cell-details dd').nth(4)).toHaveText('17 m');
  await page.locator('#path-show-search').uncheck();
  await expect(page.locator('[data-search="open"], [data-search="closed"], [data-search="current"]')).toHaveCount(0);
  expect(await physical(page)).toEqual(before);
});

test('A* and Dijkstra execute the same shortest grid distance with different search effort', async ({ page }) => {
  await page.locator('#path-finish').click();
  await expect(page.locator('#path-status')).toHaveText('Goal reached');
  await expect(page.locator('#path-time')).toHaveText('17.0 s');
  await expect(page.locator('#path-travelled')).toHaveText('17.0 m');
  await expect(page.locator('#path-goal-distance')).toHaveText('0.0 m');
  await page.locator('#path-planner').selectOption('dijkstra');
  await expect(page.locator('#path-step-count')).toHaveText('0');
  await expect(page.locator('#path-search-summary')).toContainText('95 total pops');
  await expect(page.locator('#path-length')).toHaveText('17.0 m');
  await page.locator('#path-finish').click();
  await expect(page.locator('#path-time')).toHaveText('17.0 s');
  const before = await physical(page);
  await page.locator('#path-comparisons summary').click();
  await expect(page.locator('#path-comparison-table tr')).toHaveCount(9);
  expect(await physical(page)).toEqual(before);
});

test('direct collision and no-path refusal are distinct outcomes, and reset preserves configuration', async ({ page }) => {
  await page.locator('[data-path-case="direct:open"]').click();
  await page.locator('#path-finish').click();
  await expect(page.locator('#path-status')).toHaveText('Goal reached');
  await expect(page.locator('#path-time')).toHaveText('7.0 s');
  await page.locator('[data-path-case="direct:u"]').click();
  await expect(page.locator('#path-trace')).toBeDisabled();
  await expect(page.locator('[data-path-route]')).toHaveAttribute('data-path-route', 'unchecked');
  await page.locator('#path-finish').click();
  await expect(page.locator('#path-status')).toHaveText('Collision');
  await expect(page.locator('#path-time')).toHaveText('1.5 s');
  await expect(page.locator('#path-travelled')).toHaveText('1.5 m');
  await expect(page.locator('#path-outcome')).toContainText('cell (5, 4)');
  await expect(page.locator('#path-step')).toBeDisabled();
  await page.locator('#path-reset').click();
  await expect(page.locator('#path-planner')).toHaveValue('direct');
  await expect(page.locator('#path-map')).toHaveValue('u');
  await expect(page.locator('#path-step-count')).toHaveText('0');
  await page.locator('[data-path-case="astar:sealed"]').click();
  await expect(page.locator('#path-status')).toHaveText('No path');
  await expect(page.locator('#path-travelled')).toHaveText('0.0 m');
  await expect(page.locator('#path-time')).toHaveText('0.0 s');
  await expect(page.locator('#path-search-summary')).toContainText('6 total pops');
  await expect(page.locator('[data-path-route]')).toHaveCount(0);
  await expect(page.locator('#path-play')).toBeDisabled();
  await page.locator('#path-trace-first').click();
  await expect(page.locator('#path-trace-next')).toBeEnabled();
});

test('timed playback, 2D/3D, trace inspection and camera motion preserve a single run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#path-speed').selectOption('2');
  await page.locator('#path-play').click(); await page.clock.runFor(1000); await page.locator('#path-play').click();
  const slow = await physical(page); expect(slow.step).toBe('2');
  await page.locator('#path-reset').click();
  await page.locator('#path-speed').selectOption('40');
  await page.locator('#path-play').click(); await page.clock.runFor(50); await page.locator('#path-play').click();
  expect(await physical(page)).toEqual(slow);
  await page.locator('#path-3d').click();
  const canvas = page.locator('#path-viewport canvas'); await expect(canvas).toBeVisible();
  await expect(page.locator('#path-3d')).toHaveAttribute('aria-pressed', 'true');
  const labels = () => page.locator('.path-agent-label').evaluate((item) => [item.style.left, item.style.top]);
  const before = await labels(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(labels).not.toEqual(before);
  await page.locator('#path-trace-first').click();
  await page.locator('#path-cell').selectOption('58');
  await expect(page.locator('.path-search-label:not([hidden])')).toHaveCount(1);
  expect(await physical(page)).toEqual(slow);
  await page.locator('#path-2d').click(); await expect(canvas).toBeHidden();
  expect(await physical(page)).toEqual(slow);
});

test('keyboard cell navigation, mobile controls and all workshop links remain usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  const start = page.locator('[data-path-cell="51"]'); await start.focus(); await page.keyboard.press('Enter');
  await expect(start).toBeFocused(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#path-cell')).toHaveValue('50');
  await expect(page.locator('[data-path-cell="50"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#path-step').click(); await expect(page.locator('#path-step-count')).toHaveText('1');
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(10);
  await navigation.getByRole('link', { name: '04 / Decision architectures', exact: true }).click();
  await expect(page.locator('#arch-step-count')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '05 / A* path planning', exact: true }).click();
  await expect(page.locator('#path-step-count')).toHaveText('0');
});

test('unavailable WebGL leaves search and motion operable in 2D', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#path-3d').click();
  await expect(page.locator('#path-viewport')).toContainText(/unavailable/i);
  await page.locator('#path-2d').click(); await page.locator('#path-trace-first').click();
  await expect(page.locator('#path-trace-count')).toHaveText('0 / 30');
  await page.locator('#path-finish').click(); await expect(page.locator('#path-status')).toHaveText('Goal reached');
  await expect(page.locator('#path-time')).toHaveText('17.0 s');
});
