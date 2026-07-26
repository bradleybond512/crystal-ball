/**
 * Forecast calibration service — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 6 (lines 575-590).
 *
 * Records predictions, resolves them when ground-truth becomes
 * available, and produces:
 *   - prediction records (id, claim, probability, horizon, status)
 *   - automatic resolution
 *   - Brier score (calibration metric)
 *   - per-domain accuracy
 *   - per-source multipliers (priors that downstream scorers can apply)
 *   - algorithm version tracking
 *
 * Pure deterministic. No DOM, no fetch.
 *
 * Plan invariant: "Every forecast must be logged and later evaluated."
 * This module is the log + evaluator. Wiring the existing
 * forecast-accuracy / forecast services into it is a small follow-up.
 */

import type { FactDomain } from './types';

// ── Public types ─────────────────────────────────────────────────────────

export type PredictionStatus = 'pending' | 'resolved_true' | 'resolved_false' | 'expired';

export interface PredictionRecord {
  id: string;
  /** Source / model that made the prediction. */
  sourceId: string;
  /** Stable objective outcome key shared by independent models forecasting
   *  the same event. Lets one observed outcome grade every comparable model. */
  targetKey?: string;
  /** Domain the claim sits in. */
  domain: FactDomain;
  /** Free-text claim ("S&P -2σ drawdown within 24h", "Wheat shortage
   *  risk in East Africa rising to Elevated"). */
  claim: string;
  /** Probability the claim is true, in 0-1. */
  probability: number;
  /** ms timestamp when the prediction was made. */
  predictedAt: number;
  /** ms timestamp when the prediction's window closes. After this,
   *  unresolved predictions are auto-marked 'expired'. */
  resolveBy: number;
  /** Status — pending until resolution. */
  status: PredictionStatus;
  /** ms timestamp the prediction was resolved (or expired). */
  resolvedAt?: number;
  /** Free-form algorithm version string ("truth-score-v1",
   *  "wheat-model-v2"). Tracked so a re-tuning campaign can be
   *  evaluated against its own predictions, not the prior version's. */
  algorithmVersion?: string;
}

// ── Brier score ──────────────────────────────────────────────────────────

/** Standard quadratic Brier score: mean((p - outcome)^2) over resolved
 *  predictions. 0 = perfect, 0.25 = uniformly random binary, 1 = always
 *  wrong with full confidence. */
export interface BrierScoreResult {
  score: number;
  resolvedCount: number;
  /** Predictions that contributed: status is resolved_true/false. */
  evaluated: number;
}

export function brierScore(records: readonly PredictionRecord[]): BrierScoreResult {
  let sum = 0;
  let n = 0;
  for (const r of records) {
    if (r.status === 'resolved_true' || r.status === 'resolved_false') {
      const outcome = r.status === 'resolved_true' ? 1 : 0;
      sum += (r.probability - outcome) ** 2;
      n += 1;
    }
  }
  if (n === 0) return { score: 0, resolvedCount: 0, evaluated: 0 };
  return { score: round3(sum / n), resolvedCount: n, evaluated: n };
}

// ── Per-domain accuracy ─────────────────────────────────────────────────

export interface DomainAccuracy {
  domain: FactDomain;
  predictionCount: number;
  /** Mean Brier score for predictions in this domain. */
  brier: number;
  /** "Hit rate": fraction of resolved_true among resolved. */
  hitRate: number;
  /** Calibration error: |mean(probability) - hitRate| over resolved
   *  predictions. Smaller is better. */
  calibrationError: number;
}

export function perDomainAccuracy(records: readonly PredictionRecord[]): DomainAccuracy[] {
  const groups = groupBy(records, (r) => r.domain);
  const out: DomainAccuracy[] = [];
  for (const [domain, items] of groups) {
    out.push(buildDomainAccuracy(domain, items));
  }
  out.sort((a, b) => b.predictionCount - a.predictionCount);
  return out;
}

function buildDomainAccuracy(domain: FactDomain, items: readonly PredictionRecord[]): DomainAccuracy {
  const resolved = items.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false');
  if (resolved.length === 0) {
    return { domain, predictionCount: items.length, brier: 0, hitRate: 0, calibrationError: 0 };
  }
  const trues = resolved.filter((r) => r.status === 'resolved_true');
  const hitRate = trues.length / resolved.length;
  const meanProb = resolved.reduce((s, r) => s + r.probability, 0) / resolved.length;
  const brier = brierScore(resolved).score;
  return {
    domain,
    predictionCount: items.length,
    brier,
    hitRate: round3(hitRate),
    calibrationError: round3(Math.abs(meanProb - hitRate)),
  };
}

// ── Per-source multipliers ───────────────────────────────────────────────
//
// A "multiplier" is a 0..2 number that downstream scorers can apply to
// trust ("trust THIS source's predictions 1.2× as much"). It's derived
// from Brier score: low Brier → multiplier > 1; high Brier → multiplier
// < 1. Anchored so a "fair coin" Brier of 0.25 maps to 1.0.

export interface SourceMultiplier {
  sourceId: string;
  predictionCount: number;
  resolvedCount: number;
  brier: number;
  /** Multiplier in 0.5..1.5 range. 1.0 = matches the fair-coin baseline. */
  multiplier: number;
}

export function perSourceMultipliers(
  records: readonly PredictionRecord[],
  options: { minResolvedForMultiplier?: number } = {},
): SourceMultiplier[] {
  const minResolved = options.minResolvedForMultiplier ?? 5;
  const groups = groupBy(records, (r) => r.sourceId);
  const out: SourceMultiplier[] = [];
  for (const [sourceId, items] of groups) {
    const resolved = items.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false');
    const brier = brierScore(resolved).score;
    let multiplier = 1;
    if (resolved.length >= minResolved) {
      // Linear map: brier 0 → 1.5, brier 0.25 → 1.0, brier 0.5 → 0.5.
      multiplier = clamp(0.5, 1.5, 1.5 - 2 * brier);
    }
    out.push({
      sourceId,
      predictionCount: items.length,
      resolvedCount: resolved.length,
      brier,
      multiplier: round3(multiplier),
    });
  }
  out.sort((a, b) => b.multiplier - a.multiplier);
  return out;
}

// ── Calibration store ────────────────────────────────────────────────────

export interface ForecastCalibrationStore {
  record: (prediction: PredictionRecord) => void;
  resolve: (id: string, outcome: boolean, when?: number) => boolean;
  /** Auto-mark all pending predictions whose resolveBy < now as expired. */
  expirePending: (now?: number) => number;
  get: (id: string) => PredictionRecord | undefined;
  all: () => PredictionRecord[];
  brier: () => BrierScoreResult;
  byDomain: () => DomainAccuracy[];
  bySource: (options?: { minResolvedForMultiplier?: number }) => SourceMultiplier[];
  toJson: () => PredictionRecord[];
  loadJson: (records: readonly PredictionRecord[]) => void;
}

export function createForecastCalibrationStore(): ForecastCalibrationStore {
  const store = new Map<string, PredictionRecord>();

  function record(prediction: PredictionRecord): void {
    store.set(prediction.id, { ...prediction });
  }

  function resolve(id: string, outcome: boolean, when?: number): boolean {
    const prev = store.get(id);
    if (!prev) return false;
    if (prev.status !== 'pending') return false;
    store.set(id, {
      ...prev,
      status: outcome ? 'resolved_true' : 'resolved_false',
      resolvedAt: when ?? Date.now(),
    });
    return true;
  }

  function expirePending(now?: number): number {
    const t = now ?? Date.now();
    let count = 0;
    for (const [id, r] of store) {
      if (r.status === 'pending' && r.resolveBy < t) {
        store.set(id, { ...r, status: 'expired', resolvedAt: t });
        count += 1;
      }
    }
    return count;
  }

  function get(id: string): PredictionRecord | undefined {
    const r = store.get(id);
    return r ? { ...r } : undefined;
  }

  function all(): PredictionRecord[] {
    return [...store.values()].map((r) => ({ ...r }));
  }

  return {
    record,
    resolve,
    expirePending,
    get,
    all,
    brier() { return brierScore(all()); },
    byDomain() { return perDomainAccuracy(all()); },
    bySource(options) { return perSourceMultipliers(all(), options); },
    toJson() { return all(); },
    loadJson(records) {
      store.clear();
      for (const r of records) store.set(r.id, { ...r });
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
