# UX-013 hotel operational evidence brief

## Objective

Make hotel results in Disaster Lifelines immediately actionable without
promoting directory data into live operational claims. Add a hotel operations
provider only if production access, display rights, cache rules, and a live
response-body probe can all be verified before implementation.

## User value

During disruption, a user should be able to identify a nearby lodging listing,
understand exactly what Crystal Ball does not know, and contact the property or
open it in maps without mistaking an OSM listing for proof of vacancy, power,
access, or present operation.

## Acceptance criteria

- OSM lodging remains directory-only and keeps operational, inventory, power,
  and access state `unknown`.
- Every hotel card and map popup identifies the evidence as directory-only and
  tells the user to confirm vacancy, power, and access directly.
- A hotel with a valid public phone exposes a click-initiated `Call to confirm`
  action. Every hotel retains `Open in Maps`; rendering alone never navigates.
- Missing phone data is explicit and never replaced with a guessed number.
- A credentialed operational provider is out of scope unless its production
  license permits the intended display and cache behavior and an authenticated
  live probe records the request shape, row count, consumed fields, timestamps,
  and expiry semantics.
- Focused tests prove hotel-specific disclosure/actions on both the panel card
  and map popup while preserving existing non-hotel labels and behavior.
- The UX-013 tracker row is updated in the completing PR.

## Constraints and invariants

- Never infer vacancy from a directory listing, opening hours, price, capacity
  arithmetic, an empty provider response, or HTTP 200.
- Never infer facility power or route access from county outage context, a
  provider listing, or missing reports.
- Preserve the schema-v2 separation between stable sites and expiring
  observations, exact provider attribution, bounded external navigation, and
  existing phone sanitization.
- Preserve the saved-place and session-only Lifelines modes, offline snapshot
  semantics, map validation boundary, and current provider health accounting.
- Add no dependency, route, secret, provider identifier, cache entry, or health
  vote for the honest-fallback implementation.
- Work remains High Assurance because the UI is used for crisis lodging
  decisions and a false positive can misdirect a user.

## Non-goals

- Booking, payment, price comparison, recommendations, or affiliate commerce.
- Claiming that a property is safe, reachable, powered, staffed, open, or has a
  room available.
- Reclassifying FEMA recovery centers or shelters as hotels.
- Adding fuel evidence, which remains UX-014.
- Treating test or sandbox inventory as production evidence.

## Provider discovery

- Booking.com Demand API exposes real-time accommodation availability only to
  authenticated Affiliate Partners. Its documentation says availability and
  pricing must not be cached and final availability must be confirmed again.
- Expedia Rapid Lodging requires approved partner access, signed credentials,
  launch review, and a production-enabled key.
- Amadeus Self-Service Hotel Search documents real-time production offers, but
  production use requires credentials and provider-specific legal terms; the
  test environment is limited and cached.
- FEMA Transitional Sheltering Assistance directs eligible survivors to its
  hotel locator. It is not a public facility-level vacancy or operations feed.
- No Booking.com, Expedia, Amadeus, or other hotel-production credential is
  configured in this repository or current runtime environment, so an
  authenticated live body probe cannot be produced for this task as scoped.

Primary references:

- <https://developers.booking.com/demand/docs/accommodations/about-accommodation>
- <https://developers.booking.com/demand/docs/migration-guide/v3/migration-faqs>
- <https://developers.expediagroup.com/docs/products/rapid/setup/getting-started>
- <https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/resources/hotels/>
- <https://amadeus4dev.github.io/developer-guides/test-data/>
- <https://www.fema.gov/sites/default/files/documents/fema_tsa_qrg_20241009_final.pdf>

## Architecture decision

Use the roadmap's honest fallback and reject an operational-provider adapter
for this task. Make existing OSM hotel rows explicit and actionable without
promoting them into operational evidence. A provider remains a separate future
High Assurance design that requires production credentials, written display
and cache permission, and authenticated live-response evidence.

The exact presentation predicate is:

```ts
node.category === 'hotel'
  && (node.directoryOnly || node.verification === 'directory')
```

Provider names and source strings must not determine the presentation state.
The shared disclosure is:

> Directory listing only. Vacancy, current operation, power, and access are
> unknown. Confirm directly with the property before relying on it.

Expired evidence composes this disclosure with the existing expiry warning; it
does not replace the disclosure or strengthen any state.

## Approved implementation boundary

- Add the hotel-directory predicate and shared disclosure at the existing
  presentation boundary in `disaster-lifelines-map-helpers.ts`.
- In `LocalLogisticsPanel`, render the disclosure, fail closed to four `unknown`
  states for directory or expired hotel evidence, retain source and expiry, and
  display `Retrieved <time>` from `retrievedAt ?? observedAt`.
- In `MapPopup`, mirror the disclosure and fail-closed status projection while
  retaining source, retrieval time, expiry, maps, and road-status context.
- When the existing bounded phone allowlist produces a callable number, label
  the hotel action `Call to confirm` and give it an accessible name that states
  vacancy, current operation, power, and access. For a missing or malformed
  phone, show `No callable public phone published.`, omit the call control, and
  retain `Open in Maps` and `Source`.
- Preserve the generic `Call` label and current presentation for non-hotels.
- Keep rendering inert. Calls and external navigation remain explicit-click
  effects through the existing handlers.

No schema, API, sidecar, Tauri, provider ID, health, cache, offline snapshot,
credential, settings, dependency, or CSS change is permitted by this design.

## Test-first plan and mutation proofs

Focused tests will cover hotel cards and popups with valid, missing, and
malformed phones; adversarial directory rows that contain stronger raw states;
expired hotel evidence; preserved actions and provenance; and unchanged
non-hotel behavior.

Mutation proofs will independently revert and prove the tests detect:

1. hotel disclosure selection;
2. fail-closed directory status projection;
3. hotel-only call labeling;
4. missing-phone disclosure; and
5. panel retrieval-time rendering.

Each proof will record the checksum, confirmed applied diff, exact failing
assertion and numeric red/green counts, restored checksum, and clean status.

## Rollout and rollback

Ship as one UX-013 PR with no feature flag or migration. Rollback is a normal
revert of the presentation, tests, and tracker changes; persisted data and
schema remain untouched and compatible.

## Stop conditions for any future provider

Stop before production implementation unless all of the following exist:

- production credentials and explicit approval for their handling;
- written display, attribution, retention, and cache permissions;
- authenticated live-body evidence with a redacted request, row count,
  consumed fields, timestamps, expiry, pagination, and empty/error shapes;
- a design separating no-cache evidence from persisted Lifeline snapshots when
  the provider terms require it;
- stable facility identity and allowlisted operational fields;
- bounded timeout, retry, rate-limit, and expiry behavior;
- health derived from accepted adapter output rather than HTTP success; and
- a new High Assurance design approval for every route, secret, provider ID,
  schema, cache, or health-boundary change.

## Expected evidence

- Focused panel and map-popup tests with a mutation proof for each hotel-specific
  behavior.
- Existing Lifelines data, API, map, and current-location suites.
- Full agentic validation with the exact test scripts named.
- Independent review and a real Claude exact-tip review.
- SHA-pinned verdict, PR closeout, and required GitHub checks.

## Unknowns

- Whether the user will later enroll in a hotel inventory partner program.
- Which provider contract would permit crisis-context display and the required
  no-cache or short-expiry behavior.
- Whether a future provider can report facility power or access independently;
  room availability alone cannot support those claims.

## Risk

High Assurance. The implementation must fail closed to directory-only unknown
status and direct confirmation. Production implementation remains paused until
the user explicitly approves the architecture decision and exact wording above.
