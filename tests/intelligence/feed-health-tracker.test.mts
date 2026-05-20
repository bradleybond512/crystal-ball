import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FeedHealthTracker, STORAGE_KEY, MAX_FEEDS, ERROR_LOG_CAP, STALE_WARN_MS, STALE_CRIT_MS,
  type FeedRecord, type StorageLike,
} from '../../src/services/intelligence/feed-health-tracker.ts';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

const BASE_NOW = new Date('2026-05-20T12:00:00Z').getTime();

function makeTracker(nowMs = BASE_NOW, storage?: StorageLike) {
  FeedHealthTracker._resetSingletonForTests();
  return new FeedHealthTracker({
    storage: storage ?? createMemoryStorage(),
    now: () => nowMs,
  });
}

// ── Constants ──────────────────────────────────────────────────────────────

test('STORAGE_KEY equals wm-feed-health', () => {
  assert.equal(STORAGE_KEY, 'wm-feed-health');
});

test('MAX_FEEDS equals 200', () => {
  assert.equal(MAX_FEEDS, 200);
});

test('ERROR_LOG_CAP equals 100', () => {
  assert.equal(ERROR_LOG_CAP, 100);
});

test('STALE_WARN_MS equals 15 minutes', () => {
  assert.equal(STALE_WARN_MS, 15 * 60 * 1000);
});

test('STALE_CRIT_MS equals 60 minutes', () => {
  assert.equal(STALE_CRIT_MS, 60 * 60 * 1000);
});

// ── Singleton ──────────────────────────────────────────────────────────────

test('getInstance returns the same instance twice', () => {
  FeedHealthTracker._resetSingletonForTests();
  const a = FeedHealthTracker.getInstance();
  const b = FeedHealthTracker.getInstance();
  assert.equal(a, b);
  FeedHealthTracker._resetSingletonForTests();
});

test('_resetSingletonForTests breaks singleton equality', () => {
  FeedHealthTracker._resetSingletonForTests();
  const a = FeedHealthTracker.getInstance();
  FeedHealthTracker._resetSingletonForTests();
  const b = FeedHealthTracker.getInstance();
  assert.notEqual(a, b);
  FeedHealthTracker._resetSingletonForTests();
});

// ── recordSuccess ──────────────────────────────────────────────────────────

test('recordSuccess creates record with correct feedId, domain, latencyMs, status=ok', () => {
  const t = makeTracker();
  t.recordSuccess('feed-1', 'weather', 42);
  const rec = t.getRecord('feed-1');
  assert.ok(rec);
  assert.equal(rec.feedId, 'feed-1');
  assert.equal(rec.domain, 'weather');
  assert.equal(rec.latencyMs, 42);
  assert.equal(rec.status, 'ok');
});

test('recordSuccess sets lastSeenAt to current clock time', () => {
  const t = makeTracker(BASE_NOW);
  t.recordSuccess('feed-1', 'weather', 10);
  const rec = t.getRecord('feed-1')!;
  assert.equal(rec.lastSeenAt, BASE_NOW);
});

test('recordSuccess resets errorCount to 0 after prior error', () => {
  const t = makeTracker();
  t.recordError('feed-1', 'weather', 'oops');
  assert.equal(t.getRecord('feed-1')!.errorCount, 1);
  t.recordSuccess('feed-1', 'weather', 5);
  assert.equal(t.getRecord('feed-1')!.errorCount, 0);
});

test('recordSuccess called twice updates latencyMs and lastSeenAt to latest values', () => {
  let now = BASE_NOW;
  FeedHealthTracker._resetSingletonForTests();
  const t = new FeedHealthTracker({ storage: createMemoryStorage(), now: () => now });
  t.recordSuccess('feed-1', 'weather', 10);
  now = BASE_NOW + 5000;
  t.recordSuccess('feed-1', 'weather', 99);
  const rec = t.getRecord('feed-1')!;
  assert.equal(rec.latencyMs, 99);
  assert.equal(rec.lastSeenAt, BASE_NOW + 5000);
});

// ── recordError ────────────────────────────────────────────────────────────

test('recordError creates new record with status=error and errorCount=1', () => {
  const t = makeTracker();
  t.recordError('feed-x', 'finance', 'timeout');
  const rec = t.getRecord('feed-x')!;
  assert.equal(rec.status, 'error');
  assert.equal(rec.errorCount, 1);
});

test('recordError does not update lastSeenAt on an existing record', () => {
  const t = makeTracker(BASE_NOW);
  t.recordSuccess('feed-x', 'finance', 5);
  assert.equal(t.getRecord('feed-x')!.lastSeenAt, BASE_NOW);
  t.recordError('feed-x', 'finance', 'failed');
  assert.equal(t.getRecord('feed-x')!.lastSeenAt, BASE_NOW);
});

test('recordError increments errorCount on repeated errors', () => {
  const t = makeTracker();
  t.recordError('feed-x', 'finance', 'err1');
  t.recordError('feed-x', 'finance', 'err2');
  assert.equal(t.getRecord('feed-x')!.errorCount, 2);
});

test('recordError appends to error log with correct fields', () => {
  const t = makeTracker(BASE_NOW);
  t.recordError('feed-x', 'finance', 'something broke');
  const log = t.getErrorLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].feedId, 'feed-x');
  assert.equal(log[0].domain, 'finance');
  assert.equal(log[0].message, 'something broke');
  assert.equal(log[0].timestamp, BASE_NOW);
});

// ── markOffline ────────────────────────────────────────────────────────────

test('markOffline sets status=offline without changing lastSeenAt or errorCount', () => {
  const t = makeTracker(BASE_NOW);
  t.recordSuccess('feed-o', 'geo', 10);
  const before = t.getRecord('feed-o')!;
  t.markOffline('feed-o', 'geo');
  const after = t.getRecord('feed-o')!;
  assert.equal(after.status, 'offline');
  assert.equal(after.lastSeenAt, before.lastSeenAt);
  assert.equal(after.errorCount, before.errorCount);
});

// ── getAll ─────────────────────────────────────────────────────────────────

test('getAll returns empty array when no records', () => {
  const t = makeTracker();
  assert.deepEqual(t.getAll(), []);
});

test('getAll returns all records sorted by feedId ascending', () => {
  const t = makeTracker();
  t.recordSuccess('feed-c', 'x', 1);
  t.recordSuccess('feed-a', 'x', 1);
  t.recordSuccess('feed-b', 'x', 1);
  const ids = t.getAll().map(r => r.feedId);
  assert.deepEqual(ids, ['feed-a', 'feed-b', 'feed-c']);
});

test('getAll returns a copy — mutating result does not affect internal state', () => {
  const t = makeTracker();
  t.recordSuccess('feed-1', 'x', 1);
  const all = t.getAll();
  all.splice(0);
  assert.equal(t.getAll().length, 1);
});

// ── getRecord ──────────────────────────────────────────────────────────────

test('getRecord returns undefined for unknown feedId', () => {
  const t = makeTracker();
  assert.equal(t.getRecord('nope'), undefined);
});

test('getRecord returns correct record for known feedId', () => {
  const t = makeTracker();
  t.recordSuccess('feed-k', 'traffic', 7);
  const rec = t.getRecord('feed-k');
  assert.ok(rec);
  assert.equal(rec.feedId, 'feed-k');
  assert.equal(rec.domain, 'traffic');
});

// ── getStaleFeedIds ────────────────────────────────────────────────────────

test('getStaleFeedIds returns empty when no records', () => {
  const t = makeTracker();
  assert.deepEqual(t.getStaleFeedIds(STALE_WARN_MS), []);
});

test('getStaleFeedIds returns feedId when (now - lastSeenAt) > thresholdMs', () => {
  const t = makeTracker(BASE_NOW);
  t.recordSuccess('old-feed', 'weather', 1);
  const futureNow = BASE_NOW + STALE_WARN_MS + 1;
  const stale = t.getStaleFeedIds(STALE_WARN_MS, futureNow);
  assert.ok(stale.includes('old-feed'));
});

test('getStaleFeedIds does not return feedId when lastSeenAt is recent', () => {
  const t = makeTracker(BASE_NOW);
  t.recordSuccess('fresh-feed', 'weather', 1);
  const stale = t.getStaleFeedIds(STALE_WARN_MS, BASE_NOW + 1000);
  assert.equal(stale.length, 0);
});

test('getStaleFeedIds does not return feedIds with status error or offline', () => {
  const t = makeTracker(BASE_NOW);
  t.recordError('err-feed', 'x', 'bad');
  t.markOffline('off-feed', 'x');
  const futureNow = BASE_NOW + STALE_CRIT_MS + 1;
  const stale = t.getStaleFeedIds(STALE_WARN_MS, futureNow);
  assert.ok(!stale.includes('err-feed'));
  assert.ok(!stale.includes('off-feed'));
});

// ── getHealthScore ─────────────────────────────────────────────────────────

test('getHealthScore returns 100 when no records', () => {
  const t = makeTracker();
  assert.equal(t.getHealthScore(), 100);
});

test('getHealthScore returns 100 when all feeds are ok', () => {
  const t = makeTracker();
  t.recordSuccess('f1', 'x', 1);
  t.recordSuccess('f2', 'x', 1);
  assert.equal(t.getHealthScore(), 100);
});

test('getHealthScore returns 0 when all feeds are error', () => {
  const t = makeTracker();
  t.recordError('f1', 'x', 'e');
  t.recordError('f2', 'x', 'e');
  assert.equal(t.getHealthScore(), 0);
});

test('getHealthScore returns 50 when half ok half error (2 ok, 2 error)', () => {
  const t = makeTracker();
  t.recordSuccess('f1', 'x', 1);
  t.recordSuccess('f2', 'x', 1);
  t.recordError('f3', 'x', 'e');
  t.recordError('f4', 'x', 'e');
  assert.equal(t.getHealthScore(), 50);
});

// ── getErrorLog ────────────────────────────────────────────────────────────

test('getErrorLog returns empty array when no errors', () => {
  const t = makeTracker();
  assert.deepEqual(t.getErrorLog(), []);
});

test('getErrorLog returns most-recent entry first', () => {
  let now = BASE_NOW;
  FeedHealthTracker._resetSingletonForTests();
  const t = new FeedHealthTracker({ storage: createMemoryStorage(), now: () => now });
  t.recordError('f1', 'x', 'first');
  now += 1000;
  t.recordError('f2', 'x', 'second');
  const log = t.getErrorLog();
  assert.equal(log[0].message, 'second');
  assert.equal(log[1].message, 'first');
});

test('getErrorLog caps at ERROR_LOG_CAP entries', () => {
  const t = makeTracker();
  for (let i = 0; i < ERROR_LOG_CAP + 10; i++) {
    t.recordError(`feed-${i}`, 'x', `err-${i}`);
  }
  assert.equal(t.getErrorLog().length, ERROR_LOG_CAP);
});

// ── MAX_FEEDS cap ──────────────────────────────────────────────────────────

test('after MAX_FEEDS+1 recordSuccess calls, getAll().length === MAX_FEEDS', () => {
  let now = BASE_NOW;
  FeedHealthTracker._resetSingletonForTests();
  const t = new FeedHealthTracker({ storage: createMemoryStorage(), now: () => now });
  for (let i = 0; i < MAX_FEEDS + 1; i++) {
    now += i; // unique timestamps so oldest is deterministic
    t.recordSuccess(`feed-${i}`, 'x', 1);
  }
  assert.equal(t.getAll().length, MAX_FEEDS);
});

test('the oldest feed (by lastSeenAt) is the one dropped when cap is exceeded', () => {
  let now = BASE_NOW;
  FeedHealthTracker._resetSingletonForTests();
  const t = new FeedHealthTracker({ storage: createMemoryStorage(), now: () => now });
  // feed-0 is inserted first at BASE_NOW — will be the oldest
  t.recordSuccess('feed-0', 'x', 1);
  for (let i = 1; i <= MAX_FEEDS; i++) {
    now = BASE_NOW + i * 1000; // each newer
    t.recordSuccess(`feed-${i}`, 'x', 1);
  }
  const ids = t.getAll().map(r => r.feedId);
  assert.ok(!ids.includes('feed-0'), 'oldest feed should have been dropped');
});

// ── Persistence ────────────────────────────────────────────────────────────

test('recordSuccess persists to storage — re-hydrate with new tracker, data survives', () => {
  const storage = createMemoryStorage();
  const t1 = makeTracker(BASE_NOW, storage);
  t1.recordSuccess('persist-feed', 'weather', 55);
  FeedHealthTracker._resetSingletonForTests();
  const t2 = new FeedHealthTracker({ storage, now: () => BASE_NOW });
  const rec = t2.getRecord('persist-feed');
  assert.ok(rec);
  assert.equal(rec.feedId, 'persist-feed');
  assert.equal(rec.latencyMs, 55);
});

test('recordError persists to storage', () => {
  const storage = createMemoryStorage();
  const t1 = makeTracker(BASE_NOW, storage);
  t1.recordError('err-persist', 'finance', 'timeout');
  FeedHealthTracker._resetSingletonForTests();
  const t2 = new FeedHealthTracker({ storage, now: () => BASE_NOW });
  const log = t2.getErrorLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].feedId, 'err-persist');
  assert.equal(log[0].message, 'timeout');
});

test('reset() clears records and persists empty state', () => {
  const storage = createMemoryStorage();
  const t1 = makeTracker(BASE_NOW, storage);
  t1.recordSuccess('feed-z', 'x', 1);
  t1.reset();
  FeedHealthTracker._resetSingletonForTests();
  const t2 = new FeedHealthTracker({ storage, now: () => BASE_NOW });
  assert.deepEqual(t2.getAll(), []);
  assert.deepEqual(t2.getErrorLog(), []);
});

// ── reset ──────────────────────────────────────────────────────────────────

test('getAll() returns [] after reset()', () => {
  const t = makeTracker();
  t.recordSuccess('feed-r', 'x', 1);
  t.reset();
  assert.deepEqual(t.getAll(), []);
});

test('getErrorLog() returns [] after reset()', () => {
  const t = makeTracker();
  t.recordError('feed-r', 'x', 'boom');
  t.reset();
  assert.deepEqual(t.getErrorLog(), []);
});
