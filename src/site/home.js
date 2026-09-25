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
  const help = document.querySelector('#home-view-help');
  const initialView = { yaw: 0, pitch: 0.45, panX: 0, panY: 0 };
  const view = { ...initialView };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let layer = 'routes';
  let pending = false;
  let drag = null;
  const draw = () => {
    pending = false;
    drawArgosTerrain(canvas, { layer, accent: '#e45a4c', ...view });
  };
  const requestDraw = () => {
    if (!pending) { pending = true; requestAnimationFrame(draw); }
  };
  const stopDrag = () => {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const resetView = () => {
    stopDrag();
    Object.assign(view, initialView);
    requestDraw();
  };
  if (canvas.getContext('2d')) {
    canvas.hidden = false;
    still.hidden = true;
    controls.hidden = false;
    help.hidden = false;
    draw();
    controls.addEventListener('click', (event) => {
      if (event.target.closest('[data-reset-view]')) { resetView(); return; }
      const button = event.target.closest('button[data-layer]');
      if (!button) return;
      layer = button.dataset.layer;
      controls.querySelectorAll('button[data-layer]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      canvas.setAttribute('aria-label', `Schematic drawing of three quadrotors and illustrative ${layer === 'network' ? 'communication links' : 'paths'} above a wireframe terrain. No mission is being simulated.`);
      requestDraw();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || drag) return;
      const rect = canvas.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        width: rect.width, height: rect.height, pan: event.shiftKey, view: { ...view } };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = 'true';
      canvas.focus({ preventScroll: true });
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) { stopDrag(); return; }
      const dx = (event.clientX - drag.x) / drag.width;
      const dy = (event.clientY - drag.y) / drag.height;
      if (drag.pan) {
        view.panX = clamp(drag.view.panX + dx, -0.35, 0.35);
        view.panY = clamp(drag.view.panY + dy, -0.35, 0.35);
      } else {
        view.yaw = (drag.view.yaw + dx * Math.PI * 2) % (Math.PI * 2);
        view.pitch = clamp(drag.view.pitch - dy * 1.25, 0.18, 1.1);
      }
      requestDraw();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (event) => {
        if (drag && event.pointerId === drag.id) stopDrag();
      });
    }
    canvas.addEventListener('blur', stopDrag);
    window.addEventListener('blur', stopDrag);
    canvas.addEventListener('dblclick', (event) => { event.preventDefault(); resetView(); });
    canvas.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Home') { event.preventDefault(); resetView(); return; }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      stopDrag();
      if (event.shiftKey) {
        view.panX = clamp(view.panX + direction[0] * 0.03, -0.35, 0.35);
        view.panY = clamp(view.panY + direction[1] * 0.03, -0.35, 0.35);
      } else {
        view.yaw = (view.yaw + direction[0] * 0.12) % (Math.PI * 2);
        view.pitch = clamp(view.pitch - direction[1] * 0.07, 0.18, 1.1);
      }
      requestDraw();
    });
    // Render input changes and resizing only; the illustration never runs a simulation.
    new ResizeObserver(requestDraw).observe(canvas.parentElement);
  }
}
