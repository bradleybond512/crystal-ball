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
import { shouldNotify, type NotificationDomain } from './notifications/notification-settings-service';


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
 // ── Silent action — nothing to do ──
 if (action === 'silent') return;

 // ── Ghost Mode — suppress ALL notifications (outermost gate) ──
 if (isGhostMode()) return;

 // ── Per-domain settings — user's notification preferences ──
 const domain = alertSourceToDomain(alert.source);
 if (!shouldNotify(domain, alert.severity)) return;

 // ── Quiet hours (legacy wm-quiet-hours key) — suppress unless critical ──
 if (isQuietHoursActive() && alert.severity !== 'critical') return;

 // ── Rate limiting — max 1 per source per RATE_LIMIT_MS ──
 const now = Date.now();
 const lastTime = this.rateLimitMap.get(alert.source);
 if (lastTime !== undefined && now - lastTime < RATE_LIMIT_MS) return;
 this.rateLimitMap.set(alert.source, now);

 // ── Badge-only — no visible notification ──
 if (action === 'badge') {
 this.incrementBadge();
 return;
 }

 // ── Send notification (sound+banner or banner) ──
 const withSound = action === 'sound+banner';

 if (isTauriContext()) {
 this.sendTauriNotification(alert, withSound);
 } else {
 this.sendWebNotification(alert, withSound);
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

  private sendTauriNotification(alert: UnifiedAlert, withSound: boolean): void {
 // Plugin not installed — skip dynamic import entirely to avoid Vite preload errors
 this.sendWebNotification(alert, withSound);
  }

  // ── Web Notifications API fallback ─────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private sendWebNotification(alert: UnifiedAlert, _withSound?: boolean): void {
 try {
 if (!('Notification' in window)) return;

 if (Notification.permission === 'granted') {
 this.createWebNotification(alert);
 } else if (Notification.permission !== 'denied') {
 Notification.requestPermission()
 .then(perm => {
 if (perm === 'granted') this.createWebNotification(alert);
 })
 .catch(() => { /* permission request failed */ });
 }
 } catch {
 // Notifications unavailable in this environment
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
