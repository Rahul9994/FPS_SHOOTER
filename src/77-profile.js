/* =====================================================================
 *  HOLLOW RIDGE  -  77-profile.js
 *  Local player profile (name, Hollow Credits, owned / equipped camos) with
 *  validated, idempotent transactions, plus the single-player reward rules.
 *
 *  Multiplayer rewards are decided by the server (server/room.mjs); the client
 *  only *credits* what the server confirms, and ignores a reward event it has
 *  already applied (keyed by match id + event id).
 * ===================================================================== */

const HC = {
  short: CONFIG.economy.currencyShort,
  fmt(n) { return Math.round(n).toLocaleString('en-US'); },
};

const Profile = {
  KEY: 'hollowRidge.profile.v1',
  data: null,
  _busy: false,

  fresh() {
    return {
      v: 1, pid: 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), name: 'Operator-' + (1000 + Math.floor(Math.random() * 9000)),
      credits: Math.max(0, CONFIG.economy.startingBalance | 0), owned: ['factory'], equipped: 'factory',
      stats: { kills: 0, deaths: 0, matches: 0, wins: 0, earned: 0, spent: 0 }, ledger: [], created: Date.now(),
    };
  },

  /** coerce whatever is in storage into a valid profile (never trust it blindly) */
  sanitize(raw) {
    const d = Object.assign(this.fresh(), raw && typeof raw === 'object' ? raw : {});
    d.credits = Number.isFinite(+d.credits) ? Math.max(0, Math.floor(+d.credits)) : 0;
    d.owned = Array.from(new Set((Array.isArray(d.owned) ? d.owned : []).filter((id) => CAMO_BY_ID[id]).concat('factory')));
    if (!CAMO_BY_ID[d.equipped] || !d.owned.includes(d.equipped)) d.equipped = 'factory';
    d.name = String(d.name || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, 16) || 'Operator-' + (1000 + Math.floor(Math.random() * 9000));
    d.pid = String(d.pid || '').slice(0, 40) || this.fresh().pid;
    d.stats = Object.assign({ kills: 0, deaths: 0, matches: 0, wins: 0, earned: 0, spent: 0 }, d.stats || {});
    for (const k of Object.keys(d.stats)) d.stats[k] = Number.isFinite(+d.stats[k]) ? Math.max(0, Math.floor(+d.stats[k])) : 0;
    d.ledger = (Array.isArray(d.ledger) ? d.ledger : []).map(String).slice(-400);
    return d;
  },

  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { raw = null; }
    this.data = this.sanitize(raw);
    this.persist();
    return this.data;
  },
  persist() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked: stay in memory */ } },

  /** read-modify-write against storage so several tabs / windows cannot overwrite each other's purchases */
  mutate(fn) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { raw = null; }
    const d = raw ? this.sanitize(raw) : this.data;
    const res = fn(d);
    this.data = this.sanitize(d);
    this.persist();
    emit('profile', this.data);
    return res;
  },

  get credits() { return this.data.credits; },
  get name() { return this.data.name; },
  get equipped() { return this.data.equipped; },
  owns(id) { return this.data.owned.includes(id); },

  setName(n) { this.mutate((d) => { d.name = String(n); }); },

  /** add Hollow Credits. `key` makes it idempotent: the same key can never pay out twice. */
  credit(amount, reason, key) {
    amount = Math.floor(amount);
    if (!(amount > 0)) return false;
    return this.mutate((d) => {
      if (key) { if (d.ledger.includes(key)) return false; d.ledger.push(key); if (d.ledger.length > 400) d.ledger.shift(); }
      d.credits += amount; d.stats.earned += amount;
      return true;
    });
  },

  /** validated purchase: never goes negative, never grants twice, never charges for an owned item */
  purchase(id) {
    const def = CAMO_BY_ID[id];
    if (!def) return { ok: false, error: 'Unknown item.' };
    if (this._busy) return { ok: false, error: 'Please wait…', silent: true };         // a click right after a successful purchase (double click) is swallowed
    const price = camoPrice(def);
    const res = this.mutate((d) => {
      if (d.owned.includes(id)) return { ok: false, error: `${def.name} is already in your collection.` };
      if (price > d.credits) return { ok: false, error: `Not enough ${CONFIG.economy.currencyName} — you need ${HC.fmt(price - d.credits)} more ${HC.short}.`, short: price - d.credits };
      d.credits -= price; d.stats.spent += price; d.owned.push(id);
      return { ok: true, price, balance: d.credits };
    });
    if (res.ok) { this._busy = true; setTimeout(() => { this._busy = false; }, 350); }
    return res;
  },

  equip(id) {
    const def = CAMO_BY_ID[id];
    if (!def) return { ok: false, error: 'Unknown item.' };
    return this.mutate((d) => {
      if (!d.owned.includes(id)) return { ok: false, error: `Purchase ${def.name} first.` };
      d.equipped = id; return { ok: true };
    });
  },

  bump(stat, n = 1) { this.mutate((d) => { d.stats[stat] = (d.stats[stat] || 0) + n; }); },
};

/* ------------------------------------------------ single-player rewards */
const Rewards = {
  spStreak: 0,
  /** rewards are paused while any cheat that trivialises the fight is on (no HC farming) */
  allowed() { const c = G.cheats; return !(c.god || c.unlimitedHealth || c.infiniteAmmo || c.noReload || c.noTarget || c.freezeAI); },
  breakdown(streak, head, knife) {
    const R = CONFIG.economy.rewards, parts = [{ why: 'kill', hc: R.kill }];
    if (head && R.headshotBonus) parts.push({ why: 'headshot', hc: R.headshotBonus });
    if (knife && R.knifeBonus) parts.push({ why: 'knife', hc: R.knifeBonus });
    const sb = R.streak[String(streak)]; if (sb) parts.push({ why: 'streak', n: streak, hc: sb });
    return { parts, total: parts.reduce((a, p) => a + p.hc, 0) };
  },
  /** called once per AI soldier that dies to the player in single-player */
  spKill(head, knife) {
    if (!this.allowed()) { emit('notify', { text: 'Cheats active — no Hollow Credits', kind: '' }); return null; }
    this.spStreak++;
    const r = this.breakdown(this.spStreak, head, knife);
    Profile.credit(r.total, 'sp-kill', null);
    Profile.bump('kills');
    return r;
  },
  spDeath() { this.spStreak = 0; Profile.bump('deaths'); },
};
