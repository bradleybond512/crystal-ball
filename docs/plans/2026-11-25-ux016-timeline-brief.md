# UX-016 — one timeline controller and explicit map cursor

High Assurance. Bradley’s November 25 instruction to finish the roadmap, after
the bounded design request, authorizes the draft claim and local implementation. Fresh branch `codex/roadmap-next-nov25` starts at
canonical main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`.

## Objective and acceptance

The live roadmap, reconciled with all 36 open main PRs and 83 referenced PRs,
selects UX-016 [C]; higher tiers have existing claims or unmet exit conditions.
Reconcile the stale merged UX-076 claim without claiming packaged acceptance.

Trace the mounted TimeScrubberHud, existing controllers, map cursor readers,
animation/polling ownership and UX-005 lens styling. Design one bounded owner of
time state, explicit live/historical behavior and a single composed opacity
contract. Avoid misleading replay or future-data claims; establish what retained
evidence actually supports before enabling a historical view. Remove redundant
loop ownership only where it exists. Preserve keyboard control and teardown.

## Constraints and non-goals

No merging, auto-merge, release, deployment, installation, app launch or installed
profile access. Separate dependency PR #1920 stays in its existing workflow per
Bradley's November 25 instruction. No new dependency, network provider,
credential, stored-data migration, notification policy, prediction calculation or
fabricated replay evidence. No second animation loop. Keep the full UX-016 exit
condition open if the chosen stage cannot establish it.

## Unknowns and risks

Determine active and unused time controllers, actual mounted consumers and
subscriptions, source time semantics and supported history, style composition,
world/map variants and test seams. Distinguish existing behavior from roadmap
assumptions. Historical filtering must not imply historical location or knowledge
at the selected time unless real evidence supports it. Identify races, expiry,
focus, hidden-tab and destroy behavior.

## Owners and validation plan

Repository analyst: read-only execution-path and test discovery. Architect:
bounded design, alternatives, schemas, lifecycle, performance, rollback and
truth boundaries. Parent: brief, roadmap reconciliation and reviewable design.
After approval, assign UI/map implementation and behavior/mutation tests to
separate specialists. Claim one UX-016 draft before implementation. Independent
Sol and actual Sonnet reviews precede any code publication request. Use fixtures;
run focused tests, type checks and the named validation gate. Manual installed
acceptance stays separate while holds apply.
