# Crystal Ball

Tauri 2 + TypeScript + Rust desktop app: 180+ live data panels across 4 product variants, a Cesium.js/DeckGL 3D globe with 99 geospatial layers, SGP4 orbital propagation in a Web Worker, AI summarization with Ollama/Groq/Claude/OpenRouter fallback chain, an MCP server exposing 19+ tools for Claude Code integration, Protobuf/Buf contract-driven API layer, OS keychain secret storage, Node.js sidecar proxy on a bearer-authenticated local port, and a PostHog-instrumented Ghost Mode with analytics suppression.

[![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)](https://github.com/bradleybond512/crystal-ball/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/bradleybond512/crystal-ball/releases/latest)

<a href="https://github.com/bradleybond512/crystal-ball/releases/latest"><strong>Download Latest Release</strong></a> | <a href="https://bradleybond512.github.io/crystal-ball/"><strong>Try Web Version</strong></a>

<!-- screenshot: full-app overview -- 2D map with active panels -->

## God's Eye

Full-viewport Cesium.js 3D globe mode. Activate with `G` or the sidebar.

**99 live data layers:** military bases, nuclear facilities, earthquakes, active conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats, submarines, cables, ports, satellites, ISS, strike packages, navigation routes, RIPE Atlas probes, displacement flows, and more.

**HUD overlay:** threat assessment card, mode badge, HOTSPOTS/ALT/CONFLICT/DISASTER stat pills, nearest hotspot (haversine), sun-phase badge (DAY/GOLDEN/CIVIL/NAUTICAL/ASTRO/NIGHT), local clock at camera longitude, scrolling LIVE alert ticker, top-5 alert list, layer-toggle bar, navigation HUD with turn-by-turn routing.

**Fly Mode:** game-style WASD/mouse first-person flight over the globe. Right-click drag for look, scroll for speed.

**Time Machine:** scrub historical data across a configurable time window.

**Satellite tracking:** SGP4 orbital propagation in a Web Worker -- ISS, Starlink, weather satellites. No API key required, TLE data from CelesTrak.

**3D buildings:** 5-tier fallback -- Google Photorealistic > Cesium OSM Buildings > 2D extrusions > flat. Photorealistic requires `GOOGLE_MAPS_API_KEY`.

**Imagery:** Bing satellite (Cesium Ion token) > ArcGIS World Imagery fallback.

**Navigation system:** 2D MapLibre panel + 3D God's Vision integration. 4-tier routing engine (OSRM > GraphHopper > Valhalla > straight-line), 3-tier GPS (CoreLocation > browser > manual), street-level tile fallback chain (Mapbox > Stadia > OSM).

<!-- screenshot: God's Eye 3D globe with HUD overlay and active layers -->

## MCP Server

Crystal Ball ships an MCP (Model Context Protocol) server that exposes its intelligence feeds to Claude Code and other MCP-compatible AI agents. 19+ tools across aggregate situational awareness (sitrep, threats, markets, cyber, weather, infrastructure, military posture) and granular lookups (conflicts, news, IP, CVE, vessel, flight, sanctions, FRED economic data, SEC filings, earthquakes, disease outbreaks, region briefs). Registered automatically in Claude Code via `settings.json`.

## Intelligence Coverage

| Domain | What's included |
|--------|----------------|
| **Conflict & Geopolitics** | Live conflict zones, airstrike tracking, ACLED events, military bases, nuclear facilities, theater polygons, kill chain, ORBAT, STIX/TAXII feeds, strike package detection with route prediction, multi-theater coordination detection, historical conflict pattern matching |
| **Weather** | 7-day forecasts, RainViewer global radar, Blitzortung lightning, NOAA GOES/Himawari satellite imagery, tide predictions, pollen tracking, NWS severe alerts, SPC convective outlooks, tropical cyclone tracking, red flag fire warnings |
| **Cyber & Threats** | ThreatFox IOCs, OpenPhish feeds, Spamhaus blocklists, CISA KEV, ICS/OT threats, network topology, 24-session EMA threat forecast, Palantir/Dragos-inspired intel panels, local IDS integration (Suricata/Zeek) |
| **Markets & Finance** | S&P 500, BTC, oil, gold, commodities, macro signals, central bank feeds, sector heatmap, World Bank development indicators, stablecoin depeg detection, elections tracking |
| **Space & Satellites** | ISS + Starlink + weather satellite tracking, SGP4 propagation, real-time orbital positions, satellite ISR intelligence |
| **Infrastructure** | Submarine cables, maritime vessels, flight tracking, port status, datacenter outages, internet exchange points, CCTV & webcams, RIPE Atlas internet connectivity, power grid/comms health monitoring |
| **Disasters** | GDACS Red/Orange events, M6.5+ earthquakes, wildfire perimeters (NASA FIRMS), cyclone paths, UNHCR displacement data |
| **Alerts & Correlation** | Unified alert inbox with composite relevance scoring, 18-wave alert intelligence system, situation clustering, shift handoff, story timelines, entity co-occurrence graphs, geofence alerts, silence anomaly detection, escalation prediction |
| **Navigation** | Turn-by-turn routing (OSRM/GraphHopper/Valhalla), native CoreLocation GPS, street-level tiles, 2D + 3D globe integration |

## What Makes This Hard

**Local-first desktop security boundary**
The renderer never touches API keys directly. Keys are stored in the OS keychain via Tauri's secret store, injected into a Node.js sidecar at startup, and proxied through a bearer-authenticated localhost port. The renderer resolves the sidecar port dynamically -- no hardcoded assumptions about the runtime environment.

**CSP under real constraints**
`script-src` requires `'unsafe-eval'` because Cesium compiles GLSL shaders dynamically. Removing it silently breaks God's Eye (dynamic import failure > reload loop, no visible error). Compensating controls: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'` on script-src, devtools disabled in production builds.

**Variant architecture without forking**
Four product variants (Full, Tech, Finance, Happy) share one application shell. Panel inventory, map layer defaults, and feed configuration swap through `src/config/panels.ts` and `src/config/variant.ts` -- not separate builds or conditional compilation.

**AI fallback chain**
Summarization resolves at runtime: Ollama (local) > Groq > Claude > OpenRouter > browser inference. Each hop is an explicit boundary, not a catch-all try/catch. Works in air-gapped and privacy-sensitive environments.

**App mode state machine**
Five modes (Peace/Finance/War/Disaster/Ghost) trigger on live signal thresholds -- S&P >=2.5%, >=2 war signals above confidence 0.6 normalized by conflict baselines, GDACS Red events. Ghost Mode suppresses analytics, multiplies poll intervals x5, and changes UI chrome. Mode transitions are deterministic and testable.

**Native location via CoreLocation IPC**
WKWebView blocks `navigator.geolocation` entirely. Crystal Ball bypasses this with native CLLocationManager via ObjC FFI from Rust, exposed as a Tauri IPC command. Requires hardened runtime entitlements for location access.

**WKWebView constraints**
CSS `-webkit-app-region: drag` is silently ignored. Window dragging requires JS `mousedown` > `tryInvokeTauri('plugin:window|start_dragging')`. All local iframes must use `http://127.0.0.1:{port}` not `localhost` -- WKWebView treats them as distinct origins and the CSP only allows `127.0.0.1`.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | TypeScript, Vite, MapLibre GL, deck.gl, Cesium.js, D3, i18next |
| Contracts | Buf, Protobuf, generated TypeScript clients + OpenAPI output |
| Desktop shell | Tauri v2, Rust, OS keychain, Node.js sidecar (port 46123), CoreLocation IPC |
| AI layer | Ollama > Groq > Claude > OpenRouter > LM Studio > browser inference |
| MCP server | @modelcontextprotocol/sdk, 19+ tools, sidecar port/token discovery |
| Correlation | Unified event schema, controlled taxonomy, directional rules, causal chains |
| Verification | TypeScript strict, Playwright e2e + visual, sidecar unit tests |
| CI/CD | Tag-driven desktop publish, release manifest verification, CodeQL |

## By The Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Product variants | 4 | `src/config/variant.ts` |
| Desktop build targets | 3 | `package.json` |
| Default panel inventory | 180 full / 35 tech / 31 finance / 10 happy | `src/config/panels.ts` |
| God's Eye data layers | 99 | `src/types/index.ts` MapLayers |
| MCP tools | 19+ | `mcp-server/` |
| Supported secret keys | 49 | `src-tauri/src/main.rs` |
| Locales | 31 | `src/locales/` |
| Generated OpenAPI specs | 21 | `docs/api/` |

## Variants

| Variant | Web | Desktop | Focus |
|---------|-----|---------|-------|
| `full` | Yes | Yes | Geopolitics, infrastructure, cyber, conflict, disasters |
| `tech` | Yes | Yes | AI, startups, cloud, service health, developer ecosystems |
| `finance` | Yes | Yes | Markets, commodities, macro signals, central banks |
| `happy` | Yes | No | Positive news, progress, science, conservation |

## Quick Start

```bash
npm ci && npm run dev          # web, default variant
npm run dev:tech               # tech variant
npm run dev:finance            # finance variant
npm run desktop:dev            # Tauri dev build
npm run desktop:build:full     # production desktop
npm run typecheck:all          # zero-error type check
```

The `happy` variant shares the default dev server (`npm run dev`). See [docs/API_KEYS.md](docs/API_KEYS.md) for key setup and [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) for sidecar config.

## Documentation

| Guide | Purpose |
|-------|---------|
| [docs/API_KEYS.md](docs/API_KEYS.md) | All 49 API keys -- categories, signup URLs, free/paid |
| [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) | Desktop secret keys, feature availability, fallback |
| [docs/RELEASE_PACKAGING.md](docs/RELEASE_PACKAGING.md) | Desktop packaging and signing workflow |
| [docs/ALERTS_ENHANCEMENT_ROADMAP.md](docs/ALERTS_ENHANCEMENT_ROADMAP.md) | Alert system architecture and enhancement roadmap |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor workflow, checks, PR expectations |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and scope |

## Contributing

If you change product behavior, API contracts, or operational workflows, update the docs in the same branch. The project is much easier to evaluate when the implementation and the documentation move together.

## License and Attribution

Licensed under AGPL-3.0-only. This desktop project builds on top of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) by Elie Habib.
