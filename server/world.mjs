// Server-side copy of the static world (heightfield + collider list), uploaded by the host's game client.
// The query functions mirror src/10-terrain.js (terrainHeight, terrainRay, raycastStatic) so that the
// authoritative shot resolution sees exactly the same walls and hills as the players do.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class World {
  constructor() { this.ready = false; this.n = 449; this.half = 224; this.h = null; this.list = []; this.grid = new Map(); this.cell = 8; this.surfs = []; }

  /** data = { n, half, h: base64(Int16LE, 1 cm units), s: [surfNames], c: [[kind,x,y,z,a,b,c,rot,surf,flags], ...] } */
  load(data) {
    const n = data.n | 0, half = +data.half;
    if (!(n > 16 && n < 2048) || !(half > 8)) throw new Error('bad world header');
    const raw = Buffer.from(String(data.h), 'base64');
    if (raw.length !== n * n * 2) throw new Error('bad heightfield size');
    const h = new Float32Array(n * n);
    for (let i = 0; i < h.length; i++) h[i] = raw.readInt16LE(i * 2) * 0.01;
    this.n = n; this.half = half; this.h = h; this.surfs = Array.isArray(data.s) ? data.s.map(String) : [];
    this.list = []; this.grid = new Map();
    if (!Array.isArray(data.c) || data.c.length > 20000) throw new Error('bad collider list');
    for (const r of data.c) {
      const kind = r[0] === 0 ? 'cyl' : r[0] === 1 ? 'sph' : 'box';
      const c = { kind, x: +r[1], y: +r[2], z: +r[3], surf: this.surfs[r[8]] || 'grass', solid: !!(r[9] & 1), noRay: !!(r[9] & 2) };
      if (kind === 'cyl') { c.r = +r[4]; c.h = +r[5]; }
      else if (kind === 'sph') { c.r = +r[4]; }
      else { c.hx = +r[4]; c.hy = +r[5]; c.hz = +r[6]; c.rot = +r[7]; c.cos = Math.cos(c.rot); c.sin = Math.sin(c.rot); }
      if ([c.x, c.y, c.z].some((v) => !Number.isFinite(v))) continue;
      this._add(c);
    }
    this.ready = true;
    return this.list.length;
  }

  _key(ix, iz) { return ix * 4096 + iz + 2048; }
  _add(c) {
    c.id = this.list.length; this.list.push(c);
    const ext = c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.r;
    const x0 = Math.floor((c.x - ext) / this.cell), x1 = Math.floor((c.x + ext) / this.cell);
    const z0 = Math.floor((c.z - ext) / this.cell), z1 = Math.floor((c.z + ext) / this.cell);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz); let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(c);
    }
  }

  height(x, z) {
    const n = this.n, half = this.half;
    const gx = clamp(x + half, 0, n - 1.001), gz = clamp(z + half, 0, n - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, d = this.h, k = j * n + i;
    return lerp(lerp(d[k], d[k + 1], fx), lerp(d[k + n], d[k + n + 1], fx), fz);
  }

  normal(x, z) {
    const e = 0.75, hl = this.height(x - e, z), hr = this.height(x + e, z), hd = this.height(x, z - e), hu = this.height(x, z + e);
    const nx = hl - hr, ny = 2 * e, nz = hd - hu, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** march a ray against the heightfield. returns distance or -1 */
  terrainRay(ox, oy, oz, dx, dy, dz, maxD) {
    let t = 0, step = 0.75, prevT = 0;
    if (oy - this.height(ox, oz) < 0) return 0;
    while (t < maxD) {
      prevT = t; t += step; if (t > maxD) t = maxD;
      const y = oy + dy * t, h = this.height(ox + dx * t, oz + dz * t);
      if (y < h) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 7; k++) { const mid = (lo + hi) * 0.5; if (oy + dy * mid < this.height(ox + dx * mid, oz + dz * mid)) hi = mid; else lo = mid; }
        return (lo + hi) * 0.5;
      }
      step = Math.min(step * 1.015 + 0.01, 6);
      if (t >= maxD) break;
    }
    return -1;
  }

  /** terrain + static colliders (foliage ignored, like the client). returns {t,nx,ny,nz,surf} or null */
  raycastStatic(ox, oy, oz, dx, dy, dz, maxD) {
    let best = maxD, hit = null;
    const tt = this.terrainRay(ox, oy, oz, dx, dy, dz, maxD);
    if (tt >= 0) {
      best = tt; const px = ox + dx * tt, pz = oz + dz * tt, nr = this.normal(px, pz);
      hit = { t: tt, nx: nr[0], ny: nr[1], nz: nr[2], surf: 'grass' };
    }
    const seen = new Set(), steps = Math.ceil(Math.min(best, maxD) / 6), N = [0, 0, 0];
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(best, s * 6);
      const ix = Math.floor((ox + dx * t) / this.cell), iz = Math.floor((oz + dz * t) / this.cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = this.grid.get(this._key(ix + a, iz + b)); if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c.id)) continue; seen.add(c.id);
          if (c.noRay || c.surf === 'foliage') continue;
          const r = c.kind === 'cyl' ? rayCyl(ox, oy, oz, dx, dy, dz, c, best, N) : c.kind === 'sph' ? raySph(ox, oy, oz, dx, dy, dz, c, best, N) : rayBox(ox, oy, oz, dx, dy, dz, c, best, N);
          if (r >= 0 && r < best) { best = r; hit = { t: r, nx: N[0], ny: N[1], nz: N[2], surf: c.surf }; }
        }
      }
    }
    return hit;
  }

  /** true when nothing static blocks the segment a -> b */
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.raycastStatic(ax, ay, az, dx / d, dy / d, dz / d, d - 0.2);
  }

  /** is a standing circle at (x,z) overlapping a solid collider? (used to vet spawn points) */
  blocked(x, z, radius = 0.5) {
    const y = this.height(x, z), ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.grid.get(this._key(ix + a, iz + b)); if (!arr) continue;
      for (const c of arr) {
        if (!c.solid) continue;
        if (c.kind === 'cyl') { if (y > c.y + c.h || y + 1.7 < c.y) continue; if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true; }
        else if (c.kind === 'sph') { if (Math.hypot(x - c.x, z - c.z) < c.r * 0.92 + radius) return true; }
        else {
          if (y + 0.35 > c.y + c.hy || y + 1.7 < c.y - c.hy) continue;
          const rx = x - c.x, rz = z - c.z, lx = rx * c.cos + rz * c.sin, lz = -rx * c.sin + rz * c.cos;
          if (Math.abs(lx) < c.hx + radius && Math.abs(lz) < c.hz + radius) return true;
        }
      }
    }
    return false;
  }
}

/* ray primitives (identical maths to the client) -------------------------------------------------- */
function rayCyl(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const ax = ox - c.x, az = oz - c.z, a = dx * dx + dz * dz;
  if (a < 1e-10) return -1;
  const b = ax * dx + az * dz, cc = ax * ax + az * az - c.r * c.r, disc = b * b - a * cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc); let t = (-b - s) / a;
  if (t < 0) t = (-b + s) / a;
  if (t < 0 || t > maxT) return -1;
  const y = oy + dy * t;
  if (y < c.y || y > c.y + c.h) return -1;
  const nx = ax + dx * t, nz = az + dz * t, l = Math.hypot(nx, nz) || 1; n[0] = nx / l; n[1] = 0; n[2] = nz / l;
  return t;
}
function raySph(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const ax = ox - c.x, ay = oy - c.y, az = oz - c.z, b = ax * dx + ay * dy + az * dz, cc = ax * ax + ay * ay + az * az - c.r * c.r, disc = b * b - cc;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = -b + Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1;
  const nx = ax + dx * t, ny = ay + dy * t, nz = az + dz * t, l = Math.hypot(nx, ny, nz) || 1; n[0] = nx / l; n[1] = ny / l; n[2] = nz / l;
  return t;
}
function rayBox(ox, oy, oz, dx, dy, dz, c, maxT, n) {
  const rx = ox - c.x, rz = oz - c.z, ry = oy - c.y;
  const lox = rx * c.cos + rz * c.sin, loz = -rx * c.sin + rz * c.cos, ldx = dx * c.cos + dz * c.sin, ldz = -dx * c.sin + dz * c.cos;
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
  n[0] = ax * c.cos - az * c.sin; n[1] = ay; n[2] = ax * c.sin + az * c.cos;
  return tmin;
}

/* player hit volumes -------------------------------------------------------------------------------
   Same parts as the AI soldiers on the client (src/85-enemies.js Combat.raycast), in the player's local
   frame. `ys` squashes the body vertically when crouching. Returns {t, part} for the nearest hit < maxT. */
const PARTS = [
  ['head', 'sph', 0, 1.66, 0, 0.16],
  ['torso', 'box', 0, 1.22, 0, 0.25, 0.3, 0.17],
  ['torso', 'box', 0, 0.98, 0, 0.21, 0.08, 0.15],
  ['leg', 'box', -0.1, 0.46, 0, 0.1, 0.46, 0.12],
  ['leg', 'box', 0.1, 0.46, 0, 0.1, 0.46, 0.12],
  ['torso', 'box', -0.32, 1.28, -0.12, 0.09, 0.1, 0.22],
];
export function rayPlayer(px, py, pz, yaw, crouched, ox, oy, oz, dx, dy, dz, maxT) {
  const c = Math.cos(yaw), s = Math.sin(yaw), ys = crouched ? 0.62 : 1;
  const rx = ox - px, ry = (oy - py) / ys, rz = oz - pz;
  const lox = rx * c - rz * s, loz = rx * s + rz * c, ldx = dx * c - dz * s, ldz = dx * s + dz * c, ldy = dy / ys;
  let bt = maxT, part = null;
  for (const p of PARTS) {
    let t = -1;
    if (p[1] === 'sph') {
      const ax = lox - p[2], ay = ry - p[3], az = loz - p[4];
      // direction is not unit-length in y once squashed; solve the general quadratic
      const A = ldx * ldx + ldy * ldy + ldz * ldz, B = ax * ldx + ay * ldy + az * ldz, C = ax * ax + ay * ay + az * az - p[5] * p[5];
      const disc = B * B - A * C;
      if (disc >= 0) { t = (-B - Math.sqrt(disc)) / A; if (t < 0) t = -1; }
    } else {
      let tmin = 0, tmax = bt, ok = true;
      const o = [lox - p[2], ry - p[3], loz - p[4]], d = [ldx, ldy, ldz], h = [p[5], p[6], p[7]];
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) ok = false; continue; }
        let t1 = (-h[k] - o[k]) / d[k], t2 = (h[k] - o[k]) / d[k];
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) ok = false;
      }
      if (ok && tmin > 0) t = tmin;
    }
    if (t > 0 && t < bt) { bt = t; part = p[0]; }
  }
  return part ? { t: bt, part } : null;
}
