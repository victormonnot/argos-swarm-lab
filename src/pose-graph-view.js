// One drone's historical pose graph, viewed without executing another survey.
// True and initial poses stay fixed while optimizer iterations revise current
// estimates. Display height and yard geometry are not optimization variables.
const NS = 'http://www.w3.org/2000/svg';
const ALTITUDE = 2, DRONE_COLOR = '#85ddc0', INITIAL_COLOR = '#e4b778', TRUTH_COLOR = '#d4e2c3', LOOP_COLOR = '#d6b1e7';
const svgNode = (tag, attrs = {}, text = '') => { const element = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); if (text) element.textContent = text; return element; };
const circle = (radius, height = 0, center = [0, 0], count = 96) => Array.from({ length: count + 1 }, (_, index) => [center[0] + radius * Math.cos(index / count * 2 * Math.PI), height, -(center[1] + radius * Math.sin(index / count * 2 * Math.PI))]);

export function createPoseGraphView(container, { onModeChange = () => {}, onSelectPose = () => {} } = {}) {
  let run, options = { pose: 24, edge: 'loop', truth: true, initial: true, corrections: false }, mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 780 560', class: 'graph-svg', role: 'img', 'aria-label': 'A graph of 25 historical poses from one recorded drone survey. True trajectory is evaluator data, dashed amber is integrated odometry, green is the current optimized graph.' });
  const layer = Object.assign(document.createElement('div'), { className: 'graph-three', hidden: true }); container.append(svg, layer);
  function drawSvg() {
    if (!run || disposed) return;
    const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.graphSvgPose : null;
    const extent = Math.max(7.3, ...[run.truth, run.initialPoses, run.poses].flat().flatMap((pose) => pose.slice(0, 2).map((value) => Math.abs(value) + .8)));
    const scale = Math.min(355 / extent, 230 / extent), sx = (x) => 390 + x * scale, sy = (y) => 270 - y * scale;
    const line = (a, b, attrs = {}) => svgNode('line', { x1: sx(a[0]), y1: sy(a[1]), x2: sx(b[0]), y2: sy(b[1]), ...attrs });
    const poly = (points, attrs) => svgNode('polyline', { points: points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '), fill: 'none', ...attrs });
    svg.replaceChildren();
    svg.append(svgNode('rect', { x: 35, y: 25, width: 710, height: 480, rx: 12, fill: '#223e32', stroke: '#648267' }));
    for (let x = -Math.floor(extent); x <= extent; x++) { svg.append(line([x, -extent], [x, extent], { stroke: '#778d72', opacity: .16 }), line([-extent, x], [extent, x], { stroke: '#778d72', opacity: .16 })); }
    svg.append(line([0, 0], [1.4, 0], { stroke: '#bac9a4', opacity: .65 }), line([0, 0], [0, 1.4], { stroke: '#bac9a4', opacity: .65 }), svgNode('text', { x: sx(1.5), y: sy(0) + 4, fill: '#cbd5ae', 'font-size': 11 }, 'x'), svgNode('text', { x: sx(0) - 4, y: sy(1.6), fill: '#cbd5ae', 'font-size': 11 }, 'y'));
    if (options.truth) svg.append(poly(run.truth, { stroke: TRUTH_COLOR, 'stroke-width': 2, opacity: .62 }));
    if (options.initial) svg.append(poly(run.initialPoses, { stroke: INITIAL_COLOR, 'stroke-width': 2, 'stroke-dasharray': '7 5', opacity: .8 }));
    if (options.corrections) run.poses.forEach((pose, index) => svg.append(line(run.initialPoses[index], pose, { stroke: '#cbb2a0', 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: .7 })));
    svg.append(poly(run.poses, { stroke: DRONE_COLOR, 'stroke-width': 2.5 }));
    const selectedEdge = run.edges.find((edge) => edge.id === options.edge), loop = run.edges.find((edge) => edge.kind === 'loop');
    if (selectedEdge && selectedEdge.kind !== 'loop') svg.append(line(run.poses[selectedEdge.from], run.poses[selectedEdge.to], { stroke: '#f5d49b', 'stroke-width': 5, opacity: .6 }));
    if (loop) {
      const from = run.poses[loop.from], to = run.poses[loop.to], ax = sx(from[0]), ay = sy(from[1]), bx = sx(to[0]), by = sy(to[1]);
      svg.append(svgNode('path', { d: `M${ax} ${ay}Q${(ax + bx) / 2 + 38} ${(ay + by) / 2 - 52} ${bx} ${by}`, fill: 'none', stroke: LOOP_COLOR, 'stroke-width': 2.5, 'stroke-dasharray': '6 4' }), svgNode('text', { x: (ax + bx) / 2 + 25, y: (ay + by) / 2 - 40, fill: LOOP_COLOR, 'font-size': 11 }, `loop 0 → ${loop.to}`));
    }
    run.poses.forEach((pose, index) => {
      const [x, y, theta] = pose, group = svgNode('g', { transform: `translate(${sx(x)} ${sy(y)})`, role: 'button', tabindex: 0, 'data-graph-svg-pose': index, 'aria-label': `Select historical pose ${index}, recorded at ${index} seconds`, 'aria-pressed': String(options.pose === index) });
      group.append(svgNode('circle', { r: options.pose === index ? 10 : 4.5, fill: index === 0 ? '#e0e7bb' : '#183629', stroke: index === 0 ? '#f3e7ab' : DRONE_COLOR, 'stroke-width': options.pose === index ? 2 : 1.4 }));
      group.append(svgNode('path', { d: 'M0 -3L9 0L0 3Z', transform: `rotate(${-theta * 180 / Math.PI})`, fill: index === 0 ? '#f3e7ab' : DRONE_COLOR }));
      if (index % 4 === 0 || options.pose === index) group.append(svgNode('text', { x: index === 24 ? -9 : 8, y: index === 0 ? 20 : -12, 'text-anchor': index === 24 ? 'end' : 'start', fill: DRONE_COLOR, 'font-size': 11 }, `P${index}${index === 0 ? ' / fixed' : ''}`));
      group.addEventListener('click', () => onSelectPose(index)); group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPose(index); } }); svg.append(group);
    });
    const [tx, ty, theta] = run.truth[options.pose], current = run.poses[options.pose];
    svg.append(line([tx, ty], current, { stroke: '#e4afa2', 'stroke-dasharray': '3 4', opacity: .8 }));
    const drone = svgNode('g', { transform: `translate(${sx(tx)} ${sy(ty)}) rotate(${-theta * 180 / Math.PI})` });
    drone.append(svgNode('path', { d: 'M-12 -10L12 10M12 -10L-12 10', stroke: '#18372c', 'stroke-width': 7 }));
    for (const [x, y] of [[-12, -10], [-12, 10], [12, -10], [12, 10]]) drone.append(svgNode('circle', { cx: x, cy: y, r: 6, fill: '#173429', stroke: TRUTH_COLOR, 'stroke-width': 1.4 }));
    drone.append(svgNode('rect', { x: -7, y: -5, width: 14, height: 10, rx: 3, fill: TRUTH_COLOR }), svgNode('path', { d: 'M7 -4L17 0L7 4', fill: '#f3e9b1' })); svg.append(drone);
    svg.append(svgNode('text', { x: sx(tx), y: sy(ty) + 34, 'text-anchor': 'middle', fill: TRUTH_COLOR, 'font-size': 11 }, `one drone / true P${options.pose}`), svgNode('text', { x: 28, y: 539, fill: '#c2d2bc', 'font-size': 10.5 }, '25 HISTORICAL KEYFRAMES · ONE RECORDED DRONE · OPTIMIZATION DOES NOT ADVANCE FLIGHT'));
    if (focused !== undefined && focused !== null) svg.querySelector(`[data-graph-svg-pose="${focused}"]`)?.focus({ preventScroll: true });
  }
  function disposeWorld() {
    if (!world) return; world.controls.dispose(); const geometries = new Set(), materials = new Set();
    world.scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material)); else if (object.material) materials.add(object.material); object.shadow?.dispose(); }); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); world.renderer.dispose(); world = null;
  }
  function unavailable(message) { failed = true; disposeWorld(); layer.replaceChildren(); mode = '2d'; svg.toggleAttribute('hidden', false); layer.hidden = true; onModeChange('2d', `${message} The same pose graph remains available in 2D; all optimizer and inspection controls still work.`); }
  async function prepareThree() {
    if (world || loading || failed || disposed) return; loading = true; layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'graph-webgl-message', textContent: 'Preparing the recorded survey yard…' })); let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]); if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); pendingRenderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
      renderer.domElement.setAttribute('aria-label', '3D pose graph of one recorded drone survey. One detailed drone illustrates the selected true historical pose; 25 small oriented markers show graph poses, not a fleet.'); renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('The 3D graphics context was lost.'); }); layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 300), controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = true; controls.minDistance = 4; controls.maxDistance = 90; controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI / 2 - .035;
      scene.add(new THREE.HemisphereLight(0xe2f2dc, 0x344e30, 2.5)); const sun = new THREE.DirectionalLight(0xffeac3, 4); sun.position.set(-8, 15, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -14; sun.shadow.camera.right = 14; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14; sun.shadow.camera.far = 50; sun.shadow.normalBias = .035; sun.shadow.bias = -.0002; scene.add(sun); const fill = new THREE.DirectionalLight(0x9bcec1, 1.3); fill.position.set(11, 6, -9); scene.add(fill);
      const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...extra });
      const dark = mat(0x1a3328), edge = mat(0x425b47), concrete = mat(0x76876e), pale = mat(0xd4dcc0), metal = mat(0x8e9c91, { metalness: .55, roughness: .4 });
      const add = (geometry, material, position, parent = scene, name = '') => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name; parent.add(mesh); return mesh; };
      const box = (size, material, position, parent = scene, name) => add(new THREE.BoxGeometry(...size), material, position, parent, name);
      const cylinder = (radius, height, material, position, parent = scene) => add(new THREE.CylinderGeometry(radius, radius, height, 32), material, position, parent);
      const beam = (a, b, radius, material, parent = scene) => { const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from); const mesh = add(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, from.clone().add(to).multiplyScalar(.5).toArray(), parent); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh; };
      const line = (points, color, dashed = false, opacity = 1, parent = scene) => { const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .15, gapSize: .11, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }); const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))), material); if (dashed) object.computeLineDistances(); parent.add(object); return object; };
      // This yard illustrates the already recorded planar survey. No scenery
      // geometry or true trajectory is an optimizer input.
      cylinder(9.4, .33, edge, [0, -.21, 0]); cylinder(9.3, .07, concrete, [0, -.015, 0]);
      for (let axis = -8; axis <= 8; axis++) { const length = 2 * Math.sqrt(9.2 ** 2 - axis ** 2); box([.015, .009, length], mat(0x5b7358), [axis, .026, 0]); box([length, .009, .015], mat(0x5b7358), [0, .026, axis]); }
      line(circle(8.95, .075), '#d3d6b0', false, .6);
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
      const ghost = new THREE.Group(); ghost.name = 'selected-historical-estimate'; scene.add(ghost);
      line([[-.55, 0, -.48], [.55, 0, .48], [0, 0, 0], [.55, 0, -.48], [-.55, 0, .48]], DRONE_COLOR, true, .95, ghost); line([[0, 0, -.3], [.35, 0, 0], [0, 0, .3], [-.35, 0, 0], [0, 0, -.3]], DRONE_COLOR, true, 1, ghost); line([[.35, 0, -.2], [.78, 0, 0], [.35, 0, .2]], '#dcecc1', true, 1, ghost);
      const truthLine = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], TRUTH_COLOR, false, .6), initialLine = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], INITIAL_COLOR, true, .9), currentLine = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], DRONE_COLOR, false, 1);
      const groundLine = line([[4, .1, 0], [4, .1, 0]], DRONE_COLOR, false, .65), selectedError = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], '#e8b0a4', true, .85), selectedEdgeLine = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], '#f2d09d', false, 1);
      const loopLine = line([[4, ALTITUDE, 0], [4, ALTITUDE, 0]], LOOP_COLOR, true, 1), correctionLines = run.poses.map(() => line([[0, ALTITUDE, 0], [0, ALTITUDE, 0]], '#d2bda7', true, .5));
      const nodes = run.poses.map((pose, index) => { const group = new THREE.Group(); group.name = `historical-keyframe-${index}`; scene.add(group); const color = index === 0 ? '#f0dfac' : DRONE_COLOR; const ring = add(new THREE.TorusGeometry(index === 0 ? .21 : .11, .025, 8, 24), mat(color), [0, 0, 0], group); ring.rotation.x = Math.PI / 2; ring.castShadow = false; ring.receiveShadow = false; line([[0, .015, 0], [.35, .015, 0], [.24, .015, -.075], [.35, .015, 0], [.24, .015, .075]], color, false, .95, group); return group; });
      const overlay = Object.assign(document.createElement('div'), { className: 'graph-labels' }); layer.append(overlay); const leaders = svgNode('svg', { class: 'graph-label-leaders', 'aria-hidden': 'true' }); overlay.append(leaders);
      const labels = ['truth', 'selected', 'anchor', 'loop'].map((name) => { const label = Object.assign(document.createElement('span'), { className: `graph-scene-label graph-${name}-label` }); overlay.append(label); return label; });
      const cameraControls = Object.assign(document.createElement('div'), { className: 'graph-camera-controls' }); cameraControls.setAttribute('role', 'group'); cameraControls.setAttribute('aria-label', '3D camera framing'); const yardButton = Object.assign(document.createElement('button'), { id: 'graph-camera-overview', textContent: 'Whole graph', title: 'Frame the whole recorded graph without changing optimization' }), focusButton = Object.assign(document.createElement('button'), { id: 'graph-camera-focus', textContent: 'Focus selected pose', title: 'Frame the selected recorded true pose without changing optimization' }); cameraControls.append(yardButton, focusButton); layer.append(cameraControls); layer.append(Object.assign(document.createElement('span'), { className: 'graph-scene-caption', textContent: 'ONE RECORDED DRONE · 25 HISTORICAL POSES · OPTIMIZATION IS NOT FLIGHT' })); yardButton.addEventListener('click', () => frameCamera('yard')); focusButton.addEventListener('click', () => frameCamera('drone'));
      world = { THREE, renderer, scene, camera, controls, drone, ghost, nodes, truthLine, initialLine, currentLine, groundLine, selectedError, selectedEdgeLine, loopLine, correctionLines, labels, leaders, yardButton, focusButton, anchors: [] }; controls.addEventListener('change', drawThree); renderer.domElement.addEventListener('click', selectThree); resize(); frameCamera(cameraMode); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable; it requires WebGL 2.'); } finally { loading = false; }
  }
  function setLinePoints(object, points) { object.geometry.dispose(); object.geometry = new world.THREE.BufferGeometry().setFromPoints(points.map((point) => new world.THREE.Vector3(...point))); if (object.material.isLineDashedMaterial) object.computeLineDistances(); }
  function selectThree(event) {
    if (!world || !run || mode !== '3d') return; const rect = world.renderer.domElement.getBoundingClientRect(), pointer = new world.THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), ray = new world.THREE.Raycaster(); ray.setFromCamera(pointer, world.camera); const hits = ray.intersectObjects(world.nodes, true); if (!hits.length) return; let object = hits[0].object; while (object && !world.nodes.includes(object)) object = object.parent; const index = world.nodes.indexOf(object); if (index >= 0) onSelectPose(index);
  }
  function updateThree() {
    if (!world || !run || disposed || failed) return; const { THREE } = world, truth = run.truth[options.pose], current = run.poses[options.pose], [x, y, theta] = truth;
    world.drone.position.set(x, ALTITUDE, -y); world.drone.rotation.y = theta; world.ghost.position.set(current[0], ALTITUDE + .02, -current[1]); world.ghost.rotation.y = current[2];
    // Rotors remain still: the mesh illustrates a recorded keyframe, not a new
    // physical flight driven by optimization or wall-clock animation.
    setLinePoints(world.truthLine, run.truth.map(([px, py]) => [px, ALTITUDE - .035, -py])); setLinePoints(world.initialLine, run.initialPoses.map(([px, py]) => [px, ALTITUDE + .03, -py])); setLinePoints(world.currentLine, run.poses.map(([px, py]) => [px, ALTITUDE + .01, -py])); setLinePoints(world.groundLine, run.poses.map(([px, py]) => [px, .11, -py]));
    world.truthLine.visible = options.truth; world.initialLine.visible = options.initial;
    setLinePoints(world.selectedError, [[x, ALTITUDE, -y], [current[0], ALTITUDE, -current[1]]]);
    world.nodes.forEach((node, index) => { const pose = run.poses[index]; node.position.set(pose[0], ALTITUDE + .02, -pose[1]); node.rotation.y = pose[2]; node.scale.setScalar(index === options.pose ? 1.7 : 1); world.correctionLines[index].visible = options.corrections; const initial = run.initialPoses[index]; setLinePoints(world.correctionLines[index], [[initial[0], ALTITUDE + .01, -initial[1]], [pose[0], ALTITUDE + .01, -pose[1]]]); });
    const edge = run.edges.find((entry) => entry.id === options.edge), loop = run.edges.find((entry) => entry.kind === 'loop'); world.selectedEdgeLine.visible = Boolean(edge && edge.kind !== 'loop'); if (edge) { const from = run.poses[edge.from], to = run.poses[edge.to]; setLinePoints(world.selectedEdgeLine, [[from[0], ALTITUDE + .06, -from[1]], [to[0], ALTITUDE + .06, -to[1]]]); }
    world.loopLine.visible = Boolean(loop); let loopAnchor = null;
    if (loop) { const a = run.poses[loop.from], b = run.poses[loop.to]; const points = Array.from({ length: 33 }, (_, index) => { const t = index / 32; return [a[0] * (1 - t) + b[0] * t + .3 * Math.sin(Math.PI * t), ALTITUDE + 1.05 * Math.sin(Math.PI * t), -(a[1] * (1 - t) + b[1] * t)]; }); setLinePoints(world.loopLine, points); loopAnchor = new THREE.Vector3(...points[16]); loopAnchor.y += .27; world.labels[3].textContent = `supplied loop 0 → ${loop.to}`; }
    world.labels[0].textContent = `R1 / true P${options.pose} · recorded ${options.pose} s`; world.labels[1].textContent = `P${options.pose} / current estimate`; world.labels[2].textContent = 'P0 / fixed anchor';
    world.anchors = [new THREE.Vector3(x, ALTITUDE + .75, -y), new THREE.Vector3(current[0], ALTITUDE - .35, -current[1]), new THREE.Vector3(run.poses[0][0], ALTITUDE + .35, -run.poses[0][1]), loopAnchor];
    if (cameraMode === 'drone') { const target = new THREE.Vector3(x, ALTITUDE, -y); world.camera.position.add(target.clone().sub(world.controls.target)); world.controls.target.copy(target); world.controls.update(); }
    drawThree();
  }
  function frameCamera(next) {
    if (!world || !run || disposed || failed) return; cameraMode = next; world.yardButton.setAttribute('aria-pressed', String(next === 'yard')); world.focusButton.setAttribute('aria-pressed', String(next === 'drone'));
    if (next === 'yard') { const extent = Math.max(9.5, ...[run.truth, run.initialPoses, run.poses].flat().flatMap((pose) => pose.slice(0, 2).map((value) => Math.abs(value) + .8))), span = extent / 9.5 * Math.max(1, 1.3 / world.camera.aspect); world.controls.minDistance = 4; world.controls.target.set(0, 1.1, 0); world.camera.position.set(11 * span, 1.1 + 12 * span, 16 * span); } else { const [x, y] = run.truth[options.pose]; world.controls.minDistance = 2.3; world.controls.target.set(x, ALTITUDE, -y); world.camera.position.set(x + 3.6, ALTITUDE + 2.5, -y + 4.4); } world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || disposed || failed) return; world.renderer.render(world.scene, world.camera); const width = container.clientWidth, height = container.clientHeight; world.leaders.setAttribute('viewBox', `0 0 ${width} ${height}`); world.leaders.replaceChildren(); const occupied = [{ left: 7, top: 7, width: 245, height: 38 }];
    for (const index of [0, 1, 2, 3]) { const anchor = world.anchors[index], label = world.labels[index]; if (!anchor) { label.hidden = true; continue; } const point = anchor.clone().project(world.camera); label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > .98 || Math.abs(point.y) > .95; if (label.hidden) continue; const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2, w = label.offsetWidth, h = label.offsetHeight; let box;
      for (const [dx, dy] of [[0, 0], ...Array.from({ length: 5 }, (_, row) => [0, -1, 1, -2, 2].flatMap((column) => [[column * w * .6, -(row + 1) * (h + 7)], [column * w * .6, (row + 1) * (h + 7)]])).flat()]) { box = { left: Math.max(5, Math.min(width - w - 5, px - w / 2 + dx)), top: Math.max(7, Math.min(height - h - 28, py - h + dy)), width: w, height: h }; if (!occupied.some((other) => box.left < other.left + other.width + 4 && box.left + w + 4 > other.left && box.top < other.top + other.height + 4 && box.top + h + 4 > other.top)) break; } occupied.push(box); label.style.left = `${box.left + w / 2}px`; label.style.top = `${box.top + h}px`; const endX = Math.max(box.left, Math.min(box.left + w, px)), endY = Math.max(box.top, Math.min(box.top + h, py)); if (Math.hypot(px - endX, py - endY) > 5) world.leaders.append(svgNode('line', { x1: px, y1: py, x2: endX, y2: endY, stroke: index === 3 ? LOOP_COLOR : DRONE_COLOR, opacity: .5, 'stroke-width': 1 })); }
  }
  function resize() { if (!world || disposed || failed) return; const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight); world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree(); }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return { update(nextRun, nextOptions = {}) { if (disposed) return; const reset = run !== nextRun; run = nextRun; options = { ...options, ...nextOptions }; drawSvg(); if (world && reset && cameraMode === 'yard') frameCamera('yard'); updateThree(); }, setMode(next) { if (!['2d', '3d'].includes(next)) throw new RangeError('Unknown pose-graph view.'); if (disposed) return; if (next === '3d' && failed) { unavailable('3D remains unavailable in this page session.'); return; } mode = next; svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d'; onModeChange(mode); if (mode === '3d') void prepareThree(); if (world) world.controls.enabled = mode === '3d'; resize(); }, dispose() { disposed = true; observer.disconnect(); disposeWorld(); } };
}
