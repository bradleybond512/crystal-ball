/**
 * Pure helpers for the GlobalRiskHeatmapPanel. Kept in a sibling module
 * so tests can import the helpers without dragging in Panel + i18next +
 * worker globals through the panel's transitive imports.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public taxonomy ──────────────────────────────────────────────────────

export const REGION_KEYS = [
  'north_america',
  'south_america',
  'europe',
  'middle_east',
  'africa',
  'south_asia',
  'east_asia',
  'pacific',
  'arctic',
] as const;

export type RegionKey = (typeof REGION_KEYS)[number];

export const REGION_LABEL: Record<RegionKey, string> = {
  north_america: 'North America',
  south_america: 'South America',
  europe: 'Europe',
  middle_east: 'Middle East',
  africa: 'Africa',
  south_asia: 'South Asia',
  east_asia: 'East Asia',
  pacific: 'Pacific',
  arctic: 'Arctic',
};

export const DOMAIN_KEYS = [
  'weather',
  'seismic',
  'health',
  'cyber',
  'geopolitical',
  'financial',
  'aviation',
  'maritime',
  'space',
] as const;

export type DomainKey = (typeof DOMAIN_KEYS)[number];

export const DOMAIN_LABEL: Record<DomainKey, string> = {
  weather: 'Weather',
  seismic: 'Seismic',
  health: 'Health',
  cyber: 'Cyber',
  geopolitical: 'Geopolitical',
  financial: 'Financial',
  aviation: 'Aviation',
  maritime: 'Maritime',
  space: 'Space',
};

/** 0 = no events; 1-4 follow the LOW/MEDIUM/HIGH/CRITICAL ladder. */
export type SeverityBucket = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  region: RegionKey;
  domain: DomainKey;
  severity: SeverityBucket;
  /** How many observations contributed to this cell. */
  count: number;
}

export type HeatmapMatrix = Record<RegionKey, Record<DomainKey, HeatmapCell>>;

const SEVERITY_BUCKET: Record<ObservationSeverity, SeverityBucket> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const BUCKET_LABEL: Record<SeverityBucket, string> = {
  0: 'none',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'critical',
};

// ── Region classification ────────────────────────────────────────────────

/**
 * Bounding boxes are intentionally crude — this is an at-a-glance heatmap,
 * not a geocoder. The first row that matches wins, so Arctic appears
 * before any other entry that overlaps high latitudes.
 */
interface RegionBox {
  key: RegionKey;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const REGION_BOXES: readonly RegionBox[] = [
  { key: 'arctic',        minLat:  66, maxLat:  90, minLon: -180, maxLon: 180 },
  { key: 'north_america', minLat:  15, maxLat:  66, minLon: -170, maxLon: -50 },
  { key: 'south_america', minLat: -56, maxLat:  15, minLon:  -82, maxLon: -34 },
  { key: 'europe',        minLat:  36, maxLat:  66, minLon:  -25, maxLon:  60 },
  { key: 'middle_east',   minLat:  12, maxLat:  42, minLon:   25, maxLon:  65 },
  { key: 'africa',        minLat: -36, maxLat:  36, minLon:  -20, maxLon:  52 },
  { key: 'south_asia',    minLat:   0, maxLat:  38, minLon:   60, maxLon: 100 },
  { key: 'east_asia',     minLat:   0, maxLat:  55, minLon:  100, maxLon: 150 },
];

/**
 * Classify a lat/lon pair into one of the 9 region buckets. Returns null
 * when coordinates aren't finite. Anything south of -56 (Antarctica) is
 * dropped; everything else falls through to the Pacific catch-all.
 */
export function classifyRegion(lat: number, lon: number): RegionKey | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const box of REGION_BOXES) {
    if (lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon) {
      return box.key;
    }
  }
  if (lat >= -56) return 'pacific';
  return null;
}

// ── Domain classification ────────────────────────────────────────────────

const DOMAIN_ALIASES: Record<string, DomainKey> = {
  weather: 'weather',
  hurricane: 'weather',
  tropical_cyclone: 'weather',
  cap: 'weather',
  wildfire: 'weather',
  fire: 'weather',
  climate: 'weather',
  seismic: 'seismic',
  earthquake: 'seismic',
  earthquakes: 'seismic',
  volcano: 'seismic',
  shakealert: 'seismic',
  health: 'health',
  biosurveillance: 'health',
  disease: 'health',
  outbreak: 'health',
  cyber: 'cyber',
  vulnerability: 'cyber',
  bgp: 'cyber',
  geopolitical: 'geopolitical',
  conflict: 'geopolitical',
  acled: 'geopolitical',
  financial: 'financial',
  finance: 'financial',
  market: 'financial',
  supply: 'financial',
  shortage: 'financial',
  commodity: 'financial',
  aviation: 'aviation',
  air_traffic: 'aviation',
  flight: 'aviation',
  maritime: 'maritime',
  ais: 'maritime',
  vessel: 'maritime',
  space: 'space',
  space_weather: 'space',
  geomagnetic: 'space',
  solar_flare: 'space',
};

export function classifyDomain(raw: string): DomainKey | null {
  return DOMAIN_ALIASES[raw.toLowerCase()] ?? null;
}

// ── Severity ─────────────────────────────────────────────────────────────

export function severityToBucket(s: string): SeverityBucket {
  return SEVERITY_BUCKET[s as ObservationSeverity] ?? 0;
}

export function bucketLabel(b: SeverityBucket): string {
  return BUCKET_LABEL[b];
}

// ── Matrix construction ──────────────────────────────────────────────────

/** Build a fresh empty matrix with all 81 cells initialized to severity 0. */
export function emptyMatrix(): HeatmapMatrix {
  const out = {} as HeatmapMatrix;
  for (const r of REGION_KEYS) {
    out[r] = {} as Record<DomainKey, HeatmapCell>;
    for (const d of DOMAIN_KEYS) {
      out[r][d] = { region: r, domain: d, severity: 0, count: 0 };
    }
  }
  return out;
}

/**
 * Aggregate events into the matrix. Each cell holds the highest severity
 * bucket seen for that (region, domain) pair, plus the count of
 * contributing events. Events that don't classify are silently dropped.
 */
export function aggregateHeatmap(events: readonly ObservationEvent[]): HeatmapMatrix {
  const matrix = emptyMatrix();
  for (const ev of events) {
    if (!ev.location) continue;
    const region = classifyRegion(ev.location.lat, ev.location.lon);
    if (!region) continue;
    const domain = classifyDomain(ev.domain);
    if (!domain) continue;
    const bucket = severityToBucket(ev.severity);
    const cell = matrix[region][domain];
    cell.count += 1;
    if (bucket > cell.severity) cell.severity = bucket;
  }
  return matrix;
}

export function totalEventCount(matrix: HeatmapMatrix): number {
  let total = 0;
  for (const r of REGION_KEYS) for (const d of DOMAIN_KEYS) total += matrix[r][d].count;
  return total;
}
