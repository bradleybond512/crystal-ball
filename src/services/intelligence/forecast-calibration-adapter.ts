import { brierScore, createForecastCalibrationStore } from './forecast-calibration';
import type { ForecastCalibrationStore } from './forecast-calibration';

let _calibrationStore: ForecastCalibrationStore | null = null;

export function getCalibrationStore(): ForecastCalibrationStore {
  _calibrationStore ??= createForecastCalibrationStore();
  return _calibrationStore;
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
