import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFeedsFromConfig } from '../webcam-config-loader.ts';
import { GEONET_CONFIG } from '../webcam-source-configs.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// GeoNet all.json is a LIST of FeatureCollections (one per volcano) — the list
// itself IS the payloads array (each FC fans out, arrayPath 'features').
const fixture = require(path.join(__dirname, 'fixtures/geonet-volcano.sample.json')) as unknown[];

const feeds = buildFeedsFromConfig(GEONET_CONFIG, fixture);

test('GeoNet: one feed per feature across FeatureCollections (2)', () => {
  assert.equal(feeds.length, 2);
});

test('GeoNet: ids prefixed GEONET: and unique', () => {
  for (const f of feeds) assert.ok(f.id.startsWith('GEONET:'), f.id);
  const ids = feeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('GeoNet: NZ coords — southern lat, near-antimeridian lon [verified non-standard [lat,lon] order; Kermadecs cross 180]', () => {
  for (const f of feeds) {
    assert.ok(Number.isFinite(f.lat) && Number.isFinite(f.lon));
    // If lat/lon were swapped, lat would be ~175 (an invalid latitude) — this pins the order.
    assert.ok(f.lat < -28 && f.lat > -48, `lat ${f.lat} should be NZ/Kermadec southern latitude`);
    assert.ok(Math.abs(f.lon) > 160 && Math.abs(f.lon) <= 180, `lon ${f.lon} should be near the antimeridian`);
  }
});

test('GeoNet: snapshotUrl absolute under images.geonet.org.nz, ends .jpg', () => {
  for (const f of feeds) {
    assert.ok(f.snapshotUrl.startsWith('https://images.geonet.org.nz/volcano/cameras/'), f.snapshotUrl);
    assert.ok(f.snapshotUrl.endsWith('.jpg'), f.snapshotUrl);
  }
});

test('GeoNet: category volcano, source GEONET', () => {
  for (const f of feeds) {
    assert.equal(f.category, 'volcano');
    assert.equal(f.source, 'GEONET');
  }
});
