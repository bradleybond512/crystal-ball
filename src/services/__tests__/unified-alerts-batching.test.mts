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

const { unifiedAlertStore, UnifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { alertDB } = await import('../alert-store.ts');
type UnifiedAlert = import('../unified-alerts.ts').UnifiedAlert;

// Existing coalescing tests assert exact notify counts against a setTimeout(0)
// flush; run them with the fan-out throttle disabled (fire immediately, the
// pre-throttle behaviour). A dedicated test below exercises the throttle.
_setNotifyThrottleForTest(0);

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

test('throttles the subscriber fan-out yet always delivers the final state', async () => {
  _setNotifyThrottleForTest(60);
  await new Promise((r) => setTimeout(r, 80)); // ensure the first fan-out is a leading fire
  try {
    let notifyCount = 0;
    let lastObserved = 0; // count of thr-* alerts a SUBSCRIBER saw on its last fan-out
    const unsub = unifiedAlertStore.subscribe(() => {
      notifyCount += 1;
      lastObserved = unifiedAlertStore.getAll().filter((a) => a.id.startsWith('thr-')).length;
    });
    // 5 separate flush cycles ~10 ms apart — all inside one 60 ms throttle window.
    for (let i = 0; i < 5; i++) {
      unifiedAlertStore.ingest([makeAlert(`thr-${i}`)]);
      await new Promise((r) => setTimeout(r, 10));
    }
    const during = notifyCount;
    await new Promise((r) => setTimeout(r, 120)); // let the trailing fan-out fire
    assert.ok(during < 5, `fan-out throttled: only ${during} notifies for 5 flush cycles`);
    assert.ok(notifyCount >= 1, 'the final state is still delivered (trailing fire)');
    assert.equal(lastObserved, 5, 'a subscriber observed the final state (all 5 alerts) via the trailing fan-out');
    unsub();
  } finally {
    _setNotifyThrottleForTest(0);
  }
});

test('unload delivers a pending throttled fan-out synchronously (no lost final state)', async () => {
  _setNotifyThrottleForTest(60);
  await new Promise((r) => setTimeout(r, 80)); // idle → next fan-out is a leading fire
  try {
    let count = 0;
    const unsub = unifiedAlertStore.subscribe(() => { count += 1; });
    unifiedAlertStore.ingest([makeAlert('u-a')]); await flush(); // leading fires
    unifiedAlertStore.ingest([makeAlert('u-b')]); await flush(); // trailing pending, flushDirty=false
    const beforeUnload = count;
    (unifiedAlertStore as unknown as { _flushNowForTest: () => void })._flushNowForTest();
    assert.ok(count > beforeUnload, 'a pending throttled fan-out is force-delivered on unload');
    unsub();
  } finally {
    _setNotifyThrottleForTest(0);
  }
});
