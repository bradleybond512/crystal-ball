/**
 * Hypothesis → Prediction bridge. Every analyst-loop cycle logs its ranked
 * hypotheses as pending PredictionRecords so the calibration ledger can
 * grade the analyst layer (plan invariant: "every forecast must be logged
 * and later evaluated"). Keyed by feedback signature + a 6h window bucket
 * so successive 5-minute cycles don't spam duplicates.
 *
 * Resolution hook: hypothesis-accuracy calls resolveHypothesisPrediction
 * when it grades hit/miss after the 2-hour window.
 */

import { signatureFor } from '@/services/hypothesis-feedback';
import type { Hypothesis } from '@/services/analyst-loop';
import {
  getCalibrationStore,
  recordPrediction,
  resolvePrediction,
} from './forecast-calibration-adapter';
import type { FactDomain } from './types';

const WINDOW_MS = 6 * 60 * 60 * 1000;        // dedupe bucket
const RESOLVE_HORIZON_MS = 24 * 60 * 60 * 1000; // grading window

export function predictionIdFor(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
  now: number,
): string {
  const bucket = Math.floor(now / WINDOW_MS);
  return `hyp:${signatureFor(h)}:${bucket}`;
}

/** Map a hypothesis to the calibration ledger's FactDomain. Hypotheses
 *  don't carry a domain field, so everything falls to 'other'. The domain
 *  multiplier still accumulates useful signal: "analyst is well-calibrated
 *  on its cross-domain cluster hypotheses overall." */
export function domainForHypothesis(_h: Hypothesis): FactDomain {
  return 'other';
}

export function recordHypothesisPredictions(
  hypotheses: readonly Hypothesis[],
  now: number = Date.now(),
): void {
  const store = getCalibrationStore();
  for (const h of hypotheses) {
    const id = predictionIdFor(h, now);
    if (store.get(id)) continue; // already logged this window
    recordPrediction({
      id,
      sourceId: 'analyst-loop',
      domain: domainForHypothesis(h),
      claim: h.statement,
      probability: Math.max(0, Math.min(1, h.confidence)),
      predictedAt: now,
      resolveBy: now + RESOLVE_HORIZON_MS,
      status: 'pending',
      algorithmVersion: 'analyst-loop-v1',
    });
  }
}

/** Resolve the most recent pending prediction for this hypothesis's
 *  signature. Called by hypothesis-accuracy when it grades hit/miss. */
export function resolveHypothesisPrediction(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
  hit: boolean,
  now: number = Date.now(),
): boolean {
  return resolveHypothesisPredictionBySig(signatureFor(h), hit, now);
}

/** Resolve by pre-computed signature string. Use this from hypothesis-accuracy
 *  which stores the signature at stamp time, avoiding a re-derivation. */
export function resolveHypothesisPredictionBySig(
  sig: string,
  hit: boolean,
  now: number = Date.now(),
): boolean {
  const store = getCalibrationStore();
  const sigPrefix = `hyp:${sig}:`;
  const pending = store.all()
    .filter((r) => r.id.startsWith(sigPrefix) && r.status === 'pending')
    .sort((a, b) => b.predictedAt - a.predictedAt);
  const target = pending[0];
  if (!target) return false;
  return resolvePrediction(target.id, hit, now);
}
