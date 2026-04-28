# Crystal Ball — Claude Code Context

## Project Overview

- **App name**: Crystal Ball
- **Bundle ID**: `com.bradleybond.crystalball`
- **Stack**: Tauri 2 + TypeScript + Vite + DeckGL + Node.js sidecar (port 46123)
- **Algorithm intelligence plan**: `docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md` — implemented 7-PR stack under `src/services/intelligence/` (truth scoring, evidence graph, situation clustering, negative evidence, baseline deviation, compound risk, forecast calibration, watchlist relevance).
- **Weather warning remediation**: `docs/WEATHER_WARNING_REMEDIATION_PLAN.md` — implemented 4-PR stack under `src/services/weather/` (NWS polygon matching, urgency ladder, Personal Storm Mode payload, miss diagnostics). PR 5 (UI) deferred.
- **Insights/notifications plan**: `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md` — implemented 4-PR stack under `src/services/insights/` (Big Event Detector + Confidence/Urgency Matrix, What Changed Digest, Action Briefs + Reaction Playbooks, Presentation Export). PRs 4 (notification ladder wiring) + 5 (UI) deferred.
- **Shortage forecast plan**: `docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md` — implemented 4 batches under `src/services/shortage/` covering 8 commodities (wheat, corn, rice, soybeans on the food side; diesel, gasoline, natural gas, jet fuel on the energy side).
- **API expansion plan**: `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md` — free/free-tier API redundancy list + Claude-ready prompts.
- **Current remaining gaps**: `docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md` — latest Claude handoff for what is still missing after the recent service-layer PR wave: Command Center, diagnostics UI, notification wiring, native macOS finish, replay, and PR queue cleanup.
- **Security scan findings**: `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md` — current highest-standard cyber security hardening list: secret IPC minimization, CSP tightening, HTML sink governance, origin allowlist unification, proxy URL hardening, local token handling, and clipboard audit.
- **Security scan round 2**: `docs/SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md` — additional scan pass covering Rust audit tooling, SAST, CI permissions, sebuf wildcard CORS fallback, relay preview-origin/bypass risks, Linux WebKit sandbox exceptions, update manifest verification, and API test gaps.

## Orchestration Layer (UI + Wiring)

Four panels stitch the foundation services into product surfaces:

- **`src/components/CommandCenterPanel.ts`** — gameplan's top-of-app surface. Shows current personal risk, top 3 things that matter (sorted by criticality + severity), what to watch next, and recommended actions. Reads from `getFeatureHealthRegistry()` + `getPanelHealthRegistry()` + `getNotificationTraceRegistry()` and feeds them through `aggregateSystemHealth()`.
- **`src/components/SystemDiagnosticPanel.ts`** — tabbed Overview / Features / Panels / Notifications / Feeds / Self-Test surface. The Self-Test tab fires `runSelfTests(standardSelfTestDefinitions(...))` and renders pass/warn/fail/skipped per probe. Auto-refresh 5 s.
- **`src/components/AlgorithmDiagnosticPanel.ts`** — per-algorithm hit rate, weighted hit rate, latency, and Safe Adjustment proposal (apply / noop / at_bound / manual_review / no_tunable). Reads from `getAlgorithmEvaluationLedger()` + `getAlgorithmDefinitions()`.
- **`src/components/ShortageRadarPanel.ts`** — sorted-by-risk view across the 7 commodity models (wheat, corn, diesel, gasoline, sugar, coffee, cocoa). Each card shows tier, confidence, top 3 drivers, data gaps, horizon. Hosts can call `panel.setRequests(...)` to inject live inputs.

Singleton state lives in `src/services/diagnostics/diagnostics-state.ts` and `src/services/algorithms/algorithms-state.ts` — every panel reads the same registries.

Notification wiring (`src/services/insights/notification-ladder.ts`) bridges Big Event Detector → Notification Trace Registry → notification rung. Records the full lifecycle (created → urgency → relevance → dedupe → quiet hours → rung). Safety-critical events override quiet hours; non-safety events get suppressed.

Replay fixtures (`src/services/ops/replay-fixtures-catalog.ts`) ship five missed-event cases (late severe wind, silent tornado polygon, fuel-stress late, quiet-hours suppression, ADS-B outage) with stable timestamps so the harness can prove regressions.

## Foundation Intelligence Layers

Four pure-deterministic, fixture-tested service layers. **No DOM, no fetch, no globals — input-output pure. 600+ unit tests.**

- **`src/services/intelligence/`** — explainable scoring foundation. Every score has a `ConfidenceBreakdown`, every claim has provenance via `EvidenceNode/Edge`, contradictions surface separately rather than averaging away. Exported types (`NormalizedFact`, `TruthScore`, `Situation`, `CompoundRiskResult`, `RelevanceResult`, etc.) are the contract for downstream consumers.
- **`src/services/weather/`** — saved-place-aware NWS pipeline. `matchAlertToPlace` does point-in-polygon + UGC zone fallback. `urgencyFor` produces the delivery rung + meaningful-change repeat-suppression interval. `buildStormModePayload` produces the Storm Mode card. `diagnoseAlert` walks the 7-stage pipeline trace for "why didn't I get warned?".
- **`src/services/insights/`** — UX scaffolding. `detectBigEvent` runs the 8-trigger taxonomy. `computeDigest` produces the What Changed Digest. `buildActionBrief` reads from a 10-category playbook library. `toMarkdown` / `toClipboardSummary` / `toShareSheetText` / `toClaudeDebugPacket` format any briefing.
- **`src/services/shortage/`** — 8 deterministic commodity forecast models. Each takes a `ShortageInputBag` (provenance-aware), runs through 7 driver buckets (production / inventory / transport / policy / demand / price / cross_domain), produces a `ShortageForecast` with drivers + confidence + data gaps. Seasonal multipliers honor the calendar.

Test scripts: `npm run test:intelligence` / `test:weather` / `test:insights{,2,3,6}` / `test:shortage`.

Plan invariants honored across all four layers:
- Every score includes an explanation
- Every source-derived claim carries provenance
- Stale data reduces confidence (never silently disappears)
- Contradictions surface, not averaged away
- Every output is testable with static fixtures (no live fetch in the unit tests)

## Commands

```bash
npm run desktop:build:full   # full production build
npm run typecheck:all        # type-check both tsconfig.json + tsconfig.api.json (must stay at zero errors)
npm run dev                  # vite dev server (web only, no Tauri)
npm run release:prepare -- --bump patch --push   # only supported release path
```

Install built app: copy `src-tauri/target/release/bundle/macos/Crystal Ball.app` to `~/Applications/Crystal Ball.app` (use `node scripts/install-built-app.mjs --relaunch`).

## Release Management

The supported release path is **tag-driven**. Desktop publishing runs from the `build-desktop.yml` workflow when a `vX.Y.Z` (or `vX.Y.Z-<variant>`) tag is pushed to `origin`. `workflow_dispatch` builds artifacts without publishing.

- Supported variants: `full`, `tech`, `finance` (see `scripts/release-metadata.mjs`).
- Only supported release command: `npm run release:prepare -- --bump patch --push`. It bumps `package.json`, writes the CHANGELOG entry, tags, and pushes — the tag push is what triggers the publisher.
- The release-integrity workflow runs `release-doctor.mjs` per-variant on `main` pushes (strict) and on PRs (with `--allow-existing-target-release` so unrelated PRs don't break).
- Never publish manually with `gh release create` or by hand-editing tags; the workflow collects a manifest, verifies the downloaded payload, and only then promotes to public release.

## CANONICAL REPO — SINGLE SOURCE OF TRUTH (MANDATE)

There is exactly ONE place to develop this app:

```text
~/developer/crystalball
```

- **Never** build, commit, or make changes in any other clone
- **Never** install to `/Applications` from any other build directory
- Always install from: `src-tauri/target/release/bundle/macos/Crystal Ball.app` in this directory
- The Dock and Spotlight should point to `~/Applications/Crystal Ball.app` only

## Git Remotes

- `origin` — `bradleybond512/crystal-ball` — **always push here**

Always commit with: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Branch Discipline (MANDATORY for every session)

**Never commit directly to local `main`.** Every session must follow this flow:

```bash
git fetch origin
git checkout -b claude/your-feature-name origin/main  # or codex/your-feature-name
# ... do work, commit freely on the branch ...
git push origin claude/your-feature-name
# open a PR → auto-merge lands it
```

- Branch names: `claude/*` for Claude sessions, `codex/*` for Codex sessions
- Local `main` should only ever be fast-forwarded to `origin/main`, never developed on directly

## Architecture

```
src/                        # TypeScript frontend (Vite)
  app/
    panel-layout.ts         # panel instantiation + sidebar layout + bootstrap
    data-loader.ts          # data fetching, task scheduling
    refresh-scheduler.ts    # scheduleRefresh() — ghost multiplier + hidden×10 + jitter
    event-handlers.ts       # UI events, keyboard shortcuts
  components/
    Panel.ts                # base Panel class
    GlobeHUD.ts             # God's Eye HUD overlay
    GlobeDataManager.ts     # God's Eye Cesium layer manager
    GodsVisionView.ts       # God's Eye 3D globe view
    AnalystHUD.ts           # ⌘⇧A analyst reasoning HUD
    ReasoningDebugOverlay.ts # ⌘⇧D diagnostics overlay
  config/
    panels.ts               # FULL_PANELS, PANEL_CATEGORY_MAP, FULL_MAP_LAYERS
  services/
    mode-manager.ts         # AppMode: peace/finance/war/disaster/ghost
    runtime-config.ts       # API key definitions, feature toggles, web verifySecret probes
    settings-constants.ts   # HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, SETTINGS_CATEGORIES
    web-secret-store.ts     # browser-only passphrase-encrypted vault (see "Web key vault" below)
    analytics.ts            # PostHog (suppressed in Ghost Mode)
    # ── Analyst reasoning layer (see docs/reasoning-layer.md) ──
    analyst-loop.ts             # cross-domain hypothesis fusion + ranking
    mode-forecast.ts            # per-domain pressure EWMA + advisories
    pressure-baselines.ts       # 168 hour-of-week baselines per domain
    pressure-history.ts         # rolling sparkline samples + critical notif
    hypothesis-threads.ts       # signature-keyed continuity tracker
    hypothesis-entities.ts      # country/ticker/CVE/callsign extraction
    hypothesis-feedback.ts      # signature-keyed thumbs up/down
    hypothesis-accuracy.ts      # outcome-graded hit/miss per kind
    hypothesis-dedupe.ts        # union-find merge across reasoning surfaces
    hypothesis-skeptic.ts       # opt-in second-pass contrarian LLM
    hypothesis-projection.ts    # 24/48h projection + cascade-sim addendum
    hypothesis-ensemble.ts      # analyst/skeptic/pragmatist personas
    hypothesis-notifier.ts      # native notification on critical-first
    hypothesis-export.ts        # markdown bundle for clipboard
    auto-brief.ts               # critical-crossover Claude brief
    briefing-archive.ts         # 200-entry brief ring
    snapshot-archive.ts         # 120-entry analyst-snapshot ring
    action-memory.ts            # playbook recorder ("last time you did X")
    relevance-learner.ts        # per-term boost from user engagement
    watchlist-hypothesis-bridge.ts  # watchlist matches → hypotheses
    question-suggester.ts       # 3 investigative chips per hypothesis
    analyst-command-listener.ts # MCP write-back queue poller
    sidecar-pusher.ts           # mirror analyst state → /api/analyst-state
    llm-adapter.ts              # local-first generateText() (Ollama → cloud)
    llm-budget.ts               # daily cloud-call cap + race-safe reserve
    reasoning-memory.ts         # IDB KV store on shared crystalball_db
    reasoning-debug.ts          # 200-entry ring buffer log
    reasoning-metrics.ts        # latency histograms + counters
    # ── Algorithm intelligence foundation (see docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md) ──
    intelligence/types.ts                    # NormalizedFact, EvidenceNode/Edge, TruthScore, AlgorithmExplanation, ConfidenceBreakdown
    intelligence/truth-score.ts              # multi-source truth scoring (formula + 5-point label)
    intelligence/evidence-graph.ts           # typed graph + derivedFrom-aware independent-source counter
    intelligence/confidence-explanation.ts   # 100-point breakdown + missingConfirmation hints
    intelligence/situation-clustering.ts     # union-find clustering across space/time/source/type
    intelligence/negative-evidence.ts        # expected follow-on signals + missing-signal penalty
    intelligence/baseline-deviation.ts       # rolling-window store + z-score / percentile / 8-level labels
    intelligence/compound-risk.ts            # cross-domain compound score with cascade-pair table
    intelligence/forecast-calibration.ts     # Brier scoring + per-domain accuracy + per-source multipliers
    intelligence/watchlist-relevance.ts      # "Should I care?" filter + feedback-adjusted thresholds
    # ── Weather warning remediation (see docs/WEATHER_WARNING_REMEDIATION_PLAN.md) ──
    weather/weather-threat-types.ts          # 16-hazard taxonomy, AlertPolygon, NwsAlertMinimal, SavedPlace, PolygonMatchResult
    weather/nws-polygon-match.ts             # ray-casting + UGC zone fallback + threat-level escalation
    weather/weather-urgency.ts               # 6-rung delivery priority + acknowledgment escalation + watch windows
    weather/personal-storm-mode.ts           # Storm Mode payload (4 activation tiers, arrival window)
    weather/preparedness-actions.ts          # per-hazard action library (16 hazards)
    weather/weather-warning-diagnostics.ts   # 7-stage pipeline trace for "why didn't I get warned?"
    # ── Insights & notifications (see docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md) ──
    insights/confidence-urgency-matrix.ts    # 4-corner Confidence × Urgency matrix + 5-tier SituationTier
    insights/big-event-detector.ts           # 8-trigger detector with weight + rationale per trigger
    insights/change-memory.ts                # snapshot store for what-changed deltas
    insights/what-changed-digest.ts          # 9-ChangeKind delta engine, polarity- and weight-sorted output
    insights/reaction-playbooks.ts           # 10-category static playbook library
    insights/action-briefs.ts                # 4-tier action briefs (monitor/prepare/act_now/shelter)
    insights/presentation-export.ts          # Markdown / clipboard / share / Claude debug packet formatters
    # ── Shortage forecasts (see docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md) ──
    shortage/shortage-types.ts               # ShortageDriver, ShortageInput, ShortageForecast, CommodityPlaybook
    shortage/shortage-score.ts               # weighted scoring across 7 driver buckets + freshness + confidence + data-gap detection
    shortage/commodity-playbooks.ts          # static fact sheets per commodity
    shortage/wheat-shortage-risk.ts          # food, 60d horizon, Black Sea + Bosphorus + Suez chokepoints
    shortage/corn-shortage-risk.ts           # food, 90d horizon, pollination heat anomaly amplifier
    shortage/rice-shortage-risk.ts           # food, 90d horizon, monsoon + India ban + Thai 5% benchmark
    shortage/soybeans-shortage-risk.ts       # food, 90d horizon, La Niña + China crush + USDA condition
    shortage/diesel-shortage-risk.ts         # energy, 30d horizon, Gulf + Hormuz + Rotterdam + Singapore
    shortage/gasoline-shortage-risk.ts       # energy, 30d horizon, Colonial Pipeline + driving season
    shortage/natural-gas-shortage-risk.ts    # energy, 60d horizon, HDD/CDD + LNG export + cold-snap flag
    shortage/jet-fuel-shortage-risk.ts       # energy, 30d horizon, SAF constraint + airport shortage alert
src-tauri/
  sidecar/local-api-server.mjs  # Node.js API proxy, port 46123 — exposes
                                # /api/analyst-state + /api/analyst-commands
                                # for MCP read+write to renderer state
  capabilities/default.json     # Tauri capability allowlist
  src/main.rs                   # SUPPORTED_SECRET_KEYS, keychain service "crystal-ball"
tools/mcp-server/
  index.mjs                # MCP server registering 30+ tools
  tools/analyst.mjs        # 9 analyst tools (4 read + 3 write + 2 diagnostic)
```

## Analyst Reasoning Layer

A persistent, renderer-side reasoning stack that fuses `situation-engine`, `anomaly-detection`, `unified-alerts`, `threat-synthesis`, and the `watchlist` into ranked cross-domain hypotheses. The full architecture (event bus, IDB schema, MCP surface, invariants, bootstrap order) lives in [`docs/reasoning-layer.md`](docs/reasoning-layer.md). Highlights:

- **HUD**: ⌘⇧A. Sections: posture advisories (with sparklines), hot entities, ranked hypotheses with thread badges + entity chips + clickable evidence, auto-briefs, briefing timeline, replay scrubber.
- **Diagnostics**: ⌘⇧D. Four tabs (Events / Metrics / State / Boot). HUD footer shows live error counter.
- **LLM**: `llm-adapter.generateText()` is the single entry point; prefers Ollama / LM Studio via `/api/intel-generate` before falling back to `runClaudeAgent`. Daily cloud-call cap enforced by `llm-budget.reserveCloudCall()` (race-safe for parallel personas).
- **MCP**: 4 read + 3 write + 2 diagnostic tools — see `tools/mcp-server/tools/analyst.mjs`.
- **Memory**: IDB `reasoning_memory` store on the shared `crystalball_db` (versionchange handlers in alert-store and reasoning-memory let upgrades happen without blocking each other). LS bootstrap + writtenSinceLoad guard against IDB hydrate races.

## Web Key Vault (`src/services/web-secret-store.ts`)

The browser build can't reach the macOS keychain, so user-entered keys are persisted in a passphrase-encrypted IndexedDB vault. Architecture:

- AES-GCM-256 over PBKDF2-SHA-256, **600,000 iterations** (OWASP 2023). Per-save random 12-byte IV, AAD pinned to `"crystalball-web-vault-v1"` so a future v2 needs an explicit migration.
- Ciphertext stored in shared `crystalball_db` IDB at key `web-secret-vault/v1`. Derived key + plaintext `Map<string,string>` live only in module closure — **never** localStorage / sessionStorage / globalThis.
- Auto-lock after 15 min of `document.visibilityState === 'hidden'`. Manual Lock and Destroy in the API Keys tab banner.
- `setSecret` / `persistCurrent` snapshot the derived key before the async encrypt and re-verify after the await; concurrent auto-lock during a save throws cleanly instead of silently persisting with a wiped key.
- `runtime-config.setSecretValue` routes to the vault when `!isDesktopRuntime() && isWebVaultUnlocked()`, otherwise routes to the desktop keychain via `invokeTauri('set_secret')`.
- `runtime-config.isFeatureAvailable` gates on the vault's `requiredSecrets` once unlocked. Before unlock, web optimistically trusts server-managed credentials so users without a vault don't see a wall of red.
- `runtime-config.verifyWebSecret` does direct CORS-friendly probes for Anthropic / Groq / OpenRouter / Cesium Ion / Mapbox / MapTiler with `referrerPolicy: 'no-referrer'` so bearer tokens don't leak via redirect Referer. Other providers fall through to a non-committal "Saved".
- The API Keys tab in `UnifiedSettings` mounts the same `RuntimeConfigPanel` as desktop; the panel's `renderWebVaultBanner()` swaps the inputs for create/unlock/lock/destroy state when `!isDesktopRuntime()`.

## Desktop Chrome Activation (`src/main.ts`)

`body.is-desktop-macos` drives the entire sidebar + toolbar design system. Applied when:
- `isDesktopRuntime()` is true (Tauri build), **OR**
- `FORCE_DESKTOP_GATE` env override is on, **OR**
- the browser has `(pointer: fine)` AND `window.innerWidth >= 768` (Windows / Linux / Mac web on a real monitor).

Touch phones and narrow tablets get the mobile layout. The class name is historical; "macos" now means "the macOS-inspired chrome we use on any desktop browser."

## Basemap Switcher (`src/components/DeckGLMap.ts`)

Four basemaps (`dark | light | satellite | terrain`) selected by the `wm-basemap` localStorage key. Style URLs:
- Dark/Light → self-hosted `/map-styles/{dark,light}.json` referencing CARTO raster tiles. The vector gl-style URL (`basemaps.cartocdn.com/gl/...`) is **not** used because it's cross-origin and not covered by the existing workbox `[abc].basemaps.cartocdn.com` cache rule.
- Satellite → self-hosted `/map-styles/satellite.json` (NASA GIBS Blue Marble).
- Terrain → self-hosted `/map-styles/terrain.json` (OpenTopoMap).

`initMapLibre()` validates the persisted value against `validBasemaps` to prevent stale localStorage from leaving the UI in a stuck state. A MapLibre `'error'` listener logs failed style/tile fetches with `sourceId` so the next user report comes with diagnostics.

## App Modes (`src/services/mode-manager.ts`)

| Mode | Trigger |
|------|---------|
| Peace | default |
| Finance | S&P500 ≥2.5% OR BTC ≥5% OR Oil ≥4% OR Gold ≥2% |
| War | ≥2 war signals > confidence 0.6 (normalized by conflict baselines) |
| Disaster | GDACS Red OR 3+ Orange OR M≥6.5 quake |
| Ghost | Manual only — ⌘⇧G / sidebar / File menu |

Ghost Mode: polling ×5, analytics suppressed, notifications suppressed, dark crimson sidebar.

## CSP Posture

`script-src` includes `'unsafe-eval'`. Required by Cesium (God's Eye 3D globe) for shader compilation. Do not remove without first replacing Cesium with a non-eval globe library. Compensating defenses: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'` on script-src, devtools disabled in production.

## Tauri 2 / WKWebView Gotchas

- **Window drag**: CSS `-webkit-app-region: drag` does NOT work — use JS `mousedown` → `tryInvokeTauri('plugin:window|start_dragging')`. Requires `core:window:allow-start-dragging` in `capabilities/default.json`.
- **Local iframes**: Always `http://127.0.0.1:{port}`, never `localhost` — CSP only allows `127.0.0.1`. Use `getApiBaseUrl()` from `runtime.ts`.
- **Devtools**: Use `--features devtools` flag during dev (NOT in default features).

## Persistence Identifiers

- `localStorage` keys are `crystalball-*` / `cb-*` / `cb:*`
- IndexedDB is `crystalball_db`
- macOS Keychain service is `crystal-ball`
- Log directory is `~/Library/Logs/com.bradleybond.crystalball/`

## Settings / API Keys

API keys entered via gear icon → API Keys tab. None embed the brand in their names; all 49 supported keys are generic API names (ANTHROPIC_API_KEY, GROQ_API_KEY, etc).

## Secret Scan Guardrail

Mandatory repo secret scan enforcement in hooks and CI. This is a user-owned repo on GitHub — provider-native secret validity checks and non-provider patterns don't cover everything on their own, so the compensating control is mandatory repo-level scanning. Keep `npm run secrets:scan:staged` and `npm run secrets:scan` active and passing.
