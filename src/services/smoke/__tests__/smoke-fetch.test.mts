import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenMeteoAq, avgNext6h } from '../smoke-parse.ts';

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
