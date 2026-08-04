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

interface LeadLagEdgeBase {
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
  /** Bounded blend of lift and z in 0..1 for ranking. */
  strength: number;
  explanation: string;
}

export interface PromotingLeadLagEdge extends LeadLagEdgeBase {
  effect: 'promoting';
  medianLagMs: number;
  /** 90th-percentile lag — a sound rule window for the learned rule. */
  lagP90Ms: number;
}

export interface InhibitoryLeadLagEdge extends LeadLagEdgeBase {
  effect: 'inhibitory';
}

export type LeadLagEdge = PromotingLeadLagEdge | InhibitoryLeadLagEdge;

export interface MultipleTestingFamily {
  alpha: number;
  eligibleOrderedPairs: number;
  windowCount: number;
  pairWindowTests: number;
  tails: 2;
  criticalAbsZ: number;
  method: 'gaussian-union-bound';
}

export interface LeadLagMiningResult {
  family: MultipleTestingFamily | null;
  candidates: readonly PromotingLeadLagEdge[];
  promoting: readonly PromotingLeadLagEdge[];
  inhibitory: readonly InhibitoryLeadLagEdge[];
}

export interface MineLeadLagOptions {
  /** Window scales to evaluate each pair at — the best-scoring scale
   *  wins. Couplings have characteristic lags (cyber→outage: minutes to
   *  hours; drought→unrest: days to weeks); one wide window drowns tight
   *  couplings in chance. Default [1h, 6h, 24h, 72h]. */
  windowsMs?: readonly number[];
  /** Minimum A-event count for the pair to be eligible. Default 3. */
  minAntecedents?: number;
  /** Family-wise error rate for the two-tailed union bound. Default 0.05. */
  alpha?: number;
  /** Minimum positive z-score before family correction. Default 2. */
  minZ?: number;
}

const HOUR_MS = 3_600_000;

export const DEFAULT_WINDOWS_MS: readonly number[] = [
  HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS, 72 * HOUR_MS,
];

export function mineLeadLag(
  events: readonly DomainEvent[],
  options: MineLeadLagOptions = {},
): LeadLagMiningResult {
  const windows = options.windowsMs ?? DEFAULT_WINDOWS_MS;
  const minAntecedents = options.minAntecedents ?? 3;
  const alpha = options.alpha ?? 0.05;
  const minZ = options.minZ ?? 2;

  if (!validConfiguration(windows, alpha, minAntecedents, minZ)) return emptyMiningResult();

  const validEvents = events.filter((event) => isValidDomainEvent(event));
  const byDomain = groupTimesByDomain(validEvents);
  const span = observedSpanMs(validEvents);
  if (span <= 0) return emptyMiningResult();

  const eligibleOrigins = [...byDomain].filter(([, times]) => times.length >= minAntecedents);
  const eligibleOrderedPairs = eligibleOrigins.reduce(
    (count, [from]) => count + [...byDomain.keys()].filter((to) => to !== from).length,
    0,
  );
  const pairWindowTests = eligibleOrderedPairs * windows.length;
  if (pairWindowTests === 0) return emptyMiningResult();
  const family: MultipleTestingFamily = {
    alpha,
    eligibleOrderedPairs,
    windowCount: windows.length,
    pairWindowTests,
    tails: 2,
    criticalAbsZ: Math.sqrt(2 * Math.log((2 * pairWindowTests) / alpha)),
    method: 'gaussian-union-bound',
  };

  const result = mineEligiblePairs(
    eligibleOrigins,
    byDomain,
    windows,
    span,
    family,
    minZ,
  );
  result.candidates.sort(comparePromoting);
  result.promoting.sort(comparePromoting);
  result.inhibitory.sort(compareInhibitory);
  return { family, ...result };
}

function mineEligiblePairs(
  eligibleOrigins: readonly (readonly [string, number[]])[],
  byDomain: ReadonlyMap<string, readonly number[]>,
  windows: readonly number[],
  spanMs: number,
  family: MultipleTestingFamily,
  minZ: number,
): {
  candidates: PromotingLeadLagEdge[];
  promoting: PromotingLeadLagEdge[];
  inhibitory: InhibitoryLeadLagEdge[];
} {
  const candidates: PromotingLeadLagEdge[] = [];
  const promoting: PromotingLeadLagEdge[] = [];
  const inhibitory: InhibitoryLeadLagEdge[] = [];
  for (const [from, antecedents] of eligibleOrigins) {
    for (const [to, consequents] of byDomain) {
      if (to === from) continue;
      const best = bestEdgesAcrossWindows(from, to, antecedents, consequents, windows, spanMs);
      recordBestEdges(best, family, minZ, candidates, promoting, inhibitory);
    }
  }
  return { candidates, promoting, inhibitory };
}

function recordBestEdges(
  best: { promoting: PromotingLeadLagEdge | null; inhibitory: InhibitoryLeadLagEdge },
  family: MultipleTestingFamily,
  minZ: number,
  candidates: PromotingLeadLagEdge[],
  promoting: PromotingLeadLagEdge[],
  inhibitory: InhibitoryLeadLagEdge[],
): void {
  if (best.promoting) {
    candidates.push(best.promoting);
    if (isPromotingSignificant(best.promoting, family, minZ)) promoting.push(best.promoting);
  }
  if (isInhibitorySignificant(best.inhibitory, family)) inhibitory.push(best.inhibitory);
}

function isPromotingSignificant(
  edge: PromotingLeadLagEdge,
  family: MultipleTestingFamily,
  minZ: number,
): boolean {
  return edge.lift >= 2
    && edge.support >= 3
    && edge.zScore >= Math.max(minZ, family.criticalAbsZ);
}

function isInhibitorySignificant(
  edge: InhibitoryLeadLagEdge,
  family: MultipleTestingFamily,
): boolean {
  return edge.antecedents >= 5
    && edge.expectedRate >= 0.2
    && edge.lift <= 0.5
    && edge.zScore <= -Math.max(2, family.criticalAbsZ);
}

function validConfiguration(
  windows: readonly number[],
  alpha: number,
  minAntecedents: number,
  minZ: number,
): boolean {
  return Number.isFinite(alpha)
    && alpha > 0
    && alpha < 1
    && Number.isInteger(minAntecedents)
    && minAntecedents > 0
    && Number.isFinite(minZ)
    && minZ >= 0
    && windows.length > 0
    && windows.every((windowMs) => Number.isFinite(windowMs) && windowMs > 0)
    && new Set(windows).size === windows.length;
}

function emptyMiningResult(): LeadLagMiningResult {
  return { family: null, candidates: [], promoting: [], inhibitory: [] };
}

interface PairTrial extends LeadLagEdgeBase {
  lags: readonly number[];
}

function bestEdgesAcrossWindows(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  windows: readonly number[],
  spanMs: number,
): { promoting: PromotingLeadLagEdge | null; inhibitory: InhibitoryLeadLagEdge } {
  let bestPromoting: PromotingLeadLagEdge | null = null;
  let bestInhibitory: InhibitoryLeadLagEdge | null = null;
  for (const windowMs of windows) {
    const trial = minePair(from, to, antecedents, consequents, windowMs, spanMs);
    if (trial.support > 0) {
      const edge = promotingEdge(trial);
      if (!bestPromoting || comparePromoting(edge, bestPromoting) < 0) bestPromoting = edge;
    }
    const edge = inhibitoryEdge(trial);
    if (!bestInhibitory || compareInhibitory(edge, bestInhibitory) < 0) bestInhibitory = edge;
  }
  return { promoting: bestPromoting, inhibitory: bestInhibitory! };
}

function minePair(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  windowMs: number,
  spanMs: number,
): PairTrial {
  let support = 0;
  const lags: number[] = [];
  for (const a of antecedents) {
    const lag = firstFollowingLag(consequents, a, windowMs);
    if (lag !== null) {
      support += 1;
      lags.push(lag);
    }
  }
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
  return {
    from, to, windowMs, support, antecedents: n,
    followRate,
    expectedRate,
    lift,
    zScore,
    strength,
    lags,
    explanation:
      `${from}→${to}: ${support}/${n} followed within ${(windowMs / HOUR_MS).toFixed(0)}h ` +
      `(chance ${(expectedRate * 100).toFixed(0)}%, lift ${round2(lift)}, z ${round2(zScore)}, ` +
      `median lag ${(quantile(lags, 0.5) / HOUR_MS).toFixed(1)}h)`,
  };
}

function promotingEdge(trial: PairTrial): PromotingLeadLagEdge {
  return {
    effect: 'promoting',
    ...sharedEdgeFields(trial),
    medianLagMs: quantile(trial.lags, 0.5),
    lagP90Ms: quantile(trial.lags, 0.9),
  };
}

function inhibitoryEdge(trial: PairTrial): InhibitoryLeadLagEdge {
  return {
    effect: 'inhibitory',
    ...sharedEdgeFields(trial),
    explanation:
      `${trial.from}→${trial.to}: ${trial.from} suppresses ${trial.to}; ` +
      `${trial.support}/${trial.antecedents} followed within ` +
      `${(trial.windowMs / HOUR_MS).toFixed(0)}h vs ` +
      `${(trial.expectedRate * 100).toFixed(0)}% expected ` +
      `(lift ${round2(trial.lift)}, z ${round2(trial.zScore)})`,
  };
}

function sharedEdgeFields(trial: PairTrial): LeadLagEdgeBase {
  return {
    from: trial.from,
    to: trial.to,
    windowMs: trial.windowMs,
    support: trial.support,
    antecedents: trial.antecedents,
    followRate: trial.followRate,
    expectedRate: trial.expectedRate,
    lift: trial.lift,
    zScore: trial.zScore,
    strength: trial.strength,
    explanation: trial.explanation,
  };
}

function comparePromoting(a: PromotingLeadLagEdge, b: PromotingLeadLagEdge): number {
  return b.strength - a.strength
    || b.support - a.support
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.windowMs - b.windowMs;
}

function compareInhibitory(a: InhibitoryLeadLagEdge, b: InhibitoryLeadLagEdge): number {
  return a.zScore - b.zScore
    || a.lift - b.lift
    || b.antecedents - a.antecedents
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.windowMs - b.windowMs;
}

/** z = (support − n·p0) / sqrt(n·p0·(1−p0)); 0 when the variance is 0. */
function binomialZ(support: number, n: number, p0: number): number {
  const variance = n * p0 * (1 - p0);
  if (variance <= 0) return support > n * p0 ? Number.POSITIVE_INFINITY : 0;
  return (support - n * p0) / Math.sqrt(variance);
}

function groupTimesByDomain(events: readonly DomainEvent[]): Map<string, number[]> {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const byDomain = new Map<string, number[]>();
  for (const e of ordered) {
    const list = byDomain.get(e.domain) ?? [];
    list.push(e.at);
    byDomain.set(e.domain, list);
  }
  return byDomain;
}

function isValidDomainEvent(event: DomainEvent): boolean {
  return Number.isFinite(event.at)
    && typeof event.domain === 'string'
    && event.domain.length > 0;
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
