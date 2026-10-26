// Authoritative multiplayer session: lobby, match state machine, hit resolution, scoring and rewards.
// Clients only ever *report* what they did (position, "I fired this ray"); damage, kills, deaths,
// respawns, streaks and Hollow Credit rewards are decided here.
import crypto from 'node:crypto';
import { World, rayPlayer } from './world.mjs';

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;       // ms, monotonic
const r2 = (v) => Math.round(v * 100) / 100;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const EYE_STAND = 1.65, EYE_CROUCH = 1.02, HIST_MS = 1000, MAX_BUDGET = 12, MOVE_SPEED = 8.8;
const CRATE = { x: 7, z: 92 };       // src/10-terrain.js LAYOUT.ammoCrate

export class Room {
  constructor(cfg, log = () => {}) {
    this.cfg = cfg; this.log = log;
    this.world = new World();
    this.spawns = [];
    this.resetToIdle();
  }

  resetToIdle() {
    this.state = 'idle';            // idle | lobby | countdown | playing | ended
    this.players = new Map();
    this.nextId = 1;
    this.hostId = 0; this.name = ''; this.pass = '';
    this.mapId = this.cfg.maps[0].id;
    this.settings = { ...this.cfg.match.defaults };
    this.matchId = ''; this.matchStart = 0; this.matchEnd = 0; this.endedAt = 0;
    this.eventSeq = 0; this.banned = new Set(); this.rewardedPids = new Set();
    this.lastSnap = 0; this.scoreDirty = false; this.lastScore = 0;
    this.pendingHost = null;
  }

  get hostPlayer() { return this.players.get(this.hostId); }
  get active() { return this.state !== 'idle'; }
  send(p, obj) { if (p.conn && p.conn.alive) p.conn.send(JSON.stringify(obj)); }
  broadcast(obj, except) { const s = JSON.stringify(obj); for (const p of this.players.values()) if (p !== except && p.conn.alive) p.conn.send(s); }
  mapDef() { return this.cfg.maps.find((m) => m.id === this.mapId) || this.cfg.maps[0]; }

  /* ------------------------------------------------------------------ joining */
  sanitizeName(raw, fallback) {
    let n = String(raw == null ? '' : raw).replace(/[\u0000-\u001f<>&"`\\]/g, '').trim().slice(0, 16);
    if (!n) n = fallback;
    const taken = (x) => [...this.players.values()].some((p) => p.name.toLowerCase() === x.toLowerCase());
    let out = n, i = 2;
    while (taken(out)) out = (n.slice(0, 13) + '#' + i++);
    return out;
  }

  /** returns {ok:true, player} or {ok:false, code, msg} */
  join(conn, hello) {
    const proto = this.cfg.protocol;
    if (hello.proto !== proto) return { ok: false, code: 'VERSION_MISMATCH', msg: `Protocol mismatch: server ${proto}, your game ${hello.proto}. Rebuild / update the game (node build.mjs) so both sides run the same version.` };
    const pid = String(hello.pid || '').slice(0, 40);
    if (pid && this.banned.has(pid)) return { ok: false, code: 'KICKED', msg: 'The host removed you from this session.' };
    const isHost = hello.role === 'host';
    if (isHost) {
      if (this.state !== 'idle' || this.pendingHost) return { ok: false, code: 'HOST_BUSY', msg: 'A game is already being hosted on this server.' };
      if (!isLoopback(conn.remote)) return { ok: false, code: 'NOT_LOCAL', msg: 'Only the PC that runs the server can host the game. Open the game on the host PC (http://localhost:' + (this.port || this.cfg.net.defaultPort) + ') and press HOST GAME there.' };
    } else {
      if (this.state === 'idle') return { ok: false, code: 'NO_ROOM', msg: 'The server is reachable, but nobody is hosting a game yet.' };
      if (this.pass && hello.pass !== this.pass) return { ok: false, code: 'BAD_PASSWORD', msg: 'Wrong room password.' };
      if (this.players.size >= this.settings.maxPlayers) return { ok: false, code: 'ROOM_FULL', msg: `Room is full (${this.players.size}/${this.settings.maxPlayers}).` };
    }
    const p = this.makePlayer(conn, hello);
    if (isHost) { this.pendingHost = p; return { ok: true, player: p, pendingCreate: true }; }
    this.players.set(p.id, p);
    p.participantSince = now();
    const inProgress = this.state === 'playing' || this.state === 'countdown';
    this.log(`+ ${p.name} joined (${this.players.size}/${this.settings.maxPlayers}) from ${conn.remote}`);
    this.send(p, { t: 'welcome', id: p.id, now: r2(now()), proto, room: this.lobbyInfo(), inProgress });
    this.broadcast({ t: 'lobby', ...this.lobbyInfo() });
    if (inProgress) {
      this.send(p, this.matchMsg());
      for (const q of this.players.values()) if (q !== p && q.alive) this.send(p, { t: 'spawn', id: q.id, x: r2(q.x), y: r2(q.y), z: r2(q.z), yaw: r2(q.yaw), prot: 0, q: q.spawnSeq, mag: q.mag, res: q.reserve, hp: Math.round(q.hp), existing: true });
      this.spawnPlayer(p, true); this.broadcast({ t: 'toast', msg: `${p.name} joined the match` }, p); this.sendFullScore(p);
    }
    return { ok: true, player: p };
  }

  makePlayer(conn, hello) {
    const id = this.nextId++;
    return {
      id, conn, pid: String(hello.pid || '').slice(0, 40) || ('anon-' + id), name: this.sanitizeName(hello.name, 'Operator' + id),
      camo: /^[a-z0-9_-]{1,24}$/.test(hello.camo || '') ? hello.camo : 'factory',
      alive: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, flags: 0, weapon: 'rifle', crouch: false,
      hp: 100, lastDamageT: 0, kills: 0, deaths: 0, score: 0, hc: 0, streak: 0, bestStreak: 0,
      mag: 31, reserve: this.cfg.weapons.rifle.reserve, reloadUntil: 0, reloadFill: false, nextFireAt: 0, lastMelee: 0, lastSupply: -1e9,
      respawnAt: 0, protectUntil: 0, hist: [], budget: MAX_BUDGET, lastStT: now(), spawnSeq: 0, violations: 0,
      ping: 0, dirty: true, lastSent: 0, participantSince: now(), rewarded: false,
    };
  }

  /* host creates the room: settings + world upload */
  create(p, m) {
    if (this.pendingHost !== p) return this.send(p, { t: 'error', code: 'BAD_STATE', msg: 'Not waiting for a room.' });
    try { const n = this.world.load(m.world); this.log(`world uploaded: ${n} colliders`); }
    catch (e) { return this.send(p, { t: 'error', code: 'BAD_WORLD', msg: 'World upload rejected: ' + e.message }); }
    this.name = String(m.name || (p.name + "'s game")).replace(/[\u0000-\u001f<>&"`\\]/g, '').trim().slice(0, 28) || 'Hollow Ridge LAN';
    this.pass = String(m.pass || '').slice(0, 24);
    this.applySettings(m);
    this.pendingHost = null; this.hostId = p.id; this.players.set(p.id, p); p.participantSince = now();
    this.spawns = this.cfg.spawns.filter(([x, z]) => !this.world.blocked(x, z, 0.8)).map(([x, z]) => ({ x, z }));
    if (this.spawns.length < 4) this.spawns = this.cfg.spawns.map(([x, z]) => ({ x, z }));
    this.state = 'lobby';
    this.log(`room "${this.name}" created by ${p.name}; ${this.spawns.length} spawn points`);
    this.send(p, { t: 'welcome', id: p.id, now: r2(now()), proto: this.cfg.protocol, room: this.lobbyInfo(), host: true });
    this.broadcast({ t: 'lobby', ...this.lobbyInfo() });
  }

  applySettings(m) {
    const M = this.cfg.match;
    if (m.map && this.cfg.maps.some((x) => x.id === m.map)) this.mapId = m.map;
    const s = m.settings || {};
    if (fin(s.duration)) this.settings.duration = clampN(Math.round(s.duration), 1, 60);
    if (fin(s.killLimit)) this.settings.killLimit = clampN(Math.round(s.killLimit), 1, 200);
    if (fin(s.maxPlayers)) this.settings.maxPlayers = clampN(Math.round(s.maxPlayers), Math.max(1, this.players.size), M.maxPlayers);
  }

  lobbyInfo() {
    const h = this.hostPlayer;
    return {
      room: this.name, hasPass: !!this.pass, hostId: this.hostId, host: h ? h.name : '', map: this.mapId, mapName: this.mapDef().name,
      settings: this.settings, state: this.state, max: this.settings.maxPlayers,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, camo: p.camo, ping: Math.round(p.ping), host: p.id === this.hostId })),
    };
  }

  matchMsg() {
    const md = this.mapDef();
    return { t: 'match', phase: this.state, id: this.matchId, start: r2(this.matchStart), end: r2(this.matchEnd), dur: this.settings.duration * 60, limit: this.settings.killLimit, now: r2(now()),
      env: { hour: md.hour, weather: md.weather, intensity: md.intensity }, map: this.mapId };
  }

  /* --------------------------------------------------------------- leaving */
  leave(p, reason = 'left') {
    if (this.pendingHost === p) { this.pendingHost = null; return; }
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.log(`- ${p.name} ${reason} (${this.players.size} left)`);
    if (p.id === this.hostId) {
      this.broadcast({ t: 'closed', msg: 'The host left — session closed.' });
      for (const q of this.players.values()) q.conn.close(1000, 'host left');
      this.log('host left, room closed');
      this.resetToIdle();
      return;
    }
    this.broadcast({ t: 'leave', id: p.id, name: p.name, reason });
    this.broadcast({ t: 'lobby', ...this.lobbyInfo() });
    this.scoreDirty = true;
    if (this.state === 'playing' && this.players.size === 0) this.endMatch('empty');
  }

  /* -------------------------------------------------------------- messages */
  onMessage(p, m) {
    if (!m || typeof m.t !== 'string') return;
    const t = now();
    switch (m.t) {
      case 'create': return this.create(p, m);
      case 'st': return this.onState(p, m, t);
      case 'fire': return this.onFire(p, m, t);
      case 'melee': return this.onMelee(p, m, t);
      case 'reload': return this.onReload(p, t);
      case 'resup': return this.onResupply(p, t);
      case 'ping': p.ping = fin(m.lat) ? clampN(m.lat, 0, 2000) : p.ping; return this.send(p, { t: 'pong', c: m.c, s: r2(t) });
      case 'camo': if (/^[a-z0-9_-]{1,24}$/.test(m.id || '')) { p.camo = m.id; this.broadcast({ t: 'camo', id: p.id, camo: p.camo }); } return;
      case 'name': { const nn = this.sanitizeName(m.name, p.name); const prev = p.name; if (nn !== prev) { p.name = nn; this.broadcast({ t: 'lobby', ...this.lobbyInfo() }); } return; }
      case 'settings': if (p.id === this.hostId && this.state === 'lobby') { this.applySettings(m); if (typeof m.room === 'string' && m.room.trim()) this.name = m.room.trim().slice(0, 28); this.broadcast({ t: 'lobby', ...this.lobbyInfo() }); } return;
      case 'start': if (p.id === this.hostId && this.state === 'lobby') this.startMatch(); return;
      case 'toLobby': if (p.id === this.hostId && (this.state === 'ended' || this.state === 'playing' || this.state === 'countdown')) { if (this.state !== 'ended') this.endMatch('host'); this.toLobby(); } return;
      case 'kick': {
        if (p.id !== this.hostId) return;
        const q = this.players.get(m.id | 0);
        if (q && q.id !== this.hostId) { this.banned.add(q.pid); this.send(q, { t: 'kicked', msg: 'You were removed by the host.' }); q.conn.close(1000, 'kicked'); this.leave(q, 'was removed'); }
        return;
      }
      case 'bye': return this.leave(p, 'left');
      default: return;
    }
  }

  onState(p, m, t) {
    if (!p.alive || (this.state !== 'playing' && this.state !== 'countdown')) return;
    if ((m.q | 0) !== p.spawnSeq) return;                         // stale: sent before the client applied our last spawn / correction
    const x = +m.x, y = +m.y, z = +m.z;
    if (!fin(x) || !fin(y) || !fin(z) || !fin(+m.yaw) || !fin(+m.pitch)) return;
    const dt = Math.min(1, Math.max(0, (t - p.lastStT) / 1000)); p.lastStT = t;
    p.budget = Math.min(MAX_BUDGET, p.budget + MOVE_SPEED * dt);
    const dist = Math.hypot(x - p.x, z - p.z), gh = this.world.height(x, z);
    const frozen = this.state === 'countdown';
    let bad = Math.abs(x) > 201 || Math.abs(z) > 201 || y < gh - 1.2 || y > gh + 4.5 || dist > p.budget + 1.2 || (frozen && dist > 1.5);
    if (bad) { p.violations++; this.correct(p); return; }
    p.budget = Math.max(0, p.budget - dist);
    p.x = x; p.y = y; p.z = z; p.yaw = +m.yaw; p.pitch = clampN(+m.pitch, -1.6, 1.6);
    p.vx = fin(+m.vx) ? clampN(+m.vx, -12, 12) : 0; p.vz = fin(+m.vz) ? clampN(+m.vz, -12, 12) : 0;
    p.flags = m.f | 0; p.crouch = !!(p.flags & 1);
    const wpn = (p.flags & 32) ? 'knife' : 'rifle';
    if (wpn !== p.weapon) { p.weapon = wpn; if (wpn === 'knife') p.reloadUntil = 0; }
    p.dirty = true;
    p.hist.push({ t, x, y, z, yaw: p.yaw, cr: p.crouch });
    while (p.hist.length > 2 && t - p.hist[0].t > HIST_MS) p.hist.shift();
  }

  correct(p) { p.spawnSeq++; this.send(p, { t: 'corr', x: r2(p.x), y: r2(p.y), z: r2(p.z), q: p.spawnSeq }); }

  poseAt(q, tt) {
    const h = q.hist;
    if (h.length < 2 || tt >= h[h.length - 1].t) return h.length ? h[h.length - 1] : { x: q.x, y: q.y, z: q.z, yaw: q.yaw, cr: q.crouch };
    if (tt <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= tt) {
        const a = h[i - 1], b = h[i], k = (tt - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: b.yaw, cr: b.cr };
      }
    }
    return h[0];
  }

  /* ---- shared by firearms + knife: find nearest static / player hit along a validated ray */
  castRay(p, ox, oy, oz, dx, dy, dz, range, rewindT, protectedOk) {
    const wall = this.world.raycastStatic(ox, oy, oz, dx, dy, dz, range);
    let bestT = wall ? wall.t : range, victim = null, part = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (!protectedOk && now() < q.protectUntil) continue;
      const pose = this.poseAt(q, rewindT);
      if (Math.hypot(pose.x - ox, pose.z - oz) > bestT + 2) continue;
      const h = rayPlayer(pose.x, pose.y, pose.z, pose.yaw, pose.cr, ox, oy, oz, dx, dy, dz, bestT);
      if (h && h.t < bestT) { bestT = h.t; victim = q; part = h.part; }
    }
    return { t: bestT, victim, part, wall: victim ? null : wall };
  }

  validatedOrigin(p, o) {
    const eye = p.crouch ? EYE_CROUCH : EYE_STAND;
    const sx = p.x, sy = p.y + eye, sz = p.z;
    if (Array.isArray(o) && o.length === 3 && o.every(fin) && Math.hypot(o[0] - sx, o[1] - sy, o[2] - sz) < 3.0) return o;
    return [sx, sy, sz];
  }

  onFire(p, m, t) {
    if (this.state !== 'playing' || !p.alive) return;
    const W = this.cfg.weapons.rifle, interval = 60000 / W.rpm;
    if (p.weapon !== 'rifle' || t < p.reloadUntil || p.mag <= 0) return;
    if (t < p.nextFireAt - interval * 1.5) return;                    // token bucket: lets bursts of jittered packets through, not rapid-fire hacks
    p.nextFireAt = Math.max(p.nextFireAt, t - interval) + interval;
    p.mag--;
    const d = m.d;
    if (!Array.isArray(d) || d.length !== 3 || !d.every(fin)) return;
    const len = Math.hypot(d[0], d[1], d[2]); if (len < 0.5) return;
    const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
    const o = this.validatedOrigin(p, m.o);
    const rewind = clampN((fin(m.ts) ? m.ts : t) - this.cfg.net.interpDelayMs, t - 400, t);
    const hit = this.castRay(p, o[0], o[1], o[2], dx, dy, dz, W.range, rewind, false);
    const end = [o[0] + dx * hit.t, o[1] + dy * hit.t, o[2] + dz * hit.t];
    const shot = { t: 'shot', s: p.id, o: o.map(r2), e: end.map(r2) };
    if (hit.victim) shot.k = 'p';
    else if (hit.wall) { shot.k = 's'; shot.n = [hit.wall.nx, hit.wall.ny, hit.wall.nz].map(r2); shot.surf = hit.wall.surf; }
    this.broadcast(shot, p);
    p.lastShotAt = t;
    if (hit.victim) {
      const mult = hit.part === 'head' ? W.headMult : hit.part === 'leg' ? W.limbMult : 1;
      this.damage(hit.victim, p, W.damage * mult, hit.part, 'rifle', m.seq);
    }
  }

  onMelee(p, m, t) {
    if (this.state !== 'playing' || !p.alive) return;
    const K = this.cfg.weapons.knife;
    if (t - p.lastMelee < 280) return;
    p.lastMelee = t;
    const heavy = !!m.heavy, range = (heavy ? K.stabRange : K.slashRange) + 0.7;
    const d = m.d; if (!Array.isArray(d) || d.length !== 3 || !d.every(fin)) return;
    const len = Math.hypot(d[0], d[1], d[2]); if (len < 0.5) return;
    const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
    const o = this.validatedOrigin(p, m.o);
    const rewind = clampN((fin(m.ts) ? m.ts : t) - this.cfg.net.interpDelayMs, t - 400, t);
    // the client sweeps five rays across the swing; do the same
    const rx = -dz, rz = dx, rl = Math.hypot(rx, rz) || 1;
    let best = null;
    for (const off of [0, -0.22, 0.22, -0.4, 0.4]) {
      const ex = dx + (rx / rl) * off, ez = dz + (rz / rl) * off, el = Math.hypot(ex, dy, ez);
      const h = this.castRay(p, o[0], o[1], o[2], ex / el, dy / el, ez / el, range, rewind, false);
      if (h.victim && (!best || h.t < best.t)) best = h;
      if (best && off === 0) break;
    }
    this.broadcast({ t: 'melee', s: p.id, heavy }, p);
    if (best) this.damage(best.victim, p, heavy ? K.stabDamage : K.slashDamage, best.part === 'head' ? 'torso' : best.part, 'knife', m.seq);
  }

  onReload(p, t) {
    if (this.state !== 'playing' || !p.alive || p.weapon !== 'rifle' || t < p.reloadUntil) return;
    const W = this.cfg.weapons.rifle, cap = W.mag + (p.mag > 0 ? 1 : 0);
    if (p.mag >= cap || p.reserve <= 0) return;
    const dur = (p.mag <= 0 ? W.reloadEmpty : W.reloadTactical) * 1000 * 0.85;
    p.reloadUntil = t + dur; p.reloadFill = true;
  }

  finishReload(p) {
    const W = this.cfg.weapons.rifle, cap = W.mag + (p.mag > 0 ? 1 : 0), need = cap - p.mag, take = Math.min(need, p.reserve);
    p.mag += take; p.reserve -= take; p.reloadFill = false;
    this.send(p, { t: 'ammo', mag: p.mag, res: p.reserve });
  }

  onResupply(p, t) {
    if (this.state !== 'playing' || !p.alive) return;
    const M = this.cfg.match;
    if (t - p.lastSupply < M.resupplyCooldown * 1000 || Math.hypot(p.x - CRATE.x, p.z - CRATE.z) > M.resupplyRadius + 1.0) return this.send(p, { t: 'toast', msg: 'Supply crate not ready' });
    p.lastSupply = t; p.mag = this.cfg.weapons.rifle.mag + 1; p.reserve = this.cfg.weapons.rifle.reserve; p.reloadUntil = 0; p.reloadFill = false;
    this.send(p, { t: 'ammo', mag: p.mag, res: p.reserve, resup: true });
  }

  /* ------------------------------------------------------ damage / kills / rewards */
  damage(victim, attacker, dmg, part, weapon, seq) {
    const t = now();
    if (!victim.alive || t < victim.protectUntil || this.state !== 'playing') return;      // dead players and spawn-protected players can't be hurt (and so can't be "killed twice")
    victim.hp -= dmg; victim.lastDamageT = t;
    this.send(victim, { t: 'hit', by: attacker.id, dmg: Math.round(dmg), hp: Math.max(0, Math.round(victim.hp)), part, fx: r2(attacker.x), fz: r2(attacker.z) });
    const killed = victim.hp <= 0;
    this.send(attacker, { t: 'hc', seq, part, dmg: Math.round(dmg), kill: killed });
    if (killed) this.kill(victim, attacker, weapon, part);
    else victim.dirty = true;
  }

  kill(victim, attacker, weapon, part) {
    const t = now(), R = this.cfg.economy.rewards;
    victim.alive = false; victim.hp = 0; victim.deaths++; victim.streak = 0; victim.respawnAt = t + this.cfg.match.respawnDelay * 1000; victim.flags = 0; victim.reloadUntil = 0;
    const eid = ++this.eventSeq;
    const hs = part === 'head';
    const credited = this.players.has(attacker.id) && attacker.conn.alive;
    let reward = 0; const parts = [];
    if (credited) {
      attacker.kills++; attacker.streak++; attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
      reward = R.kill; parts.push({ why: 'kill', hc: R.kill });
      if (hs && R.headshotBonus) { reward += R.headshotBonus; parts.push({ why: 'headshot', hc: R.headshotBonus }); }
      if (weapon === 'knife' && R.knifeBonus) { reward += R.knifeBonus; parts.push({ why: 'knife', hc: R.knifeBonus }); }
      const sb = R.streak[String(attacker.streak)];
      if (sb) { reward += sb; parts.push({ why: 'streak', n: attacker.streak, hc: sb }); }
      attacker.hc += reward; attacker.score += reward;
      this.send(attacker, { t: 'rew', eid, mid: this.matchId, hc: reward, parts });
    }
    this.broadcast({ t: 'kill', eid, k: credited ? attacker.id : 0, v: victim.id, hs, w: weapon, st: attacker.streak, x: r2(victim.x), y: r2(victim.y), z: r2(victim.z), vy: r2(victim.yaw), rd: this.cfg.match.respawnDelay });
    this.scoreDirty = true;
    this.log(`kill #${eid}: ${credited ? attacker.name : '?'} -> ${victim.name} (${weapon}${hs ? ', headshot' : ''}) +${reward} HC`);
    if (credited && attacker.kills >= this.settings.killLimit) this.endMatch('killLimit');
  }

  /* ----------------------------------------------------------------- match flow */
  pickSpawn(forPlayer) {
    const others = [...this.players.values()].filter((q) => q !== forPlayer && q.alive);
    const scored = this.spawns.map((s) => {
      let md = 1e9; for (const q of others) md = Math.min(md, Math.hypot(q.x - s.x, q.z - s.z));
      return { s, d: md === 1e9 ? 100 : md, r: Math.random() * 30 };
    }).sort((a, b) => (b.d + b.r) - (a.d + a.r));
    return scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
  }

  spawnPlayer(p, announce = true) {
    const s = this.pickSpawn(p), t = now();
    p.x = s.x; p.z = s.z; p.y = this.world.height(s.x, s.z);
    p.yaw = Math.atan2(-(0 - s.x), -(-30 - s.z)); p.pitch = 0;       // face the middle of the battlefield (forward = (-sin yaw, -cos yaw))
    p.hp = 100; p.alive = true; p.mag = this.cfg.weapons.rifle.mag + 1; p.reserve = this.cfg.weapons.rifle.reserve; p.reloadUntil = 0; p.reloadFill = false;
    p.protectUntil = t + this.cfg.match.spawnProtection * 1000; p.flags = 0; p.crouch = false; p.weapon = 'rifle'; p.budget = MAX_BUDGET; p.lastStT = t; p.spawnSeq++;
    p.hist = [{ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, cr: false }]; p.dirty = true; p.lastDamageT = t;
    if (announce) this.broadcast({ t: 'spawn', id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), prot: Math.round(this.cfg.match.spawnProtection * 1000), q: p.spawnSeq, mag: p.mag, res: p.reserve, hp: 100 });
  }

  startMatch() {
    if (!this.world.ready || this.players.size < 1) return;
    this.matchId = crypto.randomBytes(5).toString('hex');
    this.rewardedPids = new Set();
    const t = now();
    this.state = 'countdown';
    this.matchStart = t + this.cfg.match.countdown * 1000;
    this.matchEnd = this.matchStart + this.settings.duration * 60000;
    for (const p of this.players.values()) { p.kills = p.deaths = p.score = p.hc = p.streak = p.bestStreak = 0; p.rewarded = false; p.participantSince = t; p.alive = false; }
    for (const p of this.players.values()) this.spawnPlayer(p, false);
    // spawns are announced after everybody has a position
    this.broadcast(this.matchMsg());
    for (const p of this.players.values()) this.broadcast({ t: 'spawn', id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), prot: 0, q: p.spawnSeq, mag: p.mag, res: p.reserve, hp: 100, first: true });
    this.broadcast({ t: 'lobby', ...this.lobbyInfo() });
    this.sendFullScore();
    this.log(`match ${this.matchId} starting in ${this.cfg.match.countdown}s (${this.players.size} players, ${this.settings.duration} min, first to ${this.settings.killLimit})`);
  }

  endMatch(reason) {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    const t = now();
    this.state = 'ended'; this.endedAt = t;
    const list = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
    const top = list[0];
    const winners = top && top.kills > 0 ? list.filter((q) => q.kills === top.kills && q.deaths === top.deaths).map((q) => q.id) : [];
    const results = [];
    const bonus = this.cfg.economy.rewards.matchComplete;
    for (const p of list) {
      let comp = 0;
      const eligible = !p.rewarded && !this.rewardedPids.has(p.pid) && p.conn.alive && (reason === 'killLimit' || reason === 'time') && list.length >= (this.cfg.match.minPlayersForReward || 1) && (t - p.participantSince) >= 15000;
      if (eligible && bonus > 0) {
        p.rewarded = true; this.rewardedPids.add(p.pid); comp = bonus; p.hc += bonus;
        this.send(p, { t: 'rew', eid: ++this.eventSeq, mid: this.matchId, hc: bonus, parts: [{ why: 'match', hc: bonus }] });
      }
      results.push({ id: p.id, name: p.name, k: p.kills, d: p.deaths, sc: p.score, hc: p.hc, comp, best: p.bestStreak, camo: p.camo });
    }
    this.broadcast({ t: 'end', mid: this.matchId, reason, winners, results });
    this.broadcast({ t: 'match', ...this.matchMsg(), phase: 'ended' });
    this.log(`match ${this.matchId} ended (${reason}); winner(s): ${winners.map((id) => this.players.get(id)?.name).join(', ') || 'none'}`);
  }

  toLobby() {
    this.state = 'lobby';
    for (const p of this.players.values()) { p.alive = false; p.hp = 100; }
    this.broadcast(this.matchMsg());
    this.broadcast({ t: 'lobby', ...this.lobbyInfo() });
  }

  fullScore() {
    return { t: 'score', p: [...this.players.values()].map((p) => [p.id, p.kills, p.deaths, p.score, p.hc, p.streak, p.alive ? 1 : 0, Math.round(p.ping)]), tl: this.timeLeft(), lim: this.settings.killLimit };
  }
  sendFullScore(only) { const m = this.fullScore(); if (only) this.send(only, m); else this.broadcast(m); }
  timeLeft() { return this.state === 'playing' ? Math.max(0, Math.round((this.matchEnd - now()) / 100) / 10) : this.state === 'countdown' ? this.settings.duration * 60 : 0; }

  /* ------------------------------------------------------------------- tick */
  tick(dtMs) {
    if (this.state === 'idle' || this.state === 'lobby') return;
    const t = now(), dt = dtMs / 1000;
    if (this.state === 'countdown' && t >= this.matchStart) {
      this.state = 'playing';
      for (const p of this.players.values()) { p.protectUntil = t + 1500; p.lastStT = t; }
      this.broadcast(this.matchMsg());
      this.log('match started');
    }
    if (this.state === 'playing') {
      const R = this.cfg.match;
      for (const p of this.players.values()) {
        if (!p.alive) { if (t >= p.respawnAt) this.spawnPlayer(p, true); continue; }
        if (p.reloadFill && t >= p.reloadUntil) this.finishReload(p);
        if (p.hp < 100 && t - p.lastDamageT > R.healthRegenDelay * 1000) { p.hp = Math.min(100, p.hp + R.healthRegenPerSec * dt); p.dirty = true; }
      }
      if (t >= this.matchEnd) this.endMatch('time');
    }
    if (this.state === 'ended' && t - this.endedAt > this.cfg.match.resultsHold * 1000) this.toLobby();
    // snapshots
    const hz = this.cfg.net.snapshotHz;
    if (t - this.lastSnap >= 1000 / hz - 2 && (this.state === 'playing' || this.state === 'countdown')) {
      this.lastSnap = t;
      const rows = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (!p.dirty && t - p.lastSent < 400) continue;
        p.dirty = false; p.lastSent = t;
        let f = p.flags & 0x7f; if (t < p.protectUntil) f |= 128;
        rows.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw * 100) / 100, r2(p.pitch), f, Math.round(p.hp)]);
      }
      if (rows.length) this.broadcast({ t: 'snap', ts: r2(t), p: rows }, null);
    }
    if ((this.scoreDirty && t - this.lastScore > 120) || t - this.lastScore > 1000) {
      this.lastScore = t; this.scoreDirty = false;
      if (this.state === 'playing' || this.state === 'countdown' || this.state === 'ended') this.broadcast(this.fullScore());
    }
  }
}

export function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
