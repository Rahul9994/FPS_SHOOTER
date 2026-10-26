/* =====================================================================
 *  HOLLOW RIDGE  -  76-camos.js
 *  Weapon finish catalogue + procedural camo textures + triplanar PBR
 *  material patch (follows the weapon's contours, no UV stretching).
 *
 *  Every finish is painted into a tileable albedo canvas, a relief (height)
 *  canvas and a wear mask, packed into an RGB "RM" texture:
 *      R = roughness   G = metalness   B = height (for derivative bump mapping)
 *  The weapon materials sample these three times (one per axis) and blend by
 *  the surface normal, in the weapon's own object space — so the pattern wraps
 *  the receiver, handguard, stock, grip and magazines like a hydro-dip.
 * ===================================================================== */

const RARITY = {
  common:    { name: 'Common',    color: '#9fb0ba', order: 0 },
  uncommon:  { name: 'Uncommon',  color: '#6fd98a', order: 1 },
  rare:      { name: 'Rare',      color: '#4ba8ff', order: 2 },
  epic:      { name: 'Epic',      color: '#b777ff', order: 3 },
  legendary: { name: 'Legendary', color: '#ffb52e', order: 4 },
};

/* ------------------------------------------------------------- painters */
const rgbs = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const hex3 = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** draw `fn(ox, oy)` at the 9 wrapped offsets that matter so the pattern tiles seamlessly */
function wrapDraw(S, cx, cy, ext, fn) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
    if ((ox === -S && cx - ext > 0) || (ox === S && cx + ext < S) || (oy === -S && cy - ext > 0) || (oy === S && cy + ext < S)) continue;
    fn(ox, oy);
  }
}
/** irregular organic blob (closed smooth curve through noisy radial points) */
function blobPath(ctx, cx, cy, r, rng, wob = 0.45, n = 9, stretch = 1, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, rr = r * (1 - wob / 2 + rng() * wob);
    const x = Math.cos(a) * rr * stretch, y = Math.sin(a) * rr;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo((pts[n - 1][0] + p0[0]) / 2, (pts[n - 1][1] + p0[1]) / 2);
    ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  ctx.closePath();
}
function blobs(ctx, S, rng, count, rMin, rMax, color, opts = {}) {
  const k = S / 512;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const cx = rng() * S, cy = rng() * S, r = (rMin + rng() * (rMax - rMin)) * k, st = opts.stretch ? 1 + rng() * opts.stretch : 1, rot = rng() * TAU;
    wrapDraw(S, cx, cy, r * st * 1.3, (ox, oy) => { blobPath(ctx, cx + ox, cy + oy, r, rng, opts.wob ?? 0.5, opts.n ?? 9, st, rot); ctx.fill(); });
  }
}
function speckle(ctx, S, rng, count, alpha, light = true) {
  const k = S / 512;
  for (let i = 0; i < count; i++) {
    const x = rng() * S, y = rng() * S, s = (0.6 + rng() * 1.6) * k;
    ctx.fillStyle = `rgba(${light ? 255 : 0},${light ? 255 : 0},${light ? 255 : 0},${alpha * rng()})`;
    ctx.fillRect(x, y, s, s);
  }
}
/** scratches + paint chips: drawn into the albedo (bare steel) and into a mask (G = metal exposed) */
function wearMarks(ctx, wctx, S, rng, density = 1, steel = [92, 96, 102]) {
  const k = S / 512;
  for (let i = 0; i < 170 * density; i++) {
    const x = rng() * S, y = rng() * S, a = rng() * TAU, l = (5 + rng() * 34) * k;
    ctx.strokeStyle = `rgba(${steel[0]},${steel[1]},${steel[2]},${0.12 + rng() * 0.3})`; ctx.lineWidth = (0.5 + rng() * 0.9) * k;
    wctx.strokeStyle = `rgba(255,255,255,${0.35 + rng() * 0.5})`; wctx.lineWidth = ctx.lineWidth;
    for (const c of [ctx, wctx]) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  }
  for (let i = 0; i < 90 * density; i++) {
    const x = rng() * S, y = rng() * S, r = (0.8 + rng() * 2.8) * k;
    ctx.fillStyle = `rgba(${steel[0]},${steel[1]},${steel[2]},${0.4 + rng() * 0.45})`; wctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of [ctx, wctx]) { blobPath(c, x, y, r, rng, 0.8, 6); c.fill(); }
  }
}

/** the catalogue. gen(S, rng) paints albedo `a` (+ optional height `h`, wear mask `w`) into the provided contexts. */
const CAMO_DEFS = [
  { id: 'factory', name: 'Standard Issue', rarity: 'common', price: 0, free: true, builtin: true, tags: 'Anodised aluminium · polymer', desc: 'Factory hard-anodised gunmetal receiver with a black polymer furniture set. Always available.', metal: 0.7, rough: 0.48, swatch: '#3a3d41' },

  { id: 'woodland', name: 'Military Woodland', rarity: 'common', tags: '4-colour paint · light wear', desc: 'Classic four-colour woodland pattern in a matte cerakote, with edge wear where the paint meets steel.', metal: 0.0, rough: 0.8, roughLuma: -0.1, metalWear: 0.9, bump: 0.15,
    gen(c, S, rng) {
      c.a.fillStyle = '#6f7344'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 46, 34, 84, '#4d3a22', { stretch: 1.1 }); blobs(c.a, S, rng, 52, 28, 70, '#364a2b', { stretch: 1.0 }); blobs(c.a, S, rng, 38, 12, 34, '#161811', { stretch: 0.8 });
      speckle(c.a, S, rng, 5200, 0.12, true); speckle(c.a, S, rng, 3800, 0.14, false); wearMarks(c.a, c.w, S, rng, 1);
    } },
  { id: 'desert', name: 'Desert Sand', rarity: 'common', tags: '3-colour paint · sun-bleached', desc: 'Tan base with sand and umber blotches. Slightly chalky from the sun; paint worn at the corners.', metal: 0.0, rough: 0.84, roughLuma: -0.1, metalWear: 0.9, bump: 0.12,
    gen(c, S, rng) {
      c.a.fillStyle = '#c4a876'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 40, 40, 100, '#d8c397', { stretch: 1.4 }); blobs(c.a, S, rng, 34, 28, 70, '#a98d5c', { stretch: 1.2 }); blobs(c.a, S, rng, 26, 10, 26, '#6d5a3a', { stretch: 0.8 });
      speckle(c.a, S, rng, 6200, 0.16, true); speckle(c.a, S, rng, 3000, 0.12, false); wearMarks(c.a, c.w, S, rng, 1.2, [112, 104, 92]);
    } },
  { id: 'matte', name: 'Matte Black', rarity: 'common', tags: 'Nitride · bead-blasted', desc: 'Bead-blasted black nitride. Zero shine, very fine grain; the classic low-visibility look.', metal: 0.2, rough: 0.78, roughLuma: 0.0, bump: 0.35,
    gen(c, S, rng) {
      c.a.fillStyle = '#16171a'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 28, 60, 140, '#1c1d21', { wob: 0.8 }); speckle(c.a, S, rng, 14000, 0.11, true); speckle(c.a, S, rng, 9000, 0.3, false);
      // blasted grain relief
      c.h.fillStyle = '#808080'; c.h.fillRect(0, 0, S, S);
      for (let i = 0; i < 18000; i++) { const g = 90 + rng() * 80 | 0; c.h.fillStyle = `rgb(${g},${g},${g})`; c.h.fillRect(rng() * S, rng() * S, 1.5 * S / 512, 1.5 * S / 512); }
    } },

  { id: 'urban', name: 'Urban Grey', rarity: 'uncommon', tags: 'Splinter pattern · cerakote', desc: 'Angular splinter pattern in four city greys. Hard edges, low gloss, light micro-scratches.', metal: 0.05, rough: 0.7, roughLuma: -0.15, metalWear: 1, bump: 0.12,
    gen(c, S, rng) {
      c.a.fillStyle = '#8b8e91'; c.a.fillRect(0, 0, S, S);
      const cols = ['#5b5f63', '#a9acaf', '#3a3d41', '#74787c'];
      for (let i = 0; i < 120; i++) {
        const cx = rng() * S, cy = rng() * S, r = (22 + rng() * 78) * S / 512, n = 3 + (rng() * 3 | 0), a0 = rng() * TAU;
        c.a.fillStyle = cols[i % cols.length];
        wrapDraw(S, cx, cy, r * 1.4, (ox, oy) => { c.a.beginPath(); for (let k = 0; k < n; k++) { const a = a0 + k / n * TAU + (rng() - 0.5) * 0.7, rr = r * (0.55 + rng() * 0.6); const x = cx + ox + Math.cos(a) * rr * (k % 2 ? 1.5 : 0.8), y = cy + oy + Math.sin(a) * rr; k ? c.a.lineTo(x, y) : c.a.moveTo(x, y); } c.a.closePath(); c.a.fill(); });
      }
      speckle(c.a, S, rng, 5000, 0.1, true); speckle(c.a, S, rng, 3500, 0.12, false); wearMarks(c.a, c.w, S, rng, 1);
    } },
  { id: 'jungle', name: 'Jungle Green', rarity: 'uncommon', tags: 'Tiger-stripe · wet-look', desc: 'Painted brush-stroke bands over a deep green base — a tropical tiger-stripe with a slightly satin finish.', metal: 0.0, rough: 0.62, roughLuma: -0.1, metalWear: 1, bump: 0.2,
    gen(c, S, rng) {
      c.a.fillStyle = '#2f4522'; c.a.fillRect(0, 0, S, S);
      const draw = (col, n, wMin, wMax) => {
        c.a.strokeStyle = col; c.a.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const x = rng() * S, y = rng() * S, a = (rng() - 0.5) * 1.1 + Math.PI * 0.35, l = (80 + rng() * 150) * S / 512, w = (wMin + rng() * (wMax - wMin)) * S / 512, bend = (rng() - 0.5) * 90 * S / 512;
          c.a.lineWidth = w;
          wrapDraw(S, x, y, l, (ox, oy) => { c.a.beginPath(); c.a.moveTo(x + ox, y + oy); c.a.quadraticCurveTo(x + ox + Math.cos(a) * l * 0.5 - Math.sin(a) * bend, y + oy + Math.sin(a) * l * 0.5 + Math.cos(a) * bend, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); c.a.stroke(); });
        }
      };
      draw('#5b7a30', 34, 14, 34); draw('#1d3013', 44, 12, 30); draw('#0e150a', 30, 8, 22); draw('#7a5d2e', 12, 6, 14);
      speckle(c.a, S, rng, 5200, 0.1, true); speckle(c.a, S, rng, 4200, 0.14, false); wearMarks(c.a, c.w, S, rng, 0.9);
    } },
  { id: 'arctic', name: 'Arctic White', rarity: 'uncommon', tags: 'Snow cerakote · frost wear', desc: 'Off-white winter paint with ice-blue and slate mottling; wears through to dark steel on the edges.', metal: 0.0, rough: 0.74, roughLuma: -0.12, metalWear: 1, bump: 0.12,
    gen(c, S, rng) {
      c.a.fillStyle = '#e4e9ec'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 38, 40, 100, '#c3ccd3', { stretch: 1.5 }); blobs(c.a, S, rng, 30, 22, 60, '#a5b3be', { stretch: 1.2 }); blobs(c.a, S, rng, 16, 8, 22, '#7b8793', { stretch: 0.9 });
      speckle(c.a, S, rng, 6500, 0.35, true); speckle(c.a, S, rng, 2800, 0.1, false); wearMarks(c.a, c.w, S, rng, 1.5, [64, 68, 74]);
    } },

  { id: 'digital', name: 'Digital Pixel', rarity: 'rare', tags: 'Micro-pixel · satin', desc: 'Two-scale square-pixel camouflage in woodland tones. Sharp pixel edges with a faint stipple.', metal: 0.0, rough: 0.66, roughLuma: -0.08, metalWear: 1, bump: 0.1,
    gen(c, S, rng) {
      const N = 64, cell = S / N, pal = ['#a4a579', '#71784f', '#44502f', '#262b1c', '#7c6a46'];
      const nf = (x, y, s) => Noise.tfbm(x / N * s + 3.1, y / N * s + 7.7, s, 3);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const v = nf(i, j, 5) * 1.2 + nf(i, j, 11) * 0.6 + (rng() - 0.5) * 0.18;
        const idx = v < -0.32 ? 3 : v < -0.08 ? 2 : v < 0.14 ? 1 : v < 0.36 ? 0 : 4;
        c.a.fillStyle = pal[idx]; c.a.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6);
        if (rng() < 0.22) { c.a.fillStyle = pal[(idx + 1 + (rng() * 3 | 0)) % pal.length]; const s2 = cell / 2; c.a.fillRect(i * cell + (rng() < 0.5 ? 0 : s2), j * cell + (rng() < 0.5 ? 0 : s2), s2, s2); }
      }
      c.h.fillStyle = '#808080'; c.h.fillRect(0, 0, S, S);
      for (let j = 0; j < N * 2; j++) for (let i = 0; i < N * 2; i++) { const g = 118 + rng() * 22 | 0; c.h.fillStyle = `rgb(${g},${g},${g})`; c.h.fillRect(i * cell / 2, j * cell / 2, cell / 2, cell / 2); }
      speckle(c.a, S, rng, 3000, 0.07, true); wearMarks(c.a, c.w, S, rng, 0.8);
    } },
  { id: 'hex', name: 'Tactical Hex', rarity: 'rare', tags: 'Embossed honeycomb · cerakote', desc: 'Embossed honeycomb grip texture in graphite with olive and charcoal cells — it adds visible, tactile relief.', metal: 0.25, rough: 0.55, roughLuma: 0.0, roughHeight: -0.35, bump: 1.0,
    gen(c, S, rng) {
      const COLS = 14, ROWS = 16, W = COLS * Math.sqrt(3), H = ROWS * 1.5, SQ3 = Math.sqrt(3);
      const A = c.a.createImageData(S, S), Hh = c.h.createImageData(S, S), tint = [];
      for (let k = 0; k < COLS * ROWS; k++) tint.push(rng());
      const tones = [[34, 37, 41], [42, 48, 37], [24, 26, 29], [52, 55, 60]];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = x / S * W, py = y / S * H, j0 = Math.floor(py / 1.5);
        let bd = 9, bi = 0, bj = 0, bx = 0, by = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const j = j0 + dj, jm = ((j % ROWS) + ROWS) % ROWS, off = (jm % 2) * 0.5, i0 = Math.floor(px / SQ3 - off);
          for (let di = -1; di <= 1; di++) {
            const i = i0 + di, cx = (i + off) * SQ3, cy = j * 1.5, dx = px - cx, dy = py - cy, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; bi = ((i % COLS) + COLS) % COLS; bj = jm; bx = dx; by = dy; }
          }
        }
        const ax = Math.abs(bx), ay = Math.abs(by), hexd = Math.max(ax * 0.8660254 + ay * 0.5, ay);   // 1.0 at the hex border
        const edge = Math.min(1, Math.max(0, (hexd - 0.80) / 0.16)), t = tint[bj * COLS + bi];
        const tone = tones[t < 0.55 ? 0 : t < 0.78 ? 1 : t < 0.93 ? 2 : 3];
        const k = (y * S + x) * 4, shade = 1 - edge * 0.65 + (1 - hexd) * 0.18;
        A.data[k] = tone[0] * shade; A.data[k + 1] = tone[1] * shade; A.data[k + 2] = tone[2] * shade; A.data[k + 3] = 255;
        const hv = 255 * (1 - edge) * (0.82 + 0.18 * (1 - hexd)); Hh.data[k] = Hh.data[k + 1] = Hh.data[k + 2] = hv; Hh.data[k + 3] = 255;
      }
      c.a.putImageData(A, 0, 0); c.h.putImageData(Hh, 0, 0); speckle(c.a, S, rng, 2500, 0.07, true); wearMarks(c.a, c.w, S, rng, 0.7, [110, 114, 120]);
    } },
  { id: 'crimson', name: 'Dark Red', rarity: 'rare', tags: 'Candy cerakote · metal flake', desc: 'Deep crimson cerakote over bright aluminium, sprinkled with fine metallic flake that glints in changing light.', metal: 0.55, rough: 0.3, roughLuma: 0.0, bump: 0.2,
    gen(c, S, rng) {
      c.a.fillStyle = '#5c0c12'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 32, 60, 150, '#6e1219', { wob: 0.8 }); blobs(c.a, S, rng, 24, 40, 110, '#430a0f', { wob: 0.8 });
      c.h.fillStyle = '#808080'; c.h.fillRect(0, 0, S, S);
      for (let i = 0; i < 14000; i++) { const x = rng() * S, y = rng() * S, s = (0.5 + rng() * 1.0) * S / 512, l = rng(); c.a.fillStyle = `rgba(255,${120 + l * 90 | 0},${110 + l * 80 | 0},${0.05 + rng() * 0.2})`; c.a.fillRect(x, y, s, s); const g = 120 + rng() * 120 | 0; c.h.fillStyle = `rgb(${g},${g},${g})`; c.h.fillRect(x, y, s, s); }
      wearMarks(c.a, c.w, S, rng, 0.5, [150, 120, 122]);
    } },

  { id: 'carbon', name: 'Carbon Fiber', rarity: 'epic', tags: '2×2 twill · gloss clear-coat', desc: 'Woven 2×2 twill carbon with a deep gloss clear-coat. The weave is real relief, so it shimmers as you move.', metal: 0.3, rough: 0.2, roughLuma: 0.0, roughHeight: 0.28, bump: 0.55,
    gen(c, S, rng) {
      const CELLS = 26, A = c.a.createImageData(S, S), Hh = c.h.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S * CELLS, v = y / S * CELLS, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const phase = (i + j) & 3, horiz = phase < 2 ? 1 : 0;            // twill: tows swap direction every other cell
        const across = horiz ? fv : fu, along = horiz ? fu : fv;
        const tow = Math.sin(across * Math.PI), end = Math.sin(along * Math.PI);
        const over = (((i >> 1) + (j >> 1)) & 1) ? horiz : 1 - horiz;       // weave over/under
        let h = (0.25 + 0.75 * tow) * (0.55 + 0.45 * end) * (over ? 1 : 0.78);
        const fibre = 0.5 + 0.5 * Math.sin((horiz ? fv : fu) * 60);
        const lum = 14 + h * 34 + fibre * 6 * h;
        const k = (y * S + x) * 4;
        A.data[k] = lum; A.data[k + 1] = lum * 1.02; A.data[k + 2] = lum * 1.08; A.data[k + 3] = 255;
        const hv = h * 255; Hh.data[k] = Hh.data[k + 1] = Hh.data[k + 2] = hv; Hh.data[k + 3] = 255;
      }
      c.a.putImageData(A, 0, 0); c.h.putImageData(Hh, 0, 0);
    } },
  { id: 'silver', name: 'Metallic Silver', rarity: 'epic', tags: 'Brushed titanium · bare metal', desc: 'Brushed bare-metal finish with fine directional grain. Bright, cool reflections; very visible machining detail.', metal: 0.96, rough: 0.3, roughLuma: 0.0, roughHeight: 0.35, bump: 0.5,
    gen(c, S, rng) {
      c.a.fillStyle = '#c4c9ce'; c.a.fillRect(0, 0, S, S);
      c.h.fillStyle = '#808080'; c.h.fillRect(0, 0, S, S);
      for (let i = 0; i < 2600; i++) {                              // brushed streaks (horizontal, wrapped)
        const y = rng() * S, x = rng() * S, l = (30 + rng() * 220) * S / 512, g = 120 + rng() * 120 | 0, a = 0.05 + rng() * 0.16;
        for (const ox of [-S, 0, S]) { c.a.strokeStyle = rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(70,76,84,${a * 0.9})`; c.a.lineWidth = (0.5 + rng() * 1.1) * S / 512; c.a.beginPath(); c.a.moveTo(x + ox, y); c.a.lineTo(x + ox + l, y + (rng() - 0.5) * 1.5); c.a.stroke(); c.h.strokeStyle = `rgba(${g},${g},${g},0.5)`; c.h.lineWidth = c.a.lineWidth; c.h.beginPath(); c.h.moveTo(x + ox, y); c.h.lineTo(x + ox + l, y); c.h.stroke(); }
      }
      blobs(c.a, S, rng, 22, 80, 180, 'rgba(120,126,134,0.12)', { wob: 0.9, stretch: 2.5 }); speckle(c.a, S, rng, 3000, 0.1, false);
    } },

  { id: 'gold', name: 'Gold Finish', rarity: 'legendary', tags: '24k PVD · mirror-polish', desc: 'A heavy PVD gold plating, brushed on flat faces and polished on edges. Warm, slightly soft reflections.', metal: 1.0, rough: 0.2, roughLuma: 0.4, roughHeight: 0.25, bump: 0.35,
    gen(c, S, rng) {
      c.a.fillStyle = '#d6a63c'; c.a.fillRect(0, 0, S, S);
      c.h.fillStyle = '#808080'; c.h.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 36, 60, 160, 'rgba(255,224,140,0.25)', { wob: 0.9, stretch: 2 }); blobs(c.a, S, rng, 28, 50, 130, 'rgba(150,100,24,0.22)', { wob: 0.9, stretch: 2 });
      for (let i = 0; i < 1800; i++) { const y = rng() * S, x = rng() * S, l = (20 + rng() * 150) * S / 512, a = 0.04 + rng() * 0.12; for (const ox of [-S, 0, S]) { c.a.strokeStyle = rng() < 0.5 ? `rgba(255,236,170,${a})` : `rgba(120,80,20,${a})`; c.a.lineWidth = (0.5 + rng()) * S / 512; c.a.beginPath(); c.a.moveTo(x + ox, y); c.a.lineTo(x + ox + l, y + (rng() - 0.5)); c.a.stroke(); c.h.strokeStyle = 'rgba(200,200,200,0.4)'; c.h.lineWidth = c.a.lineWidth; c.h.beginPath(); c.h.moveTo(x + ox, y); c.h.lineTo(x + ox + l, y); c.h.stroke(); } }
      speckle(c.a, S, rng, 2200, 0.2, false);
    } },
  { id: 'obsidian', name: 'Obsidian Vein', rarity: 'legendary', animated: true, tags: 'Volcanic glass · animated veins', desc: 'Black volcanic glass shot through with slowly flowing ember veins. The glow is a thin, controlled pulse — the gloss does the rest.', metal: 0.35, rough: 0.16, roughLuma: 0.5, bump: 0.15,
    gen(c, S, rng) {
      c.a.fillStyle = '#070709'; c.a.fillRect(0, 0, S, S);
      blobs(c.a, S, rng, 30, 70, 170, 'rgba(26,24,34,0.65)', { wob: 0.9, stretch: 1.8 }); blobs(c.a, S, rng, 20, 30, 90, 'rgba(0,0,0,0.5)', { wob: 0.9 });
      for (let i = 0; i < 170; i++) { c.a.strokeStyle = `rgba(${90 + rng() * 80 | 0},${40 + rng() * 30 | 0},${20 + rng() * 25 | 0},${0.14 + rng() * 0.24})`; c.a.lineWidth = (0.5 + rng() * 1.1) * S / 512; const x = rng() * S, y = rng() * S, a = rng() * TAU, l = (14 + rng() * 80) * S / 512; wrapDraw(S, x, y, l, (ox, oy) => { c.a.beginPath(); c.a.moveTo(x + ox, y + oy); c.a.quadraticCurveTo(x + ox + Math.cos(a + 1) * l * 0.5, y + oy + Math.sin(a + 1) * l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); c.a.stroke(); }); }
      speckle(c.a, S, rng, 5000, 0.16, true);
    } },
];
const CAMO_BY_ID = Object.fromEntries(CAMO_DEFS.map((d) => [d.id, d]));
function camoPrice(def) {
  const E = CONFIG.economy;
  if (def.free) return 0;
  if (E.priceOverrides && E.priceOverrides[def.id] != null) return Math.max(0, E.priceOverrides[def.id] | 0);
  return E.rarityPrices[def.rarity] | 0;
}

/* ------------------------------------------------------ texture builder */
const GLSL_CAMO_COMMON = /* glsl */`
uniform sampler2D uCamoMap, uCamoRM;
uniform float uCamoScale, uCamoBump, uCamoTime;
uniform vec3 uCamoTint;
uniform vec3 uCamoMR;          // roughness mul, metalness mul, wear gain
varying vec3 vCamoP; varying vec3 vCamoN;
float camoH3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float camoN3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoH3(i), camoH3(i + vec3(1,0,0)), f.x), mix(camoH3(i + vec3(0,1,0)), camoH3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(camoH3(i + vec3(0,0,1)), camoH3(i + vec3(1,0,1)), f.x), mix(camoH3(i + vec3(0,1,1)), camoH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float camoF3(vec3 p){ return (0.5 * camoN3(p) + 0.25 * camoN3(p * 2.03 + 3.1) + 0.125 * camoN3(p * 4.1 + 7.7)) / 0.875; }
vec3 camoBump(vec3 N, vec3 viewPos, float h, float k){
  vec3 dp1 = dFdx(viewPos), dp2 = dFdy(viewPos);
  vec3 r1 = cross(dp2, N), r2 = cross(N, dp1);
  float det = dot(dp1, r1);
  vec2 g = vec2(dFdx(h), dFdy(h));
  vec3 gv = sign(det) * (g.x * r1 + g.y * r2);
  return normalize(abs(det) * N - k * gv);
}
`;

const Camo = {
  cache: new Map(),         // `${id}:${size}` -> { map, rm, mats }
  timeU: { value: 0 },
  pending: null,

  def(id) { return CAMO_BY_ID[id] || CAMO_BY_ID.factory; },
  size() { return G.quality && (G.quality.name === 'High' || G.quality.name === 'Ultra') ? 1024 : 512; },
  update(dt) { this.timeU.value += dt; },

  /** paint the three canvases for a finish */
  paint(def, S) {
    const mk = () => { const c = makeCanvas(S, S); return { c, x: c.getContext('2d') }; };
    const A = mk(), Hh = mk(), W = mk();
    Hh.x.fillStyle = '#808080'; Hh.x.fillRect(0, 0, S, S);
    W.x.fillStyle = '#000'; W.x.fillRect(0, 0, S, S);
    const rng = mulberry32(def.id.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
    def.gen({ a: A.x, h: Hh.x, w: W.x }, S, rng);
    // pack: R roughness, G metalness, B height
    const ad = A.x.getImageData(0, 0, S, S).data, hd = Hh.x.getImageData(0, 0, S, S).data, wd = W.x.getImageData(0, 0, S, S).data;
    const rm = makeCanvas(S, S), rx = rm.getContext('2d'), out = rx.createImageData(S, S), o = out.data;
    const rb = def.rough, mb = def.metal, rl = def.roughLuma || 0, rh = def.roughHeight || 0, mw = def.metalWear ?? 0.9;
    for (let i = 0; i < S * S; i++) {
      const k = i * 4, L = (ad[k] * 0.2126 + ad[k + 1] * 0.7152 + ad[k + 2] * 0.0722) / 255, H = hd[k] / 255, wear = wd[k] / 255;
      let r = rb + (L - 0.5) * rl + (H - 0.5) * rh, m = mb;
      if (wear > 0) { m = Math.max(m, wear * mw); r = r + (0.42 - r) * wear * 0.7; }
      o[k] = Math.min(255, Math.max(10, r * 255)); o[k + 1] = Math.min(255, Math.max(0, m * 255)); o[k + 2] = hd[k]; o[k + 3] = 255;
    }
    rx.putImageData(out, 0, 0);
    return { albedo: A.c, rm };
  },

  /** textures + the three patched role materials for a finish (cached) */
  get(id, size) {
    const def = this.def(id);
    if (def.builtin) return null;
    const S = size || this.size(), key = def.id + ':' + S;
    let e = this.cache.get(key);
    if (e) return e;
    const t0 = performance.now();
    const { albedo, rm } = this.paint(def, S);
    const map = canvasTex(albedo, { srgb: true, aniso: 8 });
    const rmt = canvasTex(rm, { srgb: false, aniso: 8 });
    e = { def, map, rm: rmt, mats: {}, ms: performance.now() - t0 };
    for (const role of ['alu', 'alu2', 'polymer']) e.mats[role] = this.makeMaterial(def, role, map, rmt);
    this.cache.set(key, e);
    return e;
  },

  makeMaterial(def, role, map, rm) {
    const base = VM_MATS[role];
    const m = base.clone();
    m.map = null; m.roughnessMap = null; m.metalnessMap = null; m.bumpMap = null; m.color.set(0xffffff);
    m.roughness = 1; m.metalness = 1; m.envMapIntensity = def.id === 'matte' ? 0.7 : def.metal > 0.6 ? 1.35 : 0.95;
    const rolePolymer = role === 'polymer', roleAlu2 = role === 'alu2';
    const tint = rolePolymer ? [0.82, 0.82, 0.82] : roleAlu2 ? [0.9, 0.9, 0.9] : [1, 1, 1];
    const mr = [rolePolymer ? 1.12 : roleAlu2 ? 1.05 : 1, rolePolymer ? (def.metal > 0.6 ? 0.55 : 0.0) : 1, 1];
    const uniforms = {
      uCamoMap: { value: map }, uCamoRM: { value: rm }, uCamoScale: { value: 1 / 0.62 }, uCamoBump: { value: def.bump || 0.2 },
      uCamoTime: this.timeU, uCamoTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) }, uCamoMR: { value: new THREE.Vector3(mr[0], mr[1], mr[2]) },
    };
    const anim = def.animated ? 1 : 0;
    m.userData.camoRole = role; m.userData.camoId = def.id;
    m.customProgramCacheKey = () => 'camo' + anim;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCamoP; varying vec3 vCamoN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoP = position; vCamoN = normal;');
      let fs = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_CAMO_COMMON);
      fs = fs.replace('#include <map_fragment>', /* glsl */`
        vec3 cw = pow(abs(normalize(vCamoN)), vec3(6.0)); cw /= (cw.x + cw.y + cw.z);
        vec3 cp = vCamoP * uCamoScale;
        vec4 camoCol = texture2D(uCamoMap, cp.zy) * cw.x + texture2D(uCamoMap, cp.xz + 0.37) * cw.y + texture2D(uCamoMap, cp.xy + 0.71) * cw.z;
        vec4 camoMR = texture2D(uCamoRM, cp.zy) * cw.x + texture2D(uCamoRM, cp.xz + 0.37) * cw.y + texture2D(uCamoRM, cp.xy + 0.71) * cw.z;
        diffuseColor.rgb = camoCol.rgb * uCamoTint;
        vec3 camoEmissive = vec3(0.0);
        ${anim ? /* glsl */`
        {
          vec3 q = vCamoP * 21.0;
          float t = uCamoTime;
          float n = camoF3(q * 0.55 + vec3(0.0, t * 0.035, t * 0.02));
          float rid = 1.0 - abs(2.0 * camoF3(q + n * 2.4 + vec3(t * 0.05, 0.0, -t * 0.03)) - 1.0);
          float vein = pow(clamp(rid, 0.0, 1.0), 30.0);
          float pulse = 0.5 + 0.5 * sin(t * 0.8 + n * 7.0);
          float ember = smoothstep(0.35, 1.0, pulse);
          camoEmissive = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.42, 0.08), ember) * vein * (0.3 + 0.7 * pulse) * 1.15;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), vein * 0.5);
        }` : ''}
      `);
      fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(camoMR.r * uCamoMR.x, 0.045, 1.0);');
      fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(camoMR.g * uCamoMR.y, 0.0, 1.0);');
      fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = camoBump(normal, -vViewPosition, camoMR.b * uCamoBump * 0.0012, 1.0);');
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += camoEmissive;');
      sh.fragmentShader = fs;
    };
    m.needsUpdate = true;
    return m;
  },

  roleOf(mat) { for (const r of ['alu', 'alu2', 'polymer']) if (mat === VM_MATS[r]) return r; return mat.userData && mat.userData.camoRole || null; },

  /** swap the painted-part materials of a built rifle (viewmodel, 3rd-person copy or shop preview) */
  applyToObject(root, id, size) {
    const e = this.get(id, size);
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.camoRole === undefined) o.userData.camoRole = this.roleOf(o.material);
      const role = o.userData.camoRole; if (!role) return;
      o.material = e ? e.mats[role] : VM_MATS[role];
    });
    root.userData.camoId = e ? e.def.id : 'factory';
  },

  /** small flat swatch for UI cards (cheap, separate from the 3D materials) */
  swatchCache: {},
  swatch(id, px = 140) {
    const key = id + ':' + px; if (this.swatchCache[key]) return this.swatchCache[key];
    const def = this.def(id), c = makeCanvas(px, px), x = c.getContext('2d');
    if (def.builtin) {
      const g = x.createLinearGradient(0, 0, px, px); g.addColorStop(0, '#4a4e53'); g.addColorStop(1, '#202225'); x.fillStyle = g; x.fillRect(0, 0, px, px);
      x.strokeStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < px; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, px); x.stroke(); }
    } else x.drawImage(this.paint(def, 256).albedo, 0, 0, px, px);
    const url = c.toDataURL('image/png'); this.swatchCache[key] = url; return url;
  },
};
