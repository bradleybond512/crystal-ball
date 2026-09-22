import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';
import { resetSettings, updateDomainSettings, updateGlobalSettings } from '../notifications/notification-settings-service.ts';

class NotificationStub {
  static permission: NotificationPermission = 'granted';
  static calls: { title: string; options?: NotificationOptions }[] = [];

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve(NotificationStub.permission);
  }

  constructor(title: string, options?: NotificationOptions) {
    NotificationStub.calls.push({ title, options });
  }
}

function localStorageStub(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

function alert(id: string, severity: UnifiedAlert['severity'] = 'critical'): UnifiedAlert {
  return {
    id,
    source: 'nws',
    severity,
    title: `Alert ${id}`,
    body: 'body',
    timestamp: Date.now(),
    relevanceScore: 90,
    acknowledged: false,
    pinned: false,
  };
}

async function loadFresh() {
  const url = new URL('../notification-dispatcher.ts', import.meta.url).href + `?t=${Math.random()}`;
  return (await import(url)) as typeof import('../notification-dispatcher.ts');
}

beforeEach(() => {
  const storage = localStorageStub();
  Object.assign(globalThis, {
    localStorage: storage,
    window: { Notification: NotificationStub },
    Notification: NotificationStub,
  });
  NotificationStub.permission = 'granted';
  NotificationStub.calls = [];
  resetSettings();
  resetDiagnosticsState();
});

test('distinct critical alerts from one source bypass the source rate limit', async () => {
  const { notificationDispatcher } = await loadFresh();

  notificationDispatcher.dispatchNotification(alert('critical-1'), 'sound+banner');
  notificationDispatcher.dispatchNotification(alert('critical-2'), 'sound+banner');

  assert.equal(NotificationStub.calls.length, 2);
});

test('production dispatcher records a critical ghost-mode suppression', async () => {
  localStorage.setItem('wm-app-mode', 'ghost');
  const { notificationDispatcher } = await loadFresh();

  notificationDispatcher.dispatchNotification(alert('ghost-critical'), 'sound+banner');

  const summary = getNotificationTraceRegistry().summary();
  assert.equal(summary.candidates, 1);
  assert.equal(summary.dispatched, 0);
  assert.deepEqual(summary.suppressedByReason, { 'ghost-mode': 1 });
  assert.equal(summary.unsafeSuppressions.length, 0,
    'an explicit user mode must remain visible without being classified as an unaccounted unsafe suppression');
});

test('production dispatcher records native permission denial after dispatch', async () => {
  NotificationStub.permission = 'denied';
  const { notificationDispatcher } = await loadFresh();

  notificationDispatcher.dispatchNotification(alert('permission-denied', 'high'), 'banner');

  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.decision, 'dispatched');
  assert.deepEqual(entry?.nativeResult, {
    delivered: false,
    surface: 'failed',
    error: 'permission-denied',
  });
});

test('production dispatcher records finite confidence for a non-finite relevance score', async () => {
  const { notificationDispatcher } = await loadFresh();
  const candidate = alert('non-finite-relevance', 'high');
  candidate.relevanceScore = Number.NaN;

  notificationDispatcher.dispatchNotification(candidate, 'banner');

  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.candidate.confidence, 0);
  assert.equal(entry?.candidate.userRelevance, 0);
});


test('an advisory badge does not suppress a following warning from the same source', async () => {
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('advisory', 'medium'), 'badge');
  notificationDispatcher.dispatchNotification(alert('warning', 'high'), 'banner');

  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert warning']);
  const entries = getNotificationTraceRegistry().all();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.nativeResult?.surface), ['in_app', 'banner']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, {});
});

test('repeated badges all reach the in-app trace without reserving a banner slot', async () => {
  const { notificationDispatcher } = await loadFresh();
  for (let i = 0; i < 3; i++) {
    notificationDispatcher.dispatchNotification(alert(`advisory-${i}`, 'medium'), 'badge');
  }
  assert.equal(NotificationStub.calls.length, 0);
  assert.equal(getNotificationTraceRegistry().summary().dispatched, 3);
  assert.ok(getNotificationTraceRegistry().all().every((entry) => entry.nativeResult?.surface === 'in_app'));

  notificationDispatcher.dispatchNotification(alert('warning', 'high'), 'banner');
  assert.equal(NotificationStub.calls.length, 1);
});

test('a badge during banner cooldown does not reset its exact two-minute expiry', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('first', 'high'), 'banner');
  now += 119_999;
  notificationDispatcher.dispatchNotification(alert('late-badge', 'medium'), 'badge');
  const badge = getNotificationTraceRegistry().all().find((entry) => entry.candidate.situationId === 'late-badge');
  assert.deepEqual(badge?.nativeResult, { delivered: true, surface: 'in_app' });
  notificationDispatcher.dispatchNotification(alert('too-early', 'high'), 'banner');
  assert.equal(NotificationStub.calls.length, 1);
  now += 1;
  notificationDispatcher.dispatchNotification(alert('at-expiry', 'high'), 'banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert first', 'Alert at-expiry']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'source-rate-limit': 1 });
});

test('two high warnings from one source remain limited while a different source delivers', async () => {
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('first', 'high'), 'banner');
  notificationDispatcher.dispatchNotification(alert('second', 'high'), 'banner');
  notificationDispatcher.dispatchNotification({ ...alert('other-source', 'high'), source: 'spc' }, 'banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert first', 'Alert other-source']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'source-rate-limit': 1 });
});

test('a silent action neither delivers nor reserves a banner slot', async () => {
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('silent', 'low'), 'silent');
  notificationDispatcher.dispatchNotification(alert('warning', 'high'), 'banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert warning']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'silent-action': 1 });
});

for (const gate of ['ghost-mode', 'master-mute', 'domain-disabled', 'below-threshold', 'domain-quiet-hours', 'legacy-quiet-hours'] as const) {
  test(`badge delivery still respects ${gate} before the cooldown`, async (t) => {
    t.mock.method(Date.prototype, 'getHours', () => 23);
    t.mock.method(Date.prototype, 'getMinutes', () => 0);
    if (gate === 'ghost-mode') localStorage.setItem('wm-app-mode', 'ghost');
    if (gate === 'master-mute') updateGlobalSettings({ masterMute: true });
    if (gate === 'domain-disabled') updateDomainSettings('weather', { enabled: false });
    if (gate === 'below-threshold') updateDomainSettings('weather', { threshold: 'high' });
    if (gate === 'domain-quiet-hours') updateDomainSettings('weather', { quietHoursEnabled: true });
    if (gate === 'legacy-quiet-hours') {
      localStorage.setItem('wm-quiet-hours', JSON.stringify({ enabled: true, start: '22:00', end: '07:00' }));
    }
    const { notificationDispatcher } = await loadFresh();
    notificationDispatcher.dispatchNotification(alert('blocked-badge', 'medium'), 'badge');
    assert.equal(NotificationStub.calls.length, 0);
    assert.equal(getNotificationTraceRegistry().summary().dispatched, 0);
    assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { [gate]: 1 });

    localStorage.removeItem('wm-app-mode');
    localStorage.removeItem('wm-quiet-hours');
    resetSettings();
    notificationDispatcher.dispatchNotification(alert('allowed-warning', 'high'), 'banner');
    assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert allowed-warning']);
  });
}

for (const gate of ['master-mute', 'domain-disabled'] as const) {
  test(`critical alerts still respect ${gate}`, async () => {
    if (gate === 'master-mute') updateGlobalSettings({ masterMute: true });
    else updateDomainSettings('weather', { enabled: false });
    const { notificationDispatcher } = await loadFresh();
    notificationDispatcher.dispatchNotification(alert('blocked-critical'), 'sound+banner');
    assert.equal(NotificationStub.calls.length, 0);
    assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { [gate]: 1 });
  });
}

test('critical alerts bypass both quiet-hours gates and an active source cooldown', async (t) => {
  t.mock.method(Date.prototype, 'getHours', () => 23);
  t.mock.method(Date.prototype, 'getMinutes', () => 0);
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('warning', 'high'), 'banner');
  updateDomainSettings('weather', { quietHoursEnabled: true });
  localStorage.setItem('wm-quiet-hours', JSON.stringify({ enabled: true, start: '22:00', end: '07:00' }));
  notificationDispatcher.dispatchNotification(alert('critical'), 'sound+banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert warning', 'Alert critical']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, {});
});

test('permission denial still reserves the attempted banner slot while badges stay in-app', async () => {
  NotificationStub.permission = 'denied';
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('denied', 'high'), 'banner');
  notificationDispatcher.dispatchNotification(alert('badge', 'medium'), 'badge');
  NotificationStub.permission = 'granted';
  notificationDispatcher.dispatchNotification(alert('retry', 'high'), 'banner');
  const entries = getNotificationTraceRegistry().all();
  assert.equal(entries[0]?.nativeResult?.error, 'permission-denied');
  assert.deepEqual(entries[1]?.nativeResult, { delivered: true, surface: 'in_app' });
  assert.equal(NotificationStub.calls.length, 0);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'source-rate-limit': 1 });
});
