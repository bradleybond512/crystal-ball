import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { NWSAlert, NWSAlertSnapshot } from '../nws-alerts.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';

const NOW = 1_790_000_000_000;
const KEY = 'wm-unified-alerts-v2';
const values = new Map<string, string>();
let writes = 0;
let failWrites = false;
let corruptWrites = false;
let dispatched: UnifiedAlert[] = [];
const events = new Map<string, Set<() => void>>();
Object.assign(globalThis, {
  window: {}, requestAnimationFrame: () => 0,
  document: {
    visibilityState: 'visible',
    addEventListener(name: string, fn: () => void) {
      const handlers = events.get(name) ?? new Set(); handlers.add(fn); events.set(name, handlers);
    },
    removeEventListener(name: string, fn: () => void) { events.get(name)?.delete(fn); },
  },
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++;
      if (failWrites) throw new Error('fixture quota failure');
      values.set(key, corruptWrites ? '{}' : value);
    },
  },
});
const { UnifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { normalizeNWSAlert } = await import('../alert-normalizer.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');
_setNotifyThrottleForTest(0);

beforeEach((t) => {
  values.clear(); events.clear(); writes = 0; failWrites = false; corruptWrites = false; dispatched = [];
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  t.mock.method(alertDB, 'putBatch', async () => {});
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert) => { dispatched.push(alert); });
});

function nws(id = 'warning', extra: Partial<NWSAlert> = {}): NWSAlert {
  return { id, event: 'Warning', headline: 'Warning headline', description: 'Warning description',
    severity: 'Severe', urgency: 'Immediate', areaDesc: 'Fixture area',
    sent: new Date(NOW - 1000).toISOString(), onset: new Date(NOW + 5000).toISOString(),
    expires: new Date(NOW + 10_000).toISOString(), status: 'Actual', messageType: 'Alert',
    retrievedAt: NOW, centroid: null, geometry: null, ...extra };
}
function snapshot(alerts: NWSAlert[], observedAt = Date.now()): NWSAlertSnapshot {
  return { schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt,
    alerts: alerts.map(alert => ({ ...alert, retrievedAt: observedAt })) };
}
function ids(rows: { id: string }[]) { return rows.map(row => row.id).sort(); }
function persisted() { return JSON.parse(values.get(KEY)!); }

test('new complete snapshots retire only NWS operational membership while preserving history and user state', (t) => {
  const store = new UnifiedAlertStore();
  assert.equal(store.reconcileNwsSnapshot(snapshot([nws()])).disposition, 'applied');
  store.acknowledge('nws-warning'); store.togglePin('nws-warning'); store.snooze('nws-warning', 60_000);
  store.ingest([{ ...normalizeNWSAlert(nws('other')), id: 'other-source', source: 'gdacs' }]);
  t.mock.timers.tick(1);
  assert.equal(store.reconcileNwsSnapshot(snapshot([])).disposition, 'applied');
  assert.deepEqual(ids(store.getOperationalAlerts()), ['other-source']);
  const retained = store.getAll().find(row => row.id === 'nws-warning')!;
  assert.equal(retained.pinned, true); assert.equal(retained.acknowledged, true);
  assert.equal(retained.snoozedUntil, NOW + 60_000);
  assert.equal(dispatched.filter(row => row.source === 'nws').length, 1);
});

test('partial, malformed, future and duplicate-member snapshots cannot certify empty membership', () => {
  const store = new UnifiedAlertStore();
  store.reconcileNwsSnapshot(snapshot([nws()]));
  for (const invalid of [
    { ...snapshot([]), completeness: 'partial' },
    { ...snapshot([]), observedAt: NOW + 1 },
    { ...snapshot([nws()]), alerts: [{ ...nws(), expires: 'broken' }] },
    snapshot([nws(), nws()]),
  ]) assert.equal(store.reconcileNwsSnapshot(invalid as NWSAlertSnapshot).disposition, 'invalid');
  assert.deepEqual(ids(store.getOperationalAlerts()), ['nws-warning']);
});

test('equal observation with identical membership is silent and conflicting membership is invalid', () => {
  const store = new UnifiedAlertStore();
  const original = snapshot([nws('a'), nws('b')]);
  store.reconcileNwsSnapshot(original); store._flushNowForTest();
  const before = { writes, dispatches: dispatched.length };
  assert.equal(store.reconcileNwsSnapshot(snapshot([...original.alerts].reverse())).disposition, 'unchanged');
  assert.equal(store.reconcileNwsSnapshot(snapshot([])).disposition, 'invalid');
  assert.equal(store.reconcileNwsSnapshot(snapshot([nws('a', { expires: new Date(NOW + 20_000).toISOString() }), nws('b')])).disposition, 'invalid');
  store._flushNowForTest();
  assert.deepEqual({ writes, dispatches: dispatched.length }, before);
});

test('persisted watermark rejects old snapshots and generic replay after restart without boot writes or dispatch', (t) => {
  const store = new UnifiedAlertStore(); const initial = snapshot([nws()]);
  store.reconcileNwsSnapshot(initial);
  t.mock.timers.tick(1); store.reconcileNwsSnapshot(snapshot([])); store._flushNowForTest();
  const before = { writes, dispatches: dispatched.length };
  const restarted = new UnifiedAlertStore();
  assert.deepEqual({ writes, dispatches: dispatched.length }, before);
  assert.equal(restarted.reconcileNwsSnapshot(initial).disposition, 'older');
  restarted.ingest([normalizeNWSAlert(nws(), { kind: 'replay', observedAt: NOW })]);
  assert.deepEqual(restarted.getOperationalAlerts(), []);
  assert.deepEqual(restarted.getOperationalNwsAlerts(initial), []);
  assert.equal(dispatched.length, before.dispatches);
});

test('full national membership and panel projection survive the 500 retained-row capacity', () => {
  const store = new UnifiedAlertStore();
  const national = snapshot(Array.from({ length: 600 }, (_, i) => nws(`warning-${i}`)));
  assert.equal(store.reconcileNwsSnapshot(national).activeCount, 600);
  store._flushNowForTest();
  assert.equal(store.getAll().length, 500);
  assert.equal(persisted().nwsLifecycle.members.length, 600);
  const restarted = new UnifiedAlertStore();
  assert.equal(restarted.getOperationalNwsAlerts(national).length, 600);
  assert.equal(restarted.isOperationalAlert(normalizeNWSAlert(national.alerts[0]!)), true);
});

test('expiry invalidates subscribers offline without deleting pinned history or dispatching again', (t) => {
  const store = new UnifiedAlertStore();
  store.reconcileNwsSnapshot(snapshot([nws()])); store.togglePin('nws-warning'); store._flushNowForTest();
  let invalidations = 0; store.subscribe(() => invalidations++);
  const before = { writes, dispatches: dispatched.length };
  t.mock.timers.tick(10_000);
  assert.deepEqual(store.getOperationalAlerts(), []);
  assert.equal(store.getAll().find(row => row.id === 'nws-warning')?.pinned, true);
  assert.equal(invalidations, 1);
  assert.deepEqual({ writes, dispatches: dispatched.length }, before);
  assert.deepEqual(new UnifiedAlertStore().getOperationalAlerts(), []);
});

test('lifecycle teardown stops expiry delivery and resume rechecks the current clock', (t) => {
  const store = new UnifiedAlertStore();
  store.reconcileNwsSnapshot(snapshot([nws()])); store._flushNowForTest();
  let invalidations = 0; store.subscribe(() => invalidations++);
  store.stopNwsLifecycle(); t.mock.timers.tick(10_000);
  assert.equal(invalidations, 0);
  store.startNwsLifecycle();
  for (const handler of events.get('visibilitychange') ?? []) handler();
  assert.deepEqual(store.getOperationalAlerts(), []);
  assert.equal(invalidations, 1);
});

test('invalid or oversized persisted lifecycle metadata cannot create trusted membership or boot writes', () => {
  const store = new UnifiedAlertStore(); store.reconcileNwsSnapshot(snapshot([nws()])); store._flushNowForTest();
  const original = persisted();
  for (const invalid of [
    { ...original.nwsLifecycle, observedAt: NOW + 1 },
    { ...original.nwsLifecycle, members: Array.from({ length: 2001 }, (_, i) => ({ id: `nws-${i}`, issuedAt: NOW - 1000, expiresAt: NOW + 1000 })) },
    { ...original.nwsLifecycle, members: [{ id: 'nws-warning', issuedAt: NOW - 1000, expiresAt: NOW - 2000 }] },
  ]) {
    values.set(KEY, JSON.stringify({ ...original, nwsLifecycle: invalid }));
    const before = { writes, dispatches: dispatched.length };
    const restarted = new UnifiedAlertStore();
    assert.equal(restarted.getNwsOperationalState(restarted.getAll()[0]!), 'unverified');
    assert.deepEqual({ writes, dispatches: dispatched.length }, before);
  }
});

test('storage failure/readback failure is reported without changing source warning dispatch policy', () => {
  for (const corrupt of [false, true]) {
    values.clear(); writes = 0; dispatched = []; failWrites = !corrupt; corruptWrites = corrupt;
    const store = new UnifiedAlertStore();
    store.reconcileNwsSnapshot(snapshot([nws()]));
    assert.equal(store.getIdentityDiagnostics().storageFailure, true);
    assert.equal(dispatched.length, 1);
    assert.equal(store.getOperationalAlerts().length, 1);
  }
});

test('legacy rows remain unverified, explicit expiry stays inactive, and other sources are isolated', () => {
  const store = new UnifiedAlertStore();
  const legacy = normalizeNWSAlert(nws());
  store.ingest([legacy]);
  assert.equal(store.getNwsOperationalState(legacy), 'unverified');
  assert.equal(store.isOperationalAlert(legacy), true);
  const expired = { ...legacy, retentionEvidence: { kind: 'nws-expiry' as const,
    issuedAt: NOW - 2000, observedAt: NOW - 500, expiresAt: NOW - 1000 } };
  assert.equal(store.isOperationalAlert(expired), false);
  store.reconcileNwsSnapshot(snapshot([]));
  assert.equal(store.isOperationalAlert(legacy), false);
  assert.equal(store.isOperationalAlert({ ...legacy, source: 'gdacs' }), true);
});

test('issued time uses sent while future onset stays available separately', () => {
  const input = nws(); const alert = normalizeNWSAlert(input, { kind: 'verified-response', observedAt: NOW });
  assert.equal(alert.timestamp, Date.parse(input.sent));
  assert.equal((alert.raw as NWSAlert).onset, input.onset);
});

test('verified refresh replaces legacy future-onset chronology with sent without losing user state', () => {
  const store = new UnifiedAlertStore();
  const input = nws();
  const legacy = normalizeNWSAlert(input, { kind: 'verified-response', observedAt: NOW });
  legacy.timestamp = Date.parse(input.onset!);
  store.ingest([legacy]); store.acknowledge(legacy.id); store.togglePin(legacy.id); store._flushNowForTest();
  const restarted = new UnifiedAlertStore();
  const before = dispatched.length;
  restarted.reconcileNwsSnapshot(snapshot([input]));
  const current = restarted.getOperationalAlerts()[0]!;
  assert.ok(current, 'verified sent chronology must replace legacy onset timestamp');
  assert.equal(current.timestamp, Date.parse(input.sent));
  assert.equal(current.pinned, true); assert.equal(current.acknowledged, true);
  assert.equal(dispatched.length, before);
});

test('legacy trusted expiry also invalidates offline views without a national watermark', (t) => {
  const store = new UnifiedAlertStore();
  store.ingest([normalizeNWSAlert(nws(), { kind: 'verified-response', observedAt: NOW })]);
  store._flushNowForTest();
  const restarted = new UnifiedAlertStore();
  let invalidations = 0; restarted.subscribe(() => invalidations++);
  const before = writes;
  t.mock.timers.tick(10_000);
  assert.equal(invalidations, 1);
  assert.deepEqual(restarted.getOperationalAlerts(), []);
  assert.equal(writes, before);
});

test('already-expired rows in a complete upstream response never dispatch as new live warnings', () => {
  const store = new UnifiedAlertStore();
  const result = store.reconcileNwsSnapshot(snapshot([nws('expired', {
    sent: new Date(NOW - 2000).toISOString(), expires: new Date(NOW - 1000).toISOString(),
  })]));
  assert.deepEqual(result, { disposition: 'applied', activeCount: 0 });
  assert.equal(dispatched.length, 0);
  assert.deepEqual(store.getOperationalAlerts(), []);
});

test('view projection rejects malformed membership fields without reading geometry again', () => {
  const store = new UnifiedAlertStore(); const valid = snapshot([nws()]);
  store.reconcileNwsSnapshot(valid);
  const geometry = Object.defineProperty({ ...nws() }, 'geometry', { get() { throw new Error('view must not rescan geometry'); } });
  assert.equal(store.getOperationalNwsAlerts({ ...valid, alerts: [geometry] }).length, 1);
  for (const bad of [
    { ...valid, scope: 'local' }, { ...valid, observedAt: NOW + 1 },
    { ...valid, alerts: [{ ...nws(), sent: 'bad date' }] },
    { ...valid, alerts: [nws(), nws()] },
  ]) assert.deepEqual(store.getOperationalNwsAlerts(bad as NWSAlertSnapshot), []);
});
