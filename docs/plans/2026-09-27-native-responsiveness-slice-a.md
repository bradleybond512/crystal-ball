# R3-BUG-001: preserve desktop responsiveness

Status: slice A explicitly approved by Bradley through the approval question on September27; slice B remains unapproved. R3-BUG-001 remains open until separately approved slice B addresses coordination and bounded completion.

## Why split

Secret writes currently hold the secrets lock across an unbounded physical write. Making only writes asynchronous is insufficient: a synchronous secret read can still freeze the main thread waiting for that lock. A detached write timeout is unsafe: an older timed-out write could finish after a newer save and overwrite it. Migration writes and recovered-key merges add other concurrent writers. Slice A moves waits away from the main thread without changing data ownership or pretending to solve write cancellation.

## Slice A — concrete approval scope

Move all potentially blocking work in seven commands onto blocking workers: set_secret, delete_secret, get_secret, read_cache_entry, write_cache_entry, delete_cache_entry, save_brief. Resolve managed state inside the worker with an owned AppHandle; never move borrowed tauri::State into a static closure. Move lock acquisition, JSON parsing and filesystem work, not just the final write. Preserve trusted-window/input validation, return shapes, errors, ordering, persistence and size limits.

Keep secrets_ready (atomic) and list_supported_secret_keys (constants) synchronous. Audit all remaining synchronous secrets/cache lock readers. Boot/reload/retry already use workers; repaired iMessage is unchanged.

Track main-window focus via native event-owned atomic state, including focus gain/loss across platforms. Initialize on the main setup/event path. Preserve macOS auxiliary-window raising. Record transition generation or gain time so loss/regain between watchdog ticks resets grace. Ignore auxiliary-window focus for main focus. Remove both background is_focused calls, including diagnostics. Preserve60s startup grace,12s focus grace,60s heartbeat threshold and120s reload cooldown. Recovery may obtain a window handle, but must not query focus. This improves observation; win.reload still cannot guarantee recovery of a genuinely wedged main thread.

Non-goals: no secret readiness, migration/shadow policy, lock ownership, write deadlines, renderer synchronization, cache eviction, shutdown durability, dependencies, capability, updater, iMessage or installation changes. Secret operations may still wait indefinitely on workers; explicitly unresolved until B.

## Tasks, owners and dependencies

1. Parent creates a fresh codex branch from canonical main after the iMessage prerequisite is merged, and records approved scope. No installation or live secret operations.
2. Native specialist owns main.rs async wrappers and minimal watchdog policy module/tests. Work starts only after approval; inspect existing wrappers and lock readers before editing. Parent/test specialist owns source guards, focused npm script, test-selection wiring and evidence.
3. Fake-only regression tests precede implementation. Verify secret reads/write contention runs on workers; cache read/write/delete and brief operations likewise; errors never become success. Verify main focus gain/loss/rapid transitions, auxiliary focus and exact timing boundaries. Use source-scoped tests for thin wrapper/focus wiring; do not claim real-Keychain behavior from source tests.
4. Targeted native contracts/source tests, typecheck:all, secret scanning, named agentic gate. Record mutation proof per changed wrapper and focus behavior: clean tree, checksum, inspected applied diff, assertion red counts, exact restore. Audit native test effects before any broad cargo run.
5. Independent review, at most two repair cycles, actual exact-tip Claude review, verdict-only commit, fork push/PR and pr-closeout auto-merge. Update tracker as partial; do not mark R3-BUG-001 fixed until B.

Acceptance: every identified blocking command path and lock wait executes away from the main thread; background watchdog never calls is_focused; event timing matches existing policy; no data or secret-policy change; required tests and reviews pass.

Rollback: slice A changes no persisted data. Revert restores prior blocking behavior; prefer a reviewed forward correction. Never claim responsiveness after rollback.

## Slice B — reference design, separate approval required

One narrow native coordinator must own every physical vault writer and every recovery publication: set/delete, migration consolidated write+existing cleanup, boot/reload publication, retry merge/shadow. Serialize snapshot→physical write→shadow/cache/touched publication without holding the secrets-state lock across external work. Recovery reads may run outside transaction, but merge against current state under coordination, preserving touched deletions and recovered additions. Migration cannot persist a stale snapshot over user changes. Preserve current migration/shadow policy; R3-SEC-003 owns those policy changes.

Bound caller waiting, not an uncancelable write lifetime. Admission expiry means Busy and no later execution. Once started, retain writer ownership through actual completion. Timeout must explicitly mean pending/uncertain; no newer physical writer overtakes it. Bound outstanding requests. If a write never completes, secret mutation stays unavailable while the app stays responsive. Final pending/status interface is undecided and requires B design approval.

Replace readiness polling with synchronized loading/completed/degraded/failed state and condition-variable notifications. Predicate+notification synchronization avoids missed wakeups; panic/failure signals terminal failure. Renderer must not memoize an empty cache as loaded after timeout/IPC error.

Late success must converge native cache, renderer and sidecar. Use bounded operation status plus secret-free revision/completion notification; renderer invalidates/reloads native authority without optimistic saved state. Sidecar additions AND deletions must be revision-ordered; audit competing stale renderer pushes. No secret values in events/status/diagnostics.

B fake-only tests: concurrent edits; set/delete order; recovery additions+touched deletion; timeout ownership and late outcome; renderer/sidecar convergence; expired admission never later writes; readiness before/after waiter and worker failure; migration cleanup only under existing successful-write conditions. Every behavior gets a mutation. Likely files secrets_state.rs, main.rs, keychain.ts, runtime-config.ts and focused tests. No live Keychain/securityCLI/Entry calls, credentials, certificates, backups/restores, installed app or installation.

## Approval requirement

AGENTS.md: “High-assurance work must stop for human approval after discovery and design, before production implementation.” This design changes privileged native command execution. Approve only slice A now; B remains a separate reviewable decision.
