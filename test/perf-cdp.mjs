// Real-GPU benchmark: launches Edge on the dedicated GPU with a throw-away profile, drives the game over the
// DevTools protocol and reports fps for each ray-marched lighting level.   node test/perf-cdp.mjs [url]
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('Edge not found'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-perf-')), port = 9333 + Math.floor(Math.random() * 300);
const base = process.argv[2] || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const child = spawn(EDGE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--force_high_performance_gpu', '--disable-features=CalculateNativeWinOcclusion', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', '--window-position=0,0', 'about:blank'], { stdio: 'ignore', detached: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = () => { try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' }); } catch (e) { /* ignore */ } };
process.on('exit', killTree);

async function targets() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json`); const j = await r.json(); if (j.length) return j; } catch (e) { /* not up yet */ } await sleep(500); } throw new Error('no CDP'); }
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const open = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => { await open; return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
  return { send, close: () => ws.close() };
}
const evalJS = async (c, expr, awaitPromise = true) => { const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };

try {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('edge://')) || list[0];
  const c = cdp(page.webSocketDebuggerUrl);
  const info = await c.send('SystemInfo.getInfo').catch(() => null);
  console.log('GPU (system):', info && info.result && info.result.gpu && info.result.gpu.devices.slice(0, 2).map((d) => d.deviceString).join(' | '));
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 120; i++) { await sleep(1000); try { const st = await evalJS(c, 'window.__game && window.__game.G.state'); if (st === 'playing') break; } catch (e) { /* loading */ } }
  console.log('page GPU :', await evalJS(c, 'window.__game.G.gpu.name'), '| tier', await evalJS(c, 'window.__game.Settings.quality'));
  await sleep(3000);
  const fpsJS = `new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 4500) r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`;
  const rows = [];
  for (const tier of ['high', 'ultra']) {
    await evalJS(c, `window.__game.Game.applyQuality('${tier}', true); 0`); await sleep(1500);
    for (const rt of ['off', 'low', 'high']) {
      await evalJS(c, `window.__game.Gfx.set('rt','${rt}'); 0`); await sleep(1800);
      const fps = await evalJS(c, fpsJS), status = await evalJS(c, 'window.__game.Gfx.statusText()');
      rows.push({ tier, rt, fps, status });
      console.log(`${tier.padEnd(6)} rt=${rt.padEnd(5)} ${String(fps).padStart(6)} fps   [${status}]`);
    }
  }
  const errs = await evalJS(c, 'window.__game.renderer.getContext().getError()');
  console.log('GL error code after run:', errs);
  c.close();
} finally { killTree(); try { child.kill(); } catch (e) { /* ignore */ } setTimeout(() => process.exit(0), 500); }
