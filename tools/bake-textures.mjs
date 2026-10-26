// Bakes every procedurally painted texture of the game into real image files in assets/textures/ (+ manifest.json).
//   node tools/bake-textures.mjs            (needs Microsoft Edge or Chrome; opens it for ~10 s with a throw-away profile)
// The game's own generators (src/20-textures.js) do the painting, so the baked files are pixel-identical to what the game
// used to paint at start-up. Every file is re-decoded and compared with the source canvas (lossless check) before it is kept.
// Afterwards run `node build.mjs`: it packs assets/textures/* into assets/textures.pack.js, which index.html loads.
//
// To use your OWN textures instead: replace any PNG/WebP in assets/textures/ (keep the file name and size class) and run `node build.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from '../test/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'textures');
const url = pathToFileURL(path.join(root, 'index.html')).href + '?bake&q=low&noadapt';
fs.mkdirSync(outDir, { recursive: true });

const b = await launch();
try {
  await b.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) { await sleep(200); try { ready = await b.ev('!!(window.__game && window.__game.G.state === "menu")'); } catch (e) { /* loading */ } }
  if (!ready) throw new Error('game did not load (is index.html built? run node build.mjs first)');
  const source = await b.ev('window.__texSource');
  if (source !== 'procedural') throw new Error('expected the procedural generators to run, got: ' + source);

  const names = await b.ev(`Object.keys(window.__game.TEX).filter((n) => { const t = window.__game.TEX[n]; return t.image instanceof HTMLCanvasElement; })`);
  console.log(`baking ${names.length} textures -> ${path.relative(root, outDir)}`);
  const manifest = {}; let total = 0;
  for (const n of names) {
    const meta = await b.ev(`(() => { const T = window.__game.THREE, t = window.__game.TEX[${JSON.stringify(n)}]; return { w: t.image.width, h: t.image.height, srgb: t.colorSpace === T.SRGBColorSpace, repeat: t.wrapS === T.RepeatWrapping, mip: t.generateMipmaps, aniso: t.anisotropy }; })()`);
    // encode losslessly both ways, keep the smaller; the check decodes the file again and compares every pixel with the canvas
    const enc = await b.ev(`(async () => {
      const t = window.__game.TEX[${JSON.stringify(n)}], c = t.image;
      const src = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const out = {};
      for (const [k, mime, q] of [['png', 'image/png', undefined], ['webp', 'image/webp', 1]]) {
        const url = c.toDataURL(mime, q);
        if (!url.startsWith('data:' + mime)) continue;                   // encoder unavailable
        const img = new Image(); img.src = url; await img.decode();
        const r = document.createElement('canvas'); r.width = c.width; r.height = c.height; const x = r.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let max = 0;
        // compare in premultiplied space (what the canvas really stores): colour under transparent pixels is meaningless
        for (let i = 0; i < d.length; i += 4) {
          const sa = src[i + 3], da = d[i + 3], ea = Math.abs(da - sa); if (ea > max) max = ea;
          for (let j = 0; j < 3; j++) { const e = Math.abs(d[i + j] * da - src[i + j] * sa) / 255; if (e > max) max = e; }
        }
        max = Math.round(max * 10) / 10;
        out[k] = { url, maxErr: max, bytes: Math.round(url.length * 0.75) };
      }
      return out;
    })()`);
    const ok = Object.entries(enc).filter(([, v]) => v.maxErr <= 1).sort((a, c) => a[1].bytes - c[1].bytes);
    if (!ok.length) throw new Error(`${n}: no lossless encoding (${JSON.stringify(Object.fromEntries(Object.entries(enc).map(([k, v]) => [k, v.maxErr])))})`);
    const [ext, best] = ok[0];
    const file = `${n}.${ext}`;
    fs.writeFileSync(path.join(outDir, file), Buffer.from(best.url.slice(best.url.indexOf(',') + 1), 'base64'));
    manifest[n] = { file, ...meta };
    total += best.bytes;
    console.log(`  ${file.padEnd(24)} ${String(meta.w).padStart(4)}x${meta.h}  ${(best.bytes / 1024).toFixed(0).padStart(5)} KB  (${Object.entries(enc).map(([k, v]) => `${k} ${(v.bytes / 1024).toFixed(0)}KB err${v.maxErr}`).join(', ')})`);
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`done: ${names.length} files, ${(total / 1024 / 1024).toFixed(2)} MB. Now run: node build.mjs`);
  if (b.errors.length) console.log('page errors:', b.errors.slice(0, 3));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
