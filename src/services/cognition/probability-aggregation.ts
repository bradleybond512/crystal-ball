/**
 * Probability Aggregation — the mathematical heart of the superforecaster pipeline.
 *
 * WHY GEOMETRIC MEAN OF ODDS (not mean of probabilities)?
 *
 * When combining multiple independent probability estimates, the arithmetic mean
 * of probabilities can yield counter-intuitive results: averaging 0.9 and 0.1
 * gives 0.5, implying no information, but in log-odds space these estimates are
 * equally strong but opposite. The geometric mean of odds (GMO) operates in
 * log-odds space, treating "X is 90% likely" and "X is 10% likely" symmetrically
 * and producing a result that respects the directionality of evidence.
 *
 * GMO formula:
 *   odds_i = p_i / (1 - p_i)
 *   combined_odds = (Π odds_i)^(1/n)  [geometric mean in odds space]
 *   combined_p = combined_odds / (1 + combined_odds)
 *
 * This is equivalent to the arithmetic mean of log-odds (logit scores), and is
 * the standard aggregation method used in the Good Judgment Project superforecaster
 * research (Satopää et al. 2014, "Combining Multiple Probability Predictions Using
 * a Simple Logit Model").
 *
 * EXTREMIZATION (k=1.3):
 *
 * Individual forecasters tend to hedge toward 50% (epistemic cowardice). The
 * superforecasting literature recommends "extremizing" the aggregate by sharpening
 * the combined probability toward 0 or 1.
 *
 * Formula: p' = p^k / (p^k + (1-p)^k)    with k = 1.3 (default)
 *
 * This is the Satopää et al. (2014) extremization function. k=1 is the identity.
 * k>1 sharpens; k<1 moderates. k=1.3 is the empirically validated default from
 * the Good Judgment Project for 3–5 independent forecasters.
 *
 * Skip conditions (extremize returns p unchanged):
 *   - spread > 0.25: high disagreement → don't sharpen a contested estimate
 *   - fewer than 3 estimates: insufficient crowd to justify sharpening
 *
 * Design invariants (house plan):
 *   - Pure deterministic math: no DOM, no fetch, no globals at import time.
 *   - Every output carries an explanation string (never a bare number).
 *   - Spread is surfaced, not averaged away (contradiction invariant).
 *   - Output clamped to [0.02, 0.98]: the app never claims certainty.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 3.
 *
 * PR 12 (self-tuning): the extremization exponent and the spread-skip
 * threshold are declared tunables ('superforecast:extremizeK' bounds
 * [1.0, 1.8]; 'superforecast:spreadSkipThreshold' bounds [0.15, 0.40]).
 * The exported constants below remain the get-with-default fallbacks, so
 * an empty tunable store reproduces the pre-PR-12 behavior exactly.
 */

import { getTunedParam } from '@/services/algorithms/tunable-params-store';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default extremization sharpening parameter (Good Judgment Project empirical). */
export const DEFAULT_K = 1.3;

/** Skip extremization when spread exceeds this threshold. */
export const SPREAD_SKIP_THRESHOLD = 0.25;

/** Tuned extremization exponent (PR 12), falling back to DEFAULT_K. */
function tunedK(): number {
  return getTunedParam('superforecast', 'extremizeK', DEFAULT_K);
}

/** Tuned spread-skip threshold (PR 12), falling back to SPREAD_SKIP_THRESHOLD. */
function tunedSpreadSkip(): number {
  return getTunedParam('superforecast', 'spreadSkipThreshold', SPREAD_SKIP_THRESHOLD);
}

/** Minimum number of estimates required for extremization to apply. */
export const MIN_ESTIMATES_FOR_EXTREMIZE = 3;

/** Output probability lower bound. */
export const CLAMP_LO = 0.02;

/** Output probability upper bound. */
export const CLAMP_HI = 0.98;

// ── Types ──────────────────────────────────────────────────────────────────────

/** The source/role of a probability estimate in the superforecasting pipeline. */
export type EstimateSource =
  | 'base-rate'
  | 'decomposition'
  | 'persona-analyst'
  | 'persona-skeptic'
  | 'persona-pragmatist'
  | 'model-forecast';

/** A single probability estimate with source and weight provenance. */
export interface Estimate {
  source: EstimateSource;
  /** Probability in [0, 1]. */
  p: number;
  /**
   * Relative weight for the geometric mean of odds computation.
   * Higher weight = more influence. Default 1.0 for all estimates unless
   * there is a principled reason to differ.
   */
  weight: number;
}

/** The aggregated result combining all estimates. */
export interface AggregationResult {
  /** Final probability, clamped to [CLAMP_LO, CLAMP_HI]. */
  p: number;
  /** max(p_i) − min(p_i) across all inputs. Surfaced per contradiction invariant. */
  spread: number;
  /** Human-readable explanation of the aggregation (plan invariant). */
  explanation: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

/** Convert probability to odds. Clamped away from 0/1 to avoid division by zero. */
function toOdds(p: number): number {
  const pc = clamp(p, 0.001, 0.999);
  return pc / (1 - pc);
}

/** Convert odds to probability. */
function fromOdds(odds: number): number {
  if (odds <= 0) return CLAMP_LO;
  return odds / (1 + odds);
}

// ── geoMeanOfOdds ─────────────────────────────────────────────────────────────

/**
 * Compute the weighted geometric mean of odds.
 *
 * For estimates [e1, e2, ..., en] with weights [w1, w2, ..., wn]:
 *   combined_odds = exp( Σ(w_i × log(odds_i)) / Σ w_i )
 *   combined_p = combined_odds / (1 + combined_odds)
 *
 * This is equivalent to a log-odds arithmetic mean, weighted by each estimate's
 * declared weight. Log-odds is the natural scale for probability combination
 * (symmetric around 50%, unbounded, additive for independent evidence).
 *
 * Clamps the result to [CLAMP_LO, CLAMP_HI].
 *
 * @throws TypeError if estimates is empty (caller should guard).
 */
export function geoMeanOfOdds(estimates: readonly Estimate[]): number {
  if (estimates.length === 0) {
    throw new TypeError('geoMeanOfOdds: estimates array must not be empty');
  }

  let weightedLogOddsSum = 0;
  let totalWeight = 0;

  for (const est of estimates) {
    const pc = clamp(est.p, CLAMP_LO, CLAMP_HI);
    const logOdds = Math.log(toOdds(pc));
    const w = Math.max(0, est.weight); // negative weights are undefined behavior
    weightedLogOddsSum += logOdds * w;
    totalWeight += w;
  }

  if (totalWeight === 0) {
    // All weights zero — equal-weight fallback.
    weightedLogOddsSum = estimates.reduce((s, e) => s + Math.log(toOdds(clamp(e.p, CLAMP_LO, CLAMP_HI))), 0);
    totalWeight = estimates.length;
  }

  const combinedLogOdds = weightedLogOddsSum / totalWeight;
  const combinedOdds = Math.exp(combinedLogOdds);
  return clamp(fromOdds(combinedOdds), CLAMP_LO, CLAMP_HI);
}

// ── extremize ─────────────────────────────────────────────────────────────────

/**
 * Sharpen a probability away from 50% using the Satopää et al. (2014)
 * extremization function.
 *
 * Formula: p' = p^k / (p^k + (1-p)^k)
 *
 * k = 1 → identity (no sharpening)
 * k > 1 → sharpens (moves probability toward 0 or 1)
 * k < 1 → moderates (moves probability toward 0.5)
 *
 * Skip conditions: returns p unchanged when:
 *   - estimates.length < MIN_ESTIMATES_FOR_EXTREMIZE (3): too few forecasters
 *   - spread > spreadSkipThreshold (tuned; default 0.25): high disagreement —
 *     don't sharpen
 *
 * @param p          The probability to extremize (should be pre-aggregated GMO).
 * @param k          Sharpening exponent. Omitted → the PR 12 tunable
 *                   'superforecast:extremizeK' (default 1.3).
 * @param spread     max − min across all estimates (for skip condition).
 * @param nEstimates Number of estimates that produced p (for skip condition).
 * @param spreadSkipThreshold Skip bar for the spread condition. Omitted → the
 *                   PR 12 tunable 'superforecast:spreadSkipThreshold' (0.25).
 */
export function extremize(
  p: number,
  k?: number,
  spread = 0,
  nEstimates = 999,
  spreadSkipThreshold?: number,
): number {
  const kEff = k ?? tunedK();
  const skipAt = spreadSkipThreshold ?? tunedSpreadSkip();
  const pc = clamp(p, CLAMP_LO, CLAMP_HI);

  // Skip conditions.
  if (nEstimates < MIN_ESTIMATES_FOR_EXTREMIZE) return pc;
  if (spread > skipAt) return pc;

  const pk = Math.pow(pc, kEff);
  const qk = Math.pow(1 - pc, kEff);
  const extremized = pk / (pk + qk);
  return clamp(extremized, CLAMP_LO, CLAMP_HI);
}

// ── aggregate ─────────────────────────────────────────────────────────────────

/**
 * Aggregate multiple probability estimates into a single calibrated probability.
 *
 * Pipeline:
 *   1. Validate inputs (require ≥ 1 estimate, clamp p values).
 *   2. Compute spread = max(p_i) − min(p_i) — surfaced per contradiction invariant.
 *   3. Compute weighted geometric mean of odds (log-odds arithmetic mean).
 *   4. Extremize (sharpen) the GMO result, skipped if spread > 0.25 or < 3 estimates.
 *   5. Clamp to [CLAMP_LO, CLAMP_HI].
 *   6. Build an explanation chain (plan invariant: every score has an explanation).
 *
 * The spread is included in the result so callers can surface it in the UI —
 * high spread signals genuine disagreement that the UI should highlight, not hide.
 */
export function aggregate(estimates: readonly Estimate[]): AggregationResult {
  if (estimates.length === 0) {
    // Degenerate case: no estimates → return the baseline prior with explanation.
    return {
      p: 0.3,
      spread: 0,
      explanation: 'no estimates available — defaulting to 30% uninformative prior',
    };
  }

  // Clamp all p values before doing math.
  const safeEstimates = estimates.map(e => ({
    ...e,
    p: clamp(e.p, CLAMP_LO, CLAMP_HI),
  }));

  // Spread: surfaced, not averaged away (contradiction invariant).
  const pValues = safeEstimates.map(e => e.p);
  const maxP = Math.max(...pValues);
  const minP = Math.min(...pValues);
  const spread = round3(maxP - minP);

  // Step 1: Geometric mean of odds.
  const gmo = geoMeanOfOdds(safeEstimates);

  // Step 2: Extremize (may be a no-op depending on spread/n conditions).
  // k and the spread-skip threshold are PR 12 tunables (defaults 1.3 / 0.25).
  const kEff = tunedK();
  const spreadSkip = tunedSpreadSkip();
  const extremized = extremize(gmo, kEff, spread, safeEstimates.length, spreadSkip);
  const wasExtremized = Math.abs(extremized - gmo) > 0.001;

  // Step 3: Clamp.
  const finalP = clamp(extremized, CLAMP_LO, CLAMP_HI);

  // Build explanation.
  const sourceList = safeEstimates
    .map(e => `${e.source}=${pct(e.p)} (w=${round2(e.weight)})`)
    .join(', ');

  let extremizeNote: string;
  if (safeEstimates.length < MIN_ESTIMATES_FOR_EXTREMIZE) {
    extremizeNote = `extremization skipped (only ${safeEstimates.length} estimate(s) — need ≥${MIN_ESTIMATES_FOR_EXTREMIZE})`;
  } else if (spread > spreadSkip) {
    extremizeNote = `extremization skipped (spread=${pct(spread)} > ${pct(spreadSkip)} threshold — high disagreement)`;
  } else if (wasExtremized) {
    extremizeNote = `extremized ${pct(gmo)} → ${pct(extremized)} (k=${kEff})`;
  } else {
    extremizeNote = `extremized ${pct(gmo)} (no movement, already near center)`;
  }

  let disagreementNote: string;
  if (spread > spreadSkip) {
    disagreementNote = `⚠ high spread (${pct(spread)}) — estimates disagree significantly`;
  } else if (spread > 0.15) {
    disagreementNote = `moderate spread (${pct(spread)})`;
  } else {
    disagreementNote = `low spread (${pct(spread)})`;
  }

  const explanation =
    `aggregated ${safeEstimates.length} estimate(s) [${sourceList}]; ` +
    `geo-mean-of-odds: ${pct(gmo)}; ${extremizeNote}; ` +
    `${disagreementNote}; final: ${pct(finalP)}`;

  return { p: finalP, spread, explanation };
}
