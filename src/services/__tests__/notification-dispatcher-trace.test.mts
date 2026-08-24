import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';
import { resetSettings } from '../notifications/notification-settings-service.ts';

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
