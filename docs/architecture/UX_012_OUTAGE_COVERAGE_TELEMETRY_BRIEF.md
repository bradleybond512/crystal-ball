# UX-012 Outage Coverage and Provider Telemetry Feature Brief

Status: complete
Risk: standard / medium
Affected variant: full (`local-logistics` is not enabled in tech, finance, or happy)
Roadmap task: UX-012

## Objective and analyst value

Make the outage evidence already available from ODIN and provider health
inspectable without overstating coverage or corroboration. An analyst should be
able to see what geography and time a claim covers, which exact source produced
it, and how many provider rows were accepted, dropped, and contributed.

## Acceptance criteria

- Surface an outage coverage matrix from existing normalized ODIN and provider
  health data; do not add another provider or network origin.
- Identify the exact source behind every displayed outage claim.
- Show final contributed and dropped row counts with observation time and
  expiry. Label the pre-reconciliation accepted count explicitly unavailable
  because the current normalized snapshot does not retain it.
- Distinguish covered geography from unknown geography. Uncovered or empty data
  must never render as zero outages.
- A provider with zero valid contributed observations must not appear healthy
  or count as corroboration.
- Keep provider schemas and health normalization outside presentation code.
- Add behavior-focused tests first and retain observed-red or mutation-proof
  evidence for every changed behavior.
- Update the UX-012 Progress Tracker row in this pull request.

## Constraints and invariants

- Preserve the `local-logistics` panel identity and existing Lifelines storage,
  routing, and Emergency Pack contracts.
- Reuse existing ODIN and provider-health evidence only.
- Do not sum overlapping providers or infer facility-level power from
  county-level outage data.
- Unknown, stale, malformed, dropped, or uncovered data fails closed to
  unknown.
- No new dependency, sidecar route, allowlist, secret, Tauri permission,
  provider, cross-provider reconciliation, or storage migration.
- Preserve unrelated worktree changes and all existing feature variants.

## Non-goals

- Adding a new outage source; that belongs to UX-015.
- Forecasting restoration time or outage trajectory.
- Declaring a facility powered, unpowered, safe, open, or reachable.
- Reconciling or summing overlapping outage providers.
- Changing route, map, Emergency Pack, alert, or notification behavior.

## Architecture and control flow

The active path remains panel-owned and unchanged through normalization:

```text
exact saved place
  -> local-logistics county resolution
  -> exact-FIPS ORNL ODIN request
  -> strict schema-v2 normalization and reconciliation
  -> LocalLogisticsSnapshot
  -> pure outage coverage projection
  -> accessible Disaster Lifelines evidence tables
```

The additive presentation projection consumes only the validated snapshot. It
preserves each current or expired ODIN report independently, including exact
FIPS, county and state, optional utility identity, retrieval time, optional
source-observation time, expiry, and customer count. It never reads provider
payloads, performs a fetch, or serializes new state.

Provider retrieval telemetry continues to expose the post-reconciliation
contributed and dropped rows. The upstream accepted count is not reconstructible
after reconciliation and is therefore displayed as unavailable rather than
being relabeled from contributed rows. ODIN remains single-source context, not
corroboration, county-total coverage, or facility power evidence.

Fresh empty ODIN evidence becomes unknown because no valid outage row
contributed. This rule is ODIN-specific: complete bounded OSM and FEMA empty
responses retain their existing facility-directory semantics.

## Discovery decisions

- Existing `ProviderStatus` retains final contributed rows in `acceptedRows`
  and folds reconciliation loss into `droppedRows`; distinct upstream accepted
  rows are not retained.
- Existing `AreaCondition` already carries exact geography, fixed source,
  optional utility identity, retrieval, optional source observation, and exact
  expiry.
- The narrow implementation boundary is the pure projection, the Disaster
  Lifelines renderer, bounded responsive styles, and focused tests.
- No active ODIN corroboration vote exists, so the UI must state that the
  evidence is single-source rather than imply a second-source health count.

## Main risks

- False coverage from treating an empty or uncovered response as a measured
  zero.
- Phantom corroboration from counting a provider that contributed no accepted
  observations.
- Stale evidence presented without its observation time or expiry.
- Presentation code drifting into provider-specific schema interpretation.
- Excess render work if matrix derivation is repeated in a hot UI path.

## Expected evidence

- Repository analysis tracing ODIN normalization, provider health, Lifelines
  domain state, and the rendered panel.
- Architecture review covering data flow, truth states, errors, degraded modes,
  performance, tests, and rollback.
- Per-behavior observed-red or mutation-proof transcripts.
- Targeted outage/Lifelines tests and the full agentic validation gate.
- Independent read-only review and an exact-tip Claude verdict before closeout.

## Completion evidence

- Domain projection mutations: 25 killed, 0 survived, including the
  missing-retrieval fail-closed guard.
- UI mutations: 30 killed, 0 survived, including a direct aggregation mutant
  that collapsed two reports into one summed claim.
- The Lifelines and Lifelines-grid suites, full agentic validation gate,
  type checks, secret scan, documentation checks, and production build passed.
- Independent review concluded with zero blocking findings after the two
  confirmed findings were repaired and revalidated.

## Rollback

Rollback removes the additive telemetry derivation and its presentation while
leaving existing ODIN normalization and Lifelines behavior unchanged. No stored
data or provider contract requires migration.
