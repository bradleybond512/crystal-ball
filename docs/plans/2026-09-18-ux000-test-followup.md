# UX-000 packaged-test follow-up

Status: discovery; no production implementation.
Evidence: https://github.com/bradleybond512/crystal-ball/issues/1725
Base: 0634bff417c22f8f04540d3a9944e275b19dcac0.

## Goal

Explain and repair the zero-useful-card result observed in the completed clean-account test. Preserve truthful unknown/degraded states and distinguish data contribution from panel visibility. UX-000 remains open and UX-001 remains blocked.

## Acceptance criteria

- Trace exact Home/data-loader/panel readiness paths and reproduce each proposed defect with a focused test.
- Preserve actual local failures when unavailable cloud fallback cannot improve the result; do not infer this explains every provider failure.
- Require fresh packaged evidence after repairs before claiming useful zero-key coverage. The existing test profile is no longer pristine.
- Preserve bounded loading, explicit empty/fresh/stale semantics, local trust-token enforcement, endpoint restrictions, and existing credentials.

## Constraints and non-goals

One UX-000 claim per PR. No new provider, dependency, networking permission, credential change, scoring/classification change, personal-profile reset or test-account deletion. Keyless map and weather-to-unrest findings need separate bounded designs. Do not develop in the sync clone.

## Unknowns and risk

Unknown: whether missing panel reports reflect deferred rendering, missing adapters, or upstream failures; why retry feedback did not change; exact local errors behind fallback503. UI repair would be Standard. Runtime transport/security or prediction work is High Assurance and requires concrete design approval before implementation.

## Owners and validation

Repository analyst traces Home readiness and request fallback separately; architect designs the minimal confirmed repair; relevant specialist implements after applicable approval; independent reviewer audits final diff. Use focused behavior tests, mutation proof, typecheck:all, named agentic validation, real Claude review, and normal PR closeout.
