/**
 * Situation-Hypothesis Bridge — Phase 4A PR 2.
 *
 * Wires the observation bus → SituationStoreV2 → CompetitiveHypothesisEngine
 * → AlgorithmEvaluationLedger. Every link already exists as a pure module;
 * this bridge subscribes to `onIngest` and routes events through the chain.
 *
 * Pure module — no DOM, no fetch, no globals at import time. All side
 * effects (onIngest subscription) are set up inside `startSituationHypothesisBridge()`.
 * Boot glue lives in panel-layout.ts only.
 */

import { onIngest } from './observation-store';
import { getSituationStoreV2, type SituationStoreV2 } from './situation-store-v2';
import {
  getCompetitiveHypothesisEngine,
  type CompetitiveHypothesisEngine,
  type EvidenceAlignment,
  type HypothesisType,
} from './competitive-hypothesis';
import { recordAlgorithmEvaluation } from '../algorithms/record-evaluation';
import type { ObservationEvent } from '@/types/intelligence';

// ── Alignment classification ──────────────────────────────────────────────

export interface AlignmentContext {
  /** Source IDs already seen for this situation (before the current event). */
  seenSourceIds: Set<string>;
  /** Number of observations already incorporated (before the current event). */
  prevObsCount: number;
  /** Severity of the most recent prior observation, for decreasing-severity check. */
  prevSeverity?: string;
  /** Primary domain of the situation. */
  situationDomain: string;
  /** Entity IDs on the situation, for cross-domain matching. */
  situationEntityIds: string[];
}

const SEVERITY_RANK: Record<string, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

function isSeverityDecreasing(prev: string, current: string): boolean {
  return (SEVERITY_RANK[prev] ?? 0) > (SEVERITY_RANK[current] ?? 0);
}

/**
 * Deterministic rule table: given an incoming observation and a hypothesis
 * type, return how the observation aligns with that hypothesis.
 *
 * Rule table (evaluated in order; first match wins):
 *   1. New distinct source_id in same domain → supporting for primary (0.6),
 *      neutral for others.
 *   2. Severity decreasing over 2+ updates → supporting for devil-advocate (0.4),
 *      contradicting for primary (0.3), neutral otherwise.
 *   3. Single-source after 3+ updates → supporting for devil-advocate (0.3),
 *      neutral otherwise.
 *   4. Cross-domain observation with entity match → supporting for alternative (0.4),
 *      neutral otherwise.
 *   Default: neutral, weight 0.0.
 */
export function classifyAlignment(
  obs: ObservationEvent,
  hypothesisType: HypothesisType,
  ctx: AlignmentContext,
): { alignment: EvidenceAlignment; weight: number } {
  const isNewSource = !ctx.seenSourceIds.has(obs.sourceId);
  const isSameDomain = obs.domain === ctx.situationDomain;

  // Rule 1: new distinct source_id in same domain+area
  if (isNewSource && isSameDomain) {
    if (hypothesisType === 'primary') return { alignment: 'supporting', weight: 0.6 };
    return { alignment: 'neutral', weight: 0.0 };
  }

  // Rule 2: severity decreasing across 2+ updates
  if (
    ctx.prevObsCount >= 2
    && ctx.prevSeverity !== undefined
    && isSeverityDecreasing(ctx.prevSeverity, obs.severity)
  ) {
    if (hypothesisType === 'devil-advocate') return { alignment: 'supporting', weight: 0.4 };
    if (hypothesisType === 'primary') return { alignment: 'contradicting', weight: 0.3 };
    return { alignment: 'neutral', weight: 0.0 };
  }

  // Rule 3: single-source after 3+ updates (no corroboration)
  if (ctx.prevObsCount >= 3 && ctx.seenSourceIds.size === 1) {
    if (hypothesisType === 'devil-advocate') return { alignment: 'supporting', weight: 0.3 };
    return { alignment: 'neutral', weight: 0.0 };
  }

  // Rule 4: cross-domain observation matching the situation entities
  const entityMatch = obs.entityIds.some((id) => ctx.situationEntityIds.includes(id));
  if (!isSameDomain && entityMatch) {
    if (hypothesisType === 'alternative') return { alignment: 'supporting', weight: 0.4 };
    return { alignment: 'neutral', weight: 0.0 };
  }

  return { alignment: 'neutral', weight: 0.0 };
}

// ── Bridge ────────────────────────────────────────────────────────────────

interface SituationTrackingState {
  startTimeMs: number;
  seenSourceIds: Set<string>;
  prevSeverity: string | undefined;
  obsCount: number;
  evaluated: boolean;
}

export interface BridgeOptions {
  store?: SituationStoreV2;
  engine?: CompetitiveHypothesisEngine;
  clock?: () => number;
  /** Injected recorder; defaults to the real recordAlgorithmEvaluation. */
  recorder?: typeof recordAlgorithmEvaluation;
  /** Injected observation bus; defaults to `onIngest` from observation-store. */
  observationBus?: (listener: (event: ObservationEvent) => void) => (() => void);
}

/**
 * Subscribe to the observation bus and route each event through:
 *   SituationStoreV2.ingest → CompetitiveHypothesisEngine.generate / addEvidence
 *   → AlgorithmEvaluationLedger (on consensus or resolution).
 *
 * Returns an unsubscribe function.
 */
export function startSituationHypothesisBridge(options: BridgeOptions = {}): () => void {
  const store = options.store ?? getSituationStoreV2();
  const engine = options.engine ?? getCompetitiveHypothesisEngine();
  const clock = options.clock ?? (() => Date.now());
  const recorder = options.recorder ?? recordAlgorithmEvaluation;
  const bus = options.observationBus ?? onIngest;

  // Per-situation tracking lives in the closure so each bridge instance is independent.
  const tracked = new Map<string, SituationTrackingState>();

  const unsubscribe = bus((event: ObservationEvent) => {
    // Snapshot existing situation IDs before ingest so we can detect new ones.
    const beforeIds = new Set(store.list().map((s) => s.id));

    // Drive the v2 store's correlation + detection pipeline with this event.
    store.ingest([event]);

    const now = clock();
    const after = store.list();

    for (const sit of after) {
      const isNew = !beforeIds.has(sit.id);
      const alreadyTracked = tracked.has(sit.id);

      if (isNew && !alreadyTracked) {
        // New situation — seed the hypothesis set.
        tracked.set(sit.id, {
          startTimeMs: now,
          seenSourceIds: new Set([event.sourceId]),
          prevSeverity: event.severity,
          obsCount: 1,
          evaluated: false,
        });
        engine.generate(sit.id, sit.domain, sit.severity);
        continue;
      }

      if (!isNew && alreadyTracked) {
        // Check that the v2 store actually absorbed this event into this situation.
        if (!sit.observations.some((o) => o.id === event.id)) continue;

        const state = tracked.get(sit.id)!;
        const currentSet = engine.getSet(sit.id);
        if (!currentSet) continue;

        const ctx: AlignmentContext = {
          seenSourceIds: new Set(state.seenSourceIds),
          prevObsCount: state.obsCount,
          prevSeverity: state.prevSeverity,
          situationDomain: sit.domain,
          situationEntityIds: sit.entityIds,
        };

        // Add evidence to every hypothesis in the set.
        for (const h of currentSet.hypotheses) {
          const { alignment, weight } = classifyAlignment(event, h.type, ctx);
          engine.addEvidence(h.id, { evidenceId: event.id, alignment, weight });
        }

        // Update tracking state after classification.
        state.seenSourceIds.add(event.sourceId);
        state.prevSeverity = event.severity;
        state.obsCount += 1;

        if (state.evaluated) continue;

        // Check for consensus or situation close — emit exactly one evaluation.
        const updatedSet = engine.getSet(sit.id);
        const shouldEvaluate = (updatedSet?.consensusReached === true)
          || sit.status === 'resolved';

        if (shouldEvaluate && updatedSet) {
          state.evaluated = true;
          const leader = updatedSet.leadingHypothesis;
          if (!leader) continue;

          // Flip statuses: leader → supported, sub-floor → refuted.
          for (const h of updatedSet.hypotheses) {
            engine.updateStatus(h.id, h.id === leader.id ? 'supported' : 'refuted');
          }

          const durationMs = now - state.startTimeMs;
          try {
            recorder('competitive-hypothesis', {
              score: leader.confidence,
              label: leader.type,
              durationMs,
              detail: {
                situationId: sit.id,
                domain: sit.domain,
                consensus: updatedSet.consensusReached,
              },
            });
          } catch { /* ledger unavailable — skip silently */ }
        }
      }
    }
  });

  return unsubscribe;
}

// ── Internals exposed for tests ───────────────────────────────────────────

export const __internals = {
  classifyAlignment,
  isSeverityDecreasing,
  SEVERITY_RANK,
};
