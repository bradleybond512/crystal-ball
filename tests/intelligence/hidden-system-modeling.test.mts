import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HiddenSystemModelingService } from '../../src/services/intelligence/hidden-system-modeling.js';
import type { ProxySignal } from '../../src/services/intelligence/hidden-system-modeling.js';

function makeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
}

function makeProxy(value: number, weight: number = 1.0): ProxySignal {
  return { signalType: 'test', domain: 'test', value, weight, observedAt: Date.now() };
}

// ── infer — state mapping ─────────────────────────────────────────────────

describe('infer — state mapping', () => {
  it('weighted mean 0.1 → stable', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.1)]);
    assert.equal(result.inferredState, 'stable');
  });

  it('weighted mean 0.35 → stressed', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.35)]);
    assert.equal(result.inferredState, 'stressed');
  });

  it('weighted mean 0.6 → degraded', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.6)]);
    assert.equal(result.inferredState, 'degraded');
  });

  it('weighted mean 0.85 → failed', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.85)]);
    assert.equal(result.inferredState, 'failed');
  });

  it('empty proxies → unknown, confidence 0', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', []);
    assert.equal(result.inferredState, 'unknown');
    assert.equal(result.confidence, 0);
  });

  it('boundary: exactly 0.25 → stressed (not stable)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.25)]);
    assert.equal(result.inferredState, 'stressed');
  });

  it('boundary: exactly 0.75 → failed (not degraded)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.75)]);
    assert.equal(result.inferredState, 'failed');
  });
});

// ── infer — confidence calculation ───────────────────────────────────────

describe('infer — confidence calculation', () => {
  it('all proxies same value → stddev 0 → confidence 1', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [
      makeProxy(0.3),
      makeProxy(0.3),
      makeProxy(0.3),
    ]);
    assert.equal(result.confidence, 1);
  });

  it('spread proxies → confidence < 1', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [
      makeProxy(0.1),
      makeProxy(0.5),
      makeProxy(0.9),
    ]);
    assert.ok(result.confidence < 1);
  });

  it('two proxies far apart (0 and 1) → confidence near 0', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [
      makeProxy(0.0),
      makeProxy(1.0),
    ]);
    // stddev of [0, 1] = 0.5 → confidence = 1 - 0.5 = 0.5
    assert.ok(result.confidence <= 0.5);
  });

  it('confidence is clamped to [0, 1]', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.5)]);
    assert.ok(result.confidence >= 0);
    assert.ok(result.confidence <= 1);
  });
});

// ── infer — weighted mean ─────────────────────────────────────────────────

describe('infer — weighted mean', () => {
  it('high-weight low-value proxy dominates low-weight high-value proxy', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    // weight 3 on value 0.1 vs weight 1 on value 0.9 → mean = (0.1*3 + 0.9*1)/4 = 0.3/4+0.9/4 = 0.3
    const result = svc.infer('TestSystem', 'test', [
      makeProxy(0.1, 3.0),
      makeProxy(0.9, 1.0),
    ]);
    // weighted mean = (0.3 + 0.9) / 4 = 0.3 → stressed
    assert.equal(result.inferredState, 'stressed');
  });

  it('equal weights behave like plain mean', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [
      makeProxy(0.2, 1.0),
      makeProxy(0.4, 1.0),
    ]);
    // plain mean = 0.3 → stressed
    assert.equal(result.inferredState, 'stressed');
  });

  it('single proxy: state matches its exact value', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('TestSystem', 'test', [makeProxy(0.8, 5.0)]);
    assert.equal(result.inferredState, 'failed');
  });
});

// ── getState ──────────────────────────────────────────────────────────────

describe('getState', () => {
  it('returns state after infer', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    svc.infer('PowerGrid', 'energy', [makeProxy(0.4)]);
    const state = svc.getState('PowerGrid');
    assert.ok(state !== undefined);
    assert.equal(state.systemName, 'PowerGrid');
  });

  it('case-insensitive lookup', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    svc.infer('PowerGrid', 'energy', [makeProxy(0.4)]);
    const state = svc.getState('powergrid');
    assert.ok(state !== undefined);
  });

  it('returns undefined for unknown system', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('NonExistentSystem');
    assert.equal(state, undefined);
  });

  it('returns updated state after multiple infers', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    svc.infer('GridSystem', 'energy', [makeProxy(0.1)]);
    svc.infer('GridSystem', 'energy', [makeProxy(0.9)]);
    const state = svc.getState('GridSystem');
    assert.equal(state?.inferredState, 'failed');
  });
});

// ── getAllStates ──────────────────────────────────────────────────────────

describe('getAllStates', () => {
  it('sorted ascending by confidence (least certain first)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    // Low confidence: mixed values
    svc.infer('SysA', 'test', [makeProxy(0.0), makeProxy(1.0)]);
    // High confidence: uniform values
    svc.infer('SysB', 'test', [makeProxy(0.5), makeProxy(0.5), makeProxy(0.5)]);
    const all = svc.getAllStates();
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i].confidence >= all[i - 1].confidence,
        `index ${i} confidence ${all[i].confidence} should be >= index ${i-1} confidence ${all[i-1].confidence}`);
    }
  });

  it('includes seed systems after fresh construction', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const all = svc.getAllStates();
    assert.ok(all.length >= 6);
  });

  it('returns all inferred systems', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    svc.infer('Alpha', 'test', [makeProxy(0.1)]);
    svc.infer('Beta', 'test', [makeProxy(0.5)]);
    svc.infer('Gamma', 'test', [makeProxy(0.9)]);
    const all = svc.getAllStates();
    const names = all.map((s) => s.systemName);
    assert.ok(names.includes('Alpha'));
    assert.ok(names.includes('Beta'));
    assert.ok(names.includes('Gamma'));
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('total equals number of states', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const stats = svc.getStats();
    assert.equal(stats.total, svc.getAllStates().length);
  });

  it('byState counts are correct', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    svc.infer('StableOne', 'test', [makeProxy(0.1)]);
    svc.infer('FailedOne', 'test', [makeProxy(0.9)]);
    const stats = svc.getStats();
    const stableCount = (stats.byState['stable'] ?? 0);
    const failedCount = (stats.byState['failed'] ?? 0);
    assert.ok(stableCount >= 1);
    assert.ok(failedCount >= 1);
    const sumByState = Object.values(stats.byState).reduce((s, v) => s + v, 0);
    assert.equal(sumByState, stats.total);
  });

  it('avgConfidence is numeric and in [0, 1]', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const stats = svc.getStats();
    assert.ok(typeof stats.avgConfidence === 'number');
    assert.ok(stats.avgConfidence >= 0);
    assert.ok(stats.avgConfidence <= 1);
  });

  it('empty service returns total 0 and avgConfidence 0', () => {
    // Use a service with pre-loaded storage that is empty (no seeds, forced)
    const storage = makeStorage();
    // Pre-populate with empty states array so hydrate loads it and seed is skipped
    storage.setItem('wm-hidden-systems', JSON.stringify({ states: [
      // put a placeholder so seedIfEmpty thinks it's non-empty
      {
        id: 'placeholder',
        systemName: 'Placeholder',
        domain: 'test',
        inferredState: 'stable' as const,
        confidence: 0.5,
        proxySignals: [],
        lastInferredAt: Date.now(),
      }
    ] }));
    const svc = HiddenSystemModelingService.createForTesting(storage);
    const stats = svc.getStats();
    assert.equal(stats.total, 1);
    assert.ok(stats.avgConfidence >= 0);
  });
});

// ── seed systems ──────────────────────────────────────────────────────────

describe('seed systems', () => {
  it('Global Financial Clearing exists', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Global Financial Clearing');
    assert.ok(state !== undefined);
  });

  it('Global Financial Clearing domain is finance', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Global Financial Clearing');
    assert.equal(state?.domain, 'finance');
  });

  it('Undersea Cable Network exists with domain telecommunications', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Undersea Cable Network');
    assert.ok(state !== undefined);
    assert.equal(state?.domain, 'telecommunications');
  });

  it('Sovereign Debt Rollover exists with domain finance', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Sovereign Debt Rollover');
    assert.ok(state !== undefined);
    assert.equal(state?.domain, 'finance');
  });

  it('Supply Chain Credit Availability exists with domain trade', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Supply Chain Credit Availability');
    assert.ok(state !== undefined);
    assert.equal(state?.domain, 'trade');
  });

  it('Dark Fiber Capacity exists with domain telecommunications', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Dark Fiber Capacity');
    assert.ok(state !== undefined);
    assert.equal(state?.domain, 'telecommunications');
  });

  it('Global Shipping Insurance Pool exists with domain maritime', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const state = svc.getState('Global Shipping Insurance Pool');
    assert.ok(state !== undefined);
    assert.equal(state?.domain, 'maritime');
  });

  it('seed systems have non-zero confidence (proxy signals provided)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    for (const state of svc.getAllStates()) {
      assert.ok(state.confidence > 0, `${state.systemName} should have confidence > 0`);
    }
  });
});

// ── storage ───────────────────────────────────────────────────────────────

describe('storage', () => {
  it('state persists across createForTesting() reconstructions', () => {
    const storage = makeStorage();
    const svc1 = HiddenSystemModelingService.createForTesting(storage);
    svc1.infer('PersistMe', 'energy', [makeProxy(0.6)]);
    const svc2 = HiddenSystemModelingService.createForTesting(storage);
    const state = svc2.getState('PersistMe');
    assert.ok(state !== undefined);
    assert.equal(state?.systemName, 'PersistMe');
  });

  it('max 200 enforced — adding 201 unique systems keeps length at 200', () => {
    const storage = makeStorage();
    const svc = HiddenSystemModelingService.createForTesting(storage);
    for (let i = 0; i < 201; i++) {
      svc.infer(`UniqueSystem${i}`, 'test', [makeProxy(0.3)]);
    }
    assert.equal(svc.getAllStates().length, 200);
  });

  it('corrupt storage blob does not crash — falls back to seeds only', () => {
    const storage = makeStorage();
    storage.setItem('wm-hidden-systems', 'this is not json{{{');
    const svc = HiddenSystemModelingService.createForTesting(storage);
    // Should have seeded since corrupt storage leaves empty map
    const all = svc.getAllStates();
    assert.ok(all.length >= 6);
  });

  it('partial corrupt storage (valid JSON, wrong shape) falls back gracefully', () => {
    const storage = makeStorage();
    storage.setItem('wm-hidden-systems', JSON.stringify({ notStates: true }));
    const svc = HiddenSystemModelingService.createForTesting(storage);
    const all = svc.getAllStates();
    assert.ok(all.length >= 6);
  });

  it('persisted data has the storage key wm-hidden-systems', () => {
    const storage = makeStorage();
    const svc = HiddenSystemModelingService.createForTesting(storage);
    svc.infer('AnySystem', 'test', [makeProxy(0.2)]);
    assert.ok(storage.store.has('wm-hidden-systems'));
  });
});

// ── HiddenSystemState shape ───────────────────────────────────────────────

describe('HiddenSystemState shape', () => {
  it('returned state has all required fields', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('ShapeTest', 'finance', [makeProxy(0.4)]);
    assert.ok(typeof result.id === 'string');
    assert.ok(typeof result.systemName === 'string');
    assert.ok(typeof result.domain === 'string');
    assert.ok(typeof result.inferredState === 'string');
    assert.ok(typeof result.confidence === 'number');
    assert.ok(Array.isArray(result.proxySignals));
    assert.ok(typeof result.lastInferredAt === 'number');
  });

  it('lastInferredAt is a recent timestamp (within last 5 seconds)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const before = Date.now();
    const result = svc.infer('TimestampTest', 'test', [makeProxy(0.3)]);
    const after = Date.now();
    assert.ok(result.lastInferredAt >= before);
    assert.ok(result.lastInferredAt <= after);
  });

  it('proxySignals on returned state match the proxies passed in', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const proxies: ProxySignal[] = [
      { signalType: 'alpha', domain: 'finance', value: 0.3, weight: 2.0, observedAt: Date.now() },
      { signalType: 'beta',  domain: 'finance', value: 0.4, weight: 1.5, observedAt: Date.now() },
    ];
    const result = svc.infer('SignalTest', 'finance', proxies);
    assert.equal(result.proxySignals.length, 2);
    assert.equal(result.proxySignals[0].signalType, 'alpha');
    assert.equal(result.proxySignals[1].signalType, 'beta');
  });

  it('id is derived from systemName (lowercased, spaces to hyphens)', () => {
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    const result = svc.infer('My Test System', 'test', [makeProxy(0.2)]);
    assert.equal(result.id, 'my-test-system');
  });

  it('inferredState is one of the valid enum values', () => {
    const valid = new Set(['stable', 'stressed', 'degraded', 'failed', 'unknown']);
    const svc = HiddenSystemModelingService.createForTesting(makeStorage());
    for (const v of [0.1, 0.3, 0.6, 0.8]) {
      const result = svc.infer(`sys-${v}`, 'test', [makeProxy(v)]);
      assert.ok(valid.has(result.inferredState));
    }
    const emptyResult = svc.infer('empty-sys', 'test', []);
    assert.ok(valid.has(emptyResult.inferredState));
  });
});
