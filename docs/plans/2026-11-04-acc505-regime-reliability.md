# ACC-505 — Correlation reliability across calm and shifting regimes

The roadmap selects ACC-505 at priority A. Bradley approved this design, the documentation-only draft claim and local implementation on 2026-11-05. Code publication requires separate approval. Installation, auto-merge and delivery remain paused.

## Evidence and decision

On main `cd459dfec`, a synthetic rule with six calm hits and six shifting-regime misses returned the same 0.680 multiplier for both situations. The existing scorer gave a Brier score of 0.010 for the calm cohort and 0.810 for the shifting cohort, corresponding to multipliers of 1.480 and 0.500. The correlation benchmark exited successfully and the 39 focused baseline checks passed. This shows a difference hidden by pooling; it does not establish that a regime-specific multiplier improves future predictions.

Use one system-wide classification because the existing provider receives a rule ID and some rules span domains. A validated, fresh BOCPD shift in finance, security, disaster or cyber qualifies as shifting even if another domain lacks observations. Calm requires a fresh successful scan with all four monitored domains warm, valid chronological samples, and no active qualifying shift. A disabled detector, stale/failed scan, future evidence or insufficient coverage cannot prove calm. For this policy, require at least ten valid pressure samples in each domain for a calm classification, a completed scan at or before the decision, and a last complete observation within four minutes (two normal sampling intervals). Use the existing six-hour horizon for a shift. Missing pressure values and timestamps must be identified before any fallback substitutes zero or the current time. Calm means no detected shift in qualified pressure telemetry; it supplies no assurance about unobserved upstream conditions. Keep the separate coupling boost intact.

## Local implementation

* Save an optional, allowlisted outcome-regime tag once, when a pending correlation result actually resolves, in the same bounded 400-record ledger write. Cover both pair resolution and directional island feedback. Retain older records in the overall score, leave missing or malformed regime tags unknown, and never infer historical tags from the current detector state.
* Score resolved rows by rule overall and separately for each regime. Select the current regime’s multiplier at **five resolved outcomes in that bucket**. Below five, or when the current regime is unknown, use the existing overall multiplier; below five overall, use 1.0. Preserve the existing rounding and bounds of 0.5–1.5. The present scorer uses a minimum sample threshold and clamping. This proposal adds no new fitted smoothing parameter.
* Cache score aggregates but evaluate current regime eligibility at lookup, including clock changes. Preserve directional keys and the existing island feedback behavior. Expose aggregate cohort counts, Brier and selection reason for audit without storing extra signal payloads.
* Exercise thresholds at four and five, cold/disabled/incomplete detector data, future timestamps, both outcome writers, persistence and restart, stale caches, sparse and legacy cohorts and direction changes. Run a chronological replay using only evidence and settled labels available at each decision time. Compare with the existing pooled path on the same examples, run the correlation benchmark and repository gate, and attach mutation proofs and independent reviews.

Roll back by reverting the tag writer and selection policy. Older readers ignore the optional field and continue to use pooled outcomes. Existing production data cannot recover historical regime tags reliably. Any production uplift claim requires prospective tagged holdout evidence after an approved delivery.

## Scope and acceptance

High assurance: this changes correlation scoring and persisted outcome metadata on web and desktop. The goal is to distinguish reliability under qualified calm versus shifting evidence without treating missing telemetry as calm. Acceptance requires the exact five-outcome threshold, unchanged pooled fallback and bounds, immutable outcome-time tags through both writers, bounded aggregates, chronological replay, mutation evidence, type checks and independent reviews. Production uplift remains unknown until prospective labeled holdout evidence exists. No dependencies, UI changes, detector tuning, promotion, notification changes or production-data access are in scope.

## Bounded implementation tasks

Prior read-only discovery by `repository_analyst` and design by `architect` established the writer paths and missing-data ambiguity before approval.

| Task | Owner | Scope | Dependency | Validation |
|---|---|---|---|---|
| Qualified current regime | prediction_engineer | pressure-history.ts, cognition/regime-monitor.ts and regime-scan.ts, focused tests; a narrow classifier module if needed | Published draft claim | Warm/cold, missing/invalid/chronological samples, scan freshness, disabled, stale and future evidence |
| Outcome tags and selection | prediction_engineer | correlation/correlation-calibration.ts, shared prediction store/types only if necessary, focused tests | Classifier | Both writers; threshold 4/5; unknown and legacy fallback; restart/cache/directional behavior |
| Replay and mutation proof | test_engineer | Focused tests and external proof artifacts; no production edits | Stable implementation commit | Time-ordered comparison with pooled path, confirmed mutations and restored checksums |
| Integration and sign-off | root, independent_reviewer, Sonnet | Script registration, tracker, QA report and full diff | Focused tests and proofs | Correlation benchmark, agentic gate, selected CI suites, two independent reviews |

Each owner must preserve other changes and stay within these boundaries. Additive test registration is owned by root. Implementation uses behavior tests first. There is no new external provider, so no live-provider probe is needed.
