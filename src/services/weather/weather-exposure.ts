/**
 * Weather personal-exposure scoring.
 *
 * The notification path (src/app/data-loader.ts) feeds every severe /
 * extreme NWS alert through the Big Event Detector. That detector's
 * `high_personal_exposure` trigger only fires when `userExposure`
 * clears `exposureFloor` (default 70). Before this module existed the
 * data-loader hardcoded `userExposure: 50`, so a lone official warning
 * over the user's home produced ONLY the `high_confidence_high_impact`
 * trigger (weight 35 < threshold 40) — `isBigEvent` came back false and
 * the warning was silently dropped. That is the "all clear during a
 * severe storm" bug.
 *
 * This module computes a REAL 0-100 exposure by matching the alert's
 * polygon (or UGC zone codes, when the alert has no geometry) against
 * the user's saved places via the precise `nws-polygon-match` engine.
 * When a place is inside — or, for high-urgency hazards, near — the
 * warning, exposure clears the floor and the warning can never be
 * dropped as a non-event.
 *
 * Pure deterministic: no fetch, no DOM, no globals.
 */

import type { WeatherAlert } from '../weather';
import type {
  NwsAlertMinimal,
  PolygonMatchResult,
  SavedPlace,
  WeatherSeverity,
} from './weather-threat-types';
import { matchAlertsToPlaces, type MatchOptions } from './nws-polygon-match';

const SEVERITY_LOWER: Record<WeatherAlert['severity'], WeatherSeverity> = {
  Extreme: 'extreme',
  Severe: 'severe',
  Moderate: 'moderate',
  Minor: 'minor',
  Unknown: 'unknown',
};

/**
 * Coerce an alert timestamp to an ISO string. The type says `Date`, but
 * the NWS circuit breaker persists its cache with `persistCache: true`,
 * which round-trips the payload through JSON — so cache-hydrated alerts
 * arrive with `onset`/`expires` as ISO strings, not Date objects.
 * Calling `.toISOString()` on those throws a TypeError that (inside the
 * data-loader's per-batch try/catch) would drop EVERY severe alert that
 * cycle. The matcher only needs a `Date.parse`-able string, so pass a
 * string straight through and stringify a real Date.
 *
 * A malformed NWS timestamp also yields an *invalid* Date object
 * (`new Date('garbage')`), whose `.toISOString()` throws RangeError('Invalid
 * time value') — a second path to the same batch-aborting crash. Treat an
 * invalid Date as unusable ('') rather than throwing; the timestamp is
 * non-essential to the spatial match.
 */
export function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return typeof value === 'string' ? value : '';
}

/**
 * Map a single polygon-match outcome to a 0-100 personal-exposure
 * score. Every genuine match (inside or near a saved place) clears the
 * Big Event Detector's default `exposureFloor` (70) so an official
 * warning over the user can never be silently dropped; `no_match`
 * scores 0.
 */
export function exposureFromMatch(match: PolygonMatchResult): number {
  if (match.matchKind === 'no_match') return 0;
  const inside = match.matchKind === 'inside_polygon' || match.matchKind === 'inside_zone';
  if (inside) return match.threatLevel === 'emergency' ? 100 : 90;
  // near_polygon — the place is within its sensitivity buffer of the edge.
  return match.threatLevel === 'emergency' ? 85 : 75;
}

/**
 * Adapt the renderer's `WeatherAlert` to the matcher's
 * `NwsAlertMinimal`, carrying BOTH the polygon ring and the UGC zone
 * codes so zone-only alerts (no geometry) still match via the county
 * fallback.
 */
export function weatherAlertToNwsMinimal(alert: WeatherAlert): NwsAlertMinimal {
  const ring = alert.coordinates.length >= 3
    ? alert.coordinates.map(([lng, lat]) => [lng, lat] as [number, number])
    : undefined;
  return {
    id: alert.id,
    event: alert.event,
    polygon: ring ? { rings: [ring] } : undefined,
    ugcZones: alert.ugcZones,
    sent: toIsoString(alert.onset),
    expires: toIsoString(alert.expires),
    severity: SEVERITY_LOWER[alert.severity],
    headline: alert.headline,
    messageType: 'alert',
  };
}

export interface AlertExposure {
  /** Highest personal exposure 0-100 across all saved places. */
  exposure: number;
  /** The match that produced the highest exposure, if any. Lets callers
   *  surface WHY (which place, inside vs near, threat level). */
  match?: PolygonMatchResult;
}

/**
 * Highest personal exposure of `alert` across all `places`, computed via
 * precise polygon + UGC-zone matching. Returns `{ exposure: 0 }` when
 * there are no saved places or the alert touches none of them.
 */
export function computeAlertExposure(
  alert: WeatherAlert,
  places: readonly SavedPlace[],
  options: MatchOptions = {},
): AlertExposure {
  if (places.length === 0) return { exposure: 0 };
  const minimal = weatherAlertToNwsMinimal(alert);
  const matches = matchAlertsToPlaces([minimal], places, options);
  let best: PolygonMatchResult | undefined;
  let bestExposure = 0;
  for (const m of matches) {
    const e = exposureFromMatch(m);
    if (e > bestExposure) {
      bestExposure = e;
      best = m;
    }
  }
  return { exposure: bestExposure, match: best };
}
