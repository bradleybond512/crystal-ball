/**
 * Pressure Baselines — rolling hour-of-week baseline per domain so the
 * mode-forecast advisory threshold can be context-aware.
 *
 * A 9:30 ET finance spike is routine; the same spike at 3am is anomalous.
 * Without a temporal baseline, mode-forecast fires identical advisories
 * for both. This service learns 168 per-hour buckets per domain
 * (7 days × 24 hours), maintains rolling mean + stddev via Welford's
 * online algorithm, and exposes:
 *
 *   - getBaseline(domain, hourOfWeek?)
 *       → { mean, stddev, samples } for a domain at a given hour-of-week
 *   - isAboveNormal(domain, pressure)
 *       → true iff `pressure` is ≥2σ above this-hour's baseline AND has
 *         enough samples to be meaningful
 *
 * mode-forecast uses `isAboveNormal` to decide whether a raised-pressure
 * reading merits an advisory, on top of the existing fixed threshold.
 * Persisted to IDB reasoning_memory so baselines accumulate over weeks.
 */

import type { ForecastDomain, ForecastSnapshot } from './mode-forecast';
import { getMemory, putMemory } from './reasoning-memory';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BucketStats {
  /** Running mean (Welford). */
  mean: number;
  /** M2 accumulator for variance (Welford). */
  m2: number;
  /** Number of samples observed. */
  samples: number;
}

export interface BaselineReading {
  mean: number;
  stddev: number;
  samples: number;
  hourOfWeek: number;
  sufficient: boolean;
}

type DomainBuckets = Record<ForecastDomain, BucketStats[]>;

// ── Constants ─────────────────────────────────────────────────────────────────

const HOURS_PER_WEEK = 168;
const MIN_SAMPLES = 5;
const STDDEV_ALERT = 2;
const STORAGE_KEY = 'crystalball-pressure-baselines-v1';

const DOMAINS: ForecastDomain[] = ['finance', 'security', 'disaster', 'cyber'];

// ── State ─────────────────────────────────────────────────────────────────────

function emptyBuckets(): BucketStats[] {
  return Array.from({ length: HOURS_PER_WEEK }, () => ({ mean: 0, m2: 0, samples: 0 }));
}

const buckets: DomainBuckets = {
  finance: emptyBuckets(),
  security: emptyBuckets(),
  disaster: emptyBuckets(),
  cyber: emptyBuckets(),
};

let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(stored: Partial<DomainBuckets> | null): void {
  if (!stored) return;
  for (const d of DOMAINS) {
    const arr = stored[d];
    if (Array.isArray(arr) && arr.length === HOURS_PER_WEEK) {
      buckets[d] = arr;
    }
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as Partial<DomainBuckets>);
  } catch { /* ignore */ }
  void getMemory<Partial<DomainBuckets>>(STORAGE_KEY).then(stored => {
    if (writtenSinceLoad) return;
    applyLoaded(stored);
  });
}

function save(): void {
  writtenSinceLoad = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buckets)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, buckets);
}

// ── Hour-of-week index ───────────────────────────────────────────────────────

/** UTC hour-of-week (0..167), Sunday-00:00 origin. */
export function hourOfWeek(date: Date = new Date()): number {
  return (date.getUTCDay() * 24) + date.getUTCHours();
}

// ── Welford update ───────────────────────────────────────────────────────────

function updateBucket(bucket: BucketStats, value: number): void {
  // Guard against NaN / non-finite inputs — one rogue sample would
  // propagate NaN into mean and variance forever, silently corrupting
  // the bucket. isAboveNormal would then return false against anything.
  if (!Number.isFinite(value)) return;
  bucket.samples += 1;
  const delta = value - bucket.mean;
  bucket.mean += delta / bucket.samples;
  const delta2 = value - bucket.mean;
  bucket.m2 += delta * delta2;
}

function stddevOf(bucket: BucketStats): number {
  if (bucket.samples < 2) return 0;
  return Math.sqrt(bucket.m2 / (bucket.samples - 1));
}

// ── Ingestion ────────────────────────────────────────────────────────────────

let writesSinceFlush = 0;
const FLUSH_EVERY = 8;

function ingest(snapshot: ForecastSnapshot): void {
  load();
  const how = hourOfWeek(new Date(snapshot.timestamp || Date.now()));
  for (const d of DOMAINS) {
    const bucket = buckets[d][how];
    if (!bucket) continue;
    const value = snapshot.pressure[d] ?? 0;
    updateBucket(bucket, value);
  }
  writesSinceFlush += 1;
  if (writesSinceFlush >= FLUSH_EVERY) {
    writesSinceFlush = 0;
    save();
  }
}

// ── Public read API ──────────────────────────────────────────────────────────

export function getBaseline(domain: ForecastDomain, how?: number): BaselineReading {
  load();
  const h = how ?? hourOfWeek();
  const bucket = buckets[domain][h];
  if (!bucket) {
    return { mean: 0, stddev: 0, samples: 0, hourOfWeek: h, sufficient: false };
  }
  return {
    mean: bucket.mean,
    stddev: stddevOf(bucket),
    samples: bucket.samples,
    hourOfWeek: h,
    sufficient: bucket.samples >= MIN_SAMPLES,
  };
}

/**
 * True iff the observed pressure is anomalously high for this hour-of-week.
 * Requires MIN_SAMPLES observations for the bucket; otherwise returns false
 * (we don't flag on sparse data to avoid boot-time false positives).
 */
export function isAboveNormal(domain: ForecastDomain, pressure: number): boolean {
  const b = getBaseline(domain);
  if (!b.sufficient) return false;
  if (b.stddev < 0.05) return pressure > b.mean + 0.15; // baseline almost flat — use absolute margin
  return pressure > b.mean + STDDEV_ALERT * b.stddev;
}

/**
 * Return the current deviation from baseline as a standard-score. Useful
 * for HUD to color-code advisories. Returns 0 if baseline is insufficient.
 */
export function deviationSigma(domain: ForecastDomain, pressure: number): number {
  const b = getBaseline(domain);
  if (!b.sufficient || b.stddev < 0.01) return 0;
  return (pressure - b.mean) / b.stddev;
}

/** Total observations across all buckets, for debug/overlay. */
export function totalSamples(): Record<ForecastDomain, number> {
  load();
  const out = { finance: 0, security: 0, disaster: 0, cyber: 0 } as Record<ForecastDomain, number>;
  for (const d of DOMAINS) {
    for (const b of buckets[d]) out[d] += b.samples;
  }
  return out;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startPressureBaselines(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:mode-advisory', (e: Event) => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    ingest(ce.detail);
  });
}
