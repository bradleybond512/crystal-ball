/**
 * Single entry point for native (macOS) notifications — R4-BUG-002.
 *
 * The native `send_notification` command reports what actually happened:
 * `delivered` (handed to macOS), `rate_limited` (not shown), or `unsupported`
 * (non-macOS shell). Callers MUST treat anything other than `delivered` as
 * "the user did not see this": never record it as fired, never mark it as
 * alerted, never append it to a dedupe ledger — otherwise a suppressed
 * life-safety alert is also suppressed on retry.
 *
 * Priority selects an independent native lane (see src-tauri/src/notify_policy.rs):
 *   - `critical` — life-safety only (warnings, evacuation orders, critical hazmat).
 *   - `high`     — important but not life-safety (breaking news, other hazards).
 *   - `normal`   — everything else (default).
 */
import { hasTauriInvokeBridge, invokeTauri } from './tauri-bridge';

export type NativePriority = 'critical' | 'high' | 'normal';
export type NativeNotifyOutcome = 'delivered' | 'rate_limited' | 'failed' | 'unavailable';

export interface NativeNotification {
  title: string;
  body: string;
  sound?: string;
  priority?: NativePriority;
}

export interface NativeNotifyDeps {
  hasBridge: () => boolean;
  invoke: <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;
}

const DEFAULT_DEPS: NativeNotifyDeps = {
  hasBridge: hasTauriInvokeBridge,
  invoke: invokeTauri,
};

export async function notifyNative(
  notification: NativeNotification,
  deps: NativeNotifyDeps = DEFAULT_DEPS,
): Promise<NativeNotifyOutcome> {
  if (!deps.hasBridge()) return 'unavailable';
  let result: unknown;
  try {
    result = await deps.invoke<unknown>('send_notification', {
      title: notification.title,
      body: notification.body,
      sound: notification.sound,
      priority: notification.priority ?? 'normal',
    });
  } catch {
    return 'failed';
  }
  if (result === 'delivered') return 'delivered';
  if (result === 'rate_limited') return 'rate_limited';
  if (result === 'unsupported') return 'unavailable';
  // Any other shape (e.g. an older native shell returning null) is never
  // treated as delivery — honesty over optimism on the alert path.
  return 'failed';
}
