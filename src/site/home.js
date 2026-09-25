import { drawArgosTerrain } from './terrain.js';

// Old workshop-1 bookmarks still resolve after its move away from the home page.
const consensusAnchors = new Set([
  'lesson-title', 'prediction-feedback', 'method-profile-title', 'experiment',
  'run-status', 'topology-label', 'view-2d', 'view-3d', 'graph-viewport', 'view-hint',
  'play', 'step-button', 'reset', 'speed', 'step-count', 'disagreement',
  'current-mean', 'initial-mean', 'component-count', 'component-label', 'preset',
  'topology-help', 'initial-form', 'value-inputs', 'apply-values', 'input-error',
  'edge-count', 'link-controls', 'event-count', 'event-log', 'replay', 'chart-title',
  'history-chart', 'agreement-status', 'advance-100', 'run-budget', 'state-title',
  'state-table', 'agent-detail', 'exchanges-per-step', 'total-exchanges',
  'field-notes', 'notes-title', 'shift-values', 'exercise-notice', 'comparison-table',
  'model', 'model-title',
]);

function redirectLegacyAnchor() {
  let anchor;
  try { anchor = decodeURIComponent(location.hash.slice(1)); } catch { return false; }
  if (!consensusAnchors.has(anchor)) return false;
  location.replace(`${import.meta.env.BASE_URL}consensus/${location.search}${location.hash}`);
  return true;
}
window.addEventListener('hashchange', redirectLegacyAnchor);

if (!redirectLegacyAnchor()) {
  const canvas = document.querySelector('#home-terrain');
  const controls = document.querySelector('.figure-controls');
  const still = document.querySelector('.terrain-still');
  let layer = 'routes';
  let pending = false;
  const draw = () => {
    pending = false;
    drawArgosTerrain(canvas, { layer, accent: '#e45a4c' });
  };
  if (canvas.getContext('2d')) {
    canvas.hidden = false;
    still.hidden = true;
    controls.hidden = false;
    draw();
    controls.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-layer]');
      if (!button) return;
      layer = button.dataset.layer;
      controls.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      canvas.setAttribute('aria-label', `Schematic drawing of three quadrotors and illustrative ${layer === 'network' ? 'communication links' : 'paths'} above a wireframe terrain. No mission is being simulated.`);
      draw();
    });
    // Redraw only on a size change, never as a continuously animated scene.
    new ResizeObserver(() => {
      if (!pending) { pending = true; requestAnimationFrame(draw); }
    }).observe(canvas.parentElement);
  }
}
