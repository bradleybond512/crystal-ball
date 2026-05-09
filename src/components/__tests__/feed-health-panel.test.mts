/**
 * Tests for the pure helpers exposed by FeedHealthPanel: the sidecar
 * /api/health.feeds[] merger and the data-freshness adapter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectDataFreshnessSnapshots,
  mergeSidecarFeeds,
  shortenEndpoint,
} from '../feed-health-helpers.ts';
import type { FeedDefinition } from '@/services/diagnostics/feed-catalog';

const NOW = Date.parse('2026-05-08T12:00:00Z');

const TEST_CATALOG: FeedDefinition[] = [
  { id: 'usgs-earthquakes', name: 'USGS Earthquakes', category: 'natural',
    endpoint: 'https://earthquake.usgs.gov/feed', pollIntervalMs: 60_000,
    sourceId: 'usgs', sidecarKey: 'usgs' },
  { id: 'opensky', name: 'OpenSky', category: 'aviation',
    endpoint: 'https://opensky-network.org/api/states/all', pollIntervalMs: 90_000,
    sourceId: 'opensky', sidecarKey: 'opensky' },
  { id: 'fred', name: 'FRED', category: 'data',
    endpoint: 'https://fred.stlouisfed.org', pollIntervalMs: 3_600_000,
    sidecarKey: 'fred' /* no DataSourceId — sidecar-only */ },
];

// ── mergeSidecarFeeds ────────────────────────────────────────────────────

test('mergeSidecarFeeds keys snapshots by sidecarKey, not by id', () => {
  const out = mergeSidecarFeeds([
    { key: 'usgs', lastSuccessAt: NOW, lastError: null, lastAttemptAt: NOW },
    { key: 'opensky', lastSuccessAt: null, lastError: 'rate-limit', lastAttemptAt: NOW },
  ], TEST_CATALOG);
  assert.equal(out['usgs-earthquakes']?.lastSuccessAt, NOW);
  assert.equal(out['opensky']?.lastError, 'rate-limit');
});

test('mergeSidecarFeeds tolerates ISO-string timestamps', () => {
  const iso = '2026-05-08T11:55:00.000Z';
  const out = mergeSidecarFeeds([
    { key: 'fred', lastSuccessAt: iso, lastAttemptAt: iso, lastError: null },
  ], TEST_CATALOG);
  assert.equal(out['fred']?.lastSuccessAt, Date.parse(iso));
});

test('mergeSidecarFeeds drops feeds without a sidecarKey match', () => {
  const out = mergeSidecarFeeds([
    { key: 'unknown-feed', lastSuccessAt: NOW, lastError: null, lastAttemptAt: NOW },
  ], TEST_CATALOG);
  assert.deepEqual(out, {});
});

test('mergeSidecarFeeds tolerates missing optional fields', () => {
  const out = mergeSidecarFeeds([
    { key: 'fred' },
  ], TEST_CATALOG);
  assert.deepEqual(out['fred'], {
    id: 'fred', lastSuccessAt: null, lastError: null, lastAttemptAt: null,
  });
});

// ── collectDataFreshnessSnapshots ─────────────────────────────────────────

test('collectDataFreshnessSnapshots maps DataSourceId state into FeedSnapshot', () => {
  const fakeState = {
    getAllSources: () => [
      { id: 'usgs', name: 'USGS', enabled: true, lastUpdate: new Date(NOW - 30_000),
        lastError: null, itemCount: 12, requiredForRisk: false, status: 'fresh' as const },
      { id: 'opensky', name: 'OpenSky', enabled: true, lastUpdate: null,
        lastError: 'timeout', itemCount: 0, requiredForRisk: false, status: 'no_data' as const },
    ],
  };
  const out = collectDataFreshnessSnapshots(TEST_CATALOG, fakeState as never);
  assert.equal(out['usgs-earthquakes']?.lastSuccessAt, NOW - 30_000);
  assert.equal(out['opensky']?.lastSuccessAt, null);
  assert.equal(out['opensky']?.lastError, 'timeout');
  // Catalog entry without a DataSourceId stays absent — sidecar fills it.
  assert.equal(out['fred'], undefined);
});

test('collectDataFreshnessSnapshots ignores DataSourceIds not in the catalog', () => {
  const fakeState = {
    getAllSources: () => [
      { id: 'random-source-not-in-catalog', name: 'X', enabled: true,
        lastUpdate: new Date(NOW), lastError: null, itemCount: 0,
        requiredForRisk: false, status: 'fresh' as const },
    ],
  };
  const out = collectDataFreshnessSnapshots(TEST_CATALOG, fakeState as never);
  assert.equal(Object.keys(out).length, 0);
});

// ── shortenEndpoint ───────────────────────────────────────────────────────

test('shortenEndpoint keeps short URLs intact', () => {
  assert.equal(shortenEndpoint('https://api.example.com/x'), 'https://api.example.com/x');
});

test('shortenEndpoint truncates long URLs by path', () => {
  const long = 'https://services.swpc.noaa.gov/products/some/very/deep/path/with/lots/of/segments.json';
  const out = shortenEndpoint(long);
  assert.ok(out.length < long.length);
  assert.match(out, /^https:\/\/services\.swpc\.noaa\.gov/);
});
