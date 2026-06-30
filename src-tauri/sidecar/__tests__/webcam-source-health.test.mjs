import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-webcam-health';

import { deriveWebcamSourceHealth } from '../local-api-server.mjs';

const KEYED = new Set(['WINDY', 'NPS']);
const NOW = 1_750_000_000;

const bySource = (health, src) => health.find((h) => h.source === src);

// Fixtures mirror what the real /api/webcams aggregator now produces: successful
// sources resolve to a feed array, failed sources REJECT (the mapper throws), with
// the same messages the aggregator throws ("missing key (HTTP 503)" / "HTTP 429" / …).
const targets = [
  { source: 'FAA', path: '/api/faa-cameras', shape: 'cameras-bare' },
  { source: 'WINDY', path: '/api/webcams/windy', shape: 'feeds' },
  { source: 'NPS', path: '/api/webcams/nps', shape: 'feeds' },
  { source: 'USGS_VOLCANO', path: '/api/webcams/volcano', shape: 'feeds' },
  { source: 'USGS_STREAM', path: '/api/webcams/streamgauge', shape: 'feeds' },
  { source: 'ALERTWILDFIRE', path: '/api/webcams/fire', shape: 'feeds' },
  { source: 'NOAA_COASTAL', path: '/api/webcams/coastal', shape: 'feeds' },
];

const settled = [
  { status: 'fulfilled', value: [{ id: 'faa1' }, { id: 'faa2' }] },
  // missing WINDY key → /api/webcams/windy returns 503 {requiresKey:true}; aggregator throws this.
  { status: 'rejected', reason: new Error('missing key (HTTP 503)') },
  // keyed source answering a bare 403 → still a key problem.
  { status: 'rejected', reason: new Error('HTTP 403') },
  // NON-keyed source with a 401 must be 'down', NOT 'missing_key' (the needsKey guard).
  { status: 'rejected', reason: new Error('HTTP 401 unauthorized') },
  { status: 'rejected', reason: new Error('HTTP 429') },
  { status: 'fulfilled', value: [] },
  { status: 'rejected', reason: new Error('HTTP 500') },
];

const health = deriveWebcamSourceHealth(targets, settled, KEYED, NOW);

test('FAA fulfilled[2] → ok, count 2', () => {
  const h = bySource(health, 'FAA');
  assert.equal(h.status, 'ok');
  assert.equal(h.count, 2);
  assert.equal(h.needsKey, false);
  assert.equal(h.lastChecked, NOW);
});

test('WINDY missing-key 503 → missing_key (the production path that drives the CTA)', () => {
  const h = bySource(health, 'WINDY');
  assert.equal(h.status, 'missing_key');
  assert.equal(h.needsKey, true);
  assert.match(h.error, /missing key/i);
});

test('keyed source bare 403 → missing_key', () => {
  assert.equal(bySource(health, 'NPS').status, 'missing_key');
});

test('non-keyed source 401 → down, NOT missing_key (needsKey guard)', () => {
  const h = bySource(health, 'USGS_VOLCANO');
  assert.equal(h.status, 'down');
  assert.equal(h.needsKey, false);
});

test('429 → rate_limited', () => {
  assert.equal(bySource(health, 'USGS_STREAM').status, 'rate_limited');
});

test('fulfilled[] → empty', () => {
  assert.equal(bySource(health, 'ALERTWILDFIRE').status, 'empty');
});

test('non-keyed 5xx → down', () => {
  assert.equal(bySource(health, 'NOAA_COASTAL').status, 'down');
});

test('one row per source (no duplicate source rows)', () => {
  const sources = health.map((h) => h.source);
  assert.equal(new Set(sources).size, sources.length);
});

// DOT511 exposes two subroutes — health must collapse to a single row.
test('duplicate DOT511 subroutes merge: feeds win, counts sum', () => {
  const dotTargets = [
    { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
    { source: 'DOT511', path: '/api/webcams/dot-extended', shape: 'feeds' },
  ];
  const dotSettled = [
    { status: 'fulfilled', value: [{ id: 'd1' }, { id: 'd2' }] },
    { status: 'rejected', reason: new Error('HTTP 500') },
  ];
  const merged = deriveWebcamSourceHealth(dotTargets, dotSettled, KEYED, NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'DOT511');
  assert.equal(merged[0].status, 'ok'); // any-feeds wins over a failed sibling
  assert.equal(merged[0].count, 2);
});

test('duplicate DOT511 both failing merge to the most actionable failure', () => {
  const dotTargets = [
    { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
    { source: 'DOT511', path: '/api/webcams/dot-extended', shape: 'feeds' },
  ];
  const dotSettled = [
    { status: 'fulfilled', value: [] }, // empty
    { status: 'rejected', reason: new Error('HTTP 500') }, // down
  ];
  const merged = deriveWebcamSourceHealth(dotTargets, dotSettled, KEYED, NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'down'); // down is more actionable than empty
});
