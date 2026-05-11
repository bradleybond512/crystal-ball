import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildRecentChanges } from '../src-tauri/sidecar/recent-changes.mjs';

const NOW = 1_700_000_000_000; // fixed epoch for deterministic tests

// ── Helpers ─────────────────────────────────────────────────────────────────

function alert(overrides = {}) {
  return {
    event: 'Thunderstorm Warning',
    headline: 'Severe Thunderstorm Warning',
    effective: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 min ago
    ...overrides,
  };
}

function feed(overrides = {}) {
  return {
    key: 'nws',
    lastSuccessAt: null,
    lastError: 'ETIMEDOUT',
    lastAttemptAt: NOW - 5 * 60 * 1000, // 5 min ago
    ...overrides,
  };
}

// ── Empty / null inputs ──────────────────────────────────────────────────────

test('returns empty items when both inputs are null/empty', () => {
  const result = buildRecentChanges([], null, NOW);
  assert.deepEqual(result, { items: [] });
});

test('returns empty items when alertCache has no alerts array', () => {
  const result = buildRecentChanges([], { fetchedAt: new Date(NOW).toISOString() }, NOW);
  assert.deepEqual(result, { items: [] });
});

test('returns empty items when feedSnapshots is empty and no alert cache', () => {
  const result = buildRecentChanges([], null, NOW);
  assert.equal(result.items.length, 0);
});

// ── Alert inclusion / exclusion ──────────────────────────────────────────────

test('includes an alert within 60 min window', () => {
  const alertCache = { alerts: [alert({ effective: new Date(NOW - 30 * 60 * 1000).toISOString() })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].type, 'alert');
});

test('excludes an alert older than 60 min', () => {
  const alertCache = { alerts: [alert({ effective: new Date(NOW - 61 * 60 * 1000).toISOString() })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items.length, 0);
});

test('excludes an alert with a future effective time', () => {
  const alertCache = { alerts: [alert({ effective: new Date(NOW + 5 * 60 * 1000).toISOString() })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items.length, 0);
});

test('excludes an alert with an unparseable effective date', () => {
  const alertCache = { alerts: [alert({ effective: 'not-a-date' })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items.length, 0);
});

test('uses headline as the alert label when present', () => {
  const alertCache = { alerts: [alert({ headline: 'Tornado Warning for Adams County' })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items[0].label, 'Tornado Warning for Adams County');
});

test('falls back to event field when headline is empty', () => {
  const alertCache = { alerts: [alert({ headline: '', event: 'Flash Flood Watch' })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items[0].label, 'Flash Flood Watch');
});

// ── Feed inclusion / exclusion ───────────────────────────────────────────────

test('includes a stale feed that has never succeeded', () => {
  const result = buildRecentChanges([feed()], null, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].type, 'stale_feed');
});

test('excludes a feed whose last success is recent (<30 min)', () => {
  const freshFeed = feed({ lastSuccessAt: NOW - 10 * 60 * 1000 });
  const result = buildRecentChanges([freshFeed], null, NOW);
  assert.equal(result.items.length, 0);
});

test('excludes a feed with no lastError', () => {
  const healthyFeed = feed({ lastError: null });
  const result = buildRecentChanges([healthyFeed], null, NOW);
  assert.equal(result.items.length, 0);
});

test('excludes a stale feed whose lastAttemptAt is older than 60 min', () => {
  const oldFeed = feed({ lastAttemptAt: NOW - 65 * 60 * 1000 });
  const result = buildRecentChanges([oldFeed], null, NOW);
  assert.equal(result.items.length, 0);
});

test('includes the feed key in the stale feed label', () => {
  const result = buildRecentChanges([feed({ key: 'acled' })], null, NOW);
  assert.ok(result.items[0].label.includes('acled'), 'label must contain feed key');
});

// ── Sorting ──────────────────────────────────────────────────────────────────

test('sorts items by ageMs ascending (newest first)', () => {
  const alertCache = {
    alerts: [
      alert({ effective: new Date(NOW - 50 * 60 * 1000).toISOString() }),
      alert({ effective: new Date(NOW - 5 * 60 * 1000).toISOString() }),
    ],
  };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.equal(result.items.length, 2);
  assert.ok(result.items[0].ageMs < result.items[1].ageMs, 'newest item must come first');
});

test('mixes alert and stale_feed items sorted by age', () => {
  const alertCache = { alerts: [alert({ effective: new Date(NOW - 40 * 60 * 1000).toISOString() })] };
  const staleFeed = feed({ lastAttemptAt: NOW - 2 * 60 * 1000 });
  const result = buildRecentChanges([staleFeed], alertCache, NOW);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].type, 'stale_feed');
  assert.equal(result.items[1].type, 'alert');
});

// ── ageMs value ───────────────────────────────────────────────────────────────

test('ageMs is accurate for an alert', () => {
  const OFFSET_MS = 15 * 60 * 1000;
  const alertCache = { alerts: [alert({ effective: new Date(NOW - OFFSET_MS).toISOString() })] };
  const result = buildRecentChanges([], alertCache, NOW);
  assert.ok(
    Math.abs(result.items[0].ageMs - OFFSET_MS) < 1000,
    `ageMs should be ~${OFFSET_MS}ms, got ${result.items[0].ageMs}`,
  );
});
