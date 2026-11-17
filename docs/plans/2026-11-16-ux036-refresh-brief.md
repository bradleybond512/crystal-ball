# UX-036 — bounded refresh scheduling brief

Status: test-only design, documentation draft claim and local implementation
approved November 16. Publish the draft before implementation. High Assurance,
Priority B. Canonical main `ffb3f3ccb4`; fresh live
claims select UX-036 after all eligible S/A tasks are claimed or non-TODO.

## Goal and acceptance

Measure synchronized refresh work and propose the smallest useful staggering
change using existing scheduling conventions. Honor existing battery policy
without increasing maximum warning-detection latency or weakening foreground
recovery. Preserve source health, freshness, dependencies and lifecycle cleanup.

Acceptance requires measured baseline/comparison evidence, deterministic behavior
tests with applied/restored mutation proofs, targeted checks and the repository
validation gate, independent Sol/Sonnet review and separately approved hosted
publication. Distinguish fixture scheduling evidence from live power savings or
packaged warning latency; leave unverified acceptance open.

## Constraints and non-goals

No blanket off-screen acquisition suspension; no change to notification policy,
warning eligibility, provider parsing, prediction logic or delivery settings.
No new dependencies, native execution, real user data, live app launch or power
control. Merging, auto-merge, releases, deployment and installation stay paused.
Do not absorb existing held PRs or their incomplete acceptance into this claim.

## Discovery, design and unknowns

Repository analyst owns read-only tracing of polling/refresh registration,
battery/visibility policy, timing boundaries and existing tests. Architect owns
the bounded proposal, owners/file scope, timing invariants, cancellation and
foreground behavior, measurement plan, failure paths and rollback.

Resolve which loops synchronize in practice; which are safety-sensitive; where
battery state is already available; whether policy is wired or only represented;
and which deterministic harness can measure start-time concentration. Do not
claim energy or rendering-cost improvements from source counts alone.

Parent integrates the design and asks for the concrete policy and claim approval
before delegating production implementation.
