import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const values = new Map<string, string>();
const calls: string[] = [];
class NotificationStub {
  static permission = 'granted';
  constructor(title: string) { calls.push(title); }
}
Object.assign(globalThis, {
  window: { Notification: NotificationStub },
  Notification: NotificationStub,
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const { UnifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { getNotificationTraceRegistry, resetDiagnosticsState } = await import('../diagnostics/diagnostics-state.ts');
const { resetSettings } = await import('../notifications/notification-settings-service.ts');

function alert(id: string, severity: UnifiedAlert['severity']): UnifiedAlert {
  return {
    id, source: 'nws', severity, title: id, body: 'test warning',
    timestamp: Date.now(), relevanceScore: 90, acknowledged: false, pinned: false,
  };
}

test('a real store batch delivers its warning after an advisory and repoll does not redispatch either', async () => {
  resetSettings();
  resetDiagnosticsState();
  _setNotifyThrottleForTest(0);
  const store = new UnifiedAlertStore();
  const batch = [alert('advisory', 'medium'), alert('warning', 'high')];
  store.ingest(batch);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, ['warning']);
  assert.equal(store.getUnacknowledgedCount(), 2);
  assert.deepEqual(store.getAll().map(({ id }) => id), ['advisory', 'warning']);
  const entries = getNotificationTraceRegistry().all();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.nativeResult?.surface), ['in_app', 'banner']);

  store.ingest(batch.map((entry) => ({ ...entry, timestamp: entry.timestamp + 1 })));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['warning']);
  assert.equal(store.getAll().length, 2);
  assert.equal(getNotificationTraceRegistry().all().length, 2);
  assert.deepEqual(getNotificationTraceRegistry().summary().suppressedByReason, {});
});
