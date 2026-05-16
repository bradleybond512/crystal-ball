/**
 * Built-in shadow algorithms — two reference variants that demonstrate
 * the ShadowRunner end-to-end.
 *
 *   1. recency-weighted-v2 — same drivers as the production engine
 *      but multiplies the final score by a recency factor:
 *      observations < 2 h old keep 1.0; 2–6 h old drop to 0.8; older
 *      than 6 h drop to 0.6.
 *
 *   2. edge-amplified-v2 — same as production but doubles the edge
 *      bonus (cap stays at 1.0). Tests whether stronger evidence-edge
 *      signals push the final scores into more accurate severity
 *      bands.
 *
 * Both wrap an injected base engine (defaults to the production
 * singleton) so they stay in lock-step with whatever drivers are
 * registered at runtime.
 */

import type { ObservationEvent } from './observation-adapters';
import type { EvidenceEdge } from './situation-store-v2';
import {
  DriverScoringEngine,
  getDriverScoringEngine,
  type DerivedSeverity,
  type EvidenceScore,
} from './driver-scores';
import type { ShadowAlgorithm } from './shadow-runner';

const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const MID_WINDOW_MS = 6 * 60 * 60 * 1000;
const MID_WINDOW_WEIGHT = 0.8;
const STALE_WINDOW_WEIGHT = 0.6;
const EDGE_AMPLIFIER = 2;

const SEVERITY_BANDS: { min: number; severity: DerivedSeverity }[] = [
  { min: 0.8, severity: 'critical' },
  { min: 0.6, severity: 'high' },
  { min: 0.35, severity: 'medium' },
  { min: 0, severity: 'low' },
];

function severityFor(score: number): DerivedSeverity {
  for (const band of SEVERITY_BANDS) {
    if (score >= band.min) return band.severity;
  }
  return 'low';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function recencyMultiplier(obs: ObservationEvent, now: number): number {
  const age = now - obs.timestamp;
  if (age <= RECENT_WINDOW_MS) return 1;
  if (age <= MID_WINDOW_MS) return MID_WINDOW_WEIGHT;
  return STALE_WINDOW_WEIGHT;
}

export interface BuildBuiltInOptions {
  engine?: DriverScoringEngine;
  /** Override Date.now() — defaults to live wall-clock. */
  clock?: () => number;
}

export function buildRecencyWeightedShadow(options: BuildBuiltInOptions = {}): ShadowAlgorithm {
  const engine = options.engine ?? getDriverScoringEngine();
  const clock = options.clock ?? (() => Date.now());
  return {
    id: 'recency-weighted-v2',
    name: 'Recency-Weighted v2',
    description: 'Production drivers + recency multiplier (1.0 / 0.8 / 0.6 at 0-2h / 2-6h / >6h).',
    version: '0.1.0',
    isActive: true,
    score(obs: ObservationEvent, edges?: readonly EvidenceEdge[]): EvidenceScore {
      const base = engine.scoreObservation(obs, edges ?? []);
      const multiplier = recencyMultiplier(obs, clock());
      const adjusted = clamp01(base.finalScore * multiplier);
      return {
        ...base,
        finalScore: adjusted,
        derivedSeverity: severityFor(adjusted),
        explanation: `${base.explanation} · recency multiplier ${multiplier.toFixed(2)} (final ${adjusted.toFixed(3)})`,
      };
    },
  };
}

export function buildEdgeAmplifiedShadow(options: BuildBuiltInOptions = {}): ShadowAlgorithm {
  const engine = options.engine ?? getDriverScoringEngine();
  return {
    id: 'edge-amplified-v2',
    name: 'Edge-Amplified v2',
    description: 'Production drivers + 2× edge bonus (final cap stays at 1.0). Tests whether stronger correlation signals improve severity accuracy.',
    version: '0.1.0',
    isActive: true,
    score(obs: ObservationEvent, edges?: readonly EvidenceEdge[]): EvidenceScore {
      const base = engine.scoreObservation(obs, edges ?? []);
      const amplifiedBonus = clamp01(base.edgeBonus * EDGE_AMPLIFIER);
      const adjusted = clamp01((base.baseScore + amplifiedBonus) * base.attentionMultiplier);
      return {
        ...base,
        edgeBonus: amplifiedBonus,
        finalScore: adjusted,
        derivedSeverity: severityFor(adjusted),
        explanation: `${base.explanation} · edge bonus amplified ${EDGE_AMPLIFIER}× → ${amplifiedBonus.toFixed(3)} (final ${adjusted.toFixed(3)})`,
      };
    },
  };
}

/** Convenience: returns both built-ins. Pass into `runner.registerAlgorithm()`. */
export function builtInShadowAlgorithms(options: BuildBuiltInOptions = {}): ShadowAlgorithm[] {
  return [buildRecencyWeightedShadow(options), buildEdgeAmplifiedShadow(options)];
}

export const __internals = {
  recencyMultiplier,
  severityFor,
  RECENT_WINDOW_MS,
  MID_WINDOW_MS,
  MID_WINDOW_WEIGHT,
  STALE_WINDOW_WEIGHT,
  EDGE_AMPLIFIER,
};
