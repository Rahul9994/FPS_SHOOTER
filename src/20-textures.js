/* =====================================================================
 *  HOLLOW RIDGE  -  20-textures.js
 *  Procedural texture generation (albedo / normal / roughness / sprites)
 * ===================================================================== */

const TEX = {};   // generated textures live here

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function canvasTex(canvas, { srgb = true, repeat = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** run fn(x,y,u,v) -> [r,g,b,a] 0..255 for every pixel of a size x size canvas */
function paintPixels(size, fn, sizeY) {
  const h = sizeY || size;
  const c = makeCanvas(size, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h), d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const px = fn(x, y, x / size, y / h);
      const k = (y * size + x) * 4;
      d[k] = px[0]; d[k + 1] = px[1]; d[k + 2] = px[2]; d[k + 3] = px.length > 3 ? px[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** tileable worley-ish cell noise: returns {f1,f2} distances (0..~1) */
function makeCellField(size, cells, seed) {
  const rng = mulberry32(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rng()) / cells, (j + rng()) / cells]);
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), id = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let a = 9, b = 9, who = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = (ci + di + cells) % cells, nj = (cj + dj + cells) % cells;
        const p = pts[nj * cells + ni];
        const dx = p[0] + (ci + di - ni) / cells - u, dz = p[1] + (cj + dj - nj) / cells - v;
        const d = Math.sqrt(dx * dx + dz * dz) * cells;
        if (d < a) { b = a; a = d; who = nj * cells + ni; } else if (d < b) b = d;
      }
      const k = y * size + x;
      f1[k] = a; f2[k] = b; id[k] = who / (cells * cells);
    }
  }
  return { f1, f2, id };
}

/** build a tangent-space normal map canvas from a Float32 height array (tileable) */
function normalFromHeight(height, size, strength = 2) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (-dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const lerpc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ----------------------------------------------------- ground textures */
function genGroundTextures() {
  const S = 512;
  /* --- grass floor: dense short grass seen from above --- */
  {
    const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const px = u * 8, py = v * 8;
      const big = Noise.tfbm(px, py, 8, 4);            // large patches
      const mid = Noise.tfbm(px * 4, py * 4, 32, 3);
      const fine = Noise.tfbm(px * 16, py * 16, 128, 2);
      const t = saturate(0.5 + big * 0.9);
      let col = lerpc([52, 70, 26], [98, 100, 44], t);
      col = lerpc(col, [96, 78, 50], saturate(0.5 - big * 1.4 - 0.15) * 0.65);       // brown dead grass
      const shade = 0.72 + mid * 0.55 + fine * 0.28;
      hgt[y * S + x] = mid * 0.5 + fine * 0.5;
      return [col[0] * shade, col[1] * shade, col[2] * shade];
    });
    // blade streaks (wrapped)
    const ctx = c.getContext('2d');
    const rng = mulberry32(7);
    for (let i = 0; i < 9000; i++) {
      const x = rng() * S, y = rng() * S, a = (rng() - 0.5) * 2.4 - Math.PI / 2, l = 6 + rng() * 14;
      const g = rng();
      ctx.strokeStyle = g < 0.5 ? `rgba(${28 + rng() * 25},${44 + rng() * 25},${14 + rng() * 10},0.55)` : `rgba(${110 + rng() * 40},${125 + rng() * 40},${48 + rng() * 25},0.4)`;
      ctx.lineWidth = 0.8 + rng() * 0.9;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if ((ox || oy) && (x > 20 && x < S - 20 && y > 20 && y < S - 20)) continue;
        ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); ctx.stroke();
      }
    }
    TEX.grassAlbedo = canvasTex(c);
    TEX.grassNormal = canvasTex(normalFromHeight(hgt, S, 2.4), { srgb: false });
  }
  /* --- dirt / gravel --- */
  {
    const cells = makeCellField(S, 24, 11), cells2 = makeCellField(S, 64, 12);
    const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const k = y * S + x;
      const px = u * 6, py = v * 6;
      const big = Noise.tfbm(px, py, 6, 4);
      const fine = Noise.tfbm(px * 8, py * 8, 48, 3);
      const peb = smoothstep(0.55, 0.15, cells.f1[k]);    // pebbles
      const peb2 = smoothstep(0.5, 0.12, cells2.f1[k]);
      const pebId = cells.id[k];
      let col = lerpc([108, 86, 60], [74, 58, 40], saturate(0.5 + big * 1.1));
      const pebCol = lerpc([128, 118, 104], [88, 80, 70], pebId);
      col = lerpc(col, pebCol, peb * 0.75);
      col = lerpc(col, [140, 124, 100], peb2 * 0.4);
      const crack = smoothstep(0.07, 0.0, cells2.f2[k] - cells2.f1[k]) * 0.35;
      const shade = (0.78 + fine * 0.45) * (1 - crack * 0.6);
      hgt[k] = peb * 0.9 + peb2 * 0.35 + fine * 0.25 - crack * 0.4;
      return [col[0] * shade, col[1] * shade, col[2] * shade];
    });
    TEX.dirtAlbedo = canvasTex(c);
    TEX.dirtNormal = canvasTex(normalFromHeight(hgt, S, 5), { srgb: false });
  }
  /* --- rock --- */
  {
    const cells = makeCellField(S, 7, 21), cells2 = makeCellField(S, 18, 22);
    const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const k = y * S + x;
      const px = u * 5, py = v * 5;
      const strata = Noise.tfbm(u * 3, v * 17 + Noise.tfbm(px, py, 5, 2) * 1.4, 3, 3, 0.5, 17);
      const fine = Noise.tfbm(px * 10, py * 10, 50, 3);
      const crack = smoothstep(0.1, 0.0, cells.f2[k] - cells.f1[k]);
      const crack2 = smoothstep(0.06, 0.0, cells2.f2[k] - cells2.f1[k]) * 0.6;
      let col = lerpc([98, 94, 88], [150, 144, 134], saturate(0.5 + strata * 1.1));
      col = lerpc(col, [92, 98, 70], saturate(Noise.tfbm(px * 3, py * 3, 15, 3) - 0.1) * 0.45);   // moss/lichen
      const shade = (0.78 + fine * 0.5) * (1 - (crack + crack2) * 0.65);
      hgt[k] = (strata * 0.6 + fine * 0.4) - (crack + crack2) * 1.2 + cells.f1[k] * 0.2;
      return [col[0] * shade, col[1] * shade, col[2] * shade];
    });
    TEX.rockAlbedo = canvasTex(c);
    TEX.rockNormal = canvasTex(normalFromHeight(hgt, S, 3.2), { srgb: false });
  }
}

/* --------------------------------------------------- vegetation textures */
function genVegetationTextures() {
  /* bark */
  {
    const S = 256;
    const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const n = Noise.tfbm(u * 14, v * 3 + Noise.tfbm(u * 4, v * 2, 4, 2, 0.5, 2) * 0.35, 14, 4, 0.5, 3);
      const ridge = 1 - Math.abs(Noise.tperlin(u * 12, v * 3, 12, 3));
      const t = saturate(0.5 + n * 1.2);
      const col = lerpc([44, 35, 28], [96, 82, 66], t * ridge);
      hgt[y * S + x] = n * 0.5 + ridge * 0.7;
      return col;
    });
    TEX.barkAlbedo = canvasTex(c);
    TEX.barkNormal = canvasTex(normalFromHeight(hgt, S, 3), { srgb: false });
  }
  /* broadleaf foliage card (cluster of leaves on transparent background) */
  function leafCard(seed, palette, count, leafLen, elongated) {
    const S = 512, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const rng = mulberry32(seed);
    ctx.clearRect(0, 0, S, S);
    // draw back-to-front: dark inner leaves then lighter outer leaves
    for (let i = 0; i < count; i++) {
      const ang = rng() * TAU, rad = Math.sqrt(rng()) * (S * 0.44);
      const x = S / 2 + Math.cos(ang) * rad, y = S / 2 + Math.sin(ang) * rad * (elongated ? 1.0 : 0.92);
      const edge = rad / (S * 0.44);
      const la = Math.atan2(y - S / 2, x - S / 2) + (rng() - 0.5) * 1.8 + (elongated ? Math.PI / 2 : 0);
      const L = leafLen * (0.75 + rng() * 0.6), W = L * (elongated ? 0.1 : 0.5);
      const t = saturate(rng() * 0.6 + (1 - edge) * -0.25 + 0.35);
      const col = lerpc(palette[0], palette[1], t);
      const sh = 0.55 + 0.6 * (1 - edge) * 0 + 0.55 * rng() + 0.15 * edge;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(la);
      ctx.fillStyle = `rgb(${col[0] * sh | 0},${col[1] * sh | 0},${col[2] * sh | 0})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(L * 0.25, -W, L * 0.75, -W * 0.8, L, 0);
      ctx.bezierCurveTo(L * 0.75, W * 0.8, L * 0.25, W, 0, 0);
      ctx.fill();
      ctx.strokeStyle = `rgba(${col[0] * 0.5 | 0},${col[1] * 0.55 | 0},${col[2] * 0.4 | 0},0.7)`;
      ctx.lineWidth = elongated ? 0.6 : 1;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.9, 0); ctx.stroke();
      ctx.restore();
    }
    return c;
  }
  TEX.leafOak = canvasTex(leafCard(31, [[38, 58, 20], [92, 116, 42]], 560, 50, false), { repeat: false });
  TEX.leafBush = canvasTex(leafCard(32, [[50, 64, 26], [112, 120, 50]], 480, 38, false), { repeat: false });
  TEX.leafPine = canvasTex(leafCard(33, [[18, 38, 26], [44, 76, 42]], 1600, 78, true), { repeat: false });
  for (const k of ['leafOak', 'leafBush', 'leafPine']) { TEX[k].colorSpace = THREE.SRGBColorSpace; }
}

/* --------------------------------------------------- prop surface textures */
function genPropTextures() {
  /* concrete */
  {
    const S = 256; const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const n = Noise.tfbm(u * 8, v * 8, 8, 5), f = Noise.tfbm(u * 32, v * 32, 32, 3);
      const stain = Noise.tfbm(u * 3, v * 3, 3, 3);
      let g = 150 + n * 55 + f * 22; g *= 1 - saturate(stain) * 0.25;
      hgt[y * S + x] = n * 0.4 + f * 0.8;
      return [g, g * 0.98, g * 0.94];
    });
    TEX.concreteAlbedo = canvasTex(c);
    TEX.concreteNormal = canvasTex(normalFromHeight(hgt, S, 2.0), { srgb: false });
  }
  /* wood planks */
  {
    const S = 256; const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const plank = Math.floor(u * 4);
      const pu = (u * 4) % 1;
      const grain = Noise.tfbm(u * 3 + plank * 7.3, v * 18, 3, 4, 0.5, 18) * 0.5 + Noise.tfbm(u * 40, v * 3, 40, 2, 0.5, 3) * 0.12;
      const gap = smoothstep(0.03, 0.0, Math.min(pu, 1 - pu));
      const base = lerpc([78, 60, 40], [118, 92, 62], saturate(0.5 + grain * 1.4));
      const s = (0.85 + plank * 0.04 % 0.2) * (1 - gap * 0.7);
      hgt[y * S + x] = grain * 0.5 - gap;
      return [base[0] * s, base[1] * s, base[2] * s];
    });
    TEX.woodAlbedo = canvasTex(c);
    TEX.woodNormal = canvasTex(normalFromHeight(hgt, S, 3), { srgb: false });
  }
  /* burlap sandbag */
  {
    const S = 256; const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const weave = (Math.sin(u * TAU * 48) * Math.sin(v * TAU * 48)) * 0.5 + 0.5;
      const n = Noise.tfbm(u * 6, v * 6, 6, 4);
      const base = lerpc([118, 102, 74], [150, 132, 96], saturate(0.5 + n * 1.2));
      const s = 0.8 + weave * 0.3;
      hgt[y * S + x] = weave * 0.6 + n * 0.3;
      return [base[0] * s, base[1] * s, base[2] * s];
    });
    TEX.sandbagAlbedo = canvasTex(c);
    TEX.sandbagNormal = canvasTex(normalFromHeight(hgt, S, 1.6), { srgb: false });
  }
  /* corrugated metal / painted steel */
  {
    const S = 256; const hgt = new Float32Array(S * S);
    const c = paintPixels(S, (x, y, u, v) => {
      const corr = Math.sin(u * TAU * 10) * 0.5 + 0.5;
      const n = Noise.tfbm(u * 5, v * 5, 5, 4), rust = smoothstep(0.1, 0.5, Noise.tfbm(u * 9, v * 9, 9, 4));
      let base = lerpc([84, 90, 82], [120, 124, 112], corr * 0.6 + n * 0.3);
      base = lerpc(base, [120, 64, 30], rust * 0.55);
      hgt[y * S + x] = corr * 1.2 + rust * 0.2;
      return base;
    });
    TEX.metalAlbedo = canvasTex(c);
    TEX.metalNormal = canvasTex(normalFromHeight(hgt, S, 1.8), { srgb: false });
  }
  /* camo fabric (sleeves / enemy uniforms) */
  {
    const S = 256;
    const c = paintPixels(S, (x, y, u, v) => {
      const a = Noise.tfbm(u * 5, v * 5, 5, 3), b = Noise.tfbm(u * 5 + 20, v * 5 + 10, 5, 3);
      let col = [92, 98, 66];
      if (a > 0.05) col = [128, 112, 78];
      if (b > 0.12) col = [64, 74, 48];
      if (a < -0.18 && b < 0) col = [48, 52, 38];
      const weave = (Math.sin(u * TAU * 64) * Math.sin(v * TAU * 64)) * 0.5 + 0.5;
      const f = 0.88 + weave * 0.14;
      return [col[0] * f, col[1] * f, col[2] * f];
    });
    TEX.camoAlbedo = canvasTex(c);
  }
  /* weapon: micro-scratch roughness + stipple grip bump (grey-scale) */
  {
    const S = 256;
    const c = paintPixels(S, (x, y, u, v) => {
      const n = Noise.tfbm(u * 12, v * 12, 12, 4);
      const g = 150 + n * 70;
      return [g, g, g];
    });
    const ctx = c.getContext('2d'); const rng = mulberry32(5);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = `rgba(${rng() < 0.5 ? 70 : 230},${rng() < 0.5 ? 70 : 230},${rng() < 0.5 ? 70 : 230},0.35)`;
      ctx.lineWidth = 0.5 + rng() * 0.8;
      const x = rng() * S, y = rng() * S, a = rng() * TAU, l = 6 + rng() * 40;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    TEX.gunRough = canvasTex(c, { srgb: false });
    const hg = new Float32Array(S * S);
    const c2 = paintPixels(S, (x, y) => { const h = (Math.sin(x * 0.75) * Math.sin(y * 0.75)) * 0.5 + 0.5; hg[y * S + x] = h; const g = h * 255; return [g, g, g]; });
    TEX.gripNormal = canvasTex(normalFromHeight(hg, S, 2.2), { srgb: false });
  }
  /* knife blade: brushed steel + fuller */
  {
    const S = 128;
    const c = paintPixels(S, (x, y, u, v) => { const n = Noise.tperlin(u * 2, v * 90, 2, 90) * 0.5 + 0.5; const g = 150 + n * 90; return [g, g, g]; });
    TEX.bladeRough = canvasTex(c, { srgb: false });
  }
}

/* ------------------------------------------------------------- sprites */
function genSprites() {
  const mk = (size, draw) => { const c = makeCanvas(size, size); draw(c.getContext('2d'), size); const t = canvasTex(c, { repeat: false, mip: false }); t.minFilter = THREE.LinearFilter; return t; };
  TEX.smoke = mk(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const rng = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      const a = rng() * TAU, r = rng() * s * 0.28, x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r, rr = 8 + rng() * 16;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, `rgba(255,255,255,${0.12 + rng() * 0.14})`); gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, s, s);
    }
  });
  TEX.spark = mk(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,220,150,0.9)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  TEX.flash = mk(256, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.18, 'rgba(255,225,150,0.95)'); g.addColorStop(0.5, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = g; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.globalCompositeOperation = 'lighter';
    const rng = mulberry32(9);
    for (let i = 0; i < 7; i++) {
      ctx.save(); ctx.rotate(i / 7 * TAU + rng() * 0.3);
      const L = s * (0.28 + rng() * 0.2);
      const gg = ctx.createLinearGradient(0, 0, L, 0);
      gg.addColorStop(0, 'rgba(255,240,190,0.95)'); gg.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(0, -s * 0.03); ctx.lineTo(L, 0); ctx.lineTo(0, s * 0.03); ctx.fill();
      ctx.restore();
    }
  });
  TEX.dust = mk(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  TEX.holeDecal = mk(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(8,8,8,0.95)'); g.addColorStop(0.35, 'rgba(14,12,10,0.8)'); g.addColorStop(0.7, 'rgba(40,34,28,0.25)'); g.addColorStop(1, 'rgba(40,34,28,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
}

/** raw-data textures: tiny and exact (alpha is random data, so they must never go through an image), always generated */
function genDataTextures() {
  TEX.noiseRGBA = (() => {
    const S = 128, data = new Uint8Array(S * S * 4); const rng = mulberry32(77);
    for (let i = 0; i < data.length; i++) data[i] = rng() * 255;
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  })();
}

/* ------------------------------------------------------- baked texture pack
 * The painted textures above are deterministic, so they are baked once (tools/bake-textures.mjs) into assets/textures/*
 * and packed by build.mjs into assets/textures.pack.js (a classic <script>, because browsers refuse to hand image *files*
 * to WebGL on a double-clicked file:// page). Loading the pack replaces ~0.5 s of CPU painting with parallel image decoding.
 * If the pack is missing or incomplete, or the URL has ?procedural (or ?bake, used by the baker), everything is painted as before. */
const TEX_PACK = window.__HR_TEXPACK || null;      // (the terrain pack is the same idea, see 10-terrain.js)
const TEX_PACK_NAMES = ['grassAlbedo', 'grassNormal', 'dirtAlbedo', 'dirtNormal', 'rockAlbedo', 'rockNormal', 'barkAlbedo', 'barkNormal', 'leafOak', 'leafBush', 'leafPine',
  'concreteAlbedo', 'concreteNormal', 'woodAlbedo', 'woodNormal', 'sandbagAlbedo', 'sandbagNormal', 'metalAlbedo', 'metalNormal', 'camoAlbedo', 'gunRough', 'gripNormal', 'bladeRough',
  'smoke', 'spark', 'flash', 'dust', 'holeDecal'];

/** same settings canvasTex() applies, for a decoded baked image */
function imageTex(img, { srgb = true, repeat = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.Texture(img);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** decode the pack in parallel (off the main thread); returns false (nothing touched) when it cannot be used */
async function loadBakedTextures() {
  if (!TEX_PACK || urlParams.has('procedural') || urlParams.has('bake')) return false;
  if (!TEX_PACK_NAMES.every((n) => TEX_PACK[n])) return false;
  try {
    const out = await Promise.all(TEX_PACK_NAMES.map(async (n) => {
      const e = TEX_PACK[n], img = new Image();
      img.src = e.u; await img.decode();
      return [n, imageTex(img, e)];
    }));
    for (const [n, t] of out) TEX[n] = t;
    return true;
  } catch (err) { console.warn('baked textures unusable, painting them instead', err); return false; }
}

/** every painted texture: baked pack when available, otherwise generated. Returns which path was used. */
async function initTextures() {
  genDataTextures();
  if (await loadBakedTextures()) return 'baked';
  genGroundTextures(); await nextFrame(); genVegetationTextures(); await nextFrame(); genPropTextures(); genSprites();
  return 'procedural';
}
