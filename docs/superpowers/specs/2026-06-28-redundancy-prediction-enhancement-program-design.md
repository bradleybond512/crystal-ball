# Redundancy + Prediction Enhancement Program — Design

- **Date**: 2026-06-28
- **Status**: Design approved (brainstorming) — pending spec review → per-phase plans
- **Author**: Claude (claude/redundancy-prediction-program)
- **Scope**: `src/services/providers/`, `src/services/intelligence/`, `src/services/shortage/`, `src-tauri/sidecar/local-api-server.mjs`, `src/app/data-loader.ts`, diagnostics + new panels
- **Decomposes into**: 4 implementation plans (Phase 0–3), each its own `writing-plans` cycle

---

## 1. Problem & Goal

Crystal Ball's mission is **redundant data sources that tie together to predict the world and surface useful insights**. Today it runs ~71 live feed domains and a deep, fixture-tested intelligence stack — but two structural gaps cap its value:

1. **The redundancy engine is built but dark.** `source-fusion.ts` / `provider-redundancy.ts` and a 38-provider registry exist and are unit-tested, but `fuseObservations()` is called by no general data loader and `recentFactFingerprint` is populated nowhere. The "verified by N independent sources" path almost never fires — facts silently fall back to `unverified`. (The 2026-06-28 ADS-B commit is the one exception: it wired the multi-provider aggregator into one live path. That is the pattern to generalize.)
2. **Prediction is siloed, static, and under-calibrated.** Cross-domain coupling uses fixed cascade pairs; shortage↔intelligence is one-way; shortage models are point-in-time (no momentum); and calibration starves in domains where ground truth rarely arrives (short-fuse weather, covert cyber).

**Goal:** a domain-agnostic engine where (a) every fact carries multi-source corroboration confidence, (b) no domain is a silent single point of failure, (c) cross-domain cascades are learned and bidirectional, and (d) confidence numbers are honest — all surfaced to the user.

## 2. Current State

**Already complete — DO NOT rebuild or replan:**
- The deterministic foundation layers (`intelligence/`, `weather/`, `insights/`, `shortage/`, `datacenter/`, `providers/`) — 600+ fixture tests. Includes truth-scoring, situation clustering, compound-risk, the 8 commodity models, NWS polygon matching, the weather urgency ladder, `proper-scoring.ts` (Brier/CRPS/Murphy/ECE), and the **fusion math itself**.
- The self-tuning / evaluation loop is **wired and live** (`recordAlgorithmEvaluation` → ledger → `startOutcomeGradingCadence()` + `startTuningApplyCadence()` at boot). Do not "wire the dormant loop." (Open lever: only 3 knobs are declared tunable; adding knobs needs a per-knob safety-fixtures suite. Backtest-engine does not model algo knobs.)
- Cognition PRs 1–11, 13, 15 (episodic memory, closed-loop calibration, superforecaster pipeline, operator model, entity dossiers, conformal intervals, consolidation, EVOI, BOCPD, shadow rollout). Only PR12 (self-tuning cognition) + PR6 (UI) remain — out of scope here.
- Solid multi-source domains (don't add redundancy here): ADS-B (3), CVEs (3), cyber IOCs (4), market quotes (3), IP geolocation (3), gov travel advisories (3), air quality (3).

**The gap is wiring + depth, not new math.** Each workstream below is connective tissue and enrichment over existing, tested engines.

## 3. Settled Parameters (from brainstorming)

| Parameter | Decision |
|---|---|
| Directions | All four: (A) activate fusion, (B) close SPOFs, (C) cross-domain prediction, (D) calibration |
| Optimization lens | **General-purpose breadth** — domain-agnostic engine, even coverage |
| New source cost | **Free / free-tier only** (per `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md`) |
| Delivery surface | **Full surfacing incl. new UI** (existing panels + 2 new panels) |
| Sequencing | **Keystone slice, then widen** (Phase 0 → 1 → 2 → 3) |
| Keystone domain | **Earthquakes** — USGS (existing) + EMSC (added, free/no-key `seismicportal.eu`) — a clean 2-source pairing, fast to verify. Earthquakes is USGS-only today, so Phase 0 also exercises a sliver of Workstream B (add EMSC). |

## 4. Approach — Keystone slice, then widen

Phase 0 proves the **entire** path end-to-end on one domain before generalizing. Then we widen coverage (so fusion has material everywhere), then deepen prediction, then calibrate. Each phase ships independent, testable value and respects the A→B→C→D dependency chain (C and D compound on the per-fact confidence A produces; A needs B's extra sources to actually show corroboration).

## 5. Architecture — the fusion spine

Insert a **fusion ingest layer** between raw fetchers and the intelligence stack so every fact carries multi-source confidence by construction.

```
fetchers (sidecar routes / data-loader fetchers)
   │  per-domain providers each emit a SourceObservation
   ▼
[ NEW: fusion ingest layer ]  src/services/providers/fusion-ingest.ts
   • provider-domain-map: which providers feed each domain
   • ingestWithFusion(domain, observations[]) →
        fuseObservations() (existing math) + numericTolerance per domain
        + recentFactFingerprint (stable hash of consensus value)
        + recordProviderFetchOutcome() per provider
   ▼  returns FusionResult { consensusValue, confidenceMultiplier,
                             components{freshness,reliability,corroboration},
                             disagreements[], contributingProviders[] }
   ▼
NormalizedFact / IncomingEvent   ◄── FusionResult pinned here
   ▼
truth-score → situation-clustering → compound-risk → analyst-loop / hypotheses
   ▼
surfaces: Command Center · SystemDiagnostic · analyst HUD · MCP
          · NEW SourceConfidencePanel · NEW CascadeMapPanel
```

**Key principle:** the fusion *engine* (`fuseObservations`, `deriveProviderHealth`, the registry, the redundancy verdict map) is unchanged. New code is: the provider→domain map, the ingest wrapper, the fingerprint hash, per-domain tolerance config, and the small consensus/health refinements in §6.A.

## 6. Workstreams

### A — Activate the redundancy engine (keystone)

| Unit | Purpose | Touches |
|---|---|---|
| `provider-domain-map.ts` | Declares which registered providers feed each domain (the missing fetcher↔fusion link). | new file in `providers/` |
| Observation matcher | Per-domain rule deciding which records from different providers refer to the **same real-world fact** (fusion is per-fact, not per-domain-average). Earthquakes: same event if within ~50 km and ~60 s. Without this, USGS+EMSC look like two facts, not one corroborated fact. | part of `fusion-ingest.ts` (per-domain matcher fn) |
| `fusion-ingest.ts` — `ingestWithFusion()` | Single entry point: group observations into facts via the matcher, call `fuseObservations()` per fact with per-domain `numericTolerance`, compute `recentFactFingerprint`, record fetch outcomes, return `FusionResult`. | new file; called from `data-loader.ts` |
| `recentFactFingerprint` population | Stable hash (sorted-key JSON → hash) of consensus value so `provider-redundancy.ts` emits true `redundant_agreement` instead of `unverified`. | `fusion-ingest.ts`, `provider-bridge.ts` |
| Provider-weighted consensus | `splitConsensus()` tie-break prefers higher summed `reliabilityWeight` (FRED/SEC 0.95 outweighs OpenSky 0.7). | `source-fusion.ts` |
| Per-domain numeric tolerance | New `DomainFusionConfig` (e.g. temp ±0.5°C, price ±1%) wired into the `ingestWithFusion` call site to end exact-match brittleness for floats. | new config + `fusion-ingest.ts` |
| Persistent health ledger | Move the in-memory ring buffer to IndexedDB on `crystalball_db` (probe-then-bump version per the shared-DB hazard) so provider health survives restart. | `providers-state.ts`, `provider-health.ts` |
| ADS-B degradation propagation | Cap a degraded/down provider's contribution at merge so 2-healthy+1-down no longer scores 0.95. | `adsb-aggregate.ts` |

**Phase 0 acceptance:** an earthquake from USGS+EMSC shows a `FusionResult` with `redundant_agreement`, a real `confidenceMultiplier`, component breakdown, and a "verified by 2 independent sources" chip in Command Center — all fixture-tested.

### B — Close single points of failure (free sources)

- Wire fallbacks for the 20 single-source domains (catalog in §12), each as:
  - **its own `DataSourceId`** (per the feed-fidelity fail-closed pattern — a shared id masks outages),
  - registered in `provider-registry.ts` with an honest **`independenceGroup`** (gov / academic / community — same upstream ⇒ same group) and `fallbackPriority`,
  - dual-allowlisted in `main.rs` `SUPPORTED_SECRET_KEYS` **and** the sidecar `ALLOWED_ENV_KEYS` where keyed (plus the 3 exhaustive Records — see secret-key memory).
- **Sidecar fallback orchestration**: on a primary 429/timeout, auto-try the next-priority provider without a client-visible stall; record *both* outcomes so health stays honest and `dataFreshness.recordError` fires on real failure. (The sidecar already has a `fetchWithFallback(primary, [secondary])` primitive used by the USGS quake feed — generalize it across providers rather than reinventing it.)
- Net effect: most domains now have ≥2 independent sources, so the corroboration path from A actually lights up.

### C — Sharper cross-domain prediction

| Unit | Purpose |
|---|---|
| Momentum drivers | Add rate-of-change / n-day slope / volatility drivers to the shortage models + `baseline-deviation.ts`, so a fast spike scores higher than a slow climb. |
| Learned cascade discovery | Mine the existing outcome/episodic ledger for empirical `(domainA → domainB, lag)` pairs to **augment** `compound-risk.ts`'s fixed cascade table (additive; never replaces the deterministic base). |
| Bidirectional intelligence↔shortage coupling | A detected war→port-closure cascade dynamically boosts the export-corridor driver in commodity models; an emerging-famine shortage flag boosts food-security relevance upstream. |
| Time-series anomaly → disagreement | A provider returning >2σ off its own rolling baseline surfaces as a `Disagreement`, not silent corruption. |

### D — Trustworthy calibration

| Unit | Purpose |
|---|---|
| Proxy-signal outcome inference | For short-fuse events that rarely get labeled (severe weather, covert cyber), infer resolved/false outcomes from downstream signals (e.g. outage spikes, follow-on alerts) to feed the **existing** `forecast-calibration.ts`. `proper-scoring.ts` is untouched. |
| OOD confidence decay | Penalize forecasts by distance from training distribution so rare commodities / emerging conflicts stop starting equally confident. |

### E — UI surfacing (interleaved within each phase, not last)

- **Existing surfaces first**: "verified by N independent sources" + active-disagreement chips in Command Center, the diagnostics panels, and MCP outputs.
- **`SourceConfidencePanel`** (new, Phase 1): per-domain redundancy verdict, live disagreements, provider-health timeline.
- **`CascadeMapPanel`** (new, Phase 2): visualizes learned cross-domain couplings from Workstream C.
- Panel wiring touches the conflict-magnet files (`panels.ts`, `panel-layout.ts`) → strict worktree discipline + rebase-before-commit, and the panel must be **instantiated** in `panel-layout.ts`, not just registered (per the panel-wiring-audit memory).

## 7. Phasing → separate implementation plans

| Phase | Content | Plan |
|---|---|---|
| **Phase 0** | Add EMSC as the 2nd quake source, then Workstream A on earthquakes end-to-end incl. Command Center chip. Establishes `fusion-ingest.ts` + `provider-domain-map.ts` + observation matcher + fingerprint + tolerance config. | Plan 1 |
| **Phase 1** | Widen A across all domains + Workstream B (close 20 SPOFs, free sources, fallback orchestration) + `SourceConfidencePanel`. | Plan 2 |
| **Phase 2** | Workstream C (momentum, learned cascades, bidirectional coupling, anomaly-as-disagreement) + `CascadeMapPanel`. | Plan 3 |
| **Phase 3** | Workstream D (proxy-signal outcomes, OOD decay) + calibration surfacing. | Plan 4 |

Each phase: branch off fresh `origin/main` in its own worktree, fixture tests + `typecheck:all` at zero + `smoke` green, cross-agent review, PR.

### Phase 1 status (UI slice landed; SPOF-closing deferred)

- **Done**: `SourceConfidencePanel` (§6.E) shipped as a dedicated diagnostics
  surface — `src/components/SourceConfidencePanel.ts`, backed by two new
  pure view-model modules: `src/services/providers/provider-health-timeline-view.ts`
  (per-provider fetch-outcome ring buffer → renderable timeline) and
  `src/services/diagnostics/source-confidence-view.ts` (composes
  `assessProviderRedundancy()` + the timeline view into per-domain cards:
  fusion-active vs SPOF tag, live disagreement flags, per-provider health).
  Both reuse the existing engines verbatim — no new scoring math. Registered
  in `panels.ts` / instantiated in `panel-layout.ts` under the `intelligence`
  category, refreshing every 15s off the already-wired
  `getProviderRedundancyReport()` singleton.
- **Deferred (out of scope for the UI-focused session that shipped the
  panel)**: "Widen A across all domains" (wiring `FUSION_DOMAINS` /
  `fusion-publish.ts` for domains beyond the current 4 — earthquakes,
  air_quality, crypto, stocks) and all of Workstream B (closing the 20
  cataloged SPOFs in §12 with free fallback sources + sidecar fallback
  orchestration). The panel is honest about this today: any domain with
  only one registered provider surfaces as `single_source` / "SPOF" and any
  domain with 2+ providers but no fingerprint pipeline wired surfaces as
  `redundant_unverified` (not yet "FUSED") — both are visible signals for
  the next session to act on, not fabricated coverage.

## 8. Data flow (end to end, earthquake example)

1. `data-loader.ts` fetches the quake domain; USGS and EMSC each return a `SourceObservation` (value = {mag, lat, lon, depth, time}, providerId, observedAt).
2. `ingestWithFusion('earthquakes', [usgsObs, emscObs])` clusters by value within tolerance, finds 2 distinct independence groups → corroboration 0.8, computes freshness + reliability, returns a `FusionResult` + `recentFactFingerprint`.
3. The `NormalizedFact` carries the `FusionResult`; `truth-score.ts` uses fusion-derived corroboration instead of a per-source guess → label rises from `plausible` to `likely`.
4. `provider-redundancy.ts` reads the fingerprint match across providers → `redundant_agreement`, multiplier 1.0.
5. Command Center renders "Verified by 2 independent sources (USGS, EMSC)"; if they disagreed on magnitude beyond tolerance, a disagreement chip shows both values and the multiplier caps at 0.6.

## 9. Testing & invariants

- Every new service is **pure + fixture-tested** (the 600+ test pattern; `test:providers` etc., run via tsx).
- `npm run typecheck:all` stays at zero; `npm run smoke` + replay fixtures guard regressions.
- New knobs (if any reach the tuning loop) require a per-knob safety-fixtures suite (set-wise non-regression).
- **Plan invariants honored everywhere**: every score explains itself; every claim carries provenance; stale data *reduces* confidence (never disappears); contradictions surface (never averaged); every output is statically testable with no live fetch in unit tests.

## 10. Guardrails / non-goals

- **Non-goals**: rebuilding fusion math, the commodity models, `proper-scoring.ts`, or the foundation layers; re-wiring the (already live) self-tuning loop; cognition PR12/PR6; paid data sources.
- **Hard rules**: never touch the macOS Keychain; new keyed feeds need the dual-allowlist + 3 Records; each feed gets its own `DataSourceId`; panels must be instantiated, not just registered; rebase onto `origin/main` before committing on the conflict-magnet files; cross-agent review required on `claude/*` before merge.

## 11. Risks & open questions

- **Breach data (HIBP)** has thin free redundancy — may stay single-source with health monitoring only (candidate: XposedOrNot). Flagged for Phase 1 decision.
- **Authoritative gov singles** (SEC EDGAR, Treasury) are low-redundancy-priority — add stale-timeout health alarms rather than a second source.
- **Learned cascade discovery** needs sufficient outcome history; Phase 2 must ship a deterministic floor that works before the ledger is rich, and log when it falls back.
- **Independence-group honesty**: several "redundant" sources share an upstream (e.g. Open-Meteo powering multiple domains) — mis-grouping would inflate corroboration. Group assignment is reviewed at wiring time.

## 12. Source catalog — single-source domains → candidate free fallbacks

Drawn from `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md`; independence groups in parentheses. Verified at wiring time (Phase 1).

| Domain (current single source) | Candidate free fallbacks |
|---|---|
| Tropical cyclones (NHC) | JMA RSMC (jp-gov), GDACS (eu-academic) |
| Tides / water levels (NOAA CO-OPS) | NOAA NDBC buoys (us-gov-marine), USGS Water (us-gov-water) |
| Lightning (Open-Meteo embedded) | Blitzortung (community) |
| Landslides (NASA EONET) | GDACS (eu-academic), USGS (us-gov) |
| Airstrikes / drone strikes (ACLED, keyed) | GDELT 2.0 events (academic), UCDP (academic) |
| Oil analytics (EIA, keyed) | Stooq crude CSV (community) |
| Breach data (HIBP, keyed) | XposedOrNot (community) — thin; may stay single + health alarm |
| Crypto prices (CoinGecko) | CoinCap, DefiLlama, Binance/Coinbase public (each own group) |
| News aggregation (paid trio) | GDELT DOC 2.0 (academic), Google News RSS (rss), ReliefWeb (un) |
| Sanctions (OpenSanctions) | OFAC SDN (us-gov), UN Consolidated (un) |
| Power grid (PowerOutage.us) | EIA-930 grid ops (us-gov) |
| SEC filings (EDGAR) | authoritative gov — health alarm only |
| Treasury (Fiscal Data) | authoritative gov — health alarm only |
| Maritime hazards (NGA MSI) | GDACS maritime (eu-academic), NOAA nowCOAST (us-gov) |
| Port chokepoints (IMF PortWatch) | UN Comtrade trade-flow corroboration (un) |
| Near-Earth objects (NASA NeoWs) | CelesTrak (community), Space-Track (us-gov) |
| Displacement (UNHCR) | IOM DTM (un), HDX HAPI / ReliefWeb (un) |
| Wildfire incidents (InciWeb) | NASA FIRMS (us-gov, already supported), GDACS (eu-academic) |
| SSL cert IOCs (SSLBL) | crt.sh (community), Feodo Tracker C2 (community) |
| RIPE Atlas | RIPEstat (ripe), PeeringDB (community), BGPView (community) |

Plus cyber enrichment (existing 3-source domains, deepen not widen): FIRST EPSS + CIRCL CVE.
