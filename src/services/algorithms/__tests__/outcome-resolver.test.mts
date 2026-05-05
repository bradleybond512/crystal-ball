import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger';
import {
  DEFAULT_RESOLVER_DELAYS,
  applyManualGrade,
  delayForRecord,
  extractVerdict,
  gradeRecord,
  listPendingResolutions,
  selectDueRecords,
} from '../outcome-resolver';

const T0 = 1_700_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;

function record(overrides: Partial<Parameters<ReturnType<typeof createAlgorithmEvaluationLedger>['recordEvaluation']>[0]> = {}) {
  return {
    algorithmId: overrides.algorithmId ?? 'truth-score',
    domain: overrides.domain ?? 'truth_score' as const,
    at: overrides.at ?? T0,
    durationMs: overrides.durationMs ?? 5,
    score: overrides.score ?? 0.8,
    ...overrides,
  };
}

describe('gradeRecord', () => {
  it('TRUE_POSITIVE when event occurred and alert fired', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    const grade = gradeRecord(r, { eventOccurred: true });
    assert.equal(grade.verdict, 'TRUE_POSITIVE');
    assert.equal(grade.outcome, 'hit');
  });

  it('FALSE_POSITIVE when alert fired but no event', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    const grade = gradeRecord(r, { eventOccurred: false });
    assert.equal(grade.verdict, 'FALSE_POSITIVE');
    assert.equal(grade.outcome, 'miss');
  });

  it('FALSE_NEGATIVE when event occurred but alert did not fire', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.2 }));
    const grade = gradeRecord(r, { eventOccurred: true });
    assert.equal(grade.verdict, 'FALSE_NEGATIVE');
    assert.equal(grade.outcome, 'miss');
  });

  it('TRUE_NEGATIVE when neither event nor alert', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.1 }));
    const grade = gradeRecord(r, { eventOccurred: false });
    assert.equal(grade.verdict, 'TRUE_NEGATIVE');
    assert.equal(grade.outcome, 'inconclusive');
  });

  it('partial hit when observed severity is well below predicted', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    const grade = gradeRecord(r, {
      eventOccurred: true,
      predictedSeverity: 0.9,
      observedSeverity: 0.4,
    });
    assert.equal(grade.verdict, 'TRUE_POSITIVE');
    assert.equal(grade.outcome, 'partial');
    assert.match(grade.reason, /partial/);
  });

  it('full hit when severity is within tolerance', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.7 }));
    const grade = gradeRecord(r, {
      eventOccurred: true,
      predictedSeverity: 0.7,
      observedSeverity: 0.65,
    });
    assert.equal(grade.outcome, 'hit');
  });

  it('respects explicit alertFired override', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    const grade = gradeRecord(r, { eventOccurred: true, alertFired: false });
    assert.equal(grade.verdict, 'FALSE_NEGATIVE');
  });

  it('treats label "no_alert" as not fired', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation({
      algorithmId: 'big-event-detector',
      domain: 'reasoning_hypothesis',
      at: T0,
      durationMs: 1,
      label: 'no_alert',
    });
    const grade = gradeRecord(r, { eventOccurred: true });
    assert.equal(grade.verdict, 'FALSE_NEGATIVE');
  });
});

describe('delay scheduling', () => {
  it('uses domain override for compound_risk', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ domain: 'compound_risk' }));
    assert.equal(delayForRecord(r), 72 * ONE_HOUR);
  });

  it('uses default 24h for truth_score', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ domain: 'truth_score' }));
    assert.equal(delayForRecord(r), 24 * ONE_HOUR);
  });

  it('selectDueRecords filters out ungraded records that are still in their delay window', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const fresh = ledger.recordEvaluation(record({ at: T0 - ONE_HOUR }));
    const due = ledger.recordEvaluation(record({ at: T0 - 25 * ONE_HOUR }));
    const graded = ledger.recordEvaluation(record({ at: T0 - 25 * ONE_HOUR }));
    ledger.recordOutcome(graded.id, 'hit', 'already graded');

    const dueList = selectDueRecords(ledger.all(), T0);
    assert.equal(dueList.length, 1);
    assert.equal(dueList[0]!.id, due.id);
    assert.notEqual(dueList[0]!.id, fresh.id);
  });

  it('selectDueRecords respects custom policy', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ at: T0 - 10 * ONE_HOUR }));
    const policy = { defaultDelayMs: 5 * ONE_HOUR };
    const due = selectDueRecords(ledger.all(), T0, policy);
    assert.equal(due.length, 1);
    assert.equal(due[0]!.id, r.id);
  });
});

describe('applyManualGrade', () => {
  it('writes grade through to the ledger with verdict prefix', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    const { record: updated, result } = applyManualGrade(
      { ledger },
      { id: r.id, observation: { eventOccurred: true } },
    );
    assert.equal(updated.outcome, 'hit');
    assert.match(updated.outcomeReason!, /^\[TRUE_POSITIVE\]/);
    assert.equal(extractVerdict(updated.outcomeReason), 'TRUE_POSITIVE');
    assert.equal(result.verdict, 'TRUE_POSITIVE');
  });

  it('throws when id is unknown', () => {
    const ledger = createAlgorithmEvaluationLedger();
    assert.throws(
      () => applyManualGrade({ ledger }, { id: 'missing', observation: { eventOccurred: true } }),
      /Unknown evaluation/,
    );
  });

  it('throws when already graded', () => {
    const ledger = createAlgorithmEvaluationLedger();
    const r = ledger.recordEvaluation(record({ score: 0.9 }));
    ledger.recordOutcome(r.id, 'hit', 'manual');
    assert.throws(
      () => applyManualGrade({ ledger }, { id: r.id, observation: { eventOccurred: true } }),
      /already graded/,
    );
  });

  it('listPendingResolutions sorts by msUntilDue', () => {
    const ledger = createAlgorithmEvaluationLedger();
    ledger.recordEvaluation(record({ at: T0 - 30 * ONE_HOUR })); // due
    ledger.recordEvaluation(record({ at: T0 - 1 * ONE_HOUR })); // not due
    ledger.recordEvaluation(record({ at: T0 - 50 * ONE_HOUR })); // most overdue

    const pending = listPendingResolutions({ ledger, now: () => T0 });
    assert.equal(pending.length, 3);
    assert.ok(pending[0]!.msUntilDue < pending[1]!.msUntilDue);
    assert.ok(pending[1]!.msUntilDue < pending[2]!.msUntilDue);
  });
});

describe('default delay policy export', () => {
  it('has a 24h default and 72h compound_risk override', () => {
    assert.equal(DEFAULT_RESOLVER_DELAYS.defaultDelayMs, 24 * 60 * 60 * 1000);
    assert.equal(DEFAULT_RESOLVER_DELAYS.domainOverrides?.compound_risk, 72 * 60 * 60 * 1000);
  });
});
