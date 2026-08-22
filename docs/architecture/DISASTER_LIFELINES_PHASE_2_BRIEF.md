# Disaster Lifelines Phase 2 Feature Brief

Status: approved core implementation, shadow-only
Risk: high assurance
Affected variant: full (`local-logistics` is not enabled in tech, finance, or happy)
Stable integration identity: `local-logistics` panel ID and local-logistics schema v2

Scope note: this brief records the bounded, additive domain-core slice that was
implemented first. The subsequently approved panel, map, routing, provider, and
runtime integrations are documented in `DISASTER_LIFELINES.md`; their presence
does not change the core truth invariants below.

## Objective and analyst value

Turn Disaster Lifelines from a nearby-resource directory into a truthful,
offline-capable decision substrate for derecho and other grid-down incidents.
Phase 2 first establishes pure facts, exact offline-pack readiness, bounded
county outage history, and inert change candidates. Later UI, routing, and
notification work can consume those contracts without repeating safety logic.

The core should help answer four questions without manufacturing certainty:

1. What is officially reported now?
2. What is only a directory listing or area-level context?
3. What changed since the prior accepted baseline?
4. Which exact saved-place query is actually ready offline?

## Acceptance criteria

- Derive a `LifelineSituation` and explicit `LifelineFact` records from the
  existing local-logistics schema-v2 snapshot with no fetches or side effects.
- Convert expired operational evidence to unknown at the expiry boundary.
- Keep OpenStreetMap evidence directory-only; it cannot establish operational,
  inventory, facility-power, or access status.
- Keep ODIN county outage data area-scoped; it cannot alter a facility's power
  fact.
- Retain capacity and population as separate numeric facts. A reported
  population below capacity cannot become an availability claim.
- Evaluate an offline pack only when its manifest and required artifacts match
  the exact query fingerprint. Same-place data from different coordinates,
  radius, categories, or limits cannot satisfy readiness.
- Distinguish an accepted ODIN row containing zero customers out from an empty
  response. Empty is unknown, never an inferred zero.
- Reject ODIN updates at or behind the accepted monotonic watermark, and bound
  retained samples by both count and age.
- Derive deterministic, bounded `LifelineChange` candidates in shadow only.
  An expired or disappeared FEMA record becomes unknown or coverage-lost,
  never an inferred closure.
- Cover these behaviors with focused tests that have observed-red evidence or
  an equivalent mutation proof.

## Constraints and truth invariants

- Preserve the stored panel ID `local-logistics`, visible Disaster Lifelines
  name, route, schema-v2 provider contract, and existing cache keys.
- This phase is additive. New contracts live under `src/services/lifelines/`.
- Missing, malformed, expired, directory-only, or uncovered data fails closed
  to unknown. Unknown is not an all-clear.
- FEMA disappearance is a collection fact, not a closed-shelter observation.
- OSM is a discovery source, not an operational source.
- County outage counts describe county coverage only, not an individual
  building's electricity.
- Capacity arithmetic cannot prove an available bed, room, fuel supply, or
  accessible route.
- Outage trend is descriptive (`worsening`, `improving`, or `steady`) and never
  a restoration forecast.
- No new runtime dependencies, network origins, storage migrations, Tauri
  permissions, or provider schemas are introduced by this core.

## Architecture and control flow

```text
local-logistics schema v2 snapshot
              |
              v
deriveLifelineSituation (pure, fail-closed)
       |                         |
       |                         +--> site and area LifelineFacts
       v
deriveLifelineChanges(previous, current)
       |
       +--> bounded shadow candidates only

exact query fingerprint + pack manifest
              |
              +--> readiness: ready / partial / expired / not-saved

normalized ODIN result
              |
              +--> monotonic, bounded history --> descriptive current state
```

Provider normalization remains at the existing provider boundary. The Phase 2
domain layer receives only normalized schema-v2 values and applies stricter
claim semantics. It does not make provider health votes or mutate snapshots.

## Non-goals

- Sending notifications, emails, SMS, push, sounds, or system alerts.
- Declaring a route safe, reachable, or clear of unreported closures.
- Live hotel vacancy, fuel inventory, shelter-bed availability, or facility
  electricity inference.
- Adding or changing FEMA, OSM, ODIN, road, map, water, or lodging providers.
- Rendering a new panel, map layer, timeline, or offline-pack UI.
- Changing `local-logistics` schema v2 or its panel ID.
- Predicting outage restoration time or correlating weather causally with an
  outage.
- Migrating existing offline cache records.

## Unknowns and follow-up decisions

- Which artifacts are mandatory for the first user-visible Emergency Pack by
  platform: lifelines, alerts, one or more routes, offline map, contacts, and
  communications plan are candidates.
- Which jurisdiction-licensed 511 feeds can provide route evidence and their
  geographic coverage gaps.
- What shadow thresholds suppress noisy county-outage deltas before any
  notification design is approved.
- Whether a future provider can supply field-level provenance for explicit
  shelter availability, distinct from capacity arithmetic.
- Retention policy for serialized outage history after privacy, disk-budget,
  and replay requirements are known.
- How the UI should explain source loss versus an explicit operational change.

## Risks and mitigations

- **False operational certainty:** status dimensions admit only current
  official evidence; directory, expired, and absent evidence become unknown.
- **Stale location reuse:** manifest and every required artifact are checked
  against the exact query fingerprint.
- **Async response regression:** a monotonic ODIN watermark rejects late
  responses before they can replace newer knowledge.
- **Unbounded local state:** outage history is capped by sample count and
  retention time; change output is deterministically capped.
- **Notification fatigue:** changes are inert shadow candidates with no
  dispatcher dependency.
- **Breaking the shipped feature:** Phase 2 is additive and leaves the existing
  schema, cache, panel, provider, map, water, and routing modules unchanged.

## Expected evidence

- Focused behavior tests for fact truth boundaries, exact-fingerprint
  readiness, accepted-zero versus empty-unknown ODIN behavior, late-response
  rejection, bounds, FEMA disappearance, and shadow-only changes.
- Targeted TypeScript checking of the new modules and tests.
- Repository validation gate when a complete dependency installation is
  available.
- Independent read-only review of the combined Phase 2 diff before publication.

## Rollback

The core is additive and not wired to notification or dispatch paths. Rollback
is removal of `src/services/lifelines/`, its focused tests, and this brief. No
stored data migration or provider-contract rollback is required.
