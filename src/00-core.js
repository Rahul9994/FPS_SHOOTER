/* =====================================================================
 *  HOLLOW RIDGE  -  00-core.js
 *  Shared math helpers, noise, settings, game state, material patching
 * ===================================================================== */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const saturate = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const nextFrame = () => new Promise((r) => { let d = false; const f = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- noise */
const Noise = (() => {
  const perm = new Uint8Array(512);
  const rng = mulberry32(90210);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function perlin(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g00 = perm[perm[X] + Y] % 12, g10 = perm[perm[X + 1] + Y] % 12;
    const g01 = perm[perm[X] + Y + 1] % 12, g11 = perm[perm[X + 1] + Y + 1] % 12;
    const n00 = GX[g00] * xf + GY[g00] * yf;
    const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
    const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.35;
  }
  /* periodic perlin: lattice wraps every `px` / `py` cells (for tileable textures) */
  function tperlin(x, y, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const g00 = perm[perm[x0] + y0] % 12, g10 = perm[perm[x1] + y0] % 12;
    const g01 = perm[perm[x0] + y1] % 12, g11 = perm[perm[x1] + y1] % 12;
    const n00 = GX[g00] * xf + GY[g00] * yf;
    const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
    const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.35;
  }
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * perlin(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  function tfbm(x, y, period, oct = 4, gain = 0.5, periodY = period) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * tperlin(x * f, y * f, period * f, periodY * f); n += a; a *= gain; f *= 2; }
    return s / n;
  }
  function ridged(x, y, oct = 5, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(perlin(x * f, y * f)); v *= v;
      s += a * v; n += a; a *= gain; f *= lac;
    }
    return s / n;
  }
  return { perlin, tperlin, fbm, tfbm, ridged };
})();

/* ------------------------------------------------------------- settings */
const QUALITY = {
  low:    { name: 'Low',    pixelRatio: 0.8,  msaa: 0, fxaa: true,  shadowMap: 1024, shadowRange: 50,  softShadows: false, grass: 0.4,  bloom: false, trees: 0.6,  particles: 0.6, cost: 0.34 },
  medium: { name: 'Medium', pixelRatio: 1.0,  msaa: 0, fxaa: true,  shadowMap: 2048, shadowRange: 65,  softShadows: false, grass: 0.62, bloom: false, trees: 0.85, particles: 0.8, cost: 0.46 },
  high:   { name: 'High',   pixelRatio: 1.0,  msaa: 2, fxaa: false, shadowMap: 2048, shadowRange: 85,  softShadows: true,  grass: 1.0,  bloom: true,  trees: 1.0,  particles: 1.0, cost: 1.0 },
  ultra:  { name: 'Ultra',  pixelRatio: 1.5,  msaa: 4, fxaa: false, shadowMap: 4096, shadowRange: 105, softShadows: true,  grass: 1.35, bloom: true,  trees: 1.0,  particles: 1.0, cost: 2.2 },
};
const urlParams = new URLSearchParams(location.search);
const Settings = (() => {
  const defaults = {
    quality: 'high', autoQuality: true, fov: 100, sens: 1.0, volume: 0.8, menuKey: 'F1', invertY: false, bobbing: 1.0, adaptive: true, showFps: false,
    fpsCap: 0,             // frame-rate limit: 0 = every display refresh (default), otherwise 30 / 60 / 90 / 120 - less GPU load, heat and fan noise
    // advanced graphics (see src/93-gfx.js). 'auto' = pick from the GPU tier + what the browser supports
    rt: 'auto',            // ray-marched lighting: auto | off | low | high
    reflections: 'auto',   // auto | off | probe | ssr
    ao: 'auto',            // ambient occlusion + bounce light: auto | off | on
    contactShadows: 'auto',// auto | off | on
    volumetric: 'auto',    // light shafts + fog scattering: auto | off | on
    shadowQ: 'auto',       // auto | low | medium | high | ultra  (overrides the tier's shadow-map size)
    particlesFx: true,     // falling leaves, dust and debris
    flashShadows: true,    // flashlight casts shadows (High / Ultra)
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hollowRidge.settings') || '{}'); } catch (e) { /* ignore */ }
  const s = Object.assign({}, defaults, saved);
  if (urlParams.get('q') && QUALITY[urlParams.get('q')]) { s.quality = urlParams.get('q'); s.autoQuality = false; }
  if (urlParams.has('noadapt')) s.adaptive = false;
  s.save = function () {
    try {
      const o = Object.assign({}, this); delete o.save;
      if (urlParams.get('q')) { delete o.quality; delete o.autoQuality; }     // URL overrides are never persisted
      localStorage.setItem('hollowRidge.settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('hollowRidge.settings') || '{}'), o)));
    } catch (e) { /* ignore */ }
  };
  return s;
})();

/* ------------------------------------------------------------ game state */
const G = {
  mode: 'sp',             // sp | mp  (multiplayer worlds contain only connected human players)
  state: 'loading',       // loading | menu | playing | dead
  paused: false,          // gameplay simulation paused (menus)
  menuOpen: false,        // cheat menu
  pauseMenuOpen: false,
  pointerLocked: false,
  lockUnsupported: false,
  time: 0,
  kills: 0,
  deaths: 0,
  shots: 0,
  hits: 0,
  cheats: {
    god: false,            // no damage taken
    unlimitedHealth: false,// health pinned to max (damage still "hurts" for a frame)
    infiniteAmmo: false,   // reserve ammo never decreases
    noReload: false,       // magazine never decreases
    noTarget: false,       // enemies ignore the player
    freezeAI: false,       // enemies stop moving / shooting
  },
  quality: QUALITY[Settings.quality],
};

/* tiny event bus */
const Bus = new EventTarget();
const emit = (name, detail) => Bus.dispatchEvent(new CustomEvent(name, { detail }));
const on = (name, fn) => Bus.addEventListener(name, (e) => fn(e.detail));

/* ------------------------------------------------- shader patch helpers */
function rep(src, token, text, label) {
  if (!src.includes(token)) { console.warn('[patch] token not found:', token, label || ''); return src; }
  return src.replace(token, text);
}

/* uniforms shared by every patched world material */
const SU = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.9, 0.4) },       // normalised direction
  uWindStr: { value: 0.45 },
  uWet: { value: 0 },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSunI: { value: 1 },
  uCamPos: { value: new THREE.Vector3() },
  uCamFwd: { value: new THREE.Vector2() },
  uHeightTex: { value: null },
  uSplatTex: { value: null },
  uAgents: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, 0, 0)) }, // x,z,radius,strength
  uGrassTint: { value: new THREE.Color(1, 1, 1) },
  uCloudShade: { value: 0 },
  uCloudOff: { value: new THREE.Vector2() },
};

/* GLSL: bilinear height lookup from the heightfield texture */
const GLSL_HEIGHT = /* glsl */`
uniform sampler2D uHeightTex;
uniform sampler2D uSplatTex;
const float HM_HALF = 224.0;
const float HM_N = 449.0;
float terrainH(vec2 p){
  vec2 q = clamp(p + HM_HALF, 0.0, HM_N - 1.001);
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  float a = texelFetch(uHeightTex, i, 0).r;
  float b = texelFetch(uHeightTex, i + ivec2(1,0), 0).r;
  float c = texelFetch(uHeightTex, i + ivec2(0,1), 0).r;
  float d = texelFetch(uHeightTex, i + ivec2(1,1), 0).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
vec3 terrainN(vec2 p){
  float e = 1.0;
  float hl = terrainH(p - vec2(e,0.0)), hr = terrainH(p + vec2(e,0.0));
  float hd = terrainH(p - vec2(0.0,e)), hu = terrainH(p + vec2(0.0,e));
  return normalize(vec3(hl - hr, 2.0 * e, hd - hu));
}
vec4 splatAt(vec2 p){
  return texture2D(uSplatTex, (clamp(p + HM_HALF, 0.0, HM_N - 1.0) + 0.5) / HM_N);
}
`;

const GLSL_HASH = /* glsl */`
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec4 hash42(vec2 p){ vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;

/* wind field shared by grass + foliage (returns xz displacement direction*strength) */
const GLSL_WIND = /* glsl */`
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStr;
vec2 windField(vec2 p){
  vec2 d = uWind;
  float t = uTime;
  float travel = dot(p, d);
  float w1 = sin(travel * 0.22 - t * (1.1 + uWindStr * 1.2));
  float w2 = sin(travel * 0.61 - t * (2.3 + uWindStr * 1.6) + p.y * 0.2);
  float gust = vnoise(p * 0.045 - d * t * (0.6 + uWindStr * 1.6));
  float amt = (0.35 + 0.65 * gust) * (0.5 + 0.5 * w1) + 0.18 * w2 * gust;
  return d * amt * (0.25 + uWindStr);
}
`;

/* drifting cloud shadows: soft, slowly moving darker patches over the landscape (needs GLSL_HASH first) */
const GLSL_CLOUDSHADE = /* glsl */`
uniform float uCloudShade;
uniform vec2 uCloudOff;
float cloudShade(vec2 p){
  vec2 q = p * 0.0042 + uCloudOff;
  float n = vnoise(q) * 0.55 + vnoise(q * 2.3 + 7.1) * 0.3 + vnoise(q * 5.1 + 2.9) * 0.15;
  return 1.0 - smoothstep(0.50, 0.70, n) * 0.30 * uCloudShade;
}
`;
