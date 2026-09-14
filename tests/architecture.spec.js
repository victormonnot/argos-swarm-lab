import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  step: await page.locator('#arch-step-count').textContent(),
  positions: await page.locator('#arch-agents [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  tasks: await page.locator('#arch-tasks').innerHTML(),
  reports: await page.locator('#arch-reports').innerHTML(),
  events: await page.locator('#arch-events').innerHTML(),
  traffic: await page.locator('#arch-traffic').innerHTML(),
});
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/architecture/');
  await expect(page.locator('#arch-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('reports precede commands and become stale without stopping remote work', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Who can decide? Who can know?');
  await expect(page.locator('#arch-reports tr').first()).toContainText('Idle');
  await expect(page.locator('#arch-agents tr').first()).toContainText('Travelling');
  await page.locator('#arch-network').selectOption('partition');
  await page.locator('#arch-cut').click();
  await expect(page.locator('#arch-time')).toHaveText('2.0 s');
  await expect(page.locator('#arch-reports tr[data-stale="true"]')).toHaveCount(2);
  await expect(page.locator('#arch-reports tr').nth(1)).toContainText('1.9 s');
  await expect(page.locator('#arch-network-diagram line[data-active="false"]')).toHaveCount(4);
  await page.locator('#arch-restore').click();
  await expect(page.locator('#arch-link-state')).toHaveText('2 disconnected groups');
  await expect(page.locator('#arch-tasks tr').nth(1)).toContainText('Completed');
  await expect(page.locator('#arch-tasks tr').nth(1)).toContainText('Reserved A2');
  await expect(page.locator('#arch-reports tr').nth(1)).toContainText('6.1 s · stale');
  await page.locator('#arch-observer').selectOption('2');
  await expect(page.locator('#arch-tasks tr').nth(1).locator('td').last()).toHaveText('Completed');
});

test('permanent cuts distinguish physical success from confirmation and preserve applied resets', async ({ page }) => {
  await page.locator('[data-arch-case="central:partition"]').click();
  await page.locator('#arch-finish').click();
  await expect(page.locator('#arch-physical')).toHaveText('6 / 6');
  await expect(page.locator('#arch-confirmed')).toHaveText('4 / 6');
  await expect(page.locator('#arch-physical-time')).toContainText('27.7 s');
  await expect(page.locator('#arch-time')).toHaveText('60.0 s');
  await expect(page.locator('#arch-outcome')).toContainText('All work is physically complete');
  await expect(page.locator('#arch-step')).toBeDisabled();
  await page.locator('[data-arch-case="hierarchy:partition"]').click();
  await page.locator('#arch-finish').click();
  await expect(page.locator('#arch-physical')).toHaveText('6 / 6');
  await expect(page.locator('#arch-confirmed')).toHaveText('2 / 6');
  await expect(page.locator('#arch-physical-time')).toContainText('15.7 s');
  await page.locator('#arch-reset').click();
  await expect(page.locator('#arch-step-count')).toHaveText('0');
  await expect(page.locator('#arch-architecture')).toHaveValue('hierarchy');
  await expect(page.locator('#arch-network')).toHaveValue('partition');
  await expect(page.locator('#arch-step')).toBeEnabled();
});

test('peer barrier waits for the roster, then resumes with matched plans when links return', async ({ page }) => {
  await page.locator('[data-arch-case="peers:partition"]').click();
  await page.locator('#arch-finish').click();
  await expect(page.locator('#arch-physical')).toHaveText('3 / 6');
  await expect(page.locator('#arch-confirmed')).toHaveText('1 / 6');
  await expect(page.locator('#arch-readiness')).toContainText('Missing current reports: A2, A3');
  await page.locator('[data-arch-case="peers:recovery"]').click();
  await page.locator('#arch-cut').click();
  await expect(page.locator('#arch-readiness')).toHaveAttribute('data-waiting', 'true');
  await page.locator('#arch-restore').click();
  await expect(page.locator('#arch-reports tr[data-stale="true"]')).toHaveCount(0);
  await expect(page.locator('#arch-readiness')).toContainText('3 / 3 matching plans');
  await page.locator('#arch-finish').click();
  await expect(page.locator('#arch-status')).toHaveText('Completed & confirmed');
  await expect(page.locator('#arch-time')).toHaveText('15.2 s');
  const before = await snapshot(page);
  await page.locator('#arch-comparisons summary').click();
  await expect(page.locator('#arch-comparison-table tr')).toHaveCount(9);
  expect(await snapshot(page)).toEqual(before);
});

test('playback speeds, both views and camera motion preserve one numerical sequence', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#arch-speed').selectOption('2');
  await page.locator('#arch-play').click();
  await page.clock.runFor(1000);
  await page.locator('#arch-play').click();
  const slow = await snapshot(page); expect(slow.step).toBe('2');
  await page.locator('#arch-reset').click();
  await page.locator('#arch-speed').selectOption('40');
  await page.locator('#arch-play').click();
  await page.clock.runFor(50);
  await page.locator('#arch-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#arch-3d').click();
  const canvas = page.locator('#arch-viewport canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#arch-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mission-labels button')).toHaveCount(3);
  expect(await snapshot(page)).toEqual(slow);
  const labels = () => page.locator('.mission-labels button').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const previous = await labels(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + bounds.height * .7);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(labels).not.toEqual(previous);
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#arch-observer').selectOption('3');
  await page.locator('#arch-observer').selectOption('0');
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#arch-2d').click();
  await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(slow);
});

test('keyboard selection, mobile layout and all workshop links remain usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  const node = page.locator('[data-observer-node="2"]');
  await node.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#arch-observer-title')).toHaveText('A2’s report cache');
  await expect(node).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#arch-cut').click();
  await expect(page.locator('#arch-step-count')).toHaveText('20');
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(6);
  for (const [name, id] of [['01 / Average consensus', '#step-count'], ['02 / Potential fields', '#movement-step-count'], ['03 / Task allocation', '#mission-step-count'], ['04 / Decision architectures', '#arch-step-count'], ['05 / A* path planning', '#path-step-count'], ['06 / Kalman position filtering', '#loc-step-count']]) {
    await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name, exact: true }).click();
    await expect(page.locator(id)).toHaveText('0');
  }
});

test('unavailable WebGL keeps execution and knowledge inspection usable in 2D', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload();
  await page.locator('#arch-3d').click();
  await expect(page.locator('#arch-viewport')).toContainText(/unavailable/i);
  await page.locator('#arch-2d').click();
  await page.locator('#arch-finish').click();
  await expect(page.locator('#arch-physical')).toHaveText('6 / 6');
  await expect(page.locator('#arch-confirmed')).toHaveText('6 / 6');
  await expect(page.locator('#arch-time')).toHaveText('13.7 s');
});
