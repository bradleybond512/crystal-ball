/**
 * Baseline deviation engine — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 4 (lines 541-557).
 *
 * Adds rolling baselines for:
 *   - Aircraft (counts in a region)
 *   - Vessels
 *   - Alerts per region
 *   - Cyber indicators
 *   - Market volatility
 *   - Weather hazards
 *   - Power and infrastructure signals
 *
 * For each input series, output a z-score and a percentile rank that
 * the rest of the app can render as "this is 3.2σ above normal" or
 * "highest in 12 months".
 *
 * Pure deterministic. No DOM, no fetch. The store keeps a rolling
 * window of samples per (metric, bucket) pair; metrics are arbitrary
 * strings so callers can use whatever vocabulary they want.
 *
 * Plan invariants:
 *   - Baselines must be updatable incrementally (no full re-aggregation
 *     on every tick).
 *   - Sparse buckets (just appeared, not enough history) must be
 *     reported as low-confidence rather than crashing the consumer.
 *   - Output must be testable with static fixtures.
 */

// ── Public types ─────────────────────────────────────────────────────────

/** Free-form metric identity. Convention: `${domain}:${kind}:${bucket}`,
 *  e.g. "aviation:aircraft-count:US-CA", "weather:tornado-warnings:US-IN".
 *  The module doesn't parse this — it just keys by the full string.
 *  Exported for documentation; the runtime type is `string`. */
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type MetricKey = string;

export interface BaselineSample {
  /** Epoch ms. */
  t: number;
  /** Numeric observation. */
  v: number;
}

export interface BaselineSummary {
  metric: MetricKey;
  /** Number of samples in the window currently used for stats. */
  windowSize: number;
  mean: number;
  /** Population standard deviation (n-divisor, not n-1). Robust to
   *  small windows. */
  stdDev: number;
  /** Min / max in the window — useful for percentile rendering. */
  min: number;
  max: number;
  /** Most-recent sample's timestamp. Undefined when no samples. */
  latest?: number;
}

export interface DeviationResult {
  metric: MetricKey;
  /** The numeric value being evaluated. */
  value: number;
  /** Z-score: (value - mean) / stdDev. 0 when stdDev is 0 or window is
   *  too small for a meaningful z. */
  zScore: number;
  /** Percentile rank in 0-1 (fraction of window samples ≤ value). */
  percentile: number;
  /** Confidence in the deviation calculation, 0-1. Drops when window
   *  is small or all samples are equal. */
  confidence: number;
  /** Categorical label the UI can render. */
  label: 'normal' | 'mild_high' | 'high' | 'extreme_high' | 'mild_low' | 'low' | 'extreme_low' | 'insufficient_data';
  /** Plain-text summary line: "3.2σ above mean over 168 samples". */
  summary: string;
}

// ── Store ────────────────────────────────────────────────────────────────

export interface BaselineStoreOptions {
  /** Maximum samples kept per metric. Older samples are dropped on
   *  insertion. Default 168 — one week of hourly observations. */
  maxSamplesPerMetric?: number;
  /** Drop samples whose age exceeds this many ms. Default 90 days. */
  maxAgeMs?: number;
  /** Minimum samples needed before z-scores are computed. Default 12. */
  minSamplesForZ?: number;
  /**
   * Warmup mode: when `true`, the store computes z-scores with as few as 3
   * samples but applies a confidence penalty that scales linearly from 0 at
   * 3 samples to the full value at `minSamplesForZ`. This prevents the
   * "0 anomalies forever" cold-start problem on fresh launches — the first
   * few hours of data are usable for coarse anomaly detection even before a
   * full baseline window has accumulated. Default `false`.
   */
  warmupMode?: boolean;
}

export interface BaselineStore {
  record: (metric: MetricKey, sample: BaselineSample) => void;
  /** Current summary for a metric, or undefined when no samples. */
  summary: (metric: MetricKey) => BaselineSummary | undefined;
  /** Compute deviation of `value` against the current baseline for `metric`.
   *  Returns `insufficient_data` when fewer than `minSamplesForZ`
   *  samples exist. */
  deviation: (metric: MetricKey, value: number) => DeviationResult;
  /** All metric keys with at least one sample. */
  metrics: () => string[];
  /** Drop samples older than `cutoff`. Returns count removed. */
  prune: (cutoff: number) => number;
  size: (metric?: MetricKey) => number;
  /** Serialize for persistence. */
  toJson: () => Record<MetricKey, BaselineSample[]>;
  loadJson: (state: Readonly<Record<MetricKey, readonly BaselineSample[]>>) => void;
}

const WARMUP_MIN_SAMPLES = 3;

const DEFAULTS = {
  warmupMode: false,
  maxSamplesPerMetric: 168,
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  minSamplesForZ: 12,
};

export function createBaselineStore(options: BaselineStoreOptions = {}): BaselineStore {
  const opts = { ...DEFAULTS, ...options };
  const data = new Map<MetricKey, BaselineSample[]>();

  function record(metric: MetricKey, sample: BaselineSample): void {
    let samples = data.get(metric);
    if (!samples) {
      samples = [];
      data.set(metric, samples);
    }
    // Append; samples are not assumed sorted (callers may backfill).
    samples.push({ t: sample.t, v: sample.v });
    // Drop oldest beyond cap. Sort by t ascending so "oldest" is well-defined.
    if (samples.length > opts.maxSamplesPerMetric) {
      samples.sort((a, b) => a.t - b.t);
      samples.splice(0, samples.length - opts.maxSamplesPerMetric);
    }
  }

  function summary(metric: MetricKey): BaselineSummary | undefined {
    const samples = data.get(metric);
    if (!samples || samples.length === 0) return undefined;
    const stats = computeStats(samples);
    return {
      metric,
      windowSize: samples.length,
      mean: stats.mean,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      latest: samples.reduce((acc, s) => Math.max(acc, s.t), 0) || undefined,
    };
  }

  function deviation(metric: MetricKey, value: number): DeviationResult {
    const samples = data.get(metric) ?? [];
    const effectiveMin = opts.warmupMode ? WARMUP_MIN_SAMPLES : opts.minSamplesForZ;
    if (samples.length < effectiveMin) {
      return {
        metric,
        value,
        zScore: 0,
        percentile: 0.5,
        confidence: 0,
        label: 'insufficient_data',
        summary: `Insufficient history (${samples.length}/${opts.minSamplesForZ} samples needed)`,
      };
    }
    const stats = computeStats(samples);
    const z = stats.stdDev > 0 ? (value - stats.mean) / stats.stdDev : 0;
    const percentile = computePercentile(samples, value);
    // In warmup mode, scale confidence linearly from 0 at WARMUP_MIN_SAMPLES
    // to a 0.5 cap as we approach minSamplesForZ so early deviations are
    // usable but clearly discounted.
    let confidence = computeConfidence(samples.length, stats.stdDev, opts.minSamplesForZ);
    if (opts.warmupMode && samples.length < opts.minSamplesForZ) {
      // computeConfidence() floors to 0 below minSamplesForZ (its sample-count
      // term goes negative), so multiplying it by the warmup scale always
      // yielded 0 and defeated warmup mode. Derive the discounted confidence
      // directly from the warmup ramp, gated on there being variance to read.
      const warmupScale = (samples.length - WARMUP_MIN_SAMPLES) / Math.max(1, opts.minSamplesForZ - WARMUP_MIN_SAMPLES);
      const varianceConfidence = stats.stdDev > 0 ? 1 : 0;
      confidence = varianceConfidence * warmupScale * 0.5; // cap at 50% during warmup
    }
    const label = labelFor(z);
    const summary = buildSummary(z, stats, samples.length);
    return { metric, value, zScore: round3(z), percentile: round3(percentile), confidence: round3(confidence), label, summary };
  }

  function metrics(): string[] {
    return [...data.keys()];
  }

  function prune(cutoff: number): number {
    let removed = 0;
    for (const [metric, samples] of data) {
      const before = samples.length;
      const kept = samples.filter((s) => s.t >= cutoff);
      removed += before - kept.length;
      if (kept.length === 0) data.delete(metric);
      else data.set(metric, kept);
    }
    return removed;
  }

  function size(metric?: MetricKey): number {
    if (metric) return data.get(metric)?.length ?? 0;
    let total = 0;
    for (const samples of data.values()) total += samples.length;
    return total;
  }

  function toJson(): Record<MetricKey, BaselineSample[]> {
    const out: Record<MetricKey, BaselineSample[]> = {};
    for (const [metric, samples] of data) {
      out[metric] = samples.map((s) => ({ ...s }));
    }
    return out;
  }

  function loadJson(state: Readonly<Record<MetricKey, readonly BaselineSample[]>>): void {
    data.clear();
    for (const [metric, samples] of Object.entries(state)) {
      data.set(metric, samples.map((s) => ({ t: s.t, v: s.v })));
    }
  }

  return { record, summary, deviation, metrics, prune, size, toJson, loadJson };
}

// ── Stats ────────────────────────────────────────────────────────────────

interface Stats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
}

function computeStats(samples: readonly BaselineSample[]): Stats {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    sum += s.v;
    if (s.v < min) min = s.v;
    if (s.v > max) max = s.v;
  }
  const mean = sum / samples.length;
  let sqSum = 0;
  for (const s of samples) {
    const d = s.v - mean;
    sqSum += d * d;
  }
  const stdDev = Math.sqrt(sqSum / samples.length);
  return { mean, stdDev, min, max };
}

function computePercentile(samples: readonly BaselineSample[], value: number): number {
  let leq = 0;
  for (const s of samples) {
    if (s.v <= value) leq += 1;
  }
  return leq / samples.length;
}

function computeConfidence(n: number, stdDev: number, minN: number): number {
  // Two-component confidence: how many samples we have (saturating
  // at 4× minN) and how much variance is present (no variance = no
  // signal).
  const sampleConfidence = Math.min(1, (n - minN) / (3 * minN));
  const varianceConfidence = stdDev > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, sampleConfidence * varianceConfidence));
}

function labelFor(z: number): DeviationResult['label'] {
  if (z >= 3) return 'extreme_high';
  if (z >= 2) return 'high';
  if (z >= 1) return 'mild_high';
  if (z <= -3) return 'extreme_low';
  if (z <= -2) return 'low';
  if (z <= -1) return 'mild_low';
  return 'normal';
}

function buildSummary(z: number, stats: Stats, n: number): string {
  if (Math.abs(z) < 0.5) return `Within normal range (${n} samples, mean ${round3(stats.mean)})`;
  const direction = z > 0 ? 'above' : 'below';
  return `${Math.abs(z).toFixed(1)}σ ${direction} mean over ${n} samples`;
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
