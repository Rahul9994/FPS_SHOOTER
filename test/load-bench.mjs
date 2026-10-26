// Real-GPU load + frame-time benchmark (Edge on the dedicated GPU, throw-away profile).
//   node test/load-bench.mjs [url] [--runs 2] [--fps]
// Reports wall-clock time from navigation to the main menu, the per-step boot timings the game records in
// window.__bootTimes, the network requests the page made (so you can see nothing leaves the PC), and optionally fps.
import { launch, sleep } from './cdp-lib.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:7777/index.html?q=high&noadapt';
const runs = +(args[args.indexOf('--runs') + 1]) || 1;
const wantFps = args.includes('--fps');

const b = await launch();
try {
  await b.send('Network.enable'); await b.send('Page.enable');
  const gpu = await b.send('SystemInfo.getInfo').catch(() => null);
  console.log('GPU (system):', gpu && gpu.result && gpu.result.gpu && gpu.result.gpu.devices.slice(0, 2).map((d) => d.deviceString).join(' | '));
  for (let r = 1; r <= runs; r++) {
    const reqs = [];
    const onReq = (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url.slice(0, 90)); };
    // (cdp-lib owns ws.onmessage; use performance entries from the page instead of re-hooking the socket)
    const t0 = Date.now();
    await b.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
      await sleep(100);
      try { ready = await b.ev('!!(window.__game && window.__bootTimes && window.__bootTimes.length >= 11 && window.__game.G.state !== "loading")'); } catch (e) { /* still loading */ }
    }
    const wall = Date.now() - t0;
    if (!ready) { console.log('run', r, 'TIMEOUT'); continue; }
    const boot = await b.ev('JSON.stringify(window.__bootTimes)');
    const net = await b.ev('JSON.stringify(performance.getEntriesByType("resource").map((e) => [e.name.slice(0, 80), Math.round(e.duration), e.transferSize]))');
    const nav = await b.ev('JSON.stringify(performance.getEntriesByType("navigation")[0].toJSON ? (({domContentLoadedEventEnd:d,loadEventEnd:l,responseEnd:re})=>({re:Math.round(re),dcl:Math.round(d),load:Math.round(l)}))(performance.getEntriesByType("navigation")[0]) : {})');
    const heap = await b.ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1');
    console.log(`\n=== run ${r}: navigation -> menu ready ${wall} ms   (nav ${nav}, JS heap ${heap} MB)`);
    let total = 0; for (const [label, ms] of JSON.parse(boot)) { total += ms; console.log('  ' + label.padEnd(36) + String(ms).padStart(6) + ' ms'); }
    console.log('  ' + 'sum of boot steps'.padEnd(36) + String(total).padStart(6) + ' ms');
    console.log('  resources:', JSON.parse(net).map(([n, d, s]) => `${n.replace(/^https?:\/\/[^/]+/, '')} ${d}ms ${s}B`).join(' | ') || '(none)');
    void onReq; void reqs;
  }
  if (wantFps) {
    await b.ev('window.__game.Game.begin(); 0'); await sleep(4000);
    const fpsJS = 'new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 4500) r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })';
    const ftJS = 'new Promise((r) => { const ts = []; let last = performance.now(); const f = (t) => { ts.push(t - last); last = t; if (ts.length > 400) { ts.sort((a, b) => a - b); r({ p50: +ts[200].toFixed(2), p95: +ts[380].toFixed(2), p99: +ts[396].toFixed(2), max: +ts[400].toFixed(1) }); } else requestAnimationFrame(f); }; requestAnimationFrame(f); })';
    console.log('\nGPU used by page:', await b.ev('window.__game.G.gpu.name'));
    for (const tier of ['medium', 'high', 'ultra']) {
      await b.ev(`window.__game.Game.applyQuality('${tier}', true); 0`); await sleep(1500);
      const fps = await b.ev(fpsJS), ft = await b.ev(ftJS), calls = await b.ev('JSON.stringify(window.__game.renderer.info.render)'), mem = await b.ev('JSON.stringify(window.__game.renderer.info.memory)');
      console.log(`${tier.padEnd(7)} ${String(fps).padStart(6)} fps   frame ms ${JSON.stringify(ft)}   render ${calls}   mem ${mem}`);
    }
  }
  console.log('\npage errors:', b.errors.length ? b.errors.slice(0, 5) : 'none');
} finally { b.close(); setTimeout(() => process.exit(0), 500); }
