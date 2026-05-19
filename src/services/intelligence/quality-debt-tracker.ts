/**
 * Quality Debt Tracker — manual CRUD store for known quality debts in
 * the intelligence pipeline (data freshness gaps, model calibration
 * issues, coverage holes, latency wins, accuracy regressions).
 *
 * This is the *foundation* layer: a plain register of debts the team
 * already knows about, seeded with 8 well-documented gaps. A separate
 * auto-detector module (`src/services/quality/quality-debt.ts` and any
 * later evolution) can sit on top and call `addDebt()` when it spots
 * something new.
 *
 * Storage:
 *   - In-memory ring (max 500 entries, FIFO eviction).
 *   - Persists to localStorage `wm-quality-debt-tracker`, schema v1.
 *   - Singleton via `QualityDebtTracker.getInstance()`.
 *
 * No DOM imports, no fetch, no globals beyond `localStorage`/`Date.now()`.
 * Pure helpers (severityRank, sortBySeverity) are exported so callers
 * can render without instantiating the tracker.
 */

export type QualityDebtCategory =
  | 'data'      // freshness / feed gaps / parse fragility
  | 'model'     // calibration / drift / score stability
  | 'coverage'  // missing domains, regions, asset classes
  | 'latency'   // p95 above SLO
  | 'accuracy'; // forecast / classification accuracy regressions

export type QualityDebtSeverity = 'low' | 'medium' | 'high' | 'critical';

export type QualityDebtStatus = 'open' | 'in-progress' | 'resolved';

export interface QualityDebt {
  /** Stable id, monotonic per-process. Persists across reload. */
  id: string;
  /** Short title for the debt (≤140 chars, trimmed). */
  title: string;
  /** Long-form description — what the debt is, why it matters. */
  description: string;
  category: QualityDebtCategory;
  severity: QualityDebtSeverity;
  /** Optional domain hint matching ObservationEvent.domain values. */
  domain?: string;
  /** Plain-text impact statement: e.g. "30-min gap in vessel positions". */
  estimatedImpact: string;
  /** ms since epoch. */
  createdAt: number;
  /** ms since epoch; undefined unless status === 'resolved'. */
  resolvedAt?: number;
  status: QualityDebtStatus;
}

export interface QualityDebtStats {
  totalOpen: number;
  bySeverity: Record<QualityDebtSeverity, number>;
  byCategory: Record<QualityDebtCategory, number>;
  /** Resolved / (resolved + open + in-progress), as a percentage 0–100.
   *  Returns 0 when the tracker is completely empty. */
  resolutionRatePct: number;
}

export type CreateDebtInput =
  Omit<QualityDebt, 'id' | 'createdAt' | 'resolvedAt' | 'status'>
  & { id?: string; createdAt?: number; status?: QualityDebtStatus };

export type DebtListener = (debt: QualityDebt, kind: 'added' | 'updated') => void;

export const STORAGE_KEY = 'wm-quality-debt-tracker';
export const STORE_LIMIT = 500;
export const SCHEMA_VERSION = 1;

// ── Pure helpers ──────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<QualityDebtSeverity, number> = {
  critical: 3, high: 2, medium: 1, low: 0,
};

export function severityRank(severity: QualityDebtSeverity): number {
  return SEVERITY_RANK[severity];
}

/** Sort debts critical-first, with createdAt desc as tiebreaker. Returns
 *  a new array — the input is not mutated. */
export function sortBySeverity(debts: readonly QualityDebt[]): QualityDebt[] {
  return [...debts].sort((a, b) => {
    const ra = SEVERITY_RANK[a.severity];
    const rb = SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    return b.createdAt - a.createdAt;
  });
}

const VALID_CATEGORIES: ReadonlySet<QualityDebtCategory> =
  new Set(['data', 'model', 'coverage', 'latency', 'accuracy']);
const VALID_SEVERITIES: ReadonlySet<QualityDebtSeverity> =
  new Set(['low', 'medium', 'high', 'critical']);
const VALID_STATUSES: ReadonlySet<QualityDebtStatus> =
  new Set(['open', 'in-progress', 'resolved']);

export function isValidDebt(value: unknown): value is QualityDebt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.title !== 'string' || typeof v.description !== 'string') return false;
  if (typeof v.estimatedImpact !== 'string') return false;
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) return false;
  if (!VALID_CATEGORIES.has(v.category as QualityDebtCategory)) return false;
  if (!VALID_SEVERITIES.has(v.severity as QualityDebtSeverity)) return false;
  if (!VALID_STATUSES.has(v.status as QualityDebtStatus)) return false;
  if (v.domain !== undefined && typeof v.domain !== 'string') return false;
  if (v.resolvedAt !== undefined
      && (typeof v.resolvedAt !== 'number' || !Number.isFinite(v.resolvedAt))) return false;
  return true;
}

// ── Seeded debts ──────────────────────────────────────────────────────────

/** Eight known intelligence-pipeline gaps. The auto-detector module can
 *  later add to or update these — the foundation just ships them so the
 *  panel never displays an empty state on first run. */
export const SEEDED_DEBTS: readonly Omit<QualityDebt,
  'id' | 'createdAt' | 'resolvedAt' | 'status'>[] = [
  {
    title: 'AIS vessel data 6h latency',
    description:
      'AISStream WebSocket reconnect timing means we can be up to 6 hours behind on '
      + 'vessel positions in dense traffic zones. The dark-vessel detector partially '
      + 'compensates with a 24h history ring, but real-time chokepoint risk scoring '
      + 'is degraded during the gap window.',
    category: 'latency',
    severity: 'high',
    domain: 'ais',
    estimatedImpact:
      'Chokepoint closure-risk score is up to 6h stale during heavy reconnect cycles.',
  },
  {
    title: 'GDACS RSS envelope parsing fragile',
    description:
      'GDACS occasionally emits non-RFC RSS with mixed CDATA and inline HTML in the '
      + 'description element. The current parser strips the inner XML rather than '
      + 'reading the geocoded payload, so coordinates default to country centroid.',
    category: 'data',
    severity: 'medium',
    domain: 'gdacs',
    estimatedImpact: 'Disaster coordinates fall back to country centroid ~3% of the time.',
  },
  {
    title: 'Earthquake magnitude confidence uncalibrated',
    description:
      'USGS PAGER magnitudes vary between Mw, Mb, and Ms across event sources. The '
      + 'truth-score pipeline treats them as interchangeable; in practice Mb tends to '
      + 'over-estimate at low magnitudes by ~0.2 units versus the canonical Mw.',
    category: 'model',
    severity: 'medium',
    domain: 'usgs',
    estimatedImpact: 'Low-magnitude events scored 0.1–0.3 higher than calibrated truth.',
  },
  {
    title: 'NHC cone-of-uncertainty not weighted by intensity',
    description:
      'Hurricane cones treat every track point as equally uncertain. Intensity-aware '
      + 'modeling (post-rapid-intensification windows are tighter than pre-) would '
      + 'narrow alert footprint for ~20% of storms.',
    category: 'accuracy',
    severity: 'medium',
    domain: 'nhc',
    estimatedImpact: 'Personal-impact alerts fire for 1.2x more saved-places than necessary.',
  },
  {
    title: 'Cyber-domain coverage missing OT-specific feeds',
    description:
      'The cyber-threat panel ingests IT-oriented IOC feeds (Feodo, URLhaus, OTX) but '
      + 'has no OT/ICS-specific source (Dragos, SCADAfence, CISA ICS-CERT). For '
      + 'critical-infrastructure scenarios this is a coverage gap.',
    category: 'coverage',
    severity: 'high',
    domain: 'cyber',
    estimatedImpact: 'OT-threat scenarios miss 40% of relevant IOCs.',
  },
  {
    title: 'GDELT Doc API global-event filter drops local feeds',
    description:
      'The GDELT Doc API query filter is tuned for cross-border events; same-country '
      + 'local-language reporting (e.g. domestic strikes, regional weather) gets '
      + 'dropped before reaching the truth scorer.',
    category: 'coverage',
    severity: 'low',
    domain: 'gdelt',
    estimatedImpact: 'Domestic-only events underweighted in regional risk scoring.',
  },
  {
    title: 'FRED economic series cached without ETag revalidation',
    description:
      'FRED economic indicator pulls use a flat 24h cache with no If-Modified-Since '
      + 'check. Series with multiple-times-per-day publication (Treasury rates, daily '
      + 'spot prices) can be up to 24h behind during volatile periods.',
    category: 'latency',
    severity: 'medium',
    domain: 'economic',
    estimatedImpact: 'Macro stress score can lag market events by up to 24h.',
  },
  {
    title: 'Forecast calibration over-confident in long-tail scenarios',
    description:
      'Brier-score calibration buckets above the 95th percentile (very-low-probability '
      + 'catastrophic events) are systematically over-confident by 8–12 points, based '
      + 'on the rolling forecast-calibration ledger. Long-tail predictions need an '
      + 'isotonic-regression recalibration pass.',
    category: 'accuracy',
    severity: 'critical',
    estimatedImpact:
      'Catastrophic-tail forecasts (Cat 5, M8+, G5) are mis-confident by 8–12 pp.',
  },
];

// ── Storage adapter ───────────────────────────────────────────────────────

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as { localStorage?: StorageLike };
  return g.localStorage ?? null;
}

interface PersistEnvelope {
  schema: number;
  nextId: number;
  debts: QualityDebt[];
}

// ── Tracker class ─────────────────────────────────────────────────────────

export interface QualityDebtTrackerOptions {
  /** Override storage host (used by tests). Pass `null` to disable. */
  storage?: StorageLike | null;
  /** Override `Date.now()` (used by tests). */
  clock?: () => number;
  /** Skip seeding the 8 built-in debts (tests + replays). */
  skipSeed?: boolean;
}

export class QualityDebtTracker {
  private static _instance: QualityDebtTracker | null = null;

  private readonly _storage: StorageLike | null;
  private readonly _clock: () => number;
  private _debts: QualityDebt[] = [];
  private _nextId = 1;
  private _listeners = new Set<DebtListener>();

  public static getInstance(): QualityDebtTracker {
    QualityDebtTracker._instance ??= new QualityDebtTracker();
    return QualityDebtTracker._instance;
  }

  /** Test seam — replaces the singleton. */
  public static __setInstance(next: QualityDebtTracker | null): void {
    QualityDebtTracker._instance = next;
  }

  public constructor(options: QualityDebtTrackerOptions = {}) {
    this._storage = options.storage === undefined ? defaultStorage() : options.storage;
    this._clock = options.clock ?? (() => Date.now());
    if (!this._hydrateFromStorage() && !options.skipSeed) {
      this._seed();
      this._persist();
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  public addDebt(input: CreateDebtInput): QualityDebt {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('QualityDebtTracker.addDebt: title is required');
    }
    if (!VALID_CATEGORIES.has(input.category)) {
      throw new Error(`QualityDebtTracker.addDebt: invalid category ${input.category}`);
    }
    if (!VALID_SEVERITIES.has(input.severity)) {
      throw new Error(`QualityDebtTracker.addDebt: invalid severity ${input.severity}`);
    }
    const now = input.createdAt ?? this._clock();
    const status = input.status ?? 'open';
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`QualityDebtTracker.addDebt: invalid status ${status}`);
    }
    const debt: QualityDebt = {
      id: input.id ?? this._nextStableId(),
      title: title.slice(0, 140),
      description: input.description,
      category: input.category,
      severity: input.severity,
      domain: input.domain,
      estimatedImpact: input.estimatedImpact,
      createdAt: now,
      status,
      ...(status === 'resolved' ? { resolvedAt: now } : {}),
    };
    this._debts.push(debt);
    if (this._debts.length > STORE_LIMIT) {
      this._debts.splice(0, this._debts.length - STORE_LIMIT);
    }
    this._persist();
    this._emit(debt, 'added');
    return { ...debt };
  }

  public updateStatus(id: string, status: QualityDebtStatus): QualityDebt {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`QualityDebtTracker.updateStatus: invalid status ${status}`);
    }
    const index = this._debts.findIndex((d) => d.id === id);
    if (index === -1) {
      throw new Error(`QualityDebtTracker.updateStatus: debt ${id} not found`);
    }
    const current = this._debts[index]!;
    const next: QualityDebt = { ...current, status };
    if (status === 'resolved') {
      next.resolvedAt = current.resolvedAt ?? this._clock();
    } else if (current.resolvedAt !== undefined) {
      delete next.resolvedAt;
    }
    this._debts[index] = next;
    this._persist();
    this._emit(next, 'updated');
    return { ...next };
  }

  public getDebt(id: string): QualityDebt | null {
    const found = this._debts.find((d) => d.id === id);
    return found ? { ...found } : null;
  }

  public getAll(): QualityDebt[] {
    return this._debts.map((d) => ({ ...d }));
  }

  public getOpen(): QualityDebt[] {
    const open = this._debts.filter((d) => d.status !== 'resolved');
    return sortBySeverity(open).map((d) => ({ ...d }));
  }

  public getByCategory(category: QualityDebtCategory): QualityDebt[] {
    return this._debts
      .filter((d) => d.category === category)
      .map((d) => ({ ...d }));
  }

  public findByDomain(domain: string): QualityDebt[] {
    return this._debts
      .filter((d) => d.domain === domain)
      .map((d) => ({ ...d }));
  }

  // ── Stats ───────────────────────────────────────────────────────────

  public getStats(): QualityDebtStats {
    const open = this._debts.filter((d) => d.status !== 'resolved');
    const resolved = this._debts.filter((d) => d.status === 'resolved');
    const bySeverity: Record<QualityDebtSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const byCategory: Record<QualityDebtCategory, number> = {
      data: 0, model: 0, coverage: 0, latency: 0, accuracy: 0,
    };
    for (const d of open) {
      bySeverity[d.severity] += 1;
      byCategory[d.category] += 1;
    }
    const total = this._debts.length;
    const resolutionRatePct = total === 0 ? 0
      : Math.round((resolved.length / total) * 100);
    return { totalOpen: open.length, bySeverity, byCategory, resolutionRatePct };
  }

  // ── Pub/sub (small, optional) ───────────────────────────────────────

  /** Subscribe to add/update events. Returns an unsubscribe handle. */
  public subscribe(listener: DebtListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /** Test seam — clears everything. */
  public __reset(): void {
    this._debts = [];
    this._nextId = 1;
    this._listeners.clear();
    if (this._storage) {
      try { this._storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private _nextStableId(): string {
    const id = `debt-${this._nextId.toString(36)}`;
    this._nextId += 1;
    return id;
  }

  private _seed(): void {
    const seedClock = this._clock();
    for (const partial of SEEDED_DEBTS) {
      this._debts.push({
        id: this._nextStableId(),
        title: partial.title,
        description: partial.description,
        category: partial.category,
        severity: partial.severity,
        domain: partial.domain,
        estimatedImpact: partial.estimatedImpact,
        createdAt: seedClock,
        status: 'open',
      });
    }
  }

  private _persist(): void {
    if (!this._storage) return;
    try {
      const envelope: PersistEnvelope = {
        schema: SCHEMA_VERSION,
        nextId: this._nextId,
        debts: this._debts,
      };
      this._storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // localStorage quota / SecurityError — drop silently; in-memory ring
      // remains canonical until the next setItem succeeds.
    }
  }

  private _hydrateFromStorage(): boolean {
    if (!this._storage) return false;
    let raw: string | null;
    try {
      raw = this._storage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as Partial<PersistEnvelope>;
      if (!parsed || typeof parsed !== 'object') return false;
      if (parsed.schema !== SCHEMA_VERSION) return false;
      if (!Array.isArray(parsed.debts)) return false;
      const valid = parsed.debts.filter((d) => isValidDebt(d));
      if (valid.length === 0 && parsed.debts.length > 0) return false;
      this._debts = valid.slice(-STORE_LIMIT);
      this._nextId = typeof parsed.nextId === 'number' && Number.isFinite(parsed.nextId)
        ? Math.max(parsed.nextId, this._debts.length + 1)
        : this._debts.length + 1;
      return true;
    } catch {
      return false;
    }
  }

  private _emit(debt: QualityDebt, kind: 'added' | 'updated'): void {
    if (this._listeners.size === 0) return;
    const snapshot = { ...debt };
    for (const fn of this._listeners) {
      try { fn(snapshot, kind); }
      catch { /* listener errors must not break the tracker */ }
    }
  }
}
