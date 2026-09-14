import './graph-view.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LOW_COLOR = [99, 212, 192];
const HIGH_COLOR = [243, 172, 120];

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function number(value) {
  return Math.abs(value) >= 10000 ? value.toExponential(1) : value.toFixed(2);
}

function normalized(value, initialValues) {
  const min = Math.min(...initialValues);
  const span = Math.max(...initialValues) - min;
  return span === 0 ? 0.5 : Math.max(0, Math.min(1, (value - min) / span));
}

function color(value, initialValues) {
  const fraction = normalized(value, initialValues);
  const rgb = LOW_COLOR.map((low, index) => Math.round(low + fraction * (HIGH_COLOR[index] - low)));
  return `rgb(${rgb.join(',')})`;
}

/** Both renderers observe snapshots; neither advances or changes the experiment. */
export function createGraphView(container, { onSelectAgent = () => {} } = {}) {
  let snapshot = null;
  let mode = '2d';
  let three = null;
  let unavailable = false;
  let disposed = false;
  let loading = null;
  let THREE;
  let OrbitControls;

  const root = document.createElement('div');
  root.className = 'graph-view';
  root.dataset.mode = mode;
  const stage = document.createElement('div');
  stage.className = 'graph-stage';
  const svg = svgElement('svg', { class: 'graph-svg', role: 'group', 'aria-label': 'Communication graph. Select an agent to inspect its information.' });
  const guides = svgElement('g', { class: 'graph-guides', 'aria-hidden': 'true' });
  const links = svgElement('g', { class: 'graph-links', 'aria-hidden': 'true' });
  const nodes = svgElement('g');
  svg.append(guides, links, nodes);
  const threeLayer = document.createElement('div');
  threeLayer.className = 'graph-three';
  threeLayer.hidden = true;
  const labels = document.createElement('div');
  labels.className = 'graph-three-labels';
  const corner = document.createElement('span');
  corner.className = 'graph-corner';
  corner.textContent = 'ABSTRACT NETWORK';
  const hint = document.createElement('p');
  hint.className = 'graph-hint';
  const scale = document.createElement('div');
  scale.className = 'graph-scale';
  const minimum = document.createElement('span');
  const gradient = document.createElement('span');
  gradient.className = 'graph-scale-gradient';
  gradient.setAttribute('aria-hidden', 'true');
  const maximum = document.createElement('span');
  scale.append(minimum, gradient, maximum);
  stage.append(svg, threeLayer, corner, scale);
  root.append(stage, hint);
  container.append(root);

  const svgNodes = Array.from({ length: 6 }, (_, index) => {
    const group = svgElement('g', { class: 'graph-node', role: 'button', tabindex: '0', 'data-agent': index });
    const halo = svgElement('circle', { r: 34, class: 'graph-node-halo' });
    const disc = svgElement('circle', { r: 28, class: 'graph-node-disc' });
    const name = svgElement('text', { y: -8, class: 'graph-node-name', 'text-anchor': 'middle' });
    name.textContent = `A${index + 1}`;
    const value = svgElement('text', { y: 11, class: 'graph-node-value', 'text-anchor': 'middle' });
    group.append(halo, disc, name, value);
    group.addEventListener('click', () => onSelectAgent(index));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelectAgent(index);
      }
    });
    nodes.append(group);
    return { group, value };
  });

  function renderSvg() {
    if (!snapshot) return;
    const width = Math.max(330, stage.clientWidth);
    const height = stage.clientHeight || 350;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const radiusX = Math.min(205, width * 0.33);
    const radiusY = Math.min(116, height * 0.32);
    const centerY = height * 0.52;
    const positions = snapshot.values.map((_, index) => {
      const angle = (-150 + index * 60) * Math.PI / 180;
      return [width / 2 + radiusX * Math.cos(angle), centerY + radiusY * Math.sin(angle)];
    });
    guides.replaceChildren(svgElement('ellipse', {
      cx: width / 2, cy: centerY, rx: radiusX, ry: radiusY,
      fill: 'none', stroke: 'currentColor', 'stroke-dasharray': '2 7',
    }));
    links.replaceChildren(...snapshot.edges.map(([a, b]) => svgElement('line', {
      x1: positions[a][0], y1: positions[a][1], x2: positions[b][0], y2: positions[b][1],
      class: a === snapshot.selectedAgent || b === snapshot.selectedAgent ? 'graph-link is-neighbor' : 'graph-link',
    })));
    svgNodes.forEach(({ group, value }, index) => {
      group.setAttribute('transform', `translate(${positions[index].join(' ')})`);
      group.style.setProperty('--node-color', color(snapshot.values[index], snapshot.initialValues));
      group.classList.toggle('is-selected', index === snapshot.selectedAgent);
      group.setAttribute('aria-pressed', String(index === snapshot.selectedAgent));
      group.setAttribute('aria-label', `Agent A${index + 1}, value ${number(snapshot.values[index])}. Inspect agent.`);
      value.textContent = number(snapshot.values[index]);
    });
  }

  function renderThree() {
    if (!three || mode !== '3d' || disposed || unavailable) return;
    const { renderer, scene, camera, meshes } = three;
    renderer.render(scene, camera);
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    meshes.forEach(({ sphere, label }) => {
      const point = sphere.position.clone().project(camera);
      label.style.left = `${(point.x * 0.5 + 0.5) * width}px`;
      label.style.top = `${(-point.y * 0.5 + 0.5) * height}px`;
      label.hidden = point.z < -1 || point.z > 1;
    });
  }

  function showUnavailable(reason = 'This view needs WebGL 2. Switch to 2D to keep exploring the same experiment.') {
    unavailable = true;
    const message = document.createElement('div');
    message.className = 'graph-unavailable';
    message.setAttribute('role', 'status');
    const title = document.createElement('strong');
    title.textContent = '3D is unavailable in this browser';
    const detail = document.createElement('p');
    detail.textContent = reason;
    message.append(title, detail);
    threeLayer.replaceChildren(message);
  }

  async function prepareThree() {
    if (three || loading || unavailable || disposed) return;
    const message = document.createElement('div');
    message.className = 'graph-unavailable';
    message.setAttribute('role', 'status');
    message.textContent = 'Loading the 3D view…';
    threeLayer.replaceChildren(message);
    loading = Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
    try {
      const [library, controls] = await loading;
      if (disposed) return;
      THREE = library;
      OrbitControls = controls.OrbitControls;
      threeLayer.replaceChildren();
      // A quick return to 2D must not create or reveal a stale 3D view.
      if (mode === '3d') createThree();
    } catch {
      if (!disposed) showUnavailable('The 3D resources could not load. Switch to 2D to keep exploring the same experiment.');
    } finally {
      loading = null;
    }
  }

  function createThree() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      showUnavailable();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x101f22, 0);
    renderer.domElement.setAttribute('aria-label', '3D graph. Drag to orbit; scroll or pinch to zoom. Agent values are also available in the state table.');
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      showUnavailable();
    });
    threeLayer.append(renderer.domElement, labels);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(5.9, 7.9, -1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.9, 0);
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 19;
    controls.minPolarAngle = 0.16;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.update();
    // No animation loop: camera events and new snapshots request a render.
    controls.addEventListener('change', renderThree);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 7, 4);
    scene.add(key);
    const grid = new THREE.GridHelper(9, 18, 0x35504f, 0x243b3c);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(90, 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x9ebcb5, transparent: true, opacity: 0.62 });
    const network = new THREE.LineSegments(linkGeometry, lineMaterial);
    scene.add(network);
    const groundGeometry = new THREE.BufferGeometry();
    groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(90, 3));
    const groundMaterial = new THREE.LineBasicMaterial({ color: 0x6a9691, transparent: true, opacity: 0.3 });
    const ground = new THREE.LineSegments(groundGeometry, groundMaterial);
    scene.add(ground);
    const sphereGeometry = new THREE.SphereGeometry(0.17, 24, 16);
    const ringGeometry = new THREE.TorusGeometry(0.26, 0.012, 6, 40);
    const meshes = Array.from({ length: 6 }, (_, index) => {
      const sphere = new THREE.Mesh(sphereGeometry, new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 }));
      const angle = (-150 + index * 60) * Math.PI / 180;
      sphere.position.set(Math.cos(angle) * 2.3, 0.3, Math.sin(angle) * 2.3);
      const stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x90b4ad, transparent: true, opacity: 0.4 }));
      const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xedf3ef }));
      ring.rotation.x = -Math.PI / 2;
      const footprint = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), new THREE.MeshBasicMaterial({ color: 0x789a93 }));
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.set(sphere.position.x, 0.013, sphere.position.z);
      scene.add(sphere, stem, ring, footprint);
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'graph-three-label';
      label.addEventListener('click', () => onSelectAgent(index));
      labels.append(label);
      return { sphere, stem, ring, label };
    });
    three = { renderer, scene, camera, controls, meshes, network, ground };
    resizeThree();
    updateThree();
  }

  function updateThree() {
    if (!three || !snapshot || unavailable) return;
    const { meshes, network, ground } = three;
    meshes.forEach(({ sphere, stem, ring, label }, index) => {
      sphere.position.y = 0.3 + 2.6 * normalized(snapshot.values[index], snapshot.initialValues);
      sphere.material.color.set(color(snapshot.values[index], snapshot.initialValues));
      stem.geometry.setFromPoints([new THREE.Vector3(sphere.position.x, 0.02, sphere.position.z), sphere.position]);
      ring.position.copy(sphere.position);
      ring.visible = index === snapshot.selectedAgent;
      label.textContent = `A${index + 1} · ${number(snapshot.values[index])}`;
      label.style.setProperty('--node-color', color(snapshot.values[index], snapshot.initialValues));
      label.classList.toggle('is-selected', index === snapshot.selectedAgent);
      label.setAttribute('aria-pressed', String(index === snapshot.selectedAgent));
      label.setAttribute('aria-label', `Inspect agent A${index + 1}, value ${number(snapshot.values[index])}`);
    });
    const linePoints = snapshot.edges.flatMap(([a, b]) => [meshes[a].sphere.position, meshes[b].sphere.position]);
    // Six agents have at most 15 undirected links. Reuse their GPU buffers.
    const networkPositions = network.geometry.getAttribute('position');
    const groundPositions = ground.geometry.getAttribute('position');
    linePoints.forEach((point, index) => {
      networkPositions.setXYZ(index, point.x, point.y, point.z);
      groundPositions.setXYZ(index, point.x, 0.018, point.z);
    });
    for (const geometry of [network.geometry, ground.geometry]) {
      geometry.getAttribute('position').needsUpdate = true;
      geometry.setDrawRange(0, linePoints.length);
      geometry.computeBoundingSphere();
    }
    renderThree();
  }

  function resizeThree() {
    if (!three || unavailable) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    three.renderer.setSize(width, height, false);
    three.camera.aspect = width / height;
    three.camera.updateProjectionMatrix();
    renderThree();
  }

  function updateCaption() {
    corner.textContent = mode === '3d' ? 'ABSTRACT 3D' : 'ABSTRACT NETWORK';
    hint.textContent = mode === '2d'
      ? 'Select an agent to inspect its neighbors. Positions are a layout; color encodes value.'
      : 'Drag to orbit · scroll or pinch to zoom. Height and color encode value; this is not physical motion.';
    if (snapshot) {
      minimum.textContent = number(Math.min(...snapshot.initialValues));
      maximum.textContent = number(Math.max(...snapshot.initialValues));
      scale.setAttribute('aria-label', `Fixed value scale from ${minimum.textContent} to ${maximum.textContent}, based on the initial values.`);
      scale.title = 'Value scale fixed to the initial minimum and maximum';
    }
  }

  const observer = new ResizeObserver(() => {
    renderSvg();
    resizeThree();
  });
  observer.observe(stage);
  updateCaption();

  return {
    update(nextSnapshot) {
      snapshot = nextSnapshot;
      renderSvg();
      updateThree();
      updateCaption();
    },
    setMode(nextMode) {
      if (nextMode !== '2d' && nextMode !== '3d') throw new Error('Unknown graph view mode');
      mode = nextMode;
      root.dataset.mode = mode;
      svg.hidden = mode !== '2d';
      // SVG does not consistently honor the HTML hidden property.
      svg.style.display = mode === '2d' ? '' : 'none';
      threeLayer.hidden = mode !== '3d';
      if (mode === '3d' && !three && !unavailable) void prepareThree();
      if (three) three.controls.enabled = mode === '3d' && !unavailable;
      resizeThree();
      updateCaption();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      if (three) {
        three.controls.dispose();
        const geometries = new Set();
        const materials = new Set();
        three.scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (object.material) {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        three.renderer.dispose();
      }
      root.remove();
    },
  };
}
