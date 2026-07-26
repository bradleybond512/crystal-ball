# Crystal Ball

Real-time global intelligence platform. Desktop app and web dashboard that aggregates 50+ live data feeds into a catalog of interactive panels, a 3D Cesium globe with configurable geospatial layers, an explainable algorithm intelligence layer (truth scoring + evidence graph + situation clustering + compound risk + forecast calibration + watchlist relevance), domain-aware shortage / weather / seismic / aviation / space / cyber engines, AI-powered analysis, SMS and desktop notification workflows, and an MCP server that lets Claude Code query it all from the terminal.

[![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)](https://github.com/bradleybond512/crystal-ball/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/bradleybond512/crystal-ball/releases/latest)

<a href="https://github.com/bradleybond512/crystal-ball/releases/latest"><strong>Download Latest Release</strong></a> | <a href="https://bradleybond512.github.io/crystal-ball/"><strong>Try Web Version</strong></a> | <a href="docs/USER_MANUAL.md"><strong>📖 Operator Manual</strong></a>

> **New here?** The [Operator Manual](docs/USER_MANUAL.md) is the step-by-step, task-oriented guide to running every feature. This README is the feature catalog; the manual is the how-to.

<!-- screenshot: full-app overview -- 2D map with active panels -->

---

## What It Does

Crystal Ball pulls data from ACLED, GDACS, NWS, USGS, CISA, ThreatFox, FRED, ADS-B, AIS, CelesTrak, NOAA, NASA, OpenSanctions, RIPE, SEC EDGAR, and dozens of other sources, then presents it across a 2D MapLibre map, a 3D Cesium globe, a variant-specific panel catalog, a unified alert inbox, and a correlation engine that connects events across domains. You can ask Claude Code `/sitrep` and get a synthesized intelligence brief from all active feeds without opening the app.

Four product variants share one codebase:

| Variant | Focus |
|---------|-------|
| `full` | Geopolitics, conflict, cyber, infrastructure, disasters, markets |
| `tech` | AI, startups, cloud, service health, developer ecosystems |
| `finance` | Markets, forex, bonds, commodities, crypto, central banks |
| `happy` | Positive news, progress, science, conservation |

---

## God's Vision

Full-viewport Cesium.js 3D globe. Press `G` or click the sidebar to enter.

**Configurable data layers** -- military bases, nuclear facilities, earthquakes, active conflicts, airstrikes, cyclones, fires, vessels, flights, cyber threats, submarine cables, ports, satellites, ISS, weather radar, lightning, GPS jamming, trade routes, day/night terminator, and more. Toggle layers from the layer bar.

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
- **Traceability** -- the Alert Trace panel answers "why did I, or didn't I, get warned?" across receipt, normalization, geofence, quiet-hours, relevance, and notification routing.
- **Delivery channels** -- native desktop notifications, voice alerts, iMessage / SMS command workflows, notification history, digest views, and operator mute / handoff controls.

**Keyboard shortcuts:** `J/K` navigate, `A` acknowledge, `P` pin, `1`-`5` filter by severity.

---

## Mission Workflows

Crystal Ball is organized around repeatable operator loops, not just feeds:

- **Command Center** -- current posture, recent changes, mission ledger, closed-loop batches, replay fixtures, and time-to-warn tracking.
- **Operator Mode** -- watch regions, mute controls, shift report export, alert trace, and dense layouts for repeated monitoring.
- **Domain Superpowers** -- deep panels for maritime, aviation, seismic, space, and financial domains, each with domain-specific indicators, gaps, and actions.
- **Local resilience** -- saved places, watched locations, local logistics, evacuation routing, family tracker, resource inventory, offline maps, and survival advisor.
- **Cyber and infrastructure** -- ICS/OT dashboard, IOC manager, STIX/TAXII, Little Snitch enrichment, security posture, infrastructure risk matrix, grid and internet intelligence.
- **Algorithm governance** -- safety cases, multi-agent review, model governance, backtest gates, shadow algorithms, outcome ledger, active learning, and repair recommendations.
- **Briefing and export** -- intelligence briefing, what-changed digest, presentation export, copy/share packets, and MCP-readable diagnostics.

---

## Analyst HUD -- Cross-Domain Reasoning Layer

Press `Cmd+Shift+A` to open the Analyst HUD. A persistent reasoning loop fuses outputs from `situation-engine`, `anomaly-detection`, `unified-alerts`, `threat-synthesis`, and your `watchlist` into one ranked list of cross-domain hypotheses. Each hypothesis has clickable evidence chips, a thread badge (`4c up` = 4 cycles, strengthening), color-coded entity chips (countries, tickers, CVEs, callsigns), and learns from your `+`/`-` votes over time.

**What it gives you:**

- **Hypotheses** -- top N ranked by `risk × confidence × feedback × outcome-accuracy`
- **Posture advisories** -- per-domain pressure (finance / security / disaster / cyber) with rolling sparklines and ETA-to-threshold projections
- **Hot entities** -- entities appearing in 2+ concurrent hypotheses, surfaced for cross-cutting awareness
- **Auto-briefs** (opt-in) -- on critical-pressure crossover, generates a focused 24h brief via the local-first LLM adapter
- **Skeptic + ensemble** -- per-hypothesis "perspectives ▾" runs analyst / skeptic / pragmatist personas in parallel
- **Projections** -- "simulate ▸" runs a 24/48h forward-look + cascade-simulator addendum if a matching infra node is found
- **Question chips** -- 3 investigative prompts per hypothesis; click to ask Claude (local first), answer caches inline
- **Replay scrubber** -- slide back through 120 archived snapshots, anchored by timestamp so eviction doesn't drift the position
- **Playbooks** -- learns what you do after each hypothesis (panel jumps, votes, exports) and surfaces "Last time: opened situation-awareness, voted useful (3×)" on recurrence
- **Markdown export** -- copy a full hypothesis thread (statement + evidence + skeptic + questions + answers + playbook + projection) to clipboard for shift handoff

**Local-first LLM with daily budget**: all generation routes through `/api/intel-generate` (Ollama / LM Studio → Groq) before falling back to the cloud Claude agent. The HUD footer shows your daily cloud-call cap; the Settings overlay (gear icon in HUD header, or `Cmd+,`) lets you raise/lower the cap or toggle auto-brief / skeptic.

**Keyboard:** `Esc` close · `↑/↓` select hypothesis · `Enter` expand projection · `Shift+Enter` expand ensemble · `Cmd+,` settings.

See [`docs/reasoning-layer.md`](docs/reasoning-layer.md) for the full service graph, event bus, storage layout, and invariants.

---

## Foundation Intelligence Layers

Four pure-deterministic, fixture-tested service layers under `src/services/` give the rest of the app explainable, testable scoring primitives. **600+ unit tests, zero UI, zero fetch — all input-output pure.**

### Algorithm Intelligence (`src/services/intelligence/`)

The full 7-PR algorithm stack from [`docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md`](docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md):

| Module | Purpose |
|---|---|
| `types.ts` | `NormalizedFact`, `EvidenceNode/Edge`, `TruthScore`, `AlgorithmExplanation`, `ConfidenceBreakdown` |
| `truth-score.ts` | Multi-source truth scoring with the doc's exact formula (reliability×0.25 + freshness×0.15 + corroboration×0.25 + sourceDiversity×0.15 + precision×0.10 + historicalAccuracy×0.10 − contradictionPenalty) and 5-point label (confirmed/likely/plausible/weak/disputed) |
| `evidence-graph.ts` | Typed nodes/edges connecting facts, sources, locations, entities; derivedFrom-aware independent-source counter; eventType-pair contradiction inference |
| `confidence-explanation.ts` | 100-point `ConfidenceBreakdown` (25/15/25/15/10/10 + penalty); domain-aware `missingConfirmation` hints |
| `situation-clustering.ts` | Union-find clustering across space + time + source + type; cross-domain compound situations; trend (rising/steady/falling); contradictions tracked separately |
| `negative-evidence.ts` | Expected follow-on signal catalog (quake → tsunami advisory, CVE → KEV addition, refinery outage → crack spread); window-based observation matching; missing-signal penalty + missing-confirmation hints |
| `baseline-deviation.ts` | Rolling-window store with z-score / percentile / 8-level deviation labels for any metric (aircraft / vessels / alerts / cyber / markets / weather / infra) |
| `compound-risk.ts` | Cross-domain compound score with cascade-pair table (weather × markets, cyber × infra, …), impact categories, plausibility-ranked cascade paths |
| `forecast-calibration.ts` | Prediction store with auto-resolution, Brier scoring, per-domain accuracy + per-source 0.5..1.5 trust multipliers anchored to fair-coin baseline |
| `watchlist-relevance.ts` | "Should I care?" filter — relevance score + 5-level personal-impact label using saved places, watched countries, portfolio, travel plans; helpful/dismissed/muted feedback nudges per-domain thresholds |

`npm run test:intelligence` runs ~158 tests.

### Weather Warning Remediation (`src/services/weather/`)

The full 4-PR storm-miss remediation from [`docs/WEATHER_WARNING_REMEDIATION_PLAN.md`](docs/WEATHER_WARNING_REMEDIATION_PLAN.md):

| Module | Purpose |
|---|---|
| `weather-threat-types.ts` | 16-hazard taxonomy, severity / message-type / threat-level enums, `AlertPolygon`, `NwsAlertMinimal`, `SavedPlace`, `PolygonMatchResult` |
| `nws-polygon-match.ts` | Ray-casting point-in-polygon + equirectangular distance-to-edge; UGC zone fallback when polygon missing; threat-level escalation (inside-polygon warnings → emergency for high-risk hazards); "prefer false-positive over silent miss" near-buffer for tornado / flash-flood / severe-TS |
| `weather-urgency.ts` | 6-rung delivery priority (background → digest → watch_window → banner → persistent_critical → persistent_critical_with_imessage); quiet-hours bypass for high-risk hazards; tornado / flash-flood acknowledgment escalation; meaningful-change repeat suppression; per-hazard watch-window signals |
| `personal-storm-mode.ts` | Storm Mode payload: 4 activation tiers, arrival-window math from storm motion + bearing, main-threat label per hazard, time-budget-aware action filtering |
| `preparedness-actions.ts` | Per-hazard action library covering all 16 hazard kinds (tornado shelter / severe-TS prep / flash-flood / tropical / blizzard / heat / fire / power outage / …) with priority + estimatedMinutes |
| `weather-warning-diagnostics.ts` | "Why didn't I get warned?" debug packet — 7-stage pipeline trace (NWS receipt → sidecar → normalize → polygon → router → quiet hours → relevance) with verdicts and targeted remediation hints |

`npm run test:weather` runs ~114 tests.

### Insights & Notifications (`src/services/insights/`)

Per [`docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md`](docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md):

| Module | Purpose |
|---|---|
| `confidence-urgency-matrix.ts` | The plan's Confidence × Urgency matrix (high/high → notify_now, low/high → watch_window, high/low → digest, low/low → background); 5-tier `SituationTier` (FYI/Watch/Elevated/Critical/Emergency); extreme-impact bump; unchanged-since-last downgrade |
| `big-event-detector.ts` | 8-trigger detector (rapid_severity_jump / many_sources_converge / official_confirms_weak / high_personal_exposure / multi_domain_overlap / high_confidence_high_impact / low_confidence_extreme_impact / forecast_threshold_crossed) with weight + rationale per trigger |
| `change-memory.ts` + `what-changed-digest.ts` | Snapshot store + delta engine — 9 ChangeKinds (new / cleared / score_rose / score_fell / tier_escalated / tier_de_escalated / sources_confirming / sources_lost / meta_changed); polarity- and weight-sorted output ready for the digest UI |
| `action-briefs.ts` + `reaction-playbooks.ts` | 10-category playbook library (severe weather, wildfire, oil/fuel shortage, food shortage, cyber campaign, banking outage, conflict escalation, travel disruption, grid outage, disease outbreak); 4-tier action briefs (monitor / prepare / act_now / shelter) with confidence-aware caps |
| `presentation-export.ts` | Markdown / clipboard / share-sheet / Claude debug packet formatters for any `BriefingContent`; pure formatters, no DOM dependencies |

`npm run test:insights` / `test:insights2` / `test:insights3` / `test:insights6` run ~125 tests.

### Shortage & Commodity Forecasts (`src/services/shortage/`)

Per [`docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md`](docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md):

| Module | Purpose |
|---|---|
| `shortage-types.ts` | `ShortageDriver` (production / inventory / transport / policy / demand / price / cross_domain), `ShortageInput` with provenance, `ShortageForecast`, `CommodityPlaybook` |
| `shortage-score.ts` | Weighted scoring across 7 driver buckets; freshness decay; confidence derivation (low/med/high based on weight coverage + gaps + freshness + source diversity); data-gap detection that flags missing AND stale inputs |
| `commodity-playbooks.ts` | Static fact sheets per commodity — leading/confirming/invalidating indicators, seasonal exposure, chokepoints, affected countries/sectors |
| `*-shortage-risk.ts` | 8 deterministic models: **wheat**, **corn**, **rice**, **soybeans** (food); **diesel**, **gasoline**, **natural gas**, **jet fuel** (energy). Each with seasonal multipliers (corn pollination heat, gasoline driving season, natgas winter heating, etc.) |

`npm run test:shortage` runs ~80 tests.

---

## Diagnostics Overlay (`Cmd+Shift+D`)

Press `Cmd+Shift+D` for the reasoning diagnostics overlay. Four tabs:

- **Events** -- 200-entry ring buffer log filterable by level (info / warn / error) and category (bootstrap / idb / llm / events / commands / hypothesis / forecast / budget / sidecar). Copy-as-JSON or clear from the toolbar.
- **Metrics** -- per-op latency table (count / p50 / p95 / p99 / mean / last) + named counters (e.g. `llm.local.success`, `idb.put.error`, `analyst-cycle.runs`).
- **State** -- live shape of every reasoning store: hypothesis count, snapshot archive size, brief archive size, thread count, entity mentions, accuracy samples, relevance weights, LLM budget. Plus a localStorage-footprint table.
- **Boot** -- bootstrap trace with per-service start latency.

The HUD footer (`Cmd+Shift+A`) shows a live error counter (turns red when > 0). All errors are also pushed to the sidecar within 2s, readable from Claude Code via the `get_reasoning_debug_log` and `get_reasoning_metrics` MCP tools.

`window.cbReasoningDebug.dump()` and `window.cbReasoningMetrics.snapshot()` work from the DevTools console too.

For terminal triage, run `npm run doctor`. It discovers the live sidecar port, checks the current app session, and ranks likely causes with next actions. Add `-- --deep` for the ten-route self-test or `-- --deep --json` for a redacted agent handoff. See [docs/DIAGNOSTICS_WORKBENCH.md](docs/DIAGNOSTICS_WORKBENCH.md).

---

## MCP Server -- Claude Code Integration

Crystal Ball ships an MCP server that gives Claude Code direct access to all intelligence feeds and the in-app reasoning state. 56 tools are registered automatically when you open a session in this repo. Call `help()` for full documentation.

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

**Foundation tools** (query primitives): `query_raw` (direct sidecar endpoint access), `chain_query` (multi-step queries with `$prev[N]` references), `compare_snapshots` (structured diffs).

**Intelligence tools** (analysis): `correlate` (cross-domain entity matching), `trend` (time-series from sentinel history), `anomaly_scan` (deviation detection vs baselines).

**Stateful tools** (persistent tracking): `watchlist_manage` / `watchlist_check` (track IPs, tickers, regions, CVEs, vessels, callsigns), `alert_rules_manage` / `alert_check` (threshold-based alerts).

**Analyst tools** (reasoning-layer read + write): `get_analyst_hypotheses` (top ranked hypotheses with thread enrichment), `get_mode_forecast` (per-domain pressure + advisories), `get_analyst_accuracy` (hit/miss ratio per kind), `get_hot_entities` (cross-cutting entities). Write-back via `submit_hypothesis_feedback`, `dismiss_hypothesis`, `run_skeptic_now` — these post to a sidecar queue the renderer drains every ~10s.

**Diagnostic tools**: `diagnose_runtime` (ranked live triage with optional deep probes), `get_algorithm_diagnostics` (health, evaluation coverage, latency, bounded tunings, proposals, decisions), `get_pipeline_trace` (fact-lifecycle and stalled-stage inspection), `check_feed_health` (sidecar + key feed preflight), `sitrep_bundle` (pre-filtered multi-domain bundle), `get_reasoning_debug_log` (filterable ring buffer), `get_reasoning_metrics` (latency histograms + counters).

**Help**: `help()` returns full tool index; `help({ tool: "correlate" })` returns man page; `help({ topic: "getting-started" })` for guides; `help({ examples: "cross-domain" })` for cookbooks.

**Slash commands** built on top of MCP tools:

- `/sitrep` -- full-spectrum presidential-style daily intelligence brief. 3-phase intelligence cycle: parallel collection across the MCP tool surface, triage & enrichment on elevated signals, analyst-voice synthesis. Personalized to your home location, platforms, and watchlist tickers.
- `/sentinel` -- autonomous intelligence sweep: gathers sitrep, diffs against previous snapshot, checks watchlists and alert rules, writes alerts. Designed for scheduled runs every 30 minutes.
- `/correlate` -- interactive cross-domain correlation analysis with trend context and follow-up suggestions
- `/watchlist` -- manage watchlists and alert rules from the CLI
- `/alerts` -- check current alerts, clear history, filter by severity
- `/watch Strait of Hormuz` -- regional brief for any location
- `/threat-brief` -- top 5 threats with trajectory and recommended watches
- `/market-pulse` -- markets snapshot with yield curve and Fed balance sheet

The MCP server talks to the Crystal Ball sidecar over a bearer-authenticated localhost port. Crystal Ball must be running. Sentinel history and watchlists are stored in `~/.crystal-ball/`.

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
| `Cmd+Shift+A` | Toggle Analyst HUD |
| `Cmd+Shift+D` | Toggle Reasoning Diagnostics overlay |
| `Cmd+Shift+G` | Toggle Ghost Mode |
| `Cmd+Shift+H` | Export current briefing to clipboard |
| `Cmd+Shift+S` | Toggle Status overlay |
| `Cmd+Shift+T` | Toggle Today view |
| `Cmd+Shift+W` | Toggle Watchlist editor |
| `Cmd+S` | Copy shareable URL to clipboard |
| `Cmd+,` | Open Settings (or Analyst HUD settings if HUD is open) |
| `Cmd+\` | Toggle sidebar |
| `F` | Enter Fly Mode (in God's Vision) |
| `N` | Toggle Navigation (in God's Vision) |
| `Space` | Play/pause Time Machine (in God's Vision) |
| `L` | Toggle day/night terminator |
| `1`-`6` | Fly to theater presets |
| `Cmd+1`-`5` | Save/recall camera bookmarks |
| `ESC` | Exit any open overlay or Fly Mode |

**Inside the Analyst HUD**: `↑`/`↓` move the selection ring through hypotheses, `Enter` expands the projection, `Shift+Enter` expands the ensemble (perspectives) block.

---

## Procedural Audio

All sounds are synthesized with Web Audio API -- no audio files in the repo:

- **Mode transitions** -- military two-tone pulse, Bloomberg-style chime, EAS attention signal, electronic sweep
- **Spatial layers** -- sub-bass drone (conflict-driven), bandpass noise (news density), sonar sweep, teletype tick, 28Hz ghost hum
- **Feedback** -- panel open/close clicks, data ingestion pulses, sonar pings, geiger ticks
- **Controls** -- master mute, per-layer volume, spatial volume slider (0-100%)

---

## What Makes This Hard

**Local-first security boundary** -- the renderer never sees API keys on desktop. Keys live in the macOS keychain, get injected into a Node.js sidecar at startup, and are proxied through a bearer-authenticated localhost port. The MCP server discovers the port and token from disk files with `0o600` permissions.

**Web key vault** -- the browser build has no keychain access, so user-entered keys are persisted in a passphrase-encrypted IndexedDB vault. AES-GCM-256 over PBKDF2-SHA-256 (600,000 iterations, OWASP 2023), per-save random 12-byte IV, AAD-bound ciphertext. The derived key and plaintext map live only in module closure -- never written to localStorage, sessionStorage, or globalThis -- and the vault auto-locks after 15 minutes of the tab being hidden. Lost passphrase = destroy and re-enter; there is no recovery.

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
| Algorithm intelligence | Pure-deterministic scoring foundation — `intelligence/` (evidence graph, truth scoring, situation clustering, negative evidence, baseline deviation, compound risk, forecast calibration, watchlist relevance) |
| Domain engines | `weather/` (NWS polygon matching, urgency ladder, Storm Mode, miss diagnostics), `shortage/` (8 commodity forecast models with seasonal multipliers), `insights/` (Big Event Detector, Confidence × Urgency Matrix, What Changed Digest, Action Briefs, Presentation Export) |
| Reasoning  | Analyst HUD, hypothesis-threads / accuracy / dedupe / entities / skeptic / projection / ensemble, IDB reasoning_memory, local-first LLM adapter with daily budget |
| MCP server | @modelcontextprotocol/sdk, 56 tools (aggregate / granular / foundation / intelligence / stateful / analyst / diagnostic / help), sidecar port/token discovery |
| Correlation | Unified event schema, directional rules, temporal chains, situation clustering |
| Alerts | Unified inbox, composite relevance scoring, IndexedDB persistence, custom rules |
| Audio | Procedural Web Audio synthesis, per-layer spatial mixing |
| Verification | TypeScript strict, 600+ deterministic unit tests, Playwright e2e + visual, sidecar unit tests |
| CI/CD | Tag-driven desktop publish, release manifest verification, CodeQL, secret scan |

---

## By The Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Panel inventory | Generated from the active variant catalog | `src/config/panels.ts` |
| God's Vision map layers | Generated from the full map-layer catalog | `src/config/panels.ts` FULL_MAP_LAYERS |
| Panel categories | Generated from the panel category map | `src/config/panels.ts` PANEL_CATEGORY_MAP |
| Product variants | 4 | `src/config/variant.ts` |
| MCP tools | 56 | `tools/mcp-server/index.mjs` |
| Supported secret keys | 77 | `src-tauri/src/main.rs` |
| Foundation intelligence modules | 24 | `src/services/{intelligence,weather,insights,shortage}/` |
| Foundation deterministic tests | 600+ | `npm run test:intelligence` + `test:weather` + `test:insights*` + `test:shortage` |
| Commodity shortage models | 8 (wheat, corn, rice, soybeans, diesel, gasoline, natural gas, jet fuel) | `src/services/shortage/*-shortage-risk.ts` |
| Reaction playbook categories | 10 | `src/services/insights/reaction-playbooks.ts` |
| Weather hazard kinds tracked | 16 | `src/services/weather/weather-threat-types.ts` |
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

Foundation layer tests (run any subset):

```bash
npm run test:intelligence      # ~158 tests — algorithm intelligence stack
npm run test:weather           # ~114 tests — weather warning remediation
npm run test:shortage          # ~80 tests  — shortage forecast models
npm run test:insights          # ~47 tests  — Big Event Detector + Matrix
npm run test:insights2         # ~28 tests  — What Changed Digest
npm run test:insights3         # ~26 tests  — Action Briefs + Reaction Playbooks
npm run test:insights6         # ~24 tests  — Presentation Export
```

The `happy` variant shares the default dev server. Set `SITE_VARIANT=happy` in your environment.

API keys are optional -- most panels degrade gracefully without them. Configure keys in Settings (gear icon) > API Keys tab. See [docs/API_KEYS.md](docs/API_KEYS.md) for the full list.

---

## Documentation

| Guide | Purpose |
|-------|---------|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | **Operator manual** — task-oriented, step-by-step how-to for every feature (start here) |
| [docs/reasoning-layer.md](docs/reasoning-layer.md) | Analyst HUD service graph, event bus, IDB schema, MCP surface, invariants, keyboard shortcuts |
| [docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md](docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md) | 7-PR algorithm intelligence layer plan — evidence graph, truth scoring, situation clustering, negative evidence, baseline deviation, compound risk, forecast calibration, watchlist relevance |
| [docs/WEATHER_WARNING_REMEDIATION_PLAN.md](docs/WEATHER_WARNING_REMEDIATION_PLAN.md) | Storm-miss remediation — saved-place polygon matching, urgency ladder, Personal Storm Mode, weather miss diagnostics |
| [docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md](docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md) | Big Event Detector, Confidence × Urgency Matrix, What Changed Digest, Action Briefs + Reaction Playbooks, Presentation Export |
| [docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md](docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md) | Food + energy shortage forecast framework — 8 commodity models with seasonal multipliers and provenance-aware inputs |
| [docs/superpowers/specs/2026-04-14-enhanced-sitrep-design.md](docs/superpowers/specs/2026-04-14-enhanced-sitrep-design.md) | Enhanced `/sitrep` design -- 3-phase intelligence cycle, personalization, full MCP tool surface |
| [docs/API_KEYS.md](docs/API_KEYS.md) | All 77 API keys -- categories, signup URLs, free/paid, plain-language descriptions |
| [docs/DESKTOP_CONFIGURATION.md](docs/DESKTOP_CONFIGURATION.md) | Desktop secret keys, feature availability, fallback behavior |
| [docs/RELEASE_PACKAGING.md](docs/RELEASE_PACKAGING.md) | Desktop packaging and signing workflow |
| [docs/MCP_PIPELINE.md](docs/MCP_PIPELINE.md) | How Claude Code gathers intelligence via MCP -- pipeline, auth, tools |
| [docs/DIAGNOSTICS_WORKBENCH.md](docs/DIAGNOSTICS_WORKBENCH.md) | Fast runtime triage, agent handoffs, pipeline tracing, and safe algorithm-tuning workflow |
| [docs/ALERTS_ENHANCEMENT_ROADMAP.md](docs/ALERTS_ENHANCEMENT_ROADMAP.md) | Alert system architecture and enhancement roadmap |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor workflow, checks, PR expectations |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and scope |

---

## Contributing

If you change product behavior, API contracts, or operational workflows, update the docs in the same branch. The project is much easier to evaluate when the implementation and the documentation move together.

## License and Attribution

Licensed under AGPL-3.0-only. This desktop project builds on top of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) by Elie Habib.
