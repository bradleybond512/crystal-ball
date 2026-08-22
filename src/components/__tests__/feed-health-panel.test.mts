/**
 * Tests for the pure helpers exposed by FeedHealthPanel: the sidecar
 * /api/health.feeds[] merger and the data-freshness adapter.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  collectDataFreshnessSnapshots,
  mergeFeedSnapshotsByAttempt,
  mergeLifelineProviderHealth,
  mergeSidecarFeeds,
  parseLifelineProviderHealthEvent,
  shortenEndpoint,
} from '../feed-health-helpers.ts';
import { FEED_CATALOG, type FeedDefinition } from '@/services/diagnostics/feed-catalog';

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

test('USGS surface-water route telemetry maps to its Feed Health row', () => {
  const out = mergeSidecarFeeds([{
    key: 'usgs-surface-water', lastSuccessAt: NOW, lastError: null, lastAttemptAt: NOW,
  }], FEED_CATALOG);
  assert.equal(out['usgs-surface-water']?.lastSuccessAt, NOW);
  assert.equal(out['usgs-surface-water']?.lastError, null);
});

// ── collectDataFreshnessSnapshots ─────────────────────────────────────────

test('collectDataFreshnessSnapshots maps DataSourceId state into FeedSnapshot', () => {
  const fakeState = {
    getAllSources: () => [
      { id: 'usgs', name: 'USGS', enabled: true, lastUpdate: new Date(NOW - 30_000),
        lastError: null, itemCount: 12, requiredForRisk: false, status: 'fresh' as const },
      { id: 'opensky', name: 'OpenSky', enabled: true, lastUpdate: null,
        lastError: 'timeout', lastErrorAt: NOW - 10_000, itemCount: 0, requiredForRisk: false, status: 'no_data' as const },
    ],
  };
  const out = collectDataFreshnessSnapshots(TEST_CATALOG, fakeState as never);
  assert.equal(out['usgs-earthquakes']?.lastSuccessAt, NOW - 30_000);
  assert.equal(out['opensky']?.lastSuccessAt, null);
  assert.equal(out['opensky']?.lastError, 'timeout');
  assert.equal(out['opensky']?.lastAttemptAt, NOW - 10_000);
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

test('collectDataFreshnessSnapshots never fans one aggregate identity out to distinct feed rows', () => {
  const sharedCatalog: FeedDefinition[] = [
    { id: 'xray', name: 'X-ray', category: 'space', endpoint: 'https://example.com/x',
      pollIntervalMs: 60_000, sourceId: 'space-weather' },
    { id: 'kp', name: 'Kp', category: 'space', endpoint: 'https://example.com/k',
      pollIntervalMs: 60_000, sourceId: 'space-weather' },
  ];
  const out = collectDataFreshnessSnapshots(sharedCatalog, {
    getAllSources: () => [{ id: 'space-weather', lastUpdate: new Date(NOW), lastError: null }],
  } as never);
  assert.deepEqual(out, {}, 'aggregate success cannot paint either distinct provider fresh');
});

test('Lifelines document health events reject malformed, duplicate, and future provider rows', () => {
  const valid = {
    schemaVersion: 2,
    fetchedAt: NOW,
    providers: [{ id: 'ornl-odin', state: 'ok', acceptedRows: 1, droppedRows: 0, retrievedAt: NOW }],
  };
  assert.equal(parseLifelineProviderHealthEvent(valid, NOW).length, 1);
  assert.deepEqual(parseLifelineProviderHealthEvent({ schemaVersion: 2, providers: [null] }, NOW), []);
  assert.deepEqual(parseLifelineProviderHealthEvent({
    schemaVersion: 2,
    fetchedAt: NOW,
    providers: [valid.providers[0], valid.providers[0]],
  }, NOW), []);
  assert.deepEqual(parseLifelineProviderHealthEvent({
    schemaVersion: 2,
    fetchedAt: NOW,
    providers: [{ ...valid.providers[0], retrievedAt: NOW + 10 * 60_000 }],
  }, NOW), []);
  assert.deepEqual(parseLifelineProviderHealthEvent({
    ...valid, fetchedAt: NOW + 10 * 60_000,
  }, NOW), []);
  const failedAttempt = parseLifelineProviderHealthEvent({
    schemaVersion: 2,
    fetchedAt: NOW,
    providers: [{ id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 0,
      observedAt: null, reasonCode: 'request_failed' }],
  }, NOW);
  assert.equal(failedAttempt[0]?.retrievedAt, NOW,
    'a provider failure uses the validated snapshot attempt time, never a success timestamp');

  const panelSource = readFileSync(new URL('../FeedHealthPanel.ts', import.meta.url), 'utf8');
  assert.match(panelSource, /parseLifelineProviderHealthEvent\(\(event as CustomEvent<unknown>\)\.detail\)/);
  assert.doesNotMatch(panelSource, /providers as LifelineProviderHealth\[\]/);
});

test('lifeline provider health records success only when normalized rows contributed', () => {
  const out = mergeLifelineProviderHealth([
    { id: 'osm', state: 'ok', acceptedRows: 2, droppedRows: 0, retrievedAt: new Date(NOW) },
    { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, retrievedAt: new Date(NOW) },
    { id: 'fema-recovery-centers', state: 'ok', acceptedRows: 0, droppedRows: 3, retrievedAt: new Date(NOW) },
    { id: 'ornl-odin', state: 'partial', acceptedRows: 1, droppedRows: 1, retrievedAt: new Date(NOW) },
  ]);

  assert.equal(out['openstreetmap-lifelines']?.lastSuccessAt, NOW);
  assert.equal(out['fema-open-shelters']?.lastSuccessAt, null);
  assert.equal(out['fema-open-shelters']?.lastError, 'no_contributed_rows');
  assert.equal(out['fema-recovery-centers']?.lastSuccessAt, null);
  assert.equal(out['fema-recovery-centers']?.lastError, 'no_contributed_rows');
  assert.equal(out['ornl-odin']?.lastSuccessAt, NOW);
});

test('lifeline provider health uses retrieval time, never legacy observedAt, for polling telemetry', () => {
  const out = mergeLifelineProviderHealth([{
    id: 'fema-recovery-centers',
    state: 'ok',
    acceptedRows: 1,
    droppedRows: 0,
    observedAt: new Date(NOW - 60_000),
    retrievedAt: new Date(NOW),
    sourceObservedAt: new Date(NOW - 3_600_000),
  }]);
  assert.equal(out['fema-recovery-centers']?.lastSuccessAt, NOW);
  assert.equal(out['fema-recovery-centers']?.lastAttemptAt, NOW);
});

test('an older sidecar success cannot overwrite a newer zero-contribution provider attempt', () => {
  const successful = mergeSidecarFeeds([{
    key: 'ornl-odin', lastSuccessAt: NOW - 60_000, lastAttemptAt: NOW - 60_000, lastError: null,
  }], [{
    id: 'ornl-odin', name: 'ODIN', category: 'energy', endpoint: 'https://odin.example',
    pollIntervalMs: 60_000, sidecarKey: 'ornl-odin',
  }]);
  const empty = mergeLifelineProviderHealth([{
    id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0, retrievedAt: NOW,
  }]);
  const afterEmpty = mergeFeedSnapshotsByAttempt(successful, empty);
  const afterStaleHealthPoll = mergeFeedSnapshotsByAttempt(afterEmpty, successful);

  assert.equal(afterStaleHealthPoll['ornl-odin']?.lastSuccessAt, null);
  assert.equal(afterStaleHealthPoll['ornl-odin']?.lastError, 'no_contributed_rows');
  assert.equal(afterStaleHealthPoll['ornl-odin']?.lastAttemptAt, NOW);
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
