/**
 * Hypothesis Notifier — fires a native desktop notification the first
 * time a critical hypothesis signature appears, but only when the
 * AnalystHUD is closed (otherwise the user is already looking).
 *
 * The notification is piped through the shared notificationDispatcher
 * using a synthetic `correlation` UnifiedAlert, so Ghost Mode + quiet
 * hours + rate limiting all apply without per-service duplication.
 *
 * We track notified signatures in memory (not persisted): re-starting
 * the app shows the nudge again, which is the right behavior — it's
 * ambient awareness, not a historical log.
 */

import { notificationDispatcher } from './notification-dispatcher';
import { logDebug } from './reasoning-debug';
import type { UnifiedAlert } from './unified-alerts';
import type { AnalystSnapshot, Hypothesis } from './analyst-loop';
import { signatureFor } from './hypothesis-feedback';
import { isGhostMode } from './mode-manager';

const NOTIFY_WINDOW_MS = 60 * 60 * 1000; // Don't re-notify the same signature within an hour.

// ── State ─────────────────────────────────────────────────────────────────────

const notified = new Map<string, number>();
let hudVisible = false;

// ── Notification ─────────────────────────────────────────────────────────────

function buildAlert(h: Hypothesis, count: number): UnifiedAlert {
  const suffix = count > 1 ? ` (+${count - 1} more)` : '';
  return {
    id: `analyst-critical-${signatureFor(h)}-${Date.now()}`,
    source: 'correlation',
    severity: 'critical',
    title: `Analyst: critical hypothesis${suffix}`,
    body: 'Open Crystal Ball to review new critical hypothesis',
    timestamp: Date.now(),
    relevanceScore: 95,
    acknowledged: false,
    pinned: false,
  };
}

function handleSnapshot(snapshot: AnalystSnapshot): void {
  if (hudVisible) return; // user is looking — no need to nudge
  const now = Date.now();
  // Prune old entries.
  for (const [sig, at] of notified) if (now - at > NOTIFY_WINDOW_MS) notified.delete(sig);

  const fresh: Hypothesis[] = [];
  for (const h of snapshot.hypotheses) {
    if (h.risk !== 'critical') continue;
    const sig = signatureFor(h);
    if (notified.has(sig)) continue;
    // Always record the signature even in Ghost Mode so hypotheses seen during
    // Ghost Mode don't re-fire as "fresh" once the mode is turned off.
    notified.set(sig, now);
    fresh.push(h);
  }
  if (fresh.length === 0) return;
  if (isGhostMode()) return; // Ghost Mode: signatures recorded above, but no banner

  // Pick the highest-confidence fresh hypothesis as the notification headline.
  const lead = [...fresh].sort((a, b) => b.confidence - a.confidence)[0];
  if (!lead) return;
  notificationDispatcher.dispatchNotification(buildAlert(lead, fresh.length), 'sound+banner');
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startHypothesisNotifier(): void {
  if (started) return;
  started = true;
  document.addEventListener('cb:analyst-hud-visibility', (e: Event) => {
    const ce = e as CustomEvent<{ visible: boolean }>;
    hudVisible = ce.detail?.visible === true;
  });
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    try { handleSnapshot(ce.detail); } catch (error) {
      logDebug({ level: 'warn', category: 'hypothesis', source: 'hypothesis-notifier',
        message: 'handleSnapshot error',
        data: { error: error instanceof Error ? error.message : String(error) } });
    }
  });
}
