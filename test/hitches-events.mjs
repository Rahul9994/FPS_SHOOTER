// Frame-time hitches around one-off events that the normal play script does not hit: first death + respawn, first AI kill (hit effects, ragdoll,
// kill banner / credits), first hit taken, F1 / pause menu, first spawn of a soldier.   node test/hitches-events.mjs [url]
import { launch, loadGame, sleep } from './cdp-lib.mjs';
const url = process.argv.find((a, i) => i > 1 && /^https?:|^file:/.test(a)) || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const b = await launch();
try {
  await loadGame(b, url); await sleep(2500);
  await b.ev(`(() => { const ts = [], marks = []; window.__ev = { ts, marks }; const g = window.__game, R = g.renderer; let last = performance.now(), progs = R.info.programs.length;
    const f = (now) => { ts.push([now, now - last]); last = now; if (R.info.programs.length !== progs) { marks.push([now, 'NEW SHADER PROGRAMS ' + progs + ' -> ' + R.info.programs.length]); progs = R.info.programs.length; } requestAnimationFrame(f); };
    requestAnimationFrame(f); window.__mark = (s) => marks.push([performance.now(), s]); return 1; })()`);
  const G = (expr) => b.ev(`(() => { const g = window.__game; return eval(${JSON.stringify(expr)}); })()`);
  const mark = (s) => b.ev(`window.__mark(${JSON.stringify(s)}); 0`);
  await mark('idle'); await sleep(1500);
  await mark('enemy shoots player (first hit taken)');
  await G(`(() => { const e = g.Enemies.list[0]; e.pos.set(g.Player.pos.x + 14, g.terrainHeight(g.Player.pos.x + 14, g.Player.pos.z), g.Player.pos.z); e.state = 'combat'; e.canSee = true; e.reaction = 0; e.lastSeen.copy(g.Player.pos); 1; })()`);
  for (let i = 0; i < 20 && await G('g.Player.health >= 100'); i++) await sleep(500);
  await mark('player takes lethal damage'); await G('g.Player.takeDamage(500, null)'); await sleep(1200);
  await mark('dead (waiting for respawn)'); await sleep(3500);
  await mark('respawned'); await sleep(1500);
  await mark('kill an AI soldier (headshot)'); await G(`(() => { const e = g.Enemies.list.find((x) => x.alive); if (e) g.Enemies.damage(e, 999, 'rifle', e.pos, null, true); return 1; })()`); await sleep(2500);
  await mark('F1 menu open'); await b.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F1', key: 'F1', bubbles: true })); 0`); await sleep(800);
  await mark('F1 menu close'); await b.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F1', key: 'F1', bubbles: true })); 0`); await sleep(800);
  await mark('pause menu'); await G('g.PauseMenu.show(); g.Game.updatePause(); 1'); await sleep(800); await G('g.Game.resume(); 1'); await sleep(800);
  await mark('spawn soldier + restart'); await G('g.Game.restart(); 1'); await sleep(1500);
  const { ts, marks } = JSON.parse(await b.ev('JSON.stringify(window.__ev)'));
  const phase = (t) => { let p = 'start'; for (const [mt, s] of marks) if (mt <= t && !s.startsWith('NEW')) p = s; return p; };
  const d = ts.slice(5).map((x) => x[1]); const sorted = d.slice().sort((a, c) => a - c);
  console.log(`frames ${d.length}, p50 ${sorted[d.length >> 1].toFixed(1)} ms, p99.9 ${sorted[Math.floor(d.length * 0.999)].toFixed(1)}, max ${sorted[d.length - 1].toFixed(1)}; over 20 ms: ${d.filter((x) => x > 20).length}, over 50 ms: ${d.filter((x) => x > 50).length}`);
  console.log('worst frames:'); ts.slice(5).map((x) => [x[1], x[0]]).sort((a, c) => c[0] - a[0]).slice(0, 8).forEach(([ms, t]) => console.log(`  ${ms.toFixed(1).padStart(6)} ms during "${phase(t)}"`));
  const np = marks.filter(([, s]) => s.startsWith('NEW')); console.log(np.length ? 'shader programs created during the session: ' + np.map(([t, s]) => `${s} (during "${phase(t)}")`).join('; ') : 'no shader programs were created during the session');
  console.log('errors:', JSON.stringify(b.errors.slice(0, 3)));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
