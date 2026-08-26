import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as openaq from '../openaq-service.ts';
import { fetchOpenaqWorstReadings } from '../openaq-worst-fetch.ts';

const {
  rankReadings,
  summarizeNearby,
  pickGlobalWorst,
  STALE_AFTER_MS,
} = openaq;

const NOW = Date.UTC(2026, 4, 11, 12, 0, 0);
const runtimeWindow: Record<string, unknown> = {
  navigator: { userAgent: '' },
  location: { protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1' },
};
Object.defineProperty(globalThis, 'window', { value: runtimeWindow, configurable: true });

// ── rankReadings / summarizeNearby ────────────────────────────────────

test('rank: PM2.5 with higher AQI sorts above PM2.5 with lower AQI', () => {
  const rows = openaq.parseOpenaqReadings([
    normalizedReading({ sensorId: 1, locationId: 1, value: 12 }),
    normalizedReading({ sensorId: 2, locationId: 2, value: 75 }),
  ]);
  const ranked = rankReadings(rows, NOW);
  assert.equal(ranked[0]!.locationId, 2);
});

test('rank: stale readings sink below fresh ones regardless of AQI', () => {
  const rows = openaq.parseOpenaqReadings([
    normalizedReading({ sensorId: 1, locationId: 1, value: 200, observedAt: NOW - STALE_AFTER_MS - 60_000 }),
    normalizedReading({ sensorId: 2, locationId: 2, value: 30, observedAt: NOW - 60_000 }),
  ]);
  const ranked = rankReadings(rows, NOW);
  assert.equal(ranked[0]!.locationId, 2);
});

test('summary: counts stations whose category is sensitive or worse', () => {
  const rows = openaq.parseOpenaqReadings([
    normalizedReading({ sensorId: 1, locationId: 1, value: 5 }),
    normalizedReading({ sensorId: 2, locationId: 2, value: 40 }),
    normalizedReading({ sensorId: 3, locationId: 3, value: 75 }),
  ]);
  const summary = summarizeNearby(rows, NOW);
  assert.equal(summary.unhealthyCount, 2);
  assert.equal(summary.worst?.locationId, 3);
});

test('worst: filters stale readings before slicing', () => {
  const rows = openaq.parseOpenaqReadings([
    normalizedReading({ sensorId: 1, locationId: 1, value: 200, observedAt: NOW - STALE_AFTER_MS - 60_000 }),
    normalizedReading({ sensorId: 3, locationId: 3, value: 60, observedAt: NOW - 60_000 }),
  ]);
  const worst = pickGlobalWorst(rows, NOW, 5);
  assert.equal(worst.length, 1);
  assert.equal(worst[0]!.locationId, 3);
});

test('summary: empty input → empty readings + null worst', () => {
  const summary = summarizeNearby([], NOW);
  assert.equal(summary.readings.length, 0);
  assert.equal(summary.worst, null);
  assert.equal(summary.unhealthyCount, 0);
});

// ── app-owned normalized sidecar contract ────────────────────────────────────

function normalizedReading(over: Record<string, unknown> = {}) {
  const row = {
    id: 'openaq:4272103',
    sensorId: 4_272_103,
    locationId: 12_345,
    station: 'OpenAQ location 12345',
    city: null,
    country: null,
    lat: 41.8781,
    lon: -87.6298,
    parameter: 'pm25',
    value: 35.4,
    unit: 'µg/m³',
    observedAt: Date.UTC(2026, 4, 11, 11, 30),
    ...over,
  };
  if (!Object.hasOwn(over, 'id')) row.id = `openaq:${String(row.sensorId)}`;
  return row;
}

function envelope(readings: unknown[]) {
  return {
    schemaVersion: 2, provider: 'openaq-v3', coverage: 'best_effort_sample', complete: false, readings,
    sample: {
      windowStart: '2026-05-11T10:00:00.000Z', windowEnd: '2026-05-11T12:00:00.000Z',
      reportedFoundAtStart: readings.length, plannedPages: 1, fetchedPages: 1,
      rawRows: readings.length, uniqueSensorRows: readings.length, acceptedRows: readings.length,
      duplicateRows: 0, invalidRows: 0,
      rejectionReasons: {
        invalidSensorId: 0, invalidLocationId: 0, invalidValue: 0,
        invalidCoordinates: 0, invalidTimestamp: 0, outsideWindow: 0,
        equalTimestampConflict: 0,
      },
    },
    source: 'api.openaq.org/v3/parameters/2/latest',
    fetchedAt: '2026-05-11T12:00:00.000Z', servedAt: '2026-05-11T12:00:02.000Z',
  };
}

test('normalized parser accepts the app-owned OpenAQ reading schema', () => {
  assert.equal(typeof openaq.parseOpenaqReadings, 'function');
  const out = openaq.parseOpenaqReadings?.([normalizedReading()]) ?? [];
  assert.equal(out.length, 1);
  assert.equal(out[0]?.station, 'OpenAQ location 12345');
  assert.equal(out[0]?.aqi, 100);
  assert.equal(out[0]?.category, 'moderate');
});

test('normalized parser permits zero coordinates', () => {
  assert.equal(typeof openaq.parseOpenaqReadings, 'function');
  const out = openaq.parseOpenaqReadings?.([
    normalizedReading({ lat: 0, lon: 0 }),
  ]) ?? [];
  assert.equal(out.length, 1);
  assert.equal(out[0]?.lat, 0);
  assert.equal(out[0]?.lon, 0);
});

test('normalized parser rejects provider-shaped extras', () => {
  const out = openaq.parseOpenaqReadings?.([
    normalizedReading({ datetime: { utc: '2026-05-11T11:30:00Z' } }),
  ]) ?? [];
  assert.equal(out.length, 0);
});

test('normalized parser fails closed on malformed rows', () => {
  assert.equal(typeof openaq.parseOpenaqReadings, 'function');
  const out = openaq.parseOpenaqReadings?.([
    normalizedReading({ sensorId: '4272103' }),
    normalizedReading({ value: -1 }),
    normalizedReading({ lat: 91 }),
    normalizedReading({ observedAt: null }),
    normalizedReading({ parameter: 'renamed-pm25' }),
  ]) ?? [];
  assert.equal(out.length, 0);
});

test('schema v2 parser requires exact envelope, sample, and row property sets', () => {
  const valid = envelope([normalizedReading()]);
  assert.equal(openaq.parseOpenaqEnvelope(valid).ok, true);

  for (const malformed of [
    { ...valid, unexpected: true },
    { ...valid, sample: { ...valid.sample, unexpected: true } },
    { ...valid, readings: [{ ...normalizedReading(), unexpected: true }] },
  ]) {
    assert.deepEqual(openaq.parseOpenaqEnvelope(malformed), { ok: false, error: 'invalid OpenAQ response' });
  }
});

test('schema v2 parser requires canonical row identity and station metadata types', () => {
  for (const malformed of [
    normalizedReading({ id: 'openaq:other' }),
    normalizedReading({ station: 123 }),
    normalizedReading({ station: '' }),
    normalizedReading({ city: 123 }),
    normalizedReading({ country: false }),
  ]) {
    assert.equal(openaq.parseOpenaqEnvelope(envelope([malformed])).ok, false);
  }

  assert.equal(openaq.parseOpenaqEnvelope(envelope([
    normalizedReading({ city: 'Chicago', country: 'US' }),
  ])).ok, true);
});

test('schema v2 parser requires canonical UTC timestamps in chronological order', () => {
  for (const mutate of [
    (value: ReturnType<typeof envelope>) => { value.sample.windowStart = '2026-05-11T10:00:00Z'; },
    (value: ReturnType<typeof envelope>) => { value.sample.windowStart = '2026-05-11T12:00:01.000Z'; },
    (value: ReturnType<typeof envelope>) => { value.fetchedAt = '2026-05-11T11:59:59.999Z'; },
    (value: ReturnType<typeof envelope>) => { value.servedAt = '2026-05-11T11:59:59.999Z'; },
    (value: ReturnType<typeof envelope>) => { value.readings = [normalizedReading({ observedAt: Date.UTC(2026, 4, 11, 9, 59, 59) })]; },
  ]) {
    const malformed = envelope([normalizedReading()]);
    mutate(malformed);
    assert.equal(openaq.parseOpenaqEnvelope(malformed).ok, false);
  }
});

test('schema v2 parser fails closed on inconsistent sample counters', () => {
  const mutations: Array<(value: ReturnType<typeof envelope>) => void> = [
    (value) => { value.sample.fetchedPages = 0; },
    (value) => { value.sample.plannedPages = 2; },
    (value) => { value.sample.rawRows = 2; },
    (value) => { value.sample.uniqueSensorRows = 0; },
    (value) => { value.sample.acceptedRows = 0; },
    (value) => { value.sample.invalidRows = 1; value.sample.rejectionReasons.invalidValue = 0; },
  ];
  for (const mutate of mutations) {
    const malformed = envelope([normalizedReading()]);
    mutate(malformed);
    assert.equal(openaq.parseOpenaqEnvelope(malformed).ok, false);
  }
});

test('fusion fetch is unhealthy when normalized adapter output is empty', async (t) => {
  runtimeWindow.__TAURI_INTERNALS__ = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(envelope([]))) as typeof globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await fetchOpenaqWorstReadings(NOW);
  assert.deepEqual(result, { applicable: true, ok: false, readings: [] });
});

test('fusion fetch is healthy only when normalized adapter output contributes readings', async (t) => {
  runtimeWindow.__TAURI_INTERNALS__ = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(envelope([normalizedReading()]))) as typeof globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await fetchOpenaqWorstReadings(NOW);
  assert.equal(result.applicable, true);
  assert.equal(result.ok, true);
  assert.equal(result.readings.length, 1);
});

test('fusion fetch is inapplicable and performs no network request outside desktop', async (t) => {
  delete runtimeWindow.__TAURI_INTERNALS__;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return Response.json(envelope([normalizedReading()]));
  }) as typeof globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await fetchOpenaqWorstReadings(NOW);
  assert.deepEqual(result, { applicable: false, ok: false, readings: [] });
  assert.equal(fetches, 0);
});

test('desktop fusion fetch uses the local-only OpenAQ route', async (t) => {
  runtimeWindow.__TAURI_INTERNALS__ = {};
  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = (async (input) => {
    requested = String(input);
    return Response.json(envelope([normalizedReading()]));
  }) as typeof globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await fetchOpenaqWorstReadings(NOW);
  assert.equal(result.applicable, true);
  assert.equal(requested, 'http://127.0.0.1:46123/api/local-airquality/openaq/worst');
});

test('schema v2 parser accepts valid empty best-effort samples', () => {
  assert.equal(typeof openaq.parseOpenaqEnvelope, 'function');
  const result = openaq.parseOpenaqEnvelope?.({
    schemaVersion: 2, provider: 'openaq-v3', coverage: 'best_effort_sample', complete: false, readings: [],
    sample: {
      windowStart: '2026-08-25T10:00:00.000Z', windowEnd: '2026-08-25T12:00:00.000Z',
      reportedFoundAtStart: 0, plannedPages: 1, fetchedPages: 1, rawRows: 0,
      uniqueSensorRows: 0, acceptedRows: 0, duplicateRows: 0, invalidRows: 0,
      rejectionReasons: {
        invalidSensorId: 0, invalidLocationId: 0, invalidValue: 0,
        invalidCoordinates: 0, invalidTimestamp: 0, outsideWindow: 0,
        equalTimestampConflict: 0,
      },
    },
    source: 'api.openaq.org/v3/parameters/2/latest',
    fetchedAt: '2026-08-25T12:00:00.000Z', servedAt: '2026-08-25T12:00:02.000Z',
  });
  assert.equal(result?.ok, true);
  if (result?.ok) assert.equal(result.readings.length, 0);
});

test('schema v2 parser rejects unknown schema and coverage', () => {
  assert.equal(typeof openaq.parseOpenaqEnvelope, 'function');
  for (const raw of [
    { schemaVersion: 1, coverage: 'best_effort_sample' },
    { schemaVersion: 2, provider: 'openaq-v3', coverage: 'reported', complete: false, readings: [], sample: {} },
    { schemaVersion: 2, provider: 'openaq-v3', coverage: 'best_effort_sample', complete: true, readings: [], sample: {} },
  ]) assert.deepEqual(openaq.parseOpenaqEnvelope?.(raw), { ok: false, error: 'invalid OpenAQ response' });
});

test('schema v2 parser rejects unknown or malformed rejection counters', () => {
  const unknown = envelope([]);
  unknown.sample.rejectionReasons = { providerRenamedReason: 1 };
  assert.equal(openaq.parseOpenaqEnvelope(unknown).ok, false);

  const negative = envelope([]);
  negative.sample.rejectionReasons = { invalidValue: -1 };
  assert.equal(openaq.parseOpenaqEnvelope(negative).ok, false);
});

test('schema v2 parser rejects an envelope when any returned reading is malformed', () => {
  const result = openaq.parseOpenaqEnvelope(envelope([
    normalizedReading({ sensorId: 1 }),
    normalizedReading({ sensorId: 'malformed' }),
  ]));

  assert.deepEqual(result, { ok: false, error: 'invalid OpenAQ response' });
});
