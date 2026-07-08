# Changelog

All notable changes to Crystal Ball are documented here.

## [Unreleased]

### Added

- **Source Confidence Panel (Redundancy + Prediction Enhancement Program,
  Phase 1 UI slice)**: a new dedicated diagnostics surface
  (`src/components/SourceConfidencePanel.ts`, panel id `source-confidence`)
  showing per-domain source redundancy at a glance — which domains are
  multi-source "FUSED" and agreeing, which are actively disagreeing, which
  are single-provider "SPOF"s, and which are fully down — plus a per-provider
  drill-down (health level, rolling success rate, last-success age, fact
  fingerprint, and a fetch-outcome timeline sparkline). Built on two new pure
  view-model modules: `src/services/providers/provider-health-timeline-view.ts`
  (windows a provider's fetch-outcome ring buffer into a renderable timeline)
  and `src/services/diagnostics/source-confidence-view.ts` (composes the
  existing `assessProviderRedundancy()` engine + the timeline view into the
  panel's exact shape, flagging the odd-fingerprint-out provider in a live
  disagreement — only when a fingerprint holds a strict majority; a 3-way
  split or an even tie has no verified "correct" provider to exempt, so
  every fingerprinted provider is flagged instead). No new scoring math —
  both modules reshape the already-tested `provider-redundancy.ts` /
  `provider-health.ts` / `fusion-publish.ts` engines. 14 new fixture tests.
  Registered in
  `panels.ts` and instantiated in `panel-layout.ts` under the `intelligence`
  category. Workstream A widening (fusion beyond the current 4 domains) and
  Workstream B (closing the cataloged single-source-of-failure domains) are
  explicitly out of scope for this UI-focused slice — the panel surfaces
  today's real gaps (`single_source` / `redundant_unverified`) rather than
  papering over them.
- **Cognition benchmark + CI gate (Cognitive Enhancement PR 16 — final PR of
  the 16-PR stack)**: `npm run bench:cognition` replays a frozen 12-window
  fixture corpus (`cognition/__bench__/golden-windows.ts`, spanning conflict /
  markets / cyber / weather / shortage / maritime / aviation / general) through
  the full deterministic pipeline — episodic recall → base rate → aggregation
  → recalibration → conformal interval, plus a held-out schema-matching stage
  reusing PR 8's consolidation clustering — and prints Brier score, conformal
  coverage, analog-recall precision@5, schema true-positive rate, and p50/p95
  latency (`cognition/bench-cognition.ts`). A committed baseline
  (`cognition/bench-baseline.json`) gates regressions: fails on Brier
  regression > 0.02 absolute or conformal coverage dropping more than 5 points
  below target (`cognition/bench-baseline.ts`). Wired as a new step in
  `.github/workflows/smoke.yml`, fully offline and fixed-seed — runs in
  single-digit milliseconds, so it cannot become a slow or hanging CI step.
  17 new tests in `bench-cognition.test.mts`. (PR #1373)
- **Self-tuning cognition (Cognitive Enhancement PR 12)**: the cognition
  layer is now plugged into the self-improvement machinery. Eight cognition
  constants became bounded tunables (episodic minSim, analog blend
  pseudo-count, calibration shrinkage prior, extremization k, spread-skip
  threshold, entity heat half-life, interest decay half-life, consolidation
  cluster threshold) read via the tunable-params store with the historical
  values as defaults. Five cognition outputs (episodic-analog,
  recalibration, superforecast, operator-ranking, entity-trajectory) are
  registered algorithms with deterministic outcome grading
  (`cognition/self-tuning.ts`: resolved episodes, resolved calibration
  records, retrospective trajectory replay, hypothesis-resolution operator
  grading) and a Page-Hinkley drift watch (`cb:cognition-drift`) on a
  6-hour cadence. Below-floor cognition algorithms get bounded
  safe-adjustment proposals gated by a new episodic-analog minSim
  safety-fixture suite; every other cognition knob fails closed to
  operator approval. (PR #1357; compute-placement/hygiene follow-up
  landed as PR #1372)
- **Weather PR 5 — Personal Storm Mode UI**: the persistent severe-weather
  strip + Storm Mode card now honors the full plan contract — acknowledge and
  snooze persist to localStorage (`crystalball-storm-mode-ui-v1`) so an acked
  threat stays dismissed across reloads until it materially changes
  (escalation, outside → inside polygon, or polygon edge ≥ 5 km closer,
  mirroring `weather-urgency.ts`), the strip self-clears at alert expiry, and
  only payload-bearing (banner+) decisions activate it. Pure show/hide +
  display logic extracted to `src/components/personal-storm-mode-view.ts`
  (24 tests, wired into `npm run test:weather`), with a desktop-native
  restyle in `macos-native.css` under `body.is-desktop-macos`. (PR #1374)
- **Surfacing Move 2 — cognition layer visibility**: forecast provenance,
  calibration report, and booting the learning loops (PR #1339).
- **Ask the data in Command Center**: the deterministic ask-the-data engine is
  now user-reachable — question input, grounded answer packet, evidence rows,
  and follow-up chips, fed by the live feature/panel/mission registries
  (`insights/ask-context.ts`).
- **Superforecast on demand in AnalystHUD**: "∑ Superforecast" runs the
  superforecaster pipeline per hypothesis (budget-gated, hidden in Ghost Mode)
  and shows probability, conformal interval, and estimate provenance; each run
  pushes a live-vs-shadow pair so `cognition:shadow-report` gets real data.
- **Replay baseline self-test probe**: the System Diagnostic Self-Test tab now
  runs the missed-event replay catalog against the committed baseline — the
  same guarantee CI's smoke tier 1 gives, now visible in-app.

### Performance

- **Cognition compute placement + memory hygiene (Cognitive Enhancement
  PR 14)**: consolidation's periodic clustering pass now runs via
  `requestIdleCallback` with a visibility guard (`cognition/idle-scheduler.ts`)
  instead of synchronously on its cadence timer, so it never competes with a
  rendered frame and is skipped outright while the tab is hidden. A new
  content-hash embedding memo (`cognition/embedding-cache.ts`, cap 5,000,
  persisted to `reasoning_memory`) means episodic-memory's `recall()` and
  `recordEpisode()` no longer re-embed identical text every analyst cycle —
  including a real pre-existing waste where a standing pending hypothesis
  was re-embedding its own summary every ~5 minutes only to be discarded by
  the signature-dedupe check. Episodic memory also gained contradiction
  flagging: episodes whose backing explanation is refuted by
  competitive-hypothesis resolution are excluded from *supportive* analog
  scoring while remaining fully retrievable with the contradiction surfaced
  in their explanation string (`markEpisodeContradictory`,
  `contradictEpisodesForRefutation`, wired via a new injectable
  `onHypothesisRefuted` hook on `situation-hypothesis-bridge.ts`). (PR #1372)
- **CI: unref the multi-theater dedupe timer** — `military-surge.ts` scheduled
  a dedupe-cache cleanup via a 4-hour `setTimeout` that was never unrefed,
  keeping any Node test process alive for the full 4 hours once a test
  exercised that path. This had been silently hanging the `Smoke` workflow's
  `test:renderer` step for weeks (~4h/run, ~40% failure rate). Fixed with the
  same typeof-guarded unref pattern used elsewhere in the codebase; the full
  536-file/11,900+-test `test:renderer` suite now completes in under a
  minute. (PR #1371)

### Removed

- **No-op mode evaluators**: deleted the six dead auto-trigger evaluator stubs
  (`evaluateWarThreat`, `evaluateFinanceTrigger`, `evaluateCommodityTrigger`,
  `evaluateDisasterTrigger`, `checkFinanceAutoTriggerTimeout`,
  `reloadConflictBaselines`) and their 14 dead call sites in the data loader.

- **Phase 4B — Epistemic intelligence wiring**: bias scan cadence, the epistemic
  calibration loop (outcome-graded, wired to boot), and the epistemic bridge
  connecting meta-confidence, counterfactuals, and the bias detector to the live
  data path (PRs #1131, #1132, #1133).
- **Phase 3 (start) — Feed resilience P0**: rolled `fetchWithFallback` to 5 P0
  feeds (GDACS, NHC, disease, tsunami, FIRMS), added the BDI live feed and the
  earthquake mission bridge, and completed the daily PDF brief (PRs #1140, #1139,
  #1143, #1142).

### Performance

- **NWS in-flight dedupe** and **poweroutage cache TTL**: collapse concurrent
  duplicate NWS requests and bound poweroutage payload lifetime (PRs #1129, #1130).

### Fixed

- **Performance sprint**: panel lifecycle teardown on `destroy()` and the Groq
  egress-disclosure gate (scoped to desktop, honors local-only in the sidecar)
  (PRs #1135, #1136).
- **Tooling**: ESLint scope fix and sidecar routes classification (PRs #1145, #1146).

### Security

- **AppImage WebKit sandbox posture (R2-SEC-008)**: disabling the bubblewrap
  sandbox inside an AppImage now logs a loud stderr warning and can be refused
  with `CRYSTALBALL_KEEP_WEBKIT_SANDBOX=1`.
- **cargo-deny in CI (R2-SEC-001)**: new `cargo-deny` job enforcing a
  crates.io-only source policy and duplicate-version visibility
  (`src-tauri/deny.toml`); advisories remain owned by cargo-audit.
- **Wildcard-CORS policy test (R2-SEC-010)**: any literal
  `Access-Control-Allow-Origin: *` in `api/` without a `PUBLIC_WILDCARD_CORS`
  justification comment now fails CI.
- **Security sprint (2026-06-12)**: Privacy Fix 1 — secret-in-query tripwire that
  warns when an API key would be sent in a query string to a non-allowlisted host
  — and removal of the `RELAY_ALLOW_ANON` anonymous-relay bypass (PRs #1138, #1144).

## [2.25.143] - 2026-06-08

### Fixed

- Entity heat rail Apple-style chips with softer labels and no borders
- Staleness banners redesigned with Apple-style dismiss, dedupe, and auto-clear
- Triage dismiss button per pill and stop cyber scenarios on weather
- Collapsed same-title same-source alerts into one story
- Nominatim throttle repair and cancel stale searches
- Test harness: ml-worker stub, missing gods-vision layers, panel category map, README inventory count

## [2.25.24] - 2026-05-25

### Added

- GlobalMigrationCrisisPanel with five sections: Active Displacement Crises,
  Border Pressure Monitor, Camp & Settlement Status, Repatriation & Resettlement,
  and Regional Displacement Index. Badge count reflects critical camps (>=120%
  capacity) + high-tension borders (level >= 3) + live HIGH/CRITICAL observations.
  Refreshes every 5 minutes. Built with h()/replaceChildren() DOM builders.
- global-migration-crisis-helpers.ts: pure helper functions (migrationSeverityColor,
  causeLabel, causeIcon, trendArrow, trendColor, tensionColor, tensionTierLabel,
  capacityStatusLabel, capacityStatusColor, campCapacityColor, programStatusLabel,
  programStatusColor, formatDisplacedCount, formatBeneficiaries, criticalCampCount,
  activeBorderCrisisCount, totalDisplacedMillions) and static data (DISPLACEMENT_CRISES,
  BORDER_PRESSURE_POINTS, CAMP_STATUSES, REPATRIATION_PROGRAMS,
  REGIONAL_DISPLACEMENT_INDEX) — all side-effect-free and unit-tested.
- 87 pure-logic tests, ESLint clean, typecheck clean.

## [2.25.23] - 2026-05-25

### Added

- PoliticalRiskSuperpowerPanel with five sections: Coup & Regime Change Watch,
  Election Risk Tracker, Protest & Civil Unrest, Sanctions & Diplomatic Crisis,
  and Governance Stability Index. Badge count reflects high/critical instability
  events. Refreshes every 3 minutes.
- political-risk-superpower-helpers.ts: pure helper functions (politicalSeverityColor,
  eventTypeLabel, riskScoreTier, riskScoreColor, responseLabel, responseColor,
  crisisTypeLabel, governanceColor, governanceTier, formatTimeAgo, instabilityCount)
  and static data (COUP_WATCH, ELECTION_RISKS, PROTEST_EVENTS, DIPLOMATIC_CRISES,
  GOVERNANCE_INDEX) — all side-effect-free and unit-tested.
- 73 pure-logic tests, ESLint clean, typecheck clean.

## [2.25.22] - 2026-05-21

### Added

- Nuclear/radiological mission bridges: INES-graded facility incidents
  (NuclearIncidentBridge), radiation releases by dual dose-rate + area axes
  (RadiationReleaseBridge), and nuclear/radiological threat intelligence with
  [NUCLEAR]/[RADIOLOGICAL] prefix (NuclearThreatBridge). All self-register at
  module load. INES 7→4/5-6→3/3-4→2/1-2→1 via Math.max with event type tier.
- 72 pure-logic tests, ESLint clean, typecheck clean.

## [2.25.18] - 2026-05-20

### Added

- `IntelligenceDigestService` class (v2): aggregates raw domain observations into
  structured `DigestEntry` objects with top threats, per-domain highlights, trend
  changes, and recommended focus. Injectable providers, clock, and storage for
  deterministic tests. Singleton via `getInstance()` / `resetForTests()`.
- New exported types: `ThreatSummary`, `DomainHighlight`, `TrendChange`, `DigestEntry`,
  `DigestObservation`, `DigestObservationProvider`, `IntelligenceDigestServiceOptions` (v2)
- Constants: `DIGEST_ENTRY_KEY = 'wm-intelligence-digest'`, `MAX_ENTRIES = 100`
- 40 new pure-logic tests for `IntelligenceDigestService` (73 total in suite)

## [2.25.16] - 2026-05-20

### Added

- Financial superpower panel: deepest intelligence view for economic threats
  — Market Stress Gauge (0–100 composite: equity vol, credit spreads, FX pressure)
  — Crash Signal Tracker (drawdown events by index/region with phase labels)
  — Credit Contagion Map (sovereign/corporate CDS leaders, regional risk tiers)
  — Currency Crisis Watch (devaluations >5%, trajectory, capital controls badge)
  — Systemic Risk Indicators (interbank stress boosted by live channel data, CB decisions)
- 49 new pure-logic tests added to financial-superpower-panel.test.mts (91 total)

## [2.25.13] - 2026-05-19

### Added

- Energy/infrastructure mission bridges: power outages (NERC/EIA tiers), pipeline disruptions, refinery incidents (62 tests)
- Conflict domain mission bridges: ACLED fatalities (with event-type floor), armed group movements, ceasefire violations (68 tests)

## [2.25.12] - 2026-05-19

### Added

- Counterfactual replay engine rewrite: spec-compliant domain-override engine
- Mode system visual states: Normal/Elevated/Crisis/Blackout CSS tokens + ModeManager
- Relay CORS security tightening: owner-anchored patterns + bypass flag (R2-SEC-006/007)

## [2.25.11] - 2026-05-19

### Added

- Cyber mission bridges: CVE/KEV, threat-intel, breach-intel, infra-attacks (59 tests)
- Geopolitical mission bridges: ACLED, OFAC SDN, GDELT (PR #625)
- Health mission bridges: CDC wastewater, WHO surveillance, biosurveillance (PR #623)
- Weather mission bridges: NWS alerts, NHC cyclones, NIFC wildfire incidents
- Maritime superpower panel: deep-intelligence view for maritime domain
- Seismic superpower panel: deep-intelligence view for seismic/disaster domain
- Fixed `cross-domain-contradiction-detector` and `aviation-superpower` category registration

## [2.24.0] - 2026-05-18

### Changed

- Version bump for release packaging.

## [2.23.0] - 2026-05-18

### Changed

- Version bump for release packaging.

## [2.22.0] - 2026-05-17

### Added

- **Situation Lifecycle Tracker**: state-machine lifecycle management for tracked situations (open → confirmed → resolved → archived).
- **Global Rhythm Engine (panel)**: circadian/weekly/seasonal baseline visualization showing anomalies against expected patterns.
- **Compound Event Detector**: detects when simultaneous events in separate domains cross a combined severity threshold.
- **Source Credibility Tracker**: per-source reliability score derived from outcome calibration and cross-source disagreement history.
- **Mission Control Dashboard**: unified operator surface — live source health, active situations, alert rung, and action queue in one view.
- **Evidence Chain Builder**: directed evidence-to-claim graph builder with transitivity inference and contradicting-evidence surfacing.
- **Trade Route Risk Scorer**: per-chokepoint shipping disruption risk (12 routes including Suez, Hormuz, Bosphorus, Malacca, Panama, Black Sea).
- **AssumptionTracker v2**: full register / confirm / violate / expire lifecycle replacing the static v1 annotation approach.
- **Intelligence Index**: full-text in-memory index over active intelligence items with field-weighted scoring.
- **Persistent Query Engine**: saved query definitions that re-run on every data cycle and push delta results to subscribers.
- **Alert Escalation Service**: automatic severity-rung escalation when an alert exceeds its acknowledgment window.
- **Watch Area Alerting**: polygon-based watch regions that generate proximity alerts as tracked entities enter or exit.
- **Intelligence Briefing Export**: structured multi-format briefing export (Markdown, clipboard, share-sheet, Claude debug packet) from any situation set.
- **Analyst Notebook**: persistent freeform note layer attached to hypotheses and situations; survives across sessions via IDB.
- **Trust Budget Service (v2 panel)**: per-domain alert-quota self-throttle panel backed by the trust-budget service.
- **Geospatial Clustering**: DBSCAN-style geographic clustering of active events with live cluster centroid and severity rollup.
- **Intelligence Loop Orchestrator**: master scheduling loop that sequences observe → correlate → explain → learn stages with backpressure.
- **Threat Correlation Matrix**: n×n domain correlation heat-map showing which domain pairs are co-activating above baseline.
- **Intelligence Health Monitor**: aggregate health score across all intelligence pipeline stages with per-stage pass/warn/fail verdict.
- **Operator Shift Report**: end-of-shift structured summary: top events, open situations, notable correlations, recommended handoffs.
- **Feed Watchdog**: per-feed staleness monitor with configurable max-age and alert-rung escalation on timeout.
- **Situation Priority Queue**: priority-sorted queue of active situations based on compound severity, confidence, and personal relevance.
- **Signal Enrichment Service**: contextual enrichment layer that appends geolocation, entity resolution, and historical precedent to raw signals.
- **Temporal Anomaly Detector**: statistical detection of events that deviate from domain-specific time-of-day and day-of-week baselines.
- **Geopolitical Event Calendar**: structured feed of known scheduled geopolitical events (elections, OPEC meetings, summits) used as forward context for anomaly detection.
- **Alert Deduplication Service**: suppresses near-duplicate alerts within a configurable time window using signature hashing.
- **Counterfactual Reasoning Service (panel)**: user-facing panel for the counterfactual engine — "what would have to be true for this to be wrong?"
- **Competitive Hypothesis Engine (panel)**: renders 2–3 competing explanations per active situation with confidence bars.
- **Domain Scorecards (panel)**: per-domain A–F grade panel consolidating outcome quality, accuracy, and feed health.

## [2.21.0] - 2026-05-16

### Added

- **Trust Budget**: per-domain alert-quota self-throttle driven by outcome calibration; domains that over-fire are automatically rate-limited.
- **Competitive Hypothesis Engine**: generates 2–3 competing explanations per Situation so operators surface alternative hypotheses before anchoring.
- **Counterfactual Reasoning**: "what would have to be true for this to be wrong?" structured adversarial framing for every active situation.
- **Domain Scorecards**: per-domain A–F grade consolidating outcome quality, accuracy, and feed health into a single actionable metric.
- **Cognitive Bias Detection**: anchoring, availability, confirmation, and overconfidence bias flags applied to hypothesis ranking.
- **Active Learning Queue**: surfaces highest-uncertainty claims for human review using a claim/resolve/skip/expire state machine.
- **Backtest-Before-Apply Gate**: validates algorithm parameter changes against historical outcomes before allowing them to take effect.
- **Meta-Confidence Layer**: confidence-in-the-confidence estimate; flags cases where the scoring inputs are themselves uncertain.
- **Improvement Scheduler**: 8-task-type scheduler (60s loop) that queues algorithm tuning, data-gap fills, and recalibration jobs.
- **Multi-Agent Review Service**: 6-perspective panel (analyst / skeptic / pragmatist / devil's advocate / optimist / historian) reviewing each situation.
- **Quality Debt Tracker**: 6-category weighted quality-debt score tracking deferred calibration, stale baselines, and coverage gaps.
- **Autonomous Repair Engine**: detects known failure signatures and proposes or applies pre-approved parameter corrections automatically.
- **Model Governance Service**: model cards for 14 intelligence algorithms with approval status, version, and risk tier.
- **Mission Ledger Bridge**: closes the learning loop by writing confirmed outcomes back to the algorithm evaluation ledger.
- **Failure Prediction Engine**: predicts which pipeline stages are at elevated failure risk based on recent error rates and upstream health.
- **Counterfactual Replay Engine**: 4 built-in replay templates (missed tornado, late flood, silent cyber, ignored satellite) for regression proofing.
- **Contradiction Detector**: 5 conflict types (source disagreement, temporal reversal, geographic mismatch, severity inversion, polarity flip) surfaced per situation.
- **Operational Playbook Engine**: 6 domain-specific playbook templates with step-tracking, completion state, and shift-handoff export.
- **BacktestGate**: pre-apply safety gate that blocks algorithm changes failing a minimum historical-accuracy threshold.
- **CivilizationPulse Engine**: composite real-time global health score aggregating domain pressures, active situations, and baseline deviations.
- **Notification Provenance Service**: full causal chain for every delivered alert — source → correlation → urgency rung → quiet-hours check → delivery.
- **Crisis Signature Library**: pattern fingerprinting for 8 recurring crisis types (Gulf closure, pandemic surge, grid cascade, etc.) enabling early pattern matches.
- **Crisis Trajectory Projector**: 6/24/72h situation evolution projections using momentum, domain dependencies, and historical trajectories.
- **GlobalRhythmEngine (service)**: circadian/weekly/seasonal baselines per domain derived from rolling historical windows.
- **World Narrative Engine**: template-based global situation synthesis producing a human-readable paragraph summarizing the current world state.
- **Recovery Modeling Engine**: post-event recovery curve tracking per region/domain using exponential-recovery fit against baseline.
- **Domain Dependency Graph**: cross-domain cascade risk mapping across 26 directed edges and 11 domains.
- **Collection Gap Discovery**: systematic observability audit identifying 6 gap types (no source, stale source, single source, low confidence, no baseline, no correlation rule).
- **Regional Resilience Index**: per-region crisis recovery scoring derived from recovery curves and historical crisis frequency.
- **Situation Timeline**: chronological view of all tracked situations with type filter, domain filter, and duration/severity stats.
- **Behavioral Response Model**: population stress-response curve tracking — maps domain severity to expected public-behavior pressure.
- **Saved places proximity filter**: saved places used as a first-class 500 km proximity filter across all intelligence scoring.
- **CausalChainBuilder**: directed cause→effect graph built from correlation edges, enabling multi-hop impact tracing.
- **Intelligence Digest Service**: structured 1h/6h/24h intelligence compilation summarizing top events, open situations, and notable anomalies.
- **ThreatHorizonScanner**: 24/48/72h emerging threat detection using trajectory projections and domain-dependency cascade modeling.
- **Safety Case Dashboard**: 8 safety properties (single trustworthiness screen) with live coverage and pass-rate monitoring.
- **Shadow Mode Algorithm Service**: runs experimental algorithm variants in parallel with production, promoting when accuracy exceeds threshold.
- **ExperimentManager**: A/B framework for algorithm variants with assignment, exposure tracking, and outcome comparison.
- **MetaConfidenceCalibrationService**: binned reliability tracking — groups confidence estimates into deciles and measures per-decile accuracy.
- **CognitiveBiasDetector (panel)**: renders bias flags per hypothesis with explanations and correction suggestions.
- **NotificationHistoryPanel (backed by provenance)**: full provenance + suppression audit trail rendered in a scrollable panel.
- **ActiveLearningQueue (panel)**: operator-facing queue of highest-uncertainty claims awaiting confirmation or dismissal.

### Fixed

- Deduplicate keychain and location permission requests to exactly one each at startup.
- Phase 0 release blockers: GDACS crash guard, sidecar route audit sync, CHANGELOG sync.

## [2.20.0] - 2026-05-15

### Added

- **Driver-based scoring** (PR #475): evidence-weighted severity engine that replaces the legacy threshold math — every score now carries a per-driver breakdown the panel can render.
- **Learn stage — outcome feedback loop** (PR #481): user actions (dismiss / acted-on / escalated / confirmed-real / false-positive) feed a per-domain calibration that recommends attention multipliers.
- **Evidence graph traversal** (PR #483): typed-edge BFS / DFS, shortest path, and confidence propagation over the situation evidence graph.
- **Panel lens** (PR #484): context-sensitive panels focus on the currently-active Situation when one is set.
- **Assumption tracking** (PR #485): every model output is annotated with the assumptions + confidence it depended on.

## [2.19.0] - 2026-05-14

### Added

- **Notification history panel** (PR #477): full provenance + suppression audit trail for delivered notifications.
- **What Changed v2** (PR #478): world-state diff engine with typed deltas, replacing the v1 string-diff approach.
- **Situation Store v2** (PR #480): named Situations aggregated from correlated cross-domain signals, with a stable evidence graph.

### Changed

- **Native macOS chrome** (PR #476): window-vibrancy `HudWindow`, transparent titlebar overlay, traffic-light safe-zone CSS. Preserves existing decorations to keep traffic lights visible.

## [2.18.0] - 2026-05-13

### Added

- **Entity registry** (PR #468): canonical identity layer across ships, aircraft, people, and organizations so cross-domain signals can resolve to a single actor.
- **Explain stage** (PR #467): "why this alert" explanations attached to every notification.
- **Observation adapters** (PR #469): all feeds normalize to a single `ObservationEvent` schema at the boundary.
- **Correlate stage** (PR #470): cross-domain signal joining with 8 built-in correlation rules.
- **Progressive disclosure** (PR #471): summary → detail → raw layering at every panel level.
- **Notification settings UI** (PR #472): per-domain mute / threshold / channel controls.

## [2.17.0] - 2026-05-13

### Added

- **Intelligence Timeline** (PR #448): chronological intelligence ledger panel rendering the deduped event stream.
- **Operator Mode** (PR #449): dense layout variant with watch regions, mute controls, and shift handoff export.
- **Scenario Replay** (PR #450): replay engine + five built-in disaster fixtures so the harness can prove regressions deterministically.
- **Evidence Graph UX** (PR #451): confirming/contradicting sources surfaced separately with a per-claim confidence breakdown.
- **Personal Relevance Layer** (PR #452): watchlist, interests, and travel-window scoring fused into a single "should I care?" filter.
- **Alert Trace pipeline tracer** (PR #454): "why did/didn't I get warned?" 7-stage explainer for any alert id.
- **SMS Command Interface** (PR #459): inbound `CB STATUS`, `BRIEF`, `WATCH`, `ALERT`, `SITREP` over an SMS/iMessage gateway, with tier-aware allowlist + rate limit + audit log.
- **Self-Test Runner + mission state** (PR #460): one-button domain smoke test panel; `getMissionState(report)` maps a report to `nominal` / `reduced` / `degraded` / `critical` with top-priority life-safety override.
- **Shortage Radar UI** (PR #461): sorted-by-risk view across the 8 commodity forecast models with per-card drivers and data gaps.
- **Command Center polish** (PR #462): top-of-app surface tightened — top 3 things that matter, recommended actions, what-to-watch-next.
- **Diagnostic Export enhancement** (PR #464): export bundle now ships per-domain mission state and the self-test report.
- **⌘K Command Palette** (PR #465): keyboard-driven panel + action launcher across the full inventory.

### Changed

- **Release blockers cleared** (PR #455): GDACS render crash boundary fixed, sidecar route audit caught up, panel counts synced, ESLint scope, API key catalog reconciled at 68 keys.
- **Notification all-producers tests** (PR #463): producer registry now has end-to-end coverage across all rungs.

## [2.16.0] - 2026-05-12

### Added

- **App mode system** (PRs #415–#420): four explicit operating modes — Monitoring (default radar / panel grid), Alert (severity-promoted view with audible cues), Investigation (drill-down with cross-referenced situations and entity graph), Briefing (read-only, presentation-ready). Mode persists across sessions and gates UI affordances (auto-refresh interval, notification rung, alert-overlay density).
- **Intelligence fabric** (PRs #421–#430): Situation Store + detection engine + dedicated panel; prioritize stage with saved-places proximity filter; act stage with per-domain response playbooks; cross-domain correlator-v2 with causal chain detection across 7 domain-transition rules; evidence graph + driver-based severity scoring; custom alert rules engine with IF/THEN builder; supply chain disruption tracker (ports, canals, BDI); infrastructure risk matrix (power, BGP, CISA KEV, ACLED); briefing scheduler + Brief Settings UI; PDF brief export covering correlations, shortage, and personalized alerts.
- **UX layer** (PRs #432–#435): unified visual semantics (design tokens, severity / domain badges), Intelligence Feed panel (live chronological stream), shortage radar UI (commodity overview panel + alert wiring).
- **Reliability** (PR #436): feed resilience — circuit breaker + fallback source rotation + health tracker, surfaced in the Feed Health panel.

### Changed

- **Version bump to 2.16.0** (PR #441) — wires the new intelligence fabric, app modes, and security hardening into the desktop bundle.

### Security

- **CSP audit + sidecar CORS hardening** (PR #439): documented `unsafe-eval` constraint imposed by Cesium 1.140.0 with explicit removal criteria; tightened the sidecar `crystalball.app` glob to an enumerated five-host set; restricted `localhost` / `127.0.0.1` CORS reflection to known dev-server ports (3000, 1420, 5173, 46123, port-80 bare). New `docs/CSP_AUDIT.md` is the standing audit record.
- **Tauri secret IPC scoped** (PR #438): replaced the `get_all_secrets` IPC with a per-key `get_secret(key)` call gated by an explicit allowlist; updater manifest verification now checks SHA-256 hashes before applying.
- **Linux WebKit sandbox re-enabled + verify audit CI integration** (PR #437).

## [2.15.0] - 2026-05-12

### Added

- **Cross-domain correlation engine v2** (`src/services/intelligence/correlator-v2.ts`): Causal chain detection across 7 domain-transition rules (seismic cascade, wildfire cascade, hurricane cascade, cyber cascade, conflict cascade, maritime-economic, aviation-conflict). Configurable time windows per transition pair (15 min for seismic → tsunami, 6 hr for weather → supply chain, 24 hr for conflict → displacement). Confidence scoring blends spatial overlap, temporal proximity, and entity match; degrades 0.1 per domain hop with a 0.3 floor. Event-level de-duplication merges overlapping chains by keeping the stronger one. Exports `CorrelatorV2`, `startV2Cycle()`, `stopV2Cycle()`, `getActiveChains()`, `getCorrelationsForEvent()`.
- **Correlation Map panel** (`correlation-map`, category: `intelligence`): Shows active correlation chains as a sortable list with chain-type badge, confidence bar, event count, and domain icons. Click to expand individual events in a chain. 30 s auto-refresh from sidecar.
- **Sidecar endpoints**: `POST/GET /api/intelligence/correlations/chains` — renderer pushes v2 chain snapshots; `GET /api/intelligence/correlations/event/:id` — chains containing a specific event.
- **34 unit tests** (`src/services/intelligence/__tests__/correlator-v2.test.mts`): chain detection, confidence math, time-window boundaries, de-duplication, cross-domain pairs, module-level singleton, and backward-compat `toCorrelations()`.

## [2.14.0] - 2026-05-11

### Added

- **Volcano Monitor panel** (`volcano-monitor`): USGS VHP hazard-level feed + Smithsonian GVP weekly bulletin RSS merged into a single status view. Sidecar endpoint `GET /api/volcanoes/status` (30 min cache). Panel groups non-NORMAL volcanoes by Warning / Watch / Advisory with aviation color badges. Globe layer `volcanoMonitor` adds colored billboard markers.
- **Severe Weather / SPC panel** (`severe-weather`): SPC Day 1 convective outlook risk level + NWS active tornado and severe thunderstorm warnings. Sidecar endpoints `GET /api/weather/spc-outlook` (30 min) and `GET /api/weather/active-warnings` (2 min). Panel shows outlook risk bar + live warning counts. Globe layer `severeWeatherPolygons` renders NWS warning polygons.
- **ShakeAlert + USGS ShakeMap panel** (`shakealert`): USGS FDSN M4.5+ events from the past 7 days filtered to those with ShakeMap products. Sidecar endpoint `GET /api/earthquakes/shakemap-events` (30 min cache). Panel lists events with magnitude, MMI intensity label, and ShakeMap availability. Globe layer `shakemapOverlay` adds MMI-colored earthquake markers.
- **Sidecar parity tests**: 41 new deterministic unit tests across three new `.test.mjs` suites covering all sidecar helper functions for the three panels.

## [2.10.22] - 2026-05-01

## [2.10.21] - 2026-05-11

### Added

- **Performance and crash diagnostics** (`src/services/log-bridge.ts`): 100-entry breadcrumb ring buffer (log + longtask + slow-refresh + memory + visibility + network + INP + fetch-burst categories). `PerformanceObserver` for long tasks >100 ms and INP `event` entries >200 ms. Memory watchdog samples `performance.memory` every ~60 s and warns above 70% heap usage. Visibility / online / offline breadcrumbs. `window.onerror` and `unhandledrejection` now attach the last 10 breadcrumbs to crash reports. `Cmd+Shift+D` diagnostics copy includes the last 30 client-side breadcrumbs alongside the Tauri bundle.
- **Fetch failure tracker**: per-host ok/fail counters with 5-minute rolling window; warn breadcrumb on 5+ failures-in-5min for any host. `getFetchFailureSummary()` exported for diagnostic bundles.
- **Panel crash isolation** (`src/components/Panel.ts`): `setContent` now wraps `innerHTML =` in try/catch and renders an error-fallback card on failure so one bad panel can't cascade. Added cached `lastAppliedContentHtml` so the DOM read for no-op detection is skipped across ~226 panels. Added `invalidateContentCache()` escape hatch for subclasses that mutate `this.content` directly.
- **Rate limiting for `api/claude-agent.js`**: Upstash sliding window, 10 req/min/IP. Fails open on Upstash outage so Redis blips don't wedge the endpoint.
- **Bundle-size CI guard**: `scripts/check-bundle-size.mjs` + `npm run bundle:check` + `.github/workflows/bundle-size.yml`. Limits: 350 KB main entry / 800 KB per chunk / 6 MB total gzipped.
- **Engines + Node pin**: `.nvmrc` + `"engines": { "node": ">=22.0.0 <23.0.0" }` so dev/CI/sidecar all match.
- **Loader module split**: `src/app/loaders/{space,disease,hazards,utility,cyber}.ts` extracted from `src/app/data-loader.ts`. `src/app/layout/html.ts` extracted from `src/app/panel-layout.ts`. Together these shrink the monoliths by ~500 lines.

### Changed

- **CORS allowlist tightened**: `api/_cors.js` and `server/cors.ts` — dropped the over-permissive `^https://crystal-ball[a-z0-9-]*\.vercel\.app$` pattern that matched any third-party Vercel project. Patterns now require a trusted username suffix.
- **Edge-function timeouts**: `api/newsapi-headlines.js` and `api/newsdata-feed.js` now use `AbortSignal.timeout(10_000)` so slow upstreams can't wedge the full Vercel 30 s limit.
- **Release tooling multi-variant restored**: `scripts/release-metadata.mjs`, `release-prepare.mjs`, `release-manifest.mjs`, `desktop-package.mjs` now support all three variants (full/tech/finance), matching the build pipeline. `canonicalReleaseAssetName` normalizes the macOS `Crystal.Ball_…` dot form to the canonical space form.
- **Release-integrity workflow**: per-variant `release-doctor` steps; PRs soft (`--allow-existing-target-release`), main pushes strict.
- **build-desktop workflow**: `workflow_dispatch` inputs now expose a variant choice (full/tech/finance) labeled "Build-only variant"; publishing stays tag-driven.

### Fixed

- **XSS in `PlaybackControl.ts:267`**: replay-narrative bullets were interpolated into `innerHTML` without escaping. Now passes through `escapeHtml()`.
- **Tauri `log_frontend` UTF-8 panic**: byte-slicing at 1,000 bytes could panic mid-codepoint on emoji/non-ASCII messages. Switched to the existing `truncate_to_bytes` helper.
- **Log injection in `append_desktop_log`**: CR/LF characters in frontend-supplied messages could forge additional log entries. Now stripped before `writeln!`.
- **GPS IPC missing trusted-window gate**: `get_native_location` (CoreLocation) did not call `require_trusted_window` unlike every other sensitive Tauri command. Added the gate.
- **URL parameter smuggling in `api/story.js`**: social-crawler meta response interpolated query params without URL-encoding. Now uses `URLSearchParams`.
- **Test harness for Edge-runtime API handlers**: `mockReq` now returns a real `Request` and `invokeHandler` mirrors the returned `Response` into a Node-style `res` so characterization tests assert against real Edge semantics. 33/36 → 36/36 API tests passing.
- **Flush-stale-refreshes unit test**: previously eval'd TS method body as plain JS and choked on type annotations. Rewritten to import the real `RefreshScheduler` class via tsx. 7 subtests recovered.

### Security

- **Dependency overrides** (`package.json`): forced `protobufjs ^7.5.5` and `dompurify ^3.4.0` via overrides to close the transitive CVEs from `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs` and `cesium / posthog-js → dompurify`. `npm audit: 0 vulnerabilities`.

## [2.10.21] - 2026-04-28

Backfilled placeholder for the 2.10.21 release tag (cut without a CHANGELOG entry). The substantive changes shipped in this version are captured under [Unreleased] above and were promoted via patch bumps between 2.10.5 and 2.10.21. See `git log v2.10.5..v2.10.21` for the per-commit history.

## [2.10.5] - 2026-04-18

### Added

- **CLI Intelligence Toolkit** (`tools/mcp-server/`): 11 new MCP tools (30 total) across 4 phases:
  - **Foundation tools**: `query_raw` (direct sidecar endpoint access with pagination), `chain_query` (multi-step queries with `$prev[N].field.path` cross-references), `compare_snapshots` (structured diffs showing appeared/disappeared items).
  - **Intelligence tools**: `correlate` (cross-domain entity matching across conflicts/markets/cyber/weather/military/health), `trend` (time-series analysis from sentinel history snapshots), `anomaly_scan` (deviation detection vs historical baselines).
  - **Stateful tools**: `watchlist_manage`/`watchlist_check` (persistent tracking of IPs, tickers, regions, CVEs, vessels, callsigns with change detection), `alert_rules_manage`/`alert_check` (threshold-based alerts with gt/lt/gte/lte/eq/ne/contains operators).
  - **Help tool**: Built-in man pages for all 30 tools, 5 conceptual topic guides, 4 example cookbooks. `help()` for index, `help({ tool })` for man pages.
  - **Correlation engine** (`correlation.mjs`): Entity extraction across 6 domains, set-intersection joining, overlap scoring.
  - **Storage module** (`storage.mjs`): File-based JSON persistence under `~/.crystal-ball/` for sentinel snapshots, watchlists, and alert rules.
  - **4 new slash commands**: `/sentinel` (scheduled intelligence sweep with snapshot diffing and alert generation), `/correlate` (interactive cross-domain analysis), `/watchlist` (watchlist and rule management), `/alerts` (alert viewing and management).
  - **CB-Control alert push** (`tools/cb-control/server/alerts.mjs`): Real-time alert broadcasting to subscribed Claude sessions via WebSocket with severity/domain filtering.

- **Enhanced `/sitrep` intelligence brief** (`.claude/commands/sitrep.md`): Full-spectrum presidential-style daily brief replacing the 4-line stub. 3-phase intelligence cycle: Phase 1 parallel fan-out across all MCP tools with `summary_only`, Phase 2 triage & entity enrichment (lookup_flight, lookup_vessel, lookup_cve, lookup_ip) on elevated signals only, Phase 3 analyst-voice synthesis. 15-section fixed structure: Source Status, Local Conditions, BLUF, Conflicts & Security, Military Posture, Threat Landscape, Cyber, Markets & Economy, Sanctions, Weather & Space Weather, Seismic, Infrastructure, Health, News Wire, Nexus. Personalized via user profile (home location, platforms, watchlist tickers, interests) with `★ PERSONAL:` flags on relevant items. Cross-domain Nexus section connects signals across military, economic, cyber, and environmental domains. Degraded feeds marked with `⚠ DATA DEGRADED` inline.

- **API Diagnostic service + panel** (`api-diagnostic.ts` + `ApiDiagnosticPanel`): Live per-source health (healthy / degraded / failing / silent / unknown) pulled from `dataFreshness`, circuit breakers, and `offline-staleness`. Per-source drill-down with live probe button for 6 whitelisted upstream endpoints (NWS, USGS, GDACS, Open-Meteo, RainViewer, NOAA SWPC). Copy-to-clipboard diagnostic export. Attaches `window.cbDiag` helper with `report()`, `ping()`, `text()`, `source(id)` methods for browser-devtools troubleshooting.
- **News translation** (`news-translation.ts`, TODO-012): On-demand per-headline translation with djb2-hashed localStorage cache (7-day TTL, 500-entry cap). Uses existing summarization provider chain (Ollama → Groq → OpenRouter → browser T5) via `translateText()`. Non-blocking; needsTranslation() gate prevents unnecessary LLM calls.
- **PWA offline staleness banner** (`offline-staleness.ts` + `OfflineStalenessBanner`, TODO-018): Fixed-position `z-index:100000` banner (red/blinking) that is IMPOSSIBLE to dismiss while data is stale. 4-tier status (fresh / stale / very-stale / offline). Label format: "⚠ CACHED DATA — LAST UPDATE 14h AGO / NOT CURRENT. VERIFY BEFORE OPERATIONAL USE." Addresses the "stale intel is misleading intel" concern head-on.
- **UNHCR displacement integration** (`unhcr-displacement.ts`, TODO-020): Country-level refugee/asylum/IDP counts from UNHCR Population API. 24-hour cache TTL. ISO-3 → ISO-2 converter using existing `country-geometry.ts` helper with 20-country fallback. `classifyDisplacementSeverity()` thresholds (critical ≥1M, high ≥250k, moderate ≥50k).
- **A11y baseline framework** (TODO-019): Playwright + axe-core ratchet spec at `e2e/a11y-baseline.spec.ts`; fails CI only when a panel's violation count increases vs `e2e/a11y-baseline.json`. Scans 8 panels (dashboard root, insights, alert-center, unified-alert-inbox, correlation-matrix, strike-packages, markets, live-news). `UPDATE_A11Y_BASELINE=1` regenerates. Documented in `docs/A11Y_BASELINE.md`.
- **API handler test scaffold** (TODO-004): 18 per-handler `.test.mjs` files under `api/__tests__/` using Node's built-in test runner. Shared mocks (`mockReq`, `mockRes`, `mockFetch`) in `_test-utils.mjs`. Idempotent `_scaffold-generator.mjs` regenerates missing tests. `npm run test:api` wired.
- **Viable server-side RSS aggregation** (`api/news-aggregate.js`, TODO-002): Hybrid scaffold with graceful client fallback — never a hard dependency. Edge-cacheable (Vercel `s-maxage=120, stale-while-revalidate=300`), Redis write-through best-effort, variant-aware query (`?variant=full|tech|finance|happy`), `?since=` incremental support returning 304 when no newer data. Rate-limited (60 req/min/IP via Upstash). Full design rationale in `docs/TODO_002_RSS_AGGREGATION_DESIGN.md` including SPOF mitigation and 8-step rollout per `docs/REFACTOR_SAFETY.md`.
- **Strike package intelligence** (`strike-package.ts` + `StrikePackagesPanel`): Detects coordinated military aircraft formations (offensive-strike, CAP, ISR, tanker-bridge, humanitarian, training) from live flight data. Clusters within 150km, classifies by role mix, scores threat 0-100 weighted by package type, size, 11 sensitive airspace zones (Persian Gulf, Taiwan Strait, Ukraine, Korean Peninsula, etc.), coalition composition, and altitude profile. Critical packages in sensitive airspace trigger native notifications.
- **Alerts Enhancement Roadmap shipped** (Phases 0-3):
  - **P0.2 Relevance scoring** (`relevance-scoring.ts`): 0-100 composite score from severity × proximity × freshness × novelty × source_trust.
  - **P1.1 Near-Me filter** (`near-me-filter.ts`): NearMeMode (off/near-me/strict), distance stamping, user-location hint fallback.
  - **P1.2 Situation clustering** (`situation-clustering.ts`): Alert-centric lightweight Situation grouping by <100km / <6h / category overlap, with escalating/stable/de-escalating trend classification.
  - **P1.3 Alert archive** (`alert-store.ts`): Added `archiveAlert`, `getArchivedAlerts`, `getAlertTrendStats` (with % delta vs prior window), `pruneOldAlerts`. 30-day IndexedDB retention preserved.
  - **P2.1 Multi-location watchlist** (`multi-location-watchlist.ts`): `WatchedLocation` with `kind` (primary/secondary/travel) and `radiusKm`, CRUD, findNearestLocation, tagAlertWithNearest.
  - **P2.2 Alert rules engine** (`alert-rules-engine.ts`): User-defined IF/THEN rules with 6 operators (equals/contains/gte/lte/in/within-km), priority-sorted evaluation, 5 preset rules (Earthquake Watcher, Storm Chaser, Conflict Monitor, Financial Alert).
  - **P2.3 Action response cards** (`action-cards.ts`): 14 category-specific action checklists with immediate/short-term items, sourced from FEMA/NOAA/CDC/CISA public safety guidance.
  - **P3.2 Escalation lifecycle** (`escalation-lifecycle.ts`): LifecyclePhase (emerging/active/peak/de-escalating/resolved), auto-resolve after 12h idle, severity-transition notifications, 15-minute reassessment loop.
- **Webhook dispatcher** (`webhook-dispatcher.ts`): Outbound Slack/Discord/generic webhook delivery for critical signals. Severity filtering, 30s per-webhook rate limit, 5s timeout, subscribes to compound threats, strike packages, and critical anomalies.
- **Election calendar** (`config/elections.ts`): 27 upcoming elections across 27 countries with helpers `getElectionsInWindow`, `hasElectionSoon`. Wired into `country-instability.ts`: 1.3x information-component multiplier within 30 days of election, with `electionWindow` annotation on CountryScore for UI badging.
- **Stablecoin de-peg correlation signal** (`stablecoin-depeg-signal.ts`): Detects when a stablecoin deviates >0.5% from peg AND a country has CII > 70.
- **CII choropleth layer data** (`cii-choropleth.ts`): Country-level fill/line color mapping with red-yellow-green 0-100 scale, ready for deck.gl GeoJsonLayer.
- **Custom Tier 2 country watchlist** (`cii-custom-watchlist.ts`): User-defined additional CII monitoring targets with localStorage persistence.
- **Weather-threat convergence detection** (`weather-threat-convergence.ts`): New service that detects when severe weather events overlap geographically with existing conflict, infrastructure, or health threats. 11 weather-threat interaction rules with risk multipliers (heat+grid, hurricane+conflict, flood+industrial, drought+food, etc.).
- **Weather impact analysis** (`weather-impact.ts`): Scores severe weather against 30+ critical infrastructure points (military bases, maritime chokepoints, power grid hubs, population centers, agricultural regions). Generates `DisruptionSignal`-compatible outputs for the supply-chain-impact service.
- **8 new weather cascade causal rules** in `alert-correlator.ts`: NWS→grid, NWS→comms-health, NWS→aviation-hazard, GDACS→maritime, earthquake→grid/comms-health (magnitude-scaled radius), cyclone→air-quality, disease→breaking-news.
- **8 new compound threat patterns** in `compound-threat.ts`: weather+conflict, flood+conflict, seismic+disease, wildfire+grid, weather+food, conflict+cyber (hybrid warfare), nuclear+conflict, weather+maritime.
- **2 new correlation signal types**: `sentiment_divergence` and `weather_correlation`, with full SignalContext entries and data fields (`sentimentScore`, `sentimentTrend`, `weatherEvent`, `weatherSeverity`, `impactedInfrastructure`).
- **Correlation matrix ingestion wiring** in `data-loader.ts`: Weather alerts, GDACS events, and compound threats now feed the region×domain correlation matrix (previously unwired).
- **Insights panel sections**: New "Weather-Threat Convergence" and "Matrix Hotspots" sections with scores and collocated threats. AI World Brief now receives weather context alongside military posture context.
- **Intelligence briefing enhancements**: AI prompt now includes weather-threat convergence zones and correlation matrix hotspots.
- **Correlation matrix drill-down UI**: Cells in `CorrelationMatrixPanel` are now clickable, revealing score, trend, event count, and last-updated details with a visual selection indicator.
- **Notification dispatcher expansion**: New `dispatchCompoundThreatAlert`, `dispatchAnomalyAlert`, `dispatchConvergenceAlert` methods. Data-loader subscribes to the anomaly engine so critical anomalies trigger native notifications. High-severity compound threats and convergence scores ≥70 auto-notify.
- **Anomaly detection expansion**: New helpers for ingesting weather alert counts, regional news volume, and correlation matrix global score for trend monitoring.

### Changed

- Removed the Claude agent surface from desktop/web runtime configuration, UI exports, and API routes to avoid direct Anthropic API-cost exposure in default app flows.
- Summarization provider chain now uses `Ollama -> Groq -> OpenRouter -> browser` without Anthropic dependencies in runtime settings or sidecar secret validation.

### Security

- Tightened API key policy for trusted browser origins: keyless access now applies to read-only requests only; non-read requests require `X-CrystalBall-Key`.
- Hardened RSS proxy ingress with explicit origin rejection, method allowlisting (`GET/OPTIONS`), and per-IP Upstash rate limiting.
- Release workflow now hard-fails publish builds on macOS when Apple signing secrets are missing.

---

## [2.7.2] - 2026-03-24

### Fixed

- CI typecheck compatibility for XML parser callbacks in aviation and arXiv ingestion paths, preventing release pipeline failures against stricter callback signatures.
- Release docs no longer pin stale download/version strings in README and docs badges.

### Changed

- Added release-doc sync regression coverage so docs and changelog stay aligned with `package.json` version updates.

---

## [2.7.4] - 2026-03-25

### Fixed

- Restored TypeScript QA gate compatibility by aligning `tsconfig.json` `ignoreDeprecations` with the shipped TypeScript compiler.
- Repaired release push guard compatibility so `scripts/release-doctor.mjs` accepts and honors remote selection from guarded pre-push flows.

### Changed

- Advanced desktop release metadata to `2.7.4` across Node and Tauri versioned files for a clean tagged release after post-`2.7.3` hardening fixes.

---

## [2.7.3] - 2026-03-25

### Fixed

- Release automation now triggers required pull request checks for the release branch before merge.

### Changed

- Version metadata was advanced to `2.7.3` across Node and Tauri release files to publish the repaired desktop release pipeline.

---

## [2.7.2] - 2026-03-24

### Fixed

- CI typecheck compatibility for XML parser callbacks in aviation and arXiv ingestion paths, preventing release pipeline failures against stricter callback signatures.
- Release docs no longer pin stale download/version strings in README and docs badges.

### Changed

- Added release-doc sync regression coverage so docs and changelog stay aligned with `package.json` version updates.

---

## [2.7.4] - 2026-03-25

### Fixed

- Restored TypeScript QA gate compatibility by aligning `tsconfig.json` `ignoreDeprecations` with the shipped TypeScript compiler.
- Repaired release push guard compatibility so `scripts/release-doctor.mjs` accepts and honors remote selection from guarded pre-push flows.

### Changed

- Advanced desktop release metadata to `2.7.4` across Node and Tauri versioned files for a clean tagged release after post-`2.7.3` hardening fixes.

---

## [2.7.3] - 2026-03-25

### Fixed

- Release automation now triggers required pull request checks for the release branch before merge.

### Changed

- Version metadata was advanced to `2.7.3` across Node and Tauri release files to publish the repaired desktop release pipeline.

---

## [2.7.2] - 2026-03-24

### Fixed

- CI typecheck compatibility for XML parser callbacks in aviation and arXiv ingestion paths, preventing release pipeline failures against stricter callback signatures.
- Release docs no longer pin stale download/version strings in README and docs badges.

### Changed

- Added release-doc sync regression coverage so docs and changelog stay aligned with `package.json` version updates.

---

## [2.7.0] - 2026-03-16

### Fixed

- Desktop release version syncing now updates and validates `package-lock.json` and `src-tauri/Cargo.lock`, preventing release doctor failures caused by partial version bumps.
- Desktop local-token generation now uses the `getrandom` 0.3 API (`fill`) so the Tauri Rust app compiles cleanly with the pinned dependency set.

### Changed

- Desktop app metadata advanced to `2.7.0` across the Node and Tauri release files.

---

## [2.6.1] - 2026-03-16

> This release supersedes an unpublished `v2.6.0` Git tag. The latest public GitHub release moves directly from `v2.5.25` to `v2.6.1`.

### Added

- **Claude Intelligence Agent panel** — new agentic panel powered by Anthropic's tool-use API. Ask natural-language questions; Claude autonomously calls live-data tools (news headlines via GDELT, country risk scores, market data, cyber threat IOCs) and synthesizes a structured intelligence brief. Accessible via the Intelligence category in the panel picker. Requires `ANTHROPIC_API_KEY`. Four preset queries provided for quick situational awareness.
- **Communications Health panel** — consolidated monitoring surface for internet outages, infrastructure incidents, and communications disruption signals.
- **Economic Stress panel** — composite stress view wired through the sidecar, panel layout, and data-loader for rapid macro deterioration checks.
- **Yahoo Finance → free data sources migration** — all sidecar routes now use Stooq batch CSV + FRED CSV, eliminating Yahoo Finance dependency entirely
  - `/api/market-quotes`: Stooq batch CSV (cl.f, gc.f, spy.us, qqq.us, etc.) + FRED VIXCLS for VIX
  - `/api/btc-etf-flows`: Stooq batch CSV for IBIT, FBTC, ARKB, BITB, HODL
  - `/api/macro-signals`: Stooq for BTC/QQQ/XLP/SPY/Gold price signals
  - `/api/fred-fallback`: FRED CSV (VIXCLS + FEDFUNDS) replaces Yahoo finance quotes
  - `/api/energy-fallback`: Stooq for WTI (cl.f) and NatGas (ng.f); FRED DCOILBRENTEU CSV for Brent crude
  - `/api/stock-chart`: Stooq daily historical CSV replaces Yahoo chart API
- **Comprehensive free-API fallbacks** for resilient data loading across markets, ETF flows, stablecoins, macro signals, and AI posture
- **API Keys UX overhaul** — prominent signup card for missing keys, grouped features by category, masked sentinel for stored password keys
- **Unified settings modal** — single modal for all entry points, removed duplicate settings mounts
- **Expanded FIRMS monitoring** — 18 global wildfire regions
- **Professional sound design** — replaced klaxons/sweeps with sine-wave alerts, overhauled all mode audio
- **Arrival Choreography** — canvas overlay for animated world events (wavefront ripple, corona pulse, global flare)
- **Shareable URL state** — LZ-compressed `?view=&zoom=&lat=&lon=&layers=&timeRange=` with `Cmd+S` shortcut
- **Ollama streaming** — real-time typewriter effect for AI panel summaries with Stop button
- **Natural Disaster Mode** — 4th monitoring mode with amber/orange theme, auto-triggers, and synthesized audio

### Fixed

- Desktop Anthropic secret support is now wired end-to-end across the Rust keychain vault, the local sidecar allowlist, and provider validation
- Release documentation now distinguishes between branch state, local packaging capability, and the latest published GitHub release artifacts
- Webcam iframes use `127.0.0.1` instead of `localhost` to satisfy CSP `frame-src`
- Window drag replaced CSS drag region with JS `startDragging()` for reliability
- Toolbar drag zones expanded to title, status, and clock elements
- Toolbar title renamed Crystal Ball → Crystal Ball

### Security

- Hardened desktop trust boundaries around local secret handling and sidecar validation paths
- Hardened secret detection, IndexedDB cap, idle throttle, AISSTREAM validation
- Fixed oscillator leak, Ghost Mode analytics gap, CSP, and proxy timeout
- Decompression bomb guard for URL state; OLLAMA_MODEL validation; arrival choreography memory caps

### Changed

- **Claude AI model upgraded to Sonnet 4.6** — Anthropic provider now uses `claude-sonnet-4-6` (released February 2026), replacing Haiku 4.5. Sonnet 4.6 offers improved reasoning, advanced coding assistance, and a 1M-token context window, making AI intelligence briefs and panel summaries significantly more capable.
- `src/services/oref-locations.ts` — 1,478 Hebrew→English location translations (cherry-picked from upstream)

### Upstream sync (cherry-picked from bradleybond512/crystal-ball)

- `8970335` fix: suppress map renders during resize drag
- `7c8943d` feat: add Iran & Strait of Hormuz zones, upgrade Ukraine polygon
- `697f334` fix: replace dead Tel Aviv live stream
- `cd86433` fix(oref): prevent LLM translation cache poisoning + add static Hebrew→English translations
- `1933b3a` feat(cmdk): disambiguate Map vs Panel commands + add Czech locale
- `58cb2b6` feat(cmdk): rotating contextual tips in empty state
- `f4e1159` feat(header): add Download App button for web users
- `bb31b43` feat(header): download dropdown + move system status into Settings (merged with API Keys tab)
- `8a41422` fix: harden Windows installer update path and map resize behavior

---

## [2.6.0] - Unpublished tag

> `v2.6.0` exists as a Git tag on GitHub but was never shipped as a proper GitHub release. Its releasable changes were rolled forward into `v2.6.1`.

---

## [2.5.25] - 2026-03-01

### Highlights

- **API Keys tab in Settings** — Desktop Configuration panel removed from sidebar; all API key management now lives in the gear-icon Settings modal under a new "API Keys" tab (matches original upstream fork design)
- **AI Summary button** — ✦ button added to every non-video panel header; calls the configured AI provider (Ollama / Groq / Claude) and overlays a contextual summary of current panel data
- **Immersive monitoring modes** — Peace / Finance / War modes now each carry a full visual theme (War: red alert with animated glow; Finance: green trading floor; Peace: clean default) plus distinct synthesized audio cues
- **Intelligent mode auto-triggers with deescalation** — War Mode now triggers on 5 signal types (hotspot escalation, military surge, geo convergence, velocity spike, keyword spike); Finance Mode triggers on S&P 500 ≥2.5%, BTC ≥5%, Oil ≥4%, or Gold ≥2% moves; both modes auto-restore to Peace after signals quiet down
- **Panel reordering on mode switch** — panels dynamically reorder when mode changes (war panels to top in War Mode, finance panels to top in Finance Mode); original order restored on Peace Mode
- **Mode-change sound design** — synthesized audio for each mode transition: War (staccato sawtooth alarm), Finance (ascending C-E-G chime), Peace (432 Hz resonant bell)
- **Apple-style map controls** — map layer panel, zoom buttons, time slider, and basemap selector redesigned with macOS frosted-glass aesthetic (dark translucent backgrounds, backdrop-filter blur, Apple system blue, rounded corners)
- **Basemap button layout** — Dark/Light/Satellite/Terrain now displayed in a 2×2 grid (previously 4 buttons in one cramped row)
- **Performance optimizations** — VirtualList ResizeObserver disconnected on destroy (memory leak fix), DeckGL theme color calculation cached (CPU reduction), 5 MB log rotation for desktop.log and local-api.log
- **i18n** — `tabApiKeys` translation added to all 18 locale files

### Added

- `src/services/sound-manager.ts` — Web Audio API synthesizer for mode-transition sounds; War (sawtooth alarm), Finance (sine arpeggio), Peace (resonant 432 Hz bell); lazy AudioContext init; mute toggle persisted in localStorage
- `src/services/mode-manager.ts` — `evaluateCommodityTrigger()`: Oil (CL=F) ≥4% or Gold (GC=F) ≥2% daily move triggers Finance Mode; `velocity_spike` and `keyword_spike` signal types added to War Mode detector; auto-deescalation: War Mode auto-restores to Peace after 20 min of zero signals; Finance Mode auto-restores after 60 min of calm markets; Finance Mode auto-trigger dispatches system notification
- `src/app/panel-layout.ts` — `_applyModePanelOrder()`: reorders sidebar panels on mode change; War panels to top (alert-center, cyber-threats, oref-sirens, etc.), Finance panels to top (crypto, markets, stablecoins, etc.); original order saved and restored on Peace Mode
- `src/styles/macos-native.css` — immersive War Mode theme (red sidebar gradient, animated top-line glow, red panel borders/headers, red toolbar title with text-shadow); Finance Mode theme (green equivalent); Peace Mode resets to default
- `src/components/UnifiedSettings.ts` — "API Keys" tab (desktop only); lazy-creates and mounts `RuntimeConfigPanel` in full mode inside the Settings modal
- `src/components/Panel.ts` — `getContentElement()` public accessor; `_runAiSummary()` / `_extractSummaryText()` methods; AI summary overlay with loading spinner, provider label, and close button; excludes `live-webcams`, `live-news`, `map` from AI button
- `src/app/data-loader.ts` — wires `evaluateCommodityTrigger()` after commodity data loads; wires `evaluateFinanceTrigger()` after crypto data loads
- `src/App.ts` — calls `initSoundManager()` during Phase 3 init
- `src/styles/main.css` — AI summary panel CSS (`.panel-ai-btn`, `.panel-ai-overlay`, spinner, result header); API Keys tab overflow scroll; Apple-style map control CSS with backdrop-filter blur and system blue accents
- All 18 locale files — `header.tabApiKeys` translated (ar, de, el, es, fr, it, ja, ko, nl, pl, pt, ru, sv, th, tr, vi, zh)

### Changed

- `src/App.ts` — removed force-enable block for `runtime-config` panel; added one-time migration to delete `runtime-config` from localStorage (panel moved to Settings modal)
- `src/app/panel-layout.ts` — removed `RuntimeConfigPanel` import, instantiation, sidebar ordering, and i18n special-case
- `src/app/event-handlers.ts` — removed `runtime-config` i18n special-case
- `src/config/variant.ts` — desktop runtime auto-corrects stale `'happy'` variant to `'full'` (prevents sidebar nav and mode buttons disappearing)
- `src/components/VirtualList.ts` — `ResizeObserver` stored as class field; disconnected in `destroy()` to prevent memory leak
- `src/components/DeckGLMap.ts` — module-level `_cachedTheme` variable; `getOverlayColors()` only recomputed when theme actually changes
- `src-tauri/src/main.rs` — `rotate_log_if_needed()` rotates desktop.log and local-api.log at 5 MB (3 backups each)
- Map basemap buttons layout: `display: flex` → `display: grid; grid-template-columns: 1fr 1fr`
- War Mode auto-trigger threshold lowered from 3 to 2 signals; signal set expanded from 3 to 5 types

### Removed

- `RuntimeConfigPanel` from sidebar (was position 1 with alert banner on desktop) — accessible via Settings → API Keys

---

## [2.5.24] - 2026-03-01

### Highlights

- **App Modes — Peace / Finance / War** — three monitoring lenses accessible from the macOS sidebar; War Mode auto-activates when 3+ conflict correlation signals are detected in a session
- **Auto War Mode trigger** — `hotspot_escalation`, `military_surge`, and `geo_convergence` signals feed a live threat score; threshold breach fires a native desktop notification and switches the UI to War Mode
- **Alert Family** — one-tap button in War Mode copies a pre-formatted safety message to the clipboard for sharing with family/friends
- **Code hardening** — World Bank cache eviction (prevents unbounded memory growth), AlertCenterPanel in-place array truncation, `fetchIndicator` wrapped in try/catch for graceful CORS/network failure handling
- **Satellite & terrain basemaps** — Esri World Imagery + label overlay and Esri World Topo Map available as base layer alternatives to the default dark/light styles, persisted across sessions
- **OSINT live channels** — S2 Underground, Task & Purpose, The War Zone, Military Summary added to the Intelligence & OSINT region of the Live News panel
- **CSS for 5 new panels** — SpaceWeather, DiseaseOutbreaks, AirQuality, CyberThreats, AlertCenter now have full severity-coded styling (previously rendered unstyled)
- **Dependabot** — weekly automated dependency scanning for npm, Cargo, and GitHub Actions

### Added

- `src/services/mode-manager.ts` — `AppMode` type (`peace | finance | war`), `getMode()`, `setMode()`, `initMode()`, `evaluateWarThreat()`, `alertFamily()`; persists to localStorage; dispatches `wm:mode-changed` and `wm:war-score` custom events
- Mode selector UI in macOS sidebar (above footer): 🕊 Peace | 💰 Finance | ⚔ War buttons with color-coded active states
- War Mode: red pulsing button, red sidebar accent border, red toolbar title
- Finance Mode: green sidebar accent border, green toolbar title
- Alert Family button appears in War Mode — copies ISO-8601 timestamped safety message to clipboard
- Threat score badge on War button (shows count/threshold when signals detected but not yet in War Mode)
- `evaluateWarThreat()` wired into all `addToSignalHistory()` call sites in data-loader.ts
- Satellite basemap (Esri World Imagery + Esri Reference Labels overlay) — `/map-styles/satellite.json`
- Terrain basemap (Esri World Topo Map) — `/map-styles/terrain.json`
- Basemap selector in the map layer panel (Dark / Light / Satellite / Terrain), persisted to localStorage
- S2 Underground, Task & Purpose, The War Zone, Military Summary YouTube channels with live detection + pinned video fallback
- Intelligence & OSINT region in Live News panel with `regionOsint` i18n key
- Full CSS styling for SpaceWeatherPanel, DiseaseOutbreakPanel, AirQualityPanel, CyberThreatPanel, AlertCenterPanel in `panels.css`
- i18n keys for all 6 new panel titles and OSINT region label
- `.github/dependabot.yml` — weekly scanning for npm, Cargo, GitHub Actions

### Fixed

- **Live News black screen** — embed URL changed from `http://localhost:PORT` to `http://127.0.0.1:PORT` to match Tauri CSP `frame-src http://127.0.0.1:*` (CSP treats them as different origins in WKWebView)
- AlertCenterPanel array truncation now mutates in-place (`splice(100)`) instead of creating a new array
- World Bank `fetchIndicator()` wrapped in try/catch — CORS or network failures now return null values instead of throwing
- World Bank profile cache evicts expired entries when it exceeds 250 entries (prevents unbounded memory growth)
- CHANGELOG updated with full release history for v2.5.22 and v2.5.23

---

## [2.5.23] - 2026-03-01

### Highlights

- **Space Weather Panel** — NOAA SWPC real-time Kp index, solar wind, Bz, X-ray flares, geomagnetic storm alerts
- **Disease Outbreaks Panel** — WHO Disease Outbreak News + ReliefWeb health situation reports, no API key required
- **Air Quality Panel** — Open-Meteo AQ API for 18 global cities, US EPA AQI scale, PM2.5/PM10/O3/NO2
- **Native macOS notifications** — osascript-based desktop alerts for critical/high breaking news events
- **Security hardening** — rate-limited notifications, HTTPS-only URL opening, bundle ID verification on updates, href injection fixes, tightened CSP

### Added

- Space Weather Panel with NOAA SWPC data: Kp index, solar wind speed/density, Bz IMF, X-ray flare class, active alerts
- Disease Outbreak Panel aggregating WHO DON JSON + ReliefWeb, deduplicated, severity-ranked
- Air Quality Panel with Open-Meteo AQ API, AQI color coding (Good → Hazardous), 18 global cities
- DesktopNotifications module — native macOS alerts via osascript for breaking news events
- CSS styles for all 5 new panels (Space Weather, Disease Outbreaks, Air Quality, Cyber Threats, Alert Center)
- `send_notification` Tauri command with 30-second rate limit and input length caps

### Security

- `open_url`: HTTPS-only enforcement, blocks loopback/LAN/`.local` addresses, 4096-char URL limit
- `install_update`: bundle identifier verification via `plutil` before overwriting `/Applications/Crystal Ball.app`
- `send_notification`: 30-second global rate limit, 128/256-char length caps, control character stripping
- `fetch_polymarket`: path traversal rejection, 2048-char params length limit
- CSP: added `object-src 'none'; base-uri 'self'; form-action 'self';`
- Fixed href injection in AlertCenterPanel, DiseaseOutbreakPanel, SecurityAdvisoriesPanel, MacroSignalsPanel, MapPopup

---

## [2.5.22] - 2026-03-01

### Highlights

- **Claude AI Intelligence Brief** — on-demand AI summarization of all active panels using Claude Haiku
- **Earthquakes Panel** — USGS real-time earthquake feed, M4.5+ globally with depth/magnitude coloring
- **ISW/GDACS feeds** — Institute for the Study of War daily situation reports + Global Disaster Alert feeds
- **Live Cyber Threat Map** — IOC visualization layer from Feodo, URLhaus, C2Intel, OTX, AbuseIPDB (500 IOCs, 15-min refresh)
- **Cyber Threats Panel** — sortable IOC table by severity, with type/country/source/age columns
- **Alert Center Panel** — persistent scrollable history of correlation signals and breaking alerts with unread badge
- **World Bank Country Profiles** — GDP, GDP/capita, military %, trade %, population injected into AI country intelligence context
- **Auto-update** — GitHub Releases API polls every 4 hours, `install_update` Tauri command handles DMG extraction

### Added

- Claude AI panel with on-demand intelligence brief (Haiku model, 15-min cache)
- Earthquakes Panel using USGS GeoJSON feed (M4.5+, 30-day window)
- ISW daily situational analysis and GDACS disaster alert feeds
- CyberThreatPanel: severity-coded IOC table (Feodo, URLhaus, C2Intel, OTX, AbuseIPDB)
- AlertCenterPanel: aggregates CorrelationSignals + BreakingAlerts with unread badge counter
- World Bank REST API service (`/v2/country/{iso}/indicator/{indicator}`) for country economic profiles
- Desktop auto-updater checking GitHub Releases every 4h (`install_update` Tauri command)
- Live cyber threat DeckGL ScatterplotLayer enabled by default (`VITE_ENABLE_CYBER_LAYER=true`)

---

## [2.5.21] - 2026-03-01

### Highlights

- **Iran Attacks map layer** — conflict events with severity badges, related event popups, and CII integration (#511, #527, #547, #549)
- **Telegram Intel panel** — 27 curated OSINT channels via MTProto relay (#550)
- **OREF Israel Sirens** — real-time alerts with Hebrew→English translation and 24h history bootstrap (#545, #556, #582)
- **GPS/GNSS jamming layer** — detection overlay with CII integration (#570)
- **Day/night terminator** — solar terminator overlay on map (#529)
- **Breaking news alert banner** — audio alerts for critical/high RSS items with cooldown bypass (#508, #516, #533)
- **AviationStack integration** — global airport delays for 128 airports with NOTAM closure detection (#552, #581, #583)
- **Strategic risk score** — theater posture + breaking news wired into scoring algorithm (#584)

### Added

- Iran Attacks map layer with conflict event popups, severity badges, and priority rendering (#511, #527, #549)
- Telegram Intel panel with curated OSINT channel list (#550, #600)
- OREF Israel Sirens panel with Hebrew-to-English translation (#545, #556)
- OREF 24h history bootstrap on relay startup (#582)
- GPS/GNSS jamming detection map layer + CII integration (#570)
- Day/night solar terminator overlay (#529)
- Breaking news active alert banner with audio for critical/high items (#508)
- AviationStack integration for non-US airports + NOTAM closure detection (#552, #581, #583)
- RT (Russia Today) HLS livestream + RSS feeds (#585, #586)
- Iran webcams tab with 4 feeds (#569, #572, #601)
- CBC News optional live channel (#502)
- Strategic risk score wired to theater posture + breaking news (#584)
- CII scoring: security advisories, Iran strikes, OREF sirens, GPS jamming (#547, #559, #570, #579)
- Country brief + CII signal coverage expansion (#611)
- Server-side military bases with 125K+ entries + rate limiting (#496)
- AVIATIONSTACK_API key in desktop settings (#553)
- Iran events seed script and latest data (#575)

### Fixed

- **Aviation**: stale IndexedDB cache invalidation + reduced CDN TTL (#607), broken lock replaced with direct cache + cancellation tiers (#591), query all airports instead of rotating batch (#557), NOTAM routing through Railway relay (#599), always show all monitored airports (#603)
- **Telegram**: AUTH_KEY_DUPLICATED fixes — latch to stop retry spam (#543), 60s startup delay (#587), graceful shutdown + poll guard (#562), ESM import path fixes (#537, #542), missing relay auth headers (#590)
- **Relay**: Polymarket OOM prevention — circuit breaker + concurrency limiter (#519), request deduplication (#513), queue backpressure + response slicing (#593), cache stampede fix (#592), kill switch (#523); smart quotes crash (#563); graceful shutdown (#562, #565); curl for OREF (#546, #567, #571); maxBuffer ENOBUFS (#609); rsshub.app blocked (#526); ERR_HTTP_HEADERS_SENT guard (#509); Telegram memory cleanup (#531)
- **Live news**: 7 stale YouTube fallback IDs replaced (#535, #538), broken Europe channel handles (#541), eNCA handle + VTC NOW removal + CTI News (#604), RT HLS recovery (#610), YouTube proxy auth alignment (#554, #555), residential proxy + gzip for detection (#551)
- **Breaking news**: critical alerts bypass cooldown (#516), keyword gaps filled (#517, #521), fake pubDate filter (#517), SESSION_START gate removed (#533)
- **Threat classifier**: military/conflict keyword gaps + news-to-conflict bridge (#514), Groq 429 stagger (#520)
- **Geo**: tokenization-based matching to prevent false positives (#503), 60+ missing locations in hub index (#528)
- **Iran**: CDN cache-bust pipeline v4 (#524, #532, #544), read-only handler (#518), Gulf misattribution via bbox disambiguation (#532)
- **CII**: Gulf country strike misattribution (#564), compound escalation for military action (#548)
- **Bootstrap**: 401/429 rate limiting fix (#512), hydration cache + polling hardening (#504)
- **Sentry**: guard YT player methods + GM/InvalidState noise (#602), Android OEM WebView bridge injection (#510), setView invalid preset (#580), beforeSend null-filename leak (#561)
- Rate limiting raised to 300 req/min sliding window (#515)
- Vercel preview origin regex generalized + bases cache key (#506)
- Cross-env for Windows-compatible npm scripts (#499)
- Download banner repositioned to bottom-right (#536)
- Stale/expired Polymarket markets filtered (#507)
- Cyber GeoIP centroid fallback jitter made deterministic (#498)
- Cache-control headers hardened for polymarket and rss-proxy (#613)

### Performance

- Server-side military base fetches: debounce + static edge cache tier (#497)
- RSS: refresh interval raised to 10min, cache TTL to 20min (#612)
- Polymarket cache TTL raised to 10 minutes (#568)

### Changed

- Stripped 61 debug console.log calls from 20 service files (#501)
- Bumped version to 2.5.21 (#605)

---

## [2.5.20] - 2026-02-27

### Added

- **Edge caching**: Complete Cloudflare edge cache tier coverage with degraded-response policy (#484)
- **Edge caching**: Cloudflare edge caching for proxy.crystalball.app (#478) and api.crystalball.app (#471)
- **Edge caching**: Tiered edge Cache-Control aligned to upstream TTLs (#474)
- **API migration**: Convert 52 API endpoints from POST to GET for edge caching (#468)
- **Gateway**: Configurable VITE_WS_API_URL + harden POST-to-GET shim (#480)
- **Cache**: Negative-result caching for cachedFetchJson (#466)
- **Security advisories**: New panel with government travel alerts (#460)
- **Settings**: Redesign settings window with VS Code-style sidebar layout (#461)

### Fixed

- **Commodities panel**: Was showing stocks instead of commodities — circuit breaker SWR returned stale data from a different call when cacheTtlMs=0 (#483)
- **Analytics**: Use greedy regex in PostHog ingest rewrites (#481)
- **Sentry**: Add noise filters for 4 unresolved issues (#479)
- **Gateway**: Convert stale POST requests to GET for backwards compat (#477)
- **Desktop**: Enable click-to-play YouTube embeds + CISA feed fixes (#476)
- **Tech variant**: Use rss() for CISA feed, drop build from pre-push hook (#475)
- **Security advisories**: Route feeds through RSS proxy to avoid CORS blocks (#473)
- **API routing**: Move 5 path-param endpoints to query params for Vercel routing (#472)
- **Beta**: Eagerly load T5-small model when beta mode is enabled
- **Scripts**: Handle escaped apostrophes in feed name regex (#455)
- **Wingbits**: Add 5-minute backoff on /v1/flights failures (#459)
- **Ollama**: Strip thinking tokens, raise max_tokens, fix panel summary cache (#456)
- **RSS/HLS**: RSS feed repairs, HLS native playback, summarization cache fix (#452)

### Performance

- **AIS proxy**: Increase AIS snapshot edge TTL from 2s to 10s (#482)

---

## [2.5.10] - 2026-02-26

### Fixed

- **Yahoo Finance rate-limit UX**: Show "rate limited — retrying shortly" instead of generic "Failed to load" on Markets, ETF, Commodities, and Sector panels when Yahoo returns 429 (#407)
- **Sequential Yahoo calls**: Replace `Promise.all` with staggered batching in commodity quotes, ETF flows, and macro signals to prevent 429 rate limiting (#406)
- **Sector heatmap Yahoo fallback**: Sector data now loads via Yahoo Finance when `FINNHUB_API_KEY` is missing (#406)
- **Finnhub-to-Yahoo fallback**: Market quotes route Finnhub symbols through Yahoo when API key is not configured (#407)
- **ETF early-exit on rate limit**: Skip retry loop and show rate-limit message immediately instead of waiting 60s (#407)
- **Sidecar auth resilience**: 401-retry with token refresh for stale sidecar tokens after restart; `diagFetch` auth helper for settings window diagnostics (#407)
- **Verbose toggle persistence**: Write verbose state to writable data directory instead of read-only app bundle on macOS (#407)
- **AI summary verbosity**: Tighten prompts to 2 sentences / 60 words max with `max_tokens` reduced from 150 to 100 (#404)
- **Settings modal title**: Rename from "PANELS" to "SETTINGS" across all 17 locales (#403)
- **Sentry noise filters**: CSS.escape() for news ID selectors, player.destroy guard, 11 new ignoreErrors patterns, blob: URL extension frame filter (#402)

---

## [2.5.6] - 2026-02-23

### Added

- **Greek (Ελληνικά) locale** — full translation of all 1,397 i18n keys (#256)
- **Nigeria RSS feeds** — 5 new sources: Premium Times, Vanguard, Channels TV, Daily Trust, ThisDay Live
- **Greek locale feeds** — Naftemporiki, in.gr, iefimerida.gr for Greek-language news coverage
- **Brasil Paralelo source** — Brazilian news with RSS feed and source tier (#260)

### Performance

- **AIS relay optimization** — backpressure queue with configurable watermarks, spatial indexing for chokepoint detection (O(chokepoints) vs O(chokepoints × vessels)), pre-serialized + pre-gzipped snapshot cache eliminating per-request JSON.stringify + gzip CPU (#266)

### Fixed

- **Vietnam flag country code** — corrected flag emoji in language selector (#245)
- **Sentry noise filters** — added patterns for SW FetchEvent, PostHog ingest; enabled SW POST method for PostHog analytics (#246)
- **Service Worker same-origin routing** — restricted SW route patterns to same-origin only, preventing cross-origin fetch interception (#247, #251)
- **Social preview bot allowlisting** — whitelisted Twitterbot, facebookexternalhit, and other crawlers on OG image assets (#251)
- **Windows CORS for Tauri** — allow `http://` origin from `tauri.localhost` for Windows desktop builds (#262)
- **Linux AppImage GLib crash** — fix GLib symbol mismatch on newer distros by bundling compatible libraries (#263)

---

## [2.5.2] - 2026-02-21

### Fixed

- **QuotaExceededError handling** — detect storage quota exhaustion and stop further writes to localStorage/IndexedDB instead of silently failing; shared `markStorageQuotaExceeded()` flag across persistent-cache and utility storage
- **deck.gl null.getProjection crash** — wrap `setProps()` calls in try/catch to survive map mid-teardown races in debounced/RAF callbacks
- **MapLibre "Style is not done loading"** — guard `setFilter()` in mousemove/mouseout handlers during theme switches
- **YouTube invalid video ID** — validate video ID format (`/^[\w-]{10,12}$/`) before passing to IFrame Player constructor
- **Vercel build skip on empty SHA** — guard `ignoreCommand` against unset `VERCEL_GIT_PREVIOUS_SHA` (first deploy, force deploy) which caused `git diff` to fail and cancel builds
- **Sentry noise filters** — added 7 patterns: iOS readonly property, SW FetchEvent, toLowerCase/trim/indexOf injections, QuotaExceededError

---

## [2.5.1] - 2026-02-20

### Performance

- **Batch FRED API requests** — frontend now sends a single request with comma-separated series IDs instead of 7 parallel edge function invocations, eliminating Vercel 25s timeouts
- **Parallel UCDP page fetches** — replaced sequential loop with Promise.all for up to 12 pages, cutting fetch time from ~96s worst-case to ~8s
- **Bot protection middleware** — blocks known social-media crawlers from hitting API routes, reducing unnecessary edge function invocations
- **Extended API cache TTLs** — country-intel 12h→24h, GDELT 2h→4h, nuclear 12h→24h; Vercel ignoreCommand skips non-code deploys

### Fixed

- **Partial UCDP cache poisoning** — failed page fetches no longer silently produce incomplete results cached for 6h; partial results get 10-min TTL in both Redis and memory, with `partial: true` flag propagated to CDN cache headers
- **FRED upstream error masking** — single-series failures now return 502 instead of empty 200; batch mode surfaces per-series errors and returns 502 when all fail
- **Sentry `Load failed` filter** — widened regex from `^TypeError: Load failed$` to `^TypeError: Load failed( \(.*\))?$` to catch host-suffixed variants (e.g., gamma-api.polymarket.com)
- **Tooltip XSS hardening** — replaced `rawHtml()` with `safeHtml()` allowlist sanitizer for panel info tooltips
- **UCDP country endpoint** — added missing HTTP method guards (OPTIONS/GET)
- **Middleware exact path matching** — social preview bot allowlist uses `Set.has()` instead of `startsWith()` prefix matching

### Changed

- FRED batch API supports up to 15 comma-separated series IDs with deduplication
- Missing FRED API key returns 200 with `X-Data-Status: skipped-no-api-key` header instead of silent empty response
- LAYER_TO_SOURCE config extracted from duplicate inline mappings into shared constant

---

## [2.5.0] - 2026-02-20

### Highlights

**Local LLM Support (Ollama / LM Studio)** — Run AI summarization entirely on your own hardware with zero cloud dependency. The desktop app auto-discovers models from any OpenAI-compatible local inference server (Ollama, LM Studio, llama.cpp, vLLM) and populates a selection dropdown. A 4-tier fallback chain ensures summaries always generate: Local LLM → Groq → OpenRouter → browser-side T5. Combined with the Tauri desktop app, this enables fully air-gapped intelligence analysis where no data leaves your machine.

### Added

- **Ollama / LM Studio integration** — local AI summarization via OpenAI-compatible `/v1/chat/completions` endpoint with automatic model discovery, embedding model filtering, and fallback to manual text input
- **4-tier summarization fallback chain** — Ollama (local) → Groq (cloud) → OpenRouter (cloud) → Transformers.js T5 (browser), each with 5-second timeout before silently advancing to the next
- **Shared summarization handler factory** — all three API tiers use identical logic for headline deduplication (Jaccard >0.6), variant-aware prompting, language-aware output, and Redis caching (`summary:v3:{mode}:{variant}:{lang}:{hash}`)
- **Settings window with 3 tabs** — dedicated **LLMs** tab (Ollama endpoint/model, Groq, OpenRouter), **API Keys** tab (12+ data source credentials), and **Debug & Logs** tab (traffic log, verbose mode, log file access). Each tab runs an independent verification pipeline
- **Consolidated keychain vault** — all desktop secrets stored as a single JSON blob in one OS keychain entry (`secrets-vault`), reducing macOS Keychain authorization prompts from 20+ to exactly 1 on app startup. One-time auto-migration from individual entries with cleanup
- **Cross-window secret synchronization** — saving credentials in the Settings window immediately syncs to the main dashboard via `localStorage` broadcast, with no app restart needed
- **API key verification pipeline** — each credential is validated against its provider's actual API endpoint. Network errors (timeouts, DNS failures) soft-pass to prevent transient failures from blocking key storage; only explicit 401/403 marks a key invalid
- **Plaintext URL inputs** — endpoint URLs (Ollama API, relay URLs, model names) display as readable text instead of masked password dots in Settings
- **5 new defense/intel RSS feeds** — Military Times, Task & Purpose, USNI News, Oryx OSINT, UK Ministry of Defence
- **Koeberg nuclear power plant** — added to the nuclear facilities map layer (the only commercial reactor in Africa, Cape Town, South Africa)
- **Privacy & Offline Architecture** documentation — README now details the three privacy levels: full cloud, desktop with cloud APIs, and air-gapped local with Ollama
- **AI Summarization Chain** documentation — README includes provider fallback flow diagram and detailed explanation of headline deduplication, variant-aware prompting, and cross-user cache deduplication

### Changed

- AI fallback chain now starts with Ollama (local) before cloud providers
- Feature toggles increased from 14 to 15 (added AI/Ollama)
- Desktop architecture uses consolidated vault instead of per-key keychain entries
- README expanded with ~85 lines of new content covering local LLM support, privacy architecture, summarization chain internals, and desktop readiness framework

### Fixed

- URL and model fields in Settings display as plaintext instead of masked password dots
- OpenAI-compatible endpoint flow hardened for Ollama/LM Studio response format differences (thinking tokens, missing `choices` array edge cases)
- Sentry null guard for `getProjection()` crash with 6 additional noise filters
- PathLayer cache cleared on layer toggle-off to prevent stale WebGL buffer rendering

---

## [2.4.1] - 2026-02-19

### Fixed

- **Map PathLayer cache**: Clear PathLayer on toggle-off to prevent stale WebGL buffers
- **Sentry noise**: Null guard for `getProjection()` crash and 6 additional noise filters
- **Markdown docs**: Resolve lint errors in documentation files

---

## [2.4.0] - 2026-02-19

### Added

- **Live Webcams Panel**: 2x2 grid of live YouTube webcam feeds from global hotspots with region filters (Middle East, Europe, Asia-Pacific, Americas), grid/single view toggle, idle detection, and full i18n support (#111)
- **Linux download**: added `.AppImage` option to download banner

### Changed

- **Mobile detection**: use viewport width only for mobile detection; touch-capable notebooks (e.g. ROG Flow X13) now get desktop layout (#113)
- **Webcam feeds**: curated Tel Aviv, Mecca, LA, Miami; replaced dead Tokyo feed; diverse ALL grid with Jerusalem, Tehran, Kyiv, Washington

### Fixed

- **Le Monde RSS**: English feed URL updated (`/en/rss/full.xml` → `/en/rss/une.xml`) to fix 404
- **Workbox precache**: added `html` to `globPatterns` so `navigateFallback` works for offline PWA
- **Panel ordering**: one-time migration ensures Live Webcams follows Live News for existing users
- **Mobile popups**: improved sheet/touch/controls layout (#109)
- **Intelligence alerts**: disabled on mobile to reduce noise (#110)
- **RSS proxy**: added 8 missing domains to allowlist
- **HTML tags**: repaired malformed tags in panel template literals
- **ML worker**: wrapped `unloadModel()` in try/catch to prevent unhandled timeout rejections
- **YouTube player**: optional chaining on `playVideo?.()` / `pauseVideo?.()` for initialization race
- **Panel drag**: guarded `.closest()` on non-Element event targets
- **Beta mode**: resolved race condition and timeout failures
- **Sentry noise**: added filters for Firefox `too much recursion`, maplibre `_layers`/`id`/`type` null crashes

## [2.3.9] - 2026-02-18

### Added

- **Full internationalization (14 locales)**: English, French, German, Spanish, Italian, Polish, Portuguese, Dutch, Swedish, Russian, Arabic, Chinese Simplified, Japanese — each with 1100+ translated keys
- **RTL support**: Arabic locale with `dir="rtl"`, dedicated RTL CSS overrides, regional language code normalization (e.g. `ar-SA` correctly triggers RTL)
- **Language switcher**: in-app locale picker with flag icons, persists to localStorage
- **i18n infrastructure**: i18next with browser language detection and English fallback
- **Community discussion widget**: floating pill linking to GitHub Discussions with delayed appearance and permanent dismiss
- **Linux AppImage**: added `ubuntu-22.04` to CI build matrix with webkit2gtk/appindicator dependencies
- **NHK World and Nikkei Asia**: added RSS feeds for Japan news coverage
- **Intelligence Findings badge toggle**: option to disable the findings badge in the UI

### Changed

- **Zero hardcoded English**: all UI text routed through `t()` — panels, modals, tooltips, popups, map legends, alert templates, signal descriptions
- **Trending proper-noun detection**: improved mid-sentence capitalization heuristic with all-caps fallback when ML classifier is unavailable
- **Stopword suppression**: added missing English stopwords to trending keyword filter

### Fixed

- **Dead UTC clock**: removed `#timeDisplay` element that permanently displayed `--:--:-- UTC`
- **Community widget duplicates**: added DOM idempotency guard preventing duplicate widgets on repeated news refresh cycles
- **Settings help text**: suppressed raw i18n key paths rendering when translation is missing
- **Intelligence Findings badge**: fixed toggle state and listener lifecycle
- **Context menu styles**: restored intel-findings context menu styles
- **CSS theme variables**: defined missing `--panel-bg` and `--panel-border` variables

## [2.3.8] - 2026-02-17

### Added

- **Finance variant**: Added a dedicated market-first variant (`finance.crystalball.app`) with finance/trading-focused feeds, panels, and map defaults
- **Finance desktop profile**: Added finance-specific desktop config and build profile for Tauri packaging

### Changed

- **Variant feed loading**: `loadNews` now enumerates categories dynamically and stages category fetches with bounded concurrency across variants
- **Feed resilience**: Replaced direct MarketWatch RSS usage in finance/full/tech paths with Google News-backed fallback queries
- **Classification pressure controls**: Tightened AI classification budgets for tech/full and tuned per-feed caps to reduce startup burst pressure
- **Timeline behavior**: Wired timeline filtering consistently across map and news panels
- **AI summarization defaults**: Switched OpenRouter summarization to auto-routed free-tier model selection

### Fixed

- **Finance panel parity**: Kept data-rich panels while adding news panels for finance instead of removing core data surfaces
- **Desktop finance map parity**: Finance variant now runs first-class Deck.GL map/layer behavior on desktop runtime
- **Polymarket fallback**: Added one-time direct connectivity probe and memoized fallback to prevent repeated `ERR_CONNECTION_RESET` storms
- **FRED fallback behavior**: Missing `FRED_API_KEY` now returns graceful empty payloads instead of repeated hard 500s
- **Preview CSP tooling**: Allowed `https://vercel.live` script in CSP so Vercel preview feedback injection is not blocked
- **Trending quality**: Suppressed noisy generic finance terms in keyword spike detection
- **Mobile UX**: Hidden desktop download prompt on mobile devices

## [2.3.7] - 2026-02-16

### Added

- **Full light mode theme**: Complete light/dark theme system with CSS custom properties, ThemeManager module, FOUC prevention, and `getCSSColor()` utility for theme-aware inline styles
- **Theme-aware maps and charts**: Deck.GL basemap, overlay layers, and CountryTimeline charts respond to theme changes in real time
- **Dark/light mode header toggle**: Sun/moon icon in the header bar for quick theme switching, replacing the duplicate UTC clock
- **Desktop update checker**: Architecture-aware download links for macOS (ARM/Intel) and Windows
- **Node.js bundled in Tauri installer**: Sidecar no longer requires system Node.js
- **Markdown linting**: Added markdownlint config and CI workflow

### Changed

- **Panels modal**: Reverted from "Settings" back to "Panels" — removed redundant Appearance section now that header has theme toggle
- **Default panels**: Enabled UCDP Conflict Events, UNHCR Displacement, Climate Anomalies, and Population Exposure panels by default

### Fixed

- **CORS for Tauri desktop**: Fixed CORS issues for desktop app requests
- **Markets panel**: Keep Yahoo-backed data visible when Finnhub API key is skipped
- **Windows UNC paths**: Preserve extended-length path prefix when sanitizing sidecar script path
- **Light mode readability**: Darkened neon semantic colors and overlay backgrounds for light mode contrast

## [2.3.6] - 2026-02-16

### Fixed

- **Windows console window**: Hide the `node.exe` console window that appeared alongside the desktop app on Windows

## [2.3.5] - 2026-02-16

### Changed

- **Panel error messages**: Differentiated error messages per panel so users see context-specific guidance instead of generic failures
- **Desktop config auto-hide**: Desktop configuration panel automatically hides on web deployments where it is not relevant

## [2.3.4] - 2026-02-16

### Fixed

- **Windows sidecar crash**: Strip `\\?\` UNC extended-length prefix from paths before passing to Node.js — Tauri `resource_dir()` on Windows returns UNC-prefixed paths that cause `EISDIR: lstat 'C:'` in Node.js module resolution
- **Windows sidecar CWD**: Set explicit `current_dir` on the Node.js Command to prevent bare drive-letter working directory issues from NSIS shortcut launcher
- **Sidecar package scope**: Add `package.json` with `"type": "module"` to sidecar directory, preventing Node.js from walking up the entire directory tree during ESM scope resolution

## [2.3.3] - 2026-02-16

### Fixed

- **Keychain persistence**: Enable `apple-native` (macOS) and `windows-native` (Windows) features for the `keyring` crate — v3 ships with no default platform backends, so API keys were stored in-memory only and lost on restart
- **Settings key verification**: Soft-pass network errors during API key verification so transient sidecar failures don't block saving
- **Resilient keychain reads**: Use `Promise.allSettled` in `loadDesktopSecrets` so a single key failure doesn't discard all loaded secrets
- **Settings window capabilities**: Add `"settings"` to Tauri capabilities window list for core plugin permissions
- **Input preservation**: Capture unsaved input values before DOM re-render in settings panel

## [2.3.0] - 2026-02-15

### Security

- **CORS hardening**: Tighten Vercel preview deployment regex to block origin spoofing (`crystalballEVIL.vercel.app`)
- **Sidecar auth bypass**: Move `/api/local-env-update` behind `LOCAL_API_TOKEN` auth check
- **Env key allowlist**: Restrict sidecar env mutations to 18 known secret keys (matching `SUPPORTED_SECRET_KEYS`)
- **postMessage validation**: Add `origin` and `source` checks on incoming messages in LiveNewsPanel
- **postMessage targetOrigin**: Replace wildcard `'*'` with specific embed origin
- **CORS enforcement**: Add `isDisallowedOrigin()` check to 25+ API endpoints that were missing it
- **Custom CORS migration**: Migrate `gdelt-geo` and `eia` from custom CORS to shared `_cors.js` module
- **New CORS coverage**: Add CORS headers + origin check to `firms-fires`, `stock-index`, `youtube/live`
- **YouTube embed origins**: Tighten `ALLOWED_ORIGINS` regex in `youtube/embed.js`
- **CSP hardening**: Remove `'unsafe-inline'` from `script-src` in both `index.html` and `tauri.conf.json`
- **iframe sandbox**: Add `sandbox="allow-scripts allow-same-origin allow-presentation"` to YouTube embed iframe
- **Meta tag validation**: Validate URL query params with regex allowlist in `parseStoryParams()`

### Fixed

- **Service worker stale assets**: Add `skipWaiting`, `clientsClaim`, and `cleanupOutdatedCaches` to workbox config — fixes `NS_ERROR_CORRUPTED_CONTENT` / MIME type errors when users have a cached SW serving old HTML after redeployment

## [2.2.6] - 2026-02-14

### Fixed

- Filter trending noise and fix sidecar auth
- Restore tech variant panels
- Remove Market Radar and Economic Data panels from tech variant

### Docs

- Add developer X/Twitter link to Support section
- Add cyber threat API keys to `.env.example`

## [2.2.5] - 2026-02-13

### Security

- Migrate all Vercel edge functions to CORS allowlist
- Restrict Railway relay CORS to allowed origins only

### Fixed

- Hide desktop config panel on web
- Route World Bank & Polymarket via Railway relay

## [2.2.3] - 2026-02-12

### Added

- Cyber threat intelligence map layer (Feodo Tracker, URLhaus, C2IntelFeeds, OTX, AbuseIPDB)
- Trending keyword spike detection with end-to-end flow
- Download desktop app slide-in banner for web visitors
- Country briefs in Cmd+K search

### Changed

- Redesign 4 panels with table layouts and scoped styles
- Redesign population exposure panel and reorder UCDP columns
- Dramatically increase cyber threat map density

### Fixed

- Resolve z-index conflict between pinned map and panels grid
- Cap geo enrichment at 12s timeout, prevent duplicate download banners
- Replace ipwho.is/ipapi.co with ipinfo.io/freeipapi.com for geo enrichment
- Harden trending spike processing and optimize hot paths
- Improve cyber threat tooltip/popup UX and dot visibility

## [2.2.2] - 2026-02-10

### Added

- Full-page Country Brief Page replacing modal overlay
- Download redirect API for platform-specific installers

### Fixed

- Normalize country name from GeoJSON to canonical TIER1 name
- Tighten headline relevance, add Top News section, compact markets
- Hide desktop config panel on web, fix irrelevant prediction markets
- Tone down climate anomalies heatmap to stop obscuring other layers
- macOS: hide window on close instead of quitting

### Performance

- Reduce idle CPU from pulse animation loop
- Harden regression guardrails in CI, cache, and map clustering

## [2.2.1] - 2026-02-08

### Fixed

- Consolidate variant naming and fix PWA tile caching
- Windows settings window: async command, no menu bar, no white flash
- Constrain layers menu height in DeckGLMap
- Allow Cloudflare Insights script in CSP
- macOS build failures when Apple signing secrets are missing

## [2.2.0] - 2026-02-07

Initial v2.2 release with multi-variant support (World + Tech), desktop app (Tauri), and comprehensive geopolitical intelligence features.
