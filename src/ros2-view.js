// Presentation only: both views read the same committed trace state and phase.
// The packet interpolation is illustrative; no wall-clock network timing is inferred.
const NS = 'http://www.w3.org/2000/svg';
const node = (tag, attributes = {}, text = '') => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text; return element;
};
const positions = Array.from({ length: 6 }, (_, id) => {
  const angle = -Math.PI / 2 + id * Math.PI / 3;
  return { x: Math.cos(angle) * 5.3, z: Math.sin(angle) * 4.1, sx: 380 + Math.cos(angle) * 244, sy: 245 + Math.sin(angle) * 155 };
});
const normalized = (value, initial) => {
  const min = Math.min(...initial), span = Math.max(...initial) - min;
  return span === 0 ? .5 : Math.max(0, Math.min(1, (value - min) / span));
};
const color = (value, initial) => {
  const f = normalized(value, initial);
  return `rgb(${[102, 209, 174].map((low, i) => Math.round(low + f * ([235, 178, 114][i] - low))).join(',')})`;
};
const number = value => Math.abs(value) > 9999 ? value.toExponential(1) : value.toFixed(3);

export function createRosView(container, { onSelect = () => {}, onModeChange = () => {} } = {}) {
  let snapshot, mode = '2d', world, loading = false, failed = false, disposed = false;
  let animation, progress = 1, began = 0, key = '', duration = 900;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const svg = node('svg', { class: 'ros-svg', viewBox: '0 0 760 480', role: 'group', 'aria-label': 'Recorded ROS process graph. Choose an agent to inspect the messages it received.' });
  const ground = node('g', { 'aria-hidden': 'true' }), links = node('g', { 'aria-hidden': 'true' }), control = node('g', { 'aria-hidden': 'true' }), tokens = node('g', { 'aria-hidden': 'true' }), agents = node('g');
  ground.append(node('rect', { x: 28, y: 26, width: 704, height: 422, rx: 26, fill: '#19312e', stroke: '#33584c' }));
  for (let x = 60; x <= 720; x += 30) ground.append(node('line', { x1: x, x2: x, y1: 38, y2: 436, stroke: '#5a7768', opacity: .12 }));
  for (let y = 40; y <= 440; y += 30) ground.append(node('line', { x1: 40, x2: 720, y1: y, y2: y, stroke: '#5a7768', opacity: .12 }));
  svg.append(ground, links, control, tokens, agents);
  const svgNodes = positions.map((p, id) => {
    const group = node('g', { transform: `translate(${p.sx} ${p.sy})`, tabindex: 0, role: 'button', 'data-ros-svg-agent': id });
    const box = node('rect', { x: -51, y: -32, width: 102, height: 64, rx: 8, fill: '#213f36', stroke: '#709987', 'stroke-width': 1.5 });
    const title = node('text', { y: -12, 'text-anchor': 'middle', fill: '#d7e6d4', 'font-size': 11 }, `AGENT ${id + 1}`);
    const value = node('text', { y: 8, 'text-anchor': 'middle', fill: '#a6dec4', 'font-size': 16, 'font-family': 'monospace' });
    const pid = node('text', { y: 24, 'text-anchor': 'middle', fill: '#a6beb1', 'font-size': 9 });
    group.append(box, title, value, pid); agents.append(group);
    group.addEventListener('click', () => onSelect(id));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id); } });
    return { group, box, value, pid };
  });
  const layer = Object.assign(document.createElement('div'), { className: 'ros-three', hidden: true });
  const labels = Object.assign(document.createElement('div'), { className: 'ros-labels' });
  const buttons = positions.map((_, id) => {
    const button = document.createElement('button');
    button.dataset.rosThreeAgent = id; button.addEventListener('click', () => onSelect(id)); labels.append(button); return button;
  });
  const supervisorLabel = document.createElement('span'); supervisorLabel.className = 'ros-supervisor-label'; labels.append(supervisorLabel);
  container.append(svg, layer);
  let svgPackets = [];
  function relevantPackets() {
    if (!snapshot?.exchange) return [];
    if (snapshot.phase === 'publish') return snapshot.exchange.published.map(item => ({ from: item.agent, to: item.agent, value: item.value }));
    if (['receive', 'timeout'].includes(snapshot.phase)) return snapshot.exchange.received.map(item => ({ from: item.from, to: item.agent, value: item.value }));
    return [];
  }
  function point2(packet, t) {
    const a = positions[packet.from], b = positions[packet.to];
    if (packet.from === packet.to) return [a.sx + 41, a.sy - 29];
    const dx = b.sx - a.sx, dy = b.sy - a.sy, len = Math.hypot(dx, dy), offset = 20;
    const cx = (a.sx + b.sx) / 2 - dy / len * offset, cy = (a.sy + b.sy) / 2 + dx / len * offset;
    return [(1 - t) ** 2 * a.sx + 2 * (1 - t) * t * cx + t * t * b.sx, (1 - t) ** 2 * a.sy + 2 * (1 - t) * t * cy + t * t * b.sy];
  }
  function point3(packet, t) {
    const a = positions[packet.from], b = positions[packet.to];
    if (packet.from === packet.to) return [a.x, 2.6, a.z];
    return [a.x + (b.x - a.x) * t, 1.2 + Math.sin(Math.PI * t) * 1.05, a.z + (b.z - a.z) * t];
  }
  function drawSvg() {
    if (!snapshot || disposed) return;
    links.replaceChildren(); control.replaceChildren(); tokens.replaceChildren();
    for (const [a, b] of snapshot.edges) {
      const chosen = a === snapshot.selected || b === snapshot.selected;
      links.append(node('line', { x1: positions[a].sx, y1: positions[a].sy, x2: positions[b].sx, y2: positions[b].sy, stroke: chosen ? '#a2bea5' : '#5a8873', 'stroke-width': chosen ? 2 : 1, opacity: chosen ? .8 : .3 }));
    }
    const timing = ['publish', 'commit'].includes(snapshot.phase);
    if (timing) for (const p of positions) control.append(node('line', { x1: 380, y1: 245, x2: p.sx, y2: p.sy, stroke: '#b6a9dc', 'stroke-dasharray': '3 8', opacity: .4 }));
    control.append(node('rect', { x: 314, y: 219, width: 132, height: 51, rx: 10, fill: '#3c3950', stroke: '#968ab6' }), node('text', { x: 380, y: 239, 'text-anchor': 'middle', fill: '#e1d9ef', 'font-size': 10 }, 'ROUND SUPERVISOR'), node('text', { x: 380, y: 256, 'text-anchor': 'middle', fill: '#bfb1d7', 'font-size': 10 }, `barrier / round ${snapshot.round}`));
    for (const [id, entry] of svgNodes.entries()) {
      const chosen = snapshot.selected === id;
      entry.box.setAttribute('stroke', chosen ? '#ffe2a8' : color(snapshot.values[id], snapshot.initialValues));
      entry.box.setAttribute('stroke-width', chosen ? 3 : 1.5);
      entry.value.textContent = number(snapshot.values[id]); entry.value.setAttribute('fill', color(snapshot.values[id], snapshot.initialValues));
      entry.pid.textContent = `PID ${snapshot.agents[id].pid}`;
      entry.group.setAttribute('aria-label', `A${id + 1}, committed value ${snapshot.values[id]}, recorded process ${snapshot.agents[id].pid}`);
      entry.group.setAttribute('aria-pressed', String(chosen));
    }
    svgPackets = relevantPackets().map(packet => {
      const chosen = packet.to === snapshot.selected || packet.from === packet.to;
      const marker = node('path', { d: 'M0 -5L5 0L0 5L-5 0Z', fill: chosen ? '#ffdb94' : '#8ebda7', opacity: chosen ? 1 : .25, 'data-ros-message-from': packet.from, 'data-ros-message-to': packet.to });
      tokens.append(marker); return { packet, marker };
    });
    if (snapshot.phase === 'timeout') for (const missing of snapshot.exchange.missing.filter(item => item.agent === snapshot.selected)) {
      const [x, y] = point2({ from: missing.from, to: missing.agent }, .82);
      tokens.append(node('text', { x, y, fill: '#f3a680', 'font-size': 19, 'text-anchor': 'middle' }, '×'));
    }
    drawPackets();
  }
  function drawPackets() {
    const t = .14 + .70 * progress;
    for (const { packet, marker } of svgPackets) { const p = point2(packet, t); marker.setAttribute('transform', `translate(${p[0]} ${p[1]})`); }
    if (world) for (const { packet, object } of world.packets) object.position.set(...point3(packet, t));
  }
  function releaseWorld() {
    if (!world) return;
    world.controls.dispose();
    world.geometries.forEach(geometry => geometry.dispose()); world.materials.forEach(material => material.dispose());
    world.renderer.dispose(); world = null;
  }
  function fail(message) {
    failed = true; releaseWorld(); layer.replaceChildren(); layer.hidden = true; svg.removeAttribute('hidden'); mode = '2d'; container.dataset.mode = mode;
    onModeChange('2d', `${message} The same trace remains available in 2D and the message inspector.`);
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'ros-loading', textContent: 'Preparing the process network…' }));
    let pending;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); pending = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute('aria-label', 'Abstract 3D software scene: six process blocks, neighbor channels and a timing supervisor. Committed values and actual recorded messages match the 2D view.');
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The 3D graphics context was lost.'); });
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#101f22');
      const camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
      camera.position.set(11.4, 12.5, 14.2);
      const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .8, 0);
      controls.minDistance = 8; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI / 2 - .08; controls.enableDamping = false; controls.update();
      const geometries = new Set(), materials = new Set();
      const geometry = value => { geometries.add(value); return value; };
      const mat = (color, options = {}) => { const material = new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: .25, ...options }); materials.add(material); return material; };
      const mesh = (geometry, material, position, parent = scene) => { const object = new THREE.Mesh(geometry, material); object.position.set(...position); parent.add(object); return object; };
      const cube = geometry(new THREE.BoxGeometry(1, 1, 1));
      const box = (size, material, position, parent = scene) => { const object = mesh(cube, material, position, parent); object.scale.set(...size); return object; };
      const base = mat('#2c4941'), dark = mat('#182c29'), black = mat('#0a1d1b'), metal = mat('#607b6a'), purple = mat('#72638b'), light = mat('#c4c5b0');
      const halo = new THREE.HemisphereLight('#e0f4df', '#183e34', 3); scene.add(halo);
      const sun = new THREE.DirectionalLight('#ffe9bf', 4); sun.position.set(5, 12, 8); scene.add(sun);
      const rim = new THREE.DirectionalLight('#71bcc5', 2); rim.position.set(-8, 5, -9); scene.add(rim);
      box([14.2, .35, 11.9], base, [0, -.2, 0]); box([13.9, .05, 11.6], dark, [0, 0, 0]);
      for (let x = -6; x <= 6; x++) box([.016, .008, 11.3], base, [x, .033, 0]);
      for (let z = -5; z <= 5; z++) box([13.6, .008, .016], base, [0, .033, z]);
      // A timing-only control block is deliberately distinct from the peer processes.
      box([2.7, .25, 2.3], black, [0, .13, 0]); box([2.2, .65, 1.75], purple, [0, .54, 0]);
      box([1.8, .035, 1.4], light, [0, .88, 0]);
      const controlGlow = mat('#bdadf1', { emissive: '#7d63b5', emissiveIntensity: .6 });
      for (let x = -.7; x <= .7; x += .35) box([.18, .03, .52], controlGlow, [x, .91, 0]);
      const nodes = positions.map((p, id) => {
        const group = new THREE.Group(); group.position.set(p.x, 0, p.z); scene.add(group);
        const local = mat('#80c5a6', { emissive: '#244334', emissiveIntensity: .5 });
        box([1.72, .16, 1.48], metal, [0, .12, 0], group);
        box([1.42, 1.64, 1.12], base, [0, .98, 0], group);
        box([1.28, 1.48, .06], black, [0, 1, .59], group);
        box([1.25, .12, 1.04], local, [0, 1.85, 0], group);
        for (let slot = 0; slot < 4; slot++) {
          box([.94, .11, .055], metal, [0, .47 + slot * .29, .64], group);
          box([.08, .065, .065], local, [-.54, .47 + slot * .29, .655], group);
        }
        for (let edge = 0; edge < 3; edge++) box([.065, 1.1, 1.15], dark, [-.53 + edge * .53, 1.02, 0], group);
        box([.30, 2.0, .31], black, [1.03, 1.02, 0], group);
        const valueBar = box([.23, 1, .24], local, [1.03, .58, .005], group);
        const ring = mesh(geometry(new THREE.TorusGeometry(1.05, .035, 8, 40)), local, [0, .23, 0], group); ring.rotation.x = Math.PI / 2;
        return { group, local, valueBar, ring };
      });
      const channelGroup = new THREE.Group(); scene.add(channelGroup);
      const channelMat = mat('#537e6e', { transparent: true, opacity: .32 });
      const selectedMat = mat('#b1c8a3', { transparent: true, opacity: .8, emissive: '#485c35', emissiveIntensity: .2 });
      const packetMat = mat('#efc37a', { emissive: '#9a6523', emissiveIntensity: .45 });
      const quietPacketMat = mat('#77aa91', { transparent: true, opacity: .3 });
      const packetGeometry = geometry(new THREE.OctahedronGeometry(.14));
      const packetPool = Array.from({ length: 30 }, () => { const object = mesh(packetGeometry, packetMat, [0, 0, 0]); object.visible = false; return object; });
      world = { THREE, renderer, scene, camera, controls, geometries, materials, nodes, channelGroup, channelMat, selectedMat, packetMat, quietPacketMat, packetPool, packets: [], channelKey: '', controlGlow };
      pending = null; layer.replaceChildren(renderer.domElement, labels);
      controls.addEventListener('change', renderThree);
      resize(); updateThree(); renderThree();
    } catch (error) { pending?.dispose(); if (!disposed) fail('WebGL 2 is unavailable.'); }
    finally { loading = false; }
  }
  function updateThree() {
    if (!world || !snapshot) return;
    const { THREE } = world;
    const nextKey = JSON.stringify(snapshot.edges);
    if (world.channelKey !== nextKey) {
      for (const child of [...world.channelGroup.children]) { child.geometry.dispose(); world.geometries.delete(child.geometry); world.channelGroup.remove(child); }
      for (const [a, b] of snapshot.edges) {
        const points = Array.from({ length: 25 }, (_, index) => new THREE.Vector3(...point3({ from: a, to: b }, index / 24)));
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, 28, .024, 6, false); world.geometries.add(geometry);
        const channel = new THREE.Mesh(geometry, world.channelMat); channel.userData = { a, b }; world.channelGroup.add(channel);
      }
      world.channelKey = nextKey;
    }
    for (const channel of world.channelGroup.children) channel.material = [channel.userData.a, channel.userData.b].includes(snapshot.selected) ? world.selectedMat : world.channelMat;
    world.nodes.forEach((entry, id) => {
      entry.local.color.set(color(snapshot.values[id], snapshot.initialValues));
      const height = .15 + 1.65 * normalized(snapshot.values[id], snapshot.initialValues);
      entry.valueBar.scale.y = height; entry.valueBar.position.y = .09 + height / 2;
      entry.ring.visible = snapshot.selected === id || snapshot.phase === 'commit';
      buttons[id].textContent = `A${id + 1} · ${number(snapshot.values[id])}`;
      buttons[id].setAttribute('aria-label', `Inspect A${id + 1}, value ${snapshot.values[id]}`);
      buttons[id].setAttribute('aria-pressed', String(snapshot.selected === id));
    });
    world.controlGlow.emissiveIntensity = ['publish', 'commit'].includes(snapshot.phase) ? 1.5 : .3;
    supervisorLabel.textContent = `SUPERVISOR\nround ${snapshot.round}`;
    const packets = relevantPackets();
    world.packets = packets.map((packet, index) => {
      const object = world.packetPool[index]; object.visible = true;
      object.material = packet.to === snapshot.selected || packet.from === packet.to ? world.packetMat : world.quietPacketMat;
      return { packet, object };
    });
    world.packetPool.slice(packets.length).forEach(object => { object.visible = false; });
    drawPackets(); renderThree();
  }
  function renderThree() {
    if (!world || mode !== '3d' || disposed) return;
    const width = container.clientWidth, height = container.clientHeight;
    world.nodes.forEach((entry, id) => {
      const projected = new world.THREE.Vector3(entry.group.position.x, 2.24, entry.group.position.z).project(world.camera);
      buttons[id].style.left = `${(projected.x + 1) / 2 * width}px`;
      buttons[id].style.top = `${(1 - projected.y) / 2 * height}px`;
      buttons[id].hidden = projected.z > 1;
    });
    const center = new world.THREE.Vector3(0, 1.18, 0).project(world.camera);
    supervisorLabel.style.left = `${(center.x + 1) / 2 * width}px`; supervisorLabel.style.top = `${(1 - center.y) / 2 * height}px`;
    world.renderer.render(world.scene, world.camera);
  }
  function resize() {
    if (!world) return;
    const width = container.clientWidth, height = container.clientHeight;
    world.renderer.setSize(width, height, false); world.camera.aspect = width / Math.max(1, height);
    // Narrow screens need a wider field of view to keep the software diagram framed.
    world.camera.fov = width < 500 ? 58 : 43; world.camera.updateProjectionMatrix(); renderThree();
  }
  function animate(time) {
    if (disposed) return;
    progress = reduced.matches ? 1 : Math.min(1, (time - began) / duration);
    container.dataset.packetProgress = progress; drawPackets(); renderThree();
    if (progress < 1) animation = requestAnimationFrame(animate); else animation = undefined;
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  const reduce = () => { if (reduced.matches) { cancelAnimationFrame(animation); animation = undefined; progress = 1; drawPackets(); renderThree(); } };
  reduced.addEventListener('change', reduce);
  return {
    update(next) {
      snapshot = next;
      container.dataset.case = snapshot.caseId; container.dataset.run = snapshot.runId;
      container.dataset.round = snapshot.round; container.dataset.phase = snapshot.phase;
      container.dataset.values = JSON.stringify(snapshot.values);
      const nextKey = `${snapshot.runId}:${snapshot.round}:${snapshot.phase}`;
      if (nextKey !== key) {
        key = nextKey; cancelAnimationFrame(animation); animation = undefined;
        progress = snapshot.phase === 'receive' && !reduced.matches ? 0 : 1;
        began = performance.now(); duration = snapshot.duration;
      }
      drawSvg(); updateThree();
      if (progress < 1 && animation === undefined) animation = requestAnimationFrame(animate);
    },
    setMode(next) {
      if (disposed) return;
      if (next === '3d' && failed) { fail('3D rendering is unavailable in this session.'); return; }
      mode = next; container.dataset.mode = mode;
      svg.toggleAttribute('hidden', mode !== '2d'); layer.hidden = mode !== '3d';
      onModeChange(mode); if (mode === '3d') { if (world) { resize(); renderThree(); } else prepareThree(); }
    },
    dispose() { disposed = true; cancelAnimationFrame(animation); observer.disconnect(); reduced.removeEventListener('change', reduce); releaseWorld(); },
  };
}
