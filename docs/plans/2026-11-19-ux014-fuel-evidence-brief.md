# UX-014 — qualify operational fuel evidence

High Assurance provider task. Base `ffb3f3ccb4`; isolated
`codex/ux014-fuel-qualification` branch. Bradley approved the documentation-only
checkpoint publication and PR-link recording on November 19; [draft #1918](https://github.com/bradleybond512/crystal-ball/pull/1918)
records it. Production implementation still needs a concrete approved design.
All merge, auto-merge, release, deployment and installation holds remain.

## Objective and acceptance

Help users distinguish actual reported fuel conditions from directory listings.
Keep OSM directory-only. Qualify at most one official operational source before
designing an adapter: establish display/cache rights, actual response schema,
coverage, identity, observation and withdrawal semantics, freshness and expiry.
Prices, opening hours and missing reports must never establish availability,
power, access, queue conditions or station-wide inventory.

Source qualification must include actual public response-body evidence with
request URLs, counts and consumed fields. Any later implementation needs bounded
requests/cache, exact allowlists, malformed-response rejection and health derived
from usable adapter output, plus behavior tests and mutation proofs. Do not mark
UX-014 complete on fixtures or a directory presentation alone.

## Current evidence, unknowns and risks

The existing OSM path already preserves unknown operational facts. France's
official fuel feed is a candidate with fuel-specific shortage/non-distribution
records. Initial samples contain old temporary reports with blank end dates;
retrieval time is not a fresh confirmation. Clarify complete-snapshot semantics,
withdrawals, timestamp timezone, confirmation age and exact licensing before
claiming current shortage. One fuel type must not become station-wide inventory.
UK/NSW price APIs have not been qualified as operational sources.

## Owners, boundaries and non-goals

Repository analyst owns read-only path/claim discovery; architect owns the
source-qualification and freshness decision; parent owns brief, evidence and
publication coordination. A provider specialist would implement only after an
approved design and documentation claim. Independent reviewers audit the final
diff and evidence. No production edits, credential access, account creation,
dependency installation, live profile reads or app launch during qualification.
No hotel-provider scope, global coverage promise or inference from missing data.
The same evidence boundary must apply to web and desktop.

If no usable current-evidence contract is established, retain unknown and record
the precise unresolved requirement. Do not invent an adapter merely to close a
roadmap row. Planning rollback removes documents only; runtime/data stay intact.
