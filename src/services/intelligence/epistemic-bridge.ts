/**
 * Epistemic bridge — Phase 4B PR 1.
 *
 * Live producer for the three epistemic services. Subscribes to
 * SituationStoreV2 and the observation ingest bus and, per situation
 * lifecycle event:
 *   - computes a meta-confidence estimate (how trustworthy is this
 *     situation's reported confidence?),
 *   - generates counterfactuals for high/critical situations ("what
 *     would change my mind?"),
 *   - scans for cognitive-bias signatures (anchoring, availability,
 *     confirmation, recency, overconfidence).
 *
 * Scan policy: a situation is processed when FIRST SEEN or when its
 * SEVERITY ESCALATES; otherwise re-processed at most once per
 * REPROCESS_MIN_MS when updatedAt advances. The cognitive-bias
 * situation scan runs ONLY on first-seen/escalation (the confirmation
 * heuristic default-fires when no contradictions are known, so
 * unbounded re-scanning would flood the advisory ledger).
 *
 * Self-grades through recordAlgorithmEvaluation under the ids
 * 'meta-confidence', 'counterfactual-reasoning', and
 * 'cognitive-bias-detector' (registered in algorithm-registry.ts).
 *
 * Deterministic; injectable store/services/clock/recorder; no DOM,
 * no fetch.
 */

import { getSituationStoreV2 } from './situation-store-v2';
import type { SituationStoreV2, Situation } from './situation-store-v2';
import { onIngest } from './observation-store';
import { getMetaConfidenceService } from './meta-confidence';
import type { MetaConfidenceService } from './meta-confidence';
import { getCounterfactualReasoningService } from './counterfactual-reasoning';
import type { CounterfactualReasoningService } from './counterfactual-reasoning';
import { getCognitiveBiasDetectorService } from './cognitive-bias-detector';
import type { CognitiveBiasDetectorService } from './cognitive-bias-detector';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';
import type { ObservationEvent } from '@/types/intelligence';

// ── Constants ─────────────────────────────────────────────────────────────────

export const REPROCESS_MIN_MS = 5 * 60 * 1000;
export const PRIOR_ESTIMATES_CAP = 20;

const COUNTERFACTUAL_SEVERITIES: ReadonlySet<string> = new Set(['high', 'critical']);

const SEVERITY_RANK: Record<string, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EpistemicBridgeOptions {
  store?: SituationStoreV2;
  meta?: MetaConfidenceService;
  counterfactuals?: CounterfactualReasoningService;
  bias?: CognitiveBiasDetectorService;
  /** Ingest-bus subscription — defaults to observation-store onIngest().
   *  Receives one ObservationEvent at a time (matches onIngest's signature). */
  observationBus?: (listener: (event: ObservationEvent) => void) => () => void;
  clock?: () => number;
  recorder?: typeof recordAlgorithmEvaluation;
}

interface SituationTrack {
  lastProcessedAt: number;
  lastUpdatedAt: number;
  lastSeverity: string;
  priorConfidences: number[];
}

// ── Module-level singleton guard ──────────────────────────────────────────────

let active: { stop: () => void } | null = null;

function updatedAtMs(situation: Situation): number {
  return situation.updatedAt instanceof Date
    ? situation.updatedAt.getTime()
    : Number(situation.updatedAt);
}

// ── Bridge ────────────────────────────────────────────────────────────────────

export function startEpistemicBridge(options: EpistemicBridgeOptions = {}): () => void {
  if (active) return active.stop;

  const store = options.store ?? getSituationStoreV2();
  const meta = options.meta ?? getMetaConfidenceService();
  const counterfactuals = options.counterfactuals ?? getCounterfactualReasoningService();
  const bias = options.bias ?? getCognitiveBiasDetectorService();
  const bus = options.observationBus ?? onIngest;
  const clock = options.clock ?? (() => Date.now());
  const recorder = options.recorder ?? recordAlgorithmEvaluation;

  const tracks = new Map<string, SituationTrack>();

  function processSituation(s: Situation, track: SituationTrack | undefined, now: number): void {
    const firstSeen = track === undefined;
    const escalated = !firstSeen
      && (SEVERITY_RANK[s.severity] ?? 0) > (SEVERITY_RANK[track.lastSeverity] ?? 0);
    const updated = !firstSeen && updatedAtMs(s) > track.lastUpdatedAt;
    const throttleOk = firstSeen || now - track.lastProcessedAt >= REPROCESS_MIN_MS;
    if (!firstSeen && !escalated && !(updated && throttleOk)) return;

    const next: SituationTrack = track ?? {
      lastProcessedAt: 0,
      lastUpdatedAt: 0,
      lastSeverity: s.severity,
      priorConfidences: [],
    };

    // Observations are embedded on the v2 Situation directly
    const observations: ObservationEvent[] = (s.observations as ObservationEvent[]) ?? [];

    // 1. Meta-confidence estimate.
    try {
      const t0 = clock();
      const estimate = meta.estimate({
        targetId: s.id,
        targetType: 'situation',
        reportedConfidence: s.confidence,
        observations,
        priorEstimates: [...next.priorConfidences],
      });
      recorder('meta-confidence', {
        durationMs: clock() - t0,
        score: estimate.metaConfidence,
        label: estimate.reliability,
        detail: { targetId: s.id, sampleSize: estimate.sampleSize },
      });
    } catch { /* never break the pipeline on epistemic failure */ }

    // 2. Counterfactual generation — high/critical only; generate() is
    //    idempotent by assessmentId so repeats are free.
    if (COUNTERFACTUAL_SEVERITIES.has(s.severity)) {
      try {
        const t0 = clock();
        const set = counterfactuals.generate(s.id, s.id, s.domain, s.summary);
        recorder('counterfactual-reasoning', {
          durationMs: clock() - t0,
          score: set.highPlausibilityCount / Math.max(1, set.counterfactuals.length),
          label: `open:${set.openCount}`,
          detail: { situationId: s.id, count: set.counterfactuals.length },
        });
      } catch { /* isolated */ }
    }

    // 3. Cognitive-bias situation scan — first-seen / escalation only.
    if (firstSeen || escalated) {
      try {
        const t0 = clock();
        const corroborating = new Set(
          observations.map((o) => o.domain).filter((d) => d !== s.domain),
        ).size;
        // Cast is safe: scanSituation only accesses id, confidence, domain, severity
        const fired = bias.scanSituation(
          s as unknown as Parameters<CognitiveBiasDetectorService['scanSituation']>[0],
          { corroboratingDomainCount: corroborating },
        );
        recorder('cognitive-bias-detector', {
          durationMs: clock() - t0,
          score: Math.min(1, fired.length / 3),
          label: fired.length === 0 ? 'clean' : fired.map((d) => d.biasType).join(','),
          detail: { targetId: s.id, detections: fired.length },
        });
      } catch { /* isolated */ }
    }

    next.priorConfidences.push(s.confidence);
    if (next.priorConfidences.length > PRIOR_ESTIMATES_CAP) {
      next.priorConfidences.splice(0, next.priorConfidences.length - PRIOR_ESTIMATES_CAP);
    }
    next.lastProcessedAt = now;
    next.lastUpdatedAt = updatedAtMs(s);
    next.lastSeverity = s.severity;
    tracks.set(s.id, next);
  }

  const unsubscribeStore = store.subscribeView((situations) => {
    const now = clock();
    for (const s of situations) {
      processSituation(s, tracks.get(s.id), now);
    }
  });

  // Recency-bias observation scan — CRITICAL only, pre-filter cheap.
  const unsubscribeBus = bus((event) => {
    if ((event.severity as string) !== 'CRITICAL') return;
    try { bias.scanObservation(event); } catch { /* isolated */ }
  });

  const stop = (): void => {
    unsubscribeStore();
    unsubscribeBus();
    tracks.clear();
    active = null;
  };
  active = { stop };
  return stop;
}

export function stopEpistemicBridge(): void {
  active?.stop();
}

export const __internals = {
  REPROCESS_MIN_MS,
  PRIOR_ESTIMATES_CAP,
  COUNTERFACTUAL_SEVERITIES,
  SEVERITY_RANK,
};
