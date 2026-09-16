import { sourcePose } from './restart-trace.js';

// Both views consume one trace cursor. Only the evaluator reference is a
// continuous curve: a policy's retained position is an exact held sample.
const NS = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attributes = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text; return node;
};
export function createRestartView(container, { onModeChange = () => {} } = {}) {
  let recording, frame, selected, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 480', class: 'restart-svg', role: 'img', 'aria-label': 'Top-down synthetic trajectory. A solid drone shows evaluator reference; an amber ghost shows the selected policy’s last accepted position. Text labels give altitude.' });
  const layer = Object.assign(document.createElement('div'), { className: 'restart-three', hidden: true });
  container.append(svg, layer);
  const samples = (endMs, count = 130) => Array.from({ length: count + 1 }, (_, index) => sourcePose(endMs * index / count));
  function drawSvg() {
    if (!frame || disposed) return;
    const reader = frame.policies.find(item => item.id === selected), sx = x => 390 + x * 79, sy = y => 224 - y * 79;
    const line = (a, b, attributes = {}) => svgNode('line', { x1: sx(a[0]), y1: sy(a[1]), x2: sx(b[0]), y2: sy(b[1]), ...attributes });
    const polyline = (values, attributes = {}) => svgNode('polyline', { points: values.map(point => `${sx(point[0])},${sy(point[1])}`).join(' '), fill: 'none', ...attributes });
    svg.replaceChildren();
    const defs = svgNode('defs'), marker = svgNode('marker', { id: 'restart-difference-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgNode('path', { d: 'M0 0L10 5L0 10Z', fill: '#e9aaa0' })); defs.append(marker); svg.append(defs);
    svg.append(svgNode('rect', { x: 22, y: 12, width: 736, height: 424, rx: 11, fill: '#223d34', stroke: '#71836b' }));
    for (let x = -4; x <= 4; x++) svg.append(line([x, -2.55], [x, 2.55], { stroke: '#7a8d76', opacity: x === 0 ? .45 : .2, 'stroke-dasharray': x === 0 ? '5 5' : 'none' }));
    for (let y = -2; y <= 2; y++) svg.append(line([-4.5, y], [4.5, y], { stroke: '#7a8d76', opacity: y === 0 ? .45 : .2, 'stroke-dasharray': y === 0 ? '5 5' : 'none' }));
    svg.append(polyline(samples(recording.endMs), { stroke: '#769786', 'stroke-width': 2, 'stroke-dasharray': '5 6', opacity: .45 }));
    svg.append(polyline(samples(frame.timeMs), { stroke: '#93d4b4', 'stroke-width': 2.5, opacity: .85, 'data-restart-reference-trail': '' }));
    svg.append(svgNode('text', { x: 721, y: sy(0) - 9, fill: '#b9d0b9', 'font-size': 12 }, 'x →'), svgNode('text', { x: sx(0) + 8, y: 36, fill: '#b9d0b9', 'font-size': 12 }, 'y ↑'));
    if (reader.position) {
      svg.append(line(reader.position, frame.sourcePosition, { stroke: '#e9aaa0', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'marker-end': 'url(#restart-difference-arrow)', 'data-restart-difference': '' }));
      const [x, y, z] = reader.position, ghost = svgNode('g', { transform: `translate(${sx(x)} ${sy(y)})`, 'data-restart-svg-retained': '', 'data-position': JSON.stringify(reader.position) });
      ghost.append(svgNode('circle', { r: 27, fill: '#e6bd7710', stroke: '#ebc28c', 'stroke-width': 2, 'stroke-dasharray': '5 4' }), svgNode('path', { d: 'M-13 -11L13 11M-13 11L13 -11M0 -11L11 0L0 11L-11 0Z', fill: '#5c5038', stroke: '#ebc28c', 'stroke-width': 1.5 }));
      for (const [px, py] of [[-13, -11], [-13, 11], [13, -11], [13, 11]]) ghost.append(svgNode('circle', { cx: px, cy: py, r: 7, fill: 'none', stroke: '#ebc28c', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
      svg.append(ghost);
      const labelX = Math.max(165, Math.min(615, sx(x))), labelY = Math.min(417, sy(y) + 49);
      svg.append(svgNode('rect', { x: labelX - 157, y: labelY - 16, width: 314, height: 22, rx: 3, fill: '#3b3528ed' }), svgNode('text', { x: labelX, y: labelY, 'text-anchor': 'middle', fill: '#f4cea0', 'font-size': 11 }, `retained e${reader.lastAccepted.epoch} / #${reader.lastAccepted.seq} · z ${z.toFixed(2)} m · age ${reader.generationAgeMs.toFixed(0)} ms`));
    }
    const [x, y, z] = frame.sourcePosition, drone = svgNode('g', { transform: `translate(${sx(x)} ${sy(y)})`, 'data-restart-svg-source': '', 'data-position': JSON.stringify(frame.sourcePosition) });
    drone.append(svgNode('path', { d: 'M-13 -11L13 11M13 -11L-13 11', stroke: '#0e2520', 'stroke-width': 7 }));
    for (const [px, py] of [[-13, -11], [-13, 11], [13, -11], [13, 11]]) drone.append(svgNode('circle', { cx: px, cy: py, r: 7, fill: '#152e25', stroke: '#a9e5c9', 'stroke-width': 1.6 }));
    drone.append(svgNode('rect', { x: -8, y: -6, width: 16, height: 12, rx: 3, fill: '#a9e5c9' })); svg.append(drone);
    const labelX = Math.max(115, Math.min(665, sx(x))), labelY = Math.max(42, sy(y) - 38);
    svg.append(svgNode('rect', { x: labelX - 112, y: labelY - 16, width: 224, height: 22, rx: 3, fill: '#19382fee' }), svgNode('text', { x: labelX, y: labelY, 'text-anchor': 'middle', fill: '#c8edd7', 'font-size': 11 }, `evaluator reference · z ${z.toFixed(2)} m`));
    svg.append(svgNode('text', { x: 28, y: 462, fill: '#b7cdb9', 'font-size': 10 }, 'SYNTHETIC REFERENCE CONTINUES · GRID = 1 M · NO PHYSICAL CRASH'));
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose(); const geometries = new Set(), materials = new Set();
    world.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d';
    svg.removeAttribute('hidden'); layer.hidden = true; container.dataset.view = '2d';
    onModeChange('2d', `${message} The same recorded cursor is shown in 2D; all controls and callback inspectors remain available.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'restart-webgl-message', textContent: 'Preparing the process-observation yard…' }));
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.domElement.setAttribute('aria-label', '3D synthetic telemetry yard. Solid quadrotor: evaluator reference. Amber wireframe quadrotor: selected policy’s retained XYZ sample. Drag to orbit, scroll to zoom, focus and use arrow keys to pan.');
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 120);
      const controls = new OrbitControls(camera, renderer.domElement); controls.minDistance = 2; controls.maxDistance = 35; controls.maxPolarAngle = Math.PI / 2 - .03; controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xddecdc, 0x324a37, 2.7));
      const sun = new THREE.DirectionalLight(0xffedc9, 3.6); sun.position.set(-6, 12, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7; sun.shadow.camera.far = 35; sun.shadow.normalBias = .025; scene.add(sun);
      const fill = new THREE.DirectionalLight(0xa4cabb, 1.1); fill.position.set(5, 5, -6); scene.add(fill);
      const mat = (color, extras = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extras });
      const dark = mat(0x17342b), concrete = mat(0x7f8a72), metal = mat(0x929f91, { metalness: .5, roughness: .4 }), pale = mat(0xd6d9b9), amber = mat(0xdab47b);
      const mesh = (geometry, material, p, parent = scene, name = '') => { const object = new THREE.Mesh(geometry, material); object.position.set(...p); object.castShadow = true; object.receiveShadow = true; object.name = name; parent.add(object); return object; };
      const box = (dimensions, material, p, parent = scene, name = '') => mesh(new THREE.BoxGeometry(...dimensions), material, p, parent, name);
      const cylinder = (radius, height, material, p, parent = scene) => mesh(new THREE.CylinderGeometry(radius, radius, height, 20), material, p, parent);
      const beam = (a, b, radius, material, parent = scene) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
        const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent);
        object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object;
      };
      const line = (points, color, dashed = false, opacity = 1, parent = scene) => {
        const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .12, gapSize: .1, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), material); if (dashed) object.computeLineDistances(); parent.add(object); return object;
      };
      box([11, .34, 8.5], dark, [0, -.22, 0], scene, 'telemetry-yard-base'); box([10.85, .08, 8.35], concrete, [0, -.015, 0]);
      const grid = mat(0x657e66); for (let x = -5; x <= 5; x++) box([.013, .007, 8.1], grid, [x, .03, 0]); for (let z = -4; z <= 4; z++) box([10.6, .007, .013], grid, [0, .03, z]);
      for (const x of [-5.15, 5.15]) for (const z of [-3.9, 3.9]) { cylinder(.075, .48, amber, [x, .28, z]); cylinder(.08, .08, dark, [x, .37, z]); }
      // Scenery provides visual scale only. It contributes no sensor or radio data.
      const service = new THREE.Group(); service.position.set(-2.6, 0, -3.3); scene.add(service);
      box([3, 1.2, 1.2], mat(0x526b5d), [0, .6, 0], service, 'service-shed'); box([3.18, .12, 1.4], pale, [0, 1.26, 0], service);
      box([.7, .92, .055], dark, [-.83, .48, .625], service); for (const x of [.12, .88]) box([.57, .42, .06], mat(0x84b7a1, { metalness: .35, roughness: .3 }), [x, .8, .63], service);
      box([.9, .22, .65], metal, [.55, 1.43, 0], service); for (let i = 0; i < 5; i++) box([.03, .02, .55], dark, [.24 + i * .15, 1.55, 0], service);
      for (const [x, z, rotation] of [[4.2, -3.2, .12], [4.4, -2.1, -.16]]) { const crate = new THREE.Group(); crate.position.set(x, 0, z); crate.rotation.y = rotation; scene.add(crate); box([.7, .6, .7], mat(0x9a8b69), [0, .3, 0], crate); for (const offset of [-.27, .27]) box([.05, .62, .73], pale, [offset, .3, 0], crate); }
      cylinder(.69, .05, dark, [3, .07, 0]); const padRing = mesh(new THREE.TorusGeometry(.52, .02, 8, 48), pale, [3, .102, 0]); padRing.rotation.x = Math.PI / 2;
      for (const offset of [-.16, .16]) box([.055, .012, .4], pale, [3 + offset, .108, 0]); box([.35, .012, .055], pale, [3, .108, 0]);
      // A small process console complements the trajectory. Its lamps represent
      // recorded harness/observer states; they are not physical drone sensors.
      const consoleUnit = new THREE.Group(); consoleUnit.position.set(0, 0, 3.35); scene.add(consoleUnit);
      box([1.7, .8, .6], mat(0x455e53), [0, .4, 0], consoleUnit, 'observer-process-console');
      box([1.9, .09, .8], metal, [0, .84, 0], consoleUnit);
      const processScreen = mat(0x92d2ad, { emissive: 0x4c926d, emissiveIntensity: .6, roughness: .4 });
      box([.65, .36, .025], dark, [-.44, .51, .319], consoleUnit);
      box([.54, .24, .035], processScreen, [-.44, .51, .339], consoleUnit);
      const policyScreens = ['sequence', 'incarnation'].map((id, i) => {
        const material = mat(0x9baea0, { emissive: 0x445a4b, emissiveIntensity: .4 });
        box([.28, .11, .035], material, [.34 + i * .36, .55, .339], consoleUnit); return material;
      });
      for (const x of [.34, .7]) box([.22, .035, .04], pale, [x, .4, .344], consoleUnit);
      cylinder(.018, .95, metal, [.73, 1.31, -.09], consoleUnit); cylinder(.055, .07, pale, [.73, 1.81, -.09], consoleUnit);
      const drone = new THREE.Group(); drone.name = 'evaluator-reference-quadrotor'; scene.add(drone);
      const shell = mat(0x9edabb, { metalness: .22, roughness: .4 });
      box([.52, .18, .34], shell, [0, 0, 0], drone); box([.32, .055, .27], pale, [-.04, .12, 0], drone); box([.3, .075, .27], dark, [-.04, -.115, 0], drone);
      const rotors = [];
      for (const [x, z] of [[-.44, -.36], [-.44, .36], [.44, -.36], [.44, .36]]) {
        beam([x * .25, 0, z * .3], [x, .025, z], .035, dark, drone); cylinder(.075, .115, metal, [x, .08, z], drone);
        const rotor = new THREE.Group(); rotor.position.set(x, .15, z); drone.add(rotor); rotors.push(rotor);
        box([.5, .012, .052], dark, [0, 0, 0], rotor); cylinder(.035, .035, pale, [0, .015, 0], rotor);
        const ring = mesh(new THREE.RingGeometry(.22, .235, 32), new THREE.MeshBasicMaterial({ color: 0xb5e4c8, side: THREE.DoubleSide, transparent: true, opacity: .3 }), [x, .15, z], drone); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
        cylinder(.028, .025, mat(x > 0 ? 0xf1ce8b : 0x8ce0bf, { emissive: x > 0 ? 0xb78b38 : 0x478e6e, emissiveIntensity: .5 }), [x, -.005, z], drone);
      }
      for (const z of [-.22, .22]) { for (const x of [-.15, .15]) beam([x, -.05, z * .65], [x, -.24, z], .02, metal, drone); beam([-.29, -.24, z], [.29, -.24, z], .02, dark, drone); }
      mesh(new THREE.SphereGeometry(.075, 16, 12), metal, [.21, -.13, 0], drone); const lens = cylinder(.045, .09, dark, [.27, -.145, 0], drone); lens.rotation.z = Math.PI / 2;
      const glass = mesh(new THREE.CircleGeometry(.035, 20), mat(0x95dacc, { metalness: .5, roughness: .1 }), [.32, -.145, 0], drone); glass.rotation.y = Math.PI / 2;
      const ghost = new THREE.Group(); ghost.name = 'observer-retained-position-quadrotor'; scene.add(ghost);
      const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xf1c284, wireframe: true, transparent: true, opacity: .8 });
      box([.54, .22, .37], ghostMaterial, [0, 0, 0], ghost);
      line([[-.44, 0, -.36], [.44, 0, .36], [0, 0, 0], [.44, 0, -.36], [-.44, 0, .36]], '#f1c284', false, 1, ghost);
      for (const [x, z] of [[-.44, -.36], [-.44, .36], [.44, -.36], [.44, .36]]) line(Array.from({ length: 33 }, (_, i) => [x + .24 * Math.cos(i / 32 * Math.PI * 2), .1, z + .24 * Math.sin(i / 32 * Math.PI * 2)]), '#f1c284', true, 1, ghost);
      ghost.traverse(object => { object.castShadow = false; object.receiveShadow = false; });
      const reference = line([[0, 0, 0], [0, 0, 0]], '#a8cbb5', true, .3), trail = line([[0, 0, 0], [0, 0, 0]], '#b2edcd', false, .95);
      const vertical = line([[0, 0, 0], [0, 0, 0]], '#c9e6c7', true, .55), ghostVertical = line([[0, 0, 0], [0, 0, 0]], '#dfb578', true, .6);
      const difference = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xeeb6a1, .18, .11); scene.add(difference);
      const sourceRing = mesh(new THREE.RingGeometry(.32, .35, 48), new THREE.MeshBasicMaterial({ color: 0xc2efcf, side: THREE.DoubleSide, transparent: true, opacity: .65 }), [0, .05, 0]); sourceRing.rotation.x = Math.PI / 2; sourceRing.castShadow = false;
      const ghostRing = mesh(new THREE.RingGeometry(.32, .35, 48), new THREE.MeshBasicMaterial({ color: 0xf1c284, side: THREE.DoubleSide, transparent: true, opacity: .8 }), [0, .055, 0]); ghostRing.rotation.x = Math.PI / 2; ghostRing.castShadow = false;
      const overlay = Object.assign(document.createElement('div'), { className: 'restart-labels' });
      const processIndicator = Object.assign(document.createElement('div'), { className: 'restart-process-indicator' }); processIndicator.append(Object.assign(document.createElement('strong'), { textContent: 'HARNESS TRUTH / A1 PROCESS' }), Object.assign(document.createElement('span'), { textContent: 'Waiting…' })); layer.append(processIndicator);
      const sourceLabel = Object.assign(document.createElement('span'), { className: 'restart-scene-label' }), ghostLabel = Object.assign(document.createElement('span'), { className: 'restart-scene-label restart-memory' }); overlay.append(sourceLabel, ghostLabel); layer.append(overlay);
      const cameras = Object.assign(document.createElement('div'), { className: 'restart-camera' }); cameras.setAttribute('role', 'group'); cameras.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'restart-camera-yard', textContent: 'Whole yard' }), closeButton = Object.assign(document.createElement('button'), { id: 'restart-camera-close', textContent: 'Follow reference' }); cameras.append(yardButton, closeButton); layer.append(cameras);
      layer.append(Object.assign(document.createElement('span'), { className: 'restart-scene-caption', textContent: 'SYNTHETIC REFERENCE CONTINUES · SOFTWARE INTERRUPTION ≠ PHYSICAL CRASH' }));
      world = { THREE, renderer, scene, camera, controls, drone, rotors, ghost, reference, trail, vertical, ghostVertical, difference, sourceRing, ghostRing, sourceLabel, ghostLabel, processIndicator, processScreen, policyScreens, yardButton, closeButton, referenceRun: null };
      controls.addEventListener('change', drawThree); yardButton.addEventListener('click', () => frameCamera('yard')); closeButton.addEventListener('click', () => frameCamera('reference'));
      resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; WebGL 2 is required.'); }
    finally { loading = false; }
  }
  const worldPoint = ([x, y, z]) => [x, z, -y];
  function setLine(object, points) {
    object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map(point => new world.THREE.Vector3(...point)));
    if (object.material.isLineDashedMaterial) object.computeLineDistances();
  }
  function updateThree() {
    if (!world || !frame || failed || disposed) return;
    const reader = frame.policies.find(item => item.id === selected), { THREE } = world;
    if (world.referenceRun !== recording) { setLine(world.reference, samples(recording.endMs).map(worldPoint)); world.referenceRun = recording; }
    const point = worldPoint(frame.sourcePosition), t = frame.timeMs / 1000;
    const running = frame.process.status !== 'stopped';
    world.processIndicator.dataset.running = String(running);
    world.processIndicator.querySelector('span').textContent = `${frame.process.status} · e${frame.process.epoch} · PID ${frame.process.pid}`;
    const processColor = frame.process.status === 'stopped' ? 0xa46c57 : frame.process.status === 'silent' ? 0xd1ac6d : 0x92d2ad;
    world.processScreen.color.setHex(processColor); world.processScreen.emissive.setHex(processColor);
    world.policyScreens.forEach((material, index) => { const state = frame.policies[index].status, color = state === 'suspect' ? 0xda9a69 : state === 'live' ? 0x92d2ad : 0x85968b; material.color.setHex(color); material.emissive.setHex(color); });
    world.drone.position.set(...point); world.drone.rotation.y = Math.atan2(2 * Math.cos(t), -3 * Math.sin(t));
    world.rotors.forEach((rotor, i) => { rotor.rotation.y = t * 35 * (i % 2 ? 1 : -1) + i; });
    world.sourceRing.position.set(point[0], .055, point[2]);
    setLine(world.vertical, [[point[0], .065, point[2]], [point[0], Math.max(.08, point[1] - .28), point[2]]]);
    setLine(world.trail, samples(frame.timeMs).map(worldPoint));
    world.ghost.visible = Boolean(reader.position); world.ghostRing.visible = Boolean(reader.position); world.ghostVertical.visible = Boolean(reader.position);
    world.difference.visible = Boolean(reader.position && reader.positionError > .025); world.ghostLabel.hidden = !reader.position;
    if (reader.position) {
      const remembered = worldPoint(reader.position), rt = reader.lastAccepted.generatedMs / 1000;
      world.ghost.position.set(...remembered); world.ghost.rotation.y = Math.atan2(2 * Math.cos(rt), -3 * Math.sin(rt));
      world.ghostRing.position.set(remembered[0], .06, remembered[2]);
      setLine(world.ghostVertical, [[remembered[0], .065, remembered[2]], remembered]);
      const from = new THREE.Vector3(...remembered), delta = new THREE.Vector3(...point).sub(from), length = delta.length();
      if (length > .025) { world.difference.position.copy(from); world.difference.setDirection(delta.normalize()); world.difference.setLength(length, Math.min(.2, length * .3), Math.min(.13, length * .2)); }
      world.ghostLabel.textContent = `Held e${reader.lastAccepted.epoch} / #${reader.lastAccepted.seq} · ${reader.status === 'suspect' ? 'SUSPECT' : 'recent heartbeat'}`;
    }
    world.sourceLabel.textContent = `Evaluator reference · z ${frame.sourcePosition[2].toFixed(2)} m`;
    if (cameraMode === 'reference') {
      const target = new THREE.Vector3(...point); world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update();
    }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !frame || disposed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.closeButton.setAttribute('aria-pressed', String(next === 'reference'));
    if (next === 'yard') {
      const factor = Math.max(1, 1.2 / world.camera.aspect); world.controls.target.set(0, .6, -.2); world.camera.position.set(7.6 * factor, 7.6 * factor, 9.5 * factor);
    } else { const [x, y, z] = worldPoint(frame.sourcePosition); world.controls.target.set(x, y, z); world.camera.position.set(x + 3.5, y + 2.6, z + 4.5); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || !frame || disposed || failed) return;
    const width = container.clientWidth, height = container.clientHeight, reader = frame.policies.find(item => item.id === selected);
    const occupied = [];
    for (const [label, point, offset] of [[world.sourceLabel, frame.sourcePosition, -35], [world.ghostLabel, reader.position, 19]]) {
      if (!point) { label.hidden = true; continue; }
      const projected = new world.THREE.Vector3(...worldPoint(point)).project(world.camera);
      label.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1; if (label.hidden) continue;
      const w = label.offsetWidth, h = label.offsetHeight;
      const left = Math.max(6, Math.min(width - w - 6, (projected.x + 1) * width / 2 - w / 2));
      // Anchor an upper label by its bottom edge, including wrapped lines, so
      // the reference airframe remains visible in both yard and follow views.
      let top = Math.max(43, Math.min(height - h - 24, (1 - projected.y) * height / 2 + offset - (offset < 0 ? h : 0)));
      for (const other of occupied) if (left < other.left + other.w + 5 && left + w + 5 > other.left && top < other.top + other.h + 5 && top + h + 5 > other.top) top = Math.min(height - h - 24, other.top + other.h + 7);
      label.style.left = `${left}px`; label.style.top = `${top}px`; occupied.push({ left, top, w, h });
    }
    world.renderer.render(world.scene, world.camera);
  }
  function resize() {
    if (!world || disposed) return;
    world.renderer.setSize(container.clientWidth, container.clientHeight, false); world.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRecording, nextFrame, nextSelected) {
      recording = nextRecording; frame = nextFrame; selected = nextSelected;
      const reader = frame.policies.find(item => item.id === selected);
      Object.assign(container.dataset, { case: recording.id, timeMs: String(frame.timeMs), policyId: selected, sourcePosition: JSON.stringify(frame.sourcePosition), retainedPosition: JSON.stringify(reader.position), monitorState: reader.status, processRunning: String(['running', 'silent', 'termination-requested', 'starting'].includes(frame.process.status)), epoch: String(frame.process.epoch), processStatus: frame.process.status, view: mode });
      drawSvg(); updateThree();
    },
    setMode(next) {
      if (disposed) return;
      if (next === '3d' && failed) { unavailable('3D remains unavailable in this session.'); return; }
      mode = next; container.dataset.view = mode; svg.toggleAttribute('hidden', mode === '3d'); layer.hidden = mode !== '3d'; onModeChange(mode);
      if (mode === '3d') { if (world) { resize(); updateThree(); } else prepareThree(); }
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
