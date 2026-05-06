import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIRE_RADIUS_KM,
  FLOOD_RADIUS_KM,
  KNOWN_VOLCANO_COORDS,
  SEISMIC_MIN_MAGNITUDE,
  SEISMIC_VOLCANO_RADIUS_KM,
  WebcamTriggerRegistry,
  evaluateFireTrigger,
  evaluateFloodTrigger,
  evaluateSeismicVolcanoTrigger,
} from '../webcam-event-triggers.ts';
import { WebcamSpatialIndex } from '../webcam-spatial.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(overrides: Partial<WebcamFeed>): WebcamFeed {
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

const KILAUEA = KNOWN_VOLCANO_COORDS[0]!;
const NOW = 1_745_000_000_000;

// ── Seismic / Volcano ───────────────────────────────────────────────────

test('seismic_volcano: M4.5+ near volcano with cam → trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'kil-cam', lat: KILAUEA.lat, lon: KILAUEA.lon, category: 'volcano' }),
    ],
  });
  const trig = evaluateSeismicVolcanoTrigger(
    {
      id: 'usgs:1',
      lat: KILAUEA.lat + 0.05,
      lon: KILAUEA.lon + 0.05,
      magnitude: 5.1,
      occurredAt: NOW,
    },
    index,
    NOW,
  );
  assert.ok(trig);
  assert.equal(trig.kind, 'seismic_volcano');
  assert.deepEqual(trig.affectedCamIds, ['kil-cam']);
  assert.equal(trig.metadata.volcano, 'Kilauea');
});

test('seismic_volcano: below M4.5 threshold → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'kil-cam', lat: KILAUEA.lat, lon: KILAUEA.lon, category: 'volcano' })],
  });
  const trig = evaluateSeismicVolcanoTrigger(
    { id: 'q', lat: KILAUEA.lat, lon: KILAUEA.lon, magnitude: SEISMIC_MIN_MAGNITUDE - 0.1, occurredAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

test('seismic_volcano: outside 150km of any volcano → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'kil-cam', lat: KILAUEA.lat, lon: KILAUEA.lon, category: 'volcano' })],
  });
  // ~5° east of Kilauea = ~530 km away
  const trig = evaluateSeismicVolcanoTrigger(
    { id: 'q', lat: KILAUEA.lat, lon: KILAUEA.lon + 5, magnitude: 6.0, occurredAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

test('seismic_volcano: no volcano cams → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'fire-cam', lat: KILAUEA.lat, lon: KILAUEA.lon, category: 'fire' })],
  });
  const trig = evaluateSeismicVolcanoTrigger(
    { id: 'q', lat: KILAUEA.lat, lon: KILAUEA.lon, magnitude: 5.0, occurredAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

test('seismic_volcano: null magnitude → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'kil-cam', lat: KILAUEA.lat, lon: KILAUEA.lon, category: 'volcano' })],
  });
  const trig = evaluateSeismicVolcanoTrigger(
    { id: 'q', lat: KILAUEA.lat, lon: KILAUEA.lon, magnitude: null, occurredAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

// ── Fire ────────────────────────────────────────────────────────────────

test('fire: incident within FIRE_RADIUS_KM of fire cam → trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'aw-1', lat: 38.0, lon: -120.0, category: 'fire' }),
      feed({ id: 'aw-2', lat: 38.0, lon: -119.0, category: 'fire' }), // ~88 km east
      feed({ id: 'unrelated', lat: 38.0, lon: -120.0, category: 'weather' }),
    ],
  });
  const trig = evaluateFireTrigger(
    { id: 'fire-1', lat: 38.0, lon: -120.0, name: 'Test Fire', detectedAt: NOW },
    index,
    NOW,
  );
  assert.ok(trig);
  assert.equal(trig.kind, 'fire');
  assert.ok(trig.affectedCamIds.includes('aw-1'));
  assert.ok(!trig.affectedCamIds.includes('unrelated'));
});

test('fire: incident far from any fire cam → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'aw', lat: 38, lon: -120, category: 'fire' })],
  });
  const trig = evaluateFireTrigger(
    { id: 'f', lat: 25, lon: -80, name: 'X', detectedAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

test('fire: confirmed FIRE_RADIUS_KM constant is 75', () => {
  assert.equal(FIRE_RADIUS_KM, 75);
});

// ── Flood ───────────────────────────────────────────────────────────────

test('flood: gauge at action stage with nearby stream cam → trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'gauge-cam', lat: 38.5, lon: -121.5, category: 'stream' })],
  });
  const trig = evaluateFloodTrigger(
    { siteNo: '11447650', lat: 38.5, lon: -121.5, stageLabel: 'action', observedAt: NOW },
    index,
    NOW,
  );
  assert.ok(trig);
  assert.equal(trig.kind, 'flood');
  assert.deepEqual(trig.affectedCamIds, ['gauge-cam']);
});

test('flood: picks nearest stream cam when multiple in range', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'far', lat: 38.5, lon: -121.0, category: 'stream' }), // ~43km east
      feed({ id: 'near', lat: 38.5, lon: -121.5, category: 'stream' }),
    ],
  });
  const trig = evaluateFloodTrigger(
    { siteNo: 's', lat: 38.5, lon: -121.5, stageLabel: 'major', observedAt: NOW },
    index,
  );
  assert.ok(trig);
  assert.deepEqual(trig.affectedCamIds, ['near']);
});

test('flood: invalid stageLabel rejected', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'g', lat: 38.5, lon: -121.5, category: 'stream' })],
  });
  const trig = evaluateFloodTrigger(
    {
      siteNo: 's',
      lat: 38.5,
      lon: -121.5,
      // @ts-expect-error — testing runtime validation
      stageLabel: 'normal',
      observedAt: NOW,
    },
    index,
  );
  assert.equal(trig, null);
});

test('flood: gauge with no stream cams in range → no trigger', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'g', lat: 38, lon: -121, category: 'stream' })],
  });
  const trig = evaluateFloodTrigger(
    { siteNo: 's', lat: 50, lon: -100, stageLabel: 'major', observedAt: NOW },
    index,
  );
  assert.equal(trig, null);
});

test('flood: confirmed FLOOD_RADIUS_KM constant is 50', () => {
  assert.equal(FLOOD_RADIUS_KM, 50);
});

// ── Registry ────────────────────────────────────────────────────────────

test('WebcamTriggerRegistry: stores and returns active events within window', () => {
  const reg = new WebcamTriggerRegistry(60_000); // 60s window
  reg.push({
    kind: 'fire',
    triggeredAt: NOW,
    affectedCamIds: ['a'],
    reason: 'r',
    metadata: {},
  });
  const active = reg.active(NOW + 30_000);
  assert.equal(active.length, 1);
});

test('WebcamTriggerRegistry: drops events outside window', () => {
  const reg = new WebcamTriggerRegistry(60_000);
  reg.push({ kind: 'fire', triggeredAt: NOW, affectedCamIds: ['a'], reason: 'r', metadata: {} });
  const active = reg.active(NOW + 120_000);
  assert.equal(active.length, 0);
});

test('SEISMIC_VOLCANO_RADIUS_KM constant exposed for callers', () => {
  assert.equal(SEISMIC_VOLCANO_RADIUS_KM, 150);
});
