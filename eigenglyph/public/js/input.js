// keyboard / mouse / pointer-lock state
export class Input {
  constructor(canvas, screen) {
    this.canvas = canvas; this.screen = screen;
    this.down = new Set();
    this.pressed = new Set();     // keys pressed this frame (by code)
    this.typed = [];              // text characters + special keys for text fields
    this.mx = -100; this.my = -100;  // css px
    this.mdx = 0; this.mdy = 0;
    this.mouseDown = [false, false, false];
    this.mouseClicked = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    this.captureText = false;

    window.addEventListener('keydown', e => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Slash' || e.code === 'Quote') e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') return; // paste handled below
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.key === 'Backspace') { this.typed.push('\b'); e.preventDefault(); }
      else if (e.key === 'Enter') this.typed.push('\n');
      else if (e.key === 'Tab') this.typed.push('\t');
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.typed.push(e.key);
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });
    window.addEventListener('paste', e => {
      const t = (e.clipboardData || window.clipboardData).getData('text') || '';
      for (const ch of t.replace(/[\r\n\t]/g, ' ')) this.typed.push(ch);
    });
    window.addEventListener('mousemove', e => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    window.addEventListener('mousedown', e => {
      if (e.button < 3) { this.mouseDown[e.button] = true; this.mouseClicked[e.button] = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button < 3) { this.mouseDown[e.button] = false; this.mouseReleased[e.button] = true; }
    });
    window.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockerror', e => e.preventDefault && e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.unlockedAt = performance.now();
      this.mdx = this.mdy = 0;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  // the browser refuses to re-lock the mouse ~1 s after Esc — that is not an error,
  // the game just stays paused and the next click locks it
  lock() {
    if (document.pointerLockElement === this.canvas) return;
    // right after Esc the browser needs ~1 s before it allows capturing the mouse again
    if (performance.now() - (this.unlockedAt || -1e9) < 1300) return;
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch {} };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(err => { if (!/immediately|exited/i.test(String(err && err.message))) plain(); });
    } catch { plain(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  get cell() { return this.screen.cellFromPx(this.mx, this.my); }
  endFrame() {
    this.pressed.clear(); this.typed.length = 0;
    this.mouseClicked = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
  }
}
