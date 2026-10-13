// Original pure geometry helpers. See references/path-morph.md for provenance.
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/** @param {number[][]} points @param {number} count */
export function resampleClosed(points, count) {
  if (!Number.isInteger(count) || count < 3) throw new Error('Sample count must be an integer >= 3');
  if (points.length < 3 || points.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Expected finite 3D vertices');
  const edges = points.map((p, i) => ({a: p, b: points[(i + 1) % points.length], length: distance(p, points[(i + 1) % points.length])})).filter(e => e.length > 1e-10);
  const total = edges.reduce((sum, e) => sum + e.length, 0);
  if (total <= 1e-10) throw new Error('Path must have nonzero length');
  let edge = 0, travelled = 0;
  return Array.from({length: count}, (_, i) => {
    const target = total * i / count;
    while (edge < edges.length - 1 && target > travelled + edges[edge].length) travelled += edges[edge++].length;
    const e = edges[edge], u = (target - travelled) / e.length;
    return e.a.map((v, axis) => v + (e.b[axis] - v) * u);
  });
}

/** @param {number[][]} a @param {number[][]} b @param {number} amount */
export function mixPaths(a, b, amount) {
  if (a.length !== b.length || a.length < 3 || !Number.isFinite(amount)) throw new Error('Paths must share sample count');
  return a.map((p, i) => p.map((v, axis) => v + (b[i][axis] - v) * amount));
}

/** @param {number[][]} points */
export function signedAreaXY(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

/** @param {number[]} p @param {number} yaw @param {number} pitch */
export function rotatePoint(p, yaw, pitch) {
  const x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
  const z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
  return [x, p[1] * Math.cos(pitch) - z * Math.sin(pitch), p[1] * Math.sin(pitch) + z * Math.cos(pitch)];
}

/** @param {number[]} point @param {{distance?:number,focal?:number,near?:number}} options */
export function projectPoint(point, {distance: camera = 900, focal = 900, near = 40} = {}) {
  const denominator = camera + point[2];
  if (point.length !== 3 || !point.every(Number.isFinite) || ![camera, focal, near].every(Number.isFinite) || near <= 0 || focal <= 0) throw new Error('Invalid projection input');
  if (denominator <= near) return null;
  return [point[0] * focal / denominator, point[1] * focal / denominator, point[2]];
}

/** @param {number[][]} points */
export function pathData(points) {
  if (points.length < 3) throw new Error('Closed SVG path needs >= 3 points');
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ') + ' Z';
}
