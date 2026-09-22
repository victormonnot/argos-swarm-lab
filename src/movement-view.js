import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';
import { AGENT_RADIUS, WALL_RADIUS, GOAL, GOAL_RADIUS, observeMovement, movementCommand } from './movement-model.js';

const DISPLAY_HEIGHT = 0.65;
const WALL_HEIGHT = 1.3;
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#70d8bf', '#eec077', '#8faaf7'];
const VECTOR_COLORS = { attraction: '#70d8bf', obstacle: '#edaa72', separation: '#a29be9', velocity: '#f2f5ed' };
const x = (value) => 450 + value * 78;
const y = (value) => 235 - value * 78;
const svgNode = (name, attributes = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

/** Planar snapshots drive both views; the renderer never advances the simulation. */
export function createMovementView(container, { selectAgent = () => {} } = {}) {
  let run, selected = 0, mode = '2d', world, loading = false, disposed = false, failed = false;
  const svg = svgNode('svg', { viewBox: '0 0 900 480', class: 'movement-svg', role: 'group', 'aria-label': 'Planar potential-field map. Select an agent to inspect its local command.' });
  const threeLayer = document.createElement('div');
  threeLayer.className = 'movement-three';
  threeLayer.hidden = true;
  container.append(svg, threeLayer);

  function drawSvg() {
    if (!run) return;
    const defs = svgNode('defs');
    for (const [key, color] of Object.entries(VECTOR_COLORS)) {
      const marker = svgNode('marker', { id: `arrow-${key}`, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.append(svgNode('path', { d: 'M0,0 L6,3 L0,6Z', fill: color }));
      defs.append(marker);
    }
    svg.replaceChildren(defs);
    for (let column = -5; column <= 5; column += 1) {
      svg.append(svgNode('line', { x1: x(column), y1: 15, x2: x(column), y2: 440, stroke: '#29433e', 'stroke-width': 0.6 }));
      const label = svgNode('text', { x: x(column), y: 463, fill: '#93ada3', 'font-size': 12, 'text-anchor': 'middle' });
      label.textContent = column;
      svg.append(label);
    }
    for (let row = -2; row <= 2; row += 1) {
      svg.append(svgNode('line', { x1: 32, y1: y(row), x2: 868, y2: y(row), stroke: '#29433e', 'stroke-width': 0.6 }));
      const label = svgNode('text', { x: 18, y: y(row) + 4, fill: '#93ada3', 'font-size': 12 });
      label.textContent = row;
      svg.append(label);
    }
    const axisLabel = svgNode('text', { x: 865, y: 463, fill: '#93ada3', 'font-size': 12, 'text-anchor': 'end' });
    axisLabel.textContent = 'x · m';
    svg.append(axisLabel);
    svg.append(svgNode('circle', { cx: x(GOAL[0]), cy: y(GOAL[1]), r: GOAL_RADIUS * 78, fill: '#4b88612b', stroke: '#9dc67c', 'stroke-dasharray': '5 5', 'stroke-width': 1.5 }));
    const goalLabel = svgNode('text', { x: x(GOAL[0]), y: y(GOAL[1]) - GOAL_RADIUS * 78 - 14, fill: '#c2dba3', 'font-size': 14, 'text-anchor': 'middle' });
    goalLabel.textContent = 'GOAL · r = 0.8 m';
    svg.append(goalLabel);
    for (const [a, b] of run.walls) svg.append(svgNode('line', { x1: x(a[0]), y1: y(a[1]), x2: x(b[0]), y2: y(b[1]), stroke: '#8b9b96', 'stroke-width': 2 * WALL_RADIUS * 78, 'stroke-linecap': 'round' }));
    run.positions.forEach((position, index) => {
      const trail = run.history.map((point) => `${x(point.positions[index][0])},${y(point.positions[index][1])}`).join(' ');
      svg.append(svgNode('polyline', { points: trail, fill: 'none', stroke: COLORS[index], 'stroke-width': 1.7, opacity: 0.6 }));
    });
    if (run.status !== 'collision') {
      const command = movementCommand(observeMovement(run, selected), run.gains), position = run.positions[selected];
      for (const key of ['attraction', 'obstacle', 'separation', 'velocity']) {
        const vector = command[key], magnitude = Math.hypot(...vector);
        if (magnitude < 0.00001) continue;
        const displayScale = 36 * Math.min(1, 2.3 / magnitude);
        svg.append(svgNode('line', { x1: x(position[0]), y1: y(position[1]), x2: x(position[0]) + vector[0] * displayScale, y2: y(position[1]) - vector[1] * displayScale,
          stroke: VECTOR_COLORS[key], 'stroke-width': key === 'velocity' ? 2.5 : 2, 'marker-end': `url(#arrow-${key})`, 'stroke-dasharray': key === 'velocity' ? '4 3' : 'none' }));
      }
    }
    run.positions.forEach((position, index) => {
      const node = svgNode('g', { role: 'button', tabindex: 0, 'data-movement-agent': index, 'aria-pressed': String(index === selected), 'aria-label': `Inspect agent A${index + 1}, x ${position[0].toFixed(3)}, y ${position[1].toFixed(3)}`, class: 'movement-node' });
      if (index === selected) node.append(svgNode('circle', { cx: x(position[0]), cy: y(position[1]), r: AGENT_RADIUS * 78 + 6, fill: 'none', stroke: '#f0f5e9', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      node.append(svgNode('circle', { cx: x(position[0]), cy: y(position[1]), r: AGENT_RADIUS * 78, fill: COLORS[index], stroke: '#112b25', 'stroke-width': 1.5 }));
      const label = svgNode('text', { x: x(position[0]) - 24, y: y(position[1]) + 5, fill: COLORS[index], 'font-size': 14, 'text-anchor': 'end' });
      label.textContent = `A${index + 1}`;
      node.append(label);
      node.addEventListener('click', () => selectAgent(index));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(index); }
      });
      svg.append(node);
    });
  }

  function disposeScene(scene) {
    const geometries = new Set(), materials = new Set();
    scene.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (Array.isArray(node.material)) node.material.forEach((material) => materials.add(material));
      else if (node.material) materials.add(node.material);
      node.shadow?.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    disposeScene(world.scene);
    world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    threeLayer.replaceChildren(Object.assign(document.createElement('p'), { className: 'movement-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    threeLayer.textContent = 'Loading 3D…';
    let pendingRenderer, pendingScene, pendingControls;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D view of planar movement. Drag to orbit, scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Use 2D to keep exploring the same run.'); });
      threeLayer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(); pendingScene = scene;
      const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 100);
      const controls = new OrbitControls(camera, renderer.domElement); pendingControls = controls;
      controls.enablePan = false;
      controls.minDistance = 1.6;
      controls.maxDistance = 28;
      controls.maxPolarAngle = Math.PI / 2 - 0.08;
      createWorkshopStage(THREE, scene, renderer, { center: [0, 0], size: [11, 6], grid: 1 });
      const agents = COLORS.map((color, index) => {
        const drone = createWorkshopDrone(THREE, { color, size: 2 * AGENT_RADIUS, id: `A${index + 1}` });
        scene.add(drone);
        return drone;
      });
      const footprints = COLORS.map((color) => {
        const group = new THREE.Group();
        const disk = new THREE.Mesh(new THREE.CircleGeometry(AGENT_RADIUS, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .26, side: THREE.DoubleSide }));
        disk.rotation.x = -Math.PI / 2;
        const edge = new THREE.Mesh(new THREE.RingGeometry(AGENT_RADIUS - .01, AGENT_RADIUS, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        edge.rotation.x = -Math.PI / 2;
        const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, .01, 0), new THREE.Vector3(0, DISPLAY_HEIGHT, 0)]), new THREE.LineDashedMaterial({ color, transparent: true, opacity: .38, dashSize: .05, gapSize: .04 }));
        stem.computeLineDistances(); group.add(disk, edge, stem); scene.add(group); return group;
      });
      const goal = new THREE.Mesh(new THREE.CylinderGeometry(GOAL_RADIUS, GOAL_RADIUS, .025, 64), new THREE.MeshStandardMaterial({ color: 0x6d9c63, transparent: true, opacity: .48 }));
      goal.position.set(GOAL[0], .013, -GOAL[1]); goal.receiveShadow = true; scene.add(goal);
      const goalRing = new THREE.Mesh(new THREE.RingGeometry(GOAL_RADIUS - .02, GOAL_RADIUS, 64), new THREE.MeshBasicMaterial({ color: 0xb1d797, side: THREE.DoubleSide }));
      goalRing.rotation.x = -Math.PI / 2; goalRing.position.set(GOAL[0], .027, -GOAL[1]); scene.add(goalRing);
      const marker = new THREE.Mesh(new THREE.RingGeometry(AGENT_RADIUS + .035, AGENT_RADIUS + .05, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; scene.add(marker);
      const environment = new THREE.Group(), trajectories = new THREE.Group(), arrows = new THREE.Group();
      scene.add(environment, trajectories, arrows);
      const overlay = document.createElement('div');
      overlay.className = 'movement-3d-labels';
      const labels = COLORS.map((color, index) => {
        const label = document.createElement('button');
        label.textContent = `A${index + 1}`;
        label.style.color = color;
        label.setAttribute('aria-label', `Inspect agent A${index + 1}`);
        label.addEventListener('click', () => selectAgent(index));
        overlay.append(label);
        return label;
      });
      threeLayer.append(overlay);
      world = { THREE, renderer, scene, camera, controls, agents, footprints, marker, environment, trajectories, arrows, labels, mapKey: null, historyLength: -1, following: false };
      world.cameraUI = addWorkshopCameraUI(threeLayer, {
        prefix: 'movement', caption: 'Planar APF · 0.65 m display height · ground disks = collision footprint · no vertical avoidance',
        onWhole: () => frameCamera(false), onFollow: () => frameCamera(true),
      });
      controls.addEventListener('change', drawThree);
      updateThree();
      resize();
      frameCamera(false);
    } catch {
      if (!world) { pendingControls?.dispose(); if (pendingScene) disposeScene(pendingScene); pendingRenderer?.dispose(); }
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state table remain available.');
    } finally { loading = false; }
  }
  function clearGroup(group) {
    group.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    group.clear();
  }
  function frameCamera(following) {
    if (!world || !run) return;
    world.following = following;
    const target = following ? new world.THREE.Vector3(run.positions[selected][0], DISPLAY_HEIGHT * .75, -run.positions[selected][1]) : new world.THREE.Vector3(0, .3, 0);
    const distance = following ? 3.2 : Math.max(10.8, 12.6 / Math.max(.55, world.camera.aspect));
    world.camera.position.copy(target).add(new world.THREE.Vector3(.12, .85, 1).normalize().multiplyScalar(distance));
    world.controls.target.copy(target); world.controls.update();
    world.cameraUI.setFollowing(following);
    threeLayer.dataset.camera = following ? 'follow' : 'whole';
    drawThree();
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, environment, trajectories, arrows } = world;
    const mapKey = run.initial.preset;
    if (world.mapKey !== mapKey) {
      clearGroup(environment);
      for (const [a, b] of run.walls) {
        // Extruding the exact capsule footprint adds no path or vertical escape.
        const dx = b[0] - a[0], dy = b[1] - a[1], wallLength = Math.hypot(dx, dy);
        const material = new THREE.MeshStandardMaterial({ color: 0x80938c, roughness: .85 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(wallLength, WALL_HEIGHT, 2 * WALL_RADIUS), material);
        box.position.set((a[0] + b[0]) / 2, WALL_HEIGHT / 2, -(a[1] + b[1]) / 2);
        box.rotation.y = Math.atan2(dy, dx); box.castShadow = true; box.receiveShadow = true; environment.add(box);
        for (const point of [a, b]) {
          const end = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, WALL_HEIGHT, 24), material.clone());
          end.position.set(point[0], WALL_HEIGHT / 2, -point[1]); end.castShadow = true; end.receiveShadow = true; environment.add(end);
        }
      }
      world.mapKey = mapKey;
    }
    const phase = run.history.at(-1).time * 34;
    run.positions.forEach((point, index) => {
      const previous = run.history.length > 1 ? run.history.at(-2).positions[index] : point;
      const delta = [point[0] - previous[0], point[1] - previous[1]];
      const heading = Math.hypot(...delta) > 1e-10 ? Math.atan2(delta[1], delta[0]) : Math.atan2(GOAL[1] - point[1], GOAL[0] - point[0]);
      setWorkshopDrone(world.agents[index], { position: [point[0], DISPLAY_HEIGHT, -point[1]], heading, phase, active: run.status !== 'collision' });
      world.footprints[index].position.set(point[0], .012, -point[1]);
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
    });
    world.marker.position.set(run.positions[selected][0], .025, -run.positions[selected][1]);
    clearGroup(arrows);
    if (run.status !== 'collision') {
      const command = movementCommand(observeMovement(run, selected), run.gains), position = run.positions[selected];
      for (const [index, key] of ['attraction', 'obstacle', 'separation', 'velocity'].entries()) {
        const vector = command[key], magnitude = Math.hypot(...vector);
        if (magnitude < .00001) continue;
        const length = Math.min(magnitude, 2.3) * (36 / 78);
        arrows.add(new THREE.ArrowHelper(new THREE.Vector3(vector[0], 0, -vector[1]).normalize(), new THREE.Vector3(position[0], DISPLAY_HEIGHT + .04 + index * .035, -position[1]), length, VECTOR_COLORS[key], Math.min(.10, length * .3), Math.min(.055, length * .2)));
      }
    }
    if (world.historyLength !== run.history.length || world.historyStart !== run.history[0]) {
      clearGroup(trajectories);
      run.positions.forEach((_, index) => {
        for (const height of [.022, DISPLAY_HEIGHT]) {
          const geometry = new THREE.BufferGeometry().setFromPoints(run.history.map((state) => new THREE.Vector3(state.positions[index][0], height, -state.positions[index][1])));
          trajectories.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLORS[index], transparent: true, opacity: height === DISPLAY_HEIGHT ? .7 : .22 })));
        }
      });
      world.historyLength = run.history.length; world.historyStart = run.history[0];
    }
    world.cameraUI.setFollowLabel(`Follow A${selected + 1}`);
    if (world.following) {
      const target = new THREE.Vector3(run.positions[selected][0], DISPLAY_HEIGHT * .75, -run.positions[selected][1]);
      world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update();
    }
    threeLayer.dataset.agents = JSON.stringify(run.positions.map((p) => [p[0], DISPLAY_HEIGHT, -p[1]]));
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    const { renderer, scene, camera } = world;
    renderer.render(scene, camera);
    const placed = [], width = container.clientWidth, height = container.clientHeight;
    world.agents.forEach((mesh, index) => {
      const point = mesh.position.clone().add(new world.THREE.Vector3(0, .13, 0)).project(camera), label = world.labels[index];
      const left = Math.max(24, Math.min(width - 24, (point.x + 1) * width / 2));
      let top = Math.max(80, Math.min(height - 35, (1 - point.y) * height / 2));
      while (placed.some((other) => Math.abs(other[0] - left) < 40 && Math.abs(other[1] - top) < 27)) top += 28;
      label.style.left = `${left}px`; label.style.top = `${top}px`;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.08 || Math.abs(point.y) > 1.08;
      if (!label.hidden) placed.push([left, top]);
    });
  }
  function resize() {
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const changed = world.width !== width || world.height !== height;
    world.width = width; world.height = height;
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
    if (changed && !world.following && run) frameCamera(false); else drawThree();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  return {
    update(nextRun, agent = selected) {
      run = nextRun; selected = agent;
      // Preserve focus when a keyboard user selects a regenerated SVG node.
      const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.movementAgent : null;
      drawSvg();
      if (focused !== null) svg.querySelector(`[data-movement-agent="${focused}"]`)?.focus({ preventScroll: true });
      updateThree();
    },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown movement view.');
      mode = nextMode;
      svg.hidden = mode !== '2d';
      svg.style.display = mode === '2d' ? '' : 'none';
      threeLayer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed;
      resize();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      disposeWorld();
      container.replaceChildren();
    },
  };
}
