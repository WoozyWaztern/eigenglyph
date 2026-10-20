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
// a part that sits inside a tilted pistol grip: same tilt, center moved by dy along the grip's own axis
function gripped(type, mat, cx, cy, cz, a, b, c, pitch, dy, tag) {
  const m = rot(0, pitch, 0);
  return [type, mat, cx + m[3] * dy, cy + m[4] * dy, cz + m[5] * dy, a, b, c, m, tag];
}

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
  [ // 3 DARK AK-47   (tag 2 = bolt, tag 3 = magazine) — real proportions, ~1 m long
    [BOX, M.AKBLACK, 0, 0, 0, 0.025, 0.032, 0.17, I3],               // receiver
    [CYL, M.AKBLACK, 0, 0.022, 0, 0.024, 0, 0.15, I3],              // rounded dust cover
    [BOX, M.STEEL, 0.03, 0.008, 0.09, 0.007, 0.006, 0.014, I3, 2],   // charging handle
    [BOX, M.AKBLACK, 0, 0.05, 0.19, 0.016, 0.013, 0.03, I3],        // rear sight block
    [CYL, M.AKBLACK, 0, 0.0, 0.34, 0.011, 0, 0.17, I3],             // barrel
    [CYL, M.AKBLACK, 0, 0.036, 0.3, 0.014, 0, 0.1, I3],             // gas tube
    [BOX, M.POLY, 0, -0.004, 0.28, 0.027, 0.026, 0.1, I3],          // handguard
    [BOX, M.AKBLACK, 0, 0.018, 0.42, 0.015, 0.025, 0.02, I3],       // gas block
    [BOX, M.AKBLACK, 0, 0.05, 0.47, 0.005, 0.028, 0.006, I3],       // front sight post
    [CYL, M.AKBLACK, 0, 0.0, 0.53, 0.016, 0, 0.026, I3],            // muzzle brake
    [BOX, M.POLY, 0, -0.09, 0.06, 0.017, 0.06, 0.034, rot(0, -0.25, 0), 3],    // magazine (top)
    [BOX, M.POLY, 0, -0.193, 0.106, 0.017, 0.055, 0.032, rot(0, -0.6, 0), 3],  // magazine (curve)
    [BOX, M.POLY, 0, -0.082, -0.1, 0.018, 0.055, 0.024, rot(0, 0.32, 0)],      // pistol grip
    [BOX, M.AKBLACK, 0, -0.048, -0.03, 0.005, 0.012, 0.032, I3],    // trigger guard
    [BOX, M.STEEL, 0, -0.042, -0.035, 0.003, 0.011, 0.004, I3],     // trigger
    [BOX, M.POLY, 0, -0.03, -0.3, 0.021, 0.038, 0.13, rot(0, 0.09, 0)],        // stock
    [BOX, M.AKBLACK, 0, -0.044, -0.432, 0.023, 0.052, 0.008, rot(0, 0.09, 0)], // butt plate
  ],
  [ // 4 PISTOL   (tag 2 = slide) — Glock-like, ~19 cm
    [BOX, M.GUNMETAL, 0, 0.025, 0.035, 0.0125, 0.017, 0.095, I3, 2], // slide
    [BOX, M.GRIP, 0, -0.001, 0.035, 0.011, 0.01, 0.085, I3],        // frame
    [CYL, M.STEEL, 0, 0.027, 0.131, 0.007, 0, 0.004, I3, 2],        // barrel tip
    [BOX, M.STEEL, 0, 0.045, 0.12, 0.003, 0.004, 0.004, I3, 2],     // front sight
    [BOX, M.STEEL, 0, 0.045, -0.05, 0.009, 0.004, 0.004, I3, 2],    // rear sight
    [BOX, M.GRIP, 0, -0.0468, -0.0281, 0.0125, 0.042, 0.023, rot(0, 0.36, 0)],  // grip (short: the hand covers it)
    [BOX, M.GRIP, 0, -0.026, 0.03, 0.004, 0.003, 0.026, I3],        // trigger guard (bottom)
    [BOX, M.GRIP, 0, -0.019, 0.054, 0.004, 0.009, 0.003, I3],       // trigger guard (front)
    [BOX, M.STEEL, 0, -0.017, 0.022, 0.003, 0.008, 0.003, I3],      // trigger
    gripped(BOX, M.GRIP, 0, -0.0468, -0.0281, 0.0095, 0.004, 0.018, 0.36, -0.039, 3), // magazine base plate (flush)
  ],
  [ // 5 HUNTING KNIFE
    [BOX, M.WOOD, 0, 0, -0.075, 0.019, 0.026, 0.08, I3],            // handle
    [BOX, M.BRASS, 0, 0, -0.163, 0.023, 0.031, 0.011, I3],          // pommel
    [BOX, M.BRASS, 0, 0, 0.012, 0.024, 0.054, 0.008, I3],           // guard
    [BOX, M.BLADE, 0, 0.004, 0.14, 0.006, 0.036, 0.12, I3],         // blade
    [BOX, M.BLADE, 0, 0.0, 0.29, 0.005, 0.025, 0.048, rot(0, 0.45, 0)],      // clip point
    [BOX, M.GUNMETAL, 0.0065, 0.016, 0.13, 0.001, 0.006, 0.085, I3], // fuller
  ],
  [ // 6 BASEBALL BAT
    [CYL, M.TAPE, 0, 0, -0.16, 0.017, 0, 0.12, I3],                 // grip tape
    [CYL, M.BATWOOD, 0, 0, -0.29, 0.027, 0, 0.012, I3],             // knob
    [CYL, M.BATWOOD, 0, 0, 0.04, 0.022, 0, 0.09, I3],               // taper
    [CYL, M.BATWOOD, 0, 0, 0.17, 0.029, 0, 0.05, I3],               // taper 2
    [CYL, M.BATWOOD, 0, 0, 0.34, 0.035, 0, 0.13, I3],               // barrel
    [SPHERE, M.BATWOOD, 0, 0, 0.465, 0.035, 0, 0, I3],              // rounded end
  ],
  [ // 7 MOLOTOV (axis = z)   (tag 4 = flame)
    [CYL, M.GLASS, 0, 0, 0, 0.04, 0, 0.068, I3],                    // bottle
    [CYL, M.GLASS, 0, 0, 0.083, 0.028, 0, 0.016, I3],               // shoulder
    [CYL, M.GLASS, 0, 0, 0.122, 0.014, 0, 0.028, I3],               // neck
    [BOX, M.RAG, 0, 0, 0.162, 0.017, 0.017, 0.022, I3],             // rag in the neck
    [BOX, M.RAG, 0.017, 0, 0.13, 0.004, 0.013, 0.032, I3],          // rag hanging down
    [CYL, M.RAG, 0, 0, -0.005, 0.0405, 0, 0.03, I3],                // label wrap
    [SPHERE, M.FLAME, 0, 0, 0.198, 0.02, 0, 0, I3, 4],              // flame
  ],
  [ // 8 MEDKIT
    [BOX, M.MEDWHITE, 0, 0, 0, 0.1, 0.068, 0.034, I3],              // case
    [BOX, M.MEDRED, 0, 0, 0.035, 0.019, 0.048, 0.002, I3],          // cross |
    [BOX, M.MEDRED, 0, 0, 0.035, 0.048, 0.019, 0.002, I3],          // cross -
    [BOX, M.MEDRED, 0, 0, -0.035, 0.019, 0.048, 0.002, I3],
    [BOX, M.MEDRED, 0, 0, -0.035, 0.048, 0.019, 0.002, I3],
    [BOX, M.GRIP, 0, 0.084, 0, 0.042, 0.006, 0.01, I3],             // handle
    [BOX, M.GRIP, -0.036, 0.074, 0, 0.006, 0.008, 0.009, I3],
    [BOX, M.GRIP, 0.036, 0.074, 0, 0.006, 0.008, 0.009, I3],
  ],
  [ // 9 MAKAROV PM   (tag 2 = slide, tag 3 = magazine) — 161 mm, blued steel, brown bakelite grip
    [BOX, M.BLUED, 0, 0.022, 0.03, 0.0115, 0.0125, 0.08, I3, 2],     // slide
    [CYL, M.BLUED, 0, 0.032, 0.03, 0.0105, 0, 0.078, I3, 2],         // rounded top of the slide
    [BOX, M.BLUED, 0, -0.0015, 0.03, 0.0105, 0.0105, 0.07, I3],      // frame
    [CYL, M.STEEL, 0, 0.024, 0.111, 0.0065, 0, 0.003, I3, 2],        // muzzle
    [BOX, M.BLUED, 0, 0.045, 0.1, 0.0025, 0.004, 0.004, I3, 2],      // front sight
    [BOX, M.BLUED, 0, 0.044, -0.038, 0.008, 0.004, 0.003, I3, 2],    // rear sight
    [BOX, M.BLUED, 0, 0.026, -0.056, 0.005, 0.009, 0.005, rot(0, -0.4, 0)],   // hammer
    [BOX, M.STEEL, 0.0122, 0.028, -0.025, 0.0012, 0.005, 0.008, I3, 2],      // safety lever
    gripped(BOX, M.BAKELITE, 0, -0.0439, -0.0273, 0.0125, 0.036, 0.021, 0.26, 0),   // grip panels
    gripped(BOX, M.BLUED, 0, -0.0439, -0.0273, 0.0095, 0.037, 0.024, 0.26, 0),       // backstrap
    gripped(BOX, M.BLUED, 0, -0.0439, -0.0273, 0.009, 0.004, 0.017, 0.26, -0.034, 3), // magazine floor plate
    [BOX, M.BLUED, 0, -0.03, 0.03, 0.0035, 0.003, 0.03, I3],         // trigger guard (bottom)
    [BOX, M.BLUED, 0, -0.019, 0.061, 0.0035, 0.012, 0.003, rot(0, 0.3, 0)],  // trigger guard (front, round)
    [BOX, M.STEEL, 0, -0.018, 0.024, 0.0025, 0.009, 0.003, I3],      // trigger
  ],
  [ // 10 DESERT EAGLE   (tag 2 = slide, tag 3 = magazine) — 270 mm, polished steel, huge
    [BOX, M.CHROME, 0, 0.026, -0.02, 0.0165, 0.02, 0.086, I3, 2],    // slide
    [BOX, M.CHROME, 0, 0.03, 0.108, 0.0135, 0.019, 0.064, I3],       // long fixed barrel
    [BOX, M.CHROME, 0, 0.052, 0.07, 0.006, 0.004, 0.1, I3],          // top rib / rail
    [BOX, M.CHROME, 0, 0.012, 0.108, 0.0095, 0.008, 0.064, I3],      // barrel underside (triangular look)
    [CYL, M.GRIP, 0, 0.03, 0.172, 0.009, 0, 0.002, I3],              // bore
    [BOX, M.CHROME, 0, -0.004, 0.02, 0.015, 0.011, 0.105, I3],       // frame
    [BOX, M.CHROME, 0, 0.06, 0.16, 0.003, 0.005, 0.005, I3],         // front sight
    [BOX, M.CHROME, 0, 0.051, -0.09, 0.011, 0.005, 0.005, I3, 2],    // rear sight
    [BOX, M.CHROME, 0, 0.034, -0.11, 0.007, 0.012, 0.006, rot(0, -0.45, 0)],  // hammer
    [BOX, M.STEEL, 0.017, 0.032, -0.07, 0.0015, 0.004, 0.012, I3, 2],         // slide release / safety
    gripped(BOX, M.RUBBER, 0, -0.0577, -0.0535, 0.0175, 0.051, 0.029, 0.3, 0),  // rubber grip
    gripped(BOX, M.CHROME, 0, -0.0577, -0.0535, 0.011, 0.005, 0.024, 0.3, -0.047, 3), // magazine base
    [BOX, M.CHROME, 0, -0.04, 0.03, 0.0045, 0.0035, 0.04, I3],       // trigger guard (bottom)
    [BOX, M.CHROME, 0, -0.026, 0.07, 0.0045, 0.016, 0.0035, I3],     // trigger guard (front, squared)
    [BOX, M.CHROME, 0, -0.045, 0.073, 0.0045, 0.004, 0.006, rot(0, 0.6, 0)],  // finger hook
    [BOX, M.STEEL, 0, -0.022, 0.016, 0.003, 0.012, 0.004, I3],       // trigger
  ],
];

// where the hands go on each pistol (model units): grip center, grip tilt, grip half-width,
// barrel height + muzzle z, view-model scale S and third-person scale
export const PISTOLS = {
  4:  { grip: [0, -0.0468, -0.0281], hh: 0.042, gd: 0.023, fy: -0.001, tilt: 0.36, gw: 0.0125, by: 0.027, mz: 0.135, S: 1.5, tp: 2.4 },
  9:  { grip: [0, -0.0439, -0.0273], hh: 0.037, gd: 0.022, fy: -0.0015, tilt: 0.26, gw: 0.0125, by: 0.024, mz: 0.114, S: 1.7, tp: 2.5 },
  10: { grip: [0, -0.0577, -0.0535], hh: 0.051, gd: 0.029, fy: -0.004, tilt: 0.3, gw: 0.0175, by: 0.03, mz: 0.174, S: 1.12, tp: 1.9 },
};

const tmp = new Float32Array(9);
// write the item's prims into pool starting at n; returns new n
// pos: world position of item origin, R: item rotation (3x3, columns), s: scale
// offs: optional { [tag]: [dx, dy, dz] | null } — moves (or hides, null) tagged parts (slide, magazine…)
export function placeItem(pool, n, out, w, pos, R, s = 1, th = 1, offs = null) {
  for (const part of ITEM_PARTS[w]) {
    let [type, mat, x, y, z, a, b, c, lr, tag] = part;
    if (offs && tag && tag in offs) { const o = offs[tag]; if (!o) continue; x += o[0]; y += o[1]; z += o[2]; }
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
const iconPool = Array.from({ length: 20 }, makePrim);
const RAMP = '.,-~:;=!*#$@';
// icons: evenly filled symbols (no '=' '-' stripes that make items look flat)
const ICON_RAMP = ':;+*o%#&@';
const TEMPLATES = [
  ['_', '000000111'], ['-', '000111000'], ['‾', '111000000'], ['=', '111000111'],
  ['|', '010010010'], ['/', '001010100'], ['\\', '100010001'], ['[', '100100100'], [']', '001001001'],
  ['.', '000000010'], ["'", '010000000'], ['o', '000010000'], ['(', '010100010'], [')', '010001010'],
  ['/', '011110100'], ['\\', '110011001'], ['/', '001011110'], ['\\', '100110011'],
  ['L', '100100111'], ['J', '001001111'], ['F', '111100100'], ['7', '111001001'],
].map(([c, m]) => [c, [...m].map(Number)]);

// how each item is posed in its icon: rotation, scale, center along its length, thickness boost
const ICONS = [
  { yaw: Math.PI / 2 - 0.42, pitch: -0.12, roll: -0.35, s: 1.45, c: 0.16, th: 1.25, spin: 0.3 },               // shotgun
  { yaw: Math.PI / 2 - 0.42, pitch: -0.3, roll: -0.3, s: 2.6, c: 0.12, th: 1.25, spin: 0.3 },                   // knife
  { yaw: 0.5, pitch: -Math.PI / 2 + 0.3, s: 6.8, c: 0, th: 1, spin: 2, aspect: 1 },                             // soda
  { yaw: Math.PI / 2 - 0.42, pitch: -0.12, roll: -0.35, s: 1.6, c: 0.05, th: 1.15, spin: 0.3, oy: 0.06 },       // ak47
  { yaw: Math.PI / 2 - 0.5, pitch: -0.05, roll: -0.35, s: 5.6, c: 0.035, th: 1, spin: 0.4, oy: 0.012, aspect: 1.3 }, // pistol
  { yaw: Math.PI / 2 - 0.42, pitch: -0.35, roll: -0.3, s: 3.0, c: 0.07, th: 1.15, spin: 0.3 },                  // hunting knife
  { yaw: Math.PI / 2 - 0.42, pitch: -0.4, roll: 0, s: 2.0, c: 0.09, th: 1.15, spin: 0.3 },                      // bat
  { yaw: 0.5, pitch: -Math.PI / 2 + 0.35, s: 3.4, c: 0.07, th: 1, spin: 2, aspect: 0.8 },                      // molotov
  { yaw: 0.42, pitch: 0.36, s: 4.4, c: 0, th: 1, spin: 1.2, aspect: 1.3, oy: -0.012 },                          // medkit
  { yaw: Math.PI / 2 - 0.5, pitch: -0.05, roll: -0.35, s: 6.4, c: 0.03, th: 1, spin: 0.4, oy: 0.012, aspect: 1.3 }, // makarov
  { yaw: Math.PI / 2 - 0.5, pitch: -0.05, roll: -0.35, s: 4.0, c: 0.035, th: 1, spin: 0.4, oy: 0.014, aspect: 1.45 }, // desert eagle
];

// cached wrapper: inactive icons are static, the active one re-renders ~10×/s
const iconCache = new Map();
export function drawItemIcon(layer, x0, y0, w, h, item, t, active, bg) {
  const step = active ? Math.floor(t * 10) : -1;
  const key = `${item}|${w}x${h}|${active ? 1 : 0}|${bg.join(',')}|${layer.cellW.toFixed(2)}`;
  let c = iconCache.get(key);
  if (!c || c.step !== step) {
    const cells = [];
    const rec = { cellW: layer.cellW, cellH: layer.cellH, put: (x, y, ch, fg) => cells.push([x - x0, y - y0, ch, fg]) };
    renderItemIcon(rec, x0, y0, w, h, item, active ? step / 10 : 0, active, bg);
    c = { step, cells };
    iconCache.set(key, c);
  }
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) layer.put(x0 + xx, y0 + yy, ' ', null, bg);
  for (const [x, y, ch, fg] of c.cells) if (fg) layer.put(x0 + x, y0 + y, ch, fg, bg);
}

function renderItemIcon(layer, x0, y0, w, h, item, t, active, bg) {
  const prims = [];
  const spin = active ? Math.sin(t * 1.4) * 0.35 : 0;
  const aspect = (w * layer.cellW) / (h * layer.cellH);
  const ic = ICONS[item] || ICONS[0];
  // guns/blades lie diagonally (classic inventory icon look), cans and bottles stand
  const R = rot(ic.yaw + spin * ic.spin, ic.pitch, ic.roll || 0);
  // fit: the icon frame may be wide (hotbar) or almost square (shop cards)
  const fit = Math.min(1, aspect / (ic.aspect || 1.8));
  const s = ic.s * fit, center = ic.c;
  const D = 2.0;
  const off = ic.oy || 0;
  const pos = [-(R[6] * center * s), -(R[7] * center * s) + off * s, -D - R[8] * center * s];
  placeItem(iconPool, 0, prims, item, pos, R, s, ic.th);
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
      if (covered >= 8) ch = ICON_RAMP[Math.max(0, Math.min(ICON_RAMP.length - 1, Math.floor((lum - 0.25) * ICON_RAMP.length * 0.9)))];
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
      if (bp.mat === M.FLAME) {             // flickering flame on the molotov rag
        const f = Math.sin(t * 40 + xx * 3.1 + yy * 1.7) * 0.5 + 0.5;
        col = [255, 120 + f * 110, 30 + f * 40]; lum = 1;
        if (covered < 8) ch = '^*\''[(xx + yy + Math.floor(t * 12)) % 3];
      }
      const k = 0.62 + lum * 1.1;
      layer.put(x0 + xx, y0 + yy, ch, [col[0] * k, col[1] * k, col[2] * k], bg);
    }
  }
}
