// Shared world-coordinate camera. Original implementation; mechanism informed
// by Promptible's MIT cinematic-camera skill. See references/continuous-camera.md.
const smooth = (v) => v * v * (3 - 2 * v);

/** @param {{time:number,x:number,y:number,zoom:number}[]} keys */
export function validateCameraKeys(keys) {
  if (keys.length < 2) throw new Error('Camera requires at least two keys');
  keys.forEach((key, i) => {
    if (![key.time, key.x, key.y, key.zoom].every(Number.isFinite)) throw new Error('Camera keys must be finite');
    if (key.zoom <= 0) throw new Error('Zoom must be positive');
    if (i && key.time <= keys[i - 1].time) throw new Error('Key times must be strictly increasing');
  });
}

/**
 * Evaluate seconds, never wall-clock time. Validate the static keys once.
 * @param {number} time
 * @param {{time:number,x:number,y:number,zoom:number}[]} keys
 */
export function cameraAt(time, keys) {
  if (!Number.isFinite(time)) throw new Error('Camera time must be finite');
  const first = keys[0], last = keys[keys.length - 1];
  if (time <= first.time) return {x: first.x, y: first.y, zoom: first.zoom};
  if (time >= last.time) return {x: last.x, y: last.y, zoom: last.zoom};
  const end = keys.findIndex((key) => key.time > time);
  const a = keys[end - 1], b = keys[end];
  const u = smooth((time - a.time) / (b.time - a.time));
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    // Geometric zoom: equal relative changes at equal progress.
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * u),
  };
}

/** @param {[number,number]} point @param {{x:number,y:number,zoom:number}} camera @param {[number,number]} size */
export function worldToScreen(point, camera, size) {
  return [size[0] / 2 + camera.zoom * (point[0] - camera.x),
    size[1] / 2 + camera.zoom * (point[1] - camera.y)];
}

/** @param {[number,number]} point @param {{x:number,y:number,zoom:number}} camera @param {[number,number]} size */
export function screenToWorld(point, camera, size) {
  return [camera.x + (point[0] - size[0] / 2) / camera.zoom,
    camera.y + (point[1] - size[1] / 2) / camera.zoom];
}
