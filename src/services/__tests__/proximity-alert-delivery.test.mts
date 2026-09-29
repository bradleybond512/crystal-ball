import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchProximityNotices,
  PROXIMITY_SUMMARY_THRESHOLD,
  type PendingProximityNotice,
  type ProximityNotify,
} from '../proximity-alerts.ts';
import type { NativeNotifyOutcome } from '../native-notify.ts';

function notice(id: string, priority: PendingProximityNotice['priority'] = 'high'): PendingProximityNotice {
  return { id, title: `Wildfire: ${id}`, body: `${id} body`, sound: 'Ping', priority };
}

function recorder(outcomes: NativeNotifyOutcome[]): { notify: ProximityNotify; calls: Parameters<ProximityNotify>[0][] } {
  const calls: Parameters<ProximityNotify>[0][] = [];
  let i = 0;
  return {
    calls,
    notify: async (n) => {
      calls.push(n);
      return outcomes[i++] ?? 'delivered';
    },
  };
}

test('only delivered notices are returned for marking as alerted (R4-BUG-002)', async () => {
  const { notify } = recorder(['delivered', 'rate_limited', 'failed']);
  const delivered = await dispatchProximityNotices([notice('a'), notice('b'), notice('c')], notify);
  assert.deepEqual(delivered, ['a']);
});

test('a rate-limited or unavailable notice is never marked, so the next scan retries it', async () => {
  for (const outcome of ['rate_limited', 'failed', 'unavailable'] as const) {
    const { notify } = recorder([outcome]);
    assert.deepEqual(await dispatchProximityNotices([notice('evac', 'critical')], notify), []);
  }
});

test('more than the threshold of new notices are coalesced into one summary naming them all', async () => {
  const pending = Array.from({ length: PROXIMITY_SUMMARY_THRESHOLD + 1 }, (_, i) => notice(`n${i}`, i === 2 ? 'critical' : 'normal'));
  const { notify, calls } = recorder(['delivered']);
  const delivered = await dispatchProximityNotices(pending, notify);
  assert.equal(calls.length, 1, 'one summary notification');
  assert.equal(calls[0]?.priority, 'critical', 'summary takes the highest priority among its members');
  assert.equal(calls[0]?.sound, 'Basso');
  for (const n of pending) assert.ok(calls[0]?.body.includes(n.title), `summary names ${n.title}`);
  assert.deepEqual(delivered.sort(), pending.map((n) => n.id).sort());
});

test('an undelivered summary marks nothing', async () => {
  const pending = Array.from({ length: PROXIMITY_SUMMARY_THRESHOLD + 2 }, (_, i) => notice(`n${i}`));
  const { notify } = recorder(['rate_limited']);
  assert.deepEqual(await dispatchProximityNotices(pending, notify), []);
});
