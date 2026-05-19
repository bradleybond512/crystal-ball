/**
 * CollectionGapDiscoveryService — systematically audits which domains
 * have observability holes: missing feeds, geographic low coverage,
 * stale data, absent alerts, or single-source brittleness.
 *
 * `auditDomain()` takes raw feed metrics and emits `CollectionGap[]`
 * for every newly discovered condition. Gaps are deduplicated so a
 * domain is never flagged twice for the same open issue.
 *
 * Seeded at construction with realistic starting gaps for 8 canonical
 * Crystal Ball domains. Pure deterministic — no DOM, no fetch.
 * Storage key: `wm-collection-gaps`. Ring buffer capped at 500 gaps.
 */

// ── Public types ──────────────────────────────────────────────────────

export type GapType =
  | 'missing-feed'
  | 'low-coverage'
  | 'stale-data'
  | 'no-alerts'
  | 'single-source';

export type GapSeverity = 'low' | 'medium' | 'high';

export interface CollectionGap {
  id: string;
  domain: string;
  gapType: GapType;
  region?: string;
  description: string;
  severity: GapSeverity;
  discoveredAt: number;
  resolvedAt?: number;
}

export interface CollectionGapStats {
  totalGaps: number;
  byDomain: Record<string, number>;
  bySeverity: { low: number; medium: number; high: number };
  resolutionRate: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CollectionGapDiscoveryOptions {
  storage?: StorageLike | null;
  clock?: () => number;
  /** Set false to skip the initial 8-domain seed (useful for tests). */
  seed?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-collection-gaps';
export const MAX_GAPS = 500;
/** Observations older than this trigger a stale-data gap. */
export const STALE_THRESHOLD_MS = 3_600_000; // 1 hour
export const MIN_FEEDS = 2;
export const MIN_REGIONS = 3;

const SEVERITY_ORDER: Record<GapSeverity, number> = { low: 0, medium: 1, high: 2 };

const GAP_SEVERITY: Record<GapType, GapSeverity> = {
  'missing-feed':   'high',
  'stale-data':     'high',
  'no-alerts':      'high',
  'single-source':  'medium',
  'low-coverage':   'low',
};

// Initial audit parameters for the 8 canonical domains.
// Produces realistic starting gaps without requiring live data.
const INITIAL_DOMAINS: readonly {
  domain: string;
  feedCount: number;
  regionsCovered: string[];
  lastObservationAge: number;
  alertCount: number;
}[] = [
  {
    domain: 'cyber',
    feedCount: 1,
    regionsCovered: ['US'],
    lastObservationAge: 30 * 60_000,
    alertCount: 5,
  },
  {
    domain: 'weather',
    feedCount: 4,
    regionsCovered: ['NA', 'EU', 'AS', 'AF'],
    lastObservationAge: 5 * 60_000,
    alertCount: 12,
  },
  {
    domain: 'geopolitical',
    feedCount: 1,
    regionsCovered: ['EU'],
    lastObservationAge: 90 * 60_000,
    alertCount: 3,
  },
  {
    domain: 'maritime',
    feedCount: 2,
    regionsCovered: ['Atlantic', 'Pacific'],
    lastObservationAge: STALE_THRESHOLD_MS + 1,
    alertCount: 4,
  },
  {
    domain: 'aviation',
    feedCount: 3,
    regionsCovered: ['NA', 'EU', 'AS'],
    lastObservationAge: 10 * 60_000,
    alertCount: 9,
  },
  {
    domain: 'health',
    feedCount: 1,
    regionsCovered: ['NA'],
    lastObservationAge: 12 * 3_600_000,
    alertCount: 0,
  },
  {
    domain: 'financial',
    feedCount: 3,
    regionsCovered: ['US', 'EU'],
    lastObservationAge: 15 * 60_000,
    alertCount: 7,
  },
  {
    domain: 'seismic',
    feedCount: 2,
    regionsCovered: ['Pacific Rim'],
    lastObservationAge: 30 * 60_000,
    alertCount: 4,
  },
];

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────

export class CollectionGapDiscoveryService {
  private static _singleton: CollectionGapDiscoveryService | null = null;
  private gaps: CollectionGap[] = [];
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private idCounter = 0;

  constructor(options: CollectionGapDiscoveryOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? Date.now;
    this.hydrate();
    if ((options.seed ?? true) && this.gaps.length === 0) {
      this.runInitialAudit();
    }
  }

  static getInstance(): CollectionGapDiscoveryService {
    CollectionGapDiscoveryService._singleton ??= new CollectionGapDiscoveryService();
    return CollectionGapDiscoveryService._singleton;
  }

  static _resetForTests(): void {
    CollectionGapDiscoveryService._singleton = null;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Audit a domain against raw feed metrics. Returns only the gaps
   * that were newly created (already-open gaps are not re-emitted).
   *
   * Conditions flagged:
   *  - feedCount < 2           → single-source (medium)
   *  - lastObservationAge > 1h → stale-data (high)
   *  - regionsCovered.length < 3 → low-coverage (low)
   *  - alertCount === 0        → no-alerts (high)
   */
  auditDomain(
    domain: string,
    feedCount: number,
    regionsCovered: string[],
    lastObservationAge: number,
    alertCount: number,
  ): CollectionGap[] {
    const now = this.clock();
    const newGaps: CollectionGap[] = [];

    if (feedCount < MIN_FEEDS && !this.hasOpenGap(domain, 'single-source')) {
      newGaps.push(this.buildGap(domain, 'single-source', now,
        `${domain} has only ${feedCount} feed(s); ${MIN_FEEDS}+ required for redundancy`));
    }
    if (lastObservationAge > STALE_THRESHOLD_MS && !this.hasOpenGap(domain, 'stale-data')) {
      const hours = (lastObservationAge / 3_600_000).toFixed(1);
      newGaps.push(this.buildGap(domain, 'stale-data', now,
        `${domain} last observation ${hours}h ago (threshold ${STALE_THRESHOLD_MS / 3_600_000}h)`));
    }
    if (regionsCovered.length < MIN_REGIONS && !this.hasOpenGap(domain, 'low-coverage')) {
      newGaps.push(this.buildGap(domain, 'low-coverage', now,
        `${domain} covers only ${regionsCovered.length} region(s); ${MIN_REGIONS} required`));
    }
    if (alertCount === 0 && !this.hasOpenGap(domain, 'no-alerts')) {
      newGaps.push(this.buildGap(domain, 'no-alerts', now,
        `${domain} has 0 alerts in the current observation window`));
    }

    for (const g of newGaps) this.gaps.push(g);
    while (this.gaps.length > MAX_GAPS) this.gaps.shift();
    if (newGaps.length > 0) this.persist();

    return newGaps.map((g) => ({ ...g }));
  }

  /**
   * Returns all open gaps (no resolvedAt), optionally filtered to a
   * single domain. Results are sorted by severity descending
   * (high → medium → low).
   */
  getGaps(domain?: string): CollectionGap[] {
    const open = this.gaps.filter(
      (g) => g.resolvedAt === undefined && (domain === undefined || g.domain === domain),
    );
    return [...open]
      .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
      .map((g) => ({ ...g }));
  }

  /**
   * Mark a gap as resolved. Returns true if the gap existed and was
   * open; returns false if the id is unknown or already resolved.
   */
  resolveGap(id: string): boolean {
    const gap = this.gaps.find((g) => g.id === id);
    if (!gap || gap.resolvedAt !== undefined) return false;
    gap.resolvedAt = this.clock();
    this.persist();
    return true;
  }

  getStats(): CollectionGapStats {
    const total = this.gaps.length;
    const resolved = this.gaps.filter((g) => g.resolvedAt !== undefined).length;
    const open = this.gaps.filter((g) => g.resolvedAt === undefined);
    const byDomain: Record<string, number> = {};
    const bySeverity = { low: 0, medium: 0, high: 0 };
    for (const g of open) {
      byDomain[g.domain] = (byDomain[g.domain] ?? 0) + 1;
      bySeverity[g.severity] += 1;
    }
    return {
      totalGaps: total,
      byDomain,
      bySeverity,
      resolutionRate: total === 0 ? 0 : Number((resolved / total).toFixed(4)),
    };
  }

  /** Clear all gaps and storage (test seam). */
  resetForTesting(): void {
    this.gaps = [];
    this.idCounter = 0;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private buildGap(
    domain: string,
    gapType: GapType,
    discoveredAt: number,
    description: string,
  ): CollectionGap {
    this.idCounter += 1;
    return {
      id: `cgd-${discoveredAt.toString(36)}-${this.idCounter}`,
      domain,
      gapType,
      description,
      severity: GAP_SEVERITY[gapType],
      discoveredAt,
    };
  }

  private hasOpenGap(domain: string, gapType: GapType): boolean {
    return this.gaps.some(
      (g) => g.domain === domain && g.gapType === gapType && g.resolvedAt === undefined,
    );
  }

  private runInitialAudit(): void {
    for (const p of INITIAL_DOMAINS) {
      this.auditDomain(p.domain, p.feedCount, p.regionsCovered, p.lastObservationAge, p.alertCount);
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: CollectionGap[] | null;
    try { parsed = JSON.parse(raw) as CollectionGap[] | null; } catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.domain !== 'string') continue;
      this.gaps.push({ ...entry });
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.gaps));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getCollectionGapDiscoveryService(): CollectionGapDiscoveryService {
  return CollectionGapDiscoveryService.getInstance();
}

export const __internals = {
  STORAGE_KEY,
  MAX_GAPS,
  STALE_THRESHOLD_MS,
  MIN_FEEDS,
  MIN_REGIONS,
  GAP_SEVERITY,
  INITIAL_DOMAINS,
};
