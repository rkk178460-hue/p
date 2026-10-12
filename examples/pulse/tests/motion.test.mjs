import test from 'node:test';
import assert from 'node:assert/strict';
import {clamp, ease, mod, layerOffset, phases} from '../src/motion.js';
test('study timelines meet their intended loop endpoints', () => {
  for (const ratio of [0, 0.5, 1, 3]) assert.equal(layerOffset(1280, ratio, 640), layerOffset(0, ratio, 640));
  for (const speed of [72, 144, 216]) assert.equal(mod(4 * speed, 144), 0);
});
test('reverse camera wraps correctly across repeated layers', () => {
  for (const camera of [-4000, -10, 0, 10, 4000]) {
    for (const ratio of [0, 0.5, 1, 3]) {
      const x = layerOffset(camera, ratio, 640);
      assert.ok(x >= 0 && x < 640);
      assert.equal(layerOffset(camera + 1280, ratio, 640), x);
    }
  }
  assert.equal(mod(-1, 28), 27);
});
test('random frame seeking has no inherited state', () => {
  const snapshot = phases(7);
  phases(14); phases(0); phases(4);
  assert.deepEqual(phases(7), snapshot);
  for (let f = 0; f < 900; f++) {
    for (const value of Object.values(phases(f / 60))) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  assert.equal(phases(0).fade, 0); assert.equal(phases(15).fade, 0);
  assert.equal(ease(-10), 0); assert.equal(clamp(10), 1);
});
