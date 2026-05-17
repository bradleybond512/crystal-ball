/**
 * Global Rhythm Engine — Phase 4 circadian / weekly / seasonal baseline.
 *
 * Builds running mean + variance per (domain, time-bucket) using
 * Welford's online algorithm so Crystal Ball can tell the difference
 * between a genuine anomaly and the kind of activity it sees every
 * day at 03:00 UTC. Seeded with sensible defaults per domain so the
 * engine emits useful anomaly scores from the first observation.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * patterns under `wm-global-rhythm-patterns` and the most-recent 1000
 * anomaly scores under `wm-global-rhythm-anomalies`.
 */

import type { ObservationEvent, ObservationSeverity } from './observation-adapters';

// ── Public types ──────────────────────────────────────────────────────

export type RhythmPatternType = 'circadian' | 'weekly' | 'seasonal';

export interface RhythmPattern {
  domain: string;
  patternType: RhythmPatternType;
  /** Expected severity mean per hour-of-day (length 24). Populated when
   *  patternType === 'circadian'. */
  expectedSeverityByHour?: number[];
  /** Expected severity mean per day-of-week (length 7; 0=Sunday).
   *  Populated when patternType === 'weekly'. */
  expectedSeverityByDayOfWeek?: number[];
  /** Expected severity mean per month (length 12; 0=January).
   *  Populated when patternType === 'seasonal'. */
  expectedSeverityByMonth?: number[];
  lastUpdated: number;
  sampleCount: number;
}

export type AnomalyStrength = 'none' | 'mild' | 'moderate' | 'strong';

export interface AnomalyScore {
  observationId: string;
  domain: string;
  currentSeverityNum: number;
  expectedSeverityNum: number;
  deviation: number;
  isAnomaly: boolean;
  anomalyStrength: AnomalyStrength;
  timestamp: number;
}

export type RhythmListener = (state: {
  patterns: RhythmPattern[];
  anomalies: AnomalyScore[];
}) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_PATTERNS_KEY = 'wm-global-rhythm-patterns';
const STORAGE_ANOMALIES_KEY = 'wm-global-rhythm-anomalies';
const MAX_ANOMALIES = 1000;

/** Severity → numeric in [0, 1]. Mirrors the band used in driver-scores
 *  but locked here so the Welford math has a stable input distribution
 *  even if the live ladder shifts. */
export const SEVERITY_TO_NUM: Record<ObservationSeverity, number> = {
  INFO: 0.1,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
};

/** Until this many real observations land in a bucket, the seed mean
 *  + seed stddev win. Past it, the learned Welford mean + sqrt(M2/(n-1))
 *  win. Picking 8 gives enough samples to dampen single-event spikes
 *  without making the engine slow to learn. */
export const MIN_LEARNED_SAMPLES = 8;

/** Floor on standard deviation — prevents division by ~0 when a bucket
 *  has produced near-identical observations. */
const STDDEV_FLOOR = 0.05;

/** Anomaly classification bands on |z|. */
export const ANOMALY_BANDS: { min: number; strength: AnomalyStrength }[] = [
  { min: 3, strength: 'strong' },
  { min: 2, strength: 'moderate' },
  { min: 1, strength: 'mild' },
  { min: 0, strength: 'none' },
];

// ── Welford state ────────────────────────────────────────────────────

interface WelfordStats {
  n: number;
  mean: number;
  m2: number;
}

function freshWelford(): WelfordStats {
  return { n: 0, mean: 0, m2: 0 };
}

/** Welford's online update — single-pass running mean + sum-of-squares. */
function welfordUpdate(stats: WelfordStats, value: number): void {
  stats.n += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.n;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
}

function welfordStddev(stats: WelfordStats): number {
  if (stats.n < 2) return STDDEV_FLOOR;
  const variance = stats.m2 / (stats.n - 1);
  if (!Number.isFinite(variance) || variance < 0) return STDDEV_FLOOR;
  return Math.max(STDDEV_FLOOR, Math.sqrt(variance));
}

// ── Domain seeds ──────────────────────────────────────────────────────

interface DomainSeed {
  domain: string;
  /** Length-24 expected hourly means in [0, 1]. */
  hourly: number[];
  /** Length-7 expected weekly means in [0, 1]. 0 = Sunday. */
  daily: number[];
  /** Length-12 expected monthly means in [0, 1]. 0 = January. */
  monthly: number[];
  /** Domain-level stddev used while sampleCount < MIN_LEARNED_SAMPLES. */
  seedStddev: number;
}

function flatSeed(domain: string, baseline: number, stddev: number): DomainSeed {
  return {
    domain,
    hourly: Array.from({length: 24}).fill(baseline),
    daily: Array.from({length: 7}).fill(baseline),
    monthly: Array.from({length: 12}).fill(baseline),
    seedStddev: stddev,
  };
}

function shapedHourly(peakHours: readonly number[], baseline: number, peak: number): number[] {
  const out: number[] = Array.from({length: 24}).fill(baseline);
  for (const h of peakHours) {
    if (h >= 0 && h < 24) out[h] = peak;
  }
  return out;
}

function shapedMonthly(peakMonths: readonly number[], baseline: number, peak: number): number[] {
  const out: number[] = Array.from({length: 12}).fill(baseline);
  for (const m of peakMonths) {
    if (m >= 0 && m < 12) out[m] = peak;
  }
  return out;
}

/** Eight built-in seeds chosen to reflect each domain's plausible
 *  baseline rhythm so anomaly scoring is useful before learning has
 *  accumulated. Values are deliberate-but-conservative — every bucket
 *  starts well below CRITICAL so a real CRITICAL event always shows up
 *  as an anomaly out of the gate. */
export const BUILT_IN_SEEDS: readonly DomainSeed[] = [
  // Geophysical — roughly time-of-day invariant.
  { ...flatSeed('earthquake', 0.3, 0.12) },
  // Biosurveillance reports cluster during business hours (UTC roughly
  // tracks European working day for the global reporting pipeline).
  {
    domain: 'biosurveillance',
    hourly: shapedHourly([8, 9, 10, 11, 12, 13, 14, 15, 16], 0.2, 0.35),
    daily: [0.18, 0.32, 0.32, 0.32, 0.32, 0.3, 0.22],
    monthly: shapedMonthly([0, 1, 9, 10, 11], 0.25, 0.35),
    seedStddev: 0.1,
  },
  // Weather: severe convective bias toward late afternoon / evening in
  // the northern hemisphere.
  {
    domain: 'weather',
    hourly: shapedHourly([14, 15, 16, 17, 18, 19, 20], 0.25, 0.45),
    daily: Array.from({length: 7}).fill(0.3),
    monthly: shapedMonthly([5, 6, 7, 8], 0.25, 0.45),
    seedStddev: 0.14,
  },
  // Maritime: business hours for reporting; pirate-prone seas push the
  // baseline up slightly in some months but we leave that to learning.
  {
    domain: 'maritime',
    hourly: shapedHourly([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 0.2, 0.3),
    daily: [0.18, 0.28, 0.28, 0.28, 0.28, 0.26, 0.2],
    monthly: Array.from({length: 12}).fill(0.25),
    seedStddev: 0.1,
  },
  // Aviation: peak operational hours; weekends slightly lighter.
  {
    domain: 'aviation',
    hourly: shapedHourly([6, 7, 8, 9, 16, 17, 18, 19, 20], 0.2, 0.35),
    daily: [0.2, 0.3, 0.32, 0.32, 0.32, 0.3, 0.22],
    monthly: Array.from({length: 12}).fill(0.27),
    seedStddev: 0.11,
  },
  // Wildfire: hot, dry afternoons in fire-season months.
  {
    domain: 'wildfire',
    hourly: shapedHourly([12, 13, 14, 15, 16, 17, 18], 0.2, 0.5),
    daily: Array.from({length: 7}).fill(0.28),
    monthly: shapedMonthly([5, 6, 7, 8, 9], 0.25, 0.55),
    seedStddev: 0.15,
  },
  // Space weather: solar driven, no time-of-day pattern.
  { ...flatSeed('space-weather', 0.25, 0.13) },
  // Geopolitical: business hours bias + slight weekday lift.
  {
    domain: 'geopolitical',
    hourly: shapedHourly([8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 0.25, 0.4),
    daily: [0.22, 0.36, 0.38, 0.38, 0.38, 0.34, 0.24],
    monthly: Array.from({length: 12}).fill(0.32),
    seedStddev: 0.12,
  },
];

const SEEDS_BY_DOMAIN = new Map(BUILT_IN_SEEDS.map((s) => [s.domain, s]));

// ── Internal per-domain state ────────────────────────────────────────

interface DomainState {
  hourly: WelfordStats[];
  daily: WelfordStats[];
  monthly: WelfordStats[];
  lastUpdated: number;
  sampleCount: number;
}

function freshDomainState(now: number): DomainState {
  return {
    hourly: Array.from({ length: 24 }, freshWelford),
    daily: Array.from({ length: 7 }, freshWelford),
    monthly: Array.from({ length: 12 }, freshWelford),
    lastUpdated: now,
    sampleCount: 0,
  };
}

// ── Storage helpers ──────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

export function severityToNumber(severity: ObservationSeverity): number {
  return SEVERITY_TO_NUM[severity] ?? 0;
}

function bucketsFromTimestamp(timestamp: number): { hour: number; day: number; month: number } {
  const d = new Date(timestamp);
  return { hour: d.getUTCHours(), day: d.getUTCDay(), month: d.getUTCMonth() };
}

function strengthForZ(absZ: number): AnomalyStrength {
  for (const band of ANOMALY_BANDS) {
    if (absZ >= band.min) return band.strength;
  }
  return 'none';
}

function seedFor(domain: string): DomainSeed {
  return SEEDS_BY_DOMAIN.get(domain) ?? flatSeed(domain, 0.3, 0.15);
}

function meanForBucket(
  bucket: WelfordStats,
  seedFallback: number,
): number {
  if (bucket.n < MIN_LEARNED_SAMPLES) return seedFallback;
  return bucket.mean;
}

function stddevForBucket(bucket: WelfordStats, seedStddev: number): number {
  if (bucket.n < MIN_LEARNED_SAMPLES) return seedStddev;
  return welfordStddev(bucket);
}

/** Compose the learned-or-seeded mean array for a pattern dimension.
 *  Falls back to the seed array when the state hasn't been initialised
 *  yet so callers always receive a full-length array. */
function buildBucketMeans(
  buckets: readonly WelfordStats[] | undefined,
  seedMeans: readonly number[],
): number[] {
  if (!buckets) return [...seedMeans];
  return buckets.map((bucket, i) => meanForBucket(bucket ?? freshWelford(), seedMeans[i]!));
}

// ── Engine ────────────────────────────────────────────────────────────

export interface GlobalRhythmOptions {
  clock?: () => number;
}

export class GlobalRhythmEngine {
  private domains = new Map<string, DomainState>();
  private anomalies: AnomalyScore[] = [];
  private listeners = new Set<RhythmListener>();
  private hydrated = false;
  private clock: () => number;

  constructor(options: GlobalRhythmOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    this.hydratePatterns(store);
    this.hydrateAnomalies(store);
  }

  private hydratePatterns(store: Storage): void {
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_PATTERNS_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      this.domains = deserializeDomains(parsed);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private hydrateAnomalies(store: Storage): void {
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_ANOMALIES_KEY); } catch { return; }
    if (!raw) return;
    try {
      this.anomalies = deserializeAnomalies(JSON.parse(raw));
    } catch {
      // Corrupt — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_PATTERNS_KEY, JSON.stringify(serializeDomains(this.domains)));
      store.setItem(STORAGE_ANOMALIES_KEY, JSON.stringify(this.anomalies));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = {
      patterns: this.getAllPatterns(),
      anomalies: this.getRecentAnomalies(this.anomalies.length || 0),
    };
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Update running pattern statistics with a new observation. The
   *  observation's three time-buckets (hour-of-day, day-of-week, month)
   *  each receive a Welford update with the observation's numeric
   *  severity. */
  ingestObservation(obs: ObservationEvent): void {
    this.ensureHydrated();
    const now = this.clock();
    const value = severityToNumber(obs.severity);
    const state = this.domains.get(obs.domain) ?? freshDomainState(now);
    const { hour, day, month } = bucketsFromTimestamp(obs.timestamp);
    welfordUpdate(state.hourly[hour]!, value);
    welfordUpdate(state.daily[day]!, value);
    welfordUpdate(state.monthly[month]!, value);
    state.sampleCount += 1;
    state.lastUpdated = now;
    this.domains.set(obs.domain, state);
    this.persist();
    this.notify();
  }

  /** Score an observation against its domain's learned (or seeded)
   *  circadian baseline. The z-score is computed against the
   *  hour-of-day bucket — the strongest pattern in practice — but the
   *  weekly + seasonal buckets influence behavior indirectly by
   *  shifting the seed value once learned. */
  scoreAnomaly(obs: ObservationEvent): AnomalyScore {
    this.ensureHydrated();
    const state = this.domains.get(obs.domain) ?? freshDomainState(this.clock());
    const seed = seedFor(obs.domain);
    const { hour } = bucketsFromTimestamp(obs.timestamp);
    const hourlyBucket = state.hourly[hour]!;
    const expectedMean = meanForBucket(hourlyBucket, seed.hourly[hour]!);
    const stddev = stddevForBucket(hourlyBucket, seed.seedStddev);
    const value = severityToNumber(obs.severity);
    const deviation = value - expectedMean;
    const z = stddev > 0 ? deviation / stddev : 0;
    const absZ = Math.abs(z);
    const strength = strengthForZ(absZ);
    const score: AnomalyScore = {
      observationId: obs.id,
      domain: obs.domain,
      currentSeverityNum: value,
      expectedSeverityNum: +expectedMean.toFixed(4),
      deviation: +deviation.toFixed(4),
      isAnomaly: strength !== 'none',
      anomalyStrength: strength,
      timestamp: obs.timestamp,
    };
    this.anomalies.push(score);
    this.enforceAnomalyCapacity();
    this.persist();
    this.notify();
    return { ...score };
  }

  private enforceAnomalyCapacity(): void {
    if (this.anomalies.length <= MAX_ANOMALIES) return;
    this.anomalies.splice(0, this.anomalies.length - MAX_ANOMALIES);
  }

  /** The circadian pattern for the named domain (the canonical
   *  per-domain rhythm). Returns undefined when the domain is unknown
   *  and not in the seed set. */
  getPattern(domain: string): RhythmPattern | undefined {
    this.ensureHydrated();
    const state = this.domains.get(domain);
    const seed = SEEDS_BY_DOMAIN.get(domain);
    if (!state && !seed) return undefined;
    return this.buildPattern(domain, 'circadian', state);
  }

  /** All patterns across every seeded or learned domain, three records
   *  per domain (circadian / weekly / seasonal). */
  getAllPatterns(): RhythmPattern[] {
    this.ensureHydrated();
    const allDomains = new Set<string>([
      ...this.domains.keys(),
      ...SEEDS_BY_DOMAIN.keys(),
    ]);
    const out: RhythmPattern[] = [];
    for (const domain of allDomains) {
      const state = this.domains.get(domain);
      out.push(
        this.buildPattern(domain, 'circadian', state),
        this.buildPattern(domain, 'weekly', state),
        this.buildPattern(domain, 'seasonal', state),
      );
    }
    return out;
  }

  getRecentAnomalies(limit = 20): AnomalyScore[] {
    this.ensureHydrated();
    if (limit <= 0) return [];
    const start = Math.max(0, this.anomalies.length - limit);
    return this.anomalies.slice(start).map((a) => ({ ...a }));
  }

  private buildPattern(
    domain: string,
    patternType: RhythmPatternType,
    state: DomainState | undefined,
  ): RhythmPattern {
    const seed = seedFor(domain);
    const now = this.clock();
    const lastUpdated = state?.lastUpdated ?? now;
    const sampleCount = state?.sampleCount ?? 0;
    if (patternType === 'circadian') {
      return {
        domain, patternType, lastUpdated, sampleCount,
        expectedSeverityByHour: buildBucketMeans(state?.hourly, seed.hourly),
      };
    }
    if (patternType === 'weekly') {
      return {
        domain, patternType, lastUpdated, sampleCount,
        expectedSeverityByDayOfWeek: buildBucketMeans(state?.daily, seed.daily),
      };
    }
    return {
      domain, patternType, lastUpdated, sampleCount,
      expectedSeverityByMonth: buildBucketMeans(state?.monthly, seed.monthly),
    };
  }

  subscribe(listener: RhythmListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties domain state, anomalies, and persisted blobs. */
  resetForTesting(): void {
    this.domains = new Map();
    this.anomalies = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_PATTERNS_KEY); } catch { /* best effort */ }
      try { store.removeItem(STORAGE_ANOMALIES_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

interface PersistedDomain {
  domain: string;
  hourly: WelfordStats[];
  daily: WelfordStats[];
  monthly: WelfordStats[];
  lastUpdated: number;
  sampleCount: number;
}

function serializeDomains(domains: Map<string, DomainState>): PersistedDomain[] {
  return [...domains.entries()].map(([domain, state]) => ({
    domain,
    hourly: state.hourly.map((b) => ({ ...b })),
    daily: state.daily.map((b) => ({ ...b })),
    monthly: state.monthly.map((b) => ({ ...b })),
    lastUpdated: state.lastUpdated,
    sampleCount: state.sampleCount,
  }));
}

function asValidPersistedDomain(entry: unknown): PersistedDomain | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedDomain;
  if (typeof e.domain !== 'string') return undefined;
  if (!Array.isArray(e.hourly) || !Array.isArray(e.daily) || !Array.isArray(e.monthly)) return undefined;
  if (typeof e.lastUpdated !== 'number' || typeof e.sampleCount !== 'number') return undefined;
  return e;
}

function deserializeDomains(raw: unknown): Map<string, DomainState> {
  const out = new Map<string, DomainState>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const valid = asValidPersistedDomain(entry);
    if (!valid) continue;
    out.set(valid.domain, {
      hourly: padBuckets(valid.hourly, 24),
      daily: padBuckets(valid.daily, 7),
      monthly: padBuckets(valid.monthly, 12),
      lastUpdated: valid.lastUpdated,
      sampleCount: valid.sampleCount,
    });
  }
  return out;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bucketFrom(entry: unknown): WelfordStats {
  if (!entry || typeof entry !== 'object') return freshWelford();
  const e = entry as WelfordStats;
  return { n: safeNumber(e.n), mean: safeNumber(e.mean), m2: safeNumber(e.m2) };
}

function padBuckets(raw: unknown[], length: number): WelfordStats[] {
  return Array.from({ length }, (_, i) => bucketFrom(raw[i]));
}

function asValidAnomalyScore(entry: unknown): AnomalyScore | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as AnomalyScore;
  if (typeof e.observationId !== 'string' || typeof e.domain !== 'string') return undefined;
  if (typeof e.currentSeverityNum !== 'number' || typeof e.expectedSeverityNum !== 'number') return undefined;
  if (typeof e.deviation !== 'number' || typeof e.isAnomaly !== 'boolean') return undefined;
  if (typeof e.timestamp !== 'number') return undefined;
  return { ...e };
}

function deserializeAnomalies(raw: unknown): AnomalyScore[] {
  if (!Array.isArray(raw)) return [];
  const out: AnomalyScore[] = [];
  for (const entry of raw) {
    const valid = asValidAnomalyScore(entry);
    if (valid) out.push(valid);
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: GlobalRhythmEngine | null = null;

export function getGlobalRhythmEngine(): GlobalRhythmEngine {
  _singleton ??= new GlobalRhythmEngine();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetGlobalRhythmSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_PATTERNS_KEY,
  STORAGE_ANOMALIES_KEY,
  MAX_ANOMALIES,
  MIN_LEARNED_SAMPLES,
  STDDEV_FLOOR,
  SEEDS_BY_DOMAIN,
  freshDomainState,
  welfordUpdate,
  welfordStddev,
  bucketsFromTimestamp,
  strengthForZ,
};
