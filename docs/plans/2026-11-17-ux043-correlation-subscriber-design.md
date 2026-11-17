# UX-043 — bounded correlation subscriber scan reduction

## Decision and approval boundary

High Assurance: this subscriber feeds correlation confidence. Keep UX-043 as the sole claim; ACC-505 fallback and ACC-501 frozen benchmark remain unchanged safeguards, not reopened tasks. Bradley approved this bounded design, documentation-only draft claim and local implementation on November 17. Publish the documentation claim before editing production code. Implementation publication requires separate reviewed-tip approval.

## Objective and scope

Build a callback-local ID index during the existing scan in `src/services/correlation-feedback.ts`, then replace its two repeated `getAll().find(...)` lookups. The index contains original correlation-alert references in existing iteration order and is discarded after each callback. No cross-delivery cache or global shared snapshot.

The existing callback performs `1 + A + P` full-array allocations for newly acknowledged and pinned alerts. At500 alerts with both transitions, the theoretical bound is1001 arrays containing500500 references. The candidate should need one500-reference array plus a bounded index. These are code-derived expectations; capture actual baseline/candidate counts before reporting measured savings.

## Preserved behavior and boundaries

Preserve acknowledgment-before-pin ordering, pair-key order, previous-set replacement, first-seen cleanup, one save per changed delivery, strict `<10000` fast-ack boundary, minimum3 samples, equations, storage schema and multiplier bounds0.5–1.2. The callback has no await or external callback between its initial scan and lookups; persistence follows them. Each callback still observes changes made by earlier subscribers.

Do not change `unified-alerts.ts`, `source-feedback.ts`, subscriber signatures, notification throttling, expiry delivery, capacity, retention, learning policy, provider inputs or delivery settings. No dependencies, migrations, app launch, live-data reads, credentials or native execution. Merging, auto-merge, releases, deployment and installation stay paused.

## Bounded implementation tasks

1. Test engineer: own `src/services/__tests__/correlation-feedback-subscriber.test.mts`, a narrowly scoped reusable fixture helper and `scripts/measure-alert-feedback.mts`. Capture baseline counts/behavior before the fix. Use actual feedback code and real-store integration with fake storage, time, archive and notification effects; isolate singleton initialization in fresh processes. No production reset API.
2. Intelligence specialist: own only `src/services/correlation-feedback.ts`, dependent on detecting fixtures and the published claim. Add the local index and replace the two repeated lookups. Preserve every other statement's semantics.
3. Parent: own the named test command, exact targeted-test mapping, roadmap row and validation evidence. Integrate specialists without overlapping edits.
4. Independent Sol and Sonnet: review the completed exact candidate; repair confirmed findings within the repository's two-cycle limit, record actual conclusions and the required pinned verdict.

## Acceptance and validation

Exercise insert/update/removal, mixed sources, absent pairs, combined acknowledgment/pin, unchanged delivery, unpin/repin, strict fast-ack boundary, restart initialization, removal/reintroduction, subscriber exceptions and an earlier subscriber causing a subsequent delivery. Compare serialized statistics and multipliers to baseline traces.

At full capacity measure zero, one and500 simultaneous transitions. Attribute operation counts to this callback and report end-to-end fixture fan-out separately. Require one `getAll()` per callback and exact behavioral parity. Supplementary wall-clock measurements must disclose fixture/environment limits; no app-wide CPU or energy claim.

Run the new focused suite, existing batching/capacity/warning-delivery/derived-reaction tests, `npm run test:acc505`, `npm run test:correlation`, and `npm run bench:correlation` without reseeding. Run all type checks and the named agentic validation gate, including secret scanning. Confirm the exact existing script paths before execution and report actual output, never assumed passes.

Mutation proofs: restore each repeated lookup; break acknowledgment/pin deduplication; lose a transition; change the fast-ack boundary; retain a stale index across deliveries; break first-seen cleanup. Begin from a clean tree, confirm each applied diff, record red counts/assertions, and verify restored checksums and green reruns.

## Risks, rollback and remaining work

A stale index could lose transitions or change confidence; callback-local lifetime and trace parity are the key protections. Operation counts establish this hotspot's improvement, not whole-application performance. Rollback restores the callback implementation; no data migration exists.

Full UX-043 remains open for broader subscriber-contract efficiency and complete fan-out acceptance. Global snapshot/delta contracts need separate reentrancy and expiry design. The existing marketing audit failure is unrelated and remains open.

## Discovery evidence

Fresh main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`; complete live snapshot selects UX-043[B], blocking[] after the previously verified UX-076 metadata correction. Required analyst and architect reviews completed. Existing batching/capacity baseline: `# tests 21`, `# pass 21`, `# fail 0`. Both TypeScript configurations passed before implementation. These results do not establish candidate behavior or performance.
