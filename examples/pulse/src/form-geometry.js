import {resampleClosed, mixPaths, rotatePoint, projectPoint, pathData} from './path-geometry.js';
import {ease} from './motion.js';

export const COUNT = 192;
const RADIUS = 190;
const circle = Array.from({length: 768}, (_, i) => {
  const a = i / 768 * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0];
});
const knot = Array.from({length: 1024}, (_, i) => {
  const a = i / 1024 * Math.PI * 2;
  return [70 * (Math.sin(a) + 2 * Math.sin(2 * a)), 70 * (Math.cos(a) - 2 * Math.cos(2 * a)), -95 * Math.sin(3 * a)];
});
export const SHAPES = {
  circle: resampleClosed(circle, COUNT),
  triangle: resampleClosed([[0, -RADIUS, 0], [RADIUS * Math.sqrt(3) / 2, RADIUS / 2, 0], [-RADIUS * Math.sqrt(3) / 2, RADIUS / 2, 0]], COUNT),
  square: resampleClosed([[0, -165, 0], [165, -165, 0], [165, 165, 0], [-165, 165, 0], [-165, -165, 0]], COUNT),
  knot: resampleClosed(knot, COUNT),
};

export function shapeAt(seconds) {
  const t = Math.max(0, Math.min(seconds, 13.5));
  let points = SHAPES.circle;
  if (t >= 3 && t < 6) points = mixPaths(SHAPES.circle, SHAPES.triangle, ease((t - 3) / 2.2));
  else if (t >= 6 && t < 9) points = mixPaths(SHAPES.triangle, SHAPES.square, ease((t - 6) / 2));
  else if (t >= 9) points = mixPaths(SHAPES.square, SHAPES.knot, ease((t - 9) / 2.4));
  let rotation = Math.max(0, t - 9);
  if (rotation > 3.5) {
    const stop = Math.min(1, rotation - 3.5);
    rotation = 3.5 + stop - stop * stop / 2;
  }
  return points.map(p => rotatePoint(p, rotation * 0.48, rotation * 0.19));
}

export function formAt(seconds) {
  const t = Math.max(0, Math.min(seconds, 13.5));
  const projected = shapeAt(t).map(p => projectPoint(p));
  if (projected.some(p => p === null)) throw new Error('Composition entered the near plane');
  const d = pathData(projected);
  const segments = projected.map((p, i) => {
    const next = projected[(i + 1) % COUNT];
    const depth = (p[2] + next[2]) / 2;
    const interiorA = p.map((v, axis) => v + (next[axis] - v) * 0.18);
    const interiorB = p.map((v, axis) => v + (next[axis] - v) * 0.82);
    return {id: i, depth,
      d: `M${p[0].toFixed(3)},${p[1].toFixed(3)} L${next[0].toFixed(3)},${next[1].toFixed(3)}`,
      eraseD: `M${interiorA[0].toFixed(3)},${interiorA[1].toFixed(3)} L${interiorB[0].toFixed(3)},${interiorB[1].toFixed(3)}`};
  }).sort((a, b) => b.depth - a.depth);
  return {d, segments, reveal: ease(t / 2.4), depth: ease((t - 9.5) / 1.2), phase: t < 3 ? '01 / DRAW' : t < 9 ? '02 / TRANSFORM' : '03 / DEPTH'};
}
