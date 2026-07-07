/**
 * Regime monitor — stateful wrapper that keeps the BOCPD regime-scan results
 * available to every UI surface (TriageBar chip, AnalystHUD advisory badge)
 * without each of them re-running the detector per render.
 *
 * Subscribes to pressure-history updates, re-scans (throttled), caches the
 * active shifts, and announces NEW detections once via the injectable
 * `notify` callback + a `cb:regime-shift-detected` document event.
 *
 * Kill-switch: reads `isCognitionEnabled('bocpd')` on every scan — turning
 * the switch off empties the cache on the next tick and stops detection
 * work; no restart required. Fail-safe ON (see cognition-settings.ts).
 */

import { scanRegimeShifts } from './regime-scan';
import type { RegimeShift } from './regime-detection';
import { isCognitionEnabled } from './cognition-settings';
import { getPressureHistory, subscribePressureHistory } from '@/services/pressure-history';
import type { ForecastDomain } from '@/services/mode-forecast';

export interface RegimeNotification {
  domain: ForecastDomain;
  shift: RegimeShift;
}

export const REGIME_SHIFT_EVENT = 'cb:regime-shift-detected';

/** Re-scan at most once per interval — pressure samples land ~minutely. */
const SCAN_THROTTLE_MS = 60_000;

let _started = false;
let _lastScanAt = 0;
let _active: Partial<Record<ForecastDomain, RegimeShift>> = {};
/** detectedAt of the last shift announced per domain (new-detection dedupe). */
const _announced = new Map<ForecastDomain, number>();
let _notify: ((n: RegimeNotification) => void) | null = null;

function rescan(force = false): void {
  const now = Date.now();
  if (!force && now - _lastScanAt < SCAN_THROTTLE_MS) return;
  _lastScanAt = now;

  if (!isCognitionEnabled('bocpd')) {
    _active = {};
    return;
  }

  try {
    const shifts = scanRegimeShifts(getPressureHistory());
    _active = shifts;
    for (const domain of Object.keys(shifts) as ForecastDomain[]) {
      const shift = shifts[domain];
      if (!shift) continue;
      if (_announced.get(domain) === shift.detectedAt) continue;
      _announced.set(domain, shift.detectedAt);
      try {
        _notify?.({ domain, shift });
      } catch { /* notification must never break the scan */ }
      try {
        document.dispatchEvent(new CustomEvent<RegimeNotification>(REGIME_SHIFT_EVENT, {
          detail: { domain, shift },
        }));
      } catch { /* non-browser environments */ }
    }
  } catch {
    // Detector errors must never crash the pressure-history pipeline.
    _active = {};
  }
}

/**
 * Start the monitor (idempotent). `notify` fires once per new detection —
 * panel-layout passes a toast-backed callback so the service layer stays
 * free of component imports.
 */
export function startRegimeMonitor(opts?: { notify?: (n: RegimeNotification) => void }): void {
  if (opts?.notify) _notify = opts.notify;
  if (_started) return;
  _started = true;
  subscribePressureHistory(() => rescan());
  rescan(true);
}

/** Latest scan results — one recent shift per domain, empty when quiet. */
export function getActiveRegimeShifts(): Partial<Record<ForecastDomain, RegimeShift>> {
  // Kill-switch consulted on read too: the scan cache is throttled (60 s),
  // so without this a just-disabled detector could keep a stale chip alive
  // until the next pressure sample lands.
  if (!isCognitionEnabled('bocpd')) return {};
  return _active;
}

/** Test hook: reset module state. */
export function _resetRegimeMonitorForTests(): void {
  _started = false;
  _lastScanAt = 0;
  _active = {};
  _announced.clear();
  _notify = null;
}
