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
  const topics = document.querySelector('.home-topics[role="group"]');
  const still = document.querySelector('.terrain-still');
  const topicDescriptions = {
    coordination: {
      index: 'Fig. 01 / Coordination', title: 'Thinking together.',
      description: 'A shared decision can emerge from many small exchanges.',
      question: 'Can a group agree without a leader?',
      route: 'consensus/', legend: 'Local connections',
      drawing: 'four quadrotors with local communication links',
    },
    motion: {
      index: 'Fig. 02 / Motion', title: 'Finding a way through.',
      description: 'A destination is only the beginning. The space between matters.',
      question: 'What makes a route a good route?',
      route: 'pathfinding/', legend: 'A possible route',
      drawing: 'a schematic route around an obstacle',
    },
    perception: {
      index: 'Fig. 03 / Perception', title: 'Making sense of signals.',
      description: 'Measurements give a robot clues about where it might be.',
      question: 'How does a robot know where it is?',
      route: 'localization/', legend: 'Illustrative observations',
      drawing: 'a quadrotor and illustrative observation rings',
    },
  };
  const initialView = { yaw: 0, pitch: 0.45, panX: 0, panY: 0 };
  const view = { ...initialView };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let theme = 'coordination';
  let pending = false;
  let drag = null;
  const draw = () => {
    pending = false;
    drawArgosTerrain(canvas, { theme, ...view });
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
    topics.hidden = false;
    document.querySelector('.home-topics-fallback').hidden = true;
    draw();
    controls.querySelector('[data-reset-view]').addEventListener('click', resetView);
    topics.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-topic]');
      if (!button) return;
      theme = button.dataset.topic;
      const topic = topicDescriptions[theme];
      topics.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      document.querySelector('.scene-index').textContent = topic.index;
      document.querySelector('.scene-title').textContent = topic.title;
      document.querySelector('.scene-description').textContent = topic.description;
      document.querySelector('.scene-question').textContent = topic.question;
      document.querySelector('.scene-link').href = `${import.meta.env.BASE_URL}${topic.route}`;
      document.querySelector('.scene-legend').textContent = topic.legend;
      canvas.setAttribute('aria-label', `Schematic drawing of ${topic.drawing} above a layered landscape. No mission is being simulated.`);
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
