/**
 * Tests for AlgoEvalLedger — Phase 4 algorithm prediction tracker.
 *
 * Run with: npx tsx --test tests/intelligence/algo-eval-ledger.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
 * Also covers the integration path: outcome-ledger.record() with an
 * alertId resolves a pending driver-scorer prediction.
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
  AlgoEvalLedger,
  __resetAlgoEvalLedgerSingleton,
  buildInputHash,
  getAlgoEvalLedger,
  TREND_WINDOW,
  __internals as ledgerInternals,
  type AlgorithmPrediction,
} from '../../src/services/intelligence/algo-eval-ledger.ts';
import {
  __resetOutcomeLedgerSingleton,
  getOutcomeLedger,
} from '../../src/services/intelligence/outcome-ledger.ts';

const NOW = 1_745_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function freshLedger(now = NOW): AlgoEvalLedger {
  __storage.clear();
  __resetAlgoEvalLedgerSingleton();
  __resetOutcomeLedgerSingleton();
  return new AlgoEvalLedger({ clock: () => now });
}

function record(
  ledger: AlgoEvalLedger,
  overrides: Partial<Omit<AlgorithmPrediction, 'id'>> = {},
): AlgorithmPrediction {
  return ledger.record({
    algorithmId: 'driver-scorer',
    domain: 'weather',
    inputHash: 'weather:obs-1',
    predictedValue: 'high',
    predictedAt: new Date(NOW),
    ...overrides,
  });
}

// ── record() basics ───────────────────────────────────────────────────

test('record() assigns id and preserves predictedAt', () => {
  const ledger = freshLedger();
  const p = record(ledger);
  assert.match(p.id, /^algo-/);
  assert.equal(p.predictedAt.getTime(), NOW);
});

test('record() falls back to ledger clock when predictedAt is omitted', () => {
  const fixedNow = NOW + 12_345;
  const ledger = new AlgoEvalLedger({ clock: () => fixedNow });
  __storage.clear();
  const p = ledger.record({
    algorithmId: 'driver-scorer',
    domain: 'weather',
    inputHash: 'weather:obs-1',
    predictedValue: 0.7,
  } as Omit<AlgorithmPrediction, 'id'>);
  assert.equal(p.predictedAt.getTime(), fixedNow);
});

test('record() shows up in list()', () => {
  const ledger = freshLedger();
  record(ledger, { inputHash: 'a' });
  record(ledger, { inputHash: 'b' });
  assert.equal(ledger.list().length, 2);
});

test('record() returns a defensive copy', () => {
  const ledger = freshLedger();
  const p = record(ledger);
  p.predictedAt.setTime(0);
  assert.equal(ledger.list()[0].predictedAt.getTime(), NOW);
});

// ── resolve() and resolveByInputHash() ────────────────────────────────

test('resolve() fills resolvedValue and resolvedAt', () => {
  const ledger = freshLedger();
  const p = record(ledger, { predictedValue: 'high' });
  ledger.resolve(p.id, 'high');
  const after = ledger.list()[0];
  assert.equal(after.resolvedValue, 'high');
  assert.ok(after.resolvedAt instanceof Date);
});

test('resolve() computes |error| for numeric predictions', () => {
  const ledger = freshLedger();
  const p = record(ledger, { predictedValue: 0.8 });
  ledger.resolve(p.id, 0.5);
  const error = ledger.list()[0].error;
  assert.ok(error !== undefined && Math.abs(error - 0.3) < 1e-9,
    `expected ~0.3, got ${error}`);
});

test('resolve() sets correct=true for matching categorical', () => {
  const ledger = freshLedger();
  const p = record(ledger, { predictedValue: 'high' });
  ledger.resolve(p.id, 'high');
  assert.equal(ledger.list()[0].correct, true);
});

test('resolve() sets correct=false for mismatched categorical', () => {
  const ledger = freshLedger();
  const p = record(ledger, { predictedValue: 'high' });
  ledger.resolve(p.id, 'low');
  assert.equal(ledger.list()[0].correct, false);
});

test('resolve() is a no-op for unknown id', () => {
  const ledger = freshLedger();
  record(ledger);
  ledger.resolve('does-not-exist', 'high');
  assert.equal(ledger.list()[0].resolvedAt, undefined);
});

test('resolve() leaves an already-resolved prediction untouched', () => {
  const ledger = freshLedger();
  const p = record(ledger, { predictedValue: 'high' });
  ledger.resolve(p.id, 'high');
  const firstResolution = ledger.list()[0].resolvedAt!.getTime();
  ledger.resolve(p.id, 'low');
  assert.equal(ledger.list()[0].resolvedValue, 'high');
  assert.equal(ledger.list()[0].resolvedAt!.getTime(), firstResolution);
});

test('resolveByInputHash() matches the oldest unresolved record', () => {
  const ledger = freshLedger();
  const p1 = record(ledger, { inputHash: 'weather:obs-1' });
  record(ledger, { inputHash: 'weather:obs-1' }); // second prediction on same key
  ledger.resolveByInputHash('driver-scorer', 'weather:obs-1', 'high');
  const list = ledger.list();
  assert.equal(list[0].id, p1.id);
  assert.ok(list[0].resolvedAt);
  assert.equal(list[1].resolvedAt, undefined);
});

test('resolveByInputHash() requires algorithmId match', () => {
  const ledger = freshLedger();
  record(ledger, { algorithmId: 'driver-scorer', inputHash: 'weather:obs-1' });
  ledger.resolveByInputHash('some-other-algo', 'weather:obs-1', 'high');
  assert.equal(ledger.list()[0].resolvedAt, undefined);
});

test('resolveByInputHash() is a no-op when no match', () => {
  const ledger = freshLedger();
  record(ledger);
  ledger.resolveByInputHash('driver-scorer', 'nope', 'high');
  assert.equal(ledger.list()[0].resolvedAt, undefined);
});

// ── getStats() ───────────────────────────────────────────────────────

test('getStats: accuracy correct for categorical', () => {
  const ledger = freshLedger();
  for (let i = 0; i < 4; i++) {
    const p = record(ledger, { predictedValue: 'high', inputHash: `wh-${i}` });
    ledger.resolve(p.id, 'high');
  }
  for (let i = 0; i < 6; i++) {
    const p = record(ledger, { predictedValue: 'high', inputHash: `wl-${i}` });
    ledger.resolve(p.id, 'low');
  }
  const stats = ledger.getStats('driver-scorer', 'weather');
  assert.equal(stats.totalPredictions, 10);
  assert.equal(stats.resolvedCount, 10);
  assert.equal(stats.accuracy, 0.4);
});

test('getStats: MAE correct for numeric', () => {
  const ledger = freshLedger();
  const samples: [number, number][] = [[0.8, 0.6], [0.5, 0.5], [0.9, 0.3]];
  for (const [predicted, actual] of samples) {
    const p = record(ledger, { predictedValue: predicted, inputHash: `n-${predicted}-${actual}` });
    ledger.resolve(p.id, actual);
  }
  const stats = ledger.getStats('driver-scorer', 'weather');
  // |0.2| + |0| + |0.6| = 0.8; mean = 0.8/3 ≈ 0.2667
  assert.ok(stats.meanAbsoluteError !== undefined);
  assert.ok(Math.abs(stats.meanAbsoluteError - 0.2666667) < 1e-3,
    `expected ~0.267, got ${stats.meanAbsoluteError}`);
});

test('getStats: filters by domain', () => {
  const ledger = freshLedger();
  record(ledger, { domain: 'weather', inputHash: 'a' });
  record(ledger, { domain: 'cyber', inputHash: 'b' });
  record(ledger, { domain: 'cyber', inputHash: 'c' });
  assert.equal(ledger.getStats('driver-scorer', 'weather').totalPredictions, 1);
  assert.equal(ledger.getStats('driver-scorer', 'cyber').totalPredictions, 2);
});

test('getStats: omitting domain aggregates across all domains', () => {
  const ledger = freshLedger();
  record(ledger, { domain: 'weather', inputHash: 'a' });
  record(ledger, { domain: 'cyber', inputHash: 'b' });
  const stats = ledger.getStats('driver-scorer');
  assert.equal(stats.totalPredictions, 2);
  assert.equal(stats.domain, '*');
});

test('getStats: returns zeros for unknown algorithm', () => {
  const ledger = freshLedger();
  const stats = ledger.getStats('nope');
  assert.equal(stats.totalPredictions, 0);
  assert.equal(stats.resolvedCount, 0);
  assert.equal(stats.trend, 'stable');
});

// ── getAllStats() ────────────────────────────────────────────────────

test('getAllStats: one row per unique (algorithmId, domain) pair', () => {
  const ledger = freshLedger();
  record(ledger, { domain: 'weather', inputHash: 'a' });
  record(ledger, { domain: 'weather', inputHash: 'b' });
  record(ledger, { domain: 'cyber', inputHash: 'c' });
  record(ledger, { algorithmId: 'correlator', domain: 'weather', inputHash: 'd' });
  const all = ledger.getAllStats();
  assert.equal(all.length, 3);
  assert.equal(all[0].totalPredictions, 2); // sorted desc by totalPredictions
});

// ── Trend ────────────────────────────────────────────────────────────

/** Helper for trend tests: a ledger with a monotonically-advancing
 *  clock and a clean localStorage stub so persisted records from earlier
 *  tests can't pollute the resolved-record ordering. */
function trendLedger(): AlgoEvalLedger {
  __storage.clear();
  __resetAlgoEvalLedgerSingleton();
  let tick = NOW;
  return new AlgoEvalLedger({ clock: () => tick++ });
}

test('trend: improving when last-30 accuracy beats prior-30 by threshold', () => {
  const lg = trendLedger();
  // 50% prior accuracy, 90% last accuracy.
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `p${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 15 ? 'x' : 'y'); // 15/30 correct = 0.5
  }
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `l${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 27 ? 'x' : 'y'); // 27/30 correct = 0.9
  }
  assert.equal(lg.getStats('a', 'd').trend, 'improving');
});

test('trend: degrading when last-30 accuracy worse than prior-30 by threshold', () => {
  const lg = trendLedger();
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `p${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 27 ? 'x' : 'y'); // 0.9
  }
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `l${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 15 ? 'x' : 'y'); // 0.5
  }
  assert.equal(lg.getStats('a', 'd').trend, 'degrading');
});

test('trend: stable when last-30 and prior-30 are within threshold', () => {
  const lg = trendLedger();
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `p${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 20 ? 'x' : 'y'); // 0.667
  }
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `l${i}`, predictedValue: 'x' });
    lg.resolve(p.id, i < 21 ? 'x' : 'y'); // 0.700 → delta 0.033, below 0.05 threshold
  }
  assert.equal(lg.getStats('a', 'd').trend, 'stable');
});

test('trend: stable with insufficient samples (<2x TREND_WINDOW)', () => {
  const ledger = freshLedger();
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = record(ledger, { inputHash: `n-${i}` });
    ledger.resolve(p.id, 'high');
  }
  assert.equal(ledger.getStats('driver-scorer', 'weather').trend, 'stable');
});

test('trend: improving on MAE (numeric) when last-30 MAE drops below prior-30 by threshold', () => {
  const lg = trendLedger();
  // Prior 30: |error| = 0.5 each
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `p${i}`, predictedValue: 0.8 });
    lg.resolve(p.id, 0.3);
  }
  // Last 30: |error| = 0.1 each
  for (let i = 0; i < TREND_WINDOW; i++) {
    const p = lg.record({ algorithmId: 'a', domain: 'd', inputHash: `l${i}`, predictedValue: 0.8 });
    lg.resolve(p.id, 0.7);
  }
  assert.equal(lg.getStats('a', 'd').trend, 'improving');
});

// ── getUnresolved() ──────────────────────────────────────────────────

test('getUnresolved() returns only unresolved records', () => {
  const ledger = freshLedger();
  const a = record(ledger, { inputHash: 'a' });
  const b = record(ledger, { inputHash: 'b' });
  ledger.resolve(a.id, 'high');
  const pending = ledger.getUnresolved();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, b.id);
});

test('getUnresolved() filters by algorithmId', () => {
  const ledger = freshLedger();
  record(ledger, { algorithmId: 'a', inputHash: '1' });
  record(ledger, { algorithmId: 'b', inputHash: '2' });
  assert.equal(ledger.getUnresolved('a').length, 1);
  assert.equal(ledger.getUnresolved('b').length, 1);
});

// ── getRecent() ──────────────────────────────────────────────────────

test('getRecent() applies the default 7-day window', () => {
  const ledger = freshLedger();
  record(ledger, { predictedAt: new Date(NOW - 2 * ONE_DAY_MS), inputHash: 'fresh' });
  record(ledger, { predictedAt: new Date(NOW - 10 * ONE_DAY_MS), inputHash: 'stale' });
  const recent = ledger.getRecent();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].inputHash, 'fresh');
});

test('getRecent() filters by algorithmId', () => {
  const ledger = freshLedger();
  record(ledger, { algorithmId: 'a', inputHash: '1' });
  record(ledger, { algorithmId: 'b', inputHash: '2' });
  assert.equal(ledger.getRecent('a').length, 1);
  assert.equal(ledger.getRecent('b').length, 1);
});

// ── Ring buffer + persistence ────────────────────────────────────────

test('ring buffer at MAX_RECORDS + 1 drops oldest', () => {
  const ledger = freshLedger();
  const max = ledgerInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    record(ledger, { inputHash: `k-${i}` });
  }
  const all = ledger.list();
  assert.equal(all.length, max);
  assert.equal(all[0].inputHash, 'k-1');
  assert.equal(all[all.length - 1].inputHash, `k-${max}`);
});

test('persisted records survive a fresh instance hydrating from localStorage', () => {
  freshLedger();
  const a = new AlgoEvalLedger({ clock: () => NOW });
  record(a, { inputHash: 'p1' });
  const b = new AlgoEvalLedger({ clock: () => NOW });
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].inputHash, 'p1');
});

test('corrupt persisted blob does not crash the hydrate path', () => {
  freshLedger();
  __storage.set(ledgerInternals.STORAGE_KEY, '{not valid');
  const ledger = new AlgoEvalLedger({ clock: () => NOW });
  assert.deepEqual(ledger.list(), []);
});

// ── Subscribe ────────────────────────────────────────────────────────

test('subscribe() fires on record() and on resolve()', () => {
  const ledger = freshLedger();
  let count = 0;
  ledger.subscribe(() => { count += 1; });
  const p = record(ledger);
  ledger.resolve(p.id, 'high');
  assert.equal(count, 2);
});

test('subscribe() listener exception is isolated', () => {
  const ledger = freshLedger();
  ledger.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  ledger.subscribe(() => { secondCalled = true; });
  record(ledger);
  assert.equal(secondCalled, true);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getAlgoEvalLedger() returns a stable singleton', () => {
  __resetAlgoEvalLedgerSingleton();
  __storage.clear();
  const a = getAlgoEvalLedger();
  const b = getAlgoEvalLedger();
  assert.strictEqual(a, b);
});

test('buildInputHash composes domain and id with a colon', () => {
  assert.equal(buildInputHash('weather', 'obs-1'), 'weather:obs-1');
});

// ── Integration: outcome-ledger.record() resolves driver-scorer predictions ──

test('outcome-ledger.record() with alertId resolves the matching driver-scorer prediction', () => {
  __storage.clear();
  __resetAlgoEvalLedgerSingleton();
  __resetOutcomeLedgerSingleton();
  const algoLedger = getAlgoEvalLedger();
  algoLedger.record({
    algorithmId: 'driver-scorer',
    domain: 'weather',
    inputHash: buildInputHash('weather', 'alert-1'),
    predictedValue: 'high',
    predictedAt: new Date(NOW),
  });
  getOutcomeLedger().record({
    alertId: 'alert-1',
    domain: 'weather',
    predictedSeverity: 'high',
    actualOutcome: 'confirmed-real',
    recordedAt: new Date(NOW),
  });
  const stats = algoLedger.getStats('driver-scorer', 'weather');
  assert.equal(stats.resolvedCount, 1);
  assert.equal(stats.accuracy, 1);
});

test('outcome-ledger.record() with marked-false-positive resolves prediction to "false-positive"', () => {
  __storage.clear();
  __resetAlgoEvalLedgerSingleton();
  __resetOutcomeLedgerSingleton();
  const algoLedger = getAlgoEvalLedger();
  algoLedger.record({
    algorithmId: 'driver-scorer',
    domain: 'cyber',
    inputHash: buildInputHash('cyber', 'alert-2'),
    predictedValue: 'high',
    predictedAt: new Date(NOW),
  });
  getOutcomeLedger().record({
    alertId: 'alert-2',
    domain: 'cyber',
    predictedSeverity: 'high',
    actualOutcome: 'marked-false-positive',
    recordedAt: new Date(NOW),
  });
  const resolved = algoLedger.list()[0];
  assert.equal(resolved.resolvedValue, 'false-positive');
  assert.equal(resolved.correct, false);
});

test('outcome-ledger.record() without alertId does not crash and leaves predictions pending', () => {
  __storage.clear();
  __resetAlgoEvalLedgerSingleton();
  __resetOutcomeLedgerSingleton();
  const algoLedger = getAlgoEvalLedger();
  algoLedger.record({
    algorithmId: 'driver-scorer',
    domain: 'weather',
    inputHash: buildInputHash('weather', 'alert-x'),
    predictedValue: 'high',
    predictedAt: new Date(NOW),
  });
  getOutcomeLedger().record({
    domain: 'weather',
    predictedSeverity: 'high',
    actualOutcome: 'confirmed-real',
    recordedAt: new Date(NOW),
  });
  // No alertId on the outcome → no join key → prediction remains pending.
  assert.equal(algoLedger.getUnresolved().length, 1);
});
