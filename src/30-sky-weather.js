/* =====================================================================
 *  HOLLOW RIDGE  -  30-sky-weather.js
 *  Sky dome + clouds, time-of-day, weather (clear/cloudy/rain/fog/storm),
 *  rain + splashes, lightning, lighting + image based lighting
 * ===================================================================== */

/* ------------------------------------------------------------ palettes */
const SKY_KEYS = [
  //  sin(elev)   zenith               horizon             sun colour
  [-0.35, [0.003, 0.006, 0.020], [0.010, 0.016, 0.034], [1.0, 0.5, 0.3]],
  [-0.12, [0.008, 0.016, 0.052], [0.030, 0.040, 0.075], [1.0, 0.5, 0.3]],
  [-0.04, [0.040, 0.065, 0.170], [0.200, 0.140, 0.170], [1.0, 0.45, 0.25]],
  [0.02,  [0.120, 0.200, 0.440], [0.950, 0.460, 0.210], [1.0, 0.50, 0.25]],
  [0.09,  [0.170, 0.320, 0.640], [0.960, 0.700, 0.520], [1.0, 0.68, 0.42]],
  [0.22,  [0.190, 0.390, 0.760], [0.760, 0.820, 0.900], [1.0, 0.86, 0.70]],
  [0.55,  [0.150, 0.370, 0.800], [0.660, 0.800, 0.960], [1.0, 0.95, 0.88]],
  [1.0,   [0.130, 0.340, 0.790], [0.620, 0.780, 0.960], [1.0, 0.97, 0.92]],
];
function skyPalette(e, out) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && e > SKY_KEYS[i + 1][0]) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = saturate((e - a[0]) / (b[0] - a[0]));
  for (let k = 0; k < 3; k++) {
    out.zenith[k === 0 ? 'r' : k === 1 ? 'g' : 'b'] = lerp(a[1][k], b[1][k], t);
    out.horizon[k === 0 ? 'r' : k === 1 ? 'g' : 'b'] = lerp(a[2][k], b[2][k], t);
    out.sun[k === 0 ? 'r' : k === 1 ? 'g' : 'b'] = lerp(a[3][k], b[3][k], t);
  }
}

const GLSL_SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uGround, uSunColor;
uniform float uCover, uDark, uNight, uSunVis, uFlash, uFogAmt;
uniform vec2 uScroll;
${GLSL_HASH}
float cloudFbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.07 + vec2(11.3, 5.7); a *= 0.5; } return s * 1.07; }
float cloudFbm3(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.07 + vec2(11.3, 5.7); a *= 0.5; } return s * 1.14; }

vec3 skyBase(vec3 d){
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon, exp(-max(h, 0.0) * 7.0) * 0.45);
  float mu = max(dot(d, uSunDir), 0.0);
  float glow = pow(mu, 5.0) * 0.14 + pow(mu, 36.0) * 0.30 + pow(mu, 420.0) * 1.1;
  col += uSunColor * glow * uSunVis * (1.0 - uCover * 0.55);
  // below the horizon -> ground colour
  col = mix(col, uGround, smoothstep(0.0, -0.18, h));
  return col;
}

vec4 cloudLayer(vec3 d, float scale, float lift, float cover, vec2 scroll, float soft, bool lighting){
  if (d.y <= 0.0) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.085 + lift) * scale + scroll;
  float n = cloudFbm(uv);
  float detail = vnoise(uv * 5.3 + 3.1) * 0.12;
  float v = n + detail - 0.06;
  float th = mix(0.66, 0.30, cover);
  float dens = smoothstep(th, th + soft, v);
  vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * (0.07 + 0.2 * (1.0 - clamp(uSunDir.y, 0.0, 1.0)));
  float lit = 0.66;
  if (lighting) { float vs = cloudFbm3(uv + toSun) + detail - 0.06; lit = clamp(0.62 + (vs - v) * 5.0 - dens * 0.22, 0.0, 1.0); }
  vec3 litCol = uSunColor * (0.95 + 0.9 * uSunVis) * uSunVis + uHorizon * 0.32 + vec3(0.04, 0.05, 0.08) * uNight + vec3(0.09, 0.10, 0.14) * uNight;
  vec3 shadeCol = mix(uHorizon, uZenith, 0.35) * 0.62 + vec3(0.025, 0.03, 0.05) * uNight;
  vec3 c = mix(shadeCol, litCol, lit);
  float g = dot(c, vec3(0.333));
  c = mix(c, vec3(g), uCover * 0.42 + uDark * 0.25);
  c *= 1.0 - 0.62 * uDark;
  // silver lining near the sun
  float mu = max(dot(d, uSunDir), 0.0);
  c += uSunColor * pow(mu, 18.0) * (1.0 - dens) * 0.9 * uSunVis * smoothstep(th - 0.1, th + 0.1, v);
  float fade = smoothstep(0.0, 0.07 + 0.22 * uCover, d.y);
  return vec4(c, dens * fade);
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);

  // sun disc + moon disc (omitted from the IBL pass)
  #ifndef ENV_PASS
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.99955, 0.99985, sd);
  col += uSunColor * disc * 40.0 * uSunVis * (1.0 - uCover * 0.8);
  float md = dot(d, uMoonDir);
  float moonDisc = smoothstep(0.99935, 0.99965, md);
  float maria = vnoise(d.xz * 160.0 + d.y * 90.0);
  col += vec3(0.82, 0.88, 1.0) * moonDisc * (0.7 + 0.5 * maria) * 2.2 * uNight;
  col += vec3(0.35, 0.42, 0.65) * pow(max(md, 0.0), 160.0) * 0.28 * uNight * (1.0 - uCover * 0.7);
  #endif

  // stars
  #ifndef ENV_PASS
  if (uNight > 0.02 && d.y > 0.0) {
    vec3 p = d * 120.0; vec3 ip = floor(p); vec3 fp = p - ip - 0.5;
    float r = hash12(ip.xy * 1.31 + ip.z * 7.7);
    vec3 off = (vec3(hash12(ip.yz + 3.1), hash12(ip.zx + 9.7), hash12(ip.xy + 5.3)) - 0.5) * 0.6;
    float star = step(0.955, r) * smoothstep(0.27, 0.0, length(fp - off)) * (0.6 + 2.2 * hash12(ip.xy + ip.z));
    float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.55, 0.75))) * 3.2, 2.0));
    float milky = band * (0.35 + 0.65 * vnoise(d.xz * 30.0 + d.y * 12.0)) * 0.05;
    col += (vec3(star) * vec3(0.9, 0.95, 1.0) + vec3(0.5, 0.55, 0.8) * milky) * uNight * smoothstep(0.0, 0.1, d.y) * (1.0 - uCover * 0.85);
  }
  #endif

  // two cloud layers: puffy cumulus + high wisps
  vec4 c1 = cloudLayer(d, 0.85, 0.0, uCover, uScroll, 0.24, true);
  col = mix(col, c1.rgb, c1.a);
  vec4 c2 = cloudLayer(d, 0.45, 0.35, clamp(uCover * 0.8 + 0.12, 0.0, 1.0), uScroll * 0.55 + vec2(4.7, 2.2), 0.45, false);
  col = mix(col, c2.rgb, c2.a * 0.55);

  // distance haze towards the horizon
  float haze = exp(-max(d.y, 0.0) * (9.0 - uCover * 4.5)) * (0.42 + uFogAmt * 0.5 + uCover * 0.22);
  col = mix(col, uHorizon, clamp(haze, 0.0, 1.0));
  col = mix(col, uHorizon, uFogAmt * smoothstep(0.7, 0.0, d.y));
  col += vec3(0.55, 0.6, 0.85) * uFlash * (0.4 + 0.6 * c1.a);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GLSL_SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

/* ================================================================== */
const Atmos = {
  hour: 10.0,
  autoCycle: false,
  dayLengthMin: 10,        // real minutes per game day when cycling
  weatherType: 'clear',
  intensity: 0.6,
  cur: { cover: 0.28, rain: 0, fog: 0.00048, dark: 0, wind: 0.4, wet: 0 },
  tgt: { cover: 0.28, rain: 0, fog: 0.00048, dark: 0, wind: 0.4, wet: 0 },
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, -1, 0),
  elev: 0.8,
  dayAmt: 1, nightAmt: 0,
  exposure: 0.9,
  lightning: 0,
  _lightTimer: 8,
  _scroll: new THREE.Vector2(),
  _envTimer: 0, _envDirty: true, _envLast: { hour: -1, cover: -1, rain: -1 },
  pal: { zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), ground: new THREE.Color(), fog: new THREE.Color() },
  windAngle: 0.5,
  thunderQueue: [],

  init(renderer, scene, weaponScene) {
    this.renderer = renderer; this.scene = scene; this.weaponScene = weaponScene;
    const uniforms = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uZenith: { value: this.pal.zenith }, uHorizon: { value: this.pal.horizon }, uGround: { value: this.pal.ground }, uSunColor: { value: this.pal.sun },
      uCover: { value: 0.3 }, uDark: { value: 0 }, uNight: { value: 0 }, uSunVis: { value: 1 }, uFlash: { value: 0 }, uFogAmt: { value: 0 },
      uScroll: { value: this._scroll },
    };
    this.skyUniforms = uniforms;
    const mkMat = (env) => new THREE.ShaderMaterial({
      uniforms, vertexShader: GLSL_SKY_VERT, fragmentShader: GLSL_SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      defines: env ? { ENV_PASS: 1 } : {},
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mkMat(false));
    this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = 100;   // after opaque geometry -> early-z skips covered pixels
    scene.add(this.skyMesh);
    this.envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mkMat(true));
    envMesh.frustumCulled = false;
    this.envScene.add(envMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    /* lights */
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.camera.near = 5; this.sun.shadow.camera.far = 520;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xaac8ff, 0x405028, 0.4);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0005);

    /* weapon-scene lights (camera space, no shadows) */
    this.wSun = new THREE.DirectionalLight(0xffffff, 3);
    this.wHemi = new THREE.HemisphereLight(0xaac8ff, 0x405028, 0.4);
    weaponScene.add(this.wSun, this.wSun.target, this.wHemi);

    this.setupRain();
    this.setShadowQuality();
    this.update(0.001, new THREE.Vector3(), true);
  },

  setShadowQuality() {
    const q = Gfx.shadowCfg();
    const soft = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== soft) { this.renderer.shadowMap.type = soft; this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); }); }
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.radius = q.softShadows ? 3 : 1;
    const r = q.shadowRange, c = this.sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.updateProjectionMatrix();
  },

  /* ------------------------------------------------------- controls */
  setHour(h) { this.hour = ((h % 24) + 24) % 24; this._envDirty = true; },
  setWeather(type, intensity, instant) {
    this.weatherType = type;
    if (intensity !== undefined) this.intensity = clamp(intensity, 0.05, 1);
    const I = this.intensity;
    let t;
    switch (type) {
      case 'cloudy': t = { cover: lerp(0.55, 1.0, I), rain: 0, fog: lerp(0.0007, 0.0011, I), dark: lerp(0.12, 0.55, I), wind: lerp(0.35, 0.8, I) }; break;
      case 'rain':   t = { cover: 1, rain: lerp(0.2, 1, I), fog: lerp(0.0012, 0.0034, I), dark: lerp(0.38, 0.8, I), wind: lerp(0.4, 0.95, I) }; break;
      case 'fog':    t = { cover: 0.55, rain: 0, fog: lerp(0.004, 0.0145, I), dark: 0.18, wind: 0.08 }; break;
      case 'storm':  t = { cover: 1, rain: 1, fog: 0.0036, dark: 0.92, wind: 1.35 }; break;
      default:       t = { cover: lerp(0.06, 0.42, I), rain: 0, fog: 0.00046, dark: 0, wind: lerp(0.2, 0.6, I) };
    }
    this.tgt.cover = t.cover; this.tgt.rain = t.rain; this.tgt.fog = t.fog; this.tgt.dark = t.dark; this.tgt.wind = t.wind;
    this.tgt.wet = t.rain > 0.05 ? lerp(0.55, 1, t.rain) : 0;
    this._wetTargetRain = t.rain > 0.05;
    if (instant) { Object.assign(this.cur, this.tgt); this.cur.wet = this.tgt.wet; }
    this._envDirty = true;
    emit('weather', { type, intensity: this.intensity });
  },
  isStorm() { return this.weatherType === 'storm'; },
  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },

  /* ---------------------------------------------------------- rain */
  setupRain() {
    const makeQuadGeo = (count, withRnd = true) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      const r = new Float32Array(count * 4); const rng = mulberry32(count);
      for (let i = 0; i < r.length; i++) r[i] = rng();
      g.setAttribute('rnd', new THREE.InstancedBufferAttribute(r, 4));
      g.instanceCount = count;
      return g;
    };
    const res = new THREE.Vector2(1920, 1080);
    this.rainUniforms = {
      uTime: SU.uTime, uCam: SU.uCamPos, uIntensity: { value: 0 }, uBox: { value: 38 }, uHeight: { value: 22 },
      uSpeed: { value: 18 }, uLen: { value: 0.9 }, uWidthPx: { value: 1.9 }, uRes: { value: res },
      uSlant: { value: new THREE.Vector2(0.1, 0.05) }, uLight: { value: new THREE.Color(0.7, 0.75, 0.85) },
    };
    const rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        attribute vec2 corner; attribute vec4 rnd;
        uniform float uTime, uBox, uHeight, uSpeed, uIntensity, uLen, uWidthPx; uniform vec3 uCam; uniform vec2 uRes, uSlant;
        varying float vA;
        void main(){
          vec3 w;
          w.xz = rnd.xz * uBox;
          w.xz = mod(w.xz - uCam.xz + uBox * 0.5, uBox) + uCam.xz - uBox * 0.5;
          w.y = mod(rnd.y * uHeight - uTime * uSpeed * (0.85 + 0.3 * rnd.w), uHeight) + uCam.y - uHeight * 0.4;
          vec3 vel = normalize(vec3(uSlant.x, -1.0, uSlant.y));
          vec3 p0 = w, p1 = w - vel * uLen * (0.7 + 0.6 * rnd.z);
          vec4 c0 = projectionMatrix * viewMatrix * vec4(p0, 1.0);
          vec4 c1 = projectionMatrix * viewMatrix * vec4(p1, 1.0);
          if (c0.w < 0.2 || c1.w < 0.2 || fract(rnd.w * 91.7) > uIntensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          float asp = uRes.x / uRes.y;
          vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w;
          vec2 d = (s1 - s0) * vec2(asp, 1.0);
          float l = length(d); d = l > 1e-5 ? d / l : vec2(0.0, 1.0);
          vec2 nrm = vec2(-d.y, d.x) / vec2(asp, 1.0);
          vec4 c = mix(c0, c1, corner.y);
          c.xy += nrm * corner.x * (uWidthPx / uRes.y) * c.w;
          gl_Position = c;
          float dist = distance(w.xz, uCam.xz);
          vA = (1.0 - corner.y * 0.7) * smoothstep(uBox * 0.5, uBox * 0.2, dist) * smoothstep(0.0, 1.2, c0.w);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight; varying float vA;
        void main(){ gl_FragColor = vec4(uLight, vA * 0.5); }`,
    });
    this.rain = new THREE.Mesh(makeQuadGeo(9000), rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 50; this.rain.visible = false;
    this.scene.add(this.rain);

    /* splashes */
    this.splashUniforms = {
      uTime: SU.uTime, uCam: SU.uCamPos, uIntensity: { value: 0 }, uBox: { value: 26 },
      uHeightTex: SU.uHeightTex, uSplatTex: SU.uSplatTex, uLight: this.rainUniforms.uLight,
    };
    const splashMat = new THREE.ShaderMaterial({
      uniforms: this.splashUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        attribute vec2 corner; attribute vec4 rnd;
        uniform float uTime, uBox, uIntensity; uniform vec3 uCam;
        ${GLSL_HEIGHT}
        varying vec2 vC; varying float vA;
        void main(){
          vec2 xz = rnd.xy * uBox;
          xz = mod(xz - uCam.xz + uBox * 0.5, uBox) + uCam.xz - uBox * 0.5;
          float ph = fract(uTime * (1.3 + rnd.z * 1.2) + rnd.w * 13.0);
          float size = mix(0.035, 0.24, ph);
          vec3 p = vec3(xz.x, terrainH(xz) + 0.025, xz.y) + vec3(corner.x, 0.0, corner.y * 2.0 - 1.0) * size;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vC = vec2(corner.x, corner.y * 2.0 - 1.0);
          float dist = distance(xz, uCam.xz);
          float on = step(fract(rnd.z * 53.3), uIntensity);
          vA = on * (1.0 - ph) * (1.0 - ph) * smoothstep(uBox * 0.5, uBox * 0.15, dist);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight; varying vec2 vC; varying float vA;
        void main(){
          float d = length(vC);
          float ring = smoothstep(0.55, 0.78, d) * smoothstep(1.0, 0.82, d);
          float core = smoothstep(0.3, 0.0, d) * 0.5;
          gl_FragColor = vec4(uLight * 1.2, (ring + core) * vA * 0.55);
        }`,
    });
    /* airborne motes: pollen / dust catching the light on calm, sunny days */
    {
      const N = 520, pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4); const rg = mulberry32(99);
      for (let i = 0; i < rnd.length; i++) rnd[i] = rg();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('rnd', new THREE.BufferAttribute(rnd, 4));
      this.moteUniforms = { uTime: SU.uTime, uCam: SU.uCamPos, uWind: SU.uWind, uAmount: { value: 0 }, uScale: { value: 800 }, uLight: { value: new THREE.Color(1, 0.95, 0.85) } };
      const mm = new THREE.ShaderMaterial({
        uniforms: this.moteUniforms, transparent: true, depthWrite: false, fog: false,
        vertexShader: /* glsl */`
          attribute vec4 rnd; uniform float uTime, uAmount, uScale; uniform vec3 uCam; uniform vec2 uWind; varying float vA;
          void main(){
            float box = 26.0;
            vec3 w = vec3(rnd.x, rnd.y, rnd.z) * box;
            w.xz += uWind * uTime * (0.5 + rnd.w * 0.8) + vec2(sin(uTime * 0.4 + rnd.w * 20.0), cos(uTime * 0.33 + rnd.x * 20.0)) * 0.8;
            w.y += sin(uTime * 0.5 + rnd.z * 30.0) * 0.5 + uTime * 0.04 * rnd.w;
            w = mod(w - vec3(uCam.x, 0.0, uCam.z) + box * 0.5, box) - box * 0.5;
            w.y = mod(w.y + rnd.y * 6.0, 7.0) - 1.5;
            vec3 p = vec3(uCam.x + w.x, uCam.y + w.y, uCam.z + w.z);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp((0.016 + rnd.w * 0.028) * uScale / max(-mv.z, 0.1), 1.0, 7.0);
            vA = step(rnd.w, uAmount) * smoothstep(0.5, 3.0, -mv.z) * smoothstep(13.0, 6.0, length(w.xz)) * (0.5 + 0.5 * sin(uTime * 1.3 + rnd.x * 40.0));
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uLight; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.1, d) * vA * 0.55; if (a < 0.01) discard; gl_FragColor = vec4(uLight, a); }`,
      });
      this.motes = new THREE.Points(geo, mm); this.motes.frustumCulled = false; this.motes.renderOrder = 48; this.scene.add(this.motes);
    }
    this.splashes = new THREE.Mesh(makeQuadGeo(1500), splashMat);
    this.splashes.frustumCulled = false; this.splashes.renderOrder = 49; this.splashes.visible = false;
    this.scene.add(this.splashes);
  },

  /* -------------------------------------------------------- per frame */
  update(dt, camPos, force) {
    // advance the clock
    if (this.autoCycle) this.hour = (this.hour + dt * 24 / (this.dayLengthMin * 60)) % 24;

    // weather smoothing
    const k = 1 - Math.exp(-dt * 0.55);
    const c = this.cur, t = this.tgt;
    c.cover += (t.cover - c.cover) * k; c.rain += (t.rain - c.rain) * (1 - Math.exp(-dt * 0.8));
    c.fog += (t.fog - c.fog) * k; c.dark += (t.dark - c.dark) * k; c.wind += (t.wind - c.wind) * k;
    const wetRate = (t.wet > c.wet) ? 0.12 : 0.02;
    c.wet += (t.wet - c.wet) * (1 - Math.exp(-dt * wetRate));
    if (t.wet === 0 && c.wet < 0.003) c.wet = 0;

    // sun & moon
    const a = (this.hour - 6) / 24 * TAU;
    this.sunDir.set(-Math.cos(a), Math.sin(a), -0.5).normalize();
    this.moonDir.set(-this.sunDir.x * 0.9, -this.sunDir.y * 0.9 + 0.12, -this.sunDir.z).normalize();
    const e = this.sunDir.y;
    this.elev = e;
    const dayAmt = smoothstep(-0.12, 0.2, e);
    this.dayAmt = dayAmt; this.nightAmt = 1 - smoothstep(-0.22, -0.02, e);

    // palette
    skyPalette(e, this.pal);
    const overcast = saturate(c.cover * 1.1 - 0.15) * 0.85;
    const lum = this.pal.horizon.r * 0.3 + this.pal.horizon.g * 0.55 + this.pal.horizon.b * 0.15;
    const grayH = lum * (1 - c.dark * 0.45) * (0.88);
    const fogAmt = saturate((c.fog - 0.001) / 0.012);
    this.pal.zenith.lerp(_tcA.setRGB(grayH * 0.78, grayH * 0.84, grayH * 0.95), overcast * 0.9);
    this.pal.horizon.lerp(_tcA.setRGB(grayH * 1.0, grayH * 1.03, grayH * 1.08), overcast * 0.85 + fogAmt * 0.6);
    this.pal.zenith.multiplyScalar(1 - c.dark * 0.35);
    this.pal.zenith.lerp(this.pal.horizon, fogAmt * 0.75);

    // lightning
    this._updateLightning(dt);

    const flash = this.lightning;
    const nightAmt = this.nightAmt;
    this.pal.ground.copy(this.pal.horizon).multiply(_tcA.setRGB(0.55, 0.6, 0.45)).multiplyScalar(0.8);
    this.pal.fog.copy(this.pal.horizon);
    this.pal.fog.multiplyScalar(1 + flash * 0.4);

    // sky uniforms
    const su = this.skyUniforms;
    su.uCover.value = c.cover; su.uDark.value = c.dark; su.uNight.value = nightAmt;
    su.uSunVis.value = smoothstep(-0.06, 0.1, e); su.uFlash.value = flash; su.uFogAmt.value = fogAmt;
    const wdir = this.windAngle = 0.5 + Math.sin(performance.now() * 0.00004) * 0.5;
    const wx = Math.cos(wdir), wz = Math.sin(wdir);
    this._scroll.x += wx * dt * (0.0016 + c.wind * 0.0045);
    this._scroll.y += wz * dt * (0.0016 + c.wind * 0.0045);

    // lighting
    const sunVis = su.uSunVis.value;
    const sunI = 4.4 * Math.pow(smoothstep(-0.03, 0.30, e), 0.8) * (1 - overcast * 0.82 - c.dark * 0.1);
    const moonVis = smoothstep(-0.05, 0.2, this.moonDir.y);
    const moonI = 1.05 * nightAmt * moonVis * (1 - c.cover * 0.5);
    const wSun = sunI / Math.max(0.0001, sunI + moonI), wMoon = 1 - wSun;
    const ld = _tvA.copy(this.sunDir).multiplyScalar(wSun).addScaledVector(this.moonDir, wMoon).normalize();
    if (ld.y < 0.06) ld.y = 0.06, ld.normalize();     // keep shadow light above the horizon
    this.lightDir = (this.lightDir || new THREE.Vector3()).copy(ld);
    const lightCol = _tcB.copy(this.pal.sun).lerp(_tcA.setRGB(0.55, 0.65, 1.0), wMoon * 0.9 * nightAmt);
    const intensity = sunI + moonI + flash * 2.5;
    this.sun.color.copy(lightCol); this.sun.intensity = intensity;
    const hemiSky = _tcC.copy(this.pal.zenith).multiplyScalar(0.9).lerp(_tcA.setRGB(0.5, 0.6, 0.9), 0.35);
    const hemiGround = _tcD.setRGB(0.24, 0.26, 0.14).multiplyScalar(0.25 + 0.75 * dayAmt).lerp(_tcA.setRGB(0.2, 0.22, 0.28), nightAmt * 0.4);
    const hemiI = (0.12 + 0.34 * dayAmt) * (1 + overcast * 0.6) + nightAmt * 0.13 + flash * 0.9;
    this.hemi.color.copy(hemiSky); this.hemi.groundColor.copy(hemiGround); this.hemi.intensity = hemiI;
    this.envIntensity = (0.42 + 0.66 * dayAmt) * (1 + overcast * 0.15) + flash * 0.8;
    this.scene.environmentIntensity = this.envIntensity;
    this.weaponScene.environmentIntensity = this.envIntensity * 1.1;
    this.exposure = lerp(2.05, 0.88, dayAmt) * (1 + c.dark * 0.12) * (1 + fogAmt * 0.0);

    // fog
    this.scene.fog.color.copy(this.pal.fog);
    this.scene.fog.density = c.fog * (1 + nightAmt * 0.35);

    // shared shader uniforms
    SU.uSunDirW.value.copy(this.lightDir);
    SU.uSunColor.value.copy(lightCol).multiplyScalar(1 - c.dark * 0.4);
    SU.uSunI.value = saturate(intensity / 4.0) * (1 - overcast * 0.3);
    SU.uWet.value = c.wet;
    { const cc = clamp(c.cover, 0, 1); SU.uCloudShade.value = 4 * cc * (1 - cc) * smoothstep(-0.05, 0.25, e) * (1 - saturate(c.rain * 1.4)) * (1 - saturate(c.fog * 60));
      const sp = 0.010 + c.wind * 0.02; SU.uCloudOff.value.x += wx * dt * sp; SU.uCloudOff.value.y += wz * dt * sp; }
    SU.uWind.value.set(wx, wz);
    SU.uWindStr.value = c.wind;

    // rain visuals
    const ru = this.rainUniforms;
    const rainOn = c.rain > 0.02;
    this.rain.visible = this.splashes.visible = rainOn;
    if (rainOn) {
      ru.uIntensity.value = saturate(c.rain);
      this.splashUniforms.uIntensity.value = saturate(c.rain);
      ru.uSlant.value.set(wx * (0.08 + c.wind * 0.35), wz * (0.08 + c.wind * 0.35));
      ru.uLight.value.copy(this.pal.horizon).multiplyScalar(0.55 + 0.7 * dayAmt).addScalar(0.07);
    }

    // pollen motes: calm, sunny, clear days only
    { const calm = (1 - saturate(c.wind * 1.15)) * (1 - saturate(c.cover * 1.3 - 0.2)) * (1 - saturate(c.rain * 6)) * smoothstep(0.1, 0.45, e);
      this.moteUniforms.uAmount.value = calm; this.motes.visible = calm > 0.02; this.moteUniforms.uLight.value.copy(this.pal.sun).multiplyScalar(1.2);
      this.moteUniforms.uScale.value = (G.renderHeight || 720) / (2 * Math.tan((this._fov || 60) * DEG / 2)); }

    // env map refresh (throttled)
    this._envTimer -= dt;
    const L = this._envLast;
    const changed = Math.abs(this.hour - L.hour) > 0.05 || Math.abs(c.cover - L.cover) > 0.03 || Math.abs(c.rain - L.rain) > 0.05;
    if (force || (this._envTimer <= 0 && (changed || this._envDirty))) {
      this.updateEnvironmentMap();
      this._envTimer = 0.7; this._envDirty = false;
      L.hour = this.hour; L.cover = c.cover; L.rain = c.rain;
    }
  },

  updateEnvironmentMap() {
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.weaponScene.environment = rt.texture;
  },

  /** called each frame from main with the player's camera */
  syncCameras(camera, shadowCenter) {
    this._fov = camera.fov;
    // sky follows camera
    this.skyMesh.position.copy(camera.position);
    this.skyMesh.scale.setScalar(1);
    // sun shadow camera (texel snapped)
    const dir = this.lightDir;
    const sc = Gfx.shadowCfg(), range = sc.shadowRange, texel = (2 * range) / sc.shadowMap;
    const f = _v1.copy(dir).negate();
    const r = _v2.crossVectors(_up, f).normalize();
    const u = _v3.crossVectors(f, r);
    const px = shadowCenter.dot(r), py = shadowCenter.dot(u), pz = shadowCenter.dot(f);
    const sx = Math.round(px / texel) * texel, sy = Math.round(py / texel) * texel;
    this.sun.target.position.set(0, 0, 0).addScaledVector(r, sx).addScaledVector(u, sy).addScaledVector(f, pz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 260);
    this.sun.target.updateMatrixWorld();
    // weapon-scene lights live in camera space
    const q = _q1.copy(camera.quaternion).invert();
    const d2 = _v1.copy(dir).applyQuaternion(q);
    this.wSun.position.copy(d2).multiplyScalar(10);
    this.wSun.target.position.set(0, 0, 0); this.wSun.target.updateMatrixWorld();
    this.wSun.color.copy(this.sun.color); this.wSun.intensity = this.sun.intensity * 0.9;
    this.wHemi.color.copy(this.hemi.color); this.wHemi.groundColor.copy(this.hemi.groundColor);
    this.wHemi.intensity = this.hemi.intensity;
    // hemisphere "up" in camera space
    this.wHemi.position.set(0, 1, 0).applyQuaternion(q);
    // IBL must be rotated into camera space for the weapon scene
    if (this.weaponScene.environmentRotation) this.weaponScene.environmentRotation.setFromQuaternion(q);
  },

  /* ----------------------------------------------------- lightning */
  _updateLightning(dt) {
    if (this.weatherType === 'storm') {
      this._lightTimer -= dt;
      if (this._lightTimer <= 0) {
        this._lightTimer = rand(5, 14);
        this._flashSeq = [1, 0.1, 0.8, 0.0, 0.55, 0];
        this._flashT = 0;
        const delay = rand(0.4, 3.2);
        this.thunderQueue.push({ t: delay, power: rand(0.6, 1) });
      }
    }
    if (this._flashSeq) {
      this._flashT += dt * 7;
      const i = Math.floor(this._flashT);
      if (i >= this._flashSeq.length - 1) { this._flashSeq = null; this.lightning = 0; }
      else this.lightning = lerp(this._flashSeq[i], this._flashSeq[i + 1], this._flashT - i);
    } else this.lightning = damp(this.lightning, 0, 8, dt);
    for (let i = this.thunderQueue.length - 1; i >= 0; i--) {
      const th = this.thunderQueue[i]; th.t -= dt;
      if (th.t <= 0) { Audio3D.thunder(th.power); this.thunderQueue.splice(i, 1); }
    }
  },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion();
const _tcA = new THREE.Color(), _tcB = new THREE.Color(), _tcC = new THREE.Color(), _tcD = new THREE.Color(), _tvA = new THREE.Vector3();
