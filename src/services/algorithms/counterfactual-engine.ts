/**
 * Counterfactual Replay — PR 13.
 *
 * For any graded false positive or false negative, replay the event
 * through every other registered algorithm to see if any of them
 * would have gotten the call right. Surfaces "Algorithm X would have
 * caught this" insights in the diagnostics panel.
 *
 * Pure deterministic given a deterministic algorithm-runner map.
 */

import type { EvaluationOutcome } from './algorithm-evaluation-ledger.ts';

// ── Types ──────────────────────────────────────────────────────────────

export interface CounterfactualEvent {
  eventId: string;
  /** The original ground-truth label for this event:
   *  'fire' = should have fired; 'hold' = should not have fired. */
  groundTruth: 'fire' | 'hold';
  /** Free-form payload the runner uses to decide. The shape is the
   *  caller's responsibility (intelligence layer fact, weather alert,
   *  shortage input, etc). */
  payload: unknown;
  /** ms timestamp the original decision was made. */
  at: number;
}

export interface AlgorithmCounterfactualVote {
  /** The id of the algorithm that voted. */
  id: string;
  /** What this algorithm would have decided when given the event
   *  payload. */
  wouldHaveDecided: 'fire' | 'hold';
  /** 0..1 confidence in the counterfactual decision. */
  confidence: number;
}

export interface CounterfactualResult {
  eventId: string;
  /** The original algorithm whose decision was graded false. */
  falseDecisionAlgorithmId: string;
  /** What the false-decision algorithm decided originally. */
  falseDecisionWas: 'fire' | 'hold';
  /** What the ground truth says the right answer was. */
  groundTruth: 'fire' | 'hold';
  /** Outcome label that triggered the replay (false_positive /
   *  false_negative). */
  outcomeKind: 'false_positive' | 'false_negative';
  /** Counterfactual votes from every alternative algorithm. */
  alternativeAlgorithms: readonly AlgorithmCounterfactualVote[];
  /** Best alternative — the alternative algorithm whose decision
   *  matches ground truth with the highest confidence. Undefined when
   *  no alternative would have decided correctly. */
  bestAlternative?: AlgorithmCounterfactualVote;
  /** One-line insight string for the diagnostics panel. */
  insight: string;
  generatedAt: number;
}

/** A function that produces a counterfactual decision for an event.
 *  Should be pure and fast. */
export type AlgorithmRunner = (
  event: CounterfactualEvent,
) => Pick<AlgorithmCounterfactualVote, 'wouldHaveDecided' | 'confidence'>;

// ── Engine ─────────────────────────────────────────────────────────────

export interface RunCounterfactualInput {
  event: CounterfactualEvent;
  /** The id of the original algorithm whose grade triggered this. */
  falseDecisionAlgorithmId: string;
  /** What the original algorithm decided. */
  falseDecisionWas: 'fire' | 'hold';
  /** Map of algorithmId → runner for ALL registered algorithms. The
   *  engine excludes the false-decision algorithm itself. */
  runners: ReadonlyMap<string, AlgorithmRunner>;
  generatedAt?: number;
}

/** Replay an event through every alternative algorithm. */
export function runCounterfactual(input: RunCounterfactualInput): CounterfactualResult {
  const generatedAt = input.generatedAt ?? Date.now();
  const outcomeKind: CounterfactualResult['outcomeKind'] =
    input.event.groundTruth === 'fire' ? 'false_negative' : 'false_positive';

  const votes: AlgorithmCounterfactualVote[] = [];
  for (const [id, runner] of input.runners) {
    if (id === input.falseDecisionAlgorithmId) continue;
    let result: ReturnType<AlgorithmRunner>;
    try {
      result = runner(input.event);
    } catch {
      // A runner that throws is unhelpful — treat as low-confidence
      // matching the false decision so it doesn't get credit.
      result = { wouldHaveDecided: input.falseDecisionWas, confidence: 0 };
    }
    votes.push({
      id,
      wouldHaveDecided: result.wouldHaveDecided,
      confidence: clamp01(result.confidence),
    });
  }

  // Best = alternative whose decision matches ground truth with the
  // highest confidence. Tie-break: lexicographic on id for determinism.
  const matching = votes.filter((v) => v.wouldHaveDecided === input.event.groundTruth);
  matching.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.id.localeCompare(b.id);
  });
  const bestAlternative = matching[0];

  const insight = buildInsight({
    eventId: input.event.eventId,
    falseDecisionAlgorithmId: input.falseDecisionAlgorithmId,
    outcomeKind,
    bestAlternative,
    alternativeCount: votes.length,
  });

  return {
    eventId: input.event.eventId,
    falseDecisionAlgorithmId: input.falseDecisionAlgorithmId,
    falseDecisionWas: input.falseDecisionWas,
    groundTruth: input.event.groundTruth,
    outcomeKind,
    alternativeAlgorithms: votes,
    bestAlternative,
    insight,
    generatedAt,
  };
}

function buildInsight(args: {
  eventId: string;
  falseDecisionAlgorithmId: string;
  outcomeKind: CounterfactualResult['outcomeKind'];
  bestAlternative: AlgorithmCounterfactualVote | undefined;
  alternativeCount: number;
}): string {
  const verb = args.outcomeKind === 'false_negative' ? 'missed' : 'over-fired';
  if (args.bestAlternative) {
    const conf = (args.bestAlternative.confidence * 100).toFixed(0);
    return `Algorithm "${args.bestAlternative.id}" would have caught this (confidence ${conf}%) — ${args.falseDecisionAlgorithmId} ${verb} event ${args.eventId}.`;
  }
  if (args.alternativeCount === 0) {
    return `${args.falseDecisionAlgorithmId} ${verb} event ${args.eventId}; no alternative algorithms registered to replay against.`;
  }
  return `All ${args.alternativeCount} alternative algorithms also got event ${args.eventId} wrong — consider a new model.`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Auto-trigger hook ─────────────────────────────────────────────────

/** Decide whether a graded outcome warrants a counterfactual replay.
 *  Misses (FN) and false alarms (FP — outcome=miss with original
 *  fire) are the eligible kinds. */
export function shouldRunCounterfactual(outcome: EvaluationOutcome): boolean {
  return outcome === 'miss';
}

// ── Result cache (sidecar mirror source) ──────────────────────────────

const resultsByEvent = new Map<string, CounterfactualResult[]>();

export function recordCounterfactualResult(result: CounterfactualResult): void {
  const list = resultsByEvent.get(result.eventId) ?? [];
  list.push(result);
  resultsByEvent.set(result.eventId, list);
}

export function getCounterfactualsForEvent(eventId: string): CounterfactualResult[] {
  return [...(resultsByEvent.get(eventId) ?? [])];
}

export function listAllCounterfactuals(): Record<string, CounterfactualResult[]> {
  const out: Record<string, CounterfactualResult[]> = {};
  for (const [id, list] of resultsByEvent) out[id] = [...list];
  return out;
}

export function _resetCounterfactualCacheForTests(): void {
  resultsByEvent.clear();
}
