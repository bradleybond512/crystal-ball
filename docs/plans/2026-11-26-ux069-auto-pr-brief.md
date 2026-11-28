# UX-069 — accurate agent publication notices

High Assurance task; design and local implementation approved November 27, 2026. The reconciled roadmap selects UX-069 [C]
after UX-068 is claimed by draft #1924. Documentation draft publication is approved; final code publication remains
a separate decision.

Goal: make existing automation notices match the actual explicit draft-publication
path, without broadening Actions permissions or creating ready/auto-merge races.
Acceptance: reproduce the current warning from a recent authorized publication,
identify its exact source and permissions, and design the smallest correction
with behavioral checks and mutation evidence. Preserve SHA-pinned review and
protected closeout requirements, subject to the current explicit delivery holds.

Constraints/non-goals: no new automation, permissions, secrets, tokens, automatic
PR readiness or merge authority. No merging, auto-merge, release, deployment,
installation, cleanup or production-data action. Leave #1920's existing workflow
alone. The CI-policy approval label remains a separately explicit decision.

Unknowns: whether the warning is still emitted after manual draft publication;
whether PR existence is checked before creation; how failures are distinguished
from disabled repository permissions; existing tests and failure branches.

Owners: repository analyst traces the workflow, warning and tests read-only;
architect designs after discovery; parent captures live workflow evidence and
the reviewable plan. No production implementation before design approval.
