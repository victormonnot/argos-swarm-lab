import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  step: await page.locator('#orca-step-count').textContent(),
  state: await page.locator('#orca-states [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  clearance: await page.locator('#orca-clearance').textContent(),
  arrived: await page.locator('#orca-arrived').textContent(),
});
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/orca/'); await expect(page.locator('#orca-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('named ORCA rule exposes prepared and applied velocity decisions, then verifies arrival', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Optimal Reciprocal Collision Avoidance.');
  await expect(page.locator('#orca-status')).toHaveText('Paused');
  await expect(page.locator('[data-orca-agent]')).toHaveCount(3);
  await expect(page.locator('#orca-viewport canvas')).toHaveCount(0);
  await expect(page.locator('#orca-decision-note')).toContainText('prepared decision');
  await expect(page.locator('#orca-states [data-raw-value]').nth(1)).toHaveAttribute('data-raw-value', '0,0');
  await expect(page.locator('[data-orca-chosen]')).not.toHaveAttribute('data-velocity', '0,0');
  await expect(page.locator('[data-orca-boundary]')).toHaveCount(2);
  await expect(page.locator('[data-orca-boundary]').first()).toHaveAttribute('stroke', /^#/);
  await expect(page.locator('#orca-constraints tr')).toHaveCount(2);
  await page.locator('#orca-step').click();
  await expect(page.locator('#orca-step-count')).toHaveText('1');
  await expect(page.locator('#orca-time')).toHaveText('0.05 s');
  await expect(page.locator('#orca-decision-note')).toContainText('last applied decision used t = 0.00 s');
  expect(await page.locator('[data-margin]').evaluateAll((cells) => cells.every((cell) => Number(cell.dataset.margin) >= -1e-8))).toBe(true);
  await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('All agents arrived');
  await expect(page.locator('#orca-arrived')).toHaveText('3 / 3');
  await expect(page.locator('#orca-clearance')).toHaveText('0.020 m');
  await expect(page.locator('#orca-outcome')).toContainText('within 0.15 m');
  await expect(page.locator('#orca-step')).toBeDisabled();
  await expect(page.locator('#orca-play')).toBeDisabled();
});

test('same crossing exposes successful APF and contact under direct motion or missing observations', async ({ page }) => {
  await page.locator('[data-orca-case="apf-crossing"]').click();
  await expect(page.locator('#orca-feasibility')).toContainText('not evaluated for this baseline');
  await expect(page.locator('#orca-horizon')).toBeDisabled();
  await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('All agents arrived');
  await expect(page.locator('#orca-clearance')).toHaveText('0.189 m');
  await page.locator('[data-orca-case="direct-crossing"]').click(); await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('Collision detected');
  const direct = await snapshot(page);
  await page.locator('[data-orca-case="orca-blind"]').click();
  await expect(page.locator('#orca-constraints')).toContainText('No observed peers');
  await expect(page.locator('#orca-feasibility')).toContainText('Unseen peers can still collide');
  await expect(page.locator('[data-orca-boundary]')).toHaveCount(0);
  await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('Collision detected');
  expect(await snapshot(page)).toEqual(direct);
  await expect(page.locator('#orca-outcome')).toContainText('detecting step');
});

test('symmetric ORCA can remain separated yet exhaust the mission budget', async ({ page }) => {
  await page.locator('#orca-observer').selectOption('2');
  await page.locator('[data-orca-case="orca-head-on"]').click();
  await expect(page.locator('#orca-observer')).toHaveValue('1');
  await expect(page.locator('[data-orca-agent]')).toHaveCount(2);
  await expect(page.locator('#orca-constraints tr')).toHaveCount(1);
  await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('Time budget exhausted');
  await expect(page.locator('#orca-step-count')).toHaveText('800');
  await expect(page.locator('#orca-arrived')).toHaveText('0 / 2');
  await expect(page.locator('#orca-clearance')).toHaveText('0.020 m');
  await expect(page.locator('#orca-outcome')).toContainText('does not establish mission completion');
});

test('horizon starts a fresh paused run, reset replays exactly, reference cases preserve active state', async ({ page }) => {
  await page.locator('#orca-step').click(); const first = await snapshot(page);
  await page.locator('#orca-reset').click(); await page.locator('#orca-step').click(); expect(await snapshot(page)).toEqual(first);
  await page.locator('#orca-horizon').selectOption('0.5');
  await expect(page.locator('#orca-step-count')).toHaveText('0'); await expect(page.locator('#orca-status')).toHaveText('Paused');
  await expect(page.locator('#orca-constraint-note')).toContainText('τ = 0.5 s');
  await page.locator('#orca-step').click(); const short = await snapshot(page);
  await page.locator('#orca-reset').click(); await expect(page.locator('#orca-horizon')).toHaveValue('0.5');
  await page.locator('#orca-step').click(); expect(await snapshot(page)).toEqual(short);
  await page.locator('#orca-comparisons summary').click();
  await expect(page.locator('#orca-reference-table tr')).toHaveCount(5);
  await expect(page.locator('[data-reference-case="orca-crossing"]')).toContainText('All agents arrived');
  await expect(page.locator('[data-reference-case="orca-head-on"]')).toContainText('Time budget exhausted');
  await expect(page.locator('[data-reference-case="orca-blind"]')).toContainText('Collision detected');
  expect(await snapshot(page)).toEqual(short);
});

test('playback rates, observer and linked 3D camera preserve the same numerical run', async ({ page }) => {
  await freezeClock(page);
  await page.locator('#orca-speed').selectOption('1'); await page.locator('#orca-play').click();
  await page.clock.runFor(1000); await page.locator('#orca-play').click();
  const slow = await snapshot(page); expect(slow.step).toBe('20');
  await page.locator('#orca-reset').click(); await page.locator('#orca-speed').selectOption('10');
  await page.locator('#orca-play').click(); await page.clock.runFor(100); await page.locator('#orca-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#orca-observer').selectOption('2'); expect(await snapshot(page)).toEqual(slow);
  await page.locator('#orca-3d').click(); const canvas = page.locator('#orca-viewport canvas'); await expect(canvas).toBeVisible();
  await expect(page.locator('.orca-svg')).toBeHidden();
  await expect(page.locator('.orca-agent-label')).toHaveCount(3);
  await expect(page.locator('.orca-goal-label')).toHaveCount(3);
  const positions = () => page.locator('.orca-agent-label').evaluateAll((labels) => labels.map((label) => [label.style.left, label.style.top]));
  const before = await positions(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(positions).not.toEqual(before); expect(await snapshot(page)).toEqual(slow);
  await page.locator('.orca-agent-label').first().click(); await expect(page.locator('#orca-observer')).toHaveValue('0');
  expect(await snapshot(page)).toEqual(slow);
  await canvas.dispatchEvent('webglcontextlost'); await expect(page.locator('#orca-viewport')).toContainText('3D context lost');
  await page.locator('#orca-2d').click(); await expect(page.locator('.orca-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(slow); await page.locator('#orca-step').click(); await expect(page.locator('#orca-step-count')).toHaveText('21');
});

test('keyboard selection, mobile layout, navigation and unavailable WebGL keep the experiment usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  await page.locator('[data-orca-agent="1"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#orca-observer')).toHaveValue('1');
  await expect(page.locator('[data-orca-agent="1"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#orca-comparisons summary').click();
  await expect(page.locator('#orca-reference-table tr')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(15);
  await navigation.getByRole('link', { name: '07 / Shared estimates', exact: true }).click(); await expect(page.locator('#fusion-round')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '08 / ORCA collision avoidance', exact: true }).click();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#orca-3d').click(); await expect(page.locator('#orca-viewport')).toContainText('3D is unavailable');
  await page.locator('#orca-2d').click(); await page.locator('#orca-finish').click();
  await expect(page.locator('#orca-status')).toHaveText('All agents arrived');
});
