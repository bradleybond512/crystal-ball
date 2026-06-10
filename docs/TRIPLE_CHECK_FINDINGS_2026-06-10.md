# Triple-Check Findings — Prediction Accuracy, Code Quality, UI (2026-06-10)

Companion to `WORLD_CLASS_UPGRADE_PLAN_FOR_SONNET.md`. That plan covered *wiring
dark matter, consolidating panels, and expanding sources*. This pass goes deeper on
the three questions: **what else to enhance, how to predict more accurately, and what
UI/code to improve.** Findings below were source-verified; where a sub-audit was
wrong, the correction is noted inline.

---

## Part 1 — Make Crystal Ball predict better (highest-value section)

### What's actually true about the forecasting stack

The prediction tier is more sophisticated than it looks — and one closed loop that an
earlier audit reported as "missing" is in fact **fully wired**:

- **Hypothesis accuracy loop IS closed.** `src/services/hypothesis-accuracy.ts` grades
  pending hypotheses against outcomes (`gradeOne`), tracks hits/misses per
  signature+kind, and `getHypothesisAccuracyMult()` returns a real [0.7, 1.3]
  multiplier that `analyst-loop.ts:114` applies to ranking. `hypothesis-feedback.ts`
  adds a thumbs-up/down multiplier the same way. **Do not "fix" these — they work.**
- **Bayesian hypothesis scoring is correct** (posterior + Beta credible interval).
- **Baseline/anomaly is solid-but-naive**: z-score rolling windows (`baseline-deviation.ts`)
  + EWMA with hour-of-week seasonality via Welford's online variance
  (`pressure-baselines.ts`, `ema-forecast.ts`). Real statistics, no time-series model.
- **Compound/cascade risk** (`compound-risk.ts`): union-find clustering + a **17-entry
  hand-tuned `CASCADE_PAIRS` table** and heuristic breadth/corroboration multipliers.
  Detects co-occurrence; does not learn cascade probabilities.

### The actual gap (source-verified, corrected from the sub-audit)

**The forecast-calibration feedback wire is cut at the source.**
`forecast-calibration.ts` implements Brier scoring, per-domain calibration error, and
`perSourceMultipliers()` correctly. But:

1. **Nothing records predictions into the calibration store.** `getCalibrationStore()`
   is referenced only inside `forecast-calibration-adapter.ts` itself — no `src/app/`
   or service code calls `.record(...)` to log a forecast, and nothing resolves them.
   So `getBoostMultiplier()` always hits `resolved.length < 5` and returns `1`. The
   boost that `hypothesis-forecast.ts:36` applies is **permanently inert.**
2. **`perSourceMultipliers()` has zero consumers** — built, exposed via `bySource()`,
   never read at prediction time.
3. **No recalibration** — only a TODO mention of isotonic regression in
   `quality-debt-tracker.ts:208`. Brier is *measured*, never *corrected*.

### Ranked prediction enhancements (small → large)

**P1. Close the forecast-calibration loop (small, do first).**
The machinery exists; it's unplugged. Add a `recordForecast()` call where forecasts
are emitted (hypothesis-forecast, ema-forecast, shortage tiers) and a daily
`resolvePredictions()` pass that matches each forecast to ground truth from the
situation/alert stores (reuse the resolution pattern already in
`hypothesis-accuracy.ts:gradeOne` and `situation-store.markResolved`). Once predictions
flow in, `getBoostMultiplier()` and `perSourceMultipliers()` come alive with no further
change. *Files:* `forecast-calibration-adapter.ts`, `hypothesis-forecast.ts`,
`ema-forecast.ts`, `data-loader.ts` (schedule the daily resolve). *Acceptance:* ≥50% of
24h forecasts resolved within 2 days; boost multiplier observed ≠ 1 on a seeded fixture.

**P2. Wire per-source reliability into forecasts (small).**
Consume `perSourceMultipliers()` at prediction time so chronically-wrong sources get
down-weighted and reliable ones up-weighted. *Files:* `hypothesis-forecast.ts`,
`ema-forecast.ts`. *Acceptance:* high-Brier source downweighted in a fixture test.

**P3. Add isotonic (PAV) recalibration (medium).**
Replace the 4-step `getBoostMultiplier()` cliff with a monotone calibration curve fit
by Pool-Adjacent-Violators over resolved predictions, applied to every output
probability. *File:* `forecast-calibration.ts`. *Acceptance:* post-calibration ECE
< 0.05 on holdout fixtures. (This is the single biggest accuracy lever once P1 feeds it
data.)

**P4. Emit prediction intervals, not point estimates (medium).**
Every forecast already has the ingredients for a Beta-Binomial posterior. Output
`{ p, loCI, hiCI, n }` and surface the CI in the UI (ties into UI-U3 below). Turns
"73%" into "73% (61–83%, n=18)" — a major trust upgrade. *Files:* forecast output
types + the renderers.

**P5. Brier-weighted ensemble (medium-large).**
Run EWMA + a simple Holt-Winters/ARIMA(1,0,1) in parallel, weight by `exp(-brier)` per
model. Even a 2-model ensemble reliably beats either alone. *New file:*
`intelligence/ensemble-forecast.ts`. *Acceptance:* ensemble Brier ≤ best single model on
holdout.

**P6. Learn cascade pairs from data (large).**
Replace the hand-tuned `CASCADE_PAIRS` with empirical `P(domain_B within 24h | domain_A)`
from observed compound situations (Laplace-smoothed). *File:* `compound-risk.ts`.
*Acceptance:* ≥80% of predicted cascades occur within 72h on backtest.

**P7. Make the backtest gate mandatory + add drift detection (medium).**
`backtest-gate.ts`/`backtest-engine.ts` exist but aren't required for every tuning
change. Gate all `safe-adjustment`/`adaptive-tuner` applies behind a ≥95%-scenario-pass
backtest, and add CUSUM drift detection in `algorithm-health.ts` so a mid-session
accuracy drop pages before the weekly batch. *Acceptance:* zero unintended regressions
across the next 3 tuning applies; drift caught < 1h in a synthetic degradation test.

> Sequencing note: P1 unlocks P2–P5 (they all need resolved predictions). Do P1 first;
> it's a few hundred lines and turns the existing-but-dormant calibration system on.

---

## Part 2 — Code quality (verified counts)

The repo is healthy at the service tier (≈809 test files) but carries structural debt:

**C1. Listener-leak hardening (high impact, in progress).** The base `Panel`
(`Panel.ts`, ~1398 lines) and `DeckGLMap.ts` (~6400 lines) add many more
`addEventListener`s than they remove on `destroy()`. Recent commits already fixed 27
panels; finish the sweep and **add an ESLint rule** that flags an `addEventListener`
without a matching teardown so it can't regress. Add an `isDestroyed` guard + RAF/timer
cancellation ordering in the base class so late callbacks can't touch a torn-down panel.

**C2. Break up the two god files.** `panel-layout.ts` (~2786 lines, ~240 imports) mixes
panel instantiation, drag/resize, mode switching, and time-range filtering. Extract
`PanelRegistry` (factory + lazy load), `PanelDragOrchestrator`, and `ModeSelector`. This
pairs naturally with the `HubPanel` work in the main plan (Workstream B) — do them
together. Extract reusable `Panel` mixins (listener lifecycle, interval manager,
localStorage guard) to cut per-panel boilerplate.

**C3. Type-safety debt.** ~1400 `any`/`as any`/`@ts-ignore` across ~250 files despite
`strict: true`. Hotspot: `config/tech-geo.ts`. Add a CI ratchet (no *new* `any`) and
introduce zod schemas at the fetch/parse boundary in `data-loader.ts` — this also
hardens against malformed feed data (overlaps security workstream).

**C4. Unified fetch resilience.** ~50 ad-hoc fetch sites with inconsistent error
handling and ~108 silent `catch {}` blocks. Introduce one `fetchWithFallback(url, {retry,
cache, onError})` + a sidecar health probe feeding the diagnostics panel. Convert silent
catches to either a commented intentional-silence or an operator-visible event.

**C5. UI test coverage.** ~0 tests for ~650 panel components. Add a `PanelTestHarness`
that mounts a panel and asserts `destroy()` removes every listener — this directly
protects C1 and the hub refactor.

---

## Part 3 — UI / UX (verified against components)

**U1. Universal Inspector Drawer (biggest trust win).** `EvidenceDrawer.ts` is ~80–130
lines of flat list. Build one canonical drill-down drawer — Summary · Evidence timeline
(with freshness) · **Confidence breakdown** · Contradictions · Missing-data · Actions —
and make *every* score/claim open it. This is how the "every score is explainable"
invariant becomes visible instead of just true in code.

**U2. Command Center as real mission-control.** `CommandCenterPanel.ts` (~900 lines)
currently lists rather than synthesizes, and ranks by feature-health rather than
personal importance. Reorder to answer-first, group interacting signals into one
narrative ("Taiwan Strait + ADIZ + logistics stress = escalation vector"), and bold the
personal intersection (active situation overlapping a saved place). Pairs with the
Personal Impact strip already in the main plan (A7).

**U3. App-level confidence + calibration meter.** Nowhere does the UI show "how much
should I trust the system right now?" Add a compact meter (system confidence + per-domain
freshness) in the Command Center header, and — once Part 1/P3 lands — show calibration
honesty ("60%-confidence calls actually happen 64% of the time"). Directly consumes P4's
intervals.

**U4. One charting primitive.** Charting is ad hoc (`AlertTimeline.ts`,
`EntityHeatRail.ts` each invent their own). Build a single `TimeseriesChart` + sparkline
(canvas, reduced-motion aware) and reuse it for confidence drift, entity velocity, source
freshness, pressure history.

**U5. Map as synthesis, not 400 toggles.** `DeckGLMap.ts` exposes hundreds of flat layer
toggles. Group into **lenses** (Risk · Infrastructure · Confidence · Logistics · Cyber),
add a geo-convergence callout when ≥3 domains cluster spatially, and badge saved places by
coverage (well-covered / degraded / blind spot — a "where are we blind?" map).

**U6. Graceful mobile + discoverability.** Mobile currently warns users away rather than
degrading gracefully; the ~466-panel sidebar is undiscoverable beyond ⌘K. The hub IA
(Workstream B) plus sidebar search/favorites fixes discoverability; add contextual panel
suggestions ("chip shortage detected → open Semiconductor Supply Chain, Taiwan Strait").

---

## Suggested incremental sequence (layered onto the main 18-PR plan)

| # | PR | Why now |
|---|----|---------|
| P1 | Close forecast-calibration loop (record + resolve) | Tiny change, switches on a dormant system; unblocks all other accuracy work |
| P2 | Consume per-source multipliers | One-line-ish wins riding on P1 |
| C1 | Listener-leak ESLint rule + base-class `isDestroyed` guard | Stops the biggest perf/correctness regression class |
| U1 | Universal Inspector Drawer | Makes explainability visible; reused by every panel/hub |
| P3 | Isotonic recalibration | Biggest single accuracy lever once data flows |
| U3 | Confidence + calibration meter | Surfaces P3/P4 to the user |
| C2 | God-file split (with Workstream B hubs) | Do alongside hub consolidation, not twice |
| P5/P6 | Ensemble + learned cascades | Larger, after the loop is proven |

Everything here respects the existing guardrails (typecheck zero, secret scan, keychain
prohibition, branch discipline) and is fixture-testable with no live fetch.
