import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AssumptionTrackerService,
  STORAGE_KEY_ASSUMPTIONS,
  type Assumption,
  type AssumptionStorage,
} from '../assumption-tracker-v2.ts';

/** Storage stub that counts persist passes. A single persist() writes several
 *  keys, so we count writes to the assumptions key — one per persist pass —
 *  which makes the coalescing invariant independent of key count. */
function countingStorage(): AssumptionStorage & { passes: number } {
  const map = new Map<string, string>();
  return {
    passes: 0,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      if (key === STORAGE_KEY_ASSUMPTIONS) this.passes += 1;
      map.set(key, value);
    },
    removeItem(key) { map.delete(key); },
  };
}

function draft(over: Partial<Assumption> = {}): Omit<Assumption, 'id' | 'status' | 'createdAt'> {
  return {
    label: 'grid holds',
    rationale: 'no active outages',
    algorithmId: 'alg-1',
    outputId: 'out-1',
    domain: 'energy',
    confidence: 'medium',
    ...over,
  };
}

// ── The regression under test: the "stringify storm" fix ──────────────────
// Each mutation used to call persist() synchronously, so a burst of N
// mutations meant N full JSON.stringify writes on the hot path. schedulePersist
// must coalesce a synchronous burst into exactly one write on the next
// microtask, while keeping in-memory state immediately consistent.

test('register burst: no synchronous writes, exactly one after microtask flush', async () => {
  const storage = countingStorage();
  const svc = new AssumptionTrackerService({ storage, clock: () => 1_000 });

  for (let i = 0; i < 500; i++) svc.register(draft({ outputId: `out-${i}` }));

  // In-memory state is synchronous and complete...
  assert.equal(svc.getAssumptions().length, 500);
  // ...but the 500-pass stringify storm has NOT hit storage yet.
  assert.equal(storage.passes, 0, 'burst must not persist synchronously');

  await Promise.resolve(); // drain the queued persist microtask

  assert.equal(storage.passes, 1, 'burst must coalesce to a single persist pass');
});

test('persist flag resets: a later mutation schedules a fresh write', async () => {
  const storage = countingStorage();
  const svc = new AssumptionTrackerService({ storage, clock: () => 1_000 });

  svc.register(draft());
  await Promise.resolve();
  assert.equal(storage.passes, 1);

  svc.register(draft({ outputId: 'out-later' }));
  await Promise.resolve();
  assert.equal(storage.passes, 2, 'a new burst after flush must persist again');
});

test('mixed mutators in one burst still coalesce to one write', async () => {
  const storage = countingStorage();
  const svc = new AssumptionTrackerService({ storage, clock: () => 1_000 });

  const a = svc.register(draft());
  svc.violate(a.id, 'contradicted by outage', 'critical');
  svc.register(draft({ outputId: 'out-2' }));

  assert.equal(storage.passes, 0);
  await Promise.resolve();
  assert.equal(storage.passes, 1, 'register + violate + register share one persist pass');
});
