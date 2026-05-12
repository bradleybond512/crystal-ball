import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TIME_RANGES,
  formatPayload,
  formatTimestamp,
  sinceMsForRange,
} from '../notification-history-helpers.ts';

const NOW = Date.parse('2026-05-11T12:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('TIME_RANGES exposes the four spec-mandated presets in display order', () => {
  assert.deepEqual(TIME_RANGES.map((r) => r.id), ['all', 'h1', 'h24', 'd7']);
});

test('sinceMsForRange returns "now − offset" for bounded presets and undefined for "all"', () => {
  assert.equal(sinceMsForRange('all', NOW), undefined);
  assert.equal(sinceMsForRange('h1', NOW), NOW - HOUR);
  assert.equal(sinceMsForRange('h24', NOW), NOW - DAY);
  assert.equal(sinceMsForRange('d7', NOW), NOW - 7 * DAY);
});

test('formatTimestamp ladders seconds → minutes → hours → days', () => {
  assert.equal(formatTimestamp(NOW - 5_000, NOW), '5s ago');
  assert.equal(formatTimestamp(NOW - 5 * MIN, NOW), '5m ago');
  assert.equal(formatTimestamp(NOW - 3 * HOUR, NOW), '3h ago');
  assert.equal(formatTimestamp(NOW - 2 * DAY, NOW), '2d ago');
});

test('formatTimestamp reports "just now" for future-dated entries', () => {
  assert.equal(formatTimestamp(NOW + 1000, NOW), 'just now');
});

test('formatPayload pretty-prints primitives and stringifies nested objects', () => {
  const out = formatPayload({ magnitude: 6.4, place: 'Test', when: 12345,
    coords: { lat: 41, lon: -86 } });
  assert.match(out, /magnitude: 6\.4/);
  assert.match(out, /place: Test/);
  assert.match(out, /coords: \{/);
  assert.match(out, /"lat": 41/);
});

test('formatPayload skips undefined values and handles empty / missing input', () => {
  assert.equal(formatPayload(undefined), '(no payload)');
  assert.equal(formatPayload({ x: undefined }), '(empty)');
  assert.match(formatPayload({ keep: 1, skip: undefined }), /^keep: 1$/);
});
