# Correlation Engine Next-Gen Plan

> **For agentic workers:** Implementing sessions must read this doc first and update the
> Progress Tracker in the same commit as the work it describes. Each PR below is one
> reviewable branch off `origin/main` with ≥10 tests, `npm run typecheck:all` green, and a
> real Codex cross-agent review.

**Goal:** Turn the live correlation path into a calibrated, statistically honest,
regime-aware engine whose output feeds Situations, compound risk, and the survival
posture axes — instead of three parallel silos with hardcoded confidence.

**Architecture:** Upgrade the ONE live path (`observation-store` → `CorrelateEngine` +
`builtInCorrelationRules` → `SituationStoreV2`) in place with new pure modules under
`src/services/correlation/`. No fourth subsystem. Dead correlators retire at the end.

**Tech stack:** Pure deterministic TypeScript (no DOM/fetch/globals at import), fixture
tests via `node --test` + tsx, existing calibration spine (`forecast-calibration.ts`),
existing BOCPD (`cognition/regime-detection.ts`), existing `PostureContributor` seam.

---

## Progress Tracker

| PR | Branch | Scope | Status | PR # |
|----|--------|-------|--------|------|
| 1 | `claude/correlation-nextgen` | Plan doc + calibrated edge-confidence core + engine adoption | in progress | — |
| 2 | `claude/corr-nextgen-pr2-outcomes` | Correlation outcome ledger → per-rule reliability multipliers | pending | — |
| 3 | `claude/corr-nextgen-pr3-leadlag` | Statistical lead-lag miner + learned-rule generation | pending | — |
| 4 | `claude/corr-nextgen-pr4-regime` | Regime-aware modulation (BOCPD coupling) | pending | — |
| 5 | `claude/corr-nextgen-pr5-emission` | Emission unification: pair persistence + live compound risk + survival contributor | pending | — |
| 6 | `claude/corr-nextgen-pr6-retire` | Retire dead correlators v1/v2, migrate diagnostics exports, docs | pending | — |

### Session Protocol

1. `git fetch origin` and branch the next PR off `origin/main` in an **isolated worktree
   with its own `npm ci`** (shared `node_modules` corrupts under concurrent sessions).
2. Read the relevant "PR N" section below AND the Design Decisions — do not re-derive.
3. TDD: write fixture tests first, keep every module pure (inject clocks/providers).
4. Before PR: `npm run typecheck:all`, the relevant `test:*` suites, lint on touched files.
5. Real Codex review (`codex exec --sandbox read-only "<prompt>" < pr.diff`), iterate to
   clean, record the honest `cross-agent review: Codex` marker in the PR body.
6. Auto-merge cascade is stalled (no AUTO_MERGE_PAT): drive `gh pr update-branch` manually.
7. Update the Progress Tracker + this doc in the same PR.

---

## 1. Recon Findings (July 2026) — why this program exists

Verified against `origin/main` @ 9c09396a. Three parallel, mutually incompatible
correlation subsystems exist:

| Subsystem | Core type | Live? | Feeds |
|-----------|-----------|-------|-------|
| A. `observation-store` → `CorrelateEngine` → `SituationStoreV2` | rich `ObservationEvent` (`@/types/intelligence`) | **YES** | situations, hypotheses, evidence-graph-v2, panels |
| B. `correlator.ts` (v1) + `correlator-v2.ts` (PR #440 "causal chains") | slim, incompatible `ObservationEvent` (`observation-types.ts`) | dead — never bootstrapped | diagnostics export bundles only |
| C. `alert-correlator.ts` (notification island) | `UnifiedAlert` | YES | notifications/triage |

Specific gaps the PRs close:

- **G1 — Uncalibrated confidence.** `correlate-engine.ts:154-165`: confidence is a pure
  linear time-decay (`1 − 0.7·gap/window`, floor 0.3) or a fixed `baseConfidence`. No
  spatial term, no entity term, no learned reliability — while a full calibration spine
  (`forecast-calibration.ts` Brier scoring, per-source multipliers, reliability curves,
  hourly LLM outcome grading) sits unused by correlation.
- **G2 — No feedback loop on the live path.** The only correlation feedback
  (`correlation-feedback.ts`, user ack/pin behavior → 0.5–1.2 multiplier) feeds ONLY the
  notification island (`alert-correlator.ts`). Live-path rules never learn.
- **G3 — Statistically naive lead-lag.** `learned-cascades.ts` `mineCascades` counts
  "B follows A" with **no base-rate normalization** — a chatty domain "follows"
  everything. Its output feeds only `compound-risk.cascadePair()`, and compound-risk is
  **dormant** (`trackedComputeCompoundRisk` has zero live callers).
- **G4 — Regime shifts are UI-terminal.** BOCPD (`cognition/regime-detection.ts`) emits
  `RegimeShift`s consumed only by TriageBar/SummaryStrip chips. No engine consumes them.
- **G5 — Emission silos.** Live `CorrelatedPair`s are converted to situation edges and
  discarded — `correlation-store.ts` (read by `crisis-signature.ts`) is populated by a
  different path and can diverge. No correlation signal reaches the survival posture axes
  (`PostureContributor` seam unused for this) or notifications.
- **G6 — Dead code confusion.** Subsystem B is unreachable (physically cannot read the
  live store — wrong `ObservationEvent` shape) yet exports the names future sessions grep
  for first. `momentum.ts` and `ood-decay.ts` are complete, tested, and unwired.

## 2. Design Decisions

**D1 — Upgrade in place, no fourth silo.** All new logic is pure modules under
`src/services/correlation/`; the live engine adopts them via injected options.
`SituationStoreV2` already accepts `options.engine` — that is the integration seam.

**D2 — Calibrated multi-factor edge confidence.** Replace the time-decay-only score:

```
value = clamp( base × temporal × spatial × entity × reliability × regime, 0.2, 1 )
```

- `temporal` — exponential kernel `exp(−ln2 · gap / (window/2))` (1.0 at gap 0, 0.5 at
  half window, ≈0.25 at full window). Smoother than linear; recency matters most early.
- `spatial` — only when **both** events carry a location: `max(0.5, exp(−max(0, d−25)/400))`
  (neutral ≤25 km, half-weight by ~300 km beyond). Missing location on either side →
  neutral 1.0 (absence of information is not evidence against; global domains like cyber
  and markets are unlocated by design).
- `entity` — `1 + 0.15·min(sharedEntityIds, 2)`, capped: shared entities are corroboration.
- `base` — `rule.baseConfidence ?? 1`. **Semantics change (documented):** baseConfidence
  stops being a hard override and becomes the base factor with `temporal` forced to 1.0
  (preserving the rule author's "temporal decay is misleading" intent) while spatial /
  entity / reliability still modulate. High-conviction rules keep their conviction but can
  now be corrected by learned reliability.
- `reliability` — per-rule learned multiplier from the correlation outcome ledger (PR 2),
  clamp [0.5, 1.5], neutral 1.0 until ≥5 resolved outcomes for that rule.
- `regime` — BOCPD coupling factor (PR 4), neutral 1.0 until then.
- Output is `EdgeConfidence { value, factors, explanation }` — plan invariant: every
  score explains itself. `CorrelatedPair.confidence` stays `number` (non-breaking);
  a new optional `confidenceDetail` carries the breakdown.

**D3 — Correlation outcomes ARE predictions; reuse the calibration spine.** Every emitted
pair is an implicit forecast: "these events are genuinely related — corroboration will
follow." Record it as a `PredictionRecord` (`sourceId: 'corr-rule:<ruleId>'`) into a
**dedicated** `ForecastCalibrationStore` instance (own persist key, own cap — never crowd
the shared 500-record singleton). Resolution is deterministic:

- *resolved_true*: the situation containing the pair accretes ≥1 further observation or
  pair within the horizon (default 24 h), or user feedback (ack/pin via the existing
  `correlation-feedback` signals, bridged from the notification island).
- *resolved_false*: situation auto-resolves with no accretion, or explicit dismissal.
- Per-rule reliability then falls out of the existing pure `perSourceMultipliers`
  (Brier-based, clamp [0.5, 1.5], min 5 resolved) — rule-as-source. No new math.
- Flood control: record at most `MAX_RECORDS_PER_RULE_PER_HOUR` (default 5) predictions
  per rule; correlation volume must never starve the ledger.

**D4 — Lead-lag discovery with statistical honesty.** `mineLeadLag` supersedes naive
`mineCascades` counting by normalizing against the consequent's base rate:

- Poisson base rate `λ_B = count(B) / observedSpan`; expected follow probability under
  independence `p0 = 1 − exp(−λ_B · window)`.
- `lift = followRate / p0`; binomial z-score `(support − n·p0) / sqrt(n·p0·(1−p0))`.
- An edge is significant iff `lift ≥ 2 && z ≥ 2 && support ≥ 3`. Deterministic, no deps.
- Significant edges become **auto-generated correlation rules** (`learned:<from>→<to>`,
  window from the observed lag p90, `edgeType: 'causal-candidate'`, capped at 12 rules,
  refreshed by the existing hourly cadence) registered into the LIVE engine — so
  discovered couplings actually correlate future events, not just annotate compound risk.
  The existing `compound-risk` pair registration contract is preserved.
- Learned rules carry no `baseConfidence` → full kernel scoring + reliability learning
  applies; a bogus learned rule self-corrects via D3.

**D5 — Regime shifts modulate correlation.** During a BOCPD-detected regime shift, the
world is re-organizing and cross-domain coupling strengthens. Pure `regime-coupling.ts`
maps active `RegimeShift`s (pressure-domain → observation-domain) into (a) a confidence
factor: both pair domains shifted within the coupling window → 1.15, one → 1.05, none →
1.0; (b) a rule window multiplier 1.5× for rules touching a shifted domain. The engine
receives a `RegimeContext` snapshot via provider injection — the module never reads
singletons itself.

**D6 — One emission fan-out.** The live path's pairs get persisted to the existing
`correlation-store` (killing the divergence in G5), compound risk goes LIVE on a cadence
fed by active situations, and a new `PostureContributor` translates high-confidence
cross-domain correlation activity into survival-axis heat (`storm-posture-state`
contributor registration) — which the E4 personal lens already reads as `axisHeat`.
Read-surface guardrail: posture axes (TriageBar / board tint) + Command Center are the
surfaces; nothing merges dark.

**D7 — Dead code retires.** `correlator.ts`, `correlator-v2.ts`, `observation-types.ts`
and their diagnostics-export references migrate to the live equivalents. One canonical
`ObservationEvent` remains.

**Non-goals (this program):** replacing `alert-correlator.ts` (notification island keeps
working; its feedback signals get bridged in, full unification is a later program);
ML/embedding-based correlation; entity resolution overhaul; SituationStoreV2 →
notification bridging (tracked as a candidate follow-on).

## 3. File Map

```
src/services/correlation/
  edge-confidence.ts            PR 1  multi-factor kernel scoring + breakdown
  correlation-outcomes.ts       PR 2  pure pair→prediction recording + resolution logic
  correlation-calibration.ts    PR 2  dedicated store instance + reliabilityForRule()
  lead-lag.ts                   PR 3  statistical miner (lift, z, lag quantiles)
  learned-rules.ts              PR 3  significant edges → CorrelationRule[] (capped)
  regime-coupling.ts            PR 4  RegimeContext + factors + window multipliers
  compound-risk-cadence.ts      PR 5  situations → CompoundRiskInput[] → live result store
src/services/survival/
  correlation-contributor.ts    PR 5  PostureContributor: correlation/compound → axis heat
Modified:
  src/services/intelligence/correlate-engine.ts        PR 1 (options + delegate), PR 4 (regime)
  src/services/intelligence/situation-store-v2.ts      PR 2 (accretion hook), PR 5 (pair persist)
  src/services/intelligence/cascade-registration.ts    PR 3 (mineLeadLag + rule registration)
  src/services/survival/storm-posture-state.ts         PR 5 (register contributor)
  src/app/panel-layout.ts                              PR 5 (compound cadence bootstrap)
Deleted (PR 6):
  src/services/intelligence/correlator.ts / correlator-v2.ts / observation-types.ts
  (+ migrate diagnostics/export-bundle.ts, frontend-export-composer.ts)
```

## 4. PR Specifications

### PR 1 — Calibrated edge-confidence core (+ this doc)

**Create `src/services/correlation/edge-confidence.ts`** (pure):

```ts
export interface EdgeConfidenceInput {
  gapMs: number;                 // |a.timestamp − b.timestamp|
  timeWindowMs: number;          // rule window
  baseConfidence?: number;       // rule.baseConfidence
  distanceKm?: number;           // undefined when either event lacks location
  sharedEntityCount: number;
  reliability?: number;          // per-rule multiplier, default 1
  regimeFactor?: number;         // default 1
}
export interface EdgeConfidenceFactors {
  base: number; temporal: number; spatial: number;
  entity: number; reliability: number; regime: number;
}
export interface EdgeConfidence {
  value: number;                 // clamp [0.2, 1], 4-dp rounded
  factors: EdgeConfidenceFactors;
  explanation: string;
}
export function computeEdgeConfidence(input: EdgeConfidenceInput): EdgeConfidence;
export function sharedEntityCount(a: readonly string[], b: readonly string[]): number;
export function pairDistanceKm(a: ObservationEvent, b: ObservationEvent): number | undefined;
```

Formulas exactly as in D2. Explanation string enumerates non-neutral factors, e.g.
`"temporal 0.71 (gap 2.1h of 6h window) · spatial 0.93 (dist 55km) · entity ×1.15 (1 shared)"`.

**Modify `correlate-engine.ts`:** add
`CorrelateEngineOptions { reliabilityFor?: (ruleId: string) => number; regimeFactorFor?: (a, b) => number }`
(constructor arg, default `{}` — back-compat). `computeConfidence` delegates to
`computeEdgeConfidence`; `CorrelatedPair` gains `confidenceDetail?: EdgeConfidence`.

**Tests (`src/services/correlation/__tests__/edge-confidence.test.ts` + engine tests),
≥14:** kernel endpoints (gap 0 → 1.0; half window → 0.5 temporal), floor clamp, spatial
neutral when unlocated / ≤25 km / decay at 300 km / floor 0.5, entity boost 0/1/2/3-shared
cap, baseConfidence forces temporal=1 but spatial+reliability still modulate, reliability
neutral default, explanation mentions each non-neutral factor, engine option injection,
`CorrelatedPair.confidence === confidenceDetail.value`, existing engine suite stays green
(update expectations where linear→exponential shifts values; assert new values explicitly).

### PR 2 — Correlation outcome ledger

**Create `correlation-outcomes.ts`** (pure): `pairPredictionId(pair)`,
`shouldRecordPair(pair, recentCountForRule, opts)` (flood control),
`buildPairPrediction(pair, now): PredictionRecord` (probability = pair confidence, domain
via `factDomainFor(observationDomain)` mapping helper with explicit fallback),
`resolveFromAccretion(situationBefore, situationAfter, pairId, horizonMs, now):
'resolved_true' | 'resolved_false' | null` (null = still pending).

**Create `correlation-calibration.ts`**: dedicated `ForecastCalibrationStore` (persist key
`crystalball-correlation-calibration-v1`, cap 400), `recordPairPrediction`,
`resolvePairPrediction`, `reliabilityForRule(ruleId): number` (wraps
`perSourceMultipliers`, neutral 1.0 under 5 resolved), `expireStale()`.
Bridge user signals: subscribe to the same ack/pin events `correlation-feedback.ts`
consumes; ack/pin → resolve true, dismiss → resolve false.

**Wire:** `SituationStoreV2.ingest` calls an injected optional
`onPairsEmitted(pairs, situationId)` callback (constructor option — store stays pure);
the singleton wiring in `intelligence-state`/bootstrap connects it to the ledger and
passes `reliabilityForRule` into the engine options from PR 1.

**Tests ≥14:** flood control caps per rule per hour; prediction shape (id stable,
probability = confidence); accretion → true; auto-resolve-without-accretion → false;
pending inside horizon; reliability neutral <5, degrades on misses, boosts on hits, clamps
[0.5, 1.5]; persistence round-trip; dedicated store never touches the shared singleton
key; feedback bridge resolves; end-to-end: miss-heavy rule's next pair scores lower.

### PR 3 — Statistical lead-lag + learned rules

**Create `lead-lag.ts`**: `LeadLagEdge` as in D4 (`from, to, support, antecedents,
followRate, expectedRate, lift, zScore, medianLagMs, lagP90Ms, strength, explanation`),
`mineLeadLag(events: readonly DomainEvent[], opts): LeadLagEdge[]`,
`significantEdges(edges, opts): LeadLagEdge[]`. `strength` = bounded blend of lift and z
(`min(1, (min(lift,4)/4)·0.6 + (min(z,4)/4)·0.4)`), explained.

**Create `learned-rules.ts`**: `learnedRulesFromEdges(edges): CorrelationRule[]` —
id `learned:<from>-><to>`, `timeWindowMs = clamp(lagP90Ms, 1h, 7d)`, matchFn checks
domain identity + temporal order (consequent after antecedent), no `baseConfidence`,
cap `MAX_LEARNED_RULES = 12` by strength. `syncLearnedRules(engine, rules)` unregisters
stale `learned:*` ids, registers current set.

**Modify `cascade-registration.ts`**: mine via `mineLeadLag`; keep
`registerLearnedCascadePairs(cascadePairKeys(...))` compound-risk contract (adapter from
`LeadLagEdge` → key set); additionally `syncLearnedRules` on the live SituationStoreV2
engine each cadence tick.

**Tests ≥16:** base-rate math (λ, p0) exact on fixtures; chatty-consequent domain that
naively "follows" everything gets lift ≈ 1 and is NOT significant (the G3 regression
test); genuine lagged coupling is significant; z-score sanity; quantiles; cap at 12 by
strength; rule matchFn direction (B-after-A matches, A-after-B does not); sync
adds/removes `learned:*` without touching built-ins; cadence keeps compound-risk keys
flowing; empty/degenerate inputs (0 events, single domain, span 0).

### PR 4 — Regime coupling

**Create `regime-coupling.ts`** (pure): `RegimeContextEntry { domain, detectedAt,
direction }`, `buildRegimeContext(shifts: readonly RegimeShift[], domainMap, now,
maxAgeMs = 6h): RegimeContext`, `regimeFactorFor(domainA, domainB, ctx): { factor: 1 |
1.05 | 1.15; note?: string }`, `windowMultiplierFor(ruleDomains, ctx): 1 | 1.5`.
Pressure-metric → observation-domain map is an explicit exported constant.

**Wire:** engine consumes `regimeFactorFor` via the PR 1 options; window multiplier
applies in `applyRule`'s time gate; the bridge builds context from
`getActiveRegimeShifts()` (kill-switch respected — empty context when disabled) and
annotates `confidenceDetail.explanation` with the regime note.

**Tests ≥12:** factor 1.0/1.05/1.15 cases; context expiry at maxAgeMs; window multiplier
widens matching only for touched domains; empty shifts → all neutral; kill-switch path;
explanation carries note; determinism with injected now.

### PR 5 — Emission unification + survival contributor

- `SituationStoreV2` persists emitted pairs to `getCorrelationStore()` via the PR 2
  `onPairsEmitted` hook wiring (no new store API).
- **Create `compound-risk-cadence.ts`**: `situationsToCompoundInputs(situations):
  CompoundRiskInput[]` (pure mapper), `startCompoundRiskCadence({ intervalMs = 1h })` →
  runs `trackedComputeCompoundRisk`, keeps `latestCompoundRisk()` snapshot + subscribe.
  Bootstrap in `panel-layout.ts` beside the other cadences (`:1101` block).
- **Create `survival/correlation-contributor.ts`**: `PostureContributor` with
  `id: 'correlation'`; reads injected getters (latest compound result + recent
  high-confidence (≥0.6) cross-domain pairs ≤6 h old); maps domain → `SurvivalAxis` via
  an exported map aligned with personal-lens `DOMAIN_AXIS`; `severity` from compound
  score (capped 85 — correlation is inference, not observation); `why` from pair/chain
  explanations. Register in `storm-posture-state.ts` contributors array.
- **Tests ≥14:** situation→input mapping (severity, domains, centroid, entities);
  cadence snapshot + subscribe (fake timers/injected clock); contributor axis mapping
  per domain; severity cap; empty states produce no threats; stale pairs excluded;
  pair persistence reaches correlation-store exactly once per pair (dedup key respected);
  posture integration — axis level rises when contributor fires (compose with
  `computeMultiAxisPosture` fixture).

### PR 6 — Retirement + docs

Delete `correlator.ts`, `correlator-v2.ts`, `observation-types.ts`; migrate
`diagnostics/export-bundle.ts` + `frontend-export-composer.ts` to compose their
correlation sections from `getCorrelationStore()` + `SituationStoreV2` (same JSON section
names, values from the live path — diff the export shape in tests). Update CLAUDE.md
(Architecture list + this plan's pointer), `docs/reasoning-layer.md` if it references the
dead files. Tests ≥10: export bundle golden shape, no dangling imports (typecheck is the
real gate), correlation-store-backed sections populated from a seeded store.

## 5. Invariants (inherited from the intelligence layers — enforced in review)

- Every score includes an explanation (EdgeConfidence.explanation, LeadLagEdge.explanation).
- Every learned adjustment is bounded (reliability [0.5,1.5], regime ≤1.15, learned rules ≤12).
- Stale/missing data reduces or neutralizes confidence — never silently disappears.
- Pure modules: clocks, singletons, and regime/reliability providers are injected.
- No live fetch in unit tests; fixtures only.
- Deterministic: same inputs → same outputs (no Date.now()/Math.random() in pure code).
