import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createActiveLearningQueue,
  STORAGE_KEY,
  MAX_ITEMS,
  EXPIRY_MS,
  type UncertaintySource,
  type LearningItem,
} from '../../src/services/intelligence/active-learning-queue.ts';

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

const NOW = new Date('2026-05-16T12:00:00Z');
const NOW_MS = NOW.getTime();

interface OutcomeRecordCall {
  alertId?: string;
  situationId?: string;
  domain: string;
  predictedSeverity: 'low' | 'medium' | 'high' | 'critical';
  actualOutcome: string;
  notes?: string;
}

function makeLedgerStub(): { calls: OutcomeRecordCall[]; record: (c: OutcomeRecordCall) => void } {
  const calls: OutcomeRecordCall[] = [];
  return { calls, record: (c) => { calls.push(c); } };
}

function baseItem(overrides: Partial<Omit<LearningItem, 'id' | 'status' | 'queuedAt' | 'expiresAt'>> = {}) {
  return {
    observationId: 'ev-1',
    domain: 'earthquake',
    uncertaintySources: ['low-meta-confidence'] as UncertaintySource[],
    uncertaintyScore: 0.5,
    currentSeverity: 'medium' as const,
    question: 'Is this real?',
    context: 'Context line.',
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-active-learning"', () => {
  assert.equal(STORAGE_KEY, 'wm-active-learning');
});

test('MAX_ITEMS is 500', () => {
  assert.equal(MAX_ITEMS, 500);
});

test('EXPIRY_MS is 24 hours', () => {
  assert.equal(EXPIRY_MS, 24 * 60 * 60_000);
});

// ── enqueue ──────────────────────────────────────────────────────────────

test('enqueue assigns id, status=pending, queuedAt=now', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  assert.ok(item.id);
  assert.equal(item.status, 'pending');
  assert.equal(item.queuedAt.getTime(), NOW_MS);
});

test('enqueue sets expiresAt to now + 24h', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  assert.equal(item.expiresAt.getTime(), NOW_MS + EXPIRY_MS);
});

test('enqueue assigns unique ids across calls', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) ids.add(svc.enqueue(baseItem()).id);
  assert.equal(ids.size, 5);
});

// ── enqueueFromObservation ───────────────────────────────────────────────

test('enqueueFromObservation generates a domain-specific question (earthquake)', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueueFromObservation({
    observationId: 'eq-1',
    domain: 'earthquake',
    severity: 'high',
    title: 'M6.2 near Tokyo',
    metadata: { magnitude: 6.2 },
  }, ['low-meta-confidence']);
  assert.match(item.question, /M6\.2|magnitude|earthquake severity/i);
});

test('enqueueFromObservation uses generic template for unknown domains', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueueFromObservation({
    observationId: 'x-1', domain: 'unknown-domain', severity: 'medium', title: 'something',
  }, ['high-assumption-risk']);
  assert.match(item.question, /unknown-domain|correctly classified/i);
});

test('enqueueFromObservation: cyber template mentions CVE/exploitation', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueueFromObservation({
    observationId: 'cve-1', domain: 'cyber', severity: 'critical', title: 'CVE-2026-9999',
  }, ['novel-pattern']);
  assert.match(item.question, /exploited|wild|theoretical/i);
});

// ── uncertaintyScore formula ─────────────────────────────────────────────

test('uncertaintyScore: 2 sources scores higher than 1 source', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const one = svc.enqueueFromObservation({
    observationId: 'a', domain: 'earthquake', severity: 'high', title: 't',
  }, ['low-meta-confidence']);
  const two = svc.enqueueFromObservation({
    observationId: 'b', domain: 'earthquake', severity: 'high', title: 't',
  }, ['low-meta-confidence', 'novel-pattern']);
  assert.ok(two.uncertaintyScore > one.uncertaintyScore);
});

test('uncertaintyScore: competing-hypotheses adds bonus over plain source', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const plain = svc.enqueueFromObservation({
    observationId: 'a', domain: 'earthquake', severity: 'high', title: 't',
  }, ['low-meta-confidence']);
  const competing = svc.enqueueFromObservation({
    observationId: 'b', domain: 'earthquake', severity: 'high', title: 't',
  }, ['competing-hypotheses']);
  assert.ok(competing.uncertaintyScore > plain.uncertaintyScore);
});

test('uncertaintyScore: fragile-conclusion adds bonus over plain source', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const plain = svc.enqueueFromObservation({
    observationId: 'a', domain: 'earthquake', severity: 'high', title: 't',
  }, ['novel-pattern']);
  const fragile = svc.enqueueFromObservation({
    observationId: 'b', domain: 'earthquake', severity: 'high', title: 't',
  }, ['fragile-conclusion']);
  assert.ok(fragile.uncertaintyScore > plain.uncertaintyScore);
});

test('uncertaintyScore: clamped to [0, 1]', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const all = svc.enqueueFromObservation({
    observationId: 'all', domain: 'earthquake', severity: 'high', title: 't',
  }, ['low-meta-confidence', 'competing-hypotheses', 'fragile-conclusion',
    'high-assumption-risk', 'novel-pattern', 'contradicting-evidence']);
  assert.ok(all.uncertaintyScore <= 1);
  assert.ok(all.uncertaintyScore >= 0);
});

// ── getPending ───────────────────────────────────────────────────────────

test('getPending returns items sorted by uncertaintyScore descending', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.enqueue(baseItem({ observationId: 'low', uncertaintyScore: 0.2 }));
  svc.enqueue(baseItem({ observationId: 'high', uncertaintyScore: 0.9 }));
  svc.enqueue(baseItem({ observationId: 'mid', uncertaintyScore: 0.5 }));
  const ordered = svc.getPending();
  assert.deepEqual(ordered.map((i) => i.observationId), ['high', 'mid', 'low']);
});

test('getPending excludes reviewed items', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  svc.review(item.id, 'confirmed');
  assert.equal(svc.getPending().length, 0);
});

test('getPending excludes skipped items', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  svc.skip(item.id);
  assert.equal(svc.getPending().length, 0);
});

test('getPending excludes expired items', () => {
  let clock = NOW_MS;
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => clock });
  svc.enqueue(baseItem());
  clock = NOW_MS + EXPIRY_MS + 1;
  assert.equal(svc.getPending().length, 0);
});

// ── review ───────────────────────────────────────────────────────────────

test('review sets status=reviewed, reviewedAt, reviewerOutcome, reviewerNote', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  svc.review(item.id, 'confirmed', 'looks right');
  const reviewed = svc.getAll().find((i) => i.id === item.id);
  assert.equal(reviewed!.status, 'reviewed');
  assert.ok(reviewed!.reviewedAt instanceof Date);
  assert.equal(reviewed!.reviewerOutcome, 'confirmed');
  assert.equal(reviewed!.reviewerNote, 'looks right');
});

test('review(confirmed) records confirmed-real outcome to ledger', () => {
  const ledger = makeLedgerStub();
  const svc = createActiveLearningQueue({
    storage: createMemoryStorage(), now: () => NOW_MS,
    recordOutcome: ledger.record,
  });
  const item = svc.enqueue(baseItem({ domain: 'earthquake', currentSeverity: 'high' }));
  svc.review(item.id, 'confirmed');
  assert.equal(ledger.calls.length, 1);
  assert.equal(ledger.calls[0]!.actualOutcome, 'confirmed-real');
  assert.equal(ledger.calls[0]!.domain, 'earthquake');
  assert.equal(ledger.calls[0]!.predictedSeverity, 'high');
});

test('review(corrected) records marked-false-positive outcome to ledger', () => {
  const ledger = makeLedgerStub();
  const svc = createActiveLearningQueue({
    storage: createMemoryStorage(), now: () => NOW_MS,
    recordOutcome: ledger.record,
  });
  const item = svc.enqueue(baseItem());
  svc.review(item.id, 'corrected', 'too high');
  assert.equal(ledger.calls[0]!.actualOutcome, 'marked-false-positive');
  assert.equal(ledger.calls[0]!.notes, 'too high');
});

test('review(insufficient-data) does NOT record to ledger', () => {
  const ledger = makeLedgerStub();
  const svc = createActiveLearningQueue({
    storage: createMemoryStorage(), now: () => NOW_MS,
    recordOutcome: ledger.record,
  });
  const item = svc.enqueue(baseItem());
  svc.review(item.id, 'insufficient-data');
  assert.equal(ledger.calls.length, 0);
});

test('review with unknown id is a no-op (does not throw)', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.review('does-not-exist', 'confirmed');
  assert.equal(svc.getAll().length, 0);
});

test('review on already-reviewed item is a no-op', () => {
  const ledger = makeLedgerStub();
  const svc = createActiveLearningQueue({
    storage: createMemoryStorage(), now: () => NOW_MS, recordOutcome: ledger.record,
  });
  const item = svc.enqueue(baseItem());
  svc.review(item.id, 'confirmed');
  svc.review(item.id, 'corrected');
  assert.equal(ledger.calls.length, 1);
});

// ── skip / purgeExpired ──────────────────────────────────────────────────

test('skip sets status=skipped', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const item = svc.enqueue(baseItem());
  svc.skip(item.id);
  assert.equal(svc.getAll().find((i) => i.id === item.id)!.status, 'skipped');
});

test('purgeExpired removes expired pending items', () => {
  let clock = NOW_MS;
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => clock });
  svc.enqueue(baseItem());
  clock = NOW_MS + EXPIRY_MS + 1;
  svc.purgeExpired();
  assert.equal(svc.getAll().length, 0);
});

test('purgeExpired keeps reviewed and skipped items even if past expiry', () => {
  let clock = NOW_MS;
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => clock });
  const reviewed = svc.enqueue(baseItem({ observationId: 'r' }));
  const skipped = svc.enqueue(baseItem({ observationId: 's' }));
  svc.review(reviewed.id, 'confirmed');
  svc.skip(skipped.id);
  clock = NOW_MS + EXPIRY_MS + 1;
  svc.purgeExpired();
  assert.equal(svc.getAll().length, 2);
});

// ── stats ────────────────────────────────────────────────────────────────

test('stats counts total, pending, reviewed, skipped', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.enqueue(baseItem({ observationId: 'a' }));
  const b = svc.enqueue(baseItem({ observationId: 'b' }));
  const c = svc.enqueue(baseItem({ observationId: 'c' }));
  svc.review(b.id, 'confirmed');
  svc.skip(c.id);
  const s = svc.stats();
  assert.equal(s.total, 3);
  assert.equal(s.pending, 1);
  assert.equal(s.reviewed, 1);
  assert.equal(s.skipped, 1);
});

test('stats.avgUncertaintyScore averages across all items', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.enqueue(baseItem({ uncertaintyScore: 0.2 }));
  svc.enqueue(baseItem({ uncertaintyScore: 0.8 }));
  assert.ok(Math.abs(svc.stats().avgUncertaintyScore - 0.5) < 0.0001);
});

test('stats.bySource counts each uncertainty source across items', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.enqueue(baseItem({ uncertaintySources: ['low-meta-confidence'] }));
  svc.enqueue(baseItem({ uncertaintySources: ['low-meta-confidence', 'novel-pattern'] }));
  const s = svc.stats();
  assert.equal(s.bySource['low-meta-confidence'], 2);
  assert.equal(s.bySource['novel-pattern'], 1);
});

// ── Ring buffer + persistence + subscribe ────────────────────────────────

test('ring buffer caps at MAX_ITEMS, drops oldest', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  const oldest = svc.enqueue(baseItem({ observationId: 'oldest' }));
  for (let i = 0; i < MAX_ITEMS; i++) {
    svc.enqueue(baseItem({ observationId: `n-${i}` }));
  }
  assert.equal(svc.getAll().length, MAX_ITEMS);
  assert.ok(!svc.getAll().some((i) => i.id === oldest.id));
});

test('subscribe fires on enqueue, review, skip, purgeExpired', () => {
  let clock = NOW_MS;
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => clock });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const a = svc.enqueue(baseItem({ observationId: 'a' }));
  svc.enqueue(baseItem({ observationId: 'b' }));
  svc.enqueue(baseItem({ observationId: 'c' }));
  svc.review(a.id, 'confirmed');
  svc.skip(svc.getAll().find((i) => i.observationId === 'b')!.id);
  clock = NOW_MS + EXPIRY_MS + 1;
  svc.purgeExpired();
  assert.equal(calls, 6);
});

test('subscribe returns unsubscribe function', () => {
  const svc = createActiveLearningQueue({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.enqueue(baseItem());
  off();
  svc.enqueue(baseItem());
  assert.equal(calls, 1);
});

test('persist + rehydrate round-trip preserves items + status + dates', () => {
  const storage = createMemoryStorage();
  const svc1 = createActiveLearningQueue({ storage, now: () => NOW_MS });
  const item = svc1.enqueue(baseItem({ observationId: 'rehyd' }));
  svc1.review(item.id, 'confirmed', 'note');
  const svc2 = createActiveLearningQueue({ storage, now: () => NOW_MS });
  const restored = svc2.getAll().find((i) => i.observationId === 'rehyd');
  assert.ok(restored);
  assert.equal(restored!.status, 'reviewed');
  assert.equal(restored!.reviewerNote, 'note');
  assert.ok(restored!.queuedAt instanceof Date);
  assert.ok(restored!.expiresAt instanceof Date);
});
