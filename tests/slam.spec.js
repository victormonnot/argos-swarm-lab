import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();
const raw = async (page, selector, attribute) => JSON.parse(await page.locator(selector).getAttribute(attribute));
const pose = (page, kind = 'estimate') => raw(page, `#slam-pose-${kind}`, 'data-pose');
const beforePose = (page) => raw(page, '#slam-update-summary', 'data-before-pose');
const afterPose = (page) => raw(page, '#slam-update-summary', 'data-after-pose');
const snapshot = async (page) => ({
  step: await page.locator('#slam-step-count').textContent(),
  time: await page.locator('#slam-time').textContent(),
  estimate: await pose(page),
  position: await page.locator('#slam-position-error').textContent(),
  heading: await page.locator('#slam-heading-error').textContent(),
  map: await page.locator('#slam-map-error').textContent(),
  counts: await page.locator('#slam-observation-counts').textContent(),
  covariance: await page.locator('#slam-covariance tbody td').allTextContents(),
});
const observe = (page) => page.locator('#slam-observe').click();
const choose = (page, id) => page.locator(`[data-slam-observation="${id}"]`).click();

test.beforeEach(async ({ page }) => {
  const errors = []; errorsByPage.set(page, errors);
  page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/slam/');
  await expect(page.locator('#slam-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('first sightings grow a correlated map, while reobservations correct pose', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText('Extended Kalman Filter');
  await expect(page.locator('#slam-landmarks [data-initialized="true"]')).toHaveCount(0);
  await expect(page.locator('#slam-covariance tbody tr')).toHaveCount(3);
  await observe(page);
  await expect(page.locator('#slam-time')).toHaveText('1.00 s');
  await expect(page.locator('#slam-landmarks [data-initialized="true"]')).toHaveCount(1);
  await expect(page.locator('#slam-covariance tbody tr')).toHaveCount(5);
  await choose(page, 'L1');
  await expect(page.locator('#slam-update-kind')).toContainText(/initial/i);
  expect(await beforePose(page)).toEqual(await afterPose(page));
  const cross = (await page.locator('#slam-covariance .slam-cross-cell').allTextContents()).map(Number);
  expect(Math.hypot(...cross)).toBeGreaterThan(0);
  await observe(page);
  await choose(page, 'L1');
  await expect(page.locator('#slam-update-kind')).toContainText(/correct/i);
  expect(await afterPose(page)).not.toEqual(await beforePose(page));
  await expect(page.locator('#slam-update-matrices')).toContainText('Kalman gain');
  await observe(page); await observe(page);
  await expect(page.locator('#slam-time')).toHaveText('4.00 s');
  await expect(page.locator('#slam-covariance tbody tr')).toHaveCount(7);
  await choose(page, 'L2');
  expect(await beforePose(page)).toEqual(await afterPose(page));
  const mapCross = await page.locator('#slam-covariance [data-row="3"][data-column="5"], #slam-covariance [data-row="3"][data-column="6"], #slam-covariance [data-row="4"][data-column="5"], #slam-covariance [data-row="4"][data-column="6"]').allTextContents();
  expect(Math.hypot(...mapCross.map(Number))).toBeGreaterThan(0);
});

test('odometry mapping shares inputs but omits repeated observations', async ({ page }) => {
  await observe(page);
  const truth = await pose(page, 'truth');
  const firstEstimate = await pose(page);
  await page.locator('#slam-method').selectOption('odometry');
  await observe(page);
  expect(await pose(page, 'truth')).toEqual(truth);
  expect(await pose(page)).toEqual(firstEstimate);
  await observe(page); await choose(page, 'L1');
  await expect(page.locator('#slam-update-kind')).toContainText(/ignor|omit/i);
  expect(await beforePose(page)).toEqual(await afterPose(page));
  await page.locator('#slam-finish').click();
  await expect(page.locator('#slam-step-count')).toHaveText('128');
  await expect(page.locator('#slam-time')).toHaveText('32.00 s');
  await expect(page.locator('#slam-landmarks [data-initialized="true"]')).toHaveCount(4);
  await expect(page.locator('#slam-covariance tbody tr')).toHaveCount(11);
  await expect(page.locator('#slam-step')).toBeDisabled();
});

test('restoring the sensor initializes unknown points before later pose correction', async ({ page }) => {
  await page.locator('#slam-scenario').selectOption('dropout');
  await page.locator('#slam-boundary').click();
  await expect(page.locator('#slam-time')).toHaveText('11.75 s');
  await page.locator('#slam-step').click();
  await expect(page.locator('#slam-time')).toHaveText('12.00 s');
  await expect(page.locator('[data-slam-observation]')).toHaveCount(0);
  await expect(page.locator('#slam-landmarks [data-initialized="true"]')).toHaveCount(2);
  await page.locator('#slam-boundary').click();
  await expect(page.locator('#slam-time')).toHaveText('19.75 s');
  await page.locator('#slam-step').click();
  await expect(page.locator('#slam-time')).toHaveText('20.00 s');
  await expect(page.locator('#slam-landmarks [data-initialized="true"]')).toHaveCount(4);
  for (const id of ['L3', 'L4']) {
    await choose(page, id);
    await expect(page.locator('#slam-update-kind')).toContainText(/initial/i);
    expect(await beforePose(page)).toEqual(await afterPose(page));
  }
  await observe(page); await choose(page, 'L4');
  await expect(page.locator('#slam-time')).toHaveText('21.00 s');
  await expect(page.locator('#slam-update-kind')).toContainText(/correct/i);
  expect(await afterPose(page)).not.toEqual(await beforePose(page));
});

test('a biased range changes the estimated map while leaving physical motion fixed', async ({ page }) => {
  await observe(page);
  const truth = await pose(page, 'truth');
  const nominalMap = await page.locator('#slam-landmarks').textContent();
  await page.locator('#slam-scenario').selectOption('biased-range');
  await observe(page);
  expect(await pose(page, 'truth')).toEqual(truth);
  expect(await page.locator('#slam-landmarks').textContent()).not.toEqual(nominalMap);
  await expect(page.locator('#slam-scenario-description')).toContainText('0.4');
  await page.locator('#slam-finish').click();
  await expect(page.locator('#slam-map-error')).not.toContainText('NaN');
  await expect(page.locator('#slam-outcome')).toContainText(/bias|incorrect|mismatch/i);
});

test('seeded reset and reference copies preserve the active run', async ({ page }) => {
  await page.locator('#slam-seed').fill('42'); await page.locator('#slam-seed').press('Tab');
  await observe(page); await observe(page);
  const before = await snapshot(page);
  await page.locator('#slam-comparisons summary').click();
  await expect(page.locator('#slam-reference-table tr')).toHaveCount(6);
  await expect(page.locator('#slam-ensemble')).toContainText('200');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#slam-reset').click();
  await expect(page.locator('#slam-seed')).toHaveValue('42');
  await observe(page); await observe(page);
  expect(await snapshot(page)).toEqual(before);
});

test('playback rates change elapsed wall time rather than model transitions', async ({ page }) => {
  await page.locator('#slam-2d').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#slam-play').click(); await page.clock.runFor(1000); await page.locator('#slam-play').click();
  await expect(page.locator('#slam-time')).toHaveText('1.00 s');
  const paused = await snapshot(page); await page.clock.runFor(1000); expect(await snapshot(page)).toEqual(paused);
  await page.locator('#slam-reset').click();
  await observe(page); expect(await snapshot(page)).toEqual(paused);
  await page.locator('#slam-reset').click(); await page.locator('#slam-speed').selectOption('4');
  await page.locator('#slam-play').click(); await page.clock.runFor(1010); await page.locator('#slam-play').click();
  await expect(page.locator('#slam-time')).toHaveText('4.00 s');
});

test('3D camera, selected observations and 2D view preserve the same pose and map', async ({ page }) => {
  await observe(page); await observe(page);
  const before = await snapshot(page), canvas = page.locator('#slam-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#slam-camera-focus').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#slam-camera-overview').click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 5 }); await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  const packet = page.locator('[data-slam-observation="L1"]');
  await packet.focus(); await page.keyboard.press('Enter'); await expect(packet).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#slam-2d').click(); await expect(page.locator('.slam-svg')).toBeVisible(); await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#slam-3d').click(); await expect(page.locator('.slam-svg')).toBeHidden();
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.slam-svg')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#slam-step').click(); await expect(page.locator('#slam-time')).toHaveText('2.25 s');
});

test('mobile navigation and absent WebGL retain usable map and controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await expect(page.locator('.slam-svg')).toBeVisible();
  await page.locator('#slam-finish').click();
  await expect(page.locator('#slam-covariance tbody tr')).toHaveCount(11);
  await page.locator('#slam-comparisons summary').click();
  await expect(page.locator('#slam-reference-table tr')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).locator('option')).toHaveCount(23);
  await navigation.getByRole('combobox', { name: 'Choose a workshop', exact: true }).selectOption('/cooperative/');
  await expect(page.locator('#coop-step-count')).toHaveText('0');
  await page.goBack(); await expect(page.locator('#slam-step-count')).toHaveText('0');
  await page.locator('#slam-step').click(); await expect(page.locator('#slam-time')).toHaveText('0.25 s');
});
