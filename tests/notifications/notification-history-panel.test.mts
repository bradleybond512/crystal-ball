/**
 * Tests for the NotificationProvenanceService methods the
 * NotificationHistoryPanel relies on: getAll(), getByDomain(),
 * getStats(), and subscribe(). Tests the service integration (not the
 * DOM) per the spec.
 *
 * Run with: npx tsx --test tests/notifications/notification-history-panel.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  NotificationProvenanceService,
  __resetNotificationProvenanceSingleton,
  type NotificationLike,
  type ProvenanceDriverScore,
} from '../../src/services/notifications/notification-provenance.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    sourceId: 'src',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'M6.5 — offshore',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function notif(overrides: Partial<NotificationLike> = {}): NotificationLike {
  return {
    notificationId: 'n-1',
    title: 'Quake near coast',
    domain: 'earthquake',
    sentAt: NOW,
    ...overrides,
  };
}

const driverScores: ProvenanceDriverScore[] = [
  { driverId: 'mag', score: 0.75, label: 'earthquake magnitude' },
];

function freshService(now = NOW): NotificationProvenanceService {
  __storage.clear();
  __resetNotificationProvenanceSingleton();
  return new NotificationProvenanceService({ clock: () => now });
}

function recordOne(
  svc: NotificationProvenanceService,
  notification: Partial<NotificationLike> = {},
  observation: Partial<ObservationEvent> = {},
  finalScore = 0.82,
): void {
  svc.record(notif(notification), obs(observation), ['c-1'], driverScores, finalScore, 0.7);
}

// ── getAll() — newest-first, defensive copies ──────────────────────

test('getAll returns empty array when no records have been written', () => {
  const svc = freshService();
  assert.deepEqual(svc.getAll(), []);
});

test('getAll returns records in LIFO (newest-first) order', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'first', sentAt: NOW });
  recordOne(svc, { notificationId: 'second', sentAt: NOW + 1000 });
  recordOne(svc, { notificationId: 'third', sentAt: NOW + 2000 });
  const all = svc.getAll();
  assert.deepEqual(all.map((r) => r.notificationId), ['third', 'second', 'first']);
});

test('getAll returns defensive copies — mutating result does not affect store', () => {
  const svc = freshService();
  recordOne(svc);
  const copy = svc.getAll();
  copy[0]!.title = 'mutated';
  copy[0]!.correlationIds.push('zzz');
  const refetched = svc.getAll();
  assert.notEqual(refetched[0]!.title, 'mutated');
  assert.ok(!refetched[0]!.correlationIds.includes('zzz'));
});

test('getAll includes both delivered and suppressed records', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b', suppressedByQuietHours: true });
  recordOne(svc, { notificationId: 'c', suppressedByTrustBudget: true });
  assert.equal(svc.getAll().length, 3);
});

// ── getByDomain() — filter by domain field ──────────────────────────

test('getByDomain returns only records for the named domain', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'eq-1', domain: 'earthquake' });
  recordOne(svc, { notificationId: 'wx-1', domain: 'weather' });
  recordOne(svc, { notificationId: 'eq-2', domain: 'earthquake' });
  const eq = svc.getByDomain('earthquake');
  assert.equal(eq.length, 2);
  assert.ok(eq.every((r) => r.domain === 'earthquake'));
});

test('getByDomain returns empty array for unknown domain', () => {
  const svc = freshService();
  recordOne(svc);
  assert.deepEqual(svc.getByDomain('does-not-exist'), []);
});

test('getByDomain preserves newest-first ordering within the filtered slice', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'old', domain: 'earthquake', sentAt: NOW });
  recordOne(svc, { notificationId: 'wx', domain: 'weather', sentAt: NOW + 500 });
  recordOne(svc, { notificationId: 'new', domain: 'earthquake', sentAt: NOW + 1000 });
  const eq = svc.getByDomain('earthquake');
  assert.deepEqual(eq.map((r) => r.notificationId), ['new', 'old']);
});

test('getByDomain returns defensive copies', () => {
  const svc = freshService();
  recordOne(svc);
  const result = svc.getByDomain('earthquake');
  result[0]!.title = 'mutated';
  assert.notEqual(svc.getByDomain('earthquake')[0]!.title, 'mutated');
});

// ── getStats() — total / delivered / suppressed / byDomain ──────────

test('getStats on empty store reports zeros', () => {
  const svc = freshService();
  const stats = svc.getStats();
  assert.equal(stats.total, 0);
  assert.equal(stats.delivered, 0);
  assert.equal(stats.suppressed, 0);
  assert.deepEqual(stats.byDomain, {});
});

test('getStats: total counts every record regardless of suppression', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b', suppressedByQuietHours: true });
  recordOne(svc, { notificationId: 'c', suppressedByTrustBudget: true });
  assert.equal(svc.getStats().total, 3);
});

test('getStats: delivered counts only records with no suppression flag', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b' });
  recordOne(svc, { notificationId: 'c', suppressedByQuietHours: true });
  assert.equal(svc.getStats().delivered, 2);
});

test('getStats: suppressed counts records with EITHER suppression flag', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'qh', suppressedByQuietHours: true });
  recordOne(svc, { notificationId: 'tb', suppressedByTrustBudget: true });
  recordOne(svc, { notificationId: 'both', suppressedByQuietHours: true, suppressedByTrustBudget: true });
  recordOne(svc, { notificationId: 'delivered' });
  assert.equal(svc.getStats().suppressed, 3);
});

test('getStats: delivered + suppressed === total', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b', suppressedByQuietHours: true });
  recordOne(svc, { notificationId: 'c', suppressedByTrustBudget: true });
  recordOne(svc, { notificationId: 'd' });
  const stats = svc.getStats();
  assert.equal(stats.delivered + stats.suppressed, stats.total);
});

test('getStats: byDomain counts each record exactly once per its domain', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'eq-1', domain: 'earthquake' });
  recordOne(svc, { notificationId: 'eq-2', domain: 'earthquake' });
  recordOne(svc, { notificationId: 'wx-1', domain: 'weather' });
  const { byDomain } = svc.getStats();
  assert.equal(byDomain.earthquake, 2);
  assert.equal(byDomain.weather, 1);
});

test('getStats: byDomain includes domains with only suppressed entries', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'sup', domain: 'cyber', suppressedByTrustBudget: true });
  const { byDomain } = svc.getStats();
  assert.equal(byDomain.cyber, 1);
});

// ── subscribe() — fires on each record() ────────────────────────────

test('subscribe fires on each record() call', () => {
  const svc = freshService();
  let count = 0;
  svc.subscribe(() => { count += 1; });
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b' });
  assert.equal(count, 2);
});

test('subscribe listener receives the latest snapshot', () => {
  const svc = freshService();
  const snapshots: number[] = [];
  svc.subscribe((records) => snapshots.push(records.length));
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b' });
  recordOne(svc, { notificationId: 'c' });
  assert.deepEqual(snapshots, [1, 2, 3]);
});

test('subscribe returns an unsubscribe function that stops further fires', () => {
  const svc = freshService();
  let count = 0;
  const unsub = svc.subscribe(() => { count += 1; });
  recordOne(svc, { notificationId: 'a' });
  unsub();
  recordOne(svc, { notificationId: 'b' });
  recordOne(svc, { notificationId: 'c' });
  assert.equal(count, 1);
});

test('subscribe listener exception does not break other listeners', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  recordOne(svc);
  assert.equal(secondCalled, true);
});

// ── Integration: panel-shaped query flow ─────────────────────────────

test('panel flow: getStats + getAll + getByDomain produce a consistent view', () => {
  const svc = freshService();
  // Three earthquake notifications, two delivered + one suppressed.
  recordOne(svc, { notificationId: 'eq-1', domain: 'earthquake' });
  recordOne(svc, { notificationId: 'eq-2', domain: 'earthquake' });
  recordOne(svc, { notificationId: 'eq-3', domain: 'earthquake', suppressedByQuietHours: true });
  // Two cyber notifications, one suppressed.
  recordOne(svc, { notificationId: 'cy-1', domain: 'cyber' });
  recordOne(svc, { notificationId: 'cy-2', domain: 'cyber', suppressedByTrustBudget: true });
  const stats = svc.getStats();
  assert.equal(stats.total, 5);
  assert.equal(stats.delivered, 3);
  assert.equal(stats.suppressed, 2);
  assert.equal(stats.byDomain.earthquake, 3);
  assert.equal(stats.byDomain.cyber, 2);
  assert.equal(svc.getAll().length, stats.total);
  assert.equal(svc.getByDomain('earthquake').length, stats.byDomain.earthquake);
  assert.equal(svc.getByDomain('cyber').length, stats.byDomain.cyber);
});

test('panel flow: filtering by "suppressed only" yields the suppressed slice', () => {
  const svc = freshService();
  recordOne(svc, { notificationId: 'a' });
  recordOne(svc, { notificationId: 'b', suppressedByQuietHours: true });
  recordOne(svc, { notificationId: 'c', suppressedByTrustBudget: true });
  recordOne(svc, { notificationId: 'd' });
  const all = svc.getAll();
  const suppressed = all.filter((r) => r.suppressedByQuietHours || r.suppressedByTrustBudget);
  assert.equal(suppressed.length, 2);
  assert.deepEqual(suppressed.map((r) => r.notificationId).sort(), ['b', 'c']);
});
