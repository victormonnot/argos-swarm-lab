// Both views observe one planar estimator run. Airframes, height, heading,
// scenery and camera framing are presentation; no renderer advances the model.
const NS = 'http://www.w3.org/2000/svg';
const ALTITUDE = 2;
const COLORS = ['#80dcc0', '#e5ba79'];
const svgNode = (tag, attributes = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text) node.textContent = text;
  return node;
};
// Eigenvectors of a symmetric 2×2 marginal covariance. A 95% Gaussian contour
// uses chi-square with two dimensions, not a 1.96-axis radius or a safety bound.
function ellipsePoints(mean, covariance, count = 64) {
  const a = covariance[0][0], b = (covariance[0][1] + covariance[1][0]) / 2, d = covariance[1][1];
  const angle = Math.atan2(2 * b, a - d) / 2;
  const discriminant = Math.hypot(a - d, 2 * b);
  const major = Math.sqrt(5.991 * Math.max(0, (a + d + discriminant) / 2));
  const minor = Math.sqrt(5.991 * Math.max(0, (a + d - discriminant) / 2));
  return Array.from({ length: count + 1 }, (_, index) => {
    const theta = 2 * Math.PI * index / count, x = major * Math.cos(theta), y = minor * Math.sin(theta);
    return [mean[0] + x * Math.cos(angle) - y * Math.sin(angle), mean[1] + x * Math.sin(angle) + y * Math.cos(angle)];
  });
}

export function createCooperativeView(container, { onModeChange = () => {}, onSelect = () => {} } = {}) {
  let run, selected = 'A1', mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 510', class: 'coop-svg', role: 'img', 'aria-label': 'Top-down cooperative localization: solid drones show evaluator truth; dashed markers and marginal uncertainty ellipses show position beliefs in shared x and y axes.' });
  const layer = Object.assign(document.createElement('div'), { className: 'coop-three', hidden: true });
  container.append(svg, layer);
  function drawSvg() {
    if (!run || disposed) return;
    const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.coopSvgAgent : null;
    const points = run.agents.flatMap((agent) => [...agent.truthTrail, ...agent.estimateTrail, ...ellipsePoints(agent.estimate, agent.covariance)]);
    const minX = Math.min(-5.5, ...points.map((point) => point[0])) - .5, maxX = Math.max(7, ...points.map((point) => point[0])) + .5;
    const minY = Math.min(-4, ...points.map((point) => point[1])) - .5, maxY = Math.max(3, ...points.map((point) => point[1])) + .5;
    const scale = Math.min(690 / (maxX - minX), 394 / (maxY - minY));
    const sx = (x) => 390 + (x - (minX + maxX) / 2) * scale, sy = (y) => 251 - (y - (minY + maxY) / 2) * scale;
    const line = (from, to, attributes = {}) => svgNode('line', { x1: sx(from[0]), y1: sy(from[1]), x2: sx(to[0]), y2: sy(to[1]), ...attributes });
    const polyline = (values, attributes = {}) => svgNode('polyline', { points: values.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '), fill: 'none', ...attributes });
    svg.replaceChildren();
    svg.append(svgNode('rect', { x: 20, y: 22, width: 740, height: 450, rx: 12, fill: '#213e34', stroke: '#6f8871', 'stroke-width': 1 }));
    for (let x = Math.ceil(minX); x <= maxX; x++) svg.append(line([x, minY], [x, maxY], { stroke: '#718476', opacity: .17 }));
    for (let y = Math.ceil(minY); y <= maxY; y++) svg.append(line([minX, y], [maxX, y], { stroke: '#718476', opacity: .17 }));
    svg.append(line([0, minY], [0, maxY], { stroke: '#c1d1ab', opacity: .45, 'stroke-dasharray': '5 5' }), line([minX, 0], [maxX, 0], { stroke: '#c1d1ab', opacity: .45, 'stroke-dasharray': '5 5' }));
    svg.append(svgNode('text', { x: sx(0) + 8, y: sy(0) + 17, fill: '#bed1b4', 'font-size': 10 }, 'world origin'), svgNode('text', { x: 738, y: sy(0) - 7, 'text-anchor': 'end', fill: '#cbd7be', 'font-size': 12 }, 'x →'), svgNode('text', { x: sx(0) + 8, y: 46, fill: '#cbd7be', 'font-size': 12 }, 'y ↑'));
    svg.append(svgNode('text', { x: 35, y: 495, fill: '#c1d2c3', 'font-size': 11 }, 'WORLD AXES · 1 GRID SQUARE = 1 M · EVALUATOR + BELIEF'));
    for (const [index, agent] of run.agents.entries()) {
      const color = COLORS[index], [tx, ty] = agent.truth, [ex, ey] = agent.estimate;
      svg.append(polyline(agent.truthTrail, { stroke: color, 'stroke-width': 2, opacity: .52 }), polyline(agent.estimateTrail, { stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: .38 }));
      svg.append(polyline(ellipsePoints(agent.estimate, agent.covariance), { stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '7 4', fill: color, 'fill-opacity': .05 }));
      svg.append(line(agent.truth, agent.estimate, { stroke: '#e9b1a2', 'stroke-width': 1.3, 'stroke-dasharray': '3 4' }));
      const ghost = svgNode('g', { transform: `translate(${sx(ex)} ${sy(ey)})`, 'data-coop-estimate': agent.id });
      ghost.append(svgNode('path', { d: 'M0 -10L10 0L0 10L-10 0Z M-15 0H15 M0 -15V15', stroke: color, 'stroke-width': 1.7, fill: '#16372d', 'stroke-dasharray': '4 2' }), svgNode('text', { x: 16, y: -13, fill: color, 'font-size': 11 }, `${agent.id} estimate`)); svg.append(ghost);
      const drone = svgNode('g', { transform: `translate(${sx(tx)} ${sy(ty)})`, role: 'button', tabindex: 0, 'aria-label': `Select ${agent.id}, evaluator true position`, 'aria-pressed': String(selected === agent.id), 'data-coop-svg-agent': agent.id });
      if (selected === agent.id) drone.append(svgNode('circle', { r: 26, fill: 'none', stroke: color, opacity: .6 }));
      drone.append(svgNode('path', { d: 'M-13 -11L13 11M13 -11L-13 11', stroke: '#132c26', 'stroke-width': 7 }));
      for (const [x, y] of [[-13, -11], [-13, 11], [13, -11], [13, 11]]) drone.append(svgNode('circle', { cx: x, cy: y, r: 7, fill: '#132c26', stroke: color, 'stroke-width': 1.5 }));
      drone.append(svgNode('rect', { x: -8, y: -6, width: 16, height: 12, rx: 4, fill: color }), svgNode('path', { d: 'M5 -4L12 0L5 4', fill: '#f0edce' }), svgNode('text', { x: 0, y: -31, 'text-anchor': 'middle', fill: color, 'font-size': 12, 'font-weight': 650 }, `${agent.id} truth`));
      drone.addEventListener('click', () => onSelect(agent.id));
      drone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(agent.id); } });
      svg.append(drone);
    }
    const relative = run.observations.relative;
    if (relative?.available) {
      const from = run.agents[0].truth, to = from.map((value, index) => value + relative.value[index]);
      svg.append(line(from, to, { stroke: '#dfdba7', 'stroke-width': 2, 'stroke-dasharray': relative.used ? 'none' : '3 5', opacity: .8 }), svgNode('circle', { cx: sx(to[0]), cy: sy(to[1]), r: 4, fill: 'none', stroke: '#dfdba7', 'stroke-width': 2 }));
      svg.append(svgNode('text', { x: sx((from[0] + to[0]) / 2) + 12, y: sy((from[1] + to[1]) / 2), fill: '#f0e9b7', 'font-size': 11 }, `measured Δ${relative.used ? '' : ' / omitted'}`));
    }
    if (focused) svg.querySelector(`[data-coop-svg-agent="${focused}"]`)?.focus({ preventScroll: true });
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else if (object.material) materials.add(object.material);
      object.shadow?.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d';
    svg.toggleAttribute('hidden', false); layer.hidden = true;
    onModeChange('2d', `${message} Showing the same run in 2D; all estimator controls and inspectors remain available.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'coop-webgl-message', textContent: 'Preparing the localization yard…' }));
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
      renderer.domElement.setAttribute('aria-label', '3D localization yard with two detailed quadrotors at fixed display altitude, estimated position markers, uncertainty ellipses and an illustrative absolute-reference beacon. Drag to orbit; scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 250);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = true; controls.minDistance = 4; controls.maxDistance = 80;
      controls.maxPolarAngle = Math.PI / 2 - .035; controls.minPolarAngle = .15;
      scene.add(new THREE.HemisphereLight(0xe4f3df, 0x304932, 2.5));
      const sun = new THREE.DirectionalLight(0xffedc6, 4); sun.position.set(-6, 13, 10); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -13; sun.shadow.camera.right = 13; sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13; sun.shadow.camera.far = 45; sun.shadow.normalBias = .035; sun.shadow.bias = -.0002;
      sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
      const fill = new THREE.DirectionalLight(0x94c9bb, 1.25); fill.position.set(9, 5, -7); scene.add(fill);
      const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...extra });
      const dark = mat(0x183229), edge = mat(0x3c5748), concrete = mat(0x738270), pale = mat(0xd1d9bb), metal = mat(0x899c94, { metalness: .55, roughness: .4 });
      const add = (geometry, material, position, parent = scene, name = '') => {
        const object = new THREE.Mesh(geometry, material); object.position.set(...position); object.castShadow = true; object.receiveShadow = true; object.name = name; parent.add(object); return object;
      };
      const box = (dimensions, material, position, parent = scene, name) => add(new THREE.BoxGeometry(...dimensions), material, position, parent, name);
      const cylinder = (radius, height, material, position, parent = scene) => add(new THREE.CylinderGeometry(radius, radius, height, 24), material, position, parent);
      const beam = (a, b, radius, material, parent = scene) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
        const object = add(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent);
        object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object;
      };
      const line = (points, color, dashed = false, opacity = 1, parent = scene) => {
        const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .16, gapSize: .10, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point))), material); if (dashed) object.computeLineDistances(); parent.add(object); return object;
      };
      // Service geometry sits outside both prescribed paths. It supplies visual
      // scale; the estimator receives no map, collision data or beacon ranges.
      box([14, .3, 10], edge, [1, -.2, .5], scene, 'localization-yard-base');
      box([13.85, .06, 9.85], concrete, [1, -.02, .5]);
      const gridMat = mat(0x576e5b);
      for (let x = -5; x <= 7; x++) box([.012, .008, 9.7], gridMat, [x, .016, .5]);
      for (let z = -4; z <= 5; z++) box([13.7, .008, .012], gridMat, [1, .016, z]);
      for (const [index, location] of [[0, [-3, 1.5]], [1, [-2.5, -1.5]]]) {
        const [x, z] = location;
        cylinder(.84, .07, dark, [x, .055, z]);
        const ring = add(new THREE.TorusGeometry(.65, .018, 8, 48), mat(COLORS[index]), [x, .1, z]); ring.rotation.x = Math.PI / 2;
        for (const offset of [-.17, .17]) box([.065, .014, .44], pale, [x + offset, .097, z]);
        box([.4, .014, .065], pale, [x, .097, z]);
      }
      const service = new THREE.Group(); service.position.set(3.7, 0, -3.5); service.name = 'service-building'; scene.add(service);
      box([3.3, 1.6, 1.55], edge, [0, .8, 0], service);
      box([3.5, .14, 1.75], pale, [0, 1.67, 0], service);
      box([.85, 1.17, .055], dark, [-.9, .6, .8], service);
      box([.12, .05, .045], metal, [-.62, .61, .85], service);
      for (const x of [.1, .95]) box([.66, .48, .06], mat(0x79ad9d, { metalness: .35, roughness: .28 }), [x, 1.08, .805], service);
      for (const x of [-.5, .6]) { box([.72, .24, .6], dark, [x, 1.86, -.1], service); for (let stripe = 0; stripe < 4; stripe++) box([.04, .012, .46], metal, [x - .21 + stripe * .14, 1.99, -.1], service); }
      for (let x = -5; x <= 7; x += 1.5) {
        cylinder(.04, .77, metal, [x, .385, -4.18]);
        if (x < 7) beam([x, .59, -4.18], [x + 1.5, .59, -4.18], .025, metal);
      }
      const beacon = new THREE.Group(); beacon.position.set(-4.65, 0, -3.15); beacon.name = 'illustrative-world-reference-beacon'; scene.add(beacon);
      box([.83, .23, .83], dark, [0, .115, 0], beacon);
      cylinder(.085, 2.8, metal, [0, 1.6, 0], beacon);
      box([.55, .55, .24], pale, [0, 1.5, .05], beacon);
      const beaconLight = mat(0x8bc8a0, { emissive: 0x3b9e77, emissiveIntensity: .45 });
      cylinder(.15, .18, beaconLight, [0, 3.05, 0], beacon);
      cylinder(.2, .05, dark, [0, 2.93, 0], beacon); cylinder(.2, .05, dark, [0, 3.17, 0], beacon);
      const dome = add(new THREE.SphereGeometry(.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), pale, [0, 3.2, 0], beacon);
      dome.castShadow = true;
      for (const [x, z] of [[-5.2, 4.6], [7.2, 4.6], [7.2, -3.9]]) { cylinder(.1, .6, mat(0xc6a16a), [x, .3, z]); cylinder(.102, .08, dark, [x, .44, z]); }
      line([[0, .08, 0], [1.4, .08, 0]], '#d8cf9d', false, .8); line([[0, .08, 0], [0, .08, -1.4]], '#d8cf9d', false, .8);
      const agentViews = run.agents.map((agent, index) => {
        const color = COLORS[index], shellMat = mat(color, { metalness: .28, roughness: .42 });
        const drone = new THREE.Group(); drone.name = `${agent.id}-quadrotor`; scene.add(drone);
        box([.65, .21, .44], shellMat, [0, 0, 0], drone, 'drone-body');
        box([.39, .055, .34], pale, [-.04, .137, 0], drone); box([.37, .085, .32], dark, [-.055, -.14, 0], drone);
        const rotors = [];
        for (const [x, z] of [[-.55, -.48], [-.55, .48], [.55, -.48], [.55, .48]]) {
          beam([x * .32, -.015, z * .26], [x, .025, z], .045, dark, drone);
          cylinder(.095, .14, metal, [x, .065, z], drone); cylinder(.07, .055, dark, [x, .16, z], drone);
          const rotor = new THREE.Group(); rotor.position.set(x, .2, z); drone.add(rotor); rotors.push(rotor);
          box([.62, .014, .065], dark, [0, 0, 0], rotor, 'propeller-blade'); cylinder(.04, .045, pale, [0, .012, 0], rotor);
          const disk = add(new THREE.RingGeometry(.255, .28, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .30, side: THREE.DoubleSide, depthWrite: false }), [x, .194, z], drone);
          disk.rotation.x = Math.PI / 2; disk.castShadow = false; disk.receiveShadow = false;
          cylinder(.036, .025, mat(x > 0 ? 0xf0c687 : 0x82d6bd, { emissive: x > 0 ? 0x957641 : 0x356e57, emissiveIntensity: .6 }), [x, -.023, z], drone);
        }
        for (const z of [-.30, .30]) {
          for (const x of [-.2, .2]) beam([x, -.065, z * .6], [x, -.3, z], .025, metal, drone);
          beam([-.36, -.3, z], [.36, -.3, z], .025, dark, drone);
        }
        const gimbal = new THREE.Group(); gimbal.position.set(.25, -.2, 0); drone.add(gimbal);
        add(new THREE.SphereGeometry(.085, 16, 12), metal, [0, 0, 0], gimbal);
        const lens = cylinder(.055, .09, dark, [.08, -.025, 0], gimbal); lens.rotation.z = Math.PI / 2;
        const glass = add(new THREE.CircleGeometry(.047, 24), mat(0x8fe1d5, { metalness: .55, roughness: .1 }), [.13, -.025, 0], gimbal); glass.rotation.y = Math.PI / 2;
        const ghost = new THREE.Group(); ghost.name = `${agent.id}-estimated-position`; scene.add(ghost);
        line([[-.6, 0, -.5], [.6, 0, .5], [0, 0, 0], [.6, 0, -.5], [-.6, 0, .5]], color, true, .9, ghost);
        line([[0, 0, -.34], [.36, 0, 0], [0, 0, .34], [-.36, 0, 0], [0, 0, -.34]], color, true, 1, ghost);
        for (const [x, z] of [[-.6, -.5], [-.6, .5], [.6, -.5], [.6, .5]]) line(Array.from({ length: 25 }, (_, n) => [x + .23 * Math.cos(n / 24 * Math.PI * 2), 0, z + .23 * Math.sin(n / 24 * Math.PI * 2)]), color, true, .75, ghost);
        const ellipse = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], color, true, .8);
        const error = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#e7aaa1', true, .85);
        const trail = line([[0, .1, 0], [0, .1, 0]], color, false, .7);
        const estimateTrail = line([[0, .12, 0], [0, .12, 0]], color, true, .5);
        const vertical = line([[0, .1, 0], [0, ALTITUDE - .35, 0]], color, true, .4);
        const ground = add(new THREE.RingGeometry(.42, .46, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, side: THREE.DoubleSide }), [0, .09, 0]); ground.rotation.x = Math.PI / 2; ground.castShadow = false;
        return { drone, rotors, ghost, ellipse, error, trail, estimateTrail, vertical, ground };
      });
      const relativeLine = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#e6dfac', false, .9);
      const relativeTip = add(new THREE.SphereGeometry(.07, 12, 8), mat(0xe6dfac), [0, ALTITUDE, 0]); relativeTip.castShadow = false;
      const overlay = Object.assign(document.createElement('div'), { className: 'coop-labels' }); layer.append(overlay);
      const leaders = svgNode('svg', { class: 'coop-label-leaders', 'aria-hidden': 'true' }); overlay.append(leaders);
      const labels = ['truth-a1', 'estimate-a1', 'truth-a2', 'estimate-a2', 'reference', 'relative'].map((name) => {
        const label = Object.assign(document.createElement('span'), { className: `coop-scene-label ${name}` }); overlay.append(label); return label;
      });
      const cameraControls = Object.assign(document.createElement('div'), { className: 'coop-camera-controls' }); cameraControls.setAttribute('role', 'group'); cameraControls.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'coop-camera-overview', textContent: 'Whole yard', title: 'Frame the yard and current uncertainty without changing the estimator' });
      const focusButton = Object.assign(document.createElement('button'), { id: 'coop-camera-focus', textContent: 'Focus selected drone', title: 'Follow the selected true drone without changing the estimator' });
      cameraControls.append(yardButton, focusButton); layer.append(cameraControls);
      layer.append(Object.assign(document.createElement('span'), { className: 'coop-scene-caption', textContent: 'PLANAR ESTIMATION · DISPLAY HEIGHT 2 M · NO FLIGHT PHYSICS' }));
      yardButton.addEventListener('click', () => frameCamera('yard')); focusButton.addEventListener('click', () => frameCamera('drone'));
      world = { THREE, renderer, scene, camera, controls, agentViews, relativeLine, relativeTip, labels, leaders, beaconLight, yardButton, focusButton, anchors: [] };
      controls.addEventListener('change', drawThree);
      renderer.domElement.addEventListener('click', selectThree);
      resize(); frameCamera(cameraMode); updateThree();
    } catch {
      if (!world) pendingRenderer?.dispose();
      if (!disposed) unavailable('3D is unavailable; it requires WebGL 2.');
    } finally { loading = false; }
  }
  function setLinePoints(object, points) {
    object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map((point) => new world.THREE.Vector3(...point)));
    if (object.material.isLineDashedMaterial) object.computeLineDistances();
  }
  function selectThree(event) {
    if (!world || !run || mode !== '3d') return;
    const rect = world.renderer.domElement.getBoundingClientRect();
    const pointer = new world.THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new world.THREE.Raycaster(); ray.setFromCamera(pointer, world.camera);
    const hits = ray.intersectObjects(world.agentViews.map((entry) => entry.drone), true);
    if (!hits.length) return;
    const index = world.agentViews.findIndex((entry) => { let object = hits[0].object; while (object) { if (object === entry.drone) return true; object = object.parent; } return false; });
    if (index >= 0) onSelect(run.agents[index].id);
  }
  function updateThree() {
    if (!world || !run || disposed || failed) return;
    const { THREE, agentViews, labels } = world;
    world.anchors = [];
    run.agents.forEach((agent, index) => {
      const visual = agentViews[index], [x, y] = agent.truth, [ex, ey] = agent.estimate;
      visual.drone.position.set(x, ALTITUDE, -y); visual.ghost.position.set(ex, ALTITUDE + .015, -ey);
      const prior = agent.truthTrail.at(-2) ?? agent.truth;
      visual.drone.rotation.y = Math.atan2(y - prior[1], x - prior[0]);
      visual.rotors.forEach((rotor, n) => { rotor.rotation.y = run.time * 29 * (n % 2 ? -1 : 1) + n; });
      visual.ground.position.set(x, .09, -y); visual.ground.material.opacity = selected === agent.id ? 1 : .4;
      setLinePoints(visual.ellipse, ellipsePoints(agent.estimate, agent.covariance).map(([px, py]) => [px, ALTITUDE + .012, -py]));
      setLinePoints(visual.error, [[x, ALTITUDE + .01, -y], [ex, ALTITUDE + .01, -ey]]);
      setLinePoints(visual.trail, agent.truthTrail.map(([px, py]) => [px, .10, -py]));
      setLinePoints(visual.estimateTrail, agent.estimateTrail.map(([px, py]) => [px, .12, -py]));
      setLinePoints(visual.vertical, [[x, .1, -y], [x, ALTITUDE - .32, -y]]);
      labels[index * 2].textContent = `${agent.id} / truth`;
      labels[index * 2 + 1].textContent = `${agent.id} / estimate`;
      world.anchors.push(new THREE.Vector3(x, ALTITUDE + .67, -y), new THREE.Vector3(ex, ALTITUDE - .27, -ey));
    });
    const reference = run.config.scenario !== 'unanchored' && (run.config.scenario !== 'anchor-restored' || run.time >= 10);
    world.beaconLight.color.setHex(reference ? 0x8bc8a0 : 0x9e7561); world.beaconLight.emissiveIntensity = reference ? .45 : .05;
    labels[4].textContent = `World reference / ${reference ? 'A1 fixes enabled' : 'fixes absent'}`;
    world.anchors.push(new THREE.Vector3(-4.65, 3.75, -3.15));
    const relative = run.observations.relative;
    world.relativeLine.visible = Boolean(relative?.available); world.relativeTip.visible = Boolean(relative?.available);
    if (relative?.available) {
      const from = run.agents[0].truth, to = from.map((value, index) => value + relative.value[index]);
      setLinePoints(world.relativeLine, [[from[0], ALTITUDE + .04, -from[1]], [to[0], ALTITUDE + .04, -to[1]]]);
      world.relativeTip.position.set(to[0], ALTITUDE + .04, -to[1]);
      world.relativeLine.material.opacity = relative.used ? .9 : .4;
      world.anchors.push(new THREE.Vector3((from[0] + to[0]) / 2, ALTITUDE + .18, -(from[1] + to[1]) / 2));
      labels[5].textContent = `measured Δ${relative.used ? '' : ' / omitted'}`;
    } else { world.anchors.push(null); labels[5].hidden = true; }
    if (cameraMode === 'drone') {
      const agent = run.agents.find((entry) => entry.id === selected), target = new THREE.Vector3(agent.truth[0], ALTITUDE, -agent.truth[1]);
      world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update();
    }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !run || disposed || failed) return;
    cameraMode = next;
    world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.focusButton.setAttribute('aria-pressed', String(next === 'drone'));
    if (next === 'yard') {
      const points = run.agents.flatMap((agent) => [...agent.truthTrail, ...agent.estimateTrail, ...ellipsePoints(agent.estimate, agent.covariance)]);
      const minX = Math.min(-5.8, ...points.map((point) => point[0])), maxX = Math.max(7.8, ...points.map((point) => point[0]));
      const minY = Math.min(-5.3, ...points.map((point) => point[1])), maxY = Math.max(4.3, ...points.map((point) => point[1]));
      const x = (minX + maxX) / 2, z = -(minY + maxY) / 2;
      const span = Math.max((maxX - minX) / 14, (maxY - minY) / 10, 1) * Math.max(1, 1.35 / world.camera.aspect);
      world.controls.minDistance = 4; world.controls.target.set(x, .9, z);
      world.camera.position.set(x + 9.5 * span, .9 + 11 * span, z + 14 * span);
    } else {
      const agent = run.agents.find((entry) => entry.id === selected), [x, y] = agent.truth;
      world.controls.minDistance = 2.3; world.controls.target.set(x, ALTITUDE, -y); world.camera.position.set(x + 3, ALTITUDE + 2.1, -y + 4.2);
    }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || disposed || failed) return;
    world.renderer.render(world.scene, world.camera);
    const width = container.clientWidth, height = container.clientHeight;
    world.leaders.setAttribute('viewBox', `0 0 ${width} ${height}`); world.leaders.replaceChildren();
    const occupied = [{ left: 7, top: 7, width: 238, height: 38 }];
    for (const index of [0, 2, 1, 3, 4, 5]) {
      const anchor = world.anchors[index], label = world.labels[index];
      if (!anchor) { label.hidden = true; continue; }
      const point = anchor.clone().project(world.camera);
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > .98 || Math.abs(point.y) > .95;
      if (label.hidden) continue;
      const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2;
      const w = label.offsetWidth, h = label.offsetHeight;
      const offsets = [[0, 0], [-w * .6, 0], [w * .6, 0], [0, -h - 7], [0, h + 9], [-w * .6, h + 9], [w * .6, h + 9], [0, -h * 2 - 14], [0, h * 2 + 18]];
      let box;
      for (const [dx, dy] of offsets) {
        const candidate = { left: Math.max(5, Math.min(width - w - 5, px - w / 2 + dx)), top: Math.max(7, Math.min(height - h - 28, py - h + dy)), width: w, height: h };
        box = candidate;
        if (!occupied.some((other) => candidate.left < other.left + other.width + 4 && candidate.left + w + 4 > other.left && candidate.top < other.top + other.height + 4 && candidate.top + h + 4 > other.top)) break;
      }
      occupied.push(box);
      label.style.left = `${box.left + w / 2}px`; label.style.top = `${box.top + h}px`;
      const endX = Math.max(box.left, Math.min(box.left + w, px)), endY = Math.max(box.top, Math.min(box.top + h, py));
      if (Math.hypot(px - endX, py - endY) > 5) world.leaders.append(svgNode('line', { x1: px, y1: py, x2: endX, y2: endY, stroke: index < 4 ? COLORS[Math.floor(index / 2)] : '#ddd3aa', opacity: .5, 'stroke-width': 1 }));
    }
  }
  function resize() {
    if (!world || disposed || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, selectedId = selected) { if (disposed) return; const reset = run !== nextRun; run = nextRun; selected = selectedId; drawSvg(); if (world && reset && cameraMode === 'yard') frameCamera('yard'); updateThree(); },
    setMode(next) {
      if (!['2d', '3d'].includes(next)) throw new RangeError('Unknown localization view.');
      if (disposed) return;
      if (next === '3d' && failed) { unavailable('3D remains unavailable in this page session.'); return; }
      mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d'; onModeChange(mode);
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d'; resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
