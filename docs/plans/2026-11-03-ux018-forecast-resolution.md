# UX-018 — Forecast resolution timing and evidence

## Decision

The roadmap selects UX-018 at priority A. Changes to forecast resolution are high assurance. The proposed first implementation adds a bounded record of actual resolver runs and corrects a demonstrated timestamp error in direct tornado labels. Production acceptance remains open until seven real scheduled runs and matched direct-label coverage can be observed on an approved installed build.

## Baseline

The existing ACC-008 production aggregate from November 2 reports 424 resolved forecasts among 500, with 49 direct labels, 375 proxy labels, 274 late resolutions and zero overdue pending at that instant. The older roadmap counts come from a different observation. Neither snapshot establishes a seven-run streak or why each historical label was late.

The calibration ledger uses a 15-minute scheduler in panel layout. The hourly shortage/mode bridge also writes proxy outcomes. A separate 30-minute cadence settles the algorithm evaluation ledger. Its ticks cannot establish calibration-ledger coverage. In an isolated fixture a cognition-disabled scheduler tick incremented the generic tick counter without running the resolver, and seven resumes produced zero immediate passes. In another fixture, the current warning resolver accepted the same direct tornado report from batches with future, invalid or internally inconsistent acquisition times. A timely positive report from a partial batch was correctly accepted.

## Proposed work

1. Require a direct warning observation to fall within both the forecast window and the validated source observation interval. Bound acquisition by the evaluation clock. Test future/invalid acquisition, coverage beginning after the report, and acquisition before the report. Preserve provable positives in valid partial batches and the existing coverage requirement for negative labels. Do not rewrite historical labels.
2. Record up to 16 fixed-size aggregate receipts at the actual calibration resolver entry point. Report run type, scheduled/due/completion times, readiness, outcome, eligible overdue before and after, and counts by fixed reason and provenance. Separate the hourly bridge and catch-ups from scheduled runs. Do not persist IDs, report text or raw observations. Historical late causes without evidence remain unknown.
3. When a visible, hydrated, cognition-enabled workspace has a due pass, permit one coalesced catch-up. Share the existing 15-minute spacing across startup and resume, with a single owner and no bursts. Preserve disabled and background behavior. Keep the existing clocks distinct: raw overdue, the diagnostic 15-minute grace, and the typed resolver’s 30-minute expiry. Report unsupported and evidence-blocked opportunities separately.
4. Use a deterministic replay with a frozen clock. Exercise hidden/disabled/restart/late work, exception handling, direct/proxy/manual/LLM origin separation and stale provider evidence. Compare direct counts and share in matched, mature domain/horizon/version cohorts. A simulated streak, seven empty ticks or a change in denominator cannot satisfy production acceptance.

## Ownership and release evidence

The prediction owner handles the evidence-window guard and replay. The scheduler owner handles cadence, ownership and bounded run receipts. The diagnostics owner consumes aggregates and distinguishes unknown causes. Run targeted tests, intelligence/diagnostics suites, both TypeScript checks and the repository gate. Require mutation proofs and independent review before publishing code.

This phase requires no installation or access to the operator’s raw ledger. After an approved merged build is available, collect separate aggregate evidence for seven natural scheduled runs with real eligible opportunities and zero eligible overdue after each pass. A restart, skipped run or failed pass interrupts the verification sequence. Evaluate direct-label coverage against a comparable cohort before closing UX-018. Roll back by reverting the scheduler, receipt and evidence-window changes together. Leave operator records and promotion thresholds intact.
