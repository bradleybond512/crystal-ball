import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findPreArrivalEvents,
  isFusionConfirmed,
  parseFdsnCatalog,
  type PreArrivalCatalogEntry,
} from '../waveform-detector.ts';
import type { FusedSeismicEvent } from '../seismic-fusion.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';

const NOW = 1_745_000_000_000;

function entry(overrides: Partial<PreArrivalCatalogEntry> & { id: string }): PreArrivalCatalogEntry {
  return {
    id: overrides.id,
    occurredAt: overrides.occurredAt ?? NOW - 60_000,
    lat: overrides.lat ?? 35.0,
    lon: overrides.lon ?? -118.0,
    magnitude: 'magnitude' in overrides ? overrides.magnitude! : 5.0,
    place: overrides.place,
    url: overrides.url,
  };
}

function obs(overrides: Partial<CanonicalSeismicEvent> & { id: string }): CanonicalSeismicEvent {
  return {
    id: overrides.id,
    source: overrides.source ?? 'usgs',
    sourceEventId: overrides.sourceEventId ?? overrides.id,
    magnitude: 'magnitude' in overrides ? overrides.magnitude! : 5.0,
    depthKm: 'depthKm' in overrides ? overrides.depthKm! : 10,
    lat: overrides.lat ?? 35.0,
    lon: overrides.lon ?? -118.0,
    place: overrides.place ?? '',
    occurredAt: overrides.occurredAt ?? NOW - 60_000,
    status: overrides.status ?? 'unknown',
    confidence: overrides.confidence ?? 0.7,
  };
}

function fused(primary: CanonicalSeismicEvent, observations: CanonicalSeismicEvent[] = [primary]): FusedSeismicEvent {
  return {
    id: primary.id,
    primary,
    observations,
    confidence: 0.7,
    sourceAgreement: 'single_source',
    magnitudeRange: primary.magnitude !== null ? [primary.magnitude, primary.magnitude] : null,
    locationSpreadKm: null,
    latestUpdateAt: primary.occurredAt,
  };
}

// ── findPreArrivalEvents: gating ──────────────────────────────────────

test('findPreArrivalEvents: returns unconfirmed for catalog entry with no fusion match', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'us-new', occurredAt: NOW - 30_000 })],
    fused: [],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.catalogEntry.id, 'us-new');
  assert.equal(result[0]!.fusionConfirmed, false);
  assert.equal(result[0]!.ageMs, 30_000);
});

test('findPreArrivalEvents: drops entries older than maxAgeMs', () => {
  const result = findPreArrivalEvents({
    catalog: [
      entry({ id: 'fresh', occurredAt: NOW - 60_000 }),
      entry({ id: 'stale', occurredAt: NOW - 20 * 60_000 }),
    ],
    fused: [],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.catalogEntry.id, 'fresh');
});

test('findPreArrivalEvents: respects custom maxAgeMs', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'edge', occurredAt: NOW - 4 * 60_000 })],
    fused: [],
    now: NOW,
    maxAgeMs: 3 * 60_000,
  });
  assert.equal(result.length, 0);
});

test('findPreArrivalEvents: drops entries with negative age (future-dated rows)', () => {
  // A clock-skewed catalog row with origin time in the future should be
  // dropped — never count an event that hasn't happened yet.
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'future', occurredAt: NOW + 60_000 })],
    fused: [],
    now: NOW,
  });
  assert.equal(result.length, 0);
});

test('findPreArrivalEvents: empty catalog returns empty array', () => {
  assert.deepEqual(findPreArrivalEvents({ catalog: [], fused: [], now: NOW }), []);
});

// ── findPreArrivalEvents: fusion confirmation ─────────────────────────

test('findPreArrivalEvents: marks fusionConfirmed when fused observation matches by id', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'us-shared' })],
    fused: [fused(obs({ id: 'usgs:us-shared', sourceEventId: 'us-shared' }))],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.fusionConfirmed, true);
});

test('findPreArrivalEvents: marks fusionConfirmed via coincidence (time + distance)', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'us-coinc', lat: 35.0, lon: -118.0, occurredAt: NOW - 60_000 })],
    fused: [fused(obs({
      id: 'emsc:something',
      sourceEventId: 'something',
      source: 'emsc',
      lat: 35.05,
      lon: -118.05,
      occurredAt: NOW - 60_000 + 30_000,
    }))],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.fusionConfirmed, true);
});

test('findPreArrivalEvents: NOT confirmed when fusion event is far away', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'us-far', lat: 35.0, lon: -118.0, occurredAt: NOW - 60_000 })],
    fused: [fused(obs({
      id: 'emsc:other',
      sourceEventId: 'other',
      source: 'emsc',
      lat: 50.0,
      lon: -100.0,
      occurredAt: NOW - 60_000 + 30_000,
    }))],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.fusionConfirmed, false);
});

test('findPreArrivalEvents: NOT confirmed when fusion event is far in time', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'us-late', lat: 35.0, lon: -118.0, occurredAt: NOW - 60_000 })],
    fused: [fused(obs({
      id: 'emsc:other',
      sourceEventId: 'other',
      source: 'emsc',
      lat: 35.0,
      lon: -118.0,
      occurredAt: NOW - 10 * 60_000,
    }))],
    now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.fusionConfirmed, false);
});

// ── findPreArrivalEvents: ordering ────────────────────────────────────

test('findPreArrivalEvents: orders newest-first by ageMs', () => {
  const result = findPreArrivalEvents({
    catalog: [
      entry({ id: 'old', occurredAt: NOW - 4 * 60_000 }),
      entry({ id: 'new', occurredAt: NOW - 30_000 }),
      entry({ id: 'mid', occurredAt: NOW - 2 * 60_000 }),
    ],
    fused: [],
    now: NOW,
  });
  assert.equal(result.length, 3);
  assert.equal(result[0]!.catalogEntry.id, 'new');
  assert.equal(result[1]!.catalogEntry.id, 'mid');
  assert.equal(result[2]!.catalogEntry.id, 'old');
});

// ── isFusionConfirmed (direct) ────────────────────────────────────────

test('isFusionConfirmed: true when any observation across any group matches by id', () => {
  const fusedSet: FusedSeismicEvent[] = [
    fused(obs({ id: 'usgs:other', sourceEventId: 'other' })),
    fused(obs({ id: 'usgs:hit', sourceEventId: 'hit' }), [
      obs({ id: 'usgs:hit-1', sourceEventId: 'hit-1' }),
      obs({ id: 'emsc:hit-emsc', sourceEventId: 'hit', source: 'emsc' }), // shares id
    ]),
  ];
  assert.equal(
    isFusionConfirmed(entry({ id: 'hit' }), fusedSet),
    true,
  );
});

test('isFusionConfirmed: false when no fused events at all', () => {
  assert.equal(isFusionConfirmed(entry({ id: 'lonely' }), []), false);
});

// ── parseFdsnCatalog ──────────────────────────────────────────────────

const FDSN_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'us7000abcd',
      properties: {
        mag: 5.5,
        place: 'New Mexico',
        time: 1_745_000_000_000,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      },
      geometry: { type: 'Point', coordinates: [-105.0, 34.5, 12.0] },
    },
    // Bad: missing time.
    {
      type: 'Feature',
      id: 'us-bad',
      properties: { mag: 4.0, place: 'Bad' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    // Bad: missing geometry.
    {
      type: 'Feature',
      id: 'us-no-geom',
      properties: { mag: 4.0, time: 1, place: 'Bad' },
    },
  ],
};

test('parseFdsnCatalog: parses valid features and skips malformed ones', () => {
  const events = parseFdsnCatalog(FDSN_FIXTURE);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.id, 'us7000abcd');
  assert.equal(events[0]!.lat, 34.5);
  assert.equal(events[0]!.lon, -105.0);
  assert.equal(events[0]!.magnitude, 5.5);
});

test('parseFdsnCatalog: handles non-object input', () => {
  assert.deepEqual(parseFdsnCatalog(null), []);
  assert.deepEqual(parseFdsnCatalog('feed'), []);
  assert.deepEqual(parseFdsnCatalog({ features: 'no' }), []);
});

test('parseFdsnCatalog: end-to-end into findPreArrivalEvents', () => {
  const catalog = parseFdsnCatalog(FDSN_FIXTURE);
  const result = findPreArrivalEvents({
    catalog,
    fused: [],
    now: 1_745_000_000_000 + 30_000,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.catalogEntry.id, 'us7000abcd');
  assert.equal(result[0]!.ageMs, 30_000);
  assert.equal(result[0]!.fusionConfirmed, false);
});

// ── JSON serializability ──────────────────────────────────────────────

test('CatalogPreArrivalEvent is JSON-serializable', () => {
  const result = findPreArrivalEvents({
    catalog: [entry({ id: 'a' })],
    fused: [],
    now: NOW,
  });
  const round = JSON.parse(JSON.stringify(result));
  assert.equal(round[0].catalogEntry.id, 'a');
  assert.equal(round[0].fusionConfirmed, false);
});
