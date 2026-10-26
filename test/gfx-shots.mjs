// Takes real-GPU screenshots (Edge, dedicated GPU) of the advanced lighting: night flashlight with shadows + beam,
// wet-ground ray-marched reflections on/off, sun shafts at golden hour.   node test/gfx-shots.mjs  -> test/out/*.png
import fs from 'node:fs';
import { startServer } from '../server/index.mjs';
import { launch, loadGame, sleep } from './cdp-lib.mjs';
const PORT = 7797, srv = await startServer({ port: PORT, quiet: true });
const b = await launch();
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const G = (e) => b.ev(`(() => { const g = window.__game; return eval(${JSON.stringify(e)}); })()`);
const shot = async (name) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(new URL(`./out/${name}.png`, import.meta.url), Buffer.from(r.result.data, 'base64')); };
try {
  await loadGame(b, `http://localhost:${PORT}/index.html?autostart&noadapt&q=ultra`); await sleep(2500);
  await G("g.Profile.credit(9999,'t'); g.Profile.purchase('gold'); g.Profile.equip('gold'); g.Shop.applyEquipped(); g.G.cheats.freezeAI = true; g.G.cheats.god = true; 1");
  console.log('gfx:', await G('g.Gfx.statusText()'), '| tier', await G('g.Settings.quality'));
  const place = (x, z, yaw, pitch) => G(`g.Player.pos.set(${x}, g.terrainHeight(${x},${z}), ${z}); g.Player.yaw = ${yaw}; g.Player.pitch = ${pitch}; g.Player.vel.set(0,0,0); 1`);
  // 1. night + flashlight (shadow-casting spot + visible beam)
  await G("g.Atmos.setWeather('clear', 0.2, true); g.Atmos.setHour(0.3); g.Player.flashlightOn = true; 1");
  await place(-30, -45, 0.05, -0.12); await sleep(2500); await shot('night_flashlight');
  console.log('flash shadow on:', await G('g.Gfx.flash.castShadow'), '| cone visible:', await G('g.Gfx.cone.visible'));
  await G('g.Player.flashlightOn = false; 1');
  // 2. rain: wet ground reflections off vs high
  await G("g.Atmos.setHour(15); g.Atmos.setWeather('rain', 0.5, true); g.Atmos.cur.wet = 1; g.Atmos.tgt.wet = 1; 1");
  await place(-40, -30, -1.45, -0.1); await sleep(1500);
  await G("g.Gfx.set('rt','off'); 1"); await sleep(1500); await shot('rain_rt_off');
  await G("g.Gfx.set('rt','high'); 1"); await sleep(1800); await shot('rain_rt_high');
  // 3. golden hour with sun shafts through the trees
  await G("g.Atmos.setWeather('clear', 0.3, true); g.Atmos.setHour(17.1); g.Atmos.cur.wet = 0; g.Atmos.tgt.wet = 0; 1");
  const sy = await G('Math.atan2(-g.Atmos.sunDir.x, -g.Atmos.sunDir.z)');
  await place(-30, -25, sy + 0.2, 0.28); await sleep(1800); await shot('golden_shafts');
  console.log('errors:', b.errors.slice(0, 3), '| GL error', await G('g.renderer.getContext().getError()'));
} finally { b.close(); srv.close(); setTimeout(() => process.exit(0), 300); }
