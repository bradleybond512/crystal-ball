 
/**
 * Forecast accuracy tracker — logs predictions from the EMA forecast and
 * situation forecaster, then checks 24h later whether they materialized.
 * Builds a rolling accuracy score visible in the Status Overlay.
 *
 * A prediction is "hit" if the region's alert count increased by ≥50%
 * within the forecast horizon, or "miss" if it didn't.
 */

import { forecastRegions } from './ema-forecast';
import { logDebug } from './reasoning-debug';
import { unifiedAlertStore } from './unified-alerts';

const STORAGE_KEY = 'crystalball-forecast-accuracy-v1';
const CHECK_MS = 60 * 60_000;        // check every hour
const FORECAST_HORIZON_MS = 24 * 60 * 60_000;
const MAX_PREDICTIONS = 100;

interface Prediction {
  id: string;
  region: string;
  risk24h: number;
  baselineCount: number;
  createdAt: number;
  resolvedAt?: number;
  hit?: boolean;
}

interface AccuracyStore {
  predictions: Prediction[];
  totalHits: number;
  totalMisses: number;
}

let store: AccuracyStore = { predictions: [], totalHits: 0, totalMisses: 0 };

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    store = JSON.parse(raw) as AccuracyStore;
  } catch { /* noop */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* noop */ }
}

function logPredictions(): void {
  const regions = forecastRegions().filter(r => r.risk24h >= 65);
  const now = Date.now();

  for (const r of regions) {
    const existingRecent = store.predictions.some(
      p => p.region === r.region && !p.resolvedAt && now - p.createdAt < FORECAST_HORIZON_MS,
    );
    if (existingRecent) continue;

    store.predictions.push({
      id: `pred-${r.region}-${now}`,
      region: r.region,
      risk24h: r.risk24h,
      baselineCount: r.currentCount,
      createdAt: now,
    });
  }

  // Trim old predictions.
  if (store.predictions.length > MAX_PREDICTIONS) {
    store.predictions = store.predictions.slice(-MAX_PREDICTIONS);
  }
}

function checkPredictions(): void {
  const now = Date.now();
  const alertsByRegion = new Map<string, number>();

  // Count recent alerts per rough region (using location label).
  const recent = unifiedAlertStore.getAll().filter(a => now - a.timestamp < FORECAST_HORIZON_MS);
  for (const a of recent) {
    const label = a.location?.label ?? 'unknown';
    alertsByRegion.set(label, (alertsByRegion.get(label) ?? 0) + 1);
  }

  for (const pred of store.predictions) {
    if (pred.resolvedAt) continue;
    if (now - pred.createdAt < FORECAST_HORIZON_MS) continue;

    // Check if the prediction materialized.
    const currentCount = alertsByRegion.get(pred.region) ?? 0;
    const threshold = Math.max(pred.baselineCount * 1.5, pred.baselineCount + 2);
    pred.hit = currentCount >= threshold;
    pred.resolvedAt = now;

    if (pred.hit) store.totalHits += 1;
    else store.totalMisses += 1;
  }
  save();
}

export interface ForecastAccuracy {
  totalPredictions: number;
  hits: number;
  misses: number;
  pending: number;
  accuracy: number;   // 0–100
}

export function getForecastAccuracy(): ForecastAccuracy {
  const resolved = store.totalHits + store.totalMisses;
  const pending = store.predictions.filter(p => !p.resolvedAt).length;
  return {
    totalPredictions: store.predictions.length,
    hits: store.totalHits,
    misses: store.totalMisses,
    pending,
    accuracy: resolved > 0 ? Math.round((store.totalHits / resolved) * 100) : 0,
  };
}

let started = false;
function runChecks(): void {
  try { logPredictions(); checkPredictions(); } catch (error) {
    logDebug({ level: 'warn', category: 'other', source: 'forecast-accuracy', message: 'error', data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

export function startForecastAccuracy(): void {
  if (started) return;
  started = true;
  load();
  window.setTimeout(runChecks, 30_000);
  window.setInterval(runChecks, CHECK_MS);
}
