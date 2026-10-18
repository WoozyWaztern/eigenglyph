// ─────────────────────────────────────────────────────────────
//  3D renderer: one ray per character cell.
//  World = voxel DDA, players = analytic balls, viewmodel = prims.
//  Brightness → character from the classic donut ramp.
// ─────────────────────────────────────────────────────────────
import * as WD from '../../shared/world.js';
import { hitPrim, HIT } from './prims.js';
import { M, BASE } from './mats.js';

const RAMP = '.,-~:;=!*#$@';
const NR = RAMP.length;
let LX = -0.45, LY = 0.62, LZ = -0.64;
{ const l = Math.hypot(LX, LY, LZ); LX /= l; LY /= l; LZ /= l; }
// light for the viewmodel (camera space): above-left
let VLX = -0.4, VLY = 0.75, VLZ = -0.5;
{ const l = Math.hypot(VLX, VLY, VLZ); VLX /= l; VLY /= l; VLZ /= l; }

const rc = {};
const FOGC = [9, 10, 15];

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class Renderer {
  constructor() {
    this.depth = new Float32Array(0);
    this.cam = { f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0], tanX: 1, tanY: 1, pos: [0, 0, 0] };
  }

  // project world point → [cellX, cellY, dist] or null
  project(scr, x, y, z) {
    const c = this.cam;
    const vx = x - c.pos[0], vy = y - c.pos[1], vz = z - c.pos[2];
    const zz = vx * c.f[0] + vy * c.f[1] + vz * c.f[2];
    if (zz < 0.1) return null;
    const px = (vx * c.r[0] + vy * c.r[1] + vz * c.r[2]) / zz / c.tanX;
    const py = (vx * c.u[0] + vy * c.u[1] + vz * c.u[2]) / zz / c.tanY;
    return [Math.floor((px + 1) / 2 * scr.cols), Math.floor((1 - py) / 2 * scr.rows), Math.hypot(vx, vy, vz)];
  }

  // ── multi-core: split the screen into bands, one per worker. The newest finished
  //    frame is shown while the next one is being traced (no stalls on the main thread).
  initWorkers() {
    if (this.workers !== undefined) return;
    this.workers = null;
    try {
      const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      this.workers = Array.from({ length: n }, () => new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' }));
      this.job = null; this.latest = null; this.jobId = 0;
      this.workers.forEach(w => w.onmessage = e => this.onBand(e.data));
      this.workers.forEach(w => w.onerror = () => { this.workers = null; });
    } catch { this.workers = null; }
  }
  onBand(d) {
    const job = this.job;
    if (!job || d.id !== job.id) return;
    job.bands[d.k] = d; job.done++;
    if (job.done === job.bands.length) {
      this.latest = job; this.job = null;
      // safety net: if workers turn out slower than the main thread on this PC, stop using them
      const ms = performance.now() - job.t0;
      this.wAvg = this.wAvg ? this.wAvg * 0.8 + ms * 0.2 : ms;
      this.wCount = (this.wCount || 0) + 1;
      if (this.wCount > 20 && this.mAvg && this.wAvg > this.mAvg * 1.3) {
        this.workers.forEach(w => w.terminate()); this.workers = null; this.latest = null;
      }
    }
  }
  useWorkers(C, A, B, depth, vmId) {
    this.initWorkers();
    if (!this.workers) return false;
    const { cols, rows } = C, n = this.workers.length;
    if (!this.job) {
      const id = ++this.jobId, per = Math.ceil(rows / n);
      this.job = { id, cols, rows, bands: new Array(n), done: 0, t0: performance.now() };
      this.workers.forEach((w, k) => w.postMessage({ id, k, y0: Math.min(rows, k * per), y1: Math.min(rows, (k + 1) * per), C }));
    }
    const L = this.latest;
    if (!L || L.cols !== cols || L.rows !== rows) return false;   // first frame / resize: trace here once
    for (const b of L.bands) {
      const off = b.y0 * cols;
      A.set(b.A, off * 4); B.set(b.B, off * 4); depth.set(b.depth, off); vmId.set(b.vmId, off);
    }
    return true;
  }

  render(scr, camIn, scene) {
    const cols = scr.cols, rows = scr.rows, n = cols * rows;
    if (this.depth.length !== n) this.depth = new Float32Array(n);
    const depth = this.depth;
    if (!this.vmId || this.vmId.length !== n) this.vmId = new Int16Array(n);
    const vmId = this.vmId;
    const rampG = new Int32Array(NR);
    for (let i = 0; i < NR; i++) rampG[i] = scr.glyph(RAMP[i]);
    const gSpace = scr.glyph(' '), gDot = scr.glyph('.'), gStar = scr.glyph('·');
    const gX = scr.glyph('x'), gSigma = scr.glyph('Σ'), gO = scr.glyph('O');
    const gWound = [scr.glyph('@'), scr.glyph('%'), scr.glyph('#'), scr.glyph(':'), scr.glyph('|'), scr.glyph('\'')];

    // ── camera basis ──
    const ox = camIn.x, oy = camIn.y, oz = camIn.z;
    const cyw = Math.cos(camIn.yaw), syw = Math.sin(camIn.yaw), cp = Math.cos(camIn.pitch), sp = Math.sin(camIn.pitch);
    const fx = -syw * cp, fy = sp, fz = -cyw * cp;
    const r0x = cyw, r0y = 0, r0z = -syw;
    const u0x = syw * sp, u0y = cp, u0z = cyw * sp;
    const cr = Math.cos(camIn.roll || 0), sr = Math.sin(camIn.roll || 0);
    const rx = r0x * cr + u0x * sr, ry = r0y * cr + u0y * sr, rz = r0z * cr + u0z * sr;
    const ux = u0x * cr - r0x * sr, uy = u0y * cr - r0y * sr, uz = u0z * cr - r0z * sr;
    const aspect = (cols * scr.cellW) / (rows * scr.cellH);
    const tanY = Math.tan(camIn.fov / 2), tanX = tanY * aspect;
    const vmTanY = Math.tan(0.62), vmTanX = vmTanY * aspect;
    Object.assign(this.cam, { f: [fx, fy, fz], r: [rx, ry, rz], u: [ux, uy, uz], tanX, tanY, pos: [ox, oy, oz], vmTanX, vmTanY });

    const flash = scene.flash || 0;
    const players = scene.players;
    const np = players.length;

    // ── screen rectangles for players ──
    const rects = new Int32Array(np * 4);
    for (let i = 0; i < np; i++) {
      const p = players[i];
      const vx = p.bx - ox, vy = p.by - oy, vz = p.bz - oz;
      const zz = vx * fx + vy * fy + vz * fz;
      const d = Math.hypot(vx, vy, vz);
      if (d < p.br + 0.3) { rects[i * 4] = 0; rects[i * 4 + 1] = cols; rects[i * 4 + 2] = 0; rects[i * 4 + 3] = rows; continue; }
      if (zz < -p.br) { rects[i * 4] = 1; rects[i * 4 + 1] = 0; continue; }
      const z = Math.max(zz, 0.2);
      const sxc = (vx * rx + vy * ry + vz * rz) / z / tanX;
      const syc = (vx * ux + vy * uy + vz * uz) / z / tanY;
      const k = z < p.br * 2 ? 3 : 1.25;
      const radX = p.br / (z * tanX) * k, radY = p.br / (z * tanY) * k;
      rects[i * 4] = Math.floor((sxc - radX + 1) / 2 * cols) - 1;
      rects[i * 4 + 1] = Math.ceil((sxc + radX + 1) / 2 * cols) + 1;
      rects[i * 4 + 2] = Math.floor((1 - (syc + radY)) / 2 * rows) - 1;
      rects[i * 4 + 3] = Math.ceil((1 - (syc - radY)) / 2 * rows) + 1;
    }

    // ── viewmodel rect ──
    const vm = scene.vm || [];
    let vx0 = cols, vx1 = -1, vy0 = rows, vy1 = -1;
    for (const p of vm) {
      const br = p.type === 0 ? p.sx : p.type === 1 ? Math.hypot(p.sx, p.sy, p.sz) : p.sx + p.sz;
      for (let c = 0; c < 8; c++) {
        const X = p.px + (c & 1 ? br : -br), Y = p.py + (c & 2 ? br : -br), Z = Math.max(0.03, p.pz + (c & 4 ? br : -br));
        const sx = X / Z / vmTanX, sy = Y / Z / vmTanY;
        const cx = (sx + 1) / 2 * cols, cyy = (1 - sy) / 2 * rows;
        if (cx < vx0) vx0 = cx; if (cx > vx1) vx1 = cx;
        if (cyy < vy0) vy0 = cyy; if (cyy > vy1) vy1 = cyy;
      }
    }
    vx0 = Math.max(0, Math.floor(vx0)); vx1 = Math.min(cols - 1, Math.ceil(vx1));
    vy0 = Math.max(0, Math.floor(vy0)); vy1 = Math.min(rows - 1, Math.ceil(vy1));
    const nvm = vm.length;

    const A = scr.A, B = scr.B;
    const decals = scene.floorDecals; // Map cellKey -> [[x,z,r], ...]

    const C = { cols, rows, rampG, gSpace, gDot, gStar, gX, gSigma, gO, gWound, ox, oy, oz, fx, fy, fz, rx, ry, rz, ux, uy, uz,
      tanX, tanY, vmTanX, vmTanY, flash, rects, vx0, vx1, vy0, vy1, decals: decals || new Map(),
      players: players.map(p => ({ prims: p.prims, tint: p.tint, wounds: p.wounds, yaw: p.yaw, dead: p.dead, x: p.x, z: p.z })),
      vm };
    if (!this.useWorkers(C, A, B, depth, vmId)) {
      const t0 = performance.now();
      traceRows(C, 0, rows, 0, A, B, depth, vmId);
      const ms = performance.now() - t0;
      this.mAvg = this.mAvg ? this.mAvg * 0.8 + ms * 0.2 : ms;
    }
    // ───── viewmodel outlines: dark seams between parts + silhouette ─────
    if (nvm) {
      for (let cy = Math.max(0, vy0 - 1); cy <= Math.min(rows - 1, vy1 + 1); cy++) {
        for (let cx = Math.max(0, vx0 - 1); cx <= Math.min(cols - 1, vx1 + 1); cx++) {
          const i = cy * cols + cx, id = vmId[i];
          if (id < 0) continue;
          const l = cx > 0 ? vmId[i - 1] : -1, r = cx < cols - 1 ? vmId[i + 1] : -1;
          const u = cy > 0 ? vmId[i - cols] : -1, d = cy < rows - 1 ? vmId[i + cols] : -1;
          if (l !== id || r !== id || u !== id || d !== id) {
            const j = i << 2;
            const out = l < 0 || r < 0 || u < 0 || d < 0;
            const k = out ? 0.55 : 0.4;
            A[j] *= k; A[j + 1] *= k; A[j + 2] *= k;
            B[j] = 0; B[j + 1] = 0; B[j + 2] = 0;
          }
        }
      }
    }

    // ───── particles (sparks, blood, smoke, holes) ─────
    const parts = scene.particles;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const pr = this.project(scr, p.x, p.y, p.z);
      if (!pr) continue;
      const [cx, cy, dist] = pr;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const di = cy * cols + cx;
      if (depth[di] < dist - (p.hole ? 0.12 : 0.05)) continue;
      const a = p.hole ? Math.min(1, p.life / 3) : Math.min(1, p.life / p.max * 1.5);
      const fog = Math.exp(-dist * 0.035);
      const c = p.col;
      scr.put(cx, cy, p.ch, [c[0] * a * fog, c[1] * a * fog, c[2] * a * fog]);
      if (p.size > 1) {
        // bigger flashes: little star around the center
        const s = p.size > 2 ? 2 : 1;
        for (const [ax, ay, ch] of [[-s, 0, '-'], [s, 0, '-'], [0, -1, '|'], [0, 1, '|'], [-1, -1, '\\'], [1, 1, '\\'], [1, -1, '/'], [-1, 1, '/']]) {
          const xx = cx + ax, yy = cy + ay;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          if (depth[yy * cols + xx] < dist - 0.3) continue;
          scr.put(xx, yy, ch, [c[0] * a * 0.8, c[1] * a * 0.8, c[2] * a * 0.6]);
        }
      }
    }

    // ───── first-person muzzle flash ─────
    if (scene.muzzleFlash > 0 && scene.vmMuzzle) {
      const m = scene.vmMuzzle;
      if (m[2] > 0.05) {
        const cx = Math.floor((m[0] / m[2] / vmTanX + 1) / 2 * cols);
        const cy = Math.floor((1 - m[1] / m[2] / vmTanY) / 2 * rows);
        const k = scene.muzzleFlash;
        const R = Math.round(2 + k * 5);
        const chars = '@$#*!=;:~-,.';
        for (let yy = -R; yy <= R; yy++) for (let xx = -R * 2; xx <= R * 2; xx++) {
          const d = Math.hypot(xx / 2, yy) / R;
          const ang = Math.atan2(yy, xx / 2);
          const spike = 0.55 + 0.45 * Math.abs(Math.cos(ang * 3 + scene.flashSeed));
          if (d > spike) continue;
          const ci = Math.min(chars.length - 1, Math.floor(d / spike * chars.length));
          const v = (1 - d / spike);
          scr.put(cx + xx, cy + yy, chars[ci], [255, 200 + v * 55, 120 + v * 120], [60 * v, 40 * v, 10 * v]);
        }
      }
    }
  }
}

// ── the per-cell ray tracer: rows y0..y1 of the screen; writes into band buffers
//    (index = cell - base). Runs on the main thread or inside render workers.
export function traceRows(C, y0, y1, base, A, B, depth, vmId) {
  const { cols, rows, rampG, gSpace, gDot, gStar, gX, gSigma, gO, gWound, ox, oy, oz, fx, fy, fz, rx, ry, rz, ux, uy, uz,
    tanX, tanY, vmTanX, vmTanY, flash, players, rects, vm, vx0, vx1, vy0, vy1, decals } = C;
  const np = players.length, nvm = vm.length;
  const scr = { setCell(i, gi, fr, fg, fb, br, bg, bb) {
    const j = i << 2; A[j] = fr; A[j + 1] = fg; A[j + 2] = fb; A[j + 3] = gi & 255; B[j] = br; B[j + 1] = bg; B[j + 2] = bb; B[j + 3] = gi >> 8;
  } };
for (let cy = y0; cy < y1; cy++) {
    const sy = 1 - (cy + 0.5) / rows * 2;
    for (let cx = 0; cx < cols; cx++) {
      const sx = (cx + 0.5) / cols * 2 - 1;
      const idx = cy * cols + cx - base;
      let mat = 0, nx = 0, ny = 0, nz = 0, t = 1e9, lum = 0, glyph = -1;
      let col0 = 0, col1 = 0, col2 = 0, spec = 0;
      let isVM = false, owner = null, lhz = 0;
      vmId[idx] = -1;

      // ───── viewmodel (camera space) ─────
      if (nvm && cx >= vx0 && cx <= vx1 && cy >= vy0 && cy <= vy1) {
        let dxv = sx * vmTanX, dyv = sy * vmTanY, dzv = 1;
        const l = 1 / Math.hypot(dxv, dyv, dzv); dxv *= l; dyv *= l; dzv *= l;
        let best = 1e9, bp = null, bk = -1, bnx = 0, bny = 0, bnz = 0, blz = 0;
        for (let k = 0; k < nvm; k++) {
          const tt = hitPrim(vm[k], 0, 0, 0, dxv, dyv, dzv);
          if (tt > 0 && tt < best) { best = tt; bp = vm[k]; bk = k; bnx = HIT.nx; bny = HIT.ny; bnz = HIT.nz; blz = HIT.lz; }
        }
        if (bp) {
          isVM = true; mat = bp.mat; vmId[idx] = bp.mat === M.ARM ? 100 : bk;
          const b = BASE[mat];
          const ndl = Math.max(0, bnx * VLX + bny * VLY + bnz * VLZ);
          const facing = Math.max(0, -(bnx * dxv + bny * dyv + bnz * dzv));
          // specular
          const dn = dxv * bnx + dyv * bny + dzv * bnz;
          const rfx = dxv - 2 * dn * bnx, rfy = dyv - 2 * dn * bny, rfz = dzv - 2 * dn * bnz;
          const s = Math.max(0, rfx * VLX + rfy * VLY + rfz * VLZ);
          const s2 = s * s, s4 = s2 * s2, s8 = s4 * s4;
          lum = 0.1 + ndl * 0.55 + facing * 0.22 + s8 * s8 * b.spec * 0.9 + flash * 0.6;
          // rim
          lum += Math.pow(1 - facing, 3) * 0.12;
          col0 = b.c[0]; col1 = b.c[1]; col2 = b.c[2];
          if (mat === M.CAN) {
            const hl = bp.sz;
            if (Math.abs(blz) > hl * 0.72) { col0 = 170; col1 = 172; col2 = 180; }
            else if (bp.tag === 1 && facing > 0.8 && Math.abs(blz) < hl * 0.32) { glyph = gSigma; col0 = 240; col1 = 210; col2 = 210; lum = 1; }
            else if (Math.abs(blz) < hl * 0.45) { col0 = 40; col1 = 10; col2 = 14; lum *= 0.9; }
          }
          depth[idx] = 0.3;
        }
      }

      if (!isVM) {
        let dx = fx + rx * sx * tanX + ux * sy * tanY;
        let dy = fy + ry * sx * tanX + uy * sy * tanY;
        let dz = fz + rz * sx * tanX + uz * sy * tanY;
        const l = 1 / Math.hypot(dx, dy, dz); dx *= l; dy *= l; dz *= l;

        // world
        const tw = WD.raycast(ox, oy, oz, dx, dy, dz, 46, rc);
        if (tw > 0) { t = tw; mat = rc.mat; nx = rc.nx; ny = rc.ny; nz = rc.nz; }

        // players
        for (let i = 0; i < np; i++) {
          const i4 = i * 4;
          if (cx < rects[i4] || cx > rects[i4 + 1] || cy < rects[i4 + 2] || cy > rects[i4 + 3]) continue;
          const pl = players[i];
          const pr = pl.prims;
          for (let k = 0; k < pr.length; k++) {
            const tt = hitPrim(pr[k], ox, oy, oz, dx, dy, dz);
            if (tt > 0 && tt < t) { t = tt; mat = pr[k].mat; nx = HIT.nx; ny = HIT.ny; nz = HIT.nz; owner = pl; }
          }
        }

        if (mat === 0) {
          // ───── sky: black void, sparse stars, pale moon ─────
          depth[idx] = 1e9;
          const md = dx * LX + dy * LY + dz * LZ;
          if (md > 0.9975) {
            const k = (md - 0.9975) / 0.0025;
            const g = rampG[Math.min(NR - 1, 6 + Math.floor(k * 6))];
            const v = 120 + k * 90;
            scr.setCell(idx, g, v, v + 4, v + 12, 14, 14, 18);
            continue;
          }
          if (md > 0.993) { scr.setCell(idx, gDot, 50, 52, 60, 6, 6, 9); continue; }
          if (dy > 0.02) {
            const h = hash3(Math.floor(dx * 90), Math.floor(dy * 90), Math.floor(dz * 90));
            if (h > 0.9965) { const v = 70 + (h - 0.9965) * 30000; scr.setCell(idx, h > 0.9993 ? gStar : gDot, v, v, v + 10, 3, 3, 5); continue; }
          }
          scr.setCell(idx, gSpace, 0, 0, 0, 3, 3, 5);
          continue;
        }

        depth[idx] = t;
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        const b = BASE[mat];
        col0 = b.c[0]; col1 = b.c[1]; col2 = b.c[2];
        const ndl = Math.max(0, nx * LX + ny * LY + nz * LZ);
        const facing = Math.max(0, -(nx * dx + ny * dy + nz * dz));
        lum = ndl * 0.42 + 0.2 + ny * 0.06 + facing * 0.55 / (1 + t * t * 0.004) + flash * 0.9 / (1 + t * 0.2);
        if (b.spec) {
          const dn = dx * nx + dy * ny + dz * nz;
          const s = Math.max(0, (dx - 2 * dn * nx) * LX + (dy - 2 * dn * ny) * LY + (dz - 2 * dn * nz) * LZ);
          const s2 = s * s, s4 = s2 * s2;
          lum += s4 * s4 * b.spec * 0.5;
        }

        if (mat === M.FLOOR) {
          lum *= 0.72;
          // tiles every 2 units
          const u = hx - Math.floor(hx / 2) * 2, v = hz - Math.floor(hz / 2) * 2;
          const e = Math.min(u, 2 - u, v, 2 - v);
          if (e < 0.05) lum *= 0.5;
          // blob shadows under players
          for (let i = 0; i < np; i++) {
            const pl = players[i];
            const ddx = hx - pl.x, ddz = hz - pl.z, d2 = ddx * ddx + ddz * ddz;
            if (d2 < 0.8) lum *= 0.35 + 0.65 * d2 / 0.8;
          }
          // blood on the floor
          if (decals) {
            const list = decals.get(Math.floor(hx) + Math.floor(hz) * 1000);
            if (list) for (const dcl of list) {
              const ddx = hx - dcl[0], ddz = hz - dcl[1];
              const d2 = ddx * ddx + ddz * ddz, r2 = dcl[2] * dcl[2];
              if (d2 < r2) {
                const k = 1 - d2 / r2;
                col0 = 120; col1 = 12; col2 = 16;
                lum = Math.max(lum, 0.25 + k * 0.25);
                glyph = gWound[k > 0.6 ? 1 : 3];
                break;
              }
            }
          }
        } else if (mat < 10) {
          // voxel face edges → outlined blocks
          let u, v;
          if (nx !== 0) { u = hz - Math.floor(hz); v = hy - Math.floor(hy); }
          else if (ny !== 0) { u = hx - Math.floor(hx); v = hz - Math.floor(hz); }
          else { u = hx - Math.floor(hx); v = hy - Math.floor(hy); }
          const e = Math.min(u, 1 - u, v, 1 - v);
          if (e < 0.05) lum *= 0.42;
          if (mat === M.PANEL && Math.abs(v - 0.5) < 0.04) { lum += 0.3; col0 = 70; col1 = 160; col2 = 170; } // glowing strip
          if (mat === M.CRATE && (Math.abs(u - v) < 0.05 || Math.abs(u + v - 1) < 0.05)) lum *= 0.6;
        } else if (owner) {
          // ───── player ball ─────
          if (mat === M.BODY) {
            col0 = owner.tint[0]; col1 = owner.tint[1]; col2 = owner.tint[2];
            lum += Math.pow(1 - facing, 2.5) * 0.35; // rim light
            if (owner.dead) lum *= 0.55;
            // wounds (in body local space)
            const ws = owner.wounds;
            if (ws.length) {
              const cyw2 = Math.cos(owner.yaw), syw2 = Math.sin(owner.yaw);
              const lnx = nx * cyw2 + nz * -syw2, lny = ny, lnz = nx * -syw2 + nz * -cyw2;
              for (let w = 0; w < ws.length; w++) {
                const W0 = ws[w][0], W1 = ws[w][1], W2 = ws[w][2], type = ws[w][3];
                const dd = lnx * W0 + lny * W1 + lnz * W2;
                const core = type === 1 ? 0.994 : 0.988, ring = type === 1 ? 0.982 : 0.966;
                if (dd > core) { glyph = gWound[0]; col0 = 80; col1 = 4; col2 = 8; lum = 0.75; break; }
                if (dd > ring) {
                  const hh = hash3(Math.floor(lnx * 60), Math.floor(lny * 60), w);
                  if (hh > 0.25) { glyph = gWound[hh > 0.7 ? 1 : 2]; col0 = 150; col1 = 18; col2 = 24; lum = Math.max(lum, 0.55); break; }
                }
                // blood dripping down from the wound
                if (lny < W1 && lny > W1 - 0.55) {
                  const hx2 = lnx - W0, hz2 = lnz - W2;
                  const fall = (W1 - lny) / 0.55;
                  const wdt = 0.05 * (1 - fall);
                  if (hx2 * hx2 + hz2 * hz2 < wdt * wdt && hash3(w, 7, 3) > 0.25) {
                    glyph = gWound[fall < 0.5 ? 3 : 4]; col0 = 120; col1 = 10; col2 = 16; lum = Math.max(lum, 0.45); break;
                  }
                }
              }
            }
          } else if (mat === M.EYE) {
            if (owner.dead) { glyph = gX; col0 = 140; col1 = 30; col2 = 34; lum = 0.8; }
            else lum = 1.0;
          } else if (mat === M.ARM) {
            col0 = owner.tint[0]; col1 = owner.tint[1]; col2 = owner.tint[2];
            lum += Math.pow(1 - facing, 2.5) * 0.3;
          }
        }
        const fog = Math.exp(-t * 0.032);
        lum *= fog;
      }

      // ───── brightness → character + color ─────
      if (lum < 0) lum = 0;
      let g = glyph;
      if (g < 0) {
        const q = lum * NR;
        if (q < 0.4) g = gSpace;
        else g = rampG[q >= NR ? NR - 1 : (q | 0)];
      }
      let k = 0.34 + lum * 1.25;
      if (k > 1.7) k = 1.7;
      let r = col0 * k, gg = col1 * k, bb = col2 * k;
      if (!isVM) {
        const fogm = Math.min(1, t / 46) * 0.55;
        r = r * (1 - fogm) + FOGC[0] * fogm; gg = gg * (1 - fogm) + FOGC[1] * fogm; bb = bb * (1 - fogm) + FOGC[2] * fogm;
      }
      if (r > 255) r = 255; if (gg > 255) gg = 255; if (bb > 255) bb = 255;
      const j = idx << 2;
      A[j] = r; A[j + 1] = gg; A[j + 2] = bb; A[j + 3] = g & 255;
      const bk = isVM ? 0.3 : 0.1;
      B[j] = r * bk; B[j + 1] = gg * bk; B[j + 2] = bb * bk * 1.1; B[j + 3] = g >> 8;
    }
  }

}
