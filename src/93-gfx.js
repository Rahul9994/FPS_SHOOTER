/* =====================================================================
 *  HOLLOW RIDGE  -  93-gfx.js
 *  Advanced lighting.  WebGL / WebGPU in browsers expose NO hardware ray-tracing
 *  API (no DXR / Vulkan RT), so "ray tracing" here means *ray marching in screen
 *  space* against the depth buffer — one full-screen pass that provides:
 *      · ray-marched reflections (wet ground, steel props, glass-like surfaces)
 *      · ray-marched ambient occlusion + one bounce of coloured light (SSGI-lite)
 *      · ray-marched contact shadows toward the sun / moon
 *      · volumetric light: sun shafts + forward-scattering fog glow
 *  plus shadow-quality overrides, a shadow-casting flashlight with a visible
 *  beam, and falling leaves.  Everything is optional: with the pass off (or on
 *  hardware that cannot run it) the renderer falls back to the original path.
 *
 *  How materials talk to the pass: world materials write a tag into the colour
 *  buffer's ALPHA channel (alpha = 1 - reflectivity;  alpha < 0.07 = "foliage /
 *  grass, skip occlusion").  Un-patched materials leave alpha = 1 (no reflection).
 * ===================================================================== */

/* material tag snippets (inserted at #include <opaque_fragment>); uGfxTag = 0 turns the tag off (alpha stays 1) */
const GFX_TAG_U = { value: 0 };
/** patch a MeshStandardMaterial's shader so it writes the reflectivity / "skip occlusion" tag into alpha */
function gfxTag(sh, kind) {
  sh.uniforms.uGfxTag = GFX_TAG_U;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGfxTag;').replace('#include <opaque_fragment>', kind === 'noao'
    ? '#include <opaque_fragment>\n gl_FragColor.a = mix(1.0, 0.03, uGfxTag);'
    : '#include <opaque_fragment>\n gl_FragColor.a = mix(1.0, 1.0 - clamp(pow(1.0 - roughnessFactor, 1.4) * (0.5 + 0.5 * metalnessFactor), 0.0, 0.92), uGfxTag);');
}
/** chain a tag onto an existing (possibly already patched) material */
function addGfxTag(mat, kind) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, r) => { prev && prev(sh, r); gfxTag(sh, kind); };
  mat.customProgramCacheKey = () => prevKey + '|gfx' + kind;
  return mat;
}

/* ------------------------------------------------------------------ the pass */
const GLSL_RAY_FRAG = /* glsl */`
uniform sampler2D tDiffuse, tDepth, tNoise;
uniform mat4 uProj, uProjInv;
uniform vec2 uRes;
uniform float uTime, uFogD;
uniform vec3 uSunDirV, uLightDirV, uSunCol, uFogCol, uZenith, uUpV;
uniform vec2 uSunUV;
uniform vec4 uFx;     // x ssr, y ao, z contact, w rays   (0 / 1)
uniform vec4 uP;      // x ao radius, y ao strength, z bounce gain, w contact length
uniform vec4 uQ;      // x ray gain, y scatter gain, z reflection gain, w contact strength
varying vec2 vUv;

float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float linZ(float d){ float n = d * 2.0 - 1.0; return -uProj[3][2] / (n + uProj[2][2]); }
vec3 vpos(vec2 uv, float d){ vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uProjInv * c; return v.xyz / v.w; }
float depthAt(vec2 uv){ return texture2D(tDepth, uv).x; }
vec3 cosineDir(vec3 N, vec2 u){
  float r = sqrt(u.x), phi = 6.2831853 * u.y;
  vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N)), B = cross(N, T);
  return normalize(T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(max(0.0, 1.0 - u.x)));
}
/* view-space normal from the depth buffer (picks the smaller depth step on each axis so silhouettes stay crisp) */
vec3 normalAt(vec2 uv, vec3 P){
  vec2 e = 1.0 / uRes;
  float dl = depthAt(uv - vec2(e.x, 0.0)), dr = depthAt(uv + vec2(e.x, 0.0)), du = depthAt(uv + vec2(0.0, e.y)), dd = depthAt(uv - vec2(0.0, e.y));
  vec3 Pl = vpos(uv - vec2(e.x, 0.0), dl), Pr = vpos(uv + vec2(e.x, 0.0), dr), Pu = vpos(uv + vec2(0.0, e.y), du), Pd = vpos(uv - vec2(0.0, e.y), dd);
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 n = normalize(cross(dx, dy));
  return n.z < 0.0 ? -n : n;
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 col = src.rgb;
  float tag = src.a;
  float d0 = depthAt(vUv);
  vec2 fc = gl_FragCoord.xy;
  if (d0 >= 0.99999) {                       // sky: only the sun shafts apply
    if (uFx.w > 0.5 && uQ.x > 0.001) {
      vec2 dir = uSunUV - vUv; vec2 stepv = dir * (0.9 / float(RAY_N));
      vec2 p = vUv + stepv * ign(fc);
      float acc = 0.0, w = 1.0;
      for (int i = 0; i < RAY_N; i++) { p += stepv; float s = step(0.99999, depthAt(p)); acc += s * smoothstep(0.8, 5.0, luma(texture2D(tDiffuse, p).rgb)) * w; w *= 0.965; }
      col += uSunCol * (acc / float(RAY_N)) * uQ.x * 0.7;
    }
    gl_FragColor = vec4(col, 1.0); return;
  }
  vec3 P = vpos(vUv, d0);
  float dist = -P.z;
  bool noao = tag < 0.07;
  float refl = noao ? 0.0 : clamp(1.0 - tag, 0.0, 0.95);
  vec3 V = normalize(-P);
  vec3 N = vec3(0.0, 0.0, 1.0);
  bool needN = dist < 320.0 && ((uFx.y > 0.5 && !noao) || (uFx.z > 0.5) || (uFx.x > 0.5 && refl > 0.02));
  if (needN) N = normalAt(vUv, P);
  float NdV = clamp(dot(N, V), 0.0, 1.0);

  /* ---- contact shadows (ray march toward the sun / moon) */
  if (uFx.z > 0.5 && needN && uQ.w > 0.001 && !noao) {
    float NdL = dot(N, uLightDirV);
    if (NdL > 0.03) {
      float len = uP.w * mix(1.0, 3.2, smoothstep(6.0, 70.0, dist)), jit = ign(fc + 17.0), occ = 0.0;
      vec3 o = P + N * (0.015 + 0.004 * dist);
      for (int i = 0; i < CS_N; i++) {
        float t = (float(i) + jit) / float(CS_N);
        vec3 S = o + uLightDirV * (t * t * len + 0.012);
        vec4 pc = uProj * vec4(S, 1.0); if (pc.w <= 0.0) break;
        vec2 suv = pc.xy / pc.w * 0.5 + 0.5; if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
        float delta = linZ(depthAt(suv)) - S.z;
        if (delta > 0.01 + dist * 0.0012 && delta < 0.28 + t * len * 0.3) occ = max(occ, 1.0 - t * 0.55);
      }
      col *= 1.0 - occ * uQ.w * smoothstep(0.03, 0.25, NdL) * (1.0 - smoothstep(110.0, 320.0, dist));
    }
  }

  /* ---- ray-marched ambient occlusion + one bounce of colour */
  if (uFx.y > 0.5 && needN && !noao) {
    float R = uP.x * mix(1.0, 2.2, smoothstep(8.0, 90.0, dist)), rot = ign(fc), sum = 0.0; vec3 bounce = vec3(0.0);
    for (int i = 0; i < AO_N; i++) {
      float fi = (float(i) + rot) / float(AO_N);
      vec2 u = vec2(fract(fi * 5.37 + rot * 3.1), fract(fi * 1.6180339 * float(i + 1) + rot * 1.7));
      vec3 dir = cosineDir(N, u);
      float len = R * mix(0.12, 1.0, fi);
      vec3 S = P + dir * len;
      vec4 pc = uProj * vec4(S, 1.0); if (pc.w <= 0.0) continue;
      vec2 suv = pc.xy / pc.w * 0.5 + 0.5; if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float delta = linZ(depthAt(suv)) - S.z;
      if (delta > 0.025 * len + 0.008 && delta < R * 1.5) {
        float w = 1.0 - smoothstep(R * 0.5, R * 1.5, delta);
        sum += w; bounce += texture2D(tDiffuse, suv).rgb * w * max(dot(dir, N), 0.15);
      }
    }
    float occ = sum / float(AO_N); bounce /= float(AO_N);
    float fade = 1.0 - smoothstep(120.0, 320.0, dist);
    col *= 1.0 - occ * uP.y * fade;
    col += bounce * uP.z * clamp(luma(col) * 3.0, 0.15, 1.0) * fade;
  }

  /* ---- ray-marched reflections */
  if (uFx.x > 0.5 && needN && refl > 0.02 && dist < 170.0) {
    vec3 R = reflect(-V, N);
    float facing = smoothstep(0.02, 0.4, -R.z);
    float F = mix(0.04, 1.0, pow(1.0 - NdV, 5.0));
    float k = refl * mix(0.3, 1.0, F) * facing * uQ.z;
    float upR = dot(R, uUpV);
    if (k > 0.01) {
      float jit = ign(fc + 3.0), t = 0.2 + jit * 0.2; vec3 hit = vec3(0.0); float found = 0.0; vec2 huv = vUv;
      vec3 o = P + N * (0.02 + 0.004 * dist);
      float lastT = 0.0;
      for (int i = 0; i < SSR_N; i++) {
        vec3 S = o + R * t;
        vec4 pc = uProj * vec4(S, 1.0); if (pc.w <= 0.0) break;
        vec2 suv = pc.xy / pc.w * 0.5 + 0.5; if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
        float sz = linZ(depthAt(suv)); float delta = sz - S.z;
        if (delta > 0.0 && delta < 0.35 + t * 0.35) {
          // binary refine between the previous and this step
          float lo = lastT, hi = t;
          for (int j = 0; j < 5; j++) { float mid = 0.5 * (lo + hi); vec3 M = o + R * mid; vec4 mc = uProj * vec4(M, 1.0); vec2 muv = mc.xy / mc.w * 0.5 + 0.5; if (linZ(depthAt(muv)) - M.z > 0.0) hi = mid; else lo = mid; }
          vec3 H = o + R * hi; vec4 hc = uProj * vec4(H, 1.0); huv = hc.xy / hc.w * 0.5 + 0.5;
          found = 1.0 - smoothstep(0.6, 1.0, hi / (0.2 + t * 0.0 + 60.0)); hit = texture2D(tDiffuse, huv).rgb; break;
        }
        lastT = t; t *= 1.0 + 0.16 + 0.05 * jit; t += 0.06;
      }
      vec2 ed = min(huv, 1.0 - huv); float edge = smoothstep(0.0, 0.12, min(ed.x, ed.y));
      col = mix(col, hit, k * found * edge);
      // the ray left the screen / found nothing: wet and glossy surfaces still mirror the sky above them
      vec3 skyC = mix(uFogCol, uZenith, smoothstep(0.0, 0.7, upR));
      col = mix(col, skyC, k * (1.0 - found * edge) * smoothstep(0.02, 0.2, upR) * 0.8);
    }
  }

  /* ---- volumetric light: forward-scattering fog glow + sun shafts */
  if (uFx.w > 0.5) {
    float f = 1.0 - exp(-uFogD * uFogD * dist * dist);
    float mu = max(dot(normalize(P), uSunDirV), 0.0);
    col += uSunCol * (pow(mu, 5.0) * 0.25 + pow(mu, 36.0) * 0.8) * f * uQ.y;
    if (uQ.x > 0.001) {
      vec2 dir = uSunUV - vUv; vec2 stepv = dir * (0.9 / float(RAY_N));
      vec2 p = vUv + stepv * ign(fc);
      float acc = 0.0, w = 1.0;
      for (int i = 0; i < RAY_N; i++) { p += stepv; float s = step(0.99999, depthAt(p)); acc += s * smoothstep(0.8, 5.0, luma(texture2D(tDiffuse, p).rgb)) * w; w *= 0.965; }
      col += uSunCol * (acc / float(RAY_N)) * uQ.x * 0.5 * (0.35 + 0.65 * smoothstep(0.0, 120.0, dist));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

class RayPass extends ShaderPass {
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, tNoise: { value: TEX.noiseRGBA },
        uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uFogD: { value: 0.0005 }, uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, uLightDirV: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) }, uFogCol: { value: new THREE.Color(0.7, 0.8, 0.9) }, uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) }, uUpV: { value: new THREE.Vector3(0, 1, 0) }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
        uFx: { value: new THREE.Vector4(0, 0, 0, 0) }, uP: { value: new THREE.Vector4(1.1, 0.55, 0.5, 0.7) }, uQ: { value: new THREE.Vector4(0, 0.5, 1, 0.5) },
      },
      defines: { AO_N: 8, CS_N: 10, SSR_N: 22, RAY_N: 18 },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: GLSL_RAY_FRAG, depthTest: false, depthWrite: false,
    });
    super(mat, 'tDiffuse');
    this.needsSwap = true;
  }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}

/* ============================================================== the manager */
const Gfx = {
  options: {
    rt: [['auto', 'Auto'], ['off', 'Off'], ['low', 'Low'], ['high', 'High']],
    reflections: [['auto', 'Auto'], ['off', 'Off'], ['probe', 'Sky probe'], ['ssr', 'Screen RT']],
    ao: [['auto', 'Auto'], ['off', 'Off'], ['on', 'On']],
    contactShadows: [['auto', 'Auto'], ['off', 'Off'], ['on', 'On']],
    volumetric: [['auto', 'Auto'], ['off', 'Off'], ['on', 'On']],
    shadowQ: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']],
  },
  SHADOWS: { low: { shadowMap: 1024, shadowRange: 50, softShadows: false }, medium: { shadowMap: 2048, shadowRange: 65, softShadows: false }, high: { shadowMap: 2048, shadowRange: 85, softShadows: true }, ultra: { shadowMap: 4096, shadowRange: 105, softShadows: true } },
  supported: false, failReason: '', pass: null, cfg: { rt: 'off', ssr: false, ao: false, contact: false, rays: false }, autoCap: null, depthOn: false, _lastKey: '',

  /** called once the composer exists */
  init(ctx) {
    this.renderer = ctx.renderer; this.composer = ctx.composer; this.camera = ctx.camera; this.scene = ctx.scene;
    this.supported = !!renderer.capabilities.isWebGL2;
    if (!this.supported) this.failReason = 'WebGL 2 is required';
    try {
      this.pass = new RayPass(); this.pass.enabled = false;
      this.composer.insertPass(this.pass, 1);
    } catch (e) { this.supported = false; this.failReason = 'pass creation failed: ' + (e && e.message); }
    // a shader that fails to compile must never take the game down: switch the feature off instead
    renderer.debug.onShaderError = () => { if (this.pass && this.pass.enabled) this.fail('shader compile error'); };
    this.apply();
  },
  fail(why) {
    console.warn('[gfx] ray-marched lighting disabled:', why);
    this.supported = false; this.failReason = why; this.apply();
    toast('Ray-marched lighting is not supported on this GPU — using the standard renderer', 5000);
  },

  /* --------------------------------------------------------------- settings */
  tier() { return Settings.quality; },
  resolve() {
    const S = Settings, tier = this.tier(), integrated = !!(G.gpu && G.gpu.integrated);
    let rt = S.rt;
    if (rt === 'auto') {
      rt = tier === 'ultra' ? 'high' : tier === 'high' ? 'low' : 'off';
      if (integrated) rt = 'off';
      if (this.autoCap === 'low' && rt === 'high') rt = 'low';
      if (this.autoCap === 'off') rt = 'off';
    }
    if (!this.supported) rt = 'off';
    const on = rt !== 'off';
    const pick = (v, dflt) => (v === 'auto' ? dflt : v);
    const refl = pick(S.reflections, on ? 'ssr' : 'probe');
    const ao = pick(S.ao, on ? 'on' : 'off') === 'on';
    const contact = pick(S.contactShadows, on ? 'on' : 'off') === 'on';
    const vol = pick(S.volumetric, on ? 'on' : 'off') === 'on';
    return { rt, ssr: on && refl === 'ssr', ao: on && ao, contact: on && contact, rays: vol && (on || S.volumetric === 'on') && this.supported, refl };
  },
  set(k, v) { Settings[k] = v; Settings.save(); if (k === 'rt' && v !== 'auto') this.autoCap = null; this.apply(); if (k === 'shadowQ') { Atmos.setShadowQuality(); } if (k === 'flashShadows') this.applyFlash(); },
  options_(k) { return this.options[k]; },
  shadowCfg() {
    const key = Settings.shadowQ + '|' + Settings.quality;
    if (this._scKey !== key) { this._scKey = key; const t = Settings.shadowQ === 'auto' ? this.tier() : Settings.shadowQ; this._sc = Object.assign({}, QUALITY[this.tier()], this.SHADOWS[t] || {}); }
    return this._sc;
  },
  apply() {
    const c = this.cfg = this.resolve();
    const any = c.ssr || c.ao || c.contact || c.rays;
    if (this.pass) {
      const level = c.rt === 'high' ? 'high' : 'low';
      const d = level === 'high' ? { AO_N: 12, CS_N: 14, SSR_N: 34, RAY_N: 28 } : { AO_N: 7, CS_N: 9, SSR_N: 20, RAY_N: 16 };
      const m = this.pass.material, key = JSON.stringify(d);
      if (key !== this._lastKey) { this._lastKey = key; Object.assign(m.defines, d); m.needsUpdate = true; }
      this.pass.enabled = any;
      this.pass.uniforms.uFx.value.set(c.ssr ? 1 : 0, c.ao ? 1 : 0, c.contact ? 1 : 0, c.rays ? 1 : 0);
    }
    GFX_TAG_U.value = any ? 1 : 0;
    this.setDepth(any);
    Atmos.setShadowQuality && Atmos.sun && Atmos.setShadowQuality();
    emit('gfx', c);
  },
  /** depth textures on the composer's ping-pong targets are only paid for while the pass is running */
  setDepth(on) {
    if (on === this.depthOn || !this.composer) return;
    this.depthOn = on;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (on) { const dt = new THREE.DepthTexture(rt.width, rt.height); dt.type = THREE.UnsignedIntType; dt.minFilter = dt.magFilter = THREE.NearestFilter; rt.depthTexture = dt; rt.depthBuffer = true; }
      else { if (rt.depthTexture) rt.depthTexture.dispose(); rt.depthTexture = null; }
      rt.dispose();
    }
  },
  statusText() {
    const c = this.cfg, S = Settings;
    if (!this.supported) return 'Unavailable — ' + (this.failReason || 'unsupported') + ' (standard renderer in use)';
    const parts = [];
    if (c.ssr) parts.push('reflections'); if (c.ao) parts.push('AO + bounce'); if (c.contact) parts.push('contact shadows'); if (c.rays) parts.push('light shafts');
    const head = S.rt === 'auto' ? `Auto → ${c.rt.toUpperCase()}${G.gpu && G.gpu.integrated ? ' (integrated GPU)' : ''}` : c.rt.toUpperCase();
    return `${head}: ${parts.length ? parts.join(' · ') : 'none active'}`;
  },
  /** adaptive quality calls this before dropping the whole quality tier */
  degrade() {
    if (Settings.rt !== 'auto' || !this.supported) return false;
    const cur = this.cfg.rt;
    if (cur === 'high') { this.autoCap = 'low'; this.apply(); return true; }
    if (cur === 'low') { this.autoCap = 'off'; this.apply(); return true; }
    return false;
  },

  /* -------------------------------------------------------------- per frame */
  _v: new THREE.Vector3(), _s: new THREE.Vector3(),
  update(dt, cam) {
    const c = this.cfg;
    if (this.pass && this.pass.enabled) {
      const U = this.pass.uniforms, A = Atmos, v = this._v;
      U.uProj.value.copy(cam.projectionMatrix); U.uProjInv.value.copy(cam.projectionMatrixInverse);
      U.uRes.value.set(G.renderWidth || window.innerWidth, G.renderHeight || window.innerHeight);
      U.uTime.value += dt;
      v.copy(A.sunDir).transformDirection(cam.matrixWorldInverse); U.uSunDirV.value.copy(v);
      v.copy(A.lightDir || A.sunDir).transformDirection(cam.matrixWorldInverse); U.uLightDirV.value.copy(v);
      U.uSunCol.value.copy(A.pal.sun).multiplyScalar(1.0 - A.cur.dark * 0.4);
      U.uFogD.value = A.scene.fog.density; U.uFogCol.value.copy(A.scene.fog.color); U.uZenith.value.copy(A.pal.zenith); U.uUpV.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
      // sun position on screen + how strongly shafts should show
      const s = this._s.copy(cam.position).addScaledVector(A.sunDir, 400).project(cam);
      const behind = s.z > 1, edge = 1 - smoothstep(1.0, 2.2, Math.max(Math.abs(s.x), Math.abs(s.y)));
      U.uSunUV.value.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
      const vis = A.skyUniforms.uSunVis.value * (1 - A.cur.cover * 0.8) * (1 - saturate(A.cur.fog * 30)) * (behind ? 0 : edge) * (1 - A.nightAmt);
      const fogGlow = (0.35 + saturate(A.cur.fog * 70) * 1.4 + A.cur.rain * 0.3) * A.skyUniforms.uSunVis.value * (1 - A.nightAmt * 0.9) * (1 - A.cur.dark * 0.5);
      const high = c.rt === 'high', sunI = SU.uSunI.value;
      U.uQ.value.set(c.rays ? vis * (high ? 0.9 : 0.7) : 0, c.rays ? 0.5 * fogGlow : 0, (high ? 1.7 : 1.3) * (0.45 + 0.55 * Math.max(A.cur.wet, 0.2)), 0.5 * saturate(sunI * 1.4 + 0.1));
      U.uP.value.set(high ? 1.25 : 1.0, 0.55, 0.55 + A.nightAmt * 0.0, high ? 0.8 : 0.6);
    }
    this.updateFlash(dt, cam);
    Leaves.update(dt, cam);
  },

  /* --------------------------------------------------------------- flashlight */
  initFlash(scene) {
    const L = G.flashlight; if (!L) return;
    this.flash = L;
    const len = 20, ang = 0.4, r = Math.tan(ang) * len;
    const geo = new THREE.ConeGeometry(r, len, 28, 1, true); geo.translate(0, -len / 2, 0); geo.rotateX(-Math.PI / 2);          // apex at origin, opens toward -Z
    this.cone = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uAmt: { value: 0 }, uLen: { value: len }, uCol: { value: new THREE.Color(1, 0.92, 0.78) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vZ = position.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uAmt, uLen; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ float k = abs(dot(normalize(vN), vV)); float lenF = clamp(vZ / uLen, 0.0, 1.0); float a = pow(k, 1.6) * (1.0 - lenF) * (1.0 - lenF) * smoothstep(0.0, 0.08, lenF) * uAmt; gl_FragColor = vec4(uCol * a, a); }',
    }));
    this.cone.frustumCulled = false; this.cone.renderOrder = 55; this.cone.visible = false;
    scene.add(this.cone);
    this.applyFlash();
  },
  applyFlash() {
    const L = this.flash; if (!L) return;
    const want = !!Settings.flashShadows && (Settings.quality === 'high' || Settings.quality === 'ultra');
    if (L.castShadow !== want) {
      L.castShadow = want;
      if (want) { L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0006; L.shadow.normalBias = 0.03; L.shadow.camera.near = 0.3; L.shadow.camera.far = 45; L.shadow.autoUpdate = false; L.shadow.needsUpdate = false; }
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
  },
  updateFlash(dt, cam) {
    const L = this.flash; if (!L) return;
    const on = L.intensity > 4;
    if (L.castShadow) { L.shadow.autoUpdate = on; if (on) L.shadow.needsUpdate = true; }
    if (!this.cone) return;
    // visible beam: shows in fog, rain, darkness and dust
    const A = Atmos, ambient = 0.18 + saturate(A.cur.fog * 60) * 0.9 + A.cur.rain * 0.4 + A.nightAmt * 0.7 - A.dayAmt * 0.15;
    this.cone.visible = on; this.cone.material.uniforms.uAmt.value = on ? clamp(ambient, 0.05, 1.2) * 0.16 * (L.intensity / 200) : 0;
    if (on) { this.cone.position.copy(L.position); this.cone.lookAt(L.target.position); }
  },
};

/* ================================================================== leaves */
const Leaves = {
  pool: null, acc: 0, near: [], nearT: 0,
  init(scene) {
    const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.translate(32, 32); x.rotate(-0.6);
    const g = x.createLinearGradient(-26, 0, 26, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, '#d8d8d8');
    x.fillStyle = g; x.beginPath(); x.moveTo(-26, 0); x.bezierCurveTo(-12, -17, 12, -15, 26, 0); x.bezierCurveTo(12, 15, -12, 17, -26, 0); x.fill();
    x.strokeStyle = 'rgba(90,90,90,.7)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-24, 0); x.lineTo(24, 0); x.stroke();
    const tex = canvasTex(c, { repeat: false, mip: false }); tex.minFilter = THREE.LinearFilter;
    this.pool = new ParticlePool(scene, 150, tex, false, true);
    this.pool.points.renderOrder = 12;
    this.pool.uniforms.uLight.value.set(1, 1, 1);
  },
  update(dt, cam) {
    if (!this.pool) return;
    const on = Settings.particlesFx && G.quality.particles > 0.7 && G.state !== 'menu' && Atmos.cur.rain < 0.6;
    const scale = G.renderHeight / (2 * Math.tan(cam.fov * DEG / 2));
    this.pool.uniforms.uScale.value = scale; this.pool.uniforms.uLight.value.copy(Atmos.pal.horizon).multiplyScalar(0.45 + 0.9 * Atmos.dayAmt).addScalar(0.03);
    const wind = SU.uWind.value, ws = 0.35 + SU.uWindStr.value;
    // trees near the camera are the emitters
    this.nearT -= dt;
    if (this.nearT <= 0 && World.vegetation) {
      this.nearT = 1.2; this.near.length = 0;
      for (const def of World.vegetation) {
        if (!def.pos || def.name === 'bush') continue;
        for (const p of def.pos) { const dx = p[0] - cam.position.x, dz = p[1] - cam.position.z; if (dx * dx + dz * dz < 55 * 55) this.near.push(p.concat(def.name === 'oak' ? 1 : 0.5)); }
      }
    }
    if (on && this.near.length) {
      this.acc += dt * (1.4 + ws * 2.4) * Math.min(1, this.near.length / 6);
      while (this.acc > 1) {
        this.acc -= 1;
        const t = this.near[(Math.random() * this.near.length) | 0], a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 2.4 * t[2];
        const x = t[0] + Math.cos(a) * r, z = t[1] + Math.sin(a) * r, y = terrainHeight(x, z) + (4.5 + Math.random() * 3.5) * t[2] * (t[3] === 1 ? 1 : 1.6);
        const g = Math.random(), col = g < 0.7 ? [0.16 + Math.random() * 0.12, 0.26 + Math.random() * 0.14, 0.05] : g < 0.9 ? [0.45, 0.42, 0.08] : [0.38, 0.2, 0.06];
        this.pool.spawn(x, y, z, wind.x * ws * 1.1 + (Math.random() - 0.5) * 0.4, -0.2, wind.y * ws * 1.1 + (Math.random() - 0.5) * 0.4, 9 + Math.random() * 5, 0.11, 0.11, 0.95, col[0], col[1], col[2], 0.55, 0.972, (Math.random() - 0.5) * 3);
      }
    }
    // flutter + wind (cheap per-particle steering on top of the pool's gravity / drag)
    const p = this.pool, T = performance.now() * 0.001;
    for (let i = 0; i < p.max; i++) {
      if (p.life[i] >= p.maxLife[i]) continue;
      const k = i * 3, ph = i * 1.7 + T * 1.9;
      p.vel[k] += (wind.x * ws * 0.9 + Math.sin(ph) * 0.35 - p.vel[k]) * 0.35 * dt;
      p.vel[k + 2] += (wind.y * ws * 0.9 + Math.cos(ph * 0.8) * 0.35 - p.vel[k + 2]) * 0.35 * dt;
      p.vel[k + 1] += Math.sin(ph * 1.3) * 0.25 * dt;
      const gy = terrainHeight(p.pos[k], p.pos[k + 2]); if (p.pos[k + 1] < gy + 0.05) { p.pos[k + 1] = gy + 0.05; p.vel[k] *= 0.2; p.vel[k + 1] = 0; p.vel[k + 2] *= 0.2; p.rotSpeed[i] = 0; p.life[i] = Math.max(p.life[i], p.maxLife[i] - 1.2); }
    }
    p.update(dt);
  },
};
