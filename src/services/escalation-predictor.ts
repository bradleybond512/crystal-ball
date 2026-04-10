/**
 * Escalation predictor — estimates the probability that a rising alert
 * will reach critical severity based on lifecycle trajectory, current
 * severity, source trust, and entity heat.
 *
 * Used by TriageBar to show "likely to escalate" badges.
 */

import { getLifecycleSamples, getLifecyclePhase } from './alert-lifecycle';
import { getSourceTrust } from './source-trust';
import type { UnifiedAlert } from './unified-alerts';

const ESCALATION_THRESHOLD = 0.7;

export interface EscalationEstimate {
  alertId: string;
  probability: number;
  likelyToEscalate: boolean;
}

const SEV_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/**
 * Estimate escalation probability for a single alert.
 *
 * Factors:
 *  - Trajectory slope (rising = higher probability)
 *  - Current severity (higher base = more likely)
 *  - Source trust (trusted sources = more reliable signals)
 *  - Sample velocity (accelerating = more concerning)
 */
export function estimateEscalation(alert: UnifiedAlert): EscalationEstimate {
  const samples = getLifecycleSamples(alert.id);
  const phase = getLifecyclePhase(alert.id);

  // Base probability from severity.
  const sevBase = (SEV_RANK[alert.severity] ?? 1) / 5;
  let prob = sevBase * 0.3;

  // Trajectory factor.
  if (phase === 'rising') prob += 0.25;
  else if (phase === 'peaked') prob += 0.1;
  else if (phase === 'cooling') prob -= 0.15;

  // Slope from recent samples.
  if (samples.length >= 3) {
    const recent = samples.slice(-3);
    const slope = (recent[2]! - recent[0]!) / Math.max(1, recent[0]!);
    prob += Math.min(0.2, Math.max(-0.1, slope * 0.3));
  }

  // Acceleration: are samples increasing faster?
  if (samples.length >= 4) {
    const s = samples.slice(-4);
    const slope1 = s[1]! - s[0]!;
    const slope2 = s[3]! - s[2]!;
    if (slope2 > slope1 && slope2 > 0) prob += 0.1;
  }

  // Source trust boost.
  const trust = getSourceTrust(alert.source);
  prob *= 0.7 + trust * 0.3;

  // Clamp.
  prob = Math.max(0, Math.min(1, prob));

  return {
    alertId: alert.id,
    probability: Math.round(prob * 100),
    likelyToEscalate: prob >= ESCALATION_THRESHOLD,
  };
}

/** Check multiple alerts and return only those likely to escalate. */
export function getEscalationCandidates(alerts: UnifiedAlert[]): EscalationEstimate[] {
  return alerts
    .map(a => estimateEscalation(a))
    .filter(e => e.likelyToEscalate)
    .sort((a, b) => b.probability - a.probability);
}
