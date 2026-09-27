# Protected identity saturation: bounded performance repair

Status: IN REVIEW — ACC-509 performance follow-up. Bradley approved this bounded design with “continue” on September 27, 2026, after the specific approval request. The original ACC-509 delivery remains DONE. This separate repair unblocks repeated required CI failures; it does not change the native updater.

## Context and applicable roadmap

Current `src/services/alert-identity.ts:198–218,255–273` validates identity/time, expires records, checks duplicates, prepares/validates the candidate, and only then chooses capacity victims. `src/services/unified-alerts.ts:389–459` builds a protection Set once per synchronous ingest and adds accepted/duplicate identities to it. The Set only grows during this loop, but may include keys absent from the ledger. The same ledger is also used outside this loop, with caller-owned mutable Sets.

The parent reports two required CI failures around 570/565 ms against the unchanged 500 ms budget. Supplied local evidence `perf-alert-batching.log` has 10 pass / 0 fail; CPU evidence `perf-alert-batching.cpuprofile` attributes approximately 66.4 ms self-time out of 135.5 ms ingest to `Ledger.victims`. A 5,000-alert batch fills 4,096 protected identity slots, then scans all residents for roughly 900 overflow admissions: approximately 3.7 million fruitless protection checks. These are diagnostic results supplied by the repository analyst, not new benchmark runs by this architect. The earlier #1740 array-allocation optimization is already present and does not eliminate these scans.

Applicable roadmap: **ACC-509**, stable situation identity under delayed and repeated input, already DONE through #1738. This is a follow-up performance repair to that path, not a new accuracy feature or ACC-510 work. Coordinate the claim as ACC-509 follow-up and append evidence without claiming a new forecast improvement. **UX-059** retention/warning integration must remain invariant. The prior #1740 performance evidence is in `alert-performance-20260926/FINAL-REPORT.md` and showed a prior CI success at 336.8 ms; current repeated failures justify a new bounded repair rather than retrying unchanged code.

## Goals, non-goals and classification

Goal: remove repeated full-ledger victim scans when every resident identity is protected, while producing exactly the same admission statuses, snapshots, byte counts, revisions, user state, archive contents and notification counts as the current implementation.

Non-goals: increase/decrease identity or alert limits; change expiry, validation, victim order, retention, scoring, correlation, notification eligibility, persistence format, protected-key semantics, CI concurrency or the 500 ms budget; optimize all ledger consumers; edit native-updater files.

Classify conservatively as **High Assurance** because the implementation is inside ACC-509's eviction/admission boundary and affects safety-relevant deduplication and warning delivery. Intended semantics do not change, but an incorrect optimization can corrupt those guarantees. Concrete approval received before production edits.

## Rejected smaller shortcut

Do not carry a caller-local `lastAdmissionWasCapacity` flag and skip subsequent `admit` calls. Capacity can be caused by one candidate's byte size, so a later smaller entry can fit. An existing revision may fit without adding a slot; duplicates and invalid values must preserve their existing statuses. The loop must also continue delivering novel warnings when identity retention fails.

Do not use `protectedKeys.size >= ledger.size` as proof: protected keys can be absent from the ledger. Do not cache by Set reference and size: callers can delete one resident and add one absent key without changing either. Rechecking all memberships per candidate recreates the measured bottleneck.

A caller-local shortcut could only be sound after duplicating ledger validation, exact resident coverage, byte/count admission conditions, expiry and invalidation rules into UnifiedAlertStore. That is a larger and less maintainable trust boundary than keeping the proof inside Ledger.

## Minimal proposed architecture

Add **one synchronous scoped admission method** to `IdentityLedger`, used only by `UnifiedAlertStore.ingest` for this repair. Suggested shape:

`withProtectedAdmissions(now, initialProtectedKeys, callback)`

The callback receives a bound `admit(identity, value)` function. The scope owns a copy of the initial protected keys and automatically protects a key after an `accepted` or `duplicate` result, exactly matching the current ingest loop. Invalid/capacity results do not add protection. The scope ends when the callback returns; the bound function cannot be used afterward. There is no public boolean such as `allProtected`, no caller-provided count, and no mutable protection Set exposed by the scope. The existing ordinary `admit(..., protectedKeys)` API remains unchanged for all other callers and observes their current Sets on every call.

The scope tracks an exact **protected resident count**, not total protection-Set size. At creation, expire at the fixed ingest `now`, then count the intersection of ledger residents and its owned protection keys once. Scope insertion/removal and promotion to protected status maintain this count with constant-time deltas. A scope-owned protection key absent from the ledger contributes zero until a resident is inserted for that key.

All ledger membership changes must be accounted for, including expiry and replace/remove/insert during revision updates. A small ledger membership generation provides a safe invalidation check if a mutation occurs outside the scoped admission path or a nested callback mutates the ledger: when the generation differs from the scope's recorded generation, recompute the resident intersection before using the optimization. Changes made by the scoped path update both count and recorded generation. `updateValue` changes bytes but not membership; the capacity-fit check always reads fresh bytes, so it does not invalidate resident coverage. Do not introduce subscriptions, a global protection registry, or persistent protection state.

Reuse one internal admission implementation so scoped and unscoped routes preserve the same sequence:

1. Validate identity and time.
2. Expire entries.
3. Return duplicate for a known revision, as today.
4. Prepare and validate candidate, preserving the existing invalid result and serialization behavior.
5. Compute candidate-adjusted count and bytes.
6. If both fit, accept without victim selection, as today.
7. **Only now**, when a scoped proof establishes `protectedResidentCount === ledger.size`, return capacity without enumerating residents. No resident is evictable; the candidate itself is not a victim. This applies equally to a new key or an oversized revision, while fitting revisions already passed step 6.
8. Otherwise run the existing victim collection/sort/removal unchanged: receipt time, then key tie order, existing-entry exclusion and exact JSON comma accounting all remain as-is.

The scope auto-protects accepted/duplicate outcomes after the normal result is known. A duplicate's existing `updateValue` attempt remains in the caller; its success/failure and capacity diagnostics remain unchanged. The extra automatic protection occurs before that value refresh, but no admission interleaves between them and membership is unchanged.

Wrap only the current ingest loop in this scope. Keep distance stamping, merge/retention logic, previous-state lookup, `alerts.set`, diagnostics, `newAlerts`, persistence, archive and notification dispatch at their present ordering. In particular, capacity/invalid identity outcomes must not skip `newAlerts.push`; novel source warnings remain eligible even when the ledger cannot retain identity state. Leave hydration and other ledger consumers on the ordinary API initially.

## Component and interface boundaries

Production files: `src/services/alert-identity.ts` and `src/services/unified-alerts.ts` only. No storage schema, worker, provider, sidecar, native, dependency or privilege changes. The added scope is an internal TypeScript API; persisted `IdentitySnapshot.version` stays 1.

The ledger owns the capacity proof and its invalidation. UnifiedAlertStore owns what counts as initially protected, and the current accepted/duplicate rule determines when the scope extends protection. Incoming feed fields still pass the current identity and value validators; the optimization cannot bypass them. Persistence and dispatcher boundaries remain untouched.

If implementing the count/generation invariants requires a broader eviction redesign or changing existing statuses, return to design rather than expanding the repair. A single count plus generation and scope-owned Set is the maximum intended new bookkeeping.

## Failure and degraded behavior

Unscoped callers use the original algorithm. Unknown/outdated scoped bookkeeping forces an intersection recount; it never assumes all protected. Exceptions end the scope in `finally` and cannot leave a durable cached verdict. A leaked admission closure must fail closed rather than silently reuse a batch after its lifetime; test this internal contract. Nested/unscoped membership changes invalidate by generation and are checked by parity fixtures.

Capacity remains a retention failure only. Novel warning consideration/delivery remains unchanged, and diagnostics still count every rejected identity. No scope state is serialized or restored.

## Performance expectations and evidence required

For the measured case, one coverage count and constant-time bookkeeping replace roughly 900 scans of 4,096 residents. Expected complexity for fully protected overflow changes from O(overflow × residents) to O(residents + inputs), apart from existing candidate preparation and serialization costs. This is a reasoned expectation, not a claimed measured improvement.

Use the same 5,000-alert test, fixture and unchanged 500 ms threshold. Compare interleaved baseline/optimized runs on the same Node version and idle machine; preserve all sample values and medians, and re-profile once to confirm `Ledger.victims` no longer dominates saturated overflow. Do not set a new timing threshold from one fast local result. Required CI must independently pass before merge; no blind retry loop.

Add a deterministic work-bound assertion, separate from wall-clock timing, that hundreds of protected overflow candidates do not cause a resident enumeration per admission. Use a test-only spy on the ledger's resident iterator or an equivalent private test seam; do not add production telemetry/API for this test. Reverting the fast path must turn that work-bound assertion red even on a fast laptop.

## Tasks, owners and dependencies

1. Parent: obtain this specific approval, create a separate fresh branch/draft PR claiming ACC-509 follow-up, keep #1742 documentary and native-updater work isolated. Use the real current canonical main.
2. `prediction_engineer` or `intelligence_engineer`: owns the two production files and adjacent ledger/unit tests. Read the current files first and implement only the scope and exact count/generation proof. No other agent edits those production files concurrently.
3. `test_engineer`: owns independent parity fixtures, deterministic work-bound test and benchmark evidence, coordinating test files with implementer. It must not modify capacity or performance thresholds. Parent may run validation if fewer agents reduce credit use.
4. Independent reviewer: review the complete diff, especially coverage-count invalidation, expiry, byte-specific rejection, stale scope use and dispatcher ordering. Separate opposite-agent SHA-pinned review and closeout gates still apply. At most two repair cycles.

Expected test files: `src/services/__tests__/alert-identity.test.mts`, `unified-alerts-identity.test.mts`, `unified-alerts-batching.test.mts`, and focused additions to `unified-alerts-warning-delivery.test.mts` if existing coverage does not assert overflow notification counts. Prefer extending existing named scripts rather than creating a new broad test framework.

## Behavioral tests and mutation proof

Compare scoped admission against the unchanged ordinary API driven by a reference Set that adds only accepted/duplicate keys. After every operation compare statuses, ordered full snapshots, size and exact byteLength. Cover:

- All resident keys protected, many novel overflowing keys: exact repeated capacity results and no state mutation.
- Absent protected keys, and more protected keys than residents while a resident is unprotected: correct eviction still occurs.
- Ordinary caller mutates a same-object/same-size Set by deleting a resident and adding an absent key: ordinary admission observes it.
- At saturation: invalid identity/value stays invalid, exact duplicate stays duplicate, smaller fitting revision is accepted, larger revision fails, `updateValue` byte changes affect subsequent admission correctly.
- First large candidate fails bytes while the next smaller candidate fits; no blanket consecutive-capacity suppression.
- Expiry at the exact boundary, expired protected entries, revival of a previously absent protected key, and external/nested membership changes refresh proof correctly.
- Oldest-receipt/key tie order, multi-victim byte eviction, comma accounting, unchanged receipt/revision retention and hydration snapshot compatibility.
- Whole-batch vs multiple-batch ingest parity, duplicate user-state restoration, protected overflow diagnostics and a novel high-severity warning still dispatched after capacity rejection.
- Scope exception cleanup and use-after-scope rejection; new scope gets current state, not the previous batch's proof.
- Deterministic iterator-work count for saturated overflow, plus the unchanged 5,000-alert performance test.

Run targeted `npm run test:acc509`, `npm run test:ux059`, `npm run test:alert-capacity`, `npm run test:warning-delivery`, and the batching test through the existing tsx runner. Then typecheck and `bash scripts/agentic-validate.sh --tests "test:acc509 test:ux059 test:alert-capacity test:warning-delivery"`; run the complete renderer suite if required by existing workflow/CI. Quote actual output and benchmark distributions, not predicted passes.

Mutation proofs from a clean committed tree must include confirmed applied diffs, real red counts/assertions, restored checksums and clean status for: bypassing validation before capacity; treating Set size as resident coverage; omitting protection-count updates or generation invalidation; omitting accepted-key protection; using consecutive capacity for a later fitting candidate; suppressing novel warning delivery; and removing the scan-skipping optimization (deterministic work-bound test). The unchanged algorithm remains the semantic comparison oracle, not a copied optimized implementation.

## Migration, rollback and approval package

No migration: limits, persistent envelope, retained state and notifications are unchanged. Rollback is reverting this isolated optimization; it restores the prior correct but slower algorithm without data conversion. Keep the CI budget unchanged on rollback and report the performance blocker if it returns.

Approval request: “Approve the bounded ACC-509 performance follow-up: add a ledger-owned synchronous protection scope that skips victim scans only after validation and fit checks prove every resident protected. Preserve identity/retention/notification behavior, verify parity and mutations, and keep the 500 ms limit unchanged.”

Approval is required by `AGENTS.md:121` (“High-assurance work must stop for human approval after discovery and design, before production implementation.”), because this changes implementation at the identity-retention boundary. Existing approval for R3-SEC-001 does not cover this separate scope. That decision is now recorded above; implementation may proceed within this scope.
