/**
 * Personal Storm Mode payload — per
 * docs/WEATHER_WARNING_REMEDIATION_PLAN.md PR 3 (lines 347-355) and
 * section 1 (lines 19-43).
 *
 * The plan's headline scenario: a severe-weather threat near a saved
 * place pushes the app into a focused storm mode that overrides normal
 * dashboard noise. This module produces the data payload that mode
 * consumes — it does NOT render UI. Plan PR 5 will build the UI on top.
 *
 * The plan's worked example (lines 24-33):
 *   Severe Weather Near Home
 *   Main threat: damaging wind
 *   Arrival window: 35-55 minutes
 *   Confidence: high
 *   Action: move loose outdoor items, charge phone, avoid driving
 *   Next update: radar scan in 5 min
 *
 * Pure deterministic. No DOM, no fetch.
 */

import type {
  PolygonMatchResult,
  ThreatLevel,
  WeatherHazardKind,
} from './weather-threat-types';
import { actionsForHazard, type PreparednessAction } from './preparedness-actions';

// ── Public types ─────────────────────────────────────────────────────────

export type StormModeActivation = 'inactive' | 'watching' | 'active' | 'critical';

export interface ArrivalWindow {
  /** Earliest plausible arrival, ms timestamp. */
  earliestMs: number;
  /** Latest plausible arrival, ms timestamp. */
  latestMs: number;
  /** Pre-formatted human label ("35-55 min", "5-15 min"). */
  label: string;
}

export interface StormModePayload {
  /** Whether storm mode should activate at all. */
  activation: StormModeActivation;
  /** Headline title ("Severe Weather Near Home"). */
  title: string;
  /** Primary hazard the user should focus on. */
  primaryHazard: WeatherHazardKind;
  /** Plain-English main-threat phrase ("damaging wind"). */
  mainThreatLabel: string;
  /** Closest saved place in the path / current location. */
  closestPlaceLabel?: string;
  /** Distance from closest place to the active polygon, in km.
   *  0 when inside the polygon. */
  distanceKm: number;
  /** Arrival window. Undefined when arrival can't be estimated
   *  (no movement data) or already arrived. */
  arrivalWindow?: ArrivalWindow;
  /** Categorical confidence the user sees ("high"/"medium"/"low"),
   *  derived from match severity + threat level. */
  confidenceLabel: 'low' | 'medium' | 'high';
  /** Threat tier (mirrors PolygonMatchResult.threatLevel). */
  threatLevel: ThreatLevel;
  /** Ranked, time-budget-aware actions. */
  actions: PreparednessAction[];
  /** Plain-text "next update expected at..." line. */
  nextUpdateLabel: string;
  /** Plan invariant: "Every weather notification should say why". */
  reason: string;
  /** ms timestamp the alert expires. */
  expiresAtMs: number;
  /** ms timestamp this payload was generated (for staleness display). */
  generatedAtMs: number;
}

// ── Top-level builder ────────────────────────────────────────────────────

export interface StormModeOptions {
  /** Defaults to Date.now(). */
  now?: number;
  /** Storm motion vector — direction in degrees (0=N, 90=E, etc.) and
   *  speed in km/h. When supplied with a polygon edge distance, the
   *  arrival window is computed from this. */
  stormMotion?: { headingDeg: number; speedKmh: number };
  /** Optional storm-bearing-from-place in degrees. When provided
   *  WITH stormMotion, we estimate whether the storm is approaching
   *  vs moving away. */
  bearingFromPlaceDeg?: number;
  /** Max actions to surface (default 5). */
  maxActions?: number;
  /** Include outage prep actions even when the primary hazard isn't a
   *  power-outage event (defaults true for severe TS / high wind /
   *  tornado / ice storm — anything that routinely knocks the lights
   *  out). */
  includeOutageActions?: boolean;
  /** When the alert is short-fuse (arrival within `urgentMinutes`),
   *  filter to actions that complete in <= the available time.
   *  Default 30 min. */
  urgentMinutes?: number;
}

export function buildStormModePayload(
  match: PolygonMatchResult,
  placeLabel: string | undefined,
  options: StormModeOptions = {},
): StormModePayload {
  const now = options.now ?? Date.now();
  const activation = computeActivation(match);
  const arrivalWindow = computeArrivalWindow(match, options, now);
  const confidenceLabel = computeConfidenceLabel(match);
  const includeOutage = options.includeOutageActions ?? defaultIncludeOutage(match.hazardKind);
  const minutesAvailable = arrivalWindow
    ? Math.round((arrivalWindow.earliestMs - now) / 60_000)
    : undefined;
  const urgentLimit = options.urgentMinutes ?? 30;

  const actions = actionsForHazard(match.hazardKind, {
    max: options.maxActions ?? 5,
    includeOutageActions: includeOutage,
    maxMinutesAvailable: minutesAvailable !== undefined && minutesAvailable < urgentLimit
      ? Math.max(1, minutesAvailable)
      : undefined,
  });

  return {
    activation,
    title: buildTitle(match, placeLabel),
    primaryHazard: match.hazardKind,
    mainThreatLabel: mainThreatLabelFor(match.hazardKind),
    closestPlaceLabel: placeLabel,
    distanceKm: match.distanceKm ?? 0,
    arrivalWindow,
    confidenceLabel,
    threatLevel: match.threatLevel,
    actions,
    nextUpdateLabel: nextUpdateLabelFor(match.hazardKind),
    reason: match.reason,
    expiresAtMs: now + match.msUntilExpires,
    generatedAtMs: now,
  };
}

// ── Component computers ─────────────────────────────────────────────────

function computeActivation(match: PolygonMatchResult): StormModeActivation {
  if (match.isCancellation || match.threatLevel === 'none') return 'inactive';
  if (match.threatLevel === 'emergency') return 'critical';
  const inside = match.matchKind === 'inside_polygon' || match.matchKind === 'inside_zone';
  if (match.threatLevel === 'warning' && inside) return 'active';
  if (match.threatLevel === 'warning') return 'watching';
  if (match.threatLevel === 'watch') return 'watching';
  return 'inactive';
}

function computeArrivalWindow(
  match: PolygonMatchResult,
  options: StormModeOptions,
  now: number,
): ArrivalWindow | undefined {
  // If already inside the polygon, the storm is HERE — no arrival
  // window to compute.
  if (match.isInside) return undefined;
  const distance = match.distanceKm;
  if (distance === undefined) return undefined;
  if (!options.stormMotion || options.stormMotion.speedKmh <= 0) return undefined;

  // Estimate component of motion toward the place. Without bearing
  // data, assume worst-case approach (full speed inbound).
  let approachSpeed = options.stormMotion.speedKmh;
  if (options.bearingFromPlaceDeg !== undefined) {
    // bearingFromPlaceDeg = compass bearing of the storm's position from
    // the place. The "approach" direction (storm → place) is opposite.
    const approachDirectionDeg = (options.bearingFromPlaceDeg + 180) % 360;
    const angleDiff = angleBetween(approachDirectionDeg, options.stormMotion.headingDeg);
    // 0° = heading matches approach direction (full speed toward);
    // 180° = heading is opposite (moving away).
    const componentToward = Math.cos((angleDiff * Math.PI) / 180);
    if (componentToward <= 0) return undefined; // moving away
    approachSpeed = options.stormMotion.speedKmh * componentToward;
  }

  const minutesToEdge = (distance / approachSpeed) * 60;
  if (!Number.isFinite(minutesToEdge) || minutesToEdge < 0) return undefined;

  // ±25% uncertainty band around the central estimate.
  const earliest = Math.max(0, minutesToEdge * 0.75);
  const latest = minutesToEdge * 1.25;

  return {
    earliestMs: now + earliest * 60_000,
    latestMs: now + latest * 60_000,
    label: `${Math.round(earliest)}-${Math.round(latest)} min`,
  };
}

function computeConfidenceLabel(match: PolygonMatchResult): 'low' | 'medium' | 'high' {
  // Inside-polygon emergencies are the most credible.
  if (match.matchKind === 'inside_polygon' && match.severity !== 'unknown') return 'high';
  if (match.matchKind === 'inside_polygon') return 'medium';
  if (match.matchKind === 'inside_zone') return 'medium';
  if (match.matchKind === 'near_polygon') return 'medium';
  return 'low';
}

function buildTitle(match: PolygonMatchResult, placeLabel: string | undefined): string {
  const event = match.event;
  if (placeLabel) {
    if (match.matchKind === 'inside_polygon' || match.matchKind === 'inside_zone') {
      return `${event} — ${placeLabel}`;
    }
    return `${event} near ${placeLabel}`;
  }
  return event;
}

const MAIN_THREAT_LABELS: Record<WeatherHazardKind, string> = {
  tornado: 'destructive rotation + flying debris',
  severe_thunderstorm: 'damaging wind + large hail',
  flash_flood: 'rapid water rise on roads + low-lying areas',
  flood: 'rising rivers + extended-duration flooding',
  high_wind: 'damaging wind',
  winter_storm: 'snow + ice + travel disruption',
  blizzard: 'whiteout snow + life-threatening cold',
  ice_storm: 'freezing rain + extended outages',
  extreme_heat: 'dangerous heat — health risk',
  extreme_cold: 'dangerous cold — frostbite risk',
  fire_weather: 'critical fire spread conditions',
  wildfire_smoke: 'hazardous wildfire smoke / poor air quality',
  tropical: 'tropical-system winds + flooding',
  storm_surge: 'coastal inundation',
  special_marine: 'sudden severe marine wind / waterspout',
  dust_storm: 'zero-visibility blowing dust',
  other: 'severe weather threat',
};

function mainThreatLabelFor(hazard: WeatherHazardKind): string {
  return MAIN_THREAT_LABELS[hazard];
}

const NEXT_UPDATE_LABELS: Record<WeatherHazardKind, string> = {
  tornado: 'Next radar scan in 5 min',
  severe_thunderstorm: 'Next radar scan in 5 min',
  flash_flood: 'Next gauge update in ~10 min',
  flood: 'Next river forecast in ~1 hour',
  high_wind: 'Next observation in ~15 min',
  winter_storm: 'Next forecast update in ~1 hour',
  blizzard: 'Next forecast update in ~1 hour',
  ice_storm: 'Next forecast update in ~1 hour',
  extreme_heat: 'Next observation in ~1 hour',
  extreme_cold: 'Next observation in ~1 hour',
  fire_weather: 'Next outlook in ~6 hours',
  wildfire_smoke: 'Next air quality update in ~1 hour',
  tropical: 'Next NHC advisory in ~3-6 hours',
  storm_surge: 'Next NHC advisory in ~3-6 hours',
  special_marine: 'Next radar scan in 5 min',
  dust_storm: 'Next observation in ~30 min',
  other: 'Monitor NWS for the next update',
};

function nextUpdateLabelFor(hazard: WeatherHazardKind): string {
  return NEXT_UPDATE_LABELS[hazard];
}

function defaultIncludeOutage(hazard: WeatherHazardKind): boolean {
  return ['severe_thunderstorm', 'tornado', 'high_wind', 'ice_storm', 'tropical', 'winter_storm']
    .includes(hazard);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function angleBetween(a: number, b: number): number {
  // Normalize to [0, 360), then return the smaller arc.
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
