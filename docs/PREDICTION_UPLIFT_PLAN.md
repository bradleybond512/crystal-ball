# Prediction & Correlation Uplift Plan

> Status: **ACTIVE** — 13-PR program across 4 workstreams.
> Created 2026-07-21. Successor to `CORRELATION_NEXTGEN_PLAN.md` (COMPLETE) and
> `COGNITIVE_ENHANCEMENT_PLAN.md` (COMPLETE — all 16 PRs merged; tracker marks on
> PRs 12/14/16 are stale, see #1357/#1372/#1373).

## Why this program

The 2026 PR waves built sophisticated *consumers* of outcome data — PAV
recalibration curves, conformal intervals, per-rule Brier reliability, BOCPD
regime coupling, self-tuning with drift watch. The bottleneck has inverted:
**the system is compute-rich and label-poor.** Whole subsystems contribute zero
resolved predictions, several finished seams were never wired to live call
sites, and the next-gen correlation engine has no benchmark guarding it.

Audit findings (2026-07-21, verified against `origin/main` @ `ba5c100e`):

- `src/services/shortage/shortage-calibration-bridge.ts` — pure, tested,
  exports the full `recordShortagePredictions` / `resolveShortageFromObservation`
  / `settleExpiredShortagePredictions` API. **Zero live call sites.**
- `src/services/intelligence/mode-forecast-prediction-bridge.ts` — same:
  pure, mirrors the shortage bridge design. **Zero live call sites.**
- `src/components/CorrelationMapPanel.ts` — reads the in-process causal-chain
  builder and renders chains as a list (the old sidecar route is producerless);
  the kernel-scored pairs (`correlation-store`, edge-confidence factor
  breakdowns, `learned:*` rules, regime boosts) have no surface at all.
- `significantEdges()` in `lead-lag.ts` applies fixed thresholds only
  (`lift≥2 && z≥2 && support≥3`) — the "Bonferroni-corrected" claim in
  CLAUDE.md/older docs is NOT in the code. C1 adds a real correction.
- Cognition PR 6 explicit leftovers: EVOI question-suggester re-ranking,
  calibration report card, `pushRecalibrationPair` wiring (parked on
  render-path flood risk).
- `analyst-loop` records episodes with hardcoded `entities: []`, so PR 14's
  contradiction-flagging bridge (`contradictEpisodesForRefutation`) almost
  never fires — episodic memory gets no contradiction hygiene.
- Recalibration needs n≥30 resolved records per domain, conformal n≥40. Thin
  domains stay permanently uncalibrated without more ground truth.
- The lead-lag miner is strictly pairwise A→B with fixed-window Poisson base
  rates; no inhibitory edges, no confounder control, weak on bursty streams.
- `bench:cognition` gates CI; the CorrelateEngine has **no** equivalent
  precision benchmark.
- Edge-confidence kernel weights are hardcoded — unreachable by the tuning
  loop even though the correlation outcome ledger now grades exactly what they
  produce. Only `correlation-feedback` is in the algorithm registry.

## Invariants (apply to every PR)

- Pure, deterministic service cores: no DOM, no fetch, no globals, no
  `Date.now()` inside pure functions (inject `now`). Fixture tests only.
- Every score carries an explanation; every claim carries provenance; stale
  data reduces confidence rather than disappearing; contradictions surface.
- New live behaviors get kill-switches following the `cognition-settings.ts`
  pattern (fail-safe ON, typed keys).
- Safety asymmetries: anything that can only make alerts *quieter* (inhibitory
  edges, dampeners) must be boost-only in the safe direction — it may reduce
  confidence scores but must never suppress safety-critical delivery rungs.
- Prediction recording must be dedupe-guarded (signature/watermark keyed) so a
  refresh cadence can never flood the ledger with duplicates of one forecast.
- House process: `claude/*` branch per PR, cross-agent (Codex) review,
  `typecheck:all` at zero, update the Progress Tracker in the same commit.

## Ordering rationale

Workstream A first (thin wiring on tested seams — immediate data flow).
B1–B2 next (ground truth volume compounds with time — start the clock early).
**D1 (correlation benchmark) lands before any Workstream C engine change** so
v-next statistics are measured against a frozen baseline, not vibes.
C1–C4 then evolve the engine under that gate. B3 is independent and can
interleave. D2 (tunable kernel weights) is last — tuning only after the
benchmark exists to catch a bad knob excursion.

```
A1 → A2 → A3 → A4 → B1 → B2 → D1 → C1 → C2 → C3 → C4 → B3 → D2
                    └── B-PRs may interleave with A after A1 ──┘
```

---

## Workstream A — Close the dark wiring (4 PRs)

### PR A1 — Wire both calibration bridges live

- Call `recordShortagePredictions()` at the live shortage recompute site (the
  `ShortageRadarPanel.setRequests()` host path / data-loader shortage refresh),
  keyed by the bridge's own `shortagePredictionId` so re-renders dedupe.
- Add a settle cadence: `settleExpiredShortagePredictions()` on an existing
  slow tick (piggyback the 30s provider tick or a dedicated 1h interval —
  prefer the existing tick; no new timers if avoidable).
- Hook `resolveShortageFromObservation()` where fresh commodity inputs arrive
  (data-loader), so price/inventory reversals resolve open predictions.
- Same treatment for `mode-forecast-prediction-bridge.ts` at the mode-forecast
  EWMA update site.
- Kill-switch: one `'calibration-bridges'` flag covering both (kebab-case,
  matching the existing cognition switch keys).
- Tests: call-site wiring tests with fake stores (the bridges themselves are
  already tested); dedupe-under-refresh regression test.

### PR A2 — CorrelationMapPanel reads the live engine

- Renderer-first: read live pairs from the correlation store fed by
  `pair-persistence.ts`; keep the sidecar fetch as web/desktop-boot fallback.
- Show per-pair kernel factor breakdown (temporal / spatial / entity /
  reliability / regime — the `explained` contract already exists in
  `edge-confidence.ts`), `learned:*` badge for mined rules, regime-boost
  indicator when regime coupling contributed.
- No new scoring logic — display only. Pure view-model module
  (`correlation/correlation-map-view.ts`) + panel render glue.

### PR A3 — Cognition PR 6 leftovers

- EVOI re-ranking: `question-suggester.ts` re-ranks its 3 investigative chips
  by expected-bits from `evoi-planner.ts` (pure re-rank, feature-flagged).
- Calibration report card: extend the Surfacing-Move-2 calibration report into
  a per-domain report card (reliability curve summary, n, Brier trend) in the
  AnalystHUD or SystemDiagnostic — decide placement at implementation time by
  where the existing report already renders.
- `pushRecalibrationPair` wiring with flood control: push at forecast-compute
  time — the only point where both the legacy and recalibrated legs exist
  (the prediction bridge stores a single probability, so resolution time has
  only one leg) — capped 1-per-signature-per-hour, matching the
  superforecast-state push-at-compute precedent. This resolves the deferral
  reason (render-path flood) structurally: compute time is not render time,
  and the cap bounds shadow-ledger churn. (Amended per Codex review.)

### PR A4 — Entity vocabulary alignment

- `analyst-loop` episode producers populate `entities` from
  `hypothesis-entities.ts` extraction instead of `[]`.
- Shared slug-normalizer (`intelligence/entity-slug.ts`) used by both episode
  producers and `situation-store-v2` `entityIds` writers so the two
  vocabularies converge (`'Suez Canal'` → `'suez-canal'`).
- Result: PR 14's `contradictEpisodesForRefutation` starts firing for real.
- Tests: fixture refutation ends-to-end marks the analog episode contradicted;
  slug normalizer table tests.

## Workstream B — Ground-truth expansion (3 PRs)

Design principle: **resolvability is declared at emit time, not guessed at
resolve time.** `PredictionRecord` gains optional structured `criteria`
(typed per resolver kind) plus a `resolutionNote` written at resolve time. A
resolver only touches predictions that declared criteria it can evaluate.
Indirect-evidence resolutions carry a `proxy:`-prefixed note (verified:
`proxy-outcomes.ts` stores NO marker on records today — the proxy nature
lives in the caller; the note field makes it durable) — extend, never
duplicate.

### PR B1 — Resolver framework + market-move resolver

- `intelligence/outcome-resolvers.ts`: `OutcomeResolver` contract — pure
  `(prediction, observations, now) → resolution | null`, registered per
  domain; one dispatch cadence walks open predictions (piggyback an existing
  slow tick).
- Market resolver: directional/threshold claims resolve against the fused
  stocks/crypto price series already in the app.
- Every resolution carries provenance (which resolver, which observations) in
  its explanation.

### PR B2 — Weather verification resolver

- NWS warnings are verifiable: warning-class alerts (nationwide, capped at 50
  open records with ≤32-point simplified polygons so the 500-cap shared store
  and localStorage never bloat — Codex review) resolve by whether a matching
  LSR storm report occurred inside the polygon + window, using the existing
  weather pipeline types and the SPC/LSR feed already fetched in the same
  loader tick. Expired without verification → resolved_false (proxy-noted,
  since absence of a report is weaker evidence than presence).
- Feeds the weather domain — currently one of the highest-volume prediction
  producers with the weakest resolution coverage.

### PR B3 — Conflict/geo event confirmation resolver

- Escalation-type hypotheses resolve against subsequent conflict/news event
  streams already ingested: deterministic matcher on entity overlap (via the
  A4 slug vocabulary) + region + event-type within the stated horizon.
  Proxy-marked; conservative thresholds; misses stay unresolved rather than
  guessing.

## Workstream C — Correlation engine v-next (4 PRs)

All four land behind the D1 benchmark: each PR must show the frozen-fixture
metrics moving the intended direction (or provably unchanged) in its PR body.

### PR C1 — Inhibitory edge mining

- Extend `lead-lag.ts`: for pairs with sufficient A-support, test
  UNDER-representation of B-follows (`lift ≤ 0.5 && z ≤ −2 && support(A) ≥ 5`,
  plus a base-rate floor — absence is only informative when B was likely).
  Same PR adds a real multiple-comparison floor (union-bound z) to BOTH the
  positive and inhibitory paths, making the docs' correction claim true.
- Emit `inhibits:` edges consumed as confidence *dampeners* in compound risk /
  negative evidence — never as firing rules, never touching delivery rungs
  (safety asymmetry above).

### PR C2 — Multi-hop chains with confounder control

- From the significant pairwise edge set: for A→B and B→C, compute conditional
  lift of A→C partitioned on interposed-B. If `lift(A→C | ¬B)` collapses to
  ~1, A→C is mediated: suppress the direct `learned:` rule and surface the
  triple ("A→C explained by B") on the map panel. (`causal-chain.ts` has no
  domain-level candidate queue — its `buildChain` API is observation-level, so
  the A→B/B→C rules compose into chains naturally at the pair level instead.)
- Deterministic, corrected across the (small) candidate set; capped like the
  existing 12-rule learned cap.

### PR C3 — Hawkes-lite self-exciting base rates

- Bursty domains (quakes, cyber) violate the Poisson variance assumption and
  inflate false "significant" edges beyond what de-clustered trials already
  absorb. Fix: dispersion-corrected z (quasi-Poisson) — measure the
  variance-to-mean ratio of consequent counts over window-sized bins and
  deflate `z` by `√dispersion`. Deterministic, no process fitting; falls back
  to uncorrected under a minimum-event floor.
- Acceptance: on D1's planted-confounder bursty fixture, the false-edge count
  drops; accepted true edges unchanged.

### PR C4 — Per-regime rule reliability

- `correlation-calibration.ts` ledger entries gain a regime tag (active BOCPD
  shift state at outcome-record time). Per-rule Brier computed overall AND
  per-regime; the engine's reliability provider prefers the regime-conditional
  bucket when its n≥20, else overall. Same Laplace shrinkage as today.

## Workstream D — Measurement gates (2 PRs)

### PR D1 — Correlation benchmark + CI gate  *(lands before Workstream C)*

- `correlation/__bench__/golden-streams.ts`: 8–10 frozen observation streams
  across domains — planted causal pairs, planted independents, a bursty
  confounder stream, an inhibitory pair (dormant until C1).
- `bench-correlation.ts`: replay through the real `CorrelateEngine` +
  lead-lag miner; report pair precision/recall vs planted truth, learned-rule
  false-positive count, edge-confidence separation (mean confidence of true
  pairs minus false pairs).
- `bench-baseline.json` + `npm run bench:correlation` + a `smoke.yml` step,
  mirroring `bench:cognition` exactly (fail on precision regression beyond
  tolerance or unacknowledged stream-count drift).

### PR D2 — Tunable kernel weights + safety fixtures  *(last)*

- Declare the `edge-confidence.ts` kernel factor weights as bounded tunables
  in `tunable-params-store` (defaults = current values; empty store =
  byte-identical behavior, per the PR 12 convention).
- Register the correlation edge algorithm in `algorithm-registry`, graded from
  the correlation outcome ledger.
- Safety-fixture suite per knob (the `episodic-analog:minSim` discriminating
  pattern: block clearly-bad values, allow adjacent); knobs without a suite
  fail closed → `held_for_approval`.
- D1's benchmark is the backstop against a bad excursion reaching main.

---

## Operator decision points

Flagged for Bradley during implementation (each shapes behavior, ~5–10 lines):

1. **B1 resolution strictness** — how conservative `resolutionCriteria`
   matching should be (exact threshold cross vs banded) trades resolution
   volume against label noise. Lives in `outcome-resolvers.ts`.
2. **D1 regression tolerances** — precision/false-positive budgets in
   `bench-baseline.json` set how hard CI pushes back on engine evolution.
3. **A3 report-card placement** — AnalystHUD vs SystemDiagnostic tab.

## Progress Tracker — UPDATE THIS EVERY SESSION

> Status markers (house convention): 🔲 Pending · 🔄 In progress / partial ·
> ✅ Done (merged to main) · ❌ Blocked

| PR | Feature | Status | Branch | Notes |
|----|---------|--------|--------|-------|
| A1 | Wire both calibration bridges live | ✅ | claude/uplift-a1-calibration-bridges | Merged #1495 — resolve-before-record wiring, live-input gate (Codex P1), isolated settlers (Codex P2) |
| A2 | CorrelationMapPanel → live engine | ✅ | claude/uplift-a2-live-pair-surface | Merged #1498 — live pairs section (view-model + panel glue), Codex P2 malformed-entry guard included |
| A3 | Cognition PR 6 leftovers | 🔄 | claude/uplift-a3-pr6-leftovers | committed locally, not yet merged |
| A4 | Entity vocabulary alignment | 🔄 | claude/uplift-a4-entity-vocab | Shared `slugifyEntity` normalizer + analyst-loop episode entities populated from hypothesis-entities extraction + contradiction matcher slug-normalized on both sides; awaiting cross-agent review |
| B1 | Resolver framework + market resolver | 🔲 | | |
| B2 | Weather verification resolver | 🔲 | | |
| B3 | Conflict confirmation resolver | 🔲 | | |
| C1 | Inhibitory edge mining | 🔲 | | |
| C2 | Multi-hop chains + confounder control | 🔲 | | |
| C3 | Hawkes-lite base rates | 🔲 | | |
| C4 | Per-regime rule reliability | 🔲 | | |
| D1 | Correlation benchmark + CI gate | 🔲 | | ⚠ must merge before C1–C4 |
| D2 | Tunable kernel weights | 🔲 | | last PR of the program |

## Session Protocol

1. Read this doc first; take the lowest-numbered 🔲 PR whose dependencies are
   ✅ (respect the ordering diagram — D1 before any C).
2. Work in an isolated worktree (`.worktrees/<feature>`), branch `claude/*`.
3. Verify claims against the current tree before building — this doc's audit
   was accurate as of `ba5c100e` (2026-07-21) but seams move.
4. Update the Progress Tracker row in the same commit as the work.
5. Cross-agent (Codex) review before merge; `typecheck:all` zero; relevant
   `test:*` scripts green.
