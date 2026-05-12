import assert from 'node:assert/strict';
import test from 'node:test';

import { prioritize, type PrioritizedEvent } from '../prioritizer.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-1',
    sourceId: 'test',
    domain: 'seismic',
    timestamp: BASE_NOW - 60_000,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makePlace(lat: number, lon: number): SavedPlace {
  return {
    id: 'p1',
    name: 'Home',
    lat,
    lon,
    radiusKm: 100,
    tags: [],
    priority: 1,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual' as SavedPlace['source'],
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── Severity scoring ────────────────────────────────────────────────────────

test('CRITICAL severity gets +30 score contribution', () => {
  const events = [makeEvent({ severity: 'CRITICAL', id: 'crit' })];
  const result = prioritize(events, [], {}, BASE_NOW);
  // No proximity, no recency beyond 2h — only severity contributes
  assert.ok(result[0].relevanceScore >= 30, `expected ≥30, got ${result[0].relevanceScore}`);
});

test('INFO severity contributes 0 severity points', () => {
  const events = [makeEvent({ severity: 'INFO', timestamp: BASE_NOW - 3 * 60 * 60_000 })];
  const result = prioritize(events, [], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

test('severity order: CRITICAL > HIGH > MEDIUM > LOW > INFO', () => {
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
  const events = severities.map((s, i) =>
    makeEvent({ severity: s, id: `ev-${i}`, timestamp: BASE_NOW - 3 * 60 * 60_000 }),
  );
  const result = prioritize(events, [], {}, BASE_NOW);
  for (let i = 0; i < result.length - 1; i++) {
    assert.ok(
      result[i].relevanceScore >= result[i + 1].relevanceScore,
      `expected ${result[i].id} (${result[i].relevanceScore}) >= ${result[i + 1].id} (${result[i + 1].relevanceScore})`,
    );
  }
});

// ── Proximity scoring ───────────────────────────────────────────────────────

test('event within 100 km of a saved place gets +40 proximity bonus', () => {
  // La Porte IN ≈ 41.6, -86.7
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
    location: { lat: 41.6, lon: -86.7 },
  });
  const place = makePlace(41.6, -86.7); // exact same location → 0 km
  const result = prioritize([event], [place], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 40);
});

test('event 200 km away gets +25 proximity bonus', () => {
  // Chicago ≈ 41.85, -87.65 — roughly 300km from Detroit ≈ 42.33, -83.05
  // Use two points ~200km apart
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
    location: { lat: 41.85, lon: -87.65 }, // Chicago
  });
  const place = makePlace(43.05, -89.4); // ~200km NW
  const result = prioritize([event], [place], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 25);
});

test('event >500 km away gets 0 proximity bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
    location: { lat: 41.85, lon: -87.65 }, // Chicago
  });
  const place = makePlace(25.8, -80.2); // Miami — ~2100km
  const result = prioritize([event], [place], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

test('event without location gets 0 proximity bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
    // no location
  });
  const place = makePlace(41.6, -86.7);
  const result = prioritize([event], [place], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

// ── Recency scoring ─────────────────────────────────────────────────────────

test('event <5 min old gets +10 recency bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 2 * 60_000, // 2 min ago
  });
  const result = prioritize([event], [], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 10);
});

test('event <30 min old gets +5 recency bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 10 * 60_000, // 10 min ago
  });
  const result = prioritize([event], [], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 5);
});

test('event <2h old gets +2 recency bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 90 * 60_000, // 90 min ago
  });
  const result = prioritize([event], [], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 2);
});

test('event older than 2h gets 0 recency bonus', () => {
  const event = makeEvent({
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
  });
  const result = prioritize([event], [], {}, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

// ── Correlation bonus ───────────────────────────────────────────────────────

test('event in correlatedEventIds set gets +10 bonus', () => {
  const event = makeEvent({
    id: 'corr-1',
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
  });
  const result = prioritize([event], [], { correlatedEventIds: new Set(['corr-1']) }, BASE_NOW);
  assert.equal(result[0].relevanceScore, 10);
});

test('event not in correlatedEventIds gets 0 correlation bonus', () => {
  const event = makeEvent({
    id: 'other',
    severity: 'INFO',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
  });
  const result = prioritize([event], [], { correlatedEventIds: new Set(['corr-1']) }, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

// ── Domain weight multiplier ────────────────────────────────────────────────

test('domain weight of 2 doubles the raw score', () => {
  const event = makeEvent({
    domain: 'weather',
    severity: 'MEDIUM', // +10
    timestamp: BASE_NOW - 3 * 60 * 60_000,
  });
  const result = prioritize([event], [], { domainWeights: { weather: 2 } }, BASE_NOW);
  assert.equal(result[0].relevanceScore, 20); // 10 * 2
});

test('domain weight of 0 reduces score to 0', () => {
  const event = makeEvent({
    domain: 'noise',
    severity: 'CRITICAL',
    timestamp: BASE_NOW - 3 * 60 * 60_000,
  });
  const result = prioritize([event], [], { domainWeights: { noise: 0 } }, BASE_NOW);
  assert.equal(result[0].relevanceScore, 0);
});

// ── Sorting ─────────────────────────────────────────────────────────────────

test('events sorted by relevanceScore descending', () => {
  const events = [
    makeEvent({ id: 'low', severity: 'LOW', timestamp: BASE_NOW - 3 * 60 * 60_000 }),
    makeEvent({ id: 'crit', severity: 'CRITICAL', timestamp: BASE_NOW - 3 * 60 * 60_000 }),
    makeEvent({ id: 'med', severity: 'MEDIUM', timestamp: BASE_NOW - 3 * 60 * 60_000 }),
  ];
  const result = prioritize(events, [], {}, BASE_NOW);
  assert.equal(result[0].id, 'crit');
  assert.equal(result[1].id, 'med');
  assert.equal(result[2].id, 'low');
});

test('ties in score broken by timestamp descending (newer first)', () => {
  const events = [
    makeEvent({ id: 'older', severity: 'INFO', timestamp: BASE_NOW - 5 * 60 * 60_000 }),
    makeEvent({ id: 'newer', severity: 'INFO', timestamp: BASE_NOW - 4 * 60 * 60_000 }),
  ];
  const result = prioritize(events, [], {}, BASE_NOW);
  assert.equal(result[0].id, 'newer');
  assert.equal(result[1].id, 'older');
});

// ── Score cap ───────────────────────────────────────────────────────────────

test('relevanceScore is capped at 100', () => {
  // proximity(40) + severity(30) + recency(10) + corr(10) = 90 — weight 2 → 180, capped at 100
  const event = makeEvent({
    id: 'all-bonuses',
    domain: 'seismic',
    severity: 'CRITICAL',
    timestamp: BASE_NOW - 1_000, // <5 min
    location: { lat: 41.6, lon: -86.7 },
  });
  const place = makePlace(41.6, -86.7);
  const result = prioritize(
    [event],
    [place],
    { correlatedEventIds: new Set(['all-bonuses']), domainWeights: { seismic: 2 } },
    BASE_NOW,
  );
  assert.equal(result[0].relevanceScore, 100);
});

// ── relevanceReason ─────────────────────────────────────────────────────────

test('relevanceReason is a non-empty string', () => {
  const event = makeEvent({ severity: 'HIGH', timestamp: BASE_NOW - 3 * 60 * 60_000 });
  const result = prioritize([event], [], {}, BASE_NOW);
  assert.ok(typeof result[0].relevanceReason === 'string');
  assert.ok(result[0].relevanceReason.length > 0);
});

test('empty events array returns empty array', () => {
  const result = prioritize([], [], {}, BASE_NOW);
  assert.deepEqual(result, []);
});
