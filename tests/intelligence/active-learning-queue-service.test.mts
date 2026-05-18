import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ActiveLearningQueueService,
  resetServiceForTests,
  type ActiveLearningItem,
  type LearningItemPriority,
  type LearningItemReason,
} from '../../src/services/intelligence/active-learning-queue.ts';

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

interface EnqueueOverrides {
  observationId?: string;
  domain?: string;
  reason?: LearningItemReason;
  priority?: LearningItemPriority;
  expiresAt?: number;
  modelOutput?: unknown;
}

function makeEnqueue(o: EnqueueOverrides = {}): Parameters<ActiveLearningQueueService['enqueue']>[0] {
  return {
    observationId: o.observationId ?? 'obs-' + Math.random().toString(36).slice(2, 8),
    domain: o.domain ?? 'earthquake',
    reason: o.reason ?? 'low-confidence',
    priority: o.priority ?? 'medium',
    expiresAt: o.expiresAt ?? NOW + 7 * DAY,
    modelOutput: o.modelOutput,
  };
}

// ── enqueue ─────────────────────────────────────────────────────────

describe('ActiveLearningQueueService.enqueue', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('creates a pending item with id + queuedAt', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'obs-1' }));
    assert.ok(item);
    assert.ok(item.id.length > 0);
    assert.equal(item.status, 'pending');
    assert.equal(item.queuedAt, NOW);
    assert.equal(item.observationId, 'obs-1');
  });

  it('idempotent on observationId when status is pending', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const first = s.enqueue(makeEnqueue({ observationId: 'obs-1' }));
    const second = s.enqueue(makeEnqueue({ observationId: 'obs-1' }));
    assert.equal(second?.id, first?.id);
    assert.equal(s.getQueue().length, 1);
  });

  it('idempotent on observationId when status is claimed', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const first = s.enqueue(makeEnqueue({ observationId: 'obs-1' }))!;
    s.claim(first.id);
    const second = s.enqueue(makeEnqueue({ observationId: 'obs-1' }));
    assert.equal(second?.id, first.id);
    assert.equal(s.getQueue().length, 1);
  });

  it('re-enqueues after resolved: new item with fresh id', () => {
    let t = NOW;
    const s = new ActiveLearningQueueService({ now: () => t });
    const first = s.enqueue(makeEnqueue({ observationId: 'obs-1' }))!;
    s.claim(first.id);
    s.resolve(first.id, 'true-positive');
    t = NOW + HOUR;
    const second = s.enqueue(makeEnqueue({ observationId: 'obs-1' }))!;
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, 'pending');
  });

  it('item carries priority + reason + domain through to storage', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({
      observationId: 'obs-x', priority: 'critical', reason: 'prediction-miss', domain: 'cyber',
    }));
    assert.equal(item?.priority, 'critical');
    assert.equal(item?.reason, 'prediction-miss');
    assert.equal(item?.domain, 'cyber');
  });

  it('expiresAt is preserved on enqueue', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + 3 * DAY }))!;
    assert.equal(item.expiresAt, NOW + 3 * DAY);
  });

  it('optional modelOutput stored on the item', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a', modelOutput: { confidence: 0.42 } }))!;
    assert.deepEqual(item.modelOutput, { confidence: 0.42 });
  });
});

// ── state transitions ──────────────────────────────────────────────

describe('ActiveLearningQueueService — state transitions', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('claim moves pending → claimed with claimedAt', () => {
    let t = NOW;
    const s = new ActiveLearningQueueService({ now: () => t });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    t = NOW + 60_000;
    s.claim(item.id);
    const after = s.getItem(item.id)!;
    assert.equal(after.status, 'claimed');
    assert.equal(after.claimedAt, NOW + 60_000);
  });

  it('claim on resolved item is a no-op', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.claim(item.id);
    s.resolve(item.id, 'label');
    s.claim(item.id);
    assert.equal(s.getItem(item.id)?.status, 'resolved');
  });

  it('claim on skipped item is a no-op', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.skip(item.id);
    s.claim(item.id);
    assert.equal(s.getItem(item.id)?.status, 'skipped');
  });

  it('claim on unknown id is a silent no-op', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.claim('not-real');
    assert.equal(s.getQueue().length, 0);
  });

  it('resolve from pending allowed (operator labels without claim)', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.resolve(item.id, 'true-positive', 'verified by analyst');
    const after = s.getItem(item.id)!;
    assert.equal(after.status, 'resolved');
    assert.equal(after.operatorLabel, 'true-positive');
    assert.equal(after.notes, 'verified by analyst');
    assert.equal(after.resolvedAt, NOW);
  });

  it('resolve stores label + resolvedAt + notes', () => {
    let t = NOW;
    const s = new ActiveLearningQueueService({ now: () => t });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.claim(item.id);
    t = NOW + HOUR;
    s.resolve(item.id, 'false-positive', 'duplicate of obs-7');
    const after = s.getItem(item.id)!;
    assert.equal(after.operatorLabel, 'false-positive');
    assert.equal(after.notes, 'duplicate of obs-7');
    assert.equal(after.resolvedAt, NOW + HOUR);
  });

  it('resolve on already-resolved item is a no-op (label not overwritten)', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.resolve(item.id, 'first-label');
    s.resolve(item.id, 'second-label');
    assert.equal(s.getItem(item.id)?.operatorLabel, 'first-label');
  });

  it('skip moves item to terminal skipped state', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.skip(item.id);
    assert.equal(s.getItem(item.id)?.status, 'skipped');
  });

  it('skip on resolved item is a no-op', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.resolve(item.id, 'label');
    s.skip(item.id);
    assert.equal(s.getItem(item.id)?.status, 'resolved');
  });
});

// ── expire ─────────────────────────────────────────────────────────

describe('ActiveLearningQueueService.expire', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('moves only pending items whose expiresAt < cutoff', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const a = s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + HOUR }))!;
    const b = s.enqueue(makeEnqueue({ observationId: 'b', expiresAt: NOW + 10 * DAY }))!;
    const count = s.expire(NOW + 2 * HOUR);
    assert.equal(count, 1);
    assert.equal(s.getItem(a.id)?.status, 'expired');
    assert.equal(s.getItem(b.id)?.status, 'pending');
  });

  it('does NOT expire claimed items even if past expiry', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    const item = s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + HOUR }))!;
    s.claim(item.id);
    const count = s.expire(NOW + 2 * HOUR);
    assert.equal(count, 0);
    assert.equal(s.getItem(item.id)?.status, 'claimed');
  });

  it('does not double-expire already-expired items', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + HOUR }));
    s.expire(NOW + 2 * HOUR);
    const second = s.expire(NOW + 3 * HOUR);
    assert.equal(second, 0);
  });
});

// ── getQueue ───────────────────────────────────────────────────────

describe('ActiveLearningQueueService.getQueue', () => {
  beforeEach(() => { resetServiceForTests(); });

  function setup(): ActiveLearningQueueService {
    let t = NOW;
    const s = new ActiveLearningQueueService({ now: () => t });
    s.enqueue(makeEnqueue({ observationId: 'med-1', priority: 'medium', domain: 'cyber' }));
    t = NOW + 1000;
    s.enqueue(makeEnqueue({ observationId: 'crit-1', priority: 'critical', domain: 'earthquake' }));
    t = NOW + 2000;
    s.enqueue(makeEnqueue({ observationId: 'crit-2', priority: 'critical', domain: 'cyber' }));
    t = NOW + 3000;
    s.enqueue(makeEnqueue({ observationId: 'low-1', priority: 'low', domain: 'sanctions' }));
    return s;
  }

  it('sorts by priority desc, then by queuedAt asc within same priority', () => {
    const s = setup();
    const ids = s.getQueue().map((i) => i.observationId);
    assert.deepEqual(ids, ['crit-1', 'crit-2', 'med-1', 'low-1']);
  });

  it('filters by status', () => {
    const s = setup();
    const items = s.getQueue();
    s.claim(items[0]!.id);
    const claimed = s.getQueue({ status: 'claimed' });
    assert.equal(claimed.length, 1);
  });

  it('filters by domain', () => {
    const s = setup();
    assert.equal(s.getQueue({ domain: 'cyber' }).length, 2);
    assert.equal(s.getQueue({ domain: 'sanctions' }).length, 1);
    assert.equal(s.getQueue({ domain: 'aviation' }).length, 0);
  });

  it('filters by priority', () => {
    const s = setup();
    assert.equal(s.getQueue({ priority: 'critical' }).length, 2);
    assert.equal(s.getQueue({ priority: 'low' }).length, 1);
  });

  it('combines multiple filters', () => {
    const s = setup();
    assert.equal(s.getQueue({ priority: 'critical', domain: 'cyber' }).length, 1);
  });
});

// ── getStats ───────────────────────────────────────────────────────

describe('ActiveLearningQueueService.getStats', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('counts by status', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.enqueue(makeEnqueue({ observationId: 'a' }));
    const b = s.enqueue(makeEnqueue({ observationId: 'b' }))!;
    s.claim(b.id);
    const c = s.enqueue(makeEnqueue({ observationId: 'c' }))!;
    s.resolve(c.id, 'label');
    s.skip(s.enqueue(makeEnqueue({ observationId: 'd' }))!.id);
    const stats = s.getStats();
    assert.equal(stats.total, 4);
    assert.equal(stats.pending, 1);
    assert.equal(stats.claimed, 1);
    assert.equal(stats.resolved, 1);
    assert.equal(stats.skipped, 1);
  });

  it('avgResolutionMinutes is mean wall-clock from queuedAt to resolvedAt', () => {
    let t = NOW;
    const s = new ActiveLearningQueueService({ now: () => t });
    const a = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    t = NOW + 10 * 60_000;
    s.resolve(a.id, 'l');
    t = NOW + 100;
    const b = s.enqueue(makeEnqueue({ observationId: 'b' }))!;
    t = NOW + 30 * 60_000;
    s.resolve(b.id, 'l');
    const stats = s.getStats();
    // a took 10min; b took ~30min. Average ≈ 20.
    assert.ok(Math.abs(stats.avgResolutionMinutes - 20) < 0.05, `got ${stats.avgResolutionMinutes}`);
  });

  it('avgResolutionMinutes is 0 when no resolved items', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.enqueue(makeEnqueue({ observationId: 'a' }));
    assert.equal(s.getStats().avgResolutionMinutes, 0);
  });

  it('expired count surfaces in stats', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + HOUR }));
    s.expire(NOW + 2 * HOUR);
    assert.equal(s.getStats().expired, 1);
  });
});

// ── subscribe ───────────────────────────────────────────────────────

describe('ActiveLearningQueueService — subscribe', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('subscribe fires on enqueue / claim / resolve / skip', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    let calls = 0;
    let last: ActiveLearningItem | null = null;
    s.subscribe((item) => { calls++; last = item; });
    const a = s.enqueue(makeEnqueue({ observationId: 'a' }))!;
    s.claim(a.id);
    s.resolve(a.id, 'label');
    assert.equal(calls, 3);
    assert.equal(last?.status, 'resolved');
  });

  it('subscribe fires once per expired item', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    s.enqueue(makeEnqueue({ observationId: 'a', expiresAt: NOW + HOUR }));
    s.enqueue(makeEnqueue({ observationId: 'b', expiresAt: NOW + HOUR }));
    let calls = 0;
    s.subscribe(() => { calls++; });
    s.expire(NOW + 2 * HOUR);
    assert.equal(calls, 2);
  });

  it('unsubscribe stops further callbacks', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    let calls = 0;
    const cb = () => { calls++; };
    s.subscribe(cb);
    s.enqueue(makeEnqueue({ observationId: 'a' }));
    s.unsubscribe(cb);
    s.enqueue(makeEnqueue({ observationId: 'b' }));
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW });
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.enqueue(makeEnqueue({ observationId: 'a' }));
    off();
    s.enqueue(makeEnqueue({ observationId: 'b' }));
    assert.equal(calls, 1);
  });
});

// ── Persistence + capacity ──────────────────────────────────────────

describe('ActiveLearningQueueService — persistence', () => {
  beforeEach(() => { resetServiceForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new ActiveLearningQueueService({ now: () => NOW, storage });
    a.enqueue(makeEnqueue({ observationId: 'persisted' }));
    const b = new ActiveLearningQueueService({ now: () => NOW, storage });
    assert.equal(b.getQueue().length, 1);
    assert.equal(b.getQueue()[0]?.observationId, 'persisted');
  });

  it('ring buffer caps items at supplied capacity', () => {
    const s = new ActiveLearningQueueService({ now: () => NOW, capacity: 3 });
    for (let i = 0; i < 5; i++) {
      s.enqueue(makeEnqueue({ observationId: `obs-${i}` }));
    }
    assert.ok(s.getQueue().length <= 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const s = new ActiveLearningQueueService({ now: () => NOW, storage });
    assert.equal(s.getQueue().length, 0);
  });
});
