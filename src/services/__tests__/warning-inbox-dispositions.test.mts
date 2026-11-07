import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const start = 1_790_000_000_000;
let now = start;
const disk = new Map<string, string>();
const calls: Array<{ id: string; guard: (afterPermission?: boolean) => boolean; action: string }> = [];
Object.assign(globalThis, {
  window: {}, requestAnimationFrame: () => 0,
  localStorage: { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value) },
});
const { UnifiedAlertStore } = await import('../unified-alerts.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');

beforeEach(t => {
  now = start;
  calls.length = 0;
  disk.clear();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(alertDB, 'putBatch', async () => {});
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert, action: string, guard: (afterPermission?: boolean) => boolean) => {
    calls.push({ id: alert.id, guard, action });
    return alert.id.startsWith('held') ? 'held-cooldown' : undefined;
  });
});

function warning(id: string, severity: UnifiedAlert['severity'] = 'high', issuedAt = start - 6000): UnifiedAlert {
  return { id, source: 'nws', severity, title: id, body: 'Test', timestamp: start - 5000,
    relevanceScore: 80, acknowledged: false, pinned: false,
    retentionEvidence: { kind: 'nws-expiry', issuedAt, expiresAt: start + 60_000, observedAt: now } };
}

test('only a held distinct warning adds a session count and the reason survives duplicate polls', () => {
  const store = new UnifiedAlertStore();
  const first = warning('one'), held = warning('held-two');
  store.ingest([first, held], { action: 'sound+banner' });
  store.ingest([held]);
  assert.deepEqual(calls.map(c => c.action), ['sound+banner', 'sound+banner']);
  assert.equal(store.getHeldWarningCount(), 1);
  assert.equal(store.getDisposition(first), undefined);
  assert.deepEqual(store.getDisposition(held), { heldDuringCooldown: true });
  assert.ok(!disk.get('wm-unified-alerts-v2')?.includes('heldDuringCooldown'));
  const restarted = new UnifiedAlertStore();
  assert.equal(restarted.getHeldWarningCount(), 0);
  assert.equal(restarted.getDisposition(held), undefined);
  restarted.ingest([held]);
  assert.equal(calls.length, 2);
});

test('only strictly newer live NWS issuance raises the high-water, without another system request', () => {
  const store = new UnifiedAlertStore();
  const first = warning('held-update');
  store.ingest([first]);
  for (const issue of [start - 7000, start - 6000]) {
    store.ingest([{ ...warning(first.id, 'critical', issue), title: 'Conflicting report' }]);
    assert.equal(store.getAll()[0]?.severity, 'high');
    assert.equal(store.getAll()[0]?.title, first.title);
  }
  assert.equal(store.getDisposition(first)?.updatedTo, undefined);
  store.ingest([warning(first.id, 'critical', start - 5000)]);
  assert.deepEqual(store.getDisposition(first), { heldDuringCooldown: true, updatedTo: 'critical' });
  store.ingest([warning(first.id, 'medium', start - 4000)]);
  assert.equal(store.getDisposition(first)?.updatedTo, undefined);
  store.ingest([warning(first.id, 'critical', start - 3000)]);
  assert.equal(store.getDisposition(first)?.updatedTo, undefined, 'a return to high-water is not another escalation');
  assert.equal(calls.length, 1);
});

test('replay cannot interrupt or establish an escalation baseline; hydration never counts as live', () => {
  const store = new UnifiedAlertStore();
  const cached = warning('held-cache', 'medium');
  store.ingest([cached], { live: false });
  store.ingest([warning(cached.id, 'high', start - 5000)]);
  assert.equal(store.getDisposition(cached)?.updatedTo, undefined);
  assert.equal(calls.length, 0);
  store.ingest([warning(cached.id, 'critical', start - 4000)], { live: false });
  assert.equal(store.getAll()[0]?.severity, 'high', 'a replay cannot change the accepted row');
  assert.equal(store.getDisposition(cached)?.updatedTo, undefined);
  store._flushNowForTest();
  const restarted = new UnifiedAlertStore();
  restarted.ingest([warning(cached.id, 'critical', start - 3000)]);
  assert.equal(restarted.getDisposition(cached), undefined);
  assert.equal(calls.length, 0);
});

test('one source cannot inherit a colliding source’s disposition or pending permission', () => {
  const store = new UnifiedAlertStore();
  const original = warning('held-collision');
  store.ingest([original]);
  const guard = calls[0]!.guard;
  assert.ok(guard());
  store.ingest([{ ...original, source: 'gdacs', retentionEvidence: undefined }]);
  assert.equal(store.getDisposition(original), undefined);
  assert.equal(guard(), false);
  assert.equal(store.getHeldWarningCount(), 2);
});

test('pending permission survives an identical poll but not a superseding revision, owner invalidation, ack or snooze', () => {
  const store = new UnifiedAlertStore();
  const one = warning('first'), two = warning('second'), three = warning('third'), four = warning('fourth');
  let owner = true;
  store.ingest([one, two, three, four], { stillEligible: () => owner });
  store.ingest([one]);
  assert.ok(calls[0]!.guard());
  store.ingest([warning('first', 'critical', start - 1000)]);
  assert.equal(calls[0]!.guard(), false);
  store.acknowledge('second');
  assert.equal(calls[1]!.guard(), false);
  store.snooze('third', 20);
  now += 21;
  assert.equal(calls[2]!.guard(), false, 'a pending attempt cannot come back after snooze ends');
  owner = false;
  assert.equal(calls[3]!.guard(), false);
});

test('expiry invalidates pending work and hides dispositions even for a pinned retained row', () => {
  const store = new UnifiedAlertStore();
  const held = warning('held-expired');
  store.ingest([held]);
  store.togglePin(held.id);
  assert.ok(calls[0]!.guard());
  now += 60_000;
  assert.equal(calls[0]!.guard(), false);
  assert.equal(store.getDisposition(held), undefined);
  assert.equal(store.getAll()[0]?.pinned, true);
  assert.equal(store.getHeldWarningCount(), 1);
});

test('session teardown clears counts and assignments and invalidates pending attempts', () => {
  const store = new UnifiedAlertStore();
  const held = warning('held-session');
  store.ingest([held]);
  store.endNotificationSession();
  assert.equal(store.getHeldWarningCount(), 0);
  assert.equal(store.getDisposition(held), undefined);
  assert.equal(calls[0]!.guard(), false);
  store.ingest([held]);
  assert.equal(calls.length, 1);
});

test('the 501st resident cannot grow optional tracking; eviction clears its predecessor’s reason', () => {
  const store = new UnifiedAlertStore();
  const batch = Array.from({ length: 501 }, (_, n) => warning('held-' + n));
  store.ingest(batch);
  assert.equal(store.getHeldWarningCount(), 500);
  assert.equal(store.getDisposition(batch[500]!), undefined);
  store._flushNowForTest();
  assert.equal(store.getDisposition(batch[0]!), undefined);
  assert.equal(calls[0]!.guard(), false);
  assert.equal(store.getAll().length, 500);
});

test('untracked warning may still be considered immediately but cannot resume after permission', () => {
  const store = new UnifiedAlertStore({ identityLimits: { maxEntries: 1 } });
  store.ingest([warning('fits'), warning('overflow')]);
  assert.equal(calls[1]!.guard(false), true);
  assert.equal(calls[1]!.guard(true), false);
});

test('later issuance with an earlier corrected onset supersedes the pending attempt in the same batch', () => {
  const store = new UnifiedAlertStore();
  const initial = warning('held-correction');
  const latest = { ...warning(initial.id, 'critical', start - 3000), timestamp: initial.timestamp - 1000 };
  store.ingest([initial, latest]);
  assert.equal(store.getAll()[0]?.severity, 'critical');
  assert.equal(calls[0]!.guard(false), false);
  assert.equal(store.getHeldWarningCount(), 0);
  assert.equal(store.getDisposition(latest)?.updatedTo, 'critical');
});

test('an expired retained record cannot attach a held label or historical high-water to a later active issuance', () => {
  const store = new UnifiedAlertStore();
  const initial = warning('held-reissued');
  store.ingest([initial]);
  store.togglePin(initial.id);
  now += 60_001;
  const later = { ...initial, severity: 'critical' as const,
    retentionEvidence: { kind: 'nws-expiry' as const, issuedAt: now - 1, expiresAt: now + 60_000, observedAt: now } };
  store.ingest([later]);
  assert.equal(store.getDisposition(later), undefined);
  assert.equal(store.getHeldWarningCount(), 1);
  assert.equal(calls.length, 1);
});

test('a first cached warning persists consideration before the trailing flush, so restart cannot replay it', () => {
  const first = warning('held-replayed-after-restart');
  const store = new UnifiedAlertStore();
  store.ingest([first], { live: false });
  const restarted = new UnifiedAlertStore();
  restarted.ingest([first]);
  assert.deepEqual(calls, []);
});
