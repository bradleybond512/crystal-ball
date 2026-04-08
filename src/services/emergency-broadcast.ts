/**
 * Emergency Broadcast Service — pure TypeScript, fully offline
 *
 * Tracks CAP (Common Alerting Protocol) style alerts across multiple
 * agencies. Provides ingestion, filtering, geographic proximity queries,
 * and expiry pruning. No external dependencies, no network calls.
 *
 * Alerts expire automatically on every read. The store is capped at 500
 * broadcasts (oldest first) to avoid unbounded memory growth.
 * IDs are generated as `eb-{counter}`.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type BroadcastAgency =
  | 'fema_ipaws'
  | 'nws'
  | 'eas'
  | 'eu_meteoalarm'
  | 'jma'
  | 'bom_australia'
  | 'india_imd'
  | 'global_cap';

export type BroadcastCategory =
  | 'geo'
  | 'met'
  | 'safety'
  | 'security'
  | 'rescue'
  | 'fire'
  | 'health'
  | 'env'
  | 'transport'
  | 'infra'
  | 'cbrne'
  | 'other';

export interface EmergencyBroadcast {
  id: string;
  agency: BroadcastAgency;
  category: BroadcastCategory;
  severity: 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
  urgency: 'immediate' | 'expected' | 'future' | 'past' | 'unknown';
  certainty: 'observed' | 'likely' | 'possible' | 'unlikely' | 'unknown';
  headline: string;
  description: string;
  areaDesc: string;
  lat?: number;
  lon?: number;
  /** Unix timestamp (ms) when this alert became effective */
  effective: number;
  /** Unix timestamp (ms) when this alert expires */
  expires: number;
  /** Source URL or identifier */
  source: string;
  status: 'actual' | 'exercise' | 'test';
}

export interface BroadcastStats {
  totalActive: number;
  byAgency: Record<BroadcastAgency, number>;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  extremeCount: number;
}

// ── State ──────────────────────────────────────────────────────────────────

/** In-memory store of all (non-expired) broadcasts */
const broadcasts = new Map<string, EmergencyBroadcast>();

/** Monotonically increasing counter for ID generation */
let counter = 0;

/** Maximum number of broadcasts to keep in memory */
const MAX_BROADCASTS = 500;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Haversine distance in kilometres between two lat/lon points */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
 Math.sin(dLat / 2) ** 2
 + Math.cos((lat1 * Math.PI) / 180)
 * Math.cos((lat2 * Math.PI) / 180)
 * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SEVERITY_ORDER: Record<EmergencyBroadcast['severity'], number> = {
  extreme: 0,
  severe: 1,
  moderate: 2,
  minor: 3,
  unknown: 4,
};

/** Prune expired broadcasts from the store. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [id, b] of broadcasts) {
 if (b.expires > 0 && b.expires <= now) broadcasts.delete(id);
  }
}

/** Enforce the MAX_BROADCASTS cap by dropping oldest entries. */
function enforceCapacity(): void {
  if (broadcasts.size <= MAX_BROADCASTS) return;
  const sorted = [...broadcasts.values()].sort((a, b) => a.effective - b.effective);
  const toRemove = sorted.slice(0, broadcasts.size - MAX_BROADCASTS);
  for (const b of toRemove) broadcasts.delete(b.id);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ingest a new emergency broadcast alert.
 * Returns the generated id for the new alert.
 */
export function ingestBroadcast(
  agency: BroadcastAgency,
  category: BroadcastCategory,
  severity: EmergencyBroadcast['severity'],
  urgency: EmergencyBroadcast['urgency'],
  certainty: EmergencyBroadcast['certainty'],
  headline: string,
  description: string,
  areaDesc: string,
  opts: {
 lat?: number;
 lon?: number;
 effective?: number;
 expires?: number;
 source?: string;
 status?: EmergencyBroadcast['status'];
  } = {},
): string {
  counter += 1;
  const id = `eb-${counter}`;
  const now = Date.now();

  const broadcast: EmergencyBroadcast = {
 id,
 agency,
 category,
 severity,
 urgency,
 certainty,
 headline,
 description,
 areaDesc,
 effective: opts.effective ?? now,
 expires: opts.expires ?? now + 6 * 60 * 60 * 1000, // default 6-hour expiry
 source: opts.source ?? '',
 status: opts.status ?? 'actual',
  };

  if (opts.lat !== undefined) broadcast.lat = opts.lat;
  if (opts.lon !== undefined) broadcast.lon = opts.lon;

  broadcasts.set(id, broadcast);
  enforceCapacity();

  return id;
}

/**
 * Return all non-expired broadcasts sorted by severity (extreme first),
 * then by effective time descending (newest first within same severity).
 * Expired alerts are pruned before returning.
 */
export function getActiveBroadcasts(): EmergencyBroadcast[] {
  pruneExpired();
  return [...broadcasts.values()].sort((a, b) => {
 const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
 if (sevDiff !== 0) return sevDiff;
 return b.effective - a.effective;
  });
}

/**
 * Return aggregate statistics over active broadcasts.
 * Expired alerts are pruned before counting.
 */
export function getBroadcastStats(): BroadcastStats {
  pruneExpired();

  const byAgency = {} as Record<BroadcastAgency, number>;
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let extremeCount = 0;

  for (const b of broadcasts.values()) {
 byAgency[b.agency] = (byAgency[b.agency] ?? 0) + 1;
 bySeverity[b.severity] = (bySeverity[b.severity] ?? 0) + 1;
 byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
 if (b.severity === 'extreme') extremeCount += 1;
  }

  return {
 totalActive: broadcasts.size,
 byAgency,
 bySeverity,
 byCategory,
 extremeCount,
  };
}

/**
 * Return only extreme-severity alerts with immediate urgency.
 * Expired alerts are pruned before returning.
 */
export function getExtremeAlerts(): EmergencyBroadcast[] {
  pruneExpired();
  return [...broadcasts.values()]
 .filter(b => b.severity === 'extreme' && b.urgency === 'immediate')
 .sort((a, b) => b.effective - a.effective);
}

/**
 * Return all broadcasts whose lat/lon falls within radiusKm of the given
 * coordinates. Broadcasts without coordinates are excluded.
 * Expired alerts are pruned before filtering.
 */
export function getBroadcastsByRegion(
  lat: number,
  lon: number,
  radiusKm: number,
): EmergencyBroadcast[] {
  pruneExpired();
  return [...broadcasts.values()].filter(b => {
 if (b.lat === undefined || b.lon === undefined) return false;
 return haversineKm(lat, lon, b.lat, b.lon) <= radiusKm;
  });
}

/**
 * Manually prune expired broadcasts.
 * Called automatically on every read; exposed for explicit housekeeping.
 */
export function expireBroadcasts(): void {
  pruneExpired();
}

/**
 * Return the current count of active (non-expired) broadcasts.
 * Expired alerts are pruned before counting.
 */
export function getBroadcastCount(): number {
  pruneExpired();
  return broadcasts.size;
}
