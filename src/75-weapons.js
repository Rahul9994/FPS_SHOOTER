/* =====================================================================
 *  HOLLOW RIDGE  -  75-weapons.js
 *  Weapon manager: assault rifle (ammo, recoil, spread, reload) + combat knife
 * ===================================================================== */

const RIFLE_STATS = {
  name: 'AR-M4 CARBINE', mag: CONFIG.weapons.rifle.mag, rpm: CONFIG.weapons.rifle.rpm, damage: CONFIG.weapons.rifle.damage, headMult: CONFIG.weapons.rifle.headMult, limbMult: CONFIG.weapons.rifle.limbMult, range: CONFIG.weapons.rifle.range,
  reserveStart: CONFIG.weapons.rifle.reserve, spreadHip: 0.0125, spreadAds: 0.0006, spreadMove: 0.012, bloomPerShot: 0.0016,
  recoilPitch: 0.0043, recoilYaw: 0.0011, recoilAdsMult: 0.72,
};
const KNIFE_STATS = { name: 'COMBAT KNIFE', ...CONFIG.weapons.knife };

const _wv = new THREE.Vector3(), _wv2 = new THREE.Vector3(), _wv3 = new THREE.Vector3(), _wq = new THREE.Quaternion();

const Weapons = {
  current: 'rifle',
  last: 'knife',
  state: 'idle',            // idle | drawing | holstering | reloading | melee
  pendingSwitch: null,
  ammo: { mag: 31, reserve: RIFLE_STATS.reserveStart },
  semi: false,
  nextShotAt: 0,
  bloom: 0,
  spread: 0.01,
  triggerWasDown: false,
  meleeChain: 0,
  _meleeIsHeavy: false,
  _reloadEmpty: false,
  autoReloadTimer: 0,
  recoilKick: 0,

  reset() {
    this.ammo.mag = 31; this.ammo.reserve = RIFLE_STATS.reserveStart;
    this.state = 'idle'; this.pendingSwitch = null; this.bloom = 0; this.nextShotAt = 0;
    Viewmodel.cancelClip(); Viewmodel.boltOpen = false; Viewmodel.curMag = 0;
    Viewmodel.rifle.mags.forEach((m, i) => { m.visible = i === 0; m.position.copy(RIFLE.magRest); m.rotation.set(0, 0, 0); });
    this.current = 'rifle'; Viewmodel.setWeapon('rifle');
    this.draw(true);
  },

  /* ---------------------------------------------------------- switching */
  switchTo(w) {
    if (w === this.current && !this.pendingSwitch) return;
    if (this.state === 'holstering' || this.state === 'drawing' && this.pendingSwitch) return;
    if (this.state === 'melee') return;
    if (this.state === 'reloading') { Viewmodel.cancelClip(); this.state = 'idle'; }
    this.pendingSwitch = w;
    this.state = 'holstering';
    Viewmodel.playClip(this.current === 'rifle' ? 'holsterRifle' : 'holsterKnife', 1);
    Audio3D.cloth();
  },
  draw(first) {
    this.state = 'drawing';
    Viewmodel.setWeapon(this.current);
    Viewmodel.playClip(this.current === 'rifle' ? 'drawRifle' : 'drawKnife', 1, (e) => {
      if (e === 'drawSnd') Audio3D.rifleDraw();
      if (e === 'knifeDrawSnd') Audio3D.knifeDraw();
    });
    emit('weaponChanged', { weapon: this.current });
  },

  /* ------------------------------------------------------------ inspection */
  inspect() {
    if (this.current !== 'rifle' || this.state !== 'idle' || Player.sprinting || !Player.alive) return false;
    this.state = 'inspecting';
    Viewmodel.playClip('inspectRifle', 1, (e) => { if (e === 'cloth') Audio3D.cloth(); if (e === 'tap') Audio3D.clack({ f: 900, gain: 0.08, dur: 0.04 }); });
    return true;
  },
  cancelInspect() { if (this.state !== 'inspecting') return; Viewmodel.cancelClip(); this.state = 'idle'; },

  /* ------------------------------------------------------------ reloading */
  canReload() {
    return this.current === 'rifle' && this.state === 'idle' && this.ammo.mag < RIFLE_STATS.mag + (this.ammo.mag > 0 ? 1 : 0) &&
      (this.ammo.reserve > 0 || G.cheats.infiniteAmmo);
  },
  reload() {
    if (!this.canReload()) return false;
    this._reloadEmpty = this.ammo.mag <= 0;
    this.state = 'reloading';
    Viewmodel.playClip(this._reloadEmpty ? 'reloadEmpty' : 'reloadTactical', 1, (e) => this._reloadEvent(e));
    emit('reloadStart', { empty: this._reloadEmpty });
    if (G.mode === 'mp') MP.onLocalReload();
    return true;
  },
  _reloadEvent(e) {
    switch (e) {
      case 'magRelease': Audio3D.magRelease(); break;
      case 'magOutSnd': Audio3D.magOut(); break;
      case 'magInSnd': Audio3D.magIn(); break;
      case 'magTap': Audio3D.magTap(); break;
      case 'boltBackSnd': Audio3D.boltBack(); break;
      case 'boltFwdSnd': Audio3D.boltForward(); break;
      case 'dropOld': Audio3D.cloth(); break;
      case 'seatNew': {
        const cap = RIFLE_STATS.mag + (this.ammo.mag > 0 ? 1 : 0);
        const need = cap - this.ammo.mag;
        const take = G.cheats.infiniteAmmo ? need : Math.min(need, this.ammo.reserve);
        this.ammo.mag += take;
        if (!G.cheats.infiniteAmmo) this.ammo.reserve -= take;
        break;
      }
    }
  },
  refillAmmo() { this.ammo.mag = RIFLE_STATS.mag + 1; this.ammo.reserve = RIFLE_STATS.reserveStart; Viewmodel.boltOpen = false; },

  /* ------------------------------------------------------------- firing */
  muzzleWorld(out) { return Viewmodel.toWorld(Viewmodel.rifle.muzzle.getWorldPosition(out)); },

  tryFire(now, dt) {
    const dtFire = 60 / RIFLE_STATS.rpm;
    if (now < this.nextShotAt) return;
    const P = Player;
    if (P.sprinting) { P.stopSprint(0.25); return; }
    if (this.ammo.mag <= 0 && !G.cheats.noReload) {
      if (!this.triggerWasDown || this.autoReloadTimer <= 0) {
        Audio3D.dryFire(); this.nextShotAt = now + 0.22;
        emit('dryFire');
        this.autoReloadTimer = 0.3;
      }
      return;
    }
    this.nextShotAt = now + dtFire;
    this.fireRifle();
  },

  fireRifle() {
    const S = RIFLE_STATS, cam = G.camera;
    if (!G.cheats.noReload) this.ammo.mag--;
    G.shots++;
    const ads = Viewmodel.adsT;
    // ---- direction with spread
    const spr = this.spread;
    const ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * spr;
    cam.getWorldDirection(_wv);
    const right = _wv2.set(1, 0, 0).applyQuaternion(cam.quaternion), up = _wv3.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const dir = new THREE.Vector3().copy(_wv).addScaledVector(right, Math.cos(ang) * rad).addScaledVector(up, Math.sin(ang) * rad).normalize();
    const origin = cam.position;
    const hit = Combat.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, S.range, { ignorePlayer: true });
    const endPoint = hit ? hit.point : new THREE.Vector3().copy(origin).addScaledVector(dir, S.range);
    // ---- visuals + sound
    const muzzle = Viewmodel.toWorld(Viewmodel.rifle.muzzle.getWorldPosition(new THREE.Vector3()));
    Audio3D.rifleShot({ vol: 1 });
    Viewmodel.kick(1); Viewmodel.muzzleFlash();
    Combat.muzzleLight(muzzle);
    if (G.shots % 2 === 1 || true) Tracers.spawn(muzzle, endPoint, 420, 0.03);
    // muzzle smoke
    Particles.smoke.spawn(muzzle.x, muzzle.y, muzzle.z, dir.x * 1.5 + rand(-0.3, 0.3), dir.y * 1.5 + rand(0.2, 0.6), dir.z * 1.5 + rand(-0.3, 0.3), 0.8, 0.05, 0.28, 0.14, 0.9, 0.9, 0.9, -0.1, 0.95, rand(-1, 1));
    // shell casing
    const port = Viewmodel.toWorld(Viewmodel.rifle.ejection.getWorldPosition(new THREE.Vector3()));
    const side = _wv2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    Casings.eject(port, new THREE.Vector3().copy(side).multiplyScalar(rand(2.0, 3.0)).addScaledVector(up, rand(1.4, 2.2)).addScaledVector(dir, rand(-0.5, 0.4)).addScaledVector(Player.vel, 0.5));
    // ---- hit handling (multiplayer: the server decides damage; we only report the shot)
    if (G.mode === 'mp') MP.onLocalFire(origin, dir);
    if (hit) Combat.applyBulletHit(hit, dir, RIFLE_STATS);
    // ---- recoil
    const am = ads > 0.5 ? S.recoilAdsMult : 1;
    Player.addRecoil(S.recoilPitch * am * (0.85 + Math.random() * 0.35), (Math.random() - 0.5) * 2 * S.recoilYaw * am + 0.0002);
    this.bloom = Math.min(0.03, this.bloom + S.bloomPerShot);
    if (this.ammo.mag <= 0 && !G.cheats.noReload) { Viewmodel.boltOpen = true; emit('magEmpty'); }
    emit('fired');
  },

  /* -------------------------------------------------------------- melee */
  meleeAttack(heavy) {
    if (this.current !== 'knife' || this.state !== 'idle') return;
    this.state = 'melee'; this._meleeIsHeavy = heavy;
    let clip;
    if (heavy) clip = 'knifeStab';
    else { clip = this.meleeChain % 2 === 0 ? 'knifeSlash' : 'knifeSlash2'; this.meleeChain++; }
    Viewmodel.playClip(clip, heavy ? 0.95 : 1.15, (e) => {
      if (e === 'swingSnd') Audio3D.knifeSwing(heavy);
      if (e === 'hit') this._meleeHit(heavy);
    });
    if (heavy) Player.lunge(3.4);
  },
  _meleeHit(heavy) {
    const cam = G.camera, S = KNIFE_STATS;
    const range = heavy ? S.stabRange : S.slashRange;
    const o = cam.position;
    cam.getWorldDirection(_wv);
    const right = _wv2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    let best = null;
    for (const off of [0, -0.22, 0.22, -0.4, 0.4]) {
      const d = new THREE.Vector3().copy(_wv).addScaledVector(right, off).normalize();
      const h = Combat.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, { ignorePlayer: true, melee: true });
      if (h && (!best || h.t < best.t)) { best = h; best.dir = d; }
      if (best && off === 0) break;
    }
    if (G.mode === 'mp') MP.onLocalMelee(o, _wv, heavy);
    if (!best) return;
    const dmg = heavy ? S.stabDamage : S.slashDamage;
    Combat.applyMeleeHit(best, best.dir, dmg, heavy);
    Player.addRecoil(heavy ? 0.012 : 0.006, 0);
  },

  /* ------------------------------------------------------------ per frame */
  update(dt, now, input) {
    const wasDown = this.triggerWasDown;
    const P = Player;
    // finishing clips drives the state machine
    if (!Viewmodel.player.playing) {
      if (this.state === 'holstering') {
        this.last = this.current; this.current = this.pendingSwitch; this.pendingSwitch = null;
        this.draw();
      } else if (this.state === 'drawing' || this.state === 'reloading' || this.state === 'melee' || this.state === 'inspecting') {
        this.state = 'idle';
      }
    }
    this.autoReloadTimer -= dt;
    // any firing / aiming / sprinting input ends a weapon inspection
    if (this.state === 'inspecting' && (input.mouse[0] || input.mouse[2] || P.sprinting)) this.cancelInspect();

    // aim down sights
    const wantAds = input.mouse[2] && this.current === 'rifle' && (this.state === 'idle') && !P.sprinting;
    Viewmodel.adsWanted = !!wantAds;
    this.ads = wantAds;

    /* spread */
    this.bloom = damp(this.bloom, 0, 7, dt);
    const adsK = Viewmodel.adsT;
    let base = lerp(RIFLE_STATS.spreadHip, RIFLE_STATS.spreadAds, adsK);
    const mv = clamp(P.speed2D / 6, 0, 1);
    base += mv * RIFLE_STATS.spreadMove * (1 - adsK * 0.9) + (P.grounded ? 0 : 0.015);
    base *= P.crouched ? 0.65 : 1;
    this.spread = base + this.bloom * (1 - adsK * 0.5);

    /* trigger */
    const down = input.mouse[0];
    Viewmodel.triggerPull = damp(Viewmodel.triggerPull, down && this.current === 'rifle' ? 1 : 0, 30, dt);
    if (this.current === 'rifle' && this.state === 'idle') {
      if (down && (!this.semi || !wasDown)) this.tryFire(now, dt);
      // auto reload when empty and the player released the trigger
      if (this.ammo.mag <= 0 && !down && this.autoReloadTimer <= 0 && !G.cheats.noReload) this.reload();
    } else if (this.current === 'knife' && this.state === 'idle') {
      if (input.mouse[0] && !wasDown) this.meleeAttack(false);
      else if (input.mouse[2] && !this.rmbWas) this.meleeAttack(true);
    }
    this.triggerWasDown = down;
    this.rmbWas = !!input.mouse[2];
  },

  hud() {
    return {
      weapon: this.current === 'rifle' ? RIFLE_STATS.name : KNIFE_STATS.name,
      mag: this.ammo.mag, reserve: this.ammo.reserve,
      infinite: G.cheats.infiniteAmmo, noReload: G.cheats.noReload,
      reloading: this.state === 'reloading', semi: this.semi, rifle: this.current === 'rifle',
    };
  },
};

/** convert a point in weapon-scene camera space to world space as seen through the main camera */
const _tw1 = new THREE.Vector3(), _tw2 = new THREE.Vector3();
Viewmodel.toWorld = function (v) {
  const d = v.length();
  const ndc = _tw1.copy(v).project(this.camera);
  const cam = G.camera;
  const p = _tw2.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(d).add(cam.position);
  return v.copy(p);
};
