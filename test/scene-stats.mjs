// Where do the triangles / draw calls go?  node test/scene-stats.mjs [url]   (prints the heaviest scene objects, after frustum culling)
import { launch, sleep } from './cdp-lib.mjs';
const url = process.argv[2] || 'http://localhost:7777/index.html?autostart&noadapt&q=high';
const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
try {
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(200); try { if (await b.ev('window.__game && window.__game.G.state === "playing"')) break; } catch (e) { /* loading */ } }
  await sleep(2500);
  const r = await b.ev(`(() => {
    const g = window.__game, T = g.THREE, cam = g.G.camera, sc = g.scene;
    cam.updateMatrixWorld(); const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const rows = new Map(); let total = 0, totalAll = 0, calls = 0;
    sc.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry) return;
      const geo = o.geometry, per = geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
      const inst = o.isInstancedMesh ? o.count : (geo.isInstancedBufferGeometry && isFinite(geo.instanceCount) ? geo.instanceCount : 1), tri = per * inst;
      const inView = !o.frustumCulled || fr.intersectsObject(o);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = (o.name || '(unnamed)') + ' | ' + geo.type + ' | ' + (m && m.type) + ((o.isInstancedMesh || geo.isInstancedBufferGeometry) ? ' | inst ' + inst : '') + (o.castShadow ? ' | casts' : '');
      const r = rows.get(key) || { key, n: 0, tri: 0, triAll: 0, drawn: 0 };
      r.n++; r.triAll += tri; totalAll += tri; if (inView) { r.tri += tri; r.drawn++; total += tri; calls++; }
      rows.set(key, r);
    });
    let sh = 0, shCalls = 0, lightInfo = [];
    sc.traverse((l) => { if (l.isLight && l.castShadow && l.shadow) { l.shadow.camera.updateMatrixWorld(); lightInfo.push(l.type + ' map ' + (l.shadow.map ? l.shadow.map.width : l.shadow.mapSize.x) + ' autoUpdate ' + l.shadow.autoUpdate); } });
    const sun = (() => { let s0 = null; sc.traverse((l) => { if (l.isDirectionalLight && l.castShadow) s0 = l; }); return s0; })();
    if (sun) {
      const sf = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse));
      sc.traverseVisible((o) => {
        if (!(o.isMesh) || !o.geometry || !o.castShadow) return;
        const geo = o.geometry, per = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        const inst = o.isInstancedMesh ? o.count : (geo.isInstancedBufferGeometry && isFinite(geo.instanceCount) ? geo.instanceCount : 1);
        if (!o.frustumCulled || sf.intersectsObject(o)) { sh += per * inst; shCalls++; }
      });
    }
    const list = [...rows.values()].sort((a, b) => b.triAll - a.triAll).slice(0, 30).map((r) => r.key + '  x' + r.n + '  inview ' + r.drawn + '  tris ' + Math.round(r.tri / 1000) + 'k / ' + Math.round(r.triAll / 1000) + 'k');
    return { lights: lightInfo, shadowK: Math.round(sh / 1000), shCalls, totalK: Math.round(total / 1000), totalAllK: Math.round(totalAll / 1000), calls, list };
  })()`);
  console.log('shadow-casting lights:', r.lights.join('; '), '| sun shadow pass submits ~' + r.shadowK + 'k tris in ' + r.shCalls + ' draws');
  console.log(`visible-in-frustum triangles ${r.totalK}k of ${r.totalAllK}k submitted-if-no-culling, ${r.calls} meshes in view\n`); console.log(r.list.join('\n'));
} finally { b.close(); setTimeout(() => process.exit(0), 300); }
