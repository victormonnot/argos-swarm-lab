import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const initialValues = [0, 2, 4, 8, 10, 12];
const browserErrors = new WeakMap();

async function values(page) {
  return page.locator('#state-table [data-agent-value]').allTextContents()
    .then((cells) => cells.map((cell) => Number.parseFloat(cell)));
}

async function step(page) {
  return Number(await page.locator('#step-count').textContent());
}

async function expectValues(page, expected) {
  const actual = await values(page);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 3));
}

async function snapshot(page) {
  return {
    step: await step(page),
    values: await values(page),
    rawValues: await page.locator('#state-table [data-agent-value]').evaluateAll((cells) =>
      cells.map((cell) => cell.dataset.rawValue)),
    disagreement: await page.locator('#disagreement').textContent(),
    mean: await page.locator('#current-mean').textContent(),
    events: await page.locator('#event-log').textContent(),
    history: await page.locator('#history-chart').innerHTML(),
    exchanges: await page.locator('#total-exchanges').textContent(),
  };
}

async function screenshot(page, path) {
  await mkdir('local', { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#step-count')).toHaveText('0');
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'The lesson must not emit browser errors').toEqual([]);
});

test('one step, play/pause, and reset follow the synchronous complete-graph rule', async ({ page }) => {
  await expectValues(page, initialValues);
  await page.locator('#step-button').click();
  await expect(page.locator('#step-count')).toHaveText('1');
  await expectValues(page, [3, 4, 5, 7, 8, 9]);
  expect(Number.parseFloat(await page.locator('#disagreement').textContent())).toBe(6);
  expect(Number.parseFloat(await page.locator('#current-mean').textContent())).toBe(6);

  await page.locator('#speed').selectOption('60');
  await page.locator('#play').click();
  await expect(page.locator('#link-2-3')).toBeDisabled();
  await expect.poll(() => step(page)).toBeGreaterThan(1);
  await page.locator('#play').click();
  await expect(page.locator('#link-2-3')).toBeEnabled();
  const paused = await snapshot(page);
  await page.waitForTimeout(120);
  expect(await snapshot(page)).toEqual(paused);

  await page.locator('#reset').click();
  await expect(page.locator('#step-count')).toHaveText('0');
  await expectValues(page, initialValues);
});

test('initial values start a fresh run and a common shift preserves disagreement', async ({ page }) => {
  await page.locator('#step-button').click();
  const baseline = Number.parseFloat(await page.locator('#disagreement').textContent());
  await page.locator('#shift-values').click();
  await expect(page.locator('#step-count')).toHaveText('0');
  await expectValues(page, initialValues.map((value) => value + 100));
  expect(Number.parseFloat(await page.locator('#current-mean').textContent())).toBe(106);
  await page.locator('#step-button').click();
  expect(Number.parseFloat(await page.locator('#disagreement').textContent())).toBe(baseline);
  await expectValues(page, [103, 104, 105, 107, 108, 109]);

  for (let index = 0; index < 6; index += 1) {
    await page.locator(`#initial-${index}`).fill('7');
  }
  await page.locator('#apply-values').click();
  await expect(page.locator('#step-count')).toHaveText('0');
  await page.locator('#step-button').click();
  await expectValues(page, Array(6).fill(7));
  expect(Number.parseFloat(await page.locator('#disagreement').textContent())).toBe(0);
});

test('link edits preserve current values and replay includes the final boundary event', async ({ page }) => {
  await page.locator('#preset').selectOption('chain');
  const bridge = page.locator('#link-2-3');
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
  await bridge.click();
  await expectValues(page, initialValues);
  await page.locator('#step-button').click();
  await page.locator('#step-button').click();
  const partitionValues = await values(page);
  await bridge.click();
  expect(await values(page)).toEqual(partitionValues);
  await page.locator('#step-button').click();
  await bridge.click();
  await expect(bridge).toHaveAttribute('aria-pressed', 'false');
  const recorded = await snapshot(page);
  expect(recorded.step).toBe(3);

  await page.locator('#initial-0').fill('999');
  await page.locator('#speed').selectOption('60');
  await page.locator('.replay-details summary').click();
  await page.locator('#replay').click();
  await expect(page.locator('#preset')).toBeDisabled();
  await expect(page.locator('#initial-0')).toBeDisabled();
  await expect(page.locator('#initial-0')).toHaveValue('0');
  await expect(page.locator('#apply-values')).toBeDisabled();
  await expect(page.locator('#shift-values')).toBeDisabled();
  await expect(bridge).toBeDisabled();
  await expect.poll(() => step(page)).toBe(3);
  expect(await snapshot(page)).toEqual(recorded);
  await expect(bridge).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#reset').click();
  await expect(page.locator('#preset')).toBeEnabled();
  await expect(page.locator('#step-count')).toHaveText('0');
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
  await expectValues(page, initialValues);
});

test('both views and playback speed preserve the model step sequence', async ({ page }) => {
  await page.locator('#preset').selectOption('chain');
  await page.locator('#step-button').click();
  const beforeView = await snapshot(page);
  await page.locator('#view-3d').click();
  await expect(page.locator('#graph-viewport canvas')).toBeVisible();
  expect(await snapshot(page)).toEqual(beforeView);
  await screenshot(page, 'local/desktop-3d.png');
  const canvas = page.locator('#graph-viewport canvas');
  await canvas.scrollIntoViewIfNeeded();
  const labelPositions = () => page.locator('.graph-three-label').evaluateAll((labels) =>
    labels.map((label) => [label.style.left, label.style.top]));
  const beforeOrbit = await labelPositions();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75 + 60, bounds.y + bounds.height * 0.65, { steps: 6 });
  await page.mouse.up();
  await expect.poll(labelPositions).not.toEqual(beforeOrbit);
  expect(await snapshot(page)).toEqual(beforeView);
  await page.locator('#view-2d').click();
  await expect(page.locator('#graph-viewport .graph-svg')).toBeVisible();
  await expect(page.locator('#graph-viewport canvas')).toBeHidden();
  expect(await snapshot(page)).toEqual(beforeView);

  const slowSequence = [];
  await page.locator('#speed').selectOption('1');
  for (let index = 0; index < 4; index += 1) {
    await page.locator('#step-button').click();
    slowSequence.push(await values(page));
  }
  await page.locator('#reset').click();
  await page.locator('#speed').selectOption('60');
  await page.locator('#step-button').click();
  for (const expected of slowSequence) {
    await page.locator('#step-button').click();
    expect(await values(page)).toEqual(expected);
  }
});

test('the partition visibly misses the budget and reconnecting resumes agreement', async ({ page }) => {
  await page.locator('#preset').selectOption('groups');
  await page.locator('#run-budget').click();
  await expect(page.locator('#step-count')).toHaveText('1000');
  await expectValues(page, [2, 2, 2, 10, 10, 10]);
  expect(Number.parseFloat(await page.locator('#disagreement').textContent())).toBeCloseTo(8, 3);
  await expect(page.locator('#agreement-status')).toContainText(/not reached|not met|without agreement|budget exhausted/i);

  await page.locator('#preset').selectOption('chain');
  await page.locator('#link-2-3').click();
  await page.locator('#advance-100').click();
  await expect(page.locator('#step-count')).toHaveText('100');
  await expect(page.locator('#advance-100')).toBeDisabled();
  const partitionValues = await values(page);
  await page.locator('#link-2-3').click();
  expect(await values(page)).toEqual(partitionValues);
  await page.locator('#run-budget').click();
  await expect(page.locator('#step-count')).toHaveText('1000');
  expect(Number.parseFloat(await page.locator('#disagreement').textContent())).toBeLessThanOrEqual(0.01);
  await expectValues(page, Array(6).fill(6));
});

test('the lesson remains usable on a narrow screen', async ({ page }) => {
  await screenshot(page, 'local/desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#step-button')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#step-button').click();
  await expect(page.locator('#step-count')).toHaveText('1');
  await expectValues(page, [3, 4, 5, 7, 8, 9]);
  await screenshot(page, 'local/mobile.png');
});

test('keyboard navigation exposes the skip link and selects an agent in the graph', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#experiment$/);

  await page.locator('#preset').selectOption('chain');
  const thirdAgent = page.locator('#graph-viewport .graph-node[data-agent="2"]');
  await thirdAgent.focus();
  await page.keyboard.press('Enter');
  await expect(thirdAgent).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#state-table tbody tr.selected')).toContainText('A3');
  await expect(page.locator('#agent-detail')).toContainText('A3 reads A2 = 2.00, A4 = 8.00.');
  await expect(page.locator('#agent-detail')).toContainText('4.166667');
  const fifthAgent = page.locator('#graph-viewport .graph-node[data-agent="4"]');
  await fifthAgent.focus();
  await page.keyboard.press('Space');
  await expect(fifthAgent).toHaveAttribute('aria-pressed', 'true');
  await expect(thirdAgent).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#step-count')).toHaveText('0');
  await expectValues(page, initialValues);
});

test('the comparison table reports measured successes and a failure without changing the run', async ({ page }) => {
  await page.locator('#step-button').click();
  const beforeComparison = await snapshot(page);
  await page.locator('.comparison-details summary').click();
  const rows = page.locator('#comparison-table tbody tr');
  await expect(rows).toHaveCount(5);
  const outcomes = await rows.evaluateAll((elements) => elements.map((row) =>
    Array.from(row.cells).slice(0, 3).map((cell) => cell.textContent)));
  expect(outcomes).toEqual([
    ['Complete graph', 'Step 11', '330'],
    ['Chain', 'Step 314', '3,140'],
    ['Two groups', 'Not reached in 1,000 steps', '—'],
    ['Chain: cut at 0, reconnect at 100', 'Step 406', '3,860'],
    ['Complete graph: all values +100', 'Step 11', '330'],
  ]);
  expect(await snapshot(page)).toEqual(beforeComparison);
  await page.locator('.comparison-details summary').click();
  await page.locator('.comparison-details summary').click();
  await expect(rows).toHaveCount(5);
});

test('timed playback follows the same exact trace at 1 and 20 steps per second', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.reload();
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#preset').selectOption('chain');
  await page.locator('#speed').selectOption('1');
  await page.locator('#play').click();
  const slowTrace = [];
  for (let expectedStep = 1; expectedStep <= 4; expectedStep += 1) {
    await page.clock.runFor(1000);
    await expect(page.locator('#step-count')).toHaveText(String(expectedStep));
    slowTrace.push(await snapshot(page));
  }
  await page.locator('#play').click();
  await page.locator('#reset').click();
  await page.locator('#speed').selectOption('20');
  await page.locator('#play').click();
  for (const expected of slowTrace) {
    await page.clock.runFor(50);
    expect(await snapshot(page)).toEqual(expected);
  }
  await page.locator('#play').click();
  const paused = await snapshot(page);
  await page.clock.runFor(10000);
  expect(await snapshot(page)).toEqual(paused);
});

test('a browser without WebGL 2 can continue the same experiment in 2D', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : originalGetContext.call(this, kind, ...args);
    };
  });
  await page.reload();
  await page.locator('#step-button').click();
  const beforeView = await snapshot(page);
  await page.locator('#view-3d').click();
  await expect(page.locator('.graph-unavailable')).toContainText('3D is unavailable in this browser');
  await expect(page.locator('.graph-unavailable')).toContainText('Switch to 2D');
  expect(await snapshot(page)).toEqual(beforeView);
  // Three reports the intentionally blocked context once; other errors still fail.
  const errors = browserErrors.get(page);
  const expectedDiagnostic = errors.indexOf('THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.');
  if (expectedDiagnostic !== -1) errors.splice(expectedDiagnostic, 1);
  await page.locator('#view-2d').click();
  await expect(page.locator('#graph-viewport .graph-svg')).toBeVisible();
  await page.locator('#step-button').click();
  await expect(page.locator('#step-count')).toHaveText('2');
  await expectValues(page, [4.5, 5, 5.5, 6.5, 7, 7.5]);
});
