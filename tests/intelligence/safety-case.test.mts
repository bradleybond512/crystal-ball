/**
 * Tests for SafetyCase + SafetyCaseService — Phase 4 trustworthiness verdict.
 *
 * Run with: npx tsx --test tests/intelligence/safety-case.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
 * Each property's pass/warn/fail thresholds are pinned to the exported
 * constants so a future tuning change can't silently weaken the gate.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  SafetyCaseService,
  __resetSafetyCaseSingleton,
  buildSafetyCase,
  getSafetyCaseService,
  __internals as caseInternals,
  type BiasReport,
  type FeedHealthMap,
  type SafetyCaseInputs,
  type SafetyPropertyStatus,
} from '../../src/services/intelligence/safety-case.ts';
import type { AlgorithmStats } from '../../src/services/intelligence/algo-eval-ledger.ts';
import type { AssumptionStats } from '../../src/services/intelligence/assumption-tracker.ts';
import type { OutcomeStats } from '../../src/services/intelligence/outcome-ledger.ts';
import type { TrustBudgetSnapshot } from '../../src/services/notifications/trust-budget.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function algoStats(overrides: Partial<AlgorithmStats> = {}): AlgorithmStats {
  return {
    algorithmId: 'driver-scorer',
    domain: '*',
    totalPredictions: 100,
    resolvedCount: 100,
    accuracy: 0.85,
    trend: 'stable',
    lastEvaluated: new Date(NOW),
    ...overrides,
  };
}

function assumptionStats(overrides: Partial<AssumptionStats> = {}): AssumptionStats {
  return {
    totalAssumptions: 50,
    totalOutputs: 20,
    byCategory: {} as AssumptionStats['byCategory'],
    criticalCount: 2,
    highRiskCount: 5,
    avgConfidence: 0.8,
    ...overrides,
  };
}

function outcomeStats(overrides: Partial<OutcomeStats> = {}): OutcomeStats {
  return {
    total: 100,
    byAction: {} as OutcomeStats['byAction'],
    byDomain: {},
    overallFalsePositiveRate: 0.2,
    ...overrides,
  };
}

function budgetSnapshot(overrides: Partial<TrustBudgetSnapshot> = {}): TrustBudgetSnapshot {
  return {
    takenAt: new Date(NOW),
    domains: [],
    globalUsed: 0,
    globalQuota: 100,
    exhaustedDomains: [],
    ...overrides,
  };
}

function feedHealth(overrides: Partial<FeedHealthMap> = {}): FeedHealthMap {
  return {
    earthquake: 'healthy',
    weather: 'healthy',
    maritime: 'healthy',
    ...overrides,
  };
}

function safeInputs(overrides: Partial<SafetyCaseInputs> = {}): SafetyCaseInputs {
  return {
    biasReport: { signals: [] },
    algoStats: [algoStats()],
    assumptionStats: assumptionStats(),
    budgetSnapshot: budgetSnapshot(),
    feedHealth: feedHealth(),
    outcomeStats: outcomeStats(),
    humanReviewBacklog: 0,
    ...overrides,
  };
}

function freshService(now = NOW): SafetyCaseService {
  __storage.clear();
  __resetSafetyCaseSingleton();
  return new SafetyCaseService({ clock: () => now });
}

function propStatus(sc: ReturnType<typeof buildSafetyCase>, id: string): SafetyPropertyStatus {
  return sc.properties.find((p) => p.id === id)!.status;
}

// ── Overall aggregation ──────────────────────────────────────────────

test('buildSafetyCase returns 8 properties', () => {
  const sc = buildSafetyCase(safeInputs());
  assert.equal(sc.properties.length, 8);
});

test('all properties passing → overall=pass, safeToOperate=true', () => {
  const sc = buildSafetyCase(safeInputs());
  assert.equal(sc.overallStatus, 'pass');
  assert.equal(sc.safeToOperate, true);
  assert.equal(sc.passCount, 8);
});

test('one fail property → overall=fail, safeToOperate=false', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: { signals: [{ id: 'b1', severity: 'alert' }] },
  }));
  assert.equal(sc.overallStatus, 'fail');
  assert.equal(sc.safeToOperate, false);
  assert.equal(sc.failCount, 1);
});

test('warns alone do not block — overall=warn, safeToOperate=true', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: { signals: [{ id: 'b1', severity: 'warning' }] },
  }));
  assert.equal(sc.overallStatus, 'warn');
  assert.equal(sc.safeToOperate, true);
  assert.ok(sc.warnCount >= 1);
});

// ── Per-property: ACCURACY ───────────────────────────────────────────

test('ACCURACY: 0.85 → pass', () => {
  const sc = buildSafetyCase(safeInputs({ algoStats: [algoStats({ accuracy: 0.85 })] }));
  assert.equal(propStatus(sc, 'accuracy'), 'pass');
});

test('ACCURACY: 0.6 → warn', () => {
  const sc = buildSafetyCase(safeInputs({ algoStats: [algoStats({ accuracy: 0.6 })] }));
  assert.equal(propStatus(sc, 'accuracy'), 'warn');
});

test('ACCURACY: 0.4 → fail', () => {
  const sc = buildSafetyCase(safeInputs({ algoStats: [algoStats({ accuracy: 0.4 })] }));
  assert.equal(propStatus(sc, 'accuracy'), 'fail');
});

test('ACCURACY: weighted across algorithms by resolvedCount', () => {
  // Algo A: accuracy 0.9, n=50. Algo B: accuracy 0.5, n=50. Weighted = 0.7 → pass.
  const sc = buildSafetyCase(safeInputs({
    algoStats: [
      algoStats({ algorithmId: 'a', accuracy: 0.9, resolvedCount: 50 }),
      algoStats({ algorithmId: 'b', accuracy: 0.5, resolvedCount: 50 }),
    ],
  }));
  assert.equal(propStatus(sc, 'accuracy'), 'pass');
});

test('ACCURACY: no categorical samples → warn (cannot certify pass)', () => {
  const sc = buildSafetyCase(safeInputs({
    algoStats: [algoStats({ accuracy: undefined, resolvedCount: 0 })],
  }));
  assert.equal(propStatus(sc, 'accuracy'), 'warn');
});

// ── Per-property: BIAS-FREE ──────────────────────────────────────────

test('BIAS-FREE: no signals → pass', () => {
  const sc = buildSafetyCase(safeInputs({ biasReport: { signals: [] } }));
  assert.equal(propStatus(sc, 'bias-free'), 'pass');
});

test('BIAS-FREE: warning signal → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: { signals: [{ id: 'b1', severity: 'warning' }] },
  }));
  assert.equal(propStatus(sc, 'bias-free'), 'warn');
});

test('BIAS-FREE: alert signal → fail (even alongside warnings)', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: {
      signals: [
        { id: 'b1', severity: 'warning' },
        { id: 'b2', severity: 'alert' },
      ],
    } as BiasReport,
  }));
  assert.equal(propStatus(sc, 'bias-free'), 'fail');
});

// ── Per-property: ASSUMPTIONS-DISCLOSED ──────────────────────────────

test('ASSUMPTIONS-DISCLOSED: 5 critical → pass', () => {
  const sc = buildSafetyCase(safeInputs({
    assumptionStats: assumptionStats({ criticalCount: 5 }),
  }));
  assert.equal(propStatus(sc, 'assumptions-disclosed'), 'pass');
});

test('ASSUMPTIONS-DISCLOSED: 15 critical → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    assumptionStats: assumptionStats({ criticalCount: 15 }),
  }));
  assert.equal(propStatus(sc, 'assumptions-disclosed'), 'warn');
});

test('ASSUMPTIONS-DISCLOSED: 25 critical → fail', () => {
  const sc = buildSafetyCase(safeInputs({
    assumptionStats: assumptionStats({ criticalCount: 25 }),
  }));
  assert.equal(propStatus(sc, 'assumptions-disclosed'), 'fail');
});

// ── Per-property: ALERT-BUDGET ───────────────────────────────────────

test('ALERT-BUDGET: 0 exhausted → pass', () => {
  const sc = buildSafetyCase(safeInputs({
    budgetSnapshot: budgetSnapshot({ exhaustedDomains: [] }),
  }));
  assert.equal(propStatus(sc, 'alert-budget'), 'pass');
});

test('ALERT-BUDGET: 2 exhausted → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    budgetSnapshot: budgetSnapshot({ exhaustedDomains: ['weather', 'cyber'] }),
  }));
  assert.equal(propStatus(sc, 'alert-budget'), 'warn');
});

test('ALERT-BUDGET: 3 exhausted → fail', () => {
  const sc = buildSafetyCase(safeInputs({
    budgetSnapshot: budgetSnapshot({ exhaustedDomains: ['weather', 'cyber', 'aviation'] }),
  }));
  assert.equal(propStatus(sc, 'alert-budget'), 'fail');
});

// ── Per-property: FEED-COVERAGE ──────────────────────────────────────

test('FEED-COVERAGE: all healthy → pass', () => {
  const sc = buildSafetyCase(safeInputs({ feedHealth: feedHealth() }));
  assert.equal(propStatus(sc, 'feed-coverage'), 'pass');
});

test('FEED-COVERAGE: earthquake degraded → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    feedHealth: feedHealth({ earthquake: 'degraded' }),
  }));
  assert.equal(propStatus(sc, 'feed-coverage'), 'warn');
});

test('FEED-COVERAGE: earthquake down → fail', () => {
  const sc = buildSafetyCase(safeInputs({
    feedHealth: feedHealth({ earthquake: 'down' }),
  }));
  assert.equal(propStatus(sc, 'feed-coverage'), 'fail');
});

test('FEED-COVERAGE: missing critical feed treated as down → fail', () => {
  // Empty feedHealth means none of the critical feeds reported in →
  // the evaluator defaults missing to 'down' so the gap is loud.
  const sc = buildSafetyCase(safeInputs({ feedHealth: {} }));
  assert.equal(propStatus(sc, 'feed-coverage'), 'fail');
});

// ── Per-property: FALSE-POSITIVE-RATE ────────────────────────────────

test('FALSE-POSITIVE-RATE: 0.3 → pass', () => {
  const sc = buildSafetyCase(safeInputs({
    outcomeStats: outcomeStats({ overallFalsePositiveRate: 0.3 }),
  }));
  assert.equal(propStatus(sc, 'false-positive-rate'), 'pass');
});

test('FALSE-POSITIVE-RATE: 0.5 → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    outcomeStats: outcomeStats({ overallFalsePositiveRate: 0.5 }),
  }));
  assert.equal(propStatus(sc, 'false-positive-rate'), 'warn');
});

test('FALSE-POSITIVE-RATE: 0.7 → fail', () => {
  const sc = buildSafetyCase(safeInputs({
    outcomeStats: outcomeStats({ overallFalsePositiveRate: 0.7 }),
  }));
  assert.equal(propStatus(sc, 'false-positive-rate'), 'fail');
});

// ── Per-property: HUMAN-IN-LOOP ──────────────────────────────────────

test('HUMAN-IN-LOOP: 5 pending → pass', () => {
  const sc = buildSafetyCase(safeInputs({ humanReviewBacklog: 5 }));
  assert.equal(propStatus(sc, 'human-in-loop'), 'pass');
});

test('HUMAN-IN-LOOP: 20 pending → warn', () => {
  const sc = buildSafetyCase(safeInputs({ humanReviewBacklog: 20 }));
  assert.equal(propStatus(sc, 'human-in-loop'), 'warn');
});

test('HUMAN-IN-LOOP: 30 pending → fail', () => {
  const sc = buildSafetyCase(safeInputs({ humanReviewBacklog: 30 }));
  assert.equal(propStatus(sc, 'human-in-loop'), 'fail');
});

// ── Per-property: ALGORITHM-STABLE ───────────────────────────────────

test('ALGORITHM-STABLE: no degrading → pass', () => {
  const sc = buildSafetyCase(safeInputs({
    algoStats: [algoStats({ trend: 'stable' }), algoStats({ algorithmId: 'b', trend: 'improving' })],
  }));
  assert.equal(propStatus(sc, 'algorithm-stable'), 'pass');
});

test('ALGORITHM-STABLE: 1 degrading → warn', () => {
  const sc = buildSafetyCase(safeInputs({
    algoStats: [algoStats({ trend: 'degrading' })],
  }));
  assert.equal(propStatus(sc, 'algorithm-stable'), 'warn');
});

test('ALGORITHM-STABLE: 2 degrading → fail', () => {
  const sc = buildSafetyCase(safeInputs({
    algoStats: [
      algoStats({ trend: 'degrading' }),
      algoStats({ algorithmId: 'b', trend: 'degrading' }),
    ],
  }));
  assert.equal(propStatus(sc, 'algorithm-stable'), 'fail');
});

// ── operatorSummary ──────────────────────────────────────────────────

test('operatorSummary: safe state', () => {
  const sc = buildSafetyCase(safeInputs());
  assert.match(sc.operatorSummary, /operating safely/i);
});

test('operatorSummary: unsafe state with fail count', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: { signals: [{ id: 'b1', severity: 'alert' }] },
    feedHealth: { earthquake: 'down', weather: 'healthy', maritime: 'healthy' },
  }));
  assert.match(sc.operatorSummary, /failing/i);
  assert.match(sc.operatorSummary, /\b2\b/); // 2 fails (bias + feed)
});

test('operatorSummary: warn state', () => {
  const sc = buildSafetyCase(safeInputs({
    biasReport: { signals: [{ id: 'b1', severity: 'warning' }] },
  }));
  assert.match(sc.operatorSummary, /warn/i);
});

// ── History + persistence ────────────────────────────────────────────

test('evaluate() stores into history and getLatest returns it', () => {
  const svc = freshService();
  const sc = svc.evaluate(safeInputs());
  assert.ok(sc.generatedAt instanceof Date);
  assert.equal(svc.getLatest()?.overallStatus, sc.overallStatus);
  assert.equal(svc.getHistory().length, 1);
});

test('evaluate() returns defensive copies — mutating result does not change the store', () => {
  const svc = freshService();
  const a = svc.evaluate(safeInputs());
  a.properties[0]!.status = 'fail'; // try to mutate
  const b = svc.getLatest();
  assert.notEqual(b!.properties[0]!.status, 'fail');
});

test('persisted history survives a fresh instance hydrating from localStorage', () => {
  const a = freshService();
  a.evaluate(safeInputs());
  const b = new SafetyCaseService({ clock: () => NOW });
  assert.equal(b.getHistory().length, 1);
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetSafetyCaseSingleton();
  __storage.set(caseInternals.STORAGE_KEY, '{not valid');
  const svc = new SafetyCaseService({ clock: () => NOW });
  assert.deepEqual(svc.getHistory(), []);
});

test('ring buffer at MAX_RECORDS + 1 drops oldest', () => {
  const svc = freshService();
  const max = caseInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    svc.evaluate(safeInputs({ humanReviewBacklog: i }));
  }
  assert.equal(svc.getHistory().length, max);
});

// ── Subscribe ────────────────────────────────────────────────────────

test('subscribe fires on each evaluate()', () => {
  const svc = freshService();
  let count = 0;
  svc.subscribe(() => { count += 1; });
  svc.evaluate(safeInputs());
  svc.evaluate(safeInputs());
  assert.equal(count, 2);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.evaluate(safeInputs());
  assert.equal(secondCalled, true);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getSafetyCaseService() returns a stable singleton', () => {
  __storage.clear();
  __resetSafetyCaseSingleton();
  const a = getSafetyCaseService();
  const b = getSafetyCaseService();
  assert.strictEqual(a, b);
});
