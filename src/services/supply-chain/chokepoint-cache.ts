// src/services/supply-chain/chokepoint-cache.ts
/**
 * Standalone (dependency-light) warm cache for the last successful chokepoint
 * fetch, read synchronously by the survival mobility axis. Kept separate from
 * `supply-chain/index.ts` on purpose: that module pulls a Vite `import.meta.glob`
 * dependency transitively, which breaks any node/tsx test that imports a consumer
 * (e.g. storm-posture-state). This module has no such dependency, so the survival
 * layer can read the getter without dragging the heavy graph into tests.
 *
 * `fetchChokepointStatus` calls `rememberChokepoints` on every successful fetch;
 * the shortage supply loader already runs it every ~5 min, so the cache stays
 * warm without a dedicated loader.
 */
import type { ChokepointInfo } from '@/generated/client/crystalball/supply_chain/v1/service_client';

const CHOKEPOINT_CACHE_TTL_MS = 15 * 60 * 1000;
let _cache: { data: ChokepointInfo[]; fetchedAt: number } | null = null;

/** Remember a successful chokepoint payload. No-op is the caller's job (only real,
 * non-unavailable payloads should be passed). `now` injectable for determinism. */
export function rememberChokepoints(data: ChokepointInfo[], now = Date.now()): void {
  _cache = { data, fetchedAt: now };
}

/**
 * Synchronous read of the last successful chokepoint fetch, or `[]` if nothing
 * has been remembered yet OR the cache has aged past `CHOKEPOINT_CACHE_TTL_MS`
 * (fail-safe). `now` is injectable for determinism.
 */
export function getCachedChokepointInfo(now = Date.now()): ChokepointInfo[] {
  if (!_cache || now - _cache.fetchedAt >= CHOKEPOINT_CACHE_TTL_MS) return [];
  return _cache.data;
}
