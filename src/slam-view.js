// Rendering reads the same planar pose-and-map state in both views. The model
// owns heading and position; airframe geometry, fixed height and scenery do not
// enter estimation or advance time. Stored trails are online estimates, not
// retrospectively optimized poses.
const NS = 'http://www.w3.org/2000/svg';
const ALTITUDE = 2;
const DRONE_COLOR = '#83dbc0';
const MAP_COLORS = ['#e8bd7a', '#b5c8eb', '#d5b3dc', '#d4d78c'];
const svgNode = (tag, attrs = {}, text = '') => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
};
function ellipsePoints(mean, covariance, count = 64) {
  const a = covariance[0][0], b = (covariance[0][1] + covariance[1][0]) / 2, d = covariance[1][1];
  const angle = Math.atan2(2 * b, a - d) / 2, spread = Math.hypot(a - d, 2 * b);
  const major = Math.sqrt(5.991 * Math.max(0, (a + d + spread) / 2)), minor = Math.sqrt(5.991 * Math.max(0, (a + d - spread) / 2));
  return Array.from({ length: count + 1 }, (_, index) => {
    const theta = Math.PI * 2 * index / count, x = major * Math.cos(theta), y = minor * Math.sin(theta);
    return [mean[0] + x * Math.cos(angle) - y * Math.sin(angle), mean[1] + x * Math.sin(angle) + y * Math.cos(angle)];
  });
}
const circle = (radius, height = 0, center = [0, 0], count = 96) => Array.from({ length: count + 1 }, (_, index) => [center[0] + radius * Math.cos(index / count * 2 * Math.PI), height, -(center[1] + radius * Math.sin(index / count * 2 * Math.PI))]);

export function createSlamView(container, { onModeChange = () => {}, onSelect = () => {} } = {}) {
  let run, selected = null, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 560', class: 'slam-svg', role: 'img', 'aria-label': 'Top-down SLAM experiment in shared world axes. The solid drone and posts are evaluator truth; dashed pose and landmark markers show estimates and marginal uncertainty.' });
  const layer = Object.assign(document.createElement('div'), { className: 'slam-three', hidden: true });
  container.append(svg, layer);
  function drawSvg() {
    if (!run || disposed) return;
    const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.slamSvgLandmark : null;
    const points = [...run.robot.truthTrail, ...run.robot.estimateTrail, ...ellipsePoints(run.robot.estimate, run.robot.covariance), ...run.landmarks.flatMap((entry) => entry.initialized ? [entry.truth, ...ellipsePoints(entry.estimate, entry.covariance)] : [entry.truth])];
    const extent = Math.max(9.8, ...points.flat().map((value) => Math.abs(value) + .6));
    const scale = Math.min(350 / extent, 232 / extent), sx = (x) => 390 + x * scale, sy = (y) => 274 - y * scale;
    const line = (from, to, attrs) => svgNode('line', { x1: sx(from[0]), y1: sy(from[1]), x2: sx(to[0]), y2: sy(to[1]), ...attrs });
    const poly = (values, attrs) => svgNode('polyline', { points: values.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '), fill: 'none', ...attrs });
    svg.replaceChildren();
    svg.append(svgNode('circle', { cx: sx(0), cy: sy(0), r: 9.35 * scale, fill: '#254134', stroke: '#66856a', 'stroke-width': 1.3 }));
    for (let x = -8; x <= 8; x++) {
      const end = Math.sqrt(9.2 ** 2 - x ** 2);
      svg.append(line([x, -end], [x, end], { stroke: '#76896c', opacity: .18 }), line([-end, x], [end, x], { stroke: '#76896c', opacity: .18 }));
    }
    svg.append(svgNode('circle', { cx: sx(0), cy: sy(0), r: 4 * scale, fill: 'none', stroke: '#b3c898', opacity: .4, 'stroke-dasharray': '4 6' }));
    svg.append(line([-1, 0], [1.4, 0], { stroke: '#c8d3a3', opacity: .7 }), line([0, -1], [0, 1.4], { stroke: '#c8d3a3', opacity: .7 }), svgNode('text', { x: sx(1.5), y: sy(0) + 4, fill: '#c8d3a3', 'font-size': 12 }, 'x'), svgNode('text', { x: sx(0) - 4, y: sy(1.6), fill: '#c8d3a3', 'font-size': 12 }, 'y'));
    const [tx, ty, theta] = run.robot.truth, [ex, ey, estimatedTheta] = run.robot.estimate;
    svg.append(svgNode('circle', { cx: sx(tx), cy: sy(ty), r: 5 * scale, fill: 'none', stroke: '#b2c2a4', opacity: .24, 'stroke-dasharray': '3 6' }));
    svg.append(poly(run.robot.truthTrail, { stroke: DRONE_COLOR, 'stroke-width': 2, opacity: .65 }), poly(run.robot.estimateTrail, { stroke: DRONE_COLOR, 'stroke-width': 1.7, 'stroke-dasharray': '5 4', opacity: .55 }));
    for (const observation of run.observations.landmarks) {
      const angle = theta + observation.value[1], end = [tx + observation.value[0] * Math.cos(angle), ty + observation.value[0] * Math.sin(angle)];
      svg.append(line([tx, ty], end, { stroke: '#e4dfaa', 'stroke-width': selected === observation.id ? 2 : 1.2, opacity: observation.used ? .9 : .4, 'stroke-dasharray': observation.used ? 'none' : '3 4' }), svgNode('circle', { cx: sx(end[0]), cy: sy(end[1]), r: 3.5, fill: 'none', stroke: '#e4dfaa' }));
    }
    run.landmarks.forEach((landmark, index) => {
      const color = MAP_COLORS[index], [x, y] = landmark.truth;
      if (landmark.initialized) {
        svg.append(poly(ellipsePoints(landmark.estimate, landmark.covariance), { stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '5 3', fill: color, 'fill-opacity': .04 }), line(landmark.truth, landmark.estimate, { stroke: '#e6afa2', 'stroke-dasharray': '3 3', opacity: .8 }));
        const [mx, my] = landmark.estimate;
        svg.append(svgNode('path', { d: `M${sx(mx)} ${sy(my) - 8}L${sx(mx) + 8} ${sy(my)}L${sx(mx)} ${sy(my) + 8}L${sx(mx) - 8} ${sy(my)}Z`, fill: '#173528', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }), svgNode('text', { x: sx(mx) + 11, y: sy(my) + 17, fill: color, 'font-size': 10 }, `${landmark.id} estimate`));
      }
      const group = svgNode('g', { transform: `translate(${sx(x)} ${sy(y)})`, 'data-slam-svg-landmark': landmark.id, role: 'button', tabindex: 0, 'aria-label': `${landmark.id}, evaluator landmark position. Select its current packet when available.` });
      if (selected === landmark.id) group.append(svgNode('circle', { r: 19, fill: 'none', stroke: color, 'stroke-width': 1.3 }));
      group.append(svgNode('rect', { x: -8, y: -8, width: 16, height: 16, rx: 3, fill: color, stroke: '#152e22', 'stroke-width': 2 }), svgNode('path', { d: 'M-4 -4L4 4M4 -4L-4 4', stroke: '#263c2b', 'stroke-width': 1.8 }), svgNode('text', { x: 0, y: -25, 'text-anchor': 'middle', fill: color, 'font-size': 12, 'font-weight': 650 }, `${landmark.id} truth`));
      group.addEventListener('click', () => onSelect(landmark.id)); group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(landmark.id); } }); svg.append(group);
    });
    svg.append(poly(ellipsePoints(run.robot.estimate, run.robot.covariance), { stroke: DRONE_COLOR, 'stroke-width': 1.7, 'stroke-dasharray': '6 4' }), line([tx, ty], [ex, ey], { stroke: '#e6afa2', 'stroke-dasharray': '3 3' }));
    const ghost = svgNode('g', { transform: `translate(${sx(ex)} ${sy(ey)}) rotate(${-estimatedTheta * 180 / Math.PI})` });
    ghost.append(svgNode('path', { d: 'M-11 -10L11 10M11 -10L-11 10M0 -6L6 0L0 6L-6 0Z M8 -5L19 0L8 5', fill: 'none', stroke: DRONE_COLOR, 'stroke-width': 1.6, 'stroke-dasharray': '4 2' })); svg.append(ghost);
    svg.append(svgNode('text', { x: sx(ex) + 16, y: sy(ey) + 25, fill: DRONE_COLOR, 'font-size': 11 }, 'R1 estimate'));
    const drone = svgNode('g', { transform: `translate(${sx(tx)} ${sy(ty)}) rotate(${-theta * 180 / Math.PI})` });
    drone.append(svgNode('path', { d: 'M-13 -11L13 11M13 -11L-13 11', stroke: '#132e25', 'stroke-width': 6 }));
    for (const [x, y] of [[-13, -11], [-13, 11], [13, -11], [13, 11]]) drone.append(svgNode('circle', { cx: x, cy: y, r: 6, fill: '#153326', stroke: DRONE_COLOR, 'stroke-width': 1.5 }));
    drone.append(svgNode('rect', { x: -8, y: -6, width: 16, height: 12, rx: 3, fill: DRONE_COLOR }), svgNode('path', { d: 'M8 -5L19 0L8 5', fill: '#e7edb5' })); svg.append(drone);
    svg.append(svgNode('text', { x: sx(tx), y: sy(ty) - 29, 'text-anchor': 'middle', fill: DRONE_COLOR, 'font-size': 12, 'font-weight': 650 }, 'R1 truth'));
    svg.append(svgNode('text', { x: 24, y: 536, fill: '#c3d3bc', 'font-size': 11 }, 'WORLD AXES · 1 GRID SQUARE = 1 M · 5 M SENSOR GATE / EVALUATOR'));
    if (focused) svg.querySelector(`[data-slam-svg-landmark="${focused}"]`)?.focus({ preventScroll: true });
  }
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d'; svg.toggleAttribute('hidden', false); layer.hidden = true;
    onModeChange('2d', `${message} Showing the same run in 2D; all estimator controls and map inspectors remain available.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'slam-webgl-message', textContent: 'Preparing the mapping yard…' }));
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
      renderer.domElement.setAttribute('aria-label', '3D EKF-SLAM yard: one detailed quadrotor, four identified landmark posts, estimated pose and map markers. Modeled planar heading turns the drone; height is fixed at two meters for display. Drag to orbit; scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); }); layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 300), controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = true; controls.minDistance = 4; controls.maxDistance = 90; controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI / 2 - .035;
      scene.add(new THREE.HemisphereLight(0xe2f2dc, 0x344e30, 2.5));
      const sun = new THREE.DirectionalLight(0xffeac3, 4); sun.position.set(-8, 15, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -14; sun.shadow.camera.right = 14; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14; sun.shadow.camera.far = 50; sun.shadow.normalBias = .035; sun.shadow.bias = -.0002; scene.add(sun);
      const fill = new THREE.DirectionalLight(0x9bcec1, 1.3); fill.position.set(11, 6, -9); scene.add(fill);
      const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...extra });
      const dark = mat(0x1a3328), edge = mat(0x425b47), concrete = mat(0x76876e), pale = mat(0xd4dcc0), metal = mat(0x8e9c91, { metalness: .55, roughness: .4 });
      const add = (geometry, material, position, parent = scene, name = '') => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name; parent.add(mesh); return mesh; };
      const box = (size, material, position, parent = scene, name) => add(new THREE.BoxGeometry(...size), material, position, parent, name);
      const cylinder = (radius, height, material, position, parent = scene) => add(new THREE.CylinderGeometry(radius, radius, height, 32), material, position, parent);
      const beam = (a, b, radius, material, parent = scene) => { const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from); const mesh = add(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh; };
      const line = (points, color, dashed = false, opacity = 1, parent = scene) => { const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .15, gapSize: .11, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }); const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))), material); if (dashed) object.computeLineDistances(); parent.add(object); return object; };
      // Scenery remains outside the true circular flight corridor. Four posts
      // illustrate static 2D points at the sensor's display height, not known
      // landmark coordinates or map priors supplied to the estimator.
      cylinder(9.4, .33, edge, [0, -.21, 0]); cylinder(9.3, .07, concrete, [0, -.015, 0]);
      for (let axis = -8; axis <= 8; axis++) { const length = 2 * Math.sqrt(9.2 ** 2 - axis ** 2); box([.015, .009, length], mat(0x5b7358), [axis, .026, 0]); box([length, .009, .015], mat(0x5b7358), [0, .026, axis]); }
      line(circle(4, .075), '#cad49f', true, .6); line(circle(8.95, .075), '#d3d6b0', false, .6);
      for (let index = 0; index < 24; index++) {
        const angle = index / 24 * Math.PI * 2, x = 9.1 * Math.cos(angle), z = 9.1 * Math.sin(angle);
        cylinder(.045, .5, metal, [x, .25, z]); cylinder(.065, .04, pale, [x, .52, z]);
      }
      line(circle(9.1, .4), '#6e8369', false, .7);
      cylinder(.9, .07, dark, [4, .065, 0]);
      const padRing = add(new THREE.TorusGeometry(.69, .019, 8, 48), pale, [4, .11, 0]); padRing.rotation.x = Math.PI / 2;
      for (const x of [-.18, .18]) box([.07, .012, .46], pale, [4 + x, .11, 0]); box([.44, .012, .07], pale, [4, .11, 0]);
      const service = new THREE.Group(); service.position.set(-5.6, 0, -5.3); service.rotation.y = Math.PI / 4; service.name = 'mapping-yard-service-structure'; scene.add(service);
      box([2.4, 1.35, 1.35], edge, [0, .675, 0], service); box([2.6, .15, 1.55], pale, [0, 1.42, 0], service);
      box([.67, 1.03, .035], dark, [-.62, .54, .692], service); box([.08, .035, .045], metal, [-.39, .61, .727], service); box([.73, .42, .04], mat(0x81b9a0, { metalness: .4, roughness: .25 }), [.53, .9, .7], service);
      for (const x of [-.55, .5]) { box([.68, .19, .66], dark, [x, 1.6, -.06], service); for (let i = 0; i < 4; i++) box([.035, .015, .49], metal, [x - .2 + i * .13, 1.7, -.06], service); }
      for (const [x, z] of [[5.5, 5.7], [5.8, 4.7], [-6.2, 4.8]]) { cylinder(.23, .68, edge, [x, .34, z]); cylinder(.25, .08, pale, [x, .71, z]); }
      line([[-.8, .08, 0], [1.5, .08, 0]], '#cad4a6', false, .8); line([[0, .08, .8], [0, .08, -1.5]], '#cad4a6', false, .8);
      const postViews = run.landmarks.map((landmark, index) => {
        const color = MAP_COLORS[index], post = new THREE.Group(); post.name = `${landmark.id}-true-landmark-post`; post.position.set(landmark.truth[0], 0, -landmark.truth[1]); post.rotation.y = Math.atan2(-landmark.truth[0], landmark.truth[1]); scene.add(post);
        cylinder(.63, .13, dark, [0, .065, 0], post); cylinder(.4, .07, pale, [0, .17, 0], post);
        box([.25, 2.04, .26], metal, [0, 1.17, 0], post); box([.72, .87, .14], dark, [0, ALTITUDE, .1], post);
        const panelMat = mat(color, { metalness: .15, roughness: .5 }); box([.59, .72, .07], panelMat, [0, ALTITUDE, .215], post);
        for (const [x, y] of [[-.17, -.21], [.17, .21]]) box([.16, .17, .018], dark, [x, ALTITUDE + y, .259], post);
        box([.15, .15, .019], pale, [0, ALTITUDE, .261], post);
        for (let stripe = 0; stripe <= index; stripe++) box([.045, .085, .02], pale, [-.22 + stripe * .14, ALTITUDE - .26, .26], post);
        box([.83, .095, .35], pale, [0, 2.51, .1], post); cylinder(.045, .19, dark, [0, 2.65, 0], post);
        const led = mat(color, { emissive: color, emissiveIntensity: .23 }); cylinder(.085, .07, led, [0, 2.78, 0], post);
        const ghost = new THREE.Group(); ghost.name = `${landmark.id}-estimated-map-point`; scene.add(ghost);
        line([[-.32, 0, -.32], [.32, 0, -.32], [.32, 0, .32], [-.32, 0, .32], [-.32, 0, -.32]], color, true, .9, ghost);
        line([[0, -.35, 0], [0, .35, 0]], color, true, 1, ghost); line([[-.38, 0, 0], [.38, 0, 0]], color, true, 1, ghost);
        const ellipse = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], color, true, .85), error = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#e6b0a1', true, .8), stem = line([[0, .08, 0], [0, ALTITUDE, 0]], color, true, .35);
        const measurement = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#e8e2b4', false, .85), tip = add(new THREE.SphereGeometry(.055, 12, 8), mat(0xe8e2b4), [0, ALTITUDE, 0]); tip.castShadow = false;
        return { post, panelMat, ghost, ellipse, error, stem, measurement, tip };
      });
      const color = DRONE_COLOR, shellMat = mat(color, { metalness: .28, roughness: .42 });
      const drone = new THREE.Group(); drone.name = 'R1-quadrotor'; scene.add(drone);
      box([.65, .21, .44], shellMat, [0, 0, 0], drone, 'drone-body'); box([.39, .055, .34], pale, [-.04, .137, 0], drone); box([.37, .085, .32], dark, [-.055, -.14, 0], drone);
      const rotors = [];
      for (const [x, z] of [[-.55, -.48], [-.55, .48], [.55, -.48], [.55, .48]]) {
        beam([x * .32, -.015, z * .26], [x, .025, z], .045, dark, drone); cylinder(.095, .14, metal, [x, .065, z], drone); cylinder(.07, .055, dark, [x, .16, z], drone);
        const rotor = new THREE.Group(); rotor.position.set(x, .2, z); drone.add(rotor); rotors.push(rotor); box([.62, .014, .065], dark, [0, 0, 0], rotor, 'propeller-blade'); cylinder(.04, .045, pale, [0, .012, 0], rotor);
        const disk = add(new THREE.RingGeometry(.255, .28, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false }), [x, .194, z], drone); disk.rotation.x = Math.PI / 2; disk.castShadow = false; disk.receiveShadow = false;
        cylinder(.036, .025, mat(x > 0 ? 0xf0c687 : 0x82d6bd, { emissive: x > 0 ? 0x957641 : 0x356e57, emissiveIntensity: .6 }), [x, -.023, z], drone);
      }
      for (const z of [-.3, .3]) { for (const x of [-.2, .2]) beam([x, -.065, z * .6], [x, -.3, z], .025, metal, drone); beam([-.36, -.3, z], [.36, -.3, z], .025, dark, drone); }
      const gimbal = new THREE.Group(); gimbal.position.set(.25, -.2, 0); drone.add(gimbal); add(new THREE.SphereGeometry(.085, 16, 12), metal, [0, 0, 0], gimbal);
      const lens = cylinder(.055, .09, dark, [.08, -.025, 0], gimbal); lens.rotation.z = Math.PI / 2; const glass = add(new THREE.CircleGeometry(.047, 24), mat(0x8fe1d5, { metalness: .55, roughness: .1 }), [.13, -.025, 0], gimbal); glass.rotation.y = Math.PI / 2;
      const ghost = new THREE.Group(); ghost.name = 'R1-estimated-pose'; scene.add(ghost);
      line([[-.55, 0, -.48], [.55, 0, .48], [0, 0, 0], [.55, 0, -.48], [-.55, 0, .48]], DRONE_COLOR, true, .9, ghost);
      line([[0, 0, -.3], [.35, 0, 0], [0, 0, .3], [-.35, 0, 0], [0, 0, -.3]], DRONE_COLOR, true, 1, ghost);
      line([[.35, 0, -.2], [.78, 0, 0], [.35, 0, .2]], '#dcecc1', true, 1, ghost);
      const poseEllipse = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], DRONE_COLOR, true, .85), poseError = line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#e6afa2', true, .85);
      const truthTrail = line([[4, .1, 0], [4, .1, 0]], DRONE_COLOR, false, .8), estimateTrail = line([[4, .12, 0], [4, .12, 0]], DRONE_COLOR, true, .65), altitudeGuide = line([[4, .1, 0], [4, ALTITUDE, 0]], DRONE_COLOR, true, .4);
      const sensorGate = line(circle(5, .08, [4, 0]), '#c9d2aa', true, .3);
      const overlay = Object.assign(document.createElement('div'), { className: 'slam-labels' }); layer.append(overlay); const leaders = svgNode('svg', { class: 'slam-label-leaders', 'aria-hidden': 'true' }); overlay.append(leaders);
      const labels = ['robot-truth', 'robot-estimate', ...run.landmarks.flatMap((entry) => [`${entry.id}-truth`, `${entry.id}-estimate`])].map((name) => { const label = Object.assign(document.createElement('span'), { className: `slam-scene-label ${name.includes('estimate') ? 'slam-estimate-label' : 'slam-truth-label'}` }); overlay.append(label); return label; });
      labels[0].style.color = DRONE_COLOR; labels[1].style.color = DRONE_COLOR;
      run.landmarks.forEach((entry, index) => { labels[2 + index * 2].style.color = MAP_COLORS[index]; labels[3 + index * 2].style.color = MAP_COLORS[index]; });
      const cameraControls = Object.assign(document.createElement('div'), { className: 'slam-camera-controls' }); cameraControls.setAttribute('role', 'group'); cameraControls.setAttribute('aria-label', '3D camera framing');
      const yardButton = Object.assign(document.createElement('button'), { id: 'slam-camera-overview', textContent: 'Whole yard', title: 'Frame the experiment and mapped uncertainty without changing the run' }), focusButton = Object.assign(document.createElement('button'), { id: 'slam-camera-focus', textContent: 'Focus drone', title: 'Follow the true drone pose without changing the estimator' });
      cameraControls.append(yardButton, focusButton); layer.append(cameraControls); layer.append(Object.assign(document.createElement('span'), { className: 'slam-scene-caption', textContent: 'PLANAR POSE + MAP · DISPLAY HEIGHT 2 M · TRUTH IS EVALUATOR DATA' }));
      yardButton.addEventListener('click', () => frameCamera('yard')); focusButton.addEventListener('click', () => frameCamera('drone'));
      world = { THREE, renderer, scene, camera, controls, drone, ghost, rotors, postViews, poseEllipse, poseError, truthTrail, estimateTrail, altitudeGuide, sensorGate, labels, leaders, yardButton, focusButton, anchors: [] };
      controls.addEventListener('change', drawThree); resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; it requires WebGL 2.'); }
    finally { loading = false; }
  }
  function setLinePoints(object, points) { object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map((point) => new world.THREE.Vector3(...point))); if (object.material.isLineDashedMaterial) object.computeLineDistances(); }
  function updateThree() {
    if (!world || !run || disposed || failed) return;
    const { THREE, robot } = { ...world, robot: run.robot }, [x, y, theta] = robot.truth, [ex, ey, estimatedTheta] = robot.estimate;
    world.drone.position.set(x, ALTITUDE, -y); world.drone.rotation.y = theta; world.ghost.position.set(ex, ALTITUDE + .015, -ey); world.ghost.rotation.y = estimatedTheta;
    world.rotors.forEach((rotor, index) => { rotor.rotation.y = run.time * 29 * (index % 2 ? -1 : 1) + index; });
    setLinePoints(world.poseEllipse, ellipsePoints(robot.estimate, robot.covariance).map(([px, py]) => [px, ALTITUDE + .01, -py])); setLinePoints(world.poseError, [[x, ALTITUDE, -y], [ex, ALTITUDE, -ey]]);
    setLinePoints(world.truthTrail, robot.truthTrail.map(([px, py]) => [px, .1, -py])); setLinePoints(world.estimateTrail, robot.estimateTrail.map(([px, py]) => [px, .12, -py]));
    setLinePoints(world.altitudeGuide, [[x, .1, -y], [x, ALTITUDE - .32, -y]]); setLinePoints(world.sensorGate, circle(5, .075, [x, y]));
    world.labels[0].textContent = 'R1 / truth'; world.labels[1].textContent = 'R1 / estimate';
    world.anchors = [new THREE.Vector3(x, ALTITUDE + .75, -y), new THREE.Vector3(ex, ALTITUDE - .3, -ey)];
    run.landmarks.forEach((landmark, index) => {
      const visual = world.postViews[index];
      world.labels[2 + index * 2].textContent = `${landmark.id} / truth`;
      world.labels[3 + index * 2].textContent = `${landmark.id} / estimate`;
      world.anchors.push(new THREE.Vector3(landmark.truth[0], 3.15, -landmark.truth[1]));
      for (const object of [visual.ghost, visual.ellipse, visual.error, visual.stem]) object.visible = landmark.initialized;
      visual.panelMat.emissive.set(MAP_COLORS[index]); visual.panelMat.emissiveIntensity = selected === landmark.id ? .2 : 0;
      if (landmark.initialized) {
        const [mx, my] = landmark.estimate; visual.ghost.position.set(mx, ALTITUDE + .01, -my);
        setLinePoints(visual.ellipse, ellipsePoints(landmark.estimate, landmark.covariance).map(([px, py]) => [px, ALTITUDE + .01, -py])); setLinePoints(visual.error, [[landmark.truth[0], ALTITUDE, -landmark.truth[1]], [mx, ALTITUDE, -my]]); setLinePoints(visual.stem, [[mx, .08, -my], [mx, ALTITUDE, -my]]);
        world.anchors.push(new THREE.Vector3(mx, ALTITUDE - .27, -my));
      } else world.anchors.push(null);
      const observation = run.observations.landmarks.find((entry) => entry.id === landmark.id);
      visual.measurement.visible = Boolean(observation); visual.tip.visible = Boolean(observation);
      if (observation) { const angle = theta + observation.value[1], mx = x + observation.value[0] * Math.cos(angle), my = y + observation.value[0] * Math.sin(angle); setLinePoints(visual.measurement, [[x, ALTITUDE + .025, -y], [mx, ALTITUDE + .025, -my]]); visual.tip.position.set(mx, ALTITUDE + .025, -my); visual.measurement.material.opacity = observation.used ? selected === landmark.id ? 1 : .65 : .3; }
    });
    if (cameraMode === 'drone') { const target = new THREE.Vector3(x, ALTITUDE, -y); world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update(); }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !run || disposed || failed) return;
    cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.focusButton.setAttribute('aria-pressed', String(next === 'drone'));
    if (next === 'yard') {
      const points = [...run.robot.estimateTrail, ...ellipsePoints(run.robot.estimate, run.robot.covariance), ...run.landmarks.flatMap((entry) => entry.initialized ? ellipsePoints(entry.estimate, entry.covariance) : [])];
      const extent = Math.max(9.5, ...points.flat().map((value) => Math.abs(value) + .5)), span = extent / 9.5 * Math.max(1, 1.3 / world.camera.aspect);
      world.controls.minDistance = 4; world.controls.target.set(0, .85, 0); world.camera.position.set(12 * span, .85 + 13 * span, 17 * span);
    } else { const [x, y] = run.robot.truth; world.controls.minDistance = 2.3; world.controls.target.set(x, ALTITUDE, -y); world.camera.position.set(x + 3.6, ALTITUDE + 2.5, -y + 4.4); }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || disposed || failed) return;
    world.renderer.render(world.scene, world.camera);
    const width = container.clientWidth, height = container.clientHeight; world.leaders.setAttribute('viewBox', `0 0 ${width} ${height}`); world.leaders.replaceChildren();
    const occupied = [{ left: 7, top: 7, width: 185, height: 38 }];
    for (const index of [0, 2, 4, 6, 8, 1, 3, 5, 7, 9]) {
      const anchor = world.anchors[index], label = world.labels[index]; if (!anchor) { label.hidden = true; continue; }
      const point = anchor.clone().project(world.camera); label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > .98 || Math.abs(point.y) > .95; if (label.hidden) continue;
      const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2, w = label.offsetWidth, h = label.offsetHeight;
      let box; for (const [dx, dy] of [[0, 0], [-w * .6, 0], [w * .6, 0], [0, -h - 7], [0, h + 9], [-w * .6, h + 9], [w * .6, h + 9], [0, -h * 2 - 14], [0, h * 2 + 18]]) { box = { left: Math.max(5, Math.min(width - w - 5, px - w / 2 + dx)), top: Math.max(7, Math.min(height - h - 28, py - h + dy)), width: w, height: h }; if (!occupied.some((other) => box.left < other.left + other.width + 4 && box.left + w + 4 > other.left && box.top < other.top + other.height + 4 && box.top + h + 4 > other.top)) break; }
      occupied.push(box); label.style.left = `${box.left + w / 2}px`; label.style.top = `${box.top + h}px`;
      const endX = Math.max(box.left, Math.min(box.left + w, px)), endY = Math.max(box.top, Math.min(box.top + h, py)); if (Math.hypot(px - endX, py - endY) > 5) world.leaders.append(svgNode('line', { x1: px, y1: py, x2: endX, y2: endY, stroke: index < 2 ? DRONE_COLOR : MAP_COLORS[Math.floor((index - 2) / 2)], opacity: .5, 'stroke-width': 1 }));
    }
  }
  function resize() { if (!world || disposed || failed) return; const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight); world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree(); }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(nextRun, selectedId = selected) { if (disposed) return; const reset = run !== nextRun; run = nextRun; selected = selectedId; drawSvg(); if (world && reset && cameraMode === 'yard') frameCamera('yard'); updateThree(); },
    setMode(next) { if (!['2d', '3d'].includes(next)) throw new RangeError('Unknown SLAM view.'); if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this page session.'); return; } mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') void prepareThree(); if (world) world.controls.enabled = mode === '3d'; resize(); },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); },
  };
}
