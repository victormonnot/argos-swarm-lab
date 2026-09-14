import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  round: await page.locator('#fusion-round').textContent(),
  state: await page.locator('#fusion-states [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  traffic: await page.locator('#fusion-traffic').textContent(),
  update: await page.locator('#fusion-update').innerHTML(),
  coefficients: await page.locator('[data-fusion-coefficient]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
});
const means = async (page) => page.locator('#fusion-states tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].slice(0, 2).map((cell) => cell.dataset.rawValue)));
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/fusion/'); await expect(page.locator('#fusion-round')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('overlap appears at round two and naive summaries understate uncertainty without new observations', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Covariance Intersection. Sharing is not sensing.');
  await expect(page.locator('#fusion-reported')).toHaveText('1.280000 m²');
  await expect(page.locator('[data-fusion-estimate]')).toHaveCount(3);
  await expect(page.locator('#fusion-viewport canvas')).toHaveCount(0);
  await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-ratio')).toHaveText('1.00×');
  await expect(page.locator('#fusion-update-kind')).toContainText("receives A3's round-0 state");
  await page.locator('#fusion-round-two').click();
  await expect(page.locator('#fusion-round')).toHaveText('2');
  await expect(page.locator('#fusion-reported')).toHaveText('0.320000 m²');
  await expect(page.locator('#fusion-expected')).toHaveText('0.480000 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('1.50×');
  await expect(page.locator('#fusion-payload-note')).toContainText('no original IDs');
  await expect(page.locator('#fusion-lineage-note')).toContainText('3 of 3');
  await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-status')).toHaveText('12-round window complete');
  await expect(page.locator('#fusion-ratio')).toHaveText('1365.33×');
  await expect(page.locator('#fusion-step')).toBeDisabled();
  await expect(page.locator('#fusion-outcome')).toContainText('No sensor has taken a new reading');
});

test('unique raw IDs stop repeated fusion while CI keeps the same ring means with conservative covariance', async ({ page }) => {
  await page.locator('#fusion-finish').click(); const naive = await means(page);
  await page.locator('[data-fusion-case="ci:ring"]').click(); await page.locator('#fusion-finish').click();
  expect(await means(page)).toEqual(naive);
  await expect(page.locator('#fusion-reported')).toHaveText('1.280000 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('0.33×');
  await expect(page.locator('#fusion-ledger')).toContainText('No shared original-ID records');
  await page.locator('[data-fusion-case="ledger:ring"]').click(); await page.locator('#fusion-round-two').click();
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await expect(page.locator('#fusion-reported')).toHaveText('0.426667 m²');
  await expect(page.locator('#fusion-ratio')).toHaveText('1.00×');
  const atTwo = await means(page);
  await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-ledger-change')).toContainText('New IDs this round: none. Repeated IDs ignored: z1, z2, z3.');
  expect(await means(page)).toEqual(atTwo);
  await page.locator('#fusion-finish').click(); expect(await means(page)).toEqual(atTwo);
  await expect(page.locator('#fusion-traffic')).toContainText('99 delivered records');
});

test('cut packets are absent from local updates and round-five recovery does not replay the backlog', async ({ page }) => {
  await page.locator('[data-fusion-case="ledger:recovery"]').click();
  for (let round = 0; round < 4; round += 1) await page.locator('#fusion-step').click();
  await expect(page.locator('#fusion-update-kind')).toContainText('no packet delivered from A3');
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(1);
  await expect(page.locator('#fusion-update dd').nth(2)).toHaveText('—');
  await expect(page.locator('[data-fusion-link="2"]')).toHaveAttribute('data-available', 'false');
  await expect(page.locator('#fusion-traffic')).toContainText('12 packets attempted · 8 delivered · 4 dropped');
  await page.locator('#fusion-restore').click();
  await expect(page.locator('#fusion-round')).toHaveText('5');
  await expect(page.locator('[data-fusion-link="2"]')).toHaveAttribute('data-available', 'true');
  await expect(page.locator('#fusion-update-kind')).toContainText("receives A3's round-4 state");
  await expect(page.locator('#fusion-traffic')).toContainText('15 packets attempted · 11 delivered · 4 dropped');
  await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await page.locator('#fusion-observer').selectOption('1'); await expect(page.locator('#fusion-ledger tr')).toHaveCount(2);
  await page.locator('#fusion-step').click(); await expect(page.locator('#fusion-ledger tr')).toHaveCount(3);
  await page.locator('#fusion-algorithm').selectOption('local'); await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-traffic')).toHaveText('0 packets attempted · 0 delivered · 0 dropped · 0 delivered records');
});

test('applied seeds replay exactly and paired comparison tables never replace the active run', async ({ page }) => {
  await page.locator('#fusion-step').click(); const one = await snapshot(page);
  await page.locator('#fusion-seed').fill('7'); expect(await snapshot(page)).toEqual(one);
  await page.locator('#fusion-reset').click(); await expect(page.locator('#fusion-seed')).toHaveValue('1');
  await page.locator('#fusion-step').click(); expect(await snapshot(page)).toEqual(one);
  await page.locator('#fusion-seed').fill('7'); await page.locator('#fusion-seed-form button').click();
  await expect(page.locator('#fusion-round')).toHaveText('0'); await page.locator('#fusion-step').click();
  const seven = await snapshot(page); expect(seven.state).not.toEqual(one.state);
  await page.locator('#fusion-reset').click(); await page.locator('#fusion-step').click(); expect(await snapshot(page)).toEqual(seven);
  await page.locator('#fusion-seed').fill('0'); await page.locator('#fusion-seed-form button').click(); expect(await snapshot(page)).toEqual(seven);
  await page.locator('#fusion-comparisons summary').click();
  await expect(page.locator('#fusion-reference-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-seed-table tr')).toHaveCount(10);
  await expect(page.locator('#fusion-reference-table tr').nth(1)).toContainText('1365.3335');
  expect(await snapshot(page)).toEqual(seven);
});

test('playback speed, observer and 2D/3D camera changes preserve the same run, including context loss', async ({ page }) => {
  await freezeClock(page); await page.locator('#fusion-speed').selectOption('1');
  await page.locator('#fusion-play').click(); await page.clock.runFor(2000); await page.locator('#fusion-play').click();
  const slow = await snapshot(page); expect(slow.round).toBe('2');
  await page.locator('#fusion-reset').click(); await page.locator('#fusion-speed').selectOption('8');
  await page.locator('#fusion-play').click(); await page.clock.runFor(250); await page.locator('#fusion-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#fusion-observer').selectOption('2'); await page.locator('#fusion-observer').selectOption('0'); expect(await snapshot(page)).toEqual(slow);
  await page.locator('#fusion-3d').click(); const canvas = page.locator('#fusion-viewport canvas'); await expect(canvas).toBeVisible();
  await expect(page.locator('.fusion-agent-label')).toHaveCount(3);
  const positions = () => page.locator('.fusion-agent-label').evaluateAll((items) => items.map((item) => [item.style.left, item.style.top]));
  const before = await positions(), bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .5, { steps: 6 }); await page.mouse.up();
  await expect.poll(positions).not.toEqual(before); expect(await snapshot(page)).toEqual(slow);
  await canvas.dispatchEvent('webglcontextlost'); await expect(page.locator('#fusion-viewport')).toContainText('3D context lost');
  await page.locator('#fusion-2d').click(); await expect(page.locator('.fusion-svg')).toBeVisible();
  expect(await snapshot(page)).toEqual(slow); await page.locator('#fusion-step').click(); await expect(page.locator('#fusion-round')).toHaveText('3');
});

test('keyboard, narrow layout, workshop navigation and unavailable WebGL remain usable', async ({ page }) => {
  await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.keyboard.press('Enter');
  await page.locator('#fusion-algorithm').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.locator('#fusion-algorithm')).toHaveValue('local');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(13);
  await navigation.getByRole('link', { name: '06 / Kalman position filtering', exact: true }).click(); await expect(page.locator('#loc-step-count')).toHaveText('0');
  await page.getByRole('navigation', { name: 'Workshops', exact: true }).getByRole('link', { name: '07 / Shared estimates', exact: true }).click();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await page.locator('#fusion-3d').click(); await expect(page.locator('#fusion-viewport')).toContainText('3D is unavailable');
  await page.locator('#fusion-2d').click(); await page.locator('#fusion-finish').click();
  await expect(page.locator('#fusion-round')).toHaveText('12'); await expect(page.locator('#fusion-ratio')).toHaveText('1365.33×');
});
