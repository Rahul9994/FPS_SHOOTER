/* =====================================================================
 *  HOLLOW RIDGE  -  90-ui.js
 *  HUD, compass + minimap, notifications, cheat menu, pause menu,
 *  cinematic loading screen
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

/* =================================================================== HUD */
const HUD = {
  init() {
    this.el = {
      root: $('hud'), cross: $('crosshair'), hit: $('hitmarker'), dmg: $('dmgRing'), notify: $('notify'), kill: $('killfeed'),
      prompt: $('prompt'), reload: $('reloadHint'), chips: $('cheatChips'), env: $('envLine'), menuHint: $('menuHint'), score: $('score'), fps: $('fps'),
      hNum: $('healthNum'), hFill: $('healthFill'), wName: $('wName'), mag: $('ammoMag'), res: $('ammoRes'), mode: $('wMode'), pips: $('ammoPips'),
      hurt: $('hurtVig'), low: $('lowHealth'), compass: $('compassCanvas'), mini: $('minimap'),
    };
    this.mp = { root: $('mpHud'), time: $('mpTime'), limit: $('mpLimit'), list: $('playerList'), feed: $('mpFeed'), banner: $('mpBanner'), bannerSub: $('mpBannerSub'), protect: $('mpProtect'), net: $('mpNet') };
    this.hc = { bank: $('hcBank'), match: $('hcMatch'), matchWrap: $('hcMatchWrap'), pops: $('hcPops'), numbers: $('dmgNumbers') };
    on('profile', () => this.refreshHC());
    this.refreshHC();
    for (let i = 0; i < 30; i++) this.el.pips.appendChild(document.createElement('i'));
    this.pipEls = Array.from(this.el.pips.children);
    this.cctx = this.el.compass.getContext('2d'); this.mctx = this.el.mini.getContext('2d');
    this._chipKey = ''; this._fpsAcc = 0; this._fpsN = 0; this._miniT = 0;
    on('playerHit', (d) => this.onHit(d));
    on('hitmarker', (d) => this.onHitMarker(d));
    on('kill', (d) => this.onKill(d));
    on('notify', (d) => this.notify(d.text, d.kind));
    on('suppress', (d) => { this.el.hurt.style.opacity = String(0.15 + d.amount * 0.2); setTimeout(() => (this.el.hurt.style.opacity = '0'), 120); });
    this.el.menuHint.textContent = `${keyLabel(Settings.menuKey)} · MENU`;
    on('menuKeyBound', () => { this.el.menuHint.textContent = `${keyLabel(Settings.menuKey)} · MENU`; });
  },
  show(v) { this.el.root.classList.toggle('hidden', !v); },

  notify(text, kind) {
    const d = document.createElement('div'); d.className = 'n ' + (kind || ''); d.textContent = text;
    this.el.notify.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 500); }, 2600);
    while (this.el.notify.children.length > 4) this.el.notify.firstChild.remove();
  },
  /** single-player kill of an AI soldier: confirmation + Hollow Credits (multiplayer uses confirmKill via the server) */
  onKill(d) {
    if (G.mode === 'mp') return;
    const r = d.cheat ? null : Rewards.spKill(d.head, d.knife);
    this.killBanner(`${d.head ? 'HEADSHOT · ' : ''}ENEMY ELIMINATED${r ? ` <b>+${r.total} ${HC.short}</b>` : ''}`);
    if (r) this.rewardPops(r.parts);
  },
  killBanner(html) {
    const k = document.createElement('div'); k.className = 'k'; k.innerHTML = html;
    this.el.kill.appendChild(k);
    setTimeout(() => { k.style.opacity = '0'; setTimeout(() => k.remove(), 600); }, 1900);
    while (this.el.kill.children.length > 3) this.el.kill.firstChild.remove();
  },
  /** multiplayer: the server confirmed this player eliminated `victim` */
  confirmKill(d) { this.killBanner(`${d.head ? 'HEADSHOT · ' : ''}ELIMINATED <b>${esc(d.victim)}</b>`); },
  rewardPops(parts) {
    const labels = { kill: 'ELIMINATION', headshot: 'HEADSHOT', knife: 'KNIFE KILL', match: 'MATCH COMPLETE' };
    parts.forEach((p, i) => setTimeout(() => {
      const d = document.createElement('div'); d.className = 'pop' + (p.why === 'streak' ? ' streak' : p.why === 'match' ? ' match' : '');
      d.innerHTML = p.why === 'streak' ? `${p.n} KILL STREAK <b>+${p.hc} ${HC.short}</b>` : `${labels[p.why] || 'REWARD'} <b>+${p.hc} ${HC.short}</b>`;
      this.hc.pops.appendChild(d); setTimeout(() => d.remove(), 2600);
      while (this.hc.pops.children.length > 5) this.hc.pops.firstChild.remove();
    }, i * 220));
  },
  damageNumber(n, head) {
    const d = document.createElement('div'); d.className = 'dn' + (head ? ' hs' : ''); d.textContent = n;
    d.style.left = (Math.random() * 40 - 20 + 26) + 'px'; this.hc.numbers.appendChild(d); setTimeout(() => d.remove(), 900);
    while (this.hc.numbers.children.length > 6) this.hc.numbers.firstChild.remove();
  },
  feedKill(d) {
    const el = document.createElement('div'); el.className = 'fk' + (d.kid === d.me ? ' mine' : d.vid === d.me ? ' mine-d' : '');
    el.innerHTML = `<span class="a" style="color:${playerColor(d.kid)}">${esc(d.killer)}</span><i>${d.w === 'knife' ? '🗡' : '▸'}${d.hs ? '<em>HS</em>' : ''}</i><span class="v" style="color:${playerColor(d.vid)}">${esc(d.victim)}</span>`;
    this.mp.feed.appendChild(el); setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 6500);
    while (this.mp.feed.children.length > 6) this.mp.feed.firstChild.remove();
  },
  setMP(v) {
    this.el.root.classList.toggle('mp', !!v);
    this.mp.root.classList.toggle('hidden', !v);
    if (!v) { this.mp.list.innerHTML = ''; this.mp.feed.innerHTML = ''; this.hc.pops.innerHTML = ''; MP._hudKey = ''; }
    this.refreshHC();
  },
  refreshHC() {
    if (!this.hc || !Profile.data) return;
    this.hc.bank.textContent = HC.fmt(Profile.credits);
    const mp = G.mode === 'mp' && MP.inWorld; this.hc.matchWrap.style.display = mp ? '' : 'none';
    if (mp) this.hc.match.textContent = '+' + HC.fmt(MP.myMatchHC);
  },
  onHitMarker(d) {
    const h = this.el.hit; h.className = 'show' + (d.kill ? ' kill' : d.head ? ' head' : '');
    void h.offsetWidth; clearTimeout(this._hmT); this._hmT = setTimeout(() => (h.className = ''), 70);
  },
  onHit(d) {
    this.el.hurt.style.opacity = String(Math.min(0.9, 0.35 + d.amount / 40)); clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => (this.el.hurt.style.opacity = '0'), 120);
    if (d.angle !== null && d.angle !== undefined) {
      const m = document.createElement('div'); m.className = 'dmg'; m.style.transform = `rotate(${d.angle}rad) translateY(-20px)`;
      this.el.dmg.appendChild(m); setTimeout(() => m.remove(), 1500);
    }
  },

  /** write to the DOM only when a value really changed: the HUD used to rewrite ~50 properties (two via innerHTML) and redraw the compass every
   *  frame, which made the browser restyle / reparse for nothing. C remembers what the page currently shows. */
  update(dt) {
    const E = this.el, P = Player, C = this._c || (this._c = {});
    const txt = (el, k, v) => { if (C[k] !== v) { C[k] = v; el.textContent = v; } };
    const html = (el, k, v) => { if (C[k] !== v) { C[k] = v; el.innerHTML = v; } };
    const sty = (el, k, prop, v) => { if (C[k] !== v) { C[k] = v; el.style[prop] = v; } };
    const cls = (el, k, name, on) => { on = !!on; if (C[k] !== on) { C[k] = on; el.classList.toggle(name, on); } };
    // health
    txt(E.hNum, 'hNum', String(Math.ceil(P.health)));
    sty(E.hFill, 'hFill', 'width', (P.health / P.maxHealth * 100) + '%');
    cls(E.hFill, 'hLow', 'low', P.health < 30);
    sty(E.low, 'low', 'opacity', P.alive ? String(clamp((38 - P.health) / 38, 0, 1) * 0.9) : '0');
    // ammo
    const w = Weapons.hud();
    txt(E.wName, 'wName', w.weapon);
    if (w.rifle) {
      txt(E.mag, 'mag', String(w.mag)); cls(E.mag, 'magLow', 'low', w.mag <= 8 && !w.noReload);
      txt(E.res, 'res', String(w.infinite ? '∞' : w.reserve));
      txt(E.mode, 'mode', (w.semi ? 'SEMI' : 'AUTO') + (w.reloading ? ' · RELOADING' : ''));
      const lit = Math.min(30, w.mag);
      if (C.pips !== lit) { C.pips = lit; for (let i = 0; i < 30; i++) this.pipEls[i].classList.toggle('off', i >= lit); }
      sty(E.pips, 'pipsShow', 'display', '');
    } else { txt(E.mag, 'mag', '—'); txt(E.res, 'res', ''); txt(E.mode, 'mode', Weapons.state === 'melee' ? 'ENGAGED' : 'SILENT'); sty(E.pips, 'pipsShow', 'display', 'none'); cls(E.mag, 'magLow', 'low', false); }
    // reload hint
    let hint = '';
    if (w.rifle && !w.reloading && Weapons.state === 'idle') {
      if (w.mag === 0 && !w.noReload) hint = (w.reserve > 0 || w.infinite) ? 'RELOAD  [R]' : 'NO AMMO';
      else if (w.mag <= 7 && !w.noReload && (w.reserve > 0 || w.infinite)) hint = 'RELOAD  [R]';
    }
    sty(E.reload, 'reloadShow', 'display', hint ? 'block' : 'none'); if (hint) txt(E.reload, 'reloadTxt', hint);
    // prompt
    sty(E.prompt, 'promptShow', 'display', P.prompt ? 'block' : 'none'); if (P.prompt) txt(E.prompt, 'promptTxt', P.prompt);
    // crosshair
    const f = G.renderHeight / (2 * Math.tan(G.camera.fov * DEG / 2)) / (G.renderHeight / window.innerHeight);
    const gap = Math.max(3, Math.tan(Weapons.spread) * f);
    const show = Weapons.current === 'rifle' ? 1 - Viewmodel.adsT * 1.4 : 0.9;
    sty(E.cross, 'crossOp', 'opacity', String(clamp(show, 0, 1)));
    const kids = E.cross.children;
    if (Weapons.current === 'rifle') {
      sty(kids[0], 'k0', 'top', `${-gap - 8}px`); sty(kids[1], 'k1', 'top', `${gap}px`); sty(kids[2], 'k2', 'left', `${-gap - 8}px`); sty(kids[3], 'k3', 'left', `${gap}px`);
      for (let i = 0; i < 4; i++) sty(kids[i], 'kd' + i, 'display', '');
    } else for (let i = 0; i < 4; i++) sty(kids[i], 'kd' + i, 'display', 'none');
    // chips
    const c = G.cheats;
    const key = Object.values(c).join('');
    if (key !== this._chipKey) {
      this._chipKey = key;
      const labels = { god: 'God mode', unlimitedHealth: 'Unlimited health', infiniteAmmo: 'Infinite ammo', noReload: 'No reload', noTarget: 'Ghost', freezeAI: 'AI frozen' };
      E.chips.innerHTML = Object.keys(labels).filter((k) => c[k]).map((k) => `<span>${labels[k]}</span>`).join('');
    }
    // env + score
    html(E.env, 'env', `<b>${Atmos.timeString()}</b> · ${Atmos.weatherType.toUpperCase()}`);
    html(E.score, 'score', `ELIMINATIONS <b>${G.kills}</b> &nbsp; DEATHS <b>${G.deaths}</b>`);
    if (G.mode === 'mp') this.refreshHC();
    // fps
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) {
      G.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0;
      E.fps.textContent = Settings.showFps ? `${Math.round(G.fps)} FPS · ${G.quality.name}${G.gpu ? ' · ' + G.gpu.name : ''}` : '';
    }
    this.drawCompass();
    this._miniT -= dt; if (this._miniT <= 0) { this._miniT = 0.033; this.drawMinimap(); }
  },

  drawCompass() {
    const heading = ((-Player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    if (heading === this._cHeading) return;             // not turning: the canvas already shows this picture
    this._cHeading = heading;
    const c = this.cctx, W = 1040, H = 80;
    c.clearRect(0, 0, W, H);
    const ppd = 5.8;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = -95; d <= 95; d += 5) {
      let deg = Math.round(heading / 5) * 5 + d;
      const x = W / 2 + (deg - heading) * ppd;
      const dd = ((deg % 360) + 360) % 360;
      const major = dd % 45 === 0, mid = dd % 15 === 0;
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = major ? 3 : 2;
      c.beginPath(); c.moveTo(x, major ? 8 : mid ? 14 : 20); c.lineTo(x, 28); c.stroke();
      if (major) {
        const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        c.fillStyle = dd % 90 === 0 ? '#ffb04a' : '#ffffff'; c.font = '600 30px Rajdhani, sans-serif'; c.fillText(names[dd], x, 54);
      } else if (mid) { c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '500 20px Rajdhani, sans-serif'; c.fillText(String(dd), x, 50); }
    }
  },

  bakeMinimap() {
    // hill-shaded top-down map of the whole playable terrain, 2 px per metre
    const S = 896, scale = 2, half = WORLD.half;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S), d = img.data;
    const hs = (x, z) => terrainHeight(x, z);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = i / scale - half, z = j / scale - half;
        const h = hs(x, z), hx = hs(x + 1.2, z) - hs(x - 1.2, z), hz = hs(x, z + 1.2) - hs(x, z - 1.2);
        const shade = clamp(0.62 + (-hx * 0.55 - hz * 0.55) * 0.22, 0.25, 1.15);
        const sp = (Math.abs(x) < half - 1 && Math.abs(z) < half - 1) ? terrainSplat(x, z) : { dirt: 0 };
        const g = [74, 104, 52], dt = [150, 122, 84];
        const t = clamp(sp.dirt, 0, 1);
        const k = (j * S + i) * 4;
        d[k] = (g[0] * (1 - t) + dt[0] * t) * shade; d[k + 1] = (g[1] * (1 - t) + dt[1] * t) * shade; d[k + 2] = (g[2] * (1 - t) + dt[2] * t) * shade; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // buildings
    ctx.fillStyle = 'rgba(210,210,200,0.95)';
    for (const b of LAYOUT.buildings) { ctx.save(); ctx.translate((b.x + half) * scale, (b.z + half) * scale); ctx.rotate(b.rot); ctx.fillRect(-b.w * scale / 2, -b.d * scale / 2, b.w * scale, b.d * scale); ctx.restore(); }
    this.miniBake = c;
  },
  drawMinimap() {
    const c = this.mctx, W = 328, R = W / 2;
    c.clearRect(0, 0, W, W);
    if (!this.miniBake) return;
    const scale = 2, zoom = 1.8 / scale, half = WORLD.half;
    c.save(); c.translate(R, R); c.rotate(Player.yaw);
    c.scale(zoom, zoom);
    c.drawImage(this.miniBake, -(Player.pos.x + half) * scale, -(Player.pos.z + half) * scale);
    // enemies close enough to be heard / seen
    c.restore();
    c.save(); c.translate(R, R);
    const dots = G.mode === 'mp' ? MP.entities().map((e) => { e._hot = performance.now() / 1000 - e.remote.lastFire < 3; return e; }) : Enemies.list;
    for (const e of dots) {
      if (!e.alive) continue;
      const dx = e.pos.x - Player.pos.x, dz = e.pos.z - Player.pos.z, d = Math.hypot(dx, dz);
      if (G.mode === 'mp') { if (d > 85 || !(e._hot || d < 14)) continue; }          // players show up on the map when they shoot, or are very close
      else if (d > 85 || (d > 38 && e.state !== 'combat')) continue;
      const a = Player.yaw, cx = dx * Math.cos(a) - dz * Math.sin(a), cz = dx * Math.sin(a) + dz * Math.cos(a);
      c.fillStyle = G.mode === 'mp' ? (e._hot ? '#ff4a3a' : '#ffb04a') : e.state === 'combat' ? '#ff4a3a' : '#ffb04a';
      c.beginPath(); c.arc(cx * 1.8, cz * 1.8, 5, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5; c.stroke();
    }
    // player arrow
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // vignette ring
    const g = c.createRadialGradient(R, R, R * 0.6, R, R, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  },
};
function keyLabel(code) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Control', 'Ctrl').toUpperCase(); }

/* =============================================================== TOAST */
function toast(text, ms = 1800) {
  const t = $('toast'); t.textContent = text; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), ms);
}

/* ============================================================ CHEAT MENU */
const CheatMenu = {
  tab: 0, focus: 0, rows: [],
  build() {
    const C = G.cheats;
    const seg = (id, label, desc, options, get, set) => ({ type: 'seg', id, label, desc, options, get, set });
    const tog = (id, label, desc, get, set) => ({ type: 'toggle', id, label, desc, get, set });
    const sld = (id, label, desc, min, max, step, get, set, fmt) => ({ type: 'slider', id, label, desc, min, max, step, get, set, fmt });
    const btn = (id, label, desc, text, run) => ({ type: 'button', id, label, desc, text, run });
    this.tabs = [
      { name: 'Player', safe: false, rows: [
        tog('god', 'God mode', 'Completely immune to damage — no hit effects at all.', () => C.god, (v) => (C.god = v)),
        tog('unlimitedHealth', 'Unlimited health', 'Damage still lands (screen flash, sounds) but health is pinned to maximum.', () => C.unlimitedHealth, (v) => (C.unlimitedHealth = v)),
        btn('fullHealth', 'Full health', 'Instantly restore health to 100.', 'RESTORE', () => { Player.health = Player.maxHealth; emit('notify', { text: 'Health restored', kind: 'good' }); }),
        tog('infiniteAmmo', 'Infinite ammo', 'Reserve ammunition never runs out (reloads still animate).', () => C.infiniteAmmo, (v) => (C.infiniteAmmo = v)),
        tog('noReload', 'No reload', 'The magazine never empties — fire forever without reloading.', () => C.noReload, (v) => { C.noReload = v; if (v) { Viewmodel.boltOpen = false; if (Weapons.ammo.mag < 1) Weapons.ammo.mag = 31; } }),
        btn('refill', 'Refill ammo', 'Full magazine plus full reserve.', 'REFILL', () => { Weapons.refillAmmo(); emit('notify', { text: 'Ammo refilled', kind: 'good' }); }),
        tog('noTarget', 'Ghost (enemies ignore me)', 'Soldiers cannot see or hear you.', () => C.noTarget, (v) => (C.noTarget = v)),
      ] },
      { name: 'Environment', safe: false, rows: [
        seg('weather', 'Weather', 'Changes the real sky, fog, lighting, rain, wind and ground wetness.',
          [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['fog', 'Fog'], ['storm', 'Storm']], () => Atmos.weatherType, (v) => Atmos.setWeather(v)),
        sld('intensity', 'Weather intensity', 'Cloud cover, rain strength, fog thickness.', 0.05, 1, 0.01, () => Atmos.intensity, (v) => Atmos.setWeather(Atmos.weatherType, v), (v) => Math.round(v * 100) + '%'),
        seg('preset', 'Time presets', 'Jump straight to a lighting situation.',
          [[6.4, 'Sunrise'], [11.5, 'Day'], [17.7, 'Sunset'], [0.0, 'Midnight']], () => [6.4, 11.5, 17.7, 0].find((x) => { const d = Math.abs(Atmos.hour - x); return Math.min(d, 24 - d) < 0.3; }), (v) => Atmos.setHour(v)),
        sld('hour', 'Time of day', 'Moves the sun and moon across the sky.', 0, 24, 0.05, () => Atmos.hour, (v) => Atmos.setHour(v), (v) => Atmos.timeString()),
        tog('cycle', 'Automatic day / night cycle', 'Let time flow continuously.', () => Atmos.autoCycle, (v) => (Atmos.autoCycle = v)),
        sld('cycleLen', 'Day length', 'Real minutes for a full 24-hour cycle.', 1, 30, 1, () => Atmos.dayLengthMin, (v) => (Atmos.dayLengthMin = v), (v) => v + ' min'),
      ] },
      { name: 'World', safe: false, rows: [
        btn('spawn', 'Spawn soldier', 'Place one hostile soldier ahead of you.', 'SPAWN', () => { const a = Player.yaw, d = 30; const x = Player.pos.x - Math.sin(a) * d, z = Player.pos.z - Math.cos(a) * d; Enemies.spawn(clamp(x, -190, 190), clamp(z, -190, 190)); }),
        btn('killAll', 'Eliminate all soldiers', 'Remove every active enemy (they respawn later). Pays no Hollow Credits.', 'ELIMINATE', () => { for (const e of Enemies.list) if (e.alive) Enemies.damage(e, 999, 'cheat', e.pos, null); }),
        tog('freeze', 'Freeze AI', 'Enemies stop moving and shooting — good for screenshots.', () => C.freezeAI, (v) => (C.freezeAI = v)),
        btn('tp', 'Teleport to spawn hill', 'Return to the start position.', 'TELEPORT', () => { Player.pos.set(LAYOUT.spawn.x, terrainHeight(LAYOUT.spawn.x, LAYOUT.spawn.z), LAYOUT.spawn.z); Player.vel.set(0, 0, 0); }),
        btn('restart', 'Restart mission', 'Reset player, ammo, enemies and clear all effects.', 'RESTART', () => { Game.restart(); }),
      ] },
      { name: 'Graphics', safe: true, rows: [
        btn('rtInfo', 'Ray-marched lighting status', 'Browsers expose no hardware ray-tracing API, so Hollow Ridge ray-marches the depth buffer (screen-space) for reflections, occlusion, bounce light, contact shadows and light shafts.', () => Gfx.statusText(), function () { this.setText(Gfx.statusText()); }),
        seg('rt', 'Ray-marched lighting', 'Master switch for reflections, ambient occlusion / bounce light, contact shadows and light shafts. Auto picks what your GPU can sustain.', Gfx.options.rt, () => Settings.rt, (v) => Gfx.set('rt', v)),
        seg('reflections', 'Reflections', 'Environment probe = sky/ground reflections only. Screen-space RT = ray-marched reflections of the real scene on wet ground, steel and glass.', Gfx.options.reflections, () => Settings.reflections, (v) => Gfx.set('reflections', v)),
        seg('ao', 'Ambient occlusion + bounce light', 'Ray-marched horizon occlusion with one bounce of colour from nearby surfaces.', Gfx.options.ao, () => Settings.ao, (v) => Gfx.set('ao', v)),
        seg('contactShadows', 'Contact shadows', 'Short ray-marched shadows toward the sun that ground props, soldiers and the weapon.', Gfx.options.contactShadows, () => Settings.contactShadows, (v) => Gfx.set('contactShadows', v)),
        seg('volumetric', 'Volumetric light', 'Sun shafts through clouds and trees, atmospheric scattering.', Gfx.options.volumetric, () => Settings.volumetric, (v) => Gfx.set('volumetric', v)),
        seg('shadowQ', 'Shadow quality', 'Shadow-map resolution and softness (Auto follows the quality tier).', Gfx.options.shadowQ, () => Settings.shadowQ, (v) => Gfx.set('shadowQ', v)),
        tog('particlesFx', 'Environment particles', 'Falling leaves, dust and drifting debris.', () => Settings.particlesFx, (v) => Gfx.set('particlesFx', v)),
        tog('flashShadows', 'Flashlight shadows', 'The tactical flashlight casts real shadows (High / Ultra).', () => Settings.flashShadows, (v) => Gfx.set('flashShadows', v)),
      ] },
      { name: 'Settings', safe: true, rows: [
        seg('quality', 'Graphics quality', 'Grass density, shadow resolution, render scale, bloom.', Object.keys(QUALITY).map((k) => [k, QUALITY[k].name]), () => Settings.quality, (v) => Game.applyQuality(v)),
        sld('fov', 'Field of view', 'Horizontal field of view of the world camera.', 70, 120, 1, () => Settings.fov, (v) => { Settings.fov = v; Settings.save(); }, (v) => Math.round(v) + '°'),
        sld('sens', 'Mouse sensitivity', '', 0.2, 3, 0.05, () => Settings.sens, (v) => { Settings.sens = v; Settings.save(); }, (v) => v.toFixed(2)),
        sld('volume', 'Master volume', '', 0, 1, 0.01, () => Settings.volume, (v) => { Settings.volume = v; Settings.save(); Audio3D.setVolume(v); }, (v) => Math.round(v * 100) + '%'),
        sld('bob', 'Camera & weapon bobbing', 'Set to 0 to remove head bob completely.', 0, 1.5, 0.05, () => Settings.bobbing, (v) => { Settings.bobbing = v; Settings.save(); }, (v) => v.toFixed(2)),
        tog('invert', 'Invert Y axis', '', () => Settings.invertY, (v) => { Settings.invertY = v; Settings.save(); }),
        tog('fps', 'Show FPS', '', () => Settings.showFps, (v) => { Settings.showFps = v; Settings.save(); }),
        seg('fpsCap', 'Frame rate limit', 'Display = one frame per screen refresh (smoothest). A lower limit lets the GPU rest between frames: less load, heat and fan noise. Limits that divide your refresh rate evenly look smoothest.',
          [[0, 'Display'], [120, '120'], [90, '90'], [60, '60'], [30, '30']], () => Settings.fpsCap, (v) => { Settings.fpsCap = v; Settings.save(); }),
        tog('adaptive', 'Adaptive quality', 'Lowers quality automatically if the frame rate collapses.', () => Settings.adaptive, (v) => { Settings.adaptive = v; Settings.save(); }),
        btn('menuKey', 'Menu key', 'Click, then press the key you want to open this menu with.', () => keyLabel(Settings.menuKey), function () { Input.bindingMenuKey = true; this.setText('PRESS A KEY…'); }),
      ] },
    ];
    this.el = $('menuCheat');
    this.el.innerHTML = `<div class="panel"><div class="mhead"><h2 id="cmTitle">CHEAT <b>&amp;</b> ENVIRONMENT</h2><div class="tag" id="cmTag">Single-player developer console</div></div>
      <div class="tabs" id="cmTabs"></div><div class="rows" id="cmRows"></div>
      <div class="mfoot"><span><b>↑ ↓</b> select &nbsp; <b>← →</b> adjust &nbsp; <b>ENTER</b> toggle</span><span><b>TAB</b> / <b>Q E</b> switch tab</span><span><b id="cmKey">${keyLabel(Settings.menuKey)}</b> or <b>ESC</b> close</span></div></div>`;
    this.tabsEl = $('cmTabs'); this.rowsEl = $('cmRows');
    this.tabs.forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'tab'; d.textContent = t.name;
      d.addEventListener('click', () => { this.setTab(i); Audio3D.uiClick(); }); this.tabsEl.appendChild(d); t.tabEl = d;
    });
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    on('keydown', (e) => this.onKey(e));
    on('menuKeyBound', () => { $('cmKey').textContent = keyLabel(Settings.menuKey); if (this.open_) this.refresh(); });
    on('weather', () => { if (this.open_) this.refresh(); });
    this.setTab(0, true);
  },

  /** multiplayer + the main menu only get the safe tabs (no cheats, no weather/time changes) */
  applyMode() {
    const lim = G.mode === 'mp' || G.state === 'menu';
    this.tabs.forEach((t) => { t.hidden = lim && !t.safe; t.tabEl.style.display = t.hidden ? 'none' : ''; });
    $('cmTitle').innerHTML = lim ? 'GRAPHICS <b>&amp;</b> SETTINGS' : 'CHEAT <b>&amp;</b> ENVIRONMENT';
    $('cmTag').textContent = G.mode === 'mp' ? 'Multiplayer — cheats and world changes are disabled' : lim ? 'Graphics and controls' : 'Single-player developer console';
    if (this.tabs[this.tab].hidden) this.setTab(this.tabs.findIndex((t) => !t.hidden));
  },
  setTab(i, quiet, dir = 1) {
    const n = this.tabs.length; i = (i + n) % n;
    for (let k = 0; k < n && this.tabs[i].hidden; k++) i = (i + dir + n) % n;
    this.tab = i; this.focus = 0;
    this.tabs.forEach((t, k) => t.tabEl.classList.toggle('active', k === this.tab));
    this.renderRows();
  },
  renderRows() {
    const tab = this.tabs[this.tab];
    this.rowsEl.innerHTML = ''; this.rows = [];
    tab.rows.forEach((r, idx) => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div><div class="lab">${r.label}</div>${r.desc ? `<div class="desc">${r.desc}</div>` : ''}</div><div class="ctl"></div>`;
      const ctl = row.querySelector('.ctl');
      const rec = { def: r, el: row, ctl };
      if (r.type === 'toggle') {
        ctl.innerHTML = `<span class="state"></span><div class="switch"></div>`;
        row.addEventListener('click', () => this.activate(idx));
      } else if (r.type === 'seg') {
        const s = document.createElement('div'); s.className = 'seg';
        r.options.forEach(([val, name]) => { const b = document.createElement('button'); b.textContent = name; b.addEventListener('click', (e) => { e.stopPropagation(); this.focus = idx; r.set(val); Audio3D.uiClick(); this.refresh(); }); s.appendChild(b); });
        ctl.appendChild(s); rec.seg = s;
      } else if (r.type === 'slider') {
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = r.min; inp.max = r.max; inp.step = r.step;
        const val = document.createElement('span'); val.className = 'val';
        inp.addEventListener('input', () => { r.set(parseFloat(inp.value)); val.textContent = r.fmt ? r.fmt(parseFloat(inp.value)) : inp.value; });
        inp.addEventListener('mousedown', () => { this.focus = idx; this.refreshFocus(); });
        ctl.append(inp, val); rec.inp = inp; rec.val = val;
      } else if (r.type === 'button') {
        const b = document.createElement('button'); b.className = 'btn';
        rec.setText = (t) => (b.textContent = t);
        b.addEventListener('click', (e) => { e.stopPropagation(); this.focus = idx; this.activate(idx); });
        ctl.appendChild(b); rec.btn = b;
        row.addEventListener('click', () => { this.focus = idx; this.activate(idx); });
      }
      row.addEventListener('mouseenter', () => { this.focus = idx; this.refreshFocus(); });
      this.rowsEl.appendChild(row); this.rows.push(rec);
    });
    this.refresh();
  },
  refresh() {
    for (const rec of this.rows) {
      const r = rec.def;
      if (r.type === 'toggle') { const on = !!r.get(); rec.ctl.querySelector('.switch').classList.toggle('on', on); const st = rec.ctl.querySelector('.state'); st.textContent = on ? 'ON' : 'OFF'; st.classList.toggle('on', on); }
      else if (r.type === 'seg') { const cur = r.get(); Array.from(rec.seg.children).forEach((b, i) => b.classList.toggle('on', r.options[i][0] === cur)); }
      else if (r.type === 'slider') { const v = r.get(); if (document.activeElement !== rec.inp) rec.inp.value = v; rec.val.textContent = r.fmt ? r.fmt(v) : v; }
      else if (r.type === 'button') { rec.btn.textContent = typeof r.text === 'function' ? r.text() : r.text; }
    }
    this.refreshFocus();
  },
  refreshFocus() { this.rows.forEach((rec, i) => rec.el.classList.toggle('focus', i === this.focus)); },
  activate(idx) {
    const rec = this.rows[idx]; if (!rec) return; const r = rec.def;
    if (r.type === 'toggle') { r.set(!r.get()); Audio3D.uiToggle(r.get()); }
    else if (r.type === 'button') { Audio3D.uiClick(); r.run.call(rec); }
    else if (r.type === 'seg') { const cur = r.options.findIndex((o) => o[0] === r.get()); r.set(r.options[(cur + 1) % r.options.length][0]); Audio3D.uiClick(); }
    this.refresh();
  },
  adjust(idx, dir) {
    const rec = this.rows[idx]; if (!rec) return; const r = rec.def;
    if (r.type === 'slider') {
      const v = clamp(r.get() + dir * r.step * Math.max(1, Math.round((r.max - r.min) / r.step / 40)), r.min, r.max); r.set(v); Audio3D.uiClick(); this.refresh();
    } else if (r.type === 'seg') {
      const cur = Math.max(0, r.options.findIndex((o) => o[0] === r.get()));
      r.set(r.options[(cur + dir + r.options.length) % r.options.length][0]); Audio3D.uiClick(); this.refresh();
    } else if (r.type === 'toggle') { r.set(dir > 0); Audio3D.uiToggle(dir > 0); this.refresh(); }
  },

  onKey(e) {
    if (G.state !== 'playing' && G.state !== 'dead' && !(G.state === 'menu' && this.open_)) return;
    if (e.code === Settings.menuKey || e.code === 'F1') { if (!Input.bindingMenuKey && G.state !== 'menu') { if (this.open_) this.close(); else this.open(); } return; }
    if (!this.open_) return;
    switch (e.code) {
      case 'Escape': this.close(); break;
      case 'ArrowDown': this.focus = (this.focus + 1) % this.rows.length; this.refreshFocus(); Audio3D.uiClick(); this.scrollFocus(); break;
      case 'ArrowUp': this.focus = (this.focus - 1 + this.rows.length) % this.rows.length; this.refreshFocus(); Audio3D.uiClick(); this.scrollFocus(); break;
      case 'ArrowRight': this.adjust(this.focus, 1); break;
      case 'ArrowLeft': this.adjust(this.focus, -1); break;
      case 'Enter': case 'Space': this.activate(this.focus); break;
      case 'Tab': { const d = Input.key('ShiftLeft') ? -1 : 1; this.setTab(this.tab + d, false, d); Audio3D.uiClick(); break; }
      case 'KeyE': case 'BracketRight': this.setTab(this.tab + 1, false, 1); Audio3D.uiClick(); break;
      case 'KeyQ': case 'BracketLeft': this.setTab(this.tab - 1, false, -1); Audio3D.uiClick(); break;
    }
  },
  scrollFocus() { const r = this.rows[this.focus]; if (r) r.el.scrollIntoView({ block: 'nearest' }); },

  open() {
    if (this.open_) return;
    this.applyMode();
    if (!G.menuOpen) { G.menuOpen = true; }
    this.open_ = true; Game.updatePause();
    this.el.classList.remove('hidden'); this.refresh();
    Audio3D.uiToggle(true);
  },
  close() {
    if (!this.open_) return;
    this.open_ = false; G.menuOpen = false; this.el.classList.add('hidden');
    Audio3D.uiToggle(false); Game.updatePause(true);
  },
};

/* ============================================================ PAUSE MENU */
const PauseMenu = {
  build() { this.el = $('menuPause'); this.render(); },
  render() {
    const mp = G.mode === 'mp';
    this.el.innerHTML = `<div class="panel"><h2>${mp ? 'MATCH MENU' : 'PAUSED'}</h2><p>${mp ? 'The match keeps running while this is open' : 'Hollow Ridge · sector D'}</p>
      <button class="btn" id="pmResume">Resume</button>
      <button class="btn" id="pmShop">Weapon shop <span class="pmHc">${HC.fmt(Profile.credits)} ${HC.short}</span></button>
      ${mp ? '' : '<button class="btn" id="pmCheat">Cheat &amp; environment menu</button>'}
      <button class="btn" id="pmSettings">${mp ? 'Graphics &amp; settings' : 'Graphics &amp; settings'}</button>
      ${mp ? '' : '<button class="btn" id="pmRestart">Restart mission</button>'}
      <button class="btn danger" id="pmQuit">${mp ? 'Leave match' : 'Quit to main menu'}</button></div>`;
    $('pmResume').addEventListener('click', () => Game.resume());
    $('pmShop').addEventListener('click', () => { this.hide(); Shop.open({ from: 'pause' }); });
    const cheat = $('pmCheat'); if (cheat) cheat.addEventListener('click', () => { this.hide(); CheatMenu.setTab(1); CheatMenu.open(); });
    $('pmSettings').addEventListener('click', () => { this.hide(); CheatMenu.setTab(CheatMenu.tabs.findIndex((t) => t.name === 'Graphics')); CheatMenu.open(); });
    const rs = $('pmRestart'); if (rs) rs.addEventListener('click', () => { Game.restart(); Game.resume(); });
    $('pmQuit').addEventListener('click', () => { this.hide(); if (G.mode === 'mp') MP.leave(); else Game.exitToMenu(); });
  },
  show() { this.render(); G.pauseMenuOpen = true; this.el.classList.remove('hidden'); },
  hide() { G.pauseMenuOpen = false; this.el.classList.add('hidden'); },
};

/* ============================================================ LOADING UI */
const Loading = {
  tips: [
    'Press <b>F1</b> to open the cheat &amp; environment menu — change weather, time of day, ammo and health on the fly.',
    'Hold <b>right mouse</b> to aim down sights. The holographic reticle is collimated — it stays on target as you move your head.',
    'A tactical reload keeps the chambered round: 30 in the magazine + 1 in the chamber. An empty reload ends with a charging-handle rack.',
    'The combat knife is silent. <b>Left click</b> slashes; <b>right click</b> lunges with a heavy stab.',
    'Crouch with <b>C</b> to shrink your profile — soldiers spot a crouching target from much less distance.',
    'Rain, fog and darkness reduce how far enemies can see you. Night patrols rely on hearing more than sight.',
    'Walk through the tall grass: it bends around you — and around every soldier that crosses it.',
    'Step up to the supply crate on the hill and press <b>E</b> to restore ammo and health.',
    'Gunfire carries. Shooting alerts every soldier within about 125 metres.',
    'Press <b>B</b> to switch between full-auto and semi-auto fire.',
    'Press <b>V</b> to inspect your weapon — and show off the camouflage you bought in the Weapon Shop.',
    'Earn <b>Hollow Credits (HC)</b> for every elimination; kill streaks of 3 and 5 pay bonuses. Spend them on camos in the shop.',
    'Multiplayer: one PC runs <b>Host-LAN-Game.bat</b>, everyone else joins its IP address on the same Wi-Fi. Real players only — no bots.',
    'Hold <b>Tab</b> in a multiplayer match for the full scoreboard.',
  ],
  tipIdx: 0, progress: 0, target: 0, t0: performance.now(), running: true,
  init() {
    this.canvas = $('loadCanvas'); this.ctx = this.canvas.getContext('2d');
    this.fill = $('loadBarFill'); this.pct = $('loadPct'); this.status = $('loadStatus'); this.tip = $('loadTip');
    this.resize(); window.addEventListener('resize', () => this.resize());
    this.setTip();
    this._tipTimer = setInterval(() => this.setTip(), 5200);
    this.rng = mulberry32(11);
    this.clouds = Array.from({ length: 16 }, () => this.makeCloud());
    this.blades = Array.from({ length: 340 }, () => ({ x: this.rng(), y: 0.72 + this.rng() * 0.3, h: 0.16 + this.rng() * 0.3, w: 0.004 + this.rng() * 0.006, ph: this.rng() * 6.28, tone: this.rng(), lean: (this.rng() - 0.5) * 0.12 }));
    this.motes = Array.from({ length: 60 }, () => ({ x: this.rng(), y: this.rng(), s: 1 + this.rng() * 2.5, v: 0.01 + this.rng() * 0.03, a: 0.2 + this.rng() * 0.5 }));
    const loop = () => { if (!this.running) return; this.draw((performance.now() - this.t0) / 1000); this._raf = requestAnimationFrame(loop); };
    loop();
  },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = this.canvas.width = Math.max(2, Math.floor(window.innerWidth * dpr)); this.H = this.canvas.height = Math.max(2, Math.floor(window.innerHeight * dpr));
    this.bg = null;
  },
  setTip() {
    this.tip.style.opacity = '0';
    setTimeout(() => { this.tip.innerHTML = `<small>FIELD NOTE ${this.tipIdx % this.tips.length + 1} / ${this.tips.length}</small>${this.tips[this.tipIdx % this.tips.length]}`; this.tipIdx++; this.tip.style.opacity = '1'; }, 450);
  },
  setProgress(p, label) {
    this.target = clamp(p, 0, 1);
    this.fill.style.width = (this.target * 100).toFixed(1) + '%';
    this.pct.textContent = Math.round(this.target * 100) + '%';
    if (label) this.status.textContent = label;
  },
  /** loading finished: fade the splash out and hand over to the main menu */
  finish(cb) {
    this.setProgress(1, 'Ready');
    setTimeout(() => { this.hide(); cb && cb(); }, 450);
  },
  ready(onStart) {
    this.setProgress(1, 'Ready');
    const b = $('loadStart'); b.style.display = 'inline-flex';
    const go = () => { b.removeEventListener('click', go); window.removeEventListener('keydown', kd); onStart(); };
    const kd = (e) => { if (e.code === 'F5' || e.code === 'F12') return; go(); };
    b.addEventListener('click', go); setTimeout(() => window.addEventListener('keydown', kd), 300);
  },
  hide() {
    const el = $('loading'); el.classList.add('fadeout');
    setTimeout(() => { el.classList.add('hidden'); this.running = false; clearInterval(this._tipTimer); cancelAnimationFrame(this._raf); }, 1200);
  },
  error(msg) { const e = $('loadErr'); e.style.display = 'block'; e.textContent = 'Failed to start:\n' + msg; },

  makeCloud() {
    const r = this.rng;
    const w = 300 + r() * 520, h = w * (0.28 + r() * 0.12);
    const c = makeCanvas(Math.ceil(w), Math.ceil(h)), x = c.getContext('2d');
    const n = 14 + Math.floor(r() * 12);
    for (let i = 0; i < n; i++) {
      const cx = (0.18 + r() * 0.64) * w, cy = h * (0.55 + (r() - 0.5) * 0.25) - Math.sin((cx / w) * Math.PI) * h * 0.14;
      const rad = Math.max(8, Math.min(h * (0.16 + r() * 0.2), cx - 2, w - cx - 2, cy - 2, h - cy - 2));
      const g = x.createRadialGradient(cx, cy - rad * 0.2, rad * 0.1, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(238,244,252,0.8)'); g.addColorStop(1, 'rgba(190,206,228,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, TAU); x.fill();
    }
    // shaded underside
    x.globalCompositeOperation = 'source-atop';
    const sg = x.createLinearGradient(0, 0, 0, h); sg.addColorStop(0.45, 'rgba(120,150,190,0)'); sg.addColorStop(1, 'rgba(110,135,175,0.55)');
    x.fillStyle = sg; x.fillRect(0, 0, w, h);
    return { c, x: r(), y: 0.05 + r() * 0.42, speed: 0.004 + r() * 0.012, s: 0.6 + r() * 0.9, a: 0.55 + r() * 0.45 };
  },
  drawBackground() {
    const W = this.W, H = this.H;
    const c = makeCanvas(W, H), x = c.getContext('2d');
    // sky
    const sky = x.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, '#1b4f9c'); sky.addColorStop(0.45, '#4a8cd8'); sky.addColorStop(1, '#bddaf3');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    // sun glare
    const sx = W * 0.2, sy = H * 0.16;
    const g1 = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.9); g1.addColorStop(0, 'rgba(255,252,235,1)'); g1.addColorStop(0.04, 'rgba(255,248,215,.95)'); g1.addColorStop(0.2, 'rgba(255,240,200,.38)'); g1.addColorStop(1, 'rgba(255,240,200,0)');
    x.fillStyle = g1; x.fillRect(0, 0, W, H);
    // distant mountains (3 layers with haze)
    const r = mulberry32(5);
    const ridge = (base, amp, col, freq, seed) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= 120; i++) { const px = i / 120 * W; x.lineTo(px, H * base - (Noise.ridged(i * freq + seed, seed * 3.1, 4) - 0.35) * amp * H); }
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    ridge(0.55, 0.28, 'rgba(150,176,212,0.85)', 0.035, 2.1);
    ridge(0.60, 0.20, 'rgba(112,142,178,0.9)', 0.05, 7.7);
    ridge(0.645, 0.12, 'rgba(78,112,128,0.95)', 0.07, 12.3);
    // forested hills
    const hill = (base, amp, col, seed, trees) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
      const pts = [];
      for (let i = 0; i <= 140; i++) { const px = i / 140 * W, py = H * base - Noise.fbm(i * 0.03 + seed, seed, 3) * amp * H; pts.push([px, py]); x.lineTo(px, py); }
      x.lineTo(W, H); x.closePath(); x.fill();
      for (let i = 0; i < trees; i++) {
        const p = pts[Math.floor(r() * pts.length)], sz = H * (0.02 + r() * 0.035);
        x.fillStyle = `rgba(${28 + r() * 20},${52 + r() * 30},${28 + r() * 14},0.95)`;
        x.beginPath(); x.ellipse(p[0], p[1] - sz * 0.35, sz * 0.8, sz, 0, 0, TAU); x.fill();
        x.fillStyle = 'rgba(60,45,30,.9)'; x.fillRect(p[0] - 1.5, p[1] - sz * 0.2, 3, sz * 0.4);
      }
    };
    hill(0.70, 0.07, '#4e7a40', 3.3, 60);
    hill(0.76, 0.08, '#3f6b33', 9.1, 28);
    // earthwork + dirt mound like the reference
    x.fillStyle = '#6d5a43'; x.beginPath(); x.moveTo(W * 0.38, H * 0.8);
    x.bezierCurveTo(W * 0.5, H * 0.755, W * 0.62, H * 0.77, W * 0.82, H * 0.805); x.lineTo(W * 0.82, H * 0.84); x.lineTo(W * 0.38, H * 0.84); x.fill();
    const mg = x.createLinearGradient(0, H * 0.76, 0, H * 0.84); mg.addColorStop(0, 'rgba(255,230,190,.25)'); mg.addColorStop(1, 'rgba(0,0,0,.2)');
    x.fillStyle = mg; x.fillRect(W * 0.38, H * 0.76, W * 0.44, H * 0.08);
    hill(0.86, 0.06, '#32592a', 14.4, 0);
    // atmospheric haze at the horizon
    const hz = x.createLinearGradient(0, H * 0.45, 0, H * 0.82); hz.addColorStop(0, 'rgba(210,228,245,0)'); hz.addColorStop(0.6, 'rgba(210,228,245,.28)'); hz.addColorStop(1, 'rgba(210,228,245,0)');
    x.fillStyle = hz; x.fillRect(0, H * 0.45, W, H * 0.4);
    this.bg = c;
  },
  draw(t) {
    const x = this.ctx, W = this.W, H = this.H;
    if (!this.bg) this.drawBackground();
    x.drawImage(this.bg, 0, 0);
    // drifting clouds (parallax)
    for (const cl of this.clouds) {
      const sc = cl.s * (W / 1600) * 1.15, w = cl.c.width * sc, h = cl.c.height * sc;
      const px = ((cl.x * (W + w * 2) + t * cl.speed * W * 0.6) % (W + w * 2)) - w;
      x.globalAlpha = cl.a; x.drawImage(cl.c, px, cl.y * H - h * 0.5, w, h);
    }
    x.globalAlpha = 1;
    // a jet crossing the sky now and then
    const jp = (t % 38) / 38;
    if (jp < 0.55) { const jx = (jp / 0.55) * (W * 1.2) - W * 0.1, jy = H * 0.2 + Math.sin(jp * 5) * 4; this.drawJet(x, jx, jy, H * 0.0125); }
    // sun shafts
    x.globalCompositeOperation = 'lighter';
    const sg = x.createRadialGradient(W * 0.2, H * 0.16, 0, W * 0.2, H * 0.16, H * 0.55); sg.addColorStop(0, 'rgba(255,240,200,' + (0.25 + 0.05 * Math.sin(t * 0.7)) + ')'); sg.addColorStop(1, 'rgba(255,240,200,0)');
    x.fillStyle = sg; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
    // grass
    const wind = (xx) => Math.sin(t * 1.25 + xx * 6.0) * 0.5 + Math.sin(t * 0.55 + xx * 2.4) * 0.5;
    for (const b of this.blades) {
      const bx = b.x * W, by = b.y * H, bh = b.h * H, bw = b.w * W;
      const sway = (wind(b.x) * 0.5 + b.lean) * bh * 0.55 * (1 + b.y * 0.2);
      const gr = x.createLinearGradient(bx, by, bx + sway, by - bh);
      gr.addColorStop(0, `rgb(${18 + b.tone * 12},${40 + b.tone * 18},${12})`); gr.addColorStop(0.6, `rgb(${60 + b.tone * 50},${104 + b.tone * 36},${26})`); gr.addColorStop(1, `rgb(${150 + b.tone * 60},${170 + b.tone * 40},${60})`);
      x.fillStyle = gr; x.beginPath();
      x.moveTo(bx - bw, by); x.quadraticCurveTo(bx - bw * 0.5 + sway * 0.25, by - bh * 0.55, bx + sway, by - bh);
      x.quadraticCurveTo(bx + bw * 0.5 + sway * 0.35, by - bh * 0.5, bx + bw, by); x.closePath(); x.fill();
    }
    // dust motes
    for (const m of this.motes) {
      const px = ((m.x + t * m.v * 0.5) % 1) * W, py = ((m.y - t * m.v * 0.35) % 1 + 1) % 1 * H;
      x.fillStyle = `rgba(255,248,220,${m.a * (0.5 + 0.5 * Math.sin(t * 1.5 + m.x * 30))})`; x.beginPath(); x.arc(px, py, m.s, 0, TAU); x.fill();
    }
  },
  drawJet(x, px, py, s) {
    x.save(); x.translate(px, py); x.scale(s, s); x.fillStyle = 'rgba(30,38,50,.85)';
    x.beginPath(); x.moveTo(-14, 0); x.lineTo(-4, -1.2); x.lineTo(2, -5.5); x.lineTo(4, -5.5); x.lineTo(3, -1); x.lineTo(14, -0.4); x.lineTo(14, 0.6); x.lineTo(3, 1.2); x.lineTo(4, 5.5); x.lineTo(2, 5.5); x.lineTo(-4, 1.2); x.lineTo(-11, 2.4); x.lineTo(-13, 0); x.closePath(); x.fill();
    x.restore();
  },
};
