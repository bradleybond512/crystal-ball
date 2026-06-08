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

const { unifiedAlertStore } = await import('../unified-alerts.ts');
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
