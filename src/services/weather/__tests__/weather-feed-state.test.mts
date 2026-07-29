import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWeatherFeedFresh,
  getWeatherAlertsFeedState,
  WEATHER_FEED_TTL_MS,
  type WeatherFeedState,
} from '../../weather.ts';

// The NWS weather circuit breaker NEVER throws — on a failed live fetch it
// returns its cached value (or the `[]` default). So the offline-cache wrapper
// the data-loader uses ALWAYS lands in its success branch and reports
// `fresh: true`, even when the live fetch actually failed. That fake-fresh
// signal let the notification path PROVE an "all clear" off a dead feed (the
// reported "all clear during a severe storm" bug, on the failure path).
//
// The honest signal is the breaker's own data-state `mode`: only a genuine
// live read — or a still-recent cached read — may authorize DROPPING the
// personal weather threat. `mode:'unavailable'` (fetch failed, nothing usable)
// must never count as fresh.

test('a live read with a recent timestamp is fresh', () => {
  const state: WeatherFeedState = { mode: 'live', timestamp: 1_000 };
  assert.equal(isWeatherFeedFresh(state, 2_000, WEATHER_FEED_TTL_MS), true);
});

test('a live read with NO timestamp is NOT fresh (cannot prove recency)', () => {
  // mode:'live' alone is not proof of currency — the breaker could report a
  // months-old live read that has never refreshed. Without a finite timestamp
  // we cannot bound its age, so it must not authorize a clear.
  assert.equal(isWeatherFeedFresh({ mode: 'live', timestamp: null }, 2_000, WEATHER_FEED_TTL_MS), false);
});

test('a live read OLDER than TTL is NOT fresh (stale live never proves clear)', () => {
  const now = 1_000_000;
  const state: WeatherFeedState = { mode: 'live', timestamp: now - (WEATHER_FEED_TTL_MS + 1) };
  assert.equal(isWeatherFeedFresh(state, now, WEATHER_FEED_TTL_MS), false);
});

test('a read with a FUTURE timestamp (negative age) is NOT fresh', () => {
  // A clock skew or corrupted timestamp ahead of `now` yields a negative age.
  // Treating that as fresh would let a nonsense timestamp authorize a clear;
  // reject it for both live and cached.
  const now = 1_000_000;
  assert.equal(isWeatherFeedFresh({ mode: 'live', timestamp: now + 5_000 }, now, WEATHER_FEED_TTL_MS), false);
  assert.equal(isWeatherFeedFresh({ mode: 'cached', timestamp: now + 5_000 }, now, WEATHER_FEED_TTL_MS), false);
});

test('an unavailable feed is NOT fresh (fetch failed, no cache — never prove clear)', () => {
  assert.equal(isWeatherFeedFresh({ mode: 'unavailable', timestamp: null }, 2_000, WEATHER_FEED_TTL_MS), false);
});

test('a cached read within TTL is fresh (bounded staleness is acceptable)', () => {
  const now = 1_000_000;
  const state: WeatherFeedState = { mode: 'cached', timestamp: now - (WEATHER_FEED_TTL_MS - 1) };
  assert.equal(isWeatherFeedFresh(state, now, WEATHER_FEED_TTL_MS), true);
});

test('a cached read exactly at the TTL boundary is still fresh (<=)', () => {
  const now = 1_000_000;
  const state: WeatherFeedState = { mode: 'cached', timestamp: now - WEATHER_FEED_TTL_MS };
  assert.equal(isWeatherFeedFresh(state, now, WEATHER_FEED_TTL_MS), true);
});

test('a cached read older than TTL is NOT fresh', () => {
  const now = 1_000_000;
  const state: WeatherFeedState = { mode: 'cached', timestamp: now - (WEATHER_FEED_TTL_MS + 1) };
  assert.equal(isWeatherFeedFresh(state, now, WEATHER_FEED_TTL_MS), false);
});

test('a cached read with no timestamp is NOT fresh (cannot prove recency)', () => {
  assert.equal(isWeatherFeedFresh({ mode: 'cached', timestamp: null }, 2_000, WEATHER_FEED_TTL_MS), false);
});

test('now and ttl are optional (defaults apply); a just-now live read is fresh', () => {
  assert.equal(isWeatherFeedFresh({ mode: 'live', timestamp: Date.now() }), true);
});

test('now and ttl are optional; a null-timestamp live read is NOT fresh under defaults', () => {
  assert.equal(isWeatherFeedFresh({ mode: 'live', timestamp: null }), false);
});

test('getWeatherAlertsFeedState returns the breaker data-state shape', () => {
  const s = getWeatherAlertsFeedState();
  assert.ok(s.mode === 'live' || s.mode === 'cached' || s.mode === 'unavailable', `unexpected mode ${s.mode}`);
  assert.ok(s.timestamp === null || typeof s.timestamp === 'number', 'timestamp is number|null');
});
