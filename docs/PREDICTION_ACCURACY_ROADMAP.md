# Prediction Accuracy Roadmap

> Status: ACTIVE
> Updated: 2026-07-27
> Owners: Codex and Claude
> Scope: Forecast accuracy, outcome resolution, calibration, model comparison,
> correlation quality, safe promotion, and production monitoring.

This file is the single source of truth for prediction-accuracy work. Codex and
Claude must read it before changing forecast, calibration, correlation, or
self-tuning behavior. Detailed historical designs remain useful references,
but task ownership and completion evidence live here.

## Goal

Make Crystal Ball demonstrably better at forecasting future events from API
data while preserving explainability, provenance, safety, and fast diagnosis.

The target architecture is hybrid:

- deterministic rules for safety constraints, deduplication, source fusion,
  and known causal relationships;
- statistical models for calibrated probabilities and time-to-event estimates;
- LLMs for evidence extraction, hypothesis generation, contradiction finding,
  and explanations, never as the only source of ground truth;
- champion/challenger evaluation so a model changes production behavior only
  after beating a relevant baseline on unseen, time-ordered outcomes.

## Definition of complete

This roadmap is complete only when all of the following are true:

1. Every production forecast type declares a stable target, horizon, algorithm
   version, and resolvable criteria at emit time.
2. Market, weather, conflict, shortage, and mode-forecast predictions have
   deterministic outcome resolvers or an explicit documented reason they
   require manual review.
3. The evaluation workbench reports Brier score, log loss, Brier skill score,
   calibration error, resolution coverage, expiration rate, and lead time by
   source, domain, horizon, and algorithm version.
4. Every promoted model has at least 200 paired resolved forecasts overall and
   at least 100 in each domain where it is allowed to affect production.
5. Every promoted challenger has positive out-of-sample Brier skill versus the
   domain-and-horizon base-rate model, does not regress log loss, and passes a
   paired bootstrap no-regression gate against the incumbent.
6. Rare-event models show no regression in safety-event recall or median
   warning lead time on frozen replay fixtures.
7. Automatic promotion is reversible, version-scoped, bounded, and fail-closed
   when evidence is insufficient or diagnostics are unhealthy.
8. The 30-day production report has no overdue resolver jobs for seven
   consecutive days and no unexplained prediction cohort loss.
9. `npm run doctor -- --deep`, the cognition/correlation benchmarks, and all
   required GitHub checks are green apart from explicitly accepted provider
   configuration warnings.
10. Remaining model candidates are either promoted or rejected with recorded
    out-of-sample evidence. Rejection is a valid completed result.

## Current production baseline

Captured from installed main `081d9db3` on 2026-07-26:

| Measure | Baseline |
|---|---:|
| Forecast records | 55 |
| Resolved | 44 |
| Pending | 2 |
| Expired | 9 |
| Overdue pending | 0 |
| Aggregate Brier | 0.456 |
| Analyst-loop Brier | 0.569 over 32 resolved |
| Security mode-forecast Brier | 0.153 over 12 resolved |
| Runtime algorithm evaluations | 3,202 |
| Ground-truth-graded runtime evaluations | 0 |

Interpretation:

- The security forecast is promising but undersampled.
- The analyst loop is materially miscalibrated on its current resolved cohort.
- Forty-four resolved predictions are enough to expose problems, not enough to
  justify a complex learned model.
- The runtime ledger has good execution coverage but needs authoritative
  outcome adapters before it can drive tuning.

Do not compare future raw Brier values to this table across a different event
mix. Use matched cohorts and Brier skill against a baseline trained only on the
earlier portion of the same time-ordered evaluation window.

## Coordination protocol

### Claiming work

1. Start from current `main` on a fresh `codex/*` or `claude/*` branch.
2. Take the lowest-numbered unblocked task unless another task has higher
   ground-truth compounding value.
3. Search open PRs for the task id before starting.
4. Claim the task by opening a draft PR whose title or body contains
   `Roadmap task: ACC-NNN`. The draft PR is the live in-progress signal.
5. One agent owns a task at a time. Do not create overlapping implementations.
6. Move the task to `DONE` and add its PR plus verification evidence in the
   same implementation PR. A local commit is not completion.

### Status values

- `TODO`: unclaimed and dependencies are satisfied.
- `WAITING`: blocked on another task or a stated data threshold.
- `IN REVIEW`: an open PR owns the task.
- `MONITOR`: code is merged; completion requires a production evidence window.
- `DONE`: merged to `main` and its acceptance checks passed.
- `REJECTED`: evaluated and intentionally not shipped, with evidence recorded.

### Handoffs

Every implementation PR must include:

- roadmap task id;
- before/after metric or behavior;
- files and data contracts changed;
- tests and benchmark commands run;
- known limitations and rollback path;
- exact next unblocked task;
- cross-agent review or an explicit human waiver accepted by repository policy.

If a task reaches a data threshold wait, mark it `MONITOR` with the exact exit
condition and continue with another unblocked task.

## Key systems

| System | Responsibility |
|---|---|
| `src/services/intelligence/forecast-calibration.ts` | Durable forecast records and outcomes |
| `src/services/intelligence/forecast-calibration-adapter.ts` | Persistence and shared store access |
| `src/services/intelligence/hypothesis-prediction-bridge.ts` | Analyst forecast targets and dedupe |
| `src/services/cognition/superforecast.ts` | Multi-persona probabilistic challenger |
| `src/services/cognition/shadow-rollout.ts` | Paired live/shadow comparison and flip reports |
| `src/services/cognition/recalibration.ts` | Reliability-curve recalibration |
| `src/services/algorithms/algorithm-evaluation-ledger.ts` | Runtime algorithm evidence |
| `src/services/algorithms/algorithm-diagnostics.ts` | Version-scoped runtime and calibration diagnostics |
| `src/components/BeliefCalibrationPanel.ts` | Existing calibration surface to extend |
| `src/components/calibration-report-view.ts` | Pure calibration view models |
| `scripts/doctor.mjs` and `tools/mcp-server/` | Agent-readable production diagnostics |
| `src/services/correlation/` | Correlation kernel, outcomes, and learned rules |
| `src/services/ops/replay-harness.ts` | Frozen safety and missed-event replay |

## Delivery order

Ground-truth collection and evaluation tooling can proceed in parallel. Model
promotion cannot.

```text
Phase 1 Ground truth ─┬─> Phase 3 Baselines ─> Phase 4 Promotion ─> Phase 6 Models
Phase 2 Evaluation ──┘               │
                                     └─> Phase 7 Production proof

Phase 2 Evaluation ─> Phase 5 Correlation benchmark ─> Correlation changes
```

## Phase 0 — Stabilize the measurement spine

Purpose: ensure forecasts survive reload, comparable models share outcomes, and
historical versions cannot contaminate current health or tuning.

| ID | Status | Work | Evidence |
|---|---|---|---|
| ACC-001 | DONE | Wire shortage and mode-forecast calibration bridges | PR #1495 |
| ACC-002 | DONE | Surface live kernel-scored correlation pairs | PR #1498 |
| ACC-003 | DONE | EVOI ranking, domain report card, recalibration shadow pairs | PR #1499 |
| ACC-004 | DONE | Align episode and situation entity vocabularies | PR #1500 |
| ACC-005 | DONE | Durable shared-target analyst/superforecast truth spine | PR #1510, main `3a34c1e7` |
| ACC-006 | DONE | Separate runtime from lifecycle and isolate algorithm versions | PR #1511, main `081d9db3` |
| ACC-007 | DONE | Establish this shared execution roadmap and agent pointers | PR #1512 |

Phase exit: ACC-001 through ACC-007 are on `main`.

## Phase 1 — Expand authoritative ground truth

Purpose: replace label scarcity and generic LLM grading with deterministic,
target-specific outcomes from data Crystal Ball already ingests.

### ACC-101 — Resolver contract and market-move resolver

Status: `DONE`

Evidence: PR #1514

Verification: 503 intelligence tests and 12,675 renderer tests passed;
provider, algorithm, cognition, MCP diagnostics, strict lint, full TypeScript,
production build, and no-lookahead/continuous-coverage checks passed.

Dependencies: ACC-005

Create or modify:

- `src/services/intelligence/forecast-calibration.ts`
- `src/services/intelligence/outcome-resolvers.ts`
- `src/services/market/spot-price-store.ts`
- `src/services/intelligence/hypothesis-prediction-bridge.ts`
- `src/services/cognition/superforecast.ts`
- `src/services/providers/fusion-ingest.ts`
- `src/services/algorithms/algorithm-diagnostics.ts`
- the existing slow dispatch cadence in `src/app/panel-layout.ts`

Deliver:

- typed resolution criteria declared at forecast emission;
- a pure resolver registry and dispatch function;
- deterministic market threshold/direction resolution against fused price data;
- provenance and `resolutionNote` distinguishing direct and proxy outcomes;
- dedupe and no-lookahead tests.

Verify:

- focused resolver and bridge tests;
- `npm run test:intelligence`;
- `npm run typecheck:all`.

Reference: `docs/PREDICTION_UPLIFT_PLAN.md`, Workstream B1.

### ACC-102 — Weather verification resolver

Status: `DONE`

Owner: Codex

Branch: `codex/acc-102-weather-resolver`

Evidence: PR #1515

Verification: bounded warning-ingest, current IEM LSR code mapping, direct
positive, no-lookahead, complete-coverage proxy, malformed-input,
nationwide-cap, persistence-size, CLI doctor, and MCP diagnostics fixtures
passed. Live NWS and IEM payloads were schema-checked; `npm run test:weather`,
`npm run test:intelligence`, `npm run test:algorithms`,
`npm run test:diagnostics`, and `npm run typecheck:all` passed.

Dependencies: ACC-101

Create or modify:

- `src/services/weather/warning-verification-bridge.ts`
- `src/services/intelligence/outcome-resolvers.ts`
- NWS/SPC loader wiring in `src/app/data-loader.ts`
- algorithm, doctor, and MCP diagnostics

Deliver:

- bounded, simplified warning polygons;
- matching NWS warning type, location, and time window to SPC/LSR reports;
- direct positive labels and explicitly proxy-marked absence labels;
- nationwide record caps and persistence-size tests.

Verify:

- weather resolver fixtures;
- `npm run test:weather`;
- `npm run test:intelligence`;
- `npm run typecheck:all`.

Reference: `docs/PREDICTION_UPLIFT_PLAN.md`, Workstream B2.

### ACC-103 — Conflict and geospatial event resolver

Status: `DONE`

Owner: Codex

Branch: `codex/acc-103-geospatial-resolver`

Evidence: PR #1518

Dependencies: ACC-101 and ACC-004

Create or modify:

- `src/services/intelligence/outcome-resolvers.ts`
- hypothesis criteria stamping at the relevant prediction bridge
- observation-query adapters for conflict, military, and security events

Deliver:

- conservative entity, region, event-type, and horizon matching;
- minimum independent-evidence requirement;
- unresolved output instead of guessed negative labels;
- durable proxy provenance.

Verify:

- conflict resolver fixtures covering near matches and false joins;
- `npm run test:intelligence`;
- `npm run typecheck:all`.

Verification: conflict, military, security, protest, and corroborated-news
adapters feed a bounded resolver that requires exact target matching and two
independent sources. Intelligence, cognition, renderer, reasoning, situations,
news, algorithm, diagnostics, weather, security, strict lint, TypeScript,
production build, lockfile, and secret-scan gates passed.

Reference: `docs/PREDICTION_UPLIFT_PLAN.md`, Workstream B3.

### ACC-104 — Grade runtime algorithms from authoritative outcomes

Status: `DONE`

Owner: Codex

Branch: `codex/acc-104-authoritative-grading`

Dependencies: ACC-101 through ACC-103

Create or modify:

- adapters under `src/services/algorithms/`
- `algorithm-evaluation-ledger.ts`
- prediction/outcome bridge integration

Deliver:

- link forecast targets to relevant runtime evaluations without exposing raw
  input hashes in diagnostics;
- preserve exact algorithm version;
- prefer direct API outcomes, retain bounded LLM grading as fallback evidence;
- report direct, proxy, manual, and LLM label counts separately.

Acceptance:

- the production algorithm ledger begins accumulating non-LLM graded records;
- no outcome can grade a different target, horizon, or version.

Verification: PR #1521 links emitted forecasts to opaque ledger evaluations,
requires exact target, horizon, and algorithm-version attribution at grade time,
and backfills persisted forecasts idempotently at startup. Direct, proxy, manual,
and LLM origins are persisted and reported separately while diagnostics omit raw
forecast identifiers and input hashes. One bounded LLM runner remains
(five labels per 12 hours, after 48 hours), and authoritative-linked records are
ineligible for it. Algorithm, intelligence, cognition, shortage, weather,
diagnostics, security, 12,722 renderer tests, strict/full lint, TypeScript,
production build, offline smoke, lockfile, and secret-scan gates passed.

### ACC-105 — Resolution-quality audit

Status: `DONE`

Owner: Codex

Branch: `codex/acc-105-resolution-quality-audit`

Dependencies: ACC-101 through ACC-104

Deliver:

- deterministic fixtures for label leakage, duplicated outcomes, late data,
  contradictory providers, and proxy-label uncertainty;
- a report of resolution coverage and label source by domain;
- fail-closed behavior when observations are malformed or ambiguous.

Phase exit:

- market, weather, and conflict resolvers are live;
- at least one direct outcome and one safe proxy outcome are proven end to end;
- direct/proxy/LLM/manual label origin is visible in diagnostics.

Verification: PR #1523 adds deterministic leakage, duplicate-outcome,
late-data, contradictory-provider, and uncertain-proxy fixtures. Structured
resolution metadata now fails closed unless bounded evidence explicitly
supports the label, while ambiguous mode and shortage window closures expire
without contaminating Brier scores. Privacy-safe diagnostics and the doctor/MCP
tools report resolution coverage, label origins, and quality defects by domain.
The live market, weather, and conflict resolvers retain direct and corroborated
proxy paths established in ACC-103/104. Intelligence, shortage, algorithm,
diagnostic, security, 12,732 renderer tests, strict/full lint, TypeScript,
production build, bundle budgets, offline smoke, lockfile, dependency audit,
and secret-scan gates passed.

## Phase 2 — Build the forecast evaluation workbench

Purpose: make error analysis and model comparison fast enough that tuning is
driven by evidence instead of intuition.

### ACC-201 — Proper-scoring and cohort metrics

Status: `DONE`

Owner: Codex

Branch: `codex/acc-201-forecast-evaluation`

Dependencies: ACC-005

Create:

- `src/services/intelligence/forecast-evaluation.ts`
- `src/services/intelligence/__tests__/forecast-evaluation.test.mts`

Deliver pure functions for:

- Brier score and per-record Brier contribution;
- clipped binary log loss;
- empirical base rate and Brier skill score;
- equal-mass expected calibration error;
- calibration slope/intercept when the cohort is large enough;
- resolution and expiration coverage;
- paired bootstrap confidence intervals using a seeded PRNG;
- grouping by target, source, domain, horizon bucket, and algorithm version.

Guardrails:

- calculate baselines from the training window only;
- return `insufficient_evidence`, not a persuasive number, below declared
  sample floors;
- exclude proxy labels by default, with an explicit option to include them.

Verify:

- known-answer metric fixtures;
- seed-repeatability tests;
- `npm run test:intelligence`;
- `npm run typecheck:all`.

Verification: PR #1524 adds a deterministic, wall-clock-independent evaluation
contract with per-record Brier and clipped-log-loss contributions, empirical
training baselines, Brier skill, equal-mass ECE, calibration slope/intercept,
resolution and expiration coverage, and seeded paired bootstrap intervals.
Training labels must be resolved before the evaluation window begins, proxy
labels are excluded unless explicitly enabled, malformed horizons remain
visible in an `invalid` cohort, and every aggregate returns
`insufficient_evidence` below its declared floor. Target, source, domain,
horizon, and version rollups share the same guardrails. Sixteen known-answer
fixtures within 556 intelligence tests, plus 302 algorithm, 395 diagnostic,
12,748 renderer, strict and changed-file lint, TypeScript, production build,
offline smoke, bundle/precache/sidecar budgets, 114 security tests, dependency
audit, lockfile, documentation, and secret-scan gates passed.

### ACC-202 — Per-forecast workbench UI

Status: `DONE`

Owner: Codex

Branch: `codex/acc-202-forecast-workbench`

Dependencies: ACC-201

Extend:

- `src/components/BeliefCalibrationPanel.ts`
- `src/components/calibration-report-view.ts`
- their existing tests

Deliver:

- filters for source, domain, horizon, version, and resolution method;
- sortable forecast rows showing probability, observed outcome, Brier
  contribution, evidence age, target, and resolution note;
- reliability chart and cohort comparison;
- worst-error and high-confidence-miss drilldowns;
- explicit insufficient-sample states.

No new panel is needed unless the existing panel becomes unusably dense.

Verification: PR #1525 turns the existing Belief Calibration panel into a
wide, interactive forecast workbench without creating another panel. Five
cohort filters, deterministic sorting, explicit training/proxy/unscored metric
exclusions, a Wilson-interval reliability chart, overall-versus-selected
holdout metrics, and bounded error drilldowns all share ACC-201's fixed 60/40
chronological evaluation contract. Seventeen focused component fixtures within
12,756 renderer tests, plus 556 intelligence, 302 algorithm, 395 diagnostic,
strict and changed-file lint, TypeScript, production build, offline smoke,
bundle/precache/sidecar budgets, 114 security tests, dependency audit,
lockfile, documentation, and secret-scan gates passed. Live browser checks
also exercised all filters, sorting, proxy exclusions, insufficient-evidence
rendering, chart accessibility, and the wide-panel layout without root
overflow.

### ACC-203 — Diagnostics and MCP evaluation export

Status: `DONE`

Owner: Codex

Branch: `codex/acc-203-evaluation-diagnostics`

Dependencies: ACC-201

Extend:

- `src/services/algorithms/algorithm-diagnostics.ts`
- `scripts/doctor-core.mjs`
- `tools/mcp-server/tools/diagnostics.mjs`
- related tests and privacy redaction

Deliver:

- bounded agent-readable cohort metrics;
- worst-performing source/domain/horizon pairs;
- resolution backlog and label-origin counts;
- no claims, evidence bodies, secrets, or high-precision locations in exports.

Verification: PR #1527 adds a shared chronological 60/40 split, aggregate
holdout Brier, log loss, base rate, Brier skill, equal-mass ECE, calibration
fit, coverage, exclusions, resolution backlog, label origins, and the ten
worst evidenced source/domain/horizon cohorts to renderer diagnostics, the
doctor report, and the MCP tools. Cohorts below ACC-201's evidence floors stay
explicitly `insufficient_evidence`; proxy labels remain excluded; agent
boundaries allowlist the aggregate schema and strip injected raw fields.
Privacy fixtures prove that claims, resolution notes, evidence references,
target keys, scored records, and high-precision warning coordinates are
absent. Twenty-four focused evaluator/diagnostic fixtures within 557
intelligence and 304 algorithm tests, 396 diagnostic tests, 12,780 renderer
tests, changed-file ESLint, strict lint, TypeScript, production build, offline
smoke, bundle/precache/sidecar budgets, 69 security tests, dependency audit,
lockfile, and secret-scan gates passed. The documentation freshness gate
continues to report only the pre-existing main-branch omission for PR #1526.

### ACC-204 — Time-ordered replay corpus and benchmark

Status: `DONE`

Owner: Codex

Branch: `codex/acc-204-replay-benchmark`

Evidence: PR #1529

Verification: `npm run bench:forecast` replays a privacy-safe frozen
120-record corpus through four expanding windows with strict prediction-time
cutoffs and passes committed Brier-skill, log-loss, resolution-coverage, and
high-confidence-miss gates. The 80-record evaluation window resolves 71
records and scores 65 direct/manual labels (88.75% resolution coverage),
with Brier 0.237735, log loss 0.698403, and Brier skill 0.005795. Loss
attribution identifies the analyst loop as 75.4% of total Brier loss
(Brier 0.448, skill -0.906, eight high-confidence misses) while the security
mode retains positive 0.796 Brier skill. The Belief Calibration panel, CLI
doctor, and MCP diagnostics now expose bounded source/domain/horizon/version
loss attribution. Five hundred sixty-two intelligence tests, 304 algorithm
tests, 12,786 renderer tests, 106 MCP tests, diagnostics suites, strict lint,
full TypeScript, production build, offline smoke, cognition and forecast
benchmarks, bundle/precache/sidecar budgets, 69 security tests, dependency
audit, lockfile, and secret-scan gates passed. Documentation freshness now
reports only the pre-existing main-branch omission for PR #1526.

Dependencies: ACC-201 and ACC-101

Create:

- frozen forecast/outcome fixtures under
  `src/services/intelligence/__bench__/`
- a benchmark runner under `scripts/`
- committed baseline JSON
- `npm run bench:forecast`

Deliver:

- expanding-window or walk-forward splits;
- no random train/test shuffle;
- source, domain, horizon, and version metrics;
- a regression gate for Brier skill, log loss, resolution coverage, and
  high-confidence misses.

Phase exit:

- one command reproduces the forecast benchmark;
- the UI and MCP surface explain exactly where the analyst loop's current
  Brier loss comes from.

## Phase 3 — Establish hard-to-beat baselines

Purpose: prove that sophisticated forecasting adds value beyond simple,
well-calibrated alternatives.

### ACC-301 — Hierarchical base-rate model

Status: `DONE`

Owner: Codex

Branch: `codex/acc-301-hierarchical-base-rate`

Evidence: PR #1530

Verification: `hierarchical-base-rate@1.0.0` requires 30 direct/manual
resolved outcomes, deduplicates shared target/window labels, rejects proxy and
future-known evidence and malformed forecast windows, applies a Beta(1,1)
global prior, falls back globally below 20 domain outcomes, and shrinks
domain/horizon cells only after 10 matching outcomes. Eligible production
forecasts emit one versioned baseline on the same target and horizon;
hypothesis, mode, shortage, market, and warning resolution paths grade or
expire the pair together. The frozen four-fold walk-forward corpus reports
hierarchical baseline Brier 0.238945 versus 0.238997 for the global Beta
baseline, with a hard regression gate if the hierarchy trails global. The
incumbent forecast remains only narrowly positive against the stronger
baseline (Brier skill 0.005062); this task does not promote a learned model.
Final verification passed `typecheck:all`, strict repository linters, scoped
ESLint, 12,801 renderer tests, the intelligence, algorithm, shortage,
diagnostics, and security suites, production build, offline smoke, both
deterministic benchmarks, dependency and secret scans, scenario coverage, and
bundle/PWA/sidecar budgets. Repository-wide `npm run lint` still reports the
pre-existing legacy/generated-file baseline (1,577 findings); no finding is in
the ACC-301 change set.

Dependencies: ACC-201 and ACC-204

Deliver:

- Bayesian-smoothed empirical event rates by domain and horizon bucket;
- global fallback for sparse domains;
- strict time cutoff so future outcomes cannot enter earlier predictions;
- versioned predictions written through the same target spine.

### ACC-302 — Persistence and momentum baselines

Status: `DONE`

Owner: Claude

Branch: `claude/acc-302-persistence-momentum`

Evidence: PR #1533

Verification: `persistence-baseline@1.0.0` covers state-like advisory targets
(criteria-less `mode:*`/`shortage:*` targetKeys) with a Laplace-smoothed
recent-window rate over the target's own prior resolutions, filtered by the
exact ACC-301 leakage predicate narrowed to the targetKey. `momentum-baseline@1.0.0`
covers directional `market_move` targets: least-squares slope over pre-forecast
fused spot prices (6h lookback, ≥5 samples, hard `observedAt < predictedAt`
filter inside the model AND a bounded accessor at the adapter), projected over
the horizon against the criteria threshold and squashed through a bounded tanh
map. All other target kinds (event occurrence, warning verification,
hypothesis) return `not_applicable` (null) by construction, with tests pinning
each gate. Both models clone the production record (targetKey/window/criteria
inheritance → paired resolution and expiry for free), emit through the single
`recordPrediction(s)` choke point behind distinct id namespaces
(`persistence:`/`momentum:` alongside `base-rate:`), and are registered with
`forecast_calibration` health domains so ledger grading engages. The shared
`BASELINE_SOURCE_IDS` family exclusion prevents any baseline training on any
other baseline (hierarchical included; corpus-neutral — `npm run
bench:forecast` passes with the ACC-301 committed metrics unchanged).
Deferred to ACC-303 by design: replay-corpus evaluation of the new families —
the frozen corpus carries no repeated targetKeys or price series, so
persistence/momentum corpus fixtures land with the pairing work. Verified:
`typecheck:all`, 17 new fixture tests plus hierarchical/adapter/calibration/
momentum suites (51), algorithm-registry suite, scoped ESLint, and the frozen
forecast replay benchmark, all green.

Dependencies: ACC-301

Deliver only where the domain contract supports it:

- persistence baseline for state-like targets;
- recent-trend/momentum baseline for directional market or pressure targets;
- clear `not_applicable` results for event types without a defensible baseline.

### ACC-303 — Pair all baselines with production forecasts

Status: `DONE`

Owner: Claude

Branch: `claude/acc-303-baseline-pairing`

Evidence: PR #1536

Verification: emission-side pairing has been live since ACC-301/302 (every
eligible production forecast emits its applicable baselines on the same
targetKey and window through the recordPrediction choke point). This task adds
the three missing pieces. (1) Shadow-rollout run
`production-vs-{hierarchical-base-rate,persistence-baseline,momentum-baseline}`
(one run PER baseline model): one pair pushed per emitted baseline, whose
input carries the STABLE join fields (targetKey, predictedAt, resolveBy,
production/baseline source ids + versions) ACC-401's exact joins require —
wired fire-and-forget from the adapter via lazy import (no store cycle),
kill-switch respected. (2) A dedicated deterministic walk-forward benchmark
(`npm run bench:baselines`, corpus `baseline-pairing-v1`, 72 closed-form
fixtures with repeated targetKeys and embedded pre-forecast price series —
the structures the frozen ACC-301 corpus lacks) reporting record count, Brier,
and Brier SKILL vs the production incumbent per model, gated by a committed
JSON (synthetic incumbent 0.152317; hierarchical −0.115069, momentum
−0.057487, persistence −0.238375 skill). The corpus incumbent is a DISCLOSED
outcome-informed oracle — skill here is a fixed regression reference, not a
claim about real production skill; the live per-model shadow runs
(production-vs-{hierarchical,persistence,momentum}) measure the real thing,
each family in its own run so per-model aggregation and ACC-401 joins never
mix. Gate fails closed on baseline Brier, record drift, missing models,
incumbent drift, and skill drift; run in CI beside bench:forecast. (3) Phase-exit
coverage proof as a test: every production emitter family (mode, shortage,
hypothesis/superforecast market and non-market, warning verification) yields
at least one relevant baseline from the real builders. The frozen ACC-301
replay benchmark is untouched and still passes. Verified: typecheck:all, the
new pairing suite (5), adapter + shadow-rollout suites, both deterministic
benchmarks, scoped ESLint.

Dependencies: ACC-301 and ACC-302

Extend the existing shadow-rollout path so incumbent, superforecast, base-rate,
and applicable persistence/momentum models emit predictions for the same
`targetKey` and horizon.

Phase exit:

- every production model has at least one relevant baseline;
- benchmark reports Brier skill, not raw Brier alone.

## Phase 4 — Champion/challenger promotion

Purpose: make model replacement measurable, reversible, and resistant to
selection bias.

### ACC-401 — Exact paired-outcome joins

Status: `DONE`

Owner: Claude

Branch: `claude/acc-401-exact-joins`

Evidence: PR #1564

Verification: `ShadowComparison` gains a first-class optional `ShadowJoinKey`
(targetKey, predictedAt, resolveBy, live/shadow model ids + versions,
feature-set version) persisted through compare/clone/hydrate — never an
approximate hash. The three ACC-303 baseline runs now verdict through
`exactPairedVerdict`: resolved calibration records are indexed by exact
identity (targetKey ⊕ predictedAt ⊕ resolveBy ⊕ producing sourceId, with
conflicting-outcome identities dropped whole per ACC-301 semantics),
comparisons join only on that identity, pairs produced at-or-after the
outcome observation are excluded, and both models score on the identical
joined cohort by construction (one comparison carries both probabilities).
Verdict `pairs` for these runs now means JOINED resolved pairs — the
evidence count ACC-402's promotion gate consumes — and the ACC-303 fence is
removed. The regression that motivated the task is pinned: two forecasts at
p=0.6 resolving oppositely join to their own outcomes with exact Brier
(0.26 vs 0.41 on the fixture). Legacy runs (recalibration/superforecast/
schema) keep their existing joins unchanged — migrating their producers to
join keys is ACC-402-adjacent follow-on. Verified: typecheck:all, shadow
suite 24/24 incl. post-outcome exclusion, identity-conflict drop, model-id
mismatch, and min-pairs honesty; adapter + pairing suites; both
deterministic benchmarks unchanged; scoped ESLint.

Dependencies: ACC-303

Extend `src/services/cognition/shadow-rollout.ts`:

- join by stable target and horizon, never approximate hashes;
- carry model id, algorithm version, feature-set version, and prediction time;
- require both models to be scored on the same resolved target cohort;
- exclude records produced after the outcome observation.

### ACC-402 — Promotion and rollback gate

Status: `DONE`

Owner: Claude
Branch: `claude/acc-402-promotion-gate`

Dependencies: ACC-401 (DONE — #1564)

Deliver:

- minimum 200 paired outcomes overall and 100 per enabled domain;
- positive Brier skill versus base rate;
- challenger log loss no worse than incumbent;
- paired bootstrap lower bound at or above the no-regression floor;
- safety replay recall and lead-time gates;
- one-click or configuration-based rollback to the previous version;
- no automatic promotion from proxy-only cohorts.

Evidence: `src/services/cognition/promotion-gate.ts` —
`evaluatePromotionGate()` runs seven explained gates (min-pairs overall
200 / per enabled domain 100, strict Brier skill vs the cohort base
rate, log-loss no-regression vs the incumbent, one-sided 95% paired
bootstrap lower bound on per-pair Brier improvement with a deterministic
seeded PRNG, safety replay recall + lead-time floors that fail closed
when no safety fixtures ran, and a direct-outcomes gate so a proxy-only
cohort can never auto-promote). Evidence flows from ACC-401's exact
joins via `collectJoinedEvidence()` in shadow-rollout.ts, which now
attributes per-pair domain and resolution provenance kind (direct
dominates proxy on a shared identity; conflicts still drop).
`safetyEvidenceFromReplayReport()` distills the ops replay harness
report. `src/services/cognition/champion-registry.ts` is the single
configuration mutator: `promote()` refuses any non-'promote' decision
and stores the full gate evidence for audit; `rollback(slot)` is the
one-call restore of the previous distinct champion (version included),
persisted under `crystalball-champion-registry-v1` and surviving
rehydration. Shadow-ledger retention is now PER RUN
(`MAX_COMPARISONS_PER_RUN` 300 + global ceiling 1800 in
shadow-mode.ts) so one chatty run can no longer evict another run's
promotion evidence — the ACC-401 review's evidence-starvation concern.
Verified: 53 tests across promotion-gate/champion-registry/
shadow-rollout suites, full test:cognition 632/632, adapter + ACC-302
suites, frozen bench:forecast + bench:baselines unchanged,
typecheck:all, scoped ESLint.

### ACC-403 — Champion/challenger status surface

Status: `DONE`

Owner: Claude
Branch: `claude/acc-403-status-surface`

Dependencies: ACC-402 (DONE — #1566)

Show:

- active champion and version;
- challengers and evidence counts;
- metric deltas with confidence intervals;
- promotion, rejection, rollback, and insufficient-evidence reasons.

Evidence: `src/services/cognition/champion-status-view.ts` —
`buildChampionStatusView()` is the pure view-model: active champion +
version + activation reason (or an honest "no champion installed —
awaiting ACC-404" state), per-challenger evidence counts (overall +
per-domain + proxy share), Brier and log-loss deltas each with a
two-sided 90% paired-bootstrap confidence interval (deterministic
seeded PRNG shared with the gate; `pairedBootstrapInterval` +
`brierImprovementDiffs`/`logLossImprovementDiffs` added to
promotion-gate.ts, with the gate's one-sided lower bound refactored
onto the same resample core — bench-verified unchanged), and
promotion / rejection / insufficient-evidence reasons taken verbatim
from the ACC-402 gate results (min-pairs failures map to
insufficient-evidence; rollbacks and promotions surface through the
registry history as recent-activity rows). Rendered as the
"Champion / Challenger" section of `AlgorithmDiagnosticPanel`
(existing panel — no new panel wiring), composed live from
`getChampionRegistry()` + `collectJoinedEvidence()` per shadow run +
`evaluatePromotionGate()` with real safety evidence from
`runReplay(buildCatalogReplayFixtures())`. Verified: 12-test
champion-status-view suite + bootstrap-addition tests (66 across the
four cognition suites touched), typecheck:all, scoped ESLint, frozen
bench:forecast + bench:baselines unchanged.

### ACC-404 — First production promotion decision

Status: `DONE`

Owner: Claude
Branch: `claude/acc-404-first-decision`

Dependencies: ACC-402 (DONE — #1566) and the data threshold

Outcome:

- promote the superforecast or another challenger only if it passes;
- otherwise record `REJECTED` or continue `MONITOR` with the exact missing
  evidence. A no-promotion result can complete this task.

Phase exit:

- the first evidence-backed promote-or-reject decision is recorded;
- rollback is tested against the installed app.

Evidence: the first evidence-backed decision is **MONITOR** (no
promotion), recorded durably in
`docs/decisions/2026-07-29-acc404-first-promotion-decision.md` with the
full machine record. The ACC-402 gate ran against the installed app's
REAL evidence (read-only extraction from the production WKWebView
localStorage): superforecast 0 joined pairs (its comparisons carry no
join keys yet), hierarchical-base-rate 14/200 (87 raw comparisons, only
the 14 post-ACC-401 rows join), persistence/momentum 0 (emission path
not yet exercised in the installed build) — each verdict carries the
exact missing evidence verbatim from the gate.
`src/services/cognition/first-promotion-decision.ts` is the pure
recorder (per-challenger PROMOTE/REJECTED/MONITOR semantics, overall
precedence, persistence under `crystalball-acc404-first-decision-v1`);
`scripts/acc404-first-decision.mts` re-runs the decision from any
localStorage export using the live modules. Running against real data
exposed and fixed an ACC-403 safety-evidence flaw: the replay catalog's
fixtures are intentionally-failing historical-miss cases (raw recall 0/4,
lead −1440 min), so the gate now consumes
`safetyEvidenceFromBaselineRegression` — no-NEW-regressions vs the
committed replay baseline (5/5, lead-time only from passing warnings) —
in both the panel composition and the decision script. Rollback is
tested against the installed app via the new `champion_rollback`
self-test probe (SystemDiagnostic → Self-Test):
`runChampionRollbackSelfTestFixture()` proves setInitial → promote →
rollback restores the previous champion on an isolated in-memory
registry inside the shipped bundle. Verified: 34 tests across the
first-promotion-decision + self-test suites (self-test regression guard
updated to the 10-probe set), typecheck:all, scoped ESLint, frozen
benches unchanged.

## Phase 5 — Correlation quality and statistical controls

Purpose: improve event relationship discovery without converting correlation
noise into confident forecasts.

These tasks retain their detailed designs in
`docs/PREDICTION_UPLIFT_PLAN.md`.

| ID | Status | Work | Dependencies |
|---|---|---|---|
| ACC-501 | DONE | Frozen correlation benchmark and `bench:correlation` CI gate | ACC-201 |
| ACC-502 | TODO | Multiple-comparison correction and inhibitory edges | ACC-501 (DONE) |
| ACC-503 | TODO | Multi-hop mediation/confounder filtering | ACC-501 (DONE) |
| ACC-504 | TODO | Dispersion correction for bursty streams | ACC-501 (DONE) |
| ACC-505 | TODO | Per-regime correlation reliability | ACC-501 (DONE) |
| ACC-506 | WAITING | Bounded correlation-kernel tunables and safety fixtures | ACC-502 through ACC-505 |

Safety invariant: learned inhibitory or dampening evidence may soften
confidence but must never suppress a safety-critical delivery rung.

Phase exit:

- correlation changes improve or preserve frozen precision/recall;
- false learned edges fall on confounded and bursty streams;
- tuning cannot bypass the benchmark or safety fixtures.

### ACC-501 — Frozen correlation benchmark and `bench:correlation` CI gate

Status: `DONE`

Owner: Claude
Branch: `claude/acc-501-correlation-benchmark`
PR: #1596

Dependencies: ACC-201 (DONE)

Outcome — delivered:

- `src/services/correlation/__bench__/golden-streams.ts` — 10 frozen
  streams, 378 observations over a fixed 30-day span, with **two levels**
  of planted truth: domain-level `PLANTED_COUPLINGS` (5 causal, plus
  independent / confounded / mediated / inhibitory traps) grading the
  lead-lag miner, and event-level `plantedTruePairKeys()` /
  `decoyEventIds()` grading the engine's built-in rules. Fixed-seed
  jitter, no clock reads, no fetch.
- `src/services/correlation/bench-correlation.ts` — pure replay through
  the **real** miner and two **real** `CorrelateEngine` instances
  (`timer: () => 0`, fixed `now`): pass A built-ins only, pass B with the
  learned rules mined from the same corpus.
- `src/services/correlation/bench-correlation-baseline.ts` +
  `__bench__/bench-correlation-baseline.json` — committed baseline with
  **one-sided** tolerances and exact-equality identity checks (corpus digest,
  rule inventory, whole-report digest) that short-circuit before any metric
  comparison. Identity is the strict half: any change that moves ANY reported
  number — regression *or* improvement — fails and must be re-seeded via
  `npm run bench:correlation -- --seed`, and the one-sided tolerances then
  decide, at re-seed time, whether the new numbers may replace the old.
- `npm run bench:correlation` (`scripts/correlation-benchmark.mts`),
  wired as a step in `.github/workflows/smoke.yml`. Exit codes mirror
  `bench:cognition`: 0 pass / 1 regression / 2 baseline unreadable.
- 174 unit tests in
  `src/services/correlation/__tests__/bench-correlation.test.mts`,
  covering both the corpus (the traps still trap) and the gate (one-sided
  tolerances, zero-tolerance decoy leakage, corpus-drift short-circuit, a
  regression per demonstrated PASS-on-nothing across thirteen review rounds, and
  an exhaustive leaf sweep proving the report digest covers every field).

Gate hardening from the Codex cross-agent review (baseline `schemaVersion: 2`).
Every item below is a way the first cut would have reported PASS on a benchmark
that had stopped measuring anything:

- **Corpus identity is a content digest, not three counts.**
  `goldenCorpusDigest()` (FNV-1a over every observation field, every planted
  coupling, every true-pair key, every decoy id) — timestamps, domains and
  truth labels can all be edited while stream / observation / coupling counts
  hold steady, which is how an easier corpus passes as an improvement.
- **Fails closed on non-finite numbers.** `NaN > tolerance` is false, so a
  missing baseline field or a corrupt report used to satisfy every directional
  check. Both sides of every gated metric are now validated finite first.
  `cappedZ` likewise throws on `NaN` / `−Infinity` instead of mapping them to
  the cap.
- **Usefulness is gated, not only blast radius.** A pipeline that emits zero
  learned rules has zero false positives and zero pair volume — perfect on
  every "lower is better" gate, and dead. `causalLearnedRuleCount` and
  `meanTruePairConfidence` are gated against shrink, so neither the rule
  pipeline nor the confidence kernel can quietly disappear.
- **Discrete false-edge growth is gated at zero.** 22 → 24 significant edges
  moves precision 0.2273 → 0.2083, inside the 0.02 ratio tolerance; on a
  deterministic corpus that is still two new false edges.
- **A perfect miner scores as an improvement.** Zero false edges makes
  evidence separation `null`; coercing it to 0 reported an 8.49 regression for
  achieving exactly what ACC-502..504 exist to achieve.
- **Pair precision divides by DISTINCT pairs.** Two legitimate rules matching
  one planted pair inflated the denominator without the numerator.
- **`--json` emits only JSON on stdout** — the verdict goes to stderr; exit
  codes are unchanged.

Second-round hardening from the same reviewer (baseline `schemaVersion: 3`).
Each of these was demonstrated live: the reviewer edited the corpus or the
report, and the gate still returned PASS.

- **The digest is JSON-encoded, not delimiter-joined.** `['a','b']` and
  `['a,b']` flatten to the same delimited string, so content could move across
  an array boundary — an entity id into a tag, a tag into the next field —
  without moving the hash. `JSON.stringify` quotes and escapes every element,
  so array shape is part of the hashed bytes. Digest `206cda25` → `13cd95ef`.
- **A missing gated metric fails closed, not just a null one.** The separation
  operand excused `null` (legitimate: a perfect miner) via a coercion that also
  excused `undefined`. Deleting `edgeEvidenceSeparation` outright returned
  `{ok: true, reasons: []}`. The null case is now matched exactly and everything
  else falls through to the finite check.
- **Learned rules are gated on FIRING, not on being synthesised.** Counting
  synthesised rules cannot see the install → match path go dark. The new
  `causalLearnedRulePairCount` is gated as *liveness* — no shrink tolerance,
  because shrinking total pair volume is a goal — and trips only when the
  baseline emitted pairs and the live run emits zero while still synthesising
  causal rules.
- **The report must agree with itself.** The perfect-miner exemption trusted
  `falseEdgeCount === 0` without reconciling the five breakdown fields that sum
  to it; setting that one field bought the exemption while 17 false edges sat
  in the detail. Four cross-checks now run before any gate: the false-edge
  breakdown must sum to the total, causal + FP learned rules must equal the
  learned-rule count, and both causal-subset counts must not exceed their
  supersets.
- **The tolerance block is validated too.** It is untyped JSON on disk;
  `couplingRecallDrop: "garbage"` made its comparison `NaN`, and `NaN > tol`
  is false, so the gate reported PASS on a real recall collapse. Unknown keys
  and non-finite / negative values are now rejected before any comparison runs.
- **The distinct-pair denominator has an exercising test.** The live corpus
  emits exactly one pair per key (22 === 22), so the existing
  `distinct <= raw` assertion would stay green if the fix were reverted;
  `gradeEnginePairs` is now driven directly with one pair matched by two rules.

Third-round hardening from the same reviewer (baseline `schemaVersion: 4`).
The round-2 fixes held, but the reviewer demonstrated seven further live PASS
results — each one an edit that removed real measurement while the gate stayed
green.

- **The digest is 128-bit.** A 32-bit FNV digest is brute-forceable in seconds,
  and the reviewer found a preimage: replacing the decoy id `s10-wildfire-wa`
  with a 7-character string reproduced `13cd95ef` exactly, dropping that decoy
  from grading with corpus identity intact. FNV-1a now runs at 128 bits over
  BigInt (still no `node:crypto`, so the module stays renderer-importable).
  Digest `13cd95ef` → `9bf277acf1747bf73f19e30e511b934f`.
- **Causal-rule liveness is proportional, not exactly-zero.** 19 → 1 causal
  learned-rule pairs is the same dead install/match path as 19 → 0, with one
  survivor, and the exact-zero check passed it. Gated at a 0.5 shrink ratio.
- **The baseline must ARM every gate it feeds.** Every gate here is
  baseline-relative, so re-seeding `causalLearnedRulePairCount: 0` disabled its
  gate permanently — and a re-seed is reviewed by a human reading numbers.
  Fifteen baseline fields must now be positive or the run fails.
- **Summaries reconcile against the row-level ledger.** Zeroing
  `falseEdgeCount` *and* all five breakdown fields made the report agree with
  itself and bought the perfect-miner exemption while `edges` still listed 17
  false verdicts. The ledger is now cross-checked, as is `couplingPrecision`
  against the edge counts it is derived from.
- **Positive pair rates require pairs behind them.** Both engine pair counts at
  0 with precision and recall at 1.0 passed — `0 > 0` satisfied the only
  consistency check. Distinct emissions are now a gated metric with a
  zero shrink tolerance, and positive rates over zero pairs are rejected.
- **Impossible values are rejected, not scored as improvements.**
  `pairPrecision: 2` is finite and reads as better than 1.0 against every
  directional check. Rates are range-checked to [0,1] and counts to
  non-negative integers, on both sides.
- **Tolerance validation runs in both directions.** It validated only the keys
  that were present, so `tolerances: null`, a scalar, or a block missing half
  its keys fell back to the compiled defaults and could still pass. The block
  must now be a complete object.
- **The distinct-pair denominator test drives production code.** The round-2
  test computed its own ratio, so reverting the production line to
  `graded.pairCount` left it green. Precision is now computed by an exported
  `enginePairPrecision()` that the report assembly calls, pinned on a graded set
  where the two counts differ.

Fourth-round hardening from the same reviewer (baseline `schemaVersion: 5`).
Eight more live PASS results. The theme has not changed — a gate that reports
PASS on a benchmark that measured nothing — but each round reaches one level
deeper into the reconciliation.

- **The digest is LENGTH-PREFIXED, not separator-framed.** Width was never the
  issue: a separator byte is just another code unit, so hashing `decoy:first`
  then `decoy:second` reaches exactly the state of hashing the single record
  `decoy:first_decoy:second` — two real decoy ids replaced by one synthetic id,
  both traps removed from grading, digest unmoved. Prefixing each record with
  its length makes the encoding injective, so no regrouping of the corpus can
  collide. Digest `9bf277acf1747bf73f19e30e511b934f` → `a0e284431f365d35e1706fe6ca79adc4`.
- **Every tolerance has a ceiling.** Validating tolerances as finite and
  non-negative only stops the NaN class. A block of individually plausible wide
  values (`causalLearnedRulePairShrinkRatio: 1`, `enginePairShrink: 22`, rate
  drops of `1`) disarms every liveness gate at once while the baseline still
  looks armed. Each key now has a per-key ceiling above which it is rejected.
- **An empty edge ledger cannot carry positive miner rates.** Clearing `edges`
  takes every row-level reconciliation with it, and zeroed summaries agree with
  each other — but a miner that reported no edges cannot have scored 22.7%
  precision on them.
- **Coupling recall and the learned-rule summaries reconcile against detail.**
  Recall now cross-checks against the couplings the report itself names as
  missing, and `learnedRuleCount` / `causalLearnedRuleCount` against the
  `edges[].becameLearnedRule` rows that claim them.
- **Pair precision and recall must agree on the count they both imply.**
  `precision × distinct` and `recall × truePairUniverse` are two independent
  routes to the same quantity (true pairs emitted). Requiring agreement, and
  capping the implied count at the universe size, makes `distinct: 23` at
  precision and recall 1.0 — arithmetically impossible, previously a clean pass
  — fail.
- **The causal-pair liveness floor applies PER RULE.** Volumes are 7/6/6 = 19;
  a 0.5 aggregate shrink ratio floors at 9.5, so one rule dying entirely
  (19 → 13) passed. Sums hide their own zeros. The same proportional floor now
  applies to the weakest rule, and the per-rule tally is seeded from the rule
  IDs rather than from emitted pairs — a rule that fired nothing has no pairs
  to group by, and grouping by emission would drop it from the tally entirely.
- **Separation is bounded and each component is range-checked.** z-scores are
  clamped to [2,50], so a separation of means lives in [−48,48]:
  `edgeEvidenceSeparation: 1e300` is not a large separation but a fabricated
  one, and higher-is-better made it read as an improvement. Separately,
  `confoundedFalsePositives: -1` against `unplantedFalsePositives: +3` preserved
  `falseEdgeCount` exactly, satisfying the sum reconciliation with a negative
  count.
- **`edgeEvidenceSeparation` joined the must-arm set.** Re-seeding both sides at
  0 while 17 false edges remain retires the 8.49 → 0 collapse permanently.

One residual is documented rather than claimed fixed: the live corpus emits 22
raw / 22 distinct pairs, so **no** end-to-end assertion driven through
`runCorrelationBenchmark()` can distinguish the raw pair denominator from the
distinct one. It is mitigated structurally — precision is computed in exactly
one place, `enginePairPrecision()` takes a `Pick<>` that does not have the raw
count in scope, and the pair-arithmetic reconciliation fires on any corpus where
the two counts differ — but a corpus that exercises the difference end-to-end
would be a stronger proof.

Fifth-round hardening from the same reviewer (baseline `schemaVersion: 5`, now
pinned by exact equality rather than a floor). Six more findings, four of them
live PASS results on a benchmark that had stopped measuring.

- **Schema version is pinned, and the digest must be a digest.** A baseline
  written before a field existed reads that field as `undefined`, which is not
  a number, which no directional comparison rejects; `schemaVersion` is now
  compared against a pinned `CORRELATION_BENCH_SCHEMA_VERSION` constant. Worse,
  corpus identity was checked with `===` on two values that could both be
  absent — `undefined === undefined` is the identity gate passing on the absence
  of identity. Both operands must now match a 32-hex-character pattern before
  any number below them is treated as comparable.
- **Every must-arm field is paired with its tolerance floor.** A field seeded
  positive still disarms its gate if the tolerance that reads it is itself set
  to the width of the metric. The must-arm set and the per-key ceilings are now
  one table, so a gate cannot be armed on one side and disarmed on the other.
- **Internal consistency is checked on the BASELINE too, not only the report.**
  Every reconciliation ran against the live run; the committed baseline — the
  side a human edits — was trusted. `learnedRuleFalsePositives: 99` in the
  baseline sailed through.
- **A rate implies a whole number of things.** A rate is a ratio of two
  integers, so `rate × denominator` must land on an integer within the 4dp
  rounding slack. `pairPrecision: 0.5123` over 22 distinct pairs implies 11.27
  true pairs — a value no grading pass can produce, and previously a clean
  improvement over 0.2273.
- **The gate re-derives the summaries from a row-level ledger.** Round 4 caught
  summaries that disagreed with each other; the reply was summaries that agreed
  because they were all written by the same hand. `CorrelationBenchReport` now
  carries `edges[]` and `pairs[]` — per-edge support/lift/z/verdict and per-pair
  rule ids/confidences — and the gate re-derives `edgeEvidenceSeparation`,
  `pairPrecision`, `pairRecall`, `meanTruePairConfidence`, `enginePairCount` and
  `decoyPairsEmitted` from them, checks every row against the miner's own
  thresholds (`minLift 2` / `minZ 2` / `minSupport 3`), and rejects
  `minedEdgeCount` below the number of edges that survived them. Forging a
  summary now means forging a self-consistent corpus of rows behind it.
- **The digest claims unique decodability, not collision resistance.** The
  round-4 length-prefix framing makes the encoding injective — a regrouping of
  the corpus can no longer collide for free. That is a property of the framing.
  The recurrence itself is a custom FNV-like function over UTF-16 code units,
  not a cryptographic hash, and the comments no longer imply otherwise.

Sixth-round hardening from the same reviewer (baseline `schemaVersion: 6`,
corpus digest `a0e2844…` → `8411c23a6f009f2245ec779a7593685e`). Round 5 answered
"the summaries agree with each other" with a row-level ledger; round 5's ledger
then answered for itself. Five P1 + two P2 findings, all one defect: **the rows
carried their own conclusions.** Each row stated its own `verdict`, its own
`isTruePair`, its own `decoyEmissions`, and the gate believed them — so
rewriting every endpoint to a fabricated id still returned PASS, because the
rows and the summaries were written by the same pass and only ever checked
against each other.

- **The gate imports planted truth and derives every conclusion.**
  `bench-correlation-baseline.ts` now imports `plantedCouplingIndex`,
  `plantedTruePairKeys`, `decoyEventIds` and `pairKeyFor` from
  `__bench__/golden-streams.ts` directly. Each edge row's verdict is re-graded
  from its `from`/`to` endpoints; each pair row now carries `eventIdA`/`eventIdB`
  so the gate can rebuild its key, re-look-up planted truth, and re-derive
  whether the pair touches a near-miss decoy. Truth comes from the corpus or it
  is not truth.
- **The five false-positive categories reconcile individually.** They summed to
  `falseEdgeCount`, so any reassignment between them was free — and the sum is
  what hides which trap the miner actually fell into. Each category is now
  reconciled against the rows that carry that verdict, and the causal row count
  against the recovered count implied by `couplingRecall` and `missingCouplings`.
- **Edge dedupe keys on the directed pair alone.** It included the lag window,
  so one causal coupling reported at two windows counted twice — padding that
  raises precision. The miner emits one edge per pair; a repeat is now rejected.
- **The built-in rule inventory is pinned by exact set equality.** Deleting a
  rule deletes the pairs it would have emitted, which reads as a smaller — and
  therefore better — denominator. The report carries `builtInRuleIds`, and a
  baseline that omits the list, or ships an empty one, fails closed.
- **`minedEdgeCount` is a gated metric, not just a floor.** A miner that stops
  mining improves precision *and* separation: fewer candidates, fewer false
  positives. The candidate count is the only number that falls, so it now has
  its own shrink tolerance and its own must-arm entry.
- **Decoy leakage is absolute zero on both sides.** The check was
  baseline-relative, so a baseline that admitted one leak licensed one leak
  forever. Neither operand may emit a decoy pair.
- **`pairKeyFor` is injective.** `${a}::${b}` made `('a','b::c')` and
  `('a::b','c')` one key, silently merging two distinct pairs into one ledger
  row. Each id is now length-prefixed, the same framing the corpus digest uses.
  This is what moved the digest, and the baseline was re-seeded for it.

Seventh-round hardening from the same reviewer (baseline `schemaVersion: 7`,
corpus digest unchanged at `8411c23a6f009f2245ec779a7593685e` — nothing here
perturbs the corpus). Round 6 made every EDGE and PAIR conclusion derivable from
planted truth. The reviewer then showed that the conclusions round 6 did not
reach were still authored by the pass that reported them: three P1 + two P2 + one
P3, each demonstrated as a mutation that PASSED the round-6 gate.

- **Pass B has a row ledger too.** The four learned-rule counters (`101 / 19 /
  [7,6,6] / 6`) had no row-level witness at all: forcing the second engine pass
  to emit nothing and restoring the four numbers returned PASS. The report now
  persists `learnedPairs` — one row per (learned rule, event pair) with both
  endpoints — and the gate derives all four counters from it. The row key is
  length-prefixed (`${ruleId.length}:${ruleId}${key}`) for the same reason
  `pairKeyFor` is: a bare separator is not a boundary.
- **The causal roster is re-derived from the graded edge rows.** It decides
  which learned emissions count as causal volume, so authoring it next to the
  grading launders a false rule's pairs. `checkCausalLearnedRoster` rebuilds it
  with `learnedRuleId()` from the edges graded causal against planted truth.
- **Rules are probed, not just inventoried.** An id in `builtInRuleIds` proves a
  rule is REGISTERED, not that its matcher still decides anything: five of the
  nine built-ins fire nowhere in the corpus, and forcing all five to return
  false left every number — and the verdict — unchanged. `__bench__/rule-probes.ts`
  gives each of the nine a positive fixture and a near-miss violating exactly one
  clause; the fixtures sit OUTSIDE the corpus, so they perturb no metric and no
  digest. A missing probe fails as loudly as a failing one. `ruleCoverage` (which
  four rules actually emit) is pinned by set equality and re-derived from the
  pair ledger, and a pair emission attributed to a rule the graded pass never
  registered is rejected.
- **Confidence cannot be a placeholder.** An exact 0 or 1, or one constant
  across the whole ledger, means the kernel ranked nothing — and every mean-based
  gate reads that as a clean score.
- **The baseline's false-positive breakdown is gated per category.** Rewriting
  `2/1/0/0/14` to `0/0/0/0/17` preserved the total the gate read and retired the
  confounded and mediated traps in silence. Each category now has its own
  zero-growth gate.
- **Edge rows validate their own window and their null coupling.** `windowHours`
  must be one of the miner's configured windows (`DEFAULT_WINDOWS_MS`), and
  `lift` and `zScore` are the same zero-chance-rate division — nulling every
  lift while keeping 22 finite z-scores bought the infinity exemption.

Eighth-round hardening from the same reviewer (corpus digest still unchanged).
Round 7 gave every conclusion a row-level witness. The reviewer then showed the
remaining soft spots are the numbers the gate never RE-DERIVES — five mutations,
each demonstrated as a PASS against the round-7 gate:

- **The mined-candidate count has a ceiling, not just a floor.** It was gated
  for shrink only, so `minedEdgeCount: Number.MAX_SAFE_INTEGER` passed. The
  miner tests each ordered pair of OBSERVED domains at each configured window,
  and that product (1088 here) is a hard upper bound on any run.
- **Pinned rosters are sets on the live side too.** Set equality is
  symmetric-difference, so a repeated id is invisible to it — and the inventory
  is what the per-rule counters are denominated in. Repeats are now rejected.
- **Coverage probes must name a registered rule.** Probes are counted, so an
  invented passing probe was free coverage; a probe outside the inventory the
  graded pass registered is rejected.
- **Edge evidence has to look like a measurement.** Every threshold on a row is
  a per-row FLOOR, so one admissible constant repeated across all 22 rows
  cleared all of them, and separation — derived from those same z-scores —
  agreed. A constant `support`, `lift` or `zScore` column is rejected: a miner
  that ranked nothing is not mining.
- **Edge endpoints must be domains the corpus observed.** "Not in the planted
  index" and "not in the corpus" were the same answer, so renaming the 14
  false-positive rows to invented domains kept them graded `unplanted` and
  reconciled against every summary.

Ninth-round hardening, and the one that ends the sequence. Eight rounds all
found the same shape of defect, because eight rounds all answered the same
question: *could* a run have produced these numbers? A careful enough forgery
answers yes every time — the reviewer deranged all 22 pair attributions onto
other registered rules, replaced every edge-evidence field with varied
admissible values and recomputed the separation off them, rebuilt the 101-row
pass-B ledger out of four rows citing a nonexistent rule, and deleted seven
advertised measurements outright. Each returned PASS.

The corpus is frozen and `runCorrelationBenchmark()` is deterministic and takes
no inputs, so the gate does not have to keep inferring. It now RE-RUNS the
benchmark and requires the submitted report to reproduce it field for field
(`checkReportIsReproducible`, memoized, reported as field paths). Every
self-authored number becomes uncheckable-in-principle → impossible. This runs
LAST: the named checks above still fire first, because a specific reason is what
a human re-seeding a baseline needs to read.

Two consequences worth stating plainly:

- **It does not block a real improvement.** The comparator re-runs the same
  miner the report came from, so when ACC-502 corrects the miner, both sides
  move together and only the baseline-relative gates have an opinion. What it
  blocks is a report that no run produced.
- **The constant-column heuristic was deleted, not kept as defence in depth.**
  It rejected a legitimate report whose ten edge rows naturally shared a support
  of 6. A heuristic that guesses at "did this measure anything" is strictly
  worse than re-deriving the answer, and worse than nothing when it is wrong.

Three gaps re-derivation does not close, because they are on the BASELINE side —
a committed file, with no run to reproduce it from — and each is now checked
directly: `minedEdgeCount` below its own `significantEdgeCount` (which licensed
the live candidate population collapsing from 256 to 22), `minedEdgeCount` above
what the corpus can produce (the ceiling was ordered-pairs × windows; the miner
returns one best window per ordered pair, so it is 272, not 1088), and a padded
pinned roster (the set check ran on the live side only).

Tenth-round hardening — the last circular seam. Re-derivation proves the report
matches THIS commit's producer, and nothing more: a change *inside*
`runCorrelationBenchmark()` moves the report and the comparator's re-run
identically, and the gate agrees with itself. The reviewer injected the
round-nine forgeries into the producer instead of the report — deranged pair
attribution, 101 learned-pair rows collapsed to four (one citing
`learned:not-real->not-real`), forged probe text, an advertised metric deleted —
and every one returned `ok: true, reasons: []`. None of them move an aggregate
the committed file pins.

`reportDigest` (`schemaVersion: 9`) is the anchor that lives outside the
process: a 128-bit digest over the WHOLE report, written into
`bench-correlation-baseline.json` by the human who re-seeded it, so no source
change can move it along with itself. Both producer-side forgeries above now
fail the gate.

Round 11 found the first cut of this anchor pinned the wrong half. At
`schemaVersion: 8` it covered only the row-level ledgers (edges / pairs /
learned pairs / probes), which left the SUMMARY layer — where the advertised
measurements live — pinned by nothing but in-process re-derivation: deleting
`meanCausalEdgeStrength` or `meanCausalEdgeZ` inside the producer, or forging
`causalCouplingsLostToCap`, still returned `ok: true, reasons: []`. It now
covers every field, containers included: an array emits its length and an
object its sorted key list before their contents, so a deleted field reads as a
changed shape rather than merely as a shorter run. An exhaustive leaf sweep in
the test file perturbs every leaf of the live report in turn and requires the
digest to move, so the coverage claim is asserted field by field rather than by
argument.

Numbers enter the digest rounded to 9 dp. At the original 4 dp a uniform
`strength - 0.00001` across the producer reproduced the committed digest
exactly; values live in `[0, 50]` where a ULP is ~1e-14, so 9 dp keeps about
five orders of margin over the last-bit noise of `Math.log`/`Math.exp` — which
are implementation-defined, and a digest that flaked between a macOS seed and
Linux CI would be deleted within a week — while shrinking the blind band to
1e-9.

The walk that compares a report to its re-run is descriptor-based
(`Reflect.ownKeys` + `getOwnPropertyDescriptor`, data descriptors only, value
read once from `descriptor.value`), so an accessor cannot answer the shape check
and the value check differently, and a non-enumerable own property cannot ride
along invisibly. A Proxy that lies CONSISTENTLY through both traps is out of
scope and documented as such — it would have to reproduce the live run field for
field, which is what the digest is computed over.

Re-seeding is one command rather than a hand-transcription of thirty numbers:
`npm run bench:correlation -- --seed` emits the complete baseline block from the
live run, carrying `note` and `tolerances` over verbatim because those encode
human judgement. A test round-trips the emitter against the committed file field
for field, so a hand-edit that quietly widens a tolerance shows up as a test
failure rather than as a gate measuring something nobody reviewed.

The cost is explicit and intended, and it revises the header contract: a real
change to the miner now fails on IDENTITY and must be re-seeded in a reviewed
diff. Tolerances stay one-sided and still govern everything after a re-seed;
what is gone is the ability for a change that moves the ledgers to pass in
silence. The failure message says which reading applies.

Two narrower defects closed in the same round:

- **A perfect miner could pass the gate and then not become the baseline.**
  Zero false edges means `edgeEvidenceSeparation` is `null`, and the committed
  side demanded a finite, positive number — so the ACC-502..504 goal state was
  un-seedable. It is nullable now, legal *only* when the same baseline pins
  `falseEdgeCount: 0`, with the separation gate ceding to `falseEdgeGrowth`.
- **The reproduction walk accepted a report that owned none of its fields.**
  `Object.create(realReport)` has zero own keys, serializes as `{}`, and answers
  every read from the prototype — it reproduced exactly. The walk now compares
  own enumerable key SETS, rejects non-plain prototypes, symbol keys and extra
  own properties (including array-object properties), and uses `Object.is`, so
  `-0` no longer equals `0`.

Round 12 (`schemaVersion: 10`) closed the last two places where the digest
covered a *field* but not the *claim* that field stood for. No graded number
moved in the re-seed — every metric in the table below is identical to
`schemaVersion: 9`'s.

- **Rule coverage probes recorded verdicts, not what was tested.** Each probe
  carried two booleans and free text, so a near-miss fixture could be re-aimed
  at a clause the rule still has — move `n1b.sourceId` off GDACS *and* delete
  the earthquake→tsunami distance clause, and both booleans stay true about a
  clause that no longer exists, with the report byte-identical. Probes now carry
  `fixtureDigest`: a digest over every field of the positive and negative
  fixtures plus the expected outcomes, canonicalised key-order-insensitively.
  Re-aiming a fixture lands in a reviewed diff.
- **The pair ledger erased direction and edge semantics before hashing.** Rows
  stored a sorted key with parallel `ruleIds` / `confidences` arrays, so
  rewriting a rule from `causal-candidate cause→effect` to
  `contradicts effect→cause` — two different claims, mapped differently into the
  evidence graph at `situation-store-v2.ts:335` — produced an identical report.
  Emissions are first-class rows now (`ruleId`, `edgeType`, and the endpoints in
  EMISSION order), and the gate rejects an emission whose endpoints do not build
  the row's own key. The pair KEY stays unordered on purpose: planted truth is
  about two events being related, not about which came first.

Two narrower items from the same round:

- **The digest said "something moved" without saying what.** A `witnessed` block
  now pins by value the five advertised-but-otherwise-ungated measurements
  (`meanCausalEdgeStrength`, `meanCausalEdgeZ`, `meanFalsePairConfidence`,
  `confidenceSeparation`, `causalCouplingsLostToCap`) plus one digest per
  ledger, and is checked immediately *before* the whole-report digest — so a
  re-seed diff names which measurement moved instead of only asserting that one
  did.
- **A tolerance test asserted its own input.** It fed the committed tolerances
  back through the seeder and checked they came out unchanged, which passes for
  any value. It now feeds a hand-edited block and proves the seeder transcribes
  rather than generates, and a second test proves the real defense —
  `TOLERANCE_CEILINGS` rejects a widened tolerance that tries to launder itself
  through a re-seed.

Round 13 (`schemaVersion: 11`) found that each round-12 fix had been applied to
half of the surface it named. Every case below was reproduced as a live
`{ok: true, reasons: []}` against the shipped `schemaVersion: 10` gate. No
graded number moved in the re-seed.

- **The learned-pair ledger still counted.** Round 12 made emissions
  first-class rows in `BenchPairRow` and missed `BenchLearnedPairRow`, which
  kept `emissions: number`. Rewriting every learned rule from
  `causal-candidate` to `contradicts` — the opposite assertion, and a different
  evidence edge downstream — left all 101 rows and the report digest
  byte-identical. Learned rows now carry the same `BenchPairEmission[]`, and
  every emission must name its own row's rule and hash to its own row's key.
- **Probes pinned what was asked, not what was answered.** Five of the nine
  shipped rules never fire over the golden corpus, so the probe row is their
  only observation anywhere in the benchmark. Inverting `airquality-wildfire`
  to `contradicts` preserved both probe booleans, the fixture digest and the
  report digest. Probes now record `positiveEdgeType` and `positiveDirection`
  (the emitted endpoints in EMISSION order), and the gate range-checks both.
- **One clause per rule is not coverage.** The earthquake→tsunami near-miss
  held the GDACS source gate valid and varied only distance, so deleting the
  source clause left the rule accepting any nearby humanitarian event while the
  probe still reported a clean rejection. Near-misses are now *patches* on the
  positive fixture, one per independently-defeatable clause — **59 clauses
  across 9 rules**, up from 9 — so a near-miss cannot drift from its positive
  except in the field it names. Two clauses per rule is an enforced floor and
  duplicate clause labels are refused.
- **A measured engine finding fell out of writing those fixtures.**
  `domainMatches()` (`correlate-engine.ts:208`) is a DISJUNCTION over the pair:
  `domainSet.has(a.domain) || domainSet.has(b.domain)`. Moving one event out of
  a rule's declared domains does not reject the pair — `CorrelationRule.domains`
  constrains considerably less than its name suggests. The domain-gate
  near-misses move both events.
- **The witnessed list comparison was not injective.** `causalCouplingsLostToCap`
  was compared through `.join(',')`, so the single element
  `"macro->maritime,space->infra"` compared equal to the real two-element array
  and passed. Lists now compare through JSON, which keeps element boundaries.

Seed measurements (uncorrected miner, 2026-07-30):

| Metric | Value |
|---|---|
| Coupling precision | 22.7% (5 causal of 22 significant, 256 mined) |
| Coupling recall | 100% (no planted causal coupling missed) |
| False positives | confounded 2 · mediated 1 · independent 0 · inhibitory 0 · unplanted 14 |
| Edge evidence separation (mean z) | 8.49 (causal 15.11 vs false 6.62) |
| Learned rules | 12 synthesised, 9 from non-causal edges |
| Engine pair precision / recall | 100% / 100%, 0 decoy pairs |
| Learned-rule pair blast radius | 101 pairs |

Findings the benchmark surfaced, each now a concrete target:

- `significantEdges()` applies **no** multiple-comparisons correction and
  **no** de-clustering — only three fixed thresholds (`minLift 2`,
  `minZ 2`, `minSupport 3`). CLAUDE.md and `docs/CORRELATION_NEXTGEN_PLAN.md`
  describe Bonferroni correction and de-clustered trials that do not exist
  in the code; **ACC-502 is what makes those claims true.**
- Of the 14 unplanted edges, 6 are a *systematic* near-coincidence that
  will survive a Bonferroni correction (z=4.63 vs z_crit≈3.66 at 256
  tests) and 8 are weak incidental noise a correction should kill — so
  ACC-502 alone is not sufficient.
- `LeadLagEdge.strength` **saturates**: every causal edge scores exactly
  1.0 and false edges average 0.9498, a separation of 0.05. That nearly
  flat ranking is what decides which 12 edges survive
  `MAX_LEARNED_RULES`, and it is why two genuinely causal couplings
  (`macro->maritime`, `space->infra`) were evicted in favour of burst
  artefacts. The gated separation metric therefore runs on the raw
  z-score, which has real dynamic range; `edgeStrengthSeparation` is kept
  as reported-only evidence of the defect.
- The engine's built-in rules are already perfect on event-level truth,
  so **all** the available headroom in Phase 5 is in the miner.

## Phase 6 — Evaluate better statistical models

Purpose: add complexity only where data volume and out-of-sample evidence
justify it.

### ACC-601 — Model-readiness report

Status: `WAITING`

Dependencies: ACC-204

For every domain, report:

- resolved outcomes and class balance;
- feature availability at prediction time;
- missingness and provider drift;
- defensible model families;
- whether the cohort meets the data gate below.

### ACC-602 — Bayesian/logistic challenger for sparse domains

Status: `WAITING`

Dependencies: ACC-601 and at least 200 resolved, class-balanced-enough outcomes

Use regularized or hierarchical logistic prediction with domain/horizon priors.
It must expose coefficients or feature contributions and run in shadow mode.

### ACC-603 — Survival or hazard challenger

Status: `WAITING`

Dependencies: ACC-601 and at least 300 timestamped event/censoring records

Use a time-to-event model for questions such as escalation within a horizon.
Score both occurrence probability and timing. Keep censoring explicit.

### ACC-604 — Gradient-boosted tabular challenger

Status: `WAITING`

Dependencies: ACC-601 and at least 1,000 resolved records with at least 100
positive and 100 negative outcomes in the training cohort

Use only lagged, prediction-time-available features. Compare against the
regularized model and base rate. Reject it if the added complexity does not
improve the frozen walk-forward benchmark.

### ACC-605 — LLM feature-extraction ablation

Status: `WAITING`

Dependencies: ACC-602 or ACC-604

Compare:

- structured API features only;
- API features plus deterministic text features;
- API features plus LLM-extracted structured evidence.

LLM prose and self-grades are never labels. Retain LLM features only when the
ablation shows out-of-sample uplift without unacceptable cost or latency.

Model data gates:

| Model | Minimum evidence before implementation |
|---|---|
| Smoothed base rate | 30 resolved globally; sparse domains shrink to global |
| Regularized/hierarchical logistic | 200 resolved with usable class balance |
| Survival/hazard | 300 timestamped event and censoring records |
| Gradient-boosted trees | 1,000 resolved; at least 100 per class |
| Neural sequence model | 10,000+ resolved and proven incremental value |

A model task may close as `REJECTED` when its data gate or benchmark result
shows it is not appropriate.

Phase exit:

- every eligible model family has an out-of-sample promote-or-reject record;
- no model is promoted because it sounds more advanced.

## Phase 7 — Production monitoring and closure

### ACC-701 — Drift and cohort-health monitor

Status: `DONE`

Owner: Codex

Branch: `codex/acc-701-mcp-hardening`

Evidence: PR #1597

Merged: `93d94aa1`

Verification: the MCP monitor persists bounded snapshots and deduplicated
findings for holdout Brier regression, feed readiness changes, evaluation
missingness, prediction-volume shifts, resolution-coverage drops, algorithm
version loss concentration, and explicit derived-output quarantine. It records
recoveries and fails closed when live collection or algorithm diagnostics are
unavailable. The same safety envelope blocks quarantined analyst hypotheses
and forecasts while preserving independent authoritative observations. A
15-minute macOS LaunchAgent runs the portable monitor command outside agent
sessions. The MCP surface is generated from one 59-tool registry with safety
annotations, structured output, capability discovery, compact diagnostics,
and an approved read-only route policy. Verified with the full MCP suite,
portable installed-binary handshake, dependency audit, strict lint, explicit
ESLint, secret scan, typecheck, and production build.

Dependencies: ACC-201 and ACC-402

Detect:

- calibration and base-rate drift;
- source/provider behavior drift;
- feature missingness changes;
- prediction volume and resolution coverage changes;
- version cohort loss or contamination.

### ACC-702 — Scheduled evaluation report

Status: `DONE`

Owner: Codex

Branch: `codex/acc-702-scheduled-evaluation-report`

Evidence: PR #1618

Implementation: `59a822eb`, `b8ce8d05`, `4676530f`

Mutation evidence: `docs/validation/ACC-702-MUTATION-PROOFS.md`

Verification: weekly UTC aggregation, bounded catch-up and retention,
privacy allowlists, stale and unavailable diagnostics, committed-generation
gating, immutable mode-0600 persistence, CLI/MCP registration, portable
package installation, cadence-completeness enforcement, and fifteen mutation
proofs passed. Repaired weekly and monitor validation finished at 46 pass / 0
fail; the full MCP suite finished at 199 pass / 0 fail. Cognition regression
finished at 654 pass / 0 fail and the frozen benchmark remained Brier 0.1681,
conformal coverage 100.0%, analog precision@5 75.0%, and schema TPR 75.0%.

Dependencies: ACC-701

Generate a privacy-safe weekly report through CLI and MCP with:

- champion/challenger metrics;
- unresolved/expired predictions;
- model and provider drift;
- rejected/promoted changes;
- next recommended task.

### ACC-703 — Thirty-day production proof

Status: `WAITING`

Dependencies: all earlier phases required by the completion definition

Record:

- matched-cohort benchmark versus the 2026-07-26 starting point;
- Brier skill and calibration by active domain;
- safety recall and lead-time results;
- provider and outcome-resolution coverage;
- every promoted and rejected model decision.

### ACC-704 — Close and archive the program

Status: `WAITING`

Dependencies: ACC-703 and all tasks `DONE` or `REJECTED`

Update this document to `COMPLETE`, move superseded implementation details to
the archive, update `ROADMAP.md`, `AGENTS.md`, and `CLAUDE.md`, and leave the
weekly monitoring path active.

## Global verification matrix

Every task runs focused tests first, then the smallest relevant rows:

| Change area | Required commands |
|---|---|
| Forecast/calibration core | `npm run test:intelligence`, `npm run typecheck:all` |
| Cognition or model comparison | `npm run test:cognition`, `npm run bench:cognition` |
| Algorithm health/tuning | `npm run test:algorithms`, `npm run test:diagnostics` |
| Correlation engine | focused correlation tests, then `npm run bench:correlation` (ACC-501, gated in CI) |
| Runtime/sidecar/MCP | `npm run test:diagnostics`, `npm run smoke` |
| UI surface | focused view-model tests, `npm run test:renderer`, relevant smoke/axe checks |
| Every PR | `npm run lint:ci`, `npm run typecheck:all`, `npm run secrets:scan:staged`, `git diff --check` |
| Before production claim | GitHub required checks, install merged `main`, `npm run doctor -- --deep --json` |

## Open risks and assumptions

- Event prevalence changes over time; raw Brier comparisons across unmatched
  periods are misleading.
- Proxy outcomes increase volume but can encode confirmation bias. Direct and
  proxy cohorts must remain separable.
- API history may be incomplete or revised after publication. Store the
  prediction-time observation identity and timestamp.
- Rare events make accuracy and ROC-AUC look deceptively good. Use proper
  scoring, precision/recall, and warning lead time.
- The current prediction store is local to the app. Do not assume cloud-scale
  sample volume or add infrastructure before local evidence proves the need.
- Model training and evaluation must remain reproducible on Apple Silicon and
  must not require uploading private user data.
- Provider credentials affect coverage. Missing optional providers should be
  labeled, not silently imputed as healthy evidence.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-26 | Use this file as the single prediction-accuracy execution board | Existing roadmaps overlapped and had stale trackers |
| 2026-07-26 | Start deterministic resolvers and evaluation metrics in parallel | Labels compound with time; metrics can be built against current records |
| 2026-07-26 | Require baselines and walk-forward evaluation before model promotion | Raw accuracy and in-sample fit are insufficient |
| 2026-07-26 | Keep LLMs out of the ground-truth role | LLM judgment is useful fallback evidence, not authoritative API truth |
| 2026-07-26 | Make advanced model tasks conditional | Current 44 resolved forecasts cannot support complex ML responsibly |
