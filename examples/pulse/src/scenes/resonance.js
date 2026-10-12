import {ease} from '../motion.js';
import {palette} from '../palette.js';

export function resonance(ctx, t, fade, end, project, line) {
  if (end <= 0) return;
  const local = t - 10;
  for (let k = 0; k < 9; k++) {
    const points = [];
    for (let j = 0; j <= 180; j++) {
      const a = j / 180 * 2 * Math.PI;
      const r = 170 + 12 * k;
      points.push(project(r * Math.cos(a),
        r * Math.sin(a) * Math.cos(local * 0.5 + k * 0.18),
        r * Math.sin(a) * Math.sin(local * 0.5 + k * 0.18), local * 0.32));
    }
    line(points, k === 4 ? palette.accent : palette.foreground,
      end * (k === 4 ? 0.95 : 0.65), k === 4 ? 2.5 : 1.5);
  }
  const pulse = ease((t - 12.2) / 1.5);
  if (pulse > 0) {
    ctx.globalAlpha = fade * end * (1 - pulse) * 0.7;
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 60 + pulse * 780, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.globalAlpha = fade * end;
  ctx.fillStyle = palette.accent; ctx.shadowColor = palette.accent; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.arc(0, 0, 5 + 2 * Math.sin(local * 3), 0, 2 * Math.PI); ctx.fill();
  ctx.shadowBlur = 0;
}
