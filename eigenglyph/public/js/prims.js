// ─────────────────────────────────────────────────────────────
//  Analytic ray / primitive intersection (spheres, boxes,
//  capsules, cylinders) with arbitrary rotation.
//  Used for players (world space) and the first-person
//  arms + weapons (camera space).
// ─────────────────────────────────────────────────────────────
export const SPHERE = 0, BOX = 1, CAPSULE = 2, CYL = 3;

export function makePrim() {
  return { type: 0, px: 0, py: 0, pz: 0,
    m: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), // columns: local X, Y, Z axes
    sx: 0.1, sy: 0.1, sz: 0.1, mat: 0, tag: 0 };
}

// result scratch
export const HIT = { t: 0, nx: 0, ny: 0, nz: 0, lx: 0, ly: 0, lz: 0 };

// rotation helpers (write into prim.m)
export function setRotYXZ(m, yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz
  const r00 = cy * cr + sy * sp * sr, r01 = -cy * sr + sy * sp * cr, r02 = sy * cp;
  const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
  const r20 = -sy * cr + cy * sp * sr, r21 = sy * sr + cy * sp * cr, r22 = cy * cp;
  m[0] = r00; m[1] = r10; m[2] = r20;   // local X column
  m[3] = r01; m[4] = r11; m[5] = r21;   // local Y column
  m[6] = r02; m[7] = r12; m[8] = r22;   // local Z column
}
// orient local Z along a direction
export function setDirZ(m, dx, dy, dz) {
  const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; }
  // X = up × Z
  let xx = uy * dz - uz * dy, xy = uz * dx - ux * dz, xz = ux * dy - uy * dx;
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx;
  m[0] = xx; m[1] = xy; m[2] = xz; m[3] = yx; m[4] = yy; m[5] = yz; m[6] = dx; m[7] = dy; m[8] = dz;
}
// multiply: out = A * B (3x3 column-major)
export function mul3(out, A, B) {
  const r = new Array(9);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++)
    r[c * 3 + rr] = A[rr] * B[c * 3] + A[3 + rr] * B[c * 3 + 1] + A[6 + rr] * B[c * 3 + 2];
  for (let i = 0; i < 9; i++) out[i] = r[i];
}

// ray (o,d) in parent space, d normalized. returns t or -1
export function hitPrim(P, ox, oy, oz, dx, dy, dz) {
  const m = P.m;
  const qx = ox - P.px, qy = oy - P.py, qz = oz - P.pz;
  // to local: M^T * v
  const rox = m[0] * qx + m[1] * qy + m[2] * qz;
  const roy = m[3] * qx + m[4] * qy + m[5] * qz;
  const roz = m[6] * qx + m[7] * qy + m[8] * qz;
  const rdx = m[0] * dx + m[1] * dy + m[2] * dz;
  const rdy = m[3] * dx + m[4] * dy + m[5] * dz;
  const rdz = m[6] * dx + m[7] * dy + m[8] * dz;
  let t = -1, nx = 0, ny = 0, nz = 0;

  switch (P.type) {
    case SPHERE: {
      const r = P.sx;
      const b = rox * rdx + roy * rdy + roz * rdz;
      const c = rox * rox + roy * roy + roz * roz - r * r;
      const h = b * b - c;
      if (h < 0) return -1;
      t = -b - Math.sqrt(h);
      if (t < 0) return -1;
      nx = (rox + rdx * t) / r; ny = (roy + rdy * t) / r; nz = (roz + rdz * t) / r;
      break;
    }
    case BOX: {
      let tmin = -1e30, tmax = 1e30, ax = -1, sg = 0;
      // X
      if (Math.abs(rdx) < 1e-9) { if (rox < -P.sx || rox > P.sx) return -1; }
      else { const i = 1 / rdx; let t1 = (-P.sx - rox) * i, t2 = (P.sx - rox) * i; const s = t1 < t2 ? -1 : 1; if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
        if (t1 > tmin) { tmin = t1; ax = 0; sg = s; } if (t2 < tmax) tmax = t2; }
      if (Math.abs(rdy) < 1e-9) { if (roy < -P.sy || roy > P.sy) return -1; }
      else { const i = 1 / rdy; let t1 = (-P.sy - roy) * i, t2 = (P.sy - roy) * i; const s = t1 < t2 ? -1 : 1; if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
        if (t1 > tmin) { tmin = t1; ax = 1; sg = s; } if (t2 < tmax) tmax = t2; }
      if (Math.abs(rdz) < 1e-9) { if (roz < -P.sz || roz > P.sz) return -1; }
      else { const i = 1 / rdz; let t1 = (-P.sz - roz) * i, t2 = (P.sz - roz) * i; const s = t1 < t2 ? -1 : 1; if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
        if (t1 > tmin) { tmin = t1; ax = 2; sg = s; } if (t2 < tmax) tmax = t2; }
      if (tmax < tmin || tmin < 0) return -1;
      t = tmin;
      if (ax === 0) nx = sg; else if (ax === 1) ny = sg; else nz = sg;
      break;
    }
    case CAPSULE: {
      const r = P.sx, hl = P.sz;
      const baba = 4 * hl * hl;
      const oax = rox, oay = roy, oaz = roz + hl;
      const bard = 2 * hl * rdz, baoa = 2 * hl * oaz;
      const rdoa = rdx * oax + rdy * oay + rdz * oaz;
      const oaoa = oax * oax + oay * oay + oaz * oaz;
      const a = baba - bard * bard;
      const b = baba * rdoa - baoa * bard;
      const c = baba * oaoa - baoa * baoa - r * r * baba;
      const h = b * b - a * c;
      if (h >= 0 && a > 1e-12) {
        const tt = (-b - Math.sqrt(h)) / a;
        const y = baoa + tt * bard;
        if (y > 0 && y < baba && tt > 0) {
          t = tt;
          nx = (oax + tt * rdx) / r; ny = (oay + tt * rdy) / r; nz = (oaz + tt * rdz - 2 * hl * y / baba) / r;
          break;
        }
        // caps
        const ocx = oax, ocy = oay, ocz = y <= 0 ? oaz : roz - hl;
        const b2 = rdx * ocx + rdy * ocy + rdz * ocz;
        const c2 = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
        const h2 = b2 * b2 - c2;
        if (h2 > 0) {
          const t2 = -b2 - Math.sqrt(h2);
          if (t2 > 0) { t = t2; nx = (ocx + t2 * rdx) / r; ny = (ocy + t2 * rdy) / r; nz = (ocz + t2 * rdz) / r; break; }
        }
        return -1;
      } else if (a <= 1e-12) {
        // ray parallel to axis → sphere caps
        const ocz = roz + (rdz > 0 ? hl : -hl);
        const b2 = rdx * rox + rdy * roy + rdz * ocz, c2 = rox * rox + roy * roy + ocz * ocz - r * r, h2 = b2 * b2 - c2;
        if (h2 < 0) return -1;
        t = -b2 - Math.sqrt(h2); if (t < 0) return -1;
        nx = (rox + t * rdx) / r; ny = (roy + t * rdy) / r; nz = (ocz + t * rdz) / r;
        break;
      }
      return -1;
    }
    case CYL: {
      const r = P.sx, hl = P.sz;
      const baba = 4 * hl * hl;
      const ocx = rox, ocy = roy, ocz = roz + hl;
      const bard = 2 * hl * rdz, baoc = 2 * hl * ocz;
      const k2 = baba - bard * bard;
      const k1 = baba * (ocx * rdx + ocy * rdy + ocz * rdz) - baoc * bard;
      const k0 = baba * (ocx * ocx + ocy * ocy + ocz * ocz) - baoc * baoc - r * r * baba;
      let h = k1 * k1 - k2 * k0;
      if (h < 0) return -1;
      h = Math.sqrt(h);
      let tt = (-k1 - h) / k2;
      const y = baoc + tt * bard;
      if (y > 0 && y < baba && tt > 0) {
        t = tt; nx = (ocx + tt * rdx) / r; ny = (ocy + tt * rdy) / r; nz = 0;
        break;
      }
      tt = ((y < 0 ? 0 : baba) - baoc) / bard;
      if (Math.abs(k1 + k2 * tt) < h && tt > 0) { t = tt; nz = y < 0 ? -1 : 1; break; }
      return -1;
    }
  }
  HIT.t = t;
  HIT.lx = rox + rdx * t; HIT.ly = roy + rdy * t; HIT.lz = roz + rdz * t;
  // back to parent space
  HIT.nx = m[0] * nx + m[3] * ny + m[6] * nz;
  HIT.ny = m[1] * nx + m[4] * ny + m[7] * nz;
  HIT.nz = m[2] * nx + m[5] * ny + m[8] * nz;
  return t;
}
