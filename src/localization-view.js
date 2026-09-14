import { cellCenter, cellXY } from './pathfinding-model.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { floor: '#19372f', wall: '#526762', truth: '#72dabb', estimate: '#b5acff', goal: '#f1c17d', fix: '#b7d7ff', route: '#9cafa5', uncertainty: '#988bdd' };

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

/** Observe one supplied run. T is evaluator truth, E is the estimate and Z is
 * the latest absolute reading, which may be old. Rendering and camera controls
 * never advance the estimator or controller. Model y maps to negative 3D z;
 * wall height and marker height are decorative, not vertical dynamics. */
export function createLocalizationView(container) {
  let run, mode = '2d', world, loading = false, failed = false, disposed = false;
  const svg = element('svg', { viewBox: '0 0 760 600', class: 'loc-svg', role: 'img', 'aria-label': 'Localization map: solid T is physical truth, hollow E is the position estimate, G is the goal, and cross Z is the latest absolute reading. The ellipse has two-standard-deviation axes from the filter covariance. Positive y is upward.' });
  const layer = document.createElement('div'); layer.className = 'loc-three'; layer.hidden = true;
  container.append(svg, layer);
  const routePoints = () => run.plan.path.map((id) => cellCenter(id, run.grid.width));

  function drawSvg() {
    if (!run || disposed) return;
    const { width, height } = run.grid, size = Math.min(660 / width, 495 / height);
    const left = (760 - size * width) / 2, top = (555 - size * height) / 2;
    const X = (x) => left + x * size, Y = (y) => top + (height - y) * size;
    const blocked = new Set(run.grid.blocked);
    svg.replaceChildren();
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellXY(id, width), wall = blocked.has(id);
      svg.append(element('rect', { x: X(x), y: Y(y + 1), width: size, height: size, fill: wall ? COLORS.wall : COLORS.floor, stroke: '#426055', 'stroke-width': .8 }));
      if (wall) svg.append(element('path', { d: `M${X(x + .23)},${Y(y + .23)}L${X(x + .77)},${Y(y + .77)}M${X(x + .23)},${Y(y + .77)}L${X(x + .77)},${Y(y + .23)}`, stroke: '#81928a', 'stroke-width': 1.2 }));
    }
    const route = routePoints();
    if (route.length > 1) svg.append(element('polyline', { 'data-loc-route': '', points: route.map(([x, y]) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: COLORS.route, 'stroke-width': 2.2, 'stroke-dasharray': '7 5', 'stroke-linejoin': 'round' }));
    if (run.history.length > 1) {
      for (const [key, color, dash] of [['position', COLORS.truth, 'none'], ['estimate', COLORS.estimate, '4 3']]) {
        svg.append(element('polyline', { 'data-loc-trail': key, points: run.history.map((sample) => `${X(sample[key][0])},${Y(sample[key][1])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
    }
    const [gx, gy] = cellCenter(run.grid.goal, width).map((value, axis) => axis === 0 ? X(value) : Y(value));
    svg.append(element('path', { d: `M${gx},${gy - 11}L${gx + 11},${gy}L${gx},${gy + 11}L${gx - 11},${gy}Z`, fill: COLORS.floor, stroke: COLORS.goal, 'stroke-width': 2 }));
    svg.append(element('text', { x: gx + 14, y: gy + 24, fill: COLORS.goal, 'font-size': 16, 'font-weight': 600 }, 'G'));
    const waypoint = run.plan.waypoints[run.waypointIndex];
    if (waypoint) svg.append(element('circle', { 'data-loc-waypoint': run.waypointIndex, cx: X(waypoint[0]), cy: Y(waypoint[1]), r: 4, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.5 }));
    const tx = X(run.position[0]), ty = Y(run.position[1]), ex = X(run.estimate[0]), ey = Y(run.estimate[1]);
    if (run.covariance) svg.append(element('ellipse', { 'data-loc-uncertainty': '', cx: ex, cy: ey, rx: 2 * Math.sqrt(run.covariance[0]) * size, ry: 2 * Math.sqrt(run.covariance[1]) * size, fill: COLORS.uncertainty, 'fill-opacity': .09, stroke: COLORS.uncertainty, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
    svg.append(element('line', { 'data-loc-error': '', x1: tx, y1: ty, x2: ex, y2: ey, stroke: COLORS.estimate, 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
    if (run.lastFix) {
      const fx = X(run.lastFix.position[0]), fy = Y(run.lastFix.position[1]), stale = run.lastFix.step !== run.step;
      const fix = element('g', { 'data-loc-fix': run.lastFix.step, 'data-stale': String(stale), opacity: stale ? .6 : 1 });
      fix.append(element('path', { d: `M${fx - 7},${fy}H${fx + 7}M${fx},${fy - 7}V${fy + 7}`, fill: 'none', stroke: COLORS.fix, 'stroke-width': 2 }));
      fix.append(element('text', { x: fx - 13, y: fy + 23, fill: COLORS.fix, 'font-size': 16, 'font-weight': 600, 'text-anchor': 'end' }, 'Z'));
      svg.append(fix);
    }
    svg.append(element('circle', { 'data-loc-truth': '', 'data-x': run.position[0], 'data-y': run.position[1], cx: tx, cy: ty, r: 6, fill: COLORS.truth, stroke: '#102b23', 'stroke-width': 1.5 }));
    svg.append(element('circle', { 'data-loc-estimate': '', 'data-x': run.estimate[0], 'data-y': run.estimate[1], cx: ex, cy: ey, r: 10, fill: 'none', stroke: COLORS.estimate, 'stroke-width': 2.4 }));
    svg.append(element('text', { x: tx - 13, y: ty - 13, fill: COLORS.truth, 'font-size': 16, 'font-weight': 600, 'text-anchor': 'end' }, 'T'));
    svg.append(element('text', { x: ex + 13, y: ey - 13, fill: COLORS.estimate, 'font-size': 16, 'font-weight': 600 }, 'E'));
    for (let x = 0; x < width; x += 1) svg.append(element('text', { x: X(x + .5), y: Y(0) + 22, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, x));
    for (let y = 0; y < height; y += 1) svg.append(element('text', { x: left - 14, y: Y(y + .5) + 5, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'end' }, y));
    svg.append(element('text', { x: 380, y: 590, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, 'Cell coordinates · 1 m spacing · y increases upward'));
  }

  function disposeWorld() {
    if (!world) return;
    const previous = world; world = undefined;
    previous.controls.removeEventListener('change', drawThree);
    previous.controls.dispose(); releaseGroup(previous.scene); previous.renderer.dispose();
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'loc-webgl-message', textContent: message }));
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
      renderer.domElement.setAttribute('aria-label', '3D display of the same planar localization run. Solid T is physical truth; hollow E is the estimate. Drag to orbit and scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same localization run in 2D.'); });
      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 34; controls.maxPolarAngle = Math.PI / 2 - .2;
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 14, 4); scene.add(light);
      const grid = new THREE.Group(), paths = new THREE.Group(); scene.add(grid, paths);
      const truth = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .16, 24), new THREE.MeshStandardMaterial({ color: COLORS.truth })); scene.add(truth);
      const ring = (inner, outer, color) => {
        const result = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        result.rotation.x = -Math.PI / 2; scene.add(result); return result;
      };
      const estimate = ring(.17, .215, COLORS.estimate), goal = ring(.21, .25, COLORS.goal), waypoint = ring(.055, .08, '#ffffff');
      const unitCircle = Array.from({ length: 64 }, (_, index) => {
        const angle = index * Math.PI * 2 / 64; return new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      });
      const uncertainty = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(unitCircle), new THREE.LineBasicMaterial({ color: COLORS.uncertainty })); scene.add(uncertainty);
      const fixPoints = [[-.13, 0], [.13, 0], [0, -.13], [0, .13]].map(([x, y]) => new THREE.Vector3(x, 0, -y));
      const fix = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fixPoints), new THREE.LineBasicMaterial({ color: COLORS.fix, transparent: true })); scene.add(fix);
      const error = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: COLORS.estimate, transparent: true, opacity: .55 }));
      error.frustumCulled = false; scene.add(error);
      const overlay = document.createElement('div'); overlay.className = 'loc-labels'; overlay.setAttribute('aria-hidden', 'true');
      const label = (text, color, className) => {
        const span = document.createElement('span'); span.textContent = text; span.style.color = color; span.className = className; overlay.append(span); return span;
      };
      const labels = { truth: label('T', COLORS.truth, 'loc-truth-label'), estimate: label('E', COLORS.estimate, 'loc-estimate-label'), goal: label('G', COLORS.goal, 'loc-goal-label'), fix: label('Z', COLORS.fix, 'loc-fix-label') };
      layer.replaceChildren(renderer.domElement, overlay);
      world = { THREE, renderer, scene, camera, controls, grid, paths, truth, estimate, goal, waypoint, uncertainty, fix, error, labels, gridKey: null, history: null, plan: null };
      controls.addEventListener('change', drawThree);
      updateThree(); resize();
    } catch {
      controls?.dispose();
      if (scene) releaseGroup(scene);
      renderer?.dispose(); world = undefined;
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D map and localization controls remain available.');
    } finally { loading = false; }
  }
  function buildThreeGrid() {
    const { width, height, blocked, start, goal } = run.grid;
    const key = `${width}/${height}/${blocked.join(',')}/${start}/${goal}`;
    if (key === world.gridKey) return;
    const { THREE } = world;
    releaseGroup(world.grid);
    const floorGeometry = new THREE.PlaneGeometry(.97, .97), wallGeometry = new THREE.BoxGeometry(.98, .45, .98), walls = new Set(blocked);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1, side: THREE.DoubleSide });
    const wallMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 1 });
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellCenter(id, width), wall = walls.has(id);
      const mesh = new THREE.Mesh(wall ? wallGeometry : floorGeometry, wall ? wallMaterial : floorMaterial);
      if (!wall) mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, wall ? .225 : .008, -y); world.grid.add(mesh);
    }
    if (!walls.size) { wallGeometry.dispose(); wallMaterial.dispose(); }
    const points = [];
    for (let x = 0; x <= width; x += 1) points.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, -height));
    for (let y = 0; y <= height; y += 1) points.push(new THREE.Vector3(0, 0, -y), new THREE.Vector3(width, 0, -y));
    world.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#48675b' })));
    const destination = cellCenter(goal, width); world.goal.position.set(destination[0], .04, -destination[1]);
    if (world.gridKey === null) {
      world.camera.position.set(width / 2, 13, 8);
      world.controls.target.set(width / 2, 0, -height / 2); world.controls.update();
    }
    world.gridKey = key; world.history = null; world.plan = null;
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    buildThreeGrid();
    world.truth.position.set(run.position[0], .13, -run.position[1]);
    world.estimate.position.set(run.estimate[0], .09, -run.estimate[1]);
    world.uncertainty.visible = Boolean(run.covariance);
    if (run.covariance) {
      world.uncertainty.position.set(run.estimate[0], .07, -run.estimate[1]);
      world.uncertainty.scale.set(2 * Math.sqrt(run.covariance[0]), 1, 2 * Math.sqrt(run.covariance[1]));
    }
    world.fix.visible = Boolean(run.lastFix);
    if (run.lastFix) {
      world.fix.position.set(run.lastFix.position[0], .11, -run.lastFix.position[1]);
      world.fix.material.opacity = run.lastFix.step === run.step ? 1 : .6;
      world.labels.fix.style.opacity = String(world.fix.material.opacity);
    }
    const errorPositions = world.error.geometry.attributes.position;
    errorPositions.setXYZ(0, run.position[0], .08, -run.position[1]);
    errorPositions.setXYZ(1, run.estimate[0], .08, -run.estimate[1]); errorPositions.needsUpdate = true;
    const waypoint = run.plan.waypoints[run.waypointIndex];
    world.waypoint.visible = Boolean(waypoint);
    if (waypoint) world.waypoint.position.set(waypoint[0], .055, -waypoint[1]);
    if (world.history !== run.history || world.plan !== run.plan) {
      releaseGroup(world.paths);
      const { THREE } = world, route = routePoints();
      const addLine = (points, color, height, dashed = false) => {
        if (points.length < 2) return;
        const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .13, gapSize: .09 }) : new THREE.LineBasicMaterial({ color });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, height, -y))), material);
        if (dashed) line.computeLineDistances();
        world.paths.add(line);
      };
      addLine(route, COLORS.route, .035, true);
      addLine(run.history.map((sample) => sample.position), COLORS.truth, .045);
      addLine(run.history.map((sample) => sample.estimate), COLORS.estimate, .05, true);
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
    place(world.truth.position, world.labels.truth); place(world.estimate.position, world.labels.estimate);
    place(world.goal.position, world.labels.goal); place(world.fix.position, world.labels.fix, world.fix.visible);
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state) { if (disposed) return; run = state; drawSvg(); updateThree(); },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown localization view.');
      if (disposed) return;
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed;
      resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); container.replaceChildren(); },
  };
}
