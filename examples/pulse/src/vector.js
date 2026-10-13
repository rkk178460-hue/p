import {ease, clamp} from './motion.js';
import {palette} from './palette.js';
import {cameraAt, validateCameraKeys} from './camera.js';

// Seconds are shared across focal x/y and zoom. Repeated values create holds.
export const CAMERA_KEYS = [
  {time: 0, x: 0, y: 0, zoom: 2.1},
  {time: 2.2, x: 0, y: 0, zoom: 2.1},
  {time: 3.4, x: 260, y: -40, zoom: 1.05},
  {time: 4.4, x: 620, y: -170, zoom: 0.9},
  {time: 5.2, x: 1160, y: -80, zoom: 1.25},
  {time: 6.4, x: 1160, y: -80, zoom: 1.25},
  {time: 7.0, x: 1630, y: 100, zoom: 0.8},
  {time: 8.2, x: 2440, y: 60, zoom: 1.05},
  {time: 9.8, x: 2440, y: 60, zoom: 1.05},
  {time: 12.0, x: 1240, y: 0, zoom: 0.38},
  {time: 15.0, x: 1240, y: 0, zoom: 0.38},
];
validateCameraKeys(CAMERA_KEYS);

const INPUT_ROUTE = [[0, 0], [360, 240], [810, -420], [1160, -80]];
const fieldPoint = (q, r) => [2440 + (q + r / 2) * 42, 60 + r * 36.373];
export const OUTPUT_ROUTES = [-4, 0, 4].map((row) => {
  const endpoint = fieldPoint(Math.max(-6, -6 - row), row);
  const dy = endpoint[1] - 60;
  return [[1160, -80], [1500, -80 + dy], [1870, endpoint[1]], endpoint];
});

/** @param {number[][]} curve @param {number} p */
export const pointOnCurve = (curve, p) => {
  const u = 1 - p;
  return [0, 1].map((axis) => u ** 3 * curve[0][axis] + 3 * u * u * p * curve[1][axis]
    + 3 * u * p * p * curve[2][axis] + p ** 3 * curve[3][axis]);
};

export const FIELD = [];
for (let r = -6; r <= 6; r++) {
  for (let q = -6; q <= 6; q++) {
    const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    const [x, y] = fieldPoint(q, r);
    if (ring <= 6) FIELD.push({q, r, ring, x, y});
  }
}
const FIELD_INDEX = new Map(FIELD.map((node) => [`${node.q},${node.r}`, node]));
const EDGES = FIELD.flatMap((node) => [[1, 0], [0, 1], [-1, 1]].map(([dq, dr]) => {
  const other = FIELD_INDEX.get(`${node.q + dq},${node.r + dr}`);
  return other ? [node, other] : null;
}).filter(Boolean));

function strokeCurve(ctx, curve, color, width, start = 0, end = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const point = pointOnCurve(curve, start + (end - start) * i / 64);
    i ? ctx.lineTo(...point) : ctx.moveTo(...point);
  }
  ctx.stroke();
}

function signal(ctx, curve, progress) {
  const head = clamp(progress);
  strokeCurve(ctx, curve, palette.accent, 4, Math.max(0, head - 0.15), head);
  const point = pointOnCurve(curve, head);
  ctx.fillStyle = palette.foreground;
  ctx.beginPath(); ctx.arc(...point, 7, 0, 2 * Math.PI); ctx.fill();
}

function emitter(ctx, t) {
  ctx.save();
  ctx.rotate(Math.min(t, 5) * 0.4);
  const gather = ease(t / 2);
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = 0.4 + k * 0.18;
    ctx.strokeStyle = k === 1 ? palette.accent : palette.foreground;
    ctx.lineWidth = k === 1 ? 2.5 : 1;
    ctx.beginPath(); ctx.arc(0, 0, 68 + k * 28, k * 0.7, k * 0.7 + Math.PI * 1.65 * gather); ctx.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * 2 * Math.PI;
    const r = 142 - 30 * gather;
    ctx.globalAlpha = 0.75; ctx.fillStyle = i % 6 === 0 ? palette.accent : palette.foreground;
    ctx.fillRect(Math.cos(a) * r - 1.5, Math.sin(a) * r - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1; ctx.fillStyle = palette.accent;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}

function gate(ctx, t) {
  ctx.save(); ctx.translate(1160, -80);
  const activated = ease((t - 5.15) / 0.7);
  ctx.rotate(0.2 + activated * Math.PI / 3);
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = k === 1 ? palette.accent : palette.foreground;
    ctx.globalAlpha = 0.4 + 0.5 * activated; ctx.lineWidth = k === 1 ? 2.5 : 1.2;
    const radius = 80 + k * 22;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = i / 6 * 2 * Math.PI + k * activated * 0.18;
      const p = [Math.cos(a) * radius, Math.sin(a) * radius];
      i ? ctx.lineTo(...p) : ctx.moveTo(...p);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.arc(0, 0, 5 + activated * 3, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}

function lattice(ctx, t) {
  const reveal = (node) => ease((t - 7.98 - node.ring * 0.14) / 0.6);
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#8999a2';
  for (const [a, b] of EDGES) {
    const opacity = Math.min(reveal(a), reveal(b));
    // A restrained dormant scaffold keeps the destination visible on arrival.
    ctx.globalAlpha = 0.08 + opacity * 0.67;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  FIELD.forEach((node, i) => {
    const progress = reveal(node);
    const radius = 1.5 + 4.5 * progress;
    ctx.globalAlpha = 0.08 + 0.92 * progress; ctx.fillStyle = i % 11 === 0 ? palette.accent : palette.foreground;
    ctx.beginPath(); ctx.moveTo(node.x, node.y - radius);
    ctx.lineTo(node.x + radius, node.y); ctx.lineTo(node.x, node.y + radius);
    ctx.lineTo(node.x - radius, node.y); ctx.closePath(); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

export function drawVector(ctx, frame, w, h, fps = 60) {
  const t = Math.min(frame / fps, 13.2); // End on a stable editor hold.
  const camera = cameraAt(t, CAMERA_KEYS);
  ctx.setTransform(w / 1280, 0, 0, h / 720, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.lineCap = 'round';
  ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 1280, 720);
  ctx.save();
  ctx.translate(640, 360); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);
  ctx.fillStyle = '#20282e';
  for (let x = -480; x <= 3120; x += 120) {
    for (let y = -600; y <= 600; y += 120) ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 0.85;
  strokeCurve(ctx, INPUT_ROUTE, '#7b8b96', 2.2);
  OUTPUT_ROUTES.forEach((curve) => strokeCurve(ctx, curve, '#7b8b96', 2.2));
  ctx.globalAlpha = 1;
  emitter(ctx, t); gate(ctx, t); lattice(ctx, t);
  if (t >= 2.9 && t < 5.25) signal(ctx, INPUT_ROUTE, ease((t - 2.9) / 2.35));
  if (t >= 6.15 && t < 8.3) {
    OUTPUT_ROUTES.forEach((curve, i) => signal(ctx, curve, ease((t - 6.15 - i * 0.08) / 1.95)));
  }
  ctx.restore();
  ctx.globalAlpha = 1; ctx.fillStyle = palette.foreground; ctx.font = '32px PulseMono';
  ctx.fillText('V E C T O R', 56, 68);
  ctx.fillStyle = palette.accent; ctx.fillRect(56, 88, 24, 2);
  ctx.fillStyle = palette.muted; ctx.font = '16px PulseMono';
  ctx.fillText(t < 5.2 ? '01 / IMPULSE' : t < 8.2 ? '02 / TRANSFER' : '03 / FIELD', 56, 666);
  ctx.textAlign = 'right'; ctx.fillText('ONE CONTINUOUS WORLD', 1224, 666); ctx.textAlign = 'left';
}
