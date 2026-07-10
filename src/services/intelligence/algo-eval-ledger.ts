/**
 * Algorithm Evaluation Ledger — Phase 4 prediction tracker.
 *
 * Records every prediction an algorithm makes (severity, numeric score,
 * whatever the algorithm emits) and lets a downstream resolver fill in
 * the actual outcome later. Computes MAE for numeric predictions and
 * accuracy for categorical predictions, plus a coarse last-30 vs prior-30
 * trend so we can tell whether the system is improving.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 5000 predictions to `localStorage` under
 * `wm-algo-eval-ledger`. Keeps no upward imports so producers and
 * consumers can safely depend on this module without cycles.
 */

export type PredictionValue = number | string;

export interface AlgorithmPrediction {
  id: string;
  algorithmId: string;
  domain: string;
  /** Join key shared with the resolver. Convention: `${domain}:${observationOrAlertId}`. */
  inputHash: string;
  predictedValue: PredictionValue;
  predictedAt: Date;
  resolvedValue?: PredictionValue;
  resolvedAt?: Date;
  /** Set when the outcome window elapsed with no trustworthy evidence (e.g. the
   *  app was closed across it). Expired predictions are neither pending nor a
   *  hit/miss — excluded from accuracy. */
  expiredAt?: Date;
  /** |predicted - resolved| when both are numeric. */
  error?: number;
  /** Strict-equality match when both are strings. */
  correct?: boolean;
}

/** Lifetime aggregate per (algorithmId, domain) — survives the FIFO record cap
 *  so accuracy doesn't reset when old resolved predictions are trimmed. */
export interface RollupBucket {
  resolved: number;
  correct: number;
  expired: number;
  errorSum: number;
  errorCount: number;
}

export type TrendDirection = 'improving' | 'stable' | 'degrading';

export interface AlgorithmStats {
  algorithmId: string;
  /** Specific domain when stats are filtered; `'*'` when aggregated across
   *  all domains for the algorithm. */
  domain: string;
  totalPredictions: number;
  resolvedCount: number;
  /** Predictions whose window elapsed with no trustworthy evidence. */
  expiredCount: number;
  meanAbsoluteError?: number;
  accuracy?: number;
  trend: TrendDirection;
  lastEvaluated: Date;
}

export type AlgoEvalListener = (predictions: AlgorithmPrediction[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-algo-eval-ledger';
const MAX_RECORDS = 5000;
const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Comparison window size for trend detection. Need TREND_WINDOW*2
 *  resolved samples before a verdict can be issued. */
export const TREND_WINDOW = 30;
/** Absolute MAE / accuracy delta required to call a trend
 *  improving/degrading instead of stable. */
export const TREND_THRESHOLD = 0.05;
export const ANY_DOMAIN = '*';

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Serialization ─────────────────────────────────────────────────────

interface PersistedPrediction extends Omit<AlgorithmPrediction, 'predictedAt' | 'resolvedAt' | 'expiredAt'> {
  predictedAt: number;
  resolvedAt?: number;
  expiredAt?: number;
}

function serialize(records: readonly AlgorithmPrediction[]): PersistedPrediction[] {
  return records.map((r) => ({
    ...r,
    predictedAt: r.predictedAt.getTime(),
    resolvedAt: r.resolvedAt?.getTime(),
    expiredAt: r.expiredAt?.getTime(),
  }));
}

function deserializeEntry(entry: unknown): AlgorithmPrediction | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedPrediction;
  if (typeof e.id !== 'string') return undefined;
  if (typeof e.algorithmId !== 'string') return undefined;
  if (typeof e.domain !== 'string') return undefined;
  if (typeof e.inputHash !== 'string') return undefined;
  if (typeof e.predictedAt !== 'number') return undefined;
  if (typeof e.predictedValue !== 'number' && typeof e.predictedValue !== 'string') return undefined;
  return {
    id: e.id,
    algorithmId: e.algorithmId,
    domain: e.domain,
    inputHash: e.inputHash,
    predictedValue: e.predictedValue,
    predictedAt: new Date(e.predictedAt),
    resolvedValue: typeof e.resolvedValue === 'number' || typeof e.resolvedValue === 'string'
      ? e.resolvedValue
      : undefined,
    resolvedAt: typeof e.resolvedAt === 'number' ? new Date(e.resolvedAt) : undefined,
    expiredAt: typeof e.expiredAt === 'number' ? new Date(e.expiredAt) : undefined,
    error: typeof e.error === 'number' ? e.error : undefined,
    correct: typeof e.correct === 'boolean' ? e.correct : undefined,
  };
}

function deserialize(raw: unknown): AlgorithmPrediction[] {
  if (!Array.isArray(raw)) return [];
  const out: AlgorithmPrediction[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Resolution math ───────────────────────────────────────────────────

function fillResolutionFields(p: AlgorithmPrediction, resolvedValue: PredictionValue, resolvedAt: Date): void {
  p.resolvedValue = resolvedValue;
  p.resolvedAt = resolvedAt;
  if (typeof p.predictedValue === 'number' && typeof resolvedValue === 'number') {
    p.error = Math.abs(p.predictedValue - resolvedValue);
    p.correct = undefined;
  } else {
    p.correct = p.predictedValue === resolvedValue;
    p.error = undefined;
  }
}

function meanAbsoluteErrorOf(records: readonly AlgorithmPrediction[]): number | undefined {
  const errs: number[] = [];
  for (const r of records) {
    if (typeof r.error === 'number') errs.push(r.error);
  }
  if (errs.length === 0) return undefined;
  return errs.reduce((s, e) => s + e, 0) / errs.length;
}

function accuracyOf(records: readonly AlgorithmPrediction[]): number | undefined {
  let total = 0;
  let correct = 0;
  for (const r of records) {
    if (typeof r.correct !== 'boolean') continue;
    total += 1;
    if (r.correct) correct += 1;
  }
  if (total === 0) return undefined;
  return correct / total;
}

function trendOf(records: readonly AlgorithmPrediction[]): TrendDirection {
  // Use only resolved records, sorted by resolution time.
  const resolved = records
    .filter((r) => r.resolvedAt instanceof Date)
    .sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime());
  if (resolved.length < TREND_WINDOW * 2) return 'stable';
  const last = resolved.slice(-TREND_WINDOW);
  const prior = resolved.slice(-TREND_WINDOW * 2, -TREND_WINDOW);

  const lastMae = meanAbsoluteErrorOf(last);
  const priorMae = meanAbsoluteErrorOf(prior);
  if (lastMae !== undefined && priorMae !== undefined) {
    if (lastMae + TREND_THRESHOLD < priorMae) return 'improving';
    if (lastMae > priorMae + TREND_THRESHOLD) return 'degrading';
    return 'stable';
  }

  const lastAcc = accuracyOf(last);
  const priorAcc = accuracyOf(prior);
  if (lastAcc !== undefined && priorAcc !== undefined) {
    if (lastAcc > priorAcc + TREND_THRESHOLD) return 'improving';
    if (lastAcc + TREND_THRESHOLD < priorAcc) return 'degrading';
    return 'stable';
  }

  return 'stable';
}

function statsFor(
  algorithmId: string,
  domain: string,
  records: readonly AlgorithmPrediction[],
  now: number,
): AlgorithmStats {
  const resolved = records.filter((r) => r.resolvedAt instanceof Date);
  const expiredCount = records.filter((r) => r.expiredAt instanceof Date && !r.resolvedAt).length;
  return {
    algorithmId,
    domain,
    totalPredictions: records.length,
    resolvedCount: resolved.length,
    expiredCount,
    meanAbsoluteError: meanAbsoluteErrorOf(resolved),
    accuracy: accuracyOf(resolved),
    trend: trendOf(records),
    lastEvaluated: new Date(now),
  };
}

// ── Ledger ────────────────────────────────────────────────────────────

export interface AlgoEvalLedgerOptions {
  /** Override Date.now() — useful for deterministic tests. */
  clock?: () => number;
}

export class AlgoEvalLedger {
  private records: AlgorithmPrediction[] = [];
  private rollup = new Map<string, RollupBucket>();
  private listeners = new Set<AlgoEvalListener>();
  private hydrated = false;
  private idCounter = 0;
  private clock: () => number;

  private rollupBucket(algorithmId: string, domain: string): RollupBucket {
    const key = `${algorithmId}::${domain}`;
    let b = this.rollup.get(key);
    if (!b) { b = { resolved: 0, correct: 0, expired: 0, errorSum: 0, errorCount: 0 }; this.rollup.set(key, b); }
    return b;
  }

  constructor(options: AlgoEvalLedgerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      // Legacy format was a bare records array; current format is
      // { records, rollup } so lifetime accuracy survives the FIFO trim.
      if (Array.isArray(parsed)) {
        this.records = deserialize(parsed);
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as { records?: unknown; rollup?: unknown };
        this.records = deserialize(obj.records ?? []);
        this.loadRollup(obj.rollup);
      }
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private loadRollup(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    for (const [k, v] of Object.entries(raw as Record<string, RollupBucket>)) {
      if (v && typeof v === 'object') this.rollup.set(k, { ...v });
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      const rollup: Record<string, RollupBucket> = {};
      for (const [k, v] of this.rollup) rollup[k] = v;
      store.setItem(STORAGE_KEY, JSON.stringify({ records: serialize(this.records), rollup }));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextId(now: number): string {
    this.idCounter += 1;
    return `algo-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = this.list();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Record a prediction. The caller can omit `id` (and `predictedAt`
   *  to use the ledger clock). Returns a defensive copy. */
  record(prediction: Omit<AlgorithmPrediction, 'id'>): AlgorithmPrediction {
    this.ensureHydrated();
    const now = this.clock();
    const stamped: AlgorithmPrediction = {
      ...prediction,
      id: this.nextId(now),
      predictedAt: prediction.predictedAt ?? new Date(now),
    };
    this.records.push(stamped);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return clonePrediction(stamped);
  }

  /** Fill in the actual outcome for a previously-recorded prediction.
   *  No-op when the id is unknown or the prediction is already resolved. */
  resolve(id: string, resolvedValue: PredictionValue): void {
    this.ensureHydrated();
    const match = this.records.find((r) => r.id === id);
    if (!match || match.resolvedAt || match.expiredAt) return;
    fillResolutionFields(match, resolvedValue, new Date(this.clock()));
    const b = this.rollupBucket(match.algorithmId, match.domain);
    b.resolved += 1;
    if (match.correct === true) b.correct += 1;
    if (typeof match.error === 'number') { b.errorSum += match.error; b.errorCount += 1; }
    this.persist();
    this.notify();
  }

  /** Mark a prediction whose outcome window elapsed without trustworthy
   *  evidence. Excluded from accuracy; counted in the lifetime rollup. */
  expire(id: string): void {
    this.ensureHydrated();
    const match = this.records.find((r) => r.id === id);
    if (!match || match.resolvedAt || match.expiredAt) return;
    match.expiredAt = new Date(this.clock());
    this.rollupBucket(match.algorithmId, match.domain).expired += 1;
    this.persist();
    this.notify();
  }

  /** Lifetime rollup for an (algorithmId, domain), or `null` if none yet. */
  getRollup(algorithmId: string, domain: string): RollupBucket | null {
    this.ensureHydrated();
    const b = this.rollup.get(`${algorithmId}::${domain}`);
    return b ? { ...b } : null;
  }

  /** Resolve the OLDEST unresolved prediction matching the given
   *  algorithmId + inputHash. Used by upstream consumers (e.g. the
   *  OutcomeLedger) that don't know the prediction id but share a
   *  stable join key. */
  resolveByInputHash(
    algorithmId: string,
    inputHash: string,
    resolvedValue: PredictionValue,
  ): void {
    this.ensureHydrated();
    const match = this.records.find(
      (r) => r.algorithmId === algorithmId && r.inputHash === inputHash && !r.resolvedAt,
    );
    if (!match) return;
    fillResolutionFields(match, resolvedValue, new Date(this.clock()));
    this.persist();
    this.notify();
  }

  private enforceCapacity(): void {
    if (this.records.length <= MAX_RECORDS) return;
    this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  list(): AlgorithmPrediction[] {
    this.ensureHydrated();
    return this.records.map((r) => clonePrediction(r));
  }

  getRecent(algorithmId?: string, sinceMs: number = DEFAULT_RECENT_WINDOW_MS): AlgorithmPrediction[] {
    this.ensureHydrated();
    const cutoff = sinceMs <= 0 ? -Infinity : this.clock() - sinceMs;
    return this.records
      .filter((r) => (algorithmId === undefined || r.algorithmId === algorithmId)
        && r.predictedAt.getTime() >= cutoff)
      .map((r) => clonePrediction(r));
  }

  getUnresolved(algorithmId?: string): AlgorithmPrediction[] {
    this.ensureHydrated();
    return this.records
      .filter((r) => !r.resolvedAt && !r.expiredAt && (algorithmId === undefined || r.algorithmId === algorithmId))
      .map((r) => clonePrediction(r));
  }

  getStats(algorithmId: string, domain?: string): AlgorithmStats {
    this.ensureHydrated();
    const matching = this.records.filter(
      (r) => r.algorithmId === algorithmId && (domain === undefined || r.domain === domain),
    );
    return statsFor(algorithmId, domain ?? ANY_DOMAIN, matching, this.clock());
  }

  /** One stats row per unique (algorithmId, domain) pair, sorted by
   *  totalPredictions descending. */
  getAllStats(): AlgorithmStats[] {
    this.ensureHydrated();
    const grouped = new Map<string, AlgorithmPrediction[]>();
    for (const r of this.records) {
      const key = `${r.algorithmId}::${r.domain}`;
      const list = grouped.get(key);
      if (list) list.push(r);
      else grouped.set(key, [r]);
    }
    const now = this.clock();
    const out: AlgorithmStats[] = [];
    for (const [key, recs] of grouped) {
      const [algorithmId, domain] = key.split('::') as [string, string];
      out.push(statsFor(algorithmId, domain, recs, now));
    }
    out.sort((a, b) => b.totalPredictions - a.totalPredictions);
    return out;
  }

  subscribe(listener: AlgoEvalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the ledger and the persisted blob. */
  resetForTesting(): void {
    this.records = [];
    this.rollup.clear();
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

function clonePrediction(p: AlgorithmPrediction): AlgorithmPrediction {
  return {
    ...p,
    predictedAt: new Date(p.predictedAt),
    resolvedAt: p.resolvedAt ? new Date(p.resolvedAt) : undefined,
    expiredAt: p.expiredAt ? new Date(p.expiredAt) : undefined,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: AlgoEvalLedger | null = null;

export function getAlgoEvalLedger(): AlgoEvalLedger {
  _singleton ??= new AlgoEvalLedger();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetAlgoEvalLedgerSingleton(): void {
  _singleton = null;
}

// ── Helpers + internals ───────────────────────────────────────────────

/** Stable join key shared between producers (driver-scorer) and
 *  resolvers (outcome-ledger). Convention is `${domain}:${id}` — the
 *  resolver-side caller passes the alert/observation id. */
export function buildInputHash(domain: string, id: string): string {
  return `${domain}:${id}`;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  DEFAULT_RECENT_WINDOW_MS,
  meanAbsoluteErrorOf,
  accuracyOf,
  trendOf,
  statsFor,
};
