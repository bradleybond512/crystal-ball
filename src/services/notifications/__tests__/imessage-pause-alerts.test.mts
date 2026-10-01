// R4-BUG-001: skipped iMessage relays are traced, and the pause notice is sent
// once and only marked seen when macOS delivered it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createNotificationTraceRegistry } from '../../diagnostics/notification-trace.ts';
import type { ImessagePauseState } from '../../imessage-bridge.ts';
import type { NativeNotifyOutcome } from '../../native-notify.ts';
import {
  PAUSED_RELAY_REASON,
  notifyImessagePausedOnce,
  pausedNotice,
  recordPausedImessageRelay,
} from '../imessage-pause-alerts.ts';

const PAUSED: ImessagePauseState = { paused: true, hint: '…9999', since: 1, notified: false };
const NOT_PAUSED: ImessagePauseState = { paused: false };

function relayDeps(state: ImessagePauseState) {
  const registry = createNotificationTraceRegistry({ now: () => 1_000 });
  return { registry, deps: { registry: () => registry, pauseState: () => state, now: () => 1_000 } };
}

test('the reason is the documented, stable code', () => {
  assert.equal(PAUSED_RELAY_REASON, 'imessage_paused_reauthorization_required');
});

test('a critical relay skipped while paused is an unsafe suppression', () => {
  const { registry, deps } = relayDeps(PAUSED);
  assert.equal(recordPausedImessageRelay({ source: 'eew-tier5', urgency: 'critical', headline: 'M8.0' }, deps), true);
  const [entry] = registry.all();
  assert.ok(entry);
  assert.equal(entry.decision, 'suppressed');
  assert.equal(entry.decisionReason, PAUSED_RELAY_REASON);
  assert.equal(entry.candidate.domain, 'system');
  assert.equal(entry.candidate.safetyCritical, true);
  assert.equal(entry.candidate.headline, 'M8.0');
  assert.match(entry.candidate.candidateId, /^imessage-paused:eew-tier5:1000:\d+$/);
  const summary = registry.summary();
  assert.deepEqual(summary.unsafeSuppressions.map((u) => u.reason), [PAUSED_RELAY_REASON]);
});

test('a high relay skipped while paused is traced but not safety-critical', () => {
  const { registry, deps } = relayDeps(PAUSED);
  recordPausedImessageRelay({ source: 'breaking-news', urgency: 'high' }, deps);
  recordPausedImessageRelay({ source: 'breaking-news', urgency: 'high' }, deps);
  const entries = registry.all();
  assert.equal(entries.length, 2, 'ids stay unique within one millisecond');
  assert.equal(entries[0]?.candidate.safetyCritical, false);
  assert.equal(entries[0]?.candidate.headline, undefined);
  assert.equal(registry.summary().unsafeSuppressions.length, 0);
});

test('nothing is recorded when iMessage is not paused', () => {
  const { registry, deps } = relayDeps(NOT_PAUSED);
  assert.equal(recordPausedImessageRelay({ source: 'eew-tier5', urgency: 'critical' }, deps), false);
  assert.equal(registry.all().length, 0);
});

test('a failing registry never breaks the alert path', () => {
  const deps = { registry: () => { throw new Error('boom'); }, pauseState: () => PAUSED, now: () => 1 };
  assert.equal(recordPausedImessageRelay({ source: 'eew-tier5', urgency: 'critical' }, deps as never), false);
});

function noticeDeps(state: ImessagePauseState, outcome: NativeNotifyOutcome) {
  const sent: unknown[] = [];
  let marked = 0;
  return {
    sent,
    marked: () => marked,
    deps: {
      pauseState: () => state,
      notify: async (notification: unknown) => { sent.push(notification); return outcome; },
      markNotified: () => { marked += 1; },
    },
  };
}

test('the pause notice is marked seen only when macOS delivered it', async () => {
  const delivered = noticeDeps(PAUSED, 'delivered');
  assert.equal(await notifyImessagePausedOnce(delivered.deps), 'delivered');
  assert.deepEqual(delivered.sent, [pausedNotice('…9999')]);
  assert.equal(delivered.marked(), 1);
  for (const outcome of ['rate_limited', 'failed', 'unavailable'] as const) {
    const h = noticeDeps(PAUSED, outcome);
    assert.equal(await notifyImessagePausedOnce(h.deps), outcome);
    assert.equal(h.marked(), 0, `${outcome} is retried next launch`);
  }
});

test('no notice when not paused or already notified', async () => {
  for (const state of [NOT_PAUSED, { ...PAUSED, notified: true }]) {
    const h = noticeDeps(state, 'delivered');
    assert.equal(await notifyImessagePausedOnce(h.deps), 'not_needed');
    assert.equal(h.sent.length, 0);
  }
});

test('concurrent callers share one notice', async () => {
  const h = noticeDeps(PAUSED, 'delivered');
  const [a, b] = await Promise.all([notifyImessagePausedOnce(h.deps), notifyImessagePausedOnce(h.deps)]);
  assert.equal(a, 'delivered');
  assert.equal(b, 'delivered');
  assert.equal(h.sent.length, 1);
  assert.equal(h.marked(), 1);
});

test('the notice names the redacted hint, the way to resume, and a non-critical lane', () => {
  const notice = pausedNotice('…1234');
  assert.equal(notice.priority, 'high');
  assert.match(notice.body, /…1234/);
  assert.match(notice.body, /Settings → General/);
});
