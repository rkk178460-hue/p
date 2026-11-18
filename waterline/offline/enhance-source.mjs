export function enhanceSource(source) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw Error('Waterline source anchor missing: ' + before.slice(0, 70));
    source = source.replace(before, after);
  };
  replace('const indices = new Uint16Array(spokes * (2 * rings - 1) * 3);',
    'const IndexArray = 1 + rings * spokes > 65536 ? Uint32Array : Uint16Array;\n  const indices = new IndexArray(spokes * (2 * rings - 1) * 3);');
  replace('uniform, varyingProperty, vec2, vec3, vec4,', 'uniform, varyingProperty, vec2, vec3, vec4, texture, texture3D,');
  const detailStart = source.indexOf('const WATER_DETAIL = [');
  const detailEnd = source.indexOf('\n];', detailStart) + 3;
  source = source.slice(0, detailStart) + `const WATER_DETAIL = [
  { frequency: [0.12, 0.27], height: 0.23, heading: 21, weight: 0.36, flow: [0.045, -0.28] },
  { frequency: [0.29, 0.59], height: 0.085, heading: -17, weight: 0.25, flow: [-0.12, -0.46] },
  { frequency: [0.71, 1.31], height: 0.034, heading: 63, weight: 0.17, flow: [0.21, -0.68] },
  { frequency: [1.70, 3.10], height: 0.011, heading: 39, weight: 0.11, flow: [0.27, -0.91] },
  { frequency: [4.60, 6.80], height: 0.0038, heading: -28, weight: 0.07, flow: [-0.31, -1.16] },
  { frequency: [9.00, 14.0], height: 0.0012, heading: 80, weight: 0.04, flow: [0.41, -1.37] },
];` + source.slice(detailEnd);
  replace('function makeSky(sun, light, clock) {', `let offlineClouds;
const SOLAR_RADIUS = 0.00465;
const SOLAR_IRRADIANCE = 0.16;
const SOLAR_RADIANCE = SOLAR_IRRADIANCE / (Math.PI * Math.sin(SOLAR_RADIUS) ** 2);
export function configureClouds(clouds) { offlineClouds = clouds; }
function makeSky(sun, light, clock) {`);
  const radianceStart = source.indexOf('  const atmosphere = Fn(');
  const radianceEnd = source.indexOf('\n  return { atmosphere, radiance, sunColor };', radianceStart);
  if (radianceStart < 0 || radianceEnd < 0) throw Error('Sky boundaries missing');
  source = source.slice(0, radianceStart) + `  const sampleSky = (ray, lod) => {
    const uv = vec2(ray.z.atan(ray.x).div(TAU).add(0.5), ray.y.clamp(0, 1).asin().mul(2 / Math.PI));
    return texture(offlineClouds.skyTexture, uv).level(lod);
  };
  const diffuseSky = vec3(...offlineClouds.diffuseSky);
  const atmosphere = Fn(([ray]) => sampleSky(ray, float(5)).rgb);
  const radiance = Fn(([ray, diskWeight]) => {
    const skySample = sampleSky(ray, float(0)).toVar();
    const disk = smoothstep(Math.cos(SOLAR_RADIUS + 0.00032), Math.cos(SOLAR_RADIUS - 0.00032), dot(ray, sun));
    return skySample.rgb.add(sunColor.mul(disk.mul(diskWeight).mul(light.z).mul(SOLAR_RADIANCE)).mul(skySample.a));
  });
  const reflection = Fn(([ray, spread]) => {
    const lod = spread.mul(offlineClouds.metadata.hemisphere[0] / TAU * 0.43).add(1).log2();
    const side = vec3(ray.z, 0, ray.x.negate()).mul(spread.mul(0.43)).toVar();
    const left = sampleSky(ray.add(side).normalize(), lod).rgb;
    const right = sampleSky(ray.sub(side).normalize(), lod).rgb;
    return sampleSky(ray, lod).rgb.mul(0.60).add(left.add(right).mul(0.20));
  });
  const directVisibility = Fn(([position]) => {
    const entry = position.add(sun.mul(float(1250).sub(position.y).div(sun.y.max(0.035))));
    const uv = vec3(entry.x.add(10500).div(24000).add(0.5).fract(), 0.5 / 96, entry.z.div(24000).add(0.5).fract());
    return texture3D(offlineClouds.fieldTexture, uv).level(0).g;
  });
` + source.slice(radianceEnd);
  replace('return { atmosphere, radiance, sunColor };', 'return { atmosphere, radiance, reflection, diffuseSky, sunColor, directVisibility };');
  replace('const extinction = vec3(0.92, 0.29, 0.18);', `const extinction = vec3(0.59, 0.13, 0.081);
  const backscatter = vec3(0.018, 0.058, 0.047);`);
  replace('const rippleStrength = sea.mul(0.98).add(0.48).toVar();', `const gustDomain = vRest.mul(0.031).add(vec2(8.7, -11.2)).toVar();
    const gustFootprint = fwidth(gustDomain).toVar();
    const resolvedGust = float(1).sub(smoothstep(0.24, 0.80, gustFootprint.x.max(gustFootprint.y)));
    const gust = gradientNoise(gustDomain).x.mul(resolvedGust).mul(0.68).add(1).toVar();
    const rippleStrength = sea.mul(0.98).add(0.48).mul(gust).toVar();`);
  replace('const noV = dot(normal, view).clamp(0.004, 1).toVar();', `const signedNoV = dot(normal, view).toVar();
    const noV = signedNoV.clamp(0.004, 1).toVar();
    const sunVisible = light.z.mul(sky.directVisibility(positionWorld)).toVar();`);
  replace('const capillaryAlpha = mix(0.019, 0.056, sea).toVar();',
    'const capillaryAlpha = mix(0.026, 0.068, sea).mul(detail.x.mul(0.50).add(1)).mul(gust).toVar();');
  replace(`const ambient = mix(vec3(0.010, 0.021, 0.038), vec3(0.060, 0.135, 0.165), light.x);
    const sunlight = sky.sunColor.mul(sun.y.clamp(0, 1).mul(light.z).mul(0.095));
    const opticalDepth = float(3.6).div(noT).toVar();
    const body = ambient.add(sunlight).mul(vec3(0.072, 0.258, 0.297))
      .mul(vec3(1).sub(extinction.mul(opticalDepth).negate().exp())).toVar();`,
  `const irradiance = sky.diffuseSky.add(sky.sunColor.mul(sunVisible.mul(SOLAR_IRRADIANCE / Math.PI).mul(sun.y.max(0))));
    const opticalDepth = mix(4.7, 2.2, smoothstep(0.03, 0.95, relativeHeight)).div(noT);
    const body = irradiance.mul(backscatter.div(extinction))
      .mul(vec3(1).sub(extinction.mul(opticalDepth).negate().exp())).toVar();`);
  replace('crown.mul(backlight).mul(light.z)', 'crown.mul(backlight).mul(sunVisible)');
  replace('sky.radiance(reflectedRay, float(0), spread)', 'sky.reflection(reflectedRay, spread)');
  replace('If(light.z.greaterThan(0.001).and(sunFacing.greaterThan(0)),', 'If(sunVisible.greaterThan(0.001).and(sunFacing.greaterThan(0)).and(signedNoV.greaterThan(0)),');
  replace('const solarRadius = mix(0.0024, 0.0046, light.y).toVar();', 'const solarRadius = float(SOLAR_RADIUS * 0.5);');
  replace(`const distribution = dot(halfSlope, halfSlope).negate().exp()
        .div(solarAlpha.x.mul(solarAlpha.y).mul(Math.PI).mul(noH.pow(4)).max(0.0000001)).toVar();`,
  `const slopeSquared = dot(halfSlope, halfSlope).toVar();
      // Conserve the distribution integral while giving sparse steeper facets a wider tail.
      const distribution = slopeSquared.negate().exp().mul(0.86)
        .add(slopeSquared.mul(-0.25).exp().mul(0.035))
        .div(solarAlpha.x.mul(solarAlpha.y).mul(Math.PI).mul(noH.pow(4)).max(0.0000001)).toVar();`);
  replace(`.mul(light.z).mul(mix(0.44, 0.29, light.y)).div(noV.mul(4)).toVar();
      glint.assign(direct.div(direct.mul(0.19).add(1)));`,
  `.mul(sunVisible).mul(SOLAR_IRRADIANCE).div(noV.mul(4)).toVar();
      glint.assign(direct.mul(smoothstep(0, 0.018, signedNoV)));`);
  replace(`const foamLight = mix(vec3(0.031, 0.048, 0.071), vec3(0.29, 0.37, 0.40), light.x)
      .mul(foamSkyView).add(sky.sunColor.mul(light.z).mul(foamSunFacing).mul(0.38));`,
  `const foamLight = sky.diffuseSky.mul(foamSkyView).add(sky.sunColor.mul(sunVisible)
      .mul(foamSunFacing).mul(SOLAR_IRRADIANCE / Math.PI))
      .mul(vec3(0.79, 0.84, 0.84)).mul(mix(0.65, 1, foamCoverage));`);
  source += '\nexport { makeOceanGeometry, makeSky, makeWaterMaterial, setSun };\n';
  return source;
}
