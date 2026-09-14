import { cellCenter, cellXY } from './pathfinding-model.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { floor: '#19372f', wall: '#526762', open: '#365e49', closed: '#304746', current: '#656037', route: '#f1c17d', trail: '#72dabb', ink: '#dcebe2', collision: '#f3a291' };

function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function releaseGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}

/** Render a supplied search snapshot and executor history. Camera and selection
 * changes never run search or advance the point agent. Both views use x, y in
 * the same planar world; positive model y maps to negative Three.js z. */
export function createPathfindingView(container, { selectCell = () => {} } = {}) {
  let run, mode = '2d', world, loading = false, failed = false, disposed = false;
  let options = { traceIndex: 0, selectedCell: null, showSearch: true };
  const svg = element('svg', { viewBox: '0 0 760 600', class: 'path-svg', role: 'group', 'aria-label': 'Pathfinding grid. Select a cell to inspect it; arrow keys move between cells. The positive y direction is upward.' });
  const layer = document.createElement('div'); layer.className = 'path-three'; layer.hidden = true;
  container.append(svg, layer);

  function selectionValid() { return Number.isInteger(options.selectedCell) && options.selectedCell >= 0 && options.selectedCell < run.grid.width * run.grid.height; }
  function searchSnapshot() {
    if (!options.showSearch || !run.plan.trace.length) return null;
    const index = Math.max(0, Math.min(run.plan.trace.length - 1, Math.trunc(options.traceIndex) || 0));
    return run.plan.trace[index];
  }
  function searchCells() {
    const snapshot = searchSnapshot();
    return { current: snapshot?.current ?? null, open: new Set(snapshot?.open), closed: new Set(snapshot?.closed) };
  }
  function searchState(id, search) { return search.current === id ? 'current' : search.open.has(id) ? 'open' : search.closed.has(id) ? 'closed' : 'none'; }
  function routePoints() {
    return run.plan.method === 'direct'
      ? [cellCenter(run.grid.start, run.grid.width), cellCenter(run.grid.goal, run.grid.width)]
      : run.plan.path.map((id) => cellCenter(id, run.grid.width));
  }

  function drawSvg() {
    if (!run || disposed) return;
    const focusedCell = svg.contains(document.activeElement) ? document.activeElement.dataset.pathCell : null;
    const { width, height } = run.grid, size = Math.min(660 / width, 495 / height);
    const left = (760 - size * width) / 2, top = (555 - size * height) / 2;
    const X = (x) => left + x * size, Y = (y) => top + (height - y) * size;
    const blocked = new Set(run.grid.blocked), search = searchCells();
    const activeCell = selectionValid() ? options.selectedCell : run.grid.start;
    svg.replaceChildren();
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellXY(id, width), state = searchState(id, search), wall = blocked.has(id);
      const description = [`Cell (${x}, ${y})`, wall ? 'wall' : 'free', id === run.grid.start ? 'start' : '', id === run.grid.goal ? 'goal' : '', state === 'none' ? '' : state === 'open' ? 'open frontier' : state === 'closed' ? 'closed settled' : 'current expansion'].filter(Boolean).join(', ');
      const group = element('g', { role: 'button', tabindex: id === activeCell ? 0 : -1, 'data-path-cell': id, 'data-search': state, 'aria-label': description, 'aria-pressed': String(id === options.selectedCell) });
      group.append(element('rect', { x: X(x), y: Y(y + 1), width: size, height: size, fill: wall ? COLORS.wall : COLORS[state] ?? COLORS.floor, stroke: '#426055', 'stroke-width': .8 }));
      if (wall) group.append(element('path', { d: `M${X(x + .23)},${Y(y + .23)}L${X(x + .77)},${Y(y + .77)}M${X(x + .23)},${Y(y + .77)}L${X(x + .77)},${Y(y + .23)}`, stroke: '#81928a', 'stroke-width': 1.2, 'pointer-events': 'none' }));
      if (!wall && state !== 'none') group.append(element('text', { x: X(x + .79), y: Y(y + .7), fill: state === 'open' ? '#b9e5be' : '#c4d8d1', 'font-size': 14, 'font-weight': 600, 'text-anchor': 'middle', 'pointer-events': 'none' }, search.open.has(id) ? 'O' : '×'));
      if (state === 'current') group.append(element('rect', { x: X(x) + 4, y: Y(y + 1) + 4, width: size - 8, height: size - 8, fill: 'none', stroke: COLORS.route, 'stroke-width': 2, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      if (id === options.selectedCell) group.append(element('rect', { x: X(x) + 1.8, y: Y(y + 1) + 1.8, width: size - 3.6, height: size - 3.6, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.5, 'pointer-events': 'none' }));
      group.addEventListener('click', () => selectCell(id));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCell(id); return; }
        const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] };
        if (!offsets[event.key]) return;
        event.preventDefault();
        const [dx, dy] = offsets[event.key], nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const next = ny * width + nx;
        svg.querySelector(`[data-path-cell="${next}"]`)?.focus({ preventScroll: true });
        selectCell(next);
      });
      svg.append(group);
    }
    const markings = element('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
    const route = routePoints();
    if (route.length > 1) markings.append(element('polyline', { 'data-path-route': run.plan.method === 'direct' ? 'unchecked' : 'grid', points: route.map(([x, y]) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: COLORS.route, 'stroke-width': 2.4, 'stroke-dasharray': '7 5', 'stroke-linejoin': 'round' }));
    if (run.history.length > 1) markings.append(element('polyline', { 'data-path-trail': '', points: run.history.map(({ position: [x, y] }) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: COLORS.trail, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const start = cellCenter(run.grid.start, width), goal = cellCenter(run.grid.goal, width);
    markings.append(element('circle', { cx: X(start[0]), cy: Y(start[1]), r: 11, fill: 'none', stroke: '#b4cac0', 'stroke-width': 2 }));
    markings.append(element('text', { x: X(start[0]) - 15, y: Y(start[1]) + 21, fill: '#dcebe2', 'font-size': 15, 'font-weight': 600 }, 'S'));
    const gx = X(goal[0]), gy = Y(goal[1]);
    markings.append(element('path', { d: `M${gx},${gy - 11}L${gx + 11},${gy}L${gx},${gy + 11}L${gx - 11},${gy}Z`, fill: '#213c31', stroke: COLORS.route, 'stroke-width': 2 }));
    markings.append(element('text', { x: gx + 12, y: gy + 22, fill: COLORS.route, 'font-size': 15, 'font-weight': 600 }, 'G'));
    const waypoint = run.plan.waypoints[run.waypointIndex];
    if (waypoint) markings.append(element('circle', { 'data-path-waypoint': run.waypointIndex, cx: X(waypoint[0]), cy: Y(waypoint[1]), r: 5, fill: 'none', stroke: '#ffffff', 'stroke-width': 2 }));
    const ax = X(run.position[0]), ay = Y(run.position[1]), agentColor = run.status === 'collision' ? COLORS.collision : COLORS.trail;
    markings.append(element('circle', { 'data-path-agent': '', cx: ax, cy: ay, r: 8, fill: agentColor, stroke: '#102b23', 'stroke-width': 2 }));
    markings.append(element('text', { x: ax - 12, y: ay - 13, fill: agentColor, 'font-size': 16, 'font-weight': 600, 'text-anchor': 'end' }, run.status === 'collision' ? 'A ×' : 'A'));
    svg.append(markings);
    for (let x = 0; x < width; x += 1) svg.append(element('text', { x: X(x + .5), y: Y(0) + 22, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, x));
    for (let y = 0; y < height; y += 1) svg.append(element('text', { x: left - 14, y: Y(y + .5) + 5, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'end' }, y));
    svg.append(element('text', { x: 380, y: 590, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, 'Cell coordinates · 1 m spacing · y increases upward'));
    if (focusedCell !== null) svg.querySelector(`[data-path-cell="${focusedCell}"]`)?.focus({ preventScroll: true });
  }

  function unavailable(message) {
    failed = true;
    if (world) world.controls.enabled = false;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'path-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let renderer, scene, controls;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute('aria-label', '3D display of the same planar grid and point agent. Drag to orbit, scroll to zoom. Inspect cells with the cell selector.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same search and run in 2D.'); });
      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 34; controls.maxPolarAngle = Math.PI / 2 - .2;
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 14, 4); scene.add(light);
      const grid = new THREE.Group(), paths = new THREE.Group(); scene.add(grid, paths);
      const agent = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .22, 24), new THREE.MeshStandardMaterial({ color: COLORS.trail })); scene.add(agent);
      const makeRing = (inner, outer, color) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; scene.add(ring); return ring;
      };
      const start = makeRing(.2, .24, '#b4cac0'), goal = makeRing(.2, .25, COLORS.route), waypoint = makeRing(.085, .12, '#ffffff');
      const makeOutline = (inset, color) => {
        const points = [[inset, inset], [1 - inset, inset], [1 - inset, 1 - inset], [inset, 1 - inset]].map(([x, y]) => new THREE.Vector3(x, .065, -y));
        const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })); scene.add(outline); return outline;
      };
      const selectedOutline = makeOutline(.03, '#ffffff'), currentOutline = makeOutline(.1, COLORS.route);
      const overlay = document.createElement('div'); overlay.className = 'path-labels'; overlay.setAttribute('aria-hidden', 'true');
      const label = (text, color, className) => {
        const span = document.createElement('span'); span.className = className; span.textContent = text; span.style.color = color; overlay.append(span); return span;
      };
      const labels = { agent: label('A', COLORS.trail, 'path-agent-label'), start: label('S', '#dcebe2', 'path-site-label'), goal: label('G', COLORS.route, 'path-site-label'), waypoint: label('W', '#ffffff', 'path-waypoint-label') };
      layer.replaceChildren(renderer.domElement, overlay);
      world = { THREE, renderer, scene, camera, controls, grid, paths, agent, start, goal, waypoint, selectedOutline, currentOutline, overlay, labels, cells: [], gridKey: null, history: null, plan: null };
      controls.addEventListener('change', drawThree);
      updateThree(); resize();
    } catch {
      controls?.dispose();
      if (scene) releaseGroup(scene);
      renderer?.dispose();
      world = undefined;
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D map, search trace and run controls remain available.');
    } finally { loading = false; }
  }
  function buildThreeGrid() {
    const { width, height, blocked, start, goal } = run.grid;
    const key = `${width}/${height}/${blocked.join(',')}/${start}/${goal}`;
    if (key === world.gridKey) return;
    const { THREE } = world;
    releaseGroup(world.grid);
    world.cells.forEach((cell) => cell.label.remove()); world.cells = [];
    const floorGeometry = new THREE.PlaneGeometry(.97, .97), wallGeometry = new THREE.BoxGeometry(.98, .45, .98), walls = new Set(blocked);
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellCenter(id, width), wall = walls.has(id);
      const mesh = new THREE.Mesh(wall ? wallGeometry : floorGeometry, new THREE.MeshStandardMaterial({ color: wall ? COLORS.wall : COLORS.floor, roughness: 1, side: THREE.DoubleSide }));
      if (!wall) mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, wall ? .225 : .008, -y); world.grid.add(mesh);
      const label = document.createElement('span'); label.className = 'path-search-label'; label.hidden = true; world.overlay.append(label);
      world.cells.push({ mesh, label, wall, anchor: new THREE.Vector3(x + .28, .055, -y - .28) });
    }
    // A map can contain no walls: dispose its unused shared geometry as well.
    if (!walls.size) wallGeometry.dispose();
    const points = [];
    for (let x = 0; x <= width; x += 1) points.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, -height));
    for (let y = 0; y <= height; y += 1) points.push(new THREE.Vector3(0, 0, -y), new THREE.Vector3(width, 0, -y));
    world.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#48675b' })));
    const origin = cellCenter(start, width), destination = cellCenter(goal, width);
    world.start.position.set(origin[0], .04, -origin[1]); world.goal.position.set(destination[0], .04, -destination[1]);
    if (world.gridKey === null) {
      world.camera.position.set(width / 2, 13, 8);
      world.controls.target.set(width / 2, 0, -height / 2); world.controls.update();
    }
    world.gridKey = key; world.history = null; world.plan = null;
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    buildThreeGrid();
    const search = searchCells();
    world.cells.forEach((cell, id) => {
      const state = searchState(id, search);
      cell.mesh.material.color.set(cell.wall ? COLORS.wall : COLORS[state] ?? COLORS.floor);
      cell.label.hidden = cell.wall || state === 'none';
      cell.label.textContent = search.open.has(id) ? 'O' : '×';
      cell.label.style.color = state === 'open' ? '#b9e5be' : '#c4d8d1';
      cell.visibleLabel = !cell.label.hidden;
    });
    const agentColor = run.status === 'collision' ? COLORS.collision : COLORS.trail;
    world.agent.position.set(run.position[0], .15, -run.position[1]); world.agent.material.color.set(agentColor);
    world.labels.agent.textContent = run.status === 'collision' ? 'A ×' : 'A'; world.labels.agent.style.color = agentColor;
    world.selectedOutline.visible = selectionValid();
    if (selectionValid()) {
      const [x, y] = cellXY(options.selectedCell, run.grid.width);
      world.selectedOutline.position.set(x, world.cells[options.selectedCell].wall ? .45 : 0, -y);
    }
    world.currentOutline.visible = search.current !== null;
    if (search.current !== null) { const [x, y] = cellXY(search.current, run.grid.width); world.currentOutline.position.set(x, 0, -y); }
    const waypoint = run.plan.waypoints[run.waypointIndex];
    world.waypoint.visible = Boolean(waypoint); world.labels.waypoint.hidden = !waypoint;
    if (waypoint) world.waypoint.position.set(waypoint[0], .06, -waypoint[1]);
    if (world.history !== run.history || world.plan !== run.plan) {
      releaseGroup(world.paths);
      const { THREE } = world, route = routePoints();
      if (route.length > 1) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.map(([x, y]) => new THREE.Vector3(x, .075, -y))), new THREE.LineDashedMaterial({ color: COLORS.route, dashSize: .16, gapSize: .12 }));
        line.computeLineDistances(); world.paths.add(line);
      }
      if (run.history.length > 1) world.paths.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(run.history.map(({ position: [x, y] }) => new THREE.Vector3(x, .095, -y))), new THREE.LineBasicMaterial({ color: COLORS.trail })));
      world.history = run.history; world.plan = run.plan;
    }
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const place = (anchor, label, visible = true) => {
      const point = anchor.clone().project(world.camera);
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`;
      label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = !visible || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    };
    place(world.agent.position, world.labels.agent); place(world.start.position, world.labels.start); place(world.goal.position, world.labels.goal);
    place(world.waypoint.position, world.labels.waypoint, world.waypoint.visible);
    world.cells.forEach((cell) => place(cell.anchor, cell.label, cell.visibleLabel));
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, nextOptions = {}) {
      if (disposed) return;
      run = state; options = { ...options, ...nextOptions }; drawSvg(); updateThree();
    },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown pathfinding view.');
      if (disposed) return;
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed;
      resize();
    },
    dispose() {
      disposed = true; observer.disconnect();
      if (world) { world.controls.dispose(); releaseGroup(world.scene); world.renderer.dispose(); world = undefined; }
      container.replaceChildren();
    },
  };
}
