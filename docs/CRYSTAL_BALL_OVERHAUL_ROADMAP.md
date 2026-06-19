# Crystal Ball — Comprehensive Overhaul Roadmap

> **From "completed predictive dashboard" to frontier-grade predictive intelligence**
>
> Planning model: Opus 4.8 · Implementation: Sonnet (Claude Code subagents)

---

## ⚠️ Reconciliation with the current codebase (read this first)

This roadmap was authored against a mental model of a *smaller* app ("World
Monitor" heritage: a single Kalman filter, Valhalla offline routing, real-time
multi-target kinematic tracking, Metal shaders, SQLite+SQLCipher). **The
codebase it now lives in is a much larger, mature multi-domain intelligence
dashboard** (Tauri 2 + TypeScript + Vite + DeckGL, hundreds of pure-deterministic
service modules under `src/services/`). Before dispatching any wave, square the
plan with what is actually here:

> **Note on the latest revision.** A revised roadmap correctly reframed Wave 7's
> GPU rendering as *net-new* ("don't assume a shader layer already exists") and
> relabeled layer 8 as "Map UI (React/TS)". Good. But §2's baseline still asserts
> **Kalman tracking · Valhalla offline routing · React+TS · SQLite+SQLCipher** —
> none of which exist in this repo (no React, no SQLite/SQLCipher, no Kalman, no
> Valhalla; the UI is Vite + DeckGL/MapLibre). Treat §2's "shipped baseline" as
> describing a *different* app; trust this reconciliation block for what is
> actually present here.

### What already exists (do NOT rebuild)

The roadmap's "measurement spine" (Wave 1.5 / Wave 4) is largely **already
shipped** as pure, fixture-tested services:

| Roadmap item | Already implemented as |
| --- | --- |
| Prediction + outcome records, Brier scoring | `src/services/intelligence/forecast-calibration.ts` |
| Deterministic, no-leakage replay harness | `src/services/ops/replay-harness.ts` + `replay-fixtures-catalog.ts` |
| Backtesting | `src/services/intelligence/backtest-engine.ts`, `algorithms/historical-backtest.ts` |
| Outcome ledger / grading | `src/services/intelligence/outcome-ledger.ts`, `algorithms/outcome-grading-runner.ts` |
| Post-hoc recalibration (isotonic / Platt) | `src/services/cognition/recalibration.ts` |
| Calibration feedback loop | `src/services/intelligence/epistemic-calibration.ts`, `meta-confidence.ts` |
| Self-eval surface | `src/components/MetaConfidenceCalibrationPanel.ts`, `AlgorithmDiagnosticPanel.ts` |
| Counterfactual "what-if" replay | `src/services/intelligence/counterfactual-replay.ts`, `ops/playbook-engine.ts` |
| Alert prioritization / suppression / fatigue | `intelligence/prioritizer.ts`, `alert-deduplication.ts`, `alert-fatigue-detector.ts` |
| Source-reliability learning | `intelligence/source-credibility-tracker.ts`, `services/source-reliability.ts` |

### What was genuinely missing — and is now filled (this session)

The one proper-scoring-rules gap the roadmap named that the codebase did **not**
have was **CRPS** (continuous scoring) and the calibration-diagram math
(reliability bins, ECE/MCE) as a reusable layer. Added:

- **`src/services/intelligence/proper-scoring.ts`** — the record-agnostic
  *math layer* under `forecast-calibration.ts`:
  - `brierScore` + `brierDecomposition` (Murphy reliability / resolution /
    uncertainty);
  - `reliabilityBins`, `calibrationError` (ECE + MCE);
  - `crpsGaussian` (closed form) + `crpsEnsemble` (empirical) + `meanCrpsGaussian`
    for continuous / multimodal forecasts;
  - ledger adapters (`binaryForecastsFromRecords`, `calibrationErrorFromRecords`,
    `reliabilityBinsFromRecords`) so the existing prediction ledger gains
    calibration diagnostics for free.
  - 25 unit tests in `__tests__/proper-scoring.test.mts`, wired into
    `npm run test:intelligence`. Pure deterministic — no DOM, no fetch.

### Decisions recorded (per §7)

- **§7.1 Tracking altitude → DEFERRED / N/A.** This app has no radar-style
  real-time kinematic target tracker, so Wave 2's IMM / GNN / JPDA / GLMB math
  does **not** map onto the current architecture. Tracking is recorded as
  **out of scope**; the measurement spine focuses on forecast / alert
  calibration instead. Revisit only if a kinematic tracking subsystem is ever
  introduced.
- **§7.2 Learned vs. model-based → physics / Bayesian first** (unchanged
  recommendation): let the spine accumulate and validate data before any learned
  predictor.
- **§7.3 Altitude → 🟢 Core is the committed scope**; 🟡/🔴 are backlog.
- **§7.4 Model pick → deferred to the start of Wave 6.**

### Net effect on the wave plan

- **Wave 1.5 (thin spine):** effectively complete; the CRPS/calibration-math gap
  is now closed. Remaining work is *wiring* (feed existing forecasters' outputs
  into the ledger), not new infrastructure.
- **Wave 2 (estimation core / IMM+JPDA):** **out of scope** for this app — see
  §7.1 above and the full deferred spec in
  [`CRYSTAL_BALL_WAVE_2_ESTIMATION_CORE.md`](CRYSTAL_BALL_WAVE_2_ESTIMATION_CORE.md),
  which documents the missing prerequisites (no Rust tracker, no `nalgebra`, no
  Kalman baseline, no detection feed, no track-truth data) and what would unblock
  it.
- **Wave 3 (intent-aware / multimodal prediction):** the `crpsEnsemble` scorer
  now exists to grade multimodal hypothesis fans should that work proceed.
- **Wave 4 (full spine + self-eval):** reliability diagrams + ECE math now exist;
  remaining work is a presentation surface, much of which `MetaConfidenceCalibrationPanel`
  already provides.
- **Waves 5–7:** decision support, reasoning depth, and uncertainty viz remain
  largely as written, but should be scoped against the substantial existing
  alert-prioritization, hypothesis, and globe-overlay surfaces.

The original strategic roadmap follows verbatim for reference.

---

## 0. The honest reframe

If you optimize directly for *high-tech*, you converge on an impressive demo
that makes confident claims **no one can trust**, because nothing ever checks
whether the predictions were right. What separates a frontier predictive system
from a glossy one is **calibration and provenance**: when it says *70%*, is it
right ~70% of the time? Can it trace every claim to source data? Can it report
its own track record? The backbone of this overhaul is therefore a
**measurement spine** (replay → backtest → calibration → self-evaluation) that
every other upgrade is scored against.

## 1. Design principles

1. **Fully local is the identity, not a limitation** — no cloud prediction APIs,
   no remote inference.
2. **Uncertainty flows end to end** — source credibility → fusion → state
   covariance → prediction spread → alert confidence → what the LLM may assert.
3. **Physics / Bayesian first, learned second** — model-based methods need no
   training data and are interpretable; learned components only after the spine
   has validated a dataset.
4. **Every upgrade must beat the previous one on the scoreboard.**
5. **Alert quality over alert quantity** — prioritization and suppression are
   features, not polish.

## 2. Baseline

Shipped foundation plus an in-flight intelligence layer (Wave 0 contracts done;
Wave 1 fusion / pattern-of-life / kinematic prediction / agentic LLM ready).
Wave 1's definition of done gains a confidence-persistence requirement so the
spine can score it later.

## 3. Capability layers

Ingestion & fusion · state estimation · pattern-of-life · prediction · reasoning
(LLM) · decision support · **measurement spine** · visualization · systems.
Garbage at a lower layer poisons everything above it — hence the sequence.

## 4. Wave-by-wave roadmap

- **Wave 1 — Intelligence foundation** *(endorse as-is)*: land the four
  scaffolded contracts; persist confidence with each estimate.
- **Wave 1.5 — Measurement spine (THIN)** 🟢: deterministic no-leakage replay;
  proper scoring (Brier for binary, CRPS for continuous); predictions + outcomes
  storage. *The most important insert in the plan.*
- **Wave 2 — Estimation core** 🟢: IMM filter, data association + track lifecycle
  (GNN→JPDA), UKF where nonlinear; skip GLMB. *(Recorded out of scope for this
  codebase — see reconciliation above.)*
- **Wave 3 — Prediction: kinematic → intent-aware + multimodal** 🟢/🟡:
  multimodal hypotheses, goal/intent conditioning, calibrated time-to-event;
  interaction-aware deferred.
- **Wave 4 — Measurement spine (FULL) + self-eval surface** 🟡: reliability
  diagrams + ECE, recalibration, rolling self-eval dashboard, source-reliability
  learning.
- **Wave 5 — Decision support & alert intelligence** 🟡: prioritization,
  suppression/dedup, COA / what-if simulation, confidence + provenance per alert.
- **Wave 6 — Reasoning depth** 🟡: LLM reasons *over* probabilistic state;
  uncertainty-faithful language; self-critique pass; model pick deferred to here.
- **Wave 7 — Visualization & UX frontier** 🟡/🔴: honest uncertainty viz,
  temporal scrubbing/playback, GPU probabilistic rendering.

Cross-cutting: keep estimation/prediction in the hot path, GPU compute where
embarrassingly parallel, DB tuning, explicit per-layer latency budgets.

## 5. Tiering summary

- 🟢 **Core:** thin spine, (Wave 2 — N/A here), Wave 3 multimodal + goal
  conditioning, self-eval surface.
- 🟡 **High-value:** full spine, decision support, reasoning, JPDA/UKF,
  source-reliability learning.
- 🔴 **Ambitious:** GLMB, interaction-aware prediction, learned behavioral
  models at scale, GPU probabilistic rendering.

## 6. Anti-patterns to avoid

Overconfidence theater · premature research-grade tracking · learned models with
no data · scope creep across waves · alert maximalism.

## 7. Decisions — recorded

See the reconciliation block at the top of this document for the locked answers.

## 8. Immediate next actions

1. Finish Wave 1 with the confidence-persistence requirement.
2. ✅ Spine scoring math (proper scoring rules incl. CRPS + calibration
   diagnostics) — landed as `intelligence/proper-scoring.ts`.
3. Wire existing forecasters' outputs into `forecast-calibration` so the spine
   has live data to score.
4. Each subsequent wave: Opus plans → Sonnet dispatches → spine scores → proceed.
