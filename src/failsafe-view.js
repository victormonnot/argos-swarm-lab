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

export function createFailsafeView(container, { onModeChange = () => {} } = {}) {
  let recording, frame, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 480', class: 'failsafe-svg', role: 'img', 'aria-label': 'Directional GCS heartbeat and vehicle telemetry diagram beside the received flight height. Both views observe the same recorded cursor.' });
  const layer = Object.assign(document.createElement('div'), { className: 'failsafe-three', hidden: true });
  container.append(svg, layer);
  function drawSvg() {
    if (!frame || disposed) return;
    svg.replaceChildren();
    const heightY = up => 374 - up * 49, x = 605, station = [165, 300];
    svg.append(svgNode('rect', { x: 18, y: 18, width: 744, height: 403, rx: 8, fill: '#223d34', stroke: '#657e66' }));
    for (let h = 0; h <= 6; h++) svg.append(svgNode('line', { x1: 449, x2: 738, y1: heightY(h), y2: heightY(h), stroke: '#738772', opacity: .3 }), svgNode('text', { x: 438, y: heightY(h)+4, 'text-anchor': 'end', fill: '#c3d4bc', 'font-size': 11 }, `${h} m`));
    svg.append(svgNode('text', { x: 34, y: 44, fill: '#c8e2cf', 'font-size': 12 }, 'DIRECTIONAL MESSAGE DIAGRAM'), svgNode('text', { x: 470, y: 44, fill: '#c8e2cf', 'font-size': 11 }, 'RECEIVED LOCAL HEIGHT'));
    svg.append(svgNode('rect', { x: 115, y: 264, width: 100, height: 71, rx: 6, fill: '#102921', stroke: '#c9d9bd', 'stroke-width': 2 }), svgNode('rect', { x: 126, y: 275, width: 77, height: 43, rx: 2, fill: frame.gcs.enabled ? '#385c40' : '#613d2d' }), svgNode('path', { d: 'M165 336v27M133 365h64M211 292h21V213', fill: 'none', stroke: '#a6baa3', 'stroke-width': 4 }), svgNode('circle', { cx: 232, cy: 208, r: 6, fill: '#d9b784' }));
    svg.append(svgNode('text', { x: 165, y: 301, 'text-anchor': 'middle', fill: '#e4ead8', 'font-size': 13 }, 'GCS 255:190'), svgNode('text', { x: 165, y: 393, 'text-anchor': 'middle', fill: '#c7d9be', 'font-size': 11 }, 'Illustrative ground station'));
    const target = targetEnu(recording, frame);
    if (target) svg.append(svgNode('line', { x1: 482, x2: 727, y1: heightY(target[2]), y2: heightY(target[2]), stroke: '#edc08c', 'stroke-dasharray': '5 5', opacity: .7 }));
    if (frame.positionEnu) {
      const y = heightY(frame.positionEnu[2]), txColor = frame.gcs.enabled ? '#edbd80' : '#e89577', rxColor = '#a9e2c5';
      const tx = svgNode('g', { 'data-failsafe-direction': 'gcs-to-vehicle', 'data-enabled': String(frame.gcs.enabled) });
      tx.append(svgNode('path', { d: `M218 275Q365 125 ${x-32} ${y-13}`, fill: 'none', stroke: txColor, 'stroke-width': 2, 'stroke-dasharray': frame.gcs.enabled ? '5 3' : '2 8' }), svgNode('text', { x: 292, y: 113, fill: txColor, 'font-size': 12 }, frame.gcs.enabled ? 'GCS heartbeat →' : 'GCS heartbeat suppressed ×'));
      const rx = svgNode('g', { 'data-failsafe-direction': 'vehicle-to-gcs' });
      rx.append(svgNode('path', { d: `M${x-30} ${y+15}Q365 335 220 316`, fill: 'none', stroke: rxColor, 'stroke-width': 2 }), svgNode('polygon', { points: '220,316 232,311 231,323', fill: rxColor }), svgNode('text', { x: 289, y: 343, fill: rxColor, 'font-size': 12 }, '← received vehicle telemetry'));
      svg.append(tx, rx);
      const drone = svgNode('g', { transform: `translate(${x} ${y})`, 'data-failsafe-svg-position': '', 'data-position': JSON.stringify(frame.positionEnu) });
      drone.append(svgNode('path', { d: 'M-36 0H36M-15 5L-24 17H24L15 5', fill: 'none', stroke: '#b8e5c4', 'stroke-width': 4 }), svgNode('rect', { x: -16, y: -8, width: 32, height: 15, rx: 4, fill: '#a9dfc2' }));
      for (const rotorX of [-36, 36]) drone.append(svgNode('ellipse', { cx: rotorX, cy: -5, rx: 19, ry: 4, fill: '#15352a', stroke: '#a9dfc2', 'stroke-width': 2 }));
      svg.append(drone, svgNode('text', { x: 605, y: 74, 'text-anchor': 'middle', fill: '#d8ebd5', 'font-size': 12 }, `${frame.mode ?? 'Unknown mode'} · ${frame.positionEnu[2].toFixed(2)} m`));
    } else svg.append(svgNode('text', { x: 595, y: 240, 'text-anchor': 'middle', fill: '#c7dccb', 'font-size': 12 }, 'Waiting for pose telemetry'));
    svg.append(svgNode('text', { x: 26, y: 443, fill: '#c4d7c2', 'font-size': 10 }, 'HEIGHT FROM RECORDED ESTIMATE · ARROWS SHOW LOGICAL MESSAGE DIRECTIONS, NOT RADIO RANGE'), svgNode('text', { x: 26, y: 462, fill: '#b4c7ad', 'font-size': 10 }, 'Amber line: previous takeoff height, approximated in the local frame. Sender age is not receiver age.'));
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
    loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'failsafe-webgl-message', textContent: 'Preparing the flight yard…' })); let pendingRenderer;
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
      const station = new THREE.Group(); station.position.set(-3.3, -.27, 1); station.name = 'illustrative-ground-control-station'; scene.add(station);
      box([1.35, .74, .8], dark, [0, .37, 0], station); box([1.47, .09, .92], metal, [0, .79, 0], station);
      const console = box([.83, .53, .075], dark, [0, 1.06, -.15], station); console.rotation.x = -.15;
      const txMaterial = mat(0xc99b62, { emissive: 0x9d6a34, emissiveIntensity: .5 });
      const rxMaterial = mat(0x7cd9b4, { emissive: 0x3a825f, emissiveIntensity: .6 });
      box([.69, .35, .03], mat(0x2a4e40), [0, 1.075, -.093], station); box([.76, .04, .36], pale, [0, .85, .13], station);
      for (let i = 0; i < 5; i++) box([.6, .008, .018], dark, [0, .875, .02 + i * .052], station);
      box([.17, .06, .024], txMaterial, [-.2, 1.16, -.068], station); box([.17, .06, .024], rxMaterial, [-.2, 1.02, -.068], station);
      for (const z of [-.23, .23]) box([.82, .08, .11], metal, [0, .055, z], station);
      cylinder(.035, 2.05, metal, [-.91, .83, -.08], station); cylinder(.06, .13, pale, [-.91, 1.9, -.08], station);
      for (const angle of [0, 2.1, 4.2]) beam([-.91, .35, -.08], [-.91 + Math.cos(angle) * .38, .025, -.08 + Math.sin(angle) * .38], .025, metal, station);
      const uplink = line([[0, 0, 0], [0, 0, 0]], '#edba7b', true, .85), downlink = line([[0, 0, 0], [0, 0, 0]], '#9cdbbf', false, .8);
      const txArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), .5, 0xedba7b, .18, .11), rxArrow = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(), .5, 0x9cdbbf, .18, .11); scene.add(txArrow, rxArrow);
      const target = new THREE.Group(); target.name = 'sent-position-target'; scene.add(target);
      const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xeac08b, wireframe: true }); mesh(new THREE.OctahedronGeometry(.29), targetMaterial, [0, 0, 0], target);
      const targetGround = mesh(new THREE.TorusGeometry(.55, .025, 8, 48), mat(0xd8ae74), [0, -.2, 0]); targetGround.rotation.x = Math.PI / 2;
      const trail = line([[0, 0, 0], [0, 0, 0]], '#b4f0cc'), vertical = line([[0, 0, 0], [0, 0, 0]], '#c5e5c5', true, .7), targetVertical = line([[0, 0, 0], [0, 0, 0]], '#deb47b', true, .65);
      const groundRing = mesh(new THREE.RingGeometry(.3, .34, 48), new THREE.MeshBasicMaterial({ color: 0xc1ebc9, side: THREE.DoubleSide, transparent: true, opacity: .7 }), [0, -.19, 0]); groundRing.rotation.x = Math.PI / 2; groundRing.castShadow = false;
      const overlay = Object.assign(document.createElement('div'), { className: 'failsafe-labels' });
      const droneLabel = Object.assign(document.createElement('span'), { className: 'failsafe-scene-label' }), targetLabel = Object.assign(document.createElement('span'), { className: 'failsafe-scene-label failsafe-memory' }); const stationLabel = Object.assign(document.createElement('span'), { className: 'failsafe-scene-label failsafe-station' }); overlay.append(droneLabel, targetLabel, stationLabel); layer.append(overlay);
      const cameras = Object.assign(document.createElement('div'), { className: 'failsafe-camera' }); cameras.setAttribute('role', 'group'); cameras.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'failsafe-camera-yard', textContent: 'Whole yard' }), closeButton = Object.assign(document.createElement('button'), { id: 'failsafe-camera-close', textContent: 'Follow vehicle' }); cameras.append(yardButton, closeButton); layer.append(cameras);
      const waiting = Object.assign(document.createElement('div'), { className: 'failsafe-position-wait' }); layer.append(waiting);
      layer.append(Object.assign(document.createElement('span'), { className: 'failsafe-scene-caption', textContent: 'RECORDED AUTOPILOT ESTIMATES · LOGICAL TCP MESSAGE PATHS · ILLUSTRATIVE GCS, YARD AND ROTORS' }));
      // NED -> world [E, U, -N], then intrinsic FRD ZYX attitude,
      // then model [forward, up, right] -> FRD [x, z, -y].
      const nedToWorld = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 1);
      const modelToFrd = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
      world = { THREE, renderer, scene, camera, controls, drone, rotors, stationLabel, txMaterial, rxMaterial, uplink, downlink, txArrow, rxArrow, target, targetGround, trail, vertical, targetVertical, groundRing, droneLabel, targetLabel, waiting, yardButton, closeButton, nedToWorld, modelToFrd, pathCount: -1, pathRun: null };
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
    if (target) { const p = worldPoint(target); world.target.position.set(...p); world.targetGround.position.set(p[0], -.2, p[2]); setLine(world.targetVertical, [[p[0], -.19, p[2]], p]); world.targetLabel.textContent = frame.mode === 'Land' ? 'Previous takeoff height · not the LAND target' : 'Takeoff height · local-frame approximation'; }
    const txColor = frame.gcs.enabled ? '#edba7b' : '#e28e70';
    const latestTelemetry = Object.values(frame.latest).filter(Boolean).sort((a, b) => b.timeMs - a.timeMs)[0];
    const recentRx = latestTelemetry && frame.timeMs - latestTelemetry.timeMs <= 500;
    world.stationLabel.textContent = `GCS 255:190 · heartbeat ${frame.gcs.enabled ? 'sending' : 'suppressed'}`;
    world.stationLabel.dataset.suppressed = String(!frame.gcs.enabled);
    world.txMaterial.color.set(txColor); world.txMaterial.emissive.set(txColor); world.rxMaterial.emissiveIntensity = recentRx ? .7 : .05;
    world.uplink.visible = world.downlink.visible = world.txArrow.visible = world.rxArrow.visible = Boolean(point);
    if (point) {
      const txStart = [-4.21, 1.69, .92], txEnd = [point[0], point[1] + .23, point[2]], rxStart = [point[0], point[1] - .15, point[2] + .15], rxEnd = [-3.3, .82, 1.15];
      setLine(world.uplink, [txStart, txEnd]); setLine(world.downlink, [rxStart, rxEnd]); world.uplink.material.color.set(txColor); world.uplink.material.dashSize = frame.gcs.enabled ? .2 : .07; world.uplink.material.gapSize = frame.gcs.enabled ? .15 : .3;
      for (const [arrow, from, to, color] of [[world.txArrow, txStart, txEnd, txColor], [world.rxArrow, rxStart, rxEnd, recentRx ? '#9cdbbf' : '#718978']]) { const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a).normalize(); arrow.position.copy(a.lerp(b, .58)); arrow.setDirection(direction); arrow.setColor(color); }
      world.txArrow.visible = frame.gcs.enabled;
    }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !frame || disposed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.closeButton.setAttribute('aria-pressed', String(next === 'vehicle'));
    if (next === 'yard') { const factor = Math.max(1, 1.2 / world.camera.aspect); world.controls.target.set(-1.1, 1.8, .1); world.camera.position.set(8 * factor - 1.1, 8.4 * factor, 11.5 * factor); }
    else { const [x, y, z] = frame.positionEnu ? worldPoint(frame.positionEnu) : [0, 0, 0]; world.controls.target.set(x, y, z); world.camera.position.set(x + 3.4, y + 2.7, z + 4.4); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || !frame || disposed || failed) return;
    const width = container.clientWidth, height = container.clientHeight, target = targetEnu(recording, frame), occupied = [];
    for (const [label, point, offset] of [[world.droneLabel, frame.positionEnu, -31], [world.targetLabel, target, 22], [world.stationLabel, [-3.3, -1, 1.2], -40]]) {
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
    update(nextRecording, nextFrame) { recording = nextRecording; frame = nextFrame; Object.assign(container.dataset, { case: recording.id, timeMs: String(frame.timeMs), positionNed: JSON.stringify(frame.positionNed), positionEnu: JSON.stringify(frame.positionEnu), attitude: JSON.stringify(frame.attitude), mode: String(frame.mode), armed: String(frame.armed), landedState: String(frame.landedState), gcsEnabled: String(frame.gcs.enabled), gcsAgeMs: String(frame.gcs.ageMs), failsafeActive: String(frame.failsafe.active), view: mode }); drawSvg(); updateThree(); },
    setMode(next) { if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this session.'); return; } mode = next; container.dataset.view = mode; svg.toggleAttribute('hidden', mode === '3d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') { if (world) { resize(); updateThree(); } else prepareThree(); } },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
