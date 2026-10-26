/* =====================================================================
 *  HOLLOW RIDGE  -  80-player.js
 *  Input, first-person controller, camera, health + damage, interaction
 * ===================================================================== */

const Input = {
  keys: {}, pressedKeys: new Set(), mouse: [false, false, false],
  lookDx: 0, lookDy: 0, wheel: 0, enabled: false, bindingMenuKey: false,
  locked: false,           // true while a modal screen is up in multiplayer (the world keeps running) or the match is frozen
  init() {
    const typing = (e) => !!(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (this.bindingMenuKey) { e.preventDefault(); e.stopPropagation(); this.bindingMenuKey = false; if (e.code !== 'Escape') { Settings.menuKey = e.code; Settings.save(); } emit('menuKeyBound', Settings.menuKey); return; }
      if (e.code === Settings.menuKey || e.code === 'F1' || e.code === 'F3' || e.code === 'Tab' && this.enabled) e.preventDefault();
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys[e.code] = true;
      emit('keydown', e);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { if (typing(e)) return; this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse[0] = this.mouse[1] = this.mouse[2] = false; });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.locked) return;
      if (e.button <= 2) this.mouse[e.button] = true;
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => { if (e.button <= 2) this.mouse[e.button] = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.locked) return;
      if (G.pointerLocked || G.lockUnsupported) { this.lookDx += e.movementX || 0; this.lookDy += e.movementY || 0; }
    });
    document.addEventListener('wheel', (e) => { if (this.enabled && !this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
  },
  key(code) { return !this.locked && !!this.keys[code]; },
  pressed(code) { return !this.locked && this.pressedKeys.has(code); },
  setLocked(v) { this.locked = v; if (v) { this.mouse[0] = this.mouse[1] = this.mouse[2] = false; this.lookDx = this.lookDy = 0; } },
  endFrame() { this.pressedKeys.clear(); this.lookDx = 0; this.lookDy = 0; this.wheel = 0; },
};

const Player = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  eye: 1.65, eyeStand: 1.65, eyeCrouch: 1.02,
  radius: 0.36,
  health: 100, maxHealth: 100,
  alive: true, grounded: true, sprinting: false, crouched: false, speed2D: 0,
  sprintLock: 0, lastDamageT: -99, bobT: 0, stepAcc: 0, airTime: 0, lastVy: 0,
  kickBudget: 0, kickTimer: 0, camKick: 0, camKickV: 0, hurtShake: 0,
  deadT: 0, lungeVel: 0,
  flashlightOn: false, prompt: '',
  _wish: new THREE.Vector3(),

  reset() {
    const sp = LAYOUT.spawn;
    this.pos.set(sp.x, terrainHeight(sp.x, sp.z), sp.z);
    this.vel.set(0, 0, 0);
    this.yaw = sp.yaw || 0; this.pitch = 0;
    this.health = this.maxHealth; this.alive = true; this.deadT = 0;
    this.kickBudget = 0; this.camKick = 0; this.camKickV = 0; this.sprintLock = 0;
    this.eye = this.eyeStand; this.crouched = false; this.sprinting = false;
    this.lastDamageT = -99;
  },

  stopSprint(t) { this.sprintLock = Math.max(this.sprintLock, t); this.sprinting = false; },
  lunge(v) { this.lungeVel = v; },

  addRecoil(pitch, yaw) {
    this.pitch += pitch; this.yaw += yaw;
    this.kickBudget += pitch * 0.52; this.kickTimer = 0.11;
    this.camKickV += pitch * 26;
  },

  /* ------------------------------------------------------------ update */
  update(dt, now) {
    if (!this.alive) { this.updateDead(dt); return; }
    const ctrl = Input;
    const adsT = Viewmodel.adsT;
    // look
    const fovScale = lerp(1, 0.75, adsT);
    const s = 0.0021 * Settings.sens * fovScale;
    this.yaw -= ctrl.lookDx * s;
    this.pitch -= ctrl.lookDy * s * (Settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);

    // recoil recovery (half of the muzzle climb comes back)
    this.kickTimer -= dt;
    if (this.kickTimer <= 0 && this.kickBudget > 0.0001) {
      const d = Math.min(this.kickBudget, Math.max(0.12, this.kickBudget * 5.5) * dt);
      this.pitch -= d; this.kickBudget -= d;
    }

    // movement intent
    const fwd = (ctrl.key('KeyW') ? 1 : 0) - (ctrl.key('KeyS') ? 1 : 0);
    const str = (ctrl.key('KeyD') ? 1 : 0) - (ctrl.key('KeyA') ? 1 : 0);
    this.sprintLock -= dt;
    const wantCrouch = ctrl.key('KeyC') || ctrl.key('ControlLeft');
    const busy = Weapons.state === 'reloading' || Weapons.state === 'melee';
    const wantSprint = ctrl.key('ShiftLeft') && fwd > 0 && !wantCrouch && this.sprintLock <= 0 && !busy && !Weapons.ads && !(ctrl.mouse[0] && Weapons.current === 'rifle');
    this.crouched = wantCrouch;
    this.sprinting = wantSprint && this.grounded;
    let maxSpeed = this.crouched ? 2.3 : this.sprinting ? 7.4 : 4.5;
    maxSpeed *= lerp(1, 0.72, adsT);
    if (Weapons.current === 'knife') maxSpeed *= 1.06;

    const wish = this._wish.set(0, 0, 0);
    if (fwd || str) {
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      wish.set(-sinY * fwd + cosY * str, 0, -cosY * fwd - sinY * str).normalize().multiplyScalar(maxSpeed);
    }
    const accel = this.grounded ? (wish.lengthSq() > 0 ? 38 : 13) : 5;
    const hv = _v1.set(this.vel.x, 0, this.vel.z);
    hv.x += (wish.x - hv.x) * Math.min(1, accel * dt / Math.max(maxSpeed, 1) * (this.grounded ? 1.2 : 1));
    hv.z += (wish.z - hv.z) * Math.min(1, accel * dt / Math.max(maxSpeed, 1) * (this.grounded ? 1.2 : 1));
    this.vel.x = hv.x; this.vel.z = hv.z;
    if (this.lungeVel > 0.01) {
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      this.vel.x += -sinY * this.lungeVel; this.vel.z += -cosY * this.lungeVel; this.lungeVel = damp(this.lungeVel, 0, 14, dt);
    }

    // jump + gravity
    if (this.grounded && ctrl.pressed('Space') && !this.crouched) { this.vel.y = 5.6; this.grounded = false; Audio3D.cloth(); }
    this.vel.y -= 19 * dt;

    // integrate with slope + collision handling
    const p = this.pos;
    const step = (axisX) => {
      const nx = p.x + (axisX ? this.vel.x * dt : 0), nz = p.z + (axisX ? 0 : this.vel.z * dt);
      const dist = Math.hypot(nx - p.x, nz - p.z);
      if (dist < 1e-6) return;
      const hNew = terrainHeight(nx, nz);
      if (this.grounded && (hNew - p.y) / dist > 1.5 && hNew - p.y > 0.25) return;      // too steep
      if (!this.grounded && hNew > p.y + 0.5) return;
      p.x = nx; p.z = nz;
    };
    step(true); step(false);
    p.y += this.vel.y * dt;
    const eyeH = this.crouched ? this.eyeCrouch : this.eyeStand;
    resolveCollisions(p, this.radius, p.y + 0.35, p.y + eyeH);
    // world boundary: soft wall
    const B = WORLD.play;
    p.x = clamp(p.x, -B, B); p.z = clamp(p.z, -B, B);
    // ground
    const gh = terrainHeight(p.x, p.z);
    const wasGrounded = this.grounded;
    if (p.y <= gh + 0.001 || (wasGrounded && this.vel.y <= 0 && p.y - gh < 0.45)) {
      if (!wasGrounded && this.lastVy < -4.5) this.onLand(-this.lastVy);
      p.y = gh; this.vel.y = Math.max(0, this.vel.y); this.grounded = true;
    } else this.grounded = false;
    this.lastVy = this.vel.y;
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);

    // eye height + camera
    this.eye = damp(this.eye, eyeH, 11, dt);
    this.camKickV += (-this.camKick * 260 - this.camKickV * 18) * dt; this.camKick += this.camKickV * dt;
    this.hurtShake = damp(this.hurtShake, 0, 6, dt);

    // footsteps
    if (this.grounded && this.speed2D > 0.6) {
      const stride = this.sprinting ? 2.7 : this.crouched ? 1.5 : 2.1;
      this.stepAcc += this.speed2D * dt;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const sp = terrainSplat(p.x, p.z);
        Audio3D.step(sp.dirt > 0.5 ? 'dirt' : 'grass', this.sprinting ? 1.25 : this.crouched ? 0.45 : 0.85);
        emit('footstep', { pos: p, loud: this.sprinting ? 1 : this.crouched ? 0.2 : 0.55 });
      }
    } else this.stepAcc = Math.min(this.stepAcc, 1.0);

    // health regeneration
    if (G.mode === 'sp') {      // multiplayer health (damage, regeneration) is owned by the server
      if (!G.cheats.god && this.health < this.maxHealth && now - this.lastDamageT > 6) this.health = Math.min(this.maxHealth, this.health + 14 * dt);
      if (G.cheats.unlimitedHealth || G.cheats.god) this.health = this.maxHealth;
    }

    // interaction prompt
    this.prompt = '';
    const sup = Props.supply;
    if (sup && Math.hypot(p.x - sup.x, p.z - sup.z) < 3.2) {
      this.prompt = 'Press E to resupply';
      if (ctrl.pressed('KeyE')) {
        if (G.mode === 'mp') MP.onLocalResupply();
        else {
          Weapons.refillAmmo(); this.health = this.maxHealth; Audio3D.pickup();
          emit('notify', { text: 'Resupplied: ammo + health restored', kind: 'good' });
        }
      }
    }
    this.updateCamera(dt);
  },

  onLand(v) {
    const power = clamp((v - 4) / 9, 0.1, 1);
    Audio3D.land(power); Viewmodel.landed(power);
    this.camKickV -= power * 2.8;
    if (v > 12.5 && !G.cheats.god && G.mode === 'sp') this.takeDamage((v - 12.5) * 9, null, true);
  },

  updateCamera(dt) {
    const cam = G.camera, adsT = Viewmodel.adsT;
    const bobAmt = this.grounded ? clamp(this.speed2D / 6.2, 0, 1) : 0;
    this.bobT += dt * (this.speed2D > 0.4 ? 5.2 + this.speed2D * 0.95 : 0);
    const bob = Settings.bobbing * bobAmt * (1 - adsT * 0.6) * (this.sprinting ? 1.5 : 1);
    cam.position.set(this.pos.x, this.pos.y + this.eye + Math.sin(this.bobT) * 0.022 * bob, this.pos.z);
    const strafe = (Input.key('KeyD') ? 1 : 0) - (Input.key('KeyA') ? 1 : 0);
    const roll = -strafe * 0.012 * (1 - adsT) + Math.sin(this.bobT * 0.5) * 0.0045 * bob;
    cam.rotation.set(this.pitch + this.camKick + Math.cos(this.bobT) * 0.003 * bob, this.yaw + Math.sin(this.bobT * 0.5) * 0.004 * bob, roll + (Math.random() - 0.5) * this.hurtShake * 0.02, 'YXZ');
    cam.position.x += (Math.random() - 0.5) * this.hurtShake * 0.03;
    // Settings.fov is horizontal; convert to the vertical FOV three.js expects
    const hFov = lerp(Settings.fov, Settings.fov * 0.78, adsT) + (this.sprinting ? 5 : 0);
    const vFov = 2 * Math.atan(Math.tan(hFov * DEG / 2) / cam.aspect) / DEG;
    cam.fov = damp(cam.fov, vFov, 10, dt); cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  },

  /* ---------------------------------------------------------- damage */
  takeDamage(amount, fromPos, silentRaw) {
    if (!this.alive) return;
    if (G.cheats.god) return;
    this.health -= amount;
    this.lastDamageT = performance.now() / 1000;
    this.hurtShake = Math.min(1, this.hurtShake + amount / 30);
    this.camKickV += (Math.random() - 0.5) * 3;
    Audio3D.playerHurt();
    let angle = null;
    if (fromPos) {
      const dx = fromPos.x - this.pos.x, dz = fromPos.z - this.pos.z;
      // angle relative to where the player is looking (0 = ahead, +ve = to the right)
      angle = Math.atan2(dx, -dz) + this.yaw;
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      angle = -angle;
    }
    emit('playerHit', { amount, angle });
    if (G.cheats.unlimitedHealth) { this.health = this.maxHealth; return; }
    if (this.health <= 0) this.die();
  },
  /** multiplayer: the server says this player was hit. `m` = { dmg, hp, by, fx, fz } (health itself is authoritative there) */
  mpHit(m) {
    if (!this.alive) return;
    this.health = m.hp; this.lastDamageT = performance.now() / 1000;
    this.hurtShake = Math.min(1, this.hurtShake + m.dmg / 30);
    this.camKickV += (Math.random() - 0.5) * 3;
    Audio3D.playerHurt();
    const dx = m.fx - this.pos.x, dz = m.fz - this.pos.z;
    let angle = Math.atan2(dx, -dz) + this.yaw; angle = -Math.atan2(Math.sin(angle), Math.cos(angle));
    emit('playerHit', { amount: m.dmg, angle });
  },
  die(fromServer) {
    this.health = 0; this.alive = false; this.deadT = 0; G.state = 'dead';
    if (!fromServer) { G.deaths++; Rewards.spDeath(); }
    Weapons.state = 'idle'; Viewmodel.cancelClip();
    emit('playerDied');
  },
  updateDead(dt) {
    this.deadT += dt;
    this.eye = damp(this.eye, 0.35, 3, dt);
    this.pitch = damp(this.pitch, -0.35, 2, dt);
    this.vel.x = damp(this.vel.x, 0, 4, dt); this.vel.z = damp(this.vel.z, 0, 4, dt);
    const gh = terrainHeight(this.pos.x, this.pos.z); this.pos.y = gh;
    this.updateCamera(dt);
    G.camera.rotation.z = damp(G.camera.rotation.z, 0.5, 2, dt);
    if (this.deadT > 3.6 && G.mode === 'sp') emit('respawnRequest');
  },
};
