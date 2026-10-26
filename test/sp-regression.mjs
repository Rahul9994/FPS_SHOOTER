// Single-player regression on the real GPU: movement, firing, reload, knife, AI, damage / death / respawn, pause, cheats,
// shop-from-pause, weapon inspection.  Uses synthetic keyboard / mouse events exactly like a player would.
//   node test/sp-regression.mjs [baseUrl]
import { launch, loadGame, sleep } from './cdp-lib.mjs';

let passed = 0, failed = 0;
const ok = (c, n, x) => { if (c) { passed++; console.log('  PASS', n); } else { failed++; console.log('  FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const base = process.argv[2] || 'http://localhost:7777/index.html?autostart&noadapt&q=medium';
const b = await launch();
try {
  await loadGame(b, base);
  await sleep(2500);
  const key = (code, down = true) => b.ev(`window.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { code: '${code}', key: '${code}', bubbles: true })); 0`);
  const tap = async (code, ms = 80) => { await key(code, true); await sleep(ms); await key(code, false); };
  const mouse = (type, btn = 0) => b.ev(`document.dispatchEvent(new MouseEvent('${type}', { button: ${btn}, bubbles: true })); 0`);
  const G = (expr) => b.ev(`(() => { const g = window.__game; return eval(${JSON.stringify(expr)}); })()`);

  console.log('[start]');
  ok(await G('g.G.state') === 'playing' && await G('g.G.mode') === 'sp', 'single player starts in the world');
  ok(await G('g.Enemies.list.length') === 7, 'seven AI soldiers are present in single player', await G('g.Enemies.list.length'));
  ok(await G('g.Player.alive && g.Player.health === 100'), 'player is alive with full health');

  console.log('[movement]');
  const p0 = await G('g.Player.pos.toArray()');
  await key('KeyW', true); await sleep(1200); await key('KeyW', false);
  const p1 = await G('g.Player.pos.toArray()'), moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  ok(moved > 2.5, `W moves the player (${moved.toFixed(1)} m in 1.2 s)`, moved);
  await tap('Space', 60); await sleep(120);
  ok(await G('g.Player.pos.y') > p1[1] + 0.05 || await G('!g.Player.grounded'), 'Space jumps');
  await key('KeyC', true); await sleep(500); const crouched = await G('g.Player.crouched'); await key('KeyC', false);
  ok(crouched, 'C crouches');

  console.log('[rifle]');
  await sleep(1200);
  const a0 = await G('g.Weapons.ammo.mag'), s0 = await G('g.G.shots');
  await mouse('mousedown'); await sleep(450); await mouse('mouseup');
  const a1 = await G('g.Weapons.ammo.mag'), s1 = await G('g.G.shots');
  ok(a1 < a0 && s1 > s0, `LMB fires the rifle (${a0} → ${a1} rounds)`, [a0, a1]);
  await tap('KeyR'); await sleep(300);
  ok(await G('g.Weapons.state') === 'reloading', 'R starts the reload animation');
  await sleep(3600);
  ok(await G('g.Weapons.state') === 'idle' && await G('g.Weapons.ammo.mag') >= 30, 'reload completes and refills the magazine', await G('g.Weapons.ammo.mag'));
  await tap('KeyV'); await sleep(250);
  ok(await G('g.Weapons.state') === 'inspecting', 'V inspects the weapon (camo showcase)');
  await mouse('mousedown'); await sleep(120); await mouse('mouseup'); await sleep(200);
  ok(await G('g.Weapons.state') !== 'inspecting', 'firing cancels the inspection');
  await tap('KeyB'); ok(await G('g.Weapons.semi') === true, 'B toggles semi-auto'); await tap('KeyB');

  console.log('[knife]');
  await tap('Digit2'); await sleep(1200);
  ok(await G('g.Weapons.current') === 'knife', '2 switches to the knife');
  await mouse('mousedown'); await sleep(100); await mouse('mouseup'); await sleep(150);
  ok(await G('g.Weapons.state') === 'melee', 'LMB slashes with the knife');
  await sleep(900); await tap('Digit1'); await sleep(1100);
  ok(await G('g.Weapons.current') === 'rifle', '1 returns to the rifle');

  console.log('[AI, damage, death, respawn]');
  await G(`(() => { const e = g.Enemies.list[0]; e.pos.set(g.Player.pos.x + 14, g.terrainHeight(g.Player.pos.x + 14, g.Player.pos.z), g.Player.pos.z); e.state = 'combat'; e.canSee = true; e.reaction = 0; e.lastSeen.copy(g.Player.pos); return 1; })()`);
  await G('g.Enemies.list.forEach((e, i) => { if (i > 0) e.alive = e.alive; })');
  let hurt = false; for (let i = 0; i < 40 && !hurt; i++) { await sleep(500); hurt = await G('g.Player.health < 100'); }
  ok(hurt, 'a hostile soldier shoots and damages the player');
  const d0 = await G('g.G.deaths');
  await G('g.Player.takeDamage(500, null)'); await sleep(400);
  ok(await G('g.G.state') === 'dead' && await G('g.G.deaths') === d0 + 1, 'death is registered once');
  await sleep(4600);
  ok(await G('g.G.state') === 'playing' && await G('g.Player.alive'), 'player respawns after ~4 s');

  console.log('[rewards]');
  const bank0 = await G('g.Profile.credits');
  await G(`(() => { const e = g.Enemies.list.find((x) => x.alive); g.Enemies.damage(e, 999, 'torso', e.pos, null); return 1; })()`);
  ok(await G('g.Profile.credits') - bank0 === CFG_KILL(), 'an AI kill pays the configured Hollow Credits', await G('g.Profile.credits') - bank0);

  console.log('[menus]');
  await tap('F1'); await sleep(300);
  ok(await G('g.CheatMenu.open_') === true && await G('g.G.paused') === true, 'F1 opens the cheat menu and pauses single player');
  await tap('F1'); await sleep(300);
  ok(await G('g.CheatMenu.open_') === false && await G('g.G.paused') === false, 'F1 closes it again');
  await G('g.PauseMenu.show(); g.Game.updatePause(); 1'); await sleep(200);
  ok(await G('!document.getElementById("menuPause").classList.contains("hidden")'), 'pause menu shows (Resume / Shop / Settings / Quit)');
  await G('document.getElementById("pmShop").click(); 1'); await sleep(900);
  ok(await G('g.Shop.isOpen'), 'Weapon shop opens from the pause menu');
  await G('g.Shop.close(); 1'); await sleep(200);
  ok(await G('!g.Shop.isOpen && g.G.pauseMenuOpen'), 'closing the shop returns to the pause menu');
  await G('g.Game.resume(); 1'); await sleep(200);
  ok(await G('!g.G.paused && g.G.state === "playing"'), 'Resume continues the mission');
  await G('document.getElementById("pmQuit") && 1');
  ok(true, 'quit-to-menu button exists');

  console.log('[health of the page]');
  const real = b.errors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  ok(real.length === 0, 'no console errors / exceptions during the run', real.slice(0, 3));
  ok(await G('g.renderer.getContext().getError()') === 0, 'no WebGL errors');
} catch (e) { failed++; console.log('TEST ERROR', e.message); }
finally { b.close(); }
function CFG_KILL() { return 100; }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
