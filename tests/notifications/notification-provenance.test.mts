/**
 * Tests for NotificationProvenanceService — Phase 4 "why was this alert sent?".
 *
 * Run with: npx tsx --test tests/notifications/notification-provenance.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
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
  __internals as serviceInternals,
  __resetNotificationProvenanceSingleton,
  buildExplanation,
  getNotificationProvenanceService,
  type NotificationLike,
  type ProvenanceDriverScore,
} from '../../src/services/notifications/notification-provenance.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    sourceId: 'src-a',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'M6.5 — offshore',
    raw: { magnitude: 6.5 },
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function notif(overrides: Partial<NotificationLike> = {}): NotificationLike {
  return {
    notificationId: 'notif-1',
    title: 'Quake near coast',
    domain: 'earthquake',
    sentAt: NOW,
    ...overrides,
  };
}

function freshService(now = NOW): NotificationProvenanceService {
  __storage.clear();
  __resetNotificationProvenanceSingleton();
  return new NotificationProvenanceService({ clock: () => now });
}

function defaultDrivers(): ProvenanceDriverScore[] {
  return [
    { driverId: 'mag', score: 0.75, label: 'earthquake magnitude' },
    { driverId: 'depth', score: 0.30, label: 'depth contribution' },
  ];
}

// ── record() basics ───────────────────────────────────────────────────

test('record() stores a ProvenanceRecord retrievable by notificationId', () => {
  const svc = freshService();
  svc.record(notif(), obs(), ['corr-1'], defaultDrivers(), 0.82, 0.7);
  const r = svc.getRecord('notif-1');
  assert.ok(r);
  assert.equal(r.notificationId, 'notif-1');
  assert.equal(r.title, 'Quake near coast');
  assert.equal(r.finalScore, 0.82);
  assert.equal(r.thresholdUsed, 0.7);
});

test('record() preserves trigger observation, correlations, and driver scores', () => {
  const svc = freshService();
  const driverScores = defaultDrivers();
  svc.record(notif(), obs({ id: 'trig-x' }), ['c1', 'c2'], driverScores, 0.9, 0.7);
  const r = svc.getRecord('notif-1')!;
  assert.equal(r.triggerObservation.id, 'trig-x');
  assert.deepEqual(r.correlationIds, ['c1', 'c2']);
  assert.equal(r.driverScores.length, 2);
  assert.equal(r.driverScores[0].driverId, 'mag');
});

test('record() defaults sentAt to the engine clock when omitted', () => {
  const svc = freshService(NOW + 12_345);
  svc.record(
    notif({ sentAt: undefined }),
    obs(),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  assert.equal(svc.getRecord('notif-1')?.sentAt, NOW + 12_345);
});

test('record() returns a defensive copy', () => {
  const svc = freshService();
  const drivers = defaultDrivers();
  const stored = svc.record(notif(), obs(), ['c1'], drivers, 0.8, 0.7);
  stored.correlationIds.push('mutated');
  stored.driverScores[0]!.score = 99;
  const r = svc.getRecord('notif-1')!;
  assert.deepEqual(r.correlationIds, ['c1']);
  assert.equal(r.driverScores[0].score, 0.75);
});

test('record() replaces an existing record with the same notificationId', () => {
  const svc = freshService();
  svc.record(notif({ title: 'first' }), obs(), [], defaultDrivers(), 0.8, 0.7);
  svc.record(notif({ title: 'second' }), obs(), [], defaultDrivers(), 0.85, 0.7);
  assert.equal(svc.getRecent(10).length, 1);
  assert.equal(svc.getRecord('notif-1')?.title, 'second');
});

test('record() persists to localStorage', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  const raw = __storage.get(serviceInternals.STORAGE_KEY);
  assert.ok(raw);
});

// ── explanation synthesis ─────────────────────────────────────────────

test('record() synthesises an explanation when notification.explanation is omitted', () => {
  const svc = freshService();
  svc.record(notif(), obs(), ['c-1'], defaultDrivers(), 0.82, 0.7);
  const r = svc.getRecord('notif-1')!;
  assert.match(r.explanation, /earthquake/);
  assert.match(r.explanation, /0\.82/);
  assert.match(r.explanation, /0\.70/);
});

test('record() uses an explicit explanation when provided', () => {
  const svc = freshService();
  svc.record(
    notif({ explanation: 'custom story' }),
    obs(),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  assert.equal(svc.getRecord('notif-1')?.explanation, 'custom story');
});

test('buildExplanation mentions suppression by quiet hours', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'cyber',
    triggerObservation: obs(),
    correlationIds: [],
    driverScores: [],
    finalScore: 0.9,
    thresholdUsed: 0.6,
    suppressedByQuietHours: true,
    suppressedByTrustBudget: false,
  });
  assert.match(text, /quiet hours/i);
});

test('buildExplanation mentions suppression by trust budget', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'cyber',
    triggerObservation: obs(),
    correlationIds: [],
    driverScores: [],
    finalScore: 0.9,
    thresholdUsed: 0.6,
    suppressedByQuietHours: false,
    suppressedByTrustBudget: true,
  });
  assert.match(text, /trust budget/i);
});

test('buildExplanation mentions both suppressions together', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'cyber',
    triggerObservation: obs(),
    correlationIds: [],
    driverScores: [],
    finalScore: 0.9,
    thresholdUsed: 0.6,
    suppressedByQuietHours: true,
    suppressedByTrustBudget: true,
  });
  assert.match(text, /quiet hours/i);
  assert.match(text, /trust budget/i);
});

test('buildExplanation handles zero correlations + empty drivers gracefully', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'd',
    triggerObservation: obs(),
    correlationIds: [],
    driverScores: [],
    finalScore: 0.8,
    thresholdUsed: 0.6,
    suppressedByQuietHours: false,
    suppressedByTrustBudget: false,
  });
  assert.match(text, /no contributing correlations/);
  assert.match(text, /no driver contributions/);
});

test('buildExplanation reports the top 2 drivers by score', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'd',
    triggerObservation: obs(),
    correlationIds: [],
    driverScores: [
      { driverId: 'a', score: 0.3, label: 'A' },
      { driverId: 'b', score: 0.9, label: 'B' },
      { driverId: 'c', score: 0.6, label: 'C' },
    ],
    finalScore: 0.8,
    thresholdUsed: 0.5,
    suppressedByQuietHours: false,
    suppressedByTrustBudget: false,
  });
  // Top 2 by score = B (0.9) + C (0.6).
  assert.match(text, /B 0\.90/);
  assert.match(text, /C 0\.60/);
  assert.ok(!text.includes('A 0.30'));
});

test('buildExplanation truncates correlation lists after 3 ids', () => {
  const text = buildExplanation({
    title: 't',
    domain: 'd',
    triggerObservation: obs(),
    correlationIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
    driverScores: [],
    finalScore: 0.8,
    thresholdUsed: 0.5,
    suppressedByQuietHours: false,
    suppressedByTrustBudget: false,
  });
  assert.match(text, /c1, c2, c3, …/);
  assert.ok(!text.includes('c4'));
});

// ── getRecent ─────────────────────────────────────────────────────────

test('getRecent returns up to limit, newest-first', () => {
  const svc = freshService();
  for (let i = 0; i < 5; i++) {
    svc.record(
      notif({ notificationId: `n-${i}`, sentAt: NOW + i * 1000, title: `t-${i}` }),
      obs({ id: `o-${i}` }),
      [],
      defaultDrivers(),
      0.8,
      0.7,
    );
  }
  const recent = svc.getRecent(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].notificationId, 'n-4');
  assert.equal(recent[2].notificationId, 'n-2');
});

test('getRecent with limit=0 returns empty', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  assert.deepEqual(svc.getRecent(0), []);
});

test('getRecent default limit is 50', () => {
  const svc = freshService();
  for (let i = 0; i < 60; i++) {
    svc.record(
      notif({ notificationId: `n-${i}`, sentAt: NOW + i }),
      obs({ id: `o-${i}` }),
      [],
      defaultDrivers(),
      0.8,
      0.7,
    );
  }
  assert.equal(svc.getRecent().length, 50);
});

// ── search ────────────────────────────────────────────────────────────

test('search matches title, domain, and explanation substrings (case-insensitive)', () => {
  const svc = freshService();
  svc.record(
    notif({ notificationId: 'n-1', title: 'TSUNAMI warning', domain: 'weather' }),
    obs(),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  svc.record(
    notif({ notificationId: 'n-2', title: 'cyber probe', domain: 'cyber' }),
    obs(),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  assert.equal(svc.search('tsunami').length, 1);
  assert.equal(svc.search('CYBER').length, 1);
  assert.equal(svc.search('weather').length, 1);
});

test('search returns empty for empty / whitespace queries', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  assert.deepEqual(svc.search(''), []);
  assert.deepEqual(svc.search('   '), []);
});

test('search returns empty for queries with no matches', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  assert.deepEqual(svc.search('zzz-no-match'), []);
});

test('search hits a synthesised explanation snippet', () => {
  const svc = freshService();
  // Synth explanation contains the trigger observation title.
  svc.record(
    notif({ notificationId: 'n-1', title: 'alert', domain: 'cyber' }),
    obs({ title: 'unique-trigger-phrase' }),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  assert.equal(svc.search('unique-trigger-phrase').length, 1);
});

// ── explain ──────────────────────────────────────────────────────────

test('explain returns the stored explanation paragraph', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  const text = svc.explain('notif-1');
  assert.ok(text.length > 0);
});

test('explain returns empty string for unknown notificationId', () => {
  const svc = freshService();
  assert.equal(svc.explain('does-not-exist'), '');
});

// ── Ring buffer + persistence ────────────────────────────────────────

test('ring buffer at MAX_RECORDS + 1 drops the oldest record', () => {
  const svc = freshService();
  const max = serviceInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    svc.record(
      notif({ notificationId: `n-${i}`, sentAt: NOW + i }),
      obs({ id: `o-${i}` }),
      [],
      defaultDrivers(),
      0.8,
      0.7,
    );
  }
  // Oldest (n-0) should have been evicted.
  assert.equal(svc.getRecord('n-0'), undefined);
  assert.ok(svc.getRecord(`n-${max}`));
});

test('records survive a fresh instance hydrating from localStorage', () => {
  const a = freshService();
  a.record(notif(), obs(), ['c1'], defaultDrivers(), 0.8, 0.7);
  const b = new NotificationProvenanceService({ clock: () => NOW });
  assert.equal(b.getRecord('notif-1')?.title, 'Quake near coast');
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetNotificationProvenanceSingleton();
  __storage.set(serviceInternals.STORAGE_KEY, '{not valid');
  const svc = new NotificationProvenanceService({ clock: () => NOW });
  assert.deepEqual(svc.getRecent(10), []);
});

// ── Subscribe + singleton ────────────────────────────────────────────

test('subscribe fires on each record()', () => {
  const svc = freshService();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.record(notif({ notificationId: 'n-1' }), obs(), [], defaultDrivers(), 0.8, 0.7);
  svc.record(notif({ notificationId: 'n-2' }), obs(), [], defaultDrivers(), 0.8, 0.7);
  assert.equal(calls, 2);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  assert.equal(secondCalled, true);
});

test('getNotificationProvenanceService() returns a stable singleton', () => {
  __storage.clear();
  __resetNotificationProvenanceSingleton();
  const a = getNotificationProvenanceService();
  const b = getNotificationProvenanceService();
  assert.strictEqual(a, b);
});

// ── Suppression flag persistence ─────────────────────────────────────

test('suppression flags default to false', () => {
  const svc = freshService();
  svc.record(notif(), obs(), [], defaultDrivers(), 0.8, 0.7);
  const r = svc.getRecord('notif-1')!;
  assert.equal(r.suppressedByQuietHours, false);
  assert.equal(r.suppressedByTrustBudget, false);
});

test('suppression flags survive a record() call', () => {
  const svc = freshService();
  svc.record(
    notif({ suppressedByQuietHours: true, suppressedByTrustBudget: true }),
    obs(),
    [],
    defaultDrivers(),
    0.8,
    0.7,
  );
  const r = svc.getRecord('notif-1')!;
  assert.equal(r.suppressedByQuietHours, true);
  assert.equal(r.suppressedByTrustBudget, true);
});
