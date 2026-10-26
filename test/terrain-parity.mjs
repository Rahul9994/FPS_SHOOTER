// Proves the baked heightfield equals what the generator computes: hashes every byte of the four terrain arrays in a ?procedural load and in a
// normal (baked) load.   node test/terrain-parity.mjs [base-url]
import { launch, sleep } from './cdp-lib.mjs';
const base = process.argv[2] || 'http://localhost:7777/index.html?q=low&noadapt';
const DUMP = `(() => { const H = window.__game.HM, out = { source: H.source };
  for (const k of ['data', 'splat', 'roadD', 'trenchD']) { const u = new Uint8Array(H[k].buffer, H[k].byteOffset, H[k].byteLength); let f = 2166136261; for (let i = 0; i < u.length; i++) f = Math.imul(f ^ u[i], 16777619) >>> 0; out[k] = f + ':' + u.length; }
  const g = window.__game; out.sample = [g.terrainHeight(0, 84), g.terrainHeight(-33, -62), g.terrainHeight(120.5, -78.25)].map((v) => v.toFixed(6)).join(','); return out; })()`;
async function dump(url) {
  const b = await launch();
  try {
    await b.send('Page.navigate', { url });
    for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "menu"')) break; } catch (e) { /* loading */ } }
    return { d: await b.ev(DUMP), errors: b.errors.slice(0, 3) };
  } finally { b.close(); }
}
const P = await dump(base + '&procedural'), K = await dump(base);
console.log('A:', JSON.stringify(P.d)); console.log('B:', JSON.stringify(K.d));
const same = ['data', 'splat', 'roadD', 'trenchD', 'sample'].every((k) => P.d[k] === K.d[k]);
console.log(`sources: ${P.d.source} vs ${K.d.source}; errors ${JSON.stringify(P.errors)} ${JSON.stringify(K.errors)} -> ${same && K.d.source === 'baked' ? 'ALL ARRAYS BIT-IDENTICAL' : 'MISMATCH'}`);
process.exit(same && K.d.source === 'baked' ? 0 : 1);
