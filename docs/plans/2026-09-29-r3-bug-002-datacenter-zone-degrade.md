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
