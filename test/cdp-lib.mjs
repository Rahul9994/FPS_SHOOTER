// Tiny DevTools-protocol helper used by the real-GPU test scripts (Edge on the dedicated GPU, throw-away profile).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));

export async function launch(extraArgs = []) {
  if (!EDGE) throw new Error('Edge/Chrome not found');
  const profile = process.env.HR_PROFILE ? fs.mkdirSync(process.env.HR_PROFILE, { recursive: true }) || process.env.HR_PROFILE : fs.mkdtempSync(path.join(os.tmpdir(), 'hr-cdp-')), port = 9333 + Math.floor(Math.random() * 600);
  const child = spawn(EDGE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, process.env.HR_GPU === 'low' ? '--force_low_power_gpu' : '--force_high_performance_gpu', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', '--window-position=0,0', ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  const killTree = () => { try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' }); } catch (e) { /* ignore */ } };
  process.on('exit', killTree);
  let list = null;
  for (let i = 0; i < 60 && !list; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (j.length) list = j; } catch (e) { await sleep(500); } }
  if (!list) { killTree(); throw new Error('no CDP endpoint'); }
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('edge://')) || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [], logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error')) errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') logs.push(m.params.args.map((a) => a.value || a.description).join(' '));
  };
  const open = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => { await open; return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
  await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });     // keep rAF running even when another window (this app) is in front
  const ev = async (expr, awaitPromise = true) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }); if (r.result.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };
  return { send, ev, errors, logs, close() { try { ws.close(); } catch (e) { /* ignore */ } killTree(); try { child.kill(); } catch (e) { /* ignore */ } } };
}

export async function loadGame(b, url, waitState = 'playing', timeoutS = 120) {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < timeoutS; i++) { await sleep(1000); try { const st = await b.ev('window.__game && window.__game.G.state'); if (st === waitState) return; } catch (e) { /* still loading */ } }
  throw new Error('game did not reach state ' + waitState);
}
