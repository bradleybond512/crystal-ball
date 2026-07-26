import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlgorithmEvaluationLedger, type EvaluationRecord } from '../algorithm-evaluation-ledger.ts';
import {
  ALGORITHM_LEDGER_CACHE_KEY,
  applyTrimPolicy,
  getAlgorithmLedgerPersistenceStatus,
  hydrateAlgorithmLedger,
  persistAlgorithmLedger,
  resetAlgorithmLedgerPersistence,
  startAlgorithmLedgerPersistence,
  trimAndPersistAlgorithmLedger,
  validateRecords,
} from '../algorithm-ledger-persistence.ts';

const NOW = 1_745_000_000_000;

interface DiagnosticEvent {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  detail?: Record<string, unknown>;
}

function makeAdapter() {
  const events: DiagnosticEvent[] = [];
  let store: unknown = null;
  let throwOnRead: Error | null = null;
  let throwOnWrite: Error | null = null;
  return {
    events,
    setStore(records: unknown) {
      store = records;
    },
    setThrowOnRead(error: Error | null) {
      throwOnRead = error;
    },
    setThrowOnWrite(error: Error | null) {
      throwOnWrite = error;
    },
    read: async (key: string): Promise<EvaluationRecord[] | null> => {
      assert.equal(key, ALGORITHM_LEDGER_CACHE_KEY);
      if (throwOnRead) throw throwOnRead;
      if (store === null || store === undefined) return null;
      // Pass the value straight through (including invalid shapes); the
      // persistence module is responsible for validating.
      return store as EvaluationRecord[] | null;
    },
    write: async (key: string, records: EvaluationRecord[]): Promise<void> => {
      assert.equal(key, ALGORITHM_LEDGER_CACHE_KEY);
      if (throwOnWrite) throw throwOnWrite;
      store = records.map((r) => ({ ...r }));
    },
    emitDiagnostic: (
      severity: 'info' | 'warning' | 'error' | 'critical',
      message: string,
      detail?: Record<string, unknown>,
    ): void => {
      events.push({ severity, message, detail });
    },
    snapshotStore(): EvaluationRecord[] | null {
      return Array.isArray(store) ? (store as EvaluationRecord[]).map((r) => ({ ...r })) : null;
    },
  };
}

function record(overrides: Partial<EvaluationRecord> & { id: string; at: number }): EvaluationRecord {
  return {
    id: overrides.id,
    algorithmId: overrides.algorithmId ?? 'truth-score',
    domain: overrides.domain ?? 'truth_score',
    at: overrides.at,
    durationMs: overrides.durationMs ?? 5,
    score: overrides.score,
    label: overrides.label,
    notes: overrides.notes,
    detail: overrides.detail,
    outcome: overrides.outcome,
    outcomeAt: overrides.outcomeAt,
    outcomeReason: overrides.outcomeReason,
    inputHash: overrides.inputHash,
    version: overrides.version,
  };
}

test.beforeEach(() => {
  resetAlgorithmLedgerPersistence();
});

// ── Hydrate ─────────────────────────────────────────────────────────────

test('hydrateAlgorithmLedger: empty cache leaves the ledger untouched and reports ok', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setStore(null);
  const result = await hydrateAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(result.lastLoadStatus, 'ok');
  assert.equal(result.lastLoadedAt, NOW);
  assert.equal(result.recordCount, 0);
  assert.equal(result.lastError, null);
  assert.equal(ledger.all().length, 0);
  assert.equal(adapter.events.length, 0);
});

test('hydrateAlgorithmLedger: round-trips records through serialize/load', async () => {
  const source = createAlgorithmEvaluationLedger();
  const r = source.recordEvaluation({
    algorithmId: 'truth-score',
    domain: 'truth_score',
    at: NOW,
    durationMs: 7,
  });
  source.recordOutcome(r.id, 'hit', 'matched');
  const persisted = source.toJson();

  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setStore(persisted);
  const status = await hydrateAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'ok');
  assert.equal(status.recordCount, 1);
  const loaded = ledger.get(r.id);
  assert.equal(loaded?.outcome, 'hit');
  assert.equal(loaded?.outcomeReason, 'matched');
});

test('hydrateAlgorithmLedger: corrupt payload fails closed and emits a diagnostic', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setStore([{ id: '', algorithmId: 'x' } as unknown as EvaluationRecord]);
  const status = await hydrateAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /shape check/);
  assert.equal(ledger.all().length, 0, 'ledger stays empty when payload is corrupt');
  assert.equal(adapter.events.length, 1);
  assert.equal(adapter.events[0]?.severity, 'warning');
});

test('hydrateAlgorithmLedger: read throw fails closed and reports the error', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setThrowOnRead(new Error('disk on fire'));
  const status = await hydrateAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /disk on fire/);
  assert.equal(ledger.all().length, 0);
  assert.equal(adapter.events[0]?.severity, 'error');
});

test('hydrateAlgorithmLedger: non-array payload rejected with diagnostic', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setStore({ what: 'no' } as unknown as EvaluationRecord[]);
  const status = await hydrateAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /not an array/);
});

// ── Persist ─────────────────────────────────────────────────────────────

test('persistAlgorithmLedger: writes ledger.toJson under the stable key', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    algorithmId: 'compound-risk',
    domain: 'compound_risk',
    at: NOW,
    durationMs: 4,
  });
  const adapter = makeAdapter();
  const status = await persistAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW + 1,
  });
  assert.equal(status.lastSaveStatus, 'ok');
  assert.equal(status.lastSavedAt, NOW + 1);
  assert.equal(status.recordCount, 1);
  const stored = adapter.snapshotStore();
  assert.equal(stored?.length, 1);
  assert.equal(stored?.[0]?.algorithmId, 'compound-risk');
});

test('persistAlgorithmLedger: write throw reports an error and emits diagnostic', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setThrowOnWrite(new Error('quota'));
  const status = await persistAlgorithmLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastSaveStatus, 'error');
  assert.match(status.lastError ?? '', /quota/);
  assert.equal(adapter.events[0]?.severity, 'error');
});

test('startAlgorithmLedgerPersistence: hydrates before registering periodic saves', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  const adapter = makeAdapter();
  adapter.setStore([
    record({ id: 'eval-7', at: NOW - 1, outcome: 'hit', outcomeAt: NOW, outcomeReason: 'persisted' }),
  ]);
  let registered: {
    name: string;
    fn: () => void;
    intervalMs: number;
    options: { priority?: string; runImmediately?: boolean };
  } | null = null;

  const status = await startAlgorithmLedgerPersistence({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
    intervalMs: 1234,
    registerLoop: (name, fn, intervalMs, options) => {
      registered = { name, fn, intervalMs, options };
      return {
        cancel() {},
        inspect: () => ({
          name,
          intervalMs,
          priority: options.priority ?? 'normal',
          registeredAt: NOW,
          paused: false,
          tickCount: 0,
        }),
      };
    },
  });

  assert.equal(status.lastLoadStatus, 'ok');
  assert.equal(status.lastSaveStatus, 'ok');
  assert.equal(status.recordCount, 1);
  assert.equal(ledger.get('eval-7')?.outcome, 'hit');
  assert.equal(registered?.name, 'algorithm-ledger-persistence');
  assert.equal(registered?.intervalMs, 1234);
  assert.deepEqual(registered?.options, { priority: 'normal' });

  ledger.recordEvaluation({
    algorithmId: 'compound-risk',
    domain: 'compound_risk',
    at: NOW,
    durationMs: 4,
  });
  registered?.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.snapshotStore()?.length, 2);
  assert.equal(getAlgorithmLedgerPersistenceStatus().lastSaveStatus, 'ok');
});

// ── Trim policy ────────────────────────────────────────────────────────

test('applyTrimPolicy: drops graded records past the age cutoff but preserves pending', () => {
  const records: EvaluationRecord[] = [
    record({ id: 'eval-1', at: NOW - 100, outcome: 'hit', outcomeAt: NOW - 90, outcomeReason: 'old' }),
    record({ id: 'eval-2', at: NOW - 50, outcome: 'miss', outcomeAt: NOW - 49, outcomeReason: 'recent' }),
    record({ id: 'eval-3', at: NOW - 200 }),
  ];
  const kept = applyTrimPolicy(records, { maxRecords: 1_000, maxAgeMs: 75, nowMs: NOW });
  const ids = kept.map((r) => r.id).sort();
  assert.deepEqual(ids, ['eval-2', 'eval-3'], 'ungraded eval-3 stays even though older than the age cutoff');
});

test('applyTrimPolicy: drops oldest graded first when over count cap', () => {
  const records: EvaluationRecord[] = [
    record({ id: 'eval-1', at: NOW - 5, outcome: 'hit', outcomeAt: NOW - 4, outcomeReason: 'oldest graded' }),
    record({ id: 'eval-2', at: NOW - 4, outcome: 'hit', outcomeAt: NOW - 3, outcomeReason: 'middle graded' }),
    record({ id: 'eval-3', at: NOW - 3, outcome: 'hit', outcomeAt: NOW - 2, outcomeReason: 'newest graded' }),
    record({ id: 'eval-4', at: NOW - 2 }),
    record({ id: 'eval-5', at: NOW - 1 }),
  ];
  const kept = applyTrimPolicy(records, { maxRecords: 3, maxAgeMs: 1_000, nowMs: NOW });
  const ids = kept.map((r) => r.id).sort();
  assert.deepEqual(ids, ['eval-3', 'eval-4', 'eval-5'], 'pending preserved, oldest graded dropped first');
});

test('applyTrimPolicy: when pending alone exceeds cap, keeps an outcome-horizon cohort plus current samples', () => {
  const records: EvaluationRecord[] = [
    record({ id: 'eval-1', at: NOW - 5 }),
    record({ id: 'eval-2', at: NOW - 4 }),
    record({ id: 'eval-3', at: NOW - 3 }),
    record({ id: 'eval-4', at: NOW - 2 }),
  ];
  const kept = applyTrimPolicy(records, { maxRecords: 2, maxAgeMs: 1_000, nowMs: NOW });
  const ids = kept.map((r) => r.id).sort();
  assert.deepEqual(ids, ['eval-1', 'eval-4'], 'oldest grading candidate and newest runtime sample are both kept');
});

test('applyTrimPolicy: balances the outcome-horizon cohort across algorithms', () => {
  const records: EvaluationRecord[] = [
    ...Array.from({ length: 6 }, (_, index) => record({
      id: `alpha-${index}`,
      algorithmId: 'alpha',
      at: NOW - 20 + index,
    })),
    ...Array.from({ length: 6 }, (_, index) => record({
      id: `beta-${index}`,
      algorithmId: 'beta',
      at: NOW - 20 + index,
    })),
  ];
  const kept = applyTrimPolicy(records, { maxRecords: 8, maxAgeMs: 1_000, nowMs: NOW });
  const ids = new Set(kept.map((r) => r.id));
  assert.equal(kept.length, 8);
  assert.equal(ids.has('alpha-0'), true);
  assert.equal(ids.has('beta-0'), true);
  assert.equal(ids.has('alpha-5'), true);
  assert.equal(ids.has('beta-5'), true);
});

test('applyTrimPolicy: reserves history for graded outcomes even under pending pressure', () => {
  const records: EvaluationRecord[] = [
    record({ id: 'graded-1', at: NOW - 10, outcome: 'hit', outcomeAt: NOW - 5 }),
    record({ id: 'graded-2', at: NOW - 9, outcome: 'miss', outcomeAt: NOW - 4 }),
    ...Array.from({ length: 6 }, (_, index) => record({
      id: `pending-${index}`,
      at: NOW - 8 + index,
    })),
  ];
  const kept = applyTrimPolicy(records, { maxRecords: 4, maxAgeMs: 1_000, nowMs: NOW });
  assert.equal(kept.length, 4);
  assert.ok(kept.some((r) => r.outcome !== undefined), 'at least one graded record survives');
  assert.ok(kept.some((r) => r.outcome === undefined), 'pending runtime evidence also survives');
});

test('trimAndPersistAlgorithmLedger: writes the trimmed ledger and reports trimmedCount', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.loadJson([
    record({ id: 'eval-1', at: NOW - 100, outcome: 'hit', outcomeAt: NOW - 90, outcomeReason: 'old' }),
    record({ id: 'eval-2', at: NOW - 50, outcome: 'miss', outcomeAt: NOW - 49, outcomeReason: 'recent' }),
    record({ id: 'eval-3', at: NOW - 5 }),
  ]);
  const adapter = makeAdapter();
  const status = await trimAndPersistAlgorithmLedger(
    { maxRecords: 1_000, maxAgeMs: 75 },
    {
      ledger,
      read: adapter.read,
      write: adapter.write,
      emitDiagnostic: adapter.emitDiagnostic,
      now: () => NOW,
    },
  );
  assert.equal(status.trimmedCount, 1, 'eval-1 was dropped by age cutoff');
  assert.equal(status.trimmedGradedCount, 1);
  assert.equal(status.trimmedPendingCount, 0);
  assert.equal(status.gradedRecordCount, 1);
  assert.equal(status.pendingRecordCount, 1);
  assert.equal(status.recordCount, 2);
  assert.equal(status.lastSaveStatus, 'ok');
  const stored = adapter.snapshotStore();
  assert.equal(stored?.length, 2);
});

// ── Validation ──────────────────────────────────────────────────────────

test('validateRecords: rejects unknown domains', () => {
  const out = validateRecords([
    { id: 'a', algorithmId: 'x', domain: 'nope', at: 1, durationMs: 1 },
  ]);
  assert.equal(out.ok, false);
});

test('validateRecords: rejects non-finite at', () => {
  const out = validateRecords([
    { id: 'a', algorithmId: 'x', domain: 'truth_score', at: 'today', durationMs: 1 },
  ]);
  assert.equal(out.ok, false);
});

test('validateRecords: accepts a clean record', () => {
  const out = validateRecords([
    { id: 'a', algorithmId: 'x', domain: 'truth_score', at: 1, durationMs: 1 },
  ]);
  assert.equal(out.ok, true);
});

// ── Status ──────────────────────────────────────────────────────────────

test('getAlgorithmLedgerPersistenceStatus: starts idle', () => {
  resetAlgorithmLedgerPersistence();
  const status = getAlgorithmLedgerPersistenceStatus();
  assert.equal(status.lastLoadStatus, 'idle');
  assert.equal(status.lastSaveStatus, 'idle');
  assert.equal(status.recordCount, 0);
  assert.equal(status.trimmedCount, 0);
  assert.equal(status.trimmedGradedCount, 0);
  assert.equal(status.trimmedPendingCount, 0);
  assert.equal(status.gradedRecordCount, 0);
  assert.equal(status.pendingRecordCount, 0);
  assert.equal(status.oldestPendingAt, null);
  assert.equal(status.pendingCoverageMs, 0);
  assert.equal(status.rejectedCount, 0);
  assert.equal(status.lastError, null);
});
