/**
 * Sparse lead-lag discovery with exact pair tests, family correction,
 * automatic burst declustering, and conservative redundancy filtering.
 * Pure and deterministic: no DOM, fetches, timers, or runtime dependencies.
 */

import type { DomainEvent } from '../intelligence/learned-cascades';

export type { DomainEvent } from '../intelligence/learned-cascades';

export type RedundancyKind = 'chain' | 'fork' | 'reciprocal' | 'inhibitory-reverse';

export interface EdgeRedundancy {
  kind: RedundancyKind;
  via?: string;
  explainedFraction: number;
}

interface LeadLagEdgeBase {
  from: string;
  to: string;
  windowMs: number;
  support: number;
  antecedents: number;
  followRate: number;
  expectedRate: number;
  lift: number;
  zScore: number;
  /** Posterior probability retained for the existing 0..1 display contract. */
  strength: number;
  /** Unbounded posterior log odds used for ranking and cap decisions. */
  rankingScore?: number;
  pairPValue?: number;
  adjustedPValue?: number;
  qValue?: number;
  posteriorProbability?: number;
  expectedUtility?: number;
  redundancy?: EdgeRedundancy;
  explanation: string;
}

export interface PromotingLeadLagEdge extends LeadLagEdgeBase {
  effect: 'promoting';
  medianLagMs: number;
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
  method: 'exact-binomial-holm' | 'gaussian-union-bound';
}

export interface LeadLagMiningResult {
  family: MultipleTestingFamily | null;
  candidates: readonly PromotingLeadLagEdge[];
  promoting: readonly PromotingLeadLagEdge[];
  inhibitory: readonly InhibitoryLeadLagEdge[];
}

export interface MineLeadLagOptions {
  windowsMs?: readonly number[];
  minAntecedents?: number;
  alpha?: number;
  /** BH is diagnostic/shadow only; live promotion uses Holm FWER control. */
  fdrQ?: number;
  minZ?: number;
  minimumPosteriorProbability?: number;
  observationEndMs?: number;
  /** Set false only for controlled diagnostic comparisons. Default true. */
  decluster?: boolean;
  maximumExplainedShortcut?: number;
}

export interface PosteriorEvidenceInput {
  support: number;
  antecedentCount: number;
  expectedRate: number;
  priorProbability?: number;
  alternativeLift?: number;
  alternativeConcentration?: number;
  truePositiveBenefit?: number;
  falsePositiveCost?: number;
}

export interface PosteriorEvidence {
  posteriorProbability: number;
  posteriorLogOdds: number;
  expectedUtility: number;
}

interface PairTrial extends LeadLagEdgeBase {
  lags: readonly number[];
  windowPValue: number;
}

interface ResolvedOptions {
  windows: readonly number[];
  minAntecedents: number;
  alpha: number;
  fdrQ: number;
  minZ: number;
  minimumPosteriorProbability: number;
  observationEndMs: number | undefined;
  decluster: boolean;
  maximumExplainedShortcut: number;
}

const HOUR_MS = 3_600_000;
const DEFAULT_PRIOR_PROBABILITY = 0.02;
const DEFAULT_ALTERNATIVE_LIFT = 2;
const DEFAULT_ALTERNATIVE_CONCENTRATION = 8;
const DEFAULT_FALSE_POSITIVE_COST = 4;
const DEFAULT_TRUE_POSITIVE_BENEFIT = 1;

export const DEFAULT_WINDOWS_MS: readonly number[] = [
  HOUR_MS,
  6 * HOUR_MS,
  24 * HOUR_MS,
  72 * HOUR_MS,
];

export function mineLeadLag(
  events: readonly DomainEvent[],
  options: MineLeadLagOptions = {},
): LeadLagMiningResult {
  const resolved = resolveOptions(options);
  if (!validConfiguration(resolved)) return emptyMiningResult();

  const validEvents = events.filter((event) =>
    isValidDomainEvent(event)
      && (resolved.observationEndMs === undefined || event.at <= resolved.observationEndMs));
  const originalByDomain = groupTimesByDomain(validEvents);
  const declusterGaps = resolved.decluster ? inferDeclusterGaps(originalByDomain) : new Map();
  const independentEvents = resolved.decluster
    ? declusterDomainEvents(validEvents, declusterGaps)
    : [...validEvents];
  const byDomain = groupTimesByDomain(independentEvents);
  const promotingSpanMs = observedSpanMs(validEvents, undefined);
  const inhibitorySpanMs = observedSpanMs(validEvents, resolved.observationEndMs);
  if (promotingSpanMs <= 0) return emptyMiningResult();

  const eligibleOrigins = [...byDomain].filter(([, times]) =>
    times.length >= resolved.minAntecedents);
  const eligibleOrderedPairs = eligibleOrigins.reduce(
    (count, [from]) => count + [...byDomain.keys()].filter((to) => to !== from).length,
    0,
  );
  if (eligibleOrderedPairs === 0) return emptyMiningResult();

  const family = multipleTestingFamily(
    resolved.alpha,
    eligibleOrderedPairs,
    resolved.windows.length,
  );
  const mined = mineEligiblePairs(
    eligibleOrigins,
    byDomain,
    originalByDomain,
    resolved,
    promotingSpanMs,
    inhibitorySpanMs,
    family.criticalAbsZ,
  );
  adjustPromotingFamily(mined.candidates, eligibleOrderedPairs);

  const statisticallyEligible = mined.candidates.filter((edge) =>
    isPromotingSignificant(edge, resolved));
  applyRedundancyFilter(
    statisticallyEligible,
    mined.candidates,
    mined.inhibitory,
    byDomain,
    originalByDomain,
    declusterGaps,
    resolved.maximumExplainedShortcut,
  );
  const promoting = statisticallyEligible.filter((edge) => edge.redundancy === undefined);

  mined.candidates.sort(comparePromoting);
  promoting.sort(comparePromoting);
  mined.inhibitory.sort(compareInhibitory);
  return { family, candidates: mined.candidates, promoting, inhibitory: mined.inhibitory };
}

function resolveOptions(options: MineLeadLagOptions): ResolvedOptions {
  return {
    windows: options.windowsMs ?? DEFAULT_WINDOWS_MS,
    minAntecedents: options.minAntecedents ?? 3,
    alpha: options.alpha ?? 0.05,
    fdrQ: options.fdrQ ?? 0.01,
    minZ: options.minZ ?? 2,
    minimumPosteriorProbability: options.minimumPosteriorProbability ?? 0.8,
    observationEndMs: options.observationEndMs,
    decluster: options.decluster ?? true,
    maximumExplainedShortcut: options.maximumExplainedShortcut ?? 0.8,
  };
}

function validConfiguration(options: ResolvedOptions): boolean {
  return Number.isFinite(options.alpha)
    && options.alpha > 0
    && options.alpha < 1
    && Number.isFinite(options.fdrQ)
    && options.fdrQ > 0
    && options.fdrQ < 1
    && Number.isInteger(options.minAntecedents)
    && options.minAntecedents > 0
    && Number.isFinite(options.minZ)
    && options.minZ >= 0
    && Number.isFinite(options.minimumPosteriorProbability)
    && options.minimumPosteriorProbability > 0
    && options.minimumPosteriorProbability < 1
    && Number.isFinite(options.maximumExplainedShortcut)
    && options.maximumExplainedShortcut > 0
    && options.maximumExplainedShortcut <= 1
    && (options.observationEndMs === undefined || Number.isFinite(options.observationEndMs))
    && options.windows.length > 0
    && options.windows.every((windowMs) => Number.isFinite(windowMs) && windowMs > 0)
    && new Set(options.windows).size === options.windows.length;
}

function emptyMiningResult(): LeadLagMiningResult {
  return { family: null, candidates: [], promoting: [], inhibitory: [] };
}

function multipleTestingFamily(
  alpha: number,
  eligibleOrderedPairs: number,
  windowCount: number,
): MultipleTestingFamily {
  const pairWindowTests = eligibleOrderedPairs * windowCount;
  return {
    alpha,
    eligibleOrderedPairs,
    windowCount,
    pairWindowTests,
    tails: 2,
    criticalAbsZ: Math.sqrt(2 * Math.log((2 * pairWindowTests) / alpha)),
    method: 'exact-binomial-holm',
  };
}

function mineEligiblePairs(
  eligibleOrigins: readonly (readonly [string, number[]])[],
  byDomain: ReadonlyMap<string, readonly number[]>,
  originalByDomain: ReadonlyMap<string, readonly number[]>,
  options: ResolvedOptions,
  promotingSpanMs: number,
  inhibitorySpanMs: number,
  criticalAbsZ: number,
): { candidates: PromotingLeadLagEdge[]; inhibitory: InhibitoryLeadLagEdge[] } {
  const candidates: PromotingLeadLagEdge[] = [];
  const inhibitory: InhibitoryLeadLagEdge[] = [];
  for (const [from, antecedents] of eligibleOrigins) {
    for (const [to, consequents] of byDomain) {
      if (to === from) continue;
      const best = bestEdgesAcrossWindows(
        from,
        to,
        antecedents,
        consequents,
        originalByDomain.get(from) ?? antecedents,
        originalByDomain.get(to) ?? consequents,
        options.windows,
        promotingSpanMs,
        inhibitorySpanMs,
        options.observationEndMs,
      );
      if (best.promoting) candidates.push(best.promoting);
      if (best.inhibitory && isInhibitorySignificant(best.inhibitory, criticalAbsZ)) {
        inhibitory.push(best.inhibitory);
      }
    }
  }
  return { candidates, inhibitory };
}

function bestEdgesAcrossWindows(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  inhibitoryAntecedents: readonly number[],
  inhibitoryConsequents: readonly number[],
  windows: readonly number[],
  promotingSpanMs: number,
  inhibitorySpanMs: number,
  observationEndMs: number | undefined,
): { promoting: PromotingLeadLagEdge | null; inhibitory: InhibitoryLeadLagEdge | null } {
  let bestPromoting: PromotingLeadLagEdge | null = null;
  let bestInhibitory: InhibitoryLeadLagEdge | null = null;
  let minimumUpperP = 1;
  let minimumLowerP = 1;
  for (const windowMs of windows) {
    const trial = minePair(from, to, antecedents, consequents, windowMs, promotingSpanMs);
    minimumUpperP = Math.min(minimumUpperP, trial.windowPValue);
    if (trial.support > 0) {
      const edge = promotingEdge(trial);
      if (!bestPromoting || comparePromoting(edge, bestPromoting) < 0) bestPromoting = edge;
    }
    const matureAntecedents = observationEndMs === undefined
      ? []
      : inhibitoryAntecedents.filter((at) => at <= observationEndMs - windowMs);
    if (matureAntecedents.length === 0) continue;
    const inhibitoryTrial = minePair(
      from,
      to,
      matureAntecedents,
      inhibitoryConsequents,
      windowMs,
      inhibitorySpanMs,
    );
    minimumLowerP = Math.min(
      minimumLowerP,
      exactBinomialTail(
        inhibitoryTrial.antecedents,
        inhibitoryTrial.support,
        inhibitoryTrial.expectedRate,
        'lower',
      ),
    );
    const edge = inhibitoryEdge(inhibitoryTrial);
    if (!bestInhibitory || compareInhibitory(edge, bestInhibitory) < 0) bestInhibitory = edge;
  }
  if (bestPromoting) bestPromoting.pairPValue = Math.min(1, minimumUpperP * windows.length);
  if (bestInhibitory) bestInhibitory.pairPValue = Math.min(1, minimumLowerP * windows.length);
  return { promoting: bestPromoting, inhibitory: bestInhibitory };
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
  for (const antecedent of antecedents) {
    const lag = firstFollowingLag(consequents, antecedent, windowMs);
    if (lag === null) continue;
    support += 1;
    lags.push(lag);
  }
  const n = antecedents.length;
  const followRate = support / n;
  const lambda = consequents.length / spanMs;
  const expectedRate = clamp01(1 - Math.exp(-lambda * windowMs));
  const lift = expectedRate > 0 ? followRate / expectedRate : Number.POSITIVE_INFINITY;
  const zScore = binomialZ(support, n, expectedRate);
  const evidence = posteriorEvidence({ support, antecedentCount: n, expectedRate });
  const windowPValue = exactBinomialTail(n, support, expectedRate, 'upper');
  return {
    from,
    to,
    windowMs,
    support,
    antecedents: n,
    followRate,
    expectedRate,
    lift,
    zScore,
    strength: evidence.posteriorProbability,
    rankingScore: evidence.posteriorLogOdds,
    posteriorProbability: evidence.posteriorProbability,
    expectedUtility: evidence.expectedUtility,
    explanation:
      `${from}→${to}: ${support}/${n} independent episodes followed within ` +
      `${(windowMs / HOUR_MS).toFixed(0)}h (chance ${(expectedRate * 100).toFixed(0)}%, ` +
      `lift ${round2(lift)}, exact p ${formatP(windowPValue)}, posterior ` +
      `${(evidence.posteriorProbability * 100).toFixed(1)}%, median lag ` +
      `${(quantile(lags, 0.5) / HOUR_MS).toFixed(1)}h)`,
    lags,
    windowPValue,
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
    rankingScore: trial.rankingScore,
    posteriorProbability: trial.posteriorProbability,
    expectedUtility: trial.expectedUtility,
    explanation: trial.explanation,
  };
}

function adjustPromotingFamily(
  candidates: PromotingLeadLagEdge[],
  eligibleOrderedPairs: number,
): void {
  const pValues = candidates.map((edge) => edge.pairPValue ?? 1);
  while (pValues.length < eligibleOrderedPairs) pValues.push(1);
  const holm = holmAdjust(pValues);
  const bh = benjaminiHochberg(pValues);
  for (const [index, edge] of candidates.entries()) {
    edge.adjustedPValue = holm[index];
    edge.qValue = bh[index];
  }
}

function isPromotingSignificant(edge: PromotingLeadLagEdge, options: ResolvedOptions): boolean {
  return edge.lift >= 2
    && edge.support >= 3
    && edge.zScore >= options.minZ
    && (edge.adjustedPValue ?? 1) <= options.alpha
    && (edge.posteriorProbability ?? 0) >= options.minimumPosteriorProbability
    && (edge.expectedUtility ?? Number.NEGATIVE_INFINITY) > 0;
}

function isInhibitorySignificant(edge: InhibitoryLeadLagEdge, criticalAbsZ: number): boolean {
  return edge.antecedents >= 5
    && edge.expectedRate >= 0.2
    && edge.lift <= 0.5
    && edge.zScore <= -Math.max(2, criticalAbsZ);
}

function applyRedundancyFilter(
  eligible: PromotingLeadLagEdge[],
  candidates: PromotingLeadLagEdge[],
  inhibitory: readonly InhibitoryLeadLagEdge[],
  byDomain: ReadonlyMap<string, readonly number[]>,
  originalByDomain: ReadonlyMap<string, readonly number[]>,
  declusterGaps: ReadonlyMap<string, number>,
  maximumExplainedShortcut: number,
): void {
  for (const edge of eligible) {
    if (inhibitory.some((item) => item.from === edge.to && item.to === edge.from)) {
      edge.redundancy = { kind: 'inhibitory-reverse', explainedFraction: 1 };
    } else if (isReciprocalBurst(edge, originalByDomain, declusterGaps)) {
      edge.redundancy = { kind: 'reciprocal', explainedFraction: 1 };
    }
  }
  const usable = eligible.filter((edge) => edge.redundancy === undefined);
  for (const direct of usable) {
    const chain = explainedByChain(direct, usable, byDomain, maximumExplainedShortcut);
    if (chain) direct.redundancy = chain;
  }
  const chainFiltered = eligible.filter((edge) => edge.redundancy === undefined);
  for (const direct of chainFiltered) {
    const fork = explainedByFork(direct, chainFiltered, byDomain, maximumExplainedShortcut);
    if (fork) direct.redundancy = fork;
  }
  const redundancies = new Map(
    eligible.filter((edge) => edge.redundancy)
      .map((edge) => [pairKey(edge.from, edge.to), edge.redundancy] as const),
  );
  for (const candidate of candidates) {
    candidate.redundancy = redundancies.get(pairKey(candidate.from, candidate.to));
  }
}

function isReciprocalBurst(
  edge: PromotingLeadLagEdge,
  originalByDomain: ReadonlyMap<string, readonly number[]>,
  declusterGaps: ReadonlyMap<string, number>,
): boolean {
  if (!declusterGaps.has(edge.from) && !declusterGaps.has(edge.to)) return false;
  const from = originalByDomain.get(edge.from) ?? [];
  const to = originalByDomain.get(edge.to) ?? [];
  if (from.length < 3 || to.length < 3) return false;
  const forward = countFollowSupport(from, to, edge.windowMs);
  const reverse = countFollowSupport(to, from, edge.windowMs);
  return forward >= 3
    && reverse >= 3
    && forward / from.length >= 0.5
    && reverse / to.length >= 0.5;
}

function explainedByChain(
  direct: PromotingLeadLagEdge,
  edges: readonly PromotingLeadLagEdge[],
  byDomain: ReadonlyMap<string, readonly number[]>,
  threshold: number,
): EdgeRedundancy | null {
  for (const first of edges) {
    if (first.from !== direct.from || first.to === direct.to) continue;
    const second = edges.find((edge) => edge.from === first.to && edge.to === direct.to);
    if (!second || first.medianLagMs + second.medianLagMs > direct.windowMs) continue;
    const fraction = interposedFraction(
      byDomain.get(direct.from) ?? [],
      byDomain.get(first.to) ?? [],
      byDomain.get(direct.to) ?? [],
      direct.windowMs,
    );
    const residualSupport = Math.round(direct.support * (1 - fraction));
    if (fraction >= threshold && residualSupport < 3) {
      return { kind: 'chain', via: first.to, explainedFraction: fraction };
    }
  }
  return null;
}

function explainedByFork(
  direct: PromotingLeadLagEdge,
  edges: readonly PromotingLeadLagEdge[],
  byDomain: ReadonlyMap<string, readonly number[]>,
  threshold: number,
): EdgeRedundancy | null {
  for (const intoA of edges) {
    if (intoA.to !== direct.from || intoA.from === direct.to) continue;
    const intoB = edges.find((edge) => edge.from === intoA.from && edge.to === direct.to);
    if (!intoB) continue;
    const fraction = commonDriverFraction(
      byDomain.get(intoA.from) ?? [],
      byDomain.get(direct.from) ?? [],
      byDomain.get(direct.to) ?? [],
      direct.windowMs,
      Math.max(intoA.windowMs, intoB.windowMs),
    );
    const residualSupport = Math.round(direct.support * (1 - fraction));
    if (fraction >= threshold && residualSupport < 3) {
      return { kind: 'fork', via: intoA.from, explainedFraction: fraction };
    }
  }
  return null;
}

function interposedFraction(
  antecedents: readonly number[],
  mediators: readonly number[],
  consequents: readonly number[],
  windowMs: number,
): number {
  let supported = 0;
  let explained = 0;
  for (const at of antecedents) {
    const bLag = firstFollowingLag(consequents, at, windowMs);
    if (bLag === null) continue;
    supported += 1;
    if (firstFollowingLag(mediators, at, bLag) !== null) explained += 1;
  }
  return supported === 0 ? 0 : explained / supported;
}

function commonDriverFraction(
  drivers: readonly number[],
  antecedents: readonly number[],
  consequents: readonly number[],
  directWindowMs: number,
  driverWindowMs: number,
): number {
  let supported = 0;
  let explained = 0;
  for (const at of antecedents) {
    if (firstFollowingLag(consequents, at, directWindowMs) === null) continue;
    supported += 1;
    if (hasPriorWithin(drivers, at, driverWindowMs)) explained += 1;
  }
  return supported === 0 ? 0 : explained / supported;
}

function hasPriorWithin(times: readonly number[], at: number, windowMs: number): boolean {
  for (let index = times.length - 1; index >= 0; index--) {
    const time = times[index]!;
    if (time >= at) continue;
    return at - time <= windowMs;
  }
  return false;
}

export function declusterDomainEvents(
  events: readonly DomainEvent[],
  suppliedGaps?: ReadonlyMap<string, number>,
): DomainEvent[] {
  const byDomain = groupEventsByDomain(events);
  const inferred = suppliedGaps ?? inferDeclusterGaps(groupTimesByDomain(events));
  const output: DomainEvent[] = [];
  for (const [domain, domainEvents] of byDomain) {
    const gap = inferred.get(domain);
    if (gap === undefined) {
      output.push(...domainEvents);
      continue;
    }
    let previous = Number.NEGATIVE_INFINITY;
    for (const event of domainEvents) {
      if (event.at - previous > gap) output.push(event);
      previous = event.at;
    }
  }
  return output.sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain));
}

function inferDeclusterGaps(
  byDomain: ReadonlyMap<string, readonly number[]>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [domain, times] of byDomain) {
    const gap = inferDeclusterGap(times);
    if (gap !== null) result.set(domain, gap);
  }
  return result;
}

function inferDeclusterGap(times: readonly number[]): number | null {
  if (times.length < 7) return null;
  const gaps = positiveLogGaps(times);
  if (gaps.length < 6) return null;
  const clusters = fitGapClusters(gaps);
  if (clusters === null) return null;
  const oneMean = mean(gaps);
  const oneSse = squaredError(gaps, oneMean);
  const twoSse = squaredError(clusters.lowGroup, clusters.low)
    + squaredError(clusters.highGroup, clusters.high);
  if (oneSse <= 0) return null;
  const bicImprovement = gaps.length * Math.log(Math.max(twoSse, 1e-12) / oneSse)
    + 3 * Math.log(gaps.length);
  return bicImprovement < 0 ? Math.exp((clusters.low + clusters.high) / 2) : null;
}

function positiveLogGaps(times: readonly number[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < times.length; index++) {
    const gap = times[index]! - times[index - 1]!;
    if (gap > 0) gaps.push(Math.log(gap));
  }
  return gaps;
}

function fitGapClusters(gaps: readonly number[]): {
  low: number;
  high: number;
  lowGroup: number[];
  highGroup: number[];
} | null {
  let low = Math.min(...gaps);
  let high = Math.max(...gaps);
  if (high - low < Math.log(4)) return null;
  let lowGroup: number[] = [];
  let highGroup: number[] = [];
  for (let iteration = 0; iteration < 20; iteration++) {
    ({ lowGroup, highGroup } = partitionGaps(gaps, low, high));
    if (lowGroup.length === 0 || highGroup.length === 0) return null;
    const nextLow = mean(lowGroup);
    const nextHigh = mean(highGroup);
    if (nextLow === low && nextHigh === high) break;
    low = nextLow;
    high = nextHigh;
  }
  if (lowGroup.length < 2 || highGroup.length < 2 || high - low < Math.log(4)) return null;
  return { low, high, lowGroup, highGroup };
}

function partitionGaps(
  gaps: readonly number[],
  low: number,
  high: number,
): { lowGroup: number[]; highGroup: number[] } {
  const lowGroup: number[] = [];
  const highGroup: number[] = [];
  for (const gap of gaps) {
    const group = Math.abs(gap - low) <= Math.abs(gap - high) ? lowGroup : highGroup;
    group.push(gap);
  }
  return { lowGroup, highGroup };
}

function squaredError(values: readonly number[], center: number): number {
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0);
}

export function exactBinomialTail(
  trials: number,
  successes: number,
  probability: number,
  tail: 'upper' | 'lower' = 'upper',
): number {
  if (!Number.isInteger(trials) || trials < 0 || !Number.isInteger(successes)) return 1;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) return 1;
  if (tail === 'upper') {
    if (successes <= 0) return 1;
    if (successes > trials) return 0;
    return sumBinomialRange(trials, successes, trials, probability);
  }
  if (successes < 0) return 0;
  if (successes >= trials) return 1;
  return sumBinomialRange(trials, 0, successes, probability);
}

function sumBinomialRange(n: number, start: number, end: number, p: number): number {
  if (p === 0) return start === 0 ? 1 : 0;
  if (p === 1) return end === n ? 1 : 0;
  const logs: number[] = [];
  for (let k = start; k <= end; k++) {
    logs.push(
      logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
      + k * Math.log(p) + (n - k) * Math.log1p(-p),
    );
  }
  const maximum = Math.max(...logs);
  const sum = logs.reduce((total, value) => total + Math.exp(value - maximum), 0);
  return clamp01(Math.exp(maximum) * sum);
}

export function holmAdjust(pValues: readonly number[]): number[] {
  const ordered = pValues.map((p, index) => ({ p: validP(p), index }))
    .sort((a, b) => a.p - b.p || a.index - b.index);
  const adjusted = Array.from({ length: pValues.length }, () => 1);
  let running = 0;
  for (const [rank, item] of ordered.entries()) {
    running = Math.max(running, Math.min(1, item.p * (ordered.length - rank)));
    adjusted[item.index] = running;
  }
  return adjusted;
}

export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const ordered = pValues.map((p, index) => ({ p: validP(p), index }))
    .sort((a, b) => a.p - b.p || a.index - b.index);
  const adjusted = Array.from({ length: pValues.length }, () => 1);
  let running = 1;
  for (let rank = ordered.length - 1; rank >= 0; rank--) {
    const item = ordered[rank]!;
    running = Math.min(running, (item.p * ordered.length) / (rank + 1));
    adjusted[item.index] = clamp01(running);
  }
  return adjusted;
}

function validP(value: number): number {
  return Number.isFinite(value) ? clamp01(value) : 1;
}

export function posteriorEvidence(input: PosteriorEvidenceInput): PosteriorEvidence {
  const n = input.antecedentCount;
  const k = input.support;
  const p0 = clampProbability(input.expectedRate);
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(k) || k < 0 || k > n) {
    return {
      posteriorProbability: 0,
      posteriorLogOdds: Number.NEGATIVE_INFINITY,
      expectedUtility: -DEFAULT_FALSE_POSITIVE_COST,
    };
  }
  const prior = clampProbability(input.priorProbability ?? DEFAULT_PRIOR_PROBABILITY);
  const alternativeMean = clampProbability(
    p0 * (input.alternativeLift ?? DEFAULT_ALTERNATIVE_LIFT),
  );
  const concentration = input.alternativeConcentration ?? DEFAULT_ALTERNATIVE_CONCENTRATION;
  const alpha = alternativeMean * concentration;
  const beta = (1 - alternativeMean) * concentration;
  const logAlternative = logBeta(k + alpha, n - k + beta) - logBeta(alpha, beta);
  const logNull = k * Math.log(p0) + (n - k) * Math.log1p(-p0);
  const posteriorLogOdds = Math.log(prior / (1 - prior)) + logAlternative - logNull;
  const posteriorProbability = logistic(posteriorLogOdds);
  const benefit = input.truePositiveBenefit ?? DEFAULT_TRUE_POSITIVE_BENEFIT;
  const cost = input.falsePositiveCost ?? DEFAULT_FALSE_POSITIVE_COST;
  return {
    posteriorProbability,
    posteriorLogOdds,
    expectedUtility: posteriorProbability * benefit - (1 - posteriorProbability) * cost,
  };
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function logGamma(value: number): number {
  const coefficients = [
    0.999_999_999_999_809_9,
    676.520_368_121_885_1,
    -1259.139_216_722_402_8,
    771.323_428_777_653_1,
    -176.615_029_162_140_6,
    12.507_343_278_686_905,
    -0.138_571_095_265_720_12,
    9.984_369_578_019_572e-6,
    1.505_632_735_149_311_6e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = coefficients[0]!;
  for (let index = 1; index < coefficients.length; index++) {
    series += coefficients[index]! / (shifted + index);
  }
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function logistic(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function comparePromoting(a: PromotingLeadLagEdge, b: PromotingLeadLagEdge): number {
  return (b.rankingScore ?? Number.NEGATIVE_INFINITY)
    - (a.rankingScore ?? Number.NEGATIVE_INFINITY)
    || b.support - a.support
    || a.windowMs - b.windowMs
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to);
}

function compareInhibitory(a: InhibitoryLeadLagEdge, b: InhibitoryLeadLagEdge): number {
  return a.zScore - b.zScore
    || a.lift - b.lift
    || b.antecedents - a.antecedents
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.windowMs - b.windowMs;
}

function binomialZ(support: number, n: number, p0: number): number {
  const variance = n * p0 * (1 - p0);
  if (variance <= 0) return support > n * p0 ? Number.POSITIVE_INFINITY : 0;
  return (support - n * p0) / Math.sqrt(variance);
}

function groupTimesByDomain(events: readonly DomainEvent[]): Map<string, number[]> {
  const byDomain = new Map<string, number[]>();
  for (const event of [...events].sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain))) {
    const list = byDomain.get(event.domain) ?? [];
    list.push(event.at);
    byDomain.set(event.domain, list);
  }
  return byDomain;
}

function groupEventsByDomain(events: readonly DomainEvent[]): Map<string, DomainEvent[]> {
  const byDomain = new Map<string, DomainEvent[]>();
  for (const event of [...events].sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain))) {
    const list = byDomain.get(event.domain) ?? [];
    list.push(event);
    byDomain.set(event.domain, list);
  }
  return byDomain;
}

function isValidDomainEvent(event: DomainEvent): boolean {
  return Number.isFinite(event.at)
    && typeof event.domain === 'string'
    && event.domain.length > 0;
}

function observedSpanMs(events: readonly DomainEvent[], observationEndMs: number | undefined): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = observationEndMs ?? Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!Number.isFinite(event.at)) continue;
    minimum = Math.min(minimum, event.at);
    if (observationEndMs === undefined) maximum = Math.max(maximum, event.at);
  }
  return maximum > minimum ? maximum - minimum : 0;
}

function firstFollowingLag(
  consequents: readonly number[],
  antecedent: number,
  windowMs: number,
): number | null {
  for (const consequent of consequents) {
    if (consequent <= antecedent) continue;
    if (consequent - antecedent > windowMs) return null;
    return consequent - antecedent;
  }
  return null;
}

function countFollowSupport(
  antecedents: readonly number[],
  consequents: readonly number[],
  windowMs: number,
): number {
  let support = 0;
  for (const antecedent of antecedents) {
    if (firstFollowingLag(consequents, antecedent, windowMs) !== null) support += 1;
  }
  return support;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampProbability(value: number): number {
  return Math.max(1e-12, Math.min(1 - 1e-12, value));
}

function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

function formatP(value: number): string {
  return value < 0.001 ? value.toExponential(1) : value.toFixed(3);
}
