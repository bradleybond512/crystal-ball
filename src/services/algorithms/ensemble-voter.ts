/**
 * Multi-Model Ensemble Voting — PR 11.
 *
 * Combine N algorithm decisions for the same domain via F1-weighted
 * voting. The ensemble itself registers as an algorithm so its own
 * decisions are graded too.
 *
 * Pure deterministic. No DOM, no fetch.
 */

import {
  registerAlgorithm,
  getAlgorithm,
  type AlgorithmDefinition,
} from './algorithm-registry.ts';
import type {
  EvaluationRecord,
  
} from './algorithm-evaluation-ledger.ts';

// ── Types ──────────────────────────────────────────────────────────────

export type VotingMode =
  | 'MAJORITY'
  | 'CONSENSUS'
  | 'UNANIMOUS'
  | 'CONFIDENCE_WEIGHTED';

export type EnsembleVerdict = 'fire' | 'hold' | 'undecided';

export interface AlgorithmVote {
  algorithmId: string;
  /** Whether this algorithm voted to fire/alert. */
  decision: boolean;
  /** Confidence in the decision (0..1). */
  confidence: number;
}

export interface EnsembleDecision {
  domain: string;
  votingMode: VotingMode;
  participatingAlgorithms: readonly string[];
  weights: Readonly<Record<string, number>>;
  /** Weighted yes-share (0..1). For CONFIDENCE_WEIGHTED, the
   *  weighted-mean confidence among yes-voters. */
  weightedConfidence: number;
  finalDecision: EnsembleVerdict;
  dissent: readonly AlgorithmVote[];
  generatedAt: number;
}

export interface EnsembleInput {
  domain: string;
  votingMode: VotingMode;
  votes: readonly AlgorithmVote[];
  /** Weights per algorithmId (renormalized internally to sum to 1).
   *  When omitted, equal weights. */
  weights?: Readonly<Record<string, number>>;
  generatedAt?: number;
}

// ── F1 weighting ───────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** F1-flavored score from ledger outcomes over a trailing window.
 *  Defined as 2 * (TP) / (2*TP + FP + FN) with
 *    TP = hits + 0.5 * partials
 *    FP = misses (algorithm's positive call that didn't pan out)
 *    FN = inconclusive (could not be confirmed → treat as miss for safety)
 *  Returns 0 when no graded records in window. */
export function computeF1ForAlgorithm(
  records: readonly EvaluationRecord[],
  algorithmId: string,
  options: { windowMs?: number; now?: number } = {},
): number {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now();
  const cutoff = now - windowMs;

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of records) {
    if (r.algorithmId !== algorithmId) continue;
    if (r.at < cutoff) continue;
    if (!r.outcome) continue;
    if (r.outcome === 'hit') tp += 1;
    else if (r.outcome === 'partial') tp += 0.5;
    else if (r.outcome === 'miss') fp += 1;
    else if (r.outcome === 'inconclusive') fn += 1;
  }
  const denom = 2 * tp + fp + fn;
  return denom === 0 ? 0 : (2 * tp) / denom;
}

/** Build a normalized weight map from F1 scores over the window.
 *  Algorithms with F1=0 receive a tiny floor weight so they still
 *  participate (otherwise the ensemble silently drops them). */
export function computeF1WeightsFromLedger(
  records: readonly EvaluationRecord[],
  algorithmIds: readonly string[],
  options: { windowMs?: number; now?: number; floor?: number } = {},
): Record<string, number> {
  const floor = options.floor ?? 0.05;
  const raw: Record<string, number> = {};
  let total = 0;
  for (const id of algorithmIds) {
    const f1 = computeF1ForAlgorithm(records, id, options);
    const w = Math.max(f1, floor);
    raw[id] = w;
    total += w;
  }
  const out: Record<string, number> = {};
  if (total === 0) {
    const equal = 1 / Math.max(algorithmIds.length, 1);
    for (const id of algorithmIds) out[id] = equal;
    return out;
  }
  for (const id of algorithmIds) out[id] = raw[id]! / total;
  return out;
}

// ── Voting ─────────────────────────────────────────────────────────────

/** Run an ensemble vote. Pure function. */
export function runEnsembleVote(input: EnsembleInput): EnsembleDecision {
  const generatedAt = input.generatedAt ?? Date.now();
  const ids = input.votes.map((v) => v.algorithmId);
  const normalized = normalizeWeights(input.weights, ids);

  let weightedYes = 0;
  let weightedConfidenceYes = 0;
  let totalWeight = 0;
  let yesWeightSum = 0;
  for (const v of input.votes) {
    const w = normalized[v.algorithmId] ?? 0;
    totalWeight += w;
    if (v.decision) {
      weightedYes += w;
      weightedConfidenceYes += w * clamp01(v.confidence);
      yesWeightSum += w;
    }
  }

  const weightedYesShare = totalWeight === 0 ? 0 : weightedYes / totalWeight;
  let weightedConf: number;
  if (input.votingMode === 'CONFIDENCE_WEIGHTED') {
    weightedConf = yesWeightSum === 0 ? 0 : weightedConfidenceYes / yesWeightSum;
  } else {
    weightedConf = weightedYesShare;
  }

  const finalDecision = decideVerdict(input.votingMode, weightedYesShare, weightedConf);

  // Dissent: any vote whose decision differs from the final fire/hold.
  const fired = finalDecision === 'fire';
  const dissent = input.votes.filter((v) => v.decision !== fired);

  return {
    domain: input.domain,
    votingMode: input.votingMode,
    participatingAlgorithms: ids,
    weights: normalized,
    weightedConfidence: weightedConf,
    finalDecision,
    dissent,
    generatedAt,
  };
}

function decideVerdict(
  mode: VotingMode,
  yesShare: number,
  weightedConf: number,
): EnsembleVerdict {
  // Tie-break: anything below the threshold is 'hold' except a clean
  // tie at exactly 0.5 in MAJORITY mode → 'undecided'.
  switch (mode) {
    case 'MAJORITY': {
      if (Math.abs(yesShare - 0.5) < 1e-9) return 'undecided';
      return yesShare > 0.5 ? 'fire' : 'hold';
    }
    case 'CONSENSUS': {
      return yesShare > 0.75 ? 'fire' : 'hold';
    }
    case 'UNANIMOUS': {
      return yesShare >= 1 - 1e-9 ? 'fire' : 'hold';
    }
    case 'CONFIDENCE_WEIGHTED': {
      return weightedConf > 0.5 ? 'fire' : 'hold';
    }
  }
}

function normalizeWeights(
  raw: Readonly<Record<string, number>> | undefined,
  ids: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) {
    const equal = 1 / Math.max(ids.length, 1);
    for (const id of ids) out[id] = equal;
    return out;
  }
  let total = 0;
  for (const id of ids) {
    const w = Math.max(0, raw[id] ?? 0);
    out[id] = w;
    total += w;
  }
  if (total === 0) {
    const equal = 1 / Math.max(ids.length, 1);
    for (const id of ids) out[id] = equal;
    return out;
  }
  for (const id of ids) out[id] = out[id]! / total;
  return out;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Self-registration ─────────────────────────────────────────────────

/** Ensure the ensemble itself is in the algorithm registry so its
 *  decisions are graded by the standard pipeline. Idempotent. */
export function registerEnsembleAlgorithm(
  domain: string,
  options?: { participating: readonly string[] },
): AlgorithmDefinition {
  const participating = options?.participating ?? [];
  const id = `ensemble-${domain}`;
  const existing = getAlgorithm(id);
  const definition: AlgorithmDefinition = {
    id,
    label: `Ensemble (${domain})`,
    version: '1.0.0',
    domain,
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'algorithm_ensemble',
    dependencies: { sources: [], providers: [], services: [...participating] },
    outputs: ['notification_decision'],
    criticality: 'high',
  };
  if (existing) {
    return registerAlgorithm(definition, { replace: true });
  }
  return registerAlgorithm(definition);
}

// ── Last-decision cache (sidecar mirror source) ───────────────────────

const lastDecisionByDomain = new Map<string, EnsembleDecision>();

export function recordEnsembleDecision(decision: EnsembleDecision): void {
  lastDecisionByDomain.set(decision.domain, decision);
}

export function getLastEnsembleDecision(domain: string): EnsembleDecision | undefined {
  return lastDecisionByDomain.get(domain);
}

export function listEnsembleDomains(): string[] {
  return [...lastDecisionByDomain.keys()].sort((a, b) => a.localeCompare(b));
}

export function _resetEnsembleStateForTests(): void {
  lastDecisionByDomain.clear();
}

// Exported so the ledger-domain narrowing can be reused by callers.


export {type AlgorithmDomain} from './algorithm-evaluation-ledger.ts';