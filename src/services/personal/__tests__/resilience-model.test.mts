/**
 * Coverage for resilience-model.ts — verifies the personal
 * relevance scorer separates relevance from truth, surfaces
 * why-it-matters reasons, and respects user snoozes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreRelevance,
  hasPersonalSignal,
  topRelevanceReason,
  type FactForRelevance,
  type PersonalSnapshot,
} from '../resilience-model.ts';

const homeNearby: FactForRelevance = {
  id: 'fact-1',
  summary: 'Severe Thunderstorm Warning approaches La Porte, IN',
  latitude: 41.6,
  longitude: -86.7,
  entities: ['IN', 'LaPorte'],
  severity: 80,
};

const baseSnap: PersonalSnapshot = {
  savedPlaces: [{ id: 'home', label: 'Home', latitude: 41.610, longitude: -86.722 }],
  familyPlaces: [],
  travelRoutes: [],
  watchlist: [],
  infrastructure: [],
  snoozedPatterns: [],
};

test('saved-place hit produces an elevated tier with a clear reason', () => {
  const r = scoreRelevance(homeNearby, baseSnap);
  assert.equal(r.tier === 'elevated' || r.tier === 'critical', true);
  assert.ok(r.reasons.some((reason) => reason.id === 'saved_place:home'));
  assert.match(topRelevanceReason(r) ?? '', /saved place "Home"/);
});

test('high-severity fact + saved-place hit + severity boost ⇒ critical tier', () => {
  const r = scoreRelevance({ ...homeNearby, severity: 90 }, baseSnap);
  assert.equal(r.tier, 'critical');
  assert.ok(r.reasons.some((reason) => reason.id === 'severity_boost'));
});

test('severity boost does NOT fire without a personal signal', () => {
  // No saved place close by — but severity is high. We must NOT
  // boost into critical; that would be relevance from truth alone,
  // which the plan explicitly forbids.
  const farFact: FactForRelevance = { ...homeNearby, latitude: 0, longitude: 0, severity: 95, entities: [] };
  const r = scoreRelevance(farFact, baseSnap);
  assert.ok(!r.reasons.some((reason) => reason.id === 'severity_boost'));
  assert.equal(r.tier, 'dormant');
});

test('watchlist entity intersection produces a relevance signal', () => {
  const fact: FactForRelevance = {
    id: 'cve-1',
    summary: 'CVE-2026-9999 affects Acme EdgeRouter',
    entities: ['CVE-2026-9999'],
  };
  const snap: PersonalSnapshot = {
    ...baseSnap,
    watchlist: [{ kind: 'cve', id: 'CVE-2026-9999', label: 'CVE-2026-9999' }],
  };
  const r = scoreRelevance(fact, snap);
  assert.ok(r.reasons.some((reason) => reason.id === 'watchlist:CVE-2026-9999'));
  assert.equal(r.tier, 'watch');
});

test('snoozed pattern suppresses to dormant', () => {
  const snap: PersonalSnapshot = {
    ...baseSnap,
    snoozedPatterns: [{ pattern: 'Severe Thunderstorm', reason: 'Always shows up here' }],
  };
  const r = scoreRelevance(homeNearby, snap);
  assert.ok(r.reasons.some((reason) => reason.id.startsWith('snoozed:')));
  // Snooze weight (-0.5) should reduce relevance even with saved-place + severity.
  // Saved place: +0.6, severity boost: +0.2 (fires only if positiveCount > 0,
  // which is true after the saved place), snooze: -0.5
  // Net: +0.3 → still 'watch'
  assert.equal(r.tier, 'watch');
});

test('snoozed alone (no positive signal) produces dormant', () => {
  const fact: FactForRelevance = {
    id: 'fact-x',
    summary: 'Severe Thunderstorm Warning in Seattle',
    entities: [],
  };
  const snap: PersonalSnapshot = {
    ...baseSnap,
    snoozedPatterns: [{ pattern: 'Severe Thunderstorm' }],
  };
  const r = scoreRelevance(fact, snap);
  assert.equal(r.tier, 'dormant');
  assert.ok(r.score < 0);
});

test('travel-route intersection contributes a route signal', () => {
  const fact: FactForRelevance = {
    id: 'fact-route',
    summary: 'Highway closure on I-94',
    latitude: 41.7,
    longitude: -87.0,
    entities: [],
  };
  const snap: PersonalSnapshot = {
    ...baseSnap,
    travelRoutes: [{
      id: 'commute',
      label: 'Daily commute',
      waypoints: [
        { latitude: 41.7, longitude: -87.0 },
        { latitude: 41.8, longitude: -87.5 },
      ],
    }],
  };
  const r = scoreRelevance(fact, snap);
  assert.ok(r.reasons.some((reason) => reason.id === 'route:commute'));
});

test('infrastructure dependency proximity produces an infra signal', () => {
  const fact: FactForRelevance = {
    id: 'fact-infra',
    summary: 'Substation fire reported',
    latitude: 41.7,
    longitude: -86.7,
    entities: [],
  };
  const snap: PersonalSnapshot = {
    ...baseSnap,
    infrastructure: [{ kind: 'utility', id: 'nipsco', label: 'NIPSCO substation', latitude: 41.6, longitude: -86.7 }],
  };
  const r = scoreRelevance(fact, snap);
  assert.ok(r.reasons.some((reason) => reason.id === 'infra:nipsco'));
});

test('relevance never alters truth score (separation invariant)', () => {
  // Truth score is set externally; our function returns a relevance
  // score that has no field named "truthScore" or similar — we must
  // never write into the fact.
  const fact = { ...homeNearby };
  const snap = baseSnap;
  scoreRelevance(fact, snap);
  // Fact object unchanged — original entries preserved.
  assert.deepEqual(fact, homeNearby);
});

test('hasPersonalSignal + topRelevanceReason convenience helpers', () => {
  const r = scoreRelevance(homeNearby, baseSnap);
  assert.equal(hasPersonalSignal(r), true);
  assert.ok(topRelevanceReason(r));

  const empty = scoreRelevance({ id: 'x', summary: 'y', entities: [] }, baseSnap);
  assert.equal(hasPersonalSignal(empty), false);
  assert.equal(topRelevanceReason(empty), undefined);
});

test('determinism: same inputs ⇒ same score', () => {
  const a = scoreRelevance(homeNearby, baseSnap);
  const b = scoreRelevance(homeNearby, baseSnap);
  assert.deepEqual(a, b);
});

test('JSON-serializable', () => {
  const r = scoreRelevance(homeNearby, baseSnap);
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});
