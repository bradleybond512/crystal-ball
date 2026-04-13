/**
 * Alerting preferences — three named presets that control which reaction
 * channels fire on a hot alert. Persisted to localStorage.
 *
 *   loud   — sound + border flash + map pulse + panel flash + desktop notif
 *   visual — everything except sound
 *   silent — panel flash + map pulse only (no border flash, no sound, no notif)
 */

const STORAGE_KEY = 'crystalball-alerting-preset-v1';
const QUIET_HOURS_KEY = 'crystalball-quiet-hours-v1';

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

export interface QuietHours { startHour: number; endHour: number; enabled: boolean; }

export function getQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem(QUIET_HOURS_KEY);
    if (raw) return JSON.parse(raw) as QuietHours;
  } catch { /* noop */ }
  return { startHour: 22, endHour: 7, enabled: false };
}

export function setQuietHours(q: QuietHours): void {
  try { localStorage.setItem(QUIET_HOURS_KEY, JSON.stringify(q)); } catch { /* full */ }
}

function inQuietHours(): boolean {
  const q = getQuietHours();
  if (!q.enabled) return false;
  const h = new Date().getHours();
  if (q.startHour < q.endHour) return h >= q.startHour && h < q.endHour;
  // Wraps midnight (e.g. 22 → 7)
  return h >= q.startHour || h < q.endHour;
}

export function getChannels(): AlertingChannels {
  const base = PRESETS[getPreset()];
  if (inQuietHours()) {
    // Force visual: drop sound + border flash + desktop notif
    return { ...base, sound: false, borderFlash: false, desktopNotif: false };
  }
  return base;
}
