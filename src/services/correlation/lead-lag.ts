/**
 * Statistical lead-lag discovery — supersedes naive follow-counting.
 *
 * The old miner (intelligence/learned-cascades.ts) counted "B follows A
 * within the window" with no base-rate normalization, so a chatty
 * consequent domain "followed" everything. This miner normalizes against
 * the consequent's Poisson base rate and only calls an edge significant
 * when the observed follow rate beats chance by both lift and z-score.
 *
 * Pure deterministic: no DOM, no fetch, no clock reads.
 * See docs/CORRELATION_NEXTGEN_PLAN.md §D4.
 */

import type { DomainEvent } from '../intelligence/learned-cascades';

export type { DomainEvent } from '../intelligence/learned-cascades';

export interface LeadLagEdge {
  from: string;
  to: string;
  /** The window scale (ms) this edge scored best at. */
  windowMs: number;
  /** A-events followed by ≥1 B within the window. */
  support: number;
  /** Total A-events. */
  antecedents: number;
  /** support / antecedents. */
  followRate: number;
  /** P(≥1 B in a random window of this length) under B's Poisson rate. */
  expectedRate: number;
  /** followRate / expectedRate — 1.0 means pure chance. */
  lift: number;
  /** Binomial z-score of `support` against the chance rate. */
  zScore: number;
  medianLagMs: number;
  /** 90th-percentile lag — a sound rule window for the learned rule. */
  lagP90Ms: number;
  /** Bounded blend of lift and z in 0..1 for ranking. */
  strength: number;
  explanation: string;
}

export interface MineLeadLagOptions {
  /** Window scales to evaluate each pair at — the best-scoring scale
   *  wins. Couplings have characteristic lags (cyber→outage: minutes to
   *  hours; drought→unrest: days to weeks); one wide window drowns tight
   *  couplings in chance. Default [1h, 6h, 24h, 72h]. */
  windowsMs?: readonly number[];
  /** Minimum A-event count for the pair to be eligible. Default 3. */
  minAntecedents?: number;
  /** Skip A→A. Default true. */
  excludeSelf?: boolean;
}

export interface SignificanceOptions {
  /** Minimum lift over chance. Default 2. */
  minLift?: number;
  /** Minimum binomial z-score. Default 2. */
  minZ?: number;
  /** Minimum absolute support. Default 3. */
  minSupport?: number;
}

const HOUR_MS = 3_600_000;

export const DEFAULT_WINDOWS_MS: readonly number[] = [
  HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS, 72 * HOUR_MS,
];

export function mineLeadLag(
  events: readonly DomainEvent[],
  options: MineLeadLagOptions = {},
): LeadLagEdge[] {
  const windows = options.windowsMs ?? DEFAULT_WINDOWS_MS;
  const minAntecedents = options.minAntecedents ?? 3;
  const excludeSelf = options.excludeSelf ?? true;

  const byDomain = groupTimesByDomain(events);
  const span = observedSpanMs(events);
  if (span <= 0 || windows.length === 0) return [];

  const out: LeadLagEdge[] = [];
  for (const [from, antecedents] of byDomain) {
    if (antecedents.length < minAntecedents) continue;
    for (const [to, consequents] of byDomain) {
      if (excludeSelf && to === from) continue;
      const best = bestEdgeAcrossWindows(from, to, antecedents, consequents, windows, span);
      if (best) out.push(best);
    }
  }
  out.sort((a, b) => b.strength - a.strength || b.support - a.support);
  return out;
}

function bestEdgeAcrossWindows(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  windows: readonly number[],
  spanMs: number,
): LeadLagEdge | null {
  let best: LeadLagEdge | null = null;
  for (const windowMs of windows) {
    const edge = minePair(from, to, antecedents, consequents, windowMs, spanMs);
    if (edge && (!best || edge.strength > best.strength)) best = edge;
  }
  return best;
}

/** Edges beating chance on every gate — safe to turn into rules. */
export function significantEdges(
  edges: readonly LeadLagEdge[],
  options: SignificanceOptions = {},
): LeadLagEdge[] {
  const minLift = options.minLift ?? 2;
  const minZ = options.minZ ?? 2;
  const minSupport = options.minSupport ?? 3;
  return edges.filter(
    (e) => e.lift >= minLift && e.zScore >= minZ && e.support >= minSupport,
  );
}

function minePair(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  windowMs: number,
  spanMs: number,
): LeadLagEdge | null {
  let support = 0;
  const lags: number[] = [];
  for (const a of antecedents) {
    const lag = firstFollowingLag(consequents, a, windowMs);
    if (lag !== null) {
      support += 1;
      lags.push(lag);
    }
  }
  if (support === 0) return null;

  const n = antecedents.length;
  const followRate = support / n;
  // Poisson base rate of the consequent over the observed span → the
  // chance probability of seeing ≥1 B in ANY window of this length.
  const lambda = consequents.length / spanMs;
  const expectedRate = clamp01(1 - Math.exp(-lambda * windowMs));
  const lift = expectedRate > 0 ? followRate / expectedRate : Number.POSITIVE_INFINITY;
  const zScore = binomialZ(support, n, expectedRate);
  const strength = clamp01(
    (Math.min(lift, 4) / 4) * 0.6 + (Math.min(Math.max(zScore, 0), 4) / 4) * 0.4,
  );
  const medianLagMs = quantile(lags, 0.5);
  const lagP90Ms = quantile(lags, 0.9);
  return {
    from, to, windowMs, support, antecedents: n,
    followRate: round4(followRate),
    expectedRate: round4(expectedRate),
    lift: round2(lift),
    zScore: round2(zScore),
    medianLagMs, lagP90Ms,
    strength: round4(strength),
    explanation:
      `${from}→${to}: ${support}/${n} followed within ${(windowMs / HOUR_MS).toFixed(0)}h ` +
      `(chance ${(expectedRate * 100).toFixed(0)}%, lift ${round2(lift)}, z ${round2(zScore)}, ` +
      `median lag ${(medianLagMs / HOUR_MS).toFixed(1)}h)`,
  };
}

/** z = (support − n·p0) / sqrt(n·p0·(1−p0)); 0 when the variance is 0. */
function binomialZ(support: number, n: number, p0: number): number {
  const variance = n * p0 * (1 - p0);
  if (variance <= 0) return support > n * p0 ? Number.POSITIVE_INFINITY : 0;
  return (support - n * p0) / Math.sqrt(variance);
}

function groupTimesByDomain(events: readonly DomainEvent[]): Map<string, number[]> {
  const ordered = [...events]
    .filter((e) => Number.isFinite(e.at) && typeof e.domain === 'string' && e.domain.length > 0)
    .sort((a, b) => a.at - b.at);
  const byDomain = new Map<string, number[]>();
  for (const e of ordered) {
    const list = byDomain.get(e.domain) ?? [];
    list.push(e.at);
    byDomain.set(e.domain, list);
  }
  return byDomain;
}

function observedSpanMs(events: readonly DomainEvent[]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (!Number.isFinite(e.at)) continue;
    if (e.at < min) min = e.at;
    if (e.at > max) max = e.at;
  }
  return max > min ? max - min : 0;
}

/** Lag to the first consequent strictly after `a` within the window;
 *  consequents must be time-sorted. */
function firstFollowingLag(
  consequents: readonly number[],
  a: number,
  windowMs: number,
): number | null {
  for (const c of consequents) {
    if (c <= a) continue;
    if (c - a > windowMs) return null;
    return c - a;
  }
  return null;
}

function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : v;
}

function round4(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 10_000) / 10_000 : v;
}
