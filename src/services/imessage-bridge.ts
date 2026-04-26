/**
 * iMessage Bridge — desktop-only routing of breaking alerts to the user's
 * signed-in macOS Messages app via the Tauri `send_imessage` command.
 *
 * Web builds can't fire iMessages (Apple has no public API; the route shells
 * out to AppleScript on macOS only). All settings are stored in localStorage
 * so the toggle survives reloads.
 */

import { tryInvokeTauri } from './tauri-bridge';
import { isDesktopRuntime } from './runtime';

const SETTINGS_KEY = 'crystalball-imessage-settings';

export type ImessageThreshold = 'critical' | 'high+critical';

export interface ImessageSettings {
  enabled: boolean;
  recipient: string;
  threshold: ImessageThreshold;
}

const DEFAULTS: ImessageSettings = {
  enabled: false,
  recipient: '',
  threshold: 'critical',
};

export function getImessageSettings(): ImessageSettings {
  try {
 const raw = localStorage.getItem(SETTINGS_KEY);
 if (!raw) return { ...DEFAULTS };
 const parsed = JSON.parse(raw) as Partial<ImessageSettings>;
 return {
 enabled: parsed.enabled === true,
 recipient: typeof parsed.recipient === 'string' ? parsed.recipient : '',
 threshold: parsed.threshold === 'high+critical' ? 'high+critical' : 'critical',
 };
  } catch {
 return { ...DEFAULTS };
  }
}

export function saveImessageSettings(s: ImessageSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/**
 * Send a one-off iMessage. Returns `{ ok: true }` on success or
 * `{ ok: false, reason }` on failure. Never throws — callers can ignore
 * failures or surface them to the user.
 */
export async function sendImessage(recipient: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isDesktopRuntime()) return { ok: false, reason: 'iMessage routing requires the macOS desktop build' };
  if (!recipient.trim()) return { ok: false, reason: 'Recipient is required' };
  if (!body.trim()) return { ok: false, reason: 'Body is required' };
  try {
 const result = await tryInvokeTauri<void>('send_imessage', { recipient: recipient.trim(), body });
 // tryInvokeTauri returns null on bridge unavailable. The native command
 // returns Ok(()) on success or Err string on send failure (which becomes
 // a thrown Error caught inside tryInvokeTauri).
 return result === null ? { ok: false, reason: 'Tauri bridge unavailable' } : { ok: true };
  } catch (error) {
 return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
