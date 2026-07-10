import assert from 'node:assert/strict';
import test from 'node:test';

import { AlgoEvalLedger } from '../algo-eval-ledger.ts';

function mkLedger(clock: () => number) {
  const l = new AlgoEvalLedger({ clock });
  l.resetForTesting();
  return l;
}

test('resolve fills outcome, drives accuracy off 0, and updates the rollup', () => {
  let now = 1000;
  const l = mkLedger(() => now);
  const a = l.record({ algorithmId: 'driver-scorer', domain: 'weather', inputHash: 'w:1', predictedValue: 'low', predictedAt: new Date(now) });
  const b = l.record({ algorithmId: 'driver-scorer', domain: 'weather', inputHash: 'w:2', predictedValue: 'low', predictedAt: new Date(now) });

  l.resolve(a.id, 'low');   // correct
  l.resolve(b.id, 'high');  // wrong

  const stats = l.getStats('driver-scorer', 'weather');
  assert.equal(stats.resolvedCount, 2);
  assert.equal(stats.accuracy, 0.5);
  const rollup = l.getRollup('driver-scorer', 'weather');
  assert.deepEqual(rollup, { resolved: 2, correct: 1, expired: 0, errorSum: 0, errorCount: 0 });
});

test('expire marks the prediction, excludes it from pending + accuracy, counts in rollup', () => {
  let now = 1000;
  const l = mkLedger(() => now);
  const a = l.record({ algorithmId: 'driver-scorer', domain: 'cyber', inputHash: 'c:1', predictedValue: 'low', predictedAt: new Date(now) });
  l.expire(a.id);

  assert.equal(l.getUnresolved().length, 0, 'expired prediction is not pending');
  const stats = l.getStats('driver-scorer', 'cyber');
  assert.equal(stats.resolvedCount, 0);
  assert.equal(stats.expiredCount, 1);
  assert.equal(stats.accuracy, undefined, 'no resolved records ⇒ no accuracy');
  assert.equal(l.getRollup('driver-scorer', 'cyber')?.expired, 1);
});

test('resolve/expire are no-ops on an already-settled prediction', () => {
  let now = 1000;
  const l = mkLedger(() => now);
  const a = l.record({ algorithmId: 'driver-scorer', domain: 'weather', inputHash: 'w:1', predictedValue: 'low', predictedAt: new Date(now) });
  l.resolve(a.id, 'low');
  l.resolve(a.id, 'high'); // ignored
  l.expire(a.id);          // ignored
  assert.equal(l.getRollup('driver-scorer', 'weather')?.resolved, 1);
  assert.equal(l.getRollup('driver-scorer', 'weather')?.expired, 0);
});

test('rollup survives a hydrate round-trip and legacy array blobs still load', () => {
  const STORAGE_KEY = 'wm-algo-eval-ledger';
  const store: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  } as Storage;
  try {
    let now = 1000;
    const l = new AlgoEvalLedger({ clock: () => now });
    l.resetForTesting();
    const a = l.record({ algorithmId: 'driver-scorer', domain: 'weather', inputHash: 'w:1', predictedValue: 'low', predictedAt: new Date(now) });
    l.resolve(a.id, 'low');
    // New instance hydrates from the persisted { records, rollup } blob.
    const l2 = new AlgoEvalLedger({ clock: () => now });
    assert.equal(l2.getRollup('driver-scorer', 'weather')?.resolved, 1);

    // Legacy bare-array blob still loads (records only, no rollup).
    store[STORAGE_KEY] = JSON.stringify([
      { id: 'x', algorithmId: 'driver-scorer', domain: 'weather', inputHash: 'w:9', predictedValue: 'low', predictedAt: now },
    ]);
    const l3 = new AlgoEvalLedger({ clock: () => now });
    assert.equal(l3.getUnresolved().length, 1);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
