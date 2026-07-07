import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDurationMinutes, formatDurationMs } from '../format-duration.ts';

// ── formatDurationMinutes ──────────────────────────────────────────────

test('minutes below an hour render as bare minutes', () => {
  assert.equal(formatDurationMinutes(0), '0m');
  assert.equal(formatDurationMinutes(1), '1m');
  assert.equal(formatDurationMinutes(45), '45m');
  assert.equal(formatDurationMinutes(59), '59m');
});

test('hours keep a minute remainder ("3h 20m")', () => {
  assert.equal(formatDurationMinutes(200), '3h 20m');
  assert.equal(formatDurationMinutes(61), '1h 1m');
});

test('exact hours drop the zero minute unit', () => {
  assert.equal(formatDurationMinutes(60), '1h');
  assert.equal(formatDurationMinutes(180), '3h');
});

test('days keep an hour remainder ("5d 7h") — never "120h"', () => {
  assert.equal(formatDurationMinutes(5 * 1440 + 7 * 60), '5d 7h');
  assert.equal(formatDurationMinutes(120 * 60), '5d'); // the old "120h" case
  assert.equal(formatDurationMinutes(1441), '1d'); // sub-hour remainder dropped
});

test('two largest units max — day durations never show minutes', () => {
  assert.equal(formatDurationMinutes(1440 + 90), '1d 1h');
});

test('negative and fractional inputs are clamped / rounded', () => {
  assert.equal(formatDurationMinutes(-5), '0m');
  assert.equal(formatDurationMinutes(59.6), '1h');
  assert.equal(formatDurationMinutes(44.4), '44m');
});

// ── formatDurationMs ───────────────────────────────────────────────────

test('sub-minute milliseconds render as seconds', () => {
  assert.equal(formatDurationMs(0), '0s');
  assert.equal(formatDurationMs(42_000), '42s');
  assert.equal(formatDurationMs(59_999), '59s');
});

test('minute-and-above milliseconds delegate to the minute formatter', () => {
  assert.equal(formatDurationMs(60_000), '1m');
  assert.equal(formatDurationMs(200 * 60_000), '3h 20m');
  assert.equal(formatDurationMs(120 * 3_600_000), '5d');
});

test('negative milliseconds clamp to zero', () => {
  assert.equal(formatDurationMs(-1000), '0s');
});
