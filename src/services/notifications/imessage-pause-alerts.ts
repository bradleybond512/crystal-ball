/**
 * R4-BUG-001: make a paused iMessage channel visible instead of silent.
 *
 * - `recordPausedImessageRelay` traces every relay iMessage would have sent
 *   while paused (SystemDiagnostic → Notifications). Critical relays are
 *   `safetyCritical`, so they surface as unsafe suppressions: a critical
 *   iMessage really was not sent.
 * - `notifyImessagePausedOnce` sends one macOS notification per pause and
 *   marks it seen only when macOS reports `delivered` (R4-BUG-002 contract).
 *
 * Neither function can enable sending; only the native consent dialog can.
 */
import { getNotificationTraceRegistry } from '../diagnostics/diagnostics-state';
import type { NotificationCandidate, NotificationTraceRegistry, NotificationUrgency } from '../diagnostics/notification-trace';
import { getImessagePauseState, markImessagePauseNotified, type ImessagePauseState } from '../imessage-bridge';
import { notifyNative, type NativeNotification, type NativeNotifyOutcome } from '../native-notify';

export const PAUSED_RELAY_REASON = 'imessage_paused_reauthorization_required';
export type PausedRelaySource = 'breaking-news' | 'eew-tier5';

export interface PausedRelay {
  source: PausedRelaySource;
  urgency: NotificationUrgency;
  headline?: string;
}

export interface PausedRelayDeps {
  registry: () => NotificationTraceRegistry;
  pauseState: () => ImessagePauseState;
  now: () => number;
}

const RELAY_DEPS: PausedRelayDeps = {
  registry: getNotificationTraceRegistry,
  pauseState: getImessagePauseState,
  now: () => Date.now(),
};

let sequence = 0;

/** Returns true when the skipped relay was recorded (only while paused). */
export function recordPausedImessageRelay(relay: PausedRelay, deps: PausedRelayDeps = RELAY_DEPS): boolean {
  if (!deps.pauseState().paused) return false;
  const at = deps.now();
  sequence += 1;
  const candidate: NotificationCandidate = {
    candidateId: `imessage-paused:${relay.source}:${at}:${sequence}`,
    domain: 'system',
    urgency: relay.urgency,
    confidence: 1,
    safetyCritical: relay.urgency === 'critical',
    createdAt: at,
  };
  if (relay.headline) candidate.headline = relay.headline;
  try {
    const registry = deps.registry();
    registry.register(candidate);
    registry.suppress(candidate.candidateId, PAUSED_RELAY_REASON, at);
    return true;
  } catch {
    // Diagnostics must never break the alert path that called us.
    return false;
  }
}

export function pausedNotice(hint: string): NativeNotification {
  return {
    title: 'Crystal Ball: iMessage alerts paused',
    body: `Alerts are not being relayed to iMessage. Open Settings → General and confirm the recipient (${hint}) to resume.`,
    priority: 'high',
  };
}

export interface PausedNoticeDeps {
  pauseState: () => ImessagePauseState;
  notify: (notification: NativeNotification) => Promise<NativeNotifyOutcome>;
  markNotified: () => void;
}

const NOTICE_DEPS: PausedNoticeDeps = {
  pauseState: getImessagePauseState,
  notify: (notification) => notifyNative(notification),
  markNotified: () => markImessagePauseNotified(),
};

let inFlight: Promise<NativeNotifyOutcome | 'not_needed'> | null = null;

/** One macOS notification per pause; retried next launch unless delivered. */
export function notifyImessagePausedOnce(deps: PausedNoticeDeps = NOTICE_DEPS): Promise<NativeNotifyOutcome | 'not_needed'> {
  inFlight ??= (async () => {
    const state = deps.pauseState();
    if (!state.paused || state.notified) return 'not_needed' as const;
    const outcome = await deps.notify(pausedNotice(state.hint));
    if (outcome === 'delivered') deps.markNotified();
    return outcome;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
