/* =====================================================================
 *  HOLLOW RIDGE  -  10-terrain.js
 *  Heightfield terrain generation, splat map, collision world, raycasts
 * ===================================================================== */

const WORLD = {
  half: 224,          // main terrain covers [-half, half]
  n: 449,             // heightfield samples per side (1 m spacing)
  play: 198,          // playable half extent
};

const LAYOUT = {
  spawn: { x: 0, z: 84, yaw: 0 },
  road: [[-224, -30], [-170, -24], [-110, -40], [-50, -34], [0, -26], [55, -34], [115, -54], [170, -44], [224, -30]],
  trenches: [
    [[-64, -72], [-42, -66], [-20, -75], [4, -70], [28, -62], [52, -71], [76, -66]],
    [[4, -70], [8, -52], [4, -38], [2, -27]],
    [[-42, -66], [-47, -84], [-38, -99]],
    [[52, -71], [58, -88], [49, -103]],
  ],
  foxholes: [[-30, -58], [-6, -53], [18, -51], [40, -53], [64, -57], [-54, -58], [-14, -88], [30, -90]],
  buildings: [
    { x: -80, z: -98, w: 13, d: 9, rot: 0.15 },
    { x: 100, z: -96, w: 11, d: 8, rot: -0.45 },
  ],
  targets: [[-7, 44], [9, 54], [-13, 62], [15, 33]],
  ammoCrate: { x: 7, z: 92 },
};

const HM = {
  data: null,          // Float32Array n*n
  splat: null,         // Uint8Array n*n*4  (R dirt, G dryness, B mud, A ao)
  roadD: null,         // Float32Array distance to road centre
  trenchD: null,       // Float32Array distance to nearest trench centre
  ready: false,
};

/* ---------------------------------------------------- analytic height */
function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  // the central battlefield corridor is calmer so sight-lines between the spawn hill and the front line stay open
  const mid = Math.exp(-((x * x) / (2 * 100 * 100) + ((z - 10) * (z - 10)) / (2 * 150 * 150)));
  const calm = 1 - 0.72 * mid;
  let h = 8;
  h += Noise.fbm(x * 0.0058 + 11.3, z * 0.0058 - 4.7, 4) * 30 * calm;
  h += Noise.fbm(x * 0.019 - 3.0, z * 0.019 + 8.0, 3) * 4.2 * (0.45 + 0.55 * calm);
  h += Noise.fbm(x * 0.075, z * 0.075 + 5.0, 2) * 0.5;
  // gentle fall towards the front line (north) + the spawn hill itself
  h += 0.05 * clamp(z, -130, 120);
  const dx = x - LAYOUT.spawn.x, dz = z - (LAYOUT.spawn.z + 14);
  h += 9.0 * Math.exp(-(dx * dx + dz * dz) / (2 * 34 * 34));
  // a soft valley that runs under the fortified line
  const vz = z + 55;
  h -= 4.0 * Math.exp(-(vz * vz) / (2 * 38 * 38)) * smoothstep(260, 40, Math.abs(x));
  // distant mountains
  const mt = smoothstep(380, 1900, r);
  if (mt > 0) {
    const m = Noise.ridged(x * 0.00085 + 3.1, z * 0.00085 + 9.7, 5);
    h += mt * (m * 560 + 30) + mt * Noise.fbm(x * 0.004, z * 0.004, 3) * 60;
  }
  return h;
}

/* -------------------------------------------------- polyline helpers */
function catmullRom(points, perSeg = 12) {
  const out = [];
  const P = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/* stamp the distance-to-polyline field into `field` (min) within `reach` metres */
function stampDistance(field, poly, reach) {
  const n = WORLD.n, half = WORLD.half;
  for (let k = 0; k < poly.length - 1; k++) {
    const ax = poly[k][0], az = poly[k][1], bx = poly[k + 1][0], bz = poly[k + 1][1];
    const minx = Math.max(0, Math.floor(Math.min(ax, bx) + half - reach)), maxx = Math.min(n - 1, Math.ceil(Math.max(ax, bx) + half + reach));
    const minz = Math.max(0, Math.floor(Math.min(az, bz) + half - reach)), maxz = Math.min(n - 1, Math.ceil(Math.max(az, bz) + half + reach));
    const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz || 1e-6;
    for (let j = minz; j <= maxz; j++) {
      for (let i = minx; i <= maxx; i++) {
        const px = i - half - ax, pz = j - half - az;
        const t = clamp((px * abx + pz * abz) / len2, 0, 1);
        const dx = px - abx * t, dz = pz - abz * t;
        const d = Math.sqrt(dx * dx + dz * dz);
        const idx = j * n + i;
        if (d < field[idx]) field[idx] = d;
      }
    }
  }
}

function boxBlur(src, n, radius) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = radius * 2 + 1;
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += src[j * n + clamp(i, 0, n - 1)];
    for (let i = 0; i < n; i++) {
      tmp[j * n + i] = acc / w;
      acc += src[j * n + clamp(i + radius + 1, 0, n - 1)] - src[j * n + clamp(i - radius, 0, n - 1)];
    }
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -radius; j <= radius; j++) acc += tmp[clamp(j, 0, n - 1) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = acc / w;
      acc += tmp[clamp(j + radius + 1, 0, n - 1) * n + i] - tmp[clamp(j - radius, 0, n - 1) * n + i];
    }
  }
  return out;
}

/* ------------------------------------------------ baked heightfield pack
 * The terrain is deterministic, so tools/bake-terrain.mjs stores the finished arrays (height, splat map, road / trench distance fields) in
 * assets/terrain/ and build.mjs packs them into assets/terrain.pack.js. TERRAIN_SRC_HASH (injected by build.mjs) is a hash of the generator
 * source (00-core.js + 10-terrain.js) at build time; a pack baked from different source is ignored, never used by mistake. */
const TERRAIN_PACK = window.__HR_TERRAINPACK || null;
function loadBakedHeightfield() {
  const P = TERRAIN_PACK;
  if (!P || urlParams.has('procedural') || urlParams.has('bake') || P.hash !== TERRAIN_SRC_HASH || P.n !== WORLD.n) return false;
  try {
    const dec = (b64, Ctor) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Ctor(u8.buffer); };
    const nn = WORLD.n * WORLD.n, h = dec(P.h, Float32Array), s = dec(P.s, Uint8Array), r = dec(P.r, Float32Array), t = dec(P.t, Float32Array);
    if (h.length !== nn || s.length !== nn * 4 || r.length !== nn || t.length !== nn) return false;
    HM.data = h; HM.splat = s; HM.roadD = r; HM.trenchD = t; HM.ready = true;
    return true;
  } catch (e) { console.warn('baked terrain unusable, generating it', e); return false; }
}

/* --------------------------------------------------- build heightfield */
async function buildHeightfield(progress) {
  if (loadBakedHeightfield()) { HM.source = 'baked'; progress && progress(1); return; }
  HM.source = 'procedural';
  const n = WORLD.n, half = WORLD.half;
  const h = new Float32Array(n * n);
  // 1. analytic base (chunked so the loading bar can breathe)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) h[j * n + i] = baseHeight(i - half, j - half);
    if (j % 40 === 0) { progress && progress(0.35 * j / n); await nextFrame(); }
  }

  // 2. flatten spawn pad & building pads
  const flats = [{ x: LAYOUT.spawn.x, z: LAYOUT.spawn.z, r: 4, f: 8 }];
  LAYOUT.buildings.forEach((b) => flats.push({ x: b.x, z: b.z, r: Math.max(b.w, b.d) * 0.75, f: 9 }));
  flats.push({ x: LAYOUT.ammoCrate.x, z: LAYOUT.ammoCrate.z, r: 4, f: 6 });
  for (const f of flats) {
    const target = h[Math.round(f.z + half) * n + Math.round(f.x + half)];
    f.target = target;
  }
  for (const f of flats) {
    const R = f.r + f.f;
    for (let j = Math.max(0, Math.floor(f.z + half - R)); j <= Math.min(n - 1, Math.ceil(f.z + half + R)); j++) {
      for (let i = Math.max(0, Math.floor(f.x + half - R)); i <= Math.min(n - 1, Math.ceil(f.x + half + R)); i++) {
        const d = Math.hypot(i - half - f.x, j - half - f.z);
        const m = 1 - smoothstep(f.r, f.r + f.f, d);
        if (m > 0) h[j * n + i] = lerp(h[j * n + i], f.target, m);
      }
    }
  }
  progress && progress(0.45); await nextFrame();

  // 3. distance fields for the road + trenches
  const roadD = new Float32Array(n * n).fill(1e9);
  const trenchD = new Float32Array(n * n).fill(1e9);
  stampDistance(roadD, catmullRom(LAYOUT.road, 10), 16);
  for (const t of LAYOUT.trenches) stampDistance(trenchD, catmullRom(t, 8), 12);
  progress && progress(0.55); await nextFrame();

  // 4. road: blend towards a smooth lowpass of the terrain so it reads as graded
  const blurred = boxBlur(h, n, 7);
  const ROAD_W = 3.6;
  for (let idx = 0; idx < h.length; idx++) {
    const d = roadD[idx];
    if (d > 16) continue;
    const m = 1 - smoothstep(ROAD_W * 0.7, ROAD_W * 2.6, d);
    if (m > 0) h[idx] = lerp(h[idx], blurred[idx], m * 0.9) - 0.04 * m;
  }
  progress && progress(0.62); await nextFrame();

  // 5. trenches + berms + foxholes
  const TW = 1.7, DEPTH = 1.55, BERM = 0.75;
  const foxMask = new Float32Array(n * n);
  for (const [fx, fz] of LAYOUT.foxholes) {
    const R = 7;
    for (let j = Math.floor(fz + half - R); j <= Math.ceil(fz + half + R); j++) {
      for (let i = Math.floor(fx + half - R); i <= Math.ceil(fx + half + R); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const d = Math.hypot(i - half - fx, j - half - fz);
        const dig = 1.15 * (1 - smoothstep(1.4, 2.6, d));
        const berm = 0.5 * Math.exp(-Math.pow((d - 3.4) / 1.1, 2));
        h[j * n + i] += -dig + berm;
        foxMask[j * n + i] = Math.max(foxMask[j * n + i], 1 - smoothstep(2.4, 5.0, d));
      }
    }
  }
  for (let idx = 0; idx < h.length; idx++) {
    const d = trenchD[idx];
    if (d > 12) continue;
    const dig = DEPTH * (1 - smoothstep(TW * 0.55, TW * 1.25, d));
    const berm = BERM * Math.exp(-Math.pow((d - TW * 1.95) / (TW * 0.7), 2));
    h[idx] += -dig + berm;
  }
  // blend the outer rim back to the analytic height so the far mountains join seamlessly
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - half, z = j - half;
      const m = smoothstep(190, 223, Math.max(Math.abs(x), Math.abs(z)));
      if (m > 0) h[j * n + i] = lerp(h[j * n + i], baseHeight(x, z), m);
    }
  }
  progress && progress(0.7); await nextFrame();

  // 6. splat map
  const splat = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const x = i - half, z = j - half;
      const rd = roadD[idx], td = trenchD[idx];
      let dirt = 0;
      dirt = Math.max(dirt, 1 - smoothstep(ROAD_W * 0.55, ROAD_W * 1.5, rd));
      dirt = Math.max(dirt, 1 - smoothstep(TW * 0.9, TW * 2.7, td));
      dirt = Math.max(dirt, foxMask[idx]);
      // ragged edges
      const edgeN = Noise.fbm(x * 0.35, z * 0.35, 2);
      dirt = saturate(dirt + edgeN * 0.35 * (dirt > 0.02 && dirt < 0.98 ? 1 : 0));
      // natural bare patches
      const patch = Noise.fbm(x * 0.045 + 40, z * 0.045 - 12, 3);
      dirt = Math.max(dirt, smoothstep(0.34, 0.5, patch) * 0.85);
      // steep slopes lose their grass
      const sx = (h[j * n + Math.min(i + 1, n - 1)] - h[j * n + Math.max(i - 1, 0)]) * 0.5;
      const sz = (h[Math.min(j + 1, n - 1) * n + i] - h[Math.max(j - 1, 0) * n + i]) * 0.5;
      const ny = 1 / Math.hypot(sx, 1, sz);
      dirt = Math.max(dirt, smoothstep(0.78, 0.6, ny) * 0.95);
      const dry = saturate(0.5 + Noise.fbm(x * 0.021 - 8, z * 0.021 + 31, 3) * 1.4);
      const lowland = smoothstep(2.5, -2.5, h[idx] - (blurred[idx] - 1.0));
      const mud = saturate(Math.max(lowland * 0.6, (1 - smoothstep(0.2, 1.4, td)) * 0.9) * (0.5 + 0.5 * Noise.fbm(x * 0.12, z * 0.12, 2)) + dirt * 0.15);
      const ao = 1 - 0.45 * (1 - smoothstep(0.1, 1.5, td)) - 0.3 * foxMask[idx] * (1 - smoothstep(0, 2, 0));
      splat[idx * 4] = Math.round(saturate(dirt) * 255);
      splat[idx * 4 + 1] = Math.round(dry * 255);
      splat[idx * 4 + 2] = Math.round(mud * 255);
      splat[idx * 4 + 3] = Math.round(saturate(ao) * 255);
    }
    if (j % 60 === 0) { progress && progress(0.7 + 0.3 * j / n); await nextFrame(); }
  }

  HM.data = h; HM.splat = splat; HM.roadD = roadD; HM.trenchD = trenchD; HM.ready = true;
  progress && progress(1);
}

/* ------------------------------------------------------- CPU queries */
function terrainHeight(x, z) {
  const n = WORLD.n, half = WORLD.half;
  const gx = x + half, gz = z + half;
  if (!HM.ready || gx < 0 || gz < 0 || gx >= n - 1 || gz >= n - 1) return baseHeight(x, z);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const d = HM.data, k = j * n + i;
  return lerp(lerp(d[k], d[k + 1], fx), lerp(d[k + n], d[k + n + 1], fx), fz);
}
function terrainNormal(x, z, out) {
  const e = 0.75;
  const hl = terrainHeight(x - e, z), hr = terrainHeight(x + e, z);
  const hd = terrainHeight(x, z - e), hu = terrainHeight(x, z + e);
  out = out || new THREE.Vector3();
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}
function terrainSplat(x, z) {
  const n = WORLD.n, half = WORLD.half;
  const i = clamp(Math.round(x + half), 0, n - 1), j = clamp(Math.round(z + half), 0, n - 1);
  const k = (j * n + i) * 4;
  return { dirt: HM.splat[k] / 255, dry: HM.splat[k + 1] / 255, mud: HM.splat[k + 2] / 255, ao: HM.splat[k + 3] / 255 };
}
function distToRoad(x, z) {
  const n = WORLD.n, half = WORLD.half;
  const i = clamp(Math.round(x + half), 0, n - 1), j = clamp(Math.round(z + half), 0, n - 1);
  return HM.roadD[j * n + i];
}
function distToTrench(x, z) {
  const n = WORLD.n, half = WORLD.half;
  const i = clamp(Math.round(x + half), 0, n - 1), j = clamp(Math.round(z + half), 0, n - 1);
  return HM.trenchD[j * n + i];
}

/** march a ray against the heightfield. returns distance or -1 */
function terrainRay(ox, oy, oz, dx, dy, dz, maxD) {
  let t = 0, step = 0.75, prevT = 0;
  let prevAbove = oy - terrainHeight(ox, oz) >= 0;
  if (!prevAbove) return 0;
  while (t < maxD) {
    prevT = t;
    t += step;
    if (t > maxD) t = maxD;
    const y = oy + dy * t, h = terrainHeight(ox + dx * t, oz + dz * t);
    if (y < h) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) * 0.5;
        if (oy + dy * mid < terrainHeight(ox + dx * mid, oz + dz * mid)) hi = mid; else lo = mid;
      }
      return (lo + hi) * 0.5;
    }
    step = Math.min(step * 1.015 + 0.01, 6);
    if (t >= maxD) break;
  }
  return -1;
}

/* ===================================================== collider world */
const Colliders = {
  list: [],
  cell: 8,
  grid: new Map(),
  clear() { this.list.length = 0; this.grid.clear(); },
  _key(ix, iz) { return ix * 4096 + iz + 2048; },
  add(c) {
    c.id = this.list.length;
    if (c.kind === 'box') { c.cos = Math.cos(c.rot || 0); c.sin = Math.sin(c.rot || 0); }
    this.list.push(c);
    const ext = c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.r;
    const x0 = Math.floor((c.x - ext) / this.cell), x1 = Math.floor((c.x + ext) / this.cell);
    const z0 = Math.floor((c.z - ext) / this.cell), z1 = Math.floor((c.z + ext) / this.cell);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz);
      let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
      a.push(c);
    }
    return c;
  },
  cyl(x, z, r, h, surf, solid = true, extra) {
    const y = terrainHeight(x, z);
    return this.add(Object.assign({ kind: 'cyl', x, y, z, r, h, surf, solid }, extra));
  },
  sph(x, y, z, r, surf, solid = true, extra) {
    return this.add(Object.assign({ kind: 'sph', x, y, z, r, surf, solid }, extra));
  },
  box(x, y, z, hx, hy, hz, rot, surf, solid = true, extra) {
    return this.add(Object.assign({ kind: 'box', x, y, z, hx, hy, hz, rot, surf, solid }, extra));
  },
  near(x, z, out) {
    out.length = 0;
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.grid.get(this._key(ix + a, iz + b));
      if (!arr) continue;
      for (const c of arr) if (!out.includes(c)) out.push(c);
    }
    return out;
  },
};

const _nearBuf = [];
/** push a circle (x,z,radius) out of solid colliders; feetY/headY for vertical overlap. returns true if moved */
function resolveCollisions(pos, radius, feetY, headY) {
  let moved = false;
  const list = Colliders.near(pos.x, pos.z, _nearBuf);
  for (const c of list) {
    if (!c.solid || c.disabled) continue;
    if (c.kind === 'cyl') {
      if (feetY > c.y + c.h || headY < c.y) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        pos.x = c.x + dx / d * rr; pos.z = c.z + dz / d * rr; moved = true;
      }
    } else if (c.kind === 'sph') {
      if (feetY > c.y + c.r * 0.8 || headY < c.y - c.r) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r * 0.92 + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        pos.x = c.x + dx / d * rr; pos.z = c.z + dz / d * rr; moved = true;
      }
    } else {
      if (feetY > c.y + c.hy || headY < c.y - c.hy) continue;
      const rx = pos.x - c.x, rz = pos.z - c.z;
      const lx = rx * c.cos + rz * c.sin, lz = -rx * c.sin + rz * c.cos;
      const cx = clamp(lx, -c.hx, c.hx), cz = clamp(lz, -c.hz, c.hz);
      let dx = lx - cx, dz = lz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        let fx, fz;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); fx = cx + dx / d * radius; fz = cz + dz / d * radius; }
        else {
          // centre inside the box: push out along the shallowest axis
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { fx = lx >= 0 ? c.hx + radius : -c.hx - radius; fz = lz; }
          else { fz = lz >= 0 ? c.hz + radius : -c.hz - radius; fx = lx; }
        }
        pos.x = c.x + fx * c.cos - fz * c.sin;
        pos.z = c.z + fx * c.sin + fz * c.cos;
        moved = true;
      }
    }
  }
  return moved;
}

/* ray primitives; return t (>=0) or -1, writing normal into `n` */
function rayCylinder(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const ax = ox - c.x, az = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return -1;
  const b = ax * dx + az * dz;
  const cc = ax * ax + az * az - c.r * c.r;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = (-b - s) / a;
  if (t < 0) t = (-b + s) / a;
  if (t < 0 || t > maxT) return -1;
  const y = oy + dy * t;
  if (y < c.y || y > c.y + c.h) return -1;
  n.set(ax + dx * t, 0, az + dz * t).normalize();
  return t;
}
function raySphere(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const ax = ox - c.x, ay = oy - c.y, az = oz - c.z;
  const b = ax * dx + ay * dy + az * dz;
  const cc = ax * ax + ay * ay + az * az - c.r * c.r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = -b + Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1;
  n.set(ax + dx * t, ay + dy * t, az + dz * t).normalize();
  return t;
}
function rayBox(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const rx = ox - c.x, rz = oz - c.z, ry = oy - c.y;
  const lox = rx * c.cos + rz * c.sin, loz = -rx * c.sin + rz * c.cos;
  const ldx = dx * c.cos + dz * c.sin, ldz = -dx * c.sin + dz * c.cos;
  let tmin = 0, tmax = maxT, ax = 0, ay = 0, az = 0;
  const o = [lox, ry, loz], d = [ldx, dy, ldz], h = [c.hx, c.hy, c.hz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) return -1; continue; }
    let t1 = (-h[k] - o[k]) / d[k], t2 = (h[k] - o[k]) / d[k], sgn = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sgn = 1; }
    if (t1 > tmin) { tmin = t1; ax = ay = az = 0; if (k === 0) ax = sgn; else if (k === 1) ay = sgn; else az = sgn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin <= 0 || tmin > maxT) return -1;
  n.set(ax * c.cos - az * c.sin, ay, ax * c.sin + az * c.cos);
  return tmin;
}

const _rn = new THREE.Vector3();
/** raycast terrain + static colliders. returns {t, nx,ny,nz, surf, collider} or null */
function raycastStatic(ox, oy, oz, dx, dy, dz, maxD, ignoreFoliage) {
  let best = maxD, hit = null;
  const tt = terrainRay(ox, oy, oz, dx, dy, dz, maxD);
  if (tt >= 0) {
    best = tt;
    const px = ox + dx * tt, pz = oz + dz * tt;
    const nrm = terrainNormal(px, pz);
    const sp = (px > -WORLD.half && px < WORLD.half && pz > -WORLD.half && pz < WORLD.half) ? terrainSplat(px, pz) : { dirt: 0, mud: 0 };
    hit = { t: tt, nx: nrm.x, ny: nrm.y, nz: nrm.z, surf: sp.dirt > 0.5 ? 'dirt' : 'grass', collider: null };
  }
  // walk grid cells along the ray (4 m steps) and test each collider once
  const seen = new Set();
  const steps = Math.ceil(Math.min(best, maxD) / 6);
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(best, s * 6);
    const ix = Math.floor((ox + dx * t) / Colliders.cell), iz = Math.floor((oz + dz * t) / Colliders.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = Colliders.grid.get(Colliders._key(ix + a, iz + b));
      if (!arr) continue;
      for (const c of arr) {
        if (seen.has(c.id) || c.disabled) continue;
        seen.add(c.id);
        if (c.noRay) continue;
        if (ignoreFoliage && c.surf === 'foliage') continue;
        let r;
        if (c.kind === 'cyl') r = rayCylinder(ox, oy, oz, dx, dy, dz, c, best, _rn);
        else if (c.kind === 'sph') r = raySphere(ox, oy, oz, dx, dy, dz, c, best, _rn);
        else r = rayBox(ox, oy, oz, dx, dy, dz, c, best, _rn);
        if (r >= 0 && r < best) { best = r; hit = { t: r, nx: _rn.x, ny: _rn.y, nz: _rn.z, surf: c.surf, collider: c }; }
      }
    }
  }
  return hit;
}

/** clear line of sight between two points (terrain + solid colliders) */
function lineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const hit = raycastStatic(ax, ay, az, dx / d, dy / d, dz / d, d - 0.2, true);
  return !hit;
}
