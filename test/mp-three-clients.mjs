// END-TO-END multiplayer acceptance run (Tests A, B, C, D, F, G of the brief) with THREE real game instances.
// Three separate Edge windows (own profile, own localStorage, GPU-rendered) load the game from three different
// addresses — localhost, 127.0.0.1 and this PC's Wi-Fi IPv4 address — and talk to one server over TCP.
// A scripted "autopilot" inside each page plays the match (aim / strafe / fire) so every instance really
// moves, shoots and gets shot.  The test then compares what every client believes with the server's state.
//   node test/mp-three-clients.mjs
import { startServer, lanAddresses } from '../server/index.mjs';
import { launch, loadGame, sleep } from './cdp-lib.mjs';

let passed = 0, failed = 0;
const ok = (c, n, x) => { if (c) { passed++; console.log('  PASS', n); } else { failed++; console.log('  FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const PORT = 7791;
const srv = await startServer({ port: PORT, debug: true, quiet: true });
const ip = (lanAddresses().find((a) => !a.virtual) || { address: '127.0.0.1' }).address;
const room = srv.room;
const info = async () => (await (await fetch(`http://127.0.0.1:${PORT}/api/debug/room`)).json());
const tp = (id, x, z) => fetch(`http://127.0.0.1:${PORT}/api/debug/tp?id=${id}&x=${x}&z=${z}`).then((r) => r.text());

import { AUTOPILOT, STOP } from './autopilot.mjs';
const browsers = {};
try {
  console.log(`server on :${PORT}; LAN address used by the clients: ${ip}`);
  const urlFor = { A: `http://localhost:${PORT}/index.html?noadapt&q=medium`, B: `http://127.0.0.1:${PORT}/index.html?noadapt&q=medium`, C: `http://${ip}:${PORT}/index.html?noadapt&q=medium` };
  const G = (k, expr) => browsers[k].ev(`(() => { const g = window.__game; return eval(${JSON.stringify(expr)}); })()`);
  for (const k of ['A', 'B', 'C']) { browsers[k] = await launch(); await loadGame(browsers[k], urlFor[k], 'menu'); }
  // the splash fades out on a timer: wait until every instance really shows its main menu (covered windows run timers slowly)
  for (const k of ['A', 'B', 'C']) for (let i = 0; i < 60 && await G(k, 'g.Menus.current') !== 'main'; i++) await sleep(500);

  console.log('\n[A] three instances, one real network session');
  await G('A', "g.Profile.setName('Alpha'); g.Menus.show('host'); 1");
  for (let i = 0; i < 20 && await G('A', "document.getElementById('hostCreate').disabled"); i++) await sleep(500);
  console.log('  host screen:', await G('A', "document.getElementById('hostStatus').textContent"), '| current:', await G('A', 'g.Menus.current'), '| errors:', JSON.stringify(browsers.A.errors.slice(0, 3)));
  await G('A', 'g.Menus.createLobby(); 1'); await sleep(2500);
  ok(await G('A', "g.Menus.current") === 'lobby', 'HOST GAME → lobby on PC 1');
  for (const [k, n] of [['B', 'Bravo'], ['C', 'Charlie']]) {
    await G(k, `g.Profile.setName('${n}'); g.Menus.show('join'); document.getElementById('jIp').value = '${ip}'; document.getElementById('jPort').value = '${PORT}'; g.Menus.connect(); 1`); await sleep(2200);
    ok(await G(k, "g.Menus.current") === 'lobby' && await G(k, "document.getElementById('joinStatus').textContent") === 'Connected', `${n} connects to ${ip}:${PORT} (status: Connected) and lands in the lobby`);
  }
  await G('A', "g.Net.send({t:'settings', settings:{killLimit: 8, duration: 5}}); 1"); await sleep(600);
  for (const k of ['A', 'B', 'C']) {
    const names = await G(k, 'g.MP.room.players.map((p) => p.name).sort().join()');
    ok(names === 'Alpha,Bravo,Charlie', `lobby on ${k} lists exactly the three connected players`, names);
  }
  ok(await G('B', 'g.MP.room.settings.killLimit') === 8, 'host match settings propagate to joiners');

  console.log('\n[B/C] three-player match: no AI, only humans');
  await G('A', "g.Net.send({t:'start'}); 1");
  for (let i = 0; i < 30; i++) { await sleep(1000); const ph = await Promise.all(['A', 'B', 'C'].map((k) => G(k, 'g.MP.phase'))); if (ph.every((p) => p === 'playing')) break; }
  for (const k of ['A', 'B', 'C']) {
    const st = await G(k, 'g.MP.stats()');
    ok(st.mode === 'mp' && st.phase === 'playing' && st.aiSoldiers === 0 && st.aiQueued === 0 && st.remoteModels === 2 && st.humanModelsInScene === 2, `client ${k}: 0 AI soldiers, exactly 2 other human characters`, st);
  }
  // stage them on the open spawn hill (the server tells each client where it was moved)
  const inf0 = await info(); const ids = Object.fromEntries(inf0.players.map((p) => [p.name, p.id]));
  await tp(ids.Alpha, 0, 84); await tp(ids.Bravo, 12, 76); await tp(ids.Charlie, -12, 76); await sleep(1800);
  for (const k of ['A', 'B', 'C']) await G(k, AUTOPILOT);
  console.log('  …autopilots are fighting for the next seconds');
  let total = 0, snap = null;
  for (let i = 0; i < 70; i++) { await sleep(1000); snap = await info(); total = snap.players.reduce((a, p) => a + p.k, 0); if (total >= 5 || snap.state !== 'playing') break; }
  // mid-fight consistency of what each client SEES (remote model vs the server's authoritative position)
  const seen = {};
  for (const k of ['A', 'B', 'C']) seen[k] = await G(k, 'g.MP.entities().map((e) => ({ id: e.id, x: e.pos.x, z: e.pos.z }))');
  const auth = (await info()).players; let maxErr = 0, compared = 0;
  for (const k of ['A', 'B', 'C']) for (const e of seen[k]) { const a = auth.find((p) => p.id === e.id); if (a && a.alive) { compared++; maxErr = Math.max(maxErr, Math.hypot(a.x - e.x, a.z - e.z)); } }
  ok(compared >= 3 && maxErr < 6, `remote players on screen match the server's positions (${compared} comparisons, worst ${maxErr.toFixed(1)} m while everybody is strafing at speed)`, { compared, maxErr });
  for (const k of ['A', 'B', 'C']) await G(k, STOP);
  await sleep(1500);

  console.log('\n[D] kills, rewards and scoreboards agree everywhere');
  snap = await info();
  total = snap.players.reduce((a, p) => a + p.k, 0); const deaths = snap.players.reduce((a, p) => a + p.d, 0);
  ok(total >= 3, `real combat happened: ${total} kills registered by the server`, snap.players.map((p) => [p.name, p.k, p.d]));
  ok(total === deaths && total === snap.events, 'every kill has exactly one victim and one event id (no duplicate kills)', { total, deaths, events: snap.events });
  for (const k of ['A', 'B', 'C']) {
    const mine = await G(k, 'g.MP.playerList().map((p) => p.name + ":" + p.k + "/" + p.d).sort().join()');
    const server = snap.players.map((p) => `${p.name}:${p.k}/${p.d}`).sort().join();
    ok(mine === server, `client ${k} scoreboard == server`, { mine, server });
  }
  for (const [k, n] of [['A', 'Alpha'], ['B', 'Bravo'], ['C', 'Charlie']]) {
    const bank = await G(k, 'g.Profile.credits'), p = snap.players.find((x) => x.name === n);
    ok(bank === p.hc, `${n}: profile balance (${bank} HC) == the server's authoritative reward total (${p.hc} HC)`, { bank, server: p.hc });
  }

  console.log('\n[F] equipped camo is visible to the other players');
  await G('B', "g.Profile.credit(1000,'test','t'); g.Profile.purchase('carbon'); 1"); await sleep(500);
  await G('B', "g.Profile.equip('carbon'); g.Shop.applyEquipped(); 1"); await sleep(900);
  for (const k of ['A', 'C']) ok(await G(k, "[...g.MP.remotes.values()].find((r) => r.name === 'Bravo').rifle.root.userData.camoId") === 'carbon', `${k} sees Bravo's rifle in Carbon Fiber`);

  console.log('\n[G] unexpected disconnect');
  browsers.C.close(); delete browsers.C; await sleep(2500);
  for (const k of ['A', 'B']) {
    const st = await G(k, 'g.MP.stats()');
    ok(st.connectedPlayers === 2 && st.remoteModels === 1 && st.aiSoldiers === 0, `client ${k}: Charlie vanished from the world and the list; session continues`, st);
  }
  ok((await info()).players.length === 2, 'server dropped the disconnected player');

  console.log('\n[match end] kill limit → results → completion bonus once');
  const pre = await info(), hc0 = Object.fromEntries(pre.players.map((p) => [p.name, p.hc]));
  const bank0 = { Alpha: await G('A', 'g.Profile.credits'), Bravo: await G('B', 'g.Profile.credits') };
  srv.room.settings.killLimit = 4;                       // test acceleration: the room allows the host to change this in the lobby; here it is lowered mid-match so the run is short
  { const cur = await info(); const ids2 = Object.fromEntries(cur.players.map((p) => [p.name, p.id])); await tp(ids2.Alpha, 0, 84); await tp(ids2.Bravo, 14, 74); await sleep(1500); }
  for (const k of ['A', 'B']) await G(k, AUTOPILOT);
  let ended = false;
  for (let i = 0; i < 150 && !ended; i++) { await sleep(1000); const s = await info(); ended = s.state !== 'playing'; }
  for (const k of ['A', 'B']) await G(k, STOP);
  ok(ended, 'the match ended by itself (kill limit reached)');
  await sleep(1800);
  const fin = await info();
  for (const k of ['A', 'B']) ok(await G(k, "g.Menus.current") === 'results', `client ${k} shows the results screen`);
  const heroA = await G('A', "document.getElementById('rsHero').textContent"), heroB = await G('B', "document.getElementById('rsHero').textContent");
  ok((/VICTORY/.test(heroA)) !== (/VICTORY/.test(heroB)), 'exactly one of the two players is shown as the winner', { heroA, heroB });
  for (const [k, n] of [['A', 'Alpha'], ['B', 'Bravo']]) {
    const bank = await G(k, 'g.Profile.credits'), p = fin.players.find((x) => x.name === n);
    ok(bank - bank0[n] === p.hc - hc0[n], `${n}: balance rose by ${bank - bank0[n]} HC = the server's reward delta (${p.hc - hc0[n]} HC) incl. one +${srv.cfg.economy.rewards.matchComplete} match bonus`, { bank, bank0: bank0[n], hc: p.hc, hc0: hc0[n] });
  }
  const resA = await G('A', "document.getElementById('rsReward').textContent");
  ok(/Match completion\+100/.test(resA), 'results screen shows the +100 completion bonus once', resA);

  console.log('\n[rematch] back to the lobby, then a second match');
  await G('A', "g.Net.send({t:'toLobby'}); 1"); await sleep(1200);
  await G('B', "document.querySelector('#scResults [data-act=\"lobby\"]').click(); 1"); await sleep(1200);   // B presses RETURN TO LOBBY; A deliberately stays on the results screen
  ok(await G('B', 'g.Menus.current') === 'lobby' && await G('B', "document.getElementById('lbCount').textContent") === '2 / 8', 'B is back in the lobby with both players listed');
  ok(await G('A', 'g.Menus.current') === 'results', 'A is still looking at the results screen');
  await G('A', "g.Net.send({t:'start'}); 1");
  for (let i = 0; i < 20; i++) { await sleep(1000); const ph = await Promise.all(['A', 'B'].map((k) => G(k, 'g.MP.phase'))); if (ph.every((p) => p === 'playing')) break; }
  for (const k of ['A', 'B']) {
    const st = await G(k, 'g.MP.stats()');
    ok(st.phase === 'playing' && await G(k, 'g.G.state') === 'playing' && !(await G(k, 'g.Menus.current')) && st.remoteAlive === 1 && st.aiSoldiers === 0, `client ${k} is in the second match (no menu on screen, 1 other human, 0 AI)`, st);
  }
  ok((await info()).players.every((p) => p.k === 0 && p.d === 0), 'scores were reset for the new match');

  console.log('\n[health]');
  for (const k of ['A', 'B']) { const real = browsers[k].errors.filter((e) => !/ResizeObserver|favicon/i.test(e)); ok(real.length === 0, `client ${k}: no console errors`, real.slice(0, 3)); }
} catch (e) { failed++; console.log('TEST ERROR', e && e.stack || e); }
finally { for (const b of Object.values(browsers)) b.close(); srv.close(); }
console.log(`\n${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed ? 1 : 0), 500);
