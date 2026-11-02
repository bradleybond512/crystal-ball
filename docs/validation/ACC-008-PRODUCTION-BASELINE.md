# ACC-008 production baseline — 2026-11-02 UTC

Status: implementation validated locally; draft PR #1843 remains in review.
High-assurance design and installed-app aggregate acquisition were explicitly
approved by Bradley on 2026-11-01. This report contains aggregates only.

## Acquisition and provenance

- Installed application release: `2.25.147` (verified in its Info.plist).
- Measurement UTC: `2026-11-02T00:07:25.253Z`.
- Manifest recorded UTC: `2026-11-02T00:07:25.263Z`.
- Collector/evaluation code revision: `590a9eeec5a1a599bcc00dff105575e8b9f628d0`.
- Installed evaluation revision: **unavailable**; the collector revision does not establish it.
- Aggregate machine-readable receipt: [ACC-008-2026-11-02.json](ACC-008-2026-11-02.json).
- Four selected stores: calibration, shadow runs and comparisons available;
  champion registry missing. Raw rows remained in memory/private pipes.

Exact acquisition command, executed using the installed Node 22 runtime from the
repository root (the SQLite path identifies this installed WebKit origin):

```bash
node --import tsx scripts/acc008-production-baseline.mts \
  '/Users/bradleybond/Library/WebKit/com.bradleybond.crystalball/WebsiteData/Default/ISQ7RBdGFrxUtNUqOJT98Exnq0s5KuKbUxEadGP7F0U/ISQ7RBdGFrxUtNUqOJT98Exnq0s5KuKbUxEadGP7F0U/LocalStorage/localstorage.sqlite3' \
  2.25.147 590a9eeec5a1a599bcc00dff105575e8b9f628d0
```

Exit: `0`. The archived receipt is the stdout from this invocation. A new run
measures the then-current retained store and can produce different counts.
No raw snapshot is retained, so historical raw records cannot be replayed.
The July baseline remains unchanged in the roadmap.

## Retained record population

500 accepted records; 424 resolved, 2 pending, 74 expired; 0 overdue pending.
Resolved origins reconcile: 49 direct + 375 proxy + 0 manual = 424.
Quality audit: 0 malformed, 0 label leakage, 0 contradictory evidence,
0 duplicate outcomes, 375 uncertain proxy labels, 274 late resolutions.
These are record counts, including multiple models of shared outcomes, not
unique training outcomes or lifetime history. Retained scores are descriptive;
the exact-pair population below applies stricter identity and timing exclusions.

| Forecaster / version | Resolved | Direct | Proxy | Manual | Retained Brier | Direct Brier | Proxy Brier |
|---|---:|---:|---:|---:|---:|---:|---:|
| analyst-loop / 2.0.0 | 26 | 0 | 26 | 0 | 0.722500 | unavailable (n=0; insufficient_evidence) | 0.722500 |
| hierarchical-base-rate / 1.0.0 | 115 | 14 | 101 | 0 | 0.488865 | unavailable (n=14; insufficient_evidence) | 0.556621 |
| mode-forecast:disaster / 1.0.0 | 43 | 0 | 43 | 0 | 0.155626 | unavailable (n=0; insufficient_evidence) | 0.155626 |
| mode-forecast:security / 1.0.0 | 36 | 0 | 36 | 0 | 0.133913 | unavailable (n=0; insufficient_evidence) | 0.133913 |
| nws-warning / 1.0.0 | 204 | 35 | 169 | 0 | 0.421373 | 0.090000 | 0.490000 |

Manual Brier is unavailable for every forecaster (zero manual labels).
Per-forecaster champion/challenger decision state is **unavailable for all five
forecasters**: the champion registry is absent, and this collector does not
project challenger lifecycle from the run store. A present shadow run store or
baseline pair does not establish an active champion, promotion, or challenger
lifecycle state. No promotion decision was recomputed or persisted.

## Exact paired baseline metrics

All accepted rows compare against hierarchical-base-rate version 1.0.0. Live
model versions are those in the table above. Pairing partitions by forecaster,
model versions, domain, horizon and label origin. The twenty-pair floor applies
to each partition; smaller rows remain unavailable and are not pooled.

| Forecaster | Domain / horizon | Origin | Pairs | Production Brier | Baseline Brier | Skill |
|---|---|---|---:|---:|---:|---:|
| analyst-loop | other / 1h-6h | proxy | 14 | unavailable (n=14; insufficient_evidence) | unavailable (n=14; insufficient_evidence) | unavailable (n=14; insufficient_evidence) |
| mode-forecast:disaster | humanitarian / 1d-7d | proxy | 43 | 0.155626 | 0.000722 | -214.663337 |
| nws-warning | weather / <1h | direct | 1 | unavailable (n=1; insufficient_evidence) | unavailable (n=1; insufficient_evidence) | unavailable (n=1; insufficient_evidence) |
| nws-warning | weather / <1h | proxy | 19 | unavailable (n=19; insufficient_evidence) | unavailable (n=19; insufficient_evidence) | unavailable (n=19; insufficient_evidence) |
| nws-warning | weather / 1h-6h | direct | 13 | unavailable (n=13; insufficient_evidence) | unavailable (n=13; insufficient_evidence) | unavailable (n=13; insufficient_evidence) |
| nws-warning | weather / 1h-6h | proxy | 25 | 0.490000 | 0.993042 | 0.506566 |

301 input comparisons = 115 accepted + 185 unmatched identities + 1 malformed
or unsupported comparison. Both sides of each row have exactly the listed
sample size. Security has no accepted pair; hierarchical-base-rate is the
comparator, so it has no self-comparison or self-skill value. Analyst-loop has
14 proxy pairs, below the floor. All direct paired cohorts are below the floor.
Skill is `1 - productionBrier / baselineBrier`, not an absolute difference.
The large negative disaster skill comes from a near-zero comparator error on
43 same-class proxy outcomes; it is not evidence of validated out-of-sample
uplift or authority for a model decision. Baseline training lineage is not
established by the retained ledger. Zero baseline error would be unavailable.

Comparisons must precede the earliest structured evidence observation and the
recorded resolution. Where no structured observation exists, including legacy
labels or empty structured proxy evidence, recorded resolution time is the
fallback; that does not independently establish outcome-availability time.
Duplicate resolved identities, invalid outcome quality, probability mismatch,
and duplicate comparisons are excluded. Raw retained scores and exact paired
scores must not be interchanged or compared to July across changing event mix.

## Required-cohort manifest

The receipt carries ten observed retained cohorts, listed below. It does not
establish a complete inventory of all required production cohorts or a historical
window. Model versions are present for all 500 accepted records; unknown
forecasters: 0. Evaluation code version is the commit above for every row;
installed evaluation version remains unavailable for every row.

| Forecaster / model version | Domain | Horizon | Resolved | Positive | Negative | Direct / proxy / manual |
|---|---|---|---:|---:|---:|---|
| analyst-loop / 2.0.0 | other | 1h-6h | 26 | 0 | 26 | 0 / 26 / 0 |
| hierarchical-base-rate / 1.0.0 | conflict | 1d-7d | 0 | 0 | 0 | 0 / 0 / 0 |
| hierarchical-base-rate / 1.0.0 | humanitarian | 1d-7d | 43 | 43 | 0 | 0 / 43 / 0 |
| hierarchical-base-rate / 1.0.0 | other | 1h-6h | 14 | 0 | 14 | 0 / 14 / 0 |
| hierarchical-base-rate / 1.0.0 | weather | <1h | 20 | 1 | 19 | 1 / 19 / 0 |
| hierarchical-base-rate / 1.0.0 | weather | 1h-6h | 38 | 13 | 25 | 13 / 25 / 0 |
| mode-forecast:disaster / 1.0.0 | humanitarian | 1d-7d | 43 | 43 | 0 | 0 / 43 / 0 |
| mode-forecast:security / 1.0.0 | conflict | 1d-7d | 36 | 36 | 0 | 0 / 36 / 0 |
| nws-warning / 1.0.0 | weather | <1h | 78 | 4 | 74 | 4 / 74 / 0 |
| nws-warning / 1.0.0 | weather | 1h-6h | 126 | 31 | 95 | 31 / 95 / 0 |

`proofWindowEligible: false`. Reasons: retained working set only, installed
evaluation revision unavailable, production window not assessed. This capture
does not start or qualify ACC-703's five complete UTC weeks. The earlier
October 19–26 scheduled report was partial and is not substituted for missing
coverage. ACC-601 through ACC-605 remain WAITING; their measured reassessment
and November 16 review reminders are recorded in the live roadmap.

## Architecture, verification and rollback

Changed surfaces: the read-only collector, focused behavior tests, dedicated
TypeScript config/npm scripts, additive targeted-test selection, and evidence/
roadmap documentation. Existing pure scorers, exact-join service, quality audit,
and registry reader are reused with no-op persistence. Python SQLite uses
`mode=ro`, `query_only`, one transaction, bounded values and a ten-second child
process timeout. No dependency or runtime bundle change was introduced.

[Mutation proofs](ACC-008-MUTATION-PROOFS.md) record all 23 applied mutations,
actual red counts, original/restored checksum and clean-tree verification.
[QA/QC evidence](ACC-008-QA-QC.md) records actual command results and review status.

Manual verification performed: checked installed release and running installed
process, acquired the selected production keys, reconciled origin/cohort counts,
comparison exclusions and identical paired denominators. The collector's
read-only and WAL behavior was separately exercised against synthetic databases.
No production database hash-stability claim is made while the app is running.

Rollback removes this offline tooling/documentation in a reviewed change.
No production data rollback, app installation, model rollback or migration is
needed. Releases, installation, deployment and automatic delivery remain paused.
