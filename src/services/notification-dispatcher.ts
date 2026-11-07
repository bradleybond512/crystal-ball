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
  getSettings,
  nativeChannelHold,
  isNotificationSettingsStorageKey,
  type NotificationDomain,
} from './notifications/notification-settings-service';
import { validateAlertRetentionEvidence } from './alert-retention';
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

const DERIVED_TITLE_WINDOW_MS = 30 * 60 * 1000;
const MAX_DERIVED_GROUPS = 16;

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

function permittedBannerApi(): typeof Notification | undefined {
  try {
    const api = window.Notification;
    return api?.permission === 'granted' ? api : undefined;
  } catch {
    return undefined;
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
    case 'air-quality': { return 'cyber';
    }
    case 'correlation': { return 'derived';
    }
    default: { return 'geopolitical';
    }
  }
}

function inactiveWarning(alert: UnifiedAlert, now: number): boolean {
  const evidence = validateAlertRetentionEvidence(alert.source, alert.retentionEvidence, now);
  return alert.acknowledged || (alert.snoozedUntil ?? 0) > now
    || (evidence?.kind === 'nws-expiry' && evidence.expiresAt <= now);
}

function traceDomainFor(domain: NotificationDomain): Parameters<NotificationTraceRegistry['byDomain']>[0] {
  switch (domain) {
    case 'derived': { return 'reasoning'; }
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
  pendingAction?: {action: NotificationAction; critical: boolean};
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
      safetyCritical: domain !== 'derived' && alert.severity === 'critical',
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
    if (trace?.pendingAction) {
      dispatchTrace(trace, trace.pendingAction.action, trace.pendingAction.critical);
      delete trace.pendingAction;
    }
    trace?.registry.recordNativeResult(trace.candidateId, result);
  } catch { /* diagnostics must not block delivery */ }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher class
// ──────────────────────────────────────────────────────────────────────────────

class NotificationDispatcher {
  /** source → last notification timestamp */
  private rateLimitMap = new Map<string, number>();
  private derivedTitles = new Map<string, number>();
  private lastDerivedAttempt = -Infinity;
  private derivedTagPrefix?: string;
  private derivedTagSlot = 0;
  private permissionQuestionOpen = false;
  private permissionCandidate?: (outcome: NotificationPermission | 'cancelled' | 'failed') => void;

  private finishPermission(outcome: NotificationPermission | 'cancelled' | 'failed'): void {
    const finish = this.permissionCandidate;
    this.permissionCandidate = undefined;
    finish?.(outcome);
  }

  cancelPendingPermission = (): void => {
    this.finishPermission('cancelled');
  };

  /**
 * Dispatch a notification for the given alert.
 *
 * Applies Ghost Mode suppression, rate limiting, and quiet hours before
 * sending a banner through the Web Notifications API.
 */
  dispatchNotification(alert: UnifiedAlert, action: NotificationAction, stillEligible?: (afterPermission: boolean) => boolean): 'held-cooldown' | void {
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

 if (domain === 'derived') {
 this.dispatchDerived(alert, action, trace);
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
 const hold = nativeChannelHold(domain);
 if (hold || inactiveWarning(alert, now) || stillEligible?.(false) === false) {
 suppressTrace(trace, hold ?? 'inactive-warning');
 return;
 }
 const lastTime = this.rateLimitMap.get(alert.source);
 if (alert.severity !== 'critical' && lastTime !== undefined && now - lastTime < RATE_LIMIT_MS) {
 suppressTrace(trace, 'source-rate-limit');
 return 'held-cooldown';
 }
 this.rateLimitMap.set(alert.source, now);

 // ── Send notification (sound+banner or banner) ──
 if (trace) trace.pendingAction = {action, critical: alert.severity === 'critical'};
 this.sendWebNotification(alert, domain, trace, stillEligible);
  }

  private dispatchDerived(alert: UnifiedAlert, action: NotificationAction, trace?: DispatchTrace): void {
    if (getSettings().domains.derived.channel === 'in_app' || action === 'badge') {
      suppressTrace(trace, action === 'badge' ? 'badge-only' : 'in-app-only');
      return;
    }

    // Bound input work as well as retained keys. An ungroupable candidate
    // stays visible on its existing in-app surface.
    const title = alert.title.length <= 1024
      ? alert.title.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()
      : '';
    if (!title) {
      suppressTrace(trace, 'derived-title-unavailable');
      return;
    }

    const Banner = permittedBannerApi();
    if (!Banner) {
      suppressTrace(trace, 'permission-unavailable');
      return;
    }

    const now = performance.now();
    for (const [key, admitted] of this.derivedTitles) {
      if (now - admitted >= DERIVED_TITLE_WINDOW_MS) this.derivedTitles.delete(key);
    }
    if (this.derivedTitles.has(title)) {
      suppressTrace(trace, 'derived-duplicate-title');
      return;
    }
    if (now - this.lastDerivedAttempt < RATE_LIMIT_MS || this.derivedTitles.size >= MAX_DERIVED_GROUPS) {
      suppressTrace(trace, 'derived-cooldown');
      return;
    }

    // Reserve before the synchronous constructor. Even a failed attempt
    // must not unleash a retry storm.
    this.lastDerivedAttempt = now;
    this.derivedTitles.set(title, now);
    dispatchTrace(trace, 'banner', false);
    try {
      this.derivedTagPrefix ??= crypto.randomUUID();
      const tag = `wm-derived-${this.derivedTagPrefix}-${this.derivedTagSlot}`;
      this.derivedTagSlot = (this.derivedTagSlot + 1) % MAX_DERIVED_GROUPS;
      new Banner(alert.title, { body: alert.body, tag, silent: true, requireInteraction: false });
      recordNativeResult(trace, { delivered: true, surface: 'banner' });
    } catch {
      recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'notification-delivery-failed' });
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

  // Desktop uses the same browser permission API as the web workspace.
  private sendWebNotification(alert: UnifiedAlert, domain: NotificationDomain,
    trace?: DispatchTrace, stillEligible?: (afterPermission: boolean) => boolean): void {
    try {
      if (!('Notification' in window)) {
        recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'notification-api-unavailable' });
      } else if (Notification.permission === 'granted') {
        this.presentNotification(alert, trace);
      } else if (Notification.permission === 'denied') {
        recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'permission-denied' });
      } else if (this.permissionCandidate) {
        recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'permission-pending' });
      } else {
        this.awaitPermission(alert, domain, trace, stillEligible);
      }
    } catch {
      recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'notification-delivery-failed' });
    }
  }

  private awaitPermission(alert: UnifiedAlert, domain: NotificationDomain,
    trace?: DispatchTrace, stillEligible?: (afterPermission: boolean) => boolean): void {
    const generation = getNotificationModeState().generation;
    const started = Date.now();
    const settings = getSettings();
    const controller = new AbortController();
    const cancel = this.cancelPendingPermission;
    const timer = setTimeout(cancel, RATE_LIMIT_MS);
    this.permissionCandidate = outcome => {
      clearTimeout(timer);
      controller.abort();
      const mode = getNotificationModeState();
      const hold = outcome === 'denied' ? undefined : holdNotificationForMode(alert.severity === 'critical', mode);
      if (outcome !== 'denied' && (hold || mode.generation !== generation)) {
        suppressTrace(trace, hold ?? 'mode-changed-during-permission');
        return;
      }
      if (outcome !== 'granted' || Notification.permission !== 'granted') {
        const failure = outcome === 'cancelled' ? 'no-longer-eligible' : 'permission-denied';
        recordNativeResult(trace, { delivered: false, surface: 'failed',
          error: outcome === 'failed' ? 'permission-request-failed' : failure });
        return;
      }
      const now = Date.now();
      const current = getSettings();
      if (now < started || now - started >= RATE_LIMIT_MS
        || current.global !== settings.global || current.domains[domain] !== settings.domains[domain]
        || !evaluateNotificationPreference(domain, alert.severity).allowed
        || nativeChannelHold(domain) || inactiveWarning(alert, now) || stillEligible?.(true) === false) {
        recordNativeResult(trace, { delivered: false, surface: 'failed', error: 'no-longer-eligible' });
        return;
      }
      this.presentNotification(alert, trace);
    };
    const options = { signal: controller.signal };
    if (typeof document !== 'undefined') document.addEventListener('wm:mode-changed', () => { if (getNotificationModeState().generation === generation) cancel(); }, options);
    window.addEventListener?.('storage', event => {
      if (event.key === 'wm-app-mode' || isNotificationSettingsStorageKey(event.key)) cancel();
    }, options);
    if (!this.permissionQuestionOpen) void this.askPermission();
  }

  private async askPermission(): Promise<void> {
    this.permissionQuestionOpen = true;
    try {
      const result = await Notification.requestPermission();
      this.finishPermission(result);
    } catch {
      this.finishPermission('failed');
    } finally {
      this.permissionQuestionOpen = false;
    }
  }

  private presentNotification(alert: UnifiedAlert, trace?: DispatchTrace): void {
    try {
      this.createWebNotification(alert);
      recordNativeResult(trace, { delivered: true, surface: alert.severity === 'critical' ? 'critical' : 'banner' });
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
