/**
 * Adaptive feed-poll cadence — slow polling down when the context says the user
 * wants quiet or the device wants to save power. Multiplies the refresh
 * scheduler's base interval:
 *
 *   - Silent alerting preset → ×2 (halve poll frequency)
 *   - On battery             → ×2
 *   - Low Power Mode         → ×4 (quarter)
 *
 * Signals do NOT stack (the strongest wins) so a user can't accidentally end up
 * polling once an hour. Combines with Ghost Mode (×5) and the hidden (×10) /
 * backoff (×4) multipliers already in the scheduler.
 */

import { isLowPowerMode } from './low-power';
import { getPreset } from './alerting-prefs';

let _onBattery = false;

interface BatteryLike { charging: boolean; addEventListener: (type: string, cb: () => void) => void }

/** Watch the Battery Status API (where available — WebKit support is partial).
 *  No-ops silently when unsupported, leaving the multiplier at "not on battery". */
export function installBatteryMonitor(): void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof nav.getBattery !== 'function') return;
  nav.getBattery().then((b) => {
    const update = (): void => { _onBattery = !b.charging; };
    update();
    b.addEventListener('chargingchange', update);
  }).catch(() => { /* unsupported / denied — leave _onBattery false */ });
}

/** Test seam. */
export function _setOnBatteryForTest(v: boolean): void { _onBattery = v; }

/**
 * Context-derived poll-interval multiplier (≥1). The strongest active signal
 * wins rather than multiplying, so cadence degrades gracefully.
 */
export function getContextCadenceMultiplier(): number {
  let m = 1;
  try { if (getPreset() === 'silent') m = Math.max(m, 2); } catch { /* ignore */ }
  if (_onBattery) m = Math.max(m, 2);
  try { if (isLowPowerMode()) m = Math.max(m, 4); } catch { /* ignore */ }
  return m;
}
