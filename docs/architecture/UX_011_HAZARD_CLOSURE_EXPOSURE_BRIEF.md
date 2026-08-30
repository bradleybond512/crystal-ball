# UX-011 Hazard and Closure Exposure Feature Brief

Status: discovery and design; production implementation awaits human approval
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

## Unknowns for discovery

- Which current NWS and IPAWS normalized geometry carries sufficient coverage,
  lifecycle, and expiry evidence for route or site intersection.
- Which route and site models expose stable geometry without coupling hazard
  evaluation into route computation.
- Whether existing map, Lifelines, place brief, or route UI has the narrowest
  truthful evidence surface.
- How jurisdiction and feed coverage are represented today, especially for a
  valid empty result.
- Which existing tests and validation scripts cover geometry, routing,
  freshness, accessibility, and provider health.

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

This brief claims UX-011 for discovery and design only. The concrete approved
design will be added here after repository analysis and architecture review.
Production code remains unchanged until the human explicitly approves that
specific design.
