# GitHub README + About Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `README.md` with a portfolio-optimized rewrite leading with technical density, then update the GitHub repository About section (description + topics).

**Architecture:** Single file rewrite (`README.md`) plus a `gh` CLI command to update the GitHub repo metadata. No code changes — content and metadata only.

**Tech Stack:** Markdown, `gh` CLI (GitHub CLI), `markdownlint-cli2`

---

### Task 1: Write the new README.md

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Overwrite README.md with the new content**

Replace the entire file with:

```markdown
# Crystal Ball

Tauri 2 + TypeScript + Rust desktop app: 181+ live data panels across 4 product variants, a Cesium.js/DeckGL 3D globe with 22 geospatial layers, SGP4 orbital propagation in a Web Worker, AI summarization with Ollama/Groq/Claude/OpenRouter fallback chain, Protobuf/Buf contract-driven API layer, OS keychain secret storage, Node.js sidecar proxy on a bearer-authenticated local port, and a PostHog-instrumented Ghost Mode with analytics suppression.

[![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)](https://github.com/bradleybond512/crystal-ball/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/bradleybond512/crystal-ball/releases/latest)

<a href="https://github.com/bradleybond512/crystal-ball/releases/latest"><strong>Download Latest Release</strong></a>

<!-- screenshot: God's Eye 3D globe with HUD overlay and active layers -->

## God's Eye

Full-viewport Cesium.js 3D globe mode. Activate with `G` or the sidebar.

**22 live data layers:** military bases, nuclear facilities, earthquakes, active conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats, submarines, cables, ports, satellites, ISS, and more.

**HUD overlay:** threat assessment card, mode badge, HOTSPOTS/ALT/CONFLICT/DISASTER stat pills, nearest hotspot (haversine), sun-phase badge (DAY/GOLDEN/CIVIL/NAUTICAL/ASTRO/NIGHT), local clock at camera longitude, scrolling LIVE alert ticker, top-5 alert list, layer-toggle bar.

**Fly Mode:** game-style WASD/mouse first-person flight over the globe. Right-click drag for look, scroll for speed.

**Time Machine:** scrub historical data across a configurable time window.

**Satellite tracking:** SGP4 orbital propagation in a Web Worker — ISS, Starlink, weather satellites. No API key required, TLE data from CelesTrak.

**3D buildings:** 5-tier fallback — Google Photorealistic → Cesium OSM Buildings → 2D extrusions → flat. Photorealistic requires `GOOGLE_MAPS_API_KEY`.

**Imagery:** Bing satellite (Cesium Ion token) → ArcGIS World Imagery fallback.

<!-- screenshot: God's Eye with HUD overlay and active layers -->

## Intelligence Coverage

| Domain | What's included |
|--------|----------------|
| **Conflict & Geopolitics** | Live conflict zones, airstrike tracking, ACLED events, military bases, nuclear facilities, theater polygons, kill chain, ORBAT, STIX/TAXII feeds |
| **Weather** | 7-day forecasts, RainViewer global radar, Blitzortung lightning, NOAA GOES/Himawari satellite imagery, tide predictions, pollen tracking, NWS severe alerts, SPC convective outlooks, tropical cyclone tracking, red flag fire warnings |
| **Cyber & Threats** | ThreatFox IOCs, OpenPhish feeds, Spamhaus blocklists, CISA KEV, ICS/OT threats, network topology, 24-session EMA threat forecast, Palantir/Dragos-inspired intel panels |
| **Markets & Finance** | S&P 500, BTC, oil, gold, commodities, macro signals, central bank feeds, sector heatmap (requires Finnhub key) |
| **Space & Satellites** | ISS + Starlink + weather satellite tracking, SGP4 propagation, real-time orbital positions |
| **Infrastructure** | Submarine cables, maritime vessels, flight tracking, port status, datacenter outages, internet exchange points |
| **Disasters** | GDACS Red/Orange events, M6.5+ earthquakes, wildfire perimeters (NASA FIRMS), cyclone paths |

## What Makes This Hard

**Local-first desktop security boundary**
The renderer never touches API keys directly. Keys are stored in the OS keychain via Tauri's secret store, injected into a Node.js sidecar at startup, and proxied through a bearer-authenticated localhost port. The renderer resolves the sidecar port dynamically — no hardcoded assumptions about the runtime environment.

**CSP under real constraints**
`script-src` requires `'unsafe-eval'` because Cesium compiles GLSL shaders dynamically. Removing it silently breaks God's Eye (dynamic import failure → reload loop, no visible error). Compensating controls: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'` on script-src, devtools disabled in production builds.

**Variant architecture without forking**
Four product variants (Full, Tech, Finance, Happy) share one application shell. Panel inventory, map layer defaults, and feed configuration swap through `src/config/panels.ts` and `src/config/variant.ts` — not separate builds or conditional compilation.

**AI fallback chain**
Summarization resolves at runtime: Ollama (local) → Groq → Claude → OpenRouter → browser inference. Each hop is an explicit boundary, not a catch-all try/catch. Works in air-gapped and privacy-sensitive environments.

**App mode state machine**
Five modes (Peace/Finance/War/Disaster/Ghost) trigger on live signal thresholds — S&P ≥2.5%, ≥2 war signals above confidence 0.6 normalized by conflict baselines, GDACS Red events. Ghost Mode suppresses analytics, multiplies poll intervals ×5, and changes UI chrome. Mode transitions are deterministic and testable.

**WKWebView constraints**
CSS `-webkit-app-region: drag` is silently ignored. Window dragging requires JS `mousedown` → `tryInvokeTauri('plugin:window|start_dragging')`. All local iframes must use `http://127.0.0.1:{port}` not `localhost` — WKWebView treats them as distinct origins and the CSP only allows `127.0.0.1`.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | TypeScript, Vite, MapLibre GL, deck.gl, Cesium.js, D3, i18next |
| Contracts | Buf, Protobuf, generated TypeScript clients + OpenAPI output |
| Desktop shell | Tauri v2, Rust, OS keychain, Node.js sidecar (port 46123) |
| AI layer | Ollama → Groq → Claude → OpenRouter → browser inference |
| Verification | TypeScript strict, Playwright e2e + visual, sidecar unit tests |
| CI/CD | Tag-driven desktop publish, release manifest verification, CodeQL |

## By The Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Product variants | 4 | `src/config/variant.ts` |
| Desktop build targets | 3 | `package.json` |
| Default panel inventory | 181 full / 35 tech / 31 finance / 10 happy | `src/config/panels.ts` |
| God's Eye data layers | 22 | `src/components/GodsEyeView.ts` |
| Supported secret keys | 47 | `src-tauri/src/main.rs` |
| Locales | 19 | `src/locales/` |
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
npm ci && npm run dev # web, default variant
npm run dev:tech # tech variant
npm run dev:finance # finance variant
npm run desktop:dev # Tauri dev build
npm run desktop:build:full # production desktop
npm run typecheck:all # zero-error type check
```

See [docs/API_KEYS.md](docs/API_KEYS.md) for key setup and [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) for sidecar config.

## Documentation

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

## Contributing

If you change product behavior, API contracts, or operational workflows, update the docs in the same branch. The project is much easier to evaluate when the implementation and the documentation move together.

## License and Attribution

Licensed under AGPL-3.0-only. This desktop project builds on top of [bradleybond512/crystal-ball](https://github.com/bradleybond512/crystal-ball) by .
```

- [ ] **Step 2: Run markdown lint**

```bash
npm run lint:md
```

Expected: `Summary: 0 error(s)`

If errors appear, they will be in the table formatting or heading structure. Common fix: ensure table header rows have the correct number of columns matching the separator row.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: portfolio-optimized README rewrite

- Lead with dense technical hero paragraph
- God's Eye as flagship section (HUD, Fly Mode, Time Machine, 22 layers)
- Intelligence coverage table organized by domain
- What Makes This Hard: 6 non-trivial engineering challenges
- Corrected panel count: 181 full (was 134), secret keys: 47 (was 46)
- Merged duplicate docs tables into one

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Update GitHub About section

**Files:**
- No file changes — GitHub repository metadata updated via `gh` CLI

**Prerequisites:** `gh` CLI installed and authenticated to `bradleybond512` account.
Check with: `gh auth status`

- [ ] **Step 1: Verify gh CLI is authenticated**

```bash
gh auth status
```

Expected output includes `Logged in to github.com as bradleybond512`.

If not authenticated: `gh auth login` and follow the prompts.

- [ ] **Step 2: Update description and topics**

```bash
gh repo edit bradleybond512/crystal-ball \
  --description "Tauri 2 desktop app for real-time geopolitical, weather, cyber, and market intelligence. Cesium.js 3D globe, 181+ live panels, AI fallback chain, local-first secret storage." \
  --add-topic tauri \
  --add-topic typescript \
  --add-topic rust \
  --add-topic cesiumjs \
  --add-topic deckgl \
  --add-topic maplibre \
  --add-topic geospatial \
  --add-topic intelligence \
  --add-topic vite \
  --add-topic desktop \
  --add-topic macos \
  --add-topic real-time \
  --add-topic satellite-tracking \
  --add-topic osint
```

Expected: No error output. Command exits 0.

- [ ] **Step 3: Verify on GitHub**

Open: `https://github.com/bradleybond512/crystal-ball`

Confirm:
- Description shows in the About box (top-right on the repo page)
- Topics appear as clickable tags below the description

---

### Task 3: Push branch and open PR

- [ ] **Step 1: Commit the plan file**

```bash
git add docs/superpowers/plans/2026-04-07-github-readme-update.md
git commit -m "docs: add implementation plan for README update

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 2: Push the branch**

```bash
git push macos claude/readme-github-update
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create \
  --repo bradleybond512/crystal-ball \
  --title "docs: portfolio-optimized README rewrite" \
  --body "Full rewrite of README.md for maximum technical impact on GitHub.

## Changes
- Dense technical hero paragraph leading with full stack
- God's Eye promoted to section 2 (was section 6)
- Intelligence coverage table organized by domain
- New 'What Makes This Hard' section: 6 non-trivial engineering challenges explained
- Corrected stale numbers: 181 full panels (was 134), 47 secret keys (was 46)
- Merged two duplicate docs tables into one
- GitHub About: updated description + 14 topics via \`gh repo edit\`" \
  --base main
```

Expected: PR URL printed to terminal.
