/**
 * App Mode Manager — Ghost / God's Vision (manual only).
 *
 * Mode is purely manual. All auto-trigger logic has been removed; data feeds
 * stay intact but no longer drive mode transitions.
 */

import { buildPrimaryCommsMessage } from '@/services/comms-plan';

/**
 * Canonical modes: 'ghost' and 'gods-vision'. `null` represents the default
 * (no special mode) state — formerly the "peace" sentinel. All peace/finance/
 * war/disaster behaviors have been inlined into the default (null) state.
 */
export type AppMode = 'ghost' | 'gods-vision';

const MODE_STORAGE_KEY = 'wm-app-mode';

let currentMode: AppMode | null = null;
let _preGhostMode: AppMode | null = null;

export function getMode(): AppMode | null {
  return currentMode;
}

export function setMode(mode: AppMode | null, auto = false): void {
  if (mode === currentMode) return;
  const prev = currentMode;
  currentMode = mode;
  try {
    if (mode) localStorage.setItem(MODE_STORAGE_KEY, mode);
    else localStorage.removeItem(MODE_STORAGE_KEY);
  } catch { /* ignore */ }

  document.dispatchEvent(
    new CustomEvent<ModeChangedDetail>('wm:mode-changed', {
      detail: { mode, prev, auto },
    }),
  );
}

export function initMode(): AppMode | null {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'ghost' || saved === 'gods-vision') {
      currentMode = saved;
    }
  } catch { /* ignore */ }
  return currentMode;
}

export function alertFamily(): void {
  navigator.clipboard.writeText(buildPrimaryCommsMessage('safe')).catch(() => { /* ignore */ });
}

export function toggleGhostMode(): void {
  if (currentMode === 'ghost') {
    setMode(_preGhostMode);
  } else {
    _preGhostMode = currentMode;
    setMode('ghost');
  }
}

export function isGodsVisionMode(): boolean {
  return currentMode === 'gods-vision';
}

export function isGhostMode(): boolean {
  return currentMode === 'ghost';
}

export function getGhostRefreshMultiplier(): number {
  return currentMode === 'ghost' ? 5 : 1;
}

export interface ModeChangedDetail {
  mode: AppMode | null;
  prev: AppMode | null;
  auto: boolean;
}

export interface WarScoreDetail {
  score: number;
  threshold: number;
}
