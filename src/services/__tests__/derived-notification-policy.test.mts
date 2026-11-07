import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { setMode, getGhostModeState } from '../mode-manager.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
Object.assign(globalThis, { localStorage: storage });
const { resetSettings, updateDomainSettings, updateGlobalSettings } =
  await import('../notifications/notification-settings-service.ts');

const calls: NotificationOptions[] = [];
let onConstruct: (() => void) | undefined;
let prompts = 0;
class CaptureNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission() { prompts++; return Promise.resolve('default'); }
  constructor(_title: string, options: NotificationOptions) {
    calls.push(options);
    onConstruct?.();
  }
}

let id = 0;
function candidate(title = 'Synthetic 1', severity: UnifiedAlert['severity'] = 'critical'): UnifiedAlert {
  id++;
  return { id: `private-id-${id}`, source: 'correlation', title, severity, body: 'Synthetic',
    timestamp: Date.now(), location: { lat: id % 90, lon: id % 180 }, relevanceScore: 92,
    acknowledged: false, pinned: false };
}

let moduleIndex = 0;
async function dispatcher() {
  const url = new URL('../notification-dispatcher.ts', import.meta.url);
  url.searchParams.set('fixture', String(++moduleIndex));
  return (await import(url.href) as typeof import('../notification-dispatcher.ts')).notificationDispatcher;
}
const reasons = () => getNotificationTraceRegistry().summary().suppressedByReason;

beforeEach((t) => {
  values.clear();
  calls.length = 0;
  prompts = 0;
  onConstruct = undefined;
  CaptureNotification.permission = 'granted';
  Object.assign(globalThis, { localStorage: storage, Notification: CaptureNotification, window: { Notification: CaptureNotification } });
  setMode(null);
  resetSettings();
  resetDiagnosticsState();
  t.mock.method(Date.prototype, 'getHours', () => 12);
});

test('100 critical candidates keep source identity and severity while only one silent banner interrupts', async () => {
  const service = await dispatcher();
  for (let i = 0; i < 100; i++) {
    service.dispatchNotification(candidate(i % 2 ? ' SYNTHE\u0301TIC\u00a0 1 ' : 'synthétic 1'), 'sound+banner');
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.silent, true);
  assert.equal(calls[0]?.requireInteraction, false);
  assert.ok(calls[0]?.tag && !/private|synthetic/i.test(calls[0].tag));
  assert.deepEqual(reasons(), { 'derived-duplicate-title': 99 });
  const entries = getNotificationTraceRegistry().byDomain('reasoning');
  assert.equal(new Set(entries.map(e => e.candidate.situationId)).size, 100);
  assert.ok(entries.every(e => e.candidate.urgency === 'critical' && e.candidate.safetyCritical === false));
  assert.deepEqual(entries[0]?.nativeResult, { delivered: true, surface: 'banner' });
});

test('elapsed-time cooldown and fixed title expiry survive severity changes and a distinct-title flood', async (t) => {
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const service = await dispatcher();
  const send = (title: string, severity: UnifiedAlert['severity'] = 'critical') =>
    service.dispatchNotification(candidate(title, severity), 'banner');
  send('Zone 1');
  elapsed = 119_999;
  for (let i = 0; i < 250; i++) send(`Zone ${i + 2}`);
  elapsed++;
  send('Zone 2');
  elapsed = 1_799_999;
  send('zOnE 1', 'high');
  elapsed++;
  send('zone 1', 'high');
  assert.equal(calls.length, 3);
  assert.deepEqual(reasons(), { 'derived-cooldown': 250, 'derived-duplicate-title': 1 });
});

test('reserves before constructor reentry and records constructor failure as an attempted banner', async () => {
  const service = await dispatcher();
  onConstruct = () => {
    onConstruct = undefined;
    service.dispatchNotification(candidate(), 'banner');
    service.dispatchNotification(candidate('Other'), 'banner');
    throw new Error('Synthetic transport failure');
  };
  service.dispatchNotification(candidate(), 'banner');
  assert.equal(calls.length, 1);
  const [attempt] = getNotificationTraceRegistry().all();
  assert.equal(attempt?.decision, 'dispatched');
  assert.deepEqual(attempt?.nativeResult, { delivered: false, surface: 'failed', error: 'notification-delivery-failed' });
  assert.deepEqual(reasons(), { 'derived-duplicate-title': 1, 'derived-cooldown': 1 });
});

test('unavailable or ungranted permission never prompts, replays, or consumes a title slot', async () => {
  const service = await dispatcher();
  for (const permission of ['default', 'denied'] as const) {
    CaptureNotification.permission = permission;
    service.dispatchNotification(candidate(), 'banner');
  }
  Reflect.deleteProperty(window, 'Notification');
  service.dispatchNotification(candidate(), 'banner');
  Object.assign(window, { Notification: CaptureNotification });
  CaptureNotification.permission = 'granted';
  await Promise.resolve();
  assert.equal(prompts, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(reasons(), { 'permission-unavailable': 3 });
  service.dispatchNotification(candidate(), 'banner');
  assert.equal(calls.length, 1);
});

test('in-app channel and passive actions do not claim an outward delivery or reserve a slot', async () => {
  const service = await dispatcher();
  updateDomainSettings('derived', { channel: 'in_app' });
  service.dispatchNotification(candidate(), 'banner');
  updateDomainSettings('derived', { channel: 'native' });
  service.dispatchNotification(candidate(), 'badge');
  service.dispatchNotification(candidate(), 'silent');
  assert.equal(calls.length, 0);
  assert.equal(getNotificationTraceRegistry().summary().dispatched, 0);
  assert.deepEqual(reasons(), { 'in-app-only': 1, 'badge-only': 1, 'silent-action': 1 });
  service.dispatchNotification(candidate(), 'sound+banner');
  assert.equal(calls.length, 1);
});

test('derived critical respects mute, quiet and Ghost ahead of pacing; NWS still interrupts', async (t) => {
  const service = await dispatcher();
  service.dispatchNotification(candidate(), 'sound+banner');
  updateGlobalSettings({ masterMute: true });
  service.dispatchNotification(candidate(), 'sound+banner');
  updateGlobalSettings({ masterMute: false });
  updateDomainSettings('derived', { quietHoursEnabled: true });
  t.mock.method(Date.prototype, 'getHours', () => 23);
  service.dispatchNotification(candidate(), 'sound+banner');
  service.dispatchNotification({ ...candidate(), source: 'nws' }, 'sound+banner');
  localStorage.setItem('wm-app-mode', 'ghost');
  service.dispatchNotification(candidate(), 'sound+banner');
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.requireInteraction, true);
  assert.deepEqual(reasons(), { 'master-mute': 1, 'domain-quiet-hours': 1, 'ghost-mode': 1 });
  assert.equal(getGhostModeState().muted, 1);
  assert.equal(getGhostModeState().critical, 1);
});

test('a privacy storage read failure holds derived notifications', async (t) => {
  const service = await dispatcher();
  const original = storage.getItem;
  t.mock.method(storage, 'getItem', (key: string) => {
    if (key === 'wm-app-mode') throw new Error('Synthetic read failure');
    return original(key);
  });
  service.dispatchConvergenceAlert('Synthetic', 95, 0, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(reasons(), { 'mode-unavailable': 1 });
  assert.equal(getGhostModeState().muted, 0);
  t.mock.restoreAll();
  service.dispatchConvergenceAlert('Still held', 95, 0, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(reasons(), { 'mode-unavailable': 2 });
  setMode(null);
  service.dispatchConvergenceAlert('Explicit choice', 95, 0, 0);
  assert.equal(calls.length, 1);
});

test('unreadable permission and ungroupable titles fail closed without blocking a later candidate', async () => {
  const service = await dispatcher();
  const unreadable = { get permission() { throw new Error('Synthetic permission error'); } };
  Object.assign(window, { Notification: unreadable });
  service.dispatchNotification(candidate(), 'banner');
  Object.assign(window, { Notification: CaptureNotification });
  for (const title of ['   ', 'a'.repeat(1025)]) service.dispatchNotification(candidate(title), 'banner');
  service.dispatchNotification(candidate(), 'banner');
  assert.equal(calls.length, 1);
  assert.deepEqual(reasons(), { 'permission-unavailable': 1, 'derived-title-unavailable': 2 });
});

test('a live Ghost choice still suppresses when its storage write failed', async (t) => {
  const service = await dispatcher();
  const { setMode } = await import('../mode-manager.ts');
  Object.assign(globalThis, { document: new EventTarget() });
  t.mock.method(storage, 'setItem', () => { throw new Error('Synthetic write failure'); });
  try {
    setMode('ghost');
    assert.equal(storage.getItem('wm-app-mode'), null);
    service.dispatchNotification(candidate(), 'banner');
    assert.deepEqual(reasons(), { 'ghost-mode': 1 });
    assert.equal(calls.length, 0);
  } finally {
    setMode(null);
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('opaque notification tags rotate within a per-window bound across hourly floods', async (t) => {
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const service = await dispatcher();
  for (let i = 0; i < 32; i++) {
    service.dispatchNotification(candidate(`Private row ${i}`), 'banner');
    elapsed += 120_000;
  }
  const tags = calls.map(call => call.tag);
  assert.equal(tags.length, 32);
  assert.equal(new Set(tags).size, 16);
  assert.deepEqual(tags.slice(0, 16), tags.slice(16));
  assert.ok(tags.every(tag => tag && !/private/i.test(tag)));
  const secondWindow = await dispatcher();
  secondWindow.dispatchNotification(candidate(), 'banner');
  assert.ok(!tags.includes(calls.at(-1)?.tag));
});
