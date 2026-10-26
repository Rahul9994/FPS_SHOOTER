// Test E: earn credits → purchase → equip → RESTART THE GAME (fresh page load, same browser profile) → everything is still there.
//   node test/shop-persist.mjs
import { startServer } from '../server/index.mjs';
import { launch, loadGame, sleep } from './cdp-lib.mjs';

let passed = 0, failed = 0;
const ok = (c, n, x) => { if (c) { passed++; console.log('  PASS', n); } else { failed++; console.log('  FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const PORT = 7796, srv = await startServer({ port: PORT, quiet: true });
const b = await launch();
const G = (e) => b.ev(`(() => { const g = window.__game; return eval(${JSON.stringify(e)}); })()`);
try {
  const url = `http://localhost:${PORT}/index.html?noadapt&q=medium`;
  await loadGame(b, url, 'menu'); for (let i = 0; i < 40 && await G('g.Menus.current') !== 'main'; i++) await sleep(300);
  await G("localStorage.removeItem('hollowRidge.profile.v1'); g.Profile.load(); 1");
  ok(await G('g.Profile.credits') === 0 && await G('g.Profile.equipped') === 'factory', 'fresh profile: 0 HC, factory finish');

  // earn credits the real way: eliminate AI soldiers in single player
  await G('g.Menus.hideAll(); g.Game.startSP(); 1'); await sleep(1500);
  for (let i = 0; i < 3; i++) await G("(() => { const e = g.Enemies.list.find((x) => x.alive); g.Enemies.damage(e, 999, 'torso', e.pos, null); return 1; })()");
  const earned = await G('g.Profile.credits');
  ok(earned === 100 + 100 + 250, `3 eliminations paid ${earned} HC (100 + 100 + 100 + 150 streak bonus)`, earned);
  await G('g.Game.exitToMenu(); 1'); await sleep(600);

  // shop UI: cannot afford gold; buy woodland (100) through the actual buttons; try to buy it twice
  await G("g.Shop.open({from:'main'}); 1"); await sleep(600);
  await G("g.Shop.select('gold'); 1"); await sleep(200);
  await G("document.getElementById('shBuy').click(); 1"); await sleep(100);
  ok(/Not enough Hollow Credits/.test(await G("document.getElementById('shMsg').textContent")) && await G('g.Profile.credits') === earned, 'unaffordable item: error message, balance untouched');
  await G("g.Shop.select('woodland'); 1"); await sleep(200);
  await G("document.getElementById('shBuy').click(); 1"); await sleep(100);
  const confirmMsg = await G("document.getElementById('shMsg').textContent");
  await G("document.getElementById('shBuy').click(); 1"); await sleep(500);
  const after = await G('g.Profile.credits');
  ok(after === earned - 100 && await G("g.Profile.owns('woodland')"), `purchase deducted exactly 100 HC once (${earned} → ${after}); double click did not charge twice`);
  ok(/Purchased Military Woodland/.test(confirmMsg), 'confirmation message is shown', confirmMsg);
  await G("document.getElementById('shEquip').click(); 1"); await sleep(300);
  ok(await G('g.Profile.equipped') === 'woodland' && await G('g.Viewmodel.rifle.root.userData.camoId') === 'woodland', 'EQUIP puts the finish on the first-person rifle');

  // restart: reload the page (same profile directory)
  await loadGame(b, url + '&again=1', 'menu'); for (let i = 0; i < 40 && await G('g.Menus.current') !== 'main'; i++) await sleep(300);
  ok(await G('g.Profile.credits') === after && await G("g.Profile.owns('woodland')") && await G('g.Profile.equipped') === 'woodland', 'after restarting the game: balance, ownership and equipped finish persisted');
  ok(await G('g.Viewmodel.rifle.root.userData.camoId') === 'woodland', 'the restarted game spawns with the equipped camo on the rifle');
  ok(await G("document.getElementById('pcEq').textContent") === 'Equipped: Military Woodland', 'main menu shows the equipped finish');
  console.log('errors:', b.errors.slice(0, 3));
} catch (e) { failed++; console.log('TEST ERROR', e.message); }
finally { b.close(); srv.close(); }
console.log(`\n${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed ? 1 : 0), 300);
