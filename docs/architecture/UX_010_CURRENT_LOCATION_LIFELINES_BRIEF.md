# UX-010 Current-Location Lifelines Feature Brief

Status: implementation complete; publication in review
Risk: high assurance / precise-location privacy
Roadmap task: UX-010
Affected variants: full browser and full macOS desktop

Approval: on 2026-08-29, the human explicitly approved the full browser and
macOS design in PR #1684, including its privacy disclosures and necessary
upstream provider transmission/access-log retention risk.

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
- Do not add a Tauri permission, plugin, capability, native command, dependency,
  or entitlement without a separate design and approval.
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
- Adding an OS permission, entitlement, native capability, or plugin.

## Discovery findings

- Browser startup currently calls the shared location service before any
  Lifelines disclosure. Packaged macOS startup also requests Location Services
  authorization unconditionally.
- The shared location service retains a fix and in-flight request across
  unrelated consumers. It cannot provide a private UX-010 anchor.
- The existing native command returns only latitude and longitude, substitutes
  renderer receipt time for observation time, omits accuracy, and rejects
  `(0,0)`.
- Saved-place Lifelines writes coordinate-bearing fingerprints to memory and
  durable cache, publishes document events, and exposes coordinates in a GET
  URL whose successful response is publicly cacheable.
- The local sidecar buffers non-GET bodies up to its global limit and can replay
  failed local routes, bodies, and authorization headers to cloud fallback.
- Disaster Lifelines is full-variant only. No tech, finance, or happy panel
  implementation is needed.
- No new Tauri capability, plugin, dependency, entitlement, provider, secret,
  or storage migration is required, but the existing Tauri IPC, API, and
  sidecar security boundaries must change.

## Proposed approval design

### Consent and startup

- Remove automatic location acquisition from app startup. The existing
  timezone signal may choose only the coarse initial global map region; it
  never supplies, approximates, or seeds a Lifelines anchor.
- Remove the macOS setup-time Location Services authorization request and its
  retained-manager leak.
- Replace `NSLocationWhenInUseUsageDescription` with: "Crystal Ball accesses
  your location only when you request a location-based feature, such as nearby
  Lifelines or location sharing."
- Show a disclosure before the current-location action: one location fix,
  session-only Lifelines use, and transmission to the Crystal Ball Lifelines
  endpoint plus the necessary Overpass, FEMA, Census, and ODIN paths. Explain
  that Crystal Ball keeps the Lifelines fix only in panel memory, but the OS or
  browser may remember the permission grant until the user changes it.
- State that Crystal Ball will not persist the fix, while third-party provider
  access-log retention cannot be guaranteed.

### Native and browser one-shot acquisition

- Replace the existing `get_native_location` tuple contract; do not add a new
  command, plugin, capability, or dependency.
- Restrict the command to the exact `main` window and allow only one in-flight
  request. The explicit command invocation lazily starts the OS permission and
  one-shot CoreLocation lifecycle.
- Use a main-thread/run-loop-safe manager and delegate. Release them exactly
  once on success, denial, restriction, timeout, failure, or app exit. Never
  pass or dereference Objective-C pointers off their owning thread.
- Use `requestLocation`, not continuous updates or the existing Swift
  subprocess plugin. Return real `horizontalAccuracy` and `CLLocation.timestamp`.
- Browser mode makes one `getCurrentPosition` request with high accuracy,
  `maximumAge: 0`, and a 15,000-ms timeout. It uses the platform timestamp.
- The renderer location API is stateless: no shared fix cache, shared in-flight
  promise, automatic retry, watch, IP fallback, timezone fallback, or reverse
  geocoding.
- Return allowlisted failure codes only: denied, restricted, disabled, timeout,
  unavailable, stale, inaccurate, busy, invalid, or unsupported. Never expose
  native stderr, platform messages, coordinates, or window labels in errors.

The existing `get_native_location` command always resolves this exact
camel-case JSON envelope; bridge/invoke failures are mapped by the renderer to
the safe `unavailable` code:

```text
{ ok: true, fix: {
    latitude: number,
    longitude: number,
    horizontalAccuracyMeters: number,
    observedAtUnixMs: number
} }
| { ok: false, error: {
    code: "denied" | "restricted" | "disabled" | "timeout" |
          "unavailable" | "busy" | "unsupported"
} }
```

`observedAtUnixMs` is the integer Unix epoch in milliseconds converted from
the platform observation timestamp. Native acquisition uses the same
15,000-ms deadline as the browser. The deadline owns the `timeout` result and
the exact-once manager/delegate cleanup.

Both native and browser fixes must pass the same policy before any network
request:

- finite latitude in `[-90, 90]` and longitude in `[-180, 180]`, including
  zero-valued components and `(0,0)`;
- finite, nonnegative reported accuracy;
- observation no older than 60 seconds and no more than 30 seconds in the
  future;
- accuracy no worse than 50 km;
- accuracy wider than the selected radius remains usable only with a visible
  warning that uncertainty exceeds returned coverage.

### Ephemeral Lifelines transport

- Preserve the saved-place GET route and its cache behavior unchanged.
- Add strict JSON POST handling to the existing `/api/local-logistics` route
  for `purpose: session-lifelines`; coordinates exist only in the bounded body,
  never in the request URL or response metadata.
- The POST body has exactly these keys and types, with no unknown keys:

```text
{
  schemaVersion: 1,
  purpose: "session-lifelines",
  latitude: number,
  longitude: number,
  radiusKm: 5 | 10 | 25 | 50,
  categories: ("shelter" | "hotel" | "hospital" | "pharmacy" |
               "fuel" | "water" | "recovery")[],
  limitPerCategory: integer from 1 through 5
}
```

- `categories` contains 1 through 7 unique values; empty arrays and duplicates
  are invalid rather than normalized.
- A successful POST keeps the existing schema-v2 sites, observations,
  providers, freshness, partial, and deprecated-node fields, but its `query`
  object is exactly `{ radiusKm, categories }`; it omits the anchor latitude,
  longitude, county FIPS, request purpose, and request fingerprint.
- The POST handler resolves county FIPS and invokes the existing bounded,
  validated ODIN provider function server-side. That function is exported from
  `api/grid-outages.js` without changing its origin, provider schema, cache, or
  existing GET contract. The renderer never receives a FIPS merely to issue a
  second URL request.
- The POST response adds `areaConditions` with length 0 through 100 and exactly
  one `ornl-odin` status to the expected OSM/FEMA provider set.
  `areaConditions` contains the existing normalized objects with exactly these
  required fields:
  `id: string`, `type: "power_outage"`, `coverage: "reported" | "unknown"`,
  `countyFips: five-digit string`, `county: string`, `state: string`,
  `customersOut: nonnegative safe integer`, `observedAt: ISO-8601 string`,
  `retrievedAt: ISO-8601 string`, `expiresAt: ISO-8601 string`, and
  `source: "ornl-odin"`; optional fields are `customersRestored: nonnegative
  safe integer`, `utilityName: string`, and `utilityId: string`. The renderer
  validates the exact expected provider IDs, bounds, timestamps, FIPS
  consistency across rows, and contribution counts.
- The ODIN provider object is exactly `id: "ornl-odin"`,
  `state: "ok" | "empty" | "partial" | "error"`, `acceptedRows: integer
  0..100`, `droppedRows: integer 0..100`, `observedAt: ISO-8601 string`, and
  `retrievedAt: ISO-8601 string`, plus an optional allowlisted `reasonCode`.
  `ok` requires 1..100 contributed conditions and zero dropped rows; `empty`
  requires zero conditions and zero dropped rows; `partial` requires 1..99
  contributed conditions, 1..99 dropped rows, a combined maximum of 100, and
  `reasonCode: "rows_dropped"`; `error` requires zero conditions, zero
  accepted rows, 0..100 dropped rows, and one of `upstream_unavailable`,
  `upstream_http_error`, `malformed_envelope`, `truncated_page`,
  `unusable_rows`, `capacity_exceeded`, or `county_fips_unknown`. The
  `county_fips_unknown` case is used only when a non-US coordinate or Census
  failure yields no county, with zero accepted and zero dropped rows because
  ODIN was not queried. `acceptedRows` must equal the number of contributed
  `areaConditions`; mismatches reject the response rather than being silently
  reconciled. ODIN `empty` or `error` does not fail otherwise usable Lifelines
  results.
- Every POST error response is exactly `{ error: code }`, never echoes request
  fields, and uses this finite mapping: `invalid_request` (400, including
  malformed JSON/schema/fields/categories), `unauthorized` (401),
  `origin_not_allowed` (403), `method_not_allowed` (405), `body_too_large`
  (413), `unsupported_media_type` (415), `rate_limited` (429),
  `internal_error` (500), `upstream_failed` (502), and either
  `capacity_exceeded` or `route_unavailable` (503). `OPTIONS` remains a
  bodyless 204. Every one of these POST/sidecar outcomes is private no-store.
- Enforce an exact field allowlist, `application/json`, coordinate/radius/
  category/limit validation, and a 2,048-byte maximum.
- Every POST response, including errors and sidecar 413 responses, sets private
  no-store headers. The renderer also uses `cache: 'no-store'` and
  `referrerPolicy: 'no-referrer'`. There is no GET or offline fallback.
- Add the same 2,048-byte streaming bound in the sidecar before it buffers the
  body.
- Fail closed against cloud fallback for `/api/local-*`, including missing
  handlers, cached cloud preference, thrown errors, and non-success responses.
  Never forward the coordinate body or local bearer token.
- Routine logs remain path-only. Tests must prove a distinctive coordinate
  never appears in renderer, API, or sidecar log output.
- Upstream Overpass, FEMA, and Census requests necessarily receive coordinates;
  ODIN receives derived county FIPS. No new provider or origin is added.

### Panel-private ownership

- Add a discriminated saved-place versus ephemeral anchor to
  `LocalLogisticsPanel`. The ephemeral fix and snapshot exist only in panel
  instance memory.
- Use explicit disclosure, requesting, validating, fetching, ready, error,
  update-location, and clear-location states with accessible status/focus.
- Generation and session identity guard every platform and network completion.
  Clear, saved-place selection, mode change, or destroy aborts fetches, clears
  timers and memory, and makes late native results inert.
- Refresh Lifelines reuses the current in-memory anchor but does not reacquire
  location. Update Location requires a new explicit one-shot action.
- Ephemeral mode never writes memory-module or durable caches and never emits
  Lifelines, grid, comms, map, route, diagnostics-data, analytics, AI-summary,
  prewarm, readiness, or Emergency Pack events.
- Hide or disable Map, Show on map, Graph route, Prepare offline, pack status,
  prewarm retry, and AI Summary. Call, Source, and Open in Maps may remain for
  returned facilities because they do not expose the anchor.
- Evidence expiry repaints only the panel-owned snapshot and publishes nothing.

### Explicit durable conversion

- `Save as place…` opens the existing create modal with a memory-only prefill.
  It does not call saved-place persistence itself.
- The modal explains that saving permits normal durable and cross-feature use,
  requires a name and radius, and does not prepare an Emergency Pack. It also
  states the existing saved-place rule: the first saved place becomes primary;
  later additions do not silently replace the current primary.
- Cancel or close clears the prefill and writes nothing. Only the existing
  explicit `Add Place` confirmation persists.
- The panel switches to saved-place mode only after exact persistence readback
  succeeds and the completion still matches the current ephemeral generation.

## Approved file boundary

Expected production files after approval:

- `src/App.ts` and `src/utils/user-location.ts`;
- `src/services/location.ts` and focused tests;
- `src-tauri/src/main.rs`, a bounded `src-tauri/src/current_location.rs`, and
  `src-tauri/Info.plist`;
- `api/local-logistics.js` and direct API tests;
- `api/grid-outages.js` and focused tests, limited to exporting/reusing its
  existing validated ODIN lookup without changing its origin or GET contract;
- `src-tauri/sidecar/local-api-server.mjs` and real HTTP/fallback tests;
- `src/services/local-logistics.ts` and Lifelines tests;
- `src/components/Panel.ts`, `src/components/LocalLogisticsPanel.ts`,
  `src/components/SavedPlaceModal.ts`, `src/app/panel-layout.ts`, and focused
  component/layout tests;
- `src/styles/panels.css` and this UX-010 brief/tracker.

Explicitly outside this approval:

- `src-tauri/Cargo.toml`, capabilities, entitlements, Tauri configuration, and
  the existing Swift-subprocess CoreLocation plugin;
- provider schemas or origins, saved-place schema, offline-cache schema,
  Lifeline runtime, grid loader, maps, routes, prewarm, pack, diagnostics, GPS
  tracker, analytics, and AI implementation.

Any required trust-boundary edit outside the approved list stops for a new
design approval.

## Bounded implementation tasks

All tasks depend on this explicit design approval. They remain one UX-010
branch and pull request, with each owner confined to the listed boundary.

1. **Startup and location contracts — Tauri security owner.** Change only
   `src/App.ts`, `src/utils/user-location.ts`, `src/services/location.ts`,
   focused tests, `src-tauri/src/main.rs`,
   `src-tauri/src/current_location.rs`, `src-tauri/Info.plist`, and focused Rust
   tests. First prove startup prompting, shared caching, schema, deadline,
   policy, exact-main gating, cleanup, and TCC behavior red; then implement the
   approved one-shot contract. Evidence: focused Node tests, Rust tests/check,
   packaged-mac TCC matrix, and mutation proofs.
2. **Private API and sidecar transport — sidecar owner.** After the request and
   response contracts are fixed, change only `api/local-logistics.js`,
   `api/grid-outages.js`, their direct tests,
   `src-tauri/sidecar/local-api-server.mjs`, and focused sidecar tests. The grid
   edit only exports/reuses the existing validated ODIN operation; its provider
   origin, validation, caching, and GET contract remain unchanged. Prove POST
   validation, server-orchestrated outage evidence, streamed size bound,
   no-store, coordinate-free responses/logs, and fail-closed cloud fallback
   red before implementation. Evidence: direct handler tests plus real
   HTTP/fallback tests and mutation proofs; saved-place GET and grid GET
   behavior must remain green.
3. **Stateless renderer transport — UI/data owner.** After tasks 1 and 2 fix
   their contracts, change only `src/services/local-logistics.ts` and focused
   tests. Add a separate ephemeral fetch path with no fingerprint, cache,
   shared in-flight work, fallback, or document event. Evidence: focused
   service tests and per-behavior mutation proofs.
4. **Panel and explicit conversion — UI owner.** After task 3, change only
   `src/components/Panel.ts`, `src/components/LocalLogisticsPanel.ts`,
   `src/components/SavedPlaceModal.ts`, `src/app/panel-layout.ts`,
   `src/styles/panels.css`, and focused component/layout tests. Prove consent,
   state/race handling, suppressed actions/events, clear/destroy, and confirmed
   save conversion red before implementation. Evidence: focused DOM/layout
   tests, accessibility/manual browser inspection, and mutation proofs.
5. **Integration and closeout — integration owner.** Update only this brief and
   the UX-010 tracker row beyond the production files already approved. Run all
   targeted suites, every variant build, secret scan, the full agentic gate,
   signed packaged-mac verification, independent review, real cross-agent
   review, SHA-pinned verdict, and PR closeout.

The work adds no startup or render-loop cost. Location and provider work occurs
only after an explicit click, with one platform acquisition and at most one
active ephemeral provider request. The panel retains one bounded snapshot.
No-store deliberately trades repeat-request latency and provider load for the
privacy guarantee; refresh repeats the provider request, while Update Location
adds one new platform acquisition. The 2-KiB body bound and single in-flight
native request cap memory and native resource use.

## Failure and degraded behavior

- Denial or restriction uses fixed copy and may offer the existing Location
  Settings action. Timeout, unavailable, stale, inaccurate, invalid, busy, and
  unsupported states have fixed coordinate-free messages and an explicit retry.
- A location failure never triggers a Lifelines request or approximate fallback.
- POST failure never falls back to GET or cached data.
- Provider partial/error states retain existing truthful coverage semantics.
- Offline ephemeral mode is unavailable and suggests saving, then separately
  preparing the saved place.
- Non-macOS packaged desktop is explicitly unsupported until separately
  designed; full browser builds use browser geolocation.

## Test and mutation evidence plan

Every behavior requires observed red or a recorded production mutation:

- no startup acquisition or setup-time prompt;
- exactly one platform request per action and no shared cache/in-flight result;
- structured accuracy and real platform observation time;
- denial, restriction, disabled, timeout, unavailable, busy, stale, future,
  inaccurate, invalid, latitude zero, longitude zero, and `(0,0)`;
- exact-main IPC gating, bounded deadline, single cleanup, app-exit safety, and
  responsive Tauri invoke handling;
- coordinate-free POST, strict body/content-type/field/range validation,
  2,048-byte declared and streamed bounds, and no-store for every outcome;
- no cloud fallback, body forwarding, bearer forwarding, cache fallback,
  storage, shared in-flight work, or document event;
- no coordinates in captured logs or error text;
- panel disclosure, accuracy/time, warning, action suppression, focus, clear,
  destroy, and late-result races;
- cancel writes nothing, confirmed save readback switches modes, and saved-place
  behavior remains unchanged;
- full-variant-only identity and unchanged tech, finance, and happy variants.

Targeted validation includes Lifelines, Lifelines-map, Lifelines-grid, sidecar,
API, location, panel, modal, Tauri Rust tests/check, all variant builds, secret
scan, the full agentic gate, and a signed packaged-mac TCC matrix. Manual web
inspection must prove no pre-click prompt, coordinate-free URL, no-store
response, and session teardown. Manual macOS inspection must reset TCC and prove
one prompt on the explicit click, real accuracy/time, responsive UI, clean logs,
and no anchor after relaunch.

## Human approval decision

Approval must explicitly cover all of these changes:

1. Remove browser and macOS startup acquisition/prompt behavior.
2. Change the existing privileged Tauri IPC schema and its CoreLocation
   manager/delegate ownership lifecycle, its 15,000-ms deadline, and the exact
   structured envelope.
3. Adopt the 60-second stale, 30-second future-skew, and 50-km maximum-accuracy
   policies, and replace the macOS TCC prompt with the pinned click-initiated
   usage text.
4. Add browser and desktop POST-body/no-store transport while acknowledging
   that necessary upstream providers may retain access logs.
5. Add the sidecar route-specific body bound and fail-closed no-cloud-fallback
   rule for local routes.
6. Suppress map, route, cross-feature events, prewarm, pack, diagnostics data,
   analytics, and AI Summary in ephemeral mode.
7. Make the confirmed Save Place flow the only durable conversion.
8. Show that Crystal Ball's fix is session-memory-only while OS/browser
   permission may persist, and adopt the exact versioned POST schema and
   coordinate-omitting response contract.
9. Reuse the existing ODIN provider server-side so ephemeral outage evidence is
   returned in the POST response without a renderer-issued county-FIPS URL.

The recommended product scope is full browser plus full macOS desktop. A
privacy-stricter alternative is desktop-only; choose that only if coordinates
must never traverse the hosted Crystal Ball API.

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

Repository analysis, architecture review, Tauri security review, and sidecar
review are complete. Their blocking findings are incorporated into the proposed
approval design above.

## Implementation evidence

- The complete agentic validation gate passed on 2026-08-29 with
  `test:ux010`, Lifelines, Lifelines map/grid, sidecar, Emergency Pack,
  Emergency Readiness, and Home Shell suites. Full, tech, finance, and happy
  production builds also passed.
- Exact mutation transcripts, including checksums, confirmed diffs, green/red
  counts, failing assertions, and restored-clean results, are committed in
  `docs/validation/UX-010-MUTATION-PROOFS.md`. Live ODIN, deterministic browser
  success-path, teardown, and packaged-mac evidence are committed in
  `docs/validation/UX-010-LIVE-RUNTIME-EVIDENCE.md`.
- The packaged full macOS app built successfully with the stable `Crystal Ball
  Dev` identity and hardened runtime. The exact Location-only `tccutil` reset
  is unsupported on this Mac, so no broader permission reset was substituted
  without separate human approval.
- A live ORNL ODIN probe on 2026-08-29 selected FIPS `37037` from a 100-row
  unfiltered response (`total_count: 313`), then queried
  `where=communitydescriptor="37037"`. The filtered response contained one row,
  reported `total_count: 1`, and every returned `communitydescriptor` matched
  `37037`. The response supplied every consumed field:
  `communitydescriptor`, `metersaffected`, `county`, `state`,
  `customersrestored`, `name`, and `utility_id`.
- Independent review found and the implementation corrected accepted-snapshot
  teardown retention, globally expanded saved-place radius presets, ODIN page
  count divergence, duplicate fallback IDs, and anchor-derived response
  distances. Focused regression tests and production mutation proofs cover the
  repaired boundaries.
- Clean-tip production mutation proofs were rerun against implementation commit
  `67762328d20aad97021ea476fa7622eda16b844c`:
  - native deadline: `LOCATION_DEADLINE_MS` changed from `15_000` to `10_000`;
    the confirmed diff changed `current_location.rs`, and the Rust contract
    changed from `9 passed / 0 failed` to `8 passed / 1 failed` at
    `the_native_deadline_is_exactly_fifteen_seconds`. The restored checksum was
    `595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`.
  - browser one-shot policy: `maximumAge` changed from `0` to `1`; the confirmed
    diff changed `location.ts`, and the focused suite changed from
    `8 pass / 0 fail` to `7 pass / 1 fail` at `browser acquisition is one-shot,
    uncached, and uses the fixed platform policy`. The restored checksum was
    `0ec0394277cc3551a1272566c40d8933eded997b1fadbcb5ea4dcbea9df2871b`.
  - renderer transport: the ephemeral request method changed from `POST` to
    `GET`; the confirmed diff changed `local-logistics.ts`, and the focused
    suite changed from `11 pass / 0 fail` to `9 pass / 2 fail` at the exact POST
    and HTTP-failure-class assertions. The restored checksum was
    `ab4a20bf45d2210e65bfc7d4ebc21f3badb0b961c8a5c8f5dfdf307cacae9bd1`.
  - sidecar streaming enforcement: its route-specific input ceiling changed
    from `2,048` to `128` bytes; the confirmed diff changed
    `local-api-server.mjs`, and the focused HTTP route suite changed from
    `1 pass / 0 fail` to `0 pass / 1 fail` because the valid session body
    returned `413` instead of `200`. The restored checksum was
    `03e8dc442029cb54bace9896042163c11dfc08c9e67b02b416e5a7f55e1c8882`.
  - panel teardown: the current-location `snapshot = null` scrub was removed;
    the confirmed diff changed `LocalLogisticsPanel.ts`, and the focused
    teardown test changed from `1 pass / 0 fail` to `0 pass / 1 fail` because
    the accepted session snapshot survived destruction. The current-tip
    restored checksum is
    `0460be64bc4b124ea81a852ff8bb8b3f2b4e4c7185b0acd2f0ddd3da77eaab93`.
  - saved-place isolation: ordinary create/edit was forced to use conversion
    radii; the confirmed diff changed `SavedPlaceModal.ts`, and the focused
    test changed from `1 pass / 0 fail` to `0 pass / 1 fail` because `5`, `10`,
    and `25` appeared outside conversion. The current-tip restored checksum is
    `22b57b7d7d0f85d580a1fd605bf7e62a265531530a84d28fa365c66aa2a00a12`.
  - cancel-time scrub: the conversion-specific close scrub and hidden-overlay
    rerender were removed; the confirmed diff changed `SavedPlaceModal.ts`,
    and the focused test changed from `1 pass / 0 fail` to `0 pass / 1 fail`
    because `formState.lat` remained `"0"` instead of becoming empty. Restore
    reproduced the same current-tip checksum as saved-place isolation.
  Every mutation was applied with a visible diff, restored with the original
  checksum, and followed by an empty `git status --short` before the next one.
- Packaged-mac runtime verification first showed the same behavior with the
  existing Location authorization. After explicit human approval, Crystal Ball
  was quit and `/usr/bin/tccutil reset All com.bradleybond.crystalball`
  reported a successful bundle-wide reset. Relaunch again showed no startup
  prompt, and the explicit click produced a real result with
  `ACCURACY 40 M`, an observed timestamp, and `SESSION ONLY`, responsive panel
  controls, successful Clear Location back to the saved Home anchor, and no
  current-location anchor after quit and relaunch. Crystal Ball and sidecar logs
  contained no current-location coordinates or local-logistics request data.
  macOS still showed no fresh Location prompt after the successful bundle-wide
  reset, so the permission-row reset itself cannot be claimed: this host's
  unsupported Location-only reset and retained Location behavior prevent a
  definitive first-grant prompt observation without privileged locationd state
  repair. The verified product property is that startup never prompted and the
  acquisition occurred only after the explicit action.
- Initial in-app browser inspection showed no pre-click geolocation prompt, the
  complete one-shot/session-only/provider-access-log disclosure, and no
  location or local-logistics console entries before consent. That runtime did
  not provide a fix and reached the fixed coordinate-free 15-second timeout.
  A subsequent deterministic Chromium run used a fresh context, granted
  geolocation permission, and the synthetic public test coordinate
  `41.8781, -87.6298`. Before the click it captured zero Lifelines requests.
  After the explicit action it captured exactly one same-origin POST whose URL
  contained no coordinates and whose referrer was absent; the real sidecar
  returned `200` and `cache-control: private, no-store`. The panel reached
  `SESSION ONLY`; raw coordinates appeared in neither the panel nor console.
  Clear restored consent, reload did not restore the anchor, and post-clear DOM
  and browser storage contained no raw coordinate. The exact runtime transcript
  and test-adapter boundary are recorded in
  `docs/validation/UX-010-LIVE-RUNTIME-EVIDENCE.md`.

## Rollback

The implementation must remain additive and removable without migrating saved
places or offline artifacts. Rollback removes the ephemeral mode and returns
the panel to saved-place-only behavior without touching existing stored data.
It must retain the privacy hardening that removes browser startup acquisition,
the macOS setup-time permission request/retained manager, and inaccurate TCC
copy; rollback may not restore any automatic prompt or acquisition path.
