// Both views consume received evidence at one host-time cursor. Rendering does
// not integrate dynamics, interpolate poses, or provide world truth to agents.
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { A1: '#a9e5c9', A2: '#edc08c', A3: '#abc9fa' };
const scenePoint = ([east, north, up]) => [east, up, -north];
const quaternionHeading = q => q ? Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] ** 2 + q[2] ** 2)) : 0;
const svgNode = (tag, attributes = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
export function createSharedWorldView(container, { onModeChange = () => {} } = {}) {
  let run, frame, world, selected = 'A1', mode = '2d', poseSource = 'both';
  let loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 850 510', class: 'shared-world-svg', role: 'img', 'aria-label': 'Shared Gazebo site: overhead world map and three elevations. Solid aircraft show recorded world poses; dashed aircraft show received estimates.' });
  const layer = Object.assign(document.createElement('div'), { className: 'shared-world-three', hidden: true });
  container.append(svg, layer);
  const estimatePoint = vehicle => vehicle.estimatePositionWorldEnu;
  const primaryPoint = vehicle => poseSource === 'estimate' ? estimatePoint(vehicle) : vehicle.worldPositionEnu;
  const alignedTrail = vehicle => vehicle.estimateTrajectoryWorldEnu ?? vehicle.trajectoryEnu.map(sample => ({ ...sample,
    positionEnu: sample.positionEnu.map((value, index) => value + (run.vehicles.find(item => item.id === vehicle.id).originTruthEnu[index] - vehicle.padEnu[index])) }));
  function drawSvg() {
    if (!frame || disposed) return;
    svg.replaceChildren();
    const map = ([e, n]) => [285 + e * 16, 370 - n * 14], elevation = up => 371 - up * 44;
    svg.append(svgNode('rect', { x: 18, y: 18, width: 535, height: 420, rx: 8, fill: '#223d34', stroke: '#657e66' }), svgNode('rect', { x: 567, y: 18, width: 265, height: 420, rx: 8, fill: '#223d34', stroke: '#657e66' }));
    for (let e = -14; e <= 14; e += 2) svg.append(svgNode('line', { x1: map([e, 0])[0], x2: map([e, 0])[0], y1: 58, y2: 397, stroke: '#657e66', opacity: .35 }));
    for (let n = -2; n <= 20; n += 2) svg.append(svgNode('line', { x1: 47, x2: 522, y1: map([0, n])[1], y2: map([0, n])[1], stroke: '#657e66', opacity: .35 }));
    for (const building of run.world.buildings) {
      const [east, north] = building.positionEnu, [width, depth, height] = building.size, [x, y] = map([east - width / 2, north + depth / 2]);
      svg.append(svgNode('rect', { x, y, width: width * 16, height: depth * 14, fill: '#576b59', stroke: '#9eb38e', 'stroke-width': 1.5 }), svgNode('text', { x: x + width * 8, y: y + depth * 7, fill: '#d8e4c9', 'text-anchor': 'middle', 'font-size': 10 }, `${height} m`));
    }
    svg.append(svgNode('text', { x: 34, y: 43, fill: '#d4e6cf', 'font-size': 12 }, 'SHARED SITE / WORLD ENU'), svgNode('text', { x: 285, y: 422, fill: '#b9cfb3', 'text-anchor': 'middle', 'font-size': 11 }, 'East → · North ↑ · grid 2 m'), svgNode('text', { x: 583, y: 43, fill: '#d4e6cf', 'font-size': 11 }, 'HEIGHT / WORLD GROUND'));
    for (let up = 0; up <= 6; up++) svg.append(svgNode('line', { x1: 605, x2: 817, y1: elevation(up), y2: elevation(up), stroke: '#748e72', opacity: .35 }), svgNode('text', { x: 596, y: elevation(up) + 4, fill: '#c0d6ba', 'font-size': 10, 'text-anchor': 'end' }, `${up} m`));
    for (const task of frame.tasks) {
      const [x, y] = map(task.positionEnu), color = task.state === 'locked' ? '#f1a481' : COLORS[task.ownerId] ?? '#d7c5a0';
      svg.append(svgNode('circle', { cx: x, cy: y, r: 10, fill: task.state === 'completed' ? '#517857' : 'none', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }), svgNode('text', { x: x + 14, y: y - 12, fill: '#e0d6b8', 'font-size': 11 }, `${task.id}${task.state === 'completed' ? ' ✓' : task.state === 'locked' ? ' ⊘' : ''}`));
    }
    for (const vehicle of frame.vehicles) {
      const color = COLORS[vehicle.id], [padX, padY] = map(vehicle.padEnu);
      svg.append(svgNode('circle', { cx: padX, cy: padY, r: 16, fill: '#142d24', stroke: color }), svgNode('text', { x: padX, y: padY + 4, fill: color, 'font-size': 12, 'text-anchor': 'middle' }, 'H'), svgNode('text', { x: padX, y: padY + 30, fill: color, 'font-size': 10, 'text-anchor': 'middle' }, `${vehicle.id} / SYS ${vehicle.systemId}`));
      const sources = [[vehicle.worldPositionEnu, vehicle.worldTrajectoryEnu ?? [], 'world'], [estimatePoint(vehicle), alignedTrail(vehicle), 'estimate']];
      for (const [position, trajectory, kind] of sources) {
        if ((kind === 'world' && poseSource === 'estimate') || (kind === 'estimate' && poseSource === 'world')) continue;
        if (trajectory.length) svg.append(svgNode('polyline', { points: trajectory.map(sample => map(sample.positionEnu).join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': kind === 'world' ? 2 : 1.25, 'stroke-dasharray': kind === 'estimate' ? '4 4' : '', opacity: kind === 'world' ? .9 : .55, 'data-shared-world-trail': `${vehicle.id}-${kind}` }));
        if (!position) continue;
        const [x, y] = map(position), ghost = kind === 'estimate' && poseSource === 'both';
        const angle = kind === 'world' ? 90 - quaternionHeading(vehicle.worldOrientationXyzw) * 180 / Math.PI : (vehicle.attitude?.yaw ?? 0) * 180 / Math.PI;
        const group = svgNode('g', { transform: `translate(${x} ${y}) rotate(${angle})`, 'data-shared-world-svg-vehicle': vehicle.id, 'data-pose': kind, 'data-position': JSON.stringify(position), opacity: ghost ? .65 : 1 });
        if (vehicle.id === selected && !ghost) group.append(svgNode('circle', { r: 21, fill: 'none', stroke: color, 'stroke-width': 1 }));
        group.append(svgNode('path', { d: 'M-11 -11L11 11M11 -11L-11 11', stroke: color, 'stroke-width': ghost ? 1.5 : 3, 'stroke-dasharray': kind === 'estimate' ? '3 2' : '' }));
        for (const [a, b] of [[-11, -11], [11, -11], [11, 11], [-11, 11]]) group.append(svgNode('circle', { cx: a, cy: b, r: 5, fill: ghost ? 'none' : '#15372a', stroke: color, 'stroke-width': 1.5 }));
        group.append(svgNode('rect', { x: -5, y: -7, width: 10, height: 14, rx: 3, fill: ghost ? 'none' : color, stroke: color }), svgNode('path', { d: 'M0 -12L-3 -7L3 -7Z', fill: color })); svg.append(group);
        const ex = 626 + ['A1', 'A2', 'A3'].indexOf(vehicle.id) * 81, ey = elevation(position[2]);
        const side = svgNode('g', { transform: `translate(${ex} ${ey})`, 'data-shared-world-svg-elevation': vehicle.id, 'data-pose': kind, 'data-position': JSON.stringify(position), opacity: ghost ? .65 : 1 });
        side.append(svgNode('path', { d: 'M-24 0H24M-10 3L-16 13H16L10 3', fill: 'none', stroke: color, 'stroke-width': ghost ? 1 : 2.5, 'stroke-dasharray': kind === 'estimate' ? '3 2' : '' }), svgNode('rect', { x: -10, y: -7, width: 20, height: 11, rx: 3, fill: ghost ? 'none' : color, stroke: color }));
        for (const dx of [-24, 24]) side.append(svgNode('ellipse', { cx: dx, cy: -3, rx: 11, ry: 2, fill: ghost ? 'none' : '#15352a', stroke: color })); svg.append(side);
      }
      const point = primaryPoint(vehicle);
      svg.append(svgNode('text', { x: 626 + ['A1', 'A2', 'A3'].indexOf(vehicle.id) * 81, y: 420, fill: color, 'font-size': 10, 'text-anchor': 'middle' }, `${vehicle.id} · ${point ? `${point[2].toFixed(2)} m` : 'waiting'}`));
    }
    svg.append(svgNode('text', { x: 26, y: 465, fill: '#c4d7c2', 'font-size': 11 }, 'SOLID: WORLD POSE · DASHED: BASELINE-ALIGNED ESTIMATE · ONE HOST-TIME CURSOR'), svgNode('text', { x: 26, y: 488, fill: '#b4c7ad', 'font-size': 10 }, 'World poses are evaluator evidence. Building footprints match the simulated collision boxes.'));
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose(); const geometries = new Set(), materials = new Set();
    world.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d'; svg.removeAttribute('hidden'); layer.hidden = true; container.dataset.view = mode;
    onModeChange(mode, `${message} The same recorded poses, task ledger and world evidence remain available in 2D.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed || !run) return;
    loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'shared-world-webgl-message', textContent: 'Preparing the recorded Gazebo site…' })); let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
      renderer.domElement.setAttribute('aria-label', 'Three Iris quadrotors in the recorded Gazebo site. Solid bodies show world poses; wireframes show received estimates. Drag to orbit or use arrow keys to pan.'); renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); }); layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 250), controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 1.7; controls.maxDistance = 95; controls.maxPolarAngle = Math.PI / 2 - .015; controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xe1eee0, 0x344c38, 2.8));
      const sun = new THREE.DirectionalLight(0xffedcc, 3.5); sun.position.set(-9, 24, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, far: 65 }); sun.shadow.normalBias = .025; scene.add(sun);
      const fill = new THREE.DirectionalLight(0xa7cabb, 1); fill.position.set(10, 6, -14); scene.add(fill);
      const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
      const dark = mat(0x17362a), pale = mat(0xdadbc0), metal = mat(0x8d9f91, { metalness: .6, roughness: .4 });
      const mesh = (geometry, material, position, parent = scene) => { const object = new THREE.Mesh(geometry, material); object.position.set(...position); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object; };
      const box = (size, material, position, parent = scene) => mesh(new THREE.BoxGeometry(...size), material, position, parent);
      const cylinder = (radius, height, material, position, parent = scene) => mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material, position, parent);
      const beam = (from, to, radius, material, parent = scene) => { const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), delta = end.clone().sub(start); const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, start.clone().add(end).multiplyScalar(.5).toArray(), parent); object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object; };
      const line = (points, color, dashed = false, opacity = 1) => { const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .22, gapSize: .18, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }); const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point))), material); if (dashed) object.computeLineDistances(); scene.add(object); return object; };
      // Exact collision boxes from the recorded world manifest. Grid, H marks
      // and task rings are display guides, not additional physical obstacles.
      const groundSize = Array.isArray(run.world.groundSizeM) ? run.world.groundSizeM : [run.world.groundSizeM, run.world.groundSizeM];
      box([groundSize[0], .24, groundSize[1]], mat(0x7b8b72), [0, -.125, 0]);
      const grid = new THREE.GridHelper(Math.min(...groundSize), Math.min(...groundSize) / 2, 0xbdc9a6, 0x9cae90); grid.position.y = .003; grid.material.transparent = true; grid.material.opacity = .4; scene.add(grid);
      for (const building of run.world.buildings) {
        const [east, north, up] = building.positionEnu, [width, depth, height] = building.size;
        const buildingMesh = box([width, height, depth], mat(0x536c5a), [east, up, -north]); buildingMesh.name = building.id;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(buildingMesh.geometry), new THREE.LineBasicMaterial({ color: 0xa3b598, transparent: true, opacity: .45 })); buildingMesh.add(edges);
        // Thin panels remain within the box's outer face; the obstacle extent
        // remains exactly the supplied box rather than a decorative shed.
        box([width * .86, .015, depth * .86], mat(0xa3aa8b), [east, up + height / 2 + .009, -north]);
      }
      function makeDrone(id, color) {
        const drone = new THREE.Group(); drone.name = `${id}-recorded-Iris-pose`; scene.add(drone);
        // Mesh axes: +X forward, +Y up, +Z right; Iris X-frame silhouette.
        const shellMaterial = mat(color, { metalness: .2, roughness: .4 });
        box([.36, .085, .27], dark, [0, 0, 0], drone);
        const shell = mesh(new THREE.SphereGeometry(1, 24, 16), shellMaterial, [0, .065, 0], drone); shell.scale.set(.23, .075, .145);
        box([.17, .045, .14], pale, [-.04, .12, 0], drone); box([.09, .025, .1], dark, [-.04, .151, 0], drone); cylinder(.039, .016, shellMaterial, [-.09, .17, 0], drone);
        beam([-.12, .06, .07], [-.16, .25, .075], .009, dark, drone); cylinder(.028, .034, dark, [-.16, .263, .075], drone);
        for (const x of [-.27, .27]) for (const z of [-.27, .27]) {
          beam([0, -.01, 0], [x, .005, z], .036, x > 0 ? shellMaterial : dark, drone); cylinder(.049, .075, metal, [x, .026, z], drone); cylinder(.026, .025, dark, [x, .076, z], drone);
          const prop = new THREE.Group(); prop.position.set(x, .096, z); prop.rotation.y = x * z > 0 ? .55 : -.45; drone.add(prop);
          const blade = mesh(new THREE.SphereGeometry(1, 18, 8), dark, [0, 0, 0], prop); blade.scale.set(.21, .009, .022);
          const ring = mesh(new THREE.RingGeometry(.203, .212, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .3, side: THREE.DoubleSide }), [x, .096, z], drone); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
          cylinder(.021, .02, mat(x > 0 ? 0xf2b177 : 0x7dceb0, { emissive: x > 0 ? 0x845020 : 0x356b4e, emissiveIntensity: .55 }), [x, -.04, z], drone);
        }
        for (const z of [-.18, .18]) { beam([-.12, -.02, z * .7], [-.2, -.22, z], .019, metal, drone); beam([.13, -.02, z * .7], [.23, -.22, z], .019, metal, drone); beam([-.27, -.22, z], [.29, -.22, z], .023, dark, drone); }
        const lens = cylinder(.034, .07, dark, [.218, -.045, 0], drone); lens.rotation.z = Math.PI / 2; return drone;
      }
      function makeGhost(id, color) {
        const ghost = new THREE.Group(); ghost.name = `${id}-received-estimate`; scene.add(ghost);
        const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55, depthTest: true, depthWrite: false });
        const geometry = new THREE.BoxGeometry(.36, .085, .27); ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material)); geometry.dispose();
        for (const x of [-.27, .27]) for (const z of [-.27, .27]) {
          ghost.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -.01, 0), new THREE.Vector3(x, .005, z)]), material));
          ghost.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, (_, i) => { const angle = i / 32 * Math.PI * 2; return new THREE.Vector3(x + .212 * Math.cos(angle), .096, z + .212 * Math.sin(angle)); })), material));
        }
        return ghost;
      }
      const vehicles = {}, taskObjects = {};
      for (const vehicle of run.vehicles) {
        const color = COLORS[vehicle.id], [east, north] = vehicle.padEnu;
        const pad = mesh(new THREE.RingGeometry(.8, .84, 64), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), [east, .009, -north]); pad.rotation.x = Math.PI / 2; pad.castShadow = false;
        for (const dx of [-.22, .22]) box([.08, .008, .62], mat(color), [east + dx, .011, -north]); box([.46, .008, .08], mat(color), [east, .011, -north]);
        vehicles[vehicle.id] = { drone: makeDrone(vehicle.id, color), ghost: makeGhost(vehicle.id, color), truthTrail: line([[0, 0, 0]], color, false, .9), estimateTrail: line([[0, 0, 0]], color, true, .48), vertical: line([[0, 0, 0]], color, true, .4), error: line([[0, 0, 0]], '#f2d0a6', true, .8), pathKey: '' };
      }
      for (const task of run.tasks) {
        const [east, north] = task.positionEnu, up = task.positionEnu[2] + run.world.spawnHeightM;
        const target = mesh(new THREE.OctahedronGeometry(.27), new THREE.MeshBasicMaterial({ color: 0xe4c28d, wireframe: true }), [east, up, -north]);
        const ring = mesh(new THREE.TorusGeometry(.5, .024, 8, 48), mat(0xd8ae74), [east, .014, -north]); ring.rotation.x = Math.PI / 2;
        line([[east, .02, -north], [east, up, -north]], '#d4b380', true, .4); taskObjects[task.id] = { target, ring };
      }
      const overlay = Object.assign(document.createElement('div'), { className: 'shared-world-labels' }), labels = {};
      for (const vehicle of run.vehicles) { const label = Object.assign(document.createElement('span'), { className: 'shared-world-scene-label' }); label.dataset.vehicle = vehicle.id; overlay.append(label); labels[vehicle.id] = label; }
      for (const task of run.tasks) { const label = Object.assign(document.createElement('span'), { className: 'shared-world-scene-label shared-world-memory', textContent: task.id }); overlay.append(label); labels[task.id] = label; } layer.append(overlay);
      const cameras = Object.assign(document.createElement('div'), { className: 'shared-world-camera' }); cameras.setAttribute('role', 'group'); cameras.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'shared-world-camera-yard', textContent: 'Whole site' }), closeButton = Object.assign(document.createElement('button'), { id: 'shared-world-camera-close', textContent: 'Follow A1' }); cameras.append(yardButton, closeButton); layer.append(cameras);
      layer.append(Object.assign(document.createElement('span'), { className: 'shared-world-scene-caption' }));
      const waiting = Object.assign(document.createElement('div'), { className: 'shared-world-position-wait', textContent: 'Waiting for recorded world poses' }); layer.append(waiting);
      const enuToScene = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1), modelToFlu = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
      const nedToScene = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 1), modelToFrd = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
      world = { THREE, renderer, scene, camera, controls, vehicles, taskObjects, labels, waiting, yardButton, closeButton, enuToScene, modelToFlu, nedToScene, modelToFrd };
      controls.addEventListener('change', drawThree); yardButton.addEventListener('click', () => frameCamera('yard')); closeButton.addEventListener('click', () => frameCamera('vehicle')); resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; WebGL 2 is required.'); }
    finally { loading = false; }
  }
  function setLine(object, points) { object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints((points.length ? points : [[0, 0, 0]]).map(point => new world.THREE.Vector3(...point))); if (object.material.isLineDashedMaterial) object.computeLineDistances(); }
  function setPose(object, position, vehicle, kind) {
    object.visible = Boolean(position); if (!position) return;
    const { THREE } = world; object.position.set(...scenePoint(position));
    if (kind === 'world') {
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...(vehicle.worldOrientationXyzw ?? [0, 0, 0, 1])));
      object.quaternion.setFromRotationMatrix(world.enuToScene.clone().multiply(rotation).multiply(world.modelToFlu));
    } else {
      const attitude = vehicle.attitude ?? { roll: 0, pitch: 0, yaw: 0 }, rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(attitude.roll, attitude.pitch, attitude.yaw, 'ZYX'));
      object.quaternion.setFromRotationMatrix(world.nedToScene.clone().multiply(rotation).multiply(world.modelToFrd));
    }
  }
  function updateThree() {
    if (!world || !frame || disposed || failed) return;
    for (const vehicle of frame.vehicles) {
      const object = world.vehicles[vehicle.id], primary = primaryPoint(vehicle);
      setPose(object.drone, primary, vehicle, poseSource === 'estimate' ? 'estimate' : 'world');
      setPose(object.ghost, poseSource === 'both' ? estimatePoint(vehicle) : null, vehicle, 'estimate');
      object.truthTrail.visible = poseSource !== 'estimate'; object.estimateTrail.visible = poseSource !== 'world'; object.vertical.visible = Boolean(primary);
      object.error.visible = Boolean(poseSource === 'both' && vehicle.worldPositionEnu && estimatePoint(vehicle));
      if (primary) { const point = scenePoint(primary); setLine(object.vertical, [[point[0], .02, point[2]], point]); if (cameraMode === 'vehicle' && vehicle.id === selected) { const follow = new world.THREE.Vector3(...point); world.camera.position.add(follow.clone().sub(world.controls.target)); world.controls.target.copy(follow); world.controls.update(); } }
      if (object.error.visible) setLine(object.error, [scenePoint(vehicle.worldPositionEnu), scenePoint(estimatePoint(vehicle))]);
      const truthTrajectory = vehicle.worldTrajectoryEnu ?? [], estimateTrajectory = alignedTrail(vehicle), key = `${run.runId}/${truthTrajectory.length}/${estimateTrajectory.length}`;
      if (object.pathKey !== key) { setLine(object.truthTrail, truthTrajectory.map(sample => scenePoint(sample.positionEnu))); setLine(object.estimateTrail, estimateTrajectory.map(sample => scenePoint(sample.positionEnu))); object.pathKey = key; }
      world.labels[vehicle.id].dataset.selected = String(vehicle.id === selected);
    }
    for (const task of frame.tasks) { const color = task.state === 'completed' ? '#a9e5c9' : task.state === 'locked' ? '#f1a481' : COLORS[task.ownerId] ?? '#e4c28d'; world.taskObjects[task.id].target.material.color.set(color); world.taskObjects[task.id].ring.material.color.set(color); world.labels[task.id].dataset.state = task.state; }
    world.waiting.hidden = frame.vehicles.some(vehicle => Boolean(primaryPoint(vehicle))); world.waiting.textContent = poseSource === 'estimate' ? 'Waiting for baseline-aligned estimates' : 'Waiting for recorded world poses';
    world.closeButton.textContent = `Follow ${selected}`; drawThree();
  }
  function frameCamera(next) {
    if (!world || !frame || disposed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.closeButton.setAttribute('aria-pressed', String(next === 'vehicle'));
    if (next === 'yard') { const factor = Math.max(1, 1.1 / world.camera.aspect); world.controls.target.set(0, 1.8, -7.5); world.camera.position.set(3 * factor, 25 * factor, 28 * factor); }
    else { const vehicle = frame.vehicles.find(item => item.id === selected), [x, y, z] = scenePoint(primaryPoint(vehicle) ?? vehicle.padEnu); world.controls.target.set(x, y, z); world.camera.position.set(x, y + 2.1, z + 3.8); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || !frame || disposed || failed) return;
    const width = container.clientWidth, height = container.clientHeight, compact = width < 580;
    const project = point => { if (!point) return null; const p = new world.THREE.Vector3(...scenePoint(point)).project(world.camera); return p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 ? null : { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }; };
    const caption = layer.querySelector('.shared-world-scene-caption');
    caption.textContent = poseSource === 'estimate' ? 'RECEIVED ESTIMATES · BASELINE-ALIGNED TO THE SHARED WORLD' : poseSource === 'world' ? 'RECORDED WORLD POSES · EVALUATOR ONLY' : compact ? 'SOLID: WORLD · WIREFRAME: ESTIMATE' : 'SOLID: GAZEBO WORLD · WIREFRAME: RECEIVED ESTIMATE · NO ERROR MAGNIFICATION';
    const cameras = layer.querySelector('.shared-world-camera'), topEdge = cameras.offsetTop + cameras.offsetHeight + 8, bottomEdge = caption.offsetTop - 8;
    const overlaps = (a, b) => a.left < b.left + b.w + 5 && a.left + a.w + 5 > b.left && a.top < b.top + b.h + 5 && a.top + a.h + 5 > b.top;
    const silhouettes = frame.vehicles.flatMap(vehicle => { const point = project(primaryPoint(vehicle)); if (!point) return []; const radius = cameraMode === 'vehicle' && vehicle.id === selected ? 55 : compact ? 11 : 18; return [{ left: point.x - radius, top: point.y - radius * .7, w: radius * 2, h: radius * 1.4 }]; });
    const vehicles = [...frame.vehicles].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
    const entries = [...vehicles.map(vehicle => ({ id: vehicle.id, point: primaryPoint(vehicle), vehicle: true, text: `${vehicle.id}${primaryPoint(vehicle) ? ` · ${primaryPoint(vehicle)[2].toFixed(2)} m` : ''}` })), ...frame.tasks.map(task => ({ id: task.id, point: task.positionWorldEnu, vehicle: false, text: `${task.id}${task.state === 'completed' ? ' ✓' : task.state === 'locked' ? ' ⊘' : !compact && task.ownerId ? ` · ${task.ownerId}` : ''}` }))];
    const occupied = [];
    for (const entry of entries) {
      const label = world.labels[entry.id], point = project(entry.point); label.textContent = entry.text;
      label.hidden = !point || (cameraMode === 'vehicle' && entry.vehicle && entry.id !== selected); if (label.hidden) continue;
      const w = label.offsetWidth, h = label.offsetHeight, gap = entry.vehicle ? cameraMode === 'vehicle' ? 54 : compact ? 20 : 27 : 16;
      const candidates = [[point.x - w / 2, point.y - gap - h], [point.x - w / 2, point.y + gap], [point.x + gap, point.y - h / 2], [point.x - gap - w, point.y - h / 2], [point.x - w / 2, point.y - gap - h - 30], [point.x - w / 2, point.y + gap + 30], [point.x + gap, point.y - gap - h], [point.x - gap - w, point.y - gap - h], [point.x + gap, point.y + gap], [point.x - gap - w, point.y + gap]].map(([left, top]) => ({ left: Math.max(6, Math.min(width - w - 6, left)), top, w, h }));
      const position = candidates.find(box => box.top >= topEdge && box.top + box.h <= bottomEdge && ![...occupied, ...silhouettes].some(other => overlaps(box, other)));
      label.hidden = !position; if (position) { label.style.left = `${position.left}px`; label.style.top = `${position.top}px`; occupied.push(position); }
    }
    world.renderer.render(world.scene, world.camera);
  }
  function resize() { if (!world || disposed) return; world.renderer.setSize(container.clientWidth, container.clientHeight, false); world.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); world.camera.updateProjectionMatrix(); if (cameraMode === 'yard') frameCamera('yard'); else drawThree(); }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, nextFrame, nextSelected = 'A1') {
      const changed = selected !== nextSelected, newGeometry = run && run !== nextRun && JSON.stringify(run.world) !== JSON.stringify(nextRun.world);
      run = nextRun; frame = nextFrame; selected = nextSelected;
      if (newGeometry) { disposeWorld(); layer.replaceChildren(); }
      Object.assign(container.dataset, { case: run.id, timeMs: String(frame.timeMs), selected, view: mode, poseSource, world: JSON.stringify(frame.world), vehicles: JSON.stringify(frame.vehicles.map(vehicle => ({ id: vehicle.id, positionEnu: vehicle.positionEnu, estimatePositionWorldEnu: vehicle.estimatePositionWorldEnu, worldPositionEnu: vehicle.worldPositionEnu, positionNed: vehicle.positionNed, attitude: vehicle.attitude, worldOrientationXyzw: vehicle.worldOrientationXyzw, mode: vehicle.mode, armed: vehicle.armed, taskId: vehicle.taskId, retiring: vehicle.taskState === 'locked' }))), tasks: JSON.stringify(frame.tasks), tasksCompleted: String(frame.tasksCompleted), landedVehicles: String(frame.landedVehicles) });
      drawSvg(); updateThree(); if (changed && cameraMode === 'vehicle') frameCamera('vehicle'); if (mode === '3d' && !world) prepareThree();
    },
    setPoseSource(next) { poseSource = next; container.dataset.poseSource = poseSource; drawSvg(); updateThree(); if (cameraMode === 'vehicle') frameCamera('vehicle'); },
    setMode(next) { if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this session.'); return; } mode = next; container.dataset.view = mode; svg.toggleAttribute('hidden', mode === '3d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') { if (world) { resize(); updateThree(); } else prepareThree(); } },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
