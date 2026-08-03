import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertSeverityClass,
  buildWindStrip,
  bzBadgeColor,
  formatArrivalCountdown,
  gpsRiskBlurb,
  stormLevelLabel,
  timeAgo,
  windObservationAge,
  windSpeedBadgeColor,
  xrayBadgeColor,
} from '../space-weather-helpers.ts';

const NOW = Date.parse('2026-05-06T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

test('stormLevelLabel maps each G level to a human label', () => {
  assert.equal(stormLevelLabel('G0'), 'Quiet');
  assert.equal(stormLevelLabel('G1'), 'Minor storm');
  assert.equal(stormLevelLabel('G3'), 'Strong storm');
  assert.equal(stormLevelLabel('G5'), 'Extreme storm');
});

test('gpsRiskBlurb explains each risk band', () => {
  assert.equal(gpsRiskBlurb('high'), 'X-class — degraded fixes');
  assert.equal(gpsRiskBlurb('moderate'), 'M-class — possible drift');
  assert.equal(gpsRiskBlurb('low'), 'C-class — minor');
  assert.equal(gpsRiskBlurb('none'), 'Nominal');
});

test('alertSeverityClass routes severities to CSS modifier classes', () => {
  assert.equal(alertSeverityClass('alert'), 'sw-danger');
  assert.equal(alertSeverityClass('warning'), 'sw-warning');
  assert.equal(alertSeverityClass('watch'), 'sw-warning');
  assert.equal(alertSeverityClass('summary'), 'sw-info');
});

test('formatArrivalCountdown reports T-h within 12h as critical', () => {
  const r = formatArrivalCountdown(NOW + 8 * HOUR_MS, NOW);
  assert.match(r.label, /^T-8\.0h$/);
  assert.equal(r.severityClass, 'sw-danger');
});

test('formatArrivalCountdown reports T-h within 24h as warning', () => {
  const r = formatArrivalCountdown(NOW + 18 * HOUR_MS, NOW);
  assert.match(r.label, /^T-18h$/);
  assert.equal(r.severityClass, 'sw-warning');
});

test('formatArrivalCountdown switches to days past 24h', () => {
  const r = formatArrivalCountdown(NOW + 36 * HOUR_MS, NOW);
  assert.match(r.label, /^T-1\.5d$/);
});

test('formatArrivalCountdown reports "arriving now" when arrival is in the past <6h', () => {
  const r = formatArrivalCountdown(NOW - 2 * HOUR_MS, NOW);
  assert.equal(r.label, 'arriving now');
  assert.equal(r.severityClass, 'sw-danger');
});

test('formatArrivalCountdown reports "arrived" when arrival is older than 6h', () => {
  const r = formatArrivalCountdown(NOW - 24 * HOUR_MS, NOW);
  assert.equal(r.label, 'arrived');
});

test('formatArrivalCountdown handles non-finite arrival', () => {
  const r = formatArrivalCountdown(Number.NaN, NOW);
  assert.equal(r.label, 'arrival unknown');
});

test('xrayBadgeColor maps the leading class char to a colour', () => {
  assert.equal(xrayBadgeColor('X1.2'), '#ff453a');
  assert.equal(xrayBadgeColor('M5.0'), '#ff5722');
  assert.equal(xrayBadgeColor('C3.1'), '#ffeb3b');
  assert.equal(xrayBadgeColor('B7.0'), '#4caf50');
  assert.equal(xrayBadgeColor(null), '#9e9e9e');
});

test('timeAgo formats elapsed time relative to "now"', () => {
  assert.equal(timeAgo(new Date(NOW), NOW), 'just now');
  assert.equal(timeAgo(new Date(NOW - 5 * 60 * 1000), NOW), '5m ago');
  assert.equal(timeAgo(new Date(NOW - 3 * HOUR_MS), NOW), '3h ago');
});

test('bzBadgeColor is asymmetric — only southward Bz is dangerous', () => {
  // The whole point of the scale. A symmetric magnitude test would paint a
  // strongly northward IMF, which is the quietest condition there is, the same
  // red as the storm that actually knocks the grid about.
  assert.equal(bzBadgeColor(-18), '#ff453a');
  assert.equal(bzBadgeColor(18), '#4caf50');
  assert.equal(bzBadgeColor(-12), '#ff5722');
  assert.equal(bzBadgeColor(-7), '#ff9800');
  assert.equal(bzBadgeColor(-1), '#4caf50');
  assert.equal(bzBadgeColor(0), '#4caf50');
});

test('bzBadgeColor treats an absent or non-finite reading as unknown, not calm', () => {
  // Green would assert "quiet" off a value we never got.
  assert.equal(bzBadgeColor(null), '#9e9e9e');
  assert.equal(bzBadgeColor(Number.NaN), '#9e9e9e');
});

test('windSpeedBadgeColor escalates with stream speed', () => {
  assert.equal(windSpeedBadgeColor(380), '#4caf50');
  assert.equal(windSpeedBadgeColor(520), '#ffeb3b');
  assert.equal(windSpeedBadgeColor(650), '#ff9800');
  assert.equal(windSpeedBadgeColor(850), '#ff453a');
  assert.equal(windSpeedBadgeColor(null), '#9e9e9e');
});

test('windObservationAge reports a fresh sample as fresh', () => {
  const r = windObservationAge(new Date(NOW - 4 * 60 * 1000).toISOString(), NOW);
  assert.equal(r.label, '4m ago');
  assert.equal(r.stale, false);
});

test('windObservationAge flags a sample past the L1 cadence as stale', () => {
  // Nothing in parseSolarWindFeed bounds observation age — it returns the
  // newest row it can find however old that is — so an hour-old reading
  // otherwise renders identically to a live one.
  const r = windObservationAge(new Date(NOW - 90 * 60 * 1000).toISOString(), NOW);
  assert.equal(r.label, '1h ago');
  assert.equal(r.stale, true);
});

test('windObservationAge treats an unknown age as stale rather than current', () => {
  // Claiming freshness we cannot demonstrate is the failure worth avoiding:
  // these all render as a number the user would read as "now".
  for (const bad of [null, '', 'not-a-date']) {
    const r = windObservationAge(bad, NOW);
    assert.equal(r.label, 'age unknown', `${String(bad)} is not a time`);
    assert.equal(r.stale, true, `${String(bad)} must not read as fresh`);
  }
});

test('buildWindStrip formats a live reading with units', () => {
  // The exact live values from services.swpc.noaa.gov at the time this was
  // written, so the shape being formatted is the shape SWPC actually ships.
  const view = buildWindStrip({
    solarWindSpeed: 385.9,
    solarWindDensity: 10.45,
    bz: -12.7,
    windObservedAt: new Date(NOW - 4 * 60 * 1000).toISOString(),
  }, NOW);
  assert.equal(view.meta, 'measured 4m ago');
  assert.equal(view.metaWarn, false);
  // 10.45 → '10.4': toFixed rounds the binary double, which sits a hair below
  // the decimal literal. Pinned as observed rather than as arithmetic would
  // suggest, since a tenth of a proton per cm³ changes nothing here.
  assert.deepEqual(view.cells.map((c) => c.value), ['386 km/s', '10.4 p/cm³', '-12.7 nT']);
  assert.equal(view.cells[2]?.sub, 'Southward — storm driver');
  assert.equal(view.cells[2]?.color, '#ff5722');
});

test('buildWindStrip signs a northward Bz so the sign is never ambiguous', () => {
  const view = buildWindStrip({
    solarWindSpeed: 400, solarWindDensity: 5, bz: 7.13, windObservedAt: null,
  }, NOW);
  assert.equal(view.cells[2]?.value, '+7.1 nT');
  assert.equal(view.cells[2]?.sub, 'Northward is quiet');
});

test('buildWindStrip renders absent values as dashes, never as zero', () => {
  // A solar wind of 0 km/s would be the end of the world. Formatting a missing
  // reading as a number is how "we have no data" becomes "we have alarming
  // data" — or, worse here, reassuringly calm data.
  const view = buildWindStrip({
    solarWindSpeed: null, solarWindDensity: null, bz: null, windObservedAt: null,
  }, NOW);
  assert.deepEqual(view.cells.map((c) => c.value), ['—', '—', '—']);
  assert.equal(view.meta, 'no solar-wind telemetry in this fetch');
  assert.equal(view.metaWarn, true);
  assert.equal(view.cells[0]?.color, '#9e9e9e', 'grey, not the green of a calm reading');
});

test('buildWindStrip warns when the reading is real but stale', () => {
  // The dangerous middle case: numbers ARE present, so nothing looks wrong,
  // but they are an hour old. Without metaWarn this renders as live telemetry.
  const view = buildWindStrip({
    solarWindSpeed: 700,
    solarWindDensity: 3.2,
    bz: -2,
    windObservedAt: new Date(NOW - 2 * HOUR_MS).toISOString(),
  }, NOW);
  assert.equal(view.meta, 'measured 2h ago');
  assert.equal(view.metaWarn, true);
});

test('buildWindStrip treats non-finite readings as missing, not as numbers', () => {
  // NaN and Infinity survive a `=== null` check and format as "NaN km/s" with
  // confident units. The badge helpers already call them unknown, so without
  // this the number and its colour tell the user two different stories.
  const view = buildWindStrip({
    solarWindSpeed: Number.NaN,
    solarWindDensity: Number.POSITIVE_INFINITY,
    bz: Number.NaN,
    windObservedAt: new Date(NOW).toISOString(),
  }, NOW);
  assert.deepEqual(view.cells.map((c) => c.value), ['—', '—', '—']);
  assert.equal(view.meta, 'no solar-wind telemetry in this fetch');
  assert.equal(view.metaWarn, true);
});

test('buildWindStrip does not call a missing Bz quiet', () => {
  // Bz is the best short-horizon storm predictor there is. "Northward is quiet"
  // off a null reading is the magnetometer going dark reported as an all-clear.
  const view = buildWindStrip({
    solarWindSpeed: 420, solarWindDensity: 4, bz: null, windObservedAt: null,
  }, NOW);
  assert.equal(view.cells[2]?.value, '—');
  assert.equal(view.cells[2]?.sub, 'No magnetometer reading');
  assert.notEqual(view.cells[2]?.sub, 'Northward is quiet');
});

test('windObservationAge reads a naïve SWPC stamp as UTC, not host-local', () => {
  // SWPC ships "2026-05-06 11:30:00" with no zone. Bare Date.parse reads that
  // as host-LOCAL, so a UTC-5 host would age it by an extra five hours and call
  // a live reading stale — the same bug already fixed twice in the parse path.
  const naive = '2026-05-06 11:30:00';
  const r = windObservationAge(naive, NOW);
  assert.equal(r.label, '30m ago');
  assert.equal(r.stale, false);
  // And it must agree with the explicitly-stamped form of the same instant.
  assert.deepEqual(windObservationAge('2026-05-06T11:30:00Z', NOW), r);
});

test('windObservationAge tolerates the small forward skew of a propagated stamp', () => {
  // Rows are propagated from L1 to the bow shock, so a stamp a few minutes
  // ahead of the wall clock is routine. Beyond the tolerance it is corrupt.
  assert.equal(windObservationAge(new Date(NOW + 5 * 60 * 1000).toISOString(), NOW).stale, false);
  assert.equal(windObservationAge(new Date(NOW + 60 * 60 * 1000).toISOString(), NOW).label, 'age unknown');
});
