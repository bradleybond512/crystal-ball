/**
 * Notification Dispatcher — standard UnifiedAlert delivery on desktop and web.
 *
 * Features:
 *  - Ghost Mode suppression through the shared window preference
 *  - Rate limiting: max 1 notification per source per 2 minutes
 *  - Quiet hours: per-domain, via notification-settings-service (one rule, R4-BUG-003)
 */

import type { UnifiedAlert, AlertSeverity, AlertSource } from './unified-alerts';
import type { CompoundThreat } from './compound-threat';
import type { Anomaly } from './anomaly-detection';
import { getNotificationModeState, recordGhostSuppression } from './mode-manager';
import {
  evaluateNotificationPreference,
  type NotificationDomain,
} from './notifications/notification-settings-service';
import { getNotificationTraceRegistry } from './diagnostics/diagnostics-state';
import type {
  NotificationUrgency,
  NotificationRung,
  NotificationTraceRegistry,
} from './diagnostics/notification-trace';


// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type NotificationAction = 'sound+banner' | 'banner' | 'badge' | 'silent';


// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Minimum interval between notifications from the same source (ms). */
const RATE_LIMIT_MS = 2 * 60 * 1000; // 2 minutes

/** Coalescing window for convergence alert ids. A `Date.now()` id makes every
 *  refresh look like a brand-new alert, so the store never dedupes it and the
 *  OS notification tag never coalesces — they stack. Bucketing the id by a
 *  location cell + this window collapses repeats of the same convergence. */
const CONVERGENCE_COALESCE_MS = 30 * 60 * 1000; // 30 minutes

let nextTraceId = 1;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Map alert severity to the appropriate notification action. */
export function actionForSeverity(severity: AlertSeverity): NotificationAction {
  if (severity === 'critical') return 'sound+banner';
  if (severity === 'high') return 'banner';
  if (severity === 'medium') return 'badge';
  return 'silent';
}

export function holdNotificationForMode(critical: boolean, state = getNotificationModeState()): string | undefined {
  if (state.preference === 'unknown') return 'mode-unavailable';
  if (state.mode !== 'ghost') return undefined;
  recordGhostSuppression(critical);
  return 'ghost-mode';
}

/** Detect Tauri runtime (desktop app context). */
function isTauriContext(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

// ──────────────────────────────────────────────────────────────────────────────
// Source → domain mapping
// ──────────────────────────────────────────────────────────────────────────────

function alertSourceToDomain(source: AlertSource): NotificationDomain {
  switch (source) {
    case 'nws':
    case 'cyclone':
    case 'spc': { return 'weather';
    }
    case 'gdacs':
    case 'tsunami':
    case 'volcano':
    case 'earthquake': { return 'earthquakes';
    }
    case 'fire': { return 'wildfire';
    }
    case 'aviation-hazard': { return 'aviation';
    }
    case 'maritime': { return 'maritime';
    }
    case 'disease': { return 'biosurveillance';
    }
    case 'space-weather': { return 'space_weather';
    }
    case 'power-grid':
    case 'comms-health':
    case 'resource': { return 'infrastructure';
    }
    case 'oref': // Israeli Color Red — geopolitical/military real-time missile warning
    case 'breaking-news':
    case 'hazard':
    case 'travel-advisory': { return 'geopolitical';
    }
    case 'cyber':
    case 'local-ids':
    case 'radiation':
    case 'air-quality':
    case 'correlation': { return 'cyber';
    }
    default: { return 'geopolitical';
    }
  }
}

function traceDomainFor(domain: NotificationDomain): Parameters<NotificationTraceRegistry['byDomain']>[0] {
  switch (domain) {
    case 'weather': { return 'weather'; }
    case 'cyber': { return 'cyber'; }
    case 'geopolitical': { return 'conflict'; }
    case 'infrastructure': { return 'energy'; }
    default: { return 'other'; }
  }
}

function rungForAction(action: NotificationAction, critical: boolean): NotificationRung {
  if (action === 'silent') return 'silent';
  if (action === 'badge') return 'in_app';
  if (critical) return 'critical';
  if (action === 'sound+banner') return 'banner_sound';
  return 'banner';
}

function urgencyForSeverity(severity: AlertSeverity): NotificationUrgency {
  switch (severity) {
    case 'critical': { return 'critical'; }
    case 'high': { return 'high'; }
    case 'medium': { return 'normal'; }
    default: { return 'low'; }
  }
}

interface DispatchTrace {
  registry: NotificationTraceRegistry;
  candidateId: string;
}

function normalizedTraceScore(score: number): number {
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score / 100)) : 0;
}

function createDispatchTrace(
  alert: UnifiedAlert,
  action: NotificationAction,
  domain: NotificationDomain,
): DispatchTrace | undefined {
  try {
    const registry = getNotificationTraceRegistry();
    const candidateId = `dispatcher-${alert.source}-${alert.id}-${Date.now()}-${nextTraceId++}`;
    registry.register({
      candidateId,
      situationId: alert.id,
      domain: traceDomainFor(domain),
      urgency: urgencyForSeverity(alert.severity),
      confidence: normalizedTraceScore(alert.relevanceScore),
      userRelevance: normalizedTraceScore(alert.relevanceScore),
      safetyCritical: alert.severity === 'critical',
      createdAt: Date.now(),
      headline: alert.title,
    });
    registry.recordEvent(candidateId, {
      kind: 'urgency_check',
      reason: `Severity ${alert.severity}; action ${action}.`,
    });
    return { registry, candidateId };
  } catch {
    return undefined;
  }
}

function suppressTrace(trace: DispatchTrace | undefined, reason: string): void {
  try {
    trace?.registry.suppress(trace.candidateId, reason);
  } catch { /* diagnostics must not block delivery */ }
}

function dispatchTrace(
  trace: DispatchTrace | undefined,
  action: NotificationAction,
  critical: boolean,
): void {
  try {
    trace?.registry.dispatch(trace.candidateId, rungForAction(action, critical));
  } catch { /* diagnostics must not block delivery */ }
}

function recordNativeResult(
  trace: DispatchTrace | undefined,
  result: Parameters<NotificationTraceRegistry['recordNativeResult']>[1],
): void {
  try {
    trace?.registry.recordNativeResult(trace.candidateId, result);
  } catch { /* diagnostics must not block delivery */ }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher class
// ──────────────────────────────────────────────────────────────────────────────

class NotificationDispatcher {
  /** source → last notification timestamp */
  private rateLimitMap = new Map<string, number>();

  /**
 * Dispatch a notification for the given alert.
 *
 * Applies Ghost Mode suppression, rate limiting, and quiet hours before
 * sending a banner through the Web Notifications API.
 */
  dispatchNotification(alert: UnifiedAlert, action: NotificationAction): void {
 const domain = alertSourceToDomain(alert.source);
 const trace = createDispatchTrace(alert, action, domain);

 // ── Silent action — nothing to do ──
 if (action === 'silent') {
 suppressTrace(trace, 'silent-action');
 return;
 }

 // ── Mode — hold covered notifications before preferences and rate limits ──
 const mode = getNotificationModeState();
 const modeHold = holdNotificationForMode(alert.severity === 'critical', mode);
 if (modeHold) {
 suppressTrace(trace, modeHold);
 return;
 }

 // ── Per-domain settings — user's notification preferences ──
 const preference = evaluateNotificationPreference(domain, alert.severity);
 if (!preference.allowed) {
 suppressTrace(trace, preference.reason);
 return;
 }

 // ── Badge-only — no visible notification ──
 if (action === 'badge') {
 dispatchTrace(trace, action, false);
 recordNativeResult(trace, { delivered: true, surface: 'in_app' });
 this.incrementBadge();
 return;
 }

 // ── Rate limiting — max 1 per source per RATE_LIMIT_MS ──
 const now = Date.now();
 const lastTime = this.rateLimitMap.get(alert.source);
 if (alert.severity !== 'critical' && lastTime !== undefined && now - lastTime < RATE_LIMIT_MS) {
 suppressTrace(trace, 'source-rate-limit');
 return;
 }
 this.rateLimitMap.set(alert.source, now);

 // ── Send notification (sound+banner or banner) ──
 void this.sendWebNotification(alert, action, mode.generation, trace);
  }

  /**
   * Dispatch a notification for a compound threat detection.
   * Only fires for critical/high severity compounds.
   */
  dispatchCompoundThreatAlert(threat: CompoundThreat): void {
    if (threat.overallSeverity === 'medium') return;

    const alert: UnifiedAlert = {
      id: `compound-notif-${threat.id}`,
      source: 'correlation',
      severity: threat.overallSeverity === 'critical' ? 'critical' : 'high',
      title: `Compound Threat: ${threat.hazardCategories.join(' + ')}`,
      body: threat.description,
      timestamp: threat.detectedAt.getTime(),
      location: { lat: threat.lat, lon: threat.lon },
      relevanceScore: threat.overallSeverity === 'critical' ? 95 : 75,
      acknowledged: false,
      pinned: false,
    };

    this.dispatchNotification(alert, actionForSeverity(alert.severity));
  }

  /**
   * Dispatch a notification for a critical anomaly detection.
   */
  dispatchAnomalyAlert(anomaly: Anomaly): void {
    if (anomaly.severity !== 'critical') return;

    const alert: UnifiedAlert = {
      id: `anomaly-notif-${anomaly.id}`,
      source: 'correlation',
      severity: 'high',
      title: `Anomaly: ${anomaly.source}`,
      body: anomaly.description,
      timestamp: anomaly.timestamp,
      relevanceScore: 70,
      acknowledged: false,
      pinned: false,
    };

    this.dispatchNotification(alert, 'banner');
  }

  /**
   * Dispatch a notification for weather-threat convergence.
   */
  dispatchConvergenceAlert(description: string, score: number, lat: number, lon: number): void {
    if (score < 70) return;

    // Content-stable id: same convergence (location cell) within the coalescing
    // window reuses one id, so the store dedupes it and the OS tag coalesces
    // instead of stacking a fresh toast every refresh.
    const cell = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const alert: UnifiedAlert = {
      id: `convergence-${cell}-${Math.floor(Date.now() / CONVERGENCE_COALESCE_MS)}`,
      source: 'correlation',
      severity: score >= 85 ? 'critical' : 'high',
      title: 'Weather-Threat Convergence',
      body: description,
      timestamp: Date.now(),
      location: { lat, lon },
      relevanceScore: score,
      acknowledged: false,
      pinned: false,
    };

    this.dispatchNotification(alert, actionForSeverity(alert.severity));
  }

  // The desktop notification plugin is unavailable; both runtimes use Web Notifications.
  private async sendWebNotification(
    alert: UnifiedAlert, action: NotificationAction, generation: number, trace?: DispatchTrace,
  ): Promise<void> {
    const critical = alert.severity === 'critical';
    const finish = (result: Parameters<NotificationTraceRegistry['recordNativeResult']>[1]) => {
      dispatchTrace(trace, action, critical);
      recordNativeResult(trace, result);
    };
    try {
      if (!('Notification' in window)) {
        finish({ delivered: false, surface: 'failed', error: 'notification-api-unavailable' });
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') {
        try {
          permission = await Notification.requestPermission();
        } catch {
          finish({ delivered: false, surface: 'failed', error: 'permission-request-failed' });
          return;
        }
      }
      if (permission !== 'granted') {
        finish({ delivered: false, surface: 'failed', error: 'permission-denied' });
        return;
      }

      const mode = getNotificationModeState();
      const modeHold = holdNotificationForMode(critical, mode);
      if (modeHold || mode.generation !== generation) {
        suppressTrace(trace, modeHold ?? 'mode-changed-during-permission');
        return;
      }
      this.createWebNotification(alert);
      finish({ delivered: true, surface: critical ? 'critical' : 'banner' });
    } catch {
      finish({ delivered: false, surface: 'failed', error: 'notification-delivery-failed' });
    }
  }

  private createWebNotification(alert: UnifiedAlert): void {
 new Notification(alert.title, {
 body: alert.body,
 tag: `wm-${alert.source}-${alert.id}`,
 requireInteraction: alert.severity === 'critical',
 });
  }

  // ── Badge management ───────────────────────────────────────────────────────

  private incrementBadge(): void {
 if (!isTauriContext()) return;
 // Badge management would use a Tauri badge plugin if available.
 // For now this is a no-op placeholder — the badge count is tracked
 // by the unifiedAlertStore.getUnacknowledgedCount() in the UI.
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────────────────────────────────────

export const notificationDispatcher = new NotificationDispatcher();
