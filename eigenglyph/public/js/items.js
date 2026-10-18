// ─────────────────────────────────────────────────────────────
//  3D models of the items (shotgun, knife, soda) built from
//  primitives. Used for other players' weapons and for the
//  rotating 3D icons in the hotbar.  Local space: x right, y up,
//  z forward (barrel / blade direction).
// ─────────────────────────────────────────────────────────────
import { makePrim, setRotYXZ, mul3, hitPrim, HIT, BOX, CYL, SPHERE } from './prims.js';
import { M, BASE } from './mats.js';

const rot = (yaw, pitch, roll) => { const m = new Float32Array(9); setRotYXZ(m, yaw, pitch, roll); return m; };
const I3 = rot(0, 0, 0);

// [type, mat, x, y, z, sx, sy, sz, localRotation, tag]
export const ITEM_PARTS = [
  [ // SHOTGUN
    [BOX, M.GUNMETAL, 0, 0, 0.02, 0.045, 0.058, 0.13, I3],          // receiver
    [CYL, M.GUNMETAL, 0, 0.028, 0.44, 0.026, 0, 0.30, I3],          // barrel
    [CYL, M.GUNMETAL, 0, -0.026, 0.37, 0.022, 0, 0.22, I3],         // magazine tube
    [BOX, M.GRIP, 0, -0.03, 0.36, 0.043, 0.036, 0.09, I3],          // pump
    [BOX, M.WOOD, 0, -0.1, -0.1, 0.03, 0.075, 0.035, rot(0, 0.55, 0)], // pistol grip
    [BOX, M.WOOD, 0, -0.045, -0.27, 0.034, 0.05, 0.14, rot(0, 0.14, 0)], // stock
    [SPHERE, M.BRASS, 0, 0.062, 0.72, 0.012, 0, 0, I3],             // bead sight
  ],
  [ // KNIFE
    [BOX, M.GRIP, 0, 0, -0.05, 0.022, 0.03, 0.07, I3],              // handle
    [BOX, M.GUNMETAL, 0, 0, 0.025, 0.03, 0.042, 0.01, I3],          // guard
    [BOX, M.BLADE, 0, 0.005, 0.16, 0.007, 0.03, 0.13, I3],          // blade
    [BOX, M.BLADE, 0, 0.016, 0.3, 0.006, 0.018, 0.035, rot(0, -0.55, 0)], // tip
  ],
  [ // SODA (axis = z)
    [CYL, M.CAN, 0, 0, 0, 0.034, 0, 0.066, I3, 1],                  // can
    [CYL, M.CAN_TOP, 0, 0, 0.069, 0.03, 0, 0.004, I3],              // lid
  ],
];

const tmp = new Float32Array(9);
// write the item's prims into pool starting at n; returns new n
// pos: world position of item origin, R: item rotation (3x3, columns), s: scale
export function placeItem(pool, n, out, w, pos, R, s = 1, th = 1) {
  for (const part of ITEM_PARTS[w]) {
    const [type, mat, x, y, z, a, b, c, lr, tag] = part;
    const p = pool[n++];
    p.type = type; p.mat = mat; p.tag = tag || 0;
    // th > 1 makes the item chunkier (thicker, same length) — used for icons
    p.sx = a * s * th; p.sy = b * s * th; p.sz = (type === BOX ? c : c) * s * (type === SPHERE ? th : 1);
    const lx = x * s * th, ly = y * s * th, lz = z * s;
    p.px = pos[0] + R[0] * lx + R[3] * ly + R[6] * lz;
    p.py = pos[1] + R[1] * lx + R[4] * ly + R[7] * lz;
    p.pz = pos[2] + R[2] * lx + R[5] * ly + R[8] * lz;
    mul3(tmp, R, lr); p.m.set(tmp);
    out.push(p);
  }
  return n;
}

// ── hotbar icon: the 3D item drawn as line-art ──
// Every cell is sampled 3×3. Cells fully covered get a shading symbol,
// partly covered cells get the symbol whose shape matches best
// (_ - | / \ [ ] ...) — so thin barrels and blades become clean lines.
const iconPool = Array.from({ length: 8 }, makePrim);
const RAMP = '.,-~:;=!*#$@';
const TEMPLATES = [
  ['_', '000000111'], ['-', '000111000'], ['‾', '111000000'], ['=', '111000111'],
  ['|', '010010010'], ['/', '001010100'], ['\\', '100010001'], ['[', '100100100'], [']', '001001001'],
  ['.', '000000010'], ["'", '010000000'], ['o', '000010000'], ['(', '010100010'], [')', '010001010'],
  ['/', '011110100'], ['\\', '110011001'], ['/', '001011110'], ['\\', '100110011'],
  ['L', '100100111'], ['J', '001001111'], ['F', '111100100'], ['7', '111001001'],
].map(([c, m]) => [c, [...m].map(Number)]);

export function drawItemIcon(layer, x0, y0, w, h, item, t, active, bg) {
  const prims = [];
  const spin = active ? Math.sin(t * 1.4) * 0.35 : 0;
  let R, center, s;
  // shotgun and knife lie diagonally (classic inventory icon look)
  if (item === 0) { R = rot(Math.PI / 2 + spin * 0.3, -0.18, 0.1); center = 0.16; s = 1.5; }
  else if (item === 1) { R = rot(Math.PI / 2 + spin * 0.3, -0.35, 0); center = 0.12; s = 2.7; }
  else { R = rot(0.5 + spin * 2, -Math.PI / 2 + 0.3, 0); center = 0; s = 7.5; }
  const D = 2.0;
  const pos = [-(R[6] * center * s), -(R[7] * center * s), -D - R[8] * center * s];
  placeItem(iconPool, 0, prims, item, pos, R, s, item === 2 ? 1 : 2.2);
  const aspect = (w * layer.cellW) / (h * layer.cellH);
  const tanY = 0.26, tanX = tanY * aspect;
  const Lx = -0.45, Ly = 0.7, Lz = 0.55;
  const sub = new Array(9);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let covered = 0, lumSum = 0, mat = -1, best = null, blz = 0, bp = null;
      for (let k = 0; k < 9; k++) {
        const sx = (xx + ((k % 3) + 0.5) / 3) / w * 2 - 1;
        const sy = 1 - (yy + (Math.floor(k / 3) + 0.5) / 3) / h * 2;
        let dx = sx * tanX, dy = sy * tanY, dz = -1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let bt = 1e9, hp = null, nx = 0, ny = 0, nz = 0, lz = 0;
        for (const p of prims) {
          const tt = hitPrim(p, 0, 0, 0, dx, dy, dz);
          if (tt > 0 && tt < bt) { bt = tt; hp = p; nx = HIT.nx; ny = HIT.ny; nz = HIT.nz; lz = HIT.lz; }
        }
        sub[k] = hp ? 1 : 0;
        if (!hp) continue;
        covered++;
        const b = BASE[hp.mat];
        const ndl = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
        const facing = Math.max(0, -(nx * dx + ny * dy + nz * dz));
        const dn = dx * nx + dy * ny + dz * nz;
        const sp = Math.max(0, (dx - 2 * dn * nx) * Lx + (dy - 2 * dn * ny) * Ly + (dz - 2 * dn * nz) * Lz);
        lumSum += 0.35 + ndl * 0.55 + facing * 0.25 + Math.pow(sp, 12) * b.spec * 0.8;
        if (k === 4 || !bp) { bp = hp; blz = lz; }
      }
      if (!covered) { layer.put(x0 + xx, y0 + yy, ' ', null, bg); continue; }
      let lum = lumSum / covered;
      if (!active) lum *= 0.75;
      let ch;
      if (covered >= 8) ch = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
      else {
        let bd = 99;
        for (const [c, m] of TEMPLATES) {
          let d = 0;
          for (let k = 0; k < 9; k++) if (m[k] !== sub[k]) d++;
          if (d < bd) { bd = d; ch = c; }
        }
        lum = Math.max(lum, 0.55);
      }
      let col = BASE[bp.mat].c;
      if (bp.mat === M.CAN && Math.abs(blz) < bp.sz * 0.4) col = [190, 190, 196];   // label band
      const k = 0.45 + lum * 1.15;
      layer.put(x0 + xx, y0 + yy, ch, [col[0] * k, col[1] * k, col[2] * k], bg);
    }
  }
}
