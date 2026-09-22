import { cellCenter, cellXY } from './pathfinding-model.js';
import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { floor: '#19372f', wall: '#526762', truth: '#72dabb', estimate: '#b5acff', goal: '#f1c17d', fix: '#b7d7ff', route: '#9cafa5', uncertainty: '#988bdd' };
const DISPLAY_HEIGHT = .8, WALL_HEIGHT = 1.65;

function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function releaseGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((node) => {
    node.shadow?.dispose();
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
  let run, mode = '2d', world, loading = false, failed = false, disposed = false, following = false;
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
      renderer.domElement.setAttribute('aria-label', 'Detailed solid drone is physical truth; wireframe drone is its estimate. Both use fixed display height above the unchanged planar localization map. Drag to orbit, scroll to zoom, or use arrow keys to pan.');
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same localization run in 2D.'); });
      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 2; controls.maxDistance = 52; controls.maxPolarAngle = Math.PI / 2 - .12;
      controls.listenToKeyEvents(renderer.domElement);
      createWorkshopStage(THREE, scene, renderer, { center: [run.grid.width / 2, -run.grid.height / 2], size: [run.grid.width, run.grid.height], grid: 1 });
      const grid = new THREE.Group(), paths = new THREE.Group(); scene.add(grid, paths);
      const truth = createWorkshopDrone(THREE, { color: COLORS.truth, size: .65, id: 'T' }); scene.add(truth);
      const estimate = createWorkshopDrone(THREE, { color: COLORS.estimate, size: .76, ghost: true, id: 'E' }); scene.add(estimate);
      const projections = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 4 }, () => new THREE.Vector3())),
        new THREE.LineDashedMaterial({ color: '#cfdfd1', dashSize: .05, gapSize: .045, transparent: true, opacity: .5 }));
      projections.frustumCulled = false; scene.add(projections);
      const ring = (inner, outer, color) => {
        const result = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        result.rotation.x = -Math.PI / 2; scene.add(result); return result;
      };
      const estimateFootprint = ring(.17, .215, COLORS.estimate), goal = ring(.21, .25, COLORS.goal), waypoint = ring(.055, .08, '#ffffff');
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
      const cameraUI = addWorkshopCameraUI(layer, { prefix: 'loc',
        caption: 'SOLID: TRUTH · WIREFRAME: ESTIMATE · HEIGHT 0.8 m · OCCLUDING WALLS FADE; CONTACT UNCHANGED',
        onWhole: () => frameCamera(false), onFollow: () => frameCamera(true) });
      cameraUI.setFollowLabel('Follow truth');
      world = { THREE, renderer, scene, camera, controls, cameraUI, grid, paths, truth, estimate, estimateFootprint, projections, goal, waypoint, uncertainty, fix, error, labels, walls: [], gridKey: null, history: null, plan: null };
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
    releaseGroup(world.grid); world.walls = [];
    const floorGeometry = new THREE.PlaneGeometry(.97, .97), wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT, 1), walls = new Set(blocked);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1, side: THREE.DoubleSide });
    const wallMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 1 });
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellCenter(id, width), wall = walls.has(id);
      const mesh = new THREE.Mesh(wall ? wallGeometry : floorGeometry, wall ? wallMaterial.clone() : floorMaterial);
      if (!wall) mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, wall ? WALL_HEIGHT / 2 : .016, -y); mesh.castShadow = wall; mesh.receiveShadow = true; world.grid.add(mesh);
      if (wall) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeometry), new THREE.LineBasicMaterial({ color: '#9aa996', transparent: true, opacity: .5 }));
        edges.position.copy(mesh.position); world.grid.add(edges);
        // A slightly expanded sightline test covers both illustrative airframes;
        // the wall and the occupied-cell footprint themselves remain unchanged.
        world.walls.push({ mesh, bounds: new THREE.Box3(new THREE.Vector3(x - .5, 0, -y - .5), new THREE.Vector3(x + .5, WALL_HEIGHT, -y + .5))
          .expandByVector(new THREE.Vector3(.39, .15, .39)) });
      }
    }
    wallMaterial.dispose();
    if (!walls.size) wallGeometry.dispose();
    const points = [];
    for (let x = 0; x <= width; x += 1) points.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, -height));
    for (let y = 0; y <= height; y += 1) points.push(new THREE.Vector3(0, 0, -y), new THREE.Vector3(width, 0, -y));
    world.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#48675b' })));
    const destination = cellCenter(goal, width); world.goal.position.set(destination[0], .04, -destination[1]);
    if (world.gridKey === null) frameCamera(false);
    world.gridKey = key; world.history = null; world.plan = null;
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    buildThreeGrid();
    const previous = run.history.slice(0, -1).reverse().find(row => Math.hypot(row.position[0] - run.position[0], row.position[1] - run.position[1]) > 1e-8);
    const next = run.plan.waypoints[run.waypointIndex] ?? cellCenter(run.grid.goal, run.grid.width);
    const direction = previous ? run.position.map((value, axis) => value - previous.position[axis]) : next.map((value, axis) => value - run.estimate[axis]);
    const heading = Math.atan2(direction[1], direction[0]), phase = run.step * .1;
    setWorkshopDrone(world.truth, { position: [run.position[0], DISPLAY_HEIGHT, -run.position[1]], heading, phase, active: run.status === 'following' });
    setWorkshopDrone(world.estimate, { position: [run.estimate[0], DISPLAY_HEIGHT, -run.estimate[1]], heading, phase, active: run.status === 'following' });
    world.truth.userData.bodyMaterial?.color.set(run.status === 'collision' ? '#f3a291' : COLORS.truth);
    world.estimate.userData.bodyMaterial?.color.set(COLORS.estimate);
    world.estimateFootprint.position.set(run.estimate[0], .06, -run.estimate[1]);
    const projections = world.projections.geometry.attributes.position;
    for (const [index, position] of [run.position, run.estimate].entries()) {
      projections.setXYZ(index * 2, position[0], .025, -position[1]);
      projections.setXYZ(index * 2 + 1, position[0], DISPLAY_HEIGHT, -position[1]);
    }
    projections.needsUpdate = true; world.projections.computeLineDistances();
    if (following) {
      const target = world.truth.position.clone(); world.camera.position.add(target.clone().sub(world.controls.target));
      world.controls.target.copy(target); world.controls.update();
    }
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
    errorPositions.setXYZ(0, run.position[0], DISPLAY_HEIGHT, -run.position[1]);
    errorPositions.setXYZ(1, run.estimate[0], DISPLAY_HEIGHT, -run.estimate[1]); errorPositions.needsUpdate = true;
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
  function frameCamera(follow) {
    if (!world || !run) return;
    following = follow; world.cameraUI.setFollowing(follow);
    if (follow) {
      const error = Math.hypot(run.position[0] - run.estimate[0], run.position[1] - run.estimate[1]);
      const fit = Math.max(1, Math.min(3, error / 2));
      world.controls.target.set(run.position[0], DISPLAY_HEIGHT, -run.position[1]);
      world.camera.position.copy(world.controls.target).add(new world.THREE.Vector3(-3.6, 4.1, 1.8).multiplyScalar(fit));
    } else {
      const span = Math.max(run.grid.width, run.grid.height), fit = Math.max(1, 1.08 / world.camera.aspect);
      world.controls.target.set(run.grid.width / 2, .4, -run.grid.height / 2);
      world.camera.position.copy(world.controls.target).add(new world.THREE.Vector3(-span * .65, span * 1.25, span * .65).multiplyScalar(fit));
    }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    // Reveal either displayed pose when a wall blocks its sightline. Camera
    // orbiting changes only wall opacity, never truth, estimation or contact.
    const rays = [world.truth, world.estimate].map(({ position }) => {
      const direction = position.clone().sub(world.camera.position);
      return { position, distance: direction.length(), ray: new world.THREE.Ray(world.camera.position, direction.normalize()) };
    });
    const hit = new world.THREE.Vector3(); let faded = 0;
    for (const { mesh, bounds } of world.walls) {
      const occludes = rays.some(({ position, distance, ray }) => bounds.containsPoint(position) || Boolean(ray.intersectBox(bounds, hit) && world.camera.position.distanceTo(hit) < distance));
      const material = mesh.material;
      if (material.transparent !== occludes) { material.transparent = occludes; material.depthWrite = !occludes; material.needsUpdate = true; }
      material.opacity = occludes ? .14 : 1;
      if (occludes) faded += 1;
    }
    layer.dataset.occludedWalls = String(faded);
    world.renderer.render(world.scene, world.camera);
    const place = (anchor, label, visible = true) => {
      const point = anchor.clone().project(world.camera);
      const x = (point.x + 1) * container.clientWidth / 2, y = (1 - point.y) * container.clientHeight / 2;
      label.style.left = `${Math.max(32, Math.min(container.clientWidth - 32, x))}px`;
      label.style.top = `${Math.max(65, Math.min(container.clientHeight - 54, y))}px`;
      label.hidden = !visible || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    };
    place(world.truth.position, world.labels.truth); place(world.estimate.position, world.labels.estimate);
    place(world.goal.position, world.labels.goal); place(world.fix.position, world.labels.fix, world.fix.visible);
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const changed = world.viewportWidth !== width || world.viewportHeight !== height;
    world.viewportWidth = width; world.viewportHeight = height;
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix();
    if (changed && !following) frameCamera(false); else drawThree();
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
