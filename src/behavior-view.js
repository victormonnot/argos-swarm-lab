// Renderers consume the same kinematic state. Mesh geometry, airframe heading,
// shadows and camera controls are presentation only; they never tick an executor.
const NS = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attrs = {}, text = '') => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
};
const sx = (x) => 110 + x * 70;
const sz = (z) => 390 - z * 80;

export function createBehaviorView(container, { onModeChange = () => {} } = {}) {
  let run, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 720 480', class: 'behavior-svg', role: 'img', 'aria-label': 'Side elevation of the inspection mission. Horizontal position x and altitude z in meters; every waypoint has y equal to zero.' });
  const layer = Object.assign(document.createElement('div'), { className: 'behavior-three', hidden: true });
  container.append(svg, layer);

  function drawSvg() {
    if (!run) return;
    svg.replaceChildren();
    svg.append(svgNode('rect', { x: 53, y: 390, width: 622, height: 28, rx: 5, fill: '#334e42' }));
    svg.append(svgNode('text', { x: 44, y: 35, fill: '#b8d1c1', 'font-size': 12, 'letter-spacing': 1 }, 'SIDE ELEVATION / x, z'));
    for (let z = 0; z <= 4; z += 1) {
      svg.append(svgNode('line', { x1: 67, y1: sz(z), x2: 674, y2: sz(z), stroke: '#3e5b4c', 'stroke-width': .7, 'stroke-dasharray': z ? '3 6' : '' }));
      svg.append(svgNode('text', { x: 53, y: sz(z) + 4, fill: '#a4baaa', 'font-size': 12, 'text-anchor': 'end' }, `${z} m`));
    }
    // The inspection tower sits behind the route in y. This side projection
    // intentionally collapses that separation; the flight marker stays in front.
    svg.append(svgNode('rect', { x: sx(6) - 19, y: sz(3.65), width: 38, height: 292, rx: 3, fill: '#44594b', stroke: '#74846a', 'stroke-width': 1.5 }));
    for (let row = 0; row < 4; row += 1) svg.append(svgNode('rect', { x: sx(6) - 13, y: sz(3.48) + row * 60, width: 26, height: 48, fill: row === 0 ? '#8f8060' : '#354b3f', stroke: '#697c61' }));
    svg.append(svgNode('circle', { cx: sx(6), cy: sz(3), r: 17, fill: '#a9915e', stroke: '#e5c786', 'stroke-width': 2 }));
    svg.append(svgNode('text', { x: sx(6), y: sz(3.95), fill: '#edd69e', 'font-size': 13, 'text-anchor': 'middle' }, 'S1 / inspection station'));
    svg.append(svgNode('path', { d: `M${sx(0)},${sz(0)} L${sx(0)},${sz(3)} L${sx(6)},${sz(3)}`, stroke: '#a5ba8a', 'stroke-width': 2, 'stroke-dasharray': '6 7', fill: 'none' }));
    svg.append(svgNode('rect', { x: sx(0) - 45, y: sz(0) - 3, width: 90, height: 8, rx: 3, fill: '#9aa586' }));
    svg.append(svgNode('text', { x: sx(0), y: 445, fill: '#d3e4c8', 'font-size': 13, 'text-anchor': 'middle' }, 'H / home · x = 0 m'));
    svg.append(svgNode('text', { x: sx(6), y: 445, fill: '#b9ccb2', 'font-size': 12, 'text-anchor': 'middle' }, 'x = 6 m'));
    const track = run.history.map((entry) => `${sx(entry.position[0])},${sz(entry.position[2])}`).join(' ');
    svg.append(svgNode('polyline', { points: track, stroke: '#75d8b7', 'stroke-width': 2.5, 'stroke-opacity': .75, fill: 'none' }));
    const [x, , altitude] = run.agent.position, px = sx(x), py = sz(altitude);
    svg.append(svgNode('line', { x1: px, y1: sz(0), x2: px, y2: py, stroke: '#e5d49d', 'stroke-width': 1.1, 'stroke-dasharray': '3 4' }));
    if (altitude > .3) svg.append(svgNode('text', { x: px + 35, y: (py + sz(0)) / 2, fill: '#e5d49d', 'font-size': 12 }, `z = ${altitude.toFixed(2)} m`));
    svg.append(svgNode('ellipse', { cx: px, cy: sz(0) - 2, rx: 26 + altitude * 2, ry: 5, fill: '#081d17', opacity: .5 }));
    const drone = svgNode('g', { transform: `translate(${px} ${py - 11})`, 'data-behavior-drone': 'D1', 'data-altitude': altitude });
    drone.append(svgNode('path', { d: 'M-30,1 L30,1 M-12,5 L-17,20 L-8,20 M12,5 L17,20 L8,20', fill: 'none', stroke: '#b1c5b9', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    drone.append(svgNode('rect', { x: -13, y: -8, width: 26, height: 15, rx: 5, fill: '#76d4b6', stroke: '#b7f1d7', 'stroke-width': 1.5 }));
    drone.append(svgNode('rect', { x: -7, y: -12, width: 14, height: 4, rx: 2, fill: '#b5c8b4' }));
    for (const dx of [-30, 30]) {
      drone.append(svgNode('rect', { x: dx - 4, y: -6, width: 8, height: 10, rx: 3, fill: '#89a692' }));
      drone.append(svgNode('ellipse', { cx: dx, cy: -8, rx: 18, ry: 3, fill: '#9cbca8', opacity: .8 }));
    }
    drone.append(svgNode('circle', { cx: 12, cy: 10, r: 4, fill: '#11291f', stroke: '#e6d3a2', 'stroke-width': 1.5 }));
    svg.append(drone);
    svg.append(svgNode('text', { x: px, y: py - 47, fill: '#b3f3d6', 'font-size': 14, 'font-weight': 600, 'text-anchor': 'middle' }, `D1 · ${run.agent.action === 'hold' ? 'HOLD' : altitude === 0 ? 'PAD' : 'AIRBORNE'}`));
    svg.append(svgNode('text', { x: 672, y: 35, fill: '#c5d7bd', 'font-size': 12, 'text-anchor': 'end' }, `${run.time.toFixed(2)} s · same run`));
  }

  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((object) => {
      object.shadow?.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren();
    mode = '2d'; svg.toggleAttribute('hidden', false); layer.hidden = true;
    onModeChange('2d', `${message} Showing the same run in 2D; all controls and state inspection remain available.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'behavior-webgl-message', textContent: 'Preparing the inspection yard…' }));
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute('aria-label', '3D inspection yard with a quadrotor, landing pad and inspection tower. The drone uses the same modeled position and altitude as 2D. Drag to orbit; scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(43, 1, .1, 120);
      camera.position.set(10, 8, 12);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(3, 1.2, -.1); controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 24;
      controls.maxPolarAngle = Math.PI / 2 - .06; controls.minPolarAngle = .18; controls.update();
      scene.add(new THREE.HemisphereLight(0xdaf3e7, 0x334e32, 2.6));
      const sun = new THREE.DirectionalLight(0xffebbe, 4.2); sun.position.set(-3, 12, 8); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -10; sun.shadow.camera.right = 10; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
      sun.shadow.normalBias = .035; sun.shadow.bias = -.0002; sun.shadow.camera.far = 40; sun.target.position.set(3, 0, 0); scene.add(sun, sun.target);
      const fill = new THREE.DirectionalLight(0x8fc9bd, 1.2); fill.position.set(8, 5, -6); scene.add(fill);
      const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...options });
      const concrete = material(0x778579), edge = material(0x344e42), dark = material(0x172d28), metal = material(0x879991, { metalness: .55, roughness: .4 }), teal = material(0x55b99d, { metalness: .3, roughness: .45 }), amber = material(0xd2ad6b), pale = material(0xc8d3b3);
      const addMesh = (geometry, meshMaterial, xyz, parent = scene, name) => {
        const mesh = new THREE.Mesh(geometry, meshMaterial); mesh.position.set(...xyz); mesh.castShadow = true; mesh.receiveShadow = true;
        if (name) mesh.name = name; parent.add(mesh); return mesh;
      };
      const box = (size, meshMaterial, xyz, parent = scene, name) => addMesh(new THREE.BoxGeometry(...size), meshMaterial, xyz, parent, name);
      const cylinder = (radius, height, meshMaterial, xyz, parent = scene, top = radius) => addMesh(new THREE.CylinderGeometry(top, radius, height, 24), meshMaterial, xyz, parent);
      const beam = (a, b, radius, meshMaterial, parent = scene) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
        const mesh = addMesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), meshMaterial, from.clone().add(to).multiplyScalar(.5).toArray(), parent);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return mesh;
      };
      // A bounded display yard. Volumetric structures remain outside the known
      // flight corridor; they are scenery, not obstacles seen by the executor.
      box([12, .3, 7], edge, [3, -.21, -.4], scene, 'inspection-yard-base');
      box([11.8, .075, 6.8], concrete, [3, -.0275, -.4]);
      const tileMaterial = material(0x617564);
      for (let x = -2; x <= 8; x += 1) box([.012, .006, 6.75], tileMaterial, [x, .015, -.4]);
      for (let z = -3; z <= 2; z += 1) box([11.75, .006, .012], tileMaterial, [3, .015, z]);
      // A broad landing pad, H markings and short perimeter lights.
      cylinder(1.05, .06, dark, [0, .045, 0]);
      const padRing = addMesh(new THREE.TorusGeometry(.84, .025, 8, 64), pale, [0, .087, 0]); padRing.rotation.x = Math.PI / 2;
      for (const x of [-.25, .25]) box([.1, .012, .67], pale, [x, .081, 0]);
      box([.6, .012, .1], pale, [0, .081, 0]);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        cylinder(.065, .12, dark, [x, .06, z]); cylinder(.045, .035, teal, [x, .135, z]);
      }
      // The station is behind the hover point (negative display z), so the
      // drone inspects its front face without flying into its geometry.
      const station = new THREE.Group(); station.name = 'volumetric-inspection-station'; station.position.set(6, 0, -1.55); scene.add(station);
      box([1.5, .2, 1.15], dark, [0, .1, 0], station);
      box([1.05, 3.55, .62], metal, [0, 1.975, 0], station);
      box([.9, 3.38, .09], edge, [0, 1.99, .355], station);
      for (const x of [-.48, .48]) box([.07, 3.4, .12], pale, [x, 2, .385], station);
      for (let height = .55; height <= 3.2; height += .65) {
        box([.78, .46, .05], height > 2.5 ? amber : dark, [0, height, .425], station);
        for (let row = 0; row < 3; row += 1) box([.56, .014, .015], metal, [0, height - .12 + row * .1, .46], station);
      }
      const target = addMesh(new THREE.TorusGeometry(.235, .035, 12, 36), amber, [0, 3.35, .48], station);
      const targetCenter = addMesh(new THREE.CircleGeometry(.135, 32), dark, [0, 3.35, .48], station); targetCenter.castShadow = false;
      box([.04, .34, .02], pale, [0, 3.35, .5], station); box([.34, .04, .02], pale, [0, 3.35, .5], station);
      box([1.35, .13, .95], pale, [0, 3.82, 0], station);
      cylinder(.06, .36, dark, [.38, 4.05, -.14], station);
      const beaconMaterial = material(0x73ba8d, { emissive: 0x346145, emissiveIntensity: .4 });
      cylinder(.09, .12, beaconMaterial, [.38, 4.28, -.14], station);
      // Small service structures add scale and depth at the edge of the yard.
      box([2.2, 1.28, 1.35], edge, [-1, .64, -2.6]);
      box([2.4, .12, 1.55], pale, [-1, 1.34, -2.6]);
      box([.75, .87, .025], dark, [-1.48, .46, -1.91]);
      box([.7, .35, .035], teal, [-.48, .91, -1.91]);
      for (let x = 1; x <= 8; x += 1.4) {
        cylinder(.04, .72, metal, [x, .36, -3.25]);
        if (x < 7.5) beam([x, .55, -3.25], [Math.min(x + 1.4, 8), .55, -3.25], .025, metal);
      }
      for (const [x, z] of [[7.8, 1.9], [-1.9, 1.9]]) {
        cylinder(.11, .65, amber, [x, .325, z]); cylinder(.112, .09, dark, [x, .46, z]);
      }
      // Airframe origin is the grounded vehicle reference. Body / gear heights
      // are a visual offset above model z, not a second altitude simulation.
      const drone = new THREE.Group(); drone.name = 'D1-quadrotor'; scene.add(drone);
      const body = new THREE.Group(); body.position.y = .32; drone.add(body);
      const shell = box([.62, .2, .42], teal, [0, 0, 0], body, 'drone-body');
      box([.38, .055, .33], pale, [-.035, .13, 0], body);
      box([.37, .09, .32], dark, [-.06, -.12, 0], body);
      const arms = [], rotors = [];
      for (const [x, z] of [[-.55, -.49], [-.55, .49], [.55, -.49], [.55, .49]]) {
        arms.push(beam([x * .32, -.015, z * .25], [x, .025, z], .045, dark, body));
        cylinder(.095, .14, metal, [x, .065, z], body);
        cylinder(.07, .055, dark, [x, .16, z], body);
        const rotor = new THREE.Group(); rotor.position.set(x, .2, z); body.add(rotor); rotors.push(rotor);
        box([.63, .015, .065], dark, [0, 0, 0], rotor, 'propeller-blade');
        cylinder(.04, .045, pale, [0, .012, 0], rotor);
        const disk = addMesh(new THREE.RingGeometry(.26, .285, 40), new THREE.MeshBasicMaterial({ color: 0xb2d5c3, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }), [x, .195, z], body);
        disk.rotation.x = Math.PI / 2; disk.castShadow = false; disk.receiveShadow = false;
        const led = material(x > 0 ? 0xeabf76 : 0x86d2ab, { emissive: x > 0 ? 0xc79c4c : 0x4f9f70, emissiveIntensity: .5 });
        cylinder(.04, .024, led, [x, -.028, z], body);
      }
      for (const z of [-.29, .29]) {
        for (const x of [-.2, .2]) beam([x, -.06, z * .57], [x, -.24, z], .025, metal, body);
        beam([-.35, -.24, z], [.35, -.24, z], .025, dark, body);
      }
      const gimbal = new THREE.Group(); gimbal.position.set(.23, -.17, 0); body.add(gimbal);
      addMesh(new THREE.SphereGeometry(.085, 16, 12), metal, [0, 0, 0], gimbal);
      const lens = cylinder(.055, .09, dark, [.08, -.025, 0], gimbal); lens.rotation.z = Math.PI / 2;
      const lensGlass = addMesh(new THREE.CircleGeometry(.046, 24), new THREE.MeshStandardMaterial({ color: 0x81d9d1, roughness: .12, metalness: .6 }), [.128, -.025, 0], gimbal); lensGlass.rotation.y = Math.PI / 2;
      const line = (points, color, dashed = false, opacity = 1) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
        const lineMaterial = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .18, gapSize: .14, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const object = new THREE.Line(geometry, lineMaterial); if (dashed) object.computeLineDistances(); scene.add(object); return object;
      };
      const route = line([[0, .1, 0], [0, 3.32, 0], [6, 3.32, 0]], 0xb9c899, true, .75); route.name = 'fixed-route-guide';
      const trail = line([[0, .1, 0], [0, .1, 0]], 0x91e2bb, false, .8);
      const altitudeGuide = line([[0, .09, 0], [0, .32, 0]], 0xe0ce96, true, .85);
      const groundMarker = addMesh(new THREE.RingGeometry(.42, .45, 48), new THREE.MeshBasicMaterial({ color: 0xb9d6ae, transparent: true, opacity: .7, side: THREE.DoubleSide }), [0, .083, 0]); groundMarker.rotation.x = Math.PI / 2; groundMarker.castShadow = false;
      const scan = new THREE.Mesh(new THREE.ConeGeometry(.27, 1.04, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xe1c286, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false }));
      scan.rotation.x = -Math.PI / 2; scan.position.set(6, 3.32, -.54); scene.add(scan);
      const overlay = Object.assign(document.createElement('div'), { className: 'behavior-labels' }); layer.append(overlay);
      const labels = ['drone', 'home', 'station'].map((name) => { const label = Object.assign(document.createElement('span'), { className: `behavior-scene-label ${name}-label` }); overlay.append(label); return label; });
      const cameraControls = Object.assign(document.createElement('div'), { className: 'behavior-camera-controls' });
      cameraControls.setAttribute('role', 'group'); cameraControls.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'behavior-whole-yard', textContent: 'Whole yard', title: 'Frame the full mission route without changing the run' });
      const droneButton = Object.assign(document.createElement('button'), { id: 'behavior-focus-drone', textContent: 'Focus drone', title: 'Move the camera closer and follow the drone; model state stays unchanged' });
      yardButton.setAttribute('aria-pressed', 'true'); droneButton.setAttribute('aria-pressed', 'false');
      cameraControls.append(yardButton, droneButton); layer.append(cameraControls);
      yardButton.addEventListener('click', () => frameCamera('yard'));
      droneButton.addEventListener('click', () => frameCamera('drone'));
      const caption = Object.assign(document.createElement('span'), { className: 'behavior-scene-caption', textContent: 'FIXED ROUTE · 3D KINEMATICS · METERS' }); layer.append(caption);
      world = { THREE, renderer, scene, camera, controls, drone, rotors, trail, altitudeGuide, groundMarker, scan, beaconMaterial, labels, yardButton, droneButton, anchors: [] };
      controls.addEventListener('change', drawThree); resize(); updateThree();
    } catch {
      if (!world) pendingRenderer?.dispose();
      if (!disposed) unavailable('3D is unavailable; it requires WebGL 2.');
    } finally { loading = false; }
  }
  function setLinePoints(line, points) {
    line.geometry.dispose();
    line.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map((point) => new world.THREE.Vector3(...point)));
    if (line.isLine && line.material.isLineDashedMaterial) line.computeLineDistances();
  }
  function updateThree() {
    if (!world || !run || disposed || failed) return;
    const { THREE, drone, rotors, trail, altitudeGuide, groundMarker, scan, beaconMaterial, labels } = world;
    const [x, y, z] = run.agent.position;
    drone.position.set(x, z, -y);
    // Facing follows the displayed action, as a visual cue only. The model does
    // not estimate or integrate heading, attitude or rotor angular velocity.
    drone.rotation.y = ['return', 'abort-return'].includes(run.agent.action) ? Math.PI : ['inspect', 'hold'].includes(run.agent.action) && x === 6 ? Math.PI / 2 : 0;
    rotors.forEach((rotor, index) => { rotor.rotation.y = run.time * 29 * (index % 2 ? -1 : 1) + index; });
    setLinePoints(trail, run.history.map((entry) => [entry.position[0], entry.position[2] + .12, -entry.position[1]]));
    setLinePoints(altitudeGuide, [[x, .09, -y], [x, z + .32, -y]]);
    groundMarker.position.set(x, .086, -y);
    scan.visible = run.agent.action === 'inspect' && !run.observations.sensorFailed;
    beaconMaterial.color.setHex(run.observations.sensorFailed ? 0xca775b : run.agent.completedActions.includes('inspect') ? 0x9ddb9c : 0x73ba8d);
    labels[0].textContent = `D1 · ${z.toFixed(2)} m${run.agent.action === 'hold' ? ' · HOLD' : ''}`;
    labels[1].textContent = 'H / home pad'; labels[2].textContent = 'S1 / inspection';
    world.anchors = [new THREE.Vector3(x, z + .98, -y), new THREE.Vector3(0, .1, 1.13), new THREE.Vector3(6, 4.65, -1.55)];
    if (cameraMode === 'drone') {
      const nextTarget = new THREE.Vector3(x, z + .4, -y);
      const shift = nextTarget.clone().sub(world.controls.target);
      if (shift.lengthSq() > 1e-12) {
        world.camera.position.add(shift); world.controls.target.copy(nextTarget); world.controls.update();
      }
    }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !run || disposed || failed) return;
    cameraMode = next;
    world.yardButton.setAttribute('aria-pressed', String(next === 'yard'));
    world.droneButton.setAttribute('aria-pressed', String(next === 'drone'));
    if (next === 'yard') {
      world.controls.minDistance = 7;
      world.controls.target.set(3, 1.2, -.1);
      world.camera.position.set(10, 8, 12);
    } else {
      const [x, y, z] = run.agent.position;
      world.controls.minDistance = 2.3;
      world.controls.target.set(x, z + .4, -y);
      world.camera.position.set(x + 3.1, z + 2.3, -y + 4.5);
    }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || disposed || failed) return;
    world.renderer.render(world.scene, world.camera);
    world.anchors.forEach((anchor, index) => {
      const point = anchor.clone().project(world.camera), label = world.labels[index];
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`; label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > .98 || Math.abs(point.y) > .98;
    });
  }
  function resize() {
    if (!world || disposed || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun) { if (disposed) return; run = nextRun; drawSvg(); updateThree(); },
    setMode(next) {
      if (!['2d', '3d'].includes(next)) throw new RangeError('Unknown mission view.');
      if (disposed) return;
      if (next === '3d' && failed) { unavailable('3D remains unavailable in this page session.'); return; }
      mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d';
      onModeChange(mode);
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d';
      resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
