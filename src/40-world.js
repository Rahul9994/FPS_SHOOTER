/* =====================================================================
 *  HOLLOW RIDGE  -  40-world.js
 *  Terrain meshes + shaders, far mountains, animated grass, trees, rocks
 * ===================================================================== */

const World = {
  group: null,
  grass: [],
  trees: null,
  scene: null,
};

/* ----------------------------------------------- material patch helpers */
function addWetPatch(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    sh.uniforms.uWet = SU.uWet;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, 0.66, uWet);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.25, uWet * 0.8);');
    gfxTag(sh, 'refl');
  };
  mat.customProgramCacheKey = () => 'wet' + (mat.userData.key || '');
  return mat;
}

/** triplanar world-space textured material (rocks, concrete...) */
function makeTriplanarMaterial({ albedo, normal, scale = 0.35, roughness = 0.9, metalness = 0, tint = new THREE.Color(1, 1, 1), normalStrength = 0.9 }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tAlb = { value: albedo }; sh.uniforms.tNrm = { value: normal };
    sh.uniforms.uScale = { value: scale }; sh.uniforms.uTint = { value: tint };
    sh.uniforms.uWet = SU.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.0); mat3 nm = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; nm = nm * mat3(instanceMatrix);
        #endif
        wp4 = modelMatrix * wp4;
        vWP = wp4.xyz; vWN = normalize(nm * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform sampler2D tAlb; uniform sampler2D tNrm; uniform float uScale; uniform vec3 uTint; uniform float uWet;')
      .replace('#include <map_fragment>', `
        vec3 tw = pow(abs(normalize(vWN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 ax = texture2D(tAlb, vWP.zy * uScale).rgb, ay = texture2D(tAlb, vWP.xz * uScale).rgb, az = texture2D(tAlb, vWP.xy * uScale).rgb;
        vec3 triCol = ax * tw.x + ay * tw.y + az * tw.z;
        diffuseColor.rgb = triCol * uTint * mix(1.0, 0.62, uWet);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.3, uWet * 0.75);')
      .replace('#include <normal_fragment_maps>', `
        vec3 nx = texture2D(tNrm, vWP.zy * uScale).xyz * 2.0 - 1.0, ny = texture2D(tNrm, vWP.xz * uScale).xyz * 2.0 - 1.0, nz = texture2D(tNrm, vWP.xy * uScale).xyz * 2.0 - 1.0;
        vec3 pert = vec3(0.0, nx.y, nx.x) * tw.x + vec3(ny.x, 0.0, ny.y) * tw.y + vec3(nz.x, nz.y, 0.0) * tw.z;
        vec3 nW = normalize(normalize(vWN) + pert * ${normalStrength.toFixed(2)});
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
    gfxTag(sh, 'refl');
  };
  m.customProgramCacheKey = () => 'tri' + scale + normalStrength;
  return m;
}

/* ============================================================= terrain */
function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGrass: { value: TEX.grassAlbedo }, tDirt: { value: TEX.dirtAlbedo }, tRock: { value: TEX.rockAlbedo },
      tNGrass: { value: TEX.grassNormal }, tNDirt: { value: TEX.dirtNormal }, tNRock: { value: TEX.rockNormal },
      uHeightTex: SU.uHeightTex, uSplatTex: SU.uSplatTex, uWet: SU.uWet, uGrassTint: SU.uGrassTint, uCloudShade: SU.uCloudShade, uCloudOff: SU.uCloudOff,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tGrass, tDirt, tRock, tNGrass, tNDirt, tNRock; uniform float uWet; uniform vec3 uGrassTint;
        ${GLSL_HASH}
        ${GLSL_HEIGHT}
        ${GLSL_CLOUDSHADE}
        vec3 aT(sampler2D t, vec2 p, float s, float w){ return mix(texture2D(t, p * s).rgb, texture2D(t, p * s * 0.213 + vec2(0.37, 0.11)).rgb, w); }
        vec3 a1(sampler2D t, vec2 p, float s){ return texture2D(t, p * s).rgb; }`)
      .replace('#include <map_fragment>', `
        vec2 wp = vWPos.xz;
        vec4 sp = splatAt(wp);
        float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
        float wvar = 0.3 + 0.4 * vnoise(wp * 0.031);
        float rockW = smoothstep(0.24, 0.46, slope + (vnoise(wp * 0.25) - 0.5) * 0.08);
        float dirtW = smoothstep(0.3, 0.7, sp.r + (vnoise(wp * 0.8) - 0.5) * 0.25);
        vec3 gA = aT(tGrass, wp, 0.27, wvar);
        vec3 dA = a1(tDirt, wp, 0.36);
        vec3 rA = a1(tRock, wp, 0.19);
        vec3 grassCol = gA * mix(vec3(0.82, 0.95, 0.62), vec3(1.25, 1.1, 0.7), sp.g) * uGrassTint;
        vec3 dirtCol = dA * mix(vec3(1.0), vec3(0.55, 0.5, 0.46), sp.b);
        float camD = length(vWPos - cameraPosition);
        grassCol = mix(grassCol, vec3(0.115, 0.165, 0.050) * mix(0.6, 1.5, vnoise(wp * 0.018) ) * uGrassTint * mix(vec3(0.9,1.0,0.8), vec3(1.25,1.1,0.8), sp.g), smoothstep(60.0, 190.0, camD) * 0.75);
        vec3 terrCol = mix(grassCol, dirtCol, dirtW);
        terrCol = mix(terrCol, rA, rockW);
        // large-scale meadow / woodland / dry-grass patchwork seen beyond the blade layer
        float farK = smoothstep(45.0, 160.0, camD);
        float wood = smoothstep(0.52, 0.72, vnoise(wp * 0.0075 + 7.3)) * farK;
        float dry = smoothstep(0.55, 0.8, vnoise(wp * 0.011 - 3.1)) * farK;
        terrCol = mix(terrCol, terrCol * vec3(0.46, 0.55, 0.40), wood * 0.85);
        terrCol = mix(terrCol, terrCol * vec3(1.3, 1.12, 0.7), dry * 0.55);
        terrCol *= mix(1.0, sp.a, 0.9);
        terrCol *= mix(1.0, 0.56, uWet * (0.6 + 0.4 * sp.b));
        terrCol *= cloudShade(wp);
        diffuseColor.rgb = terrCol * 0.9;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.97, 0.86, dirtW);
        roughnessFactor = mix(roughnessFactor, 0.28, uWet * (0.35 + 0.65 * sp.b));`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nGr = texture2D(tNGrass, wp * 0.27).xyz * 2.0 - 1.0;
        vec3 nDi = texture2D(tNDirt, wp * 0.36).xyz * 2.0 - 1.0;
        vec3 nRo = texture2D(tNRock, wp * 0.19).xyz * 2.0 - 1.0;
        vec3 nT = mix(nGr * 0.55, nDi, dirtW); nT = mix(nT, nRo, rockW);
        vec3 nW = normalize(vWNrm + vec3(nT.x, 0.0, nT.y) * 0.9);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
    gfxTag(sh, 'refl');
  };
  mat.customProgramCacheKey = () => 'terrain';
  return mat;
}

function buildTerrainTiles(scene) {
  const n = WORLD.n, half = WORLD.half, tiles = 8, seg = 56;
  const H = HM.data;
  const hAt = (i, j) => H[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const group = new THREE.Group(); group.name = 'terrain';
  const mat = createTerrainMaterial();
  const idx = [];
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const indexAttr = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  for (let tj = 0; tj < tiles; tj++) {
    for (let ti = 0; ti < tiles; ti++) {
      const pos = new Float32Array((seg + 1) * (seg + 1) * 3), nor = new Float32Array(pos.length);
      let k = 0;
      for (let j = 0; j <= seg; j++) {
        for (let i = 0; i <= seg; i++) {
          const gi = ti * seg + i, gj = tj * seg + j;
          pos[k] = gi - half; pos[k + 1] = hAt(gi, gj); pos[k + 2] = gj - half;
          const nx = hAt(gi - 1, gj) - hAt(gi + 1, gj), nz = hAt(gi, gj - 1) - hAt(gi, gj + 1);
          const l = Math.hypot(nx, 2, nz);
          nor[k] = nx / l; nor[k + 1] = 2 / l; nor[k + 2] = nz / l;
          k += 3;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(indexAttr);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true; mesh.castShadow = true;
      group.add(mesh);
    }
  }
  scene.add(group);
  World.terrain = group;
  World.terrainMat = mat;
}

function buildGpuTerrainTextures() {
  const n = WORLD.n;
  const ht = new THREE.DataTexture(HM.data, n, n, THREE.RedFormat, THREE.FloatType);
  ht.minFilter = ht.magFilter = THREE.NearestFilter; ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping; ht.needsUpdate = true;
  SU.uHeightTex.value = ht;
  const st = new THREE.DataTexture(HM.splat, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  st.minFilter = st.magFilter = THREE.LinearFilter; st.wrapS = st.wrapT = THREE.ClampToEdgeWrapping; st.needsUpdate = true;
  SU.uSplatTex.value = st;
}

/* ------------------------------------------------------- far mountains */
function buildFarTerrain(scene) {
  const cell = 32, ext = 3072, cnt = ext * 2 / cell;     // 192 cells
  const holeA = Math.round((-WORLD.half + ext) / cell), holeB = Math.round((WORLD.half + ext) / cell);
  const nv = cnt + 1;
  const pos = new Float32Array(nv * nv * 3), nor = new Float32Array(nv * nv * 3), col = new Float32Array(nv * nv * 3);
  const hv = new Float32Array(nv * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nv; i++) hv[j * nv + i] = baseHeight(-ext + i * cell, -ext + j * cell);
  const c = new THREE.Color();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nv; i++) {
      const x = -ext + i * cell, z = -ext + j * cell, k = (j * nv + i) * 3, hh = hv[j * nv + i];
      pos[k] = x; pos[k + 1] = hh; pos[k + 2] = z;
      const hl = hv[j * nv + Math.max(i - 1, 0)], hr = hv[j * nv + Math.min(i + 1, nv - 1)];
      const hd = hv[Math.max(j - 1, 0) * nv + i], hu = hv[Math.min(j + 1, nv - 1) * nv + i];
      const nx = hl - hr, nz = hd - hu, l = Math.hypot(nx, 2 * cell, nz);
      nor[k] = nx / l; nor[k + 1] = 2 * cell / l; nor[k + 2] = nz / l;
      const slope = 1 - nor[k + 1];
      const forest = smoothstep(-0.15, 0.25, Noise.fbm(x * 0.0034 + 5, z * 0.0034 - 9, 3));
      const alt = smoothstep(150, 520, hh);
      c.setRGB(0.20, 0.27, 0.085).lerp(new THREE.Color(0.055, 0.105, 0.045), forest * 0.8);
      c.lerp(new THREE.Color(0.28, 0.27, 0.24), saturate(smoothstep(0.12, 0.34, slope) * 0.8 + alt * 0.55));
      c.lerp(new THREE.Color(0.55, 0.57, 0.62), smoothstep(560, 760, hh) * 0.8);
      const v = 0.82 + 0.36 * (Noise.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5);
      col[k] = c.r * v; col[k + 1] = c.g * v; col[k + 2] = c.b * v;
    }
  }
  const idx = [];
  for (let j = 0; j < cnt; j++) for (let i = 0; i < cnt; i++) {
    if (i >= holeA && i < holeB && j >= holeA && j < holeB) continue;
    const a = j * nv + i, b = a + 1, d = a + nv, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tG = { value: TEX.grassAlbedo };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vFP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP; uniform sampler2D tG;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float m1 = texture2D(tG, vFP.xz * 0.011).g, m2 = texture2D(tG, vFP.xz * 0.0031 + 0.4).g;
        diffuseColor.rgb *= 0.55 + 0.95 * (m1 * 0.6 + m2 * 0.7);`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = false;
  scene.add(mesh);
  World.far = mesh;
}

/* ================================================================ grass */
function makeBladeGeometry(segs, blades) {
  // x in [-0.5,0.5] (scaled by width), y in [0,1] along height, z = blade index in tuft
  const pos = [], nor = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s === segs) { pos.push(0, 1, b); nor.push(0, 1, 0); }
      else { pos.push(-0.5, t, b, 0.5, t, b); nor.push(0, 1, 0, 0, 1, 0); }
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      if (s === segs - 1) idx.push(a, a + 1, a + 2);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function createGrassMaterial(cfg) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { TUFT: cfg.blades };
  const U = {
    uN: { value: cfg.n }, uCell: { value: cfg.cell }, uR: { value: cfg.radius }, uInnerR: { value: cfg.inner }, uWin: { value: new THREE.Vector3(0, 0, cfg.n) },
    uBladeH: { value: cfg.height }, uBladeW: { value: cfg.width }, uSeed: { value: cfg.seed }, uSpread: { value: cfg.spread },
  };
  cfg.uniforms = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, {
      uTime: SU.uTime, uWind: SU.uWind, uWindStr: SU.uWindStr, uCamPos: SU.uCamPos, uCamFwd: SU.uCamFwd, uAgents: SU.uAgents,
      uHeightTex: SU.uHeightTex, uSplatTex: SU.uSplatTex, uWet: SU.uWet, uSunDirW: SU.uSunDirW, uSunColor: SU.uSunColor, uSunI: SU.uSunI, uGrassTint: SU.uGrassTint, uCloudShade: SU.uCloudShade, uCloudOff: SU.uCloudOff,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uN, uCell, uR, uInnerR, uBladeH, uBladeW, uSeed, uSpread;
        uniform vec3 uCamPos, uWin; uniform vec2 uCamFwd; uniform vec4 uAgents[10];   // uWin: (first column, first row, columns) of the part of the grid that can be on screen
        ${GLSL_HASH}
        ${GLSL_HEIGHT}
        ${GLSL_WIND}
        ${GLSL_CLOUDSHADE}
        varying float vT; varying float vTint; varying float vGust; varying vec3 vWorld; varying float vCloud;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', `
        float iid = float(gl_InstanceID);
        vec2 cellIdx = vec2(uWin.x + mod(iid, uWin.z), uWin.y + floor(iid / uWin.z));
        vec2 gridC = floor(uCamPos.xz / uCell + 0.5) * uCell;
        vec2 gbase = gridC + (cellIdx - uN * 0.5 + 0.5) * uCell;
        vec2 wcell = floor(gbase / uCell + 0.5);
        vec4 r = hash42(wcell + uSeed);
        vec2 pos = gbase + (r.xy - 0.5) * uCell * 0.98;
        float bi = position.z;
        vec4 r2 = hash42(wcell * 1.37 + bi * 7.13 + uSeed);
        #if TUFT > 1
          pos += (r2.xy - 0.5) * uSpread;
        #endif
        float dist = distance(pos, uCamPos.xz);
        float rr = hash12(wcell * 0.77 + bi * 3.1 + 17.0);
        float fadeOut = 1.0 - smoothstep(uR * 0.74, uR, dist);
        float inner = smoothstep(uInnerR * 0.62, uInnerR * 1.02, dist);
        float keep = step(rr, fadeOut);
        if (uInnerR > 0.001) keep *= step(1.0 - inner, rr);
        // the cheap rejections come first: most instances of a grid are thinned out, behind the camera or beyond the radius, and must not pay for the terrain / splat / noise look-ups below
        if (keep < 0.5 || (dist > 4.0 && dot(pos - uCamPos.xz, uCamFwd) < -0.36 * dist)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vT = 0.0; vTint = 0.0; vGust = 0.0; vWorld = vec3(0.0); vCloud = 1.0; return; }
        float h0 = terrainH(pos);
        vec4 spl = splatAt(pos);
        float bare = smoothstep(0.34, 0.66, spl.r);
        float patchK = 0.62 + 0.72 * vnoise(pos * 0.095) + 0.18 * (vnoise(pos * 0.9) - 0.5);
        float hgt = uBladeH * (0.5 + 0.85 * r.z * r.z + 0.3 * r2.z) * patchK * keep * (1.0 - bare);
        if (hgt < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vT = 0.0; vTint = 0.0; vGust = 0.0; vWorld = vec3(0.0); vCloud = 1.0; return; }
        float yaw = r.w * 6.2831853;
        vec2 fwd = vec2(cos(yaw), sin(yaw)); vec2 sideV = vec2(-fwd.y, fwd.x);
        float t = position.y;
        float bw = uBladeW * (0.7 + 0.6 * r2.w) * (1.0 - t * 0.5);
        float lean = 0.12 + 0.42 * r.y;
        float curve = lean * hgt * t * t;
        vec3 transformed = vec3(pos.x, h0 - 0.02, pos.y);
        transformed.xz += sideV * position.x * bw + fwd * curve;
        transformed.y += t * hgt - curve * 0.25;
        float bend = t * t;
        vec2 wf = windField(pos);
        float gustAmt = length(wf);
        transformed.xz += wf * hgt * bend * 0.62;
        transformed.y -= gustAmt * hgt * bend * 0.22;
        transformed.xz += vec2(sin(uTime * 3.1 + r.x * 40.0), cos(uTime * 2.7 + r.y * 40.0)) * 0.014 * hgt * bend * (0.3 + uWindStr);
        for (int i = 0; i < 10; i++) {
          vec4 a = uAgents[i];
          if (dist < 30.0 && a.w > 0.0) {
            vec2 dd = pos - a.xy; float l = length(dd);
            float push = (1.0 - smoothstep(0.0, a.z, l)) * a.w;
            transformed.xz += (dd / (l + 0.001)) * push * hgt * bend * 0.8;
            transformed.y -= push * hgt * bend * 0.5;
          }
        }
        vT = t; vTint = r.z; vGust = gustAmt; vWorld = transformed; vCloud = cloudShade(pos);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vT; varying float vTint; varying float vGust; varying vec3 vWorld; varying float vCloud;
        uniform float uWet, uSunI; uniform vec3 uSunDirW, uSunColor, uGrassTint;`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <map_fragment>', `
        vec3 rootCol = vec3(0.014, 0.028, 0.007);
        vec3 midCol = mix(vec3(0.030, 0.070, 0.012), vec3(0.060, 0.086, 0.016), vTint);
        vec3 tipCol = mix(vec3(0.080, 0.165, 0.028), vec3(0.185, 0.190, 0.045), vTint * vTint);
        vec3 grassCol = mix(rootCol, midCol, smoothstep(0.0, 0.42, vT));
        grassCol = mix(grassCol, tipCol, smoothstep(0.32, 1.0, vT));
        grassCol *= 0.86 + 0.34 * vGust;
        grassCol *= mix(1.0, 0.5, uWet);
        grassCol *= uGrassTint * vCloud;
        diffuseColor.rgb = grassCol;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.72, 0.6, uWet);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 gV = normalize(cameraPosition - vWorld);
        float trans = pow(clamp(dot(gV, -uSunDirW), 0.0, 1.0), 2.2) * smoothstep(0.12, 1.0, vT) * uSunI;
        totalEmissiveRadiance += grassCol * uSunColor * trans * 0.9;`);
    gfxTag(sh, 'noao');
  };
  mat.customProgramCacheKey = () => 'grass' + cfg.blades + cfg.name;
  return mat;
}

const GRASS_LAYERS = [
  { name: 'A', radius: 15, n0: 330, inner: 0,  blades: 1, segs: 4, height: 0.74, width: 0.034, spread: 0,    seed: 1.0 },
  { name: 'B', radius: 46, n0: 270, inner: 13, blades: 3, segs: 2, height: 0.78, width: 0.05,  spread: 0.28, seed: 2.0 },
  { name: 'C', radius: 112, n0: 215, inner: 40, blades: 5, segs: 2, height: 0.8,  width: 0.085, spread: 0.7,  seed: 3.0 },
];

function buildGrass(scene) {
  World.grass = [];
  const mult = G.quality.grass;
  for (const L of GRASS_LAYERS) {
    const cfg = Object.assign({}, L);
    const n = Math.max(24, Math.round(L.n0 * Math.sqrt(mult)));
    cfg.n = n; cfg.cell = L.radius * 2 / n;
    const geo = makeBladeGeometry(L.segs, L.blades);
    geo.instanceCount = n * n;
    const mesh = new THREE.Mesh(geo, createGrassMaterial(cfg));
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = L.radius < 60;   // the far layer lies beyond the shadow range
    mesh.renderOrder = 1;
    scene.add(mesh);
    World.grass.push({ mesh, cfg, def: L });
  }
}

function setGrassQuality(mult) {
  for (const g of World.grass) {
    const n = Math.max(24, Math.round(g.def.n0 * Math.sqrt(mult)));
    g.cfg.n = n; g.cfg.cell = g.def.radius * 2 / n;
    g.cfg.uniforms.uN.value = n; g.cfg.uniforms.uCell.value = g.cfg.cell;
    g.mesh.geometry.instanceCount = n * n;
  }
}

/** Each grass layer is an n x n grid of cells that follows the camera, but the camera only sees a wedge of it. Instead of running the
 *  vertex shader for the whole square, draw only the block of columns / rows that the view frustum can reach (the shader gets the
 *  block through uWin). The frustum is cut off at the layer's radius (+ slack for terrain height) and projected onto the ground plane;
 *  the block is that footprint's bounding box, padded for blade height, wind and rounding at cell borders. Pure culling - the image
 *  is identical, `World.grassWindow = false` turns it off for A/B tests. */
World.grassWindow = true;
const _gwP = new THREE.Vector3(), _gwRight = new THREE.Vector3(), _gwUp = new THREE.Vector3(), _gwFwd = new THREE.Vector3();
function updateGrassWindows(cam) {
  if (!World.grass) return;
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements, pe = cam.projectionMatrix.elements;
  _gwP.setFromMatrixPosition(cam.matrixWorld);
  _gwRight.set(e[0], e[1], e[2]); _gwUp.set(e[4], e[5], e[6]); _gwFwd.set(-e[8], -e[9], -e[10]);
  const tanH = 1.08 / Math.abs(pe[0]), tanV = 1.08 / Math.abs(pe[5]);       // 8% slack around the view
  for (const g of World.grass) {
    const u = g.cfg.uniforms, n = g.cfg.n, cell = g.cfg.cell, R = g.def.radius, geo = g.mesh.geometry;
    if (!World.grassWindow) { u.uWin.value.set(0, 0, n); geo.instanceCount = n * n; g.mesh.visible = true; continue; }
    const D = R + 70;                      // deepest point (along the view axis) that can still be a visible blade of this layer
    let minX = _gwP.x, maxX = _gwP.x, minZ = _gwP.z, maxZ = _gwP.z;
    for (const d of [0.08, D]) {
      const hw = d * tanH, hh = d * tanV;
      for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) {
        const x = _gwP.x + _gwFwd.x * d + _gwRight.x * hw * sx + _gwUp.x * hh * sy, z = _gwP.z + _gwFwd.z * d + _gwRight.z * hw * sx + _gwUp.z * hh * sy;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    const pad = 3;                         // blade height + wind sway + the 0.98-cell jitter
    minX = Math.max(minX - pad, _gwP.x - R - pad); maxX = Math.min(maxX + pad, _gwP.x + R + pad);
    minZ = Math.max(minZ - pad, _gwP.z - R - pad); maxZ = Math.min(maxZ + pad, _gwP.z + R + pad);
    const gx = Math.floor(_gwP.x / cell + 0.5) * cell, gz = Math.floor(_gwP.z / cell + 0.5) * cell;     // same snap as the shader
    // world -> column / row index of the grid (inverse of  gbase = gridC + (idx - n/2 + 0.5) * cell ), one spare cell each side for float rounding
    const i0 = Math.max(0, Math.floor((minX - gx) / cell + n / 2 - 0.5) - 1), i1 = Math.min(n - 1, Math.ceil((maxX - gx) / cell + n / 2 - 0.5) + 1);
    const j0 = Math.max(0, Math.floor((minZ - gz) / cell + n / 2 - 0.5) - 1), j1 = Math.min(n - 1, Math.ceil((maxZ - gz) / cell + n / 2 - 0.5) + 1);
    if (i1 < i0 || j1 < j0) { geo.instanceCount = 0; g.mesh.visible = false; continue; }
    g.mesh.visible = true;
    u.uWin.value.set(i0, j0, i1 - i0 + 1);
    geo.instanceCount = (i1 - i0 + 1) * (j1 - j0 + 1);
  }
}

/* ================================================================ trees */
function randomCardGeometry(size, cx, cy, cz, nx, ny, nz, rot, brightness, aspect = 1) {
  // plane facing +Z rotated so its normal points along (nx,ny,nz)
  const g = new THREE.PlaneGeometry(size, size * aspect);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz).normalize());
  const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot);
  q.multiply(twist);
  g.applyQuaternion(q); g.translate(cx, cy, cz);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3).fill(brightness);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
function setSoftNormals(g, cx, cy, cz, upBias) {
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3();
  // radial normal measured from card centre pushed outward from canopy centre (cx,cy,cz)
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) - cx, p.getY(i) - cy, p.getZ(i) - cz).normalize();
    v.y += upBias; v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

function makeOakGeometry(seed) {
  const rng = mulberry32(seed);
  const trunk = [], leaves = [];
  const th = 4.0 + rng() * 0.8;
  const tg = new THREE.CylinderGeometry(0.17, 0.38, th, 7, 3, true); tg.translate(0, th / 2, 0); trunk.push(tg);
  const cy = th + 1.1, rx = 3.3 + rng() * 0.5, ry = 2.5 + rng() * 0.4;
  // branches
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU, L = 1.6 + rng() * 1.2, y0 = th * (0.55 + rng() * 0.35);
    const bg = new THREE.CylinderGeometry(0.05, 0.12, L, 5, 1, true); bg.translate(0, L / 2, 0);
    bg.rotateZ(-(0.7 + rng() * 0.5)); bg.rotateY(a); bg.translate(0, y0, 0); trunk.push(bg);
  }
  const cards = 46;
  for (let i = 0; i < cards; i++) {
    const u = Math.pow(rng(), 0.45), th2 = rng() * TAU, ph = Math.acos(rng() * 1.6 - 0.75);
    const x = Math.sin(ph) * Math.cos(th2) * rx * u, y = cy + Math.cos(ph) * ry * u * 0.9, z = Math.sin(ph) * Math.sin(th2) * rx * u;
    const rad = new THREE.Vector3(x, y - cy, z).normalize();
    const nrm = rad.multiplyScalar(0.8).add(new THREE.Vector3((rng() - 0.5) * 0.7, (rng() - 0.3) * 0.7, (rng() - 0.5) * 0.7));
    const size = 2.6 + rng() * 1.5;
    const bright = 0.5 + 0.5 * u + (rng() - 0.5) * 0.2;
    const g = randomCardGeometry(size, x, y, z, nrm.x, nrm.y, nrm.z, rng() * TAU, bright);
    setSoftNormals(g, 0, cy - 0.3, 0, 0.22);
    leaves.push(g);
  }
  return { trunk: mergeGeometries(trunk.map(stripToPNU)), leaves: mergeGeometries(leaves.map(stripToPNUC)), height: cy + ry };
}
function makePineGeometry(seed) {
  const rng = mulberry32(seed);
  const trunk = [], leaves = [];
  const th = 8.5 + rng() * 2;
  const tg = new THREE.CylinderGeometry(0.1, 0.3, th, 7, 3, true); tg.translate(0, th / 2, 0); trunk.push(tg);
  const tiers = 10;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 1.6 + f * (th - 2.2), radius = lerp(2.0, 0.35, f), size = lerp(2.7, 1.3, f);
    const count = Math.round(lerp(8, 4, f));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + rng() * 0.7;
      const cx = Math.cos(a) * radius * 0.5, cz = Math.sin(a) * radius * 0.5;
      const nrm = new THREE.Vector3(Math.cos(a) * 0.9, 0.55 + rng() * 0.2, Math.sin(a) * 0.9);
      const g = randomCardGeometry(size, cx, y - f * 0.4, cz, nrm.x, nrm.y, nrm.z, rng() * TAU, 0.55 + 0.45 * (1 - f) * 0.4 + rng() * 0.3, 1.0);
      setSoftNormals(g, 0, y - 0.5, 0, 0.6);
      leaves.push(g);
    }
  }
  return { trunk: mergeGeometries(trunk.map(stripToPNU)), leaves: mergeGeometries(leaves.map(stripToPNUC)), height: th + 1 };
}
function makeBushGeometry(seed) {
  const rng = mulberry32(seed);
  const leaves = [];
  for (let i = 0; i < 16; i++) {
    const a = rng() * TAU, u = Math.pow(rng(), 0.6), y = 0.2 + rng() * 0.95;
    const x = Math.cos(a) * 0.85 * u, z = Math.sin(a) * 0.85 * u;
    const nrm = new THREE.Vector3(x, y - 0.5, z).add(new THREE.Vector3((rng() - 0.5), (rng() - 0.3), (rng() - 0.5)));
    const g = randomCardGeometry(1.1 + rng() * 0.7, x, y, z, nrm.x, nrm.y, nrm.z, rng() * TAU, 0.55 + 0.45 * rng());
    setSoftNormals(g, 0, 0.35, 0, 0.3);
    leaves.push(g);
  }
  return { trunk: null, leaves: mergeGeometries(leaves.map(stripToPNUC)), height: 1.5 };
}
function stripToPNU(g) {
  const o = new THREE.BufferGeometry();
  const ng = g.index ? g.toNonIndexed() : g;
  o.setAttribute('position', ng.attributes.position); o.setAttribute('normal', ng.attributes.normal); o.setAttribute('uv', ng.attributes.uv);
  return o;
}
function stripToPNUC(g) {
  const o = stripToPNU(g);
  const ng = g.index ? g.toNonIndexed() : g;
  o.setAttribute('color', ng.attributes.color);
  return o;
}

function createFoliageMaterials(leafTex, swayScale) {
  const mat = new THREE.MeshStandardMaterial({
    map: leafTex, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, color: 0xdfe6d2,
  });
  const common = (sh) => {
    Object.assign(sh.uniforms, { uTime: SU.uTime, uWind: SU.uWind, uWindStr: SU.uWindStr, uSunDirW: SU.uSunDirW, uSunColor: SU.uSunColor, uSunI: SU.uSunI, uWet: SU.uWet, uCloudShade: SU.uCloudShade, uCloudOff: SU.uCloudOff });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${GLSL_HASH}
        ${GLSL_WIND}
        ${GLSL_CLOUDSHADE}
        varying vec3 vWorldF; varying float vCloudF;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
          float is2 = dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
          mat3 invI = transpose(mat3(instanceMatrix)) / is2;
        #else
          vec3 iPos = vec3(0.0); mat3 invI = mat3(1.0);
        #endif
        float hh = max(position.y, 0.0);
        vec2 wfT = windField(iPos.xz + position.xz * 0.2);
        float sway = pow(hh / ${swayScale.toFixed(1)}, 1.7);
        vec3 wdisp = vec3(wfT.x, 0.0, wfT.y) * sway * 1.15;
        transformed += invI * wdisp;
        transformed.xz += vec2(sin(uTime * 2.3 + position.x * 2.7 + position.z * 3.1), cos(uTime * 2.9 + position.y * 2.3)) * 0.05 * sway * (0.4 + uWindStr);
        vec4 wpF = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpF = instanceMatrix * wpF;
        #endif
        vWorldF = (modelMatrix * wpF).xyz; vCloudF = cloudShade(iPos.xz);`);
  };
  mat.onBeforeCompile = (sh) => {
    common(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldF; varying float vCloudF; uniform vec3 uSunDirW, uSunColor; uniform float uSunI, uWet;')
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, 0.7, uWet) * vCloudF;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 fV = normalize(cameraPosition - vWorldF);
        float ftr = pow(clamp(dot(fV, -uSunDirW), 0.0, 1.0), 2.5) * uSunI;
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * ftr * 0.55;`);
    // (not tagged: alphaToCoverage uses the alpha channel for MSAA coverage)
  };
  mat.customProgramCacheKey = () => 'foliage' + swayScale;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide });
  const trunkMat = new THREE.MeshStandardMaterial({ map: TEX.barkAlbedo, normalMap: TEX.barkNormal, roughness: 0.95, metalness: 0, color: 0xdadada, side: THREE.DoubleSide });
  trunkMat.map.repeat.set(1, 2);
  trunkMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: SU.uTime, uWind: SU.uWind, uWindStr: SU.uWindStr, uWet: SU.uWet });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_HASH}\n${GLSL_WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPosT = instanceMatrix[3].xyz; float is2t = dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz); mat3 invIt = transpose(mat3(instanceMatrix)) / is2t;
        #else
          vec3 iPosT = vec3(0.0); mat3 invIt = mat3(1.0);
        #endif
        vec2 wfTr = windField(iPosT.xz);
        transformed += invIt * vec3(wfTr.x, 0.0, wfTr.y) * pow(max(position.y, 0.0) / ${swayScale.toFixed(1)}, 1.7) * 0.9;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, 0.6, uWet);');
  };
  trunkMat.customProgramCacheKey = () => 'trunk' + swayScale;
  return { leaf: mat, depth, trunk: trunkMat };
}

function buildVegetation(scene) {
  const q = G.quality.trees;
  const rng = mulberry32(2024);
  const defs = [
    { name: 'oak', geo: [makeOakGeometry(1), makeOakGeometry(2)], tex: TEX.leafOak, sway: 7, count: Math.round(150 * q), minScale: 0.85, maxScale: 1.45, trunkR: 0.36, trunkH: 5.5, cluster: 0.012 },
    { name: 'pine', geo: [makePineGeometry(3), makePineGeometry(4)], tex: TEX.leafPine, sway: 11, count: Math.round(120 * q), minScale: 0.8, maxScale: 1.35, trunkR: 0.26, trunkH: 9, cluster: 0.009 },
    { name: 'bush', geo: [makeBushGeometry(5), makeBushGeometry(6)], tex: TEX.leafBush, sway: 1.8, count: Math.round(320 * q), minScale: 0.7, maxScale: 1.6, trunkR: 0, trunkH: 0, cluster: 0.02 },
  ];
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const placed = [];
  const okSpot = (x, z, minDist) => {
    if (Math.abs(x) > WORLD.play + 6 || Math.abs(z) > WORLD.play + 6) return false;
    if (Math.hypot(x - LAYOUT.spawn.x, z - LAYOUT.spawn.z) < 20) return false;
    if (distToRoad(x, z) < 5.5 || distToTrench(x, z) < 6) return false;
    for (const b of LAYOUT.buildings) if (Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) * 0.9 + 4) return false;
    if (Math.hypot(x - LAYOUT.ammoCrate.x, z - LAYOUT.ammoCrate.z) < 8) return false;
    if (terrainSplat(x, z).dirt > 0.45) return false;
    const n = terrainNormal(x, z); if (n.y < 0.84) return false;
    for (const p of placed) { const dx = p[0] - x, dz = p[1] - z; if (dx * dx + dz * dz < minDist * minDist) return false; }
    return true;
  };
  for (const def of defs) {
    const meshesL = [], meshesT = [];
    const groups = def.geo.length;
    const per = Math.ceil(def.count / groups);
    const mats = createFoliageMaterials(def.tex, def.sway);
    for (let gi = 0; gi < groups; gi++) {
      const geo = def.geo[gi];
      const inst = [];
      let tries = 0;
      while (inst.length < per && tries++ < per * 40) {
        const x = (rng() - 0.5) * 2 * (WORLD.play + 6), z = (rng() - 0.5) * 2 * (WORLD.play + 6);
        // clustered placement
        const dens = Noise.fbm(x * def.cluster + 17 * gi + def.sway, z * def.cluster - 3, 3) * 0.5 + 0.5;
        if (rng() > Math.pow(dens, 1.6) * 1.5 + 0.05) continue;
        if (!okSpot(x, z, def.name === 'bush' ? 2.2 : 5.5)) continue;
        placed.push([x, z]);
        inst.push([x, z, rng() * TAU, lerp(def.minScale, def.maxScale, rng())]);
        (def.pos = def.pos || []).push([x, z]);
        if (def.trunkR > 0) Colliders.cyl(x, z, def.trunkR * inst[inst.length - 1][3] + 0.04, def.trunkH, 'wood', true);
      }
      if (!inst.length) continue;
      const lm = new THREE.InstancedMesh(geo.leaves, mats.leaf, inst.length);
      lm.customDepthMaterial = mats.depth;
      const tm = geo.trunk ? new THREE.InstancedMesh(geo.trunk, mats.trunk, inst.length) : null;
      inst.forEach((it, i) => {
        ps.set(it[0], terrainHeight(it[0], it[1]) - 0.08, it[1]);
        qt.setFromAxisAngle(_up, it[2]); sc.setScalar(it[3]);
        m.compose(ps, qt, sc);
        lm.setMatrixAt(i, m); tm && tm.setMatrixAt(i, m);
      });
      lm.castShadow = true; lm.receiveShadow = true; lm.instanceMatrix.needsUpdate = true;
      lm.computeBoundingSphere();
      scene.add(lm); meshesL.push(lm);
      if (tm) { tm.castShadow = true; tm.receiveShadow = true; tm.instanceMatrix.needsUpdate = true; tm.computeBoundingSphere(); scene.add(tm); meshesT.push(tm); }
    }
    def.meshes = [...meshesL, ...meshesT];
  }
  World.vegetation = defs;
  World.treePositions = placed;
}

/* ================================================================ rocks */
function makeRockGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = Noise.fbm(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7, 3);
    const n2 = Noise.ridged(v.z * 2.1 + seed * 2, v.x * 2.1 - v.y, 3);
    const s = 1 + n1 * 0.38 + (n2 - 0.5) * 0.28;
    v.multiplyScalar(s);
    if (v.y < -0.45) v.y = -0.45 + (v.y + 0.45) * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(scene) {
  const rng = mulberry32(555);
  const mat = makeTriplanarMaterial({ albedo: TEX.rockAlbedo, normal: TEX.rockNormal, scale: 0.28, roughness: 0.92, tint: new THREE.Color(0.9, 0.9, 0.86), normalStrength: 1.1 });
  const geos = [makeRockGeometry(1), makeRockGeometry(7), makeRockGeometry(13)];
  const count = 90;
  const per = Math.ceil(count / geos.length);
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), eu = new THREE.Euler();
  geos.forEach((geo, gi) => {
    const items = [];
    let tries = 0;
    while (items.length < per && tries++ < 600) {
      let x, z;
      if (rng() < 0.55 && items.length) {                // cluster around a previous rock
        const b = items[Math.floor(rng() * items.length)]; x = b.x + (rng() - 0.5) * 7; z = b.z + (rng() - 0.5) * 7;
      } else { x = (rng() - 0.5) * 2 * (WORLD.play); z = (rng() - 0.5) * 2 * (WORLD.play); }
      if (Math.abs(x) > WORLD.play || Math.abs(z) > WORLD.play) continue;
      if (Math.hypot(x - LAYOUT.spawn.x, z - LAYOUT.spawn.z) < 14 || distToRoad(x, z) < 4 || distToTrench(x, z) < 4) continue;
      if (LAYOUT.buildings.some((b) => Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) + 3)) continue;
      const s = lerp(0.5, 2.1, Math.pow(rng(), 1.8));
      items.push({ x, z, s, sy: s * lerp(0.6, 1.0, rng()), rot: rng() * TAU });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      const y = terrainHeight(it.x, it.z);
      ps.set(it.x, y + it.sy * 0.08, it.z);
      eu.set((rng() - 0.5) * 0.3, it.rot, (rng() - 0.5) * 0.3); qt.setFromEuler(eu);
      sc.set(it.s, it.sy, it.s * lerp(0.8, 1.2, rng()));
      m.compose(ps, qt, sc); mesh.setMatrixAt(i, m);
      Colliders.sph(it.x, y + it.sy * 0.35, it.z, it.s * 0.9, 'rock', true);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    scene.add(mesh);
  });
}
