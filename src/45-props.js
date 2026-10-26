/* =====================================================================
 *  HOLLOW RIDGE  -  45-props.js
 *  Buildings, sandbag emplacements, crates, steel targets, supply crate
 * ===================================================================== */

const Props = {
  targets: [],     // steel practice targets
  supply: null,    // ammo/health crate {x,y,z}
};

function makeBoxGeo(sx, sy, sz, cx, cy, cz, rotY) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}

/** split a wall of length L into solid pieces around openings */
function wallPieces(L, H, openings) {
  const out = [];
  let cursor = -L / 2;
  const sorted = openings.slice().sort((a, b) => a.x0 - b.x0);
  for (const o of sorted) {
    if (o.x0 > cursor) out.push({ x0: cursor, x1: o.x0, y0: 0, y1: H });
    if (o.y0 > 0) out.push({ x0: o.x0, x1: o.x1, y0: 0, y1: o.y0 });
    if (o.y1 < H) out.push({ x0: o.x0, x1: o.x1, y0: o.y1, y1: H });
    cursor = o.x1;
  }
  if (cursor < L / 2) out.push({ x0: cursor, x1: L / 2, y0: 0, y1: H });
  return out;
}

function buildBuilding(scene, b, ruined) {
  const baseY = terrainHeight(b.x, b.z);
  const geos = [];
  const T = 0.32, H = ruined ? 3.0 : 3.1;
  const cosR = Math.cos(b.rot), sinR = Math.sin(b.rot);
  const addBox = (lx, ly, lz, sx, sy, sz, localRot = 0) => {
    // local (building space) -> world
    const wx = b.x + lx * cosR - lz * sinR, wz = b.z + lx * sinR + lz * cosR;
    geos.push(makeBoxGeo(sx, sy, sz, wx, baseY + ly, wz, -(b.rot + localRot)));
    Colliders.box(wx, baseY + ly, wz, sx / 2, sy / 2, sz / 2, b.rot + localRot, 'concrete', true);
  };
  // NB: three rotates counter-clockwise about +Y (x->-z); collider rot maps local x to (cos,sin) in (x,z), so geometry uses -rot.
  const wall = (cx, cz, L, along, openings, hCut) => {
    // along: 0 -> wall extends along local x ; 1 -> along local z
    for (const p of wallPieces(L, H, openings)) {
      const ph = Math.min(p.y1, hCut ?? H) - p.y0; if (ph <= 0.02) continue;
      const mid = (p.x0 + p.x1) / 2, len = p.x1 - p.x0;
      const ly = (p.y0 + Math.min(p.y1, hCut ?? H)) / 2;
      if (along === 0) addBox(cx + mid, ly, cz, len, ph, T);
      else addBox(cx, ly, cz + mid, T, ph, len);
    }
  };
  const w = b.w, d = b.d;
  const rng = mulberry32(Math.floor(b.x * 31 + b.z * 17));
  // front (+z), back (-z)
  wall(0, d / 2, w, 0, [{ x0: -w * 0.32, x1: -w * 0.32 + 1.5, y0: 0, y1: 2.25 }, { x0: w * 0.18, x1: w * 0.18 + 1.5, y0: 1.05, y1: 2.15 }], ruined ? 2.4 : H);
  wall(0, -d / 2, w, 0, [{ x0: -0.8, x1: 0.8, y0: 1.05, y1: 2.15 }], ruined ? 3.0 : H);
  wall(-w / 2, 0, d, 1, [{ x0: -0.8, x1: 0.8, y0: 1.05, y1: 2.15 }], ruined ? 1.6 : H);
  wall(w / 2, 0, d, 1, [{ x0: -d * 0.28, x1: -d * 0.28 + 1.4, y0: 1.05, y1: 2.15 }], ruined ? 3.0 : H);
  // interior partition with a doorway
  wall(w * 0.12, 0, d, 1, [{ x0: -0.5, x1: 0.5, y0: 0, y1: 2.15 }], ruined ? 1.8 : H);
  // floor slab (top just above the flattened terrain)
  addBox(0, -0.12, 0, w - 0.1, 0.3, d - 0.1);
  Colliders.list[Colliders.list.length - 1].solid = false;      // floor must not block walking
  // roof
  if (!ruined) {
    addBox(0, H + 0.17, 0, w + 0.9, 0.34, d + 0.9);
  } else {
    // collapsed roof slabs
    addBox(-w * 0.28, H - 0.6, -d * 0.1, w * 0.4, 0.22, d * 0.5, 0.0);
    geos[geos.length - 1].rotateZ(0.0);
  }
  const merged = mergeGeometries(geos.map((g) => { const n = g.toNonIndexed(); const o = new THREE.BufferGeometry(); o.setAttribute('position', n.attributes.position); o.setAttribute('normal', n.attributes.normal); o.setAttribute('uv', n.attributes.uv); return o; }));
  const mat = makeTriplanarMaterial({ albedo: TEX.concreteAlbedo, normal: TEX.concreteNormal, scale: 0.26, roughness: 0.93, tint: ruined ? new THREE.Color(0.8, 0.78, 0.74) : new THREE.Color(0.95, 0.93, 0.88), normalStrength: 0.45 });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  // interior props
  addCrate(b.x + (-w * 0.3) * cosR - (-d * 0.25) * sinR, b.z + (-w * 0.3) * sinR + (-d * 0.25) * cosR, 1.0, 0.9, 0.8, rng() * 3);
  addCrate(b.x + (w * 0.3) * cosR - (d * 0.2) * sinR, b.z + (w * 0.3) * sinR + (d * 0.2) * cosR, 0.8, 0.8, 0.8, rng() * 3);
}

/* ---------------------------------------------------- crates & sandbags */
let _crateMesh = null, _crateList = [];
function addCrate(x, z, sx, sy, sz, rot, metal) {
  _crateList.push({ x, z, sx, sy, sz, rot, metal: !!metal });
  const y = terrainHeight(x, z);
  Colliders.box(x, y + sy / 2, z, sx / 2, sy / 2, sz / 2, rot, metal ? 'metal' : 'wood', true);
}
function buildCrates(scene) {
  const woodGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.03);
  const woodMat = addWetPatch(new THREE.MeshStandardMaterial({ map: TEX.woodAlbedo, normalMap: TEX.woodNormal, roughness: 0.85, color: 0xcfc4b0 }));
  const metalMat = addWetPatch(new THREE.MeshStandardMaterial({ map: TEX.metalAlbedo, normalMap: TEX.metalNormal, roughness: 0.55, metalness: 0.6, color: 0x7d8a6a }));
  const wood = _crateList.filter((c) => !c.metal), metal = _crateList.filter((c) => c.metal);
  for (const [list, mat] of [[wood, woodMat], [metal, metalMat]]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(woodGeo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((c, i) => {
      p.set(c.x, terrainHeight(c.x, c.z) + c.sy / 2 - 0.02, c.z);
      q.setFromAxisAngle(_up, -c.rot); s.set(c.sx, c.sy, c.sz);
      m.compose(p, q, s); im.setMatrixAt(i, m);
    });
    im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  }
  _crateList = [];
}

let _bagList = [];
function sandbagWall(x, z, yaw, length, layers = 3) {
  const bagL = 0.62;
  const n = Math.max(2, Math.round(length / (bagL * 0.92)));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let layer = 0; layer < layers; layer++) {
    const off = layer % 2 ? bagL * 0.45 : 0;
    for (let i = 0; i < n; i++) {
      const lx = (i - n / 2 + 0.5) * bagL * 0.92 + off - (layer % 2 ? bagL * 0.2 : 0);
      if (Math.abs(lx) > length / 2 + 0.2) continue;
      const jx = (Math.random() - 0.5) * 0.04, jz = (Math.random() - 0.5) * 0.05;
      const wx = x + (lx + jx) * c - jz * s, wz = z + (lx + jx) * s + jz * c;
      _bagList.push({ x: wx, z: wz, y: layer * 0.2, rot: yaw + (Math.random() - 0.5) * 0.12, base: terrainHeight(x, z) });
    }
  }
  const hh = layers * 0.2;
  Colliders.box(x, terrainHeight(x, z) + hh / 2, z, length / 2, hh / 2, 0.22, yaw, 'sand', true);
}
function buildSandbags(scene) {
  if (!_bagList.length) return;
  const geo = new RoundedBoxGeometry(0.62, 0.22, 0.38, 3, 0.08);
  const mat = addWetPatch(new THREE.MeshStandardMaterial({ map: TEX.sandbagAlbedo, normalMap: TEX.sandbagNormal, roughness: 0.95, color: 0xd8cfb8 }));
  const im = new THREE.InstancedMesh(geo, mat, _bagList.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  _bagList.forEach((b, i) => {
    p.set(b.x, terrainHeight(b.x, b.z) + b.y + 0.09, b.z);
    q.setFromAxisAngle(_up, -b.rot);
    const k = 0.92 + Math.random() * 0.16; s.set(k, 0.9 + Math.random() * 0.2, k);
    m.compose(p, q, s); im.setMatrixAt(i, m);
  });
  im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
  scene.add(im);
  _bagList = [];
}

/* ------------------------------------------------------ steel targets */
function buildTargets(scene) {
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xb23a22, roughness: 0.5, metalness: 0.7 });
  const postMat = new THREE.MeshStandardMaterial({ map: TEX.woodAlbedo, roughness: 0.9, color: 0xbdb099 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.3 });
  for (const [x, z] of LAYOUT.targets) {
    const y = terrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(LAYOUT.spawn.x - x, LAYOUT.spawn.z - z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), postMat); post.position.y = 1.25; post.castShadow = true; g.add(post);
    const hinge = new THREE.Group(); hinge.position.set(0, 2.5, 0.1); g.add(hinge);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 28), plateMat); plate.rotation.x = Math.PI / 2; plate.position.y = -0.5; plate.castShadow = true; hinge.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.015, 8, 28), ringMat); ring.position.set(0, -0.5, 0.025); hinge.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 8, 24), ringMat); ring2.position.set(0, -0.5, 0.025); hinge.add(ring2);
    scene.add(g);
    // hit sphere in world space
    const centre = new THREE.Vector3(0, 2.0, 0.1).applyEuler(g.rotation).add(g.position);
    const t = { group: g, hinge, x: centre.x, y: centre.y, z: centre.z, r: 0.37, down: 0, state: 0, timer: 0 };
    Props.targets.push(t);
  }
}
function updateTargets(dt) {
  for (const t of Props.targets) {
    if (t.state === 1) {            // falling
      t.down = Math.min(1, t.down + dt * 4.5);
      t.timer -= dt;
      if (t.timer <= 0) t.state = 2;
    } else if (t.state === 2) {     // resetting
      t.down = Math.max(0, t.down - dt * 1.2);
      if (t.down <= 0) t.state = 0;
    }
    t.hinge.rotation.x = easeOutCubic(t.down) * 1.4 + Math.sin(performance.now() * 0.03) * (t.wobble || 0) * 0.15;
    if (t.wobble) t.wobble = Math.max(0, t.wobble - dt * 3);
  }
}
function hitTarget(t) { t.state = 1; t.timer = 3.2; t.wobble = 1; }

/* ------------------------------------------------------- supply crate */
function buildSupplyCrate(scene) {
  const { x, z } = LAYOUT.ammoCrate;
  const y = terrainHeight(x, z);
  const c = makeCanvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#5f6b3e'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 20, 1 + Math.random() * 3); }
  ctx.fillStyle = '#e8e8e0'; ctx.fillRect(100, 56, 56, 144); ctx.fillRect(56, 100, 144, 56);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(110, 66, 36, 124); ctx.fillRect(66, 110, 124, 36);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 244, 244);
  const tex = canvasTex(c, { repeat: false });
  const mat = addWetPatch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.5 }));
  const geo = new RoundedBoxGeometry(1.2, 0.8, 0.8, 2, 0.04);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + 0.4, z); mesh.rotation.y = 0.35; mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  Colliders.box(x, y + 0.4, z, 0.6, 0.4, 0.4, -0.35, 'metal', true);
  Props.supply = { x, y, z };
}

/* ======================================================== level layout */
function buildProps(scene) {
  // buildings
  LAYOUT.buildings.forEach((b, i) => buildBuilding(scene, b, i === 1));

  // sandbag emplacements + crates along the fortified line
  const sb = (x, z, yaw, len, layers) => sandbagWall(x, z, yaw, len, layers);
  sb(-30, -53, 0.1, 5.5, 3); sb(-6, -48, -0.05, 6, 3); sb(18, -47, 0.05, 5.5, 3); sb(40, -48, 0.12, 5, 3); sb(63, -52, -0.1, 5.5, 3); sb(-54, -54, 0.0, 5, 3);
  sb(-28, -63, 1.5, 3, 2); sb(14, -60, 1.45, 3.5, 2); sb(34, -58, -1.45, 3, 2);
  sb(-16, -86, 0.4, 5.5, 3); sb(30, -86, -0.35, 5, 3); sb(-80, -86, 0.05, 6, 2); sb(100, -86, 0.1, 6, 2);
  // field barricade near the road
  sb(-60, -22, 0.2, 7, 2); sb(66, -26, -0.25, 7, 2);
  // spawn-side cover
  sb(-14, 76, 0.1, 4.5, 2); sb(20, 70, -0.3, 4.5, 2);
  // crates
  const cr = (x, z, s, rot, m) => addCrate(x, z, s * 1.1, s * 0.85, s, rot, m);
  cr(-22, -57, 1.0, 0.3); cr(-20.6, -56.6, 0.8, 1.2); cr(10, -52, 1.0, 0.1, true); cr(24, -55, 0.9, 0.8); cr(48, -57, 1.0, 0.2, true); cr(-48, -61, 0.9, 0.9);
  cr(-4, -80, 1.0, 0.2); cr(-3, -79.2, 0.8, 0.7); cr(36, -82, 1.0, 0.3, true); cr(-62, -92, 1.0, 0.4); cr(88, -90, 1.0, 1.2);
  cr(-9, 82, 1.0, 0.2); cr(14, 80, 1.0, 0.9, true);
  // jersey barrier blocks along the road
  for (let i = 0; i < 4; i++) {
    const x = -40 + i * 1.6, z = -36.6 + i * 0.1;
    addCrate(x, z, 1.5, 0.8, 0.5, 0.05, true);
  }
  buildCrates(scene);
  buildSandbags(scene);
  buildTargets(scene);
  buildSupplyCrate(scene);
}
