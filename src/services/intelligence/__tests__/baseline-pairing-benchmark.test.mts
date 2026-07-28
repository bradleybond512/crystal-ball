import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  comparePairingToBaseline,
  runBaselinePairingBenchmark,
  type PairingBenchmarkBaseline,
} from '../baseline-pairing-benchmark';
import { baselinePairingFixtures } from '../__bench__/baseline-pairing-corpus';
import { buildPersistenceBaselinePrediction } from '../persistence-baseline';
import { buildMomentumBaselinePrediction } from '../momentum-baseline';
import { buildHierarchicalBaseRatePrediction } from '../hierarchical-base-rate';
import type { PredictionRecord } from '../forecast-calibration';

const here = dirname(fileURLToPath(import.meta.url));
const committed = JSON.parse(
  readFileSync(join(here, '../__bench__/baseline-pairing-baseline.json'), 'utf8'),
) as PairingBenchmarkBaseline;

test('pairing corpus is deterministic and time-ordered', () => {
  const a = baselinePairingFixtures();
  const b = baselinePairingFixtures();
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i]!.predictedAt >= a[i - 1]!.predictedAt);
  }
  assert.equal(a.length, committed.fixtureCount);
});

test('benchmark matches the committed baseline exactly (gate PASS)', () => {
  const report = runBaselinePairingBenchmark();
  assert.deepEqual(comparePairingToBaseline(report, committed), []);
  // Every baseline family has records — the corpus exercises all three.
  const models = new Set(report.models.map((m) => m.model));
  assert.ok(models.has('persistence-baseline'));
  assert.ok(models.has('momentum-baseline'));
  assert.ok(models.has('hierarchical-base-rate'));
});

test('benchmark reports Brier SKILL vs production, not raw Brier alone', () => {
  const report = runBaselinePairingBenchmark();
  for (const m of report.models) {
    assert.ok(Number.isFinite(m.brierSkillVsProduction));
    assert.ok(
      Math.abs(m.brierSkillVsProduction - (m.productionBrier - m.brier)) < 1e-9,
      'skill is production minus model on the same records',
    );
  }
});

test('gate FAILS closed on Brier regression, record drift, and missing models', () => {
  const report = runBaselinePairingBenchmark();
  const worse = {
    ...report,
    models: report.models.map((m) =>
      m.model === 'persistence-baseline' ? { ...m, brier: m.brier + 0.05 } : m),
  };
  assert.equal(comparePairingToBaseline(worse, committed).length, 1);
  const missing = { ...report, models: report.models.filter((m) => m.model !== 'momentum-baseline') };
  assert.ok(comparePairingToBaseline(missing, committed).some((r) => r.metric === 'missing-model'));
  const wrongCorpus = { ...report, corpusId: 'other' };
  assert.equal(comparePairingToBaseline(wrongCorpus, committed).length, 1);
});

// ── ACC-303 phase exit: every production model has ≥1 relevant baseline ──

function representativeTarget(
  sourceId: string,
  targetKey: string,
  criteria?: PredictionRecord['criteria'],
): PredictionRecord {
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  return {
    id: `cov-${sourceId}-${targetKey}`,
    sourceId,
    targetKey,
    domain: 'markets',
    claim: 'coverage fixture',
    probability: 0.6,
    predictedAt: T,
    resolveBy: T + 24 * 3_600_000,
    status: 'pending',
    criteria,
  } as PredictionRecord;
}

test('PHASE EXIT: every production emitter family has at least one relevant baseline', () => {
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  const H = 3_600_000;
  // Enough resolved global history for the hierarchical model.
  const globalHistory: PredictionRecord[] = [];
  for (let i = 0; i < 35; i++) {
    const predictedAt = T - (100 + i * 30) * H;
    globalHistory.push({
      id: `g-${i}`, sourceId: 'mode-forecast', targetKey: `mode:g${i % 4}`,
      domain: 'markets', claim: 'g', probability: 0.5,
      predictedAt, resolveBy: predictedAt + 12 * H,
      status: i % 2 === 0 ? 'resolved_true' : 'resolved_false',
      resolvedAt: predictedAt + 6 * H, resolutionNote: 'direct:cov',
    } as PredictionRecord);
  }
  const priorSameKey: PredictionRecord = {
    ...globalHistory[0]!, id: 'prior-mode-finance', targetKey: 'mode:finance',
  };
  const priorShortageKey: PredictionRecord = {
    ...globalHistory[1]!, id: 'prior-shortage-wheat', targetKey: 'shortage:wheat:global',
  };
  const history = [...globalHistory, priorSameKey, priorShortageKey];
  const marketCriteria = {
    kind: 'market_move', symbol: 'AAPL', direction: 'up',
    minAbsPct: 3, basisPrice: 200, basisObservedAt: T - 60_000,
  } as PredictionRecord['criteria'];
  const priceSamples = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    observedAt: T - 5 * 60_000 - (7 - i) * 30 * 60_000,
    price: 200,
  }));

  const coverage: [string, PredictionRecord, number][] = [
    // family label, target, expected minimum baseline count
    ['mode-forecast', representativeTarget('mode-forecast', 'mode:finance'), 2],
    ['shortage', representativeTarget('shortage-forecast', 'shortage:wheat:global'), 2],
    ['hypothesis/superforecast (market)', representativeTarget('analyst-loop', 'hypothesis:mkt', marketCriteria), 2],
    ['hypothesis/superforecast (non-market)', representativeTarget('analyst-loop', 'hypothesis:geo'), 1],
    ['warning-verification', representativeTarget('warning-verification-bridge', 'nws-warning:x'), 1],
  ];
  for (const [label, target, minimum] of coverage) {
    const emitted = [
      buildHierarchicalBaseRatePrediction(target, history),
      buildPersistenceBaselinePrediction(target, history),
      buildMomentumBaselinePrediction(target, priceSamples),
    ].filter((b) => b !== null);
    assert.ok(
      emitted.length >= minimum,
      `${label}: expected ≥${minimum} baseline(s), got ${emitted.length}`,
    );
  }
});
