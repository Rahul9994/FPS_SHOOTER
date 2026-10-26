// Where does the main thread spend its time per frame?  node test/cpu-profile.mjs [url] [--tier high]
// Wraps the per-frame update calls with timers and reports mean ms/frame over ~400 frames (uncapped, so every ms matters).
import { launch, sleep } from './cdp-lib.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const url = process.argv.find((a, i) => i > 1 && /^https?:|^file:/.test(a)) || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
const INSTR = `(() => { const g = window.__game, T = {}, targets = [
  ['Player.update', g.Player, 'update'], ['Weapons.update', g.Weapons, 'update'], ['Viewmodel.update', g.Viewmodel, 'update'], ['Enemies.update', g.Enemies, 'update'], ['Combat.update', g.Combat, 'update'],
  ['Atmos.update', g.Atmos, 'update'], ['Atmos.syncCameras', g.Atmos, 'syncCameras'], ['Particles.update', g.Particles, 'update'], ['Ambient.update', g.Ambient, 'update'], ['Tracers.update', g.Tracers, 'update'],
  ['Audio3D.update', g.Audio3D, 'update'], ['HUD.update', g.HUD, 'update'], ['Gfx.update', g.Gfx, 'update'], ['Camo.update', g.Camo, 'update'], ['Shop.tick', g.Shop, 'tick'],
  ['composer.render', g.composer, 'render'], ['Casings.update', g.Casings || {}, 'update'], ['Decals.update', g.Decals || {}, 'update'], ['Leaves.update', g.Leaves || {}, 'update']];
  for (const [name, obj, fn] of targets) { if (!obj || typeof obj[fn] !== 'function') continue; const o = obj[fn]; T[name] = { t: 0, n: 0 }; obj[fn] = function () { const t0 = performance.now(); const r = o.apply(this, arguments); T[name].t += performance.now() - t0; T[name].n++; return r; }; }
  g.composer.passes.forEach((p, i) => { const o = p.render; const name = 'pass' + i + ' ' + p.constructor.name; T[name] = { t: 0, n: 0 }; p.render = function () { const t0 = performance.now(); const r = o.apply(this, arguments); T[name].t += performance.now() - t0; T[name].n++; return r; }; });
  const of = g.Game.renderFrame; T['renderFrame (total)'] = { t: 0, n: 0 }; g.Game.renderFrame = function (dt) { const t0 = performance.now(); of.call(g.Game, dt); T['renderFrame (total)'].t += performance.now() - t0; T['renderFrame (total)'].n++; };
  window.__T = T; return Object.keys(T).length; })()`;
try {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "playing"')) break; } catch (e) { /* loading */ } }
  await b.ev(`window.__game.Game.applyQuality('${arg('tier', 'high')}', true); window.__game.Gfx.set('rt','${arg('rt', 'off')}'); 0`); await sleep(3000);
  console.log('GPU:', await b.ev('window.__game.G.gpu.name'), '| instrumented', await b.ev(INSTR));
  await sleep(6000);
  const T = await b.ev('window.__T'); const total = T['renderFrame (total)'];
  console.log(`frames: ${total.n}   mean renderFrame ${(total.t / total.n).toFixed(2)} ms  (=${(1000 * total.n / 6000).toFixed(0)} fps measured over 6 s incl. waiting)`);
  for (const [k, v] of Object.entries(T).sort((a, c) => c[1].t - a[1].t)) console.log('  ' + k.padEnd(28) + (v.t / Math.max(1, total.n)).toFixed(3).padStart(8) + ' ms/frame   (' + (v.n / total.n).toFixed(1) + ' calls/frame)');
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
