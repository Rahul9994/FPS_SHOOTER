// Proves the baked texture pack equals the procedural generators: for every texture compares the three.js settings and a hash of every
// pixel (read back through a 2D canvas) between a ?procedural load and a normal (baked) load.   node test/tex-parity.mjs [base-url]
import { launch, sleep } from './cdp-lib.mjs';
const base = process.argv[2] || 'http://localhost:7777/index.html?q=low&noadapt';
const DUMP = `(() => { const g = window.__game, T = g.THREE, out = {};
  for (const [n, t] of Object.entries(g.TEX)) {
    const im = t.image; let hash = null, w = 0, h = 0;
    if (im && !(im.data)) {           // canvas or decoded image -> pixels via a 2D canvas
      w = im.width; h = im.height; const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, w, h).data; let f = 2166136261; for (let i = 0; i < d.length; i++) f = Math.imul(f ^ d[i], 16777619) >>> 0; hash = f;
    } else if (im && im.data) { let f = 2166136261; const d = im.data; for (let i = 0; i < d.length; i++) f = Math.imul(f ^ d[i], 16777619) >>> 0; hash = f; w = im.width; h = im.height; }
    out[n] = { cs: t.colorSpace, wrapS: t.wrapS, wrapT: t.wrapT, aniso: t.anisotropy, mip: t.generateMipmaps, min: t.minFilter, mag: t.magFilter, flipY: t.flipY, pma: t.premultiplyAlpha, fmt: t.format, type: t.type, w, h, hash };
  } return out; })()`;
async function dump(url) {
  const b = await launch();
  try {
    await b.send('Page.navigate', { url });
    for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "menu"')) break; } catch (e) { /* loading */ } }
    return { src: await b.ev('window.__texSource'), tex: await b.ev(DUMP), errors: b.errors.slice(0, 3) };
  } finally { b.close(); }
}
const P = await dump(base + '&procedural'), K = await dump(base);
console.log(`sources: ${P.src} vs ${K.src}   errors: ${JSON.stringify(P.errors)} ${JSON.stringify(K.errors)}`);
let bad = 0; const names = new Set([...Object.keys(P.tex), ...Object.keys(K.tex)]);
for (const n of names) {
  const a = P.tex[n], b = K.tex[n];
  if (!a || !b) { console.log('MISSING', n, !!a, !!b); bad++; continue; }
  const diffs = Object.keys(a).filter((k) => a[k] !== b[k]);
  if (diffs.length) { bad++; console.log('DIFF', n, diffs.map((k) => `${k}: ${a[k]} -> ${b[k]}`).join(', ')); }
}
console.log(`${names.size} textures compared (settings + pixel hash): ${bad ? bad + ' MISMATCH' : 'ALL IDENTICAL'}`);
process.exit(bad ? 1 : 0);
