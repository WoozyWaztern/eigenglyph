// ─────────────────────────────────────────────────────────────
//  Tiny dependency-free WebSocket server (RFC 6455, text frames)
//  so the game runs with plain Node.js — no npm install needed.
// ─────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.readyState = 1;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('close', () => this._closed());
    sock.on('end', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
  _parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; }       // 1 MB max message
      const maskOff = off; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= this.buf[maskOff + (i & 3)];
      this.buf = this.buf.subarray(off + len);

      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frag.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frag); this.frag = [];
          this.emit('message', msg.toString('utf8'));
        }
      }
    }
  }
  _frame(op, payload) {
    if (this.readyState !== 1) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }
  send(str) { this._frame(0x1, Buffer.from(str, 'utf8')); }
  close() {
    if (this.readyState !== 1) return;
    this._frame(0x8, Buffer.alloc(0));
    this.readyState = 2;
    try { this.sock.end(); } catch {}
    this._closed();
  }
}

// attach to an http server; calls onConnection(socket) for every client on `path`
export function attach(server, path, onConnection) {
  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!req.url.startsWith(path) || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      sock.destroy(); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    onConnection(new Socket(sock));
  });
}
