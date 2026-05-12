/**
 * Mission-state mapper — maps per-feed health into a richer operational
 * posture than the legacy 3-state `mission-state-service`:
 *
 *   ENHANCED  every feed in a domain is fresh AND a bonus feed flagged
 *             `enhanced` is also up. (Reserved for over-quorum coverage —
 *             ignored by the default catalog but available to callers.)
 *   NOMINAL   every feed in the domain is fresh and not in error.
 *   LIMITED   one feed in the domain is stale/error but at least one is
 *             still fresh — the domain still functions.
 *   DEGRADED  no fresh feeds remain in the domain OR the global degraded
 *             threshold (>3 feeds down) is reached.
 *
 * Pure / deterministic / no DOM / no fetch. Returns:
 *   { global, domains, degradedFeeds, lastUpdated }
 *
 * Separate from `mission-state-service.ts`: that one feeds the menu bar's
 * traffic-light status (3 states). This one feeds the diagnostic self-test
 * panel and the export bundle (4 states + per-domain breakdown).
 */

import type { FeedDefinition } from './feed-catalog';

// ── Public types ─────────────────────────────────────────────────────────

export type MissionStateLevel = 'DEGRADED' | 'LIMITED' | 'NOMINAL' | 'ENHANCED';

/** Health classification for a single feed at one point in time. */
export type FeedHealthStatus = 'fresh' | 'stale' | 'error' | 'never';

export type Domain = FeedDefinition['category'];

export interface FeedHealthInput {
  id: string;
  name: string;
  category: Domain;
  status: FeedHealthStatus;
  /** When `enhanced: true`, a fresh status promotes the domain from
   *  NOMINAL to ENHANCED. Use this for over-quorum coverage feeds the
   *  base catalog doesn't strictly require. */
  enhanced?: boolean;
}

export interface MissionState {
  global: MissionStateLevel;
  /** Per-domain level. Domains with no feeds in the input are NOT included
   *  — callers can decide how to render absence. */
  domains: Partial<Record<Domain, MissionStateLevel>>;
  /** Display names of every feed whose status is not 'fresh'. Order
   *  matches the input order so callers can preserve catalog order. */
  degradedFeeds: string[];
  /** ms epoch when this MissionState was computed. */
  lastUpdated: number;
}

// ── Tunables ─────────────────────────────────────────────────────────────

/** When the count of degraded feeds globally exceeds this, the global
 *  state collapses to DEGRADED regardless of per-domain pictures. */
export const GLOBAL_DEGRADED_THRESHOLD = 3;

const HEALTHY_STATUSES = new Set<FeedHealthStatus>(['fresh']);
const UNHEALTHY_STATUSES = new Set<FeedHealthStatus>(['stale', 'error', 'never']);

// ── Public API ───────────────────────────────────────────────────────────

export function computeMissionState(
  feeds: readonly FeedHealthInput[],
  now: number = Date.now(),
): MissionState {
  const domains: Partial<Record<Domain, MissionStateLevel>> = {};
  const degradedFeeds: string[] = [];

  // Group by domain.
  const byDomain = new Map<Domain, FeedHealthInput[]>();
  for (const f of feeds) {
    const arr = byDomain.get(f.category) ?? [];
    arr.push(f);
    byDomain.set(f.category, arr);
    if (UNHEALTHY_STATUSES.has(f.status)) degradedFeeds.push(f.name);
  }

  for (const [domain, list] of byDomain) {
    domains[domain] = classifyDomain(list);
  }

  const global = classifyGlobal(domains, degradedFeeds.length);

  return { global, domains, degradedFeeds, lastUpdated: now };
}

/** Pure helper exposed for testing — exposes the per-domain classifier. */
export function classifyDomain(feeds: readonly FeedHealthInput[]): MissionStateLevel {
  if (feeds.length === 0) return 'NOMINAL';
  let healthy = 0;
  let unhealthy = 0;
  let enhancedHealthy = 0;
  for (const f of feeds) {
    if (HEALTHY_STATUSES.has(f.status)) {
      healthy += 1;
      if (f.enhanced) enhancedHealthy += 1;
    } else if (UNHEALTHY_STATUSES.has(f.status)) {
      unhealthy += 1;
    }
  }
  if (healthy === 0) return 'DEGRADED';
  if (unhealthy > 0) return 'LIMITED';
  if (enhancedHealthy > 0) return 'ENHANCED';
  return 'NOMINAL';
}

/** Pure helper exposed for testing — exposes the global rollup logic. */
export function classifyGlobal(
  domains: Partial<Record<Domain, MissionStateLevel>>,
  totalDegradedFeeds: number,
): MissionStateLevel {
  if (totalDegradedFeeds > GLOBAL_DEGRADED_THRESHOLD) return 'DEGRADED';
  const levels = Object.values(domains).filter((l): l is MissionStateLevel => Boolean(l));
  if (levels.length === 0) return 'NOMINAL';
  if (levels.includes('DEGRADED')) return 'DEGRADED';
  if (levels.includes('LIMITED')) return 'LIMITED';
  if (levels.every((l) => l === 'ENHANCED')) return 'ENHANCED';
  return 'NOMINAL';
}

/** Convert a FeedDefinition + observed lastUpdate timestamp into a
 *  FeedHealthInput, classifying as fresh / stale / error / never.
 *
 *  Fresh:    age <= pollIntervalMs * FRESH_MULT
 *  Stale:    age <= pollIntervalMs * STALE_MULT
 *  Error:    explicit error (caller passes hadError=true)
 *  Never:    lastUpdateMs is null
 *  Otherwise (very stale): treated as stale.
 *
 *  Kept here so tests can pin the rule and the panel can avoid an extra
 *  classify step.
 */
export const FRESH_MULT = 2;
export const STALE_MULT = 10;

export function classifyFeedHealth(
  feed: FeedDefinition,
  lastUpdateMs: number | null,
  hadError: boolean,
  now: number = Date.now(),
): FeedHealthStatus {
  if (hadError) return 'error';
  if (lastUpdateMs === null) return 'never';
  const age = now - lastUpdateMs;
  if (age <= feed.pollIntervalMs * FRESH_MULT) return 'fresh';
  return 'stale';
}
