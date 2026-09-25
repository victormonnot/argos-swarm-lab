import { test, expect } from '@playwright/test';

const visibleEntries = (page) => page.locator('.workshop-entry:visible');

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
  expect(await page.locator('#home-terrain').evaluate((canvas) => canvas.toDataURL())).not.toEqual(original);
  await page.locator('.site-primary').click();
  await expect(page).toHaveURL(/\/workshops\/$/);
  await expect(visibleEntries(page)).toHaveCount(23);
  expect(urls.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(urls.filter((url) => /three|\/data\/|trace|\/src\/(main|.*-view|.*-model)\.js/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
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
