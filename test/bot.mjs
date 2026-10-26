// TEST TOOLING ONLY (not part of the game): a scripted protocol client used to exercise the real browser
// client from outside.  It speaks the same WebSocket protocol as a player, so the server treats it as a
// connected human.  Usage:  node test/bot.mjs <host:port> <name> [--shoot] [--camo id] [--secs 60] [--pass x]
import { loadConfig } from '../server/index.mjs';

const args = process.argv.slice(2);
const target = args[0] || '127.0.0.1:7777', name = args[1] || 'Tester';
const flag = (n) => args.includes('--' + n), val = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const cfg = loadConfig();
const ws = new WebSocket(`ws://${target}/ws`);
let me = 0, q = 0, pos = { x: 0, y: 0, z: 0 }, yaw = 0, alive = false, phase = 'lobby', yawT = 0;
const others = new Map(); let lastFire = 0, t0 = performance.now();
const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const log = (...a) => console.log(`[${name}]`, ...a);
ws.onopen = () => send({ t: 'hello', proto: cfg.protocol, name, pid: 'bot-' + name, camo: val('camo', 'factory'), pass: val('pass', '') });
ws.onclose = () => { log('closed'); process.exit(0); };
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  switch (m.t) {
    case 'welcome': me = m.id; log('joined as', me, 'room:', m.room.room); break;
    case 'reject': log('REJECTED', m.code, m.msg); process.exit(1); break;
    case 'match': phase = m.phase; log('match phase', m.phase); break;
    case 'spawn': if (m.id === me) { pos = { x: m.x, y: m.y, z: m.z }; yaw = m.yaw; q = m.q; alive = true; log('spawned at', m.x, m.z); } else others.set(m.id, { x: m.x, y: m.y, z: m.z, alive: true }); break;
    case 'snap': for (const r of m.p) if (r[0] !== me) others.set(r[0], { x: r[1], y: r[2], z: r[3], alive: true }); break;
    case 'corr': pos = { x: m.x, y: m.y, z: m.z }; q = m.q; break;
    case 'kill': if (m.v === me) { alive = false; log('I was killed by', m.k); } else { const o = others.get(m.v); if (o) o.alive = false; } break;
    case 'hit': log('hit by', m.by, 'dmg', m.dmg, 'hp', m.hp); break;
    case 'rew': log('reward', m.hc, JSON.stringify(m.parts)); break;
    case 'end': log('match ended; winners', m.winners); break;
    case 'closed': log('session closed:', m.msg); process.exit(0); break;
    default:
  }
};
setInterval(() => send({ t: 'ping', c: performance.now(), lat: 5 }), 2000);
setInterval(() => {                       // 10 Hz movement: wander slowly in a circle
  if (!alive || phase !== 'playing') return;
  yawT += 0.1;
  pos.x += Math.cos(yawT) * 0.25; pos.z += Math.sin(yawT) * 0.25; yaw = -yawT;
  send({ t: 'st', q, x: pos.x, y: pos.y, z: pos.z, yaw, pitch: 0, vx: 2, vz: 0, f: 8, ts: performance.now() });
}, 100);
if (flag('shoot')) setInterval(() => {   // shoot at the nearest living player twice a second
  if (!alive || phase !== 'playing') return;
  let best = null, bd = 1e9;
  for (const o of others.values()) { if (!o.alive) continue; const d = Math.hypot(o.x - pos.x, o.z - pos.z); if (d < bd) { bd = d; best = o; } }
  if (!best || bd > 150) return;
  const ox = pos.x, oy = pos.y + 1.65, oz = pos.z, tx = best.x, ty = best.y + 1.2, tz = best.z, l = Math.hypot(tx - ox, ty - oy, tz - oz);
  send({ t: 'fire', seq: ++lastFire, ts: performance.now(), o: [ox, oy, oz], d: [(tx - ox) / l, (ty - oy) / l, (tz - oz) / l] });
}, 180);
setTimeout(() => { send({ t: 'bye' }); setTimeout(() => process.exit(0), 200); }, parseFloat(val('secs', '60')) * 1000);
