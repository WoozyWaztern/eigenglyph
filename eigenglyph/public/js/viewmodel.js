// ─────────────────────────────────────────────────────────────
//  First-person arms + weapons, built from 3D primitives in
//  camera space (x right, y up, z forward) and animated.
// ─────────────────────────────────────────────────────────────
import { makePrim, setRotYXZ, setDirZ, mul3, SPHERE, BOX, CAPSULE, CYL } from './prims.js';
import { M } from './mats.js';

const POOL = Array.from({ length: 24 }, makePrim);
const R = new Float32Array(9), R2 = new Float32Array(9);

const lerp = (a, b, t) => a + (b - a) * t;
const sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// keyframe track: [[time, value3], ...] → value at s
function track(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const k0 = keys[i - 1], k1 = keys[i];
      return lerp3(k0[1], k1[1], sm((s - k0[0]) / (k1[0] - k0[0])));
    }
  }
  return keys[keys.length - 1][1];
}

export class ViewModel {
  constructor() {
    this.prims = [];
    this.muzzle = [0, 0, 1];   // camera-space muzzle position (for flash)
  }

  // st: {w, time, bob, bobAmp, swayX, swayY, ads, recoil, pump, equip, slash, slashSide, drink, reload, dead}
  build(st) {
    let n = 0;
    const out = this.prims; out.length = 0;
    const P = () => { const p = POOL[n++]; out.push(p); return p; };

    // global offsets: bob, breathing, sway, equip
    const bx = Math.cos(st.bob) * 0.014 * st.bobAmp * (1 - st.ads * 0.8);
    const by = -Math.abs(Math.sin(st.bob)) * 0.02 * st.bobAmp * (1 - st.ads * 0.8) + Math.sin(st.time * 1.7) * 0.004;
    const sx = Math.max(-0.05, Math.min(0.05, -st.swayX * 0.0009)) * (1 - st.ads * 0.7);
    const sy = Math.max(-0.05, Math.min(0.05, st.swayY * 0.0009)) * (1 - st.ads * 0.7);
    const eq = sm(st.equip);
    const ox = bx + sx, oy = by + sy - eq * 0.45 - (st.dead ? st.dead * 0.8 : 0), oz = 0;

    // place a part: local offset (lx,ly,lz) in a frame (pos, rot matrix)
    const place = (p, pos, rot, lx, ly, lz) => {
      p.px = pos[0] + rot[0] * lx + rot[3] * ly + rot[6] * lz;
      p.py = pos[1] + rot[1] * lx + rot[4] * ly + rot[7] * lz;
      p.pz = pos[2] + rot[2] * lx + rot[5] * ly + rot[8] * lz;
    };
    const part = (type, mat, pos, rot, lx, ly, lz, a, b, c, extraRot) => {
      const p = P();
      p.type = type; p.mat = mat; p.sx = a; p.sy = b; p.sz = c; p.tag = 0;
      place(p, pos, rot, lx, ly, lz);
      if (extraRot) mul3(p.m, rot, extraRot); else p.m.set(rot);
      return p;
    };
    const arm = (hx, hy, hz, shx, shy, shz, r = 0.072) => {
      const p = P();
      p.type = CAPSULE; p.mat = M.ARM; p.sx = r; p.tag = 0;
      const dx = shx - hx, dy = shy - hy, dz = shz - hz;
      p.sz = Math.hypot(dx, dy, dz) / 2;
      p.px = (hx + shx) / 2; p.py = (hy + shy) / 2; p.pz = (hz + shz) / 2;
      setDirZ(p.m, dx, dy, dz);
    };
    const hand = (x, y, z, r = 0.068) => {
      const p = P(); p.type = SPHERE; p.mat = M.ARM; p.sx = r; p.tag = 0;
      p.px = x; p.py = y; p.pz = z; p.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return [x, y, z];
    };
    const world = (pos, rot, lx, ly, lz) => [
      pos[0] + rot[0] * lx + rot[3] * ly + rot[6] * lz,
      pos[1] + rot[1] * lx + rot[4] * ly + rot[7] * lz,
      pos[2] + rot[2] * lx + rot[5] * ly + rot[8] * lz,
    ];

    if (st.w === 0) {
      // ───────── SHOTGUN ─────────
      const a = sm(st.ads);
      const rl = st.reload >= 0 ? sm(Math.min(1, st.reloadBlend)) : 0;
      let pos = lerp3([0.24, -0.25, 0.64], [0.0, -0.135, 0.62], a);
      pos = lerp3(pos, [0.20, -0.22, 0.58], rl);
      pos[0] += ox; pos[1] += oy + st.recoil * 0.035; pos[2] += oz - st.recoil * 0.11;
      const yaw = lerp(-0.07, 0, a) + rl * -0.35;
      const pitch = -st.recoil * 0.38 + eq * 0.9 + rl * -0.1 + st.pump * 0.06;
      const roll = lerp(0.04, 0, a) + rl * 0.55 + st.pump * 0.05;
      setRotYXZ(R, yaw, pitch, roll);
      const pumpOff = -st.pump * 0.12;

      part(BOX, M.GUNMETAL, pos, R, 0, 0, 0.02, 0.045, 0.058, 0.13);             // receiver
      part(CYL, M.GUNMETAL, pos, R, 0, 0.028, 0.44, 0.026, 0, 0.30);             // barrel
      part(CYL, M.GUNMETAL, pos, R, 0, -0.026, 0.37, 0.022, 0, 0.22);            // mag tube
      part(BOX, M.GRIP, pos, R, 0, -0.03, 0.36 + pumpOff, 0.043, 0.036, 0.09);   // pump / forend
      setRotYXZ(R2, 0, 0.55, 0);
      part(BOX, M.WOOD, pos, R, 0, -0.1, -0.1, 0.03, 0.075, 0.035, R2);          // pistol grip
      part(BOX, M.GUNMETAL, pos, R, 0, -0.07, 0.0, 0.006, 0.02, 0.04);           // trigger guard
      part(SPHERE, M.BRASS, pos, R, 0, 0.062, 0.72, 0.011, 0, 0);                 // bead sight

      // right hand on the grip
      const rh = world(pos, R, 0.0, -0.10, -0.075);
      hand(rh[0], rh[1], rh[2]);
      arm(rh[0], rh[1], rh[2], 0.62 + ox * 0.5, -0.72 + oy * 0.5, 0.12);
      // left hand on the pump, or loading shells during reload
      let lh = world(pos, R, 0.0, -0.078, 0.36 + pumpOff);
      if (st.reload >= 0) {
        const p = st.reload;
        const below = world(pos, R, 0.04, -0.32, 0.10);
        const port = world(pos, R, 0.0, -0.075, 0.05);
        const k = p < 0.45 ? sm(p / 0.45) : p < 0.6 ? 1 : 1 - sm((p - 0.6) / 0.4);
        lh = lerp3(below, port, k);
        lh = lerp3(world(pos, R, 0.0, -0.078, 0.36), lh, rl);
        if (p < 0.6) { // shell in fingers
          const s = P(); s.type = CYL; s.mat = M.SHELL; s.sx = 0.017; s.sz = 0.035; s.tag = 0;
          s.px = lh[0]; s.py = lh[1] + 0.04; s.pz = lh[2] + 0.01; s.m.set(R);
        }
      }
      hand(lh[0], lh[1], lh[2]);
      arm(lh[0], lh[1], lh[2], -0.02 + ox * 0.5, -0.9 + oy * 0.5, 0.3);
      this.muzzle = world(pos, R, 0, 0.028, 0.76);
    }
    else if (st.w === 1) {
      // ───────── KNIFE ─────────
      const idle = [0.2, -0.2, 0.5], idleD = [-0.15, 0.55, 1];
      let pos = idle, dir = idleD;
      if (st.slash >= 0) {
        const s = st.slash, side = st.slashSide;
        const keysP = side > 0
          ? [[0, idle], [0.22, [0.36, -0.03, 0.42]], [0.5, [-0.2, -0.27, 0.56]], [1, idle]]
          : [[0, idle], [0.22, [-0.08, -0.05, 0.45]], [0.5, [0.4, -0.3, 0.55]], [1, idle]];
        const keysD = side > 0
          ? [[0, idleD], [0.22, [0.7, 0.8, 0.5]], [0.5, [-1, -0.35, 0.55]], [1, idleD]]
          : [[0, idleD], [0.22, [-0.7, 0.7, 0.6]], [0.5, [1, -0.25, 0.55]], [1, idleD]];
        pos = track(keysP, s); dir = track(keysD, s);
      }
      pos = [pos[0] + ox, pos[1] + oy, pos[2] + oz];
      setDirZ(R, dir[0], dir[1] - eq * 1.2, dir[2]);
      part(BOX, M.GRIP, pos, R, 0, 0, -0.05, 0.022, 0.03, 0.07);         // handle
      part(BOX, M.GUNMETAL, pos, R, 0, 0, 0.025, 0.03, 0.042, 0.01);     // guard
      part(BOX, M.BLADE, pos, R, 0, 0.005, 0.16, 0.007, 0.03, 0.13);     // blade
      setRotYXZ(R2, 0, -0.55, 0);
      part(BOX, M.BLADE, pos, R, 0, 0.016, 0.3, 0.006, 0.018, 0.035, R2); // tip
      const h = world(pos, R, 0, -0.005, -0.055);
      hand(h[0], h[1], h[2], 0.072);
      arm(h[0], h[1], h[2], 0.5 + ox * 0.5, -0.72 + oy * 0.5, 0.1);
      this.muzzle = world(pos, R, 0, 0, 0.3);
    }
    else {
      // ───────── SODA ─────────
      let pos = [0.18, -0.2, 0.48], axis = [0.12, 1, -0.15];
      if (st.drink >= 0) {
        const d = st.drink;
        pos = track([[0, pos], [0.22, [0.03, -0.10, 0.30]], [0.8, [0.02, -0.08, 0.28]], [1, pos]], d);
        axis = track([[0, axis], [0.22, [0.0, 0.25, -1]], [0.8, [0.0, 0.05, -1]], [1, axis]], d);
      }
      pos = [pos[0] + ox, pos[1] + oy, pos[2] + oz];
      setDirZ(R, axis[0], axis[1] - eq * 1.5, axis[2]);
      const can = part(CYL, M.CAN, pos, R, 0, 0, 0, 0.034, 0, 0.066);
      can.tag = 1;
      part(CYL, M.CAN_TOP, pos, R, 0, 0, 0.069, 0.03, 0, 0.004);
      const h = [pos[0] + 0.04, pos[1] - 0.012, pos[2] - 0.006];
      hand(h[0], h[1], h[2], 0.064);
      arm(h[0], h[1], h[2], 0.5 + ox * 0.5, -0.72 + oy * 0.5, 0.1);
      this.muzzle = world(pos, R, 0, 0, 0.07);
    }
    return out;
  }
}
