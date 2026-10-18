// ─────────────────────────────────────────────────────────────
//  Immediate-mode UI made only of characters
// ─────────────────────────────────────────────────────────────
export const C = {
  bg:      [9, 10, 12],
  panel:   [17, 18, 21],
  panel2:  [26, 28, 32],
  line:    [62, 66, 72],
  dim:     [96, 101, 109],
  text:    [196, 200, 206],
  bright:  [238, 240, 244],
  red:     [178, 38, 46],
  darkRed: [92, 16, 20],
  hp:      [180, 186, 192],
  black:   [0, 0, 0],
};

export class UI {
  constructor(screen, input, audio) {
    this.s = screen; this.in = input; this.audio = audio;
    this.hot = null; this.lastHot = null;
    this.focus = null;
    this.blink = 0;
  }
  begin(dt) {
    this.blink += dt; this.lastHot = this.hot; this.hot = null;
    if (this.in.mouseClicked[0]) this.focus = null;   // clicking elsewhere leaves a text field
  }
  end() {
    if (this.hot && this.hot !== this.lastHot && this.audio) this.audio.uiHover();
  }
  over(x, y, w, h) {
    if (this.in.locked) return false;
    const [cx, cy] = this.in.cell;
    return cx >= x && cx < x + w && cy >= y && cy < y + h;
  }

  // ┌──────────┐
  // │  LABEL   │   returns true when clicked
  // └──────────┘
  button(id, x, y, w, label, opts = {}) {
    const s = this.s, h = opts.h || 3;
    const hov = this.over(x, y, w, h);
    if (hov) this.hot = id;
    const fg = hov ? C.bg : (opts.fg || C.text);
    const bg = hov ? C.bright : (opts.bg || C.panel);
    const border = hov ? C.bright : (opts.border || C.line);
    if (h >= 3) {
      s.box(x, y, w, h, border, bg);
      if (hov) s.fill(x + 1, y + 1, w - 2, h - 2, ' ', fg, bg);
      const txt = hov ? `> ${label} <` : label;
      const len = [...txt].length;
      s.text(x + Math.floor((w - len) / 2), y + Math.floor(h / 2), txt, fg, bg);
    } else {
      const txt = hov ? `[ ${label} ]` : `  ${label}  `;
      s.fill(x, y, w, 1, ' ', fg, bg);
      s.text(x + Math.floor((w - [...txt].length) / 2), y, txt, fg, bg);
    }
    const clicked = hov && this.in.mouseClicked[0];
    if (clicked && this.audio) this.audio.uiClick();
    return clicked;
  }

  // text field; returns the (possibly changed) value. Enter → opts.onEnter
  field(id, x, y, w, value, opts = {}) {
    const s = this.s;
    const hov = this.over(x, y, w, 3);
    if (hov) this.hot = id;
    if (hov && this.in.mouseClicked[0]) this.focus = id;
    const focused = this.focus === id;
    s.box(x, y, w, 3, focused ? C.bright : hov ? C.dim : C.line, C.bg);
    if (opts.label) s.text(x + 2, y, ` ${opts.label} `, focused ? C.bright : C.dim, C.bg);
    if (focused) {
      for (const ch of this.in.typed) {
        if (ch === '\b') value = [...value].slice(0, -1).join('');
        else if (ch === '\n') { if (opts.onEnter) opts.onEnter(); }
        else if (ch === '\t') { if (opts.onTab) opts.onTab(); }
        else if ([...value].length < (opts.max || 32)) value += ch;
      }
    }
    let shown = opts.mask ? '*'.repeat([...value].length) : value;
    const arr = [...shown];
    const vis = w - 5;
    if (arr.length > vis) shown = arr.slice(arr.length - vis).join('');
    if (!value && !focused && opts.placeholder) s.text(x + 2, y + 1, opts.placeholder, C.dim, C.bg);
    const n = s.text(x + 2, y + 1, shown, C.text, C.bg);
    if (focused && (this.blink % 1) < 0.55) s.put(x + 2 + n, y + 1, '_', C.bright, C.bg);
    return value;
  }

  // NAME     ◄ ██████████░░░░░░ ►  62%
  slider(id, x, y, w, label, value, opts = {}) {
    const s = this.s;
    const labelW = opts.labelW || 12;
    s.text(x, y, label, C.text);
    const bx = x + labelW + 2, bw = w - labelW - 10;
    const hovL = this.over(x + labelW, y, 1, 1), hovR = this.over(bx + bw + 1, y, 1, 1);
    const hovBar = this.over(bx, y, bw, 1);
    if (hovL || hovR || hovBar) this.hot = id + (hovL ? 'L' : hovR ? 'R' : 'B');
    s.put(x + labelW, y, '<', hovL ? C.bright : C.dim);
    s.put(bx + bw + 1, y, '>', hovR ? C.bright : C.dim);
    const step = opts.step || 0.05;
    if (hovL && this.in.mouseClicked[0]) value -= step;
    if (hovR && this.in.mouseClicked[0]) value += step;
    if (hovBar && this.in.mouseDown[0]) {
      const [cx] = this.in.cell;
      value = (cx - bx + 0.5) / bw;
    }
    value = Math.max(0, Math.min(1, Math.round(value / 0.01) * 0.01));
    const filled = Math.round(value * bw);
    for (let i = 0; i < bw; i++) s.put(bx + i, y, i < filled ? '#' : '.', i < filled ? (hovBar ? C.bright : C.text) : C.line);
    const txt = opts.format ? opts.format(value) : `${Math.round(value * 100)}%`;
    s.text(bx + bw + 3, y, txt.padStart(4), C.dim);
    return value;
  }

  // the cursor is just a small circle
  cursor() {
    if (this.in.locked) return;
    const [cx, cy] = this.in.cell;
    this.s.put(cx, cy, '◦', C.bright);
  }
}

// ─────────────────────────────────────────────────────────────
//  Big ASCII text: rasterize a word with a real font, then turn
//  the pixels into characters (so the title is made of symbols)
// ─────────────────────────────────────────────────────────────
const RAMP = ' .:-=+*#%@';
export function bigText(str, cols, rowsAspect = 0.5, weight = 900) {
  const c = document.createElement('canvas');
  const fs = 140;
  const ctx = c.getContext('2d');
  ctx.font = `${weight} ${fs}px "Arial Black", Impact, "Segoe UI", sans-serif`;
  const tw = Math.ceil(ctx.measureText(str).width) + 20;
  c.width = tw; c.height = Math.ceil(fs * 1.25);
  ctx.font = `${weight} ${fs}px "Arial Black", Impact, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(str, 10, c.height / 2);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const cw = c.width / cols;
  const ch = cw / rowsAspect;
  const rows = Math.ceil(c.height / ch);
  const out = [];
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let k = 0; k < cols; k++) {
      let sum = 0, n = 0;
      const x0 = Math.floor(k * cw), x1 = Math.floor((k + 1) * cw);
      const y0 = Math.floor(r * ch), y1 = Math.min(c.height, Math.floor((r + 1) * ch));
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { sum += data[(y * c.width + x) * 4 + 3]; n++; }
      line.push(n ? sum / n / 255 : 0);
    }
    out.push(line);
  }
  // trim empty rows
  while (out.length && out[0].every(v => v < 0.05)) out.shift();
  while (out.length && out[out.length - 1].every(v => v < 0.05)) out.pop();
  return out; // 2D array of coverage 0..1
}
export function coverageChar(v) {
  return RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
}
