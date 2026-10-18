// ─────────────────────────────────────────────────────────────
//  LOBBY — profile + rank, character stage, mode select, play
//  Everything is drawn with characters.
// ─────────────────────────────────────────────────────────────
import { C } from './ui.js';
import { makePrim, hitPrim, HIT, SPHERE } from './prims.js';
import { paintArt, emblemPainter } from './art.js';

// ── RANKS ── each one has its own symbol, color and emblem.
// The final rank EIGEN (λ — an eigenvalue) is made of ALL the others.
export const TIERS = [
  { g: '.', name: 'DOT',      col: [128, 132, 140] },
  { g: '-', name: 'BLADE',    col: [150, 160, 176] },
  { g: '~', name: 'WAVE',     col: [86, 160, 176] },
  { g: '=', name: 'SHIELD',   col: [86, 172, 132] },
  { g: '*', name: 'STAR',     col: [206, 176, 92] },
  { g: '#', name: 'FORTRESS', col: [214, 124, 60] },
  { g: '$', name: 'SIGIL',    col: [206, 64, 78] },
  { g: '@', name: 'VORTEX',   col: [168, 100, 226] },
  { g: 'λ', name: 'EIGEN',    col: [244, 236, 214] },
];
const FINAL = TIERS.length - 1;
const ROMAN = ['I', 'II', 'III'];
export const RP_PER_DIV = 100;

export function rankOf(rp) {
  const div = Math.floor(Math.max(0, rp) / RP_PER_DIV);
  const tier = Math.min(FINAL, Math.floor(div / 3));
  if (tier === FINAL) return { tier, div: 0, label: 'EIGEN', into: rp - FINAL * 3 * RP_PER_DIV, need: 0 };
  const d = div % 3;
  return { tier, div: d, label: `${TIERS[tier].name} ${ROMAN[d]}`, into: rp % RP_PER_DIV, need: RP_PER_DIV };
}

const art = s => s.split('\n').slice(1, -1);
const EMBLEMS = [
  // DOT — a pebble, the very first symbol
  art(String.raw`
      .---.
   .'   .   '.
  |  .     .  |
  |     .     |
  |  .     .  |
   '.   .   .'
      '---'
`),
  // BLADE — crossed blades
  art(String.raw`
  \           /
   \\   -   //
    \\-----//
  ---==>-<==---
    //-----\\
   //   -   \\
  /           \
`),
  // WAVE — a breaking wave
  art(String.raw`
       .~~~.
     ~~   .~~.
   ~~   ~~   ~~
  ~   ~~  ~~   ~
 ~~ ~~      ~~ ~~
 ~~~~~~~~~~~~~~~
   ~~~~~~~~~~~
`),
  // SHIELD — a barred shield
  art(String.raw`
  .===========.
  ||=========||
  ||=== = ===||
  ||=========||
   \\=======//
    \\=====//
      \\=//
`),
  // STAR — five-pointed star
  art(String.raw`
        *
       ***
 ***************
    *********
    ***   ***
   **       **
  *           *
`),
  // FORTRESS — towers and walls
  art(String.raw`
 #_#   #_#   #_#
 ###   ###   ###
 ###############
 ##  #######  ##
 ##  ##   ##  ##
 ##  ##   ##  ##
 ###############
`),
  // SIGIL — a rune circle
  art(String.raw`
    .-$$$$$-.
  .$   /|\   $.
 $    / | \    $
 $  ----$----  $
 $    \ | /    $
  '$   \|/   $'
    '-$$$$$-'
`),
  // VORTEX — a spiral
  art(String.raw`
    .@@@@@@@.
  @@'       '@@
 @@   .@@@.   @@
 @   @@   @@   @
 @@   '@@@@'  @@
  @@.       .@@
    '@@@@@@@'
`),
];
// EIGEN: concentric layers built from every rank symbol, λ in the core, crown + wings
function eigenEmblem() {
  const layers = ['λ', '@', '$', '#', '*', '=', '~', '-', '.'];
  const rows = ['     ^  ^  ^  ^      '];
  for (let y = -4; y <= 4; y++) {
    let s = '';
    for (let x = -10; x <= 10; x++) {
      const d = Math.hypot(x / 2.1, y);
      const i = Math.floor(d * 1.85);
      s += i < layers.length ? layers[i] : ' ';
    }
    if (y === 0) s = '<' + s.slice(1, -1) + '>';
    rows.push(s);
  }
  return rows;
}
export function emblem(tier) { return tier === FINAL ? eigenEmblem() : EMBLEMS[tier]; }

const GLYPH_TIER = Object.fromEntries(TIERS.map((t, i) => [t.g, i]));
// draw an emblem; in EIGEN every symbol keeps the color of its own rank
// draw a rank emblem as a detailed picture made of tiny symbols (art layer)
export function drawEmblem(scr, cx, y, tier, k = 1, w = 20, h = 9, bg = C.panel) {
  const x = Math.floor(cx - w / 2);
  const [ax, ay, aw, ah] = scr.hole(x, y, w, h);
  paintArt(scr.art, ax, ay, aw, ah, 'emblem' + tier, emblemPainter(tier, TIERS), { k, bg });
  return h;
}

// ★ stars currency: 999 → "999", 1000 → "1K+", 1150 → "1.1K+", 25000 → "25K+", 1.2M → "1.2M+"
export function fmtStars(n) {
  n = Math.max(0, Math.floor(n || 0));
  if (n < 1000) return String(n);
  const unit = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const v = n / unit[0];
  const txt = v < 10 ? (Math.floor(v * 10) / 10).toString() : Math.floor(v).toString();
  return txt + unit[1] + '+';
}
// red badge text: 1..999, then "+999"
export function fmtBadge(n) { return n > 999 ? '+999' : String(n); }
const GOLD = [236, 196, 92];
const ONLINE = [110, 200, 130];

export const MODES = [
  { id: 'dm', name: 'DEATHMATCH', ru: 'обычный', time: '5:00', players: '2-8', ready: true,
    icon: [' \\  |  / ', ' --( )-- ', ' /  |  \\ '],
    desc: ['every player for himself.', 'most kills in 5 minutes', 'wins the round.'] },
  { id: 'cap', name: 'CAPTURE Σ', ru: 'захват', time: '6:00', players: '2v2-4v4', ready: false,
    icon: ['   |>Σ   ', '   |     ', '  _|_    '],
    desc: ['grab the Σ in the center', 'and carry it to your base.', 'carrier glows and is slow.'] },
  { id: 'dark', name: 'BLACKOUT', ru: 'тьма', time: '5:00', players: '2-8', ready: false,
    icon: ['  .   .  ', '    *    ', '  .   .  '],
    desc: ['total darkness. only shots', 'and flashlights give light.', 'every flash shows you.'] },
];

export class Lobby {
  constructor(app) {
    this.app = app;
    this.mode = 0;
    this.tab = 0;
    this.notice = null;
    this.body = makePrim(); this.body.type = SPHERE; this.body.sx = 1;
    this.parts = [0, 1, 2, 3].map(() => { const p = makePrim(); p.type = SPHERE; return p; });
    this.rain = [];
  }
  get profile() {
    return this.app.profile || { rp: 0, stars: 0, kills: 0, deaths: 0, wins: 0, matches: 0, history: [] };
  }

  draw(dt) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows;
    scr.fine.clear(...C.bg);

    // ── top bar ──
    scr.fill(0, 0, cols, 3, ' ', C.text, C.panel);
    for (let x = 0; x < cols; x++) scr.put(x, 2, '-', C.line, C.panel);
    scr.text(2, 1, 'EIGENGLYPH', C.bright, C.panel);
    scr.text(13, 1, ': ΣVOID', C.dim, C.panel);
    scr.text(22, 1, '· season 0 · the first glyph', C.line, C.panel);
    const tabs = ['PLAY', 'FRIENDS', 'RANKS', 'PROFILE'];
    let tx = Math.floor(cols / 2 - 22);
    const reqs = (app.social && app.social.requests || []).length;
    tabs.forEach((name, i) => {
      const w = name.length + 4, on = this.tab === i;
      const hov = ui.over(tx, 0, w, 3);
      if (hov) ui.hot = 'tab' + i;
      if (hov && app.input.mouseClicked[0]) { this.tab = i; app.audio.uiClick(); }
      scr.text(tx + 2, 1, name, on ? C.bright : hov ? C.text : C.dim, C.panel);
      if (on) for (let k = 0; k < w; k++) scr.put(tx + k, 2, '=', C.bright, C.panel);
      // red notification badge in the top-right corner of PROFILE
      if (name === 'PROFILE' && reqs > 0) {
        const b = ` ${fmtBadge(reqs)} `;
        scr.text(tx + w - 1, 0, b, [255, 255, 255], [196, 38, 46]);
      }
      tx += w + 2 + (name === 'PROFILE' ? 3 : 0);
    });
    const r = rankOf(this.profile.rp), tier = TIERS[r.tier];
    const lbl = `${tier.g} ${r.label}`;
    const star = `★ ${fmtStars(this.profile.stars)}`;
    let rx = cols - app.nick.length - 3;
    scr.text(rx, 1, app.nick, C.bright, C.panel);
    rx -= [...lbl].length + 3;
    scr.text(rx, 1, lbl, tier.col, C.panel);
    rx -= [...star].length + 3;
    scr.text(rx, 1, '★', GOLD, C.panel);
    scr.text(rx + 2, 1, fmtStars(this.profile.stars), C.bright, C.panel);

    // keep the friend list fresh while in the lobby
    this.pollT = (this.pollT || 0) - dt;
    if (this.pollT <= 0 && app.net.status === 'online') { this.pollT = 4; app.net.send({ t: 'social' }); }

    if (this.tab === 0) this.drawPlay(dt);
    else if (this.tab === 1) this.drawFriends(dt);
    else if (this.tab === 2) this.drawRanks();
    else this.drawProfile();

    // ── footer ──
    const y = rows - 1;
    scr.fill(0, y, cols, 1, ' ', C.dim, C.panel);
    const on = app.net.status === 'online';
    scr.text(2, y, on ? `◦ ${app.online} online` : `◦ server ${app.net.status}`, on ? C.dim : C.red, C.panel);
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(location.host);
    if (local && app.lan && app.lan.length) scr.textC(y, `you are the host · friends on your Wi-Fi join with:  ${app.lan[0]}`, C.dim, C.panel);
    else scr.textC(y, `server: ${location.host}`, C.line, C.panel);
    if (ui.button('logout', cols - 14, y, 12, 'log out', { h: 1, fg: C.dim, bg: C.panel })) app.logout();
    if (this.notice && (this.notice.t -= dt) > 0) scr.textC(rows - 2, ` ${this.notice.text} `, this.notice.ok ? ONLINE : C.red, C.bg);

    // keyboard shortcuts
    const inp = app.input;
    if (this.tab === 0 && !app.ui.focus) {
      ['Digit1', 'Digit2', 'Digit3'].forEach((k, i) => { if (inp.pressed.has(k)) { this.mode = i; app.audio.uiClick(); } });
      if (inp.pressed.has('Enter')) this.tryPlay();
    }
  }

  tryPlay() {
    const m = MODES[this.mode];
    if (m.ready) this.app.play(m.id);
    else this.notice = { text: `${m.name} is still in development — try DEATHMATCH`, t: 3 };
  }

  // ───────── PLAY tab ─────────
  drawPlay(dt) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows;
    const top = 4, bottom = rows - 2;
    const leftW = 36, rightW = 42;
    const p = this.profile, r = rankOf(p.rp), tier = TIERS[r.tier];
    const lcx = 2 + leftW / 2;

    // ── center stage (drawn first, behind everything) ──
    const sx0 = 2 + leftW + 2, sx1 = cols - rightW - 4;
    const fx0 = sx0 + 6, fx1 = sx1 - 6, fy0 = top, fy1 = bottom - 8;
    this.drawStage('play', scr.hole(fx0 + 1, fy0 + 1, fx1 - fx0 - 2, fy1 - fy0 - 2), dt);
    // frame around the character + stars on its bottom edge
    scr.box(fx0, fy0, fx1 - fx0, fy1 - fy0, tier.col.map(v => v * 0.6), [12, 13, 16], false);
    for (const [cx, cy] of [[fx0, fy0], [fx1 - 1, fy0], [fx0, fy1 - 1], [fx1 - 1, fy1 - 1]]) scr.put(cx, cy, tier.g, tier.col, [12, 13, 16]);
    const st = ` ★ ${fmtStars(p.stars)} `;
    const stx = Math.floor((fx0 + fx1) / 2 - [...st].length / 2);
    scr.text(stx, fy1 - 1, st, C.bright, [20, 21, 25]);
    scr.put(stx + 1, fy1 - 1, '★', GOLD, [20, 21, 25]);

    // ── left: player card ──
    scr.box(2, top, leftW, bottom - top, C.line, C.panel);
    scr.text(4, top, ' PLAYER ', C.dim, C.panel);
    scr.textC(top + 2, app.nick, C.bright, C.panel, lcx);
    let y = top + 4;
    y += drawEmblem(scr, lcx, y, r.tier, 1, 26, 11) + 1;
    scr.textC(y, r.label, tier.col, C.panel, lcx);
    // division pips
    if (r.tier !== FINAL) scr.textC(y + 1, [0, 1, 2].map(i => i <= r.div ? '<#>' : '<.>').join(' '), tier.col, C.panel, lcx);
    y += 3;
    const bw = leftW - 14;
    if (r.need) {
      const f = Math.round(r.into / r.need * bw);
      scr.text(5, y, 'RP', C.dim, C.panel);
      for (let i = 0; i < bw; i++) scr.put(8 + i, y, i < f ? '#' : '.', i < f ? tier.col : C.line, C.panel);
      scr.text(9 + bw, y, `${r.into}/${r.need}`, C.dim, C.panel);
    } else scr.textC(y, `${p.rp} RP`, C.bright, C.panel, lcx);
    y += 2;
    // mini ladder: where you are on the path to EIGEN
    const lad = TIERS.map(t => t.g).join('  ');
    const lx = Math.floor(lcx - [...lad].length / 2);
    TIERS.forEach((t, i) => scr.put(lx + i * 3, y, t.g, i === r.tier ? t.col : i < r.tier ? t.col.map(v => v * 0.5) : C.line, C.panel));
    scr.put(lx + r.tier * 3, y + 1, '^', tier.col, C.panel);
    y += 3;
    for (let i = 3; i < leftW - 1; i++) scr.put(i, y, '-', C.line, C.panel);
    y += 1;
    const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
    const wr = p.matches ? Math.round(p.wins / p.matches * 100) + '%' : '—';
    const stats = [['MATCHES', p.matches, 'WIN %', wr], ['KILLS', p.kills, 'K/D', kd], ['WINS', p.wins, 'DEATHS', p.deaths]];
    stats.forEach(([a, av, b, bv], i) => {
      if (y + i >= bottom - 1) return;
      scr.text(5, y + i, a, C.dim, C.panel); scr.text(19 - String(av).length, y + i, String(av), C.text, C.panel);
      scr.text(21, y + i, b, C.dim, C.panel); scr.text(2 + leftW - 3 - String(bv).length, y + i, String(bv), C.text, C.panel);
    });
    y += 4;
    if (y < bottom - 4) {
      scr.text(5, y, 'LAST MATCHES', C.dim, C.panel);
      const h = (p.history || []).slice(0, Math.max(0, bottom - y - 3));
      if (!h.length) scr.text(5, y + 1, 'no matches yet', C.line, C.panel);
      h.forEach((m, i) => {
        const win = m.place === 1;
        scr.text(5, y + 1 + i, `#${m.place}`, win ? C.bright : C.dim, C.panel);
        scr.text(10, y + 1 + i, m.mode, C.dim, C.panel);
        scr.text(22, y + 1 + i, `${m.k}/${m.d}`, C.text, C.panel);
        const rp = (m.rp > 0 ? '+' : '') + m.rp + (m.rp > 0 ? ' ^' : ' v');
        scr.text(2 + leftW - 3 - [...rp].length, y + 1 + i, rp, m.rp > 0 ? [110, 190, 130] : [200, 80, 80], C.panel);
      });
    }

    // ── under the stage: name + party ──
    const midX = (sx0 + sx1) / 2;
    scr.textC(bottom - 7, `${app.nick}  ·  ${tier.g} ${r.label}`, C.bright, null, midX);
    const slotW = 14, slots = 4, totalW = slots * slotW + (slots - 1) * 2;
    const px = Math.floor(midX - totalW / 2);
    for (let i = 0; i < slots; i++) {
      const x = px + i * (slotW + 2), on = i === 0;
      const hov = !on && ui.over(x, bottom - 4, slotW, 3);
      if (hov) ui.hot = 'slot' + i;
      scr.box(x, bottom - 4, slotW, 3, on ? C.dim : hov ? C.dim : C.line, C.bg);
      if (on) scr.textC(bottom - 3, app.nick.slice(0, slotW - 4), C.bright, C.bg, x + slotW / 2);
      else scr.textC(bottom - 3, '+ invite', hov ? C.text : C.line, C.bg, x + slotW / 2);
      if (hov && app.input.mouseClicked[0]) this.notice = { text: 'party invites are coming in the next update', t: 2.5 };
    }

    // ── right: modes ──
    const rx = cols - rightW - 2;
    scr.text(rx, top, 'SELECT MODE', C.dim);
    let my = top + 1;
    const cardH = 8;
    MODES.forEach((m, i) => {
      const on = this.mode === i;
      const hov = ui.over(rx, my, rightW, cardH);
      if (hov) ui.hot = 'mode' + i;
      if (hov && app.input.mouseClicked[0]) { this.mode = i; app.audio.uiClick(); }
      const bg = on ? [24, 26, 30] : C.panel;
      const brd = on ? C.bright : hov ? C.dim : C.line;
      scr.box(rx, my, rightW, cardH, brd, bg);
      scr.text(rx + 1, my, String(i + 1), on ? C.bright : C.dim, bg);
      m.icon.forEach((l, k) => scr.text(rx + 2, my + 2 + k, l, on ? C.bright : C.dim, bg));
      scr.text(rx + 13, my + 1, m.name, on ? C.bright : C.text, bg);
      scr.text(rx + 14 + [...m.name].length, my + 1, `· ${m.ru}`, C.dim, bg);
      m.desc.forEach((l, k) => scr.text(rx + 13, my + 2 + k, l, C.dim, bg));
      scr.text(rx + 13, my + 6, `time ${m.time}  ·  ${m.players} pl`, on ? C.text : C.line, bg);
      if (!m.ready) scr.text(rx + rightW - 8, my + 6, ' SOON ', [200, 120, 90], [40, 20, 16]);
      if (on) scr.put(rx - 1, my + cardH / 2, '>', C.bright);
      my += cardH + 1;
    });

    // ── play button (pulses) ──
    const m = MODES[this.mode];
    const by = Math.min(my + 1, bottom - 6);
    const pulse = 0.6 + 0.4 * Math.sin(app.time * 3);
    if (ui.button('play', rx, by, rightW, `P L A Y  ·  ${m.name}`, { h: 5, fg: C.bright, border: [200 * pulse + 40, 204 * pulse + 40, 212 * pulse + 40] })) this.tryPlay();
    scr.textC(by + 6, 'ranked · RP changes after every match', C.line, null, rx + rightW / 2);
  }

  // symbol rain + platform + character + orbiting aura of your rank symbol
  drawStage(key, [x0, y0, w, h], dt) {
    const scr = this.app.scr.art, t = this.app.time, D = this.app.scr.ART;
    const r = rankOf(this.profile.rp), tier = TIERS[r.tier], tint = tier.col;
    scr.fill(x0, y0, w, h, ' ', null, [10, 11, 14]);
    // rain
    if (!this.rains) this.rains = {};
    let rain = this.rains[key];
    if (!rain || rain.length !== w) rain = this.rains[key] = Array.from({ length: w }, () => ({ y: Math.random() * h * 2 - h, v: (4 + Math.random() * 8) * D, len: (4 + Math.random() * 10) * D }));
    const glyphs = r.tier === FINAL ? TIERS.map(t => t.g).join('') : '.-~=*#$@'.slice(0, r.tier + 1) + tier.g.repeat(3);
    for (let x = 0; x < w; x++) {
      const c = rain[x];
      if (x % (2 * D)) continue;
      c.y += c.v * dt;
      if (c.y - c.len > h) { c.y = -Math.random() * h; c.v = (4 + Math.random() * 8) * D; }
      for (let k = 0; k < c.len; k++) {
        const yy = Math.floor(c.y) - k;
        if (yy < 0 || yy >= h) continue;
        const a = (1 - k / c.len) * (k === 0 ? 0.5 : 0.22);
        const g = glyphs[(x * 7 + yy * 3 + Math.floor(t * 2)) % glyphs.length];
        const col = (r.tier === FINAL ? TIERS[(x + yy) % FINAL].col : tint).map(v => v * a);
        scr.put(x0 + x, y0 + yy, g, col);
      }
    }
    this.drawCharacter(x0, y0, w, h, tint);
  }

  drawCharacter(x0, y0, w, h, tint) {
    const scr = this.app.scr.art, t = this.app.time;
    const r = rankOf(this.profile.rp), tier = TIERS[r.tier];
    const yaw = Math.sin(t * 0.6) * 0.45;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const bob = Math.sin(t * 2) * 0.04;
    const cz = -5.6, cyy = 0.15 + bob;
    const P = [this.body, ...this.parts];
    this.body.px = 0; this.body.py = cyy; this.body.pz = cz; this.body.sx = 1;
    const set = (p, lx, ly, lz, rad) => { p.px = rx * lx + fx * lz; p.py = cyy + ly; p.pz = cz + rz * lx + fz * lz; p.sx = rad; };
    const sw = Math.sin(t * 2) * 0.08;
    set(this.parts[0], -0.3, 0.28, -0.92, 0.12);
    set(this.parts[1], 0.3, 0.28, -0.92, 0.12);
    set(this.parts[2], 1.05, -0.2 + sw, -0.3, 0.34);
    set(this.parts[3], -1.05, -0.2 - sw, -0.3, 0.34);
    const aspect = (w * scr.cellW) / (h * scr.cellH);
    const tanY = aspect > 1.7 ? 0.3 : 0.42, tanX = tanY * aspect;   // zoom in for wide, short frames
    const ramp = '.,-~:;=!*#$@';
    const L = [-0.5, 0.65, 0.55];
    const proj = (X, Y, Z) => [Math.floor(((X / -Z) / tanX + 1) / 2 * w), Math.floor((1 - (Y / -Z) / tanY) / 2 * h)];
    // aura points (behind the body first, then in front)
    const aura = [];
    const N = 22;
    for (let k = 0; k < N; k++) {
      const a = t * 0.9 + k * Math.PI * 2 / N;
      const X = Math.cos(a) * 1.9, Z = cz + Math.sin(a) * 1.9, Y = cyy - 0.15 + Math.sin(a * 2 + t) * 0.25;
      aura.push([X, Y, Z, k]);
    }
    const drawAura = front => {
      for (const [X, Y, Z, k] of aura) {
        if ((Z > cz) !== front) continue;
        const [px, py] = proj(X, Y, Z);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const near = (Z - cz + 1.9) / 3.8;
        const g = r.tier === FINAL ? TIERS[k % FINAL].g : tier.g;
        const col = (r.tier === FINAL ? TIERS[k % FINAL].col : tint).map(v => v * (0.35 + near * 0.75));
        scr.put(x0 + px, y0 + py, g, col);
      }
    };
    drawAura(false);
    for (let yy = 0; yy < h; yy++) {
      const sy = 1 - (yy + 0.5) / h * 2;
      for (let xx = 0; xx < w; xx++) {
        const sx = (xx + 0.5) / w * 2 - 1;
        let dx = sx * tanX, dy = sy * tanY, dz = -1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let best = 1e9, bi = -1, nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < P.length; i++) {
          const tt = hitPrim(P[i], 0, 0, 0, dx, dy, dz);
          if (tt > 0 && tt < best) { best = tt; bi = i; nx = HIT.nx; ny = HIT.ny; nz = HIT.nz; }
        }
        if (bi < 0) {
          // platform under the character
          const tf = (cyy - 1.0) / dy;
          if (dy < 0 && tf > 0) {
            const hx = dx * tf, hz = dz * tf - cz, d = Math.hypot(hx, hz);
            if (d > 1.55 && d < 1.75) scr.put(x0 + xx, y0 + yy, '=', tint.map(v => v * 0.45));
            else if (d < 1.55) scr.put(x0 + xx, y0 + yy, d < 0.95 ? '.' : ':', [34, 36, 42], [8, 9, 11]);
          }
          continue;
        }
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const facing = Math.max(0, -(nx * dx + ny * dy + nz * dz));
        let lum = 0.3 + ndl * 0.6 + Math.pow(1 - facing, 2.5) * 0.3;
        let col = [112, 116, 128];
        if (bi === 1 || bi === 2) { lum = 1; col = [230, 234, 242]; }
        else if (bi >= 3) { lum = Math.min(1, lum + 0.18); col = [150, 154, 166].map((v, k) => v * 0.6 + tint[k] * 0.4); }
        else col = col.map((v, k) => v * 0.7 + tint[k] * 0.3);
        if (bi >= 3 && facing < 0.35) lum *= 0.45;
        const ch = ramp[Math.min(ramp.length - 1, Math.floor(lum * ramp.length))];
        const k = 0.35 + lum * 1.2;
        scr.put(x0 + xx, y0 + yy, ch, col.map(v => Math.min(255, v * k)), col.map(v => v * k * 0.08));
      }
    }
    drawAura(true);
  }

  // ───────── RANKS tab ─────────
  drawRanks() {
    const app = this.app, scr = app.scr, cols = scr.cols;
    const cur = rankOf(this.profile.rp);
    scr.textC(5, 'THE PATH TO EIGEN', C.bright);
    scr.textC(6, 'every rank has its own symbol · the last rank is made of all of them', C.dim);
    const n = FINAL;                       // 8 regular ranks
    const colW = 22;                       // every emblem is 20 wide → never overlaps
    const perRow = Math.max(1, Math.min(n, Math.floor((cols - 4) / colW)));
    const rowsN = Math.ceil(n / perRow);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), inRow = Math.min(perRow, n - row * perRow);
      const x0 = Math.floor(cols / 2 - (inRow * colW) / 2);
      const t = TIERS[i], x = x0 + (i % perRow) * colW, cx = x + colW / 2, on = cur.tier === i;
      const yy = 8 + row * 14;
      drawEmblem(scr, cx, yy, i, on ? 1 : i < cur.tier ? 0.75 : 0.5, 20, 9, C.bg);
      scr.textC(yy + 9, t.name, on ? C.bright : C.text, null, cx);
      scr.textC(yy + 10, `${i * 300} RP`, C.dim, null, cx);
      if (on) scr.textC(yy + 11, `^ YOU · ${ROMAN[cur.div]}`, t.col, null, cx);
    }
    // the final rank
    const fy = 8 + rowsN * 14;
    for (let x = 4; x < cols - 4; x++) scr.put(x, fy - 1, '-', C.line);
    const on = cur.tier === FINAL;
    const h = drawEmblem(scr, cols / 2, fy + 1, FINAL, on ? 1 : 0.85, 34, 13, C.bg);
    scr.textC(fy + h + 2, 'E I G E N', [244, 236, 214]);
    scr.textC(fy + h + 3, `${FINAL * 300}+ RP · final rank · λ in its core, every rank around it`, C.dim);
    if (on) scr.textC(fy + h + 4, '^ YOU', [244, 236, 214]);
    const lines = [
      'each rank has 3 divisions (I · II · III), 100 RP each',
      'win  +25 RP    top 3  +10 RP    kill  +2 RP    loss  -15 RP',
    ];
    lines.forEach((l, i) => scr.textC(fy + h + 6 + i, l, C.dim));
  }

  // ───────── FRIENDS tab ─────────
  drawFriends(dt) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows;
    const top = 4, bottom = rows - 2;
    const lw = Math.min(70, Math.floor(cols * 0.48)), lx = 2;
    const rx = lx + lw + 3, rw = cols - rx - 2;
    const soc = app.social || { friends: [], requests: [], outgoing: [] };

    // ── left: find players ──
    scr.box(lx, top, lw, bottom - top, C.line, C.panel);
    scr.text(lx + 2, top, ' FIND PLAYERS ', C.dim, C.panel);
    this.query = ui.field('search', lx + 2, top + 2, lw - 22, this.query || '', {
      label: 'NICKNAME', max: 16, placeholder: 'type a nickname…', onEnter: () => this.doSearch(),
    });
    if (ui.button('addf', lx + lw - 19, top + 2, 17, 'ADD FRIEND')) {
      const q = (this.query || '').trim();
      if (q) app.net.send({ t: 'friendAdd', name: q });
    }
    // live search while typing
    if ((this.query || '') !== this.lastQ) { this.lastQ = this.query || ''; this.searchT = 0.25; }
    if (this.searchT !== undefined && (this.searchT -= dt) <= 0) { this.searchT = undefined; this.doSearch(); }
    const list = (app.searchRes && app.searchRes.list) || [];
    let y = top + 6;
    scr.text(lx + 3, y, 'PLAYER', C.dim, C.panel);
    scr.text(lx + lw - 36, y, 'RANK', C.dim, C.panel);
    for (let i = 3; i < lw - 1; i++) scr.put(lx + i - 1, y + 1, '-', C.line, C.panel);
    y += 2;
    if (!list.length) scr.text(lx + 3, y, 'no players found', C.line, C.panel);
    list.forEach((pl, i) => {
      const yy = y + i * 2;
      if (yy >= bottom - 1) return;
      const r = rankOf(pl.rp), t = TIERS[r.tier];
      scr.put(lx + 3, yy, pl.online ? '●' : '○', pl.online ? ONLINE : C.line, C.panel);
      scr.text(lx + 5, yy, pl.name, pl.rel === 'you' ? C.bright : C.text, C.panel);
      scr.text(lx + lw - 36, yy, `${t.g} ${r.label}`, t.col, C.panel);
      const bx = lx + lw - 15;
      if (pl.rel === 'none') { if (ui.button('add' + pl.name, bx, yy, 12, '+ ADD', { h: 1, fg: C.bright })) app.net.send({ t: 'friendAdd', name: pl.name }); }
      else if (pl.rel === 'incoming') { if (ui.button('acc' + pl.name, bx, yy, 12, 'ACCEPT', { h: 1, fg: ONLINE })) app.net.send({ t: 'friendAccept', name: pl.name }); }
      else scr.text(bx + 1, yy, { friend: 'FRIEND ✓', pending: 'PENDING…', you: 'YOU' }[pl.rel], C.dim, C.panel);
    });

    // ── right: your friends ──
    scr.box(rx, top, rw, bottom - top, C.line, C.panel);
    const fr = [...soc.friends].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    const on = fr.filter(f => f.online).length;
    scr.text(rx + 2, top, ` FRIENDS ${on}/${fr.length} online `, C.dim, C.panel);
    let fy = top + 2;
    if (!fr.length) {
      scr.text(rx + 3, fy, 'no friends yet', C.line, C.panel);
      scr.text(rx + 3, fy + 1, 'find a player on the left and press ADD', C.line, C.panel);
    }
    fr.forEach((f, i) => {
      const yy = fy + i * 3;
      if (yy >= bottom - 2) return;
      const r = rankOf(f.rp), t = TIERS[r.tier];
      scr.put(rx + 3, yy, f.online ? '●' : '○', f.online ? ONLINE : C.line, C.panel);
      scr.text(rx + 5, yy, f.name, f.online ? C.bright : C.text, C.panel);
      scr.text(rx + 5, yy + 1, f.ingame ? 'in a match' : f.online ? 'in the lobby' : 'offline', f.online ? ONLINE : C.line, C.panel);
      scr.text(rx + rw - 30, yy, `${t.g} ${r.label}`, t.col, C.panel);
      scr.text(rx + rw - 30, yy + 1, '★', GOLD, C.panel);
      scr.text(rx + rw - 28, yy + 1, fmtStars(f.stars), C.dim, C.panel);
      if (ui.button('rm' + f.name, rx + rw - 12, yy, 10, 'remove', { h: 1, fg: C.line })) app.net.send({ t: 'friendRemove', name: f.name });
    });
    if (soc.outgoing && soc.outgoing.length) {
      const oy = Math.max(fy + fr.length * 3 + 1, bottom - 3);
      if (oy < bottom - 1) scr.text(rx + 3, oy, `sent: ${soc.outgoing.join(', ')}`.slice(0, rw - 6), C.line, C.panel);
    }
  }
  doSearch() { this.app.net.send({ t: 'search', q: (this.query || '').trim() }); }

  // ───────── PROFILE tab ─────────
  drawProfile() {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows;
    const top = 4, bottom = rows - 2;
    const p = this.profile, r = rankOf(p.rp), tier = TIERS[r.tier];
    const lw = Math.min(64, Math.floor(cols * 0.45)), lx = 2, cx = lx + lw / 2;
    const rx = lx + lw + 3, rw = cols - rx - 2;
    // ── left: your profile card ──
    scr.box(lx, top, lw, bottom - top, tier.col.map(v => v * 0.5), C.panel);
    scr.text(lx + 2, top, ' PROFILE ', C.dim, C.panel);
    scr.textC(top + 2, app.nick, C.bright, C.panel, cx);
    // your character, in a frame, made of tiny symbols
    const fh = Math.max(10, Math.min(18, rows - 36)), fw = lw - 8;
    const fx = lx + 4, fy = top + 4;
    this.drawStage('profile', scr.hole(fx + 1, fy + 1, fw - 2, fh - 2), 1 / 60);
    scr.box(fx, fy, fw, fh, tier.col.map(v => v * 0.6), [12, 13, 16], false);
    let y = fy + fh + 1;
    // emblem on the left, rank text on the right
    drawEmblem(scr, lx + 14, y, r.tier, 1, 22, 10);
    const tx = lx + 27;
    scr.text(tx, y + 3, r.label, tier.col, C.panel);
    scr.text(tx, y + 4, `${p.rp} RP`, C.text, C.panel);
    scr.put(tx, y + 6, '★', GOLD, C.panel);
    scr.text(tx + 2, y + 6, `${fmtStars(p.stars)} stars`, C.bright, C.panel);
    y += 9;
    y += 1;
    for (let i = lx + 2; i < lx + lw - 2; i++) scr.put(i, y, '-', C.line, C.panel);
    y += 1;
    const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : (p.kills || 0).toFixed(2);
    const wr = p.matches ? Math.round(p.wins / p.matches * 100) + '%' : '-';
    const since = p.since ? new Date(p.since).toLocaleDateString() : '-';
    const rowsS = [['MATCHES', p.matches || 0], ['WINS', p.wins || 0], ['WIN RATE', wr], ['KILLS', p.kills || 0],
      ['DEATHS', p.deaths || 0], ['K/D', kd], ['FRIENDS', (app.social && app.social.friends.length) || 0], ['PLAYING SINCE', since]];
    rowsS.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = lx + 3 + col * Math.floor((lw - 4) / 2), w = Math.floor((lw - 4) / 2) - 3;
      scr.text(x, y + row, k, C.dim, C.panel);
      scr.text(x + w - String(v).length, y + row, String(v), C.text, C.panel);
    });
    y += 5;
    scr.text(lx + 3, y, 'MATCH HISTORY', C.dim, C.panel);
    const h = (p.history || []);
    if (!h.length) scr.text(lx + 3, y + 1, 'no matches yet', C.line, C.panel);
    h.forEach((m, i) => {
      const yy = y + 1 + i;
      if (yy >= bottom - 1) return;
      scr.text(lx + 3, yy, `#${m.place}`, m.place === 1 ? GOLD : C.dim, C.panel);
      scr.text(lx + 8, yy, m.mode, C.dim, C.panel);
      scr.text(lx + 21, yy, `${m.k}/${m.d}`, C.text, C.panel);
      const rp = (m.rp > 0 ? '+' : '') + m.rp + ' RP';
      scr.text(lx + lw - 3 - rp.length, yy, rp, m.rp > 0 ? ONLINE : [200, 80, 80], C.panel);
    });

    // ── right: notifications (friend requests + news) ──
    const soc = app.social || { requests: [], notes: [] };
    scr.box(rx, top, rw, bottom - top, C.line, C.panel);
    const reqs = soc.requests || [];
    scr.text(rx + 2, top, ' NOTIFICATIONS ', C.dim, C.panel);
    if (reqs.length) scr.text(rx + 17, top, ` ${fmtBadge(reqs.length)} `, [255, 255, 255], [196, 38, 46]);
    let ny = top + 2;
    scr.text(rx + 3, ny, 'FRIEND REQUESTS', C.text, C.panel);
    ny += 1;
    if (!reqs.length) { scr.text(rx + 3, ny, 'no new requests', C.line, C.panel); ny += 1; }
    reqs.forEach(q => {
      if (ny >= bottom - 6) return;
      const rr = rankOf(q.rp), t = TIERS[rr.tier];
      scr.put(rx + 3, ny + 1, '!', [255, 255, 255], [196, 38, 46]);
      scr.text(rx + 5, ny + 1, q.name, C.bright, C.panel);
      scr.text(rx + 6 + q.name.length, ny + 1, `${t.g} ${rr.label}`, t.col, C.panel);
      scr.text(rx + 5, ny + 2, 'wants to be your friend', C.dim, C.panel);
      if (ui.button('pa' + q.name, rx + rw - 26, ny + 1, 11, 'ACCEPT', { h: 1, fg: ONLINE })) app.net.send({ t: 'friendAccept', name: q.name });
      if (ui.button('pd' + q.name, rx + rw - 13, ny + 1, 11, 'decline', { h: 1, fg: C.dim })) app.net.send({ t: 'friendDecline', name: q.name });
      ny += 4;
    });
    ny += 1;
    for (let i = rx + 2; i < rx + rw - 2; i++) scr.put(i, ny, '-', C.line, C.panel);
    ny += 1;
    scr.text(rx + 3, ny, 'RECENT', C.text, C.panel);
    (soc.notes || []).forEach((n, i) => {
      const yy = ny + 1 + i;
      if (yy >= bottom - 1) return;
      const ago = Math.max(0, Math.round((Date.now() - n.at) / 60000));
      const when = ago < 1 ? 'now' : ago < 60 ? `${ago}m` : ago < 1440 ? `${Math.round(ago / 60)}h` : `${Math.round(ago / 1440)}d`;
      scr.text(rx + 3, yy, '·', C.dim, C.panel);
      scr.text(rx + 5, yy, n.text.slice(0, rw - 14), C.text, C.panel);
      scr.text(rx + rw - 3 - when.length, yy, when, C.line, C.panel);
    });
  }
}
