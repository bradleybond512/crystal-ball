/**
 * Single source of truth for adapting the renderer's stored `SavedPlace`
 * (saved-places.ts) into the polygon matcher's `SavedPlace`
 * (weather-threat-types.ts).
 *
 * Two data-loader call sites feed the matcher — the notification/exposure
 * path and the Personal Storm Mode routing path. They previously hand-rolled
 * this mapping and drifted apart: one dropped `radiusKm` (shrinking the
 * user's coverage to the 10 km hazard default), the other dropped BOTH
 * `radiusKm` and `ugcZones` (so geometry-free zone-only alerts could never
 * match). Routing both through this adapter keeps them consistent and makes
 * the mapping unit-testable.
 */

import type { SavedPlace as StoredPlace } from '../saved-places';
import type { SavedPlace as MatcherPlace } from './weather-threat-types';
import { fetchUgcZonesForPoint } from '../weather';

/**
 * Map one stored place to the matcher shape, carrying the configured
 * `radiusKm` (used as the near-polygon sensitivity buffer) and any
 * resolved UGC zones (used for the geometry-free zone fallback). `ugcZones`
 * is omitted entirely when none were resolved, so the matcher's
 * `place.ugcZones ?? []` default stays clean.
 */
export function toMatcherPlace(place: StoredPlace, ugcZones?: readonly string[]): MatcherPlace {
  const mapped: MatcherPlace = {
    id: place.id,
    label: place.name,
    lat: place.lat,
    lon: place.lon,
    radiusKm: place.radiusKm,
  };
  if (ugcZones && ugcZones.length > 0) mapped.ugcZones = [...ugcZones];
  return mapped;
}

/**
 * A stable, order-independent fingerprint of the MATCH-relevant fields of a
 * saved-place set: id + lat + lon + radiusKm — exactly what `toMatcherPlace`
 * carries into the polygon/zone matcher. The severe-alert loop captures this
 * before its async zone lookup and re-reads it before publishing the clear
 * decision; a change means a place was added/moved/re-radiused/removed while the
 * evaluation was in flight, so the clear was computed against a stale set and
 * must be withheld (the newly-added place under a live warning was never
 * evaluated). Sorting makes a pure reorder — which cannot change the match set —
 * read identical; display-only edits (name, notes, priority) are excluded so
 * they never spuriously withhold a clear. JSON-encoding the sorted tuples keeps
 * the fingerprint unambiguous regardless of what an id contains, so this safety
 * guard never silently depends on the id charset staying delimiter-free.
 */
export function savedPlacesMatchSignature(places: readonly StoredPlace[]): string {
  const rows = places
    .map((p) => [p.id, p.lat, p.lon, p.radiusKm] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(rows);
}

/**
 * Build the saved-places subscription handler that drops a confirmed personal
 * "all clear" — but ONLY when the MATCH set actually changed. A confirmed clear
 * was proven against a specific set of places at the last weather refresh; adding,
 * moving, re-radiusing, or removing a place invalidates it (a new place could sit
 * under a warning the clear never evaluated), so `revoke` fires and the chip falls
 * back to the neutral "checking" state until the next honest re-evaluation. A
 * display-only edit (rename, notes, priority) or a pure reorder leaves
 * {@link savedPlacesMatchSignature} unchanged and must NOT withhold the clear —
 * blanking the chip on a cosmetic edit is a needless downgrade. The handler holds
 * the last signature across calls, seeded from `initialPlaces`.
 */
export function createPlacesClearRevoker(
  initialPlaces: readonly StoredPlace[],
  revoke: () => void,
): (places: readonly StoredPlace[]) => void {
  let lastSignature = savedPlacesMatchSignature(initialPlaces);
  return (places) => {
    const signature = savedPlacesMatchSignature(places);
    if (signature === lastSignature) return;
    lastSignature = signature;
    revoke();
  };
}

/** Injectable point→zones resolver (defaults to the live NWS `/points`
 *  lookup). Best-effort: the concrete impl returns `[]` on any failure. */
export type ZoneResolver = (lat: number, lon: number) => Promise<string[]>;

/** Process-lifetime cache of a coordinate's own UGC zones. A place's zones
 *  never change, so one successful resolve serves every later weather tick. */
const zoneCache = new Map<string, string[]>();

/** Coalesce concurrent resolves of the SAME coordinate. `zoneCache` only holds
 *  COMPLETED results, so during the initial app wave — where the `weather` and
 *  `nwsAlerts` tasks resolve the same places at once — both callers would miss
 *  the cache and fire duplicate /points requests. Worse, under throttling an
 *  asymmetric failure could hand one leg `[]` and clear a geometry-free warning
 *  the other matched. Sharing the in-flight promise makes concurrent callers
 *  observe one identical result. Evicted on settle so a transient empty/failed
 *  resolve isn't sticky — only a non-empty result persists (in `zoneCache`). */
const inFlightZones = new Map<string, Promise<ZoneResolveOutcome>>();

function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

/** Outcome of one coordinate's zone resolve. `failed` is true ONLY when the
 *  resolver threw — i.e. we do not know this coordinate's zones. An honest
 *  empty resolve (a genuinely zone-less point) has `failed: false` with
 *  `zones: []`; it is truthful, not a degradation. */
interface ZoneResolveOutcome {
  zones: string[];
  failed: boolean;
}

/** Resolve one coordinate's zones, sharing a single in-flight fetch across
 *  concurrent callers and caching only a non-empty (stable) result. Not `async`
 *  so cache/in-flight hits return the very same promise instance. Carries a
 *  `failed` flag so callers can tell "resolver threw (zones unknown)" apart
 *  from "resolved to no zones (honest empty)". */
function resolveZonesForCoord(lat: number, lon: number, fetchZones: ZoneResolver): Promise<ZoneResolveOutcome> {
  const key = coordKey(lat, lon);
  const cached = zoneCache.get(key);
  if (cached) return Promise.resolve({ zones: cached, failed: false });
  const pending = inFlightZones.get(key);
  if (pending) return pending;

  const started = (async () => {
    let zones: string[];
    let failed = false;
    try {
      zones = await fetchZones(lat, lon);
    } catch {
      zones = [];
      failed = true;
    }
    // Cache ONLY a successful, non-empty resolve. An empty result (transient
    // NWS failure or a genuinely zone-less point) must not poison the cache:
    // caching [] here — which is truthy — would permanently disable zone-only
    // matching for this place after a single hiccup. A place's zones never
    // change, so one good resolve still serves every later tick.
    if (zones.length > 0) zoneCache.set(key, zones);
    return { zones, failed };
  })();

  inFlightZones.set(key, started);
  // Evict once settled so an empty/failed resolve is retried next tick (a
  // non-empty result is already served from zoneCache above).
  void started.finally(() => {
    if (inFlightZones.get(key) === started) inFlightZones.delete(key);
  });
  return started;
}

/** Result of resolving a whole batch of saved places' zones. `degraded` is
 *  true when AT LEAST ONE place's resolve threw — i.e. some place's zones are
 *  unknown this tick. The clear decision must withhold a confirmed-clear while
 *  degraded, because a geometry-free (zone-only) severe alert could match an
 *  unresolved place and go unseen. An all-empty batch (every place honestly
 *  zone-less) is NOT degraded. */
export interface SavedPlaceZonesHealth {
  zonesByPlace: Map<string, string[]>;
  degraded: boolean;
}

/**
 * Resolve each saved place's own UGC zones (forecast zone + county) so the
 * matcher's zone fallback can fire for polygon-free NWS products, AND report
 * whether any resolve failed. Returns `zonesByPlace` (only places with at
 * least one resolved zone) plus a `degraded` flag. Cached by coordinate,
 * deduped across concurrent callers, and fault-isolated per place: a failing
 * lookup degrades that place to polygon-only matching without breaking the
 * batch — but it DOES flip `degraded` so the caller knows the zone picture is
 * incomplete and can withhold an "all clear".
 */
export async function resolveSavedPlaceZonesWithHealth(
  places: readonly StoredPlace[],
  fetchZones: ZoneResolver = fetchUgcZonesForPoint,
): Promise<SavedPlaceZonesHealth> {
  const zonesByPlace = new Map<string, string[]>();
  let degraded = false;
  // Resolve places concurrently: each is an independent NWS /points lookup, so
  // a serial loop stacks their latencies (8 places × ~1s each blocked the whole
  // weather tick). Fault-isolated per place — one lookup's failure never rejects
  // the batch, but it does mark the batch degraded.
  await Promise.all(
    places.map(async (place) => {
      const { zones, failed } = await resolveZonesForCoord(place.lat, place.lon, fetchZones);
      if (failed) degraded = true;
      if (zones.length > 0) zonesByPlace.set(place.id, zones);
    }),
  );
  return { zonesByPlace, degraded };
}

/**
 * Convenience wrapper around {@link resolveSavedPlaceZonesWithHealth} that
 * returns only the `zonesByPlace` map. Kept for call sites (Personal Storm
 * Mode routing) that don't need the degradation signal.
 */
export async function resolveSavedPlaceZones(
  places: readonly StoredPlace[],
  fetchZones: ZoneResolver = fetchUgcZonesForPoint,
): Promise<Map<string, string[]>> {
  const { zonesByPlace } = await resolveSavedPlaceZonesWithHealth(places, fetchZones);
  return zonesByPlace;
}
