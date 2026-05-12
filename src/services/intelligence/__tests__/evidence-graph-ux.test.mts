import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleEvidence,
  expectedSignalsForDomain,
  refreshBudgetMsFor,
} from '../evidence-graph-ux.ts';
import type { ObservationEvent, Situation } from '@/types/intelligence';

const NOW = 1_745_000_000_000;
const TOKYO = { lat: 35.68, lon: 139.69 };

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'M6.2 earthquake near Tokyo',
    status: 'active',
    severity: 'high',
    domain: 'earthquake',
    startedAt: NOW - 5 * 60 * 1000,
    updatedAt: NOW - 60 * 1000,
    observationIds: ['ev-1'],
    correlationIds: [],
    summary: 'Strong shaking reported across Kanto.',
    location: { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 200 },
    tags: ['quake', 'warning-issued'],
    confidence: 0.7,
    ...overrides,
  };
}

function event(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-1',
    sourceId: 'usgs-earthquake',
    domain: 'earthquake',
    timestamp: NOW - 90 * 1000,
    location: { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 50 },
    severity: 'HIGH',
    title: 'M6.2 earthquake — Tokyo Bay',
    raw: {},
    entityIds: ['JP'],
    tags: ['earthquake', 'quake'],
    ...overrides,
  };
}

// ── Confirming events ──────────────────────────────────────────────────────

test('linked observationId is confirming even outside spatial envelope', () => {
  const e = event({ location: { lat: 0, lon: 0 } });
  const r = assembleEvidence({ situation: situation(), events: [e], now: NOW });
  assert.equal(r.confirming.length, 1);
  assert.equal(r.confirming[0]!.sourceId, 'usgs-earthquake');
});

test('same-domain event within footprint is confirming', () => {
  const e = event({ id: 'ev-2', location: { lat: TOKYO.lat + 0.1, lon: TOKYO.lon + 0.1 } });
  const r = assembleEvidence({ situation: situation({ observationIds: [] }), events: [e], now: NOW });
  assert.equal(r.confirming.length, 1);
  assert.equal(r.confirming[0]!.sourceId, 'usgs-earthquake');
});

test('same-domain event outside footprint is dropped (not confirming, not contradicting)', () => {
  const e = event({ id: 'ev-2', location: { lat: 0, lon: 0 } });
  const r = assembleEvidence({ situation: situation({ observationIds: [] }), events: [e], now: NOW });
  assert.equal(r.confirming.length, 0);
  assert.equal(r.contradicting.length, 0);
});

test('confirming events are sorted newest-first', () => {
  const old = event({ id: 'ev-2', timestamp: NOW - 30 * 60 * 1000 });
  const fresh = event({ id: 'ev-3', timestamp: NOW - 10 * 1000 });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['ev-2', 'ev-3'] }),
    events: [old, fresh],
    now: NOW,
  });
  assert.equal(r.confirming[0]!.timestamp, NOW - 10 * 1000);
  assert.equal(r.confirming[1]!.timestamp, NOW - 30 * 60 * 1000);
});

test('confirming confidence maps from ObservationSeverity', () => {
  const crit = event({ id: 'c', severity: 'CRITICAL' });
  const info = event({ id: 'i', severity: 'INFO' });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['c', 'i'] }),
    events: [crit, info],
    now: NOW,
  });
  assert.ok(r.confirming.some((c) => c.confidence === 0.95));
  assert.ok(r.confirming.some((c) => c.confidence === 0.4));
});

test('events older than 6h are dropped from same-domain matching', () => {
  const stale = event({ id: 'ev-2', timestamp: NOW - 7 * 60 * 60 * 1000 });
  const r = assembleEvidence({ situation: situation({ observationIds: [] }), events: [stale], now: NOW });
  assert.equal(r.confirming.length, 0);
});

// ── Contradicting events ──────────────────────────────────────────────────

test('event with opposing tag is contradicting, not confirming', () => {
  const cancel = event({ id: 'ev-2', tags: ['warning-canceled', 'all-clear'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: [] }),
    events: [cancel],
    now: NOW,
  });
  assert.equal(r.contradicting.length, 1);
  assert.match(r.contradicting[0]!.reason, /canceled|issued/);
});

test('contradicting reason names both poles of the contradiction', () => {
  const cancel = event({ id: 'ev-2', tags: ['evacuation-lifted'] });
  const sit = situation({ tags: ['evacuation-ordered'], observationIds: [] });
  const r = assembleEvidence({ situation: sit, events: [cancel], now: NOW });
  assert.equal(r.contradicting.length, 1);
  assert.match(r.contradicting[0]!.reason, /lifted|ordered/);
});

test('cross-domain event with opposing tag still surfaces as contradicting', () => {
  const cancel = event({ id: 'ev-2', domain: 'weather', tags: ['warning-canceled'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: [] }),
    events: [cancel],
    now: NOW,
  });
  assert.equal(r.contradicting.length, 1);
});

test('cross-domain event without opposing tag is ignored', () => {
  const other = event({ id: 'ev-2', domain: 'maritime', tags: ['ais-position'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: [] }),
    events: [other],
    now: NOW,
  });
  assert.equal(r.confirming.length, 0);
  assert.equal(r.contradicting.length, 0);
});

test('linked observation that also carries contradicting tag flips to contradicting', () => {
  const flip = event({ id: 'ev-1', tags: ['warning-canceled'] });
  const r = assembleEvidence({ situation: situation(), events: [flip], now: NOW });
  assert.equal(r.confirming.length, 0);
  assert.equal(r.contradicting.length, 1);
});

// ── Missing signals ────────────────────────────────────────────────────────

test('earthquake situation flags missing ShakeMap + tsunami advisory', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  assert.equal(r.missing.length, 2);
  assert.ok(r.missing.some((m) => /ShakeMap/i.test(m.expectedSignal)));
  assert.ok(r.missing.some((m) => /tsunami/i.test(m.expectedSignal)));
});

test('present expected signal (matching sourceId) is removed from missing', () => {
  const shake = event({ id: 'sm', sourceId: 'usgs-shakemap', tags: ['shakemap'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['ev-1', 'sm'] }),
    events: [event(), shake],
    now: NOW,
  });
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0]!.expectedSignal, /tsunami/i);
});

test('present expected signal via tag fragment is also matched', () => {
  const tsu = event({ id: 'ts', sourceId: 'jma', tags: ['noaa-tsunami', 'advisory'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['ev-1', 'ts'] }),
    events: [event(), tsu],
    now: NOW,
  });
  assert.ok(r.missing.every((m) => !/tsunami/i.test(m.expectedSignal)));
});

test('domain without expectations produces empty missing array', () => {
  const r = assembleEvidence({
    situation: situation({ domain: 'economic', observationIds: [] }),
    events: [event({ domain: 'economic' })],
    now: NOW,
  });
  assert.equal(r.missing.length, 0);
});

test('expectedSignalsForDomain returns the static table', () => {
  const eq = expectedSignalsForDomain('earthquake');
  assert.equal(eq.length, 2);
  assert.equal(expectedSignalsForDomain('unknown-domain').length, 0);
});

// ── Stale detection ────────────────────────────────────────────────────────

test('confirming event older than per-domain budget surfaces as stale', () => {
  const old = event({ id: 'ev-1', timestamp: NOW - 20 * 60 * 1000 });
  const r = assembleEvidence({ situation: situation(), events: [old], now: NOW });
  assert.equal(r.stale.length, 1);
  assert.equal(r.stale[0]!.sourceId, 'usgs-earthquake');
  assert.ok(r.stale[0]!.ageMs >= 20 * 60 * 1000);
});

test('fresh confirming events are not stale', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  assert.equal(r.stale.length, 0);
});

test('refreshBudgetMsFor knows weather (10 min) and falls back for unknown', () => {
  assert.equal(refreshBudgetMsFor('weather'), 10 * 60 * 1000);
  assert.equal(refreshBudgetMsFor('earthquake'), 5 * 60 * 1000);
  assert.equal(refreshBudgetMsFor('mystery'), 30 * 60 * 1000);
});

// ── Confidence breakdown ───────────────────────────────────────────────────

test('confidenceBreakdown is all zeros when no confirming events', () => {
  const r = assembleEvidence({
    situation: situation({ observationIds: [] }),
    events: [],
    now: NOW,
  });
  assert.deepEqual(r.confidenceBreakdown, { spatial: 0, temporal: 0, entity: 0, domain: 0, total: 0 });
});

test('spatial score is high when confirming events sit at the situation center', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  assert.ok(r.confidenceBreakdown.spatial > 20);
  assert.ok(r.confidenceBreakdown.spatial <= 25);
});

test('spatial score is zero when situation has no location', () => {
  const r = assembleEvidence({
    situation: situation({ location: undefined }),
    events: [event()],
    now: NOW,
  });
  assert.equal(r.confidenceBreakdown.spatial, 0);
});

test('temporal score is near 25 for very recent confirming events', () => {
  const fresh = event({ timestamp: NOW - 1000 });
  const r = assembleEvidence({ situation: situation(), events: [fresh], now: NOW });
  assert.ok(r.confidenceBreakdown.temporal > 24);
});

test('temporal score is near 0 for confirming events at the 1h confidence window edge', () => {
  const edge = event({ timestamp: NOW - 60 * 60 * 1000 });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['ev-1'] }),
    events: [edge],
    now: NOW,
  });
  assert.ok(r.confidenceBreakdown.temporal < 1);
});

test('entity score requires at least two confirming events sharing an id', () => {
  const a = event({ id: 'a', entityIds: ['JP'] });
  const b = event({ id: 'b', entityIds: ['JP'] });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['a', 'b'] }),
    events: [a, b],
    now: NOW,
  });
  assert.ok(r.confidenceBreakdown.entity > 0);
});

test('entity score is zero with only one confirming event', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  assert.equal(r.confidenceBreakdown.entity, 0);
});

test('domain score rewards multi-domain corroboration', () => {
  const a = event({ id: 'a', domain: 'earthquake' });
  const b = event({ id: 'b', domain: 'space' });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['a', 'b'] }),
    events: [a, b],
    now: NOW,
  });
  assert.ok(r.confidenceBreakdown.domain > 0);
});

test('total equals sum of sub-scores (within rounding)', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  const { spatial, temporal, entity, domain, total } = r.confidenceBreakdown;
  assert.ok(Math.abs((spatial + temporal + entity + domain) - total) < 0.05);
});

// ── lastVerified ───────────────────────────────────────────────────────────

test('lastVerified is the newest confirming timestamp', () => {
  const a = event({ id: 'a', timestamp: NOW - 60 * 1000 });
  const b = event({ id: 'b', timestamp: NOW - 10 * 1000 });
  const r = assembleEvidence({
    situation: situation({ observationIds: ['a', 'b'] }),
    events: [a, b],
    now: NOW,
  });
  assert.equal(r.lastVerified, NOW - 10 * 1000);
});

test('lastVerified falls back to situation.startedAt when no confirming events', () => {
  const sit = situation({ observationIds: [], startedAt: 42 });
  const r = assembleEvidence({ situation: sit, events: [], now: NOW });
  assert.equal(r.lastVerified, 42);
});

// ── End-to-end shape ──────────────────────────────────────────────────────

test('report carries the situation id and all five buckets', () => {
  const r = assembleEvidence({ situation: situation(), events: [event()], now: NOW });
  assert.equal(r.situationId, 'sit-1');
  assert.ok(Array.isArray(r.confirming));
  assert.ok(Array.isArray(r.contradicting));
  assert.ok(Array.isArray(r.missing));
  assert.ok(Array.isArray(r.stale));
  assert.equal(typeof r.lastVerified, 'number');
});
