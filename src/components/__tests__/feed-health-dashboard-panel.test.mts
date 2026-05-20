import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAge } from '../feed-health-dashboard-helpers.ts';

const NOW = new Date('2026-05-20T12:00:00Z').getTime();

// ── never / just now boundary ─────────────────────────────────────────────

test('formatAge returns "never" when lastSeenAt is 0', () => {
  assert.equal(formatAge(0, NOW), 'never');
});

test('formatAge returns "just now" at 0ms elapsed', () => {
  assert.equal(formatAge(NOW, NOW), 'just now');
});

test('formatAge returns "just now" at 1ms elapsed', () => {
  assert.equal(formatAge(NOW - 1, NOW), 'just now');
});

test('formatAge returns "just now" at 59.999s elapsed', () => {
  assert.equal(formatAge(NOW - 59_999, NOW), 'just now');
});

// ── minutes boundary ──────────────────────────────────────────────────────

test('formatAge returns "1m ago" at exactly 60s elapsed', () => {
  assert.equal(formatAge(NOW - 60_000, NOW), '1m ago');
});

test('formatAge returns "1m ago" at 61s elapsed', () => {
  assert.equal(formatAge(NOW - 61_000, NOW), '1m ago');
});

test('formatAge returns "5m ago" at 5 minutes elapsed', () => {
  assert.equal(formatAge(NOW - 5 * 60_000, NOW), '5m ago');
});

test('formatAge returns "14m ago" at 14 minutes elapsed', () => {
  assert.equal(formatAge(NOW - 14 * 60_000, NOW), '14m ago');
});

test('formatAge returns "15m ago" at 15 minutes elapsed', () => {
  assert.equal(formatAge(NOW - 15 * 60_000, NOW), '15m ago');
});

test('formatAge returns "59m ago" at 59 minutes elapsed', () => {
  assert.equal(formatAge(NOW - 59 * 60_000, NOW), '59m ago');
});

test('formatAge returns "59m ago" at just under 1 hour elapsed', () => {
  assert.equal(formatAge(NOW - 3_599_999, NOW), '59m ago');
});

// ── hours boundary ────────────────────────────────────────────────────────

test('formatAge returns "1h ago" at exactly 1 hour elapsed', () => {
  assert.equal(formatAge(NOW - 3_600_000, NOW), '1h ago');
});

test('formatAge returns "1h ago" at 1 hour 1 second elapsed', () => {
  assert.equal(formatAge(NOW - 3_601_000, NOW), '1h ago');
});

test('formatAge returns "2h ago" at 2 hours elapsed', () => {
  assert.equal(formatAge(NOW - 2 * 3_600_000, NOW), '2h ago');
});

test('formatAge returns "23h ago" at 23 hours elapsed', () => {
  assert.equal(formatAge(NOW - 23 * 3_600_000, NOW), '23h ago');
});

test('formatAge returns "23h ago" at just under 1 day elapsed', () => {
  assert.equal(formatAge(NOW - 86_399_999, NOW), '23h ago');
});

// ── days boundary ─────────────────────────────────────────────────────────

test('formatAge returns "1d ago" at exactly 1 day elapsed', () => {
  assert.equal(formatAge(NOW - 86_400_000, NOW), '1d ago');
});

test('formatAge returns "2d ago" at 2 days elapsed', () => {
  assert.equal(formatAge(NOW - 2 * 86_400_000, NOW), '2d ago');
});

test('formatAge returns "7d ago" at 7 days elapsed', () => {
  assert.equal(formatAge(NOW - 7 * 86_400_000, NOW), '7d ago');
});

// ── additional edge cases ─────────────────────────────────────────────────

test('formatAge returns "30d ago" at 30 days elapsed', () => {
  assert.equal(formatAge(NOW - 30 * 86_400_000, NOW), '30d ago');
});

test('formatAge returns "365d ago" at 365 days elapsed', () => {
  assert.equal(formatAge(NOW - 365 * 86_400_000, NOW), '365d ago');
});

test('formatAge returns "just now" at 30 seconds elapsed (not yet 1 minute)', () => {
  assert.equal(formatAge(NOW - 30_000, NOW), 'just now');
});

test('formatAge returns "1m ago" when now equals lastSeenAt + exactly 60000ms boundary', () => {
  const past = NOW - 120_000;
  assert.equal(formatAge(past, NOW), '2m ago');
});

test('formatAge handles very large timestamps (far past Unix epoch)', () => {
  // 1 year and 1 day ago
  const farPast = NOW - (366 * 86_400_000);
  assert.equal(formatAge(farPast, NOW), '366d ago');
});

test('formatAge returns "just now" at exactly 59000ms (59 full seconds)', () => {
  assert.equal(formatAge(NOW - 59_000, NOW), 'just now');
});
