/**
 * Dock badge — mirrors the unread-alert count to the macOS dock tile.
 *
 * Subscribes to the unified alert store and forwards the unacknowledged
 * count to the Tauri `set_dock_badge` command. Silently no-ops in the web
 * build (no Tauri bridge available) so the same call site works everywhere.
 */

import { unifiedAlertStore } from '@/services/unified-alerts';
import { tryInvokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

let started = false;
let unsubscribe: (() => void) | null = null;
let lastSent: number | null = null;

export function startDockBadge(): void {
  if (started) return;
  started = true;
  if (!hasTauriInvokeBridge()) return; // web — no dock to badge

  const push = () => {
    let count = 0;
    try { count = unifiedAlertStore.getUnacknowledgedCount(); } catch { return; }
    if (count === lastSent) return;
    lastSent = count;
    void tryInvokeTauri('set_dock_badge', { count });
  };

  push();
  unsubscribe = unifiedAlertStore.subscribe(push);
}

export function stopDockBadge(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  lastSent = null;
}

/** Test seam: lets tests check what would be sent without subscribing. */
export function computeDockBadgeCount(unacknowledged: number): number {
  return Math.max(0, Math.floor(unacknowledged));
}
