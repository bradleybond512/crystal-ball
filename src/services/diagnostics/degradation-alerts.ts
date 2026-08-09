/**
 * Degradation detector — compares two SystemHealthReport snapshots
 * and emits alerts for health transitions that warrant user attention.
 *
 * Pure: no DOM, no fetch, no Date.now(). The host owns timing and
 * deduplication (session-scoped Set over alert ids).
 *
 * Rules:
 *  1. Feature: healthy→degraded or any→unsafe alerts (unsafe ⇒ safetyCritical).
 *  2. Panel: any→stale or any→failing alerts.
 *  3. Notification pipeline: unsafeSuppressions count increasing alerts.
 *  4. Recovery (degraded→healthy) emits nothing — YAGNI.
 *  5. prev === null emits nothing (first run baseline).
 */

import type { SystemHealthReport, HealthStatus } from './system-health-types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DegradationAlert {
  /** Stable: `${kind}:${subjectId}:${toStatus}` */
  id: string;
  kind: 'feature' | 'panel' | 'notification_pipeline';
  subjectId: string;
  fromStatus: string;
  toStatus: string;
  /** unsafe feature transitions only */
  safetyCritical: boolean;
  headline: string;
}

// ── Detector ─────────────────────────────────────────────────────────────

export function detectDegradations(
  prev: SystemHealthReport | null,
  curr: SystemHealthReport,
): readonly DegradationAlert[] {
  // Rule 5: first run — emit nothing
  if (prev === null) return [];

  const alerts: DegradationAlert[] = [];

  // Rule 1: feature health transitions
  const prevFeatureMap = new Map(prev.features.map((f) => [f.featureId, f]));
  for (const feature of curr.features) {
    const prevFeature = prevFeatureMap.get(feature.featureId);
    const prevStatus: HealthStatus = prevFeature?.status ?? 'unknown';
    const currStatus = feature.status;

    if (currStatus === prevStatus) continue;

    // Alert on degraded or unsafe transitions (not recovery or same-level moves)
    if (currStatus === 'degraded' || currStatus === 'unsafe') {
      const safetyCritical = currStatus === 'unsafe';
      const label = feature.label ?? feature.featureId;
      alerts.push({
        id: `feature:${feature.featureId}:${currStatus}`,
        kind: 'feature',
        subjectId: feature.featureId,
        fromStatus: prevStatus,
        toStatus: currStatus,
        safetyCritical,
        headline: safetyCritical
          ? `Safety-critical feature "${label}" is ${currStatus}`
          : `Feature "${label}" degraded from ${prevStatus} to ${currStatus}`,
      });
    }
  }

  // Rule 2: panel health transitions
  const prevPanelMap = new Map(prev.panels.map((p) => [p.panelId, p]));
  for (const panel of curr.panels) {
    const prevPanel = prevPanelMap.get(panel.panelId);
    const prevStatus: HealthStatus = prevPanel?.status ?? 'unknown';
    const currStatus = panel.status;

    if (currStatus === prevStatus || !panel.enabled || !panel.mounted || !panel.visible) continue;

    if (currStatus === 'stale' || currStatus === 'failing') {
      const label = panel.label ?? panel.panelId;
      alerts.push({
        id: `panel:${panel.panelId}:${currStatus}`,
        kind: 'panel',
        subjectId: panel.panelId,
        fromStatus: prevStatus,
        toStatus: currStatus,
        safetyCritical: false,
        headline: `Panel "${label}" transitioned to ${currStatus}`,
      });
    }
  }

  // Rule 3: unsafeSuppressions count increasing
  const prevUnsafe = prev.notifications.unsafeSuppressions.length;
  const currUnsafe = curr.notifications.unsafeSuppressions.length;
  if (currUnsafe > prevUnsafe) {
    alerts.push({
      id: `notification_pipeline:unsafe_suppressions:${currUnsafe}`,
      kind: 'notification_pipeline',
      subjectId: 'notification_pipeline',
      fromStatus: String(prevUnsafe),
      toStatus: String(currUnsafe),
      safetyCritical: true,
      headline: `${currUnsafe - prevUnsafe} new unsafe notification suppression(s) — safety-critical events were muted`,
    });
  }

  return alerts;
}
