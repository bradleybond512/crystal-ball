# UX-058 — Account for deferred and updated warnings

## Approved operator policy

During the existing two-minute source cooldown, show each otherwise eligible warning immediately in the Alert Inbox with “System notification held during cooldown.” Keep a session count of distinct warnings held. Ending the cooldown, leaving Ghost Mode, reopening the app or granting permission later must not replay a backlog. Apply the operator’s explicit in-app-only selection even to critical warnings.

For this PR, update the same inbox row when an accepted live report raises its severity, for example “Updated to critical.” Keep that escalation inbox-only. Any future proposal for an additional system notification needs current authoritative membership from #1844, a typed identity shared by the site and inbox paths, one owner of delivery and separate operator approval.

## Why this is next

The controller selected UX-058 at priority S with open main-targeting draft claims included. UX-045 fixed badge-only events consuming interruption capacity. Its approved scope left distinct warnings, severity changes and channel selection open.

On canonical main `cd459dfec`, two distinct high NWS warnings produced one recorded OS constructor call. Re-ingesting the suppressed warning after cooldown produced zero more. Escalating its same ID to critical also produced zero. An in-app-only preference still allowed one OS constructor. Separately, a held permission prompt completed after switching to Ghost Mode and produced one constructor. Simulated inbox and site paths using today’s two ID forms generated two different OS tags. That observation establishes the tag mismatch; actual duplicate delivery requires both paths to be active. The baseline used in-memory storage, archive stubs and recording transports. The existing warning-delivery suite reported 20 pass / 0 fail.

## Rules and implementation boundaries

* Keep identity source-scoped. Normalize the two NWS ID representations from their typed inputs. Do not strip arbitrary prefixes or equate title, location, receipt time or alert text with identity. Use an authoritative newer issuance or revision and current operational membership. A pinned or recently retained row alone cannot establish activity.
* Track the highest severity observed for a resident identity in session memory. Initialize from its first accepted live observation. Preserve acknowledgement, snooze, pin and history. Ignore equal, older and replayed revisions. Downgrade followed by return to the prior severity cannot reinterrupt. A stored or evicted identity cannot authorize a catch-up notification. If tracking capacity is exhausted, keep the source history and omit the optional disposition.
* Apply channel, Ghost Mode, mute, quiet hours, existing critical rules and domain thresholds before spending source capacity or requesting permission. In-app-only makes zero OS requests, including permission prompts. Native and both can request the OS once when eligible. Preserve inbox history for all channels. Keep badge-only and derived messages on their existing policy paths.
* Recheck ownership and policy immediately before issuing an OS request after an asynchronous permission decision. Discard pending work after cancellation, explicit or authority-confirmed expiry, acknowledgement, snooze, a superseding revision, mode or channel change, or owning-workspace disposal. No delayed send on startup, permission recovery, mode exit or cooldown expiry.
* Keep at most one fixed-enum session disposition per resident identity, capped at the existing 500-row inbox limit. Remove it on expiry, cancellation or eviction. Use distinct counts and short fixed reasons. Repeated ingestion cannot inflate counts. Do not persist notification text in a second store, send telemetry, or describe a browser constructor call as confirmed OS presentation.
* Put accounting in the unified store, dispatcher and existing Alert Inbox. Keep the separate Threat Reactor router and summary/digest service outside this change. Reconcile with draft #1844 for active NWS authority, #1846 for Ghost accounting and #1847 for derived policy. Test workspace teardown with #1848. Work that requires those drafts stays behind the combined integration check.

## Work and verification

1. Store owner adds bounded disposition and escalation bookkeeping with synthetic replay tests, including legacy rows, capacity failure and repeated revisions.
2. Dispatcher owner implements channel selection and last-moment policy/ownership checks, with recorded permission, native and browser transports and zero real sends.
3. Inbox owner adds accessible row state and counts without stealing focus. Verify acknowledgement, cancellation and expiry independently of retention.
4. Run real store-to-dispatcher-to-inbox fixtures for same-source contention, the two NWS entry points, delayed permission, Ghost/mute, quiet hours, in-app/native/both, restart and teardown. Prove the original eligible warning can request one system notification and later severity-only updates produce zero additional requests. Include clean-tree mutation proofs, focused suites, the repository gate, independent and Sonnet reviews, and draft integration evidence.

Rollback reverts the dispatcher/store/UI change. Existing credentials, inbox items, notification preferences and installed profiles require no migration. Session disposition data expires when its owner closes. The operator approved this design, publishing the documentation-only claim and local implementation.
