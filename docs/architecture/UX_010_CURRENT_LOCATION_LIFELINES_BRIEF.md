# UX-010 Current-Location Lifelines Feature Brief

Status: discovery and design
Risk: high assurance / precise-location privacy
Roadmap task: UX-010
Affected variants: to be confirmed during repository analysis

## Objective and user value

Let a user explicitly request nearby Disaster Lifelines for their current
location without silently turning precise location into a continuously watched,
persisted, analyzed, or exported identity signal.

## Acceptance criteria

- Location acquisition starts only after a clear user action.
- Before acquisition, disclose the permission request and the intended
  session-only Lifelines use.
- Display the reported accuracy and observation time with the active location
  anchor.
- Accept valid zero-valued latitude or longitude and reject non-finite or
  out-of-range coordinates.
- Denial, timeout, unavailable location, and stale fixes remain explicit and
  actionable; none may fall back to a hidden approximate location.
- Make at most one bounded location request per explicit action. Do not start a
  continuous watch.
- Keep the precise location in memory for the current app session only.
- Do not log, persist, cache as a saved place, analyze through unrelated
  exposure systems, transmit to unrelated providers, or include the location
  in an Emergency Pack without a second explicit save or prepare action.
- Preserve saved-place Lifelines, routing, offline-pack, and provider truth
  semantics.
- Update the UX-010 Progress Tracker row in this pull request.

## Constraints and invariants

- No production implementation begins until the concrete privacy design is
  explicitly approved.
- Do not add a Tauri permission, plugin, capability, or native command without
  a separate design and approval.
- Reuse repository location and Lifelines boundaries only when analysis proves
  they satisfy the session-only contract.
- No new dependency, external provider, secret, storage schema, migration, or
  background process.
- Precise coordinates must not appear in analytics, logs, diagnostics, error
  text, durable browser storage, URL state, or cross-feature document events.
- Preserve unrelated user-authored changes and all existing app variants.

## Non-goals

- Continuous GPS tracking, trip tracking, or background location.
- Automatic weather, alert, exposure, map, or intelligence personalization.
- Implicitly saving the current location as a named place.
- Automatically preparing or refreshing an Emergency Pack.
- IP, timezone, or network-derived location fallback.
- Changing location permissions or native desktop capabilities.

## Unknowns for discovery

- Which existing location API path is active in browser and packaged desktop,
  and whether invoking it changes native permission or retention behavior.
- Whether Disaster Lifelines currently requires a durable `SavedPlace` identity
  or can consume an ephemeral exact-place contract without touching storage.
- Which panel, map, diagnostics, analytics, and document-event paths observe a
  Lifelines place selection.
- How stale-location policy should combine the platform observation timestamp,
  requested timeout, and reported accuracy.
- Whether the current CSP and Tauri capability sets already permit the bounded
  request without repository changes.
- Which variants render the Disaster Lifelines panel and require test coverage.

## Required design evidence

- Read-only execution-path analysis for location acquisition, saved-place
  selection, Lifelines fetch/cache, map overlays, events, analytics, and pack
  preparation.
- Privacy and trust-boundary map covering precise input, native/browser APIs,
  memory ownership, network requests, caches, logs, and teardown.
- Architecture covering user states, request lifecycle, cancellation, stale
  and denied results, coordinate validation, variant behavior, tests, rollback,
  and alternatives.
- A bounded implementation plan with per-behavior red tests or mutation proofs.
- Explicit human approval of the resulting design before production code.

## Rollback

The implementation must remain additive and removable without migrating saved
places or offline artifacts. Rollback removes the ephemeral mode and returns
the panel to saved-place-only behavior without touching existing stored data.
