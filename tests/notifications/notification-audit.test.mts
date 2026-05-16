import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNotificationAuditService,
  STORAGE_KEY,
  RING_BUFFER_LIMIT,
  type NotificationRecord,
} from '../../src/services/notifications/notification-audit.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = 1_745_000_000_000;

function baseInput(overrides: Partial<Omit<NotificationRecord, 'id'>> = {}): Omit<NotificationRecord, 'id'> {
  return {
    domain: 'earthquake',
    severity: 'high',
    title: 'M6.2 near Tokyo',
    body: 'Strong shaking',
    channels: ['system'],
    sentAt: new Date(NOW),
    wasSuppressed: false,
    producerName: 'EarthquakeProducer',
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-notification-audit"', () => {
  assert.equal(STORAGE_KEY, 'wm-notification-audit');
});

test('RING_BUFFER_LIMIT is 1000', () => {
  assert.equal(RING_BUFFER_LIMIT, 1000);
});

// ── record() ─────────────────────────────────────────────────────────────

test('record() assigns a unique id and stores the record', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const rec = svc.record(baseInput());
  assert.ok(rec.id);
  assert.equal(svc.getAll().length, 1);
  assert.equal(svc.getAll()[0]!.id, rec.id);
});

test('record() ids are unique across multiple calls', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) ids.add(svc.record(baseInput()).id);
  assert.equal(ids.size, 5);
});

test('record() sets wasSuppressed=false by default in stored record', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const rec = svc.record(baseInput({ wasSuppressed: false }));
  assert.equal(rec.wasSuppressed, false);
});

test('record() preserves full provenance fields', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const rec = svc.record(baseInput({
    alertId: 'a-1', situationId: 's-7', ruleId: 'rule-42',
  }));
  assert.equal(rec.alertId, 'a-1');
  assert.equal(rec.situationId, 's-7');
  assert.equal(rec.ruleId, 'rule-42');
});

// ── recordSuppressed() ───────────────────────────────────────────────────

test('recordSuppressed() forces wasSuppressed=true regardless of input', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const rec = svc.recordSuppressed(baseInput({ wasSuppressed: false }), 'quiet-hours');
  assert.equal(rec.wasSuppressed, true);
  assert.equal(rec.suppressedBy, 'quiet-hours');
});

test('recordSuppressed() supports rate-limit/threshold/user-muted reasons', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.recordSuppressed(baseInput(), 'rate-limit');
  svc.recordSuppressed(baseInput(), 'threshold');
  svc.recordSuppressed(baseInput(), 'user-muted');
  const reasons = svc.getSuppressed().map((r) => r.suppressedBy).sort();
  assert.deepEqual(reasons, ['rate-limit', 'threshold', 'user-muted']);
});

// ── getRecent() ──────────────────────────────────────────────────────────

test('getRecent() defaults to 24h window', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ sentAt: new Date(NOW - 23 * 60 * 60_000) }));
  svc.record(baseInput({ sentAt: new Date(NOW - 25 * 60 * 60_000) }));
  const recent = svc.getRecent(undefined, NOW);
  assert.equal(recent.length, 1);
});

test('getRecent(sinceMs) honors custom window', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ sentAt: new Date(NOW - 30 * 60_000) }));  // 30m old
  svc.record(baseInput({ sentAt: new Date(NOW - 90 * 60_000) }));  // 90m old
  const oneHour = svc.getRecent(60 * 60_000, NOW);
  assert.equal(oneHour.length, 1);
});

test('getRecent() returns newest-first', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ title: 'older', sentAt: new Date(NOW - 60_000) }));
  svc.record(baseInput({ title: 'newer', sentAt: new Date(NOW - 1_000) }));
  const recent = svc.getRecent(undefined, NOW);
  assert.equal(recent[0]!.title, 'newer');
});

// ── getByDomain() / getSuppressed() ──────────────────────────────────────

test('getByDomain() filters to the named domain', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ domain: 'earthquake' }));
  svc.record(baseInput({ domain: 'weather' }));
  svc.record(baseInput({ domain: 'weather' }));
  assert.equal(svc.getByDomain('weather').length, 2);
  assert.equal(svc.getByDomain('earthquake').length, 1);
});

test('getByDomain() returns empty array for unknown domain', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  assert.equal(svc.getByDomain('aliens').length, 0);
});

test('getSuppressed() returns only wasSuppressed=true records', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  svc.recordSuppressed(baseInput(), 'quiet-hours');
  svc.recordSuppressed(baseInput(), 'rate-limit');
  assert.equal(svc.getSuppressed().length, 2);
  assert.ok(svc.getSuppressed().every((r) => r.wasSuppressed));
});

// ── markRead / unreadCount ───────────────────────────────────────────────

test('unreadCount() reflects records with no readAt', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  svc.record(baseInput());
  assert.equal(svc.unreadCount(), 2);
});

test('markRead() sets readAt and decrements unreadCount', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const a = svc.record(baseInput());
  svc.record(baseInput());
  svc.markRead(a.id);
  assert.equal(svc.unreadCount(), 1);
  const found = svc.getAll().find((r) => r.id === a.id)!;
  assert.ok(found.readAt instanceof Date);
});

test('markRead() on unknown id is a no-op (does not throw)', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  svc.markRead('nope');
  assert.equal(svc.unreadCount(), 1);
});

test('markAllRead() zeroes unreadCount', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  svc.record(baseInput());
  svc.markAllRead();
  assert.equal(svc.unreadCount(), 0);
});

// ── stats() ──────────────────────────────────────────────────────────────

test('stats() returns total / sent / suppressed counts', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  svc.record(baseInput());
  svc.recordSuppressed(baseInput(), 'quiet-hours');
  const s = svc.stats(undefined, NOW);
  assert.equal(s.total, 3);
  assert.equal(s.sent, 2);
  assert.equal(s.suppressed, 1);
});

test('stats().byDomain counts each domain', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ domain: 'earthquake' }));
  svc.record(baseInput({ domain: 'earthquake' }));
  svc.record(baseInput({ domain: 'weather' }));
  const s = svc.stats(undefined, NOW);
  assert.equal(s.byDomain.earthquake, 2);
  assert.equal(s.byDomain.weather, 1);
});

test('stats().bySuppressReason groups suppression reasons', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.recordSuppressed(baseInput(), 'quiet-hours');
  svc.recordSuppressed(baseInput(), 'quiet-hours');
  svc.recordSuppressed(baseInput(), 'rate-limit');
  const s = svc.stats(undefined, NOW);
  assert.equal(s.bySuppressReason['quiet-hours'], 2);
  assert.equal(s.bySuppressReason['rate-limit'], 1);
});

test('stats().byChannel counts each channel a record was sent on', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ channels: ['system', 'menubar'] }));
  svc.record(baseInput({ channels: ['system', 'sms'] }));
  const s = svc.stats(undefined, NOW);
  assert.equal(s.byChannel.system, 2);
  assert.equal(s.byChannel.menubar, 1);
  assert.equal(s.byChannel.sms, 1);
});

test('stats(sinceMs) only counts records inside the window', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput({ sentAt: new Date(NOW - 30 * 60_000) }));
  svc.record(baseInput({ sentAt: new Date(NOW - 90 * 60_000) }));
  const s = svc.stats(60 * 60_000, NOW);
  assert.equal(s.total, 1);
});

// ── ring buffer ──────────────────────────────────────────────────────────

test('ring buffer caps at RING_BUFFER_LIMIT records', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  for (let i = 0; i < RING_BUFFER_LIMIT + 1; i++) {
    svc.record(baseInput({ title: `n-${i}` }));
  }
  assert.equal(svc.getAll().length, RING_BUFFER_LIMIT);
});

test('ring buffer drops oldest record at overflow', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  const oldest = svc.record(baseInput({ title: 'oldest' }));
  for (let i = 0; i < RING_BUFFER_LIMIT; i++) {
    svc.record(baseInput({ title: `n-${i}` }));
  }
  assert.ok(!svc.getAll().some((r) => r.id === oldest.id));
});

// ── clear() / subscribe() ────────────────────────────────────────────────

test('clear() empties the store and zeroes unread', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput()); svc.record(baseInput());
  svc.clear();
  assert.equal(svc.getAll().length, 0);
  assert.equal(svc.unreadCount(), 0);
});

test('subscribe() fires on record(), recordSuppressed(), markRead(), clear()', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const a = svc.record(baseInput());
  svc.recordSuppressed(baseInput(), 'quiet-hours');
  svc.markRead(a.id);
  svc.clear();
  assert.equal(calls, 4);
});

test('subscribe() returns an unsubscribe function', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.record(baseInput());
  off();
  svc.record(baseInput());
  assert.equal(calls, 1);
});

// ── localStorage persistence ─────────────────────────────────────────────

test('persists records to localStorage under STORAGE_KEY', () => {
  const storage = createMemoryStorage();
  const svc = createNotificationAuditService(storage);
  svc.record(baseInput({ title: 'persist-me' }));
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  assert.ok(raw!.includes('persist-me'));
});

test('rehydrates records from existing localStorage on construction', () => {
  const storage = createMemoryStorage();
  const svc1 = createNotificationAuditService(storage);
  svc1.record(baseInput({ title: 'survives' }));
  const svc2 = createNotificationAuditService(storage);
  assert.equal(svc2.getAll().length, 1);
  assert.equal(svc2.getAll()[0]!.title, 'survives');
});

test('rehydrated records have Date instances for sentAt', () => {
  const storage = createMemoryStorage();
  const svc1 = createNotificationAuditService(storage);
  svc1.record(baseInput({ sentAt: new Date(NOW) }));
  const svc2 = createNotificationAuditService(storage);
  assert.ok(svc2.getAll()[0]!.sentAt instanceof Date);
});

// ── shape integrity ─────────────────────────────────────────────────────

test('getAll() returns an immutable snapshot — caller mutation does not bleed into store', () => {
  const svc = createNotificationAuditService(createMemoryStorage());
  svc.record(baseInput());
  const snap = svc.getAll();
  snap[0]!.title = 'mutated';
  assert.notEqual(svc.getAll()[0]!.title, 'mutated');
});
