// tiny WebSocket wrapper with auto-reconnect
export class Net {
  constructor() {
    this.ws = null; this.handlers = new Set(); this.status = 'offline';
    this.queue = [];
    this.connect();
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.status = 'connecting';
    const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    // events of an old socket (closed or replaced) are ignored — no late replies from a previous account
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.status = 'online';
      for (const m of this.queue) ws.send(m);
      this.queue.length = 0;
      this.emit({ t: '_open' });
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.status = 'offline';
      this.emit({ t: '_close' });
      setTimeout(() => { if (ws === this.ws) this.connect(); }, 1500);
    };
    ws.onerror = () => {};
    ws.onmessage = e => { if (ws !== this.ws) return; let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m); };
  }
  emit(m) { for (const h of this.handlers) h(m); }
  on(h) { this.handlers.add(h); return () => this.handlers.delete(h); }
  send(m) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (m.t === 'auth') { this.queue = this.queue.filter(q => !q.startsWith('{"t":"auth"')); this.queue.push(s); }   // only the newest login waits
  }
  // drop queued logins (logout)
  clearQueue() { this.queue.length = 0; }
}
