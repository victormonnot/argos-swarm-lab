import { RADIUS, MAX_SPEED } from './orca-model.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#70d8bf', '#b8acff', '#eec077', '#91bafa'];
const x = (v) => 350 + v * 42;
const y = (v) => 280 - v * 42;
const node = (tag, attrs = {}, text = '') => {
  const element = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
};
const color = (id) => COLORS[(typeof id === 'string' ? Number(id.slice(1)) - 1 : id) % COLORS.length];

// A 160-sided polygon approximates the disk for display only. The model's
// velocity solver uses exact circle intersections, independently of this view.
export function drawVelocitySpace(container, agent, method) {
  const scale = 112 / MAX_SPEED, vx = (v) => 185 + v * scale, vy = (v) => 147 - v * scale;
  const svg = node('svg', { viewBox: '0 0 370 300', role: 'img', 'aria-label': `Velocity space for agent ${agent.id}: preferred and chosen velocities, speed disk and admissible half-planes.` });
  const defs = node('defs'), clip = node('clipPath', { id: 'orca-speed-clip' });
  clip.append(node('circle', { cx: 185, cy: 147, r: 112 })); defs.append(clip); svg.append(defs);
  svg.append(node('circle', { cx: 185, cy: 147, r: 112, fill: '#f3f5ef', stroke: '#8b9c90', 'stroke-width': 1.5 }));
  let polygon = Array.from({ length: 160 }, (_, i) => [MAX_SPEED * Math.cos(2 * Math.PI * i / 160), MAX_SPEED * Math.sin(2 * Math.PI * i / 160)]);
  const constraints = agent.constraints ?? [];
  for (const { point: q, normal: n } of constraints) {
    const output = [], margin = (p) => (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = margin(a), db = margin(b);
      if (da >= 0) output.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    polygon = output;
  }
  if (method === 'orca' && polygon.length) svg.append(node('polygon', { points: polygon.map((p) => `${vx(p[0])},${vy(p[1])}`).join(' '), fill: '#9bd7b98f', stroke: '#70a98a', 'stroke-width': 0.8, 'data-orca-feasible-region': '' }));
  for (const value of [-1, 0, 1]) {
    svg.append(node('line', { x1: 57, y1: vy(value * MAX_SPEED), x2: 313, y2: vy(value * MAX_SPEED), stroke: '#d5ddd5', 'stroke-dasharray': value ? '3 4' : 'none' }));
    svg.append(node('line', { x1: vx(value * MAX_SPEED), y1: 22, x2: vx(value * MAX_SPEED), y2: 274, stroke: '#d5ddd5', 'stroke-dasharray': value ? '3 4' : 'none' }));
    svg.append(node('text', { x: vx(value * MAX_SPEED), y: 287, fill: '#5f7569', 'font-size': 11, 'text-anchor': 'middle' }, String(value * MAX_SPEED)));
    if (value) svg.append(node('text', { x: 45, y: vy(value * MAX_SPEED) + 4, fill: '#5f7569', 'font-size': 11, 'text-anchor': 'end' }, String(value * MAX_SPEED)));
  }
  const boundaries = node('g', { 'clip-path': 'url(#orca-speed-clip)' });
  for (const c of constraints) {
    const tangent = [-c.normal[1], c.normal[0]], span = 4 * MAX_SPEED;
    boundaries.append(node('line', { x1: vx(c.point[0] - span * tangent[0]), y1: vy(c.point[1] - span * tangent[1]), x2: vx(c.point[0] + span * tangent[0]), y2: vy(c.point[1] + span * tangent[1]), stroke: color(c.neighbor), 'stroke-width': 2, 'data-orca-boundary': c.neighbor }));
    const offset = c.point[0] * c.normal[0] + c.point[1] * c.normal[1];
    if (Math.abs(offset) < MAX_SPEED) {
      const reach = Math.sqrt(MAX_SPEED ** 2 - offset ** 2) * .65, sign = Number(c.neighbor.slice(1)) % 2 ? 1 : -1;
      const anchor = [c.normal[0] * offset + tangent[0] * reach * sign, c.normal[1] * offset + tangent[1] * reach * sign];
      boundaries.append(node('text', { x: vx(anchor[0]) + 5, y: vy(anchor[1]) - 5, fill: '#284737', stroke: '#f7faf4', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 11 }, c.neighbor));
    }
  }
  svg.append(boundaries);
  const preferred = agent.preferred, chosen = agent.command ?? agent.velocity;
  svg.append(node('line', { x1: 185, y1: 147, x2: vx(preferred[0]), y2: vy(preferred[1]), stroke: '#ab7a36', 'stroke-dasharray': '4 3', 'stroke-width': 1.7 }));
  const px = vx(preferred[0]), py = vy(preferred[1]);
  svg.append(node('path', { d: `M${px},${py - 7} L${px + 7},${py} L${px},${py + 7} L${px - 7},${py}Z`, fill: '#fff8e9', stroke: '#a37635', 'stroke-width': 2, 'data-orca-preferred': '' }));
  svg.append(node('line', { x1: 185, y1: 147, x2: vx(chosen[0]), y2: vy(chosen[1]), stroke: '#234c3e', 'stroke-width': 2 }));
  svg.append(node('circle', { cx: vx(chosen[0]), cy: vy(chosen[1]), r: 4, fill: '#234c3e', stroke: 'white', 'stroke-width': 1, 'data-orca-chosen': '', 'data-velocity': chosen.join(',') }));
  svg.append(node('text', { x: 317, y: 287, fill: '#5f7569', 'font-size': 11 }, 'vₓ · m/s'));
  svg.append(node('text', { x: 18, y: 17, fill: '#5f7569', 'font-size': 11 }, 'vᵧ · m/s'));
  container.replaceChildren(svg);
}

/** Both renderers observe the same run. Camera and selection never step it. */
export function createOrcaView(container, { selectAgent = () => {} } = {}) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false;
  const svg = node('svg', { viewBox: '0 0 700 560', class: 'orca-svg', role: 'group', 'aria-label': 'Planar collision avoidance map. Select an agent to inspect its velocity decision.' });
  const layer = Object.assign(document.createElement('div'), { className: 'orca-three', hidden: true });
  container.append(svg, layer);

  function drawSvg() {
    if (!run) return;
    svg.replaceChildren();
    const defs = node('defs');
    for (const [id, fill] of [['preferred', '#eec077'], ['chosen', '#f4f8ef']]) {
      const marker = node('marker', { id: `orca-arrow-${id}`, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.append(node('path', { d: 'M0,0 L6,3 L0,6Z', fill })); defs.append(marker);
    }
    svg.append(defs);
    for (let i = -6; i <= 6; i += 1) {
      svg.append(node('line', { x1: x(i), y1: y(-6), x2: x(i), y2: y(6), stroke: '#2b433e', 'stroke-width': .7 }));
      svg.append(node('line', { x1: x(-6), y1: y(i), x2: x(6), y2: y(i), stroke: '#2b433e', 'stroke-width': .7 }));
      if (i % 2 === 0) { svg.append(node('text', { x: x(i), y: 551, fill: '#91aaa0', 'font-size': 12, 'text-anchor': 'middle' }, String(i))); svg.append(node('text', { x: 83, y: y(i) + 4, fill: '#91aaa0', 'font-size': 12, 'text-anchor': 'end' }, String(i))); }
    }
    run.agents.forEach((agent, index) => {
      const [gx, gy] = agent.goal;
      svg.append(node('circle', { cx: x(gx), cy: y(gy), r: 12, stroke: color(index), fill: 'none', 'stroke-dasharray': '3 3' }));
      svg.append(node('path', { d: `M${x(gx) - 5},${y(gy)}h10 M${x(gx)},${y(gy) - 5}v10`, stroke: color(index), fill: 'none' }));
      svg.append(node('text', { x: x(gx) + 17, y: y(gy) + 4, fill: color(index), 'font-size': 12 }, `G${index + 1}`));
      svg.append(node('polyline', { points: agent.trail.map((p) => `${x(p[0])},${y(p[1])}`).join(' '), fill: 'none', stroke: color(index), opacity: .55, 'stroke-width': 1.6 }));
    });
    const observed = run.agents[selected];
    for (const [id, vector, stroke] of [['preferred', observed.preferred, '#eec077'], ['chosen', observed.command ?? observed.velocity, '#f4f8ef']]) {
      if (Math.hypot(...vector) < 1e-9) continue;
      svg.append(node('line', { x1: x(observed.position[0]), y1: y(observed.position[1]), x2: x(observed.position[0]) + vector[0] * 53, y2: y(observed.position[1]) - vector[1] * 53, stroke, 'stroke-width': 2, 'stroke-dasharray': id === 'preferred' ? '5 4' : 'none', 'marker-end': `url(#orca-arrow-${id})` }));
    }
    run.agents.forEach((agent, index) => {
      const g = node('g', { class: 'orca-node', role: 'button', tabindex: 0, 'data-orca-agent': index, 'aria-pressed': String(index === selected), 'aria-label': `Inspect agent A${index + 1}, position ${agent.position.map((v) => v.toFixed(3)).join(', ')} metres` });
      if (index === selected) g.append(node('circle', { cx: x(agent.position[0]), cy: y(agent.position[1]), r: RADIUS * 42 + 5, stroke: '#eff4ea', fill: 'none', 'stroke-dasharray': '3 3' }));
      g.append(node('circle', { cx: x(agent.position[0]), cy: y(agent.position[1]), r: RADIUS * 42, fill: color(index), stroke: '#16382e', 'stroke-width': 1.5 }));
      g.append(node('text', { x: x(agent.position[0]), y: y(agent.position[1]) + 4, fill: '#10291f', 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle' }, String(index + 1)));
      g.addEventListener('click', () => selectAgent(index));
      g.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(index); } });
      svg.append(g);
    });
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((child) => { if (child.geometry) geometries.add(child.geometry); if (Array.isArray(child.material)) child.material.forEach((m) => materials.add(m)); else if (child.material) materials.add(child.material); });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) { failed = true; disposeWorld(); layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'orca-webgl-message', textContent: message })); }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D view of planar ORCA motion. Drag to orbit; scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Use 2D to continue exploring the same run.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 100);
      camera.position.set(0, 12, 13);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI / 2 - .1; controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2.3); light.position.set(-3, 8, 5); scene.add(light);
      scene.add(new THREE.GridHelper(12, 12, 0x48665c, 0x29483f));
      const dynamic = new THREE.Group(); scene.add(dynamic);
      const overlay = Object.assign(document.createElement('div'), { className: 'orca-labels' }); layer.append(overlay);
      world = { THREE, renderer, scene, camera, controls, dynamic, overlay, labels: [], goalLabels: [], agents: [] };
      controls.addEventListener('change', drawThree); updateThree(); resize();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state table remain available.'); }
    finally { loading = false; }
  }
  function clearDynamic() {
    world.dynamic.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    world.dynamic.clear();
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, dynamic, overlay } = world;
    clearDynamic(); world.agents = [];
    if (world.labels.length !== run.agents.length) {
      overlay.replaceChildren(); world.labels = run.agents.map((_, index) => {
        const label = Object.assign(document.createElement('button'), { textContent: `A${index + 1}`, className: 'orca-agent-label' });
        label.style.color = color(index); label.setAttribute('aria-label', `Inspect agent A${index + 1}`); label.addEventListener('click', () => selectAgent(index)); overlay.append(label); return label;
      });
      world.goalLabels = run.agents.map((_, index) => {
        const label = Object.assign(document.createElement('span'), { textContent: `G${index + 1}`, className: 'orca-goal-label' });
        label.style.color = color(index); overlay.append(label); return label;
      });
    }
    run.agents.forEach((agent, index) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, .12, 28), new THREE.MeshStandardMaterial({ color: color(index) }));
      mesh.position.set(agent.position[0], .07, -agent.position[1]); dynamic.add(mesh); world.agents.push(mesh);
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
      const goal = new THREE.Mesh(new THREE.RingGeometry(.20, .25, 28), new THREE.MeshBasicMaterial({ color: color(index), side: THREE.DoubleSide }));
      goal.rotation.x = -Math.PI / 2; goal.position.set(agent.goal[0], .014, -agent.goal[1]); dynamic.add(goal);
      const points = agent.trail.map((p) => new THREE.Vector3(p[0], .016, -p[1]));
      if (points.length > 1) dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: color(index), transparent: true, opacity: .6 })));
    });
    const agent = run.agents[selected], marker = new THREE.Mesh(new THREE.RingGeometry(RADIUS + .08, RADIUS + .1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.set(agent.position[0], .018, -agent.position[1]); dynamic.add(marker);
    for (const [vector, tint, height] of [[agent.preferred, 0xeec077, .14], [agent.command ?? agent.velocity, 0xf4f8ef, .22]]) {
      const length = Math.hypot(...vector);
      if (length > 1e-9) dynamic.add(new THREE.ArrowHelper(new THREE.Vector3(vector[0], 0, -vector[1]).normalize(), new THREE.Vector3(agent.position[0], height, -agent.position[1]), length * 1.25, tint, .15, .08));
    }
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    world.agents.forEach((mesh, index) => {
      const p = mesh.position.clone().project(world.camera), label = world.labels[index];
      label.style.left = `${(p.x + 1) * container.clientWidth / 2}px`; label.style.top = `${(1 - p.y) * container.clientHeight / 2}px`; label.hidden = p.z < -1 || p.z > 1;
      const goal = run.agents[index].goal, projected = new world.THREE.Vector3(goal[0], .02, -goal[1]).project(world.camera), goalLabel = world.goalLabels[index];
      goalLabel.style.left = `${(projected.x + 1) * container.clientWidth / 2}px`; goalLabel.style.top = `${(1 - projected.y) * container.clientHeight / 2}px`; goalLabel.hidden = projected.z < -1 || projected.z > 1;
    });
  }
  function resize() {
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, agent = selected) {
      run = nextRun; selected = agent;
      const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.orcaAgent : null;
      drawSvg(); if (focused !== null) svg.querySelector(`[data-orca-agent="${focused}"]`)?.focus({ preventScroll: true }); updateThree();
    },
    setMode(next) {
      if (!['2d', '3d'].includes(next)) throw new Error('Unknown ORCA view.');
      mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree(); if (world) world.controls.enabled = mode === '3d' && !failed; resize();
    },
    dispose() {
      disposed = true; observer.disconnect();
      disposeWorld();
    },
  };
}
