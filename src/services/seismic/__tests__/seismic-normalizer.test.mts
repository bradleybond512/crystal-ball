import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeCanonicalEvents,
  normalizeEmscEvent,
  normalizePagerEvent,
  normalizeUsgsEarthquake,
} from '../seismic-normalizer.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';

const NOW = 1_745_000_000_000;

// ── Normalizers ────────────────────────────────────────────────────────

test('normalizeUsgsEarthquake: maps proto fields to canonical record', () => {
  const out = normalizeUsgsEarthquake({
    id: 'us7000abcd',
    place: '10 km SW of Foo',
    magnitude: 5.4,
    depthKm: 12.3,
    location: { latitude: 34.05, longitude: -118.25 },
    occurredAt: NOW,
    sourceUrl: 'https://example.com/event',
  });
  assert.equal(out.id, 'usgs:us7000abcd');
  assert.equal(out.source, 'usgs');
  assert.equal(out.magnitude, 5.4);
  assert.equal(out.depthKm, 12.3);
  assert.equal(out.lat, 34.05);
  assert.equal(out.lon, -118.25);
  assert.equal(out.occurredAt, NOW);
  assert.equal(out.url, 'https://example.com/event');
  assert.ok(out.confidence > 0);
});

test('normalizeUsgsEarthquake: missing location coerces to 0/0 lat/lon', () => {
  const out = normalizeUsgsEarthquake({
    id: 'x', place: '', magnitude: 4, depthKm: 5,
    location: undefined, occurredAt: NOW, sourceUrl: '',
  });
  assert.equal(out.lat, 0);
  assert.equal(out.lon, 0);
});

test('normalizeEmscEvent: parses ISO time + carries magnitudeType', () => {
  const out = normalizeEmscEvent({
    id: 'emsc-1234',
    magnitude: 6.1,
    magnitudeType: 'Mw',
    depth: 18,
    lat: 38.0,
    lon: 142.0,
    region: 'OFF EAST COAST OF HONSHU',
    time: '2026-04-18T12:34:56Z',
    source: 'EMSC',
    suspectedNuclearTest: false,
    nearTestSite: null,
  });
  assert.ok(out, 'should normalize');
  assert.equal(out!.source, 'emsc');
  assert.equal(out!.magnitudeType, 'Mw');
  assert.equal(out!.occurredAt, Date.parse('2026-04-18T12:34:56Z'));
});

test('normalizeEmscEvent: returns null when id or time missing', () => {
  assert.equal(
    normalizeEmscEvent({
      id: null, magnitude: 4, magnitudeType: null, depth: null,
      lat: 0, lon: 0, region: null, time: '2026-04-18T00:00:00Z',
      source: null, suspectedNuclearTest: false, nearTestSite: null,
    }),
    null,
  );
  assert.equal(
    normalizeEmscEvent({
      id: 'x', magnitude: 4, magnitudeType: null, depth: null,
      lat: 0, lon: 0, region: null, time: null,
      source: null, suspectedNuclearTest: false, nearTestSite: null,
    }),
    null,
  );
});

test('normalizePagerEvent: marks status reviewed and carries pagerAlert', () => {
  const out = normalizePagerEvent({
    id: 'us7000abcd',
    place: 'Coastal Region',
    magnitude: 7.2,
    depth: 25,
    lat: 38.0,
    lon: 142.0,
    time: new Date(NOW),
    updatedAt: new Date(NOW + 60_000),
    alertLevel: 'orange',
    estimatedFatalities: '100-1000',
    estimatedLosses: '1B-10B',
    populationExposed: 5000,
    url: 'https://example.com/pager',
    severity: 'high',
  });
  assert.equal(out.source, 'pager');
  assert.equal(out.status, 'reviewed');
  assert.equal(out.pagerAlert, 'orange');
  assert.equal(out.updatedAt, NOW + 60_000);
  // Reviewed PAGER should beat default-confidence USGS.
  const usgs = normalizeUsgsEarthquake({
    id: 'q', place: '', magnitude: 7.2, depthKm: 25,
    location: { latitude: 38, longitude: 142 }, occurredAt: NOW, sourceUrl: '',
  });
  assert.ok(out.confidence > usgs.confidence);
});

// ── Dedupe ─────────────────────────────────────────────────────────────

function usgs(overrides: Partial<CanonicalSeismicEvent> & { id: string }): CanonicalSeismicEvent {
  return {
    id: overrides.id,
    source: 'usgs',
    sourceEventId: overrides.sourceEventId ?? overrides.id,
    magnitude: overrides.magnitude ?? 5,
    depthKm: overrides.depthKm ?? 10,
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    place: overrides.place ?? '',
    occurredAt: overrides.occurredAt ?? NOW,
    status: overrides.status ?? 'unknown',
    pagerAlert: overrides.pagerAlert,
    confidence: overrides.confidence ?? 0.7,
    updatedAt: overrides.updatedAt,
  };
}

test('dedupe: groups records that match on time + distance + magnitude', () => {
  const usgsEvent = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0, lat: 38, lon: 142 });
  const emscEvent: CanonicalSeismicEvent = {
    id: 'emsc:b', source: 'emsc', sourceEventId: 'b',
    magnitude: 6.1, depthKm: 18, lat: 38.05, lon: 142.05,
    place: '', occurredAt: NOW + 30_000, confidence: 0.6,
  };
  const groups = dedupeCanonicalEvents([usgsEvent, emscEvent]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.observations.length, 2);
});

test('dedupe: distinct quakes far apart in time stay split', () => {
  const a = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW });
  const b = usgs({ id: 'usgs:b', sourceEventId: 'b', occurredAt: NOW + 10 * 60_000 });
  const groups = dedupeCanonicalEvents([a, b]);
  assert.equal(groups.length, 2);
});

test('dedupe: distinct quakes far apart in space stay split', () => {
  const a = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, lat: 0, lon: 0 });
  const b = usgs({ id: 'usgs:b', sourceEventId: 'b', occurredAt: NOW + 1_000, lat: 50, lon: 50 });
  const groups = dedupeCanonicalEvents([a, b]);
  assert.equal(groups.length, 2);
});

test('dedupe: large magnitude delta splits the group', () => {
  const a = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, magnitude: 4.0, lat: 0, lon: 0 });
  const b = usgs({ id: 'usgs:b', sourceEventId: 'b', occurredAt: NOW + 1_000, magnitude: 7.5, lat: 0.01, lon: 0.01 });
  const groups = dedupeCanonicalEvents([a, b]);
  assert.equal(groups.length, 2);
});

test('dedupe: matching sourceEventId always groups (USGS event + PAGER same id)', () => {
  // Time + space + magnitude all out of bounds, but the source event
  // ids match. PAGER summaries can land minutes later with revised
  // magnitude — they still describe the same physical quake.
  const usgsAuto = usgs({ id: 'usgs:us123', sourceEventId: 'us123', occurredAt: NOW, magnitude: 5.5 });
  const pager: CanonicalSeismicEvent = {
    id: 'pager:us123', source: 'pager', sourceEventId: 'us123',
    magnitude: 6.4, depthKm: 12, lat: 0.5, lon: 0.5,
    place: '', occurredAt: NOW + 10 * 60_000,
    status: 'reviewed', pagerAlert: 'orange', confidence: 0.95,
  };
  const groups = dedupeCanonicalEvents([usgsAuto, pager]);
  assert.equal(groups.length, 1);
});

test('dedupe: primary picks reviewed PAGER over automatic USGS', () => {
  const usgsAuto = usgs({
    id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0,
    status: 'automatic',
  });
  const pager: CanonicalSeismicEvent = {
    id: 'pager:a', source: 'pager', sourceEventId: 'a',
    magnitude: 6.1, depthKm: 12, lat: 0, lon: 0,
    place: '', occurredAt: NOW + 60_000,
    status: 'reviewed', pagerAlert: 'yellow', confidence: 0.95,
  };
  const groups = dedupeCanonicalEvents([usgsAuto, pager]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.primary.source, 'pager');
  assert.equal(groups[0]!.primary.status, 'reviewed');
});

test('dedupe: observations are preserved alongside primary', () => {
  const usgsAuto = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, magnitude: 6.0 });
  const emsc: CanonicalSeismicEvent = {
    id: 'emsc:b', source: 'emsc', sourceEventId: 'b',
    magnitude: 6.1, depthKm: 18, lat: 0.05, lon: 0.05,
    place: '', occurredAt: NOW + 30_000, confidence: 0.6,
  };
  const groups = dedupeCanonicalEvents([usgsAuto, emsc]);
  assert.equal(groups[0]!.observations.length, 2);
  // Loser stays in observations, not discarded.
  const sources = groups[0]!.observations.map((o) => o.source).sort();
  assert.deepEqual(sources, ['emsc', 'usgs']);
});

test('dedupe: respects custom thresholds', () => {
  const a = usgs({ id: 'usgs:a', sourceEventId: 'a', occurredAt: NOW, magnitude: 4.0, lat: 0, lon: 0 });
  const b = usgs({ id: 'usgs:b', sourceEventId: 'b', occurredAt: NOW + 1_000, magnitude: 5.0, lat: 0.01, lon: 0.01 });
  // Default magnitude delta cap is 0.5 — these would split.
  assert.equal(dedupeCanonicalEvents([a, b]).length, 2);
  // Loosen the cap and they group.
  assert.equal(dedupeCanonicalEvents([a, b], { maxMagnitudeDelta: 1.5 }).length, 1);
});

test('dedupe: empty input returns empty array', () => {
  assert.deepEqual(dedupeCanonicalEvents([]), []);
});

// ── JSON serializability ───────────────────────────────────────────────

test('canonical records are JSON-serializable', () => {
  const out = normalizeUsgsEarthquake({
    id: 'us7000abcd', place: 'X', magnitude: 5, depthKm: 10,
    location: { latitude: 0, longitude: 0 }, occurredAt: NOW, sourceUrl: 'u',
  });
  const round = JSON.parse(JSON.stringify(out));
  assert.equal(round.source, 'usgs');
  assert.equal(round.id, 'usgs:us7000abcd');
});
