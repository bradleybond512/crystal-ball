# UX-047 — national warning lifecycle implementation plan

Status: Bradley approved this high-assurance design and implementation on
2026-11-02 UTC. Read-only repository analysis and architect discovery preceded
approval. Branch: `codex/ux047-warning-freshness-nov1`. Draft claim #1844 preceded
implementation. Local implementation passed the integrated gate, 57 mutation
proofs and independent review. [Validation evidence](../validation/UX-047-NATIONAL-WARNINGS.md)
records results and rollback. Native WKWebView acceptance remains a delivery gate.

## Objective and constraints

Keep national NWS warnings current after refresh, offline expiry and restart,
while reporting incomplete or failed acquisition honestly. Preserve retained
history and user acknowledgment, pin and snooze state separately from active
membership. Acceptance is the UX-047 task in the live usability tracker.

Scope: full-variant scheduling and NWS lifecycle, both existing web/desktop
provider transports, shared NWS consumers and the NWS panel. No Home-shell
changes, notification-policy changes, model changes, installations, releases,
or delivery-setting changes. Existing owners retain their separate PRs.

Risk: high assurance because authoritative warning state and persisted
lifecycle metadata influence operational displays. Unknowns: complete national
pagination semantics, defensible bounded response limits, precise lifecycle
metadata limits, cache migration and packaged/offline acceptance. Resolve these
within the approved complete-snapshot design before the respective edits.

## Verified repository problems

- `src/App.ts` schedules ordinary weather alerts; NWS acquisition is boot-only.
- NWS loader adds to the unified store without authoritative absence reconciliation.
- Failure updates the panel with an empty array, producing a misleading all-clear.
- Desktop primary/fallback requests have differing scope and truncate at 100 rows.
- Web returns raw GeoJSON inside an object while the client expects normalized rows.
- Normalization uses future onset ahead of issuance time.

The architect's live response-body probe found 435 features, 2,090,613 bytes,
133 rows with references and 165 with onset after issuance, including Minor and
Unknown severity. Request:
`https://api.weather.gov/alerts/active?status=actual&message_type=alert,update`.
Consumed fields: ID, status, message type, severity, urgency, sent, onset, expires,
references, geometry and geocodes. No pagination member appeared in that sample.
This is one sample and cannot calibrate a defensible new size limit.

## Proposed bounded design

1. Web and desktop use one validated complete national snapshot contract with
   alerts, national-active scope, completeness and original observation time.
   No authoritative membership truncation. Partial, malformed or unhandled
   continuation responses cannot certify completeness or retire prior alerts.
2. A typed snapshot accessor carries freshness/provenance; current array callers
   use a projection. Cached/offline snapshots preserve their acquisition time.
3. A newer complete snapshot reconciles only NWS operational membership. Missing
   IDs mean no longer present in the active feed, not invented cancellation
   reasons. Explicit expiry operates offline too. Preserve historical evidence,
   acknowledgment, pin and snooze state without treating pinned expiry as active.
4. Persist a validated NWS watermark and bounded lifecycle metadata through the
   existing persistence envelope. Older snapshots cannot resurrect retired IDs.
   Legacy state remains unverified until authoritative refresh.
5. Proposed five-minute base refresh uses the existing full-variant scheduler,
   respects Ghost Mode and existing power/visibility policy, and runs independent
   of panel visibility. Use one bounded expiry timer and O(n) ID reconciliation.
6. Render issued time from `sent` and show onset separately as Starts. Failed
   fetches retain last-known alerts with stale/unavailable status. Only complete
   empty snapshots justify the national empty-state message.

No new dependency, notification-policy change, model inference, saved-place
scoring, forecast resolution, installation or delivery-setting change.

## Ownership and files

- Provider specialist: `api/nws-alerts.js`, NWS sidecar route,
  `src/services/nws-alerts.ts`, provider/client parity tests.
- Intelligence specialist after contract: `src/services/unified-alerts.ts`,
  narrowly scoped `alert-retention.ts`/`alert-normalizer.ts`, lifecycle tests.
- UI specialist after contract: `src/App.ts`, NWS block of
  `src/app/data-loader.ts`, `src/components/NWSAlertsPanel.ts`, scheduler/UI tests.
- Parent: task claim, integration, evidence and tracker. Serialize shared-file edits.

## Acceptance and proof

Test >100-row national membership; complete-empty versus failed/partial fetch;
issuance updates; offline expiry including pinned alerts; restart and stale
replay; no repeated notification from identical snapshots; issued/future onset;
hidden-panel refresh; web/desktop parity; existing UX-059/ACC-509 regressions.
Mutation proofs separately remove completeness, watermark, expiry, scheduler
wiring and sent-time guards, with actual red counts and restored checksums.
Select exact targeted scripts after the implementation brief, then run all
typechecks and the unchanged agentic validation gate. Packaged/offline behavior
still requires actual runtime acceptance.

## Approval choices and rollback

Approved: complete-national contract on both transports, five-minute base
cadence, and source-specific retirement preserving history/user state. Optional
persisted lifecycle metadata is within the approved design.

Revert provider/client contract and lifecycle integration together if rollback
is needed. Retired evidence must remain preserved. Measure multiple live payloads
before fixing new response limits; never loosen safety tests to accept truncation.

## Discovery constraints for integration

- UX-059 retention preserves recent and pinned history, including expired rows.
  Active NWS eligibility must be separate; do not replace the retention predicate.
- ACC-509 v2 hydration performs zero writes and zero notifications. Source
  metadata must be explicitly validated; never infer authority from raw fields.
- All three current `nws-alerts` offline-cache readers expect arrays. Migrate
  consumers together or use a new snapshot key; legacy arrays cannot establish
  completeness or a trustworthy observation time.
- The five-minute NWS refresh must preserve ancillary SPC, marine, rainfall and
  winter feed cadence and existing forecast/notification logic. Isolate NWS
  acquisition from the broader boot weather-loader responsibilities.
- Hidden-panel refresh means a visible document with the panel absent/hidden.
  Preserve the scheduler's hidden-window network pause and bounded resume.
- Archived/pinned expired warnings must not become operationally active.
  Preserve the existing 500-alert retained-store policy; national source
  membership completeness cannot be inferred from a capacity-truncated view.

The architect finalized these shared interfaces before production edits.
Specialists own provider, lifecycle and UI surfaces as listed above; parent
owns package/test routing, sidecar resource registration, integration and docs.

## Final interface and task contracts

Provider boundary:

```ts
interface NWSAlertSnapshot {
  schemaVersion: 1;
  scope: 'national-active';
  completeness: 'complete';
  observedAt: number;
  alerts: NWSAlert[];
}
```

A pure renderer boundary module holds the type and validator; the existing
client re-exports it and exposes `fetchNWSAlertsSnapshot()`, retaining the
array accessor as a projection. A dependency-free sidecar helper is shared by
web and desktop transports and explicitly registered as a packaged resource.
The fixed official active endpoint has no pagination in observed bodies;
unsupported continuation is rejected, not silently omitted. Resource bounds
are 8 MiB and 2,000 alerts, with existing geometry budgets; exceeding any bound
fails acquisition without caching a malformed or incomplete success.

Lifecycle exposes `reconcileNwsSnapshot`, `getOperationalAlerts` and narrow NWS
operational predicates/views. Full validated national membership and the
accepted watermark are persisted independently of the 500 retained-row cap.
Equal-time identical membership is a no-op; equal-time conflict is invalid.
Legacy hydration never fabricates authority and writes/notifies zero times.
One explicitly started/stopped lifecycle timer invalidates operational views
at expiry, including while offline, without deleting history or user state.

UI owns the new offline key `nws-alerts-snapshot-v1` and atomically migrates
all three loader readers and critical-source inventory. Snapshot age comes
from original acquisition time. Cache bootstrap performs no reconciliation or
notification. `refreshNWSAlerts()` owns only snapshot acquisition, authority,
reconciliation, NWS panel/context; the existing broader loader retains its
boot-owned ancillary and model responsibilities. App schedules only the new
refresh at five minutes, preserving hidden-window pause and bounded resume.

Operational consumers receive a narrow integration: TriageBar, SummaryStrip,
sidebar heat, native menubar/dock and notification digest use the operational view.
Independent review identified alert-reactions as another current delivery path:
both initial reactions and the five-minute critical reminder must recheck
operational eligibility, preserving channels, thresholds and timing. Distinct
retired-before-notification and retired-during-delay regressions cover the paths.
History, timelines, replay, learning and forecast consumers retain `getAll()`.
Each changed operational consumer needs a regression excluding inactive NWS
rows while preserving non-NWS behavior. The panel uses the full national
snapshot rather than deriving completeness from retained history.

Provider tests precede provider implementation; lifecycle tests precede state
changes; loader, scheduler and panel tests precede their behavior changes.
Integration runs new `test:ux047` plus existing UX-059, ACC-509, alert-capacity,
warning-delivery, UX-026, weather, storm-source revision, API/sidecar and panel
regressions. Mutation proofs begin only from a clean integrated checkpoint.
Actual renderer/offline/restart acceptance and packaged-resource verification
must be recorded without installing over the user's application.

## Live provider measurements

Three read-only body samples on November 2 UTC at 03:26:58, 03:27:04 and
03:27:11 each returned 428 features and 2,054,330 bytes: 89 Polygon geometries,
339 null geometries, 89 rings and 1,035 vertices. They contained 128 rows with
197 references and no continuation field. Minor, Unknown and Future enum
values occur in the real national feed and must not silently disappear.
The proposed bounds are conservative resource limits, not a statistically
established upper tail; all three short-interval samples were identical.
The completed adapter probe at 03:57:08 UTC reconciled 430 upstream rows to 430
backend, renderer and lifecycle records with original observation time intact.
