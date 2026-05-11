/**
 * Entity Registry — in-memory lookup table for tracked entities.
 *
 * An entity is any real-world thing that can appear across multiple
 * ObservationEvents: a ship (keyed by MMSI), an aircraft (keyed by ICAO hex
 * or callsign), a location, or an organization. The registry deduplicates
 * references so the intelligence pipeline can join facts across providers.
 *
 * This is intentionally a flat store. Cross-entity relationships belong in
 * the EvidenceGraph (evidence-graph.ts), not here.
 */

export type EntityKind = 'ship' | 'aircraft' | 'location' | 'organization';

export interface Entity {
  /** Stable canonical identifier, e.g. '123456789' (MMSI), 'a12345' (hex). */
  id: string;
  kind: EntityKind;
  /** Human-readable name or callsign. */
  name: string;
  /** Last-known latitude, if any. */
  lat?: number;
  /** Last-known longitude, if any. */
  lon?: number;
  /** Epoch ms when this entity was last observed. */
  lastSeenAt: number;
  /** Free-form attributes (flag state, registration, country code, etc.). */
  meta: Record<string, unknown>;
}

export interface EntityQuery {
  kind?: EntityKind;
  /** Name substring (case-insensitive). */
  nameContains?: string;
}

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  kind?: EntityKind;
}

const registry = new Map<string, Entity>();

export function upsertEntity(entity: Omit<Entity, 'lastSeenAt'> & { lastSeenAt?: number }): Entity {
  const existing = registry.get(entity.id);
  const merged: Entity = {
    ...existing,
    ...entity,
    lastSeenAt: entity.lastSeenAt ?? Date.now(),
    meta: { ...existing?.meta, ...entity.meta },
  };
  registry.set(entity.id, merged);
  return merged;
}

export function getEntity(id: string): Entity | undefined {
  return registry.get(id);
}

export function findByName(nameContains: string, kind?: EntityKind): Entity[] {
  const lower = nameContains.toLowerCase();
  const results: Entity[] = [];
  for (const entity of registry.values()) {
    if (kind && entity.kind !== kind) continue;
    if (entity.name.toLowerCase().includes(lower)) results.push(entity);
  }
  return results;
}

/** Haversine distance in km between two lat/lon points. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNear(query: NearbyQuery): Entity[] {
  const results: Entity[] = [];
  for (const entity of registry.values()) {
    if (query.kind && entity.kind !== query.kind) continue;
    if (entity.lat == null || entity.lon == null) continue;
    if (haversineKm(query.lat, query.lon, entity.lat, entity.lon) <= query.radiusKm) {
      results.push(entity);
    }
  }
  return results;
}

export function queryEntities(query: EntityQuery): Entity[] {
  const results: Entity[] = [];
  for (const entity of registry.values()) {
    if (query.kind && entity.kind !== query.kind) continue;
    if (query.nameContains && !entity.name.toLowerCase().includes(query.nameContains.toLowerCase())) continue;
    results.push(entity);
  }
  return results;
}

export function registrySize(): number {
  return registry.size;
}

/** Exposed for tests only — clears all entries. */
export function _clearRegistryForTests(): void {
  registry.clear();
}
