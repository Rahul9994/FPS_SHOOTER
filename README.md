# HOLLOW RIDGE — tactical FPS with LAN multiplayer

A browser-based first-person shooter built with **Three.js** (WebGL 2). Everything — terrain, grass, trees, weapons,
textures, sky, weather and **all audio** — is generated procedurally. The textures and the terrain are generated once and kept as
files in `assets/` (see [Fast start & offline](#fast-start--offline)), so the game loads from your own disk and **needs no internet at all**.
Version **1.1** adds **real LAN multiplayer**, a **weapon-camo shop with a Hollow Credits economy**, and an
**advanced lighting pass** on top of the original single-player game (which is unchanged).

> **Single player:** double-click `index.html` (Chrome / Edge / Firefox) → **SINGLE PLAYER**.
> **Multiplayer:** see [LAN multiplayer](#lan-multiplayer--host-and-join) (needs Node.js 18+ on the *host* PC only).
> **Laptop with an NVIDIA/AMD GPU?** use `Play-RTX.bat` (single player) or `Host-LAN-Game-RTX.bat` (multiplayer host) to run on the dedicated GPU.

## Controls

| Key | Action |
|---|---|
| **W A S D** · **Shift** · **Space** · **C / Ctrl** | move · sprint · jump · crouch |
| **Mouse** · **LMB** · **RMB** | look · fire / knife slash · aim down sights / heavy stab |
| **R** · **B** · **F** | reload · full-auto ↔ semi-auto · flashlight |
| **1 / 2 / Q / wheel** | rifle / knife / swap |
| **V** | **inspect weapon** (shows off your camo; fire / aim / sprint cancels it) |
| **E** | interact (supply crate on the spawn hill: ammo — and health in single player) |
| **Tab** (hold) | **scoreboard** (multiplayer) |
| **F1** | cheat & environment menu (single player) · graphics & settings (multiplayer) |
| **Esc** | pause / match menu · **F3** FPS counter |

## What is new in 1.1

### 1 · LAN multiplayer (real network play)
* **MULTIPLAYER → HOST GAME / JOIN GAME**. Free-for-all deathmatch for 1–8 *connected human players*.
  **No AI soldiers, no bots, no simulated players exist in multiplayer worlds** — the world contains exactly the
  people who are connected (`__game.MP.stats()` shows `aiSoldiers: 0`). Single player is unchanged and keeps its AI.
* **Host screen**: room name, map, match length (3/5/10/15 min), kill limit (10/20/30/50), max players, optional password;
  shows the host's LAN IPv4 address(es) and port.
* **Join screen**: type the host's IPv4 address + port → **CONNECT** (status: *Connecting… / Connected / Connection failed*
  with specific reasons: server unreachable, timeout, no room hosted, wrong password, room full, removed by host, version mismatch).
  **Scan this network** probes the local /24 subnet(s) for running servers (browsers cannot send UDP broadcasts, so it is an HTTP probe;
  type the first three numbers of your subnet, e.g. `10.22.146.`, into the address box first to scan that subnet first).
* **Lobby**: room, host, map, player list with connection state + ping, host-only settings, **START MATCH**, **LEAVE LOBBY**, host can remove players.
* **In match**: live **player list top-right** (avatar, name, kills, deaths, leader crown, dead marker), match timer, kill feed,
  hold **Tab** for the full scoreboard, 5-second countdown, spawn protection, respawns, results screen with winner,
  per-player kills / deaths / score / credits, and **Return to lobby** / **Leave session**.
* **Authority**: a small Node server (`server/`) owns the match. Clients send what they *did* (position at 20 Hz, "I fired this ray");
  the **server** resolves shots (lag-compensated hit volumes + terrain/prop occlusion — it loads the exact map the host uploads),
  applies damage, decides kills, deaths, respawns, kill streaks and **all Hollow Credit rewards**, and runs the timer and win conditions.
  Rate-limit / movement-budget checks reject rapid-fire and teleport hacks. Reward messages carry unique event ids that clients apply once.
* Disconnects (closed tab, killed process, lost Wi-Fi) are detected; the player vanishes from the world and the list, the match continues.
  If the **host** leaves, the session closes for everyone.

### 2 · Weapon camouflage + shop
* 13 finishes + the factory finish, in 5 rarities: **Military Woodland, Desert Sand, Arctic White, Digital Pixel, Urban Grey, Jungle Green,
  Carbon Fiber, Matte Black, Metallic Silver, Gold Finish, Tactical Hex, Dark Red** and the animated premium **Obsidian Vein**.
* Finishes are painted procedurally into tileable albedo / roughness-metalness / relief textures and applied with a **triplanar, object-space
  PBR shader** — the pattern wraps receiver, handguard, stock, grip and magazines without UV stretching; barrel, bolt, pins, sight lens
  and controls keep their steel / glass materials. Metallic, roughness and bump (carbon weave, hex relief, brushed grain) are real.
  Obsidian Vein animates a thin, slow ember pulse in the shader (not a glow-fest).
* **WEAPON SHOP** (main menu, lobby, results and the in-game pause menu): rarity tabs, cards with preview swatch / name / rarity / price /
  OWNED · EQUIPPED · LOCKED, a live **3D preview** of the real rifle (drag to rotate, wheel to zoom, Studio / Daylight / Dusk / Night lighting),
  balance, **PURCHASE** and **EQUIP**, success and error messages. **Purchases are validated** (unknown item, already owned, not enough credits),
  cannot go negative, cannot be granted twice, and are saved immediately.
* The equipped camo is shown on your first-person rifle, on the shop preview, **and on your rifle in other players' games** (it is sent to
  the server and re-sent live if you change it mid-match).

### 3 · Hollow Credits (HC) economy
Defaults (all in **`game-config.json`** — one file used by both the game and the server):

| Event | Reward |
|---|---:|
| Eliminate an enemy | +100 HC |
| 3 consecutive kills | +150 bonus |
| 5 consecutive kills | +300 bonus |
| Complete a multiplayer match (natural end, ≥ 2 players, ≥ 15 s in the match) | +100 HC |

Camo prices: Common 100 · Uncommon 250 · Rare 500 · Epic 1,000 · Legendary 2,000 (per-item overrides possible). Camos are cosmetic only.
* **Multiplayer**: rewards are computed by the host's server only, once per kill / match (event ids; a repeated message cannot pay twice),
  never for a dead or disconnected victim, streaks reset on death. HUD shows the persistent **bank** and the running **MATCH +N** total.
* **Single player**: AI kills pay the same rewards; rewards pause while cheats that trivialise the fight are on (god mode, infinite ammo…),
  and the cheat-menu "eliminate all" pays nothing.
* Edit `game-config.json`, run `node build.mjs`, restart the server to rebalance.

### 4 · Graphics
* **Ray-marched lighting** (Settings → Graphics, or F1): reflections, ambient occlusion + one bounce of colour, contact shadows and volumetric
  light shafts / forward-scattering fog, in one full-screen pass over the depth buffer. **Honest note:** browsers expose no hardware ray-tracing
  API (no DXR / Vulkan RT) — this is **screen-space ray marching**, not path tracing. It gives wet roads real reflections of trees and sky,
  grounds props and soldiers, and makes sun shafts and fog glow — within what WebGL 2 can do.
  Materials tag themselves in the alpha channel (reflectivity; "skip occlusion" for grass) so only suitable surfaces reflect.
* **Auto / Off / Low / High** + per-effect switches, shadow quality override (Low…Ultra), environment particles (falling leaves), shadow-casting
  flashlight with a visible beam in fog / rain / dark.
* **Fallback path**: unsupported GPUs, integrated GPUs (Auto → Off) or a shader that fails to compile all fall back to the original renderer
  with a notice — the game never depends on it. Adaptive quality reduces the ray-marched level before it lowers the whole quality tier.
* Existing world rendering (PBR terrain, wind-animated grass / trees / bushes, three grass LOD rings, sun shadows, image-based lighting, fog,
  bloom, day / night + weather) is unchanged. Bug fixed on the way: the **flashlight was aimed away from the player** (a shared scratch vector
  was overwritten by the shadow-camera setup) — it now lights what you look at.
* Measured on an **RTX 4050 Laptop GPU** (Edge, 1600×900 window): High tier **164 fps** with RT off / Low / High (display-refresh limited);
  Ultra tier (1.5× render scale, 4× MSAA, 4096 shadows) **136 fps off → 95 fps RT Low → 84 fps RT High**.

## Fast start & offline

Everything the game needs lives in this folder; nothing is downloaded when you play (not even when you double-click `index.html`).

| What | Where | Notes |
|---|---|---|
| 3D engine (three.js r169, MIT) | `vendor/three/three.bundle.js` | one classic script, generated by `build.mjs` (a `file://` page may not `import` modules, which is why this used to come from a CDN) |
| Fonts (Rajdhani, Oswald — SIL OFL) | `assets/fonts/*.woff2` | latin subset, loaded by `@font-face` in `template.html` |
| 28 textures (ground, rock, bark, foliage, props, sprites …) | `assets/textures/*.webp / *.png` + `manifest.json` | baked losslessly from the game's own generators; packed into `assets/textures.pack.js` |
| Terrain (height, splat map, road / trench fields) | `assets/terrain/heightfield.bin` + `meta.json` | baked from the game's own generator; packed into `assets/terrain.pack.js` |

The `*.pack.js` files exist because browsers refuse to hand image *files* (or `fetch`) to a page opened from `file://`; a script that carries the data
works everywhere — double-click, `Play-RTX.bat` and the LAN server alike. If a pack is missing, stale or damaged, the game silently generates that part
itself exactly as before (just slower), so nothing can break.

**Measured here (Edge, RTX 4050 Laptop, SSD, `test/load-bench.mjs`):** page open → main menu: 1.6 s → **1.0 s** when reloaded in the same browser, 2.3 s → **1.9 s**
after restarting the browser, and the very first launch of a browser profile 7.7 s → **3.6 – 5 s** (the browser compiles the game's shaders once and keeps them in its
own shader cache afterwards). Textures: 540 ms → 85 ms; terrain: 240 ms → 12 ms; zero network requests.

**When you change things**
* Edited `src/`, `template.html` or `game-config.json` → `node build.mjs` (it also refreshes the engine bundle and the packs when their inputs changed).
* Edited the texture painters in `src/20-textures.js` → `node tools/bake-textures.mjs`, then `node build.mjs`. Want your own artwork instead? Replace the file in
  `assets/textures/` (same name) and run `node build.mjs` — no painting code involved.
* Edited the terrain code (`src/00-core.js` / `src/10-terrain.js`) or `LAYOUT` → `node tools/bake-terrain.mjs`, then `node build.mjs`. Until you do, the game notices the
  bake is stale (source hash) and generates the terrain itself.
* The LAN server compresses and caches these files (gzip + ETag): a player who opens `http://<host IP>:7777` downloads ≈ 6.7 MB the first time (12.5 MB uncompressed) and only
  `304 Not Modified` replies afterwards. (Players who run their own copy of the folder download nothing.)

### Performance work in this update
* **No more mid-game shader hitches.** three.js compiles a shader the first time something is drawn; the first shot, reload, jump or knife switch used to freeze the game for
  40–420 ms (14 shaders). The loading screen now compiles for the render target the game really uses and draws warm-up frames for the rifle, muzzle flash, knife and a dropped
  magazine. A scripted 45 s session (`test/hitches.mjs`): worst frame **418 ms → 12 ms**, frames over 20 ms **6 → 0**, shaders compiled during play **14 → 0**.
* **Frame-rate limit** (F1 → *Settings* → *Frame rate limit*: Display / 120 / 90 / 60 / 30; default *Display*, i.e. unchanged). At High on the RTX 4050 laptop GPU (165 Hz screen):
  Display 96 % GPU load · 88 W · 75 °C → **90 fps 61 % · 62 W · 71 °C → 60 fps 39 % · 45 W · 68 °C → 30 fps 36 % · 21 W · 61 °C**.
* **Grass draws only what the camera can see.** Each grass layer is a camera-following grid; the vertex shader now runs only for the block of the grid inside the view frustum
  (32–100 % of the instances, pixel-identical output — `test/grass-window.mjs` compares 11 camera poses), and the cheap rejection tests run before the terrain / noise look-ups.
* Per-pass GPU timings (`test/gpu-timing.mjs`, hardware timer queries), at High with ray-marched lighting off: grass 35 %, terrain 19 %, trees / props / sky 21 %, shadow map 7 %, bloom 7 %.

## LAN multiplayer — host and join

**Requirements:** the *host* PC needs [Node.js 18+](https://nodejs.org) (no `npm install`, no dependencies, no internet). Joiners need only a browser.

**Host (PC 1)**
1. Double-click **`Host-LAN-Game.bat`** (or `Host-LAN-Game-RTX.bat` for the dedicated GPU, or `node server/index.mjs [--port 7777]`).
   A console window prints the host's addresses, e.g. `10.22.146.244  port 7777`. The game opens at `http://localhost:7777`.
2. **MULTIPLAYER → HOST GAME →** choose map & rules → **CREATE LOBBY**. The lobby shows the IP:port to give to the others (with a copy button).
3. Wait for players, press **START MATCH**.

**Join (PC 2, PC 3, …) — on the same Wi-Fi / LAN**
* Either open your own copy of the game (`index.html` / `Play-RTX.bat`) → **MULTIPLAYER → JOIN GAME**, enter the host's IP + port → **CONNECT**,
* or just open `http://<host IP>:7777` in a browser (the page is served by the host; three.js is bundled, so no internet is needed).

**Firewall / network**
* The first time the server starts, Windows asks whether Node.js may accept connections: choose **Private networks → Allow**.
  Or run **`Open-Firewall-Port.bat`** once as Administrator (adds one inbound TCP 7777 rule for the Private profile).
* The Wi-Fi network must be classified **Private** (Windows Settings → Network → Wi-Fi → network profile type), otherwise inbound connections are blocked.
* Some routers enable "client / AP isolation" (guest Wi-Fi) which blocks device-to-device traffic — turn it off or use another network.
* Port: TCP **7777** (change with `--port`). Only the PC running the server can host (the server refuses `HOST` requests from other machines).
* **Your profile (credits, owned camos, name) is stored in the browser, per address**: `index.html`, `http://localhost:7777` and `http://10.x.x.x:7777`
  are three different stores. Use the same way of opening the game each time, or move a profile with **Backup / Restore** on the main menu.

## Project layout

```
index.html            <- built, self-contained game (open this; `node build.mjs` regenerates it)
template.html         <- HTML/CSS shell (fonts, script tags)
build.mjs             <- bundles src/*.js + game-config.json into template.html -> index.html, refreshes the engine bundle + texture / terrain packs   (--check: syntax check)
assets/               <- fonts, baked textures, baked terrain (+ the generated *.pack.js files), see "Fast start & offline"
tools/                <- bundle-three.mjs (engine bundler, used by build.mjs) · bake-textures.mjs · bake-terrain.mjs
game-config.json      <- economy, weapon numbers, match rules, maps, spawn points (shared by client and server)
server/               <- LAN server (Node 18+, zero dependencies)
  index.mjs             HTTP (static files, /api/info) + WebSocket endpoint, CLI
  ws.mjs                minimal RFC 6455 WebSocket server
  room.mjs              authoritative session: lobby, match state machine, hit resolution, kills, rewards, results
  world.mjs             server copy of the heightfield + colliders + player hit volumes (uploaded by the host's game)
vendor/three/         <- three.js r169 (MIT) + the few addons the game uses; three.bundle.js (generated) is what the page loads
src/
  00-core.js … 75-weapons.js   original engine: math, terrain, textures, sky/weather, world, props, effects, audio, weapons
  76-camos.js          camo catalogue, procedural textures, triplanar PBR material patch
  77-profile.js        local profile (credits, owned, equipped), validated purchases, single-player rewards
  78-net.js            WebSocket client, clock sync, world export, LAN scan
  79-mp.js             multiplayer client: session state, remote players, interpolation, shots / kills / rewards, HUD lists
  80-player.js … 90-ui.js      original: controller, enemies + combat, HUD, cheat menu, pause menu, loading screen (extended)
  91-menus.js          main / multiplayer / host / join / lobby / results screens
  92-shop.js           weapon shop + 3D preview
  93-gfx.js            ray-marched lighting pass, shadow overrides, flashlight beam/shadows, falling leaves
  99-main.js           renderer + post-processing, game flow (menu / single player / multiplayer), game loop
test/                 <- see "Testing"
Host-LAN-Game.bat · Host-LAN-Game-RTX.bat · Open-Firewall-Port.bat · Play-RTX.bat · Play-local-server.bat
```
After editing anything in `src/`, `template.html` or `game-config.json`, run **`node build.mjs`**. `window.__game` exposes the systems for console testing.
`Play-local-server.bat` (python static server) still works for single player, but cannot host multiplayer — use `Host-LAN-Game.bat`.

### Network protocol (JSON over WebSocket, `/ws`)
`hello → welcome | reject`, host: `create {settings, world}`; `lobby`, `match {countdown|playing|ended|lobby}`, `spawn`, `snap` (20 Hz, only changed players),
`st` (client state, 20 Hz), `fire`/`melee` → `shot`, `hit`, `hc` (hit confirm), `kill {eid}`, `rew {eid, mid, hc}`, `score`, `end`, `leave`, `camo`, `corr`, `ammo`, `ping/pong` (clock sync).
Remote players are rendered ~110 ms in the past from buffered snapshots; the server rewinds targets by the same amount when it resolves a shot.

## Testing — what was actually run

All run on this PC (Windows 11, RTX 4050 Laptop + Intel UHD, Edge / Node 24). **No second physical PC was available**, so "separate PCs" were
three separate browser instances with their own profiles loading the game from three different addresses (`localhost`, `127.0.0.1`, and the PC's
Wi-Fi address) and connecting over TCP through the Wi-Fi interface address — the same code path a real LAN uses, but not a cross-device test.
Firewall behaviour for other devices could not be verified here.

| Script | Result |
|---|---|
| `node test/mp-protocol.test.mjs` — real server + real WebSocket clients: lobby rules, version / password / full-room rejects, host-only controls, hit damage + headshots, wall occlusion, kill registered once, +100 / +250 / +400 streak rewards, rapid-fire & teleport rejection, disconnects, kill-limit end, completion bonus once and not farmable, host leaving | **42 / 42 pass** |
| `node test/mp-three-clients.mjs` — three GPU-rendered game instances: host + two joiners (Tests A, B, C, D, F, G), autopilot combat, scoreboards and profile balances compared with the server, remote positions vs server, camo seen by others, killing one client's process, results screen + completion bonus, return-to-lobby and a second match | **38 / 38 pass** |
| `node test/sp-regression.mjs` — single player on the real GPU: movement, jump, crouch, fire, reload, inspect, fire-mode, knife, AI shooting / damage / death / respawn, rewards, F1, pause menu, shop from pause, no console / GL errors (Test H) | **28 / 28 pass** |
| `node test/shop-persist.mjs` — earn → purchase (double-click safe, unaffordable error) → equip → restart the page → state persisted (Test E) | **9 / 9 pass** |
| `node test/perf-cdp.mjs` — fps with ray-marched lighting off / low / high at High and Ultra tiers (Test I) | numbers above |
| `node test/load-bench.mjs [url] --runs 3` — time from navigation to main menu, every boot step, network requests | numbers in "Fast start & offline" |
| `node test/tex-parity.mjs` · `node test/terrain-parity.mjs` — baked textures / terrain vs the generators (settings + hash of every pixel / byte) | **29 / 29 textures and 4 / 4 terrain arrays identical** |
| `node test/grass-window.mjs` — grass frustum window vs the full grid, 11 camera poses, pixel diff | **identical** (one warm-up frame differs by 1/255 on 14 px) |
| `node test/hitches.mjs [--trace]` — scripted play session: frame-time hitches, GC pressure, shaders compiled during play · `node test/hitches-events.mjs` — the same around first death / respawn / kill / menus | worst frame 12 ms (one-off 67 ms the first time F1 builds its menu) |
| `node test/gpu-timing.mjs` · `test/cpu-profile.mjs` · `test/scene-stats.mjs` · `test/ab-perf.mjs` — per-pass GPU time, main-thread time, triangle breakdown, A/B frame cost | profiling tools |
| `node test/gfx-shots.mjs` | screenshots of flashlight, wet-road reflections, sun shafts; shader-failure fallback checked by corrupting the shader at run time |
| client-vs-server world parity (debug endpoint): 2,500 random rays inside the map → 0 hit/miss mismatches; terrain heights within 5 mm | verified |

`npm test` / `npm run test:lan` etc. are defined in `package.json`. The autopilot used by the end-to-end test (`test/autopilot.mjs`) and the protocol
bot (`test/bot.mjs`) are **test tooling only** and are not part of the game; the debug endpoints in the server only exist with `--debug`.

## Known limitations / honest notes
* **Not hardware ray tracing** (impossible in browsers today) — screen-space ray marching only. Reflections can only show what is on screen.
* **One map**: the hillside battlefield. "Maps" in the host screen are environment presets of the same terrain (noon, golden hour, rain, fog, night).
* **Account currency is local**: the bank lives in the player's browser storage, so a player can edit their own profile (just like in single
  player). The server decides what is *earned* in a match (never trusting a client's claim) and what each client is told, but it cannot secure a local file.
* Movement is client-authoritative with server plausibility checks (speed budget, bounds, terrain height); there is no server-side collision with props.
  Fall damage is disabled in multiplayer, health regenerates on the server, and the supply crate refills ammo only.
* LAN discovery is an HTTP subnet probe (cannot use UDP broadcast in a browser); it scans the common private /24 ranges plus the subnet you type.
* Players join mid-match as late joiners. Reconnecting after a drop means joining again (a fresh character, same profile).
* The 3D models are still procedural placeholders (primitives), as before; all sounds are synthesised.
* three.js was switched from r170 (CDN) to the r169 copy bundled in `vendor/` so the file:// page and the offline LAN page run identical code; the game was re-tested on r169.
* The first launch in a fresh browser profile still takes a few seconds longer (3.6 – 5 s): the browser compiles ~60 shaders once and caches them on disk. Updating the
  graphics driver or the browser clears that cache, so one slow start can happen again.
* Keeping files on the SSD cannot make the GPU draw less — per-frame GPU work is the same whatever the files came from. What lowers GPU load is drawing less (frame-rate
  limit, quality tier, ray-marched lighting) — and loading from disk instead of generating / downloading shortens the start-up, which is what the packs do.
* Browsers only allow audio and mouse capture after a click — click the window once when a multiplayer match starts if the mouse is not captured.
