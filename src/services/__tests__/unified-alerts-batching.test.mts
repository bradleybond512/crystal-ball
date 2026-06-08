import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal globals so the notification dispatcher (pulled in transitively) is a no-op.
(globalThis as Record<string, unknown>).window = globalThis;
try { localStorage.clear(); } catch { /* no localStorage in this env */ }

const { unifiedAlertStore } = await import('../unified-alerts.ts');
type UnifiedAlert = import('../unified-alerts.ts').UnifiedAlert;

function makeAlert(id: string): UnifiedAlert {
  return {
    id,
    source: 'breaking-news',
    severity: 'medium',
    title: id,
    body: '',
    timestamp: Date.now(), // fresh — anything older than 48h is pruned on ingest
    relevanceScore: 0.5,
    acknowledged: false,
    pinned: false,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('acknowledgeMany coalesces notify into a single subscriber fan-out', async () => {
  const ids = ['ack-a', 'ack-b', 'ack-c', 'ack-d'];
  unifiedAlertStore.ingest(ids.map(makeAlert));
  await flush();

  let notifyCount = 0;
  const unsub = unifiedAlertStore.subscribe(() => { notifyCount += 1; });

  unifiedAlertStore.acknowledgeMany(ids);
  assert.equal(notifyCount, 0, 'notify is deferred, not synchronous');

  await flush();
  assert.equal(notifyCount, 1, 'N acknowledgements collapse to one notify');

  for (const id of ids) {
    const a = unifiedAlertStore.getAll().find((x) => x.id === id);
    assert.equal(a?.acknowledged, true, 'state mutated synchronously');
  }

  unsub();
});

test('acknowledgeMany with no matching alerts does not notify', async () => {
  let count = 0;
  const unsub = unifiedAlertStore.subscribe(() => { count += 1; });

  unifiedAlertStore.acknowledgeMany(['does-not-exist']);
  await flush();
  assert.equal(count, 0);

  unsub();
});
