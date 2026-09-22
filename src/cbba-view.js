import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';

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
    world.scene.traverse((child) => { child.shadow?.dispose(); if (child.geometry) geometries.add(child.geometry); if (Array.isArray(child.material)) child.material.forEach((m) => materials.add(m)); else if (child.material) materials.add(child.material); });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) { failed = true; disposeWorld(); layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'cbba-webgl-message', textContent: message })); }
  let following = false, cameraPreset = true;
  const displayAltitude = 1.2;
  function frameCamera(reset = false) {
    if (!world) return;
    const { camera, controls, THREE } = world;
    if (following) {
      const agent = run.agents[selected];
      const target = new THREE.Vector3(agent.position[0], .8, -agent.position[1]);
      if (reset) camera.position.copy(target).add(new THREE.Vector3(5.5, 4.5, 5.5));
      else camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
    } else if (reset || cameraPreset) {
      const fit = Math.max(8.5, 11 / Math.max(.55, camera.aspect));
      const distance = fit / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.14;
      controls.target.set(4.5, .55, -3);
      camera.position.copy(controls.target).add(new THREE.Vector3(.1, .82, .84).normalize().multiplyScalar(distance));
    }
    controls.update(); world.cameraUI.setFollowing(following); world.cameraUI.setFollowLabel(`Follow A${selected + 1}`);
    layer.dataset.camera = following ? `follow-A${selected + 1}` : 'whole';
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', 'Stationary quadrotors and task stations showing CBBA claims. Fixed decorative height; no flight or service is executed. Drag to orbit; scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Use 2D to continue exploring the same run.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 140);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 4; controls.maxDistance = 50; controls.maxPolarAngle = Math.PI / 2 - .08;
      controls.addEventListener('start', () => { cameraPreset = false; });
      createWorkshopStage(THREE, scene, renderer, { center: [4.5, -3], size: [11, 8.5], grid: 1 });
      const drones = run.agents.map((agent, index) => {
        const drone = createWorkshopDrone(THREE, { color: COLORS[index], size: 1.05, id: agent.label });
        setWorkshopDrone(drone, { position: [agent.position[0], displayAltitude, -agent.position[1]], heading: 0, phase: 0 }); scene.add(drone);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(.56, .6, .08, 32), new THREE.MeshStandardMaterial({ color: '#334e43', roughness: .85 }));
        pad.position.set(agent.position[0], .05, -agent.position[1]); pad.receiveShadow = true; scene.add(pad);
        return drone;
      });
      const tasks = run.tasks.map((task) => {
        const station = new THREE.Group(); station.position.set(task.position[0], 0, -task.position[1]);
        const base = new THREE.Mesh(new THREE.BoxGeometry(.65, .13, .65), new THREE.MeshStandardMaterial({ color: '#40544a', roughness: .8 }));
        base.position.y = .075; base.castShadow = true; base.receiveShadow = true; station.add(base);
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(.28, .62, .28), new THREE.MeshStandardMaterial({ color: '#759589', metalness: .2, roughness: .6 }));
        pillar.position.y = .45; pillar.castShadow = true; station.add(pillar);
        const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(.16), new THREE.MeshStandardMaterial({ color: '#839d8d', emissive: '#839d8d', emissiveIntensity: .3 }));
        beacon.position.y = .9; station.add(beacon);
        const claimBands = COLORS.map((color, index) => {
          const band = new THREE.Mesh(new THREE.TorusGeometry(.25, .03, 8, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .25 }));
          band.rotation.x = Math.PI / 2; band.position.y = .28 + index * .13; band.visible = false; station.add(band); return band;
        });
        station.userData = { beacon, claimBands }; scene.add(station); return station;
      });
      const marker = new THREE.Mesh(new THREE.RingGeometry(.64, .69, 40), new THREE.MeshBasicMaterial({ color: '#fff4dd', side: THREE.DoubleSide })); marker.rotation.x = -Math.PI / 2; scene.add(marker);
      const dynamic = new THREE.Group(); scene.add(dynamic);
      const overlay = Object.assign(document.createElement('div'), { className: 'cbba-labels' }); layer.append(overlay);
      const labels = run.agents.map((agent, index) => {
        const label = Object.assign(document.createElement('button'), { textContent: agent.label, className: 'cbba-agent-label' });
        label.style.color = COLORS[index]; label.setAttribute('aria-label', `Inspect agent ${agent.label}`); label.addEventListener('click', () => selectAgent(index)); overlay.append(label); return label;
      });
      const taskLabels = run.tasks.map((task) => { const label = Object.assign(document.createElement('span'), { textContent: task.label, className: 'cbba-task-label' }); overlay.append(label); return label; });
      const cameraUI = addWorkshopCameraUI(layer, { prefix: 'cbba', caption: 'Stationary allocation plans · fixed display height 1.2 units · no flight',
        onWhole: () => { following = false; cameraPreset = true; frameCamera(true); drawThree(); },
        onFollow: () => { following = true; cameraPreset = false; frameCamera(true); drawThree(); } });
      world = { THREE, renderer, scene, camera, controls, dynamic, overlay, labels, taskLabels, drones, tasks, marker, cameraUI, lastSelected: selected };
      controls.addEventListener('change', drawThree); resize(); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state tables remain available.'); }
    finally { loading = false; }
  }
  function clearDynamic() {
    world.dynamic.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    world.dynamic.clear();
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, dynamic } = world;
    clearDynamic();
    const line = (start, end, tint, dashed = false, opacity = 1, lift = 0) => {
      const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
      const points = lift ? new THREE.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(.5).add(new THREE.Vector3(0, lift, 0)), b).getPoints(24) : [a, b];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = dashed ? new THREE.LineDashedMaterial({ color: tint, dashSize: .15, gapSize: .13, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity });
      const object = new THREE.Line(geometry, material); if (dashed) object.computeLineDistances(); dynamic.add(object);
    };
    for (const link of displayedLinks(run)) {
      const a = run.agents[link.from].position, b = run.agents[link.to].position;
      line([a[0], displayAltitude, -a[1]], [b[0], displayAltitude, -b[1]], link.active ? '#a7c1b7' : '#c58369', true, link.active ? .9 : .55, .6);
      if (!link.active) {
        const center = [(a[0] + b[0]) / 2, displayAltitude + .3, -(a[1] + b[1]) / 2];
        line([center[0] - .13, center[1] - .13, center[2]], [center[0] + .13, center[1] + .13, center[2]], '#edaa89');
        line([center[0] - .13, center[1] + .13, center[2]], [center[0] + .13, center[1] - .13, center[2]], '#edaa89');
      }
    }
    run.agents.forEach((agent, index) => {
      // A protocol round changes claims, never a physical pose or propeller phase.
      setWorkshopDrone(world.drones[index], { position: [agent.position[0], displayAltitude, -agent.position[1]], heading: 0, phase: 0 });
      world.labels[index].textContent = `${agent.label} · ${agent.bundle.length} claims`;
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
      for (const taskId of agent.bundle) {
        const task = run.tasks[taskId];
        line([agent.position[0], displayAltitude, -agent.position[1]], [task.position[0], .9, -task.position[1]], COLORS[index], false, index === selected ? .95 : .27, .35 + index * .12);
      }
    });
    run.tasks.forEach((task) => {
      const claims = run.agents.filter((agent) => agent.bundle.includes(task.id));
      const tint = claims.length > 1 ? '#f0a784' : claims.length === 1 ? COLORS[claims[0].id] : '#839d8d';
      const { beacon, claimBands } = world.tasks[task.id].userData;
      beacon.material.color.set(tint); beacon.material.emissive.set(tint);
      claimBands.forEach((band, index) => { band.visible = claims.some((agent) => agent.id === index); });
      world.taskLabels[task.id].textContent = `${task.label} · ${claims.length ? claims.map((agent) => agent.label).join('+') : 'unclaimed'}`;
      world.taskLabels[task.id].style.color = tint;
      world.taskLabels[task.id].title = `${task.label}: ${claims.length} current own-bundle claims, no service executed`;
      world.taskLabels[task.id].dataset.claims = String(claims.length);
    });
    const agent = run.agents[selected]; world.marker.position.set(agent.position[0], .11, -agent.position[1]);
    frameCamera(following && world.lastSelected !== selected); world.lastSelected = selected;
    layer.dataset.round = String(run.round);
    layer.dataset.agents = JSON.stringify(run.agents.map((agent) => ({ id: agent.id, position: [...agent.position], displayAltitude, bundle: [...agent.bundle] })));
    layer.dataset.links = JSON.stringify(displayedLinks(run));
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const width = container.clientWidth, height = container.clientHeight, occupied = [];
    const place = (anchor, label, priority = false) => {
      const point = anchor.clone().project(world.camera), w = Math.min(width - 16, Math.max(35, label.textContent.length * 7.2 + 14)), h = 23;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      if (label.hidden) return;
      const x = Math.max(8, Math.min(width - w - 8, (point.x + 1) * width / 2 - w / 2));
      const baseY = (1 - point.y) * height / 2 - h - 10;
      const candidates = [0, -26, 26, -52, 52].map((offset) => Math.max(76, Math.min(height - 65, baseY + offset)));
      const y = candidates.find((candidate) => !occupied.some((box) => x < box.x + box.w + 4 && x + w + 4 > box.x && candidate < box.y + box.h + 3 && candidate + h + 3 > box.y));
      if (y === undefined && !priority) { label.hidden = true; return; }
      const top = y ?? candidates[0]; occupied.push({ x, y: top, w, h });
      label.style.left = `${x}px`; label.style.top = `${top}px`;
    };
    const order = run.agents.map((_, id) => id).sort((a, b) => Number(b === selected) - Number(a === selected));
    order.forEach((id) => place(world.drones[id].position.clone().add(new world.THREE.Vector3(0, .3, 0)), world.labels[id], id === selected));
    world.tasks.forEach((station, id) => place(station.position.clone().add(new world.THREE.Vector3(0, .95, 0)), world.taskLabels[id]));
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); frameCamera(cameraPreset); drawThree();
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
