/**
 * Weather threat shared types — per
 * docs/WEATHER_WARNING_REMEDIATION_PLAN.md.
 *
 * Plan section 2 (lines 45-71): for each saved place + current location,
 * compute whether the point is inside a warning polygon, distance to
 * polygon edge if outside, alert severity, hazard type, time remaining,
 * and whether the alert is expanding or newly issued.
 *
 * No DOM, no fetch, no globals. These types are the contract between
 * the polygon matcher and the (later) urgency mapper / Storm Mode.
 */

// ── Hazard taxonomy ──────────────────────────────────────────────────────

/** Categorical hazard classes that drive Storm Mode behavior, action
 *  cards, and notification urgency. The plan treats Tornado, Severe
 *  Thunderstorm, and Flash Flood warnings as high-urgency when inside
 *  polygon (lines 70-71). */
export type WeatherHazardKind =
  | 'tornado'
  | 'severe_thunderstorm'
  | 'flash_flood'
  | 'flood'
  | 'high_wind'
  | 'winter_storm'
  | 'blizzard'
  | 'ice_storm'
  | 'extreme_heat'
  | 'extreme_cold'
  | 'fire_weather'            // Red Flag / Fire Weather — conditions favor fire
  | 'wildfire_smoke'          // Air Quality / Dense Smoke — smoke from active fires
  | 'tropical'                // hurricane / tropical storm warning
  | 'storm_surge'
  | 'special_marine'
  | 'dust_storm'
  | 'other';

/** NWS uses both `event` strings ("Tornado Warning") and `severity`
 *  enum-ish values. We keep their five-level severity here so the
 *  matcher can pass it through faithfully. */
export type WeatherSeverity = 'minor' | 'moderate' | 'severe' | 'extreme' | 'unknown';

/** NWS message-type axis. Updates / cancellations need different
 *  handling than fresh alerts. */
export type WeatherMessageType = 'alert' | 'update' | 'cancel' | 'unknown';

/** What we actually decide to do about an alert. */
export type ThreatLevel = 'none' | 'watch' | 'advisory' | 'warning' | 'emergency';

// ── Geometry primitives (kept simple — no GeoJSON dependency) ────────────

/** [lon, lat] — same order as GeoJSON. */
export type Coord = readonly [number, number];

/** A simple polygon (single ring). NWS alerts can also publish
 *  MultiPolygon; we represent that as `rings.length > 1`. Rings are
 *  treated as outer rings (we do not currently subtract holes — NWS
 *  warning polygons rarely have them, and the plan PR 1 scope is
 *  matching, not stylized rendering). */
export interface AlertPolygon {
  rings: readonly Coord[][];
}

// ── NWS alert as we consume it ──────────────────────────────────────────

/** Subset of NWS Alert API that the matcher needs. Mirrors the fields
 *  we already pull through the sidecar so callers don't re-shape. */
export interface NwsAlertMinimal {
  /** Stable id (`@id` from NWS, or our own deterministic hash). */
  id: string;
  /** Headline event string ("Tornado Warning", "Severe Thunderstorm
   *  Warning", "Flash Flood Watch", …). */
  event: string;
  /** Effective polygon. Some NWS alerts only have UGC zone codes; in
   *  that case `polygon` is undefined and the caller should fall
   *  back to county/zone matching (PR 2 scope). */
  polygon?: AlertPolygon;
  /** ISO timestamp when the alert was issued. */
  sent: string;
  /** ISO timestamp when the alert expires. */
  expires: string;
  /** Originating message-type — fresh, update, or cancellation. */
  messageType?: WeatherMessageType;
  /** NWS severity field, normalized. */
  severity?: WeatherSeverity;
  /** Optional: id of the alert this one updates/cancels. Drives the
   *  "expanding vs newly issued" distinction. */
  references?: string[];
  /** Optional UGC zone codes (state + county/forecast zone). Used as
   *  a fallback when polygon is missing. PR 1 records them; PR 2
   *  will actually match against them. */
  ugcZones?: string[];
  /** Optional human description, kept so the explanation surface
   *  doesn't have to re-fetch. */
  headline?: string;
}

// ── Saved place / location ───────────────────────────────────────────────

export interface SavedPlace {
  /** Stable id ("home", "office", or a uuid). */
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Optional radius (km) defining a sensitivity buffer. Anything
   *  inside `radiusKm` of the polygon is treated as "near". */
  radiusKm?: number;
  /** Optional UGC zone/county codes for this place (derived from NWS
   *  `/points`). Lets the matcher fall back to zone matching when an
   *  alert has no polygon. */
  ugcZones?: string[];
}

// ── Match result ─────────────────────────────────────────────────────────

/** Per-place match outcome. The plan's section 2 example (lines 60-63):
 *  "Bradley's home is 7 miles outside Severe Thunderstorm Warning
 *  polygon. Storm moving east at 42 mph. Watch closely for expansion."
 *  We emit the structured equivalent — distance + reason + threat. */
export interface PolygonMatchResult {
  alertId: string;
  placeId: string;
  /** Did we match by polygon, by zone, or not at all? */
  matchKind: 'inside_polygon' | 'near_polygon' | 'inside_zone' | 'no_match';
  /** True when matchKind is 'inside_polygon' or 'inside_zone'. */
  isInside: boolean;
  /** Distance from place to nearest polygon edge in km. 0 when inside.
   *  Undefined when matchKind is 'inside_zone' or 'no_match'. */
  distanceKm?: number;
  /** Categorical hazard the alert maps to. */
  hazardKind: WeatherHazardKind;
  /** Plain-text NWS event string from the alert. */
  event: string;
  /** Pass-through severity, normalized. */
  severity: WeatherSeverity;
  /** Decision: how to surface this. */
  threatLevel: ThreatLevel;
  /** ms remaining until `expires`, computed at match time. */
  msUntilExpires: number;
  /** True when the alert references an earlier alert (i.e. it's an
   *  update/expansion rather than a new issue). */
  isUpdate: boolean;
  /** True when the alert.messageType is 'cancel'. */
  isCancellation: boolean;
  /** Human-readable reason ("inside polygon", "12 km outside polygon",
   *  "matched UGC zone INZ006"). Used by notification + diagnostics. */
  reason: string;
}

// ── Helpers exposed for direct callers (and tests) ───────────────────────

/** Map an NWS event string to our hazard taxonomy. Case-insensitive,
 *  prefix-anchored on the event word so "Severe Thunderstorm Warning"
 *  and "Severe Thunderstorm Watch" both resolve to severe_thunderstorm.
 *  Returns 'other' for unknown events so the rest of the pipeline
 *  doesn't crash on a new product type. */
// Order matters — first match wins (e.g. "flash flood" before "flood").
// wildfire_smoke: NWS issues Air Quality Alerts + (dense) smoke advisories,
// often from fires hundreds of miles away.
const HAZARD_RULES: readonly (readonly [WeatherHazardKind, readonly string[]])[] = [
  ['tornado', ['tornado']],
  ['flash_flood', ['flash flood']],
  ['flood', ['flood']],
  ['severe_thunderstorm', ['severe thunderstorm']],
  ['high_wind', ['high wind', 'wind advisory', 'damaging wind']],
  ['blizzard', ['blizzard']],
  ['ice_storm', ['ice storm']],
  ['winter_storm', ['winter storm', 'winter weather']],
  ['extreme_heat', ['excessive heat', 'heat advisory', 'heat warning']],
  ['extreme_cold', ['extreme cold', 'wind chill']],
  ['fire_weather', ['red flag', 'fire weather']],
  ['wildfire_smoke', ['air quality', 'smoke']],
  ['tropical', ['hurricane', 'tropical storm']],
  ['storm_surge', ['storm surge']],
  ['special_marine', ['special marine']],
  ['dust_storm', ['dust storm']],
];

export function classifyHazard(event: string): WeatherHazardKind {
  const e = event.toLowerCase();
  for (const [kind, needles] of HAZARD_RULES) {
    if (needles.some((n) => e.includes(n))) return kind;
  }
  return 'other';
}
