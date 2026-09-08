# UX-027 — Evidence-scoped Home reassurance

Status: approved by Bradley on 2026-09-07 ("do it"); implementation authorized.
Classification: High Assurance. Discovery and architect review are complete.
Baseline revalidated: canonical main `39b82aea5` after PR #1706 merged.

## Outcome

Home describes available reports honestly, preserves detected threats, and keeps
unknown coverage visible beside empty results. No current production input can
prove complete, fresh coverage for every saved place and relevant threat domain.
Consequently, this first implementation has no all-clear branch.

## Evidence and boundary

`HomeShellOverlay.ts` currently marks successful report recalculation with the
current time. `briefing-view.ts` equates empty matched impacts with “All clear
near your places” and absent recent events with “Nothing critical worldwide.”
Report calculation time does not establish source evidence age. Separate provider
readiness, snapshot timestamps, or posture cannot establish complete coverage.

NWS alert ingestion can filter/truncate an otherwise successful response; its
bare alert array carries no completeness contract. This task does not change that
provider, source voting, spatial matching, scoring, planned benefits, or forecasts.
ACC-107, ACC-108, and UX-026 retain their existing scopes and ownership.

## Proposed behavior

| Input | Home output |
|---|---|
| Empty personal report, saved places exist | “No personal impacts identified in available reports.” |
| No saved places, no matched impacts | “No saved places for a local assessment.” / “Add a place in Settings.” |
| Missing personal report | “Personal status unavailable.” |
| Positive personal impacts | Preserve severity, entries, order, actions, and links |
| Empty critical reports | “No critical items in available reports.” |
| Missing critical reports | “Critical reports unavailable.” |
| Positive critical reports | Preserve existing thresholds, sorting, deduplication, and links |
| Empty available digest | “No changes recorded in the available digest.” |
| Missing digest / fewer than two snapshots | Preserve unavailable treatment |

Personal and worldwide bands display: “Available reports only · coverage
unverified · evidence age unknown.” The digest displays: “Recorded changes only ·
source coverage and evidence age unverified.” All three bands remain visible;
empty states use neutral styling. Existing matched dependency exposures remain
visible even with zero saved places. Reuse Settings/source status for the next
step: “Review source status before relying on this summary.”

## Bounded implementation

- `src/services/home-shell/briefing-view.ts`: remove `allClear`/`allClearText`,
  rename monitored-place count to saved-place count, use an explicit evidence
  note instead of calculation-derived staleness.
- `src/components/HomeShellOverlay.ts`: remove the corresponding last-good
  calculation timestamps and collapsing all-clear branch; render evidence notes.
- Focused Home projection and DOM tests, UX tracker, validation evidence.

Keep `generatedAt` solely as calculation time. Add no synthetic complete flag,
new provider calls, refresh timers, persisted schema, or compatibility adapter.
The projection stays pure and bounded with existing entry caps.

## Approved acceptance clarification

Replace UX-027's proposed “fresh complete” fixture requirement with: freshly
generated reports still yield unverified coverage; verified complete coverage is
unsupported until a separately designed production producer exists. A fixture
must not pretend that production possesses a coverage guarantee it lacks.

## Tests, review, and manual evidence

Test empty reports across healthy/degraded/offline surrounding conditions;
repeated recalculation cannot refresh evidence age. Distinguish zero places,
missing reports, and empty reports. Preserve positive threats and worldwide
separation. Prove planned benefit/posture cannot increase reassurance. DOM tests
must retain all evidence notes.

Record clean-tree mutation proofs for unqualified empty wording, hidden notes,
calculation-as-freshness, and removal of the zero-place guard. Run Home, survival,
renderer, type checks, agentic validation, and the unchanged bundle budget.
Require independent review and the actual opposite-agent SHA-pinned verdict.

Before acceptance, record a packaged build SHA/version and verify zero-place
startup, a saved place, offline restart, failed refresh, a nearby positive threat,
and unrelated worldwide context. Redact personal coordinates. No package install
or release is authorized by this design alone. Bradley subsequently authorized the temporary native install, restart, test, and restoration arrangement on 2026-09-07 ("yes"); the six scenarios and restoration evidence are recorded in `docs/validation/UX-027-EVIDENCE-SCOPED-HOME.md`.

Implementation owner: UI specialist. Testing owner: test specialist with separate
scope. Independent reviewer must not implement. Claim UX-027 through its own
draft PR after approval; coordinate with UX-026 before changing shared surfaces.

## Rollback

No data migration. Repair or revert a faulty renderer change while retaining
conservative empty wording and evidence notes; do not restore unsupported
all-clear messaging as a rollback shortcut.

## Delivery tasks and ownership

- UI specialist: briefing projection and Home overlay only; implement the
  approved contract after read-only revalidation and the draft PR claim.
- Test specialist: focused projection and overlay behavior tests; preserve
  positive controls, exercise unavailable/empty/zero-place states, and prove red
  before implementation. Parent owns test-suite registration in package.json.
- Parent: tracker claim, CI selection, builds, clean-tree mutation transcripts,
  manual evidence, and PR closeout. Independent reviewer owns no implementation.
- Dependencies: discovery/design refresh → draft claim → tests → production
  change → Home/survival/renderer/gate → independent/Claude review → closeout.
- Affected surface: Full Home Shell; preserve existing variant gates and CSS.
  No new dependencies, timers, providers, permissions, or persisted fields.
- Coordinate shared tracker/package edits with UX-026 PR #1704 and UX-025 PR
  #1695. The latter wraps Home readiness/briefing in a glass island; retain its
  structure if it lands while this task is active.
