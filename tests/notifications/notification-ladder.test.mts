/**
 * Notification-ladder integration tests.
 *
 * Covers the cross-cutting behaviors on top of the producer layer:
 *   - escalation when severity rises for the same dedupe key
 *   - dedupe inside the configured window
 *   - rate limiting (≥15-min spacing) via ledger.listSince
 *   - multi-channel delivery (push + iMessage + voice fan-out)
 *
 * Pure — no Tauri / network. Everything routes through the
 * notification-ledger primitive + injected `send` adapters.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNotificationLedger,
  type NotificationLedger,
  type NotificationLedgerEntry,
} from '../../src/services/notifications/notification-ledger.ts';
import {
  firePushForEvent,
  type NotifiableEvent,
  type NotificationPayload,
} from '../../src/services/notifications/push-notifier.ts';

// ── Helpers ──────────────────────────────────────────────────────────────

const FIFTEEN_MIN_MS = 15 * 60_000;

function captureSend(): { fn: (p: NotificationPayload) => Promise<void>; calls: NotificationPayload[] } {
  const calls: NotificationPayload[] = [];
  return { calls, fn: async (p) => { calls.push(p); } };
}

/** Minimal multi-channel dispatcher: fans an entry out to push / sms /
 *  voice via injected per-channel `send` adapters. Models the production
 *  wiring without dragging in iMessage/voice modules. */
async function fanout(
  payload: NotificationPayload,
  channels: { push?: (p: NotificationPayload) => Promise<void>; sms?: (p: NotificationPayload) => Promise<void>; voice?: (p: NotificationPayload) => Promise<void> },
): Promise<{ push: number; sms: number; voice: number }> {
  let push = 0, sms = 0, voice = 0;
  if (channels.push) { await channels.push(payload); push += 1; }
  if (channels.sms) { await channels.sms(payload); sms += 1; }
  if (channels.voice) { await channels.voice(payload); voice += 1; }
  return { push, sms, voice };
}

/** Rate-limit gate: returns true if an entry with the same dedupeKey
 *  already exists within the past `windowMs`. */
function rateLimited(ledger: NotificationLedger, dedupeKey: string, windowMs: number, nowMs: number): boolean {
  const recent = ledger.listSince(nowMs - windowMs);
  return recent.some((e) => e.dedupeKey === dedupeKey);
}

// ── 1. Escalation (3 tests) ──────────────────────────────────────────────

test('ladder:escalation — same place at higher magnitude escalates from high to critical', async () => {
  const send = captureSend();
  const ledger = createNotificationLedger();
  // First event: M6.5 (high)
  await firePushForEvent(
    { kind: 'seismic', magnitude: 6.5, place: 'X', eventId: 'evt-1' },
    { send: send.fn, ledger, recordHistory: false },
  );
  // Second event: M8.5 (critical)
  await firePushForEvent(
    { kind: 'seismic', magnitude: 8.5, place: 'X', eventId: 'evt-2' },
    { send: send.fn, ledger, recordHistory: false },
  );
  const entries = ledger.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.threatLevel, 'high');
  assert.equal(entries[1]?.threatLevel, 'critical');
});

test('ladder:escalation — geomagnetic Kp 7 → 9 escalates medium → critical', async () => {
  const send = captureSend();
  const ledger = createNotificationLedger();
  await firePushForEvent({ kind: 'geomagnetic', kpIndex: 7, observedAt: '2026-05-13T00:00:00Z' }, { send: send.fn, ledger, recordHistory: false });
  await firePushForEvent({ kind: 'geomagnetic', kpIndex: 9, observedAt: '2026-05-13T01:00:00Z' }, { send: send.fn, ledger, recordHistory: false });
  const entries = ledger.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.threatLevel, 'medium');
  assert.equal(entries[1]?.threatLevel, 'critical');
});

test('ladder:escalation — CAP Severe → Extreme for same alertId promotes level', async () => {
  const send = captureSend();
  const ledger = createNotificationLedger();
  await firePushForEvent(
    { kind: 'cap', severity: 'Severe',  urgency: 'Immediate', event: 'Tornado Warning', headline: 'x', areaDesc: 'y', alertId: 'NWS-1' },
    { send: send.fn, ledger, recordHistory: false },
  );
  await firePushForEvent(
    { kind: 'cap', severity: 'Extreme', urgency: 'Immediate', event: 'Tornado Warning', headline: 'x', areaDesc: 'y', alertId: 'NWS-1' },
    { send: send.fn, ledger, recordHistory: false },
  );
  // Without a dedupe window, both append. Latest entry is critical.
  const entries = ledger.list();
  assert.equal(entries[entries.length - 1]?.threatLevel, 'critical');
});

// ── 2. Dedupe (3 tests) ──────────────────────────────────────────────────

test('ladder:dedupe — same dedupeKey inside 30-min window collapses to first entry', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 30 * 60_000 });
  const base = Date.now();
  const first = ledger.append({
    channel: 'push',
    threatType: 'seismic_tier3',
    threatLevel: 'high',
    title: 'M6.5',
    body: 'x',
    dedupeKey: 'seismic:evt-A',
  }, { recordedAt: base });
  const second = ledger.append({
    channel: 'push',
    threatType: 'seismic_tier3',
    threatLevel: 'high',
    title: 'M6.5',
    body: 'x',
    dedupeKey: 'seismic:evt-A',
  }, { recordedAt: base + 5 * 60_000 });
  assert.equal(first.id, second.id);
  assert.equal(ledger.list().length, 1);
});

test('ladder:dedupe — same dedupeKey past window appends a fresh entry', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 30 * 60_000 });
  const base = Date.now();
  ledger.append({ channel: 'push', threatType: 'seismic_tier3', threatLevel: 'high', title: 't1', body: 'x', dedupeKey: 'k' }, { recordedAt: base });
  ledger.append({ channel: 'push', threatType: 'seismic_tier3', threatLevel: 'high', title: 't2', body: 'x', dedupeKey: 'k' }, { recordedAt: base + 60 * 60_000 });
  assert.equal(ledger.list().length, 2);
});

test('ladder:dedupe — independent dedupe keys are not collapsed', () => {
  const ledger = createNotificationLedger({ dedupeWindowMs: 30 * 60_000 });
  ledger.append({ channel: 'push', threatType: 'seismic_tier3', threatLevel: 'high', title: 'A', body: 'x', dedupeKey: 'k1' });
  ledger.append({ channel: 'push', threatType: 'cap_severe',    threatLevel: 'high', title: 'B', body: 'y', dedupeKey: 'k2' });
  assert.equal(ledger.list().length, 2);
});

// ── 3. Rate limit (3 tests) ──────────────────────────────────────────────

test('ladder:rate-limit — same dedupeKey within 15 min is rate-limited', () => {
  const ledger = createNotificationLedger();
  const t0 = 1_715_000_000_000;
  ledger.append({ channel: 'push', threatType: 'cap_extreme', threatLevel: 'critical', title: 'x', body: 'y', dedupeKey: 'cap:storm-A' }, { recordedAt: t0 });
  // Same key 10 min later → rate limited
  assert.equal(rateLimited(ledger, 'cap:storm-A', FIFTEEN_MIN_MS, t0 + 10 * 60_000), true);
});

test('ladder:rate-limit — same dedupeKey after 15 min is not rate-limited', () => {
  const ledger = createNotificationLedger();
  const t0 = 1_715_000_000_000;
  ledger.append({ channel: 'push', threatType: 'cap_extreme', threatLevel: 'critical', title: 'x', body: 'y', dedupeKey: 'cap:storm-A' }, { recordedAt: t0 });
  assert.equal(rateLimited(ledger, 'cap:storm-A', FIFTEEN_MIN_MS, t0 + 16 * 60_000), false);
});

test('ladder:rate-limit — distinct dedupeKey within window is not rate-limited', () => {
  const ledger = createNotificationLedger();
  const t0 = 1_715_000_000_000;
  ledger.append({ channel: 'push', threatType: 'cap_extreme', threatLevel: 'critical', title: 'x', body: 'y', dedupeKey: 'cap:storm-A' }, { recordedAt: t0 });
  assert.equal(rateLimited(ledger, 'cap:storm-B', FIFTEEN_MIN_MS, t0 + 5 * 60_000), false);
});

// ── 4. Multi-channel delivery (3 tests) ──────────────────────────────────

test('ladder:multi-channel — push + sms + voice all fire when all 3 configured', async () => {
  const ledger = createNotificationLedger();
  const push = captureSend();
  const sms = captureSend();
  const voice = captureSend();
  const evt: NotifiableEvent = { kind: 'seismic', magnitude: 7.5, place: 'X' };
  const res = await firePushForEvent(evt, { send: push.fn, ledger, recordHistory: false });
  assert.equal(res.fired, true);
  const counts = await fanout(push.calls[0]!, { push: push.fn, sms: sms.fn, voice: voice.fn });
  assert.equal(counts.push, 1);
  assert.equal(counts.sms, 1);
  assert.equal(counts.voice, 1);
  // Push channel was already counted once during firePushForEvent — fanout
  // is a separate stage, so the captureSend ring shows 2 calls (one each).
  assert.equal(push.calls.length, 2);
  assert.equal(sms.calls.length, 1);
  assert.equal(voice.calls.length, 1);
});

test('ladder:multi-channel — only push fires when sms + voice not configured', async () => {
  const push = captureSend();
  const sms = captureSend();
  const voice = captureSend();
  const payload: NotificationPayload = {
    title: 'x', body: 'y', sound: 'Basso',
    threatType: 'cap_extreme', threatLevel: 'critical', dedupeKey: 'k',
  };
  const counts = await fanout(payload, { push: push.fn });
  assert.equal(counts.push, 1);
  assert.equal(counts.sms, 0);
  assert.equal(counts.voice, 0);
});

test('ladder:multi-channel — same payload shape reaches every channel adapter', async () => {
  const push = captureSend();
  const sms = captureSend();
  const voice = captureSend();
  const payload: NotificationPayload = {
    title: 'M7.5 earthquake',
    body: 'M7.5 near Test',
    sound: 'Basso',
    threatType: 'seismic_tier4',
    threatLevel: 'critical',
    dedupeKey: 'seismic:abc',
  };
  await fanout(payload, { push: push.fn, sms: sms.fn, voice: voice.fn });
  assert.equal(push.calls[0]!.title, sms.calls[0]!.title);
  assert.equal(push.calls[0]!.title, voice.calls[0]!.title);
  assert.equal(push.calls[0]!.dedupeKey, 'seismic:abc');
});

// ── 5. Ledger persistence round-trip (2 tests) ───────────────────────────

test('ladder:persistence — serialize → loadJson preserves entries', () => {
  const a = createNotificationLedger();
  a.append({ channel: 'push', threatType: 'cap_extreme', threatLevel: 'critical', title: 't1', body: 'b1', dedupeKey: 'k1' });
  a.append({ channel: 'push', threatType: 'seismic_tier3', threatLevel: 'high', title: 't2', body: 'b2', dedupeKey: 'k2' });
  const json = a.serialize();
  const b = createNotificationLedger();
  b.loadJson(json);
  assert.equal(b.list().length, 2);
});

test('ladder:persistence — loadJson rejects malformed payload without throwing', () => {
  const a = createNotificationLedger();
  a.append({ channel: 'push', threatType: 'cap_extreme', threatLevel: 'critical', title: 't', body: 'b', dedupeKey: 'k' });
  // Corrupt JSON
  a.loadJson('not json at all');
  assert.equal(a.list().length, 0);
});

// ── 6. listSince filtering (1 test) ──────────────────────────────────────

test('ladder:listSince — returns only entries strictly after cutoff', () => {
  const ledger = createNotificationLedger();
  const t0 = 1_715_000_000_000;
  ledger.append({ channel: 'push', threatType: 'cap_severe', threatLevel: 'high', title: 'old', body: 'x', dedupeKey: 'k1' }, { recordedAt: t0 });
  ledger.append({ channel: 'push', threatType: 'cap_severe', threatLevel: 'high', title: 'mid', body: 'x', dedupeKey: 'k2' }, { recordedAt: t0 + 10_000 });
  ledger.append({ channel: 'push', threatType: 'cap_severe', threatLevel: 'high', title: 'new', body: 'x', dedupeKey: 'k3' }, { recordedAt: t0 + 20_000 });
  const since = ledger.listSince(t0 + 5_000);
  assert.equal(since.length, 2);
  assert.deepEqual(since.map((e: NotificationLedgerEntry) => e.title), ['mid', 'new']);
});
