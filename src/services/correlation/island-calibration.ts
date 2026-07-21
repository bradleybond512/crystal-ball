/**
 * Island calibration — folds the alert-correlator's learning into the
 * shared correlation calibration spine (one ledger, one reliability
 * model), so the notification island stops being a parallel
 * intelligence with a private feedback loop.
 *
 * Each synthesized cluster alert is a prediction under rule id
 * `island:<cause>|<effect>` (rule-as-source, exactly like the live
 * engine's rules since the next-gen PR 2). Outcomes come from what the
 * user actually does with the alert:
 *   pin        → resolved_true  (worth keeping)
 *   fast ack   → resolved_false (dismissed as noise within 10 s)
 *   otherwise  → expires after the horizon (excluded from Brier)
 * The resulting bounded reliability [0.5, 1.5] multiplies the island's
 * confidence alongside its existing pair-feedback multiplier — neutral
 * until ≥5 resolved outcomes, so behavior only shifts with evidence.
 */

import type { UnifiedAlert } from '../unified-alerts';
import type { PredictionRecord } from '../intelligence/forecast-calibration';
import {
  getCorrelationCalibrationStore,
  recordCalibrationPrediction,
  reliabilityForRule,
  resolveCalibrationPrediction,
} from './correlation-calibration';
import { CORR_RULE_SOURCE_PREFIX, factDomainFor, shouldRecordPair } from './correlation-outcomes';

const FAST_ACK_MS = 10_000;
const RESOLVE_HORIZON_MS = 24 * 3_600_000;
const ISLAND_RULE_PREFIX = 'island:';

export function islandRuleId(pairKey: string): string {
  return `${ISLAND_RULE_PREFIX}${pairKey}`;
}

export function islandPredictionId(alertId: string): string {
  return `island|${encodeURIComponent(alertId)}`;
}

/** Record one synthesized island alert as a prediction. Flood-controlled
 *  per rule (shared cap with the live engine's ledger discipline). */
export function recordIslandPrediction(
  alertId: string,
  pairKey: string,
  cause: string,
  confidence: number,
  now: number = Date.now(),
): boolean {
  const store = getCorrelationCalibrationStore();
  const ruleId = islandRuleId(pairKey);
  if (!shouldRecordPair(store.all(), ruleId, now)) return false;
  const prediction: PredictionRecord = {
    id: islandPredictionId(alertId),
    sourceId: `${CORR_RULE_SOURCE_PREFIX}${ruleId}`,
    domain: factDomainFor(cause),
    claim: `Island correlation ${pairKey}: cluster is genuinely related`,
    probability: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    predictedAt: now,
    resolveBy: now + RESOLVE_HORIZON_MS,
    status: 'pending',
  };
  return recordCalibrationPrediction(prediction);
}

/** Learned reliability for an island rule, [0.5, 1.5], neutral <5 resolved. */
export function islandReliability(pairKey: string, now: number = Date.now()): number {
  return reliabilityForRule(islandRuleId(pairKey), now);
}

interface AlertStoreLike {
  getAll(): UnifiedAlert[];
  subscribe(listener: () => void): () => void;
}

/**
 * Watch user actions on island alerts and resolve their predictions.
 * Pure-DI: the store is injected; production wiring passes the
 * unifiedAlertStore singleton from startAlertCorrelator.
 */
export function startIslandOutcomeTracking(
  store: AlertStoreLike,
  now: () => number = () => Date.now(),
): () => void {
  const firstSeen = new Map<string, number>();
  const prevAcked = new Set<string>();
  const prevPinned = new Set<string>();

  const observe = (a: UnifiedAlert, t: number): void => {
    if (!firstSeen.has(a.id)) firstSeen.set(a.id, t);
    const predictionId = islandPredictionId(a.id);
    if (a.pinned && !prevPinned.has(a.id)) {
      prevPinned.add(a.id);
      resolveCalibrationPrediction(predictionId, true, t);
      return;
    }
    if (a.acknowledged && !prevAcked.has(a.id)) {
      prevAcked.add(a.id);
      const seen = firstSeen.get(a.id) ?? t;
      // Only a FAST dismissal is negative evidence; a considered ack
      // after reading is neutral (left to expiry).
      if (t - seen < FAST_ACK_MS) {
        resolveCalibrationPrediction(predictionId, false, t);
      }
    }
  };

  const scan = (): void => {
    const t = now();
    const liveIds = new Set<string>();
    for (const a of store.getAll()) {
      if (a.source !== 'correlation' || !a.correlationPair) continue;
      liveIds.add(a.id);
      observe(a, t);
    }
    // Bound the tracking maps to live island alerts.
    for (const id of firstSeen.keys()) {
      if (!liveIds.has(id)) {
        firstSeen.delete(id);
        prevAcked.delete(id);
        prevPinned.delete(id);
      }
    }
  };

  const unsubscribe = store.subscribe(() => {
    try { scan(); } catch { /* tracking crash isolation */ }
  });
  try { scan(); } catch { /* initial scan isolation */ }
  return () => {
    unsubscribe();
    firstSeen.clear();
    prevAcked.clear();
    prevPinned.clear();
  };
}
