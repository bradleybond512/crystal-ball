import type { Hypothesis } from '@/services/analyst-loop';
import type { PCIScore } from './predictive-crisis-index';
import { getProviderSnapshots } from '@/services/insights/insights-state';
import { assessProviderRedundancy } from '@/services/diagnostics/provider-redundancy';
// getBoostMultiplier is deprecated but deliberately retained for the legacy
// pre-recalibration path below until it is fully superseded by getRecalibrator.
// eslint-disable-next-line sonarjs/deprecation
import { getBoostMultiplier, getRecalibrator } from './forecast-calibration-adapter';
import { getCachedAnalogScore } from '@/services/cognition/episodic-memory';
import { signatureFor } from '@/services/hypothesis-feedback';
import { pushRecalibrationPair } from '@/services/cognition/shadow-rollout';

export interface HypothesisForecast {
  hypothesisId: string;
  probability: number;
  trend: 'rising' | 'stable' | 'falling';
  horizon: '6h' | '24h' | '72h';
  components: {
    baseConfidence: number;
    pciBoost: number;
    analogBoost: number;
    providerMultiplier: number;
    calibrationMultiplier: number;
    /** Recalibrated probability before final clamp (added by PR 2). Undefined when no curve is available. */
    recalibratedP?: number;
    /** Signed adjustment from the reliability curve. Zero when identity curve was used. */
    calibrationAdjustment?: number;
    /** Human-readable explanation of the calibration step (plan invariant). Undefined when legacy path used. */
    calibrationExplanation?: string;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function kindToDomain(): string {
  return 'general';
}

// ── Shadow wiring: recalibrated-vs-legacy pair (Prediction Uplift PR A3) ────
//
// forecastHypothesis() is the only point where both probability legs exist —
// the recalibrated (live) value and the pre-recalibration legacy value. Push
// site is compute time, not render time, so a flood cap (1 push per
// signature per hour) bounds shadow-ledger churn regardless of how often the
// HUD re-renders the same hypothesis.

const RECAL_PUSH_INTERVAL_MS = 3_600_000;
const lastRecalPush = new Map<string, number>();

/**
 * Push a recalibrated-vs-legacy probability pair into the shadow-rollout
 * ledger, capped at one push per signature per RECAL_PUSH_INTERVAL_MS. The
 * push itself (`pushRecalibrationPair`) already fails closed on the
 * `shadow-algorithms` kill-switch and swallows its own errors; the try/catch
 * here is a second belt for the injected `push` used in tests.
 */
export function maybePushRecalibrationPair(
  sig: string,
  recalibrated: number,
  legacy: number,
  now: number,
  push: (input: unknown, liveP: number, shadowP: number) => void = pushRecalibrationPair,
): void {
  const last = lastRecalPush.get(sig);
  if (last !== undefined && now - last <= RECAL_PUSH_INTERVAL_MS) return;
  lastRecalPush.set(sig, now);
  if (lastRecalPush.size > 500) {
    const oldest = [...lastRecalPush.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) lastRecalPush.delete(oldest[0]);
  }
  try {
    push(sig, recalibrated, legacy);
  } catch {
    // Shadow accounting must never break forecasting.
  }
}

/** Clear the per-signature push cooldown map (for tests). */
export function _resetRecalPushForTests(): void {
  lastRecalPush.clear();
}

export function forecastHypothesis(
  hypothesis: Hypothesis,
  pci: PCIScore | null,
  analogScore: number | null,
  providerMultiplier = 1,
): HypothesisForecast {
  const baseConfidence = hypothesis.confidence;
  // eslint-disable-next-line sonarjs/deprecation -- legacy path, superseded by recalibration below
  const calibrationMultiplier = getBoostMultiplier();
  const pciBoost = pci !== null && pci.index > 60 ? (pci.index - 60) / 200 : 0;
  const analogBoost = analogScore === null ? 0 : analogScore * 0.1;

  // Pre-recalibration probability (legacy path).
  const rawProbability = clamp(
    (baseConfidence + pciBoost + analogBoost) * calibrationMultiplier * providerMultiplier,
    0,
    1,
  );

  // PR 2 — Closed Calibration Loop: apply per-domain reliability curve as the
  // FINAL step. The recalibrator was built lazily from the ForecastCalibrationStore
  // (rebuilt at most every 10 minutes) and follows the fallback ladder:
  //   domain curve (n≥30) → global pooled curve (n≥50) → identity (no change).
  // The result carries an explanation string (plan invariant: every score has an
  // explanation). The adjustment is appended to the components trail for provenance.
  const recalibrator = getRecalibrator();
  const { p: calibratedP, adjustment, explanation: calibrationExplanation } = recalibrator(rawProbability);

  // Final probability: the calibrated value (already clamped to [0.02, 0.98] by recalibrate()).
  const probability = calibratedP;

  // Shadow wiring (PR A3): both legs exist right here — push a flood-controlled
  // recalibrated-vs-legacy pair. Fire-and-forget; never affects `probability`.
  maybePushRecalibrationPair(signatureFor(hypothesis), calibratedP, rawProbability, Date.now());

  const diff = probability - baseConfidence;
  let trend: HypothesisForecast['trend'] = 'stable';
  if (diff > 0.05) trend = 'rising';
  else if (diff < -0.05) trend = 'falling';

  let horizon: HypothesisForecast['horizon'] = '72h';
  if (hypothesis.risk === 'critical') horizon = '6h';
  else if (hypothesis.risk === 'high') horizon = '24h';

  return {
    hypothesisId: hypothesis.id,
    probability,
    trend,
    horizon,
    components: {
      baseConfidence,
      pciBoost,
      analogBoost,
      providerMultiplier,
      calibrationMultiplier,
      recalibratedP: calibratedP,
      calibrationAdjustment: adjustment,
      calibrationExplanation,
    },
  };
}

export function forecastAll(hypotheses: Hypothesis[], pci: PCIScore | null): HypothesisForecast[] {
  const snapshots = getProviderSnapshots();
  return hypotheses.map(h => {
    let multiplier = 1;
    try {
      if (snapshots.length > 0) {
        const domain = kindToDomain();
        const domainSnapshots = snapshots.filter(s => s.domain === domain);
        if (domainSnapshots.length > 0) {
          const report = assessProviderRedundancy({ snapshots: domainSnapshots });
          const dr = report.domains.find(d => d.domain === domain);
          if (dr !== undefined) multiplier = dr.confidenceMultiplier;
        }
      }
    } catch {
      multiplier = 1;
    }
    // Read the analog score from the module-level cache maintained by
    // updateAnalogCache() in episodic-memory.ts, which runs asynchronously
    // after each analyst cycle. The cache is at most one cycle (5 min) stale.
    // This avoids converting forecastAll's sync signature to async, which would
    // be invasive across many call sites. (Design note per cognition PR 1 spec.)
    const analogScore = getCachedAnalogScore(signatureFor(h));
    return forecastHypothesis(h, pci, analogScore, multiplier);
  });
}
