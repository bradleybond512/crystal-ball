import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertSeverityClass,
  formatArrivalCountdown,
  gpsRiskBlurb,
  stormLevelLabel,
  timeAgo,
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
