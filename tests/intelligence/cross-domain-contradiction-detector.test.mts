import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CrossDomainContradictionDetector,
  STORAGE_KEY,
  MAX_RECORDS,
  WINDOW_MS,
  type ContradictionRecord,
} from '../../src/services/intelligence/cross-domain-contradiction-detector.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();
const HOUR_MS = 60 * 60 * 1000;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'test',
    domain: 'earthquake',
    timestamp: NOW_MS,
    severity: 'MEDIUM' as ObservationSeverity,
    title: 'Test event',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function newDetector() {
  CrossDomainContradictionDetector._resetSingletonForTests();
  return new CrossDomainContradictionDetector({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
  });
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-cross-domain-contradiction-detector"', () => {
  assert.equal(STORAGE_KEY, 'wm-cross-domain-contradiction-detector');
});

test('MAX_RECORDS is 300', () => {
  assert.equal(MAX_RECORDS, 300);
});

test('WINDOW_MS is two hours', () => {
  assert.equal(WINDOW_MS, 2 * HOUR_MS);
});

// ── Singleton ────────────────────────────────────────────────────────────

test('getInstance returns the same instance', () => {
  CrossDomainContradictionDetector._resetSingletonForTests();
  const a = CrossDomainContradictionDetector.getInstance();
  const b = CrossDomainContradictionDetector.getInstance();
  assert.equal(a, b);
});

// ── checkForContradictions: detection ────────────────────────────────────

test('CRITICAL vs LOW in same region within window → HIGH contradiction', () => {
  const det = newDetector();
  const obs: ObservationEvent[] = [
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:east-asia'] }),
    makeObs({ id: 'b', domain: 'geopolitical', severity: 'LOW', tags: ['region:east-asia'] }),
  ];
  const records = det.checkForContradictions(obs);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.severity, 'high');
  assert.equal(records[0]?.region, 'east-asia');
});

test('contradiction pairs (domainA, domainB) sorted lexicographically', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.domainA, 'cyber');
  assert.equal(records[0]?.domainB, 'weather');
});

test('HIGH vs LOW in same region → HIGH contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'maritime', severity: 'HIGH', tags: ['region:gulf'] }),
    makeObs({ id: 'b', domain: 'aviation', severity: 'LOW', tags: ['region:gulf'] }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.severity, 'high');
});

test('CRITICAL vs INFO → HIGH contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'cyber', severity: 'CRITICAL', tags: ['region:x'] }),
    makeObs({ id: 'b', domain: 'weather', severity: 'INFO', tags: ['region:x'] }),
  ]);
  assert.equal(records[0]?.severity, 'high');
});

test('MEDIUM vs LOW in same region → MEDIUM contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'MEDIUM', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.severity, 'medium');
});

test('MEDIUM vs MEDIUM in same region → no contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'MEDIUM', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'MEDIUM', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('same severity across domains → no contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'HIGH', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'HIGH', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('LOW vs LOW → no contradiction (no severity spread)', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('same domain different severities → no contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'weather', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('different regions → no contradiction across domains', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  assert.equal(records.length, 0);
});

test('outside 2h window → no contradiction', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', timestamp: NOW_MS, tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', timestamp: NOW_MS + 3 * HOUR_MS, tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('within 2h window → contradiction detected', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', timestamp: NOW_MS, tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', timestamp: NOW_MS + HOUR_MS, tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 1);
});

test('records assigned unique ids + detectedAt', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'aviation', severity: 'HIGH', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'maritime', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  assert.equal(records.length, 2);
  const ids = new Set(records.map((r) => r.id));
  assert.equal(ids.size, 2);
  for (const r of records) assert.equal(r.detectedAt, NOW_MS);
});

test('description includes both domain names + severities', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:east-asia'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:east-asia'] }),
  ]);
  const desc = records[0]?.description ?? '';
  assert.ok(desc.includes('weather'));
  assert.ok(desc.includes('maritime'));
});

// ── Region extraction ────────────────────────────────────────────────────

test('region falls back to undefined when no region tag present', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: [] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: [] }),
  ]);
  // Without a region tag, observations are not grouped, so no contradictions.
  assert.equal(records.length, 0);
});

test('multiple region tags on one observation use the first', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:primary', 'region:secondary'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:primary'] }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.region, 'primary');
});

// ── De-duplication: re-runs do not re-record ─────────────────────────────

test('re-running same observations does not add duplicate records', () => {
  const det = newDetector();
  const obs: ObservationEvent[] = [
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ];
  det.checkForContradictions(obs);
  const second = det.checkForContradictions(obs);
  assert.equal(second.length, 0);
  assert.equal(det.getActive().length, 1);
});

test('only NEW contradictions returned from checkForContradictions', () => {
  const det = newDetector();
  det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  // New observation pair → should return only this new one
  const newOnes = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'aviation', severity: 'HIGH', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'cyber', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  assert.equal(newOnes.length, 1);
  assert.equal(newOnes[0]?.region, 'r2');
});

// ── getActive ────────────────────────────────────────────────────────────

test('getActive returns unresolved contradictions', () => {
  const det = newDetector();
  det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  assert.equal(det.getActive().length, 1);
});

test('getActive newest first', () => {
  const det = newDetector();
  // Record at t=NOW_MS
  det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  // Reset singleton state and add a NEWER record
  const storage = createMemoryStorage();
  CrossDomainContradictionDetector._resetSingletonForTests();
  let t = NOW_MS;
  const det2 = new CrossDomainContradictionDetector({ storage, now: () => t });
  det2.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  t += 1000;
  det2.checkForContradictions([
    makeObs({ id: 'c', domain: 'aviation', severity: 'CRITICAL', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'cyber', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  const active = det2.getActive();
  assert.equal(active[0]?.region, 'r2');
});

test('resolved contradictions excluded from getActive', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  const id = records[0]?.id ?? '';
  det.resolve(id, 'operator');
  assert.equal(det.getActive().length, 0);
});

// ── resolve ──────────────────────────────────────────────────────────────

test('resolve sets resolvedAt + resolvedBy', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  const id = records[0]?.id ?? '';
  det.resolve(id, 'analyst-1');
  const all = det.getAll();
  const found = all.find((r: ContradictionRecord) => r.id === id);
  assert.equal(found?.resolvedBy, 'analyst-1');
  assert.equal(found?.resolvedAt, NOW_MS);
});

test('resolve unknown id is a no-op', () => {
  const det = newDetector();
  assert.doesNotThrow(() => det.resolve('nope', 'analyst-1'));
});

test('resolve already-resolved is a no-op', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  const id = records[0]?.id ?? '';
  det.resolve(id, 'first');
  det.resolve(id, 'second');
  const found = det.getAll().find((r: ContradictionRecord) => r.id === id);
  // First resolver wins
  assert.equal(found?.resolvedBy, 'first');
});

// ── getStats ─────────────────────────────────────────────────────────────

test('getStats.total counts all records', () => {
  const det = newDetector();
  det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'cyber', severity: 'CRITICAL', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'aviation', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  assert.equal(det.getStats().total, 2);
});

test('getStats.active counts unresolved records', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'cyber', severity: 'CRITICAL', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'aviation', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  det.resolve(records[0]?.id ?? '', 'me');
  const stats = det.getStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.active, 1);
});

test('getStats.byDomain counts contradictions involving each domain', () => {
  const det = newDetector();
  det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'weather', severity: 'CRITICAL', tags: ['region:r2'] }),
    makeObs({ id: 'd', domain: 'aviation', severity: 'LOW', tags: ['region:r2'] }),
  ]);
  const stats = det.getStats();
  // weather appears in both contradictions, maritime + aviation in one each
  assert.equal(stats.byDomain.weather, 2);
  assert.equal(stats.byDomain.maritime, 1);
  assert.equal(stats.byDomain.aviation, 1);
});

test('getStats on empty detector', () => {
  const det = newDetector();
  const stats = det.getStats();
  assert.equal(stats.total, 0);
  assert.equal(stats.active, 0);
  assert.deepEqual(stats.byDomain, {});
});

// ── Ring buffer ──────────────────────────────────────────────────────────

test('ring buffer evicts oldest at MAX_RECORDS', () => {
  const det = newDetector();
  for (let i = 0; i < MAX_RECORDS + 20; i++) {
    det.checkForContradictions([
      makeObs({ id: `a${i}`, domain: 'weather', severity: 'CRITICAL', tags: [`region:r${i}`] }),
      makeObs({ id: `b${i}`, domain: 'maritime', severity: 'LOW', tags: [`region:r${i}`] }),
    ]);
  }
  assert.ok(det.getAll().length <= MAX_RECORDS);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('records persist across instances', () => {
  const storage = createMemoryStorage();
  CrossDomainContradictionDetector._resetSingletonForTests();
  const det1 = new CrossDomainContradictionDetector({ storage, now: () => NOW_MS });
  det1.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);

  CrossDomainContradictionDetector._resetSingletonForTests();
  const det2 = new CrossDomainContradictionDetector({ storage, now: () => NOW_MS });
  assert.equal(det2.getAll().length, 1);
});

test('resolved status persists across instances', () => {
  const storage = createMemoryStorage();
  CrossDomainContradictionDetector._resetSingletonForTests();
  const det1 = new CrossDomainContradictionDetector({ storage, now: () => NOW_MS });
  const records = det1.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
  ]);
  det1.resolve(records[0]?.id ?? '', 'analyst');

  CrossDomainContradictionDetector._resetSingletonForTests();
  const det2 = new CrossDomainContradictionDetector({ storage, now: () => NOW_MS });
  assert.equal(det2.getActive().length, 0);
});

// ── Empty input handling ─────────────────────────────────────────────────

test('checkForContradictions returns [] for empty input', () => {
  const det = newDetector();
  assert.deepEqual(det.checkForContradictions([]), []);
});

test('checkForContradictions returns [] for single observation', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
  ]);
  assert.equal(records.length, 0);
});

test('three-domain contradiction yields multiple pair records', () => {
  const det = newDetector();
  const records = det.checkForContradictions([
    makeObs({ id: 'a', domain: 'weather', severity: 'CRITICAL', tags: ['region:r1'] }),
    makeObs({ id: 'b', domain: 'maritime', severity: 'LOW', tags: ['region:r1'] }),
    makeObs({ id: 'c', domain: 'aviation', severity: 'INFO', tags: ['region:r1'] }),
  ]);
  // weather↔maritime AND weather↔aviation should both fire
  assert.ok(records.length >= 2);
});
