import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal globals so the notification dispatcher (pulled in transitively) is a no-op.
(globalThis as Record<string, unknown>).window = globalThis;

// Counting in-memory localStorage so tests can assert persist coalescing.
const store = new Map<string, string>();
let alertWrites = 0;
const mockLocalStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    if (k.startsWith('wm-unified-alerts')) alertWrites += 1;
    store.set(k, v);
  },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
(globalThis as Record<string, unknown>).localStorage = mockLocalStorage;

const { unifiedAlertStore, UnifiedAlertStore } = await import('../unified-alerts.ts');
const { alertDB } = await import('../alert-store.ts');
type UnifiedAlert = import('../unified-alerts.ts').UnifiedAlert;

function makeAlert(id: string): UnifiedAlert {
  return {
    id,
    source: 'breaking-news',
    severity: 'medium',
    title: id,
    body: '',
    timestamp: Date.now(), // fresh — anything older than 48h is pruned on ingest
    relevanceScore: 0.5,
    acknowledged: false,
    pinned: false,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('acknowledgeMany coalesces notify into a single subscriber fan-out', async () => {
  const ids = ['ack-a', 'ack-b', 'ack-c', 'ack-d'];
  unifiedAlertStore.ingest(ids.map(makeAlert));
  await flush();

  let notifyCount = 0;
  const unsub = unifiedAlertStore.subscribe(() => { notifyCount += 1; });

  unifiedAlertStore.acknowledgeMany(ids);
  assert.equal(notifyCount, 0, 'notify is deferred, not synchronous');

  await flush();
  assert.equal(notifyCount, 1, 'N acknowledgements collapse to one notify');

  for (const id of ids) {
    const a = unifiedAlertStore.getAll().find((x) => x.id === id);
    assert.equal(a?.acknowledged, true, 'state mutated synchronously');
  }

  unsub();
});

test('acknowledgeMany with no matching alerts does not notify', async () => {
  let count = 0;
  const unsub = unifiedAlertStore.subscribe(() => { count += 1; });

  unifiedAlertStore.acknowledgeMany(['does-not-exist']);
  await flush();
  assert.equal(count, 0);

  unsub();
});

test('multiple mutations in one frame coalesce to a single persist', async () => {
  const ids = ['p-a', 'p-b', 'p-c'];
  unifiedAlertStore.ingest(ids.map(makeAlert));
  await flush();

  const before = alertWrites;
  unifiedAlertStore.acknowledge('p-a');
  unifiedAlertStore.acknowledge('p-b');
  unifiedAlertStore.acknowledge('p-c');
  await flush();

  assert.equal(alertWrites - before, 1, 'three acks in one frame collapse to one persist');
});

test('a mutation during the flush callback schedules a fresh flush', async () => {
  unifiedAlertStore.ingest([makeAlert('re-a'), makeAlert('re-b')]);
  await flush();

  let notifyCount = 0;
  let reentered = false;
  const unsub = unifiedAlertStore.subscribe(() => {
    notifyCount += 1;
    if (!reentered) {
      reentered = true;
      // Mutate from inside notify() — must schedule another flush, not get stuck.
      unifiedAlertStore.acknowledge('re-b');
    }
  });

  unifiedAlertStore.acknowledge('re-a');
  await flush();
  await flush();

  assert.equal(notifyCount, 2, 'reentrant mutation produces a second flush');
  unsub();
});

test('coalesces the IDB archive write to ONE putBatch per burst (no per-ingest clone)', async () => {
  const calls: number[] = [];
  const orig = alertDB.putBatch;
  (alertDB as unknown as { putBatch: (b: UnifiedAlert[]) => Promise<void> }).putBatch =
    async (b: UnifiedAlert[]) => { calls.push(b.length); };
  try {
    unifiedAlertStore.ingest([makeAlert('burst-1')]);
    unifiedAlertStore.ingest([makeAlert('burst-2')]);
    unifiedAlertStore.ingest([makeAlert('burst-3')]);
    await flush();
    assert.equal(calls.length, 1, 'three ingests in one frame collapse to one putBatch');
    assert.equal(calls[0], 3, 'the one putBatch carries every incoming alert');
  } finally {
    (alertDB as unknown as { putBatch: typeof orig }).putBatch = orig;
  }
});

test('persist payload stays bounded to MAX_ALERTS and fast with 5,000 synthetic alerts', async () => {
  const orig = alertDB.putBatch;
  (alertDB as unknown as { putBatch: (b: UnifiedAlert[]) => Promise<void> }).putBatch = async () => {};
  try {
    const big = Array.from({ length: 5000 }, (_, i) => makeAlert(`big-${i}`));
    const t0 = performance.now();
    unifiedAlertStore.ingest(big);
    await flush();
    const dt = performance.now() - t0;

    const raw = store.get('wm-unified-alerts-v1')!;
    const persisted = JSON.parse(raw) as UnifiedAlert[];
    assert.ok(persisted.length <= 500, `persisted payload capped at MAX_ALERTS, got ${persisted.length}`);
    assert.ok(dt < 500, `ingest+flush of 5,000 alerts under budget, took ${dt.toFixed(0)}ms`);
  } finally {
    (alertDB as unknown as { putBatch: typeof orig }).putBatch = orig;
  }
});

test('boot rehydrate performs ZERO persists before first paint', () => {
  store.clear();
  store.set('wm-unified-alerts-v1', JSON.stringify([makeAlert('boot-a'), makeAlert('boot-b')]));
  const before = alertWrites;
  const fresh = new UnifiedAlertStore(); // constructor rehydrates from localStorage
  assert.equal(alertWrites - before, 0, 'rehydration must not write to localStorage before first paint');
  assert.equal(fresh.getAll().length, 2, 'rehydrated both alerts into memory');
});

test('flushes via the timer fallback when the document is hidden (rAF is paused)', async () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: () => void) => number;
    document?: { visibilityState: string };
  };
  const savedRaf = g.requestAnimationFrame;
  const savedDoc = g.document;
  // Backgrounded document: rAF is registered but (like a hidden tab) never fires.
  g.requestAnimationFrame = () => 0;
  g.document = { visibilityState: 'hidden' };
  try {
    const before = alertWrites;
    unifiedAlertStore.ingest([makeAlert('hidden-1')]);
    await flush();
    assert.equal(alertWrites - before, 1, 'a hidden-tab ingest still persists via setTimeout, not a paused rAF');
  } finally {
    g.requestAnimationFrame = savedRaf;
    g.document = savedDoc;
  }
});
