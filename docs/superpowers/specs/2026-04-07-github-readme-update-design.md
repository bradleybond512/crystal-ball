# Design: GitHub README + About Update

**Date:** 2026-04-07
**Scope:** Full portfolio-optimized rewrite of `README.md` + GitHub repository About section (description + topics)
**Goal:** Make the repo look maximally impressive to an engineer evaluating it on GitHub, leading with technical depth

---

## What Changes

### README.md

Complete structural rewrite. Same content sources as current README, reorganized for impact.

**New section order:**

1. **Hero** — Dense technical one-liner, badge row, screenshot placeholder
2. **God's Vision** — Flagship feature, full capability list (HUD, Fly Mode, Time Machine, 22 layers, satellite tracking, 3D buildings)
3. **Intelligence Coverage** — Domain-organized table (Conflict, Weather, Cyber, Markets, Space, Infrastructure, Disasters)
4. **What Makes This Hard** — Six non-trivial engineering challenges explained concisely
5. **Architecture** — Stack table
6. **By The Numbers** — Verified stats table
7. **Variants** — Four-variant table
8. **Quick Start** — Commands, condensed
9. **Docs** — Single merged table (currently duplicated across two tables)

**What's removed:**
- "Why This Repo Is Interesting" section (absorbed into hero + What Makes This Hard)
- Duplicate docs table

---

## Section Content

### 1. Hero

```markdown
# Crystal Ball

Tauri 2 + TypeScript + Rust desktop app: 181+ live data panels across 4 product
variants, a Cesium.js/DeckGL 3D globe with 22 geospatial layers, SGP4 orbital
propagation in a Web Worker, AI summarization with Ollama/Groq/Claude/OpenRouter
fallback chain, Protobuf/Buf contract-driven API layer, OS keychain secret storage,
Node.js sidecar proxy on a bearer-authenticated local port, and a PostHog-instrumented
Ghost Mode with analytics suppression.

[![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)](https://github.com/bradleybond512/crystal-ball/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/bradleybond512/crystal-ball/releases/latest)

<a href="https://github.com/bradleybond512/crystal-ball/releases/latest"><strong>Download Latest Release</strong></a>

<!-- screenshot: God's Vision 3D globe with HUD overlay and active layers -->
```

### 2. God's Vision

```markdown
## God's Vision

Full-viewport Cesium.js 3D globe mode. Activate with `G` or the sidebar.

**22 live data layers:** military bases, nuclear facilities, earthquakes, active
conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats,
submarines, cables, ports, satellites, ISS, and more.

**HUD overlay:** threat assessment card, mode badge, HOTSPOTS/ALT/CONFLICT/DISASTER
stat pills, nearest hotspot (haversine), sun-phase badge (DAY/GOLDEN/CIVIL/NAUTICAL/
ASTRO/NIGHT), local clock at camera longitude, scrolling LIVE alert ticker,
top-5 alert list, layer-toggle bar.

**Fly Mode:** game-style WASD/mouse first-person flight over the globe.
Right-click drag for look, scroll for speed.

**Time Machine:** scrub historical data across a configurable time window.

**Satellite tracking:** SGP4 orbital propagation in a Web Worker — ISS, Starlink,
weather satellites. No API key required, TLE data from CelesTrak.

**3D buildings:** 5-tier fallback — Google Photorealistic → Cesium OSM Buildings →
2D extrusions → flat. Photorealistic requires `GOOGLE_MAPS_API_KEY`.

**Imagery:** Bing satellite (Cesium Ion token) → ArcGIS World Imagery fallback.

<!-- screenshot: God's Vision with HUD overlay and active layers -->
```

### 3. Intelligence Coverage

Domain-organized table:

| Domain | What's included |
|--------|----------------|
| **Conflict & Geopolitics** | Live conflict zones, airstrike tracking, ACLED events, military bases, nuclear facilities, theater polygons, kill chain, ORBAT, STIX/TAXII feeds |
| **Weather** | 7-day forecasts, RainViewer global radar, Blitzortung lightning, NOAA GOES/Himawari satellite imagery, tide predictions, pollen tracking, NWS severe alerts, SPC convective outlooks, tropical cyclone tracking, red flag fire warnings |
| **Cyber & Threats** | ThreatFox IOCs, OpenPhish feeds, Spamhaus blocklists, CISA KEV, ICS/OT threats, network topology, 24-session EMA threat forecast, Palantir/Dragos-inspired intel panels |
| **Markets & Finance** | S&P 500, BTC, oil, gold, commodities, macro signals, central bank feeds, sector heatmap (requires Finnhub key) |
| **Space & Satellites** | ISS + Starlink + weather satellite tracking, SGP4 propagation, real-time orbital positions |
| **Infrastructure** | Submarine cables, maritime vessels, flight tracking, port status, datacenter outages, internet exchange points |
| **Disasters** | GDACS Red/Orange events, M6.5+ earthquakes, wildfire perimeters (NASA FIRMS), cyclone paths |

### 4. What Makes This Hard

Six engineering challenges:

1. **Local-first desktop security boundary** — Keys in OS keychain, injected into Node.js sidecar, proxied through bearer-authenticated localhost. Renderer resolves port dynamically.

2. **CSP under real constraints** — `script-src 'unsafe-eval'` required by Cesium GLSL shader compilation. Removing it silently breaks God's Vision (dynamic import failure → reload loop). Compensating controls: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'`, devtools disabled in production.

3. **Variant architecture without forking** — Four product variants share one application shell. Panel inventory, map layer defaults, feed config swap through `src/config/panels.ts` and `src/config/variant.ts`.

4. **AI fallback chain** — Ollama → Groq → Claude → OpenRouter → browser inference. Each hop is an explicit boundary, not a catch-all try/catch.

5. **App mode state machine** — Five modes (Peace/Finance/War/Disaster/Ghost) trigger on live signal thresholds. Ghost Mode suppresses analytics, multiplies poll intervals ×5, changes UI chrome. Transitions are deterministic.

6. **WKWebView constraints** — CSS `-webkit-app-region: drag` silently ignored; window dragging requires JS `mousedown` → `tryInvokeTauri`. All local iframes must use `http://127.0.0.1:{port}` not `localhost` — WKWebView treats them as distinct origins.

### 5. Architecture

| Layer | Stack |
|-------|-------|
| Frontend | TypeScript, Vite, MapLibre GL, deck.gl, Cesium.js, D3, i18next |
| Contracts | Buf, Protobuf, generated TypeScript clients + OpenAPI output |
| Desktop shell | Tauri v2, Rust, OS keychain, Node.js sidecar (port 46123) |
| AI layer | Ollama → Groq → Claude → OpenRouter → browser inference |
| Verification | TypeScript strict, Playwright e2e + visual, sidecar unit tests |
| CI/CD | Tag-driven desktop publish, release manifest verification, CodeQL |

### 6. By The Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Product variants | 4 | `src/config/variant.ts` |
| Desktop build targets | 3 | `package.json` |
| Default panel inventory | 181 full / 35 tech / 31 finance / 10 happy | `src/config/panels.ts` |
| God's Vision data layers | 22 | `src/components/GodsVisionView.ts` |
| Supported secret keys | 47 | `src-tauri/src/main.rs` |
| Locales | 19 | `src/services/i18n.ts` |
| Generated OpenAPI specs | 21 | `docs/api/` |

### 7. Variants

| Variant | Web | Desktop | Focus |
|---------|-----|---------|-------|
| `full` | Yes | Yes | Geopolitics, infrastructure, cyber, conflict, disasters |
| `tech` | Yes | Yes | AI, startups, cloud, service health, developer ecosystems |
| `finance` | Yes | Yes | Markets, commodities, macro signals, central banks |
| `happy` | Yes | No | Positive news, progress, science, conservation |

### 8. Quick Start

```bash
npm ci && npm run dev # web, default variant
npm run dev:tech # tech variant
npm run dev:finance # finance variant
npm run desktop:dev # Tauri dev build
npm run desktop:build:full # production desktop
npm run typecheck:all # zero-error type check
```

See [docs/API_KEYS.md](docs/API_KEYS.md) for key setup and [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) for sidecar config.

### 9. Docs (merged single table)

| Guide | Purpose |
|-------|---------|
| [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) | Entry point for all repo docs |
| [docs/API_KEYS.md](docs/API_KEYS.md) | All 47 API keys — categories, signup URLs, free/paid |
| [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) | Desktop secret keys, feature availability, fallback |
| [docs/API_KEY_DEPLOYMENT.md](docs/API_KEY_DEPLOYMENT.md) | Cloud API trust boundary and origin rules |
| [docs/ADDING_ENDPOINTS.md](docs/ADDING_ENDPOINTS.md) | Proto + Buf workflow for new RPC endpoints |
| [docs/RELEASE_PACKAGING.md](docs/RELEASE_PACKAGING.md) | Desktop packaging and signing workflow |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor workflow, checks, PR expectations |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and scope |

---

## GitHub About Section

**Description** (≤255 chars):
```
Tauri 2 desktop app for real-time geopolitical, weather, cyber, and market intelligence. Cesium.js 3D globe, 181+ live panels, AI fallback chain, local-first secret storage.
```

**Topics:**
```
tauri, typescript, rust, cesiumjs, deckgl, maplibre, geospatial, intelligence, vite, desktop, macos, real-time, satellite-tracking, osint
```

The About description is updated via `gh repo edit --description "..." --add-topic "..."` against the `bradleybond512/crystal-ball` remote.

---

## What's Not Changing

- License and attribution section (unchanged)
- Contributing section (unchanged)
- All linked doc files (README links only, no doc content changes)
- `localStorage` keys, IndexedDB names, keyring service name (not in README)

---

## Verification

After writing README.md:
- `npm run typecheck:all` — no README-gated type checks, but confirms build is clean
- Render check: view on GitHub to confirm tables format correctly

Numbers verified against source files on 2026-04-07:
- FULL_PANELS: 181 keys in `src/config/panels.ts`
- SUPPORTED_SECRET_KEYS: `[&str; 47]` in `src-tauri/src/main.rs`
- OpenAPI specs: 21 files in `docs/api/`
