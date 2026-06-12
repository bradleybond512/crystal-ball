import {
  brierScore,
  createForecastCalibrationStore,
  perDomainAccuracy,
} from './forecast-calibration';
import type { ForecastCalibrationStore, PredictionRecord } from './forecast-calibration';
import type { FactDomain } from './types';

let _calibrationStore: ForecastCalibrationStore | null = null;

const STORAGE_KEY = 'crystalball-forecast-calibration-v1';
const MAX_RECORDS = 500;

function loadPersisted(store: ForecastCalibrationStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) store.loadJson(parsed as PredictionRecord[]);
  } catch { /* corrupted store — start fresh */ }
}

function persist(store: ForecastCalibrationStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = store.all().sort((a, b) => a.predictedAt - b.predictedAt);
    const trimmed = all.slice(Math.max(0, all.length - MAX_RECORDS));
    if (trimmed.length < all.length) store.loadJson(trimmed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota — calibration is best-effort */ }
}

export function getCalibrationStore(): ForecastCalibrationStore {
  if (!_calibrationStore) {
    _calibrationStore = createForecastCalibrationStore();
    loadPersisted(_calibrationStore);
  }
  return _calibrationStore;
}

/** Record + persist in one call. */
export function recordPrediction(p: PredictionRecord): void {
  const store = getCalibrationStore();
  store.record(p);
  persist(store);
}

/** Resolve + persist. Returns false when the id is unknown/already resolved. */
export function resolvePrediction(id: string, outcome: boolean, when?: number): boolean {
  const store = getCalibrationStore();
  const ok = store.resolve(id, outcome, when);
  if (ok) persist(store);
  return ok;
}

/** Expire overdue pending predictions + persist. Returns expired count. */
export function expirePendingPredictions(now?: number): number {
  const store = getCalibrationStore();
  const n = store.expirePending(now);
  if (n > 0) persist(store);
  return n;
}

const MIN_RESOLVED_FOR_DOMAIN_MULT = 10;

/** Per-domain ranking multiplier in [0.7, 1.2] derived from Brier score.
 *  Neutral until ≥10 resolved predictions exist — never punish a cold start. */
export function getDomainCalibrationMult(domain: FactDomain): number {
  const records = getCalibrationStore().all().filter((r) => r.domain === domain);
  const resolved = records.filter(
    (r) => r.status === 'resolved_true' || r.status === 'resolved_false',
  );
  if (resolved.length < MIN_RESOLVED_FOR_DOMAIN_MULT) return 1;
  const acc = perDomainAccuracy(resolved).find((d) => d.domain === domain);
  if (!acc) return 1;
  // brier 0 → 1.2, brier 0.25 → 1.0, brier ≥0.625 → 0.7
  return Math.max(0.7, Math.min(1.2, 1.2 - 0.8 * acc.brier));
}

export function getBoostMultiplier(): number {
  const store = getCalibrationStore();
  const records = store.all();
  const resolved = records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
  if (resolved.length < 5) return 1;
  const result = brierScore(resolved);
  if (result.score <= 0.1) return 1.2;
  if (result.score <= 0.2) return 1;
  if (result.score <= 0.3) return 0.7;
  return 0.4;
}

export function _resetCalibrationForTests(): void { _calibrationStore = null; }
