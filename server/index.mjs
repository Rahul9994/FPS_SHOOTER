// Hollow Ridge LAN server: static file host + WebSocket multiplayer endpoint. Node 18+, no npm packages.
//   node server/index.mjs [--port 7777] [--debug]
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachWebSocket } from './ws.mjs';
import { Room } from './room.mjs';
import { World } from './world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.txt']);
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap-|warp|cloudflare|npcap|host-only|virtual/i;

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const virt = VIRTUAL.test(name) || /^192\.168\.56\./.test(a.address);
      out.push({ name, address: a.address, private: priv, virtual: virt, score: (priv ? 2 : 0) + (virt ? -3 : 0) + (/wi-?fi|wlan|wireless/i.test(name) ? 1 : 0) + (/ethernet/i.test(name) ? 0.5 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function loadConfig() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'game-config.json'), 'utf8')); }

export function startServer({ port, host = '0.0.0.0', debug = false, quiet = false } = {}) {
  const cfg = loadConfig();
  port = port == null ? cfg.net.defaultPort : port;
  const log = (m) => { if (!quiet) console.log(`[${new Date().toLocaleTimeString()}] ${m}`); };
  const room = new Room(cfg, log);
  const started = Date.now();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname === '/api/info') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        game: 'Hollow Ridge', proto: cfg.protocol, version: cfg.version, port, uptime: Math.round((Date.now() - started) / 1000), addresses: lanAddresses(),
        room: room.active ? { name: room.name, host: room.hostPlayer ? room.hostPlayer.name : '', players: room.players.size, max: room.settings.maxPlayers, state: room.state, map: room.mapDef().name, hasPass: !!room.pass } : null,
      }));
    }
    if (debug && req.method === 'POST' && url.pathname === '/api/debug/parity') return parity(req, res, cors);
    if (debug && req.method === 'POST' && url.pathname === '/api/debug/save') return saveShot(url, req, res, cors);
    if (debug && req.method === 'POST' && url.pathname === '/api/debug/dump') {   // raw JSON body -> test/out/<name>.json (used to capture a real world as a test fixture)
      const name = (url.searchParams.get('name') || 'dump').replace(/[^a-z0-9_-]/gi, ''), chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { fs.mkdirSync(path.join(ROOT, 'test', 'out'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'test', 'out', name + '.json'), Buffer.concat(chunks)); res.writeHead(200, cors); res.end('ok'); });
      return;
    }
    if (debug && url.pathname === '/api/debug/room') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ state: room.state, matchId: room.matchId, events: room.eventSeq, players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, alive: p.alive, hp: Math.round(p.hp), x: +p.x.toFixed(1), z: +p.z.toFixed(1), k: p.kills, d: p.deaths, hc: p.hc, sc: p.score, streak: p.streak, mag: p.mag, camo: p.camo })) })); }
    if (debug && url.pathname === '/api/debug/tp') {   // test hook: stage a scenario by moving a player (the client is told through a normal position correction)
      const p = room.players.get(+url.searchParams.get('id')); const x = +url.searchParams.get('x'), z = +url.searchParams.get('z');
      if (p && Number.isFinite(x) && Number.isFinite(z)) { p.x = x; p.z = z; p.y = room.world.height(x, z); p.hist = [{ t: performance.now(), x, y: p.y, z, yaw: p.yaw, cr: false }]; p.protectUntil = 0; room.correct(p); }
      res.writeHead(200, cors); return res.end(p ? 'ok' : 'no such player');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors); return res.end(); }
    serveStatic(url.pathname, req, res, cors, req.method === 'HEAD');
  });

  attachWebSocket(server, '/ws', (conn, req) => onConnection(conn, req), { timeoutMs: cfg.net.timeoutMs, maxPayload: 4 * 1024 * 1024 });

  function onConnection(conn) {
    let player = null, helloTimer = setTimeout(() => conn.close(1008, 'no hello'), 5000);
    let windowStart = Date.now(), count = 0, strikes = 0;
    conn.on('message', (text) => {
      const nowMs = Date.now();
      if (nowMs - windowStart > 1000) { strikes = count > 220 ? strikes + 1 : 0; windowStart = nowMs; count = 0; if (strikes >= 3) return conn.close(1008, 'rate limit'); }
      count++;
      let m; try { m = JSON.parse(text); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (!player) {
        if (m.t !== 'hello') return;
        clearTimeout(helloTimer);
        const r = room.join(conn, m);
        if (!r.ok) { conn.send(JSON.stringify({ t: 'reject', code: r.code, msg: r.msg })); log(`rejected ${conn.remote}: ${r.code}`); return setTimeout(() => conn.close(1000, r.code), 150); }
        player = r.player;
        if (r.pendingCreate) conn.send(JSON.stringify({ t: 'hosting', id: player.id, addresses: lanAddresses(), port, now: 0 }));
        return;
      }
      if (text.length > 16384 && m.t !== 'create') return;
      room.onMessage(player, m);
    });
    conn.on('close', () => { clearTimeout(helloTimer); if (player) room.leave(player, 'disconnected'); });
  }

  let last = Date.now();
  const timer = setInterval(() => { const n = Date.now(); room.tick(n - last); last = n; }, 33);

  /* Static files (index.html, vendor/, assets/). Everything is read once, gzip-compressed once (text files: the engine bundle and the
   * texture pack shrink to roughly a third) and kept in memory; clients revalidate with an ETag, so a LAN player who already has the
   * game files downloads nothing but a 304 on every start. Over file:// none of this applies - the browser just reads the SSD. */
  const staticCache = new Map();    // file -> { mtimeMs, size, etag, raw, gz }
  function serveStatic(pathname, req, res, cors, headOnly) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const top = rel.split('/')[1];
    if (!(rel === '/index.html' || top === 'vendor' || top === 'assets')) { res.writeHead(404, cors); return res.end('Not found'); }
    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403, cors); return res.end(); }
    fs.stat(file, (serr, st) => {
      if (serr || !st.isFile()) { res.writeHead(404, cors); return res.end('Not found'); }
      let ent = staticCache.get(file);
      const send = () => {
        const ext = path.extname(file).toLowerCase();
        const headers = { ...cors, 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: ent.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };   // no-cache = always revalidate (cheap 304)
        if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, headers); return res.end(); }
        const useGz = ent.gz && /gzip/.test(req.headers['accept-encoding'] || '');
        const body = useGz ? ent.gz : ent.raw;
        if (useGz) headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = body.length;
        res.writeHead(200, headers);
        res.end(headOnly ? undefined : body);
      };
      if (ent && ent.mtimeMs === st.mtimeMs && ent.size === st.size) return send();
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, cors); return res.end('Not found'); }
        const ext = path.extname(file).toLowerCase();
        ent = { mtimeMs: st.mtimeMs, size: st.size, etag: `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`, raw: data, gz: null };
        if (COMPRESSIBLE.has(ext) && data.length > 1024) zlib.gzip(data, { level: 6 }, (zerr, gz) => { if (!zerr && gz.length < data.length) ent.gz = gz; staticCache.set(file, ent); send(); });
        else { staticCache.set(file, ent); send(); }
      });
    });
  }

  /* debug only: lets the test harness store a canvas screenshot (data URL) so it can be inspected pixel-exact */
  function saveShot(url, req, res, cors) {
    const name = (url.searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '');
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8'), b64 = body.replace(/^data:image\/\w+;base64,/, '');
        fs.mkdirSync(path.join(ROOT, 'test', 'out'), { recursive: true });
        const file = path.join(ROOT, 'test', 'out', name + '.png'); fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' }); res.end(file);
      } catch (e) { res.writeHead(400, cors); res.end(String(e && e.message)); }
    });
  }

  /* debug only: compare the server's world queries with the client's for the same rays */
  function parity(req, res, cors) {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); const w = new World(); const n = w.load(b.world);
        let maxD = 0, miss = 0, worst = null;
        for (const r of b.rays) {
          const h = w.raycastStatic(r[0], r[1], r[2], r[3], r[4], r[5], r[6]); const ts = h ? h.t : -1, tc = r[7];
          if ((ts < 0) !== (tc < 0)) { miss++; if (!worst) worst = { r, ts, tc }; continue; }
          if (ts >= 0) { const d = Math.abs(ts - tc); if (d > maxD) { maxD = d; worst = { r, ts, tc }; } }
        }
        let maxH = 0, worstH = null;
        for (const q of b.pts || []) { const d = Math.abs(w.height(q[0], q[1]) - q[2]); if (d > maxH) { maxH = d; worstH = q; } }
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ colliders: n, rays: b.rays.length, hitMismatch: miss, maxDist: maxD, worst, maxHeightDiff: maxH, worstH }));
      } catch (e) { res.writeHead(400, cors); res.end(String(e && e.message)); }
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port; room.port = actual;
      resolve({ server, room, cfg, port: actual, close: () => { clearInterval(timer); for (const p of room.players.values()) p.conn.close(1001, 'server stopping'); server.close(); } });
    });
  });
}

/* ---------------------------------------------------------------------------- CLI */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), arg = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  const wantedPort = arg('port') ? parseInt(arg('port'), 10) : undefined;
  startServer({ port: wantedPort, debug: args.includes('--debug') }).then(({ port, cfg }) => {
    const addrs = lanAddresses();
    const line = '─'.repeat(64);
    console.log(`\n${line}\n  HOLLOW RIDGE · LAN server v${cfg.version} (protocol ${cfg.protocol})\n${line}`);
    console.log(`  On THIS PC:   http://localhost:${port}      ← open it, press MULTIPLAYER → HOST GAME`);
    if (addrs.length) {
      console.log('  Other PCs on the same Wi-Fi/LAN — enter this in JOIN GAME (or just open the URL in a browser):');
      for (const a of addrs) console.log(`      ${a.address.padEnd(16)} port ${port}   http://${a.address}:${port}   [${a.name}${a.virtual ? ', virtual adapter' : ''}]`);
    } else console.log('  No LAN network adapter found — connect to Wi-Fi / Ethernet first.');
    console.log(`\n  If other PCs cannot connect: allow Node.js through Windows Firewall (Private networks),`);
    console.log(`  or run Open-Firewall-Port.bat once as Administrator. Press Ctrl+C to stop.\n${line}\n`);
  }).catch((e) => {
    if (e && e.code === 'EADDRINUSE') console.error(`\nPort ${wantedPort || 7777} is already in use (is the server already running?). Use --port <n> to pick another.\n`);
    else console.error(e);
    process.exit(1);
  });
}
