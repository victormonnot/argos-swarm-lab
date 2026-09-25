import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();
const selectAgent = (page, id) => page.getByRole('group', { name: 'Selected drone', exact: true }).getByRole('button', { name: id, exact: true }).click();
const covariance = (page) => page.locator('#coop-covariance tbody td').allTextContents();
const snapshot = async (page) => ({
  step: await page.locator('#coop-step-count').textContent(),
  time: await page.locator('#coop-time').textContent(),
  position: await page.locator('#coop-position-error').textContent(),
  relative: await page.locator('#coop-relative-error').textContent(),
  center: await page.locator('#coop-center-error').textContent(),
  counts: await page.locator('#coop-observation-counts').textContent(),
});
const selectedPosition = async (page, type) => JSON.parse(await page.locator(`#coop-selected-${type}`).getAttribute('data-position'));
const correctionA2 = async (page) => (await page.locator('[data-coop-correction="A2"]').textContent()).match(/-?\d+\.\d+/g).map(Number);

test.beforeEach(async ({ page }) => {
  const errors = []; errorsByPage.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cooperative/');
  await expect(page.locator('#coop-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('relative observations create cross-covariance and an A1 fix corrects A2', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText('Joint-state linear Kalman filter');
  await expect(page.locator('#coop-status')).toHaveText('Paused');
  await expect(page.locator('#coop-viewport canvas')).toBeVisible();
  await page.locator('#coop-observe').click();
  await expect(page.locator('#coop-time')).toHaveText('1.00 s');
  await expect(page.locator('#coop-step-count')).toHaveText('4');
  await expect(page.locator('#coop-observation-counts')).toContainText('relative 1 used / 1 available');
  await expect(page.locator('#coop-events')).toContainText('No schedule changes recorded');
  const state = await snapshot(page);
  await page.locator('#coop-stage').selectOption('predicted');
  await expect(page.locator('#coop-covariance [data-row="0"][data-column="2"]')).toHaveText('0.0000');
  await page.locator('#coop-stage').selectOption('afterRelative');
  expect(Number(await page.locator('#coop-covariance [data-row="0"][data-column="2"]').textContent())).toBeGreaterThan(0.3);
  await page.getByText('Inspect H, innovation and Kalman gain', { exact: true }).click();
  await expect(page.locator('#coop-update-details')).toContainText('Relative displacement');
  await page.locator('#coop-stage').selectOption('afterAnchor');
  await expect(page.locator('#coop-update-details')).toContainText('Absolute position of A1');
  expect(Math.hypot(...await correctionA2(page))).toBeGreaterThan(0.01);
  expect(await snapshot(page)).toEqual(state);
  await page.locator('#coop-step').click();
  await expect(page.locator('#coop-time')).toHaveText('1.25 s');
  await expect(page.locator('#coop-update-details')).toContainText('No A1 absolute update');
  await expect(page.locator('[data-coop-input="relative"]')).toContainText('No sample');
  await expect(page.locator('#coop-observation-counts')).toContainText('relative 1 used / 1 available');
});

test('independent filters use the same physical paths and samples with no indirect A2 update', async ({ page }) => {
  await page.locator('#coop-observe').click();
  const truth = await selectedPosition(page, 'truth');
  const relativeValue = (await page.locator('[data-coop-input="relative"]').textContent()).split(' m · ')[0];
  await page.locator('#coop-method').selectOption('independent');
  await expect(page.locator('#coop-step-count')).toHaveText('0');
  await page.locator('#coop-observe').click();
  expect(await selectedPosition(page, 'truth')).toEqual(truth);
  await expect(page.locator('[data-coop-input="relative"]')).toContainText(relativeValue);
  await expect(page.locator('[data-coop-input="relative"]')).toContainText('omitted');
  await expect(page.locator('#coop-covariance [data-row="0"][data-column="2"]')).toHaveText('0.0000');
  expect(await correctionA2(page)).toEqual([0, 0]);
  await page.locator('#coop-stage').selectOption('afterRelative');
  await expect(page.locator('#coop-update-details')).toContainText('No Kalman update');
  await page.locator('#coop-finish').click();
  await expect(page.locator('#coop-time')).toHaveText('20.00 s');
  await expect(page.locator('#coop-step-count')).toHaveText('80');
  await expect(page.locator('#coop-observation-counts')).toContainText('relative 0 used / 20 available');
  await expect(page.locator('#coop-step')).toBeDisabled();
});

test('a shared prior translation remains invisible to relative observations', async ({ page }) => {
  await page.locator('#coop-scenario').selectOption('unanchored');
  await page.locator('#coop-finish').click();
  const relativeError = await page.locator('#coop-relative-error').textContent();
  const centerError = await page.locator('#coop-center-error').textContent();
  const a1 = await selectedPosition(page, 'estimate');
  await selectAgent(page, 'A2'); const a2 = await selectedPosition(page, 'estimate');
  const unshiftedP = await covariance(page);
  await page.locator('#coop-prior-shift').selectOption('shared');
  await page.locator('#coop-finish').click();
  const shifted2 = await selectedPosition(page, 'estimate');
  await selectAgent(page, 'A1'); const shifted1 = await selectedPosition(page, 'estimate');
  for (const [shifted, original] of [[shifted1, a1], [shifted2, a2]]) {
    expect(shifted[0] - original[0]).toBeCloseTo(2, 10);
    expect(shifted[1] - original[1]).toBeCloseTo(-1.5, 10);
  }
  await expect(page.locator('#coop-relative-error')).toHaveText(relativeError);
  expect(await page.locator('#coop-center-error').textContent()).not.toEqual(centerError);
  expect(await covariance(page)).toEqual(unshiftedP);
  await expect(page.locator('#coop-prior-description')).toContainText('not included');
  await expect(page.locator('#coop-observation-counts')).toContainText('A1 absolute 0 used / 0 available');
});

test('a restored A1 reference corrects the offset through the joint covariance at 10 seconds', async ({ page }) => {
  await page.locator('[data-coop-case="restore"]').click();
  await expect(page.locator('#coop-prior-shift')).toHaveValue('shared');
  await page.locator('#coop-boundary').click();
  await expect(page.locator('#coop-time')).toHaveText('9.75 s');
  const before = parseFloat(await page.locator('#coop-center-error').textContent());
  await expect(page.locator('#coop-observation-counts')).toContainText('A1 absolute 0 used / 0 available');
  await page.locator('#coop-step').click();
  await expect(page.locator('#coop-time')).toHaveText('10.00 s');
  await expect(page.locator('#coop-observation-counts')).toContainText('A1 absolute 1 used / 1 available');
  expect(Math.hypot(...await correctionA2(page))).toBeGreaterThan(1);
  expect(parseFloat(await page.locator('#coop-center-error').textContent())).toBeLessThan(before);
  await page.locator('#coop-finish').click();
  await expect(page.locator('#coop-observation-counts')).toContainText('A1 absolute 11 used / 11 available');
});

test('missing relative samples produce no stale correction and return on the declared boundary', async ({ page }) => {
  await page.locator('#coop-scenario').selectOption('relative-outage');
  await page.locator('#coop-boundary').click();
  await expect(page.locator('#coop-time')).toHaveText('4.75 s');
  await page.locator('#coop-step').click();
  await expect(page.locator('[data-coop-input="relative"]')).toContainText('Unavailable');
  await expect(page.locator('[data-coop-input="anchor"]')).toContainText('used once');
  await page.locator('#coop-stage').selectOption('predicted'); const predicted = await covariance(page);
  await page.locator('#coop-stage').selectOption('afterRelative');
  expect(await covariance(page)).toEqual(predicted);
  await expect(page.locator('#coop-update-details')).toContainText('No relative update');
  await page.locator('#coop-boundary').click();
  await expect(page.locator('#coop-time')).toHaveText('9.75 s');
  await page.locator('#coop-step').click();
  await expect(page.locator('[data-coop-input="relative"]')).toContainText('used once');
  await page.locator('#coop-finish').click();
  await expect(page.locator('#coop-observation-counts')).toContainText('relative 15 used / 15 available');
});

test('seed changes, reset and independent reference copies preserve reproducible runs', async ({ page }) => {
  await page.locator('#coop-seed').fill('42'); await page.locator('#coop-seed').press('Tab');
  await page.locator('#coop-observe').click();
  const state = await snapshot(page), estimate = await selectedPosition(page, 'estimate');
  await page.locator('#coop-comparisons summary').click();
  await expect(page.locator('#coop-reference-table tr')).toHaveCount(12);
  await expect(page.locator('#coop-ensemble')).toContainText('195 / 200');
  await expect(page.locator('#coop-ensemble')).toContainText('20, 25, 37, 50, 170');
  expect(await snapshot(page)).toEqual(state);
  await page.locator('#coop-reset').click();
  await expect(page.locator('#coop-seed')).toHaveValue('42');
  await expect(page.locator('#coop-status')).toHaveText('Paused');
  await page.locator('#coop-observe').click();
  expect(await snapshot(page)).toEqual(state);
  expect(await selectedPosition(page, 'estimate')).toEqual(estimate);
  await page.locator('#coop-2d').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#coop-reset').click();
  await page.locator('#coop-play').click(); await page.clock.runFor(1000); await page.locator('#coop-play').click();
  await expect(page.locator('#coop-step-count')).toHaveText('4');
  const paused = await snapshot(page); await page.clock.runFor(1000); expect(await snapshot(page)).toEqual(paused);
  await page.locator('#coop-reset').click(); await page.locator('#coop-speed').selectOption('4');
  await page.locator('#coop-play').click(); await page.clock.runFor(1010); await page.locator('#coop-play').click();
  await expect(page.locator('#coop-time')).toHaveText('4.00 s');
});

test('3D framing, robot selection and covariance inspection observe one unchanged run', async ({ page }) => {
  await page.locator('#coop-observe').click(); const before = await snapshot(page);
  const canvas = page.locator('#coop-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#coop-camera-focus').click(); expect(await snapshot(page)).toEqual(before);
  await selectAgent(page, 'A2'); expect(await snapshot(page)).toEqual(before);
  await page.locator('#coop-camera-overview').click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#coop-2d').click();
  await expect(page.locator('.coop-svg')).toBeVisible(); await expect(canvas).toBeHidden();
  const a1 = page.getByRole('group', { name: 'Selected drone', exact: true }).getByRole('button', { name: 'A1', exact: true });
  await a1.focus(); await page.keyboard.press('Enter'); await expect(a1).toBeFocused();
  await expect(page.locator('#coop-selected-title')).toContainText('A1');
  await page.locator('#coop-stage').selectOption('afterRelative'); expect(await snapshot(page)).toEqual(before);
  await page.locator('#coop-3d').click(); await expect(page.locator('.coop-svg')).toBeHidden();
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.coop-svg')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#coop-step').click(); await expect(page.locator('#coop-time')).toHaveText('1.25 s');
});

test('mobile navigation and unavailable WebGL retain usable controls and state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload();
  await expect(page.locator('.coop-svg')).toBeVisible();
  await expect(page.locator('#coop-2d')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#coop-observe').click();
  await page.getByText('Inspect H, innovation and Kalman gain', { exact: true }).click();
  await expect(page.locator('#coop-update-details')).toContainText('Absolute position of A1');
  await page.locator('#coop-comparisons summary').click();
  await expect(page.locator('#coop-reference-table tr')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).locator('option')).toHaveCount(23);
  await navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/behavior/');
  await expect(page.locator('#behavior-step-count')).toHaveText('0');
  await page.goBack(); await expect(page.locator('#coop-step-count')).toHaveText('0');
  await page.locator('#coop-step').click(); await expect(page.locator('#coop-time')).toHaveText('0.25 s');
});
