# PR #1654: initialization ownership repair

## Brief and approved design

Goal: termination during asynchronous ML capability detection must not revive a
worker or overwrite a newer attempt's manager state. The next explicit `init()`
must be able to start while the old GPU probe remains unresolved.

Classification: Standard runtime lifecycle correction within the approved PR
repair scope. This is the second automatic review/repair cycle; any remaining
confirmed blocking finding must be escalated rather than starting a third cycle.
Read-only discovery and architect design were supplied before implementation.
Base: PR #1654 at `60d0a5740` in a separate repair worktree. The author's dirty
`.worktrees/logfix` checkout was read only and its unpublished edits remain intact.

Capture the existing generation at entry to `init()`, before its first await.
Await capabilities into a local variable, then validate generation before
publishing manager capabilities or calling `initWorker(capturedGeneration)`.
Cleanup invalidates the generation and releases the shared `initPromise` slot.
Preserve the identity-checked `finally`, so an old attempt cannot release a newer
attempt's slot. A ready-timeout callback must validate its captured generation
before cleanup; retain the existing post-factory and worker-identity guards.

Acceptance: terminated detection returns false when its probe settles, creates
no worker and does not publish capabilities. A replacement owns its capabilities
and pending promise whether old detection completes first or last. Late factory
resolution/rejection, stale worker messages/errors, and obsolete ready deadlines
cannot disturb the replacement. Current unsupported devices, creation failure,
timeout, concurrent callers, handshake and retry retain their behavior.

Constraints: only `src/services/ml-worker.ts`, its manager test suite, and these
plan/evidence documents. No capability-detector API, cancellation mechanism,
probe timeout, model budget, model choice, worker protocol, forecast, settings,
storage, or provider changes. No installed-app mutation or real model download.
The browser GPU probe is not aborted; an old init promise can remain pending
until that probe settles. This is an explicit limitation, not a bounded-probe
claim.

Implementation owner: delegated specialist. Parent owns delivery and independent
review. Existing public manager APIs, injected worker factory, actual capability
detector with deferred browser GPU stub, and controlled timers provide the test
seams. Restore the GPU property descriptor/cache in `finally`. Assert bounded
observable conditions before awaiting readiness so a broken handshake does not
silently strand the regression test.

Validation: test-first races, `test:ml-budget`, focused lint, both TypeScript
configurations, named agentic gate, and clean-tree applied mutations of detection,
promise-slot ownership, ready-timeout and factory guards. Record counts, actual
failure names, inspected diffs, restored hashes and clean status. Preserve request
budget/eviction/settlement regressions. Obtain fresh independent review; do not
self-record a verdict.

Rollback: reviewed revert of this runtime correction. No data migration. A
rollback reopens initialization resurrection/ownership races but does not change
inference results or budgets.
