import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YOUTUBE_LIVE_FEEDS,
  feedsForRegion,
} from '../youtube-live-registry.ts';

test('YOUTUBE_LIVE_FEEDS is non-empty', () => {
  assert.ok(YOUTUBE_LIVE_FEEDS.length >= 1);
});

test('every feed id is unique (ids key lookup, active-state, and analytics)', () => {
  const ids = YOUTUBE_LIVE_FEEDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feed id in YOUTUBE_LIVE_FEEDS');
});

test('feedsForRegion("iran") returns only iran entries', () => {
  const feeds = feedsForRegion('iran');
  assert.ok(feeds.length > 0, 'should have at least one iran feed');
  for (const f of feeds) {
    assert.equal(f.region, 'iran');
  }
});

test('feedsForRegion("all") returns all feeds', () => {
  const feeds = feedsForRegion('all');
  assert.equal(feeds.length, YOUTUBE_LIVE_FEEDS.length);
});

test('feedsForRegion("") returns all feeds', () => {
  const feeds = feedsForRegion('');
  assert.equal(feeds.length, YOUTUBE_LIVE_FEEDS.length);
});

test('every entry has a non-empty fallbackVideoId', () => {
  for (const f of YOUTUBE_LIVE_FEEDS) {
    assert.ok(
      typeof f.fallbackVideoId === 'string' && f.fallbackVideoId.length > 0,
      `${f.id} has empty fallbackVideoId`,
    );
  }
});
