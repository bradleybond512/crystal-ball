/**
 * iMessage Bridge — desktop-only routing of breaking alerts to the user's
 * signed-in macOS Messages app via the Tauri `send_imessage` command.
 *
 * Web builds can't fire iMessages (Apple has no public API; the route shells
 * out to AppleScript on macOS only). All settings are stored in localStorage
 * so the toggle survives reloads.
 */

import { invokeTauri, hasTauriInvokeBridge } from './tauri-bridge';
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
  // Distinguish 'bridge truly unavailable' from 'Rust command threw'. tryInvokeTauri
  // collapses both to null, hiding the real reason — users saw a misleading
  // 'Tauri bridge unavailable' for what was actually a rate-limit or
  // recipient-unreachable error from Messages.app.
  if (!hasTauriInvokeBridge()) return { ok: false, reason: 'Tauri bridge unavailable' };
  try {
 await invokeTauri<void>('send_imessage', { recipient: recipient.trim(), body });
 return { ok: true };
  } catch (error) {
 return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
