import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditFeeds,
  defaultFeedSentinels,
  type FeedSentinel,
} from '../sentinel-feed-audit.ts';

const NOW = 1_745_000_000_000;
const MIN = 60_000;

const nws: FeedSentinel = {
  feedId: 'nws-alerts',
  label: 'NWS alerts',
  purpose: 'severe weather alerts',
  expectedRefreshMs: 5 * MIN,
  staleCeilingMs: 15 * MIN,
  silentCeilingMs: 60 * MIN,
  safetyCritical: true,
  remediation: 'Check NWS API connectivity.',
};

const eia: FeedSentinel = {
  feedId: 'eia',
  label: 'EIA inventories',
  purpose: 'energy stress',
  expectedRefreshMs: 24 * 60 * MIN,
  staleCeilingMs: 36 * 60 * MIN,
  silentCeilingMs: 7 * 24 * 60 * MIN,
  safetyCritical: false,
  remediation: 'Check EIA API key.',
};

// ── Per-feed level decision ────────────────────────────────────────────

test('fresh: snapshot inside expected refresh window', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 2 * MIN }],
  });
  assert.equal(r.entries[0]?.level, 'fresh');
  assert.equal(r.level, 'healthy');
});

test('stale: past expected but within stale ceiling', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 10 * MIN }],
  });
  assert.equal(r.entries[0]?.level, 'stale');
});

test('late: past stale ceiling but within silent ceiling', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 30 * MIN }],
  });
  assert.equal(r.entries[0]?.level, 'late');
});

test('silent: past silent ceiling', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 90 * MIN }],
  });
  assert.equal(r.entries[0]?.level, 'silent');
});

test('unknown: no snapshot recorded', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [],
  });
  assert.equal(r.entries[0]?.level, 'unknown');
});

// ── Report-level escalation ────────────────────────────────────────────

test('safety-critical late feed escalates report to critical', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 30 * MIN }],
  });
  assert.equal(r.level, 'critical');
});

test('non-safety stale feed → degraded', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [eia],
    snapshots: [{ feedId: 'eia', lastSuccessAt: NOW - 26 * 60 * MIN }],
  });
  assert.equal(r.level, 'degraded');
});

test('non-safety silent feed → critical', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [eia],
    snapshots: [{ feedId: 'eia', lastSuccessAt: NOW - 8 * 24 * 60 * MIN }],
  });
  assert.equal(r.level, 'critical');
});

test('all-fresh report is healthy', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws, eia],
    snapshots: [
      { feedId: 'nws-alerts', lastSuccessAt: NOW },
      { feedId: 'eia', lastSuccessAt: NOW - 2 * 60 * MIN },
    ],
  });
  assert.equal(r.level, 'healthy');
  assert.match(r.summary, /All 2 feeds fresh/);
});

// ── Recommendations + ordering ─────────────────────────────────────────

test('recommendations: safety-critical feeds come first', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [eia, nws],
    snapshots: [
      { feedId: 'nws-alerts', lastSuccessAt: NOW - 30 * MIN },
      { feedId: 'eia', lastSuccessAt: NOW - 5 * 24 * 60 * MIN },
    ],
  });
  assert.match(r.recommendations[0] ?? '', /NWS/);
});

test('feed reasons cite the age and last error', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 30 * MIN, lastError: 'connection refused' }],
  });
  assert.match(r.entries[0]?.reason ?? '', /connection refused/);
});

// ── Default catalog ────────────────────────────────────────────────────

test('defaultFeedSentinels covers eight feeds across safety + non-safety', () => {
  const sentinels = defaultFeedSentinels();
  const ids = new Set(sentinels.map((s) => s.feedId));
  assert.ok(ids.has('nws-alerts'));
  assert.ok(ids.has('usgs-earthquakes'));
  assert.ok(ids.has('gdacs'));
  assert.ok(ids.has('eia-inventories'));
  assert.ok(ids.has('fred'));
  assert.ok(ids.has('fews-net'));
  assert.ok(ids.has('adsbexchange'));
  assert.ok(ids.has('opensky'));
  assert.equal(sentinels.length, 8);
});

test('audit using the default catalog runs without throwing on empty snapshots', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: defaultFeedSentinels(),
    snapshots: [],
  });
  assert.equal(r.entries.length, 8);
  // All unknown → degraded
  for (const e of r.entries) assert.equal(e.level, 'unknown');
  assert.equal(r.level, 'degraded');
});

// ── JSON ───────────────────────────────────────────────────────────────

test('report is JSON-serializable', () => {
  const r = auditFeeds({
    generatedAt: NOW,
    sentinels: [nws],
    snapshots: [{ feedId: 'nws-alerts', lastSuccessAt: NOW - 30 * MIN }],
  });
  const parsed = JSON.parse(JSON.stringify(r)) as { level: string };
  assert.equal(parsed.level, 'critical');
});
