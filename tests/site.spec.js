import { test, expect } from '@playwright/test';

const visibleEntries = (page) => page.locator('.workshop-entry:visible');
const terrainImage = (page) => page.locator('#home-terrain').evaluate(async (canvas) => {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return canvas.toDataURL();
});

async function readyTerrain(page) {
  const canvas = page.locator('#home-terrain');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return canvas;
}

async function expectTerrainImage(page, image, matches = true) {
  await expect.poll(async () => (await terrainImage(page)) === image).toBe(matches);
}

// Editorial navigation must not initialize a simulator or fetch a recording.
test('home and catalog expose real entry points without heavy or external requests', async ({ page }) => {
  const urls = [];
  const errors = [];
  page.on('request', (request) => urls.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How robotsworktogether.');
  await expect(page.locator('#home-terrain')).toBeVisible();
  const original = await page.locator('#home-terrain').evaluate((canvas) => canvas.toDataURL());
  await page.getByRole('button', { name: 'Links', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Links', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectTerrainImage(page, original, false);
  await page.locator('.site-primary').click();
  await expect(page).toHaveURL(/\/workshops\/$/);
  await expect(visibleEntries(page)).toHaveCount(23);
  expect(urls.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(urls.filter((url) => /three|\/data\/|trace|\/src\/(main|.*-view|.*-model)\.js/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test('home terrain rotates and pans by dragging, then resets without changing its layer', async ({ page }) => {
  await page.goto('/');
  const canvas = await readyTerrain(page);
  const baseline = await terrainImage(page);
  const box = await canvas.boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 110, center.y + 35, { steps: 6 });
  await page.mouse.up();
  await expectTerrainImage(page, baseline, false);
  const rotated = await terrainImage(page);
  await page.mouse.move(center.x - 70, center.y - 30, { steps: 4 });
  await expectTerrainImage(page, rotated);

  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(center.x - 20, center.y + 25, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expectTerrainImage(page, rotated, false);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expectTerrainImage(page, baseline);

  const links = page.getByRole('button', { name: 'Links', exact: true });
  await links.click();
  await expectTerrainImage(page, baseline, false);
  const linksBaseline = await terrainImage(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 85, center.y + 20, { steps: 5 });
  await page.mouse.up();
  await expectTerrainImage(page, linksBaseline, false);
  await canvas.dblclick();
  await expectTerrainImage(page, linksBaseline);
  await expect(links).toHaveAttribute('aria-pressed', 'true');
});

test('home terrain offers keyboard rotation, panning and reset', async ({ page }) => {
  await page.goto('/');
  const canvas = await readyTerrain(page);
  await expect(canvas).toHaveAccessibleDescription(/arrow/i);
  await expect(canvas).toHaveAccessibleDescription(/shift/i);
  const baseline = await terrainImage(page);
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expectTerrainImage(page, baseline, false);
  const rotated = await terrainImage(page);
  await page.keyboard.press('Shift+ArrowDown');
  await expectTerrainImage(page, rotated, false);
  await page.keyboard.press('Home');
  await expectTerrainImage(page, baseline);
  await expect(canvas).toBeFocused();
});

test('home terrain supports touch dragging and recovers after an interrupted gesture', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = await readyTerrain(page);
    const baseline = await terrainImage(page);
    const box = await canvas.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scrollBefore = await page.evaluate(() => scrollY);
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: start.x + 55, y: start.y + 25 }],
    });
    await expectTerrainImage(page, baseline, false);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    const interrupted = await terrainImage(page);
    await page.touchscreen.tap(start.x - 35, start.y - 20);
    await expectTerrainImage(page, interrupted);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: start.x - 45, y: start.y - 30 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectTerrainImage(page, interrupted, false);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);

    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expectTerrainImage(page, baseline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('catalog filters intersect and restore on Back, Forward and a shared URL', async ({ page }) => {
  await page.goto('/workshops/');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('coordination');
  await page.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption('beginner');
  await expect(visibleEntries(page)).toHaveCount(2);
  await expect(page.locator('#catalog-count')).toHaveText('2 of 23 workshops');
  await expect(page).toHaveURL(/theme=coordination&difficulty=beginner/);
  await page.getByLabel('Search', { exact: true }).fill('consensus');
  await expect(visibleEntries(page)).toHaveCount(1);
  const shared = page.url();
  await page.goBack();
  await expect(visibleEntries(page)).toHaveCount(2);
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('');
  await page.goForward();
  await expect(visibleEntries(page)).toHaveCount(1);
  await page.goto(shared);
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('coordination');
  await expect(page.getByRole('combobox', { name: 'Difficulty', exact: true })).toHaveValue('beginner');
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('consensus');
  await expect(visibleEntries(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(visibleEntries(page)).toHaveCount(23);
  await expect(page).toHaveURL(/\/workshops\/$/);
  await page.getByLabel('Search', { exact: true }).fill('<nothing matches>');
  await expect(visibleEntries(page)).toHaveCount(0);
  await expect(page.locator('#catalog-empty')).toBeVisible();
  await expect(page.locator('#catalog-active')).toContainText('<nothing matches>');
});

test('start-here and replay discovery expose preparation and actual mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New to robotics? Start here' }).click();
  await expect(visibleEntries(page)).toHaveCount(4);
  expect(await visibleEntries(page).evaluateAll((entries) => entries.map((entry) => entry.dataset.workshopId))).toEqual(['01', '02', '03', '05']);
  await page.goto('/workshops/?mode=replay');
  await expect(visibleEntries(page)).toHaveCount(10);
  const shared = page.locator('[data-workshop-id="23"]');
  await shared.locator('summary').click();
  await expect(shared).toContainText('Recorded replay');
  await expect(shared.getByRole('link', { name: /19 \// })).toHaveAttribute('href', '/gazebo/');
  await expect(shared.getByRole('link', { name: /22 \// })).toHaveAttribute('href', '/recovery/');
  await shared.getByRole('link', { name: /19 \// }).click();
  await expect(page).toHaveURL(/\/gazebo\/$/);
  await expect(page.locator('.argos-workshop-mode')).toHaveText('Recorded replay');
});

test('known consensus bookmarks redirect while home anchors remain on home', async ({ page }) => {
  for (const anchor of ['experiment', 'field-notes', 'model', 'state-table']) {
    await page.goto(`/#${anchor}`);
    await expect(page).toHaveURL(`/consensus/#${anchor}`);
    await expect(page.locator(`#${anchor}`)).toBeAttached();
  }
  await page.goto('/#about');
  await expect(page).toHaveURL('/#about');
  await expect(page.locator('#about')).toBeVisible();
});

test('home, catalog and preparation remain navigable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.terrain-still')).toBeVisible();
  await expect(page.locator('.terrain-still')).toHaveJSProperty('naturalWidth', 1200);
  await page.locator('.site-primary').click();
  await expect(visibleEntries(page)).toHaveCount(23);
  await expect(page.locator('#catalog-filters')).toBeHidden();
  const shared = page.locator('[data-workshop-id="23"]');
  await shared.locator('summary').click();
  await expect(shared.getByRole('link', { name: /19 \// })).toBeVisible();
  await page.locator('[data-workshop-id="01"] h2 a').click();
  await expect(page).toHaveURL('/consensus/');
  await expect(page.getByRole('link', { name: 'All workshops', exact: true })).toBeVisible();
  await context.close();
});

test('mobile keyboard navigation, filtering and layout fit at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/#main');
  const menu = page.getByRole('button', { name: /Menu/ });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Workshops', exact: true }).click();
  await page.getByRole('combobox', { name: 'Execution mode', exact: true }).selectOption('replay');
  await expect(visibleEntries(page)).toHaveCount(10);
  await page.locator('[data-workshop-id="23"] summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
