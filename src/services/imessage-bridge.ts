import { invokeTauri, hasTauriInvokeBridge } from './tauri-bridge';
import { isDesktopRuntime } from './runtime';

const SETTINGS_KEY = 'crystalball-imessage-settings';
export type ImessageThreshold = 'critical' | 'high+critical';
export interface ImessageSettings {
  enabled: boolean;
  recipient: string;
  ready: boolean;
  migrationAvailable: boolean;
  threshold: ImessageThreshold;
}
const ERRORS = {
  unavailable: 'iMessage settings are unavailable. Sending is disabled.',
  invalid_recipient: 'Use an explicit international phone number or email address (maximum 64 characters).',
  invalid_body: 'A message body is required.',
  disabled: 'iMessage sending is disabled.',
  busy: 'An iMessage operation is already pending. Try again when it finishes.',
  canceled: 'Confirmation canceled. No new destination was authorized.',
  stale_consent: 'Settings changed while confirmation was open. Review and save again.',
  persistence_failed: 'Settings could not be saved. Review current settings before retrying.',
  rate_limited: 'Please wait 30 seconds between messages.',
  send_failed: 'Messages could not send the message. Check Messages permissions and sign-in.',
  send_uncertain: 'Message delivery is uncertain. It will not be retried automatically.',
} as const;
export type ImessageErrorCode = keyof typeof ERRORS;
export type ImessageResult = { ok: true } | { ok: false; code: ImessageErrorCode; reason: string };
/**
 * R4-BUG-001: iMessage relays are "paused" when the user had them on before
 * native consent existed (or started migrating and never finished) and native
 * sending is still off. Only a redacted hint survives migration; the full
 * legacy recipient is still deleted. Nothing here ever enables sending.
 */
export type ImessagePauseState = { paused: false } | { paused: true; hint: string; since: number; notified: boolean };
export const IMESSAGE_PAUSE_EVENT = 'cb:imessage-pause-changed';
interface PauseMarker { hint: string; since: number; notifiedAt?: number }
type StoredSettings = Partial<ImessageSettings> & { paused?: unknown };
/** A refresh never resolves a pause; a natively confirmed user action always does. */
type StateOrigin = 'refresh' | 'user';
const unavailable = () => ({ enabled: false, recipient: '', ready: false, migrationAvailable: false });
let nativeSettings = unavailable();
let generation = 0;

function localSettings(): StoredSettings {
  try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as StoredSettings | null) ?? {}; }
  catch { return {}; }
}
function storeSettings(next: Record<string, unknown>): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); }
  catch { /* Native authority remains valid when local preferences cannot be stored. */ }
}
/** Enough to recognize a destination, never enough to message it. */
export function redactImessageRecipient(recipient: string): string {
  const value = recipient.trim();
  const at = value.lastIndexOf('@');
  if (at > 0) return `${value.slice(0, 1)}…${value.slice(at)}`;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `…${digits.slice(-4)}` : '…';
}
// Exactly the shapes redactImessageRecipient produces; anything else is tampering.
const PAUSE_HINT = /^(?:…|…\d{4}|[^\s@]…@\S{1,72})$/u;
function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
function readPauseMarker(value: unknown): PauseMarker | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const marker = value as Record<string, unknown>;
  if (typeof marker.hint !== 'string' || !PAUSE_HINT.test(marker.hint) || !finite(marker.since)) return undefined;
  if (marker.notifiedAt === undefined) return { hint: marker.hint, since: marker.since };
  return finite(marker.notifiedAt) ? { hint: marker.hint, since: marker.since, notifiedAt: marker.notifiedAt } : undefined;
}
function nextPauseMarker(stored: StoredSettings, previous: PauseMarker | undefined, origin: StateOrigin): PauseMarker | undefined {
  if (origin === 'user' || nativeSettings.enabled) return undefined;
  if (previous) return previous;
  const legacy = stored.enabled === true && typeof stored.recipient === 'string' ? stored.recipient : '';
  return legacy ? { hint: redactImessageRecipient(legacy), since: Date.now() } : undefined;
}
function announcePauseChange(): void {
  try { globalThis.document?.dispatchEvent(new CustomEvent(IMESSAGE_PAUSE_EVENT)); }
  catch { /* No DOM: nothing is listening. */ }
}
export function getImessageSettings(): ImessageSettings {
  return { ...nativeSettings, threshold: localSettings().threshold === 'high+critical' ? 'high+critical' : 'critical' };
}
export function saveImessageThreshold(threshold: ImessageThreshold): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...localSettings(), threshold }));
}
export function getImessagePauseState(): ImessagePauseState {
  if (!nativeSettings.ready || nativeSettings.enabled) return { paused: false };
  const marker = readPauseMarker(localSettings().paused);
  return marker ? { paused: true, hint: marker.hint, since: marker.since, notified: marker.notifiedAt !== undefined } : { paused: false };
}
/** Record that the pause notice reached macOS (call only on `delivered`). */
export function markImessagePauseNotified(at: number = Date.now()): void {
  const stored = localSettings();
  const marker = readPauseMarker(stored.paused);
  if (!marker || marker.notifiedAt !== undefined) return;
  storeSettings({ ...stored, paused: { ...marker, notifiedAt: at } });
}
export function getLegacyImessageSuggestion(): { enabled: boolean; recipient: string } | null {
  if (!nativeSettings.ready || !nativeSettings.migrationAvailable) return null;
  const legacy = localSettings();
  return typeof legacy.recipient === 'string' && legacy.recipient
    ? { enabled: legacy.enabled === true, recipient: legacy.recipient } : null;
}
function failure(error: unknown): ImessageResult {
  const code = typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && Object.prototype.hasOwnProperty.call(ERRORS, error.code)
    ? error.code as ImessageErrorCode : 'unavailable';
  return { ok: false, code, reason: ERRORS[code] };
}
function acceptState(value: unknown, origin: StateOrigin): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings');
  const state = value as Record<string, unknown>;
  if (typeof state.enabled !== 'boolean' || typeof state.ready !== 'boolean'
    || typeof state.migrationAvailable !== 'boolean'
    || (state.recipient !== null && typeof state.recipient !== 'string')
    || (state.enabled && (!state.ready || !state.recipient))) throw new Error('Invalid settings');
  nativeSettings = { enabled: state.enabled, ready: state.ready, recipient: state.recipient as string ?? '', migrationAvailable: state.migrationAvailable };
  const stored = localSettings();
  const previous = readPauseMarker(stored.paused);
  const paused = nextPauseMarker(stored, previous, origin);
  // Once migration is consumed only the threshold (and a redacted pause hint) survive.
  const base: Record<string, unknown> = state.migrationAvailable
    ? { ...stored, paused: undefined }
    : { threshold: getImessageSettings().threshold };
  const next = paused ? { ...base, paused } : base;
  if (JSON.stringify(next) !== JSON.stringify(stored)) storeSettings(next);
  if (JSON.stringify(paused) !== JSON.stringify(previous)) announcePauseChange();
}
async function requestState(command: string, origin: StateOrigin, payload?: Record<string, unknown>): Promise<ImessageResult> {
  const request = ++generation;
  try {
    if (!isDesktopRuntime() || !hasTauriInvokeBridge()) throw new Error('Unavailable');
    const state = await invokeTauri<unknown>(command, payload);
    if (request !== generation) return failure({ code: 'stale_consent' });
    acceptState(state, origin);
    return { ok: true };
  } catch (error) {
    if (request === generation) nativeSettings = unavailable();
    return failure(error);
  }
}
export function refreshImessageSettings(): Promise<ImessageResult> {
  return requestState('get_imessage_settings', 'refresh');
}
export async function configureImessage(recipient: string, enabled: boolean): Promise<ImessageResult> {
  const pending = requestState('configure_imessage', 'user', { recipient, enabled });
  const request = generation;
  const result = await pending;
  if (!result.ok && request === generation) await refreshImessageSettings();
  return result;
}
export async function disableImessage(): Promise<ImessageResult> {
  nativeSettings = unavailable();
  const result = await requestState('disable_imessage', 'user');
  if (!result.ok && result.code === 'persistence_failed') {
    return { ...result, reason: 'Settings could not be saved. Sending is blocked for this session; previous settings may return after restart.' };
  }
  return result;
}
export async function sendImessage(body: string): Promise<ImessageResult> {
  if (!nativeSettings.ready || !nativeSettings.enabled) return failure({ code: 'disabled' });
  if (!body.trim()) return failure({ code: 'invalid_body' });
  try {
    if (!isDesktopRuntime() || !hasTauriInvokeBridge()) throw new Error('Unavailable');
    await invokeTauri<void>('send_imessage', { body });
    return { ok: true };
  } catch (error) {
    const result = failure(error);
    if (!result.ok && ['disabled', 'unavailable', 'persistence_failed'].includes(result.code)) nativeSettings = unavailable();
    return result;
  }
}
