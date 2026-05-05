import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __INTERNAL,
  assessEarthquakeImpact,
  parsePagerFeature,
  parseShakeMapProduct,
  type CityCatalogEntry,
  type PagerFeature,
  type ShakeMapProduct,
} from '../impact-assessor.ts';

// ── PAGER parsing ──────────────────────────────────────────────────────

test('PAGER: red alert maps to >$1B / 1,000+ ranges', () => {
  const feature: PagerFeature = {
    id: 'usgs:abc',
    properties: { alert: 'red', mag: 7.8, place: 'X', time: 0, updated: 0 },
  };
  const out = parsePagerFeature(feature)!;
  assert.equal(out.alertLevel, 'red');
  assert.equal(out.fatalitiesRange, '1,000+');
  assert.equal(out.lossesRangeUsd, '>$1B');
});

test('PAGER: orange alert maps to 100–999 / $100M–$1B', () => {
  const out = parsePagerFeature({ id: 'x', properties: { alert: 'orange' } })!;
  assert.equal(out.alertLevel, 'orange');
  assert.equal(out.fatalitiesRange, '100–999');
  assert.equal(out.lossesRangeUsd, '$100M–$1B');
});

test('PAGER: missing alert level → alertLevel null + "unknown" labels', () => {
  const out = parsePagerFeature({ id: 'x', properties: {} })!;
  assert.equal(out.alertLevel, null);
  assert.equal(out.fatalitiesRange, 'unknown');
  assert.equal(out.lossesRangeUsd, 'unknown');
});

test('PAGER: invalid alert string is treated as null', () => {
  const out = parsePagerFeature({ id: 'x', properties: { alert: 'bogus' } })!;
  assert.equal(out.alertLevel, null);
  assert.equal(out.fatalitiesRange, 'unknown');
});

test('PAGER: losspager.impact1/impact2 override generic ranges when numeric', () => {
  const feature: PagerFeature = {
    id: 'x',
    properties: {
      alert: 'yellow',
      products: {
        losspager: [{
          properties: { impact1: '$50M–$200M', impact2: '5–50' },
        }],
      },
    },
  };
  const out = parsePagerFeature(feature)!;
  assert.equal(out.fatalitiesRange, '5–50');
  assert.equal(out.lossesRangeUsd, '$50M–$200M');
});

test('PAGER: narrative impact strings without digits are rejected', () => {
  const feature: PagerFeature = {
    id: 'x',
    properties: {
      alert: 'yellow',
      products: {
        losspager: [{ properties: { impact1: 'Significant casualties likely' } }],
      },
    },
  };
  const out = parsePagerFeature(feature)!;
  assert.equal(out.lossesRangeUsd, '$1M–$100M');
});

test('PAGER: missing properties returns null', () => {
  assert.equal(parsePagerFeature({ id: 'x' } as PagerFeature), null);
});

// ── ShakeMap parsing ───────────────────────────────────────────────────

test('ShakeMap: parses cells + computes maxMmi', () => {
  const product: ShakeMapProduct = {
    cells: [
      [-122.4, 37.8, 6.2],
      [-122.5, 37.7, 5.0],
      [-122.3, 37.9, 7.1],
    ],
    publishedAt: 1_000_000,
  };
  const out = parseShakeMapProduct(product);
  assert.equal(out.grid.length, 3);
  assert.equal(out.maxMmi, 7.1);
  assert.equal(out.publishedAt, 1_000_000);
  // Lat/lon are stored as (lat, lon), but the upstream cell is (lon, lat, mmi).
  assert.equal(out.grid[0]!.lat, 37.8);
  assert.equal(out.grid[0]!.lon, -122.4);
});

test('ShakeMap: empty product → empty grid + null maxMmi', () => {
  const out = parseShakeMapProduct(null);
  assert.deepEqual(out.grid, []);
  assert.equal(out.maxMmi, null);
});

test('ShakeMap: invalid cell entries are skipped (not throwing)', () => {
  const product: ShakeMapProduct = {
    cells: [
      [-122.4, 37.8, 6.2],
      [Number.NaN, 37.7, 5.0],
      [-122.3, 37.9, Number.POSITIVE_INFINITY],
    ],
  };
  const out = parseShakeMapProduct(product);
  assert.equal(out.grid.length, 1);
  assert.equal(out.maxMmi, 6.2);
});

test('ShakeMap: maxMmi falls back to product.maxMmi when no cells', () => {
  const out = parseShakeMapProduct({ cells: [], maxMmi: 5.5, publishedAt: null });
  assert.equal(out.maxMmi, 5.5);
});

// ── Assessment construction ────────────────────────────────────────────

const SF: CityCatalogEntry = { name: 'San Francisco', lat: 37.77, lon: -122.42, populationThousands: 808 };
const OAK: CityCatalogEntry = { name: 'Oakland', lat: 37.80, lon: -122.27, populationThousands: 440 };
const NY: CityCatalogEntry = { name: 'New York', lat: 40.71, lon: -74.0, populationThousands: 8500 };

test('assess: combines PAGER + ShakeMap into one record', () => {
  const out = assessEarthquakeImpact({
    eventId: 'usgs:abc',
    pager: { alertLevel: 'orange', fatalitiesRange: '100–999', lossesRangeUsd: '$100M–$1B', populationExposedThousands: null },
    shakeMap: parseShakeMapProduct({
      cells: [[-122.42, 37.77, 7.0], [-122.27, 37.80, 6.5]],
      publishedAt: 5_000_000,
    }),
    cities: [SF, OAK, NY],
  });
  assert.equal(out.eventId, 'usgs:abc');
  assert.equal(out.pagerAlert, 'orange');
  assert.equal(out.shakeMapMaxMmi, 7.0);
  assert.equal(out.affectedCities.length, 2);
  // Sorted by descending intensity, then descending population.
  assert.equal(out.affectedCities[0]!.name, 'San Francisco');
  assert.equal(out.affectedCities[1]!.name, 'Oakland');
});

test('assess: cities outside radius are excluded', () => {
  const out = assessEarthquakeImpact({
    eventId: 'usgs:abc',
    pager: null,
    shakeMap: parseShakeMapProduct({
      cells: [[-122.42, 37.77, 7.0]],
    }),
    cities: [SF, NY],
  });
  assert.equal(out.affectedCities.length, 1);
  assert.equal(out.affectedCities[0]!.name, 'San Francisco');
});

test('assess: cities with only sub-MMI4 cells are excluded', () => {
  const out = assessEarthquakeImpact({
    eventId: 'usgs:abc',
    pager: null,
    shakeMap: parseShakeMapProduct({
      cells: [[-122.42, 37.77, 3.0]],
    }),
    cities: [SF],
  });
  assert.equal(out.affectedCities.length, 0);
});

test('assess: tie on intensity breaks by descending population', () => {
  const out = __INTERNAL.computeAffectedCities({
    cities: [
      { name: 'small', lat: 0, lon: 0, populationThousands: 50 },
      { name: 'big', lat: 0, lon: 0, populationThousands: 5000 },
    ],
    grid: [{ lat: 0, lon: 0, mmi: 6 }],
    cityRadiusKm: 10,
    minAffectedMmi: 4,
  });
  assert.deepEqual(out.map((c) => c.name), ['big', 'small']);
});

test('assess: empty city catalog → empty affectedCities', () => {
  const out = assessEarthquakeImpact({
    eventId: 'x',
    pager: null,
    shakeMap: parseShakeMapProduct({ cells: [[-122, 37, 7]] }),
  });
  assert.deepEqual(out.affectedCities, []);
  assert.equal(out.affectedPopulationThousands, 0);
});

test('assess: missing PAGER → unknown labels', () => {
  const out = assessEarthquakeImpact({
    eventId: 'x',
    pager: null,
    shakeMap: { grid: [], maxMmi: null, publishedAt: null },
  });
  assert.equal(out.pagerAlert, null);
  assert.equal(out.estimatedFatalities, 'unknown');
  assert.equal(out.estimatedLosses, 'unknown');
});

test('assess: result is JSON-serializable', () => {
  const out = assessEarthquakeImpact({
    eventId: 'x',
    pager: parsePagerFeature({ id: 'x', properties: { alert: 'red' } }),
    shakeMap: parseShakeMapProduct({ cells: [[-122.42, 37.77, 8]] }),
    cities: [SF],
  });
  const round = JSON.parse(JSON.stringify(out));
  assert.equal(round.pagerAlert, 'red');
  assert.equal(round.affectedCities[0].name, 'San Francisco');
});

test('assess: affectedPopulationThousands sums affected cities only', () => {
  const out = assessEarthquakeImpact({
    eventId: 'x',
    pager: null,
    shakeMap: parseShakeMapProduct({
      cells: [[-122.42, 37.77, 7.0]], // hits SF, not NY
    }),
    cities: [SF, NY],
  });
  assert.equal(out.affectedPopulationThousands, 808);
});
