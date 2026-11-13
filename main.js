import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  varying,
  float,
  vec2,
  vec3,
  positionLocal,
  cameraPosition,
  sin,
  cos,
  abs,
  max,
  min,
  clamp,
  mix,
  smoothstep,
  pow,
  exp,
  floor,
  fract,
  dot,
  cross,
  normalize,
  length,
  reflect,
  pass
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================================
// 1. UI DOM REFERENCES & DIAGNOSTIC HELPERS
// ============================================================================
const container = document.getElementById('canvas-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const loadingBar = document.getElementById('loading-bar');
const errorOverlay = document.getElementById('error-overlay');
const errorTitle = document.getElementById('error-title');
const errorDetail = document.getElementById('error-detail');

const fpsValueEl = document.getElementById('fps-value');
const perfDotEl = document.getElementById('perf-dot');
const backendReadoutEl = document.getElementById('backend-readout');
const frameReadoutEl = document.getElementById('frame-readout');

const seaStateSlider = document.getElementById('sea-state-slider');
const seaStateReadout = document.getElementById('sea-state-readout');
const seaPresetBtns = document.querySelectorAll('#sea-presets .chip-btn');

const timeSlider = document.getElementById('time-slider');
const timeReadout = document.getElementById('time-readout');
const timePresetBtns = document.querySelectorAll('#time-presets .chip-btn[data-time]');
const autoSunBtn = document.getElementById('auto-sun-btn');

const driftToggleBtn = document.getElementById('drift-toggle-btn');
const driftBtnText = document.getElementById('drift-btn-text');
const driftReadout = document.getElementById('drift-readout');
const resetCamBtn = document.getElementById('reset-cam-btn');

function setLoadingStep(message, percent) {
  if (loadingStatus) loadingStatus.textContent = message;
  if (loadingBar) loadingBar.style.width = `${percent}%`;
}

function showFatalError(title, detailMessage) {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  if (errorOverlay) errorOverlay.classList.remove('hidden');
  if (errorTitle) errorTitle.textContent = title;
  if (errorDetail) errorDetail.textContent = String(detailMessage);
}

// ============================================================================
// 2. SIMULATION STATE & SHARED TSL UNIFORMS
// ============================================================================
const MAX_DPR = 2.0;
const state = {
  seaState: 1.0,
  targetSeaState: 1.0,
  timeOfDay: 17.4, // Hours [0, 24]
  targetTimeOfDay: 17.4,
  autoSunCycle: false,
  driftEnabled: true,
  userInteracting: false,
  interactionCooldown: 0.0,
  tabHidden: false,
  elapsedTime: 0.0,
  driftOffsetXZ: new THREE.Vector2(0, 0),
  baseDpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
  adaptiveScale: 1.0,
  bloomScale: 0.5,
  smoothedFps: 60.0,
  smoothedMs: 16.67,
  lowFpsCounter: 0,
  highFpsCounter: 0
};

// Shared TSL Uniform Nodes
const uTime = uniform(0.0);
const uSeaState = uniform(1.0);
const uChoppiness = uniform(1.0);
const uWorldOffsetXZ = uniform(new THREE.Vector2(0.0, 0.0));

// Shared Sun & Atmospheric Palette Uniforms
const uSunDir = uniform(new THREE.Vector3(0.0, 0.22, -0.975));
const uSunElevation = uniform(0.22);
const uSkyZenith = uniform(new THREE.Color(0x0d2b52));
const uSkyHorizon = uniform(new THREE.Color(0xe87a48));
const uSunGlowColor = uniform(new THREE.Color(0xff9442));
const uSunDiskColor = uniform(new THREE.Color(0xfff0d6));
const uCloudLitColor = uniform(new THREE.Color(0xffb884));
const uCloudShadowColor = uniform(new THREE.Color(0x383e5e));
const uNightStarVis = uniform(0.0);

// Ocean Water Optical Uniforms
const uDeepWaterColor = uniform(new THREE.Color(0x031829));
const uShallowWaterColor = uniform(new THREE.Color(0x0b6e75));
const uFoamTint = uniform(new THREE.Color(0xfff1e0));
const uFogDensity = uniform(0.00095);

// ============================================================================
// 3. CONTINUOUS DAY / NIGHT PALETTE INTERPOLATOR
// ============================================================================
const KEYFRAMES = [
  {
    hour: 0.0, // Midnight
    zenith: new THREE.Color(0x02050d),
    horizon: new THREE.Color(0x09162b),
    sunGlow: new THREE.Color(0x1b345c),
    sunDisk: new THREE.Color(0x9abfff),
    cloudLit: new THREE.Color(0x223656),
    cloudShadow: new THREE.Color(0x070d19),
    deepWater: new THREE.Color(0x010711),
    shallowWater: new THREE.Color(0x062338),
    foam: new THREE.Color(0x7fa2c9),
    exposure: 0.88
  },
  {
    hour: 5.2, // Pre-Dawn Twilight
    zenith: new THREE.Color(0x0b1636),
    horizon: new THREE.Color(0x52395c),
    sunGlow: new THREE.Color(0xc4605a),
    sunDisk: new THREE.Color(0xffb48a),
    cloudLit: new THREE.Color(0xd67c72),
    cloudShadow: new THREE.Color(0x1f223d),
    deepWater: new THREE.Color(0x030e1f),
    shallowWater: new THREE.Color(0x0c3c4c),
    foam: new THREE.Color(0xc4b0c9),
    exposure: 0.95
  },
  {
    hour: 6.4, // Golden Sunrise
    zenith: new THREE.Color(0x173966),
    horizon: new THREE.Color(0xe88a58),
    sunGlow: new THREE.Color(0xff9c52),
    sunDisk: new THREE.Color(0xfff1d0),
    cloudLit: new THREE.Color(0xffc694),
    cloudShadow: new THREE.Color(0x41496e),
    deepWater: new THREE.Color(0x041d33),
    shallowWater: new THREE.Color(0x0f6c70),
    foam: new THREE.Color(0xffebd6),
    exposure: 1.04
  },
  {
    hour: 9.5, // Morning Azure
    zenith: new THREE.Color(0x124c8f),
    horizon: new THREE.Color(0x8bc8f0),
    sunGlow: new THREE.Color(0xffe1b0),
    sunDisk: new THREE.Color(0xffffff),
    cloudLit: new THREE.Color(0xffffff),
    cloudShadow: new THREE.Color(0x6e88a8),
    deepWater: new THREE.Color(0x032647),
    shallowWater: new THREE.Color(0x0a878f),
    foam: new THREE.Color(0xf7fbff),
    exposure: 1.02
  },
  {
    hour: 12.5, // High Solar Noon
    zenith: new THREE.Color(0x0d4182),
    horizon: new THREE.Color(0x9bd6ff),
    sunGlow: new THREE.Color(0xfff0d4),
    sunDisk: new THREE.Color(0xffffff),
    cloudLit: new THREE.Color(0xffffff),
    cloudShadow: new THREE.Color(0x7894b5),
    deepWater: new THREE.Color(0x022345),
    shallowWater: new THREE.Color(0x099499),
    foam: new THREE.Color(0xffffff),
    exposure: 1.0
  },
  {
    hour: 16.2, // Late Afternoon Warmth
    zenith: new THREE.Color(0x16447a),
    horizon: new THREE.Color(0xdcb48c),
    sunGlow: new THREE.Color(0xffba6b),
    sunDisk: new THREE.Color(0xfff6e0),
    cloudLit: new THREE.Color(0xffe0b5),
    cloudShadow: new THREE.Color(0x586887),
    deepWater: new THREE.Color(0x03203b),
    shallowWater: new THREE.Color(0x0d7a7d),
    foam: new THREE.Color(0xfff5e8),
    exposure: 1.03
  },
  {
    hour: 17.55, // Cinematic Sunset / Golden Hour
    zenith: new THREE.Color(0x11284c),
    horizon: new THREE.Color(0xe66d3e),
    sunGlow: new THREE.Color(0xff7b36),
    sunDisk: new THREE.Color(0xffecd1),
    cloudLit: new THREE.Color(0xffa970),
    cloudShadow: new THREE.Color(0x363959),
    deepWater: new THREE.Color(0x031526),
    shallowWater: new THREE.Color(0x0c5e66),
    foam: new THREE.Color(0xffdfc4),
    exposure: 1.06
  },
  {
    hour: 18.75, // Crimson Dusk / Afterglow
    zenith: new THREE.Color(0x09132b),
    horizon: new THREE.Color(0x783248),
    sunGlow: new THREE.Color(0xd14949),
    sunDisk: new THREE.Color(0xff8c66),
    cloudLit: new THREE.Color(0xc45a68),
    cloudShadow: new THREE.Color(0x1b1d36),
    deepWater: new THREE.Color(0x020c1a),
    shallowWater: new THREE.Color(0x08384a),
    foam: new THREE.Color(0xc79dad),
    exposure: 0.94
  },
  {
    hour: 20.5, // Deep Blue Nocturne
    zenith: new THREE.Color(0x030712),
    horizon: new THREE.Color(0x0d1e38),
    sunGlow: new THREE.Color(0x1e3863),
    sunDisk: new THREE.Color(0xa6c8ff),
    cloudLit: new THREE.Color(0x263b5e),
    cloudShadow: new THREE.Color(0x080f1d),
    deepWater: new THREE.Color(0x010812),
    shallowWater: new THREE.Color(0x06263d),
    foam: new THREE.Color(0x84a7cf),
    exposure: 0.89
  },
  {
    hour: 24.0, // Wrap to Midnight
    zenith: new THREE.Color(0x02050d),
    horizon: new THREE.Color(0x09162b),
    sunGlow: new THREE.Color(0x1b345c),
    sunDisk: new THREE.Color(0x9abfff),
    cloudLit: new THREE.Color(0x223656),
    cloudShadow: new THREE.Color(0x070d19),
    deepWater: new THREE.Color(0x010711),
    shallowWater: new THREE.Color(0x062338),
    foam: new THREE.Color(0x7fa2c9),
    exposure: 0.88
  }
];

function updateDayNightCycle(hour, renderer) {
  const h = ((hour % 24) + 24) % 24;

  // Solar orbital path: rises around 06:00, peaks at 12:30, sets around 18:15
  const solarPhase = ((h - 6.1) / 12.15) * Math.PI;
  const sinElev = Math.sin(solarPhase);
  const elevation = sinElev >= 0 ? Math.pow(sinElev, 0.88) * 0.86 : sinElev * 0.42;

  // Gentle azimuthal arc across the horizon
  const azimuth = -Math.PI * 0.52 + ((h - 12.0) / 24.0) * 0.72;
  const horizCos = Math.sqrt(Math.max(0.001, 1.0 - elevation * elevation));

  // At night, use a subtle nocturnal moon/celestial light direction so waves keep rim highlights
  const effectiveElev = elevation < -0.05 ? Math.abs(elevation) * 0.55 + 0.12 : elevation;
  const effectiveHoriz = Math.sqrt(Math.max(0.001, 1.0 - effectiveElev * effectiveElev));

  uSunDir.value.set(
    Math.cos(azimuth) * effectiveHoriz,
    effectiveElev,
    Math.sin(azimuth) * effectiveHoriz
  ).normalize();

  uSunElevation.value = elevation;
  uNightStarVis.value = THREE.MathUtils.smoothstep(-elevation, 0.02, 0.24);

  // Find surrounding palette keyframes
  let k0 = KEYFRAMES[0];
  let k1 = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (h >= KEYFRAMES[i].hour && h <= KEYFRAMES[i + 1].hour) {
      k0 = KEYFRAMES[i];
      k1 = KEYFRAMES[i + 1];
      break;
    }
  }

  const span = Math.max(0.0001, k1.hour - k0.hour);
  const t = THREE.MathUtils.smoothstep((h - k0.hour) / span, 0.0, 1.0);

  uSkyZenith.value.lerpColors(k0.zenith, k1.zenith, t);
  uSkyHorizon.value.lerpColors(k0.horizon, k1.horizon, t);
  uSunGlowColor.value.lerpColors(k0.sunGlow, k1.sunGlow, t);
  uSunDiskColor.value.lerpColors(k0.sunDisk, k1.sunDisk, t);
  uCloudLitColor.value.lerpColors(k0.cloudLit, k1.cloudLit, t);
  uCloudShadowColor.value.lerpColors(k0.cloudShadow, k1.cloudShadow, t);
  uDeepWaterColor.value.lerpColors(k0.deepWater, k1.deepWater, t);
  uShallowWaterColor.value.lerpColors(k0.shallowWater, k1.shallowWater, t);
  uFoamTint.value.lerpColors(k0.foam, k1.foam, t);

  if (renderer) {
    renderer.toneMappingExposure = THREE.MathUtils.lerp(k0.exposure, k1.exposure, t);
  }
}

// ============================================================================
// 4. TSL PROCEDURAL NOISE, FBM & SHARED ANALYTICAL SKY GRAPH
// ============================================================================

// 2D Lattice Unit Gradient Vector Hash
const gradHash2D = Fn(([cell]) => {
  const angle = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453123)).mul(6.2831853);
  return vec2(cos(angle), sin(angle));
});

// 2D Quintic Hermite Gradient Noise (Perlin-style, continuous 2nd derivatives)
const gradNoise2D = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);

  // Quintic interpolation curve: 6f^5 - 15f^4 + 10f^3
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));

  const g00 = gradHash2D(i);
  const g10 = gradHash2D(i.add(vec2(1.0, 0.0)));
  const g01 = gradHash2D(i.add(vec2(0.0, 1.0)));
  const g11 = gradHash2D(i.add(vec2(1.0, 1.0)));

  const d00 = f;
  const d10 = f.sub(vec2(1.0, 0.0));
  const d01 = f.sub(vec2(0.0, 1.0));
  const d11 = f.sub(vec2(1.0, 1.0));

  const n00 = dot(g00, d00);
  const n10 = dot(g10, d10);
  const n01 = dot(g01, d01);
  const n11 = dot(g11, d11);

  const nx0 = mix(n00, n10, u.x);
  const nx1 = mix(n01, n11, u.x);
  return mix(nx0, nx1, u.y).mul(1.4142135);
});

// 3-Layer Domain-Rotated FBM (Fractional Brownian Motion)
const fbm3 = Fn(([p_in]) => {
  const p0 = p_in;
  const n1 = gradNoise2D(p0);

  // Orthogonal rotation (cos 36.87 deg = 0.8, sin 36.87 deg = 0.6) breaks grid axial alignment
  const p1 = vec2(
    p0.x.mul(0.8).sub(p0.y.mul(0.6)),
    p0.x.mul(0.6).add(p0.y.mul(0.8))
  ).mul(2.04).add(vec2(19.3, 7.1));
  const n2 = gradNoise2D(p1);

  const p2 = vec2(
    p1.x.mul(0.8).sub(p1.y.mul(0.6)),
    p1.x.mul(0.6).add(p1.y.mul(0.8))
  ).mul(2.08).add(vec2(37.9, 29.4));
  const n3 = gradNoise2D(p2);

  return n1.mul(0.56).add(n2.mul(0.29)).add(n3.mul(0.15));
});

// Shared Analytical Sky Function (Used by both Sky Dome & Ocean Surface Reflections)
const evalAnalyticalSky = Fn(([rayDir_in]) => {
  const dir = normalize(rayDir_in);
  const y = dir.y;
  const yPos = max(y, 0.0);

  // 1. Rayleigh Zenith-to-Horizon Atmospheric Gradient
  const horizonCurve = pow(float(1.0).sub(yPos), 2.75);
  const baseSky = mix(uSkyZenith, uSkyHorizon, horizonCurve);

  // 2. Solar Mie Forward Scattering Halo & Horizon Azimuthal Glow
  const sunDot = clamp(dot(dir, uSunDir), -1.0, 1.0);
  const sunDotPos = max(sunDot, 0.0);
  const daylightMask = smoothstep(-0.18, 0.08, uSunElevation);

  const wideMie = pow(sunDotPos, 5.0).mul(0.38);
  const tightMie = pow(sunDotPos, 36.0).mul(0.65);

  const dirHoriz = normalize(vec3(dir.x, 0.0001, dir.z));
  const sunHoriz = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
  const azimAlign = pow(max(dot(dirHoriz, sunHoriz), 0.0), 2.5);
  const horizonBand = exp(abs(y).negate().mul(7.0)).mul(azimAlign).mul(0.48);

  const mieContribution = uSunGlowColor.mul(wideMie.add(tightMie).add(horizonBand));
  const skyWithMie = baseSky.add(mieContribution);

  // 3. Solar / Lunar Disk & Corona
  const aboveHorizon = smoothstep(-0.025, 0.015, y);
  const solarDisk = smoothstep(0.99935, 0.99986, sunDot).mul(float(1.2).add(daylightMask.mul(5.2)));
  const solarCorona = pow(sunDotPos, 220.0).mul(float(0.6).add(daylightMask.mul(1.4)));
  const sunRadiance = uSunDiskColor.mul(solarDisk.add(solarCorona)).mul(aboveHorizon);

  // 4. Low-Altitude Procedural Cloud Band (Curved Atmospheric Layer Projection)
  const cloudBandMask = smoothstep(0.01, 0.068, y).mul(float(1.0).sub(smoothstep(0.15, 0.46, y)));
  const cloudProj = dir.xz.div(max(y, 0.038).add(0.115)).mul(0.36);
  const windDrift = vec2(uTime.mul(0.011), uTime.mul(-0.0065));
  const cloudUV = cloudProj.add(windDrift);

  const cBase = fbm3(cloudUV);
  const cDetail = fbm3(cloudUV.mul(2.45).add(vec2(cBase.mul(0.5), uTime.mul(0.008))));
  const cCombined = cBase.mul(0.64).add(cDetail.mul(0.36));

  const cloudDensity = smoothstep(-0.04, 0.44, cCombined.mul(cloudBandMask));

  // Directional silver-lining and vertical self-shadowing inside clouds
  const cloudHeightShade = clamp(y.mul(4.2).add(cDetail.mul(0.28)), 0.0, 1.0);
  const silverLining = pow(sunDotPos, 6.0)
    .mul(float(1.0).sub(cloudDensity.mul(0.6)))
    .mul(float(0.45).add(daylightMask.mul(0.95)));

  const cloudBodyColor = mix(uCloudShadowColor, uCloudLitColor, cloudHeightShade)
    .add(uSunGlowColor.mul(silverLining));

  // Blend distant low clouds into horizon mist
  const cloudMistFade = smoothstep(0.012, 0.11, y);
  const finalCloudColor = mix(uSkyHorizon, cloudBodyColor, cloudMistFade);

  // Sun disk occluded partially behind thick clouds
  const skyPlusSun = skyWithMie.add(sunRadiance.mul(float(1.0).sub(cloudDensity.mul(0.82))));
  const skyWithClouds = mix(skyPlusSun, finalCloudColor, cloudDensity.mul(0.84));

  // 5. Nocturnal Starlight Glints (Visible at Night in Upper Sky)
  const starUV = dir.xz.div(max(y, 0.12)).mul(95.0);
  const starCell = floor(starUV);
  const starFract = fract(starUV).sub(0.5);
  const starRand = fract(sin(dot(starCell, vec2(91.7, 241.3))).mul(71932.19));
  const starDist = length(starFract);
  const starSparkle = sin(uTime.mul(2.4).add(starRand.mul(31.4))).mul(0.35).add(0.65);
  const starIntensity = smoothstep(0.986, 0.999, starRand)
    .mul(smoothstep(0.24, 0.03, starDist))
    .mul(smoothstep(0.14, 0.42, y))
    .mul(float(1.0).sub(cloudDensity))
    .mul(uNightStarVis)
    .mul(starSparkle);

  const upperSky = skyWithClouds.add(vec3(0.75, 0.86, 1.0).mul(starIntensity.mul(1.8)));

  // 6. Below-Horizon Ground/Water Bounce (Prevents dark seams on steep wave reflections)
  const lowerBounce = mix(uDeepWaterColor, uSkyHorizon, smoothstep(-0.35, 0.0, y));
  return mix(lowerBounce, upperSky, smoothstep(-0.02, 0.01, y));
});

// ============================================================================
// 5. FIVE-GROUP GERSTNER WAVE SOLVER & OCEAN SHADER GRAPH
// ============================================================================
// Each wave group: [dirX, dirZ, wavenumber k, baseAmplitude A, baseSteepness Q, speed omega]
const GERSTNER_WAVES = [
  // Group 1: Long Primary Ocean Swell
  { dx: 0.83205, dz: 0.55470, k: 0.044, a: 1.38, q: 0.31, w: 0.657 },
  // Group 2: Cross-Swell Interference Train
  { dx: 0.93633, dz: -0.35112, k: 0.074, a: 0.84, q: 0.29, w: 0.852 },
  // Group 3: Prevailing Wind Gravity Wave
  { dx: 0.60000, dz: 0.80000, k: 0.138, a: 0.46, q: 0.27, w: 1.163 },
  // Group 4: Oblique Chop Wave
  { dx: -0.44721, dz: 0.89442, k: 0.248, a: 0.23, q: 0.24, w: 1.560 },
  // Group 5: High-Frequency Agitation Wave
  { dx: 0.31623, dz: -0.94868, k: 0.425, a: 0.115, q: 0.20, w: 2.042 }
];

function createOceanMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.FrontSide
  });

  // Evaluate 5 Gerstner waves + analytical partial derivatives in a shared setup closure
  const baseXZ = positionLocal.xz.add(uWorldOffsetXZ);

  let dispX = float(0.0);
  let dispY = float(0.0);
  let dispZ = float(0.0);

  // Analytical partial derivatives dP/dx (Tangent) and dP/dz (Bitangent)
  let tx = float(1.0);
  let ty = float(0.0);
  let tz = float(0.0);

  let bx = float(0.0);
  let by = float(0.0);
  let bz = float(1.0);

  // Analytical Crest Jacobian Compression (tracks wave crest sharpness & whitecap formation)
  let crestJacobian = float(0.0);

  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const wv = GERSTNER_WAVES[i];
    const dir = vec2(wv.dx, wv.dz);
    const k = float(wv.k);
    const amp = float(wv.a).mul(uSeaState);
    const q = float(wv.q).mul(uChoppiness);
    const omega = float(wv.w);

    const theta = k.mul(dot(dir, baseXZ)).sub(omega.mul(uTime));
    const s = sin(theta);
    const c = cos(theta);

    const qa = q.mul(amp);
    const ak = amp.mul(k);
    const qak = qa.mul(k);

    // Trochoidal 3D displacement
    dispX = dispX.add(qa.mul(wv.dx).mul(c));
    dispY = dispY.add(amp.mul(s));
    dispZ = dispZ.add(qa.mul(wv.dz).mul(c));

    // Analytical Tangent dP/dx
    tx = tx.sub(qak.mul(wv.dx * wv.dx).mul(s));
    ty = ty.add(ak.mul(wv.dx).mul(c));
    tz = tz.sub(qak.mul(wv.dx * wv.dz).mul(s));

    // Analytical Bitangent dP/dz
    bx = bx.sub(qak.mul(wv.dx * wv.dz).mul(s));
    by = by.add(ak.mul(wv.dz).mul(c));
    bz = bz.sub(qak.mul(wv.dz * wv.dz).mul(s));

    // Crest compression peaks when sin(theta) -> 1
    crestJacobian = crestJacobian.add(qak.mul(s));
  }

  // Layer 1 Large-Scale Gradient FBM Swell Modulation (eliminates long-range periodicity)
  const macroNoiseUV = baseXZ.mul(0.014).add(vec2(uTime.mul(0.045), uTime.mul(-0.032)));
  const macroFbm = fbm3(macroNoiseUV).mul(0.32).mul(uSeaState);
  dispY = dispY.add(macroFbm);

  const displacedLocal = vec3(
    positionLocal.x.add(dispX),
    dispY,
    positionLocal.z.add(dispZ)
  );

  const analyticalTangent = normalize(vec3(tx, ty, tz));
  const analyticalBitangent = normalize(vec3(bx, by, bz));

  // Varyings interpolated from vertex stage to fragment stage
  const vDisplacedPos = varying(displacedLocal, 'vDisplacedPos');
  const vBaseXZ = varying(baseXZ, 'vBaseXZ');
  const vTangent = varying(analyticalTangent, 'vTangent');
  const vBitangent = varying(analyticalBitangent, 'vBitangent');
  const vWaveMetrics = varying(vec2(dispY, crestJacobian), 'vWaveMetrics');

  material.positionNode = displacedLocal;

  // Fragment Stage: Three-Layer Gradient Noise & FBM Normal Perturbation + Physical Water Shading
  material.colorNode = Fn(() => {
    const worldPos = vDisplacedPos;
    const waveXZ = vBaseXZ;
    const waveHeight = vWaveMetrics.x;
    const waveCrestJ = vWaveMetrics.y;

    const toCam = cameraPosition.sub(worldPos);
    const dist = length(toCam);
    const viewDir = normalize(toCam);

    // Reconstruct orthonormal analytical macro basis [T, N_macro, B]
    const T = normalize(vTangent);
    const B = normalize(vBitangent);
    const N_macro = normalize(cross(B, T));

    // Distance attenuation for micro-ripples to prevent horizon Nyquist aliasing
    const detailNearFade = exp(dist.negate().mul(0.0065));
    const detailMidFade = exp(dist.negate().mul(0.0022));

    // 3-Layer Gradient Noise + FBM Surface Detail Coordinates
    const uvLayer1 = waveXZ.mul(0.095).add(vec2(uTime.mul(0.19), uTime.mul(0.11)));
    const uvLayer2 = waveXZ.mul(0.34).add(vec2(uTime.mul(-0.31), uTime.mul(0.24)));
    const uvLayer3 = waveXZ.mul(1.18).add(vec2(uTime.mul(0.52), uTime.mul(-0.44)));

    // Evaluate multi-scale FBM & finite-difference slopes for normal perturbation
    const eps = float(0.14);
    const hCenter = fbm3(uvLayer1).mul(0.52)
      .add(fbm3(uvLayer2).mul(0.32).mul(detailMidFade))
      .add(gradNoise2D(uvLayer3).mul(0.16).mul(detailNearFade));

    const hDx = fbm3(uvLayer1.add(vec2(eps, 0.0))).mul(0.52)
      .add(fbm3(uvLayer2.add(vec2(eps.mul(2.2), 0.0))).mul(0.32).mul(detailMidFade))
      .add(gradNoise2D(uvLayer3.add(vec2(eps.mul(4.5), 0.0))).mul(0.16).mul(detailNearFade));

    const hDz = fbm3(uvLayer1.add(vec2(0.0, eps))).mul(0.52)
      .add(fbm3(uvLayer2.add(vec2(0.0, eps.mul(2.2)))).mul(0.32).mul(detailMidFade))
      .add(gradNoise2D(uvLayer3.add(vec2(0.0, eps.mul(4.5)))).mul(0.16).mul(detailNearFade));

    const rippleStrength = float(0.26).add(uSeaState.mul(0.11)).mul(detailMidFade.mul(0.75).add(0.25));
    const dHx = hDx.sub(hCenter).div(eps).mul(rippleStrength);
    const dHz = hDz.sub(hCenter).div(eps).mul(rippleStrength);

    // Perturb analytical macro normal inside tangent frame [T, N_macro, B]
    const N = normalize(N_macro.sub(T.mul(dHx)).sub(B.mul(dHz)));

    // ------------------------------------------------------------------------
    // A. Deep & Shallow Water Volume Color
    // ------------------------------------------------------------------------
    const NoV = clamp(dot(N, viewDir), 0.001, 1.0);
    const heightNorm = clamp(waveHeight.div(max(uSeaState.mul(2.4), 0.4)).mul(0.5).add(0.5), 0.0, 1.0);
    const waterDepthMix = pow(float(1.0).sub(NoV), 1.8).mul(0.45).add(heightNorm.mul(0.55));
    const baseWaterColor = mix(uDeepWaterColor, uShallowWaterColor, clamp(waterDepthMix, 0.0, 1.0));

    // Diffuse sky dome irradiance on water body
    const skyAmbient = mix(uSkyHorizon, uSkyZenith, 0.55).mul(0.22);
    const waterBody = baseWaterColor.mul(float(0.65).add(max(uSunElevation, 0.0).mul(0.55))).add(skyAmbient.mul(baseWaterColor));

    // ------------------------------------------------------------------------
    // B. Wave Crest Subsurface Scattering (SSS / 浪尖透光)
    // ------------------------------------------------------------------------
    const backSunDir = normalize(vec3(uSunDir.x.negate(), max(uSunDir.y, 0.05).mul(0.35), uSunDir.z.negate()));
    const backLightDot = pow(max(dot(viewDir, backSunDir), 0.0), 3.4);
    const grazingSSS = pow(float(1.0).sub(NoV), 2.2);
    const crestThinness = smoothstep(-0.05, 0.52, waveCrestJ.add(heightNorm.mul(0.35)).sub(0.22));
    const sssIntensity = crestThinness
      .mul(backLightDot.mul(0.72).add(grazingSSS.mul(0.28)))
      .mul(uSeaState.mul(0.65).add(0.35));

    const sssTint = mix(uShallowWaterColor.mul(2.4), uSunGlowColor, 0.36);
    const sssContribution = sssTint.mul(sssIntensity.mul(0.95));

    // ------------------------------------------------------------------------
    // C. Schlick Fresnel & Shared Analytical Sky Reflection
    // ------------------------------------------------------------------------
    // F0 = 0.02 for water; grazing Fresnel attenuated slightly by wave micro-roughness
    const f0 = float(0.02);
    const fresnel = f0.add(float(0.98).mul(pow(float(1.0).sub(NoV), 5.0))).mul(0.92);

    const rawReflect = reflect(viewDir.negate(), N);
    // Prevent grazing reflection rays on back-facing wave slopes from dipping deep underground
    const safeReflect = normalize(vec3(rawReflect.x, max(rawReflect.y, 0.012), rawReflect.z));
    const skyReflection = evalAnalyticalSky(safeReflect);

    // Combine water volume + SSS with reflected sky via Fresnel
    const waterSurface = mix(waterBody.add(sssContribution), skyReflection, fresnel);

    // ------------------------------------------------------------------------
    // D. Dual-Lobe Sun Specular Glint / Glitter (太阳闪光)
    // ------------------------------------------------------------------------
    const halfVec = normalize(viewDir.add(uSunDir));
    const NoH = max(dot(N, halfVec), 0.0);
    const NoL = max(dot(N, uSunDir), 0.0);
    const sunHorizonVis = smoothstep(-0.08, 0.06, uSunDir.y);

    // Tight high-HDR micro-facet sparkle lobe (drives TSL Bloom) + broad path sheen lobe
    const specCore = pow(NoH, 520.0).mul(5.8).mul(detailNearFade.mul(0.65).add(0.35));
    const specSheen = pow(NoH, 42.0).mul(0.38);
    const sunSpecular = uSunDiskColor
      .mul(specCore.add(specSheen))
      .mul(NoL)
      .mul(sunHorizonVis)
      .mul(fresnel.mul(0.65).add(0.35));

    // ------------------------------------------------------------------------
    // E. Multi-Scale Procedural Foam & Whitecaps (泡沫)
    // ------------------------------------------------------------------------
    const slopeFactor = float(1.0).sub(clamp(N.y, 0.0, 1.0));
    const foamNoiseA = fbm3(waveXZ.mul(0.48).add(vec2(uTime.mul(0.14), uTime.mul(-0.11))));
    const foamNoiseB = gradNoise2D(waveXZ.mul(1.85).sub(vec2(uTime.mul(0.22), uTime.mul(0.18))));
    const foamPattern = foamNoiseA.mul(0.62).add(foamNoiseB.mul(0.38));

    const crestDriver = waveCrestJ.mul(0.82)
      .add(slopeFactor.mul(1.15))
      .add(foamPattern.mul(0.38))
      .mul(smoothstep(0.28, 1.35, uSeaState));

    const crestFoam = smoothstep(0.42, 0.82, crestDriver);
    // Delicate lacy trailing foam streaks on upper wave backs
    const laceMask = smoothstep(0.26, 0.56, crestDriver).mul(smoothstep(0.05, 0.48, foamPattern)).mul(0.48);
    const foamCoverage = clamp(max(crestFoam, laceMask), 0.0, 0.94);

    const foamLit = uFoamTint.mul(float(0.68).add(NoL.mul(0.42)));
    const shadedOcean = mix(waterSurface.add(sunSpecular), foamLit, foamCoverage);

    // ------------------------------------------------------------------------
    // F. Horizon Distance Fog (Seamless Blend into Shared Analytical Sky)
    // ------------------------------------------------------------------------
    const fogExp = float(1.0).sub(exp(pow(dist.mul(uFogDensity), 2.0).negate()));
    const horizonViewAlign = smoothstep(0.18, 0.0, abs(viewDir.y));
    const fogFactor = clamp(fogExp.add(horizonViewAlign.mul(smoothstep(260.0, 920.0, dist)).mul(0.35)), 0.0, 1.0);

    const horizonRay = normalize(vec3(viewDir.x.negate(), 0.008, viewDir.z.negate()));
    const horizonSkyColor = evalAnalyticalSky(horizonRay);

    return mix(shadedOcean, horizonSkyColor, fogFactor);
  })();

  return material;
}

// ============================================================================
// 6. RADIALLY BIASED HIGH-DENSITY OCEAN GEOMETRY
// ============================================================================
function createRadiallyBiasedOceanGeometry(radius = 1150, segments = 420) {
  const geo = new THREE.PlaneGeometry(2.0, 2.0, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const count = posAttr.count;

  // Non-linear radial distribution concentrates ultra-high vertex density near the camera
  // while smoothly extending the ocean mesh to the distant horizon (radius = 1150m).
  for (let i = 0; i < count; i++) {
    const nx = posAttr.getX(i); // [-1, 1]
    const nz = posAttr.getZ(i); // [-1, 1]

    const maxNorm = Math.max(Math.abs(nx), Math.abs(nz));
    const warpedScale = Math.pow(maxNorm, 1.48) * radius;

    const factor = maxNorm > 1e-6 ? warpedScale / maxNorm : 0.0;
    posAttr.setXYZ(i, nx * factor, 0.0, nz * factor);
  }

  posAttr.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 7. SKY DOME MESH (SHARED ANALYTICAL SKY)
// ============================================================================
function createSkyDomeMesh() {
  const skyGeo = new THREE.SphereGeometry(1600, 64, 40);
  const skyMat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false
  });

  const vSkyDir = varying(positionLocal, 'vSkyDir');
  skyMat.colorNode = Fn(() => {
    return evalAnalyticalSky(normalize(vSkyDir));
  })();

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1;
  return skyMesh;
}

// ============================================================================
// 8. UI CONTROLS & FORMATTERS
// ============================================================================
function getSeaStateLabel(val) {
  if (val < 0.45) return `${val.toFixed(2)} · CALM RIPPLES`;
  if (val < 0.85) return `${val.toFixed(2)} · GENTLE BREEZE`;
  if (val < 1.25) return `${val.toFixed(2)} · MODERATE SWELL`;
  if (val < 1.65) return `${val.toFixed(2)} · FRESH GALE`;
  return `${val.toFixed(2)} · STORM SURGE`;
}

function getTimeOfDayLabel(hours) {
  const h = ((hours % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  let phase = 'NOCTURNE';
  if (h >= 5.0 && h < 7.2) phase = 'DAWN';
  else if (h >= 7.2 && h < 11.0) phase = 'MORNING';
  else if (h >= 11.0 && h < 15.5) phase = 'HIGH NOON';
  else if (h >= 15.5 && h < 17.0) phase = 'AFTERNOON';
  else if (h >= 17.0 && h < 18.4) phase = 'GOLDEN HOUR';
  else if (h >= 18.4 && h < 19.8) phase = 'TWILIGHT';

  return `${clock} · ${phase}`;
}

function syncSeaPresetChips(value) {
  seaPresetBtns.forEach((btn) => {
    const presetVal = parseFloat(btn.dataset.sea);
    btn.classList.toggle('active', Math.abs(presetVal - value) < 0.08);
  });
}

function syncTimePresetChips(value) {
  timePresetBtns.forEach((btn) => {
    const presetVal = parseFloat(btn.dataset.time);
    btn.classList.toggle('active', Math.abs(presetVal - value) < 0.35);
  });
}

// ============================================================================
// 9. APPLICATION BOOTSTRAP & MAIN LOOP
// ============================================================================
async function bootstrap() {
  try {
    setLoadingStep('Checking WebGPU hardware adapter...', 20);

    if (!('gpu' in navigator)) {
      showFatalError(
        'WebGPU API Not Supported',
        'navigator.gpu is unavailable in this browser. Please open this page in Chrome 113+, Edge 113+, or Safari 18+ with WebGPU enabled.'
      );
      return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      showFatalError(
        'No Compatible WebGPU Adapter Found',
        'navigator.gpu.requestAdapter() returned null. Ensure hardware acceleration is enabled in your browser settings.'
      );
      return;
    }

    setLoadingStep('Initializing Three.js WebGPURenderer...', 45);

    const renderer = new THREE.WebGPURenderer({
      antialias: true,
      powerPreference: 'high-performance',
      forceWebGL: false
    });

    const initialDpr = state.baseDpr * state.adaptiveScale;
    renderer.setPixelRatio(initialDpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    await renderer.init();
    container.appendChild(renderer.domElement);

    setLoadingStep('Compiling TSL 5-Wave Gerstner & 3-Layer FBM Shaders...', 72);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.25,
      2400
    );
    camera.position.set(0, 6.2, 24.0);

    // OrbitControls with polar angle safety clamps
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.enablePan = false;
    controls.minDistance = 3.5;
    controls.maxDistance = 95.0;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI * 0.484; // Keep camera above wave crests
    controls.target.set(0, 1.3, -18.0);
    controls.update();

    controls.addEventListener('start', () => {
      state.userInteracting = true;
      state.interactionCooldown = 2.0;
    });
    controls.addEventListener('end', () => {
      state.userInteracting = false;
    });

    // Build Ocean & Sky Meshes
    const oceanGeo = createRadiallyBiasedOceanGeometry(1150, 420);
    const oceanMat = createOceanMaterial();
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.frustumCulled = false;
    scene.add(oceanMesh);

    const skyDome = createSkyDomeMesh();
    scene.add(skyDome);

    // Initialize太阳与昼夜调色
    updateDayNightCycle(state.timeOfDay, renderer);

    setLoadingStep('Building TSL Post-Processing & Bloom Pipeline...', 90);

    const PipelineClass = THREE.RenderPipeline || THREE.PostProcessing;
    const postProcessing = new PipelineClass(renderer);
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode('output');

    // TSL BloomNode (strength, radius, threshold)
    const bloomPass = bloom(scenePassColor, 0.38, 0.35, 0.88);
    if (typeof bloomPass.setResolutionScale === 'function') {
      bloomPass.setResolutionScale(state.bloomScale);
    }
    postProcessing.outputNode = scenePassColor.add(bloomPass);

    // Bind UI Event Listeners
    seaStateSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.targetSeaState = val;
      seaStateReadout.textContent = getSeaStateLabel(val);
      syncSeaPresetChips(val);
    });

    seaPresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.sea);
        state.targetSeaState = val;
        seaStateSlider.value = val.toFixed(2);
        seaStateReadout.textContent = getSeaStateLabel(val);
        syncSeaPresetChips(val);
      });
    });

    timeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.targetTimeOfDay = val;
      timeReadout.textContent = getTimeOfDayLabel(val);
      syncTimePresetChips(val);
    });

    timePresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.time);
        state.targetTimeOfDay = val;
        timeSlider.value = val.toFixed(2);
        timeReadout.textContent = getTimeOfDayLabel(val);
        syncTimePresetChips(val);
      });
    });

    autoSunBtn.addEventListener('click', () => {
      state.autoSunCycle = !state.autoSunCycle;
      autoSunBtn.classList.toggle('active', state.autoSunCycle);
      autoSunBtn.textContent = state.autoSunCycle ? 'CYCLE: ON' : 'CYCLE: OFF';
    });

    driftToggleBtn.addEventListener('click', () => {
      state.driftEnabled = !state.driftEnabled;
      driftToggleBtn.classList.toggle('off', !state.driftEnabled);
      driftToggleBtn.setAttribute('aria-pressed', String(state.driftEnabled));
      driftBtnText.textContent = state.driftEnabled ? 'DRIFT: ON' : 'DRIFT: OFF';
      driftReadout.textContent = state.driftEnabled ? 'GLIDE ACTIVE' : 'CAMERA LOCKED';
    });

    resetCamBtn.addEventListener('click', () => {
      camera.position.set(0, 6.2, 24.0);
      controls.target.set(0, 1.3, -18.0);
      controls.update();
    });

    // Responsive Resize Handler with DPR Cap
    function applyViewportSize() {
      state.baseDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const effectiveDpr = Math.max(0.75, state.baseDpr * state.adaptiveScale);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(effectiveDpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener('resize', applyViewportSize);

    // Tab Visibility Pause Protection
    let lastFrameTime = performance.now();
    document.addEventListener('visibilitychange', () => {
      state.tabHidden = document.hidden;
      if (!state.tabHidden) {
        lastFrameTime = performance.now();
      }
    });

    // Adaptive Performance Protection (Dynamic DPR & Bloom Scaling)
    function evaluatePerformanceProtection(dt) {
      const currentFps = 1.0 / Math.max(dt, 0.0001);
      const currentMs = dt * 1000.0;

      state.smoothedFps = THREE.MathUtils.lerp(state.smoothedFps, Math.min(currentFps, 144), 0.08);
      state.smoothedMs = THREE.MathUtils.lerp(state.smoothedMs, currentMs, 0.08);

      if (state.smoothedFps < 30.0) {
        state.lowFpsCounter++;
        state.highFpsCounter = 0;
      } else if (state.smoothedFps > 55.0) {
        state.highFpsCounter++;
        state.lowFpsCounter = 0;
      } else {
        state.lowFpsCounter = Math.max(0, state.lowFpsCounter - 1);
      }

      // Step down internal resolution if sustained low frame rate
      if (state.lowFpsCounter > 75 && state.adaptiveScale > 0.65) {
        state.adaptiveScale = Math.max(0.65, state.adaptiveScale - 0.15);
        state.bloomScale = 0.32;
        if (typeof bloomPass.setResolutionScale === 'function') {
          bloomPass.setResolutionScale(state.bloomScale);
        }
        applyViewportSize();
        state.lowFpsCounter = 0;
        perfDotEl.classList.add('warn');
        backendReadoutEl.textContent = 'WebGPU · ADAPTIVE DPR';
      } else if (state.highFpsCounter > 240 && state.adaptiveScale < 1.0) {
        state.adaptiveScale = Math.min(1.0, state.adaptiveScale + 0.15);
        state.bloomScale = 0.5;
        if (typeof bloomPass.setResolutionScale === 'function') {
          bloomPass.setResolutionScale(state.bloomScale);
        }
        applyViewportSize();
        state.highFpsCounter = 0;
        if (state.adaptiveScale >= 0.99) {
          perfDotEl.classList.remove('warn');
          backendReadoutEl.textContent = 'WebGPU · ACES + Bloom';
        }
      }
    }

    let uiUpdateTimer = 0.0;
    let firstFrameRendered = false;

    // Animation Loop
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      if (state.tabHidden) {
        lastFrameTime = now;
        return;
      }

      // Clamp delta time to protect physics/phases against tab switches or hiccups
      const rawDt = (now - lastFrameTime) * 0.001;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.08);
      lastFrameTime = now;

      state.elapsedTime += dt;
      uTime.value = state.elapsedTime;

      // Smoothly interpolate SEA STATE
      state.seaState = THREE.MathUtils.lerp(state.seaState, state.targetSeaState, Math.min(1.0, dt * 4.5));
      uSeaState.value = state.seaState;
      uChoppiness.value = THREE.MathUtils.clamp(0.78 + state.seaState * 0.22, 0.5, 1.25);

      // Optional continuous solar time-lapse or smooth manual scrub
      if (state.autoSunCycle) {
        state.targetTimeOfDay = (state.targetTimeOfDay + dt * 0.28) % 24.0;
        timeSlider.value = state.targetTimeOfDay.toFixed(2);
        timeReadout.textContent = getTimeOfDayLabel(state.targetTimeOfDay);
        syncTimePresetChips(state.targetTimeOfDay);
      }

      // Shortest-path angular lerp on 24-hour clock
      let timeDiff = state.targetTimeOfDay - state.timeOfDay;
      if (timeDiff > 12.0) timeDiff -= 24.0;
      if (timeDiff < -12.0) timeDiff += 24.0;
      state.timeOfDay = ((state.timeOfDay + timeDiff * Math.min(1.0, dt * 5.0)) % 24.0 + 24.0) % 24.0;
      updateDayNightCycle(state.timeOfDay, renderer);

      // Slow Cinematic Automatic Drift
      if (state.interactionCooldown > 0 && !state.userInteracting) {
        state.interactionCooldown = Math.max(0.0, state.interactionCooldown - dt);
      }

      if (state.driftEnabled && !state.userInteracting) {
        const driftBlend = 1.0 - THREE.MathUtils.smoothstep(state.interactionCooldown, 0.0, 2.0);
        const glideSpeed = (1.65 + state.seaState * 0.75) * driftBlend;

        // Advance world wave coordinate origin so the ocean glides endlessly past the camera
        state.driftOffsetXZ.x += Math.sin(state.elapsedTime * 0.07) * glideSpeed * 0.35 * dt;
        state.driftOffsetXZ.y -= glideSpeed * dt;

        // Subtle cinematic camera breathing & gentle azimuthal sway
        const swayAzimuth = Math.sin(state.elapsedTime * 0.16) * 0.0022 * driftBlend;
        const offsetCam = camera.position.clone().sub(controls.target);
        offsetCam.applyAxisAngle(THREE.Object3D.DEFAULT_UP, swayAzimuth);
        camera.position.copy(controls.target).add(offsetCam);
      }

      // Keep ocean & sky centered on camera XZ while compensating world wave phase
      controls.update();
      const minCamHeight = 1.85 + state.seaState * 1.15;
      if (camera.position.y < minCamHeight) {
        camera.position.y = minCamHeight;
      }

      oceanMesh.position.x = camera.position.x;
      oceanMesh.position.z = camera.position.z;
      skyDome.position.copy(camera.position);

      uWorldOffsetXZ.value.set(
        camera.position.x + state.driftOffsetXZ.x,
        camera.position.z + state.driftOffsetXZ.y
      );

      // Execute TSL RenderPipeline / PostProcessing (Scene + Bloom + ACES)
      postProcessing.render();

      // Dismiss Loading Screen smoothly after first completed WebGPU frame
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        setLoadingStep('Ready.', 100);
        requestAnimationFrame(() => {
          loadingOverlay.classList.add('hidden');
        });
      }

      // Update FPS Telemetry & Adaptive Performance Protection
      evaluatePerformanceProtection(dt);
      uiUpdateTimer += dt;
      if (uiUpdateTimer >= 0.2) {
        uiUpdateTimer = 0.0;
        const effDpr = (state.baseDpr * state.adaptiveScale).toFixed(2);
        fpsValueEl.textContent = String(Math.round(state.smoothedFps));
        frameReadoutEl.textContent = `${state.smoothedMs.toFixed(1)} ms · DPR ${effDpr}x`;
      }
    });
  } catch (err) {
    console.error('Pelagic Ocean WebGPU Error:', err);
    showFatalError(
      'WebGPU Pipeline Initialization Failed',
      err && err.message ? err.message : String(err)
    );
  }
}

bootstrap();