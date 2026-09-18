// A display of recorded samples, with no local physics or pose interpolation.
const NS = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attributes = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
const worldPoint = ([east, north, up]) => [east, up, -north];
const heading = q => q ? Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] ** 2 + q[2] ** 2)) : 0;

export function createGazeboView(container, { onModeChange = () => {} } = {}) {
  let run, frame, world, mode = '2d', loading = false, failed = false, disposed = false, cameraMode = 'yard';
  let showEstimate = true, showTrails = true;
  const svg = svgNode('svg', { viewBox: '0 0 780 480', class: 'gazebo-svg', role: 'img', 'aria-label': 'Linked top and side views of Gazebo world pose and the received autopilot estimate. Poses and paths come from the same recorded cursor.' });
  const layer = Object.assign(document.createElement('div'), { className: 'gazebo-three', hidden: true }); container.append(svg, layer);
  function drawSvg() {
    if (!frame || disposed) return;
    svg.replaceChildren();
    const origin = run.originTruthEnu, sx = east => 230 + (east - origin[0]) * 37, sy = north => 234 - (north - origin[1]) * 37;
    const ex = east => 594 + (east - origin[0]) * 27, ey = up => 392 - up * 51;
    svg.append(svgNode('rect', { x: 18, y: 19, width: 432, height: 400, rx: 8, fill: '#223d34', stroke: '#657e66' }), svgNode('rect', { x: 468, y: 19, width: 294, height: 400, rx: 8, fill: '#1c362f', stroke: '#657e66' }));
    for (let i = -4; i <= 4; i++) {
      svg.append(svgNode('line', { x1: sx(origin[0] + i), x2: sx(origin[0] + i), y1: 65, y2: 393, stroke: '#7c9279', opacity: i ? .22 : .6 }), svgNode('line', { x1: 42, x2: 418, y1: sy(origin[1] + i), y2: sy(origin[1] + i), stroke: '#7c9279', opacity: i ? .22 : .6 }));
    }
    for (let z = 0; z <= 6; z++) svg.append(svgNode('line', { x1: 500, x2: 744, y1: ey(z), y2: ey(z), stroke: '#718871', opacity: .3 }), svgNode('text', { x: 492, y: ey(z) + 4, 'text-anchor': 'end', fill: '#bdcfb8', 'font-size': 10 }, String(z)));
    svg.append(svgNode('text', { x: 34, y: 44, fill: '#c8e2cf', 'font-size': 11 }, 'TOP VIEW · NORTH ↑ · EAST →'), svgNode('text', { x: 484, y: 44, fill: '#c8e2cf', 'font-size': 11 }, 'SIDE VIEW · WORLD HEIGHT / M'));
    if (showTrails) for (const [rows, color, dashed] of [[frame.truthTrajectory, '#ace4c4', false], [showEstimate ? frame.estimateTrajectory : [], '#e8bb79', true]]) {
      svg.append(svgNode('polyline', { points: rows.map(row => `${sx(row.positionEnu[0])},${sy(row.positionEnu[1])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dashed ? '4 3' : '', 'data-gazebo-trail': dashed ? 'estimate' : 'truth' }), svgNode('polyline', { points: rows.map(row => `${ex(row.positionEnu[0])},${ey(row.positionEnu[2])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dashed ? '4 3' : '' }));
    }
    if (frame.targetEnu) {
      const [e, n, z] = frame.targetEnu;
      svg.append(svgNode('circle', { cx: sx(e), cy: sy(n), r: 13, fill: 'none', stroke: '#d0dab6', 'stroke-dasharray': '4 4' }), svgNode('line', { x1: ex(e) - 27, x2: ex(e) + 27, y1: ey(z), y2: ey(z), stroke: '#d0dab6', 'stroke-dasharray': '4 4' }));
    }
    for (const [pose, type, color] of [[frame.truth, 'truth', '#b6f1d1'], [showEstimate ? frame.estimate : null, 'estimate', '#edbd7d']]) {
      if (!pose) continue;
      const [e, n, z] = pose.positionEnu;
      const group = svgNode('g', { transform: `translate(${sx(e)} ${sy(n)}) rotate(${90 - heading(pose.orientationXyzw) * 180 / Math.PI})`, 'data-gazebo-pose': type, 'data-position': JSON.stringify(pose.positionEnu) });
      group.append(svgNode('path', { d: 'M-13 -13L13 13M13 -13L-13 13', stroke: color, 'stroke-width': type === 'truth' ? 4 : 1.5 }));
      for (const [x, y] of [[-13, -13], [13, -13], [13, 13], [-13, 13]]) group.append(svgNode('circle', { cx: x, cy: y, r: 6, fill: type === 'truth' ? '#16362c' : 'none', stroke: color, 'stroke-width': 1.5 }));
      group.append(svgNode('rect', { x: -4, y: -7, width: 8, height: 14, rx: 2, fill: type === 'truth' ? color : 'none', stroke: color }), svgNode('path', { d: 'M0 -12L-3 -7L3 -7Z', fill: color }));
      svg.append(group, svgNode('rect', { x: ex(e) - 13, y: ey(z) - 4, width: 26, height: 8, rx: 3, fill: type === 'truth' ? color : 'none', stroke: color, 'data-gazebo-elevation': type }));
    }
    if (frame.truth && frame.forceEnu && Math.hypot(...frame.forceEnu) > 0) {
      const [e, n] = frame.truth.positionEnu, length = Math.hypot(frame.forceEnu[0], frame.forceEnu[1]);
      if (length > 0) {
        const dx = frame.forceEnu[0] / length * 66, dy = -frame.forceEnu[1] / length * 66, x = sx(e), y = sy(n);
        svg.append(svgNode('line', { x1: x, y1: y, x2: x + dx, y2: y + dy, stroke: '#f09b84', 'stroke-width': 4 }));
        const angle = Math.atan2(dy, dx), points = [[x + dx, y + dy], [x + dx - 12 * Math.cos(angle - .5), y + dy - 12 * Math.sin(angle - .5)], [x + dx - 12 * Math.cos(angle + .5), y + dy - 12 * Math.sin(angle + .5)]];
        svg.append(svgNode('polygon', { points: points.map(p => p.join(',')).join(' '), fill: '#f09b84' }));
      }
    }
    if (!frame.truth) svg.append(svgNode('text', { x: 230, y: 226, 'text-anchor': 'middle', fill: '#c7dccb', 'font-size': 12 }, 'Waiting for recorded world pose'));
    svg.append(svgNode('text', { x: 24, y: 443, fill: '#c0d6c4', 'font-size': 10 }, 'MINT = WORLD POSE · AMBER = ESTIMATE · TOP GRID = 1 M · NO ERROR MAGNIFICATION'), svgNode('text', { x: 24, y: 462, fill: '#aebfac', 'font-size': 10 }, 'Force arrow indicates direction; its drawn length is illustrative. Height guide approximates the takeoff target.'));
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose(); const geometries = new Set(), materials = new Set();
    world.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach(m => materials.add(m)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d'; svg.removeAttribute('hidden'); layer.hidden = true; container.dataset.view = '2d';
    onModeChange('2d', `${message} The same recorded cursor and all inspectors remain available in 2D.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'gazebo-webgl-message', textContent: 'Preparing the external-physics flight yard…' })); let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
      renderer.domElement.setAttribute('aria-label', '3D Iris quadrotor showing recorded Gazebo world pose and a wireframe autopilot estimate. Drag to orbit, scroll to zoom, or focus and use arrow keys to pan.'); renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); }); layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .1, 150), controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 1.7; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI / 2 - .02; controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xe6efe0, 0x344b39, 2.6));
      const sun = new THREE.DirectionalLight(0xffead0, 3.3); sun.position.set(-7, 15, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 40 }); sun.shadow.normalBias = .025; scene.add(sun);
      const fill = new THREE.DirectionalLight(0xa9d4cd, .9); fill.position.set(7, 6, -8); scene.add(fill);
      const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
      const dark = mat(0x1a3028), pale = mat(0xd9ddc8), metal = mat(0x738b7d, { metalness: .55, roughness: .35 }), orange = mat(0xcb885a), mint = mat(0x88c9b0);
      const mesh = (geometry, material, p, parent = scene) => { const item = new THREE.Mesh(geometry, material); item.position.set(...p); item.castShadow = true; item.receiveShadow = true; parent.add(item); return item; };
      const box = (size, material, p, parent = scene) => mesh(new THREE.BoxGeometry(...size), material, p, parent);
      const cylinder = (radius, height, material, p, parent = scene) => mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material, p, parent);
      const beam = (a, b, radius, material, parent = scene) => { const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from), item = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent); item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return item; };
      const line = (points, color, dashed = false) => { const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .13, gapSize: .1 }) : new THREE.LineBasicMaterial({ color }); const item = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), material); if (dashed) item.computeLineDistances(); scene.add(item); return item; };
      // Decorative geometry gives depth; only the recorded simulator defines physics.
      box([15, .28, 15], mat(0x708269), [0, -.36, 0]); box([12, .12, 12], mat(0x8c967a), [0, -.16, 0]);
      const grid = new THREE.GridHelper(12, 12, 0xc8d0b0, 0xa4ad8a); grid.position.y = -.093; grid.material.transparent = true; grid.material.opacity = .42; scene.add(grid);
      cylinder(1.05, .025, dark, [0, -.08, 0]); const pad = mesh(new THREE.RingGeometry(.8, .84, 64), new THREE.MeshBasicMaterial({ color: 0xccdbc0, side: THREE.DoubleSide }), [0, -.065, 0]); pad.rotation.x = Math.PI / 2;
      for (const x of [-.22, .22]) box([.08, .015, .62], pale, [x, -.054, 0]); box([.46, .015, .08], pale, [0, -.054, 0]);
      for (const x of [-5.4, 5.4]) for (const z of [-5.4, 5.4]) { cylinder(.09, 1.2, metal, [x, .5, z]); cylinder(.12, .08, orange, [x, 1.13, z]); box([.48, .1, .48], dark, [x, -.05, z]); }
      for (const x of [-5.4, 5.4]) beam([x, .55, -5.4], [x, .55, 5.4], .025, metal);
      beam([-5.4, .55, -5.4], [5.4, .55, -5.4], .025, metal);
      box([2.4, 1.1, 1.1], dark, [-5.7, .43, -3.5]); box([2.2, .09, 1.3], pale, [-5.7, 1.02, -3.5]);
      for (const x of [-6.3, -5.7, -5.1]) box([.37, .26, .06], mat(0xa3b992), [x, .58, -2.91]);
      for (let z = -4; z <= 4; z += 2) { box([.07, .025, .6], pale, [4.4, -.085, z]); box([.6, .025, .07], pale, [4.4, -.084, z]); }
      const drone = new THREE.Group(); drone.name = 'gazebo-iris-world-pose'; scene.add(drone);
      // Local mesh axes: forward +X, up +Y, right +Z. Iris-like X frame.
      box([.36, .085, .27], dark, [0, 0, 0], drone); const shell = mesh(new THREE.SphereGeometry(1, 24, 16), pale, [0, .065, 0], drone); shell.scale.set(.23, .075, .145);
      box([.17, .045, .14], mint, [-.04, .12, 0], drone); box([.09, .025, .1], dark, [-.04, .151, 0], drone); cylinder(.039, .016, orange, [-.09, .17, 0], drone);
      beam([-.12, .06, .07], [-.16, .25, .075], .009, dark, drone); cylinder(.028, .034, dark, [-.16, .263, .075], drone);
      for (const x of [-.27, .27]) for (const z of [-.27, .27]) {
        beam([0, -.01, 0], [x, .005, z], .036, x > 0 ? orange : dark, drone); cylinder(.049, .075, metal, [x, .026, z], drone); cylinder(.026, .025, dark, [x, .076, z], drone);
        const prop = new THREE.Group(); prop.position.set(x, .096, z); prop.rotation.y = x * z > 0 ? .55 : -.45; drone.add(prop); const blade = mesh(new THREE.SphereGeometry(1, 18, 8), dark, [0, 0, 0], prop); blade.scale.set(.21, .009, .022);
        const ring = mesh(new THREE.RingGeometry(.203, .212, 36), new THREE.MeshBasicMaterial({ color: 0xbde4c7, transparent: true, opacity: .32, side: THREE.DoubleSide }), [x, .096, z], drone); ring.rotation.x = Math.PI / 2;
        cylinder(.021, .02, mat(x > 0 ? 0xf2b177 : 0x7dceb0, { emissive: x > 0 ? 0x845020 : 0x356b4e, emissiveIntensity: .55 }), [x, -.04, z], drone);
      }
      for (const z of [-.18, .18]) { beam([-.12, -.02, z * .7], [-.2, -.22, z], .019, metal, drone); beam([.13, -.02, z * .7], [.23, -.22, z], .019, metal, drone); beam([-.27, -.22, z], [.29, -.22, z], .023, dark, drone); }
      const lens = cylinder(.034, .07, dark, [.218, -.045, 0], drone); lens.rotation.z = Math.PI / 2;
      // A sparse silhouette keeps the physical drone legible when poses overlap.
      // Its dimensions, position and rotation are unchanged; no display offset.
      const ghost = new THREE.Group(); ghost.name = 'autopilot-estimated-pose'; scene.add(ghost);
      const ghostMaterial = new THREE.LineBasicMaterial({ color: 0xf0bf77, transparent: true, opacity: .42, depthTest: true, depthWrite: false });
      const bodyGeometry = new THREE.BoxGeometry(.36, .085, .27);
      ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), ghostMaterial)); bodyGeometry.dispose();
      for (const x of [-.27, .27]) for (const z of [-.27, .27]) {
        ghost.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -.01, 0), new THREE.Vector3(x, .005, z)]), ghostMaterial));
        const ringPoints = Array.from({ length: 32 }, (_, index) => { const angle = index / 32 * Math.PI * 2; return new THREE.Vector3(x + .212 * Math.cos(angle), .096, z + .212 * Math.sin(angle)); });
        ghost.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints), ghostMaterial));
      }
      const target = mesh(new THREE.TorusGeometry(.36, .018, 8, 48), new THREE.MeshBasicMaterial({ color: 0xe0d5a4, transparent: true, opacity: .75 }), [0, 4, 0]); target.rotation.x = Math.PI / 2;
      const truthTrail = line([[0, 0, 0]], '#a8e3c1'), estimateTrail = line([[0, 0, 0]], '#e3b376', true), separation = line([[0, 0, 0]], '#f6d49f', true), vertical = line([[0, 0, 0]], '#a5c6ab', true);
      const force = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.5, 0xef9b83, .3, .18); scene.add(force);
      const overlay = Object.assign(document.createElement('div'), { className: 'gazebo-labels' }), truthLabel = Object.assign(document.createElement('span'), { className: 'gazebo-scene-label' }), estimateLabel = Object.assign(document.createElement('span'), { className: 'gazebo-scene-label gazebo-estimate' }), forceLabel = Object.assign(document.createElement('span'), { className: 'gazebo-scene-label gazebo-force' }); overlay.append(truthLabel, estimateLabel, forceLabel); layer.append(overlay);
      const cameras = Object.assign(document.createElement('div'), { className: 'gazebo-camera' }); cameras.setAttribute('role', 'group'); cameras.setAttribute('aria-label', '3D camera framing'); const yardButton = Object.assign(document.createElement('button'), { id: 'gazebo-camera-yard', textContent: 'Whole yard' }), closeButton = Object.assign(document.createElement('button'), { id: 'gazebo-camera-close', textContent: 'Follow vehicle' }); cameras.append(yardButton, closeButton); layer.append(cameras);
      layer.append(Object.assign(document.createElement('span'), { className: 'gazebo-scene-caption', textContent: 'RECORDED POSES · ILLUSTRATIVE YARD AND ROTORS · FORCE ARROW SHOWS DIRECTION' }));
      const waiting = Object.assign(document.createElement('div'), { className: 'gazebo-position-wait', textContent: 'Waiting for recorded Gazebo world pose' }); layer.append(waiting);
      const enuToScene = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
      const modelToFlu = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
      world = { THREE, renderer, scene, camera, controls, drone, ghost, target, truthTrail, estimateTrail, separation, vertical, force, truthLabel, estimateLabel, forceLabel, waiting, yardButton, closeButton, enuToScene, modelToFlu, pathKey: '' };
      controls.addEventListener('change', drawThree); yardButton.addEventListener('click', () => frameCamera('yard')); closeButton.addEventListener('click', () => frameCamera('vehicle')); resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; WebGL 2 is required.'); }
    finally { loading = false; }
  }
  function setLine(item, points) { item.geometry.dispose(); item.geometry = new world.THREE.BufferGeometry().setFromPoints((points.length ? points : [[0, 0, 0]]).map(p => new world.THREE.Vector3(...p))); if (item.material.isLineDashedMaterial) item.computeLineDistances(); }
  function poseObject(item, pose) {
    item.visible = Boolean(pose); if (!pose) return;
    item.position.set(...worldPoint(pose.positionEnu));
    const rotation = new world.THREE.Matrix4().makeRotationFromQuaternion(new world.THREE.Quaternion(...(pose.orientationXyzw ?? [0, 0, 0, 1])));
    item.quaternion.setFromRotationMatrix(world.enuToScene.clone().multiply(rotation).multiply(world.modelToFlu));
  }
  function updateThree() {
    if (!world || !frame || disposed || failed) return;
    poseObject(world.drone, frame.truth); poseObject(world.ghost, showEstimate ? frame.estimate : null);
    world.waiting.hidden = Boolean(frame.truth); world.truthLabel.textContent = 'Gazebo world pose'; world.estimateLabel.textContent = 'Autopilot estimate';
    const point = frame.truth ? worldPoint(frame.truth.positionEnu) : null;
    if (point) { setLine(world.vertical, [[point[0], -.05, point[2]], point]); if (cameraMode === 'vehicle') { const follow = new world.THREE.Vector3(...point); world.camera.position.add(follow.clone().sub(world.controls.target)); world.controls.target.copy(follow); world.controls.update(); } }
    world.vertical.visible = Boolean(point); world.separation.visible = Boolean(frame.truth && frame.estimate && showEstimate);
    if (world.separation.visible) setLine(world.separation, [point, worldPoint(frame.estimate.positionEnu)]);
    world.target.visible = Boolean(frame.targetEnu); if (frame.targetEnu) world.target.position.set(...worldPoint(frame.targetEnu));
    const key = `${run.runId}/${frame.truthTrajectory.length}/${frame.estimateTrajectory.length}`;
    if (world.pathKey !== key) { setLine(world.truthTrail, frame.truthTrajectory.map(row => worldPoint(row.positionEnu))); setLine(world.estimateTrail, frame.estimateTrajectory.map(row => worldPoint(row.positionEnu))); world.pathKey = key; }
    world.truthTrail.visible = showTrails; world.estimateTrail.visible = showTrails && showEstimate;
    const magnitude = frame.forceEnu ? Math.hypot(...frame.forceEnu) : 0; world.force.visible = Boolean(point && magnitude > 0);
    if (world.force.visible) { world.force.position.set(...point); world.force.setDirection(new world.THREE.Vector3(...worldPoint(frame.forceEnu)).normalize()); world.force.setLength(1.55, .3, .18); world.forceLabel.textContent = `Applied force · ${magnitude.toFixed(1)} N`; }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !frame || disposed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.closeButton.setAttribute('aria-pressed', String(next === 'vehicle'));
    const origin = worldPoint(run.originTruthEnu);
    if (next === 'yard') { const factor = Math.max(1, 1.15 / world.camera.aspect); world.controls.target.set(origin[0], 2.1, origin[2]); world.camera.position.set(origin[0] + 10 * factor, 9 * factor, origin[2] + 12 * factor); }
    else { const point = frame.truth ? worldPoint(frame.truth.positionEnu) : origin; world.controls.target.set(...point); world.camera.position.set(point[0] + 2.1, point[1] + 1.45, point[2] + 2.9); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || !frame || disposed || failed) return;
    const width = container.clientWidth, height = container.clientHeight, occupied = [];
    for (const [label, pose, offset] of [[world.truthLabel, frame.truth, -32], [world.estimateLabel, showEstimate ? frame.estimate : null, 22], [world.forceLabel, world.force.visible ? frame.truth : null, 53]]) {
      if (!pose) { label.hidden = true; continue; }
      const projected = new world.THREE.Vector3(...worldPoint(pose.positionEnu)).project(world.camera); label.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1; if (label.hidden) continue;
      const w = label.offsetWidth, h = label.offsetHeight, left = Math.max(6, Math.min(width - w - 6, (projected.x + 1) * width / 2 - w / 2)); let top = Math.max(47, Math.min(height - h - 28, (1 - projected.y) * height / 2 + offset - (offset < 0 ? h : 0)));
      for (const other of occupied) if (left < other.left + other.w + 5 && left + w + 5 > other.left && top < other.top + other.h + 5 && top + h + 5 > other.top) top = Math.min(height - h - 28, other.top + other.h + 6);
      label.style.left = `${left}px`; label.style.top = `${top}px`; occupied.push({ left, top, w, h });
    }
    world.renderer.render(world.scene, world.camera);
  }
  function resize() { if (!world || disposed) return; world.renderer.setSize(container.clientWidth, container.clientHeight, false); world.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); world.camera.updateProjectionMatrix(); drawThree(); }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, nextFrame) { run = nextRun; frame = nextFrame; Object.assign(container.dataset, { case: run.id, timeMs: String(frame.timeMs), truthPosition: JSON.stringify(frame.truth?.positionEnu ?? null), estimatePosition: JSON.stringify(frame.estimate?.positionEnu ?? null), forceEnu: JSON.stringify(frame.forceEnu), pulsePhase: frame.pulsePhase, view: mode }); drawSvg(); updateThree(); },
    setOptions(options) { showEstimate = options.showEstimate ?? showEstimate; showTrails = options.showTrails ?? showTrails; container.dataset.showEstimate = String(showEstimate); container.dataset.showTrails = String(showTrails); drawSvg(); updateThree(); },
    setMode(next) { if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this session.'); return; } mode = next; container.dataset.view = mode; svg.toggleAttribute('hidden', mode === '3d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') { if (world) { resize(); updateThree(); } else prepareThree(); } },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
