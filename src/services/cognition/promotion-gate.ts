/**
 * ACC-402 — Promotion and rollback gate.
 *
 * Pure decision engine for champion/challenger promotion. Consumes the
 * exact joined-pair evidence produced by ACC-401
 * (`collectJoinedEvidence` in shadow-rollout.ts) plus safety-replay
 * evidence, and returns an explained gate-by-gate decision. It never
 * flips anything itself — the champion registry (`champion-registry.ts`)
 * is the only mutator, and it refuses a promotion whose decision is not
 * 'promote'.
 *
 * Gates (all must pass for 'promote'):
 *   1. min-pairs-overall     — ≥ 200 joined resolved pairs.
 *   2. min-pairs-per-domain  — ≥ 100 pairs in every enabled domain.
 *   3. brier-skill           — challenger Brier strictly better than the
 *                              base-rate forecaster on the same cohort.
 *   4. log-loss              — challenger log loss no worse than the
 *                              incumbent's.
 *   5. bootstrap-floor       — one-sided paired-bootstrap lower bound of
 *                              the per-pair Brier improvement at or above
 *                              the no-regression floor. Deterministic
 *                              seeded PRNG — same evidence, same verdict.
 *   6. safety-replay         — full recall on safety-critical replay
 *                              expectations, with a minimum warning
 *                              lead-time when a floor is configured.
 *                              Fails closed when no safety fixtures ran.
 *   7. direct-outcomes       — at least one pair resolved by DIRECT
 *                              evidence; a proxy-only cohort can never
 *                              auto-promote.
 *
 * Pure module — no DOM, no fetch, no globals, no Date.now(), no
 * Math.random(). Every gate carries a human-readable explanation
 * (house invariant: every score includes an explanation).
 */

import type { JoinedPairEvidence } from './shadow-rollout';
import type { ReplayHarnessReport } from '@/services/ops/replay-harness';
import type { ReplayFixture } from '@/services/ops/replay-fixtures';
import type { ReplayBaseline } from '@/services/ops/replay-baseline';

// ── Public types ──────────────────────────────────────────────────────

export interface PromotionGateThresholds {
  /** Minimum joined resolved pairs overall. Roadmap: 200. */
  minPairsOverall: number;
  /** Minimum joined resolved pairs per enabled domain. Roadmap: 100. */
  minPairsPerDomain: number;
  /** Floor for the bootstrap lower bound of mean per-pair Brier
   *  improvement (incumbent − challenger; positive = challenger
   *  better). 0 = challenger provably no worse. */
  noRegressionFloor: number;
  /** Bootstrap resample count. */
  bootstrapResamples: number;
  /** One-sided confidence for the lower bound (0.95 → 5th percentile). */
  bootstrapConfidence: number;
  /** Required recall on safety-critical replay expectations (1 = all). */
  minSafetyRecall: number;
  /** Minimum warning lead-time in minutes across safety replay
   *  fixtures. 0 disables the lead-time check. */
  minLeadTimeMinutes: number;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionGateThresholds = {
  minPairsOverall: 200,
  minPairsPerDomain: 100,
  noRegressionFloor: 0,
  bootstrapResamples: 1000,
  bootstrapConfidence: 0.95,
  minSafetyRecall: 1,
  minLeadTimeMinutes: 0,
};

export interface SafetyReplayEvidence {
  /** Applicable safety-critical replay expectations that ran. */
  safetyCriticalTotal: number;
  /** How many of them passed. */
  safetyCriticalPassed: number;
  /** Worst warning lead-time observed across warning_before_impact
   *  expectations, in minutes. Undefined when no fixture produced one. */
  minLeadTimeMinutes?: number;
}

export interface PromotionGateInput {
  /** Model being considered for promotion (the shadow side). */
  challengerId: string;
  /** Current champion (the live side). */
  incumbentId: string;
  /** Exact joined-pair evidence — challenger's shadowP vs incumbent's
   *  liveP on identical resolved outcomes (ACC-401 joins). */
  pairs: readonly JoinedPairEvidence[];
  /** Domains the deployment enables; each needs minPairsPerDomain. */
  enabledDomains: readonly string[];
  /** Safety replay evidence (use safetyEvidenceFromReplayReport). */
  safety: SafetyReplayEvidence;
  thresholds?: Partial<PromotionGateThresholds>;
  /** Deterministic bootstrap seed. Same seed + same evidence → same
   *  verdict. */
  bootstrapSeed?: number;
  /** ms timestamp stamped on the decision (injected — pure module). */
  evaluatedAt: number;
}

export interface GateResult {
  id:
    | 'min-pairs-overall'
    | 'min-pairs-per-domain'
    | 'brier-skill'
    | 'log-loss'
    | 'bootstrap-floor'
    | 'safety-replay'
    | 'direct-outcomes';
  pass: boolean;
  /** Human-readable explanation of what was measured and why it
   *  passed/failed. */
  detail: string;
  value?: number;
  threshold?: number;
}

export type PromotionRecommendation = 'promote' | 'hold';

export interface PromotionDecision {
  challengerId: string;
  incumbentId: string;
  recommendation: PromotionRecommendation;
  gates: GateResult[];
  pairCount: number;
  perDomainCounts: Record<string, number>;
  brierChallenger?: number;
  brierIncumbent?: number;
  brierBaseRate?: number;
  logLossChallenger?: number;
  logLossIncumbent?: number;
  bootstrapLowerBound?: number;
  /** Fraction of pairs whose outcome was proxy-resolved. */
  proxyShare: number;
  evaluatedAt: number;
}

// ── Scoring helpers ──────────────────────────────────────────────────

const LOG_LOSS_EPSILON = 1e-6;

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function brierOf(pairs: readonly JoinedPairEvidence[], pick: (e: JoinedPairEvidence) => number): number {
  return mean(pairs.map((e) => (pick(e) - (e.outcome ? 1 : 0)) ** 2));
}

function logLossOf(pairs: readonly JoinedPairEvidence[], pick: (e: JoinedPairEvidence) => number): number {
  return mean(pairs.map((e) => {
    const p = Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, pick(e)));
    return e.outcome ? -Math.log(p) : -Math.log(1 - p);
  }));
}

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D_2B_79_F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Per-pair Brier improvement (incumbent − challenger; positive =
 *  challenger better). */
export function brierImprovementDiffs(pairs: readonly JoinedPairEvidence[]): number[] {
  return pairs.map((e) => {
    const o = e.outcome ? 1 : 0;
    return (e.liveP - o) ** 2 - (e.shadowP - o) ** 2;
  });
}

/** Per-pair log-loss improvement (incumbent − challenger; positive =
 *  challenger better). Probabilities clamped like logLossOf. */
function clampProbability(p: number): number {
  return Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, p));
}

export function logLossImprovementDiffs(pairs: readonly JoinedPairEvidence[]): number[] {
  return pairs.map((e) => {
    const live = clampProbability(e.liveP);
    const shadow = clampProbability(e.shadowP);
    return e.outcome
      ? -Math.log(live) - -Math.log(shadow)
      : -Math.log(1 - live) - -Math.log(1 - shadow);
  });
}

/** Sorted resample means of `diffs` under the deterministic PRNG. */
function bootstrapMeans(diffs: readonly number[], resamples: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    let draws = diffs.length;
    while (draws > 0) {
      sum += diffs[Math.floor(rand() * diffs.length)]!;
      draws -= 1;
    }
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  return means;
}

/**
 * One-sided lower bound of the mean per-pair Brier improvement
 * (incumbent − challenger) via a paired bootstrap: resample pairs with
 * replacement, take the mean improvement of each resample, and return
 * the (1 − confidence) percentile of the resample means.
 */
export function pairedBootstrapLowerBound(
  pairs: readonly JoinedPairEvidence[],
  resamples: number,
  confidence: number,
  seed: number,
): number {
  const means = bootstrapMeans(brierImprovementDiffs(pairs), resamples, seed);
  const idx = Math.min(
    means.length - 1,
    Math.max(0, Math.floor((1 - confidence) * means.length)),
  );
  return means[idx]!;
}

/**
 * Two-sided paired-bootstrap confidence interval of the mean of `diffs`
 * (ACC-403: metric deltas with confidence intervals). Same deterministic
 * PRNG as the gate's lower bound. Returns the ((1−c)/2, (1+c)/2)
 * percentiles of the resample means.
 */
export function pairedBootstrapInterval(
  diffs: readonly number[],
  resamples: number,
  confidence: number,
  seed: number,
): { low: number; high: number } {
  const means = bootstrapMeans(diffs, resamples, seed);
  const clampIdx = (i: number): number =>
    Math.min(means.length - 1, Math.max(0, i));
  const low = means[clampIdx(Math.floor(((1 - confidence) / 2) * means.length))]!;
  const high = means[clampIdx(Math.floor(((1 + confidence) / 2) * means.length))]!;
  return { low, high };
}

// ── Safety replay adapter ────────────────────────────────────────────

const SAFETY_CHECK_KINDS: ReadonlySet<string> = new Set([
  'warning_before_impact',
  'no_silent_signal',
]);

/**
 * Distill a replay harness report into the safety evidence the gate
 * consumes. Fixtures are needed alongside the report because
 * ExpectationResult does not carry the check kind — the fixture's
 * expectation list is the authority on which expectations are
 * safety-critical (warning_before_impact + no_silent_signal).
 */
export function safetyEvidenceFromReplayReport(
  report: ReplayHarnessReport,
  fixtures: readonly ReplayFixture[],
): SafetyReplayEvidence {
  const kindByExpectation = new Map<string, string>();
  for (const fixture of fixtures) {
    for (const e of fixture.expectations) {
      kindByExpectation.set(`${fixture.fixtureId}:${e.id}`, e.check.kind);
    }
  }
  const acc: SafetyAccumulator = { total: 0, passed: 0 };
  for (const fixtureResult of report.results) {
    for (const er of fixtureResult.results) {
      const kind = kindByExpectation.get(`${fixtureResult.fixtureId}:${er.expectationId}`);
      if (kind !== undefined) accumulateSafetyResult(acc, kind, er);
    }
  }
  return {
    safetyCriticalTotal: acc.total,
    safetyCriticalPassed: acc.passed,
    ...(acc.minLeadMs === undefined ? {} : { minLeadTimeMinutes: acc.minLeadMs / 60_000 }),
  };
}

/**
 * ACC-404: safety evidence as a NO-NEW-REGRESSIONS check against the
 * committed replay baseline. The catalog fixtures are intentionally-
 * failing historical-miss cases (their raw pass rate is 0 by design),
 * so raw recall from safetyEvidenceFromReplayReport would fail every
 * promotion forever. The meaningful safety question for a challenger is
 * "did anything get WORSE than the accepted baseline?":
 *
 *   - a safety-relevant fixture counts as passed when its live outcome
 *     matches the baseline, or improved over a baseline 'fail';
 *   - a baseline 'pass' (or unknown fixture) that now fails counts as
 *     a safety regression;
 *   - lead-time evidence comes only from PASSING warning_before_impact
 *     expectations — a historical miss's negative lead never poisons
 *     the floor.
 */
export function safetyEvidenceFromBaselineRegression(
  report: ReplayHarnessReport,
  fixtures: readonly ReplayFixture[],
  baseline: ReplayBaseline,
): SafetyReplayEvidence {
  const safetyFixtureIds = new Set<string>();
  const kindByExpectation = new Map<string, string>();
  for (const fixture of fixtures) {
    for (const e of fixture.expectations) {
      kindByExpectation.set(`${fixture.fixtureId}:${e.id}`, e.check.kind);
      if (SAFETY_CHECK_KINDS.has(e.check.kind)) safetyFixtureIds.add(fixture.fixtureId);
    }
  }
  const acc: SafetyAccumulator = { total: 0, passed: 0 };
  for (const fixtureResult of report.results) {
    if (!safetyFixtureIds.has(fixtureResult.fixtureId)) continue;
    acc.total += 1;
    if (matchesBaseline(fixtureResult.outcome, baseline.fixtures[fixtureResult.fixtureId])) {
      acc.passed += 1;
    }
    accumulatePassingLeadTimes(acc, fixtureResult, kindByExpectation);
  }
  return {
    safetyCriticalTotal: acc.total,
    safetyCriticalPassed: acc.passed,
    ...(acc.minLeadMs === undefined ? {} : { minLeadTimeMinutes: acc.minLeadMs / 60_000 }),
  };
}

/** Matching the accepted baseline — or improving over a baseline
 *  'fail' — is not a regression. */
function matchesBaseline(outcome: string, expected: string | undefined): boolean {
  return outcome === expected || (expected === 'fail' && outcome !== 'fail');
}

function accumulatePassingLeadTimes(
  acc: SafetyAccumulator,
  fixtureResult: ReplayHarnessReport['results'][number],
  kindByExpectation: ReadonlyMap<string, string>,
): void {
  for (const er of fixtureResult.results) {
    const kind = kindByExpectation.get(`${fixtureResult.fixtureId}:${er.expectationId}`);
    if (kind !== 'warning_before_impact' || er.outcome !== 'pass') continue;
    const leadMs = er.pivots?.leadMs;
    if (typeof leadMs === 'number' && (acc.minLeadMs === undefined || leadMs < acc.minLeadMs)) {
      acc.minLeadMs = leadMs;
    }
  }
}

interface SafetyAccumulator {
  total: number;
  passed: number;
  minLeadMs?: number;
}

function accumulateSafetyResult(
  acc: SafetyAccumulator,
  kind: string,
  er: { outcome: string; pivots?: Record<string, number | undefined> },
): void {
  if (!SAFETY_CHECK_KINDS.has(kind)) return;
  if (er.outcome === 'inapplicable') return;
  acc.total += 1;
  if (er.outcome === 'pass') acc.passed += 1;
  const leadMs = er.pivots?.leadMs;
  if (typeof leadMs === 'number' && (acc.minLeadMs === undefined || leadMs < acc.minLeadMs)) {
    acc.minLeadMs = leadMs;
  }
}

// ── Individual gates ─────────────────────────────────────────────────

function gateMinPairsOverall(pairCount: number, t: PromotionGateThresholds): GateResult {
  const pass = pairCount >= t.minPairsOverall;
  return {
    id: 'min-pairs-overall',
    pass,
    value: pairCount,
    threshold: t.minPairsOverall,
    detail: `${pairCount} joined resolved pairs (need ≥ ${t.minPairsOverall}).`,
  };
}

function gateMinPairsPerDomain(
  perDomainCounts: Record<string, number>,
  enabledDomains: readonly string[],
  t: PromotionGateThresholds,
): GateResult {
  if (enabledDomains.length === 0) {
    return {
      id: 'min-pairs-per-domain',
      pass: true,
      threshold: t.minPairsPerDomain,
      detail: 'No enabled domains declared — per-domain minimum not applicable.',
    };
  }
  const short = enabledDomains
    .map((d) => ({ domain: d, count: perDomainCounts[d] ?? 0 }))
    .filter((x) => x.count < t.minPairsPerDomain);
  const pass = short.length === 0;
  const countsSummary = enabledDomains
    .map((d) => `${d}: ${perDomainCounts[d] ?? 0}`)
    .join(', ');
  const shortSummary = short
    .map((x) => `${x.domain} (${x.count}/${t.minPairsPerDomain})`)
    .join(', ');
  return {
    id: 'min-pairs-per-domain',
    pass,
    threshold: t.minPairsPerDomain,
    detail: pass
      ? `Every enabled domain has ≥ ${t.minPairsPerDomain} pairs (${countsSummary}).`
      : `Under-evidenced domains: ${shortSummary}.`,
  };
}

function gateBrierSkill(brierChallenger: number, brierBaseRate: number): GateResult {
  const pass = brierChallenger < brierBaseRate;
  return {
    id: 'brier-skill',
    pass,
    value: brierChallenger,
    threshold: brierBaseRate,
    detail: pass
      ? `Challenger Brier ${brierChallenger.toFixed(4)} beats the base-rate forecaster's ${brierBaseRate.toFixed(4)} — positive skill.`
      : `Challenger Brier ${brierChallenger.toFixed(4)} does not beat the base-rate forecaster's ${brierBaseRate.toFixed(4)} — no skill over always-predicting-the-base-rate.`,
  };
}

function gateLogLoss(logLossChallenger: number, logLossIncumbent: number): GateResult {
  const pass = logLossChallenger <= logLossIncumbent;
  return {
    id: 'log-loss',
    pass,
    value: logLossChallenger,
    threshold: logLossIncumbent,
    detail: pass
      ? `Challenger log loss ${logLossChallenger.toFixed(4)} ≤ incumbent's ${logLossIncumbent.toFixed(4)}.`
      : `Challenger log loss ${logLossChallenger.toFixed(4)} worse than incumbent's ${logLossIncumbent.toFixed(4)} — tail-confidence regression.`,
  };
}

function gateBootstrapFloor(lowerBound: number, t: PromotionGateThresholds): GateResult {
  const pass = lowerBound >= t.noRegressionFloor;
  return {
    id: 'bootstrap-floor',
    pass,
    value: lowerBound,
    threshold: t.noRegressionFloor,
    detail: pass
      ? `Paired-bootstrap ${Math.round(t.bootstrapConfidence * 100)}% lower bound of Brier improvement is ${lowerBound.toFixed(5)} ≥ floor ${t.noRegressionFloor}.`
      : `Paired-bootstrap ${Math.round(t.bootstrapConfidence * 100)}% lower bound of Brier improvement is ${lowerBound.toFixed(5)} < floor ${t.noRegressionFloor} — the improvement is not statistically safe.`,
  };
}

function gateSafetyReplay(safety: SafetyReplayEvidence, t: PromotionGateThresholds): GateResult {
  if (safety.safetyCriticalTotal === 0) {
    return {
      id: 'safety-replay',
      pass: false,
      value: 0,
      threshold: t.minSafetyRecall,
      detail: 'No safety-critical replay expectations ran — absence of safety evidence fails closed.',
    };
  }
  const recall = safety.safetyCriticalPassed / safety.safetyCriticalTotal;
  if (recall < t.minSafetyRecall) {
    return {
      id: 'safety-replay',
      pass: false,
      value: recall,
      threshold: t.minSafetyRecall,
      detail: `Safety replay recall ${safety.safetyCriticalPassed}/${safety.safetyCriticalTotal} below required ${t.minSafetyRecall}.`,
    };
  }
  if (t.minLeadTimeMinutes > 0) {
    if (safety.minLeadTimeMinutes === undefined) {
      return {
        id: 'safety-replay',
        pass: false,
        value: recall,
        threshold: t.minSafetyRecall,
        detail: `Lead-time floor of ${t.minLeadTimeMinutes} min is configured but no fixture produced a lead-time — fails closed.`,
      };
    }
    if (safety.minLeadTimeMinutes < t.minLeadTimeMinutes) {
      return {
        id: 'safety-replay',
        pass: false,
        value: safety.minLeadTimeMinutes,
        threshold: t.minLeadTimeMinutes,
        detail: `Worst warning lead-time ${safety.minLeadTimeMinutes.toFixed(1)} min below the ${t.minLeadTimeMinutes} min floor.`,
      };
    }
  }
  return {
    id: 'safety-replay',
    pass: true,
    value: recall,
    threshold: t.minSafetyRecall,
    detail: `Safety replay recall ${safety.safetyCriticalPassed}/${safety.safetyCriticalTotal}`
      + (safety.minLeadTimeMinutes === undefined
        ? '.'
        : `; worst lead-time ${safety.minLeadTimeMinutes.toFixed(1)} min.`),
  };
}

function gateDirectOutcomes(pairs: readonly JoinedPairEvidence[], proxyShare: number): GateResult {
  const directCount = pairs.filter((e) => e.resolutionKind === 'direct').length;
  const pass = directCount > 0;
  return {
    id: 'direct-outcomes',
    pass,
    value: directCount,
    threshold: 1,
    detail: pass
      ? `${directCount} of ${pairs.length} pairs resolved by direct evidence (proxy share ${(proxyShare * 100).toFixed(1)}%).`
      : 'Every joined outcome is proxy-resolved — a proxy-only cohort can never auto-promote.',
  };
}

// ── Decision ─────────────────────────────────────────────────────────

/**
 * Evaluate every promotion gate and return the explained decision.
 * 'promote' only when ALL gates pass. Purely deterministic: same
 * input + same seed → identical decision.
 */
export function evaluatePromotionGate(input: PromotionGateInput): PromotionDecision {
  const t: PromotionGateThresholds = { ...DEFAULT_PROMOTION_THRESHOLDS, ...input.thresholds };
  const pairs = input.pairs;
  const perDomainCounts: Record<string, number> = {};
  for (const e of pairs) {
    perDomainCounts[e.domain] = (perDomainCounts[e.domain] ?? 0) + 1;
  }
  const proxyShare = pairs.length === 0
    ? 0
    : pairs.filter((e) => e.resolutionKind === 'proxy').length / pairs.length;

  const gates: GateResult[] = [
    gateMinPairsOverall(pairs.length, t),
    gateMinPairsPerDomain(perDomainCounts, input.enabledDomains, t),
  ];

  let brierChallenger: number | undefined;
  let brierIncumbent: number | undefined;
  let brierBaseRate: number | undefined;
  let logLossChallenger: number | undefined;
  let logLossIncumbent: number | undefined;
  let bootstrapLowerBound: number | undefined;

  if (pairs.length > 0) {
    brierChallenger = brierOf(pairs, (e) => e.shadowP);
    brierIncumbent = brierOf(pairs, (e) => e.liveP);
    const baseRate = mean(pairs.map((e) => (e.outcome ? 1 : 0)));
    brierBaseRate = mean(pairs.map((e) => (baseRate - (e.outcome ? 1 : 0)) ** 2));
    logLossChallenger = logLossOf(pairs, (e) => e.shadowP);
    logLossIncumbent = logLossOf(pairs, (e) => e.liveP);
    bootstrapLowerBound = pairedBootstrapLowerBound(
      pairs,
      t.bootstrapResamples,
      t.bootstrapConfidence,
      input.bootstrapSeed ?? 0x40_2A_CC,
    );
    gates.push(
      gateBrierSkill(brierChallenger, brierBaseRate),
      gateLogLoss(logLossChallenger, logLossIncumbent),
      gateBootstrapFloor(bootstrapLowerBound, t),
    );
  } else {
    const noEvidence = (id: GateResult['id'], what: string): GateResult => ({
      id,
      pass: false,
      detail: `No joined pairs — ${what} cannot be computed; fails closed.`,
    });
    gates.push(
      noEvidence('brier-skill', 'Brier skill'),
      noEvidence('log-loss', 'log loss'),
      noEvidence('bootstrap-floor', 'the bootstrap bound'),
    );
  }

  gates.push(
    gateSafetyReplay(input.safety, t),
    gateDirectOutcomes(pairs, proxyShare),
  );

  const recommendation: PromotionRecommendation =
    gates.every((g) => g.pass) ? 'promote' : 'hold';

  return {
    challengerId: input.challengerId,
    incumbentId: input.incumbentId,
    recommendation,
    gates,
    pairCount: pairs.length,
    perDomainCounts,
    ...(brierChallenger === undefined ? {} : { brierChallenger }),
    ...(brierIncumbent === undefined ? {} : { brierIncumbent }),
    ...(brierBaseRate === undefined ? {} : { brierBaseRate }),
    ...(logLossChallenger === undefined ? {} : { logLossChallenger }),
    ...(logLossIncumbent === undefined ? {} : { logLossIncumbent }),
    ...(bootstrapLowerBound === undefined ? {} : { bootstrapLowerBound }),
    proxyShare,
    evaluatedAt: input.evaluatedAt,
  };
}
