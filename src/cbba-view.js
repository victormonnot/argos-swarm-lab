import { RESTORE_ROUND } from './cbba-model.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#70d8bf', '#b8acff', '#eec077'];
const sx = (v) => 38 + v * 70;
const sy = (v) => 440 - v * 70;
const node = (tag, attrs = {}, text = '') => {
  const element = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
};

/** View-only topology display for the last exchange (round 1 before stepping). */
export function displayedLinks(run) {
  const round = Math.max(1, run.round);
  const sharing = run.config.method === 'cbba';
  return [
    { from: 0, to: 1, active: sharing },
    { from: 1, to: 2, active: sharing && (run.config.schedule === 'chain' || (run.config.schedule === 'recovery' && round >= RESTORE_ROUND)) },
  ];
}

/** Both views only observe claims. They never move agents or execute tasks. */
export function createCbbaView(container, { selectAgent = () => {} } = {}) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false;
  const svg = node('svg', { viewBox: '0 0 700 510', class: 'cbba-svg', role: 'group', 'aria-label': 'Static agents and tasks with own-bundle claims and communication links. Select an agent to inspect its beliefs.' });
  const layer = Object.assign(document.createElement('div'), { className: 'cbba-three', hidden: true });
  container.append(svg, layer);

  function drawSvg() {
    if (!run) return;
    svg.replaceChildren();
    for (let row = 0; row <= 6; row += 1) svg.append(node('line', { x1: 68, y1: sy(row), x2: 638, y2: sy(row), stroke: '#29453b', 'stroke-width': .7 }));
    svg.append(node('text', { x: 108, y: 45, fill: '#adbdad', 'font-size': 12, 'text-anchor': 'middle' }, 'AGENTS'));
    svg.append(node('text', { x: 493, y: 45, fill: '#adbdad', 'font-size': 12, 'text-anchor': 'middle' }, 'TASKS / OWN-BUNDLE CLAIMS'));
    for (const link of displayedLinks(run)) {
      const a = run.agents[link.from].position, b = run.agents[link.to].position;
      svg.append(node('line', { x1: sx(a[0]), y1: sy(a[1]), x2: sx(b[0]), y2: sy(b[1]), stroke: link.active ? '#a7c1b7' : '#b57759', 'stroke-width': 2, 'stroke-dasharray': link.active ? '5 6' : '2 8', 'data-cbba-link': `${link.from}-${link.to}`, 'data-active': link.active }));
      if (!link.active) svg.append(node('text', { x: sx(a[0]) - 23, y: (sy(a[1]) + sy(b[1])) / 2 + 5, fill: '#e7ab8b', 'font-size': 18 }, '×'));
    }
    run.agents.forEach((agent, index) => {
      for (const taskId of agent.bundle) {
        const task = run.tasks[taskId];
        const line = node('line', { x1: sx(agent.position[0]), y1: sy(agent.position[1]), x2: sx(task.position[0]), y2: sy(task.position[1]), stroke: COLORS[index], 'stroke-width': selected === index ? 2.4 : 1.4, opacity: selected === index ? .95 : .4, 'data-cbba-claim': `${index}-${taskId}` });
        line.append(node('title', {}, `${agent.label} claims ${task.label}; utility ${agent.utilities[taskId]} points. This is not task execution.`)); svg.append(line);
      }
    });
    run.tasks.forEach((task) => {
      const x = sx(task.position[0]), y = sy(task.position[1]);
      const claims = run.agents.filter((agent) => agent.bundle.includes(task.id));
      const tint = claims.length > 1 ? '#f0a784' : claims.length === 1 ? COLORS[claims[0].id] : '#839d8d';
      const group = node('g', { 'data-cbba-task': task.id, 'data-claims': claims.length });
      group.append(node('path', { d: `M${x},${y - 12} L${x + 12},${y} L${x},${y + 12} L${x - 12},${y}Z`, fill: '#233b31', stroke: tint, 'stroke-width': 2 }));
      group.append(node('text', { x, y: y - 23, fill: '#edf3e7', 'font-size': 14, 'text-anchor': 'middle', 'font-weight': 600 }, task.label));
      group.append(node('text', { x, y: y + 30, fill: tint, 'font-size': 11, 'text-anchor': 'middle' }, claims.length ? claims.map((agent) => agent.label).join(' + ') : 'Unclaimed'));
      group.append(node('title', {}, `${task.label}: ${claims.length} own-bundle ${claims.length === 1 ? 'claim' : 'claims'}`)); svg.append(group);
    });
    run.agents.forEach((agent, index) => {
      const x = sx(agent.position[0]), y = sy(agent.position[1]);
      const group = node('g', { class: 'cbba-node', role: 'button', tabindex: 0, 'data-cbba-agent': index, 'aria-pressed': String(index === selected), 'aria-label': `Inspect agent ${agent.label}; ${agent.bundle.length} task claims` });
      if (index === selected) group.append(node('circle', { cx: x, cy: y, r: 24, stroke: '#eff4ea', fill: 'none', 'stroke-dasharray': '3 3' }));
      group.append(node('circle', { cx: x, cy: y, r: 18, fill: COLORS[index], stroke: '#16382e', 'stroke-width': 1.5 }));
      group.append(node('text', { x, y: y + 5, fill: '#10291f', 'font-size': 13, 'font-weight': 700, 'text-anchor': 'middle' }, agent.label));
      group.addEventListener('click', () => selectAgent(index));
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(index); } });
      svg.append(group);
    });
    svg.append(node('text', { x: 350, y: 487, fill: '#adbdad', 'font-size': 12, 'text-anchor': 'middle' }, `Round ${run.round} · static layout · no task execution`));
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((child) => { if (child.geometry) geometries.add(child.geometry); if (Array.isArray(child.material)) child.material.forEach((m) => materials.add(m)); else if (child.material) materials.add(child.material); });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) { failed = true; disposeWorld(); layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'cbba-webgl-message', textContent: message })); }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D view of static CBBA task claims. Drag to orbit; scroll to zoom. No task execution.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Use 2D to continue exploring the same run.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 100);
      camera.position.set(5, 10, 7);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(4.5, 0, -3); controls.enablePan = false; controls.minDistance = 6; controls.maxDistance = 26; controls.maxPolarAngle = Math.PI / 2 - .1; controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2.3); light.position.set(-3, 8, 5); scene.add(light);
      const grid = new THREE.GridHelper(10, 10, 0x48665c, 0x29483f); grid.position.set(4.5, 0, -3); scene.add(grid);
      const dynamic = new THREE.Group(); scene.add(dynamic);
      const overlay = Object.assign(document.createElement('div'), { className: 'cbba-labels' }); layer.append(overlay);
      world = { THREE, renderer, scene, camera, controls, dynamic, overlay, labels: [], taskLabels: [], anchors: [], taskAnchors: [] };
      controls.addEventListener('change', drawThree); updateThree(); resize();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state tables remain available.'); }
    finally { loading = false; }
  }
  function clearDynamic() {
    world.dynamic.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    world.dynamic.clear();
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, dynamic, overlay } = world;
    clearDynamic(); world.anchors = []; world.taskAnchors = [];
    if (world.labels.length !== run.agents.length) {
      overlay.replaceChildren(); world.labels = run.agents.map((agent, index) => {
        const label = Object.assign(document.createElement('button'), { textContent: agent.label, className: 'cbba-agent-label' });
        label.style.color = COLORS[index]; label.setAttribute('aria-label', `Inspect agent ${agent.label}`); label.addEventListener('click', () => selectAgent(index)); overlay.append(label); return label;
      });
      world.taskLabels = run.tasks.map((task) => { const label = Object.assign(document.createElement('span'), { textContent: task.label, className: 'cbba-task-label' }); overlay.append(label); return label; });
    }
    const line = (a, b, tint, dashed = false, opacity = 1) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], .045, -a[1]), new THREE.Vector3(b[0], .045, -b[1])]);
      const material = dashed ? new THREE.LineDashedMaterial({ color: tint, dashSize: .15, gapSize: .13, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity });
      const object = new THREE.Line(geometry, material); if (dashed) object.computeLineDistances(); dynamic.add(object);
    };
    for (const link of displayedLinks(run)) line(run.agents[link.from].position, run.agents[link.to].position, link.active ? '#a7c1b7' : '#b57759', true, link.active ? 1 : .55);
    run.agents.forEach((agent, index) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .16, 28), new THREE.MeshStandardMaterial({ color: COLORS[index] }));
      mesh.position.set(agent.position[0], .09, -agent.position[1]); dynamic.add(mesh); world.anchors.push(mesh.position.clone());
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
      for (const task of agent.bundle) line(agent.position, run.tasks[task].position, COLORS[index], false, index === selected ? 1 : .4);
    });
    run.tasks.forEach((task) => {
      const claims = run.agents.filter((agent) => agent.bundle.includes(task.id));
      const tint = claims.length > 1 ? '#f0a784' : claims.length === 1 ? COLORS[claims[0].id] : '#839d8d';
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.27, .11, .27), new THREE.MeshStandardMaterial({ color: tint }));
      mesh.position.set(task.position[0], .06, -task.position[1]); mesh.rotation.y = Math.PI / 4; dynamic.add(mesh); world.taskAnchors.push(mesh.position.clone());
      world.taskLabels[task.id].textContent = `${task.label} · ${claims.length ? claims.map((agent) => agent.label).join('+') : 'unclaimed'}`;
    });
    const agent = run.agents[selected], marker = new THREE.Mesh(new THREE.RingGeometry(.34, .37, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.set(agent.position[0], .02, -agent.position[1]); dynamic.add(marker);
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const place = (anchor, label) => {
      const point = anchor.clone().project(world.camera);
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`; label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    };
    world.anchors.forEach((anchor, index) => place(anchor, world.labels[index]));
    world.taskAnchors.forEach((anchor, index) => place(anchor, world.taskLabels[index]));
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, agent = selected) {
      if (disposed) return;
      run = nextRun; selected = agent;
      const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.cbbaAgent : null;
      drawSvg(); if (focused !== null) svg.querySelector(`[data-cbba-agent="${focused}"]`)?.focus({ preventScroll: true }); updateThree();
    },
    setMode(next) {
      if (!['2d', '3d'].includes(next)) throw new Error('Unknown CBBA view.');
      if (disposed) return;
      mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree(); if (world) world.controls.enabled = mode === '3d' && !failed; resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
