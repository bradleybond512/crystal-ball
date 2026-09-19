# UX-000 packaged-test follow-up

Status: Home-only implementation in draft PR #1726; final browser acceptance
blocked after two unsuccessful interaction repairs. Further remediation awaits
user authorization.
Packaged acceptance remains open.
Evidence: https://github.com/bradleybond512/crystal-ball/issues/1725
Base: 0634bff417c22f8f04540d3a9944e275b19dcac0.

## Goal

Explain and repair the zero-useful-card result observed in the completed clean-account test. Preserve truthful unknown/degraded states and distinguish data contribution from panel visibility. UX-000 remains open and UX-001 remains blocked.

## Acceptance criteria

- Trace exact Home/data-loader/panel readiness paths and reproduce each proposed defect with a focused test.
- Record the separate request-error preservation design; runtime transport is not changed in this Home-only PR.
- Require fresh packaged evidence after repairs before claiming useful zero-key coverage. The existing test profile is no longer pristine.
- Preserve bounded loading, explicit empty/fresh/stale semantics, local trust-token enforcement, endpoint restrictions, and existing credentials.

## Constraints and non-goals

One UX-000 claim per PR. No new provider, dependency, networking permission, credential change, scoring/classification change, personal-profile reset or test-account deletion. Keyless map and weather-to-unrest findings need separate bounded designs. Do not develop in the sync clone.

## Unknowns and risk

Unknown: whether missing panel reports reflect deferred rendering, missing adapters, or upstream failures; why retry feedback did not change; exact local errors behind fallback503. UI repair would be Standard. Runtime transport/security or prediction work is High Assurance and requires concrete design approval before implementation.

## Owners and validation

Repository analyst traces Home readiness and request fallback separately; architect designs the minimal confirmed repair; relevant specialist implements after applicable approval; independent reviewer audits final diff. Use focused behavior tests, mutation proof, typecheck:all, named agentic validation, real Claude review, and normal PR closeout.

## Confirmed Home-only repair design

Claim: PR #1726. Standard UI derivation change, no networking or prediction changes.

Home hides the panel grid and defers panel rendering. Current Deck derivation
checks first-render and panel-health status before contributor evidence, so the
same fresh positive observation can be useful only after a panel becomes visible.
Evaluate audited contributor evidence independently of rendering while preserving
explicit errors, unsafe/failing or disabled panel state. Keep hasRenderReport
factual; no-contributor cards retain conservative legacy behavior. Empty, stale,
future-dated and failed updates cannot establish useful coverage.

Retain the wording data contributor working now, not a claim that the entire
panel or domain works. Remove live-news/RSS and NWS/weather mappings: the mapped
feeds do not supply those panels. Retain only the five audited mappings for
earthquakes, economic, cyber threats, air quality and space weather.

Implementation owner: UI specialist; files deck-view.ts and its focused tests,
Home startup component tests and existing browser boot regression. Validation:
Home unit/component tests, real browser hidden-grid fixture, all type checks,
agentic gate, mutation proofs, independent review and Claude exact-tip verdict.
Rollback reverts the UI derivation and tests without storage migration.

This does not fix upstream fetch failures, add retry-progress UX, resolve keyless
map tiles or correct weather/civil-unrest classification. No packaged pass is
claimed until those relevant runtime cases are retested.

## Separate findings retained for follow-up

- Runtime discovery reproduced successful local 200 pass-through, but local 429
  with Retry-After becoming synthetic 503 when no cloud key exists; persistent
  401 and thrown transport errors are similarly masked. This is error masking,
  not proof that transport causes all provider failures. The bounded separate
  design preserves the original response/error when cloud fallback is unavailable
  while retaining authentication, local-only routes and existing retry behavior.
  High Assurance approval is requested separately before implementation.
- Default dark/light map styles in public/map-styles reference anonymous CARTO
  tile endpoints. CARTO now documents required keys and the API-key-required
  watermark ([provider notice](https://carto.com/basemaps/apikey/)). This supports
  the observed watermark; no provider integration, credential or caching change
  is included here. A keyless alternative must be evaluated against live bodies,
  attribution, traffic and offline rights before changing the map path.
- Weather/civil-unrest descriptions have a concrete investigation lead:
  SIGNAL_DOMAIN_MAP in situation-types.ts assigns generic convergence,
  keyword_spike and velocity_spike types to civil_unrest; situation-correlator.ts
  derives domain and causal-template matching from signal type. The matching
  unrest template contains the observed Brief unrest wording. This is not yet
  a replay of the recorded tornado/flood inputs or a complete scoring-impact
  assessment. Claim an accuracy task and obtain High Assurance design approval
  before changing this behavior.

## Review stop and next bounded cycle

See [validation and escalation](../validation/UX-000-HOME-CONTRIBUTOR-READINESS.md).
All 18 focused mutation checks caught their regressions, but the pinned unmutated
browser fixture failed its resized Open-button focus assertion. An open return
brief is visible in the failure capture; verify which modal owns focus before
changing production behavior. Two attempted interaction repairs were insufficient,
so do not remove assertions, mark this accepted, or start a third automatic repair.
The PR remains draft; the next cycle requires explicit user authorization.
