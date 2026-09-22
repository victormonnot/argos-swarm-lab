import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';
import { RADIUS, MAX_SPEED } from './orca-model.js';

const DISPLAY_HEIGHT = 1.15;
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
    world.scene.traverse((child) => { child.shadow?.dispose(); if (child.geometry) geometries.add(child.geometry); if (Array.isArray(child.material)) child.material.forEach((m) => materials.add(m)); else if (child.material) materials.add(child.material); });
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
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 2.5; controls.maxDistance = 32; controls.maxPolarAngle = Math.PI / 2 - .1;
      createWorkshopStage(THREE, scene, renderer, { center: [0, 0], size: [13, 13], grid: 1 });
      const bodies = new THREE.Group(), terrain = new THREE.Group(), dynamic = new THREE.Group(); scene.add(bodies, terrain, dynamic);
      const overlay = Object.assign(document.createElement('div'), { className: 'orca-labels' }); layer.append(overlay);
      world = { THREE, renderer, scene, camera, controls, bodies, terrain, dynamic, overlay, labels: [], goalLabels: [], agents: [], footprints: [], following: false, layout: null };
      world.cameraUI = addWorkshopCameraUI(layer, {
        prefix: 'orca', caption: 'Planar avoidance · 1.15 m display height · ground disks = collision footprint · no vertical avoidance',
        onWhole: () => frameCamera(false), onFollow: () => frameCamera(true),
      });
      controls.addEventListener('change', drawThree); updateThree(); resize(); frameCamera(false);
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state table remain available.'); }
    finally { loading = false; }
  }
  function clearGroup(group) {
    group.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    group.clear();
  }
  function frameCamera(following) {
    if (!world || !run) return;
    world.following = following;
    const p = run.agents[selected].position;
    const target = following ? new world.THREE.Vector3(p[0], DISPLAY_HEIGHT * .8, -p[1]) : new world.THREE.Vector3(0, .35, 0);
    const distance = following ? 5.3 : Math.max(17.5, 12 / Math.max(.6, world.camera.aspect));
    world.camera.position.copy(target).add(new world.THREE.Vector3(.32, .8, 1).normalize().multiplyScalar(distance));
    world.controls.target.copy(target); world.controls.update(); world.cameraUI.setFollowing(following);
    layer.dataset.camera = following ? 'follow' : 'whole'; drawThree();
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, dynamic, overlay, bodies, terrain } = world;
    clearGroup(dynamic);
    const layout = JSON.stringify(run.agents.map((agent) => agent.goal));
    if (world.layout !== layout) {
      clearGroup(bodies); clearGroup(terrain); world.agents = []; world.footprints = [];
      overlay.replaceChildren(); world.labels = run.agents.map((_, index) => {
        const label = Object.assign(document.createElement('button'), { textContent: `A${index + 1}`, className: 'orca-agent-label' });
        label.style.color = color(index); label.setAttribute('aria-label', `Inspect agent A${index + 1}`); label.addEventListener('click', () => selectAgent(index)); overlay.append(label); return label;
      });
      world.goalLabels = run.agents.map((agent, index) => {
        const label = Object.assign(document.createElement('span'), { textContent: `G${index + 1}`, className: 'orca-goal-label' });
        label.style.color = color(index); overlay.append(label);
        const goal = new THREE.Mesh(new THREE.RingGeometry(.20, .25, 40), new THREE.MeshBasicMaterial({ color: color(index), side: THREE.DoubleSide }));
        goal.rotation.x = -Math.PI / 2; goal.position.set(agent.goal[0], .02, -agent.goal[1]); terrain.add(goal);
        const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.10, 0, 0), new THREE.Vector3(.10, 0, 0), new THREE.Vector3(0, 0, -.10), new THREE.Vector3(0, 0, .10)]), new THREE.LineBasicMaterial({ color: color(index) }));
        cross.position.copy(goal.position); terrain.add(cross); return label;
      });
      run.agents.forEach((_, index) => {
        const drone = createWorkshopDrone(THREE, { color: color(index), size: 2 * RADIUS, id: `A${index + 1}` });
        bodies.add(drone); world.agents.push(drone);
        const group = new THREE.Group();
        const disk = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 40), new THREE.MeshBasicMaterial({ color: color(index), transparent: true, opacity: .25, side: THREE.DoubleSide })); disk.rotation.x = -Math.PI / 2;
        const edge = new THREE.Mesh(new THREE.RingGeometry(RADIUS - .016, RADIUS, 40), new THREE.MeshBasicMaterial({ color: color(index), side: THREE.DoubleSide })); edge.rotation.x = -Math.PI / 2;
        const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, .01, 0), new THREE.Vector3(0, DISPLAY_HEIGHT, 0)]), new THREE.LineDashedMaterial({ color: color(index), transparent: true, opacity: .32, dashSize: .07, gapSize: .06 }));
        stem.computeLineDistances(); group.add(disk, edge, stem); bodies.add(group); world.footprints.push(group);
      });
      world.layout = layout;
    }
    run.agents.forEach((agent, index) => {
      const vector = Math.hypot(...agent.velocity) > 1e-9 ? agent.velocity : [agent.goal[0] - agent.position[0], agent.goal[1] - agent.position[1]];
      setWorkshopDrone(world.agents[index], { position: [agent.position[0], DISPLAY_HEIGHT, -agent.position[1]], heading: Math.atan2(vector[1], vector[0]), phase: run.time * 34, active: run.status !== 'collision' });
      world.footprints[index].position.set(agent.position[0], .015, -agent.position[1]);
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
      for (const height of [.024, DISPLAY_HEIGHT]) {
        const points = agent.trail.map((p) => new THREE.Vector3(p[0], height, -p[1]));
        if (points.length > 1) dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: color(index), transparent: true, opacity: height === DISPLAY_HEIGHT ? .65 : .20 })));
      }
    });
    const agent = run.agents[selected], marker = new THREE.Mesh(new THREE.RingGeometry(RADIUS + .07, RADIUS + .09, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.set(agent.position[0], .026, -agent.position[1]); dynamic.add(marker);
    for (const [vector, tint, height] of [[agent.preferred, 0xeec077, DISPLAY_HEIGHT + .12], [agent.command ?? agent.velocity, 0xf4f8ef, DISPLAY_HEIGHT + .20]]) {
      const length = Math.hypot(...vector);
      if (length > 1e-9) dynamic.add(new THREE.ArrowHelper(new THREE.Vector3(vector[0], 0, -vector[1]).normalize(), new THREE.Vector3(agent.position[0], height, -agent.position[1]), length * 1.25, tint, Math.min(.18, length * .3), Math.min(.09, length * .2)));
    }
    // Links identify the selected agent's actual observed constraints, not a
    // communication network. The missing-sensing case therefore has none.
    for (const constraint of agent.constraints ?? []) {
      const peer = run.agents.find((item) => item.id === constraint.neighbor);
      if (!peer) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(agent.position[0], DISPLAY_HEIGHT, -agent.position[1]), new THREE.Vector3(peer.position[0], DISPLAY_HEIGHT, -peer.position[1])]), new THREE.LineDashedMaterial({ color: color(constraint.neighbor), transparent: true, opacity: .25, dashSize: .10, gapSize: .13 }));
      line.computeLineDistances(); dynamic.add(line);
    }
    world.cameraUI.setFollowLabel(`Follow ${agent.id}`);
    if (world.following) {
      const target = new THREE.Vector3(agent.position[0], DISPLAY_HEIGHT * .8, -agent.position[1]);
      world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update();
    }
    layer.dataset.agents = JSON.stringify(run.agents.map((a) => [a.position[0], DISPLAY_HEIGHT, -a.position[1]]));
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const placed = [], width = container.clientWidth, height = container.clientHeight;
    const positionLabel = (label, vector, gap) => {
      const p = vector.project(world.camera), left = Math.max(25, Math.min(width - 25, (p.x + 1) * width / 2));
      let top = Math.max(80, Math.min(height - 45, (1 - p.y) * height / 2));
      while (placed.some((other) => Math.abs(other[0] - left) < 44 && Math.abs(other[1] - top) < gap)) top += gap;
      label.style.left = `${left}px`; label.style.top = `${top}px`;
      label.hidden = p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.08 || Math.abs(p.y) > 1.08;
      if (!label.hidden) placed.push([left, top]);
    };
    world.agents.forEach((mesh, index) => positionLabel(world.labels[index], mesh.position.clone().add(new world.THREE.Vector3(0, .22, 0)), 27));
    run.agents.forEach((agent, index) => positionLabel(world.goalLabels[index], new world.THREE.Vector3(agent.goal[0], .02, -agent.goal[1]), 27));
  }
  function resize() {
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const changed = world.width !== width || world.height !== height;
    world.width = width; world.height = height;
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix();
    if (changed && !world.following && run) frameCamera(false); else drawThree();
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
