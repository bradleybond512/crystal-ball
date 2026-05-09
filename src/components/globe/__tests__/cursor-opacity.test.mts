import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULTS,
  bucketCounts,
  coerceTimestampMs,
  opacityForEntity,
} from '../cursor-opacity.ts';

const NOW = Date.parse('2026-05-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;

// ── opacityForEntity ──────────────────────────────────────────────────

test('opacity: entity within ±2h window → insideAlpha (1.0)', () => {
  assert.equal(opacityForEntity(NOW, NOW), DEFAULTS.insideAlpha);
  assert.equal(opacityForEntity(NOW - HOUR, NOW), DEFAULTS.insideAlpha);
  assert.equal(opacityForEntity(NOW + HOUR, NOW), DEFAULTS.insideAlpha);
});

test('opacity: entity exactly at the half-window boundary → inside', () => {
  assert.equal(opacityForEntity(NOW + DEFAULTS.halfWindowMs, NOW), DEFAULTS.insideAlpha);
  assert.equal(opacityForEntity(NOW - DEFAULTS.halfWindowMs, NOW), DEFAULTS.insideAlpha);
});

test('opacity: entity past the half-window → outsideAlpha (0.3)', () => {
  assert.equal(opacityForEntity(NOW + DEFAULTS.halfWindowMs + 1, NOW), DEFAULTS.outsideAlpha);
  assert.equal(opacityForEntity(NOW - DEFAULTS.halfWindowMs - 1, NOW), DEFAULTS.outsideAlpha);
});

test('opacity: timeless entity (null/undefined) keeps full alpha', () => {
  assert.equal(opacityForEntity(null, NOW), DEFAULTS.insideAlpha);
  assert.equal(opacityForEntity(undefined, NOW), DEFAULTS.insideAlpha);
});

test('opacity: NaN timestamp → treated as timeless (full alpha)', () => {
  assert.equal(opacityForEntity(Number.NaN, NOW), DEFAULTS.insideAlpha);
});

test('opacity: custom halfWindowMs widens or narrows', () => {
  // 1-day window
  const dayMs = 24 * HOUR;
  const farPast = NOW - 12 * HOUR;
  assert.equal(opacityForEntity(farPast, NOW, { halfWindowMs: dayMs }), 1);
  assert.equal(opacityForEntity(farPast, NOW, { halfWindowMs: HOUR }), DEFAULTS.outsideAlpha);
});

test('opacity: custom alpha overrides apply', () => {
  assert.equal(
    opacityForEntity(NOW + 5 * HOUR, NOW, { outsideAlpha: 0.05 }),
    0.05,
  );
  assert.equal(
    opacityForEntity(NOW, NOW, { insideAlpha: 0.8 }),
    0.8,
  );
});

// ── coerceTimestampMs ─────────────────────────────────────────────────

test('coerceTimestampMs: ms number passes through', () => {
  assert.equal(coerceTimestampMs(NOW), NOW);
});

test('coerceTimestampMs: Date is unwrapped to ms', () => {
  assert.equal(coerceTimestampMs(new Date(NOW)), NOW);
});

test('coerceTimestampMs: ISO string is parsed', () => {
  assert.equal(coerceTimestampMs('2026-05-08T12:00:00Z'), NOW);
});

test('coerceTimestampMs: invalid input → null', () => {
  assert.equal(coerceTimestampMs('not-a-date'), null);
  assert.equal(coerceTimestampMs(null), null);
  assert.equal(coerceTimestampMs(undefined), null);
  assert.equal(coerceTimestampMs({}), null);
  assert.equal(coerceTimestampMs(Number.NaN), null);
});

// ── bucketCounts ──────────────────────────────────────────────────────

test('bucketCounts: tallies inside / outside / timeless', () => {
  const stamps = [
    NOW,                    // inside
    NOW - HOUR,             // inside
    NOW + 5 * HOUR,         // outside
    NOW - 24 * HOUR,        // outside
    null,                   // timeless
    Number.NaN,             // timeless
    undefined,              // timeless
  ];
  const counts = bucketCounts(stamps, NOW);
  assert.equal(counts.inside, 2);
  assert.equal(counts.outside, 2);
  assert.equal(counts.timeless, 3);
});

test('bucketCounts: empty input → all zeros', () => {
  const counts = bucketCounts([], NOW);
  assert.equal(counts.inside, 0);
  assert.equal(counts.outside, 0);
  assert.equal(counts.timeless, 0);
});
