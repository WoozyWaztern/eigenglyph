// ─────────────────────────────────────────────────────────────
//  EIGENGLYPH : ΣVOID — boot, screens (login / menu / game), loop
// ─────────────────────────────────────────────────────────────
import { GlyphScreen } from './glyph.js';
import { Input } from './input.js';
import { UI, C, bigText, coverageChar } from './ui.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { Renderer } from './render3d.js';
import { ViewModel } from './viewmodel.js';
import { Game } from './game.js';
import { Lobby, rankOf } from './lobby.js';
import { makePrim, setRotYXZ, hitPrim, HIT, BOX } from './prims.js';

const TITLE = 'EIGENYTH';
const SUBTITLE = 'E V E R Y T H I N G   I S   A   S Y M B O L';

class App {
  constructor() {
    const canvas = document.getElementById('screen');
    this.settings = { sens: 1, fov: 80, fontPx: 14, detail: 2 };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('eg_settings') || '{}')); } catch {}
    this.scr = new GlyphScreen(canvas);
    this.scr.fontPx = this.settings.fontPx || 14;
    this.scr.setDetail(this.settings.detail || 2);
    this.input = new Input(canvas, this.scr);
    this.audio = new Audio();
    this.ui = new UI(this.scr, this.input, this.audio);
    this.net = new Net();
    this.renderer = new Renderer();
    this.vm = new ViewModel();
    this.game = new Game(this);
    this.lobby = new Lobby(this);
    this.profile = null;
    this.authRid = 0; this.dbWarn = null;
    this.isDev = false; this.devOpen = false; this.devLog = []; this.devInput = ''; this.devHist = []; this.devHi = -1; this.devFlags = null;

    this.state = 'login';
    this.nick = localStorage.getItem('eg_nick') || '';
    this.pass = '';
    this.status = ''; this.statusErr = false;
    this.creds = null;
    this.online = 0;
    this.time = 0; this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    this.ui.focus = this.nick ? 'pass' : 'nick';
    this.cube = makePrim(); this.cube.type = BOX; this.cube.sx = this.cube.sy = this.cube.sz = 1;
    this.titleCache = null;

    window.addEventListener('resize', () => { this.scr.resize(); this.titleCache = null; });
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('mousedown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.input.onLockChange = locked => { if (locked && this.game.active) this.game.paused = false; };
    this.net.on(m => this.onNet(m));

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { this.frame(dt); } catch (e) { showError(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  saveSettings() { try { localStorage.setItem('eg_settings', JSON.stringify(this.settings)); } catch {} }

  onNet(m) {
    switch (m.t) {
      case '_open':
        if (this.creds) this.net.send({ t: 'auth', ...this.creds, silent: true, rid: ++this.authRid });
        break;
      case '_close':
        if (this.state === 'game') { this.game.stop(); this.input.unlock(); }
        if (this.state !== 'login') { this.state = 'menu'; }
        if (this.creds) { this.status = 'connection lost — reconnecting…'; this.statusErr = true; }
        break;
      case 'kicked':
        if (this.state === 'game') { this.game.stop(); this.input.unlock(); }
        this.signOutLocal();
        this.status = m.msg || 'you were kicked'; this.statusErr = true;
        break;
      case 'auth':
        // only the answer to the LAST login counts (slow server: an old answer must never sign you in as another account)
        if (m.rid !== this.authRid || !this.creds) break;
        if (m.ok) {
          if (m.name.toLowerCase() !== this.creds.name.toLowerCase()) break;
          this.nick = m.name; localStorage.setItem('eg_nick', m.name);
          if (m.stats) this.profile = m.stats;
          this.isDev = !!m.dev;
          if (m.dev) this.dbWarn = m.db && m.db !== 'ok' ? m.db : null;
          this.checkRank(true);
          this.lan = m.lan || [];
          this.net.send({ t: 'social' });
          if (this.state === 'login') this.ui.focus = null;
          if (this.state === 'login') this.state = 'menu';
          this.status = m.created ? `account created — welcome, ${m.name}` : ''; this.statusErr = false;
        } else {
          this.status = m.msg; this.statusErr = true; this.creds = null;
          this.state = 'login';
        }
        break;
      case 'online': this.online = m.n; break;
      case 'devlog': this.devLog.push({ text: m.text, ok: m.ok !== false }); if (this.devLog.length > 200) this.devLog.shift(); break;
      case 'devset': this.devFlags = m.dev; this.game.onNet(m); break;
      case 'profile': this.profile = m.stats; this.checkRank(false); break;
      case 'social': this.social = m; break;
      case 'party': this.party = m; break;
      case 'pinvited': this.lobby.notice = { text: `${m.from} invites you to the party`, t: 4, ok: true }; this.audio.chat && this.audio.chat(); break;
      case 'searchRes': this.searchRes = m; break;
      case 'profileView': this.viewed = m.p; break;
      case 'notice': this.lobby.notice = { text: m.text, t: 3, ok: m.ok }; break;
      case 'tolobby':      // the round is over → back to the lobby (results were shown in the match)
        if (this.state === 'game') { this.leaveGame(); this.lobby.tab = 0; }
        break;
      case 'welcome':
        if (!this.creds) { this.net.send({ t: 'leave' }); break; }   // signed out meanwhile
        this.game.start(m);
        this.state = 'game';
        break;
      default:
        this.game.onNet(m);
    }
  }

  goServer(addr) {
    addr = String(addr || '').trim();
    if (!addr) return;
    if (!/^https?:\/\//.test(addr)) addr = (/^(\d+\.){3}\d+$|^localhost$/.test(addr) ? 'http://' + addr + ':3000' : /^[\d.]+:\d+$|^localhost:\d+$/.test(addr) ? 'http://' + addr : 'https://' + addr);
    this.status = 'connecting to ' + addr + '…'; this.statusErr = false;
    location.href = addr;
  }
  login() {
    const name = this.nick.trim(), pass = this.pass;
    if (name.length < 3) { this.status = 'nickname is too short'; this.statusErr = true; return; }
    if (pass.length < 3) { this.status = 'password is too short'; this.statusErr = true; return; }
    this.creds = { name, pass };
    this.status = 'connecting…'; this.statusErr = false;
    this.net.send({ t: 'auth', name, pass, rid: ++this.authRid });
  }
  // forget everything about the signed-in account on this page
  signOutLocal() {
    this.authRid++;                 // answers to older logins are ignored from now on
    this.net.clearQueue();
    this.isDev = false; this.devOpen = false; this.devLog = []; this.devFlags = null; this.dbWarn = null;
    this.creds = null; this.pass = ''; this.profile = null; this.social = null; this.party = null; this.viewed = null; this.searchRes = null;
    this.pendingRank = null; this.state = 'login'; this.ui.focus = 'pass';
  }
  logout() {
    if (this.state === 'game') { this.game.stop(); this.input.unlock(); }
    this.signOutLocal();
    this.net.send({ t: 'logout' });   // the connection stays open — the server signs it out instantly
  }
  // AUTO QUALITY: if the 3D view takes too long (big fights, fire, slow PC) the detail drops one step,
  // and goes back up to the chosen level once there is time to spare again
  autoDetail(dt) {
    // ladder: full → every 2nd row doubled → one detail step lower → … (back up when there is time to spare)
    const R = this.renderer, ms = R.workers ? R.wAvg : R.mAvg;
    if (!ms) return;
    const want = this.settings.detail || 2;
    const lvl = (want - this.scr.detail) * 2 + (R.halfRows ? 1 : 0), maxLvl = (want - 1) * 2 + 1;
    this.slowT = ms > 38 ? (this.slowT || 0) + dt : 0;        // under ~26 fps
    this.fastT = ms < 14 ? (this.fastT || 0) + dt : 0;        // well over 60 fps
    const apply = l => {
      const det = want - (l >> 1), half = !!(l & 1);
      R.halfRows = half;
      if (this.scr.detail !== det) { this.scr.setDetail(det); R.latest = null; }
      R.wAvg = R.mAvg = 0; this.slowT = 0; this.fastT = -6;
    };
    if (this.slowT > 1.2 && lvl < maxLvl) apply(lvl + 1);
    else if (this.fastT > 6 && lvl > 0) apply(lvl - 1);
  }
  // rank went up since the last time this browser saw it → play the rank-up animation in the lobby.
  // Several ranks at once (dev: rank eigen) → only the last change is shown.
  checkRank(login) {
    if (!this.profile) return;
    const r = rankOf(this.profile.rp), key = r.tier * 3 + r.div;
    const sk = 'eg_rank_' + this.nick.toLowerCase();
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(sk) || 'null'); } catch {}
    if (!seen || login && seen.key === undefined) seen = null;
    if (seen && key > seen.key) this.pendingRank = { from: { tier: seen.tier, div: seen.div }, to: r };
    try { localStorage.setItem(sk, JSON.stringify({ key, tier: r.tier, div: r.div })); } catch {}
  }

  // ── F9: developer panel (only the account WoozyWaztern — the server checks it too) ──
  devPanel() {
    const inp = this.input, scr = this.scr;
    if (inp.pressed.has('F9') && this.isDev && this.state !== 'login') {
      this.devOpen = !this.devOpen; this.ui.focus = null;
      if (this.devOpen && !this.devLog.length) { this.devLog.push({ text: 'developer panel · type a command and press Enter', ok: true }); this.net.send({ t: 'dev', cmd: 'help' }); }
      inp.typed.length = 0;
    }
    if (!this.devOpen) return;
    if (!this.isDev || this.state === 'login') { this.devOpen = false; return; }
    for (const ch of inp.typed) {
      if (ch === '\b') this.devInput = [...this.devInput].slice(0, -1).join('');
      else if (ch === '\n') {
        const cmd = this.devInput.trim();
        this.devInput = ''; this.devHi = -1;
        if (!cmd) continue;
        this.devHist.unshift(cmd); this.devHist = this.devHist.slice(0, 30);
        this.devLog.push({ text: '> ' + cmd, ok: true, me: true });
        if (cmd === 'clear') this.devLog = [];
        else this.net.send({ t: 'dev', cmd });
      } else if (ch !== '\t' && ch !== '`' && this.devInput.length < 80) this.devInput += ch;
    }
    inp.typed.length = 0;
    if (inp.pressed.has('ArrowUp') && this.devHist.length) { this.devHi = Math.min(this.devHist.length - 1, this.devHi + 1); this.devInput = this.devHist[this.devHi]; }
    if (inp.pressed.has('ArrowDown')) { this.devHi = Math.max(-1, this.devHi - 1); this.devInput = this.devHi >= 0 ? this.devHist[this.devHi] : ''; }
    // draw
    const w = Math.min(84, scr.cols - 4), h = Math.min(scr.rows - 8, 40);
    const x = scr.cols - w - 2, y = 4;
    const bg = [12, 10, 6];
    scr.box(x, y, w, h, [230, 170, 70], bg);
    scr.text(x + 2, y, ' DEVELOPER PANEL · F9 · only WoozyWaztern ', [255, 210, 120], bg);
    // long lines wrap onto the next row (indented)
    const cw = w - 4, rowsOut = [];
    for (const l of this.devLog.slice(-(h - 5))) {
      let t = l.text, first = true;
      while (t.length || first) { const cut = first ? cw : cw - 4; rowsOut.push([(first ? '' : '    ') + t.slice(0, cut), l]); t = t.slice(cut); first = false; }
    }
    rowsOut.slice(-(h - 5)).forEach(([t, l], i) => scr.text(x + 2, y + 1 + i, t, l.me ? [255, 220, 150] : l.ok ? [200, 205, 210] : [230, 100, 90], bg));
    for (let i = x + 1; i < x + w - 1; i++) scr.put(i, y + h - 3, '-', [90, 70, 40], bg);
    const n = scr.text(x + 2, y + h - 2, '> ' + this.devInput, [255, 230, 170], bg);
    if (this.time % 1 < 0.55) scr.put(x + 2 + n, y + h - 2, '_', [255, 230, 170], bg);
    scr.text(x + w - 30, y + h - 1, ' Enter · ↑ history · F9 close ', [150, 120, 70], bg);
  }

  play(mode = 'dm') {
    this.net.send({ t: 'join', mode });
    this.input.lock();
  }
  leaveGame() {
    if (this.scr.detail !== (this.settings.detail || 2)) this.scr.setDetail(this.settings.detail || 2);   // undo auto quality
    this.renderer.halfRows = false;
    this.net.send({ t: 'leave' });
    this.game.stop();
    this.input.unlock();
    this.state = 'menu';
  }

  frame(dt) {
    this.time += dt;
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = Math.round(this._fpsN / this._fpsAcc); this._fpsAcc = 0; this._fpsN = 0; }
    const scr = this.scr;
    this.ui.begin(dt);
    scr.clear(0, 0, 0, false);            // UI layer: see-through until drawn on
    scr.art.clear(0, 0, 0, false);        // art layer: only where something is painted
    if (this.devOpen) this.ui.focus = null;
    if (this.state === 'game' && this.game.active) {
      this.game.update(dt);
      this.game.draw(dt);
      this.autoDetail(dt);
    } else {
      if (this.state === 'login') { scr.fine.clear(...C.bg); this.drawBackground(); this.drawLogin(); }
      else {
        if (this.pendingRank) { this.lobby.startRankUp(this.pendingRank.from, this.pendingRank.to); this.pendingRank = null; }
        this.lobby.draw(dt);
      }
    }
    this.devPanel();
    this.ui.cursor();
    this.ui.end();
    scr.present();
    this.input.endFrame();
  }

  // slowly rotating ASCII cube behind the menus
  drawBackground() {
    const scr = this.scr.fine, cols = scr.cols, rows = scr.rows;
    const t = this.time;
    setRotYXZ(this.cube.m, t * 0.37, t * 0.23, t * 0.11);
    this.cube.px = 0; this.cube.py = 0; this.cube.pz = 6.2;
    const aspect = (cols * scr.cellW) / (rows * scr.cellH);
    const tanY = 0.45, tanX = tanY * aspect;
    const ramp = '.,-~:;=!*#$@';
    const L = [-0.5, 0.6, -0.62];
    for (let y = 0; y < rows; y++) {
      const sy = 1 - (y + 0.5) / rows * 2;
      for (let x = 0; x < cols; x++) {
        const sx = (x + 0.5) / cols * 2 - 1;
        let dx = sx * tanX, dy = sy * tanY, dz = 1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const tt = hitPrim(this.cube, 0, 0, 0, dx, dy, dz);
        if (tt < 0) {
          // faint drifting symbol dust
          const h = Math.sin(x * 12.9898 + y * 78.233 + Math.floor(t * 0.5 + x * 0.01) * 3.7) * 43758.5453;
          const f = h - Math.floor(h);
          if (f > 0.9975) scr.put(x, y, '·', [34, 36, 42]);
          continue;
        }
        const ndl = Math.max(0, HIT.nx * L[0] + HIT.ny * L[1] + HIT.nz * L[2]);
        // face edges
        const e = Math.min(1 - Math.abs(HIT.lx), 1 - Math.abs(HIT.ly), 1 - Math.abs(HIT.lz));
        const ax = Math.abs(HIT.lx), ay = Math.abs(HIT.ly), az = Math.abs(HIT.lz);
        const edge = [ax, ay, az].sort((a, b) => b - a)[1] > 0.93;
        let lum = 0.15 + ndl * 0.75;
        if (edge) lum = 1;
        const ch = ramp[Math.min(ramp.length - 1, Math.floor(lum * ramp.length))];
        const v = edge ? 70 : 22 + lum * 40;
        scr.put(x, y, ch, [v, v + 2, v + 7], [5, 5, 7]);
      }
    }
    scr.dimRect(0, 0, cols, rows, 0.75);
  }

  drawTitle(y) {
    const scr = this.scr;
    const w = Math.min(scr.cols - 6, 112);
    if (!this.titleCache || this.titleCache.w !== w) {
      this.titleCache = { w, rows: bigText(TITLE, w, scr.cellW / scr.cellH) };
    }
    const rows = this.titleCache.rows;
    const x0 = Math.floor(scr.cols / 2 - w / 2);
    const sweep = (this.time * 0.35) % 1.6 - 0.3;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const v = rows[r][c];
        if (v < 0.08) continue;
        const pos = c / w;
        const glow = Math.max(0, 1 - Math.abs(pos - sweep - r * 0.01) * 9);
        // tiny glitch
        const glitch = Math.random() < 0.002;
        const ch = glitch ? 'Σ∇Δλ#@'[Math.floor(Math.random() * 6)] : coverageChar(v);
        const b = 120 + v * 90 + glow * 60;
        scr.put(x0 + c, y + r, ch, [b, b + 2, b + 6]);
      }
    }
    scr.textC(y + rows.length + 1, SUBTITLE, C.dim);
    return y + rows.length + 3;
  }

  drawLogin() {
    const scr = this.scr, ui = this.ui;
    let y = Math.max(1, Math.floor(scr.rows * 0.12));
    y = this.drawTitle(y);
    const w = 46, h = 17;
    const x = Math.floor(scr.cols / 2 - w / 2);
    y = Math.max(y + 1, Math.floor(scr.rows / 2 - h / 2) + 3);
    scr.box(x, y, w, h, C.line, C.panel);
    scr.textC(y + 1, 'S I G N   I N', C.bright, C.panel, x + w / 2);
    this.nick = ui.field('nick', x + 3, y + 3, w - 6, this.nick, {
      label: 'NICKNAME', max: 16, onEnter: () => { ui.focus = 'pass'; }, onTab: () => { ui.focus = 'pass'; },
    });
    this.pass = ui.field('pass', x + 3, y + 7, w - 6, this.pass, {
      label: 'PASSWORD', max: 64, mask: true, onEnter: () => this.login(), onTab: () => { ui.focus = 'nick'; },
    });
    if (ui.button('login', x + 3, y + 11, w - 6, 'ENTER EIGENYTH')) this.login();
    scr.textC(y + 15, 'new nickname = new account', C.dim, C.panel, x + w / 2);
    if (this.status) scr.textC(y + h + 1, this.status, this.statusErr ? C.red : C.dim);
    // ── server: play on this PC, or join a friend / online server ──
    const sy = y + h + 3;
    const here = location.host;
    if (!this.joining) {
      const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(here);
      const lbl = `server: ${local ? 'this PC' : here}`;
      scr.textC(sy, lbl, C.dim, null, x + w / 2 - 8);
      if (ui.button('srv', x + w / 2 + [...lbl].length / 2 - 6, sy, 14, 'change', { h: 1, fg: C.text, bg: C.bg })) { this.joining = true; ui.focus = 'srvaddr'; this.srvAddr = ''; }
    } else {
      this.srvAddr = ui.field('srvaddr', x + 3, sy - 1, w - 22, this.srvAddr || '', {
        label: 'FRIEND IP / SERVER', max: 120, placeholder: '192.168.1.5  or  game.example.com',
        onEnter: () => this.goServer(this.srvAddr),
      });
      if (ui.button('srvgo', x + w - 18, sy - 1, 15, 'CONNECT')) this.goServer(this.srvAddr);
      if (ui.button('srvhome', x + 3, sy + 2, 18, 'this PC', { h: 1, fg: C.dim, bg: C.bg })) this.goServer('localhost:' + (this.homePort || 3000));
      if (ui.button('srvcancel', x + w - 21, sy + 2, 18, 'cancel', { h: 1, fg: C.dim, bg: C.bg })) this.joining = false;
    }
    if (window.installPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
      if (ui.button('install', x + 3, sy + 4, w - 6, 'INSTALL AS APP  (own window, no download)', { fg: C.bright })) {
        window.installPrompt.prompt(); window.installPrompt = null;
      }
    }
    this.drawFooter();
  }

  drawMenu() {
    const scr = this.scr, ui = this.ui;
    let y = Math.max(1, Math.floor(scr.rows * 0.14));
    y = this.drawTitle(y);
    const bw = 34;
    const x = Math.floor(scr.cols / 2 - bw / 2);
    y = Math.max(y + 2, Math.floor(scr.rows * 0.52));
    if (ui.button('play', x, y, bw, 'P L A Y', { h: 5, fg: C.bright, border: C.dim })) this.play();
    scr.textC(y + 6, `signed in as ${this.nick}`, C.dim);
    if (ui.button('logout', x + 8, y + 8, bw - 16, 'log out', { h: 1, fg: C.dim, bg: C.bg })) this.logout();
    if (this.status) scr.textC(y + 10, this.status, this.statusErr ? C.red : C.dim);
    this.drawFooter();
  }

  drawFooter() {
    const scr = this.scr, y = scr.rows - 1;
    scr.fill(0, y, scr.cols, 1, ' ', C.dim, C.panel);
    const net = this.net.status === 'online' ? `◦ server online · ${this.online} connected` : `◦ server ${this.net.status}`;
    scr.text(2, y, net, this.net.status === 'online' ? C.dim : C.red, C.panel);
    const r = 'Eigenyth v2.0 · everything here is a character';
    scr.text(scr.cols - [...r].length - 2, y, r, C.line, C.panel);
  }
}

// ── settings live in localStorage; on the player's own PC they are also saved by the
//    local server (/api/prefs), so they survive private game windows ──
const LOCAL = /^(localhost|127\.0\.0\.1)(:|$)/.test(location.host);
function syncPrefs() {
  if (!LOCAL) return Promise.resolve();
  return fetch('/api/prefs').then(r => r.ok ? r.json() : {}).then(p => {
    for (const [k, v] of Object.entries(p || {})) if (k.startsWith('eg_')) try { localStorage.setItem(k, v); } catch {}
  }).catch(() => {}).finally(() => {
    const orig = Storage.prototype.setItem;
    let t = null;
    Storage.prototype.setItem = function (k, v) {
      orig.call(this, k, v);
      if (!String(k).startsWith('eg_')) return;
      clearTimeout(t);
      t = setTimeout(push, 200);
    };
    addEventListener('pagehide', push);
  });
  function push() {
    const all = {};
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key.startsWith('eg_')) all[key] = localStorage.getItem(key); }
    navigator.sendBeacon ? navigator.sendBeacon('/api/prefs', JSON.stringify(all)) : fetch('/api/prefs', { method: 'POST', body: JSON.stringify(all) }).catch(() => {});
  }
}

// if anything crashes, say so on the screen instead of a frozen black window
let errShown = false;
// the browser refuses to capture the mouse right after Esc — harmless (the game stays paused, the next click works)
const harmless = e => /pointer ?lock|exited the lock|requestPointerLock/i.test(String((e && (e.message || e.name)) || e));
function showError(e) {
  if (harmless(e)) { console.warn('ignored:', e && e.message || e); return; }
  console.error(e);
  if (errShown) return; errShown = true;
  const d = document.createElement('pre');
  d.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:70vw;white-space:pre-wrap;background:#200;color:#f88;font:13px monospace;padding:10px;z-index:9;border:1px solid #a33';
  d.textContent = 'Eigenyth error (send a screenshot of this):\n' + (e && (e.stack || e.message) || e);
  document.body.appendChild(d);
}
window.addEventListener('error', ev => showError(ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => {
  // mouse capture refused by the browser (clicked too soon after Esc) — harmless, just click again
  if (/pointer ?lock|exited the lock/i.test(String(ev.reason && ev.reason.message || ev.reason))) { ev.preventDefault(); return; }
  showError(ev.reason);
});

// ── "install as app": the browser can install the game with its own window and icon ──
window.installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.installPrompt = e; });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || LOCAL)) navigator.serviceWorker.register('/sw.js').catch(() => {});

syncPrefs().then(() => {
  try { window.app = new App(); }
  catch (e) {
    document.body.innerHTML = `<pre style="color:#ccc;font:14px monospace;padding:20px">Eigenyth failed to start:\n${e.message}</pre>`;
    console.error(e);
  }
});
