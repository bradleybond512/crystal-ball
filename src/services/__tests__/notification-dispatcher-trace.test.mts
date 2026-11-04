import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { setMode } from '../mode-manager.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';
import { getSettings, resetSettings, updateDomainSettings, updateGlobalSettings } from '../notifications/notification-settings-service.ts';

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
  setMode(null);
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
  setMode('ghost');
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

for (const gate of ['ghost-mode', 'master-mute', 'domain-disabled', 'below-threshold', 'domain-quiet-hours'] as const) {
  test(`badge delivery still respects ${gate} before the cooldown`, async (t) => {
    t.mock.method(Date.prototype, 'getHours', () => 23);
    t.mock.method(Date.prototype, 'getMinutes', () => 0);
    if (gate === 'ghost-mode') setMode('ghost');
    if (gate === 'master-mute') updateGlobalSettings({ masterMute: true });
    if (gate === 'domain-disabled') updateDomainSettings('weather', { enabled: false });
    if (gate === 'below-threshold') updateDomainSettings('weather', { threshold: 'high' });
    if (gate === 'domain-quiet-hours') updateDomainSettings('weather', { quietHoursEnabled: true });
    const { notificationDispatcher } = await loadFresh();
    notificationDispatcher.dispatchNotification(alert('blocked-badge', 'medium'), 'badge');
    assert.equal(NotificationStub.calls.length, 0);
    assert.equal(getNotificationTraceRegistry().summary().dispatched, 0);
    assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { [gate]: 1 });

    setMode(null);
    resetSettings();
    notificationDispatcher.dispatchNotification(alert('allowed-warning', 'high'), 'banner');
    assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert allowed-warning']);
  });
}

test('critical alerts still respect a disabled domain', async () => {
  updateDomainSettings('weather', { enabled: false });
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('blocked-critical'), 'sound+banner');
  assert.equal(NotificationStub.calls.length, 0);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'domain-disabled': 1 });
});

test('critical alerts come through a forgotten master mute; others do not (R4-BUG-003)', async () => {
  updateGlobalSettings({ masterMute: true });
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('muted-warning', 'high'), 'banner');
  notificationDispatcher.dispatchNotification(alert('critical-through-mute'), 'sound+banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert critical-through-mute']);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'master-mute': 1 });
});

test('a stale legacy wm-quiet-hours value no longer silences anything (R4-BUG-003)', async (t) => {
  t.mock.method(Date.prototype, 'getHours', () => 23);
  t.mock.method(Date.prototype, 'getMinutes', () => 0);
  localStorage.setItem('wm-quiet-hours', JSON.stringify({ enabled: true, start: '22:00', end: '07:00' }));
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('night-warning', 'high'), 'banner');
  assert.deepEqual(NotificationStub.calls.map(({ title }) => title), ['Alert night-warning']);
});

test('critical alerts bypass quiet hours and an active source cooldown', async (t) => {
  t.mock.method(Date.prototype, 'getHours', () => 23);
  t.mock.method(Date.prototype, 'getMinutes', () => 0);
  const { notificationDispatcher } = await loadFresh();
  notificationDispatcher.dispatchNotification(alert('warning', 'high'), 'banner');
  updateDomainSettings('weather', { quietHoursEnabled: true });
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

test('only a source-cooldown hold returns the inbox disposition', async () => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  assert.equal(dispatcher.dispatchNotification(alert('first', 'high'), 'banner'), undefined);
  assert.equal(dispatcher.dispatchNotification(alert('held', 'high'), 'banner'), 'held-cooldown');
  updateDomainSettings('weather', { enabled: false });
  assert.equal(dispatcher.dispatchNotification(alert('disabled', 'high'), 'banner'), undefined);
});

for (const desktop of [false, true]) {
  test(`in-app-only and malformed channels suppress OS permission without spending capacity (desktop ${desktop})`, async (t) => {
    if (desktop) Object.assign(window, { __TAURI_INTERNALS__: {} });
    const { notificationDispatcher: dispatcher } = await loadFresh();
    const prompts = t.mock.method(NotificationStub, 'requestPermission');
    NotificationStub.permission = 'default';
    for (const channel of ['in_app', 'future-channel'] as const) {
      updateDomainSettings('weather', { channel: channel as 'in_app' });
      dispatcher.dispatchNotification(alert('critical-' + channel), 'sound+banner');
    }
    assert.equal(prompts.mock.callCount(), 0);
    assert.equal(NotificationStub.calls.length, 0);
    assert.equal(getNotificationTraceRegistry().summary().unsafeSuppressions.length, 1, 'only the malformed preference needs diagnosis');
    NotificationStub.permission = 'granted';
    updateDomainSettings('weather', { channel: 'native' });
    dispatcher.dispatchNotification(alert('allowed', 'high'), 'banner');
    assert.deepEqual(NotificationStub.calls.map(row => row.title), ['Alert allowed']);
  });
}

for (const scenario of ['allowed', 'mode', 'mode-roundtrip', 'channel-roundtrip', 'quiet-hours', 'owner', 'expiry', 'cancel', 'stale-prompt', 'clock-reversal'] as const) {
  test(`permission completion rechecks eligibility: ${scenario}`, async t => {
    const { notificationDispatcher: dispatcher } = await loadFresh();
    const doc = new EventTarget();
    Object.assign(globalThis, { document: doc });
    t.after(() => { Reflect.deleteProperty(globalThis, 'document'); });
    let now = 1_000_000;
    t.mock.method(Date, 'now', () => now);
    let hour = 12;
    t.mock.method(Date.prototype, 'getHours', () => hour);
    updateDomainSettings('weather', { quietHoursEnabled: true });
    let resolve!: (choice: NotificationPermission) => void;
    NotificationStub.permission = 'default';
    const prompts = t.mock.method(NotificationStub, 'requestPermission', () =>
      new Promise<NotificationPermission>(done => { resolve = done; }));
    let current = true;
    const warning = { ...alert('pending', 'high'), retentionEvidence: { kind: 'nws-expiry' as const, issuedAt: now-1, observedAt: now, expiresAt: now+1000 } };
    dispatcher.dispatchNotification(warning, 'banner', () => current);
    assert.equal(prompts.mock.callCount(), 1);
    if (scenario === 'mode') localStorage.setItem('wm-app-mode', 'ghost');
    if (scenario === 'mode-roundtrip') {
      localStorage.setItem('wm-app-mode', 'ghost');
      doc.dispatchEvent(new Event('wm:mode-changed'));
      localStorage.removeItem('wm-app-mode');
      doc.dispatchEvent(new Event('wm:mode-changed'));
    }
    if (scenario === 'channel-roundtrip') {
      updateDomainSettings('weather', { channel: 'in_app' });
      updateDomainSettings('weather', { channel: 'both' });
    }
    if (scenario === 'quiet-hours') hour = 23;
    if (scenario === 'owner') current = false;
    if (scenario === 'expiry') now += 1000;
    if (scenario === 'cancel') dispatcher.cancelPendingPermission();
    if (scenario === 'stale-prompt') { warning.retentionEvidence.expiresAt += 200_000; now += 120_000; }
    if (scenario === 'clock-reversal') now--;
    NotificationStub.permission = 'granted';
    resolve('granted');
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    assert.equal(NotificationStub.calls.length, scenario === 'allowed' ? 1 : 0);
    if (scenario !== 'allowed') assert.equal(getNotificationTraceRegistry().all()[0]?.nativeResult?.delivered, false);
  });
}

test('an outstanding permission question never builds a critical notification backlog', async t => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  NotificationStub.permission = 'default';
  let resolve!: (choice: NotificationPermission) => void;
  const prompts = t.mock.method(NotificationStub, 'requestPermission', () => new Promise<NotificationPermission>(r => { resolve = r; }));
  dispatcher.dispatchNotification(alert('first'), 'sound+banner');
  dispatcher.dispatchNotification(alert('second'), 'sound+banner');
  assert.equal(prompts.mock.callCount(), 1);
  NotificationStub.permission = 'granted';
  resolve('granted');
  await new Promise(resolveTurn => setImmediate(resolveTurn));
  assert.deepEqual(NotificationStub.calls.map(row => row.title), ['Alert first']);
});

for (const release of ['dispose','expiry'] as const) {
  test(`a single unresolved permission question releases its candidate on ${release}`, async t => {
    const { notificationDispatcher: dispatcher } = await loadFresh();
    let resolve!: (choice: NotificationPermission) => void;
    NotificationStub.permission = 'default';
    const prompts = t.mock.method(NotificationStub, 'requestPermission', () => new Promise<NotificationPermission>(r => { resolve = r; }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const oldOwner = t.mock.fn(() => true);
    dispatcher.dispatchNotification(alert('old'), 'sound+banner', oldOwner);
    if (release === 'dispose') dispatcher.cancelPendingPermission();
    else t.mock.timers.tick(120_000);
    assert.equal(getNotificationTraceRegistry().all()[0]?.nativeResult?.delivered, false, 'expired or disposed candidate released before OS response');
    dispatcher.dispatchNotification(alert('fresh'), 'sound+banner', () => true);
    assert.equal(prompts.mock.callCount(), 1);
    NotificationStub.permission = 'granted';
    resolve('granted');
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    assert.equal(oldOwner.mock.callCount(), 1, 'only the initial eligibility check ran');
    assert.deepEqual(NotificationStub.calls.map(row => row.title), ['Alert fresh']);
  });
}

test('a saved channel from a peer applies before delivery even before its storage event arrives', async t => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  NotificationStub.permission = 'default';
  const prompts = t.mock.method(NotificationStub, 'requestPermission');
  const peerSettings = structuredClone(getSettings());
  peerSettings.domains.weather.channel = 'in_app';
  localStorage.setItem('wm-notification-settings-v1', JSON.stringify(peerSettings));
  dispatcher.dispatchNotification(alert('peer'), 'sound+banner');
  assert.equal(prompts.mock.callCount(), 0);
});

test('missing domain settings cannot authorize OS permission', async t => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  Reflect.deleteProperty(getSettings().domains, 'weather');
  NotificationStub.permission = 'default';
  const prompts = t.mock.method(NotificationStub, 'requestPermission');
  dispatcher.dispatchNotification(alert('missing'), 'sound+banner');
  assert.equal(prompts.mock.callCount(), 0);
});

test('a superseded initial warning cannot consume source capacity or request permission', async t => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  NotificationStub.permission = 'default';
  const prompts = t.mock.method(NotificationStub, 'requestPermission');
  dispatcher.dispatchNotification(alert('superseded', 'high'), 'banner', () => false);
  assert.equal(prompts.mock.callCount(), 0);
  NotificationStub.permission = 'granted';
  dispatcher.dispatchNotification(alert('current', 'high'), 'banner');
  assert.deepEqual(NotificationStub.calls.map(row => row.title), ['Alert current']);
});

for (const boundary of ['peer-mode','peer-channel','peer-channel-before-event','revoked-permission'] as const) {
  test(`pending permission cannot survive ${boundary}`, async t => {
    const peer = Object.assign(new EventTarget(), { Notification: NotificationStub });
    Object.assign(globalThis, { window: peer });
    const { notificationDispatcher: dispatcher } = await loadFresh();
    let resolve!: (choice: NotificationPermission) => void;
    NotificationStub.permission = 'default';
    t.mock.method(NotificationStub, 'requestPermission', () => new Promise<NotificationPermission>(r => { resolve = r; }));
    dispatcher.dispatchNotification(alert('pending'), 'sound+banner');
    if (boundary === 'peer-channel-before-event') {
      const prefs = structuredClone(getSettings());
      prefs.domains.weather.channel = 'in_app';
      localStorage.setItem('wm-notification-settings-v1', JSON.stringify(prefs));
    } else if (boundary !== 'revoked-permission') {
      const key = boundary === 'peer-mode' ? 'wm-app-mode' : 'wm-notification-settings-v1';
      peer.dispatchEvent(Object.assign(new Event('storage'), { key }));
    }
    NotificationStub.permission = boundary === 'revoked-permission' ? 'denied' : 'granted';
    resolve('granted');
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    assert.equal(NotificationStub.calls.length, 0);
  });
}

test('an explicit malformed stored domain cannot implicitly enable system delivery', async t => {
  const { notificationDispatcher: dispatcher } = await loadFresh();
  const prompts = t.mock.method(NotificationStub, 'requestPermission');
  NotificationStub.permission = 'default';
  const invalidThreshold = JSON.stringify({ version: 1, domains: { weather: { channel: 'native', threshold: 'unexpected' } } });
  for (const raw of ['broken', '{"version":1,"domains":[]}', '{"version":1,"domains":{"weather":null}}', '{"version":1,"domains":{"weather":{}}}', invalidThreshold]) {
    localStorage.setItem('wm-notification-settings-v1', raw);
    dispatcher.dispatchNotification(alert('malformed'), 'sound+banner');
    assert.equal(prompts.mock.callCount(), 0, raw);
  }
});
