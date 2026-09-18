import { test, expect } from '@playwright/test';

const errorsByPage = new WeakMap();
const raw = async (page, selector, attribute) => JSON.parse(await page.locator(selector).getAttribute(attribute));
const poses = page => page.locator('#graph-pose-table tbody tr').evaluateAll(rows => rows.map(row => JSON.parse(row.dataset.pose)));
const metric = async (page, id) => Number.parseFloat((await page.locator(id).textContent()).replaceAll(',', ''));
const edgeMeasurement = page => raw(page, '#graph-edge-details', 'data-measurement');
const snapshot = async page => ({
  iteration: await page.locator('#graph-iteration').textContent(),
  accepted: await page.locator('#graph-accepted-steps').textContent(),
  poses: await poses(page),
  cost: await page.locator('#graph-cost').textContent(),
  error: await page.locator('#graph-trajectory-error').textContent(),
  endpoint: await page.locator('#graph-endpoint-error').textContent(),
  endpointHeading: await page.locator('#graph-endpoint-heading').textContent(),
  correction: await page.locator('#graph-max-correction').textContent(),
});

const displayedGraph = page => page.locator('#graph-viewport').evaluate(viewport => ({
  poses: JSON.parse(viewport.dataset.displayPoses),
  progress: Number(viewport.dataset.transitionProgress),
  animating: viewport.dataset.animating,
  comparison: viewport.dataset.comparison,
}));
const wrappedAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
function expectInterpolatedPoses(display, from, to) {
  expect(display.animating).toBe('true');
  expect(display.progress).toBeGreaterThan(0);
  expect(display.progress).toBeLessThan(1);
  expect(display.poses).not.toEqual(from);
  expect(display.poses).not.toEqual(to);
  expect(display.poses[0]).toEqual(from[0]);
  for (let index = 0; index < from.length; index++) {
    for (const axis of [0, 1]) {
      expect(display.poses[index][axis]).toBeCloseTo(from[index][axis] + display.progress * (to[index][axis] - from[index][axis]), 9);
    }
    const headingChange = wrappedAngle(to[index][2] - from[index][2]);
    expect(wrappedAngle(display.poses[index][2] - from[index][2])).toBeCloseTo(display.progress * headingChange, 9);
  }
}
async function animationClock(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.reload();
  await expect(page.locator('#graph-iteration')).toHaveText('0');
  await expect(page.locator('#graph-viewport canvas')).toBeVisible();
  await page.locator('#graph-2d').click();
}

test.beforeEach(async ({ page }) => {
  const errors = []; errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/pose-graph/');
  await expect(page.locator('#graph-iteration')).toHaveText('0');
  await expect(page.locator('#graph-pose-table tbody tr')).toHaveCount(25);
});
test.afterEach(async ({ page }) => expect(errorsByPage.get(page)).toEqual([]));

test('one loop optimization revises historical poses while anchor and recordings stay fixed', async ({ page }) => {
  await expect(page.locator('.method-profile')).toContainText('Gauss–Newton');
  await page.locator('#graph-pose-index').fill('12');
  await page.locator('#graph-edge').selectOption('loop');
  const initial = await poses(page), measurement = await edgeMeasurement(page);
  const truth = await raw(page, '#graph-pose-truth', 'data-pose');
  const residual = await raw(page, '#graph-edge-details', 'data-residual');
  const cost = await metric(page, '#graph-cost');
  expect(await raw(page, '#graph-pose-initial', 'data-pose')).toEqual(initial[12]);
  await page.locator('#graph-step').click();
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  await expect(page.locator('#graph-accepted-steps')).toHaveText('1');
  const current = await poses(page);
  expect(current[0]).toEqual(initial[0]);
  expect(current[12]).not.toEqual(initial[12]);
  expect(current[24]).not.toEqual(initial[24]);
  expect(await metric(page, '#graph-cost')).toBeLessThan(cost);
  expect(await raw(page, '#graph-pose-truth', 'data-pose')).toEqual(truth);
  expect(await raw(page, '#graph-pose-initial', 'data-pose')).toEqual(initial[12]);
  expect(await edgeMeasurement(page)).toEqual(measurement);
  expect(await raw(page, '#graph-edge-details', 'data-residual')).not.toEqual(residual);
  await expect(page.locator('#graph-selected-time')).toContainText('12 s');
  await expect(page.locator('#graph-step-result')).toContainText(/accepted/i);
});

test('an odometry-only graph stops without correcting its nonzero physical drift', async ({ page }) => {
  await page.locator('#graph-scenario').selectOption('no-loop');
  const initial = await poses(page), error = await metric(page, '#graph-trajectory-error');
  expect(error).toBeGreaterThan(0.1);
  await page.locator('#graph-finish').click();
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  await expect(page.locator('#graph-accepted-steps')).toHaveText('0');
  await expect(page.locator('#graph-status')).toContainText(/stationary/i);
  expect(await poses(page)).toEqual(initial);
  expect(await metric(page, '#graph-cost')).toBeLessThan(1e-8);
  expect(await metric(page, '#graph-trajectory-error')).toEqual(error);
  await expect(page.locator('#graph-step')).toBeDisabled();
  await page.locator('#graph-pose-index').fill('4');
  await expect(page.locator('#graph-selected-time')).toContainText('4 s');
  await expect(page.locator('#graph-edge option')).toHaveCount(24);
});

test('wrong endpoint IDs reuse the loop measurement and can lower cost while worsening accuracy', async ({ page }) => {
  await page.locator('#graph-edge').selectOption('loop');
  await expect(page.locator('#graph-edge-details')).toHaveAttribute('data-from', '0');
  await expect(page.locator('#graph-edge-details')).toHaveAttribute('data-to', '24');
  const initial = await poses(page), measurement = await edgeMeasurement(page);
  const initialError = await metric(page, '#graph-trajectory-error');
  await page.locator('#graph-finish').click();
  const correctError = await metric(page, '#graph-trajectory-error');
  expect(correctError).toBeLessThan(initialError);
  await page.locator('#graph-scenario').selectOption('wrong-loop');
  await page.locator('#graph-edge').selectOption('loop');
  await expect(page.locator('#graph-edge-details')).toHaveAttribute('data-to', '18');
  expect(await edgeMeasurement(page)).toEqual(measurement);
  expect(await poses(page)).toEqual(initial);
  const initialWrongCost = await metric(page, '#graph-cost');
  await page.locator('#graph-finish').click();
  expect(await metric(page, '#graph-cost')).toBeLessThan(initialWrongCost);
  expect(await metric(page, '#graph-trajectory-error')).toBeGreaterThan(initialError);
  expect((await poses(page))[0]).toEqual(initial[0]);
  expect(await edgeMeasurement(page)).toEqual(measurement);
  await expect(page.locator('#graph-outcome')).toContainText(/wrong|incorrect|distort/i);
  await expect(page.locator('#graph-step')).toBeDisabled();
});

test('historical selection, edge inspection and overlays do not advance or alter optimization', async ({ page }) => {
  await page.locator('#graph-step').click();
  const before = await snapshot(page);
  await page.locator('#graph-pose-index').focus();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#graph-pose-index')).toHaveValue('1');
  await expect(page.locator('#graph-selected-time')).toContainText('1 s');
  await page.locator('#graph-pose-next').click();
  await expect(page.locator('#graph-pose-index')).toHaveValue('2');
  await page.locator('#graph-pose-previous').click();
  await page.locator('#graph-edge').selectOption('O12');
  const odometry = await edgeMeasurement(page);
  await page.locator('#graph-edge').selectOption('loop');
  expect(await edgeMeasurement(page)).not.toEqual(odometry);
  for (const id of ['#graph-show-truth', '#graph-show-initial', '#graph-show-corrections']) await page.locator(id).click();
  expect(await snapshot(page)).toEqual(before);
});

test('a numerical line-search stop preserves the last accepted poses and explains rejected trials', async ({ page }) => {
  await page.locator('#graph-seed').fill('1'); await page.locator('#graph-seed').press('Tab');
  let previous;
  for (let attempt = 0; attempt < 30 && await page.locator('#graph-step').isEnabled(); attempt++) {
    previous = await snapshot(page);
    await page.locator('#graph-step').click();
  }
  await expect(page.locator('#graph-status')).toHaveText('Line search stopped');
  const stopped = await snapshot(page);
  expect(stopped.poses).toEqual(previous.poses);
  expect(stopped.accepted).toEqual(previous.accepted);
  expect(stopped.cost).toEqual(previous.cost);
  expect(Number(stopped.iteration)).toBe(Number(previous.iteration) + 1);
  await expect(page.locator('#graph-step-result')).toContainText('No pose update applied');
  const trials = page.locator('#graph-trials tr');
  await expect(trials).toHaveCount(21);
  const diagnostics = await trials.evaluateAll(rows => rows.map(row => ({ gap: Number(row.dataset.costGap), accepted: row.dataset.accepted })));
  expect(diagnostics.every(trial => trial.gap > 0 && trial.accepted === 'false')).toBe(true);
  expect(Math.min(...diagnostics.map(trial => trial.gap))).toBeLessThan(1e-12);
  await page.locator('#graph-comparisons summary').click();
  await expect(page.locator('#graph-ensemble')).toContainText('Numerical-stop replay seeds: 1 (line search stopped)');
  await expect(page.locator('#graph-ensemble')).toContainText('computed in this browser');
  expect(await snapshot(page)).toEqual(stopped);
});

test('seeded reset reproduces optimization and reference copies preserve active state', async ({ page }) => {
  await page.locator('#graph-seed').fill('42'); await page.locator('#graph-seed').press('Tab');
  await page.locator('#graph-step').click(); await page.locator('#graph-step').click();
  await page.locator('#graph-pose-index').fill('8');
  const before = await snapshot(page);
  await page.locator('#graph-comparisons summary').click();
  await expect(page.locator('#graph-reference-table tr')).toHaveCount(3);
  await expect(page.locator('#graph-ensemble')).toContainText('100');
  await expect(page.locator('#graph-ensemble')).toContainText(/line search|line-search/i);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#graph-pose-index')).toHaveValue('8');
  await page.locator('#graph-reset').click();
  await expect(page.locator('#graph-seed')).toHaveValue('42');
  await page.locator('#graph-step').click(); await page.locator('#graph-step').click();
  expect(await snapshot(page)).toEqual(before);
});

test('iteration playback changes wall-clock pacing and reproduces the manual step', async ({ page }) => {
  await page.locator('#graph-2d').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#graph-play').click(); await page.clock.runFor(1010); await page.locator('#graph-play').click();
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  const once = await snapshot(page);
  await page.clock.runFor(1100); expect(await snapshot(page)).toEqual(once);
  await page.locator('#graph-reset').click(); await page.locator('#graph-step').click();
  expect(await snapshot(page)).toEqual(once);
  await page.locator('#graph-reset').click(); await page.locator('#graph-speed').selectOption('4');
  await page.locator('#graph-play').click(); await page.clock.runFor(260); await page.locator('#graph-play').click();
  expect(await snapshot(page)).toEqual(once);
});

test('camera controls, linked views and WebGL context loss preserve the same historical graph', async ({ page }) => {
  await page.locator('#graph-step').click();
  const before = await snapshot(page), canvas = page.locator('#graph-viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#graph-camera-focus').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#graph-camera-overview').click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 5 }); await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#graph-2d').click(); await expect(page.locator('.graph-svg')).toBeVisible(); await expect(canvas).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#graph-3d').click(); await expect(page.locator('.graph-svg')).toBeHidden();
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.graph-svg')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#graph-step').click(); await expect(page.locator('#graph-iteration')).toHaveText('2');
});

test('mobile navigation and unavailable WebGL keep inspectors and controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.reload(); await expect(page.locator('.graph-svg')).toBeVisible();
  await page.locator('#graph-finish').click();
  await page.locator('#graph-comparisons summary').click();
  await expect(page.locator('#graph-reference-table tr')).toHaveCount(3);
  await page.locator('#graph-pose-index').fill('18');
  await page.locator('#graph-edge').selectOption('O18');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Workshops', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(20);
  await navigation.getByRole('link', { name: '12 / EKF-SLAM', exact: true }).click();
  await expect(page.locator('#slam-step-count')).toHaveText('0');
  await page.goBack(); await expect(page.locator('#graph-iteration')).toHaveText('0');
  await page.locator('#graph-step').click(); await expect(page.locator('#graph-iteration')).toHaveText('1');
});

test('accepted steps interpolate fixed solver results and retarget from the currently displayed historical poses', async ({ page }) => {
  await animationClock(page);
  await expect(page.locator('#graph-show-corrections')).toBeChecked();
  const initial = await poses(page), measurement = await edgeMeasurement(page);
  const truth = await raw(page, '#graph-pose-truth', 'data-pose');
  const initialPath = await page.locator('[data-graph-current-path]').getAttribute('points');
  const initialMarker = await page.locator('[data-graph-svg-pose="12"]').getAttribute('transform');
  await page.locator('#graph-step').click();
  const solved = await snapshot(page);
  expect(solved.iteration).toBe('1');
  expect(solved.poses).not.toEqual(initial);
  await expect(page.locator('#graph-after')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(400);
  const halfway = await displayedGraph(page);
  expectInterpolatedPoses(halfway, initial, solved.poses);
  const renderedPoses = await page.locator('[data-graph-svg-pose]').evaluateAll(nodes => nodes.map(node => JSON.parse(node.dataset.pose)));
  expect(renderedPoses).toEqual(halfway.poses);
  expect(await page.locator('[data-graph-current-path]').getAttribute('points')).not.toEqual(initialPath);
  expect(await page.locator('[data-graph-svg-pose="12"]').getAttribute('transform')).not.toEqual(initialMarker);
  const correction = page.locator('[data-graph-correction-arrow="12"]');
  await expect(correction.locator('path')).toBeVisible();
  expect(JSON.parse(await correction.getAttribute('data-from'))).toEqual(initial[12]);
  expect(JSON.parse(await correction.getAttribute('data-to'))).toEqual(halfway.poses[12]);
  expect(await snapshot(page)).toEqual(solved);
  expect(await edgeMeasurement(page)).toEqual(measurement);
  expect(await raw(page, '#graph-pose-truth', 'data-pose')).toEqual(truth);
  await expect(page.locator('#graph-presentation-status')).not.toBeEmpty();
  await expect(page.locator('#graph-presentation-note')).not.toBeEmpty();
  await page.locator('#graph-step').click();
  const solvedAgain = await snapshot(page);
  expect(solvedAgain.iteration).toBe('2');
  expect((await displayedGraph(page)).poses).toEqual(halfway.poses);
  await page.clock.runFor(400);
  expectInterpolatedPoses(await displayedGraph(page), halfway.poses, solvedAgain.poses);
  expect(await snapshot(page)).toEqual(solvedAgain);
  expect(await edgeMeasurement(page)).toEqual(measurement);
  await page.clock.runFor(550);
  const finished = await displayedGraph(page);
  expect(finished.animating).toBe('false');
  expect(finished.progress).toBe(1);
  expect(finished.poses).toEqual(solvedAgain.poses);
  expect(await snapshot(page)).toEqual(solvedAgain);
});

test('before and after compare the initial and solved recordings without changing results and both stop playback', async ({ page }) => {
  await animationClock(page);
  const initial = await poses(page), measurement = await edgeMeasurement(page);
  await page.locator('#graph-finish').click();
  const solved = await snapshot(page);
  await page.clock.runFor(1000);
  expect((await displayedGraph(page)).poses).toEqual(solved.poses);
  await page.locator('#graph-before').click();
  await expect(page.locator('#graph-before')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#graph-after')).toHaveAttribute('aria-pressed', 'false');
  await page.clock.runFor(400);
  expectInterpolatedPoses(await displayedGraph(page), solved.poses, initial);
  expect(await snapshot(page)).toEqual(solved);
  await page.clock.runFor(600);
  const beforeDisplay = await displayedGraph(page);
  expect(beforeDisplay.comparison).toBe('before');
  expect(beforeDisplay.poses).toEqual(initial);
  expect(beforeDisplay.animating).toBe('false');
  expect(await edgeMeasurement(page)).toEqual(measurement);
  await page.locator('#graph-after').click();
  await expect(page.locator('#graph-after')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(1000);
  expect((await displayedGraph(page)).poses).toEqual(solved.poses);
  expect(await snapshot(page)).toEqual(solved);

  for (const comparison of ['before', 'after']) {
    await page.locator('#graph-reset').click();
    await page.locator('#graph-play').click();
    await page.clock.runFor(1010);
    await expect(page.locator('#graph-iteration')).toHaveText('1');
    await page.locator(`#graph-${comparison}`).click();
    const paused = await snapshot(page);
    await expect(page.locator('#graph-play')).toContainText('Play');
    await page.clock.runFor(2100);
    expect(await snapshot(page)).toEqual(paused);
    const display = await displayedGraph(page);
    expect(display.comparison).toBe(comparison);
    expect(display.animating).toBe('false');
    expect(display.poses).toEqual(comparison === 'before' ? initial : paused.poses);
  }
});

test('view switches, inspection and context loss preserve a transition while faster playback uses the shorter display interval', async ({ page }) => {
  await animationClock(page);
  await page.locator('#graph-step').click();
  const solved = await snapshot(page);
  await page.clock.runFor(140);
  await page.locator('#graph-pose-index').fill('12');
  const persistentMarker = await page.locator('[data-graph-svg-pose="0"]').elementHandle();
  const fixedPose = await page.locator('[data-graph-svg-pose="0"] circle').boundingBox();
  await page.mouse.move(fixedPose.x + fixedPose.width / 2, fixedPose.y + fixedPose.height / 2);
  await page.mouse.down();
  await page.clock.runFor(100);
  await page.mouse.up();
  await expect(page.locator('#graph-pose-index')).toHaveValue('0');
  expect(await persistentMarker.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
  expect(await snapshot(page)).toEqual(solved);
  const in2d = await displayedGraph(page);
  expect(in2d.animating).toBe('true');
  await page.locator('#graph-3d').click();
  await expect(page.locator('#graph-viewport canvas')).toBeVisible();
  expect(await displayedGraph(page)).toEqual(in2d);
  await page.locator('#graph-pose-index').fill('12');
  await page.locator('#graph-edge').selectOption('O12');
  await page.locator('#graph-show-corrections').uncheck();
  await page.locator('#graph-show-truth').uncheck();
  expect(await displayedGraph(page)).toEqual(in2d);
  expect(await snapshot(page)).toEqual(solved);
  await page.clock.runFor(160);
  const later = await displayedGraph(page);
  expect(later.progress).toBeGreaterThan(in2d.progress);
  await page.locator('#graph-2d').click();
  expect(await displayedGraph(page)).toEqual(later);
  await page.locator('#graph-3d').click();
  const canvas = page.locator('#graph-viewport canvas');
  await expect(canvas).toBeVisible();
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('.graph-svg')).toBeVisible();
  expect(await displayedGraph(page)).toEqual(later);
  await page.clock.runFor(550);
  expect((await displayedGraph(page)).poses).toEqual(solved.poses);
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');

  await page.locator('#graph-reset').click();
  await page.locator('#graph-speed').selectOption('4');
  await page.locator('#graph-play').click();
  await page.clock.runFor(350);
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  const fastSolved = await snapshot(page), fastDisplay = await displayedGraph(page);
  expect(fastDisplay.animating).toBe('true');
  expect(fastDisplay.progress).toBeGreaterThan(0);
  expect(fastDisplay.progress).toBeLessThan(1);
  await page.clock.runFor(140);
  await page.locator('#graph-play').click();
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  expect((await displayedGraph(page)).poses).toEqual(fastSolved.poses);
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  expect(await snapshot(page)).toEqual(fastSolved);
});

test('reset, replacement runs, unchanged estimates and reduced motion snap without resurrecting an earlier animation', async ({ page }) => {
  await animationClock(page);
  const initial = await poses(page);
  await page.locator('#graph-step').click();
  await page.clock.runFor(200);
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'true');
  await page.locator('#graph-reset').click();
  await expect(page.locator('#graph-after')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#graph-iteration')).toHaveText('0');
  expect((await displayedGraph(page)).poses).toEqual(initial);
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  const reset = await snapshot(page);
  await page.clock.runFor(1200);
  expect((await displayedGraph(page)).poses).toEqual(initial);
  expect(await snapshot(page)).toEqual(reset);

  await page.locator('#graph-step').click(); await page.clock.runFor(100);
  await page.locator('#graph-scenario').selectOption('wrong-loop');
  await expect(page.locator('#graph-iteration')).toHaveText('0');
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  expect((await displayedGraph(page)).poses).toEqual(await poses(page));
  await page.locator('#graph-step').click(); await page.clock.runFor(100);
  await page.locator('#graph-seed').fill('42'); await page.locator('#graph-seed').press('Tab');
  await expect(page.locator('#graph-iteration')).toHaveText('0');
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  expect((await displayedGraph(page)).poses).toEqual(await poses(page));

  await page.locator('#graph-scenario').selectOption('no-loop');
  const unchanged = await poses(page);
  await page.locator('#graph-finish').click();
  await expect(page.locator('#graph-accepted-steps')).toHaveText('0');
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  expect((await displayedGraph(page)).poses).toEqual(unchanged);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#graph-scenario').selectOption('correct-loop');
  await page.locator('#graph-step').click();
  await expect(page.locator('#graph-iteration')).toHaveText('1');
  const reduced = await snapshot(page);
  await expect(page.locator('#graph-viewport')).toHaveAttribute('data-animating', 'false');
  expect((await displayedGraph(page)).poses).toEqual(reduced.poses);
  await page.clock.runFor(1200);
  expect(await snapshot(page)).toEqual(reduced);
  expect((await displayedGraph(page)).poses).toEqual(reduced.poses);
});
