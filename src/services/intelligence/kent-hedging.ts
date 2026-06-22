/**
 * Calibrated linguistic hedging — the durable, model-agnostic kernel of Wave 6
 * ("reasoning layer") from CRYSTAL_BALL_OVERHAUL_ROADMAP.md. The spec's own
 * caveat: the local-model picks churn, but the *Kent discipline* is stable —
 * probability maps to language through a fixed, enforced scale, not the model's
 * mood.
 *
 * This module is pure mechanism, no LLM: map a calibrated probability to a
 * Sherman Kent / NIC word of estimative probability, enforce that any prose
 * hedge matches the underlying band, and double-hedge ("likely, though our
 * estimates for this type have been unreliable recently") when the Wave 4
 * calibration says the probability itself is not to be trusted.
 *
 * It deliberately consumes the calibration layer: language reflects both the
 * probability AND the confidence in the probability.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import type { CalibrationVerdict } from './calibration-report';

// ── Estimative-probability scale (Sherman Kent / NIC lineage) ────────────────

export type EstimativeTerm =
  | 'remote'
  | 'very unlikely'
  | 'unlikely'
  | 'roughly even chance'
  | 'likely'
  | 'very likely'
  | 'almost certain';

interface Band {
  term: EstimativeTerm;
  /** Inclusive lower bound, exclusive upper (the top band includes 1). */
  lo: number;
  hi: number;
}

/** Contiguous bands covering [0, 1]. Ordered low → high. */
const BANDS: readonly Band[] = [
  { term: 'remote', lo: 0, hi: 0.05 },
  { term: 'very unlikely', lo: 0.05, hi: 0.2 },
  { term: 'unlikely', lo: 0.2, hi: 0.45 },
  { term: 'roughly even chance', lo: 0.45, hi: 0.55 },
  { term: 'likely', lo: 0.55, hi: 0.8 },
  { term: 'very likely', lo: 0.8, hi: 0.95 },
  { term: 'almost certain', lo: 0.95, hi: 1.01 },
];

/** The estimative-probability term for a calibrated probability (0..1). */
export function estimativeTerm(probability: number): EstimativeTerm {
  const p = clamp01(probability);
  const band = BANDS.find((b) => p >= b.lo && p < b.hi);
  return band ? band.term : 'almost certain';
}

/** The probability band [lo, hi) a term denotes. */
export function bandFor(term: EstimativeTerm): { lo: number; hi: number } {
  const band = BANDS.find((b) => b.term === term);
  return band ? { lo: band.lo, hi: Math.min(1, band.hi) } : { lo: 0, hi: 1 };
}

// ── Hedged phrasing (with the calibration meta-hedge) ────────────────────────

export interface HedgeOptions {
  /** When true, append the meta-hedge: the probability type is poorly
   *  calibrated, so even the term is suspect. Derive it from a Wave 4
   *  `CalibrationVerdict` via `isPoorlyCalibrated`. */
  poorlyCalibrated?: boolean;
  /** Capitalize the first letter of the returned phrase. Default false. */
  capitalize?: boolean;
}

const META_HEDGE = 'though our estimates for this event type have been unreliable recently';

/**
 * A calibration-faithful hedge phrase for a probability. Single-layer normally;
 * double-layered ("likely, though …") when the type is poorly calibrated, so
 * the language reflects both the probability and the confidence in it.
 */
export function hedgePhrase(probability: number, options: HedgeOptions = {}): string {
  const term = estimativeTerm(probability);
  const base = options.poorlyCalibrated ? `${term}, ${META_HEDGE}` : term;
  return options.capitalize ? capitalizeFirst(base) : base;
}

/** Map a Wave 4 calibration verdict to "should I meta-hedge?". Overconfident
 *  and underconfident both mean the bare probability is not to be trusted;
 *  well-calibrated and insufficient-data do not trigger the meta-hedge (the
 *  latter is surfaced elsewhere as "not enough data"). */
export function isPoorlyCalibrated(verdict: CalibrationVerdict): boolean {
  return verdict === 'overconfident' || verdict === 'underconfident';
}

// ── Hedge verification gate (mechanical, post-process) ───────────────────────

export interface HedgeVerification {
  /** True when the term found in the text matches the probability's band. */
  ok: boolean;
  /** The term the probability actually warrants. */
  expected: EstimativeTerm;
  /** The estimative term detected in the text, if any. */
  found?: EstimativeTerm;
  /** How far off, in band steps (0 = exact, 1 = adjacent, …). undefined when
   *  no estimative term was found. */
  bandDistance?: number;
  reason: string;
}

// Longest-first so "very likely"/"very unlikely" match before "likely"/"unlikely".
const TERMS_BY_LENGTH: readonly EstimativeTerm[] = [...BANDS]
  .map((b) => b.term)
  .sort((a, b) => b.length - a.length);

/**
 * Mechanically check that the estimative term used in `text` matches the band
 * the calibrated `probability` warrants. This is the deterministic backstop the
 * Wave 6 spec insists on — not an LLM judging an LLM. `maxBandDistance`
 * (default 0) sets how many adjacent bands of slack to tolerate before failing.
 */
export function verifyHedge(
  text: string,
  probability: number,
  maxBandDistance = 0,
): HedgeVerification {
  const expected = estimativeTerm(probability);
  const lower = text.toLowerCase();
  const found = TERMS_BY_LENGTH.find((t) => lower.includes(t));

  if (found === undefined) {
    return {
      ok: false,
      expected,
      reason: `No estimative-probability term found; expected "${expected}" for p=${round2(probability)}.`,
    };
  }

  const distance = Math.abs(indexOfTerm(found) - indexOfTerm(expected));
  const ok = distance <= maxBandDistance;
  return {
    ok,
    expected,
    found,
    bandDistance: distance,
    reason: ok
      ? `"${found}" matches the band for p=${round2(probability)}.`
      : `Hedge "${found}" overstates/understates p=${round2(probability)} (expected "${expected}", ${distance} band(s) off).`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function indexOfTerm(term: EstimativeTerm): number {
  return BANDS.findIndex((b) => b.term === term);
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
