/**
 * Per-saved-place threat aggregator.
 *
 * Pure deterministic. Takes typed domain snapshots (seismic / wildfire /
 * weather / infrastructure) plus a SavedPlace, normalises each to the
 * existing `IncomingEvent` shape `personal-impact` expects, and returns
 * a per-place summary (counts by severity + by domain + top impacts).
 *
 * No DOM, no fetch, no globals. The renderer wires this into
 * SavedPlacesPanel; the sidecar can also expose it via /api/places/threats
 * once cross-domain data is consolidated server-side.
 *
 * Plan invariants:
 *   - Severity scoring is documented per-domain so future tuning has a
 *     reference point. Default heuristics are conservative; tests pin
 *     the boundary cases.
 *   - Adapter input shapes are loose (`readonly` with all-optional
 *     extras) so callers can pass whatever the existing services
 *     produce without first running them through a normaliser.
 *   - Output is JSON-serializable.
 */

import {
  mapEventsToPersonalImpact,
  type IncomingEvent,
  type PersonalImpact,
  type PersonalProfile,
  type SavedPlace as PersonalSavedPlace,
} from './personal-impact';

// ── Public types ───────────────────────────────────────────────────────

export interface SeismicSnapshotEvent {
  id: string;
  lat: number;
  lon: number;
  /** Moment magnitude (or estimated). `null` when not yet computed. */
  magnitude: number | null;
  /** Hypocentre depth in km. `null` when unknown. */
  depthKm: number | null;
  /** ms epoch of origin time. */
  occurredAt: number;
  /** Free-text place description from upstream. */
  place?: string;
}

export interface WildfireSnapshotEvent {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** Burned area in acres. `null` when not reported. */
  acres: number | null;
  /** ms epoch of the most recent NIFC update. */
  reportedAt: number;
  /** "active" | "contained" | "controlled" | "out". Free-text. */
  status?: string;
  /** Containment percentage 0..100. `null` when unknown. */
  containment?: number | null;
}

export type NwsSeverityLabel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface WeatherSnapshotEvent {
  id: string;
  /** Event label ("Tornado Warning", "Heat Advisory", …). */
  event: string;
  areaDesc: string;
  effective: string;
  expires: string;
  severity: NwsSeverityLabel;
  /** Centroid for distance check. `null` when polygon-only. */
  centroidLat?: number;
  centroidLon?: number;
  /** UGC zone id for fast match. */
  ugcZoneId?: string;
}

export interface InfrastructureSnapshotEvent {
  id: string;
  /** Outage type ('power' | 'fuel' | 'water' | …). */
  kind: 'power' | 'fuel' | 'water' | 'gas' | 'internet' | 'mobile';
  /** County / area name for human display. */
  county: string;
  lat: number;
  lon: number;
  /** ms epoch of outage start. */
  outageStartedAt: number;
  /** Customers affected. `null` when not reported. */
  affectedCustomers: number | null;
}

export interface DomainThreatSnapshot {
  seismic?: readonly SeismicSnapshotEvent[];
  wildfire?: readonly WildfireSnapshotEvent[];
  weather?: readonly WeatherSnapshotEvent[];
  infrastructure?: readonly InfrastructureSnapshotEvent[];
}

export interface PerPlaceThreatSummary {
  placeId: string;
  placeName: string;
  /** Total events of any domain inside the saved place's radius. */
  totalThreatCount: number;
  severityBuckets: { critical: number; elevated: number; watch: number; low: number };
  domainBreakdown: { seismic: number; wildfire: number; weather: number; infrastructure: number };
  /** Top 5 impacts (highest severity first). */
  topThreats: PersonalImpact[];
}

export interface AggregateOptions {
  /** ms epoch — used for travel-window matching + sorting. Defaults to
   *  Date.now(). Tests inject. */
  now?: () => number;
}

// ── Adapter functions ──────────────────────────────────────────────────

/** Severity scoring rationale (constants exported so tests + UI can
 *  reference the same numbers).
 *  - **Seismic**: M2-3 → 30, M3-4 → 50, M4-5 → 70, M5+ → 90. Distance
 *    isn't folded in here because `personal-impact` already filters by
 *    proximity radius — events outside the place's radius are dropped.
 *  - **Wildfire**: Active fire 70 baseline, +5 per 1000 acres up to 95.
 *    Contained fires drop to 35 (still surfaced; smoke + flare-up risk).
 *  - **Weather**: maps NWS severity directly (Extreme=95, Severe=80,
 *    Moderate=55, Minor=30, Unknown=40).
 *  - **Infrastructure**: 100k+ customers affected = 80, 10k+ = 65,
 *    1k+ = 50, otherwise 35. */
export const SEVERITY_THRESHOLDS = {
  seismic: { m2: 30, m3: 50, m4: 70, m5: 90 },
  wildfire: { activeBase: 70, perThousandAcres: 5, max: 95, contained: 35 },
  weather: {
    Extreme: 95, Severe: 80, Moderate: 55, Minor: 30, Unknown: 40,
  } as const,
  infrastructure: { huge: 80, large: 65, medium: 50, small: 35 },
} as const;

function radiusForMagnitude(mag: number): number {
  // USGS rule of thumb: M5 ≈ 50 km, M6 ≈ 150 km, M7 ≈ 400 km felt-radius.
  if (mag >= 7) return 400;
  if (mag >= 6) return 150;
  if (mag >= 5) return 50;
  return 25;
}

function severityForMagnitude(mag: number): number {
  if (mag >= 5) return SEVERITY_THRESHOLDS.seismic.m5;
  if (mag >= 4) return SEVERITY_THRESHOLDS.seismic.m4;
  if (mag >= 3) return SEVERITY_THRESHOLDS.seismic.m3;
  if (mag > 0) return SEVERITY_THRESHOLDS.seismic.m2;
  return 0;
}

export function seismicToIncoming(event: SeismicSnapshotEvent): IncomingEvent {
  const mag = event.magnitude ?? 0;
  const severity = severityForMagnitude(mag);
  const magText = event.magnitude === null ? '' : `M${event.magnitude.toFixed(1)} `;
  const placeText = event.place ? ` near ${event.place}` : '';
  return {
    eventId: `seismic:${event.id}`,
    description: `${magText}earthquake${placeText}`.trim(),
    domain: 'seismic',
    severity,
    at: event.occurredAt,
    location: {
      latitude: event.lat,
      longitude: event.lon,
      radiusKm: radiusForMagnitude(mag),
    },
  };
}

export function wildfireToIncoming(event: WildfireSnapshotEvent): IncomingEvent {
  const status = (event.status ?? '').toLowerCase();
  const isContained = status === 'contained' || status === 'out' || (event.containment ?? 0) >= 95;
  const acresK = (event.acres ?? 0) / 1000;
  const activeBase = SEVERITY_THRESHOLDS.wildfire.activeBase + acresK * SEVERITY_THRESHOLDS.wildfire.perThousandAcres;
  const severity = isContained
    ? SEVERITY_THRESHOLDS.wildfire.contained
    : Math.min(SEVERITY_THRESHOLDS.wildfire.max, activeBase);
  const acresText = event.acres === null ? '' : ` ${event.acres.toLocaleString()} acres`;
  return {
    eventId: `wildfire:${event.id}`,
    description: `Wildfire ${event.name}${acresText}${isContained ? ' (contained)' : ''}`,
    domain: 'wildfire',
    severity,
    at: event.reportedAt,
    location: {
      latitude: event.lat,
      longitude: event.lon,
      // Smoke + ember-cast reach scales with size; cap radius at 80 km.
      radiusKm: Math.min(80, 10 + Math.sqrt(event.acres ?? 0) / 5),
    },
  };
}

export function weatherToIncoming(event: WeatherSnapshotEvent): IncomingEvent | null {
  const hasCentroid = event.centroidLat !== undefined && event.centroidLon !== undefined;
  if (!hasCentroid && !event.ugcZoneId) return null; // no way to match
  const severity = SEVERITY_THRESHOLDS.weather[event.severity] ?? SEVERITY_THRESHOLDS.weather.Unknown;
  return {
    eventId: `weather:${event.id}`,
    description: `${event.event}: ${event.areaDesc}`,
    domain: 'weather',
    severity,
    at: Date.parse(event.effective) || 0,
    location: {
      latitude: event.centroidLat ?? 0,
      longitude: event.centroidLon ?? 0,
      // Wider radius for area-wide alerts so a centroid match isn't
      // missed when the place sits at the alert polygon's edge.
      radiusKm: 75,
      ugcZoneId: event.ugcZoneId,
    },
  };
}

function severityForCustomers(customers: number): number {
  if (customers >= 100_000) return SEVERITY_THRESHOLDS.infrastructure.huge;
  if (customers >= 10_000) return SEVERITY_THRESHOLDS.infrastructure.large;
  if (customers >= 1000) return SEVERITY_THRESHOLDS.infrastructure.medium;
  return SEVERITY_THRESHOLDS.infrastructure.small;
}

export function infrastructureToIncoming(event: InfrastructureSnapshotEvent): IncomingEvent {
  const customers = event.affectedCustomers ?? 0;
  const severity = severityForCustomers(customers);
  const customerText = event.affectedCustomers === null
    ? ''
    : ` (${event.affectedCustomers.toLocaleString()} customers)`;
  return {
    eventId: `infra:${event.id}`,
    description: `${event.kind} outage in ${event.county}${customerText}`,
    domain: 'infrastructure',
    severity,
    at: event.outageStartedAt,
    location: {
      latitude: event.lat,
      longitude: event.lon,
      // Outage county footprint — typical US county is ~50 km across.
      radiusKm: 50,
    },
    affectedUtilities: [event.kind],
  };
}

// ── Top-level aggregator ──────────────────────────────────────────────

/**
 * Per-place threat summary across the four domains. Filters by the
 * place's match radius via `personal-impact`, buckets by severity +
 * domain, and returns the top 5 most-severe touched threats.
 *
 * Pass an empty `DomainThreatSnapshot` when a domain isn't loaded yet —
 * the summary's domain count just reads zero.
 */
export function aggregatePerPlaceThreats(
  place: PersonalSavedPlace,
  snapshot: DomainThreatSnapshot,
  options: AggregateOptions = {},
): PerPlaceThreatSummary {
  const incoming: IncomingEvent[] = [
    ...(snapshot.seismic ?? []).map((e) => seismicToIncoming(e)),
    ...(snapshot.wildfire ?? []).map((e) => wildfireToIncoming(e)),
    ...(snapshot.weather ?? []).map((e) => weatherToIncoming(e)).filter((e): e is IncomingEvent => e !== null),
    ...(snapshot.infrastructure ?? []).map((e) => infrastructureToIncoming(e)),
  ];
  const profile: PersonalProfile = {
    savedPlaces: [place],
    watchedEntities: [],
    portfolio: [],
    travelRoutes: [],
    utilities: [],
  };
  const report = mapEventsToPersonalImpact(profile, incoming, { now: options.now });
  // Only keep impacts that actually touched THIS place. A direct
  // exposure-id match works because our profile only carries one place.
  const touched = report.impacts.filter((i) =>
    i.exposures.some((e) => e.exposureId === place.placeId)
  );
  const severityBuckets = { critical: 0, elevated: 0, watch: 0, low: 0 };
  const domainBreakdown = { seismic: 0, wildfire: 0, weather: 0, infrastructure: 0 };
  for (const impact of touched) {
    if (impact.severity === 'critical') severityBuckets.critical += 1;
    else if (impact.severity === 'elevated') severityBuckets.elevated += 1;
    else if (impact.severity === 'watch') severityBuckets.watch += 1;
    else if (impact.severity === 'low') severityBuckets.low += 1;
    const domain = impact.eventId.split(':')[0] ?? '';
    if (domain === 'seismic') domainBreakdown.seismic += 1;
    else if (domain === 'wildfire') domainBreakdown.wildfire += 1;
    else if (domain === 'weather') domainBreakdown.weather += 1;
    else if (domain === 'infra') domainBreakdown.infrastructure += 1;
  }
  return {
    placeId: place.placeId,
    placeName: place.label,
    totalThreatCount: touched.length,
    severityBuckets,
    domainBreakdown,
    topThreats: touched.slice(0, 5),
  };
}

// ── Helper: adapt the existing rich SavedPlace shape ───────────────────

function roleFromTags(tags: readonly string[] | undefined): PersonalSavedPlace['role'] {
  if (!tags) return 'other';
  if (tags.includes('home')) return 'home';
  if (tags.includes('work')) return 'work';
  if (tags.includes('family')) return 'family';
  if (tags.includes('travel')) return 'travel';
  return 'other';
}

/** Adapt the production `SavedPlace` (from `src/services/saved-places`)
 *  to the `personal-impact` engine's slimmer shape. Convenience for
 *  callers who use the localStorage store. */
export function adaptSavedPlace(raw: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags?: readonly string[];
  ugcZoneId?: string;
}): PersonalSavedPlace {
  return {
    placeId: raw.id,
    label: raw.name,
    latitude: raw.lat,
    longitude: raw.lon,
    role: roleFromTags(raw.tags),
    ugcZoneId: raw.ugcZoneId,
  };
}

// Re-export the haversine the existing engine uses (handy for the
// panel which renders distances next to badges).
export { haversineKm } from './personal-impact';
