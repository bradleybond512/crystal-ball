/**
 * Historical sequence pattern matching — Layer 5.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Given a query event (the new earthquake) and a catalog of historical
 * candidates (typically pulled from USGS FDSN within a 50 km / ±0.5 M /
 * ±30 km depth box), `findHistoricalAnalogs` produces the top-K analogs
 * ranked by a weighted match score in [0, 1].
 *
 * Plan invariants:
 *   - Location is the dominant signal (40% weight). Magnitude is next
 *     (30%), then depth (20%), then focal mechanism similarity (10%).
 *     Weights are exposed via `MatchWeights` so callers can experiment.
 *   - Missing data does not invent confidence: when a candidate's depth
 *     or fault type is unknown, those components score 0.5 (neutral) so
 *     the analog isn't penalised for thin metadata.
 *   - Pure ranking. Sidecar `/api/historical-analogs?eventId={id}` is a
 *     thin USGS FDSN passthrough; this module does the scoring and
 *     ranking deterministically over plain JSON.
 *   - Self-matches are excluded. A candidate with the same id as the
 *     query is silently dropped — the new event must not appear as its
 *     own analog.
 */

import type { FaultType } from './focal-classifier';

// ── Public types ────────────────────────────────────────────────────────

export interface QueryEvent {
  /** Stable id for self-match exclusion. */
  id: string;
  lat: number;
  lon: number;
  /** Hypocentral depth in km. `null` when unknown. */
  depthKm: number | null;
  magnitude: number;
  faultType?: FaultType;
}

export interface CatalogEvent {
  id: string;
  lat: number;
  lon: number;
  depthKm: number | null;
  magnitude: number;
  /** ms epoch of origin time, or ISO date string. */
  occurredAt: number | string;
  place?: string;
  faultType?: FaultType;
  /** Largest aftershock magnitude observed in the analog's sequence,
   *  if known. Surfaced so the caller can answer "what came next?". */
  subsequentLargestAftershock?: number;
  /** Whether the analog produced an observed (not just warning)
   *  tsunami. */
  subsequentTsunamiObserved?: boolean;
  notes?: string;
}

export interface MatchWeights {
  location: number;
  magnitude: number;
  depth: number;
  focal: number;
}

export interface MatchSearchBox {
  /** Maximum great-circle distance (km) for a candidate to be in scope.
   *  Default 50. */
  maxRadiusKm: number;
  /** Maximum magnitude delta for in-scope candidates. Default 0.5. */
  maxMagnitudeDelta: number;
  /** Maximum depth delta (km). Default 30. */
  maxDepthDeltaKm: number;
}

export interface HistoricalAnalog {
  /** Echoes the query event id so callers can correlate UI rows. */
  eventId: string;
  analogEventId: string;
  /** ISO date string for display. */
  analogDate: string;
  analogMagnitude: number;
  analogDepth: number | null;
  /** 0..1 match quality. 1 = perfect match across all components. */
  matchScore: number;
  /** Per-component scores so the UI can explain the match. */
  components: {
    location: number;
    magnitude: number;
    depth: number;
    focal: number;
  };
  distanceKm: number;
  subsequentLargestAftershock?: number;
  subsequentTsunamiObserved?: boolean;
  notes?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  location: 0.4,
  magnitude: 0.3,
  depth: 0.2,
  focal: 0.1,
};

export const DEFAULT_SEARCH_BOX: MatchSearchBox = {
  maxRadiusKm: 50,
  maxMagnitudeDelta: 0.5,
  maxDepthDeltaKm: 30,
};

// ── Public API ──────────────────────────────────────────────────────────

export interface FindAnalogsOptions {
  weights?: Partial<MatchWeights>;
  searchBox?: Partial<MatchSearchBox>;
  limit?: number;
}

/**
 * Score a catalog candidate against a query event. Returns null when the
 * candidate falls outside the search box on any axis (location radius,
 * magnitude delta, depth delta when both depths are known).
 */
export function scoreAnalog(
  query: QueryEvent,
  candidate: CatalogEvent,
  weights: MatchWeights = DEFAULT_MATCH_WEIGHTS,
  searchBox: MatchSearchBox = DEFAULT_SEARCH_BOX,
): HistoricalAnalog | null {
  if (candidate.id === query.id) return null;
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) return null;
  if (!Number.isFinite(candidate.magnitude)) return null;

  const distanceKm = haversineKm(query.lat, query.lon, candidate.lat, candidate.lon);
  if (distanceKm > searchBox.maxRadiusKm) return null;

  const magnitudeDelta = Math.abs(candidate.magnitude - query.magnitude);
  if (magnitudeDelta > searchBox.maxMagnitudeDelta) return null;

  if (
    query.depthKm !== null
    && candidate.depthKm !== null
    && Math.abs((candidate.depthKm ?? 0) - (query.depthKm ?? 0)) > searchBox.maxDepthDeltaKm
  ) {
    return null;
  }

  const locationScore = clamp01(1 - distanceKm / searchBox.maxRadiusKm);
  const magnitudeScore = clamp01(1 - magnitudeDelta / searchBox.maxMagnitudeDelta);

  const depthScore =
    query.depthKm === null || candidate.depthKm === null
      ? 0.5
      : clamp01(1 - Math.abs(candidate.depthKm - query.depthKm) / searchBox.maxDepthDeltaKm);

  const focalScore = scoreFocalMatch(query.faultType, candidate.faultType);

  const totalWeight =
    weights.location + weights.magnitude + weights.depth + weights.focal;
  const matchScore =
    totalWeight === 0
      ? 0
      : (locationScore * weights.location
        + magnitudeScore * weights.magnitude
        + depthScore * weights.depth
        + focalScore * weights.focal)
        / totalWeight;

  return {
    eventId: query.id,
    analogEventId: candidate.id,
    analogDate: toIsoDate(candidate.occurredAt),
    analogMagnitude: candidate.magnitude,
    analogDepth: candidate.depthKm,
    matchScore: clamp01(matchScore),
    components: {
      location: locationScore,
      magnitude: magnitudeScore,
      depth: depthScore,
      focal: focalScore,
    },
    distanceKm,
    subsequentLargestAftershock: candidate.subsequentLargestAftershock,
    subsequentTsunamiObserved: candidate.subsequentTsunamiObserved,
    notes: candidate.notes,
  };
}

/**
 * Return the top-K analogs for `query` from `catalog`, ranked by
 * `matchScore` descending. Default K is 5, default search box is the
 * plan's 50 km / ±0.5 M / ±30 km box.
 */
export function findHistoricalAnalogs(
  query: QueryEvent,
  catalog: readonly CatalogEvent[],
  options: FindAnalogsOptions = {},
): HistoricalAnalog[] {
  const weights = { ...DEFAULT_MATCH_WEIGHTS, ...options.weights };
  const searchBox = { ...DEFAULT_SEARCH_BOX, ...options.searchBox };
  const limit = options.limit ?? 5;

  const scored: HistoricalAnalog[] = [];
  for (const candidate of catalog) {
    const result = scoreAnalog(query, candidate, weights, searchBox);
    if (result) scored.push(result);
  }
  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    // Stable secondary key: smaller distance wins on ties so the ranking
    // is deterministic regardless of input order.
    return a.distanceKm - b.distanceKm;
  });
  return scored.slice(0, Math.max(0, limit));
}

/**
 * Parse a USGS FDSN GeoJSON FeatureCollection (the response from the
 * historical-analogs sidecar passthrough) into `CatalogEvent[]`. Drops
 * features that lack location or magnitude.
 */
export function parseUsgsCatalog(payload: unknown): CatalogEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const out: CatalogEvent[] = [];
  for (const f of features) {
    const event = parseCatalogFeature(f);
    if (event) out.push(event);
  }
  return out;
}

function parseCatalogFeature(f: unknown): CatalogEvent | null {
  if (!f || typeof f !== 'object') return null;
  const obj = f as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string') return null;

  const props = obj.properties;
  if (!props || typeof props !== 'object') return null;
  const geom = obj.geometry;
  if (!geom || typeof geom !== 'object') return null;

  const coords = (geom as Record<string, unknown>).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  const mag = Number((props as Record<string, unknown>).mag);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) return null;

  const depthRaw = coords.length >= 3 ? Number(coords[2]) : null;
  const place = (props as Record<string, unknown>).place;

  return {
    id,
    lat,
    lon,
    depthKm: depthRaw !== null && Number.isFinite(depthRaw) ? depthRaw : null,
    magnitude: mag,
    occurredAt: parseOccurredAt((props as Record<string, unknown>).time),
    place: typeof place === 'string' ? place : undefined,
  };
}

function parseOccurredAt(time: unknown): string {
  if (typeof time === 'number' && Number.isFinite(time)) {
    return new Date(time).toISOString();
  }
  if (typeof time === 'string') return time;
  return '';
}

// ── Internal helpers ───────────────────────────────────────────────────

function scoreFocalMatch(a?: FaultType, b?: FaultType): number {
  // Both unknown → neutral (don't penalise thin metadata).
  if (!a && !b) return 1;
  // One unknown → mildly neutral; we don't know enough to credit or fault.
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  // Different known mechanisms is a real disagreement.
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toIsoDate(time: number | string): string {
  if (typeof time === 'number' && Number.isFinite(time)) {
    return new Date(time).toISOString();
  }
  if (typeof time === 'string' && time) return time;
  return '';
}

const EARTH_RADIUS_KM = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
