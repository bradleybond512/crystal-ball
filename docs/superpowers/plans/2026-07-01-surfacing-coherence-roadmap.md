# Crystal Ball — Surfacing & Coherence Roadmap

**Date:** 2026-07-01 · **Status:** APPROVED direction (owner chose "do the surfacing cycle, Moves 1→3").
**Grounding:** 5-lens code+plan audit (unsurfaced-depth, active-plans-reality, quality/tech-debt, UX-coherence, new-capabilities). All 5 lenses returned "thesis HOLDS".

## The thesis

The app's problem is **not** missing capability — it's that its deepest capabilities are invisible. The plan-driven engine machinery reliably ships tested, deterministic service code and marks it "done"; the *wire-it-to-a-surface* step is the first casualty whenever a plan defers all UI to a final PR that never lands.

Evidence:

- `src/services/cognition/` (~7,555 LOC / 20 modules) has **zero imports from any component**. `superforecast()`, `evoi-planner`, `consolidation`, `forecast-journal`, `regime-detection`, `shadow-rollout` are built + fully tested + called by nobody. `COGNITIVE_ENHANCEMENT_PLAN.md` PR-6 ("UI wiring") is the single unchecked box behind 14 done engine PRs.
- `AnalystHUD.ts:843` renders a bare `probability %` and discards `forecast.components` (episodic analogs + recalibration provenance computed at `hypothesis-forecast.ts:88`).
- `WelcomeFlow.ts` (finished location+interests onboarding) is **never instantiated** → new users hit a 476-panel firehose (261 shown by default) and `operator-model` (which every ranking surface consults) boots cold + unseeded.
- `ask-the-data` bypassed by a raw-LLM Ask panel; `buildSharePacket`/`voice-alerter` have zero callers; 3 parallel "What Changed" implementations; `ELITE_REMAINING_GAPS.md` is stale and causes rebuild of merged work.

Counter-evidence (keeps it honest): the redundancy/fusion program reached the surface end-to-end; cognition PRs 1/2/4/5 are live in the analyst-loop→forecast path; Command Center's 5-question spine is a genuine hero flow. So the gap is specifically in the **newest, deepest algorithmic layers**.

**Strategic bet: the next cycle is a *surfacing & coherence* cycle, not a capability cycle.** Hard rule to stop regression: *no new engine merges without a read-surface in the same stack.*

## Workstreams (by leverage)

- **WS-1 Surface cognition/insights depth** — AnalystHUD forecast provenance + BeliefCalibrationPanel payload + boot the dormant learning loops (`scheduleConsolidation`/`logForecast`/`regime-shift`/`registerLearnedCascadePairs`). Low-med effort; unlocks ~8 modules + 150 tests.
- **WS-2 Product coherence** — mount `WelcomeFlow` + seed `operator-model`; two-tier IA (<15 default panels); one shared posture model across the 3 heroes (Command Center / God's Vision / AnalystHUD).
- **WS-3 Finish the worthwhile plan threads** — redundancy Workstream B (fuse more of the 47 providers; only 4 domains fused today; verify vs live sidecar); Survival OS **E2 only**. Shelve the rest.
- **WS-4 Risk/debt paydown (cheap now)** — `knip` advisory CI + "services need an importer" guard; delete ~9 orphan modules + 2 of 3 duplicate What-Changed impls. Defer sidecar/god-object refactors.
- **WS-5 One new capability** — wire the ready-made `voice-alerter` (~30 LOC, shovel-ready). Spike (don't commit) a zero-shot TS forecaster (Chronos/TimesFM) over pressure-history.

## Sequenced moves

1. **Onboarding → interest-seeded ranking** *(first — highest leverage/effort ratio)*: mount `WelcomeFlow` on first run + wire `onInterestsSet → operator-model`. Fixes the first impression + activates personalization every ranking surface depends on.
2. **Cognition PR-6 read-surfaces + boot-loops**: AnalystHUD renders `forecast.components`; `BeliefCalibrationPanel` renders reliability curve + conformal coverage + operator-vs-system Brier; start the dormant loops + the `registerLearnedCascadePairs()` one-liner.
3. **Fusion breadth + cheap debt cuts**: fuse weather-alerts/disease/sanctions/CVE via existing providers; add `knip` CI; delete orphans + 2 dead What-Changed copies; wire `voice-alerter`.

## Explicitly de-prioritize

No more raw feeds; no new panels; no new cognition/intelligence engines (enforce "engine merges with a surface"); stop working from the stale `ELITE_REMAINING_GAPS.md` (mark superseded); shelve Cognition PR14/16 + Survival E4–E7 (**PR12 is blocked on PR6** — it grades `superforecast()` output that never runs); defer the sidecar route-table + god-object refactors; spike—don't build—the TS foundation model.
