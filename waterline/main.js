import * as THREE from "three/webgpu";
import {
  Fn, If, cameraPosition, cross, dot, float, fwidth, mix, pass,
  positionGeometry, positionLocal, positionWorld, reflect, screenUV, smoothstep,
  uniform, varyingProperty, vec2, vec3, vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

const TAU = Math.PI * 2;
const OCEAN_RADIUS = 14_000;
const GRID_FOCUS = 1.5;
const WATER_IOR = 1.333;
const BASE_WAVES = [
  // Wavelength (m), amplitude (m), heading (degrees), phase (radians).
  [90, 1.08, 63, 0.24],
  [51, 0.60, 108, 2.60],
  [28, 0.34, 30, 5.30],
  [14, 0.17, 141, 1.10],
  [7, 0.09, 78, 3.80],
];
const WATER_DETAIL = [
  // Crossing ripple families, with frequencies in cycles/m and advection in cells/s.
  { frequency: [0.15, 0.35], height: 0.32, heading: 27, weight: 0.54, flow: [0.045, -0.28] },
  { frequency: [0.43, 0.94], height: 0.108, heading: -22, weight: 0.30, flow: [-0.12, -0.46] },
  { frequency: [1.48, 2.95], height: 0.034, heading: 64, weight: 0.16, flow: [0.21, -0.68] },
];

const gradient = Fn(([cell]) => {
  const hash = vec3(cell.x, cell.y, cell.x).mul(vec3(0.1031, 0.1030, 0.0973)).fract().toVar();
  hash.addAssign(dot(hash, hash.yzx.add(33.33)));
  return hash.xx.add(hash.yz).mul(hash.zy).fract().mul(2).sub(1);
}).setLayout({
  name: "latticeGradient", type: "vec2", inputs: [{ name: "cell", type: "vec2" }],
});

// Quintic gradient noise and the exact derivatives of its interpolation.
const gradientNoise = Fn(([p]) => {
  const cell = p.floor().toVar();
  const f = p.fract().toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
  const edge = f.sub(1).toVar();
  const du = f.mul(f).mul(edge).mul(edge).mul(30).toVar();
  const g00 = gradient(cell).toVar();
  const g10 = gradient(cell.add(vec2(1, 0))).toVar();
  const g01 = gradient(cell.add(vec2(0, 1))).toVar();
  const g11 = gradient(cell.add(1)).toVar();
  const a = dot(g00, f).toVar();
  const b = dot(g10, f.sub(vec2(1, 0))).toVar();
  const c = dot(g01, f.sub(vec2(0, 1))).toVar();
  const d = dot(g11, f.sub(1)).toVar();
  const low = mix(a, b, u.x).toVar();
  const high = mix(c, d, u.x).toVar();
  const blendedGradient = mix(mix(g00, g10, u.x), mix(g01, g11, u.x), u.y);
  const derivative = blendedGradient.add(du.mul(vec2(mix(b.sub(a), d.sub(c), u.y), high.sub(low))));
  return vec3(mix(low, high, u.y), derivative);
}).setLayout({
  name: "gradientNoiseAndSlope", type: "vec3", inputs: [{ name: "p", type: "vec2" }],
});

function makeOceanGeometry(rings, spokes) {
  const logExtent = Math.log1p(OCEAN_RADIUS / GRID_FOCUS);
  const positions = new Float32Array(3 * (1 + rings * spokes));
  const indices = new Uint16Array(spokes * (2 * rings - 1) * 3);
  const circle = Array.from({ length: spokes }, (_, i) => {
    const angle = i * TAU / spokes;
    return [Math.cos(angle), Math.sin(angle)];
  });

  let offset = 0;
  for (let ring = 0; ring < rings; ring++) {
    const radius = GRID_FOCUS * Math.expm1(logExtent * (ring + 1) / rings);
    const first = 1 + ring * spokes;

    for (let spoke = 0; spoke < spokes; spoke++) {
      const i = first + spoke;
      const j = first + (spoke + 1) % spokes;
      positions[3 * i] = radius * circle[spoke][0];
      positions[3 * i + 2] = radius * circle[spoke][1];

      if (ring === 0) {
        indices[offset++] = 0;
        indices[offset++] = j;
        indices[offset++] = i;
      } else {
        indices[offset++] = i - spokes;
        indices[offset++] = j - spokes;
        indices[offset++] = i;
        indices[offset++] = j - spokes;
        indices[offset++] = j;
        indices[offset++] = i;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry, gridGrowth: Math.expm1(logExtent / rings) };
}

function makeSky(sun, light, clock) {
  const sunColor = mix(vec3(1.0, 0.36, 0.115), vec3(1.0, 0.89, 0.72), float(1).sub(light.y));

  const atmosphere = Fn(([ray]) => {
    const height = ray.y.max(0).toVar();
    const lightAngle = dot(ray, sun).clamp(0, 1).toVar();
    const haze = height.mul(-7.5).exp();
    const night = mix(vec3(0.003, 0.0085, 0.022), vec3(0.020, 0.037, 0.063), haze);
    const daylight = mix(vec3(0.073, 0.244, 0.433), vec3(0.40, 0.57, 0.67), haze);
    const duskHorizon = mix(vec3(0.22, 0.246, 0.267), vec3(0.83, 0.305, 0.103), lightAngle.pow(5));
    const dusk = mix(vec3(0.037, 0.080, 0.143), duskHorizon, haze);
    const glow = lightAngle.pow(38).mul(0.15)
      .add(lightAngle.pow(350).mul(0.34))
      .add(lightAngle.pow(2400).mul(0.58));
    return mix(night, mix(daylight, dusk, light.y), light.x).add(sunColor.mul(glow.mul(light.z)));
  });

  // Both the sky dome and the water call this function in world space.
  // The water integrates the solar disk separately as a rough specular lobe.
  const radiance = Fn(([ray, diskWeight, reflectionSpread]) => {
    const rgb = atmosphere(ray).toVar();
    const altitude = ray.y.max(0).toVar();
    const band = smoothstep(0.012, 0.066, altitude)
      .mul(float(1).sub(smoothstep(0.18, 0.37, altitude))).toVar();

    If(band.greaterThan(0.002), () => {
      const wind = vec2(clock.mul(0.007), clock.mul(0.003));
      const p = ray.xz.mul(vec2(1.22, 2.13)).div(altitude.add(0.102)).add(wind).toVar();
      const weather = gradientNoise(p.mul(0.61).add(vec2(21.9, 6.7))).toVar();
      const domain = p.add(weather.yz.mul(0.33)).toVar();
      const main = gradientNoise(domain).toVar();
      const fbm = main.x.mul(0.58)
        .add(gradientNoise(domain.mul(2.13).add(vec2(4.2, 7.5))).x.mul(0.26))
        .add(gradientNoise(domain.mul(4.36).add(vec2(-7.2, 12.7))).x.mul(0.12))
        .add(weather.x.mul(0.27)).toVar();
      const depth = fbm.add(0.031).max(0).mul(7.8).toVar();
      const cloudFootprint = reflectionSpread.mul(1.3).div(altitude.add(0.13));
      const cloudBlur = smoothstep(0.12, 0.72, cloudFootprint).mul(0.78);
      const coverage = mix(float(1).sub(depth.negate().exp()), 0.27, cloudBlur).mul(band);
      const towardSun = dot(ray, sun).clamp(0, 1).pow(8);
      const lightSlope = dot(main.yz, sun.xz).mul(0.27).add(0.55).clamp(0.16, 1);
      const edgeLight = depth.mul(-0.6).exp().mul(mix(lightSlope, 0.55, cloudBlur));
      const shade = mix(vec3(0.012, 0.019, 0.034), vec3(0.47, 0.55, 0.61), light.x);
      const cloud = mix(shade, vec3(0.077, 0.071, 0.086), light.y.mul(light.x))
        .add(sunColor.mul(towardSun.mul(edgeLight).mul(light.z).mul(0.29)));
      rgb.assign(mix(rgb, cloud, coverage));
    });

    const diskRadius = mix(0.00465, 0.0092, light.y);
    const disk = smoothstep(diskRadius.add(0.0012).cos(), diskRadius.sub(0.0012).cos(), dot(ray, sun));
    return rgb.add(sunColor.mul(disk.mul(diskWeight).mul(light.z).mul(18)));
  });

  return { atmosphere, radiance, sunColor };
}

function makeWaterMaterial(clock, sea, sun, light, sky, gridGrowth) {
  const vNormal = varyingProperty("vec3", "vSeaNormal");
  const vRest = varyingProperty("vec2", "vSeaRestXZ");
  const vCrest = varyingProperty("vec3", "vSeaHeightJacobianAndVariance");
  const windHeading = THREE.MathUtils.degToRad(BASE_WAVES[0][2]);
  const wind = vec3(Math.cos(windHeading), 0, Math.sin(windHeading));
  const extinction = vec3(0.92, 0.29, 0.18);

  const displacement = Fn(() => {
    const local = positionGeometry.xz.toVar();
    const p = local.add(cameraPosition.xz).toVar();
    const radius = local.length().toVar();
    const radialDir = local.div(radius.max(0.001)).toVar();
    const stretch = sea.mul(0.50).add(0.66).toVar();
    const amplitudeScale = sea.mul(1.24).add(0.28).toVar();
    const offset = vec3(0).toVar();
    const tangentX = vec3(1, 0, 0).toVar();
    const tangentZ = vec3(0, 0, 1).toVar();
    const lostVariance = float(0).toVar();

    for (const [wavelength, amplitude, heading, phase] of BASE_WAVES) {
      const theta = THREE.MathUtils.degToRad(heading);
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const k = TAU / wavelength;
      const omega = Math.sqrt(9.81 * k);
      const direction = vec2(dx, dz);
      const angle = dot(direction, p).mul(k).sub(clock.mul(omega)).add(phase).toVar();
      const sine = angle.sin().toVar();
      const cosine = angle.cos().toVar();

      // Fade out each wave before the widening grid undersamples it.
      // Include the fade derivative in both tangents.
      const lodSlope = gridGrowth / (0.20 * wavelength);
      const lod = radius.add(GRID_FOCUS).mul(lodSlope).sub(0.65).clamp(0, 1).toVar();
      const window = float(1).sub(lod.mul(lod).mul(float(3).sub(lod.mul(2)))).toVar();
      const fullAmplitude = amplitudeScale.mul(amplitude).toVar();
      const a = fullAmplitude.mul(window).toVar();
      const da = radialDir.mul(fullAmplitude.mul(-6 * lodSlope).mul(lod).mul(float(1).sub(lod))).toVar();
      // The mean square slope of a sinusoid is (ak)^2 / 2.
      lostVariance.addAssign(fullAmplitude.mul(k).pow(2).mul(0.5).mul(float(1).sub(window.mul(window))));

      const horizontal = a.mul(cosine).mul(stretch).toVar();
      offset.addAssign(vec3(horizontal.mul(dx), a.mul(sine), horizontal.mul(dz)));

      const dHorizontalX = stretch.mul(da.x.mul(cosine).sub(a.mul(sine).mul(k * dx)));
      const dHorizontalZ = stretch.mul(da.y.mul(cosine).sub(a.mul(sine).mul(k * dz)));
      tangentX.addAssign(vec3(dHorizontalX.mul(dx), da.x.mul(sine).add(a.mul(cosine).mul(k * dx)), dHorizontalX.mul(dz)));
      tangentZ.addAssign(vec3(dHorizontalZ.mul(dx), da.y.mul(sine).add(a.mul(cosine).mul(k * dz)), dHorizontalZ.mul(dz)));
    }

    vNormal.assign(cross(tangentZ, tangentX).normalize());
    vRest.assign(p);
    const jacobian = tangentX.x.mul(tangentZ.z).sub(tangentZ.x.mul(tangentX.z));
    vCrest.assign(vec3(offset.y, jacobian, lostVariance));
    return positionGeometry.add(offset);
  });

  const smallWaves = Fn(([rest]) => {
    const slope = vec2(0).toVar();
    const fbm = float(0).toVar();
    const lostVariance = float(0).toVar();

    WATER_DETAIL.forEach(({ frequency, height, heading, weight, flow }, i) => {
      const angle = THREE.MathUtils.degToRad(heading);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const scale = vec2(...frequency);
      const domain = vec2(rest.x.mul(c).sub(rest.y.mul(s)), rest.x.mul(s).add(rest.y.mul(c))).mul(scale).toVar();
      const cellsPerPixel = fwidth(domain).toVar();
      const keep = float(1).sub(smoothstep(0.26, 0.82, cellsPerPixel.x.max(cellsPerPixel.y))).toVar();
      const slopeVariance = 0.23 * height ** 2 * (frequency[0] ** 2 + frequency[1] ** 2);
      lostVariance.addAssign(float(1).sub(keep.mul(keep)).mul(slopeVariance));

      If(keep.greaterThan(0.001), () => {
        const p = domain.add(vec2(12.4 + i * 23.7, -9.7 + i * 11.8)).add(vec2(...flow).mul(clock));
        const layer = gradientNoise(p).toVar();
        const gradient = layer.yz.mul(scale).toVar();
        const worldGradient = vec2(
          gradient.x.mul(c).add(gradient.y.mul(s)),
          gradient.y.mul(c).sub(gradient.x.mul(s)),
        );
        fbm.addAssign(layer.x.mul(weight).mul(keep));
        slope.addAssign(worldGradient.mul(height).mul(keep));
      });
    });

    return vec4(fbm, slope, lostVariance);
  });

  const transmittedCosine = Fn(([incident]) => {
    return float(1).sub(float(1).sub(incident.mul(incident)).div(WATER_IOR ** 2)).sqrt();
  });

  const waterFresnel = Fn(([incident, transmitted]) => {
    const s = incident.sub(transmitted.mul(WATER_IOR)).div(incident.add(transmitted.mul(WATER_IOR))).toVar();
    const p = incident.mul(WATER_IOR).sub(transmitted).div(incident.mul(WATER_IOR).add(transmitted)).toVar();
    return s.mul(s).add(p.mul(p)).mul(0.5);
  });

  // Rational approximation of the Smith masking term for Gaussian slopes.
  const beckmannLambda = Fn(([cosine, projectedAlpha]) => {
    const a = cosine.div(projectedAlpha.max(0.00001)).min(1.6).toVar();
    const a2 = a.mul(a).toVar();
    return float(1).sub(a.mul(1.259)).add(a2.mul(0.396)).max(0)
      .div(a.mul(3.535).add(a2.mul(2.181)).max(0.001));
  });

  const waterColor = Fn(() => {
    const towardEye = cameraPosition.sub(positionWorld).toVar();
    const distance = towardEye.length().toVar();
    const view = towardEye.div(distance.max(0.001)).toVar();
    const baseNormal = vNormal.normalize().toVar();
    const detail = smallWaves(vRest).toVar();
    const rippleStrength = sea.mul(0.98).add(0.48).toVar();
    const perturbation = detail.yz.mul(baseNormal.y).mul(rippleStrength).toVar();
    const normal = baseNormal.sub(vec3(perturbation.x, 0, perturbation.y)).normalize().toVar();
    const noV = dot(normal, view).clamp(0.004, 1).toVar();
    const sunFacing = dot(normal, sun).clamp(0, 1).toVar();
    const relativeHeight = vCrest.x.div(sea.mul(1.24).add(0.28)).toVar();
    const compression = float(1).sub(vCrest.y).max(0).toVar();

    // Transfer unresolved surface slope into the specular lobe as detail fades.
    const slopeVariance = vCrest.z.add(detail.w.mul(rippleStrength.mul(rippleStrength))).toVar();
    const capillaryAlpha = mix(0.019, 0.056, sea).toVar();
    const alpha = vec2(1.38, 0.62).mul(slopeVariance)
      .add(capillaryAlpha.mul(capillaryAlpha)).sqrt().toVar();

    const averagedNoV = noV.mul(noV).add(slopeVariance.mul(0.28)).sqrt().min(1).toVar();
    const noT = transmittedCosine(averagedNoV).toVar();
    const fresnel = waterFresnel(averagedNoV, noT).toVar();

    // Beer–Lambert attenuation along a representative path inside the water.
    const ambient = mix(vec3(0.010, 0.021, 0.038), vec3(0.060, 0.135, 0.165), light.x);
    const sunlight = sky.sunColor.mul(sun.y.clamp(0, 1).mul(light.z).mul(0.095));
    const opticalDepth = float(3.6).div(noT).toVar();
    const body = ambient.add(sunlight).mul(vec3(0.072, 0.258, 0.297))
      .mul(vec3(1).sub(extinction.mul(opticalDepth).negate().exp())).toVar();

    const crown = smoothstep(0.11, 0.32, compression)
      .mul(smoothstep(0.10, 0.94, relativeHeight)).toVar();
    const backlight = dot(view.negate(), sun).clamp(0, 1).pow(5);
    const thickness = mix(1.8, 0.65, crown).div(noT);
    const throughCrest = sky.sunColor.mul(vec3(0.047, 0.26, 0.23))
      .mul(extinction.mul(thickness).negate().exp())
      .mul(crown.mul(backlight).mul(light.z)).toVar();

    const ray = reflect(view.negate(), normal).toVar();
    const spread = alpha.x.add(alpha.y).mul(0.61).add(0.028).toVar();
    const aboveWater = smoothstep(spread.mul(-1.40), spread, ray.y).toVar();
    const skyElevation = ray.y.add(ray.y.mul(ray.y).add(spread.mul(spread)).sqrt()).mul(0.5);
    const reflectedRay = vec3(ray.x, skyElevation.max(0.001), ray.z).normalize().toVar();
    const skyReflection = sky.radiance(reflectedRay, float(0), spread).toVar();
    // Below the horizon a reflection encounters other waves, which are lit by the same sky.
    const neighboringWater = body.mul(0.67).add(skyReflection.mul(0.16));
    const reflected = mix(neighboringWater, skyReflection, aboveWater);

    const glint = float(0).toVar();
    If(light.z.greaterThan(0.001).and(sunFacing.greaterThan(0)), () => {
      const alongWind = wind.sub(normal.mul(dot(wind, normal))).normalize().toVar();
      const acrossWind = cross(normal, alongWind).toVar();
      // Fold the finite solar disk into the slope lobe before evaluating it.
      const solarRadius = mix(0.0024, 0.0046, light.y).toVar();
      const solarAlpha = alpha.mul(alpha).add(solarRadius.mul(solarRadius)).sqrt().toVar();
      const lightAndView = view.add(sun).toVar();
      const half = lightAndView.div(lightAndView.length().max(0.00001)).toVar();
      const noH = dot(normal, half).max(0.02).toVar();
      const voH = dot(view, half).clamp(0, 1).toVar();
      const halfSlope = vec2(dot(half, alongWind), dot(half, acrossWind)).div(noH).div(solarAlpha).toVar();
      const distribution = dot(halfSlope, halfSlope).negate().exp()
        .div(solarAlpha.x.mul(solarAlpha.y).mul(Math.PI).mul(noH.pow(4)).max(0.0000001)).toVar();
      const viewWidth = vec2(dot(view, alongWind), dot(view, acrossWind)).mul(alpha).length();
      const sunWidth = vec2(dot(sun, alongWind), dot(sun, acrossWind)).mul(alpha).length();
      const masking = float(1).div(beckmannLambda(noV, viewWidth).add(beckmannLambda(sunFacing, sunWidth)).add(1));
      const interfaceReflection = waterFresnel(voH, transmittedCosine(voH));
      const direct = distribution.mul(masking).mul(interfaceReflection)
        .mul(light.z).mul(mix(0.44, 0.29, light.y)).div(noV.mul(4)).toVar();
      glint.assign(direct.div(direct.mul(0.19).add(1)));
    });

    const threshold = mix(0.35, 0.178, sea).toVar();
    const whitecap = smoothstep(threshold, threshold.add(0.092), compression.add(detail.x.mul(0.12)))
      .mul(smoothstep(0.16, 0.88, relativeHeight)).mul(smoothstep(0.36, 0.93, sea)).toVar();
    const foamDomain = vec2(dot(vRest, wind.zx.mul(vec2(1, -1))), dot(vRest, wind.xz))
      .mul(vec2(1.45, 0.56)).toVar();
    const foamFootprint = fwidth(foamDomain).toVar();
    const foamDetail = float(1).sub(smoothstep(0.23, 0.79, foamFootprint.x.max(foamFootprint.y)));
    const foam = float(0).toVar();
    If(whitecap.greaterThan(0.002), () => {
      const breakup = gradientNoise(foamDomain.add(vec2(7.5, -12.2).add(vec2(0.02, -0.10).mul(clock)))).x;
      const threads = float(1).sub(smoothstep(0.024, 0.21, breakup.add(detail.x.mul(0.48)).abs()));
      const coverage = mix(0.58, mix(0.21, 1.0, threads), foamDetail);
      foam.assign(whitecap.mul(coverage).mul(0.90));
    });
    const foamLight = mix(vec3(0.031, 0.048, 0.071), vec3(0.29, 0.37, 0.40), light.x)
      .add(sky.sunColor.mul(light.z).mul(sunFacing.mul(0.32).add(0.06)));

    const water = mix(body.add(throughCrest), reflected, fresnel).add(sky.sunColor.mul(glint));
    const fog = float(1).sub(distance.mul(-0.00165).exp());
    return mix(mix(water, foamLight, foam), sky.atmosphere(view.negate()), fog);
  });

  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = displacement();
  material.colorNode = vec4(waterColor(), 1);
  return material;
}

function smooth(lo, hi, value) {
  const x = THREE.MathUtils.clamp((value - lo) / (hi - lo), 0, 1);
  return x * x * (3 - 2 * x);
}

function setSun(minutes, sun, light) {
  const hourAngle = (minutes / 60 - 12) * Math.PI / 12;
  const latitude = THREE.MathUtils.degToRad(31);
  const heading = THREE.MathUtils.degToRad(11.5);
  const horizontal = Math.sin(hourAngle);
  const north = -Math.sin(latitude) * Math.cos(hourAngle);
  const elevation = Math.cos(latitude) * Math.cos(hourAngle);
  sun.value.set(
    horizontal * Math.sin(heading) + north * Math.cos(heading),
    elevation,
    -horizontal * Math.cos(heading) + north * Math.sin(heading),
  ).normalize();
  light.value.set(
    smooth(-0.25, 0.155, elevation),
    1 - smooth(0.045, 0.40, elevation),
    smooth(-0.016, 0.045, elevation),
  );
}

function formatTime(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}

export async function start({ progress, error }) {
  const adapter = await navigator.gpu.requestAdapter({ featureLevel: "compatibility" });
  if (!adapter) {
    throw new Error("WebGPU could not find a graphics adapter. Enable graphics acceleration and try reloading.");
  }

  progress("Connecting to the graphics device…");
  const device = await adapter.requestDevice();
  const software = adapter.info?.isFallbackAdapter === true;
  const touch = matchMedia("(pointer: coarse)").matches;
  const stage = document.querySelector("#stage");
  const fieldset = document.querySelector("#controls");
  const stateInput = document.querySelector("#sea-state");
  const timeInput = document.querySelector("#time-of-day");
  const stateValue = document.querySelector("#sea-value");
  const timeValue = document.querySelector("#time-value");
  const driftButton = document.querySelector("#drift");
  const driftValue = document.querySelector("#drift-value");
  const fpsCap = document.querySelector("#fps-cap");
  const fpsRate = document.querySelector("#fps-rate");

  const renderer = new THREE.WebGPURenderer({ device, antialias: false, alpha: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-label", "Live rendering of open water");
  stage.append(renderer.domElement);

  let halted = false;
  function halt(message) {
    if (halted) return;
    halted = true;
    error(message);
  }
  renderer.onDeviceLost = () => halt("The graphics device disconnected. Reload to reconnect to WebGPU.");
  device.addEventListener("uncapturederror", (event) => {
    event.preventDefault();
    halt("WebGPU stopped rendering. " + event.error.message);
  });

  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) {
    throw new Error("The WebGPU renderer could not start on this device.");
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.16, 26_000);
  const portrait = stage.clientWidth / Math.max(1, stage.clientHeight) < 0.9;
  const bearing = portrait ? THREE.MathUtils.degToRad(5.7) : 0;
  camera.position.set(-42 * Math.sin(bearing), 4.98, -21 + 42 * Math.cos(bearing));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3.98, -21);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.enablePan = false;
  controls.rotateSpeed = 0.52;
  controls.zoomSpeed = 0.64;
  controls.minPolarAngle = THREE.MathUtils.degToRad(57);
  controls.maxPolarAngle = Math.PI * 0.5 + 0.003;
  controls.minDistance = 14;
  controls.maxDistance = 78;
  controls.update();

  const clock = uniform(0);
  const sea = uniform(Number(stateInput.value) / 100);
  const sun = uniform(new THREE.Vector3());
  const light = uniform(new THREE.Vector3());
  const sky = makeSky(sun, light, clock);

  const { geometry, gridGrowth } = touch ? makeOceanGeometry(144, 224) : makeOceanGeometry(192, 320);
  const ocean = new THREE.Mesh(geometry, makeWaterMaterial(clock, sea, sun, light, sky, gridGrowth));
  ocean.frustumCulled = false;
  scene.add(ocean);

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMaterial.colorNode = vec4(sky.radiance(positionLocal.normalize(), float(1), float(0)), 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(22_000, 48, 24), skyMaterial);
  dome.renderOrder = 1;
  dome.frustumCulled = false;
  scene.add(dome);

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const hdr = scenePass.getTextureNode("output");
  const glow = bloom(hdr, 0.27, 0.45, 1.28);
  const fromCenter = screenUV.sub(0.5);
  const vignette = float(1).sub(dot(fromCenter, fromCenter).mul(0.21));
  pipeline.outputNode = vec4(hdr.rgb.add(glow.rgb).mul(vignette), 1);

  function syncSea() {
    sea.value = Number(stateInput.value) / 100;
    stateValue.value = stateInput.value + "%";
    stateInput.style.setProperty("--fill", stateValue.value);
    stateInput.setAttribute("aria-valuetext", stateValue.value);
  }

  function syncTime() {
    const minutes = Number(timeInput.value);
    timeValue.value = formatTime(minutes);
    timeInput.style.setProperty("--fill", (minutes / 14.4) + "%");
    timeInput.setAttribute("aria-valuetext", timeValue.value);
    setSun(minutes, sun, light);
  }

  let drift = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  function syncDrift() {
    driftButton.setAttribute("aria-pressed", String(drift));
    driftValue.textContent = drift ? "ON" : "OFF";
  }
  stateInput.addEventListener("input", syncSea);
  timeInput.addEventListener("input", syncTime);
  driftButton.addEventListener("click", () => {
    drift = !drift;
    syncDrift();
  });
  syncSea();
  syncTime();
  syncDrift();

  let interacting = false;
  let lastInteraction = -Infinity;
  controls.addEventListener("start", () => { interacting = true; });
  controls.addEventListener("end", () => {
    interacting = false;
    lastInteraction = performance.now();
  });

  const pixelBudget = software ? 820_000 : touch ? 1_250_000 : 2_850_000;
  const minScale = software ? 0.47 : 0.52;
  let scale = software ? 0.77 : 1;
  function resize() {
    const width = Math.max(16, stage.clientWidth);
    const height = Math.max(16, stage.clientHeight);
    const textureLimit = device.limits.maxTextureDimension2D;
    const maxDpr = Math.min(window.devicePixelRatio || 1, 1.65,
      Math.sqrt(pixelBudget / (width * height)), textureLimit / Math.max(width, height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(maxDpr * scale);
    renderer.setSize(width, height, false);
  }

  let driftTime = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const cameraOffset = new THREE.Vector3();
  function draw(delta, now) {
    if (drift && !interacting && now - lastInteraction > 1800) {
      const before = Math.sin(driftTime * 0.098);
      driftTime += delta;
      const range = 0.103 * THREE.MathUtils.clamp(camera.aspect / 1.05, 0.44, 1);
      const shift = range * (Math.sin(driftTime * 0.098) - before);
      cameraOffset.copy(camera.position).sub(controls.target).applyAxisAngle(up, shift);
      camera.position.copy(controls.target).add(cameraOffset);
    }
    controls.update(delta);
    dome.position.copy(camera.position);
    ocean.position.set(camera.position.x, 0, camera.position.z);
    pipeline.render();
  }

  progress("Compiling the ocean and sky shaders…");
  resize();
  device.pushErrorScope("validation");
  try {
    await scenePass.compileAsync(renderer);
    draw(0, performance.now());
    await device.queue.onSubmittedWorkDone();
  } finally {
    const gpuError = await device.popErrorScope();
    if (gpuError) throw new Error("The WebGPU shader could not start. " + gpuError.message);
  }
  if (halted) throw new Error("WebGPU was interrupted while preparing the first frame.");

  let previous = 0;
  let nextFrame = 0;
  let pending = 0;
  let sampleStart = 0;
  let sampleFrames = 0;
  let lowWindows = 0;
  let highWindows = 0;
  let sizeChanged = false;
  let target = touch || software ? 30 : 60;

  function resetTiming() {
    previous = 0;
    nextFrame = 0;
    sampleStart = 0;
    sampleFrames = 0;
    lowWindows = 0;
    highWindows = 0;
    fpsRate.value = "—";
  }
  function onFrame(now) {
    if (halted || document.hidden) return;
    const spacing = 1000 / target;
    if (now + 1.5 < nextFrame || pending >= 2) return;
    nextFrame = now - nextFrame > spacing ? now + spacing : nextFrame + spacing;

    if (sizeChanged) {
      resize();
      sizeChanged = false;
    }

    const delta = previous ? Math.min((now - previous) / 1000, 0.10) : 0;
    previous = now;
    clock.value += delta;
    try {
      draw(delta, now);
    } catch (failure) {
      halt("WebGPU stopped rendering. " + failure.message);
      return;
    }
    pending++;
    const complete = () => { pending--; };
    device.queue.onSubmittedWorkDone().then(complete, complete);

    if (!sampleStart) sampleStart = now;
    sampleFrames++;
    if (now - sampleStart < 1100) return;

    const fps = 1000 * (sampleFrames - 1) / (now - sampleStart);
    fpsRate.value = String(Math.round(fps));
    sampleStart = now;
    sampleFrames = 1;
    lowWindows = fps < target * 0.78 ? lowWindows + 1 : 0;
    highWindows = fps > target * 0.96 ? highWindows + 1 : 0;
    if (lowWindows >= 2 && scale > minScale) {
      scale = Math.max(minScale, scale * 0.82);
      sizeChanged = true;
      lowWindows = 0;
    } else if (highWindows >= 7 && scale < 1 && !software) {
      scale = Math.min(1, scale * 1.10);
      sizeChanged = true;
      highWindows = 0;
    }
  }

  fpsCap.addEventListener("change", () => {
    target = fpsCap.value === "auto" ? (touch || software ? 30 : 60) : Number(fpsCap.value);
    resetTiming();
  });
  document.addEventListener("visibilitychange", resetTiming);
  window.addEventListener("resize", () => { sizeChanged = true; });

  fieldset.disabled = false;
  fpsCap.disabled = false;
  stage.dataset.ready = "";
  await renderer.setAnimationLoop(onFrame);
}
