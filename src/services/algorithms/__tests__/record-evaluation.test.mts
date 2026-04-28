/**
 * Coverage for `record-evaluation.ts` — the call-site helper that
 * bridges live algorithm orchestrators to the singleton evaluation
 * ledger. Verifies that:
 *   - Recording joins to the registry by id (algorithmId / version /
 *     domain auto-populate from the registry entry).
 *   - Unknown ids throw before touching the ledger.
 *   - Oversized `detail` payloads are refused.
 *   - `timeAndRecord` records latency + label even when the wrapped
 *     function throws (so the health aggregator sees failures).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordAlgorithmEvaluation,
  recordAlgorithmOutcome,
  timeAndRecord,
  UnknownAlgorithmError,
  DetailTooLargeError,
} from '../record-evaluation.ts';
import { getAlgorithmEvaluationLedger, resetAlgorithmsState } from '../algorithms-state.ts';

test.beforeEach(() => resetAlgorithmsState());

test('recordAlgorithmEvaluation: auto-populates domain + version from registry', () => {
  const rec = recordAlgorithmEvaluation('truth-score', { durationMs: 4, score: 0.62 });
  assert.equal(rec.algorithmId, 'truth-score');
  assert.equal(rec.domain, 'truth_score', 'healthDomain on registry → domain on record');
  assert.equal(rec.version, '1.0.0');
  assert.equal(rec.score, 0.62);
  assert.ok(rec.id, 'ledger assigns an id');
  assert.ok(rec.at, 'ledger sets the timestamp');
});

test('recordAlgorithmEvaluation: unknown id throws UnknownAlgorithmError', () => {
  assert.throws(
    () => recordAlgorithmEvaluation('not-a-real-algo', { durationMs: 1 }),
    UnknownAlgorithmError,
  );
});

test('recordAlgorithmEvaluation: oversized detail throws DetailTooLargeError', () => {
  const huge = { payload: 'x'.repeat(8 * 1024) }; // 8 KB blows the 4 KB cap
  assert.throws(
    () => recordAlgorithmEvaluation('truth-score', { durationMs: 1, detail: huge }),
    DetailTooLargeError,
  );
});

test('recordAlgorithmEvaluation: caller can override version (canary builds)', () => {
  const rec = recordAlgorithmEvaluation('truth-score', { durationMs: 1, version: '1.1.0-canary' });
  assert.equal(rec.version, '1.1.0-canary');
});

test('recordAlgorithmEvaluation: notes longer than 1KB are clamped', () => {
  const rec = recordAlgorithmEvaluation('truth-score', { durationMs: 1, notes: 'x'.repeat(2000) });
  assert.equal(rec.notes?.length, 1024);
});

test('recordAlgorithmEvaluation: registry entry without healthDomain falls through to "other"', () => {
  // Big-event-detector now has a healthDomain set, but if a future
  // entry omits it we must still record.
  const rec = recordAlgorithmEvaluation('big-event-detector', { durationMs: 2 });
  // healthDomain is 'reasoning_hypothesis' for this entry. Confirm it
  // came through.
  assert.equal(rec.domain, 'reasoning_hypothesis');
});

test('recordAlgorithmOutcome: appends ground truth to a recorded evaluation', () => {
  const rec = recordAlgorithmEvaluation('weather-urgency', { durationMs: 3, score: 0.9 });
  const updated = recordAlgorithmOutcome(rec.id, 'hit', 'Storm landed within forecast window');
  assert.equal(updated.outcome, 'hit');
  assert.equal(updated.outcomeReason, 'Storm landed within forecast window');
});

test('recordAlgorithmOutcome: refuses to overwrite an existing outcome', () => {
  const rec = recordAlgorithmEvaluation('weather-urgency', { durationMs: 3 });
  recordAlgorithmOutcome(rec.id, 'hit', 'first call');
  assert.throws(() => recordAlgorithmOutcome(rec.id, 'miss', 'second call'));
});

test('timeAndRecord: records duration on success', async () => {
  const { result, record } = await timeAndRecord(
    'truth-score',
    () => 0.42,
    (n) => ({ score: n, label: 'computed' }),
  );
  assert.equal(result, 0.42);
  assert.equal(record.score, 0.42);
  assert.equal(record.label, 'computed');
  assert.ok(record.durationMs >= 0);
});

test('timeAndRecord: records label="error" and rethrows when fn throws', async () => {
  const ledger = getAlgorithmEvaluationLedger();
  await assert.rejects(
    timeAndRecord(
      'truth-score',
      () => { throw new Error('boom'); },
      () => ({ score: 0 }),
    ),
    /boom/,
  );
  const records = ledger.byAlgorithm('truth-score');
  const last = records.at(-1);
  assert.equal(last?.label, 'error');
  assert.match(last?.notes ?? '', /boom/);
});

test('determinism: same inputs produce same record fields (modulo id+at)', () => {
  const a = recordAlgorithmEvaluation('truth-score', {
    durationMs: 5,
    score: 0.7,
    detail: { sourceCount: 3 },
    at: 1_700_000_000_000,
  });
  const b = recordAlgorithmEvaluation('truth-score', {
    durationMs: 5,
    score: 0.7,
    detail: { sourceCount: 3 },
    at: 1_700_000_000_000,
  });
  assert.notEqual(a.id, b.id, 'ids are unique');
  assert.equal(a.algorithmId, b.algorithmId);
  assert.equal(a.domain, b.domain);
  assert.equal(a.version, b.version);
  assert.deepEqual(a.detail, b.detail);
  assert.equal(a.score, b.score);
});
