/**
 * Tests for ShadowModeAlgorithmService — A/B comparison ledger that
 * runs intelligence algorithms in "shadow" alongside their live
 * counterpart and persists divergence data.
 *
 * The service is built with injectable storage + clock, so the tests
 * never touch real localStorage / Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ShadowModeAlgorithmService,
  COMPARISONS_STORAGE_KEY,
  MAX_COMPARISONS_PER_RUN,
  MAX_COMPARISONS_TOTAL,
  RUNS_STORAGE_KEY,
  __internals,
  __resetShadowModeAlgorithmServiceSingleton,
  getShadowModeAlgorithmService,
  hashInput,
  type ShadowComparison,
  type StorageLike,
} from '../../src/services/intelligence/shadow-mode.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
  getCount: number;
  setCount: number;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  const wrap = {
    raw,
    getCount: 0,
    setCount: 0,
    getItem(key: string): string | null {
      this.getCount += 1;
      return raw.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      this.setCount += 1;
      raw.set(key, value);
    },
    removeItem(key: string): void {
      raw.delete(key);
    },
  };
  return wrap;
}

function makeClock(start = 1_745_000_000_000): () => number {
  let t = start;
  return () => {
    t += 1000;
    return t;
  };
}

const NOW = 1_745_000_000_000;

// ── Run registry ──────────────────────────────────────────────────────

test('register stores a new run and returns a defensive copy', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  const cfg = svc.register({
    id: 'run-1', algorithmId: 'truth-score', description: 'baseline vs v2',
    enabled: true, createdAt: 0,
  });
  assert.equal(cfg.id, 'run-1');
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.createdAt, NOW, 'falsy createdAt should default to clock()');
  cfg.enabled = false;
  assert.equal(svc.getRun('run-1')?.enabled, true, 'caller mutation must not leak in');
});

test('register preserves an explicit createdAt', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  const cfg = svc.register({
    id: 'run-x', algorithmId: 'a', description: 'd', enabled: false, createdAt: 999,
  });
  assert.equal(cfg.createdAt, 999);
});

test('register on the same id replaces and keeps order stable', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.register({ id: 'a', algorithmId: 'A', description: '', enabled: true, createdAt: 1 });
  svc.register({ id: 'b', algorithmId: 'B', description: '', enabled: true, createdAt: 2 });
  svc.register({ id: 'a', algorithmId: 'A', description: 'updated', enabled: false, createdAt: 1 });
  const all = svc.getAllRuns();
  assert.deepEqual(all.map((r) => r.id), ['a', 'b']);
  assert.equal(all[0]!.description, 'updated');
  assert.equal(all[0]!.enabled, false);
});

test('enable and disable toggle the flag', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: false, createdAt: 1 });
  const enabled = svc.enable('r');
  assert.equal(enabled?.enabled, true);
  const disabled = svc.disable('r');
  assert.equal(disabled?.enabled, false);
});

test('enable returns undefined when the run is unknown', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  assert.equal(svc.enable('missing'), undefined);
  assert.equal(svc.disable('missing'), undefined);
});

test('enable is a no-op when already enabled (still returns the config)', () => {
  const storage = makeFakeStorage();
  const svc = new ShadowModeAlgorithmService({ storage, clock: () => NOW });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 1 });
  const before = storage.setCount;
  const result = svc.enable('r');
  assert.equal(result?.enabled, true);
  assert.equal(storage.setCount, before, 'no-op toggle should skip persistence');
});

test('getRun and getAllRuns return defensive copies', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 1 });
  const one = svc.getRun('r')!;
  one.enabled = false;
  assert.equal(svc.getRun('r')?.enabled, true);
  const all = svc.getAllRuns();
  all[0]!.description = 'mut';
  assert.equal(svc.getAllRuns()[0]!.description, '');
});

// ── Compare ───────────────────────────────────────────────────────────

test('compare with identical outputs records no divergence', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmp = svc.compare('r', { x: 1 }, { score: 0.8 }, { score: 0.8 });
  assert.equal(cmp.diverged, false);
  assert.equal(cmp.divergenceScore, 0);
  assert.equal(cmp.algorithmId, 'a');
  assert.equal(cmp.runId, 'r');
});

test('compare with differing outputs flags diverged and scores in (0,1]', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmp = svc.compare('r', { x: 1 }, { score: 0.8, label: 'med' }, { score: 0.9, label: 'med' });
  assert.equal(cmp.diverged, true);
  assert.ok(cmp.divergenceScore > 0 && cmp.divergenceScore <= 1);
  // 1 of 2 leaves differs → 0.5.
  assert.equal(cmp.divergenceScore, 0.5);
});

test('compare with completely different primitives scores 1.0', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmp = svc.compare('r', 'i', 1, 2);
  assert.equal(cmp.diverged, true);
  assert.equal(cmp.divergenceScore, 1);
});

test('compare on a disabled run still returns a comparison but skips persistence', () => {
  const storage = makeFakeStorage();
  const svc = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: false, createdAt: 0 });
  const setsBefore = storage.setCount;
  const cmp = svc.compare('r', { x: 1 }, 1, 2);
  assert.equal(cmp.diverged, true);
  assert.equal(svc.getComparisons('r').length, 0);
  assert.equal(storage.setCount, setsBefore, 'disabled run must not write to storage');
});

test('compare on an unregistered run uses runId as fallback algorithmId and does not persist', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  const cmp = svc.compare('ghost', null, 'a', 'b');
  assert.equal(cmp.algorithmId, 'ghost');
  assert.equal(cmp.diverged, true);
  assert.equal(svc.getComparisons('ghost').length, 0);
});

test('compare returns a defensive copy', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmp = svc.compare('r', { x: 1 }, { ok: true }, { ok: true });
  cmp.diverged = true;
  const fromLedger = svc.getComparisons('r')[0]!;
  assert.equal(fromLedger.diverged, false, 'mutation of returned object must not leak in');
});

test('compare hashes input deterministically across object key orders', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmpA = svc.compare('r', { a: 1, b: 2 }, 0, 0);
  const cmpB = svc.compare('r', { b: 2, a: 1 }, 0, 0);
  assert.equal(cmpA.inputHash, cmpB.inputHash);
});

test('compare ids are unique within a run', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const cmp = svc.compare('r', i, i, i);
    seen.add(cmp.id);
  }
  assert.equal(seen.size, 20);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getComparisons accepts a string runId shorthand', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  svc.register({ id: 'q', algorithmId: 'b', description: '', enabled: true, createdAt: 0 });
  svc.compare('r', 1, 1, 2);
  svc.compare('q', 1, 1, 1);
  const onlyR = svc.getComparisons('r');
  assert.equal(onlyR.length, 1);
  assert.equal(onlyR[0]!.runId, 'r');
});

test('getComparisons filters by algorithmId', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r1', algorithmId: 'truth', description: '', enabled: true, createdAt: 0 });
  svc.register({ id: 'r2', algorithmId: 'pulse', description: '', enabled: true, createdAt: 0 });
  svc.compare('r1', 1, 1, 2);
  svc.compare('r2', 1, 1, 2);
  const rows = svc.getComparisons({ algorithmId: 'truth' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.algorithmId, 'truth');
});

test('getComparisons filters divergedOnly', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  svc.compare('r', 1, 1, 1);
  svc.compare('r', 2, 1, 2);
  svc.compare('r', 3, 1, 1);
  const diverged = svc.getComparisons({ divergedOnly: true });
  assert.equal(diverged.length, 1);
  assert.equal(diverged[0]!.diverged, true);
});

test('getComparisons returns newest-first', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const c1 = svc.compare('r', 1, 1, 2);
  const c2 = svc.compare('r', 2, 1, 2);
  const c3 = svc.compare('r', 3, 1, 2);
  const rows = svc.getComparisons('r');
  assert.deepEqual(rows.map((r) => r.id), [c3.id, c2.id, c1.id]);
});

test('getComparisons honors limit', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  for (let i = 0; i < 10; i += 1) svc.compare('r', i, 1, 2);
  assert.equal(svc.getComparisons('r', 3).length, 3);
  assert.equal(svc.getComparisons('r', 0).length, 0);
});

test('getDivergenceRate is diverged / total to 4 decimals', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  svc.compare('r', 1, 1, 1);
  svc.compare('r', 2, 1, 2);
  svc.compare('r', 3, 1, 2);
  assert.equal(svc.getDivergenceRate('r'), 0.6667);
});

test('getDivergenceRate returns 0 when there are no comparisons', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  assert.equal(svc.getDivergenceRate('r'), 0);
});

test('stats aggregates across all runs', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r1', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  svc.register({ id: 'r2', algorithmId: 'b', description: '', enabled: false, createdAt: 0 });
  svc.compare('r1', 1, 1, 1);
  svc.compare('r1', 2, 1, 2);
  svc.compare('r2', 1, 1, 2); // disabled — should not record
  const s = svc.stats();
  assert.equal(s.totalRuns, 2);
  assert.equal(s.enabledRuns, 1);
  assert.equal(s.totalComparisons, 2);
  assert.equal(s.divergedComparisons, 1);
  assert.equal(s.divergenceRate, 0.5);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe is invoked on each enabled compare', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const seen: ShadowComparison[] = [];
  const off = svc.subscribe((c) => seen.push(c));
  svc.compare('r', 1, 1, 2);
  svc.compare('r', 2, 1, 1);
  off();
  svc.compare('r', 3, 1, 2);
  assert.equal(seen.length, 2);
});

test('subscribe is not invoked for disabled-run compares', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: false, createdAt: 0 });
  let count = 0;
  svc.subscribe(() => { count += 1; });
  svc.compare('r', 1, 1, 2);
  assert.equal(count, 0);
});

test('a listener that throws does not stop other listeners', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad listener'); });
  svc.subscribe(() => { good += 1; });
  svc.compare('r', 1, 1, 2);
  assert.equal(good, 1);
});

test('unsubscribe removes the listener', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  let count = 0;
  const cb = () => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.compare('r', 1, 1, 2);
  assert.equal(count, 0);
});

// ── Ring-buffer eviction ──────────────────────────────────────────────

test('comparisons ring buffer evicts oldest entries past the per-run cap (ACC-402)', () => {
  const svc = new ShadowModeAlgorithmService({ storage: makeFakeStorage(), clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const total = MAX_COMPARISONS_PER_RUN + 25;
  for (let i = 0; i < total; i += 1) svc.compare('r', i, 1, 2);
  const rows = svc.getComparisons('r');
  assert.equal(rows.length, MAX_COMPARISONS_PER_RUN);
  // Newest-first: row 0 should have the highest sequence id.
  assert.ok(rows[0]!.id.endsWith(`-${total}`), `expected newest id to be seq ${total}, got ${rows[0]!.id}`);
  assert.ok(MAX_COMPARISONS_PER_RUN <= MAX_COMPARISONS_TOTAL, 'global ceiling bounds per-run caps');
});

// ── Persistence ───────────────────────────────────────────────────────

test('runs and comparisons survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  svc1.register({ id: 'r', algorithmId: 'a', description: 'persist test', enabled: true, createdAt: 1 });
  svc1.compare('r', { x: 1 }, 1, 2);
  svc1.compare('r', { x: 2 }, 1, 1);

  const svc2 = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  const restored = svc2.getRun('r');
  assert.equal(restored?.description, 'persist test');
  const rows = svc2.getComparisons('r');
  assert.equal(rows.length, 2);
});

test('corrupt runs blob is ignored', () => {
  const storage = makeFakeStorage({ [RUNS_STORAGE_KEY]: 'not-json' });
  const svc = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  assert.deepEqual(svc.getAllRuns(), []);
});

test('corrupt comparisons blob is ignored', () => {
  const storage = makeFakeStorage({ [COMPARISONS_STORAGE_KEY]: 'not-json' });
  const svc = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  assert.deepEqual(svc.getComparisons(), []);
});

test('null storage works (no-op persistence)', () => {
  const svc = new ShadowModeAlgorithmService({ storage: null, clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  const cmp = svc.compare('r', 1, 1, 2);
  assert.equal(cmp.diverged, true);
});

test('resetForTesting clears state and removes persisted blobs', () => {
  const storage = makeFakeStorage();
  const svc = new ShadowModeAlgorithmService({ storage, clock: makeClock() });
  svc.register({ id: 'r', algorithmId: 'a', description: '', enabled: true, createdAt: 0 });
  svc.compare('r', 1, 1, 2);
  svc.resetForTesting();
  assert.equal(svc.getAllRuns().length, 0);
  assert.equal(svc.getComparisons().length, 0);
  assert.equal(storage.raw.has(RUNS_STORAGE_KEY), false);
  assert.equal(storage.raw.has(COMPARISONS_STORAGE_KEY), false);
});

// ── Hash + helpers ────────────────────────────────────────────────────

test('hashInput is deterministic across calls', () => {
  assert.equal(hashInput({ a: 1, b: [1, 2] }), hashInput({ b: [1, 2], a: 1 }));
});

test('hashInput differs for different inputs', () => {
  assert.notEqual(hashInput({ a: 1 }), hashInput({ a: 2 }));
});

test('fnv1aHex produces an 8-char hex string', () => {
  const out = __internals.fnv1aHex('hello');
  assert.match(out, /^[0-9a-f]{8}$/);
});

test('deepEqual handles arrays of different lengths', () => {
  assert.equal(__internals.deepEqual([1, 2, 3], [1, 2]), false);
});

test('deepEqual treats null vs object as different', () => {
  assert.equal(__internals.deepEqual(null, {}), false);
  assert.equal(__internals.deepEqual({ a: 1 }, null), false);
});

test('divergenceScore is 0 for fully equal objects', () => {
  assert.equal(__internals.divergenceScore({ a: 1, b: 2 }, { a: 1, b: 2 }), 0);
});

test('divergenceScore counts missing keys as divergence', () => {
  const score = __internals.divergenceScore({ a: 1, b: 2 }, { a: 1 });
  assert.ok(score > 0 && score <= 1);
});

test('divergenceScore handles nested arrays', () => {
  // 1 leaf differs out of 3 → 1/3 ≈ 0.3333.
  assert.equal(__internals.divergenceScore({ x: [1, 2, 3] }, { x: [1, 2, 4] }), 0.3333);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getShadowModeAlgorithmService returns the same instance', () => {
  __resetShadowModeAlgorithmServiceSingleton();
  const a = getShadowModeAlgorithmService();
  const b = getShadowModeAlgorithmService();
  assert.equal(a, b);
  __resetShadowModeAlgorithmServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getShadowModeAlgorithmService();
  __resetShadowModeAlgorithmServiceSingleton();
  const b = getShadowModeAlgorithmService();
  assert.notEqual(a, b);
  __resetShadowModeAlgorithmServiceSingleton();
});
