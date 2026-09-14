const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#72dabb', '#b8acff', '#f1c17d'];
const LABEL_OFFSETS = [[-15, -16], [15, -16], [15, 24]];
function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function releaseGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); group.clear();
}

/** Both views observe one supplied fusion snapshot. Marker positions are target
 * estimates, never agent positions. Heights are decorative; model y maps to -z.
 * Truth is displayed for the learner but is never fed to a fusion update. */
export function createFusionView(container) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false;
  const svg = element('svg', { viewBox: '0 0 760 600', class: 'fusion-svg', role: 'img', 'aria-label': 'Three target estimates and reported uncertainty contours. A1 is a circle, A2 a diamond, A3 a square; T is evaluator-only target truth. Trails are estimate revisions, not robot motion.' });
  const layer = document.createElement('div'); layer.className = 'fusion-three'; layer.hidden = true; container.append(svg, layer);
  function bounds() {
    const points = [...run.readings.map((record) => record.mean), run.truth];
    const low = [0, 1].map((axis) => Math.floor(Math.min(...points.map((point) => point[axis])) - 2));
    const high = [0, 1].map((axis) => Math.ceil(Math.max(...points.map((point) => point[axis])) + 2));
    return { low, high, width: high[0] - low[0], height: high[1] - low[1] };
  }
  function drawSvg() {
    if (!run || disposed) return;
    const { low, high, width, height } = bounds(), size = Math.min(640 / width, 480 / height);
    const left = (760 - size * width) / 2, top = (550 - size * height) / 2;
    const X = (x) => left + (x - low[0]) * size, Y = (y) => top + (high[1] - y) * size;
    svg.replaceChildren(element('rect', { x: left, y: top, width: width * size, height: height * size, fill: '#19372f', stroke: '#426055' }));
    for (let x = low[0]; x <= high[0]; x += 1) {
      svg.append(element('path', { d: `M${X(x)} ${Y(low[1])}V${Y(high[1])}`, stroke: '#34564a', 'stroke-width': .8 }));
      svg.append(element('text', { x: X(x), y: Y(low[1]) + 24, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, x));
    }
    for (let y = low[1]; y <= high[1]; y += 1) {
      svg.append(element('path', { d: `M${X(low[0])} ${Y(y)}H${X(high[0])}`, stroke: '#34564a', 'stroke-width': .8 }));
      svg.append(element('text', { x: left - 14, y: Y(y) + 4, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'end' }, y));
    }
    for (const agent of run.agents) {
      const id = agent.id, cx = X(agent.mean[0]), cy = Y(agent.mean[1]);
      svg.append(element('ellipse', { 'data-fusion-contour': id, 'data-variance': agent.covariance[0], cx, cy, rx: 2 * Math.sqrt(agent.covariance[0]) * size, ry: 2 * Math.sqrt(agent.covariance[1]) * size, fill: COLORS[id], 'fill-opacity': selected === id ? .06 : .015, stroke: COLORS[id], 'stroke-width': selected === id ? 2.2 : 1.3, 'stroke-dasharray': ['none', '7 4', '2 4'][id], opacity: selected === id ? 1 : .65 }));
      if (run.history.length > 1) svg.append(element('polyline', { 'data-fusion-trail': id, points: run.history.map((sample) => `${X(sample.means[id][0])},${Y(sample.means[id][1])}`).join(' '), fill: 'none', stroke: COLORS[id], 'stroke-width': 1.7, 'stroke-dasharray': ['none', '6 3', '2 3'][id], opacity: .7 }));
    }
    const tx = X(run.truth[0]), ty = Y(run.truth[1]);
    svg.append(element('path', { 'data-fusion-truth': '', d: `M${tx - 9},${ty}H${tx + 9}M${tx},${ty - 9}V${ty + 9}`, stroke: '#eff5f1', 'stroke-width': 3, fill: 'none' }));
    svg.append(element('text', { x: tx - 13, y: ty + 25, fill: '#eff5f1', 'font-size': 16, 'text-anchor': 'end' }, 'T'));
    for (const agent of run.agents) {
      const id = agent.id, cx = X(agent.mean[0]), cy = Y(agent.mean[1]);
      const group = element('g', { 'data-fusion-estimate': id, 'data-x': agent.mean[0], 'data-y': agent.mean[1], 'data-selected': String(id === selected), fill: 'none', stroke: COLORS[id], 'stroke-width': 2.5 });
      if (id === 0) group.append(element('circle', { cx, cy, r: 5 }));
      if (id === 1) group.append(element('path', { d: `M${cx},${cy - 10}L${cx + 10},${cy}L${cx},${cy + 10}L${cx - 10},${cy}Z` }));
      if (id === 2) group.append(element('rect', { x: cx - 11, y: cy - 11, width: 22, height: 22 }));
      group.append(element('text', { x: cx + LABEL_OFFSETS[id][0], y: cy + LABEL_OFFSETS[id][1], fill: COLORS[id], stroke: 'none', 'font-size': 16, 'font-weight': selected === id ? 700 : 500, 'text-anchor': id === 0 ? 'end' : 'start' }, `A${id + 1}`));
      svg.append(group);
    }
    svg.append(element('text', { x: 380, y: 589, fill: '#a7beb1', 'font-size': 13, 'text-anchor': 'middle' }, 'Position estimates (m) · y increases upward · marker heights have no meaning'));
  }
  function disposeWorld() {
    if (!world) return;
    const previous = world; world = undefined;
    previous.controls.removeEventListener('change', drawThree); previous.controls.dispose(); releaseGroup(previous.scene); previous.renderer.dispose();
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'fusion-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let renderer, scene, controls;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute('aria-label', '3D display of the same planar target estimates and uncertainty contours. Drag to orbit, scroll to zoom. Marker heights are decorative.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same fusion run in 2D.'); });
      scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = false;
      controls.minDistance = 5; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI / 2 - .15;
      const content = new THREE.Group(); scene.add(content);
      const overlay = document.createElement('div'); overlay.className = 'fusion-labels'; overlay.setAttribute('aria-hidden', 'true');
      const labels = run.agents.map((agent) => {
        const node = document.createElement('span'); node.textContent = `A${agent.id + 1}`; node.dataset.agent = agent.id; node.className = 'fusion-agent-label'; node.style.color = COLORS[agent.id]; overlay.append(node); return node;
      });
      const truthLabel = document.createElement('span'); truthLabel.textContent = 'T'; truthLabel.className = 'fusion-truth-label'; truthLabel.style.color = '#eff5f1'; overlay.append(truthLabel);
      layer.replaceChildren(renderer.domElement, overlay);
      world = { THREE, renderer, scene, camera, controls, content, labels, truthLabel, seed: null, anchors: [], truthAnchor: null };
      controls.addEventListener('change', drawThree); updateThree(); resize();
    } catch {
      controls?.dispose(); if (scene) releaseGroup(scene); renderer?.dispose(); world = undefined;
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D view and fusion controls remain available.');
    } finally { loading = false; }
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    const { THREE } = world, { low, high, width, height } = bounds();
    releaseGroup(world.content);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: '#19372f', side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((low[0] + high[0]) / 2, -.015, -(low[1] + high[1]) / 2); world.content.add(floor);
    const grid = [];
    for (let x = low[0]; x <= high[0]; x += 1) grid.push(new THREE.Vector3(x, 0, -low[1]), new THREE.Vector3(x, 0, -high[1]));
    for (let y = low[1]; y <= high[1]; y += 1) grid.push(new THREE.Vector3(low[0], 0, -y), new THREE.Vector3(high[0], 0, -y));
    world.content.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid), new THREE.LineBasicMaterial({ color: '#3c6252' })));
    const line = (points, color, { loop = false, opacity = 1 } = {}) => {
      const result = new THREE[loop ? 'LineLoop' : 'Line'](new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
      world.content.add(result); return result;
    };
    world.anchors = run.agents.map((agent) => {
      const id = agent.id, [x, y] = agent.mean, altitude = .08 + id * .025;
      const circle = (rx, ry, z) => Array.from({ length: 72 }, (_, index) => { const angle = index * Math.PI * 2 / 72; return new THREE.Vector3(x + Math.cos(angle) * rx, z, -y - Math.sin(angle) * ry); });
      line(circle(2 * Math.sqrt(agent.covariance[0]), 2 * Math.sqrt(agent.covariance[1]), .035 + id * .01), COLORS[id], { loop: true, opacity: id === selected ? 1 : .55 });
      if (run.history.length > 1) line(run.history.map((sample) => new THREE.Vector3(sample.means[id][0], .045 + id * .01, -sample.means[id][1])), COLORS[id], { opacity: .65 });
      if (id === 0) line(circle(.08, .08, altitude), COLORS[id], { loop: true });
      else {
        const points = id === 1 ? [[0, -.16], [.16, 0], [0, .16], [-.16, 0]] : [[-.18, -.18], [.18, -.18], [.18, .18], [-.18, .18]];
        line(points.map(([dx, dy]) => new THREE.Vector3(x + dx, altitude, -y - dy)), COLORS[id], { loop: true });
      }
      return new THREE.Vector3(x, altitude, -y);
    });
    const [tx, ty] = run.truth;
    line([new THREE.Vector3(tx - .15, .14, -ty), new THREE.Vector3(tx + .15, .14, -ty)], '#eff5f1');
    line([new THREE.Vector3(tx, .14, -ty - .15), new THREE.Vector3(tx, .14, -ty + .15)], '#eff5f1');
    world.truthAnchor = new THREE.Vector3(tx, .14, -ty);
    if (world.seed !== run.initial.seed) {
      const cx = (low[0] + high[0]) / 2, cy = -(low[1] + high[1]) / 2, span = Math.max(width, height);
      world.camera.position.set(cx + span * .08, span * 1.1, cy + span * .86);
      world.controls.target.set(cx, 0, cy); world.controls.update(); world.seed = run.initial.seed;
    }
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const place = (anchor, label) => {
      if (!anchor) return;
      const point = anchor.clone().project(world.camera);
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`; label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    };
    world.anchors.forEach((anchor, id) => { world.labels[id].style.fontWeight = id === selected ? '700' : '400'; place(anchor, world.labels[id]); });
    place(world.truthAnchor, world.truthLabel);
  }
  function resize() {
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, observer = 0) { if (disposed) return; run = state; selected = observer; drawSvg(); updateThree(); },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown fusion view.');
      if (disposed) return;
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed; resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); container.replaceChildren(); },
  };
}
