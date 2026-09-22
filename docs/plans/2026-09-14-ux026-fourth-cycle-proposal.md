# UX-026 fourth repair cycle proposal

Status: approved. Bradley replied, “fix whatever you need. Lets get it done,”
after the concrete fourth-cycle question. Implementation and validation of this
bounded scope may proceed; the recurring controller remains off.

## Why another decision is required

Bradley approved the previously interrupted third repair cycle. Its current
candidate is `b81d9dc28a6c8c211c0f03da39f31d92fd92d811`. Independent review
confirmed two remaining blockers after that repair. The project's review-cycle
limit requires another explicit decision before further production edits.

## Goals and scope

An open digest must stop displaying complete-negative overlap when its evidence
expires or becomes stale, even without an alert/place event. Successful camera
data must remain available when NWS enrichment fails. Keep the existing UX-026
claim and architecture; do not resume UX-025 or change providers, scoring,
ranking, polling, dependencies, persistence or model prompts.

## Design and owners

The UI specialist owns `src/app/panel-layout.ts`, the digest projector's internal
timing metadata, and `src/components/FAAWeatherCamsPanel.ts`. The test specialist
owns corresponding behavioral tests and isolated mutation proofs. The parent
integrates and validates; an independent reviewer and real Claude review the
final candidate.

Keep temporal rules in `digest-alert-projection.ts`. Each projected card carries
nullable internal `recheckAt`, derived from the same bounded member evidence
used for impact. For currently usable NWS evidence, select the earlier of
expiry and retrieval time plus the existing maximum age plus one millisecond.
That preserves the current inclusive freshness predicate and strict expiry rule.

The digest owner maintains exactly one timeout for the earliest future boundary
among displayed cards. Arm it after initial display and local reprojection.
Callbacks use current store, places and time, then replace the timeout. Cancel
on new generation, dismissal, empty/error state and destruction. A removable
document-visibility listener reprojects on resume. Avoid past-boundary loops,
and leave the separate proactive digest schedule unchanged. No new model or
network requests occur.

FAA camera, NWS and GDACS requests settle independently. Successful cameras
render with whichever alert sources succeeded. Explicit panel wording identifies
unavailable NWS/GDACS evidence, including in alert-only views; absent enrichment
must not imply no alerts exist. Failed camera retrieval preserves last successful
data with unavailable/stale status rather than claiming a successful refresh.
Keep scoring and thresholds unchanged.

## Acceptance and verification

Execute the actual digest setup and projector with controlled time: advance
past expiry and retrieval freshness separately without store/place events and
verify rendered negative overlap becomes unknown. Cover multiple members,
earliest-boundary replacement, delayed callbacks, reopen, dismissal, empty/error,
destruction and document resume. Assert at most one active timeout and unchanged
model/network call counts.

Execute actual FAA loading/rendering under independent source failures. Verify
cameras and successful GDACS context survive NWS failure, incomplete-source
wording is visible, alert-only emptiness is qualified, and recovery clears the
warning. Cover first load, refresh and camera-source failure.

Run focused suites, weather, renderer, types and the full agentic gate. Retain
clean-tree mutation proofs for each repair with actual applied diffs, failing
counts and restored checksums. Manually inspect fixture expiry with the digest
open, focus/scrolling, and FAA partial-source/recovery views. Obtain fresh
independent and complete exact-source Claude review.

## Evidence, risks and rollback

The third-cycle gate passed 15,327 tests, types, build and secret scanning, but
review reproduced both behaviors outside the existing test coverage. Green
checks do not waive those findings. The refreshed dependency audit also reports
nine advisories, including one critical; that is a separate publication blocker
and is not silently folded into this repair design.

There is no migration. Keep the bounded repairs revertible together and retain
earlier evidence. Approval authorizes one additional repair/review cycle only.
If a blocker remains afterward, report it rather than beginning another cycle.
