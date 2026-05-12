/**
 * Situational Mode Manager — monitoring / alert / investigation / briefing.
 *
 * Orthogonal to the operational modes in src/services/mode-manager.ts
 * (ghost / gods-vision). Both can be active simultaneously.
 *
 * Body attribute: data-mode="monitoring|alert|investigation|briefing"
 * localStorage key: wm-situational-mode
 * DOM event: wm:situational-mode-changed
 */

export type SituationalMode =
  | 'monitoring'
  | 'alert'
  | 'investigation'
  | 'briefing'
  /**
   * Operator — manually toggled dense layout for repeated serious use.
   * Never auto-triggered. Once set, stays active until the user exits.
   * Auto-mode logic preserves Operator the same way it preserves
   * Investigation.
   */
  | 'operator';

const STORAGE_KEY = 'wm-situational-mode';
const QUIET_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 h

let _current: SituationalMode = 'monitoring';
let _manual = false;

/** Restore persisted mode from localStorage. Call once at app boot. */
export function initSituationalMode(): SituationalMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (
      saved === 'monitoring' ||
      saved === 'alert' ||
      saved === 'investigation' ||
      saved === 'briefing' ||
      saved === 'operator'
    ) {
      _current = saved;
      _manual = true;
    }
  } catch { /* ignore */ }
  return _current;
}

export function getCurrentMode(): SituationalMode {
  return _current;
}

export function isAutoMode(): boolean {
  return !_manual;
}

/** Manual override — marks the mode as user-chosen and persists it. */
export function setMode(mode: SituationalMode): void {
  _manual = true;
  _applyMode(mode, false);
}

/**
 * Apply an auto-computed mode. No-ops when the user has set a manual override,
 * except that auto can always pull OUT of 'investigation' once no investigation
 * has been manually re-confirmed (cleared via clearManualMode()).
 */
export function setAutoMode(mode: SituationalMode): void {
  if (_manual) return;
  _applyMode(mode, true);
}

/** Remove the manual override so auto-mode can take over. */
export function clearManualMode(): void {
  _manual = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Minimal shape required — satisfied by both UnifiedAlert and ObservationEvent. */
export interface AlertLike {
  severity: string;
  timestamp: number;
}

/**
 * Compute the best auto-mode given current active alerts.
 *
 * Priority order:
 *   1. User manually set 'investigation' → preserve it
 *   2. Any CRITICAL alert → 'alert'
 *   3. No alerts in the last 2h → 'briefing'
 *   4. Default → 'monitoring'
 */
export function getAutoMode(alerts: AlertLike[], now = Date.now()): SituationalMode {
  // Manually-set modes that auto-mode must NEVER override. Operator is
  // explicitly user-controlled per spec; Investigation matches existing
  // behaviour.
  if (_manual && (_current === 'investigation' || _current === 'operator')) return _current;

  const hasCritical = alerts.some((a) => a.severity === 'critical');
  if (hasCritical) return 'alert';

  const recentCount = alerts.filter((a) => now - a.timestamp <= QUIET_THRESHOLD_MS).length;
  if (recentCount === 0) return 'briefing';

  return 'monitoring';
}

export interface SituationalModeChangedDetail {
  mode: SituationalMode;
  prev: SituationalMode;
  auto: boolean;
}

function _applyMode(mode: SituationalMode, auto: boolean): void {
  const prev = _current;
  if (mode === prev) return;
  _current = mode;

  try {
    if (auto) {localStorage.removeItem(STORAGE_KEY);}
    else {localStorage.setItem(STORAGE_KEY, mode);}
  } catch { /* ignore */ }

  document.dispatchEvent(
    new CustomEvent<SituationalModeChangedDetail>('wm:situational-mode-changed', {
      detail: { mode, prev, auto },
    }),
  );
}

/** Reset internal state. Tests and storybook only. */
export function resetSituationalModeState(): void {
  _current = 'monitoring';
  _manual = false;
}
