import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTimeDimension,
  parseTimeDimension,
  smokeForecastHoursFromNow,
  getSmokeForecastTileUrl,
  FIREWORK_LAYER,
} from '../firework-smoke.ts';

const HOUR = 3_600_000;

// Trimmed from the real layer-filtered GetCapabilities (2026-07-29).
const CAPS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0">
  <Layer queryable="1" opaque="0" cascaded="0">
    <Name>RAQDPS.Sfc_PM2.5-WildfireSmokePlume</Name>
    <Title>Total concentrations associated with forest fire and vegetation plumes: surface PM2.5 [kg/m³]</Title>
    <Dimension name="time" units="ISO8601" default="2026-07-29T05:00:00Z" nearestValue="0">2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H</Dimension>
    <Dimension name="reference_time" units="ISO8601" default="2026-07-29T00:00:00Z" multipleValues="1" nearestValue="0">2026-07-27T00:00:00Z/2026-07-29T00:00:00Z/PT12H</Dimension>
  </Layer>
</WMS_Capabilities>`;

test('extractTimeDimension pulls the time interval, not reference_time', () => {
  assert.equal(
    extractTimeDimension(CAPS_FIXTURE),
    '2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H',
  );
});

test('extractTimeDimension returns null when absent', () => {
  assert.equal(extractTimeDimension('<WMS_Capabilities></WMS_Capabilities>'), null);
});

test('parseTimeDimension expands a 72 h hourly interval into 73 frames', () => {
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  assert.equal(frames.length, 73);
  assert.equal(frames[0], Date.parse('2026-07-29T00:00:00Z'));
  assert.equal(frames[72], Date.parse('2026-08-01T00:00:00Z'));
  assert.equal(frames[1]! - frames[0]!, HOUR);
});

test('parseTimeDimension accepts a bare timestamp', () => {
  assert.deepEqual(
    parseTimeDimension('2026-07-29T05:00:00Z'),
    [Date.parse('2026-07-29T05:00:00Z')],
  );
});

test('parseTimeDimension rejects malformed input without looping', () => {
  assert.deepEqual(parseTimeDimension('garbage'), []);
  assert.deepEqual(parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT0H'), []);
  assert.deepEqual(parseTimeDimension('2026-08-01T00:00:00Z/2026-07-29T00:00:00Z/PT1H'), []);
  assert.deepEqual(parseTimeDimension('a/b/c/d'), []);
});

test('smokeForecastHoursFromNow drops frames before the current hour', () => {
  const start = Date.parse('2026-07-29T00:00:00Z');
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  const now = start + 5 * HOUR + 20 * 60 * 1000; // 05:20Z
  const hours = smokeForecastHoursFromNow({ frames, fetchedAt: now }, now);
  assert.equal(hours[0], start + 5 * HOUR); // hour containing "now"
  assert.equal(hours.length, 68);
});

test('getSmokeForecastTileUrl without state omits TIME but stays renderable', () => {
  const url = getSmokeForecastTileUrl(null);
  assert.match(url, /\{bbox-epsg-3857\}/);
  assert.match(url, new RegExp(`LAYERS=${FIREWORK_LAYER.replace(/[.]/g, '\\.')}`));
  assert.doesNotMatch(url, /TIME=/);
});

test('getSmokeForecastTileUrl pins TIME to the nearest frame and clamps out-of-range targets', () => {
  const frames = parseTimeDimension('2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H');
  const state = { frames, fetchedAt: 0 };
  const nearMs = Date.parse('2026-07-29T05:00:00Z') + 10 * 60 * 1000;
  assert.match(getSmokeForecastTileUrl(state, nearMs), /TIME=2026-07-29T05:00:00Z/);
  const wayLate = Date.parse('2026-08-05T00:00:00Z');
  assert.match(getSmokeForecastTileUrl(state, wayLate), /TIME=2026-08-01T00:00:00Z/);
});
