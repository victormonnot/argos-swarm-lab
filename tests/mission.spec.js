import { test, expect } from '@playwright/test';

const browserErrors = new WeakMap();
const snapshot = async (page) => ({
  step: await page.locator('#mission-step-count').textContent(),
  positions: await page.locator('#mission-agent-table [data-raw-value]').evaluateAll((cells) => cells.map((cell) => cell.dataset.rawValue)),
  tasks: await page.locator('#mission-tasks').innerHTML(),
  events: await page.locator('#mission-events').innerHTML(),
  dispatch: await page.locator('#mission-costs').innerHTML(),
});
async function freezeClock(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
}
test.beforeEach(async ({ page }) => {
  const errors = []; browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/mission/');
  await expect(page.locator('#mission-step-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));

test('initial assignment, arrival and service completion are distinct visible states', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Assign the work. Then finish the mission.');
  const firstTask = page.locator('.mission-task[data-task="0"]');
  await expect(firstTask).toHaveAttribute('data-state', 'assigned');
  await expect(page.locator('#mission-completed')).toHaveText('0 / 6');
  await freezeClock(page);
  await page.locator('#mission-play').click();
  await page.clock.runFor(800);
  await page.locator('#mission-play').click();
  await expect(page.locator('#mission-step-count')).toHaveText('8');
  await expect(firstTask).toHaveAttribute('data-state', 'servicing');
  await expect(firstTask.locator('.task-service')).toHaveText('Service: 0.0 / 2.0 s');
  await expect(page.locator('#mission-fsm [data-state="servicing"]')).toHaveAttribute('aria-current', 'step');
  await page.locator('#mission-step').click();
  await expect(firstTask.locator('.task-service')).toHaveText('Service: 0.1 / 2.0 s');
  await page.locator('#mission-play').click();
  await page.clock.runFor(1900);
  await page.locator('#mission-play').click();
  await expect(page.locator('#mission-step-count')).toHaveText('28');
  await expect(firstTask).toHaveAttribute('data-state', 'completed');
  await expect(page.locator('#mission-completed')).toHaveText('1 / 6');
});

test('policy changes reset the run and expose the matching objective', async ({ page }) => {
  await expect(page.locator('#mission-dispatch-summary')).toContainText('6.800 m');
  await page.locator('#mission-step').click();
  await page.locator('#mission-policy').selectOption('hungarian');
  await expect(page.locator('#mission-step-count')).toHaveText('0');
  await expect(page.locator('#mission-dispatch-summary')).toContainText('5.200 m');
  await expect(page.locator('#mission-dispatch-summary')).toContainText('A1 → T2, A2 → T1, A3 → T3');
  await expect(page.locator('#mission-costs [data-selected="true"]')).toHaveCount(3);
  await page.locator('#mission-finish').click();
  await expect(page.locator('#mission-status')).toHaveText('Completed');
  await expect(page.locator('#mission-completed')).toHaveText('6 / 6');
  await expect(page.locator('#mission-time')).toHaveText('10.4 s');
  await page.locator('#mission-decision').selectOption('first');
  await expect(page.locator('#mission-dispatch-title')).toHaveText('Dispatch at 0.0 s');
  await expect(page.locator('#mission-dispatch-summary')).toContainText('5.200 m');
  const before = await snapshot(page);
  await page.locator('#mission-comparisons summary').click();
  await expect(page.locator('#mission-comparison-table tr')).toHaveCount(6);
  expect(await snapshot(page)).toEqual(before);
});

test('unavailability releases interrupted work; fixed owners strand it and adaptive owners recover', async ({ page }) => {
  await page.locator('#mission-failure').selectOption('a2');
  await page.locator('#mission-boundary').click();
  await expect(page.locator('#mission-time')).toHaveText('5.0 s');
  await expect(page.locator('#mission-available')).toHaveText('2 / 3');
  await expect(page.locator('#mission-lost-service')).toHaveText('1.0 s');
  await expect(page.locator('.mission-task[data-task="1"]')).toHaveAttribute('data-state', 'pending');
  await page.locator('#mission-agent').selectOption('1');
  await expect(page.locator('#mission-fsm [data-state="unavailable"]')).toHaveAttribute('aria-current', 'step');
  await page.locator('#mission-finish').click();
  await expect(page.locator('#mission-completed')).toHaveText('6 / 6');
  await expect(page.locator('#mission-reassignments')).toHaveText('1');
  await expect(page.locator('#mission-time')).toHaveText('22.1 s');
  await page.locator('[data-mission-case="fixed-failure"]').click();
  await page.locator('#mission-finish').click();
  await expect(page.locator('#mission-status')).toHaveText('Blocked');
  await expect(page.locator('#mission-completed')).toHaveText('4 / 6');
  await expect(page.locator('.mission-task[data-stranded="true"]')).toHaveCount(2);
  await expect(page.locator('#mission-outcome')).toContainText('T2, T5');
  await expect(page.locator('#mission-step')).toBeDisabled();
  await page.locator('#mission-reset').click();
  await expect(page.locator('#mission-policy')).toHaveValue('fixed');
  await expect(page.locator('#mission-failure')).toHaveValue('a2');
  await expect(page.locator('#mission-step-count')).toHaveText('0');
  await expect(page.locator('#mission-step')).toBeEnabled();
});

test('both views, camera motion and timed playback preserve the mission sequence', async ({ page }) => {
  await freezeClock(page);
  await page.locator('#mission-speed').selectOption('2');
  await page.locator('#mission-play').click();
  await page.clock.runFor(1000);
  await page.locator('#mission-play').click();
  const slow = await snapshot(page);
  expect(slow.step).toBe('2');
  await page.locator('#mission-reset').click();
  await page.locator('#mission-speed').selectOption('40');
  await page.locator('#mission-play').click();
  await page.clock.runFor(50);
  await page.locator('#mission-play').click();
  expect(await snapshot(page)).toEqual(slow);
  await page.locator('#mission-3d').click();
  const canvas = page.locator('#mission-viewport canvas');
  await expect(canvas).toBeVisible();
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
  await page.locator('#mission-2d').click();
  await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(slow);
});

test('keyboard, mobile layout and navigation keep all workshops usable', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  const agent = page.locator('[data-mission-agent="2"]');
  await agent.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#mission-agent-name')).toHaveText('A3');
  await expect(agent).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#mission-boundary').click();
  await expect(page.locator('#mission-step-count')).toHaveText('50');
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(4);
  await navigation.getByRole('link', { name: '02 / Potential fields', exact: true }).click();
  await expect(page.locator('#movement-step-count')).toHaveText('0');
  await page.getByRole('link', { name: '03 / Task allocation', exact: true }).click();
  await expect(page.locator('#mission-step-count')).toHaveText('0');
});

test('unavailable WebGL leaves the mission fully operable in 2D', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload();
  await page.locator('#mission-3d').click();
  await expect(page.locator('#mission-viewport')).toContainText(/unavailable/i);
  await page.locator('#mission-2d').click();
  await page.locator('#mission-finish').click();
  await expect(page.locator('#mission-completed')).toHaveText('6 / 6');
  await expect(page.locator('#mission-status')).toHaveText('Completed');
});
