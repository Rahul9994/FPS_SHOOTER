/* =====================================================================
 *  HOLLOW RIDGE  -  92-shop.js
 *  Weapon shop: browse / preview / purchase / equip camouflage.
 *  The 3D preview renders a real AR-M4 with the selected finish into an
 *  off-screen target on the game's own renderer (no second GL context) and
 *  blits it into a canvas inside the shop panel.
 * ===================================================================== */

const PV_LIGHTS = {
  studio: { env: 'room', envI: 0.9, key: [0xffffff, 2.4, [1.6, 2.0, 2.2]], rim: [0x9fc4ff, 1.4, [-2.2, 1.0, -1.6]], fill: [0xffe9d0, 0.5, [-1.5, -0.4, 1.6]], exposure: 1.0, label: 'Studio' },
  day:    { env: 'sky', envI: 1.15, key: [0xfff1d8, 4.4, [2.2, 3.0, 1.2]], rim: [0xbcd6ff, 0.8, [-2, 1, -2]], fill: [0xdfe8ff, 0.15, [-1.5, 0.2, 1.5]], exposure: 0.9, label: 'Daylight' },
  dusk:   { env: 'room', envI: 0.35, key: [0xff9a4a, 3.6, [-2.4, 0.5, 1.8]], rim: [0x6a7cff, 1.2, [2.2, 1.2, -1.6]], fill: [0xff7a3a, 0.35, [1.2, -0.6, 1.4]], exposure: 1.15, label: 'Dusk' },
  night:  { env: 'room', envI: 0.07, key: [0x6f8bff, 1.5, [1.4, 2.2, 1.6]], rim: [0x3a4a88, 0.9, [-2, 1, -1.5]], fill: [0xffffff, 0.0, [0, 0, 1]], torch: true, exposure: 1.9, label: 'Night' },
};

class Preview3D {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(26, 16 / 10, 0.05, 12);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.rifle = buildRifle(); this.rifle.root.position.set(0, 0.01, 0.13);
    this.rifle.mags[1].visible = false;
    this.pivot.add(this.rifle.root);
    // little display plinth so the reflections have something to bounce off
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.012, 48), new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.85, metalness: 0, envMapIntensity: 0.3 }));
    plate.position.y = -0.2; this.scene.add(plate);
    this.key = new THREE.DirectionalLight(0xffffff, 2); this.rim = new THREE.DirectionalLight(0xffffff, 1); this.fill = new THREE.DirectionalLight(0xffffff, 0.3);
    this.torch = new THREE.SpotLight(0xfff0d8, 0, 4, 0.38, 0.7, 1.4); this.torch.position.set(0.5, 0.35, 1.2); this.torch.target.position.set(0, 0, 0);
    this.scene.add(this.key, this.rim, this.fill, this.torch, this.torch.target);
    this.cam.position.set(0, 0.07, 1.42); this.cam.lookAt(0, -0.005, 0);
    this.yaw = -0.5; this.pitch = 0.12; this.vyaw = 0; this.idle = 0; this.dragging = false; this.mode = 'studio'; this.acc = 0;
    this.w = 0; this.h = 0;
    this.outPass = new OutputPass();
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!this.dragging) return; this.vyaw = (e.clientX - this.lx) * 0.012; this.yaw += this.vyaw; this.pitch = clamp(this.pitch + (e.clientY - this.ly) * 0.006, -0.9, 1.0); this.lx = e.clientX; this.ly = e.clientY; this.idle = 0; });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.position.z = clamp(this.cam.position.z + e.deltaY * 0.0012, 0.75, 2.2); }, { passive: false });
    this.setLighting('studio');
  }
  size() {
    const r = this.canvas.getBoundingClientRect(), w = Math.max(64, Math.round(r.width)), h = Math.max(64, Math.round(r.height));
    if (w === this.w && h === this.h) return w > 0;
    this.w = w; this.h = h; this.canvas.width = w; this.canvas.height = h;
    if (this.rt) { this.rt.dispose(); this.out.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace });
    this.out = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.LinearSRGBColorSpace });
    this.buf = new Uint8Array(w * h * 4); this.img = new ImageData(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    return true;
  }
  envFor(kind) {
    if (kind === 'sky' && Atmos.envRT) return Atmos.envRT.texture;
    if (!this._room) { const pm = new THREE.PMREMGenerator(renderer); this._room = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    return this._room;
  }
  setLighting(mode) {
    const L = PV_LIGHTS[mode]; if (!L) return; this.mode = mode;
    this.scene.environment = this.envFor(L.env); this.scene.environmentIntensity = L.envI;
    for (const [light, spec] of [[this.key, L.key], [this.rim, L.rim], [this.fill, L.fill]]) { light.color.set(spec[0]); light.intensity = spec[1]; light.position.set(...spec[2]); }
    this.torch.intensity = L.torch ? 38 : 0; this.exposure = L.exposure;
  }
  setCamo(id) { Camo.applyToObject(this.rifle.root, id, 512); }
  reset() { this.yaw = -0.5; this.pitch = 0.12; this.cam.position.z = 1.42; this.idle = 0; }
  render(dt) {
    if (!this.size() || !renderer) return;
    this.idle += dt;
    if (!this.dragging) { if (this.idle > 1.2) this.yaw += dt * 0.35; else this.yaw += this.vyaw * 0.9; this.vyaw *= 0.92; }
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const prevTM = renderer.toneMappingExposure, prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.toneMappingExposure = this.exposure; renderer.autoClear = true;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.render(this.scene, this.cam);
    this.outPass.render(renderer, this.out, this.rt);
    renderer.readRenderTargetPixels(this.out, 0, 0, this.w, this.h, this.buf);
    renderer.setRenderTarget(prevRT); renderer.toneMappingExposure = prevTM; renderer.autoClear = prevAuto; renderer.setClearColor(0x000000, 1);
    // flip rows (GL origin is bottom-left) into the canvas
    const row = this.w * 4, dst = this.img.data;
    for (let y = 0; y < this.h; y++) dst.set(this.buf.subarray((this.h - 1 - y) * row, (this.h - y) * row), y * row);
    this.ctx.putImageData(this.img, 0, 0);
  }
  dispose() { if (this.rt) { this.rt.dispose(); this.out.dispose(); } }
}

const Shop = {
  isOpen: false, root: null, from: 'main', sel: 'woodland', filter: 'all', preview: null, _acc: 0, _msgT: 0,

  init(menuRoot) {
    const r = this.root = document.createElement('div'); r.id = 'scShop'; r.className = 'screen pScreen menuDim';
    r.innerHTML = `
      <div class="mpPanel" style="width:min(1120px,97vw)">
        <div class="mpHead"><h2>WEAPON <b>SHOP</b></h2><div style="display:flex;align-items:center;gap:16px"><div class="tag">Cosmetic only · no combat advantage</div><div class="hcBadge"><span id="shBank">0</span><small>HC</small></div></div></div>
        <div class="mpBody">
          <div class="shopWrap">
            <div class="shopLeft"><div class="rtabs" id="shTabs"></div><div class="camoGrid" id="shGrid"></div></div>
            <div class="shopRight">
              <div class="pvBox"><canvas id="shCanvas"></canvas><div class="pvLight" id="shLight"></div><div class="pvHint">Drag to rotate · wheel to zoom</div></div>
              <div class="pvInfo" id="shInfo"></div>
              <div class="buyRow"><div class="price" id="shPrice"></div><button class="btn big green" id="shBuy">Purchase</button><button class="btn big" id="shEquip">Equip</button><button class="btn ghost" id="shReset">Reset view</button></div>
              <div class="msgBar" id="shMsg">Select a finish to preview it on the AR-M4.</div>
            </div>
          </div>
        </div>
        <div class="mpFoot"><button class="btn ghost" id="shBack">‹ Back</button><div style="font-size:12px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase">Earn Hollow Credits: ${CONFIG.economy.rewards.kill} HC per elimination · streak bonuses at 3 and 5 · ${CONFIG.economy.rewards.matchComplete} HC for completing a multiplayer match</div></div>
      </div>`;
    menuRoot.appendChild(r);
    // rarity tabs
    const tabs = r.querySelector('#shTabs');
    tabs.innerHTML = [['all', 'All'], ...Object.keys(RARITY).map((k) => [k, RARITY[k].name])].map(([k, n]) => `<button class="rtab${k === 'all' ? ' on' : ''}" data-f="${k}">${n}</button>`).join('');
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; this.filter = b.dataset.f; tabs.querySelectorAll('.rtab').forEach((t) => t.classList.toggle('on', t === b)); Audio3D.uiClick(); this.renderGrid(); });
    r.querySelector('#shGrid').addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c) { this.select(c.dataset.id); Audio3D.uiClick(); } });
    r.querySelector('#shLight').innerHTML = Object.entries(PV_LIGHTS).map(([k, v]) => `<button data-l="${k}"${k === 'studio' ? ' class="on"' : ''}>${v.label}</button>`).join('');
    r.querySelector('#shLight').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b || !this.preview) return; this.preview.setLighting(b.dataset.l); r.querySelectorAll('#shLight button').forEach((x) => x.classList.toggle('on', x === b)); Audio3D.uiClick(); });
    r.querySelector('#shBuy').addEventListener('click', () => this.buy());
    r.querySelector('#shEquip').addEventListener('click', () => this.equip());
    r.querySelector('#shReset').addEventListener('click', () => this.preview && this.preview.reset());
    r.querySelector('#shBack').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (this.isOpen && e.code === 'Escape') { e.preventDefault(); this.close(); } });
    on('profile', () => { if (this.isOpen) this.refresh(); });
  },

  open({ from } = {}) {
    this.from = from || 'main';
    for (const el of Object.values(Menus.screens)) el.classList.remove('on');
    this.root.classList.add('on'); this.isOpen = true;
    G.uiOpen = G.state !== 'menu'; if (G.state !== 'menu') Game.updatePause();
    if (!this.preview) {
      try { this.preview = new Preview3D(this.root.querySelector('#shCanvas')); }
      catch (e) { console.warn('shop preview unavailable', e); this.root.querySelector('.pvBox').innerHTML = '<div style="padding:30px;color:var(--dim)">3D preview unavailable on this GPU — swatches still work.</div>'; }
    }
    if (!this._bakedSwatches) { this._bakedSwatches = true; this.bakeSwatches(); }
    if (!CAMO_BY_ID[this.sel]) this.sel = 'woodland';
    this.refresh(); this.select(Profile.equipped === 'factory' ? this.sel : Profile.equipped, true);
    this.setMsg('Select a finish to preview it on the AR-M4. Drag the weapon to inspect it from every side.', '');
  },
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.classList.remove('on'); Audio3D.uiClick();
    switch (this.from) {
      case 'pause': G.uiOpen = false; PauseMenu.show(); Game.updatePause(); break;
      case 'lobby': Menus.show('lobby'); break;
      case 'results': Menus.show('results'); break;
      default: Menus.openMain();
    }
  },

  bakeSwatches() {
    const ids = CAMO_DEFS.map((d) => d.id); let i = 0;
    const step = () => { if (i >= ids.length) return; const id = ids[i++]; try { Camo.swatch(id, 148); } catch (e) { /* ignore */ } if (this.isOpen) this.renderGrid(); setTimeout(step, 24); };
    setTimeout(step, 30);
  },

  list() {
    return CAMO_DEFS.filter((d) => this.filter === 'all' || d.rarity === this.filter).sort((a, b) => RARITY[a.rarity].order - RARITY[b.rarity].order || camoPrice(a) - camoPrice(b));
  },
  renderGrid() {
    const eq = Profile.equipped, grid = this.root.querySelector('#shGrid');
    grid.innerHTML = this.list().map((d) => {
      const owned = Profile.owns(d.id), price = camoPrice(d), R = RARITY[d.rarity];
      const tag = d.id === eq ? '<span class="tag eq">EQUIPPED</span>' : owned ? '<span class="tag own">OWNED</span>' : '<span class="tag lock">LOCKED</span>';
      const sw = Camo.swatchCache[d.id + ':148'];
      return `<button class="camoCard${d.id === this.sel ? ' sel' : ''}" data-id="${d.id}" style="--rc:${R.color}">${tag}${d.animated ? '<span class="anim">ANIMATED</span>' : ''}<div class="img" style="${sw ? `background-image:url(${sw})` : 'background:#1a2024'}"></div><div class="nm">${esc(d.name)}</div><div class="meta"><span class="r">${R.name}</span><span class="p">${owned ? (d.free ? 'FREE' : 'OWNED') : HC.fmt(price) + ' ' + HC.short}</span></div></button>`;
    }).join('');
  },
  refresh() {
    this.root.querySelector('#shBank').textContent = HC.fmt(Profile.credits);
    this.renderGrid(); this.renderInfo();
  },
  select(id, quiet) {
    if (!CAMO_BY_ID[id]) return;
    this.sel = id; this.renderGrid(); this.renderInfo();
    this.setMsg(quiet ? this._lastMsg || '' : 'Preparing finish…', '');
    // painting a finish takes a moment: let the UI repaint first
    clearTimeout(this._selT);
    this._selT = setTimeout(() => { if (!this.isOpen || this.sel !== id) return; if (this.preview) this.preview.setCamo(id); if (!quiet) this.setMsg('', ''); this.preview && this.preview.reset(); }, 30);
  },
  renderInfo() {
    const d = CAMO_BY_ID[this.sel], R = RARITY[d.rarity], owned = Profile.owns(d.id), eq = Profile.equipped === d.id, price = camoPrice(d), can = Profile.credits >= price;
    const bar = (v) => `<div class="bar"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></i></div>`;
    this.root.querySelector('#shInfo').style.setProperty('--rc', R.color);
    this.root.querySelector('#shInfo').innerHTML = `<div class="row1"><h3>${esc(d.name)}</h3><span class="rar">${R.name}</span></div><p>${esc(d.desc)}</p><div class="tags">${esc(d.tags)}${d.animated ? ' · animated' : ''}</div><div class="props"><span>Metallic${bar(d.metal)}</span><span>Gloss${bar(1 - d.rough)}</span><span>Relief${bar(d.bump || 0.1)}</span></div>`;
    const pe = this.root.querySelector('#shPrice'), buy = this.root.querySelector('#shBuy'), eqb = this.root.querySelector('#shEquip');
    pe.innerHTML = d.free ? 'FREE<small>included</small>' : `${HC.fmt(price)}<small>${HC.short}</small>`; pe.style.color = !owned && !can ? 'var(--bad)' : '';
    buy.style.display = owned ? 'none' : ''; buy.textContent = can ? 'Purchase' : 'Purchase';
    eqb.style.display = owned ? '' : 'none'; eqb.disabled = eq; eqb.textContent = eq ? 'Equipped ✓' : 'Equip';
  },
  setMsg(text, kind) { const m = this.root.querySelector('#shMsg'); m.textContent = text || ''; m.className = 'msgBar ' + (kind || ''); if (text) this._lastMsg = text; if (!text) m.textContent = ' '; },
  buy() {
    const d = CAMO_BY_ID[this.sel], res = Profile.purchase(d.id);
    if (res.silent) return;
    if (res.ok) {
      Audio3D.pickup(); this.setMsg(`Purchased ${d.name}! −${HC.fmt(res.price)} ${HC.short} · balance ${HC.fmt(res.balance)} ${HC.short}. Press EQUIP to use it.`, 'ok');
      this.root.querySelector('#shInfo').classList.remove('flashOk'); void this.root.offsetWidth; this.root.querySelector('#shInfo').classList.add('flashOk');
    } else {
      Audio3D.dryFire(); this.setMsg(res.error, 'err');
      const b = this.root.querySelector('#shBuy'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    }
    this.refresh();
  },
  equip() {
    const d = CAMO_BY_ID[this.sel], res = Profile.equip(d.id);
    if (!res.ok) { this.setMsg(res.error, 'err'); return; }
    Audio3D.uiToggle(true);
    this.applyEquipped();
    this.setMsg(`${d.name} equipped.${G.state === 'menu' || !MP.inWorld ? '' : ' Other players see it now.'}`, 'ok');
    this.refresh();
  },
  /** put the equipped finish on the first-person rifle and tell the server (other players see it) */
  applyEquipped() {
    Camo.applyToObject(Viewmodel.rifle.root, Profile.equipped);
    if (MP.active) MP.setCamo(Profile.equipped);
  },
  tick(dt) {
    if (!this.isOpen || !this.preview) return;
    this._acc += dt; if (this._acc < 1 / 30) return; const d = this._acc; this._acc = 0;
    try { this.preview.render(d); } catch (e) { console.warn('preview render failed', e); this.preview = null; this.root.querySelector('.pvBox').innerHTML = '<div style="padding:30px;color:var(--dim)">3D preview unavailable.</div>'; }
  },
};
