import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  round: await page.locator('#cbba-round').textContent(),
  bundles: await page.locator('#cbba-states [data-raw-bundle]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawBundle)),
  paths: await page.locator('#cbba-states [data-raw-path]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawPath)),
  conflicts: await page.locator('#cbba-conflicts').textContent(),
  unique: await page.locator('#cbba-unique').textContent(),
  agreement: await page.locator('#cbba-agreement').textContent(),
  score: await page.locator('#cbba-score').textContent(),
});
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/cbba/'); await expect(page.locator('#cbba-round')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('CBBA exposes local bids and released suffixes, then distinguishes exclusive allocation from agreement', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Consensus-Based Bundle Algorithm.');
  await expect(page.locator('#cbba-status')).toHaveText('Paused');
  await expect(page.locator('[data-cbba-agent]')).toHaveCount(3);
  await expect(page.locator('[data-cbba-task]')).toHaveCount(6);
  await expect(page.locator('[data-cbba-claim]')).toHaveCount(6);
  await expect(page.locator('#cbba-viewport canvas')).toHaveCount(0);
  await expect(page.locator('#cbba-conflicts')).toHaveText('2');
  await expect(page.locator('#cbba-score')).toContainText('No valid complete-allocation score');
  await page.locator('#cbba-observer').selectOption('1');
  await expect(page.locator('#cbba-beliefs [data-winner]').first()).toHaveText('A2');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-round')).toHaveText('1');
  await expect(page.locator('#cbba-beliefs [data-winner]').first()).toHaveText('A1');
  await expect(page.locator('[data-cbba-packet]')).toHaveCount(2);
  await expect(page.locator('#cbba-packets')).toContainText('Table 1, row 1');
  await expect(page.locator('#cbba-releases')).toContainText('T1 (lost to A1) → T4 (later suffix entry)');
  await expect(page.locator('#cbba-releases')).toContainText('Bundle after release: Empty. After rebuilding: T4 → T5');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-unique')).toHaveText('6 / 6');
  await expect(page.locator('#cbba-agreement')).toHaveText('No');
  await expect(page.locator('#cbba-score')).toContainText('436 points');
  await expect(page.locator('#cbba-score')).toContainText('tables still disagree');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-agreement')).toHaveText('Yes');
  await expect(page.locator('#cbba-outcome')).toContainText('first observed at round 3');
  await page.locator('#cbba-finish').click();
  await expect(page.locator('#cbba-status')).toHaveText('Round budget reached');
  await expect(page.locator('#cbba-round')).toHaveText('12');
  await expect(page.locator('#cbba-score')).toContainText('83.52%');
  await expect(page.locator('#cbba-outcome')).toContainText('do not mean completed tasks');
  await expect(page.locator('#cbba-step')).toBeDisabled();
  await expect(page.locator('#cbba-play')).toBeDisabled();
});

test('no sharing and permanent partition preserve reproducible conflicting task claims', async ({ page }) => {
  await page.locator('[data-cbba-case="local"]').click();
  await expect(page.locator('#cbba-schedule')).toBeDisabled();
  const initial = (await snapshot(page)).bundles;
  await page.locator('#cbba-finish').click();
  expect((await snapshot(page)).bundles).toEqual(initial);
  await expect(page.locator('#cbba-conflicts')).toHaveText('2');
  await expect(page.locator('#cbba-unique')).toHaveText('1 / 6');
  await expect(page.locator('#cbba-packets')).toContainText('sends and receives no packets');
  await expect(page.locator('#cbba-network')).toContainText('0 attempted / 0 delivered / 0 dropped');
  await page.locator('[data-cbba-case="partition"]').click();
  await page.locator('#cbba-observer').selectOption('2');
  await page.locator('#cbba-finish').click();
  await expect(page.locator('#cbba-agreement')).toHaveText('No');
  await expect(page.locator('#cbba-conflicts')).toHaveText('2');
  await expect(page.locator('#cbba-score')).toContainText('2 unclaimed; 2 conflicting');
  await expect(page.locator('#cbba-packets')).toContainText('No packets arrived');
  await expect(page.locator('#cbba-timestamps')).toContainText('A2 = 0 / no contact known');
  await expect(page.locator('[data-cbba-link="1-2"]')).toHaveAttribute('data-active', 'false');
  await expect(page.locator('#cbba-network')).toContainText('48 attempted / 24 delivered / 24 dropped');
});

test('restoration boundary shows the first returning packets, suffix release and delayed full agreement', async ({ page }) => {
  await page.locator('[data-cbba-case="recovery"]').click();
  await page.locator('#cbba-observer').selectOption('2');
  await page.locator('#cbba-boundary').click();
  await expect(page.locator('#cbba-round')).toHaveText('4');
  await expect(page.locator('#cbba-boundary')).toBeDisabled();
  await expect(page.locator('#cbba-network')).toContainText('The next step restores A2 ↔ A3 before round 5');
  await expect(page.locator('[data-cbba-link="1-2"]')).toHaveAttribute('data-active', 'false');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-round')).toHaveText('5');
  await expect(page.locator('[data-cbba-link="1-2"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-cbba-packet]')).toHaveCount(1);
  await expect(page.locator('#cbba-releases')).toContainText('T1 (lost to A1) → T4 (later suffix entry)');
  await expect(page.locator('#cbba-timestamps')).toContainText('A2 = round 5');
  await expect(page.locator('[data-cbba-event="restore"]')).toContainText('both directions');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-unique')).toHaveText('6 / 6');
  await expect(page.locator('#cbba-agreement')).toHaveText('No');
  await page.locator('#cbba-step').click();
  await expect(page.locator('#cbba-agreement')).toHaveText('Yes');
  await expect(page.locator('#cbba-outcome')).toContainText('first observed at round 7');
  await page.locator('#cbba-finish').click();
  await expect(page.locator('#cbba-score')).toContainText('436 points');
  await expect(page.locator('#cbba-network')).toContainText('48 attempted / 40 delivered / 8 dropped');
});

test('reset and schedule changes replay deterministically while reference copies preserve the active experiment', async ({ page }) => {
  await page.locator('#cbba-step').click(); const first = await snapshot(page);
  await page.locator('#cbba-reset').click(); await page.locator('#cbba-step').click();
  expect(await snapshot(page)).toEqual(first);
  await page.locator('#cbba-schedule').selectOption('recovery');
  await expect(page.locator('#cbba-round')).toHaveText('0');
  await expect(page.locator('#cbba-status')).toHaveText('Paused');
  await page.locator('#cbba-step').click(); const disrupted = await snapshot(page);
  await page.locator('#cbba-reset').click(); await expect(page.locator('#cbba-schedule')).toHaveValue('recovery');
  await page.locator('#cbba-step').click(); expect(await snapshot(page)).toEqual(disrupted);
  await page.locator('#cbba-comparisons summary').click();
  await expect(page.locator('#cbba-reference-table tr')).toHaveCount(4);
  await expect(page.locator('[data-reference-case="connected"]')).toContainText('first round 3');
  await expect(page.locator('[data-reference-case="recovery"]')).toContainText('first round 7');
  await expect(page.locator('[data-reference-case="partition"]')).toContainText('Not valid / incomplete');
  expect(await snapshot(page)).toEqual(disrupted);
  await page.locator('#cbba-algorithm').selectOption('local');
  await expect(page.locator('#cbba-round')).toHaveText('0');
  await expect(page.locator('#cbba-status')).toHaveText('Paused');
});

test('playback, observer and linked 3D camera preserve one numerical allocation run', async ({ page }) => {
  await freezeClock(page);
  await page.locator('#cbba-play').click(); await page.clock.runFor(1000); await page.locator('#cbba-play').click();
  await expect(page.locator('#cbba-round')).toHaveText('1');
  await page.locator('#cbba-reset').click(); await page.locator('#cbba-speed').selectOption('3');
  await page.locator('#cbba-play').click(); await page.clock.runFor(1000); await page.locator('#cbba-play').click();
  await expect(page.locator('#cbba-round')).toHaveText('3');
  const state = await snapshot(page);
  await page.locator('#cbba-observer').selectOption('2'); expect(await snapshot(page)).toEqual(state);
  await page.locator('#cbba-3d').click(); const canvas = page.locator('#cbba-viewport canvas');
  await expect(canvas).toBeVisible(); await expect(page.locator('.cbba-svg')).toBeHidden();
  await expect(page.locator('.cbba-agent-label')).toHaveCount(3);
  await expect(page.locator('.cbba-task-label')).toHaveCount(6);
  const positions = () => page.locator('.cbba-agent-label').evaluateAll((labels) => labels.map((label) => [label.style.left, label.style.top]));
  const before = await positions(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(positions).not.toEqual(before); expect(await snapshot(page)).toEqual(state);
  await page.locator('.cbba-agent-label').first().click(); await expect(page.locator('#cbba-observer')).toHaveValue('0');
  expect(await snapshot(page)).toEqual(state);
  await canvas.dispatchEvent('webglcontextlost'); await expect(page.locator('#cbba-viewport')).toContainText('3D context lost');
  await page.locator('#cbba-2d').click(); await expect(page.locator('.cbba-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(state);
  await page.locator('#cbba-step').click(); await expect(page.locator('#cbba-round')).toHaveText('4');
});

test('keyboard, mobile navigation and unavailable WebGL keep CBBA usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  await page.locator('[data-cbba-agent="1"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#cbba-observer')).toHaveValue('1');
  await expect(page.locator('[data-cbba-agent="1"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#cbba-comparisons summary').click();
  await expect(page.locator('#cbba-reference-table tr')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(16);
  await navigation.getByRole('link', { name: '08 / ORCA collision avoidance', exact: true }).click(); await expect(page.locator('#orca-step-count')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '09 / CBBA task bundles', exact: true }).click();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#cbba-3d').click();
  await expect(page.locator('#cbba-viewport')).toContainText('3D is unavailable');
  await page.locator('#cbba-2d').click(); await page.locator('#cbba-finish').click();
  await expect(page.locator('#cbba-agreement')).toHaveText('Yes');
});
