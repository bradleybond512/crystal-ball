// 24/7 always-on operation: keep the reasoning + refresh loops running at full
// cadence even when the window is hidden (macOS, via the native set_always_on
// command). Default ON; user-disableable. See
// docs/superpowers/specs/2026-06-02-always-on-reasoning-design.md.

import { tryInvokeTauri } from './tauri-bridge';

const KEY = 'cb-always-on';

/** Default ON: a missing/blank setting means always-on. */
export function isAlwaysOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAlwaysOnSetting(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/** Push the current (or given) setting to the native layer. Safe off-desktop. */
export async function applyAlwaysOn(enabled: boolean = isAlwaysOn()): Promise<void> {
  await tryInvokeTauri('set_always_on', { enabled });
}

/** Persist + apply in one call (for the settings toggle). */
export async function setAlwaysOn(enabled: boolean): Promise<void> {
  setAlwaysOnSetting(enabled);
  await applyAlwaysOn(enabled);
}
