/**
 * Tests for SituationPriorityQueueService.
 *
 * Run with: npx tsx --test tests/intelligence/situation-priority-queue.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEIGHTS,
  MAX_ENTRIES,
  RECENCY_WINDOW_MS,
  STORAGE_KEY,
  SituationPriorityQueueService,
  __internals,
  __resetSituationPriorityQueueSingleton,
  getSituationPriorityQueueService,
  type PriorityQueueStorage,
  type PriorityUpsert,
} from '../../src/services/intelligence/situation-priority-queue.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: PriorityQueueStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: PriorityQueueStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function freshService(now = NOW): SituationPriorityQueueService {
  const { storage } = makeStorage();
  return new SituationPriorityQueueService(storage, () => now);
}

function entry(overrides: Partial<PriorityUpsert> = {}): PriorityUpsert {
  return {
    situationId: 'sit-1',
    domain: 'geopolitical',
    severity: 'high',
    confidence: 0.8,
    detectedAt: NOW,
    ...overrides,
  };
}

// ── upsert() ──────────────────────────────────────────────────────────

test('upsert returns an entry with computed urgencyScore and rank=1 for a single insert', () => {
  const svc = freshService();
  const result = svc.upsert(entry());
  assert.ok(result.urgencyScore > 0);
  assert.ok(result.urgencyScore <= 1);
  assert.equal(result.rank, 1);
});

test('upsert preserves situationId / domain / severity / detectedAt', () => {
  const svc = freshService();
  const result = svc.upsert(entry({ situationId: 'sit-7', domain: 'cyber', severity: 'critical', detectedAt: NOW - 1000 }));
  assert.equal(result.situationId, 'sit-7');
  assert.equal(result.domain, 'cyber');
  assert.equal(result.severity, 'critical');
  assert.equal(result.detectedAt, NOW - 1000);
});

test('upsert clamps confidence into [0,1]', () => {
  const svc = freshService();
  const hi = svc.upsert(entry({ situationId: 'sit-hi', confidence: 5 }));
  const lo = svc.upsert(entry({ situationId: 'sit-lo', confidence: -2 }));
  assert.equal(hi.confidence, 1);
  assert.equal(lo.confidence, 0);
});

test('upsert with same situationId replaces the existing entry (no duplicate)', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'sit-1', severity: 'low' }));
  svc.upsert(entry({ situationId: 'sit-1', severity: 'critical' }));
  const queue = svc.getQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].severity, 'critical');
});

test('upsert re-ranks the queue after each insert', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'low-sev', severity: 'low' }));
  svc.upsert(entry({ situationId: 'crit-sev', severity: 'critical' }));
  const queue = svc.getQueue();
  assert.equal(queue[0].situationId, 'crit-sev');
  assert.equal(queue[0].rank, 1);
  assert.equal(queue[1].situationId, 'low-sev');
  assert.equal(queue[1].rank, 2);
});

// ── urgency score math per axis ──────────────────────────────────────

test('urgencyScore: severity contribution — critical > high > low > unknown', () => {
  const svc = freshService();
  const crit = svc.upsert(entry({ situationId: 'a', severity: 'critical' })).urgencyScore;
  const high = svc.upsert(entry({ situationId: 'b', severity: 'high' })).urgencyScore;
  const low = svc.upsert(entry({ situationId: 'c', severity: 'low' })).urgencyScore;
  const unk = svc.upsert(entry({ situationId: 'd', severity: 'unknown' })).urgencyScore;
  assert.ok(crit > high);
  assert.ok(high > low);
  assert.ok(low > unk);
});

test('urgencyScore: confidence contribution — higher confidence yields higher score', () => {
  const svc = freshService();
  const lo = svc.upsert(entry({ situationId: 'a', confidence: 0.1 })).urgencyScore;
  const hi = svc.upsert(entry({ situationId: 'b', confidence: 0.95 })).urgencyScore;
  assert.ok(hi > lo);
});

test('urgencyScore: domain weight — geopolitical (1.0) > weather (0.7) > others (0.6)', () => {
  const svc = freshService();
  const geo = svc.upsert(entry({ situationId: 'a', domain: 'geopolitical' })).urgencyScore;
  const wx = svc.upsert(entry({ situationId: 'b', domain: 'weather' })).urgencyScore;
  const other = svc.upsert(entry({ situationId: 'c', domain: 'fictional-domain' })).urgencyScore;
  assert.ok(geo > wx);
  assert.ok(wx > other);
});

test('urgencyScore: recency decays linearly to zero across the 24h window', () => {
  const svc = freshService(NOW);
  const fresh = svc.upsert(entry({ situationId: 'a', detectedAt: NOW })).urgencyScore;
  const halfDay = svc.upsert(entry({ situationId: 'b', detectedAt: NOW - RECENCY_WINDOW_MS / 2 })).urgencyScore;
  const oneDay = svc.upsert(entry({ situationId: 'c', detectedAt: NOW - RECENCY_WINDOW_MS })).urgencyScore;
  const ancient = svc.upsert(entry({ situationId: 'd', detectedAt: NOW - RECENCY_WINDOW_MS * 10 })).urgencyScore;
  assert.ok(fresh > halfDay);
  assert.ok(halfDay > oneDay);
  // oneDay and ancient both saturate to recency=0 — domain/severity/confidence dominate.
  assert.ok(Math.abs(oneDay - ancient) < 1e-9);
});

test('urgencyScore is a weighted sum — manual check against DEFAULT_WEIGHTS', () => {
  const svc = freshService(NOW);
  const result = svc.upsert(entry({
    situationId: 'a',
    domain: 'geopolitical',
    severity: 'critical',
    confidence: 1.0,
    detectedAt: NOW,
  }));
  // All four contributions at 1.0 — score should equal sum of weights == 1.
  assert.ok(Math.abs(result.urgencyScore - 1) < 1e-9);
});

test('urgencyScore stays in [0,1] even with adversarial inputs', () => {
  const svc = freshService(NOW);
  const r = svc.upsert(entry({ situationId: 'a', confidence: Number.NaN, detectedAt: Number.NaN }));
  assert.ok(r.urgencyScore >= 0 && r.urgencyScore <= 1);
});

// ── remove() ─────────────────────────────────────────────────────────

test('remove returns true and drops the entry; ranks of remaining entries are recomputed', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'crit', severity: 'critical' }));
  svc.upsert(entry({ situationId: 'low', severity: 'low' }));
  assert.equal(svc.remove('crit'), true);
  const queue = svc.getQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].situationId, 'low');
  assert.equal(queue[0].rank, 1);
});

test('remove returns false on unknown situationId', () => {
  const svc = freshService();
  assert.equal(svc.remove('does-not-exist'), false);
});

// ── getQueue / getTop ────────────────────────────────────────────────

test('getQueue returns entries sorted by urgencyScore descending', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'a', severity: 'low' }));
  svc.upsert(entry({ situationId: 'b', severity: 'critical' }));
  svc.upsert(entry({ situationId: 'c', severity: 'medium' }));
  const queue = svc.getQueue();
  assert.deepEqual(queue.map((e) => e.situationId), ['b', 'c', 'a']);
});

test('getQueue limit clamps the result', () => {
  const svc = freshService();
  for (let i = 0; i < 5; i++) {
    svc.upsert(entry({ situationId: `s-${i}`, severity: 'high' }));
  }
  assert.equal(svc.getQueue(2).length, 2);
});

test('getTop(n) returns the top-n by urgency', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'a', severity: 'critical' }));
  svc.upsert(entry({ situationId: 'b', severity: 'low' }));
  svc.upsert(entry({ situationId: 'c', severity: 'high' }));
  const top2 = svc.getTop(2);
  assert.equal(top2.length, 2);
  assert.deepEqual(top2.map((e) => e.situationId), ['a', 'c']);
});

test('getTop(0) and getTop(-1) return empty arrays', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'a', severity: 'high' }));
  assert.equal(svc.getTop(0).length, 0);
  assert.equal(svc.getTop(-1).length, 0);
});

test('getQueue returns defensive copies — mutating result does not affect store', () => {
  const svc = freshService();
  svc.upsert(entry({ situationId: 'a', severity: 'high' }));
  const queue = svc.getQueue();
  queue[0].urgencyScore = -999;
  const again = svc.getQueue();
  assert.notEqual(again[0].urgencyScore, -999);
});

// ── setWeights() ─────────────────────────────────────────────────────

test('setWeights merges partial input over current weights', () => {
  const svc = freshService();
  svc.setWeights({ severity: 0.5 });
  const w = svc.getWeights();
  assert.ok(Math.abs(w.severity + w.recency + w.confidence + w.domainWeight - 1) < 1e-9);
});

test('setWeights normalizes so the four axes always sum to 1', () => {
  const svc = freshService();
  svc.setWeights({ severity: 2, recency: 2, confidence: 2, domainWeight: 2 });
  const w = svc.getWeights();
  assert.ok(Math.abs(w.severity - 0.25) < 1e-9);
  assert.ok(Math.abs(w.recency - 0.25) < 1e-9);
});

test('setWeights all-zero falls back to defaults', () => {
  const svc = freshService();
  svc.setWeights({ severity: 0, recency: 0, confidence: 0, domainWeight: 0 });
  const w = svc.getWeights();
  assert.deepEqual(w, DEFAULT_WEIGHTS);
});

test('setWeights recomputes urgencyScore for every existing entry', () => {
  const svc = freshService(NOW);
  svc.upsert(entry({ situationId: 'a', severity: 'critical', confidence: 0.2, detectedAt: NOW }));
  const before = svc.getQueue()[0].urgencyScore;
  // Shift all weight onto confidence — low confidence should now dominate.
  svc.setWeights({ severity: 0, recency: 0, confidence: 1, domainWeight: 0 });
  const after = svc.getQueue()[0].urgencyScore;
  assert.notEqual(before, after);
  assert.ok(after <= 0.2 + 1e-9);
});

test('setWeights triggers a re-rank when the relative ordering flips', () => {
  const svc = freshService(NOW);
  // a: lots of severity, no confidence
  svc.upsert(entry({ situationId: 'a', severity: 'critical', confidence: 0.05 }));
  // b: tons of confidence, low severity
  svc.upsert(entry({ situationId: 'b', severity: 'low', confidence: 1 }));
  assert.equal(svc.getQueue()[0].situationId, 'a');
  // Push all weight onto confidence — b should now lead.
  svc.setWeights({ severity: 0, recency: 0, confidence: 1, domainWeight: 0 });
  assert.equal(svc.getQueue()[0].situationId, 'b');
});

// ── getSnapshot() ────────────────────────────────────────────────────

test('getSnapshot returns entries + weights + computedAt', () => {
  const svc = freshService(NOW);
  svc.upsert(entry({ situationId: 'a', severity: 'high' }));
  const snap = svc.getSnapshot();
  assert.equal(snap.entries.length, 1);
  assert.equal(snap.computedAt, NOW);
  assert.deepEqual(snap.weights, DEFAULT_WEIGHTS);
});

// ── subscribe() ──────────────────────────────────────────────────────

test('subscribe fires on upsert, remove, and setWeights', () => {
  const svc = freshService();
  let fires = 0;
  svc.subscribe(() => { fires += 1; });
  svc.upsert(entry({ situationId: 'a' }));
  svc.setWeights({ severity: 0.5 });
  svc.remove('a');
  assert.equal(fires, 3);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService();
  let fires = 0;
  const off = svc.subscribe(() => { fires += 1; });
  svc.upsert(entry({ situationId: 'a' }));
  off();
  svc.upsert(entry({ situationId: 'b' }));
  assert.equal(fires, 1);
});

test('subscribe listener exception is isolated — other listeners still fire', () => {
  const svc = freshService();
  let goodFires = 0;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { goodFires += 1; });
  svc.upsert(entry({ situationId: 'a' }));
  assert.equal(goodFires, 1);
});

// ── Ring buffer + persistence ────────────────────────────────────────

test('ring buffer evicts lowest-urgency entries when over MAX_ENTRIES', () => {
  const svc = freshService(NOW);
  // Insert MAX_ENTRIES low-severity entries.
  for (let i = 0; i < MAX_ENTRIES; i++) {
    svc.upsert(entry({ situationId: `low-${i}`, severity: 'low' }));
  }
  // One critical insert pushes the overflow eviction.
  svc.upsert(entry({ situationId: 'crit', severity: 'critical' }));
  assert.equal(svc.getQueue().length, MAX_ENTRIES);
  // The critical entry must still be present.
  assert.ok(svc.getQueue().some((e) => e.situationId === 'crit'));
});

test('entries survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new SituationPriorityQueueService(storage, () => NOW);
  a.upsert(entry({ situationId: 'a', severity: 'high' }));
  const b = new SituationPriorityQueueService(storage, () => NOW);
  assert.equal(b.getQueue().length, 1);
  assert.equal(b.getQueue()[0].situationId, 'a');
});

test('weights survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new SituationPriorityQueueService(storage, () => NOW);
  a.setWeights({ severity: 1, recency: 0, confidence: 0, domainWeight: 0 });
  const b = new SituationPriorityQueueService(storage, () => NOW);
  const w = b.getWeights();
  assert.ok(Math.abs(w.severity - 1) < 1e-9);
});

test('corrupt persisted blob does not crash hydrate', () => {
  const { storage } = makeStorage();
  storage.setItem(STORAGE_KEY, 'not-json');
  const svc = new SituationPriorityQueueService(storage, () => NOW);
  assert.equal(svc.getQueue().length, 0);
});

test('persistence key is wm-situation-priority-queue', () => {
  const { storage, map } = makeStorage();
  const svc = new SituationPriorityQueueService(storage, () => NOW);
  svc.upsert(entry({ situationId: 'a' }));
  assert.ok(map.has(STORAGE_KEY));
  assert.equal(STORAGE_KEY, 'wm-situation-priority-queue');
});

// ── Singleton ────────────────────────────────────────────────────────

test('getSituationPriorityQueueService returns a stable singleton', () => {
  __resetSituationPriorityQueueSingleton();
  const a = getSituationPriorityQueueService();
  const b = getSituationPriorityQueueService();
  assert.equal(a, b);
  __resetSituationPriorityQueueSingleton();
});

// ── Internals ────────────────────────────────────────────────────────

test('internals.severityScore handles known and unknown severities', () => {
  assert.equal(__internals.severityScore('critical'), 1.0);
  assert.equal(__internals.severityScore('high'), 0.75);
  assert.equal(__internals.severityScore('medium'), 0.5);
  assert.equal(__internals.severityScore('low'), 0.25);
  assert.equal(__internals.severityScore('unknown'), 0.1);
  assert.equal(__internals.severityScore('made-up'), 0.1);
});

test('internals.domainScore returns DEFAULT_DOMAIN_SCORE for unknown domains', () => {
  assert.equal(__internals.domainScore('geopolitical'), 1.0);
  assert.equal(__internals.domainScore('weather'), 0.7);
  assert.equal(__internals.domainScore('made-up'), 0.6);
});

test('internals.recencyScore returns 1 at detection time and 0 beyond the window', () => {
  assert.equal(__internals.recencyScore(NOW, NOW), 1);
  assert.equal(__internals.recencyScore(NOW - RECENCY_WINDOW_MS, NOW), 0);
  assert.equal(__internals.recencyScore(NOW - RECENCY_WINDOW_MS * 3, NOW), 0);
});

test('internals.clamp01 handles NaN, negatives, and overflows', () => {
  assert.equal(__internals.clamp01(Number.NaN), 0);
  assert.equal(__internals.clamp01(-1), 0);
  assert.equal(__internals.clamp01(2), 1);
  assert.equal(__internals.clamp01(0.42), 0.42);
});

test('internals.normalizeWeights preserves a sum-to-1 set within float tolerance', () => {
  const w = __internals.normalizeWeights(DEFAULT_WEIGHTS);
  assert.ok(Math.abs(w.severity - DEFAULT_WEIGHTS.severity) < 1e-9);
  assert.ok(Math.abs(w.recency - DEFAULT_WEIGHTS.recency) < 1e-9);
  assert.ok(Math.abs(w.confidence - DEFAULT_WEIGHTS.confidence) < 1e-9);
  assert.ok(Math.abs(w.domainWeight - DEFAULT_WEIGHTS.domainWeight) < 1e-9);
});
