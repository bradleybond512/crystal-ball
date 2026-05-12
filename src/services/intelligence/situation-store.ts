/**
 * Situation Store — in-memory store of named, tracked Situations.
 *
 * Holds at most STORE_LIMIT entries; oldest active situations are evicted
 * FIFO when the cap is reached. Pure helpers (haversine, mergeIds) are
 * exported for the detector + tests; the singleton store is a thin
 * wrapper around them.
 *
 * Resolution: a `resolveSituation` flips status to 'resolved' but keeps
 * the row in the store — callers filter via `getActive()` for the
 * common case.
 *
 * No DOM / no fetch in this module. The detector calls `dispatchSituationEvent`
 * from `situation-detector.ts` to broadcast create/update events.
 */

import type { Situation } from '@/types/intelligence';

export const STORE_LIMIT = 100;

let _entries: Situation[] = [];
let _idCounter = 0;

// ── Pure helpers ───────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nextSituationId(now = Date.now()): string {
  _idCounter += 1;
  return `sit-${now.toString(36)}-${_idCounter}`;
}

/** Append-only id merger — preserves insertion order, dedupes on equality. */
export function mergeIds(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of incoming) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export type CreateSituationInput =
  Omit<Situation, 'id' | 'startedAt' | 'updatedAt'> & { startedAt?: number };

export function createSituation(input: CreateSituationInput): Situation {
  const startedAt = input.startedAt ?? Date.now();
  const situation: Situation = {
    id: nextSituationId(startedAt),
    startedAt,
    updatedAt: startedAt,
    name: input.name,
    status: input.status,
    severity: input.severity,
    domain: input.domain,
    observationIds: [...input.observationIds],
    correlationIds: [...input.correlationIds],
    summary: input.summary,
    location: input.location ? { ...input.location } : undefined,
    tags: [...input.tags],
    confidence: input.confidence,
  };
  _entries.push(situation);
  if (_entries.length > STORE_LIMIT) {
    _entries.splice(0, _entries.length - STORE_LIMIT);
  }
  return situation;
}

export type SituationPatch = Partial<Omit<Situation, 'id' | 'startedAt'>>;

export function updateSituation(id: string, patch: SituationPatch): Situation {
  const index = _entries.findIndex((s) => s.id === id);
  if (index === -1) throw new Error(`Situation ${id} not found`);
  const current = _entries[index]!;
  const next: Situation = {
    ...current,
    ...patch,
    id: current.id,
    startedAt: current.startedAt,
    updatedAt: patch.updatedAt ?? Date.now(),
    observationIds: patch.observationIds
      ? mergeIds(current.observationIds, patch.observationIds)
      : current.observationIds,
    correlationIds: patch.correlationIds
      ? mergeIds(current.correlationIds, patch.correlationIds)
      : current.correlationIds,
    tags: patch.tags ? mergeIds(current.tags, patch.tags) : current.tags,
    location: patch.location ?? current.location,
  };
  _entries[index] = next;
  return next;
}

export function resolveSituation(id: string, now = Date.now()): Situation {
  return updateSituation(id, { status: 'resolved', updatedAt: now });
}

export function getSituation(id: string): Situation | null {
  return _entries.find((s) => s.id === id) ?? null;
}

export function getActive(): Situation[] {
  return _entries.filter((s) => s.status !== 'resolved').map((s) => ({ ...s }));
}

export function getAll(): Situation[] {
  return _entries.map((s) => ({ ...s }));
}

export function findByDomain(domain: string): Situation[] {
  return _entries.filter((s) => s.domain === domain && s.status !== 'resolved')
    .map((s) => ({ ...s }));
}

export function findNear(lat: number, lon: number, radiusKm: number): Situation[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || radiusKm <= 0) return [];
  const out: Situation[] = [];
  for (const s of _entries) {
    if (s.status === 'resolved' || !s.location) continue;
    const distKm = haversineKm(lat, lon, s.location.lat, s.location.lon);
    if (distKm <= radiusKm) out.push({ ...s });
  }
  return out;
}

export function linkObservation(situationId: string, observationId: string): Situation {
  return updateSituation(situationId, { observationIds: [observationId] });
}

export function linkCorrelation(situationId: string, correlationId: string): Situation {
  return updateSituation(situationId, { correlationIds: [correlationId] });
}

/** Test seam — empties the store and resets the id counter. */
export function __reset(): void {
  _entries = [];
  _idCounter = 0;
}
