# R3-BUG-002: datacenter posture must not freeze when NWS `/points` fails

Status: approved by Bradley on September 29, 2026 ("Approve as designed").
Branch `claude/r3-bug-002-datacenter-posture` from `a255546ee`.
Classification: High Assurance (weather warning path). Queue item Q3.

## Problem (verified at a255546ee)

- The datacenter posture block in `src/app/data-loader.ts:1848-1946`
  resolves the site's UGC zones inside the posture `try`
  (`fetchUgcZonesForPoint` at `:1865`).
- `fetchNwsPointJurisdiction` (`src/services/weather.ts:544-581`) throws on
  any non-404 failure: a 5xx or 429, the 8 s timeout, or a malformed body.
- The throw lands in the outer `catch` at `:1944`, which logs "skipping this
  tick". `recomputeDatacenterPosture` never runs, so the **previous posture,
  possibly "All clear", stays on screen**. Nothing marks it stale:
  `updatedAt` is not shown anywhere.
- The comment promises "best-effort — degrades to polygon-only matching on
  failure". The code does not do that.
- `api.weather.gov` degrades most during severe-weather outbreaks, which is
  exactly when this matters. The window lasts until the zones resolve once.

## Design

1. **New helper `src/services/datacenter/site-zones.ts`.**
   `resolveSiteZonesBestEffort(site, cache, fetchZones) → { zones, degraded }`
   takes an injected fetch and cache.
   - The site's own `ugcZones`, or a cached answer, is used without fetching.
   - A successful answer is cached. That includes `[]` for a 404
     outside-jurisdiction, which is a real answer.
   - A thrown lookup returns `{ zones: [], degraded: true }` and is **never
     cached**, so the next tick retries.
2. **Posture input.** `RecomputeInput` / `PostureInput` gain
   `weatherZonesUnverified?: boolean`. When it is true,
   `computeDatacenterPosture` adds `'weather zones'` to `staleInputs`.
   Existing UI already surfaces `staleInputs` everywhere the posture appears:
   - the pinned strip shows "⚠ weather zones stale" and its degraded style;
   - the readiness panel footer;
   - the Home contextual deck.

   So a polygon-only posture never reads as a clean "All clear". Polygon
   matching still runs, so polygon warnings are unaffected.
3. **data-loader wiring.** The posture block calls the helper instead of
   the throwing lookup. It keeps the existing same-site write-back of
   resolved zones, and passes `weatherZonesUnverified: degraded`.
4. **Skipped recompute becomes visible.** A new
   `markDatacenterPostureStale(label)` in `datacenter-state.ts` adds the label
   to the current posture's `staleInputs` once and emits. The posture block's
   outer `catch` calls it with `'posture recompute failed'`. The next
   successful recompute replaces the posture and clears it.

## Non-goals

- An age-based staleness badge when the weather tick itself never runs.
  The strip only re-renders on emit, so this needs a timer. It is recorded as
  a follow-up.
- Any change to how `fetchNwsPointJurisdiction` behaves for other callers.

## Tests (fake-only; mutation proof per behavior)

- `site-zones.test.mts`:
  - a thrown fetch returns `{ zones: [], degraded: true }` and leaves the
    cache empty;
  - the next success is cached;
  - a 404-style `[]` is cached and not degraded;
  - the site's own zones and a cache hit do not fetch.
- `datacenter-posture.test.mts`: `weatherZonesUnverified` adds
  `'weather zones'`. A polygon warning still sets the level while zones are
  unverified.
- `datacenter-state.test.mts`: `markDatacenterPostureStale` adds the label
  once and emits; with no posture it does nothing; a recompute clears it.
- `datacenter-view.test.mts`: the strip shows "⚠ weather zones stale".
- A source gate, `tests/datacenter-zone-degrade-wiring.test.mjs`:
  - the posture block uses the helper and no longer calls
    `fetchUgcZonesForPoint` directly;
  - it passes the flag;
  - its `catch` marks the posture stale.
- Mutations:
  - remove the helper's `catch`;
  - cache a failure;
  - drop the stale label;
  - drop the flag in the wiring;
  - drop the mark-stale call.

## Rollback

There are no persisted-data changes. Reverting restores the tick-skip
behavior.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.

## October 10 private review repair

The original Sol review of source `68aa43653be241ca0252f218d18dfda9dd338209`
found that a zone result for an old selected site could be applied to a replacement
site. The private integration uses main
`cc353c94de7a181a46366fdd6d33a1dc12d27cc8`. Bradley's approved scope and
standing bounded repair authorization cover this correction.

- Capture the exact selected configuration object inside a local async function.
  Check that object after zone resolution, its own enrichment setter, grid,
  condition fan-out and infrastructure awaits, immediately before publication.
- Adopt the function's own enriched object before emitting the setter. A
  synchronous subscriber may replace the configuration or throw; recheck after
  emission and stale-mark only an object still owned by this work.
- Discard replaced-site work. The setter clears the old posture; the replacement
  receives its own later refresh, or keeps its already computed posture.
  Same-ID edits and different IDs at identical coordinates also invalidate work.
- Await the local function so its early returns still reach the weather loader's
  existing continuation. No provider/cache policy, persisted schema or global
  request-ordering policy changes.

Runtime tests execute the actual production declaration, awaited invocation and
immediately following weather-trace statement with finite provider fixtures and
real datacenter state/helper/posture/matcher functions. The separate
`test:datacenter-ownership` script preserves coverage when CI executes the
trusted main version of the existing `test:datacenter` command. Main routing
entries remain intact. Mutation QA must prove each ownership boundary, own
enrichment, weather continuation and the seven original degraded-mode behaviors.

The initially proposed label failed the repository's normal Sonar lint rules.
The approved narrow revision uses an awaited local async arrow, following an
existing loader convention. No lint rule or assertion was weakened.

## Private proof completion

The clean October 10 integration completed all seven bounded targeted scripts,
the actual strict selector, the trusted-main datacenter stage, and fifteen
applied mutation proofs with full restoration. See the separate
[validation supplement](../validation/R3-BUG-002-DATACENTER-ZONE-DEGRADE.md).
The named full gate and independent review are recorded on the final private
committed tip; publication and full CI remain separate requirements.

## Second and final bounded repair

The first complete independent Sol review found that a subscriber could throw
during publication, then again from the catch's stale notification, causing the
local async function to reject before the weather continuation. The scoped
correction wraps only that owned stale-mark call in a local catch. The stored
label remains, and weather processing continues; singleton dispatch policy is
unchanged. Two tests first reproduced the failures against the prior loader.
All sixteen current mutants then failed with full restoration on repaired code
`d6613b1010119ef43f326cbfa63507cc10e471d9`. Earlier review/proofs remain
immutable at their original SHAs. A confirmed blocker after this final automatic
repair requires human decision. See the validation document for actual results
and remaining limits.
