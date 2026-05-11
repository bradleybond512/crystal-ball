// Voice alerts via the macOS `say` command, exposed through the Tauri
// `speak_aloud` Rust command. Opt-in only.

import { tryInvokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';
import { tierForMagnitude, tierAtLeast } from './eew-tiers';
import type { NotifiableEvent } from './push-notifier';

export interface VoiceSettings {
  enabled: boolean;
  voice: string;
  rate: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  voice: 'Samantha',
  rate: 180,
};

const VOICE_SETTINGS_KEY = 'crystalball-voice-settings';
const MAX_VOICE_MESSAGE_LEN = 200;

export interface VoiceDecision {
  shouldSpeak: boolean;
  message?: string;
  reason?:
    | 'disabled'
    | 'tier-below-threshold'
    | 'cap-not-extreme-immediate'
    | 'event-kind-not-spoken';
}

export function buildVoiceMessage(event: NotifiableEvent): string | null {
  if (event.kind === 'seismic') {
    const tier = tierForMagnitude(event.magnitude);
    if (!tier || !tierAtLeast(tier, 'TIER_4')) return null;
    const mag = event.magnitude.toFixed(1);
    const text = `Crystal Ball alert — magnitude ${mag} earthquake near ${event.place || 'an unknown location'}`;
    return text.slice(0, MAX_VOICE_MESSAGE_LEN);
  }
  if (event.kind === 'cap') {
    if (event.severity !== 'Extreme' || event.urgency !== 'Immediate') return null;
    const text = `Crystal Ball alert — ${event.event || 'emergency alert'} — ${event.headline || event.areaDesc || ''}`;
    return text.slice(0, MAX_VOICE_MESSAGE_LEN);
  }
  return null;
}

export function decideVoice(event: NotifiableEvent, settings: VoiceSettings): VoiceDecision {
  if (!settings.enabled) return { shouldSpeak: false, reason: 'disabled' };
  if (event.kind === 'seismic') {
    const tier = tierForMagnitude(event.magnitude);
    if (!tier || !tierAtLeast(tier, 'TIER_4')) {
      return { shouldSpeak: false, reason: 'tier-below-threshold' };
    }
  } else if (event.kind === 'cap') {
    if (event.severity !== 'Extreme' || event.urgency !== 'Immediate') {
      return { shouldSpeak: false, reason: 'cap-not-extreme-immediate' };
    }
  } else {
    return { shouldSpeak: false, reason: 'event-kind-not-spoken' };
  }
  const message = buildVoiceMessage(event);
  if (!message) return { shouldSpeak: false, reason: 'event-kind-not-spoken' };
  return { shouldSpeak: true, message };
}

// ── Settings (localStorage) ──────────────────────────────────────────────────

export function getVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      enabled: parsed.enabled === true,
      voice: typeof parsed.voice === 'string' && parsed.voice.length > 0 ? parsed.voice : DEFAULT_VOICE_SETTINGS.voice,
      rate: typeof parsed.rate === 'number' && Number.isFinite(parsed.rate) ? parsed.rate : DEFAULT_VOICE_SETTINGS.rate,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore quota / unavailable storage */ }
}

// ── Side-effecting dispatch ──────────────────────────────────────────────────

export interface FireVoiceOptions {
  /** Override for tests; defaults to the Tauri invoke path. */
  speak?: (message: string, voice: string, rate: number) => Promise<void>;
}

async function defaultSpeak(text: string, voice: string, rate: number): Promise<void> {
  if (!isDesktopRuntime()) return;
  await tryInvokeTauri<void>('speak_aloud', { text, voice, rate });
}

export async function fireVoiceForEvent(
  event: NotifiableEvent,
  settings: VoiceSettings,
  opts: FireVoiceOptions = {},
): Promise<{ spoken: boolean; reason?: string }> {
  const decision = decideVoice(event, settings);
  if (!decision.shouldSpeak || !decision.message) {
    return { spoken: false, reason: decision.reason };
  }
  const speak = opts.speak ?? defaultSpeak;
  await speak(decision.message, settings.voice, settings.rate);
  return { spoken: true };
}
