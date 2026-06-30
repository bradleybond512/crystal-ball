import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFeedsFromConfig } from '../webcam-config-loader.ts';
import { TFL_CONFIG } from '../webcam-source-configs.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = require(path.join(__dirname, 'fixtures/tfl-jamcams.sample.json')) as unknown;

const feeds = buildFeedsFromConfig(TFL_CONFIG, [fixture]);

test('TfL: produces correct feed count from fixture (2 records)', () => {
  assert.equal(feeds.length, 2);
});

test('TfL: all feed ids are prefixed with TFL:', () => {
  for (const f of feeds) {
    assert.ok(f.id.startsWith('TFL:'), `id ${f.id} should start with TFL:`);
  }
});

test('TfL: all feed ids are unique', () => {
  const ids = feeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('TfL: coords are finite numbers (not strings)', () => {
  for (const f of feeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('TfL: snapshotUrl present and points to S3 jamcams URL', () => {
  for (const f of feeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0, `snapshotUrl missing on ${f.id}`);
    assert.ok(f.snapshotUrl.includes('jamcams'), `snapshotUrl ${f.snapshotUrl} should be a jamcam URL`);
  }
});

test('TfL: streamType is snapshot (no HLS in fixture)', () => {
  for (const f of feeds) {
    assert.equal(f.streamType, 'snapshot');
  }
});

test('TfL: category is traffic', () => {
  for (const f of feeds) {
    assert.equal(f.category, 'traffic');
  }
});

test('TfL: source is TFL', () => {
  for (const f of feeds) {
    assert.equal(f.source, 'TFL');
  }
});

test('TfL: snapshotUrl derived from additionalProperties imageUrl key', () => {
  const first = feeds[0];
  assert.ok(first);
  assert.ok(first.snapshotUrl.endsWith('.jpg'), `snapshotUrl ${first.snapshotUrl} should be a jpg`);
});
