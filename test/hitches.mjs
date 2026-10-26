// Plays a scripted single-player session on the real GPU (moving, looking, firing, reloading, flashlight, knife, jumping) and reports frame-time
// hitches and JS heap growth (garbage-collector pressure).   node test/hitches.mjs [url] [--seconds 45]
import { launch, loadGame, sleep } from './cdp-lib.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const url = process.argv.find((a, i) => i > 1 && /^https?:|^file:/.test(a)) || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const secs = +arg('seconds', 45);
const b = await launch();
try {
  await loadGame(b, url); await sleep(2500);
  // --trace: time every method of the main subsystems and log any single call over 6 ms, plus shader-program count changes
  if (process.argv.includes('--trace')) await b.ev(`(() => { const g = window.__game, slow = []; window.__slow = slow; let progs = g.renderer.info.programs.length;
    for (const nm of ['Audio3D', 'Weapons', 'Viewmodel', 'DroppedMags', 'Casings', 'Tracers', 'Particles', 'Combat', 'Decals', 'Impacts', 'Player', 'Enemies', 'HUD', 'Gfx', 'Atmos', 'Ambient', 'Camo', 'Leaves']) {
      const o = g[nm]; if (!o) continue;
      for (const k of Object.keys(o)) { const f = o[k]; if (typeof f !== 'function' || f.__w) continue; const w = function () { const t0 = performance.now(); const r = f.apply(this, arguments); const dt = performance.now() - t0; if (dt > 6) slow.push([performance.now(), nm + '.' + k, +dt.toFixed(1)]); return r; }; w.__w = 1; try { o[k] = w; } catch (e) { /* frozen */ } }
    }
    const rr = g.renderer.render.bind(g.renderer); const R = g.renderer;
    const seen = new Set(R.info.programs.map((q) => q.id));
    setInterval(() => { const n = R.info.programs.length; if (n !== progs) { const fresh = R.info.programs.filter((q) => !seen.has(q.id)); fresh.forEach((q) => seen.add(q.id)); const tok = (q) => String(q.cacheKey).split(',');
      const desc = fresh.map((q) => { const tq = tok(q); let best = null, bd = 1e9; for (const o of R.info.programs) { if (o.id === q.id || fresh.includes(o)) continue; const to = tok(o); if (Math.abs(to.length - tq.length) > 2) continue; let d = 0; for (let i = 0; i < Math.max(to.length, tq.length); i++) if (to[i] !== tq[i]) d++; if (d < bd) { bd = d; best = to; } }
        const diffs = []; if (best) for (let i = 0; i < Math.max(best.length, tq.length); i++) if (best[i] !== tq[i]) diffs.push(i + ':' + String(best[i]).slice(0, 30) + '->' + String(tq[i]).slice(0, 30)); return '#' + q.id + ' differs from nearest existing in ' + diffs.length + ' fields [' + diffs.join(' | ') + ']'; });
      slow.push([performance.now(), 'NEW SHADER PROGRAMS ' + progs + ' -> ' + n + ' :: ' + desc.join('  ||  '), 0]); progs = n; } }, 4); return 1; })()`);
  await b.ev(`(() => { const ts = [], marks = [], heap = []; window.__rec = { ts, marks, heap }; let last = performance.now();
    const f = (now) => { ts.push([now, now - last]); last = now; requestAnimationFrame(f); }; requestAnimationFrame(f);
    setInterval(() => heap.push([performance.now(), performance.memory.usedJSHeapSize / 1048576]), 500); window.__mark = (s) => marks.push([performance.now(), s]); return 1; })()`);
  const key = (code, down = true) => b.ev(`window.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { code: '${code}', key: '${code}', bubbles: true })); 0`);
  const mouse = (type) => b.ev(`document.dispatchEvent(new MouseEvent('${type}', { button: 0, bubbles: true })); 0`);
  const mark = (s) => b.ev(`window.__mark(${JSON.stringify(s)}); 0`);
  // continuous slow look sweep + walk
  await b.ev(`window.__look = setInterval(() => { const P = window.__game.Player; P.yaw += 0.012 * Math.sin(performance.now() / 2500); P.pitch = 0.1 * Math.sin(performance.now() / 1700); }, 16); 0`);
  const t0 = Date.now(); const at = (s) => sleep(Math.max(0, s * 1000 - (Date.now() - t0)));
  await mark('walk'); await key('KeyW'); await at(4);
  await mark('sprint'); await key('ShiftLeft'); await at(8); await key('ShiftLeft', false);
  await mark('fire burst 1'); await mouse('mousedown'); await at(10.5); await mouse('mouseup');
  await mark('jump'); await key('Space'); await sleep(80); await key('Space', false); await at(13);
  await mark('fire burst 2'); await mouse('mousedown'); await at(16); await mouse('mouseup');
  await mark('reload'); await key('KeyR'); await sleep(80); await key('KeyR', false); await at(20);
  await mark('flashlight on'); await key('KeyF'); await sleep(80); await key('KeyF', false); await at(24);
  await mark('fire w/ flashlight'); await mouse('mousedown'); await at(26.5); await mouse('mouseup');
  await mark('knife'); await key('Digit2'); await sleep(80); await key('Digit2', false); await at(30);
  await mark('slash'); await mouse('mousedown'); await sleep(120); await mouse('mouseup'); await at(33);
  await mark('rifle again'); await key('Digit1'); await sleep(80); await key('Digit1', false); await at(36);
  await mark('fire burst 3'); await mouse('mousedown'); await at(39); await mouse('mouseup');
  await mark('flashlight off'); await key('KeyF'); await sleep(80); await key('KeyF', false);
  await at(secs); await key('KeyW', false);
  const r = await b.ev('JSON.stringify({ ts: window.__rec.ts, marks: window.__rec.marks, heap: window.__rec.heap })');
  const { ts, marks, heap } = JSON.parse(r);
  const d = ts.map((x) => x[1]).slice(5); const sorted = d.slice().sort((a, c) => a - c);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const over = (ms) => d.filter((x) => x > ms).length;
  console.log(`frames ${d.length}, avg ${(d.reduce((a, c) => a + c, 0) / d.length).toFixed(2)} ms (${(1000 / (d.reduce((a, c) => a + c, 0) / d.length)).toFixed(0)} fps) | p50 ${pct(0.5).toFixed(1)} p99 ${pct(0.99).toFixed(1)} p99.9 ${pct(0.999).toFixed(1)} max ${sorted[sorted.length - 1].toFixed(1)}`);
  console.log(`frames over 12 ms: ${over(12)}   over 20 ms: ${over(20)}   over 33 ms: ${over(33)}   over 50 ms: ${over(50)}`);
  const phase = (t) => { let p = 'start'; for (const [mt, s] of marks) if (mt <= t) p = s; return p; };
  console.log('worst frames:'); ts.slice(5).map((x, i) => [x[1], x[0]]).sort((a, c) => c[0] - a[0]).slice(0, 12).forEach(([ms, t]) => console.log(`  ${ms.toFixed(1).padStart(6)} ms  during "${phase(t)}"`));
  const hs = heap.map((x) => x[1]); let drops = 0; for (let i = 1; i < hs.length; i++) if (hs[i] < hs[i - 1] - 2) drops++;
  console.log(`JS heap: start ${hs[0].toFixed(0)} MB, max ${Math.max(...hs).toFixed(0)} MB, end ${hs[hs.length - 1].toFixed(0)} MB, GC drops seen (>2 MB): ${drops} in ${(secs).toFixed(0)} s`);
  if (process.argv.includes('--trace')) {
    const slow = JSON.parse(await b.ev('JSON.stringify(window.__slow)'));
    console.log('slow calls (> 6 ms) and shader-program changes, in order:'); for (const [t, n, ms] of slow.slice(0, 60)) console.log(`  ${phase(t).padEnd(20)} ${n} ${ms ? ms + ' ms' : ''}`);
  }
  console.log('errors:', JSON.stringify(b.errors.slice(0, 4)));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
