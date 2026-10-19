// ─────────────────────────────────────────────────────────────
//  Game: local player, physics, weapons, other players,
//  particles, chat + bubbles, HUD, pause menu, death.
// ─────────────────────────────────────────────────────────────
import * as WD from '../../shared/world.js';
import { makePrim, setRotYXZ, SPHERE, BOX, CYL } from './prims.js';
import { M } from './mats.js';
import { C } from './ui.js';
import { placeItem, drawItemIcon, PISTOLS } from './items.js';

const SLOTS = ['SHOTGUN', 'KNIFE', 'SODA', 'AK-47', 'PISTOL', 'H.KNIFE', 'BAT', 'MOLOTOV', 'MEDKIT'];
// full magazines for every gun (index → rounds)
const fullMags = () => Object.fromEntries(WD.ITEMS.map((it, i) => [i, it.kind === 'gun' ? WD.WEAPONS[it.id].mag : 0]).filter(e => e[1]));
const KF_ICON = { zombie: ' >(x)< ', dev: ' {dev} ', shotgun: ' =[==> ', knife: ' -|--> ', ak47: ' =|===- ', pistol: ' r=- ', makarov: ' r=- ', deagle: ' r==- ', hknife: ' =||==> ', bat: ' (====) ', fire: ' ~^~^~ ' };
const MELEE_T = { 5: 0.42, 6: 0.62 };         // swing animation length
const FIRE_CH = '^*\'",.';
const ZOMBIE_TINT = [78, 118, 70];
const MODE_TITLE = { dm: 'DEATHMATCH', cap: 'CAPTURE Σ', dark: 'BLACKOUT', zombie: 'ZOMBIES' };
const TINTS = [[104, 108, 118], [122, 100, 98], [96, 114, 106], [100, 102, 126], [122, 114, 92], [112, 96, 118], [90, 112, 122]];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const rc = {};

function wrapText(text, w) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (let wd of words) {
    while ([...wd].length > w) { if (cur) { lines.push(cur); cur = ''; } lines.push([...wd].slice(0, w).join('')); wd = [...wd].slice(w).join(''); }
    if (!cur) cur = wd;
    else if ([...cur].length + 1 + [...wd].length <= w) cur += ' ' + wd;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

export class Game {
  constructor(app) {
    this.app = app;
    this.active = false;
  }

  // ───────────────────────── lifecycle ─────────────────────────
  start(welcome) {
    this.active = true;
    this.time = 0;
    this.paused = false;
    this.others = new Map();
    this.particles = [];
    this.floorDecals = new Map();
    this.chatLog = [];
    this.chatOpen = false; this.chatText = '';
    this.killfeed = [];
    this.match = null; this.results = null;
    this.dmgNums = [];
    this.hitmarker = 0; this.targetInfo = null; this.centerMsg = null;
    this.hurtFlash = 0; this.shake = 0; this.flash = 0; this.muzzleFlash = 0; this.flashSeed = 0;
    this.sendT = 0;
    this.myId = welcome.id;
    this.mode = welcome.mode || 'dm';
    this.score = welcome.score || [0, 0];
    this.wave = welcome.wave || 0; this.waveMsg = null; this.zend = null;
    this.sigma = welcome.sigma || null;
    this.dev = welcome.dev || this.app.devFlags || null;
    this.flashlight = true; this.lights = [];
    const y = welcome.you;
    this.me = {
      id: y.id, name: y.name, x: y.x, y: y.y, z: y.z, vx: 0, vy: 0, vz: 0, yaw: y.yaw, pitch: 0,
      onGround: true, hp: y.hp, dead: false, deadT: 0, eyeOff: 0, slowT: 0, stepAcc: 0, bob: 0, bobAmp: 0,
      kills: y.kills, deaths: y.deaths, punch: 0, killer: '', burn: false, team: y.team ?? -1,
    };
    this.wp = {
      w: 0, equip: 1, ammo: 6, shotCD: 0, pumpT: -1, pump: 0, recoil: 0, ads: 0,
      slash: -1, slashSide: 1, knifeCD: 0, knifeHitDone: false,
      drink: -1, drinkCD: 0, drinkSent: false, gulps: 0,
      reload: -1, reloading: false, reloadBlend: 0, swayX: 0, swayY: 0, pumpSnd: false,
      mags: fullMags(), gunCD: 0, meleeCD: 0,
      throwT: -1, throwSent: false, molotovs: WD.WEAPONS.molotov.count, throwCD: 0,
      use: -1, useSent: false, medCD: 0,
    };
    // hotbar: the loadout — max 4 items, one PRIMARY / SECONDARY / MELEE / UTILITY (-1 = empty slot)
    this.loadout = welcome.loadout || [0, -1, 1, 2];
    this.wp.w = this.loadout.find(i => i >= 0) ?? -1;
    this.projectiles = [];
    this.fires = [];
    for (const f of welcome.fires || []) this.addFire(f);
    this.burnFx = 0; this.healFx = 0; this.fireBuf = null; this.crackleT = 0;
    for (const p of welcome.players) if (p.id !== this.myId) this.addOther(p);
    this.app.audio.setAmbient(1);
  }
  stop() { this.active = false; this.chatOpen = false; this.app.audio.setAmbient(0.6); }

  addOther(p) {
    const o = {
      id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tpitch: p.pitch, w: p.w, hp: p.hp, dead: p.dead,
      wounds: (p.wounds || []).slice(), kills: p.kills || 0, deaths: p.deaths || 0,
      team: p.team ?? -1, zombie: !!p.zombie, maxHp: p.maxHp || 100, fl: 1,
      tint: p.zombie ? ZOMBIE_TINT.map(v => v + ((p.id * 37) % 20) - 10) : p.team >= 0 ? WD.TEAM_COL[p.team].map(v => v * 0.62 + 30) : TINTS[p.id % TINTS.length], bubbles: [], walk: 0, stepAcc: 0, shootT: 9, knifeT: 9, drinkT: 9, deadT: p.dead ? 9 : 0,
      throwT: 9, useT: 9, burn: false, side: 1,
      prims: Array.from({ length: 24 }, makePrim), activePrims: [],
    };
    this.others.set(p.id, o);
    return o;
  }
  playerName(id) { if (id === 0) return 'world'; if (id === this.myId) return this.me.name; const o = this.others.get(id); return o ? o.name : '?'; }
  addFire(m) { this.fires.push({ x: m.x, y: m.y, z: m.z, r: m.r, life: m.life, max: Math.max(m.life, 0.1), by: m.by }); }

  // ───────────────────────── network ─────────────────────────
  onNet(m) {
    if (!this.active) return;
    const A = this.app.audio, me = this.me;
    switch (m.t) {
      case 'join': if (m.p.id !== this.myId) { const o = this.addOther(m.p); if (o.zombie) { const [pan, vol] = this.spatial(o.x, o.z); A.groan(pan, vol); } } break;
      case 'match': this.match = { phase: m.phase, ends: this.time + m.left }; if (m.score) this.score = m.score; if (m.wave !== undefined) this.wave = m.wave; break;
      case 'matchstart':
        this.match = { phase: 'play', ends: this.time + (m.left || 1e9) };
        this.fires = []; this.projectiles = [];
        this.results = null; this.zend = null; this.killfeed = [];
        this.score = m.score || [0, 0]; this.wave = 0;
        me.kills = me.deaths = 0;
        for (const o of this.others.values()) o.kills = o.deaths = 0;
        this.centerMsg = { text: { dm: 'DEATHMATCH  ·  5:00  ·  GO', cap: 'CAPTURE Σ  ·  bring the Σ to your base', dark: 'BLACKOUT  ·  F = flashlight', zombie: 'ZOMBIES  ·  survive' }[this.mode], t: 3 };
        break;
      case 'matchend':
        this.match = { phase: 'results', ends: this.time + m.next };
        this.results = { list: m.results, ranked: m.ranked, t: m.next, score: m.score };
        break;
      case 'sigma': this.sigma = m; if (m.score) this.score = m.score; break;
      case 'capture': {
        this.score = m.score;
        const mine = m.team === me.team;
        this.centerMsg = { text: `${WD.TEAM_NAME[m.team]} CAPTURED THE Σ  ·  ${m.score[0]} : ${m.score[1]}`, t: 3, col: WD.TEAM_COL[m.team] };
        mine ? A.heal() : A.hurt();
        break;
      }
      case 'wave':
        this.wave = m.wave;
        if (m.cleared) { this.waveMsg = { text: `WAVE ${m.wave} CLEARED  ·  +${m.bonus} ★`, t: 3.5, good: true }; A.heal(); }
        else { this.waveMsg = { text: `W A V E   ${m.wave}  ·  ${m.count} zombies`, t: 3 }; A.death(); }
        break;
      case 'zend':
        this.zend = { ...m, t: this.time };
        this.match = { phase: 'results', ends: this.time + m.next };
        break;
      case 'devset': this.dev = m.dev; this.app.devFlags = m.dev; break;
      case 'devtp': me.x = m.x; me.z = m.z; me.y = WD.groundBelow(m.x, 7, m.z); me.vx = me.vy = me.vz = 0; break;
      case 'leave': this.others.delete(m.id); break;
      case 's':
        for (const a of m.p) {
          const [id, x, y, z, yaw, pitch, w, hp, dead, burn, team, zombie, fl] = a;
          if (id === this.myId) { me.hp = hp; me.burn = !!burn && !me.dead; continue; }
          let o = this.others.get(id);
          if (!o && zombie) o = this.addOther({ id, name: 'zombie', x, y, z, yaw, pitch, w, hp, dead, zombie: 1, team: -1 });
          if (!o) continue;
          o.tx = x; o.ty = y; o.tz = z; o.tyaw = yaw; o.tpitch = pitch; o.w = w; o.hp = hp; o.fl = fl === 0 ? 0 : 1;
          if (dead && !o.dead) o.deadT = 0;
          o.dead = !!dead; o.burn = !!burn && !o.dead;
        }
        if (m.sg && this.sigma) { this.sigma.x = m.sg[0]; this.sigma.y = m.sg[1]; this.sigma.z = m.sg[2]; }
        break;
      case 'fx': {
        const o = this.others.get(m.id); if (!o) break;
        const [pan, vol] = this.spatial(o.x, o.z);
        if (m.k === 'shot') {
          o.shootT = 0;
          const w = m.w || 0;
          if (WD.isGun(w)) A.gun(w, pan, vol);
          else { A.shotgun(pan, vol); setTimeout(() => A.pump(pan, vol * 0.7), 250); }
          // muzzle flash + tracers + impacts
          const f = [-Math.sin(o.yaw), 0, -Math.cos(o.yaw)];
          this.spawn(o.x + f[0] * 1.6, o.y + 1.0, o.z + f[2] * 1.6, 0, 0, 0, 0.06, '@', [255, 220, 150], 0, w === 0 ? 3 : 2);
          this.lights.push({ x: o.x + f[0], y: o.y + 1.2, z: o.z + f[2], t: 0.14, max: 0.14, k: w === 0 ? 1.4 : 1 });
          for (const d of m.pel) this.tracer(m.o, d, false);
        } else if (m.k === 'knife') { o.knifeT = 0; A.knife(pan, vol * 0.8); }
        else if (m.k === 'melee') { o.knifeT = 0; o.side = -o.side; if (m.w === 6) A.batSwing(pan, vol); else A.knife(pan, vol * 0.9); }
        break;
      }
      case 'hit': {
        const victimIsMe = m.id === this.myId;
        const tgt = victimIsMe ? null : this.others.get(m.id);
        if (tgt) { for (const w of m.wounds) { tgt.wounds.push(w); if (tgt.wounds.length > 28) tgt.wounds.shift(); } tgt.hp = m.hp; }
        // blood
        for (const p of m.pts || []) {
          const cxp = victimIsMe ? me.x : tgt ? tgt.x : p[0], czp = victimIsMe ? me.z : tgt ? tgt.z : p[2];
          for (let i = 0; i < 9; i++) {
            const dx = p[0] - cxp, dz = p[2] - czp, l = Math.hypot(dx, dz) || 1;
            this.spawn(p[0], p[1], p[2], dx / l * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.5, Math.random() * 2.5, dz / l * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.5,
              0.8 + Math.random() * 0.8, ',.\'`;'[Math.floor(Math.random() * 5)], [150, 14, 20], 18, 1, true);
          }
        }
        if (victimIsMe && !m.dmg) { /* god mode: no damage, no effects */ }
        else if (victimIsMe && m.w === 'fire') { me.hp = m.hp; this.hurtFlash = Math.max(this.hurtFlash, 0.35); me.burn = true; }
        else if (victimIsMe) {
          me.hp = m.hp; me.slowT = 0.8; this.hurtFlash = 1; this.shake = 0.5; A.hurt(); A.flesh();
          me.punch += (Math.random() - 0.5) * 0.06;
        } else if (tgt) {
          const [pan, vol] = this.spatial(tgt.x, tgt.z);
          A.flesh(pan, vol);
        }
        if (m.by === this.myId && tgt) {
          if (m.w !== 'fire') { this.hitmarker = 0.22; A.hitmark(); }
          this.targetInfo = { name: tgt.name, hp: m.hp, t: 2.5 };
          this.dmgNums.push({ text: `-${m.dmg}`, t: 0, x: (Math.random() - 0.5) * 6, fire: m.w === 'fire' });
        }
        if (m.w === 'zombie' && victimIsMe) A.groan(0, 1);
        if (m.w === 'bat' && (victimIsMe || tgt)) { const q = victimIsMe ? me : tgt; const [pan, vol] = this.spatial(q.x, q.z); A.batHit(pan, vol); }
        break;
      }
      case 'kill': {
        const victim = m.victim === this.myId ? me : this.others.get(m.victim);
        const killer = m.killer === this.myId ? me : this.others.get(m.killer);
        if (victim) { victim.kills = m.vk; victim.deaths = m.vd; }
        if (killer) { killer.kills = m.kk; killer.deaths = m.kd; }
        this.killfeed.push({ k: this.playerName(m.killer), v: this.playerName(m.victim), w: m.w, t: this.mode === 'zombie' ? 2.5 : 6, mine: m.killer === this.myId || m.victim === this.myId });
        if (this.killfeed.length > 5) this.killfeed.shift();
        if (m.victim === this.myId) {
          me.dead = true; me.deadT = 0; me.hp = 0; me.killer = this.playerName(m.killer);
          this.chatOpen = false; this.app.audio.death();
          const wp = this.wp; wp.ads = 0; wp.reload = -1; wp.reloading = false; wp.drink = -1; wp.slash = -1; wp.throwT = -1; wp.use = -1;
          me.burn = false;
          this.addDecal(me.x, me.z, 0.9);
        } else {
          const o = this.others.get(m.victim);
          if (o) { o.dead = true; o.deadT = 0; this.addDecal(o.x, o.z, 0.95); }
          if (m.killer === this.myId && !(o && o.zombie)) this.centerMsg = { text: `ELIMINATED  ${this.playerName(m.victim)}`, t: 2.2 };
        }
        break;
      }
      case 'heal':
        if (m.id === this.myId) { me.hp = m.hp; A.heal(); if (m.w === 8) { this.healFx = 1.2; me.burn = false; } }
        else { const o = this.others.get(m.id); if (o) { o.hp = m.hp; if (m.w === 8) { o.useT = 0; o.burn = false; } else o.drinkT = 0; } }
        break;
      case 'throw': {
        const path = WD.throwPath(m.o, m.v, null);
        this.projectiles.push({ by: m.id, o: m.o, v: m.v, t: 0, end: path.t + 0.05 });
        if (m.id === this.myId) this.wp.molotovs = m.left;
        else { const o = this.others.get(m.id); if (o) o.throwT = 0; }
        break;
      }
      case 'fire': {
        // the bottle that made this fire is gone
        const i = this.projectiles.findIndex(p => p.by === m.by);
        if (i >= 0) this.projectiles.splice(i, 1);
        this.addFire(m);
        const [pan, vol] = this.spatial(m.x, m.z);
        A.glass(pan, vol); A.whoosh(pan, vol);
        for (let k = 0; k < 14; k++) this.spawn(m.x, m.y + 0.3, m.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.5 + Math.random() * 0.4, '\'`.,'[k % 4], [150, 200, 140], 14);
        break;
      }
      case 'push':
        me.vx += m.vx; me.vz += m.vz; me.vy = Math.max(me.vy, m.vy); me.onGround = false; this.shake = Math.max(this.shake, 0.6);
        break;
      case 'respawn':
        if (m.id === this.myId) {
          Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, dead: false, deadT: 0, slowT: 0, eyeOff: 0 });
          this.zend = null;
          const wp = this.wp; wp.ammo = 6; wp.equip = 1; wp.drinkCD = 0; wp.pump = 0; wp.pumpT = -1;
          wp.mags = fullMags(); wp.molotovs = WD.WEAPONS.molotov.count; wp.medCD = 0; wp.throwT = -1; wp.use = -1;
          me.burn = false;
          this.hurtFlash = 0;
        } else {
          const o = this.others.get(m.id);
          if (o) { o.x = o.tx = m.x; o.y = o.ty = m.y; o.z = o.tz = m.z; o.yaw = o.tyaw = m.yaw; o.dead = false; o.hp = 100; o.wounds = []; o.burn = false; }
          if (m.id === this.myId) this.zend = null;
        }
        break;
      case 'chat': {
        this.addChat(m);
        if (!m.sys) {
          const o = this.others.get(m.id);
          if (o) {
            o.bubbles.push({ text: m.text, t: 0 });
            if (o.bubbles.length > 3) o.bubbles.shift();
          }
          this.app.audio.chat();
        }
        break;
      }
    }
  }
  addChat(m) {
    this.chatLog.push({ name: m.name || '', text: m.text, sys: !!m.sys, t: 0, mine: m.id === this.myId });
    if (this.chatLog.length > 60) this.chatLog.shift();
  }
  spatial(x, z) {
    const me = this.me;
    const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    const pan = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
    return [pan * 0.8, 1 / (1 + d * 0.08)];
  }

  // ───────────────────────── particles ─────────────────────────
  spawn(x, y, z, vx, vy, vz, life, ch, col, grav = 0, size = 1, blood = false) {
    if (this.particles.length > 1400) this.particles.shift();
    const p = { x, y, z, vx, vy, vz, life, max: life, ch, col, grav, size, blood, hole: false, tall: false };
    this.particles.push(p);
    return p;
  }
  addDecal(x, z, r) {
    const d = [x, z, r];
    for (let gx = Math.floor(x - r); gx <= Math.floor(x + r); gx++)
      for (let gz = Math.floor(z - r); gz <= Math.floor(z + r); gz++) {
        const k = gx + gz * 1000;
        let l = this.floorDecals.get(k);
        if (!l) { l = []; this.floorDecals.set(k, l); }
        l.push(d); if (l.length > 12) l.shift();
      }
  }
  // a pellet path: sparks where it lands, faint trail
  tracer(o, d, mine) {
    let t = WD.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 40, rc);
    let hitWall = t > 0;
    if (!hitWall) t = 40;
    // stop at players
    for (const p of this.others.values()) {
      if (p.dead) continue;
      const tp = WD.raySphere(o[0], o[1], o[2], d[0], d[1], d[2], p.x, p.y + WD.BODY_CY, p.z, WD.BODY_R);
      if (tp > 0 && tp < t) { t = tp; hitWall = false; }
    }
    if (!mine) {
      const me = this.me;
      const tp = WD.raySphere(o[0], o[1], o[2], d[0], d[1], d[2], me.x, me.y + WD.BODY_CY, me.z, WD.BODY_R);
      if (tp > 0 && tp < t) { t = tp; hitWall = false; }
    }
    for (let s = 1.2; s < t; s += 1.1 + Math.random()) {
      this.spawn(o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s, 0, 0, 0, 0.06 + s * 0.004, '·', [200, 180, 140]);
    }
    if (hitWall) {
      const x = o[0] + d[0] * (t - 0.02), y = o[1] + d[1] * (t - 0.02), z = o[2] + d[2] * (t - 0.02);
      for (let i = 0; i < 3; i++)
        this.spawn(x, y, z, rc.nx * 2 + (Math.random() - 0.5) * 3, rc.ny * 2 + Math.random() * 2, rc.nz * 2 + (Math.random() - 0.5) * 3, 0.25 + Math.random() * 0.2, '*\'.'[i], [255, 190, 110], 12);
      this.spawn(x, y, z, 0, 0.4, 0, 0.7, '░', [90, 90, 96], 0);
      // bullet hole
      const h = { x, y, z, vx: 0, vy: 0, vz: 0, life: 25, max: 25, ch: 'o', col: [20, 20, 22], grav: 0, size: 1, blood: false, hole: true };
      this.particles.push(h);
      if (mine) { const [pan, vol] = this.spatial(x, z); this.app.audio.impact(pan, vol); }
    }
  }

  // ───────────────────────── update ─────────────────────────
  update(dt) {
    const app = this.app, inp = app.input, A = app.audio, me = this.me, wp = this.wp;
    this.time += dt;
    if (!inp.locked) { this.paused = true; this.chatOpen = false; }

    // timers
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 2);
    this.flash = Math.max(0, this.flash - dt * 9);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 14);
    this.hitmarker = Math.max(0, this.hitmarker - dt);
    if (this.targetInfo && (this.targetInfo.t -= dt) <= 0) this.targetInfo = null;
    if (this.centerMsg && (this.centerMsg.t -= dt) <= 0) this.centerMsg = null;
    for (const k of this.killfeed) k.t -= dt;
    this.killfeed = this.killfeed.filter(k => k.t > 0);
    for (const d of this.dmgNums) d.t += dt;
    this.dmgNums = this.dmgNums.filter(d => d.t < 0.9);
    for (const c of this.chatLog) c.t += dt;

    // ── chat input ──
    const playing = !this.paused && inp.locked && !me.dead;
    if (this.chatOpen) {
      for (const ch of inp.typed) {
        if (ch === '\b') this.chatText = [...this.chatText].slice(0, -1).join('');
        else if (ch === '\n') {
          const t = this.chatText.trim();
          if (t) {
            app.net.send({ t: 'chat', text: t });
          }
          this.chatText = ''; this.chatOpen = false;
        } else if (ch !== '\t' && [...this.chatText].length < 120) this.chatText += ch;
      }
    } else if (playing && !app.devOpen && (inp.pressed.has('Enter') || inp.pressed.has('Slash') || inp.pressed.has('NumpadEnter'))) {
      this.chatOpen = true; this.chatText = '';
    }
    const ctrl = playing && !this.chatOpen && !app.devOpen;

    // ── look ──
    const sens = app.settings.sens * 0.0032 * (1 - wp.ads * 0.35);
    if (ctrl) {
      me.yaw -= inp.mdx * sens;
      me.pitch = clamp(me.pitch - inp.mdy * sens, -1.5, 1.5);
      wp.swayX = lerp(wp.swayX, inp.mdx, 0.3); wp.swayY = lerp(wp.swayY, inp.mdy, 0.3);
    } else { wp.swayX *= 0.8; wp.swayY *= 0.8; }
    me.punch *= Math.exp(-dt * 10);

    // ── move ──
    let mx = 0, mz = 0;
    if (ctrl) {
      if (inp.down.has('KeyW')) mz += 1; if (inp.down.has('KeyS')) mz -= 1;
      if (inp.down.has('KeyD')) mx += 1; if (inp.down.has('KeyA')) mx -= 1;
    }
    const sprint = ctrl && (inp.down.has('ShiftLeft') || inp.down.has('ShiftRight')) && mz > 0 && wp.ads < 0.2;
    let speed = sprint ? 7.6 : 5.0;
    speed *= 1 - wp.ads * 0.45;
    speed *= 0.5 + 0.5 * clamp(me.hp / 100, 0, 1);         // slower when hurt
    if (me.slowT > 0) { speed *= 0.55; me.slowT -= dt; }   // stagger right after a hit
    if (wp.drink >= 0 || wp.use >= 0) speed *= 0.6;
    if (me.burn) speed *= 1.08;                            // you run faster when on fire
    if (this.sigma && this.sigma.state === 'carried' && this.sigma.carrier === this.myId) speed *= 0.72;   // the Σ is heavy
    const dev = this.dev;
    if (dev && dev.speed) speed *= dev.speed;
    if (ctrl && inp.pressed.has('KeyF') && this.mode === 'dark') { this.flashlight = !this.flashlight; A.click(); }
    const fl = Math.hypot(mx, mz) || 1;
    const fwx = -Math.sin(me.yaw), fwz = -Math.cos(me.yaw), rgx = Math.cos(me.yaw), rgz = -Math.sin(me.yaw);
    const tvx = (fwx * mz + rgx * mx) / fl * speed, tvz = (fwz * mz + rgz * mx) / fl * speed;
    const accel = me.onGround ? 14 : 3;
    if (!me.dead) {
      me.vx = lerp(me.vx, tvx, Math.min(1, accel * dt));
      me.vz = lerp(me.vz, tvz, Math.min(1, accel * dt));
      if (dev && dev.fly) {
        // dev fly: no gravity, Space = up, Ctrl = down
        const up = ctrl && inp.down.has('Space') ? 1 : 0, dn = ctrl && (inp.down.has('ControlLeft') || inp.down.has('KeyC')) ? 1 : 0;
        me.vy = (up - dn) * 6 * Math.max(1, (dev.speed || 1) * 0.7);
      } else if (ctrl && inp.down.has('Space') && me.onGround) { me.vy = 6.6 * Math.sqrt((dev && dev.jump) || 1); me.onGround = false; }
    } else { me.vx *= 0.9; me.vz *= 0.9; }
    this.physics(dt, !!(dev && dev.fly && !me.dead));
    me.eyeOff = lerp(me.eyeOff, 0, Math.min(1, dt * 12));

    // head bob + footsteps
    const hs = Math.hypot(me.vx, me.vz);
    me.bobAmp = lerp(me.bobAmp, me.onGround ? clamp(hs / 5, 0, 1.5) : 0, Math.min(1, dt * 8));
    me.bob += hs * dt * 1.9;
    if (me.onGround && hs > 1) {
      me.stepAcc += hs * dt;
      if (me.stepAcc > (sprint ? 2.6 : 2.1)) { me.stepAcc = 0; A.step(); }
    }

    // ── weapons ──
    this.updateWeapons(dt, ctrl);

    // ── death camera ──
    if (me.dead) me.deadT += dt;

    // ── others ──
    for (const o of this.others.values()) {
      const k = Math.min(1, dt * 14);
      const px = o.x, pz = o.z;
      o.x = lerp(o.x, o.tx, k); o.y = lerp(o.y, o.ty, k); o.z = lerp(o.z, o.tz, k);
      o.yaw = angLerp(o.yaw, o.tyaw, k); o.pitch = lerp(o.pitch, o.tpitch, k);
      const moved = Math.hypot(o.x - px, o.z - pz);
      o.walk += moved * 2.2;
      o.stepAcc += moved;
      if (o.stepAcc > 2.2 && o.y < 0.05 + Math.floor(o.y + 0.5)) { o.stepAcc = 0; const [pan, vol] = this.spatial(o.x, o.z); if (vol > 0.25) A.step(pan, vol * 0.7); }
      o.shootT += dt; o.knifeT += dt; o.drinkT += dt; o.deadT += dt; o.throwT += dt; o.useT += dt;
      if (o.burn && !o.dead) this.burnParticles(o.x, o.y, o.z, dt, 1);
      for (const b of o.bubbles) b.t += dt;
      o.bubbles = o.bubbles.filter(b => b.t < 6);
    }

    // ── molotovs in flight, burning ground, me on fire ──
    this.updateFire(dt);

    // ── particles ──
    const P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { P.splice(i, 1); continue; }
      if (p.hole) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.blood && (p.y <= 0.02 || WD.solid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))) {
        if (p.y < 0.3 || WD.solid(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))) {
          if (Math.random() < 0.5) this.addDecal(p.x, p.z, 0.08 + Math.random() * 0.14);
        }
        P.splice(i, 1);
      }
    }

    // ── send state ──
    this.sendT -= dt;
    if (this.sendT <= 0 && !me.dead) {
      this.sendT = 1 / 30;
      app.net.send({ t: 'st', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), w: wp.w, fl: this.flashlight ? 1 : 0 });
    }
  }

  physics(dt, fly = false) {
    const me = this.me;
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      if (!fly) me.vy -= 20 * h;
      // horizontal X
      let nx = me.x + me.vx * h;
      if (WD.boxBlocked(nx, me.y, me.z)) {
        if (me.onGround && !WD.boxBlocked(nx, me.y + 1.01, me.z) && !WD.boxBlocked(me.x, me.y + 1.01, me.z)) { me.y = Math.floor(me.y + 1.01); me.eyeOff -= 1; me.x = nx; }
        else me.vx = 0;
      } else me.x = nx;
      // horizontal Z
      let nz = me.z + me.vz * h;
      if (WD.boxBlocked(me.x, me.y, nz)) {
        if (me.onGround && !WD.boxBlocked(me.x, me.y + 1.01, nz) && !WD.boxBlocked(me.x, me.y + 1.01, me.z)) { me.y = Math.floor(me.y + 1.01); me.eyeOff -= 1; me.z = nz; }
        else me.vz = 0;
      } else me.z = nz;
      // vertical
      const ny = me.y + me.vy * h;
      if (WD.boxBlocked(me.x, ny, me.z)) {
        if (me.vy < 0) {
          if (!me.onGround && me.vy < -7) this.app.audio.land();
          me.y = Math.floor(ny) + 1; if (me.y > ny + 1) me.y = Math.ceil(ny);
          me.onGround = true;
        }
        me.vy = 0;
      } else {
        me.y = ny;
        me.onGround = WD.boxBlocked(me.x, me.y - 0.03, me.z);
      }
      if (me.y < 0) { me.y = 0; me.vy = 0; me.onGround = true; }
    }
  }

  switchTo(w) {
    const wp = this.wp;
    if (w === wp.w || this.me.dead) return;
    wp.w = w; wp.equip = 1; wp.ads = 0;
    wp.reload = -1; wp.reloading = false; wp.slash = -1; wp.drink = -1; wp.pumpT = -1; wp.pump = 0;
    wp.throwT = -1; wp.use = -1; wp.reloadBlend = 0;
    this.app.audio.equip();
  }

  // one bullet from the AK-47 or the pistol
  fireGun(w, W) {
    const wp = this.wp, me = this.me, A = this.app.audio, ak = w === 3, kick = W.kick || 1;
    if (!(this.dev && this.dev.ammo)) wp.mags[w]--;
    wp.gunCD = W.cooldown; wp.recoil = 1;
    this.lights.push({ x: me.x, y: me.y + WD.EYE, z: me.z, t: 0.12, max: 0.12, k: 1 });
    this.muzzleFlash = ak ? 0.75 : 0.65; this.flash = ak ? 0.5 : 0.45; this.flashSeed = Math.random() * 6;
    me.punch -= (ak ? 0.012 : 0.03 * kick) * (1 - wp.ads * 0.4);
    me.yaw += (Math.random() - 0.5) * (ak ? 0.012 : 0.006 * kick);
    this.shake = Math.max(this.shake, ak ? 0.12 : 0.15 * kick);
    A.gun(w);
    const d = this.lookDir();
    const spread = W.spread * (wp.ads > 0.5 ? 0.35 : 1) * (Math.hypot(me.vx, me.vz) > 1 ? 1.8 : 1);
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    const ux = Math.sin(me.yaw) * Math.sin(me.pitch), uy = Math.cos(me.pitch), uz = Math.cos(me.yaw) * Math.sin(me.pitch);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    let px = d[0] + rx * ox + ux * oy, py = d[1] + uy * oy, pz = d[2] + rz * ox + uz * oy;
    const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
    const dir = [+px.toFixed(4), +py.toFixed(4), +pz.toFixed(4)];
    this.app.net.send({ t: 'fire', w, d: dir });
    this.tracer([me.x, me.y + WD.EYE, me.z], dir, true);
    // brass flying out to the right
    const c = Math.cos(me.yaw), sn = Math.sin(me.yaw);
    this.spawn(me.x + c * 0.25 - sn * 0.6, me.y + WD.EYE - 0.2, me.z - sn * 0.25 - c * 0.6, c * 2.5, 2.5, -sn * 2.5, 0.5, '-', [190, 150, 70], 12);
  }

  // ── fire: molotov flight, burning ground, flames on burning players ──
  burnParticles(x, y, z, dt, k) {
    const want = dt * 70 * k, n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.75;
      const hot = Math.random();
      this.spawn(x + Math.cos(a) * r, y + 0.3 + Math.random() * 1.2, z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 1.8, (Math.random() - 0.5) * 0.6,
        0.35 + Math.random() * 0.35, FIRE_CH[Math.floor(Math.random() * 4)], hot > 0.6 ? [255, 230, 120] : hot > 0.25 ? [255, 140, 40] : [210, 60, 30], -1.5).tall = true;
    }
  }
  // the Σ of CAPTURE mode: a golden spinning symbol built from boxes
  sigmaEntity() {
    const S = this.sigma;
    if (this.mode !== 'cap' || !S) return null;
    if (!this._sg) this._sg = { prims: Array.from({ length: 6 }, makePrim), m: new Float32Array(9) };
    const g = this._sg, t = this.time;
    const carried = S.state === 'carried';
    let x = S.x, y = S.y + 0.55 + Math.sin(t * 2.2) * 0.12, z = S.z;
    if (carried && S.carrier === this.myId) return null;              // you carry it: shown on the HUD
    if (carried) { const o = this.others.get(S.carrier); if (o) { x = o.x; y = o.y + 2.3; z = o.z; } }
    const yaw = t * 1.6, sc = carried ? 0.8 : 1;
    // segments in the symbol's plane: [x0, y0, x1, y1]
    const segs = [[-0.24, 0.32, 0.24, 0.32], [-0.24, -0.32, 0.24, -0.32], [-0.22, 0.3, 0.06, 0], [0.06, 0, -0.22, -0.3], [0.24, 0.32, 0.24, 0.22], [0.24, -0.32, 0.24, -0.22]];
    const out = [];
    segs.forEach(([x0, y0, x1, y1], i) => {
      const p = g.prims[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      p.type = BOX; p.mat = M.SIGMA; p.tag = 0;
      p.sx = len / 2 * sc + 0.035; p.sy = 0.045 * sc; p.sz = 0.05 * sc;
      setRotYXZ(p.m, yaw, 0, Math.atan2(y1 - y0, x1 - x0));
      const mx = (x0 + x1) / 2 * sc, my = (y0 + y1) / 2 * sc;
      p.px = x + Math.cos(yaw) * mx; p.py = y + my; p.pz = z - Math.sin(yaw) * mx;
      out.push(p);
    });
    return { id: -1, sigma: true, x, y: y - 1.2, z, yaw, prims: out, tint: [240, 200, 90], wounds: [], dead: false, bx: x, by: y, bz: z, br: 0.7, burn: false };
  }
  // BLACKOUT: every light in the dark — your flashlight, other flashlights, shots, fire
  darkLights(cam) {
    const L = [];
    const spot = (x, y, z, yaw, pitch, k) => {
      const cp = Math.cos(pitch);
      L.push([x, y, z, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, 0.9, 26, k]);
    };
    const me = this.me;
    if (this.flashlight && !me.dead) spot(cam.x, cam.y - 0.15, cam.z, me.yaw, me.pitch, 2.2);
    for (const o of this.others.values()) if (!o.dead && !o.zombie && o.fl) spot(o.x, o.y + WD.EYE, o.z, o.yaw, o.pitch, 1);
    for (const l of this.lights) L.push([l.x, l.y, l.z, 0, 0, 0, -2, 11, l.k * (l.t / l.max) * 2]);
    for (const f of this.fires) L.push([f.x, f.y + 0.6, f.z, 0, 0, 0, -2, 7, 1.3]);
    return L;
  }
  // a steady number of flame tongues (independent of the frame rate) for every fire and burning player
  flameSprites(players) {
    const out = this.particles.slice();
    const T = this.time;
    const hash = (a, b) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
    // tongue: root position, phase 0..1 (grows then fades), height in world units
    const flame = (x, y, z, ph, k, hot, h, w, seed) => {
      const a = Math.sin(Math.min(1, ph) * Math.PI) * k;
      if (a <= 0.04) return;
      out.push({ x, y, z, life: a, max: 1, flame: h * (0.4 + Math.sin(ph * Math.PI) * 0.6), fw: w, hot, seed, t: T, size: 1, hole: false });
    };
    this.fires.forEach((f, fi) => {
      const k = Math.min(1, f.life / 1.2) * Math.min(1, (f.max - f.life) / 0.25 + 0.3);
      for (let i = 0; i < 44; i++) {
        const h1 = hash(fi * 13.1 + f.x, i), h2 = hash(i, fi + f.z), h3 = hash(i * 1.7, 3.3);
        const r = Math.sqrt(h1) * f.r * 0.95, a = h2 * Math.PI * 2;
        const ph = (T * (0.8 + h3 * 0.7) + h3) % 1;
        const tall = (1 - r / f.r * 0.6) * (1.0 + h3 * 1.1);
        flame(f.x + Math.cos(a) * r, f.y + 0.02, f.z + Math.sin(a) * r, ph, k, hash(i, Math.floor(T * 5)), tall, 0.2 + h1 * 0.1, i * 1.3);
      }
    });
    if (this.mode === 'dark') for (const o of players) {
      // BLACKOUT: a lit flashlight is a bright dot everybody can see
      if (o.dead || o.zombie || o.sigma || !o.fl) continue;
      const cp = Math.cos(o.pitch || 0);
      out.push({ x: o.x - Math.sin(o.yaw) * cp * 0.8, y: o.y + WD.EYE - 0.1, z: o.z - Math.cos(o.yaw) * cp * 0.8, life: 1, max: 1, ch: '@', col: [255, 248, 210], size: 2, hole: false });
    }
    for (const o of players) {
      if (!o.burn || o.dead) continue;   // your own flames are drawn on the screen instead
      for (let i = 0; i < 16; i++) {
        const h1 = hash(o.id * 7.7, i), h2 = hash(i, o.id), h3 = hash(i * 2.3, 9.1);
        const a = h2 * Math.PI * 2 + T * 0.5, r = 0.35 + h1 * 0.35;
        const ph = (T * (1.1 + h3) + h3) % 1;
        flame(o.x + Math.cos(a) * r, o.y + 0.3 + h1 * 0.9, o.z + Math.sin(a) * r, ph, 1, h3, 0.8 + h3 * 0.6, 0.2, i * 2.1);
      }
    }
    return out;
  }
  updateFire(dt) {
    for (const l of this.lights) l.t -= dt;
    this.lights = this.lights.filter(l => l.t > 0);
    if (this.waveMsg && (this.waveMsg.t -= dt) <= 0) this.waveMsg = null;
    const me = this.me, A = this.app.audio;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.t > p.end) { this.projectiles.splice(i, 1); continue; }
      const t = p.t, x = p.o[0] + p.v[0] * t, y = p.o[1] + p.v[1] * t - WD.THROW_G / 2 * t * t, z = p.o[2] + p.v[2] * t;
      this.spawn(x, y, z, 0, 0, 0, 0.03, 'o', [110, 170, 100]);
      if (Math.random() < 0.8) this.spawn(x, y + 0.1, z, (Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5, 0.25, FIRE_CH[Math.floor(Math.random() * 3)], [255, 170, 60], -1);
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      const k = Math.min(1, f.life / 1.2) * Math.min(1, (f.max - f.life) / 0.25 + 0.3);
      const want = dt * 150 * k, n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * f.r;
        const hot = Math.random(), edge = r / f.r;
        this.spawn(f.x + Math.cos(a) * r, f.y + 0.05 + Math.random() * 0.25, f.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 2.4 * (1 - edge * 0.6), (Math.random() - 0.5) * 0.4,
          0.3 + Math.random() * 0.5, FIRE_CH[Math.floor(Math.random() * FIRE_CH.length)], hot > 0.55 ? [255, 220, 110] : hot > 0.2 ? [255, 130, 36] : [190, 50, 26], -1.2).tall = edge < 0.8;
      }
      if (Math.random() < dt * 3) this.spawn(f.x + (Math.random() - 0.5) * f.r, f.y + 1.2, f.z + (Math.random() - 0.5) * f.r, 0, 1, 0, 1.4, '░', [60, 56, 54]);
      const [pan, vol] = this.spatial(f.x, f.z);
      if (Math.random() < dt * 6 && vol > 0.3) A.crackle(pan, vol * 0.6 * k);
    }
    // me on fire: flames, crackling, the screen burns from below
    this.burnFx = clamp(this.burnFx + (me.burn && !me.dead ? dt * 3 : -dt * 1.5), 0, 1);
    if (me.burn && !me.dead) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) { this.crackleT = 0.08 + Math.random() * 0.12; A.crackle(0, 0.8); }
    }
    this.healFx = Math.max(0, this.healFx - dt);
  }

  updateWeapons(dt, ctrl) {
    const wp = this.wp, me = this.me, inp = this.app.input, A = this.app.audio, net = this.app.net;
    wp.equip = Math.max(0, wp.equip - dt * 3.2);
    wp.shotCD -= dt; wp.knifeCD -= dt; wp.drinkCD -= dt;
    wp.recoil = Math.max(0, wp.recoil - dt * 5);

    wp.gunCD -= dt; wp.meleeCD -= dt; wp.throwCD -= dt; wp.medCD -= dt;
    const L = this.loadout;
    if (ctrl) {
      for (let k = 0; k < 4; k++) if (inp.pressed.has('Digit' + (k + 1)) && L[k] >= 0) this.switchTo(L[k]);
      if (inp.wheel) {
        const own = L.filter(i => i >= 0);
        if (own.length) { const i = Math.max(0, own.indexOf(wp.w)); this.switchTo(own[(i + (inp.wheel > 0 ? 1 : own.length - 1)) % own.length]); }
      }
    }
    const ready = wp.equip < 0.25 && !me.dead;
    const fire = ctrl && inp.mouseDown[0];

    // ─── shotgun ───
    if (wp.w === 0) {
      const aim = ctrl && inp.mouseDown[2] && !wp.reloading;
      wp.ads = clamp(wp.ads + (aim ? dt * 7 : -dt * 7), 0, 1);
      // pump action after each shot
      if (wp.pumpT >= 0) {
        wp.pumpT += dt;
        const p = (wp.pumpT - 0.18) / 0.42;
        if (p >= 0 && !wp.pumpSnd) { wp.pumpSnd = true; A.pump(); }
        wp.pump = p < 0 ? 0 : p > 1 ? 0 : Math.sin(p * Math.PI);
        if (p > 1) { wp.pumpT = -1; wp.pump = 0; }
      }
      if (ctrl && inp.pressed.has('KeyR') && wp.ammo < 6 && !wp.reloading) { wp.reloading = true; wp.reload = 0; }
      if (wp.ammo === 0 && !wp.reloading && wp.shotCD <= 0 && ready) { wp.reloading = true; wp.reload = 0; }
      if (wp.reloading) {
        wp.reloadBlend = Math.min(1, wp.reloadBlend + dt * 5);
        if (wp.pumpT < 0) {
          const before = wp.reload;
          wp.reload += dt / 0.5;
          if (before < 0.45 && wp.reload >= 0.45) { wp.ammo = Math.min(6, wp.ammo + 1); A.shell(); }
          if (wp.reload >= 1) {
            if (wp.ammo >= 6) { wp.reloading = false; wp.reload = -1; A.pump(); wp.pumpT = 0.14; wp.pumpSnd = true; }
            else wp.reload = 0;
          }
        }
        if (fire && wp.ammo > 0 && wp.reload < 0.3 && inp.mouseClicked[0]) { wp.reloading = false; wp.reload = -1; }
      } else wp.reloadBlend = Math.max(0, wp.reloadBlend - dt * 5);

      if (fire && ready && !wp.reloading && wp.shotCD <= 0 && wp.pumpT < 0) {
        if (wp.ammo > 0) this.fireShotgun();
        else if (inp.mouseClicked[0]) A.click();
      }
    } else if (!WD.isGun(wp.w)) { wp.ads = Math.max(0, wp.ads - dt * 7); wp.reloadBlend = 0; }

    // ─── AK-47 / pistol ───
    if (WD.isGun(wp.w)) {
      const W = WD.WEAPONS[WD.ITEMS[wp.w].id];
      const aim = ctrl && inp.mouseDown[2] && !wp.reloading;
      wp.ads = clamp(wp.ads + (aim ? dt * 8 : -dt * 8), 0, 1);
      const mag = wp.mags[wp.w];
      if (ctrl && inp.pressed.has('KeyR') && mag < W.mag && !wp.reloading) { wp.reloading = true; wp.reload = 0; A.magOut(); }
      if (mag === 0 && !wp.reloading && wp.gunCD <= 0 && ready) { wp.reloading = true; wp.reload = 0; A.magOut(); }
      if (wp.reloading) {
        wp.reloadBlend = Math.min(1, wp.reloadBlend + dt * 6);
        const before = wp.reload;
        wp.reload += dt / W.reload;
        if (before < 0.7 && wp.reload >= 0.7) A.magIn();
        if (wp.w === 3 && before < 0.86 && wp.reload >= 0.86) A.pump();
        if (wp.reload >= 1) { wp.reloading = false; wp.reload = -1; wp.mags[wp.w] = W.mag; }
      } else wp.reloadBlend = Math.max(0, wp.reloadBlend - dt * 6);
      const trig = W.auto ? fire : fire && inp.mouseClicked[0];
      if (trig && ready && !wp.reloading && wp.gunCD <= 0) {
        if (wp.mags[wp.w] > 0) this.fireGun(wp.w, W);
        else if (inp.mouseClicked[0]) A.click();
      }
    }

    // ─── hunting knife / bat ───
    if (wp.w === 5 || wp.w === 6) {
      const W = WD.WEAPONS[wp.w === 5 ? 'hknife' : 'bat'], T = MELEE_T[wp.w], hitAt = wp.w === 6 ? 0.46 : 0.42;
      if (wp.slash >= 0) {
        wp.slash += dt / T;
        if (wp.slash >= hitAt && !wp.knifeHitDone) {
          wp.knifeHitDone = true;
          const d = this.lookDir();
          net.send({ t: 'melee', w: wp.w, d, side: wp.slashSide });
          const t = WD.raycast(me.x, me.y + WD.EYE, me.z, d[0], d[1], d[2], W.range - 0.3, rc);
          if (t > 0) { const x = me.x + d[0] * t, y = me.y + WD.EYE + d[1] * t, z = me.z + d[2] * t; for (let i = 0; i < 5; i++) this.spawn(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.25, wp.w === 6 ? '.' : '\'', [255, 210, 150], 10); A.impact(); if (wp.w === 6) this.shake = Math.max(this.shake, 0.3); }
        }
        if (wp.slash >= 1) wp.slash = -1;
      }
      if (fire && ready && wp.meleeCD <= 0 && wp.slash < 0) {
        wp.slash = 0; wp.meleeCD = W.cooldown; wp.slashSide = -wp.slashSide; wp.knifeHitDone = false;
        if (wp.w === 6) A.batSwing(); else A.knife();
      }
    }

    // ─── molotov ───
    if (wp.w === 7) {
      if (wp.throwT >= 0) {
        const before = wp.throwT;
        wp.throwT += dt / 0.75;
        if (before < 0.08 && wp.throwT >= 0.08) A.lighter();
        if (before < 0.45 && wp.throwT >= 0.45) { net.send({ t: 'throw', d: this.lookDir() }); A.knife(0, 0.5); }
        if (wp.throwT >= 1) wp.throwT = -1;
      }
      if (fire && ready && wp.throwT < 0 && wp.throwCD <= 0 && inp.mouseClicked[0]) {
        if (wp.molotovs > 0) { wp.throwT = 0; wp.throwCD = WD.WEAPONS.molotov.cooldown; }
        else A.click();
      }
    }

    // ─── medkit ───
    if (wp.w === 8) {
      if (wp.use >= 0) {
        const before = wp.use;
        wp.use += dt / WD.WEAPONS.medkit.use;
        if (before < 0.12 && wp.use >= 0.12) A.zip();
        if (before < 0.55 && wp.use >= 0.55) net.send({ t: 'medkit' });
        if (wp.use >= 1) wp.use = -1;
      }
      if (fire && ready && wp.use < 0 && wp.medCD <= 0 && inp.mouseClicked[0]) { wp.use = 0; wp.medCD = this.dev && this.dev.ammo ? 1.5 : WD.WEAPONS.medkit.cooldown; }
    }

    // ─── knife ───
    if (wp.w === 1) {
      if (wp.slash >= 0) {
        wp.slash += dt / 0.34;
        if (wp.slash >= 0.4 && !wp.knifeHitDone) {
          wp.knifeHitDone = true;
          const d = this.lookDir();
          net.send({ t: 'knife', d, side: wp.slashSide });
          // local: sparks if a wall is right there
          const t = WD.raycast(me.x, me.y + WD.EYE, me.z, d[0], d[1], d[2], 2.2, rc);
          if (t > 0) { const x = me.x + d[0] * t, y = me.y + WD.EYE + d[1] * t, z = me.z + d[2] * t; for (let i = 0; i < 4; i++) this.spawn(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.25, '\'', [255, 210, 150], 10); A.impact(); }
        }
        if (wp.slash >= 1) wp.slash = -1;
      }
      if (fire && ready && wp.knifeCD <= 0 && wp.slash < 0) {
        wp.slash = 0; wp.knifeCD = 0.36; wp.slashSide = -wp.slashSide; wp.knifeHitDone = false;
        A.knife();
      }
    }

    // ─── soda ───
    if (wp.w === 2) {
      if (wp.drink >= 0) {
        const before = wp.drink;
        wp.drink += dt / 1.6;
        const at = v => before < v && wp.drink >= v;
        if (at(0.04)) A.canOpen();
        if (at(0.3) || at(0.45) || at(0.6)) A.gulp();
        if (at(0.62)) net.send({ t: 'drink' });
        if (wp.drink >= 1) wp.drink = -1;
      }
      if (fire && ready && wp.drinkCD <= 0 && wp.drink < 0 && inp.mouseClicked[0]) { wp.drink = 0; wp.drinkCD = 7; }
    }
  }

  lookDir() {
    const me = this.me;
    const cp = Math.cos(me.pitch);
    return [-Math.sin(me.yaw) * cp, Math.sin(me.pitch), -Math.cos(me.yaw) * cp];
  }

  fireShotgun() {
    const wp = this.wp, me = this.me, A = this.app.audio;
    if (!(this.dev && this.dev.ammo)) wp.ammo--;
    this.lights.push({ x: me.x, y: me.y + WD.EYE, z: me.z, t: 0.15, max: 0.15, k: 1.4 });
    wp.shotCD = WD.WEAPONS.shotgun.cooldown; wp.recoil = 1; wp.pumpT = 0; wp.pumpSnd = false;
    this.muzzleFlash = 1; this.flash = 1; this.flashSeed = Math.random() * 6;
    me.punch -= 0.05 + wp.ads * -0.02;
    this.shake = Math.max(this.shake, 0.25);
    A.shotgun();
    const d = this.lookDir();
    const spread = wp.ads > 0.5 ? 0.035 : 0.065;
    // basis around d
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    const ux = Math.sin(me.yaw) * Math.sin(me.pitch), uy = Math.cos(me.pitch), uz = Math.cos(me.yaw) * Math.sin(me.pitch);
    const pel = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      let px = d[0] + rx * ox + ux * oy, py = d[1] + uy * oy, pz = d[2] + rz * ox + uz * oy;
      const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
      pel.push([+px.toFixed(4), +py.toFixed(4), +pz.toFixed(4)]);
    }
    this.app.net.send({ t: 'shoot', d, pel });
    const o = [me.x, me.y + WD.EYE, me.z];
    for (const p of pel) this.tracer(o, p, true);
  }

  // ───────────────────────── player models ─────────────────────────
  buildOther(o) {
    const pr = o.prims; const out = o.activePrims; out.length = 0;
    const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw);
    const cx = o.x, cy = o.y + WD.BODY_CY, cz = o.z;
    let n = 0;
    const sph = (x, y, z, r, mat) => { const p = pr[n++]; p.type = SPHERE; p.px = x; p.py = y; p.pz = z; p.sx = r; p.mat = mat; p.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); out.push(p); return p; };
    sph(cx, cy, cz, WD.BODY_R, M.BODY);
    const dead = o.dead;
    // eyes
    const ey = cy + 0.2 + o.pitch * 0.12;
    for (const s of [-1, 1]) sph(cx + fx * 0.69 + rx * 0.24 * s, ey, cz + fz * 0.69 + rz * 0.24 * s, 0.09, M.EYE);
    if (dead) {
      for (const s of [-1, 1]) sph(cx + rx * 1.0 * s + fx * 0.3, o.y + 0.22, cz + rz * 1.0 * s + fz * 0.3, 0.24, M.ARM);
      o.bx = cx; o.by = cy; o.bz = cz; o.br = 1.5;
      return out;
    }
    const swing = Math.sin(o.walk) * 0.14;
    const rec = Math.max(0, 1 - o.shootT * 5) * 0.25;
    const W = (l) => [cx + rx * l[0] + fx * l[2], cy + l[1], cz + rz * l[0] + fz * l[2]];
    const IR = this._itemR || (this._itemR = new Float32Array(9));
    const toW = (pos, lx, ly, lz) => [pos[0] + IR[0] * lx + IR[3] * ly + IR[6] * lz, pos[1] + IR[1] * lx + IR[4] * ly + IR[7] * lz, pos[2] + IR[2] * lx + IR[5] * ly + IR[8] * lz];
    let R, L;
    if (o.zombie) {
      // zombie: both arms stretched forward, swaying while it shambles
      const sw2 = Math.sin(o.walk * 0.8) * 0.12;
      R = W([0.5, 0.05 + sw2, 0.95]); L = W([-0.5, 0.05 - sw2, 0.95]);
      sph(R[0], R[1], R[2], 0.22, M.ARM); sph(L[0], L[1], L[2], 0.22, M.ARM);
      o.bx = cx; o.by = cy; o.bz = cz; o.br = 2.0;
      return out;
    }
    if (o.w < 0) {
      R = W([0.8, -0.12, 0.3 + swing]); L = W([-0.8, -0.12, 0.2 - swing]);
    } else if (o.w === 0) {
      // real shotgun held in both hands, pointing where the player looks
      const s = 1.7;
      setRotYXZ(IR, o.yaw + Math.PI, -o.pitch * 0.8 - rec * 1.2, 0);
      const G = W([0.42, -0.12 + rec * 0.1, 0.55 - rec * 0.5]);
      n = placeItem(pr, n, out, 0, G, IR, s);
      R = toW(G, 0, -0.1 * s, -0.1 * s);          // right hand on the grip
      L = toW(G, 0, -0.07 * s, 0.36 * s);          // left hand on the pump
    } else if (o.w === 1) {
      const k = o.knifeT < 0.34 ? Math.sin(o.knifeT / 0.34 * Math.PI) : 0;
      R = W([0.82 - k * 0.7, -0.12 + k * 0.2, 0.25 + k * 0.7 + swing]);
      L = W([-0.8, -0.12, 0.2 - swing]);
      const s = 2.4;
      setRotYXZ(IR, o.yaw + Math.PI + k * 0.9, -0.5 + k * 0.9, 0);
      n = placeItem(pr, n, out, 1, toW(R, 0, 0, 0.05 * s), IR, s);
    } else if (o.w === 3 || PISTOLS[o.w]) {
      // AK-47 in both hands / pistols held out in front with both hands (isosceles stance)
      const ak = o.w === 3, P = PISTOLS[o.w], s = ak ? 1.7 : P.tp;
      setRotYXZ(IR, o.yaw + Math.PI, -o.pitch * 0.8 - rec * (ak ? 0.5 : o.w === 10 ? 2 : 1.4), 0);
      const G = W(ak ? [0.4, -0.1 + rec * 0.05, 0.55 - rec * 0.2] : [0.12, 0.06, 0.88 - rec * 0.2]);
      n = placeItem(pr, n, out, o.w, G, IR, s);
      if (ak) { R = toW(G, 0, -0.095 * s, -0.1 * s); L = toW(G, 0, -0.035 * s, 0.29 * s); }
      else {
        const g = P.grip;
        R = toW(G, (g[0] + P.gw + 0.03) * s, g[1] * s, (g[2] - 0.01) * s);   // right hand wraps the grip
        L = toW(G, (g[0] - P.gw - 0.03) * s, (g[1] - 0.01) * s, g[2] * s);   // support hand on the other side
      }
    } else if (o.w === 5 || o.w === 6) {
      const bat = o.w === 6, T = MELEE_T[o.w];
      const k = o.knifeT < T ? Math.sin(o.knifeT / T * Math.PI) : 0;
      if (bat) {
        // bat on the shoulder → big horizontal swing
        const sw = o.knifeT < T ? o.knifeT / T : 1;
        const ang = o.knifeT < T ? (sw < 0.3 ? 0.9 * o.side : (0.9 - (sw - 0.3) / 0.7 * 2.4) * o.side) : 0;
        // both hands on the handle: left hand at the knob, right hand stacked right above it
        const s = 2.0;
        const A = W([0.72 - k * 0.45, -0.05 - k * 0.1, 0.55 + k * 0.35]);
        setRotYXZ(IR, o.yaw + Math.PI + ang, -1.25 + k * 1.15, 0);
        const pos = toW(A, 0, 0, 0.2 * s);
        n = placeItem(pr, n, out, 6, pos, IR, s);
        R = toW(pos, 0, 0, -0.13 * s);
        L = toW(pos, 0, 0, -0.25 * s);
      } else {
        R = W([0.82 - k * 0.7, -0.12 + k * 0.2, 0.25 + k * 0.7 + swing]);
        L = W([-0.8, -0.12, 0.2 - swing]);
        const s = 2.2;
        setRotYXZ(IR, o.yaw + Math.PI + k * 0.9 * o.side, -0.5 + k * 0.9, 0);
        n = placeItem(pr, n, out, 5, toW(R, 0, 0, 0.08 * s), IR, s);
      }
    } else if (o.w === 7) {
      // molotov: raised, flung forward when thrown
      const k = o.throwT < 0.75 ? Math.sin(Math.min(1, o.throwT / 0.75) * Math.PI) : 0;
      const back = o.throwT < 0.3 ? o.throwT / 0.3 : o.throwT < 0.45 ? 1 - (o.throwT - 0.3) / 0.15 * 2 : 0;
      R = W([0.85, 0.05 + k * 0.5, 0.25 - back * 0.6 + (o.throwT < 0.75 && o.throwT > 0.35 ? 0.6 : 0)]);
      L = W([-0.8, -0.12, 0.2 - swing]);
      if (!(o.throwT > 0.4 && o.throwT < 1.0)) {
        setRotYXZ(IR, o.yaw, -Math.PI / 2 + 0.2, 0);
        n = placeItem(pr, n, out, 7, [R[0], R[1] + 0.2, R[2]], IR, 2.6);
      }
    } else if (o.w === 8) {
      const k = o.useT < 1.4 ? Math.sin(Math.min(1, o.useT / 1.4) * Math.PI) : 0;
      R = W([0.7 - k * 0.5, -0.15 + k * 0.4, 0.45 + k * 0.2]);
      L = W([-0.8, -0.12, 0.2 - swing]);
      setRotYXZ(IR, o.yaw + Math.PI + 0.3, 0.1, 0);
      n = placeItem(pr, n, out, 8, [R[0], R[1] - 0.2, R[2]], IR, 2.2);
    } else {
      const k = o.drinkT < 1.6 ? Math.sin(Math.min(1, o.drinkT / 1.6) * Math.PI) : 0;
      R = W([0.8 - k * 0.45, -0.08 + k * 0.55, 0.3 + k * 0.35 + swing]);
      L = W([-0.8, -0.12, 0.2 - swing]);
      const s = 3.2;
      setRotYXZ(IR, o.yaw, -Math.PI / 2 + k * 1.6, 0);   // upright, tilts to the mouth when drinking
      n = placeItem(pr, n, out, 2, [R[0], R[1] + 0.12, R[2]], IR, s);
    }
    sph(R[0], R[1], R[2], 0.22, M.ARM);
    sph(L[0], L[1], L[2], 0.22, M.ARM);
    o.bx = cx; o.by = cy; o.bz = cz; o.br = 2.3;
    return out;
  }

  // ───────────────────────── draw ─────────────────────────
  draw(dt) {
    const app = this.app, scr = app.scr, me = this.me, wp = this.wp;
    // camera
    let eyeH = WD.EYE + me.eyeOff, roll = 0, pitch = me.pitch + me.punch;
    if (me.dead) {
      const k = Math.min(1, me.deadT / 0.75);
      const e = 1 - Math.pow(1 - k, 3);
      const bounce = k >= 1 ? Math.sin(Math.min(1, (me.deadT - 0.75) / 0.25) * Math.PI) * 0.05 : 0;
      eyeH = lerp(eyeH, 0.28, e) + bounce;
      roll = 1.3 * e;
      pitch = lerp(pitch, 0.25, e);
    }
    const sh = this.shake;
    const cam = {
      x: me.x + (Math.random() - 0.5) * sh * 0.05, y: me.y + eyeH + Math.sin(me.bob * 2) * 0.03 * me.bobAmp * (1 - wp.ads), z: me.z,
      yaw: me.yaw + (Math.random() - 0.5) * sh * 0.02, pitch: clamp(pitch + (Math.random() - 0.5) * sh * 0.02, -1.55, 1.55), roll,
      fov: (app.settings.fov * Math.PI / 180) * (1 - wp.ads * 0.2),
    };
    const players = [];
    for (const o of this.others.values()) { o.prims && this.buildOther(o); players.push({ ...o, prims: o.activePrims }); }
    const sg = this.sigmaEntity();
    if (sg) players.push(sg);

    let vm = [];
    if (wp.w >= 0 && (!me.dead || me.deadT < 0.4)) {
      vm = app.vm.build({
        w: wp.w, time: this.time, bob: me.bob, bobAmp: me.bobAmp, swayX: wp.swayX, swayY: wp.swayY,
        ads: wp.ads, recoil: wp.recoil, pump: wp.pump, equip: wp.equip,
        slash: wp.slash, slashSide: wp.slashSide, drink: wp.drink, reload: wp.reloading ? wp.reload : -1,
        reloadBlend: wp.reloadBlend, dead: me.dead ? me.deadT / 0.4 : 0,
        throwT: wp.throwT, has: wp.molotovs > 0, use: wp.use,
      });
    }
    app.renderer.render(scr.fine, cam, {
      players, vm, particles: this.flameSprites(players), floorDecals: this.floorDecals,
      flash: this.flash * 0.5, muzzleFlash: wp.w === 0 || WD.isGun(wp.w) ? this.muzzleFlash : 0, vmMuzzle: app.vm.muzzle, flashSeed: this.flashSeed,
      fires: this.fires, time: this.time,
      zones: this.mode === 'cap' ? WD.CAP_BASES.map((b, i) => [b[0], b[2], WD.CAP_BASE_R, ...WD.TEAM_COL[i]]) : null,
      dark: this.mode === 'dark' ? this.darkLights(cam) : null,
    });
    this.drawHUD(dt, players.filter(p => !p.sigma));
  }

  drawHUD(dt, players) {
    const app = this.app, scr = app.scr, me = this.me, wp = this.wp;
    const cols = scr.cols, rows = scr.rows;
    const R = app.renderer;

    // ── hurt vignette / low hp ──
    const low = me.dead ? 0 : clamp((45 - me.hp) / 45, 0, 1) * (0.6 + 0.4 * Math.sin(this.time * 4));
    const vig = me.dead ? 0 : Math.max(this.hurtFlash * 0.8, low * 0.6);
    if (vig > 0.02) {
      const chars = '.,:;%#@';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const nx = (x / cols) * 2 - 1, ny = (y / rows) * 2 - 1;
        const e = Math.max(Math.abs(nx), Math.abs(ny));
        const v = (e - (1 - vig * 0.18)) / (vig * 0.18 + 0.001);
        if (v <= 0) continue;
        const h = ((x * 73856093) ^ (y * 19349663) ^ Math.floor(this.time * 3)) & 7;
        if (h > v * 6) continue;
        scr.put(x, y, chars[Math.min(chars.length - 1, Math.floor(v * chars.length))], [120 + v * 60, 8, 14]);
      }
    }

    // ── on fire: the bottom of the screen burns (classic "doom fire", made of symbols) ──
    if (this.burnFx > 0.01) this.drawScreenFire(dt);
    if (this.healFx > 0) {
      const a = Math.min(1, this.healFx);
      for (let i = 0; i < 26; i++) {
        const h = Math.sin(i * 91.7) * 43758.5; const f = h - Math.floor(h);
        const x = Math.floor(cols * (0.2 + f * 0.6)), y = Math.floor(rows * (0.85 - ((1.2 - this.healFx) * (0.4 + f * 0.5) + f * 0.3) * 0.6));
        if (y > 2 && y < rows - 4) scr.put(x, y, '+', [90 * a, 230 * a, 120 * a]);
      }
    }

    // ── name tags + chat bubbles over players ──
    for (const o of players) {
      const head = R.project(scr, o.x, o.y + 1.75, o.z);
      if (!head) continue;
      const [hx, hy, dist] = head;
      if (dist > 45 || hx < -20 || hx > cols + 20) continue;
      // occluded by walls?
      const ci = Math.max(0, Math.min(rows - 1, hy + 1)) * cols + Math.max(0, Math.min(cols - 1, hx));
      const t = WD.raycast(R.cam.pos[0], R.cam.pos[1], R.cam.pos[2], (o.x - R.cam.pos[0]) / dist, (o.y + 1.75 - R.cam.pos[1]) / dist, (o.z - R.cam.pos[2]) / dist, dist, rc);
      if (t > 0 && t < dist - 0.5) continue;
      if (this.mode === 'dark' && dist > 6 && !o.fl) continue;          // BLACKOUT: names only up close (or a lit flashlight)
      const fade = clamp(1.4 - dist / 35, 0.35, 1);
      const tc = o.team >= 0 ? WD.TEAM_COL[o.team] : [180, 184, 190];
      const nameCol = [tc[0] * fade, tc[1] * fade, tc[2] * fade];
      let y = hy;
      if (!o.dead) {
        // tiny hp bar
        const bw = 8, f = Math.round(clamp(o.hp / (o.maxHp || 100), 0, 1) * bw);
        if (o.hp < (o.maxHp || 100)) for (let i = 0; i < bw; i++) scr.put(hx - 4 + i, y, i < f ? '=' : '-', i < f ? (o.zombie ? [110, 200, 90] : o.hp < 35 ? [170, 30, 36] : [170, 174, 180]) : [45, 47, 52]);
        y--;
      }
      if (o.zombie) continue;
      const tag = (o.dead ? '× ' : '') + (this.sigma && this.sigma.carrier === o.id && this.sigma.state === 'carried' ? 'Σ ' : '') + o.name;
      scr.textC(y, tag, nameCol, null, hx + 0.5);
      y--;
      // bubbles: drawn as classic ASCII speech bubbles, newest closest to the head,
      // max 3, each vanishes 6s after it appeared
      //   .--------------.
      //   | hello there! |
      //   '------v-------'
      for (let bi = o.bubbles.length - 1; bi >= 0; bi--) {
        const b = o.bubbles[bi];
        const newest = bi === o.bubbles.length - 1;
        const lines = wrapText(b.text, 26);
        const inner = Math.max(...lines.map(l => [...l].length));
        const w = inner + 4, h = lines.length + 2;
        const a = clamp((6 - b.t) / 0.5, 0, 1) * clamp(b.t / 0.12, 0, 1) * (newest ? 1 : 0.7) * fade;
        if (a <= 0.02) continue;
        const bg = [10 * a, 11 * a, 14 * a];
        const br = [150 * a, 154 * a, 162 * a];
        const fg = [228 * a, 230 * a, 236 * a];
        const bx = hx - Math.floor(w / 2);
        const top = y - h - (newest ? 0 : 0);
        // body
        scr.fill(bx, top, w, h, ' ', fg, bg);
        for (let i = 1; i < w - 1; i++) { scr.put(bx + i, top, '-', br, bg); scr.put(bx + i, top + h - 1, '-', br, bg); }
        for (let i = 1; i < h - 1; i++) { scr.put(bx, top + i, '|', br, bg); scr.put(bx + w - 1, top + i, '|', br, bg); }
        scr.put(bx, top, '.', br, bg); scr.put(bx + w - 1, top, '.', br, bg);
        scr.put(bx, top + h - 1, "'", br, bg); scr.put(bx + w - 1, top + h - 1, "'", br, bg);
        lines.forEach((l, li) => scr.text(bx + 2, top + 1 + li, l, fg, bg));
        // tail pointing down to the name
        if (newest) { scr.put(hx, top + h - 1, 'v', br, bg); scr.put(hx, top + h, '|', br); }
        y = top - 1;
      }
    }

    // ── center: circle cursor, hitmarker, damage numbers ──
    const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    if (!me.dead) {
      scr.put(cx, cy, '◦', [235, 238, 242]);
      if (this.hitmarker > 0) {
        const c = [235, 60, 60];
        scr.put(cx - 2, cy - 1, '\\', c); scr.put(cx + 2, cy - 1, '/', c);
        scr.put(cx - 2, cy + 1, '/', c); scr.put(cx + 2, cy + 1, '\\', c);
      }
      for (const d of this.dmgNums) {
        const a = 1 - d.t / 0.9;
        scr.text(cx + 4 + Math.round(d.x), cy - 1 - Math.floor(d.t * 6), d.text, d.fire ? [255 * a, 150 * a, 40 * a] : [230 * a + 20, 70 * a, 70 * a]);
      }
    }

    // ── top: HP + target info ──
    {
      const bw = Math.min(40, Math.floor(cols * 0.22));
      const x0 = Math.floor(cols / 2 - (bw + 10) / 2);
      const hp = clamp(me.hp, 0, 100);
      const f = Math.round(hp / 100 * bw);
      const col = hp < 35 ? C.red : C.hp;
      scr.text(x0, 1, 'HP', C.dim);
      scr.put(x0 + 3, 1, '[', C.line);
      for (let i = 0; i < bw; i++) scr.put(x0 + 4 + i, 1, i < f ? '#' : '.', i < f ? col : [50, 52, 58]);
      scr.put(x0 + 4 + bw, 1, ']', C.line);
      scr.text(x0 + 6 + bw, 1, String(Math.ceil(hp)).padStart(3), hp < 35 ? C.red : C.bright);
      if (this.targetInfo) {
        const ti = this.targetInfo, a = clamp(ti.t / 0.5, 0, 1);
        const tw = Math.max(4, bw + 4 - [...`◦ ${ti.name} `].length), tf = Math.round(clamp(ti.hp, 0, 100) / 100 * tw);
        const str = `◦ ${ti.name} `;
        const tx = x0;
        scr.text(tx, 3, str, [200 * a, 200 * a, 205 * a]);
        const bx = tx + [...str].length;
        for (let i = 0; i < tw; i++) scr.put(bx + i, 3, i < tf ? '#' : '.', i < tf ? [170 * a, 30 * a, 36 * a] : [40 * a, 42 * a, 47 * a]);
        scr.text(x0 + 6 + bw, 3, String(Math.max(0, ti.hp)).padStart(3), [220 * a, 80 * a, 80 * a]);
      }
    }

    // ── match timer (top left) ──
    if (this.match) {
      const left = Math.max(0, this.match.ends - this.time);
      const mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
      if (this.match.phase === 'play') {
        const title = MODE_TITLE[this.mode] || 'DEATHMATCH';
        scr.text(2, 1, title, C.dim);
        if (this.mode === 'zombie') {
          const alive = [...this.others.values()].filter(o => o.zombie && !o.dead).length;
          scr.text(3 + title.length, 1, `wave ${this.wave}`, C.bright);
          scr.text(2, 2, `zombies ${alive} · kills ${me.kills}`, C.dim);
        } else {
          scr.text(3 + [...title].length, 1, `${mm}:${ss}`, left < 30 ? C.red : C.bright);
          scr.text(2, 2, `kills ${me.kills}`, C.dim);
        }
        if (this.mode === 'dark') scr.text(2, 3, `F · flashlight ${this.flashlight ? 'ON' : 'off'}`, this.flashlight ? [230, 220, 170] : C.line);
      } else if (!this.zend) scr.text(2, 1, `next match in ${Math.ceil(left)}`, C.dim);
    }
    if (this.mode === 'cap') this.drawCaptureHUD();
    if (this.waveMsg) {
      const a = clamp(this.waveMsg.t / 0.5, 0, 1);
      const c = this.waveMsg.good ? [110, 220, 120] : [220, 90, 70];
      scr.textC(Math.floor(rows * 0.24), `═══  ${this.waveMsg.text}  ═══`, c.map(v => v * a));
    }
    if (this.dev && (this.dev.god || this.dev.ammo || this.dev.fly || this.dev.onehit || this.dev.speed !== 1 || this.dev.jump !== 1)) {
      const f = [this.dev.god && 'GOD', this.dev.ammo && 'AMMO', this.dev.fly && 'FLY', this.dev.onehit && 'ONEHIT', this.dev.speed !== 1 && `SPEED x${this.dev.speed}`, this.dev.jump !== 1 && `JUMP x${this.dev.jump}`].filter(Boolean).join(' · ');
      scr.text(2, 4, ` DEV · ${f} `, [255, 210, 120], [40, 26, 8]);
    }
    if (this.zend) this.drawZombieEnd();
    else if (this.results) this.drawResults();

    // ── killfeed (top right) ──
    this.killfeed.forEach((k, i) => {
      const icon = KF_ICON[k.w] || ' =[==> ';
      const str = `${k.k}${icon}${k.v}`;
      const a = clamp(k.t, 0, 1);
      const x = cols - [...str].length - 2;
      scr.text(x, 1 + i, str, k.mine ? [230 * a, 232 * a, 236 * a] : [140 * a, 144 * a, 150 * a], [16 * a, 17 * a, 20 * a]);
    });

    if (this.centerMsg) {
      const a = clamp(this.centerMsg.t / 0.4, 0, 1);
      const cc = this.centerMsg.col || [230, 70, 70];
      scr.textC(Math.floor(rows * 0.3), `─── ${this.centerMsg.text} ───`, cc.map(v => v * a));
    }

    // ── hotbar (bottom right): real 3D items rendered in small symbols ──
    const chatY = rows - 3;
    {
      const L = this.loadout, nS = 4;
      const sw = 17, sh = 8, gap = 1;
      const x0 = cols - (sw * nS + gap * (nS - 1)), y0 = chatY - sh;
      this.hotbarW = sw * nS + gap * (nS - 1);
      const A = scr.ART, F = scr.art;
      for (let k = 0; k < nS; k++) {
        const i = L[k], cat = WD.CATS[k];
        const x = x0 + k * (sw + gap), on = i >= 0 && wp.w === i;
        const bg = on ? [26, 28, 32] : [11, 12, 14];
        scr.box(x, y0, sw, sh, on ? C.bright : C.line, bg, false);
        scr.text(x + 1, y0, `${k + 1} ${cat.name}`.slice(0, sw - 2), on ? C.bright : C.dim, bg);
        if (i < 0) { scr.fill(x + 1, y0 + 1, sw - 2, sh - 2, ' ', null, bg); scr.textC(y0 + 3, 'empty', C.line, bg, x + sw / 2); continue; }
        scr.hole(x + 1, y0 + 1, sw - 2, sh - 3);
        // interior: UI cells stay see-through, the icon is drawn on the fine layer
        drawItemIcon(F, (x + 1) * A, (y0 + 1) * A, (sw - 2) * A, (sh - 3) * A, i, this.time, on, bg);
        scr.fill(x + 1, y0 + sh - 2, sw - 2, 1, ' ', null, bg);
        let label = SLOTS[i], lc = on ? C.bright : C.dim;
        const inf = this.dev && this.dev.ammo;
        if (i === 0) label = inf ? '∞' : `${'|'.repeat(wp.ammo)}${'.'.repeat(6 - wp.ammo)}`;
        if (i === 2 && wp.drinkCD > 0) label = `${wp.drinkCD.toFixed(1)}s`;
        if (WD.isGun(i)) { const m = wp.mags[i]; label = inf ? '∞' : `${m}/${WD.WEAPONS[WD.ITEMS[i].id].mag}`; if (m <= 3 && !inf) lc = C.red; }
        if (i === 7) { label = inf ? 'x∞' : `x${wp.molotovs}`; if (!wp.molotovs && !inf) lc = C.line; }
        if (i === 8 && wp.medCD > 0) label = `${wp.medCD.toFixed(1)}s`;
        scr.textC(y0 + sh - 2, label, lc, bg, x + sw / 2);
      }
      if (wp.reloading) scr.textC(y0 - 1, 'RELOADING', C.dim, null, x0 + this.hotbarW / 2);
    }

    // ── chat log + chat bar (old-school bottom bar, full width) ──
    {
      const maxLines = this.chatOpen ? 10 : 6;
      const maxW = Math.max(20, cols - (this.hotbarW || 53) - 6);
      const shown = this.chatLog.slice(-maxLines);
      let y = chatY - shown.length - 1;
      for (const c of shown) {
        const a = this.chatOpen ? 1 : clamp((14 - c.t) / 2, 0, 1);
        if (a > 0) {
          const bgc = [8 * a, 9 * a, 11 * a];
          if (c.sys) scr.text(2, y, [...`· ${c.text}`].slice(0, maxW).join(''), [110 * a, 115 * a, 122 * a], bgc);
          else {
            const n = scr.text(2, y, `${c.name}: `, c.mine ? [240 * a, 240 * a, 244 * a] : [150 * a, 155 * a, 165 * a], bgc);
            scr.text(2 + n, y, [...c.text].slice(0, Math.max(0, maxW - n)).join(''), [205 * a, 208 * a, 214 * a], bgc);
          }
        }
        y++;
      }
      const bg = this.chatOpen ? [20, 21, 24] : [11, 12, 14];
      scr.box(0, chatY, cols, 3, this.chatOpen ? C.bright : C.line, bg);
      if (this.chatOpen) {
        const arr = [...this.chatText];
        const vis = arr.slice(Math.max(0, arr.length - (cols - 8))).join('');
        const n = scr.text(2, chatY + 1, '> ' + vis, C.bright, bg);
        if (this.time % 1 < 0.55) scr.put(2 + n, chatY + 1, '_', C.bright, bg);
      } else {
        scr.text(2, chatY + 1, 'To chat click here or press "/" key', C.dim, bg);
      }
    }

    // ── death screen ──
    if (me.dead) {
      const k = clamp(me.deadT / 1.2, 0, 1);
      scr.dim(0, 0, cols, rows - 3, 1 - k * 0.55);
      const left = Math.max(0, 3.5 - me.deadT);
      if (me.deadT > 0.6) {
        scr.textC(Math.floor(rows * 0.42), '─────  Y O U   D I E D  ─────', [200, 40, 46]);
        scr.textC(Math.floor(rows * 0.42) + 2, `killed by ${me.killer}`, C.dim);
        scr.textC(Math.floor(rows * 0.42) + 3, `respawn in ${left.toFixed(1)}`, C.dim);
      }
    }

    // ── scoreboard (TAB) ──
    if (app.input.down.has('Tab') && !this.paused) this.drawScoreboard();

    if (this.paused) this.drawPause();
  }

  // doom-fire: a heat buffer that cools while it rises; drawn with symbols at the bottom of the screen
  drawScreenFire(dt) {
    // drawn on the fine layer: many small symbols, like the 3D world
    const scr = this.app.scr, F = scr.fine, cols = F.cols, rows = F.rows, D = scr.detail;
    const H = Math.max(8, Math.floor(rows * 0.36)), Wd = cols;
    if (!this.fireBuf || this.fireBuf.w !== Wd || this.fireBuf.h !== H) this.fireBuf = { w: Wd, h: H, a: new Float32Array(Wd * H), acc: 0 };
    const B = this.fireBuf, a = B.a;
    B.acc += dt;
    while (B.acc > 1 / 40) {
      B.acc -= 1 / 40;
      for (let x = 0; x < Wd; x++) a[(H - 1) * Wd + x] = this.burnFx * (0.75 + Math.random() * 0.25);
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < Wd; x++) {
        const src = (y + 1) * Wd + Math.min(Wd - 1, Math.max(0, x + Math.floor(Math.random() * 3) - 1));
        a[y * Wd + x] = Math.max(0, a[src] - Math.random() * 0.05 - 0.008);
      }
    }
    const ramp = ' .,:;^*!#%@';
    const y0 = rows - 3 * D - H;
    for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) {
      const v = a[y * Wd + x];
      if (v < 0.12) continue;
      const ch = ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
      F.put(x, y0 + y, ch, [255 * Math.min(1, v * 1.6), Math.min(255, 230 * Math.max(0, v - 0.35) * 1.4 + 40 * v), Math.min(255, 60 * Math.max(0, v - 0.7) * 3)], [40 * v, 10 * v, 0]);
    }
    if (this.time % 0.8 < 0.55 && this.me.burn) scr.textC(Math.floor(scr.rows * 0.62), ' YOU ARE ON FIRE  ·  use a MEDKIT ', [255, 160, 70], [30, 10, 4]);
  }

  // CAPTURE Σ: score, where the Σ is, an arrow towards it (or towards your base when you carry it)
  drawCaptureHUD() {
    const scr = this.app.scr, me = this.me, S = this.sigma, cols = scr.cols;
    const [r, b] = this.score;
    const str = `RED  ${r}  :  ${b}  BLUE`;
    const x = Math.floor(cols / 2 - str.length / 2);
    scr.text(x, 5, ' RED ', [255, 255, 255], WD.TEAM_COL[0].map(v => v * 0.7));
    scr.text(x + 5, 5, `  ${r}  :  ${b}  `, C.bright, [16, 17, 20]);
    scr.text(x + str.length - 5, 5, ' BLUE ', [255, 255, 255], WD.TEAM_COL[1].map(v => v * 0.7));
    if (me.team >= 0) scr.textC(6, `you are ${WD.TEAM_NAME[me.team]} · first to 3`, WD.TEAM_COL[me.team]);
    if (!S || me.dead) return;
    const mine = S.state === 'carried' && S.carrier === this.myId;
    let tx = S.x, tz = S.z, label;
    if (mine) { const base = WD.CAP_BASES[me.team]; tx = base[0]; tz = base[2]; label = 'YOU HAVE THE Σ  ·  run to your base'; }
    else if (S.state === 'carried') { const o = this.others.get(S.carrier); label = o ? `Σ carried by ${o.name}` + (o.team === me.team ? ' (team)' : ' (enemy!)') : 'Σ carried'; }
    else label = S.state === 'home' ? 'Σ waits in the center' : 'Σ dropped!';
    const ang = Math.atan2(-(tx - me.x), -(tz - me.z)) - me.yaw;
    const a = Math.atan2(Math.sin(ang), Math.cos(ang));
    const arrows = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
    const arrow = arrows[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
    const d = Math.round(Math.hypot(tx - me.x, tz - me.z));
    scr.textC(8, `${arrow}  ${label}  ·  ${d} m  ${arrow}`, mine ? [255, 214, 100] : [230, 200, 120]);
    if (mine) scr.textC(Math.floor(scr.rows * 0.5) + 3, '[ Σ ]', [255, 214, 100]);
  }
  drawZombieEnd() {
    const scr = this.app.scr, z = this.zend;
    const w = 56, h = 13;
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2) - 4;
    scr.box(x, y, w, h, [120, 60, 50], C.panel);
    scr.textC(y + 1, 'T H E   Z O M B I E S   G O T   Y O U', [220, 90, 70], C.panel, x + w / 2);
    for (let i = 1; i < w - 1; i++) scr.put(x + i, y + 2, '-', C.line, C.panel);
    scr.textC(y + 4, `survived waves:  ${z.wave}`, C.bright, C.panel, x + w / 2);
    scr.textC(y + 5, `zombies killed:  ${z.kills}`, C.text, C.panel, x + w / 2);
    scr.textC(y + 6, `stars earned:  +${z.stars} ★`, [236, 196, 92], C.panel, x + w / 2);
    scr.textC(y + 8, z.best ? `NEW BEST: wave ${z.bestWave}!` : `best: wave ${z.bestWave}`, z.best ? [110, 220, 120] : C.dim, C.panel, x + w / 2);
    const left = this.match ? Math.max(0, Math.ceil(this.match.ends - this.time)) : 0;
    scr.textC(y + 10, `new run in ${left} · Esc → LEAVE for the lobby`, C.line, C.panel, x + w / 2);
  }

  drawResults() {
    const scr = this.app.scr, res = this.results;
    const list = res.list;
    const w = 56, h = list.length + 9;
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2) - 4;
    scr.box(x, y, w, h, C.dim, C.panel);
    const mine = list.find(r => r.id === this.myId);
    let title = mine && mine.place === 1 ? 'V I C T O R Y' : 'M A T C H   O V E R';
    if (this.mode === 'cap' && res.score) { const [a, b] = res.score; title = a === b ? `D R A W   ${a} : ${b}` : `${a > b ? 'RED' : 'BLUE'} WINS  ${a} : ${b}`; }
    scr.textC(y + 1, title, mine && mine.place === 1 ? [244, 214, 120] : C.bright, C.panel, x + w / 2);
    scr.text(x + 3, y + 3, '#   PLAYER', C.dim, C.panel);
    scr.text(x + w - 24, y + 3, 'K    D   ELO    ★', C.dim, C.panel);
    for (let i = 1; i < w - 1; i++) scr.put(x + i, y + 4, '-', C.line, C.panel);
    list.forEach((r, i) => {
      const me = r.id === this.myId, c = me ? C.bright : C.text;
      const yy = y + 5 + i;
      scr.text(x + 3, yy, String(r.place), r.place === 1 ? [244, 214, 120] : c, C.panel);
      scr.text(x + 7, yy, r.name, r.team >= 0 ? WD.TEAM_COL[r.team] : c, C.panel);
      scr.text(x + w - 24, yy, String(r.kills).padEnd(5) + String(r.deaths).padEnd(5), c, C.panel);
      const rp = res.ranked ? (r.rp > 0 ? `+${r.rp}` : String(r.rp)) : '-';
      scr.text(x + w - 14, yy, rp, r.rp > 0 ? [110, 190, 130] : r.rp < 0 ? [200, 80, 80] : C.dim, C.panel);
      if (r.stars) scr.text(x + w - 8, yy, `+${r.stars}`, [236, 196, 92], C.panel);
    });
    const note = res.ranked ? 'each kill: +4 ELO and +5 ★ · results saved to your profile' : 'need 2+ players for a ranked match';
    scr.textC(y + h - 3, note, C.dim, C.panel, x + w / 2);
    scr.textC(y + h - 2, `next match in ${Math.max(0, Math.ceil(this.match.ends - this.time))}`, C.line, C.panel, x + w / 2);
  }

  drawScoreboard() {
    const scr = this.app.scr;
    const list = [{ name: this.me.name, kills: this.me.kills, deaths: this.me.deaths, me: true }, ...[...this.others.values()].filter(o => !o.zombie).map(o => ({ name: o.name, kills: o.kills, deaths: o.deaths, team: o.team }))]
      .sort((a, b) => b.kills - a.kills);
    const w = 44, h = list.length + 5;
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2) - 3;
    scr.box(x, y, w, h, C.line, C.panel);
    scr.text(x + 2, y + 1, 'PLAYER', C.dim, C.panel);
    scr.text(x + w - 16, y + 1, 'KILLS  DEATHS', C.dim, C.panel);
    for (let i = 1; i < w - 1; i++) scr.put(x + i, y + 2, '-', C.line, C.panel);
    list.forEach((p, i) => {
      const c = p.me ? C.bright : C.text;
      scr.text(x + 2, y + 3 + i, p.name, c, C.panel);
      scr.text(x + w - 15, y + 3 + i, String(p.kills).padStart(4), c, C.panel);
      scr.text(x + w - 8, y + 3 + i, String(p.deaths).padStart(5), c, C.panel);
    });
  }

  drawPause() {
    const app = this.app, scr = app.scr, ui = app.ui, S = app.settings;
    scr.dim(0, 0, scr.cols, scr.rows, 0.35);
    const w = 58, h = 21;
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2);
    scr.box(x, y, w, h, C.line, C.panel);
    scr.textC(y + 1, 'P A U S E D', C.bright, C.panel, x + w / 2);
    for (let i = 1; i < w - 1; i++) scr.put(x + i, y + 2, '-', C.line, C.panel);
    const A = app.audio;
    const sx = x + 3, sw = w - 6;
    const vm = ui.slider('vol_m', sx, y + 4, sw, 'MASTER', A.vol.master);
    const vs = ui.slider('vol_s', sx, y + 6, sw, 'EFFECTS', A.vol.sfx);
    const va = ui.slider('vol_a', sx, y + 8, sw, 'AMBIENT', A.vol.ambient);
    if (vm !== A.vol.master || vs !== A.vol.sfx || va !== A.vol.ambient) {
      A.vol.master = vm; A.vol.sfx = vs; A.vol.ambient = va; A.applyVolume(); A.saveVolume();
    }
    const sens = ui.slider('sens', sx, y + 10, sw, 'MOUSE', S.sens / 3, { format: v => (v * 3).toFixed(2) });
    const fov = ui.slider('fov', sx, y + 12, sw, 'FOV', (S.fov - 60) / 50, { format: v => String(Math.round(60 + v * 50)) });
    if (Math.abs(sens * 3 - S.sens) > 1e-6 || Math.abs(60 + fov * 50 - S.fov) > 1e-6) {
      S.sens = Math.max(0.05, sens * 3); S.fov = Math.round(60 + fov * 50); app.saveSettings();
    }
    // detail = glyph size (smaller glyphs = more detail, more CPU)
    // DETAIL: how many small world symbols fit in one UI symbol (1×1, 2×2, 3×3)
    const det = ui.slider('detail', sx, y + 14, sw, 'DETAIL', ((S.detail || 2) - 1) / 2, { format: v => ['LOW', 'HIGH', 'ULTRA'][Math.round(v * 2)] });
    const d = Math.round(det * 2) + 1;
    if (d !== (S.detail || 2)) { S.detail = d; app.saveSettings(); app.scr.setDetail(d); }
    const bw = 24;
    if (ui.button('resume', x + 4, y + h - 5, bw, 'RESUME')) app.input.lock();
    if (ui.button('leave', x + w - 4 - bw, y + h - 5, bw, 'LEAVE', { fg: [210, 120, 120] })) app.leaveGame();
    scr.text(x + 2, y + h - 1, ` ${app.fps} fps · ${scr.cols}×${scr.rows} glyphs `, C.dim, C.panel);
  }
}
