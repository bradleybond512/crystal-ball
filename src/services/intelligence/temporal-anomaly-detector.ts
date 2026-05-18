/**
 * Temporal Anomaly Detector — flags when events happen at anomalous
 * times relative to a per-domain temporal baseline.
 *
 * Complements GlobalRhythmEngine: GlobalRhythm maintains baselines as
 * data flows in; this service turns deviations from those baselines
 * into actionable anomaly records ("major earthquake swarm at 3am
 * when the domain normally sees near-zero activity").
 *
 * Three bucketings are checked per call:
 *   - hourly   → 24 buckets (hour of day, UTC)
 *   - daily    → 7 buckets (day of week, 0=Sun)
 *   - weekly   → 52 buckets (ISO week - 1, mod 52)
 *
 * Per-bucket mean + variance are tracked with Welford's online
 * algorithm so a single pass keeps statistics stable without storing
 * the full history.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists anomalies to `wm-temporal-anomalies` (LIFO ring, max 2000)
 * and baselines to `wm-temporal-baselines` (one entry per
 * domain+pattern).
 */

// ── Public types ──────────────────────────────────────────────────────

export type TemporalPattern = 'hourly' | 'daily' | 'weekly';

export type AnomalyStrength = 'mild' | 'moderate' | 'strong' | 'extreme';

export interface TemporalAnomaly {
  id: string;
  domain: string;
  observationId: string;
  pattern: TemporalPattern;
  bucketIndex: number;
  expectedRate: number;
  observedCount: number;
  zScore: number;
  strength: AnomalyStrength;
  detectedAt: number;
  acknowledged: boolean;
}

export interface TemporalBaseline {
  domain: string;
  pattern: TemporalPattern;
  /** Running mean per bucket. Length: 24 (hourly), 7 (daily), 52 (weekly). */
  buckets: number[];
  /** Total observations rolled into the baseline across all buckets. */
  sampleCount: number;
}

export interface AnomalyFilter {
  domain?: string;
  strength?: AnomalyStrength;
  acknowledged?: boolean;
}

export interface AnomalySummary {
  total: number;
  byStrength: Record<AnomalyStrength, number>;
  unacknowledged: number;
  topDomain: string | null;
}

export type AnomalyListener = (anomaly: TemporalAnomaly) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface TemporalAnomalyDetectorOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const ANOMALIES_STORAGE_KEY = 'wm-temporal-anomalies';
export const BASELINES_STORAGE_KEY = 'wm-temporal-baselines';
export const MAX_ANOMALIES = 2000;

export const ZSCORE_DETECTION_FLOOR = 1;
export const MIN_STDDEV = 0.1;

const PATTERN_BUCKET_COUNT: Record<TemporalPattern, number> = {
  hourly: 24, daily: 7, weekly: 52,
};

const SEEDED_DOMAINS: readonly string[] = [
  'earthquake', 'biosurv', 'weather', 'maritime',
  'aviation', 'geopolitical', 'cyber', 'wildfire',
];

const STRENGTH_BUCKETS: readonly { min: number; max: number; strength: AnomalyStrength }[] = [
  { min: 4, max: Infinity, strength: 'extreme' },
  { min: 3, max: 4, strength: 'strong' },
  { min: 2, max: 3, strength: 'moderate' },
  { min: 1, max: 2, strength: 'mild' },
];

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function classify(absZ: number): AnomalyStrength | null {
  for (const b of STRENGTH_BUCKETS) {
    if (absZ >= b.min && absZ < b.max) return b.strength;
  }
  return null;
}

/** UTC hour-of-day, 0-23. */
export function bucketHourOfDay(timestamp: number): number {
  return new Date(timestamp).getUTCHours();
}

/** UTC day-of-week, 0=Sunday .. 6=Saturday. */
export function bucketDayOfWeek(timestamp: number): number {
  return new Date(timestamp).getUTCDay();
}

/** ISO-style week-of-year clamped to 0..51 (week 53 wraps to bucket 0).
 *  Deterministic across years and timezones (always UTC). */
export function bucketWeekOfYear(timestamp: number): number {
  const date = new Date(timestamp);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay();
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return (week - 1) % 52;
}

function bucketIndexFor(pattern: TemporalPattern, timestamp: number): number {
  switch (pattern) {
    case 'hourly': { return bucketHourOfDay(timestamp); }
    case 'daily': { return bucketDayOfWeek(timestamp); }
    case 'weekly': { return bucketWeekOfYear(timestamp); }
  }
}

function cloneAnomaly(a: TemporalAnomaly): TemporalAnomaly {
  return { ...a };
}

function emptyByStrength(): Record<AnomalyStrength, number> {
  return { mild: 0, moderate: 0, strong: 0, extreme: 0 };
}

function baselineKey(domain: string, pattern: TemporalPattern): string {
  return `${domain}::${pattern}`;
}

// ── Service ───────────────────────────────────────────────────────────

interface InternalBaseline {
  domain: string;
  pattern: TemporalPattern;
  means: number[];
  /** Per-bucket count of samples folded in (Welford's `n`). */
  bucketCounts: number[];
  /** Per-bucket sum-of-squared-differences (Welford's M2). */
  bucketM2: number[];
}

function makeInternalBaseline(domain: string, pattern: TemporalPattern): InternalBaseline {
  const len = PATTERN_BUCKET_COUNT[pattern];
  return {
    domain, pattern,
    means: Array.from({ length: len }, () => 1),
    bucketCounts: Array.from({ length: len }, () => 0),
    bucketM2: Array.from({ length: len }, () => 0),
  };
}

function restoreInternalBaseline(entry: unknown): InternalBaseline | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Partial<InternalBaseline>;
  if (typeof e.domain !== 'string') return null;
  if (e.pattern !== 'hourly' && e.pattern !== 'daily' && e.pattern !== 'weekly') return null;
  const len = PATTERN_BUCKET_COUNT[e.pattern];
  if (!Array.isArray(e.means) || e.means.length !== len) return null;
  const zeros = Array.from({ length: len }, () => 0);
  return {
    domain: e.domain,
    pattern: e.pattern,
    means: [...e.means],
    bucketCounts: Array.isArray(e.bucketCounts) ? e.bucketCounts.slice(0, len) : zeros,
    bucketM2: Array.isArray(e.bucketM2) ? e.bucketM2.slice(0, len) : zeros,
  };
}

function publicBaselineFrom(b: InternalBaseline): TemporalBaseline {
  return {
    domain: b.domain,
    pattern: b.pattern,
    buckets: [...b.means],
    sampleCount: b.bucketCounts.reduce((acc, n) => acc + n, 0),
  };
}

export class TemporalAnomalyDetectorService {
  private anomalies: TemporalAnomaly[] = [];
  private baselines = new Map<string, InternalBaseline>();
  private listeners = new Set<AnomalyListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: TemporalAnomalyDetectorOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Baseline API ───────────────────────────────────────────────────

  updateBaseline(domain: string, pattern: TemporalPattern, bucketIndex: number, count: number): void {
    this.ensureHydrated();
    const len = PATTERN_BUCKET_COUNT[pattern];
    if (bucketIndex < 0 || bucketIndex >= len) return;
    const baseline = this.getOrCreateInternalBaseline(domain, pattern);
    // Welford's online algorithm for the targeted bucket.
    const n = baseline.bucketCounts[bucketIndex]! + 1;
    const oldMean = baseline.means[bucketIndex]!;
    const delta = count - oldMean;
    const newMean = oldMean + delta / n;
    const delta2 = count - newMean;
    baseline.means[bucketIndex] = newMean;
    baseline.bucketCounts[bucketIndex] = n;
    baseline.bucketM2[bucketIndex] = baseline.bucketM2[bucketIndex]! + delta * delta2;
    this.persistBaselines();
  }

  getBaseline(domain: string, pattern: TemporalPattern): TemporalBaseline {
    this.ensureHydrated();
    const baseline = this.getOrCreateInternalBaseline(domain, pattern);
    return publicBaselineFrom(baseline);
  }

  // ── Detection ──────────────────────────────────────────────────────

  detect(domain: string, observationId: string, timestamp: number, count: number): TemporalAnomaly | null {
    this.ensureHydrated();
    let best: TemporalAnomaly | null = null;
    for (const pattern of ['hourly', 'daily', 'weekly'] as const) {
      const candidate = this.detectFor(domain, observationId, timestamp, count, pattern);
      if (!candidate) continue;
      if (!best || Math.abs(candidate.zScore) > Math.abs(best.zScore)) best = candidate;
    }
    if (best) this.record(best);
    return best ? cloneAnomaly(best) : null;
  }

  private detectFor(
    domain: string,
    observationId: string,
    timestamp: number,
    count: number,
    pattern: TemporalPattern,
  ): TemporalAnomaly | null {
    const baseline = this.getOrCreateInternalBaseline(domain, pattern);
    const bucketIndex = bucketIndexFor(pattern, timestamp);
    const mean = baseline.means[bucketIndex] ?? 0;
    const n = baseline.bucketCounts[bucketIndex] ?? 0;
    const rawStddev = n > 1 ? Math.sqrt((baseline.bucketM2[bucketIndex] ?? 0) / n) : 0;
    const stddev = Math.max(rawStddev, MIN_STDDEV);
    const z = (count - mean) / stddev;
    if (Math.abs(z) < ZSCORE_DETECTION_FLOOR) return null;
    const strength = classify(Math.abs(z));
    if (!strength) return null;
    const now = this.clock();
    this.idSeq += 1;
    return {
      id: `tan-${now.toString(36)}-${this.idSeq}`,
      domain, observationId, pattern, bucketIndex,
      expectedRate: Number(mean.toFixed(4)),
      observedCount: count,
      zScore: Number(z.toFixed(4)),
      strength,
      detectedAt: now,
      acknowledged: false,
    };
  }

  // ── Reads / mutations ──────────────────────────────────────────────

  acknowledge(id: string): TemporalAnomaly | undefined {
    this.ensureHydrated();
    const idx = this.anomalies.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const current = this.anomalies[idx]!;
    if (current.acknowledged) return cloneAnomaly(current);
    const next: TemporalAnomaly = { ...current, acknowledged: true };
    this.anomalies[idx] = next;
    this.persistAnomalies();
    return cloneAnomaly(next);
  }

  getAnomalies(filter: AnomalyFilter = {}, limit?: number): TemporalAnomaly[] {
    this.ensureHydrated();
    const matched = this.anomalies.filter((a) => {
      if (filter.domain && a.domain !== filter.domain) return false;
      if (filter.strength && a.strength !== filter.strength) return false;
      if (filter.acknowledged !== undefined && a.acknowledged !== filter.acknowledged) return false;
      return true;
    });
    const ordered: TemporalAnomaly[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((a) => cloneAnomaly(a));
  }

  getSummary(): AnomalySummary {
    this.ensureHydrated();
    const byStrength = emptyByStrength();
    const byDomain = new Map<string, number>();
    let unacknowledged = 0;
    for (const a of this.anomalies) {
      byStrength[a.strength] += 1;
      byDomain.set(a.domain, (byDomain.get(a.domain) ?? 0) + 1);
      if (!a.acknowledged) unacknowledged += 1;
    }
    let topDomain: string | null = null;
    let topCount = 0;
    for (const [d, c] of byDomain) {
      if (c > topCount) { topDomain = d; topCount = c; }
    }
    return { total: this.anomalies.length, byStrength, unacknowledged, topDomain };
  }

  subscribe(listener: AnomalyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: AnomalyListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and persisted blobs. */
  resetForTesting(): void {
    this.anomalies = [];
    this.baselines.clear();
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(ANOMALIES_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(BASELINES_STORAGE_KEY); } catch { /* ignore */ }
    }
    this.seedDefaultBaselines();
  }

  // ── Internal ───────────────────────────────────────────────────────

  private record(anomaly: TemporalAnomaly): void {
    this.anomalies.push(anomaly);
    if (this.anomalies.length > MAX_ANOMALIES) {
      this.anomalies.splice(0, this.anomalies.length - MAX_ANOMALIES);
    }
    this.persistAnomalies();
    const snapshot = cloneAnomaly(anomaly);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private getOrCreateInternalBaseline(domain: string, pattern: TemporalPattern): InternalBaseline {
    const key = baselineKey(domain, pattern);
    const existing = this.baselines.get(key);
    if (existing) return existing;
    const next = makeInternalBaseline(domain, pattern);
    this.baselines.set(key, next);
    return next;
  }

  private seedDefaultBaselines(): void {
    for (const domain of SEEDED_DOMAINS) {
      for (const pattern of ['hourly', 'daily', 'weekly'] as const) {
        const key = baselineKey(domain, pattern);
        if (!this.baselines.has(key)) {
          this.baselines.set(key, makeInternalBaseline(domain, pattern));
        }
      }
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.seedDefaultBaselines();
    if (!this.storage) return;
    this.hydrateAnomalies();
    this.hydrateBaselines();
  }

  private hydrateAnomalies(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(ANOMALIES_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as TemporalAnomaly[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.id === 'string') this.anomalies.push({ ...entry });
      }
    } catch { /* corrupt */ }
  }

  private hydrateBaselines(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(BASELINES_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: InternalBaseline[] | null;
    try { parsed = JSON.parse(raw) as InternalBaseline[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      const restored = restoreInternalBaseline(entry);
      if (restored) this.baselines.set(baselineKey(restored.domain, restored.pattern), restored);
    }
  }

  private persistAnomalies(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(ANOMALIES_STORAGE_KEY, JSON.stringify(this.anomalies));
    } catch { /* best effort */ }
  }

  private persistBaselines(): void {
    if (!this.storage) return;
    const payload = [...this.baselines.values()];
    try {
      this.storage.setItem(BASELINES_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: TemporalAnomalyDetectorService | null = null;

export function getTemporalAnomalyDetectorService(): TemporalAnomalyDetectorService {
  _singleton ??= new TemporalAnomalyDetectorService();
  return _singleton;
}

export function __resetTemporalAnomalyDetectorServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SEEDED_DOMAINS,
  PATTERN_BUCKET_COUNT,
  STRENGTH_BUCKETS,
  ZSCORE_DETECTION_FLOOR,
  MIN_STDDEV,
  MAX_ANOMALIES,
};
