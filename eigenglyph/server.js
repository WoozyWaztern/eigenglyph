// ─────────────────────────────────────────────────────────────
//  EIGENGLYPH — game server
//  Serves the game in the browser + runs multiplayer over WebSocket.
//  Start:  npm start   (or: node server.js) — no dependencies needed
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { attach } from './miniws.js';
import * as world from './shared/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ACC_FILE = path.join(DATA_DIR, 'accounts.json');

// ───────────── accounts (nickname + password, hashed) ─────────────
let accounts = {};
try { accounts = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8')); } catch { accounts = {}; }
function saveAccounts() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACC_FILE, JSON.stringify(accounts, null, 2));
}
function hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 32).toString('hex');
}
const NAME_RE = /^[A-Za-z0-9_Ѐ-ӿ]{3,16}$/;

// ───────────── static files ─────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/api/prefs') {   // local settings store (only for the player on this PC)
    const ra = req.socket.remoteAddress || '';
    if (!/^(::1|127\.|::ffff:127\.)/.test(ra)) { res.writeHead(403); return res.end(); }
    if (req.method === 'POST') {
      let body = ''; req.on('data', d => { if (body.length < 65536) body += d; });
      req.on('end', () => { try { JSON.parse(body); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PREFS_FILE, body); } catch {} res.end(); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(fs.existsSync(PREFS_FILE) ? fs.readFileSync(PREFS_FILE) : '{}');
  }
  if (url === '/') url = '/index.html';
  let base = path.join(__dirname, 'public');
  if (url.startsWith('/shared/')) { base = __dirname; }
  const file = path.normalize(path.join(base, url));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ───────────── game state ─────────────

let nextId = 1;
const clients = new Set();          // every connection
const players = new Map();          // id -> player (in game)
const now = () => performance.now() / 1000;
const r3 = v => Math.round(v * 1000) / 1000;

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}
// ───────────── persistent stats + ranks ─────────────
const MATCH_TIME = Number(process.env.MATCH_TIME) || 300, RESULTS_TIME = 10;
function statsOf(acc) {
  if (!acc.stats) acc.stats = { rp: 0, kills: 0, deaths: 0, wins: 0, matches: 0, history: [] };
  if (acc.stats.stars === undefined) acc.stats.stars = 0;
  if (!acc.stats.since) acc.stats.since = acc.created || Date.now();
  return acc.stats;
}
// ───────────── friends ─────────────
function social(acc) {
  if (!acc.friends) acc.friends = [];
  if (!acc.reqIn) acc.reqIn = [];
  if (!acc.reqOut) acc.reqOut = [];
  if (!acc.notes) acc.notes = [];
  return acc;
}
function onlineConn(key) { for (const c of clients) if (c.acc && c.name.toLowerCase() === key) return c; return null; }
function note(acc, text) { social(acc).notes.unshift({ text, at: Date.now() }); acc.notes = acc.notes.slice(0, 20); }
function socialMsg(acc) {
  social(acc);
  const card = key => {
    const a = accounts[key]; if (!a) return null;
    const oc = onlineConn(key);
    return { name: a.name, rp: statsOf(a).rp, stars: statsOf(a).stars, online: !!oc, ingame: !!(oc && oc.player) };
  };
  return { t: 'social', friends: acc.friends.map(card).filter(Boolean), requests: acc.reqIn.map(card).filter(Boolean),
    outgoing: acc.reqOut.map(k => accounts[k] ? accounts[k].name : k), notes: acc.notes };
}
function pushSocial(key) { const c = onlineConn(key); if (c) send(c.ws, socialMsg(c.acc)); }
function relation(acc, key) {
  social(acc);
  if (acc.name.toLowerCase() === key) return 'you';
  if (acc.friends.includes(key)) return 'friend';
  if (acc.reqOut.includes(key)) return 'pending';
  if (acc.reqIn.includes(key)) return 'incoming';
  return 'none';
}
function makeFriends(a, b) {
  const ka = a.name.toLowerCase(), kb = b.name.toLowerCase();
  for (const [x, k] of [[a, kb], [b, ka]]) {
    social(x);
    x.reqIn = x.reqIn.filter(v => v !== k); x.reqOut = x.reqOut.filter(v => v !== k);
    if (!x.friends.includes(k)) x.friends.push(k);
  }
}
function onSocial(c, m) {
  const me = social(c.acc), myKey = c.name.toLowerCase();
  const key = String(m.name || '').trim().toLowerCase();
  const other = accounts[key];
  const reply = (text, ok = true) => send(c.ws, { t: 'notice', text, ok });
  switch (m.t) {
    case 'social': return send(c.ws, socialMsg(me));
    case 'search': {
      const q = String(m.q || '').trim().toLowerCase().slice(0, 16);
      const list = Object.keys(accounts).filter(k => !q || k.includes(q))
        .sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b)).slice(0, 12)
        .map(k => { const a = accounts[k]; return { name: a.name, rp: statsOf(a).rp, stars: statsOf(a).stars, online: !!onlineConn(k), rel: relation(me, k) }; });
      return send(c.ws, { t: 'searchRes', q, list });
    }
    case 'friendAdd': {
      if (!other) return reply('player not found', false);
      if (key === myKey) return reply("you can't add yourself", false);
      const rel = relation(me, key);
      if (rel === 'friend') return reply(`${other.name} is already your friend`, false);
      if (rel === 'pending') return reply(`request to ${other.name} already sent`, false);
      if (rel === 'incoming') { makeFriends(me, other); note(other, `${me.name} accepted your friend request`); }
      else { social(other); me.reqOut.push(key); other.reqIn.push(myKey); note(other, `${me.name} wants to be your friend`); }
      saveSoon(); pushSocial(myKey); pushSocial(key);
      return reply(rel === 'incoming' ? `you and ${other.name} are now friends` : `friend request sent to ${other.name}`);
    }
    case 'friendAccept': {
      if (!other || !me.reqIn.includes(key)) return;
      makeFriends(me, other); note(other, `${me.name} accepted your friend request`);
      saveSoon(); pushSocial(myKey); pushSocial(key);
      return reply(`you and ${other.name} are now friends`);
    }
    case 'friendDecline': {
      if (!other) return;
      me.reqIn = me.reqIn.filter(v => v !== key); social(other).reqOut = other.reqOut.filter(v => v !== myKey);
      saveSoon(); pushSocial(myKey); pushSocial(key);
      return;
    }
    case 'friendRemove': {
      if (!other) return;
      me.friends = me.friends.filter(v => v !== key); social(other).friends = other.friends.filter(v => v !== myKey);
      saveSoon(); pushSocial(myKey); pushSocial(key);
      return reply(`${other.name} removed from friends`);
    }
  }
}
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveAccounts, 1000); }
function sendProfile(c) { if (c && c.acc) send(c.ws, { t: 'profile', stats: statsOf(c.acc) }); }

// match: DEATHMATCH, 5 minutes, then results for 10 s, then a new match
const match = { phase: 'idle', ends: 0 };
function matchInfo() { return { t: 'match', phase: match.phase, left: Math.max(0, Math.round(match.ends - now())) }; }
function startMatch() {
  match.phase = 'play'; match.ends = now() + MATCH_TIME;
  for (const p of players.values()) { p.kills = 0; p.deaths = 0; spawn(p);
    broadcast({ t: 'respawn', id: p.id, x: r3(p.x), y: 0, z: r3(p.z), yaw: r3(p.yaw) }); }
  broadcast({ t: 'matchstart', left: MATCH_TIME });
}
function endMatch() {
  match.phase = 'results'; match.ends = now() + RESULTS_TIME;
  const list = [...players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const ranked = list.length >= 2;
  const results = list.map((p, i) => {
    const place = i + 1;
    let delta = 0;
    if (ranked) {
      delta = place === 1 ? 25 : place <= 3 ? 10 : -15;
      const st = statsOf(p.c.acc);
      st.matches++; if (place === 1) st.wins++;
      st.rp = Math.max(0, st.rp + delta);
      st.stars += place === 1 ? 50 : place <= 3 ? 20 : 10;
      st.history.unshift({ place, mode: 'DEATHMATCH', k: p.kills, d: p.deaths, rp: delta + p.kills * 2 });
      st.history = st.history.slice(0, 8);
      sendProfile(p.c);
    }
    return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, place, rp: delta, stars: ranked ? (place === 1 ? 50 : place <= 3 ? 20 : 10) : 0 };
  });
  if (ranked) saveSoon();
  broadcast({ t: 'matchend', results, ranked, next: RESULTS_TIME });
}

function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address + (PORT === 3000 ? '' : ':' + PORT));
  return out;
}
function sys(text) { broadcast({ t: 'chat', id: 0, name: '', text, sys: true }); }

function pickSpawn() {
  let best = world.SPAWNS[0], bestD = -1;
  for (const s of world.SPAWNS) {
    let d = 1e9;
    for (const p of players.values()) if (!p.dead) d = Math.min(d, Math.hypot(p.x - s[0], p.z - s[2]));
    d += Math.random() * 6;
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}
function yawToCenter(x, z) { return Math.atan2(-(24 - x), -(24 - z)); }

function pubPlayer(p) {
  return { id: p.id, name: p.name, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw), pitch: r3(p.pitch),
    w: p.w, hp: p.hp, dead: p.dead, kills: p.kills, deaths: p.deaths, wounds: p.wounds };
}

function spawn(p) {
  const s = pickSpawn();
  p.x = s[0]; p.y = 0; p.z = s[2]; p.yaw = yawToCenter(p.x, p.z); p.pitch = 0;
  p.hp = world.MAX_HP; p.dead = false; p.wounds = []; p.protUntil = now() + 1.5;
}

function joinGame(c) {
  if (c.player) return;
  const p = { id: nextId++, name: c.name, ws: c.ws, c, w: 0, kills: 0, deaths: 0,
    lastShot: 0, lastKnife: 0, lastDrink: -99, lastChat: 0 };
  spawn(p);
  c.player = p;
  players.set(p.id, p);
  send(c.ws, { t: 'welcome', id: p.id, you: pubPlayer(p), players: [...players.values()].map(pubPlayer) });
  broadcast({ t: 'join', p: pubPlayer(p) }, c.ws);
  sys(`${p.name} entered the void`);
  if (match.phase === 'idle') startMatch();
  else send(c.ws, matchInfo());
}
function leaveGame(c) {
  const p = c.player;
  if (!p) return;
  players.delete(p.id);
  c.player = null;
  broadcast({ t: 'leave', id: p.id });
  sys(`${p.name} left`);
  if (!players.size) match.phase = 'idle';
}

function damage(target, attacker, dmg, weapon, wounds, pts) {
  if (target.dead || match.phase !== 'play') return;
  target.hp = Math.max(0, target.hp - dmg);
  for (const w of wounds) { target.wounds.push(w); if (target.wounds.length > 28) target.wounds.shift(); }
  broadcast({ t: 'hit', id: target.id, by: attacker.id, dmg, hp: target.hp, w: weapon, wounds, pts });
  if (target.hp <= 0) {
    target.dead = true; target.deadUntil = now() + 3.5;
    target.deaths++; attacker.kills++;
    const sa = statsOf(attacker.c.acc), sv = statsOf(target.c.acc);
    sa.kills++; sa.rp += 2; sa.stars += 5; sv.deaths++;
    sendProfile(attacker.c); sendProfile(target.c); saveSoon();
    broadcast({ t: 'kill', victim: target.id, killer: attacker.id, w: weapon,
      vk: target.kills, vd: target.deaths, kk: attacker.kills, kd: attacker.deaths });
  }
}

const tmp = {};
function norm(d) {
  if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return null;
  const l = Math.hypot(d[0], d[1], d[2]);
  return l > 1e-6 ? [d[0] / l, d[1] / l, d[2] / l] : null;
}

// trace one ray against walls + players; returns {p, t, point} or null
function traceHit(shooter, o, d, maxT, rad) {
  let wall = world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], maxT, tmp);
  if (wall < 0) wall = maxT;
  let best = null, bestT = wall;
  for (const p of players.values()) {
    if (p === shooter || p.dead) continue;
    const t = world.raySphere(o[0], o[1], o[2], d[0], d[1], d[2], p.x, p.y + world.BODY_CY, p.z, rad);
    if (t > 0 && t < bestT) { bestT = t; best = p; }
  }
  if (!best) return null;
  return { p: best, t: bestT, point: [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT] };
}
function woundFor(p, point, type) {
  // direction from body center to hit point, in the victim's local frame
  let vx = point[0] - p.x, vy = point[1] - (p.y + world.BODY_CY), vz = point[2] - p.z;
  const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
  const L = world.toLocal(vx, vy, vz, p.yaw);
  return [r3(L[0]), r3(L[1]), r3(L[2]), type];
}

function onShoot(p, m) {
  const t = now();
  if (p.dead || t - p.lastShot < world.WEAPONS.shotgun.cooldown - 0.12) return;
  p.lastShot = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  const pellets = Array.isArray(m.pel) ? m.pel.slice(0, 10).map(norm).filter(Boolean) : [];
  if (!pellets.length) pellets.push(d);
  broadcast({ t: 'fx', k: 'shot', id: p.id, o: o.map(r3), pel: pellets.map(v => v.map(r3)) }, p.ws);
  const hits = new Map();
  for (const pd of pellets) {
    if (pd[0] * d[0] + pd[1] * d[1] + pd[2] * d[2] < 0.97) continue; // spread sanity check
    const h = traceHit(p, o, pd, world.WEAPONS.shotgun.range, world.BODY_R + 0.06);
    if (!h) continue;
    if (!hits.has(h.p)) hits.set(h.p, []);
    hits.get(h.p).push(h.point);
  }
  for (const [target, points] of hits) {
    if (t < target.protUntil) continue;
    const wounds = points.slice(0, 5).map(pt => woundFor(target, pt, 0));
    damage(target, p, world.WEAPONS.shotgun.dmg, 'shotgun', wounds, points.slice(0, 5).map(v => v.map(r3)));
  }
}

function onKnife(p, m) {
  const t = now();
  if (p.dead || t - p.lastKnife < world.WEAPONS.knife.cooldown - 0.08) return;
  p.lastKnife = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  broadcast({ t: 'fx', k: 'knife', id: p.id }, p.ws);
  const h = traceHit(p, o, d, world.WEAPONS.knife.range, world.BODY_R + 0.3);
  if (!h || t < h.p.protUntil) return;
  // a slash = short line of 3 cuts
  const target = h.p;
  const base = woundFor(target, h.point, 1);
  const side = m.side === -1 ? -1 : 1;
  const wounds = [];
  for (let i = -1; i <= 1; i++) {
    const a = i * 0.16 * side;
    const c = Math.cos(a), s = Math.sin(a);
    const lx = base[0] * c + base[2] * s, lz = -base[0] * s + base[2] * c;
    wounds.push([r3(lx), r3(base[1] + i * 0.07), r3(lz), 1]);
  }
  damage(target, p, world.WEAPONS.knife.dmg, 'knife', wounds, [h.point.map(r3)]);
}

function onDrink(p) {
  const t = now();
  if (p.dead || t - p.lastDrink < world.WEAPONS.soda.cooldown - 0.3) return;
  p.lastDrink = t;
  p.hp = Math.min(world.MAX_HP, p.hp + world.WEAPONS.soda.heal);
  broadcast({ t: 'heal', id: p.id, hp: p.hp });
}

attach(server, '/ws', ws => {
  const c = { ws, name: null, player: null };
  clients.add(c);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'auth') {
      const name = String(m.name || '').trim(), pass = String(m.pass || '');
      if (!NAME_RE.test(name)) return send(ws, { t: 'auth', ok: false, msg: 'nickname: 3-16 letters, digits or _' });
      if (pass.length < 3 || pass.length > 64) return send(ws, { t: 'auth', ok: false, msg: 'password: 3-64 characters' });
      const key = name.toLowerCase();
      for (const o of clients) if (o !== c && o.name && o.name.toLowerCase() === key)
        return send(ws, { t: 'auth', ok: false, msg: 'this nickname is already online' });
      let created = false;
      if (accounts[key]) {
        const a = accounts[key];
        if (hashPass(pass, a.salt) !== a.hash) return send(ws, { t: 'auth', ok: false, msg: 'wrong password' });
      } else {
        const salt = crypto.randomBytes(16).toString('hex');
        accounts[key] = { name, salt, hash: hashPass(pass, salt), created: Date.now() };
        saveAccounts(); created = true;
      }
      c.name = accounts[key].name; c.acc = accounts[key];
      return send(ws, { t: 'auth', ok: true, name: c.name, created, stats: statsOf(c.acc), lan: lanAddrs() });
    }
    if (!c.name) return;

    if (['social', 'search', 'friendAdd', 'friendAccept', 'friendDecline', 'friendRemove'].includes(m.t)) return onSocial(c, m);
    if (m.t === 'join') return joinGame(c);
    if (m.t === 'leave') return leaveGame(c);
    const p = c.player;
    if (!p) return;

    switch (m.t) {
      case 'st': {
        if (p.dead) break;
        const { x, y, z, yaw, pitch, w } = m;
        if ([x, y, z, yaw, pitch].every(Number.isFinite)) {
          p.x = Math.max(0, Math.min(world.W, x)); p.y = Math.max(0, Math.min(world.H, y));
          p.z = Math.max(0, Math.min(world.D, z)); p.yaw = yaw; p.pitch = pitch;
        }
        if (w === 0 || w === 1 || w === 2) p.w = w;
        break;
      }
      case 'shoot': onShoot(p, m); break;
      case 'knife': onKnife(p, m); break;
      case 'drink': onDrink(p); break;
      case 'chat': {
        const t = now();
        if (t - p.lastChat < 0.35) break;
        p.lastChat = t;
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
        if (text) broadcast({ t: 'chat', id: p.id, name: p.name, text });
        break;
      }
    }
  });
  ws.on('close', () => { leaveGame(c); clients.delete(c); });
});

// ───────────── tick: snapshots + respawns ─────────────
setInterval(() => {
  const t = now();
  for (const p of players.values()) {
    if (p.dead && t > p.deadUntil) {
      spawn(p);
      broadcast({ t: 'respawn', id: p.id, x: r3(p.x), y: 0, z: r3(p.z), yaw: r3(p.yaw) });
    }
  }
  if (match.phase === 'play' && t > match.ends) endMatch();
  else if (match.phase === 'results' && t > match.ends) startMatch();
  if (!players.size) return;
  const snap = { t: 's', p: [...players.values()].map(p =>
    [p.id, r3(p.x), r3(p.y), r3(p.z), r3(p.yaw), r3(p.pitch), p.w, p.hp, p.dead ? 1 : 0]) };
  broadcast(snap);
}, 50);

setInterval(() => {
  const msg = JSON.stringify({ t: 'online', n: clients.size, ingame: players.size });
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(msg);
}, 1500);

server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║   E I G E N G L Y P H  ·  Σ V O I D  ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log(`  you:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  friend:   http://${a.address}:${PORT}   (same Wi-Fi / LAN)`);
  console.log('');
});
