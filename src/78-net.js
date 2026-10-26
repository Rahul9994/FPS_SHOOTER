/* =====================================================================
 *  HOLLOW RIDGE  -  78-net.js
 *  WebSocket transport to the LAN server (server/index.mjs), clock sync,
 *  world export (host -> server) and subnet scanning for game discovery.
 * ===================================================================== */

const PROTOCOL = CONFIG.protocol;

const Net = {
  ws: null, status: 'idle',           // idle | connecting | open | closed
  host: '', port: 0, role: '',
  offset: 0, rtt: 0, samples: [], _pingT: null, _handlers: null, _joinDone: null,

  /** page was served by the LAN server (http://<ip>:<port>/): that origin is the natural default target */
  pageServer() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return { host: location.hostname, port: parseInt(location.port || '80', 10) };
  },

  /**
   * open a session. resolves with the first server answer ('welcome' | 'hosting'); rejects with {code, msg}
   * handlers: { message(m), close(info) } are used after that.
   */
  connect({ host, port, role, name, pass, camo }, handlers) {
    this.close(true);
    this.host = host; this.port = port; this.role = role; this._handlers = handlers || {};
    this.status = 'connecting';
    return new Promise((resolve, reject) => {
      let settled = false, opened = false, ws;
      const fail = (code, msg) => { if (settled) return; settled = true; clearTimeout(timer); this.status = 'closed'; try { ws && ws.close(); } catch (e) { /* ignore */ } reject({ code, msg }); };
      const hint = 'Check that the host PC is running the Hollow Ridge server (Host-LAN-Game.bat), that both PCs are on the same Wi-Fi network, that the IP address is right, and that Windows Firewall allows Node.js on Private networks.';
      const unreachable = `Could not reach ${host}:${port}. ${hint}`;
      const timer = setTimeout(() => fail('TIMEOUT', `No answer from ${host}:${port} after 6 seconds. ${hint}`), 6000);
      try { ws = new WebSocket(`ws://${host}:${port}/ws`); } catch (e) { return fail('BAD_ADDRESS', 'Invalid address "' + host + ':' + port + '".'); }
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL, build: CONFIG.version, role, name, pass: pass || '', pid: Profile.data.pid, camo }));
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!settled) {
          if (m.t === 'welcome' || m.t === 'hosting') {
            settled = true; clearTimeout(timer); this.status = 'open';
            if (m.now != null && m.t === 'welcome') this.offset = m.now - performance.now();
            this._startPing();
            resolve(m);
            if (this._handlers.message && m.t === 'welcome') this._handlers.message(m);
          } else if (m.t === 'reject') fail(m.code, m.msg);
          return;
        }
        if (m.t === 'pong') { this._onPong(m); return; }
        this._handlers.message && this._handlers.message(m);
      };
      ws.onerror = () => { if (!settled) fail('UNREACHABLE', unreachable); };
      ws.onclose = (ev) => {
        const was = this.status;
        clearInterval(this._pingT); this.status = 'closed';
        if (!settled) { fail(opened ? 'CLOSED' : 'UNREACHABLE', opened ? 'The host closed the connection.' : unreachable); return; }
        if (was === 'open' && ws === this.ws) this._handlers.close && this._handlers.close({ code: ev.code, reason: ev.reason });
      };
    });
  },

  send(o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; },
  close(silent) {
    clearInterval(this._pingT);
    if (this.ws) { const w = this.ws; this.ws = null; if (silent) { w.onclose = null; w.onerror = null; w.onmessage = null; } try { if (w.readyState === 1) w.send(JSON.stringify({ t: 'bye' })); w.close(); } catch (e) { /* ignore */ } }
    this.status = 'idle'; this.samples.length = 0;
  },
  get open() { return this.status === 'open'; },

  serverNow() { return performance.now() + this.offset; },
  _startPing() {
    clearInterval(this._pingT); this.samples.length = 0;
    const ping = () => this.send({ t: 'ping', c: performance.now(), lat: this.rtt });
    ping(); setTimeout(ping, 150); setTimeout(ping, 400);
    this._pingT = setInterval(ping, 2000);
  },
  _onPong(m) {
    const now = performance.now(), rtt = now - m.c;
    if (!(rtt >= 0 && rtt < 5000)) return;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    this.samples.push({ rtt, off: m.s + rtt / 2 - now }); if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));      // the lowest-latency sample has the least asymmetry
    this.offset = best.off;
  },

  /* ---------------------------------------- world upload (host only) */
  exportWorld() {
    const n = WORLD.n, d = HM.data, i16 = new Int16Array(n * n);
    for (let i = 0; i < i16.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 100)));
    const bytes = new Uint8Array(i16.buffer); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const surfs = [], si = new Map();
    const sid = (s) => { if (!si.has(s)) { si.set(s, surfs.length); surfs.push(s); } return si.get(s); };
    const c = [];
    for (const k of Colliders.list) {
      if (k.disabled) continue;
      const flags = (k.solid ? 1 : 0) | (k.noRay ? 2 : 0);
      if (k.kind === 'cyl') c.push([0, k.x, k.y, k.z, k.r, k.h, 0, 0, sid(k.surf), flags]);
      else if (k.kind === 'sph') c.push([1, k.x, k.y, k.z, k.r, 0, 0, 0, sid(k.surf), flags]);
      else c.push([2, k.x, k.y, k.z, k.hx, k.hy, k.hz, k.rot || 0, sid(k.surf), flags]);
    }
    return { n, half: WORLD.half, h: btoa(bin), s: surfs, c };
  },
};

/* ===================================================================== LAN discovery
 * Browsers cannot send UDP broadcasts, so discovery probes the local /24 subnet(s) over HTTP
 * (the server answers GET /api/info with CORS enabled). It only ever touches port <port>. */
const LanScan = {
  running: false,
  prefixes(hint) {
    const out = [], add = (p) => { if (p && !out.includes(p)) out.push(p); };
    // whatever the player already typed in the address box ("10.22.146." or a full IP) tells us which subnet to try first
    const hm = /^\s*(\d{1,3}\.\d{1,3}\.\d{1,3})\.?\d{0,3}\s*$/.exec(hint || ''); if (hm) add(hm[1] + '.');
    const ps = Net.pageServer();
    if (ps && /^\d+\.\d+\.\d+\.\d+$/.test(ps.host) && ps.host !== '127.0.0.1') add(ps.host.replace(/\d+$/, ''));
    try { const last = localStorage.getItem('hollowRidge.lastHost'); if (last && /^\d+\.\d+\.\d+\.\d+$/.test(last)) add(last.replace(/\d+$/, '')); } catch (e) { /* ignore */ }
    for (const p of ['192.168.1.', '192.168.0.', '192.168.2.', '10.0.0.', '192.168.137.', '172.20.10.', '192.168.43.', '10.0.1.', '192.168.68.', '192.168.50.', '10.1.1.']) add(p);
    return out;
  },
  async probe(host, port, timeout) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(`http://${host}:${port}/api/info`, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) return null; const j = await r.json();
      return j && j.game === 'Hollow Ridge' ? j : null;
    } catch (e) { return null; } finally { clearTimeout(to); }
  },
  /** onFound({host, port, info}), onProgress(done, total) ; returns when finished or cancelled */
  async scan(port, onFound, onProgress, shouldStop, hint) {
    this.running = true;
    const targets = [];
    const last = (() => { try { return localStorage.getItem('hollowRidge.lastHost'); } catch (e) { return null; } })();
    if (last) targets.push(last);
    targets.push('127.0.0.1');
    for (const p of this.prefixes(hint)) for (let i = 1; i < 255; i++) targets.push(p + i);
    const uniq = Array.from(new Set(targets)); let done = 0, idx = 0;
    const worker = async () => {
      while (idx < uniq.length && !(shouldStop && shouldStop())) {
        const h = uniq[idx++], info = await this.probe(h, port, 650);
        if (info) onFound({ host: h, port, info });
        done++; if (onProgress && (done % 6 === 0 || done === uniq.length)) onProgress(done, uniq.length);
      }
    };
    await Promise.all(Array.from({ length: 56 }, worker));
    this.running = false;
  },
};
