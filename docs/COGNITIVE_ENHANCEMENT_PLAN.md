# Crystal Ball — Cognitive Enhancement Plan

> Created: 2026-06-10 · Status: PLANNED · Audience: Claude Sonnet implementation sessions
> Planned by: Claude (Opus-class planning session) against the live codebase at v2.25.x

This is both the **feature roadmap** (Part A) and the **technical design**
(Part B) for the next wave of cognitive capability: AI reasoning/prediction
plus memory & personalization. It follows the house plan style
(`docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md`): a PR stack of pure
deterministic services, fixture-tested, UI wiring last.

---

## Why these five features (gap analysis)

Crystal Ball already has a deep reasoning stack — Bayesian belief states
(`belief-state-manager.ts`), meta-confidence, counterfactual reasoning, causal
chains, Brier-scored forecast logging (`intelligence/forecast-calibration.ts`),
a TF-IDF precedent matcher (`synthesis/precedent-matcher.ts`), source-pair
pattern memory, action memory, a topic-level relevance learner, and a
multi-persona LLM ensemble. The frontier gaps are the places where that stack
stops one step short of what the best forecasting systems (superforecaster
pipelines, calibrated LLM forecasting, episodic-memory agents) do today:

| # | Gap today | Frontier capability |
|---|-----------|---------------------|
| 1 | Precedent matching is TF-IDF over structured fields; `reasoning-memory` is a flat KV store. Nothing retrieves *semantically similar past situations*. | **Episodic memory with semantic retrieval** — every resolved situation/hypothesis becomes a memory with an embedding + outcome; new situations retrieve "have we seen this before, and what happened next?" |
| 2 | Calibration produces one **global** boost multiplier (`forecast-calibration-adapter.getBoostMultiplier()`); per-domain reliability data is collected but never applied. | **Closed calibration loop** — per-domain reliability curves (binned isotonic-style recalibration) applied to every probability the app emits, with a calibration report card. |
| 3 | `hypothesis-ensemble.ts` produces three qualitative persona takes; no probability elicitation, no base rates, no aggregation math. | **Superforecaster pipeline** — reference-class base rates → question decomposition → multi-persona probability elicitation → extremized geometric-mean-of-odds aggregation. |
| 4 | Personalization signals are fragmented: `relevance-learner` (topic terms), `action-memory` (playbooks), `hypothesis-feedback` (votes), `personal-relevance` (proximity). No unified model. | **Operator Model** — one persistent user-cognition model (interests, expertise, attention rhythm, response patterns) that every ranking surface consults. |
| 5 | `hypothesis-entities.ts` extracts entities per-cycle but discards history; no per-entity timeline, relations, or trajectory. | **Entity dossiers / temporal knowledge graph** — persistent per-entity activity timeline, co-occurrence edges, decayed heat score, "entity heating up" detection. |

Everything below honors the four standing plan invariants: every score has an
explanation; every claim carries provenance; stale data reduces confidence
rather than disappearing; every output is testable with static fixtures.

---

# Progress Tracker — UPDATE THIS EVERY SESSION

> Status markers (house convention, see ROADMAP.md): 🔲 Pending · 🔄 In
> progress / partial · ✅ Done (merged to main) · ❌ Blocked

| PR | Feature | Status | Branch | Notes |
|----|---------|--------|--------|-------|
| 1 | Episodic Memory + Semantic Retrieval | ✅ | `claude/cognition-pr1-episodic-memory` | embedding-provider (hashed+neural), vector-index, episodic-memory, episodic-memory-bridge; sidecar /api/intel-embed route; wired into analyst-loop + hypothesis-accuracy + hypothesis-forecast; analog score cache bridges sync forecastAll; tests: vector-index + episodic-memory (hashed tier, static fixtures); `test:cognition` script added. Typecheck 0 errors. |
| 2 | Closed Calibration Loop | ✅ | `claude/cognition-pr2-recalibration` | stacked on PR1 branch; recalibration.ts (10-bin PAV monotone curves, Laplace shrinkage, clamp [0.02,0.98], explanation invariant); getRecalibrator() in forecast-calibration-adapter.ts (lazy 10-min rebuild, reasoning-memory persist); recalibrate() applied as final step in hypothesis-forecast.ts with explanation appended to components; tests: PAV monotonicity, shrinkage math, n-threshold fallbacks, clamps, explanation content, perfect-calibration ≈ identity. Typecheck 0 errors. |
| 3 | Superforecaster Pipeline | ✅ | `claude/cognition-pr3-superforecast` | stacked on PR2; base-rates.ts (~15 seed classes, matchReferenceClass, blendWithEpisodic); decomposition.ts (generateText→2–4 conditions, dependence-corrected conjunction p^(1/√n), defensive JSON repair); probability-aggregation.ts (geoMeanOfOdds, extremize k=1.3 with spread>0.25 skip, aggregate with spread surfaced); superforecast.ts (full→partial→deterministic-only ladder, 60-min persona cache, PR2 recalibration, getCalibrationStore().record sourceId='superforecast'); tests: base-rates (15+ seed class count, all provenance strings, matchReferenceClass routing, blend weight formula at N=1/5/10/100), probability-aggregation (geoMeanOfOdds vs arith mean fixture, extremize skip conditions, clamp, spread surfaced), superforecast (budget-exhausted→deterministic-only, LLM failure graceful, tryParseJson repair, explanation chain, probability bounds); test:cognition updated with 3 new test files. Typecheck 0 errors. |
| 4 | Operator Model | ✅ | `claude/cognition-pr4-operator-model` | stacked on PR3; operator-model.ts (interests ≤200 weekly-half-life decay, domainAffinity EWMA, expertise novice/familiar/expert, attentionRhythm 168 buckets, responseProfile); alert-routing.scoreBreakdown gets operatorMult (0.8+0.4×interestScore, hard-clamped [0.8,1.2]); analyst-loop.rankingWeight multiplied by interestMultiplier; notification-ladder: non-safety deferral via attentionWeight+nextActiveHour — safety path structurally cannot reach deferral branch; auto-brief: DEPTH_TOKENS maps preferredDepth→maxTokens; tests: decay half-life math, EWMA affinity, expertise fixture streams, bounded-multiplier property, safety non-deferral, Ghost Mode no-op reads. Typecheck 0 errors. |
| 5 | Entity Dossiers | ✅ | `claude/cognition-pr5-entity-dossiers` | stacked on PR4; entity-graph.ts (EdgeEdge co-occurrence store, 72h half-life decay, 2000-edge cap evict-weakest-stale, canonical sorted edge key, recordCoOccurrence/neighborsOf/decayedWeight); entity-dossier.ts (DossierEvent + EntityDossier types, 500-dossier evict-coldest, 100-event timeline ring, heat 0–1 exponential decay, trajectory heating/stable/cooling with 7d-vs-21d rate comparison + min-sample guard, trajectoryEvidence with counts per window, topAssociates from entity-graph, ingestFromHypotheses/getDossier/getHotEntities, injectable clock/storage); wired into analyst-loop (fire-and-forget, Ghost Mode suppressed); tests: entity-graph.test.mts (weight math, 72h half-life hand-verified, decay×accumulate, cap/eviction ordering, canonical key, neighborsOf ordering) + entity-dossier.test.mts (heat half-life math, trajectory transitions incl. min-sample guard, ring cap, eviction heat ordering, injectable clock/storage); test:cognition updated with 2 new files. Typecheck 0 errors. Tests require darwin esbuild (sandbox Linux cannot run). |
| 6 | UI wiring | 🔄 | `claude/crystal-ball-improvements-yo8kf7` | Partial slice landed: superforecast-state.ts (on-demand entry point — 15-min signature cache, in-flight dedupe, injectable deps) + AnalystHUD "∑ Superforecast" button/expandable block (hidden in Ghost Mode, copies the simulate-button pattern) + buildSuperforecastLines() in forecast-provenance-view.ts. This also ACTIVATES PR 13's superforecast-vs-baseline run at runtime: requestSuperforecast() pushes live-vs-shadow pairs (pushSuperforecastPair + persistVerdictSnapshot) so cognition:shadow-report finally gets real data. Ask-the-Data wired into Command Center via insights/ask-context.ts in the same PR. Remaining for PR 6: EVOI planner re-ranking, regime-detection ingestion (needs a BaselineStore runtime singleton), calibration report card, Settings "Cognition" section, pushRecalibrationPair wiring (deferred: render-path flood risk). Tests: superforecast-state.test.mts (6) + forecast-provenance-view superforecast lines (4). Typecheck 0 errors. |
| 7 | Conformal Intervals | ✅ | `claude/cognition-pr7-conformal` | stacked on PR5; conformal.ts (split-conformal, MIN_DOMAIN_N/GLOBAL_N=40, conservative finite-sample quantile rank ceil((n+1)(1−α))/n, per-domain→global→uninformative pool ladder, clamp [0,1], explanation invariant); SuperForecast.interval field added (optional, non-breaking); tests: coverage property (≥(1−α) fraction on deterministic fixtures), n-threshold fallbacks, clamps, quantile rank with tiny n, explanation content (pool, n, coverage%, q); test:cognition updated. Typecheck 0 errors. PR 6 deferred as planned. |
| 8 | Memory Consolidation | ✅ | `claude/cognition-pr8-consolidation` | stacked on PR7; consolidation.ts (greedy threshold clustering sim≥0.6, informative-either-way gate rate≥0.7 or ≤0.3, LearnedSchema with provenance/domains/entities/medianLeadTime/materializationRate, n≥6 registers into CrisisSignatureLibrary with 'learned:' id+name prefix, cap 50 evict lowest-n, recordSchemaOutcome() retirement at <0.4 hit rate after 5 outcomes with deregistration, scheduleConsolidation() 24h idle-time wrapper); tests: clustering threshold, informative gate (0.5-rate → no schema), schema fields (median lead time, provenance IDs, shared domains/entities), n≥6 registration gate, retirement at <0.4, caps/eviction, persistence round-trip, empty/edge cases; test:cognition updated. Typecheck 0 errors. Auto-grading wiring from outcome-ledger noted for PR 12. |
| 9 | EVOI Collection Planner | ✅ | `claude/cognition-pr9-evoi` | stacked on PR8; evoi-planner.ts (pure Bayesian binary-entropy EVOI, binaryEntropy/bayesianUpdate/expectedInfoGain math, planCollection() → top-5 sorted desc, CollectionAction with label/targetFeed/panelId/gain/effort/explanation); three candidate source types: missing signals (LR+=4.0), pending signals (LR+=2.5), provider disagreements (LR+=3.0/single-source LR+=2.0), collection gaps (high/med/low LRs 3.5/2.0/1.5); buildEvoiContext() thin adapter filters to informative verdicts only; question-suggester re-ranking deferred to PR 6/12 (no clean injection point without DOM); tests: entropy math (H(0.5)=1 bit, extremes, symmetry, monotonicity), Bayesian update (LR=1 identity, LR=4 hand-verified, clamp), expectedInfoGain (p-extremes ≈0, ordering, hand-verified fixture at p=0.5/LR+=4/LR-=0.6≈0.114 bits, degenerate case), planCollection (top-5 cap, sort, all 3 source types, p-extremes, effort labeling, explanation content, LR overrides), buildEvoiContext (filtering, null handling). test:cognition updated with evoi-planner.test.mts. Typecheck 0 errors. |
| 10 | Operator Forecast Journal | ✅ | `claude/cognition-pr10-journal` | stacked on PR9; forecast-journal.ts (JournalEntry mirrors PredictionRecord, toPredictionRecord adapter, logForecast/resolveJournalEntry/expireOldJournalEntries, getOperatorCurve via buildCurve verbatim, getOperatorBrier, getComparison async with MIN_BOTH_SIDES_N=30 gate, refreshHumanEdge → operator-model); operator-model.ts extended with humanEdge?: Record<string,number> + updateHumanEdge() + interestMultiplier(text, domain?) blending humanEdge at 30% weight inside the existing [0.8,1.2] bound; Ghost Mode suppresses logForecast + updateHumanEdge; persistence reasoning-memory key crystalball-cognition-journal-v1 + localStorage mirror, loaded/writtenSinceLoad guards; FIFO cap 1000 resolved-oldest-first; tests: toPredictionRecord fidelity, buildCurve reuse on journal fixtures, Brier math hand-checked (0/0.25/1/fixture), humanEdge n≥30 gate, combined-multiplier bound property 0.8–1.2 across all inputs incl. extreme edges, Ghost Mode, FIFO cap, resolveJournalEntry, expireOldJournalEntries. Typecheck 0 errors. Tests require darwin esbuild (sandbox Linux cannot run). |
| 11 | Change-Point + Semantic Ask-the-Data | ✅ | `claude/bocpd-regime-detection-reland` | BOCPD regime-detection.ts (createBOCPDState, ingestSample, createRegimeDetector, getRegimeDetector, singleton; Normal-Gamma conjugate posterior, Student-t predictive, Lanczos lgamma, truncated run-length vector); semantic-ask.ts (semanticRetrieve top-K over briefing-archive + snapshot-archive via embedHashed; semanticFallback → AnswerPacket with episode provenance); ask-the-data.ts unknown intent falls back to semantic recall before generic reply; package.json test:cognition adds regime-detection.test.mts + semantic-ask.test.mts (17 tests). Typecheck 0 errors. |
| 12 | Self-Tuning Cognition | 🔄 | `claude/cognition-pr12-self-tuning` | Implemented per Part D spec. (1) 8 new tunables declared in tunable-params-store DECLARATIONS: episodic-analog:minSim [0.30–0.60/0.45], episodic-analog:analogBlendK [3–10/5], recalibration:shrinkPrior [5–20/10], superforecast:extremizeK [1.0–1.8/1.3], superforecast:spreadSkipThreshold [0.15–0.40/0.25], entity-trajectory:heatHalfLifeHours [24–168/72], operator-ranking:interestHalfLifeHours [72–336/168], consolidation:clusterSimThreshold [0.5–0.75/0.6]; all 7 owning cognition modules now read get-with-default (empty store = byte-identical pre-PR-12 behavior; explicit test/opts overrides still win). (2) 5 cognition algorithms registered in algorithm-registry (episodic-analog/recalibration/superforecast risk_score/forecast/forecast medium; operator-ranking ranking low; entity-trajectory risk_score medium; domain 'cognition'). (3) Deterministic grading + drift watch in cognition/self-tuning.ts: runCognitionGradingPass() grades recalibration (resolved calibration records replayed through the live curve — documented in-sample optimism bias, accepted) + superforecast (resolved sourceId='superforecast' records) + entity-trajectory (retrospective 7d replay via computeTrajectory; stable skipped), with persisted watermarks (LS crystalball-cognition-selftune-v1) that advance ONLY past successfully recorded grades (ledger failure ⇒ retry next pass); episodic-analog + operator-ranking grade at hypothesis RESOLUTION time from EMIT-TIME values stamped onto PendingHypothesis (analogScore + operatorMult stamped in hypothesis-accuracy.stamp) — never from grade-time recomputation (avoids resolved-episode self-similarity outcome leakage + in-window engagement bias; unstamped legacy pendings skipped); runCognitionDriftWatch() uses reachable PRODUCTION options (COGNITION_DRIFT_OPTIONS: fixed F1 floor 0.5, δ=0.05, λ=2 ≈ 5 fully-degraded buckets; stock λ=50 is unreachable — statistic bounded by windowBuckets), count-based bucket compaction (5 grades/bucket × 12 — sparse grading gaps can't fake F1=0 degradation), DRIFT_MIN_GRADED=20 thin-data gate, and per-algorithm alert dedupe persisted alongside the watermarks (alert on transition only; recovery re-arms); startCognitionSelfTuningCadence() (6h, Ghost-skipped) wired in panel-layout beside consolidation. (4) Safe-adjustment loop: episodic-analog:minSim got a real discriminating safety-fixture suite (tuning-safety-fixtures.ts, calls REAL analogScoreFor with explicit minSim; blocks ≤0.40 and ≥0.55, allows 0.50); remaining cognition knobs fail closed → held_for_approval (operator approves) — pinned by an end-to-end runTuningApply test on the suite-less analogBlendK knob; consolidation:clusterSimThreshold documented manual-only (unregistered algorithm). Spec-vs-code note: plan said "validated by backtest-engine.ts" — the shipped gate is historical-backtest.ts + tuning-safety-fixtures.ts (see PR 12 section note). analogScoreFor gained optional {minSim} param; getTunedParam gained a 5s parsed-store memo (invalidated by every store write) since PR 12 put it on hot paths. Review fixes applied 2026-07-06 (M1 reachable-λ drift + empty-bucket immunity; M2 emit-time analog stamping + success-only watermarks; m3 emit-time operator-mult stamping; m4 drift-alert dedupe; m5 store memo; nits: graded-map keys, manual-only comment, held_for_approval test). Tests: self-tuning.test.mts (27: declarations/bounds/clamps, tuned reads hand-verified in all 7 modules, registry entries, safety-suite discrimination, grading pass incl. success-only watermark retry + sourceId routing + trajectory replay, resolution-time analog/operator grading from stamped values, drift watch under production defaults incl. sparse-healthy + thin-data + dedupe/re-arm, runTuningApply held_for_approval, cadence gate); algorithm-registry + tunable-params-store expected lists updated. Typecheck 0. test:cognition 533 pass, test:algorithms 284 pass. eslint clean on changed files (pre-existing base-rates/probability-aggregation lint errors cleaned mechanically). |
| 13 | Shadow Rollout Discipline | ✅ | `claude/cognition-pr13-shadow` | stacked on PR12; shadow-rollout.ts (3 run IDs: recalibration-vs-legacy/superforecast-vs-baseline/learned-schema-vs-handauthored, orientation: PR2 recalibration IS live→shadow is legacy multiplier-only, superforecast NOT live→shadow, learned schemas→shadow vs hand-authored live); pushRecalibrationPair/pushSuperforecastPair/pushSchemaPair fire-and-forget helpers; shadowVerdict() flip gate (≥200 pairs AND shadowBrier≤liveBrier→flip-to-shadow; schema run always insufficient-data — matchCounts not probabilities; Brier joined against calibration store by probability proximity); persistVerdictSnapshot() writes to LS crystalball-cognition-shadow-v1 + IDB mirror; scripts/cognition-shadow-report.mjs + npm run cognition:shadow-report; tests: orientation (live vs shadow fields all 3 runs), flip gate math (200-pair threshold, Brier keep-live/flip-to-shadow), insufficient-data paths (pair count, no resolved records, schema run), verdict snapshot persistence (LS + IDB + fire-and-forget on failure), recommendation union type. Typecheck 0 errors. Tests require darwin esbuild (sandbox Linux cannot run). |
| 14 | Compute Placement + Hygiene | 🔲 | `claude/cognition-pr14-perf` | |
| 15 | LLM Quality Engineering | ✅ | `claude/cognition-pr15-llm-quality` | Branch-name stacking note was historical — PR 15 merged independently; PR 14 remains 🔲. llm-json.ts: parseStrictJson<T>(text, validate) — direct parse → one repair (strip markdown fences + bracket-matched outermost extraction) → validate → null; extractOutermostJsonBlock uses bracket-count (not regex) to handle nested objects and strings-with-brackets correctly. Refactor: decomposition.ts tryParseJson delegated to parseStrictJson (backward-compat export retained for existing tests); superforecast.ts parsePersonaProbability replaced with parseStrictJson + isPersonaResponse type guard. Self-consistency: medianOf() helper (lower-middle for even arrays, non-mutating); persona elicitation draws k samples (tunable 'cognition-self-consistency-k' bounds 1–5 default 3, declared in tunable-params-store); k=1 is byte-identical to pre-PR path; each sample is budget-checked; on partial budget uses median of succeeded samples. Difficulty routing: decomposition and persona calls do NOT set preferCloud (local-first); only buildAggregateReviewPrompt call sets preferCloud:true; encoded in superforecast.ts, not the adapter. Aggregate review: optional budget-gated final step (one cloud-tier call reviewing aggregate for blunders); JSON {keep, adjustedP?, reason}; applied only within ±0.10 hard clamp (documented + tested); skipped when no persona estimates succeeded. GenerateTextFn extended with preferCloud? for type compatibility. Prompt builders buildPersonaPrompt and buildAggregateReviewPrompt exported for fixture tests. Tests: llm-json.test.mts (direct parse, fence repair, bracket extraction, validator rejection, garbage, no infinite loops, extractOutermostJsonBlock with nested/string brackets); prompt-fixtures.test.mts (all 3 prompt builders: evidence wrapping, JSON contract, section order, balanced tags, no raw feed text outside evidence); self-consistency.test.mts (medianOf odd/even/single/non-mutating, applyAggregateReview keep/adjust/clamp/NaN, k=1 call count + no-note-in-explanation, k=3 call count + median + explanation note, partial-budget degradation, complete-failure degradation). 3 new test files added to test:cognition. Typecheck 0 errors. Tests require darwin esbuild (sandbox Linux cannot run). |
| 16 | Cognition Benchmark + CI Gate | 🔲 | `claude/cognition-pr16-bench` | last |

## Session Protocol (for every implementing Sonnet session)

1. **Resume point**: read this tracker. Pick the first PR that is 🔲/🔄 with
   all its dependencies ✅. Never start a PR whose dependencies haven't
   merged.
2. **Verify branch state first**: `git fetch origin`, then check whether the
   PR's branch already exists locally or on origin (a previous session may
   have left partial work — continue it, don't duplicate it). Check open
   GitHub PRs for the same branch name.
3. **Branch**: `git checkout -b <branch> origin/main` (Branch Discipline in
   CLAUDE.md is mandatory; never commit to local main).
4. **Implement** strictly per this plan's Part B/C/D section for that PR.
   If the code contradicts the plan (APIs moved since 2026-06-10), trust the
   code, fix the plan text in the same commit, and note it in the tracker.
5. **Definition of done** (all required before marking ✅):
   - `npm run typecheck:all` → zero errors
   - `npm run test:cognition` green (and the PR's new tests exist)
   - `npm run secrets:scan:staged` clean before commit
   - Tracker row updated (status, notes) **in the same commit**
   - Commit trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
   - Push branch to origin, open PR; cross-agent review per `npm run cross-check`
6. **If blocked**: mark ❌ with a one-line reason in Notes and stop —
   don't improvise around a blocker that needs a human decision.
7. **Scope discipline**: one PR per session unless the PR lands trivially
   green with time to spare. Never broad-refactor neighboring code.

---

# Part A — Roadmap (priority order)

| PR | Feature | Why this order | Risk |
|----|---------|----------------|------|
| 1 | Episodic Memory + Semantic Retrieval (`src/services/cognition/episodic-memory.ts`, `embedding-provider.ts`, `vector-index.ts`) | Foundation: PRs 3 and 5 consume retrieval; no dependencies of its own. | Medium (new sidecar route, IDB store) |
| 2 | Closed Calibration Loop (`src/services/cognition/recalibration.ts` + wiring into `hypothesis-forecast.ts`) | Highest accuracy-per-line-of-code; data already collected, just unapplied. | Low |
| 3 | Superforecaster Pipeline (`src/services/cognition/base-rates.ts`, `decomposition.ts`, `probability-aggregation.ts`, `superforecast.ts`) | Depends on PR 1 (analog retrieval feeds reference classes) and PR 2 (recalibrated output). | Medium (LLM-budget-gated) |
| 4 | Operator Model (`src/services/cognition/operator-model.ts`) | Independent of 1–3; placed here so ranking surfaces can personalize the improved forecasts. | Low |
| 5 | Entity Dossiers (`src/services/cognition/entity-dossier.ts`, `entity-graph.ts`) | Consumes PR 1 embeddings for entity-context retrieval; feeds Command Center "what to watch". | Medium |
| 6 | UI wiring (Command Center + AnalystHUD surfaces) | Deferred last, house style. | Low |

Each PR is a `claude/*` branch off `origin/main`, lands green on
`npm run typecheck:all`, ships its own fixture tests under
`src/services/cognition/__tests__/`, and adds a `test:cognition` script
(node --test, matching `test:intelligence`).

---

# Part B — Technical design per PR

## Shared conventions (read first)

- New code lives in **`src/services/cognition/`** — a fifth foundation layer
  beside `intelligence/`, `weather/`, `insights/`, `shortage/`.
- **Pure deterministic core**: no DOM, no fetch, no globals at import time.
  Anything that touches the LLM or sidecar lives in a thin adapter file and is
  injectable for tests (follow the pattern in `active-learning-queue.ts`).
- **Persistence**: use `getMemory/putMemory` from `src/services/reasoning-memory.ts`
  (IDB `reasoning_memory` store on `crystalball_db`) with a localStorage
  bootstrap mirror, exactly like `action-memory.ts` does (`loaded` /
  `writtenSinceLoad` guards against the IDB hydrate race).
- **LLM calls**: only through `generateText()` in `src/services/llm-adapter.ts`;
  it already handles local-first routing and `llm-budget` caps. Wrap all
  feed-derived text in `<evidence>` tags per `analyst-context-builder.ts`
  (prompt-injection hardening).
- **Ghost Mode**: learning writes are suppressed when `isGhostMode()` is true
  (pattern: `relevance-learner.ts`), but already-learned state still applies.
- **Events**: emit on `window` with the `cb:` prefix (e.g. `cb:episodic-recall`).
- localStorage keys: `crystalball-cognition-*`. Do not invent new IDB stores;
  the `reasoning_memory` KV store is sufficient for v1 of everything below.

---

## PR 1 — Episodic Memory + Semantic Retrieval

**Goal:** every situation/hypothesis that resolves becomes a durable episode
with an embedding and an outcome. New hypotheses retrieve top-K similar past
episodes, and the recall (with outcomes) feeds the analog boost in
`intelligence/hypothesis-forecast.ts` — which today receives `analogScore:
null` from every caller.

### Files

```
src/services/cognition/embedding-provider.ts   # local-first embedding adapter
src/services/cognition/vector-index.ts         # pure cosine top-K index
src/services/cognition/episodic-memory.ts      # episode store + recall API
src/services/cognition/__tests__/vector-index.test.mts
src/services/cognition/__tests__/episodic-memory.test.mts
src-tauri/sidecar/local-api-server.mjs         # add /api/intel-embed route
```

### `embedding-provider.ts`

Two-tier, mirroring `llm-adapter.ts`:

1. **Local**: POST `/api/intel-embed` (new sidecar route) → Ollama
   `nomic-embed-text` (768-dim). 10 s timeout. The sidecar route mirrors
   `/api/intel-generate`'s Ollama probing; if Ollama is absent return 503.
2. **Deterministic fallback**: a hashed bag-of-words embedder (256-dim,
   djb2-hash token → bucket, L2-normalized). Quality is below neural
   embeddings but it is **fully deterministic, offline, and test-stable** —
   all unit tests run against this tier only.

```ts
export interface EmbeddingResult { vector: Float32Array; tier: 'neural' | 'hashed'; dim: number; }
export async function embed(text: string): Promise<EmbeddingResult>;
export function embedHashed(text: string): EmbeddingResult;   // exported for tests + sync callers
```

Vectors of different tiers are **never compared against each other**: the
index partitions by `tier` (see below). On a tier upgrade (Ollama appears),
new episodes get neural vectors; old hashed episodes are lazily re-embedded
on access, max 20 per session, so there is no migration stampede.

### `vector-index.ts`

Pure module, no persistence of its own:

```ts
export interface IndexedVector { id: string; vector: Float32Array; tier: 'neural' | 'hashed'; }
export function cosineSimilarity(a: Float32Array, b: Float32Array): number;
export function topK(query: IndexedVector, corpus: readonly IndexedVector[], k: number,
                     minSim?: number): { id: string; similarity: number }[];
```

Brute-force scan is fine: the episode cap is 2 000 (below), so worst case is
2 000 × 768 multiply-adds ≈ 1.5 M flops — sub-millisecond. Do **not** add an
ANN library.

### `episodic-memory.ts`

```ts
export interface Episode {
  id: string;
  kind: 'situation' | 'hypothesis' | 'brief';
  signature: string;            // from hypothesis-feedback.signatureFor where applicable
  summary: string;              // text that was embedded (≤ 500 chars)
  domains: string[];
  entities: string[];           // from hypothesis-entities extraction
  region?: string;
  createdAt: number;
  resolvedAt?: number;
  outcome?: 'materialized' | 'fizzled' | 'partial' | 'unknown';
  outcomeNote?: string;         // what actually happened (≤ 280 chars)
  vector: number[];             // serialized Float32Array
  tier: 'neural' | 'hashed';
}

export interface Recall {
  episode: Episode;
  similarity: number;           // 0–1
  ageDays: number;
  explanation: string;          // "matched on: Black Sea, wheat, escalation" — plan invariant
}

export function recordEpisode(input: Omit<Episode, 'id' | 'vector' | 'tier'>): Promise<Episode>;
export function resolveEpisode(id: string, outcome: Episode['outcome'], note?: string): Promise<void>;
export function recall(text: string, opts?: { k?: number; kinds?: Episode['kind'][] }): Promise<Recall[]>;
export function analogScoreFor(recalls: readonly Recall[]): number | null;
```

- Cap 2 000 episodes (FIFO evict resolved-oldest first, never evict pending).
- `analogScoreFor`: similarity-weighted materialization rate of the top-K
  recalls, in 0–1, `null` when fewer than 3 recalls clear `minSim = 0.45`.
  This is the value `forecastHypothesis(..., analogScore, ...)` was designed
  to receive.
- `explanation` lists the overlapping entities/domains between query and
  episode — never return a bare similarity number (invariant: every score has
  an explanation).

### Wiring (small, surgical)

- `analyst-loop.ts`: after each cycle's snapshot, `recordEpisode` for new
  hypothesis signatures (kind `'hypothesis'`); on `hypothesis-accuracy`
  grading, call `resolveEpisode` with hit→`materialized` / miss→`fizzled`.
- `intelligence/hypothesis-forecast.ts` call sites: replace the hardcoded
  `analogScore = null` with `analogScoreFor(await recall(h.statement))`.
  Callers are async-safe — verify each call site individually.
- Outcome source of truth stays `outcome-ledger.ts` / `hypothesis-accuracy.ts`;
  episodic memory only mirrors resolutions, never re-grades.

### Tests (hashed tier only, static fixtures)

- topK ordering, minSim threshold, tier partitioning.
- analogScoreFor: <3 recalls → null; weighted rate math against hand-computed
  fixture; materialized-heavy corpus → high score.
- FIFO eviction respects pending-episode protection.
- Injectable storage (no real IDB) per `active-learning-queue.ts` pattern.

---

## PR 2 — Closed Calibration Loop

**Goal:** stop applying one global multiplier to every forecast. Build
per-domain reliability curves from the resolved predictions that
`intelligence/forecast-calibration.ts` already records, and pass every
emitted probability through them.

### Files

```
src/services/cognition/recalibration.ts
src/services/cognition/__tests__/recalibration.test.mts
```

### Design

Binned monotonic recalibration (a deliberately simple isotonic-regression
substitute that is explainable and fixture-testable):

```ts
export interface ReliabilityBin { lo: number; hi: number; n: number; predictedMean: number; observedRate: number; }
export interface ReliabilityCurve {
  domain: FactDomain | 'global';
  bins: ReliabilityBin[];        // 10 bins, [0,0.1) … [0.9,1.0]
  sampleSize: number;
  brier: number;
  generatedAt: number;
}
export function buildCurve(records: readonly PredictionRecord[], domain?: FactDomain): ReliabilityCurve;
export function recalibrate(p: number, curve: ReliabilityCurve): { p: number; adjustment: number; explanation: string };
export function pooledCurve(curves: readonly ReliabilityCurve[]): ReliabilityCurve;
```

Rules (encode as constants, test each):

- A domain curve needs `n ≥ 30` resolved records, else fall back to the
  pooled/global curve; global needs `n ≥ 50`, else identity (adjustment 0).
- Per-bin correction is `observedRate − predictedMean`, **shrunk** toward 0 by
  `n_bin / (n_bin + 10)` (Laplace-style shrinkage so a 3-sample bin can't
  swing a forecast), then monotonicity-repaired with PAV (pool adjacent
  violators — ~20 lines, implement inline, no dependency).
- Clamp output to [0.02, 0.98]: the app never claims certainty.
- `explanation` example: `"finance forecasts at ~70% have materialized 54%
  of the time (n=41) → adjusted to 58%"`.

### Wiring

- `intelligence/forecast-calibration-adapter.ts`: keep `getBoostMultiplier()`
  for back-compat but add `getRecalibrator(domain)` returning a closure over
  the freshest curve; rebuild curves lazily at most every 10 min.
- `intelligence/hypothesis-forecast.ts`: apply `recalibrate()` as the final
  step on `probability`, and append its explanation to the components trail.
- Curves persist via `reasoning-memory` under `crystalball-cognition-curves`.

### Tests

- PAV monotonicity on fixture with violators; shrinkage math; n-threshold
  fallbacks (domain → global → identity); clamp; explanation string content;
  perfect-calibration fixture yields ≈identity.

---

## PR 3 — Superforecaster Pipeline

**Goal:** for the top-N hypotheses (default 3, budget-gated), produce a
probability the way elite human forecasters do: outside view first (base
rate from reference class), then inside view (decomposition), then multiple
independent estimates, then aggregation that's provably better than a mean.

### Files

```
src/services/cognition/base-rates.ts
src/services/cognition/decomposition.ts
src/services/cognition/probability-aggregation.ts
src/services/cognition/superforecast.ts          # orchestrator
src/services/cognition/__tests__/{base-rates,probability-aggregation,superforecast}.test.mts
```

### `base-rates.ts` — deterministic outside view

A static reference-class library (house pattern: like `commodity-playbooks.ts`)
plus episodic enrichment:

```ts
export interface ReferenceClass {
  id: string;                    // 'interstate-escalation-30d'
  description: string;
  baseRate: number;              // historical frequency, 0–1
  horizon: '24h' | '7d' | '30d' | '90d';
  source: string;                // provenance: "ACLED 2010–2024 escalation transitions" etc.
  matchers: { kinds?: HypothesisKind[]; domains?: string[]; entityPatterns?: RegExp[] };
}
export function matchReferenceClass(h: HypothesisLike): ReferenceClass | null;
export function blendWithEpisodic(rc: ReferenceClass, analogScore: number | null,
                                  analogN: number): { rate: number; explanation: string };
```

Ship ~15 seed classes across conflict / market / cyber / weather / shortage
with honest provenance strings. `blendWithEpisodic` weights the episodic
materialization rate by `analogN / (analogN + 5)` against the static rate.

### `decomposition.ts` — LLM inside view (budget-gated)

One `generateText()` call asking for the hypothesis to be split into 2–4
necessary conditions, each with a probability, returned as strict JSON.
Parse defensively (the repair pattern in `hypothesis-projection.ts`); on
parse failure return `null` and the pipeline proceeds without the inside
view. Conjunction with a dependence correction: `p_inside = Π p_i` raised
to `1/√n` (conditions are never fully independent; document this).

### `probability-aggregation.ts` — pure math, the heart of the PR

```ts
export interface Estimate { source: 'base-rate' | 'decomposition' | 'persona-analyst' | 'persona-skeptic' | 'persona-pragmatist' | 'model-forecast'; p: number; weight: number; }
export function geoMeanOfOdds(estimates: readonly Estimate[]): number;
export function extremize(p: number, k?: number): number;        // default k = 1.3
export function aggregate(estimates: readonly Estimate[]): { p: number; spread: number; explanation: string };
```

- Geometric mean of odds (not mean of probabilities) — standard for combining
  forecasts; document why in the file header.
- Extremization `p' = p^k / (p^k + (1−p)^k)` with k = 1.3, **skipped when
  `spread > 0.25`** (high disagreement = don't sharpen) or when fewer than 3
  estimates exist.
- `spread` = max−min of inputs; it is surfaced, not averaged away
  (contradiction invariant). Clamp [0.02, 0.98].

### `superforecast.ts` — orchestrator

```ts
export interface SuperForecast {
  hypothesisId: string;
  probability: number;            // post-aggregation, post-recalibration (PR 2)
  estimates: Estimate[];          // full provenance trail
  spread: number;
  referenceClass?: string;
  explanation: string;            // human-readable chain: outside → inside → personas → aggregate → recalibrated
  llmTier: 'full' | 'partial' | 'deterministic-only';
}
export async function superforecast(h: Hypothesis): Promise<SuperForecast>;
```

Degradation ladder (must be tested): full (base rate + decomposition + 3
persona probabilities) → partial (budget allows fewer calls) →
deterministic-only (base rate + episodic + existing `forecastHypothesis`
output as `model-forecast` estimate). The deterministic floor always works —
the pipeline never returns nothing because the budget ran out.

Persona probability elicitation extends `hypothesis-ensemble.ts`'s personas:
same three personas, but the prompt demands `"probability": 0.xx` JSON
alongside the qualitative take. Reuse its 60-min signature cache.

Log every SuperForecast into the calibration store —
`getCalibrationStore().record(...)` from
`intelligence/forecast-calibration-adapter.ts`, sourceId `'superforecast'` —
so PR 2's curves grade this pipeline over time; the system measurably
improves itself. (The store API is `record` / `resolve` / `expirePending` on
`ForecastCalibrationStore`, not a top-level function.)

### Wiring

- `AnalystHUD` on-demand action (like `hypothesis-projection`): no automatic
  cadence in this PR — cost control first, automation later.
- Result rendered into hypothesis detail; estimates table shows each source,
  its probability, and its weight (full provenance, plan invariant).

---

## PR 4 — Operator Model (unified personalization)

**Goal:** one persistent model of the operator that fuses the four existing
learning signals and answers three questions any surface can ask: *how much
does this matter to this user* (interest), *how much should we explain*
(expertise), *when should we surface it* (attention rhythm).

### Files

```
src/services/cognition/operator-model.ts
src/services/cognition/__tests__/operator-model.test.mts
```

### Design

```ts
export interface OperatorModel {
  version: 1;
  interests: { term: string; weight: number; lastReinforced: number }[];   // ≤ 200, decayed
  domainAffinity: Record<string, number>;        // 0–1 per domain, EWMA of engagement
  expertise: Record<string, 'novice' | 'familiar' | 'expert'>;             // per domain
  attentionRhythm: number[];                     // 168 hour-of-week activity weights (pattern: pressure-baselines.ts)
  responseProfile: { medianAckMs: number; pinRate: number; dismissRate: number; };
  updatedAt: number;
}
export function getOperatorModel(): OperatorModel;
export function interestScore(text: string, model?: OperatorModel): { score: number; matched: string[] };
export function preferredDepth(domain: string): 'headline' | 'standard' | 'deep';
export function attentionWeight(ts?: number): number;   // 0–1, from rhythm
export function recordEngagement(e: EngagementEvent): void;   // single ingest point
```

- **Not a new learner.** It *consumes* existing signals: subscribes to the
  same `unifiedAlertStore` transitions as `relevance-learner.ts`, reads
  `action-memory` playbooks, `hypothesis-feedback` votes, and ack-latency
  from alert reactions. Each source keeps its own store; the operator model
  is the fusion layer with weekly half-life decay on interests.
- Expertise heuristic: dismissal speed + depth of interaction per domain
  (fast-ack + never-expands = headline; pins + exports + asks = deep).
- Ghost Mode: `recordEngagement` no-ops; reads still work.
- Privacy: local-only (localStorage mirror + reasoning-memory), never
  transmitted — state this in the file header like `relevance-learner.ts`.

### Wiring

- `alert-routing.scoreAlert()` call sites: multiply by
  `0.8 + 0.4 × interestScore(...)` (bounded ±20% — personalization tilts,
  never dominates; document the bound).
- `analyst-loop.rank()`: add the same bounded multiplier beside the existing
  feedback/accuracy multipliers.
- `auto-brief.ts` + Command Center: choose section depth via `preferredDepth`.
- `insights/notification-ladder.ts`: non-safety-critical rungs may use
  `attentionWeight` to defer into the user's next active hour. **Safety
  notifications must never be deferred** — add an explicit test for that.

### Tests

Interest decay half-life math; engagement → affinity EWMA; expertise
transitions on fixture event streams; bounded-multiplier property
(`0.8 ≤ m ≤ 1.2` for all inputs); safety-rung non-deferral; Ghost Mode
write suppression.

---

## PR 5 — Entity Dossiers (temporal knowledge graph)

**Goal:** persistent per-entity intelligence: timeline, co-occurrence graph,
decayed heat score, trajectory detection. Answers "what do we know about X,
and is X heating up?"

### Files

```
src/services/cognition/entity-dossier.ts
src/services/cognition/entity-graph.ts
src/services/cognition/__tests__/{entity-dossier,entity-graph}.test.mts
```

### Design

```ts
// entity-dossier.ts
export interface DossierEvent { ts: number; kind: string; refId: string; label: string; severity?: number; }
export interface EntityDossier {
  entity: string;  entityType: 'country' | 'ticker' | 'cve' | 'callsign' | 'org' | 'place';
  firstSeen: number; lastSeen: number;
  timeline: DossierEvent[];            // ring, cap 100/entity
  heat: number;                        // 0–1, exponential decay half-life 72 h
  trajectory: 'heating' | 'stable' | 'cooling';   // 7d-vs-prior-21d rate comparison with min-sample guard
  topAssociates: { entity: string; strength: number }[];   // from entity-graph
}
export function ingestFromHypotheses(hs: readonly Hypothesis[]): void;  // uses hypothesis-entities extraction
export function getDossier(entity: string): EntityDossier | null;
export function getHotEntities(limit?: number): EntityDossier[];

// entity-graph.ts — co-occurrence edges
export interface EntityEdge { a: string; b: string; weight: number; lastSeen: number; }
export function recordCoOccurrence(entities: readonly string[], ts: number): void;
export function neighborsOf(entity: string, limit?: number): EntityEdge[];
```

- Caps: 500 dossiers (evict coldest), 2 000 edges (evict weakest-stale).
  Edge weight increments per co-occurrence and decays with the same 72 h
  half-life — recency-weighted, like everything else in the app.
- `trajectory` must include its evidence in the dossier (counts per window),
  not just the label.
- Hook: `analyst-loop` already runs entity extraction per cycle
  (`hypothesis-entities.ts`); add one `ingestFromHypotheses` call there.
  Optionally enrich recall: PR 1's `recall()` can boost episodes sharing hot
  entities (add `entityBoost` param, default off, flag-gated).

### Wiring

- Command Center "what to watch next": merge `getHotEntities(5)` with the
  existing watch list, tagged with trajectory arrows.
- `AnalystHUD` hot-entities section: replace the per-cycle index with dossier
  heat (the HUD section already exists — this is a data-source swap).

---

## PR 6 — UI wiring (deferred, house style)

Small, after 1–5 land: hypothesis detail gains "Past analogs" (PR 1 recalls
with outcomes) and "Forecast provenance" (PR 3 estimates table + PR 2
adjustment line); Command Center gains the calibration report card
(reliability curve sparkline + Brier trend) and dossier-driven watch items;
Settings gains a Cognition section (episodic memory on/off + wipe, cloud
budget for superforecasts, personalization on/off + reset — every learning
feature individually killable).

---

## Sequencing, branches, and guardrails for the implementing session

1. One PR per branch: `claude/cognition-pr1-episodic-memory`, etc., off
   `origin/main` (Branch Discipline section of CLAUDE.md is mandatory).
2. Before each PR: `git fetch origin` and check open PRs — the repo has a
   history of dirty parallel branches (`docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md`).
3. `npm run typecheck:all` must be zero-error before claiming completion;
   run `npm run secrets:scan:staged` before commit; commit with
   `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
4. Add `test:cognition` to package.json mirroring `test:intelligence`
   (`tsx --test` over explicit `src/services/cognition/__tests__/*.test.mts`
   paths — the house scripts list files explicitly, no globs).
5. Never touch the macOS Keychain (absolute prohibition in CLAUDE.md).
6. No new runtime dependencies. Hashed embedder, PAV, and aggregation math
   are all small enough to implement inline — keep the bundle lean.
7. Cross-agent review applies: `claude/*` branches need the recorded
   cross-agent review before merge (`npm run cross-check`).

# Part C — Extended horizon (PRs 7–11)

Added after a second gap-audit pass (2026-06-10). Each was verified absent
from the codebase before inclusion (e.g. `grep` for conformal/quantile finds
nothing; `collection-gap-discovery.ts` is a rule-based audit, not
value-of-information ranking; the "consolidation" grep hits are unrelated).
These build on PRs 1–5 and should land after them.

## PR 7 — Conformal Prediction Intervals

**Gap:** every forecast is a point probability. Nothing in the app emits a
distribution-free *interval* ("70%, but honestly anywhere in 55–85%").

Split-conformal over the resolved `PredictionRecord` history (same data PR 2
uses): nonconformity score = |outcome − predicted p| per domain; the interval
at confidence 1−α is the point forecast ± the (1−α) quantile of historical
nonconformity scores (clamped to [0,1]). This is ~80 lines of pure math with
a coverage guarantee that holds regardless of how badly the underlying model
is specified — which is exactly the property an intelligence app should
advertise.

```
src/services/cognition/conformal.ts
src/services/cognition/__tests__/conformal.test.mts
```

```ts
export interface ForecastInterval { p: number; lo: number; hi: number; alpha: number; n: number; explanation: string; }
export function conformalInterval(p: number, domain: FactDomain | 'global',
  records: readonly PredictionRecord[], alpha?: number): ForecastInterval;  // default alpha 0.2 → 80% interval
```

Rules: per-domain when `n ≥ 40` resolved, else global, else width-1 honest
interval with `explanation: "insufficient history — interval is uninformative"`.
Wiring: `SuperForecast` (PR 3) gains an `interval` field; the HUD renders
`p` with a whisker. Tests: coverage property on synthetic fixtures (interval
must contain outcome ≥ (1−α)·n times across the fixture set), n-threshold
fallbacks, clamps.

## PR 8 — Memory Consolidation (episodic → schema)

**Gap:** PR 1 episodes accumulate but never generalize. The
`crisis-signature-library.ts` ships *hand-authored* signatures; nothing
*learns* new ones. This is the agent-memory "sleep" step.

A periodic (24 h, idle-time) consolidation pass over resolved episodes:

1. Cluster resolved episodes by vector similarity (reuse `vector-index.ts`,
   greedy threshold clustering at sim ≥ 0.6, no new deps).
2. For clusters with ≥ 4 members and a materialization rate ≥ 0.7 or ≤ 0.3
   (i.e. *informative either way*), distill a `LearnedSchema`: shared
   entities/domains, median lead time, outcome rate, member episode IDs
   (provenance).
3. Register strong schemas (n ≥ 6) into `crisis-signature-library.ts` as
   custom signatures (it already supports operator-defined entries) tagged
   `source: 'learned'` — so the existing matching engine surfaces them with
   zero new UI.

```
src/services/cognition/consolidation.ts
src/services/cognition/__tests__/consolidation.test.mts
```

Caps: 50 learned schemas, evict lowest-n. A schema whose subsequent hit rate
decays below 0.4 (graded via the same outcome ledger) is auto-retired —
learned knowledge must be falsifiable, like everything else here.

## PR 9 — Expected-Value-of-Information Collection Planner

**Gap:** `active-learning-queue.ts` asks the operator to label uncertain
items, and `collection-gap-discovery.ts` flags structural holes — but
nothing answers "**which single check would most reduce uncertainty right
now?**"

For each active hypothesis, enumerate candidate observations (from negative-
evidence expected-signals, provider-redundancy disagreements, and open
collection gaps) and score each by expected entropy reduction: how much the
hypothesis's probability would move under each plausible result, weighted by
that result's likelihood. Pure Bayesian arithmetic over the existing belief
structures — no LLM call needed.

```
src/services/cognition/evoi-planner.ts
src/services/cognition/__tests__/evoi-planner.test.mts
```

```ts
export interface CollectionAction { label: string; targetFeed?: string; panelId?: string;
  expectedInfoGainBits: number; effort: 'glance' | 'minutes' | 'task'; explanation: string; }
export function planCollection(h: HypothesisLike, ctx: EvoiContext): CollectionAction[];  // sorted desc, top 5
```

Wiring: Command Center "what to watch next" gets EVOI-ranked items
(currently criticality-sorted only); `question-suggester.ts` chips can be
re-ranked by info gain. This turns the app from *reporting* uncertainty into
*directing its reduction* — arguably the most "analyst brain" feature in the
whole plan.

## PR 10 — Operator Forecast Journal (calibration training)

**Gap:** the app grades its own forecasts but never lets the operator make
one. Forecasting skill is trainable (the entire superforecasting literature),
and the personalization story is incomplete if the human is the only
unscored model in the room.

Lightweight prediction journal: on any hypothesis, the operator logs their
own probability; it resolves against the same outcome ledger; the journal
renders the operator's Brier score and reliability curve **next to the
system's** (reusing PR 2's `buildCurve` verbatim on journal records). Over
time the Operator Model (PR 4) learns per-domain `humanEdge`: domains where
the operator demonstrably beats the system get their alerts ranked up — the
human and the machine each get weighted by demonstrated skill.

```
src/services/cognition/forecast-journal.ts
src/services/cognition/__tests__/forecast-journal.test.mts
```

Ghost Mode suppresses journaling; data local-only; one new HUD affordance
(a probability slider on hypothesis detail) deferred to PR 6-style wiring.

## PR 11 (stretch) — Change-Point Detection + Semantic Ask-the-Data

Two smaller upgrades, bundled:

- **Bayesian online change-point detection** on the series
  `baseline-deviation.ts` already maintains. Z-scores answer "is now
  abnormal?"; BOCPD answers "did the regime just *shift*?" — earlier and with
  fewer false alarms on slow drifts. Constant-time per sample with a
  truncated run-length posterior (~120 lines). Emits `cb:regime-shift`
  events the analyst loop can convert into hypotheses.
- **Semantic Ask-the-Data:** once PR 1's embeddings exist, index
  `briefing-archive` + `snapshot-archive` entries and let
  `insights/ask-the-data.ts` fall back to semantic recall over past briefs
  when none of its six structured intents match — grounded answers with
  episode provenance, never free-form LLM generation.

## Considered and rejected (so future sessions don't re-litigate)

- **ACH / competing hypotheses** — already shipped (`competitive-hypothesis.ts`).
- **Multi-algorithm ensemble voting** — already shipped (`ensemble-voter.ts`).
- **Multi-agent debate/review** — already shipped (`multi-agent-review-loop.ts`).
- **Counterfactual replay** — already shipped (×2 modules).
- **Time-series foundation models** — violates the no-new-runtime-deps rule;
  revisit only if a sidecar-hosted ONNX runtime ever lands.
- **Full probabilistic-programming scenario trees** — cost/complexity out of
  proportion; `strategic-simulation.ts` + PR 9 cover the practical need.
- **Granger-style causal discovery** — `pattern-memory.ts` pair-tracking +
  the cascade-pair table cover the high-value cases; full lagged-graph
  discovery is research-grade noise risk on feeds this heterogeneous.

# Part D — Performance & self-optimization (PRs 12–16)

Added on a third audit pass (2026-06-10), focused not on new capability but
on making the cognition layer **fast, measurably correct, and
self-tuning**. Key discovery: the repo already ships a complete
self-optimization stack — `algorithms/tunable-params-store.ts`,
`algorithms/safe-adjustment.ts` (bounded proposals, never auto-applied),
`intelligence/backtest-engine.ts` (backtest-before-apply gate),
`algorithms/drift-detector.ts` (Page-Hinkley on rolling F1),
`intelligence/shadow-mode.ts` (passive A/B ledger), and an ONNX
`ml-worker.ts`. Parts A–C never plugged into it. Part D closes that loop.

## PR 12 — Self-tuning cognition (highest leverage in Part D)

Register the cognition layer in the existing self-improvement machinery:

1. **Declare every cognition constant as a tunable.** Extend
   `tunable-params-store.ts` `DECLARATIONS` with bounded knobs:
   episodic `minSim` (0.30–0.60), analog blend constant (3–10), calibration
   shrinkage prior (5–20), extremization k (1.0–1.8), spread-skip threshold
   (0.15–0.40), entity heat half-life (24–168 h), interest decay half-life,
   consolidation cluster threshold (0.5–0.75). All cognition modules read
   via the store's get-with-default — hardcoded values become defaults,
   exactly the pattern the store was built for.
2. **Register cognition outputs as algorithms** in `algorithm-registry.ts`:
   `episodic-analog` (outputKind `risk_score`), `recalibration`
   (`forecast`), `superforecast` (`forecast`), `operator-ranking`
   (`ranking`), `entity-trajectory` (`risk_score`). Criticality: `medium`
   except operator-ranking (`low`). They then get evaluation-ledger grading,
   hit-rate tracking, and `AlgorithmDiagnosticPanel` visibility for free.
3. **Drift watch**: `drift-detector.ts` already consumes the evaluation
   ledger — once cognition algorithms are graded, sustained degradation
   (e.g. embeddings going stale as the world changes) fires `retune`/
   `shadow` actions automatically.
4. **Safe adjustment loop**: below-floor cognition algorithms get bounded
   parameter proposals via `safe-adjustment.ts`, validated before apply.
   (Implementation note, 2026-07-06: the plan originally named
   `backtest-engine.ts`, but the tuning-apply runner had already replaced
   that with `historical-backtest.ts` + `tuning-safety-fixtures.ts` — the
   synthetic backtest engine cannot score an arbitrary knob. Cognition
   knobs flow through those gates: `episodic-analog:minSim` has a real
   discriminating safety-fixture suite; every other cognition knob fails
   closed, so its proposals are held for approval.) The operator approves;
   nothing self-applies. **The system now tunes its own cognition within
   declared safe envelopes** — this is the single most advanced property
   in the entire plan, and it costs almost no new code.

## PR 13 — Shadow rollout discipline

Use `shadow-mode.ts` (passive paired-output ledger) for every behavioral
swap in Parts A–C, so upgrades prove themselves before they take over:

- PR 2 recalibration runs in shadow against the legacy
  `getBoostMultiplier()` path for ≥ 200 paired forecasts; flip only if
  shadow Brier ≤ live Brier (gate constant, tested).
- PR 3 superforecast shadows the existing `forecastHypothesis` output.
- PR 8 learned schemas shadow hand-authored signature matches before being
  allowed to notify.

Add `npm run cognition:shadow-report` (script over the shadow ledger) so
the flip decision is a printed number, not a feeling.

## PR 14 — Compute placement + memory hygiene

- **Worker offload**: vector top-K over 2 000 × 768-dim and consolidation
  clustering can take tens of ms — off the main thread. Add a
  `cognition.worker.ts` beside the existing `workers/ml.worker` (same Vite
  `?worker` pattern as `ml-worker.ts`); main-thread API stays async and
  identical, so it's a transparent swap. Consolidation (PR 8) schedules via
  `requestIdleCallback` with a visibility guard.
- **Embedding middle tier**: `ml-worker.ts` already runs ONNX models
  (`MODEL_CONFIGS` in `@/config/ml-config`). Evaluate adding a small
  quantized embedding model (e.g. all-MiniLM-class, ~25 MB int8) as a tier
  between Ollama and hashed — neural quality with zero external process.
  Spike first: bundle-size budget is CI-enforced, so the model must load
  from `public/` at runtime, never the JS bundle.
- **Embedding cache**: content-hash → vector memo in `reasoning_memory`
  (cap 5 000) so re-embedding identical text never happens.
- **Memory hygiene**: episodic dedupe by signature before insert;
  `recall()` excludes episodes whose hypothesis was refuted by
  `competitive-hypothesis` resolution from *supportive* analog scoring
  (they remain retrievable, flagged `contradictory` — contradictions
  surface, never silently dropped).

## PR 15 — LLM quality engineering

- **Self-consistency sampling**: when the budget allows, persona
  probability elicitation (PR 3) samples k = 3 and takes the median —
  the standard variance-reduction trick for LLM forecasts. Declared as a
  tunable (k ∈ 1–5) so PR 12 can tune cost vs accuracy.
- **Strict structured output**: one shared `parseStrictJson<T>(text,
  validate)` helper in `cognition/llm-json.ts` — schema-validate, one
  repair attempt (regex-extract the outermost JSON object), then fail to
  the deterministic path. Today each service hand-rolls this.
- **Difficulty routing**: decomposition and persona takes prefer the local
  tier; only the final aggregate-review call (optional) is allowed
  `preferCloud`. Encode in `superforecast.ts`, not the adapter.
- **Prompt fixtures**: golden prompt → expected-structure tests for every
  cognition prompt (assert section order, `<evidence>` wrapping, JSON
  contract presence) so prompt drift is caught in CI like any regression.

## PR 16 — Cognition benchmark + CI gate

The end-to-end "is the brain getting better?" measurement:

- `src/services/cognition/__bench__/golden-windows.ts`: 10–15 frozen
  historical fixture windows with known outcomes (house pattern:
  `replay-fixtures-catalog.ts`), spanning conflict / market / weather /
  cyber / shortage.
- `npm run bench:cognition` replays each window through the full pipeline
  (episodic recall → base rate → aggregation → recalibration → conformal)
  and prints: Brier, conformal coverage rate, analog-recall
  precision@5, schema true-positive rate, and p50/p95 pipeline latency.
- CI gate (extend the existing test workflow): fail on Brier regression
  > 0.02 absolute or coverage drop below 1−α−0.05 versus the committed
  baseline JSON. Update the baseline only deliberately, in a reviewed diff.

## Acceptance criteria (whole plan)

- Every probability surfaced anywhere in the app passes through PR 2
  recalibration and carries an explanation trail.
- A hypothesis about a recurring pattern (e.g. Black Sea grain disruption)
  surfaces at least one past analog with outcome within one analyst cycle.
- SuperForecast degrades gracefully to deterministic-only with the cloud
  budget at 0 — verified by a fixture test, not by hope.
- Personalization never moves any ranking by more than ±20% and never defers
  a safety-critical notification — both property-tested.
- All learning features are individually disable-and-wipeable from Settings.
- 100+ new unit tests, all green offline (hashed tier, static fixtures).
- (Part C) Conformal intervals satisfy the coverage property on fixtures;
  learned schemas are auto-retired when their hit rate decays; EVOI
  recommendations carry an explanation of *why* each check is informative;
  the operator's reliability curve renders beside the system's.
- (Part D) Every cognition constant is a declared tunable with bounds; every
  cognition output is a registered, graded, drift-watched algorithm; every
  behavioral swap ships through shadow mode with a printed flip decision;
  `bench:cognition` runs in CI with a regression gate; no cognition work
  ever blocks the main thread for more than a frame.

## Plan status: COMPLETE

Parts A–D are the full extent of what is worth building. The ceiling has
been audited three times (capability pass, frontier-gap pass, performance/
self-optimization pass) against both the codebase and the 2026 state of the
art. Future sessions: do not extend this plan — implement it, starting at
PR 1. New ideas belong in a successor plan after PR 16 ships and the
benchmark has produced at least one month of data to learn from.
