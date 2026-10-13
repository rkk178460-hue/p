import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraAt, validateCameraKeys, worldToScreen, screenToWorld} from '../src/camera.js';
import {CAMERA_KEYS, FIELD, OUTPUT_ROUTES} from '../src/vector.js';

test('camera validation rejects invalid key times and zoom', () => {
  assert.throws(() => validateCameraKeys([]));
  assert.throws(() => validateCameraKeys([{time: 0, x: 0, y: 0, zoom: 1}, {time: 0, x: 1, y: 0, zoom: 1}]));
  assert.throws(() => validateCameraKeys([{time: 0, x: 0, y: 0, zoom: 1}, {time: 1, x: 1, y: 0, zoom: 0}]));
  assert.doesNotThrow(() => validateCameraKeys(CAMERA_KEYS));
});

test('camera focus remains in the viewport centre at every zoom', () => {
  for (let frame = 0; frame < 900; frame += 7) {
    const camera = cameraAt(frame / 60, CAMERA_KEYS);
    assert.deepEqual(worldToScreen([camera.x, camera.y], camera, [1280, 720]), [640, 360]);
    const point = [1370, -90];
    const restored = screenToWorld(worldToScreen(point, camera, [1280, 720]), camera, [1280, 720]);
    assert.ok(Math.abs(restored[0] - point[0]) < 1e-9 && Math.abs(restored[1] - point[1]) < 1e-9);
  }
});

test('zoom interpolates geometrically, holds are stable and fps-independent', () => {
  const keys = [{time: 0, x: 0, y: 0, zoom: 1}, {time: 2, x: 100, y: 20, zoom: 4}];
  assert.deepEqual(cameraAt(1, keys), {x: 50, y: 10, zoom: 2});
  assert.deepEqual(cameraAt(60 / 30, CAMERA_KEYS), cameraAt(120 / 60, CAMERA_KEYS));
  assert.deepEqual(cameraAt(12, CAMERA_KEYS), cameraAt(14.99, CAMERA_KEYS));
});

test('final camera includes all three stations inside the safe frame', () => {
  const camera = cameraAt(15, CAMERA_KEYS);
  for (const p of [[-142, 0], [1160, -204], [2692, 60], [2440, -158], [2440, 278]]) {
    const [x, y] = worldToScreen(p, camera, [1280, 720]);
    assert.ok(x > 64 && x < 1216 && y > 112 && y < 608);
  }
});

test('each connection terminates on an actual receiving node', () => {
  for (const route of OUTPUT_ROUTES) {
    const [x, y] = route.at(-1);
    assert.ok(FIELD.some((node) => node.x === x && node.y === y), 'Floating connection endpoint');
  }
});
