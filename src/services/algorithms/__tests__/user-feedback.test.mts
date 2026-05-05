import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger';
import {
  annotateAndGrade,
  clearAnnotations,
  listAnnotations,
  submitAnnotation,
  summarizeAnnotations,
} from '../user-feedback';

beforeEach(() => {
  clearAnnotations();
});

const T0 = 1_700_000_000_000;
const ONE_MIN = 60 * 1000;

describe('submitAnnotation', () => {
  it('stores a new annotation', () => {
    const a = submitAnnotation({
      alertId: 'eval-1',
      algorithmId: 'truth-score',
      annotationType: 'confirmed',
      now: T0,
    });
    assert.equal(a.alertId, 'eval-1');
    assert.equal(a.submittedAt, T0);
  });

  it('rejects unsupported annotationType', () => {
    assert.throws(
      () =>
        submitAnnotation({
          alertId: 'x',
          algorithmId: 'a',
          // @ts-expect-error - testing runtime validation
          annotationType: 'maybe',
        }),
      /Unsupported/,
    );
  });

  it('rejects empty alertId', () => {
    assert.throws(
      () =>
        submitAnnotation({
          alertId: '',
          algorithmId: 'a',
          annotationType: 'confirmed',
        }),
      /alertId/,
    );
  });
});

describe('listAnnotations', () => {
  it('filters by algorithmId', () => {
    submitAnnotation({ alertId: 'e1', algorithmId: 'a1', annotationType: 'confirmed' });
    submitAnnotation({ alertId: 'e2', algorithmId: 'a2', annotationType: 'missed' });
    submitAnnotation({ alertId: 'e3', algorithmId: 'a1', annotationType: 'false_positive' });
    assert.equal(listAnnotations({ algorithmId: 'a1' }).length, 2);
    assert.equal(listAnnotations({ algorithmId: 'a2' }).length, 1);
  });

  it('filters by since', () => {
    submitAnnotation({ alertId: 'e1', algorithmId: 'a', annotationType: 'confirmed', now: T0 });
    submitAnnotation({ alertId: 'e2', algorithmId: 'a', annotationType: 'confirmed', now: T0 + 1000 });
    submitAnnotation({ alertId: 'e3', algorithmId: 'a', annotationType: 'confirmed', now: T0 + 2000 });
    assert.equal(listAnnotations({ since: T0 + 1000 }).length, 2);
  });
});

describe('summarizeAnnotations', () => {
  it('counts by type', () => {
    for (let i = 0; i < 14; i += 1) {
      submitAnnotation({ alertId: `e${i}`, algorithmId: 'a', annotationType: 'confirmed' });
    }
    for (let i = 0; i < 2; i += 1) {
      submitAnnotation({ alertId: `f${i}`, algorithmId: 'a', annotationType: 'false_positive' });
    }
    for (let i = 0; i < 3; i += 1) {
      submitAnnotation({ alertId: `g${i}`, algorithmId: 'a', annotationType: 'observed_early' });
    }
    const summary = summarizeAnnotations('a');
    assert.equal(summary.counts.confirmed, 14);
    assert.equal(summary.counts.false_positive, 2);
    assert.equal(summary.counts.observed_early, 3);
    assert.equal(summary.total, 19);
  });

  it('computes mean lead time from observed_early annotations', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r1 = ledger.recordEvaluation({
      algorithmId: 'a',
      domain: 'truth_score',
      at: T0,
      durationMs: 1,
    });
    const r2 = ledger.recordEvaluation({
      algorithmId: 'a',
      domain: 'truth_score',
      at: T0 + 100 * ONE_MIN,
      durationMs: 1,
    });
    submitAnnotation({
      alertId: r1.id,
      algorithmId: 'a',
      annotationType: 'observed_early',
      observedAt: T0 - 10 * ONE_MIN,
    });
    submitAnnotation({
      alertId: r2.id,
      algorithmId: 'a',
      annotationType: 'observed_early',
      observedAt: T0 + 80 * ONE_MIN,
    });
    const summary = summarizeAnnotations('a', ledger);
    assert.equal(summary.earlyDetectionsWithLead, 2);
    // Lead times: 10 min and 20 min, mean = 15 min
    assert.equal(summary.meanEarlyLeadMs, 15 * ONE_MIN);
  });

  it('returns null mean when no observed_early annotations', () => {
    submitAnnotation({ alertId: 'e1', algorithmId: 'a', annotationType: 'confirmed' });
    const summary = summarizeAnnotations('a');
    assert.equal(summary.meanEarlyLeadMs, null);
  });

  it('global summary aggregates all algorithms', () => {
    submitAnnotation({ alertId: 'e1', algorithmId: 'a1', annotationType: 'confirmed' });
    submitAnnotation({ alertId: 'e2', algorithmId: 'a2', annotationType: 'missed' });
    const summary = summarizeAnnotations(null);
    assert.equal(summary.total, 2);
  });
});

describe('annotateAndGrade', () => {
  it('confirmed annotation grades the ledger record as hit', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation({
      algorithmId: 'a',
      domain: 'truth_score',
      at: T0,
      durationMs: 1,
      score: 0.9,
    });
    const result = annotateAndGrade(ledger, {
      alertId: r.id,
      algorithmId: 'a',
      annotationType: 'confirmed',
    });
    assert.equal(result.graded, true);
    assert.equal(result.outcome, 'hit');
    const updated = ledger.get(r.id)!;
    assert.equal(updated.outcome, 'hit');
  });

  it('false_positive annotation grades as miss', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation({
      algorithmId: 'a',
      domain: 'truth_score',
      at: T0,
      durationMs: 1,
      score: 0.9,
    });
    const result = annotateAndGrade(ledger, {
      alertId: r.id,
      algorithmId: 'a',
      annotationType: 'false_positive',
    });
    assert.equal(result.outcome, 'miss');
    assert.match(ledger.get(r.id)!.outcomeReason!, /FALSE_POSITIVE/);
  });

  it('inconclusive annotation does not grade the ledger', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation({
      algorithmId: 'a',
      domain: 'truth_score',
      at: T0,
      durationMs: 1,
      score: 0.9,
    });
    const result = annotateAndGrade(ledger, {
      alertId: r.id,
      algorithmId: 'a',
      annotationType: 'inconclusive',
    });
    assert.equal(result.graded, false);
    assert.equal(ledger.get(r.id)!.outcome, undefined);
  });

  it('throws when alert id is unknown', () => {
    const ledger = createAlgorithmEvaluationLedger();
    assert.throws(
      () =>
        annotateAndGrade(ledger, {
          alertId: 'missing',
          algorithmId: 'a',
          annotationType: 'confirmed',
        }),
      /Unknown evaluation/,
    );
  });
});
