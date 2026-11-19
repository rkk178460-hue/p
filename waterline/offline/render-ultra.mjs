import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { encodeDisplayRows, writePNG } from './png-output.mjs';
import * as THREE from 'three/webgpu';
import { uniform, vec4, float, positionLocal, texture, textureLoad, screenCoordinate, screenUV, dot } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { create, globals } from 'webgpu';
import { bakeClouds } from './cloud-bake.mjs';
import { enhanceSource } from './enhance-source.mjs';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

const width = Number(process.env.STILL_WIDTH || 7680);
const height = Number(process.env.STILL_HEIGHT || 4320);
const samples = Number(process.env.STILL_SAMPLES || 64);
const output = path.resolve(process.env.STILL_OUTPUT || './renders/Waterline-Relit-8K.png');
const gridScale = Number(process.env.STILL_GRID_SCALE || 16);
const rings = 192 * gridScale, spokes = 320 * gridScale;
const root = path.resolve('../..');
const sourceBytes = await fs.readFile(path.join(root, 'waterline/main.js'));
const blobSha = createHash('sha1').update(Buffer.from(`blob ${sourceBytes.length}\0`)).update(sourceBytes).digest('hex');
if (blobSha !== '93b6ed4c76587b89fd91697395ea19c9c854f87e') throw Error('Source differs from deployed Waterline calibration');
// The offline mesh exceeds 65,536 vertices. Preserve the scene/shader functions,
// but promote only its geometry indices to 32-bit before importing this copy.
const sourceText = enhanceSource(sourceBytes.toString('utf8'));
await fs.writeFile('./ultra-source.mjs', sourceText);
const { makeOceanGeometry, makeSky, makeWaterMaterial, setSun, configureClouds } = await import('./ultra-source.mjs');

Object.assign(globalThis, globals);
globalThis.self = { requestAnimationFrame() { return 0; }, cancelAnimationFrame() {} };
const gpu = create(['backend=' + (process.env.WATERLINE_BACKEND || 'vulkan')]);
Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' });
if (!adapter) throw Error('Actual rasterization adapter required');
const device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: 16384, maxBufferSize: 1073741824 } });
if (Math.max(width, height) > device.limits.maxTextureDimension2D) throw Error('Output exceeds texture limit');
const errors = [];
device.addEventListener('uncapturederror', e => { errors.push(e.error.message); console.error(e.error.message); });
device.pushErrorScope('validation');
const canvas = { width, height, style: {}, addEventListener() {}, removeEventListener() {} };
const format = gpu.getPreferredCanvasFormat();
const finalTexture = device.createTexture({
  size: [width, height], format,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});
const context = { configure() {}, getCurrentTexture() { return finalTexture; } };
const renderer = new THREE.WebGPURenderer({ device, canvas, context, antialias: false, alpha: false });
await renderer.init();
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: true });
target.texture.colorSpace = THREE.LinearSRGBColorSpace;

const clock = uniform(11.25), sea = uniform(0.46);
const sun = uniform(new THREE.Vector3()), light = uniform(new THREE.Vector3());
setSun(1053, sun, light);
const sunset = light.value.y;
const sunColor = [1, 0.36 + 0.53 * (1 - sunset), 0.115 + 0.605 * (1 - sunset)];
const clouds = await bakeClouds(device, sun.value, sunColor, light.value, { volumeSize: Number(process.env.CLOUD_VOLUME || 384), envWidth: Number(process.env.CLOUD_WIDTH || 8192), envHeight: Number(process.env.CLOUD_HEIGHT || 4096), steps: Number(process.env.CLOUD_STEPS || 512) });
configureClouds(clouds);
const sky = makeSky(sun, light, clock);
const { geometry, gridGrowth } = makeOceanGeometry(rings, spokes);
if (!(geometry.index.array instanceof Uint32Array)) throw Error('High-density mesh needs 32-bit indices');
let maxIndex = 0;
for (const index of geometry.index.array) if (index > maxIndex) maxIndex = index;
if (maxIndex !== geometry.attributes.position.count - 1) throw Error('Mesh indices were truncated');
const scene = new THREE.Scene();
const material = makeWaterMaterial(clock, sea, sun, light, sky, gridGrowth);
const ocean = new THREE.Mesh(geometry, material);
ocean.frustumCulled = false;
scene.add(ocean);
const camera = new THREE.PerspectiveCamera(48, width / height, 0.16, 26000);
camera.position.set(0, 4.98, 21);
camera.lookAt(0, 3.98, -21);
camera.updateMatrixWorld();
ocean.position.set(camera.position.x, 0, camera.position.z);
const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
skyMaterial.colorNode = vec4(sky.radiance(positionLocal.normalize(), float(1)), 1);
const dome = new THREE.Mesh(new THREE.SphereGeometry(22000, 48, 24), skyMaterial);
dome.position.copy(camera.position);
dome.renderOrder = 1;
dome.frustumCulled = false;
scene.add(dome);

const metadata = {
  sourceCommit: '1cd032743461068ae31df5d980f93ceff6c11306', sourceBlob: blobSha,
  renderer: adapter.info.description, width, height, samples, rings, spokes,
  vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3,
  geometrySampleMultiplier: rings * spokes / (192 * 320),
  lighting: ['five-direction cloud skylight visibility', 'directional atmospheric scattering', 'shared HDR sky irradiance', 'spectral water absorption and backscatter', 'rough-surface reflection and finite sun disk'],
  clouds: clouds.metadata,
  fixedTimeSeconds: clock.value, seaState: sea.value, timeOfDay: '17:33',
  camera: camera.position.toArray(), target: [0, 3.98, -21], exposure: 1.02,
  accumulation: '32-bit float scene target and sample accumulation, followed by bloom and a floating-point ACES/sRGB pass',
  outputPrecision: 'RGB16 master and achromatically dithered RGB8 display copy',
};
console.log(JSON.stringify(metadata));

async function readTexture(nativeTexture, bytesPerPixel, consume) {
  const rowBytes = width * bytesPerPixel;
  const stride = Math.ceil(rowBytes / 256) * 256;
  const readback = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: nativeTexture }, { buffer: readback, bytesPerRow: stride }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  try { return consume(readback.getMappedRange(), stride); }
  finally { readback.unmap(); readback.destroy(); }
}
function halton(n, base) {
  let f = 1, value = 0;
  while (n) { f /= base; value += f * (n % base); n = Math.floor(n / base); }
  return value;
}
const accumulated = new Float32Array(width * height * 4);
const signatures = [];
const started = performance.now();
renderer.setRenderTarget(target);
await renderer.compileAsync(scene, camera);
for (let sample = 0; sample < samples; sample++) {
  const jitterX = samples === 1 ? 0 : halton(sample + 1, 2) - 0.5;
  const jitterY = samples === 1 ? 0 : halton(sample + 1, 3) - 0.5;
  camera.setViewOffset(width, height, jitterX, jitterY, width, height);
  renderer.render(scene, camera);
  await readTexture(renderer.backend.get(target.texture).texture, 16, (buffer, stride) => {
    const values = new Float32Array(buffer);
    const bits = new Uint32Array(buffer);
    const rowStride = stride / 4;
    let signature = 2166136261;
    for (let i = 0; i < bits.length; i += 1277) signature = Math.imul(signature ^ bits[i], 16777619) >>> 0;
    signatures.push(signature);
    for (let y = 0; y < height; y++) {
      const sourceOffset = y * rowStride, destOffset = y * width * 4;
      for (let x = 0; x < width * 4; x++) {
        const value = values[sourceOffset + x];
        if (!Number.isFinite(value)) throw Error('Nonfinite radiance in actual readback');
        accumulated[destOffset + x] += value;
      }
    }
  });
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`HDR sample ${sample + 1}/${samples}; elapsed ${((performance.now() - started)/1000).toFixed(1)}s`);
}
camera.clearViewOffset();
if (samples > 1 && new Set(signatures).size < 2) throw Error('Subpixel samples did not vary');
metadata.distinctSubpixelSamples = new Set(signatures).size;
const averaged = new Uint16Array(accumulated.length);
for (let i = 0; i < averaged.length; i++) {
  accumulated[i] /= samples;
  averaged[i] = THREE.DataUtils.toHalfFloat(accumulated[i]);
}
// Bloom alone uses the filterable, lower-precision copy. The image itself
// uses an unfiltered 1:1 load from the actual float32 resolved radiance.
const resolved = new THREE.DataTexture(accumulated, width, height, THREE.RGBAFormat, THREE.FloatType);
resolved.colorSpace = THREE.LinearSRGBColorSpace;
resolved.minFilter = THREE.NearestFilter;
resolved.magFilter = THREE.NearestFilter;
resolved.needsUpdate = true;
const hdrTexture = new THREE.DataTexture(averaged, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
hdrTexture.colorSpace = THREE.LinearSRGBColorSpace;
hdrTexture.minFilter = THREE.LinearFilter;
hdrTexture.magFilter = THREE.LinearFilter;
hdrTexture.needsUpdate = true;
const hdr = texture(hdrTexture, screenUV);
// Limit only the optical bloom input so the small, high-radiance sun does not
// spill an oversized halo. The resolved HDR signal still goes to ACES intact.
const peak = hdr.r.max(hdr.g).max(hdr.b);
const bloomInput = vec4(hdr.rgb.mul(float(14).div(peak.max(14))), 1);
const glow = bloom(bloomInput, 0.16, 0.39, 1.48);
const fromCenter = screenUV.sub(0.5);
const vignette = float(1).sub(dot(fromCenter, fromCenter).mul(0.10));
renderer.setRenderTarget(target);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const pipeline = new THREE.RenderPipeline(renderer);
const resolvedPixel = textureLoad(resolved, screenCoordinate.xy);
pipeline.outputNode = vec4(resolvedPixel.rgb.add(glow.rgb).mul(vignette), 1);
pipeline.render();
const rows = await readTexture(renderer.backend.get(target.texture).texture, 16,
  (buffer, stride) => encodeDisplayRows(new Float32Array(buffer), width, height, stride / 4));
const gpuError = await device.popErrorScope();
if (gpuError || errors.length) throw Error(gpuError?.message || errors.join('\n'));

metadata.renderSeconds = (performance.now() - started) / 1000;
await fs.mkdir(path.dirname(output), { recursive: true });
await writePNG(output, rows.master, width, height, 16, metadata);
await writePNG(output.replace(/\.png$/i, '-display.png'), rows.display, width, height, 8, metadata);
await fs.writeFile(output.replace(/\.png$/i, '.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('Saved:', output, 'renderSeconds:', metadata.renderSeconds.toFixed(1));
pipeline.dispose(); resolved.dispose(); target.dispose(); hdrTexture.dispose(); geometry.dispose(); material.dispose(); skyMaterial.dispose();
clouds.skyTexture.dispose(); clouds.fieldTexture.dispose();
renderer.dispose(); finalTexture.destroy(); device.destroy();
delete globalThis.navigator;
process.exit(0);
