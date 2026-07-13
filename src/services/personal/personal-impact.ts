/**
 * Personal Impact Engine — gap #14 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Maps incoming events to the user's personal exposure surface
 * (saved places, watched entities, portfolio holdings, travel
 * routes, utility dependencies) and produces a PersonalImpactReport
 * the Command Center, Storm Mode, and shareable export bundle can
 * consume.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Inputs are explicit; outputs are JSON-serializable.
 *
 * Plan invariants:
 *   - Every reported impact carries a category, severity, plain-English
 *     description, and the specific exposure(s) it touches
 *   - "ignore unless this changes" suppression is explicit — events
 *     below the relevance floor produce a `dormant` impact entry
 *     so the user can still inspect them on demand
 *   - Output is JSON-serializable for the diagnostics export bundle
 */

// ── Public API ──────────────────────────────────────────────────────────

export type ImpactCategory =
  | 'immediate_risk'      // life/safety — severe weather, evacuation, etc.
  | 'financial'           // portfolio / commodity exposure
  | 'travel'              // routes, airports, vessels you depend on
  | 'utility'             // power / fuel / water dependencies
  | 'family_place'        // saved places + people you care about
  | 'dormant';            // no personal exposure or below the relevance floor; surfaced on demand

export type ImpactSeverity = 'critical' | 'elevated' | 'watch' | 'low' | 'none';

export interface SavedPlace {
  /** Stable id for cross-references. */
  placeId: string;
  /** Human-readable label ("Home", "Mom's house"). */
  label: string;
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;
  /** Optional UGC zone id for NWS fallback matching. */
  ugcZoneId?: string;
  /** Free-text role: 'home', 'work', 'family', 'travel'. */
  role?: 'home' | 'work' | 'family' | 'travel' | 'other';
}

export interface WatchedEntity {
  entityId: string;
  /** 'ticker' | 'country' | 'company' | 'commodity' | 'vessel' | 'flight' | 'cve' | … */
  kind: string;
  label: string;
}

export interface PortfolioHolding {
  /** Ticker, commodity symbol, or sector code. */
  symbol: string;
  /** Notional weight in the portfolio 0..1. */
  weight: number;
  /** Free-text sector ("energy", "technology"). */
  sector?: string;
}

export interface TravelRoute {
  routeId: string;
  /** Free-text origin/dest pair ("ORD → DEN"). */
  description: string;
  /** Travel window — ms since epoch. */
  startsAt: number;
  endsAt: number;
}

export interface UtilityDependency {
  utilityId: string;
  /** 'power' | 'fuel' | 'water' | 'gas' | 'internet' | 'mobile'. */
  kind: 'power' | 'fuel' | 'water' | 'gas' | 'internet' | 'mobile';
  /** Place this utility supports. */
  placeId: string;
}

export interface PersonalProfile {
  savedPlaces: readonly SavedPlace[];
  watchedEntities: readonly WatchedEntity[];
  portfolio: readonly PortfolioHolding[];
  travelRoutes: readonly TravelRoute[];
  utilities: readonly UtilityDependency[];
}

export interface IncomingEvent {
  eventId: string;
  /** Free-text description. */
  description: string;
  /** Domain string ('weather', 'cyber', 'market', 'shortage', …). */
  domain: string;
  /** 0-100 severity from the upstream signal. */
  severity: number;
  /** ms timestamp. */
  at: number;
  /** Optional location (matches saved places by lat/lng + radius). */
  location?: {
    latitude: number;
    longitude: number;
    /** Optional radius in km — events within this distance match. */
    radiusKm?: number;
    /** Optional UGC zone id for fast match. */
    ugcZoneId?: string;
  };
  /** Optional symbols / tickers / commodities / countries this event touches. */
  affectedSymbols?: readonly string[];
  /** Optional entities the event mentions. */
  affectedEntities?: readonly string[];
  /** Optional utility kinds the event impacts ('power' / 'fuel' / …). */
  affectedUtilities?: readonly UtilityDependency['kind'][];
}

export interface ImpactExposure {
  /** Stable id of the matching personal exposure. */
  exposureId: string;
  /** Plain-English label ("Home", "AAPL", "ORD → DEN"). */
  label: string;
  /** Why this exposure matched (proximity, ticker overlap, etc.). */
  reason: string;
}

export interface PersonalImpact {
  eventId: string;
  category: ImpactCategory;
  severity: ImpactSeverity;
  /** Plain-English summary. */
  description: string;
  /** Specific exposures the event touches. */
  exposures: readonly ImpactExposure[];
  /** Concrete next action the user can take. */
  recommendedAction: string;
  /** Why this should not be suppressed (or why it is). */
  reason: string;
}

export interface PersonalImpactReport {
  generatedAt: number;
  /** Sorted by severity desc, then by event time desc. */
  impacts: readonly PersonalImpact[];
  /** "2 critical, 4 elevated, 3 watch, 5 dormant." */
  summary: string;
  /** Top concrete actions the user should take. */
  recommendations: readonly string[];
}

export interface MapEventsOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
  /** Default match radius in km when an event has no explicit one.
   *  Default 25 km. */
  defaultMatchRadiusKm?: number;
  /** Severity below this stays as "dormant" — visible on demand but
   *  not in the main impact list. Default 25. */
  dormantSeverityFloor?: number;
}

// ── Engine ──────────────────────────────────────────────────────────────

const DEFAULT_RADIUS_KM = 25;
const DEFAULT_DORMANT_FLOOR = 25;

export function mapEventsToPersonalImpact(
  profile: PersonalProfile,
  events: readonly IncomingEvent[],
  options: MapEventsOptions = {},
): PersonalImpactReport {
  const now = options.now ?? (() => Date.now());
  const radius = options.defaultMatchRadiusKm ?? DEFAULT_RADIUS_KM;
  const floor = options.dormantSeverityFloor ?? DEFAULT_DORMANT_FLOOR;

  const impacts: PersonalImpact[] = [];
  for (const event of events) {
    const exposures = collectExposures(event, profile, radius);
    const category = decideCategory(event, exposures, profile);
    const severity = decideSeverity(event, exposures, floor);
    impacts.push({
      eventId: event.eventId,
      category,
      severity,
      description: event.description,
      exposures,
      recommendedAction: pickRecommendedAction(category, severity, exposures),
      reason: buildReason(event, exposures, severity),
    });
  }
  impacts.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sb !== sa) return sb - sa;
    const ea = events.find((e) => e.eventId === a.eventId)?.at ?? 0;
    const eb = events.find((e) => e.eventId === b.eventId)?.at ?? 0;
    return eb - ea;
  });
  return {
    generatedAt: now(),
    impacts,
    summary: describeSummary(impacts),
    recommendations: collectRecommendations(impacts),
  };
}

// ── Exposure matching ──────────────────────────────────────────────────

function collectExposures(
  event: IncomingEvent,
  profile: PersonalProfile,
  defaultRadiusKm: number,
): ImpactExposure[] {
  return [
    ...matchPlaceExposures(event, profile.savedPlaces, defaultRadiusKm),
    ...matchSymbolExposures(event, profile.portfolio),
    ...matchEntityExposures(event, profile.watchedEntities),
    ...matchUtilityExposures(event, profile.utilities),
    ...matchRouteExposures(event, profile.travelRoutes),
  ];
}

function matchPlaceExposures(
  event: IncomingEvent,
  places: readonly SavedPlace[],
  defaultRadiusKm: number,
): ImpactExposure[] {
  if (!event.location) return [];
  const radius = event.location.radiusKm ?? defaultRadiusKm;
  const out: ImpactExposure[] = [];
  for (const place of places) {
    const match = matchOnePlace(event, place, radius);
    if (match) out.push(match);
  }
  return out;
}

function matchOnePlace(
  event: IncomingEvent,
  place: SavedPlace,
  radius: number,
): ImpactExposure | undefined {
  if (!event.location) return undefined;
  const km = haversineKm(event.location.latitude, event.location.longitude, place.latitude, place.longitude);
  if (km <= radius) {
    return {
      exposureId: place.placeId,
      label: place.label,
      reason: `${km.toFixed(1)} km from ${place.label}`,
    };
  }
  if (event.location.ugcZoneId && place.ugcZoneId === event.location.ugcZoneId) {
    return {
      exposureId: place.placeId,
      label: place.label,
      reason: `Matches UGC zone ${event.location.ugcZoneId}`,
    };
  }
  return undefined;
}

function matchSymbolExposures(
  event: IncomingEvent,
  portfolio: readonly PortfolioHolding[],
): ImpactExposure[] {
  if (!event.affectedSymbols || event.affectedSymbols.length === 0) return [];
  const symbols = new Set(event.affectedSymbols);
  return portfolio
    .filter((h) => symbols.has(h.symbol))
    .map((h) => ({
      exposureId: `holding:${h.symbol}`,
      label: h.symbol,
      reason: `Portfolio weight ${(h.weight * 100).toFixed(1)}%`,
    }));
}

function matchEntityExposures(
  event: IncomingEvent,
  watched: readonly WatchedEntity[],
): ImpactExposure[] {
  if (!event.affectedEntities || event.affectedEntities.length === 0) return [];
  const entities = new Set(event.affectedEntities);
  return watched
    .filter((w) => entities.has(w.entityId))
    .map((w) => ({
      exposureId: `watch:${w.entityId}`,
      label: w.label,
      reason: `Watching ${w.kind}`,
    }));
}

function matchUtilityExposures(
  event: IncomingEvent,
  utilities: readonly UtilityDependency[],
): ImpactExposure[] {
  if (!event.affectedUtilities || event.affectedUtilities.length === 0) return [];
  const kinds = new Set(event.affectedUtilities);
  return utilities
    .filter((u) => kinds.has(u.kind))
    .map((u) => ({
      exposureId: `utility:${u.utilityId}`,
      label: `${u.kind} for ${u.placeId}`,
      reason: `Utility kind ${u.kind} touches ${u.placeId}`,
    }));
}

function matchRouteExposures(
  event: IncomingEvent,
  routes: readonly TravelRoute[],
): ImpactExposure[] {
  return routes
    .filter((r) => event.at >= r.startsAt && event.at <= r.endsAt)
    .map((r) => ({
      exposureId: `route:${r.routeId}`,
      label: r.description,
      reason: 'Event during travel window',
    }));
}

// ── Category / severity decision ───────────────────────────────────────

function decideCategory(
  event: IncomingEvent,
  exposures: readonly ImpactExposure[],
  profile: PersonalProfile,
): ImpactCategory {
  if (exposures.length === 0) return 'dormant';
  if (event.domain === 'weather' || event.domain === 'safety' || event.domain === 'disaster') {
    return matchesHomeOrFamily(exposures, profile) ? 'family_place' : 'immediate_risk';
  }
  if (event.affectedUtilities && event.affectedUtilities.length > 0) return 'utility';
  if (event.affectedSymbols && event.affectedSymbols.length > 0) return 'financial';
  if (matchesTravelWindow(exposures)) return 'travel';
  return 'immediate_risk';
}

function matchesHomeOrFamily(
  exposures: readonly ImpactExposure[],
  profile: PersonalProfile,
): boolean {
  return exposures.some((e) => {
    const place = profile.savedPlaces.find((p) => p.placeId === e.exposureId);
    return place && (place.role === 'home' || place.role === 'family');
  });
}

function matchesTravelWindow(exposures: readonly ImpactExposure[]): boolean {
  return exposures.some((e) => e.exposureId.startsWith('route:'));
}

function decideSeverity(
  event: IncomingEvent,
  exposures: readonly ImpactExposure[],
  dormantFloor: number,
): ImpactSeverity {
  if (exposures.length === 0) return event.severity < dormantFloor ? 'none' : 'low';
  if (event.severity < dormantFloor) return 'low';
  if (event.severity < 50) return 'watch';
  if (event.severity < 75) return 'elevated';
  return 'critical';
}

const CRITICAL_ACTION_BY_CATEGORY: Record<ImpactCategory, string> = {
  immediate_risk: 'Take protective action now and notify the people at the affected place.',
  family_place: 'Take protective action now and notify the people at the affected place.',
  utility: 'Confirm backup utility plans (generator, alternate fuel, alternate water).',
  financial: 'Review portfolio exposure and prepared hedges before the next session open.',
  travel: 'Re-route or postpone travel; confirm with airline/carrier.',
  dormant: '',
};

function pickRecommendedAction(
  category: ImpactCategory,
  severity: ImpactSeverity,
  exposures: readonly ImpactExposure[],
): string {
  if (severity === 'critical') return CRITICAL_ACTION_BY_CATEGORY[category];
  if (severity === 'elevated') {
    const noun = exposures.length === 1 ? 'exposure' : 'exposures';
    return `Monitor closely — ${exposures.length} personal ${noun} touched.`;
  }
  if (severity === 'watch') return 'Add to watchlist for the next 24 hours.';
  if (severity === 'low') return 'No action required — surface only if escalates.';
  return '';
}

function buildReason(
  event: IncomingEvent,
  exposures: readonly ImpactExposure[],
  severity: ImpactSeverity,
): string {
  if (severity === 'none') return 'Below relevance floor and no personal exposure.';
  if (exposures.length === 0) return `Severity ${event.severity}/100; no direct personal exposure detected.`;
  const top = exposures.slice(0, 3).map((e) => e.label).join(', ');
  return `Touches ${exposures.length} exposure${exposures.length === 1 ? '' : 's'}: ${top}`;
}

// ── Roll-up + recommendations ──────────────────────────────────────────

const SEVERITY_RANK: Record<ImpactSeverity, number> = {
  none: 0,
  low: 1,
  watch: 2,
  elevated: 3,
  critical: 4,
};

function describeSummary(impacts: readonly PersonalImpact[]): string {
  if (impacts.length === 0) return 'No incoming events.';
  const tally = { critical: 0, elevated: 0, watch: 0, low: 0, none: 0 };
  for (const i of impacts) tally[i.severity] += 1;
  const parts: string[] = [];
  if (tally.critical) parts.push(`${tally.critical} critical`);
  if (tally.elevated) parts.push(`${tally.elevated} elevated`);
  if (tally.watch) parts.push(`${tally.watch} watch`);
  const dormantCount = tally.low + tally.none;
  if (dormantCount) parts.push(`${dormantCount} dormant`);
  return `Personal impacts: ${parts.join(', ')}.`;
}

function collectRecommendations(impacts: readonly PersonalImpact[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of impacts) {
    if (i.severity === 'low' || i.severity === 'none') continue;
    if (!i.recommendedAction) continue;
    const rec = `${i.description}: ${i.recommendedAction}`;
    if (seen.has(rec)) continue;
    seen.add(rec);
    out.push(rec);
    if (out.length >= 6) break;
  }
  return out;
}

// ── Geometry helper ────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
