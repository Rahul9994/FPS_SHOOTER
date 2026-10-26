/* =====================================================================
 *  HOLLOW RIDGE  -  60-audio.js
 *  Fully procedural Web Audio: weapons, reload mechanics, footsteps,
 *  wind / grass / rain / birds / crickets / distant battle, spatial sources
 * ===================================================================== */

const Audio3D = {
  ctx: null, ready: false, resumed: false,
  _lastBird: 0, _lastDistant: 0, _stepToggle: 0,

  /** build the graph (can run before a user gesture: context starts suspended) */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = Settings.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 1; this.amb.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.7; this.ui.connect(this.master);

    // white noise (shared)
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // pink-ish noise for ambience
    this.pinkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const p = this.pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    // outdoor reverb: sparse echoes (hills) + dark exponential tail
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.15 + 0.8 * Math.min(1, t / 1.6);
        lp += ((Math.random() * 2 - 1) - lp) * (1 - k * 0.92);
        ch[i] = lp * Math.exp(-t * 2.6) * (t < 0.01 ? t / 0.01 : 1) * 0.55;
      }
      for (const [et, ea] of [[0.11, 0.5], [0.27, 0.38], [0.46, 0.3], [0.71, 0.2]]) {
        const idx = Math.floor((et + (c ? 0.013 : 0)) * ctx.sampleRate);
        for (let j = 0; j < 300; j++) ch[idx + j] += (Math.random() * 2 - 1) * ea * Math.exp(-j / 90) * 0.6;
      }
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.55;
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.8;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this._buildAmbience();
    this.ready = true;
  },

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
    this.resumed = true;
  },
  setVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); },
  now() { return this.ctx ? this.ctx.currentTime : 0; },

  /* ------------------------------------------------------ primitives */
  noise(o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = (o.t0 ?? ctx.currentTime) + (o.delay || 0), dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource(); src.buffer = o.pink ? this.pinkBuf : this.noiseBuf;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'lowpass'; f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.f ?? 2000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + dur);
    const g = ctx.createGain();
    const peak = Math.max(0.0002, o.gain ?? 0.4);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || this.sfx);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(this.reverbSend); }
    src.start(t0, Math.random() * 2); src.stop(t0 + dur + 0.05);
  },
  tone(o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = (o.t0 ?? ctx.currentTime) + (o.delay || 0), dur = o.dur ?? 0.1;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f ?? 200, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.3), t0 + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(o.dest || this.sfx);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(this.reverbSend); }
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  },
  /** metallic clack: inharmonic partials + noise tick */
  clack(o = {}) {
    const f = o.f ?? 800, g = o.gain ?? 0.3, dest = o.dest || this.sfx, d = o.dur ?? 0.09, t0 = o.t0, delay = o.delay;
    this.tone({ f, dur: d, gain: g * 0.6, type: 'triangle', dest, t0, delay, reverb: o.reverb });
    this.tone({ f: f * 2.76, dur: d * 0.7, gain: g * 0.35, dest, t0, delay });
    this.tone({ f: f * 5.4, dur: d * 0.45, gain: g * 0.2, dest, t0, delay });
    this.noise({ filter: 'bandpass', f: Math.min(9000, f * 4), q: 1.2, dur: 0.02, gain: g * 0.9, dest, t0, delay });
    if (o.thump) this.tone({ f: o.thump, f2: o.thump * 0.6, dur: 0.1, gain: g * 0.9, dest, t0, delay });
  },
  /** positional chain for a world position; returns {dest, delay} */
  spatial(pos, opts = {}) {
    if (!this.ready) return { dest: this.sfx, delay: 0, dist: 0 };
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = opts.ref ?? 4; pan.rolloffFactor = opts.rolloff ?? 1.15; pan.maxDistance = 600;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; } else pan.setPosition(pos.x, pos.y, pos.z);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    const dist = this.listenerPos ? this.listenerPos.distanceTo(pos) : 10;
    lp.frequency.value = clamp(14000 / (1 + dist * 0.045), 700, 14000);
    lp.connect(pan); pan.connect(this.sfx);
    return { dest: lp, delay: Math.min(1.2, dist / 343), dist, panner: pan };
  },

  /* --------------------------------------------------------- weapons */
  rifleShot(opts = {}) {
    if (!this.ready) return;
    const sp = opts.pos ? this.spatial(opts.pos, { ref: 6 }) : { dest: this.sfx, delay: 0 };
    const v = (opts.vol ?? 1) * 0.85, dest = sp.dest, delay = sp.delay, j = rand(0.92, 1.08);
    const far = !!opts.pos;
    this.noise({ filter: 'highpass', f: 1600 * j, q: 0.7, dur: 0.1, gain: 0.7 * v, attack: 0.0005, dest, delay, reverb: far ? 0.5 : 0.3 });
    this.noise({ filter: 'bandpass', f: 1100 * j, f2: 300, q: 0.9, dur: 0.24, gain: 1.0 * v, attack: 0.001, dest, delay, reverb: 0.55 });
    this.noise({ filter: 'lowpass', f: 420, f2: 120, q: 0.7, dur: 0.32, gain: 0.8 * v, attack: 0.002, dest, delay, reverb: 0.6 });
    this.tone({ f: 150 * j, f2: 42, dur: 0.2, gain: 1.0 * v, type: 'sine', dest, delay });
    this.tone({ f: 70, f2: 38, dur: 0.3, gain: 0.7 * v, type: 'sine', dest, delay, reverb: 0.4 });
    // long echo off the hills
    this.noise({ filter: 'lowpass', f: 700, f2: 180, dur: 1.1, gain: 0.16 * v, attack: 0.01, dest, delay: delay + 0.18, reverb: 0.9, pink: true });
    if (!far) this.clack({ f: 1300, gain: 0.12, dur: 0.05, delay: 0.022, thump: 0 });
  },
  dryFire() { this.clack({ f: 2600, gain: 0.22, dur: 0.035 }); },
  magRelease() { this.clack({ f: 1700, gain: 0.26, dur: 0.05 }); this.noise({ filter: 'bandpass', f: 3000, q: 2, dur: 0.03, gain: 0.1 }); },
  magOut() { this.noise({ filter: 'bandpass', f: 600, f2: 1500, q: 1.3, dur: 0.17, gain: 0.2, attack: 0.04 }); this.clack({ f: 520, gain: 0.12, dur: 0.05, delay: 0.17 }); },
  magIn() {
    this.noise({ filter: 'bandpass', f: 1500, f2: 700, q: 1.3, dur: 0.12, gain: 0.2, attack: 0.03 });
    this.clack({ f: 500, gain: 0.42, dur: 0.11, delay: 0.1, thump: 110 });
  },
  magTap() { this.clack({ f: 760, gain: 0.22, dur: 0.06, thump: 140 }); },
  boltBack() { this.noise({ filter: 'bandpass', f: 1900, f2: 800, q: 1.0, dur: 0.15, gain: 0.26, attack: 0.03 }); this.clack({ f: 900, gain: 0.2, dur: 0.06, delay: 0.14 }); },
  boltForward() { this.noise({ filter: 'bandpass', f: 800, f2: 1800, q: 0.9, dur: 0.08, gain: 0.18, attack: 0.02 }); this.clack({ f: 440, gain: 0.55, dur: 0.14, delay: 0.07, thump: 90 }); },
  rackSlap() { this.clack({ f: 640, gain: 0.5, dur: 0.12, thump: 100 }); },
  rifleDraw() { this.noise({ filter: 'lowpass', f: 1100, f2: 500, dur: 0.24, gain: 0.14, attack: 0.05, pink: true }); this.clack({ f: 1100, gain: 0.14, dur: 0.05, delay: 0.16 }); },
  fireMode() { this.clack({ f: 2100, gain: 0.2, dur: 0.04 }); },
  knifeDraw() {
    this.noise({ filter: 'highpass', f: 3200, q: 0.8, dur: 0.2, gain: 0.12, attack: 0.04 });
    this.tone({ f: 3300, dur: 0.4, gain: 0.04 }); this.tone({ f: 5200, dur: 0.3, gain: 0.025 });
  },
  knifeSwing(heavy) {
    this.noise({ filter: 'bandpass', f: heavy ? 380 : 520, f2: heavy ? 1800 : 2400, q: 1.1, dur: heavy ? 0.3 : 0.2, gain: heavy ? 0.42 : 0.3, attack: heavy ? 0.1 : 0.06, pink: true });
  },
  knifeHit(surf) {
    if (surf === 'flesh') { this.noise({ filter: 'lowpass', f: 700, f2: 200, dur: 0.14, gain: 0.5 }); this.tone({ f: 120, f2: 60, dur: 0.12, gain: 0.5 }); return; }
    this.noise({ filter: 'bandpass', f: 2400, q: 1, dur: 0.05, gain: 0.35 });
    this.tone({ f: surf === 'metal' ? 2200 : 300, f2: surf === 'metal' ? 1700 : 140, dur: surf === 'metal' ? 0.3 : 0.12, gain: surf === 'metal' ? 0.12 : 0.4 });
    this.tone({ f: 110, f2: 55, dur: 0.1, gain: 0.35 });
  },

  /* --------------------------------------------------- world sounds */
  enemyShot(pos) { this.rifleShot({ pos, vol: 1.8 }); },
  bulletWhiz(pos) {
    const sp = this.spatial(pos, { ref: 2, rolloff: 0.5 });
    this.noise({ filter: 'bandpass', f: 2800, f2: 1200, q: 3, dur: 0.18, gain: 0.35, attack: 0.04, dest: sp.dest });
  },
  impact(surf, pos) {
    if (!this.ready) return;
    const sp = this.spatial(pos, { ref: 3 });
    const d = sp.dest, dl = sp.delay;
    switch (surf) {
      case 'rock': case 'concrete': case 'sand': case 'metal':
        this.noise({ filter: 'bandpass', f: 2600, q: 1.2, dur: 0.05, gain: 0.35, dest: d, delay: dl });
        this.tone({ f: surf === 'metal' ? 1800 : 400, f2: surf === 'metal' ? 1200 : 160, dur: surf === 'metal' ? 0.35 : 0.1, gain: surf === 'metal' ? 0.14 : 0.3, dest: d, delay: dl });
        if (Math.random() < 0.5) this.tone({ f: 3400, f2: 1100, dur: 0.5, gain: 0.07, dest: d, delay: dl + 0.03, reverb: 0.6 });  // ricochet whine
        break;
      case 'wood':
        this.noise({ filter: 'lowpass', f: 1400, f2: 400, dur: 0.1, gain: 0.5, dest: d, delay: dl }); this.tone({ f: 190, f2: 90, dur: 0.1, gain: 0.35, dest: d, delay: dl });
        break;
      case 'flesh':
        this.noise({ filter: 'lowpass', f: 800, f2: 200, dur: 0.12, gain: 0.5, dest: d, delay: dl }); this.tone({ f: 110, f2: 55, dur: 0.1, gain: 0.4, dest: d, delay: dl });
        break;
      case 'foliage': this.noise({ filter: 'bandpass', f: 3000, q: 0.5, dur: 0.12, gain: 0.18, dest: d, delay: dl }); break;
      default: this.noise({ filter: 'lowpass', f: 900, f2: 250, dur: 0.14, gain: 0.5, dest: d, delay: dl }); this.tone({ f: 100, f2: 50, dur: 0.12, gain: 0.3, dest: d, delay: dl });
    }
  },
  casing(pos) {
    const sp = this.spatial(pos, { ref: 1.5 });
    this.clack({ f: rand(3300, 4600), gain: 0.07, dur: 0.07, dest: sp.dest, delay: sp.delay });
  },
  magDrop(pos) {
    const sp = this.spatial(pos, { ref: 1.5 });
    this.noise({ filter: 'lowpass', f: 600, dur: 0.1, gain: 0.3, dest: sp.dest }); this.clack({ f: 380, gain: 0.25, dur: 0.1, dest: sp.dest });
  },
  step(surface, intensity = 1) {
    if (!this.ready) return;
    const w = Atmos.cur.wet;
    const j = rand(0.85, 1.2);
    if (surface === 'dirt') {
      this.noise({ filter: 'bandpass', f: 520 * j, q: 0.6, dur: 0.11, gain: 0.22 * intensity, attack: 0.006 });
      this.noise({ filter: 'highpass', f: 2200 * j, dur: 0.07, gain: 0.07 * intensity * (1 - w * 0.6) });
    } else {
      this.noise({ filter: 'bandpass', f: 380 * j, q: 0.5, dur: 0.13, gain: 0.17 * intensity, attack: 0.012, pink: true });
      this.noise({ filter: 'highpass', f: 3400 * j, dur: 0.12, gain: 0.07 * intensity * (1 - w * 0.5), attack: 0.02 });
    }
    if (w > 0.4) this.noise({ filter: 'bandpass', f: 1200, q: 0.8, dur: 0.1, gain: 0.07 * w * intensity });
    this.tone({ f: 85 * j, f2: 50, dur: 0.08, gain: 0.1 * intensity });
  },
  /** another player's footstep, positioned in the world (multiplayer) */
  stepAt(pos, intensity = 1) {
    if (!this.ready) return;
    const sp = this.spatial(pos, { ref: 2.5, rolloff: 1.6 }), j = rand(0.85, 1.2), w = Atmos.cur.wet;
    this.noise({ filter: 'bandpass', f: 430 * j, q: 0.6, dur: 0.12, gain: 0.3 * intensity, attack: 0.008, pink: true, dest: sp.dest, delay: sp.delay });
    this.noise({ filter: 'highpass', f: 3000 * j, dur: 0.08, gain: 0.08 * intensity * (1 - w * 0.5), dest: sp.dest, delay: sp.delay });
  },
  land(power) { this.noise({ filter: 'lowpass', f: 600, f2: 150, dur: 0.22, gain: 0.5 * power }); this.tone({ f: 90, f2: 40, dur: 0.18, gain: 0.55 * power }); },
  cloth() { this.noise({ filter: 'lowpass', f: 1000, f2: 500, dur: 0.18, gain: 0.07, attack: 0.04, pink: true }); },
  playerHurt() { this.noise({ filter: 'lowpass', f: 500, dur: 0.18, gain: 0.5 }); this.tone({ f: 90, f2: 50, dur: 0.2, gain: 0.55 }); this.tone({ f: 3500, dur: 0.6, gain: 0.015 }); },
  heartbeat() { this.tone({ f: 58, f2: 40, dur: 0.14, gain: 0.5 }); this.tone({ f: 52, f2: 38, dur: 0.12, gain: 0.35, delay: 0.17 }); },
  thunder(power = 1) {
    if (!this.ready) return;
    this.noise({ filter: 'lowpass', f: 320, f2: 70, q: 0.6, dur: 3.2 + power * 1.5, gain: 0.9 * power, attack: 0.25, dest: this.amb, reverb: 0.8, pink: true });
    this.noise({ filter: 'bandpass', f: 140, q: 0.8, dur: 2.2, gain: 0.55 * power, attack: 0.08, dest: this.amb, delay: 0.1, pink: true });
  },
  distantBattle() {
    if (!this.ready) return;
    const kind = Math.random();
    const d = this.amb;
    if (kind < 0.35) {     // heavy explosion far away
      this.noise({ filter: 'lowpass', f: 280, f2: 60, dur: 2.4, gain: 0.5, attack: 0.02, dest: d, reverb: 0.9, pink: true });
      this.tone({ f: 60, f2: 30, dur: 1.2, gain: 0.45, dest: d });
    } else {                // burst of muffled gunfire
      const n = randInt(3, 9), rate = rand(0.08, 0.13);
      for (let i = 0; i < n; i++) {
        this.noise({ filter: 'lowpass', f: 1500, f2: 400, q: 0.7, dur: 0.22, gain: rand(0.1, 0.18), attack: 0.002, dest: d, delay: i * rate, reverb: 0.9 });
        this.tone({ f: 90, f2: 45, dur: 0.12, gain: 0.12, dest: d, delay: i * rate });
      }
    }
  },
  jetFlyby() {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime, dur = 14;
    const src = ctx.createBufferSource(); src.buffer = this.pinkBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(260, t0); f.frequency.linearRampToValueAtTime(900, t0 + dur * 0.5); f.frequency.linearRampToValueAtTime(240, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.5, t0 + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 80; pan.rolloffFactor = 1;
    const lp = this.listenerPos || new THREE.Vector3();
    const sx = lp.x - 1500, ex = lp.x + 1500, y = lp.y + 650, z = lp.z - 600;
    if (pan.positionX) { pan.positionX.setValueAtTime(sx, t0); pan.positionX.linearRampToValueAtTime(ex, t0 + dur); pan.positionY.value = y; pan.positionZ.value = z; }
    src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.amb);
    src.start(t0); src.stop(t0 + dur + 0.1);
  },

  /* ---------------------------------------------------------- UI */
  uiClick() { this.tone({ f: 900, f2: 700, dur: 0.05, gain: 0.18, dest: this.ui }); },
  uiToggle(on) { this.tone({ f: on ? 700 : 480, f2: on ? 1100 : 320, dur: 0.07, gain: 0.2, dest: this.ui }); },
  hitMarker(head) { this.tone({ f: head ? 2600 : 1700, f2: head ? 2300 : 1400, dur: 0.045, gain: head ? 0.28 : 0.2, dest: this.ui }); },
  killMarker() { this.tone({ f: 1300, dur: 0.07, gain: 0.25, dest: this.ui }); this.tone({ f: 1900, dur: 0.1, gain: 0.25, dest: this.ui, delay: 0.07 }); },
  pickup() { this.tone({ f: 600, f2: 900, dur: 0.1, gain: 0.2, dest: this.ui }); this.tone({ f: 900, f2: 1300, dur: 0.14, gain: 0.2, dest: this.ui, delay: 0.09 }); },

  /* ---------------------------------------------------- ambience */
  _buildAmbience() {
    const ctx = this.ctx;
    const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 2); return s; };
    const lfo = (freq, depth, target) => { const o = ctx.createOscillator(); o.frequency.value = freq; const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); o.start(); return o; };
    // wind body
    const w1 = loop(this.pinkBuf, 0.7), wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.45;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    w1.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.amb);
    lfo(0.11, 0.08, this.windGain.gain); lfo(0.27, 0.05, this.windGain.gain); lfo(0.07, 90, wf.frequency);
    // grass / foliage rustle
    const r1 = loop(this.noiseBuf, 1.0), rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 4200; rf.Q.value = 0.35;
    const rh = ctx.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 2200;
    this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0;
    r1.connect(rf); rf.connect(rh); rh.connect(this.rustleGain); this.rustleGain.connect(this.amb);
    lfo(0.19, 0.01, this.rustleGain.gain); lfo(0.43, 0.006, this.rustleGain.gain);
    // rain (hiss + low patter)
    const ra = loop(this.noiseBuf, 1.0), raf = ctx.createBiquadFilter(); raf.type = 'highpass'; raf.frequency.value = 1400;
    const rab = ctx.createBiquadFilter(); rab.type = 'lowpass'; rab.frequency.value = 9000;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    ra.connect(raf); raf.connect(rab); rab.connect(this.rainGain); this.rainGain.connect(this.amb);
    const rb = loop(this.pinkBuf, 1.3), rbf = ctx.createBiquadFilter(); rbf.type = 'lowpass'; rbf.frequency.value = 700;
    this.rainLowGain = ctx.createGain(); this.rainLowGain.gain.value = 0;
    rb.connect(rbf); rbf.connect(this.rainLowGain); this.rainLowGain.connect(this.amb);
    // crickets
    const cr = ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4300;
    const crPulse = ctx.createGain(); crPulse.gain.value = 0;
    const crGate = ctx.createGain(); crGate.gain.value = 0; this.cricketGain = crGate;
    cr.connect(crPulse); crPulse.connect(crGate); crGate.connect(this.amb); cr.start();
    lfo(21, 0.5, crPulse.gain);
    const cr2 = ctx.createOscillator(); cr2.type = 'sine'; cr2.frequency.value = 5100;
    const cr2p = ctx.createGain(); cr2p.gain.value = 0; cr2.connect(cr2p); cr2p.connect(crGate); cr2.start(); lfo(17, 0.4, cr2p.gain);
    // gating of crickets over time
    lfo(0.23, 0.0, crGate.gain);
  },

  bird() {
    if (!this.ready) return;
    const cam = this.listenerPos || new THREE.Vector3();
    const a = rand(0, TAU), d = rand(25, 90);
    const pos = new THREE.Vector3(cam.x + Math.cos(a) * d, cam.y + rand(6, 25), cam.z + Math.sin(a) * d);
    const sp = this.spatial(pos, { ref: 8, rolloff: 0.9 });
    const type = randInt(0, 2), base = rand(2200, 3800), n = randInt(2, 5);
    for (let i = 0; i < n; i++) {
      const t = i * (type === 0 ? 0.09 : 0.17);
      this.tone({ f: base * (1 + i * 0.03), f2: base * (type === 1 ? 0.7 : 1.4), dur: type === 2 ? 0.2 : 0.07, gain: 0.07, dest: sp.dest, delay: t + sp.delay, type: 'sine' });
      this.tone({ f: base * 2.01, f2: base * 2.5, dur: 0.05, gain: 0.015, dest: sp.dest, delay: t + sp.delay });
    }
  },

  /** per-frame: ambience levels, listener pose, random events */
  update(dt, camera, player) {
    if (!this.ready) return;
    const ctx = this.ctx, l = ctx.listener;
    this.listenerPos = camera.position;
    const f = _v1.set(0, 0, -1).applyQuaternion(camera.quaternion), u = _v2.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // the listener pose is nine AudioParams; only touch them in frames where it really moved (standing still = no work)
    const p = camera.position, lp = this._lp || (this._lp = [NaN, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (!(Math.abs(p.x - lp[0]) < 1e-4 && Math.abs(p.y - lp[1]) < 1e-4 && Math.abs(p.z - lp[2]) < 1e-4 && Math.abs(f.x - lp[3]) < 1e-4 && Math.abs(f.y - lp[4]) < 1e-4 && Math.abs(f.z - lp[5]) < 1e-4 && Math.abs(u.x - lp[6]) < 1e-4 && Math.abs(u.y - lp[7]) < 1e-4 && Math.abs(u.z - lp[8]) < 1e-4)) {
      lp[0] = p.x; lp[1] = p.y; lp[2] = p.z; lp[3] = f.x; lp[4] = f.y; lp[5] = f.z; lp[6] = u.x; lp[7] = u.y; lp[8] = u.z;
      if (l.positionX) {
        l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
        l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z; l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
      } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    }

    const c = Atmos.cur, T = ctx.currentTime;
    const day = Atmos.dayAmt, night = Atmos.nightAmt;
    // ambience levels glide over 0.4 - 1 s (setTargetAtTime), so re-aiming them 10 times a second is indistinguishable from 60+ and avoids piling up automation events
    this._ambT = (this._ambT || 0) - dt;
    if (this._ambT <= 0) {
      this._ambT = 0.1;
      this.windGain.gain.setTargetAtTime(0.05 + c.wind * 0.22 + c.rain * 0.04, T, 0.4);
      this.rustleGain.gain.setTargetAtTime((0.012 + c.wind * 0.07) * (1 - c.rain * 0.4), T, 0.4);
      this.rainGain.gain.setTargetAtTime(c.rain * 0.28, T, 0.5);
      this.rainLowGain.gain.setTargetAtTime(c.rain * 0.22, T, 0.5);
      this.cricketGain.gain.setTargetAtTime(night * (1 - c.rain) * 0.012 * (1 - c.wind * 0.5), T, 1.0);
    }

    const now = performance.now() / 1000;
    if (day > 0.4 && c.rain < 0.1 && c.fog < 0.01 && now - this._lastBird > 2.5 && Math.random() < dt * 0.6) { this._lastBird = now; this.bird(); }
    if (now - this._lastDistant > 6 && Math.random() < dt * 0.12) { this._lastDistant = now; this.distantBattle(); }
  },
};
