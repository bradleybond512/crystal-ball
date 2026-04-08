/**
 * App Mode Manager — Ghost / God's Vision (manual only).
 *
 * Mode is purely manual. All auto-trigger logic has been removed; data feeds
 * stay intact but no longer drive mode transitions.
 */

import type { CorrelationSignal } from '@/services/correlation';
import type { MarketData, CryptoData } from '@/types';
import type { GDACSEvent } from '@/services/gdacs';
import type { Earthquake } from '@/services/earthquakes';
import type { StormPreparednessSummary } from '@/services/storm-preparedness';
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

// All former auto-trigger evaluators kept as no-ops for compatibility.
export function evaluateWarThreat(_signals: CorrelationSignal[]): void { /* no-op */ }
export function evaluateFinanceTrigger(_markets: MarketData[], _crypto: CryptoData[]): void { /* no-op */ }
export function checkFinanceAutoTriggerTimeout(): void { /* no-op */ }
export function evaluateCommodityTrigger(_commodities: MarketData[]): void { /* no-op */ }
export function evaluateDisasterTrigger(
  _gdacs: GDACSEvent[],
  _earthquakes: Earthquake[],
  _stormSummary?: StormPreparednessSummary | null,
): void { /* no-op */ }
export function reloadConflictBaselines(): void { /* no-op */ }

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
