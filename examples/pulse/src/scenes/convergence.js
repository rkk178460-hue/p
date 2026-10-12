import {ease} from '../motion.js';
import {palette} from '../palette.js';

export function convergence(ctx, t, fade, phase, end, project) {
  const gather = ease((t - 0.3) / 2.6);
  const scatter = 1 - gather;
  for (let i = 0; i < 1600; i++) {
    const a = i * 2.39996323;
    const b = (i % 43) / 43 * 2 * Math.PI;
    const r = 218 + 42 * Math.cos(b);
    const x = r * Math.cos(a) + Math.sin(i * 13.7) * 560 * scatter;
    const y = 42 * Math.sin(b) + Math.cos(i * 8.3) * 310 * scatter;
    const z = r * Math.sin(a) + Math.sin(i * 1.8) * 400 * scatter;
    const yy = y * Math.cos(0.6) - z * Math.sin(0.6);
    const zz = y * Math.sin(0.6) + z * Math.cos(0.6);
    const p = project(x, yy, zz, t * 0.46);
    const lift = 1 + end * 1.5;
    ctx.globalAlpha = fade * (1 - phase) * (0.5 + 0.5 * (i % 7) / 7);
    ctx.fillStyle = i % 29 === 0 ? palette.accent : palette.foreground;
    const size = i % 29 === 0 ? 3 : 1.8;
    ctx.fillRect(p[0] * lift, p[1] * lift, size, size);
  }
}
