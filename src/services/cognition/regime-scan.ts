/**
 * Regime scan — surface the previously-dark BOCPD regime detector over the
 * HUD's per-domain pressure history.
 *
 * Recovered from commit 0ced5cff (lost in a rebase) as part of the Wave 5a
 * feature-surfacing pass.
 *
 * Runs a *fresh* detector across each domain's bounded pressure series and
 * returns the most-recent regime shift per domain, but only when that shift
 * landed within the last `RECENT_TAIL` samples (so stale shifts from earlier in
 * the series don't linger on the UI). Pure: the caller supplies the history;
 * no DOM, no fetch, no module-level state.
 */

import { createRegimeDetector, type RegimeShift } from './regime-detection';
import type { ForecastDomain } from '@/services/mode-forecast';
import type { PressureSample } from '@/services/pressure-history';

const RECENT_TAIL = 5;

export function scanRegimeShifts(
  history: Partial<Record<ForecastDomain, PressureSample[]>>,
): Partial<Record<ForecastDomain, RegimeShift>> {
  const out: Partial<Record<ForecastDomain, RegimeShift>> = {};
  for (const domain of Object.keys(history) as ForecastDomain[]) {
    const series = history[domain] ?? [];
    if (series.length < 2) continue;
    const detector = createRegimeDetector();
    let latest: RegimeShift | null = null;
    for (const s of series) {
      const shift = detector.feed(domain, s.value, s.timestamp);
      if (shift) latest = shift;
    }
    if (!latest) continue;
    const tailStart = series[Math.max(0, series.length - RECENT_TAIL)]!;
    if (latest.detectedAt >= tailStart.timestamp) out[domain] = latest;
  }
  return out;
}
