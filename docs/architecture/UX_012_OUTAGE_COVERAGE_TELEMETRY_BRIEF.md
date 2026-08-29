# UX-012 Outage Coverage and Provider Telemetry Feature Brief

Status: discovery
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
- Show accepted, dropped, and contributed row counts with observation time and
  expiry or an explicit unknown state.
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

## Unknowns for discovery

- The exact normalized provider-health fields and where accepted, dropped, and
  contributed counts currently live.
- The narrowest existing Lifelines surface for the matrix without duplicating
  provider logic in the view.
- Whether observation expiry is already explicit or must be derived from an
  existing timestamp and TTL contract.
- Which existing tests and fixtures best exercise empty, dropped, stale, and
  uncovered ODIN responses.

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

## Rollback

Rollback removes the additive telemetry derivation and its presentation while
leaving existing ODIN normalization and Lifelines behavior unchanged. No stored
data or provider contract requires migration.
