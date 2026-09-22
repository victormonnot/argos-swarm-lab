import './workshop-scene.css';

/** Display-only components for the early planar workshops. No simulation state. */
export function createWorkshopDrone(THREE, { color = '#70d8bf', size = 1, ghost = false, id = 'A1' } = {}) {
  const drone = new THREE.Group();
  drone.name = `${id}-${ghost ? 'estimate' : 'quadrotor'}`;
  const material = (tint, options = {}) => new THREE.MeshStandardMaterial({
    color: tint, roughness: .55, metalness: .2, wireframe: ghost,
    transparent: ghost, opacity: ghost ? .65 : 1, depthWrite: !ghost, ...options,
  });
  const shell = material(color), dark = material(ghost ? color : '#17322c'),
    metal = material(ghost ? color : '#9eb9b1', { metalness: .65, roughness: .35 }),
    pale = material(ghost ? color : '#e0e8d2');
  const mesh = (geometry, mat, position, parent = drone) => {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...position); object.castShadow = !ghost; object.receiveShadow = !ghost;
    parent.add(object); return object;
  };
  const box = (dimensions, mat, position, parent) => mesh(new THREE.BoxGeometry(...dimensions), mat, position, parent);
  const cylinder = (radius, height, mat, position, parent) => mesh(new THREE.CylinderGeometry(radius, radius, height, 12), mat, position, parent);
  const beam = (start, end, radius, mat) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), mat, a.clone().add(b).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  };
  box([.34, .12, .23], shell, [0, 0, 0]).name = 'airframe-shell';
  box([.23, .035, .19], pale, [-.015, .078, 0]);
  if (!ghost) box([.24, .06, .17], dark, [-.02, -.085, 0]);
  const rotors = [];
  for (const [x, z] of [[-.28, -.28], [-.28, .28], [.28, -.28], [.28, .28]]) {
    beam([x * .3, -.015, z * .25], [x, .015, z], .023, dark);
    cylinder(.052, .08, metal, [x, .035, z]);
    const rotor = new THREE.Group(); rotor.position.set(x, .092, z); drone.add(rotor); rotors.push(rotor);
    box([.33, .009, .032], dark, [0, 0, 0], rotor).name = 'propeller';
    cylinder(.026, .022, pale, [0, .011, 0], rotor);
    const ring = mesh(new THREE.RingGeometry(.157, .17, 32), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: ghost ? .65 : .23, side: THREE.DoubleSide, depthWrite: false,
    }), [x, .091, z]);
    ring.rotation.x = -Math.PI / 2; ring.castShadow = false; ring.receiveShadow = false;
  }
  for (const z of [-.16, .16]) {
    for (const x of [-.11, .11]) beam([x, -.06, z * .55], [x, -.18, z], .012, metal);
    beam([-.18, -.18, z], [.18, -.18, z], .014, dark);
  }
  const camera = mesh(new THREE.SphereGeometry(.045, 12, 8), metal, [.14, -.1, 0]); camera.name = 'camera-housing';
  const lens = cylinder(.027, .04, dark, [.185, -.105, 0]); lens.rotation.z = Math.PI / 2;
  if (!ghost) {
    const glass = mesh(new THREE.CircleGeometry(.021, 16), material('#75c6c6', { roughness: .12 }), [.207, -.105, 0]);
    glass.rotation.y = Math.PI / 2;
  }
  // The motor-center radius plus rotor radius is the maximum planar footprint.
  drone.scale.setScalar(size / (2 * (Math.hypot(.28, .28) + .17)));
  drone.userData = { rotors, bodyMaterial: shell, bodyColor: new THREE.Color(color), inactiveColor: new THREE.Color('#73817b'), active: true,
    displayDiameter: size, ghost, headingConvention: 'front +X, rotation about display +Y' };
  return drone;
}

export function setWorkshopDrone(drone, { position, heading = 0, phase = 0, active = true } = {}) {
  if (position) drone.position.set(...position);
  drone.rotation.y = heading;
  drone.userData.rotors.forEach((rotor, index) => { rotor.rotation.y = (index % 2 ? -1 : 1) * phase + index * .7; });
  if (drone.userData.active !== active) {
    drone.userData.bodyMaterial.color.copy(active ? drone.userData.bodyColor : drone.userData.inactiveColor);
    drone.userData.active = active;
  }
}

/** Decorative frame lies outside the declared playable rectangle. */
export function createWorkshopStage(THREE, scene, renderer, { center = [0, 0], size = [12, 10], grid = 1 } = {}) {
  const [cx, cz] = center, [width, depth] = size;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const stage = new THREE.Group(); stage.name = 'illustrative-workshop-yard'; scene.add(stage);
  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, ...options });
  const floor = material('#4b685d'), edge = material('#203c32'), trim = material('#829582'), metal = material('#597a6c');
  const box = (dimensions, mat, position) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), mat); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; stage.add(mesh); return mesh;
  };
  box([width + .8, .28, depth + .8], edge, [cx, -.22, cz]);
  box([width, .1, depth], floor, [cx, -.055, cz]);
  const gridPoints = [];
  for (let x = -width / 2; x <= width / 2 + 1e-6; x += grid) gridPoints.push(cx + x, .003, cz - depth / 2, cx + x, .003, cz + depth / 2);
  for (let z = -depth / 2; z <= depth / 2 + 1e-6; z += grid) gridPoints.push(cx - width / 2, .003, cz + z, cx + width / 2, .003, cz + z);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  stage.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#a2bba2', transparent: true, opacity: .14 })));
  for (const side of [-1, 1]) {
    box([width + .5, .11, .12], trim, [cx, -.015, cz + side * (depth / 2 + .22)]);
    box([.12, .11, depth + .5], trim, [cx + side * (width / 2 + .22), -.015, cz]);
  }
  // Short corner fixtures establish scale without adding inner obstacle geometry.
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const px = cx + x * (width / 2 + .22), pz = cz + z * (depth / 2 + .22);
    box([.18, .48, .18], metal, [px, .24, pz]);
    box([.2, .065, .2], material('#cee4c8', { emissive: '#779d7d', emissiveIntensity: .3 }), [px, .49, pz]);
  }
  const hemi = new THREE.HemisphereLight('#d5f1e7', '#26362c', 2); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffedcc', 3.2);
  const span = Math.max(width, depth);
  sun.position.set(cx - span * .3, span, cz + span * .45); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: .1, far: span * 4 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .025; sun.shadow.bias = -.00015;
  scene.add(sun, sun.target);
  return stage;
}

export function addWorkshopCameraUI(layer, { prefix, caption, onWhole, onFollow }) {
  const controls = Object.assign(document.createElement('div'), { className: 'workshop-camera-controls' });
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '3D camera framing');
  const wholeButton = Object.assign(document.createElement('button'), { id: `${prefix}-camera-whole`, type: 'button', textContent: 'Whole site' });
  const followButton = Object.assign(document.createElement('button'), { id: `${prefix}-camera-follow`, type: 'button', textContent: 'Follow selected' });
  wholeButton.title = 'Frame the experiment without changing its state';
  followButton.title = 'Inspect the selected drone without changing its state';
  wholeButton.addEventListener('click', onWhole); followButton.addEventListener('click', onFollow);
  controls.append(wholeButton, followButton);
  const note = Object.assign(document.createElement('div'), { className: 'workshop-scene-caption', textContent: caption });
  layer.append(controls, note);
  const setFollowing = following => {
    wholeButton.setAttribute('aria-pressed', String(!following)); followButton.setAttribute('aria-pressed', String(following));
  };
  setFollowing(false);
  return { wholeButton, followButton, setFollowing, setFollowLabel: text => { followButton.textContent = text; } };
}
