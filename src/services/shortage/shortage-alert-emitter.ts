/**
 * Shortage → UnifiedAlert emitter (pure).
 *
 * Given the current snapshot of commodity entries and the previously-emitted
 * scores, returns a list of `UnifiedAlert` payloads to ingest into the alert
 * store. Fires exactly once per upward crossing of each threshold:
 *
 *   - HIGH      score crosses 70 from below  → severity 'high'
 *   - CRITICAL  score crosses 85 from below  → severity 'critical'
 *
 * "Crossing" means the *current* score is above the threshold and the
 * *previous* score (if any) was at or below it. A panel that re-renders
 * without the score moving will not produce a duplicate alert.
 *
 * The emitter is decoupled from the alert store, the notification-settings
 * gate, and the panel — so it can be exercised with static fixtures.
 */

import type { UnifiedAlert, AlertSeverity } from '@/services/unified-alerts';
import type { ShortageSummaryEntry, FullSetCommodity } from '@/services/shortage/shortage-fullset';

export const SHORTAGE_HIGH_THRESHOLD = 70;
export const SHORTAGE_CRITICAL_THRESHOLD = 85;

const DISPLAY_NAME: Record<FullSetCommodity, string> = {
  'wheat':       'Wheat',
  'corn':        'Corn',
  'rice':        'Rice',
  'soybeans':    'Soybeans',
  'diesel':      'Diesel',
  'gasoline':    'Gasoline',
  'natural-gas': 'Natural Gas',
  'jet-fuel':    'Jet Fuel',
};

/**
 * Inputs: the current entries plus a (commodity → previous score) map.
 * Returns the alerts to emit AND the updated map. The map is intentionally
 * returned so the caller can keep it module-scoped without exposing mutable
 * state inside this module (keeps it pure and reusable from tests).
 */
export interface EmitResult {
  alerts: UnifiedAlert[];
  nextPreviousScores: Map<FullSetCommodity, number>;
}

export function emitShortageAlerts(
  entries: readonly ShortageSummaryEntry[],
  previousScores: ReadonlyMap<FullSetCommodity, number>,
  now: number = Date.now(),
): EmitResult {
  const alerts: UnifiedAlert[] = [];
  const next = new Map(previousScores);
  for (const e of entries) {
    const prev = previousScores.get(e.commodity);
    const crossedCritical = e.riskScore > SHORTAGE_CRITICAL_THRESHOLD
      && (prev === undefined || prev <= SHORTAGE_CRITICAL_THRESHOLD);
    const crossedHigh = !crossedCritical
      && e.riskScore > SHORTAGE_HIGH_THRESHOLD
      && (prev === undefined || prev <= SHORTAGE_HIGH_THRESHOLD);
    if (crossedCritical) alerts.push(buildAlert(e, 'critical', now));
    else if (crossedHigh) alerts.push(buildAlert(e, 'high', now));
    next.set(e.commodity, e.riskScore);
  }
  return { alerts, nextPreviousScores: next };
}

function buildAlert(e: ShortageSummaryEntry, severity: AlertSeverity, now: number): UnifiedAlert {
  const name = DISPLAY_NAME[e.commodity];
  const topDriver = e.primaryDrivers[0] ?? '(no primary driver)';
  const tier = severity === 'critical' ? 'CRITICAL' : 'HIGH';
  return {
    id: `shortage:${e.commodity}:${tier}:${now}`,
    source: 'resource',
    severity,
    title: `${name} shortage risk: ${tier}`,
    body: `Risk score ${e.riskScore.toFixed(0)}/100. ${topDriver}.`,
    timestamp: now,
    relevanceScore: severity === 'critical' ? 95 : 75,
    acknowledged: false,
    pinned: false,
  };
}

/**
 * Map an alert score band to the `NotificationSeverity` accepted by
 * `shouldNotify`. Kept here so the panel doesn't repeat the rule and tests
 * can validate it.
 */
export function severityFromScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score > SHORTAGE_CRITICAL_THRESHOLD) return 'critical';
  if (score > SHORTAGE_HIGH_THRESHOLD) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}
