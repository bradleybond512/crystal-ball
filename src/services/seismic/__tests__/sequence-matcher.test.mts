import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_SEARCH_BOX,
  findHistoricalAnalogs,
  parseUsgsCatalog,
  scoreAnalog,
  type CatalogEvent,
  type QueryEvent,
} from '../sequence-matcher.ts';

const QUERY: QueryEvent = {
  id: 'us7000new',
  lat: 35.0,
  lon: -118.0,
  depthKm: 10,
  magnitude: 6.5,
  faultType: 'reverse',
};

function cat(overrides: Partial<CatalogEvent> & { id: string }): CatalogEvent {
  return {
    id: overrides.id,
    lat: overrides.lat ?? 35.0,
    lon: overrides.lon ?? -118.0,
    depthKm: 'depthKm' in overrides ? overrides.depthKm! : 10,
    magnitude: overrides.magnitude ?? 6.5,
    occurredAt: overrides.occurredAt ?? '2010-01-01T00:00:00Z',
    place: overrides.place,
    faultType: overrides.faultType,
    subsequentLargestAftershock: overrides.subsequentLargestAftershock,
    subsequentTsunamiObserved: overrides.subsequentTsunamiObserved,
    notes: overrides.notes,
  };
}

// ── scoreAnalog: search-box gating ─────────────────────────────────────

test('scoreAnalog: drops candidate beyond max radius', () => {
  // Two degrees of longitude at 35°N is ~182 km — outside the 50 km box.
  const result = scoreAnalog(QUERY, cat({ id: 'far', lon: -116 }));
  assert.equal(result, null);
});

test('scoreAnalog: drops candidate beyond magnitude delta', () => {
  const result = scoreAnalog(QUERY, cat({ id: 'big', magnitude: 7.5 }));
  assert.equal(result, null);
});

test('scoreAnalog: drops candidate beyond depth delta when both known', () => {
  const result = scoreAnalog(QUERY, cat({ id: 'deep', depthKm: 80 }));
  assert.equal(result, null);
});

test('scoreAnalog: keeps candidate when only one depth is known', () => {
  const result = scoreAnalog(QUERY, cat({ id: 'no-depth', depthKm: null }));
  assert.ok(result, 'candidate is in scope');
  assert.equal(result!.components.depth, 0.5, 'neutral depth score');
});

test('scoreAnalog: drops candidate with the same id as the query', () => {
  const result = scoreAnalog(QUERY, cat({ id: QUERY.id }));
  assert.equal(result, null);
});

// ── scoreAnalog: ranking-relevant scoring rules ────────────────────────

test('scoreAnalog: perfect colocated, same-magnitude, same-depth, same-fault', () => {
  const result = scoreAnalog(QUERY, cat({
    id: 'twin', lat: QUERY.lat, lon: QUERY.lon, depthKm: 10, magnitude: 6.5,
    faultType: 'reverse',
  }));
  assert.ok(result);
  assert.equal(result!.components.location, 1);
  assert.equal(result!.components.magnitude, 1);
  assert.equal(result!.components.depth, 1);
  assert.equal(result!.components.focal, 1);
  assert.equal(result!.matchScore, 1);
});

test('scoreAnalog: focal mismatch costs 10% of the total weight', () => {
  const matching = scoreAnalog(QUERY, cat({
    id: 'a', faultType: 'reverse',
  }))!;
  const mismatch = scoreAnalog(QUERY, cat({
    id: 'b', faultType: 'normal',
  }))!;
  assert.ok(matching.matchScore > mismatch.matchScore);
  assert.equal(mismatch.components.focal, 0);
});

test('scoreAnalog: focal type missing on the candidate is neutral, not penalty', () => {
  const matching = scoreAnalog(QUERY, cat({ id: 'a', faultType: 'reverse' }))!;
  const unknown  = scoreAnalog(QUERY, cat({ id: 'b' }))!;
  const mismatch = scoreAnalog(QUERY, cat({ id: 'c', faultType: 'normal' }))!;
  assert.ok(matching.matchScore > unknown.matchScore);
  assert.ok(unknown.matchScore > mismatch.matchScore);
});

test('scoreAnalog: matchScore stays in [0, 1]', () => {
  const result = scoreAnalog(QUERY, cat({
    id: 'edge', lat: QUERY.lat, lon: QUERY.lon - 0.4, magnitude: 6.95,
    depthKm: 39, faultType: 'normal',
  }));
  assert.ok(result);
  assert.ok(result!.matchScore >= 0 && result!.matchScore <= 1);
});

// ── findHistoricalAnalogs: ranking + cap ───────────────────────────────

test('findHistoricalAnalogs: returns top-5 by score', () => {
  const events: CatalogEvent[] = [
    cat({ id: 'best',   lat: QUERY.lat, lon: QUERY.lon, magnitude: 6.5, depthKm: 10, faultType: 'reverse' }),
    cat({ id: 'good',   lat: QUERY.lat + 0.05, lon: QUERY.lon, magnitude: 6.4, depthKm: 12, faultType: 'reverse' }),
    cat({ id: 'mid',    lat: QUERY.lat + 0.1, lon: QUERY.lon, magnitude: 6.3, depthKm: 20 }),
    cat({ id: 'okay',   lat: QUERY.lat + 0.2, lon: QUERY.lon, magnitude: 6.6, depthKm: 30 }),
    cat({ id: 'meh',    lat: QUERY.lat + 0.3, lon: QUERY.lon, magnitude: 6.7, depthKm: 35 }),
    cat({ id: 'worst',  lat: QUERY.lat + 0.4, lon: QUERY.lon, magnitude: 6.0, depthKm: 38, faultType: 'normal' }),
  ];
  const ranked = findHistoricalAnalogs(QUERY, events);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[0]!.analogEventId, 'best');
  // Worst-ranked should be 'worst' if it sneaks into top-5; if not, the
  // top-5 must not include it.
  assert.ok(!ranked.find((r) => r.analogEventId === 'worst'));
});

test('findHistoricalAnalogs: limit option overrides default of 5', () => {
  const events: CatalogEvent[] = Array.from({ length: 10 }, (_, i) =>
    cat({
      id: `e${i}`,
      lat: QUERY.lat + i * 0.01,
      lon: QUERY.lon,
      magnitude: 6.5,
      depthKm: 10,
    }),
  );
  const ranked = findHistoricalAnalogs(QUERY, events, { limit: 3 });
  assert.equal(ranked.length, 3);
});

test('findHistoricalAnalogs: out-of-scope candidates are filtered before ranking', () => {
  const events: CatalogEvent[] = [
    cat({ id: 'in', lat: QUERY.lat, lon: QUERY.lon }),
    cat({ id: 'far',   lat: QUERY.lat + 5, lon: QUERY.lon }), // ~556 km
    cat({ id: 'big',   magnitude: 8.0 }),
    cat({ id: 'deep',  depthKm: 80 }),
  ];
  const ranked = findHistoricalAnalogs(QUERY, events);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.analogEventId, 'in');
});

test('findHistoricalAnalogs: ranking is deterministic on score ties', () => {
  // Same score on every component → ties broken by smaller distance.
  const events: CatalogEvent[] = [
    cat({ id: 'b', lat: QUERY.lat, lon: QUERY.lon - 0.2 }),
    cat({ id: 'a', lat: QUERY.lat, lon: QUERY.lon - 0.1 }),
    cat({ id: 'c', lat: QUERY.lat, lon: QUERY.lon - 0.3 }),
  ];
  const r1 = findHistoricalAnalogs(QUERY, events);
  const r2 = findHistoricalAnalogs(QUERY, [...events].reverse());
  assert.deepEqual(
    r1.map((r) => r.analogEventId),
    r2.map((r) => r.analogEventId),
  );
  // Closest first (a is at 0.1° west, b at 0.2°, c at 0.3°).
  assert.equal(r1[0]!.analogEventId, 'a');
});

test('findHistoricalAnalogs: empty catalog returns empty array', () => {
  const ranked = findHistoricalAnalogs(QUERY, []);
  assert.deepEqual(ranked, []);
});

// ── Custom weights ────────────────────────────────────────────────────

test('scoreAnalog: custom weights normalise correctly', () => {
  // All-zero except focal → focal score equals matchScore.
  const result = scoreAnalog(
    QUERY,
    cat({ id: 'x', lat: QUERY.lat + 0.4, lon: QUERY.lon, magnitude: 7.0, faultType: 'reverse' }),
    { location: 0, magnitude: 0, depth: 0, focal: 1 },
  );
  assert.ok(result);
  assert.equal(result!.matchScore, result!.components.focal);
});

test('scoreAnalog: zero-weight bag yields zero matchScore (defensive)', () => {
  const result = scoreAnalog(
    QUERY,
    cat({ id: 'x' }),
    { location: 0, magnitude: 0, depth: 0, focal: 0 },
  );
  assert.ok(result);
  assert.equal(result!.matchScore, 0);
});

// ── parseUsgsCatalog ──────────────────────────────────────────────────

const USGS_CATALOG_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'ci40012345',
      properties: {
        mag: 6.4,
        place: 'Searles Valley',
        time: 1562383668000,
      },
      geometry: { type: 'Point', coordinates: [-117.5, 35.7, 8.7] },
    },
    {
      type: 'Feature',
      id: 'ci39126079',
      properties: {
        mag: 6.5,
        place: 'Ridgecrest',
        time: 1562383200000,
      },
      geometry: { type: 'Point', coordinates: [-117.6, 35.8, 12.0] },
    },
    // Garbage feature: missing mag — must be skipped.
    {
      type: 'Feature',
      id: 'bad',
      properties: { time: 1 },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
  ],
};

test('parseUsgsCatalog: parses valid features, drops malformed ones', () => {
  const events = parseUsgsCatalog(USGS_CATALOG_FIXTURE);
  assert.equal(events.length, 2);
  assert.equal(events[0]!.id, 'ci40012345');
  assert.equal(events[0]!.magnitude, 6.4);
  assert.equal(events[0]!.depthKm, 8.7);
});

test('parseUsgsCatalog: handles non-object payloads', () => {
  assert.deepEqual(parseUsgsCatalog(null), []);
  assert.deepEqual(parseUsgsCatalog(42), []);
  assert.deepEqual(parseUsgsCatalog({ features: 'not-an-array' }), []);
});

test('parseUsgsCatalog: end-to-end from upstream JSON to ranked analogs', () => {
  const catalog = parseUsgsCatalog(USGS_CATALOG_FIXTURE);
  const ranked = findHistoricalAnalogs(
    {
      id: 'us7000foo',
      lat: 35.7,
      lon: -117.5,
      depthKm: 10,
      magnitude: 6.5,
    },
    catalog,
  );
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.analogEventId, 'ci40012345'); // co-located
});

// ── Defaults exposed ──────────────────────────────────────────────────

test('default weights sum to 1', () => {
  const sum =
    DEFAULT_MATCH_WEIGHTS.location
    + DEFAULT_MATCH_WEIGHTS.magnitude
    + DEFAULT_MATCH_WEIGHTS.depth
    + DEFAULT_MATCH_WEIGHTS.focal;
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
});

test('default search box matches plan (50 km / 0.5 M / 30 km)', () => {
  assert.equal(DEFAULT_SEARCH_BOX.maxRadiusKm, 50);
  assert.equal(DEFAULT_SEARCH_BOX.maxMagnitudeDelta, 0.5);
  assert.equal(DEFAULT_SEARCH_BOX.maxDepthDeltaKm, 30);
});

// ── JSON serializability ──────────────────────────────────────────────

test('HistoricalAnalog is JSON-serializable', () => {
  const analog = scoreAnalog(QUERY, cat({ id: 'a' }))!;
  const round = JSON.parse(JSON.stringify(analog));
  assert.equal(round.analogEventId, 'a');
});
