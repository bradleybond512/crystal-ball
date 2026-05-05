import assert from 'node:assert/strict';
import test from 'node:test';

import { createMissionLedger } from '../mission-ledger.ts';
import {
  MISSION_LEDGER_CACHE_KEY,
  applyMissionTrimPolicy,
  getMissionLedgerPersistenceStatus,
  hydrateMissionLedger,
  persistMissionLedger,
  resetMissionLedgerPersistence,
  toCompactMission,
  trimAndPersistMissionLedger,
  validateMissionRecords,
} from '../mission-ledger-persistence.ts';
import type { MissionDomain, MissionRecord, MissionStatus } from '../mission-types.ts';

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
    read: async (key: string): Promise<MissionRecord[] | null> => {
      assert.equal(key, MISSION_LEDGER_CACHE_KEY);
      if (throwOnRead) throw throwOnRead;
      if (store === null || store === undefined) return null;
      return store as MissionRecord[] | null;
    },
    write: async (key: string, records: MissionRecord[]): Promise<void> => {
      assert.equal(key, MISSION_LEDGER_CACHE_KEY);
      if (throwOnWrite) throw throwOnWrite;
      store = records.map((r) => ({ ...r, events: r.events.map((e) => ({ ...e })) }));
    },
    emitDiagnostic: (
      severity: 'info' | 'warning' | 'error' | 'critical',
      message: string,
      detail?: Record<string, unknown>,
    ): void => {
      events.push({ severity, message, detail });
    },
    snapshotStore(): MissionRecord[] | null {
      return Array.isArray(store)
        ? (store as MissionRecord[]).map((r) => ({ ...r, events: r.events.map((e) => ({ ...e })) }))
        : null;
    },
  };
}

function mission(overrides: Partial<MissionRecord> & { id: string; createdAt: number }): MissionRecord {
  return {
    id: overrides.id,
    domain: (overrides.domain ?? 'weather_safety') as MissionDomain,
    description: overrides.description ?? 'Test mission',
    createdAt: overrides.createdAt,
    status: (overrides.status ?? 'active') as MissionStatus,
    events: overrides.events ?? [],
    factId: overrides.factId,
    placeId: overrides.placeId,
    originAlgorithmId: overrides.originAlgorithmId,
    explanationScore: overrides.explanationScore,
    resolvedAt: overrides.resolvedAt,
    resolutionReason: overrides.resolutionReason,
  };
}

test.beforeEach(() => {
  resetMissionLedgerPersistence();
});

// ── Hydrate ─────────────────────────────────────────────────────────────

test('hydrateMissionLedger: empty cache leaves the ledger untouched and reports ok', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setStore(null);
  const status = await hydrateMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'ok');
  assert.equal(status.missionCount, 0);
  assert.equal(adapter.events.length, 0);
});

test('hydrateMissionLedger: round-trips a resolved mission', async () => {
  const source = createMissionLedger({ now: () => NOW });
  source.openMission({
    id: 'mission-x',
    domain: 'weather_safety',
    description: 'tornado',
    createdAt: NOW,
  });
  source.recordEvent('mission-x', { at: NOW + 1, kind: 'user_notified', label: 'sent' });
  source.resolveMission('mission-x', 'resolved_hit', 'matched', NOW + 100);
  const persisted = source.toJson();

  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setStore(persisted);
  const status = await hydrateMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW + 200,
  });
  assert.equal(status.missionCount, 1);
  const reloaded = ledger.get('mission-x');
  assert.equal(reloaded?.status, 'resolved_hit');
  assert.equal(reloaded?.events.length, 1);
});

test('hydrateMissionLedger: corrupt mission rejected with diagnostic, ledger stays empty', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setStore([{ id: 'bad', domain: 'nope' } as unknown as MissionRecord]);
  const status = await hydrateMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /shape check/);
  assert.equal(ledger.all().length, 0);
  assert.equal(adapter.events[0]?.severity, 'warning');
});

test('hydrateMissionLedger: read throw fails closed', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setThrowOnRead(new Error('disk dead'));
  const status = await hydrateMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /disk dead/);
});

test('hydrateMissionLedger: non-array payload rejected', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setStore({ what: 'no' });
  const status = await hydrateMissionLedger({
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

test('persistMissionLedger: writes ledger.toJson and reports ok', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  ledger.openMission({
    id: 'mission-1',
    domain: 'cyber_exposure',
    description: 'CVE published',
    createdAt: NOW,
  });
  const adapter = makeAdapter();
  const status = await persistMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW + 1,
  });
  assert.equal(status.lastSaveStatus, 'ok');
  assert.equal(status.missionCount, 1);
  const stored = adapter.snapshotStore();
  assert.equal(stored?.length, 1);
});

test('persistMissionLedger: write throw reports error', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  const adapter = makeAdapter();
  adapter.setThrowOnWrite(new Error('quota'));
  const status = await persistMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW,
  });
  assert.equal(status.lastSaveStatus, 'error');
  assert.match(status.lastError ?? '', /quota/);
});

// ── Compaction ──────────────────────────────────────────────────────────

test('toCompactMission: strips event.detail from resolved missions', () => {
  const m: MissionRecord = mission({
    id: 'mission-r',
    createdAt: NOW,
    status: 'resolved_hit',
    resolvedAt: NOW + 10,
    events: [
      { id: 'me-1', at: NOW + 1, kind: 'user_notified', label: 'sent', detail: { secret: 'pii' } },
    ],
  });
  const compact = toCompactMission(m);
  assert.equal(compact.events[0]?.detail, undefined);
});

test('toCompactMission: keeps event.detail on active missions', () => {
  const m: MissionRecord = mission({
    id: 'mission-a',
    createdAt: NOW,
    status: 'active',
    events: [
      { id: 'me-1', at: NOW + 1, kind: 'app_watch', label: 'watching', detail: { stillNeeded: true } },
    ],
  });
  const compact = toCompactMission(m);
  assert.equal(compact.events[0]?.detail?.stillNeeded, true);
});

test('persistMissionLedger: persists compacted form', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  ledger.openMission({
    id: 'mission-c',
    domain: 'weather_safety',
    description: 'storm',
    createdAt: NOW,
  });
  ledger.recordEvent('mission-c', {
    at: NOW + 1,
    kind: 'user_notified',
    label: 'sent',
    detail: { wouldBeStripped: true },
  });
  ledger.resolveMission('mission-c', 'resolved_hit', 'matched', NOW + 10);
  const adapter = makeAdapter();
  await persistMissionLedger({
    ledger,
    read: adapter.read,
    write: adapter.write,
    emitDiagnostic: adapter.emitDiagnostic,
    now: () => NOW + 20,
  });
  const stored = adapter.snapshotStore();
  assert.equal(stored?.[0]?.events[0]?.detail, undefined, 'resolved mission events lose detail on persist');
});

// ── Trim policy ────────────────────────────────────────────────────────

test('applyMissionTrimPolicy: drops completed missions past age cutoff but preserves active', () => {
  const records: MissionRecord[] = [
    mission({ id: 'mission-1', createdAt: NOW - 100, status: 'resolved_miss', resolvedAt: NOW - 90 }),
    mission({ id: 'mission-2', createdAt: NOW - 50, status: 'resolved_hit', resolvedAt: NOW - 40 }),
    mission({ id: 'mission-3', createdAt: NOW - 200, status: 'active' }),
  ];
  const kept = applyMissionTrimPolicy(records, { maxMissions: 1_000, maxCompletedAgeMs: 75, nowMs: NOW });
  const ids = kept.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mission-2', 'mission-3'], 'old completed dropped, active preserved despite age');
});

test('applyMissionTrimPolicy: drops oldest completed first when over count cap', () => {
  const records: MissionRecord[] = [
    mission({ id: 'mission-1', createdAt: NOW - 5, status: 'resolved_hit', resolvedAt: NOW - 4 }),
    mission({ id: 'mission-2', createdAt: NOW - 4, status: 'resolved_miss', resolvedAt: NOW - 3 }),
    mission({ id: 'mission-3', createdAt: NOW - 3, status: 'expired', resolvedAt: NOW - 2 }),
    mission({ id: 'mission-4', createdAt: NOW - 2, status: 'active' }),
    mission({ id: 'mission-5', createdAt: NOW - 1, status: 'active' }),
  ];
  const kept = applyMissionTrimPolicy(records, { maxMissions: 3, maxCompletedAgeMs: 1_000, nowMs: NOW });
  const ids = kept.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mission-3', 'mission-4', 'mission-5'], 'oldest completed dropped, active preserved');
});

test('applyMissionTrimPolicy: when active alone exceeds cap, keeps all active and drops every completed', () => {
  const records: MissionRecord[] = [
    mission({ id: 'mission-1', createdAt: NOW - 5, status: 'resolved_hit', resolvedAt: NOW - 4 }),
    mission({ id: 'mission-2', createdAt: NOW - 4, status: 'active' }),
    mission({ id: 'mission-3', createdAt: NOW - 3, status: 'active' }),
    mission({ id: 'mission-4', createdAt: NOW - 2, status: 'active' }),
  ];
  const kept = applyMissionTrimPolicy(records, { maxMissions: 2, maxCompletedAgeMs: 1_000, nowMs: NOW });
  const ids = kept.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mission-2', 'mission-3', 'mission-4'], 'active preserved over count cap; completed dropped');
});

test('trimAndPersistMissionLedger: writes trimmed ledger and reports trimmedCount', async () => {
  const ledger = createMissionLedger({ now: () => NOW });
  ledger.loadJson([
    mission({ id: 'mission-old', createdAt: NOW - 200, status: 'resolved_miss', resolvedAt: NOW - 180, events: [] }),
    mission({ id: 'mission-recent', createdAt: NOW - 50, status: 'resolved_hit', resolvedAt: NOW - 40, events: [] }),
    mission({ id: 'mission-active', createdAt: NOW - 1, status: 'active', events: [] }),
  ]);
  const adapter = makeAdapter();
  const status = await trimAndPersistMissionLedger(
    { maxMissions: 1_000, maxCompletedAgeMs: 100 },
    {
      ledger,
      read: adapter.read,
      write: adapter.write,
      emitDiagnostic: adapter.emitDiagnostic,
      now: () => NOW,
    },
  );
  assert.equal(status.trimmedCount, 1);
  assert.equal(status.missionCount, 2);
  assert.equal(status.lastSaveStatus, 'ok');
});

// ── Validation ──────────────────────────────────────────────────────────

test('validateMissionRecords: rejects unknown domain', () => {
  const out = validateMissionRecords([
    { id: 'm', domain: 'nope', description: '', createdAt: 1, status: 'active', events: [] },
  ]);
  assert.equal(out.ok, false);
});

test('validateMissionRecords: rejects unknown status', () => {
  const out = validateMissionRecords([
    { id: 'm', domain: 'weather_safety', description: '', createdAt: 1, status: 'frozen', events: [] },
  ]);
  assert.equal(out.ok, false);
});

test('validateMissionRecords: rejects malformed event', () => {
  const out = validateMissionRecords([
    {
      id: 'm',
      domain: 'weather_safety',
      description: '',
      createdAt: 1,
      status: 'active',
      events: [{ id: 'e', at: 'now', kind: 'user_notified', label: '' }],
    },
  ]);
  assert.equal(out.ok, false);
});

test('validateMissionRecords: accepts a clean record', () => {
  const out = validateMissionRecords([
    {
      id: 'm',
      domain: 'weather_safety',
      description: 'ok',
      createdAt: 1,
      status: 'active',
      events: [{ id: 'e', at: 1, kind: 'user_notified', label: 'sent' }],
    },
  ]);
  assert.equal(out.ok, true);
});

// ── Status ──────────────────────────────────────────────────────────────

test('getMissionLedgerPersistenceStatus: starts idle', () => {
  resetMissionLedgerPersistence();
  const status = getMissionLedgerPersistenceStatus();
  assert.equal(status.lastLoadStatus, 'idle');
  assert.equal(status.lastSaveStatus, 'idle');
  assert.equal(status.missionCount, 0);
  assert.equal(status.trimmedCount, 0);
  assert.equal(status.rejectedCount, 0);
});
