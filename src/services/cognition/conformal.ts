/**
 * Conformal Prediction Intervals — split-conformal over resolved PredictionRecords.
 *
 * Every forecast Crystal Ball emits is a point probability. This module wraps
 * that point with a distribution-free interval whose coverage guarantee is
 * mathematically provable regardless of how well or badly the underlying model
 * is specified — the only property an intelligence app should advertise.
 *
 * Algorithm (split-conformal):
 *   1. Collect resolved records (resolved_true → outcome 1, resolved_false → 0;
 *      pending/expired are ignored — they have no ground truth).
 *   2. For each resolved record, compute the nonconformity score:
 *        s_i = |outcome_i − predicted_p_i|
 *   3. For a new forecast p with confidence 1−α, the conformal interval is:
 *        [p − q, p + q]   clamped to [0, 1]
 *      where q is the (1−α) empirical quantile of the nonconformity scores,
 *      using the standard conservative finite-sample quantile rank:
 *        rank = ceil((n + 1)(1 − α)) / n
 *      This rank exceeds 1 when n is small (too few samples), in which case
 *      q = 1 and the interval is trivially [0, 1].
 *
 * Pool selection:
 *   - Per-domain when n_domain ≥ MIN_DOMAIN_N (40) resolved records.
 *   - Global pool when n_global ≥ MIN_GLOBAL_N (40) resolved records.
 *   - Uninformative fallback otherwise.
 *
 * Design invariants (house plan):
 *   - Every output carries an explanation string — never a bare number.
 *   - All logic is pure deterministic (no DOM, no fetch, no globals at import).
 *   - Every output is testable with static fixtures.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 7.
 */

import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import type { FactDomain } from '@/services/intelligence/types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum resolved records for a per-domain pool (else try global). */
export const MIN_DOMAIN_N = 40;

/** Minimum resolved records for a global pool (else uninformative interval). */
export const MIN_GLOBAL_N = 40;

/** Default significance level — 80% prediction interval. */
export const DEFAULT_ALPHA = 0.2;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A conformal prediction interval around a point forecast p.
 *
 * The interval [lo, hi] contains the realized outcome with probability ≥ 1−α
 * over the calibration set — a guaranteed coverage property, not an assumption.
 */
export interface ForecastInterval {
  /** The point forecast this interval is centered on. */
  p: number;
  /** Lower bound, clamped to [0, 1]. */
  lo: number;
  /** Upper bound, clamped to [0, 1]. */
  hi: number;
  /** Significance level — 1−alpha is the coverage guarantee (e.g. 0.2 → 80%). */
  alpha: number;
  /** Number of resolved calibration records used to compute the interval. */
  n: number;
  /**
   * Human-readable explanation.
   * Plan invariant: always non-empty; always states which pool was used and n.
   */
  explanation: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Filter to only resolved records (outcome is known). */
function resolvedOnly(records: readonly PredictionRecord[]): PredictionRecord[] {
  return records.filter(
    r => r.status === 'resolved_true' || r.status === 'resolved_false',
  );
}

/**
 * Compute nonconformity scores for a set of resolved records.
 * s_i = |outcome_i − predicted_p_i|
 */
function nonconformityScores(records: readonly PredictionRecord[]): number[] {
  return records.map(r => {
    const outcome = r.status === 'resolved_true' ? 1 : 0;
    return Math.abs(outcome - r.probability);
  });
}

/**
 * Compute the conformal quantile q for significance level alpha over a set
 * of nonconformity scores.
 *
 * Conservative finite-sample formula (Vovk et al. 2005):
 *   rank = ceil((n + 1)(1 − α)) / n
 *
 * If rank > 1 (too few samples), the quantile is 1.0 (uninformative width).
 * Scores are sorted ascending; the rank-th quantile indexes into the sorted list.
 */
function conformalQuantile(scores: number[], alpha: number): number {
  const n = scores.length;
  if (n === 0) return 1;

  // Conservative finite-sample rank (may exceed n → clamp to 1.0).
  const rank = Math.ceil((n + 1) * (1 - alpha)) / n;
  if (rank > 1) return 1;

  // Sort ascending and pick the rank-th quantile (1-indexed).
  const sorted = [...scores].sort((a, b) => a - b);
  // Convert rank (fraction of n) to 0-based index.
  const idx = Math.min(n - 1, Math.ceil(rank * n) - 1);
  return sorted[idx] ?? 1;
}

// ── conformalInterval ─────────────────────────────────────────────────────────

/**
 * Compute a split-conformal prediction interval for a point forecast p.
 *
 * @param p        Point forecast in [0, 1].
 * @param domain   Domain of the forecast — used for per-domain pool selection.
 * @param records  All prediction records from the calibration store (may include
 *                 pending/expired — only resolved_true/false are used).
 * @param alpha    Significance level (default 0.2 → 80% interval).
 *                 Must be in (0, 1).
 *
 * Pool selection:
 *   1. Per-domain: n_domain ≥ MIN_DOMAIN_N resolved records.
 *   2. Global:     n_global ≥ MIN_GLOBAL_N resolved records.
 *   3. Uninformative: lo=0, hi=1, explanation states the reason.
 */
export function conformalInterval(
  p: number,
  domain: FactDomain | 'global',
  records: readonly PredictionRecord[],
  alpha: number = DEFAULT_ALPHA,
): ForecastInterval {
  const clampedP = clamp01(p);
  const effectiveAlpha = Math.max(0.01, Math.min(0.99, alpha));
  const coveragePct = Math.round((1 - effectiveAlpha) * 100);

  const allResolved = resolvedOnly(records);

  // ── Per-domain pool attempt ───────────────────────────────────────────────
  if (domain !== 'global') {
    const domainResolved = allResolved.filter(r => r.domain === domain);
    if (domainResolved.length >= MIN_DOMAIN_N) {
      const scores = nonconformityScores(domainResolved);
      const q = conformalQuantile(scores, effectiveAlpha);
      const lo = round3(clamp01(clampedP - q));
      const hi = round3(clamp01(clampedP + q));
      const n = domainResolved.length;
      const explanation =
        `${coveragePct}% conformal interval from ${domain} pool (n=${n} resolved records); ` +
        `nonconformity quantile q=${round3(q)}`;
      return { p: round3(clampedP), lo, hi, alpha: effectiveAlpha, n, explanation };
    }
  }

  // ── Global pool attempt ───────────────────────────────────────────────────
  if (allResolved.length >= MIN_GLOBAL_N) {
    const scores = nonconformityScores(allResolved);
    const q = conformalQuantile(scores, effectiveAlpha);
    const lo = round3(clamp01(clampedP - q));
    const hi = round3(clamp01(clampedP + q));
    const n = allResolved.length;
    const poolNote = domain !== 'global'
      ? `(${domain} domain had fewer than ${MIN_DOMAIN_N} resolved records; using global pool)`
      : '';
    const explanation =
      `${coveragePct}% conformal interval from global pool (n=${n} resolved records)${poolNote ? ' ' + poolNote : ''}; ` +
      `nonconformity quantile q=${round3(q)}`;
    return { p: round3(clampedP), lo: lo, hi: hi, alpha: effectiveAlpha, n, explanation };
  }

  // ── Uninformative fallback ────────────────────────────────────────────────
  const n = allResolved.length;
  const explanation =
    `insufficient history — interval is uninformative ` +
    `(need ${MIN_GLOBAL_N} resolved records globally or ${MIN_DOMAIN_N} for domain '${domain}'; ` +
    `have ${n})`;
  return {
    p: round3(clampedP),
    lo: 0,
    hi: 1,
    alpha: effectiveAlpha,
    n,
    explanation,
  };
}
