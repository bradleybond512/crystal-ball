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

const perfNow = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

function isSeverityDecreasing(prev: string, current: string): boolean {
  return (SEVERITY_RANK[prev] ?? 0) > (SEVERITY_RANK[current] ?? 0);
}

interface AlignmentResult { alignment: EvidenceAlignment; weight: number }
const NEUTRAL: AlignmentResult = { alignment: 'neutral', weight: 0 };

// Rule 1: new distinct source_id in same domain → supporting for primary only.
function rule1(
  obs: ObservationEvent, type: HypothesisType, ctx: AlignmentContext,
): AlignmentResult | null {
  if (ctx.seenSourceIds.has(obs.sourceId) || obs.domain !== ctx.situationDomain) return null;
  return type === 'primary' ? { alignment: 'supporting', weight: 0.6 } : NEUTRAL;
}

// Rule 2: severity decreasing across 2+ updates → devil-advocate supporting, primary contradicting.
function rule2(
  obs: ObservationEvent, type: HypothesisType, ctx: AlignmentContext,
): AlignmentResult | null {
  if (ctx.prevObsCount < 2 || ctx.prevSeverity === undefined) return null;
  if (!isSeverityDecreasing(ctx.prevSeverity, obs.severity)) return null;
  if (type === 'devil-advocate') return { alignment: 'supporting', weight: 0.4 };
  if (type === 'primary') return { alignment: 'contradicting', weight: 0.3 };
  return NEUTRAL;
}

// Rule 3: single-source after 3+ updates → devil-advocate supporting only.
function rule3(
  _obs: ObservationEvent, type: HypothesisType, ctx: AlignmentContext,
): AlignmentResult | null {
  if (ctx.prevObsCount < 3 || ctx.seenSourceIds.size !== 1) return null;
  return type === 'devil-advocate' ? { alignment: 'supporting', weight: 0.3 } : NEUTRAL;
}

// Rule 4: cross-domain entity match → alternative supporting only.
function rule4(
  obs: ObservationEvent, type: HypothesisType, ctx: AlignmentContext,
): AlignmentResult | null {
  if (obs.domain === ctx.situationDomain) return null;
  if (!obs.entityIds.some((id) => ctx.situationEntityIds.includes(id))) return null;
  return type === 'alternative' ? { alignment: 'supporting', weight: 0.4 } : NEUTRAL;
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
): AlignmentResult {
  return (
    rule1(obs, hypothesisType, ctx)
    ?? rule2(obs, hypothesisType, ctx)
    ?? rule3(obs, hypothesisType, ctx)
    ?? rule4(obs, hypothesisType, ctx)
    ?? NEUTRAL
  );
}

// ── Bridge ────────────────────────────────────────────────────────────────

let _unsubscribe: (() => void) | null = null;
/** Cancels an in-flight drain queue on stop (set by startSituationHypothesisBridge). */
let _cancelQueue: (() => void) | null = null;

interface SituationTrackingState {
  startTimeMs: number;
  seenSourceIds: Set<string>;
  prevSeverity: string | undefined;
  obsCount: number;
  evaluated: boolean;
}

/** Fired once per non-leading hypothesis when a set resolves (PR 14 memory
 *  hygiene hook). Intentionally decoupled from cognition/episodic-memory —
 *  this module stays a pure intelligence-layer bridge with no dependency on
 *  the cognition layer built on top of it; callers (panel-layout.ts) wire
 *  the two together. */
export interface RefutedHypothesisEvent {
  situationId: string;
  domain: string;
  entityIds: string[];
  claim: string;
  hypothesisType: HypothesisType;
}

export interface BridgeOptions {
  store?: SituationStoreV2;
  engine?: CompetitiveHypothesisEngine;
  clock?: () => number;
  runtimeClock?: () => number;
  /** Injected recorder; defaults to the real recordAlgorithmEvaluation. */
  recorder?: typeof recordAlgorithmEvaluation;
  /** Injected observation bus; defaults to `onIngest` from observation-store. */
  observationBus?: (listener: (event: ObservationEvent) => void) => (() => void);
  /** Called once per refuted (non-leading) hypothesis when a set resolves. */
  onHypothesisRefuted?: (event: RefutedHypothesisEvent) => void;
  /**
   * Schedules the next queued-event drain. Defaults to SYNCHRONOUS (`cb => cb()`)
   * so tests and non-boot callers keep exact per-event ordering. The boot wiring
   * (panel-layout) injects `cb => setTimeout(cb, 0)` so a burst of observations
   * (e.g. the boot data-load, which ingests every feed's events at once) yields
   * the main thread between events — the renderer heartbeat + input interleave
   * instead of being starved through a 30s+ situation/hypothesis storm.
   */
  schedule?: (cb: () => void) => void;
}

function seedSituation(
  engine: CompetitiveHypothesisEngine,
  tracked: Map<string, SituationTrackingState>,
  event: ObservationEvent,
  sitId: string,
  domain: string,
  severity: string,
  nowMs: number,
): void {
  tracked.set(sitId, {
    startTimeMs: nowMs,
    seenSourceIds: new Set([event.sourceId]),
    prevSeverity: event.severity,
    obsCount: 1,
    evaluated: false,
  });
  engine.generate(sitId, domain, severity);
}

function addEvidenceToSet(
  engine: CompetitiveHypothesisEngine,
  setId: string,
  event: ObservationEvent,
  ctx: AlignmentContext,
): void {
  const set = engine.getSet(setId);
  if (!set) return;
  for (const h of set.hypotheses) {
    const { alignment, weight } = classifyAlignment(event, h.type, ctx);
    engine.addEvidence(h.id, { evidenceId: event.id, alignment, weight });
  }
}

function maybeEmitEvaluation(
  engine: CompetitiveHypothesisEngine,
  recorder: typeof recordAlgorithmEvaluation,
  state: SituationTrackingState,
  sitId: string,
  sitDomain: string,
  sitEntityIds: readonly string[],
  sitStatus: string,
  nowMs: number,
  processingStartedAtMs: number,
  runtimeClock: () => number,
  onHypothesisRefuted?: (event: RefutedHypothesisEvent) => void,
): void {
  const updatedSet = engine.getSet(sitId);
  if (!updatedSet) return;
  const shouldEvaluate = updatedSet.consensusReached === true || sitStatus === 'resolved';
  if (!shouldEvaluate) return;

  const leader = updatedSet.leadingHypothesis;
  if (!leader) return;

  state.evaluated = true;
  for (const h of updatedSet.hypotheses) {
    const isLeader = h.id === leader.id;
    engine.updateStatus(h.id, isLeader ? 'supported' : 'refuted');
    if (!isLeader && onHypothesisRefuted) {
      try {
        onHypothesisRefuted({
          situationId: sitId,
          domain: sitDomain,
          entityIds: [...sitEntityIds],
          claim: h.claim,
          hypothesisType: h.type,
        });
      } catch { /* hygiene hook is best-effort — never break the bridge */ }
    }
  }

  try {
    recorder('competitive-hypothesis', {
      score: leader.confidence,
      label: leader.type,
      durationMs: Math.max(0, runtimeClock() - processingStartedAtMs),
      detail: {
        situationId: sitId,
        domain: sitDomain,
        consensus: updatedSet.consensusReached,
        timeToConsensusMs: Math.max(0, nowMs - state.startTimeMs),
      },
    });
  } catch { /* ledger unavailable — skip silently */ }
}

/**
 * Subscribe to the observation bus and route each event through:
 *   SituationStoreV2.ingest → CompetitiveHypothesisEngine.generate / addEvidence
 *   → AlgorithmEvaluationLedger (on consensus or resolution).
 *
 * Returns an unsubscribe function. Idempotent — repeated calls return without
 * installing a second subscription.
 */
export function stopSituationHypothesisBridge(): void {
  _unsubscribe?.();
  _cancelQueue?.();
  _unsubscribe = null;
  _cancelQueue = null;
}

export function startSituationHypothesisBridge(options: BridgeOptions = {}): () => void {
  if (_unsubscribe !== null) return stopSituationHypothesisBridge;
  const store = options.store ?? getSituationStoreV2();
  const engine = options.engine ?? getCompetitiveHypothesisEngine();
  const clock = options.clock ?? (() => Date.now());
  const runtimeClock = options.runtimeClock ?? perfNow;
  const recorder = options.recorder ?? recordAlgorithmEvaluation;
  const bus = options.observationBus ?? onIngest;
  const onHypothesisRefuted = options.onHypothesisRefuted;
  const schedule = options.schedule ?? ((cb: () => void): void => { cb(); });

  const tracked = new Map<string, SituationTrackingState>();

  // Per-settle phase timings → the file log (desktop.log). Aggregated across a
  // drain batch and emitted when the queue empties, so the settle-tail cost is
  // attributable (ingest fan-out vs the situation loop) in the field.
  const stats = { events: 0, ingestMs: 0, loopMs: 0, seeded: 0, evidence: 0 };

  // Route each observation through the situation/hypothesis chain. Ingesting an
  // event runs the correlate engine + a full SituationStoreV2 notify fan-out
  // (meta-confidence, counterfactuals, bias, panels…), so this is expensive; a
  // boot burst of events run synchronously here wedged the main thread for 30s+
  // (renderer-watchdog reload loop). The queue below drives this one event per
  // `schedule()` tick so the work yields between events.
  const processEvent = (event: ObservationEvent): void => {
    stats.events += 1;
    const t0 = perfNow();
    const beforeIds = new Set(store.list().map((s) => s.id));
    store.ingest([event]);
    const t1 = perfNow();
    stats.ingestMs += t1 - t0;
    const now = clock();

    for (const sit of store.list()) {
      const isNew = !beforeIds.has(sit.id);
      const state = tracked.get(sit.id);

      if (isNew && !state) {
        seedSituation(engine, tracked, event, sit.id, sit.domain, sit.severity, now);
        stats.seeded += 1;
        continue;
      }

      if (!isNew && state) {
        if (!sit.observations.some((o) => o.id === event.id)) continue;
        const processingStartedAtMs = runtimeClock();
        stats.evidence += 1;

        const ctx: AlignmentContext = {
          seenSourceIds: new Set(state.seenSourceIds),
          prevObsCount: state.obsCount,
          prevSeverity: state.prevSeverity,
          situationDomain: sit.domain,
          situationEntityIds: sit.entityIds,
        };

        addEvidenceToSet(engine, sit.id, event, ctx);
        state.seenSourceIds.add(event.sourceId);
        state.prevSeverity = event.severity;
        state.obsCount += 1;

        if (!state.evaluated) {
          maybeEmitEvaluation(
            engine, recorder, state, sit.id, sit.domain, sit.entityIds, sit.status, now,
            processingStartedAtMs, runtimeClock,
            onHypothesisRefuted,
          );
        }
      }
    }
    stats.loopMs += perfNow() - t1;
  };

  const logSettleStats = (): void => {
    if (stats.events === 0) return;
    // eslint-disable-next-line no-console
    console.warn(`[SETTLE-TIMING] bridge drained ${stats.events} obs in ${Math.round(stats.ingestMs + stats.loopMs)}ms `
      + `(ingest/notify ${Math.round(stats.ingestMs)}ms, situation-loop ${Math.round(stats.loopMs)}ms; `
      + `seeded ${stats.seeded}, evidence ${stats.evidence})`);
    stats.events = 0; stats.ingestMs = 0; stats.loopMs = 0; stats.seeded = 0; stats.evidence = 0;
  };

  // Drain queue: one event per `schedule()` tick. With the synchronous default
  // scheduler this processes each event inline (identical to the old behaviour);
  // with the boot-injected setTimeout scheduler it yields between events. The
  // `draining` guard also serialises re-entrant ingests (a downstream listener
  // that ingests another observation just appends to the queue).
  const queue: ObservationEvent[] = [];
  let draining = false;
  let stopped = false;
  const drain = (): void => {
    if (stopped) { draining = false; return; }
    const event = queue.shift();
    if (event === undefined) { draining = false; logSettleStats(); return; }
    try { processEvent(event); } finally { schedule(drain); }
  };

  _cancelQueue = (): void => { stopped = true; queue.length = 0; draining = false; };

  _unsubscribe = bus((event: ObservationEvent) => {
    if (stopped) return;
    queue.push(event);
    if (!draining) { draining = true; schedule(drain); }
  });

  return stopSituationHypothesisBridge;
}

// ── Internals exposed for tests ───────────────────────────────────────────

export const __internals = {
  classifyAlignment,
  isSeverityDecreasing,
  SEVERITY_RANK,
  /** Test seam: clear the module-level idempotency flag between tests. */
  reset(): void { _unsubscribe = null; },
};
