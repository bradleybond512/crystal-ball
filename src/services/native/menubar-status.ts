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
 * thrashing during bulk ingests.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { tryInvokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

export type ThreatLevel = 'green' | 'yellow' | 'red';

let started = false;
let unsubscribe: (() => void) | null = null;
let lastSent: ThreatLevel | null = null;
let scheduled = false;

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
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      let alerts: UnifiedAlert[] = [];
      try { alerts = unifiedAlertStore.getAll(); } catch { return; }
      const level = computeThreatLevel(alerts);
      if (level === lastSent) return;
      lastSent = level;
      void tryInvokeTauri('set_menubar_status', { level });
    });
  };

  push();
  unsubscribe = unifiedAlertStore.subscribe(push);
}

export function stopMenubarStatus(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  lastSent = null;
}
