/**
 * Tracked wrappers for the pure intelligence algorithms.
 *
 * The pure modules (`truth-score.ts`, `compound-risk.ts`,
 * `negative-evidence.ts`) stay free of side effects. This file
 * provides opt-in facades that:
 *   1. Call the pure algorithm.
 *   2. Time the call.
 *   3. Record one evaluation into the singleton ledger.
 *   4. Return the result unchanged.
 *
 * Use these from orchestrator-level code (situation engines, briefing
 * pipelines, planners). Do NOT use them inside hot per-fact loops
 * like `situation-clustering`'s member scorer — that would emit one
 * record per cluster member and drown the ledger. The pure functions
 * remain importable for those cases.
 */

import { scoreFact, type TruthScoreContext, defaultContext } from '@/services/intelligence/truth-score';
import { computeCompoundRisk, type CompoundRiskResult, type CompoundRiskInput, type CompoundRiskOptions } from '@/services/intelligence/compound-risk';
import { evaluateNegativeEvidence, type NegativeEvidenceResult, type ExpectedSignal, type NegativeEvidenceOptions } from '@/services/intelligence/negative-evidence';
import type { NormalizedFact, TruthScore } from '@/services/intelligence/types';
import { recordAlgorithmEvaluation } from './record-evaluation';
import { getTunedParam } from './tunable-params-store';

/**
 * Score a single fact and record the call in the ledger.
 *
 * Use sparingly — calling once per fact in a tight loop will emit one
 * record per fact. Prefer recording at the situation/decision level
 * (one record per fused situation, not per member).
 */
export function trackedScoreFact(
  fact: NormalizedFact,
  ctx: TruthScoreContext = defaultContext(),
): TruthScore {
  const startedAt = Date.now();
  const result = scoreFact(fact, ctx);
  recordAlgorithmEvaluation('truth-score', {
    durationMs: Date.now() - startedAt,
    score: result.score,
    label: result.label,
    detail: {
      sourceCount: fact.sources?.length ?? 0,
      domain: fact.domain ?? 'unknown',
      corroboration: result.components?.corroboration,
      disputed: result.disputed,
    },
  });
  return result;
}

/**
 * Run the compound-risk computation and record the call. Records one
 * evaluation per call regardless of how many cluster results come
 * back, with the highest-scoring cluster's score+level surfaced as
 * the headline.
 */
export function trackedComputeCompoundRisk(
  inputs: readonly CompoundRiskInput[],
  options?: CompoundRiskOptions,
): CompoundRiskResult[] {
  const startedAt = Date.now();
  const results = computeCompoundRisk(inputs, options);
  const top = results.reduce<CompoundRiskResult | undefined>(
    (best, curr) => (best === undefined || curr.score > best.score ? curr : best),
    undefined,
  );
  recordAlgorithmEvaluation('compound-risk', {
    durationMs: Date.now() - startedAt,
    score: top?.score,
    label: top?.level,
    detail: {
      inputCount: inputs.length,
      resultCount: results.length,
      memberIds: top?.memberIds?.length ?? 0,
      affectedDomains: top?.affectedDomains?.length ?? 0,
    },
  });
  return results;
}

function negEvidenceLabel(result: NegativeEvidenceResult): 'missing_signals' | 'pending' | 'all_observed' {
  if (result.missing.length > 0) return 'missing_signals';
  if (result.pending.length > 0) return 'pending';
  return 'all_observed';
}

/**
 * Run the negative-evidence engine and record the call. The
 * absence-penalty + missing-signal count is the headline value for
 * the ledger; downstream calibration grades whether the missing
 * signals actually never arrived.
 */
export function trackedEvaluateNegativeEvidence(
  parent: NormalizedFact,
  expected: readonly ExpectedSignal[],
  candidates: readonly NormalizedFact[],
  baseConfidence: number,
  options?: NegativeEvidenceOptions,
): NegativeEvidenceResult {
  const startedAt = Date.now();
  // Read the tuned max-penalty from the store (falls back to the engine's
  // 0.6 default when unset). An explicit caller-supplied maxPenalty still
  // wins, so tests and special call sites can override.
  const maxPenalty = options?.maxPenalty ?? getTunedParam('negative-evidence', 'maxPenalty', 0.6);
  const result = evaluateNegativeEvidence(parent, expected, candidates, baseConfidence, { ...options, maxPenalty });
  recordAlgorithmEvaluation('negative-evidence', {
    durationMs: Date.now() - startedAt,
    score: result.totalAbsencePenalty,
    label: negEvidenceLabel(result),
    detail: {
      expected: expected.length,
      observed: result.observed.length,
      missing: result.missing.length,
      pending: result.pending.length,
      adjustedConfidence: result.adjustedConfidence,
    },
  });
  return result;
}
