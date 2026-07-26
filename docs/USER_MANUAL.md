# Crystal Ball — Operator Manual

A task-oriented guide to operating Crystal Ball. The [README](../README.md) describes
*what* every feature is; this manual covers *how to actually use it* — step by step,
for a technical operator who is comfortable with a terminal, API keys, and Claude Code.

> **Scope.** This is the day-to-day operator's manual. For internals (service graphs,
> event bus, storage schemas) see [`docs/reasoning-layer.md`](reasoning-layer.md) and the
> linked design docs. For the full key list see [`docs/API_KEYS.md`](API_KEYS.md).

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [The Interface](#2-the-interface)
3. [Working with Panels](#3-working-with-panels)
4. [The 2D Map & Basemaps](#4-the-2d-map--basemaps)
5. [God's Vision — the 3D Globe](#5-gods-vision--the-3d-globe)
6. [Ghost Mode](#6-ghost-mode)
7. [Alerts & Notifications](#7-alerts--notifications)
8. [Watchlists & Saved Places](#8-watchlists--saved-places)
9. [The Analyst HUD](#9-the-analyst-hud)
10. [Settings & API Keys](#10-settings--api-keys)
11. [Claude Code & the MCP Server](#11-claude-code--the-mcp-server)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Getting Started

### Choose how you run it

| You want… | Do this |
|---|---|
| The full native app (recommended) | Download the latest macOS build from [Releases](https://github.com/bradleybond512/crystal-ball/releases/latest) |
| Zero-install, in a browser | Open the [web version](https://bradleybond512.github.io/crystal-ball/) |
| To build/run from source | Clone the repo and use the dev commands below |

**Desktop vs. web — the operative differences:**

- **Desktop** stores API keys in the macOS Keychain, runs a local Node.js sidecar
  (port `46123`) that proxies all feeds, and exposes the **MCP server** to Claude Code.
- **Web** has no keychain and no sidecar, so it cannot host the MCP server. Keys you
  enter live in a passphrase-encrypted in-browser vault (see [§10](#10-settings--api-keys)).
  Most panels still work; some that need a server-side proxy degrade gracefully.

### Run from source

```bash
npm ci
npm run dev                 # web, full variant (default)
npm run dev:tech            # tech variant
npm run dev:finance         # finance variant
npm run desktop:dev         # Tauri desktop shell, with devtools
npm run desktop:build:full  # production desktop build
```

Install a desktop build you just made:

```bash
node scripts/install-built-app.mjs --relaunch
```

This copies `src-tauri/target/release/bundle/macos/Crystal Ball.app` to
`~/Applications/Crystal Ball.app`. Always install from that path — never from a
secondary clone.

### Variants

Crystal Ball ships four product variants from one codebase. The variant is chosen at
**build time** (not switchable at runtime):

| Variant | Focus | Build |
|---|---|---|
| `full` | Geopolitics, conflict, cyber, infrastructure, disasters, markets | `npm run desktop:build:full` |
| `tech` | AI, startups, cloud, service health, dev ecosystems | `npm run desktop:build:tech` |
| `finance` | Markets, forex, bonds, commodities, crypto, central banks | `npm run desktop:build:finance` |
| `happy` | Positive news, progress, science, conservation | `SITE_VARIANT=happy npm run dev` |

### Your first 60 seconds

1. **Launch.** The 2D map loads with the default panel set for your variant.
2. **Press `Cmd+K`** to open the command palette — the fastest way to reach anything
   (jump to a panel, toggle a layer, run an action) without hunting through the UI.
3. **Press `G`** to drop into God's Vision, the 3D globe. Press `Esc` to come back.
4. **Press `Cmd+,`** to open Settings. Add an API key or two (see [§10](#10-settings--api-keys))
   to light up feeds that need credentials. Everything else works without keys.
5. **Press `Cmd+Shift+A`** to open the Analyst HUD — the cross-domain reasoning layer
   that ranks what matters right now.

---

## 2. The Interface

The desktop chrome (`body.is-desktop-macos`) is active in the Tauri build and in any
desktop browser with a fine pointer at ≥768px width. Touch phones get a mobile layout.

| Region | What it is |
|---|---|
| **Sidebar** | Panel categories and navigation. Toggle with `` Cmd+\ ``. |
| **Toolbar** | App title (drag region), Ghost Mode toggle, settings gear, status. |
| **Panel grid** | The main work area where panels render. |
| **Map** | A MapLibre 2D map underlies the grid; God's Vision (`G`) is the 3D mode. |
| **Notification stack** | A fixed column (top) that owns staleness, offline, and triage banners. They flow in priority order — no single banner covers another. |
| **Command palette** | `Cmd+K` — keyboard-first navigation over every command, panel, and toggle. |

Window dragging is wired through the title bar (Tauri intercepts the mousedown — the
CSS `-webkit-app-region: drag` trick does not work in WKWebView, so that's expected).

---

## 3. Working with Panels

Panels are the modular cards that render each data domain. The full variant groups
them into categories (situational awareness, conflict & military, cyber & threats,
financial, weather & disasters, space, infrastructure, maritime, aviation, energy,
health, and more).

### Choose which panels appear

1. Open **Settings** (`Cmd+,` or the gear icon).
2. Go to the **Panels** tab.
3. Toggle panels on/off. The grid updates live.

### Summarize a panel with AI

Every panel has a **sparkle (summarize) button**. Click it to get an AI summary of that
panel's current data. The model is resolved at runtime through a fallback chain:

```
Ollama (local)  →  Groq (fast cloud)  →  Claude (Anthropic)  →  OpenRouter (100+ models)
```

With only Ollama installed it runs fully offline — no data leaves the machine. Each hop
is an explicit boundary; if one tier has no key or is unreachable, it falls to the next.

### Find a panel fast

Press `Cmd+K` and type the panel name. The command palette jumps you straight there —
faster than scrolling the sidebar, especially in the full variant.

---

## 4. The 2D Map & Basemaps

### Switch the basemap

The map supports four basemaps, selected with the basemap switcher (persisted to the
`wm-basemap` localStorage key):

| Basemap | Source |
|---|---|
| **Dark** | Self-hosted CARTO raster tiles |
| **Light** | Self-hosted CARTO raster tiles |
| **Satellite** | NASA GIBS Blue Marble |
| **Terrain** | OpenTopoMap |

If a persisted basemap value ever goes stale, the map validates it on load and falls
back to a valid style rather than getting stuck.

### Overlay layers

The map carries 50+ toggleable overlays — conflicts, infrastructure, flights, vessels,
earthquakes, fires, weather radar, grid status, submarine cables, satellites, and more.
Toggle them from the layer controls. (The 3D globe has its own, larger layer set — see
[§5](#5-gods-vision--the-3d-globe).)

---

## 5. God's Vision — the 3D Globe

Press **`G`** (or use the sidebar) to enter the full-viewport Cesium 3D globe. `Esc` exits.

### Layers

**75 geospatial layers** — military bases, nuclear facilities, earthquakes, active
conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats, submarine
cables, ports, satellites, ISS, weather radar, lightning, GPS jamming, trade routes, the
day/night terminator, and more. 31 are on by default; toggle the rest from the layer bar.

### Read the HUD

The overlay shows: UTC clock, threat-level assessment (NOMINAL → CRITICAL), camera
altitude and coordinates, sun phase (DAY/GOLDEN/CIVIL/NAUTICAL/ASTRO/NIGHT), local time
at the camera's longitude, the nearest hotspot with haversine distance, a scrolling alert
ticker, and the top-5 active alerts.

### Fly Mode

Press **`F`** to fly. Five submodes:

| Submode | Controls |
|---|---|
| **Free fly** | `WASD` + mouse |
| **Cinema** | Smooth auto-orbit |
| **Autopilot** | Waypoint tour |
| **Targeted** | Fly to a selected entity |
| **Chase** | Track a moving target |

Right-click-drag to look, scroll to change speed, `C` toggles cockpit view.

### Navigate to places

- **Theater presets:** press `1`–`6` to fly to Middle East, Pacific, Europe, Arctic,
  Africa, or Americas.
- **Camera bookmarks:** `Cmd+1`–`5` *save* the current viewpoint to a slot. Pressing the
  unmodified `1`–`5` then *recalls* that saved bookmark; if a slot has no bookmark, the
  key falls through to its theater preset.
- **Waypoints:** `W` drops a waypoint; `Shift+W` starts a tour through them.
- **Turn-by-turn navigation:** press `N`. A 4-tier routing engine
  (OSRM → GraphHopper → Valhalla → straight-line) draws a route with an ETA in the Nav HUD.

### Time Machine

Scrub historical data across a configurable window. **`Space`** plays/pauses.

### Satellites & 3D buildings

- **Satellites:** SGP4 orbital propagation runs in a Web Worker for ISS, Starlink, and
  weather satellites. TLE data comes from CelesTrak — no API key needed.
- **3D buildings:** a 5-tier fallback (Google Photorealistic Tiles → Cesium OSM Buildings
  → 2D extrusions → flat terrain). Photorealistic requires `GOOGLE_MAPS_API_KEY`.

### Spatial audio

Procedural Web Audio responds to what's on screen — sub-bass drone during conflict,
teletype clicks during market activity, sonar pings for map events, geiger ticks on the
radiation layer. Every layer is independently toggleable, with a master mute and a
spatial volume slider (0–100%).

> **Note:** God's Vision relies on Cesium, which compiles GLSL shaders at runtime — this
> is why the app's CSP includes `'unsafe-eval'`. If the globe ever shows a blank canvas,
> see [Troubleshooting](#13-troubleshooting).

---

## 6. Ghost Mode

Ghost Mode is the app's privacy-and-low-footprint posture. **Press `Cmd+Shift+G`** to
toggle it (also available from the sidebar). When active:

- **Polling intervals multiply by 5×** — far less network chatter. Note this *reduces*
  traffic, it does not stop it; the app is not offline. To go truly quiet, also quit it.
- **Analytics are suppressed** — PostHog goes silent.
- **Notifications go silent.**
- **The sidebar switches to dark crimson chrome** so the mode is unmistakable.

Use it when you want to monitor without being monitored. Toggle it off the same way.

---

## 7. Alerts & Notifications

Crystal Ball funnels every alert source — NWS, GDACS, OREF (Israel sirens), ACLED,
ThreatFox, CISA KEV, power grid, cyber, breaking news, and internal correlation
signals — into one unified inbox.

> **Opening any of these views.** The Alert Inbox, Alert Trace, and Alert Rules are all
> panels. Open one by pressing `Cmd+K` and typing its name, or enable it in
> Settings → **Panels** so it stays in the grid. The Alert Inbox is enabled by default.

### Triage the inbox

Alerts are scored by `severity × proximity × freshness × novelty × source_trust`, so the
highest-relevance items rise to the top. Inbox shortcuts:

| Key | Action |
|---|---|
| `J` / `K` | Move down / up |
| `A` | Acknowledge |
| `P` | Pin |

You can also snooze, annotate, and bookmark. A snooze **re-escalates** if the situation
worsens, so muting something low isn't a silent drop.

### Situations (auto-clustering)

Related alerts cluster automatically by geography (<100 km), time (<6 hr), and category.
A hurricane making landfall produces **one situation card**, not 15 separate items.

### Geofencing

Set watched locations (home, office, family) in Settings → **Places** (see
[§8](#8-watchlists--saved-places) for the exact add-a-place steps). Alerts near a saved
place are promoted automatically.

### Custom rules

Define your own triggers as condition/action pairs, or start from a built-in preset
(earthquake watcher, storm chaser, conflict monitor). Manage them in the **Alert Rules**
panel (open it with `Cmd+K`), or from Claude Code with `/watchlist` and the
`alert_rules_manage` MCP tool.

### "Why didn't I get warned?" (Alert Trace)

The **Alert Trace** view walks an alert through the full delivery pipeline so you can see
exactly where it was promoted or dropped:

```
source-receipt → normalization → relevance-scoring → quiet-hours → threshold-check → delivery
```

For weather specifically, the diagnostics engine traces 7 stages
(NWS receipt → sidecar → normalize → polygon match → router → quiet hours → relevance)
and gives a per-stage verdict plus a remediation hint.

### Delivery channels

Native desktop notifications, voice alerts, iMessage/SMS command workflows, a digest
view, and notification history. Operator controls include mute and shift-handoff.
History persists in IndexedDB for 30 days — searchable, filterable, exportable.

---

## 8. Watchlists & Saved Places

### Saved / watched places

Add the locations you care about in Settings → **Places**:

1. Open Settings (`Cmd+,`) → **Places**.
2. Enter a **City / State / Country** (it's geocoded to coordinates for you), **or** type
   an explicit **Latitude / Longitude** directly.
3. Give it a **Label** (optional) and save.

Saved places drive:

- **Geofenced alert promotion** (see [§7](#7-alerts--notifications)).
- **Personal Storm Mode** — when severe weather's polygon matches a saved place, Storm
  Mode produces a card with the main threat, an arrival-window estimate (computed from
  storm motion and bearing), and a time-budget-aware action checklist.
- **Personal-impact scoring** — events are mapped to your places, watchlist, portfolio,
  travel routes, and utility dependencies.

### Watchlists

Track specific entities — IPs, tickers, regions, CVEs, vessels, callsigns. Edit the
watchlist with `Cmd+Shift+W`, or manage it from Claude Code:

```
/watchlist                       # interactive management
watchlist_manage / watchlist_check   # MCP tools
```

Watchlist matches feed the Analyst HUD as hypotheses ([§9](#9-the-analyst-hud)) and can
fire alerts ([§7](#7-alerts--notifications)).

---

## 9. The Analyst HUD

Press **`Cmd+Shift+A`**. A persistent reasoning loop fuses the situation engine, anomaly
detection, unified alerts, threat synthesis, and your watchlist into one ranked list of
cross-domain hypotheses.

### What you see

- **Hypotheses** — ranked by `risk × confidence × feedback × outcome-accuracy`. Each has
  clickable evidence chips, a thread badge (e.g. `4c up` = seen across 4 cycles and
  strengthening), and color-coded entity chips (countries, tickers, CVEs, callsigns).
- **Posture advisories** — per-domain pressure (finance / security / disaster / cyber)
  with rolling sparklines and ETA-to-threshold projections.
- **Hot entities** — entities appearing in 2+ concurrent hypotheses.

### What you can do

| Action | How |
|---|---|
| Move the selection | `↑` / `↓` |
| Expand the 24/48h projection | `Enter` (or "simulate ▸") |
| Expand the ensemble | `Shift+Enter` (or "perspectives ▾") — runs analyst / skeptic / pragmatist personas in parallel |
| Vote a hypothesis useful / not | `+` / `−` chips — the ranking learns from your votes over time |
| Ask an investigative question | Click one of the 3 question chips; the answer caches inline |
| Export a thread | `Cmd+Shift+H`, or the HUD's copy action — full markdown (statement + evidence + skeptic + Q&A + playbook + projection) for shift handoff |

- **Auto-briefs** (opt-in) — on a critical-pressure crossover, the HUD generates a
  focused 24h brief.
- **Playbooks** — the HUD learns what you do after each hypothesis and surfaces
  "Last time: opened situation-awareness, voted useful (3×)" when it recurs.
- **Replay scrubber** — slide back through 120 archived snapshots, anchored by timestamp.

### LLM routing and the daily budget

All generation routes through `/api/intel-generate` (Ollama / LM Studio → Groq) before
falling back to the cloud Claude agent — this is the HUD's own local-first route, separate
from the per-panel summarize chain in [§3](#3-working-with-panels). The HUD footer shows
your **daily cloud-call cap**. Open the HUD's settings (gear in the HUD header, or `Cmd+,` while the HUD is open)
to raise/lower the cap or toggle auto-brief and the skeptic pass.

### Diagnostics overlay (`Cmd+Shift+D`)

Press `Cmd+Shift+D` for the reasoning diagnostics overlay — four tabs:

- **Events** — 200-entry ring buffer, filterable by level (info/warn/error) and category.
  Copy-as-JSON or clear.
- **Metrics** — per-op latency (count / p50 / p95 / p99 / mean / last) plus named counters.
- **State** — live shape of every reasoning store (hypothesis count, archive sizes,
  thread/entity counts, accuracy samples, relevance weights, LLM budget) and a
  localStorage-footprint table.
- **Boot** — bootstrap trace with per-service start latency.

The HUD footer shows a live error counter (red when > 0). Errors are mirrored to the
sidecar within ~2s and are readable from Claude Code via `get_reasoning_debug_log` and
`get_reasoning_metrics`. From the DevTools console, `window.cbReasoningDebug.dump()` and
`window.cbReasoningMetrics.snapshot()` also work.

---

## 10. Settings & API Keys

Open Settings with `Cmd+,` or the gear icon. Tabs: **General · Panels · Sources ·
API Keys · Thresholds · Places · Status · Help** (plus a Debug tab).

### Where keys live

- **Desktop:** keys are stored in the macOS **Keychain** (service `crystal-ball`). The
  renderer never sees them — they're injected into the Node.js sidecar at startup and
  proxied over a bearer-authenticated localhost port. The first launch after a rebuild may
  re-prompt for Keychain access; grant **Always Allow** or feeds that need keys stay dark.
- **Web:** there is no keychain, so keys go into a passphrase-encrypted IndexedDB vault
  (AES-GCM-256 over PBKDF2-SHA-256, 600k iterations). If the tab has been hidden for 15+
  minutes, the vault **locks itself when you return to it** — unlock again with your
  passphrase. **There is no recovery** — a lost passphrase means Destroy and re-enter.

### Add a key

1. Settings → **API Keys**.
2. Paste the key next to the provider. Keys use the standard provider env-var names
   (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, …).
3. For supported providers (Anthropic, Groq, OpenRouter, Cesium Ion, Mapbox, MapTiler),
   the app runs a live verification probe and shows the result; others show "Saved."

**Keys are optional.** Most panels degrade gracefully without them. Add keys to unlock
the feeds and AI tiers you want. The full list with signup links and free/paid notes is
in [`docs/API_KEYS.md`](API_KEYS.md).

> **Never** have the app touch the Keychain outside this flow. The sanctioned backup
> tooling is `npm run backup-keys` / `npm run restore-keys`, run by you, on purpose.

### Other tabs at a glance

- **Sources** — enable/disable individual data feeds.
- **Thresholds** — tune alert thresholds.
- **Places** — saved/watched locations (drives geofencing and Storm Mode, [§8](#8-watchlists--saved-places)).
- **Status** — feed health and service status.
- **Help** — in-app pointers.

---

## 11. Claude Code & the MCP Server

The desktop app ships an **MCP server** that gives Claude Code direct access to every
feed and the in-app reasoning state. 41 tools register automatically when you open a
Claude Code session in this repo.

**Prerequisites:** Crystal Ball (desktop) must be running — the MCP server discovers the
sidecar's port and bearer token from local files on disk (the token file is written
mode `0o600`). Sentinel history and watchlists live in `~/.crystal-ball/`. (The web build
has no sidecar, so no MCP.)

### Discover what's available

```
help()                         # full tool index
help({ tool: "correlate" })    # man page for one tool
help({ topic: "getting-started" })
help({ examples: "cross-domain" })
```

### Tool categories

| Category | Tools |
|---|---|
| **Aggregate** | `get_sitrep`, `get_threat_landscape`, `get_market_overview`, `get_cyber_intel`, `get_weather_environment`, `get_infrastructure_status`, `get_military_posture` |
| **Granular** | `search_conflicts`, `search_news`, `lookup_ip`, `lookup_cve`, `lookup_vessel`, `lookup_flight`, `get_sanctions`, `get_economic_data`, `get_sec_filings`, `get_earthquakes`, `get_disease_outbreaks`, `get_region_brief` |
| **Foundation** | `query_raw`, `chain_query` (use `$prev[N]` references), `compare_snapshots` |
| **Intelligence** | `correlate`, `trend`, `anomaly_scan` |
| **Stateful** | `watchlist_manage` / `watchlist_check`, `alert_rules_manage` / `alert_check` |
| **Analyst** | `get_analyst_hypotheses`, `get_mode_forecast`, `get_analyst_accuracy`, `get_hot_entities` (read); `submit_hypothesis_feedback`, `dismiss_hypothesis`, `run_skeptic_now` (write-back, drained by the renderer every ~10s) |
| **Diagnostic** | `check_feed_health`, `sitrep_bundle`, `get_reasoning_debug_log`, `get_reasoning_metrics` |

### Slash commands

Built on top of the MCP tools:

| Command | What it does |
|---|---|
| `/sitrep` | Full-spectrum daily intelligence brief — parallel collection, triage/enrichment, analyst-voice synthesis. Personalized to your home location, platforms, and watchlist tickers. |
| `/sentinel` | Autonomous sweep: gather sitrep, diff vs. last snapshot, check watchlists + rules, write alerts. Built for scheduled 30-min runs. |
| `/correlate` | Interactive cross-domain correlation with trend context and follow-ups. |
| `/watchlist` | Manage watchlists and alert rules from the CLI. |
| `/alerts` | Check current alerts, clear history, filter by severity. |
| `/watch <place>` | Regional brief for any location (e.g. `/watch Strait of Hormuz`). |
| `/threat-brief` | Top 5 threats with trajectory and recommended watches. |
| `/market-pulse` | Markets snapshot with yield curve and Fed balance sheet. |

---

## 12. Keyboard Shortcuts

### Global

| Shortcut | Action |
|---|---|
| `Cmd+K` | Command palette |
| `G` | Toggle God's Vision (3D globe) |
| `Cmd+Shift+A` | Toggle Analyst HUD |
| `Cmd+Shift+D` | Toggle Reasoning Diagnostics overlay |
| `Cmd+Shift+G` | Toggle Ghost Mode |
| `Cmd+Shift+H` | Export current briefing to clipboard |
| `Cmd+Shift+S` | Toggle Status overlay |
| `Cmd+Shift+T` | Toggle Today view |
| `Cmd+Shift+W` | Toggle Watchlist editor (desktop only — browsers reserve this chord) |
| `Cmd+S` | Copy shareable URL |
| `Cmd+,` | Settings (or Analyst HUD settings if the HUD is open) |
| `` Cmd+\ `` | Toggle sidebar |
| `Esc` | Exit any open overlay or Fly Mode |

### Alerts inbox

| Shortcut | Action |
|---|---|
| `J` / `K` | Navigate down / up |
| `A` | Acknowledge |
| `P` | Pin |

### God's Vision

| Shortcut | Action |
|---|---|
| `F` | Enter Fly Mode |
| `N` | Toggle Navigation |
| `Space` | Play/pause Time Machine |
| `C` | Toggle cockpit view (in Fly Mode) |
| `L` | Toggle day/night terminator |
| `1`–`6` | Fly to theater preset (slots `1`–`5` recall a saved bookmark if one exists) |
| `Cmd+1`–`5` | Save camera bookmark to a slot |
| `W` / `Shift+W` | Drop waypoint / start tour |

### Analyst HUD

| Shortcut | Action |
|---|---|
| `↑` / `↓` | Select hypothesis |
| `Enter` | Expand projection |
| `Shift+Enter` | Expand ensemble (perspectives) |
| `Cmd+,` | HUD settings |
| `Esc` | Close |

---

## 13. Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| **Panels are blank after a desktop rebuild** | The Keychain re-prompted and access was denied. Reopen the app and grant **Always Allow**, or re-add keys in Settings → API Keys. |
| **A feed shows no data** | That feed needs an API key. Check Settings → API Keys (and the live verification result), and Settings → Status for feed health. Most panels degrade gracefully without keys. |
| **God's Vision is a blank canvas** | Cesium failed to initialize (it needs `'unsafe-eval'` for shader compilation, which the app's CSP allows by default). Confirm WebGL is available and check the console for a Cesium/GLSL error. |
| **The web vault keeps locking** | Expected — it auto-locks after 15 minutes of the tab being hidden. Re-enter your passphrase. A lost passphrase is unrecoverable; Destroy and re-enter keys. |
| **MCP tools aren't available in Claude Code** | The desktop app must be running (the MCP server reads the sidecar port/token from disk). The web build has no MCP server. Verify with `check_feed_health`. |
| **A basemap won't load** | A stale `wm-basemap` value, or blocked tile fetches. The map validates and falls back automatically; check the console for the MapLibre `error` log (it includes the failing `sourceId`). |
| **Map tiles fail only in the desktop app** | Local resources must use `http://127.0.0.1:{port}`, never `localhost` — the CSP only allows `127.0.0.1`. |
| **Notifications are silent** | Check whether Ghost Mode (`Cmd+Shift+G`) is on — it silences notifications by design. Otherwise use Alert Trace ([§7](#7-alerts--notifications)) to see where delivery stopped. |
| **Reasoning errors** (red HUD footer counter) | Open the Diagnostics overlay (`Cmd+Shift+D`) → Events tab, or query `get_reasoning_debug_log` from Claude Code. |

---

*This manual tracks current product behavior. If you change behavior, update it in the
same branch — see [CONTRIBUTING.md](../CONTRIBUTING.md).*
