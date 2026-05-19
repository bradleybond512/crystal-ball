/**
 * AutonomousRepairRecommendationService — deterministic unit tests.
 *
 * Verifies generateRecommendations() routing across health-score bands and
 * quality-debt severities, dedupe of open recommendations, status
 * transitions, getOpen() ordering, getStats() math (including
 * avgTimeToApplyHours), ring-buffer eviction at MAX_RECOMMENDATIONS,
 * storage persist/rehydrate, and singleton lifecycle.
 *
 * Injectable storage + clock throughout — no live localStorage, no Date.now.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  AutonomousRepairRecommendationService,
  getAutonomousRepairRecommendationService,
  __internals,
  STORAGE_KEY,
  MAX_RECOMMENDATIONS,
  CRITICAL_HEALTH_THRESHOLD,
  DEGRADED_HEALTH_THRESHOLD,
} from '../../src/services/intelligence/autonomous-repair-recommendations.ts';
import type {
  StorageLike,
  RepairRecommendation,
  HealthSignal,
  QualityDebt,
} from '../../src/services/intelligence/autonomous-repair-recommendations.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

function makeService(
  storage: StorageLike | null = null,
  clock: () => number = () => NOW,
): AutonomousRepairRecommendationService {
  return new AutonomousRepairRecommendationService({ storage, clock });
}

// ── Constants ─────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is wm-repair-recommendations', () => {
    assert.equal(STORAGE_KEY, 'wm-repair-recommendations');
  });

  it('MAX_RECOMMENDATIONS is 300', () => {
    assert.equal(MAX_RECOMMENDATIONS, 300);
  });

  it('CRITICAL_HEALTH_THRESHOLD is 0.3', () => {
    assert.equal(CRITICAL_HEALTH_THRESHOLD, 0.3);
  });

  it('DEGRADED_HEALTH_THRESHOLD is 0.5', () => {
    assert.equal(DEGRADED_HEALTH_THRESHOLD, 0.5);
  });

  it('PRIORITY_ORDER places critical at the top', () => {
    const order = __internals.PRIORITY_ORDER;
    assert.ok(order.critical > order.high);
    assert.ok(order.high > order.medium);
    assert.ok(order.medium > order.low);
  });
});

// ── Singleton lifecycle ──────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => { AutonomousRepairRecommendationService._resetForTests(); });

  it('getInstance() returns the same instance across calls', () => {
    const a = AutonomousRepairRecommendationService.getInstance();
    const b = AutonomousRepairRecommendationService.getInstance();
    assert.equal(a, b);
  });

  it('getAutonomousRepairRecommendationService() delegates to getInstance()', () => {
    const a = AutonomousRepairRecommendationService.getInstance();
    const b = getAutonomousRepairRecommendationService();
    assert.equal(a, b);
  });

  it('_resetForTests() clears the cached singleton', () => {
    const a = AutonomousRepairRecommendationService.getInstance();
    AutonomousRepairRecommendationService._resetForTests();
    const b = AutonomousRepairRecommendationService.getInstance();
    assert.notEqual(a, b);
  });
});

// ── generateRecommendations: health signals ──────────────────────────────

describe('generateRecommendations — health signals', () => {
  it('score < 0.3 produces a critical-priority feed repair', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: 'cyber', score: 0.15 }], []);
    assert.equal(out.length, 1);
    const [rec] = out;
    assert.equal(rec.targetType, 'feed');
    assert.equal(rec.targetId, 'cyber');
    assert.equal(rec.priority, 'critical');
    assert.equal(rec.status, 'pending');
    assert.match(rec.description, /0\.15/);
  });

  it('score in [0.3, 0.5) produces a medium-priority threshold adjustment', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: 'weather', score: 0.4 }], []);
    assert.equal(out.length, 1);
    const [rec] = out;
    assert.equal(rec.targetType, 'threshold');
    assert.equal(rec.targetId, 'weather');
    assert.equal(rec.priority, 'medium');
  });

  it('score exactly at 0.3 is threshold-band (not critical)', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: 'maritime', score: 0.3 }], []);
    assert.equal(out.length, 1);
    assert.equal(out[0].targetType, 'threshold');
    assert.equal(out[0].priority, 'medium');
  });

  it('score exactly at 0.5 produces no recommendation', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: 'aviation', score: 0.5 }], []);
    assert.equal(out.length, 0);
  });

  it('healthy domains (score >= 0.5) produce no recommendation', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: 'financial', score: 0.85 }], []);
    assert.equal(out.length, 0);
  });

  it('NaN or undefined scores are ignored', () => {
    const svc = makeService();
    const out = svc.generateRecommendations(
      [{ domain: 'a', score: Number.NaN }, { domain: 'b', score: 0.1 }] as HealthSignal[],
      [],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].targetId, 'b');
  });

  it('empty-string domain is ignored', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([{ domain: '', score: 0.1 }], []);
    assert.equal(out.length, 0);
  });

  it('handles multiple health signals in a single call', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([
      { domain: 'cyber', score: 0.1 },
      { domain: 'maritime', score: 0.45 },
      { domain: 'aviation', score: 0.95 },
    ], []);
    assert.equal(out.length, 2);
    const byTarget = new Map(out.map((r) => [r.targetId, r]));
    assert.equal(byTarget.get('cyber')?.priority, 'critical');
    assert.equal(byTarget.get('maritime')?.priority, 'medium');
  });
});

// ── generateRecommendations: quality debts ───────────────────────────────

describe('generateRecommendations — quality debts', () => {
  it('critical debt produces a critical-priority algorithm reconfiguration', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [{ category: 'truth-scoring', severity: 'critical' }]);
    assert.equal(out.length, 1);
    const [rec] = out;
    assert.equal(rec.targetType, 'algorithm');
    assert.equal(rec.targetId, 'truth-scoring');
    assert.equal(rec.priority, 'critical');
  });

  it('high debt produces a high-priority algorithm reconfiguration', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [{ category: 'baseline-deviation', severity: 'high' }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].priority, 'high');
  });

  it('medium debt produces no recommendation', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [{ category: 'noise-floor', severity: 'medium' }]);
    assert.equal(out.length, 0);
  });

  it('low debt produces no recommendation', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [{ category: 'sparkline-jitter', severity: 'low' }]);
    assert.equal(out.length, 0);
  });

  it('severity matching is case-insensitive', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [
      { category: 'a', severity: 'CRITICAL' },
      { category: 'b', severity: 'High' },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out.find((r) => r.targetId === 'a')?.priority, 'critical');
    assert.equal(out.find((r) => r.targetId === 'b')?.priority, 'high');
  });

  it('empty-string category is ignored', () => {
    const svc = makeService();
    const out = svc.generateRecommendations([], [{ category: '', severity: 'critical' }]);
    assert.equal(out.length, 0);
  });
});

// ── generateRecommendations: dedupe + ordering ───────────────────────────

describe('generateRecommendations — dedupe + ordering', () => {
  it('re-running with the same inputs does not produce duplicates', () => {
    const svc = makeService();
    const first = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    const second = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
    assert.equal(svc.getOpen().length, 1);
  });

  it('applied recommendations no longer block dedupe', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.applyRecommendation(rec.id);
    const second = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    assert.equal(second.length, 1);
  });

  it('dismissed recommendations no longer block dedupe', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.dismissRecommendation(rec.id);
    const second = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    assert.equal(second.length, 1);
  });

  it('feed and threshold targets do not collide on dedupe', () => {
    const svc = makeService();
    svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    const next = svc.generateRecommendations([{ domain: 'cyber', score: 0.4 }], []);
    assert.equal(next.length, 1);
    assert.equal(next[0].targetType, 'threshold');
  });

  it('returns this-call results sorted by priority descending', () => {
    const svc = makeService();
    const out = svc.generateRecommendations(
      [{ domain: 'thresh-only', score: 0.4 }, { domain: 'feed-crit', score: 0.1 }],
      [{ category: 'algo-high', severity: 'high' }],
    );
    assert.equal(out.length, 3);
    const priorities = out.map((r) => r.priority);
    const order = __internals.PRIORITY_ORDER;
    for (let i = 1; i < priorities.length; i += 1) {
      assert.ok(order[priorities[i - 1]] >= order[priorities[i]],
        `priorities ${JSON.stringify(priorities)} not sorted descending`);
    }
  });

  it('every generated recommendation has a unique id', () => {
    const svc = makeService();
    const out = svc.generateRecommendations(
      [
        { domain: 'a', score: 0.1 },
        { domain: 'b', score: 0.1 },
        { domain: 'c', score: 0.4 },
      ],
      [{ category: 'x', severity: 'critical' }],
    );
    const ids = new Set(out.map((r) => r.id));
    assert.equal(ids.size, out.length);
  });
});

// ── applyRecommendation / dismissRecommendation ──────────────────────────

describe('status transitions', () => {
  it('applyRecommendation marks status applied and stamps appliedAt', () => {
    let now = NOW;
    const svc = makeService(null, () => now);
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    now = NOW + 90 * 60_000; // 1.5h later
    const ok = svc.applyRecommendation(rec.id);
    assert.equal(ok, true);
    const stored = svc.getStats();
    assert.equal(stored.applied, 1);
    assert.equal(stored.pending, 0);
    const all = (svc as unknown as { recommendations: RepairRecommendation[] }).recommendations;
    assert.equal(all[0].status, 'applied');
    assert.equal(all[0].appliedAt, NOW + 90 * 60_000);
  });

  it('applyRecommendation returns false for an unknown id', () => {
    const svc = makeService();
    assert.equal(svc.applyRecommendation('nope'), false);
  });

  it('applyRecommendation returns false if already applied', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    assert.equal(svc.applyRecommendation(rec.id), true);
    assert.equal(svc.applyRecommendation(rec.id), false);
  });

  it('applyRecommendation returns false if already dismissed', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.dismissRecommendation(rec.id);
    assert.equal(svc.applyRecommendation(rec.id), false);
  });

  it('dismissRecommendation marks status dismissed (no appliedAt)', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    const ok = svc.dismissRecommendation(rec.id);
    assert.equal(ok, true);
    const all = (svc as unknown as { recommendations: RepairRecommendation[] }).recommendations;
    assert.equal(all[0].status, 'dismissed');
    assert.equal(all[0].appliedAt, undefined);
  });

  it('dismissRecommendation returns false for unknown id', () => {
    const svc = makeService();
    assert.equal(svc.dismissRecommendation('ghost'), false);
  });

  it('dismissRecommendation returns false if already applied', () => {
    const svc = makeService();
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.applyRecommendation(rec.id);
    assert.equal(svc.dismissRecommendation(rec.id), false);
  });
});

// ── getOpen ───────────────────────────────────────────────────────────────

describe('getOpen', () => {
  it('returns only pending recommendations', () => {
    const svc = makeService();
    const [a, b, c] = svc.generateRecommendations(
      [{ domain: 'a', score: 0.1 }, { domain: 'b', score: 0.1 }, { domain: 'c', score: 0.1 }],
      [],
    );
    svc.applyRecommendation(a.id);
    svc.dismissRecommendation(b.id);
    const open = svc.getOpen();
    assert.equal(open.length, 1);
    assert.equal(open[0].id, c.id);
  });

  it('is empty when nothing pending', () => {
    const svc = makeService();
    assert.deepEqual(svc.getOpen(), []);
  });

  it('orders by priority descending', () => {
    const svc = makeService();
    svc.generateRecommendations(
      [{ domain: 'lowish', score: 0.4 }, { domain: 'criti', score: 0.1 }],
      [{ category: 'algo-h', severity: 'high' }],
    );
    const open = svc.getOpen();
    assert.equal(open[0].priority, 'critical');
    assert.equal(open[1].priority, 'high');
    assert.equal(open[2].priority, 'medium');
  });

  it('returns shallow copies (mutating a result does not change state)', () => {
    const svc = makeService();
    svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    const open = svc.getOpen();
    open[0].priority = 'low';
    assert.equal(svc.getOpen()[0].priority, 'critical');
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns zeros when empty', () => {
    const svc = makeService();
    assert.deepEqual(svc.getStats(), {
      total: 0, applied: 0, dismissed: 0, pending: 0, avgTimeToApplyHours: 0,
    });
  });

  it('counts total/applied/dismissed/pending separately', () => {
    const svc = makeService();
    const [a, b, c, d] = svc.generateRecommendations(
      [
        { domain: 'a', score: 0.1 },
        { domain: 'b', score: 0.1 },
        { domain: 'c', score: 0.1 },
        { domain: 'd', score: 0.1 },
      ],
      [],
    );
    svc.applyRecommendation(a.id);
    svc.applyRecommendation(b.id);
    svc.dismissRecommendation(c.id);
    // d remains pending
    const stats = svc.getStats();
    assert.equal(stats.total, 4);
    assert.equal(stats.applied, 2);
    assert.equal(stats.dismissed, 1);
    assert.equal(stats.pending, 1);
    void d; // referenced for clarity
  });

  it('avgTimeToApplyHours averages (appliedAt - generatedAt) across applied only', () => {
    let now = NOW;
    const svc = makeService(null, () => now);
    const [a, b, c] = svc.generateRecommendations(
      [{ domain: 'a', score: 0.1 }, { domain: 'b', score: 0.1 }, { domain: 'c', score: 0.1 }],
      [],
    );
    now = NOW + 2 * HOUR_MS;
    svc.applyRecommendation(a.id);
    now = NOW + 4 * HOUR_MS;
    svc.applyRecommendation(b.id);
    // c stays pending so it doesn't count
    void c;
    const stats = svc.getStats();
    assert.equal(stats.applied, 2);
    assert.equal(stats.avgTimeToApplyHours, 3);
  });

  it('avgTimeToApplyHours is 0 when nothing has been applied', () => {
    const svc = makeService();
    svc.generateRecommendations([{ domain: 'a', score: 0.1 }], []);
    assert.equal(svc.getStats().avgTimeToApplyHours, 0);
  });
});

// ── Storage persist + rehydrate ──────────────────────────────────────────

describe('storage', () => {
  it('persists generated recommendations to the injected store', () => {
    const storage = makeStorage();
    const svc = makeService(storage);
    svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw, 'expected storage to be written');
    const parsed = JSON.parse(raw!) as RepairRecommendation[];
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].targetType, 'feed');
  });

  it('persists status transitions to storage', () => {
    const storage = makeStorage();
    const svc = makeService(storage);
    const [rec] = svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.applyRecommendation(rec.id);
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!) as RepairRecommendation[];
    assert.equal(parsed[0].status, 'applied');
  });

  it('hydrates pre-existing recommendations on construction', () => {
    const existing: RepairRecommendation[] = [{
      id: 'arr-old-1',
      title: 'old', description: 'old', targetType: 'feed', targetId: 'cyber',
      action: 'a', expectedImpact: 'i', priority: 'critical', status: 'pending',
      generatedAt: NOW - HOUR_MS,
    }];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(existing) });
    const svc = makeService(storage);
    const open = svc.getOpen();
    assert.equal(open.length, 1);
    assert.equal(open[0].id, 'arr-old-1');
  });

  it('skips hydration when stored JSON is malformed', () => {
    const storage = makeStorage({ [STORAGE_KEY]: '{not json' });
    const svc = makeService(storage);
    assert.deepEqual(svc.getOpen(), []);
  });

  it('skips hydration when stored JSON is not an array', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ id: 'x' }) });
    const svc = makeService(storage);
    assert.deepEqual(svc.getOpen(), []);
  });

  it('discards stored entries that fail shape validation', () => {
    const bogus = [{ id: 'arr-1' }, null, { id: 1, targetType: 'feed', targetId: 'x', generatedAt: NOW }];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(bogus) });
    const svc = makeService(storage);
    assert.equal(svc.getStats().total, 0);
  });

  it('rehydrated state is identical across two instances over the same store', () => {
    const storage = makeStorage();
    const a = makeService(storage);
    a.generateRecommendations([{ domain: 'cyber', score: 0.1 }], [{ category: 'algo', severity: 'critical' }]);
    const b = makeService(storage);
    assert.equal(b.getStats().total, 2);
  });

  it('resetForTesting() clears state and removes the storage entry', () => {
    const storage = makeStorage();
    const svc = makeService(storage);
    svc.generateRecommendations([{ domain: 'cyber', score: 0.1 }], []);
    svc.resetForTesting();
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.deepEqual(svc.getOpen(), []);
  });
});

// ── Ring buffer eviction ─────────────────────────────────────────────────

describe('ring buffer', () => {
  it('caps stored recommendations at MAX_RECOMMENDATIONS', () => {
    const svc = makeService();
    // Generate MAX + 50 critical-feed recommendations by varying domain.
    const signals: HealthSignal[] = [];
    for (let i = 0; i < MAX_RECOMMENDATIONS + 50; i += 1) {
      signals.push({ domain: `domain-${i}`, score: 0.05 });
    }
    svc.generateRecommendations(signals, []);
    assert.equal(svc.getStats().total, MAX_RECOMMENDATIONS);
  });

  it('drops oldest entries first when capacity is exceeded', () => {
    const svc = makeService();
    const signals: HealthSignal[] = [];
    for (let i = 0; i < MAX_RECOMMENDATIONS + 5; i += 1) {
      signals.push({ domain: `d-${i}`, score: 0.05 });
    }
    svc.generateRecommendations(signals, []);
    const stillOpen = new Set(svc.getOpen().map((r) => r.targetId));
    // The earliest 5 should be evicted.
    for (let i = 0; i < 5; i += 1) {
      assert.equal(stillOpen.has(`d-${i}`), false, `d-${i} should have been evicted`);
    }
    assert.equal(stillOpen.has(`d-${MAX_RECOMMENDATIONS}`), true);
  });
});

// ── Combined + edge cases ────────────────────────────────────────────────

describe('combined inputs', () => {
  it('emits feed + threshold + algorithm in one call when all signals fire', () => {
    const svc = makeService();
    const signals: HealthSignal[] = [
      { domain: 'feed-domain', score: 0.05 },
      { domain: 'thresh-domain', score: 0.45 },
    ];
    const debts: QualityDebt[] = [
      { category: 'algo-cat', severity: 'critical' },
    ];
    const out = svc.generateRecommendations(signals, debts);
    const types = new Set(out.map((r) => r.targetType));
    assert.equal(types.has('feed'), true);
    assert.equal(types.has('threshold'), true);
    assert.equal(types.has('algorithm'), true);
  });

  it('quality-debt dedupe is independent of health-signal dedupe', () => {
    const svc = makeService();
    svc.generateRecommendations([], [{ category: 'cat', severity: 'critical' }]);
    const again = svc.generateRecommendations([], [{ category: 'cat', severity: 'critical' }]);
    assert.equal(again.length, 0);
    const fresh = svc.generateRecommendations([], [{ category: 'other-cat', severity: 'critical' }]);
    assert.equal(fresh.length, 1);
  });
});
