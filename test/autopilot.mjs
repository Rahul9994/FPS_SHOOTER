// Scripted "autopilot" injected into a game page by the end-to-end tests: aims at the nearest other player, strafes and fires.
// TEST TOOLING ONLY - it drives the same input / weapon code a human does; it is not part of the game.
export const AUTOPILOT = `(() => {
  const g = window.__game; if (window.__ap) clearInterval(window.__ap);
  window.__ap = setInterval(() => {
    const P = g.Player; if (!P.alive || g.G.state !== 'playing' || g.MP.phase !== 'playing') { g.Input.mouse[0] = false; return; }
    g.Weapons.bloom = 0;
    let best = null, bd = 1e9, vis = false;
    for (const e of g.MP.entities()) { const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z); if (d < bd) { bd = d; best = e; vis = g.lineOfSight(P.pos.x, P.pos.y + 1.6, P.pos.z, e.pos.x, e.pos.y + 1.2, e.pos.z); } }
    const K = g.Input.keys; K.KeyA = K.KeyD = K.KeyW = K.KeyS = false;
    if (g.Weapons.ammo.mag <= 0 && g.Weapons.state === 'idle') { g.Input.mouse[0] = false; g.Weapons.reload(); }
    if (!best) { K.KeyW = true; P.yaw += 0.01; g.Input.mouse[0] = false; return; }
    const dx = best.pos.x - P.pos.x, dz = best.pos.z - P.pos.z, dy = (best.pos.y + 1.25) - (P.pos.y + 1.65);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = vis ? Math.atan2(dy, Math.hypot(dx, dz)) : 0;
    const dyaw = Math.atan2(Math.sin(wantYaw - P.yaw), Math.cos(wantYaw - P.yaw)); P.yaw += dyaw * 0.5; P.pitch += (wantPitch - P.pitch) * 0.5;
    if (!vis || bd > 30) K.KeyW = true; else if (Math.floor(performance.now() / 900) % 2) K.KeyA = true; else K.KeyD = true;
    if (!vis && Math.floor(performance.now() / 700) % 5 === 0) K.Space = true; else K.Space = false;
    g.Input.mouse[0] = vis && Math.abs(dyaw) < 0.25 && bd < 90 && g.Weapons.ammo.mag > 0;
  }, 16); return 1; })()`;
export const STOP = 'clearInterval(window.__ap); window.__game.Input.mouse[0] = false; Object.assign(window.__game.Input.keys, {KeyW:false,KeyA:false,KeyS:false,KeyD:false}); 0';

