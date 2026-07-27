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
  marketCriteriaFor,
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

test('stamps deterministic market criteria from one ticker, one direction, and an as-of basis', () => {
  const marketHypothesis = {
    ...h,
    statement: 'AAPL could surge as demand accelerates',
    domains: ['markets'],
  };
  const criteria = marketCriteriaFor(
    marketHypothesis,
    5_000,
    (symbol, asOf) => symbol === 'AAPL' && asOf === 5_000
      ? {
          symbol: 'AAPL',
          price: 200,
          observedAt: 4_000,
          providerIds: ['yahoo-finance', 'finnhub'],
          independentSourceCount: 2,
          confidence: 0.8,
        }
      : null,
  );

  assert.deepEqual(criteria, {
    kind: 'market_move',
    symbol: 'AAPL',
    direction: 'up',
    minAbsPct: 3,
    basisPrice: 200,
    basisObservedAt: 4_000,
  });
});

test('normalizes supported USD crypto pairs to the fused base symbol', () => {
  const criteria = marketCriteriaFor({
    ...h,
    statement: 'SOL-USD could plunge on market stress',
    domains: ['markets'],
  }, 5_000, (symbol) => symbol === 'SOL'
    ? {
        symbol,
        price: 150,
        observedAt: 4_000,
        providerIds: ['coingecko', 'coinbase'],
        independentSourceCount: 2,
        confidence: 0.8,
      }
    : null);

  assert.equal(criteria?.symbol, 'SOL');
  assert.equal(criteria?.direction, 'down');
});

test('does not stamp ambiguous, contradictory, non-market, or unsupported criteria', () => {
  const latest = () => ({
    symbol: 'AAPL',
    price: 200,
    observedAt: 4_000,
    providerIds: ['yahoo-finance'],
    independentSourceCount: 1,
    confidence: 0.5,
  });
  assert.equal(marketCriteriaFor({
    ...h,
    statement: 'AAPL and MSFT surge',
    domains: ['markets'],
  }, 5_000, latest), undefined);
  assert.equal(marketCriteriaFor({
    ...h,
    statement: 'AAPL could surge then plunge',
    domains: ['markets'],
  }, 5_000, latest), undefined);
  assert.equal(marketCriteriaFor({
    ...h,
    statement: 'AAPL could surge',
    domains: ['cyber'],
  }, 5_000, latest), undefined);
  assert.equal(marketCriteriaFor({
    ...h,
    statement: 'AAPL could surge',
    domains: ['markets'],
  }, 5_000, () => null), undefined);
});

test('recorded market predictions carry their declared resolver criteria', () => {
  const marketHypothesis = {
    ...h,
    statement: 'AAPL could surge as demand accelerates',
    domains: ['markets'],
  };
  recordHypothesisPredictions([marketHypothesis], 5_000, (_symbol, _asOf) => ({
    symbol: 'AAPL',
    price: 200,
    observedAt: 4_000,
    providerIds: ['yahoo-finance'],
    independentSourceCount: 1,
    confidence: 0.5,
  }));

  assert.equal(getCalibrationStore().all()[0]?.criteria?.kind, 'market_move');
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
