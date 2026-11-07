import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { getResolutionRunDiagnostics, interruptResolutionRunStreak, recordResolutionRun, resetResolutionRunSession } from '../resolution-run-receipts.ts';

const STEP = 15 * 60_000;
const START = 1_810_000_000_000;
const metrics = {
  pending: 1, rawOverdueBefore: 1, rawOverdueAfter: 0, diagnosticOverdueBefore: 1,
  diagnosticOverdueAfter: 0, pastExpiryGrace: 0, eligibleOverdueBefore: 1, eligibleOverdueAfter: 0,
  opportunities: 1, unsupported: 0, awaitingEvidence: 0, windowOpen: 0, invalidCriteria: 0,
  rejectedWrites: 0, persistenceFailures: 0, expired: 0, direct: 1, proxy: 0, unattributed: 0,
};
function tick(n: number, changes = {}) {
  const dueAt = START + n * STEP;
  recordResolutionRun({ kind: 'scheduled', dueAt, startedAt: dueAt, completedAt: dueAt + 1, readiness: 'ready', outcome: 'completed', metrics, ...changes });
}
beforeEach(resetResolutionRunSession);

test('seven consecutive scheduled passes with real opportunities and zero eligible overdue are counted', () => {
  for (let n = 0; n < 7; n++) tick(n);
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 7);
  assert.equal(getResolutionRunDiagnostics().requiredScheduledRuns, 7);
  assert.equal(getResolutionRunDiagnostics().receipts[6]?.sequence, 7);
});

test('each scheduled pass must be ready, successful, nonempty, durable and without eligible overdue', () => {
  for (const invalid of [
    { readiness: 'hidden' }, { outcome: 'failed' }, { outcome: 'skipped' }, { metrics: null },
    { metrics: { ...metrics, opportunities: 0 } }, { metrics: { ...metrics, eligibleOverdueAfter: 1 } },
    { metrics: { ...metrics, rejectedWrites: 1 } }, { metrics: { ...metrics, persistenceFailures: 1 } },
    { metrics: { ...metrics, eligibleOverdueAfter: NaN } },
  ]) {
    resetResolutionRunSession();
    for (let n = 0; n < 6; n++) tick(n);
    tick(6, invalid);
    assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 0, JSON.stringify(invalid));
    tick(7);
    assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 1);
  }
});

test('bridge passes cannot advance a streak and catch-up, interruptions, skipped slots and duplicate due times cannot join two streaks', () => {
  tick(0);
  tick(0.25, { kind: 'bridge', metrics: { enabled: true, shortageExpired: 1, advisoryExpired: 2, legacyExpired: 3, failed: false } });
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 1);
  tick(1, { kind: 'catchup' });
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 0);
  tick(2);
  interruptResolutionRunStreak();
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 0);
  tick(3); tick(5);
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 1);
  tick(5);
  assert.ok(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns <= 1);
  resetResolutionRunSession();
  assert.deepEqual(getResolutionRunDiagnostics().receipts, []);
});

test('retain only 16 allowlisted aggregate receipts and return detached snapshot data', () => {
  for (let n = 0; n < 20; n++) tick(n, { rawId: 'sentinel-id', metrics: { ...metrics, providerText: 'sentinel-text', 'sentinel-count': 23 } });
  const snapshot = getResolutionRunDiagnostics();
  assert.equal(snapshot.receipts.length, 16);
  assert.deepEqual(snapshot.receipts.map(r => r.sequence), Array.from({ length: 16 }, (_, i) => i + 5));
  assert.doesNotMatch(JSON.stringify(snapshot), /sentinel/);
  const first = snapshot.receipts[0]?.metrics;
  assert.ok(first && 'direct' in first && first.direct === 1, 'valid allowlisted counters survive unexpected keys');
  first.direct = 999;
  assert.equal(getResolutionRunDiagnostics().receipts[0]!.metrics!.direct, 1);
});

test('malformed timing, outcomes or readiness cannot persist raw hints or extend a sequence', () => {
  tick(0);
  for (const change of [{ outcome: 'secret-error' }, { readiness: 'raw-report' }, { kind: 'raw-ID' }, { dueAt: NaN }, { completedAt: START - 1 }]) tick(1, change);
  const snapshot = getResolutionRunDiagnostics();
  assert.equal(snapshot.consecutiveQualifyingScheduledRuns, 0);
  assert.equal(snapshot.receipts.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-error|raw-report|raw-ID/);
});

test('a late start at the following slot and invalid counts cannot certify the current slot', () => {
  tick(0);
  tick(1, { startedAt: START + 2 * STEP, completedAt: START + 2 * STEP + 5 });
  assert.equal(getResolutionRunDiagnostics().consecutiveQualifyingScheduledRuns, 0);
  tick(2, { metrics: { ...metrics, direct: 1.5 } });
  tick(3, { metrics: { ...metrics, pending: -1 } });
  assert.equal(getResolutionRunDiagnostics().receipts.at(-1)?.metrics, null);
  assert.equal(getResolutionRunDiagnostics().receipts.at(-2)?.metrics, null);
  tick(5, { dueAt: START + 6 * STEP });
  assert.equal(getResolutionRunDiagnostics().receipts.length, 4);
});

test('bridge expiry counts are separate, bounded and free from caller payloads', () => {
  tick(0.3, { kind: 'bridge', metrics: { enabled: true, failed: false, shortageExpired: 2, advisoryExpired: 0, legacyExpired: 1, secret: 'extra' } });
  assert.deepEqual(getResolutionRunDiagnostics().receipts[0]?.metrics, { enabled: true, failed: false, shortageExpired: 2, advisoryExpired: 0, legacyExpired: 1 });
  for (const invalid of [{ enabled: 'false' }, { failed: 0 }, { shortageExpired: null }, { legacyExpired: -1 }]) {
    tick(1, { kind: 'bridge', metrics: { enabled: true, failed: false, shortageExpired: 0, advisoryExpired: 0, legacyExpired: 0, ...invalid } });
    assert.equal(getResolutionRunDiagnostics().receipts.at(-1)?.metrics, null);
  }
});
