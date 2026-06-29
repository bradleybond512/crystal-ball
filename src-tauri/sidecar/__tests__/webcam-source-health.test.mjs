import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-webcam-health';

import { deriveWebcamSourceHealth } from '../local-api-server.mjs';

const KEYED = new Set(['WINDY', 'NPS']);
const NOW = 1_750_000_000;

const targets = [
  { source: 'FAA', path: '/api/faa-cameras', shape: 'cameras-bare' },
  { source: 'WINDY', path: '/api/webcams/windy', shape: 'feeds' },
  { source: 'NPS', path: '/api/webcams/nps', shape: 'feeds' },
  { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
  { source: 'WINDY', path: '/api/webcams/windy', shape: 'feeds' },
];

const settled = [
  // FAA fulfilled with 2 feeds
  { status: 'fulfilled', value: [{ id: 'faa1' }, { id: 'faa2' }] },
  // WINDY rejected 401
  { status: 'rejected', reason: new Error('Windy HTTP 401 unauthorized') },
  // NPS fulfilled but empty
  { status: 'fulfilled', value: [] },
  // DOT511 rejected 500
  { status: 'rejected', reason: new Error('HTTP 500') },
  // WINDY rejected 429
  { status: 'rejected', reason: new Error('429 Too Many Requests') },
];

const health = deriveWebcamSourceHealth(targets, settled, KEYED, NOW);

test('FAA fulfilled[2] → ok, count 2', () => {
  assert.equal(health[0].source, 'FAA');
  assert.equal(health[0].status, 'ok');
  assert.equal(health[0].count, 2);
  assert.equal(health[0].needsKey, false);
  assert.equal(health[0].lastChecked, NOW);
});

test('WINDY rejected 401 → missing_key', () => {
  assert.equal(health[1].source, 'WINDY');
  assert.equal(health[1].status, 'missing_key');
  assert.equal(health[1].count, 0);
  assert.equal(health[1].needsKey, true);
  assert.match(health[1].error, /401/);
});

test('NPS fulfilled[] → empty', () => {
  assert.equal(health[2].source, 'NPS');
  assert.equal(health[2].status, 'empty');
  assert.equal(health[2].count, 0);
  assert.equal(health[2].needsKey, true);
});

test('DOT511 rejected HTTP 500 → down', () => {
  assert.equal(health[3].source, 'DOT511');
  assert.equal(health[3].status, 'down');
  assert.equal(health[3].count, 0);
  assert.equal(health[3].needsKey, false);
  assert.match(health[3].error, /500/);
});

test('WINDY rejected 429 → rate_limited', () => {
  assert.equal(health[4].source, 'WINDY');
  assert.equal(health[4].status, 'rate_limited');
  assert.equal(health[4].count, 0);
  assert.equal(health[4].needsKey, true);
  assert.match(health[4].error, /429/);
});
