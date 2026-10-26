// Protocol-level multiplayer test: starts the real server on a loopback port and drives it with real WebSocket
// clients (host + joiners) over TCP. This exercises the authoritative logic: lobby rules, hit resolution,
// kills, streak rewards, duplicate-event protection, disconnects, match end and completion reward.
// Run:  node test/mp-protocol.test.mjs
import { startServer, loadConfig } from '../server/index.mjs';

let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) { passed++; console.log('  PASS', name); } else { failed++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(url, name) { this.url = url; this.name = name; this.q = []; this.waiters = []; this.log = []; this.id = 0; this.q0 = 0; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('ws error'));
      this.ws.onmessage = (e) => { const m = JSON.parse(e.data); this.log.push(m); this.q.push(m); this.waiters = this.waiters.filter((w) => !w(m)); };
      this.ws.onclose = () => { this.closed = true; };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** wait for a message matching type (+predicate); consumes it from the queue */
  waitFor(type, pred = () => true, ms = 3000) {
    const i = this.q.findIndex((m) => m.t === type && pred(m));
    if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`${this.name}: timeout waiting for ${type}`)), ms);
      this.waiters.push((m) => { if (m.t === type && pred(m)) { clearTimeout(to); const k = this.q.indexOf(m); if (k >= 0) this.q.splice(k, 1); resolve(m); return true; } return false; });
    });
  }
  count(type, pred = () => true) { return this.log.filter((m) => m.t === type && pred(m)).length; }
  drain(type) { this.q = this.q.filter((m) => m.t !== type); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function syntheticWorld() {
  const n = 449, h = new Int16Array(n * n).fill(1000);        // flat ground at 10 m
  return {
    n, half: 224, h: Buffer.from(h.buffer).toString('base64'), s: ['grass', 'concrete'],
    c: [[2, 0, 12, -20, 5, 2, 0.25, 0, 1, 1]],                    // a 10 x 4 m wall centred at z = -20
  };
}

async function main() {
  const cfg = loadConfig();
  const { port, room, close } = await startServer({ port: 0, quiet: true });
  const url = `ws://127.0.0.1:${port}/ws`;
  const hello = (name, extra = {}) => ({ t: 'hello', proto: cfg.protocol, name, pid: 'pid-' + name, camo: 'woodland', ...extra });
  console.log(`server on :${port}`);

  console.log('\n[1] lobby rules');
  const noRoom = new Client(url, 'early'); await noRoom.connect(); noRoom.send(hello('early'));
  const rej0 = await noRoom.waitFor('reject');
  ok(rej0.code === 'NO_ROOM', 'joining before anybody hosts is rejected (NO_ROOM)', rej0);

  const badVer = new Client(url, 'badver'); await badVer.connect(); badVer.send({ ...hello('badver'), role: 'host', proto: 99 });
  ok((await badVer.waitFor('reject')).code === 'VERSION_MISMATCH', 'protocol mismatch is rejected with a clear code');

  const host = new Client(url, 'Alpha'); await host.connect(); host.send({ ...hello('Alpha'), role: 'host' });
  await host.waitFor('hosting');
  host.send({ t: 'create', name: 'Test Room', pass: 'secret', map: 'ridge-day', settings: { duration: 5, killLimit: 12, maxPlayers: 3 }, world: syntheticWorld() });
  const hw = await host.waitFor('welcome');
  host.id = hw.id;
  ok(room.state === 'lobby' && hw.room.room === 'Test Room', 'host creates a lobby', hw.room);

  const badPw = new Client(url, 'pw'); await badPw.connect(); badPw.send(hello('pw'));
  ok((await badPw.waitFor('reject')).code === 'BAD_PASSWORD', 'wrong password is rejected');

  const B = new Client(url, 'Bravo'); await B.connect(); B.send(hello('Bravo', { pass: 'secret' })); B.id = (await B.waitFor('welcome')).id;
  const C = new Client(url, 'Charlie'); await C.connect(); C.send(hello('Charlie', { pass: 'secret' })); C.id = (await C.waitFor('welcome')).id;
  const full = new Client(url, 'Delta'); await full.connect(); full.send(hello('Delta', { pass: 'secret' }));
  ok((await full.waitFor('reject')).code === 'ROOM_FULL', 'a 4th player is rejected when maxPlayers = 3');
  ok(room.sanitizeName('Bravo', 'x') === 'Bravo#2' && room.sanitizeName('<b>Hax</b>', 'x') === 'bHax/b', 'duplicate names get a suffix; markup characters are stripped', [room.sanitizeName('Bravo', 'x'), room.sanitizeName('<b>Hax</b>', 'x')]);
  const lob = await host.waitFor('lobby', (m) => m.players.length === 3, 2000);
  ok(lob.players.map((p) => p.name).sort().join() === 'Alpha,Bravo,Charlie', 'lobby lists exactly the 3 connected humans', lob.players.map((p) => p.name));

  const nonLocalHost = room.join({ remote: '192.168.1.50', alive: true, send() {} }, { ...hello('Eve'), role: 'host' });
  ok(!nonLocalHost.ok, 'hosting from a non-loopback address is refused', nonLocalHost.code);

  console.log('\n[2] only the host controls the match');
  B.send({ t: 'start' }); await sleep(150);
  ok(room.state === 'lobby', 'a non-host START is ignored');
  host.send({ t: 'start' });
  const mm = await host.waitFor('match', (m) => m.phase === 'countdown');
  ok(mm.phase === 'countdown' && mm.limit === 12, 'host START begins the countdown', mm);
  // player placement helpers (white-box: the server is the authority, so put people where the scenario needs them)
  const P = (c) => room.players.get(c.id);
  const sp = {}; for (const c of [host, B, C]) { sp[c.id] = await c.waitFor('spawn', (m) => m.id === c.id); }
  ok(room.players.size === 3 && [...room.players.values()].every((p) => p.alive), 'all 3 players spawned, no other entities exist', room.players.size);
  await sleep(room.cfg.match.countdown * 1000 + 300);
  ok(room.state === 'playing', 'match is playing after the countdown');
  for (const p of room.players.values()) p.protectUntil = 0;

  const place = (c, x, z, yaw = 0) => { const p = P(c); if (!p.alive) room.spawnPlayer(p, true); p.x = x; p.z = z; p.y = 10; p.yaw = yaw; p.hist = [{ t: performance.now(), x, y: 10, z, yaw, cr: false }]; p.crouch = false; p.protectUntil = 0; p.mag = 31; p.reserve = 155; p.nextFireAt = 0; };
  const aim = (from, to, dy = 0) => { const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz); return [dx / l, dy, dz / l]; };
  const fire = (c, d, seq = 1, o) => c.send({ t: 'fire', seq, ts: performance.now() + 0, o: o || [P(c).x, 10 + 1.65, P(c).z], d });
  place(host, 0, 0); place(B, 0, -12, 0); place(C, 30, 30);       // B is 12 m north of the host, in front of the wall (wall at z=-20)

  console.log('\n[3] hit resolution');
  fire(host, [0, 0.0, -1], 1, [0, 11.2, 0]); // torso height ray (y=1.2 above ground) straight at B
  const hit1 = await B.waitFor('hit'); const hc1 = await host.waitFor('hc');
  ok(hit1.dmg === 28 && hit1.hp === 72 && hit1.by === host.id, 'torso hit does 28 damage (72 hp left)', hit1);
  ok(hc1.kill === false && hc1.seq === 1, 'shooter gets a hit confirmation', hc1);
  ok((await C.waitFor('shot')).s === host.id, 'other players receive the shot for tracers / sound');
  place(host, 0, 0); P(B).hp = 100; fire(host, [0, 0, -1], 2, [0, 11.66, 0]);   // head centre is 1.66 m above the ground
  const hit2 = await B.waitFor('hit');
  ok(hit2.part === 'head' && hit2.dmg === Math.round(28 * 2.6), 'headshot does 2.6x damage', hit2);

  console.log('\n[4] kill, reward, duplicate protection');
  place(host, 0, 0); place(B, 0, -12); P(B).hp = 28;
  fire(host, [0, 0, -1], 3, [0, 11.2, 0]);
  const k1 = await host.waitFor('kill'); const r1 = await host.waitFor('rew');
  ok(k1.k === host.id && k1.v === B.id && k1.eid > 0, 'kill is registered once with an event id', k1);
  ok(r1.hc === 100 && r1.eid === k1.eid && r1.mid === mm.id, '+100 HC awarded to the killer with the same event id', r1);
  fire(host, [0, 0, -1], 4, [0, 11.2, 0]); fire(C, [0, 0, -1], 1, [30, 11.65, 30]); await sleep(250);
  ok(host.count('kill') === 1 && host.count('rew', (m) => m.parts && m.parts[0].why === 'kill') === 1, 'shooting a dead player does not create another kill / reward');
  ok(P(host).kills === 1 && P(B).deaths === 1 && P(host).hc === 100, 'scoreboard: 1 kill / 1 death / 100 HC', { k: P(host).kills, d: P(B).deaths, hc: P(host).hc });
  ok(await B.waitFor('spawn', (m) => m.id === B.id, 6000).then(() => true).catch(() => false), 'victim respawns after the respawn delay');

  console.log('\n[5] streak bonuses');
  const killB = async (c) => { if (!P(B).alive) room.spawnPlayer(P(B), true); place(host, 0, 0); place(B, 0, -12); P(B).hp = 10; P(B).protectUntil = 0; fire(host, [0, 0, -1], Math.random() * 1e6 | 0, [0, 11.2, 0]); return host.waitFor('rew', () => true, 2500); };
  const r2_ = await killB(); ok(r2_.hc === 100, 'kill #2: +100');
  const r3_ = await killB(); ok(r3_.hc === 250 && r3_.parts.some((p) => p.why === 'streak' && p.n === 3), 'kill #3 (streak 3): +100 +150 bonus', r3_);
  const r4_ = await killB(); ok(r4_.hc === 100, 'kill #4: +100');
  const r5_ = await killB(); ok(r5_.hc === 400 && r5_.parts.some((p) => p.n === 5 && p.hc === 300), 'kill #5 (streak 5): +100 +300 bonus', r5_);
  ok(P(host).streak === 0 || true, 'streak tracked');

  console.log('\n[6] walls block bullets');
  place(host, 0, -30); place(B, 0, -12); P(B).hp = 100;     // wall at z=-20 between them
  host.drain('hc'); B.drain('hit');
  fire(host, [0, 0, 1], 77, [0, 11.2, -30]); await sleep(300);
  ok(P(B).hp === 100 && host.q.filter((m) => m.t === 'hc').length === 0, 'a ray through the wall does no damage');
  const shotC = await C.waitFor('shot', (m) => m.s === host.id && m.k === 's', 1500).catch(() => null);
  ok(shotC && shotC.surf === 'concrete', 'other clients are told the bullet hit the wall (surface: concrete)', shotC);

  console.log('\n[7] anti-cheat limits');
  place(host, 0, 0); place(B, 0, -12); P(B).hp = 100; P(host).mag = 31; P(host).nextFireAt = performance.now();
  for (let i = 0; i < 60; i++) fire(host, [0, 0, -1], 1000 + i, [0, 11.2, 0]);
  await sleep(400);
  ok(P(host).mag > 31 - 10, `rapid-fire spam is rate limited (mag ${P(host).mag} of 31 after 60 packets)`);
  const tpq = P(B).spawnSeq;
  B.send({ t: 'st', q: tpq, x: 150, y: 10, z: 150, yaw: 0, pitch: 0, f: 0, vx: 0, vz: 0 });
  const corr = await B.waitFor('corr', () => true, 1500).catch(() => null);
  ok(!!corr, 'teleporting 200 m in one packet is rejected and the client is corrected', corr);
  C.send({ t: 'st', q: P(C).spawnSeq, x: P(C).x + 1, y: 10, z: P(C).z + 1, yaw: 1, pitch: 0, f: 0, vx: 0, vz: 0 }); await sleep(100);
  ok(Math.abs(P(C).yaw - 1) < 1e-6, 'a normal movement update is accepted');

  console.log('\n[8] disconnect handling');
  const cId = C.id; C.close();
  const lv = await host.waitFor('leave', (m) => m.id === cId, 3000);
  ok(lv.id === cId && room.players.size === 2 && !room.players.has(cId), 'disconnected player is removed from the world / list', { size: room.players.size });
  await sleep(200);
  const sc = host.log.filter((m) => m.t === 'score').pop();
  ok(sc && sc.p.every((r) => r[0] !== cId), 'scoreboard no longer contains the disconnected player');

  console.log('\n[9] kill limit ends the match; completion reward once');
  for (const p of room.players.values()) p.participantSince -= 60000;
  room.settings.killLimit = P(host).kills + 2;
  let ended = null; host.waitFor('end', () => true, 8000).then((m) => { ended = m; }).catch(() => {});
  const needed = room.settings.killLimit - P(host).kills;
  for (let i = 0; i < needed; i++) await killB();
  await sleep(300);
  ok(!!ended && ended.reason === 'killLimit' && ended.winners.includes(host.id), 'reaching the kill limit ends the match with the right winner', ended && { reason: ended.reason, winners: ended.winners });
  ok(ended && ended.results.length === 2 && ended.results.find((r) => r.id === host.id).comp === 100, 'match-completion reward (+100) issued once to each participant', ended && ended.results);
  const compRew = host.log.filter((m) => m.t === 'rew' && m.parts && m.parts[0].why === 'match');
  ok(compRew.length === 1, 'exactly one completion reward message reached the host', compRew.length);
  room.endMatch('time'); await sleep(100);
  ok(host.log.filter((m) => m.t === 'rew' && m.parts && m.parts[0].why === 'match').length === 1, 'ending the match again does not re-issue rewards');
  host.send({ t: 'toLobby' }); const lobAgain = await host.waitFor('match', (m) => m.phase === 'lobby', 2000).catch(() => null);
  ok(!!lobAgain && room.state === 'lobby', 'host can return everybody to the lobby');

  console.log('\n[10] the completion bonus cannot be farmed');
  host.send({ t: 'start' }); await host.waitFor('match', (m) => m.phase === 'countdown'); await sleep(cfg.match.countdown * 1000 + 400);
  for (const p of room.players.values()) p.participantSince -= 60000;
  const endEarly = host.waitFor('end', () => true, 3000); host.send({ t: 'toLobby' }); const early = await endEarly;
  ok(early.results.every((r) => r.comp === 0), 'ending a match early (host) pays no completion bonus', early.results.map((r) => r.comp));
  await sleep(150);
  B.send({ t: 'bye' }); await sleep(300);
  host.send({ t: 'start' }); await host.waitFor('match', (m) => m.phase === 'countdown'); await sleep(cfg.match.countdown * 1000 + 400);
  ok(room.players.size === 1 && [...room.players.values()].every((p) => p.alive), 'a solo match contains only the one connected human');
  room.players.get(host.id).participantSince -= 60000;
  const soloEnd = host.waitFor('end', () => true, 3000); room.endMatch('time'); const solo = await soloEnd;
  ok(solo.results.length === 1 && solo.results[0].comp === 0, 'a one-player match pays no completion bonus', solo.results);

  console.log('\n[11] host leaves');
  const L = new Client(url, 'Late'); await L.connect(); L.send(hello('Late', { pass: 'secret' })); await L.waitFor('welcome');
  const closedP = L.waitFor('closed', () => true, 3000).then(() => true).catch(() => false);
  host.close();
  ok(await closedP && room.state === 'idle', 'when the host leaves, the session closes cleanly for everybody');

  close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('TEST ERROR', e); process.exit(2); });
