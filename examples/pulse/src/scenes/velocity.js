import {clamp, mod} from '../motion.js';
import {palette} from '../palette.js';

export function velocity(ctx, t, phase, end, line) {
  if (phase <= 0) return;
  ctx.save();
  ctx.rotate(0.18 * Math.sin(t * 0.8));
  const travel = (t - 5) * 1.3 + (t - 5) ** 2 * 0.07;
  for (let k = 0; k < 28; k++) {
    const z = mod(k - travel, 28);
    const r = 160 * 750 / (90 + z * 90);
    const rotation = 0.05 * z + t * 0.2;
    const points = [];
    for (let j = 0; j <= 6; j++) {
      const a = j / 6 * 2 * Math.PI + rotation;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const accent = k % 5 === 0;
    line(points, accent ? palette.accent : '#c6d4dc',
      phase * (1 - end) * clamp(z / 2) * (0.95 - z / 65), accent ? 2.5 : 1.5);
  }
  for (let j = 0; j < 6; j++) {
    const a = j / 6 * 2 * Math.PI + t * 0.2;
    line([[Math.cos(a) * 44, Math.sin(a) * 44],
      [Math.cos(a + 0.9) * 900, Math.sin(a + 0.9) * 900]], palette.muted, phase * (1 - end) * 0.25);
  }
  ctx.restore();
}
