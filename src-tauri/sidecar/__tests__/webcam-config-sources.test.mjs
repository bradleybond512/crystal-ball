import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-webcam-config-sources';

// Import the pure extractWebcamFeeds function exported from the sidecar.
import { extractWebcamFeeds } from '../local-api-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixturesDir = path.join(__dirname, '../../../src/services/webcams/__tests__/fixtures');
const caltransFixture = require(path.join(fixturesDir, 'caltrans-cwwp2.sample.json'));
const tflFixture = require(path.join(fixturesDir, 'tfl-jamcams.sample.json'));
const singaporeFixture = require(path.join(fixturesDir, 'singapore-lta.sample.json'));

// ── Caltrans config (mirroring CALTRANS_CONFIG from webcam-source-configs.ts) ──

const CALTRANS_MAP = {
  id: (row) => {
    const district = row?.cctv?.location?.district ?? 'UNK';
    const idx = row?.cctv?.index ?? 'UNK';
    return `d${district}:${idx}`;
  },
  name: 'cctv.location.locationName',
  lat: 'cctv.location.latitude',
  lon: 'cctv.location.longitude',
  snapshotUrl: 'cctv.imageData.static.currentImageURL',
  streamUrl: 'cctv.imageData.streamingVideoURL',
};

const caltransFeeds = extractWebcamFeeds('CALTRANS', 'data', CALTRANS_MAP, 'traffic', 60, null, { country: 'US' }, [caltransFixture]);

test('Caltrans sidecar: produces 2 feeds from fixture', () => {
  assert.equal(caltransFeeds.length, 2);
});

test('Caltrans sidecar: all ids prefixed with CALTRANS:', () => {
  for (const f of caltransFeeds) {
    assert.ok(f.id.startsWith('CALTRANS:'), `id ${f.id} should start with CALTRANS:`);
  }
});

test('Caltrans sidecar: ids are unique', () => {
  const ids = caltransFeeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Caltrans sidecar: coords are finite numbers', () => {
  for (const f of caltransFeeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('Caltrans sidecar: snapshotUrl present on all feeds', () => {
  for (const f of caltransFeeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0);
  }
});

test('Caltrans sidecar: streamType is hls where streamingVideoURL exists', () => {
  const withStream = caltransFeeds.filter((f) => f.streamUrl);
  assert.ok(withStream.length > 0, 'at least one feed should have a streamUrl');
  for (const f of withStream) {
    assert.equal(f.streamType, 'hls', `streamType should be hls, got ${f.streamType}`);
  }
});

// ── TfL JamCams config ──────────────────────────────────────────────────────

const TFL_MAP = {
  id: (row) => row.id ?? '',
  name: 'commonName',
  lat: 'lat',
  lon: 'lon',
  snapshotUrl: (row) => row.additionalProperties?.find((p) => p.key === 'imageUrl')?.value ?? '',
};

const tflFeeds = extractWebcamFeeds('TFL', null, TFL_MAP, 'traffic', 60, null, { country: 'GB' }, [tflFixture]);

test('TfL sidecar: produces 2 feeds from fixture', () => {
  assert.equal(tflFeeds.length, 2);
});

test('TfL sidecar: all ids prefixed with TFL:', () => {
  for (const f of tflFeeds) {
    assert.ok(f.id.startsWith('TFL:'), `id ${f.id} should start with TFL:`);
  }
});

test('TfL sidecar: ids are unique', () => {
  const ids = tflFeeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('TfL sidecar: coords are finite numbers', () => {
  for (const f of tflFeeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('TfL sidecar: snapshotUrl derived from additionalProperties imageUrl key', () => {
  for (const f of tflFeeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0, `snapshotUrl missing on ${f.id}`);
    assert.ok(f.snapshotUrl.includes('jamcams'), `snapshotUrl should reference jamcams`);
  }
});

test('TfL sidecar: streamType is snapshot', () => {
  for (const f of tflFeeds) {
    assert.equal(f.streamType, 'snapshot');
  }
});

// ── Singapore LTA config ─────────────────────────────────────────────────────

const SG_MAP = {
  id: (row) => row.camera_id ?? '',
  name: (row) => `Singapore Cam ${row.camera_id ?? ''}`,
  lat: 'location.latitude',
  lon: 'location.longitude',
  snapshotUrl: 'image',
};

const singaporeFeeds = extractWebcamFeeds('SINGAPORE', 'items.0.cameras', SG_MAP, 'traffic', 60, null, { country: 'SG' }, [singaporeFixture]);

test('Singapore sidecar: produces 3 feeds from fixture (items.0.cameras)', () => {
  assert.equal(singaporeFeeds.length, 3);
});

test('Singapore sidecar: all ids prefixed with SINGAPORE:', () => {
  for (const f of singaporeFeeds) {
    assert.ok(f.id.startsWith('SINGAPORE:'), `id ${f.id} should start with SINGAPORE:`);
  }
});

test('Singapore sidecar: ids are unique', () => {
  const ids = singaporeFeeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Singapore sidecar: coords are finite numbers', () => {
  for (const f of singaporeFeeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('Singapore sidecar: snapshotUrl present', () => {
  for (const f of singaporeFeeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0, `snapshotUrl missing on ${f.id}`);
  }
});

test('Singapore sidecar: name follows "Singapore Cam {id}" convention', () => {
  for (const f of singaporeFeeds) {
    assert.ok(f.name.startsWith('Singapore Cam '), `name "${f.name}" should start with Singapore Cam`);
  }
});

test('Singapore sidecar: numeric arrayPath items.0.cameras resolves correctly (camera_id order)', () => {
  assert.equal(singaporeFeeds[0]?.id, 'SINGAPORE:2701');
  assert.equal(singaporeFeeds[1]?.id, 'SINGAPORE:2702');
  assert.equal(singaporeFeeds[2]?.id, 'SINGAPORE:2704');
});

// ── GeoNet (all.json = list of FeatureCollections; non-standard [lat,lon] order) ──

const geonetFixture = require(path.join(fixturesDir, 'geonet-volcano.sample.json'));
const GEONET_IMAGE_BASE = 'https://images.geonet.org.nz/volcano/cameras/';
const GEONET_MAP = {
  id: (row) => {
    const img = row?.properties?.['latest-image-large'] ?? '';
    return img.replace(/^latest\//, '').replace(/\.jpg$/, '') || 'cam';
  },
  name: 'properties.title',
  lat: 'geometry.coordinates.0',
  lon: 'geometry.coordinates.1',
  snapshotUrl: (row) => {
    const img = row?.properties?.['latest-image-large'] ?? '';
    return img ? `${GEONET_IMAGE_BASE}${img}` : '';
  },
};
// The fixture is itself the list of FeatureCollections → pass it directly as payloads.
const geonetFeeds = extractWebcamFeeds('GEONET', 'features', GEONET_MAP, 'volcano', 300, null, { country: 'NZ' }, geonetFixture);

test('GeoNet sidecar: 2 feeds across 2 FeatureCollections', () => {
  assert.equal(geonetFeeds.length, 2);
});

test('GeoNet sidecar: [lat,lon] order — southern lat, near-antimeridian lon', () => {
  for (const f of geonetFeeds) {
    assert.ok(f.lat < -28 && f.lat > -48, `lat ${f.lat}`);
    assert.ok(Math.abs(f.lon) > 160 && Math.abs(f.lon) <= 180, `lon ${f.lon}`);
  }
});

test('GeoNet sidecar: snapshotUrl absolute under images.geonet.org.nz, ends .jpg', () => {
  for (const f of geonetFeeds) {
    assert.ok(f.snapshotUrl.startsWith(GEONET_IMAGE_BASE) && f.snapshotUrl.endsWith('.jpg'), f.snapshotUrl);
  }
});
