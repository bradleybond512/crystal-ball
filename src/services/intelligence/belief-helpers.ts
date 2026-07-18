/**
 * BeliefValue propagation helpers — pure functions over the `BeliefValue`
 * probability type (`src/types/belief.ts`).
 *
 * No DOM, no fetch, no module-level globals. The only ambient dependency is
 * the wall clock (via `now` parameters that default to the current time), so
 * every time-sensitive function accepts an explicit ISO `now` for testing.
 *
 * The combining rules are the small Bayesian toolkit the epistemic layer
 * builds on:
 *  - noisy-OR    — independent evidence that each *supports* a hypothesis
 *  - log-odds    — apply a likelihood ratio (the ACH workbench primitive)
 *  - min/max/avg — conservative / optimistic / neutral interval merges
 */
import type { BeliefValue, CombiningRule, ProbabilityLabel } from '../../types/belief.ts';

const DEFAULT_HALF_WIDTH = 0.1;
/** Legacy 0-10 severity scores carry no explicit interval; assume a wider
 *  band than a first-class belief to reflect the lost information. */
const LEGACY_HALF_WIDTH = 0.15;
/** How long after `staleAt` a belief ramps from fresh (0) to fully stale (1). */
const STALENESS_RAMP_MS = 60 * 60 * 1000;
/** Keep probabilities off the 0/1 asymptotes before taking log-odds. */
const LOGIT_EPS = 1e-9;

// ── Construction ───────────────────────────────────────────────────────────

export function createBelief(
  point: number,
  opts: {
    lower?: number;
    upper?: number;
    provenance?: string[];
    assumptionIds?: string[];
    staleAt?: string;
  } = {},
): BeliefValue {
  const p = clamp01(point);
  const lower = clamp01(opts.lower ?? p - DEFAULT_HALF_WIDTH);
  const upper = clamp01(opts.upper ?? p + DEFAULT_HALF_WIDTH);
  return {
    point: p,
    lower: Math.min(lower, upper),
    upper: Math.max(lower, upper),
    stalenessFactor: 0,
    provenance: opts.provenance ? [...opts.provenance] : [],
    assumptionIds: opts.assumptionIds ? [...opts.assumptionIds] : [],
    updatedAt: nowIso(),
    staleAt: opts.staleAt,
    combiningRule: 'average',
  };
}

/** Convert a legacy 0-10 severity score to a BeliefValue. */
export function fromLegacySeverity(severity: number, sourceId?: string): BeliefValue {
  const p = clamp01(severity / 10);
  return {
    ...createBelief(p, {
      lower: p - LEGACY_HALF_WIDTH,
      upper: p + LEGACY_HALF_WIDTH,
      provenance: sourceId ? [sourceId] : [],
    }),
    combiningRule: 'average',
  };
}

// ── Combination ────────────────────────────────────────────────────────────

/**
 * Noisy-OR: combine independent evidence that each supports the hypothesis.
 *   P(H | E1, E2) ≈ 1 - (1 - P(E1)) * (1 - P(E2))
 * The interval bounds are propagated through the same formula, so combining
 * more (non-saturating) sources both raises the point and widens the band.
 */
export function noisyOr(beliefs: BeliefValue[]): BeliefValue {
  if (beliefs.length === 0) return createBelief(0);
  if (beliefs.length === 1) return beliefs[0]!;
  const point = noisyOrScalar(beliefs.map((b) => b.point));
  const lower = noisyOrScalar(beliefs.map((b) => b.lower));
  const upper = noisyOrScalar(beliefs.map((b) => b.upper));
  return assemble(beliefs, point, lower, upper, 'noisy-or');
}

/**
 * Log-odds update: apply a likelihood ratio to a prior belief.
 *   logit(posterior) = logit(prior) + ln(likelihoodRatio)
 * lr > 1 → evidence supports the hypothesis; lr < 1 → contradicts; lr = 1 is
 * a no-op. The interval bounds shift with the point so the band travels intact.
 */
export function logOddsUpdate(
  prior: BeliefValue,
  likelihoodRatio: number,
  evidenceId: string,
): BeliefValue {
  const shift = Math.log(Math.max(LOGIT_EPS, likelihoodRatio));
  const move = (x: number): number => sigmoid(logit(x) + shift);
  return {
    ...prior,
    point: move(prior.point),
    lower: move(prior.lower),
    upper: move(prior.upper),
    provenance: addUnique(prior.provenance, evidenceId),
    updatedAt: nowIso(),
    combiningRule: 'log-odds',
  };
}

/** Merge a set of beliefs through one of the combining rules. */
export function propagateConfidence(beliefs: BeliefValue[], rule: CombiningRule): BeliefValue {
  if (beliefs.length === 0) return createBelief(0);
  if (beliefs.length === 1) return beliefs[0]!;
  if (rule === 'noisy-or') return noisyOr(beliefs);

  const points = beliefs.map((b) => b.point);
  const lowers = beliefs.map((b) => b.lower);
  const uppers = beliefs.map((b) => b.upper);

  let point: number;
  let lower: number;
  let upper: number;
  switch (rule) {
    case 'min': {
      point = Math.min(...points);
      lower = Math.min(...lowers);
      upper = Math.min(...uppers);
      break;
    }
    case 'max': {
      point = Math.max(...points);
      lower = Math.max(...lowers);
      upper = Math.max(...uppers);
      break;
    }
    case 'log-odds': {
      point = sigmoid(sum(points.map((v) => logit(v))));
      lower = sigmoid(sum(lowers.map((v) => logit(v))));
      upper = sigmoid(sum(uppers.map((v) => logit(v))));
      break;
    }
    default: {
      point = mean(points);
      lower = mean(lowers);
      upper = mean(uppers);
      break;
    }
  }
  return assemble(beliefs, point, lower, upper, rule);
}

// ── Staleness ──────────────────────────────────────────────────────────────

/**
 * Widen the interval to reflect staleness. Fresh (factor 0) leaves the band
 * untouched; fully stale (factor 1) blows it out to [0, 1]. The point estimate
 * is never moved — only our confidence in it decays.
 */
export function applyStalenessDegradation(belief: BeliefValue, now?: string): BeliefValue {
  const s = effectiveStaleness(belief, now);
  if (s <= 0) return { ...belief };
  return {
    ...belief,
    lower: clamp01(belief.lower * (1 - s)),
    upper: clamp01(belief.upper + (1 - belief.upper) * s),
    stalenessFactor: s,
  };
}

/** Apply staleness degradation automatically once `staleAt` is in the past. */
export function ensureFresh(belief: BeliefValue, now?: string): BeliefValue {
  if (!isStale(belief, now)) return belief;
  return applyStalenessDegradation(belief, now ?? nowIso());
}

/** True when the belief's inputs have expired relative to `now`. */
export function isStale(belief: BeliefValue, now?: string): boolean {
  if (!belief.staleAt) return false;
  const staleAt = Date.parse(belief.staleAt);
  if (Number.isNaN(staleAt)) return false;
  return parseNow(now) >= staleAt;
}

// ── Read-out ───────────────────────────────────────────────────────────────

/** Map a point estimate to the ICD 203 estimative-probability lexicon. */
export function getProbabilityLabel(point: number): ProbabilityLabel {
  const p = clamp01(point);
  if (p < 0.1) return 'almost-certainly-not';
  if (p < 0.3) return 'very-unlikely';
  if (p < 0.45) return 'unlikely';
  if (p < 0.55) return 'roughly-even';
  if (p < 0.85) return 'likely';
  if (p < 0.95) return 'very-likely';
  return 'almost-certainly';
}

function beliefPct(x: number): number {
  return Math.round(clamp01(x) * 100);
}

/** Human-readable one-liner: "likely (72%, CI 58–84%)". */
export function formatBelief(belief: BeliefValue): string {
  return `${getProbabilityLabel(belief.point)} (${beliefPct(belief.point)}%, CI ${beliefPct(belief.lower)}–${beliefPct(belief.upper)}%)`;
}

/** Interval width (upper - lower) — a direct measure of uncertainty. */
export function intervalWidth(belief: BeliefValue): number {
  return belief.upper - belief.lower;
}

// ── Internals ──────────────────────────────────────────────────────────────

function assemble(
  beliefs: BeliefValue[],
  point: number,
  lower: number,
  upper: number,
  rule: CombiningRule,
): BeliefValue {
  const lo = clamp01(Math.min(lower, upper));
  const hi = clamp01(Math.max(lower, upper));
  return {
    point: clamp01(point),
    lower: lo,
    upper: hi,
    stalenessFactor: Math.max(0, ...beliefs.map((b) => b.stalenessFactor)),
    provenance: mergeUnique(beliefs.map((b) => b.provenance)),
    assumptionIds: mergeUnique(beliefs.map((b) => b.assumptionIds)),
    updatedAt: nowIso(),
    staleAt: earliestStaleAt(beliefs),
    combiningRule: rule,
  };
}

function noisyOrScalar(values: number[]): number {
  let product = 1;
  for (const v of values) product *= 1 - clamp01(v);
  return clamp01(1 - product);
}

function effectiveStaleness(belief: BeliefValue, now?: string): number {
  let s = clamp01(belief.stalenessFactor);
  if (now !== undefined && belief.staleAt) {
    s = Math.max(s, stalenessFromStaleAt(belief.staleAt, parseNow(now)));
  }
  return s;
}

function stalenessFromStaleAt(staleAt: string, nowMs: number): number {
  const t = Date.parse(staleAt);
  if (Number.isNaN(t) || nowMs < t) return 0;
  return clamp01((nowMs - t) / STALENESS_RAMP_MS);
}

function earliestStaleAt(beliefs: BeliefValue[]): string | undefined {
  let earliest: number | undefined;
  let iso: string | undefined;
  for (const b of beliefs) {
    if (!b.staleAt) continue;
    const t = Date.parse(b.staleAt);
    if (Number.isNaN(t)) continue;
    if (earliest === undefined || t < earliest) {
      earliest = t;
      iso = b.staleAt;
    }
  }
  return iso;
}

function logit(p: number): number {
  const x = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, p));
  return Math.log(x / (1 - x));
}

function sigmoid(z: number): number {
  return clamp01(1 / (1 + Math.exp(-z)));
}

function mergeUnique(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function addUnique(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseNow(now?: string): number {
  if (now === undefined) return Date.now();
  const t = Date.parse(now);
  return Number.isNaN(t) ? Date.now() : t;
}
