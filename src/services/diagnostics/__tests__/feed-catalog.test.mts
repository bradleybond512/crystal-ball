import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEED_CATALOG,
  FEED_CATALOG_MIN_COUNT,
  buildFeedRows,
  classifyFeedHealth,
  formatLastPoll,
  summarizeFeedHealth,
  type FeedSnapshot,
} from '../feed-catalog.ts';

const NOW = Date.parse('2026-05-08T12:00:00Z');
const MIN = 60 * 1000;

function snapshot(over: Partial<FeedSnapshot>): FeedSnapshot {
  return { id: 'test', lastSuccessAt: null, lastError: null, lastAttemptAt: null, ...over };
}

// ── Catalog sanity ────────────────────────────────────────────────────────

test('FEED_CATALOG covers the spec-mandated minimum feeds', () => {
  assert.ok(FEED_CATALOG.length >= FEED_CATALOG_MIN_COUNT,
    `expected ≥${FEED_CATALOG_MIN_COUNT} feeds, got ${FEED_CATALOG.length}`);
});

test('FEED_CATALOG entries have unique ids', () => {
  const ids = new Set<string>();
  for (const def of FEED_CATALOG) {
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
    ids.add(def.id);
  }
});

test('data-freshness identities are one-to-one and never shared across provider rows', () => {
  const bindings = FEED_CATALOG.filter((feed) => feed.sourceId);
  assert.equal(new Set(bindings.map((feed) => feed.sourceId)).size, bindings.length);
});

test('FEED_CATALOG entries use HTTPS or WSS endpoints', () => {
  for (const def of FEED_CATALOG) {
    assert.match(def.endpoint, /^(https|wss):\/\//, `${def.id}: ${def.endpoint}`);
  }
});

test('FEED_CATALOG includes the spec-listed core feeds', () => {
  const names = FEED_CATALOG.map((d) => d.name.toLowerCase());
  for (const expected of [
    'usgs earthquakes', 'swpc x-ray flux', 'swpc planetary kp',
    'nws alerts', 'nhc tropical cyclones', 'nasa firms modis',
    'nasa firms viirs', 'nifc fire perimeters', 'airnow aqi',
    'eia-930 grid', 'ornl odin county outages', 'cloudflare radar bgp',
    'epa radnet', 'gdelt doc api', 'acled conflict',
    'alienvault otx', 'fred economic', 'opensky network',
    'aisstream vessels', 'purpleair sensors',
    'usgs surface water',
  ]) {
    assert.ok(names.some((n) => n.includes(expected)),
      `missing spec feed "${expected}" in catalog`);
  }
});

test('FEED_CATALOG active grid path contains ODIN and no PowerOutage.us entry', () => {
  assert.ok(FEED_CATALOG.some((feed) => feed.id === 'ornl-odin'));
  assert.equal(FEED_CATALOG.some((feed) => feed.id === 'poweroutage-us'), false);
  assert.equal(FEED_CATALOG.some((feed) => /poweroutage\.us/i.test(feed.name)), false);
});

test('FEED_CATALOG poll intervals are positive and ≤ 24h', () => {
  for (const def of FEED_CATALOG) {
    assert.ok(def.pollIntervalMs > 0, `${def.id} interval ${def.pollIntervalMs}`);
    assert.ok(def.pollIntervalMs <= 24 * 60 * 60 * 1000, `${def.id} interval too large`);
  }
});

// ── classifyFeedHealth ────────────────────────────────────────────────────

test('classifyFeedHealth returns "never" for an empty snapshot', () => {
  assert.equal(classifyFeedHealth(snapshot({}), 60_000, NOW), 'never');
});

test('classifyFeedHealth returns "fresh" within 2× the poll interval', () => {
  const snap = snapshot({ lastSuccessAt: NOW - 90_000, lastAttemptAt: NOW - 90_000 });
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'fresh');
});

test('classifyFeedHealth returns "stale" between 2× and 10× the interval', () => {
  const snap = snapshot({ lastSuccessAt: NOW - 5 * 60_000, lastAttemptAt: NOW - 5 * 60_000 });
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'stale');
});

test('classifyFeedHealth returns "error" beyond 10× the interval', () => {
  const snap = snapshot({ lastSuccessAt: NOW - 20 * 60_000, lastAttemptAt: NOW - 20 * 60_000 });
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'error');
});

test('classifyFeedHealth returns "error" when last fetch errored', () => {
  const snap = snapshot({
    lastSuccessAt: NOW - 30_000,
    lastAttemptAt: NOW - 1_000,
    lastError: 'HTTP 503',
  });
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'error');
});

test('classifyFeedHealth ignores stale errors when a more-recent success exists', () => {
  const snap = snapshot({
    lastSuccessAt: NOW - 1_000,
    lastAttemptAt: NOW - 5 * 60_000,
    lastError: 'old failure 5 min ago',
  });
  // success time > attempt time means the error pre-dated the success — still fresh.
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'fresh');
});

test('classifyFeedHealth treats an equal-time latest failure as error', () => {
  const snap = snapshot({
    lastSuccessAt: NOW - 1_000,
    lastAttemptAt: NOW - 1_000,
    lastError: 'no_contributed_rows',
  });
  assert.equal(classifyFeedHealth(snap, 60_000, NOW), 'error');
});

// ── buildFeedRows ─────────────────────────────────────────────────────────

test('buildFeedRows fills missing snapshots as "never"', () => {
  const rows = buildFeedRows(FEED_CATALOG, {}, NOW);
  assert.equal(rows.length, FEED_CATALOG.length);
  for (const r of rows) {
    assert.equal(r.status, 'never');
    assert.equal(r.lastSuccessAt, null);
  }
});

test('buildFeedRows merges snapshots against the catalog', () => {
  const snapshots: Record<string, FeedSnapshot> = {
    'usgs-earthquakes': { id: 'usgs-earthquakes', lastSuccessAt: NOW - 30_000,
      lastAttemptAt: NOW - 30_000, lastError: null },
    'opensky': { id: 'opensky', lastSuccessAt: null, lastError: 'rate-limited',
      lastAttemptAt: NOW - 5_000 },
  };
  const rows = buildFeedRows(FEED_CATALOG, snapshots, NOW);
  const usgs = rows.find((r) => r.id === 'usgs-earthquakes')!;
  assert.equal(usgs.status, 'fresh');
  const opensky = rows.find((r) => r.id === 'opensky')!;
  assert.equal(opensky.status, 'error');
  assert.equal(opensky.lastError, 'rate-limited');
});

// ── Roll-up + formatting ──────────────────────────────────────────────────

test('summarizeFeedHealth rolls up counts by status', () => {
  const rows = buildFeedRows(FEED_CATALOG.slice(0, 4), {
    'usgs-earthquakes': { id: 'usgs-earthquakes', lastSuccessAt: NOW - 30_000,
      lastAttemptAt: NOW - 30_000, lastError: null },
    'nws-alerts': { id: 'nws-alerts', lastSuccessAt: NOW - 5 * 60_000,
      lastAttemptAt: NOW - 5 * 60_000, lastError: null },
    'nhc-tropical': { id: 'nhc-tropical', lastSuccessAt: null,
      lastAttemptAt: NOW - 1_000, lastError: 'CORS' },
    // swpc-xray missing → never
  }, NOW);
  const summary = summarizeFeedHealth(rows);
  assert.equal(summary.total, 4);
  assert.equal(summary.fresh, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.error, 1);
  assert.equal(summary.never, 1);
});

test('formatLastPoll renders human-readable ages', () => {
  assert.equal(formatLastPoll(snapshot({}), NOW), '—');
  assert.equal(formatLastPoll(snapshot({ lastSuccessAt: NOW - 30_000 }), NOW), 'just now');
  assert.equal(formatLastPoll(snapshot({ lastSuccessAt: NOW - 5 * MIN }), NOW), '5m ago');
  assert.equal(formatLastPoll(snapshot({ lastSuccessAt: NOW - 3 * 60 * MIN }), NOW), '3h ago');
  assert.equal(formatLastPoll(snapshot({ lastSuccessAt: NOW - 26 * 60 * MIN }), NOW), '1d ago');
});

test('formatLastPoll falls back to lastAttemptAt when no success has been recorded', () => {
  const snap = snapshot({ lastAttemptAt: NOW - 4 * MIN, lastError: 'boom' });
  assert.equal(formatLastPoll(snap, NOW), '4m ago');
});

test('formatLastPoll shows a later failed attempt instead of an older success', () => {
  const snap = snapshot({
    lastSuccessAt: NOW - 10 * MIN,
    lastAttemptAt: NOW - 2 * MIN,
    lastError: 'upstream unavailable',
  });
  assert.equal(formatLastPoll(snap, NOW), '2m ago');
});
