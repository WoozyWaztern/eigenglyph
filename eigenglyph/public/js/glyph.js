// ─────────────────────────────────────────────────────────────
//  GlyphScreen — the whole game is drawn as grids of characters.
//
//  Two layers, composited by one WebGL shader:
//   • UI layer   — normal-size symbols (menus, HUD, text)
//   • fine layer — symbols DETAIL× smaller (3D world, characters).
//     DETAIL 2 = every UI cell holds 2×2 = 4 world symbols.
//  A UI cell is transparent until something is drawn into it.
// ─────────────────────────────────────────────────────────────

const FONT_STACK = '"Cascadia Mono", "JetBrains Mono", Consolas, "DejaVu Sans Mono", "Courier New", monospace';
const ATLAS_COLS = 64, ATLAS_ROWS = 40;

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
// Each layer = one texture 2·cols wide: left half glyph+fg color, right half glyph-hi+bg color.
const FS = `
precision highp float;
uniform sampler2D uT1, uAt1, uT2, uAt2, uT3, uAt3;
uniform vec2 uGrid, uCell, uGrid2, uCell2, uGrid3, uCell3, uAtlasGrid, uOffset;
uniform float uCanvasH;
vec4 cellA(sampler2D t, vec2 c, vec2 grid){ return texture2D(t, vec2((c.x + .5) / (grid.x * 2.), (c.y + .5) / grid.y)); }
vec4 cellB(sampler2D t, vec2 c, vec2 grid){ return texture2D(t, vec2((c.x + grid.x + .5) / (grid.x * 2.), (c.y + .5) / grid.y)); }
float glyphCov(sampler2D atlas, float gi, vec2 local){
  vec2 g = vec2(mod(gi, uAtlasGrid.x), floor(gi / uAtlasGrid.x));
  return texture2D(atlas, (g + local) / uAtlasGrid).a;
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) - uOffset;
  vec2 c1 = floor(p / uCell);
  if (c1.x < 0. || c1.y < 0. || c1.x >= uGrid.x || c1.y >= uGrid.y) { gl_FragColor = vec4(0.,0.,0.,1.); return; }
  // ---- 1: UI layer (normal symbols) ----
  vec4 a = cellA(uT1, c1, uGrid), b = cellB(uT1, c1, uGrid);
  float bh = floor(b.a * 255. + .5);
  float op = step(127.5, bh);
  float cov = glyphCov(uAt1, floor(a.a * 255. + .5) + (bh - op * 128.) * 256., (p - c1 * uCell) / uCell);
  if (op > .5) { gl_FragColor = vec4(mix(b.rgb, a.rgb, cov), 1.); return; }
  // ---- 3: art layer (tiny symbols: emblems, characters, icons) ----
  vec2 c3 = min(floor(p / uCell3), uGrid3 - 1.);
  vec4 a3 = cellA(uT3, c3, uGrid3), b3 = cellB(uT3, c3, uGrid3);
  float bh3 = floor(b3.a * 255. + .5);
  vec3 under;
  if (bh3 > 127.5) {
    float cov3 = glyphCov(uAt3, floor(a3.a * 255. + .5) + (bh3 - 128.) * 256., (p - c3 * uCell3) / uCell3);
    under = mix(b3.rgb, a3.rgb, cov3);
  } else {
    // ---- 2: world layer (small symbols) ----
    vec2 c2 = min(floor(p / uCell2), uGrid2 - 1.);
    vec4 a2 = cellA(uT2, c2, uGrid2), b2 = cellB(uT2, c2, uGrid2);
    float cov2 = glyphCov(uAt2, floor(a2.a * 255. + .5) + floor(b2.a * 255. + .5) * 256., (p - c2 * uCell2) / uCell2);
    under = mix(b2.rgb, a2.rgb, cov2);
  }
  gl_FragColor = vec4(mix(under, a.rgb, cov), 1.);
}`;

// procedural box/block glyphs so lines connect perfectly
function drawBoxGlyph(a, ch, x, y, w, h) {
  const t = Math.max(1, Math.round(w / 8));
  const cx = x + Math.floor(w / 2 - t / 2), cy = y + Math.floor(h / 2 - t / 2);
  const H = (x0, x1) => a.fillRect(x0, cy, x1 - x0, t);
  const V = (y0, y1) => a.fillRect(cx, y0, t, y1 - y0);
  const L = x, R = x + w, T = y, B = y + h, MX = cx, MY = cy;
  switch (ch) {
    case '─': H(L, R); return true;
    case '━': a.fillRect(L, cy - t, w, t * 3); return true;
    case '│': V(T, B); return true;
    case '┌': H(MX, R); V(MY, B); return true;
    case '┐': H(L, MX + t); V(MY, B); return true;
    case '└': H(MX, R); V(T, MY + t); return true;
    case '┘': H(L, MX + t); V(T, MY + t); return true;
    case '█': a.fillRect(L, T, w, h); return true;
    case '▀': a.fillRect(L, T, w, Math.ceil(h / 2)); return true;
    case '▄': a.fillRect(L, T + Math.floor(h / 2), w, h - Math.floor(h / 2)); return true;
    case '▕': a.fillRect(R - t, T, t, h); return true;
    case '▏': a.fillRect(L, T, t, h); return true;
  }
  return false;
}

// ───────────── one grid of characters ─────────────
export class Layer {
  constructor(gl, units) {
    this.gl = gl; this.units = units;
    const mk = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.texAB = mk(); this.texAtlas = mk();
    this.cols = 0; this.rows = 0;
    this.flag = 0;           // UI layer sets this to 128: 'opaque cell' bit
  }
  // cellW/cellH: size of one cell in device pixels (may be fractional), gw/gh: atlas glyph box, fpx: font px
  setup(cols, rows, cellW, cellH, gw, gh, fpx) {
    this.cols = cols; this.rows = rows; this.cellW = cellW; this.cellH = cellH;
    this.gw = gw; this.gh = gh; this.fpx = fpx;
    const n = cols * rows;
    this.A = new Uint8ClampedArray(n * 4);
    this.B = new Uint8ClampedArray(n * 4);
    this.A8 = new Uint8Array(this.A.buffer);
    this.B8 = new Uint8Array(this.B.buffer);
    this.AB = new Uint8Array(n * 8);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texAB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols * 2, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const c = document.createElement('canvas');
    c.width = ATLAS_COLS * gw; c.height = ATLAS_ROWS * gh;
    this.atlasCanvas = c;
    this.actx = c.getContext('2d');
    this.actx.font = `${fpx}px ${FONT_STACK}`;
    this.actx.textAlign = 'center';
    this.actx.textBaseline = 'middle';
    this.actx.fillStyle = '#fff';
    this.glyphMap = new Map(); this.glyphCount = 0; this.atlasDirty = true;
    const warm = ' .,-~:;=!*#$@+%&?/\\|()[]{}<>_^\'"`0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
      + '─│┌┐└┘█▀▄▕▏━◦·×ΣΔ∇λ▲▼◄►◆◇'
      + 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
    for (const ch of warm) this.glyph(ch);
  }
  glyph(ch) {
    let g = this.glyphMap.get(ch);
    if (g !== undefined) return g;
    if (this.glyphCount >= ATLAS_COLS * ATLAS_ROWS) return 0;
    g = this.glyphCount++;
    this.glyphMap.set(ch, g);
    const x = (g % ATLAS_COLS) * this.gw, y = Math.floor(g / ATLAS_COLS) * this.gh;
    if (!drawBoxGlyph(this.actx, ch, x, y, this.gw, this.gh)) {
      const a = this.actx;
      a.save(); a.beginPath(); a.rect(x, y, this.gw, this.gh); a.clip();
      a.fillText(ch, x + this.gw / 2, y + this.gh / 2 + 1);
      a.restore();
    }
    this.atlasDirty = true;
    return g;
  }

  // opaque=false → cells become see-through (UI layer over the world)
  clear(r = 0, g = 0, b = 0, opaque = true) {
    const A = this.A, B = this.B, n = this.cols * this.rows, f = opaque ? this.flag : 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      A[j] = r; A[j + 1] = g; A[j + 2] = b; A[j + 3] = 0;
      B[j] = r; B[j + 1] = g; B[j + 2] = b; B[j + 3] = f;
    }
  }
  // fast path used by the 3D renderer (fine layer)
  setCell(i, gi, fr, fg, fb, br, bg, bb) {
    const j = i << 2, A = this.A, B = this.B;
    A[j] = fr; A[j + 1] = fg; A[j + 2] = fb; A[j + 3] = gi & 255;
    B[j] = br; B[j + 1] = bg; B[j + 2] = bb; B[j + 3] = gi >> 8;
  }
  put(x, y, ch, fg, bg) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const gi = this.glyph(ch);
    const j = (y * this.cols + x) << 2, A = this.A, B = this.B;
    const flag = bg ? this.flag : (B[j + 3] & this.flag);
    A[j + 3] = gi & 255; B[j + 3] = (gi >> 8) | flag;
    if (fg) { A[j] = fg[0]; A[j + 1] = fg[1]; A[j + 2] = fg[2]; }
    if (bg) { B[j] = bg[0]; B[j + 1] = bg[1]; B[j + 2] = bg[2]; }
  }
  bgAt(x, y, bg) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const j = (y * this.cols + x) << 2;
    this.B[j] = bg[0]; this.B[j + 1] = bg[1]; this.B[j + 2] = bg[2]; this.B[j + 3] |= this.flag;
  }
  dimRect(x, y, w, h, k) {
    for (let yy = Math.max(0, y); yy < Math.min(this.rows, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.cols, x + w); xx++) {
        const j = (yy * this.cols + xx) << 2;
        for (let c = 0; c < 3; c++) { this.A[j + c] *= k; this.B[j + c] *= k; }
      }
  }
  text(x, y, str, fg, bg) {
    let i = 0;
    for (const ch of str) { this.put(x + i, y, ch, fg, bg); i++; }
    return i;
  }
  textC(y, str, fg, bg, cx = this.cols / 2) {
    const len = [...str].length;
    this.text(Math.floor(cx - len / 2), y, str, fg, bg);
  }
  fill(x, y, w, h, ch, fg, bg) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, ch, fg, bg);
  }
  // ASCII frame:  +-------+
  //               |       |
  //               +-------+
  box(x, y, w, h, fg, bg, fillBg = true) {
    if (w < 2 || h < 2) return;
    if (fillBg) this.fill(x + 1, y + 1, w - 2, h - 2, ' ', fg, bg);
    for (let i = 1; i < w - 1; i++) { this.put(x + i, y, '-', fg, bg); this.put(x + i, y + h - 1, '-', fg, bg); }
    for (let i = 1; i < h - 1; i++) { this.put(x, y + i, '|', fg, bg); this.put(x + w - 1, y + i, '|', fg, bg); }
    this.put(x, y, '+', fg, bg); this.put(x + w - 1, y, '+', fg, bg);
    this.put(x, y + h - 1, '+', fg, bg); this.put(x + w - 1, y + h - 1, '+', fg, bg);
  }
  upload(unitAB, unitAtlas) {
    const gl = this.gl;
    if (this.atlasDirty) {
      gl.activeTexture(gl.TEXTURE0 + unitAtlas);
      gl.bindTexture(gl.TEXTURE_2D, this.texAtlas);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);
      this.atlasDirty = false;
    }
    const rb = this.cols * 4, AB = this.AB;
    for (let y = 0; y < this.rows; y++) {
      AB.set(this.A8.subarray(y * rb, y * rb + rb), y * rb * 2);
      AB.set(this.B8.subarray(y * rb, y * rb + rb), y * rb * 2 + rb);
    }
    gl.activeTexture(gl.TEXTURE0 + unitAB);
    gl.bindTexture(gl.TEXTURE_2D, this.texAB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols * 2, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, AB);
    gl.activeTexture(gl.TEXTURE0 + unitAtlas);
    gl.bindTexture(gl.TEXTURE_2D, this.texAtlas);
  }
}

// ───────────── the screen: UI layer (this) + fine layer (this.fine) ─────────────
export class GlyphScreen extends Layer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not available');
    super(gl, [0, 1]);
    this.canvas = canvas;
    this.flag = 128;
    this.fontPx = 14;
    this.detail = 2;
    this.fine = new Layer(gl, [2, 3]);
    // art layer: ART× smaller symbols than the UI, used for emblems, characters and item icons
    this.ART = 3;
    this.art = new Layer(gl, [4, 5]);
    this.art.flag = 128;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uT1', 'uAt1', 'uT2', 'uAt2', 'uT3', 'uAt3', 'uGrid', 'uCell', 'uGrid2', 'uCell2', 'uGrid3', 'uCell3', 'uAtlasGrid', 'uOffset', 'uCanvasH'])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.resize();
  }
  setFontSize(px) { this.fontPx = px; this.resize(); }
  setDetail(d) { this.detail = Math.max(1, Math.min(3, d | 0)); this.resize(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(window.innerWidth * dpr));
    const ch = Math.max(1, Math.floor(window.innerHeight * dpr));
    this.canvas.width = cw; this.canvas.height = ch;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.dpr = dpr;
    const fpx = Math.round(this.fontPx * dpr);
    const m = document.createElement('canvas').getContext('2d');
    m.font = `${fpx}px ${FONT_STACK}`;
    const cellW = Math.max(4, Math.ceil(m.measureText('M').width));
    const cellH = Math.max(6, Math.ceil(fpx * 1.18));
    const cols = Math.floor(cw / cellW), rows = Math.floor(ch / cellH);
    this.offX = Math.floor((cw - cols * cellW) / 2);
    this.offY = Math.floor((ch - rows * cellH) / 2);
    this.setup(cols, rows, cellW, cellH, cellW, cellH, fpx);
    // fine layer: DETAIL× more symbols in each direction
    const D = this.detail;
    const fw = cellW / D, fh = cellH / D;
    this.fine.setup(cols * D, rows * D, fw, fh, Math.max(2, Math.ceil(fw)), Math.max(3, Math.ceil(fh)), Math.max(4, Math.round(fpx / D)));
    const A = this.ART, aw = cellW / A, ah = cellH / A;
    this.art.setup(cols * A, rows * A, aw, ah, Math.max(2, Math.ceil(aw)), Math.max(3, Math.ceil(ah)), Math.max(3, Math.round(fpx / A)));
    this.cssCellW = cellW / dpr; this.cssCellH = cellH / dpr;
    this.cssOffX = this.offX / dpr; this.cssOffY = this.offY / dpr;
    this.gl.viewport(0, 0, cw, ch);
  }
  // make UI cells see-through so the art layer below is visible; returns art-layer rect
  hole(x, y, w, h) {
    for (let yy = Math.max(0, y); yy < Math.min(this.rows, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.cols, x + w); xx++) {
        const j = (yy * this.cols + xx) << 2;
        this.A[j + 3] = 0; this.B[j + 3] = 0;
      }
    const k = this.ART;
    return [x * k, y * k, w * k, h * k];
  }
  // dim both layers (k < 1 darker)
  dim(x, y, w, h, k) {
    this.dimRect(x, y, w, h, k);
    const D = this.detail;
    this.fine.dimRect(x * D, y * D, w * D, h * D, k);
    const A = this.ART;
    this.art.dimRect(x * A, y * A, w * A, h * A, k);
  }
  cellFromPx(px, py) {
    return [Math.floor((px - this.cssOffX) / this.cssCellW), Math.floor((py - this.cssOffY) / this.cssCellH)];
  }
  present() {
    const gl = this.gl, u = this.u;
    this.upload(0, 1);
    this.fine.upload(2, 3);
    this.art.upload(4, 5);
    gl.uniform1i(u.uT1, 0); gl.uniform1i(u.uAt1, 1);
    gl.uniform1i(u.uT2, 2); gl.uniform1i(u.uAt2, 3);
    gl.uniform1i(u.uT3, 4); gl.uniform1i(u.uAt3, 5);
    gl.uniform2f(u.uGrid3, this.art.cols, this.art.rows);
    gl.uniform2f(u.uCell3, this.art.cellW, this.art.cellH);
    gl.uniform2f(u.uGrid, this.cols, this.rows);
    gl.uniform2f(u.uCell, this.cellW, this.cellH);
    gl.uniform2f(u.uGrid2, this.fine.cols, this.fine.rows);
    gl.uniform2f(u.uCell2, this.fine.cellW, this.fine.cellH);
    gl.uniform2f(u.uAtlasGrid, ATLAS_COLS, ATLAS_ROWS);
    gl.uniform2f(u.uOffset, this.offX, this.offY);
    gl.uniform1f(u.uCanvasH, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
