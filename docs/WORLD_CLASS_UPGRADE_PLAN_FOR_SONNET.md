# World-Class Upgrade Plan — Handoff for Sonnet (2026-06-10)

This is the implementation plan distilled from a full-repo review (panel inventory,
data-source inventory, service-wiring audit, gap-doc reconciliation). It supersedes
nothing — it sequences the existing backlogs (`ELITE_REMAINING_GAPS_FOR_CLAUDE.md`,
`SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md`, `SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md`,
`API_SOURCE_EXPANSION_FREE_OPTIONS.md`) into one prioritized program with concrete
PR boundaries and acceptance criteria.

## 1. Where the app actually stands

**Strengths (verified):**

- **307 external API endpoints** proxied by the sidecar across **48+ domains** —
  weather, seismic, conflict, aviation, maritime, cyber (24 sources), economic,
  health, space, humanitarian, infrastructure. 64 of them are free/no-key.
- **600+ deterministic fixture tests** across 10 foundation service layers
  (`intelligence/` 46 test files, `algorithms/` 16, `shortage/` 12, `diagnostics/` 11,
  `ops/` 10, `insights/` 9, `datacenter/` 8, `weather/` 6, `personal/` 3, `adsb/` 1).
- Every plan invariant holds in the service tier: explanations, provenance,
  staleness honesty, surfaced contradictions, static-fixture testability.

**The two structural problems:**

1. **Dark matter.** ~40–50% of the intelligence foundation computes results no user
   ever sees. UI import audit: `ops/` → **0** UI imports, `algorithms/` → **0**
   (beyond the one diagnostic panel), `datacenter/` → **0**, `insights/` → 1,
   `personal/` → 1, `shortage/` → 4 but with no live inputs flowing. The replay
   harness, mission ledger, outcome grading, safe-adjustment engine, Ask-The-Data,
   and all 8 commodity models are built, tested, and invisible.
2. **Panel inflation.** ~466 panel definitions across variants; the `intelligence`
   sidebar category alone lists ~280 panel keys (`src/config/panels.ts:1203`).
   Dozens are single-source feed wrappers or near-duplicates (8 alert surfaces,
   6 weather panels, 8 notification panels, 8 ML/backtest panels, 19 "superpower"
   panels overlapping their base panels). Quality is diluted across quantity; the
   sidebar is unusable at this size and nothing tells the user where to look first.

**The thesis for "highest quality":** the world's best personal-intelligence app is
not 466 panels — it is *one answer-first home* (Command Center: "what matters right
now, why, and what to do"), backed by **~12 deep domain hubs**, where every number is
explainable, every claim has provenance, everything is personal (saved places,
watchlist, portfolio), and the system can prove it would have warned you (replay).
Depth and wiring beat breadth. The program below is ordered accordingly:
**wire what exists → consolidate the surface → then expand sources.**

---

## 2. Workstream A — Light up the dark matter (highest ROI, do first)

The foundation is built and tested; this workstream is pure wiring. Each item is a
small PR with an existing service contract on one side and an existing UI pattern
(tabs like `SystemDiagnosticPanel`, cards like `ShortageRadarPanel`) on the other.

### A1. Shortage Radar live inputs
- `src/services/shortage/` has 8 commodity models + `ShortageRadarPanel.setRequests(...)`,
  but no live data flows. Build the input bridge in `src/app/data-loader.ts`:
  EIA (diesel/gasoline/natgas/jet fuel inventories + prices), FRED (food price
  indices), existing weather anomalies (heat/drought for corn/wheat), chokepoint
  signals already fetched for the maritime panels.
- Acceptance: Shortage Radar renders live tiers with non-empty drivers for ≥6 of 8
  commodities when EIA/FRED keys are present; data gaps listed honestly when not.
  Extend `shortage-input-bridge` tests with live-shaped fixtures.

### A2. Replay & outcome learning surfaced
- Add a **Replay** tab to `SystemDiagnosticPanel`: run
  `runReplayHarness(replayFixturesCatalog)` on demand, render per-fixture
  pass/fail with expectation kind and explanation ("would Crystal Ball have warned
  earlier?").
- Add a **Missions** tab: mission ledger entries + outcome grades from
  `src/services/ops/` (mission-ledger, outcome-grading-runner, time-to-warn).
- Acceptance: both tabs render from the singletons with zero new fetches; replay
  run completes < 1s; deterministic snapshot test per tab.

### A3. Algorithm self-improvement review queue
- `AlgorithmDiagnosticPanel` shows proposals; add the missing human-in-the-loop:
  Apply / Dismiss buttons for `apply`-verdict Safe Adjustment proposals, writing to
  the tuning decision log with rollback affordance. Never auto-apply.
- Acceptance: decision log records actor + before/after; rollback restores prior
  tunable; tests for both paths.

### A4. Ask-The-Data in the product
- Wire `src/services/insights/ask-the-data.ts` (6 intents, deterministic answers +
  evidence rows) into (a) the Command Center as suggestion chips on the active
  situation and (b) the Command Palette (⌘K) as a query mode. Merge it into
  `AskCrystalBallPanel` as the structured/free-text split: try deterministic
  intents first, fall back to `llm-adapter.generateText()`.
- Acceptance: each of the 6 intents reachable from UI; evidence rows clickable to
  the underlying panel/hub; zero LLM calls for recognized intents.

### A5. Notification ladder end-to-end
- `notification-ladder.ts` records lifecycles but only weather flows through it.
  Route shortage tier escalations (`shortage-alert-emitter`), big-event detections,
  and ops/replay regressions through the ladder → trace registry → native
  notification rung. Safety-critical overrides quiet hours (already implemented in
  the service).
- Acceptance: Notifications tab of System Diagnostic shows traces from ≥3 event
  families; quiet-hours suppression visible in the trace; ladder tests extended.

### A6. Datacenter readiness panel completion
- `datacenter-readiness` exists as a panel key; `src/services/datacenter/` has 0 UI
  imports. Build the panel on the `ShortageRadarPanel` card pattern: DcLevel rung,
  power + weather posture, people-first `ReadinessAction` list, stale-input badges.
  Feed it from `datacenter-state.ts` (site resolver already picks the
  highest-priority `data_center` saved place).
- Acceptance: panel renders all 5 DcLevel rungs from fixtures; stale inputs shown,
  never dropped; uses `datacenter-view.ts` helpers exclusively for labels/colors.

### A7. Personal Impact strip + Share
- Render `PersonalImpact` rows (5 categories + dormant bucket) as the top strip of
  Command Center, and add a "Share this briefing" action wired to
  `buildSharePacket()` (markdown → clipboard / share sheet).
- Acceptance: with a profile installed, impacts render sorted by category severity;
  share output includes provenance + diagnostics appendices; snapshot tests.

---

## 3. Workstream B — Information architecture: 466 panels → ~12 hubs + ~120 surfaces

### The hub pattern

Introduce a `HubPanel` base (tabbed container, same segmented-tab treatment
`macos-native.css` already styles for System Diagnostic). Each hub hosts existing
panel renderers as lazy-mounted tabs. **Old panel IDs become aliases** — add
`aliasOf?: string` to `PanelConfig`; the Command Palette, deep links, and saved
layout prefs resolve aliases to `hub-id#tab`. No renderer is deleted in this
workstream; panels are *rehomed*, so each merge PR is mechanical and reversible.
Migrate persisted sidebar visibility (`crystalball-*` keys) with a one-time
mapping; unknown keys fall back to the hub default.

### Target sidebar (full variant)

| Hub | Absorbs (examples, not exhaustive) |
|---|---|
| **Command Center** (home) | today-view, what-changed, personal-relevance, action briefs |
| **Alerts & Inbox** | unified-alert-inbox + alert-center (one inbox); alert-rules, alert-rules-tuning, alert-trace, alert-explanation, alert-escalation, alert-deduplication, alert-fatigue-dashboard → an "Alert Ops" tab set |
| **Weather & Hazards** | global-weather, extended-forecast, weather-radar, severe-weather, weather-hazard, nws-alerts, spc-mesoscale, tropical-cyclones, flood-monitor, wildfire-*, earthquakes/emsc/shakealert, volcano-*, tsunami, avalanche, pollen/air-quality |
| **Conflict & Geopolitics** | the ~120 single-topic geopolitical deep-dive panels become a themed catalog inside one hub (region/theme filter), keeping ucdp/acled/gdelt/airstrikes/displacement as primary tabs |
| **Cyber** | cyber-threats, cve-tracker, vulners, threat-intel-hub, phishstats, urlscan, pulsedive, hibp, ioc-manager, stix-taxii, dark-web, local-ids, little-snitch |
| **Markets & Economy** | markets, economic + economic-stress + economic-intel (one tabbed surface), macro-signals, crypto/stablecoins/etf-flows, commodities, fear-greed, national-debt, fdic, edgar |
| **Shortage & Supply Chain** | shortage-radar + 8 shortage-detail-* tabs, supply-chain, trade-disruption, chokepoints, fuel-prices |
| **Maritime / Aviation / Space** | maritime-superpower (+ dark-vessel, piracy), aviation (+ air-traffic, faa-tfrs, adsb), space (weather/debris/launches/neo/reentry) |
| **Health & Humanitarian** | disease-*, ecdc, humanitarian-crisis, displacement, food-insecurity, water-quality |
| **Infrastructure & Grid** | power-grid + grid-intelligence + electric-grid-vulnerability + infrastructure + infra-risk-matrix → one hub; internet-disruptions, comms-health, datacenter-readiness |
| **Preparedness & Personal** | saved-places, watchlist-locations, evacuation, offline-maps, resource-inventory, family-tracker, local-logistics, comms-plan, personal-resilience, survival-advisor |
| **System & Diagnostics** | system-diagnostic (+ Replay/Missions tabs), algorithm-diagnostic, feed-health-*, api-diagnostic, notification-{settings,history,audit,provenance,digest} → 2 tabs (Settings, Activity), self-test |

Specific dedupes inside the merges: the 19 "superpower" panels become the *default
tab* of their domain hub (they are the synthesis views — promote them, retire the
thin base duplicates); `notification-preferences` vs `notification-settings` and
`active-learning` vs `active-learning-queue` are duplicate pairs — keep one each;
`global-risk-heatmap` becomes a map layer, not a panel; backtest/backtest-gate/
shadow-mode/shadow-comparison fold into an "Evaluation" tab of Algorithm
Diagnostics.

### Naming normalization
One vocabulary: hubs are nouns ("Cyber", "Weather & Hazards"); tabs are plain
("Overview", "Rules", "Trace"). Retire the "Superpower" suffix in user-facing
names. Keep `HUMAN_LABELS` in `settings-constants.ts` as the single source.

### Acceptance for the workstream
- Sidebar shows ≤ 14 top-level entries in the full variant; every retired panel ID
  still resolves via alias (Command Palette test enumerates all legacy IDs).
- No data-loader regressions: hubs lazy-mount tabs; initial bundle does not grow.
- `npm run docs:check` updated for new panel counts.

---

## 4. Workstream C — Data source expansion (toward "most comprehensive")

Only after A+B: new sources must land into hubs with provenance, freshness, and
provider-redundancy from day one (every source registers in
`provider-redundancy.ts` and the feed-health registry — this is what makes the
breadth *trustworthy*, which is the actual differentiator).

**Tier 1 — critical gaps (free, no key):**
1. **NetBlocks / IODA** — internet shutdowns & telecom disruption → Infrastructure hub.
2. **CPSC + FDA + NHTSA recalls** — product/food/vehicle safety → new "Recalls" tab in Health hub + Personal Impact matching against the user's profile.
3. **FEMA OpenFEMA + Overpass (OSM)** — shelters, hospitals, fuel, pharmacies near saved places → Preparedness hub (this is the "survival tools" ask: nearest-resources, offline-cacheable).
4. **CAL FIRE + USGS fire analytics** — wildfire perimeters/containment → Weather & Hazards.
5. **ACLED expansion + CrisisWatch** — civil unrest early warning → Conflict hub.

**Tier 2 — high value:** FIRST EPSS (exploit probability on the CVE tracker),
NOAA CPC climate indices (feeds shortage seasonal multipliers), World Bank port
performance (feeds shortage transport bucket), NERC/EIA grid status (feeds
datacenter power posture), OWID + CDC FluView (disease sub-national).

**Tier 3 — redundancy:** Airplanes.live/ADSB.lol fallbacks into `adsb-aggregate`
(confidence model already supports 3+ providers), EMSC↔USGS cross-check, Feodo/
SSLBL/crt.sh for cyber.

Per-source acceptance: sidecar route + zod-shaped validation, freshness metadata,
provider-redundancy registration, fixture test, and a consuming hub tab — a source
without a consumer is dark matter and out of scope.

---

## 5. Workstream D — UI/UX uplift

1. **Command Center as default home** — first screen on launch; top strip =
   personal impacts; then top-3 situations with confidence × urgency badges; then
   What Changed digest; then watch-next + actions. Everything clicks through to a hub.
2. **Sidebar v2** — search/filter field, favorites (pin to top, persisted),
   per-hub badge counts (active alerts), visible mode switcher (Ghost is currently
   keyboard/menu only).
3. **Panel header standard** — every hub tab gets the same header: title, freshness
   chip (live/stale + age), provenance popover (sources + confidence), overflow
   menu (share, open-in-window). One shared component; retires per-panel drift.
4. **Overlay discipline** — EEW bar, notification stack, triage bar, banners
   currently stack unbounded. Single `OverlayCoordinator` with a severity budget:
   max 2 simultaneous; rest collapse into the Alert Inbox count.
5. **Density + theme** — compact/comfortable toggle; surface the existing
   `data-theme="light"` support as a real setting.
6. Keep all current keyboard shortcuts; add hub-jump (⌘1–9 → hubs).

---

## 6. Workstream E — Security & quality hardening (interleave)

From the two scan docs, prioritize in this order (highest blast-radius first):
1. **SEC-001** remove/gate `get_all_secrets` renderer exposure.
2. **SEC-007/008** centralize `safe-html` utility; ban raw `innerHTML`; strip
   inline `style` from untrusted sanitizer paths; add XSS payload tests.
3. **SEC-002/003** CSP tightening (scope `127.0.0.1` to sidecar port; drop
   `unsafe-inline` on web; keep `unsafe-eval` only while Cesium requires it, per
   CSP posture note in CLAUDE.md).
4. **R2-SEC-001/002/003** `cargo audit`/`cargo deny` + Semgrep in CI; downgrade
   over-privileged workflow permissions.
5. **R2-SEC-005/006/007** relay/CORS fail-closed fixes.
6. Remaining items as a sweep PR with regression tests each.

Also: UI test debt — every new hub gets a mount + snapshot + alias-resolution test
(component tests exist, 91 files, but hub mounts must be covered).

---

## 7. Suggested PR sequence for Sonnet

Phased so each PR is independently shippable, ≤ ~600 LOC of hand-written change,
and keeps `npm run typecheck:all` at zero.

| # | PR | Workstream |
|---|---|---|
| 1 | Shortage input bridge (live EIA/FRED/weather → radar) | A1 |
| 2 | Diagnostics: Replay + Missions tabs | A2 |
| 3 | Safe-adjustment review queue (apply/dismiss/rollback) | A3 |
| 4 | Ask-The-Data wiring (Command Center chips + ⌘K + panel merge) | A4 |
| 5 | Notification ladder: shortage + big-event + ops routing | A5 |
| 6 | Datacenter readiness panel | A6 |
| 7 | Personal Impact strip + Share packet button | A7 |
| 8 | `HubPanel` base + `aliasOf` + sidebar v2 (search/favorites/mode switch) | B/D2 |
| 9 | Hub merge wave 1: Alerts, Notifications, System & Diagnostics | B |
| 10 | Hub merge wave 2: Weather & Hazards, Infrastructure, Health | B |
| 11 | Hub merge wave 3: Markets, Shortage & Supply Chain, Cyber | B |
| 12 | Hub merge wave 4: Conflict catalog, Maritime/Aviation/Space, Preparedness | B |
| 13 | Panel header standard + overlay coordinator | D3/D4 |
| 14 | Tier-1 sources: NetBlocks/IODA, recalls, FEMA/Overpass preparedness | C |
| 15 | Tier-1 sources: CAL FIRE, CrisisWatch; Tier-2: EPSS, CPC, grid status | C |
| 16 | Security wave: SEC-001, SEC-007/008 | E |
| 17 | Security wave: CSP + CI hardening (R2 items) | E |
| 18 | Command Center home + density/theme polish + docs refresh | D1/D5 |

**Every PR must:** keep `typecheck:all` at zero; run the relevant `test:*` scripts;
pass `npm run secrets:scan`; update `docs:check` expectations when panel/source
counts change; branch from `origin/main` as `claude/*`; respect the keychain
prohibition and the release-path mandate in CLAUDE.md. Reconcile against the open
PR queue (#128–#170 noted in `ELITE_REMAINING_GAPS_FOR_CLAUDE.md`) before starting
overlapping work.

---

## 8. Definition of "highest quality"

When this program is done, the bar is:

1. **Answer-first**: launch → within one screen you know what matters to *you* now,
   why, with what confidence, and what to do. No hunting through 280 panels.
2. **Explainable everywhere**: every score → ConfidenceBreakdown popover; every
   claim → provenance; every miss → replayable proof of the fix.
3. **Honest**: staleness, data gaps, single-source verdicts, and contradictions are
   rendered, never hidden.
4. **Comprehensive *and* redundant**: 48+ domains, with the critical gaps
   (shutdowns, recalls, preparedness resources, unrest, grid) closed and ≥2
   providers on every life-safety domain.
5. **Personal**: saved places, watchlist, portfolio, and travel routes drive
   ranking, notification urgency, and recall/impact matching.
6. **Operable**: self-tests, replay harness, feed health, and algorithm review are
   first-class UI — the system demonstrates its own reliability.
