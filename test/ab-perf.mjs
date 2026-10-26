// A/B frame-cost comparison in ONE browser session (alternating, so GPU boost clocks / thermals hit both sides equally).
//   node test/ab-perf.mjs "<js for A>" "<js for B>" [--tier high] [--rt off] [--rounds 4] [--url ...]
// Prints median fps and median GPU-bound frame time for A and B. Uncapped (no vsync).
import { launch, sleep } from './cdp-lib.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const [A, B] = [process.argv[2], process.argv[3]];
const tier = arg('tier', 'high'), rt = arg('rt', 'off'), rounds = +arg('rounds', 4), url = arg('url', 'http://localhost:7777/index.html?autostart&noadapt&q=high'), yaw = arg('yaw', '0.4');
const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
// mean frame time over a 3 s window (timer granularity of single frames is ~1 ms, so medians of single frames would be quantised)
const SAMPLE = `new Promise((r) => { const ts = []; let last = performance.now(); const t0 = last;
  const f = (now) => { ts.push(now - last); last = now; if (now - t0 > 3000) { ts.shift(); const mean = (now - t0) / ts.length; ts.sort((a, b) => a - b); r({ p50: mean, p95: ts[Math.floor(ts.length * 0.95)], n: ts.length }); } else requestAnimationFrame(f); };
  requestAnimationFrame(f); })`;
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
try {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "playing"')) break; } catch (e) { /* loading */ } }
  await b.ev(`window.__game.Game.applyQuality('${tier}', true); window.__game.Gfx.set('rt','${rt}'); window.__game.Player.yaw = ${yaw}; 0`); await sleep(2500);
  console.log('GPU:', await b.ev('window.__game.G.gpu.name'), `| tier ${tier} rt ${rt} | A: ${A} | B: ${B}`);
  const res = { A: [], B: [], Ap95: [], Bp95: [] };
  for (let r = 0; r < rounds; r++) for (const [k, js] of [['A', A], ['B', B]]) {
    await b.ev(js + '; 0'); await sleep(700);
    const s = await b.ev(SAMPLE); res[k].push(s.p50); res[k + 'p95'].push(s.p95);
  }
  const f = (a) => `${med(a).toFixed(2)} ms (${(1000 / med(a)).toFixed(0)} fps)`;
  console.log(`A median frame ${f(res.A)}   p95 ${med(res.Ap95).toFixed(2)}   runs ${res.A.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`B median frame ${f(res.B)}   p95 ${med(res.Bp95).toFixed(2)}   runs ${res.B.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`B vs A: ${((med(res.B) / med(res.A) - 1) * 100).toFixed(1)}% frame time`);
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
