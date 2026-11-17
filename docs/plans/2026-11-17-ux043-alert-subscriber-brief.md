# UX-043 — alert subscriber efficiency brief

## Goal

Measure and reduce repeated alert subscriber scans while preserving every alert update, acknowledgment, pin change and failure isolation at full store capacity.

## Acceptance

- Trace the existing store notification contract and all subscribers before choosing the smallest change.
- Establish reproducible fixture baseline and candidate cost at full capacity; report deterministic operation counts separately from wall-clock measurements.
- Verify insert/update/remove, acknowledgment and pin transitions, subscriber failure, reentrancy and lifecycle behavior as applicable to the actual contract.
- Use focused behavioral tests and applied mutation proofs; run targeted checks, all type checks, the validation gate and independent Sol/Sonnet reviews.
- Keep full roadmap acceptance open unless measured evidence covers the stated contract and consumers.

## Constraints and non-goals

No alert policy, severity, eligibility, cooldown, delivery, persistence, provider or notification-permission changes. No app launch, live data, credentials, native execution or new dependencies. No merging, auto-merge, releases, deployment or installation. Publish the single-task documentation claim only after explicit approval and before production implementation.

## Unknowns and risk

Whether existing work already removes the scans; exact subscriber topology, mutation ordering and full-store cost; interactions with unmerged alert work. Although the overall roadmap item is Standard, this bounded change is High Assurance because it feeds correlation confidence. Bradley approved its design, documentation claim and local implementation on November 17. No timing or energy benefit is assumed.

## Selection

Fresh canonical main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. A complete live pull-request snapshot selects UX-043 [B] after excluding existing higher-priority claims, including UX-036 draft #1912. The existing UX-076 metadata mismatch (merged #1900 still marked IN REVIEW) needs the previously verified MONITOR correction, without claiming packaged acceptance.
