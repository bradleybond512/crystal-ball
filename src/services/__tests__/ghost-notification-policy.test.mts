import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';
import * as modes from '../mode-manager.ts';

class NotificationStub {
  static permission: NotificationPermission = 'granted';
  static sent: string[] = [];
  static requestPermission(): Promise<NotificationPermission> { throw new Error('unexpected permission request'); }
  constructor(title: string) { NotificationStub.sent.push(title); }
}

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
const page = Object.assign(new EventTarget(), { Notification: NotificationStub, localStorage: storage });
const doc = new EventTarget();
// Policy initialization must see this fixture's storage, not a missing browser global.
Object.assign(globalThis, { window: page, document: doc, localStorage: storage, Notification: NotificationStub });
const { resetSettings } = await import('../notifications/notification-settings-service.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { startHypothesisNotifier } = await import('../hypothesis-notifier.ts');

function siteWeather(severity: UnifiedAlert['severity'] = 'critical'): UnifiedAlert {
  return { id: 'site-fixture', source: 'nws', severity, title: 'Site warning fixture', body: 'Test',
    timestamp: Date.now(), relevanceScore: 95, acknowledged: false, pinned: false };
}

function counts() {
  const { muted, critical } = modes.getGhostModeState();
  return { muted, critical };
}

beforeEach(() => {
  Object.assign(globalThis, { window: page, document: doc, localStorage: storage, Notification: NotificationStub });
  modes.setMode(null);
  values.clear();
  resetSettings();
  NotificationStub.permission = 'granted';
  NotificationStub.sent = [];
  resetDiagnosticsState();
});

test('counts critical site weather and a repeated dispatch at the Ghost gate, excluding silent actions', () => {
  modes.setMode('ghost');
  notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
  notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
  notificationDispatcher.dispatchNotification(siteWeather('medium'), 'badge');
  notificationDispatcher.dispatchNotification(siteWeather(), 'silent');
  assert.deepEqual(NotificationStub.sent, []);
  assert.deepEqual(counts(), { muted: 3, critical: 2 });
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'ghost-mode': 3, 'silent-action': 1 });
});

test('a failed local save still mutes the current window without consulting the obsolete stored choice', (t) => {
  t.mock.method(storage, 'setItem', () => { throw Error('quota'); });
  modes.setMode('ghost');
  notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
  assert.deepEqual(NotificationStub.sent, []);
  assert.deepEqual(counts(), { muted: 1, critical: 1 });
});

test('a storage read failure holds a critical attempt without attributing it to Ghost', (t) => {
  modes.initMode();
  t.mock.method(storage, 'getItem', () => { throw Error('unreadable'); });
  page.dispatchEvent(Object.assign(new Event('storage'), { key: 'wm-app-mode', newValue: 'ghost', storageArea: storage }));
  notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
  assert.deepEqual(NotificationStub.sent, []);
  assert.deepEqual(counts(), { muted: 0, critical: 0 });
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, { 'mode-unavailable': 1 });
});

test('a stored cross-window Ghost selection blocks the pending send before its storage event arrives', async (t) => {
  NotificationStub.permission = 'default';
  let resolve!: (value: NotificationPermission) => void;
  const pending = new Promise<NotificationPermission>(r => { resolve = r; });
  t.mock.method(NotificationStub, 'requestPermission', () => pending);
  notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
  storage.setItem('wm-app-mode', 'ghost');
  resolve('granted');
  await pending;
  assert.deepEqual(NotificationStub.sent, []);
  assert.deepEqual(counts(), { muted: 1, critical: 1 });
  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.decisionReason, 'ghost-mode');
});

for (const variant of ['active', 'left', 'uninterrupted', 'denied'] as const) {
  test(`pending permission observes mode at the actual send boundary (${variant})`, async (t) => {
    let resolve!: (value: NotificationPermission) => void;
    const pending = new Promise<NotificationPermission>(r => { resolve = r; });
    NotificationStub.permission = 'default';
    t.mock.method(NotificationStub, 'requestPermission', () => pending);
    notificationDispatcher.dispatchNotification(siteWeather(), 'sound+banner');
    if (variant !== 'uninterrupted') modes.setMode('ghost');
    if (variant === 'left') modes.setMode(null);
    NotificationStub.permission = variant === 'denied' ? 'denied' : 'granted';
    resolve(NotificationStub.permission);
    await pending;
    assert.equal(NotificationStub.sent.length, variant === 'uninterrupted' ? 1 : 0);
    const expected = Number(variant === 'active');
    assert.deepEqual(counts(), { muted: expected, critical: expected });
    const [entry] = getNotificationTraceRegistry().all();
    if (variant === 'active' || variant === 'left') {
      assert.equal(entry?.decision, 'suppressed');
      assert.equal(entry?.decisionReason, variant === 'active' ? 'ghost-mode' : 'mode-changed-during-permission');
      assert.equal(entry?.nativeResult, undefined);
    } else {
      assert.equal(entry?.decision, 'dispatched');
      assert.equal(entry?.nativeResult?.delivered, variant !== 'denied');
    }
  });
}

test('HUD-hidden, eligible analyst signatures count once per batch and do not replay on exit', (t) => {
  t.mock.method(Date.prototype, 'getHours', () => 12);
  startHypothesisNotifier();
  const snapshot = (regions: string[], risk: string = 'critical') => doc.dispatchEvent(new CustomEvent('cb:analyst-hypotheses', {
    detail: { hypotheses: regions.map(region => ({ kind: 'regional-burst', risk, evidence: [], confidence: 0.9, region })) },
  }));
  const visible = (value: boolean) => doc.dispatchEvent(new CustomEvent('cb:analyst-hud-visibility', { detail: { visible: value } }));
  modes.setMode('ghost');
  visible(true);
  snapshot(['North', 'South']);
  visible(false);
  snapshot(['North'], 'high');
  assert.deepEqual(counts(), { muted: 0, critical: 0 });
  snapshot(['North', 'South', 'North']);
  snapshot(['South']);
  assert.deepEqual(counts(), { muted: 1, critical: 1 });
  assert.equal(getNotificationTraceRegistry().summary().candidates, 0);
  modes.setMode(null);
  snapshot(['North', 'South']);
  assert.deepEqual(NotificationStub.sent, []);
  snapshot(['West']);
  assert.equal(NotificationStub.sent.length, 1, JSON.stringify(getNotificationTraceRegistry().summary()));
});
