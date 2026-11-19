// Spend most angular samples on the visible sky, retaining the whole hemisphere
// for sea reflections. The density falls linearly through each shoulder.
export function axis(limit, inner, outer, rate) {
  return { limit, inner, outer, rate, mass: limit + (rate - 1) * (inner + outer) / 2 };
}
export const azimuth = axis(Math.PI, 0.70, 0.91, 18);
export const elevation = axis(Math.PI / 2, 0.43, 0.65, 7);

export function projectAngle(t, { inner, outer, rate, mass }) {
  const ramp = Math.min(Math.max(t - inner, 0), outer - inner);
  return (rate*t - (rate - 1)*(ramp*ramp/(2*(outer-inner)) + Math.max(t-outer,0))) / mass;
}

export const inverseProjectionWGSL = `
fn angleAt(u:f32, inner:f32, outer:f32, rate:f32, total:f32)->f32 {
  let mass=u*total;
  let first=rate*inner;
  let second=first+(rate+1.0)*(outer-inner)*0.5;
  if(mass<first){return mass/rate;}
  if(mass>second){return outer+mass-second;}
  let dr=mass-first;
  return inner+2.0*dr/(rate+sqrt(max(1.0,rate*rate-2.0*(rate-1.0)*dr/(outer-inner))));
}
`;
export function wgslAxis({ inner, outer, rate, mass }) {
  return [inner,outer,rate,mass].map(x => x.toFixed(10)).join(',');
}
