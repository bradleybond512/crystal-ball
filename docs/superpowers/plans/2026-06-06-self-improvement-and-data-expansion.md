# Gameplan: Self-Improvement Loop + Data Expansion

> **Cross-session plan.** Any session picks this up by reading the "Current State / Next Step" block below first, then continuing the unchecked steps in order. Update the block + check boxes as you go.

---

## CURRENT STATE / NEXT STEP  *(update this every session)*

- **Status:** Workstream B — **B1 + B1b done.** Loop links 1 (record evals) and 2 (grade into fixtures) are live. Next is **B2** (run the tuner).
- **B1 (done):** 15/21 algos record into the evaluation ledger on every live run (#999, #1001). 6 orphaned (no live call site): baseline-deviation, evidence-graph, forecast-calibration, situation-clustering, watchlist-relevance, what-changed-digest.
- **B1b (done):** `outcome-grading-runner.ts` grades pending records (>48h old) via the LLM grader + local-first `llm-adapter`, writes outcomes back, on an hourly cadence wired at bootstrap (#1003). Skips on LLM-unavailable; re-entrancy guarded; 4 tests in `test:algorithms`.
- **Next step — B2:** wire `self-improvement-scheduler` into bootstrap. Its `tick(now)` is pure and returns DUE `ImprovementTask[]` (daily-audit/weekly-backtest/monthly-review) — it does NOT execute. So B2 = (1) tick on a cadence, (2) execute returned tasks: run `drift-detector` + `adaptive-tuner` against the now-graded ledger, gate proposals through `safe-adjustment` + `policy-gate`, and AUTO-APPLY safe ones (decision locked) with before/after logging + revert path.
- **Then B3:** `npm run tune` CLI + surface applied adjustments in the wired AlgorithmDiagnosticPanel.
- **Blocked on:** nothing. Tuner now has graded fixtures flowing (once records age past 48h in a keyed/LLM-available session).
---

## Why this exists

Crystal Ball already contains a complete, well-tested **closed-loop algorithm self-improvement system** under `src/services/algorithms/` — but it is **100% unwired** (the orphaned-panels pattern). The loop is broken at the first link: nothing calls `record-evaluation`, so the evaluation ledger never fills, so `adaptive-tuner` (a TPE hyperparameter optimizer) never has data to optimize against, so `self-improvement-scheduler` never fires. This gameplan operationalizes that loop, adds a recurring health-check tool, and raises the data ceiling the whole system runs under.

## Design decision (locked)

**Tuner autonomy: AUTO-APPLY SAFE + LOG EVERYTHING.**
The tuner auto-applies any parameter adjustment that clears all safety gates, and records every change with rollback metadata. Gates (already implemented in `adaptive-tuner.ts` / `safe-adjustment.ts`):

- ≥5% F1 improvement on the last 100 graded fixtures before accepting a config
- ≤20% change to any single parameter per cycle
- minimum new-grade count before acting
- `policy-gate` veto + per-param bounds (`at_bound` → no-op)
- every applied change logged with before/after + a revert path

---

## Workstream B — Operationalize the tuning loop  *(foundation, build first)*

**Goal:** a self-improving loop that runs in production: grade outcomes → fill ledger → detect drift → tune params → auto-apply safe changes → log.

- [x] **B1 — Fill the ledger.** DONE: 15/21 registered algos record into the ledger (guarded). 6 are orphaned (no live call site) — see Current State.
  - Call sites: `src/services/analyst-loop.ts`, `src/services/hypothesis-accuracy.ts`, `src/services/alert-correlator.ts`, `src/services/severity-recalibration.ts`
  - Recorders: `src/services/algorithms/record-evaluation.ts` (`recordAlgorithmEvaluation`, `recordAlgorithmOutcome`, `timeAndRecord`)
  - Persistence: `algorithm-ledger-persistence.ts` (verify it flushes to IDB so the ledger survives restarts)
  - Done when: after a keyed session, `getAlgorithmEvaluationLedger()` returns non-empty entries for ≥3 tracked algorithms.
- [ ] **B2 — Run the scheduler.** Wire `self-improvement-scheduler` into the app bootstrap (`panel-layout.ts` boot or a dedicated init) on its cadences (DAILY_AUDIT_MS / WEEKLY_BACKTEST_MS / MONTHLY_REVIEW_MS). Each cycle runs `drift-detector` → `adaptive-tuner` → `safe-adjustment` → apply (auto), gated by `policy-gate`.
  - Done when: a forced cycle (test hook) produces a proposal, applies it through the gates, and logs the before/after.
- [ ] **B3 — Drive + observe.** Add `npm run tune` (CLI that runs one cycle against the persisted ledger and prints proposals/applies) and surface applied adjustments + drift in the already-wired `AlgorithmDiagnosticPanel`.
  - Done when: `npm run tune` runs end-to-end and the panel shows the last applied adjustment.

**Risk note:** B1 is additive wiring of tested pure functions (low risk). B2 changes runtime behavior (auto-apply) — keep it behind a default-on-but-revertible flag and verify the gates fire before trusting it.

---

## Workstream A — Recurring checkups  *(fast, ship early)*

**Goal:** "run tests like this more often" as one command.

- [ ] **A1 — `npm run checkup`.** A script that runs: typecheck:all, core test suites, log audit (latest desktop.log session + sidecar health), analyst-state freshness probe → prints a GREEN / YELLOW / RED report with the actionable items only.
  - Reuse: `src/services/diagnostics/self-test.ts`, the npm `test:*` scripts, the bash log-audit patterns from this session.
  - Done when: `npm run checkup` exits 0/1 with a one-screen summary.
- [ ] **A2 — Optional schedule.** A `/checkup` skill or cron entry for a daily run.

---

## Workstream C — Data gathering / insight  *(raises the ceiling)*

**Goal:** the algos are input-bound; raise feed coverage and resilience so they have more to reason about, even with few/no keys.

- [ ] **C1 — Coverage audit.** Map live feeds in `data-loader.ts` against `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md`; list highest-value free/no-key sources not yet wired.
- [ ] **C2 — Provider redundancy.** For each critical domain, wire a backup source so one key/outage doesn't starve the domain (extend the existing `provider-redundancy.ts` health model).
- [ ] **C3 — Keyless resilience.** Ensure no-key feeds (USGS, NWS, GDACS, EONET, etc.) reliably produce signal so the app reasons even at 0 keys loaded — directly addresses the recurring "0 keys → starved algos" condition.

---

## Success criteria (whole gameplan)

1. After a normal keyed session, the evaluation ledger is non-empty and the scheduler has run ≥1 cycle.
2. At least one safe parameter adjustment has been auto-applied and logged with a revert path.
3. `npm run checkup` gives a one-command health verdict.
4. Measurable increase in active feed coverage and per-domain redundancy.
5. No regressions: typecheck 0, all test suites green, no new `[ERROR]` classes in logs.

## Progress log

- 2026-06-06 — Gameplan created and committed. Discovered the tuning loop is fully built but unwired; locked auto-apply-safe autonomy.
- 2026-06-06 — B1 pattern landed: big-event-detector instrumented (data-loader.ts:1468 → evaluation ledger), guarded, typecheck 0. Discovered the outcome path (resolvePendingViaLlm + llm-grader) exists but is unwired — folded into B1b. Remaining B1 work is mechanical replication across 20 more registered algos.
- 2026-06-06 — B1 done: 15/21 algos instrumented into the evaluation ledger (Sonnet sub-agent did the bulk; Codex review caught + we fixed a source-feedback double-count and two durationMs:0 timers). Found 6 registered algos with no live call site. Next: B1b (wire outcome-resolver/llm-grader onto a cadence).
- 2026-06-06 — B1b done (#1003): outcome-grading-runner wires the LLM grader to the ledger on a cadence. Codex review caught two real issues (generateText returns {provider:none} not a throw → would falsely mark records inconclusive on LLM outage; missing re-entrancy guard) — both fixed. Next: B2 (execute scheduler tick → drift-detector + adaptive-tuner → auto-apply safe).
