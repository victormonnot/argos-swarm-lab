const NS = 'http://www.w3.org/2000/svg';
const AGENT_COLORS = ['#72dabb', '#f1c17d', '#91adff'];
const TASK_COLORS = { pending: '#758982', assigned: '#c7cec1', servicing: '#e7b976', completed: '#74cba4' };
const X = (value) => 380 + value * 51;
const Y = (value) => 495 - value * 51;
function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Display only: both projections consume the same mission snapshot/history. */
export function createMissionView(container, { selectAgent = () => {} } = {}) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false;
  const svg = element('svg', { viewBox: '0 0 760 570', class: 'mission-map-svg', role: 'group', 'aria-label': 'Mission map in metres. Select an agent to inspect its executor.' });
  const layer = document.createElement('div'); layer.className = 'mission-three'; layer.hidden = true;
  container.append(svg, layer);

  function drawSvg() {
    if (!run) return;
    const focus = svg.contains(document.activeElement) ? document.activeElement.dataset.missionAgent : null;
    svg.replaceChildren();
    for (let x = -6; x <= 6; x += 1) {
      svg.append(element('line', { x1: X(x), x2: X(x), y1: 60, y2: 540, stroke: '#2b443f', 'stroke-width': .6 }));
      if (x % 2 === 0) svg.append(element('text', { x: X(x), y: 560, fill: '#9bb5a8', 'font-size': 14, 'text-anchor': 'middle' }, x));
    }
    for (let y = 0; y <= 8; y += 2) {
      svg.append(element('line', { x1: 55, x2: 710, y1: Y(y), y2: Y(y), stroke: '#2b443f', 'stroke-width': .6 }));
      svg.append(element('text', { x: 35, y: Y(y) + 5, fill: '#9bb5a8', 'font-size': 14 }, y));
    }
    svg.append(element('text', { x: 701, y: 560, fill: '#9bb5a8', 'font-size': 14 }, 'm'));
    for (const agent of run.agents) {
      svg.append(element('polyline', { points: run.history.map((point) => `${X(point.positions[agent.id][0])},${Y(point.positions[agent.id][1])}`).join(' '), fill: 'none', stroke: AGENT_COLORS[agent.id], 'stroke-width': 2, opacity: .55 }));
      if (agent.taskId !== null) {
        const task = run.tasks[agent.taskId];
        svg.append(element('line', { x1: X(agent.position[0]), y1: Y(agent.position[1]), x2: X(task.position[0]), y2: Y(task.position[1]), stroke: AGENT_COLORS[agent.id], 'stroke-width': 1.5, 'stroke-dasharray': '6 6' }));
      }
    }
    for (const task of run.tasks) {
      const x = X(task.position[0]), y = Y(task.position[1]);
      svg.append(element('rect', { x: x - 10, y: y - 10, width: 20, height: 20, rx: 2, fill: task.state === 'completed' ? TASK_COLORS.completed : '#19312c', stroke: TASK_COLORS[task.state], 'stroke-width': 2 }));
      if (task.state === 'completed') svg.append(element('text', { x, y: y + 5, fill: '#14372b', 'font-size': 16, 'text-anchor': 'middle' }, '✓'));
      svg.append(element('text', { x: x + 17, y: y + 5, fill: TASK_COLORS[task.state], 'font-size': 16 }, `T${task.id + 1}`));
    }
    for (const agent of run.agents) {
      const x = X(agent.position[0]), y = Y(agent.position[1]), color = AGENT_COLORS[agent.id];
      const group = element('g', { tabindex: 0, role: 'button', class: 'mission-agent-node', 'data-mission-agent': agent.id,
        'aria-label': `Inspect agent A${agent.id + 1}, ${agent.state}`, 'aria-pressed': String(selected === agent.id) });
      if (selected === agent.id) group.append(element('circle', { cx: x, cy: y, r: 19, fill: 'none', stroke: '#eff7ed', 'stroke-dasharray': '3 3' }));
      group.append(element('circle', { cx: x, cy: y, r: 10, fill: agent.state === 'unavailable' ? '#37463e' : color, stroke: color, 'stroke-width': 2 }));
      if (agent.state === 'unavailable') group.append(element('path', { d: `M${x - 7},${y - 7}L${x + 7},${y + 7}M${x + 7},${y - 7}L${x - 7},${y + 7}`, stroke: color, 'stroke-width': 2 }));
      group.append(element('text', { x: x - 14, y: y - 19, fill: color, 'font-size': 16, 'text-anchor': 'end' }, `A${agent.id + 1}${agent.state === 'unavailable' ? ' ×' : ''}`));
      group.addEventListener('click', () => selectAgent(agent.id));
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(agent.id); } });
      svg.append(group);
    }
    if (focus !== null) svg.querySelector(`[data-mission-agent="${focus}"]`)?.focus({ preventScroll: true });
  }
  function unavailable(message) {
    failed = true;
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'mission-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D view of the planar mission. Drag to orbit, scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Continue the same mission in 2D.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, .1, 100);
      camera.position.set(0, 14, 11);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, -3.5); controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI / 2 - .15; controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 2.2));
      const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(3, 10, 5); scene.add(light);
      const grid = new THREE.GridHelper(14, 14, 0x48675b, 0x29483f); grid.position.z = -3.5; scene.add(grid);
      const agents = run.agents.map((agent) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .2, 24), new THREE.MeshStandardMaterial({ color: AGENT_COLORS[agent.id] })); scene.add(mesh); return mesh;
      });
      const tasks = run.tasks.map((task) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(.35, .035, .35), new THREE.MeshBasicMaterial({ color: TASK_COLORS[task.state] }));
        mesh.position.set(task.position[0], .02, -task.position[1]); scene.add(mesh); return mesh;
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(.26, .29, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; scene.add(ring);
      const paths = new THREE.Group(); scene.add(paths);
      const overlay = document.createElement('div'); overlay.className = 'mission-labels';
      const agentLabels = agents.map((_, id) => {
        const button = document.createElement('button'); button.style.color = AGENT_COLORS[id]; button.setAttribute('aria-label', `Inspect agent A${id + 1}`);
        button.addEventListener('click', () => selectAgent(id)); overlay.append(button); return button;
      });
      const taskLabels = tasks.map(() => { const span = document.createElement('span'); overlay.append(span); return span; });
      layer.append(overlay);
      world = { THREE, renderer, scene, camera, controls, agents, tasks, ring, paths, agentLabels, taskLabels, history: null };
      controls.addEventListener('change', drawThree); updateThree(); resize();
    } catch { if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D map and mission controls remain available.'); }
    finally { loading = false; }
  }
  function updateThree() {
    if (!world || !run || failed) return;
    run.agents.forEach((agent, id) => {
      world.agents[id].position.set(agent.position[0], .13, -agent.position[1]);
      world.agents[id].material.color.set(agent.state === 'unavailable' ? '#52605b' : AGENT_COLORS[id]);
      world.agentLabels[id].textContent = `A${id + 1}${agent.state === 'unavailable' ? ' ×' : ''}`;
      world.agentLabels[id].setAttribute('aria-pressed', String(id === selected));
    });
    run.tasks.forEach((task, id) => {
      world.tasks[id].material.color.set(TASK_COLORS[task.state]);
      world.taskLabels[id].textContent = `T${id + 1}${task.state === 'completed' ? ' ✓' : ''}`;
      world.taskLabels[id].style.color = TASK_COLORS[task.state];
    });
    world.ring.position.set(run.agents[selected].position[0], .012, -run.agents[selected].position[1]);
    if (world.history !== run.history) {
      for (const child of [...world.paths.children]) { child.geometry.dispose(); child.material.dispose(); world.paths.remove(child); }
      run.agents.forEach((agent, id) => {
        const points = run.history.map((point) => new world.THREE.Vector3(point.positions[id][0], .01, -point.positions[id][1]));
        world.paths.add(new world.THREE.Line(new world.THREE.BufferGeometry().setFromPoints(points), new world.THREE.LineBasicMaterial({ color: AGENT_COLORS[id], transparent: true, opacity: .7 })));
        if (agent.taskId !== null) {
          const target = run.tasks[agent.taskId].position;
          const line = new world.THREE.Line(new world.THREE.BufferGeometry().setFromPoints([new world.THREE.Vector3(agent.position[0], .025, -agent.position[1]), new world.THREE.Vector3(target[0], .025, -target[1])]), new world.THREE.LineDashedMaterial({ color: AGENT_COLORS[id], dashSize: .12, gapSize: .12 }));
          line.computeLineDistances(); world.paths.add(line);
        }
      });
      world.history = run.history;
    }
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const place = (mesh, label) => {
      const point = mesh.position.clone().project(world.camera);
      label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`;
      label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      label.hidden = point.z < -1 || point.z > 1;
    };
    world.agents.forEach((mesh, id) => place(mesh, world.agentLabels[id]));
    world.tasks.forEach((mesh, id) => place(mesh, world.taskLabels[id]));
  }
  function resize() {
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, agent = selected) { run = state; selected = agent; drawSvg(); updateThree(); },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown mission view.');
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed;
      resize();
    },
    dispose() {
      disposed = true; observer.disconnect();
      if (world) {
        world.controls.dispose();
        world.scene.traverse((node) => { node.geometry?.dispose(); node.material?.dispose(); });
        world.renderer.dispose();
      }
      container.replaceChildren();
    },
  };
}
