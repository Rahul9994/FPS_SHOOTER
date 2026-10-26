/* =====================================================================
 *  HOLLOW RIDGE  -  99-main.js
 *  Renderer + post-processing, loading pipeline, game loop, game state
 * ===================================================================== */

let renderer, scene, weaponScene, weaponCam, composer, bloomPass, gradePass, outputPass, fxaaPass, renderPassWorld, renderPassWeapon;
const canvasEl = document.getElementById('gl');

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uGrain: { value: 0.03 }, uSat: { value: 1.06 }, uDesat: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uAspect: { value: 1.7 }, uSunPos: { value: new THREE.Vector2(0.5, 0.5) }, uGlare: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uSat, uDesat, uAspect, uGlare; uniform vec2 uSunPos; uniform vec3 uTint; varying vec2 vUv;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // gentle contrast S-curve
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat * (1.0 - uDesat));
      c *= uTint;
      // sun glare / veiling flare
      if (uGlare > 0.001) {
        vec2 sp = (vUv - uSunPos) * vec2(uAspect, 1.0);
        float sd = length(sp);
        float gl = 0.24 * exp(-sd * 5.5) + 0.12 * exp(-sd * 1.6) + 0.5 * exp(-sd * 22.0);
        vec2 gp = (vUv - (vec2(1.0) - uSunPos) * 0.6 - vec2(0.2)) * vec2(uAspect, 1.0);
        float ghost = 0.05 * smoothstep(0.16, 0.12, length(gp)) * smoothstep(0.02, 0.1, length(gp));
        c += (vec3(1.0, 0.92, 0.78) * gl + vec3(0.6, 0.8, 1.0) * ghost) * uGlare;
      }
      // vignette
      vec2 q = (vUv - 0.5) * vec2(uAspect * 0.62, 1.0);
      float v = smoothstep(0.95, 0.25, length(q) * 1.15);
      c *= mix(1.0 - uVig, 1.0, v);
      // film grain
      float g = h21(vUv * 1100.0 + fract(uTime) * 91.7) - 0.5;
      c += g * uGrain * (1.0 - l * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const Game = {
  lockErrors: 0, lastFrame: 0, frameN: 0, fpsWin: [], adaptiveCooldown: 12, started: false, _due: 0,

  /* ------------------------------------------------------------ rendering */
  initRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    // which GPU did the browser actually give us? (Edge/Chrome on hybrid laptops often ignore powerPreference and pick the iGPU)
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rawGpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const gm = /ANGLE \([^,]*,\s*(.+?)\s*(?:\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal)/i.exec(rawGpu);
    G.gpu = { raw: rawGpu, name: (gm ? gm[1] : rawGpu).replace(/^NVIDIA GeForce /, ''), integrated: /intel/i.test(rawGpu) && !/arc/i.test(rawGpu) };
    // a different GPU than last run: the saved quality was tuned for the old one, so calibrate again
    if (Settings.gpu && Settings.gpu !== rawGpu && !urlParams.get('q')) Settings.autoQuality = true;
    Settings.gpu = rawGpu; Settings.save();
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = Gfx.shadowCfg().softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    scene = new THREE.Scene(); weaponScene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 7000);
    G.camera.rotation.order = 'YXZ';
    weaponCam = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 10);
    weaponScene.add(weaponCam);
    scene.add(G.camera);

    const pr = G.quality.pixelRatio;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(renderer.capabilities.maxSamples || 4, G.quality.msaa), colorSpace: THREE.LinearSRGBColorSpace });
    composer = new EffectComposer(renderer, rt);
    renderPassWorld = new RenderPass(scene, G.camera);
    renderPassWeapon = new RenderPass(weaponScene, weaponCam);
    renderPassWeapon.clear = false; renderPassWeapon.clearDepth = true;
    bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.2, 0.6, 0.95);
    outputPass = new OutputPass();
    gradePass = new ShaderPass(GRADE_SHADER);
    fxaaPass = new ShaderPass(FXAAShader);
    composer.addPass(renderPassWorld); composer.addPass(renderPassWeapon); composer.addPass(bloomPass); composer.addPass(outputPass); composer.addPass(fxaaPass); composer.addPass(gradePass);
    bloomPass.enabled = G.quality.bloom; fxaaPass.enabled = G.quality.fxaa;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    Gfx.init({ renderer, composer, camera: G.camera, scene });
  },
  resize() {
    const w = window.innerWidth, h = window.innerHeight, pr = G.quality.pixelRatio;
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
    weaponCam.aspect = w / h; weaponCam.updateProjectionMatrix();
    G.renderHeight = h * pr; G.renderWidth = w * pr;
    gradePass.uniforms.uAspect.value = w / h;
    fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (Atmos.rainUniforms) Atmos.rainUniforms.uRes.value.set(w * pr, h * pr);
  },
  applyQuality(name, auto) {
    if (!QUALITY[name]) return;
    Settings.quality = name; if (!auto) Settings.autoQuality = false; Settings.save(); G.quality = QUALITY[name];
    bloomPass.enabled = G.quality.bloom; fxaaPass.enabled = G.quality.fxaa;
    // MSAA level lives on the composer's two ping-pong targets
    const ms = Math.min(renderer.capabilities.maxSamples || 4, G.quality.msaa);
    for (const t of [composer.renderTarget1, composer.renderTarget2]) { if (t.samples !== ms) { t.samples = ms; t.dispose(); } }
    this.resize();
    Gfx.apply(); Gfx.applyFlash();
    Atmos.setShadowQuality();
    setGrassQuality(G.quality.grass);
    emit('notify', { text: `Graphics: ${G.quality.name}`, kind: '' });
  },

  /* ----------------------------------------------------------- game flow */
  /** any modal screen up? (cheat menu, pause menu, shop, results, ...) */
  menuUp() { return G.menuOpen || G.pauseMenuOpen || G.uiOpen; },
  updatePause(resume) {
    const was = G.paused, up = this.menuUp(), mp = G.mode === 'mp';
    // single player freezes the simulation behind a menu; a multiplayer match can never pause, so only the player's input is ignored
    G.paused = up && !mp;
    Input.enabled = !up && (G.state === 'playing' || G.state === 'dead');
    Input.setLocked(mp && (up || MP.frozen));
    if (up && document.pointerLockElement) document.exitPointerLock();
    if (resume && !up) this.requestLock();
    if ((!G.paused && was) || up) { Input.mouse[0] = Input.mouse[1] = Input.mouse[2] = false; }
  },
  requestLock() {
    if (G.pointerLocked) return;
    try { const p = canvasEl.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  },
  resume() { PauseMenu.hide(); this.updatePause(true); },
  restart() {
    G.kills = 0; G.deaths = 0; G.shots = 0; G.hits = 0;
    Player.reset(); Weapons.reset(); Enemies.spawnInitial(); Rewards.spStreak = 0;
    Decals.clear(); DroppedMags.clear();
    for (const t of Props.targets) { t.state = 0; t.down = 0; }
    $('death').classList.add('hidden');
    G.state = 'playing'; this.updatePause();
    emit('notify', { text: 'Mission restarted', kind: 'good' });
  },
  respawn() {
    $('death').classList.add('hidden');
    Player.reset(); Weapons.reset(); G.state = 'playing'; this.updatePause();
    emit('notify', { text: 'Redeployed', kind: 'good' });
  },

  /** shared start-up for single player and multiplayer sessions */
  _beginCommon() {
    if (!this._firstRun) {
      this._firstRun = true;
      if (G.gpu.integrated) toast(`Running on ${G.gpu.name} (integrated). On a laptop with a dedicated GPU, start the game with Play-RTX.bat`, 8000);
      if (Settings.autoQuality && !urlParams.get('q')) { this.calib = { n: 0, acc: 0, warm: 45 }; if (Settings.quality !== 'high') this.applyQuality('high', true); }
    }
    this.started = true;
    Audio3D.resume();
    Decals.clear(); DroppedMags.clear();
    $('death').classList.add('hidden'); $('scoreboard').classList.add('hidden');
    Weapons.cancelInspect();
    Menus.hideAll(); PauseMenu.hide(); if (CheatMenu.open_) CheatMenu.close();
  },
  /** single player: the original hillside mission with AI soldiers */
  begin() { this.startSP(); },
  startSP() {
    G.mode = 'sp'; this._beginCommon();
    G.kills = G.deaths = G.shots = G.hits = 0; Rewards.spStreak = 0;
    Player.reset(); Weapons.reset(); Enemies.spawnInitial();
    G.state = 'playing'; Input.enabled = true; HUD.show(true); HUD.setMP(false);
    PauseMenu.render(); this.updatePause();
    this.requestLock();
    setTimeout(() => emit('notify', { text: 'Hostiles ahead — hold the hill', kind: '' }), 1400);
    Ambient.timer = 22;
  },
  /** multiplayer: a world that contains ONLY the connected human players (no AI soldiers, no bots) */
  beginMP(m) {
    G.mode = 'mp'; this._beginCommon();
    for (const k of Object.keys(G.cheats)) G.cheats[k] = false;
    Enemies.clear();
    Atmos.autoCycle = false; Atmos.setWeather(m.env.weather, m.env.intensity, true); Atmos.setHour(m.env.hour);
    G.kills = G.deaths = G.shots = G.hits = 0;
    Player.reset(); Weapons.reset();
    G.state = 'playing'; Input.enabled = true; HUD.show(true); HUD.setMP(true);
    PauseMenu.render(); MP.renderList(); this.updatePause();
    this.requestLock();
    if (!G.pointerLocked) toast('Click the game window to capture the mouse', 4000);
  },
  mpFreeze(v) { MP.frozen = v; this.updatePause(); },
  mpSpawnLocal(m) {
    $('death').classList.add('hidden');
    Player.reset();
    Player.pos.set(m.x, terrainHeight(m.x, m.z), m.z); Player.yaw = m.yaw; Player.pitch = 0; Player.vel.set(0, 0, 0);
    Weapons.reset(); Weapons.ammo.mag = m.mag; Weapons.ammo.reserve = m.res; Player.health = m.hp;
    G.state = 'playing'; MP.protectUntil = performance.now() + (m.prot | 0); MP.killedBy = '';
    this.updatePause();
  },
  /** leave the 3D world and go back to the menu backdrop (keepSession: stay in the multiplayer lobby) */
  exitToMenu(opts = {}) {
    if (document.pointerLockElement) document.exitPointerLock();
    const wasMP = G.mode === 'mp';
    G.state = 'menu'; G.paused = false; G.menuOpen = false; G.pauseMenuOpen = false; G.uiOpen = false;
    if (CheatMenu.open_) { CheatMenu.open_ = false; CheatMenu.el.classList.add('hidden'); }
    PauseMenu.hide(); Input.enabled = false; Input.setLocked(false); MP.frozen = false;
    MP.inWorld = false; for (const r of MP.remotes.values()) { r.alive = false; r.model.root.visible = false; }
    HUD.show(false); HUD.setMP(false); $('death').classList.add('hidden'); $('scoreboard').classList.add('hidden'); MP.scoreboardOpen = false;
    Enemies.clear(); Decals.clear(); DroppedMags.clear(); Weapons.cancelInspect();
    Player.flashlightOn = false; Player.reset(); Weapons.reset();
    G.mode = 'sp';
    Atmos.autoCycle = false; Atmos.setWeather('clear', 0.45, true); Atmos.setHour(10.2);
    if (opts.keepSession && MP.active) Menus.show('lobby'); else if (wasMP && MP.active) Menus.show('multi'); else Menus.openMain();
  },

  onKey(e) {
    if (e.code === 'Tab' && G.mode === 'mp' && MP.inWorld && !G.uiOpen) { MP.showScoreboard(true); return; }
    if (e.code === 'Escape' && G.state === 'playing' && !G.paused && !G.pointerLocked && !this.menuUp()) { PauseMenu.show(); this.updatePause(); return; }
    if (G.state !== 'playing' || G.paused || !Player.alive || !Input.enabled || Input.locked) return;
    switch (e.code) {
      case 'KeyR': Weapons.cancelInspect(); Weapons.reload(); break;
      case 'KeyV': if (Weapons.state === 'inspecting') Weapons.cancelInspect(); else Weapons.inspect(); break;
      case 'Digit1': Weapons.cancelInspect(); Weapons.switchTo('rifle'); break;
      case 'Digit2': Weapons.cancelInspect(); Weapons.switchTo('knife'); break;
      case 'KeyQ': Weapons.cancelInspect(); Weapons.switchTo(Weapons.current === 'rifle' ? 'knife' : 'rifle'); break;
      case 'KeyB': if (Weapons.current === 'rifle') { Weapons.semi = !Weapons.semi; Audio3D.fireMode(); emit('notify', { text: Weapons.semi ? 'Semi-auto' : 'Full-auto' }); } break;
      case 'KeyF': Player.flashlightOn = !Player.flashlightOn; Audio3D.clack({ f: 2000, gain: 0.12, dur: 0.03 }); break;
      case 'F3': Settings.showFps = !Settings.showFps; Settings.save(); break;
    }
  },

  /* ------------------------------------------------------------- boot */
  async boot() {
    Loading.init();
    Profile.load();
    Input.init();
    const steps = [];
    const add = (label, weight, fn) => steps.push({ label, weight, fn });
    add('Preparing renderer', 0.03, async () => { this.initRenderer(); Atmos.init(renderer, scene, weaponScene); Particles.init(scene); Atmos.setWeather('clear', 0.45, true); Atmos.setHour(10.2); });
    add('Loading textures', 0.1, async () => {
      // the HUD paints text into canvases (compass, name tags): make sure the bundled fonts are ready first, but never hang on them
      const fonts = Promise.all(['400 16px Rajdhani', '500 16px Rajdhani', '600 16px Rajdhani', '700 16px Rajdhani', '400 16px Oswald'].map((f) => document.fonts.load(f))).catch(() => {});
      window.__texSource = await initTextures();
      await Promise.race([fonts, sleep(1500)]);
    });
    add('Sculpting terrain', 0.2, async (p) => { await buildHeightfield((f) => p(f)); });
    add('Raising the hills', 0.08, async () => { buildGpuTerrainTextures(); buildTerrainTiles(scene); await nextFrame(); buildFarTerrain(scene); HUD.init(); HUD.bakeMinimap(); });
    add('Planting grass', 0.04, async () => { buildGrass(scene); });
    add('Growing forest', 0.1, async () => { buildVegetation(scene); });
    add('Placing boulders', 0.03, async () => { buildRocks(scene); });
    add('Building the front line', 0.06, async () => { buildProps(scene); });
    add('Assembling weapons', 0.08, async () => { Viewmodel.init(weaponScene, weaponCam); Camo.applyToObject(Viewmodel.rifle.root, Profile.equipped); MP.init(scene); Tracers.init(scene); Ambient.init(scene); Decals.init(scene); Casings.init(scene); DroppedMags.init(scene); Combat.init(scene); Enemies.init(scene); Leaves.init(scene); Atmos.setShadowQuality(); });
    add('Mixing audio', 0.04, async () => { Audio3D.init(); CheatMenu.build(); PauseMenu.build(); Menus.init(); on('keydown', (e) => this.onKey(e)); window.addEventListener('keyup', (e) => { if (e.code === 'Tab') MP.showScoreboard(false); }); });
    add('Compiling shaders', 0.24, async (p) => {
      G.flashlight = new THREE.SpotLight(0xfff0d8, 0, 80, 0.42, 0.65, 1.6); scene.add(G.flashlight, G.flashlight.target); Gfx.initFlash(scene);
      Player.reset(); Player.updateCamera(0.016); Atmos.update(0.016, G.camera.position, true);
      Enemies.spawnInitial();
      bloomPass.enabled = G.quality.bloom;
      // three.js keys its shader programs on the render target (colour space, tone mapping) - and the passes draw into the composer's HDR targets, not the screen
      renderer.setRenderTarget(composer.renderTarget1);
      try { await renderer.compileAsync(scene, G.camera); await renderer.compileAsync(weaponScene, weaponCam); } catch (e) { console.warn('compileAsync failed', e); }
      renderer.setRenderTarget(null);
      p(0.4);
      for (let i = 0; i < 3; i++) { this.renderFrame(0.016); await nextFrame(); p(0.4 + (i + 1) / 8); }
      // Warm-up frames for everything that normally first appears in the middle of play. compile() above cannot build the shadow-pass programs
      // and three.js keys a program on the lights it sees (only *visible* lights count): the knife is drawn with the rifle - and its muzzle point
      // light - hidden, and a dropped magazine is drawn in the world scene, so each is a variant the opening frames never use. Without this the first
      // shot / reload / jump / knife switch compiled shaders mid-game (100-400 ms hitches).
      const wasWeapon = renderPassWeapon.enabled; renderPassWeapon.enabled = true;
      const forced = [];       // world scene: draw hidden effect objects (casings, tracers, decals, flashlight beam ...) and uncull everything once
      scene.traverse((o) => {
        const drawable = o.isMesh || o.isPoints || o.isLine || o.isSprite;
        if (!o.visible || (drawable && o.frustumCulled)) { forced.push([o, o.visible, o.frustumCulled]); o.visible = true; if (drawable) o.frustumCulled = false; }
      });
      const flashWas = Viewmodel.flash.visible; Viewmodel.flash.visible = true;
      { const cam = G.camera, fw = new THREE.Vector3(0, 0, -2.5).applyQuaternion(cam.quaternion).add(cam.position);
        DroppedMags.spawn(Viewmodel.droppedMesh(Viewmodel.rifle.mags[0]), fw, cam.quaternion, new THREE.Vector3()); }
      try {
        composer.render(0.016); await nextFrame();                                  // rifle in hand + muzzle flash + hidden world effects + a dropped magazine
      } catch (e) { console.warn('warm-up frame failed', e); }
      for (const [o, v, f] of forced) { o.visible = v; o.frustumCulled = f; }
      Viewmodel.flash.visible = flashWas;
      try { Viewmodel.setWeapon('knife', true); composer.render(0.016); await nextFrame(); }   // knife in hand (rifle hidden)
      catch (e) { console.warn('knife warm-up frame failed', e); }
      Viewmodel.setWeapon('rifle', true);
      DroppedMags.clear();
      renderPassWeapon.enabled = wasWeapon;
      p(0.9);
      Enemies.clear();
    });
    let done = 0; const total = steps.reduce((a, s) => a + s.weight, 0);
    window.__bootTimes = [];
    for (const s of steps) {
      Loading.setProgress(done / total, s.label + '…');
      await nextFrame();
      const t0 = performance.now();
      await s.fn((f) => Loading.setProgress((done + s.weight * clamp(f, 0, 1)) / total, s.label + '…'));
      window.__bootTimes.push([s.label, Math.round(performance.now() - t0)]);
      done += s.weight;
    }
    Loading.setProgress(1, 'Ready');
    G.state = 'menu';
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (urlParams.has('autostart')) { Loading.hide(); setTimeout(() => this.begin(), 300); }
    else Loading.finish(() => Menus.openMain());
  },

  /* -------------------------------------------------------- frame update */
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    // optional frame-rate limit: skip display refreshes until the next frame is due (average rate = the cap; the GPU idles in between)
    const cap = Settings.fpsCap;
    if (cap > 0 && G.state !== 'menu') {
      const every = 1000 / cap;
      if (now < this._due - 1.5) return;
      this._due = Math.max(this._due + every, now - every);       // keep the schedule, but never build up a backlog after a hitch
    }
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) return;
    const rawDt = dt;
    dt = Math.min(dt, 0.08);
    Shop.tick(dt);
    if (G.state === 'menu') {             // menu backdrop: 30 fps is plenty and leaves the GPU free for the UI
      this._mAcc = (this._mAcc || 0) + dt; if (this._mAcc < 0.03) return;
      dt = Math.min(this._mAcc, 0.08); this._mAcc = 0;
    }
    this.renderFrame(dt);
    this.frameN++;
    // first-run calibration: pick the quality tier this machine can sustain
    if (this.calib && G.state === 'playing' && !G.paused && !document.hidden && !Settings.fpsCap) {      // (a frame-rate limit would be mistaken for a slow GPU)
      const c = this.calib;
      if (c.warm-- <= 0) { c.n++; c.acc += rawDt; }
      if (c.n >= 90) {
        const avg = c.acc / c.n * 1000, cur = G.quality.cost;      // ms per frame at the provisional tier
        const base = avg / cur;                                    // ms per frame at cost=1
        let pick = 'low';
        for (const k of ['ultra', 'high', 'medium', 'low']) { if (base * QUALITY[k].cost <= 27) { pick = k; break; } }
        this.calib = null;
        if (pick !== Settings.quality) { this.applyQuality(pick, true); toast(`Graphics set to ${QUALITY[pick].name} for your hardware — change it in the menu (F1 → Settings)`, 4500); }
      }
    }
    // adaptive quality
    if (Settings.adaptive && G.state === 'playing' && !document.hidden) {
      this.fpsWin.push(dt);
      this.adaptiveCooldown -= dt;
      if (this.fpsWin.length > 240) {
        const avg = this.fpsWin.reduce((a, b) => a + b, 0) / this.fpsWin.length;
        this.fpsWin.length = 0;
        if (this.adaptiveCooldown <= 0 && avg > 1 / 26) {
          const names = Object.keys(QUALITY), i = names.indexOf(Settings.quality);
          if (Gfx.degrade()) { toast(`Frame rate low — ray-marched lighting reduced to ${Gfx.cfg.rt.toUpperCase()}`, 3500); this.adaptiveCooldown = 8; }
          else if (i > 0) { this.applyQuality(names[i - 1]); toast(`Frame rate low — quality lowered to ${QUALITY[names[i - 1]].name}`, 3500); this.adaptiveCooldown = 10; }
        }
      }
    }
  },

  renderFrame(dt) {
    const cam = G.camera;
    SU.uTime.value += dt;
    const playing = G.state === 'playing' || G.state === 'dead';
    const sim = playing && !G.paused;
    renderPassWeapon.enabled = playing;
    Camo.update(dt);
    if (sim) {
      G.time += dt;
      Player.update(dt, G.time);
      Weapons.update(dt, G.time, Input);
      if (Input.wheel) Weapons.switchTo(Weapons.current === 'rifle' ? 'knife' : 'rifle');
      if (Player.alive) {
        // weapon flags used by viewmodel
        Viewmodel.update(dt, {
          lookDx: Input.lookDx, lookDy: Input.lookDy, speed: Player.speed2D, grounded: Player.grounded, crouch: Player.crouched,
          ads: !!Weapons.ads, sprint: Player.sprinting, strafe: (Input.key('KeyD') ? 1 : 0) - (Input.key('KeyA') ? 1 : 0),
        });
      }
      if (G.mode === 'mp') MP.update(dt); else Enemies.update(dt);      // multiplayer never simulates AI soldiers
      Combat.update(dt);
      updateTargets(dt);
      if (Player.alive) { Input.endFrame(); } else { Input.endFrame(); }
    } else if (playing) {
      // paused: keep the camera exactly where it is, keep visuals alive
      Player.updateCamera(0);
      Viewmodel.update(0, { lookDx: 0, lookDy: 0, speed: 0, grounded: true, crouch: Player.crouched, ads: false, sprint: false, strafe: 0 });
      Input.endFrame();
    } else {
      // pre-game: slowly drift the camera across the hill for a living backdrop
      cam.position.set(0, terrainHeight(0, 70) + 6, 70); cam.rotation.set(-0.1, Math.sin(performance.now() * 0.0001) * 0.6, 0, 'YXZ'); cam.updateMatrixWorld();
    }
    // wind-driven + agent-driven grass interaction
    const ag = SU.uAgents.value;
    ag[0].set(Player.pos.x, Player.pos.z, 1.15, Player.alive ? (Player.speed2D > 0.5 ? 1 : 0.55) : 0);
    let ai = 1;
    for (const e of (G.mode === 'mp' ? MP.entities() : Enemies.list)) {
      if (ai >= 10) break;
      if (!e.alive) continue;
      if (Math.abs(e.pos.x - cam.position.x) + Math.abs(e.pos.z - cam.position.z) > 190) continue;
      ag[ai++].set(e.pos.x, e.pos.z, 1.0, e.speed > 0.3 ? 1 : 0.5);
    }
    for (; ai < 10; ai++) ag[ai].w = 0;
    SU.uCamPos.value.copy(cam.position);
    { const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw); const l = Math.hypot(fx, fz) * Math.cos(Player.pitch); SU.uCamFwd.value.set(l > 0.25 ? fx : 0, l > 0.25 ? fz : 0); }
    updateGrassWindows(cam);

    // environment
    Atmos.update(dt, cam.position);
    const fwd = _fwdMain.set(0, 0, -1).applyQuaternion(cam.quaternion);      // own vector: Atmos.syncCameras() reuses the shared scratch _v1 (that used to aim the flashlight away from the player)
    _v2.copy(cam.position).addScaledVector(fwd, 18);
    Atmos.syncCameras(cam, _v2);
    renderer.toneMappingExposure = Atmos.exposure;
    gradePass.uniforms.uTime.value = performance.now() * 0.001;
    {   // screen-space sun glare (fades when behind terrain, clouds or the camera)
      const sd = Atmos.sunDir; _v3.copy(cam.position).addScaledVector(sd, 400).project(cam);
      let gl = 0;
      if (_v3.z < 1 && Atmos.skyUniforms.uSunVis.value > 0.01) {
        const edge = 1 - smoothstep(1.0, 1.7, Math.max(Math.abs(_v3.x), Math.abs(_v3.y)));
        const occl = terrainRay(cam.position.x, cam.position.y, cam.position.z, sd.x, sd.y, sd.z, 600) >= 0 ? 0 : 1;
        gl = edge * occl * Atmos.skyUniforms.uSunVis.value * (1 - Atmos.cur.cover * 0.8) * (1 - Atmos.cur.fog * 40) ;
        gradePass.uniforms.uSunPos.value.set(_v3.x * 0.5 + 0.5, _v3.y * 0.5 + 0.5);
      }
      this._glare = damp(this._glare || 0, Math.max(0, gl), 6, dt);
      gradePass.uniforms.uGlare.value = this._glare * 0.9;
    }
    const night = Atmos.nightAmt, rain = Atmos.cur.rain;
    gradePass.uniforms.uDesat.value = rain * 0.18 + Atmos.cur.fog * 6 * 0.5 + night * 0.25;
    gradePass.uniforms.uTint.value.set(1 - night * 0.1, 1 - night * 0.02, 1 + night * 0.08 + 0.0);
    bloomPass.strength = 0.16 + Atmos.dayAmt * 0.06 + (Atmos.lightning * 0.5);
    // flashlight
    if (G.flashlight) {
      const on = Player.flashlightOn && Player.alive;
      G.flashlight.intensity = damp(G.flashlight.intensity, on ? 200 : 0, 18, dt);
      G.flashlight.position.copy(cam.position).addScaledVector(fwd, 0.2).add(_v3.set(0, -0.05, 0).applyQuaternion(cam.quaternion));
      G.flashlight.target.position.copy(cam.position).addScaledVector(fwd, 12); G.flashlight.target.updateMatrixWorld();
    }
    // effects
    const lightCol = _lightC.copy(Atmos.pal.horizon).multiplyScalar(0.28 + 0.9 * Atmos.dayAmt).add(_lightC2.setRGB(0.02, 0.025, 0.04));
    const edt = G.paused ? dt * 0.25 : dt;
    Particles.update(edt, cam, lightCol);
    Ambient.update(dt);
    Tracers.update(sim ? dt : 0); Casings.update(sim ? dt : 0); DroppedMags.update(sim ? dt : 0);
    // audio + HUD
    Audio3D.update(dt, cam, Player);
    if (G.state === 'playing' || G.state === 'dead') HUD.update(dt);
    Gfx.update(dt, cam);
    composer.render(dt);
  },
};
const _lightC = new THREE.Color(), _lightC2 = new THREE.Color(), _fwdMain = new THREE.Vector3();

/* --------------------------------------------------------------- events */
on('playerDied', () => { $('death').classList.remove('hidden'); $('deathSub').textContent = G.mode === 'mp' ? 'Eliminated' : 'Redeploying…'; });
on('respawnRequest', () => { if (G.state === 'dead') Game.respawn(); });

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvasEl;
  G.pointerLocked = locked;
  if (locked) { G.hadLock = true; G.lockUnsupported = false; Game.lockErrors = 0; if (G.pauseMenuOpen) PauseMenu.hide(); Game.updatePause(); }
  else if (G.hadLock && G.state === 'playing' && !Game.menuUp()) { PauseMenu.show(); Game.updatePause(); }
});
document.addEventListener('pointerlockerror', () => {
  Game.lockErrors++;
  // never had a lock (embedded / headless browser): keep playing, mouse-look works while the cursor moves
  if (!G.hadLock && Game.lockErrors >= 2) { G.lockUnsupported = true; toast('Click the game window to capture the mouse', 3000); }
  else if (G.hadLock) toast('Click to resume mouse control', 2500);
});
canvasEl.addEventListener('mousedown', () => { if ((G.state === 'playing') && !G.paused && !G.pointerLocked && !Game.menuUp()) Game.requestLock(); });

/* ---------------------------------------------- debug / test hook surface */
window.__game = { PauseMenu, terrainHeight, raycastStatic, lineOfSight, WORLD, TERRAIN_SRC_HASH, LAYOUT, HM, MP, Net, LanScan, Profile, Rewards, Camo, CAMO_DEFS, CONFIG, Gfx, Menus, Shop, RemotePlayer, HC, Loading, Ambient, Tracers, Particles, Decals, Casings, Impacts, G, Game, Player, Weapons, Viewmodel, Enemies, Atmos, Combat, Audio3D, Input, HUD, CheatMenu, Settings, THREE, Colliders, POSE, CLIPS, RIFLE, Props, World, SU, TEX,
  get renderer() { return renderer; }, get scene() { return scene; }, get weaponScene() { return weaponScene; }, get weaponCam() { return weaponCam; }, get composer() { return composer; } };

Game.boot().catch((err) => { console.error(err); Loading.error((err && err.stack) || String(err)); });
