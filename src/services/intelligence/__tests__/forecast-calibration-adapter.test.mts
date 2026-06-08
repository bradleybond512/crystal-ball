import assert from 'node:assert/strict';
import test from 'node:test';

import { brierScore, createForecastCalibrationStore } from '../forecast-calibration.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

function makeRecord(id: string, probability: number, outcome: boolean): PredictionRecord {
  return {
    id,
    sourceId: 'test',
    domain: 'general',
    claim: 'test claim',
    probability,
    predictedAt: 1_000_000,
    resolveBy: 2_000_000,
    status: outcome ? 'resolved_true' : 'resolved_false',
    resolvedAt: 1_500_000,
  };
}

function boostMultiplierFromRecords(records: PredictionRecord[]): number {
  const resolved = records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
  if (resolved.length < 5) return 1.0;
  const result = brierScore(resolved);
  if (result.score <= 0.10) return 1.2;
  if (result.score <= 0.20) return 1.0;
  if (result.score <= 0.30) return 0.7;
  return 0.4;
}

test('empty store returns 1.0', () => {
  const store = createForecastCalibrationStore();
  const result = boostMultiplierFromRecords(store.all());
  assert.equal(result, 1.0);
});

test('fewer than 5 resolved records returns 1.0', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 4; i++) {
    store.record(makeRecord(`r${i}`, 0.95, true));
  }
  const result = boostMultiplierFromRecords(store.all());
  assert.equal(result, 1.0);
});

test('5+ sharp records (Brier <= 0.10) returns 1.2', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 5; i++) {
    store.record(makeRecord(`r${i}`, 0.95, true));
  }
  const records = store.all();
  const bs = brierScore(records);
  assert.ok(bs.score <= 0.10, `expected brier <= 0.10, got ${bs.score}`);
  const result = boostMultiplierFromRecords(records);
  assert.equal(result, 1.2);
});

test('5+ poor records (Brier > 0.30) returns 0.4', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 5; i++) {
    store.record(makeRecord(`p${i}`, 0.95, false));
  }
  const records = store.all();
  const bs = brierScore(records);
  assert.ok(bs.score > 0.30, `expected brier > 0.30, got ${bs.score}`);
  const result = boostMultiplierFromRecords(records);
  assert.equal(result, 0.4);
});
