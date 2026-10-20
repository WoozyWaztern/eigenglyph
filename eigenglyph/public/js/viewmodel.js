// ─────────────────────────────────────────────────────────────
//  First-person arms + weapons, built from 3D primitives in
//  camera space (x right, y up, z forward) and animated.
// ─────────────────────────────────────────────────────────────
import { makePrim, setRotYXZ, setDirZ, mul3, SPHERE, BOX, CAPSULE, CYL } from './prims.js';
import { M } from './mats.js';
import { placeItem, PISTOLS } from './items.js';

const POOL = Array.from({ length: 40 }, makePrim);
const R = new Float32Array(9), R2 = new Float32Array(9);

const lerp = (a, b, t) => a + (b - a) * t;
const sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// every gun points exactly at the crosshair: a point straight ahead of the camera
const AIM_Z = 14;
function aimAngles(pos, barrelY = 0) {
  const dx = -pos[0], dy = -(pos[1] + barrelY), dz = AIM_Z - pos[2];
  return [Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz))];
}

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
    let handN = 0;

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
      const p = P(); p.type = SPHERE; p.mat = M.ARM; p.sx = r; p.tag = 10 + (handN++ % 6);
      p.px = x; p.py = y; p.pz = z; p.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return [x, y, z];
    };
    // a closed fist wrapped around a grip: a short capsule from a to b
    const fist = (a, b, r) => {
      const p = P(); p.type = CAPSULE; p.mat = M.ARM; p.sx = r; p.tag = 10 + (handN++ % 6);   // own outline, same color
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      p.sz = Math.hypot(dx, dy, dz) / 2;
      p.px = (a[0] + b[0]) / 2; p.py = (a[1] + b[1]) / 2; p.pz = (a[2] + b[2]) / 2;
      setDirZ(p.m, dx, dy, dz);
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
      let pos = lerp3([0.2, -0.23, 0.6], [0.0, -0.135, 0.62], a);
      pos = lerp3(pos, [0.18, -0.21, 0.58], rl);
      const [ay, ap] = aimAngles(pos, 0.028);
      pos[0] += ox; pos[1] += oy + st.recoil * 0.035; pos[2] += oz - st.recoil * 0.11;
      const yaw = ay + rl * -0.35;
      const pitch = ap - st.recoil * 0.38 + eq * 0.9 + rl * -0.1 + st.pump * 0.06;
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
      setRotYXZ(R2, 0, 0.14, 0);
      part(BOX, M.WOOD, pos, R, 0, -0.045, -0.27, 0.032, 0.048, 0.14, R2);       // stock
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
    else if (st.w === 3 || PISTOLS[st.w]) {
      // ───────── DARK AK-47 / PISTOLS (pistol, Makarov, Desert Eagle) ─────────
      const ak = st.w === 3, G = PISTOLS[st.w], heavy = st.w === 10;
      const a = sm(st.ads);
      const rel = st.reload, rl = rel >= 0 ? sm(Math.min(1, st.reloadBlend)) : 0;
      let pos = ak ? lerp3([0.19, -0.2, 0.56], [0.0, -0.075, 0.6], a) : lerp3([0.12, -0.14, 0.5], [0.0, -0.075, 0.5], a);
      pos = lerp3(pos, ak ? [0.14, -0.19, 0.56] : [0.08, -0.13, 0.42], rl);
      const [ay, ap] = aimAngles(pos, ak ? 0 : G.by * G.S);
      const kick = st.recoil * (ak ? 0.6 : heavy ? 1.7 : 1);
      pos[0] += ox; pos[1] += oy + kick * 0.015; pos[2] += oz - kick * (ak ? 0.04 : 0.05);
      const yaw = ay + rl * (ak ? -0.3 : -0.25);
      const pitch = ap - kick * (ak ? 0.12 : 0.26) + eq * 0.9 - rl * 0.12;
      const roll = lerp(0.03, 0, a) + rl * (ak ? 0.5 : 0.7);
      setRotYXZ(R, yaw, pitch, roll);
      const offs = {};
      // magazine out → new magazine in
      let magY = 0;
      if (rel >= 0) {
        if (rel < 0.15) magY = 0;
        else if (rel < 0.35) magY = -0.3 * sm((rel - 0.15) / 0.2);
        else if (rel < 0.55) magY = null;
        else if (rel < 0.8) magY = -0.3 * (1 - sm((rel - 0.55) / 0.25));
      }
      offs[3] = magY === null ? null : [0, magY, -magY * 0.15];
      // bolt / slide goes back on every shot (and the AK bolt is pulled after a reload)
      const pull = ak && rel > 0.82 ? Math.sin((rel - 0.82) / 0.18 * Math.PI) * 0.07 : 0;
      offs[2] = [0, 0, -(st.recoil * (ak ? 0.05 : 0.055)) - pull];
      const S = ak ? 1 : G.S;          // pistols are drawn a bit bigger so the hands don't swallow them
      n = placeItem(POOL, n, out, st.w, pos, R, S, 1, offs);
      if (ak) {
        const rh = world(pos, R, 0.0, -0.088, -0.108);
        hand(rh[0], rh[1], rh[2]);
        arm(rh[0], rh[1], rh[2], 0.6 + ox * 0.5, -0.72 + oy * 0.5, 0.12);
        let lh = world(pos, R, 0.0, -0.032, 0.28);
        if (rel >= 0) {
          const k = rel < 0.12 ? sm(rel / 0.12) : rel < 0.8 ? 1 : rel < 0.86 ? 1 - sm((rel - 0.8) / 0.06) : 0;
          const mag = world(pos, R, 0.0, -0.15 + (magY || -0.3), 0.08);
          const bolt = world(pos, R, 0.045, 0.01, 0.09);
          lh = lerp3(lh, mag, k * rl);
          if (rel > 0.84) lh = lerp3(lh, bolt, Math.sin((rel - 0.84) / 0.16 * Math.PI));
        }
        hand(lh[0], lh[1], lh[2]);
        arm(lh[0], lh[1], lh[2], -0.05 + ox * 0.5, -0.9 + oy * 0.5, 0.28);
        this.muzzle = world(pos, R, 0, 0.0, 0.56);
      } else {
        // two-hand "thumbs forward" grip (how pistols are really held):
        //  · the right hand sits HIGH on the back of the grip (web of the hand under the slide) —
        //    from behind you see the back of that hand, the grip itself is hidden
        //  · the left palm fills the left side, its fingers wrap over the right hand's fingers at the front
        //  · both thumbs lie along the left side of the frame, pointing at the target
        //  · the wrists go straight back along the forearms (barrel in line with the forearm)
        const g = G.grip, ux = Math.cos(G.tilt), uz = Math.sin(G.tilt);
        const gx = (dx, along, dz) => world(pos, R, (g[0] + dx) * S, (g[1] + along * ux) * S, (g[2] + along * uz + dz) * S);
        const fr = (x, y, z) => world(pos, R, x * S, y * S, z * S);        // frame coordinates (not tilted)
        const k = G.hh * 0.6, gw = G.gw, gd = G.gd;
        // right hand around the backstrap
        fist(gx(gw * 0.3, k, -gd * 0.5), gx(gw * 0.3, -k * 0.95, -gd * 0.5), (gw + 0.012) * S);
        const rWrist = gx(gw * 0.3, -k * 0.5, -gd - 0.025);
        arm(rWrist[0], rWrist[1], rWrist[2], 0.2 + ox * 0.5, -0.42 + oy * 0.5, -0.06, 0.03);
        // right thumb along the left side, high under the slide
        fist(fr(-gw - 0.001, G.fy + 0.005, g[2] - 0.006), fr(-gw - 0.002, G.fy + 0.006, g[2] + 0.03), 0.0062 * S);
        let lh = gx(-gw * 1.05, -k * 0.15, gd * 0.25);
        const lhRest = lh;
        if (rel >= 0) {
          const kk = rel < 0.2 ? sm(rel / 0.2) : rel < 0.75 ? 1 : 1 - sm((rel - 0.75) / 0.25);
          lh = lerp3(lh, world(pos, R, -0.02, -0.28, -0.08), kk);
        }
        if (lh === lhRest) {
          fist(gx(-gw * 1.05, k * 0.7, gd * 0.15), gx(-gw * 1.05, -k * 0.95, gd * 0.15), (gw + 0.007) * S);   // left palm
          fist(gx(gw * 0.15, k * 0.5, gd * 0.95), gx(gw * 0.15, -k * 0.95, gd * 0.95), 0.011 * S);           // left fingers over the front
          fist(fr(-gw - 0.004, G.fy - 0.004, g[2] + 0.004), fr(-gw - 0.004, G.fy - 0.003, g[2] + 0.046), 0.0066 * S);   // left thumb
        } else hand(lh[0], lh[1], lh[2], 0.034);
        const lWrist = lh === lhRest ? gx(-gw * 1.3, -k * 0.5, -gd * 0.5) : lh;
        arm(lWrist[0], lWrist[1], lWrist[2], -0.15 + ox * 0.5, -0.44 + oy * 0.5, -0.06, 0.03);
        this.muzzle = world(pos, R, 0, G.by * S, (G.mz + 0.005) * S);
      }
    }
    else if (st.w === 5) {
      // ───────── HUNTING KNIFE ─────────
      const idle = [0.21, -0.21, 0.5], idleD = [-0.12, 0.5, 1];
      let pos = idle, dir = idleD;
      if (st.slash >= 0) {
        const s = st.slash, side = st.slashSide;
        const keysP = side > 0
          ? [[0, idle], [0.25, [0.38, -0.02, 0.4]], [0.52, [-0.24, -0.28, 0.56]], [1, idle]]
          : [[0, idle], [0.25, [-0.1, -0.04, 0.44]], [0.52, [0.42, -0.31, 0.55]], [1, idle]];
        const keysD = side > 0
          ? [[0, idleD], [0.25, [0.7, 0.85, 0.45]], [0.52, [-1, -0.4, 0.55]], [1, idleD]]
          : [[0, idleD], [0.25, [-0.7, 0.75, 0.55]], [0.52, [1, -0.3, 0.55]], [1, idleD]];
        pos = track(keysP, s); dir = track(keysD, s);
      }
      pos = [pos[0] + ox, pos[1] + oy, pos[2] + oz];
      setDirZ(R, dir[0], dir[1] - eq * 1.2, dir[2]);
      n = placeItem(POOL, n, out, 5, pos, R, 1);
      const h = world(pos, R, 0, -0.004, -0.075);
      hand(h[0], h[1], h[2], 0.074);
      arm(h[0], h[1], h[2], 0.5 + ox * 0.5, -0.72 + oy * 0.5, 0.1);
      this.muzzle = world(pos, R, 0, 0, 0.33);
    }
    else if (st.w === 6) {
      // ───────── BASEBALL BAT ─────────  (grip point + direction of the bat)
      const gI = [0.14, -0.16, 0.47], dI = [0.6, 1, 0.05];   // ready stance: bat up over the right shoulder
      let g = gI, d = dI;
      if (st.slash >= 0) {
        const s = st.slash, side = st.slashSide;
        const sx = side > 0 ? 1 : -1;
        g = track([[0, gI], [0.22, [0.34 * sx, -0.17, 0.38]], [0.46, [0.06 * sx, -0.24, 0.44]], [0.62, [-0.3 * sx, -0.3, 0.4]], [1, gI]], s);
        d = track([[0, dI], [0.22, [0.55 * sx, 0.8, -0.25]], [0.46, [-1 * sx, 0.16, 0.38]], [0.62, [-0.6 * sx, -0.3, -0.5]], [1, dI]], s);
      }
      g = [g[0] + ox, g[1] + oy, g[2] + oz];
      setDirZ(R, d[0], d[1] - eq * 1.4, d[2]);
      // both hands on the taped handle, stacked and touching: left hand at the knob, right hand above it
      const pos = world(g, R, 0, 0, 0.25);
      n = placeItem(POOL, n, out, 6, pos, R, 1.0);
      const rh = world(pos, R, 0, 0, -0.17), lh = world(pos, R, 0, 0, -0.255);
      hand(rh[0], rh[1], rh[2], 0.044); hand(lh[0], lh[1], lh[2], 0.044);
      arm(rh[0], rh[1], rh[2], 0.3 + ox * 0.5, -0.5 + oy * 0.5, -0.02, 0.035);
      arm(lh[0], lh[1], lh[2], -0.14 + ox * 0.5, -0.52 + oy * 0.5, -0.02, 0.035);
      this.muzzle = world(pos, R, 0, 0, 0.45);
    }
    else if (st.w === 7) {
      // ───────── MOLOTOV ─────────  (model axis z = up along the bottle)
      const pI = [0.19, -0.21, 0.54], aI = [0.12, 1, -0.15];   // held upright, like the soda
      let pos = pI, axis = aI, show = st.has, rise = 0;
      const th = st.throwT;
      if (th >= 0) {
        pos = track([[0, pI], [0.35, [0.34, -0.03, 0.44]], [0.48, [0.04, -0.03, 0.8]], [0.7, [0.22, -0.34, 0.5]], [1, pI]], th);
        axis = track([[0, aI], [0.35, [0.3, 0.5, -1]], [0.48, [0, 0.25, 1]], [0.7, aI], [1, aI]], th);
        if (th > 0.46) { show = st.has && th > 0.72; rise = th > 0.72 ? (1 - sm((th - 0.72) / 0.28)) * 0.3 : 0; }
        else show = true;
      }
      pos = [pos[0] + ox, pos[1] + oy - rise, pos[2] + oz];
      setDirZ(R, axis[0], axis[1] - eq * 1.5, axis[2]);
      if (show) n = placeItem(POOL, n, out, 7, pos, R, 0.95);
      const h = show ? [pos[0] + 0.05, pos[1] - 0.015, pos[2] - 0.006] : [pos[0] + 0.03, pos[1] - 0.04, pos[2]];
      hand(h[0], h[1], h[2], 0.066);
      arm(h[0], h[1], h[2], 0.5 + ox * 0.5, -0.72 + oy * 0.5, 0.1);
      this.muzzle = world(pos, R, 0, 0, 0.2);
    }
    else if (st.w === 8) {
      // ───────── MEDKIT ─────────
      let pos = [0.09, -0.175, 0.43], sp = 0, tilt = 0.3;
      if (st.use >= 0) {
        const u = st.use;
        pos = track([[0, pos], [0.3, [0.0, -0.1, 0.36]], [0.7, [0.0, -0.11, 0.35]], [1, pos]], u);
        sp = u > 0.3 && u < 0.7 ? Math.sin(u * 60) * 0.04 : 0;
        tilt = 0.3 + (u > 0.25 && u < 0.75 ? 0.35 : 0);
      }
      pos = [pos[0] + ox, pos[1] + oy, pos[2] + oz];
      setRotYXZ(R, Math.PI + 0.3 + sp, tilt + eq * 1.2, sp);
      n = placeItem(POOL, n, out, 8, pos, R, 1);
      const h = world(pos, R, -0.108, 0.0, 0.0);
      hand(h[0], h[1], h[2], 0.066);
      arm(h[0], h[1], h[2], 0.5 + ox * 0.5, -0.72 + oy * 0.5, 0.1);
      this.muzzle = world(pos, R, 0, 0, 0.05);
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
