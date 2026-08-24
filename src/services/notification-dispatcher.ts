/**
 * Notification Dispatcher — macOS native + web fallback
 *
 * Routes UnifiedAlert notifications through Tauri's native notification plugin
 * when running as a desktop app, or falls back to the Web Notifications API
 * in browser contexts.
 *
 * Features:
 *  - Ghost Mode suppression (reads `wm-app-mode` from localStorage)
 *  - Rate limiting: max 1 notification per source per 2 minutes
 *  - Quiet hours: suppresses non-critical alerts during configured hours
 */

import type { UnifiedAlert, AlertSeverity, AlertSource } from './unified-alerts';
import type { CompoundThreat } from './compound-threat';
import type { Anomaly } from './anomaly-detection';
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

interface QuietHoursConfig {
  enabled: boolean;
  start: string; // "HH:MM" 24h format
  end: string; // "HH:MM" 24h format
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MODE_STORAGE_KEY = 'wm-app-mode';
const QUIET_HOURS_KEY = 'wm-quiet-hours';

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

/** Parse "HH:MM" into minutes since midnight. Returns NaN on bad input. */
function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 2) return Number.NaN;
  const h = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return Number.NaN;
  return h * 60 + m;
}

/** Check whether the current time falls within quiet hours. */
function isQuietHoursActive(): boolean {
  try {
 const raw = localStorage.getItem(QUIET_HOURS_KEY);
 if (!raw) return false;
 const config = JSON.parse(raw) as QuietHoursConfig;
 if (!config.enabled) return false;

 const startMin = parseTimeToMinutes(config.start);
 const endMin = parseTimeToMinutes(config.end);
 if (Number.isNaN(startMin) || Number.isNaN(endMin)) return false;

 const now = new Date();
 const nowMin = now.getHours() * 60 + now.getMinutes();

 // Handle overnight ranges (e.g. 22:00 → 07:00)
 if (startMin <= endMin) {
 return nowMin >= startMin && nowMin < endMin;
 }
 return nowMin >= startMin || nowMin < endMin;
  } catch {
 return false;
  }
}

/** Return true when app is in Ghost Mode. */
function isGhostMode(): boolean {
  try {
 return localStorage.getItem(MODE_STORAGE_KEY) === 'ghost';
  } catch {
 return false;
  }
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
      confidence: Math.max(0, Math.min(1, alert.relevanceScore / 100)),
      userRelevance: Math.max(0, Math.min(1, alert.relevanceScore / 100)),
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
 * sending through the appropriate channel (Tauri native or Web API).
 */
  dispatchNotification(alert: UnifiedAlert, action: NotificationAction): void {
 const domain = alertSourceToDomain(alert.source);
 const trace = createDispatchTrace(alert, action, domain);

 // ── Silent action — nothing to do ──
 if (action === 'silent') {
 suppressTrace(trace, 'silent-action');
 return;
 }

 // ── Ghost Mode — suppress ALL notifications (outermost gate) ──
 if (isGhostMode()) {
 suppressTrace(trace, 'ghost-mode');
 return;
 }

 // ── Per-domain settings — user's notification preferences ──
 const preference = evaluateNotificationPreference(domain, alert.severity);
 if (!preference.allowed) {
 suppressTrace(trace, preference.reason);
 return;
 }

 // ── Quiet hours (legacy wm-quiet-hours key) — suppress unless critical ──
 if (isQuietHoursActive() && alert.severity !== 'critical') {
 suppressTrace(trace, 'legacy-quiet-hours');
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

 // ── Badge-only — no visible notification ──
 if (action === 'badge') {
 dispatchTrace(trace, action, false);
 recordNativeResult(trace, { delivered: true, surface: 'in_app' });
 this.incrementBadge();
 return;
 }

 // ── Send notification (sound+banner or banner) ──
 const withSound = action === 'sound+banner';
 dispatchTrace(trace, action, alert.severity === 'critical');

 if (isTauriContext()) {
 this.sendTauriNotification(alert, withSound, trace);
 } else {
 this.sendWebNotification(alert, withSound, trace);
 }
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

  // ── Tauri native notification ──────────────────────────────────────────────

  private sendTauriNotification(alert: UnifiedAlert, withSound: boolean, trace?: DispatchTrace): void {
 // Plugin not installed — skip dynamic import entirely to avoid Vite preload errors
 this.sendWebNotification(alert, withSound, trace);
  }

  // ── Web Notifications API fallback ─────────────────────────────────────────

  private sendWebNotification(alert: UnifiedAlert, _withSound?: boolean, trace?: DispatchTrace): void {
 try {
 if (!('Notification' in window)) {
 recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'notification-api-unavailable' });
 return;
 }

 if (Notification.permission === 'granted') {
 this.createWebNotification(alert);
 recordNativeResult(trace, { delivered: true, surface: alert.severity === 'critical' ? 'critical' : 'banner' });
 } else if (Notification.permission === 'denied') {
 recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'permission-denied' });
 } else {
 Notification.requestPermission()
 .then(perm => {
 if (perm === 'granted') {
 this.createWebNotification(alert);
 recordNativeResult(trace, { delivered: true, surface: alert.severity === 'critical' ? 'critical' : 'banner' });
 } else {
 recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'permission-denied' });
 }
 })
 .catch(() => {
 recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'permission-request-failed' });
 });
 }
 } catch {
 recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'notification-delivery-failed' });
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
