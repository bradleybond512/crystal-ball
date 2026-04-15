# Crystal Ball

Real-time global intelligence platform. Desktop app and web dashboard that aggregates 50+ live data feeds into 183 interactive panels, a 3D Cesium globe with 70 geospatial layers, AI-powered analysis, and an MCP server that lets Claude Code query it all from the terminal.

[![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)](https://github.com/bradleybond512/crystal-ball/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/bradleybond512/crystal-ball/releases/latest)

<a href="https://github.com/bradleybond512/crystal-ball/releases/latest"><strong>Download Latest Release</strong></a> | <a href="https://bradleybond512.github.io/crystal-ball/"><strong>Try Web Version</strong></a>

<!-- screenshot: full-app overview -- 2D map with active panels -->

---

## What It Does

Crystal Ball pulls data from ACLED, GDACS, NWS, USGS, CISA, ThreatFox, FRED, ADS-B, AIS, CelesTrak, and dozens of other sources, then presents it across a 2D MapLibre map, a 3D Cesium globe, 183 live panels, a unified alert inbox, and a correlation engine that connects events across domains. You can ask Claude Code `/sitrep` and get a synthesized intelligence brief from all active feeds without opening the app.

Four product variants share one codebase:

| Variant | Panels | Focus |
|---------|--------|-------|
| `full` | 183 | Geopolitics, conflict, cyber, infrastructure, disasters, markets |
| `tech` | 35 | AI, startups, cloud, service health, developer ecosystems |
| `finance` | 31 | Markets, forex, bonds, commodities, crypto, central banks |
| `happy` | 10 | Positive news, progress, science, conservation |

---

## God's Vision

Full-viewport Cesium.js 3D globe. Press `G` or click the sidebar to enter.

**70 data layers** -- military bases, nuclear facilities, earthquakes, active conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats, submarine cables, ports, satellites, ISS, weather radar, lightning, GPS jamming, trade routes, day/night terminator, and more. 26 enabled by default; toggle the rest from the layer bar.

**HUD overlay** -- real-time UTC clock, threat level assessment (NOMINAL through CRITICAL), camera altitude and coordinates, sun phase (DAY/GOLDEN/CIVIL/NAUTICAL/ASTRO/NIGHT), local time at camera longitude, nearest hotspot with haversine distance, scrolling alert ticker, top-5 active alerts, and layer toggle controls.

**Fly Mode** -- 5 submodes: free fly (WASD + mouse), cinema (smooth auto-orbit), autopilot (waypoint tour), targeted (fly-to-entity), and chase (track a moving target). Right-click drag to look, scroll for speed, `C` to toggle cockpit view.

**Time Machine** -- scrub historical data across a configurable time window. Space bar to play/pause.

**Satellite tracking** -- SGP4 orbital propagation in a Web Worker for ISS, Starlink, and weather satellites. TLE data from CelesTrak, no API key required.

**3D buildings** -- 5-tier fallback: Google Photorealistic Tiles > Cesium OSM Buildings > 2D extrusions > flat terrain. Photorealistic requires `GOOGLE_MAPS_API_KEY`.

**Navigation** -- turn-by-turn routing integrated into the globe. 4-tier routing engine (OSRM > GraphHopper > Valhalla > straight-line), street-level tiles, and a Navigation HUD with ETA. Press `N` to toggle.

**Theater presets** -- press `1`-`6` to fly to Middle East, Pacific, Europe, Arctic, Africa, or Americas. `Cmd+1`-`5` to save/recall custom camera bookmarks. `W` to drop waypoints, `Shift+W` to start a tour.

**Spatial audio** -- procedural Web Audio that responds to what's on screen. Sub-bass drone during conflict, teletype clicks during market activity, sonar pings for map events, geiger ticks on the radiation layer. All independently toggleable.

<!-- screenshot: God's Eye 3D globe with HUD overlay and active layers -->

---

## Unified Alert System

A single inbox that ingests from every alert source -- NWS, GDACS, OREF (Israel sirens), ACLED, ThreatFox, CISA KEV, power grid, cyber, breaking news, and internal correlation signals.

**What you can do with it:**

- **Triage** -- alerts scored by `severity * proximity * freshness * novelty * source_trust`. Highest-relevance items surface first.
- **Situations** -- related alerts auto-cluster by geography (<100km), time (<6hr), and category. A hurricane touching down generates one situation card, not 15 separate items.
- **Geofencing** -- set watched locations (home, office, family). Alerts within your radius get promoted automatically.
- **Reactions** -- acknowledge, pin, snooze, annotate, or bookmark any alert. Snooze re-escalates if the situation worsens.
- **Correlation** -- the engine detects patterns across domains: market-news divergence, prediction-leads-news, keyword velocity spikes, compound threats, temporal chains, and silence anomalies.
- **History** -- alerts persist in IndexedDB for 30 days. Search, filter, export. Activity log tracks every action for shift handoff.
- **Custom rules** -- define your own alert triggers with condition/action pairs, or use built-in presets (earthquake watcher, storm chaser, conflict monitor).

**Keyboard shortcuts:** `J/K` navigate, `A` acknowledge, `P` pin, `1`-`5` filter by severity.

---

## MCP Server -- Claude Code Integration

Crystal Ball ships an MCP server that gives Claude Code direct access to all intelligence feeds. 19 tools registered automatically when you open a session in this repo.

**Aggregate tools** (broad awareness):

| Command | What you get |
|---------|-------------|
| `get_sitrep` | Top conflicts, market moves, weather alerts, service health |
| `get_threat_landscape` | ACLED conflicts, ThreatFox IOCs, CISA KEVs, crisis alerts |
| `get_market_overview` | Indices, crypto, ETF flows, Fear & Greed, FRED macro signals |
| `get_cyber_intel` | IOCs, KEVs, phishing URLs, malware feeds, OTX threat pulses |
| `get_weather_environment` | Conditions for 28 global cities, NWS alerts, space weather |
| `get_infrastructure_status` | Power grid, water quality, radiation, outage alerts |
| `get_military_posture` | Tracked aircraft (ADS-B), naval vessels (AIS), theater posture, ISW |

**Granular tools** (targeted lookups): `search_conflicts`, `search_news`, `lookup_ip`, `lookup_cve`, `lookup_vessel`, `lookup_flight`, `get_sanctions`, `get_economic_data`, `get_sec_filings`, `get_earthquakes`, `get_disease_outbreaks`, `get_region_brief`.

**Slash commands** built on top of MCP tools:

- `/sitrep` -- daily intelligence brief across all domains
- `/watch Strait of Hormuz` -- regional brief for any location
- `/threat-brief` -- top 5 threats with trajectory and recommended watches
- `/market-pulse` -- markets snapshot with yield curve and Fed balance sheet

The MCP server talks to the Crystal Ball sidecar over a bearer-authenticated localhost port. Crystal Ball must be running. See [docs/MCP_PIPELINE.md](docs/MCP_PIPELINE.md) for the full pipeline architecture.

---

## Intelligence Coverage

| Domain | Sources and capabilities |
|--------|------------------------|
| **Conflict & Geopolitics** | ACLED events, airstrike tracking, military bases, nuclear facilities, STIX/TAXII feeds, kill chain tracker, ORBAT, ISW reports, theater posture, multi-theater coordination detection, OpenSanctions, OREF sirens, Ukraine frontline, DSCA arms transfers, UN Security Council |
| **Cyber & Threats** | ThreatFox IOCs, CISA KEV, OpenPhish, URLhaus, Vulners CVE, Pulsedive, VirusTotal, HIBP breach exposure, OTX threat pulses, ICS/OT dashboard, IOC manager, STIX/TAXII feeds, network topology, Bitcoin abuse |
| **Markets & Finance** | S&P 500, BTC, oil, gold, commodities, FRED macro signals, Fear & Greed index, central bank calendar, BTC ETF flows, SEC EDGAR filings, supply chain tracking, financial contagion modeling, stablecoin monitoring, WSB sentiment |
| **Weather & Environment** | 7-day forecasts, RainViewer global radar, Blitzortung lightning, NOAA satellite imagery, NWS alerts, SPC mesoscale, tropical cyclones, tide predictions, pollen tracking, red flag fire warnings, air quality, wildfire smoke |
| **Space & Satellites** | ISS + Starlink + weather satellite tracking, SGP4 propagation, space weather (NASA DONKI), NOAA SWPC, space launches, aerospace reentry tracker |
| **Infrastructure** | Submarine cables, maritime vessels (AIS), flight tracking (ADS-B), port status, power grid monitoring, internet disruptions, RIPE NCC BGP, datacenter outages, communications health |
| **Disasters & Health** | GDACS Red/Orange events, USGS earthquakes, NASA FIRMS wildfires, cyclone paths, volcano alerts, tsunami alerts, WHO disease outbreaks, UNHCR displacement, humanitarian crises, food insecurity, hazmat incidents |

---

## Ghost Mode

Press `Cmd+Shift+G`. Polling intervals multiply by 5x, PostHog analytics are suppressed, notifications go silent, and the sidebar switches to dark crimson chrome. For when you want to monitor without being monitored.

---

## AI Summarization

Every panel has a summarize button (sparkle icon). The AI fallback chain resolves at runtime:

1. **Ollama** -- local, no data leaves the machine
2. **Groq** -- fast cloud inference
3. **Claude** -- Anthropic API
4. **OpenRouter** -- routes to 100+ models

Works in air-gapped environments with just Ollama. Each hop is an explicit boundary, not a catch-all.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `G` | Toggle God's Vision 3D globe |
| `Cmd+K` | Command palette |
| `Cmd+Shift+G` | Toggle Ghost Mode |
| `Cmd+Shift+T` | Toggle Today view |
| `Cmd+Shift+W` | Toggle Watchlist editor |
| `Cmd+S` | Copy shareable URL to clipboard |
| `Cmd+,` | Open Settings |
| `Cmd+\` | Toggle sidebar |
| `F` | Enter Fly Mode (in God's Vision) |
| `N` | Toggle Navigation (in God's Vision) |
| `Space` | Play/pause Time Machine (in God's Vision) |
| `L` | Toggle day/night terminator |
| `1`-`6` | Fly to theater presets |
| `Cmd+1`-`5` | Save/recall camera bookmarks |
| `ESC` | Exit God's Vision or Fly Mode |

---

## Procedural Audio

All sounds are synthesized with Web Audio API -- no audio files in the repo:

- **Mode transitions** -- military two-tone pulse, Bloomberg-style chime, EAS attention signal, electronic sweep
- **Spatial layers** -- sub-bass drone (conflict-driven), bandpass noise (news density), sonar sweep, teletype tick, 28Hz ghost hum
- **Feedback** -- panel open/close clicks, data ingestion pulses, sonar pings, geiger ticks
- **Controls** -- master mute, per-layer volume, spatial volume slider (0-100%)

---

## What Makes This Hard

**Local-first security boundary** -- the renderer never sees API keys. Keys live in the macOS keychain, get injected into a Node.js sidecar at startup, and are proxied through a bearer-authenticated localhost port. The MCP server discovers the port and token from disk files with `0o600` permissions.

**CSP under real constraints** -- `script-src` requires `'unsafe-eval'` because Cesium compiles GLSL shaders dynamically. Removing it silently breaks God's Vision. Compensating controls: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'` on script-src, devtools disabled in production.

**Variant architecture without forking** -- four product variants share one shell. Panel inventory, map layer defaults, and feed configuration swap through `src/config/panels.ts` and `src/config/variant.ts` at build time.

**Native location via CoreLocation IPC** -- WKWebView blocks `navigator.geolocation`. Crystal Ball bypasses this with native CLLocationManager via ObjC FFI from Rust, exposed as a Tauri IPC command.

**WKWebView constraints** -- CSS `-webkit-app-region: drag` is silently ignored. All local iframes must use `http://127.0.0.1:{port}` not `localhost`. Window dragging requires JS `mousedown` into Tauri's `start_dragging` command.

---

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | TypeScript, Vite, MapLibre GL, deck.gl, Cesium.js, D3, i18next |
| Contracts | Buf, Protobuf, generated TypeScript clients + OpenAPI output |
| Desktop shell | Tauri v2, Rust, macOS keychain, CoreLocation IPC, Node.js sidecar (port 46123) |
| AI layer | Ollama > Groq > Claude > OpenRouter |
| MCP server | @modelcontextprotocol/sdk, 19 tools, sidecar port/token discovery |
| Correlation | Unified event schema, directional rules, temporal chains, situation clustering |
| Alerts | Unified inbox, composite relevance scoring, IndexedDB persistence, custom rules |
| Audio | Procedural Web Audio synthesis, per-layer spatial mixing |
| Verification | TypeScript strict, Playwright e2e + visual, sidecar unit tests |
| CI/CD | Tag-driven desktop publish, release manifest verification, CodeQL, secret scan |

---

## By The Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Panels (full variant) | 183 | `src/config/panels.ts` |
| God's Vision map layers | 70 (26 on by default) | `src/types/index.ts` MapLayers |
| Panel categories | 19 | `src/config/panels.ts` PANEL_CATEGORY_MAP |
| Product variants | 4 | `src/config/variant.ts` |
| MCP tools | 19 | `tools/mcp-server/index.mjs` |
| Supported secret keys | 49 | `src-tauri/src/main.rs` |
| Locales | 19 | `src/locales/` |
| Generated OpenAPI specs | 21 | `docs/api/` |
| Desktop build targets | 3 | `package.json` |
| CI/CD workflows | 12 | `.github/workflows/` |

---

## Quick Start

```bash
npm ci && npm run dev          # web, full variant (default)
npm run dev:tech               # tech variant
npm run dev:finance            # finance variant
npm run desktop:dev            # Tauri desktop with devtools
npm run desktop:build:full     # production desktop build
npm run typecheck:all          # zero-error type check
```

The `happy` variant shares the default dev server. Set `SITE_VARIANT=happy` in your environment.

API keys are optional -- most panels degrade gracefully without them. Configure keys in Settings (gear icon) > API Keys tab. See [docs/API_KEYS.md](docs/API_KEYS.md) for the full list.

---

## Documentation

| Guide | Purpose |
|-------|---------|
| [docs/MCP_PIPELINE.md](docs/MCP_PIPELINE.md) | How Claude Code gathers intelligence via MCP -- pipeline, auth, tools |
| [docs/API_KEYS.md](docs/API_KEYS.md) | All 49 API keys -- categories, signup URLs, free/paid |
| [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) | Desktop secret keys, feature availability, fallback behavior |
| [docs/RELEASE_PACKAGING.md](docs/RELEASE_PACKAGING.md) | Desktop packaging and signing workflow |
| [docs/ALERTS_ENHANCEMENT_ROADMAP.md](docs/ALERTS_ENHANCEMENT_ROADMAP.md) | Alert system architecture and enhancement roadmap |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor workflow, checks, PR expectations |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and scope |

---

## Contributing

If you change product behavior, API contracts, or operational workflows, update the docs in the same branch. The project is much easier to evaluate when the implementation and the documentation move together.

## License and Attribution

Licensed under AGPL-3.0-only. This desktop project builds on top of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) by Elie Habib.
