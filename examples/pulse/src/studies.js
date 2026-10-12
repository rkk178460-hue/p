// Mechanism ports from motion-canvas/examples (MIT), not copies of footage.
// See docs/case-studies.md and licenses/motion-canvas-MIT.txt.
import {layerOffset, mod} from './motion.js';
const colors = ['#1b2227', '#35434b', '#7f9099', '#f87935'];
const begin = (ctx, w, h) => {
  ctx.setTransform(w / 1280, 0, 0, h / 720, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
  ctx.fillStyle = '#07090b'; ctx.fillRect(0, 0, 1280, 720);
};
// Parallax.tsx: offset = camera * (ratio - 1), repeat periodically.
// Replace the source sprite layers with four procedural silhouettes.
export function drawParallax(ctx, frame, w, h, fps = 60) {
  begin(ctx, w, h);
  // Six-second temporal loop: camera delta 1280 is a common layer period.
  const t = frame / fps, camera = 1280 * t / 6;
  [0, 0.5, 1, 3].forEach((ratio, layer) => {
    ctx.fillStyle = colors[layer];
    const period = 640, offset = layerOffset(camera, ratio, period);
    for (let copy = -2; copy < 4; copy++) {
      const base = copy * period + offset;
      ctx.beginPath(); ctx.moveTo(base, 720);
      for (let i = 0; i <= 8; i++) {
        const x = i * 80;
        // Endpoint heights match across periods, avoiding seams.
        const y = 300 + layer * 84 - 40 * Math.sin(i * Math.PI / 4) - 24 * Math.sin(i * Math.PI / 2);
        ctx.lineTo(base + x, y);
      }
      ctx.lineTo(base + period, 720); ctx.closePath(); ctx.fill();
    }
  });
  ctx.fillStyle = '#d6e0e4'; ctx.font = '28px PulseMono';
  ctx.fillText('DEPTH / FOUR LAYERS', 56, 68);
}
// logo.tsx: repeating trails clipped locally, simultaneous motion.
// Canvas save/clip/restore isolates masks from unrelated layers.
export function drawMaskTrails(ctx, frame, w, h, fps = 60) {
  begin(ctx, w, h);
  const t = frame / fps;
  ctx.save(); ctx.translate(640, 380); ctx.rotate(-Math.PI / 4);
  [-100, 0, 100].forEach((x, i) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x - 18, -280, 36, 500); ctx.clip();
    ctx.fillStyle = i === 1 ? '#f87935' : '#d6e0e4';
    for (let k = -2; k < 7; k++) {
      const y = k * 144 - mod(t * (72 + i * 72), 144);
      ctx.fillRect(x - 18, y - 280, 36, 96);
    }
    ctx.restore();
  });
  ctx.rotate(t * Math.PI / 2); ctx.strokeStyle = '#d6e0e4'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.rect(-42, -42, 84, 84); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#d6e0e4'; ctx.font = '28px PulseMono';
  ctx.fillText('MASK / LOCAL TRAILS', 56, 68);
}
