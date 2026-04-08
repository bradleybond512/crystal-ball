/**
 * Alerting preferences — three named presets that control which reaction
 * channels fire on a hot alert. Persisted to localStorage.
 *
 *   loud   — sound + border flash + map pulse + panel flash + desktop notif
 *   visual — everything except sound
 *   silent — panel flash + map pulse only (no border flash, no sound, no notif)
 */

const STORAGE_KEY = 'crystalball-alerting-preset-v1';

export type AlertingPreset = 'loud' | 'visual' | 'silent';

export interface AlertingChannels {
  sound: boolean;
  borderFlash: boolean;
  desktopNotif: boolean;
  mapPulse: boolean;
  panelFlash: boolean;
}

const PRESETS: Record<AlertingPreset, AlertingChannels> = {
  loud:   { sound: true,  borderFlash: true,  desktopNotif: true,  mapPulse: true, panelFlash: true },
  visual: { sound: false, borderFlash: true,  desktopNotif: true,  mapPulse: true, panelFlash: true },
  silent: { sound: false, borderFlash: false, desktopNotif: false, mapPulse: true, panelFlash: true },
};

let cached: AlertingPreset | null = null;

export function getPreset(): AlertingPreset {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) as AlertingPreset | null;
    cached = (raw === 'loud' || raw === 'visual' || raw === 'silent') ? raw : 'loud';
  } catch { cached = 'loud'; }
  return cached!;
}

export function setPreset(preset: AlertingPreset): void {
  cached = preset;
  try { localStorage.setItem(STORAGE_KEY, preset); } catch { /* full */ }
  document.dispatchEvent(new CustomEvent('cb:alerting-preset-changed', { detail: preset }));
}

export function getChannels(): AlertingChannels {
  return PRESETS[getPreset()];
}
