import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenMeteoAq, parseOpenMeteoAqUnix, parseOpenMeteoWinds, avgNext6h } from '../smoke-parse.ts';

const FIXTURE = {
  latitude: 41.6, longitude: -86.7,
  current: { time: '2026-07-16T14:00', us_aqi: 156, pm2_5: 62.1 },
  hourly: {
    time: ['2026-07-16T14:00', '2026-07-16T15:00', '2026-07-16T16:00'],
    us_aqi: [156, 148, null],
    pm2_5: [62.1, 58.0, null],
  },
};

test('parses current + hourly samples, preserving nulls', () => {
  const parsed = parseOpenMeteoAq(FIXTURE);
  assert.equal(parsed.current.usAqi, 156);
  assert.equal(parsed.current.pm25, 62.1);
  assert.equal(parsed.hourly.length, 3);
  assert.equal(parsed.hourly[2]!.usAqi, null);
});

test('malformed payload → null current, empty hourly (never throws)', () => {
  const parsed = parseOpenMeteoAq({});
  assert.equal(parsed.current.usAqi, null);
  assert.deepEqual(parsed.hourly, []);
});

test('avgNext6h averages available leading samples, null when none', () => {
  assert.equal(avgNext6h([{ time: 't', usAqi: 100, pm25: null }, { time: 't', usAqi: 200, pm25: null }]), 150);
  assert.equal(avgNext6h([{ time: 't', usAqi: null, pm25: null }]), null);
});

test('hasAqData: all-null rows are structure without data (fail-closed)', async () => {
  const { hasAqData } = await import('../smoke-parse.ts');
  assert.equal(hasAqData(parseOpenMeteoAq({ hourly: { time: ['t'], us_aqi: [null] } })), false);
  assert.equal(hasAqData(parseOpenMeteoAq({})), false);
  assert.equal(hasAqData(parseOpenMeteoAq(FIXTURE)), true);
  assert.equal(hasAqData(parseOpenMeteoAq({ current: { us_aqi: 42 } })), true);
});

test('parseOpenMeteoWinds: winds with true epochs from utc_offset_seconds', () => {
  const winds = parseOpenMeteoWinds({
    utc_offset_seconds: -25_200, // UTC-7
    hourly: {
      time: ['2026-07-20T12:00', '2026-07-20T13:00'],
      wind_speed_10m: [14.2, null],
      wind_direction_10m: [320, 315],
    },
  });
  assert.equal(winds.length, 2);
  assert.equal(winds[0]!.speedMph, 14.2);
  assert.equal(winds[0]!.directionDeg, 320);
  assert.equal(winds[1]!.speedMph, null);
  // epoch = wall-as-UTC − offset: 12:00 wall at UTC-7 is 19:00Z.
  assert.equal(winds[0]!.timeMs, Date.parse('2026-07-20T19:00:00Z'));
  assert.deepEqual(parseOpenMeteoWinds({}), []);
});

test('parseOpenMeteoWinds: missing utc_offset_seconds \u2192 timeMs null (legacy fallback)', () => {
  const winds = parseOpenMeteoWinds({
    hourly: { time: ['2026-07-20T12:00'], wind_speed_10m: [10], wind_direction_10m: [0] },
  });
  assert.equal(winds[0]!.timeMs, null);
});

test('parseOpenMeteoAqUnix: epoch seconds \u2192 ms, null when empty', () => {
  const parsed = parseOpenMeteoAqUnix({ hourly: { time: [1_789_000_000, 1_789_003_600], us_aqi: [88, null] } });
  assert.ok(parsed);
  assert.deepEqual(parsed.timesMs, [1_789_000_000_000, 1_789_003_600_000]);
  assert.deepEqual(parsed.usAqi, [88, null]);
  assert.equal(parseOpenMeteoAqUnix({}), null);
  assert.equal(parseOpenMeteoAqUnix({ hourly: { time: [] } }), null);
});
