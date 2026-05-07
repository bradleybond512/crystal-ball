/**
 * MITRE ATT&CK enterprise STIX cache updater.
 *
 * The full STIX bundle (`enterprise-attack.json`) is ~10 MB and changes
 * infrequently. Strategy:
 *   - Sidecar fetches the bundle weekly (or on first request when cache
 *     is missing / stale) and writes it to disk
 *   - Sidecar parses it once into AptGroup[] via apt-tracker's
 *     `parseAttackBundle` and serves the parsed groups via
 *     /api/attack/groups
 *   - This module owns *pure* helpers: cache-stale detection, bundle
 *     validation, the source URL constant
 */

import type { AptGroup } from './apt-tracker';

// ── Public types ───────────────────────────────────────────────────────

export interface AttackCacheStatus {
  cacheExists: boolean;
  /** ms epoch when the cache file was last written. Null when missing. */
  lastFetchedAt: number | null;
  /** Age in ms since last fetch. Null when never fetched. */
  ageMs: number | null;
  isStale: boolean;
  /** Number of AptGroup records loaded from the cache. */
  groupCount: number;
  /** Last fetch error reason, if any. */
  lastError: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────

export const ATTACK_CACHE_URL =
  'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';

export const ATTACK_CACHE_FILENAME = 'attack-cache.json';

/** Refresh cadence — bundle changes ~monthly so weekly is conservative. */
export const ATTACK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Cache-stale detection ──────────────────────────────────────────────

/**
 * Is the on-disk cache stale (older than `ttlMs`) or missing entirely?
 * Pure — pass in the stat-mtime + the current clock.
 */
export function isAttackCacheStale(input: {
  lastFetchedAt: number | null;
  nowMs: number;
  ttlMs?: number;
}): boolean {
  const ttl = input.ttlMs ?? ATTACK_CACHE_TTL_MS;
  if (input.lastFetchedAt === null) return true;
  return input.nowMs - input.lastFetchedAt > ttl;
}

/** Convenience builder for the status struct. */
export function buildAttackCacheStatus(input: {
  cacheExists: boolean;
  lastFetchedAt: number | null;
  nowMs: number;
  groupCount: number;
  lastError: string | null;
  ttlMs?: number;
}): AttackCacheStatus {
  const ageMs = input.lastFetchedAt === null ? null : input.nowMs - input.lastFetchedAt;
  return {
    cacheExists: input.cacheExists,
    lastFetchedAt: input.lastFetchedAt,
    ageMs,
    isStale: isAttackCacheStale({
      lastFetchedAt: input.lastFetchedAt,
      nowMs: input.nowMs,
      ttlMs: input.ttlMs,
    }),
    groupCount: input.groupCount,
    lastError: input.lastError,
  };
}

// ── Bundle validation ──────────────────────────────────────────────────

/**
 * Cheap structural check that a parsed JSON value is a STIX bundle.
 * Used to reject corrupt cache files without going through the full
 * `parseAttackBundle` (which is expensive on a 10 MB blob).
 */
export function isStixBundle(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'bundle') return false;
  if (!Array.isArray(r.objects)) return false;
  return true;
}

/**
 * Filter a parsed AptGroup[] to only those that look usable —
 * non-empty id, non-empty name. The MITRE bundle is generally clean
 * but defensive filtering protects against future schema changes.
 */
export function filterUsableGroups(groups: readonly AptGroup[]): AptGroup[] {
  return groups.filter((g) => g.id.length > 0 && g.name.length > 0);
}
