import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createContradictionDetector,
  STORAGE_KEY,
  MAX_CONTRADICTIONS,
  CONFIDENCE_BY_TYPE,
  type ConflictType,
} from '../../src/services/intelligence/contradiction-detector.ts';
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

const NOW = new Date('2026-05-16T12:00:00Z').getTime();

let _idCounter = 0;
function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  _idCounter += 1;
  return {
    id: overrides.id ?? `ev-${_idCounter}`,
    sourceId: overrides.sourceId ?? 'src-a',
    domain: overrides.domain ?? 'earthquake',
    timestamp: overrides.timestamp ?? NOW,
    location: overrides.location,
    severity: overrides.severity ?? 'HIGH',
    title: overrides.title ?? 'test obs',
    raw: overrides.raw ?? {},
    entityIds: overrides.entityIds ?? ['ent-1'],
    tags: overrides.tags ?? [],
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-contradiction-detector"', () => {
  assert.equal(STORAGE_KEY, 'wm-contradiction-detector');
});

test('MAX_CONTRADICTIONS is 300', () => {
  assert.equal(MAX_CONTRADICTIONS, 300);
});

test('CONFIDENCE_BY_TYPE matches spec', () => {
  assert.equal(CONFIDENCE_BY_TYPE['severity-mismatch'], 0.9);
  assert.equal(CONFIDENCE_BY_TYPE['status-conflict'], 0.85);
  assert.equal(CONFIDENCE_BY_TYPE['source-disagreement'], 0.8);
  assert.equal(CONFIDENCE_BY_TYPE['trend-reversal'], 0.7);
  assert.equal(CONFIDENCE_BY_TYPE['location-conflict'], 0.6);
});

// ── scan: empty / no-conflict ────────────────────────────────────────────

test('scan returns [] for empty input', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  assert.deepEqual(svc.scan([]), []);
});

test('scan returns [] for single observation', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  assert.deepEqual(svc.scan([obs()]), []);
});

test('scan returns [] when observations agree (same entity, same severity, same status)', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH' }),
    obs({ id: 'b', severity: 'HIGH' }),
  ]);
  assert.deepEqual(results, []);
});

// ── severity-mismatch ────────────────────────────────────────────────────

test('severity-mismatch: HIGH vs LOW on same entity → detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  const sevConflicts = results.filter((c) => c.conflictType === 'severity-mismatch');
  assert.equal(sevConflicts.length, 1);
});

test('severity-mismatch: HIGH vs MEDIUM (delta=1) → NOT detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'MEDIUM', sourceId: 'src-b' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'severity-mismatch').length, 0);
});

test('severity-mismatch: CRITICAL vs LOW (delta=3) → severityDelta=3', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'CRITICAL', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  const sev = results.find((c) => c.conflictType === 'severity-mismatch');
  assert.ok(sev);
  assert.equal(sev!.severityDelta, 3);
});

test('severity-mismatch has confidence 0.9', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  assert.equal(results.find((c) => c.conflictType === 'severity-mismatch')!.confidence, 0.9);
});

// ── status-conflict ──────────────────────────────────────────────────────

test('status-conflict: same entity, one active, one resolved → detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', tags: ['active'], sourceId: 'src-a' }),
    obs({ id: 'b', tags: ['resolved'], sourceId: 'src-b' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'status-conflict').length, 1);
});

test('status-conflict: both active → NOT detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', tags: ['active'], sourceId: 'src-a' }),
    obs({ id: 'b', tags: ['active'], sourceId: 'src-b' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'status-conflict').length, 0);
});

test('status-conflict has confidence 0.85', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', tags: ['active'], severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', tags: ['cleared'], severity: 'HIGH', sourceId: 'src-b' }),
  ]);
  const sc = results.find((c) => c.conflictType === 'status-conflict');
  assert.ok(sc);
  assert.equal(sc!.confidence, 0.85);
});

// ── location-conflict ────────────────────────────────────────────────────

test('location-conflict: same entity, ~600km apart → detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', location: { lat: 35, lon: 140 }, sourceId: 'src-a' }),
    obs({ id: 'b', location: { lat: 41, lon: 140 }, sourceId: 'src-b' }), // ~667km
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'location-conflict').length, 1);
});

test('location-conflict: same entity, ~100km apart → NOT detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', location: { lat: 35, lon: 140 }, sourceId: 'src-a' }),
    obs({ id: 'b', location: { lat: 35.9, lon: 140 }, sourceId: 'src-b' }), // ~100km
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'location-conflict').length, 0);
});

test('location-conflict has confidence 0.6', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', location: { lat: 35, lon: 140 }, sourceId: 'src-a' }),
    obs({ id: 'b', location: { lat: 41, lon: 140 }, sourceId: 'src-b' }),
  ]);
  assert.equal(results.find((c) => c.conflictType === 'location-conflict')!.confidence, 0.6);
});

// ── trend-reversal ───────────────────────────────────────────────────────

test('trend-reversal: HIGH→LOW→HIGH within 2h on same entity → detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', timestamp: NOW, sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', timestamp: NOW + 30 * 60_000, sourceId: 'src-b' }),
    obs({ id: 'c', severity: 'HIGH', timestamp: NOW + 90 * 60_000, sourceId: 'src-c' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'trend-reversal').length, 1);
});

test('trend-reversal: HIGH→LOW→HIGH spread over 3h → NOT detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', timestamp: NOW, sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', timestamp: NOW + 60 * 60_000, sourceId: 'src-b' }),
    obs({ id: 'c', severity: 'HIGH', timestamp: NOW + 3 * 60 * 60_000, sourceId: 'src-c' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'trend-reversal').length, 0);
});

test('trend-reversal has confidence 0.7', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', timestamp: NOW, sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', timestamp: NOW + 30 * 60_000, sourceId: 'src-b' }),
    obs({ id: 'c', severity: 'HIGH', timestamp: NOW + 90 * 60_000, sourceId: 'src-c' }),
  ]);
  const tr = results.find((c) => c.conflictType === 'trend-reversal');
  assert.ok(tr);
  assert.equal(tr!.confidence, 0.7);
});

// ── source-disagreement ──────────────────────────────────────────────────

test('source-disagreement: 3 sources with different severities → detected', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'CRITICAL', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'MEDIUM', sourceId: 'src-b' }),
    obs({ id: 'c', severity: 'LOW', sourceId: 'src-c' }),
  ]);
  assert.ok(results.some((c) => c.conflictType === 'source-disagreement'));
});

test('source-disagreement: 2 sources disagree → NOT detected (need ≥3)', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'CRITICAL', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'MEDIUM', sourceId: 'src-b' }),
  ]);
  assert.equal(results.filter((c) => c.conflictType === 'source-disagreement').length, 0);
});

test('source-disagreement has confidence 0.8', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'CRITICAL', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'MEDIUM', sourceId: 'src-b' }),
    obs({ id: 'c', severity: 'LOW', sourceId: 'src-c' }),
  ]);
  const sd = results.find((c) => c.conflictType === 'source-disagreement');
  assert.ok(sd);
  assert.equal(sd!.confidence, 0.8);
});

// ── grouping semantics ──────────────────────────────────────────────────

test('grouping: observations without shared entityId but same domain + near location → grouped', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', entityIds: [], domain: 'weather', severity: 'HIGH', location: { lat: 35, lon: 140 }, sourceId: 'src-a' }),
    obs({ id: 'b', entityIds: [], domain: 'weather', severity: 'LOW', location: { lat: 35.1, lon: 140.1 }, sourceId: 'src-b' }),
  ]);
  assert.ok(results.length > 0);
});

test('grouping: observations in different domains → NOT grouped', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', entityIds: [], domain: 'weather', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', entityIds: [], domain: 'earthquake', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  assert.equal(results.length, 0);
});

test('grouping: observations sharing entityId across different domains → grouped', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', entityIds: ['ent-x'], domain: 'weather', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', entityIds: ['ent-x'], domain: 'earthquake', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  assert.ok(results.some((c) => c.conflictType === 'severity-mismatch'));
});

// ── getOpen / resolve / dismiss ──────────────────────────────────────────

test('getOpen returns only status="open" contradictions', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  assert.ok(results.length > 0);
  svc.resolve(results[0]!.id);
  const open = svc.getOpen();
  assert.ok(!open.some((c) => c.id === results[0]!.id));
});

test('resolve sets status="resolved" and resolvedAt', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const found = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  svc.resolve(found[0]!.id);
  const all = svc.getAll();
  const target = all.find((c) => c.id === found[0]!.id)!;
  assert.equal(target.status, 'resolved');
  assert.ok(typeof target.resolvedAt === 'number');
});

test('dismiss sets status="dismissed" with reason', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const found = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  svc.dismiss(found[0]!.id, 'known noise');
  const target = svc.getAll().find((c) => c.id === found[0]!.id)!;
  assert.equal(target.status, 'dismissed');
  assert.equal(target.dismissReason, 'known noise');
});

test('resolve unknown id is a no-op (does not throw)', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  svc.resolve('does-not-exist');
  assert.equal(svc.getAll().length, 0);
});

test('dismiss unknown id is a no-op', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  svc.dismiss('does-not-exist', 'reason');
  assert.equal(svc.getAll().length, 0);
});

// ── idempotent scan ──────────────────────────────────────────────────────

test('scanning the same observation pair twice does not create duplicate contradictions', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const a = obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' });
  const b = obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' });
  svc.scan([a, b]);
  svc.scan([a, b]);
  const sev = svc.getAll().filter((c) => c.conflictType === 'severity-mismatch');
  assert.equal(sev.length, 1);
});

// ── stats ────────────────────────────────────────────────────────────────

test('stats.totalDetected counts all contradictions', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  assert.ok(svc.stats().totalDetected >= 1);
});

test('stats.byType counts each conflict type', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  const s = svc.stats();
  assert.ok((s.byType['severity-mismatch'] ?? 0) >= 1);
});

test('stats.openCount reflects unresolved contradictions only', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  const beforeOpen = svc.stats().openCount;
  svc.resolve(results[0]!.id);
  assert.equal(svc.stats().openCount, beforeOpen - 1);
});

test('stats.avgResolutionMinutes computes from detectedAt → resolvedAt', () => {
  let clock = NOW;
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => clock });
  const found = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  clock = NOW + 5 * 60_000;
  svc.resolve(found[0]!.id);
  assert.ok(svc.stats().avgResolutionMinutes >= 4 && svc.stats().avgResolutionMinutes <= 6);
});

// ── persistence + subscribe ──────────────────────────────────────────────

test('persist + rehydrate round-trip preserves contradictions and status', () => {
  const storage = createMemoryStorage();
  const svc1 = createContradictionDetector({ storage, now: () => NOW });
  const found = svc1.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  svc1.dismiss(found[0]!.id, 'noisy feed');
  const svc2 = createContradictionDetector({ storage, now: () => NOW });
  const restored = svc2.getAll().find((c) => c.id === found[0]!.id)!;
  assert.equal(restored.status, 'dismissed');
  assert.equal(restored.dismissReason, 'noisy feed');
});

test('subscribe fires on scan, resolve, dismiss', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const found = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  svc.resolve(found[0]!.id);
  svc.dismiss(found[0]!.id, 'note'); // already resolved → no-op, no notify
  assert.ok(calls >= 2);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  svc.unsubscribe(cb);
  svc.scan([
    obs({ id: 'c', severity: 'HIGH', sourceId: 'src-c' }),
    obs({ id: 'd', severity: 'LOW', sourceId: 'src-d', entityIds: ['ent-2'] }),
  ]);
  assert.equal(calls, 1);
});

// ── ring buffer ──────────────────────────────────────────────────────────

test('ring buffer caps at MAX_CONTRADICTIONS', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  // Create MAX+5 distinct severity-mismatch conflicts on different entities.
  for (let i = 0; i < MAX_CONTRADICTIONS + 5; i++) {
    svc.scan([
      obs({ id: `hi-${i}`, severity: 'HIGH', sourceId: 's-hi', entityIds: [`ent-${i}`] }),
      obs({ id: `lo-${i}`, severity: 'LOW', sourceId: 's-lo', entityIds: [`ent-${i}`] }),
    ]);
  }
  assert.equal(svc.getAll().length, MAX_CONTRADICTIONS);
});

// ── shape integrity ─────────────────────────────────────────────────────

test('getAll returns immutable snapshots — caller mutation does not bleed', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a' }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b' }),
  ]);
  const snap = svc.getAll();
  snap[0]!.status = 'dismissed';
  assert.notEqual(svc.getAll()[0]!.status, 'dismissed');
});

test('every contradiction carries entityId, region, domain, severityDelta, confidence, detectedAt', () => {
  const svc = createContradictionDetector({ storage: createMemoryStorage(), now: () => NOW });
  const results = svc.scan([
    obs({ id: 'a', severity: 'HIGH', sourceId: 'src-a', location: { lat: 35, lon: 140 } }),
    obs({ id: 'b', severity: 'LOW', sourceId: 'src-b', location: { lat: 35, lon: 140 } }),
  ]);
  for (const c of results) {
    assert.ok(typeof c.entityId === 'string');
    assert.ok(typeof c.region === 'string');
    assert.ok(typeof c.domain === 'string');
    assert.ok(typeof c.severityDelta === 'number');
    assert.ok(typeof c.confidence === 'number');
    assert.ok(typeof c.detectedAt === 'number');
  }
});

// Exercise the ConflictType union so the import isn't unused.
test('ConflictType union has 5 spec values', () => {
  const types: ConflictType[] = [
    'severity-mismatch', 'status-conflict', 'location-conflict',
    'trend-reversal', 'source-disagreement',
  ];
  assert.equal(types.length, 5);
  // Just touch ObservationSeverity too to keep the import live.
  const s: ObservationSeverity = 'HIGH';
  assert.equal(s, 'HIGH');
});
