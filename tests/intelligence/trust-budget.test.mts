import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TrustBudgetService,
  resetForTests,
  type BudgetConsumption,
} from '../../src/services/intelligence/trust-budget.ts';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60_000;

// ── checkAndConsume — allowed path ─────────────────────────────────

describe('TrustBudgetService.checkAndConsume — allowed', () => {
  beforeEach(() => { resetForTests(); });

  it('first request in a fresh window is allowed', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    const result = s.checkAndConsume('earthquake', 'alert-1');
    assert.equal(result.allowed, true);
    assert.equal(result.status.suppressionActive, false);
    assert.equal(result.status.consumed, 1);
    assert.equal(result.status.remaining, 9);
  });

  it('decrements remaining on each allowed call', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'a');
    s.checkAndConsume('earthquake', 'b');
    s.checkAndConsume('earthquake', 'c');
    const status = s.getStatus('earthquake');
    assert.equal(status.consumed, 3);
    assert.equal(status.remaining, 7);
  });

  it('consumed record has suppressed=false', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'a');
    const recs = s.getConsumptions('earthquake');
    assert.equal(recs[0]?.suppressed, false);
  });

  it('unknown domain defaults to baseQuota=5', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    const result = s.checkAndConsume('quantum-domain', 'a');
    assert.equal(result.status.quota, 5);
    assert.equal(result.status.remaining, 4);
  });

  it('each known domain has its own independent budget', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 5; i++) s.checkAndConsume('earthquake', `e-${i}`);
    const eq = s.getStatus('earthquake');
    const wx = s.getStatus('weather');
    assert.equal(eq.consumed, 5);
    assert.equal(wx.consumed, 0);
  });
});

// ── checkAndConsume — suppressed ────────────────────────────────────

describe('TrustBudgetService.checkAndConsume — suppressed', () => {
  beforeEach(() => { resetForTests(); });

  it('11th request is suppressed (quota=10)', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    const result = s.checkAndConsume('earthquake', 'over');
    assert.equal(result.allowed, false);
    assert.equal(result.status.suppressionActive, true);
  });

  it('suppressed consumption is still recorded with suppressed=true', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    s.checkAndConsume('earthquake', 'over');
    const recs = s.getConsumptions('earthquake', 1);
    assert.equal(recs[0]?.suppressed, true);
    assert.equal(recs[0]?.alertId, 'over');
  });

  it('suppressed alerts do not decrement remaining below 0', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    s.checkAndConsume('earthquake', 'suppressed');
    s.checkAndConsume('earthquake', 'also-suppressed');
    const status = s.getStatus('earthquake');
    assert.equal(status.remaining, 0);
    assert.equal(status.consumed, 10);
  });

  it('suppressionActive flips off at quota exactly hit (not yet exceeded)', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 9; i++) s.checkAndConsume('earthquake', `a-${i}`);
    assert.equal(s.getStatus('earthquake').suppressionActive, false);
    s.checkAndConsume('earthquake', 'last');
    assert.equal(s.getStatus('earthquake').suppressionActive, true);
  });
});

// ── window reset ───────────────────────────────────────────────────

describe('TrustBudgetService — window boundary reset', () => {
  beforeEach(() => { resetForTests(); });

  it('crossing the windowMs boundary frees up the quota', () => {
    let t = NOW;
    const s = new TrustBudgetService({ now: () => t });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    assert.equal(s.getStatus('earthquake').remaining, 0);
    // Roll forward past the window boundary
    t = NOW + HOUR_MS + 1;
    const status = s.getStatus('earthquake');
    assert.equal(status.consumed, 0);
    assert.equal(status.remaining, 10);
    const result = s.checkAndConsume('earthquake', 'after');
    assert.equal(result.allowed, true);
  });

  it('resetsAt reflects the next window boundary', () => {
    const s = new TrustBudgetService({ now: () => NOW + 15 * 60_000 });
    // 15min into the window. Next reset = NOW + 60min.
    const status = s.getStatus('earthquake');
    const expectedReset = Math.floor((NOW + 15 * 60_000) / HOUR_MS) * HOUR_MS + HOUR_MS;
    assert.equal(status.resetsAt, expectedReset);
  });

  it('manual resetWindow() clears in-window consumption', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    s.resetWindow('earthquake');
    assert.equal(s.getStatus('earthquake').consumed, 0);
    assert.equal(s.getStatus('earthquake').remaining, 10);
  });

  it('resetWindow only affects the named domain', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 5; i++) s.checkAndConsume('earthquake', `e-${i}`);
    for (let i = 0; i < 5; i++) s.checkAndConsume('weather', `w-${i}`);
    s.resetWindow('earthquake');
    assert.equal(s.getStatus('earthquake').consumed, 0);
    assert.equal(s.getStatus('weather').consumed, 5);
  });
});

// ── adjustQuota ─────────────────────────────────────────────────────

describe('TrustBudgetService.adjustQuota', () => {
  beforeEach(() => { resetForTests(); });

  it('high false-positive rate (0.7) reduces quota: factor 0.5 → quota = round(10 * 0.5) = 5', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', 0.7);
    assert.equal(s.getStatus('earthquake').quota, 5);
  });

  it('false-positive rate 0.0 keeps adjustmentFactor at 1.0', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', 0);
    assert.equal(s.getStatus('earthquake').quota, 10);
  });

  it('false-positive rate clamped: > 0.5 → factor floored at 0.5 (min quota = 5)', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', 1.0);
    // 1 - 1.0 = 0 → clamped to 0.5 → quota = round(10 * 0.5) = 5
    assert.equal(s.getStatus('earthquake').quota, 5);
  });

  it('negative false-positive rate is treated as 0 (factor capped at 2.0)', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', -1.0);
    // 1 - (-1) = 2.0 → clamped at 2.0 → quota = round(10 * 2.0) = 20
    assert.equal(s.getStatus('earthquake').quota, 20);
  });

  it('adjustmentFactor surfaces on status as 1.0 by default', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'a');
    assert.equal(s.getStatus('earthquake').quota, 10);
  });

  it('adjustQuota persists the new quota across calls', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', 0.3);
    // factor = 0.7 → quota = round(10 * 0.7) = 7
    assert.equal(s.getStatus('earthquake').quota, 7);
    s.checkAndConsume('earthquake', 'a');
    assert.equal(s.getStatus('earthquake').quota, 7);
    assert.equal(s.getStatus('earthquake').remaining, 6);
  });

  it('adjustQuota stamps lastAdjustedAt', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.adjustQuota('earthquake', 0.3);
    const config = s.getConfig('earthquake');
    assert.equal(config?.lastAdjustedAt, NOW);
  });
});

// ── getStatus / getAllStatuses ──────────────────────────────────────

describe('TrustBudgetService.getStatus / getAllStatuses', () => {
  beforeEach(() => { resetForTests(); });

  it('getStatus on never-used domain returns baseline numbers', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    const status = s.getStatus('cyber');
    assert.equal(status.quota, 10);
    assert.equal(status.consumed, 0);
    assert.equal(status.remaining, 10);
    assert.equal(status.suppressionActive, false);
  });

  it('getAllStatuses includes every domain that has either configs or consumptions', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'a');
    s.checkAndConsume('cyber', 'b');
    s.adjustQuota('weather', 0.5);
    const all = s.getAllStatuses();
    const domains = new Set(all.map((st) => st.domain));
    assert.ok(domains.has('earthquake'));
    assert.ok(domains.has('cyber'));
    assert.ok(domains.has('weather'));
  });

  it('getAllStatuses on empty service returns empty array', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    assert.deepEqual(s.getAllStatuses(), []);
  });
});

// ── getConsumptions ────────────────────────────────────────────────

describe('TrustBudgetService.getConsumptions', () => {
  beforeEach(() => { resetForTests(); });

  it('LIFO order: most recent first', () => {
    let t = NOW;
    const s = new TrustBudgetService({ now: () => t });
    s.checkAndConsume('earthquake', 'first');
    t += 1000;
    s.checkAndConsume('earthquake', 'second');
    const recs = s.getConsumptions('earthquake');
    assert.equal(recs[0]?.alertId, 'second');
    assert.equal(recs[1]?.alertId, 'first');
  });

  it('filter by domain', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'e');
    s.checkAndConsume('weather', 'w');
    assert.equal(s.getConsumptions('earthquake').length, 1);
    assert.equal(s.getConsumptions('weather').length, 1);
  });

  it('limit honored', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 5; i++) s.checkAndConsume('earthquake', `a-${i}`);
    assert.equal(s.getConsumptions('earthquake', 3).length, 3);
  });

  it('no filter returns all consumptions', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    s.checkAndConsume('earthquake', 'e');
    s.checkAndConsume('weather', 'w');
    assert.equal(s.getConsumptions().length, 2);
  });

  it('ring buffer caps consumptions at supplied capacity', () => {
    const s = new TrustBudgetService({ now: () => NOW, capacity: 4 });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    assert.equal(s.getConsumptions().length, 4);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('TrustBudgetService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on every checkAndConsume', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    let calls = 0;
    let last: BudgetConsumption | null = null;
    s.subscribe((c) => { calls++; last = c; });
    s.checkAndConsume('earthquake', 'a');
    s.checkAndConsume('earthquake', 'b');
    assert.equal(calls, 2);
    assert.equal(last?.alertId, 'b');
  });

  it('subscribe fires on suppressed consumptions too', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.checkAndConsume('earthquake', `a-${i}`);
    let suppressedCallSeen = false;
    s.subscribe((c) => { if (c.suppressed) suppressedCallSeen = true; });
    s.checkAndConsume('earthquake', 'over');
    assert.ok(suppressedCallSeen);
  });

  it('unsubscribe stops further callbacks', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    let calls = 0;
    const cb = (): void => { calls++; };
    s.subscribe(cb);
    s.checkAndConsume('earthquake', 'a');
    s.unsubscribe(cb);
    s.checkAndConsume('earthquake', 'b');
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const s = new TrustBudgetService({ now: () => NOW });
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.checkAndConsume('earthquake', 'a');
    off();
    s.checkAndConsume('earthquake', 'b');
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('TrustBudgetService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists configs + consumptions to separate storage keys', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new TrustBudgetService({ now: () => NOW, storage });
    a.adjustQuota('earthquake', 0.5);
    a.checkAndConsume('earthquake', 'persisted');
    const b = new TrustBudgetService({ now: () => NOW, storage });
    assert.equal(b.getStatus('earthquake').quota, 5);
    assert.equal(b.getConsumptions('earthquake').length, 1);
    assert.equal(b.getConsumptions('earthquake')[0]?.alertId, 'persisted');
  });

  it('corrupted configs storage falls back to defaults', () => {
    const storage = {
      getItem: (k: string) => k === 'wm-trust-budgets' ? '{not-json' : null,
      setItem: () => {},
    };
    const s = new TrustBudgetService({ now: () => NOW, storage });
    assert.equal(s.getStatus('earthquake').quota, 10);
  });

  it('corrupted consumptions storage falls back to empty', () => {
    const storage = {
      getItem: (k: string) => k === 'wm-trust-consumptions' ? '{not-json' : null,
      setItem: () => {},
    };
    const s = new TrustBudgetService({ now: () => NOW, storage });
    assert.equal(s.getConsumptions().length, 0);
  });
});
