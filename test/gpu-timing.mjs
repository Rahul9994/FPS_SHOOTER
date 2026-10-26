// Per-pass GPU time with hardware timer queries (EXT_disjoint_timer_query_webgl2).   node test/gpu-timing.mjs [--tier high] [--rt off] [--cap 0]
// Labels: shadow map, each post pass, and (via onBeforeRender / onAfterRender) terrain, far terrain, the three grass layers, trees/props ("world other").
import { launch, loadGame, sleep } from './cdp-lib.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
const INSTALL = `(() => {
  const g = window.__game, R = g.renderer, gl = R.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return 'no timer query';
  const acc = {}, pending = []; let frames = 0, cur = null; const stack = [];
  const begin = (label) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); cur = { q, label }; };
  const end = () => { if (!cur) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(cur); cur = null; };
  const push = (l) => { end(); stack.push(l); begin(l); }, pop = () => { end(); stack.pop(); if (stack.length) begin(stack[stack.length - 1]); };
  const poll = () => { const disj = gl.getParameter(ext.GPU_DISJOINT_EXT); while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) { const p = pending.shift(); if (!disj) acc[p.label] = (acc[p.label] || 0) + gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(p.q); } };
  g.composer.passes.forEach((p, i) => { const o = p.render; const name = 'pass' + i + ' ' + p.constructor.name; p.render = function () { push(name); try { return o.apply(this, arguments); } finally { pop(); } }; });
  const sm = R.shadowMap, so = sm.render; sm.render = function () { push('shadow map'); try { return so.apply(this, arguments); } finally { pop(); } };
  // per-object attribution inside the world pass
  const tag = (obj, label) => { const b0 = obj.onBeforeRender, a0 = obj.onAfterRender; obj.onBeforeRender = function () { push(label); }; obj.onAfterRender = function () { pop(); }; };
  g.World.grass.forEach((q, i) => tag(q.mesh, 'grass ' + 'ABC'[i]));
  if (g.World.far) tag(g.World.far, 'far terrain');
  if (g.World.terrain) g.World.terrain.traverse((o) => { if (o.isMesh) tag(o, 'terrain'); });
  const of = g.Game.renderFrame; g.Game.renderFrame = function (dt) { of.call(g.Game, dt); frames++; poll(); };
  window.__gt = { acc, get frames() { return frames; }, reset() { for (const k in acc) delete acc[k]; frames = 0; }, poll };
  return 'ok'; })()`;
try {
  await loadGame(b, `http://localhost:7777/index.html?autostart&noadapt&q=${arg('tier', 'high')}`); await sleep(2500);
  await b.ev(`window.__game.Gfx.set('rt','${arg('rt', 'off')}'); window.__game.Settings.fpsCap = ${arg('cap', 0)}; 0`); await sleep(1500);
  console.log('install:', await b.ev(INSTALL), '| GPU', await b.ev('window.__game.G.gpu.name'));
  await sleep(1500); await b.ev('window.__gt.reset(); 0'); await sleep(5000);
  await sleep(500);
  const r = await b.ev('JSON.stringify({ acc: window.__gt.acc, frames: window.__gt.frames })'); const { acc, frames } = JSON.parse(r);
  const total = Object.values(acc).reduce((a, c) => a + c, 0);
  console.log(`tier ${arg('tier', 'high')} rt ${arg('rt', 'off')}: ${frames} frames, GPU time per frame (sum of all labels) ${(total / frames).toFixed(2)} ms`);
  for (const [k, v] of Object.entries(acc).sort((a, c) => c[1] - a[1])) console.log('  ' + k.padEnd(26) + (v / frames).toFixed(3).padStart(8) + ' ms   ' + (100 * v / total).toFixed(1).padStart(5) + ' %');
  console.log('errors', JSON.stringify(b.errors.slice(0, 3)));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
