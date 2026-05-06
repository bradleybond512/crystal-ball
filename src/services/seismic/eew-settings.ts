/**
 * EEW alert settings — Layer 8.
 *
 * Per-tier delivery toggles + the master iMessage TIER_5 toggle.
 * Persisted in localStorage so they survive reload. Web build can read
 * them too — this module is intentionally desktop-agnostic.
 *
 * Defaults: every tier enabled, iMessage TIER_5 enabled. The user can
 * mute any tier from the EEW Status Bar (Layer 9) without touching
 * code.
 */

import type { EewTier } from './eew-alert-engine';

const SETTINGS_KEY = 'crystalball-eew-settings';

export interface EewSettings {
  tierEnabled: Record<EewTier, boolean>;
  imessageTier5Enabled: boolean;
}

const DEFAULTS: EewSettings = {
  tierEnabled: {
    TIER_1_INFO: true,
    TIER_2_WATCH: true,
    TIER_3_WARNING: true,
    TIER_4_SEVERE: true,
    TIER_5_EXTREME: true,
  },
  imessageTier5Enabled: true,
};

export function getEewSettings(): EewSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw) as Partial<EewSettings>;
    return mergeWithDefaults(parsed);
  } catch {
    return cloneDefaults();
  }
}

export function saveEewSettings(settings: EewSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* localStorage may be unavailable */ }
}

/**
 * Filter alerts down to the tiers the user has enabled. Pure — call
 * after the engine emits and before pushing to the sidecar / iMessage.
 */
export function filterAlertsByTierToggles<T extends { tier: EewTier }>(
  alerts: readonly T[],
  settings: EewSettings,
): T[] {
  return alerts.filter((a) => settings.tierEnabled[a.tier] !== false);
}

// ── Internals (test-visible) ───────────────────────────────────────────

export function cloneDefaults(): EewSettings {
  return {
    tierEnabled: { ...DEFAULTS.tierEnabled },
    imessageTier5Enabled: DEFAULTS.imessageTier5Enabled,
  };
}

export function mergeWithDefaults(parsed: Partial<EewSettings>): EewSettings {
  const tierEnabled = { ...DEFAULTS.tierEnabled };
  if (parsed.tierEnabled && typeof parsed.tierEnabled === 'object') {
    for (const tier of Object.keys(tierEnabled) as EewTier[]) {
      const value = (parsed.tierEnabled as Partial<Record<EewTier, unknown>>)[tier];
      if (typeof value === 'boolean') tierEnabled[tier] = value;
    }
  }
  return {
    tierEnabled,
    imessageTier5Enabled: typeof parsed.imessageTier5Enabled === 'boolean'
      ? parsed.imessageTier5Enabled
      : DEFAULTS.imessageTier5Enabled,
  };
}
