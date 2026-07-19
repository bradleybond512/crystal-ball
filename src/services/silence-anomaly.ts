/**
 * Silence anomaly detector — flags when the overall alert rate drops
 * significantly below its rolling baseline, which may indicate a
 * connectivity issue or an unusual calm before a storm.
 */

import { unifiedAlertStore } from './unified-alerts';
import { logDebug } from './reasoning-debug';

const SCAN_INTERVAL = 3 * 60_000;
const BASELINE_WINDOW_MS = 24 * 60 * 60_000;
const RECENT_WINDOW_MS = 30 * 60_000;
const SILENCE_THRESHOLD = 0.2;
const COOLDOWN_MS = 30 * 60_000;

let lastAnomalyTs = 0;
const rateSamples: { ts: number; rate: number }[] = [];

function safeScan(): void {
  try { scan(); } catch (error) {
    logDebug({ level: 'warn', category: 'other', source: 'silence-anomaly', message: 'scan error', data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

function scan(): void {
  const now = Date.now();
  const all = unifiedAlertStore.getAll();

  const baselineAlerts = all.filter(a => now - a.timestamp < BASELINE_WINDOW_MS);
  const recentAlerts = all.filter(a => now - a.timestamp < RECENT_WINDOW_MS);

  const baselineRate = baselineAlerts.length / (BASELINE_WINDOW_MS / RECENT_WINDOW_MS);
  const recentRate = recentAlerts.length;

  rateSamples.push({ ts: now, rate: recentRate });
  if (rateSamples.length > 100) rateSamples.shift();

  if (baselineRate < 5) return;

  const ratio = recentRate / baselineRate;
  if (ratio < SILENCE_THRESHOLD && now - lastAnomalyTs > COOLDOWN_MS) {
    lastAnomalyTs = now;
    document.dispatchEvent(new CustomEvent('cb:silence-anomaly', {
      detail: {
        recentCount: recentRate,
        baselineExpected: Math.round(baselineRate),
        ratio: Math.round(ratio * 100),
        message: `Alert rate dropped to ${Math.round(ratio * 100)}% of baseline (${recentRate} vs expected ~${Math.round(baselineRate)})`,
      },
    }));
  }
}

export interface SilenceStatus {
  currentRate: number;
  baselineRate: number;
  ratio: number;
  isSilent: boolean;
}

export function getSilenceStatus(): SilenceStatus {
  const now = Date.now();
  const all = unifiedAlertStore.getAll();
  const baselineAlerts = all.filter(a => now - a.timestamp < BASELINE_WINDOW_MS);
  const recentAlerts = all.filter(a => now - a.timestamp < RECENT_WINDOW_MS);
  const baselineRate = baselineAlerts.length / (BASELINE_WINDOW_MS / RECENT_WINDOW_MS);
  const recentRate = recentAlerts.length;
  const ratio = baselineRate > 0 ? recentRate / baselineRate : 1;
  return {
    currentRate: recentRate,
    baselineRate: Math.round(baselineRate),
    ratio: Math.round(ratio * 100) / 100,
    isSilent: ratio < SILENCE_THRESHOLD && baselineRate >= 5,
  };
}

let started = false;
export function startSilenceAnomaly(): void {
  if (started) return;
  started = true;
  window.setInterval(safeScan, SCAN_INTERVAL);
  window.setTimeout(safeScan, 15_000);
}
