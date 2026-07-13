# Crystal Ball — Claude Code Context

## KEYCHAIN — ABSOLUTE PROHIBITION

Never access, modify, or delete macOS Keychain entries under any circumstances.
This includes: `security delete-generic-password`, `security add-generic-password`,
`security find-generic-password`, the `keyring` crate's `Entry::delete()`, or any
equivalent. Keychain operations are reserved for the running application only.
Violation caused a full key loss incident on 2026-05-08 requiring manual re-entry
of 29 API credentials.

The user-invoked `npm run backup-keys` and `npm run restore-keys` scripts are the
only sanctioned entry points; do not call them on the user's behalf without an
explicit, in-turn instruction.

### Backup workflow

`npm run backup-keys` reads each known `crystal-ball/*` key from the keychain and
writes a single encrypted archive to
`~/Library/Mobile Documents/com~apple~CloudDocs/CrystalBall/keys-backup-YYYYMMDD-{engine}.enc`.
Plaintext is never written to iCloud. The encryption engine is auto-selected:

1. **age** (preferred) — ChaCha20-Poly1305 AEAD with Argon2id KDF. `brew install age`.
2. **gpg** — AES-256 + SHA-512 S2K (65M iterations) + OpenPGP MDC.
3. **openssl** (fallback) — AES-256-CBC + PBKDF2-HMAC-SHA256 (600,000 iters,
   NIST SP 800-132 2023) + sidecar HMAC-SHA256 (`*.enc.hmac`) for integrity.

Output filename embeds the engine so restore knows what to do
(`-age.enc`, `-gpg.enc`, or `-openssl.enc`). Files are written with mode 600.

### Restore workflow

`npm run restore-keys -- /path/to/keys-backup-YYYYMMDD-engine.enc` decrypts the
archive and writes each `KEY=value` back to the keychain (idempotent under `-U`).
Engine is auto-detected from the filename suffix.

Use `npm run restore-keys -- --verify <path>` first to decrypt the archive and
list the contained KEY names (values are never printed) — confirms the backup
is valid before committing to a keychain write.

Integrity is verified BEFORE any keychain writes:

- age + gpg fail decryption when the AEAD/MDC tag mismatches.
- openssl recomputes the sidecar HMAC and aborts on mismatch.

## Project Overview

- **App name**: Crystal Ball
- **Bundle ID**: `com.bradleybond.crystalball`
- **Stack**: Tauri 2 + TypeScript + Vite + DeckGL + Node.js sidecar (port 46123)
- **Algorithm intelligence plan**: `docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md` — implemented 7-PR stack under `src/services/intelligence/` (truth scoring, evidence graph, situation clustering, negative evidence, baseline deviation, compound risk, forecast calibration, watchlist relevance).
- **Weather warning remediation**: `docs/WEATHER_WARNING_REMEDIATION_PLAN.md` — implemented 5-PR stack under `src/services/weather/` (NWS polygon matching, urgency ladder, Personal Storm Mode payload, miss diagnostics) + the PR 5 Storm Mode strip (`src/components/PersonalStormMode.ts`, persistent ack/snooze, expiry self-clear).
- **Insights/notifications plan**: `docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md` — implemented 4-PR stack under `src/services/insights/` (Big Event Detector + Confidence/Urgency Matrix, What Changed Digest, Action Briefs + Reaction Playbooks, Presentation Export). PRs 4 (notification ladder wiring) + 5 (UI) deferred.
- **Shortage forecast plan**: `docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md` — implemented 4 batches under `src/services/shortage/` covering 8 commodities (wheat, corn, rice, soybeans on the food side; diesel, gasoline, natural gas, jet fuel on the energy side).
- **Cognitive enhancement plan**: `docs/COGNITIVE_ENHANCEMENT_PLAN.md` — **ACTIVE** 16-PR stack for `src/services/cognition/` (episodic memory, closed calibration loop, superforecaster pipeline, operator model, entity dossiers, conformal intervals, consolidation, EVOI planner, self-tuning + benchmark). The doc contains its own Progress Tracker + Session Protocol — implementing sessions must read it first and update the tracker in the same commit.
- **API expansion plan**: `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md` — free/free-tier API redundancy list + Claude-ready prompts.
- **Current remaining gaps**: `docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md` — latest Claude handoff for what is still missing after the recent service-layer PR wave: Command Center, diagnostics UI, notification wiring, native macOS finish, replay, and PR queue cleanup.
- **Security scan findings**: `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md` — current highest-standard cyber security hardening list: secret IPC minimization, CSP tightening, HTML sink governance, origin allowlist unification, proxy URL hardening, local token handling, and clipboard audit.
- **Security scan round 2**: `docs/SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md` — additional scan pass covering Rust audit tooling, SAST, CI permissions, sebuf wildcard CORS fallback, relay preview-origin/bypass risks, Linux WebKit sandbox exceptions, update manifest verification, and API test gaps.

## Orchestration Layer (UI + Wiring)

Four panels stitch the foundation services into product surfaces:

- **`src/components/CommandCenterPanel.ts`** — gameplan's top-of-app surface. Shows current personal risk, top 3 things that matter (sorted by criticality + severity), what to watch next, and recommended actions. Reads from `getFeatureHealthRegistry()` + `getPanelHealthRegistry()` + `getNotificationTraceRegistry()` and feeds them through `aggregateSystemHealth()`.
- **`src/components/SystemDiagnosticPanel.ts`** — tabbed Overview / Features / Panels / Notifications / Feeds / Self-Test surface. The Self-Test tab fires `runSelfTests(standardSelfTestDefinitions(...))` and renders pass/warn/fail/skipped per probe. Auto-refresh 5 s.
- **`src/components/AlgorithmDiagnosticPanel.ts`** — per-algorithm hit rate, weighted hit rate, latency, and Safe Adjustment proposal (apply / noop / at_bound / manual_review / no_tunable). Reads from `getAlgorithmEvaluationLedger()` + `getAlgorithmDefinitions()`.
- **`src/components/ShortageRadarPanel.ts`** — sorted-by-risk view across the 8 commodity models (wheat, corn, rice, soybeans, diesel, gasoline, natural-gas, jet-fuel). Each card shows tier, confidence, top 3 drivers, data gaps, horizon. Hosts can call `panel.setRequests(...)` to inject live inputs.

Singleton state lives in `src/services/diagnostics/diagnostics-state.ts` and `src/services/algorithms/algorithms-state.ts` — every panel reads the same registries.

Notification wiring (`src/services/insights/notification-ladder.ts`) bridges Big Event Detector → Notification Trace Registry → notification rung. Records the full lifecycle (created → urgency → relevance → dedupe → quiet hours → rung). Safety-critical events override quiet hours; non-safety events get suppressed.

Replay fixtures (`src/services/ops/replay-fixtures-catalog.ts`) ship five missed-event cases (late severe wind, silent tornado polygon, fuel-stress late, quiet-hours suppression, ADS-B outage) with stable timestamps so the harness can prove regressions.

### Personal + provider + share + ask layer (gaps #5, #11–14)

Five additional pure-deterministic services close the gameplan's product-experience gaps:

- **`src/services/personal/personal-impact.ts`** — Personal Impact Engine. Maps incoming events to the user's saved-places, watchlist, portfolio, travel routes, and utility dependencies. Produces `PersonalImpact` rows across five categories (`immediate_risk` / `financial` / `travel` / `utility` / `family_place`) plus a `dormant` bucket for sub-floor signals.
- **`src/services/diagnostics/provider-redundancy.ts`** — Provider Redundancy Health. Per-domain verdict (`redundant_agreement` / `redundant_disagreement` / `single_source` / `primary_down_with_backup` / `all_down`) with a `confidenceMultiplier` downstream scoring should apply. `provider-redundancy-view.ts` builds a renderable view-model (label/tone/corroborating-source count) — surfaced in the SystemDiagnostic **Feeds** tab as the "Source corroboration" section.
- **`src/services/insights/share-packet.ts`** — Shareable Intelligence Packets. Wraps the existing presentation-export helpers (markdown / clipboard / share-sheet / Claude debug) into one `buildSharePacket()` call that bundles provenance + diagnostics appendices.
- **`src/services/insights/ask-the-data.ts`** — Ask-The-Data structured query. Six recognized intents (why_high_risk / what_changed / who_disagrees / what_raises_confidence / what_to_watch / late_warning) each return a deterministic answer + structured evidence rows + follow-up questions.
- **`src/services/insights/insights-state.ts`** — singleton wiring for the active situation, personal profile, recent events, and provider snapshots so Command Center reads them through one entry point.

Action Briefs (`reaction-playbooks.ts` + `action-briefs.ts`) are now rendered inside the Command Center when an active situation is set via `setActiveSituation()`.

### Replay harness + ADS-B aggregator + data bridge (final gaps)

- **`src/services/ops/replay-harness.ts`** — runs `ReplayFixture[]` through the four expectation kinds (`warning_before_impact`, `no_silent_signal`, `requires_confirmation`, `user_action_observed`) and produces a deterministic pass/fail report. Combines with `replay-fixtures-catalog.ts` to prove "Crystal Ball would warn earlier next time".
- **`src/services/insights/data-bridge.ts`** — bridges live data into the insights state singleton: `bridgeWeatherAlertsToInsights()` translates `WeatherAlert[]` into `IncomingEvent[]` + sets the highest-severity-near-saved-place alert as the active situation; `bridgeSourcesToProviderRedundancy()` translates `SourceDiagnostic[]` into provider snapshots; `bridgeSavedPlacesToProfile()` + `adaptExistingSavedPlace()` install the user's saved places. Wired into `src/app/data-loader.ts` (weather refresh) and `src/app/panel-layout.ts` (boot + 30s provider tick).
- **`src/services/adsb/adsb-aggregate.ts`** — pure deterministic merger over OpenSky/ADSBExchange/Wingbits snapshots. Per-aircraft confidence (1 provider 0.55, 2 providers 0.85, 3+ 0.95) with linear decay after 60 s + cap 0.6 when every contributing provider is degraded. Status verdict: `healthy` / `degraded` / `silent`.

### Native macOS polish (gap #4)

`src/styles/macos-native.css` ends with a section scoped to `body.is-desktop-macos` that retreats the four new panels (Command Center / System Diagnostic / Algorithm Diagnostic / Shortage Radar) with native dark surfaces, segmented-control tabs, accent-colored primary buttons, inspector-drawer hover treatment, and toolbar-style headers with backdrop blur. `prefers-reduced-motion` disables the transitions.

### Diagnostic scripts

- `npm run docs:check` runs `scripts/check-docs-freshness.mjs` to flag README/docs that are out of step with the source (panel counts, secret-key counts, etc.).
- `npm run cross-check` (alias `cross-agent:check`) runs `scripts/cross-agent-check.mjs` to identify the required cross-agent reviewer for the current branch (Claude → Codex, Codex → Claude). The `.github/workflows/cross-agent-review.yml` workflow blocks merge of `claude/*` / `codex/*` / `copilot/*` branches without a recorded cross-agent review.
- `src/services/diagnostics/pipeline-trace.ts` — fact lifecycle registry tracking each `traceId` through stages `ingested→scored→clustered→evaluated→routed|dropped`; `stalled()` surfaces entries stuck in mid-flight.
- `src/services/diagnostics/degradation-alerts.ts` — pure detector: compares two `SystemHealthReport` snapshots, emits `DegradationAlert` for feature healthy→degraded/unsafe, panel →stale/failing, and unsafeSuppressions increase. Safety-critical alerts have `safetyCritical: true`.

### Home Shell (Phases 1-3 of the UI re-imagination — see docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md)

`src/components/HomeShellOverlay.ts` — the DEFAULT opening surface since Phase 2 for the full
desktop variant: reparented map canvas + three briefing bands + pinned panel Deck + status
ribbon. Gate: `src/services/home-shell/shell-gate.ts` (non-full variants and ≤768px viewports
always classic; opt out with `classicView=true` in console → `crystalball-classic-view=1`; the
Phase-1 key `crystalball-home-shell` is no longer consulted). ⌘⇧O toggles whenever the gate is
on; Esc exits to classic view. Read-only consumer of the what-changed store (CommandCenterPanel
is the single snapshot writer). Phase 2 added `src/config/panel-metadata.ts` (406 panels → 8
Library domains, seeded by `scripts/generate-panel-metadata.mjs`, hand-curated since — note
`panels.ts:80` defines two panels on one line, defeating line-anchored counting),
`src/components/LibraryOverlay.ts` (`cb:toggle-library`, 📚 topbar button, available in classic
too), and ⌘K v2 (metadata tags, weighted ranking, `place:<id>` commands via
`src/services/command-palette/place-commands.ts`). Deck pins persist at `crystalball-deck-pins`.
Phase 3 added the situation dossier (`src/components/SituationDossier.ts`, `cb:open-dossier`):
evidence composed via `evidenceFor` metadata (PlaybookCategory-keyed), honest why-surfaced from
pipeline/notification traces, action brief + timeline rail, context-free ask bar. Entry:
critical-band briefing rows, ⌘K 'Dossier: <title>', map fly via `cb:map-focus`.

## Foundation Intelligence Layers

Four pure-deterministic, fixture-tested service layers. **No DOM, no fetch, no globals — input-output pure. 600+ unit tests.**

- **`src/services/intelligence/`** — explainable scoring foundation. Every score has a `ConfidenceBreakdown`, every claim has provenance via `EvidenceNode/Edge`, contradictions surface separately rather than averaging away. Exported types (`NormalizedFact`, `TruthScore`, `Situation`, `CompoundRiskResult`, `RelevanceResult`, etc.) are the contract for downstream consumers.
- **`src/services/weather/`** — saved-place-aware NWS pipeline. `matchAlertToPlace` does point-in-polygon + UGC zone fallback. `urgencyFor` produces the delivery rung + meaningful-change repeat-suppression interval. `buildStormModePayload` produces the Storm Mode card. `diagnoseAlert` walks the 7-stage pipeline trace for "why didn't I get warned?".
- **`src/services/insights/`** — UX scaffolding. `detectBigEvent` runs the 8-trigger taxonomy. `computeDigest` produces the What Changed Digest. `buildActionBrief` reads from a 10-category playbook library. `toMarkdown` / `toClipboardSummary` / `toShareSheetText` / `toClaudeDebugPacket` format any briefing.
- **`src/services/shortage/`** — 8 deterministic commodity forecast models. Each takes a `ShortageInputBag` (provenance-aware), runs through 7 driver buckets (production / inventory / transport / policy / demand / price / cross_domain), produces a `ShortageForecast` with drivers + confidence + data gaps. Seasonal multipliers honor the calendar.
- **`src/services/datacenter/`** — single-site data-center readiness layer. Fuses EIA grid signals + NWS polygon alerts into a 5-rung `DcLevel` posture with a compound amplifier and people-first `ReadinessAction` playbook (onsite_safety → commute_staffing → facility_ops → escalation). Stale inputs are surfaced, not silently dropped.

Test scripts: `npm run test:intelligence` / `test:weather` / `test:insights{,2,3,6}` / `test:shortage` / `test:datacenter` / `test:providers`.

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
npm run smoke                # three-tier smoke test: replay baseline + pipeline invariants + sidecar probe
npm run smoke:offline        # same but skips live sidecar probe (safe in CI / offline)
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
    mode-manager.ts         # AppMode: ghost | gods-vision (manual only; null = default)
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
    intelligence/momentum.ts                 # rate-of-change / slope / volatility — fast shock scores higher than slow climb
    intelligence/learned-cascades.ts         # mine (domainA→domainB, lag) from event history; registerLearnedCascadePairs() augments compound-risk
    intelligence/proxy-outcomes.ts           # infer resolved_true/false from downstream proxy signals → resolve calibration where ground truth is scarce
    intelligence/ood-decay.ts                # out-of-distribution confidence decay (distance-from-training + sparse-coverage penalty)
    shortage/cross-domain-coupling.ts        # active intelligence cascades → shortage cross_domain drivers (war→port-closure boosts grain export risk)
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
    # ── Data-center readiness ──
    datacenter/datacenter-types.ts           # DcLevel ladder, mapThreatLevelToDc, ReadinessAction, SiteConfig, PowerPosture, WeatherPosture, DataCenterPosture
    datacenter/power-posture.ts              # computePowerPosture: utilization % + grid alerts + nearby outages → PowerPosture
    datacenter/weather-posture.ts            # computeWeatherPosture: NWS polygon match + Storm Mode → WeatherPosture with arrival window
    datacenter/readiness-actions.ts          # buildReadinessActions: people-first playbook (onsite_safety/commute_staffing/facility_ops/escalation)
    datacenter/datacenter-posture.ts         # computeDatacenterPosture: fuses power+weather, compound amplifier, stale-input honesty, headline
    datacenter/site-resolver.ts              # resolveSiteConfig (highest-priority data_center place) + eiaRegionForLatLon
    datacenter/datacenter-state.ts           # singleton: setDatacenterSite / getDatacenterSite / recomputeDatacenterPosture / subscribe
    datacenter/datacenter-view.ts            # pure label/color/summary helpers for renderers
    # ── Provider registry + fusion core (see docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md) ──
    providers/provider-types.ts              # ProviderDefinition, FetchOutcome, ProviderHealth, SourceObservation, FusionResult
    providers/provider-registry.ts           # static catalog (live sources + P0 expansion batch), independence groups
    providers/provider-health.ts             # pure record/derive: ring buffer → healthy/stale/degraded/down + quota detection
    providers/source-fusion.ts               # freshness × reliability × independence-aware corroboration; disagreements surface, capped at 0.6
    providers/provider-bridge.ts             # snapshotsFromRegistry (+ optional fingerprints) → provider-redundancy ProviderSnapshot contract
    providers/providers-state.ts             # singleton: recordProviderFetchOutcome / getProviderHealthState
    providers/provider-domain-map.ts         # fact-type → provider ids + tolerance + match window (FUSION_DOMAINS). matchBy: 'spatial'|'key'; toleranceMode: 'absolute'|'relative'
    providers/fusion-ingest.ts               # ingestDomain(): match same-fact observations across providers → fuse + per-provider fingerprint (Phase 0 keystone)
    providers/fusion-publish.ts              # singleton (domain-agnostic): fetchers call recordDomainObservations(providerId,...); domain derived from FUSION_DOMAINS; overlays fingerprinted snapshots for every ACTIVE fused domain onto the redundancy report
    providers/provider-health-timeline-view.ts # pure: ProviderHealthState.outcomes[id] ring buffer → windowed timeline (dots + windowed success rate) for the SourceConfidencePanel provider-health strip
    airquality/airquality-fusion-observations.ts # Open-Meteo + OpenAQ readings → DomainObservation[] (AQI), 2nd fused domain
    market/crypto-fusion-observations.ts     # exchange prices → DomainObservation[] (price, matched by symbol/key, relative tolerance), 3rd fused domain
    market/coingecko-fetch.ts + coinbase-fetch.ts # no-key fail-closed fetches — the 2 crypto sources (Coinbase, not Binance: 451 in US)
    market/stock-fetch.ts                    # fail-closed Yahoo (no-key) + Finnhub (keyed) fetches — the 2 stock sources (4th fused domain, own 'equities' domain)
    diagnostics/source-confidence-view.ts    # pure: composes assessProviderRedundancy() + provider-health-timeline-view into per-domain cards (fusion-active vs SPOF, live disagreement flags, per-provider health) for SourceConfidencePanel
    # Fused domains: earthquakes (USGS+EMSC, spatial) + air_quality (Open-Meteo+OpenAQ, spatial) + crypto (CoinGecko+Coinbase) + stocks (Yahoo+Finnhub), the last two key/relative. data-loader feeds them; Command Center / System Diagnostic show "verified by N independent sources".
    # `src/components/SourceConfidencePanel.ts` (Phase 1 UI, panel id `source-confidence`) is the dedicated per-domain redundancy surface — SystemDiagnostic's Feeds tab still shows the compact "Source corroboration" summary, this panel is the full drill-down (per-provider health timeline + live disagreement flags + FUSED/SPOF tags). Widening fusion to more domains + closing the cataloged SPOFs (Workstream B) is still open — see the spec's "Phase 1 status" note.
    # See docs/superpowers/specs/2026-06-28-redundancy-prediction-enhancement-program-design.md + plans/2026-06-28-phase0-fusion-ingest-earthquakes.md
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

Mode is **manual only**. `AppMode` is `'ghost' | 'gods-vision'`; `null` is the
default (no special mode) state. The former auto-triggered modes
(peace/finance/war/disaster) have been removed — their behaviors are inlined
into the default state. The old no-op evaluators (`evaluateWarThreat`,
`evaluateFinanceTrigger`, `evaluateDisasterTrigger`, etc.) have been deleted
entirely; data feeds still flow but no longer drive mode transitions.

| Mode | Trigger |
|------|---------|
| default (`null`) | no special mode |
| Ghost | Manual only — ⌘⇧G / sidebar / File menu |
| God's Vision | Manual — the God's Eye 3D globe view |

Ghost Mode: polling ×5 (`getGhostRefreshMultiplier()`), analytics suppressed, notifications suppressed, dark crimson sidebar.

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

API keys entered via gear icon → API Keys tab. Almost all of the 77 supported keys use standard provider env-var names (ANTHROPIC_API_KEY, GROQ_API_KEY, etc); the only app-branded key is `CRYSTALBALL_API_KEY`. The authoritative list is `SUPPORTED_SECRET_KEYS` in `src-tauri/src/main.rs`.

## Secret Scan Guardrail

Mandatory repo secret scan enforcement in hooks and CI. This is a user-owned repo on GitHub — provider-native secret validity checks and non-provider patterns don't cover everything on their own, so the compensating control is mandatory repo-level scanning. Keep `npm run secrets:scan:staged` and `npm run secrets:scan` active and passing.
