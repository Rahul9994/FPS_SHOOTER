/* =====================================================================
 *  HOLLOW RIDGE  -  91-menus.js
 *  Main menu, multiplayer menu, host / join screens, lobby, match results.
 *  (The weapon shop lives in 92-shop.js.) All screens are DOM panels in
 *  #menuRoot, shown over the live 3D hillside (menu) or the game (results).
 * ===================================================================== */

const Menus = {
  current: '', screens: {}, hostBusy: false, joinBusy: false, scanToken: 0, lastInfo: null,

  init() {
    this.root = $('menuRoot');
    const sc = (id, cls, html) => { const d = document.createElement('div'); d.id = id; d.className = 'screen ' + cls; d.innerHTML = html; this.root.appendChild(d); this.screens[id] = d; return d; };
    this.buildMain(sc); this.buildMulti(sc); this.buildHost(sc); this.buildJoin(sc); this.buildLobby(sc); this.buildResults(sc);
    Shop.init(this.root);
    // any click in the menus counts as the user gesture the browser needs for audio
    this.root.addEventListener('pointerdown', () => Audio3D.resume(), { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    on('profile', () => { this.refreshProfile(); });
    on('mp:welcome', (m) => { if (!m.inProgress) this.show('lobby'); });
    on('mp:lobby', () => { if (this.current === 'lobby') this.renderLobby(); });
    on('mp:end', (m) => this.showResults(m));
    on('mp:disconnected', (d) => { this.show('multi'); this.notice(d.reason); });
    on('mp:error', (m) => { this.hostBusy = false; this.setHostStatus('err', 'Server refused: ' + m.msg); this.setHostBusy(false); });
    on('mp:phase', (m) => { if (m.phase === 'lobby' && this.current === 'lobby') this.renderLobby(); });
    this.refreshProfile();
  },

  /* --------------------------------------------------------- navigation */
  show(name) {
    this.current = name;
    for (const [id, el] of Object.entries(this.screens)) el.classList.toggle('on', id === 'sc' + name[0].toUpperCase() + name.slice(1));
    const el = this.screens['sc' + name[0].toUpperCase() + name.slice(1)];
    if (!el) return;
    // results appear over the running match; every other screen sits on the menu backdrop
    G.uiOpen = G.state !== 'menu';
    if (G.state !== 'menu') Game.updatePause();
    if (name === 'main') this.refreshProfile();
    if (name === 'host') this.enterHost();
    if (name === 'join') this.enterJoin();
    if (name === 'lobby') this.renderLobby();
    if (name === 'multi') this.refreshMulti();
    Shop.root.classList.remove('on');
  },
  hideAll() {
    this.current = '';
    for (const el of Object.values(this.screens)) el.classList.remove('on');
    Shop.root.classList.remove('on'); G.uiOpen = false;
    this.scanToken++;
  },
  openMain() { G.uiOpen = false; this.show('main'); },
  onKey(e) {
    if (this.current !== 'main' || Shop.isOpen || CheatMenu.open_) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const btns = Array.from(this.screens.scMain.querySelectorAll('.mmBtn')), i = btns.indexOf(document.activeElement);
    if (e.code === 'ArrowDown') { btns[(i + 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
    else if (e.code === 'ArrowUp') { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
  },
  notice(msg) {
    const el = this.screens.scMulti.querySelector('.notice');
    el.innerHTML = msg ? `<div class="errBox">${esc(msg)}</div>` : '';
  },

  /* ---------------------------------------------------------- main menu */
  buildMain(sc) {
    const d = sc('scMain', 'mainScreen', `
      <div class="mmBrand"><div class="k">TACTICAL COMBAT</div><div class="t">HOLLOW<br><b>RIDGE</b></div><div class="s">OPERATION · SECTOR D · HILLSIDE FRONT</div></div>
      <div class="mmList">
        <button class="mmBtn primary" data-act="sp">Single player<small>Hold the hill against AI soldiers</small></button>
        <button class="mmBtn" data-act="mp">Multiplayer<small>Real players over your Wi-Fi · host or join</small></button>
        <button class="mmBtn" data-act="shop">Weapon shop<small>Camouflage · spend Hollow Credits</small><span class="badge" id="mmHcBadge"></span></button>
        <button class="mmBtn" data-act="settings">Graphics &amp; settings<small>Ray-marched lighting · quality · controls</small></button>
      </div>
      <div class="profChip"><div class="sw" id="pcSwatch"></div><div><div class="nm"><input id="pcName" maxlength="16" spellcheck="false" title="Your player name"></div><div class="hcv"><span id="pcHc">0</span><small>HC</small></div><div class="eq" id="pcEq"></div><div class="eq" style="margin-top:4px"><a href="#" data-act="backup" title="Copy your profile (credits, owned camos, name) so you can restore it in another browser / address">Backup</a> · <a href="#" data-act="restore" title="Paste a profile backup">Restore</a></div></div></div>
      <div class="mmFoot"><div><b>WASD</b> move · <b>LMB</b> fire · <b>RMB</b> aim · <b>R</b> reload · <b>V</b> inspect · <b>TAB</b> scoreboard (multiplayer)</div><div>v${CONFIG.version} · protocol ${CONFIG.protocol}</div></div>`);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.tagName === 'A') e.preventDefault();
      switch (b.dataset.act) {
        case 'backup': { const txt = JSON.stringify(Profile.data); try { navigator.clipboard.writeText(txt); } catch (er) { /* ignore */ } window.prompt('Your profile backup (copied to the clipboard if the browser allowed it). Your profile lives in this browser / address only — paste this into RESTORE on another one.', txt); break; }
        case 'restore': { const t = window.prompt('Paste a profile backup:'); if (!t) break; try { const raw = JSON.parse(t); if (!raw || typeof raw !== 'object') throw new Error('not a profile'); Profile.mutate((d) => { const n = Profile.sanitize(raw); Object.assign(d, n); }); Camo.applyToObject(Viewmodel.rifle.root, Profile.equipped); toast('Profile restored', 2200); } catch (er) { toast('That does not look like a profile backup', 2800); } break; }
        case 'sp': Game.startSP(); break;
        case 'mp': this.show('multi'); break;
        case 'shop': Shop.open({ from: 'main' }); break;
        case 'settings': CheatMenu.setTab(CheatMenu.tabs.findIndex((t) => t.name === 'Graphics')); CheatMenu.open(); break;
      }
    });
    const inp = d.querySelector('#pcName');
    inp.addEventListener('change', () => { Profile.setName(inp.value); inp.value = Profile.name; });
    inp.addEventListener('keydown', (e) => { if (e.code === 'Enter') inp.blur(); });
  },
  refreshProfile() {
    if (!Profile.data) return;
    const d = this.screens.scMain; if (!d) return;
    const inp = d.querySelector('#pcName'); if (document.activeElement !== inp) inp.value = Profile.name;
    d.querySelector('#pcHc').textContent = HC.fmt(Profile.credits);
    d.querySelector('#mmHcBadge').textContent = HC.fmt(Profile.credits) + ' ' + HC.short;
    const def = Camo.def(Profile.equipped);
    d.querySelector('#pcSwatch').style.backgroundImage = `url(${Camo.swatch(def.id, 108)})`;
    d.querySelector('#pcEq').textContent = 'Equipped: ' + def.name;
  },

  /* ---------------------------------------------------- multiplayer menu */
  buildMulti(sc) {
    const d = sc('scMulti', 'pScreen menuDim', `
      <div class="mpPanel narrow">
        <div class="mpHead"><h2>MULTI<b>PLAYER</b></h2><div class="tag">Local network · real players only</div></div>
        <div class="mpBody">
          <div class="notice"></div>
          <div class="choiceRow" style="margin-top:6px">
            <button class="choice" data-act="host"><h3>HOST GAME</h3><p>Start a session on this PC. Pick the map and match rules, then let other players on your Wi-Fi connect to your IP address.</p></button>
            <button class="choice" data-act="join"><h3>JOIN GAME</h3><p>Connect to a host on the same Wi-Fi. Enter its IP address and port, or scan the network for open games.</p></button>
          </div>
          <div class="infoBox"><b>No bots.</b> A multiplayer match contains only the players who are actually connected — no AI soldiers, no simulated players. Hosting needs the Hollow Ridge server on the host PC (<code>Host-LAN-Game.bat</code>, Node.js 18+); joining only needs this page.</div>
        </div>
        <div class="mpFoot"><button class="btn ghost" data-act="back">‹ Back</button><div></div></div>
      </div>`);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.dataset.act === 'host') this.show('host'); else if (b.dataset.act === 'join') this.show('join'); else if (b.dataset.act === 'back') { if (MP.active) MP.leave(); this.openMain(); }
    });
  },
  refreshMulti() { if (!this.screens.scMulti.querySelector('.errBox')) this.notice(''); },

  /* ------------------------------------------------------- host screen */
  buildHost(sc) {
    const M = CONFIG.match, maps = CONFIG.maps;
    const opts = (arr, cur, fmt) => arr.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    const saved = (() => { try { return JSON.parse(localStorage.getItem('hollowRidge.hostCfg') || '{}'); } catch (e) { return {}; } })();
    this.hostCfg = Object.assign({ room: '', map: maps[0].id, duration: M.defaults.duration, killLimit: M.defaults.killLimit, maxPlayers: M.defaults.maxPlayers, pass: '' }, saved);
    const d = sc('scHost', 'pScreen menuDim', `
      <div class="mpPanel">
        <div class="mpHead"><h2>HOST <b>GAME</b></h2><div class="tag">Free-for-all deathmatch</div></div>
        <div class="mpBody">
          <div class="statusLine busy" id="hostStatus"><i></i><span>Looking for the local server…</span></div>
          <div id="hostProblem"></div>
          <div id="hostAddrs"></div>
          <div class="formGrid" style="margin-top:16px">
            <div class="field"><label>Room name</label><input id="hRoom" maxlength="28" spellcheck="false" placeholder="e.g. Friday night frag"></div>
            <div class="field"><label>Map</label><select id="hMap">${maps.map((m) => `<option value="${m.id}"${m.id === this.hostCfg.map ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Match length</label><select id="hDur">${opts(M.durationOptions, this.hostCfg.duration, (v) => v + ' minutes')}</select></div>
            <div class="field"><label>Kill limit</label><select id="hLim">${opts(M.killLimitOptions, this.hostCfg.killLimit, (v) => 'First to ' + v + ' kills')}</select></div>
            <div class="field"><label>Max players</label><select id="hMax">${opts(Array.from({ length: M.maxPlayers }, (_, i) => i + 1), this.hostCfg.maxPlayers, (v) => v + (v === 1 ? ' player' : ' players'))}</select></div>
            <div class="field"><label>Password (optional)</label><input id="hPass" maxlength="24" spellcheck="false" autocomplete="off" placeholder="leave empty for an open room"></div>
          </div>
          <div class="infoBox">Every connected player spawns on the same battlefield. Damage, kills, respawns and Hollow Credit rewards are decided by the server on this PC, so every player sees the same result. Respawn delay ${M.respawnDelay}s · spawn protection ${M.spawnProtection}s.</div>
        </div>
        <div class="mpFoot"><button class="btn ghost" data-act="back">‹ Back</button><button class="btn big green" data-act="create" id="hostCreate" disabled>Create lobby ›</button></div>
      </div>`);
    d.querySelector('#hRoom').value = this.hostCfg.room || (Profile.name + "'s game");
    d.querySelector('#hRoom').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    d.querySelector('#hPass').value = this.hostCfg.pass || '';
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.dataset.act === 'back') { this.show('multi'); }
      else if (b.dataset.act === 'create') this.createLobby();
      else if (b.dataset.act === 'retry') this.enterHost();
    });
  },
  setHostStatus(kind, text) { const el = $('hostStatus'); el.className = 'statusLine ' + kind; el.querySelector('span').textContent = text; },
  setHostBusy(v) { this.hostBusy = v; $('hostCreate').disabled = v || !this.hostInfo; },
  hostTarget() { const ps = Net.pageServer(), port = ps && ps.port ? ps.port : CONFIG.net.defaultPort; return { host: '127.0.0.1', port }; },
  async enterHost() {
    this.hostInfo = null; $('hostCreate').disabled = true; $('hostProblem').innerHTML = ''; $('hostAddrs').innerHTML = '';
    { const rf = $('hRoom'); if (!rf.dataset.touched && !this.hostCfg.room) rf.value = Profile.name + "'s game"; }
    this.setHostStatus('busy', 'Looking for the local server…');
    const t = this.hostTarget();
    const info = await LanScan.probe(t.host, t.port, 1500);
    if (this.current !== 'host') return;
    if (!info) {
      this.setHostStatus('err', 'Local server not running');
      $('hostProblem').innerHTML = `<div class="errBox"><b>The Hollow Ridge server is not running on this PC.</b><br>A browser game cannot open a network port by itself, so hosting needs the small server program that ships with the game:<br>
        1&nbsp; Install <b>Node.js 18 or newer</b> (nodejs.org) if you have not already.<br>2&nbsp; Double-click <code>Host-LAN-Game.bat</code> in the game folder (or run <code>node server/index.mjs</code>).<br>3&nbsp; Open <code>http://localhost:${t.port}</code> in your browser and press <b>MULTIPLAYER → HOST GAME</b> again — or click RETRY below.<br><br><button class="btn" data-act="retry">Retry</button></div>`;
      return;
    }
    if (info.proto !== CONFIG.protocol) { this.setHostStatus('err', 'Server version mismatch'); $('hostProblem').innerHTML = `<div class="errBox">The server speaks protocol ${info.proto}, this page speaks ${CONFIG.protocol}. Rebuild the game (<code>node build.mjs</code>) and restart the server.</div>`; return; }
    if (info.room) { this.setHostStatus('err', 'A game is already being hosted'); $('hostProblem').innerHTML = `<div class="errBox">This server already hosts <b>${esc(info.room.name)}</b> (${info.room.players}/${info.room.max}). Stop the server (Ctrl+C) and start it again to host a new game, or join that game.</div>`; return; }
    this.hostInfo = info;
    this.setHostStatus('ok', `Server ready · v${info.version} · port ${info.port}`);
    const addrs = (info.addresses || []);
    $('hostAddrs').innerHTML = addrs.length
      ? `<div class="infoBox" style="margin-top:12px"><b>Other players on this Wi-Fi join with:</b></div><div class="addrList">${addrs.map((a) => `<div class="addr${a.virtual ? ' virt' : ''}"><span>${esc(a.address)} <span style="color:var(--dim);font-weight:500">: ${info.port}</span></span><small>${esc(a.name)}${a.virtual ? ' · virtual adapter' : ''}</small></div>`).join('')}</div>`
      : `<div class="errBox">No LAN network adapter was found. Connect this PC to Wi-Fi or Ethernet so other players can reach you (you can still host a solo / same-PC session).</div>`;
    $('hostCreate').disabled = this.hostBusy;
  },
  async createLobby() {
    if (this.hostBusy || !this.hostInfo) return;
    const val = (id) => $(id).value;
    this.hostCfg = { room: val('hRoom').trim() || (Profile.name + "'s game"), map: val('hMap'), duration: +val('hDur'), killLimit: +val('hLim'), maxPlayers: +val('hMax'), pass: val('hPass') };
    try { localStorage.setItem('hollowRidge.hostCfg', JSON.stringify(this.hostCfg)); } catch (e) { /* ignore */ }
    this.setHostBusy(true); this.setHostStatus('busy', 'Creating lobby…');
    try {
      const t = this.hostTarget();
      await MP.connect({ host: t.host, port: t.port, role: 'host', pass: '' });
      const ok = MP.createRoom({ room: this.hostCfg.room, pass: this.hostCfg.pass, map: this.hostCfg.map, settings: { duration: this.hostCfg.duration, killLimit: this.hostCfg.killLimit, maxPlayers: this.hostCfg.maxPlayers } });
      if (!ok) throw { msg: 'Lost the connection to the local server.' };
      this.hostAddrs = this.hostInfo.addresses; this.hostPort = this.hostInfo.port;
      setTimeout(() => this.setHostBusy(false), 800);
    } catch (e) {
      this.setHostStatus('err', 'Could not create the lobby'); $('hostProblem').innerHTML = `<div class="errBox">${esc((e && e.msg) || String(e))}</div>`;
      this.setHostBusy(false); MP.cleanup(false); Net.close(true);
    }
  },

  /* ------------------------------------------------------- join screen */
  buildJoin(sc) {
    const d = sc('scJoin', 'pScreen menuDim', `
      <div class="mpPanel narrow" style="width:min(720px,96vw)">
        <div class="mpHead"><h2>JOIN <b>GAME</b></h2><div class="tag">Same Wi-Fi / LAN</div></div>
        <div class="mpBody">
          <div class="formGrid">
            <div class="field wide"><label>Host IPv4 address</label><input id="jIp" maxlength="64" spellcheck="false" autocomplete="off" placeholder="e.g. 192.168.1.23" inputmode="decimal"><div class="hint">Shown on the host's screen (HOST GAME / lobby) and in the server window.</div></div>
            <div class="field"><label>Port</label><input id="jPort" maxlength="5" spellcheck="false" inputmode="numeric"></div>
            <div class="field"><label>Room password</label><input id="jPass" maxlength="24" spellcheck="false" autocomplete="off" placeholder="if the host set one"></div>
          </div>
          <div class="statusLine" id="joinStatus"><i></i><span>Not connected</span></div>
          <div id="joinProblem"></div>
          <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn ghost" data-act="scan" id="jScan">Scan this network</button><span id="scanInfo" style="font-size:13px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase"></span></div>
          <div id="foundList"></div>
        </div>
        <div class="mpFoot"><button class="btn ghost" data-act="back">‹ Back</button><button class="btn big green" data-act="connect" id="jConnect">Connect ›</button></div>
      </div>`);
    d.addEventListener('click', (e) => {
      const f = e.target.closest('[data-found]'); if (f) { $('jIp').value = f.dataset.host; $('jPort').value = f.dataset.port; Audio3D.uiClick(); this.connect(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.dataset.act === 'back') this.show('multi'); else if (b.dataset.act === 'connect') this.connect(); else if (b.dataset.act === 'scan') this.scan();
    });
    d.addEventListener('keydown', (e) => { if (e.code === 'Enter' && e.target.tagName === 'INPUT') this.connect(); });
  },
  setJoinStatus(kind, text) { const el = $('joinStatus'); el.className = 'statusLine ' + kind; el.querySelector('span').textContent = text; },
  enterJoin() {
    const ps = Net.pageServer(), last = (() => { try { return localStorage.getItem('hollowRidge.lastHost') || ''; } catch (e) { return ''; } })();
    const ip = $('jIp'); if (!ip.value) ip.value = ps && /^\d+\.\d+\.\d+\.\d+$/.test(ps.host) && ps.host !== '127.0.0.1' ? ps.host : last;
    const pt = $('jPort'); if (!pt.value) pt.value = ps && ps.port ? ps.port : CONFIG.net.defaultPort;
    this.setJoinStatus('', 'Not connected'); $('joinProblem').innerHTML = ''; this.joinBusy = false; $('jConnect').disabled = false;
  },
  async connect() {
    if (this.joinBusy) return;
    const host = $('jIp').value.trim(), port = parseInt($('jPort').value, 10), pass = $('jPass').value;
    $('joinProblem').innerHTML = '';
    if (!host || !/^[A-Za-z0-9.\-]+$/.test(host)) { this.setJoinStatus('err', 'Connection failed'); $('joinProblem').innerHTML = '<div class="errBox">Enter the host\'s IPv4 address, for example <b>192.168.1.23</b>.</div>'; return; }
    if (!(port > 0 && port < 65536)) { this.setJoinStatus('err', 'Connection failed'); $('joinProblem').innerHTML = '<div class="errBox">The port must be a number between 1 and 65535 (default is ' + CONFIG.net.defaultPort + ').</div>'; return; }
    this.joinBusy = true; $('jConnect').disabled = true;
    this.setJoinStatus('busy', `Connecting to ${host}:${port}…`);
    try {
      await MP.connect({ host, port, role: 'join', pass });
      this.setJoinStatus('ok', 'Connected');
      this.joinAddr = { host, port };
    } catch (e) {
      const code = (e && e.code) || 'ERR';
      this.setJoinStatus('err', 'Connection failed');
      const friendly = { NO_ROOM: 'Server reachable — but nobody is hosting a game yet. Ask the host to press HOST GAME → CREATE LOBBY.', BAD_PASSWORD: 'Wrong room password.', ROOM_FULL: 'The room is full.', KICKED: 'The host removed you from this session.', VERSION_MISMATCH: e && e.msg };
      $('joinProblem').innerHTML = `<div class="errBox"><b>${esc(code.replace(/_/g, ' '))}</b><br>${esc(friendly[code] || (e && e.msg) || String(e))}</div>`;
      MP.cleanup(false); Net.close(true);
    }
    this.joinBusy = false; $('jConnect').disabled = false;
  },
  async scan() {
    const token = ++this.scanToken, port = parseInt($('jPort').value, 10) || CONFIG.net.defaultPort, list = $('foundList'), info = $('scanInfo');
    list.innerHTML = ''; info.textContent = 'Scanning…'; $('jScan').disabled = true; let n = 0;
    await LanScan.scan(port, (f) => {
      n++;
      const r = f.info.room;
      list.insertAdjacentHTML('beforeend', `<div class="found" data-found="1" data-host="${esc(f.host)}" data-port="${f.port}" style="cursor:pointer"><div>${esc(f.host)}:${f.port}<small>${r ? `${esc(r.name)} · ${esc(r.host)} · ${r.players}/${r.max} players · ${esc(r.map)}${r.hasPass ? ' · 🔒' : ''}` : 'server running — no game hosted yet'}</small></div><button class="btn" style="padding:5px 16px">${r ? 'Join' : 'Pick'}</button></div>`);
    }, (done, total) => { if (token === this.scanToken) info.textContent = `Scanning… ${Math.round(done / total * 100)}%`; }, () => token !== this.scanToken || this.current !== 'join', $('jIp').value);
    if (token === this.scanToken) info.textContent = n ? `${n} server${n === 1 ? '' : 's'} found` : 'No servers found — check the IP / firewall';
    $('jScan').disabled = false;
  },

  /* ------------------------------------------------------------- lobby */
  buildLobby(sc) {
    const M = CONFIG.match;
    const d = sc('scLobby', 'pScreen menuDim', `
      <div class="mpPanel">
        <div class="mpHead"><h2 id="lbTitle">LOBBY</h2><div class="tag" id="lbTag"></div></div>
        <div class="mpBody">
          <div class="lobbyGrid">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><span style="font-size:12px;letter-spacing:.28em;color:var(--accent2)">CONNECTED PLAYERS</span><span id="lbCount" style="font-size:18px;letter-spacing:.1em"></span></div>
              <div class="plist" id="lbPlayers"></div>
            </div>
            <div>
              <table class="sumTable" id="lbInfo"></table>
              <div class="formGrid" id="lbHostCtl" style="grid-template-columns:1fr;margin-top:12px;gap:10px">
                <div class="field"><label>Map</label><select id="lMap">${CONFIG.maps.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
                <div class="field"><label>Match length</label><select id="lDur">${M.durationOptions.map((v) => `<option value="${v}">${v} minutes</option>`).join('')}</select></div>
                <div class="field"><label>Kill limit</label><select id="lLim">${M.killLimitOptions.map((v) => `<option value="${v}">First to ${v}</option>`).join('')}</select></div>
              </div>
              <div id="lbAddr"></div>
              <div class="infoBox" id="lbFw" style="font-size:12.5px"></div>
            </div>
          </div>
        </div>
        <div class="mpFoot"><div style="display:flex;gap:10px"><button class="btn danger" data-act="leave">Leave lobby</button><button class="btn ghost" data-act="shop">Weapon shop</button></div><div style="display:flex;gap:12px;align-items:center"><span id="lbNote" style="font-size:13px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase"></span><button class="btn big green" data-act="start" id="lbStart">Start match ›</button></div></div>
      </div>`);
    d.addEventListener('click', (e) => {
      const k = e.target.closest('[data-kick]'); if (k) { Net.send({ t: 'kick', id: +k.dataset.kick }); return; }
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.dataset.act === 'leave') { MP.leave(); this.show('multi'); }
      else if (b.dataset.act === 'shop') Shop.open({ from: 'lobby' });
      else if (b.dataset.act === 'start') Net.send({ t: 'start' });
      else if (b.dataset.act === 'copy') { const t = b.dataset.text; try { navigator.clipboard.writeText(t); } catch (er) { /* ignore */ } b.textContent = 'Copied'; }
    });
    const sendSettings = () => { if (!MP.room || MP.room.hostId !== (MP.me && MP.me.id)) return; Net.send({ t: 'settings', map: $('lMap').value, settings: { duration: +$('lDur').value, killLimit: +$('lLim').value } }); };
    for (const id of ['lMap', 'lDur', 'lLim']) d.querySelector('#' + id).addEventListener('change', sendSettings);
  },
  renderLobby() {
    const r = MP.room; if (!r) return;
    const me = MP.me ? MP.me.id : 0, isHost = r.hostId === me;
    $('lbTitle').innerHTML = esc(r.room).toUpperCase();
    $('lbTag').textContent = `Hosted by ${r.host} · ${r.mapName}`;
    $('lbCount').textContent = `${r.players.length} / ${r.max}`;
    $('lbPlayers').innerHTML = r.players.map((p) =>
      `<div class="prow${p.id === me ? ' me' : ''}"><i class="av" style="background:${playerColor(p.id)}">${esc(p.name.charAt(0).toUpperCase())}</i><span>${esc(p.name)}${p.host ? '<span class="tagh">HOST</span>' : ''}${p.id === me ? ' <small style="color:var(--dim);letter-spacing:.2em;font-size:11px">YOU</small>' : ''}${isHost && p.id !== me ? `<button class="kick" data-kick="${p.id}">REMOVE</button>` : ''}</span><span class="st">CONNECTED</span><span class="pg">${p.id === me ? Math.round(Net.rtt) : p.ping} ms</span></div>`).join('');
    const mp = CONFIG.maps.find((m) => m.id === r.map) || CONFIG.maps[0];
    $('lbInfo').innerHTML = `<tr><td>Room</td><td>${esc(r.room)}${r.hasPass ? ' 🔒' : ''}</td></tr><tr><td>Host</td><td>${esc(r.host)}</td></tr><tr><td>Map</td><td>${esc(r.mapName)}</td></tr><tr><td>Mode</td><td>Free-for-all deathmatch</td></tr><tr><td>Rules</td><td>${r.settings.duration} min · first to ${r.settings.killLimit}</td></tr><tr><td>Status</td><td>${{ lobby: 'Waiting in lobby', countdown: 'Match starting', playing: 'Match in progress', ended: 'Showing results' }[r.state] || r.state}</td></tr>`;
    const ctl = $('lbHostCtl'); ctl.style.display = isHost ? '' : 'none';
    if (isHost) { for (const [id, v] of [['lMap', r.map], ['lDur', r.settings.duration], ['lLim', r.settings.killLimit]]) { const el = $(id); if (document.activeElement !== el) el.value = String(v); } }
    const start = $('lbStart'); start.style.display = isHost ? '' : 'none'; start.disabled = r.state !== 'lobby';
    $('lbNote').textContent = isHost ? (r.state === 'lobby' ? (r.players.length === 1 ? 'You are alone — the match will contain only you' : '') : 'Wait for the current match to finish') : (r.state === 'lobby' ? 'Waiting for the host to start…' : 'Match in progress — you join the next one');
    // how others reach this game
    const addrs = isHost ? (this.hostAddrs || []) : [];
    $('lbAddr').innerHTML = isHost && addrs.length ? `<div class="infoBox" style="margin-top:12px"><b>Others join at:</b></div><div class="addrList">${addrs.filter((a) => !a.virtual).slice(0, 3).map((a) => `<div class="addr"><span>${esc(a.address)}<span style="color:var(--dim);font-weight:500"> : ${this.hostPort}</span></span><button class="btn" style="padding:3px 12px;font-size:11px" data-act="copy" data-text="${esc(a.address + ':' + this.hostPort)}">Copy</button></div>`).join('')}</div>` : (!isHost && this.joinAddr ? `<div class="infoBox" style="margin-top:12px">Connected to <b>${esc(this.joinAddr.host)}:${this.joinAddr.port}</b></div>` : '');
    $('lbFw').innerHTML = isHost ? 'If other PCs cannot connect: allow <b>Node.js</b> through Windows Defender Firewall for <b>Private</b> networks (or run <code>Open-Firewall-Port.bat</code> as Administrator) and make sure the Wi-Fi network is set to <b>Private</b>.' : 'Tip: <b>V</b> inspects your weapon in-game, <b>TAB</b> shows the scoreboard. Your equipped camo is visible to every other player.';
  },

  /* ------------------------------------------------------------ results */
  buildResults(sc) {
    const d = sc('scResults', 'pScreen menuDim', `
      <div class="mpPanel">
        <div class="mpHead"><h2>MATCH <b>RESULTS</b></h2><div class="tag" id="rsTag"></div></div>
        <div class="mpBody">
          <div class="resHero" id="rsHero"></div>
          <table class="res"><thead><tr><th>#</th><th>PLAYER</th><th>KILLS</th><th>DEATHS</th><th>K/D</th><th>SCORE</th><th>HC EARNED</th></tr></thead><tbody id="rsRows"></tbody></table>
          <div class="rewardBox" id="rsReward"></div>
        </div>
        <div class="mpFoot"><button class="btn danger" data-act="leave">Leave session</button><div style="display:flex;gap:10px"><button class="btn ghost" data-act="shop">Weapon shop</button><button class="btn big green" data-act="lobby">Return to lobby ›</button></div></div>
      </div>`);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; Audio3D.uiClick();
      if (b.dataset.act === 'leave') { MP.leave(); this.openMain(); }
      else if (b.dataset.act === 'lobby') { Game.exitToMenu({ keepSession: true }); }
      else if (b.dataset.act === 'shop') Shop.open({ from: 'results' });
    });
  },
  showResults(m) {
    const me = MP.me ? MP.me.id : 0, won = m.winners.includes(me), results = m.results;
    const names = m.winners.map((id) => (results.find((r) => r.id === id) || {}).name).filter(Boolean);
    $('rsTag').textContent = `${MP.room ? MP.room.mapName : ''} · ${{ killLimit: 'kill limit reached', time: 'time expired', host: 'ended by host', empty: 'no players left' }[m.reason] || m.reason}`;
    $('rsHero').className = 'resHero' + (won ? ' victory' : '');
    $('rsHero').innerHTML = names.length ? `<div class="w">${won ? 'VICTORY' : '<b>' + esc(names.join(' & ')) + '</b>'}</div><div class="sub">${won ? 'You won the match' : (names.length > 1 ? 'Winners' : 'Winner')}</div>` : '<div class="w">DRAW</div><div class="sub">Nobody scored</div>';
    $('rsRows').innerHTML = results.map((r, i) => `<tr class="${r.id === me ? 'me' : ''}${m.winners.includes(r.id) ? ' win' : ''}"><td>${i + 1}</td><td class="nm"><i class="av" style="background:${playerColor(r.id)}">${esc(r.name.charAt(0).toUpperCase())}</i>${m.winners.includes(r.id) ? '♛ ' : ''}${esc(r.name)}</td><td>${r.k}</td><td>${r.d}</td><td>${r.d ? (r.k / r.d).toFixed(2) : r.k.toFixed(2)}</td><td>${HC.fmt(r.sc)}</td><td class="rw">+${HC.fmt(r.hc)}${r.comp ? ` <small style="color:var(--dim)">(${r.comp} match bonus)</small>` : ''}</td></tr>`).join('');
    const mine = results.find((r) => r.id === me) || { hc: 0, comp: 0, k: 0, d: 0, best: 0 };
    $('rsReward').innerHTML = `<div class="rb"><small>Match rewards</small><b>+${HC.fmt(mine.hc)} ${HC.short}</b></div><div class="rb"><small>Match completion</small><b>${mine.comp ? '+' + mine.comp : '—'}</b></div><div class="rb"><small>Best streak</small><b>${mine.best || 0}</b></div><div class="rb"><small>Account balance</small><b>${HC.fmt(Profile.credits)} ${HC.short}</b></div>`;
    this.show('results');
    Audio3D.pickup();
  },
};
