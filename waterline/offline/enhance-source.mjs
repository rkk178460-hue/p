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
export function configureClouds(clouds) { offlineClouds = clouds; }
function makeSky(sun, light, clock) {`);
  const radianceStart = source.indexOf('  // Both the sky dome and the water call this function');
  const radianceEnd = source.indexOf('\n  return { atmosphere, radiance, sunColor };', radianceStart);
  if (radianceStart < 0 || radianceEnd < 0) throw Error('Sky boundaries missing');
  source = source.slice(0, radianceStart) + `  // The dome and reflected sky sample one linear-HDR cloud solution. Reflections
  // use mip-filtered radiance/transmittance; only the visible sky adds the sun disk.
  const radiance = Fn(([ray, diskWeight, reflectionSpread]) => {
    const uv = vec2(ray.z.atan(ray.x).div(TAU).add(0.5), ray.y.clamp(0, 1).asin().mul(2 / Math.PI));
    const lod = reflectionSpread.mul(offlineClouds.metadata.hemisphere[0] / TAU * 0.30).add(1).log2().max(0);
    const cloud = texture(offlineClouds.skyTexture, uv).level(lod).toVar();
    const rgb = atmosphere(ray).mul(cloud.a).add(cloud.rgb).toVar();
    const diskRadius = mix(0.00465, 0.0092, light.y);
    const disk = smoothstep(diskRadius.add(0.0012).cos(), diskRadius.sub(0.0012).cos(), dot(ray, sun));
    return rgb.add(sunColor.mul(disk.mul(diskWeight).mul(light.z).mul(18)).mul(cloud.a));
  });
  const directVisibility = Fn(([position]) => {
    const entry = position.add(sun.mul(float(1250).sub(position.y).div(sun.y.max(0.035))));
    const uv = vec3(entry.x.add(10500).div(24000).add(0.5).fract(), 0.5 / 96, entry.z.div(24000).add(0.5).fract());
    return texture3D(offlineClouds.fieldTexture, uv).level(0).g;
  });
` + source.slice(radianceEnd);
  replace('return { atmosphere, radiance, sunColor };', 'return { atmosphere, radiance, sunColor, directVisibility };');
  const waterStart = source.indexOf('function makeWaterMaterial(');
  const waterEnd = source.indexOf('\nfunction smooth(', waterStart);
  let water = source.slice(waterStart, waterEnd);
  water = water.replaceAll('light.z', 'sunVisible');
  water = water.replace('const sunFacing = dot(normal, sun).clamp(0, 1).toVar();',
    'const sunFacing = dot(normal, sun).clamp(0, 1).toVar();\n    const sunVisible = light.z.mul(sky.directVisibility(positionWorld)).toVar();');
  water = water.replace('const capillaryAlpha = mix(0.019, 0.056, sea).toVar();',
    'const capillaryAlpha = mix(0.022, 0.061, sea).mul(detail.x.mul(0.18).add(1)).toVar();');
  source = source.slice(0, waterStart) + water + source.slice(waterEnd);
  source += '\nexport { makeOceanGeometry, makeSky, makeWaterMaterial, setSun };\n';
  return source;
}
