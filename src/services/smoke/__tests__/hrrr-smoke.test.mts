import assert from 'node:assert/strict';
import test from 'node:test';

import {
  latestHrrrCycle,
  maxForecastHour,
  hrrrSmokeUrls,
  parseIdxByteRange,
  rangeHeader,
  smokePm25ToUsAqi,
  fetchHrrrSmokeGrids,
  hrrrGridsToGridPoints,
  type FetchLike,
  type HrrrSmokeGrid,
} from '../hrrr-smoke.ts';

// A representative HRRR wrfsfc .idx sidecar: MASSDEN at 8 m above ground sits
// between two other records so it has a bounded byte range.
const IDX = [
  '1:0:d=2026072212:REFC:entire atmosphere:6 hour fcst:',
  '2:1000:d=2026072212:MASSDEN:8 m above ground:6 hour fcst:',
  '3:2000:d=2026072212:TMP:surface:6 hour fcst:',
].join('\n');

test('latestHrrrCycle backs off latency and floors to the UTC hour', () => {
  const now = Date.UTC(2026, 6, 22, 14, 37, 0); // 2026-07-22T14:37Z
  assert.deepEqual(latestHrrrCycle(now, 2), { date: '20260722', hour: 12 });
});

test('latestHrrrCycle default latency can roll the UTC date backward', () => {
  const now = Date.UTC(2026, 6, 22, 1, 30, 0); // 2026-07-22T01:30Z − 2h ⇒ prev day 23Z
  assert.deepEqual(latestHrrrCycle(now), { date: '20260721', hour: 23 });
});

test('maxForecastHour is 48 on the 6-hourly cycles, 18 otherwise', () => {
  assert.equal(maxForecastHour({ date: '20260722', hour: 12 }), 48);
  assert.equal(maxForecastHour({ date: '20260722', hour: 0 }), 48);
  assert.equal(maxForecastHour({ date: '20260722', hour: 13 }), 18);
});

test('hrrrSmokeUrls builds zero-padded NOMADS grib + idx URLs', () => {
  const { grib, idx } = hrrrSmokeUrls({ date: '20260722', hour: 3 }, 6);
  assert.equal(
    grib,
    'https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod/hrrr.20260722/conus/hrrr.t03z.wrfsfcf06.grib2',
  );
  assert.equal(idx, `${grib}.idx`);
});

test('parseIdxByteRange returns start and next-record-minus-one end', () => {
  assert.deepEqual(parseIdxByteRange(IDX, { field: 'MASSDEN', level: '8 m above ground' }), {
    start: 1000,
    end: 1999,
  });
});

test('parseIdxByteRange leaves the final record open-ended', () => {
  const idx = [
    '1:0:d=2026072212:REFC:entire atmosphere:6 hour fcst:',
    '2:1000:d=2026072212:MASSDEN:8 m above ground:6 hour fcst:',
  ].join('\n');
  assert.deepEqual(parseIdxByteRange(idx, { field: 'MASSDEN', level: '8 m above ground' }), {
    start: 1000,
    end: null,
  });
});

test('parseIdxByteRange returns null when the field/level is absent', () => {
  assert.equal(parseIdxByteRange(IDX, { field: 'MASSDEN', level: '80 m above ground' }), null);
});

test('rangeHeader renders closed and open-ended ranges', () => {
  assert.equal(rangeHeader({ start: 1000, end: 1999 }), 'bytes=1000-1999');
  assert.equal(rangeHeader({ start: 1000, end: null }), 'bytes=1000-');
});

test('smokePm25ToUsAqi rejects null, NaN, and negative concentrations', () => {
  assert.equal(smokePm25ToUsAqi(null), null);
  assert.equal(smokePm25ToUsAqi(Number.NaN), null);
  assert.equal(smokePm25ToUsAqi(-1), null);
});

test('smokePm25ToUsAqi maps the EPA-2024 breakpoint anchors', () => {
  assert.equal(smokePm25ToUsAqi(0), 0);
  assert.equal(smokePm25ToUsAqi(9.0), 50);
  assert.equal(smokePm25ToUsAqi(9.1), 51);
  assert.equal(smokePm25ToUsAqi(35.4), 100);
  assert.equal(smokePm25ToUsAqi(55.5), 151);
  assert.equal(smokePm25ToUsAqi(325.4), 500);
});

test('smokePm25ToUsAqi truncates to 0.1 µg/m³ before banding', () => {
  assert.equal(smokePm25ToUsAqi(9.09), 50); // truncates to 9.0 ⇒ still Good, not Moderate
  assert.equal(smokePm25ToUsAqi(35.49), 100); // truncates to 35.4 ⇒ top of Moderate
});

test('smokePm25ToUsAqi caps at 500 above the top breakpoint', () => {
  assert.equal(smokePm25ToUsAqi(325.5), 500);
  assert.equal(smokePm25ToUsAqi(1000), 500);
});

test('fetchHrrrSmokeGrids range-GETs each hour, skips failures, null when empty', async () => {
  const cycle = { date: '20260722', hour: 12 };
  const cycleMs = Date.UTC(2026, 6, 22, 12);
  const ranges: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    if (url.endsWith('.idx')) {
      const ok = !url.includes('wrfsfcf02'); // fail forecast hour 02 to prove the skip
      return { ok, text: async () => IDX, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (init?.headers?.Range) ranges.push(init.headers.Range);
    return { ok: true, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const decoder = (bytes: Uint8Array, validMs: number): HrrrSmokeGrid | null =>
    bytes.length > 0 ? { validMs, sample: () => 10 } : null;

  const grids = await fetchHrrrSmokeGrids({ cycle, forecastHours: [1, 2, 3], decoder, fetchImpl });
  assert.ok(grids);
  assert.deepEqual(
    grids.map((g) => g.validMs),
    [cycleMs + 3_600_000, cycleMs + 3 * 3_600_000],
  );
  assert.deepEqual(ranges, ['bytes=1000-1999', 'bytes=1000-1999']);

  // No decoder output ⇒ null so the caller stays on Open-Meteo.
  const none = await fetchHrrrSmokeGrids({
    cycle,
    forecastHours: [1],
    decoder: () => null,
    fetchImpl,
  });
  assert.equal(none, null);
});

test('hrrrGridsToGridPoints yields drop-in GridPointAq and nulls empty points', () => {
  const grids: HrrrSmokeGrid[] = [
    { validMs: 2000, sample: (lat) => (lat === 40 ? 9.0 : null) },
    { validMs: 1000, sample: (lat) => (lat === 40 ? 35.4 : null) },
  ];
  const points = [
    { lat: 40, lon: -100 },
    { lat: 0, lon: 0 },
  ];
  const result = hrrrGridsToGridPoints(grids, points);
  // Grids ordered by valid time; AQI converted from the µg/m³ samples.
  assert.deepEqual(result[0], { timesMs: [1000, 2000], usAqi: [100, 50] });
  assert.equal(result[1], null); // no data at any hour ⇒ fail-closed null
  assert.deepEqual(hrrrGridsToGridPoints([], points), [null, null]);
});
