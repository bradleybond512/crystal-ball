import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

import {
  claimForHypothesisOutcome,
  domainForHypothesis,
  factDomainForAlertSource,
  factDomainForSignalSource,
  factDomainForSituationDomain,
  HYPOTHESIS_OUTCOME_HORIZON_MS,
  recordHypothesisPredictions,
  resolveHypothesisPrediction,
  predictionIdFor,
  targetKeyForHypothesis,
} from '../hypothesis-prediction-bridge.ts';
import {
  getCalibrationStore,
  recordPrediction,
  _resetCalibrationForTests,
} from '../forecast-calibration-adapter.ts';

beforeEach(() => { mem.clear(); _resetCalibrationForTests(); });

const h = {
  id: 'h-1',
  kind: 'anomaly-convergence',
  statement: 'Test hypothesis',
  confidence: 0.8,
  risk: 'high',
  region: 'Midwest',
  evidence: [{ source: 'situation-engine', id: 's1', label: 'Situation s1' }],
  timestamp: 1000,
} as any;

test('records one pending prediction per hypothesis, idempotent within a window', () => {
  recordHypothesisPredictions([h], 1000);
  recordHypothesisPredictions([h], 2000); // same signature, same window → no duplicate
  const all = getCalibrationStore().all();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.status, 'pending');
  assert.equal(all[0]!.probability, 0.8);
  assert.equal(all[0]!.sourceId, 'analyst-loop');
  assert.equal(all[0]!.targetKey, targetKeyForHypothesis(h));
  assert.equal(all[0]!.claim, claimForHypothesisOutcome(h));
});

test('prediction id is stable for a signature+window', () => {
  assert.equal(predictionIdFor(h, 1000), predictionIdFor(h, 1000));
});

test('uses a hypothesis single-domain attribution and keeps mixed hypotheses separate', () => {
  assert.equal(domainForHypothesis({ ...h, domains: ['cyber'] }), 'cyber');
  assert.equal(domainForHypothesis({ ...h, domains: ['weather', 'infra'] }), 'other');
  assert.equal(domainForHypothesis(h), 'other');
});

test('maps upstream domain vocabularies without inferring from free text', () => {
  assert.equal(factDomainForSituationDomain('military'), 'conflict');
  assert.equal(factDomainForAlertSource('power-grid'), 'infra');
  assert.equal(factDomainForSignalSource('finance:volatility'), 'markets');
  assert.equal(factDomainForSignalSource('unknown:signal'), 'other');
});

test('different window bucket produces a new record', () => {
  const WINDOW_MS = 6 * 60 * 60 * 1000;
  recordHypothesisPredictions([h], 0);
  recordHypothesisPredictions([h], WINDOW_MS + 1); // different bucket
  assert.equal(getCalibrationStore().all().length, 2);
});

test('resolveHypothesisPrediction marks the matching pending record', () => {
  recordHypothesisPredictions([h], 1000);
  const ok = resolveHypothesisPrediction(h, true, 1000 + HYPOTHESIS_OUTCOME_HORIZON_MS);
  assert.equal(ok, true);
  const rec = getCalibrationStore().all()[0]!;
  assert.equal(rec.status, 'resolved_true');
});

test('resolves every open forecast source for the same objective target', () => {
  recordHypothesisPredictions([h], 1000);
  recordPrediction({
    id: 'sf:h-1:1',
    sourceId: 'superforecast',
    targetKey: targetKeyForHypothesis(h),
    domain: 'other',
    claim: h.statement,
    probability: 0.7,
    predictedAt: 1100,
    resolveBy: 1000 + HYPOTHESIS_OUTCOME_HORIZON_MS,
    status: 'pending',
  });

  const ok = resolveHypothesisPrediction(h, true, 1000 + HYPOTHESIS_OUTCOME_HORIZON_MS);
  assert.equal(ok, true);
  assert.deepEqual(
    getCalibrationStore().all().map((r) => r.status),
    ['resolved_true', 'resolved_true'],
  );
});

test('resolveHypothesisPrediction returns false when no pending record exists', () => {
  const ok = resolveHypothesisPrediction(h, true, 5000);
  assert.equal(ok, false);
});
