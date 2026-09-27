# UX-048 — Restore validated GDACS map observations

Bradley approved this bounded design on September 26, 2026 after read-only repository analysis, architect review and live API probes.

## Goal and acceptance

Restore earthquake, flood, cyclone, wildfire and drought observations from the GDACS homepage MAP feeds. Preserve stable event IDs, source dates, Orange/Red filtering, the 100-alert cap, existing cache provenance and UX-059 retention. Explicitly report volcano coverage unavailable. A fresh result requires all five feeds to validate; partial results must not acquire a successful-update timestamp.

## Evidence and decision

The official Swagger documents one `eventtype` per MAP request. The previous URL returns HTTP 400. Five captured MAP bodies contain 465 representations and 49 canonical event centroids; six qualify under the existing severity policy. Volcano MAP returns HTTP 404. `events4app` returns 100 Green records and omits qualifying droughts. SEARCH includes historical disasters and is not a substitute for current homepage membership.

Use five concurrent fixed HTTPS requests with one shared 10-second deadline and no added retry. Total observed transfer is approximately 4.98 MB uncompressed; this cost and the volcano gap were explicitly accepted. Validate hazard IDs, representation classes and geometry before selecting `Point_Centroid` rows. Require every represented event to have a valid centroid; reject conflicting duplicates and unknown representations. Feed canonical rows to the existing strict parser. Do not infer ongoing status from end dates or `iscurrent`.

## Work ownership and boundaries

- Provider specialist: provider, shared coverage constants, focused captured fixtures and behavior tests; adapt existing fetch fixtures without weakening assertions.
- Parent: diagnostic coverage, probe wording and regression tests; integration, evidence and validation.
- Independent reviewer: completed diff and failure-path evidence, without implementation ownership.

Diagnostic health must preserve failing/silent states and downgrade otherwise-healthy GDACS to degraded while volcano coverage is unavailable. Probe success certifies only EQ endpoint reachability. No dependency, permission, sidecar RSS, notification policy, prediction, scheduler or installed-app change is included.

## Required evidence

Run focused provider/diagnostic tests, adapter provenance, UX-059, UX-026, freshness and date hydration, then the named agentic validation gate and bundle policy. Each changed behavior receives an applied mutation proof with a clean starting tree, confirmed diff, actual assertion failure and restored checksum. Replay full saved live bodies through the real adapter and repeat live requests. Require independent review, actual opposite-agent SHA-pinned approval and green CI before `scripts/pr-closeout.sh`.

## Risks and rollback

The aggregate fails closed when any supported feed fails. Volcano coverage is unavailable; recurring warning ingestion remains a separate scheduling concern. Large map geometry is transferred but never promoted into event rows. No schema migration or user-data deletion is needed. Roll back through a reviewed PR, preserving alert history and cache provenance.

Sources: [GDACS Swagger](https://www.gdacs.org/gdacsapi/swagger/index.html). Captured bodies, summaries and original design are retained under the local diagnostic evidence directory `gdacs-repair-20260926`.

## First independent review refinement

The initial implementation passed local validation but two simultaneous cold callers could start ten requests. Coalesce the entire provider tracked operation locally and abort/drain sibling requests before releasing a failed batch. Preserve per-result provenance and retry after failure. This enforces the approved five-request budget without changing the generic breaker. Add overlapping-caller and failed-sibling regression/mutation cases. The initial intake missed the existing UX-048 tracker; it is linked here before delivery, not represented as a pre-implementation PR claim.
