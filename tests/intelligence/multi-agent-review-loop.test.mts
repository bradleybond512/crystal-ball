import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MultiAgentReviewLoop,
  STORAGE_KEY,
  type ReviewRequest,
  type StorageLike,
} from '../../src/services/intelligence/multi-agent-review-loop.ts';

const T0 = 1_745_000_000_000;

function makeStorage(): StorageLike & { dump(): Map<string, string>; raw(key: string): string | null } {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    dump: () => store,
    raw: (k: string) => store.get(k) ?? null,
  };
}

function makeLoop(opts: { now?: () => number; storage?: StorageLike | null; capacity?: number } = {}): MultiAgentReviewLoop {
  let counter = 0;
  const clock = opts.now ?? (() => T0);
  return new MultiAgentReviewLoop({
    capacity: opts.capacity,
    storage: opts.storage === undefined ? null : opts.storage,
    now: clock,
    idGen: () => { counter += 1; return `rvw-${counter}`; },
  });
}

// ── submitForReview ──────────────────────────────────────────────────────

describe('MultiAgentReviewLoop.submitForReview', () => {
  it('returns a ReviewRequest with the expected shape', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('sit-1', 'situation', 2, 'minor anomaly');
    assert.equal(typeof req.id, 'string');
    assert.equal(req.targetId, 'sit-1');
    assert.equal(req.targetType, 'situation');
    assert.equal(req.severity, 2);
    assert.equal(req.reason, 'minor anomaly');
    assert.equal(req.createdAt, T0);
  });

  it('auto-approves severity < 3 (severity 1)', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 1, 'low signal');
    assert.equal(req.status, 'approved');
    assert.equal(req.reviewedAt, T0);
  });

  it('auto-approves severity = 2.9 (boundary)', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 2.9, 'mild');
    assert.equal(req.status, 'approved');
  });

  it('queues as pending when severity is exactly 3', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 3, 'moderate');
    assert.equal(req.status, 'pending');
    assert.equal(req.reviewedAt, undefined);
  });

  it('queues as pending for severity 3.5 with non-sensitive reason', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'brief', 3.5, 'supply chain wobble');
    assert.equal(req.status, 'pending');
  });

  it('queues as pending for severity 4 without sensitive domain in reason', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 4, 'severe storm cluster');
    assert.equal(req.status, 'pending');
  });

  it('escalates when severity >= 4 AND reason mentions geopolitical', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 4, 'Geopolitical fallout from sanctions');
    assert.equal(req.status, 'escalated');
  });

  it('escalates when reason mentions health (case-insensitive)', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'brief', 5, 'HEALTH crisis emerging');
    assert.equal(req.status, 'escalated');
  });

  it('escalates when reason mentions nuclear', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'situation', 4.2, 'possible nuclear incident');
    assert.equal(req.status, 'escalated');
  });

  it('does NOT escalate when severity < 4 even with sensitive domain', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 3.5, 'nuclear test detected');
    assert.equal(req.status, 'pending');
  });

  it('handles non-finite severity by treating it as 0 (auto-approved)', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', Number.NaN, 'broken sensor');
    assert.equal(req.status, 'approved');
  });

  it('mints unique ids per request', () => {
    const loop = makeLoop();
    const a = loop.submitForReview('a', 'alert', 1, 'r');
    const b = loop.submitForReview('a', 'alert', 1, 'r');
    assert.notEqual(a.id, b.id);
  });
});

// ── review ───────────────────────────────────────────────────────────────

describe('MultiAgentReviewLoop.review', () => {
  it('approves a pending request and stamps reviewedAt', () => {
    let t = T0;
    const loop = makeLoop({ now: () => t });
    const req = loop.submitForReview('a', 'alert', 3, 'moderate');
    t = T0 + 60_000;
    const updated = loop.review(req.id, true, 'looks fine');
    assert.equal(updated.status, 'approved');
    assert.equal(updated.reviewedAt, T0 + 60_000);
    assert.equal(updated.reviewNote, 'looks fine');
  });

  it('rejects a pending request', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 3, 'moderate');
    const updated = loop.review(req.id, false);
    assert.equal(updated.status, 'rejected');
  });

  it('throws on unknown id', () => {
    const loop = makeLoop();
    assert.throws(() => loop.review('does-not-exist', true), /unknown id/);
  });

  it('is a no-op on already-approved requests', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 1, 'low'); // auto-approved
    const result = loop.review(req.id, false);
    assert.equal(result.status, 'approved');
  });

  it('can resolve an escalated request to approved', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 5, 'nuclear');
    assert.equal(req.status, 'escalated');
    const updated = loop.review(req.id, true, 'cleared after on-the-ground confirmation');
    assert.equal(updated.status, 'approved');
    assert.equal(updated.reviewNote, 'cleared after on-the-ground confirmation');
  });

  it('preserves createdAt when transitioning', () => {
    let t = T0;
    const loop = makeLoop({ now: () => t });
    const req = loop.submitForReview('a', 'alert', 3, 'r');
    t = T0 + 5_000;
    const updated = loop.review(req.id, true);
    assert.equal(updated.createdAt, T0);
  });
});

// ── getPending / getAll ──────────────────────────────────────────────────

describe('MultiAgentReviewLoop.getPending', () => {
  it('returns empty initially', () => {
    const loop = makeLoop();
    assert.deepEqual(loop.getPending(), []);
  });

  it('includes only pending — excludes auto-approved, escalated, rejected', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 1, 'low');         // approved
    const p = loop.submitForReview('b', 'alert', 3, 'mid'); // pending
    loop.submitForReview('c', 'alert', 5, 'nuclear');     // escalated
    const rej = loop.submitForReview('d', 'alert', 3, 'mid');
    loop.review(rej.id, false);
    const pending = loop.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.id, p.id);
  });

  it('returns pending in insertion order', () => {
    const loop = makeLoop();
    const a = loop.submitForReview('a', 'alert', 3, 'a');
    const b = loop.submitForReview('b', 'alert', 3, 'b');
    const pending = loop.getPending();
    assert.deepEqual(pending.map(r => r.id), [a.id, b.id]);
  });
});

describe('MultiAgentReviewLoop.getAll', () => {
  it('returns every submitted request in order', () => {
    const loop = makeLoop();
    const a = loop.submitForReview('a', 'alert', 1, 'a');
    const b = loop.submitForReview('b', 'alert', 3, 'b');
    assert.deepEqual(loop.getAll().map(r => r.id), [a.id, b.id]);
  });
});

// ── isApproved ───────────────────────────────────────────────────────────

describe('MultiAgentReviewLoop.isApproved', () => {
  it('returns false for unknown target', () => {
    const loop = makeLoop();
    assert.equal(loop.isApproved('missing'), false);
  });

  it('returns true for auto-approved target', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 1, 'low');
    assert.equal(loop.isApproved('a'), true);
  });

  it('returns true after explicit approval', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 3, 'mid');
    loop.review(req.id, true);
    assert.equal(loop.isApproved('a'), true);
  });

  it('returns false while pending', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 3, 'mid');
    assert.equal(loop.isApproved('a'), false);
  });

  it('returns false after rejection', () => {
    const loop = makeLoop();
    const req = loop.submitForReview('a', 'alert', 3, 'mid');
    loop.review(req.id, false);
    assert.equal(loop.isApproved('a'), false);
  });

  it('uses the latest request for the target (later rejection overrides earlier approval)', () => {
    let t = T0;
    const loop = makeLoop({ now: () => t });
    loop.submitForReview('a', 'alert', 1, 'first'); // auto-approved at T0
    t = T0 + 60_000;
    const r2 = loop.submitForReview('a', 'alert', 3, 'second');
    loop.review(r2.id, false);
    assert.equal(loop.isApproved('a'), false);
  });
});

// ── getStats ─────────────────────────────────────────────────────────────

describe('MultiAgentReviewLoop.getStats', () => {
  it('zeros across the board when empty', () => {
    const loop = makeLoop();
    const s = loop.getStats();
    assert.deepEqual(s, { total: 0, autoApproved: 0, pendingCount: 0, approvalRate: 0, avgReviewTimeMs: 0 });
  });

  it('counts total across all categories', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 1, 'r');
    loop.submitForReview('b', 'alert', 3, 'r');
    loop.submitForReview('c', 'alert', 5, 'nuclear');
    assert.equal(loop.getStats().total, 3);
  });

  it('counts autoApproved only for severity < 3 that ended approved', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 1, 'r');
    loop.submitForReview('b', 'alert', 2.5, 'r');
    const p = loop.submitForReview('c', 'alert', 3, 'r');
    loop.review(p.id, true);
    assert.equal(loop.getStats().autoApproved, 2);
  });

  it('counts pendingCount as just-pending', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 3, 'r');
    loop.submitForReview('b', 'alert', 4, 'nuclear'); // escalated, not pending
    assert.equal(loop.getStats().pendingCount, 1);
  });

  it('approvalRate is approved / resolved (pending + escalated excluded)', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 1, 'r'); // auto-approved
    const p = loop.submitForReview('b', 'alert', 3, 'r');
    loop.review(p.id, true);
    const q = loop.submitForReview('c', 'alert', 3, 'r');
    loop.review(q.id, false);
    loop.submitForReview('d', 'alert', 3, 'r'); // still pending — excluded
    const s = loop.getStats();
    // 2 approved / 3 resolved = 0.666…
    assert.ok(Math.abs(s.approvalRate - 2 / 3) < 1e-9);
  });

  it('avgReviewTimeMs averages review latency over resolved requests', () => {
    let t = T0;
    const loop = makeLoop({ now: () => t });
    const a = loop.submitForReview('a', 'alert', 3, 'r');
    t = T0 + 1_000;
    loop.review(a.id, true);
    t = T0 + 2_000;
    const b = loop.submitForReview('b', 'alert', 3, 'r');
    t = T0 + 5_000; // b waited 3s
    loop.review(b.id, false);
    const s = loop.getStats();
    assert.equal(s.avgReviewTimeMs, 2_000); // (1000 + 3000) / 2
  });

  it('avgReviewTimeMs is 0 when no resolved requests', () => {
    const loop = makeLoop();
    loop.submitForReview('a', 'alert', 3, 'r');
    loop.submitForReview('b', 'alert', 4, 'nuclear');
    assert.equal(loop.getStats().avgReviewTimeMs, 0);
  });
});

// ── Persistence ──────────────────────────────────────────────────────────

describe('MultiAgentReviewLoop persistence', () => {
  it('persists each submission under wm-review-loop', () => {
    const storage = makeStorage();
    const loop = new MultiAgentReviewLoop({ storage, now: () => T0, idGen: () => 'fixed-id' });
    loop.submitForReview('a', 'alert', 1, 'r');
    const raw = storage.raw(STORAGE_KEY);
    assert.ok(raw, 'expected storage to contain the persisted blob');
    const parsed = JSON.parse(raw) as ReviewRequest[];
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.targetId, 'a');
  });

  it('hydrates from storage on construction', () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify([{
      id: 'rvw-1', targetId: 'a', targetType: 'alert', severity: 1,
      reason: 'r', status: 'approved', createdAt: T0, reviewedAt: T0,
    }]));
    const loop = new MultiAgentReviewLoop({ storage, now: () => T0 });
    assert.equal(loop.getAll().length, 1);
    assert.equal(loop.isApproved('a'), true);
  });

  it('drops corrupt storage rows without crashing', () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, '{not valid json');
    const loop = new MultiAgentReviewLoop({ storage, now: () => T0 });
    assert.equal(loop.getAll().length, 0);
  });

  it('ignores entries with invalid shape', () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify([
      { id: 'bad', targetId: 'a' }, // missing fields
      { id: 'rvw-2', targetId: 'b', targetType: 'alert', severity: 1, reason: 'r', status: 'approved', createdAt: T0 },
    ]));
    const loop = new MultiAgentReviewLoop({ storage, now: () => T0 });
    const all = loop.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.id, 'rvw-2');
  });

  it('caps at capacity by FIFO eviction', () => {
    const loop = makeLoop({ capacity: 3 });
    for (let i = 0; i < 5; i++) loop.submitForReview(`t${i}`, 'alert', 1, 'r');
    const all = loop.getAll();
    assert.equal(all.length, 3);
    // First two should have been evicted.
    assert.deepEqual(all.map(r => r.targetId), ['t2', 't3', 't4']);
  });

  it('clear() wipes both memory and storage', () => {
    const storage = makeStorage();
    const loop = new MultiAgentReviewLoop({ storage, now: () => T0 });
    loop.submitForReview('a', 'alert', 1, 'r');
    loop.clear();
    assert.equal(loop.getAll().length, 0);
    assert.equal(storage.raw(STORAGE_KEY), '[]');
  });
});

// ── Singleton ────────────────────────────────────────────────────────────

describe('MultiAgentReviewLoop singleton', () => {
  beforeEach(() => { MultiAgentReviewLoop.resetForTests(); });

  it('getInstance returns the same instance on repeated calls', () => {
    const a = MultiAgentReviewLoop.getInstance();
    const b = MultiAgentReviewLoop.getInstance();
    assert.equal(a, b);
  });

  it('resetForTests gives a fresh instance', () => {
    const a = MultiAgentReviewLoop.getInstance();
    MultiAgentReviewLoop.resetForTests();
    const b = MultiAgentReviewLoop.getInstance();
    assert.notEqual(a, b);
  });
});
