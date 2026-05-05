/**
 * Rich Metrics Pipeline — PR 4 of the Algorithm Accuracy Enhancement Plan.
 *
 * Reads graded EvaluationRecords from the AlgorithmEvaluationLedger and
 * computes precision, recall, F1, accuracy, AUC-ROC, Brier score per
 * algorithm. Stratifies by severity tier (low/medium/high/critical) and
 * by rolling time window (7d/30d/90d). Produces calibration data
 * suitable for plotting a reliability diagram (10-bin predicted vs hit
 * rate).
 *
 * Pure deterministic. Reads ledger records, returns numbers; no DOM,
 * no fetch, no globals.
 *
 * Verdict source: outcomeReason starts with `[TRUE_POSITIVE]` /
 * `[FALSE_POSITIVE]` / etc. when written by the outcome resolver. When
 * absent (legacy records), falls back to outcome+score heuristics.
 */

import type {
  EvaluationRecord,
  AlgorithmDomain,
} from './algorithm-evaluation-ledger';
import type { ResolverVerdict } from './outcome-resolver';
import { extractVerdict } from './outcome-resolver';

// Public types

export type SeverityTier = 'low' | 'medium' | 'high' | 'critical';
export type MetricsWindow = '7d' | '30d' | '90d' | 'all';

export interface MetricsCounts {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  partial: number;
  inconclusive: number;
  total: number;
}

export interface MetricsScalars {
  /** TP / (TP + FP). NaN when TP+FP = 0. */
  precision: number;
  /** TP / (TP + FN). NaN when TP+FN = 0. */
  recall: number;
  /** 2PR/(P+R). NaN when either is NaN or both are 0. */
  f1: number;
  /** (TP + TN) / total. NaN when total = 0. */
  accuracy: number;
  /** AUC-ROC computed from score thresholds. NaN when fewer than 2 records
   *  with both classes present. */
  aucRoc: number;
  /** Brier score: mean((score - actualHit)^2). NaN when no scores. */
  brier: number;
}

export interface CalibrationBin {
  /** Lower bound (inclusive). */
  binStart: number;
  /** Upper bound (exclusive, except final bin which includes 1.0). */
  binEnd: number;
  /** Records whose score falls in this bin. */
  count: number;
  /** Average predicted confidence inside the bin. NaN when count=0. */
  meanPredicted: number;
  /** Fraction of records in this bin that were hits. NaN when count=0. */
  observedHitRate: number;
}

export interface MetricsByTier {
  low: MetricsScalars & MetricsCounts;
  medium: MetricsScalars & MetricsCounts;
  high: MetricsScalars & MetricsCounts;
  critical: MetricsScalars & MetricsCounts;
}

export interface MetricsByWindow {
  '7d': MetricsScalars & MetricsCounts;
  '30d': MetricsScalars & MetricsCounts;
  '90d': MetricsScalars & MetricsCounts;
}

export interface AlgorithmMetricsReport {
  algorithmId: string;
  domain: AlgorithmDomain | null;
  generatedAt: number;
  overall: MetricsScalars & MetricsCounts;
  byTier: MetricsByTier;
  byWindow: MetricsByWindow;
  calibration: CalibrationBin[];
}

// Severity tiers

export function severityTierForScore(score: number | undefined): SeverityTier | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0.3) return 'low';
  if (score < 0.5) return 'medium';
  if (score < 0.75) return 'high';
  return 'critical';
}

// Verdict resolution

function resolveVerdict(record: EvaluationRecord): ResolverVerdict | null {
  const explicit = extractVerdict(record.outcomeReason);
  if (explicit) return explicit;
  // Fallback heuristic for legacy records that pre-date the resolver.
  switch (record.outcome) {
    case 'hit': {
      return 'TRUE_POSITIVE';
    }
    case 'partial': {
      return 'TRUE_POSITIVE';
    }
    case 'miss': {
      return typeof record.score === 'number' && record.score >= 0.5
        ? 'FALSE_POSITIVE'
        : 'FALSE_NEGATIVE';
    }
    case 'inconclusive': {
      return 'TRUE_NEGATIVE';
    }
    default: {
      return null;
    }
  }
}

// Counts + scalars

function freshCounts(): MetricsCounts {
  return {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    partial: 0,
    inconclusive: 0,
    total: 0,
  };
}

function tallyRecord(counts: MetricsCounts, record: EvaluationRecord): void {
  counts.total += 1;
  const verdict = resolveVerdict(record);
  if (record.outcome === 'partial') counts.partial += 1;
  switch (verdict) {
    case 'TRUE_POSITIVE': {
      counts.truePositive += 1;
      break;
    }
    case 'FALSE_POSITIVE': {
      counts.falsePositive += 1;
      break;
    }
    case 'TRUE_NEGATIVE': {
      counts.trueNegative += 1;
      break;
    }
    case 'FALSE_NEGATIVE': {
      counts.falseNegative += 1;
      break;
    }
    case 'INCONCLUSIVE':
    case null: {
      counts.inconclusive += 1;
      break;
    }
  }
}

function divideOrNaN(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

function f1FromPrecisionRecall(precision: number, recall: number): number {
  if (!Number.isFinite(precision) || !Number.isFinite(recall)) return Number.NaN;
  if (precision + recall === 0) return Number.NaN;
  return (2 * precision * recall) / (precision + recall);
}

function brierFor(records: readonly EvaluationRecord[]): number {
  let total = 0;
  let n = 0;
  for (const r of records) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    const verdict = resolveVerdict(r);
    if (verdict === null) continue;
    const actual =
      verdict === 'TRUE_POSITIVE' || verdict === 'FALSE_NEGATIVE' ? 1 : 0;
    total += (r.score - actual) ** 2;
    n += 1;
  }
  return n === 0 ? Number.NaN : total / n;
}

interface RocPoint {
  score: number;
  label: 0 | 1;
}

function rocPointsFor(records: readonly EvaluationRecord[]): RocPoint[] {
  const points: RocPoint[] = [];
  for (const r of records) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    const verdict = resolveVerdict(r);
    if (verdict === null || verdict === 'INCONCLUSIVE') continue;
    const label = verdict === 'TRUE_POSITIVE' || verdict === 'FALSE_NEGATIVE' ? 1 : 0;
    points.push({ score: r.score, label });
  }
  return points;
}

function rankSumOfPositives(sorted: readonly RocPoint[]): number {
  let i = 0;
  let sum = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length - 1 && sorted[j + 1]!.score === sorted[i]!.score) {
      j += 1;
    }
    const avgRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) {
      if (sorted[k]!.label === 1) sum += avgRank;
    }
    i = j + 1;
  }
  return sum;
}

function aucRocFor(records: readonly EvaluationRecord[]): number {
  const points = rocPointsFor(records);
  if (points.length < 2) return Number.NaN;
  const positives = points.filter((p) => p.label === 1).length;
  const negatives = points.length - positives;
  if (positives === 0 || negatives === 0) return Number.NaN;
  const sorted = [...points].sort((a, b) => a.score - b.score);
  const u = rankSumOfPositives(sorted) - (positives * (positives + 1)) / 2;
  return u / (positives * negatives);
}

function scalarsFromCounts(
  counts: MetricsCounts,
  records: readonly EvaluationRecord[],
): MetricsScalars {
  const tp = counts.truePositive;
  const fp = counts.falsePositive;
  const tn = counts.trueNegative;
  const fn = counts.falseNegative;
  const precision = divideOrNaN(tp, tp + fp);
  const recall = divideOrNaN(tp, tp + fn);
  const f1 = f1FromPrecisionRecall(precision, recall);
  const decided = tp + fp + tn + fn;
  const accuracy = divideOrNaN(tp + tn, decided);
  return {
    precision,
    recall,
    f1,
    accuracy,
    aucRoc: aucRocFor(records),
    brier: brierFor(records),
  };
}

function compute(records: readonly EvaluationRecord[]): MetricsScalars & MetricsCounts {
  const counts = freshCounts();
  for (const r of records) tallyRecord(counts, r);
  return { ...counts, ...scalarsFromCounts(counts, records) };
}

// Calibration bins

export function calibrationBins(
  records: readonly EvaluationRecord[],
  binCount = 10,
): CalibrationBin[] {
  const bins: { sum: number; hits: number; count: number; start: number; end: number }[] = [];
  for (let i = 0; i < binCount; i += 1) {
    const start = i / binCount;
    const end = i === binCount - 1 ? 1 + Number.EPSILON : (i + 1) / binCount;
    bins.push({ sum: 0, hits: 0, count: 0, start, end });
  }
  for (const r of records) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    const verdict = resolveVerdict(r);
    if (verdict === null || verdict === 'INCONCLUSIVE') continue;
    let idx = Math.floor(r.score * binCount);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    const bin = bins[idx]!;
    bin.sum += r.score;
    bin.count += 1;
    if (verdict === 'TRUE_POSITIVE' || verdict === 'FALSE_NEGATIVE') {
      bin.hits += 1;
    }
  }
  return bins.map((b) => ({
    binStart: b.start,
    binEnd: Math.min(b.end, 1),
    count: b.count,
    meanPredicted: b.count === 0 ? Number.NaN : b.sum / b.count,
    observedHitRate: b.count === 0 ? Number.NaN : b.hits / b.count,
  }));
}

// Window slicing

const WINDOW_DURATIONS_MS: Record<Exclude<MetricsWindow, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function sliceByWindow(
  records: readonly EvaluationRecord[],
  window: MetricsWindow,
  nowMs: number,
): EvaluationRecord[] {
  if (window === 'all') return [...records];
  const cutoff = nowMs - WINDOW_DURATIONS_MS[window];
  return records.filter((r) => r.at >= cutoff);
}

// Public report builder

export interface ReportInput {
  algorithmId: string;
  records: readonly EvaluationRecord[];
  now?: () => number;
}

export function buildAlgorithmMetricsReport(input: ReportInput): AlgorithmMetricsReport {
  const records = input.records.filter(
    (r) => r.algorithmId === input.algorithmId && r.outcome !== undefined,
  );
  const now = input.now ?? Date.now;
  const t = now();
  const overall = compute(records);
  const domain = records[0]?.domain ?? null;

  const byTier: MetricsByTier = {
    low: compute(records.filter((r) => severityTierForScore(r.score) === 'low')),
    medium: compute(records.filter((r) => severityTierForScore(r.score) === 'medium')),
    high: compute(records.filter((r) => severityTierForScore(r.score) === 'high')),
    critical: compute(
      records.filter((r) => severityTierForScore(r.score) === 'critical'),
    ),
  };

  const byWindow: MetricsByWindow = {
    '7d': compute(sliceByWindow(records, '7d', t)),
    '30d': compute(sliceByWindow(records, '30d', t)),
    '90d': compute(sliceByWindow(records, '90d', t)),
  };

  return {
    algorithmId: input.algorithmId,
    domain,
    generatedAt: t,
    overall,
    byTier,
    byWindow,
    calibration: calibrationBins(records),
  };
}

// Multi-algorithm summary used by the diagnostics panel

export interface AlgorithmSummary {
  algorithmId: string;
  total: number;
  precision: number;
  recall: number;
  f1: number;
  brier: number;
}

export function summarizeAllAlgorithms(
  records: readonly EvaluationRecord[],
): AlgorithmSummary[] {
  const byAlgo = new Map<string, EvaluationRecord[]>();
  for (const r of records) {
    if (r.outcome === undefined) continue;
    const list = byAlgo.get(r.algorithmId) ?? [];
    list.push(r);
    byAlgo.set(r.algorithmId, list);
  }
  const summaries: AlgorithmSummary[] = [];
  for (const [algorithmId, list] of byAlgo) {
    const m = compute(list);
    summaries.push({
      algorithmId,
      total: m.total,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1,
      brier: m.brier,
    });
  }
  summaries.sort((a, b) => a.algorithmId.localeCompare(b.algorithmId));
  return summaries;
}
