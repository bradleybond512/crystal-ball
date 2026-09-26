import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const NOW = 1_790_000_000_000;
const KEY = 'wm-unified-alerts-v2';
const values = new Map<string, string>();
let writes = 0;
let failWrites = false;
let corruptWrites = false;
let dispatched: string[] = [];
let snapshots: unknown[] = [];
Object.assign(globalThis, {
  window: {}, requestAnimationFrame: () => 0,
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++;
      if (failWrites) throw new Error('fixture quota failure');
      values.set(key, corruptWrites ? '{}' : value);
    },
  },
});
const { UnifiedAlertStore } = await import('../unified-alerts.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');

beforeEach((t) => {
  values.clear(); writes = 0; failWrites = false; corruptWrites = false;
  dispatched = []; snapshots = [];
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(alertDB, 'putBatch', async () => {});
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert) => {
    dispatched.push(alert.id);
    snapshots.push(JSON.parse(values.get(KEY) ?? 'null'));
  });
});

function alert(id: string, extra: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return { id, source: 'nws', severity: 'high', title: id, body: 'Warning',
    timestamp: NOW - 60_000, relevanceScore: 90, acknowledged: false, pinned: false, ...extra };
}
function churn(store: InstanceType<typeof UnifiedAlertStore>): void {
  store.ingest(Array.from({ length: 500 }, (_, i) => alert(`churn-${i}`, { timestamp: NOW + i })));
  store._flushNowForTest();
}

test('consideration and bounded data are durable before dispatch, one write per ingest batch', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('a'), alert('b')]);
  assert.equal(writes, 1);
  assert.equal(dispatched.length, 2);
  for (const snapshot of snapshots) {
    const envelope = snapshot as { version: number; alerts: UnifiedAlert[]; identities: { entries: { value: { notificationConsidered: boolean } }[] } };
    assert.equal(envelope.version, 2);
    assert.equal(envelope.alerts.length, 2);
    assert.ok(envelope.identities.entries.every((entry) => entry.value.notificationConsidered));
  }
  store._flushNowForTest();
  assert.equal(writes, 1, 'deferred archive/notify must not rewrite unchanged snapshot');
});

test('capacity churn and restart cannot reconsider a retained identity or its new revision', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('original')]);
  churn(store);
  assert.ok(!store.getAll().some((entry) => entry.id === 'original'));
  const restarted = new UnifiedAlertStore();
  const before = dispatched.length;
  restarted.ingest([alert('original')]);
  restarted.ingest([alert('original', { severity: 'critical', body: 'Material update', timestamp: NOW + 1000 })]);
  assert.equal(dispatched.length, before);
  assert.equal(restarted.getAll().find((entry) => entry.id === 'original')?.severity, 'critical');
});

test('tombstones restore acknowledgement, pin and snooze after eviction and restart', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('original')]);
  store.acknowledge('original'); store.snooze('original', 100_000);
  store._flushNowForTest();
  churn(store);
  const restarted = new UnifiedAlertStore();
  restarted.ingest([alert('original')]);
  const restored = restarted.getAll().find((entry) => entry.id === 'original')!;
  assert.equal(restored.acknowledged, true);
  assert.equal(restored.pinned, false);
  assert.equal(restored.snoozedUntil, NOW + 100_000);
  restarted.togglePin('original');
  restarted.ingest([alert('original', { timestamp: NOW + 1 })]);
  assert.equal(restarted.getAll().find((entry) => entry.id === 'original')?.pinned, true);
  assert.equal(restarted.getAll().find((entry) => entry.id === 'original')?.snoozedUntil, NOW + 100_000);
});

test('failed writes degrade restart protection without suppressing novel source warnings or memory deduplication', () => {
  failWrites = true;
  const store = new UnifiedAlertStore();
  store.ingest([alert('original')]);
  churn(store);
  const before = dispatched.length;
  store.ingest([alert('original'), alert('novel-critical', { severity: 'critical' })]);
  assert.deepEqual(dispatched.slice(before), ['novel-critical']);
  assert.equal(store.getIdentityDiagnostics().storageFailure, true);
  assert.ok(store.getIdentityDiagnostics().entries > 0);
});

test('full protected ledger and invalid oversized identity preserve novel critical-warning eligibility', () => {
  const store = new UnifiedAlertStore({ identityLimits: { maxEntries: 1 } });
  store.ingest([alert('protected')]);
  store.ingest([alert('overflow', { severity: 'critical' }), alert('x'.repeat(20_000), { severity: 'critical' })]);
  assert.equal(dispatched.length, 3);
  assert.equal(store.getAll().length, 3);
  assert.equal(store.getIdentityDiagnostics().entries, 1);
  assert.equal(store.getIdentityDiagnostics().capacityFailures, 1);
  assert.equal(store.getIdentityDiagnostics().invalidIdentities, 1);
});

test('legacy migration seeds consideration without boot writes and retains legacy data after verified v2 write', () => {
  const legacy = JSON.stringify([alert('legacy'), alert('expired', { timestamp: NOW - 49 * 3600_000 })]);
  values.set('wm-unified-alerts-v1', legacy);
  const store = new UnifiedAlertStore();
  assert.equal(writes, 0);
  assert.deepEqual(store.getAll().map((entry) => entry.id), ['legacy']);
  assert.equal(store.getIdentityDiagnostics().migrationPending, true);
  store.ingest([alert('legacy'), alert('new')]);
  assert.deepEqual(dispatched, ['new']);
  assert.equal(values.get('wm-unified-alerts-v1'), legacy);
  assert.equal(store.getIdentityDiagnostics().migrationPending, false);
});

test('migration readback failure remains diagnosed and legacy fallback remains available', () => {
  const legacy = JSON.stringify([alert('legacy')]);
  values.set('wm-unified-alerts-v1', legacy);
  const store = new UnifiedAlertStore();
  corruptWrites = true;
  store.ingest([alert('new')]);
  assert.equal(store.getIdentityDiagnostics().migrationPending, true);
  assert.equal(store.getIdentityDiagnostics().storageFailure, true);
  assert.equal(values.get('wm-unified-alerts-v1'), legacy);
  const restarted = new UnifiedAlertStore();
  assert.deepEqual(restarted.getAll().map((entry) => entry.id), ['legacy']);
});

test('v2 hydration is bounded and performs no write or notification', () => {
  const store = new UnifiedAlertStore();
  store.ingest(Array.from({ length: 501 }, (_, i) => alert(`a-${i}`)));
  const before = { writes, dispatched: dispatched.length };
  const restarted = new UnifiedAlertStore();
  assert.equal(restarted.getAll().length, 500);
  assert.deepEqual({ writes, dispatched: dispatched.length }, before);
  assert.ok(restarted.getIdentityDiagnostics().bytes <= 2 * 1024 * 1024);
});


test('same public ID from a different source cannot inherit user state or notification consideration', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('collision')]);
  store.acknowledge('collision'); store.togglePin('collision'); store.snooze('collision', 1000);
  store.ingest([alert('collision', { source: 'gdacs', severity: 'critical' })]);
  assert.equal(dispatched.length, 2);
  const replacement = store.getAll().find((entry) => entry.id === 'collision')!;
  assert.equal(replacement.source, 'gdacs');
  assert.equal(replacement.acknowledged, false);
  assert.equal(replacement.pinned, false);
  assert.equal(replacement.snoozedUntil, undefined);
  assert.equal(store.getIdentityDiagnostics().entries, 2);
});


test('malformed persisted ledger degrades restart protection while retaining valid source rows', () => {
  values.set(KEY, JSON.stringify({ version: 2, alerts: [alert('source')],
    identities: { version: 1, entries: [{ key: 'invalid', firstReceivedAt: NOW }] } }));
  const store = new UnifiedAlertStore();
  assert.equal(writes, 0);
  assert.equal(store.getIdentityDiagnostics().storageFailure, true);
  assert.equal(store.getAll()[0]?.id, 'source');
  store.ingest([alert('novel-critical', { severity: 'critical' })]);
  assert.deepEqual(dispatched, ['novel-critical']);
});

test('all-pinned capacity eviction restores pinned tombstone state after restart', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('pinned-original', { pinned: true, acknowledged: true })]);
  store.snooze('pinned-original', 100_000);
  store.ingest(Array.from({ length: 500 }, (_, i) => alert(`new-pin-${i}`, { timestamp: NOW + i, pinned: true })));
  store._flushNowForTest();
  assert.ok(!store.getAll().some((entry) => entry.id === 'pinned-original'));
  const restarted = new UnifiedAlertStore();
  const before = dispatched.length;
  restarted.ingest([alert('pinned-original')]);
  const restored = restarted.getAll().find((entry) => entry.id === 'pinned-original')!;
  assert.equal(restored.pinned, true);
  assert.equal(restored.acknowledged, true);
  assert.equal(restored.snoozedUntil, NOW + 100_000);
  assert.equal(dispatched.length, before);
});
