import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFeedsFromConfig } from '../webcam-config-loader.ts';
import { SINGAPORE_CONFIG } from '../webcam-source-configs.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = require(path.join(__dirname, 'fixtures/singapore-lta.sample.json')) as unknown;

const feeds = buildFeedsFromConfig(SINGAPORE_CONFIG, [fixture]);

test('Singapore: produces correct feed count from fixture (3 cameras in items.0.cameras)', () => {
  assert.equal(feeds.length, 3);
});

test('Singapore: all feed ids are prefixed with SINGAPORE:', () => {
  for (const f of feeds) {
    assert.ok(f.id.startsWith('SINGAPORE:'), `id ${f.id} should start with SINGAPORE:`);
  }
});

test('Singapore: all feed ids are unique', () => {
  const ids = feeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Singapore: coords are finite numbers', () => {
  for (const f of feeds) {
    assert.ok(Number.isFinite(f.lat), `lat ${f.lat} should be finite`);
    assert.ok(Number.isFinite(f.lon), `lon ${f.lon} should be finite`);
  }
});

test('Singapore: snapshotUrl present and non-empty', () => {
  for (const f of feeds) {
    assert.ok(typeof f.snapshotUrl === 'string' && f.snapshotUrl.length > 0, `snapshotUrl missing on ${f.id}`);
  }
});

test('Singapore: name follows "Singapore Cam {camera_id}" convention', () => {
  for (const f of feeds) {
    assert.ok(f.name.startsWith('Singapore Cam '), `name "${f.name}" should start with "Singapore Cam "`);
  }
});

test('Singapore: category is traffic', () => {
  for (const f of feeds) {
    assert.equal(f.category, 'traffic');
  }
});

test('Singapore: source is SINGAPORE', () => {
  for (const f of feeds) {
    assert.equal(f.source, 'SINGAPORE');
  }
});

test('Singapore: snapshotTtlSec is 240 (config-level, not on feed but config)', () => {
  assert.equal(SINGAPORE_CONFIG.snapshotTtlSec, 240);
});

test('Singapore: arrayPath resolves items.0.cameras (numeric index support)', () => {
  assert.equal(feeds[0]?.id, 'SINGAPORE:2701');
  assert.equal(feeds[1]?.id, 'SINGAPORE:2702');
  assert.equal(feeds[2]?.id, 'SINGAPORE:2704');
});
