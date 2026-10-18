// ─────────────────────────────────────────────────────────────
//  ART: draw a picture in high resolution, then rebuild it out of
//  thousands of tiny symbols on the art layer (3× smaller than UI).
//  Used for rank emblems. Results are cached per size.
// ─────────────────────────────────────────────────────────────
const RAMP = ' .,:;-=+*#%@';
const cache = new Map();

// layer: art layer, x0,y0,w,h: art cells, key: cache key, paint(ctx, W, H)
export function paintArt(layer, x0, y0, w, h, key, paint, opts = {}) {
  const ck = `${key}|${w}x${h}`;
  let cells = cache.get(ck);
  if (!cells) {
    // canvas with square pixels: each cell → SX × SY pixels matching the cell's aspect
    const SX = 4, SY = Math.max(4, Math.round(4 * layer.cellH / layer.cellW));
    const c = document.createElement('canvas');
    c.width = w * SX; c.height = h * SY;
    const ctx = c.getContext('2d');
    paint(ctx, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    cells = new Array(w * h);
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let py = 0; py < SY; py++) for (let px = 0; px < SX; px++) {
        const i = ((cy * SY + py) * c.width + cx * SX + px) * 4, al = d[i + 3] / 255;
        r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al;
      }
      const n = SX * SY;
      if (a / n < 0.06) { cells[cy * w + cx] = null; continue; }
      r /= a; g /= a; b /= a;
      const cov = a / n;
      const lum = (0.3 * r + 0.55 * g + 0.15 * b) / 255 * Math.min(1, cov * 1.3);
      const ch = RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(lum * (RAMP.length - 1) * 1.15)))];
      cells[cy * w + cx] = [ch, Math.min(255, r * 1.1), Math.min(255, g * 1.1), Math.min(255, b * 1.1), cov];
    }
    cache.set(ck, cells);
    if (cache.size > 80) cache.delete(cache.keys().next().value);
  }
  const k = opts.k ?? 1, bg = opts.bg || [17, 18, 21];
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const c = cells[cy * w + cx];
    if (!c) { layer.put(x0 + cx, y0 + cy, ' ', null, bg); continue; }
    const f = c[4] * 0.22 * k;
    layer.put(x0 + cx, y0 + cy, c[0], [c[1] * k, c[2] * k, c[3] * k],
      [bg[0] * (1 - f) + c[1] * f, bg[1] * (1 - f) + c[2] * f, bg[2] * (1 - f) + c[3] * f]);
  }
}

// ───────────── rank emblems (vector drawings) ─────────────
const rgb = (c, m = 1, a = 1) => `rgba(${c[0] * m | 0},${c[1] * m | 0},${c[2] * m | 0},${a})`;

function badge(ctx, col, sides = 6, rot = Math.PI / 6) {
  const poly = (r) => { ctx.beginPath(); for (let i = 0; i < sides; i++) { const a = rot + i * Math.PI * 2 / sides; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); };
  const g = ctx.createRadialGradient(0, -12, 4, 0, 0, 52);
  g.addColorStop(0, rgb(col, 0.55)); g.addColorStop(1, rgb(col, 0.12));
  poly(46); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = rgb(col, 1.1); poly(46); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = rgb(col, 0.7); poly(40); ctx.stroke();
}
function wings(ctx, col, big) {
  ctx.fillStyle = rgb(col, 0.8);
  for (const s of [-1, 1]) {
    for (let i = 0; i < (big ? 4 : 3); i++) {
      ctx.beginPath();
      ctx.moveTo(s * 40, -8 + i * 9);
      ctx.quadraticCurveTo(s * (66 + i * 2), -22 + i * 10, s * (78 - i * 6), -30 + i * 14);
      ctx.quadraticCurveTo(s * (62 - i * 3), -6 + i * 10, s * 40, 2 + i * 9);
      ctx.fill();
    }
  }
}
const light = col => rgb(col.map(v => Math.min(255, v * 0.5 + 140)));

const MOTIF = [
  // 0 DOT — a glowing core with orbiting dots
  (ctx, col) => {
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 16);
    g.addColorStop(0, '#fff'); g.addColorStop(1, rgb(col, 0.9));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
    ctx.strokeStyle = rgb(col, 1); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.stroke();
    ctx.fillStyle = light(col);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 4, 0, 7); ctx.fill(); }
  },
  // 1 BLADE — crossed swords
  (ctx, col) => {
    for (const s of [-1, 1]) {
      ctx.save(); ctx.rotate(s * Math.PI / 4);
      const g = ctx.createLinearGradient(-5, 0, 5, 0); g.addColorStop(0, '#9aa3b5'); g.addColorStop(0.5, '#f4f6fa'); g.addColorStop(1, '#7a8295');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(5, -32); ctx.lineTo(5, 14); ctx.lineTo(-5, 14); ctx.lineTo(-5, -32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(col, 1.2); ctx.fillRect(-13, 14, 26, 5);
      ctx.fillStyle = '#3a2c22'; ctx.fillRect(-3.5, 19, 7, 16);
      ctx.fillStyle = rgb(col, 1.2); ctx.beginPath(); ctx.arc(0, 37, 4.5, 0, 7); ctx.fill();
      ctx.restore();
    }
  },
  // 2 WAVE — three rolling waves
  (ctx, col) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 1 ? light(col) : rgb(col, 1.25 - i * 0.15); ctx.lineWidth = 7 - i;
      ctx.beginPath();
      for (let x = -32; x <= 32; x += 2) ctx.lineTo(x, -16 + i * 16 + Math.sin(x / 7 + i) * 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(18, -28, 3, 0, 7); ctx.fill();
  },
  // 3 SHIELD — heater shield with bars
  (ctx, col) => {
    const path = () => { ctx.beginPath(); ctx.moveTo(-26, -30); ctx.lineTo(26, -30); ctx.lineTo(26, 0); ctx.quadraticCurveTo(24, 26, 0, 38); ctx.quadraticCurveTo(-24, 26, -26, 0); ctx.closePath(); };
    const g = ctx.createLinearGradient(0, -30, 0, 38); g.addColorStop(0, light(col)); g.addColorStop(1, rgb(col, 0.8));
    path(); ctx.fillStyle = g; ctx.fill();
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = rgb(col, 0.35);
    for (let i = 0; i < 4; i++) ctx.fillRect(-30, -22 + i * 14, 60, 5);
    ctx.restore();
    path(); ctx.lineWidth = 3; ctx.strokeStyle = '#e8ecf2'; ctx.stroke();
  },
  // 4 STAR — five-pointed star with sparkles
  (ctx, col) => {
    const star = (r1, r2) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? r2 : r1; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); };
    const g = ctx.createRadialGradient(0, -6, 2, 0, 0, 36); g.addColorStop(0, '#fff7d8'); g.addColorStop(1, rgb(col, 1.1));
    star(36, 15); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const [x, y] of [[-30, -26], [30, -24], [26, 28]]) { ctx.fillRect(x - 1, y - 5, 2, 10); ctx.fillRect(x - 5, y - 1, 10, 2); }
  },
  // 5 FORTRESS — castle with towers and gate
  (ctx, col) => {
    const g = ctx.createLinearGradient(0, -34, 0, 32); g.addColorStop(0, light(col)); g.addColorStop(1, rgb(col, 0.9));
    ctx.fillStyle = g;
    ctx.fillRect(-32, -14, 18, 46); ctx.fillRect(14, -14, 18, 46); ctx.fillRect(-12, -26, 24, 58); ctx.fillRect(-24, 2, 48, 30);
    for (const [x, y, w] of [[-32, -20, 18], [14, -20, 18], [-12, -32, 24]]) for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y, 4, 6);
    ctx.fillStyle = '#18120e'; ctx.beginPath(); ctx.moveTo(-8, 32); ctx.lineTo(-8, 16); ctx.arc(0, 16, 8, Math.PI, 0); ctx.lineTo(8, 32); ctx.fill();
    ctx.fillRect(-25, -4, 4, 8); ctx.fillRect(21, -4, 4, 8); ctx.fillRect(-2, -16, 4, 8);
  },
  // 6 SIGIL — rune circle
  (ctx, col) => {
    ctx.strokeStyle = light(col); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, 7); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = rgb(col, 1.3);
    ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2 * Math.PI / 3; ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); } ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, 30); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 32, Math.sin(a) * 32, 3.5, 0, 7); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
  },
  // 7 VORTEX — spiral
  (ctx, col) => {
    ctx.lineCap = 'round';
    for (let arm = 0; arm < 2; arm++) {
      ctx.beginPath();
      for (let t = 0; t < 14; t += 0.1) { const r = 2.6 * t, a = t * 0.9 + arm * Math.PI; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.strokeStyle = arm ? rgb(col, 1.3) : light(col); ctx.lineWidth = 5; ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 9); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
  },
];

// EIGEN — concentric rings in the color of every rank, λ in the core, crown and wings
function eigen(ctx, tiers) {
  wings(ctx, [240, 220, 160], true);
  for (let i = tiers.length - 2; i >= 0; i--) {
    ctx.beginPath(); ctx.arc(0, 0, 14 + i * 4.2, 0, 7);
    ctx.fillStyle = rgb(tiers[i].col, 1.05); ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 16); g.addColorStop(0, '#fffdf2'); g.addColorStop(1, '#e8dcb8');
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#1a1712'; ctx.font = 'bold 26px "DejaVu Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('λ', 0, 1);
  ctx.fillStyle = '#f4d478';
  ctx.beginPath(); ctx.moveTo(-22, -46); ctx.lineTo(-14, -60); ctx.lineTo(-6, -50); ctx.lineTo(0, -64); ctx.lineTo(6, -50); ctx.lineTo(14, -60); ctx.lineTo(22, -46); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; for (const x of [-14, 0, 14]) { ctx.beginPath(); ctx.arc(x, x ? -60 : -64, 2.5, 0, 7); ctx.fill(); }
}

export function emblemPainter(tier, tiers) {
  return (ctx, W, H) => {
    const S = Math.min(W / (tier >= 4 ? 170 : 104), H / (tier === 8 ? 140 : 104));
    ctx.translate(W / 2, H / 2 + (tier === 8 ? 8 * S : 0)); ctx.scale(S, S);
    if (tier === 8) return eigen(ctx, tiers);
    const col = tiers[tier].col;
    if (tier >= 4) wings(ctx, col, tier >= 6);
    badge(ctx, col, tier >= 6 ? 8 : 6, tier >= 6 ? Math.PI / 8 : Math.PI / 6);
    MOTIF[tier](ctx, col);
  };
}
