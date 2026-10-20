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
  ak47:    { dmg: 9,  cooldown: 0.105, range: 60, mag: 30, reload: 2.3, spread: 0.014, auto: true },
  pistol:  { dmg: 17, cooldown: 0.26, range: 50, mag: 12, reload: 1.45, spread: 0.008 },
  makarov: { dmg: 21, cooldown: 0.3, range: 48, mag: 8, reload: 1.5, spread: 0.009 },
  deagle:  { dmg: 44, cooldown: 0.58, range: 70, mag: 7, reload: 2.0, spread: 0.011, kick: 2.2 },
  hknife:  { dmg: 15, cooldown: 0.55, range: 2.6 },
  bat:     { dmg: 24, cooldown: 0.9, range: 2.9, push: 8 },
  molotov: { speed: 15, fireR: 2.4, fireT: 6, burnT: 3, burnDmg: 5, tick: 0.5, cooldown: 10 },
  medkit:  { heal: 60, cooldown: 20, use: 1.4 },
};

// ── SHOP / INVENTORY ──
// Every item has a fixed index (= its 3D model and the "w" sent over the network).
// Starter items belong to everyone; the rest are bought for ★ stars in the SHOP.
export const CATS = [
  { id: 'primary',   name: 'PRIMARY',   ru: 'основное',      g: '1', key: 1 },
  { id: 'secondary', name: 'SECONDARY', ru: 'пистолеты',     g: '2', key: 2 },
  { id: 'melee',     name: 'MELEE',     ru: 'ближний бой',   g: '3', key: 3 },
  { id: 'utility',   name: 'UTILITY',   ru: 'снаряжение',    g: '4', key: 4 },
];
export const ITEMS = [
  { id: 'shotgun', name: 'SHOTGUN',      cat: 'primary',   kind: 'shotgun', price: 0, starter: true,
    desc: ['pump-action, 8 pellets.', 'devastating up close.'] },
  { id: 'knife',   name: 'KNIFE',        cat: 'melee',     kind: 'knife',   price: 0, starter: true,
    desc: ['small and fast.', 'slashes left and right.'] },
  { id: 'soda',    name: 'SODA',         cat: 'utility',   kind: 'drink',   price: 0, starter: true,
    desc: ['a cold can of Σ-cola.', 'a quick sip of health.'] },
  { id: 'ak47',    name: 'DARK AK-47',   cat: 'primary',   kind: 'gun',     price: 750,
    desc: ['blackened assault rifle.', 'full-auto, 30 rounds.', 'hold the trigger.'] },
  { id: 'pistol',  name: 'PISTOL',       cat: 'secondary', kind: 'gun',     price: 0, starter: true,
    desc: ['semi-auto sidearm.', 'one click = one shot.', 'fast reload.'] },
  { id: 'hknife',  name: 'HUNTING KNIFE', cat: 'melee',    kind: 'melee',   price: 150,
    desc: ['long clip-point blade.', 'deep cuts, slower swing.'] },
  { id: 'bat',     name: 'BASEBALL BAT', cat: 'melee',     kind: 'melee',   price: 120,
    desc: ['heavy wooden bat.', 'knocks players back.'] },
  { id: 'molotov', name: 'MOLOTOV',      cat: 'utility',   kind: 'throw',   price: 350,
    desc: ['a bottle of fire.', 'sets the ground and players', 'on fire. unlimited bottles,', 'one every 10 seconds.'] },
  { id: 'medkit',  name: 'MEDKIT',       cat: 'utility',   kind: 'heal',    price: 250,
    desc: ['field first-aid kit.', 'restores a lot of health', 'and puts out fire.'] },
  { id: 'makarov', name: 'MAKAROV PM',   cat: 'secondary', kind: 'gun',     price: 300,
    desc: ['soviet 9x18 pistol.', 'compact, all-steel.', '8 rounds, hits harder.'] },
  { id: 'deagle',  name: 'DESERT EAGLE', cat: 'secondary', kind: 'gun',     price: 900,
    desc: ['.50 AE hand cannon.', 'huge damage, 7 rounds,', 'heavy recoil.'] },
];
// every gun with a magazine (AK-47 and pistols)
export const isGun = w => !!(ITEMS[w] && ITEMS[w].kind === 'gun');
export const ITEM_IDX = Object.fromEntries(ITEMS.map((it, i) => [it.id, i]));
// what the player owns: starters + bought ids
export function ownedItems(inv) {
  const set = new Set(inv || []);
  return ITEMS.map((it, i) => i).filter(i => ITEMS[i].starter || set.has(ITEMS[i].id));
}
// what the player takes into a match: max 4 items — one PRIMARY, SECONDARY, MELEE, UTILITY
export const DEFAULT_LOADOUT = { primary: 'shotgun', secondary: 'pistol', melee: 'knife', utility: 'soda' };
export function loadoutOf(stats) {
  const inv = (stats && stats.inv) || [];
  const lo = Object.assign({}, DEFAULT_LOADOUT, (stats && stats.loadout) || {});
  return CATS.map(c => {
    const id = lo[c.id];
    const i = id ? ITEM_IDX[id] : -1;
    if (i === undefined || i < 0) return -1;
    const it = ITEMS[i];
    return it.cat === c.id && (it.starter || inv.includes(it.id)) ? i : -1;
  });
}
// numbers shown on the item card (0..1 bars + text)
export function itemStats(id) {
  const W = WEAPONS[id] || {};
  switch (id) {
    case 'shotgun': return [['DAMAGE', W.dmg, 0.75, '27 / shot'], ['FIRE RATE', 1 / W.cooldown, 0.12, '70 / min'], ['RANGE', W.range, 0.6, 'short'], ['MAGAZINE', 6, 0.2, '6 shells']];
    case 'knife':   return [['DAMAGE', W.dmg, 0.2, '7 / slash'], ['SPEED', 1 / W.cooldown, 0.9, 'very fast'], ['RANGE', W.range, 0.25, '2.4 m'], ['WEIGHT', 0, 0.1, 'light']];
    case 'soda':    return [['HEAL', W.heal, 0.3, '+25 HP'], ['COOLDOWN', W.cooldown, 0.35, '7 s'], ['USE TIME', 1.6, 0.5, '1.6 s'], ['USES', 0, 1, 'unlimited']];
    case 'ak47':    return [['DAMAGE', W.dmg, 0.3, '9 / bullet'], ['FIRE RATE', 1 / W.cooldown, 1, '570 / min'], ['RANGE', W.range, 1, 'long'], ['MAGAZINE', W.mag, 0.9, '30 rounds']];
    case 'pistol':  return [['DAMAGE', W.dmg, 0.5, '17 / bullet'], ['FIRE RATE', 1 / W.cooldown, 0.45, '230 / min'], ['RANGE', W.range, 0.8, 'medium'], ['MAGAZINE', W.mag, 0.4, '12 rounds']];
    case 'makarov': return [['DAMAGE', W.dmg, 0.6, '21 / bullet'], ['FIRE RATE', 1 / W.cooldown, 0.4, '200 / min'], ['RANGE', W.range, 0.75, 'medium'], ['MAGAZINE', W.mag, 0.3, '8 rounds']];
    case 'deagle':  return [['DAMAGE', W.dmg, 1, '44 / bullet'], ['FIRE RATE', 1 / W.cooldown, 0.22, '100 / min'], ['RANGE', W.range, 1, 'long'], ['MAGAZINE', W.mag, 0.25, '7 rounds']];
    case 'hknife':  return [['DAMAGE', W.dmg, 0.45, '15 / slash'], ['SPEED', 1 / W.cooldown, 0.6, 'fast'], ['RANGE', W.range, 0.3, '2.6 m'], ['BLEED', 0, 0.7, 'deep cuts']];
    case 'bat':     return [['DAMAGE', W.dmg, 0.7, '24 / hit'], ['SPEED', 1 / W.cooldown, 0.35, 'slow'], ['RANGE', W.range, 0.35, '2.9 m'], ['KNOCKBACK', W.push, 0.9, 'strong']];
    case 'molotov': return [['BURN', W.burnDmg, 0.6, '10 HP / s'], ['FIRE AREA', W.fireR, 0.7, '2.4 m'], ['FIRE TIME', W.fireT, 0.6, '6 s'], ['COOLDOWN', W.cooldown, 0.6, '10 s · unlimited']];
    case 'medkit':  return [['HEAL', W.heal, 0.8, '+60 HP'], ['COOLDOWN', W.cooldown, 0.8, '20 s'], ['USE TIME', W.use, 0.45, '1.4 s'], ['FIRE', 0, 1, 'puts it out']];
  }
  return [];
}

// molotov flight: same simulation on server (authoritative) and clients (visuals).
// returns { x, y, z, t, hit } where it shatters; hitFn(x,y,z) → player or null
export const THROW_G = 16;
export function throwPath(o, v, hitFn, maxT = 4) {
  let x = o[0], y = o[1], z = o[2], vx = v[0], vy = v[1], vz = v[2];
  const h = 1 / 60;
  for (let t = 0; t < maxT; t += h) {
    const nx = x + vx * h, ny = y + vy * h, nz = z + vz * h;
    if (ny <= 0 || solid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
      // shatter: the fire spreads on the floor / block top right under the bottle
      return { x, y: groundBelow(x, y, z), z, t, hit: null };
    }
    if (hitFn) { const p = hitFn(nx, ny, nz); if (p) return { x: p.x, y: p.y, z: p.z, t, hit: p }; }
    x = nx; y = ny; z = nz; vy -= THROW_G * h;
  }
  return { x, y: Math.max(0, y), z, t: maxT, hit: null };
}
export function groundBelow(x, y, z) {
  const gx = Math.floor(x), gz = Math.floor(z);
  for (let yy = Math.min(H - 1, Math.floor(y)); yy >= 0; yy--) if (solid(gx, yy, gz)) return yy + 1;
  return 0;
}
// where a molotov flies: the thrower's eye, look direction, a bit of lob
export function throwStart(px, py, pz, d) {
  const W = WEAPONS.molotov;
  return { o: [px + d[0] * 0.5, py + EYE - 0.1 + d[1] * 0.5, pz + d[2] * 0.5], v: [d[0] * W.speed, d[1] * W.speed + 3.2, d[2] * W.speed] };
}

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

// ── game modes (same numbers on server and client) ──
export const MODE_INFO = {
  dm:     { name: 'DEATHMATCH', time: 300, ffa: true },
  dark:   { name: 'BLACKOUT',   time: 300, ffa: true },
  cap:    { name: 'CAPTURE Σ',  time: 360, teams: true, limit: 3 },
  zombie: { name: 'ZOMBIES',    solo: true, coop: true },   // solo run, or together with the party
};
// CAPTURE Σ: the Σ waits on top of the core in the center, each team has a base on its side
export const SIGMA_HOME = [24, 2, 24];
export const CAP_BASES = [[4.5, 0, 24], [43.5, 0, 24]];
export const CAP_BASE_R = 3;
export const TEAM_COL = [[214, 70, 70], [80, 130, 230]];
export const TEAM_NAME = ['RED', 'BLUE'];
// zombies: wave → how many, how tough, how fast
// ZOMBIES ends after ZOMBIE_WAVES waves (clear the last one = you survived)
export const ZOMBIE_WAVES = 50;
export function zombieWave(n) {
  return { count: Math.min(32, 3 + n * 2), hp: 30 + n * 9, speed: Math.min(5.4, 2.4 + n * 0.12), dmg: Math.min(34, 8 + n) };
}

// ── RANKS: 9 ranks × 3 divisions (I · II · III). ELO needed for one division of each rank.
// DOT 0 · BLADE 300 · WAVE 750 · SHIELD 1350 · STAR 2100 · FORTRESS 4500 · SIGIL 7500 · VORTEX 11100
// EIGEN I 15000 · EIGEN II 17500 · EIGEN III 20000 — and ELO keeps growing after that.
export const RANK_DIV = [100, 150, 200, 250, 800, 1000, 1200, 1300, 2500];
export const RANK_NAMES = ['DOT', 'BLADE', 'WAVE', 'SHIELD', 'STAR', 'FORTRESS', 'SIGIL', 'VORTEX', 'EIGEN'];
export function rankStart(tier, div = 0) {
  let e = 0;
  for (let t = 0; t < tier; t++) e += RANK_DIV[t] * 3;
  return e + RANK_DIV[tier] * div;
}
export function rankFromElo(elo) {
  elo = Math.max(0, Math.floor(elo || 0));
  for (let t = 0; t < RANK_DIV.length; t++) {
    for (let d = 0; d < 3; d++) {
      const s = rankStart(t, d), n = s + RANK_DIV[t];
      if (elo < n || (t === RANK_DIV.length - 1 && d === 2)) return { tier: t, div: d, start: s, next: t === 8 && d === 2 ? 0 : n };
    }
  }
}
