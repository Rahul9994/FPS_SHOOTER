/* =====================================================================
 *  HOLLOW RIDGE  -  70-viewmodel.js
 *  First-person models: assault rifle, combat knife, gloved hands, sleeves
 * ===================================================================== */

/* -------------------------------------------------------------- helpers */
const rbox = (w, h, d, r = 0.004, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
function nonIndexedPNU(g) {
  const n = g.index ? g.toNonIndexed() : g;
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', n.attributes.position); o.setAttribute('normal', n.attributes.normal); o.setAttribute('uv', n.attributes.uv);
  return o;
}
class PartBuilder {
  constructor() { this.buckets = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = nonIndexedPNU(geo);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    return this;
  }
  build() {
    const grp = new THREE.Group();
    for (const [mat, geos] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.matrixAutoUpdate = true;
      grp.add(mesh);
    }
    return grp;
  }
}

/* ------------------------------------------------------------- materials */
const VM_MATS = {};
function makeViewmodelMaterials() {
  const rough = TEX.gunRough;
  VM_MATS.alu = new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 0.7, roughness: 0.48, roughnessMap: rough, bumpMap: rough, bumpScale: 0.5, envMapIntensity: 0.8 });
  VM_MATS.alu2 = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.68, roughness: 0.5, roughnessMap: rough, envMapIntensity: 1.0 });
  VM_MATS.steel = new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.95, roughness: 0.34, roughnessMap: rough, bumpMap: rough, bumpScale: 0.35, envMapIntensity: 1.2 });
  VM_MATS.dark = new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.2, roughness: 0.85 });
  const gn = TEX.gripNormal.clone(); gn.repeat.set(3, 3); gn.needsUpdate = true;
  VM_MATS.polymer = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.0, roughness: 0.62, normalMap: gn, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.8 });
  VM_MATS.rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, metalness: 0, roughness: 0.92 });
  VM_MATS.brass = new THREE.MeshStandardMaterial({ color: 0xd0a24a, metalness: 1, roughness: 0.28 });
  VM_MATS.copper = new THREE.MeshStandardMaterial({ color: 0xb06a3a, metalness: 0.9, roughness: 0.35 });
  VM_MATS.blade = new THREE.MeshStandardMaterial({ color: 0xd2d6d9, metalness: 1, roughness: 0.26, roughnessMap: TEX.bladeRough, envMapIntensity: 1.5 });
  VM_MATS.bladeDark = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: 0.9, roughness: 0.45 });
  VM_MATS.leather = new THREE.MeshStandardMaterial({ color: 0x2a1e16, metalness: 0, roughness: 0.78 });
  VM_MATS.glove = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0, roughness: 0.86 });
  VM_MATS.gloveDark = new THREE.MeshStandardMaterial({ color: 0x151617, metalness: 0, roughness: 0.7 });
  VM_MATS.gloveGrip = new THREE.MeshStandardMaterial({ color: 0x1d1e20, metalness: 0, roughness: 0.95 });
  const camo = TEX.camoAlbedo.clone(); camo.repeat.set(2, 2); camo.needsUpdate = true;
  VM_MATS.sleeve = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.92, metalness: 0, color: 0xffffff });
  VM_MATS.strap = new THREE.MeshStandardMaterial({ color: 0x3b3d2e, roughness: 0.85 });
}

/* ================================================================ RIFLE */
const RIFLE = {
  magRest: new THREE.Vector3(0, -0.063, -0.026),
  muzzle: new THREE.Vector3(0, 0.0, -0.585),
  ejection: new THREE.Vector3(0.026, 0.008, 0.03),
  lensCenter: new THREE.Vector3(0, 0.0725, 0.02),
  gripCenter: new THREE.Vector3(0, -0.108, 0.078),
  handguardCenter: new THREE.Vector3(0, -0.01, -0.26),
};

function buildMagazine() {
  const grp = new THREE.Group();
  const H = 0.145, W = 0.0275;
  const curve = (y) => -0.028 * Math.pow(y / H, 1.65);
  const pts = [];
  const N = 9;
  for (let i = 0; i <= N; i++) { const y = -i / N * H; pts.push([-(0.0195 + curve(-y)), y]); }          // rear edge, u = -z
  for (let i = N; i >= 0; i--) { const y = -i / N * H; pts.push([-(-0.0195 + curve(-y)), y]); }          // front edge
  const shape = new THREE.Shape(); shape.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 2 });
  geo.translate(0, 0, -W / 2);
  geo.rotateY(Math.PI / 2);
  const body = new THREE.Mesh(geo, VM_MATS.polymer); grp.add(body);
  // ribs on the side
  const pb = new PartBuilder();
  for (let i = 0; i < 6; i++) {
    const y = -0.032 - i * 0.0185;
    pb.add(VM_MATS.rubber, rbox(W + 0.0036, 0.0045, 0.037, 0.0015, 1), 0, y, curve(-y) + 0.0);
  }
  // base plate
  const yb = -H - 0.003, zb = curve(H);
  pb.add(VM_MATS.alu2, rbox(W + 0.004, 0.012, 0.047, 0.004, 2), 0, yb, zb - 0.0005);
  grp.add(pb.build());
  // top: follower + staggered rounds
  const top = new THREE.Group();
  top.add(new THREE.Mesh(rbox(0.021, 0.004, 0.034, 0.0015, 1), VM_MATS.steel));
  for (const z of [-0.0075, 0.0075]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0029, 0.0031, 0.025, 10), VM_MATS.brass); c.position.set(0, 0.0125, z); top.add(c);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0029, 0.012, 10), VM_MATS.copper); b.position.set(0, 0.0315, z); top.add(b);
  }
  top.position.set(0, 0.0, 0.0);
  grp.add(top);
  return grp;
}

function buildRifle() {
  const root = new THREE.Group();
  const M = VM_MATS;
  const pb = new PartBuilder();

  /* upper receiver + rails */
  pb.add(M.alu, rbox(0.040, 0.056, 0.232, 0.007, 3), 0, 0, -0.004);
  pb.add(M.alu, rbox(0.0436, 0.036, 0.034, 0.005, 2), 0, 0.002, 0.100);            // rear end cap
  pb.add(M.alu2, rbox(0.0235, 0.0075, 0.520, 0.0012, 1), 0, 0.0368, -0.145);       // flat top rail
  for (let i = 0; i < 40; i++) pb.add(M.dark, rbox(0.0242, 0.0016, 0.0042, 0.0004, 1), 0, 0.0409, 0.113 - i * 0.0128);
  /* forward assist + ejection port housing */
  pb.add(M.alu2, rbox(0.012, 0.014, 0.020, 0.004, 2), 0.0235, -0.002, 0.062);
  pb.add(M.dark, rbox(0.0035, 0.022, 0.056, 0.001, 1), 0.0205, 0.008, 0.034);
  /* handguard (free float, M-LOK) */
  pb.add(M.alu, rbox(0.052, 0.054, 0.310, 0.013, 4), 0, -0.002, -0.256);
  pb.add(M.alu2, rbox(0.055, 0.057, 0.018, 0.006, 2), 0, -0.002, -0.108);             // barrel nut collar
  pb.add(M.alu2, rbox(0.054, 0.056, 0.012, 0.005, 2), 0, -0.002, -0.408);             // front cap
  for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 6; i++) pb.add(M.dark, rbox(0.0024, 0.0075, 0.026, 0.0009, 1), side * 0.0262, -0.002, -0.14 - i * 0.043);
  for (let i = 0; i < 6; i++) pb.add(M.dark, rbox(0.0075, 0.0024, 0.026, 0.0009, 1), 0, -0.0292, -0.14 - i * 0.043);
  /* front sight base + post, gas block, ejection-port hardware */
  pb.add(M.steel, rbox(0.022, 0.013, 0.024, 0.003, 2), 0, 0.0465, -0.392);
  pb.add(M.dark, rbox(0.0032, 0.024, 0.0034, 0.001, 1), 0, 0.0635, -0.392);
  for (const sx of [-1, 1]) pb.add(M.steel, rbox(0.0026, 0.0185, 0.0042, 0.001, 1), sx * 0.0072, 0.0592, -0.392);
  pb.add(M.steel, new THREE.CylinderGeometry(0.0112, 0.0112, 0.022, 14), 0, 0, -0.431, Math.PI / 2, 0, 0);
  pb.add(M.steel, new THREE.CylinderGeometry(0.0026, 0.0026, 0.060, 8), 0, 0.0125, -0.472, Math.PI / 2, 0, 0);
  pb.add(M.alu2, rbox(0.0045, 0.020, 0.052, 0.0015, 1), 0.0262, 0.0165, 0.0335, 0, 0, -0.55);        // ejection-port cover, hinged open
  pb.add(M.alu2, rbox(0.010, 0.011, 0.014, 0.003, 1), 0.0232, 0.0035, 0.067);                         // brass deflector
  pb.add(M.steel, new THREE.CylinderGeometry(0.0036, 0.0036, 0.007, 10), 0.0222, -0.0105, 0.045, 0, 0, Math.PI / 2);   // takedown pins
  pb.add(M.steel, new THREE.CylinderGeometry(0.0036, 0.0036, 0.007, 10), 0.0222, -0.0105, -0.0905, 0, 0, Math.PI / 2);
  /* barrel + muzzle device */
  pb.add(M.steel, new THREE.CylinderGeometry(0.0072, 0.0072, 0.130, 16), 0, 0, -0.470, Math.PI / 2, 0, 0);
  pb.add(M.alu2, new THREE.CylinderGeometry(0.0115, 0.0115, 0.056, 16), 0, 0, -0.528, Math.PI / 2, 0, 0);
  pb.add(M.dark, new THREE.CylinderGeometry(0.0118, 0.0118, 0.010, 16), 0, 0, -0.528, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) pb.add(M.dark, rbox(0.0126, 0.0126, 0.0032, 0.0008, 1), 0, 0, -0.5415 - i * 0.0074);
  pb.add(M.dark, new THREE.CylinderGeometry(0.0046, 0.0046, 0.006, 12), 0, 0, -0.5575, Math.PI / 2, 0, 0);
  /* lower receiver, magwell, trigger group */
  pb.add(M.alu, rbox(0.039, 0.064, 0.150, 0.007, 3), 0, -0.047, 0.020);
  pb.add(M.alu, rbox(0.039, 0.050, 0.066, 0.006, 3), 0, -0.075, -0.027);
  pb.add(M.dark, rbox(0.030, 0.006, 0.040, 0.002, 1), 0, -0.099, -0.027);               // magwell mouth (dark)
  pb.add(M.alu2, rbox(0.005, 0.0045, 0.074, 0.0015, 1), 0, -0.0885, 0.058);                 // trigger guard bottom
  pb.add(M.alu2, rbox(0.005, 0.0425, 0.0045, 0.0015, 1), 0, -0.068, 0.0205);                 // trigger guard front
  pb.add(M.alu2, rbox(0.005, 0.032, 0.0045, 0.0015, 1), 0, -0.073, 0.094);                  // trigger guard rear
  pb.add(M.steel, rbox(0.0042, 0.021, 0.0058, 0.0015, 1), 0, -0.073, 0.047, 0.3, 0, 0);       // trigger
  pb.add(M.steel, new THREE.CylinderGeometry(0.0042, 0.0042, 0.0075, 10), 0.0235, -0.056, -0.012, 0, 0, Math.PI / 2);  // mag release
  pb.add(M.steel, rbox(0.003, 0.008, 0.022, 0.001, 1), -0.0213, -0.040, 0.026);             // bolt catch
  pb.add(M.steel, rbox(0.004, 0.006, 0.028, 0.0015, 1), -0.0216, -0.032, 0.070, 0, 0, 0.0);  // selector
  /* pistol grip */
  pb.add(M.polymer, rbox(0.0345, 0.098, 0.041, 0.013, 4), 0, -0.116, 0.092, -0.40, 0, 0);
  pb.add(M.polymer, rbox(0.030, 0.010, 0.038, 0.004, 2), 0, -0.158, 0.1085, -0.40, 0, 0);
  /* buffer tube + stock */
  pb.add(M.alu2, new THREE.CylinderGeometry(0.0125, 0.0125, 0.19, 16), 0, -0.004, 0.205, Math.PI / 2, 0, 0);
  pb.add(M.polymer, rbox(0.044, 0.078, 0.160, 0.012, 4), 0, -0.016, 0.243);
  pb.add(M.rubber, rbox(0.046, 0.084, 0.018, 0.007, 3), 0, -0.016, 0.326);
  pb.add(M.alu2, rbox(0.030, 0.012, 0.046, 0.004, 2), 0, -0.058, 0.190);                   // stock lever
  root.add(pb.build());

  /* charging handle (animated) */
  const handle = new THREE.Group();
  handle.position.set(0, 0.0345, 0.100);
  const hp = new PartBuilder();
  hp.add(M.alu2, rbox(0.033, 0.0075, 0.016, 0.003, 2), 0, 0.0022, 0.022);
  hp.add(M.steel, rbox(0.0075, 0.0075, 0.030, 0.002, 1), -0.0095, 0.0, 0.0);
  hp.add(M.steel, rbox(0.0075, 0.0075, 0.030, 0.002, 1), 0.0095, 0.0, 0.0);
  handle.add(hp.build());
  root.add(handle);
  /* bolt carrier visible in the ejection port (animated) */
  const carrier = new THREE.Mesh(rbox(0.0028, 0.017, 0.040, 0.001, 1), M.steel);
  carrier.position.set(0.0192, 0.0075, 0.016);
  root.add(carrier);
  const ejection = new THREE.Object3D(); ejection.position.copy(RIFLE.ejection); root.add(ejection);
  const muzzle = new THREE.Object3D(); muzzle.position.copy(RIFLE.muzzle); root.add(muzzle);

  /* red-dot / holographic sight */
  const sight = new THREE.Group();
  const sp = new PartBuilder();
  sp.add(M.alu2, rbox(0.032, 0.010, 0.060, 0.003, 2), 0, 0.0455, -0.006);                         // mount
  sp.add(M.alu, rbox(0.0345, 0.0085, 0.078, 0.003, 2), 0, 0.0555, 0.0);                           // bottom plate
  sp.add(M.alu, rbox(0.0345, 0.0065, 0.078, 0.003, 2), 0, 0.0895, 0.0);                           // top plate
  sp.add(M.alu, rbox(0.0068, 0.0425, 0.078, 0.003, 2), -0.0138, 0.0725, 0.0);                     // left post
  sp.add(M.alu, rbox(0.0068, 0.0425, 0.078, 0.003, 2), 0.0138, 0.0725, 0.0);                      // right post
  sp.add(M.alu2, rbox(0.032, 0.0035, 0.012, 0.0012, 1), 0, 0.0925, 0.030);                        // rear hood lip
  sp.add(M.steel, new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 12), 0.0, 0.0955, -0.012, 0, 0, 0);  // top turret cap
  sp.add(M.steel, new THREE.CylinderGeometry(0.0055, 0.0055, 0.0048, 12), 0.0182, 0.075, -0.004, 0, 0, Math.PI / 2); // battery cap
  sight.add(sp.build());
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.0212, 0.0248), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uBright: { value: 1 } },
    vertexShader: `varying vec3 vP; varying vec3 vEye;
      void main(){ vP = position; vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vP; varying vec3 vEye; uniform float uBright;
      void main(){
        vec2 d = vP.xy - vEye.xy; float r = length(d);
        float dotR = 0.00105, ringR = 0.0079;
        float dotM = smoothstep(dotR, dotR * 0.45, r);
        float ring = smoothstep(0.00042, 0.00012, abs(r - ringR));
        float ticks = 0.0;
        float ang = atan(d.y, d.x);
        ticks = smoothstep(0.0008, 0.0002, abs(r - ringR - 0.0011)) * smoothstep(0.93, 0.995, abs(cos(ang * 2.0)));
        float glow = smoothstep(0.0032, 0.0, r) * 0.22;
        float a = clamp(dotM + ring * 0.85 + ticks + glow, 0.0, 1.0);
        vec3 red = vec3(1.0, 0.03, 0.015) * (dotM * 3.2 + ring * 2.0 + ticks * 2.4 + glow * 0.9) * uBright;
        vec3 tint = vec3(0.015, 0.03, 0.04);
        gl_FragColor = vec4(red + tint, max(a, 0.075));
      }`,
  }));
  lens.position.copy(RIFLE.lensCenter); lens.position.z = 0.018;
  sight.add(lens);
  // glass reflection film (faint, view dependent)
  sight.scale.setScalar(0.88);
  sight.position.set(0, RIFLE.lensCenter.y * 0.12, 0.018 * 0.12);
  root.add(sight);
  const riser = new THREE.Mesh(rbox(0.030, 0.0062, 0.052, 0.002, 1), M.alu2); riser.position.set(0, 0.0436, -0.004); root.add(riser);

  const mags = [buildMagazine(), buildMagazine()];
  mags.forEach((m) => { m.position.copy(RIFLE.magRest); root.add(m); });
  mags[1].visible = false;

  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { root, handle, carrier, mags, muzzle, ejection, lens, sight };
}

/* ================================================================ KNIFE */
function buildKnife() {
  const root = new THREE.Group();
  const M = VM_MATS;
  // blade profile in (x along blade, y up)  -> rotate so +x points to -z
  const s = new THREE.Shape();
  s.moveTo(0, 0.0165);
  s.lineTo(0.118, 0.0165);
  s.bezierCurveTo(0.152, 0.0165, 0.178, 0.011, 0.205, 0.0005);                  // clip point (spine)
  s.bezierCurveTo(0.188, -0.006, 0.172, -0.0125, 0.150, -0.0165);                // belly
  s.lineTo(0.0, -0.0165);
  s.lineTo(0, 0.0165);
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.0030, bevelEnabled: true, bevelThickness: 0.0014, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 10 });
  bg.translate(0, 0, -0.0015);
  bg.rotateY(Math.PI / 2);                                // x -> -z
  bg.translate(0, 0, -0.056);
  const blade = new THREE.Mesh(bg, M.blade); root.add(blade);
  // fuller (dark groove) on both sides
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(rbox(0.0006, 0.0062, 0.118, 0.0003, 1), M.bladeDark); f.position.set(side * 0.0033, 0.0058, -0.126); root.add(f);
    const edge = new THREE.Mesh(rbox(0.0004, 0.0042, 0.140, 0.0002, 1), M.blade); edge.position.set(side * 0.0036, -0.0125, -0.12); edge.visible = false; root.add(edge);
  }
  // guard
  const guard = new THREE.Mesh(rbox(0.0125, 0.052, 0.0105, 0.003, 2), M.steel); guard.position.set(0, 0.0, -0.0555); root.add(guard);
  // handle: leather rings
  const hp = new PartBuilder();
  for (let i = 0; i < 9; i++) {
    const z = -0.046 + i * 0.0122;
    hp.add(i % 2 ? M.leather : M.rubber, new THREE.CylinderGeometry(0.0128 - Math.abs(i - 4) * 0.00045, 0.0128 - Math.abs(i - 4) * 0.00045, 0.0116, 14), 0, 0, z, Math.PI / 2, 0, 0);
  }
  hp.add(M.steel, new THREE.SphereGeometry(0.0145, 14, 10), 0, 0, 0.0715);
  root.add(hp.build());
  const tip = new THREE.Object3D(); tip.position.set(0, 0, -0.262); root.add(tip);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { root, tip };
}

/* ================================================================ HANDS */
const FINGERS = [
  { x: -0.0285, len: [0.036, 0.025, 0.021], r: 0.0094 },   // index
  { x: -0.0095, len: [0.040, 0.028, 0.022], r: 0.0096 },   // middle
  { x: 0.0095, len: [0.037, 0.026, 0.021], r: 0.0092 },    // ring
  { x: 0.0285, len: [0.030, 0.021, 0.018], r: 0.0085 },    // pinky
];
class HandRig {
  constructor(isLeft) {
    this.isLeft = isLeft;
    this.group = new THREE.Group();
    this.root = new THREE.Group(); this.group.add(this.root);
    if (isLeft) this.root.scale.x = -1;
    const M = VM_MATS;
    // palm + dorsal pad
    this.root.add(this._mesh(rbox(0.0845, 0.0255, 0.090, 0.011, 3), M.glove, 0, 0, 0.0));
    this.root.add(this._mesh(rbox(0.078, 0.0105, 0.058, 0.004, 2), M.gloveDark, 0, 0.0145, -0.008));
    this.root.add(this._mesh(rbox(0.0795, 0.0072, 0.0105, 0.003, 2), M.rubber, 0, 0.0155, -0.043));    // knuckle guard
    this.root.add(this._mesh(rbox(0.0805, 0.0061, 0.060, 0.003, 1), M.gloveGrip, 0, -0.0145, -0.01));  // palm grip pad
    // wrist cuff + strap
    const cuff = this._mesh(new THREE.CylinderGeometry(0.0335, 0.0365, 0.040, 16), M.gloveDark, 0, 0, 0.074); cuff.rotation.x = Math.PI / 2; this.root.add(cuff);
    const strap = this._mesh(rbox(0.050, 0.010, 0.016, 0.003, 1), M.strap, 0, 0.0185, 0.075); this.root.add(strap);
    // fingers
    this.fingers = FINGERS.map((fd) => {
      const j1 = new THREE.Group(); j1.position.set(fd.x, 0.001, -0.044);
      const j2 = new THREE.Group(); j2.position.z = -fd.len[0];
      const j3 = new THREE.Group(); j3.position.z = -fd.len[1];
      for (const [j, L] of [[j1, fd.len[0]], [j2, fd.len[1]], [j3, fd.len[2]]]) {
        const cg = new THREE.CapsuleGeometry(fd.r * (j === j3 ? 0.92 : 1), L, 3, 10); cg.rotateX(Math.PI / 2);
        const m = this._mesh(cg, M.glove, 0, 0, -L / 2); j.add(m);
      }
      const nail = this._mesh(rbox(fd.r * 1.3, 0.0035, 0.012, 0.0015, 1), M.gloveDark, 0, fd.r * 0.85, -fd.len[2] * 0.7); j3.add(nail);
      j1.add(j2); j2.add(j3);
      this.root.add(j1);
      return [j1, j2, j3];
    });
    // thumb
    const tb = new THREE.Group(); tb.position.set(-0.040, -0.002, 0.014);
    const t1 = new THREE.Group(), t2 = new THREE.Group();
    t2.position.z = -0.038;
    const cg1 = new THREE.CapsuleGeometry(0.0108, 0.038, 3, 10); cg1.rotateX(Math.PI / 2);
    const cg2 = new THREE.CapsuleGeometry(0.0098, 0.030, 3, 10); cg2.rotateX(Math.PI / 2);
    t1.add(this._mesh(cg1, M.glove, 0, 0, -0.019)); t2.add(this._mesh(cg2, M.glove, 0, 0, -0.015));
    t1.add(t2); tb.add(t1); this.root.add(tb);
    this.thumb = { base: tb, j1: t1, j2: t2 };
    this.curl = [0.1, 0.1, 0.1, 0.1, 0.1];
    this.thumbAbd = 0;
    this.applyCurl();
  }
  _mesh(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
  setCurl(c, thumbAbd) { for (let i = 0; i < 5; i++) this.curl[i] = c[i]; if (thumbAbd !== undefined) this.thumbAbd = thumbAbd; this.applyCurl(); }
  applyCurl() {
    for (let i = 0; i < 4; i++) {
      const c = clamp(this.curl[i], 0, 1), f = this.fingers[i];
      f[0].rotation.x = -c * 1.35; f[1].rotation.x = -c * 1.6; f[2].rotation.x = -c * 1.0;
      f[0].rotation.y = (i - 1.5) * -0.04 * (1 - c);
    }
    const tc = clamp(this.curl[4], 0, 1), t = this.thumb;
    t.base.rotation.set(-0.15 - this.thumbAbd * 0.6, 0.55 - this.thumbAbd * 0.5, -0.2 + tc * -0.4);
    t.j1.rotation.set(0, 0, 0); t.j1.rotation.x = -tc * 0.5;
    t.j2.rotation.x = -tc * 0.9;
  }
}

class ArmRig {
  constructor(isLeft, anchor) {
    this.anchor = anchor.clone();
    this.isLeft = isLeft;
    const g = new THREE.CylinderGeometry(0.047, 0.036, 1, 14, 1, true);   // top (+Y) = elbow end
    this.mesh = new THREE.Mesh(g, VM_MATS.sleeve);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // sleeve cuff overlapping the glove
    const cuffG = new THREE.CylinderGeometry(0.039, 0.039, 0.02, 14, 1, true);
    this.cuff = new THREE.Mesh(cuffG, VM_MATS.gloveDark); this.cuff.frustumCulled = false;
  }
  update(wrist, parentToLocal) {
    const from = wrist, to = this.anchor;
    const dir = _v1.subVectors(to, from);
    const len = dir.length();
    dir.divideScalar(len);
    this.mesh.position.copy(from).addScaledVector(dir, len * 0.5 + 0.012);
    this.mesh.quaternion.setFromUnitVectors(_up, dir);
    this.mesh.scale.set(1, len, 1);
  }
}
