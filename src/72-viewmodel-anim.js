/* =====================================================================
 *  HOLLOW RIDGE  -  72-viewmodel-anim.js
 *  Keyframe animation (reloads, melee, draw/holster) + viewmodel runtime
 *  (sway, bob, recoil springs, ADS blending, muzzle flash)
 * ===================================================================== */

/* ------------------------------------------------------------ key tracks */
const EASE = {
  l: (t) => t,
  io: (t) => t * t * (3 - 2 * t),
  o: (t) => 1 - Math.pow(1 - t, 3),
  i: (t) => t * t * t,
  oo: (t) => 1 - Math.pow(1 - t, 5),
};
/** sample a track of [t, array|number, ease?] keys */
function sampleTrack(track, t, out) {
  if (!track || !track.length) return null;
  const first = track[0], last = track[track.length - 1];
  const isArr = Array.isArray(first[1]);
  if (t <= first[0]) return isArr ? copyInto(out, first[1]) : first[1];
  if (t >= last[0]) return isArr ? copyInto(out, last[1]) : last[1];
  let i = 0;
  while (i < track.length - 2 && t > track[i + 1][0]) i++;
  const a = track[i], b = track[i + 1];
  const u = EASE[b[2] || 'io']((t - a[0]) / (b[0] - a[0]));
  if (!isArr) return a[1] + (b[1] - a[1]) * u;
  for (let k = 0; k < a[1].length; k++) out[k] = a[1][k] + (b[1][k] - a[1][k]) * u;
  return out;
}
function copyInto(out, src) { for (let k = 0; k < src.length; k++) out[k] = src[k]; return out; }
const _sqa = new THREE.Quaternion(), _sqb = new THREE.Quaternion(), _sea = new THREE.Euler(), _seb = new THREE.Euler();
/** like sampleTrack, but the [x,y,z] keys are Euler angles that get slerped as quaternions, so a hand never takes a long twisting path between two grips */
function sampleEulerTrack(track, t, out) {
  if (!track || !track.length) return null;
  const first = track[0], last = track[track.length - 1];
  if (t <= first[0]) return copyInto(out, first[1]);
  if (t >= last[0]) return copyInto(out, last[1]);
  let i = 0;
  while (i < track.length - 2 && t > track[i + 1][0]) i++;
  const a = track[i], b = track[i + 1];
  const u = EASE[b[2] || 'io']((t - a[0]) / (b[0] - a[0]));
  _sqa.setFromEuler(_sea.set(a[1][0], a[1][1], a[1][2])); _sqb.setFromEuler(_seb.set(b[1][0], b[1][1], b[1][2]));
  _sea.setFromQuaternion(_sqa.slerp(_sqb, u), 'XYZ');
  out[0] = _sea.x; out[1] = _sea.y; out[2] = _sea.z;
  return out;
}

/* ------------------------------------------------- default hand poses
   Positions are in weapon-local space (metres); rotations are Euler XYZ. */
const POSE = {
  rifle: {
    // Both grips were solved numerically against the real rifle geometry (no clipping, palm/fingers touching, forearm lines up with the sleeve)
    R: { p: [0.0279, -0.1329, 0.1341], r: [0.0388, -0.1874, -1.7606], c: [0.4354, 0.5729, 0.6129, 0.6529, 0.2197], abd: 1.1128 },   // right hand on pistol grip, index along the receiver
    L: { p: [-0.0188, -0.0553, -0.2247], r: [0.4159, -1.0689, -2.5531], c: [0.3527, 0.4227, 0.4627, 0.5027, 0.4222], abd: 0.0715 }, // left hand cupped under the handguard, thumb forward along the side
  },
  knife: {
    R: { p: [0.0, -0.002, 0.01], r: [0.0, 0.0, -1.2], c: [0.9, 0.95, 0.95, 0.95, 0.75], abd: 0.0 },
    L: { p: [-0.06, -0.12, 0.18], r: [0.2, -0.3, 0.5], c: [0.55, 0.6, 0.6, 0.6, 0.3], abd: 0.2 },
  },
};
/** the left hand's grip on a magazine, expressed in the magazine's frame */
const MAG_GRIP = { p: new THREE.Vector3(-0.036, -0.075, 0.0), e: new THREE.Euler(0.0, 0.0, -1.5708) };
const VEST = [-0.17, -0.30, 0.10];       // where the spare magazines live (off the bottom-left of the screen)

const _gm = new THREE.Matrix4(), _gm2 = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _gp = new THREE.Vector3(), _gs = new THREE.Vector3(), _ge = new THREE.Euler();
/** pose of the left hand (in weapon space) that grips a magazine placed at magP/magR */
function handFromMag(magP, magR) {
  _gm.compose(_gp.fromArray(magP), _gq.setFromEuler(_ge.set(magR[0], magR[1], magR[2])), _gs.set(1, 1, 1));
  _gm2.compose(MAG_GRIP.p, new THREE.Quaternion().setFromEuler(MAG_GRIP.e), _gs.set(1, 1, 1));
  _gm.multiply(_gm2);
  _gm.decompose(_gp, _gq, _gs);
  _ge.setFromQuaternion(_gq, 'XYZ');
  return { p: [_gp.x, _gp.y, _gp.z], r: [_ge.x, _ge.y, _ge.z] };
}

/* =================================================================== CLIPS */
const CLIPS = {};
function buildClips() {
  const MR = RIFLE.magRest.toArray();
  const R = POSE.rifle, KN = POSE.knife;
  const lDef = [R.L.p, R.L.r];

  /* ------------------------------------------------ tactical / empty reload */
  function reload(empty) {
    const T = empty ? 1 : 0;
    const out = [MR[0] - 0.004, MR[1] - 0.20, MR[2] - 0.012];     // fully extracted
    const dropAt = empty ? 0.86 : 0.0;
    const stow = [MR[0] - 0.05, MR[1] - 0.26, MR[2] + 0.04];
    // magazine path (weapon space) for the OLD magazine while it is held
    const oldP = [[0.34, MR, 'l'], [0.58, [MR[0], MR[1] - 0.012, MR[2]], 'io'], [0.90, out, 'o']];
    const oldR = [[0.34, [0, 0, 0], 'l'], [0.58, [0, 0, 0], 'io'], [0.90, [0.1, 0.0, 0.2], 'o']];
    const t = {
      dur: empty ? 3.25 : 2.45,
      /* weapon pose offset (additive to hip pose) */
      pivotP: [[0.0, [0, 0, 0]], [0.30, [-0.02, 0.025, 0.03], 'io'], [1.55, [-0.02, 0.025, 0.03], 'io'], [empty ? 2.0 : 1.95, [-0.012, 0.015, 0.02], 'io'], [empty ? 3.2 : 2.4, [0, 0, 0], 'io']],
      pivotR: [[0.0, [0, 0, 0]], [0.30, [0.20, 0.34, -0.42], 'io'], [1.55, [0.22, 0.30, -0.40], 'io'], [empty ? 2.0 : 1.95, [0.16, 0.20, -0.18], 'io'], [empty ? 3.2 : 2.4, [0, 0, 0], 'io']],
      /* left hand keys: approach, grab old mag, pull, [drop|stow], vest, new mag up, insert, tap, return */
      lP: [], lR: [], lC: [],
      mag: { p: [], r: [] },          // OLD magazine track (applied while attached to weapon / in hand)
      newMag: { p: [], r: [] },        // NEW magazine track
      handle: [],
      events: [],
      rFinger: [],
    };
    // --- left hand to magazine
    const grabHand = handFromMag(MR, [0, 0, 0]);
    t.lP.push([0.0, R.L.p, 'l'], [0.12, R.L.p, 'io'], [0.36, grabHand.p, 'io']);
    t.lR.push([0.0, R.L.r, 'l'], [0.12, R.L.r, 'io'], [0.36, grabHand.r, 'io']);
    t.lC.push([0.0, R.L.c, 'l'], [0.12, R.L.c, 'io'], [0.30, [0.15, 0.15, 0.15, 0.15, 0.1], 'io'], [0.40, [0.78, 0.82, 0.84, 0.86, 0.6], 'io']);
    // magazine release tap by the right hand index/thumb (visual: trigger finger flick)
    t.rFinger.push([0.0, 0], [0.30, 0], [0.34, 1], [0.46, 0, 'o']);
    t.events.push([0.34, 'magRelease'], [0.40, 'attachOld'], [0.58, 'magOutSnd']);
    // --- pull the mag out following oldP/oldR, hand slaved (dense keys so the hand tracks the mag exactly)
    const slave = (pTrack, rTrack, t0, t1) => {
      for (let ts = t0; ts < t1 + 1e-6; ts += 0.04) {
        const mp = [0, 0, 0], mr = [0, 0, 0];
        sampleTrack(pTrack, ts, mp); sampleTrack(rTrack, ts, mr);
        const h = handFromMag(mp, mr);
        t.lP.push([ts, h.p, 'l']); t.lR.push([ts, h.r, 'l']);
      }
    };
    t.mag.p = oldP; t.mag.r = oldR;
    slave(oldP, oldR, 0.40, 0.90);
    let tNow = 0.90;
    if (empty) {
      // drop the old magazine, hand opens and goes to the vest
      t.events.push([dropAt, 'dropOld']);
      t.lC.push([0.86, [0.78, 0.82, 0.84, 0.86, 0.6], 'l'], [0.98, [0.2, 0.2, 0.2, 0.2, 0.1], 'io']);
      t.lP.push([1.18, VEST, 'io']); t.lR.push([1.18, [0.9, 0.2, 0.7], 'io']);
      t.lC.push([1.18, [0.2, 0.2, 0.2, 0.2, 0.1], 'io'], [1.28, [0.78, 0.82, 0.84, 0.86, 0.6], 'io']);
      tNow = 1.28;
    } else {
      // stow the old magazine in the vest
      t.lP.push([1.18, stow, 'io'], [1.34, VEST, 'io']); t.lR.push([1.18, [0.3, 0.1, 0.8], 'io'], [1.34, [0.9, 0.2, 0.7], 'io']);
      t.mag.p.push([1.18, stow, 'io']); t.mag.r.push([1.18, [0.3, 0.1, 0.4], 'io']);
      t.events.push([1.34, 'stowOld']);
      t.lC.push([1.18, [0.78, 0.82, 0.84, 0.86, 0.6], 'l'], [1.4, [0.2, 0.2, 0.2, 0.2, 0.1], 'io'], [1.5, [0.78, 0.82, 0.84, 0.86, 0.6], 'io']);
      tNow = 1.5;
    }
    t.events.push([tNow - 0.05, 'showNew']);
    // --- new magazine path, hand slaved
    const under = [MR[0], MR[1] - 0.215, MR[2] - 0.004];
    const nP = [[tNow - 0.05, [VEST[0] + 0.03, VEST[1] + 0.02, VEST[2] - 0.0], 'l'], [tNow + 0.32, [MR[0] - 0.02, MR[1] - 0.26, MR[2] + 0.02], 'io'], [tNow + 0.50, under, 'io'], [tNow + 0.66, [MR[0], MR[1] + 0.001, MR[2]], 'o'],
      [tNow + 0.80, [MR[0], MR[1] - 0.006, MR[2]], 'io'], [tNow + 0.88, MR, 'io']];
    const nR = [[tNow - 0.05, [0.4, 0.2, 0.3], 'l'], [tNow + 0.32, [0.15, 0.05, 0.1], 'io'], [tNow + 0.50, [0, 0, 0], 'io'], [tNow + 0.88, [0, 0, 0], 'io']];
    t.newMag.p = nP; t.newMag.r = nR;
    slave(nP, nR, tNow - 0.05, tNow + 0.88);
    t.events.push([tNow + 0.64, 'magInSnd'], [tNow + 0.70, 'seatNew'], [tNow + 0.82, 'magTap']);
    t.lC.push([tNow + 0.88, [0.78, 0.82, 0.84, 0.86, 0.6], 'l']);
    let tEnd = tNow + 0.88;
    if (empty) {
      // reach to the charging handle, rack it, return
      const handlePos = [-0.015, 0.058, 0.128], handleRot = [0.2, 0.0, 1.35];
      t.lP.push([tEnd + 0.12, [MR[0] - 0.04, MR[1] + 0.02, MR[2] + 0.08], 'io'], [tEnd + 0.30, handlePos, 'io'], [tEnd + 0.50, [handlePos[0], handlePos[1], handlePos[2] + 0.075], 'o'], [tEnd + 0.62, [handlePos[0], handlePos[1], handlePos[2] + 0.075], 'l'], [tEnd + 0.76, handlePos, 'oo'], [tEnd + 1.0, R.L.p, 'io']);
      t.lR.push([tEnd + 0.12, [0.7, 0.0, 1.0], 'io'], [tEnd + 0.30, handleRot, 'io'], [tEnd + 0.76, handleRot, 'l'], [tEnd + 1.0, R.L.r, 'io']);
      t.lC.push([tEnd + 0.12, [0.2, 0.2, 0.2, 0.2, 0.1], 'io'], [tEnd + 0.30, [0.8, 0.15, 0.15, 0.15, 0.8], 'io'], [tEnd + 0.76, [0.8, 0.15, 0.15, 0.15, 0.8], 'l'], [tEnd + 0.9, [0.2, 0.2, 0.2, 0.2, 0.1], 'io'], [tEnd + 1.0, R.L.c, 'io']);
      t.handle.push([0, 0], [tEnd + 0.30, 0, 'l'], [tEnd + 0.50, 0.075, 'o'], [tEnd + 0.62, 0.075, 'l'], [tEnd + 0.76, 0, 'oo']);
      t.events.push([tEnd + 0.42, 'boltBackSnd'], [tEnd + 0.70, 'boltFwdSnd'], [tEnd + 0.72, 'boltClose']);
      tEnd += 1.0;
    } else {
      t.lP.push([tEnd + 0.12, [MR[0] - 0.03, MR[1] - 0.01, MR[2] - 0.05], 'io'], [tEnd + 0.50, R.L.p, 'io']);
      t.lR.push([tEnd + 0.12, [1.1, -0.1, 1.2], 'io'], [tEnd + 0.50, R.L.r, 'io']);
      t.lC.push([tEnd + 0.12, [0.4, 0.4, 0.4, 0.4, 0.3], 'io'], [tEnd + 0.50, R.L.c, 'io']);
      tEnd += 0.5;
    }
    t.dur = tEnd + 0.12;
    // fix pivot return time to the real end
    const HOLD = [-0.115, 0.17, 0.05];
    t.pivotP = [[0.0, [0, 0, 0]], [0.32, HOLD.slice(), 'io'], [tNow + 0.9, HOLD.slice(), 'io'], [tEnd - 0.1, [0, 0, 0], 'io']];
    t.pivotR = [[0.0, [0, 0, 0]], [0.32, [0.55, 0.30, -0.50], 'io'], [tNow - 0.2, [0.58, 0.34, -0.55], 'io'], [tNow + 0.9, [0.45, 0.26, -0.40], 'io'], [tEnd - 0.1, [0, 0, 0], 'io']];
    return t;
  }
  CLIPS.reloadTactical = reload(false);
  CLIPS.reloadEmpty = reload(true);

  /* ------------------------------------------------------------ draw/holster */
  CLIPS.drawRifle = {
    dur: 0.62,
    pivotP: [[0, [0.10, -0.30, 0.10]], [0.45, [-0.005, 0.01, 0.0], 'o'], [0.62, [0, 0, 0], 'io']],
    pivotR: [[0, [-0.9, 0.5, 0.35]], [0.45, [0.04, -0.02, 0.0], 'o'], [0.62, [0, 0, 0], 'io']],
    events: [[0.08, 'drawSnd']],
  };
  CLIPS.holsterRifle = {
    dur: 0.3,
    pivotP: [[0, [0, 0, 0]], [0.3, [0.1, -0.3, 0.1], 'i']],
    pivotR: [[0, [0, 0, 0]], [0.3, [-0.9, 0.5, 0.35], 'i']],
    events: [],
  };
  CLIPS.drawKnife = {
    dur: 0.7,
    pivotP: [[0, [0.12, -0.28, 0.08]], [0.35, [0.0, 0.03, -0.03], 'o'], [0.70, [0, 0, 0], 'io']],
    pivotR: [[0, [-1.2, 0.2, 0.9]], [0.18, [-0.4, 0.5, 1.4], 'io'], [0.40, [0.25, -0.15, -0.3], 'o'], [0.70, [0, 0, 0], 'io']],
    events: [[0.05, 'knifeDrawSnd']],
  };
  CLIPS.holsterKnife = {
    dur: 0.26,
    pivotP: [[0, [0, 0, 0]], [0.26, [0.12, -0.28, 0.08], 'i']],
    pivotR: [[0, [0, 0, 0]], [0.26, [-1.2, 0.2, 0.9], 'i']],
    events: [],
  };

  /* ------------------------------------------------- weapon inspection (V)
     The rifle is lifted toward the camera and turned to show its left side, its top and its right side,
     then lowered back to the hip. Both hands stay on the weapon (they are attached to it). */
  CLIPS.inspectRifle = {
    dur: 5.6,
    pivotP: [[0, [0, 0, 0]], [0.55, [-0.10, 0.07, -0.14], 'io'], [1.0, [-0.118, 0.085, -0.30], 'io'], [1.9, [-0.118, 0.085, -0.30], 'io'], [2.5, [-0.118, 0.07, -0.24], 'io'], [3.2, [-0.118, 0.07, -0.24], 'io'], [3.9, [-0.118, 0.085, -0.30], 'io'], [4.7, [-0.118, 0.085, -0.30], 'io'], [5.5, [0, 0, 0], 'io']],
    pivotR: [[0, [0, 0, 0]], [0.55, [0.14, 0.40, -0.16], 'io'], [1.0, [0.06, 1.18, -0.06], 'io'], [1.9, [0.04, 1.30, -0.04], 'io'], [2.5, [0.98, 0.34, 0.0], 'io'], [3.2, [1.06, 0.30, 0.0], 'io'], [3.9, [0.10, -1.20, 0.08], 'io'], [4.7, [0.08, -1.30, 0.06], 'io'], [5.5, [0, 0, 0], 'io']],
    events: [[0.05, 'cloth'], [1.0, 'tap'], [3.9, 'tap'], [5.1, 'cloth']],
  };

  /* ----------------------------------------------------------------- melee */
  CLIPS.knifeSlash = {
    dur: 0.62, hitAt: 0.2, heavy: false,
    pivotP: [[0, [0, 0, 0]], [0.10, [0.10, 0.02, 0.06], 'io'], [0.20, [-0.12, 0.0, -0.10], 'o'], [0.30, [-0.15, -0.02, -0.07], 'l'], [0.62, [0, 0, 0], 'io']],
    pivotR: [[0, [0, 0, 0]], [0.10, [0.35, -0.7, -0.9], 'io'], [0.20, [-0.15, 0.95, 0.6], 'o'], [0.30, [-0.2, 1.05, 0.55], 'l'], [0.62, [0, 0, 0], 'io']],
    lP: [[0, KN.L.p], [0.2, [KN.L.p[0] - 0.02, KN.L.p[1] + 0.03, KN.L.p[2] - 0.02], 'io'], [0.62, KN.L.p, 'io']],
    events: [[0.05, 'swingSnd'], [0.2, 'hit']],
  };
  CLIPS.knifeSlash2 = {            // backhand return slash
    dur: 0.62, hitAt: 0.2, heavy: false,
    pivotP: [[0, [0, 0, 0]], [0.10, [-0.10, 0.0, 0.05], 'io'], [0.20, [0.12, 0.02, -0.10], 'o'], [0.30, [0.14, 0.0, -0.07], 'l'], [0.62, [0, 0, 0], 'io']],
    pivotR: [[0, [0, 0, 0]], [0.10, [0.1, 0.9, 0.5], 'io'], [0.20, [-0.2, -0.75, -0.7], 'o'], [0.30, [-0.25, -0.85, -0.7], 'l'], [0.62, [0, 0, 0], 'io']],
    events: [[0.05, 'swingSnd'], [0.2, 'hit']],
  };
  CLIPS.knifeStab = {
    dur: 1.0, hitAt: 0.42, heavy: true,
    pivotP: [[0, [0, 0, 0]], [0.22, [0.07, 0.07, 0.17], 'io'], [0.40, [-0.10, 0.03, -0.30], 'oo'], [0.55, [-0.10, 0.03, -0.30], 'l'], [1.0, [0, 0, 0], 'io']],
    pivotR: [[0, [0, 0, 0]], [0.22, [0.55, 0.1, 0.1], 'io'], [0.40, [0.0, -0.1, 0.0], 'oo'], [0.55, [0.0, -0.1, 0.0], 'l'], [1.0, [0, 0, 0], 'io']],
    lP: [[0, KN.L.p], [0.4, [KN.L.p[0] + 0.03, KN.L.p[1] + 0.05, KN.L.p[2] - 0.05], 'io'], [1.0, KN.L.p, 'io']],
    events: [[0.2, 'swingSnd'], [0.42, 'hit']],
  };
}

/* ============================================================ CLIP PLAYER */
class ClipPlayer {
  constructor() { this.clip = null; this.t = 0; this.speed = 1; this.fired = 0; this.onEvent = null; this.done = true; this.tmp = [0, 0, 0, 0, 0]; }
  play(clip, speed = 1, onEvent) { this.clip = clip; this.t = 0; this.speed = speed; this.fired = 0; this.onEvent = onEvent; this.done = false; this.events = (clip.events || []).slice().sort((a, b) => a[0] - b[0]); }
  stop() { this.clip = null; this.done = true; }
  update(dt) {
    if (!this.clip) return;
    this.t += dt * this.speed;
    while (this.fired < this.events.length && this.events[this.fired][0] <= this.t) { this.onEvent && this.onEvent(this.events[this.fired][1]); this.fired++; }
    if (this.t >= this.clip.dur) { this.t = this.clip.dur; this.done = true; const c = this.clip; this.clip = null; this.finished = c; }
  }
  get playing() { return !!this.clip; }
}

/* =============================================================== VIEWMODEL */
const Viewmodel = {
  scene: null, camera: null,
  weapon: 'rifle',
  player: new ClipPlayer(),
  // procedural state
  sway: { x: 0, y: 0, vx: 0, vy: 0 },
  kickPos: new THREE.Vector3(), kickVel: new THREE.Vector3(),
  kickRot: new THREE.Vector3(), kickRotVel: new THREE.Vector3(),
  bobT: 0, bobAmt: 0, breathT: 0,
  adsT: 0, sprintT: 0, crouchT: 0, landDip: 0,
  flashT: 0, triggerPull: 0, boltOpen: false, boltCycle: 0, handleOff: 0,
  swapT: 0,
  stance: { hipP: [0.118, -0.150, -0.345], hipR: [0.02, 0.10, 0.0], adsDist: 0.2, spP: [0.085, -0.205, -0.19], spR: [-0.34, 0.78, 0.22] },
  tmpP: [0, 0, 0], tmpR: [0, 0, 0], tmpC: [0, 0, 0, 0, 0],

  init(scene, camera) {
    this.scene = scene; this.camera = camera;
    makeViewmodelMaterials();
    buildClips();
    this.root = new THREE.Group(); scene.add(this.root);

    /* rifle */
    this.rifle = buildRifle();
    this.rifleHolder = new THREE.Group(); this.rifleHolder.add(this.rifle.root);
    this.rifleR = new HandRig(false); this.rifleL = new HandRig(true);
    this.rifleHolder.add(this.rifleR.group, this.rifleL.group);
    this.root.add(this.rifleHolder);
    this.curMag = 0;

    /* knife */
    this.knife = buildKnife();
    this.knifeHolder = new THREE.Group(); this.knifeHolder.add(this.knife.root);
    this.knifeR = new HandRig(false); this.knifeL = new HandRig(true);
    this.knifeHolder.add(this.knifeR.group, this.knifeL.group);
    this.root.add(this.knifeHolder);

    /* arms (camera space) */
    this.armR = new ArmRig(false, new THREE.Vector3(0.20, -0.42, 0.28));
    this.armL = new ArmRig(true, new THREE.Vector3(-0.22, -0.42, 0.26));
    this.armRK = new ArmRig(false, new THREE.Vector3(0.20, -0.45, 0.28));
    this.armLK = new ArmRig(true, new THREE.Vector3(-0.22, -0.45, 0.26));
    for (const a of [this.armR, this.armL, this.armRK, this.armLK]) this.root.add(a.mesh);

    /* muzzle flash (in the weapon scene) */
    this.flash = new THREE.Group();
    const fm = new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: 0xffd9a0 });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm), f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm);
    f2.rotation.y = Math.PI / 2;
    const f3 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), fm); f3.rotation.x = Math.PI / 2; f3.position.z = -0.02;
    this.flash.add(f1, f2);
    this.flashFront = f3;
    this.flash.visible = false;
    this.rifle.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffa860, 0, 3.5, 2);
    this.rifle.muzzle.add(this.flashLight);

    this.setWeapon('rifle', true);
  },

  setWeapon(w, instant) {
    this.weapon = w;
    this.rifleHolder.visible = w === 'rifle';
    this.knifeHolder.visible = w === 'knife';
    this.armR.mesh.visible = this.armL.mesh.visible = w === 'rifle';
    this.armRK.mesh.visible = this.armLK.mesh.visible = w === 'knife';
    this.player.stop();
  },

  /* ------------------------------------------------------------- actions */
  playClip(name, speed, onEvent) {
    const clip = CLIPS[name];
    this._magClip = !!(clip && clip.mag && this.weapon === 'rifle');
    if (this._magClip) { this._old = this.rifle.mags[this.curMag]; this._new = this.rifle.mags[1 - this.curMag]; this._seated = false; this._oldGone = false; }
    this.player.play(clip, speed || 1, (e) => this._handleEvent(e, onEvent));
  },
  /** put the magazines back where the gun expects them (reload finished or cancelled) */
  _finalizeMags() {
    if (!this._magClip) return;
    const mags = this.rifle.mags;
    if (this._seated) this.curMag = 1 - this.curMag;
    mags.forEach((m, i) => { m.visible = i === this.curMag; m.position.copy(RIFLE.magRest); m.rotation.set(0, 0, 0); });
    this._magClip = false;
  },
  cancelClip() { this._finalizeMags(); this.player.stop(); },
  _handleEvent(name, cb) {
    const R = this.rifle;
    switch (name) {
      case 'dropOld': {
        const old = this._old;
        const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
        old.getWorldPosition(wp); old.getWorldQuaternion(wq);
        const cam = G.camera;                                   // weapon scene is camera space -> world
        wp.applyMatrix4(cam.matrixWorld); wq.premultiply(cam.quaternion);
        const vel = new THREE.Vector3(-0.5, 0.3, -0.1).applyQuaternion(cam.quaternion);
        DroppedMags.spawn(this.droppedMesh(old), wp, wq, vel);
        old.visible = false; this._oldGone = true; break;
      }
      case 'stowOld': this._old.visible = false; this._oldGone = true; break;
      case 'showNew': this._new.visible = true; break;
      case 'seatNew': this._seated = true; break;
      case 'boltClose': this.boltOpen = false; break;
    }
    cb && cb(name);
  },
  droppedMesh(mag) {
    if (!this._droppedProto) {
      this._droppedProto = new THREE.Group();
      mag.traverse((o) => { if (o.isMesh) this._droppedProto.add(o.clone()); });
    }
    return this._droppedProto;
  },

  kick(power = 1) {
    this.kickVel.z += 0.55 * power; this.kickVel.y += 0.03 * power;
    this.kickRotVel.x += (1.1 + Math.random() * 0.5) * power;
    this.kickRotVel.y += (Math.random() - 0.5) * 0.55 * power;
    this.kickRotVel.z += (Math.random() - 0.5) * 1.1 * power;
    this.boltCycle = 1;
  },
  muzzleFlash() {
    this.flashT = 0.045;
    const s = 0.75 + Math.random() * 0.7;
    this.flash.scale.set(s, s, s); this.flash.rotation.z = Math.random() * TAU;
    this.flash.visible = true;
  },
  landed(power) { this.landDip = Math.min(1, power); },
  setMagVisible(v) { this.rifle.mags[this.curMag].visible = v; },

  /* ------------------------------------------------------------- per frame */
  update(dt, s) {
    // s: { lookDx, lookDy, speed, grounded, crouch, ads, sprint, strafe, firing }
    const sw = this.sway;
    const clip = this.player.clip;
    this.player.update(dt);
    if (this.player.finished) { this.player.finished = null; this._finalizeMags(); }

    /* stance blending */
    this.adsT = damp(this.adsT, s.ads && !clip ? 1 : 0, 14, dt);
    this.sprintT = damp(this.sprintT, s.sprint && !clip ? 1 : 0, 9, dt);
    this.crouchT = damp(this.crouchT, s.crouch ? 1 : 0, 8, dt);
    this.landDip = damp(this.landDip, 0, 7, dt);
    this.breathT += dt;

    /* mouse sway: spring that lags behind look movement */
    const k = this.weapon === 'rifle' ? 1 : 1.3;
    const adsDamp = 1 - this.adsT * 0.65;
    const tx = clamp(-s.lookDy * 0.012 * k, -0.07, 0.07) * adsDamp, ty = clamp(-s.lookDx * 0.012 * k, -0.07, 0.07) * adsDamp;
    sw.vx += ((tx - sw.x) * 140 - sw.vx * 16) * dt; sw.vy += ((ty - sw.y) * 140 - sw.vy * 16) * dt;
    sw.x += sw.vx * dt; sw.y += sw.vy * dt;

    /* head/weapon bob */
    const moving = s.grounded && s.speed > 0.4;
    this.bobAmt = damp(this.bobAmt, moving ? Math.min(1, s.speed / 6.2) : 0, 8, dt);
    this.bobT += dt * (s.speed > 0.4 ? 5.2 + s.speed * 0.95 : 0);

    /* kick springs */
    const kp = this.kickPos, kv = this.kickVel, kr = this.kickRot, krv = this.kickRotVel;
    kv.addScaledVector(kp, -260 * dt).addScaledVector(kv, -(1 - Math.exp(-17 * dt)));
    kp.addScaledVector(kv, dt);
    krv.addScaledVector(kr, -230 * dt).addScaledVector(krv, -(1 - Math.exp(-15 * dt)));
    kr.addScaledVector(krv, dt);
    this.boltCycle = Math.max(0, this.boltCycle - dt * 12);

    /* clip sample */
    const cp = this.tmpP, cr = this.tmpR, cc = this.tmpC;
    let oP = null, oR = null, lP = null, lR = null, lC = null, handle = null, rFinger = null;
    if (clip) {
      const t = this.player.t;
      oP = sampleTrack(clip.pivotP, t, cp) && cp.slice();
      oR = sampleTrack(clip.pivotR, t, cr) && cr.slice();
      if (clip.lP) { const a = [0, 0, 0]; lP = sampleTrack(clip.lP, t, a) && a; }
      if (clip.lR) { const a = [0, 0, 0]; lR = sampleEulerTrack(clip.lR, t, a) && a; }
      if (clip.lC) { const a = [0, 0, 0, 0, 0]; lC = sampleTrack(clip.lC, t, a) && a; }
      if (clip.handle && clip.handle.length) handle = sampleTrack(clip.handle, t);
      if (clip.rFinger && clip.rFinger.length) rFinger = sampleTrack(clip.rFinger, t);
      if (this.weapon === 'rifle' && clip.mag) this._applyMagTracks(clip, t);
    } else if (this.player.finished) { /* nothing */ }

    if (this.weapon === 'rifle') this._poseRifle(dt, s, { oP, oR, lP, lR, lC, handle, rFinger });
    else this._poseKnife(dt, s, { oP, oR, lP, lR });

    /* muzzle flash decay */
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = 5 * Math.max(0, this.flashT / 0.045);
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }
  },

  /** drive the two magazines from the clip tracks (the left hand is keyed from the same tracks) */
  _applyMagTracks(clip, t) {
    if (!this._magClip) return;
    const a = [0, 0, 0], b = [0, 0, 0];
    const old = this._old, neu = this._new;
    if (!this._oldGone && clip.mag.p.length) {
      sampleTrack(clip.mag.p, t, a); sampleTrack(clip.mag.r, t, b);
      old.position.fromArray(a); old.rotation.set(b[0], b[1], b[2]);
    }
    if (neu.visible && clip.newMag.p.length) {
      sampleTrack(clip.newMag.p, t, a); sampleTrack(clip.newMag.r, t, b);
      neu.position.fromArray(a); neu.rotation.set(b[0], b[1], b[2]);
    }
  },

  _poseRifle(dt, s, c) {
    const adsT = this.adsT, sprintT = this.sprintT;
    const bob = this.bobAmt, bt = this.bobT, bobK = Settings.bobbing;
    const ST = this.stance;
    const hipP = ST.hipP, hipR = ST.hipR;
    const adsP = [0.0, -RIFLE.lensCenter.y, -ST.adsDist], adsR = [0, 0, 0];
    const spP = ST.spP, spR = ST.spR;
    let px = lerp(hipP[0], adsP[0], adsT), py = lerp(hipP[1], adsP[1], adsT), pz = lerp(hipP[2], adsP[2], adsT);
    let rx = lerp(hipR[0], adsR[0], adsT), ry = lerp(hipR[1], adsR[1], adsT), rz = lerp(hipR[2], adsR[2], adsT);
    px = lerp(px, spP[0], sprintT); py = lerp(py, spP[1], sprintT); pz = lerp(pz, spP[2], sprintT);
    rx = lerp(rx, spR[0], sprintT); ry = lerp(ry, spR[1], sprintT); rz = lerp(rz, spR[2], sprintT);
    // crouch tuck
    py += -0.012 * this.crouchT;
    // idle breathing
    const br = Math.sin(this.breathT * 1.5) * (1 - adsT * 0.6);
    py += br * 0.0014; rx += br * 0.0025; px += Math.sin(this.breathT * 0.9) * 0.0008 * (1 - adsT * 0.7);
    // walking bob
    const sprintBob = 1 + sprintT * 0.9;
    const bobScale = bob * bobK * (1 - adsT * 0.82);
    px += Math.sin(bt * 0.5) * 0.0105 * bobScale * sprintBob;
    py += (Math.abs(Math.sin(bt * 0.5)) * -0.0100 + 0.005) * bobScale * sprintBob;
    rz += Math.sin(bt * 0.5) * 0.020 * bobScale * sprintBob;
    ry += Math.cos(bt * 0.5) * 0.012 * bobScale * sprintBob;
    rx += Math.sin(bt) * 0.008 * bobScale * sprintBob;
    // landing + jump
    py -= this.landDip * 0.03; rx += this.landDip * 0.06;
    if (!s.grounded) { py += 0.008; rx -= 0.02; }
    // strafe lean
    rz += -s.strafe * 0.04 * (1 - adsT * 0.7); px += -s.strafe * 0.006;
    // mouse sway
    rx += this.sway.x * 0.9; ry += this.sway.y * 0.9;
    px += this.sway.y * 0.12; py -= this.sway.x * 0.06;
    // recoil
    const ak = 1 - adsT * 0.35;
    px += this.kickPos.x * ak; py += this.kickPos.y * ak; pz += this.kickPos.z * 0.075 * ak;
    rx += this.kickRot.x * 0.075 * ak; ry += this.kickRot.y * 0.075 * ak; rz += this.kickRot.z * 0.075 * ak;
    // clip offsets
    if (c.oP) { px += c.oP[0]; py += c.oP[1]; pz += c.oP[2]; }
    if (c.oR) { rx += c.oR[0]; ry += c.oR[1]; rz += c.oR[2]; }
    // weapon swap handled through draw/holster clips
    this.rifleHolder.position.set(px, py, pz);
    this.rifleHolder.rotation.set(rx, ry, rz, 'YXZ');

    /* charging handle + bolt */
    const off = c.handle !== null && c.handle !== undefined ? c.handle : 0;
    const zBolt = Math.max(this.boltOpen ? 0.045 : 0, off);
    this.rifle.handle.position.z = 0.100 + zBolt;
    this.rifle.carrier.position.z = 0.016 + zBolt + this.boltCycle * 0.03;

    /* hands */
    const rP = POSE.rifle.R, lPz = POSE.rifle.L;
    this.rifleR.group.position.fromArray(rP.p); this.rifleR.group.rotation.set(rP.r[0], rP.r[1], rP.r[2]);
    const trig = c.rFinger !== null && c.rFinger !== undefined ? c.rFinger : this.triggerPull;
    this.rifleR.setCurl([lerp(rP.c[0], rP.c[0] + 0.3, trig), rP.c[1], rP.c[2], rP.c[3], rP.c[4]], rP.abd);
    const lp = c.lP || lPz.p, lr = c.lR || lPz.r, lc = c.lC || lPz.c;
    // sprint: left hand relaxes toward the rifle
    this.rifleL.group.position.fromArray(lp); this.rifleL.group.rotation.set(lr[0], lr[1], lr[2]);
    this.rifleL.setCurl(lc, lPz.abd);

    this._updateArms(this.rifleHolder, this.rifleR, this.rifleL, this.armR, this.armL);
  },

  _poseKnife(dt, s, c) {
    const bob = this.bobAmt, bt = this.bobT, sprintT = this.sprintT, bobK = Settings.bobbing;
    let px = 0.15, py = -0.145, pz = -0.37, rx = 0.30, ry = 0.20, rz = -0.22;
    // sprint: knife held back and low
    px = lerp(px, 0.17, sprintT); py = lerp(py, -0.21, sprintT); pz = lerp(pz, -0.27, sprintT); rx = lerp(rx, 0.55, sprintT); ry = lerp(ry, 0.2, sprintT);
    const br = Math.sin(this.breathT * 1.4);
    py += br * 0.0018; rx += br * 0.004;
    const bobScale = bob * bobK, sprintBob = 1 + sprintT * 0.8;
    px += Math.sin(bt * 0.5) * 0.011 * bobScale * sprintBob;
    py += (Math.abs(Math.sin(bt * 0.5)) * -0.011 + 0.005) * bobScale * sprintBob;
    rz += Math.sin(bt * 0.5) * 0.04 * bobScale * sprintBob;
    rx += Math.sin(bt) * 0.012 * bobScale * sprintBob;
    py -= this.landDip * 0.03;
    if (!s.grounded) py += 0.01;
    rz += -s.strafe * 0.05; px += -s.strafe * 0.01;
    rx += this.sway.x * 1.2; ry += this.sway.y * 1.2; px += this.sway.y * 0.14;
    if (c.oP) { px += c.oP[0]; py += c.oP[1]; pz += c.oP[2]; }
    if (c.oR) { rx += c.oR[0]; ry += c.oR[1]; rz += c.oR[2]; }
    this.knifeHolder.position.set(px, py, pz);
    this.knifeHolder.rotation.set(rx, ry, rz, 'YXZ');
    const rP = POSE.knife.R, lP = POSE.knife.L;
    this.knifeR.group.position.fromArray(rP.p); this.knifeR.group.rotation.set(rP.r[0], rP.r[1], rP.r[2]);
    this.knifeR.setCurl(rP.c, rP.abd);
    const lp = c.lP || lP.p;
    this.knifeL.group.position.fromArray(lp); this.knifeL.group.rotation.set(lP.r[0], lP.r[1], lP.r[2]);
    this.knifeL.setCurl(lP.c, lP.abd);
    this._updateArms(this.knifeHolder, this.knifeR, this.knifeL, this.armRK, this.armLK);
  },

  _updateArms(holder, rHand, lHand, armR, armL) {
    holder.updateMatrixWorld(true);
    const w = _v2; 
    rHand.group.localToWorld(w.set(0, 0, 0.07)); this.root.worldToLocal(w); armR.update(w);
    lHand.group.localToWorld(w.set(0, 0, 0.07)); this.root.worldToLocal(w); armL.update(w);
  },
};
