/**
 * Observation normalizer — post-adapter enrichment.
 *
 * Adapters produce ObservationEvents with the minimum required fields.
 * The normalizer fills in computed fields the rest of the intelligence
 * loop expects to be present: continent, country, distances to saved
 * places, and an initial relevance score.
 *
 * Pure: no DOM, no fetch, no globals. Callers pass saved places + clock.
 */

import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';
import { haversineKm } from '@/services/proximity-filter';
import { prioritize } from './prioritizer';

export type Continent = 'NA' | 'SA' | 'EU' | 'AF' | 'AS' | 'OC' | 'AN';

export interface ProximityHit {
  placeId: string;
  placeName: string;
  distanceKm: number;
}

export interface NormalizedObservation extends ObservationEvent {
  /** Two-letter continent code derived from location. */
  continent?: Continent;
  /** ISO-2 country code; may be undefined when coordinates fall outside
   *  the lightweight bounding boxes we ship in this module. */
  countryCode?: string;
  /** Distance from the event to each saved place, sorted by distance
   *  ascending. Undefined when no places were supplied. */
  proximityToSavedPlaces?: readonly ProximityHit[];
  /** Initial relevance score (0..100) before personal-relevance scoring
   *  is layered on. Driven by `prioritizer.ts`. */
  relevanceScore?: number;
}

export interface NormalizeOptions {
  savedPlaces?: readonly SavedPlace[];
  /** Override the country code if the caller already resolved it from a
   *  more authoritative source (geocoder, provider tag, etc.). */
  countryCode?: string;
  nowMs?: number;
}

// ── Continent classification (coarse bounding boxes) ─────────────────────

export function computeContinent(lat: number, lon: number): Continent | undefined {
  if (lat <= -60) return 'AN';
  if (lat >= 7 && lat <= 83 && lon >= -170 && lon <= -50) return 'NA';
  if (lat < 13 && lat >= -57 && lon >= -82 && lon <= -34) return 'SA';
  if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 50) return 'EU';
  if (lat >= -35 && lat <= 38 && lon >= -20 && lon <= 52) return 'AF';
  if (lat >= -12 && lat <= 78 && lon >= 25 && lon <= 180) return 'AS';
  if (lat >= -50 && lat <= 0 && lon >= 110 && lon <= 180) return 'OC';
  return undefined;
}

// ── Country code (light heuristic — continental US only) ─────────────────

export function computeCountryCode(lat: number, lon: number): string | undefined {
  // Continental US — the only country with a precise enough bounding box
  // here. Open ocean and other countries fall through to undefined and
  // should be resolved by a real geocoder upstream when present.
  if (lat >= 24 && lat <= 49 && lon >= -125 && lon <= -66) return 'US';
  return undefined;
}

function proximityToSavedPlaces(
  obs: ObservationEvent,
  places: readonly SavedPlace[] | undefined,
): readonly ProximityHit[] | undefined {
  if (!places || places.length === 0 || !obs.location) return undefined;
  const { lat, lon } = obs.location;
  return places
    .map((p) => ({ placeId: p.id, placeName: p.name, distanceKm: haversineKm(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function normalize(obs: ObservationEvent, opts: NormalizeOptions = {}): NormalizedObservation {
  const continent = obs.location ? computeContinent(obs.location.lat, obs.location.lon) : undefined;
  const countryCode = opts.countryCode
    ?? (obs.location ? computeCountryCode(obs.location.lat, obs.location.lon) : undefined);
  const proximity = proximityToSavedPlaces(obs, opts.savedPlaces);

  const prioritized = prioritize([obs], opts.savedPlaces ? [...opts.savedPlaces] : [], {}, opts.nowMs ?? Date.now());
  const relevanceScore = prioritized[0]?.relevanceScore;

  return {
    ...obs,
    continent,
    countryCode,
    proximityToSavedPlaces: proximity,
    relevanceScore,
  };
}
