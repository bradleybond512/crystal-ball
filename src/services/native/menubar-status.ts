/**
 * Menubar status — drives the macOS system-tray icon based on overall
 * threat level. Sends a string status to the Tauri `set_menubar_status`
 * command whenever the calculation changes.
 *
 * Threat-level mapping:
 *   - red    → any unacknowledged critical alert
 *   - yellow → any unacknowledged high alert (no critical)
 *   - green  → none of the above
 *
 * Recomputes on every unified-alerts notify; debounced with rAF to avoid
 * thrashing during bulk ingests, with a bounded timer fallback while hidden.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { tryInvokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

export type ThreatLevel = 'green' | 'yellow' | 'red';

let started = false;
let unsubscribe: (() => void) | null = null;
let lastSent: ThreatLevel | null = null;
let cancelScheduled: (() => void) | null = null;

/**
 * Pure: derive the threat level from a list of alerts. Exposed for tests.
 */
export function computeThreatLevel(alerts: readonly UnifiedAlert[]): ThreatLevel {
  let hasCritical = false;
  let hasHigh = false;
  for (const a of alerts) {
    if (a.acknowledged) continue;
    if (a.severity === 'critical') { hasCritical = true; break; }
    if (a.severity === 'high') hasHigh = true;
  }
  if (hasCritical) return 'red';
  if (hasHigh) return 'yellow';
  return 'green';
}

export function startMenubarStatus(): void {
  if (started) return;
  started = true;
  if (!hasTauriInvokeBridge()) return; // web — no menubar

  const push = () => {
    if (cancelScheduled) return;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    const run = () => {
      if (cancelled) return;
      cancel();
      cancelScheduled = null;
      let alerts: UnifiedAlert[] = [];
      try { alerts = unifiedAlertStore.getOperationalAlerts(); } catch { return; }
      const level = computeThreatLevel(alerts);
      if (level === lastSent) return;
      lastSent = level;
      void tryInvokeTauri('set_menubar_status', { level });
    };
    cancelScheduled = cancel;
    const frame = requestAnimationFrame(run);
    const timer = setTimeout(run, 100);
  };

  push();
  unsubscribe = unifiedAlertStore.subscribe(push);
}

export function stopMenubarStatus(): void {
  unsubscribe?.();
  unsubscribe = null;
  cancelScheduled?.();
  cancelScheduled = null;
  started = false;
  lastSent = null;
}
