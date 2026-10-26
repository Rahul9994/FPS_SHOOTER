// Uncapped (no vsync) frame-cost profile on the real GPU.   node test/perf-profile.mjs [url]
// Prints, per quality tier x ray-march level: fps, JS frame time (CPU side), GPU-bound estimate, draw calls / triangles per frame.
// Then a few ablations (shadows, bloom, grass, trees ...) at High so the heaviest parts are visible.
import { launch, sleep } from './cdp-lib.mjs';

const url = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
const SAMPLE = `new Promise((r) => {
  const G = window.__game, R = G.renderer; R.info.autoReset = false;
  const orig = G.Game.renderFrame.bind(G.Game); let cpu = 0, n = 0, calls = 0, tris = 0, last = performance.now(), ts = [];
  G.Game.renderFrame = function (dt) { R.info.reset(); const t = performance.now(); orig(dt); cpu += performance.now() - t; n++; calls += R.info.render.calls; tris += R.info.render.triangles; };
  const t0 = performance.now(); let frames = 0;
  const f = (now) => { frames++; ts.push(now - last); last = now; if (now - t0 > 3500) { G.Game.renderFrame = orig; R.info.autoReset = true; ts.shift(); ts.sort((a, b) => a - b);
      r({ fps: +(frames / ((now - t0) / 1000)).toFixed(1), p50: +ts[ts.length >> 1].toFixed(2), p99: +ts[Math.floor(ts.length * 0.99)].toFixed(2), cpuMs: +(cpu / n).toFixed(2), calls: Math.round(calls / n), kTris: Math.round(tris / n / 1000), prog: R.info.programs.length, tex: R.info.memory.textures, geo: R.info.memory.geometries }); }
    else requestAnimationFrame(f); };
  requestAnimationFrame(f); })`;
const row = (label, o) => console.log(label.padEnd(30) + `${String(o.fps).padStart(7)} fps  p50 ${String(o.p50).padStart(5)} ms  p99 ${String(o.p99).padStart(5)}  cpu ${String(o.cpuMs).padStart(5)} ms  calls ${String(o.calls).padStart(4)}  tris ${String(o.kTris).padStart(5)}k  programs ${o.prog}  tex ${o.tex}  geo ${o.geo}`);
try {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "playing"')) break; } catch (e) { /* loading */ } }
  await sleep(2500);
  console.log('GPU:', await b.ev('window.__game.G.gpu.name'), '| viewport', await b.ev('innerWidth + "x" + innerHeight + " @" + devicePixelRatio'));
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    await b.ev(`window.__game.Game.applyQuality('${tier}', true); 0`); await sleep(1200);
    for (const rt of ['off', 'low', 'high']) { console.log('  ..', tier, rt);
      await b.ev(`window.__game.Gfx.set('rt','${rt}'); 0`); await sleep(1200);
      row(`${tier} rt=${rt}`, await b.ev(SAMPLE));
    }
  }
  if (process.argv.includes('--ablate')) {
    await b.ev("window.__game.Game.applyQuality('high', true); window.__game.Gfx.set('rt','off'); 0"); await sleep(1500);
    row('high rt=off (reference)', await b.ev(SAMPLE));
    const abl = {
      'no shadows': "window.__game.renderer.shadowMap.enabled=false; window.__game.scene.traverse(o=>{if(o.material){[].concat(o.material).forEach(m=>m.needsUpdate=true)}}); 0",
      'bloom off': 'window.__game.composer.passes.find(p=>p.constructor.name==="UnrealBloomPass").enabled=false; 0',
    };
    for (const [k, js] of Object.entries(abl)) { await b.ev(js); await sleep(1500); row('high + ' + k, await b.ev(SAMPLE)); }
  }
  console.log('\npage errors:', b.errors.length ? b.errors.slice(0, 5) : 'none');
} finally { b.close(); setTimeout(() => process.exit(0), 500); }
