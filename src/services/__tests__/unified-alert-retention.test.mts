import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const NOW = 1_790_000_000_000;
const HOUR = 3600_000;
const KEY = 'wm-unified-alerts-v2';
const values = new Map<string, string>();
let now = NOW;
let failWrites = false;
let dispatched: string[] = [];
let archived: UnifiedAlert[] = [];
Object.assign(globalThis, {
  window: {}, requestAnimationFrame: () => 0,
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('fixture quota failure');
      values.set(key, value);
    },
  },
});
const { UnifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');
_setNotifyThrottleForTest(0);

beforeEach((t) => {
  values.clear(); now = NOW; failWrites = false; dispatched = []; archived = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(alertDB, 'putBatch', async (batch: UnifiedAlert[]) => { archived.push(...batch); });
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert) => { dispatched.push(alert.id); });
});

function alert(id = 'warning', extra: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return { id, source: 'nws', severity: 'high', title: id, body: 'Warning',
    timestamp: NOW - 72 * HOUR, relevanceScore: 90, acknowledged: false, pinned: false, ...extra };
}
function nws(issuedAt = NOW - HOUR, expiresAt = NOW + 24 * HOUR, observedAt = NOW) {
  return { kind: 'nws-expiry' as const, issuedAt, expiresAt, observedAt };
}
function gdacs(observedAt = NOW) { return { kind: 'gdacs-observation' as const, observedAt }; }
function ids(store: InstanceType<typeof UnifiedAlertStore>) { return store.getAll().map(row => row.id); }
function persisted() { return JSON.parse(values.get(KEY)!) as { alerts: UnifiedAlert[]; identities: { entries: { revisions: string[] }[] } }; }

test('multi-day NWS persists before dispatch, survives prune and restart without repeat consideration', () => {
  const store = new UnifiedAlertStore();
  const warning = alert('warning', { retentionEvidence: nws() });
  store.ingest([warning]);
  assert.equal(persisted().alerts.length, 1, 'consideration snapshot must preserve the warning');
  store._flushNowForTest();
  assert.deepEqual(ids(store), ['warning']);
  const restarted = new UnifiedAlertStore();
  assert.deepEqual(ids(restarted), ['warning']);
  restarted.ingest([warning]); restarted._flushNowForTest();
  assert.deepEqual(dispatched, ['warning']);
  assert.equal(archived[0]?.timestamp, warning.timestamp);
});

test('NWS exemption ends at expiry across prune and restart, while recent history remains', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('old', { retentionEvidence: nws() }), alert('recent', { timestamp: NOW, retentionEvidence: nws() })]);
  store._flushNowForTest();
  now += 24 * HOUR;
  assert.deepEqual(ids(new UnifiedAlertStore()), ['recent']);
  store.acknowledgeAll(); store._flushNowForTest();
  assert.deepEqual(ids(store), ['recent']);
});

test('GDACS qualifying observation retains old chronology for exactly the existing 48-hour window', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('disaster', { source: 'gdacs', retentionEvidence: gdacs() })]); store._flushNowForTest();
  now += 48 * HOUR;
  assert.deepEqual(ids(new UnifiedAlertStore()), ['disaster']);
  now++;
  assert.deepEqual(ids(new UnifiedAlertStore()), []);
  store.acknowledgeAll(); store._flushNowForTest();
  assert.deepEqual(ids(store), []);
});

test('new GDACS observation advances retention without changing chronology, identity revisions or notifications', () => {
  const store = new UnifiedAlertStore();
  const warning = alert('disaster', { source: 'gdacs', retentionEvidence: gdacs() });
  store.ingest([warning]); store._flushNowForTest();
  const revisions = persisted().identities.entries[0]!.revisions.length;
  now += 24 * HOUR;
  store.ingest([{ ...warning, retentionEvidence: gdacs(now) }]); store._flushNowForTest();
  assert.equal(store.getAll()[0]?.timestamp, warning.timestamp);
  assert.equal(persisted().identities.entries[0]!.revisions.length, revisions);
  assert.deepEqual(dispatched, ['disaster']);
  now += 30 * HOUR;
  assert.deepEqual(ids(new UnifiedAlertStore()), ['disaster']);
});

test('delayed GDACS replay cannot replace newer observation and unknown unchanged replay preserves evidence', () => {
  const store = new UnifiedAlertStore();
  const warning = alert('disaster', { source: 'gdacs', retentionEvidence: gdacs() });
  store.ingest([warning]);
  store.ingest([{ ...warning, retentionEvidence: gdacs(NOW - 60 * HOUR) }]);
  store.ingest([{ ...warning, retentionEvidence: undefined }]); store._flushNowForTest();
  assert.deepEqual(store.getAll()[0]?.retentionEvidence, gdacs());
  assert.deepEqual(new UnifiedAlertStore().getAll()[0]?.retentionEvidence, gdacs());
});

test('delayed NWS issuance cannot replace a newer lifecycle or its content at unchanged onset', () => {
  const store = new UnifiedAlertStore();
  const current = alert('warning', { body: 'Current update', retentionEvidence: nws() });
  store.ingest([current]);
  store.acknowledge('warning'); store.togglePin('warning'); store.snooze('warning', HOUR);
  store.ingest([{ ...current, body: 'Obsolete warning', retentionEvidence: nws(NOW - 2 * HOUR, NOW + 72 * HOUR) }]);
  store._flushNowForTest();
  assert.deepEqual(store.getAll()[0]?.retentionEvidence, nws());
  assert.equal(store.getAll()[0]?.body, 'Current update');
  assert.equal(store.getAll()[0]?.timestamp, current.timestamp);
  assert.equal(store.getAll()[0]?.acknowledged, true);
  assert.equal(store.getAll()[0]?.pinned, true);
  assert.equal(store.getAll()[0]?.snoozedUntil, NOW + HOUR);
  assert.deepEqual(dispatched, ['warning']);
  assert.equal(persisted().identities.entries[0]?.revisions.length, 1);
});

test('newer NWS issuance may shorten expiry and expired lifecycle does not borrow older expiry', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws(NOW - 4 * HOUR, NOW + 72 * HOUR) })]);
  store.ingest([alert('warning', { retentionEvidence: nws(NOW - 2 * HOUR, NOW - HOUR) })]);
  store._flushNowForTest();
  assert.deepEqual(ids(store), []);
});

test('same issuance cannot extend expiry from conflicting replay', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws() })]);
  store.ingest([alert('warning', { retentionEvidence: nws(NOW - HOUR, NOW + 72 * HOUR) })]);
  store._flushNowForTest();
  assert.deepEqual(store.getAll()[0]?.retentionEvidence, nws());
});

test('unknown material update cannot borrow prior lifecycle evidence', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws() })]);
  store.ingest([alert('warning', { body: 'Unverified changed report' })]); store._flushNowForTest();
  assert.deepEqual(ids(store), []);
});

test('malformed, future, mismatched and absent metadata falls back to source age', () => {
  const malformed = [undefined, { kind: 'other', observedAt: NOW }, gdacs(),
    nws(NOW - HOUR, NOW + HOUR, NOW + 1), nws(NOW + 1, NOW + HOUR),
    nws(NOW, NOW), nws(NOW - HOUR, Number.MAX_SAFE_INTEGER),
    nws(NOW - HOUR, NOW + HOUR, -1), nws(NOW - HOUR, NOW + HOUR, NOW + 0.5)];
  for (const [index, retentionEvidence] of malformed.entries()) {
    const store = new UnifiedAlertStore();
    store.ingest([alert(`bad-${index}`, { retentionEvidence: retentionEvidence as UnifiedAlert['retentionEvidence'] })]);
    store._flushNowForTest();
    assert.deepEqual(ids(store), [], `invalid evidence ${index}`);
  }
});

test('hydration sanitizes invalid evidence and does not infer it from legacy raw payloads', () => {
  values.set('wm-unified-alerts-v1', JSON.stringify([
    alert('legacy', { raw: { expires: NOW + HOUR, retrievedAt: NOW } }),
    alert('mismatch', { retentionEvidence: gdacs() }),
    alert('future', { retentionEvidence: nws(NOW - HOUR, NOW + HOUR, NOW + 1) }),
    alert('recent', { timestamp: NOW, retentionEvidence: { kind: 'bogus' } as unknown as UnifiedAlert['retentionEvidence'] }),
  ]));
  const store = new UnifiedAlertStore();
  assert.deepEqual(ids(store), ['recent']);
  assert.equal(store.getAll()[0]?.retentionEvidence, undefined);
});

test('retention keeps acknowledgement and snooze, pin overrides expiry, and unpin returns to age rules', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws() })]);
  store.acknowledge('warning'); store.snooze('warning', HOUR); store.togglePin('warning'); store._flushNowForTest();
  now += 25 * HOUR;
  const restarted = new UnifiedAlertStore();
  assert.equal(restarted.getAll()[0]?.acknowledged, true);
  assert.equal(restarted.getAll()[0]?.snoozedUntil, NOW + HOUR);
  restarted.togglePin('warning'); restarted._flushNowForTest();
  assert.deepEqual(ids(restarted), []);
});

test('retention does not bypass the 500-row capacity priority', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('active-old', { retentionEvidence: nws(), acknowledged: true }),
    ...Array.from({ length: 500 }, (_, i) => alert(`recent-${i}`, { timestamp: NOW }))]);
  store._flushNowForTest();
  assert.equal(store.getAll().length, 500);
  assert.ok(!ids(store).includes('active-old'));
  assert.equal(new UnifiedAlertStore().getAll().length, 500);
});

test('failed persistence preserves in-memory retention and source notification eligibility', () => {
  failWrites = true;
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws() })]); store._flushNowForTest();
  assert.deepEqual(ids(store), ['warning']);
  assert.deepEqual(dispatched, ['warning']);
  assert.equal(store.getIdentityDiagnostics().storageFailure, true);
});


test('NWS unknown unchanged replay preserves lifecycle across restart without new revisions', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws() })]); store._flushNowForTest();
  const restarted = new UnifiedAlertStore();
  restarted.ingest([alert('warning')]); restarted._flushNowForTest();
  assert.deepEqual(restarted.getAll()[0]?.retentionEvidence, nws());
  assert.equal(persisted().identities.entries[0]?.revisions.length, 1);
  assert.deepEqual(dispatched, ['warning']);
});

test('NWS observation-only replay updates evidence without material revision or new dispatch', () => {
  const store = new UnifiedAlertStore();
  store.ingest([alert('warning', { retentionEvidence: nws(NOW - HOUR, NOW + HOUR, NOW - 1000) })]);
  store.ingest([alert('warning', { retentionEvidence: nws(NOW - HOUR, NOW + HOUR, NOW) })]);
  store._flushNowForTest();
  assert.equal(store.getAll()[0]?.retentionEvidence?.observedAt, NOW);
  assert.equal(persisted().identities.entries[0]?.revisions.length, 1);
  assert.deepEqual(dispatched, ['warning']);
});

test('future GDACS observations and source-mismatched expiry cannot retain stale rows', () => {
  const store = new UnifiedAlertStore();
  store.ingest([
    alert('gdacs-future', { source: 'gdacs', retentionEvidence: gdacs(NOW + 1) }),
    alert('gdacs-nws', { source: 'gdacs', retentionEvidence: nws() }),
    alert('other-nws', { source: 'earthquake', retentionEvidence: nws() }),
  ]);
  store._flushNowForTest();
  assert.deepEqual(ids(store), []);
  assert.deepEqual(ids(new UnifiedAlertStore()), []);
  assert.equal(dispatched.length, 3, 'invalid retention must not change warning eligibility');
});
