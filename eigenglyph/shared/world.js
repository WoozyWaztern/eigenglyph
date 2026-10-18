// ─────────────────────────────────────────────────────────────
//  EIGENGLYPH — shared world (used by server AND client)
//  Voxel map, raycasting, collision, body constants.
// ─────────────────────────────────────────────────────────────

export const W = 48, D = 48, H = 8;

export const MAT = {
  AIR: 0, CONCRETE: 1, DARK: 2, CRATE: 3, PILLAR: 4,
  PANEL: 5, BORDER: 6, METAL: 7, FLOOR: 8,
};

// body / player constants
export const BODY_R = 0.75;        // radius of the ball
export const BODY_CY = 0.75;       // ball center above feet
export const EYE = 1.3;            // eye height above feet
export const COL_R = 0.42;         // collision radius
export const COL_H = 1.5;          // collision height
export const MAX_HP = 100;

export const WEAPONS = {
  shotgun: { dmg: 27, cooldown: 0.85, range: 40 },
  knife:   { dmg: 7,  cooldown: 0.36, range: 2.4 },
  soda:    { heal: 25, cooldown: 7 },
};

export const voxels = new Uint8Array(W * D * H);
const vid = (x, y, z) => (y * D + z) * W + x;

function fill(x0, z0, x1, z1, y0, y1, m) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const az = Math.min(z0, z1), bz = Math.max(z0, z1);
  for (let y = y0; y < y1; y++)
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++)
        if (x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H) voxels[vid(x, y, z)] = m;
}
// 4-fold mirror
function sym(x0, z0, x1, z1, y0, y1, m) {
  const mx = v => W - 1 - v, mz = v => D - 1 - v;
  fill(x0, z0, x1, z1, y0, y1, m);
  fill(mx(x0), z0, mx(x1), z1, y0, y1, m);
  fill(x0, mz(z0), x1, mz(z1), y0, y1, m);
  fill(mx(x0), mz(z0), mx(x1), mz(z1), y0, y1, m);
}
// 8-fold mirror (also swaps x/z) → perfectly fair arena
function sym8(x0, z0, x1, z1, y0, y1, m) {
  sym(x0, z0, x1, z1, y0, y1, m);
  sym(z0, x0, z1, x1, y0, y1, m);
}

function build() {
  const M = MAT;
  // outer border
  fill(0, 0, W - 1, 0, 0, 5, M.BORDER);
  fill(0, D - 1, W - 1, D - 1, 0, 5, M.BORDER);
  fill(0, 0, 0, D - 1, 0, 5, M.BORDER);
  fill(W - 1, 0, W - 1, D - 1, 0, 5, M.BORDER);
  // corner towers
  sym(1, 1, 2, 2, 0, 7, M.PILLAR);

  // bridges over the 4 outer lanes (stairs → slab → stairs)
  sym8(12, 4, 12, 6, 0, 1, M.CONCRETE);
  sym8(13, 4, 13, 6, 0, 2, M.CONCRETE);
  sym8(14, 4, 15, 6, 0, 3, M.CONCRETE);
  sym8(16, 4, 23, 6, 2, 3, M.DARK);
  // little railings on the slab
  sym8(17, 4, 22, 4, 3, 4, M.METAL);

  // crimson pillars around the center
  sym8(18, 18, 18, 18, 0, 6, M.PILLAR);
  // center platform + core
  fill(21, 21, 26, 26, 0, 1, M.DARK);
  fill(23, 23, 24, 24, 1, 2, M.METAL);
  // floating ring above center (you can walk under it)
  fill(20, 20, 27, 20, 4, 5, M.DARK); fill(20, 27, 27, 27, 4, 5, M.DARK);
  fill(20, 20, 20, 27, 4, 5, M.DARK); fill(27, 20, 27, 27, 4, 5, M.DARK);

  // L-walls in the quadrants
  sym8(9, 11, 14, 11, 0, 3, M.CONCRETE);
  // panel corridors near the edges
  sym8(9, 16, 9, 19, 0, 3, M.PANEL);
  // crate clusters
  sym8(4, 4, 5, 5, 0, 1, M.CRATE);
  sym8(4, 4, 4, 4, 1, 2, M.CRATE);
  sym8(8, 8, 8, 8, 0, 2, M.CRATE);
  // cover in mid lanes
  sym8(22, 13, 22, 13, 0, 1, M.CRATE);
  sym8(11, 17, 11, 17, 0, 2, M.METAL);
  sym8(15, 15, 15, 15, 0, 1, M.CRATE);
}
build();

export const SPAWNS = [];
(function makeSpawns() {
  const base = [[3, 10], [10, 3], [9, 15], [15, 9], [20, 13], [13, 20]];
  const set = new Set();
  for (const [x, z] of base) {
    for (const [a, b] of [[x, z], [W - 1 - x, z], [x, D - 1 - z], [W - 1 - x, D - 1 - z]]) {
      const k = a + ',' + b;
      if (set.has(k)) continue; set.add(k);
      if (voxels[vid(a, 0, b)] === 0) SPAWNS.push([a + 0.5, 0, b + 0.5]);
    }
  }
})();

export function solid(x, y, z) {
  if (y < 0) return true;
  if (x < 0 || z < 0 || x >= W || z >= D) return true;
  if (y >= H) return false;
  return voxels[vid(x, y, z)] !== 0;
}
export function voxelAt(x, y, z) {
  if (y < 0) return MAT.FLOOR;
  if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return 0;
  return voxels[vid(x, y, z)];
}

// does an upright box (feet at py) intersect any voxel?
export function boxBlocked(px, py, pz, r = COL_R, h = COL_H) {
  const x0 = Math.floor(px - r), x1 = Math.floor(px + r - 1e-6);
  const y0 = Math.floor(py + 1e-4), y1 = Math.floor(py + h - 1e-6);
  const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r - 1e-6);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (solid(x, y, z)) return true;
  return false;
}

// 3D DDA voxel ray cast. dir must be normalized.
// returns distance or -1. out: {nx,ny,nz,mat,x,y,z}
export function raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e30;
  const ddy = dy !== 0 ? Math.abs(1 / dy) : 1e30;
  const ddz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
  let tx = dx > 0 ? (x + 1 - ox) * ddx : dx < 0 ? (ox - x) * ddx : 1e30;
  let ty = dy > 0 ? (y + 1 - oy) * ddy : dy < 0 ? (oy - y) * ddy : 1e30;
  let tz = dz > 0 ? (z + 1 - oz) * ddz : dz < 0 ? (oz - z) * ddz : 1e30;
  let t = 0, face = 1;
  for (let i = 0; i < 200; i++) {
    if (tx < ty) {
      if (tx < tz) { x += sx; t = tx; tx += ddx; face = 0; }
      else { z += sz; t = tz; tz += ddz; face = 2; }
    } else {
      if (ty < tz) { y += sy; t = ty; ty += ddy; face = 1; }
      else { z += sz; t = tz; tz += ddz; face = 2; }
    }
    if (t > maxT) return -1;
    if (y < 0) {
      out.nx = 0; out.ny = 1; out.nz = 0; out.mat = MAT.FLOOR;
      out.x = x; out.y = y; out.z = z; return t;
    }
    if (y >= H) { if (sy > 0) return -1; continue; }
    if (x < 0 || z < 0 || x >= W || z >= D) {
      if (dy >= 0) return -1;
      const tf = -oy / dy;
      if (tf > maxT) return -1;
      out.nx = 0; out.ny = 1; out.nz = 0; out.mat = MAT.FLOOR;
      out.x = -1; out.y = -1; out.z = -1; return tf;
    }
    const m = voxels[vid(x, y, z)];
    if (m !== 0) {
      out.nx = face === 0 ? -sx : 0; out.ny = face === 1 ? -sy : 0; out.nz = face === 2 ? -sz : 0;
      out.mat = m; out.x = x; out.y = y; out.z = z; return t;
    }
  }
  return -1;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  let h = b * b - c;
  if (h < 0) return -1;
  h = Math.sqrt(h);
  let t = -b - h;
  if (t < 0) t = -b + h;
  return t < 0 ? -1 : t;
}

// world vector → body-local (x = right, y = up, z = front) for a body facing `yaw`
export function toLocal(vx, vy, vz, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return [vx * rx + vz * rz, vy, vx * fx + vz * fz];
}
export function fromLocal(lx, ly, lz, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return [lx * rx + lz * fx, ly, lx * rz + lz * fz];
}
