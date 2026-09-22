# PR 1731: warning reliability before further surfacing

## Brief

Objective: turn the September 22 handoff into owned, verifiable roadmap work,
starting with H19: an advisory must not suppress a subsequent warning.
User value: important warnings reach the operator without repeated low-value
interruptions, and missing observations are never presented as reassurance.

Reviewed source: main `7230cef6942871fb9eea04ebed4dffdb258ca6b7`.
Review input: [PR 1731 handoff at its reviewed revision](https://github.com/bradleybond512/crystal-ball/blob/ac70c0f6a0db3cfb3ff9d46b0f2bad129eb2e94a/docs/UI_PERF_HANDOFF_FOR_CODEX.md).
The handoff is evidence and proposed remedies, not an implementation approval.
Its live measurements describe the author's installed build and observation
window; they are not new measurements made by this task.

## State and constraints

As checked September 22, PRs 1729, 1730, 1731 and 1732 are open.
PR 1731's accessibility check now passes; its cross-agent review check fails.
The historical PR description understates the expanded handoff's scope.
Do not mark locally installed changes as delivered to main. Preserve the local
build and the operator's settings; no installation, storage purge, credential
change or real notification is part of this planning work.

Keep the existing UX-000 native acceptance gate and unfinished basic-map PR1729.
The reliability work below precedes new reassuring posture surfaces; it does
not erase the rest of the roadmap. Every implementation owns one task in a
draft PR and supplies tests, mutation evidence and review before closeout.

## Priorities and ownership

1. UX-045: severity-aware warning delivery (H19), first design/discovery task.
2. UX-046: retention and cap ordering (H17/H18). Preserve active warnings and
   bounded storage; explicitly define the all-pinned capacity case.
3. ACC-509: finish the existing situation-loop repair with re-ingest identity,
   event-time clustering and geographic discrimination (H10/H16/H22). Coordinate
   with PR1732; no competing implementation and no merge on a partial fix.
4. UX-047: scheduled NWS ingestion plus authoritative lifecycle (H12/H13/H14).
   Reuse validated lifecycle helpers without reducing the global store to only
   the operator's saved-place subset. Partial fetches must not clear valid data.
5. UX-048 and UX-049: restore verified GDACS coverage and truthful sensor health.
6. UX-050/UX-052: explicit suppression policy and derived-alert restraint.
7. Layout, boot, background work and maintenance tasks follow as listed in the
   usability tracker. Measure before broad performance refactors.

Correlation belongs in the prediction accuracy tracker, with UX references,
not a second implementation queue. ACC-510 covers neutral/topic-aware news
classification separately from event identity.

## Evidence corrections

- H19 is reproduced on current main with stubbed delivery: a medium NWS badge
  dispatch is followed by a high NWS warning suppressed as `source-rate-limit`.
  Silent dispatch already returns before this limiter; it does not consume a
  slot today. Existing dispatcher/settings tests pass but omit this sequence.
- The proposals to replace relative API routing and add blanket desktop
  timeout/storage wrappers are not accepted: H9 was retracted; H4/M5 were
  downgraded after tracing existing global patches. Proposed UX-039/UX-041
  remain unallocated, not hidden unfinished requirements.
- Counts of timer sites and silent catches are investigation leads, not
  measurements of CPU cost or proof that every catch is wrong.
- "Pinned alerts are never evicted" needs a bounded-capacity policy when every
  retained alert is pinned; do not promise unbounded retention.
- A same-title situation guard must retain locality, source identity and event
  lifecycle distinctions; unrelated floods must not collapse into one event.

## First task and approval boundary

UX-045 is high assurance because it changes delivery of safety-related alerts.
Repository discovery is read-only with stubbed Notification APIs. Architecture
must choose a bounded escalation/cooldown policy, describe every suppression
outcome and define whether queuing/coalescing belongs in this first change.
The operator approved the concrete badge-only correction on September 22.
Move the existing allowed badge return after user-policy gates and before the
source cooldown. Keep the existing timestamp map, two-minute limit, critical
bypass and attempt-based reservation. No severity-escalation exception, queue
or persistent-state change is approved in this slice.

Owners: repository analyst traces the actual dispatcher/store path; architect
designs the bounded fix; UI/alert specialist implements only after approval;
test engineer verifies real behavior and applied mutations; independent reviewer
reviews the final diff; Claude reviews the exact Codex branch tip.

Acceptance: advisory then warning from one source delivers the warning; duplicate
warnings remain bounded; an advisory badge does not block a subsequent warning;
critical, quiet-hour, domain, Ghost Mode and permission policies remain explicit;
no real OS notification is emitted by tests. No provider, scoring, persisted
schema, native IPC or production-data changes in the first bounded repair.

Validation: focused notification tests, settings regressions, typecheck:all,
named agentic gate, mutation proof and cross-agent review. Rollback is a reviewed
revert of the dispatcher change, with no migration or data deletion.

## PR review disposition

Independent review of PR1731 tip ac70c0f6a0db3cfb3ff9d46b0f2bad129eb2e94a
found four blocking documentation issues: overstated NWS lifecycle reuse and
ambiguous national input scope; title/locality correlation without bounded event
identity; incomplete reproduction instructions; and unbounded pinned-retention
acceptance. Do not record a passing verdict for that tip. This intake corrects
those prescriptions rather than treating them as approved implementation.

The reproduced H19 outcome is notification loss, not loss from the inbox: both
alerts remain stored, one badge dispatch is traced, zero OS notifications occur,
and the warning has one source-rate-limit suppression. Re-ingesting the same
IDs adds no trace or retry. Silent already exits before the limiter. Diagnostic
traces exist, so operator-facing accounting/retry is the gap.

Remaining limitations after the approved repair: a second distinct high warning
inside a high-warning cooldown can still be suppressed, same-ID severity updates
are not dispatched by the store, and the preference evaluator does not currently
enforce DomainSettings.channel. These require separate policy/lifecycle work in UX-058;
this task must not claim every warning reaches the OS.

Evidence: [UX-045 validation record](../validation/UX-045-WARNING-DELIVERY.md).
