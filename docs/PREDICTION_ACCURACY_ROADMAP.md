# Prediction Accuracy Roadmap

> Status: ACTIVE
> Updated: 2026-07-26
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

Status: `TODO`

Dependencies: ACC-101

Create or modify:

- `src/services/weather/warning-prediction-bridge.ts`
- `src/services/intelligence/outcome-resolvers.ts`
- NWS/SPC loader wiring in `src/app/data-loader.ts`

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

Status: `WAITING`

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

Reference: `docs/PREDICTION_UPLIFT_PLAN.md`, Workstream B3.

### ACC-104 — Grade runtime algorithms from authoritative outcomes

Status: `WAITING`

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

### ACC-105 — Resolution-quality audit

Status: `WAITING`

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

## Phase 2 — Build the forecast evaluation workbench

Purpose: make error analysis and model comparison fast enough that tuning is
driven by evidence instead of intuition.

### ACC-201 — Proper-scoring and cohort metrics

Status: `TODO`

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

### ACC-202 — Per-forecast workbench UI

Status: `WAITING`

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

### ACC-203 — Diagnostics and MCP evaluation export

Status: `WAITING`

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

### ACC-204 — Time-ordered replay corpus and benchmark

Status: `WAITING`

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

Status: `WAITING`

Dependencies: ACC-201 and ACC-204

Deliver:

- Bayesian-smoothed empirical event rates by domain and horizon bucket;
- global fallback for sparse domains;
- strict time cutoff so future outcomes cannot enter earlier predictions;
- versioned predictions written through the same target spine.

### ACC-302 — Persistence and momentum baselines

Status: `WAITING`

Dependencies: ACC-301

Deliver only where the domain contract supports it:

- persistence baseline for state-like targets;
- recent-trend/momentum baseline for directional market or pressure targets;
- clear `not_applicable` results for event types without a defensible baseline.

### ACC-303 — Pair all baselines with production forecasts

Status: `WAITING`

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

Status: `WAITING`

Dependencies: ACC-303

Extend `src/services/cognition/shadow-rollout.ts`:

- join by stable target and horizon, never approximate hashes;
- carry model id, algorithm version, feature-set version, and prediction time;
- require both models to be scored on the same resolved target cohort;
- exclude records produced after the outcome observation.

### ACC-402 — Promotion and rollback gate

Status: `WAITING`

Dependencies: ACC-401

Deliver:

- minimum 200 paired outcomes overall and 100 per enabled domain;
- positive Brier skill versus base rate;
- challenger log loss no worse than incumbent;
- paired bootstrap lower bound at or above the no-regression floor;
- safety replay recall and lead-time gates;
- one-click or configuration-based rollback to the previous version;
- no automatic promotion from proxy-only cohorts.

### ACC-403 — Champion/challenger status surface

Status: `WAITING`

Dependencies: ACC-402

Show:

- active champion and version;
- challengers and evidence counts;
- metric deltas with confidence intervals;
- promotion, rejection, rollback, and insufficient-evidence reasons.

### ACC-404 — First production promotion decision

Status: `WAITING`

Dependencies: ACC-402 and the data threshold

Outcome:

- promote the superforecast or another challenger only if it passes;
- otherwise record `REJECTED` or continue `MONITOR` with the exact missing
  evidence. A no-promotion result can complete this task.

Phase exit:

- the first evidence-backed promote-or-reject decision is recorded;
- rollback is tested against the installed app.

## Phase 5 — Correlation quality and statistical controls

Purpose: improve event relationship discovery without converting correlation
noise into confident forecasts.

These tasks retain their detailed designs in
`docs/PREDICTION_UPLIFT_PLAN.md`.

| ID | Status | Work | Dependencies |
|---|---|---|---|
| ACC-501 | TODO | Frozen correlation benchmark and `bench:correlation` CI gate | ACC-201 |
| ACC-502 | WAITING | Multiple-comparison correction and inhibitory edges | ACC-501 |
| ACC-503 | WAITING | Multi-hop mediation/confounder filtering | ACC-501 |
| ACC-504 | WAITING | Dispersion correction for bursty streams | ACC-501 |
| ACC-505 | WAITING | Per-regime correlation reliability | ACC-501 |
| ACC-506 | WAITING | Bounded correlation-kernel tunables and safety fixtures | ACC-502 through ACC-505 |

Safety invariant: learned inhibitory or dampening evidence may soften
confidence but must never suppress a safety-critical delivery rung.

Phase exit:

- correlation changes improve or preserve frozen precision/recall;
- false learned edges fall on confounded and bursty streams;
- tuning cannot bypass the benchmark or safety fixtures.

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

Status: `WAITING`

Dependencies: ACC-201 and ACC-402

Detect:

- calibration and base-rate drift;
- source/provider behavior drift;
- feature missingness changes;
- prediction volume and resolution coverage changes;
- version cohort loss or contamination.

### ACC-702 — Scheduled evaluation report

Status: `WAITING`

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
| Correlation engine | focused correlation tests, then `npm run bench:correlation` once ACC-501 lands |
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
