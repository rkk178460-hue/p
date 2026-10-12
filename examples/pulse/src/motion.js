// Pure timing primitives: seek any frame without evaluating previous frames.
export const clamp = (x) => Math.max(0, Math.min(1, x));
export const ease = (x) => { const v = clamp(x); return v * v * (3 - 2 * v); };
export const mod = (x, period) => ((x % period) + period) % period;
export const layerOffset = (camera, ratio, period) => mod(camera * (ratio - 1), period);
export const phases = (t) => ({
  fade: ease(t / 0.8) * (1 - ease((t - 14.1) / 0.9)),
  tunnel: ease((t - 4.5) / 1.5),
  resonance: ease((t - 10) / 2.5),
});
