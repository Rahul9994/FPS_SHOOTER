/* =====================================================================
 *  HOLLOW RIDGE  -  50-effects.js
 *  Particles, tracers, bullet-hole decals, shell casings, impacts
 * ===================================================================== */

/* ------------------------------------------------------- particle pool */
class ParticlePool {
  constructor(scene, max, texture, additive, lit) {
    this.max = max; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(1); this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.rotSpeed = new Float32Array(max);
    this.aSize = new Float32Array(max); this.aAlpha = new Float32Array(max); this.aColor = new Float32Array(max * 3); this.aRot = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.aRot, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: texture }, uScale: { value: 800 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: lit ? { LIT: 1 } : {},
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aRot;
        uniform float uScale; varying float vA; varying vec3 vC; varying float vR;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 0.0, 380.0);
          vA = aAlpha; vC = aColor; vR = aRot;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 uLight; varying float vA; varying vec3 vC; varying float vR;
        void main(){
          vec2 uv = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR);
          uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
          vec4 t = texture2D(map, uv);
          vec3 col = vC;
          #ifdef LIT
            col *= uLight;
          #endif
          gl_FragColor = vec4(col, t.a * vA);
          if (gl_FragColor.a < 0.003) discard;
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
  }
  spawn(px, py, pz, vx, vy, vz, life, s0, s1, a0, r, g, b, grav = 0, drag = 1, rotSpeed = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const k = i * 3;
    this.pos[k] = px; this.pos[k + 1] = py; this.pos[k + 2] = pz;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.grav[i] = grav; this.drag[i] = drag; this.rotSpeed[i] = rotSpeed;
    this.aColor[k] = r; this.aColor[k + 1] = g; this.aColor[k + 2] = b; this.aRot[i] = Math.random() * TAU;
    this.aAlpha[i] = 0.001;
    return i;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] >= this.maxLife[i]) { this.aAlpha[i] = 0; this.aSize[i] = 0; continue; }
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) { this.aAlpha[i] = 0; this.aSize[i] = 0; continue; }
      const k = i * 3;
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.aSize[i] = lerp(this.s0[i], this.s1[i], Math.sqrt(t));
      this.aAlpha[i] = this.a0[i] * (1 - t) * (1 - t) * Math.min(1, t * 12);
      this.aRot[i] += this.rotSpeed[i] * dt;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aRot.needsUpdate = true;
  }
}

const Particles = {
  init(scene) {
    const q = G.quality.particles;
    this.smoke = new ParticlePool(scene, Math.round(260 * q) + 60, TEX.smoke, false, true);
    this.dust = new ParticlePool(scene, Math.round(360 * q) + 60, TEX.dust, false, true);
    this.spark = new ParticlePool(scene, 360, TEX.spark, true, false);
    this.pools = [this.smoke, this.dust, this.spark];
  },
  update(dt, camera, light) {
    const scale = G.renderHeight / (2 * Math.tan(camera.fov * DEG / 2));
    for (const p of this.pools) { p.uniforms.uScale.value = scale; p.uniforms.uLight.value.copy(light); p.update(dt); }
  },
};

/* ------------------------------------------------------------- tracers */
const Tracers = {
  items: [],
  init(scene) {
    const c = makeCanvas(8, 64), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,230,160,0)'); g.addColorStop(0.7, 'rgba(255,200,110,0.55)'); g.addColorStop(1, 'rgba(255,250,220,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 64);
    const tex = canvasTex(c, { repeat: false, mip: false });
    this.geo = new THREE.PlaneGeometry(1, 1); this.geo.translate(0, 0.5, 0);      // origin at the tail, grows along +Y
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.pool = [];
    for (let i = 0; i < 40; i++) {
      const grp = new THREE.Group();
      const a = new THREE.Mesh(this.geo, this.mat), b = new THREE.Mesh(this.geo, this.mat);
      b.rotation.y = Math.PI / 2;
      grp.add(a, b); grp.visible = false; grp.frustumCulled = false;
      scene.add(grp); this.pool.push(grp);
    }
    this.cursor = 0;
  },
  spawn(from, to, speed = 380, width = 0.035, streak = 2.6) {
    const grp = this.pool[this.cursor]; this.cursor = (this.cursor + 1) % this.pool.length;
    const dir = new THREE.Vector3().subVectors(to, from); const len = dir.length();
    if (len < 1) return;
    dir.divideScalar(len);
    this.items = this.items.filter((it) => it.grp !== grp);
    const it = { grp, from: from.clone(), dir, len, travelled: 0, speed, width, streak };
    grp.quaternion.setFromUnitVectors(_up, dir);
    grp.visible = true;
    this.items.push(it);
  },
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.travelled += it.speed * dt;
      const head = Math.min(it.travelled, it.len);
      const tailT = it.travelled - it.streak;
      const tail = clamp(tailT, 0, it.len);
      const L = head - tail;
      if (tailT >= it.len || L <= 0.01) { if (tailT >= it.len) { it.grp.visible = false; this.items.splice(i, 1); } continue; }
      it.grp.position.copy(it.from).addScaledVector(it.dir, tail);
      it.grp.scale.set(it.width, L, it.width);
    }
  },
};

/* -------------------------------------------------------------- decals */
const Decals = {
  init(scene) {
    this.max = 90; this.cursor = 0;
    const mat = new THREE.MeshStandardMaterial({ map: TEX.holeDecal, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.max);
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  },
  add(point, normal, size = 0.12) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * TAU));
    const m = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, 0.012), q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(this.cursor, m); this.mesh.instanceMatrix.needsUpdate = true;
    this.cursor = (this.cursor + 1) % this.max;
  },
  clear() {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  },
};

/* ----------------------------------------------------- shell casings */
const Casings = {
  init(scene) {
    this.max = 56; this.cursor = 0;
    const geo = new THREE.CylinderGeometry(0.0027, 0.0031, 0.021, 8, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd2a74e, metalness: 1, roughness: 0.28 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this.data = Array.from({ length: this.max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 99, rested: false, snd: false }));
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, m);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(1, 1, 1); this._qq = new THREE.Quaternion();
  },
  eject(pos, velocity) {
    const c = this.data[this.cursor]; this.cursor = (this.cursor + 1) % this.max;
    c.p.copy(pos); c.v.copy(velocity); c.q.setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
    c.w.set(rand(-30, 30), rand(-30, 30), rand(-30, 30)); c.life = 0; c.rested = false; c.snd = false;
  },
  update(dt) {
    const m = this._m, s = this._s;
    for (let i = 0; i < this.max; i++) {
      const c = this.data[i];
      if (c.life > 9) continue;
      c.life += dt;
      if (!c.rested) {
        c.v.y -= 9.81 * dt;
        c.p.addScaledVector(c.v, dt);
        this._qq.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt));
        c.q.premultiply(this._qq);
        const h = terrainHeight(c.p.x, c.p.z) + 0.01 + 0.35 * (G.grassHeightHint || 0);
        if (c.p.y < h) {
          c.p.y = h;
          if (Math.abs(c.v.y) > 0.9 && !c.snd) { c.snd = true; Audio3D.casing(c.p); }
          c.v.y *= -0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.45);
          if (c.v.length() < 0.4) c.rested = true;
        }
      }
      const fade = c.life > 8 ? 1 - (c.life - 8) : 1;
      s.setScalar(Math.max(0.001, fade));
      m.compose(c.p, c.q, s);
      this.mesh.setMatrixAt(i, m);
      if (c.life >= 9) { m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, m); }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  },
};

/* ------------------------------------------------------ dropped magazine */
const DroppedMags = {
  init(scene) {
    this.scene = scene; this.items = []; this.max = 6;
  },
  spawn(mesh, pos, quat, vel) {
    const m = mesh.clone(true);
    m.position.copy(pos); m.quaternion.copy(quat); m.scale.setScalar(1);
    this.scene.add(m);
    const it = { m, v: vel.clone(), w: new THREE.Vector3(rand(-4, 4), rand(-3, 3), rand(-6, 6)), life: 0, rested: false, snd: false };
    this.items.push(it);
    if (this.items.length > this.max) { const old = this.items.shift(); this.scene.remove(old.m); }
  },
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      if (!it.rested) {
        it.v.y -= 9.81 * dt; it.m.position.addScaledVector(it.v, dt);
        it.m.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(it.w.x * dt, it.w.y * dt, it.w.z * dt)));
        const h = terrainHeight(it.m.position.x, it.m.position.z) + 0.04;
        if (it.m.position.y < h) {
          it.m.position.y = h;
          if (!it.snd && it.v.y < -1) { it.snd = true; Audio3D.magDrop(it.m.position); }
          it.v.y *= -0.25; it.v.x *= 0.4; it.v.z *= 0.4; it.w.multiplyScalar(0.4);
          if (it.v.length() < 0.5) it.rested = true;
        }
      }
      if (it.life > 25) { it.m.scale.multiplyScalar(0.95); if (it.m.scale.x < 0.05) { this.scene.remove(it.m); this.items.splice(i, 1); } }
    }
  },
  clear() { for (const it of this.items) this.scene.remove(it.m); this.items.length = 0; },
};

/* ------------------------------------------------------------- impacts */
const Impacts = {
  spawn(surf, point, normal, silent) {
    const P = Particles, n = normal;
    const px = point.x + n.x * 0.04, py = point.y + n.y * 0.04, pz = point.z + n.z * 0.04;
    const rv = (s) => (Math.random() - 0.5) * s;
    const speedOut = (min, max) => rand(min, max);
    switch (surf) {
      case 'flesh':
        for (let i = 0; i < 5; i++) P.dust.spawn(px, py, pz, n.x * rand(0.5, 2) + rv(1.5), n.y * 1 + rand(0, 1.5), n.z * rand(0.5, 2) + rv(1.5), rand(0.35, 0.7), 0.06, 0.2, 0.7, 0.5, 0.06, 0.05, 6, 0.96, rv(3));
        for (let i = 0; i < 3; i++) P.spark.spawn(px, py, pz, n.x * rand(1, 4) + rv(3), rand(0, 3), n.z * rand(1, 4) + rv(3), rand(0.2, 0.4), 0.04, 0.02, 0.8, 0.6, 0.05, 0.03, 12, 0.98);
        break;
      case 'wood':
        for (let i = 0; i < 6; i++) P.dust.spawn(px, py, pz, n.x * speedOut(1, 4) + rv(2), n.y * 2 + rand(0, 2), n.z * speedOut(1, 4) + rv(2), rand(0.4, 0.9), 0.03, 0.05, 0.9, 0.55, 0.38, 0.2, 9, 0.97, rv(8));
        P.dust.spawn(px, py, pz, n.x * 0.6, n.y * 0.6 + 0.2, n.z * 0.6, 0.7, 0.12, 0.45, 0.35, 0.7, 0.6, 0.45, -0.2, 0.96, rv(1));
        break;
      case 'rock': case 'concrete': case 'sand':
        for (let i = 0; i < 8; i++) P.spark.spawn(px, py, pz, n.x * speedOut(2, 8) + rv(5), n.y * speedOut(1, 6) + rand(0, 3), n.z * speedOut(2, 8) + rv(5), rand(0.15, 0.35), 0.05, 0.015, 1.0, 1, 0.75, 0.35, 14, 0.98);
        P.smoke.spawn(px, py, pz, n.x * 0.8 + rv(0.4), n.y * 0.8 + 0.2, n.z * 0.8 + rv(0.4), 1.1, 0.25, 0.9, surf === 'sand' ? 0.4 : 0.32, 0.75, 0.72, 0.66, -0.2, 0.97, rv(1));
        for (let i = 0; i < 3; i++) P.dust.spawn(px, py, pz, n.x * 1.5 + rv(2), n.y * 1.5 + rand(0, 2), n.z * 1.5 + rv(2), rand(0.4, 0.8), 0.025, 0.03, 0.9, 0.5, 0.48, 0.44, 9, 0.97);
        break;
      case 'metal':
        for (let i = 0; i < 12; i++) P.spark.spawn(px, py, pz, n.x * speedOut(3, 10) + rv(7), n.y * speedOut(2, 7) + rand(0, 3), n.z * speedOut(3, 10) + rv(7), rand(0.15, 0.4), 0.05, 0.012, 1.0, 1, 0.8, 0.4, 14, 0.98);
        P.smoke.spawn(px, py, pz, n.x * 0.5, n.y * 0.5 + 0.2, n.z * 0.5, 0.8, 0.15, 0.5, 0.22, 0.7, 0.7, 0.7, -0.1, 0.97, rv(1));
        break;
      case 'foliage':
        for (let i = 0; i < 4; i++) P.dust.spawn(px, py, pz, rv(2), rand(0, 2), rv(2), rand(0.5, 1), 0.04, 0.06, 0.9, 0.25, 0.4, 0.1, 3, 0.97, rv(6));
        break;
      default: {   // dirt / grass
        const dirt = surf === 'dirt';
        const cr = dirt ? 0.5 : 0.35, cg = dirt ? 0.4 : 0.34, cb = dirt ? 0.28 : 0.2;
        P.dust.spawn(px, py, pz, n.x * 0.7 + rv(0.4), n.y * 1.0 + 0.3, n.z * 0.7 + rv(0.4), dirt ? 1.3 : 0.9, 0.18, dirt ? 0.95 : 0.6, dirt ? 0.55 : 0.4, cr * 1.2, cg * 1.2, cb * 1.2, -0.25, 0.97, rv(1));
        P.dust.spawn(px, py, pz, n.x * 1.2 + rv(0.8), n.y * 1.5 + 0.4, n.z * 1.2 + rv(0.8), dirt ? 0.9 : 0.7, 0.14, 0.6, 0.4, cr, cg, cb, -0.1, 0.96, rv(1));
        for (let i = 0; i < (dirt ? 7 : 5); i++) P.dust.spawn(px, py, pz, n.x * speedOut(1, 4) + rv(3), n.y * speedOut(2, 6) + rand(1, 3), n.z * speedOut(1, 4) + rv(3), rand(0.5, 1.0), 0.03, 0.04, 0.95, cr * 0.7, cg * 0.65, cb * 0.5, 14, 0.98);
        break;
      }
    }
    if (!silent && surf !== 'flesh') {
      if (surf !== 'foliage' && surf !== 'grass') Decals.add(point, normal, rand(0.09, 0.15));
    }
    if (!silent) Audio3D.impact(surf, point);
  },
};

/* ------------------------------------------------------ ambient fly-by */
const Ambient = {
  jet: null, active: false, timer: 30,
  init(scene) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5b626b, metalness: 0.65, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24282d, metalness: 0.5, roughness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffa050, toneMapped: false });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 13, 10), mat); body.rotation.z = Math.PI / 2; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 4.2, 10), mat); nose.rotation.z = -Math.PI / 2; nose.position.x = 8.6; g.add(nose);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), dark); canopy.scale.set(2.2, 0.7, 0.8); canopy.position.set(3.6, 0.75, 0); g.add(canopy);
    const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(-5.5, 7.4); wingShape.lineTo(-7.2, 7.4); wingShape.lineTo(-6.4, 0); wingShape.lineTo(0, 0);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.14, bevelEnabled: false }); wingGeo.rotateX(Math.PI / 2);
    const wR = new THREE.Mesh(wingGeo, mat); wR.position.set(3.2, -0.1, 0); g.add(wR);
    const wL = wR.clone(); wL.scale.z = -1; g.add(wL);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 0.12), mat); fin.position.set(-5.4, 1.5, s * 0.9); fin.rotation.x = s * 0.2; fin.rotation.z = -0.5; g.add(fin);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2.4), mat); tail.position.set(-6, 0, s * 1.6); g.add(tail);
      const eng = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 8), glow); eng.rotation.z = Math.PI / 2; eng.position.set(-7.4, 0, s * 0.45); g.add(eng);
    }
    g.visible = false; g.scale.setScalar(2.3);
    scene.add(g); this.jet = g;
  },
  launch() {
    const cam = G.camera.position;
    const side = Math.random() < 0.5 ? 1 : -1, z = rand(-700, -320), y = cam.y + rand(300, 460);
    this.from = new THREE.Vector3(cam.x - side * 1700, y, cam.z + z);
    this.to = new THREE.Vector3(cam.x + side * 1700, y + rand(-60, 60), cam.z + z + rand(-300, 300));
    this.t = 0; this.dur = 21; this.active = true; this.jet.visible = true;
    Audio3D.jetFlyby();
  },
  update(dt) {
    if (!this.jet) return;
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (G.state === 'playing' && Atmos.dayAmt > 0.5 && Atmos.cur.cover < 0.85 && Atmos.cur.fog < 0.004) this.launch();
        this.timer = rand(80, 160);
      }
      return;
    }
    this.t += dt;
    const k = this.t / this.dur;
    if (k >= 1) { this.active = false; this.jet.visible = false; return; }
    this.jet.position.lerpVectors(this.from, this.to, k);
    const dir = _v1.subVectors(this.to, this.from).normalize();
    this.jet.rotation.set(0, Math.atan2(-dir.z, dir.x), Math.asin(dir.y) * 0.9 + (this.to.x < this.from.x ? 0 : 0), 'YXZ');
  },
};
