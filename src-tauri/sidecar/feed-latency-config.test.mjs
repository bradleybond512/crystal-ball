/* eslint-disable unicorn/prefer-event-target */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  FEED_LATENCY_CONFIG,
  getMismatchedFeeds,
  getUncachedFeeds,
} from './feed-latency-config.mjs';

// ── FEED_LATENCY_CONFIG structure ─────────────────────────────────────────────

test('FEED_LATENCY_CONFIG: every entry has required fields', () => {
  for (const [feedId, cfg] of Object.entries(FEED_LATENCY_CONFIG)) {
    assert.ok(typeof cfg.ttlMs === 'number', `${feedId}: ttlMs must be number`);
    assert.ok(typeof cfg.sourceUpdateFreqMs === 'number', `${feedId}: sourceUpdateFreqMs must be number`);
    assert.ok(typeof cfg.notes === 'string', `${feedId}: notes must be string`);
    assert.ok(cfg.ttlMs >= 0, `${feedId}: ttlMs must be non-negative`);
    assert.ok(cfg.sourceUpdateFreqMs > 0, `${feedId}: sourceUpdateFreqMs must be positive`);
  }
});

test('FEED_LATENCY_CONFIG: includes expected feed IDs', () => {
  const expected = ['adsb', 'aviation-tfrs', 'gdacs-rss', 'emsc-seismic', 'owm-current'];
  for (const id of expected) {
    assert.ok(FEED_LATENCY_CONFIG[id] !== undefined, `missing feed config for ${id}`);
  }
});

test('FEED_LATENCY_CONFIG: fixed TTL mismatches have correct values', () => {
  // emsc-seismic: was 10 min, now 2 min
  assert.equal(FEED_LATENCY_CONFIG['emsc-seismic'].ttlMs, 2 * 60_000);
  // owm-current: was 30 min, now 10 min
  assert.equal(FEED_LATENCY_CONFIG['owm-current'].ttlMs, 10 * 60_000);
  // power-grid: was 15 min, now 5 min
  assert.equal(FEED_LATENCY_CONFIG['power-grid'].ttlMs, 5 * 60_000);
  // gdelt-intel: was 30 min, now 15 min
  assert.equal(FEED_LATENCY_CONFIG['gdelt-intel'].ttlMs, 15 * 60_000);
  // disease-intel: was 30 min, now 15 min
  assert.equal(FEED_LATENCY_CONFIG['disease-intel'].ttlMs, 15 * 60_000);
});

test('FEED_LATENCY_CONFIG: gdacs-rss and aviation-tfrs are present and aligned', () => {
  const gdacs = FEED_LATENCY_CONFIG['gdacs-rss'];
  assert.ok(gdacs !== undefined);
  assert.equal(gdacs.ttlMs, 30 * 60_000);
  assert.equal(gdacs.sourceUpdateFreqMs, 30 * 60_000);

  const tfrs = FEED_LATENCY_CONFIG['aviation-tfrs'];
  assert.ok(tfrs !== undefined);
  assert.equal(tfrs.ttlMs, 15 * 60_000);
  assert.equal(tfrs.sourceUpdateFreqMs, 15 * 60_000);
});

// ── getMismatchedFeeds ────────────────────────────────────────────────────────

test('getMismatchedFeeds: returns array sorted by ratio descending', () => {
  const feeds = getMismatchedFeeds();
  assert.ok(Array.isArray(feeds));
  assert.ok(feeds.length > 0);
  for (let i = 1; i < feeds.length; i++) {
    assert.ok(feeds[i - 1].ratio >= feeds[i].ratio, 'feeds should be sorted by ratio descending');
  }
});

test('getMismatchedFeeds: excludes zero-TTL feeds', () => {
  const feeds = getMismatchedFeeds();
  for (const f of feeds) {
    assert.ok(f.ttlMs > 0, `${f.feedId} should not appear in mismatched (ttlMs=0)`);
  }
});

test('getMismatchedFeeds: each entry has feedId, ratio, ttlMs, sourceUpdateFreqMs', () => {
  const feeds = getMismatchedFeeds();
  for (const f of feeds) {
    assert.ok(typeof f.feedId === 'string');
    assert.ok(typeof f.ratio === 'number');
    assert.ok(f.ratio > 0);
    assert.ok(typeof f.ttlMs === 'number');
    assert.ok(typeof f.sourceUpdateFreqMs === 'number');
  }
});

// ── getUncachedFeeds ──────────────────────────────────────────────────────────

test('getUncachedFeeds: returns only feeds with ttlMs === 0', () => {
  const feeds = getUncachedFeeds();
  assert.ok(Array.isArray(feeds));
  assert.ok(feeds.length > 0);
  for (const f of feeds) {
    assert.equal(f.ttlMs, 0, `${f.feedId} should have ttlMs=0`);
  }
});

test('getUncachedFeeds: includes nws-alerts and weather-alerts', () => {
  const feeds = getUncachedFeeds();
  const ids = new Set(feeds.map((f) => f.feedId));
  assert.ok(ids.has('nws-alerts'), 'nws-alerts should be uncached');
  assert.ok(ids.has('weather-alerts'), 'weather-alerts should be uncached');
});
