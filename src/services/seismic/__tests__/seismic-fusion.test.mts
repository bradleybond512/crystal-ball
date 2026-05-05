import assert from 'node:assert/strict';
import test from 'node:test';

import { fuseCanonicalEvents, fuseQuakeGroups } from '../seismic-fusion.ts';
import { dedupeCanonicalEvents } from '../seismic-normalizer.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';

const NOW = 1_745_000_000_000;

function rec(overrides: Partial<CanonicalSeismicEvent> & { id: string }): CanonicalSeismicEvent {
  return {
    id: overrides.id,
    source: overrides.source ?? 'usgs',
    sourceEventId: overrides.sourceEventId ?? overrides.id,
    magnitude: 'magnitude' in overrides ? overrides.magnitude! : 5.0,
    depthKm: 'depthKm' in overrides ? overrides.depthKm! : 10,
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    place: overrides.place ?? '',
    occurredAt: overrides.occurredAt ?? NOW,
    status: overrides.status ?? 'unknown',
    pagerAlert: overrides.pagerAlert,
    confidence: overrides.confidence ?? 0.7,
    updatedAt: overrides.updatedAt,
    magnitudeType: overrides.magnitudeType,
    url: overrides.url,
    tsunamiFlag: overrides.tsunamiFlag,
  };
}

// ── Source agreement classification ───────────────────────────────────

test('single observation -> single_source', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', occurredAt: NOW, magnitude: 5.5 }),
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0]!.sourceAgreement, 'single_source');
  assert.equal(fused[0]!.locationSpreadKm, null);
});

test('two sources, similar magnitude/location -> corroborated', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 30_000, magnitude: 6.05, lat: 0.05, lon: 0.05 }),
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0]!.sourceAgreement, 'corroborated');
});

test('two sources with magnitude spread > 0.5 -> conflicting', () => {
  // Same sourceEventId forces grouping despite the magnitude conflict —
  // the dedupe shortcut keeps PAGER's revised magnitude in the same
  // bucket as the USGS automatic estimate, which is exactly the case
  // where fusion needs to surface the conflict instead of averaging.
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 5.5, status: 'automatic' }),
    rec({
      id: 'pager:a', source: 'pager', sourceEventId: 'a',
      occurredAt: NOW + 60_000, magnitude: 6.4, status: 'reviewed',
      pagerAlert: 'orange',
    }),
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0]!.sourceAgreement, 'conflicting');
  assert.deepEqual(fused[0]!.magnitudeRange, [5.5, 6.4]);
});

// ── Confidence scoring rules ──────────────────────────────────────────

test('USGS reviewed event keeps high baseline confidence', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', occurredAt: NOW, magnitude: 6.5, status: 'reviewed', confidence: 0.8 }),
  ]);
  assert.ok(fused[0]!.confidence >= 0.7, `expected >=0.7, got ${fused[0]!.confidence}`);
});

test('USGS automatic + EMSC corroboration boosts confidence', () => {
  const groupA = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 5.5, status: 'automatic', confidence: 0.7 }),
  ]);
  const groupB = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 5.5, status: 'automatic', confidence: 0.7 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 20_000, magnitude: 5.5, lat: 0.05, lon: 0.05, confidence: 0.6 }),
  ]);
  assert.ok(groupB[0]!.confidence > groupA[0]!.confidence, 'EMSC corroboration should boost USGS automatic');
});

test('PAGER alert present boosts confidence', () => {
  const baseline = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6, status: 'reviewed', confidence: 0.8 }),
  ]);
  const withPager = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6, status: 'reviewed', confidence: 0.8 }),
    rec({
      id: 'pager:a', source: 'pager', sourceEventId: 'a',
      occurredAt: NOW + 60_000, magnitude: 6, status: 'reviewed',
      pagerAlert: 'yellow', confidence: 0.85,
    }),
  ]);
  assert.ok(withPager[0]!.confidence > baseline[0]!.confidence, 'PAGER should boost confidence');
});

test('conflicting sources lower confidence', () => {
  const corroborated = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0, status: 'reviewed', confidence: 0.8 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 20_000, magnitude: 6.05, lat: 0.05, lon: 0.05, confidence: 0.6 }),
  ]);
  const conflicting = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0, status: 'reviewed', confidence: 0.8 }),
    rec({
      id: 'pager:a', source: 'pager', sourceEventId: 'a',
      occurredAt: NOW + 60_000, magnitude: 7.0, status: 'reviewed',
      confidence: 0.85,
    }),
  ]);
  assert.equal(conflicting[0]!.sourceAgreement, 'conflicting');
  assert.ok(
    conflicting[0]!.confidence < corroborated[0]!.confidence,
    'conflicting sources should lower confidence vs corroborated',
  );
});

test('single-source automatic M<4 stays low confidence', () => {
  const small = fuseCanonicalEvents([
    rec({
      id: 'usgs:tiny', source: 'usgs', occurredAt: NOW,
      magnitude: 3.2, status: 'automatic', confidence: 0.7,
    }),
  ]);
  assert.ok(small[0]!.confidence < 0.7, `expected penalty, got ${small[0]!.confidence}`);
});

test('confidence never exceeds 1', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6, status: 'automatic', confidence: 0.95 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 1_000, magnitude: 6, lat: 0.05, lon: 0.05, confidence: 0.9 }),
    rec({
      id: 'pager:a', source: 'pager', sourceEventId: 'a',
      occurredAt: NOW + 60_000, magnitude: 6, status: 'reviewed',
      pagerAlert: 'red', confidence: 0.95,
    }),
  ]);
  assert.ok(fused[0]!.confidence <= 1, `confidence ${fused[0]!.confidence} > 1`);
});

// ── magnitude / location range derivations ────────────────────────────

test('magnitudeRange null when no observation reports a magnitude', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', occurredAt: NOW, magnitude: null }),
  ]);
  assert.equal(fused[0]!.magnitudeRange, null);
});

test('locationSpreadKm reflects pairwise max across observations', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 5.5, lat: 0, lon: 0 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 1_000, magnitude: 5.5, lat: 0.1, lon: 0.1 }),
  ]);
  assert.equal(fused.length, 1);
  assert.ok(fused[0]!.locationSpreadKm! > 0);
  assert.ok(fused[0]!.locationSpreadKm! < 30, 'small spread for near-coincident points');
});

// ── End-to-end: distinct quakes stay split ────────────────────────────

test('two physically distinct quakes produce two fused events', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', occurredAt: NOW, magnitude: 5.5, lat: 0, lon: 0 }),
    rec({ id: 'usgs:b', source: 'usgs', occurredAt: NOW + 20 * 60_000, magnitude: 5.5, lat: 50, lon: 50 }),
  ]);
  assert.equal(fused.length, 2);
});

// ── fuseQuakeGroups directly (consumes Layer 1 output) ────────────────

test('fuseQuakeGroups: works on dedupeCanonicalEvents output', () => {
  const events = [
    rec({ id: 'usgs:a', source: 'usgs', sourceEventId: 'a', occurredAt: NOW, magnitude: 6 }),
    rec({ id: 'emsc:b', source: 'emsc', sourceEventId: 'b', occurredAt: NOW + 20_000, magnitude: 6, lat: 0.05, lon: 0.05 }),
  ];
  const groups = dedupeCanonicalEvents(events);
  const fused = fuseQuakeGroups(groups);
  assert.equal(fused.length, 1);
  assert.equal(fused[0]!.observations.length, 2);
});

// ── JSON serializable ─────────────────────────────────────────────────

test('fused events are JSON-serializable', () => {
  const fused = fuseCanonicalEvents([
    rec({ id: 'usgs:a', source: 'usgs', occurredAt: NOW, magnitude: 5 }),
  ]);
  const round = JSON.parse(JSON.stringify(fused));
  assert.equal(round[0].sourceAgreement, 'single_source');
});
