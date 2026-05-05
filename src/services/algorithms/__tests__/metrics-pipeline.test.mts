import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger';
import {
  buildAlgorithmMetricsReport,
  calibrationBins,
  severityTierForScore,
  sliceByWindow,
  summarizeAllAlgorithms,
} from '../metrics-pipeline';

const T0 = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function gradeRecord(
  ledger: ReturnType<typeof createAlgorithmEvaluationLedger>,
  args: {
    algorithmId?: string;
    domain?: 'truth_score' | 'compound_risk' | 'weather_polygon';
    score?: number;
    at?: number;
    verdict: 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'TRUE_NEGATIVE' | 'FALSE_NEGATIVE';
    outcome: 'hit' | 'miss' | 'partial' | 'inconclusive';
  },
) {
  const r = ledger.recordEvaluation({
    algorithmId: args.algorithmId ?? 'truth-score',
    domain: args.domain ?? 'truth_score',
    at: args.at ?? T0,
    durationMs: 1,
    score: args.score ?? 0.7,
  });
  ledger.recordOutcome(r.id, args.outcome, `[${args.verdict}] test`);
  return r;
}

describe('severityTierForScore', () => {
  it('maps 0..0.3 to low', () => {
    assert.equal(severityTierForScore(0.05), 'low');
    assert.equal(severityTierForScore(0.29), 'low');
  });
  it('maps 0.3..0.5 to medium', () => {
    assert.equal(severityTierForScore(0.3), 'medium');
    assert.equal(severityTierForScore(0.49), 'medium');
  });
  it('maps 0.5..0.75 to high', () => {
    assert.equal(severityTierForScore(0.5), 'high');
    assert.equal(severityTierForScore(0.74), 'high');
  });
  it('maps 0.75..1 to critical', () => {
    assert.equal(severityTierForScore(0.75), 'critical');
    assert.equal(severityTierForScore(1), 'critical');
  });
  it('returns null for non-numeric scores', () => {
    assert.equal(severityTierForScore(undefined), null);
    assert.equal(severityTierForScore(Number.NaN), null);
  });
});

describe('precision / recall / F1', () => {
  it('computes correct precision and recall for canonical 4-cell example', () => {
    const ledger = createAlgorithmEvaluationLedger();
    // 8 TP, 2 FP, 3 FN, 7 TN
    for (let i = 0; i < 8; i += 1) {
      gradeRecord(ledger, { score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 2; i += 1) {
      gradeRecord(ledger, { score: 0.8, verdict: 'FALSE_POSITIVE', outcome: 'miss' });
    }
    for (let i = 0; i < 3; i += 1) {
      gradeRecord(ledger, { score: 0.2, verdict: 'FALSE_NEGATIVE', outcome: 'miss' });
    }
    for (let i = 0; i < 7; i += 1) {
      gradeRecord(ledger, { score: 0.1, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.overall.truePositive, 8);
    assert.equal(report.overall.falsePositive, 2);
    assert.equal(report.overall.falseNegative, 3);
    assert.equal(report.overall.trueNegative, 7);
    assert.equal(report.overall.precision, 8 / 10);
    assert.equal(report.overall.recall, 8 / 11);
    const expectedF1 = (2 * (8 / 10) * (8 / 11)) / (8 / 10 + 8 / 11);
    assert.ok(Math.abs(report.overall.f1 - expectedF1) < 1e-9);
    assert.equal(report.overall.accuracy, 15 / 20);
  });

  it('returns NaN for precision when no positives exist', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.1, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.ok(Number.isNaN(report.overall.precision));
    assert.ok(Number.isNaN(report.overall.recall));
  });
});

describe('AUC-ROC', () => {
  it('returns 1.0 for perfect separation', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.9 + i * 0.01, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.1 + i * 0.01, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.overall.aucRoc, 1.0);
  });

  it('returns 0.5 for random/equal scores', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 10; i += 1) {
      gradeRecord(ledger, { score: 0.5, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 10; i += 1) {
      gradeRecord(ledger, { score: 0.5, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.overall.aucRoc, 0.5);
  });

  it('returns NaN when one class is missing', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.ok(Number.isNaN(report.overall.aucRoc));
  });
});

describe('Brier score', () => {
  it('is 0 for perfect confidence', () => {
    const ledger = createAlgorithmEvaluationLedger();
    gradeRecord(ledger, { score: 1.0, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { score: 0.0, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.overall.brier, 0);
  });

  it('is 0.25 for completely uncertain confidence (all 0.5)', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.5, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.5, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.overall.brier, 0.25);
  });
});

describe('windowing', () => {
  it('sliceByWindow keeps only records within the window', () => {
    const ledger = createAlgorithmEvaluationLedger();
    gradeRecord(ledger, { at: T0 - 5 * ONE_DAY, score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { at: T0 - 20 * ONE_DAY, score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { at: T0 - 100 * ONE_DAY, score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    const all = ledger.all();
    assert.equal(sliceByWindow(all, '7d', T0).length, 1);
    assert.equal(sliceByWindow(all, '30d', T0).length, 2);
    assert.equal(sliceByWindow(all, '90d', T0).length, 2);
    assert.equal(sliceByWindow(all, 'all', T0).length, 3);
  });

  it('byWindow report cells reflect their window', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 3; i += 1) {
      gradeRecord(ledger, { at: T0 - 1 * ONE_DAY, score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { at: T0 - 60 * ONE_DAY, score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.byWindow['7d'].truePositive, 3);
    assert.equal(report.byWindow['30d'].truePositive, 3);
    assert.equal(report.byWindow['90d'].truePositive, 8);
  });
});

describe('byTier', () => {
  it('partitions records by severity tier', () => {
    const ledger = createAlgorithmEvaluationLedger();
    gradeRecord(ledger, { score: 0.1, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    gradeRecord(ledger, { score: 0.4, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { score: 0.6, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { score: 0.95, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    const report = buildAlgorithmMetricsReport({
      algorithmId: 'truth-score',
      records: ledger.all(),
      now: () => T0,
    });
    assert.equal(report.byTier.low.total, 1);
    assert.equal(report.byTier.medium.total, 1);
    assert.equal(report.byTier.high.total, 1);
    assert.equal(report.byTier.critical.total, 1);
  });
});

describe('calibration', () => {
  it('produces 10 bins each spanning 0.1', () => {
    const ledger = createAlgorithmEvaluationLedger();
    gradeRecord(ledger, { score: 0.05, verdict: 'TRUE_NEGATIVE', outcome: 'inconclusive' });
    const bins = calibrationBins(ledger.all());
    assert.equal(bins.length, 10);
    assert.equal(bins[0]!.binStart, 0);
    assert.equal(bins[9]!.binEnd, 1);
  });

  it('observed hit rate matches expected for high-confidence hits', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 10; i += 1) {
      gradeRecord(ledger, { score: 0.95, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    const bins = calibrationBins(ledger.all());
    const top = bins[9]!;
    assert.equal(top.count, 10);
    assert.equal(top.observedHitRate, 1);
    assert.ok(Math.abs(top.meanPredicted - 0.95) < 1e-9);
  });

  it('high-confidence FALSE_POSITIVE drops the observed hit rate', () => {
    const ledger = createAlgorithmEvaluationLedger();
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.95, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    }
    for (let i = 0; i < 5; i += 1) {
      gradeRecord(ledger, { score: 0.95, verdict: 'FALSE_POSITIVE', outcome: 'miss' });
    }
    const bins = calibrationBins(ledger.all());
    const top = bins[9]!;
    assert.equal(top.count, 10);
    assert.equal(top.observedHitRate, 0.5);
  });
});

describe('summarizeAllAlgorithms', () => {
  it('rolls up multiple algorithm IDs', () => {
    const ledger = createAlgorithmEvaluationLedger();
    gradeRecord(ledger, { algorithmId: 'a1', score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    gradeRecord(ledger, { algorithmId: 'a1', score: 0.9, verdict: 'FALSE_POSITIVE', outcome: 'miss' });
    gradeRecord(ledger, { algorithmId: 'a2', score: 0.9, verdict: 'TRUE_POSITIVE', outcome: 'hit' });
    const summary = summarizeAllAlgorithms(ledger.all());
    assert.equal(summary.length, 2);
    const a1 = summary.find((s) => s.algorithmId === 'a1')!;
    const a2 = summary.find((s) => s.algorithmId === 'a2')!;
    assert.equal(a1.total, 2);
    assert.equal(a1.precision, 0.5);
    assert.equal(a2.total, 1);
    assert.equal(a2.precision, 1);
  });

  it('skips ungraded records', () => {
    const ledger = createAlgorithmEvaluationLedger();
    ledger.recordEvaluation({
      algorithmId: 'pending',
      domain: 'truth_score',
      at: T0,
      durationMs: 1,
      score: 0.5,
    });
    assert.equal(summarizeAllAlgorithms(ledger.all()).length, 0);
  });
});
