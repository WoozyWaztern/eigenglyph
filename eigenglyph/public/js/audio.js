// ─────────────────────────────────────────────────────────────
//  Procedural sound (no audio files needed) — WebAudio
// ─────────────────────────────────────────────────────────────
export class Audio {
  constructor() {
    this.ctx = null;
    this.ambLevel = 0.6;
    this.vol = { master: 0.7, sfx: 0.8, ambient: 0.5 };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem('eg_vol') || '{}')); } catch {}
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.sfx.connect(this.master); this.amb.connect(this.master);
    this.master.connect(comp); comp.connect(ctx.destination);
    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
    this._startAmbient();
  }
  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.ambient * this.ambLevel, t, 0.3);
  }
  saveVolume() { try { localStorage.setItem('eg_vol', JSON.stringify(this.vol)); } catch {} }

  // ambient drone: dark detuned low tones + filtered wind
  _startAmbient() {
    const ctx = this.ctx;
    this.ambLevel = 0.6;
    const bus = ctx.createGain(); bus.gain.value = 0.18; bus.connect(this.amb);
    for (const [f, dt] of [[55, 0], [55.4, 0], [82.4, 0], [110.2, 0]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f + dt;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const g = ctx.createGain(); g.gain.value = 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain(); lg.gain.value = 90; lfo.connect(lg); lg.connect(lp.frequency);
      o.connect(lp); lp.connect(g); g.connect(bus); o.start(); lfo.start();
    }
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(bp.frequency);
    n.connect(bp); bp.connect(ng); ng.connect(bus); n.start(); lfo.start();
  }
  setAmbient(level) { this.ambLevel = level; this.applyVolume(); }

  // ── helpers ──
  _out(pan = 0, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }
  _noise(dest, t0, dur, type, freq, q, gain, decay) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 1.5, dur);
    return f;
  }
  _tone(dest, t0, type, f0, f1, dur, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  get ok() { return !!this.ctx; }

  // ── game sounds ──
  shotgun(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol);
    this._noise(o, t, 0.6, 'lowpass', 2400, 0.5, 1.2, 0.45);
    this._noise(o, t, 0.15, 'highpass', 3000, 0.7, 0.5, 0.08);
    this._tone(o, t, 'sine', 140, 40, 0.25, 1.1);
    this._noise(o, t + 0.04, 1.0, 'lowpass', 500, 0.3, 0.25, 0.9); // tail / echo
  }
  pump(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol);
    this._noise(o, t, 0.06, 'bandpass', 2200, 4, 0.6, 0.05);
    this._tone(o, t, 'square', 900, 300, 0.03, 0.08);
    this._noise(o, t + 0.16, 0.06, 'bandpass', 1600, 4, 0.7, 0.06);
    this._tone(o, t + 0.16, 'square', 600, 200, 0.04, 0.1);
  }
  shell() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0.2, 0.8);
    this._noise(o, t, 0.05, 'bandpass', 3000, 6, 0.5, 0.04);
    this._tone(o, t, 'triangle', 1500, 900, 0.05, 0.15);
  }
  click() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0.2, 0.7);
    this._tone(o, t, 'square', 1800, 1200, 0.02, 0.12);
  }
  knife(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol);
    const f = this._noise(o, t, 0.3, 'bandpass', 900, 2.5, 0.6, 0.22);
    f.frequency.exponentialRampToValueAtTime(5200, t + 0.18);
  }
  flesh(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol);
    this._tone(o, t, 'sine', 120, 45, 0.18, 0.9);
    this._noise(o, t, 0.15, 'lowpass', 800, 1, 0.6, 0.12);
  }
  hitmark() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.6);
    this._tone(o, t, 'square', 2200, 1800, 0.05, 0.15);
  }
  hurt() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 1);
    this._tone(o, t, 'sawtooth', 220, 90, 0.25, 0.25);
    this._noise(o, t, 0.2, 'lowpass', 600, 1, 0.5, 0.18);
  }
  death() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 1);
    this._tone(o, t, 'sawtooth', 300, 30, 1.4, 0.35);
    this._tone(o, t, 'sine', 80, 25, 1.6, 0.8);
    this._noise(o, t + 0.5, 0.4, 'lowpass', 300, 1, 0.8, 0.35); // body hits floor
  }
  canOpen() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0.1, 1);
    this._tone(o, t, 'square', 2600, 1400, 0.02, 0.2);
    const f = this._noise(o, t + 0.02, 0.7, 'highpass', 4000, 0.5, 0.5, 0.6);
    f.frequency.linearRampToValueAtTime(7000, t + 0.6);
  }
  gulp() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.9);
    this._tone(o, t, 'sine', 260, 120, 0.12, 0.6);
  }
  heal() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.5);
    this._tone(o, t, 'sine', 440, 880, 0.3, 0.25);
    this._tone(o, t + 0.08, 'sine', 660, 1320, 0.3, 0.18);
  }
  equip() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0.2, 0.7);
    this._noise(o, t, 0.1, 'bandpass', 1400, 3, 0.4, 0.08);
  }
  step(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol * 0.5);
    this._noise(o, t, 0.08, 'lowpass', 300 + Math.random() * 200, 1, 0.6, 0.07);
  }
  land() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.6);
    this._noise(o, t, 0.12, 'lowpass', 250, 1, 0.9, 0.1);
  }
  impact(pan = 0, vol = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(pan, vol * 0.4);
    this._noise(o, t, 0.06, 'bandpass', 2500, 2, 0.5, 0.05);
  }
  chat() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.35);
    this._tone(o, t, 'sine', 880, 990, 0.08, 0.3);
  }
  uiHover() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.25);
    this._tone(o, t, 'square', 1200, 1100, 0.025, 0.08);
  }
  uiClick() {
    if (!this.ok) return; const t = this.ctx.currentTime, o = this._out(0, 0.5);
    this._tone(o, t, 'square', 600, 300, 0.06, 0.18);
    this._noise(o, t, 0.04, 'highpass', 3000, 1, 0.2, 0.03);
  }
}
