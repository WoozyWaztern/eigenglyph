// ─────────────────────────────────────────────────────────────
//  LOBBY — profile + rank, character stage, mode select, play
//  Everything is drawn with characters.
// ─────────────────────────────────────────────────────────────
import { C } from './ui.js';
import { makePrim, hitPrim, HIT, SPHERE } from './prims.js';
import { paintArt, emblemPainter } from './art.js';
import { drawItemIcon } from './items.js';
import { ITEMS, CATS, ITEM_IDX, ownedItems, itemStats, loadoutOf, rankFromElo, rankStart, RANK_DIV } from '../../shared/world.js';

const TAB_SHOP = 3, TAB_INV = 4, TAB_PROFILE = 5;

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
// ELO → rank. Every rank (EIGEN too) has 3 divisions: I · II · III (table in shared/world.js)
export function rankOf(elo) {
  elo = Math.max(0, Math.floor(elo || 0));
  const r = rankFromElo(elo);
  return { tier: r.tier, div: r.div, label: `${TIERS[r.tier].name} ${ROMAN[r.div]}`,
    into: elo - r.start, need: r.next ? r.next - r.start : 0, elo, next: r.next };
}
export const fmtElo = n => Math.floor(n || 0).toLocaleString('en-US').replace(/,/g, ' ');

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
// the emblem cut out along its own outline: no box around it (UI cells are opened only where the emblem is)
export function drawEmblemCut(scr, cx, y, tier, k = 1, w = 20, h = 9) {
  const x = Math.floor(cx - w / 2), A = scr.ART;
  const ax = x * A, ay = y * A, aw = w * A, ah = h * A;
  const cells = paintArt(scr.art, ax, ay, aw, ah, 'emblem' + tier, emblemPainter(tier, TIERS), { k, bg: [6, 6, 8], cut: true });
  for (let cyy = 0; cyy < h; cyy++) for (let cxx = 0; cxx < w; cxx++) {
    let any = false;
    for (let j = 0; j < A && !any; j++) for (let i = 0; i < A; i++) if (cells[(cyy * A + j) * aw + cxx * A + i]) { any = true; break; }
    if (any) scr.hole(x + cxx, y + cyy, 1, 1);
  }
  return h;
}
export function drawEmblem(scr, cx, y, tier, k = 1, w = 20, h = 9, bg = C.panel) {
  const x = Math.floor(cx - w / 2);
  const [ax, ay, aw, ah] = scr.hole(x, y, w, h);
  paintArt(scr.art, ax, ay, aw, ah, 'emblem' + tier, emblemPainter(tier, TIERS), { k, bg });
  return h;
}

// ★ stars currency: 999 → "999", 1000 → "1K+", 1150 → "1.1K+", 25000 → "25K+", 1.2M → "1.2M+"
const STAR_UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
export function fmtStars(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (!Number.isFinite(n)) return '∞';
  if (n < 1000) return String(n);
  if (n >= 1e100) { const e = Math.floor(Math.log10(n) + 1e-9), v = n / Math.pow(10, e); return e === 100 && v < 1.05 ? 'GOOGOL+' : `${Math.floor(v * 10) / 10}e${e}+`; }
  const k = Math.min(STAR_UNITS.length, Math.floor(Math.log10(n) / 3 + 1e-9));
  if (k > STAR_UNITS.length - 1 && n >= 1e66) { const e = Math.floor(Math.log10(n) + 1e-9); return `${Math.floor(n / Math.pow(10, e) * 10) / 10}e${e}+`; }
  const v = n / Math.pow(10, k * 3);
  const txt = v < 10 ? (Math.floor(v * 10) / 10).toString() : Math.floor(v).toString();
  return txt + STAR_UNITS[k - 1] + '+';
}
// red badge text: 1..999, then "+999"
export function fmtBadge(n) { return n > 999 ? '+999' : String(n); }
const GOLD = [236, 196, 92];
const ONLINE = [110, 200, 130];

export const MODES = [
  { id: 'dm', name: 'DEATHMATCH', ru: 'обычный', time: '5:00', players: '2-8 pl', ready: true,
    icon: [' \  |  / ', ' --( )-- ', ' /  |  \ '],
    desc: ['every player for himself.', 'most kills in 5 minutes', 'wins the round.'] },
  { id: 'cap', name: 'CAPTURE Σ', ru: 'захват', time: '6:00', players: '2 teams', ready: true,
    icon: ['   |>Σ   ', '   |     ', '  _|_    '],
    desc: ['grab the Σ in the center', 'and carry it to your base.', 'carrier is slow · first to 3.'] },
  { id: 'dark', name: 'BLACKOUT', ru: 'тьма', time: '5:00', players: '2-8 pl', ready: true,
    icon: ['  .   .  ', '    *    ', '  .   .  '],
    desc: ['total darkness. only shots', 'and flashlights give light.', 'F = your flashlight.'] },
  { id: 'zombie', name: 'ZOMBIES', ru: 'зомби', time: '50 waves', players: 'solo / party', ready: true,
    icon: ['  (x x)  ', '  /|=|\\  ', ' _/   \\_ '],
    desc: ['hold off waves of zombies,', 'alone or with your party.', '+1★ a zombie · wave bonus.'] },
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
    scr.text(2, 1, 'EIGENYTH', C.bright, C.panel);
    scr.text(12, 1, '· season 0 · the first glyph', C.line, C.panel);
    const tabs = ['PLAY', 'FRIENDS', 'RANKS', 'SHOP', 'INVENTORY', 'PROFILE'];
    let tx = Math.floor(cols / 2 - (tabs.reduce((a, n) => a + n.length + 6, 0) + 1) / 2);
    const reqs = (app.social && app.social.requests || []).length;
    tabs.forEach((name, i) => {
      const w = name.length + 4, on = this.tab === i;
      const hov = ui.over(tx, 0, w, 3);
      if (hov) ui.hot = 'tab' + i;
      if (hov && app.input.mouseClicked[0]) { this.tab = i; if (i === TAB_PROFILE) this.viewing = null; this.popup = null; app.audio.uiClick(); }
      scr.text(tx + 2, 1, name, on ? C.bright : hov ? C.text : C.dim, C.panel);
      if (name === 'SHOP') scr.put(tx + 1, 1, '★', on || hov ? GOLD : GOLD.map(v => v * 0.6), C.panel);
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

    // while an item popup is open, clicks belong to the popup only
    const popOpen = this.popup !== null && this.popup !== undefined;
    const click = app.input.mouseClicked[0];
    if (popOpen || this.invitePick) app.input.mouseClicked[0] = false;
    if (this.tab === 0) this.drawPlay(dt);
    else if (this.tab === 1) this.drawFriends(dt);
    else if (this.tab === 2) this.drawRanks();
    else if (this.tab === TAB_SHOP) this.drawShop(dt);
    else if (this.tab === TAB_INV) this.drawInventory(dt);
    else this.drawProfile();
    if (popOpen) { app.input.mouseClicked[0] = click; this.drawPopup(); }
    app.input.mouseClicked[0] = click;
    this.drawParty();
    if (this.rankUp) this.drawRankUp(dt);

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
      ['Digit1', 'Digit2', 'Digit3', 'Digit4'].forEach((k, i) => { if (inp.pressed.has(k)) { this.mode = i; app.audio.uiClick(); } });
      if (inp.pressed.has('Enter')) this.tryPlay();
    }
  }

  tryPlay() {
    const m = MODES[this.mode], pa = this.app.party;
    // in a party only the leader picks the mode; members join the leader's match
    if (pa && pa.members.length > 1 && pa.leader !== this.app.nick) {
      const lead = pa.members.find(x => x.leader);
      if (lead && lead.ingame) { this.app.play(lead.ingame); return; }
      this.notice = { text: `waiting for ${pa.leader} — the party leader starts the match`, t: 3 }; return;
    }
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
    scr.textC(y + 1, [0, 1, 2].map(i => i <= r.div ? '<#>' : '<.>').join(' '), tier.col, C.panel, lcx);
    y += 3;
    const bw = leftW - 14;
    const bw2 = leftW - 8;
    if (r.need) {
      const f = Math.round(r.into / r.need * bw2);
      for (let i = 0; i < bw2; i++) scr.put(5 + i, y, i < f ? '#' : '.', i < f ? tier.col : C.line, C.panel);
      scr.textC(y + 1, `ELO ${fmtElo(p.rp)}  ·  next at ${fmtElo(r.next)}`, C.dim, C.panel, lcx);
    } else scr.textC(y, `ELO ${fmtElo(p.rp)} · max rank`, C.bright, C.panel, lcx);
    y += 1;
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
        const rp = m.mode === 'ZOMBIES' ? `wave ${m.wave || m.place}` : (m.rp > 0 ? '+' : '') + m.rp + (m.rp > 0 ? ' ^' : ' v');
        scr.text(2 + leftW - 3 - [...rp].length, y + 1 + i, rp, m.rp > 0 ? [110, 190, 130] : [200, 80, 80], C.panel);
      });
    }

    // ── under the stage: name + party ──
    const midX = (sx0 + sx1) / 2;
    scr.textC(bottom - 7, `${app.nick}  ·  ${tier.g} ${r.label}`, C.bright, null, midX);
    const slotW = 14, slots = 4, totalW = slots * slotW + (slots - 1) * 2;
    const px = Math.floor(midX - totalW / 2);
    // party: you first, then the other members; empty slots invite friends
    const pa = app.party && app.party.members.length > 1 ? app.party : null;
    const iLead = !pa || pa.leader === app.nick;
    const mem = pa ? [pa.members.find(x => x.name === app.nick), ...pa.members.filter(x => x.name !== app.nick)].filter(Boolean) : [{ name: app.nick, leader: true }];
    for (let i = 0; i < slots; i++) {
      const x = px + i * (slotW + 2), M = mem[i], me = i === 0;
      const hov = !me && ui.over(x, bottom - 4, slotW, 3);
      if (hov) ui.hot = 'slot' + i;
      scr.box(x, bottom - 4, slotW, 3, M ? (M.leader && pa ? GOLD : C.dim) : hov ? C.dim : C.line, C.bg);
      if (M) {
        const tag = (M.leader && pa ? '★' : '') + M.name;
        scr.textC(bottom - 3, (hov && iLead && pa ? 'kick' : tag).slice(0, slotW - 2), me ? C.bright : M.online ? C.text : C.line, C.bg, x + slotW / 2);
        if (M.ingame) scr.textC(bottom - 4, ` ${M.ingame === 'zombie' ? 'ZOMBIES' : M.ingame.toUpperCase()} `, ONLINE, C.bg, x + slotW / 2);
        if (hov && iLead && pa && app.input.mouseClicked[0]) app.net.send({ t: 'pkick', name: M.name });
      } else {
        scr.textC(bottom - 3, '+ invite', hov ? C.text : C.line, C.bg, x + slotW / 2);
        if (hov && app.input.mouseClicked[0]) { this.invitePick = true; this.invNick = ''; app.audio.uiClick(); }
      }
    }
    if (pa) {
      scr.textC(bottom - 1, iLead ? 'you lead · your PLAY starts the match for everyone' : `${pa.leader} leads · you join their match`, C.line, null, midX);
      if (ui.button('pleave', px + totalW + 2, bottom - 4, 9, 'leave', { h: 1, fg: C.dim, bg: C.bg })) app.net.send({ t: 'pleave' });
    }

    // ── right: modes ──
    const rx = cols - rightW - 2;
    scr.text(rx, top, 'SELECT MODE', C.dim);
    let my = top + 1;
    const cardH = Math.max(6, Math.min(8, Math.floor((bottom - top - 12) / MODES.length) - 1));
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
      m.desc.forEach((l, k) => scr.text(rx + 13, my + 2 + k, l.slice(0, rightW - 14), C.dim, bg));
      scr.text(rx + 13, my + cardH - 2, `time ${m.time}  ·  ${m.players}`, on ? C.text : C.line, bg);
      if (!m.ready) scr.text(rx + rightW - 8, my + cardH - 2, ' SOON ', [200, 120, 90], [40, 20, 16]);
      if (on) scr.put(rx - 1, my + cardH / 2, '>', C.bright);
      my += cardH + 1;
    });

    // ── play button (pulses) ──
    const m = MODES[this.mode];
    const by = Math.min(my + 1, bottom - 6);
    const pulse = 0.6 + 0.4 * Math.sin(app.time * 3);
    const pty = app.party && app.party.members.length > 1 ? app.party : null, follower = pty && pty.leader !== app.nick;
    const lead = follower && pty.members.find(x => x.leader);
    const label = follower ? (lead && lead.ingame ? `J O I N  ·  ${pty.leader}` : 'WAITING FOR LEADER') : `P L A Y  ·  ${m.name}${pty ? '  ·  PARTY' : ''}`;
    if (ui.button('play', rx, by, rightW, label, { h: 5, fg: C.bright, border: [200 * pulse + 40, 204 * pulse + 40, 212 * pulse + 40] })) this.tryPlay();
    scr.textC(by + 6, m.id === 'zombie' ? (pty ? 'co-op · fallen players return after each wave' : 'solo or invite friends · stars for every zombie') : 'ranked · ELO changes after every match', C.line, null, rx + rightW / 2);
  }

  // symbol rain + platform + character + orbiting aura of your rank symbol
  drawStage(key, [x0, y0, w, h], dt, rp = this.profile.rp) {
    const scr = this.app.scr.art, t = this.app.time, D = this.app.scr.ART;
    const r = rankOf(rp), tier = TIERS[r.tier], tint = tier.col;
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
    this.drawCharacter(x0, y0, w, h, tint, rp);
  }

  drawCharacter(x0, y0, w, h, tint, rp = this.profile.rp) {
    const scr = this.app.scr.art, t = this.app.time;
    const r = rankOf(rp), tier = TIERS[r.tier];
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


  // ═════════════════════════ SHOP · INVENTORY ═════════════════════════
  get inv() { return this.profile.inv || []; }
  owns(idx, inv = this.inv) { const it = ITEMS[idx]; return it.starter || inv.includes(it.id); }

  // a department list on the left (ALL + every category); returns the chosen category id
  drawCats(key, x, y, w, counts, label) {
    const app = this.app, scr = app.scr, ui = app.ui;
    if (this[key] === undefined) this[key] = 'all';
    scr.text(x, y, label, C.dim);
    y += 1;
    const list = [{ id: 'all', name: 'ALL ITEMS', ru: 'все', g: '◦' }, ...CATS];
    for (const c of list) {
      const on = this[key] === c.id, hov = ui.over(x, y, w, 3);
      if (hov) ui.hot = key + c.id;
      if (hov && app.input.mouseClicked[0]) { this[key] = c.id; app.audio.uiClick(); }
      const bg = on ? [26, 28, 32] : C.panel;
      scr.box(x, y, w, 3, on ? C.bright : hov ? C.dim : C.line, bg);
      scr.put(x + 2, y + 1, c.g, on ? GOLD : C.dim, bg);
      scr.text(x + 4, y + 1, c.name, on ? C.bright : hov ? C.text : C.dim, bg);
      const n = String(counts[c.id] || 0);
      scr.text(x + w - 2 - n.length, y + 1, n, on ? C.text : C.line, bg);
      if (w - 8 - c.name.length - n.length > c.ru.length) scr.text(x + 5 + c.name.length, y + 1, c.ru, C.line, bg);
      if (on) scr.put(x + w, y + 1, '>', C.bright);
      y += 3;
    }
    return y;
  }

  // a card: the 3D item drawn with lots of tiny symbols, name, and a price / tag line
  drawItemCard(id, x, y, w, h, idx, sub, subCol, selected) {
    const app = this.app, scr = app.scr, ui = app.ui, it = ITEMS[idx];
    const hov = ui.over(x, y, w, h);
    if (hov) ui.hot = id;
    const bg = selected ? [26, 28, 32] : hov ? [21, 22, 26] : [13, 14, 17];
    scr.box(x, y, w, h, selected ? C.bright : hov ? C.dim : C.line, bg);
    const ih = h - 4;
    scr.hole(x + 1, y + 1, w - 2, ih);
    const A = scr.ART;
    drawItemIcon(scr.art, (x + 1) * A, (y + 1) * A, (w - 2) * A, ih * A, idx, app.time, selected || hov, bg);
    scr.fill(x + 1, y + h - 3, w - 2, 2, ' ', null, bg);
    scr.textC(y + h - 3, it.name, selected ? C.bright : C.text, bg, x + w / 2);
    if (sub) {
      const n = [...sub].length, sx = Math.floor(x + w / 2 - n / 2);
      scr.text(sx, y + h - 2, sub, subCol || C.dim, bg);
      if (sub[0] === '★') scr.put(sx, y + h - 2, '★', GOLD, bg);
    }
    const cat = CATS.find(c => c.id === it.cat);
    scr.text(x + 2, y, ` ${cat.g} `, C.dim, bg);
    return hov && app.input.mouseClicked[0];
  }

  // full description of an item: big icon, text, stat bars; `action(y)` draws the bottom part
  drawItemDetail(x, y, w, h, idx, action) {
    const app = this.app, scr = app.scr, it = ITEMS[idx], cat = CATS.find(c => c.id === it.cat);
    scr.box(x, y, w, h, C.line, C.panel);
    scr.text(x + 2, y, ` ${cat.name} · ${cat.ru} `, C.dim, C.panel);
    const ih = Math.max(8, Math.min(16, h - 26));
    const bg = [12, 13, 16];
    scr.box(x + 2, y + 2, w - 4, ih + 2, C.line, bg, true);
    scr.hole(x + 3, y + 3, w - 6, ih);
    const A = scr.ART;
    drawItemIcon(scr.art, (x + 3) * A, (y + 3) * A, (w - 6) * A, ih * A, idx, app.time, true, bg);
    let yy = y + ih + 5;
    scr.text(x + 3, yy, it.name, C.bright, C.panel);
    if (it.starter) scr.text(x + w - 12, yy, 'STARTER', C.dim, C.panel);
    yy += 2;
    for (const l of it.desc) { scr.text(x + 3, yy, l, C.text, C.panel); yy++; }
    yy += 1;
    const bw = Math.max(8, w - 34);
    for (const [label, , f, txt] of itemStats(it.id)) {
      scr.text(x + 3, yy, label, C.dim, C.panel);
      const n = Math.round(Math.max(0, Math.min(1, f)) * bw);
      for (let i = 0; i < bw; i++) scr.put(x + 15 + i, yy, i < n ? '#' : '.', i < n ? C.text : C.line, C.panel);
      scr.text(x + 16 + bw, yy, txt, C.dim, C.panel);
      yy++;
    }
    yy += 1;
    for (let i = x + 2; i < x + w - 2; i++) scr.put(i, yy, '-', C.line, C.panel);
    if (action) action(yy + 1);
  }

  // ───────── SHOP tab ─────────
  drawShop(dt) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows, top = 4, bottom = rows - 2;
    const stars = this.profile.stars || 0;
    const forSale = ITEMS.map((it, i) => i).filter(i => !ITEMS[i].starter);
    const counts = { all: forSale.length };
    for (const i of forSale) counts[ITEMS[i].cat] = (counts[ITEMS[i].cat] || 0) + 1;
    const lw = 28;
    let y = this.drawCats('shopCat', 2, top, lw, counts, 'DEPARTMENTS · отделы');
    // wallet
    y += 1;
    scr.box(2, y, lw, 7, GOLD.map(v => v * 0.5), C.panel);
    scr.text(4, y, ' WALLET ', C.dim, C.panel);
    scr.put(4, y + 2, '★', GOLD, C.panel);
    scr.text(6, y + 2, `${fmtStars(stars)} stars`, C.bright, C.panel);
    scr.text(4, y + 4, 'kill +5 · top 3 +20', C.line, C.panel);
    scr.text(4, y + 5, 'win +50 · match +10', C.line, C.panel);

    // right: item details
    const rw = Math.min(56, Math.floor(cols * 0.3)), rx = cols - rw - 2;
    const mx = 2 + lw + 3, mw = rx - mx - 2;
    const list = forSale.filter(i => this.shopCat === 'all' || ITEMS[i].cat === this.shopCat);
    if (this.shopSel === undefined || !list.includes(this.shopSel)) this.shopSel = list[0];
    // middle: cards
    scr.text(mx, top, 'S H O P', C.bright);
    scr.text(mx + 9, top, '· buy weapons for ★ stars · bought items stay forever', C.dim);
    const cw = Math.max(26, Math.min(40, Math.floor((mw - 2) / 3) - 2)), ch = 15;
    const per = Math.max(1, Math.floor((mw + 2) / (cw + 2)));
    list.forEach((idx, k) => {
      const x = mx + (k % per) * (cw + 2), yy = top + 2 + Math.floor(k / per) * (ch + 1);
      if (yy + ch > bottom) return;
      const it = ITEMS[idx], own = this.owns(idx);
      const sub = own ? 'OWNED ✓' : `★ ${it.price}`;
      const col = own ? ONLINE : stars >= it.price ? C.bright : [200, 110, 100];
      if (this.drawItemCard('shop' + idx, x, yy, cw, ch, idx, sub, col, this.shopSel === idx)) { this.shopSel = idx; this.confirm = null; app.audio.uiClick(); }
    });
    if (!list.length) scr.text(mx, top + 3, 'nothing here yet — more items soon', C.line);
    if (this.shopSel === undefined) return;
    this.drawItemDetail(rx, top, rw, bottom - top, this.shopSel, yy => this.drawBuy(this.shopSel, rx, yy, rw, bottom));
  }

  drawBuy(idx, x, y, w, bottom) {
    const app = this.app, scr = app.scr, ui = app.ui, it = ITEMS[idx];
    const stars = this.profile.stars || 0, own = this.owns(idx);
    scr.text(x + 3, y + 1, 'PRICE', C.dim, C.panel);
    scr.put(x + 10, y + 1, '★', GOLD, C.panel);
    scr.text(x + 12, y + 1, `${it.price}`, C.bright, C.panel);
    const have = `you have ★ ${fmtStars(stars)}`;
    scr.text(x + w - 3 - have.length, y + 1, have, C.dim, C.panel);
    const by = Math.min(y + 3, bottom - 4), bw = w - 6;
    if (this.confirm && this.confirm.idx === idx && (this.confirm.t -= 1 / 60) <= 0) this.confirm = null;
    if (own) {
      scr.box(x + 3, by, bw, 3, ONLINE.map(v => v * 0.5), C.panel);
      scr.textC(by + 1, 'OWNED ✓  ·  in your INVENTORY', ONLINE, C.panel, x + w / 2);
    } else if (stars < it.price) {
      scr.box(x + 3, by, bw, 3, C.line, C.panel);
      scr.textC(by + 1, `need ${it.price - stars} more ★`, [200, 110, 100], C.panel, x + w / 2);
    } else if (this.confirm && this.confirm.idx === idx) {
      if (ui.button('buyok', x + 3, by, bw, `CONFIRM · spend ★ ${it.price}`, { fg: GOLD, border: GOLD })) {
        app.net.send({ t: 'buy', id: it.id }); this.confirm = null;
      }
    } else if (ui.button('buy', x + 3, by, bw, `BUY  ·  ★ ${it.price}`, { fg: C.bright, border: C.dim })) {
      this.confirm = { idx, t: 4 };
    }
    if (by + 4 < bottom) scr.textC(by + 4, own ? 'equip it in INVENTORY · max 4 items in a match' : 'bought items appear in INVENTORY', C.line, C.panel, x + w / 2);
  }

  // ───────── INVENTORY tab ─────────
  get loadout() { return loadoutOf(this.profile); }
  drawInventory(dt) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows, top = 4, bottom = rows - 2;
    const owned = ownedItems(this.inv), lo = this.loadout;
    const counts = { all: owned.length };
    for (const i of owned) counts[ITEMS[i].cat] = (counts[ITEMS[i].cat] || 0) + 1;
    const lw = 28;
    this.drawCats('invCat', 2, top, lw, counts, 'DEPARTMENTS · отделы');
    const rw = Math.min(56, Math.floor(cols * 0.3)), rx = cols - rw - 2;
    const mx = 2 + lw + 3, mw = rx - mx - 2;
    scr.text(mx, top, 'I N V E N T O R Y', C.bright);
    scr.text(mx + 19, top, `· ${owned.length}/${ITEMS.length} items · click an item to see it`, C.dim);
    if (this.invSel === undefined || !owned.includes(this.invSel)) this.invSel = lo.find(i => i >= 0) ?? owned[0];

    // ── loadout: what you take into a match (max 4 — one per slot) ──
    let y = top + 2;
    scr.text(mx, y, 'LOADOUT', C.text);
    scr.text(mx + 8, y, '· you take max 4 items into a match: one PRIMARY, SECONDARY, MELEE and UTILITY', C.dim);
    y += 1;
    const sw = Math.floor((mw + 2) / 4) - 2, sh = 8;
    CATS.forEach((c, k) => {
      const x = mx + k * (sw + 2), idx = lo[k];
      const hov = ui.over(x, y, sw, sh);
      if (hov) ui.hot = 'lo' + k;
      const bg = idx >= 0 && this.invSel === idx ? [26, 28, 32] : hov ? [21, 22, 26] : [13, 14, 17];
      scr.box(x, y, sw, sh, idx >= 0 ? GOLD.map(v => v * (hov ? 0.9 : 0.55)) : C.line, bg);
      scr.text(x + 2, y, ` ${c.key} · ${c.name} `, idx >= 0 ? GOLD : C.dim, bg);
      if (idx >= 0) {
        scr.hole(x + 1, y + 1, sw - 2, sh - 3);
        drawItemIcon(scr.art, (x + 1) * scr.ART, (y + 1) * scr.ART, (sw - 2) * scr.ART, (sh - 3) * scr.ART, idx, app.time, hov || this.invSel === idx, bg);
        scr.fill(x + 1, y + sh - 2, sw - 2, 1, ' ', null, bg);
        scr.textC(y + sh - 2, ITEMS[idx].name, C.bright, bg, x + sw / 2);
        if (hov && app.input.mouseClicked[0]) { this.invSel = idx; app.audio.uiClick(); }
      } else {
        scr.textC(y + 3, 'empty', C.line, bg, x + sw / 2);
        scr.textC(y + 4, c.id === 'secondary' ? 'buy a PISTOL in the SHOP' : 'pick an item below', C.line, bg, x + sw / 2);
      }
    });
    y += sh + 1;

    // ── everything you own, by department ──
    const cats = CATS.filter(c => this.invCat === 'all' || c.id === this.invCat);
    const cw = Math.floor((mw + 2) / cats.length) - 2;
    const most = Math.max(1, ...cats.map(c => owned.filter(i => ITEMS[i].cat === c.id).length));
    const avail = bottom - y - 2;
    const per = cats.length === 1 ? Math.max(1, Math.floor((mw + 2) / 30)) : 1;
    const cwi = cats.length === 1 ? Math.floor((mw + 2) / per) - 2 : cw;
    const ch = Math.max(6, Math.min(12, Math.floor(avail / Math.ceil(most / per)) - 1));
    cats.forEach((c, k) => {
      const x0 = mx + k * (cw + 2);
      const mine = owned.filter(i => ITEMS[i].cat === c.id);
      scr.put(x0, y, c.g, GOLD);
      scr.text(x0 + 2, y, `${c.name} · ${c.ru}`.slice(0, cw - 2), C.text);
      if (!mine.length) { scr.text(x0 + 2, y + 1, 'empty — ★ SHOP', C.line); return; }
      mine.forEach((idx, j) => {
        const x = x0 + (j % per) * (cwi + 2), yy = y + 1 + Math.floor(j / per) * (ch + 1);
        if (yy + ch > bottom) return;
        const eq = lo.includes(idx);
        if (this.drawItemCard('inv' + idx, x, yy, cwi, ch, idx, eq ? 'EQUIPPED ✓' : ITEMS[idx].starter ? 'starter' : 'bought', eq ? ONLINE : C.line, this.invSel === idx)) { this.invSel = idx; app.audio.uiClick(); }
      });
    });
    if (this.invSel === undefined) return;
    this.drawItemDetail(rx, top, rw, bottom - top, this.invSel, yy => {
      const it = ITEMS[this.invSel], k = CATS.findIndex(c => c.id === it.cat), cat = CATS[k];
      const by = Math.min(yy + 2, bottom - 4), bw = rw - 6;
      if (lo[k] === this.invSel) {
        scr.text(rx + 3, yy + 1, `EQUIPPED ✓  ·  ${cat.name} slot  ·  key ${cat.key} in a match`, ONLINE, C.panel);
        if (ui.button('unequip', rx + 3, by + 1, bw, 'UNEQUIP', { fg: C.dim })) app.net.send({ t: 'unequip', cat: cat.id });
      } else {
        const cur = lo[k] >= 0 ? ITEMS[lo[k]].name : 'empty';
        scr.text(rx + 3, yy + 1, `${cat.name} slot now: ${cur}`, C.dim, C.panel);
        if (ui.button('equip', rx + 3, by + 1, bw, `EQUIP  ·  ${cat.name}`, { fg: C.bright, border: GOLD })) app.net.send({ t: 'equip', id: it.id });
      }
    });
  }

  // a small inventory overview (used on profiles — everyone can see it)
  drawInvPanel(x, y, w, h, inv, title, loadout) {
    const app = this.app, scr = app.scr, ui = app.ui;
    const owned = ownedItems(inv), lo = loadoutOf({ inv, loadout });
    scr.box(x, y, w, h, C.line, C.panel);
    scr.text(x + 2, y, ` ${title} · ${owned.length} items `, C.dim, C.panel);
    const colW = Math.floor((w - 4) / CATS.length);
    const most = Math.max(1, ...CATS.map(c => owned.filter(i => ITEMS[i].cat === c.id).length));
    const iw = Math.max(10, colW - 2), ih = Math.max(5, Math.min(10, Math.floor((h - 5) / most) - 1));
    CATS.forEach((c, k) => {
      const cx = x + 2 + k * colW;
      scr.put(cx, y + 2, c.g, GOLD, C.panel);
      scr.text(cx + 2, y + 2, c.name.slice(0, colW - 3), C.text, C.panel);
      const mine = owned.filter(i => ITEMS[i].cat === c.id);
      if (!mine.length) scr.text(cx + 2, y + 3, 'empty', C.line, C.panel);
      mine.forEach((idx, j) => {
        const yy = y + 4 + j * (ih + 1);
        if (yy + ih > y + h - 1) return;
        const hov = ui.over(cx, yy, iw, ih);
        if (hov) ui.hot = title + idx;
        const bg = hov ? [24, 26, 30] : [13, 14, 17];
        scr.box(cx, yy, iw, ih, hov ? C.dim : C.line, bg);
        scr.hole(cx + 1, yy + 1, iw - 2, ih - 3);
        drawItemIcon(scr.art, (cx + 1) * scr.ART, (yy + 1) * scr.ART, (iw - 2) * scr.ART, (ih - 3) * scr.ART, idx, app.time, hov, bg);
        scr.fill(cx + 1, yy + ih - 2, iw - 2, 1, ' ', null, bg);
        const eq = lo.includes(idx);
        scr.textC(yy + ih - 2, (eq ? '✓ ' : '') + ITEMS[idx].name.slice(0, iw - 4), eq ? ONLINE : hov ? C.bright : C.dim, bg, cx + iw / 2);
        if (hov && app.input.mouseClicked[0]) { this.popup = idx; app.audio.uiClick(); }
      });
    });
    return y + h;
  }
  // ── party: invite picker + incoming invites ──
  drawParty() {
    const app = this.app, scr = app.scr, ui = app.ui;
    // incoming invites: a bar under the top menu
    const inv = (app.party && app.party.invites) || [];
    if (inv.length && !this.invitePick) {
      const from = inv[0], w = Math.min(scr.cols - 4, 74), x = Math.floor(scr.cols / 2 - w / 2), y = 3;
      scr.box(x, y, w, 3, GOLD, [24, 20, 10]);
      scr.text(x + 2, y + 1, `★ ${from} invites you to the party${inv.length > 1 ? `  (+${inv.length - 1})` : ''}`.slice(0, w - 26), GOLD, [24, 20, 10]);
      if (ui.button('pacc', x + w - 24, y + 1, 11, 'ACCEPT', { h: 1, fg: ONLINE, bg: [24, 20, 10] })) app.net.send({ t: 'paccept', name: from });
      if (ui.button('pdec', x + w - 12, y + 1, 11, 'DECLINE', { h: 1, fg: C.dim, bg: [24, 20, 10] })) app.net.send({ t: 'pdecline', name: from });
    }
    if (!this.invitePick) return;
    const w = Math.min(52, scr.cols - 4), h = Math.min(30, scr.rows - 6);
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2);
    scr.dim(0, 3, scr.cols, scr.rows - 4, 0.45);
    scr.box(x, y, w, h, C.bright, C.panel);
    scr.fill(x + 1, y + 1, w - 2, h - 2, ' ', null, C.panel);
    scr.text(x + 2, y, ' INVITE TO PARTY · max 4 ', C.bright, C.panel);
    const inParty = new Set(((app.party && app.party.members) || []).map(m => m.name));
    const friends = ((app.social && app.social.friends) || []).filter(f => !inParty.has(f.name)).sort((a, b) => b.online - a.online);
    scr.text(x + 2, y + 2, 'FRIENDS', C.dim, C.panel);
    let yy = y + 3;
    if (!friends.length) { scr.text(x + 2, yy, 'no friends yet — add them in FRIENDS,', C.line, C.panel); scr.text(x + 2, yy + 1, 'or type any online nickname below', C.line, C.panel); yy += 2; }
    for (const f of friends.slice(0, h - 12)) {
      scr.text(x + 2, yy, f.online ? '●' : '○', f.online ? ONLINE : C.line, C.panel);
      scr.text(x + 4, yy, f.name, f.online ? C.text : C.line, C.panel);
      scr.text(x + 21, yy, f.ingame ? 'in a match' : f.online ? 'online' : 'offline', C.line, C.panel);
      if (f.online && ui.button('pinv' + f.name, x + w - 13, yy, 11, 'INVITE', { h: 1, fg: C.bright, bg: C.panel })) { app.net.send({ t: 'pinvite', name: f.name }); }
      yy++;
    }
    const fy = y + h - 8;
    this.invNick = ui.field('invnick', x + 2, fy, w - 4, this.invNick || '', { label: 'NICKNAME', max: 16, placeholder: 'any online player',
      onEnter: () => { if (this.invNick.trim()) app.net.send({ t: 'pinvite', name: this.invNick.trim() }); this.invNick = ''; } });
    if (ui.button('pinvnick', x + 2, fy + 3, Math.floor((w - 6) / 2), 'INVITE') && this.invNick.trim()) { app.net.send({ t: 'pinvite', name: this.invNick.trim() }); this.invNick = ''; }
    if (ui.button('pinvclose', x + 4 + Math.floor((w - 6) / 2), fy + 3, Math.floor((w - 6) / 2), 'CLOSE') || app.input.pressed.has('Escape')) { this.invitePick = false; ui.focus = null; }
  }

  // centered card with the item's stats (opened from a profile)
  drawPopup() {
    const app = this.app, scr = app.scr, ui = app.ui;
    const w = Math.min(58, scr.cols - 4), h = Math.min(40, scr.rows - 6);
    const x = Math.floor(scr.cols / 2 - w / 2), y = Math.floor(scr.rows / 2 - h / 2);
    const inside = ui.over(x, y, w, h);
    scr.dim(0, 3, scr.cols, scr.rows - 4, 0.45);
    this.drawItemDetail(x, y, w, h, this.popup, yy => {
      if (ui.button('popclose', x + 3, Math.min(yy + 2, y + h - 4), w - 6, 'CLOSE')) this.popup = null;
    });
    if (app.input.mouseClicked[0] && !inside) this.popup = null;
  }

  // ═════════════════ RANK-UP ANIMATION ═════════════════
  // division up (STAR I → STAR II): short and calm · new rank (VORTEX → EIGEN): big, longer, more symbols the higher it is
  startRankUp(from, to) {
    const tierUp = to.tier > from.tier;
    const dur = tierUp ? (to.tier === FINAL ? 8 : 4.6 + to.tier * 0.3) : 3.2;
    this.rankUp = { from, to, tierUp, t: 0, dur, parts: [], rain: [], played: 0 };
    this.app.audio.rankUp && this.app.audio.rankUp(tierUp ? to.tier : -1);
  }
  drawRankUp(dt) {
    const app = this.app, scr = app.scr, cols = scr.cols, rows = scr.rows, R = this.rankUp, inp = app.input;
    R.t += dt;
    const T = R.t / R.dur, to = R.to, from = R.from, tier = TIERS[to.tier], eig = to.tier === FINAL;
    const epic = R.tierUp ? 0.6 + to.tier / 8 : 0.35;
    if (R.t > 0.6 && (inp.mouseClicked[0] || inp.pressed.has('Enter') || inp.pressed.has('Escape') || inp.pressed.has('Space'))) T > 0.85 ? (this.rankUp = null) : (R.t = R.dur * 0.86);
    if (R.t >= R.dur) { this.rankUp = null; return; }
    const fadeIn = Math.min(1, R.t / 0.4), fadeOut = Math.max(0, Math.min(1, (R.dur - R.t) / 0.8)), A = fadeIn * fadeOut * fadeOut;
    scr.dim(0, 0, cols, rows, 1 - 0.82 * A);
    const cx = cols / 2, cy = Math.floor(rows / 2) - 4;
    const col = k => eig ? TIERS[k % FINAL].col : tier.col;
    const glyphs = eig ? TIERS.map(t => t.g) : [tier.g, tier.g, '.', '*'];
    // symbol rain — denser for higher ranks
    const rainN = Math.floor(cols * (R.tierUp ? 0.25 + to.tier * 0.06 : 0.12));
    if (R.rain.length < rainN && R.dur - R.t > 1.2) for (let i = 0; i < 4; i++) R.rain.push({ x: Math.random() * cols, y: -Math.random() * 10, v: 8 + Math.random() * 22 * epic, k: Math.floor(Math.random() * 9) });
    for (const d of R.rain) {
      d.y += d.v * dt;
      if (d.y > rows) { d.y = -2; d.x = Math.random() * cols; }
      for (let j = 0; j < 4; j++) {
        const yy = Math.floor(d.y) - j;
        if (yy < 0 || yy >= rows) continue;
        const a = A * (1 - j / 4) * 0.55;
        if (a < 0.06) continue;                       // fading out: leave the lobby text alone
        scr.put(Math.floor(d.x), yy, glyphs[(d.k + j) % glyphs.length], col(d.k + j).map(v => v * a));
      }
    }
    // the old emblem breaks apart, a shock wave of the new rank symbol, then the new emblem grows in
    const breakT = R.tierUp ? 0.18 : 0.12, growT = R.tierUp ? 0.34 : 0.2;
    if (R.tierUp && T < breakT) {
      const k = (1 - T / breakT * 0.3) * fadeIn;
      drawEmblemCut(scr, cx + Math.round((Math.random() - 0.5) * 2 * T / breakT), cy - 7, from.tier, k, 30, 13);
    }
    if (R.played === 0 && T >= breakT) {
      R.played = 1;
      const n = R.tierUp ? 120 + to.tier * 40 : 50;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (6 + Math.random() * 30) * epic;
        R.parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp * 2, vy: Math.sin(a) * sp, life: 1 + Math.random() * 1.2, max: 2.2,
          ch: R.tierUp ? (Math.random() < 0.5 ? TIERS[from.tier].g : glyphs[i % glyphs.length]) : '*', k: i });
      }
      app.audio.rankBoom && app.audio.rankBoom(R.tierUp ? to.tier : -1);
    }
    for (const p of R.parts) {
      p.life = Math.min(p.life - dt, R.dur - R.t - 0.2); p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy = p.vy * 0.97 + 4 * dt;
      if (p.life <= 0) continue;
      const a = Math.min(1, p.life) * A;
      if (a < 0.08) continue;
      scr.put(Math.floor(p.x), Math.floor(p.y), p.ch, col(p.k).map(v => Math.min(255, v * 1.3 * a)));
    }
    if (T >= breakT) {
      // expanding rings (more rings for higher ranks)
      const ringsN = R.tierUp ? 1 + Math.floor(to.tier / 2) : 1;
      for (let r = 0; r < ringsN; r++) {
        const tt = (T - breakT) * (R.tierUp ? 1.6 : 2.2) - r * 0.12;
        if (tt <= 0 || tt > 1) continue;
        const rad = tt * Math.max(cols, rows * 2) * 0.55, a = (1 - tt) * A;
        if (a < 0.08) continue;
        for (let i = 0; i < 160; i++) {
          const ang = i / 160 * Math.PI * 2;
          const x = Math.floor(cx + Math.cos(ang) * rad), y = Math.floor(cy + Math.sin(ang) * rad * 0.5);
          scr.put(x, y, glyphs[(i + r) % glyphs.length], col(i + r).map(v => v * a * 1.2));
        }
      }
      // new emblem grows (sizes in steps → cached art)
      const g = Math.min(1, (T - breakT) / (growT - breakT + 0.0001));
      const ease = 1 - Math.pow(1 - g, 3);
      const big = R.tierUp ? (eig ? 40 : 32) : 26;
      const w = Math.max(6, Math.round(big * ease / 2) * 2), h = Math.max(3, Math.round(w * 0.43));
      const pulse = 1 + Math.sin(R.t * 4) * 0.08 * epic;
      drawEmblemCut(scr, cx, cy - Math.floor(h / 2) - 1, to.tier, Math.min(1.25, (0.6 + ease * 0.5) * pulse) * A, w, h);
      // orbiting symbols
      const orbN = R.tierUp ? 10 + to.tier * 3 : 6;
      for (let i = 0; i < orbN && A > 0.08; i++) {
        const ang = R.t * (0.8 + epic) + i / orbN * Math.PI * 2, rr = big * 0.75 * ease;
        scr.put(Math.floor(cx + Math.cos(ang) * rr), Math.floor(cy - 1 + Math.sin(ang) * rr * 0.4), glyphs[i % glyphs.length], col(i).map(v => v * A));
      }
      // texts
      if (T > growT) {
        const a = Math.min(1, (T - growT) * 5) * A;
        if (a < 0.08) return;
        const yT = cy + Math.floor(big * 0.25) + 2;
        const head = R.tierUp ? (eig ? 'Λ  F I N A L   R A N K  Λ' : 'N E W   R A N K') : 'D I V I S I O N   U P';
        scr.textC(yT, head, [200, 200, 205].map(v => v * a));
        const name = [...`${tier.name} ${ROMAN[to.div]}`].join(' ');
        const shake = R.tierUp && T < growT + 0.05 ? Math.round((Math.random() - 0.5) * 2) : 0;
        scr.textC(yT + 2, `${tier.g}  ${name}  ${tier.g}`, tier.col.map(v => Math.min(255, v * 1.25 * a)), null, cx + shake);
        scr.textC(yT + 3, [0, 1, 2].map(i => i <= to.div ? '<#>' : '<.>').join(' '), tier.col.map(v => v * a));
        scr.textC(yT + 5, `ELO ${fmtElo(to.elo)}`, [230, 230, 235].map(v => v * a));
        if (R.tierUp) scr.textC(yT + 6, `${TIERS[from.tier].name} ${ROMAN[from.div]}  →  ${tier.name} ${ROMAN[to.div]}`, C.dim.map(v => v * a));
        scr.textC(rows - 3, 'click to continue', C.line.map(v => v * a));
      }
    }
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
      scr.textC(yy + 10, `${fmtElo(rankStart(i))} ELO`, C.dim, null, cx);
      if (on) scr.textC(yy + 11, `^ YOU · ${t.name} ${ROMAN[cur.div]}`, t.col, null, cx);
    }
    // the final rank
    const fy = 8 + rowsN * 14;
    for (let x = 4; x < cols - 4; x++) scr.put(x, fy - 1, '-', C.line);
    const on = cur.tier === FINAL;
    const h = drawEmblem(scr, cols / 2, fy + 1, FINAL, on ? 1 : 0.85, 34, 13, C.bg);
    scr.textC(fy + h + 2, 'E I G E N', [244, 236, 214]);
    scr.textC(fy + h + 3, `EIGEN I ${fmtElo(rankStart(8, 0))} · II ${fmtElo(rankStart(8, 1))} · III ${fmtElo(rankStart(8, 2))} ELO · λ in its core, every rank around it`, C.dim);
    if (on) scr.textC(fy + h + 4, `^ YOU · EIGEN ${ROMAN[cur.div]} · ${fmtElo(cur.elo)} ELO`, [244, 236, 214]);
    const lines = [
      `every rank has 3 divisions (I · II · III) · your ELO: ${fmtElo(cur.elo)}`,
      'win  +50 ELO    top 3  +20 ELO    kill  +4 ELO    loss  -15 ELO    · after EIGEN III the ELO keeps growing',
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
    scr.text(lx + 2, top, ' FIND PLAYERS · click a name to open the profile ', C.dim, C.panel);
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
      const hovN = ui.over(lx + 5, yy, pl.name.length, 1);
      if (hovN) ui.hot = 'pn' + pl.name;
      scr.text(lx + 5, yy, pl.name, hovN ? [255, 255, 255] : pl.rel === 'you' ? C.bright : C.text, hovN ? C.line : C.panel);
      if (hovN && app.input.mouseClicked[0]) this.openProfile(pl.name);
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
      const hovF = ui.over(rx + 5, yy, f.name.length, 1);
      if (hovF) ui.hot = 'fn' + f.name;
      scr.text(rx + 5, yy, f.name, hovF ? [255, 255, 255] : f.online ? C.bright : C.text, hovF ? C.line : C.panel);
      if (hovF && app.input.mouseClicked[0]) this.openProfile(f.name);
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

  // open another player's profile
  openProfile(name) {
    if (!name) return;
    if (name.toLowerCase() === this.app.nick.toLowerCase()) { this.viewing = null; this.tab = TAB_PROFILE; return; }
    this.viewing = name; this.tab = TAB_PROFILE;
    this.app.net.send({ t: 'viewProfile', name });
  }
  drawProfileActions(V, rx, rw, top, bottom) {
    const app = this.app, scr = app.scr, ui = app.ui;
    scr.box(rx, top, rw, bottom - top, C.line, C.panel);
    scr.text(rx + 2, top, ` ${V.name} `, C.dim, C.panel);
    let y = top + 2;
    if (ui.button('pback', rx + 3, y, 26, '<  MY PROFILE')) { this.viewing = null; return; }
    y += 4;
    const bw = Math.min(30, rw - 6);
    if (V.rel === 'none' && ui.button('padd', rx + 3, y, bw, '+  ADD FRIEND', { fg: C.bright })) app.net.send({ t: 'friendAdd', name: V.name });
    if (V.rel === 'incoming' && ui.button('pacc', rx + 3, y, bw, 'ACCEPT FRIEND REQUEST', { fg: ONLINE })) app.net.send({ t: 'friendAccept', name: V.name });
    if (V.rel === 'pending') scr.text(rx + 4, y + 1, 'friend request sent · waiting…', C.dim, C.panel);
    if (V.rel === 'friend') {
      scr.text(rx + 4, y + 1, 'FRIEND ✓', ONLINE, C.panel);
      if (ui.button('prm', rx + 18, y + 1, 12, 'remove', { h: 1, fg: C.line })) app.net.send({ t: 'friendRemove', name: V.name });
    }
    y += 5;
    for (let i = rx + 2; i < rx + rw - 2; i++) scr.put(i, y, '-', C.line, C.panel);
    scr.text(rx + 3, y + 2, 'BEST MATCH', C.dim, C.panel);
    const best = (V.history || []).slice().sort((a, b) => b.k - a.k)[0];
    scr.text(rx + 3, y + 3, best ? `${best.k} kills · ${best.d} deaths · place #${best.place}` : 'no matches yet', C.text, C.panel);
    // refresh the relation after friend actions
    this.viewPoll = (this.viewPoll || 0) - 1 / 60;
    if (this.viewPoll <= 0) { this.viewPoll = 3; app.net.send({ t: 'viewProfile', name: V.name }); }
  }

  // ───────── PROFILE tab ─────────
  drawProfile() {
    const app = this.app, scr = app.scr, ui = app.ui;
    const cols = scr.cols, rows = scr.rows;
    const top = 4, bottom = rows - 2;
    const V = this.viewing && app.viewed && app.viewed.name.toLowerCase() === this.viewing.toLowerCase() ? app.viewed : null;
    const loadingOther = this.viewing && !V;
    const p = V || this.profile, r = rankOf(p.rp), tier = TIERS[r.tier];
    const name = V ? V.name : app.nick;
    const lw = Math.min(64, Math.floor(cols * 0.45)), lx = 2, cx = lx + lw / 2;
    const rx = lx + lw + 3, rw = cols - rx - 2;
    if (loadingOther) { scr.textC(Math.floor(rows / 2), `loading ${this.viewing}…`, C.dim); return; }
    // ── left: profile card ──
    scr.box(lx, top, lw, bottom - top, tier.col.map(v => v * 0.5), C.panel);
    scr.text(lx + 2, top, V ? ' PLAYER PROFILE ' : ' YOUR PROFILE ', C.dim, C.panel);
    scr.textC(top + 2, name, C.bright, C.panel, cx);
    if (V) scr.text(lx + lw - 14, top + 2, V.online ? (V.ingame ? '● in match' : '● online') : '○ offline', V.online ? ONLINE : C.line, C.panel);
    // your character, in a frame, made of tiny symbols
    const fh = Math.max(10, Math.min(18, rows - 36)), fw = lw - 8;
    const fx = lx + 4, fy = top + 4;
    this.drawStage('profile', scr.hole(fx + 1, fy + 1, fw - 2, fh - 2), 1 / 60, p.rp);
    scr.box(fx, fy, fw, fh, tier.col.map(v => v * 0.6), [12, 13, 16], false);
    let y = fy + fh + 1;
    // emblem on the left, rank text on the right
    drawEmblem(scr, lx + 14, y, r.tier, 1, 22, 10);
    const tx = lx + 27;
    scr.text(tx, y + 3, r.label, tier.col, C.panel);
    scr.text(tx, y + 4, `ELO ${fmtElo(p.rp)}`, C.text, C.panel);
    if (r.need) scr.text(tx, y + 5, `next ${fmtElo(r.next)}`, C.dim, C.panel);
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
      ['DEATHS', p.deaths || 0], ['K/D', kd], ['FRIENDS', V ? (V.friends || 0) : ((app.social && app.social.friends.length) || 0)], ['PLAYING SINCE', since]];
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
      const rp = m.mode === 'ZOMBIES' ? `wave ${m.wave || m.place}` : (m.rp > 0 ? '+' : '') + m.rp + ' ELO';
      scr.text(lx + lw - 3 - rp.length, yy, rp, m.rp > 0 ? ONLINE : [200, 80, 80], C.panel);
    });

    // ── right of the character: the player's inventory, visible to everyone ──
    const invH = Math.min(30, Math.max(14, Math.floor((bottom - top) * 0.52)));
    const ntop = this.drawInvPanel(rx, top, rw, invH, V ? (V.inv || []) : this.inv, V ? `${V.name.toUpperCase()}'S INVENTORY · ✓ = equipped` : 'INVENTORY · ✓ = equipped', V ? V.loadout : this.profile.loadout) + 1;
    if (V) return this.drawProfileActions(V, rx, rw, ntop, bottom);

    // ── right: notifications (friend requests + news) ──
    const soc = app.social || { requests: [], notes: [] };
    scr.box(rx, ntop, rw, bottom - ntop, C.line, C.panel);
    const reqs = soc.requests || [];
    scr.text(rx + 2, ntop, ' NOTIFICATIONS ', C.dim, C.panel);
    if (reqs.length) scr.text(rx + 17, ntop, ` ${fmtBadge(reqs.length)} `, [255, 255, 255], [196, 38, 46]);
    let ny = ntop + 2;
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
