/* =====================================================================
 *  HOLLOW RIDGE  -  79-mp.js
 *  Client side of LAN multiplayer: session state, remote players (only real,
 *  connected humans — never AI), snapshot interpolation, shot / hit / kill
 *  handling, rewards, and the multiplayer HUD (player list, kill feed, timer).
 *  The server (server/room.mjs) is the authority; this module only sends what
 *  the local player *did* and renders what the server says happened.
 * ===================================================================== */

const MP_COLORS = ['#ff9a2e', '#4bc0ff', '#7dffb0', '#ff6b8b', '#c58bff', '#ffe14a', '#ff7a45', '#5ee0d0'];
const FLAG = { CROUCH: 1, SPRINT: 2, ADS: 4, GROUND: 8, RELOAD: 16, KNIFE: 32, PROTECT: 128 };
const playerColor = (id) => MP_COLORS[(id - 1 + MP_COLORS.length * 4) % MP_COLORS.length];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function makeNameTag(name, color) {
  const c = makeCanvas(320, 72), x = c.getContext('2d');
  x.font = '700 40px Rajdhani, Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(name, 160, 34); x.fillStyle = color; x.fillText(name, 160, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const sp = new THREE.Sprite(mat); sp.scale.set(1.35, 0.3, 1); sp.renderOrder = 60;
  return sp;
}

/* =========================================================== remote player */
class RemotePlayer {
  constructor(info, scene) {
    this.id = info.id; this.name = info.name; this.camo = info.camo || 'factory'; this.color = playerColor(info.id); this.scene = scene;
    const model = this.model = buildSoldier();
    const M = enemyMaterials();
    // identify each human: tinted helmet + shoulder patch
    const helm = M.helmet.clone(); helm.color.set(this.color).lerp(new THREE.Color(0x6b7558), 0.55);
    model.root.traverse((o) => { if (o.isMesh && o.material === M.helmet) o.material = helm; });
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.1), new THREE.MeshBasicMaterial({ color: this.color }));
    patch.position.set(0.066, -0.12, 0); model.arms[1].sh.add(patch);
    this.ent = { isRemote: true, remote: this, id: info.id, model, pos: new THREE.Vector3(), yaw: 0, aimPitch: 0, alive: false, crouched: false, state: 'combat', speed: 0, phase: Math.random() * 10, hitFlinch: 0, deadT: 0, thud: false, flashT: 0 };
    this.buf = []; this.alive = false; this.dead = false; this.lastFire = -99; this.cr = 0; this.protect = false; this.hp = 100; this.f = 0; this.deadHide = 0;
    this._swapGun();
    this.setName(this.name);
    model.root.visible = false; scene.add(model.root);
  }
  setName(n) {
    this.name = n;
    if (this.tag) { this.model.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.tag = makeNameTag(n, this.color); this.tag.position.y = 2.18; this.model.root.add(this.tag);
  }
  _swapGun() {
    const g = this.model.gun, keep = this.model.muzzle;
    for (const ch of Array.from(g.children)) if (ch !== keep) { g.remove(ch); ch.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.rifle = buildRifle(); Camo.applyToObject(this.rifle.root, this.camo, 512);
    this.rifle.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
    this.rifle.mags[1].visible = false; g.add(this.rifle.root);
    this.knife = buildKnife(); this.knife.root.scale.setScalar(1.6); this.knife.root.position.set(0.1, -0.05, -0.2); this.knife.root.rotation.set(0.3, 0.2, 0);
    this.knife.root.visible = false; g.add(this.knife.root);
    keep.position.set(0, 0, -0.61);
  }
  setCamo(id) { if (id === this.camo) return; this.camo = id || 'factory'; Camo.applyToObject(this.rifle.root, this.camo, 512); }

  push(ts, x, y, z, yaw, pitch, f, hp) {
    const b = this.buf;
    if (b.length && ts <= b[b.length - 1].t) return;
    b.push({ t: ts, x, y, z, yaw, pitch, f }); if (b.length > 16) b.shift();
    this.hp = hp; this.f = f; this.protect = !!(f & FLAG.PROTECT);
  }
  place(x, y, z, yaw) {
    const e = this.ent; e.pos.set(x, y, z); e.yaw = yaw; this.buf.length = 0;
    this.buf.push({ t: Net.serverNow() - 1000, x, y, z, yaw, pitch: 0, f: 0 });
    this._lastPos = null; e.speed = 0;
  }
  spawn(m) {
    this.alive = true; this.dead = false; this.ent.alive = true; this.ent.deadT = 0; this.ent.thud = false; this.deadHide = 0;
    this.place(m.x, m.y, m.z, m.yaw);
    const r = this.model.root; r.rotation.set(0, m.yaw, 0); r.visible = true; this.tag.visible = true; this.protect = (m.prot | 0) > 0;
    this.model.legs.forEach((l) => { l.leg.rotation.x = 0; l.knee.rotation.x = 0; });
  }
  die(m) {
    this.alive = false; this.dead = true; this.ent.alive = false; this.ent.deadT = 0; this.ent.thud = false;
    if (m) { this.ent.pos.set(m.x, m.y, m.z); this.ent.yaw = m.vy; }
    this.model.flash.visible = false; this.tag.visible = false;
  }
  fire(muzzleOut) {
    this.lastFire = performance.now() / 1000; this.ent.flashT = 0.05;
    this.model.flash.visible = true; this.model.flash.rotation.z = Math.random() * TAU;
    this.model.root.updateMatrixWorld(true);
    this.model.muzzle.getWorldPosition(muzzleOut);
  }
  update(dt, rt) {
    const e = this.ent, m = this.model;
    if (!this.alive) {
      if (this.dead) {
        Enemies.updateDead(e, dt);
        this.deadHide += dt; if (this.deadHide > 11) m.root.visible = false;
      }
      return;
    }
    const b = this.buf; let s;
    if (b.length === 0) return;
    if (rt <= b[0].t) s = b[0];
    else if (rt >= b[b.length - 1].t) s = b[b.length - 1];
    else {
      let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
      const a = b[i - 1], c = b[i], k = (rt - a.t) / Math.max(1, c.t - a.t);
      let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      s = { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, f: c.f };
    }
    // keep the model glued to the ground it is walking on (remote y comes from the other machine's terrain, which is identical, but smooth it anyway)
    const lp = this._lastPos;
    if (lp && dt > 0) { const sp = Math.hypot(s.x - lp.x, s.z - lp.z) / dt; e.speed = damp(e.speed, Math.min(sp, 9), 12, dt); }
    this._lastPos = { x: s.x, z: s.z };
    e.pos.set(s.x, s.y, s.z); e.yaw = s.yaw; e.aimPitch = clamp(s.pitch, -0.9, 0.9);
    const f = s.f | 0; e.crouched = !!(f & FLAG.CROUCH);
    this.animate(dt, f);
    // name tag fades with distance (and for spawn protection shows a shield mark)
    const d = G.camera.position.distanceTo(e.pos);
    this.tag.material.opacity = clamp(1.25 - d / 80, 0, 1); this.tag.visible = this.tag.material.opacity > 0.02;
  }
  animate(dt, f) {
    const e = this.ent, m = this.model, speed = e.speed;
    const w = clamp(speed / 3.5, 0, 1.25), sprint = !!(f & FLAG.SPRINT), knife = !!(f & FLAG.KNIFE), reload = !!(f & FLAG.RELOAD);
    this.cr = damp(this.cr, e.crouched ? 1 : 0, 10, dt);
    // footsteps you can hear (not for crouch-walking)
    if (speed > 1.2 && !e.crouched) {
      this.stepAcc = (this.stepAcc || 0) + speed * dt;
      if (this.stepAcc > (sprint ? 2.7 : 2.1)) {
        this.stepAcc = 0;
        if (G.camera.position.distanceTo(e.pos) < 42) Audio3D.stepAt(e.pos, sprint ? 1.2 : 0.8);
      }
    }
    e.phase += dt * (3.4 + speed * 2.6) * (speed > 0.15 ? 1 : 0);
    const sw = Math.sin(e.phase) * w, cr = this.cr;
    m.root.position.copy(e.pos); m.root.rotation.set(0, e.yaw, 0);
    m.legs[0].leg.rotation.x = sw * 0.75 + cr * 1.0; m.legs[1].leg.rotation.x = -sw * 0.75 + cr * 1.0;
    m.legs[0].knee.rotation.x = Math.max(0, -Math.sin(e.phase)) * w - cr * 1.4; m.legs[1].knee.rotation.x = Math.max(0, Math.sin(e.phase)) * w - cr * 1.4;
    m.hips.position.y = 0.92 - Math.abs(Math.cos(e.phase)) * 0.03 * w - cr * 0.24;
    const lean = sprint ? 0.16 : 0;
    m.upper.rotation.x = e.aimPitch * 0.9 * (sprint ? 0.3 : 1) + 0.06 + cr * 0.1 + lean;
    m.upper.rotation.y = Math.sin(e.phase * 0.5) * 0.08 * w;
    m.gun.rotation.x = sprint ? -0.55 : reload ? -0.42 : e.aimPitch * 0.2;
    m.gun.rotation.y = reload ? 0.35 : 0;
    m.head.rotation.y = 0;
    this.rifle.root.visible = !knife; this.knife.root.visible = knife;
    e.flashT = Math.max(0, e.flashT - dt); m.flash.visible = e.flashT > 0;
  }
  dispose() {
    this.scene.remove(this.model.root);
    this.model.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
  }
}

/* ===================================================================== MP */
const MP = {
  active: false, role: '', inWorld: false, phase: 'none',
  me: null, room: null, players: new Map(), remotes: new Map(), names: new Map(),
  match: null, tl: 0, tlAt: 0, myMatchHC: 0, leaving: false,
  fireSeq: 0, lastSend: 0, lastSent: null, spawnSeq: 0, respawnAt: 0, killedBy: '', protectUntil: 0, frozen: false, connectInfo: null,
  _scene: null, _tmpV: new THREE.Vector3(), _hudKey: '',

  init(scene) { this._scene = scene; },
  entities() { const out = []; for (const r of this.remotes.values()) if (r.alive) out.push(r.ent); return out; },
  get connected() { return this.active && Net.open; },
  playerList() {
    return Array.from(this.players.values()).sort((a, b) => b.k - a.k || a.d - b.d || a.id - b.id);
  },

  /* ------------------------------------------------------------ session */
  async connect(opts) {
    this.cleanup(false);
    this.connectInfo = opts; this.role = opts.role; this.leaving = false;
    emit('mp:status', { state: 'connecting', host: opts.host, port: opts.port });
    const first = await Net.connect({ ...opts, name: Profile.name, camo: Profile.equipped }, { message: (m) => this.onMessage(m), close: (i) => this.onClose(i) });
    this.active = true;
    try { localStorage.setItem('hollowRidge.lastHost', opts.host); } catch (e) { /* ignore */ }
    return first;
  },
  createRoom(cfg) {
    return Net.send({ t: 'create', name: cfg.room, pass: cfg.pass || '', map: cfg.map, settings: cfg.settings, world: Net.exportWorld() });
  },
  /** leave voluntarily (lobby, match, results) */
  leave() {
    this.leaving = true;
    const was = this.inWorld;
    Net.close(); this.cleanup(true);
    if (was) Game.exitToMenu();
    emit('mp:left', {});
  },
  cleanup(emitEvt) {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear(); this.players.clear(); this.names.clear();
    this.active = false; this.inWorld = false; this.phase = 'none'; this.room = null; this.match = null; this.me = null; this.frozen = false;
    this.myMatchHC = 0; this.lastSent = null; this.spawnSeq = 0;
    HUD.setMP(false);
    if (emitEvt) emit('mp:cleanup', {});
  },
  onClose(info) {
    if (this.leaving) return;
    const wasWorld = this.inWorld;
    this.cleanup(true);
    if (wasWorld) Game.exitToMenu();
    emit('mp:disconnected', { reason: 'Connection to the host was lost.' });
  },

  /* ----------------------------------------------------------- messages */
  onMessage(m) {
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 'lobby': return this.onLobby(m);
      case 'match': return this.onMatch(m);
      case 'spawn': return this.onSpawn(m);
      case 'snap': return this.onSnap(m);
      case 'score': return this.onScore(m);
      case 'shot': return this.onShot(m);
      case 'melee': { const r = this.remotes.get(m.s); if (r && r.alive && G.camera.position.distanceTo(r.ent.pos) < 18) Audio3D.knifeSwing(m.heavy); return; }
      case 'hit': return Player.mpHit(m);
      case 'hc': return this.onHitConfirm(m);
      case 'kill': return this.onKill(m);
      case 'rew': return this.onReward(m);
      case 'ammo': Weapons.ammo.mag = m.mag; Weapons.ammo.reserve = m.res; if (m.resup) { Audio3D.pickup(); emit('notify', { text: 'Resupplied: ammo restored', kind: 'good' }); } return;
      case 'corr': Player.pos.set(m.x, m.y, m.z); Player.vel.set(0, 0, 0); this.spawnSeq = m.q; return;
      case 'leave': return this.onLeave(m);
      case 'camo': { const r = this.remotes.get(m.id), p = this.players.get(m.id); if (p) p.camo = m.camo; if (r) r.setCamo(m.camo); return; }
      case 'end': return this.onEnd(m);
      case 'closed': this.leaving = true; { const was = this.inWorld; Net.close(true); this.cleanup(true); if (was) Game.exitToMenu(); emit('mp:disconnected', { reason: m.msg || 'The host closed the session.' }); } return;
      case 'kicked': this.leaving = true; { const was = this.inWorld; Net.close(true); this.cleanup(true); if (was) Game.exitToMenu(); emit('mp:disconnected', { reason: m.msg || 'You were removed by the host.' }); } return;
      case 'toast': return emit('notify', { text: m.msg, kind: '' });
      case 'error': return emit('mp:error', m);
      default:
    }
  },

  onWelcome(m) {
    this.me = { id: m.id, name: Profile.name };
    this.onLobby({ ...m.room });
    emit('mp:welcome', m);
    if (m.inProgress) this.pendingJoin = true;
  },

  onLobby(m) {
    this.room = m;
    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.id); this.names.set(p.id, p.name);
      let q = this.players.get(p.id);
      if (!q) { q = { id: p.id, name: p.name, camo: p.camo, k: 0, d: 0, sc: 0, hc: 0, streak: 0, alive: false, ping: p.ping, host: p.host }; this.players.set(p.id, q); }
      Object.assign(q, { name: p.name, camo: p.camo, ping: p.ping, host: p.host });
      const r = this.remotes.get(p.id);
      if (r) { if (r.name !== p.name) r.setName(p.name); r.setCamo(p.camo); }
    }
    for (const id of Array.from(this.players.keys())) if (!seen.has(id)) { this.players.delete(id); const r = this.remotes.get(id); if (r) { r.dispose(); this.remotes.delete(id); } }
    if (this.me) { const mine = m.players.find((p) => p.id === this.me.id); if (mine) this.me.name = mine.name; }
    this.phase = m.state === 'lobby' ? 'lobby' : this.phase;
    emit('mp:lobby', m);
    this.renderList();
  },

  onMatch(m) {
    this.match = m; this.tl = m.dur; this.tlAt = performance.now();
    const prev = this.phase; this.phase = m.phase;
    if (m.phase === 'countdown' || (m.phase === 'playing' && !this.inWorld)) {
      // every new match (re)builds the world state: a client that stayed on the results screen or went back to the lobby comes straight in
      if (m.phase === 'countdown' || !this.inWorld) { this.inWorld = true; this.pendingJoin = false; this.myMatchHC = 0; for (const r of this.remotes.values()) { r.alive = false; r.model.root.visible = false; } Game.beginMP(m); }
      this.frozen = m.phase === 'countdown'; Game.mpFreeze(this.frozen);
    } else if (m.phase === 'playing') {
      this.frozen = false; Game.mpFreeze(false);
      emit('notify', { text: 'Fight!', kind: 'good' });
    } else if (m.phase === 'lobby') {
      this.frozen = false;
      emit('mp:lobbyPhase', m);
    }
    if (m.phase !== prev) emit('mp:phase', m);
  },

  remote(id) {
    let r = this.remotes.get(id);
    if (!r) {
      const p = this.players.get(id); if (!p) return null;
      r = new RemotePlayer({ id, name: p.name, camo: p.camo }, this._scene); this.remotes.set(id, r);
    }
    return r;
  },

  onSpawn(m) {
    if (this.me && m.id === this.me.id) { this.spawnSeq = m.q; Game.mpSpawnLocal(m); return; }
    const r = this.remote(m.id); if (r) r.spawn(m);
    const p = this.players.get(m.id); if (p) p.alive = true;
  },

  onSnap(m) {
    for (const row of m.p) {
      if (this.me && row[0] === this.me.id) { if (Player.alive) Player.health = row[7]; continue; }
      const r = this.remotes.get(row[0]); if (!r || !r.alive) continue;
      r.push(m.ts, row[1], row[2], row[3], row[4], row[5], row[6], row[7]);
    }
  },

  onScore(m) {
    this.tl = m.tl; this.tlAt = performance.now(); this.limit = m.lim;
    for (const row of m.p) {
      const p = this.players.get(row[0]); if (!p) continue;
      p.k = row[1]; p.d = row[2]; p.sc = row[3]; p.hc = row[4]; p.streak = row[5]; p.alive = !!row[6]; p.ping = row[7];
      if (this.me && p.id === this.me.id) { G.kills = p.k; G.deaths = p.d; this.myMatchHC = p.hc; }
    }
    this.renderList(); if (this.scoreboardOpen) this.renderScoreboard();
    emit('mp:score', m);
  },

  /* another player fired: tracer, muzzle flash, sound, impact */
  onShot(m) {
    const r = this.remotes.get(m.s); if (!r || !r.alive) return;
    const mp = this._tmpV; r.fire(mp);
    const end = new THREE.Vector3(m.e[0], m.e[1], m.e[2]), from = mp.clone();
    Audio3D.enemyShot(from); Combat.muzzleLightEnemy(from);
    Tracers.spawn(from, end, 330, 0.03, 2.0);
    const d = from.distanceTo(end);
    // bullet passing close to the local player
    if (Player.alive) {
      const dir = end.clone().sub(from).normalize(), toP = new THREE.Vector3(Player.pos.x, Player.pos.y + 1.2, Player.pos.z).sub(from), t0 = toP.dot(dir);
      if (t0 > 0 && t0 < d) { const closest = toP.sub(dir.clone().multiplyScalar(t0)).length(); if (closest < 2.2 && closest > 0.4) { Audio3D.bulletWhiz(from.clone().addScaledVector(dir, t0)); emit('suppress', { amount: 1 - closest / 2.2 }); } }
    }
    if (m.k === 's') { Impacts.spawn(m.surf || 'grass', end, new THREE.Vector3(m.n[0], m.n[1], m.n[2])); }
    else if (m.k === 'p') Impacts.spawn('flesh', end, new THREE.Vector3(0, 1, 0));
  },

  onHitConfirm(m) {
    G.hits++; emit('hitmarker', { head: m.part === 'head', kill: !!m.kill });
    if (!m.kill) Audio3D.hitMarker(m.part === 'head');
    HUD.damageNumber(m.dmg, m.part === 'head');
  },

  onKill(m) {
    const killer = this.players.get(m.k), victim = this.players.get(m.v);
    const kn = killer ? killer.name : (this.names.get(m.k) || '—'), vn = victim ? victim.name : (this.names.get(m.v) || '—');
    HUD.feedKill({ killer: kn, victim: vn, kid: m.k, vid: m.v, hs: m.hs, w: m.w, me: this.me && this.me.id });
    const r = this.remotes.get(m.v);
    if (r) r.die(m);
    if (victim) { victim.alive = false; }
    if (this.me && m.v === this.me.id) {
      this.killedBy = kn; this.respawnAt = performance.now() + (m.rd || 3.5) * 1000;
      Player.health = 0; Player.die(true);
    }
    if (this.me && m.k === this.me.id && m.v !== this.me.id) {
      Audio3D.killMarker();
      HUD.confirmKill({ victim: vn, head: m.hs, streak: m.st });
    }
  },

  onReward(m) {
    const fresh = Profile.credit(m.hc, 'mp', (m.mid || 'm') + ':' + m.eid);
    if (!fresh) return;                             // already applied (duplicate / replayed message)
    HUD.rewardPops(m.parts || [{ why: 'kill', hc: m.hc }]);
  },

  onLeave(m) {
    this.players.delete(m.id);
    const r = this.remotes.get(m.id); if (r) { r.dispose(); this.remotes.delete(m.id); }
    emit('notify', { text: `${m.name} ${m.reason === 'disconnected' ? 'disconnected' : 'left'}`, kind: '' });
    this.renderList(); if (this.scoreboardOpen) this.renderScoreboard();
  },

  onEnd(m) {
    this.phase = 'ended'; Game.mpFreeze(true);
    Profile.bump('matches'); if (this.me && m.winners.includes(this.me.id)) Profile.bump('wins');
    for (const r of m.results) { const p = this.players.get(r.id); if (p) { p.k = r.k; p.d = r.d; p.sc = r.sc; p.hc = r.hc; } }
    emit('mp:end', m);
    this.renderList();
  },

  /* ------------------------------------------------------- local actions */
  onLocalFire(origin, dir) {
    if (!Net.open) return;
    Net.send({ t: 'fire', seq: ++this.fireSeq, ts: Net.serverNow(), o: [origin.x, origin.y, origin.z].map(r3), d: [dir.x, dir.y, dir.z].map(r3) });
  },
  onLocalMelee(origin, dir, heavy) {
    if (!Net.open) return;
    Net.send({ t: 'melee', seq: ++this.fireSeq, ts: Net.serverNow(), o: [origin.x, origin.y, origin.z].map(r3), d: [dir.x, dir.y, dir.z].map(r3), heavy: !!heavy });
  },
  onLocalReload() { if (Net.open) Net.send({ t: 'reload' }); },
  onLocalResupply() { if (Net.open) Net.send({ t: 'resup' }); },
  setCamo(id) { if (Net.open) Net.send({ t: 'camo', id }); },
  flags() {
    const P = Player;
    return (P.crouched ? FLAG.CROUCH : 0) | (P.sprinting ? FLAG.SPRINT : 0) | (Weapons.ads ? FLAG.ADS : 0) | (P.grounded ? FLAG.GROUND : 0) | (Weapons.state === 'reloading' ? FLAG.RELOAD : 0) | (Weapons.current === 'knife' ? FLAG.KNIFE : 0);
  },

  /* ---------------------------------------------------------- per frame */
  update(dt) {
    if (!this.inWorld) return;
    const now = performance.now(), rt = Net.serverNow() - CONFIG.net.interpDelayMs;
    for (const r of this.remotes.values()) r.update(dt, rt);
    // local state upload (20 Hz while moving, 4 Hz when idle)
    if (Player.alive && (this.phase === 'playing' || this.phase === 'countdown') && Net.open) {
      const interval = 1000 / CONFIG.net.clientStateHz, f = this.flags(), P = Player, L = this.lastSent;
      const moved = !L || Math.abs(P.pos.x - L.x) > 0.01 || Math.abs(P.pos.z - L.z) > 0.01 || Math.abs(P.pos.y - L.y) > 0.01 || Math.abs(P.yaw - L.yaw) > 0.004 || Math.abs(P.pitch - L.pitch) > 0.004 || f !== L.f;
      if (now - this.lastSend >= (moved ? interval : 250)) {
        this.lastSend = now;
        this.lastSent = { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, pitch: P.pitch, f };
        Net.send({ t: 'st', q: this.spawnSeq, x: r3(P.pos.x), y: r3(P.pos.y), z: r3(P.pos.z), yaw: r3(P.yaw), pitch: r3(P.pitch), vx: r3(P.vel.x), vz: r3(P.vel.z), f, ts: r3(Net.serverNow()) });
      }
    }
    this.updateHud(dt);
  },

  timeLeft() { return this.phase === 'playing' ? Math.max(0, this.tl - (performance.now() - this.tlAt) / 1000) : this.phase === 'countdown' ? Math.max(0, (this.match.start - Net.serverNow()) / 1000) : 0; },

  /* -------------------------------------------------------------- HUD bits */
  updateHud(dt) {
    const h = HUD.mp; if (!h) return;
    if (this.phase === 'countdown') {
      const c = Math.max(0, Math.ceil((this.match.start - Net.serverNow()) / 1000));
      h.banner.textContent = c > 0 ? String(c) : 'GO'; h.banner.className = 'show';
      h.bannerSub.textContent = 'MATCH STARTS IN'; h.bannerSub.style.opacity = c > 0 ? 1 : 0;
      h.time.textContent = fmtTime(this.match.dur);
    } else {
      if (h.banner.textContent) { h.banner.className = ''; h.banner.textContent = ''; h.bannerSub.style.opacity = 0; }
      h.time.textContent = this.phase === 'playing' ? fmtTime(this.timeLeft()) : '--:--';
    }
    h.limit.textContent = `FIRST TO ${(this.match && this.match.limit) || this.limit || ''}`;
    // death overlay text
    if (!Player.alive && G.state === 'dead') {
      const left = Math.max(0, (this.respawnAt - performance.now()) / 1000);
      $('deathSub').textContent = `Eliminated by ${this.killedBy || 'an enemy player'} · respawn in ${left.toFixed(1)}s`;
    }
    const prot = Player.alive && this.protectUntil > performance.now(); h.protect.style.display = prot ? 'block' : 'none';
    // net
    h.net.textContent = `PING ${Math.round(Net.rtt)} ms`;
  },

  renderList() {
    const h = HUD.mp; if (!h) return;
    const list = this.playerList(), me = this.me ? this.me.id : -1;
    const key = JSON.stringify(list.map((p) => [p.id, p.name, p.k, p.d, p.alive, Math.round(p.ping / 10), p.camo])) + me + (this.room ? this.room.max : '');
    if (key === this._hudKey) return; this._hudKey = key;
    const lead = list.length && list[0].k > 0 ? list[0].id : -1;
    h.list.innerHTML = `<div class="plh"><span>PLAYERS</span><span>${list.length}/${this.room ? this.room.max : '-'}</span></div><div class="plcols"><span></span><span></span><span>K</span><span>D</span></div>` + list.map((p) =>
      `<div class="plr${p.id === me ? ' me' : ''}${p.alive ? '' : ' dead'}"><i class="av" style="background:${playerColor(p.id)}">${esc(p.name.charAt(0).toUpperCase())}</i><span class="nm">${p.id === lead ? '<b class="crown">♛</b>' : ''}${esc(p.name)}${p.host ? ' <small>HOST</small>' : ''}${p.alive ? '' : ' <small class="x">✕</small>'}</span><span class="k">${p.k}</span><span class="d">${p.d}</span></div>`).join('');
  },

  scoreboardOpen: false,
  renderScoreboard() {
    const el = $('scoreboard'); if (!el) return;
    const list = this.playerList(), me = this.me ? this.me.id : -1;
    el.querySelector('tbody').innerHTML = list.map((p, i) =>
      `<tr class="${p.id === me ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${i + 1}</td><td class="nm"><i class="av" style="background:${playerColor(p.id)}">${esc(p.name.charAt(0).toUpperCase())}</i>${esc(p.name)}${p.host ? ' <small>HOST</small>' : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.d ? (p.k / p.d).toFixed(2) : p.k.toFixed(2)}</td><td>${HC.fmt(p.sc)}</td><td>${p.streak || '–'}</td><td class="ping">${Math.round(p.ping)} ms</td></tr>`).join('');
    el.querySelector('.sbsub').textContent = `${this.room ? esc(this.room.room) : ''} · ${this.room ? esc(this.room.mapName) : ''} · ${list.length} player${list.length === 1 ? '' : 's'} · ${fmtTime(this.timeLeft())}`;
  },
  showScoreboard(v) {
    if (v === this.scoreboardOpen) return; this.scoreboardOpen = v;
    const el = $('scoreboard'); el.classList.toggle('hidden', !v); if (v) this.renderScoreboard();
  },

  /* test / debug helper: proves multiplayer worlds contain nothing but connected humans */
  stats() {
    return {
      mode: G.mode, phase: this.phase, aiSoldiers: Enemies.list.length, aiQueued: Enemies.respawnQueue.length,
      remoteModels: this.remotes.size, remoteAlive: Array.from(this.remotes.values()).filter((r) => r.alive).length,
      connectedPlayers: this.players.size, ids: Array.from(this.players.keys()),
      humanModelsInScene: Array.from(this.remotes.values()).filter((r) => r.model.root.parent === this._scene).length,
    };
  },
};
const r3 = (v) => Math.round(v * 1000) / 1000;
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
