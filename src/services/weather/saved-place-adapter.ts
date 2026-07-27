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
const inFlightZones = new Map<string, Promise<string[]>>();

function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

/** Resolve one coordinate's zones, sharing a single in-flight fetch across
 *  concurrent callers and caching only a non-empty (stable) result. Not `async`
 *  so cache/in-flight hits return the very same promise instance. */
function resolveZonesForCoord(lat: number, lon: number, fetchZones: ZoneResolver): Promise<string[]> {
  const key = coordKey(lat, lon);
  const cached = zoneCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlightZones.get(key);
  if (pending) return pending;

  const started = (async () => {
    let zones: string[];
    try {
      zones = await fetchZones(lat, lon);
    } catch {
      zones = [];
    }
    // Cache ONLY a successful, non-empty resolve. An empty result (transient
    // NWS failure or a genuinely zone-less point) must not poison the cache:
    // caching [] here — which is truthy — would permanently disable zone-only
    // matching for this place after a single hiccup. A place's zones never
    // change, so one good resolve still serves every later tick.
    if (zones.length > 0) zoneCache.set(key, zones);
    return zones;
  })();

  inFlightZones.set(key, started);
  // Evict once settled so an empty/failed resolve is retried next tick (a
  // non-empty result is already served from zoneCache above).
  void started.finally(() => {
    if (inFlightZones.get(key) === started) inFlightZones.delete(key);
  });
  return started;
}

/**
 * Resolve each saved place's own UGC zones (forecast zone + county) so the
 * matcher's zone fallback can fire for polygon-free NWS products. Returns a
 * `Map<placeId, zones>` containing only places with at least one resolved
 * zone. Cached by coordinate, deduped across concurrent callers, and
 * fault-isolated per place: a failing lookup degrades that place to
 * polygon-only matching without breaking the batch.
 */
export async function resolveSavedPlaceZones(
  places: readonly StoredPlace[],
  fetchZones: ZoneResolver = fetchUgcZonesForPoint,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  // Resolve places concurrently: each is an independent NWS /points lookup, so
  // a serial loop stacks their latencies (8 places × ~1s each blocked the whole
  // weather tick). Fault-isolated per place — one lookup's failure never rejects
  // the batch.
  await Promise.all(
    places.map(async (place) => {
      const zones = await resolveZonesForCoord(place.lat, place.lon, fetchZones);
      if (zones.length > 0) out.set(place.id, zones);
    }),
  );
  return out;
}
