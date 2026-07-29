/**
 * Parity: the sidecar's hand-kept port of the HRRR-Smoke pure helpers
 * (src-tauri/sidecar/hrrr-smoke.mjs) MUST agree byte-for-byte with the
 * canonical TS module (src/services/smoke/hrrr-smoke.ts). The sidecar owns the
 * NOMADS fetch + wgrib2 decode; the cycle/URL/idx/AQI math is shared, and if it
 * ever drifts the map's HRRR field would silently disagree with the contract.
 * Change one, change both — this test is the guard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as ts from '../hrrr-smoke.ts';
// eslint-disable-next-line import/extensions
import * as mjs from '../../../../src-tauri/sidecar/hrrr-smoke.mjs';

test('latestHrrrCycle agrees across a day of timestamps + latencies', () => {
  for (let h = 0; h < 24; h++) {
    for (const lat of [0, 1, 2, 3]) {
      const now = Date.UTC(2026, 6, 22, h, 37, 0);
      assert.deepEqual(mjs.latestHrrrCycle(now, lat), ts.latestHrrrCycle(now, lat), `h=${h} lat=${lat}`);
    }
  }
  // Default latency + a date-rollover case.
  const rollover = Date.UTC(2026, 6, 22, 1, 30, 0);
  assert.deepEqual(mjs.latestHrrrCycle(rollover), ts.latestHrrrCycle(rollover));
});

test('maxForecastHour agrees for every cycle hour', () => {
  for (let h = 0; h < 24; h++) {
    const cycle = { date: '20260722', hour: h };
    assert.equal(mjs.maxForecastHour(cycle), ts.maxForecastHour(cycle), `hour ${h}`);
  }
});

test('hrrrSmokeUrls agrees on grib + idx URLs', () => {
  for (const hour of [0, 3, 12, 18]) {
    for (const fh of [1, 6, 18, 48]) {
      const cycle = { date: '20260722', hour };
      assert.deepEqual(mjs.hrrrSmokeUrls(cycle, fh), ts.hrrrSmokeUrls(cycle, fh), `hour=${hour} fh=${fh}`);
    }
  }
});

test('parseIdxByteRange agrees (bounded, open-ended, absent, malformed)', () => {
  const bounded = [
    '1:0:d=2026072212:REFC:entire atmosphere:6 hour fcst:',
    '2:1000:d=2026072212:MASSDEN:8 m above ground:6 hour fcst:',
    '3:2000:d=2026072212:TMP:surface:6 hour fcst:',
  ].join('\n');
  const openEnded = [
    '1:0:d=2026072212:REFC:entire atmosphere:6 hour fcst:',
    '2:1000:d=2026072212:MASSDEN:8 m above ground:6 hour fcst:',
  ].join('\n');
  const malformed = [
    '1::d=2026072212:MASSDEN:8 m above ground:6 hour fcst:', // empty offset
    '2:2000:d=2026072212:TMP:surface:6 hour fcst:',
  ].join('\n');
  const sel = { field: 'MASSDEN', level: '8 m above ground' };
  const absent = { field: 'MASSDEN', level: '80 m above ground' };
  for (const [idx, s] of [[bounded, sel], [openEnded, sel], [bounded, absent], [malformed, sel]] as const) {
    assert.deepEqual(mjs.parseIdxByteRange(idx, s), ts.parseIdxByteRange(idx, s));
  }
});

test('rangeHeader agrees (closed + open-ended)', () => {
  assert.equal(mjs.rangeHeader({ start: 1000, end: 1999 }), ts.rangeHeader({ start: 1000, end: 1999 }));
  assert.equal(mjs.rangeHeader({ start: 1000, end: null }), ts.rangeHeader({ start: 1000, end: null }));
});

test('smokePm25ToUsAqi agrees across the full concentration sweep', () => {
  const probes = [null, Number.NaN, -1, 0, 9, 9.09, 9.1, 35.4, 35.49, 55.5, 125.5, 225.5, 325.4, 325.5, 1000];
  for (const p of probes) {
    assert.equal(mjs.smokePm25ToUsAqi(p), ts.smokePm25ToUsAqi(p), `ugm3=${p}`);
  }
  // Dense sweep to catch any breakpoint edge drift.
  for (let c = 0; c <= 400; c += 0.3) {
    assert.equal(mjs.smokePm25ToUsAqi(c), ts.smokePm25ToUsAqi(c), `ugm3=${c}`);
  }
});
