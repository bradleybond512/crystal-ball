/**
 * NWS polygon → saved-place matcher.
 *
 * Per docs/WEATHER_WARNING_REMEDIATION_PLAN.md section 2 (lines 45-71):
 * for each saved place + current location, compute whether the point
 * is inside the warning polygon, distance to polygon edge if outside,
 * severity, hazard type, time remaining, and whether the alert is
 * expanding or newly issued.
 *
 * The plan's primary diagnostic example:
 *   "Bradley's home is 7 miles outside Severe Thunderstorm Warning
 *    polygon. Storm moving east at 42 mph. Watch closely for expansion."
 *
 * Pure deterministic: no fetch, no DOM, no globals. Inputs are alerts
 * + saved places; output is a structured PolygonMatchResult per pair.
 *
 * Plan invariant: "Prefer false-positive watch-level alerts over silent
 * misses for tornado, flash flood, and destructive wind threats." So
 * `near_polygon` (within saved-place sensitivity buffer) IS reported
 * for those hazards even though the point isn't strictly inside.
 */

import type {
  AlertPolygon,
  Coord,
  NwsAlertMinimal,
  PolygonMatchResult,
  SavedPlace,
  ThreatLevel,
  WeatherHazardKind,
  WeatherSeverity,
} from './weather-threat-types';
import { classifyHazard } from './weather-threat-types';

// ── Match options ────────────────────────────────────────────────────────

export interface MatchOptions {
  /** Defaults to Date.now(). Inject for deterministic tests. */
  now?: number;
  /** Default sensitivity buffer (km) when a SavedPlace has no
   *  `radiusKm` of its own. Anything within this distance of the
   *  polygon is reported as `near_polygon`. */
  defaultNearKm?: number;
  /** Hazards that always produce a `near_polygon` result if the place
   *  is within `defaultNearKm`, even if the place itself doesn't
   *  request a buffer. Plan's "prefer false-positive" guardrail. */
  alwaysNearForHazards?: readonly WeatherHazardKind[];
}

const DEFAULT_NEAR_KM = 10;
const DEFAULT_HIGH_URGENCY: readonly WeatherHazardKind[] = [
  'tornado',
  'flash_flood',
  'severe_thunderstorm',
];

// ── Top-level matcher ────────────────────────────────────────────────────

/** Match a single alert against a single saved place. Returns a
 *  PolygonMatchResult even when there's no match — `matchKind` tells
 *  the caller what happened, and `reason` explains why. */
export function matchAlertToPlace(
  alert: NwsAlertMinimal,
  place: SavedPlace,
  options: MatchOptions = {},
): PolygonMatchResult {
  const now = options.now ?? Date.now();
  const nearKm = place.radiusKm ?? options.defaultNearKm ?? DEFAULT_NEAR_KM;
  const alwaysNear = options.alwaysNearForHazards ?? DEFAULT_HIGH_URGENCY;
  const hazardKind = classifyHazard(alert.event);
  const severity = alert.severity ?? 'unknown';
  const isUpdate = (alert.references?.length ?? 0) > 0 && alert.messageType !== 'cancel';
  const isCancellation = alert.messageType === 'cancel';
  const msUntilExpires = parseTimestamp(alert.expires) - now;

  // No polygon → fall back to UGC zone matching when available. PR 1
  // does the deterministic part (matched? yes/no by membership);
  // distance is undefined for zone matches.
  if (!alert.polygon || alert.polygon.rings.length === 0) {
    const placeZones = place.ugcZones ?? [];
    const placeZoneSet = new Set(placeZones);
    const matchedZone = (alert.ugcZones ?? []).find((z) => placeZoneSet.has(z));
    if (matchedZone) {
      return finalize({
        alertId: alert.id,
        placeId: place.id,
        matchKind: 'inside_zone',
        isInside: true,
        distanceKm: undefined,
        hazardKind,
        event: alert.event,
        severity,
        msUntilExpires,
        isUpdate,
        isCancellation,
        reason: `Matched UGC zone ${matchedZone}`,
      });
    }
    return finalize({
      alertId: alert.id,
      placeId: place.id,
      matchKind: 'no_match',
      isInside: false,
      hazardKind,
      event: alert.event,
      severity,
      msUntilExpires,
      isUpdate,
      isCancellation,
      reason: 'Alert has no polygon and no UGC zone overlap',
    });
  }

  const point: Coord = [place.lon, place.lat];
  const inside = pointInPolygon(point, alert.polygon);
  if (inside) {
    return finalize({
      alertId: alert.id,
      placeId: place.id,
      matchKind: 'inside_polygon',
      isInside: true,
      distanceKm: 0,
      hazardKind,
      event: alert.event,
      severity,
      msUntilExpires,
      isUpdate,
      isCancellation,
      reason: 'Inside warning polygon',
    });
  }

  const distanceKm = distanceToPolygonKm(point, alert.polygon);
  const wantsBuffer = place.radiusKm !== undefined || alwaysNear.includes(hazardKind);
  if (wantsBuffer && distanceKm <= nearKm) {
    return finalize({
      alertId: alert.id,
      placeId: place.id,
      matchKind: 'near_polygon',
      isInside: false,
      distanceKm,
      hazardKind,
      event: alert.event,
      severity,
      msUntilExpires,
      isUpdate,
      isCancellation,
      reason: `${distanceKm.toFixed(1)} km outside polygon (within ${nearKm} km buffer)`,
    });
  }

  return finalize({
    alertId: alert.id,
    placeId: place.id,
    matchKind: 'no_match',
    isInside: false,
    distanceKm,
    hazardKind,
    event: alert.event,
    severity,
    msUntilExpires,
    isUpdate,
    isCancellation,
    reason: `${distanceKm.toFixed(1)} km outside polygon`,
  });
}

/** Match many alerts against many places. Returns only matches
 *  (matchKind !== 'no_match'); pair callers can call matchAlertToPlace
 *  directly when they need the full miss diagnostic. */
export function matchAlertsToPlaces(
  alerts: readonly NwsAlertMinimal[],
  places: readonly SavedPlace[],
  options: MatchOptions = {},
): PolygonMatchResult[] {
  const out: PolygonMatchResult[] = [];
  for (const alert of alerts) {
    for (const place of places) {
      const r = matchAlertToPlace(alert, place, options);
      if (r.matchKind !== 'no_match') out.push(r);
    }
  }
  return out;
}

// ── Threat-level mapping ─────────────────────────────────────────────────

/** Map (hazard, matchKind, severity, messageType) to the threat tier
 *  the rest of the app uses. Plan section 4 specifies behavior:
 *    - watches near saved places → elevated alerts
 *    - warnings inside polygons → critical/emergency alerts
 */
function deriveThreatLevel(args: {
  hazardKind: WeatherHazardKind;
  matchKind: PolygonMatchResult['matchKind'];
  event: string;
  severity: WeatherSeverity;
  isCancellation: boolean;
}): ThreatLevel {
  if (args.isCancellation) return 'none';
  if (args.matchKind === 'no_match') return 'none';

  const isWarning = /warning/i.test(args.event);
  const isWatch = /watch/i.test(args.event);
  const isAdvisory = /advisory/i.test(args.event);
  const inside = args.matchKind === 'inside_polygon' || args.matchKind === 'inside_zone';
  const high = HIGH_RISK_HAZARDS.has(args.hazardKind);

  if (inside && isWarning && (high || args.severity === 'extreme')) return 'emergency';
  if (inside && isWarning) return 'warning';
  if (!inside && isWarning && high) return 'warning';
  if (isWatch) return 'watch';
  if (isAdvisory) return 'advisory';
  // Buffer-only matches with no warning keyword still surface as watch.
  if (args.matchKind === 'near_polygon') return 'watch';
  return 'advisory';
}

const HIGH_RISK_HAZARDS = new Set<WeatherHazardKind>([
  'tornado',
  'flash_flood',
  'severe_thunderstorm',
  'tropical',
  'storm_surge',
  'blizzard',
  'ice_storm',
]);

// ── Geometry: point-in-polygon + distance-to-edge ────────────────────────

/** Ray-casting point-in-polygon. Coordinates are [lon, lat] (GeoJSON
 *  order). For a MultiPolygon, "inside" is "inside any ring". This is
 *  fine for NWS warning polygons which we treat as outer rings — see
 *  comment on AlertPolygon for the holes caveat. */
export function pointInPolygon(point: Coord, polygon: AlertPolygon): boolean {
  for (const ring of polygon.rings) {
    if (pointInRing(point, ring)) return true;
  }
  return false;
}

function pointInRing(point: Coord, ring: readonly Coord[]): boolean {
  if (ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Great-circle distance in km from `point` to the nearest edge of
 *  `polygon`. Returns 0 if inside. Uses haversine on each segment's
 *  closest point (computed in equirectangular space scaled by latitude
 *  cosine, then re-projected to km — accurate for the small polygons
 *  NWS issues, even at high latitudes). */
export function distanceToPolygonKm(point: Coord, polygon: AlertPolygon): number {
  if (pointInPolygon(point, polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const ring of polygon.rings) {
    const d = distanceToRingKm(point, ring);
    if (d < best) best = d;
  }
  return best;
}

function distanceToRingKm(point: Coord, ring: readonly Coord[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const d = pointToSegmentKm(point, ring[i]!, ring[i + 1]!);
    if (d < best) best = d;
  }
  if (ring.length >= 2) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      const d = pointToSegmentKm(point, last, first);
      if (d < best) best = d;
    }
  }
  return best;
}

function pointToSegmentKm(p: Coord, a: Coord, b: Coord): number {
  // Equirectangular projection with cosine-of-latitude scaling. Convert
  // to km via the deg-to-km constant at equator and the latitude scale.
  const KM_PER_DEG_LAT = 111.32;
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(meanLat);

  // Project to local km plane.
  const ax = a[0] * kmPerDegLon;
  const ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * kmPerDegLon;
  const by = b[1] * KM_PER_DEG_LAT;
  const px = p[0] * kmPerDegLon;
  const py = p[1] * KM_PER_DEG_LAT;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseTimestamp(iso: string): number {
  const t = Date.parse(iso);
  // Return Infinity (never-expires sentinel) for empty/invalid ISO strings.
  // Returning 0 caused msUntilExpires = 0 - now ≈ -1.7 trillion ms,
  // misleadingly indicating the alert expired ~55 years ago and confusing
  // any downstream consumer that gates on msUntilExpires < 0 for expiry.
  return Number.isFinite(t) ? t : Infinity;
}

function finalize(partial: Omit<PolygonMatchResult, 'threatLevel'>): PolygonMatchResult {
  const threatLevel = deriveThreatLevel({
    hazardKind: partial.hazardKind,
    matchKind: partial.matchKind,
    event: partial.event,
    severity: partial.severity,
    isCancellation: partial.isCancellation,
  });
  return { ...partial, threatLevel };
}
