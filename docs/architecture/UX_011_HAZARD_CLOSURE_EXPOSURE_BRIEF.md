# UX-011 Hazard and Closure Exposure Feature Brief

Status: task-specific design approved by the human on 2026-08-29; production
implementation in progress
Risk: high assurance / safety-critical reasoning and provider boundaries
Roadmap task: UX-011
Affected variants: full; exact route and panel surfaces to confirm in discovery

## Objective and analyst value

Show whether current, explicitly covered hazard or closure evidence reports an
impact on a site or route without turning missing, stale, incomplete, or
out-of-jurisdiction data into a claim that the site or route is safe, clear, or
open.

## Acceptance criteria

- Keep route computation separate from hazard and closure evidence.
- Report only a covered current intersection or impact, no reported
  intersection within explicitly named current feed coverage, or unknown.
- Start with existing allowlisted NWS and IPAWS geometry only where its
  jurisdiction and coverage apply.
- Expose exact source, coverage, observation time, retrieval time, and expiry
  behind each hazard or closure statement.
- Fail closed to unknown for missing, stale, malformed, dropped,
  out-of-jurisdiction, or coverage-ambiguous evidence.
- Never label a site or route safe, clear, open, passable, or reachable from
  missing or non-intersecting data.
- Add behavior-focused tests with observed-red or mutation-proof evidence for
  every changed behavior.
- Update the UX-011 Progress Tracker row in this pull request.

## Constraints and invariants

- No production implementation begins until repository discovery, architecture
  design, and explicit human approval of that concrete design are complete.
- Preserve existing routing calculations and navigation-provider contracts.
- Provider schemas remain outside presentation components.
- External data is validated and normalized at its provider boundary with
  exact allowlists, bounded work, explicit freshness, and truthful
  contribution health.
- No new dependency, secret, Tauri permission, storage migration, alert, or
  background poller without separate design justification and approval.
- Do not add a 511 or WZDx jurisdiction in this task without a live response
  body probe, usage-rights review, and separate approved scope.
- Preserve unrelated user work and all existing app variants.

## Non-goals

- Computing or recommending a route based on hazard evidence.
- Declaring any site, road, corridor, or route safe, open, clear, passable, or
  reachable.
- Predicting hazard movement, closure duration, or reopening time.
- Combining independent sources into a safety score or corroboration count.
- Adding broad national 511/WZDx coverage or scraping unapproved sources.

## Discovery findings

- The accepted `EvacRoute` shown by `EvacuationPanel` is the narrowest stable
  route surface. Hazard evaluation can consume it without changing OSRM route
  computation, selection, storage, or map rendering.
- `fetchWeatherAlertsWithFeedState()` already returns normalized NWS alerts and
  their fetch-bound currentness state atomically. The evaluator must consume
  that exact pair rather than a visual-overlay feed or an unrelated cache time.
- NWS `/points/{latitude},{longitude}` proves NWS jurisdiction for one endpoint
  only. It cannot prove coverage along the route corridor.
- The current IPAWS aggregate is not usable evidence for this task: it reduces
  NWS geometry to centroids, mixes FEMA declarations, and lacks the lifecycle,
  expiry, geometry, and jurisdiction proof needed for an intersection claim.
- There is no approved closure source. An NWS hazard is not road-closure
  evidence, so closure remains unknown.
- A live read-only probe of `https://api.weather.gov/alerts/active` returned 271
  rows: 270 Actual and one Test; 203 Alert and 68 Update; all supplied sent,
  effective, and expiry times; 27 carried polygon geometry. A point probe at
  `https://api.weather.gov/points/41.6,-86.7` returned forecast zone INZ103,
  county INC091, and CWA IWX. These results require explicit Actual/message-type
  allowlists, effective-time fallback when onset is absent, and UGC endpoint
  evaluation for geometry-free alerts.

## Approved-design candidate

The first slice is session-only and NWS-only. It evaluates current, Actual,
Severe or Extreme NWS alerts against an accepted evacuation route and its A/B
endpoints. It does not change routing, recommend a route, add a provider, or
infer closures.

### Truth states and precedence

Route truth is either `reported_intersection` or `unknown`:

1. A current NWS polygon that contains a route vertex or crosses/touches a
   route segment produces `reported_intersection`.
2. Every other route result is `unknown`, even when both endpoints have current
   covered negatives, because endpoint jurisdiction does not prove corridor
   coverage.

Endpoint truth is `reported_intersection`, `no_reported_intersection`, or
`unknown`:

1. A current polygon match or matching UGC zone produces
   `reported_intersection`.
2. A current feed, successful NWS point-jurisdiction lookup, complete bounded
   evaluation of every relevant alert, and no match produces
   `no_reported_intersection`.
3. Missing, stale, future, expired, malformed, over-limit,
   out-of-jurisdiction, or otherwise incomplete evidence produces `unknown`.

Closure truth is always `unknown` because no closure feed is configured. A
valid positive found from one alert survives an unrelated unevaluable alert,
but that unevaluable alert prevents every negative conclusion it could affect.

### Exact presentation language

- Route positive: **Reported NWS alert-area intersection** — “NWS reports
  {event} intersecting this graph route.”
- Route non-positive: **Route hazard exposure unknown** — “Current NWS coverage
  was not proven for the full graph route.”
- Endpoint positive: **Reported NWS impact at endpoint {A|B}** — “NWS reports
  {event} by {alert polygon|UGC zone CODE}.”
- Endpoint covered negative: **No reported NWS Severe/Extreme alert
  intersection at endpoint {A|B}** — “Within current NWS point jurisdiction as
  of {retrieved time}. This point check does not cover the route corridor.”
- Endpoint unknown: **Endpoint {A|B} hazard exposure unknown**, followed by one
  bounded reason: feed not current, jurisdiction unknown, alert unevaluable, or
  evaluation limit.
- Closure: **Road closure evidence unknown** — “No closure feed is configured.”
- Mandatory disclosure: **Hazard evidence does not verify road closure,
  passability, reachability, or route safety.**

Evidence details name National Weather Service active alerts and show the
reported, effective/onset, retrieved, and expiry times plus the polygon or UGC
coverage basis. Presentation never uses safe, clear, open, passable, reachable,
or similar terms as affirmative claims.

### Provider and lifecycle contract

- Extend the existing NWS boundary normalization with exact recognized CAP
  status and message-type allowlists. Retain only `Actual` products and only
  `Alert` or `Update`; an unrecognized or missing value fails the feed closed.
- Require bounded identifiers, event text, severity, sent, effective, and
  expiry for retained products. Onset is optional; effective is its currentness
  fallback.
- Only Severe and Extreme products enter this evaluator. Moderate, Minor, and
  Unknown severities remain out of scope because the existing display cap does
  not prove a complete negative for them.
- Evidence is current only when the paired feed state is fresh, its retrieval
  time is finite and not future, the alert is effective, and expiry is strictly
  after evaluation time. Stale positive evidence is not shown as current.
- `/points` 404 means outside NWS point jurisdiction and therefore unknown.
  Timeout, network failure, malformed HTTP 200, or invalid zones are unknown.
- The loader publishes the exact `{ alerts, feedState }` snapshot after an
  atomic fetch and publishes unavailable on outer failure so old evidence
  cannot remain current.

### Geometry and bounded-work contract

- Preserve Polygon and MultiPolygon holes in the evidence model while keeping
  the existing outer-ring representation for legacy consumers.
- Validate every coordinate with explicit finite range checks; zero latitude or
  longitude is valid. Rings are all-or-nothing and implicitly close when
  necessary.
- Count boundary contact, route vertices inside an alert area, and route
  segment/outer-boundary crossings as intersections. Subtract holes; a route
  entirely inside a hole is not an intersection, while crossing a hole boundary
  into the alert area is.
- Unwrap adjacent longitudes to their shortest continuous arc and shift polygon
  copies by 360 degrees into the route segment's frame. Ambiguous or non-finite
  antimeridian work fails to unknown.
- Use bounding boxes before exact inclusive orientation/on-segment tests. Never
  use vertex-only matching, sampling, or truncation to infer a miss.
- Enforce deterministic limits: 100,000 route coordinates, 500 relevant alerts,
  128 polygon areas, 512 rings, 50,000 vertices, and 2,048 validated UGC codes
  per alert; 500,000 exact geometry operations per route; 100,000 endpoint
  point-in-polygon operations; and 2,000,000 operations across at most ten
  cached routes per panel refresh. Exceeding a limit produces unknown.
- Recompute only on route generation, weather generation, endpoint-zone
  completion, or an expiry transition; never in a render loop.

### Session orchestration, privacy, and accessibility

Add a bounded weather-domain evaluator and session snapshot store. The loader
publishes normalized snapshots; `EvacuationPanel` resolves A/B zones, evaluates
accepted routes, and renders normalized results. Raw provider JSON never enters
the component.

Each asynchronous lookup captures the weather generation, panel route
generation, exact canonical route fingerprint, and endpoint coordinate keys.
All must still match before applying the result. Destroy increments generation
and unsubscribes. Fingerprints and coordinates are never logged, persisted, or
sent to telemetry.

The evidence block is a labelled section with visible source/time/coverage
text, non-color-only meaning, and polite live status. User-actionable failures
alone may use alert semantics. Route controls remain keyboard operable and keep
focus across asynchronous refresh.

### Exact implementation boundary

Production scope:

- `src/services/weather.ts`
- `src/services/weather/evacuation-hazard-exposure.ts` (new)
- `src/services/weather/saved-place-adapter.ts`
- `src/app/data-loader.ts`
- `src/components/EvacuationPanel.ts`
- `src/styles/main.css`

Test and evidence scope:

- `src/services/weather/__tests__/weather-alerts-parse.test.mts`
- `src/services/weather/__tests__/evacuation-hazard-exposure.test.mts` (new)
- `src/components/__tests__/evacuation-hazard-exposure-panel.test.mts` (new)
- `tests/evacuation-hazard-exposure-wiring.test.mjs` (new)
- `package.json` for `test:ux011` only
- `docs/validation/UX-011-MUTATION-PROOFS.md` (new)
- this brief and the UX-011 tracker row

Explicitly excluded are `evacuation-router.ts`, MapContainer and both map
renderers, all sidecar/Tauri/API routes, route/place storage, targeted-test
infrastructure, new dependencies, new permissions, telemetry, alerts, 511,
WZDx, IPAWS, and scoring.

## Implementation and verification plan

1. Extend the existing NWS provider contract and parser tests with lifecycle,
   status/message allowlists, holes, and bounded geometry/UGC data while
   preserving legacy consumers.
2. Build the pure bounded evaluator test-first, covering route and endpoint
   truth precedence, segment crossings, holes, antimeridian handling,
   currentness, operation limits, and endpoint coverage.
3. Publish the paired session snapshot and add panel orchestration and
   accessible presentation, including stale asynchronous-result rejection.
4. Record observed-red tests and per-behavior mutation proofs for status,
   freshness, segment crossing, holes, antimeridian, UGC matching, forced route
   unknown, endpoint completeness, operation limits, stale generations,
   escaping, and unavailable publication.
5. Run `test:ux011`, `test:weather`, `test:providers`,
   `test:lifelines-map`, `test:agentic-pipeline`, and the full agentic validation
   gate. Then obtain independent review, exact-tip Claude review, a SHA-pinned
   verdict, and PR closeout.

No schema migration or persisted state is added. Rollback is a single PR
revert; removing snapshot publication and the panel subscription restores the
current route-only disclosure without cleanup.

## Expected evidence

- Read-only repository analysis tracing route geometry, normalized hazard
  geometry, coverage/freshness, presentation boundaries, and tests.
- Architecture review covering truth-state schema, control flow, errors and
  degraded modes, security, performance, accessibility, tests, and rollback.
- A task decomposition with file ownership, dependencies, commands, non-goals,
  and expected evidence before implementation.
- Per-behavior observed-red or mutation-proof transcripts, targeted tests, the
  full agentic validation gate, independent review, and an exact-tip Claude
  verdict before closeout.

## Approval boundary

The human approved this specific first slice in direct response to the approval
request on 2026-08-29:

> I approve production implementation of the UX-011 first slice exactly as
> designed: session-only Actual Severe/Extreme NWS hazard exposure for accepted
> evacuation routes and A/B endpoints; polygon/UGC positives; endpoint-only
> covered negatives; route non-positives and all closure evidence remain
> unknown; no IPAWS, 511/WZDx, routing, map-renderer, persistence,
> provider-endpoint, sidecar, Tauri, dependency, permission, telemetry, or
> scoring changes.
