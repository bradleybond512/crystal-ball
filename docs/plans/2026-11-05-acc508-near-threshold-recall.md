# ACC-508 — Detect lost near-threshold causal couplings

The roadmap selects priority-A ACC-508 after ACC-505 is claimed. Dependencies ACC-503 and ACC-504 are complete. Bradley approved this high-assurance design, the documentation-only draft claim and local implementation on 2026-11-05. Bradley subsequently authorized code publication, reconciliation and merging. Installation, release and deployment remain paused.

## Goal and measured evidence

Make the frozen benchmark fail when the miner silently drops a planted causal relationship close to its actual admission boundary. Preserve production thresholds and the existing false-positive protections. This is test coverage, not a production accuracy claim.

Read-only repository discovery and architecture review traced the full fixture → miner → learned rule → engine → baseline path. The current benchmark passes with ten streams, 469 observations, five recovered causal couplings and 272 eligible ordered pairs. The focused benchmark/miner suites returned 264 pass / 0 fail.

A scratch probe adds six antecedents at days 2.1, 7.1, 12.1, 17.1, 22.1 and 27.1; the first four receive a consequent 30 minutes later. It also adds 25 background consequents at `.63 + i*29/26` days for i=1 through 25. The full corpus recovers all six causal relationships, with zero false promoting edges, 504 observations and a family of 342. The new edge has adjusted p-value 0.04514048363946339 against alpha 0.05, posterior 0.8160202886303283 against floor 0.8, and utility 0.08010144315164136 against zero. Adding one independent domain increases the family to 380 and adjusted p to 0.05041844788038526, losing the edge.

## Proposed change

1. Add this fixed S11 stream and explicit causal direction to planted truth. Preserve all ten original streams and truth entries. Do not automatically retune events when family size changes.
2. Retain the actual boundary candidate in the benchmark report, including rejected candidates: identity, support, antecedents, lift, z-score, adjusted p, family alpha/size, posterior, utility, admission and learned-rule recovery. An absent candidate is missing evidence, never a successful measurement.
3. Record Holm adjusted p-value as binding under the measured background-count and family-size perturbations. Also show posterior and utility slack. Do not use the inhibition threshold or an arbitrary z-score ratio as the promotion margin.
4. Require actual admission/recovery and realized alpha utilization `adjustedPValue / family.alpha` within **0.85–0.99**, equivalently normalized Holm slack 0.01–0.15. The measured utilization is 0.90280967. The neighboring easier fixture gives about 0.790922 and the harder fixture about 1.02879. This engineering coverage band is grounded in those brackets; it is not a confidence interval. Recompute it each run and fail on drift in either direction.
5. Move the report/baseline from schema 13 to 14 through an explicit migration. Pin the reviewed previous payload/report/tolerances, all old stream digests, the exact S11/truth addition, and candidate output. Allow only enumerated additive measurement changes. The weak sixth coupling adds four learned pairs and changes the aggregate minimum per causal rule from six to four; prove old-rule evidence remains intact. Preserve existing tolerances and false-positive gates. Existing smoke CI already validates reseeding against the base branch; no workflow change is proposed.

## Acceptance, failures and validation

Missing, nonfinite, duplicate, wrong-direction, unplanted, rejected or absent boundary evidence must fail. Cross-check report summaries against candidate evidence and independent planted truth. Reject altered old payloads, widened tolerances, old-stream edits, unapproved output changes, unknown migrations and reseeding of failing coverage.

Run the real full-corpus benchmark and preserve existing decoy, confounder, inhibitory and engine checks. Exercise the passing candidate, easier and harder neighbors, family growth, forged summaries, changed alpha and migration tampering. Mutation proofs must remove the coupling, bypass recovery/margin checks, substitute stale margins and bypass migration pins, with confirmed diffs, actual red counts and restored checksums. Run focused tests, the full correlation suite, benchmark, normal and previous-baseline reseed paths, type checks, repository gate, selected CI suites, and independent Sol/Sonnet reviews.

## Ownership, boundaries and rollback

| Task | Owner | Files | Dependency |
|---|---|---|---|
| Fixed fixture and candidate reporting | prediction engineer | golden-streams.ts, bench-correlation.ts | Approved design and published draft claim |
| Strict baseline migration and boundary gate | prediction engineer | bench-correlation-baseline.ts, baseline JSON, scripts/correlation-benchmark.mts | Fixed reviewed candidate |
| Behavioral and mutation evidence | test engineer | Focused benchmark tests and external evidence | Stable implementation |
| Integration and reviews | root and independent reviewers | Registration, roadmap and QA docs | All relevant checks |

No application mining thresholds, provider integrations, network permissions, notifications, dependencies or production data change. Measure offline benchmark runtime for the extra stream and ordered pairs. Unknown production recall impact stays explicitly unclaimed. Rollback reverts fixture, schema/comparator/CLI and baseline together; a baseline-only rollback must fail identity validation.
