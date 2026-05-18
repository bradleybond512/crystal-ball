/**
 * Tests for FeedWatchdogService — feed staleness, error-rate, and
 * transition alerts.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now. Time progression is
 * driven by an advanceable clock so age-ratio thresholds are
 * deterministic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALERTS_STORAGE_KEY,
  FeedWatchdogService,
  HEALTH_STORAGE_KEY,
  MAX_ALERTS,
  __internals,
  __resetFeedWatchdogServiceSingleton,
  getFeedWatchdogService,
  type StorageLike,
  type WatchdogAlert,
} from '../../src/services/intelligence/feed-watchdog.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

interface AdvanceableClock {
  (): number;
  advance: (ms: number) => void;
  set: (t: number) => void;
}

function makeAdvanceableClock(start = NOW): AdvanceableClock {
  let t = start;
  const clock = (() => t) as AdvanceableClock;
  clock.advance = (ms) => { t += ms; };
  clock.set = (next) => { t = next; };
  return clock;
}

const NOW = 1_745_000_000_000;
const INTERVAL = 60_000; // 1 minute baseline interval for test feeds

// ── registerFeed ─────────────────────────────────────────────────────

test('registerFeed creates a healthy entry with the given interval', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  const health = svc.registerFeed('test-feed', 'test-domain', INTERVAL);
  assert.equal(health.feedId, 'test-feed');
  assert.equal(health.domain, 'test-domain');
  assert.equal(health.expectedIntervalMs, INTERVAL);
  assert.equal(health.status, 'healthy');
  assert.equal(health.errorCount, 0);
  assert.equal(health.successCount, 0);
});

test('registerFeed twice updates metadata but preserves counters', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('test-feed', 'd', INTERVAL);
  svc.recordSuccess('test-feed');
  const re = svc.registerFeed('test-feed', 'd2', INTERVAL * 2);
  assert.equal(re.domain, 'd2');
  assert.equal(re.expectedIntervalMs, INTERVAL * 2);
  assert.equal(re.successCount, 1);
});

test('built-in seed catalog populates 12 feeds at init', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  const all = svc.getHealth();
  assert.equal(all.length, __internals.SEED_FEEDS.length);
  assert.equal(all.length, 12);
  assert.ok(all.some((f) => f.feedId === 'earthquake-usgs'));
  assert.ok(all.some((f) => f.feedId === 'sanctions-ofac'));
});

// ── recordSuccess ────────────────────────────────────────────────────

test('recordSuccess updates lastSeenAt and resets consecutiveFailures', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  svc.recordFailure('feed-1');
  svc.recordFailure('feed-1');
  clock.advance(2 * INTERVAL);
  const after = svc.recordSuccess('feed-1')!;
  assert.equal(after.consecutiveFailures, 0);
  assert.equal(after.lastSeenAt, clock());
  assert.equal(after.successCount, 1);
});

test('recordSuccess after stale emits a "recovered" alert', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  // Age out to stale → status transition fires went-stale.
  clock.advance(3 * INTERVAL);
  svc.tick();
  assert.equal(svc.getHealth('feed-1')!.status, 'stale');
  // Now recover: any success brings status back to healthy.
  svc.recordSuccess('feed-1');
  const recovered = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'recovered');
  assert.ok(recovered, 'recovered alert should fire on transition out of stale');
});

test('recordSuccess on an unregistered feed returns undefined', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  assert.equal(svc.recordSuccess('nope'), undefined);
});

// ── recordFailure ────────────────────────────────────────────────────

test('recordFailure increments errorCount + consecutiveFailures', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  svc.recordFailure('feed-1');
  svc.recordFailure('feed-1');
  const h = svc.getHealth('feed-1')!;
  assert.equal(h.errorCount, 2);
  assert.equal(h.consecutiveFailures, 2);
});

test('recordFailure 5+ consecutive flips status to offline + went-offline alert', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('feed-1');
  assert.equal(svc.getHealth('feed-1')!.status, 'offline');
  const offline = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'went-offline');
  assert.ok(offline);
});

test('recordFailure crossing 0.3 error rate fires error-spike alert', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  // 7 successes then 3 failures → error rate 0.3.
  for (let i = 0; i < 7; i += 1) svc.recordSuccess('feed-1');
  for (let i = 0; i < 3; i += 1) svc.recordFailure('feed-1');
  const spike = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'error-spike');
  assert.ok(spike, 'error-spike alert should fire when crossing 0.3 upward');
});

test('error-spike does not fire when rate stays below 0.3', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  for (let i = 0; i < 8; i += 1) svc.recordSuccess('feed-1');
  for (let i = 0; i < 1; i += 1) svc.recordFailure('feed-1'); // 1/9 ≈ 0.11
  const spike = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'error-spike');
  assert.equal(spike, undefined);
});

test('error rate >= 0.1 alone pushes status to degraded', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  for (let i = 0; i < 8; i += 1) svc.recordSuccess('feed-1');
  svc.recordFailure('feed-1'); // 1/9 ≈ 0.111
  assert.equal(svc.getHealth('feed-1')!.status, 'degraded');
});

// ── tick / age-based transitions ─────────────────────────────────────

test('tick promotes a feed to degraded after ageRatio > 1', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  clock.advance(INTERVAL + 1_000); // > 1× interval
  svc.tick();
  assert.equal(svc.getHealth('feed-1')!.status, 'degraded');
});

test('tick promotes a feed to stale after ageRatio in (2, 6] and emits went-stale', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  clock.advance(3 * INTERVAL); // 3× interval
  svc.tick();
  assert.equal(svc.getHealth('feed-1')!.status, 'stale');
  assert.equal(svc.getHealth('feed-1')!.staleSinceAt, clock());
  const went = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'went-stale');
  assert.ok(went);
});

test('tick promotes a feed to offline after ageRatio > 6 and emits went-offline', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  clock.advance(7 * INTERVAL);
  svc.tick();
  assert.equal(svc.getHealth('feed-1')!.status, 'offline');
  const went = svc.getAlerts({ feedId: 'feed-1' })
    .find((a) => a.alertType === 'went-offline');
  assert.ok(went);
});

test('tick is a no-op when no feed transitions', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  svc.tick();
  svc.tick();
  assert.equal(svc.getAlerts({ feedId: 'feed-1' }).length, 0);
});

test('recordSuccess after offline emits recovered and clears staleSinceAt', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  clock.advance(7 * INTERVAL);
  svc.tick();
  assert.equal(svc.getHealth('feed-1')!.status, 'offline');
  const recovered = svc.recordSuccess('feed-1')!;
  assert.equal(recovered.status, 'healthy');
  assert.equal(recovered.staleSinceAt, undefined);
  assert.ok(svc.getAlerts({ feedId: 'feed-1' })
    .some((a) => a.alertType === 'recovered'));
});

// ── classifyFeed unit checks ─────────────────────────────────────────

test('classifyFeed returns offline when consecutiveFailures hits the floor', () => {
  const status = __internals.classifyFeed({
    feedId: 'x', domain: 'd', lastSeenAt: NOW, expectedIntervalMs: INTERVAL,
    errorCount: 0, successCount: 0, status: 'healthy',
    consecutiveFailures: __internals.OFFLINE_CONSECUTIVE_FAILURES,
  }, NOW);
  assert.equal(status, 'offline');
});

test('classifyFeed returns healthy with no errors and no age', () => {
  const status = __internals.classifyFeed({
    feedId: 'x', domain: 'd', lastSeenAt: NOW, expectedIntervalMs: INTERVAL,
    errorCount: 0, successCount: 10, status: 'healthy',
    consecutiveFailures: 0,
  }, NOW);
  assert.equal(status, 'healthy');
});

test('classifyFeed scales status through degraded → stale → offline as age grows', () => {
  const baseline = {
    feedId: 'x', domain: 'd', lastSeenAt: NOW, expectedIntervalMs: INTERVAL,
    errorCount: 0, successCount: 0, status: 'healthy' as const,
    consecutiveFailures: 0,
  };
  assert.equal(__internals.classifyFeed(baseline, NOW + INTERVAL * 0.5), 'healthy');
  assert.equal(__internals.classifyFeed(baseline, NOW + INTERVAL * 1.5), 'degraded');
  assert.equal(__internals.classifyFeed(baseline, NOW + INTERVAL * 3), 'stale');
  assert.equal(__internals.classifyFeed(baseline, NOW + INTERVAL * 8), 'offline');
});

// ── Acknowledge ──────────────────────────────────────────────────────

test('acknowledge flips an alert and is idempotent', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('feed-1', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('feed-1');
  const alert = svc.getAlerts({ feedId: 'feed-1' })[0]!;
  const acked = svc.acknowledge(alert.id)!;
  assert.equal(acked.acknowledged, true);
  const again = svc.acknowledge(alert.id);
  assert.equal(again?.acknowledged, true);
});

test('acknowledge returns undefined for unknown id', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  assert.equal(svc.acknowledge('fwd-nope'), undefined);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getHealth() sorts feeds with worst status first', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('healthy-feed', 'd', INTERVAL);
  svc.registerFeed('offline-feed', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('offline-feed');
  const all = svc.getHealth();
  assert.equal(all[0]!.feedId, 'offline-feed', 'offline should rank ahead of healthy');
});

test('getAlerts filters by feedId and acknowledged', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  svc.registerFeed('b', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  for (let i = 0; i < 5; i += 1) svc.recordFailure('b');
  assert.equal(svc.getAlerts({ feedId: 'a' }).every((al) => al.feedId === 'a'), true);
  const allA = svc.getAlerts({ feedId: 'a' });
  svc.acknowledge(allA[0]!.id);
  assert.equal(svc.getAlerts({ feedId: 'a', acknowledged: true }).length, 1);
});

test('getAlerts returns newest-first with optional limit', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a'); // triggers went-offline
  const all = svc.getAlerts({});
  assert.ok(all.length >= 1);
  assert.equal(svc.getAlerts({}, 1).length, 1);
});

test('getAlerts returns defensive copies', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  const all = svc.getAlerts({});
  all[0]!.acknowledged = true;
  const fresh = svc.getAlerts({});
  assert.equal(fresh[0]!.acknowledged, false);
});

// ── Summary ──────────────────────────────────────────────────────────

test('getSummary tallies feeds by status and counts unacked alerts', () => {
  const clock = makeAdvanceableClock();
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock });
  svc.registerFeed('a', 'd', INTERVAL);
  svc.registerFeed('b', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  const s = svc.getSummary();
  assert.equal(s.offline >= 1, true);
  assert.equal(s.unacknowledgedAlerts >= 1, true);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('alerts ring buffer evicts oldest past MAX_ALERTS', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  // Each cycle: 5 failures (offline) + 1 success (recovered) = 2 alerts.
  for (let i = 0; i < MAX_ALERTS; i += 1) {
    for (let j = 0; j < 5; j += 1) svc.recordFailure('a');
    svc.recordSuccess('a');
  }
  assert.equal(svc.getAlerts({}).length, MAX_ALERTS);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on every emitted alert', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  const seen: WatchdogAlert[] = [];
  const off = svc.subscribe((al) => seen.push(al));
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  off();
  svc.recordSuccess('a');
  assert.ok(seen.some((al) => al.alertType === 'went-offline'));
  assert.equal(seen.some((al) => al.alertType === 'recovered'), false);
});

test('listener that throws does not stop other listeners', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  assert.ok(good >= 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new FeedWatchdogService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('health survives a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new FeedWatchdogService({ storage, clock: () => NOW });
  svc1.registerFeed('custom', 'd', INTERVAL);
  svc1.recordSuccess('custom');
  const svc2 = new FeedWatchdogService({ storage, clock: () => NOW });
  const h = svc2.getHealth('custom');
  assert.equal(h?.successCount, 1);
});

test('alerts survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new FeedWatchdogService({ storage, clock: () => NOW });
  svc1.registerFeed('a', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc1.recordFailure('a');
  const svc2 = new FeedWatchdogService({ storage, clock: () => NOW });
  assert.ok(svc2.getAlerts({ feedId: 'a' }).length >= 1);
});

test('corrupt health blob is ignored', () => {
  const storage = makeFakeStorage({ [HEALTH_STORAGE_KEY]: 'not-json' });
  const svc = new FeedWatchdogService({ storage, clock: () => NOW });
  // Should still seed the 12 default feeds despite corrupt blob.
  assert.equal(svc.getHealth().length, 12);
});

test('corrupt alerts blob is ignored', () => {
  const storage = makeFakeStorage({ [ALERTS_STORAGE_KEY]: 'not-json' });
  const svc = new FeedWatchdogService({ storage, clock: () => NOW });
  assert.equal(svc.getAlerts({}).length, 0);
});

test('null storage works (no-op persistence)', () => {
  const svc = new FeedWatchdogService({ storage: null, clock: () => NOW });
  svc.registerFeed('a', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('a');
  assert.equal(svc.getHealth('a')?.status, 'offline');
});

test('resetForTesting clears state + persisted blobs and re-seeds feeds', () => {
  const storage = makeFakeStorage();
  const svc = new FeedWatchdogService({ storage, clock: () => NOW });
  svc.registerFeed('custom-feed', 'd', INTERVAL);
  for (let i = 0; i < 5; i += 1) svc.recordFailure('custom-feed');
  svc.resetForTesting();
  assert.equal(svc.getAlerts({}).length, 0);
  assert.equal(svc.getHealth('custom-feed'), undefined, 'custom feed should be gone after reset');
  // Seeded feeds still present.
  assert.ok(svc.getHealth('earthquake-usgs'));
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getFeedWatchdogService returns a stable singleton', () => {
  __resetFeedWatchdogServiceSingleton();
  const a = getFeedWatchdogService();
  const b = getFeedWatchdogService();
  assert.equal(a, b);
  __resetFeedWatchdogServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getFeedWatchdogService();
  __resetFeedWatchdogServiceSingleton();
  const b = getFeedWatchdogService();
  assert.notEqual(a, b);
  __resetFeedWatchdogServiceSingleton();
});
