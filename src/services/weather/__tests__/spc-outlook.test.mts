import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_STORM_REPORT_ROWS,
  parseStormReportPayload,
  toStormReportBatch,
} from '../../spc-outlook.ts';

const FETCHED_AT = Date.parse('2026-07-21T12:00:00Z');

function feature(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'Feature',
    properties: {
      type: 'T',
      magnitude: '',
      city: 'Norman',
      county: 'Cleveland',
      state: 'OK',
      valid: '2026-07-21T11:30:00Z',
      remark: 'Brief tornado report',
    },
    geometry: {
      type: 'Point',
      coordinates: [-97.44, 35.22],
    },
    ...overrides,
  };
}

test('strictly parses valid LSR payloads and declares 24-hour coverage', () => {
  const parsed = parseStormReportPayload({
    type: 'FeatureCollection',
    features: [
      feature(),
      feature({
        properties: {
          type: 'H',
          valid: '2026-07-21T11:45:00Z',
        },
        geometry: {
          type: 'Point',
          coordinates: [-97.5, 35.3],
        },
      }),
    ],
  }, FETCHED_AT);

  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.items.map((item) => item.type), ['tornado', 'hail']);
  assert.equal(parsed.items[0]?.reportedAt.getTime(), Date.parse('2026-07-21T11:30:00Z'));
  assert.equal(parsed.coverageStart, FETCHED_AT - 24 * 60 * 60_000);
  assert.equal(parsed.coverageEnd, FETCHED_AT);
});

test('missing or malformed feature arrays cannot claim complete coverage', () => {
  for (const payload of [
    {},
    { type: 'FeatureCollection' },
    { type: 'FeatureCollection', features: 'not-an-array' },
  ]) {
    const parsed = parseStormReportPayload(payload, FETCHED_AT);
    assert.equal(parsed.complete, false);
    assert.deepEqual(parsed.items, []);
  }
});

test('retains valid reports but marks a partially malformed payload incomplete', () => {
  const parsed = parseStormReportPayload({
    type: 'FeatureCollection',
    features: [
      feature(),
      feature({
        geometry: { type: 'Point', coordinates: ['bad', 35] },
      }),
      feature({
        properties: { type: 'W', valid: 'not-a-date' },
      }),
    ],
  }, FETCHED_AT);

  assert.equal(parsed.complete, false);
  assert.equal(parsed.items.length, 1);
});

test('maps current IEM LSR event codes to warning-verification classes', () => {
  const codes = ['T', 'W', 'H', 'h', 'B', 'D', 'G', 'M', 'E', 'F'];
  const expected = [
    'tornado',
    'tornado',
    'hail',
    'hail',
    'wind',
    'wind',
    'wind',
    'wind',
    'flooding',
    'flooding',
  ];
  const parsed = parseStormReportPayload({
    type: 'FeatureCollection',
    features: codes.map((type, index) => feature({
      properties: {
        type,
        valid: '2026-07-21T11:30:00Z',
      },
      geometry: {
        type: 'Point',
        coordinates: [-120 + index, 35],
      },
    })),
  }, FETCHED_AT);

  assert.equal(parsed.complete, true);
  assert.deepEqual(
    expected,
    codes.map((_, index) =>
      parsed.items.find((item) => item.id.startsWith(`lsr-${index}-`))?.type),
  );
});

test('caps nationwide report rows and marks truncation incomplete', () => {
  const parsed = parseStormReportPayload({
    type: 'FeatureCollection',
    features: Array.from(
      { length: MAX_STORM_REPORT_ROWS + 1 },
      (_, index) => feature({
        properties: {
          type: 'W',
          valid: '2026-07-21T11:30:00Z',
        },
        geometry: {
          type: 'Point',
          coordinates: [-120 + (index % 100) * 0.01, 35],
        },
      }),
    ),
  }, FETCHED_AT);

  assert.equal(parsed.items.length, MAX_STORM_REPORT_ROWS);
  assert.equal(parsed.complete, false);
});

test('resolver batch exposes only bounded structured report evidence', () => {
  const parsed = parseStormReportPayload({
    type: 'FeatureCollection',
    features: [feature()],
  }, FETCHED_AT);
  const batch = toStormReportBatch(parsed);

  assert.deepEqual(batch, {
    reports: [{
      id: 'lsr-0-35.220--97.440',
      type: 'tornado',
      lat: 35.22,
      lon: -97.44,
      reportedAt: Date.parse('2026-07-21T11:30:00Z'),
    }],
    fetchedAt: FETCHED_AT,
    coverageStart: FETCHED_AT - 24 * 60 * 60_000,
    coverageEnd: FETCHED_AT,
    complete: true,
  });
});
