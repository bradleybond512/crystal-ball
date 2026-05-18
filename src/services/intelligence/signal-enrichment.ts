/**
 * Signal Enrichment — augments raw ObservationEvents with contextual
 * metadata (geographic region, entity linkage, domain hazard class,
 * cascade relationship hints) so downstream pipeline stages don't each
 * repeat the same lookups.
 *
 * Pure & stateless re: persistence: a 1000-record in-memory ring of
 * recent enrichments backs `getStats()`. The `entityResolver` is
 * injectable so the registry singleton doesn't have to exist for
 * enrichment (or for tests). All four enrichment steps (geo / entity /
 * domain / relationship) are null-safe — missing inputs cleanly skip
 * the corresponding tag set without throwing.
 */

import type { Entity } from './entity-registry';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export type EnrichmentSource = 'geo' | 'entity' | 'domain' | 'relationship';

export interface EnrichmentTag {
  key: string;
  value: string;
  source: EnrichmentSource;
}

export interface EnrichedObservation {
  observation: ObservationEvent;
  tags: EnrichmentTag[];
  nearestPlace?: string;
  regionName?: string;
  linkedEntityIds: string[];
  enrichedAt: number;
}

export interface EnrichmentStats {
  total: number;
  avgTagsPerObservation: number;
  bySource: Record<EnrichmentSource, number>;
}

export type EntityResolver = (query: string) => Entity | undefined;

export interface SignalEnrichmentOptions {
  entityResolver?: EntityResolver | null;
  now?: () => number;
}

export interface SignalEnrichmentService {
  enrich(observation: ObservationEvent): EnrichedObservation;
  enrichBatch(observations: readonly ObservationEvent[]): EnrichedObservation[];
  getStats(): EnrichmentStats;
  subscribe(cb: (enriched: EnrichedObservation) => void): void;
  unsubscribe(cb: (enriched: EnrichedObservation) => void): void;
}

interface RegionSeed {
  name: string;
  place: string;
  lat: number;
  lon: number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const REGION_RADIUS_KM = 1000;
export const STATS_WINDOW = 1000;

export const BUILT_IN_REGIONS: readonly RegionSeed[] = [
  { name: 'East Asia', place: 'Tokyo metro', lat: 35.68, lon: 139.69 },
  { name: 'West Coast NA', place: 'San Francisco Bay', lat: 37.77, lon: -122.42 },
  { name: 'Eastern Mediterranean', place: 'Istanbul', lat: 41.01, lon: 28.97 },
  { name: 'Persian Gulf', place: 'Dubai', lat: 25.27, lon: 55.3 },
  { name: 'Western Europe', place: 'Paris', lat: 48.86, lon: 2.35 },
  { name: 'South Asia', place: 'Mumbai', lat: 19.08, lon: 72.88 },
  { name: 'Southeast Asia', place: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'South America', place: 'São Paulo', lat: -23.55, lon: -46.63 },
  { name: 'Sub-Saharan Africa', place: 'Lagos', lat: 6.45, lon: 3.39 },
  { name: 'Australasia', place: 'Sydney', lat: -33.87, lon: 151.21 },
];

const DOMAIN_TAGS: Record<string, readonly EnrichmentTag[]> = {
  earthquake: [
    { key: 'hazard-class', value: 'natural-disaster', source: 'domain' },
    { key: 'response-tier', value: 'rapid', source: 'domain' },
  ],
  weather: [
    { key: 'hazard-class', value: 'natural-disaster', source: 'domain' },
    { key: 'response-tier', value: 'sustained', source: 'domain' },
  ],
  wildfire: [
    { key: 'hazard-class', value: 'natural-disaster', source: 'domain' },
    { key: 'response-tier', value: 'rapid', source: 'domain' },
  ],
  biosurv: [
    { key: 'hazard-class', value: 'biological', source: 'domain' },
    { key: 'response-tier', value: 'sustained', source: 'domain' },
  ],
  maritime: [
    { key: 'hazard-class', value: 'transport', source: 'domain' },
    { key: 'response-tier', value: 'monitoring', source: 'domain' },
  ],
  aviation: [
    { key: 'hazard-class', value: 'transport', source: 'domain' },
    { key: 'response-tier', value: 'rapid', source: 'domain' },
  ],
  cyber: [
    { key: 'hazard-class', value: 'digital', source: 'domain' },
    { key: 'response-tier', value: 'rapid', source: 'domain' },
  ],
  geopolitical: [
    { key: 'hazard-class', value: 'political', source: 'domain' },
    { key: 'response-tier', value: 'sustained', source: 'domain' },
  ],
};

/** Cascade hints loosely sourced from the DomainDependencyGraph: domains
 *  that frequently co-trigger when a high-severity event lands in the key. */
const CASCADE_MAP: Record<string, readonly string[]> = {
  earthquake: ['maritime', 'wildfire'],
  weather: ['maritime', 'aviation'],
  wildfire: ['weather', 'aviation'],
  cyber: ['geopolitical'],
  geopolitical: ['cyber', 'maritime'],
  biosurv: ['geopolitical'],
  maritime: ['geopolitical'],
  aviation: ['geopolitical'],
};

const HIGH_SEVERITY: ReadonlySet<ObservationSeverity> = new Set(['HIGH', 'CRITICAL']);

// ── Helpers ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
function toRad(deg: number): number { return (deg * Math.PI) / 180; }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function nearestRegion(lat: number, lon: number): { region: RegionSeed; distanceKm: number } | null {
  let best: { region: RegionSeed; distanceKm: number } | null = null;
  for (const region of BUILT_IN_REGIONS) {
    const distanceKm = haversineKm(lat, lon, region.lat, region.lon);
    if (best === null || distanceKm < best.distanceKm) {
      best = { region, distanceKm };
    }
  }
  if (!best || best.distanceKm > REGION_RADIUS_KM) return null;
  return best;
}

function enrichGeo(
  obs: ObservationEvent,
  tags: EnrichmentTag[],
): { regionName?: string; nearestPlace?: string } {
  if (!obs.location) return {};
  const match = nearestRegion(obs.location.lat, obs.location.lon);
  if (!match) return {};
  tags.push(
    { key: 'region', value: match.region.name, source: 'geo' },
    { key: 'nearest-place', value: match.region.place, source: 'geo' },
  );
  return { regionName: match.region.name, nearestPlace: match.region.place };
}

function enrichDomain(obs: ObservationEvent, tags: EnrichmentTag[]): void {
  const domainTags = DOMAIN_TAGS[obs.domain];
  if (!domainTags) return;
  for (const tag of domainTags) tags.push({ ...tag });
}

function enrichRelationship(obs: ObservationEvent, tags: EnrichmentTag[]): void {
  if (!HIGH_SEVERITY.has(obs.severity)) return;
  const cascades = CASCADE_MAP[obs.domain];
  if (!cascades || cascades.length === 0) return;
  tags.push({
    key: 'cascades-to',
    value: cascades.join(','),
    source: 'relationship',
  });
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createSignalEnrichmentService(
  options: SignalEnrichmentOptions = {},
): SignalEnrichmentService {
  const resolver = options.entityResolver ?? null;
  const clock = options.now ?? (() => Date.now());
  const history: EnrichedObservation[] = [];
  const listeners = new Set<(enriched: EnrichedObservation) => void>();

  function recordHistory(e: EnrichedObservation): void {
    history.push(e);
    if (history.length > STATS_WINDOW) {
      history.splice(0, history.length - STATS_WINDOW);
    }
  }

  function notify(e: EnrichedObservation): void {
    for (const cb of listeners) {
      try { cb(e); } catch { /* listener crash isolation */ }
    }
  }

  function enrichEntity(obs: ObservationEvent, tags: EnrichmentTag[], linkedIds: Set<string>): void {
    if (!resolver) return;
    const queries: string[] = [];
    if (obs.title) queries.push(obs.title);
    if (obs.sourceId) queries.push(obs.sourceId);
    for (const id of obs.entityIds) linkedIds.add(id);
    for (const q of queries) {
      const entity = resolver(q);
      if (!entity) continue;
      linkedIds.add(entity.id);
      tags.push({ key: 'entity-type', value: entity.type, source: 'entity' });
      if (entity.canonicalName) {
        tags.push({ key: 'entity-name', value: entity.canonicalName, source: 'entity' });
      }
    }
  }

  function enrichOne(observation: ObservationEvent): EnrichedObservation {
    const tags: EnrichmentTag[] = [];
    const linkedIds = new Set<string>();
    const geo = enrichGeo(observation, tags);
    enrichEntity(observation, tags, linkedIds);
    enrichDomain(observation, tags);
    enrichRelationship(observation, tags);
    const enriched: EnrichedObservation = {
      observation,
      tags,
      nearestPlace: geo.nearestPlace,
      regionName: geo.regionName,
      linkedEntityIds: [...linkedIds],
      enrichedAt: clock(),
    };
    recordHistory(enriched);
    notify(enriched);
    return enriched;
  }

  return {
    enrich(observation): EnrichedObservation {
      return enrichOne(observation);
    },

    enrichBatch(observations): EnrichedObservation[] {
      return observations.map((o) => enrichOne(o));
    },

    getStats(): EnrichmentStats {
      const total = history.length;
      const bySource: Record<EnrichmentSource, number> = { geo: 0, entity: 0, domain: 0, relationship: 0 };
      let totalTags = 0;
      for (const h of history) {
        totalTags += h.tags.length;
        for (const t of h.tags) bySource[t.source] += 1;
      }
      const avgTagsPerObservation = total === 0 ? 0 : totalTags / total;
      return { total, avgTagsPerObservation, bySource };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: SignalEnrichmentService | null = null;

export function getSignalEnrichmentService(): SignalEnrichmentService {
  _singleton ??= createSignalEnrichmentService();
  return _singleton;
}

export function resetSignalEnrichmentServiceForTests(): void {
  _singleton = null;
}
