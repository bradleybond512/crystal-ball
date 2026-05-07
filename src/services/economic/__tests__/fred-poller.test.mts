import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFredObservationsUrl,
  ECONOMIC_STRESS_FRED_SERIES,
  parseFredObservationsResponse,
  parseOfrFsiResponse,
  __INTERNAL,
} from '../fred-poller.ts';

// ── parseFredObservationsResponse ──────────────────────────────────────

test('FRED parser: standard envelope', () => {
  const json = {
    observations: [
      { date: '2026-05-05', value: '85.42' },
      { date: '2026-05-04', value: '84.10' },
      { date: '2026-05-03', value: '.' },
    ],
  };
  const out = parseFredObservationsResponse(json, 'DCOILBRENTEU');
  assert.equal(out.seriesId, 'DCOILBRENTEU');
  assert.equal(out.observations.length, 3);
  assert.equal(out.observations[0]!.value, 85.42);
  assert.equal(out.observations[2]!.value, null); // missing-value marker
  assert.equal(out.latestDate, '2026-05-05');
  assert.equal(out.latestValue, 85.42);
});

test('FRED parser: missing observations array → empty result', () => {
  const out = parseFredObservationsResponse({}, 'X');
  assert.deepEqual(out.observations, []);
  assert.equal(out.latestValue, null);
});

test('FRED parser: non-object input → empty result', () => {
  const out = parseFredObservationsResponse(null, 'X');
  assert.equal(out.observations.length, 0);
});

test('FRED parser: latest is the highest-date row, not first', () => {
  // Even when sort_order=asc puts the newest at the end, latestDate
  // should be correct.
  const json = {
    observations: [
      { date: '2026-05-01', value: '100' },
      { date: '2026-05-05', value: '110' },
      { date: '2026-05-03', value: '105' },
    ],
  };
  const out = parseFredObservationsResponse(json, 'X');
  assert.equal(out.latestDate, '2026-05-05');
  assert.equal(out.latestValue, 110);
});

test('FRED parser: handles missing dates by dropping the row', () => {
  const json = {
    observations: [
      { date: '2026-05-05', value: '1' },
      { value: '2' }, // dropped — no date
      'not an object', // dropped
    ],
  };
  const out = parseFredObservationsResponse(json, 'X');
  assert.equal(out.observations.length, 1);
});

test('parseFredValue: rejects junk', () => {
  assert.equal(__INTERNAL.parseFredValue('abc'), null);
  assert.equal(__INTERNAL.parseFredValue(null), null);
  assert.equal(__INTERNAL.parseFredValue(undefined), null);
  assert.equal(__INTERNAL.parseFredValue('.'), null);
  assert.equal(__INTERNAL.parseFredValue(''), null);
  assert.equal(__INTERNAL.parseFredValue('NaN'), null);
  assert.equal(__INTERNAL.parseFredValue('42.5'), 42.5);
  assert.equal(__INTERNAL.parseFredValue(42.5), 42.5);
});

// ── buildFredObservationsUrl ───────────────────────────────────────────

test('buildFredObservationsUrl: includes spec-required params', () => {
  const url = buildFredObservationsUrl({ seriesId: 'VIXCLS', apiKey: 'KEY' });
  assert.match(url, /series_id=VIXCLS/);
  assert.match(url, /api_key=KEY/);
  assert.match(url, /limit=90/);
  assert.match(url, /sort_order=desc/);
  assert.match(url, /file_type=json/);
});

test('buildFredObservationsUrl: limit override', () => {
  const url = buildFredObservationsUrl({ seriesId: 'X', apiKey: 'K', limit: 30 });
  assert.match(url, /limit=30/);
});

test('buildFredObservationsUrl: sortOrder override', () => {
  const url = buildFredObservationsUrl({ seriesId: 'X', apiKey: 'K', sortOrder: 'asc' });
  assert.match(url, /sort_order=asc/);
});

// ── ECONOMIC_STRESS_FRED_SERIES catalog ────────────────────────────────

test('series catalog: includes the 4 spec series', () => {
  assert.ok(ECONOMIC_STRESS_FRED_SERIES.includes('DCOILBRENTEU'));
  assert.ok(ECONOMIC_STRESS_FRED_SERIES.includes('GOLDAMGBD228NLBM'));
  assert.ok(ECONOMIC_STRESS_FRED_SERIES.includes('VIXCLS'));
  assert.ok(ECONOMIC_STRESS_FRED_SERIES.includes('DEXUSEU'));
});

// ── OFR FSI parser ─────────────────────────────────────────────────────

test('OFR parser: object envelope with observations array', () => {
  const json = {
    mnemonic: 'OFR_FSI',
    observations: [
      { date: '2026-05-05', value: 0.42 },
      { date: '2026-05-04', value: -0.10 },
    ],
  };
  const out = parseOfrFsiResponse(json);
  assert.equal(out.observations.length, 2);
  assert.equal(out.latestValue, 0.42);
  assert.equal(out.latestDate, '2026-05-05');
});

test('OFR parser: tuple-array shape [date, value]', () => {
  const json = [
    ['2026-05-05', 0.42],
    ['2026-05-04', '-0.1'],
    ['bad-row'], // dropped
  ];
  const out = parseOfrFsiResponse(json);
  assert.equal(out.observations.length, 2);
  assert.equal(out.observations[0]!.value, 0.42);
});

test('OFR parser: data envelope variant', () => {
  const json = { data: [{ date: '2026-05-05', value: 1.5 }] };
  const out = parseOfrFsiResponse(json);
  assert.equal(out.observations.length, 1);
});

test('OFR parser: missing data → empty result', () => {
  const out = parseOfrFsiResponse({});
  assert.deepEqual(out.observations, []);
  assert.equal(out.latestValue, null);
});

test('OFR parser: custom mnemonic', () => {
  const out = parseOfrFsiResponse({}, 'CUSTOM');
  assert.equal(out.mnemonic, 'CUSTOM');
});
