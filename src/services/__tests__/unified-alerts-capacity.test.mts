import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const NOW = 1_790_000_000_000;
const STORAGE_KEY = 'wm-unified-alerts-v1';
const values = new Map<string, string>();
let writes = 0;
let archived: UnifiedAlert[][] = [];
let dispatched: string[] = [];
Object.assign(globalThis, {
  window: {},
  requestAnimationFrame: () => 0,
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; values.set(key, value); },
    removeItem: (key: string) => values.delete(key),
  },
});

const { UnifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { alertDB } = await import('../alert-store.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
_setNotifyThrottleForTest(0);

beforeEach((t) => {
  values.clear();
  writes = 0;
  archived = [];
  dispatched = [];
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(alertDB, 'putBatch', async (batch: UnifiedAlert[]) => { archived.push(batch); });
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert) => {
    dispatched.push(alert.id);
  });
});

function alert(id: string, overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id, source: 'nws', severity: 'high', title: id, body: 'Capacity fixture',
    timestamp: NOW - 60_000, relevanceScore: 90, acknowledged: false, pinned: false,
    ...overrides,
  };
}

function batch(count: number, prefix: string, overrides: Partial<UnifiedAlert> = {}): UnifiedAlert[] {
  return Array.from({ length: count }, (_, i) => alert(`${prefix}-${i}`, {
    timestamp: NOW - 30_000 + i, ...overrides,
  }));
}

function ids(store: InstanceType<typeof UnifiedAlertStore>): string[] {
  return store.getAll().map((entry) => entry.id);
}

test('502 mixed alerts retain the pinned and unacknowledged alerts over acknowledged alerts', () => {
  const store = new UnifiedAlertStore();
  store.ingest([
    alert('pinned', { pinned: true, acknowledged: true }),
    alert('unhandled'),
    ...batch(500, 'ack', { acknowledged: true }),
  ]);
  store._flushNowForTest();
  assert.deepEqual(ids(store), ['pinned', 'unhandled', ...Array.from({ length: 498 }, (_, i) => `ack-${i + 2}`)]);
});

test('501 alerts retain the existing deferred enforcement and evict the acknowledged item on flush', () => {
  const store = new UnifiedAlertStore();
  store.ingest([...batch(500, 'unhandled'), alert('ack', { acknowledged: true, timestamp: NOW })]);
  assert.equal(store.getAll().length, 501);
  assert.equal(writes, 0);
  store._flushNowForTest();
  assert.deepEqual(ids(store), batch(500, 'unhandled').map((entry) => entry.id));
  assert.equal(writes, 1);
});

test('1001 alerts enforce the same priority immediately and persist only the retained 500', () => {
  const store = new UnifiedAlertStore();
  store.ingest([
    alert('pinned', { pinned: true }),
    ...batch(500, 'unhandled'),
    ...batch(500, 'ack', { acknowledged: true, timestamp: NOW }),
  ]);
  const expected = ['pinned', ...Array.from({ length: 499 }, (_, i) => `unhandled-${i + 1}`)];
  assert.deepEqual(ids(store), expected);
  assert.equal(writes, 0);
  store._flushNowForTest();
  assert.deepEqual(ids(store), expected);
  assert.deepEqual((JSON.parse(values.get(STORAGE_KEY)!) as UnifiedAlert[]).map((entry) => entry.id), expected);
});

test('exactly 500 fresh alerts survive capacity enforcement unchanged', () => {
  const store = new UnifiedAlertStore();
  const incoming = batch(500, 'exact').map((entry, i) => ({ ...entry, acknowledged: i % 2 === 0, pinned: i % 3 === 0 }));
  store.ingest(incoming);
  store._flushNowForTest();
  assert.deepEqual(store.getAll(), incoming);
});

for (const [group, overrides] of [
  ['acknowledged', { acknowledged: true }],
  ['unacknowledged', {}],
  ['pinned', { pinned: true }],
] as const) {
  test(`capacity removes the oldest source timestamp within the ${group} group, not the earliest insertion`, () => {
    const store = new UnifiedAlertStore();
    const incoming = [
      alert('newest-first', { ...overrides, timestamp: NOW }),
      ...batch(499, 'middle', overrides),
      alert('oldest-last', { ...overrides, timestamp: NOW - 120_000 }),
    ];
    store.ingest(incoming);
    store._flushNowForTest();
    assert.deepEqual(ids(store), incoming.slice(0, 500).map((entry) => entry.id));
  });
}

test('all-pinned overflow uses age regardless of acknowledgment in either direction', () => {
  for (const oldestAcknowledged of [false, true]) {
    values.clear();
    const store = new UnifiedAlertStore();
    const kept = batch(500, 'pinned', { pinned: true, acknowledged: !oldestAcknowledged });
    store.ingest([...kept, alert('oldest', { pinned: true, acknowledged: oldestAcknowledged })]);
    store._flushNowForTest();
    assert.deepEqual(ids(store), kept.map((entry) => entry.id));
  }
});

test('equal timestamps evict the earlier insertion and same-ID updates retain its tie position and user state', () => {
  const store = new UnifiedAlertStore();
  const incoming = batch(501, 'tie', { timestamp: NOW, acknowledged: true, pinned: true });
  store.ingest(incoming);
  store.ingest([alert('tie-0', { timestamp: NOW, title: 'Updated source title' })]);
  const updated = store.getAll()[0]!;
  assert.equal(updated.title, 'Updated source title');
  assert.equal(updated.acknowledged, true);
  assert.equal(updated.pinned, true);
  assert.equal(store.getAll().length, 501);
  assert.equal(dispatched.length, 501, 'updating an existing identity must not dispatch a second notification');
  store._flushNowForTest();
  assert.deepEqual(ids(store), incoming.slice(1).map((entry) => entry.id));
});

test('retained IDs, order and user state survive reload without hydration writes or notifications', () => {
  const store = new UnifiedAlertStore();
  const incoming = [
    alert('pin', { pinned: true, acknowledged: true }),
    alert('unhandled'),
    ...batch(500, 'ack', { acknowledged: true }),
  ];
  store.ingest(incoming);
  store._flushNowForTest();
  const expected = ['pin', 'unhandled', ...Array.from({ length: 498 }, (_, i) => `ack-${i + 2}`)];
  const persisted = JSON.parse(values.get(STORAGE_KEY)!) as UnifiedAlert[];
  assert.deepEqual(persisted.map((entry) => entry.id), expected);
  assert.deepEqual(persisted, store.getAll());
  const before = { writes, notifications: dispatched.length, archives: archived.length };
  const reloaded = new UnifiedAlertStore();
  reloaded._flushNowForTest();
  assert.deepEqual(reloaded.getAll(), persisted);
  assert.deepEqual({ writes, notifications: dispatched.length, archives: archived.length }, before);
});

test('capacity evictions preserve all incoming alerts in the existing archive batch', () => {
  const store = new UnifiedAlertStore();
  const incoming = [alert('unhandled'), ...batch(500, 'ack', { acknowledged: true })];
  store.ingest(incoming.slice(0, 200));
  store.ingest(incoming.slice(200));
  assert.equal(archived.length, 0);
  store._flushNowForTest();
  assert.equal(store.getAll().length, 500);
  assert.ok(!ids(store).includes('ack-0'));
  assert.equal(archived.length, 1);
  assert.deepEqual(archived[0], incoming);
  assert.deepEqual(dispatched, incoming.map((entry) => entry.id));
});
