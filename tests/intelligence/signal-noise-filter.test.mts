import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SignalNoiseFilter, STORAGE_KEY, MAX_SCORES,
  type SignalScore, type StorageLike,
} from '../../src/services/intelligence/signal-noise-filter.ts';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, value); },
    removeItem(key) { store.delete(key); },
  };
}

const BASE_NOW = new Date('2026-05-20T12:00:00Z').getTime();
function makeFilter(nowMs = BASE_NOW, storage?: StorageLike) {
  SignalNoiseFilter._resetSingletonForTests();
  return new SignalNoiseFilter({ storage: storage ?? createMemoryStorage(), now: () => nowMs });
}

// ── Constants ─────────────────────────────────────────────────────────────

test('STORAGE_KEY === "wm-signal-noise"', () => {
  assert.equal(STORAGE_KEY, 'wm-signal-noise');
});

test('MAX_SCORES === 2000', () => {
  assert.equal(MAX_SCORES, 2000);
});

// ── Singleton ─────────────────────────────────────────────────────────────

test('getInstance() returns the same instance twice', () => {
  SignalNoiseFilter._resetSingletonForTests();
  const a = SignalNoiseFilter.getInstance();
  const b = SignalNoiseFilter.getInstance();
  assert.strictEqual(a, b);
  SignalNoiseFilter._resetSingletonForTests();
});

test('_resetSingletonForTests() breaks identity', () => {
  SignalNoiseFilter._resetSingletonForTests();
  const a = SignalNoiseFilter.getInstance();
  SignalNoiseFilter._resetSingletonForTests();
  const b = SignalNoiseFilter.getInstance();
  assert.notStrictEqual(a, b);
  SignalNoiseFilter._resetSingletonForTests();
});

// ── score() — sourceCount factor ──────────────────────────────────────────

test('undefined sourceCount → sourceCount factor value === 0.3', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test' });
  const factor = result.factors.find(x => x.name === 'sourceCount')!;
  assert.equal(factor.value, 0.3);
});

test('sourceCount=1 → sourceCount factor value === 0.3', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 1 });
  const factor = result.factors.find(x => x.name === 'sourceCount')!;
  assert.equal(factor.value, 0.3);
});

test('sourceCount=2 → sourceCount factor value === 0.6', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 2 });
  const factor = result.factors.find(x => x.name === 'sourceCount')!;
  assert.equal(factor.value, 0.6);
});

test('sourceCount=3 → sourceCount factor value === 1.0', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 3 });
  const factor = result.factors.find(x => x.name === 'sourceCount')!;
  assert.equal(factor.value, 1.0);
});

// ── score() — corroboration factor ────────────────────────────────────────

test('undefined corroborationCount → corroboration factor value === 0.1', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test' });
  const factor = result.factors.find(x => x.name === 'corroboration')!;
  assert.equal(factor.value, 0.1);
});

test('corroborationCount=0 → corroboration factor value === 0.1', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', corroborationCount: 0 });
  const factor = result.factors.find(x => x.name === 'corroboration')!;
  assert.equal(factor.value, 0.1);
});

test('corroborationCount=1 → corroboration factor value === 0.4', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', corroborationCount: 1 });
  const factor = result.factors.find(x => x.name === 'corroboration')!;
  assert.equal(factor.value, 0.4);
});

test('corroborationCount=2 → corroboration factor value === 0.7', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', corroborationCount: 2 });
  const factor = result.factors.find(x => x.name === 'corroboration')!;
  assert.equal(factor.value, 0.7);
});

test('corroborationCount=3 → corroboration factor value === 1.0', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', corroborationCount: 3 });
  const factor = result.factors.find(x => x.name === 'corroboration')!;
  assert.equal(factor.value, 1.0);
});

// ── score() — recency factor ──────────────────────────────────────────────

test('undefined ageMs → recency factor value === 1.0', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test' });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 1.0);
});

test('ageMs=0 → recency factor value === 1.0', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', ageMs: 0 });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 1.0);
});

test('ageMs < 5min → recency factor value === 1.0', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', ageMs: 4 * 60_000 });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 1.0);
});

test('ageMs = 30min exactly → recency factor value === 0.4 (30min is NOT < 30min)', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', ageMs: 30 * 60_000 });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 0.4);
});

test('ageMs < 30min → recency factor value === 0.7', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', ageMs: 29 * 60_000 });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 0.7);
});

test('ageMs < 2h → recency factor value === 0.4', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', ageMs: 90 * 60_000 });
  const factor = result.factors.find(x => x.name === 'recency')!;
  assert.equal(factor.value, 0.4);
});

// ── score() — signalScore + isSignal ─────────────────────────────────────

test('all factors max → signalScore === 1.0, isSignal === true', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 3, corroborationCount: 3, ageMs: 0 });
  assert.equal(result.signalScore, 1.0);
  assert.equal(result.isSignal, true);
});

test('all factors min → signalScore low, isSignal === false', () => {
  const f = makeFilter();
  // sourceCount=1→0.3, corroboration=0→0.1, ageMs=old→0.1
  // 0.3*0.3 + 0.4*0.1 + 0.3*0.1 = 0.09 + 0.04 + 0.03 = 0.16
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 1, corroborationCount: 0, ageMs: 3 * 60 * 60_000 });
  assert.equal(result.signalScore, 0.16);
  assert.equal(result.isSignal, false);
});

test('noiseScore === parseFloat((1 - signalScore).toFixed(4))', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 2, corroborationCount: 1, ageMs: 10 * 60_000 });
  assert.equal(result.noiseScore, parseFloat((1 - result.signalScore).toFixed(4)));
});

test('confidence === signalScore', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 2, corroborationCount: 2, ageMs: 0 });
  assert.equal(result.confidence, result.signalScore);
});

test('factors array has exactly 3 entries with correct names', () => {
  const f = makeFilter();
  const result = f.score({ id: 'a', domain: 'test' });
  assert.equal(result.factors.length, 3);
  assert.equal(result.factors[0].name, 'sourceCount');
  assert.equal(result.factors[1].name, 'corroboration');
  assert.equal(result.factors[2].name, 'recency');
});

test('2 sources, 2 corroboration, 10min age → signalScore === 0.67, isSignal === true', () => {
  const f = makeFilter();
  // sourceCount=2→0.6, corroboration=2→0.7, ageMs=10min→0.7
  // 0.3*0.6 + 0.4*0.7 + 0.3*0.7 = 0.18 + 0.28 + 0.21 = 0.67
  const result = f.score({ id: 'a', domain: 'test', sourceCount: 2, corroborationCount: 2, ageMs: 10 * 60_000 });
  assert.equal(result.signalScore, 0.67);
  assert.equal(result.isSignal, true);
});

// ── batchScore ────────────────────────────────────────────────────────────

test('batchScore([]) returns []', () => {
  const f = makeFilter();
  assert.deepEqual(f.batchScore([]), []);
});

test('batchScore([obs1, obs2]) returns 2 SignalScore objects', () => {
  const f = makeFilter();
  const results = f.batchScore([
    { id: 'x1', domain: 'test', sourceCount: 1 },
    { id: 'x2', domain: 'test', sourceCount: 3 },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].observationId, 'x1');
  assert.equal(results[1].observationId, 'x2');
});

// ── getStats ──────────────────────────────────────────────────────────────

test('getStats() on empty filter → { totalScored:0, signalCount:0, noiseCount:0, avgSignalScore:0 }', () => {
  const f = makeFilter();
  assert.deepEqual(f.getStats(), { totalScored: 0, signalCount: 0, noiseCount: 0, avgSignalScore: 0 });
});

test('getStats() after scoring one signal + one noise → correct counts', () => {
  const f = makeFilter();
  // signal: 3 sources, 3 corroboration, 0 age → signalScore=1.0
  f.score({ id: 'sig', domain: 'test', sourceCount: 3, corroborationCount: 3, ageMs: 0 });
  // noise: 1 source, 0 corroboration, old → signalScore=0.16
  f.score({ id: 'noise', domain: 'test', sourceCount: 1, corroborationCount: 0, ageMs: 3 * 60 * 60_000 });
  const stats = f.getStats();
  assert.equal(stats.totalScored, 2);
  assert.equal(stats.signalCount, 1);
  assert.equal(stats.noiseCount, 1);
});

test('avgSignalScore is correctly averaged', () => {
  const f = makeFilter();
  f.score({ id: 'a', domain: 'test', sourceCount: 3, corroborationCount: 3, ageMs: 0 }); // 1.0
  f.score({ id: 'b', domain: 'test', sourceCount: 1, corroborationCount: 0, ageMs: 3 * 60 * 60_000 }); // 0.16
  const stats = f.getStats();
  // avg = (1.0 + 0.16) / 2 = 0.58
  assert.equal(stats.avgSignalScore, parseFloat(((1.0 + 0.16) / 2).toFixed(4)));
});

// ── getScore ──────────────────────────────────────────────────────────────

test('getScore() on unknown id → undefined', () => {
  const f = makeFilter();
  assert.equal(f.getScore('nonexistent'), undefined);
});

test('getScore() after scoring → returns correct SignalScore', () => {
  const f = makeFilter();
  const scored = f.score({ id: 'known', domain: 'weather', sourceCount: 2, corroborationCount: 1, ageMs: 0 });
  const retrieved = f.getScore('known');
  assert.ok(retrieved);
  assert.equal(retrieved.observationId, 'known');
  assert.equal(retrieved.signalScore, scored.signalScore);
});

// ── Persistence ───────────────────────────────────────────────────────────

test('score() persists; new filter with same storage hydrates the score', () => {
  const storage = createMemoryStorage();
  const f1 = makeFilter(BASE_NOW, storage);
  const scored = f1.score({ id: 'persist-me', domain: 'test', sourceCount: 3, corroborationCount: 2, ageMs: 0 });

  SignalNoiseFilter._resetSingletonForTests();
  const f2 = new SignalNoiseFilter({ storage, now: () => BASE_NOW });
  const retrieved = f2.getScore('persist-me');
  assert.ok(retrieved);
  assert.equal(retrieved.signalScore, scored.signalScore);
  assert.equal(retrieved.isSignal, scored.isSignal);
});

test('clear() persists empty state', () => {
  const storage = createMemoryStorage();
  const f1 = makeFilter(BASE_NOW, storage);
  f1.score({ id: 'will-be-cleared', domain: 'test' });
  f1.clear();

  SignalNoiseFilter._resetSingletonForTests();
  const f2 = new SignalNoiseFilter({ storage, now: () => BASE_NOW });
  assert.equal(f2.getStats().totalScored, 0);
});

// ── clear ─────────────────────────────────────────────────────────────────

test('getStats().totalScored === 0 after clear()', () => {
  const f = makeFilter();
  f.score({ id: 'a', domain: 'test' });
  f.score({ id: 'b', domain: 'test' });
  f.clear();
  assert.equal(f.getStats().totalScored, 0);
});
