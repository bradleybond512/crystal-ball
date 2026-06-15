/**
 * EVOI Collection Planner — PR 9 of the Cognitive Enhancement Plan.
 * docs/COGNITIVE_ENHANCEMENT_PLAN.md, Part C, "PR 9 — Expected-Value-of-Information
 * Collection Planner"
 *
 * Answers: "Which single check would most reduce uncertainty right now?"
 *
 * For each active hypothesis, the planner enumerates candidate observations from
 * three sources:
 *   1. Expected-but-missing signals from negative-evidence (NegativeEvidenceResult)
 *   2. Provider disagreements from provider-redundancy snapshots
 *   3. Open collection gaps from the collection-gap-discovery service
 *
 * Each candidate is scored by expected entropy reduction: how much the hypothesis
 * probability would move under each plausible result, weighted by that result's
 * likelihood (pure Bayesian arithmetic). No LLM calls.
 *
 * Entropy math:
 *   H(p) = -p·log2(p) - (1-p)·log2(1-p)  [binary Shannon entropy, bits]
 *   For a candidate check with two possible outcomes (+) and (−):
 *     P(result=+) = likelihood_positive  (prior-weighted)
 *     p_posterior_given_+ = Bayes update with likelihood ratio LR+
 *     p_posterior_given_− = Bayes update with likelihood ratio LR−
 *   Expected gain = H(p) − [P(+)·H(p_+) + P(−)·H(p_−)]
 *
 * Likelihood ratios per candidate type are encoded as named constants below
 * with explanatory comments. These defaults are calibrated to realistic values
 * from the superforecasting literature and are individually overridable via
 * EvoiContext for testing and future self-tuning (PR 12).
 *
 * Plan invariants:
 *   - Every action includes an explanation stating WHY the check is informative.
 *   - Stale / missing data surfaces rather than disappearing.
 *   - Pure deterministic — no DOM, no fetch, no globals at import time.
 */

import type { HypothesisLike } from './base-rates';
import type { MissingSignal, PendingSignal } from '../intelligence/negative-evidence';
import type { DomainRedundancy } from '../diagnostics/provider-redundancy';
import type { CollectionGap } from '../intelligence/collection-gap-discovery';

// ── Likelihood ratio constants ────────────────────────────────────────────────
//
// All LR values are sensible priors from the superforecasting / diagnostic test
// literature. They encode: "if this candidate check fires positive, how much
// does that update the hypothesis probability?"
//
// LR_POSITIVE: P(result=+|H=true) / P(result=+|H=false)
// LR_NEGATIVE: P(result=−|H=true) / P(result=−|H=false)
//   A strong confirming signal has high LR+ and low LR−.
//   An absence check (if absent → less likely) has high LR−.

/**
 * Missing expected follow-on signal (e.g. crack spread absent after refinery
 * outage). A confirming signal appearing is diagnostic positive (LR+ = 4.0);
 * its continued absence gently reduces escalation probability (LR− = 0.6).
 * Source: calibrated against negative-evidence penalty tuning (PR 2 baseline).
 */
export const LR_MISSING_SIGNAL_POSITIVE = 4;
export const LR_MISSING_SIGNAL_NEGATIVE = 0.6;

/**
 * Pending expected signal (window still open — checking early). Less
 * diagnostic because we can't yet call it "missing". LR reduced accordingly.
 */
export const LR_PENDING_SIGNAL_POSITIVE = 2.5;
export const LR_PENDING_SIGNAL_NEGATIVE = 0.75;

/**
 * Provider disagreement: two sources emit different fingerprints. Resolving
 * which one is correct is highly informative. LR+ when the hypothesis source
 * is right = 3.0; LR− when it's wrong (other source is right) = 0.4.
 */
export const LR_PROVIDER_DISAGREE_POSITIVE = 3;
export const LR_PROVIDER_DISAGREE_NEGATIVE = 0.4;

/**
 * Single-source domain (no backup). Less diagnostic than a disagreement
 * because we're just establishing coverage, not resolving a conflict.
 */
export const LR_SINGLE_SOURCE_POSITIVE = 2;
export const LR_SINGLE_SOURCE_NEGATIVE = 0.7;

/**
 * Open collection gap (stale data, no alerts, low coverage). Filling the
 * gap may reveal confirming or disconfirming information; the LR is moderate
 * because we don't know which direction the new data will point.
 */
export const LR_GAP_HIGH_SEVERITY_POSITIVE = 3.5;
export const LR_GAP_HIGH_SEVERITY_NEGATIVE = 0.5;
export const LR_GAP_MEDIUM_SEVERITY_POSITIVE = 2;
export const LR_GAP_MEDIUM_SEVERITY_NEGATIVE = 0.65;
export const LR_GAP_LOW_SEVERITY_POSITIVE = 1.5;
export const LR_GAP_LOW_SEVERITY_NEGATIVE = 0.8;

// ── Public types ──────────────────────────────────────────────────────────────

export interface CollectionAction {
  /** Short human-readable label for the check ("Check crack spread data"). */
  label: string;
  /** Optional feed or data source to look at. */
  targetFeed?: string;
  /** Panel ID to deep-link to for the check. */
  panelId?: string;
  /** Expected information gain in bits (Shannon entropy reduction). */
  expectedInfoGainBits: number;
  /** Effort required to perform this check. */
  effort: 'glance' | 'minutes' | 'task';
  /**
   * Explanation of WHY this check is informative, including specific numbers.
   * Example: "if crack spread widening is absent after 3d, escalation probability
   * drops from 62% to 41%."
   */
  explanation: string;
}

/**
 * Injectable context bundle for planCollection(). The pure core never imports
 * stateful singletons directly — callers provide the context and the
 * buildEvoiContext() convenience wrapper reads the real services.
 */
export interface EvoiContext {
  /**
   * The hypothesis probability (0–1). planCollection() reads this to compute
   * prior entropy and Bayesian posteriors.
   */
  hypothesisProbability: number;

  /**
   * Missing expected follow-on signals from a NegativeEvidenceResult.
   * These are windows that have already closed without the signal appearing.
   */
  missingSignals?: readonly MissingSignal[];

  /**
   * Pending expected follow-on signals (window still open — worth an early check).
   */
  pendingSignals?: readonly PendingSignal[];

  /**
   * Provider-redundancy domain entries where the verdict is `redundant_disagreement`
   * or `single_source` — i.e. domains where checking an alternate source would be
   * informative.
   */
  providerIssues?: readonly DomainRedundancy[];

  /**
   * Open collection gaps from CollectionGapDiscoveryService.
   */
  collectionGaps?: readonly CollectionGap[];

  /**
   * Optional likelihood-ratio overrides for testing and self-tuning (PR 12).
   * Keys match the exported constant names. Falls back to module defaults.
   */
  likelihoodRatioOverrides?: Partial<LikelihoodRatioOverrides>;
}

export interface LikelihoodRatioOverrides {
  missingSigLrPositive: number;
  missingSigLrNegative: number;
  pendingSigLrPositive: number;
  pendingSigLrNegative: number;
  providerDisagreeLrPositive: number;
  providerDisagreeLrNegative: number;
  singleSourceLrPositive: number;
  singleSourceLrNegative: number;
  gapHighLrPositive: number;
  gapHighLrNegative: number;
  gapMedLrPositive: number;
  gapMedLrNegative: number;
  gapLowLrPositive: number;
  gapLowLrNegative: number;
}

// ── Core entropy math ─────────────────────────────────────────────────────────

/**
 * Binary Shannon entropy in bits.
 *   H(p) = −p·log2(p) − (1−p)·log2(1−p)
 *
 * H(0) = H(1) = 0 bits (no uncertainty at extremes).
 * H(0.5) = 1 bit (maximum uncertainty).
 */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

/**
 * Bayesian posterior after observing a result with likelihood ratio `lr`.
 *
 *   odds_prior = p / (1 − p)
 *   odds_posterior = lr × odds_prior
 *   p_posterior = odds_posterior / (1 + odds_posterior)
 *
 * Clamped to [0.01, 0.99] so the planner never claims certainty.
 */
export function bayesianUpdate(p: number, lr: number): number {
  if (p <= 0) return 0.01;
  if (p >= 1) return 0.99;
  if (lr <= 0) return 0.01;
  const oddsPrior = p / (1 - p);
  const oddsPosterior = lr * oddsPrior;
  const posterior = oddsPosterior / (1 + oddsPosterior);
  return Math.max(0.01, Math.min(0.99, posterior));
}

/**
 * Expected information gain in bits for a binary check.
 *
 * Given prior p and a candidate check with:
 *   lrPositive: likelihood ratio when result is positive (confirming)
 *   lrNegative: likelihood ratio when result is negative (disconfirming)
 *
 * The probability of a positive result (marginalized over prior):
 *   P(result=+) = p·P(+|H=true) + (1−p)·P(+|H=false)
 *
 * Since LR+ = P(+|H=true)/P(+|H=false), we parameterize:
 *   Let P(+|H=false) = x, P(+|H=true) = LR+ × x
 *   Constraint: P(−|H=true) = LR− × P(−|H=false)
 *   Normalizing: P(+|H=true) + P(−|H=true) = 1
 *   → (LR+)·x + LR−·(1−x) = 1
 *   → x·(LR+ − LR−) = 1 − LR−
 *   → x = (1 − LR−) / (LR+ − LR−)  when LR+ ≠ LR−
 *
 * Expected gain = H(p) − [P(+)·H(p|+) + P(−)·H(p|−)]
 */
export function expectedInfoGain(
  p: number,
  lrPositive: number,
  lrNegative: number,
): number {
  const prior = Math.max(0.001, Math.min(0.999, p));
  const hPrior = binaryEntropy(prior);
  if (hPrior < 1e-9) return 0; // p near 0 or 1 — nothing to gain

  // Compute P(+|H=false) = x from normalization constraint.
  const lrDiff = lrPositive - lrNegative;
  if (Math.abs(lrDiff) < 1e-9) {
    // Degenerate case: LR+ ≈ LR− → non-diagnostic check.
    return 0;
  }
  const pPosGivenFalse = Math.max(0.01, Math.min(0.99, (1 - lrNegative) / lrDiff));
  const pPosGivenTrue = Math.max(0.01, Math.min(0.99, lrPositive * pPosGivenFalse));

  // Marginal P(result=+).
  const pPos = prior * pPosGivenTrue + (1 - prior) * pPosGivenFalse;
  const pNeg = 1 - pPos;

  // Bayesian posteriors.
  const pGivenPos = bayesianUpdate(prior, lrPositive);
  const pGivenNeg = bayesianUpdate(prior, lrNegative);

  // Expected posterior entropy.
  const expectedPostH = pPos * binaryEntropy(pGivenPos) + pNeg * binaryEntropy(pGivenNeg);
  const gain = hPrior - expectedPostH;
  return Math.max(0, gain);
}

// ── Effort heuristics ─────────────────────────────────────────────────────────

function effortForGap(gap: CollectionGap): CollectionAction['effort'] {
  if (gap.gapType === 'missing-feed' || gap.gapType === 'stale-data') return 'task';
  if (gap.gapType === 'single-source') return 'minutes';
  return 'glance';
}

function effortForProvider(dr: DomainRedundancy): CollectionAction['effort'] {
  if (dr.verdict === 'redundant_disagreement') return 'minutes';
  return 'glance';
}

// ── Explanation builders ──────────────────────────────────────────────────────

function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function buildMissingSignalExplanation(
  signal: MissingSignal,
  prior: number,
  pIfPresent: number,
  pIfAbsent: number,
): string {
  const label = signal.signal.label;
  const windowSec = Math.round(signal.signal.windowEndMs / 1000);
  const windowLabel = windowSec >= 3600
    ? `${Math.round(windowSec / 3600)}h`
    : `${Math.round(windowSec / 60)} min`;
  return (
    `"${label}" window (${windowLabel}) has closed without observation. ` +
    `If this signal now appears, escalation probability rises from ${fmtPct(prior)} to ~${fmtPct(pIfPresent)}; ` +
    `its confirmed absence reduces it to ~${fmtPct(pIfAbsent)}.`
  );
}

function buildPendingSignalExplanation(
  signal: PendingSignal,
  prior: number,
  pIfPresent: number,
  pIfAbsent: number,
): string {
  const label = signal.signal.label;
  const minRemaining = Math.max(0, Math.round(signal.msUntilWindowEnd / 60_000));
  return (
    `"${label}" expected signal window has ~${minRemaining} min remaining. ` +
    `An early check: if found, probability rises from ${fmtPct(prior)} to ~${fmtPct(pIfPresent)}; ` +
    `if still absent, probability edges down to ~${fmtPct(pIfAbsent)}.`
  );
}

function buildProviderDisagreeExplanation(
  dr: DomainRedundancy,
  prior: number,
  pIfConfirmed: number,
  pIfRefuted: number,
): string {
  return (
    `${dr.domain} providers disagree on the latest fact fingerprint. ` +
    `Resolving which source is correct: if the hypothesis-supporting source is right, ` +
    `probability rises from ${fmtPct(prior)} to ~${fmtPct(pIfConfirmed)}; ` +
    `if the other source is correct, probability falls to ~${fmtPct(pIfRefuted)}.`
  );
}

function buildSingleSourceExplanation(
  dr: DomainRedundancy,
  prior: number,
  pIfConfirmed: number,
  pIfRefuted: number,
): string {
  return (
    `${dr.domain} is single-source — no redundant backup to corroborate. ` +
    `Checking an alternate source: if it confirms, probability rises from ${fmtPct(prior)} to ~${fmtPct(pIfConfirmed)}; ` +
    `if it contradicts, probability falls to ~${fmtPct(pIfRefuted)}.`
  );
}

function buildGapExplanation(
  gap: CollectionGap,
  prior: number,
  pIfFilled: number,
  pIfEmpty: number,
): string {
  return (
    `Collection gap in ${gap.domain} (${gap.gapType}, ${gap.severity} severity): ` +
    `"${gap.description}". Filling this gap: if confirming data is found, ` +
    `probability rises from ${fmtPct(prior)} to ~${fmtPct(pIfFilled)}; ` +
    `if disconfirming, probability falls to ~${fmtPct(pIfEmpty)}.`
  );
}

// ── Core planner ──────────────────────────────────────────────────────────────

const TOP_N = 5;

/**
 * Plan collection actions for a hypothesis given an EvoiContext.
 *
 * Returns up to 5 CollectionAction items sorted descending by
 * expectedInfoGainBits. Each action explains WHY it is informative
 * (plan invariant: every score has an explanation).
 *
 * This function is pure deterministic — injectable context, no singletons,
 * no LLM calls, no DOM access.
 */
export function planCollection(
  // h is the hypothesis this plan is for. Currently used for type context and
  // future per-hypothesis candidate filtering (e.g. domain-scoped gaps).
   
  _h: HypothesisLike & { confidence?: number },
  ctx: EvoiContext,
): CollectionAction[] {
  const p = Math.max(0.01, Math.min(0.99, ctx.hypothesisProbability));
  const lr = resolveLRs(ctx.likelihoodRatioOverrides);
  const actions: CollectionAction[] = [];

  // 1. Missing signals (window closed, signal absent)
  for (const ms of ctx.missingSignals ?? []) {
    const gain = expectedInfoGain(p, lr.missingSigLrPositive, lr.missingSigLrNegative);
    if (gain <= 0) continue;
    const pIfPresent = bayesianUpdate(p, lr.missingSigLrPositive);
    const pIfAbsent = bayesianUpdate(p, lr.missingSigLrNegative);
    actions.push({
      label: `Verify: "${ms.signal.label}"`,
      targetFeed: ms.signal.domain,
      expectedInfoGainBits: roundBits(gain),
      effort: 'glance',
      explanation: buildMissingSignalExplanation(ms, p, pIfPresent, pIfAbsent),
    });
  }

  // 2. Pending signals (window still open — early check)
  for (const ps of ctx.pendingSignals ?? []) {
    const gain = expectedInfoGain(p, lr.pendingSigLrPositive, lr.pendingSigLrNegative);
    if (gain <= 0) continue;
    const pIfPresent = bayesianUpdate(p, lr.pendingSigLrPositive);
    const pIfAbsent = bayesianUpdate(p, lr.pendingSigLrNegative);
    actions.push({
      label: `Watch: "${ps.signal.label}"`,
      targetFeed: ps.signal.domain,
      expectedInfoGainBits: roundBits(gain),
      effort: 'glance',
      explanation: buildPendingSignalExplanation(ps, p, pIfPresent, pIfAbsent),
    });
  }

  // 3. Provider issues (disagreement or single-source)
  for (const dr of ctx.providerIssues ?? []) {
    if (dr.verdict === 'redundant_disagreement') {
      const gain = expectedInfoGain(p, lr.providerDisagreeLrPositive, lr.providerDisagreeLrNegative);
      if (gain <= 0) continue;
      const pIfConf = bayesianUpdate(p, lr.providerDisagreeLrPositive);
      const pIfRef = bayesianUpdate(p, lr.providerDisagreeLrNegative);
      actions.push({
        label: `Resolve ${dr.domain} provider disagreement`,
        targetFeed: dr.domain,
        panelId: 'system-diagnostic',
        expectedInfoGainBits: roundBits(gain),
        effort: effortForProvider(dr),
        explanation: buildProviderDisagreeExplanation(dr, p, pIfConf, pIfRef),
      });
    } else if (dr.verdict === 'single_source' || dr.verdict === 'primary_down_with_backup') {
      const gain = expectedInfoGain(p, lr.singleSourceLrPositive, lr.singleSourceLrNegative);
      if (gain <= 0) continue;
      const pIfConf = bayesianUpdate(p, lr.singleSourceLrPositive);
      const pIfRef = bayesianUpdate(p, lr.singleSourceLrNegative);
      actions.push({
        label: `Cross-check ${dr.domain} with alternate source`,
        targetFeed: dr.domain,
        panelId: 'system-diagnostic',
        expectedInfoGainBits: roundBits(gain),
        effort: effortForProvider(dr),
        explanation: buildSingleSourceExplanation(dr, p, pIfConf, pIfRef),
      });
    }
  }

  // 4. Collection gaps
  for (const gap of ctx.collectionGaps ?? []) {
    let lrPos: number;
    let lrNeg: number;
    if (gap.severity === 'high') {
      lrPos = lr.gapHighLrPositive;
      lrNeg = lr.gapHighLrNegative;
    } else if (gap.severity === 'medium') {
      lrPos = lr.gapMedLrPositive;
      lrNeg = lr.gapMedLrNegative;
    } else {
      lrPos = lr.gapLowLrPositive;
      lrNeg = lr.gapLowLrNegative;
    }
    const gain = expectedInfoGain(p, lrPos, lrNeg);
    if (gain <= 0) continue;
    const pIfFilled = bayesianUpdate(p, lrPos);
    const pIfEmpty = bayesianUpdate(p, lrNeg);
    actions.push({
      label: `Fill ${gap.domain} gap: ${gap.gapType}`,
      targetFeed: gap.domain,
      expectedInfoGainBits: roundBits(gain),
      effort: effortForGap(gap),
      explanation: buildGapExplanation(gap, p, pIfFilled, pIfEmpty),
    });
  }

  // Sort descending by gain, take top 5.
  actions.sort((a, b) => b.expectedInfoGainBits - a.expectedInfoGainBits);
  return actions.slice(0, TOP_N);
}

// ── LR resolution ─────────────────────────────────────────────────────────────

interface ResolvedLRs {
  missingSigLrPositive: number;
  missingSigLrNegative: number;
  pendingSigLrPositive: number;
  pendingSigLrNegative: number;
  providerDisagreeLrPositive: number;
  providerDisagreeLrNegative: number;
  singleSourceLrPositive: number;
  singleSourceLrNegative: number;
  gapHighLrPositive: number;
  gapHighLrNegative: number;
  gapMedLrPositive: number;
  gapMedLrNegative: number;
  gapLowLrPositive: number;
  gapLowLrNegative: number;
}

function resolveLRs(overrides?: Partial<LikelihoodRatioOverrides>): ResolvedLRs {
  return {
    missingSigLrPositive:     overrides?.missingSigLrPositive     ?? LR_MISSING_SIGNAL_POSITIVE,
    missingSigLrNegative:     overrides?.missingSigLrNegative     ?? LR_MISSING_SIGNAL_NEGATIVE,
    pendingSigLrPositive:     overrides?.pendingSigLrPositive     ?? LR_PENDING_SIGNAL_POSITIVE,
    pendingSigLrNegative:     overrides?.pendingSigLrNegative     ?? LR_PENDING_SIGNAL_NEGATIVE,
    providerDisagreeLrPositive: overrides?.providerDisagreeLrPositive ?? LR_PROVIDER_DISAGREE_POSITIVE,
    providerDisagreeLrNegative: overrides?.providerDisagreeLrNegative ?? LR_PROVIDER_DISAGREE_NEGATIVE,
    singleSourceLrPositive:   overrides?.singleSourceLrPositive   ?? LR_SINGLE_SOURCE_POSITIVE,
    singleSourceLrNegative:   overrides?.singleSourceLrNegative   ?? LR_SINGLE_SOURCE_NEGATIVE,
    gapHighLrPositive:        overrides?.gapHighLrPositive        ?? LR_GAP_HIGH_SEVERITY_POSITIVE,
    gapHighLrNegative:        overrides?.gapHighLrNegative        ?? LR_GAP_HIGH_SEVERITY_NEGATIVE,
    gapMedLrPositive:         overrides?.gapMedLrPositive         ?? LR_GAP_MEDIUM_SEVERITY_POSITIVE,
    gapMedLrNegative:         overrides?.gapMedLrNegative         ?? LR_GAP_MEDIUM_SEVERITY_NEGATIVE,
    gapLowLrPositive:         overrides?.gapLowLrPositive         ?? LR_GAP_LOW_SEVERITY_POSITIVE,
    gapLowLrNegative:         overrides?.gapLowLrNegative         ?? LR_GAP_LOW_SEVERITY_NEGATIVE,
  };
}

function roundBits(bits: number): number {
  return Math.round(bits * 10_000) / 10_000;
}

// ── Convenience context builder (thin, non-pure, reads real services) ─────────
//
// This wrapper is the only place that imports stateful singletons. The pure
// planCollection() above never imports them. Keep this section thin.

import type { NegativeEvidenceResult } from '../intelligence/negative-evidence';
import type { ProviderRedundancyReport } from '../diagnostics/provider-redundancy';

/**
 * Build an EvoiContext from the outputs of real services (non-pure).
 *
 * Parameters are the already-computed outputs of the real services so this
 * function stays lightweight — it adapts, not fetches. The caller is
 * responsible for obtaining these snapshots.
 *
 * Provider issues are filtered to only `redundant_disagreement` and
 * `single_source` verdicts (the informationally useful ones).
 */
export function buildEvoiContext(
  hypothesisProbability: number,
  negEvidence?: NegativeEvidenceResult | null,
  providerReport?: ProviderRedundancyReport | null,
  collectionGaps?: readonly CollectionGap[],
  overrides?: Partial<LikelihoodRatioOverrides>,
): EvoiContext {
  const providerIssues = (providerReport?.domains ?? []).filter(
    (d) =>
      d.verdict === 'redundant_disagreement' ||
      d.verdict === 'single_source' ||
      d.verdict === 'primary_down_with_backup',
  );

  return {
    hypothesisProbability,
    missingSignals: negEvidence?.missing ?? [],
    pendingSignals: negEvidence?.pending ?? [],
    providerIssues,
    collectionGaps: collectionGaps ?? [],
    likelihoodRatioOverrides: overrides,
  };
}
