// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation) with no npm dependencies.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WSConn extends EventEmitter {
  constructor(socket, { maxPayload = 4 * 1024 * 1024, timeoutMs = 10000 } = {}) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.timeoutMs = timeoutMs;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.fragLen = 0;
    this.alive = true;
    this.lastRecv = Date.now();
    this.remote = socket.remoteAddress || '';
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish(1006, 'socket closed'));
    socket.on('error', () => this._finish(1006, 'socket error'));
    this._ping = setInterval(() => {
      if (!this.alive) return;
      if (Date.now() - this.lastRecv > this.timeoutMs) { this._finish(1006, 'timeout'); try { socket.destroy(); } catch (e) { /* ignore */ } return; }
      this._frame(0x9, Buffer.alloc(0));
    }, 2500);
  }

  get bufferedBytes() { return this.socket.writableLength || 0; }

  /** send a text message. `droppable` messages are skipped when the client is not keeping up (snapshots). */
  send(text, droppable = false) {
    if (!this.alive) return false;
    if (droppable && this.bufferedBytes > 192 * 1024) return false;
    this._frame(0x1, Buffer.from(text, 'utf8'));
    return true;
  }

  close(code = 1000, reason = '') {
    if (!this.alive) return;
    const r = Buffer.from(reason, 'utf8').subarray(0, 100);
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    this._frame(0x8, p);
    setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* ignore */ } }, 250);
    this._finish(code, reason);
  }

  _frame(op, payload) {
    if (!this.socket.writable) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    this.socket.write(Buffer.concat([head, payload]));
  }

  _finish(code, reason) {
    if (!this.alive) return;
    this.alive = false;
    clearInterval(this._ping);
    this.emit('close', code, reason);
  }

  _onData(d) {
    this.lastRecv = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.close(1009, 'message too big');
        len = Number(big); off = 10;
      }
      if (!masked) return this.close(1002, 'unmasked client frame');
      if (len > this.maxPayload) return this.close(1009, 'message too big');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._onFrame(fin, op, payload);
      if (!this.alive) return;
    }
  }

  _onFrame(fin, op, payload) {
    if (op === 0x8) { // close
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      this._frame(0x8, payload.subarray(0, 2));
      setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* ignore */ } }, 100);
      this._finish(code, 'closed by peer');
      return;
    }
    if (op === 0x9) { this._frame(0xA, payload); return; }
    if (op === 0xA) return;
    if (op === 0x1 || op === 0x2) {
      this.fragOp = op; this.frags = [payload]; this.fragLen = payload.length;
    } else if (op === 0x0) {
      this.frags.push(payload); this.fragLen += payload.length;
      if (this.fragLen > this.maxPayload) return this.close(1009, 'message too big');
    } else return this.close(1002, 'bad opcode');
    if (fin) {
      const full = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
      this.frags = []; this.fragLen = 0;
      if (this.fragOp === 0x1) this.emit('message', full.toString('utf8'));
    }
  }
}

/** attach to an http.Server: calls onConnection(conn, req) for every successful upgrade on `path` */
export function attachWebSocket(server, path, onConnection, opts = {}) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    onConnection(new WSConn(socket, opts), req);
  });
}
