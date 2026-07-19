/**
 * Shortage scoring helpers — pure deterministic functions that the
 * commodity models compose into a final ShortageForecast.
 *
 * Per the plan's invariants:
 *   - every score must include drivers + data gaps
 *   - stale or missing data must reduce confidence (not silently drop)
 *   - protective signals subtract from risk; they don't get averaged in
 *
 * The math here is intentionally simple — weighted means, freshness
 * decay, threshold mappings. No ML; the plan explicitly says "Start
 * deterministic. Do not add opaque ML in the first batch."
 */

import type {
  ShortageConfidence,
  ShortageDriver,
  ShortageDriverKind,
  ShortageInput,
  ShortageInputBag,
} from './shortage-types';

// ── Default weights for the six driver buckets ────────────────────────────
//
// Plan example weights (line 154-166): production/inventory dominate,
// price confirmation is a moderate weight, transport/policy/demand fill
// the middle. cross_domain is the catch-all, weighted lower so a single
// overlay doesn't swamp the structured signals.

export const DEFAULT_DRIVER_WEIGHTS: Record<ShortageDriverKind, number> = {
  production: 0.25,
  inventory: 0.2,
  transport: 0.15,
  policy: 0.1,
  demand: 0.1,
  price: 0.15,
  cross_domain: 0.05,
};

// ── Overall score ────────────────────────────────────────────────────────

export interface OverallScoreOptions {
  /** Per-bucket weights override. Missing keys fall through to default. */
  weights?: Partial<Record<ShortageDriverKind, number>>;
  /** Reduces score by this fraction per data gap, capped at 0.4 so even
   *  many gaps can't zero out a strong structural signal. */
  gapPenaltyPerItem?: number;
}

export interface OverallScoreResult {
  /** 0-100 weighted overall risk score. */
  riskScore: number;
  /** Weighted contribution by driver kind, useful for explanation UI. */
  contributionByKind: Record<ShortageDriverKind, number>;
  /** Sum of weights actually used (drops missing buckets). The UI
   *  renders this as the denominator: "65/85 — 20 pts of inputs missing". */
  weightUsed: number;
}

/** Average drivers within each bucket, then weight-average across buckets.
 *  Protective drivers (polarity:'protective') subtract within their bucket.
 *  Buckets with no drivers are dropped from the denominator — that's how
 *  "missing data reduces confidence" propagates. */
export function scoreOverallShortage(
  drivers: readonly ShortageDriver[],
  options: OverallScoreOptions = {},
): OverallScoreResult {
  const weights = { ...DEFAULT_DRIVER_WEIGHTS, ...options.weights };
  const byKind = new Map<ShortageDriverKind, ShortageDriver[]>();
  for (const d of drivers) {
    if (!byKind.has(d.kind)) byKind.set(d.kind, []);
    byKind.get(d.kind)!.push(d);
  }

  const contribution: Record<ShortageDriverKind, number> = {
    production: 0, inventory: 0, transport: 0, policy: 0,
    demand: 0, price: 0, cross_domain: 0,
  };
  let weighted = 0;
  let weightUsed = 0;

  for (const [kind, bucketDrivers] of byKind) {
    const weight = weights[kind] ?? 0;
    if (weight <= 0) continue;
    const bucketScore = averageBucket(bucketDrivers);
    contribution[kind] = bucketScore * weight;
    weighted += contribution[kind];
    weightUsed += weight;
  }

  // Renormalize against weight actually used so partial coverage
  // doesn't artificially shrink the score.
  const normalized = weightUsed > 0 ? weighted / weightUsed : 0;
  return {
    riskScore: clamp(0, 100, Math.round(normalized)),
    contributionByKind: contribution,
    weightUsed,
  };
}

function averageBucket(drivers: readonly ShortageDriver[]): number {
  if (drivers.length === 0) return 0;
  let sum = 0;
  for (const d of drivers) {
    const signed = d.polarity === 'protective' ? -d.score : d.score;
    sum += signed;
  }
  return clamp(0, 100, sum / drivers.length);
}

// ── Confidence ───────────────────────────────────────────────────────────

export interface ConfidenceOptions {
  /** Number of data gaps; each one drops confidence one rung. */
  gapCount: number;
  /** Number of distinct sources backing the drivers. Used to penalize
   *  single-provider conclusions even when their signal is strong. */
  uniqueSourceCount: number;
  /** Worst freshness fraction (0 = stale, 1 = fresh) across critical
   *  inputs. Stale inputs cap confidence at 'medium'. */
  worstFreshness: number;
  /** Sum of weights actually used by scoreOverallShortage. ≤0.5 means
   *  more than half the model is missing — confidence cannot be high. */
  weightUsed: number;
}

export function deriveConfidence(opts: ConfidenceOptions): ShortageConfidence {
  if (opts.weightUsed < 0.5 || opts.gapCount >= 4 || opts.uniqueSourceCount === 0) {
    return 'low';
  }
  if (opts.uniqueSourceCount === 1 || opts.worstFreshness < 0.4 || opts.gapCount >= 2) {
    return 'medium';
  }
  if (opts.weightUsed >= 0.75 && opts.uniqueSourceCount >= 2 && opts.worstFreshness >= 0.6) {
    return 'high';
  }
  return 'medium';
}

// ── Freshness ────────────────────────────────────────────────────────────

/** 1.0 at observation, 0.5 at the model's expected refresh window,
 *  0.0 at ≥2× the window. Mirrors the truth-score freshness curve so
 *  the two layers tell consistent stories. */
export function freshnessFor(
  input: ShortageInput | undefined,
  expectedRefreshMs: number,
  now: number,
): number {
  if (!input) return 0;
  const age = Math.max(0, now - input.observedAt);
  // A NaN observedAt (corrupt timestamp) must not pass as fresh; treat as worst-case.
  if (!Number.isFinite(age)) return 0;
  if (age <= 0) return 1;
  if (age >= 2 * expectedRefreshMs) return 0;
  return clamp(0, 1, 1 - age / (2 * expectedRefreshMs));
}

// ── Driver builders — small helpers so models stay readable ─────────────

export interface BuildDriverArgs {
  kind: ShortageDriverKind;
  /** Raw indicator value, e.g. "rainfall pct of normal", "inventory pct
   *  of 5-year average". */
  value: number;
  /** Function that maps the raw value into a 0-100 risk score. */
  toRisk: (v: number) => number;
  label: string;
  source?: string;
  polarity?: 'risk' | 'protective';
  factId?: string;
}

export function buildDriver(args: BuildDriverArgs): ShortageDriver {
  // A non-finite value (NaN from a failed parse) would propagate through toRisk →
  // Math.round → clamp and corrupt the weighted average. Treat as zero risk
  // instead — and re-check the computed risk too, since toRisk() can itself
  // return non-finite (e.g. a divide-by-bad-data) even for a finite input.
  const risk = Number.isFinite(args.value) ? args.toRisk(args.value) : 0;
  const rawScore = Number.isFinite(risk) ? risk : 0;
  return {
    kind: args.kind,
    score: clamp(0, 100, Math.round(rawScore)),
    label: args.label,
    sources: args.source ? [args.source] : undefined,
    polarity: args.polarity,
    factId: args.factId,
  };
}

// ── Common toRisk mappings the models reuse ─────────────────────────────

/** Linear inverse: lowValue → 100 risk, highValue → 0 risk.
 *  e.g. rainfall % of normal: 50% → high risk, 100% → low risk. */
export function inverseLinear(low: number, high: number): (v: number) => number {
  return (v) => {
    if (v <= low) return 100;
    if (v >= high) return 0;
    return ((high - v) / (high - low)) * 100;
  };
}

/** Linear: lowValue → 0 risk, highValue → 100 risk.
 *  e.g. price increase %: 0% → 0 risk, 30% → 100 risk. */
export function directLinear(low: number, high: number): (v: number) => number {
  return (v) => {
    if (v <= low) return 0;
    if (v >= high) return 100;
    return ((v - low) / (high - low)) * 100;
  };
}

// ── Data gap helper ──────────────────────────────────────────────────────

/** Walks a known-key list against the input bag and returns a list of
 *  human-readable "missing X" strings for any absent keys. Models pass
 *  this directly into ShortageForecast.dataGaps. */
export function detectGaps(
  inputs: ShortageInputBag,
  required: readonly { key: string; label: string; staleAfterMs?: number }[],
  now: number,
): string[] {
  const gaps: string[] = [];
  for (const { key, label, staleAfterMs } of required) {
    const v = inputs[key];
    if (!v) {
      gaps.push(`Missing ${label}`);
      continue;
    }
    if (staleAfterMs !== undefined && now - v.observedAt > staleAfterMs) {
      gaps.push(`Stale ${label} (last update ${formatAge(now - v.observedAt)})`);
    }
  }
  return gaps;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h ago`;
  const minutes = Math.floor(ms / (60 * 1000));
  return `${minutes}m ago`;
}

/** Count distinct source ids across drivers (used by deriveConfidence). */
export function uniqueSourceCount(drivers: readonly ShortageDriver[]): number {
  const set = new Set<string>();
  for (const d of drivers) {
    for (const s of d.sources ?? []) set.add(s);
  }
  return set.size;
}
