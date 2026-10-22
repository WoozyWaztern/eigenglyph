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
let dbStatus = useDb ? 'connecting' : 'off (file data/accounts.json)';
// put the database accounts into memory; existing objects are updated in place (online players keep theirs)
function mergeFromDb(flat) {
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const obj = JSON.parse(flat[i + 1]);
      if (accounts[flat[i]]) Object.assign(accounts[flat[i]], obj); else accounts[flat[i]] = obj;
      savedJson.set(flat[i], flat[i + 1]);
    } catch {}
  }
}
async function loadAccounts() {
  try { accounts = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8')); } catch { accounts = {}; }
  if (!useDb) { ready = true; console.log(`  accounts: ${Object.keys(accounts).length} (file data/accounts.json — set UPSTASH_REDIS_REST_URL/TOKEN to keep them on render.com)`); return; }
  if (!/^https:\/\//.test(DB_URL)) console.log('  !!! UPSTASH_REDIS_REST_URL must be the REST URL that starts with https:// (not redis:// or rediss://)');
  for (let attempt = 1; ; attempt++) {
    try {
      mergeFromDb(await redis(['HGETALL', DB_KEY]) || []);
      ready = true; dbStatus = 'ok';
      console.log(`  accounts: ${Object.keys(accounts).length} (Upstash Redis database)`);
      saveSoon();
      return;
    } catch (e) {
      dbStatus = 'error: ' + e.message;
      console.log(`  database not reachable (${e.message}) — retry ${attempt}…`);
      // never lock the game: after a few tries players can log in anyway, the database is retried in the background
      if (attempt === 3 && !ready) { ready = true; console.log('  !!! starting WITHOUT the database — check UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN on render.com'); }
      await new Promise(r => setTimeout(r, attempt < 3 ? 2000 : 30000));
    }
  }
}
let saving = false, saveAgain = false;
async function saveAccounts() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ACC_FILE, JSON.stringify(accounts)); } catch {}
  if (!useDb || !ready || dbStatus !== 'ok') return;
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
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, ready, database: dbStatus, accounts: Object.keys(accounts).length, version: '2.2' })); }
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
  if (!s.v16) { s.v16 = 1; if (!s.loadout.secondary) s.loadout.secondary = 'pistol'; }   // v1.6: the pistol is a starter item
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


// ═════════════════════════ PARTY: up to 4 players start matches together ═════════════════════════
const PARTY_MAX = 4;
const partyBy = new Map();                 // account key → party { leader, members: [keys] }
const invites = new Map();                 // invited key → Map(from key → time)
const keyOf = c => (c && c.acc && c.name ? c.name.toLowerCase() : null);
function partyState(key) {
  const pa = partyBy.get(key), inv = invites.get(key);
  const card = k => {
    const a = accounts[k], oc = onlineConn(k);
    return { name: a ? a.name : k, rp: a ? statsOf(a).rp : 0, leader: !!(pa && pa.leader === k), online: !!oc,
      ingame: oc && oc.player ? oc.player.room.mode : null };
  };
  return { t: 'party', members: pa ? pa.members.map(card) : [], leader: pa ? (accounts[pa.leader] || {}).name : null,
    invites: inv ? [...inv.keys()].filter(k => onlineConn(k)).map(k => (accounts[k] || {}).name || k) : [] };
}
function pushParty(key) { const c = onlineConn(key); if (c) send(c.ws, partyState(key)); }
function pushPartyAll(pa) { for (const k of pa.members) pushParty(k); }
function leaveParty(key, why) {
  const pa = partyBy.get(key);
  if (!pa) return;
  pa.members = pa.members.filter(k => k !== key);
  partyBy.delete(key);
  if (pa.leader === key) pa.leader = pa.members[0];
  if (pa.members.length <= 1) { for (const k of pa.members) partyBy.delete(k); }
  for (const k of pa.members) { const oc = onlineConn(k); if (oc && why) send(oc.ws, { t: 'notice', text: why, ok: false }); pushParty(k); }
  pushParty(key);
}
function dropInvitesOf(key) {
  invites.delete(key);
  for (const [to, m] of invites) if (m.delete(key)) pushParty(to);
}
function onParty(c, m) {
  const me = keyOf(c), reply = (text, ok = true) => send(c.ws, { t: 'notice', text, ok });
  const other = String(m.name || '').trim().toLowerCase();
  switch (m.t) {
    case 'party': return send(c.ws, partyState(me));
    case 'pinvite': {
      if (!accounts[other]) return reply('player not found', false);
      if (other === me) return reply("you can't invite yourself", false);
      const oc = onlineConn(other);
      if (!oc) return reply(`${accounts[other].name} is not online`, false);
      let pa = partyBy.get(me);
      if (pa && pa.members.includes(other)) return reply(`${accounts[other].name} is already in your party`, false);
      if (pa && pa.members.length >= PARTY_MAX) return reply('the party is full (4 players)', false);
      if (!invites.has(other)) invites.set(other, new Map());
      invites.get(other).set(me, Date.now());
      send(oc.ws, { t: 'pinvited', from: c.name });
      pushParty(other);
      return reply(`invite sent to ${accounts[other].name}`);
    }
    case 'paccept': {
      const inv = invites.get(me);
      if (!inv || !inv.has(other)) return reply('this invite is no longer valid', false);
      inv.delete(other);
      const host = onlineConn(other);
      if (!host) { pushParty(me); return reply('the player who invited you went offline', false); }
      let pa = partyBy.get(other);
      if (!pa) { pa = { leader: other, members: [other] }; partyBy.set(other, pa); }
      if (pa.members.length >= PARTY_MAX) { pushParty(me); return reply('the party is full', false); }
      if (partyBy.get(me) && partyBy.get(me) !== pa) leaveParty(me, `${c.name} left the party`);
      pa.members.push(me); partyBy.set(me, pa);
      for (const k of pa.members) if (k !== me) { const oc = onlineConn(k); if (oc) send(oc.ws, { t: 'notice', text: `${c.name} joined the party`, ok: true }); }
      pushPartyAll(pa);
      return reply(`you joined ${accounts[pa.leader].name}'s party · the leader starts the matches`);
    }
    case 'pdecline': {
      const inv = invites.get(me); if (inv) inv.delete(other);
      const oc = onlineConn(other); if (oc) send(oc.ws, { t: 'notice', text: `${c.name} declined the invite`, ok: false });
      return pushParty(me);
    }
    case 'pleave': leaveParty(me, `${c.name} left the party`); return reply('you left the party');
    case 'pkick': {
      const pa = partyBy.get(me);
      if (!pa || pa.leader !== me || !pa.members.includes(other) || other === me) return;
      const oc = onlineConn(other); if (oc) send(oc.ws, { t: 'notice', text: 'you were removed from the party', ok: false });
      leaveParty(other, null);
      return reply(`${accounts[other].name} removed from the party`);
    }
  }
}

// ═════════════════════════ ROOMS + MATCHES ═════════════════════════
function newRoom(id, mode) {
  const room = { id, mode, map: 'arena', info: world.MODE_INFO[mode], players: new Map(), zombies: new Map(),
    match: { phase: 'idle', ends: 0 }, fires: [], pending: [],
    sigma: { state: 'home', x: world.SIGMA_HOME[0], y: world.SIGMA_HOME[1], z: world.SIGMA_HOME[2], carrier: 0, back: 0 },
    score: [0, 0], wave: 0, toSpawn: 0, spawnT: 0, breakT: 0, nav: null, navT: 0, zkills: 0, starsRun: 0 };
  rooms.set(id, room);
  return room;
}
function roomFor(c, mode) {
  if (mode === 'zombie') return newRoom('z' + (nextId++), mode);        // solo: a private room for every run
  // up to 10 players per room; when every room of that mode is full a new one opens
  for (const r of rooms.values()) if (r.mode === mode && r.players.size < (r.info.max || 10)) return r;
  return newRoom(rooms.has(mode) ? mode + (nextId++) : mode, mode);
}
function allTargets(room) { return [...room.players.values(), ...room.zombies.values()]; }
function sys(room, text) { broadcast(room, { t: 'chat', id: 0, name: '', text, sys: true }); }

function matchInfo(room) {
  return { t: 'match', phase: room.match.phase, left: Math.max(0, Math.round(room.match.ends - now())), score: room.score, wave: room.wave, mode: room.mode,
    map: room.map, hideLeft: room.mode === 'hide' ? Math.max(0, Math.round(room.hideEnds - now())) : 0, need: room.mode === 'hide' ? 2 : 0 };
}
function startMatch(room) {
  const t = now();
  if (room.mode === 'hide' && !hideSetup(room, t)) return;
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
  broadcast(room, { t: 'matchstart', left: room.info.time || 0, mode: room.mode, score: room.score, map: room.map });
  if (room.mode === 'hide') for (const p of room.players.values()) sendRole(p);
  if (room.mode === 'cap') broadcast(room, sigmaMsg(room));
}
// a round is over: after the results everyone goes back to the lobby (the next round starts with PLAY)
function backToLobby(room) {
  for (const p of [...room.players.values()]) { if (p.bot) { removeBot(p); continue; } send(p.ws, { t: 'tolobby' }); leaveGame(p.c); }
  room.match.phase = 'idle';
}
// ═════════════════ HIDE & SEEK ═════════════════
// 30 s: hiders hide in the dark (only a flashlight), the seeker waits blind and frozen.
// Then 2 min: the seeker hunts with a pistol (+ a light on it). All found → seeker wins, time runs out → hiders win.
const HIDER_LO = [-1, -1, -1, -1], SEEKER_LO = [-1, world.ITEM_IDX.pistol, -1, -1];
function hideSetup(room, t) {
  const list = [...room.players.values()];
  if (list.length < 2) { room.match.phase = 'wait'; room.match.ends = 0; broadcast(room, matchInfo(room)); return false; }
  room.map = room.forceMap || world.HIDE_MAPS[Math.floor(Math.random() * world.HIDE_MAPS.length)];
  world.setMap(room.map);
  const nSeek = list.length >= 9 ? 3 : list.length >= 5 ? 2 : 1;
  const order = list.slice().sort(() => Math.random() - 0.5);
  for (const p of list) { p.role = 'hider'; p.loadout = HIDER_LO; p.w = -1; p.frozen = false; }
  for (const p of order.slice(0, nSeek)) { p.role = 'seeker'; p.loadout = SEEKER_LO; p.w = world.ITEM_IDX.pistol; }
  room.hideEnds = t + room.info.hideT; room.seekOn = false;
  return true;
}
function sendRole(p) {
  const room = p.room;
  send(p.ws, { t: 'role', role: p.role, loadout: p.loadout, hideLeft: Math.max(0, Math.round((room.hideEnds || 0) - now())),
    seekers: [...room.players.values()].filter(q => q.role === 'seeker').map(q => q.id) });
}
function hideCheck(room) {
  if (room.mode !== 'hide' || room.match.phase !== 'play') return;
  const ps = [...room.players.values()];
  const hiders = ps.filter(p => p.role === 'hider' && !p.dead).length, seekers = ps.filter(p => p.role === 'seeker').length;
  if (!hiders || !seekers) endMatch(room);
}
const rewardFor = place => place === 1 ? 50 : place <= 3 ? 20 : 10;
function endMatch(room) {
  room.match.phase = 'results'; room.match.ends = now() + 10;
  const list = [...room.players.values()];
  const ranked = list.filter(p => !p.bot).length >= 2;          // bots never count for ELO
  let results;
  if (room.mode === 'hide') {
    const hidersLeft = list.filter(p => p.role === 'hider' && !p.dead).length;
    const seekersLeft = list.filter(p => p.role === 'seeker').length;
    const hidersWin = hidersLeft > 0 || !seekersLeft;
    room.hideWinner = hidersWin ? 'hide' : 'seek';
    const won = p => p.role === 'seeker' ? !hidersWin : p.role === 'hider' ? hidersWin && !p.dead : false;
    list.sort((a, b) => won(b) - won(a) || b.kills - a.kills);
    results = list.filter(p => p.role !== 'spectator').map(p => {
      const w = won(p), delta = ranked ? (w ? 50 : -15) : 0, stars = ranked ? (w ? 40 : 10) : 0;
      if (ranked) record(p, w ? 1 : 2, delta, stars);
      return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, place: w ? 1 : 2, rp: delta, stars, role: p.role };
    });
  } else if (room.mode === 'cap') {
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
  broadcast(room, { t: 'matchend', results, ranked, next: 10, mode: room.mode, score: room.score, winner: room.hideWinner || null });
}
function record(p, place, delta, stars) {
  if (p.bot) return;
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
  world.setMap(room.map);
  if (room.mode === 'hide' && p.role === 'seeker') return world.SEEK_SPAWNS[0];
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
  p.burnUntil = 0; p.burnBy = null; p.burnTick = 0; p.lastMed = -99;
}
function joinGame(c, mode, pulledBy) {
  if (!ready) return;
  if (!world.MODE_INFO[mode]) mode = 'dm';
  if (c.player) leaveGame(c);
  // party: go where a party member already plays this mode (also the same ZOMBIES run)
  const pa = partyBy.get(keyOf(c));
  let room = null, mate = null;
  if (pa) for (const k of pa.members) {
    const oc = onlineConn(k);
    if (oc && oc !== c && oc.player && oc.player.room.mode === mode && rooms.has(oc.player.room.id)) { room = oc.player.room; mate = oc.player; break; }
  }
  if (!room) room = roomFor(c, mode);
  world.setMap(room.map);
  const loadout = world.loadoutOf(statsOf(c.acc));
  const first = loadout.find(i => i >= 0);
  const p = { id: nextId++, name: c.name, ws: c.ws, c, room, kills: 0, deaths: 0, team: -1, loadout,
    w: first === undefined ? -1 : first, fl: 1,
    lastShot: 0, lastKnife: 0, lastDrink: -99, lastChat: 0, lastFire: {}, lastMelee: 0, lastMed: -99, lastThrow: 0 };
  if (room.mode === 'cap') {
    const n = [0, 0]; for (const q of room.players.values()) n[q.team]++;
    p.team = mate && mate.team >= 0 ? mate.team : n[0] <= n[1] ? 0 : 1;   // party members play in one team
  }
  if (room.mode === 'hide') { p.role = room.match.phase === 'play' ? 'spectator' : 'hider'; p.loadout = [-1, -1, -1, -1]; p.w = -1; }
  spawn(room, p);
  if (p.role === 'spectator') { p.dead = true; p.hp = 0; }                // the round is running: watch, play the next one
  c.player = p;
  room.players.set(p.id, p);
  send(c.ws, { t: 'welcome', id: p.id, you: pubPlayer(p), mode: room.mode, map: room.map, loadout: p.loadout,
    players: allTargets(room).map(pubPlayer), fires: room.fires.map(f => fireMsg(f)), score: room.score, wave: room.wave,
    sigma: room.mode === 'cap' ? sigmaMsg(room) : null, dev: isDevConn(c) && c.dev ? c.dev : null });
  broadcast(room, { t: 'join', p: pubPlayer(p) }, c.ws);
  if (!room.info.solo || room.players.size > 1) sys(room, `${p.name} entered the void${p.team >= 0 ? ' · team ' + world.TEAM_NAME[p.team] : ''}`);
  if (room.match.phase === 'idle' || (room.match.phase === 'wait' && room.players.size >= 2)) startMatch(room);
  else { send(c.ws, matchInfo(room)); if (room.mode === 'hide') { sendRole(p); if (room.match.phase === 'wait') broadcast(room, matchInfo(room)); } }
  if (pulledBy) send(c.ws, { t: 'notice', text: `${pulledBy} started ${room.info.name} for the party`, ok: true });
  // the party leader pulls everyone who waits in the lobby into the same match
  if (pa && pa.leader === keyOf(c) && !pulledBy) {
    for (const k of pa.members) { const oc = onlineConn(k); if (oc && oc !== c && !oc.player) joinGame(oc, mode, c.name); }
  }
  if (pa) pushPartyAll(pa);
}
function leaveGame(c) {
  const p = c.player;
  if (!p) return;
  const room = p.room;
  if (room.mode === 'cap' && room.sigma.carrier === p.id) dropSigma(room, p);
  room.players.delete(p.id);
  c.player = null;
  broadcast(room, { t: 'leave', id: p.id });
  if (!room.info.solo || room.players.size) sys(room, `${p.name} left`);
  const pa = partyBy.get(keyOf(c)); if (pa) setTimeout(() => pushPartyAll(pa), 0);
  if (!room.players.size) { if (room.info.solo || room.id !== room.mode) rooms.delete(room.id); else { room.match.phase = 'idle'; room.zombies.clear(); } }
  else if (room.mode === 'hide') hideCheck(room);
  if (room.players.size && [...room.players.values()].every(q => q.bot)) {      // nobody real left: bots go too
    for (const q of [...room.players.values()]) removeBot(q);
    if (room.info.solo || room.id !== room.mode) rooms.delete(room.id); else { room.match.phase = 'idle'; room.zombies.clear(); }
  }
}
const owns = (p, idx) => p.loadout.includes(idx);

// ───────────── damage ─────────────
function canHurt(room, a, t) {
  if (!a || !t || a === t) return false;
  if (room.mode === 'cap' && !a.zombie && !t.zombie && a.team === t.team) return false;   // no friendly fire
  if (room.mode === 'zombie' && !a.zombie && !t.zombie) return false;
  if (room.mode === 'hide') return a.role === 'seeker' && t.role === 'hider' && now() > room.hideEnds;   // only the seeker hurts, only after the hiding time
  return true;
}
// attacker may be null (e.g. the thrower of a molotov left the match)
function damage(room, target, attacker, dmg, weapon, wounds, pts) {
  if (target.dead || room.match.phase !== 'play') return;
  if (attacker && !attacker.zombie && !room.players.has(attacker.id)) attacker = null;
  if (attacker && !canHurt(room, attacker, target)) return;
  if (target.c && devOf(target.c).god && weapon !== 'dev') dmg = 0;   // dev: god mode
  if (attacker && attacker.c && devOf(attacker.c).onehit) dmg = 9999;
  if (room.mode === 'hide' && target.role === 'hider' && weapon !== 'dev') dmg *= 2;   // 3 pistol hits find a hider
  target.hp = Math.max(0, target.hp - dmg);
  if (dmg > 0) target.lastHurt = now();
  for (const w of wounds) { target.wounds.push(w); if (target.wounds.length > 28) target.wounds.shift(); }
  broadcast(room, { t: 'hit', id: target.id, by: attacker ? attacker.id : 0, dmg, hp: target.hp, w: weapon, wounds, pts });
  if (target.hp > 0) return;
  target.dead = true; target.deadUntil = now() + 3.5; target.burnUntil = 0;
  target.deaths = (target.deaths || 0) + 1;
  if (target.zombie) return zombieDied(room, target, attacker, weapon);
  if (room.mode === 'cap' && room.sigma.carrier === target.id) dropSigma(room, target);
  const pvp = room.mode !== 'zombie' && !target.bot && !(attacker && attacker.bot);   // bot fights never touch real stats
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
  if (room.mode === 'zombie') zombiePlayerDown(room, target);
  if (room.mode === 'hide') { if (target.role === 'hider') sys(room, `${target.name} was found${attacker ? ' by ' + attacker.name : ''}`); hideCheck(room); }
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
// a teammate right in front of you (CAPTURE: own team · ZOMBIES: every player) gets the heal instead of you
function allyInFront(p, d) {
  const room = p.room;
  if (!d || !(room.mode === 'cap' || room.mode === 'zombie')) return null;
  const o = [p.x, p.y + world.EYE, p.z];
  let best = null, bt = 3.4;
  for (const q of room.players.values()) {
    if (q === p || q.dead || (room.mode === 'cap' && q.team !== p.team)) continue;
    const tt = world.raySphere(o[0], o[1], o[2], d[0], d[1], d[2], q.x, q.y + world.BODY_CY, q.z, world.BODY_R + 0.25);
    if (tt > 0 && tt < bt) { bt = tt; best = q; }
  }
  return best;
}
function healTarget(p, m, amount, w) {
  const tg = allyInFront(p, norm(m && m.d)) || p;
  tg.hp = Math.min(world.MAX_HP, tg.hp + amount);
  if (w === world.ITEM_IDX.medkit) tg.burnUntil = 0;
  broadcast(p.room, { t: 'heal', id: tg.id, hp: tg.hp, w, by: tg === p ? 0 : p.id });
}
function onDrink(p, m) {
  const t = now();
  if (p.dead || !owns(p, 2) || t - p.lastDrink < world.WEAPONS.soda.cooldown - 0.3) return;
  p.lastDrink = t;
  healTarget(p, m, world.WEAPONS.soda.heal, 2);
}
function onFire(p, m) {
  const t = now(), w = m.w | 0, it = world.ITEMS[w], room = p.room;
  if (p.dead || !it || it.kind !== 'gun' || !owns(p, w)) return;
  if (p.room.mode === 'hide' && t < p.room.hideEnds) return;
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
  const t = now(), w = world.ITEM_IDX.molotov, room = p.room, dev = devOf(p.c);
  // unlimited bottles, one every 10 s (dev ammo: one per second)
  const cd = dev.ammo ? 1 : world.WEAPONS.molotov.cooldown;
  if (p.dead || !owns(p, w) || t - p.lastThrow < cd - 0.3) return;
  const d = norm(m.d); if (!d) return;
  p.lastThrow = t;
  const { o, v } = world.throwStart(p.x, p.y, p.z, d);
  const path = world.throwPath(o, v, (x, y, z) => {
    for (const q of allTargets(room)) if (q !== p && !q.dead && canHurt(room, p, q) && Math.hypot(x - q.x, y - (q.y + world.BODY_CY), z - q.z) < world.BODY_R + 0.1) return q;
    return null;
  });
  broadcast(room, { t: 'throw', id: p.id, o: o.map(r3), v: v.map(r3), cd });
  room.pending.push({ at: t + path.t, x: path.x, y: path.y, z: path.z, hit: path.hit, by: p, vx: v[0], vz: v[2] });
}
function burn(room, target, by) {
  if (target === by || target.dead || room.match.phase !== 'play') return;
  if (by && !canHurt(room, by, target)) return;
  const was = target.burnUntil > now();
  target.burnUntil = now() + world.WEAPONS.molotov.burnT;
  target.burnBy = by;
  if (!was) target.burnTick = now() + 0.15;
}
function onMedkit(p, m) {
  const t = now(), W = world.WEAPONS.medkit, dev = devOf(p.c);
  if (p.dead || !owns(p, world.ITEM_IDX.medkit) || (t - p.lastMed < W.cooldown - 0.5 && !dev.ammo)) return;
  p.lastMed = t;
  healTarget(p, m, W.heal, world.ITEM_IDX.medkit);
}
function fireTick(room, t) {
  for (let i = room.pending.length - 1; i >= 0; i--) {
    const q = room.pending[i];
    if (t < q.at) continue;
    room.pending.splice(i, 1);
    if (q.patch) {           // a splash of burning liquid lands
      const f = { x: q.x, y: q.y, z: q.z, r: q.r, until: now() + q.life, by: q.by };
      room.fires.push(f); broadcast(room, { ...fireMsg(f), patch: 1 });
      continue;
    }
    // the bottle shatters: a pool where it hit + burning liquid splashed forward and to the sides
    const W = world.WEAPONS.molotov, y0 = q.hit ? q.hit.y : q.y;
    const f = { x: q.x, y: y0, z: q.z, r: 1.15, until: now() + W.fireT, by: q.by };
    room.fires.push(f);
    let dl = Math.hypot(q.vx || 0, q.vz || 0) || 1;
    const dx = (q.vx || 1) / dl, dz = (q.vz || 0) / dl;
    broadcast(room, { ...fireMsg(f), main: 1, dx: r3(dx), dz: r3(dz) });
    if (q.hit && !q.hit.dead) burn(room, q.hit, q.by);
    const n = 9 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const ang = (Math.random() - 0.5) * (k < 5 ? 1.2 : 4.2);            // most splashes fly on in the throw direction
      const dist = (k < 5 ? 1.3 : 0.9) + Math.random() * (k < 5 ? 2.6 : 1.6);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const px = q.x + (dx * ca - dz * sa) * dist, pz = q.z + (dx * sa + dz * ca) * dist;
      if (px < 0.5 || pz < 0.5 || px > world.W - 0.5 || pz > world.D - 0.5) continue;
      const gy = world.groundBelow(px, y0 + 1.1, pz);
      if (Math.abs(gy - y0) > 1.05 || world.solid(Math.floor(px), Math.floor(gy), Math.floor(pz))) continue;   // a wall stops the splash
      room.pending.push({ patch: 1, at: t + 0.05 + dist * 0.09 + Math.random() * 0.08, x: px, y: gy, z: pz, r: 0.45 + Math.random() * 0.5, life: W.fireT * (0.55 + Math.random() * 0.4), by: q.by });
    }
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

// ═════════════════════════ ZOMBIES (solo or with the party) ═════════════════════════
// walk grid: where a zombie can stand in every column (lowest free spot), -1 = blocked
const STAND = new Int8Array(world.W * world.D);
for (let z = 0; z < world.D; z++) for (let x = 0; x < world.W; x++) {
  let h = -1;
  for (let y = 0; y < 4; y++) if ((y === 0 || world.solid(x, y - 1, z)) && !world.solid(x, y, z) && !world.solid(x, y + 1, z)) { h = y; break; }
  STAND[z * world.W + x] = h;
}
// flow field: distance (in cells) to the NEAREST living player
function buildNav(room, targets) {
  const W = world.W, D = world.D, dist = room.nav || new Int16Array(W * D);
  dist.fill(-1);
  const q = new Int32Array(W * D);
  let h = 0, tl = 0;
  for (const p of targets) {
    const s = Math.max(0, Math.min(D - 1, Math.floor(p.z))) * W + Math.max(0, Math.min(W - 1, Math.floor(p.x)));
    if (dist[s] < 0) { dist[s] = 0; q[tl++] = s; }
  }
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
const livingPlayers = room => [...room.players.values()].filter(p => !p.dead);
function spawnZombie(room, wave) {
  const pls = livingPlayers(room);
  const Z = world.zombieWave(wave);
  // a few more zombies per wave when several players fight together
  let best = world.SPAWNS[0], bd = -1;
  for (const s of world.SPAWNS) {
    const d = pls.length ? Math.min(...pls.map(pl => Math.hypot(s[0] - pl.x, s[2] - pl.z))) : 20;
    const score = d > 12 ? 100 - Math.abs(d - 20) + Math.random() * 15 : d;
    if (score > bd) { bd = score; best = s; }
  }
  const z = { id: nextId++, name: 'zombie', zombie: true, x: best[0] + (Math.random() - 0.5) * 0.15, y: 0, z: best[2] + (Math.random() - 0.5) * 0.15, yaw: 0, pitch: 0,
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
function zombieGameOver(room, won = false) {
  if (!room.players.size || room.match.phase !== 'play') return;
  room.match.phase = 'results'; room.match.ends = now() + 12;
  const winBonus = won ? 500 : 0;
  for (const p of room.players.values()) {
    const st = statsOf(p.c.acc);
    st.stars += winBonus;
    const best = room.wave > st.bestWave;
    if (best) st.bestWave = room.wave;
    st.history.unshift({ place: room.wave, mode: 'ZOMBIES', k: p.kills, d: 1, rp: 0, wave: room.wave });
    st.history = st.history.slice(0, 8);
    sendProfile(p.c);
    send(p.ws, { t: 'zend', wave: room.wave, kills: room.zkills, stars: room.starsRun + winBonus, best, bestWave: st.bestWave, next: 12, team: room.players.size, won, max: world.ZOMBIE_WAVES });
  }
  saveSoon();
}
// a player went down: the run ends only when nobody is left standing
function zombiePlayerDown(room, p) {
  const left = livingPlayers(room).length;
  if (!left) return zombieGameOver(room);
  sys(room, `${p.name} is down · back when the wave is cleared (${left} still standing)`);
}
function zombieTick(room, t, dt) {
  if (room.match.phase !== 'play' || room.zfrozen) return;
  const pls = livingPlayers(room);
  if (!pls.length) return;
  // waves
  const alive = [...room.zombies.values()].filter(z => !z.dead).length;
  if (room.toSpawn <= 0 && alive === 0 && room.breakT === 0) {
    if (room.wave > 0) {
      const bonus = 3 * room.wave;
      room.starsRun += bonus;
      for (const q of room.players.values()) {
        const st = statsOf(q.c.acc); st.stars += bonus; sendProfile(q.c);
        if (q.dead) {      // fallen teammates come back for the next wave
          spawn(room, q);
          broadcast(room, { t: 'respawn', id: q.id, x: r3(q.x), y: r3(q.y), z: r3(q.z), yaw: r3(q.yaw) });
          sys(room, `${q.name} is back`);
        }
      }
      saveSoon();
      broadcast(room, { t: 'wave', wave: room.wave, cleared: true, bonus });
      if (room.wave >= world.ZOMBIE_WAVES) return zombieGameOver(room, true);   // all waves survived
    }
    room.breakT = t + 6;
  }
  if (room.breakT && t > room.breakT) {
    room.breakT = 0; room.wave++;
    room.toSpawn = Math.round(world.zombieWave(room.wave).count * (1 + (room.players.size - 1) * 0.5)); room.spawnT = t;
    broadcast(room, { t: 'wave', wave: room.wave, count: room.toSpawn });
  }
  if (room.toSpawn > 0 && t > room.spawnT && alive < 14) { spawnZombie(room, room.wave); room.toSpawn--; room.spawnT = t + 0.7; }
  // the way to the player (a flow field over the map)
  if (t > room.navT) { buildNav(room, pls); room.navT = t + 0.4; }
  const W = world.W, nav = room.nav;
  const zs = [...room.zombies.values()];
  for (const z of zs) {
    if (z.dead) continue;
    let pl = pls[0];      // chase the nearest living player
    for (const q of pls) if (Math.hypot(q.x - z.x, q.z - z.z) < Math.hypot(pl.x - z.x, pl.z - z.z)) pl = q;
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
    // keep the round body away from walls and crates (the ball is wider than its feet)
    {
      const by = Math.floor(z.y + 0.1), fx0 = Math.floor(z.x), fz0 = Math.floor(z.z);
      let ax = 0, az = 0;
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oz) continue;
        const cx = fx0 + ox, cz = fz0 + oz;
        if (!world.solid(cx, by + 1, cz)) continue;                  // a 1-block step is fine, only real walls push
        const px = Math.max(cx, Math.min(cx + 1, z.x)), pz = Math.max(cz, Math.min(cz + 1, z.z));   // closest point of that block
        const ddx = z.x - px, ddz = z.z - pz, dd = Math.hypot(ddx, ddz);
        if (dd < 0.78 && dd > 1e-4) { ax += ddx / dd * (0.78 - dd); az += ddz / dd * (0.78 - dd); }
      }
      gx += ax * 4; gz += az * 4;
    }
    // stuck for a moment? slide sideways for a bit
    if (t > (z.chkT || 0)) {
      const moved = Math.hypot(z.x - (z.chkX ?? z.x + 9), z.z - (z.chkZ ?? z.z));
      if (moved < 0.3 && d > 2) { const s = Math.random() < 0.5 ? 1 : -1; z.slideX = -gz * s; z.slideZ = gx * s; z.slideT = t + 0.7; }
      z.chkT = t + 0.8; z.chkX = z.x; z.chkZ = z.z;
    }
    if (z.slideT > t) { const sl = Math.hypot(z.slideX, z.slideZ) || 1, gl0 = Math.hypot(gx, gz) || 1; gx = gx / gl0 + z.slideX / sl * 1.2; gz = gz / gl0 + z.slideZ / sl * 1.2; }
    const gl = Math.hypot(gx, gz) || 1;
    const slow = z.burnUntil > t ? 0.8 : 1;
    let vx = gx / gl * z.speed * slow + z.kx, vz = gz / gl * z.speed * slow + z.kz;
    z.kx *= 0.85; z.kz *= 0.85;
    if (d < 1.25) { vx = z.kx; vz = z.kz; }
    // ── real movement: solid blocks always stop them, a 1-block step is JUMPED onto (gravity, no teleport) ──
    const ZR = 0.45;
    if (world.boxBlocked(z.x, z.y, z.z, ZR)) {
      // stuck inside a block (spawned there, shoved by a bat): pop out to the nearest free spot
      let done = false;
      for (let r = 0.15; r <= 1.2 && !done; r += 0.15) for (let a = 0; a < 8 && !done; a++) {
        const px = z.x + Math.cos(a * Math.PI / 4) * r, pz = z.z + Math.sin(a * Math.PI / 4) * r;
        if (!world.boxBlocked(px, z.y, pz, ZR)) { z.x = px; z.z = pz; done = true; }
      }
      if (!done) z.y = Math.floor(z.y) + 1;
    }
    const onGround = z.y <= world.groundBelow(z.x, z.y + 0.3, z.z) + 0.01;
    let wantJump = false;
    const tryMove = (nx, nz) => {
      if (!world.boxBlocked(nx, z.y, nz, ZR)) return true;
      // a block in the way: if it is only 1 high (free above it), jump onto it
      if (!world.boxBlocked(nx, z.y + 1.05, nz, ZR) && !world.boxBlocked(z.x, z.y + 1.05, z.z, ZR)) wantJump = true;
      return false;
    };
    const mx = z.x + vx * dt; if (tryMove(mx, z.z)) z.x = mx;
    const mz = z.z + vz * dt; if (tryMove(z.x, mz)) z.z = mz;
    if (wantJump && onGround && !(z.vy > 0)) z.vy = 7.4;               // jump up a step (peak ≈ 1.5 blocks)
    z.vy = (z.vy || 0) - 18 * dt;
    let ny = z.y + z.vy * dt;
    if (z.vy > 0 && world.boxBlocked(z.x, ny, z.z, ZR)) { ny = z.y; z.vy = 0; }   // head hits a ceiling
    const gnd = world.groundBelow(z.x, Math.max(ny, z.y) + 0.3, z.z);
    if (ny <= gnd) { ny = gnd; z.vy = 0; }
    z.y = ny;
    if (d > 0.01) z.yaw = Math.atan2(-dx, -dz);
    // bite
    if (d < 1.6 && Math.abs(pl.y - z.y) < 1.6 && !pl.dead && t > z.atkT) {
      z.atkT = t + 1.0;
      damage(room, pl, z, z.dmg, 'zombie', [woundFor(pl, [z.x, z.y + 1, z.z], 1)], [[r3(pl.x), r3(pl.y + 1), r3(pl.z)]]);
    }
  }
}


// ═════════════════════════ BOTS (server-side players: for trailers, practice, filling rooms) ═════════════════════════
// They are ordinary players to everybody else: same body, weapons, damage, kill feed, respawn.
// Brain: pick a target it can SEE → turn toward it at a human speed → fire in bursts with aim error,
// strafe while shooting, keep a fighting distance; no target → walk the map along the nav grid.
const BOT_NAMES = ['Vortex_77', 'kira', 'Morozko', 'Sh4dow', 'Grimm', 'nyx', 'Raptor', 'zer0', 'Lumen', 'Volk', 'Mira', 'Kestrel', 'b1tter', 'Orion', 'Hex'];
const NO_WS = { readyState: 3, send() {} };
let botSkill = 0.7, botWeapon = 'random', botsFrozen = false;
const isBot = p => !!(p && p.bot);
function addBot(room, name) {
  const taken = new Set([...room.players.values()].map(q => q.name));
  name = name || BOT_NAMES.find(n => !taken.has(n)) || 'bot' + nextId;
  const I = world.ITEM_IDX;
  const prim = botWeapon !== 'random' && world.ITEM_IDX[botWeapon] !== undefined ? I[botWeapon] : [I.ak47, I.ak47, I.shotgun].at(Math.floor(Math.random() * 3));
  const sec = [I.deagle, I.pistol, I.makarov].at(Math.floor(Math.random() * 3));
  const acc = { name, stats: { rp: 0, kills: 0, deaths: 0, wins: 0, matches: 0, stars: 0, history: [], inv: [] } };
  const c = { ws: NO_WS, name, acc, bot: true, player: null };
  const p = { id: nextId++, name, ws: NO_WS, c, room, kills: 0, deaths: 0, team: -1, bot: true,
    loadout: [prim, sec, I.knife, -1], w: prim, fl: 1, mags: {},
    lastShot: 0, lastKnife: 0, lastDrink: -99, lastChat: 0, lastFire: {}, lastMelee: 0, lastMed: -99, lastThrow: 0,
    ai: { target: null, seeT: 0, react: 0, strafe: 1, strafeT: 0, goal: null, navT: 0, holder: {}, burst: 0, reloadT: 0, vy: 0, stuckT: 0 } };
  if (room.mode === 'cap') { const n = [0, 0]; for (const q of room.players.values()) if (q.team >= 0) n[q.team]++; p.team = n[0] <= n[1] ? 0 : 1; }
  world.setMap(room.map);
  spawn(room, p);
  c.player = p;
  room.players.set(p.id, p);
  broadcast(room, { t: 'join', p: pubPlayer(p) });
  if (room.match.phase === 'idle') startMatch(room);
  return p;
}
function removeBot(p) {
  const room = p.room;
  room.players.delete(p.id);
  broadcast(room, { t: 'leave', id: p.id });
}
function canSee(room, a, b) {
  const ox = a.x, oy = a.y + world.EYE, oz = a.z, tx = b.x - ox, ty = b.y + world.BODY_CY - oy, tz = b.z - oz, d = Math.hypot(tx, ty, tz);
  if (d < 0.01) return true;
  const w = world.raycast(ox, oy, oz, tx / d, ty / d, tz / d, d, tmp);
  return w < 0 || w > d - 0.6;
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function botTick(room, t, dt) {
  if (room.match.phase !== 'play' || room.mode === 'hide') return;
  for (const p of room.players.values()) {
    if (!p.bot || p.dead || botsFrozen) continue;
    const A = p.ai, W = world.WEAPONS;
    // ── choose a target: the nearest enemy it can see (zombies in ZOMBIES) ──
    if (t > A.seeT) {
      A.seeT = t + 0.25;
      let best = null, bd = 1e9;
      for (const q of allTargets(room)) {
        if (q === p || q.dead || !canHurt(room, p, q) || (q.c && devOf(q.c).invis)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < 45 && d < bd && canSee(room, p, q)) { bd = d; best = q; }
      }
      if (best !== A.target) { A.target = best; A.react = t + 0.25 + Math.random() * 0.35 * (1.3 - botSkill); }
    }
    const tg = A.target && !A.target.dead && room.players.has(A.target.id) || (A.target && room.zombies.has(A.target.id) && !A.target.dead) ? A.target : null;
    // ── where to go ──
    let goal = null;
    if (tg) goal = tg;
    else {
      if (!A.goal || Math.hypot(A.goal[0] - p.x, A.goal[2] - p.z) < 2 || t > A.goalT) { A.goal = world.SPAWNS.at(Math.floor(Math.random() * world.SPAWNS.length)); A.goalT = t + 12; }
      goal = { x: A.goal[0], z: A.goal[2] };
    }
    if (t > A.navT || !A.holder.nav) { buildNav(A.holder, [goal]); A.navT = t + 0.5; }
    const dx = goal.x - p.x, dz = goal.z - p.z, dist = Math.hypot(dx, dz);
    let gx = dx, gz = dz;
    const nav = A.holder.nav, Wd = world.W, fx = Math.floor(p.x), fz = Math.floor(p.z), ci = fz * Wd + fx;
    if (nav && nav[ci] > 0 && !(tg && canSee(room, p, tg) && dist < 18)) {
      let bx = 0, bz = 0, bdv = nav[ci];
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = fx + ox, nz = fz + oz;
        if (nx < 0 || nz < 0 || nx >= Wd || nz >= world.D) continue;
        const v = nav[nz * Wd + nx];
        if (v < 0 || v >= bdv) continue;
        if (ox && oz && (nav[fz * Wd + nx] < 0 || nav[nz * Wd + fx] < 0)) continue;
        bdv = v; bx = nx + 0.5 - p.x; bz = nz + 0.5 - p.z;
      }
      if (bx || bz) { gx = bx; gz = bz; }
    }
    let gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    let speed = 4.4;
    // ── fighting: strafe sideways, keep 7–14 m ──
    if (tg) {
      if (t > A.strafeT) { A.strafe = Math.random() < 0.5 ? -1 : 1; A.strafeT = t + 0.6 + Math.random() * 1.1; }
      const sx = -gz * A.strafe, sz = gx * A.strafe;
      const keep = tg.zombie ? 6 : 9;
      const fwd = dist > keep + 5 ? 1 : dist < keep - 3 ? -0.8 : 0.15;
      gx = gx * fwd + sx * 0.85; gz = gz * fwd + sz * 0.85; gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      speed = 4.0;
    }
    // ── move with the same rules as players: walls stop, 1-block steps are jumped ──
    const R = world.COL_R;
    const onGround = p.y <= world.groundBelow(p.x, p.y + 0.3, p.z) + 0.01;
    let jump = false;
    const tryMove = (nx, nz) => {
      if (!world.boxBlocked(nx, p.y, nz, R)) return true;
      if (!world.boxBlocked(nx, p.y + 1.05, nz, R) && !world.boxBlocked(p.x, p.y + 1.05, p.z, R)) jump = true;
      return false;
    };
    const ox0 = p.x, oz0 = p.z;
    const mx = p.x + gx * speed * dt; if (tryMove(mx, p.z)) p.x = mx;
    const mz = p.z + gz * speed * dt; if (tryMove(p.x, mz)) p.z = mz;
    if (Math.hypot(p.x - ox0, p.z - oz0) < speed * dt * 0.3) { A.stuckT += dt; if (A.stuckT > 0.6) { A.strafe = -A.strafe; A.goal = null; A.stuckT = 0; } } else A.stuckT = 0;
    if (jump && onGround && !(A.vy > 0)) A.vy = 6.6;
    A.vy -= 18 * dt;
    let ny = p.y + A.vy * dt;
    const gnd = world.groundBelow(p.x, Math.max(ny, p.y) + 0.3, p.z);
    if (ny <= gnd) { ny = gnd; A.vy = 0; }
    p.y = ny;
    // ── aim: turn toward the target at a human speed, with a little shake ──
    let wantYaw, wantPitch = 0;
    if (tg) {
      const ax = tg.x - p.x, ay = tg.y + world.BODY_CY - (p.y + world.EYE), az = tg.z - p.z;
      wantYaw = Math.atan2(-ax, -az); wantPitch = Math.atan2(ay, Math.hypot(ax, az));
    } else wantYaw = Math.atan2(-gx, -gz);
    const turn = (tg ? 5 + botSkill * 5 : 4) * dt, dy = angDiff(wantYaw, p.yaw);
    p.yaw += Math.max(-turn, Math.min(turn, dy));
    p.pitch += Math.max(-turn, Math.min(turn, wantPitch - p.pitch));
    // ── shoot ──
    if (!tg || t < A.react || t < A.reloadT) continue;
    const aimed = Math.abs(angDiff(wantYaw, p.yaw)) < 0.1 && Math.abs(wantPitch - p.pitch) < 0.12;
    if (!aimed) continue;
    const w = p.w, it = world.ITEMS[w], range = it.id === 'shotgun' ? 16 : 40;
    if (dist > range) continue;
    // pistols / shotgun: deliberate shots; AK: bursts of 3–7 then a short pause
    if (it.id === 'ak47') { if (A.burst <= 0) { if (t < A.burstWait) continue; A.burst = 3 + Math.floor(Math.random() * 5); } }
    const err = (1 - botSkill) * 0.09 + 0.012 + (A.burst > 0 ? 0.01 : 0);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
    const yaw = p.yaw + gauss() * err, pitch = p.pitch + gauss() * err;
    const d = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    if (it.kind === 'gun') {
      const Wp = W[it.id];
      if (t - (p.lastFire[w] || 0) < Wp.cooldown) continue;
      onFire(p, { w, d });
      p.mags[w] = (p.mags[w] ?? Wp.mag) - 1;
      if (it.id === 'ak47') { A.burst--; if (A.burst <= 0) A.burstWait = t + 0.25 + Math.random() * 0.4; }
      else p.lastFire[w] = t + Math.random() * 0.25;          // a human does not click at the exact max rate
      if (p.mags[w] <= 0) { p.mags[w] = Wp.mag; A.reloadT = t + Wp.reload; }
    } else if (it.id === 'shotgun') {
      if (t - p.lastShot < W.shotgun.cooldown + 0.1) continue;
      const pel = Array.from({ length: 8 }, () => { const a = Math.random() * 6.283, r = Math.random() * 0.055, py = pitch + Math.sin(a) * r, py2 = yaw + Math.cos(a) * r; return [-Math.sin(py2) * Math.cos(py), Math.sin(py), -Math.cos(py2) * Math.cos(py)]; });
      onShoot(p, { d, pel });
    }
  }
}

// ═════════════════════════ DEVELOPER COMMANDS (F9, only WoozyWaztern) ═════════════════════════
const RANK_NAMES = ['dot', 'blade', 'wave', 'shield', 'star', 'fortress', 'sigil', 'vortex', 'eigen'];
const DEV_HELP = {
  '1 ACCOUNTS': [
    'stars [p] <n|+n|1m|googol> · addstars <p> <n> · takestars <p> <n> · resetstars <p> · starsall <n>',
    'elo [p] <n|+n> · addelo <p> <n> · takeelo <p> <n> · eloall <+n>',
    'rank [p] <name> [1-3] · rankup <p> · rankdown <p> · rankall <name> [1-3]',
    'give [p] <item|all> · take [p] <item|all> · giveall <p> · takeall <p> · itemsall <item>',
    'equip <p> <item> · loadout <p> · set [p] <stat> <n> · resetstats [p] · top · richest',
  ],
  '2 MODERATION': [
    'players / online · info / whois <p> · rooms · accounts · uptime · version · db',
    'kick <p> [why] · kickall · ban <p> [why] · unban <p> · bans / banlist',
    'mute <p> · unmute <p> · mutes · announce <text> · say <text> · notify <p> <text>',
  ],
  '3 CHEATS (only you)': [
    'god · ammo · fly · onehit · invis · speed <x> · jump <x> · flags · nocheats',
  ],
  '4 MATCH': [
    'heal · healall · healp <p> · sethp <p> <n> · hurt <p> <n> · kill <p> · slayall',
    'revive <p> · reviveall · tp <x> <z> · tpto <p> · bring <p> · bringall · pos',
    'freeze <p> · unfreeze <p> · freezeall · unfreezeall · launch <p> · push <p>',
    'burn <p> · burnall · extinguish · fire · firering · firerain · clearfires',
    'time <s> · addtime <s> · end · restart · night · day',
  ],
  '5 ZOMBIES': [
    'wave <n> · nextwave · win · lose · spawn <n> · horde · boss · killall',
    'zfreeze · zunfreeze · zspeed <x> · zbring · zcount',
  ],
  '6 CAPTURE / HIDE & SEEK': [
    'score <red> <blue> · sigma · team <p> <0|1> · swapteams',
    'seeker <p> · hider <p> · hidetime <s> · skiphide · map <warehouse|offices>',
  ],
  '7 BOTS': [
    'bot [n] [name] · kickbots · botskill <0..1> · botweapon <ak47|shotgun|random> · botsfreeze · botsgo',
  ],
};
const DEV_COUNT = 120;   // commands + aliases (help shows them all)
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
// cheat flags count ONLY while this connection is signed in as WoozyWaztern (never carried to another account)
const isDevConn = c => !!(c && c.acc && c.name && c.name.toLowerCase() === DEV_NAME);
const NO_DEV = Object.freeze({});
function devOf(c) { return isDevConn(c) && c.dev ? c.dev : NO_DEV; }
// sign the connection out (logout, kick, ban, switching accounts) — leaves the match and drops every dev flag
function signOut(c) { const k = keyOf(c); leaveGame(c); if (k) { leaveParty(k, `${c.name} left the party`); dropInvitesOf(k); } c.name = null; c.acc = null; c.dev = null; }
function kickConn(c, msg) {
  send(c.ws, { t: 'kicked', msg });
  signOut(c);
  setTimeout(() => { try { c.ws.close(); } catch {} }, 300);
}
// "@Name" or "Name" → account key (or null)
function accKey(v) { const k = String(v || '').replace(/^@/, '').trim().toLowerCase(); return k && accounts[k] ? k : null; }
function onlineInfo(key) {
  const oc = onlineConn(key);
  return oc ? (oc.player ? `in match (${(world.MODE_INFO[oc.player.room.mode] || {}).name || oc.player.room.mode})` : 'online, in lobby') : 'offline';
}
// tell the target what happened + refresh their profile / inventory right away
function touchTarget(key, text) {
  const a = accounts[key]; if (!a) return;
  note(a, text);
  const oc = onlineConn(key);
  if (oc) { sendProfile(oc); send(oc.ws, socialMsg(oc.acc)); send(oc.ws, { t: 'notice', text, ok: true }); }
  saveSoon();
}
function onDev(c, m) {
  if (!c.acc || c.name.toLowerCase() !== DEV_NAME) return send(c.ws, { t: 'devlog', text: 'access denied', ok: false });
  const dev = c.dev || (c.dev = { god: false, ammo: false, speed: 1, jump: 1, fly: false, onehit: false });
  const parts = String(m.cmd || '').trim().split(/\s+/).filter(Boolean);
  let cmd = (parts[0] || '').toLowerCase();
  cmd = { whois: 'info', banlist: 'bans', online: 'players', commands: 'help', rp: 'elo' }[cmd] || cmd;
  const a1 = parts[1], a2 = parts[2];
  const st = statsOf(c.acc), p = c.player, room = p && p.room;
  const num = v => Number(v);
  const pushFlags = () => send(c.ws, { t: 'devset', dev });
  // target account: me (no name) or another player
  const T = key => ({ key, acc: accounts[key], st: statsOf(accounts[key]), self: key === DEV_NAME });
  const me = T(DEV_NAME);
  const tgt = name => { const k = accKey(name); if (!k) { devReply(c, name ? `player not found: ${name}` : 'which player? (type players)', false); return null; } return T(k); };
  const done = (target, text, tell) => {
    if (target.self) { saveSoon(); sendProfile(c); return devReply(c, text); }
    touchTarget(target.key, tell);
    devReply(c, `${target.acc.name}: ${text}`);
  };
  const toggle = (k, label) => { dev[k] = a1 === 'on' ? true : a1 === 'off' ? false : !dev[k]; pushFlags(); devReply(c, `${label}: ${dev[k] ? 'ON' : 'OFF'}`); };
  if (devGlobal(c, cmd, parts, { tgt, done, me, dev, pushFlags, toggle, num })) return;
  switch (cmd) {
    case 'help': case '?': case 'commands': {
      const pages = Object.entries(DEV_HELP), want = String(a1 || '').toLowerCase();
      devReply(c, `${DEV_COUNT} commands · [p] = optional player name · help 1…6 for one page`);
      for (const [title, lines] of pages) {
        if (want && want !== 'all' && !title.toLowerCase().startsWith(want)) continue;
        devReply(c, '── ' + title + ' ──'); for (const l of lines) devReply(c, '  ' + l);
      }
      return;
    }
    // ── account commands: without a name they change YOUR account, with a name — that player's ──
    case 'stars': case 'elo': case 'rp': {
      const target = parts.length >= 3 ? tgt(a1) : me;
      if (!target) return;
      const raw = parts.length >= 3 ? a2 : a1, v = bigNum(raw);
      const isStars = cmd === 'stars', field = isStars ? 'stars' : 'rp';
      if (!raw || !Number.isFinite(v)) return devReply(c, isStars ? 'usage: stars 500 · stars +500 · stars 1m · stars googol · stars <player> 1b' : 'usage: elo 15000 · elo +500 · elo <player> 15000', false);
      const s2 = target.st;
      s2[field] = Math.max(0, Math.floor(/^[+-]/.test(raw) ? s2[field] + v : v));
      if (!Number.isFinite(s2[field])) s2[field] = 1e300;
      done(target, `${isStars ? 'stars' : 'ELO'} = ${fmtBig(s2[field])}`, isStars ? `admin set your stars to ${fmtBig(s2[field])} ★` : `admin set your ELO to ${fmtBig(s2[field])}`);
      return;
    }
    case 'rank': {
      let target = me, rn = a1, dv = a2;
      if (RANK_NAMES.indexOf(String(a1 || '').toLowerCase()) < 0 && a1) { target = tgt(a1); if (!target) return; rn = a2; dv = parts[3]; }
      const i = RANK_NAMES.indexOf(String(rn || '').toLowerCase());
      if (i < 0) return devReply(c, 'usage: rank star 2 · rank <player> eigen 3   (dot blade wave shield star fortress sigil vortex eigen)', false);
      const div = Math.max(1, Math.min(3, num(dv) || 1)) - 1;
      target.st.rp = world.rankStart(i, div);
      const label = `${rn.toUpperCase()} ${['I', 'II', 'III'][div]}`;
      done(target, `rank ${label} · ELO = ${target.st.rp}`, `admin set your rank to ${label}`);
      return;
    }
    case 'give': case 'take': {
      const target = parts.length >= 3 ? tgt(a1) : me;
      if (!target) return;
      const what = String((parts.length >= 3 ? a2 : a1) || '').toLowerCase();
      const ids = what === 'all' ? world.ITEMS.filter(i => !i.starter).map(i => i.id) : [what];
      const bad = ids.filter(id => !world.ITEMS.find(i => i.id === id && !i.starter));
      if (!what || bad.length) return devReply(c, `items: ${world.ITEMS.filter(i => !i.starter).map(i => i.id).join(' ')} all   ·  give <player> <item>`, false);
      const s2 = target.st;
      for (const id of ids) {
        if (cmd === 'give' && !s2.inv.includes(id)) { s2.inv.push(id); const it = world.ITEMS[world.ITEM_IDX[id]]; if (!s2.loadout[it.cat]) s2.loadout[it.cat] = id; }
        if (cmd === 'take') { s2.inv = s2.inv.filter(x => x !== id); for (const k of Object.keys(s2.loadout)) if (s2.loadout[k] === id) s2.loadout[k] = world.DEFAULT_LOADOUT[k]; }
      }
      const names = ids.map(id => world.ITEMS[world.ITEM_IDX[id]].name).join(', ');
      done(target, `${cmd === 'give' ? 'given' : 'taken'}: ${names}  (works from the next match)`, cmd === 'give' ? `admin gave you: ${names}` : `admin took: ${names}`);
      return;
    }
    case 'set': {
      const keys = ['kills', 'deaths', 'wins', 'matches', 'bestWave', 'zkills'];
      let target = me, k0 = a1, v0 = a2;
      if (parts.length >= 4) { target = tgt(a1); if (!target) return; k0 = a2; v0 = parts[3]; }
      const k = keys.find(x => x.toLowerCase() === String(k0 || '').toLowerCase());
      if (!k || !Number.isFinite(num(v0))) return devReply(c, 'usage: set kills 100 · set <player> wins 5   (kills deaths wins matches bestWave zkills)', false);
      target.st[k] = Math.max(0, num(v0) | 0);
      done(target, `${k} = ${target.st[k]}`, `admin set your ${k} to ${target.st[k]}`);
      return;
    }
    case 'resetstats': {
      const target = a1 ? tgt(a1) : me;
      if (!target) return;
      Object.assign(target.st, { kills: 0, deaths: 0, wins: 0, matches: 0, rp: 0, history: [] });
      done(target, 'stats reset', 'admin reset your stats');
      return;
    }
    // ── moderation ──
    case 'players': case 'online': {
      const list = [...clients].filter(o => o.acc);
      devReply(c, `${list.length} signed in · ${clients.size} connections`);
      for (const o of list) devReply(c, `  ${o.name}  ·  ${onlineInfo(o.name.toLowerCase())}  ·  ELO ${statsOf(o.acc).rp}`);
      return;
    }
    case 'info': {
      const target = tgt(a1); if (!target) return;
      const s2 = target.st, a = target.acc;
      devReply(c, `${a.name} · ${onlineInfo(target.key)}${a.banned ? ' · BANNED' : ''}`);
      devReply(c, `  ELO ${s2.rp} · stars ${fmtBig(s2.stars)} · K ${s2.kills} D ${s2.deaths} · wins ${s2.wins}/${s2.matches} · best wave ${s2.bestWave}`);
      devReply(c, `  items: ${s2.inv.join(' ') || '(starters only)'}`);
      devReply(c, `  loadout: ${world.CATS.map(k => s2.loadout[k.id] || '-').join(' / ')}`);
      return;
    }
    case 'kick': {
      const target = tgt(a1); if (!target) return;
      if (target.self) return devReply(c, "you can't kick yourself", false);
      const oc = onlineConn(target.key);
      if (!oc) return devReply(c, `${target.acc.name} is not online`, false);
      const why = parts.slice(2).join(' ').slice(0, 80);
      kickConn(oc, `you were kicked by the admin${why ? ': ' + why : ''}`);
      return devReply(c, `kicked ${target.acc.name}`);
    }
    case 'ban': {
      const target = tgt(a1); if (!target) return;
      if (target.self) return devReply(c, "you can't ban yourself", false);
      const why = parts.slice(2).join(' ').slice(0, 80);
      target.acc.banned = { at: Date.now(), reason: why };
      saveSoon();
      const oc = onlineConn(target.key);
      if (oc) kickConn(oc, `you are banned${why ? ': ' + why : ''}`);
      return devReply(c, `banned ${target.acc.name}${oc ? ' (kicked)' : ''}`);
    }
    case 'unban': {
      const target = tgt(a1); if (!target) return;
      if (!target.acc.banned) return devReply(c, `${target.acc.name} is not banned`, false);
      delete target.acc.banned; saveSoon();
      return devReply(c, `unbanned ${target.acc.name}`);
    }
    case 'bans': {
      const list = Object.values(accounts).filter(a => a.banned);
      if (!list.length) return devReply(c, 'nobody is banned');
      for (const a of list) devReply(c, `  ${a.name}${a.banned.reason ? ' · ' + a.banned.reason : ''} · ${new Date(a.banned.at).toISOString().slice(0, 10)}`);
      return;
    }
    case 'db': return devReply(c, `database: ${dbStatus} · ${Object.keys(accounts).length} accounts`, dbStatus === 'ok');
    // ── cheats: only for you, they work everywhere — lobby, any mode, in the middle of a match ──
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
    case 'nocheats': Object.assign(dev, { god: false, ammo: false, speed: 1, jump: 1, fly: false, onehit: false }); pushFlags(); return devReply(c, 'all cheats off');
  }
  // in-match commands
  if (!p) return devReply(c, cmd ? `unknown or match-only command: ${cmd}  (type help)` : 'type help', false);
  if (devMatch(c, cmd, parts, p, room)) return;
  switch (cmd) {
    case 'heal': p.hp = world.MAX_HP; p.burnUntil = 0; broadcast(room, { t: 'heal', id: p.id, hp: p.hp }); return devReply(c, 'healed');
    case 'tp': {
      const x = num(a1), z = num(a2);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return devReply(c, 'usage: tp 24 30', false);
      send(c.ws, { t: 'devtp', x: Math.max(1, Math.min(world.W - 1, x)), z: Math.max(1, Math.min(world.D - 1, z)) }); return devReply(c, `teleported to ${x} ${z}`);
    }
    case 'time': if (!Number.isFinite(num(a1))) return devReply(c, 'usage: time 30', false);
      room.match.ends = now() + Math.max(1, num(a1)); broadcast(room, matchInfo(room)); return devReply(c, `time left ${num(a1)} s`);
    case 'end': if (room.mode === 'zombie') zombieGameOver(room); else endMatch(room); return devReply(c, 'match ended');
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
    case 'hurt': {
      const k = accKey(a1), oc = k && onlineConn(k), v = Math.max(1, Math.min(99, num(a2) || 30));
      if (!oc || !oc.player) return devReply(c, 'usage: hurt <player> 30  (the player must be in a match)', false);
      damage(oc.player.room, oc.player, null, v, 'dev', [], []); return devReply(c, `${oc.name} -${v} HP`);
    }
    case 'kill': {
      const k = accKey(a1), oc = k && onlineConn(k);
      if (!oc || !oc.player) return devReply(c, 'usage: kill <player>  (the player must be in a match)', false);
      damage(oc.player.room, oc.player, null, 99999, 'dev', [], []); return devReply(c, `killed ${oc.name}`);
    }
    case 'killall': { let n = 0; for (const z of room.zombies.values()) if (!z.dead) { damage(room, z, p, 99999, 'dev', [], []); n++; } return devReply(c, `killed ${n}`); }
  }
  devReply(c, `unknown command: ${cmd}  (type help)`, false);
}


// ───── more developer commands (accounts, moderation, fun) ─────
const STARTED = Date.now();
const muted = new Set();
const fmtDur = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m ${s % 60}s`; };
function onlineList() { return [...clients].filter(o => o.acc); }
function devGlobal(c, cmd, parts, H) {
  const a1 = parts[1], a2 = parts[2], rest = n => parts.slice(n).join(' ').slice(0, 140);
  const R = (t, ok) => devReply(c, t, ok);
  const addTo = (target, field, v, label) => {
    target.st[field] = Math.max(0, Math.floor(target.st[field] + v));
    H.done(target, `${label} = ${fmtBig(target.st[field])}`, `admin ${v >= 0 ? 'gave you' : 'took'} ${fmtBig(Math.abs(v))} ${label}`);
  };
  switch (cmd) {
    case 'addstars': case 'takestars': case 'addelo': case 'takeelo': {
      const t = H.tgt(a1); if (!t) return true;
      const v = bigNum(a2); if (!Number.isFinite(v)) return R(`usage: ${cmd} <player> 500`, false), true;
      addTo(t, cmd.endsWith('stars') ? 'stars' : 'rp', cmd.startsWith('take') ? -v : v, cmd.endsWith('stars') ? 'stars' : 'ELO');
      return true;
    }
    case 'resetstars': { const t = H.tgt(a1); if (!t) return true; t.st.stars = 0; H.done(t, 'stars = 0', 'admin reset your stars'); return true; }
    case 'starsall': case 'eloall': {
      const v = bigNum(a1); if (!Number.isFinite(v)) return R(`usage: ${cmd} 500`, false), true;
      const field = cmd === 'starsall' ? 'stars' : 'rp', list = onlineList();
      for (const o of list) { const st = statsOf(o.acc); st[field] = Math.max(0, Math.floor(st[field] + v)); touchTarget(o.name.toLowerCase(), `admin gave everyone ${fmtBig(v)} ${field === 'rp' ? 'ELO' : '★'}`); }
      return R(`+${fmtBig(v)} ${field === 'rp' ? 'ELO' : 'stars'} to ${list.length} players`), true;
    }
    case 'rankup': case 'rankdown': {
      const t = H.tgt(a1); if (!t) return true;
      const r = world.rankFromElo(t.st.rp); let k = r.tier * 3 + r.div + (cmd === 'rankup' ? 1 : -1);
      k = Math.max(0, Math.min(26, k)); t.st.rp = world.rankStart(Math.floor(k / 3), k % 3);
      const label = `${RANK_NAMES[Math.floor(k / 3)].toUpperCase()} ${['I', 'II', 'III'][k % 3]}`;
      H.done(t, `rank ${label} · ELO ${t.st.rp}`, `admin set your rank to ${label}`); return true;
    }
    case 'rankall': {
      const i = RANK_NAMES.indexOf(String(a1 || '').toLowerCase()); if (i < 0) return R('usage: rankall star 2', false), true;
      const d = Math.max(1, Math.min(3, Number(a2) || 1)) - 1, list = onlineList();
      for (const o of list) { statsOf(o.acc).rp = world.rankStart(i, d); touchTarget(o.name.toLowerCase(), `admin set everyone to ${a1.toUpperCase()}`); }
      return R(`${list.length} players → ${a1.toUpperCase()} ${['I', 'II', 'III'][d]}`), true;
    }
    case 'giveall': case 'takeall': {
      const t = H.tgt(a1); if (!t) return true;
      const ids = world.ITEMS.filter(i => !i.starter).map(i => i.id);
      if (cmd === 'giveall') { for (const id of ids) if (!t.st.inv.includes(id)) t.st.inv.push(id); }
      else { t.st.inv = []; t.st.loadout = { ...world.DEFAULT_LOADOUT }; }
      H.done(t, cmd === 'giveall' ? 'all items given' : 'all items taken', cmd === 'giveall' ? 'admin gave you every item' : 'admin took all your items'); return true;
    }
    case 'itemsall': {
      const it = world.ITEMS.find(i => i.id === String(a1 || '').toLowerCase() && !i.starter); if (!it) return R('usage: itemsall deagle', false), true;
      const list = onlineList();
      for (const o of list) { const st = statsOf(o.acc); if (!st.inv.includes(it.id)) st.inv.push(it.id); touchTarget(o.name.toLowerCase(), `admin gave everyone: ${it.name}`); }
      return R(`${it.name} → ${list.length} players`), true;
    }
    case 'equip': {
      const t = H.tgt(a1); if (!t) return true;
      const it = world.ITEMS.find(i => i.id === String(a2 || '').toLowerCase()); if (!it) return R('usage: equip <player> ak47', false), true;
      if (!it.starter && !t.st.inv.includes(it.id)) t.st.inv.push(it.id);
      t.st.loadout[it.cat] = it.id; H.done(t, `${it.name} equipped`, `admin equipped ${it.name} for you`); return true;
    }
    case 'loadout': { const t = H.tgt(a1); if (!t) return true; return R(`${t.acc.name}: ${world.CATS.map(k => `${k.id}=${t.st.loadout[k.id] || '-'}`).join('  ')}`), true; }
    case 'top': case 'richest': {
      const field = cmd === 'top' ? 'rp' : 'stars';
      const list = Object.values(accounts).map(a => [a.name, statsOf(a)[field]]).sort((x, y) => y[1] - x[1]).slice(0, 10);
      R(cmd === 'top' ? 'TOP 10 · ELO' : 'TOP 10 · stars'); list.forEach(([n, v], i) => R(`  ${i + 1}. ${n}  ${fmtBig(v)}`)); return true;
    }
    case 'kickall': {
      let n = 0; for (const o of onlineList()) if (o !== c) { kickConn(o, `server restart / maintenance${rest(1) ? ': ' + rest(1) : ''}`); n++; }
      return R(`kicked ${n} players`), true;
    }
    case 'mute': case 'unmute': {
      const k = accKey(a1); if (!k) return R('usage: mute <player>', false), true;
      if (cmd === 'mute') muted.add(k); else muted.delete(k);
      const oc = onlineConn(k); if (oc) send(oc.ws, { t: 'notice', text: cmd === 'mute' ? 'you were muted by the admin' : 'you can chat again', ok: cmd !== 'mute' });
      return R(`${accounts[k].name} ${cmd}d`), true;
    }
    case 'mutes': return R(muted.size ? [...muted].map(k => accounts[k] ? accounts[k].name : k).join(', ') : 'nobody is muted'), true;
    case 'announce': {
      const text = rest(1); if (!text) return R('usage: announce <text>', false), true;
      for (const o of onlineList()) send(o.ws, { t: 'announce', text });
      return R('announced'), true;
    }
    case 'say': {
      const text = rest(1); if (!text) return R('usage: say <text>', false), true;
      for (const r of rooms.values()) if (r.players.size) sys(r, `[admin] ${text}`);
      for (const o of onlineList()) if (!o.player) send(o.ws, { t: 'notice', text: `[admin] ${text}`, ok: true });
      return R('said'), true;
    }
    case 'notify': {
      const k = accKey(a1), oc = k && onlineConn(k), text = rest(2);
      if (!oc || !text) return R('usage: notify <player> <text>  (player online)', false), true;
      send(oc.ws, { t: 'announce', text }); return R(`sent to ${oc.name}`), true;
    }
    case 'uptime': return R(`server up ${fmtDur(Date.now() - STARTED)} · ${onlineList().length} online · ${rooms.size} rooms`), true;
    case 'version': return R('Eigenyth server 2.1'), true;
    case 'accounts': return R(`${Object.keys(accounts).length} accounts · ${Object.values(accounts).filter(a => a.banned).length} banned`), true;
    case 'rooms': {
      if (!rooms.size) return R('no rooms'), true;
      for (const r of rooms.values()) R(`  ${r.id} · ${(r.info || {}).name} · map ${r.map} · ${r.players.size} players · ${r.match.phase}${r.mode === 'zombie' ? ' · wave ' + r.wave : ''}`);
      return true;
    }
    case 'invis': {
      H.dev.invis = a1 === 'on' ? true : a1 === 'off' ? false : !H.dev.invis; H.pushFlags();
      const pl = c.player; if (pl) broadcast(pl.room, H.dev.invis ? { t: 'leave', id: pl.id } : { t: 'join', p: pubPlayer(pl) }, c.ws);
      return R(`invisible: ${H.dev.invis ? 'ON (nobody sees you)' : 'OFF'}`), true;
    }
  }
  return false;
}
// commands that need you to be in a match (p = you, room = your room)
function devMatch(c, cmd, parts, p, room) {
  const a1 = parts[1], a2 = parts[2], num = Number, R = (t, ok) => devReply(c, t, ok);
  const who = name => { const k = accKey(name), oc = k && onlineConn(k); if (!oc || !oc.player) { R(`${name || '?'}: not in a match`, false); return null; } return oc.player; };
  const others = () => [...room.players.values()].filter(q => q !== p);
  const healP = q => { q.hp = world.MAX_HP; q.burnUntil = 0; broadcast(q.room, { t: 'heal', id: q.id, hp: q.hp }); };
  const revive = q => { if (!q.dead) return false; spawn(q.room, q); q.role = q.role === 'spectator' ? 'hider' : q.role; broadcast(q.room, { t: 'respawn', id: q.id, x: r3(q.x), y: r3(q.y), z: r3(q.z), yaw: r3(q.yaw) }); return true; };
  const tpTo = (q, x, z) => send(q.ws, { t: 'devtp', x, z });
  const addFire = (x, z, r = 1.2, life = 6) => { const f = { x, y: world.groundBelow(x, p.y + 1.5, z), z, r, until: now() + life, by: p }; room.fires.push(f); broadcast(room, fireMsg(f)); };
  switch (cmd) {
    case 'healall': for (const q of room.players.values()) if (!q.dead) healP(q); return R('everyone healed'), true;
    case 'healp': { const q = who(a1); if (q) { healP(q); R(`${q.name} healed`); } return true; }
    case 'sethp': { const q = who(a1), v = Math.max(1, Math.min(100, num(a2) || 100)); if (q && !q.dead) { q.hp = v; broadcast(room, { t: 'heal', id: q.id, hp: v }); R(`${q.name} HP = ${v}`); } return true; }
    case 'slayall': { let n = 0; for (const q of others()) if (!q.dead) { damage(room, q, null, 99999, 'dev', [], []); n++; } return R(`slain ${n}`), true; }
    case 'revive': { const q = who(a1); if (q) R(revive(q) ? `${q.name} revived` : `${q.name} is alive`); return true; }
    case 'reviveall': { let n = 0; for (const q of room.players.values()) if (revive(q)) n++; return R(`revived ${n}`), true; }
    case 'tpto': { const q = who(a1); if (q) { tpTo(p, q.x + 1.2, q.z); R(`→ ${q.name}`); } return true; }
    case 'bring': { const q = who(a1); if (q) { tpTo(q, p.x + 1.2, p.z); R(`${q.name} brought to you`); } return true; }
    case 'bringall': { for (const [i, q] of others().entries()) { const a = i / Math.max(1, others().length) * Math.PI * 2; tpTo(q, p.x + Math.cos(a) * 2, p.z + Math.sin(a) * 2); } return R('everyone brought'), true; }
    case 'pos': return R(`x ${p.x.toFixed(1)} · y ${p.y.toFixed(1)} · z ${p.z.toFixed(1)} · map ${room.map}`), true;
    case 'freeze': case 'unfreeze': { const q = who(a1); if (q) { q.frozen = cmd === 'freeze'; send(q.ws, { t: 'frozen', on: q.frozen }); R(`${q.name} ${cmd === 'freeze' ? 'frozen' : 'free'}`); } return true; }
    case 'freezeall': case 'unfreezeall': for (const q of others()) { q.frozen = cmd === 'freezeall'; send(q.ws, { t: 'frozen', on: q.frozen }); } return R(cmd === 'freezeall' ? 'everyone frozen' : 'everyone free'), true;
    case 'launch': { const q = who(a1); if (q) { send(q.ws, { t: 'push', vx: 0, vy: 16, vz: 0 }); R(`${q.name} launched`); } return true; }
    case 'push': { const q = who(a1); if (q) { const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; send(q.ws, { t: 'push', vx: dx / l * 14, vy: 5, vz: dz / l * 14 }); R(`${q.name} pushed`); } return true; }
    case 'burn': { const q = who(a1); if (q) { q.burnUntil = now() + 4; q.burnBy = null; q.burnTick = now() + 0.15; R(`${q.name} is burning`); } return true; }
    case 'burnall': for (const q of allTargets(room)) if (q !== p && !q.dead) { q.burnUntil = now() + 4; q.burnBy = q.zombie ? p : null; q.burnTick = now() + 0.15; } return R('everything burns'), true;
    case 'extinguish': for (const q of allTargets(room)) q.burnUntil = 0; room.fires.length = 0; broadcast(room, { t: 'nofire' }); return R('all fires out'), true;
    case 'clearfires': room.fires.length = 0; broadcast(room, { t: 'nofire' }); return R('fires cleared'), true;
    case 'fire': { const d = 2.5; addFire(p.x - Math.sin(p.yaw) * d, p.z - Math.cos(p.yaw) * d); return R('fire!'), true; }
    case 'firering': for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; addFire(p.x + Math.cos(a) * 3.5, p.z + Math.sin(a) * 3.5, 0.9); } return R('ring of fire'), true;
    case 'firerain': for (let i = 0; i < 12; i++) addFire(Math.max(1, Math.min(world.W - 1, p.x + (Math.random() - 0.5) * 22)), Math.max(1, Math.min(world.D - 1, p.z + (Math.random() - 0.5) * 22)), 0.7 + Math.random() * 0.8); return R('fire rain'), true;
    case 'addtime': { const v = num(a1); if (!Number.isFinite(v)) return R('usage: addtime 60', false), true; room.match.ends += v; broadcast(room, matchInfo(room)); return R(`${v > 0 ? '+' : ''}${v} s`), true; }
    case 'restart': room.match.phase = 'idle'; startMatch(room); return R('match restarted'), true;
    case 'night': case 'day': broadcast(room, { t: 'night', on: cmd === 'night' }); return R(cmd === 'night' ? 'lights out' : 'lights on'), true;
    // zombies
    case 'nextwave': case 'win': case 'lose': case 'horde': case 'boss': case 'zfreeze': case 'zunfreeze': case 'zspeed': case 'zbring': case 'zcount': {
      if (room.mode !== 'zombie') return R('only in ZOMBIES', false), true;
      if (cmd === 'nextwave') { for (const z of room.zombies.values()) if (!z.dead) damage(room, z, p, 99999, 'dev', [], []); room.toSpawn = 0; return R('wave skipped'), true; }
      if (cmd === 'win') { room.wave = world.ZOMBIE_WAVES; zombieGameOver(room, true); return R('ZOMBIES won'), true; }
      if (cmd === 'lose') { zombieGameOver(room, false); return R('run lost'), true; }
      if (cmd === 'horde') { for (let i = 0; i < 30; i++) spawnZombie(room, Math.max(1, room.wave)); return R('a horde of 30'), true; }
      if (cmd === 'boss') { const z = spawnZombie(room, Math.max(1, room.wave) + 10); z.hp = z.maxHp = 2500; z.speed *= 0.8; z.dmg = 40; broadcast(room, { t: 'join', p: pubPlayer(z) }); sys(room, 'a BOSS zombie appears!'); return R('boss spawned (2500 HP)'), true; }
      if (cmd === 'zfreeze' || cmd === 'zunfreeze') { room.zfrozen = cmd === 'zfreeze'; return R(room.zfrozen ? 'zombies frozen' : 'zombies move again'), true; }
      if (cmd === 'zspeed') { const v = Math.max(0.1, Math.min(5, num(a1) || 1)); for (const z of room.zombies.values()) z.speed *= v; return R(`zombie speed ×${v}`), true; }
      if (cmd === 'zbring') { for (const z of room.zombies.values()) { z.x = p.x + (Math.random() - 0.5) * 8; z.z = p.z + (Math.random() - 0.5) * 8; } return R('zombies teleported to you'), true; }
      const alive = [...room.zombies.values()].filter(z => !z.dead).length;
      return R(`wave ${room.wave}/${world.ZOMBIE_WAVES} · alive ${alive} · to spawn ${room.toSpawn} · kills ${room.zkills}`), true;
    }
    // capture
    case 'score': if (room.mode !== 'cap') return R('only in CAPTURE', false), true;
      room.score = [Math.max(0, num(a1) | 0), Math.max(0, num(a2) | 0)]; broadcast(room, sigmaMsg(room)); broadcast(room, matchInfo(room)); return R(`score ${room.score.join(' : ')}`), true;
    case 'sigma': if (room.mode !== 'cap') return R('only in CAPTURE', false), true; resetSigma(room); return R('Σ is back home'), true;
    case 'team': { const q = who(a1); if (!q) return true; if (room.mode !== 'cap') return R('only in CAPTURE', false), true; q.team = num(a2) === 1 ? 1 : 0; spawn(room, q); broadcast(room, { t: 'respawn', id: q.id, x: r3(q.x), y: r3(q.y), z: r3(q.z), yaw: r3(q.yaw) }); broadcast(room, { t: 'team', id: q.id, team: q.team }); return R(`${q.name} → ${world.TEAM_NAME[q.team]}`), true; }
    case 'swapteams': if (room.mode !== 'cap') return R('only in CAPTURE', false), true;
      for (const q of room.players.values()) { q.team = 1 - q.team; broadcast(room, { t: 'team', id: q.id, team: q.team }); } return R('teams swapped'), true;
    // hide & seek
    case 'seeker': case 'hider': {
      const q = who(a1); if (!q) return true; if (room.mode !== 'hide') return R('only in HIDE & SEEK', false), true;
      q.role = cmd; q.loadout = cmd === 'seeker' ? SEEKER_LO : HIDER_LO; q.w = cmd === 'seeker' ? world.ITEM_IDX.pistol : -1;
      for (const o of room.players.values()) sendRole(o);
      return R(`${q.name} is now a ${cmd}`), true;
    }
    case 'hidetime': { if (room.mode !== 'hide') return R('only in HIDE & SEEK', false), true; room.hideEnds = now() + Math.max(0, num(a1) || 0); room.seekOn = false; for (const o of room.players.values()) sendRole(o); return R(`hiding time ${num(a1) || 0} s`), true; }
    case 'skiphide': { if (room.mode !== 'hide') return R('only in HIDE & SEEK', false), true; room.hideEnds = now(); for (const o of room.players.values()) sendRole(o); return R('seeking starts now'), true; }
    case 'bot': case 'bots': {
      if (room.mode === 'hide') return R('bots play DEATHMATCH, CAPTURE and ZOMBIES', false), true;
      const n = Math.max(1, Math.min(9, num(a1) || 1));
      const added = []; for (let i = 0; i < n && room.players.size < 16; i++) added.push(addBot(room, n === 1 && a2 ? a2 : null).name);
      return R(`bots joined: ${added.join(', ')} · skill ${botSkill}`), true;
    }
    case 'kickbots': { const list = [...room.players.values()].filter(q => q.bot); for (const q of list) removeBot(q); return R(`removed ${list.length} bots`), true; }
    case 'botskill': { const v = Math.max(0, Math.min(1, Number(a1))); if (!Number.isFinite(v)) return R('usage: botskill 0.7  (0 = blind, 1 = sharp)', false), true; botSkill = v; return R(`bot skill ${v}`), true; }
    case 'botweapon': { const id = String(a1 || '').toLowerCase(); if (id !== 'random' && !['ak47', 'shotgun'].includes(id)) return R('usage: botweapon ak47 | shotgun | random  (for new bots)', false), true; botWeapon = id; return R(`new bots carry: ${id}`), true; }
    case 'botsfreeze': case 'botsgo': botsFrozen = cmd === 'botsfreeze'; return R(botsFrozen ? 'bots stand still' : 'bots move again'), true;
    case 'map': { if (!world.MAP_INFO[a1]) return R('maps: ' + Object.keys(world.MAP_INFO).join(' '), false), true; room.forceMap = a1; return R(`next round on ${a1} (restart to play it now)`), true; }
  }
  return false;
}

// ═════════════════════════ CONNECTIONS ═════════════════════════
attach(server, '/ws', ws => {
  const c = { ws, name: null, player: null };
  clients.add(c);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'logout') { signOut(c); return send(ws, { t: 'loggedout', rid: m.rid }); }
    if (m.t === 'auth') {
      const rid = Number.isFinite(m.rid) ? m.rid : 0;
      const fail = msg => send(ws, { t: 'auth', ok: false, msg, rid });
      if (!ready) return fail('server is starting — try again in a few seconds');
      const name = String(m.name || '').trim(), pass = String(m.pass || '');
      if (!NAME_RE.test(name)) return fail('nickname: 3-16 letters, digits or _');
      if (pass.length < 3 || pass.length > 64) return fail('password: 3-64 characters');
      const key = name.toLowerCase();
      if (c.acc && c.name.toLowerCase() !== key) signOut(c);      // switching accounts on the same connection
      for (const o of clients) if (o !== c && o.name && o.name.toLowerCase() === key) {
        // the same account in another tab / a dead connection that wasn't closed yet: correct password → take over
        const a = accounts[key];
        if (a && hashPass(pass, a.salt) === a.hash) { kickConn(o, 'you signed in somewhere else'); break; }
        return fail('this nickname is already online');
      }
      let created = false;
      if (accounts[key]) {
        const a = accounts[key];
        if (hashPass(pass, a.salt) !== a.hash) return fail('wrong password');
        if (a.banned) return fail(`this account is banned${a.banned.reason ? ': ' + a.banned.reason : ''}`);
      } else {
        const salt = crypto.randomBytes(16).toString('hex');
        accounts[key] = { name, salt, hash: hashPass(pass, salt), created: Date.now() };
        saveSoon(); created = true;
      }
      c.name = accounts[key].name; c.acc = accounts[key];
      setTimeout(() => send(ws, partyState(key)), 50);
      return send(ws, { t: 'auth', ok: true, rid, name: c.name, created, stats: statsOf(c.acc), lan: lanAddrs(), dev: key === DEV_NAME,
        db: key === DEV_NAME ? dbStatus : undefined });
    }
    if (!c.name) return;

    if (m.t === 'buy') return onBuy(c, m);
    if (m.t === 'equip' || m.t === 'unequip') return onEquip(c, m);
    if (m.t === 'dev') return onDev(c, m);
    if (['social', 'viewProfile', 'search', 'friendAdd', 'friendAccept', 'friendDecline', 'friendRemove'].includes(m.t)) return onSocial(c, m);
    if (['party', 'pinvite', 'paccept', 'pdecline', 'pleave', 'pkick'].includes(m.t)) return onParty(c, m);
    if (m.t === 'join') return joinGame(c, m.mode);
    if (m.t === 'leave') return leaveGame(c);
    const p = c.player;
    if (!p) return;
    world.setMap(p.room.map);

    switch (m.t) {
      case 'st': {
        if (p.dead) break;
        const { x, y, z, yaw, pitch, w } = m;
        const frozen = p.frozen || (p.room.mode === 'hide' && p.role === 'seeker' && now() < p.room.hideEnds);
        if (frozen) { if (Number.isFinite(yaw)) { p.yaw = yaw; p.pitch = pitch; } }
        else if ([x, y, z, yaw, pitch].every(Number.isFinite)) {
          p.x = Math.max(0, Math.min(world.W, x)); p.y = Math.max(0, Math.min(world.H + 6, y));
          p.z = Math.max(0, Math.min(world.D, z)); p.yaw = yaw; p.pitch = pitch;
        }
        if (Number.isInteger(w) && owns(p, w)) p.w = w;
        p.fl = m.fl === 0 ? 0 : 1;
        break;
      }
      case 'shoot': onShoot(p, m); break;
      case 'knife': onKnife(p, m); break;
      case 'drink': onDrink(p, m); break;
      case 'fire': onFire(p, m); break;
      case 'melee': onMelee(p, m); break;
      case 'throw': onThrow(p, m); break;
      case 'medkit': onMedkit(p, m); break;
      case 'chat': {
        const t = now();
        if (t - p.lastChat < 0.35) break;
        p.lastChat = t;
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
        if (muted.has(p.name.toLowerCase())) { send(p.ws, { t: 'notice', text: 'you are muted', ok: false }); break; }
        if (text) broadcast(p.room, { t: 'chat', id: p.id, name: p.name, text });
        break;
      }
    }
  });
  ws.on('close', () => { signOut(c); clients.delete(c); });
});

// ───────────── tick: snapshots, respawns, modes ─────────────
let lastTick = now();
setInterval(() => {
  const t = now(), dt = Math.min(0.1, t - lastTick); lastTick = t;
  for (const room of rooms.values()) {
    if (!room.players.size) continue;
    world.setMap(room.map);
    if (room.mode === 'hide' && room.match.phase === 'play' && !room.seekOn && t > room.hideEnds) {
      room.seekOn = true;
      broadcast(room, { t: 'seekstart', left: Math.round(room.match.ends - t) });
      sys(room, 'the seeker is coming…');
    }
    for (const p of room.players.values()) {
      if (p.dead && t > p.deadUntil && room.mode !== 'zombie' && room.mode !== 'hide') {
        spawn(room, p);
        broadcast(room, { t: 'respawn', id: p.id, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw) });
      }
    }
    // health comes back slowly: 4 s after the last hit, +7 HP per second (not while burning)
    for (const p of room.players.values()) {
      if (p.dead || p.hp >= world.MAX_HP || p.burnUntil > t || t - (p.lastHurt || 0) < 4) { p.regen = 0; continue; }
      p.regen = (p.regen || 0) + 7 * dt;
      if (p.regen >= 1) { const k = Math.floor(p.regen); p.regen -= k; p.hp = Math.min(world.MAX_HP, p.hp + k); }
    }
    botTick(room, t, dt);
    fireTick(room, t);
    if (room.mode === 'cap') captureTick(room, t);
    if (room.mode === 'zombie') zombieTick(room, t, dt);
    if (room.match.phase === 'play' && t > room.match.ends) endMatch(room);
    else if (room.match.phase === 'results' && t > room.match.ends) { backToLobby(room); continue; }
    const snap = { t: 's', p: allTargets(room).map(p =>
      [p.id, r3(p.x), r3(p.y), r3(p.z), r3(p.yaw), r3(p.pitch), p.w, p.hp, p.dead ? 1 : 0, p.burnUntil > t ? 1 : 0, p.team, p.zombie ? 1 : 0, p.fl === 0 ? 0 : 1]) };
    if (room.mode === 'cap' && room.sigma.state === 'carried') snap.sg = [r3(room.sigma.x), r3(room.sigma.y), r3(room.sigma.z)];
    const inv = [...room.players.values()].filter(q => devOf(q.c).invis);
    if (!inv.length) broadcast(room, snap);
    else {                                      // dev 'invis': the others don't get that player at all
      const ids = new Set(inv.map(q => q.id)), full = JSON.stringify(snap), part = JSON.stringify({ ...snap, p: snap.p.filter(a => !ids.has(a[0])) });
      for (const q of room.players.values()) if (q.ws.readyState === 1) q.ws.send(ids.has(q.id) ? full : part);
    }
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
