// Bakes the generated terrain (height, splat map, road / trench distance fields) into assets/terrain/heightfield.bin + meta.json.
//   node tools/bake-terrain.mjs        (needs Microsoft Edge or Chrome; run `node build.mjs` first, and again afterwards)
// The game's own generator (src/10-terrain.js) does the work in a browser, so the baked arrays are bit-identical to what the game used to
// compute at every start-up. The file is tied to a hash of the generator source: after you edit 00-core.js or 10-terrain.js, bake again
// (until you do, the game simply ignores the stale file and generates the terrain as before).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from '../test/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'terrain');
const url = pathToFileURL(path.join(root, 'index.html')).href + '?bake&q=low&noadapt';
fs.mkdirSync(outDir, { recursive: true });

const b = await launch();
try {
  await b.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) { await sleep(200); try { ready = await b.ev('!!(window.__game && window.__game.G.state === "menu")'); } catch (e) { /* loading */ } }
  if (!ready) throw new Error('game did not load (run node build.mjs first)');
  const info = await b.ev('({ source: window.__game.HM.source, n: window.__game.WORLD.n, hash: window.__game.TERRAIN_SRC_HASH })');
  if (info.source !== 'procedural') throw new Error('expected the procedural generator to run, got: ' + info.source);
  const parts = [];
  for (const key of ['data', 'splat', 'roadD', 'trenchD']) {
    // read the array out in 192 KB slices (keeps every DevTools message small)
    const total = await b.ev(`window.__game.HM.${key}.byteLength`); const chunks = [];
    for (let off = 0; off < total; off += 196608) {
      const b64 = await b.ev(`(() => { const a = window.__game.HM.${key}; const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength).subarray(${off}, ${off + 196608}); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); })()`);
      chunks.push(Buffer.from(b64, 'base64'));
    }
    const buf = Buffer.concat(chunks); if (buf.length !== total) throw new Error(`${key}: expected ${total} bytes, got ${buf.length}`);
    parts.push(buf); console.log(`  ${key.padEnd(8)} ${(buf.length / 1024).toFixed(0)} KB`);
  }
  fs.writeFileSync(path.join(outDir, 'heightfield.bin'), Buffer.concat(parts));
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ n: info.n, hash: info.hash, layout: ['height f32', 'splat u8x4', 'roadD f32', 'trenchD f32'], baked: new Date().toISOString() }, null, 1) + '\n');
  console.log(`baked terrain (n=${info.n}, source hash ${info.hash}) -> assets/terrain/. Now run: node build.mjs`);
  if (b.errors.length) console.log('page errors:', b.errors.slice(0, 3));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
