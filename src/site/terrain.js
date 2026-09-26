/*
 * Original schematic artwork for the home page, not a simulated workshop run.
 * Terrain, routes and links are hand-composed visual relations. Camera changes
 * project the same fixed geometry; they never advance a model or recording.
 * Coordinates below are [x, z, height]. Camera angles are radians and pan is
 * expressed as a fraction of the viewport.
 */
const defaults = {
  theme: 'coordination',
  surface: '#f3f4f1',
  panel: '#fcfcfa',
  ink: '#273438',
  link: '#446e91',
  taupe: '#a39e91',
  structure: '#aebbb9',
  yaw: 0,
  pitch: 0.45,
  panX: 0,
  panY: 0,
};
const corners = height => [
  [-1.9, -1.65, height], [1.9, -1.65, height],
  [1.9, 1.65, height], [-1.9, 1.65, height], [-1.9, -1.65, height],
];
const elevation = (x, z) => 0.05 +
  0.36 * Math.exp(-((x + 0.6) ** 2 / 0.6 + (z - 0.2) ** 2 / 0.5)) +
  0.24 * Math.exp(-((x - 0.9) ** 2 / 0.35 + (z + 0.45) ** 2 / 0.9));
const aircraft = [
  [-1.1, -0.7, 1.21], [0.7, -0.75, 1.21],
  [1.07, 0.8, 1.21], [-0.85, 0.95, 1.21],
];
// Surface samples are reused during dragging, rather than regenerated per frame.
const mesh = [];
for (let i = 0; i <= 40; i++) {
  const x = -1.9 + i * 3.8 / 40;
  mesh.push(Array.from({ length: 49 }, (_, j) => {
    const z = -1.65 + j * 3.3 / 48;
    return [x, z, -0.59 + elevation(x, z)];
  }));
}
for (let i = 0; i <= 28; i++) {
  const z = -1.65 + i * 3.3 / 28;
  mesh.push(Array.from({ length: 57 }, (_, j) => {
    const x = -1.9 + j * 3.8 / 56;
    return [x, z, -0.59 + elevation(x, z)];
  }));
}

export function drawArgosTerrain(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const settings = { ...defaults, ...options };
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const yaw = finite(settings.yaw, 0);
  const pitch = Math.max(0.18, Math.min(1.1, finite(settings.pitch, defaults.pitch)));
  const panX = Math.max(-0.35, Math.min(0.35, finite(settings.panX, 0)));
  const panY = Math.max(-0.35, Math.min(0.35, finite(settings.panY, 0)));
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  const groundScale = 0.37 * Math.sin(pitch) / Math.sin(defaults.pitch);
  const heightScale = Math.cos(pitch) / Math.cos(defaults.pitch);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.clientWidth || 550);
  const height = Math.max(1, rect.height || canvas.clientHeight || 350);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // A circular envelope encloses the specimen at every yaw. It prevents zoom
  // pulses while rotating and keeps steep views inside the canvas at zero pan.
  const envelope = Math.hypot(1.9, 1.65) * Math.SQRT2;
  const top = -envelope * groundScale - 1.29 * heightScale;
  const bottom = envelope * groundScale + 0.64 * heightScale;
  const scale = Math.max(0.1, Math.min((width - 26) / (envelope * 1.68),
    (height - 28) / (bottom - top)));
  const origin = [width * (0.5 + panX), height * (0.5 + panY) - (top + bottom) / 2 * scale];
  const project = ([x, z, y]) => {
    const rx = x * cosine - z * sine, rz = x * sine + z * cosine;
    return [origin[0] + (rx - rz) * 0.84 * scale,
      origin[1] + ((rx + rz) * groundScale - y * heightScale) * scale];
  };
  const stroke = (points, color, weight = 1, alpha = 1) => {
    if (!points.length) return;
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(...point) : context.moveTo(...point));
    context.strokeStyle = color;
    context.lineWidth = weight;
    context.globalAlpha = alpha;
    context.stroke();
    context.globalAlpha = 1;
  };
  const line = (points, color = settings.structure, weight = 0.7, alpha = 1) =>
    stroke(points.map(project), color, weight, alpha);
  const fill = (points, color, alpha) => {
    context.beginPath();
    points.map(project).forEach((point, index) => index ? context.lineTo(...point) : context.moveTo(...point));
    context.closePath();
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.fill();
    context.globalAlpha = 1;
  };
  const dot = (point, radius, color = settings.link) => {
    context.beginPath();
    context.arc(...project(point), radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  };
  const ring = (point, radius, color = settings.link, alpha = 0.5, weight = 0.7) => {
    const points = Array.from({ length: 49 }, (_, index) => {
      const angle = index / 48 * Math.PI * 2;
      return [point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius, point[2]];
    });
    line(points, color, weight, alpha);
  };

  for (const [x, z] of corners(0).slice(0, 4)) {
    line([[x, z, -0.64], [x, z, 1.17]], settings.structure, 0.65, 0.75);
  }
  for (const y of [-0.64, 0.03, 1.17]) {
    fill(corners(y), y === 1.17 ? settings.panel : settings.surface, y === 1.17 ? 0.24 : 0.75);
    line(corners(y));
  }
  for (const points of mesh) line(points, settings.taupe, 0.6, 0.72);
  for (let i = 0; i <= 12; i++) {
    const x = -1.9 + i * 3.8 / 12;
    line([[x, -1.65, 0.03], [x, 1.65, 0.03]], settings.structure, 0.6, 0.55);
  }
  for (let i = 0; i <= 10; i++) {
    const z = -1.65 + i * 3.3 / 10;
    line([[-1.9, z, 0.03], [1.9, z, 0.03]], settings.structure, 0.6, 0.55);
  }

  const drone = (point, index) => {
    const [x, z, y] = point;
    line([[x, z, -0.25], [x, z, y - 0.05]], settings.structure, 0.65, 0.65);
    for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [0.13, 0.13], [-0.13, 0.13]]) {
      line([point, [x + dx, z + dz, y]], settings.link, 1.15);
      const rotor = Array.from({ length: 33 }, (_, i) => {
        const a = i / 32 * Math.PI * 2;
        return [x + dx + Math.cos(a) * 0.082, z + dz + Math.sin(a) * 0.082, y];
      });
      fill(rotor, settings.panel, 0.9);
      line(rotor, settings.link, 0.75);
    }
    const body = [[x - 0.045, z - 0.075, y], [x + 0.045, z - 0.075, y],
      [x + 0.045, z + 0.075, y], [x - 0.045, z + 0.075, y], [x - 0.045, z - 0.075, y]];
    fill(body, settings.panel, 1);
    line(body, settings.link, 0.8);
    dot([x, z, y + 0.025], 1.5);
    if (width >= 420) {
      const anchor = project(point);
      context.fillStyle = settings.ink;
      context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
      context.fillText(String(index + 1).padStart(2, '0'), anchor[0] + 14, anchor[1] - 14);
    }
  };

  if (settings.theme === 'motion') {
    const route = [[-1.55, 1.25, 0.08], [-0.8, 1.25, 0.08], [-0.8, 0.2, 0.08],
      [0.4, 0.2, 0.08], [0.4, -1.1, 0.08], [1.5, -1.1, 0.08]];
    line(route, settings.link, 2.1);
    for (const [x, z] of [[-0.3, -0.9], [0.55, 0.85]]) {
      const rectangle = [[-0.3, -0.25], [0.3, -0.25], [0.3, 0.25], [-0.3, 0.25], [-0.3, -0.25]];
      for (const y of [0.1, 0.65]) line(rectangle.map(([dx, dz]) => [x + dx, z + dz, y]), settings.taupe, 1);
      for (const [dx, dz] of rectangle.slice(0, 4)) {
        line([[x + dx, z + dz, 0.1], [x + dx, z + dz, 0.65]], settings.taupe, 0.8);
      }
    }
    drone([-1.55, 1.25, 0.64], 0);
    dot(route.at(-1), 3.5);
  } else if (settings.theme === 'perception') {
    const robot = [0.1, 0.35, 1.21];
    const beacons = [[-1.55, -1.1, 0.06], [1.55, -0.85, 0.06], [0.8, 1.25, 0.06]];
    beacons.forEach((point, index) => {
      dot(point, 3);
      line([point, robot], settings.link, 0.9, 0.7);
      ring([point[0], point[1], 0.045], 0.5 + index * 0.09, settings.link, 0.4);
    });
    // Fixed samples suggest a measured surface without inventing sensor output.
    for (let i = 0; i < 160; i++) {
      const x = (Math.sin(i * 71.2) * 0.5 + 0.5) * 3.6 - 1.8;
      const z = (Math.sin(i * 22.91) * 0.5 + 0.5) * 3 - 1.5;
      dot([x, z, -0.5 + elevation(x, z)], 0.7, settings.taupe);
    }
    drone(robot, 0);
  } else {
    for (let i = 0; i < aircraft.length; i++) {
      line([aircraft[i], aircraft[(i + 1) % aircraft.length]], settings.link, 1.2, 0.7);
    }
    ring(aircraft[0], 0.31, settings.link, 0.35, 0.65);
    aircraft.forEach(drone);
  }

  // Specimen registration marks contain no telemetry or implied measurements.
  for (const point of [[-1.9, -1.65, -0.64], [1.9, 1.65, -0.64]]) {
    const [x, y] = project(point);
    stroke([[x - 5, y], [x + 5, y]], settings.structure, 0.65);
    stroke([[x, y - 5], [x, y + 5]], settings.structure, 0.65);
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
}
