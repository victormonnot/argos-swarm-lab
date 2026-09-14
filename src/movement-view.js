import { AGENT_RADIUS, WALL_RADIUS, GOAL, GOAL_RADIUS, observeMovement, movementCommand } from './movement-model.js';

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

  function unavailable(message) {
    failed = true;
    threeLayer.replaceChildren(Object.assign(document.createElement('p'), { className: 'movement-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    threeLayer.textContent = 'Loading 3D…';
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D view of planar movement. Drag to orbit, scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Use 2D to keep exploring the same run.'); });
      threeLayer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
      camera.position.set(0, 9.7, 9.7);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.enablePan = false;
      controls.minDistance = 6;
      controls.maxDistance = 23;
      controls.maxPolarAngle = Math.PI / 2 - 0.12;
      controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2.3);
      light.position.set(-3, 8, 5);
      scene.add(light);
      scene.add(new THREE.GridHelper(12, 24, 0x48665c, 0x29483f));
      const geometry = new THREE.CylinderGeometry(AGENT_RADIUS, AGENT_RADIUS, 0.08, 28);
      const agents = COLORS.map((color) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
        scene.add(mesh);
        return mesh;
      });
      const goal = new THREE.Mesh(new THREE.CircleGeometry(GOAL_RADIUS, 64), new THREE.MeshBasicMaterial({ color: 0x83aa61, transparent: true, opacity: 0.32, side: THREE.DoubleSide }));
      goal.rotation.x = -Math.PI / 2;
      goal.position.set(GOAL[0], 0.006, -GOAL[1]);
      scene.add(goal);
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.20, 0.23, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2;
      scene.add(marker);
      const environment = new THREE.Group(), trajectories = new THREE.Group();
      scene.add(environment, trajectories);
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
      world = { THREE, renderer, scene, camera, controls, agents, marker, environment, trajectories, labels, mapKey: null, historyLength: -1 };
      controls.addEventListener('change', drawThree);
      updateThree();
      resize();
    } catch {
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2. The 2D experiment and state table remain available.');
    } finally { loading = false; }
  }
  function clearGroup(group) {
    for (const child of [...group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    }
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const { THREE, environment, trajectories } = world;
    const mapKey = run.initial.preset;
    if (world.mapKey !== mapKey) {
      clearGroup(environment);
      for (const [a, b] of run.walls) {
        // Capsule cross-section matches the 2D wall: a central rectangle plus
        // semicircular ends. Height is only a visual extrusion of that footprint.
        const dx = b[0] - a[0], dy = b[1] - a[1], wallLength = Math.hypot(dx, dy);
        const box = new THREE.Mesh(new THREE.BoxGeometry(wallLength, 0.4, 2 * WALL_RADIUS), new THREE.MeshStandardMaterial({ color: 0x7d938b }));
        box.position.set((a[0] + b[0]) / 2, 0.2, -(a[1] + b[1]) / 2);
        box.rotation.y = Math.atan2(dy, dx);
        environment.add(box);
        for (const point of [a, b]) {
          const end = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x7d938b }));
          end.position.set(point[0], 0.2, -point[1]);
          environment.add(end);
        }
      }
      world.mapKey = mapKey;
    }
    run.positions.forEach((point, index) => {
      world.agents[index].position.set(point[0], 0.05, -point[1]);
      world.labels[index].setAttribute('aria-pressed', String(index === selected));
    });
    world.marker.position.set(run.positions[selected][0], 0.009, -run.positions[selected][1]);
    // Rebuild paths only when the numerical history changes, not on selection.
    if (world.historyLength !== run.history.length || world.historyStart !== run.history[0]) {
      clearGroup(trajectories);
      run.positions.forEach((_, index) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(run.history.map((state) => new THREE.Vector3(state.positions[index][0], 0.018, -state.positions[index][1])));
        trajectories.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLORS[index], transparent: true, opacity: 0.75 })));
      });
      world.historyLength = run.history.length;
      world.historyStart = run.history[0];
    }
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    const { renderer, scene, camera } = world;
    renderer.render(scene, camera);
    world.agents.forEach((mesh, index) => {
      const point = mesh.position.clone().project(camera);
      const label = world.labels[index];
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`;
      label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = point.z < -1 || point.z > 1;
    });
  }
  function resize() {
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
    drawThree();
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
      if (world) {
        world.controls.dispose();
        const geometries = new Set(), materials = new Set();
        world.scene.traverse((node) => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        world.renderer.dispose();
      }
      container.replaceChildren();
    },
  };
}
