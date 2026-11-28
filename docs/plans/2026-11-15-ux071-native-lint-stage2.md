# UX-071 native lint stage 2 — approved bounded design

Approved November 15 for local implementation; existing draft #1904.
Published stage1 tip: d759723d4. New code publication needs separate approval.

The latest Linux/macOS receipts pin fd5a01e8904f6f8a135f17f02a0eaae9ba7aa9da, before stage1 2dfb8f4f8. This proposal compares those diagnostics with the stage1 diff; it does not claim post-stage1 hosted failures.

## Bounded scope

- src-tauri/src/main.rs: replace 24 directly passed manually NUL-terminated literals with C-string literals; remove two macOS-only needless borrows; correct three rustdoc continuation lines.
- src-tauri/src/current_location.rs: replace 12 directly passed manually NUL-terminated literals; convert the macOS branch final return-match to its equivalent tail expression.
- src-tauri/tests/sidecar_supervisor_contract.rs: replace four assert_eq(expression, false, message) assertions with assert(!expression, message), retaining expressions, messages, names and assertions.

Keep Objective-C declarations, concrete function-pointer signatures, argument order, retain/release operations, selector names, ivar names, type encodings, static lifetime and NUL termination identical. Where declarations take *const u8, cast the C-string pointer explicitly; do not change the FFI declaration or message-send ABI. Leave byte-slice helpers and their callers outside scope.

Affected paths: App Nap, dock/menubar updates, CoreLocation delegate registration/cleanup, updater verification and supervisor contract tests. No policy, privileges, permission requests, failure-return, concurrency, cleanup, IPC/schema, dependency, storage, migration or budget changes. Equivalent syntax is the objective, not architectural restructuring.

## Owners and validation

Tauri/security specialist implements only the three files after approval. Test engineer provides focused portable source-boundary checks where needed. Parent integrates evidence and named validation; independent Sol and actual Sonnet review before any new publication request.

Inspect every converted literal for identical bytes and pointer type. Run affected portable boundary tests, type checks and named agentic gate. Any added behavior test requires an applied mutation/red/checksum-restoration proof. Existing crypto controls do not establish Objective-C runtime acceptance.

Actual Rust execution remains disposable-hosted-only, all eight targets, exact inventories, strict -D warnings, existing three mutation controls and unchanged 43-minute driver/45-minute job budgets. No local Rust execution, native service calls, Keychain access, app launch or installation. Preserve pre-change diagnostics and fresh hosted results as detection evidence for equivalent syntax changes.

## Explicit exclusions

Updater DTO/dead-code changes (removing fields may relax Linux deserialization); harness/platform separation; notification/iMessage scoping; test-only vault accessors; orphan username helpers; live-channels opener/navigation guard.

CrossProcessSwapLock::open_lockfile also remains separate. Its inode must persist without truncation. A later bounded repair could specify truncate(false) with tests proving bytes, inode and lock exclusion survive reopening; truncate(true) or create_new(true) would be incorrect.

These exclusions remain acceptance blockers; stage2 does not promise a fully green Clippy run. Further diagnostics require separate scope review. Rollback is a reviewed revert; no data migration. UX-071 stays open until all required hosted checks pass. Merging, auto-merge, releases, deployment and installation remain paused.
