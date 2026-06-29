/**
 * Proxy-signal outcome inference. Short-fuse events (severe weather, covert
 * cyber) rarely get an explicit ground-truth label, so forecast-calibration
 * starves in exactly the domains that need it. This infers an outcome from
 * downstream proxy signals (outage spikes, follow-on alerts, 911 volume) so
 * calibration can resolve predictions that would otherwise expire unlabeled.
 *
 * Pure: no DOM, no fetch, no globals. The caller supplies the observed
 * proxy signals; this only judges. A thin store helper applies the verdict.
 */

import type { ForecastCalibrationStore } from './forecast-calibration.ts';

export type ProxyPolarity = 'confirming' | 'refuting';

export interface ProxySignal {
  id: string;
  polarity: ProxyPolarity;
  /** 0..1 — how strongly this signal indicates (or contradicts) the event. */
  strength: number;
  observedAt: number;
}

export type InferredOutcome = 'resolved_true' | 'resolved_false' | 'unknown';

export interface OutcomeInference {
  outcome: InferredOutcome;
  /** 0..1 — how sure we are, from evidence mass × decisiveness. */
  confidence: number;
  /** (confirming − refuting) / total, in [-1, 1]. */
  netScore: number;
  /** Total evidence mass (sum of strengths). */
  evidence: number;
  rationale: string;
}

export interface InferOptions {
  /** Min |netScore| to commit to true/false. Default 0.3. */
  decisionThreshold?: number;
  /** Min total evidence to claim anything but 'unknown'. Default 0.5. */
  minEvidence?: number;
}

export function inferOutcome(
  signals: readonly ProxySignal[],
  options: InferOptions = {},
): OutcomeInference {
  const decisionThreshold = options.decisionThreshold ?? 0.3;
  const minEvidence = options.minEvidence ?? 0.5;

  let confirming = 0;
  let refuting = 0;
  for (const s of signals) {
    const strength = clamp01(s.strength);
    if (s.polarity === 'confirming') confirming += strength;
    else refuting += strength;
  }
  const evidence = confirming + refuting;
  const netScore = evidence === 0 ? 0 : (confirming - refuting) / evidence;

  if (evidence < minEvidence) {
    return {
      outcome: 'unknown',
      confidence: 0,
      netScore,
      evidence,
      rationale: `Insufficient proxy evidence (${evidence.toFixed(2)} < ${minEvidence}).`,
    };
  }
  if (Math.abs(netScore) < decisionThreshold) {
    return {
      outcome: 'unknown',
      confidence: 0,
      netScore,
      evidence,
      rationale: `Conflicting proxies (net ${netScore.toFixed(2)} within ±${decisionThreshold}).`,
    };
  }

  const outcome: InferredOutcome = netScore > 0 ? 'resolved_true' : 'resolved_false';
  const confidence = clamp01(Math.min(1, evidence) * Math.abs(netScore));
  return {
    outcome,
    confidence,
    netScore,
    evidence,
    rationale: `${outcome === 'resolved_true' ? 'Confirming' : 'Refuting'} proxies dominate (net ${netScore.toFixed(2)}, evidence ${evidence.toFixed(2)}).`,
  };
}

export interface ResolveWithProxyOptions extends InferOptions {
  /** Only resolve when the inference confidence is at least this. Default 0.4. */
  minConfidence?: number;
  when?: number;
}

export interface ProxyResolution {
  resolved: boolean;
  inference: OutcomeInference;
}

/** Resolve a pending prediction in the calibration store IF the proxy
 *  inference is decisive enough. Leaves it pending otherwise (never guesses). */
export function resolveWithProxy(
  store: ForecastCalibrationStore,
  predictionId: string,
  signals: readonly ProxySignal[],
  options: ResolveWithProxyOptions = {},
): ProxyResolution {
  const minConfidence = options.minConfidence ?? 0.4;
  const inference = inferOutcome(signals, options);
  if (inference.outcome === 'unknown' || inference.confidence < minConfidence) {
    return { resolved: false, inference };
  }
  const ok = store.resolve(predictionId, inference.outcome === 'resolved_true', options.when);
  return { resolved: ok, inference };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
