import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

import {
  toPredictionRecord,
  recordAdvisoryPredictions,
  resolveAdvisoryPrediction,
  resolveAdvisoryFromObservation,
  settleExpiredAdvisoryPredictions,
  advisoryProbability,
  advisoryPredictionId,
  advisoryPredictionClaim,
  advisoryKeyPrefix,
  domainForForecast,
  sourceIdForForecast,
  isEscalated,
  MODE_ESCALATION_THRESHOLD,
} from '../mode-forecast-prediction-bridge.ts';
import type { ForecastDomain, ModeAdvisory } from '../../mode-forecast.ts';
import { getCalibrationStore, recordPrediction, _resetCalibrationForTests } from '../forecast-calibration-adapter.ts';

beforeEach(() => { mem.clear(); _resetCalibrationForTests(); });

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 6, 18, 0, 0, 0); // UTC hour boundary

function advisory(over: Partial<ModeAdvisory> = {}): ModeAdvisory {
  return {
    domain: 'finance' as ForecastDomain,
    pressure: 0.7,
    slope: 0.05,
    etaMin: null,
    statement: 'Finance pressure rising',
    timestamp: NOW,
    ...over,
  };
}

// ── Probability ────────────────────────────────────────────────────────────

test('probability equals the advisory pressure directly', () => {
  assert.equal(advisoryProbability({ pressure: 0.7 }), 0.7);
  assert.equal(advisoryProbability({ pressure: 0.5 }), 0.5);
});

test('probability clamps out-of-range and non-finite pressure', () => {
  assert.equal(advisoryProbability({ pressure: 1.5 }), 1);
  assert.equal(advisoryProbability({ pressure: -0.2 }), 0);
  assert.equal(advisoryProbability({ pressure: Number.NaN }), 0);
});

test('isEscalated uses the mode-forecast advisory threshold', () => {
  assert.equal(MODE_ESCALATION_THRESHOLD, 0.5);
  assert.equal(isEscalated(0.5), true);
  assert.equal(isEscalated(0.49), false);
});

// ── Domain mapping ──────────────────────────────────────────────────────────

test('domain mapping covers all four forecast domains', () => {
  assert.equal(domainForForecast('finance'), 'markets');
  assert.equal(domainForForecast('security'), 'conflict');
  assert.equal(domainForForecast('disaster'), 'humanitarian');
  assert.equal(domainForForecast('cyber'), 'cyber');
});

// ── Id + claim + source ───────────────────────────────────────────────────

test('prediction id is stable within an hourly window and differs across windows', () => {
  assert.equal(advisoryPredictionId('finance', NOW), advisoryPredictionId('finance', NOW + HOUR_MS - 1));
  assert.notEqual(advisoryPredictionId('finance', NOW), advisoryPredictionId('finance', NOW + HOUR_MS));
});

test('key prefix is a prefix of the id', () => {
  const prefix = advisoryKeyPrefix('cyber');
  assert.equal(prefix, 'mode:cyber:');
  assert.ok(advisoryPredictionId('cyber', NOW).startsWith(prefix));
});

test('claim references domain, threshold, and horizon', () => {
  const claim = advisoryPredictionClaim({ domain: 'disaster' });
  assert.match(claim, /disaster/);
  assert.match(claim, new RegExp(`≥${MODE_ESCALATION_THRESHOLD}`));
  assert.match(claim, /24h/);
});

test('sourceId is per-domain', () => {
  assert.equal(sourceIdForForecast('security'), 'mode-forecast:security');
});

// ── toPredictionRecord (pure core) ────────────────────────────────────────

test('toPredictionRecord builds a well-formed pending record', () => {
  const rec = toPredictionRecord(advisory({ domain: 'cyber', pressure: 0.8 }), NOW);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.domain, 'cyber');
  assert.equal(rec.sourceId, 'mode-forecast:cyber');
  assert.equal(rec.predictedAt, NOW);
  assert.equal(rec.resolveBy, NOW + DAY_MS);
  assert.equal(rec.algorithmVersion, '1.0.0');
  assert.equal(rec.targetKey, 'mode:cyber');
  assert.equal(rec.probability, 0.8);
});

// ── recordAdvisoryPredictions (store) ─────────────────────────────────────

test('records one pending prediction per advisory domain', () => {
  recordAdvisoryPredictions([advisory({ domain: 'finance' }), advisory({ domain: 'cyber' })], NOW);
  assert.equal(getCalibrationStore().all().length, 2);
});

test('idempotent within the same hourly window', () => {
  recordAdvisoryPredictions([advisory()], NOW);
  recordAdvisoryPredictions([advisory()], NOW + HOUR_MS - 1);
  assert.equal(getCalibrationStore().all().length, 1);
});

test('a new hour logs a fresh prediction', () => {
  recordAdvisoryPredictions([advisory()], NOW);
  recordAdvisoryPredictions([advisory()], NOW + HOUR_MS);
  assert.equal(getCalibrationStore().all().length, 2);
});

// ── Resolution ────────────────────────────────────────────────────────────

test('resolveAdvisoryPrediction resolves the in-window record and returns its count', () => {
  recordAdvisoryPredictions([advisory({ domain: 'security' })], NOW);
  const n = resolveAdvisoryPrediction('security', true, NOW + HOUR_MS);
  assert.equal(n, 1);
  const rec = getCalibrationStore().all().find((r) => r.sourceId === 'mode-forecast:security')!;
  assert.equal(rec.status, 'resolved_true');
});

test('resolveAdvisoryPrediction returns 0 when nothing is pending', () => {
  assert.equal(resolveAdvisoryPrediction('disaster', true, NOW), 0);
});

test('resolveAdvisoryPrediction grades ALL still-open in-window predictions', () => {
  recordAdvisoryPredictions([advisory({ domain: 'cyber', pressure: 0.6 })], NOW);
  recordAdvisoryPredictions([advisory({ domain: 'cyber', pressure: 0.9 })], NOW + HOUR_MS);
  const n = resolveAdvisoryPrediction('cyber', true, NOW + 2 * HOUR_MS);
  assert.equal(n, 2);
  assert.ok(getCalibrationStore().all().every((r) => r.status === 'resolved_true'));
});

test('an observation after the window closes does not resolve the expired claim', () => {
  recordAdvisoryPredictions([advisory({ domain: 'finance' })], NOW);
  const n = resolveAdvisoryPrediction('finance', true, NOW + 2 * DAY_MS); // past 24h resolveBy
  assert.equal(n, 0);
  assert.equal(getCalibrationStore().all()[0]!.status, 'pending');
});

test('resolveAdvisoryFromObservation resolves true only at/above the escalation threshold', () => {
  recordAdvisoryPredictions([advisory({ domain: 'finance' })], NOW);
  assert.equal(resolveAdvisoryFromObservation('finance', MODE_ESCALATION_THRESHOLD - 0.01, NOW + HOUR_MS), 0);
  assert.equal(getCalibrationStore().all()[0]!.status, 'pending');
  assert.equal(resolveAdvisoryFromObservation('finance', MODE_ESCALATION_THRESHOLD, NOW + HOUR_MS), 1);
  const resolved = getCalibrationStore().all()[0]!;
  assert.equal(resolved.status, 'resolved_true');
  assert.equal(resolved.resolutionProvenance?.kind, 'proxy');
  assert.equal(resolved.resolutionProvenance?.resolverId, 'mode-forecast-observation-v1');
});

test('a subthreshold observation never resolves a claim false mid-window', () => {
  recordAdvisoryPredictions([advisory({ domain: 'cyber' })], NOW);
  const n = resolveAdvisoryFromObservation('cyber', 0.1, NOW + HOUR_MS);
  assert.equal(n, 0);
  assert.equal(getCalibrationStore().all()[0]!.status, 'pending');
});

test('settleExpiredAdvisoryPredictions marks overdue pending records false, leaves in-window alone', () => {
  recordAdvisoryPredictions([advisory({ domain: 'finance' })], NOW);           // resolveBy NOW+24h
  recordAdvisoryPredictions([advisory({ domain: 'cyber' })], NOW + 20 * HOUR_MS); // resolveBy NOW+44h
  const n = settleExpiredAdvisoryPredictions(NOW + 30 * HOUR_MS);
  assert.equal(n, 1);
  const settled = getCalibrationStore().all().find((r) => r.sourceId === 'mode-forecast:finance')!;
  assert.equal(settled.status, 'resolved_false');
  assert.equal(settled.resolutionProvenance?.kind, 'proxy');
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'mode-forecast:cyber')!.status, 'pending');
});

test('settleExpiredAdvisoryPredictions is scoped to mode-forecast records', () => {
  recordPrediction({
    id: 'shortage:wheat:global:1', sourceId: 'shortage:wheat', domain: 'macro', claim: 'x',
    probability: 0.5, predictedAt: NOW, resolveBy: NOW + HOUR_MS, status: 'pending',
  });
  recordAdvisoryPredictions([advisory({ domain: 'finance' })], NOW);
  settleExpiredAdvisoryPredictions(NOW + 100 * DAY_MS);
  assert.equal(getCalibrationStore().all().find((r) => r.id === 'shortage:wheat:global:1')!.status, 'pending');
});

test('resolved advisory predictions feed the store Brier score', () => {
  recordAdvisoryPredictions([advisory({ domain: 'finance', pressure: 0.9 })], NOW);
  resolveAdvisoryPrediction('finance', true, NOW + HOUR_MS);
  const brier = getCalibrationStore().brier();
  assert.equal(brier.evaluated, 1);
  // p=0.9, outcome=1 → (0.9-1)^2 = 0.01
  assert.ok(Math.abs(brier.score - 0.01) < 1e-9, `brier ${brier.score}`);
});
