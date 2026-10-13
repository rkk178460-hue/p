import test from 'node:test';
import assert from 'node:assert/strict';
import {draw} from '../src/draw.js';
import {drawParallax, drawMaskTrails} from '../src/studies.js';
import {drawVector} from '../src/vector.js';

// Record actual painter operations, independent of React or a browser.
function recorder() {
  const operations = [];
  const ctx = new Proxy({}, {
    set(target, key, value) { operations.push([key, value]); target[key] = value; return true; },
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        operations.push([key, ...args]);
        if (key === 'createRadialGradient') return {addColorStop: (...a) => operations.push(['addColorStop', ...a])};
      };
    },
  });
  return {ctx, operations};
}

test('all painters produce the same operations after arbitrary seeking', () => {
  for (const painter of [draw, drawParallax, drawMaskTrails, drawVector]) {
    const {ctx, operations} = recorder();
    painter(ctx, 120, 1920, 1080, 60);
    const expected = JSON.stringify(operations);
    painter(ctx, 239, 1920, 1080, 60);
    painter(ctx, 0, 1920, 1080, 60);
    operations.length = 0;
    painter(ctx, 120, 1920, 1080, 60);
    assert.equal(JSON.stringify(operations), expected);
  }
});

test('parallax loop has identical endpoint drawing operations', () => {
  const a = recorder(), b = recorder();
  drawParallax(a.ctx, 0, 1920, 1080, 60);
  drawParallax(b.ctx, 360, 1920, 1080, 60);
  assert.deepEqual(a.operations, b.operations);
});

test('Vector ends with an identical drawing hold', () => {
  const a = recorder(), b = recorder();
  drawVector(a.ctx, 720, 1920, 1080, 60);
  drawVector(b.ctx, 899, 1920, 1080, 60);
  assert.deepEqual(a.operations, b.operations);
});
