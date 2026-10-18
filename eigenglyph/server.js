// ─────────────────────────────────────────────────────────────
//  EIGENYTH — game server
//  Serves the game in the browser + runs multiplayer over WebSocket.
//  Start:  npm start   (or: node server.js) — no dependencies needed
//
//  Accounts are saved in data/accounts.json and, when the environment variables
//  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (render.com),
//  in a free Upstash Redis database — so they survive restarts and sleep.
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
const DEV_NAME = 'woozywaztern';            // only this account can open the F9 developer panel

// ───────────── accounts (nickname + password, hashed) ─────────────
let accounts = {};
let ready = false;                           // true once the accounts are loaded
const DB_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const DB_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const DB_KEY = 'eigenyth:accounts';
const useDb = !!(DB_URL && DB_TOKEN);
async function redis(cmd) {
  const r = await fetch(DB_URL, { method: 'POST', headers: { Authorization: `Bearer ${DB_TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j.result;
}
const savedJson = new Map();                 // key → JSON last written to the database
async function loadAccounts() {
  try { accounts = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8')); } catch { accounts = {}; }
  if (!useDb) { ready = true; console.log(`  accounts: ${Object.keys(accounts).length} (file data/accounts.json — set UPSTASH_REDIS_REST_URL/TOKEN to keep them on render.com)`); return; }
  for (let attempt = 1; ; attempt++) {
    try {
      const flat = await redis(['HGETALL', DB_KEY]) || [];
      const fromDb = {};
      for (let i = 0; i < flat.length; i += 2) { try { fromDb[flat[i]] = JSON.parse(flat[i + 1]); savedJson.set(flat[i], flat[i + 1]); } catch {} }
      // the database wins; accounts that exist only in the local file are uploaded
      accounts = Object.assign(accounts, fromDb);
      ready = true;
      console.log(`  accounts: ${Object.keys(accounts).length} (Upstash Redis database)`);
      saveSoon();
      return;
    } catch (e) {
      console.log(`  database not reachable (${e.message}) — retry ${attempt}…`);
      await new Promise(r => setTimeout(r, Math.min(10000, 1000 * attempt)));
    }
  }
}
let saving = false, saveAgain = false;
async function saveAccounts() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ACC_FILE, JSON.stringify(accounts)); } catch {}
  if (!useDb || !ready) return;
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    const cmd = ['HSET', DB_KEY];
    const changed = [];
    for (const [k, a] of Object.entries(accounts)) {
      const j = JSON.stringify(a);
      if (savedJson.get(k) !== j) { cmd.push(k, j); changed.push([k, j]); }
    }
    if (changed.length) { await redis(cmd); for (const [k, j] of changed) savedJson.set(k, j); }
  } catch (e) { console.log('  save failed:', e.message); setTimeout(saveSoon, 5000); }
  saving = false;
  if (saveAgain) { saveAgain = false; saveSoon(); }
}
function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }
const NAME_RE = /^[A-Za-z0-9_Ѐ-ӿ]{3,16}$/;
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveAccounts, 1000); }

// ───────────── static files ─────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
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

// ───────────── helpers ─────────────
let nextId = 1;
const clients = new Set();          // every connection
const rooms = new Map();            // room id → room (one per shared mode, one per zombie run)
const now = () => performance.now() / 1000;
const r3 = v => Math.round(v * 1000) / 1000;
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}
function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address + (PORT === 3000 ? '' : ':' + PORT));
  return out;
}

// ───────────── persistent stats + ranks ─────────────
function statsOf(acc) {
  if (!acc.stats) acc.stats = { rp: 0, kills: 0, deaths: 0, wins: 0, matches: 0, history: [] };
  const s = acc.stats;
  for (const k of ['rp', 'kills', 'deaths', 'wins', 'matches', 'stars', 'bestWave', 'zkills']) if (typeof s[k] !== 'number') s[k] = 0;
  if (!Array.isArray(s.history)) s.history = [];
  if (!s.since) s.since = acc.created || Date.now();
  if (!Array.isArray(s.inv)) s.inv = [];
  if (!s.loadout || typeof s.loadout !== 'object') s.loadout = { ...world.DEFAULT_LOADOUT };
  return s;
}
function sendProfile(c) { if (c && c.acc) send(c.ws, { t: 'profile', stats: statsOf(c.acc) }); }

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
    case 'viewProfile': {
      if (!other) return reply('player not found', false);
      const st = statsOf(other), oc = onlineConn(key);
      return send(c.ws, { t: 'profileView', p: { name: other.name, rp: st.rp, stars: st.stars, kills: st.kills, deaths: st.deaths,
        wins: st.wins, matches: st.matches, since: st.since, history: st.history.slice(0, 8), friends: social(other).friends.length,
        online: !!oc, ingame: !!(oc && oc.player), rel: relation(me, key), inv: st.inv.slice(), loadout: st.loadout, bestWave: st.bestWave } });
    }
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

// ───────────── SHOP + loadout ─────────────
function onBuy(c, m) {
  const it = world.ITEMS.find(i => i.id === m.id);
  const reply = (text, ok = true) => send(c.ws, { t: 'notice', text, ok });
  if (!it || it.starter) return reply('this item is not for sale', false);
  const st = statsOf(c.acc);
  if (st.inv.includes(it.id)) return reply(`you already own ${it.name}`, false);
  if (st.stars < it.price) return reply(`not enough stars: ${it.name} costs ${it.price} ★`, false);
  st.stars -= it.price;
  st.inv.push(it.id);
  if (!st.loadout[it.cat]) st.loadout[it.cat] = it.id;          // an empty slot gets the new item right away
  note(c.acc, `you bought ${it.name} for ${it.price} ★`);
  saveSoon(); sendProfile(c); send(c.ws, socialMsg(c.acc));
  send(c.ws, { t: 'bought', id: it.id });
  reply(`${it.name} added to your inventory`);
}
// max 4 items in a match: one per slot (PRIMARY / SECONDARY / MELEE / UTILITY)
function onEquip(c, m) {
  const st = statsOf(c.acc);
  const reply = (text, ok = true) => send(c.ws, { t: 'notice', text, ok });
  if (m.t === 'unequip') {
    const cat = world.CATS.find(k => k.id === m.cat);
    if (!cat) return;
    st.loadout[cat.id] = null;
    saveSoon(); sendProfile(c);
    return reply(`${cat.name} slot is empty now`);
  }
  const it = world.ITEMS.find(i => i.id === m.id);
  if (!it) return;
  if (!it.starter && !st.inv.includes(it.id)) return reply(`you don't own ${it.name}`, false);
  st.loadout[it.cat] = it.id;
  saveSoon(); sendProfile(c);
  reply(`${it.name} equipped · ${it.cat.toUpperCase()} slot`);
}

// ═════════════════════════ ROOMS + MATCHES ═════════════════════════
function newRoom(id, mode) {
  const room = { id, mode, info: world.MODE_INFO[mode], players: new Map(), zombies: new Map(),
    match: { phase: 'idle', ends: 0 }, fires: [], pending: [],
    sigma: { state: 'home', x: world.SIGMA_HOME[0], y: world.SIGMA_HOME[1], z: world.SIGMA_HOME[2], carrier: 0, back: 0 },
    score: [0, 0], wave: 0, toSpawn: 0, spawnT: 0, breakT: 0, nav: null, navT: 0, zkills: 0, starsRun: 0 };
  rooms.set(id, room);
  return room;
}
function roomFor(c, mode) {
  if (mode === 'zombie') return newRoom('z' + (nextId++), mode);        // solo: a private room for every run
  return rooms.get(mode) || newRoom(mode, mode);
}
function allTargets(room) { return [...room.players.values(), ...room.zombies.values()]; }
function sys(room, text) { broadcast(room, { t: 'chat', id: 0, name: '', text, sys: true }); }

function matchInfo(room) {
  return { t: 'match', phase: room.match.phase, left: Math.max(0, Math.round(room.match.ends - now())), score: room.score, wave: room.wave, mode: room.mode };
}
function startMatch(room) {
  const t = now();
  room.match.phase = 'play';
  room.match.ends = room.info.time ? t + room.info.time : t + 1e9;
  room.fires.length = 0; room.pending.length = 0;
  room.score = [0, 0];
  resetSigma(room, false);
  for (const z of room.zombies.values()) broadcast(room, { t: 'leave', id: z.id });
  room.zombies.clear();
  room.wave = 0; room.breakT = t + 3; room.toSpawn = 0; room.zkills = 0; room.starsRun = 0;
  for (const p of room.players.values()) {
    p.kills = 0; p.deaths = 0; spawn(room, p);
    broadcast(room, { t: 'respawn', id: p.id, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw) });
  }
  broadcast(room, { t: 'matchstart', left: room.info.time || 0, mode: room.mode, score: room.score });
  if (room.mode === 'cap') broadcast(room, sigmaMsg(room));
}
const rewardFor = place => place === 1 ? 50 : place <= 3 ? 20 : 10;
function endMatch(room) {
  room.match.phase = 'results'; room.match.ends = now() + 10;
  const list = [...room.players.values()];
  const ranked = list.length >= 2;
  let results;
  if (room.mode === 'cap') {
    const win = room.score[0] === room.score[1] ? -1 : room.score[0] > room.score[1] ? 0 : 1;
    list.sort((a, b) => (a.team === win ? 0 : 1) - (b.team === win ? 0 : 1) || b.kills - a.kills);
    results = list.map(p => {
      const won = p.team === win, draw = win < 0;
      const delta = ranked ? (won ? 50 : draw ? 10 : -15) : 0, stars = ranked ? (won ? 50 : draw ? 20 : 10) : 0;
      if (ranked) record(p, won ? 1 : 2, delta, stars);
      return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, place: won ? 1 : 2, rp: delta, stars, team: p.team };
    });
  } else {
    list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    results = list.map((p, i) => {
      const place = i + 1;
      const delta = ranked ? (place === 1 ? 50 : place <= 3 ? 20 : -15) : 0, stars = ranked ? rewardFor(place) : 0;
      if (ranked) record(p, place, delta, stars);
      return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, place, rp: delta, stars };
    });
  }
  if (ranked) saveSoon();
  broadcast(room, { t: 'matchend', results, ranked, next: 10, mode: room.mode, score: room.score });
}
function record(p, place, delta, stars) {
  const st = statsOf(p.c.acc);
  st.matches++; if (place === 1) st.wins++;
  st.rp = Math.max(0, st.rp + delta);
  st.stars += stars;
  st.history.unshift({ place, mode: (world.MODE_INFO[p.room.mode] || {}).name || 'DEATHMATCH', k: p.kills, d: p.deaths, rp: delta + p.kills * 4 });
  st.history = st.history.slice(0, 8);
  sendProfile(p.c);
}

// ───────────── players ─────────────
function pickSpawn(room, p) {
  let list = world.SPAWNS;
  if (room.mode === 'cap') list = world.SPAWNS.filter(s => p.team === 0 ? s[0] < 20 : s[0] > 27);
  let best = list[0], bestD = -1;
  for (const s of list) {
    let d = 1e9;
    for (const q of allTargets(room)) if (!q.dead && q !== p && (room.mode !== 'cap' || q.team !== p.team)) d = Math.min(d, Math.hypot(q.x - s[0], q.z - s[2]));
    d += Math.random() * 6;
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}
function yawToCenter(x, z) { return Math.atan2(-(24 - x), -(24 - z)); }
function pubPlayer(p) {
  return { id: p.id, name: p.name, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw), pitch: r3(p.pitch),
    w: p.w, hp: p.hp, dead: p.dead, kills: p.kills, deaths: p.deaths, wounds: p.wounds, team: p.team, zombie: !!p.zombie, maxHp: p.maxHp || 100 };
}
function spawn(room, p) {
  const s = pickSpawn(room, p);
  p.x = s[0]; p.y = 0; p.z = s[2]; p.yaw = yawToCenter(p.x, p.z); p.pitch = 0;
  p.hp = world.MAX_HP; p.dead = false; p.wounds = []; p.protUntil = now() + 1.5;
  p.burnUntil = 0; p.burnBy = null; p.burnTick = 0; p.molotovs = world.WEAPONS.molotov.count; p.lastMed = -99;
}
function joinGame(c, mode) {
  if (!ready) return;
  if (!world.MODE_INFO[mode]) mode = 'dm';
  if (c.player) leaveGame(c);
  const room = roomFor(c, mode);
  const loadout = world.loadoutOf(statsOf(c.acc));
  const first = loadout.find(i => i >= 0);
  const p = { id: nextId++, name: c.name, ws: c.ws, c, room, kills: 0, deaths: 0, team: -1, loadout,
    w: first === undefined ? -1 : first, fl: 1,
    lastShot: 0, lastKnife: 0, lastDrink: -99, lastChat: 0, lastFire: {}, lastMelee: 0, lastMed: -99, lastThrow: 0 };
  if (room.mode === 'cap') {
    const n = [0, 0]; for (const q of room.players.values()) n[q.team]++;
    p.team = n[0] <= n[1] ? 0 : 1;
  }
  spawn(room, p);
  c.player = p;
  room.players.set(p.id, p);
  send(c.ws, { t: 'welcome', id: p.id, you: pubPlayer(p), mode: room.mode, loadout,
    players: allTargets(room).map(pubPlayer), fires: room.fires.map(f => fireMsg(f)), score: room.score, wave: room.wave,
    sigma: room.mode === 'cap' ? sigmaMsg(room) : null, dev: c.dev || null });
  broadcast(room, { t: 'join', p: pubPlayer(p) }, c.ws);
  if (!room.info.solo) sys(room, `${p.name} entered the void${p.team >= 0 ? ' · team ' + world.TEAM_NAME[p.team] : ''}`);
  if (room.match.phase === 'idle') startMatch(room);
  else send(c.ws, matchInfo(room));
}
function leaveGame(c) {
  const p = c.player;
  if (!p) return;
  const room = p.room;
  if (room.mode === 'cap' && room.sigma.carrier === p.id) dropSigma(room, p);
  room.players.delete(p.id);
  c.player = null;
  broadcast(room, { t: 'leave', id: p.id });
  if (!room.info.solo) sys(room, `${p.name} left`);
  if (!room.players.size) { if (room.info.solo) rooms.delete(room.id); else { room.match.phase = 'idle'; room.zombies.clear(); } }
}
const owns = (p, idx) => p.loadout.includes(idx);

// ───────────── damage ─────────────
function canHurt(room, a, t) {
  if (!a || !t || a === t) return false;
  if (room.mode === 'cap' && !a.zombie && !t.zombie && a.team === t.team) return false;   // no friendly fire
  if (room.mode === 'zombie' && !a.zombie && !t.zombie) return false;
  return true;
}
// attacker may be null (e.g. the thrower of a molotov left the match)
function damage(room, target, attacker, dmg, weapon, wounds, pts) {
  if (target.dead || room.match.phase !== 'play') return;
  if (attacker && !attacker.zombie && !room.players.has(attacker.id)) attacker = null;
  if (attacker && !canHurt(room, attacker, target)) return;
  if (target.c && target.c.dev && target.c.dev.god && weapon !== 'dev') dmg = 0;   // dev: god mode
  if (attacker && attacker.c && attacker.c.dev && attacker.c.dev.onehit) dmg = 9999;
  target.hp = Math.max(0, target.hp - dmg);
  for (const w of wounds) { target.wounds.push(w); if (target.wounds.length > 28) target.wounds.shift(); }
  broadcast(room, { t: 'hit', id: target.id, by: attacker ? attacker.id : 0, dmg, hp: target.hp, w: weapon, wounds, pts });
  if (target.hp > 0) return;
  target.dead = true; target.deadUntil = now() + 3.5; target.burnUntil = 0;
  target.deaths = (target.deaths || 0) + 1;
  if (target.zombie) return zombieDied(room, target, attacker, weapon);
  if (room.mode === 'cap' && room.sigma.carrier === target.id) dropSigma(room, target);
  const pvp = room.mode !== 'zombie';
  if (pvp) statsOf(target.c.acc).deaths++;
  if (attacker && !attacker.zombie) {
    attacker.kills++;
    if (pvp) {
      const sa = statsOf(attacker.c.acc);
      sa.kills++; sa.rp += 4; sa.stars += 5;
      sendProfile(attacker.c);
    }
  }
  if (pvp) sendProfile(target.c);
  saveSoon();
  broadcast(room, { t: 'kill', victim: target.id, killer: attacker ? attacker.id : 0, w: weapon,
    vk: target.kills, vd: target.deaths, kk: attacker ? attacker.kills : 0, kd: attacker ? attacker.deaths : 0 });
  if (room.mode === 'zombie') zombieGameOver(room);
}

const tmp = {};
function norm(d) {
  if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return null;
  const l = Math.hypot(d[0], d[1], d[2]);
  return l > 1e-6 ? [d[0] / l, d[1] / l, d[2] / l] : null;
}
// trace one ray against walls + players + zombies
function traceHit(room, shooter, o, d, maxT, rad) {
  let wall = world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], maxT, tmp);
  if (wall < 0) wall = maxT;
  let best = null, bestT = wall;
  for (const p of allTargets(room)) {
    if (p === shooter || p.dead) continue;
    if (room.mode === 'cap' && p.team === shooter.team) continue;   // shoot through teammates
    const t = world.raySphere(o[0], o[1], o[2], d[0], d[1], d[2], p.x, p.y + world.BODY_CY, p.z, rad);
    if (t > 0 && t < bestT) { bestT = t; best = p; }
  }
  if (!best) return null;
  return { p: best, t: bestT, point: [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT] };
}
function woundFor(p, point, type) {
  let vx = point[0] - p.x, vy = point[1] - (p.y + world.BODY_CY), vz = point[2] - p.z;
  const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
  const L = world.toLocal(vx, vy, vz, p.yaw);
  return [r3(L[0]), r3(L[1]), r3(L[2]), type];
}

// ───────────── weapons ─────────────
function onShoot(p, m) {
  const t = now(), room = p.room;
  if (p.dead || !owns(p, 0) || t - p.lastShot < world.WEAPONS.shotgun.cooldown - 0.12) return;
  p.lastShot = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  const pellets = Array.isArray(m.pel) ? m.pel.slice(0, 10).map(norm).filter(Boolean) : [];
  if (!pellets.length) pellets.push(d);
  broadcast(room, { t: 'fx', k: 'shot', w: 0, id: p.id, o: o.map(r3), pel: pellets.map(v => v.map(r3)) }, p.ws);
  const hits = new Map();
  for (const pd of pellets) {
    if (pd[0] * d[0] + pd[1] * d[1] + pd[2] * d[2] < 0.97) continue; // spread sanity check
    const h = traceHit(room, p, o, pd, world.WEAPONS.shotgun.range, world.BODY_R + 0.06);
    if (!h) continue;
    if (!hits.has(h.p)) hits.set(h.p, []);
    hits.get(h.p).push(h.point);
  }
  for (const [target, points] of hits) {
    if (t < target.protUntil) continue;
    const wounds = points.slice(0, 5).map(pt => woundFor(target, pt, 0));
    damage(room, target, p, world.WEAPONS.shotgun.dmg, 'shotgun', wounds, points.slice(0, 5).map(v => v.map(r3)));
  }
}
function slashWounds(target, point, side, n, type) {
  const base = woundFor(target, point, type);
  const wounds = [];
  for (let i = -n; i <= n; i++) {
    const a = i * 0.14 * side, c = Math.cos(a), s = Math.sin(a);
    wounds.push([r3(base[0] * c + base[2] * s), r3(base[1] + i * 0.065), r3(-base[0] * s + base[2] * c), type]);
  }
  return wounds;
}
function onKnife(p, m) {
  const t = now(), room = p.room;
  if (p.dead || !owns(p, 1) || t - p.lastKnife < world.WEAPONS.knife.cooldown - 0.08) return;
  p.lastKnife = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  broadcast(room, { t: 'fx', k: 'knife', id: p.id }, p.ws);
  const h = traceHit(room, p, o, d, world.WEAPONS.knife.range, world.BODY_R + 0.3);
  if (!h || t < h.p.protUntil) return;
  damage(room, h.p, p, world.WEAPONS.knife.dmg, 'knife', slashWounds(h.p, h.point, m.side === -1 ? -1 : 1, 1, 1), [h.point.map(r3)]);
}
function onDrink(p) {
  const t = now();
  if (p.dead || !owns(p, 2) || t - p.lastDrink < world.WEAPONS.soda.cooldown - 0.3) return;
  p.lastDrink = t;
  p.hp = Math.min(world.MAX_HP, p.hp + world.WEAPONS.soda.heal);
  broadcast(p.room, { t: 'heal', id: p.id, hp: p.hp });
}
function onFire(p, m) {
  const t = now(), w = m.w | 0, it = world.ITEMS[w], room = p.room;
  if (p.dead || !it || it.kind !== 'gun' || !owns(p, w)) return;
  const W = world.WEAPONS[it.id];
  if (t - (p.lastFire[w] || 0) < W.cooldown * 0.75) return;
  p.lastFire[w] = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  broadcast(room, { t: 'fx', k: 'shot', w, id: p.id, o: o.map(r3), pel: [d.map(r3)] }, p.ws);
  const h = traceHit(room, p, o, d, W.range, world.BODY_R + 0.04);
  if (!h || t < h.p.protUntil) return;
  damage(room, h.p, p, W.dmg, it.id, [woundFor(h.p, h.point, 0)], [h.point.map(r3)]);
}
function onMelee(p, m) {
  const t = now(), w = m.w | 0, it = world.ITEMS[w], room = p.room;
  if (p.dead || !it || it.kind !== 'melee' || !owns(p, w)) return;
  const W = world.WEAPONS[it.id];
  if (t - p.lastMelee < W.cooldown - 0.1) return;
  p.lastMelee = t;
  const d = norm(m.d); if (!d) return;
  const o = [p.x, p.y + world.EYE, p.z];
  broadcast(room, { t: 'fx', k: 'melee', w, id: p.id }, p.ws);
  const h = traceHit(room, p, o, d, W.range, world.BODY_R + 0.32);
  if (!h || t < h.p.protUntil) return;
  const target = h.p, bat = it.id === 'bat';
  damage(room, target, p, W.dmg, it.id, slashWounds(target, h.point, m.side === -1 ? -1 : 1, bat ? 1 : 2, bat ? 0 : 1), [h.point.map(r3)]);
  if (W.push && !target.dead && canHurt(room, p, target)) {
    const px = target.x - p.x, pz = target.z - p.z, l = Math.hypot(px, pz) || 1;
    if (target.zombie) { target.kx = px / l * W.push; target.kz = pz / l * W.push; }
    else send(target.ws, { t: 'push', vx: r3(px / l * W.push), vy: 3.6, vz: r3(pz / l * W.push) });
  }
}
// ── molotov: the server flies the bottle, then the ground burns ──
const fireMsg = f => ({ t: 'fire', x: r3(f.x), y: r3(f.y), z: r3(f.z), r: f.r, life: r3(Math.max(0, f.until - now())), by: f.by ? f.by.id : 0 });
function onThrow(p, m) {
  const t = now(), w = world.ITEM_IDX.molotov, room = p.room, dev = p.c.dev || {};
  if (p.dead || !owns(p, w) || (p.molotovs <= 0 && !dev.ammo) || t - p.lastThrow < world.WEAPONS.molotov.cooldown - 0.2) return;
  const d = norm(m.d); if (!d) return;
  p.lastThrow = t; if (!dev.ammo) p.molotovs--;
  const { o, v } = world.throwStart(p.x, p.y, p.z, d);
  const path = world.throwPath(o, v, (x, y, z) => {
    for (const q of allTargets(room)) if (q !== p && !q.dead && canHurt(room, p, q) && Math.hypot(x - q.x, y - (q.y + world.BODY_CY), z - q.z) < world.BODY_R + 0.1) return q;
    return null;
  });
  broadcast(room, { t: 'throw', id: p.id, o: o.map(r3), v: v.map(r3), left: dev.ammo ? 99 : p.molotovs });
  room.pending.push({ at: t + path.t, x: path.x, y: path.y, z: path.z, hit: path.hit, by: p });
}
function burn(room, target, by) {
  if (target === by || target.dead || room.match.phase !== 'play') return;
  if (by && !canHurt(room, by, target)) return;
  const was = target.burnUntil > now();
  target.burnUntil = now() + world.WEAPONS.molotov.burnT;
  target.burnBy = by;
  if (!was) target.burnTick = now() + 0.15;
}
function onMedkit(p) {
  const t = now(), W = world.WEAPONS.medkit, dev = p.c.dev || {};
  if (p.dead || !owns(p, world.ITEM_IDX.medkit) || (t - p.lastMed < W.cooldown - 0.5 && !dev.ammo)) return;
  p.lastMed = t;
  p.hp = Math.min(world.MAX_HP, p.hp + W.heal);
  p.burnUntil = 0;
  broadcast(p.room, { t: 'heal', id: p.id, hp: p.hp, w: world.ITEM_IDX.medkit });
}
function fireTick(room, t) {
  for (let i = room.pending.length - 1; i >= 0; i--) {
    const q = room.pending[i];
    if (t < q.at) continue;
    room.pending.splice(i, 1);
    const W = world.WEAPONS.molotov;
    const f = { x: q.x, y: q.hit ? q.hit.y : q.y, z: q.z, r: W.fireR, until: now() + W.fireT, by: q.by };
    room.fires.push(f);
    broadcast(room, fireMsg(f));
    if (q.hit && !q.hit.dead) burn(room, q.hit, q.by);
  }
  for (let i = room.fires.length - 1; i >= 0; i--) {
    const f = room.fires[i];
    if (t > f.until) { room.fires.splice(i, 1); continue; }
    for (const q of allTargets(room))
      if (!q.dead && Math.hypot(q.x - f.x, q.z - f.z) < f.r && q.y >= f.y - 0.6 && q.y < f.y + 1.4) burn(room, q, f.by);
  }
  for (const q of allTargets(room)) {
    if (q.dead || !q.burnUntil || q.burnUntil <= t) continue;
    if (t >= q.burnTick) {
      q.burnTick = t + world.WEAPONS.molotov.tick;
      damage(room, q, q.burnBy, world.WEAPONS.molotov.burnDmg * (q.zombie ? 2 : 1), 'fire', [], []);
    }
  }
}

// ═════════════════════════ CAPTURE Σ ═════════════════════════
function sigmaMsg(room) {
  const s = room.sigma;
  return { t: 'sigma', state: s.state, x: r3(s.x), y: r3(s.y), z: r3(s.z), carrier: s.carrier, score: room.score };
}
function resetSigma(room, announce = true) {
  Object.assign(room.sigma, { state: 'home', x: world.SIGMA_HOME[0], y: world.SIGMA_HOME[1], z: world.SIGMA_HOME[2], carrier: 0, back: 0 });
  if (announce) broadcast(room, sigmaMsg(room));
}
function dropSigma(room, p) {
  Object.assign(room.sigma, { state: 'dropped', x: p.x, y: world.groundBelow(p.x, p.y + 0.5, p.z), z: p.z, carrier: 0, back: now() + 12 });
  broadcast(room, sigmaMsg(room));
  sys(room, `${p.name} dropped the Σ`);
}
function captureTick(room, t) {
  const s = room.sigma;
  if (room.match.phase !== 'play') return;
  if (s.state === 'carried') {
    const p = room.players.get(s.carrier);
    if (!p || p.dead) { if (p) dropSigma(room, p); else resetSigma(room); return; }
    s.x = p.x; s.y = p.y + 2.1; s.z = p.z;
    const b = world.CAP_BASES[p.team];
    if (Math.hypot(p.x - b[0], p.z - b[2]) < world.CAP_BASE_R && p.y < 1.5) {
      room.score[p.team]++;
      p.kills += 2;
      const st = statsOf(p.c.acc); st.stars += 10; sendProfile(p.c); saveSoon();
      broadcast(room, { t: 'capture', team: p.team, by: p.id, score: room.score });
      sys(room, `${p.name} captured the Σ for ${world.TEAM_NAME[p.team]} · ${room.score[0]} : ${room.score[1]}`);
      resetSigma(room);
      if (room.score[p.team] >= room.info.limit) endMatch(room);
    }
    return;
  }
  if (s.state === 'dropped' && t > s.back) { resetSigma(room); sys(room, 'the Σ returned to the center'); return; }
  for (const p of room.players.values()) {
    if (p.dead || t < p.protUntil) continue;
    if (Math.hypot(p.x - s.x, p.z - s.z) < 1.3 && Math.abs(p.y + 0.8 - s.y) < 2.0) {
      s.state = 'carried'; s.carrier = p.id;
      broadcast(room, sigmaMsg(room));
      sys(room, `${p.name} took the Σ — bring it to the ${world.TEAM_NAME[p.team]} base!`);
      return;
    }
  }
}

// ═════════════════════════ ZOMBIES (solo) ═════════════════════════
// walk grid: where a zombie can stand in every column (lowest free spot), -1 = blocked
const STAND = new Int8Array(world.W * world.D);
for (let z = 0; z < world.D; z++) for (let x = 0; x < world.W; x++) {
  let h = -1;
  for (let y = 0; y < 4; y++) if ((y === 0 || world.solid(x, y - 1, z)) && !world.solid(x, y, z) && !world.solid(x, y + 1, z)) { h = y; break; }
  STAND[z * world.W + x] = h;
}
function buildNav(room, tx, tz) {
  const W = world.W, D = world.D, dist = room.nav || new Int16Array(W * D);
  dist.fill(-1);
  const q = new Int32Array(W * D);
  let h = 0, tl = 0;
  const s = Math.max(0, Math.min(D - 1, Math.floor(tz))) * W + Math.max(0, Math.min(W - 1, Math.floor(tx)));
  dist[s] = 0; q[tl++] = s;
  while (h < tl) {
    const c = q[h++], cx = c % W, cz = (c / W) | 0, ch = STAND[c] < 0 ? 0 : STAND[c];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const n = nz * W + nx;
      if (dist[n] >= 0 || STAND[n] < 0 || Math.abs(STAND[n] - ch) > 1) continue;
      dist[n] = dist[c] + 1; q[tl++] = n;
    }
  }
  room.nav = dist;
}
function spawnZombie(room, wave) {
  const pl = [...room.players.values()][0];
  const Z = world.zombieWave(wave);
  let best = world.SPAWNS[0], bd = -1;
  for (const s of world.SPAWNS) {
    const d = pl ? Math.hypot(s[0] - pl.x, s[2] - pl.z) : 20;
    const score = d > 12 ? 100 - Math.abs(d - 20) + Math.random() * 15 : d;
    if (score > bd) { bd = score; best = s; }
  }
  const z = { id: nextId++, name: 'zombie', zombie: true, x: best[0] + (Math.random() - 0.5), y: 0, z: best[2] + (Math.random() - 0.5), yaw: 0, pitch: 0,
    w: -1, hp: Z.hp, maxHp: Z.hp, dead: false, wounds: [], kills: 0, deaths: 0, team: -1, speed: Z.speed * (0.85 + Math.random() * 0.3), dmg: Z.dmg,
    atkT: 0, protUntil: 0, burnUntil: 0, kx: 0, kz: 0 };
  room.zombies.set(z.id, z);
  broadcast(room, { t: 'join', p: pubPlayer(z) });
  return z;
}
function zombieDied(room, z, attacker, weapon) {
  broadcast(room, { t: 'kill', victim: z.id, killer: attacker ? attacker.id : 0, w: weapon, vk: 0, vd: 1, kk: attacker ? attacker.kills : 0, kd: 0 });
  room.zkills++;
  const pl = attacker && !attacker.zombie ? attacker : [...room.players.values()][0];
  if (pl) {
    if (attacker === pl) pl.kills++;
    const st = statsOf(pl.c.acc); st.stars += 1; st.zkills++; room.starsRun += 1;
    sendProfile(pl.c);
  }
  setTimeout(() => { if (room.zombies.delete(z.id)) broadcast(room, { t: 'leave', id: z.id }); }, 2500);
}
function zombieGameOver(room) {
  const p = [...room.players.values()][0];
  if (!p) return;
  room.match.phase = 'results'; room.match.ends = now() + 9;
  const st = statsOf(p.c.acc);
  const best = room.wave > st.bestWave;
  if (best) st.bestWave = room.wave;
  st.history.unshift({ place: room.wave, mode: 'ZOMBIES', k: room.zkills, d: 1, rp: 0, wave: room.wave });
  st.history = st.history.slice(0, 8);
  saveSoon(); sendProfile(p.c);
  broadcast(room, { t: 'zend', wave: room.wave, kills: room.zkills, stars: room.starsRun, best, bestWave: st.bestWave, next: 9 });
}
function zombieTick(room, t, dt) {
  if (room.match.phase !== 'play') return;
  const pl = [...room.players.values()][0];
  if (!pl) return;
  // waves
  const alive = [...room.zombies.values()].filter(z => !z.dead).length;
  if (room.toSpawn <= 0 && alive === 0 && room.breakT === 0) {
    if (room.wave > 0) {
      const bonus = 3 * room.wave;
      const st = statsOf(pl.c.acc); st.stars += bonus; room.starsRun += bonus; sendProfile(pl.c); saveSoon();
      broadcast(room, { t: 'wave', wave: room.wave, cleared: true, bonus });
    }
    room.breakT = t + 6;
  }
  if (room.breakT && t > room.breakT) {
    room.breakT = 0; room.wave++;
    room.toSpawn = world.zombieWave(room.wave).count; room.spawnT = t;
    broadcast(room, { t: 'wave', wave: room.wave, count: room.toSpawn });
  }
  if (room.toSpawn > 0 && t > room.spawnT && alive < 14) { spawnZombie(room, room.wave); room.toSpawn--; room.spawnT = t + 0.7; }
  // the way to the player (a flow field over the map)
  if (t > room.navT) { buildNav(room, pl.x, pl.z); room.navT = t + 0.4; }
  const W = world.W, nav = room.nav;
  const zs = [...room.zombies.values()];
  for (const z of zs) {
    if (z.dead) continue;
    const dx = pl.x - z.x, dz = pl.z - z.z;
    const d = Math.hypot(dx, dz);
    let gx = dx, gz = dz;
    const fx = Math.floor(z.x), fz = Math.floor(z.z), ci = fz * W + fx;
    if (d > 2.2 && nav && nav[ci] > 0) {
      // step towards the neighbour cell that is closer to the player
      let bx = 0, bz = 0, bd = nav[ci];
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = fx + ox, nz = fz + oz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= world.D) continue;
        const v = nav[nz * W + nx];
        if (v < 0 || v >= bd) continue;
        if (ox && oz && (nav[fz * W + nx] < 0 || nav[nz * W + fx] < 0)) continue;
        bd = v; bx = nx + 0.5 - z.x; bz = nz + 0.5 - z.z;
      }
      if (bx || bz) { gx = bx; gz = bz; }
    }
    // keep a little distance from other zombies
    for (const o of zs) {
      if (o === z || o.dead) continue;
      const ox = z.x - o.x, oz = z.z - o.z, od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 0.001) { gx += ox / od * (1.1 - od) * 2; gz += oz / od * (1.1 - od) * 2; }
    }
    const gl = Math.hypot(gx, gz) || 1;
    const slow = z.burnUntil > t ? 0.8 : 1;
    let vx = gx / gl * z.speed * slow + z.kx, vz = gz / gl * z.speed * slow + z.kz;
    z.kx *= 0.85; z.kz *= 0.85;
    if (d < 1.25) { vx = z.kx; vz = z.kz; }
    const step = (nx, nz) => {
      if (!world.boxBlocked(nx, z.y, nz)) return true;
      if (!world.boxBlocked(nx, z.y + 1.01, nz) && !world.boxBlocked(z.x, z.y + 1.01, z.z)) { z.y = Math.floor(z.y + 1.01); return true; }
      return false;
    };
    const nx = z.x + vx * dt; if (step(nx, z.z)) z.x = nx;
    const nz = z.z + vz * dt; if (step(z.x, nz)) z.z = nz;
    z.y = Math.min(z.y, world.groundBelow(z.x, z.y + 0.2, z.z));
    if (d > 0.01) z.yaw = Math.atan2(-dx, -dz);
    // bite
    if (d < 1.6 && Math.abs(pl.y - z.y) < 1.6 && !pl.dead && t > z.atkT) {
      z.atkT = t + 1.0;
      damage(room, pl, z, z.dmg, 'zombie', [woundFor(pl, [z.x, z.y + 1, z.z], 1)], [[r3(pl.x), r3(pl.y + 1), r3(pl.z)]]);
    }
  }
}

// ═════════════════════════ DEVELOPER COMMANDS (F9, only WoozyWaztern) ═════════════════════════
const RANK_NAMES = ['dot', 'blade', 'wave', 'shield', 'star', 'fortress', 'sigil', 'vortex', 'eigen'];
const DEV_HELP = [
  'help                     this list',
  'stars <n> | stars +<n>   set / add stars',
  'stars 1m / 2b / 1t / 1e30 / googol   huge amounts work too',
  'elo <n> | elo +<n>       set / add ELO (EIGEN I 15000 · III 20000)',
  'rank <name> [1-3]        dot blade wave shield star fortress sigil vortex eigen',
  'give <item|all>          ak47 pistol hknife bat molotov medkit',
  'take <item|all>          remove from inventory',
  'god                      infinite health (on/off)',
  'ammo                     infinite ammo, molotovs, medkits (on/off)',
  'speed <x>                run speed multiplier (1 = normal)',
  'jump <x>                 jump height multiplier',
  'fly                      fly: Space up, Ctrl down (on/off)',
  'onehit                   every hit kills (on/off)',
  'heal                     full health, fire off',
  'tp <x> <z>               teleport (map 0..48)',
  'time <sec>               time left in the match',
  'end                      end the match now',
  'wave <n>                 ZOMBIES: jump to wave n',
  'spawn <n>                ZOMBIES: spawn n zombies',
  'killall                  kill every zombie',
  'set <stat> <n>           kills deaths wins matches bestWave',
  'resetstats               zero kills/deaths/wins/matches/ELO',
  'flags                    show what is on',
  'clear                    clear this panel',
];
// "5000", "1.5m", "2b", "1t", "3qa", "1e100", "googol" → number
const NUM_SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, dc: 1e33 };
function bigNum(v) {
  v = String(v || '').trim().toLowerCase().replace(/[\s_]/g, '');
  if (v === 'googol' || v === '+googol') return 1e100;
  const m = v.match(/^([+-]?[\d.]+(?:e[+-]?\d+)?)([a-z]*)$/);
  if (!m) return NaN;
  const mul = m[2] ? NUM_SUFFIX[m[2]] : 1;
  return mul ? Number(m[1]) * mul : NaN;
}
const fmtBig = n => n >= 1e15 ? n.toExponential(2) : Math.floor(n).toLocaleString('en-US');
function devReply(c, text, ok = true) { send(c.ws, { t: 'devlog', text, ok }); }
function onDev(c, m) {
  if (!c.acc || c.name.toLowerCase() !== DEV_NAME) return send(c.ws, { t: 'devlog', text: 'access denied', ok: false });
  const dev = c.dev || (c.dev = { god: false, ammo: false, speed: 1, jump: 1, fly: false, onehit: false });
  const parts = String(m.cmd || '').trim().split(/\s+/).filter(Boolean);
  const cmd = (parts[0] || '').toLowerCase(), a1 = parts[1], a2 = parts[2];
  const st = statsOf(c.acc), p = c.player, room = p && p.room;
  const num = v => Number(v);
  const pushFlags = () => send(c.ws, { t: 'devset', dev });
  const toggle = (k, label) => { dev[k] = a1 === 'on' ? true : a1 === 'off' ? false : !dev[k]; pushFlags(); devReply(c, `${label}: ${dev[k] ? 'ON' : 'OFF'}`); };
  switch (cmd) {
    case 'help': case '?': for (const l of DEV_HELP) devReply(c, l); return;
    case 'stars': {
      const v = bigNum(a1);
      if (!a1 || !Number.isFinite(v)) return devReply(c, 'usage: stars 500 · stars +500 · stars 1m · stars 2b · stars 1t · stars 1e30 · stars googol', false);
      st.stars = Math.max(0, Math.floor(/^[+-]/.test(a1) ? st.stars + v : v));
      if (!Number.isFinite(st.stars)) st.stars = 1e300;
      saveSoon(); sendProfile(c); return devReply(c, `stars = ${fmtBig(st.stars)}`);
    }
    case 'elo': case 'rp': {
      const v = bigNum(a1);
      if (!Number.isFinite(v)) return devReply(c, 'usage: elo 15000  or  elo +500', false);
      st.rp = Math.max(0, Math.floor(/^[+-]/.test(a1) ? st.rp + v : v)); saveSoon(); sendProfile(c); return devReply(c, `ELO = ${fmtBig(st.rp)}`);
    }
    case 'rank': {
      const i = RANK_NAMES.indexOf(String(a1 || '').toLowerCase());
      if (i < 0) return devReply(c, 'usage: rank star 2   (dot blade wave shield star fortress sigil vortex eigen + 1/2/3)', false);
      const div = Math.max(1, Math.min(3, num(a2) || 1)) - 1;
      st.rp = world.rankStart(i, div); saveSoon(); sendProfile(c);
      return devReply(c, `rank ${a1.toUpperCase()} ${['I', 'II', 'III'][div]} · ELO = ${st.rp}`);
    }
    case 'give': case 'take': {
      const ids = a1 === 'all' ? world.ITEMS.filter(i => !i.starter).map(i => i.id) : [a1];
      const bad = ids.filter(id => !world.ITEMS.find(i => i.id === id && !i.starter));
      if (!a1 || bad.length) return devReply(c, 'items: ak47 pistol hknife bat molotov medkit all', false);
      for (const id of ids) {
        if (cmd === 'give' && !st.inv.includes(id)) st.inv.push(id);
        if (cmd === 'take') { st.inv = st.inv.filter(x => x !== id); for (const k of Object.keys(st.loadout)) if (st.loadout[k] === id) st.loadout[k] = world.DEFAULT_LOADOUT[k]; }
      }
      saveSoon(); sendProfile(c); return devReply(c, `${cmd === 'give' ? 'given' : 'taken'}: ${ids.join(', ')}  (equip in INVENTORY, new loadout works from the next match)`);
    }
    case 'god': return toggle('god', 'god mode');
    case 'ammo': return toggle('ammo', 'infinite ammo');
    case 'fly': return toggle('fly', 'fly');
    case 'onehit': return toggle('onehit', 'one-hit kills');
    case 'speed': case 'jump': {
      const v = num(a1);
      if (!Number.isFinite(v) || v <= 0 || v > 20) return devReply(c, `usage: ${cmd} 2   (0.1 … 20)`, false);
      dev[cmd] = v; pushFlags(); return devReply(c, `${cmd} x${v}`);
    }
    case 'flags': return devReply(c, `god ${dev.god ? 'ON' : 'off'} · ammo ${dev.ammo ? 'ON' : 'off'} · fly ${dev.fly ? 'ON' : 'off'} · onehit ${dev.onehit ? 'ON' : 'off'} · speed x${dev.speed} · jump x${dev.jump}`);
    case 'set': {
      const keys = ['kills', 'deaths', 'wins', 'matches', 'bestWave'];
      const k = keys.find(x => x.toLowerCase() === String(a1 || '').toLowerCase());
      if (!k || !Number.isFinite(num(a2))) return devReply(c, 'usage: set kills 100   (kills deaths wins matches bestWave)', false);
      st[k] = Math.max(0, num(a2) | 0); saveSoon(); sendProfile(c); return devReply(c, `${k} = ${st[k]}`);
    }
    case 'resetstats': Object.assign(st, { kills: 0, deaths: 0, wins: 0, matches: 0, rp: 0, history: [] }); saveSoon(); sendProfile(c); return devReply(c, 'stats reset');
  }
  // in-match commands
  if (!p) return devReply(c, cmd ? `unknown or match-only command: ${cmd}  (type help)` : 'type help', false);
  switch (cmd) {
    case 'heal': p.hp = world.MAX_HP; p.burnUntil = 0; broadcast(room, { t: 'heal', id: p.id, hp: p.hp }); return devReply(c, 'healed');
    case 'tp': {
      const x = num(a1), z = num(a2);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return devReply(c, 'usage: tp 24 30', false);
      send(c.ws, { t: 'devtp', x: Math.max(1, Math.min(47, x)), z: Math.max(1, Math.min(47, z)) }); return devReply(c, `teleported to ${x} ${z}`);
    }
    case 'time': if (!Number.isFinite(num(a1))) return devReply(c, 'usage: time 30', false);
      room.match.ends = now() + Math.max(1, num(a1)); broadcast(room, matchInfo(room)); return devReply(c, `time left ${num(a1)} s`);
    case 'end': if (room.mode === 'zombie') damage(room, p, null, 9999, 'dev', [], []); else endMatch(room); return devReply(c, 'match ended');
    case 'wave': if (room.mode !== 'zombie' || !Number.isFinite(num(a1))) return devReply(c, 'only in ZOMBIES: wave 10', false);
      for (const z of room.zombies.values()) broadcast(room, { t: 'leave', id: z.id });
      room.zombies.clear(); room.wave = Math.max(0, (num(a1) | 0) - 1); room.toSpawn = 0; room.breakT = now() + 0.5;
      return devReply(c, `wave ${num(a1)} starts`);
    case 'spawn': {
      if (room.mode !== 'zombie') return devReply(c, 'only in ZOMBIES', false);
      const n = Math.max(1, Math.min(30, num(a1) || 1));
      for (let i = 0; i < n; i++) spawnZombie(room, Math.max(1, room.wave));
      return devReply(c, `spawned ${n}`);
    }
    case 'killall': { let n = 0; for (const z of room.zombies.values()) if (!z.dead) { damage(room, z, p, 99999, 'dev', [], []); n++; } return devReply(c, `killed ${n}`); }
  }
  devReply(c, `unknown command: ${cmd}  (type help)`, false);
}

// ═════════════════════════ CONNECTIONS ═════════════════════════
attach(server, '/ws', ws => {
  const c = { ws, name: null, player: null };
  clients.add(c);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'auth') {
      if (!ready) return send(ws, { t: 'auth', ok: false, msg: 'server is starting — try again in a few seconds' });
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
        saveSoon(); created = true;
      }
      c.name = accounts[key].name; c.acc = accounts[key];
      return send(ws, { t: 'auth', ok: true, name: c.name, created, stats: statsOf(c.acc), lan: lanAddrs(), dev: key === DEV_NAME });
    }
    if (!c.name) return;

    if (m.t === 'buy') return onBuy(c, m);
    if (m.t === 'equip' || m.t === 'unequip') return onEquip(c, m);
    if (m.t === 'dev') return onDev(c, m);
    if (['social', 'viewProfile', 'search', 'friendAdd', 'friendAccept', 'friendDecline', 'friendRemove'].includes(m.t)) return onSocial(c, m);
    if (m.t === 'join') return joinGame(c, m.mode);
    if (m.t === 'leave') return leaveGame(c);
    const p = c.player;
    if (!p) return;

    switch (m.t) {
      case 'st': {
        if (p.dead) break;
        const { x, y, z, yaw, pitch, w } = m;
        if ([x, y, z, yaw, pitch].every(Number.isFinite)) {
          p.x = Math.max(0, Math.min(world.W, x)); p.y = Math.max(0, Math.min(world.H + 6, y));
          p.z = Math.max(0, Math.min(world.D, z)); p.yaw = yaw; p.pitch = pitch;
        }
        if (Number.isInteger(w) && owns(p, w)) p.w = w;
        p.fl = m.fl === 0 ? 0 : 1;
        break;
      }
      case 'shoot': onShoot(p, m); break;
      case 'knife': onKnife(p, m); break;
      case 'drink': onDrink(p); break;
      case 'fire': onFire(p, m); break;
      case 'melee': onMelee(p, m); break;
      case 'throw': onThrow(p, m); break;
      case 'medkit': onMedkit(p); break;
      case 'chat': {
        const t = now();
        if (t - p.lastChat < 0.35) break;
        p.lastChat = t;
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
        if (text) broadcast(p.room, { t: 'chat', id: p.id, name: p.name, text });
        break;
      }
    }
  });
  ws.on('close', () => { leaveGame(c); clients.delete(c); });
});

// ───────────── tick: snapshots, respawns, modes ─────────────
let lastTick = now();
setInterval(() => {
  const t = now(), dt = Math.min(0.1, t - lastTick); lastTick = t;
  for (const room of rooms.values()) {
    if (!room.players.size) continue;
    for (const p of room.players.values()) {
      if (p.dead && t > p.deadUntil && room.mode !== 'zombie') {
        spawn(room, p);
        broadcast(room, { t: 'respawn', id: p.id, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw) });
      }
    }
    fireTick(room, t);
    if (room.mode === 'cap') captureTick(room, t);
    if (room.mode === 'zombie') zombieTick(room, t, dt);
    if (room.match.phase === 'play' && t > room.match.ends) endMatch(room);
    else if (room.match.phase === 'results' && t > room.match.ends) startMatch(room);
    const snap = { t: 's', p: allTargets(room).map(p =>
      [p.id, r3(p.x), r3(p.y), r3(p.z), r3(p.yaw), r3(p.pitch), p.w, p.hp, p.dead ? 1 : 0, p.burnUntil > t ? 1 : 0, p.team, p.zombie ? 1 : 0, p.fl === 0 ? 0 : 1]) };
    if (room.mode === 'cap' && room.sigma.state === 'carried') snap.sg = [r3(room.sigma.x), r3(room.sigma.y), r3(room.sigma.z)];
    broadcast(room, snap);
  }
}, 50);

setInterval(() => {
  let ingame = 0; for (const r of rooms.values()) ingame += r.players.size;
  const msg = JSON.stringify({ t: 'online', n: clients.size, ingame });
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(msg);
}, 1500);

server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║          E I G E N Y T H             ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log(`  you:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  friend:   http://${a.address}:${PORT}   (same Wi-Fi / LAN)`);
  console.log('');
});
loadAccounts();
