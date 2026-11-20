# UX-057 — verify all six reported timer writers

High Assurance, test-only. Bradley approved this design, documentation draft
claim and local test implementation on November 19, 2026. Current main `ffb3f3ccb4` and a complete live roadmap snapshot select
UX-057 [B], with no open PR overlap on the six reported files. Current source
does not support the original L2 claim that all six write on every interval tick.
Verify this with executable evidence before proposing any production change.

## Scope and architecture

Add `tests/ux057/timer-persistence.test.mts` with an internal fixture harness
patterned on `tests/ux047/operational-consumers.test.mts`. Execute transpiled
actual modules and captured actual callbacks with HappyDOM, deterministic clocks
and service dependencies, injected memory storage, and denied network/native
access. Use existing scheduler and consolidation seams where available. Never
replace the callback under test or copy/rewrite its logic into fixtures.

Separate initialization writes from measured timer ticks; record attempted
writes, successful writes and affected synthetic keys. No installed storage,
credentials, application launch, provider probe, dependency or production edit.

| Actual module | Required executable evidence |
| --- | --- |
| PhishstatsFeedPanel | Repeated refresh ticks write no preferences; slider changes persist/reload; denied writes retain current handling; destroy clears its timer. |
| tv-mode | Cycling writes no storage; explicit interval changes persist/reload; read/write exceptions remain observable; destroy stops cycling. |
| notification-digest | Empty/retired-only ticks write nothing; deliverable digest persists/reloads; save failure keeps current behavior; destroy clears timer/subscription. |
| improvement-scheduler | Disabled/not-due ticks write nothing; due work persists result and schedule; reload respects schedule; stop prevents further timer execution. |
| consolidation-cadence | Disabled/Ghost/not-due ticks write nothing; successful due work advances timestamp; failed work does not falsely advance; reload retains cadence. |
| self-tuning | Ghost/not-due ticks write nothing; due work executes existing grading/drift paths and records completion; storage errors retain existing containment; reload retains cadence. |

Prediction roadmap reviewed before planning. ACC-104 grading and ACC-402
promotion/rollback are boundaries, not additional claims. UX-057 owns this
six-writer investigation; no prediction equation, promotion, grading, drift,
notification, acquisition, persistence schema or scheduling policy changes.

## Bounded owners and execution

1. Parent owns the documentation-only draft claim, design, package test entry,
   required exact test mappings, roadmap and validation report. Publish the
   approved reviewed claim before implementation.
2. Test engineer owns the new fixture/test file and separate scratch mutation
   proofs. Finalize exact source mutation sites and corresponding test names
   before writing fixtures. No production edits in the candidate branch.
3. Reuse the existing improvement-scheduler, consolidation, self-tuning and
   operational-consumer suites to validate their boundaries. Independent review
   checks actual-callback execution and faithful fixture dependencies.

## Tests and mutation proofs

Exercise repeated idle ticks, immediately-before and at-due boundaries, actual
state changes, reload, storage denial and existing teardown APIs. A zero-write
test must be paired with a positive persistence assertion so broken legitimate
persistence cannot look like an optimization.

For each of the six paths, apply an inspected scratch mutation that writes on
an idle tick or bypasses its actual due/empty guard; require its behavioral test
to fail. Also disable representative persistence and existing teardown operations
to prove reload/lifecycle assertions. Record actual red counts/assertions,
applied diffs, before/restored hashes and clean state. Retain unexpected failures
and investigate them rather than weakening checks or inventing production fixes.

Run `npm run test:ux057`, existing scheduler/consolidation/self-tuning and UX-047
operational-consumer suites, type checks and secret scanning, then the named
agentic validation gate. Final independent Sol and actual Sonnet reviews precede
the recorded verdict and separate code-publication approval.

Existing baseline executed on November 18 with Node 22.23.1:

```sh
node --import tsx --test tests/intelligence/improvement-scheduler.test.mts src/services/cognition/__tests__/consolidation-cadence.test.mts src/services/cognition/__tests__/self-tuning.test.mts tests/ux047/operational-consumers.test.mts
```

Actual output: `# tests 85`, `# pass 85`, `# fail 0`, `# cancelled 0`.
These existing suites are regression baselines, not yet the proposed six-writer
characterization or mutation evidence. The distinct `self-improvement-scheduler`
module is not substituted for the reported `improvement-scheduler` path.

## Acceptance, limits and rollback

Correct the historical finding only after all six fixtures and mutation proofs
pass. Do not claim redundant writes were removed: this design changes no runtime
behavior. Fixture evidence is not installed-app or energy-use evidence.

Self-tuning and consolidation currently expose no stop/dispose API. TV storage
operations can throw. Report these facts and leave broader lifecycle/storage
recovery acceptance open; do not manufacture teardown or graceful-recovery
success. Any new persistence defect or production repair needs a separate
approved design. Full UX-057 acceptance must not be marked complete while a
required contract remains unverified or fails.

No migration or runtime rollback is needed; reverting test/script/docs changes
leaves application behavior unchanged. Merging, auto-merge, releases, deployment
and installation remain paused. Approval covers this bounded design, documentation draft claim and local
test-only implementation. Implementation publication requires separate reviewed-tip approval.
