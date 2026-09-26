# ACC-509 — Stable situation identity

Risk: High Assurance. Owner: Codex. User approved the architect-reviewed design on September 25, 2026.

## Goal and acceptance

Stop repeated or delayed source reports from creating duplicate situations and repeated notification consideration across live-store eviction and supported restarts. Preserve distinct events, source chronology, valid zero coordinates, user state and source-warning eligibility. Original PR #1732 is being explicitly superseded on current main; its valid domain-hint and direct feedback exclusions are retained, not its broad destructive purges.

## Approved boundaries

Namespaced provider/report identity, canonical equality, material revisions, explicit event versus processing clocks, validated geography, and versioned data-plus-registry envelopes. Hard per-store bounds: seven days, 4,096 identities, 2 MiB serialized metadata. Reject oversized keys without truncation. Prefer referenced identities but never exceed bounds. On failed admission, retain source alert visibility and existing notification policy; suppress only untracked new derived-situation creation and report degraded deduplication. Persistence failure degrades restart guarantees, not usable in-memory tracking.

Persist notification-considered state before dispatch. A crash between those operations may omit an interruption; exactly-once delivery is not claimed. Do not introduce escalation notifications. Legacy data gets no invented freshness; preserve v1 and user state, and quarantine unsupported legacy derived situations rather than deleting by prefix.

## Separate work and integration hold

UX-059 owns active-warning retention, lifecycle provenance and related migration in a linked draft targeting main. ACC-509 must be independently safe under existing retention and the combined candidate must pass before either hold is released. Land ACC-509 first, rebase UX-059 onto exact canonical main, rerun affected checks, and review separately. Neither partial delivery resolves all H16/H17/H22 findings. No ACC-510 classification, UX-047 scheduling/schema change, confidence tuning, notification queues, providers or native UI changes.

## Work ownership

1. Architect and repository analyst freeze shared interfaces and ownership before production edits.
2. Security/store specialist owns bounded identity registry and unified-store persistence/consideration.
3. Prediction specialist owns situation engine/feed/correlator/bridges and event/geography state.
4. Provider specialist owns only order-independent LSR alert adaptation; outcome/scoring IDs stay unchanged.
5. UI specialist owns geographic guards where required.
6. Test specialist freezes replay, records before/after behavior and mutation evidence. Independent reviewer is separate from implementers.

## Validation and rollback

Frozen replay covers old/fresh duplicates, reordered LSR, same-title distinct events, delayed revisions, zero/unknown geography, 500-slot churn, restart, bounded capacity, oversize input, legacy migration and failed writes. Require zero duplicates within admitted retention bounds, zero fixture false merges and no source-vote inflation. Record counts, bytes and runtime, not just green tests. Preserve capacity and silence policy suites. Run focused tests, typecheck:all, named agentic validation, applicable live-body probes, independent and genuine opposite-agent review, required CI and pr-closeout.

Rollback reverts isolated PRs; legacy v1 remains intact but post-migration changes require reconciliation. No installed app/profile changes are authorized by this implementation.
