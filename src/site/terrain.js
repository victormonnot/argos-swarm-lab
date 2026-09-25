/*
 * ARGOS home illustration — schematic artwork only.
 * The analytic terrain, routes and aircraft below are a static illustration.
 * They do not represent workshop output, flight telemetry or a physical model.
 * Redraw explicitly after a resize, layer change or camera interaction.
 * yaw and pitch are camera angles in radians; panX/panY are viewport fractions.
 * Camera changes only project this fixed artwork: no simulation state advances.
 */
const defaults = {
  accent: '#d94b40',
  link: '#91adbf',
  surface: '#10100f',
  bone: '#e8e2d5',
  taupe: '#a49b8c',
  layer: 'routes',
  detail: 'contours',
  yaw: 0,
  pitch: 0.45,
  panX: 0,
  panY: 0,
};

function terrain(x, z) {
  const hill = (cx, cz, width, height) =>
    height * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / width);
  const ridgeline = 0.042 * Math.sin(x * 12 + z * 7) +
    0.025 * Math.cos(z * 18 - x * 8) + 0.011 * Math.sin(x * 29 + z * 23);
  const mass = hill(-0.65, -0.59, 0.16, 0.72) +
    hill(0.08, -0.72, 0.23, 0.43) + hill(0.7, 0.44, 0.18, 0.5);
  return 0.045 + mass + ridgeline * Math.min(1, mass * 2.5);
}

// World geometry is immutable and shared by all redraws. In particular, orbiting
// never resamples the analytic surface or reruns marching squares.
let illustration;
function getIllustration() {
  if (illustration) return illustration;
  const ground = (x, z, offset = 0) => [x, z, terrain(x, z) + offset];
  const boundary = [];
  for (let i = 0; i <= 70; i++) boundary.push(ground(-1 + i / 35, -1));
  for (let i = 1; i <= 70; i++) boundary.push(ground(1, -1 + i / 35));
  for (let i = 1; i <= 70; i++) boundary.push(ground(1 - i / 35, 1));
  for (let i = 1; i <= 70; i++) boundary.push(ground(-1, 1 - i / 35));
  const sides = [
    { normal: [0, 1], start: [-1, 1], end: [1, 1] },
    { normal: [1, 0], start: [1, -1], end: [1, 1] },
    { normal: [0, -1], start: [1, -1], end: [-1, -1] },
    { normal: [-1, 0], start: [-1, 1], end: [-1, -1] },
  ].map(side => ({ ...side, top: Array.from({ length: 71 }, (_, i) =>
    ground(side.start[0] + (side.end[0] - side.start[0]) * i / 70,
      side.start[1] + (side.end[1] - side.start[1]) * i / 70)) }));
  const mesh = [];
  for (let i = 0; i <= 32; i++) {
    const fixed = -1 + i / 16;
    const row = [], column = [];
    for (let j = 0; j <= 110; j++) {
      const moving = -1 + j / 55;
      row.push(ground(moving, fixed));
      column.push(ground(fixed, moving));
    }
    mesh.push(row, column);
  }
  // The cell-center average resolves ambiguous saddle cells consistently.
  const cells = 84;
  const values = Array.from({ length: cells + 1 }, (_, iz) =>
    Array.from({ length: cells + 1 }, (_, ix) => terrain(-1 + ix * 2 / cells, -1 + iz * 2 / cells)));
  const contours = [];
  for (let levelIndex = 0; levelIndex < 27; levelIndex++) {
    const level = 0.058 + levelIndex * 0.026;
    const segments = [];
    for (let iz = 0; iz < cells; iz++) {
      for (let ix = 0; ix < cells; ix++) {
        const x = -1 + ix * 2 / cells, z = -1 + iz * 2 / cells;
        const step = 2 / cells;
        const corners = [[x, z], [x + step, z], [x + step, z + step], [x, z + step]];
        const elevations = [values[iz][ix], values[iz][ix + 1], values[iz + 1][ix + 1], values[iz + 1][ix]];
        const hits = [];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4;
          if ((elevations[edge] > level) === (elevations[next] > level)) continue;
          const f = (level - elevations[edge]) / (elevations[next] - elevations[edge]);
          hits.push([corners[edge][0] + f * (corners[next][0] - corners[edge][0]),
            corners[edge][1] + f * (corners[next][1] - corners[edge][1]), level]);
        }
        if (hits.length === 4 && elevations.reduce((a, b) => a + b, 0) / 4 > level) hits.push(hits.shift());
        segments.push(...hits);
      }
    }
    contours.push({ heavy: levelIndex % 4 === 0, segments });
  }
  const nodes = [[-0.86, 0.62], [-0.12, 0.64], [0.82, -0.57], [-0.7, -0.37], [0.32, -0.89]]
    .map(([x, z]) => ground(x, z, 0.006));
  const aircraft = [
    { x: -0.55, z: 0.43, name: 'A1', rise: 0.22 },
    { x: 0.24, z: 0.40, name: 'A2', rise: 0.26 },
    { x: -0.13, z: -0.50, name: 'A3', rise: 0.22 },
  ].map(a => ({ ...a, ground: terrain(a.x, a.z), y: terrain(a.x, a.z) + a.rise }));
  // Each curve is hand-composed; no planning or control algorithm is implied.
  const routes = [
    [[-0.82, 0.91], [-0.78, 0.77], [-0.70, 0.68], [-0.61, 0.62], [-0.55, 0.43]],
    [[0.63, 0.88], [0.47, 0.78], [0.33, 0.64], [0.28, 0.51], [0.24, 0.40]],
    [[0.87, -0.63], [0.59, -0.63], [0.30, -0.57], [0.05, -0.53], [-0.13, -0.50]],
  ].map(route => {
    const points = [];
    for (let i = 0; i < route.length - 1; i++) {
      for (let t = 0; t < 1; t += 0.04) {
        const x = route[i][0] + (route[i + 1][0] - route[i][0]) * t;
        const z = route[i][1] + (route[i + 1][1] - route[i][1]) * t;
        points.push(ground(x, z, 0.012));
      }
    }
    points.push(ground(...route[route.length - 1], 0.012));
    return { points, start: ground(...route[0], 0.01) };
  });
  // A radial envelope fits every yaw at a given pitch, avoiding camera zoom
  // changes as the terrain turns. The default retains the original bounds.
  const envelope = [...mesh.flat(), ...boundary.map(([x, z]) => [x, z, -0.11]),
    ...aircraft.flatMap(a => [-1, 1].flatMap(sx => [-1, 1].map(sz =>
      [a.x + sx * 0.18, a.z + sz * 0.18, a.y + 0.036])))].map(([x, z, y]) =>
    [Math.hypot(x, z) * Math.SQRT2, y]);
  illustration = { boundary, sides, mesh, contours, nodes, aircraft, routes, envelope };
  return illustration;
}

export function drawArgosTerrain(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const settings = { ...defaults, ...options };
  const scene = getIllustration();
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const yaw = finite(settings.yaw, defaults.yaw);
  const pitch = Math.max(0.18, Math.min(1.1, finite(settings.pitch, defaults.pitch)));
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  const groundScale = 0.31 * Math.sin(pitch) / Math.sin(defaults.pitch);
  const heightScale = 0.92 * Math.cos(pitch) / Math.cos(defaults.pitch);
  const depth = (x, z, y = 0) =>
    ((cosine + sine) * x + (cosine - sine) * z) * Math.cos(pitch) * 0.31 / Math.sin(defaults.pitch) +
      y * Math.sin(pitch) * 0.92 / Math.cos(defaults.pitch);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.clientWidth || 600);
  const height = Math.max(1, rect.height || canvas.clientHeight || 480);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  let top = -1.105, bottom = 0.785;
  for (const [radius, y] of scene.envelope) {
    top = Math.min(top, -radius * groundScale - y * heightScale);
    bottom = Math.max(bottom, radius * groundScale - y * heightScale);
  }
  // Preserve the initial framing, and recenter gradually for a steeper view.
  // Framing depends on pitch, never yaw, so an orbit does not pulse in size.
  const steepness = Math.max(0, (pitch - defaults.pitch) / (1.1 - defaults.pitch));
  const centerY = -0.16 + steepness * ((top + bottom) / 2 + 0.16);
  const span = 2 * Math.max(centerY - top, bottom - centerY);
  const scale = Math.max(0.1, Math.min((width - 24) / 3.28, (height - 54) / 1.89,
    (height - 24) / span));
  const origin = [width * (0.5 + finite(settings.panX, 0)),
    height * (0.5 + finite(settings.panY, 0)) - scale * centerY];
  const screen = (x, z, y = 0) => {
    const rotatedX = x * cosine - z * sine, rotatedZ = x * sine + z * cosine;
    return [origin[0] + (rotatedX - rotatedZ) * 0.78 * scale,
      origin[1] + ((rotatedX + rotatedZ) * groundScale - y * heightScale) * scale];
  };
  const project = points => points.map(point => screen(...point));
  const line = (points, color, alpha = 1, weight = 1, closed = false) => {
    if (!points.length) return;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
    if (closed) context.closePath();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = weight;
    context.stroke();
  };
  const fill = (points, color, alpha = 1) => {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(point => context.lineTo(point[0], point[1]));
    context.closePath();
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.fill();
  };
  const ring = (x, z, y, radius, color, alpha = 1, weight = 1) => {
    const points = [];
    for (let step = 0; step <= 44; step++) {
      const angle = (step / 44) * Math.PI * 2;
      points.push(screen(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, y));
    }
    line(points, color, alpha, weight);
  };

  context.lineCap = 'round';
  context.lineJoin = 'round';

  // A quiet base establishes the terrain as one continuous spatial object.
  const boundary = project(scene.boundary);
  fill(boundary, settings.surface, 0.98);

  // Select the geological cutaway faces pointing toward the current camera.
  const visibleSides = scene.sides.filter(side =>
    depth(...side.normal) > 1e-8);
  for (const side of visibleSides) {
    const baseStart = screen(...side.start, -0.11), baseEnd = screen(...side.end, -0.11);
    fill([...project(side.top), baseEnd, baseStart], settings.surface);
    line([baseStart, baseEnd], settings.taupe, 0.25, 0.65);
  }
  const visibleCorners = new Map();
  for (const side of visibleSides) {
    visibleCorners.set(side.start.join(','), side.top[0]);
    visibleCorners.set(side.end.join(','), side.top[side.top.length - 1]);
  }
  for (const corner of visibleCorners.values()) {
    line([screen(...corner), screen(corner[0], corner[1], -0.11)], settings.taupe, 0.3, 0.65);
  }

  // Sampled curves reveal surface shape; they are not a geographic map.
  const meshAlpha = settings.detail === 'mesh' ? 0.38 : 0.12;
  for (const curve of scene.mesh) line(project(curve), settings.taupe, meshAlpha, 0.55);

  // Equal-height contours are computed once, then projected for each camera.
  if (settings.detail !== 'mesh') {
    for (const { heavy, segments } of scene.contours) {
      context.beginPath();
      for (let i = 0; i + 1 < segments.length; i += 2) {
        context.moveTo(...screen(...segments[i]));
        context.lineTo(...screen(...segments[i + 1]));
      }
      context.globalAlpha = heavy ? 0.6 : 0.36;
      context.lineWidth = heavy ? 0.82 : 0.56;
      context.strokeStyle = heavy ? settings.bone : settings.taupe;
      context.stroke();
    }
  }
  line(boundary, settings.taupe, 0.34, 0.75, true);

  // Intentional sparse nodes help read the ground without adding false HUD data.
  for (const point of scene.nodes) {
    const p = screen(...point);
    context.globalAlpha = 0.56;
    context.fillStyle = settings.bone;
    context.fillRect(p[0] - 1, p[1] - 1, 2, 2);
  }

  const aircraft = scene.aircraft;
  if (settings.layer === 'network') {
    for (const [a, b] of [[aircraft[0], aircraft[1]], [aircraft[1], aircraft[2]], [aircraft[2], aircraft[0]]]) {
      line([screen(a.x, a.z, a.y), screen(b.x, b.z, b.y)], settings.link, 0.76, 1.05);
    }
  } else {
    for (const route of scene.routes) {
      line(project(route.points), settings.accent, 0.88, 1.15);
      ring(...route.start, 0.028, settings.accent, 0.8, 0.9);
    }
  }

  // The aircraft are wireframe objects with a filled body, four arms and rotors.
  function drawAircraft(a) {
    context.setLineDash([2, 4]);
    line([screen(a.x, a.z, a.ground + 0.01), screen(a.x, a.z, a.y - 0.016)], settings.bone, 0.37, 0.7);
    context.setLineDash([]);
    ring(a.x, a.z, a.ground + 0.014, 0.105, settings.accent, 0.5, 0.8);
    const body = [
      [-0.036, -0.071], [0.036, -0.071], [0.048, 0.048],
      [0.024, 0.073], [-0.024, 0.073], [-0.048, 0.048],
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = a.x + sx * 0.112, z = a.z + sz * 0.112;
        const arm = [
          screen(a.x + sx * 0.025, a.z + sz * 0.04, a.y),
          screen(x, z, a.y + 0.006),
        ];
        line(arm, settings.bone, 0.86, 2.2);
        line(arm, settings.surface, 0.9, 0.6);
        ring(x, z, a.y + 0.016, 0.059, settings.bone, 0.9, 0.8);
        ring(x, z, a.y + 0.016, 0.049, settings.taupe, 0.28, 0.55);
        line([screen(x - 0.038, z, a.y + 0.016), screen(x + 0.038, z, a.y + 0.016)], settings.bone, 0.32, 0.65);
        const center = screen(x, z, a.y + 0.016);
        context.globalAlpha = 0.95;
        context.fillStyle = settings.bone;
        context.beginPath();
        context.arc(center[0], center[1], 1.2, 0, Math.PI * 2);
        context.fill();
      }
    }
    const bottom = body.map(([x, z]) => screen(a.x + x, a.z + z, a.y - 0.02));
    const top = body.map(([x, z]) => screen(a.x + x, a.z + z, a.y + 0.026));
    fill(bottom, settings.surface);
    line(bottom, settings.taupe, 0.8, 0.75, true);
    fill(top, settings.surface);
    line(top, settings.bone, 0.9, 1, true);
    for (const i of [2, 3, 4, 5]) line([top[i], bottom[i]], settings.bone, 0.65, 0.7);
    line([screen(a.x - 0.024, a.z - 0.02, a.y + 0.028), screen(a.x + 0.024, a.z - 0.02, a.y + 0.028)], settings.accent, 1, 1.7);
    const anchor = screen(a.x, a.z, a.y + 0.036);
    line([[anchor[0], anchor[1] - 5], [anchor[0], anchor[1] - 28], [anchor[0] + 8, anchor[1] - 28]], settings.taupe, 0.52, 0.7);
    context.globalAlpha = 1;
    context.fillStyle = settings.bone;
    context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.fillText(a.name, anchor[0] + 12, anchor[1] - 24);
  }
  [...aircraft].sort((a, b) => depth(a.x, a.z, a.y) - depth(b.x, b.z, b.y)).forEach(drawAircraft);
  context.globalAlpha = 1;
  context.setLineDash([]);
}
