import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_MARKER_COLOR,
  OFFLINE_PROBE_TIMEOUT_MS,
  OFFLINE_REPROBE_INTERVAL_MS,
  buildSnapshotFilename,
  computeBoundsForFeeds,
  decideOfflineStatus,
  projectEquirectangular,
} from '../panel-extras.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(overrides: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'cam',
    source: 'FAA',
    name: 'Cam',
    lat: 0,
    lon: 0,
    snapshotUrl: 'x',
    refreshIntervalSec: 60,
    category: 'weather',
    metadata: {},
    ...overrides,
  };
}

// ── computeBoundsForFeeds ───────────────────────────────────────────────

test('computeBoundsForFeeds: returns null on empty', () => {
  assert.equal(computeBoundsForFeeds([]), null);
});

test('computeBoundsForFeeds: spans min and max lat/lon', () => {
  const bounds = computeBoundsForFeeds([
    feed({ lat: 30, lon: -80 }),
    feed({ lat: 40, lon: -100 }),
    feed({ lat: 35, lon: -90 }),
  ]);
  assert.deepEqual(bounds, { minLat: 30, maxLat: 40, minLon: -100, maxLon: -80 });
});

test('computeBoundsForFeeds: skips invalid coords', () => {
  const bounds = computeBoundsForFeeds([
    feed({ lat: NaN, lon: -80 }),
    feed({ lat: 40, lon: -100 }),
  ]);
  assert.deepEqual(bounds, { minLat: 40, maxLat: 40, minLon: -100, maxLon: -100 });
});

// ── projectEquirectangular ──────────────────────────────────────────────

test('projectEquirectangular: northwest of bounds → top-left of viewport', () => {
  const vp = {
    width: 100,
    height: 100,
    bounds: { minLat: 30, maxLat: 40, minLon: -100, maxLon: -90 },
    paddingPx: 0,
  };
  const p = projectEquirectangular(40, -100, vp);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('projectEquirectangular: southeast of bounds → bottom-right', () => {
  const vp = {
    width: 100,
    height: 100,
    bounds: { minLat: 30, maxLat: 40, minLon: -100, maxLon: -90 },
    paddingPx: 0,
  };
  const p = projectEquirectangular(30, -90, vp);
  assert.equal(p.x, 100);
  assert.equal(p.y, 100);
});

test('projectEquirectangular: respects padding', () => {
  const vp = {
    width: 100,
    height: 100,
    bounds: { minLat: 30, maxLat: 40, minLon: -100, maxLon: -90 },
    paddingPx: 10,
  };
  const p = projectEquirectangular(40, -100, vp);
  assert.equal(p.x, 10);
  assert.equal(p.y, 10);
});

// ── buildSnapshotFilename ───────────────────────────────────────────────

test('buildSnapshotFilename: sanitizes camera name', () => {
  const name = buildSnapshotFilename('I-94 East at Exit 100!', 1_745_000_000_000);
  assert.match(name, /^crystalball-cam-I-94-East-at-Exit-100-/);
  assert.match(name, /\.jpg$/);
});

test('buildSnapshotFilename: trims leading/trailing dashes', () => {
  const name = buildSnapshotFilename('!!Cam!!', 1_745_000_000_000);
  assert.match(name, /^crystalball-cam-Cam-/);
});

test('buildSnapshotFilename: empty name → fallback to "cam"', () => {
  const name = buildSnapshotFilename('!!!', 1_745_000_000_000);
  assert.match(name, /^crystalball-cam-cam-/);
});

test('buildSnapshotFilename: includes ISO timestamp', () => {
  const name = buildSnapshotFilename('X', 1_745_000_000_000);
  // 1_745_000_000_000 = 2025-04-18T16:53:20.000Z → minus the colons/dots
  assert.match(name, /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
});

// ── decideOfflineStatus ─────────────────────────────────────────────────

test('decideOfflineStatus: 200 OK → online', () => {
  assert.equal(decideOfflineStatus({ responseStatus: 200 }), 'online');
});

test('decideOfflineStatus: 304 Not Modified → online', () => {
  assert.equal(decideOfflineStatus({ responseStatus: 304 }), 'online');
});

test('decideOfflineStatus: 404 → offline', () => {
  assert.equal(decideOfflineStatus({ responseStatus: 404 }), 'offline');
});

test('decideOfflineStatus: 500 → offline', () => {
  assert.equal(decideOfflineStatus({ responseStatus: 500 }), 'offline');
});

test('decideOfflineStatus: timed out → offline', () => {
  assert.equal(decideOfflineStatus({ timedOut: true }), 'offline');
});

test('decideOfflineStatus: AbortError → offline', () => {
  assert.equal(decideOfflineStatus({ errorName: 'AbortError' }), 'offline');
});

test('decideOfflineStatus: TypeError (CORS) → unknown', () => {
  assert.equal(decideOfflineStatus({ errorName: 'TypeError' }), 'unknown');
});

test('decideOfflineStatus: no input → unknown', () => {
  assert.equal(decideOfflineStatus({}), 'unknown');
});

// ── Constants ───────────────────────────────────────────────────────────

test('OFFLINE_PROBE_TIMEOUT_MS is 8s', () => {
  assert.equal(OFFLINE_PROBE_TIMEOUT_MS, 8000);
});

test('OFFLINE_REPROBE_INTERVAL_MS is 5min', () => {
  assert.equal(OFFLINE_REPROBE_INTERVAL_MS, 5 * 60 * 1000);
});

test('CATEGORY_MARKER_COLOR has every category', () => {
  for (const cat of ['fire', 'volcano', 'weather', 'coastal', 'stream', 'traffic', 'nature']) {
    assert.match(
      CATEGORY_MARKER_COLOR[cat as keyof typeof CATEGORY_MARKER_COLOR],
      /^#[0-9a-f]{6}$/i,
    );
  }
});
