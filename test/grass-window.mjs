// Proves the grass frustum window is pure culling: for many camera poses the frame rendered with the window is compared pixel for
// pixel with the frame rendered with the whole grid.  Also prints how many grass instances are drawn.   node test/grass-window.mjs [url]
import { launch, sleep } from './cdp-lib.mjs';
const url = process.argv[2] || 'http://localhost:7777/index.html?q=high&noadapt';
const b = await launch();
const POSES = [
  ['spawn, level', {}], ['yaw 0.8', { yaw: 0.8 }], ['yaw 2.3 pitch -0.5', { yaw: 2.3, pitch: -0.5 }], ['straight down', { pitch: -1.5 }], ['look up', { pitch: 1.2, yaw: 4 }],
  ['hill, yaw 1.5', { x: -33, z: -62, yaw: 1.5 }], ['hill, yaw -2', { x: -33, z: -62, yaw: -2 }], ['valley, yaw 3.1', { x: 43, z: -58, yaw: 3.1, pitch: -0.2 }],
  ['fov 60', { yaw: 0.3, fov: 60 }], ['fov 120, wide', { yaw: 5.2, fov: 120 }], ['ADS fov 25', { yaw: 1, fov: 25 }],
];
try {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "menu"')) break; } catch (e) { /* loading */ } }
  await b.ev('window.__game.Game.begin(); 0'); await sleep(2000);
  await b.ev('window.__game.G.paused = true; window.__game.Game.frame = () => {}; performance.now = () => 987654; Date.now = () => 1.7e12; 0');
  const grab = `(on, pose) => { const g = window.__game, P = g.Player, W = g.World; W.grassWindow = on;
      if (pose.x !== undefined) { P.pos.set(pose.x, g.terrainHeight(pose.x, pose.z), pose.z); }
      P.yaw = pose.yaw || 0; P.pitch = pose.pitch || 0; g.G.camera.fov = pose.fov || 70; g.G.camera.updateProjectionMatrix();
      const gp = g.composer.passes.find((p) => p.uniforms && p.uniforms.uGrain); if (gp) gp.uniforms.uGrain.value = 0;
      for (let k = 0; k < 2; k++) { let seed = 777; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; g.Game.renderFrame(0); }
      const c = g.renderer.domElement, t = document.createElement('canvas'); t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0);
      return { d: t.getContext('2d').getImageData(0, 0, t.width, t.height).data, inst: W.grass.map((q) => q.mesh.geometry.instanceCount) }; }`;
  let worst = 0;
  for (const [name, pose] of POSES) {
    const r = await b.ev(`(() => { const grab = ${grab}; const a = grab(true, ${JSON.stringify(pose)}), f = grab(false, ${JSON.stringify(pose)}), a2 = grab(true, ${JSON.stringify(pose)});
      let diff = 0, max = 0, diff2 = 0; for (let i = 0; i < a.d.length; i += 4) { const e = Math.max(Math.abs(a.d[i] - f.d[i]), Math.abs(a.d[i + 1] - f.d[i + 1]), Math.abs(a.d[i + 2] - f.d[i + 2])); if (e) { diff++; if (e > max) max = e; } if (a.d[i] !== a2.d[i] || a.d[i + 1] !== a2.d[i + 1]) diff2++; }
      return { diff, max, repeatDiff: diff2, win: a.inst, full: f.inst, px: a.d.length / 4 }; })()`);
    worst = Math.max(worst, r.diff);
    console.log(`${name.padEnd(22)} instances ${r.win.join('/')} of ${r.full.join('/')} (${(100 * r.win.reduce((s, v) => s + v, 0) / r.full.reduce((s, v) => s + v, 0)).toFixed(0)}%)   pixels differing vs full grid: ${r.diff} (max ${r.max}/255)   [render-to-render noise: ${r.repeatDiff}]`);
  }
  console.log(worst === 0 ? '\nALL POSES PIXEL-IDENTICAL' : `\nDIFFERENCES FOUND (worst ${worst} px)`);
  console.log('errors:', JSON.stringify(b.errors.slice(0, 3)));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
