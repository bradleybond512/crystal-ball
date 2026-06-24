/**
 * Deterministic point-in-polygon self-test for the NWS matcher. A benign alert
 * whose polygon contains a known place MUST match (isInside true), and a place
 * far outside MUST NOT — proving matchAlertToPlace does real geometry rather
 * than a stub that always (or never) matches. Wired into the Self-Test tab so a
 * broken weather matcher surfaces as a real `fail` instead of a silent `skip`.
 *
 * Pure (no DOM/fetch); unit-tested alongside this file.
 */
import { matchAlertToPlace } from './nws-polygon-match';
import type { NwsAlertMinimal, SavedPlace } from './weather-threat-types';

export function runNwsPolygonSelfTestFixture(now: number = Date.now()): { ok: boolean; reason?: string } {
  // A 1°×1° box (lon -87..-86, lat 41..42). Coord order is [lon, lat] (GeoJSON).
  const ring: [number, number][] = [
    [-87, 41], [-86, 41], [-86, 42], [-87, 42], [-87, 41],
  ];
  const alert: NwsAlertMinimal = {
    id: 'self-test-polygon',
    // Benign event so the high-urgency "always near" escalation can't mask a
    // broken ray-cast — isInside must reflect pure geometry here.
    event: 'Self-Test Advisory',
    sent: new Date(0).toISOString(),
    expires: new Date(now + 3_600_000).toISOString(),
    severity: 'minor',
    polygon: { rings: [ring] },
  };
  const inside: SavedPlace = { id: 'st-inside', label: 'inside', lat: 41.5, lon: -86.5 };
  const outside: SavedPlace = { id: 'st-outside', label: 'outside', lat: 10, lon: 10, radiusKm: 1 };

  const insideResult = matchAlertToPlace(alert, inside, { now });
  if (!insideResult.isInside) {
    return { ok: false, reason: `Point inside polygon not matched (matchKind=${insideResult.matchKind}).` };
  }
  const outsideResult = matchAlertToPlace(alert, outside, { now });
  if (outsideResult.isInside) {
    return { ok: false, reason: 'Point far outside polygon incorrectly matched as inside.' };
  }
  return { ok: true };
}
