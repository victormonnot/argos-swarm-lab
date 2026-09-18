// Render only received telemetry. Each stream is held independently at the
// shared cursor; neither renderer integrates a vehicle model or interpolates.
const NS = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attrs = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
const enuFromSample = (sample, origin) => [sample.data.y - origin[1], sample.data.x - origin[0], origin[2] - sample.data.z];
const worldPoint = ([east, north, up]) => [east, up, -north];
const targetEnu = (run, frame) => frame.targetNed ? [frame.targetNed[1] - run.originNed[1], frame.targetNed[0] - run.originNed[0], run.originNed[2] - frame.targetNed[2]] : null;

export function createSitlView(container, { onModeChange = () => {} } = {}) {
  let recording, frame, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 480', class: 'sitl-svg', role: 'img', 'aria-label': 'Linked top-down East/North map and North/height side elevation of received autopilot estimates. The displayed path contains only position samples already received.' });
  const layer = Object.assign(document.createElement('div'), { className: 'sitl-three', hidden: true });
  container.append(svg, layer);
  function drawSvg() {
    if (!frame || disposed) return;
    svg.replaceChildren();
    const sx = east => 138 + east * 27, sy = north => 363 - north * 27, ex = north => 514 + north * 18, ey = up => 363 - up * 48;
    svg.append(svgNode('rect', { x: 18, y: 19, width: 432, height: 400, rx: 8, fill: '#223d34', stroke: '#657e66' }), svgNode('rect', { x: 468, y: 19, width: 294, height: 400, rx: 8, fill: '#1c362f', stroke: '#657e66' }));
    for (let n = -1; n <= 11; n++) svg.append(svgNode('line', { x1: 30, x2: 438, y1: sy(n), y2: sy(n), stroke: '#718571', opacity: n === 0 ? .6 : .22 }));
    for (let e = -3; e <= 10; e++) svg.append(svgNode('line', { x1: sx(e), x2: sx(e), y1: 55, y2: 401, stroke: '#718571', opacity: e === 0 ? .6 : .22 }));
    for (let h = 0; h <= 6; h++) { svg.append(svgNode('line', { x1: 493, x2: 746, y1: ey(h), y2: ey(h), stroke: '#738772', opacity: .3 }), svgNode('text', { x: 485, y: ey(h) + 4, 'text-anchor': 'end', fill: '#b9cdbb', 'font-size': 10 }, String(h))); }
    svg.append(svgNode('text', { x: 34, y: 43, fill: '#c8e2cf', 'font-size': 11 }, 'TOP VIEW · NORTH ↑ · EAST →'), svgNode('text', { x: 484, y: 43, fill: '#c8e2cf', 'font-size': 11 }, 'SIDE VIEW · HEIGHT / M'), svgNode('text', { x: 740, y: 401, 'text-anchor': 'end', fill: '#b9cdbb', 'font-size': 10 }, 'NORTH →'));
    const path = frame.trajectory.map(sample => enuFromSample(sample, recording.originNed));
    svg.append(svgNode('polyline', { points: path.map(([e, n]) => `${sx(e)},${sy(n)}`).join(' '), fill: 'none', stroke: '#afe0c3', 'stroke-width': 2.5, 'data-sitl-map-trail': '' }), svgNode('polyline', { points: path.map(([, n, h]) => `${ex(n)},${ey(h)}`).join(' '), fill: 'none', stroke: '#afe0c3', 'stroke-width': 2.5, 'data-sitl-elevation-trail': '' }));
    svg.append(svgNode('circle', { cx: sx(0), cy: sy(0), r: 16, fill: '#142e27', stroke: '#b3c5a8' }), svgNode('text', { x: sx(0), y: sy(0) + 4, 'text-anchor': 'middle', fill: '#c9d7bd', 'font-size': 12 }, 'H'));
    const target = targetEnu(recording, frame);
    if (target) {
      const [e, n, h] = target;
      svg.append(svgNode('circle', { cx: sx(e), cy: sy(n), r: 19, fill: 'none', stroke: '#edc08c', 'stroke-width': 2, 'stroke-dasharray': '4 4' }), svgNode('path', { d: `M${ex(n)} ${ey(h)-9}l9 9-9 9-9-9Z`, fill: '#d1a57022', stroke: '#edc08c' }));
    }
    if (frame.positionEnu) {
      const [e, n, h] = frame.positionEnu, heading = (frame.attitude?.yaw ?? 0) * 180 / Math.PI;
      const drone = svgNode('g', { transform: `translate(${sx(e)} ${sy(n)}) rotate(${heading})`, 'data-sitl-svg-position': '', 'data-position': JSON.stringify(frame.positionEnu) });
      drone.append(svgNode('path', { d: 'M0 -17L0 17M-17 0L17 0', stroke: '#0d241e', 'stroke-width': 6 }));
      for (const [x, y] of [[0, -17], [0, 17], [-17, 0], [17, 0]]) drone.append(svgNode('circle', { cx: x, cy: y, r: 7, fill: '#132d24', stroke: '#b9f0d4', 'stroke-width': 1.5 }));
      drone.append(svgNode('rect', { x: -5, y: -7, width: 10, height: 14, rx: 2, fill: '#a9dfc2' }));
      if (frame.attitude) drone.append(svgNode('path', { d: 'M0 -10L-4 -4L4 -4Z', fill: '#f6d69f' }));
      svg.append(drone, svgNode('line', { x1: ex(n), x2: ex(n), y1: ey(0), y2: ey(h), stroke: '#a8d7b9', 'stroke-dasharray': '4 4', opacity: .7 }), svgNode('rect', { x: ex(n)-12, y: ey(h)-4, width: 24, height: 8, rx: 3, fill: '#afe6c8', 'data-sitl-svg-height': String(h) }));
      svg.append(svgNode('text', { x: 615, y: 76, 'text-anchor': 'middle', fill: '#c9e9d2', 'font-size': 12 }, `local height ${h.toFixed(2)} m`));
    } else svg.append(svgNode('text', { x: 240, y: 225, 'text-anchor': 'middle', fill: '#c7dccb', 'font-size': 12 }, 'Waiting for position telemetry'));
    svg.append(svgNode('text', { x: 24, y: 444, fill: '#c0d6c4', 'font-size': 10 }, 'RECEIVED ESTIMATES · TOP GRID = 1 M · HEIGHT RELATIVE TO RECORDED LOCAL ORIGIN'));
    svg.append(svgNode('text', { x: 24, y: 462, fill: '#aebfac', 'font-size': 10 }, 'Amber = sent target. Takeoff marker approximates the above-home height in the local frame.'));
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose(); const geometries = new Set(), materials = new Set();
    world.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d'; svg.removeAttribute('hidden'); layer.hidden = true; container.dataset.view = '2d';
    onModeChange('2d', `${message} The same recorded cursor remains available in 2D with all command and telemetry inspectors.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'sitl-webgl-message', textContent: 'Preparing the flight yard…' })); let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
      renderer.domElement.setAttribute('aria-label', '3D flight yard showing recorded autopilot position and attitude estimates. Drag to orbit, scroll to zoom, focus and use arrow keys to pan.'); renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); }); layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 180), controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 2; controls.maxDistance = 65; controls.maxPolarAngle = Math.PI / 2 - .015; controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xe1eee0, 0x344c38, 2.8));
      const sun = new THREE.DirectionalLight(0xffedcc, 3.5); sun.position.set(-8, 17, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 50 }); sun.shadow.normalBias = .025; scene.add(sun);
      const fill = new THREE.DirectionalLight(0xa7cabb, 1); fill.position.set(9, 5, -12); scene.add(fill);
      const mat = (color, extras = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extras });
      const dark = mat(0x17362a), concrete = mat(0x87917a), pale = mat(0xdadbc0), metal = mat(0x8d9f91, { metalness: .6, roughness: .4 });
      const mesh = (geometry, material, p, parent = scene, name = '') => { const object = new THREE.Mesh(geometry, material); object.position.set(...p); object.castShadow = true; object.receiveShadow = true; object.name = name; parent.add(object); return object; };
      const box = (size, material, p, parent = scene, name = '') => mesh(new THREE.BoxGeometry(...size), material, p, parent, name);
      const cylinder = (r, h, material, p, parent = scene) => mesh(new THREE.CylinderGeometry(r, r, h, 24), material, p, parent);
      const beam = (a, b, radius, material, parent = scene) => { const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from); const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent); object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object; };
      const line = (points, color, dashed = false, opacity = 1) => { const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .2, gapSize: .15, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }); const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), material); if (dashed) object.computeLineDistances(); scene.add(object); return object; };
      // The deck and buildings are scale cues only, not SITL world geometry.
      box([16, .36, 17], dark, [2.5, -.54, -4.5], scene, 'illustrative-yard-base'); box([15.85, .08, 16.85], concrete, [2.5, -.32, -4.5]);
      const grid = mat(0x667e64); for (let x = -5; x <= 10; x++) box([.015, .006, 16.4], grid, [x, -.273, -4.5]); for (let z = -12; z <= 3; z++) box([15.5, .006, .015], grid, [2.5, -.273, z]);
      const pad = (x, z) => { cylinder(.95, .055, dark, [x, -.246, z]); const ring = mesh(new THREE.TorusGeometry(.74, .026, 8, 64), pale, [x, -.214, z]); ring.rotation.x = Math.PI / 2; for (const offset of [-.23, .23]) box([.075, .015, .65], pale, [x + offset, -.207, z]); box([.53, .015, .075], pale, [x, -.207, z]); };
      pad(0, 0);
      for (const [x, z] of [[-4.7, 3.4], [9.7, 3.4], [-4.7, -12.4], [9.7, -12.4]]) { cylinder(.085, .65, mat(0xd4af73), [x, .05, z]); cylinder(.09, .12, dark, [x, .13, z]); }
      const shed = new THREE.Group(); shed.position.set(-3.25, -.27, -9); scene.add(shed);
      box([2.3, 1.55, 3.6], mat(0x536d5b), [0, .775, 0], shed, 'illustrative-service-shed'); box([2.55, .13, 3.85], pale, [0, 1.61, 0], shed);
      box([.8, 1.25, .04], dark, [-.55, .64, 1.83], shed); box([.72, .46, .055], mat(0x83af9a, { metalness: .35 }), [.47, 1.0, 1.84], shed);
      box([1.2, .22, 1.4], metal, [0, 1.77, -.4], shed); for (let i = 0; i < 6; i++) box([.025, .02, 1.3], dark, [-.49 + i * .2, 1.89, -.4], shed);
      for (const [x, z] of [[8.4, 1.8], [9, .6]]) { box([.8, .6, .8], mat(0x9b8d6c), [x, .03, z]); for (const d of [-.3, .3]) box([.07, .65, .85], pale, [x + d, .035, z]); }
      // Height mast provides real metre spacing, without pretending to sense.
      cylinder(.045, 6.2, metal, [-1.8, 2.8, 1.2]); for (let h = 0; h <= 6; h++) box([.28, .035, .06], h % 2 ? pale : dark, [-1.8, h, 1.2]);
      line([[0, -.19, .5], [0, -.19, -2]], '#aec9b0'); line([[-.5, -.19, 0], [2, -.19, 0]], '#aec9b0');
      const drone = new THREE.Group(); drone.name = 'received-autopilot-pose'; scene.add(drone);
      // Model axes: +X nose/forward, +Y up, +Z right. Orientation below
      // converts this basis to FRD before applying recorded NED Euler angles.
      const shell = mat(0xa5dfc0, { metalness: .25, roughness: .35 });
      box([.57, .18, .37], shell, [0, 0, 0], drone); box([.32, .06, .29], pale, [-.03, .12, 0], drone); box([.31, .075, .28], dark, [-.07, -.115, 0], drone);
      const rotors = [];
      for (const [x, z] of [[-.56, 0], [.56, 0], [0, -.56], [0, .56]]) {
        beam([x * .25, 0, z * .3], [x, .025, z], .035, dark, drone); cylinder(.075, .115, metal, [x, .08, z], drone);
        const rotor = new THREE.Group(); rotor.position.set(x, .15, z); drone.add(rotor); rotors.push(rotor); box([.51, .012, .056], dark, [0, 0, 0], rotor); cylinder(.035, .03, pale, [0, .015, 0], rotor); rotor.rotation.y = x * z > 0 ? .35 : -.7;
        const ring = mesh(new THREE.RingGeometry(.23, .24, 32), new THREE.MeshBasicMaterial({ color: 0xc3e8ce, transparent: true, opacity: .25, side: THREE.DoubleSide }), [x, .15, z], drone); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
        cylinder(.026, .025, mat(x > 0 ? 0xe9be78 : 0x7ed3aa, { emissive: x > 0 ? 0x986e28 : 0x3b7a58, emissiveIntensity: .5 }), [x, -.012, z], drone);
      }
      for (const z of [-.23, .23]) { for (const x of [-.17, .17]) beam([x, -.08, z * .7], [x, -.25, z], .02, metal, drone); beam([-.32, -.25, z], [.32, -.25, z], .022, dark, drone); }
      mesh(new THREE.SphereGeometry(.075, 16, 12), metal, [.23, -.14, 0], drone); const lens = cylinder(.045, .09, dark, [.285, -.145, 0], drone); lens.rotation.z = Math.PI / 2; const glass = mesh(new THREE.CircleGeometry(.035, 20), mat(0x8dd7c1, { metalness: .4, roughness: .15 }), [.334, -.145, 0], drone); glass.rotation.y = Math.PI / 2;
      const target = new THREE.Group(); target.name = 'sent-position-target'; scene.add(target);
      const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xeac08b, wireframe: true }); mesh(new THREE.OctahedronGeometry(.29), targetMaterial, [0, 0, 0], target);
      const targetGround = mesh(new THREE.TorusGeometry(.55, .025, 8, 48), mat(0xd8ae74), [0, -.2, 0]); targetGround.rotation.x = Math.PI / 2;
      const trail = line([[0, 0, 0], [0, 0, 0]], '#b4f0cc'), vertical = line([[0, 0, 0], [0, 0, 0]], '#c5e5c5', true, .7), targetVertical = line([[0, 0, 0], [0, 0, 0]], '#deb47b', true, .65);
      const groundRing = mesh(new THREE.RingGeometry(.3, .34, 48), new THREE.MeshBasicMaterial({ color: 0xc1ebc9, side: THREE.DoubleSide, transparent: true, opacity: .7 }), [0, -.19, 0]); groundRing.rotation.x = Math.PI / 2; groundRing.castShadow = false;
      const overlay = Object.assign(document.createElement('div'), { className: 'sitl-labels' });
      const droneLabel = Object.assign(document.createElement('span'), { className: 'sitl-scene-label' }), targetLabel = Object.assign(document.createElement('span'), { className: 'sitl-scene-label sitl-memory' }); overlay.append(droneLabel, targetLabel); layer.append(overlay);
      const cameras = Object.assign(document.createElement('div'), { className: 'sitl-camera' }); cameras.setAttribute('role', 'group'); cameras.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'sitl-camera-yard', textContent: 'Whole yard' }), closeButton = Object.assign(document.createElement('button'), { id: 'sitl-camera-close', textContent: 'Follow vehicle' }); cameras.append(yardButton, closeButton); layer.append(cameras);
      const waiting = Object.assign(document.createElement('div'), { className: 'sitl-position-wait' }); layer.append(waiting);
      layer.append(Object.assign(document.createElement('span'), { className: 'sitl-scene-caption', textContent: 'RECORDED AUTOPILOT ESTIMATES · ILLUSTRATIVE YARD · ROTOR SHAPES DO NOT SHOW MEASURED RPM' }));
      // NED -> world [E, U, -N], then intrinsic FRD ZYX attitude,
      // then model [forward, up, right] -> FRD [x, z, -y].
      const nedToWorld = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 1);
      const modelToFrd = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
      world = { THREE, renderer, scene, camera, controls, drone, rotors, target, targetGround, trail, vertical, targetVertical, groundRing, droneLabel, targetLabel, waiting, yardButton, closeButton, nedToWorld, modelToFrd, pathCount: -1, pathRun: null };
      controls.addEventListener('change', drawThree); yardButton.addEventListener('click', () => frameCamera('yard')); closeButton.addEventListener('click', () => frameCamera('vehicle'));
      resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; WebGL 2 is required.'); }
    finally { loading = false; }
  }
  function setLine(object, points) {
    object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map(point => new world.THREE.Vector3(...point))); if (object.material.isLineDashedMaterial) object.computeLineDistances();
  }
  function updateThree() {
    if (!world || !frame || failed || disposed) return;
    const { THREE } = world, point = frame.positionEnu ? worldPoint(frame.positionEnu) : null, target = targetEnu(recording, frame);
    world.drone.visible = Boolean(point); world.groundRing.visible = Boolean(point); world.vertical.visible = Boolean(point); world.waiting.hidden = Boolean(point); world.waiting.textContent = 'Waiting for recorded position telemetry';
    if (point) {
      world.drone.position.set(...point); world.droneLabel.textContent = `Received estimate · local height ${frame.positionEnu[2].toFixed(2)} m${frame.attitude ? "" : " · attitude not received"}`;
      const attitude = frame.attitude ?? { roll: 0, pitch: 0, yaw: 0 };
      const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(attitude.roll, attitude.pitch, attitude.yaw, 'ZYX'));
      const modelRotation = world.nedToWorld.clone().multiply(rotation).multiply(world.modelToFrd); world.drone.quaternion.setFromRotationMatrix(modelRotation);
      world.drone.userData.attitudeAvailable = Boolean(frame.attitude);
      world.groundRing.position.set(point[0], -.19, point[2]); setLine(world.vertical, [[point[0], -.18, point[2]], point]);
      if (cameraMode === 'vehicle') { const follow = new THREE.Vector3(...point); world.camera.position.add(follow.clone().sub(world.controls.target)); world.controls.target.copy(follow); world.controls.update(); }
    }
    if (world.pathCount !== frame.trajectory.length || world.pathRun !== recording) { const path = frame.trajectory.map(sample => worldPoint(enuFromSample(sample, recording.originNed))); setLine(world.trail, path.length ? path : [[0, 0, 0]]); world.pathCount = path.length; world.pathRun = recording; }
    world.target.visible = Boolean(target); world.targetGround.visible = Boolean(target); world.targetVertical.visible = Boolean(target);
    if (target) { const p = worldPoint(target); world.target.position.set(...p); world.targetGround.position.set(p[0], -.2, p[2]); setLine(world.targetVertical, [[p[0], -.19, p[2]], p]); const waypointSent = frame.commands.some(command => command.id === 'waypoint'); world.targetLabel.textContent = waypointSent ? 'Last sent NED waypoint' : 'Takeoff height · local-frame approximation'; }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !frame || disposed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.closeButton.setAttribute('aria-pressed', String(next === 'vehicle'));
    if (next === 'yard') { const factor = Math.max(1, 1.2 / world.camera.aspect); world.controls.target.set(2.3, 1.5, -4.4); world.camera.position.set(2.3 + 13 * factor, 1.5 + 12.5 * factor, -4.4 + 17.5 * factor); }
    else { const [x, y, z] = frame.positionEnu ? worldPoint(frame.positionEnu) : [0, 0, 0]; world.controls.target.set(x, y, z); world.camera.position.set(x + 3.4, y + 2.7, z + 4.4); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || !frame || disposed || failed) return;
    const width = container.clientWidth, height = container.clientHeight, target = targetEnu(recording, frame), occupied = [];
    for (const [label, point, offset] of [[world.droneLabel, frame.positionEnu, -31], [world.targetLabel, target, 22]]) {
      if (!point) { label.hidden = true; continue; }
      const projected = new world.THREE.Vector3(...worldPoint(point)).project(world.camera); label.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1; if (label.hidden) continue;
      const w = label.offsetWidth, h = label.offsetHeight, left = Math.max(6, Math.min(width - w - 6, (projected.x + 1) * width / 2 - w / 2));
      let top = Math.max(46, Math.min(height - h - 29, (1 - projected.y) * height / 2 + offset - (offset < 0 ? h : 0)));
      for (const other of occupied) if (left < other.left + other.w + 6 && left + w + 6 > other.left && top < other.top + other.h + 6 && top + h + 6 > other.top) top = Math.min(height - h - 29, other.top + other.h + 7);
      label.style.left = `${left}px`; label.style.top = `${top}px`; occupied.push({ left, top, w, h });
    }
    world.renderer.render(world.scene, world.camera);
  }
  function resize() { if (!world || disposed) return; world.renderer.setSize(container.clientWidth, container.clientHeight, false); world.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); world.camera.updateProjectionMatrix(); drawThree(); }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRecording, nextFrame) { recording = nextRecording; frame = nextFrame; Object.assign(container.dataset, { case: recording.id, timeMs: String(frame.timeMs), positionNed: JSON.stringify(frame.positionNed), positionEnu: JSON.stringify(frame.positionEnu), attitude: JSON.stringify(frame.attitude), mode: String(frame.mode), armed: String(frame.armed), landedState: String(frame.landedState), view: mode }); drawSvg(); updateThree(); },
    setMode(next) { if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this session.'); return; } mode = next; container.dataset.view = mode; svg.toggleAttribute('hidden', mode === '3d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') { if (world) { resize(); updateThree(); } else prepareThree(); } },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
