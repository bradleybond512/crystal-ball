/**
 * Shadow Mode — PR 6 of the Algorithm Accuracy Enhancement Plan.
 *
 * Lets new/experimental algorithms run alongside live ones, log their
 * decisions to a separate shadow ledger, but never fire alerts or write
 * to the mission ledger. Required quality bar before promotion to live:
 * P >= 0.70, R >= 0.60, F1 >= 0.65 over >= 50 graded events.
 *
 * Pure deterministic. No DOM, no fetch.
 */

import type { EvaluationRecord } from './algorithm-evaluation-ledger';
import type { ResolverVerdict } from './outcome-resolver';
import { extractVerdict } from './outcome-resolver';

// Public types

export interface ShadowDecision {
  algorithmId: string;
  /** Stable id for this decision in the shadow ledger. */
  id: string;
  at: number;
  durationMs: number;
  inputHash?: string;
  score?: number;
  label?: string;
  notes?: string;
  /** Ground truth, populated later by the resolver. */
  outcome?: EvaluationRecord['outcome'];
  outcomeAt?: number;
  outcomeReason?: string;
}

export interface ShadowState {
  /** Algorithms currently running in shadow mode. */
  shadowAlgorithms: Set<string>;
  /** Per-algorithm shadow ledger. */
  decisions: Map<string, ShadowDecision[]>;
}

export interface PromotionCriteria {
  minPrecision: number;
  minRecall: number;
  minF1: number;
  minGradedEvents: number;
}

export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minPrecision: 0.7,
  minRecall: 0.6,
  minF1: 0.65,
  minGradedEvents: 50,
};

export interface PromotionEligibility {
  algorithmId: string;
  eligible: boolean;
  graded: number;
  precision: number;
  recall: number;
  f1: number;
  reasons: string[];
}

// State

const state: ShadowState = {
  shadowAlgorithms: new Set(),
  decisions: new Map(),
};

let nextDecisionId = 1;

// API

export function isShadowAlgorithm(algorithmId: string): boolean {
  return state.shadowAlgorithms.has(algorithmId);
}

export function enableShadowMode(algorithmId: string): void {
  state.shadowAlgorithms.add(algorithmId);
}

export function disableShadowMode(algorithmId: string): void {
  state.shadowAlgorithms.delete(algorithmId);
}

export function listShadowAlgorithms(): string[] {
  return [...state.shadowAlgorithms].sort((a, b) => a.localeCompare(b));
}

export interface RecordShadowDecisionInput {
  algorithmId: string;
  at: number;
  durationMs: number;
  score?: number;
  label?: string;
  notes?: string;
  inputHash?: string;
  id?: string;
}

/**
 * Record a shadow algorithm's decision. Returns null when the algorithm
 * is not registered as shadow (call site can use this to skip the call
 * cheaply when shadow mode is off).
 *
 * Plan invariant: shadow recordings MUST NOT trigger any alert delivery
 * or mission ledger write. Callers achieve that by checking
 * `isShadowAlgorithm(id)` before alert delivery.
 */
export function recordShadowDecision(
  input: RecordShadowDecisionInput,
): ShadowDecision | null {
  if (!isShadowAlgorithm(input.algorithmId)) return null;
  const id = input.id ?? `shadow-${nextDecisionId++}`;
  const decision: ShadowDecision = {
    algorithmId: input.algorithmId,
    id,
    at: input.at,
    durationMs: input.durationMs,
    score: input.score,
    label: input.label,
    notes: input.notes,
    inputHash: input.inputHash,
  };
  const list = state.decisions.get(input.algorithmId) ?? [];
  list.push(decision);
  state.decisions.set(input.algorithmId, list);
  return { ...decision };
}

export function recordShadowOutcome(
  algorithmId: string,
  decisionId: string,
  outcome: EvaluationRecord['outcome'],
  reason: string,
): ShadowDecision {
  const list = state.decisions.get(algorithmId) ?? [];
  const existing = list.find((d) => d.id === decisionId);
  if (!existing) {
    throw new Error(`Unknown shadow decision: ${algorithmId}/${decisionId}`);
  }
  if (existing.outcome) {
    throw new Error(`Shadow decision "${decisionId}" already graded as ${existing.outcome}`);
  }
  existing.outcome = outcome;
  existing.outcomeAt = Date.now();
  existing.outcomeReason = reason;
  return { ...existing };
}

export function listShadowDecisions(algorithmId: string): ShadowDecision[] {
  return (state.decisions.get(algorithmId) ?? []).map((d) => ({ ...d }));
}

export function clearShadowState(): void {
  state.shadowAlgorithms.clear();
  state.decisions.clear();
  nextDecisionId = 1;
}

// Promotion gate

export function evaluatePromotion(
  algorithmId: string,
  decisions: readonly ShadowDecision[],
  criteria: PromotionCriteria = DEFAULT_PROMOTION_CRITERIA,
): PromotionEligibility {
  const graded = decisions.filter((d) => d.outcome !== undefined);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const d of graded) {
    const verdict = (extractVerdict(d.outcomeReason) ?? fallbackVerdict(d)) as ResolverVerdict | null;
    if (verdict === 'TRUE_POSITIVE') tp += 1;
    else if (verdict === 'FALSE_POSITIVE') fp += 1;
    else if (verdict === 'FALSE_NEGATIVE') fn += 1;
  }
  const precision = tp + fp === 0 ? Number.NaN : tp / (tp + fp);
  const recall = tp + fn === 0 ? Number.NaN : tp / (tp + fn);
  const f1 =
    Number.isNaN(precision) || Number.isNaN(recall) || precision + recall === 0
      ? Number.NaN
      : (2 * precision * recall) / (precision + recall);
  const reasons: string[] = [];
  if (graded.length < criteria.minGradedEvents) {
    reasons.push(
      `need >=${criteria.minGradedEvents} graded events, have ${graded.length}`,
    );
  }
  if (Number.isNaN(precision) || precision < criteria.minPrecision) {
    reasons.push(
      `precision ${formatNum(precision)} below floor ${criteria.minPrecision.toFixed(2)}`,
    );
  }
  if (Number.isNaN(recall) || recall < criteria.minRecall) {
    reasons.push(`recall ${formatNum(recall)} below floor ${criteria.minRecall.toFixed(2)}`);
  }
  if (Number.isNaN(f1) || f1 < criteria.minF1) {
    reasons.push(`F1 ${formatNum(f1)} below floor ${criteria.minF1.toFixed(2)}`);
  }
  return {
    algorithmId,
    eligible: reasons.length === 0,
    graded: graded.length,
    precision,
    recall,
    f1,
    reasons,
  };
}

function fallbackVerdict(d: ShadowDecision): ResolverVerdict | null {
  switch (d.outcome) {
    case 'hit':
    case 'partial': {
      return 'TRUE_POSITIVE';
    }
    case 'miss': {
      return typeof d.score === 'number' && d.score >= 0.5
        ? 'FALSE_POSITIVE'
        : 'FALSE_NEGATIVE';
    }
    case 'inconclusive': {
      return 'TRUE_NEGATIVE';
    }
    default: {
      return null;
    }
  }
}

function formatNum(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}
