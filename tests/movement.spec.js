import { test, expect } from '@playwright/test';

const errors = new WeakMap();
const step = async (page) => Number(await page.locator('#movement-step-count').textContent());
const snapshot = async (page) => ({
  step: await step(page),
  positions: await page.locator('#movement-table [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  chart: await page.locator('#movement-chart').innerHTML(),
  clearance: await page.locator('#movement-clearance').textContent(),
});

test.beforeEach(async ({ page }) => {
  const collected = [];
  errors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  await page.goto('/movement/');
  await expect(page.locator('#movement-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('workshop navigation exposes both algorithms and starts fresh runs', async ({ page }) => {
  await expect(page.locator('h1')).toContainText('Artificial Potential Fields');
  await page.locator('#movement-step').click();
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '01 / Average consensus' }).click();
  await expect(page.locator('#step-count')).toHaveText('0');
  await expect(page.locator('#state-table tbody tr')).toHaveCount(6);
  await page.locator('#step-button').click();
  await expect(page.locator('#step-count')).toHaveText('1');
  await page.getByRole('link', { name: '02 / Potential fields', exact: true }).click();
  await expect(page.locator('#movement-step-count')).toHaveText('0');
});

test('step, playback, map and applied gains have explicit reset semantics', async ({ page }) => {
  await page.locator('#movement-step').click();
  await expect(page.locator('#movement-time')).toHaveText('0.02 s');
  await expect(page.locator('[data-position-x="1"]')).toHaveText('-3.9800');
  await page.locator('#movement-speed').selectOption('200');
  await page.locator('#movement-play').click();
  await expect.poll(() => step(page)).toBeGreaterThan(1);
  await page.locator('#movement-play').click();
  const paused = await snapshot(page);
  await page.waitForTimeout(120);
  expect(await snapshot(page)).toEqual(paused);
  await page.locator('#gain-obstacle').fill('0.2');
  expect(await snapshot(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Apply gains & reset' }).click();
  await expect(page.locator('#movement-step-count')).toHaveText('0');
  await page.locator('#movement-step').click();
  await page.locator('#gain-obstacle').fill('0.3');
  await page.locator('#movement-reset').click();
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.2');
  await page.locator('#movement-preset').selectOption('trap');
  await expect(page.locator('#movement-status')).toHaveText('Paused');
  await expect(page.locator('#movement-map-name')).toHaveText('U-shaped trap');
  await expect(page.locator('#gain-obstacle')).toHaveValue('0.2');
});

test('nominal arrival and both failure types are visible and stop the run', async ({ page }) => {
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Arrived');
  await expect(page.locator('#movement-arrived')).toHaveText('3 / 3');
  await expect(page.locator('#movement-step-count')).toHaveText('407');
  await expect(page.locator('#movement-play')).toBeDisabled();
  await page.locator('[data-movement-case="trap"]').click();
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Stalled');
  await expect(page.locator('#movement-step-count')).toHaveText('330');
  await expect(page.locator('#movement-arrived')).toHaveText('0 / 3');
  await expect(page.locator('#movement-step')).toBeDisabled();
  for (const scenario of ['no-separation', 'no-obstacles']) {
    await page.locator(`[data-movement-case="${scenario}"]`).click();
    await expect(page.locator('#movement-step-count')).toHaveText('0');
    await page.locator('#movement-finish').click();
    await expect(page.locator('#movement-status')).toHaveText('Collision');
    await expect(page.locator('#movement-vectors')).toContainText('Command stopped');
    await expect(page.locator('#movement-finish')).toBeDisabled();
  }
  const beforeComparisons = await snapshot(page);
  await page.locator('#movement-comparisons summary').click();
  await expect(page.locator('#movement-comparison-table tr')).toHaveCount(5);
  expect(await snapshot(page)).toEqual(beforeComparisons);
});

test('view switches, camera orbit and playback setting preserve numerical state', async ({ page }) => {
  await page.locator('#movement-step').click();
  const before = await snapshot(page);
  await page.locator('#movement-3d').click();
  const canvas = page.locator('#movement-viewport canvas');
  await expect(canvas).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.movement-3d-labels button')).toHaveCount(3);
  const labels = () => page.locator('.movement-3d-labels button').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const previousLabels = await labels();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(labels).not.toEqual(previousLabels);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#movement-2d').click();
  await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#movement-speed').selectOption('10');
  await page.locator('#movement-step').click();
  const slow = await snapshot(page);
  await page.locator('#movement-reset').click();
  await page.locator('#movement-speed').selectOption('200');
  await page.locator('#movement-step').click();
  await page.locator('#movement-step').click();
  expect(await snapshot(page)).toEqual(slow);
});

test('keyboard and narrow-screen controls expose decisions without horizontal page overflow', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  const agent = page.locator('[data-movement-agent="2"]');
  await agent.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#movement-selected-name')).toHaveText('A3');
  await expect(agent).toBeFocused();
  await expect(page.locator('#movement-inputs')).toContainText('sensed peers: A2');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#movement-agent').selectOption('1');
  await expect(page.locator('#movement-inputs')).toContainText('sensed peers: A1, A3');
  await page.locator('#movement-step').click();
  await expect(page.locator('#movement-step-count')).toHaveText('1');
});

test('2D and textual controls remain usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.reload();
  await page.locator('#movement-3d').click();
  await expect(page.locator('#movement-viewport')).toContainText(/unavailable/i);
  await page.locator('#movement-2d').click();
  await page.locator('#movement-finish').click();
  await expect(page.locator('#movement-status')).toHaveText('Arrived');
  await expect(page.locator('[data-position-x="1"]')).toBeVisible();
});
