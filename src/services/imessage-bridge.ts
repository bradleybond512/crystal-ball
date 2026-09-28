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
const unavailable = () => ({ enabled: false, recipient: '', ready: false, migrationAvailable: false });
let nativeSettings = unavailable();
let generation = 0;

function localSettings(): Partial<ImessageSettings> {
  try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ImessageSettings> | null) ?? {}; }
  catch { return {}; }
}
export function getImessageSettings(): ImessageSettings {
  return { ...nativeSettings, threshold: localSettings().threshold === 'high+critical' ? 'high+critical' : 'critical' };
}
export function saveImessageThreshold(threshold: ImessageThreshold): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...localSettings(), threshold }));
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
function acceptState(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings');
  const state = value as Record<string, unknown>;
  if (typeof state.enabled !== 'boolean' || typeof state.ready !== 'boolean'
    || typeof state.migrationAvailable !== 'boolean'
    || (state.recipient !== null && typeof state.recipient !== 'string')
    || (state.enabled && (!state.ready || !state.recipient))) throw new Error('Invalid settings');
  nativeSettings = { enabled: state.enabled, ready: state.ready, recipient: state.recipient as string ?? '', migrationAvailable: state.migrationAvailable };
  if (!state.migrationAvailable) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ threshold: getImessageSettings().threshold })); }
    catch { /* Native authority remains valid when local preferences cannot be stored. */ }
  }
}
async function requestState(command: string, payload?: Record<string, unknown>): Promise<ImessageResult> {
  const request = ++generation;
  try {
    if (!isDesktopRuntime() || !hasTauriInvokeBridge()) throw new Error('Unavailable');
    const state = await invokeTauri<unknown>(command, payload);
    if (request !== generation) return failure({ code: 'stale_consent' });
    acceptState(state);
    return { ok: true };
  } catch (error) {
    if (request === generation) nativeSettings = unavailable();
    return failure(error);
  }
}
export function refreshImessageSettings(): Promise<ImessageResult> {
  return requestState('get_imessage_settings');
}
export async function configureImessage(recipient: string, enabled: boolean): Promise<ImessageResult> {
  const pending = requestState('configure_imessage', { recipient, enabled });
  const request = generation;
  const result = await pending;
  if (!result.ok && request === generation) await refreshImessageSettings();
  return result;
}
export async function disableImessage(): Promise<ImessageResult> {
  nativeSettings = unavailable();
  const result = await requestState('disable_imessage');
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
