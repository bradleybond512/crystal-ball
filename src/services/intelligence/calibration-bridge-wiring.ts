/**
 * Calibration bridge wiring — live call sites for the two dormant
 * prediction bridges (roadmap: docs/PREDICTION_UPLIFT_PLAN.md, PR A1).
 *
 * `mode-forecast-prediction-bridge.ts` and `shortage/shortage-calibration-bridge.ts`
 * are both pure, tested, and fully capable of recording + resolving predictions
 * against the forecast-calibration ledger — but neither had a live call site,
 * so the measurement spine never saw their outputs. This module adds ONLY
 * ordering + gating + call sites; all dedupe ids, thresholds, and resolve
 * windows already live in the bridges themselves.
 *
 * Ordering invariants:
 *   - Resolve runs BEFORE record so a freshly recorded prediction can never
 *     self-resolve in the same tick.
 *   - Bridge-owned settlers (window-close negatives) run BEFORE the generic
 *     `expirePendingPredictions()` cadence, which would otherwise mark the
 *     same overdue records 'expired' (uncounted) instead of resolved false.
 *
 * Gated by the `'calibration-bridges'` cognition switch (fail-safe ON). The
 * generic expiry cadence must never stop even when the switch is off — it
 * grades every domain's predictions, not just these two bridges'.
 *
 * Pure module: no DOM, no fetch, no globals beyond the injected/live deps.
 */

import { isCognitionEnabled } from '../cognition/cognition-settings';
import {
  recordAdvisoryPredictions,
  resolveAdvisoryFromObservation,
  settleExpiredAdvisoryPredictions,
} from './mode-forecast-prediction-bridge';
import { settleExpiredShortagePredictions } from '../shortage/shortage-calibration-bridge';
import { expirePendingPredictions } from './forecast-calibration-adapter';
import type { ModeAdvisory } from '../mode-forecast';

interface ModeWiringDeps {
  resolveFromObservation: typeof resolveAdvisoryFromObservation;
  recordPredictions: typeof recordAdvisoryPredictions;
  enabled: () => boolean;
}

const LIVE_MODE_DEPS: ModeWiringDeps = {
  resolveFromObservation: resolveAdvisoryFromObservation,
  recordPredictions: recordAdvisoryPredictions,
  enabled: () => isCognitionEnabled('calibration-bridges'),
};

/** Resolve every advisory's domain against its own current pressure reading,
 *  then record the batch as pending predictions. Resolve-before-record means
 *  a domain that just escalated grades its *prior* open predictions true —
 *  the one just recorded this tick stays pending until a later observation. */
export function wireModeForecastCalibration(
  snapshot: { advisories: readonly ModeAdvisory[] },
  deps: ModeWiringDeps = LIVE_MODE_DEPS,
): void {
  if (!deps.enabled()) return;
  for (const a of snapshot.advisories) deps.resolveFromObservation(a.domain, a.pressure);
  deps.recordPredictions(snapshot.advisories);
}

interface SettleDeps {
  settleShortage: () => number;
  settleAdvisory: () => number;
  expirePending: () => number;
  enabled: () => boolean;
}

const LIVE_SETTLE_DEPS: SettleDeps = {
  settleShortage: settleExpiredShortagePredictions,
  settleAdvisory: settleExpiredAdvisoryPredictions,
  expirePending: expirePendingPredictions,
  enabled: () => isCognitionEnabled('calibration-bridges'),
};

/** Hourly settle cadence: bridge-owned window-close negatives run first (so
 *  their overdue records resolve false, not just 'expired'), then the
 *  generic expiry sweep for every other domain. The generic sweep always
 *  runs, even with the switch off, and even if a settler throws — it is not
 *  bridge-specific and must never stop. */
export function settleCalibrationBridges(deps: SettleDeps = LIVE_SETTLE_DEPS): void {
  if (!deps.enabled()) { deps.expirePending(); return; }
  try {
    deps.settleShortage();   // bridges settle their own records FALSE first
    deps.settleAdvisory();   // (their comment mandates running before generic expiry)
  } finally {
    deps.expirePending();
  }
}
