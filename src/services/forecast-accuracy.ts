 
/**
 * Forecast accuracy tracker — logs predictions from the EMA forecast and
 * situation forecaster, then checks 24h later whether they materialized.
 * Builds a rolling accuracy score visible in the Status Overlay.
 *
 * A prediction is "hit" if the region's alert count increased by ≥50%
 * within the forecast horizon, or "miss" if it didn't.
 */

import { forecastRegions } from './ema-forecast';
import { captureEvidence, notifyEvidenceChanged } from './intelligence/evidence-bus';
import { logDebug } from './reasoning-debug';
import { unifiedAlertStore } from './unified-alerts';

const STORAGE_KEY = 'crystalball-forecast-accuracy-v1';
const CHECK_MS = 60 * 60_000;        // check every hour
const FORECAST_HORIZON_MS = 24 * 60 * 60_000;
const MAX_PREDICTIONS = 100;
export const FORECAST_ACCURACY_MAX_PREDICTIONS = MAX_PREDICTIONS;

export interface ForecastAccuracyPrediction {
  id: string;
  region: string;
  risk24h: number;
  baselineCount: number;
  createdAt: number;
  resolvedAt?: number;
  hit?: boolean;
}

export interface ForecastAccuracyTotals {
  totalHits: number;
  totalMisses: number;
  /** When the totals last changed; keys the evidence-journal snapshot. */
  updatedAt?: number;
}

interface AccuracyStore {
  predictions: ForecastAccuracyPrediction[];
  totalHits: number;
  totalMisses: number;
  totalsUpdatedAt?: number;
}

function emptyStore(): AccuracyStore {
  return { predictions: [], totalHits: 0, totalMisses: 0 };
}

let store: AccuracyStore = emptyStore();
let loaded = false;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePrediction(value: unknown): ForecastAccuracyPrediction | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.region !== 'string') return null;
  if (!finiteNumber(p.risk24h) || !finiteNumber(p.baselineCount) || !finiteNumber(p.createdAt)) return null;
  const out: ForecastAccuracyPrediction = {
    id: p.id,
    region: p.region,
    risk24h: p.risk24h,
    baselineCount: p.baselineCount,
    createdAt: p.createdAt,
  };
  if (finiteNumber(p.resolvedAt) && typeof p.hit === 'boolean') {
    out.resolvedAt = p.resolvedAt;
    out.hit = p.hit;
  }
  return out;
}

function count(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

/** Validate a persisted blob (R4-LOW-008): a corrupt or tampered value used to
 *  be cast straight to AccuracyStore and made getForecastAccuracy() throw. */
function parseStore(raw: unknown): AccuracyStore {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const blob = raw as Record<string, unknown>;
  const predictions = Array.isArray(blob.predictions)
    ? blob.predictions.map((p) => parsePrediction(p)).filter((p): p is ForecastAccuracyPrediction => p !== null)
    : [];
  for (const record of predictions) captureEvidence({ kind: 'ema-forecast', record });
  const parsed: AccuracyStore = {
    predictions: predictions.slice(-MAX_PREDICTIONS),
    totalHits: count(blob.totalHits),
    totalMisses: count(blob.totalMisses),
  };
  if (finiteNumber(blob.totalsUpdatedAt)) parsed.totalsUpdatedAt = blob.totalsUpdatedAt;
  captureEvidence({ kind: 'ema-forecast-totals', record: { totalHits: parsed.totalHits, totalMisses: parsed.totalMisses,
    updatedAt: parsed.totalsUpdatedAt ?? predictions.reduce<number | undefined>((max, p) => p.resolvedAt !== undefined && (max === undefined || p.resolvedAt > max) ? p.resolvedAt : max, undefined) } });
  return parsed;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    store = parseStore(JSON.parse(raw));
  } catch {
    store = emptyStore();
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    notifyEvidenceChanged('ema-forecast');
  } catch { /* noop */ }
}

function logPredictions(): void {
  const regions = forecastRegions().filter(r => r.risk24h >= 65);
  const now = Date.now();

  for (const r of regions) {
    const existingRecent = store.predictions.some(
      p => p.region === r.region && !p.resolvedAt && now - p.createdAt < FORECAST_HORIZON_MS,
    );
    if (existingRecent) continue;

    const prediction: ForecastAccuracyPrediction = {
      id: `pred-${r.region}-${now}`,
      region: r.region,
      risk24h: r.risk24h,
      baselineCount: r.currentCount,
      createdAt: now,
    };
    captureEvidence({ kind: 'ema-forecast', record: prediction });
    store.predictions.push(prediction);
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
    store.totalsUpdatedAt = now;
    captureEvidence({ kind: 'ema-forecast', record: pred });
    captureEvidence({ kind: 'ema-forecast-totals', record: { totalHits: store.totalHits, totalMisses: store.totalMisses, updatedAt: now } });
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

/** Copy of the working set for the evidence journal (R4-LOW-008). */
export function getForecastAccuracyEvidence(): {
  predictions: ForecastAccuracyPrediction[];
  totals: ForecastAccuracyTotals;
} {
  load();
  const predictions = store.predictions.map((p) => ({ ...p }));
  // Legacy stores never recorded when totals changed; the newest resolution
  // is a stable stand-in until the next hit or miss sets it for real.
  const newestResolution = predictions.reduce<number | undefined>(
    (max, p) => (p.resolvedAt !== undefined && (max === undefined || p.resolvedAt > max) ? p.resolvedAt : max),
    undefined,
  );
  return {
    predictions,
    totals: {
      totalHits: store.totalHits,
      totalMisses: store.totalMisses,
      updatedAt: store.totalsUpdatedAt ?? newestResolution,
    },
  };
}

/**
 * Merge predictions and totals rebuilt from the evidence journal after the
 * local blob was lost. Existing predictions win; totals are monotonic
 * counters, so the larger snapshot wins. Returns how many predictions were added.
 */
export function mergeRebuiltForecastAccuracy(
  predictions: readonly ForecastAccuracyPrediction[],
  totals?: ForecastAccuracyTotals | null,
): number {
  load();
  const known = new Set(store.predictions.map((p) => p.id));
  const added = predictions.filter((p) => !known.has(p.id)).map((p) => ({ ...p }));
  let changed = added.length > 0;
  if (changed) {
    for (const record of added) captureEvidence({ kind: 'ema-forecast', record });
    store.predictions = [...store.predictions, ...added]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_PREDICTIONS);
  }
  if (totals && totals.totalHits + totals.totalMisses > store.totalHits + store.totalMisses) {
    store.totalHits = totals.totalHits;
    store.totalMisses = totals.totalMisses;
    if (totals.updatedAt !== undefined) store.totalsUpdatedAt = totals.updatedAt;
    captureEvidence({ kind: 'ema-forecast-totals', record: totals });
    changed = true;
  }
  if (changed) save();
  return added.length;
}

/** Test seam: forget the in-memory store so the next call reloads it. */
export function __resetForecastAccuracyForTests(): void {
  store = emptyStore();
  loaded = false;
  started = false;
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
