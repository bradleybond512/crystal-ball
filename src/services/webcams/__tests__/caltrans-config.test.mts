import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFeedsFromConfig } from '../webcam-config-loader.ts';
import { CALTRANS_CONFIG } from '../webcam-source-configs.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = require(path.join(__dirname, 'fixtures/caltrans-cwwp2.sample.json')) as unknown;

const feeds = buildFeedsFromConfig(CALTRANS_CONFIG, [fixture]);

test('Caltrans: produces correct feed count from fixture (2 records, both have images)', () => {
  assert.equal(feeds.length, 2);
});

test('Caltrans: all feed ids are prefixed with CALTRANS:', () => {
  for (const f of feeds) {
    assert.ok(f.id.startsWith('CALTRANS:'), `id ${f.id} should start with CALTRANS:`);
  }
});

test('Caltrans: all feed ids are unique', () => {
  const ids = feeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Caltrans: ids include district prefix (d11)', () => {
  for (const f of feeds) {
    assert.ok(f.id.includes('d11'), `id ${f.id} should include district d11`);
  }
});

test('Caltrans: coords parsed to finite numbers', () => {
  for (const f of feeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('Caltrans: snapshotUrl present and non-empty on all feeds', () => {
  for (const f of feeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0, `snapshotUrl missing on ${f.id}`);
  }
});

test('Caltrans: streamType is hls where streamingVideoURL exists', () => {
  const withStream = feeds.filter((f) => f.streamUrl);
  assert.ok(withStream.length > 0, 'at least one feed should have streamUrl in fixture');
  for (const f of withStream) {
    assert.equal(f.streamType, 'hls', `streamType should be hls for ${f.id} (streamUrl: ${f.streamUrl})`);
  }
});

test('Caltrans: category is traffic', () => {
  for (const f of feeds) {
    assert.equal(f.category, 'traffic');
  }
});

test('Caltrans: refreshIntervalSec is 60', () => {
  for (const f of feeds) {
    assert.equal(f.refreshIntervalSec, 60);
  }
});

test('Caltrans: source is CALTRANS', () => {
  for (const f of feeds) {
    assert.equal(f.source, 'CALTRANS');
  }
});
