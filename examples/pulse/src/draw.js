import {phases} from './motion.js';
import {palette} from './palette.js';
import {convergence} from './scenes/convergence.js';
import {velocity} from './scenes/velocity.js';
import {resonance} from './scenes/resonance.js';

// Evaluate the entire frame from its index. No persisted animation state.
export function draw(ctx, frame, w = 1280, h = 720, fps = 60) {
  const t = frame / fps;
  ctx.setTransform(w / 1280, 0, 0, h / 720, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
  ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 1280, 720);
  const {fade, tunnel: phase, resonance: end} = phases(t);
  ctx.save(); ctx.translate(640, 360);
  ctx.globalAlpha = fade;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 470);
  glow.addColorStop(0, palette.field); glow.addColorStop(1, palette.background);
  ctx.fillStyle = glow; ctx.fillRect(-640, -360, 1280, 720);

  const line = (points, color, alpha, width = 1) => {
    ctx.globalAlpha = fade * alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
    ctx.stroke();
  };
  const project = (x, y, z, rot = 0) => {
    const a = x * Math.cos(rot) - z * Math.sin(rot);
    const b = x * Math.sin(rot) + z * Math.cos(rot);
    const scale = 880 / (b + 950);
    return [a * scale, y * scale];
  };
  convergence(ctx, t, fade, phase, end, project);
  velocity(ctx, t, phase, end, line);
  resonance(ctx, t, fade, end, project, line);
  ctx.restore();
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#b7c1c5'; ctx.font = '28px PulseMono';
  ctx.fillText('P U L S E', 56, 68);
  ctx.fillStyle = palette.accent; ctx.fillRect(56, 88, 24, 2);
  ctx.fillStyle = palette.muted; ctx.font = '16px PulseMono';
  ctx.fillText(t < 5 ? '01 / CONVERGENCE' : t < 10.5 ? '02 / VELOCITY' : '03 / RESONANCE', 56, 666);
  ctx.textAlign = 'right'; ctx.fillText('MOTION STUDY / 15', 1224, 666);
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}
