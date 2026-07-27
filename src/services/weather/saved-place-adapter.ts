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

function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

/**
 * Resolve each saved place's own UGC zones (forecast zone + county) so the
 * matcher's zone fallback can fire for polygon-free NWS products. Returns a
 * `Map<placeId, zones>` containing only places with at least one resolved
 * zone. Cached by coordinate and fault-isolated per place: a failing lookup
 * degrades that place to polygon-only matching without breaking the batch.
 */
export async function resolveSavedPlaceZones(
  places: readonly StoredPlace[],
  fetchZones: ZoneResolver = fetchUgcZonesForPoint,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const place of places) {
    const key = coordKey(place.lat, place.lon);
    let zones = zoneCache.get(key);
    if (!zones) {
      try {
        zones = await fetchZones(place.lat, place.lon);
      } catch {
        zones = [];
      }
      zoneCache.set(key, zones);
    }
    if (zones.length > 0) out.set(place.id, zones);
  }
  return out;
}
