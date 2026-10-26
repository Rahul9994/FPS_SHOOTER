/* =====================================================================
 *  HOLLOW RIDGE  -  85-enemies.js
 *  Hostile soldiers (patrol / alert / combat AI), hit boxes, and the
 *  combat resolver (raycasts, damage, hit feedback)
 * ===================================================================== */

const ENEMY_STATS = {
  health: 100, sight: 95, fov: 2.2, hearShot: 125, walk: 1.5, run: 3.6, strafe: 2.0,
  fireRate: 4.4, damage: 6, headMult: 2.6, legMult: 0.7,
};

/* ------------------------------------------------------------ soldier model */
let _enemyMats = null;
function enemyMaterials() {
  if (_enemyMats) return _enemyMats;
  const camo = TEX.camoAlbedo.clone(); camo.repeat.set(1.5, 1.5); camo.needsUpdate = true;
  _enemyMats = {
    uniform: new THREE.MeshStandardMaterial({ map: camo, color: 0xffffff, roughness: 0.9 }),
    uniform2: new THREE.MeshStandardMaterial({ map: camo, color: 0xcfd2c0, roughness: 0.9 }),
    vest: new THREE.MeshStandardMaterial({ color: 0x4a4e44, roughness: 0.85 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x1b1d1c, roughness: 0.6, metalness: 0.2 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x6b7558, roughness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9 }),
    goggle: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.15, metalness: 0.6 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x1e1812, roughness: 0.8 }),
    gun: addGfxTag(new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.7 }), 'refl'),
    flash: new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  };
  return _enemyMats;
}
function buildSoldier(seed) {
  const M = enemyMaterials();
  const root = new THREE.Group();
  const cap = (r, l, mat) => { const g = new THREE.CapsuleGeometry(r, l, 3, 8); return new THREE.Mesh(g, mat); };
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  // legs
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.1, 0, 0);
    const thigh = cap(0.085, 0.3, M.uniform2); thigh.position.y = -0.2; leg.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.42; leg.add(knee);
    const shin = cap(0.068, 0.32, M.uniform2); shin.position.y = -0.2; knee.add(shin);
    const boot = new THREE.Mesh(rbox(0.11, 0.1, 0.27, 0.03, 2), M.boot); boot.position.set(0, -0.42, -0.04); knee.add(boot);
    hips.add(leg); legs.push({ leg, knee });
  }
  // upper body
  const upper = new THREE.Group(); upper.position.y = 0.04; hips.add(upper);
  const torso = new THREE.Mesh(rbox(0.40, 0.50, 0.23, 0.07, 3), M.uniform); torso.position.y = 0.32; upper.add(torso);
  const vest = new THREE.Mesh(rbox(0.43, 0.40, 0.27, 0.05, 2), M.vest); vest.position.y = 0.36; upper.add(vest);
  const plate = new THREE.Mesh(rbox(0.28, 0.30, 0.04, 0.02, 1), M.plate); plate.position.set(0, 0.38, -0.15); upper.add(plate);
  for (const sx of [-1, 1]) { const pouch = new THREE.Mesh(rbox(0.07, 0.11, 0.05, 0.015, 1), M.vest); pouch.position.set(sx * 0.1 + (sx < 0 ? -0.0 : 0.0), 0.2, -0.16); upper.add(pouch); }
  const head = new THREE.Group(); head.position.y = 0.76; upper.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), M.skin); head.add(face);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.128, 14, 10, 0, TAU, 0, Math.PI * 0.62), M.helmet); helmet.position.y = 0.02; head.add(helmet);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.02, 14), M.helmet); brim.position.y = 0.015; head.add(brim);
  const goggle = new THREE.Mesh(rbox(0.17, 0.05, 0.05, 0.02, 2), M.goggle); goggle.position.set(0, 0.015, -0.09); head.add(goggle);
  const neck = cap(0.05, 0.05, M.skin); neck.position.y = 0.64; upper.add(neck);
  // arms hold the rifle in front
  const gun = new THREE.Group(); gun.position.set(0.02, 0.38, -0.30); upper.add(gun);
  const gb = new THREE.Mesh(rbox(0.055, 0.075, 0.55, 0.012, 1), M.gun); gb.position.z = -0.12; gun.add(gb);
  const gb2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8), M.gun); gb2.rotation.x = Math.PI / 2; gb2.position.z = -0.52; gun.add(gb2);
  const stock = new THREE.Mesh(rbox(0.05, 0.1, 0.18, 0.012, 1), M.gun); stock.position.set(0, -0.02, 0.24); gun.add(stock);
  const mag = new THREE.Mesh(rbox(0.035, 0.14, 0.05, 0.01, 1), M.gun); mag.position.set(0, -0.1, -0.1); mag.rotation.x = 0.15; gun.add(mag);
  const muzzle = new THREE.Object3D(); muzzle.position.z = -0.66; gun.add(muzzle);
  const flash = new THREE.Group(); flash.visible = false;
  const fm1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), M.flash), fm2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), M.flash); fm2.rotation.y = Math.PI / 2;
  flash.add(fm1, fm2); muzzle.add(flash);
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.27, 0.55, 0); upper.add(sh);
    const ua = cap(0.058, 0.2, M.uniform); ua.position.y = -0.14; sh.add(ua);
    const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
    const fa = cap(0.05, 0.22, M.uniform); fa.position.y = -0.14; elbow.add(fa);
    const hand = new THREE.Mesh(rbox(0.07, 0.08, 0.09, 0.02, 1), M.boot); hand.position.y = -0.31; elbow.add(hand);
    arms.push({ sh, elbow, sx });
    // pose: shoulder raised forward, elbow bent towards the gun
    sh.rotation.set(-1.15, 0, sx * 0.25); elbow.rotation.set(-0.95, sx * 0.1, 0);
    if (sx > 0) { sh.rotation.set(-1.25, 0.05, 0.12); elbow.rotation.set(-0.75, -0.25, 0); }
    else { sh.rotation.set(-1.35, -0.35, -0.12); elbow.rotation.set(-0.55, 0.3, 0); }
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, hips, legs, upper, head, gun, muzzle, flash, arms };
}

/* ----------------------------------------------------------------- enemies */
const Enemies = {
  list: [], scene: null, respawnQueue: [], target: 7,
  spawnPoints: [[-33, -62], [-9, -57], [15, -55], [43, -58], [67, -60], [-57, -62], [-17, -92], [33, -95], [-86, -88], [104, -88], [-100, -62], [120, -78]],

  init(scene) { this.scene = scene; },
  clear() { for (const e of this.list) this.scene.remove(e.model.root); this.list.length = 0; this.respawnQueue.length = 0; },

  spawn(x, z) {
    const model = buildSoldier();
    const e = {
      model, pos: new THREE.Vector3(x, terrainHeight(x, z), z), vel: new THREE.Vector3(), yaw: Math.random() * TAU, aimYaw: 0, aimPitch: 0,
      health: ENEMY_STATS.health, state: 'patrol', alive: true, home: new THREE.Vector3(x, 0, z),
      wp: null, wpTimer: rand(1, 4), phase: Math.random() * 10, speed: 0, seeT: 0, lastSeen: new THREE.Vector3(), lastSeenAt: -99,
      reaction: 0, burst: 0, burstPause: rand(0.2, 0.8), fireCd: 0, strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: rand(1, 3),
      perceiveT: Math.random() * 0.2, canSee: false, flashT: 0, deadT: 0, fall: 0, hitFlinch: 0, stuckT: 0, id: Enemies.list.length,
      suppressed: 0, searchT: 0,
    };
    model.root.position.copy(e.pos); model.root.rotation.y = e.yaw;
    this.scene.add(model.root);
    this.list.push(e);
    return e;
  },
  spawnInitial() {
    this.clear();
    const pts = this.spawnPoints.slice(0, this.target);
    for (const [x, z] of pts) this.spawn(x, z);
  },

  /** notify AI that the player fired (loudness radius in metres) */
  onNoise(pos, radius) {
    if (G.cheats.noTarget) return;
    for (const e of this.list) {
      if (!e.alive || e.state === 'combat') continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < radius) { e.state = 'alert'; e.lastSeen.copy(pos).add(_v1.set(rand(-6, 6), 0, rand(-6, 6))); e.lastSeenAt = G.time; e.searchT = 10; e.reaction = Math.max(e.reaction, 0.3); }
    }
  },

  damage(e, dmg, part, point, dir) {
    if (!e.alive) return false;
    e.health -= dmg; e.hitFlinch = 1;
    if (e.state !== 'combat') { e.state = 'combat'; e.reaction = 0.35; e.lastSeen.copy(Player.pos); e.lastSeenAt = G.time; }
    if (e.health <= 0) {
      e.alive = false; e.deadT = 0; e.state = 'dead'; e.deathDir = dir ? Math.atan2(dir.x, dir.z) : 0;
      e.model.flash.visible = false;
      G.kills++;
      emit('kill', { head: part === 'head', cheat: part === 'cheat', knife: dmg >= 50 && part !== 'head' });
      Audio3D.killMarker();
      this.respawnQueue.push({ t: 16 });
      return true;
    }
    return false;
  },

  /* --------------------------------------------------------------- update */
  update(dt) {
    const P = Player;
    const frozen = G.cheats.freezeAI;
    for (const e of this.list) {
      if (!e.alive) { this.updateDead(e, dt); continue; }
      if (frozen) { this.animate(e, dt, 0); continue; }
      this.think(e, dt);
      this.animate(e, dt, e.speed);
    }
    // enemy-enemy separation
    for (let i = 0; i < this.list.length; i++) for (let j = i + 1; j < this.list.length; j++) {
      const a = this.list[i], b = this.list[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6) { const d = Math.sqrt(d2), push = (0.8 - d) * 0.5; a.pos.x -= dx / d * push; a.pos.z -= dz / d * push; b.pos.x += dx / d * push; b.pos.z += dz / d * push; }
    }
    // respawns
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i].t -= dt;
      if (this.respawnQueue[i].t <= 0) {
        // choose a spawn far from the player and out of sight
        let best = null;
        for (let k = 0; k < 8; k++) {
          const sp = pick(this.spawnPoints);
          const d = Math.hypot(sp[0] - P.pos.x, sp[1] - P.pos.z);
          if (d > 60 && !this.list.some((e) => e.alive && Math.hypot(e.pos.x - sp[0], e.pos.z - sp[1]) < 4)) { best = sp; break; }
        }
        if (best) { this.respawnQueue.splice(i, 1); this.spawn(best[0], best[1]); }
        else this.respawnQueue[i].t = 3;
      }
    }
    // clean up long-dead bodies
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive && e.deadT > 14) { this.scene.remove(e.model.root); this.list.splice(i, 1); }
    }
  },

  think(e, dt) {
    const P = Player, S = ENEMY_STATS, now = G.time;
    // ---- perception (throttled)
    e.perceiveT -= dt;
    if (e.perceiveT <= 0) {
      e.perceiveT = 0.18;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
      let visible = false;
      if (P.alive && !G.cheats.noTarget) {
        // how far can this soldier see the player right now?
        const light = clamp(0.35 + Atmos.dayAmt * 0.65, 0.3, 1);
        const weather = 1 / (1 + Atmos.cur.fog * 70) * (1 - Atmos.cur.rain * 0.18);
        let range = S.sight * light * weather * (P.crouched ? 0.62 : 1) * (P.sprinting ? 1.25 : 1);
        if (Player.flashlightOn && Atmos.dayAmt < 0.5) range = Math.max(range, 70);
        if (dist < range) {
          const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
          const cosA = (dx * fx + dz * fz) / (dist + 1e-4);
          const inCone = cosA > Math.cos(S.fov * 0.5) || dist < 7 || e.state === 'combat';
          if (inCone) {
            const eyeY = e.pos.y + 1.6;
            visible = lineOfSight(e.pos.x, eyeY, e.pos.z, P.pos.x, P.pos.y + 1.2, P.pos.z) || lineOfSight(e.pos.x, eyeY, e.pos.z, P.pos.x, P.pos.y + 1.6, P.pos.z);
          }
        }
        // footsteps / proximity hearing
        if (!visible && dist < (P.sprinting ? 16 : P.crouched ? 3 : 8) && P.speed2D > 1) { e.state = e.state === 'patrol' ? 'alert' : e.state; e.lastSeen.copy(P.pos); e.lastSeenAt = now; e.searchT = 8; }
      }
      if (visible) {
        if (!e.canSee) { e.reaction = rand(0.45, 0.9); e.seeT = 0; }
        e.canSee = true; e.lastSeen.copy(P.pos); e.lastSeenAt = now;
        if (e.state !== 'combat') { e.state = 'combat'; this.alertNearby(e); }
      } else if (e.canSee) { e.canSee = false; }
      if (e.state === 'combat' && !e.canSee && now - e.lastSeenAt > 3.5) { e.state = 'alert'; e.searchT = 9; }
    }

    const toward = (tx, tz, speed, face) => {
      const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const mx = dx / d, mz = dz / d;
        this.move(e, mx * speed, mz * speed, dt);
        if (face) e.targetYaw = Math.atan2(-mx, -mz);
      } else e.speed = damp(e.speed, 0, 8, dt);
      return d;
    };
    if (e.targetYaw === undefined) e.targetYaw = e.yaw;

    switch (e.state) {
      case 'patrol': {
        e.wpTimer -= dt;
        if (!e.wp) {
          if (e.wpTimer <= 0) {
            const a = Math.random() * TAU, r = rand(3, 14);
            e.wp = new THREE.Vector3(e.home.x + Math.cos(a) * r, 0, e.home.z + Math.sin(a) * r);
            e.wpTimer = 0;
          } else e.speed = damp(e.speed, 0, 8, dt);
        } else {
          const d = toward(e.wp.x, e.wp.z, S.walk, true);
          if (d < 0.8 || e.stuckT > 1.5) { e.wp = null; e.wpTimer = rand(2, 6); e.stuckT = 0; }
        }
        break;
      }
      case 'alert': {
        e.searchT -= dt;
        const d = toward(e.lastSeen.x, e.lastSeen.z, S.run * 0.8, true);
        if (d < 3 || e.searchT <= 0) { if (e.searchT <= 0) { e.state = 'patrol'; e.wp = null; } else { e.targetYaw += dt * 1.8; e.speed = damp(e.speed, 0, 8, dt); } }
        break;
      }
      case 'combat': {
        const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
        const face = Math.atan2(-dx, -dz);
        e.targetYaw = face;
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeDir *= -1; e.strafeT = rand(1.2, 3.2); }
        const nx = dx / (dist + 1e-4), nz = dz / (dist + 1e-4);
        if (!e.canSee) {
          toward(e.lastSeen.x, e.lastSeen.z, S.run, false);
        } else if (dist > 42) { this.move(e, nx * S.run, nz * S.run, dt); }
        else if (dist < 13) { this.move(e, -nx * S.strafe + -nz * e.strafeDir * S.strafe * 0.6, -nz * S.strafe + nx * e.strafeDir * S.strafe * 0.6, dt); }
        else { this.move(e, -nz * e.strafeDir * S.strafe * 0.7, nx * e.strafeDir * S.strafe * 0.7, dt); }
        // shooting
        e.reaction -= dt; e.fireCd -= dt;
        const diff = Math.abs(Math.atan2(Math.sin(face - e.yaw), Math.cos(face - e.yaw)));
        if (e.canSee && e.reaction <= 0 && diff < 0.25 && dist < 120) {
          if (e.burst > 0) {
            if (e.fireCd <= 0) { this.shoot(e, dist); e.burst--; e.fireCd = 1 / S.fireRate; if (e.burst <= 0) e.burstPause = rand(0.6, 1.6); }
          } else { e.burstPause -= dt; if (e.burstPause <= 0) e.burst = randInt(3, 6); }
        }
        break;
      }
    }
    // smooth facing
    const dy = Math.atan2(Math.sin(e.targetYaw - e.yaw), Math.cos(e.targetYaw - e.yaw));
    e.yaw += clamp(dy, -dt * (e.state === 'combat' ? 5 : 3), dt * (e.state === 'combat' ? 5 : 3));
    // upper-body pitch towards the player in combat
    const wantPitch = e.state === 'combat' && e.canSee ? Math.atan2((P.pos.y + 1.2) - (e.pos.y + 1.4), Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z)) : 0;
    e.aimPitch = damp(e.aimPitch, clamp(wantPitch, -0.5, 0.5), 8, dt);
    e.flashT = Math.max(0, e.flashT - dt);
    e.model.flash.visible = e.flashT > 0;
    e.hitFlinch = Math.max(0, e.hitFlinch - dt * 4);
  },

  alertNearby(src) {
    for (const o of this.list) {
      if (o === src || !o.alive || o.state === 'combat') continue;
      if (Math.hypot(o.pos.x - src.pos.x, o.pos.z - src.pos.z) < 45) { o.state = 'alert'; o.lastSeen.copy(Player.pos); o.lastSeenAt = G.time; o.searchT = 10; }
    }
  },

  move(e, vx, vz, dt) {
    const sp = Math.hypot(vx, vz);
    e.speed = damp(e.speed, sp, 6, dt);
    const nx = e.pos.x + vx * dt, nz = e.pos.z + vz * dt;
    const dist = Math.hypot(nx - e.pos.x, nz - e.pos.z);
    const hNew = terrainHeight(nx, nz);
    const stepOK = dist < 1e-6 || (hNew - e.pos.y) / dist < 1.1;
    const px = e.pos.x, pz = e.pos.z;
    if (stepOK) { e.pos.x = nx; e.pos.z = nz; }
    resolveCollisions(e.pos, 0.4, e.pos.y + 0.3, e.pos.y + 1.7);
    // keep inside the playable region
    e.pos.x = clamp(e.pos.x, -WORLD.play, WORLD.play); e.pos.z = clamp(e.pos.z, -WORLD.play, WORLD.play);
    // keep out of the player
    const pdx = e.pos.x - Player.pos.x, pdz = e.pos.z - Player.pos.z, pd = Math.hypot(pdx, pdz);
    if (pd < 1.0 && pd > 1e-4) { e.pos.x = Player.pos.x + pdx / pd; e.pos.z = Player.pos.z + pdz / pd; }
    e.pos.y = terrainHeight(e.pos.x, e.pos.z);
    // stuck detection: if we barely moved while trying to
    if (Math.hypot(e.pos.x - px, e.pos.z - pz) < sp * dt * 0.25) e.stuckT += dt; else e.stuckT = Math.max(0, e.stuckT - dt);
    if (e.stuckT > 0.6 && e.state !== 'patrol') { e.strafeDir *= -1; e.stuckT = 0.2; this.move(e, -vz * 1.4, vx * 1.4, dt * 2); }
  },

  /** enemy fires one round at the player */
  shoot(e, dist) {
    const P = Player, S = ENEMY_STATS;
    const gun = e.model;
    gun.root.updateMatrixWorld(true);
    const mp = gun.muzzle.getWorldPosition(new THREE.Vector3());
    const tgt = new THREE.Vector3(P.pos.x, P.pos.y + (P.crouched ? 0.65 : 1.15), P.pos.z);
    // spread grows with distance and when the player is moving
    const sigma = 0.018 + dist * 0.00028 + (P.speed2D > 2 ? 0.01 : 0) - (P.crouched ? 0.004 : 0);
    const aim = new THREE.Vector3().subVectors(tgt, mp);
    const L = aim.length(); aim.divideScalar(L);
    const jitter = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sigma * (0.6 + Math.random()));
    aim.add(jitter).normalize();
    e.flashT = 0.05; e.model.flash.rotation.z = Math.random() * TAU;
    Audio3D.enemyShot(mp);
    Combat.muzzleLightEnemy(mp);
    // does the bullet hit anything static first?
    const sh = raycastStatic(mp.x, mp.y, mp.z, aim.x, aim.y, aim.z, 220, true);
    // closest approach of the ray to the player's body
    const toP = _v2.subVectors(tgt, mp), t0 = toP.dot(aim);
    const closest = t0 > 0 ? _v3.copy(aim).multiplyScalar(t0).sub(toP).length() : 99;
    const blockedAt = sh ? sh.t : 1e9;
    let end = new THREE.Vector3().copy(mp).addScaledVector(aim, Math.min(blockedAt, 220));
    if (t0 > 0 && t0 < blockedAt + 0.5) {
      const hitR = P.crouched ? 0.34 : 0.4;
      if (closest < hitR && P.alive) {
        end.copy(mp).addScaledVector(aim, t0);
        P.takeDamage(S.damage * (0.8 + Math.random() * 0.5) * (closest < 0.12 && !P.crouched ? 1.3 : 1), e.pos);
        Tracers.spawn(mp, end, 330, 0.03, 2.0);
        return;
      } else if (closest < 2.2 && P.alive) {
        Audio3D.bulletWhiz(_v3.copy(mp).addScaledVector(aim, t0));
        emit('suppress', { amount: 1 - closest / 2.2 });
      }
    }
    Tracers.spawn(mp, end, 330, 0.03, 2.0);
    if (sh) { const n = _v1.set(sh.nx, sh.ny, sh.nz); Impacts.spawn(sh.surf, end, n.clone()); }
  },

  /* ----------------------------------------------------------- animation */
  animate(e, dt, speed) {
    const m = e.model;
    e.model.root.position.copy(e.pos);
    m.root.rotation.y = e.yaw;
    const w = clamp(speed / 3.5, 0, 1.2);
    e.phase += dt * (3.4 + speed * 2.6) * (speed > 0.1 ? 1 : 0);
    const sw = Math.sin(e.phase) * w;
    m.legs[0].leg.rotation.x = sw * 0.75; m.legs[1].leg.rotation.x = -sw * 0.75;
    m.legs[0].knee.rotation.x = Math.max(0, -Math.sin(e.phase)) * w * 1.0; m.legs[1].knee.rotation.x = Math.max(0, Math.sin(e.phase)) * w * 1.0;
    m.hips.position.y = 0.92 - Math.abs(Math.cos(e.phase)) * 0.03 * w + (e.state === 'combat' ? -0.04 : 0);
    m.upper.rotation.x = e.aimPitch * 0.9 + (e.state === 'combat' ? 0.06 : 0) - e.hitFlinch * 0.15;
    m.upper.rotation.y = Math.sin(e.phase * 0.5) * 0.08 * w;
    m.gun.rotation.x = e.aimPitch * 0.2 + (e.state === 'combat' ? 0 : -0.25);
    m.upper.position.y = 0.04;
    m.head.rotation.y = e.state === 'patrol' ? Math.sin(G.time * 0.7 + e.id) * 0.4 : 0;
  },

  updateDead(e, dt) {
    e.deadT += dt;
    const m = e.model;
    const t = clamp(e.deadT / 0.9, 0, 1);
    const k = easeInCubic(t);
    m.root.rotation.set(0, e.yaw, 0);
    m.root.rotation.x = k * 1.5;
    m.root.position.set(e.pos.x, e.pos.y - k * 0.12, e.pos.z);
    m.legs[0].leg.rotation.x = k * -0.4; m.legs[1].leg.rotation.x = k * 0.2; m.upper.rotation.x = k * 0.3;
    if (e.deadT > 11) m.root.position.y -= (e.deadT - 11) * 0.35;      // sink away
    if (e.deadT > 0.85 && !e.thud) { e.thud = true; Audio3D.land(0.5); }
  },
};

/* ======================================================================= */
const Combat = {
  _flashLight: null, _eFlashLight: null,
  init(scene) {
    this._flashLight = new THREE.PointLight(0xffa860, 0, 14, 2); scene.add(this._flashLight);
    this._eFlashLight = new THREE.PointLight(0xffa860, 0, 18, 2); scene.add(this._eFlashLight);
    this._flashT = 0; this._eFlashT = 0;
  },
  muzzleLight(pos) { this._flashLight.position.copy(pos); this._flashT = 0.05; this._flashLight.intensity = 90; Enemies.onNoise(Player.pos, ENEMY_STATS.hearShot); },
  muzzleLightEnemy(pos) { this._eFlashLight.position.copy(pos); this._eFlashT = 0.05; this._eFlashLight.intensity = 140; },
  update(dt) {
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT <= 0) this._flashLight.intensity = 0; }
    if (this._eFlashT > 0) { this._eFlashT -= dt; if (this._eFlashT <= 0) this._eFlashLight.intensity = 0; }
  },

  /** full world raycast: terrain + props + enemies + steel targets */
  raycast(ox, oy, oz, dx, dy, dz, maxD, opts = {}) {
    let best = null;
    const st = raycastStatic(ox, oy, oz, dx, dy, dz, maxD, true);
    if (st) best = { t: st.t, normal: new THREE.Vector3(st.nx, st.ny, st.nz), surf: st.surf, collider: st.collider };
    let bt = best ? best.t : maxD;
    // soldiers: AI in single-player, remote human players in multiplayer (never both)
    const targets = G.mode === 'mp' ? MP.entities() : Enemies.list;
    for (const e of targets) {
      if (!e.alive) continue;
      const ex = e.pos.x - ox, ez = e.pos.z - oz;
      if (ex * ex + ez * ez > (bt + 3) * (bt + 3)) continue;
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      // world -> local (crouching players are squashed vertically, like the server's hit volumes)
      const ys = e.crouched ? 0.62 : 1;
      const rx = ox - e.pos.x, ry = (oy - e.pos.y) / ys, rz = oz - e.pos.z;
      const lox = rx * c - rz * s, loz = rx * s + rz * c;
      const ldx = dx * c - dz * s, ldz = dx * s + dz * c, ldy = dy / ys;
      const parts = [
        ['head', 'sph', 0, 1.66, 0, 0.16],
        ['torso', 'box', 0, 1.22, 0, 0.25, 0.3, 0.17],
        ['torso', 'box', 0, 0.98, 0, 0.21, 0.08, 0.15],
        ['leg', 'box', -0.1, 0.46, 0, 0.1, 0.46, 0.12],
        ['leg', 'box', 0.1, 0.46, 0, 0.1, 0.46, 0.12],
        ['torso', 'box', -0.32, 1.28, -0.12, 0.09, 0.1, 0.22],
      ];
      for (const p of parts) {
        let t = -1; let nl = null;
        if (p[1] === 'sph') {
          const ax = lox - p[2], ay = ry - p[3], az = loz - p[4];
          const A = ldx * ldx + ldy * ldy + ldz * ldz, b = ax * ldx + ay * ldy + az * ldz, cc = ax * ax + ay * ay + az * az - p[5] * p[5], disc = b * b - A * cc;
          if (disc >= 0) { t = (-b - Math.sqrt(disc)) / A; if (t < 0) t = -1; else nl = [ax + ldx * t, ay + ldy * t, az + ldz * t]; }
        } else {
          let tmin = 0, tmax = bt; let ok = true; let nrm = [0, 0, 0];
          const o = [lox - p[2], ry - p[3], loz - p[4]], d = [ldx, ldy, ldz], h = [p[5], p[6], p[7]];
          for (let k = 0; k < 3 && ok; k++) {
            if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) ok = false; continue; }
            let t1 = (-h[k] - o[k]) / d[k], t2 = (h[k] - o[k]) / d[k], sg = -1;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sg = 1; }
            if (t1 > tmin) { tmin = t1; nrm = [0, 0, 0]; nrm[k] = sg; }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) ok = false;
          }
          if (ok && tmin > 0) { t = tmin; nl = nrm; }
        }
        if (t > 0 && t < bt) {
          bt = t;
          // local normal -> world
          const nx = nl[0] * c + nl[2] * s, nz = -nl[0] * s + nl[2] * c;
          const len = Math.hypot(nx, nl[1], nz) || 1;
          best = { t, normal: new THREE.Vector3(nx / len, nl[1] / len, nz / len), surf: 'flesh', part: p[0] };
          if (e.isRemote) best.remote = e; else best.enemy = e;
        }
      }
    }
    // steel targets
    for (const tg of Props.targets) {
      if (tg.state === 1 || tg.down > 0.3) continue;
      const ax = ox - tg.x, ay = oy - tg.y, az = oz - tg.z;
      const b = ax * dx + ay * dy + az * dz, cc = ax * ax + ay * ay + az * az - tg.r * tg.r, disc = b * b - cc;
      if (disc >= 0) {
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < bt) { bt = t; best = { t, normal: new THREE.Vector3(ax + dx * t, ay + dy * t, az + dz * t).normalize(), surf: 'metal', target: tg }; }
      }
    }
    if (!best) return null;
    best.point = new THREE.Vector3(ox + dx * best.t, oy + dy * best.t, oz + dz * best.t);
    return best;
  },

  applyBulletHit(hit, dir, stats) {
    if (hit.enemy) {
      const mult = hit.part === 'head' ? stats.headMult : hit.part === 'leg' ? stats.limbMult : 1;
      const dmg = stats.damage * mult;
      Impacts.spawn('flesh', hit.point, hit.normal);
      const killed = Enemies.damage(hit.enemy, dmg, hit.part, hit.point, dir);
      G.hits++;
      emit('hitmarker', { head: hit.part === 'head', kill: killed });
      if (!killed) Audio3D.hitMarker(hit.part === 'head');
    } else if (hit.remote) {
      Impacts.spawn('flesh', hit.point, hit.normal);        // damage + hit marker come from the server's confirmation
    } else if (hit.target) {
      Impacts.spawn('metal', hit.point, hit.normal);
      hitTarget(hit.target); G.hits++;
      emit('hitmarker', { head: false, kill: false });
      Audio3D.hitMarker(false);
    } else {
      Impacts.spawn(hit.surf, hit.point, hit.normal);
    }
  },

  applyMeleeHit(hit, dir, dmg, heavy) {
    if (hit.enemy) {
      Impacts.spawn('flesh', hit.point, hit.normal, true);
      Audio3D.knifeHit('flesh');
      const killed = Enemies.damage(hit.enemy, dmg, hit.part, hit.point, dir);
      emit('hitmarker', { head: false, kill: killed });
      if (!killed) Audio3D.hitMarker(false);
      G.hits++;
    } else if (hit.remote) {
      Impacts.spawn('flesh', hit.point, hit.normal, true); Audio3D.knifeHit('flesh');
    } else if (hit.target) {
      hitTarget(hit.target); Audio3D.knifeHit('metal'); Impacts.spawn('metal', hit.point, hit.normal, true); emit('hitmarker', { head: false, kill: false });
    } else {
      Audio3D.knifeHit(hit.surf);
      Impacts.spawn(hit.surf, hit.point, hit.normal, true);
      Decals.add(hit.point, hit.normal, 0.07);
    }
  },
};
