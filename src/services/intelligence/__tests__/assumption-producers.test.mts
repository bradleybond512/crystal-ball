import assert from 'node:assert/strict';
import test from 'node:test';

import { annotateModelOutput, makeTestInstances } from '../assumption-producers.ts';
import type { ObservationEvent } from '../observation-adapters.ts';
import type { Situation } from '../situation-store-v2.ts';

const NOW = 1_750_000_000_000;

function makeWeatherObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'w-1',
    sourceId: 'nws',
    domain: 'weather',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'Severe thunderstorm warning',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeMinimalSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'Test situation',
    domain: 'weather',
    relatedDomains: [],
    severity: 'medium',
    status: 'active',
    summary: 'Test situation summary',
    observations: [makeWeatherObs()],
    edges: [],
    entityIds: [],
    confidence: 0.6,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

// ── v1: stale NWS observation → data-quality ─────────────────────────

test('stale NWS observation produces data-quality assumption in v1', () => {
  const { tracker, service } = makeTestInstances(
    { now: () => NOW },
    { clock: () => NOW },
  );
  // Weather refresh budget = 5 min; stale after 2× = 10 min. Use 15 min old.
  const staleObs = makeWeatherObs({ timestamp: NOW - 15 * 60 * 1000 });
  const result = annotateModelOutput(
    'stale-nws-output',
    'alert',
    { observations: [staleObs] },
    { algorithmId: 'test-algo', domain: 'weather', _tracker: tracker, _service: service },
  );
  const dq = result.assumptions.filter((a) => a.category === 'data-quality');
  assert.ok(dq.length > 0, 'Expected at least one data-quality assumption for stale observation');
  assert.equal(dq[0]!.category, 'data-quality');
});

// ── v1: single-source situation → completeness ───────────────────────

test('single-source situation produces completeness assumption in v1', () => {
  const { tracker, service } = makeTestInstances(
    { now: () => NOW },
    { clock: () => NOW },
  );
  // Situation has exactly one sourceId ('nws') across all observations.
  const sit = makeMinimalSituation();
  const result = annotateModelOutput(
    'single-source-output',
    'situation',
    { situation: sit },
    { algorithmId: 'test-algo', domain: 'weather', _tracker: tracker, _service: service },
  );
  const completeness = result.assumptions.filter((a) => a.category === 'completeness');
  assert.ok(completeness.length > 0, 'Expected completeness assumption for single-source situation');
  assert.equal(completeness[0]!.isCritical, true);
});

// ── v2: critical assumption registered with correct confidence + TTL ──

test('critical assumption is mirrored into v2 with correct confidence bucket and TTL', () => {
  const { tracker, service } = makeTestInstances(
    { now: () => NOW },
    { clock: () => NOW },
  );
  // Single-source → isCritical: true, confidence: 0.6 → 'medium' bucket (≥0.4, <0.7)
  const sit = makeMinimalSituation();
  const TTL_MS = 60 * 60 * 1000; // 1h for this test
  annotateModelOutput(
    'critical-output',
    'situation',
    { situation: sit },
    { algorithmId: 'big-event-detector', domain: 'weather', ttlMs: TTL_MS, _tracker: tracker, _service: service, _clock: () => NOW },
  );
  const registered = service.getAssumptions({ algorithmId: 'big-event-detector' });
  assert.ok(registered.length > 0, 'v2 should have a registered assumption for the critical detection');
  const a = registered[0]!;
  assert.equal(a.confidence, 'medium', 'Assumption confidence 0.6 should map to medium bucket');
  assert.equal(a.domain, 'weather');
  assert.equal(a.algorithmId, 'big-event-detector');
  assert.equal(a.expiresAt, NOW + TTL_MS, 'expiresAt should be NOW + ttlMs');
  assert.equal(a.status, 'active');
});

// ── v2: non-critical, medium-risk assumptions NOT registered ──────────

test('non-critical medium-risk assumption is not mirrored into v2', () => {
  const { tracker, service } = makeTestInstances(
    { now: () => NOW },
    { clock: () => NOW },
  );
  // 15-min-old weather obs WITH a location: only stale-feed fires.
  // stale-feed → isCritical: false, violationRisk: 'medium' (ageMs 900_000 < 6×budget 1_800_000)
  // Adding location avoids the detectMissingLocation geospatial critical assumption.
  const obs = makeWeatherObs({
    timestamp: NOW - 15 * 60 * 1000,
    location: { lat: 41.61, lon: -86.72 },
  });
  annotateModelOutput(
    'non-critical-output',
    'score',
    { observations: [obs] },
    { algorithmId: 'some-scorer', domain: 'weather', _tracker: tracker, _service: service },
  );
  const registered = service.getAssumptions({ algorithmId: 'some-scorer' });
  assert.equal(
    registered.length,
    0,
    'Non-critical, non-high-risk assumptions must not be written to v2 ring',
  );
});
