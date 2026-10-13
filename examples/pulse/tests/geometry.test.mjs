import test from 'node:test';
import assert from 'node:assert/strict';
import {resampleClosed, mixPaths, signedAreaXY, rotatePoint, projectPoint} from '../src/path-geometry.js';
import {SHAPES, COUNT, shapeAt, formAt} from '../src/form-geometry.js';

test('closed resampling rejects degenerate paths and invalid counts', () => {
  assert.throws(() => resampleClosed([[0, 0, 0], [0, 0, 0], [0, 0, 0]], 12));
  assert.throws(() => resampleClosed([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 2));
  assert.throws(() => mixPaths(SHAPES.circle, SHAPES.circle.slice(1), 0.5));
});

test('square resampling covers the closing edge at equal spacing', () => {
  const points = resampleClosed([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 40);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    assert.ok(Math.abs(Math.hypot(...a.map((v, k) => v - b[k])) - 1) < 1e-9);
  }
});

test('morph targets share count, winding and an explicit upper anchor', () => {
  for (const points of Object.values(SHAPES)) assert.equal(points.length, COUNT);
  for (const name of ['circle', 'triangle', 'square']) {
    assert.ok(signedAreaXY(SHAPES[name]) > 0);
    assert.ok(Math.abs(SHAPES[name][0][0]) < 1e-9);
    assert.ok(SHAPES[name][0][1] < 0);
  }
});

test('rotation preserves lengths and near-plane rejection prevents streaks', () => {
  const point = [120, -30, 70], rotated = rotatePoint(point, 0.7, 1.1);
  assert.ok(Math.abs(Math.hypot(...point) - Math.hypot(...rotated)) < 1e-9);
  assert.equal(projectPoint([0, 0, -899]), null);
  assert.throws(() => projectPoint([120, 60]));
  assert.deepEqual(projectPoint([120, 60, 0]), [120, 60, 0]);
});

test('all frames stay finite, inside the composition and depth-sorted', () => {
  for (let frame = 0; frame < 900; frame += 3) {
    for (const point of shapeAt(frame / 60)) {
      const p = projectPoint(point);
      assert.ok(p && p.every(Number.isFinite));
      assert.ok(Math.abs(p[0]) < 560 && Math.abs(p[1]) < 248);
    }
    const state = formAt(frame / 60);
    assert.ok(!/NaN|Infinity/.test(state.d));
    for (let i = 1; i < state.segments.length; i++) assert.ok(state.segments[i - 1].depth >= state.segments[i].depth);
  }
});

test('SVG state supports random seeking, phase continuity and a stable tail', () => {
  const state = formAt(7.2); formAt(0); formAt(13);
  assert.deepEqual(formAt(7.2), state);
  for (const time of [3, 6, 9]) {
    const a = shapeAt(time - 1e-6), b = shapeAt(time + 1e-6);
    assert.ok(Math.max(...a.flatMap((p, i) => p.map((v, k) => Math.abs(v - b[i][k])))) < 0.001);
  }
  assert.deepEqual(formAt(13.5), formAt(899 / 60));
});
