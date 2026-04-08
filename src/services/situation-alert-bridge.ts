/* eslint-disable sonarjs/void-use */
/**
 * Situation → Alert bridge.
 *
 * The situation engine produces high-quality named Situations with confidence
 * and forecasts, but they live in their own UI silo. This bridge promotes any
 * Situation that reaches the 'developing' or 'active' phase into a unified
 * alert so it shows up in triage, Today, sidebar heat, and God's Vision —
 * with a stable id derived from the situation id (so updates replace, not
 * duplicate).
 */

import { situationEngine } from './situation-engine';
import { unifiedAlertStore, type UnifiedAlert, type AlertSeverity } from './unified-alerts';
import type { Situation } from './situation-types';

function severityFromSituation(s: Situation): AlertSeverity {
  // Combine phase + confidence into a severity bucket.
  if (s.phase === 'active' && s.confidence >= 0.75) return 'critical';
  if (s.phase === 'active') return 'high';
  if (s.phase === 'developing' && s.confidence >= 0.65) return 'high';
  if (s.phase === 'developing') return 'medium';
  return 'low';
}

function toAlert(s: Situation): UnifiedAlert {
  return {
    id: `sit-${s.id}`,
    source: 'correlation',
    severity: severityFromSituation(s),
    title: s.title,
    body: s.summary,
    timestamp: s.lastUpdated,
    location: s.geo.lat !== 0 || s.geo.lon !== 0
      ? { lat: s.geo.lat, lon: s.geo.lon }
      : undefined,
    relevanceScore: Math.round(s.confidence * 100),
    acknowledged: false,
    pinned: false,
  };
}

let started = false;
export function startSituationAlertBridge(): void {
  if (started) return;
  started = true;

  const sync = (): void => {
    const actionable = situationEngine.getActionableSituations();
    if (actionable.length === 0) return;
    const alerts = actionable.map(s => toAlert(s));
    unifiedAlertStore.ingest(alerts);
  };

  // Subscribe + initial sync.
  situationEngine.subscribe(sync);
  window.setTimeout(sync, 3000);
}
